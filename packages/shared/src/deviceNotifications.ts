/**
 * SaDeL - Device Notification Security & Unpairing Utilities
 *
 * Garantiza que al cerrar sesión en un dispositivo:
 *  1. Se revoque la asociación del token FCM y/o suscripción Web Push en el backend
 *     para ese dispositivo en particular, sin afectar las sesiones del usuario en
 *     otros dispositivos.
 *  2. Si la red falla durante el logout, se limpie inmediatamente la sesión local y
 *     se deje un registro seguro no sensible (solo el token/endpoint, sin credenciales)
 *     para desvincular el dispositivo tan pronto haya conectividad.
 *  3. Se detengan las alertas, sonidos y se cancelen las notificaciones entregadas en la bandeja.
 */

export type UnpairDeviceParams = {
  apiBase: string;
  jwt?: string | null;
  fcmToken?: string | null;
  endpoint?: string | null;
  timeoutMs?: number;
};

const PENDING_UNPAIR_STORAGE_KEY = 'sadel.pending_device_unpair';

/**
 * `fetch` con límite temporal estricto para operaciones best-effort.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = 4000, signal: callerSignal, ...fetchInit } = init;
  const controller = new AbortController();

  const onCallerAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort();
    } else {
      callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }
  }

  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const onTimeout = () =>
    new Promise<never>((_, reject) => {
      const err = new Error('Timeout de red agotado');
      err.name = 'AbortError';
      if (controller.signal.aborted) {
        reject(err);
        return;
      }
      controller.signal.addEventListener('abort', () => reject(err), { once: true });
    });

  try {
    return await Promise.race([fetch(input, { ...fetchInit, signal: controller.signal }), onTimeout()]);
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onCallerAbort);
  }
}

/**
 * Revoca en el backend los identificadores push de este dispositivo (token FCM y/o endpoint Web Push).
 *
 * Garantías:
 *  - Idempotente y no bloqueante: nunca arroja excepciones hacia el llamador.
 *  - Si hay JWT, lo usa para limitar la revocación al usuario autenticado.
 *  - Si el backend rechaza con 401 o no hay JWT, recurre a `/notifications/unpair` por posesión exclusiva del token/endpoint.
 *  - El resultado se evalúa POR IDENTIFICADOR: si solo falla uno de los dos (token o endpoint),
 *    únicamente ese queda encolado para reintentar; nunca se da por hecho lo que no se revocó.
 *  - Si la red falla, guarda los identificadores pendientes en almacenamiento local
 *    (sin credenciales) para reintentar la desvinculación cuando vuelva la red o en el próximo inicio.
 */
export async function revokeDevicePush({
  apiBase,
  jwt,
  fcmToken,
  endpoint,
  timeoutMs = 3500,
}: UnpairDeviceParams): Promise<{ attempted: boolean; success: boolean }> {
  const cleanFcm = fcmToken?.trim() || null;
  const cleanEndpoint = endpoint?.trim() || null;

  if (!cleanFcm && !cleanEndpoint) {
    return { attempted: false, success: true };
  }

  const normalizedApiBase = apiBase.replace(/\/+$/, '');

  // Estado por identificador: si UNA de las dos revocaciones falla (timeout,
  // 5xx o red cortada a mitad), SOLO esa queda pendiente; tratar el parcial
  // como éxito completo dejaría el dispositivo recibiendo avisos por el
  // canal que falló.
  let fcmOk = !cleanFcm;
  let webOk = !cleanEndpoint;

  try {
    const tasks: Promise<{ kind: 'fcm' | 'web' | 'all'; ok: boolean }>[] = [];

    // Intento 1: con JWT, endpoints acotados al usuario autenticado.
    if (jwt) {
      const authHeaders = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
      };

      if (cleanFcm) {
        tasks.push(
          fetchWithTimeout(`${normalizedApiBase}/notifications/fcm-token`, {
            method: 'DELETE',
            headers: authHeaders,
            body: JSON.stringify({ token: cleanFcm }),
            timeoutMs,
          }).then((r) => ({ kind: 'fcm' as const, ok: r.ok }))
        );
      }

      if (cleanEndpoint) {
        tasks.push(
          fetchWithTimeout(`${normalizedApiBase}/notifications/subscription`, {
            method: 'DELETE',
            headers: authHeaders,
            body: JSON.stringify({ endpoint: cleanEndpoint }),
            timeoutMs,
          }).then((r) => ({ kind: 'web' as const, ok: r.ok }))
        );
      }
    } else {
      // Sin JWT (logout offline/diferido): unpair por posesión, cubre ambos.
      tasks.push(
        fetchWithTimeout(`${normalizedApiBase}/notifications/unpair`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(cleanFcm ? { fcmToken: cleanFcm } : {}),
            ...(cleanEndpoint ? { endpoint: cleanEndpoint } : {}),
          }),
          timeoutMs,
        }).then((r) => ({ kind: 'all' as const, ok: r.ok }))
      );
    }

    const results = await Promise.allSettled(tasks);
    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value.ok) continue;
      if (result.value.kind === 'fcm') fcmOk = true;
      else if (result.value.kind === 'web') webOk = true;
      else {
        fcmOk = true;
        webOk = true;
      }
    }

    // Si algo autenticado falló (p. ej. JWT caducado en el momento del logout
    // o una petición colgada), se reintenta TODO sin JWT vía /notifications/unpair.
    if (jwt && (!fcmOk || !webOk)) {
      try {
        const fallbackRes = await fetchWithTimeout(`${normalizedApiBase}/notifications/unpair`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(cleanFcm ? { fcmToken: cleanFcm } : {}),
            ...(cleanEndpoint ? { endpoint: cleanEndpoint } : {}),
          }),
          timeoutMs,
        });
        if (fallbackRes.ok) {
          fcmOk = true;
          webOk = true;
        }
      } catch {
        // Red caída: lo que siga fallando queda en la cola pendiente.
      }
    }
  } catch {
    // Error inesperado: se mantiene el estado por identificador calculado.
  }

  const anySuccess = fcmOk && webOk;

  if (!anySuccess) {
    // Si la red no permitió revocar ahora, persistir en cola pendiente NO SENSIBLE
    // (solo los identificadores físicos del dispositivo, jamás tokens de acceso ni usuarios).
    // Cola pendiente solo con lo que NO se pudo revocar en esta llamada
    // (savePending conserva cualquier identificador ya encolado previamente).
    savePendingDeviceUnpair({
      fcmToken: fcmOk ? null : cleanFcm,
      endpoint: webOk ? null : cleanEndpoint,
    });
  } else {
    clearPendingDeviceUnpair();
  }

  return { attempted: true, success: anySuccess };
}

/**
 * Guarda identificadores de dispositivo pendientes de desvincular cuando falla la red durante logout.
 */
export function savePendingDeviceUnpair(data: { fcmToken?: string | null; endpoint?: string | null }): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const existingRaw = window.localStorage.getItem(PENDING_UNPAIR_STORAGE_KEY);
    const existing = existingRaw ? JSON.parse(existingRaw) : {};
    const next = {
      fcmToken: data.fcmToken || existing.fcmToken || null,
      endpoint: data.endpoint || existing.endpoint || null,
    };
    if (next.fcmToken || next.endpoint) {
      window.localStorage.setItem(PENDING_UNPAIR_STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    /* noop */
  }
}

/**
 * Lee identificadores pendientes de desvincular.
 */
export function readPendingDeviceUnpair(): { fcmToken?: string | null; endpoint?: string | null } | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(PENDING_UNPAIR_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Limpia la cola de desvinculación pendiente.
 */
export function clearPendingDeviceUnpair(): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(PENDING_UNPAIR_STORAGE_KEY);
    }
  } catch {
    /* noop */
  }
}

/**
 * Procesa cualquier desvinculación pendiente cuando vuelve la red.
 */
export async function flushPendingDeviceUnpair(apiBase: string): Promise<boolean> {
  const pending = readPendingDeviceUnpair();
  if (!pending || (!pending.fcmToken && !pending.endpoint)) {
    return false;
  }

  try {
    const normalizedApiBase = apiBase.replace(/\/+$/, '');
    const res = await fetchWithTimeout(`${normalizedApiBase}/notifications/unpair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(pending.fcmToken ? { fcmToken: pending.fcmToken } : {}),
        ...(pending.endpoint ? { endpoint: pending.endpoint } : {}),
      }),
      timeoutMs: 4000,
    });

    if (res.ok) {
      clearPendingDeviceUnpair();
      return true;
    }
  } catch {
    /* noop */
  }
  return false;
}

/**
 * Cierra las notificaciones activas mostradas en la bandeja del sistema (PWA / Web).
 */
export function closeActiveWebNotifications(): void {
  if (typeof window === 'undefined') return;
  try {
    if ('serviceWorker' in navigator && navigator.serviceWorker) {
      navigator.serviceWorker.ready
        .then((reg) => reg.getNotifications())
        .then((notifications) => {
          notifications.forEach((n) => n.close());
        })
        .catch(() => undefined);
    }
  } catch {
    /* noop */
  }
}

/**
 * Claves de almacenamiento local de identificadores push por rol/app.
 */
export function getFcmTokenStorageKey(appPrefix: string): string {
  return `${appPrefix}.fcm_device_token`;
}

export function getPushEndpointStorageKey(appPrefix: string): string {
  return `${appPrefix}.push_endpoint`;
}

export function saveStoredFcmToken(appPrefix: string, token: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(getFcmTokenStorageKey(appPrefix), token);
    }
  } catch {}
}

export function readStoredFcmToken(appPrefix: string): string | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(getFcmTokenStorageKey(appPrefix));
    }
  } catch {}
  return null;
}

export function clearStoredFcmToken(appPrefix: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(getFcmTokenStorageKey(appPrefix));
    }
  } catch {}
}

export function saveStoredPushEndpoint(appPrefix: string, endpoint: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(getPushEndpointStorageKey(appPrefix), endpoint);
    }
  } catch {}
}

export function readStoredPushEndpoint(appPrefix: string): string | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(getPushEndpointStorageKey(appPrefix));
    }
  } catch {}
  return null;
}

export function clearStoredPushEndpoint(appPrefix: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(getPushEndpointStorageKey(appPrefix));
    }
  } catch {}
}
