// Adaptador nativo para la app Android del comensal (Capacitor).
//
// La web se sirve igual en el navegador y dentro del WebView de la app.
// Este módulo detecta el bridge de Capacitor y usa sus plugins (FCM, GPS
// nativo, haptics, keep-awake, ajustes de batería); fuera del WebView todo
// se degrada al comportamiento web estándar, de modo que la PWA no cambia.

type PushPermissionState = 'granted' | 'denied' | 'unavailable';

function capacitor(): any {
  if (typeof window === 'undefined') return null;
  return (window as any).Capacitor ?? null;
}

/** ¿Se está ejecutando dentro del WebView nativo de la app Android? */
export function isNativePlatform(): boolean {
  const cap = capacitor();
  return Boolean(cap?.isNativePlatform?.());
}

function plugin(name: string): any {
  return capacitor()?.Plugins?.[name] ?? null;
}

/**
 * Expone el plugin nativo `App` al WebView. El bundle no importa los paquetes
 * @capacitor/*, así que sin este registro `Capacitor.Plugins.App` no existe y
 * el botón atrás / exitApp quedan inertes. Solo `App`: el resto de plugins
 * sigue igual que antes (sin cambios de conducta).
 */
function ensureAppPlugin(): any {
  try {
    const cap = capacitor();
    if (!cap || !isNativePlatform() || typeof cap.registerPlugin !== 'function') return null;
    if (cap.Plugins?.['App']) return cap.Plugins['App'];
    return cap.registerPlugin('App') ?? null;
  } catch {
    return null;
  }
}

export type AndroidBackButtonHandle = {
  remove: () => void;
};

/**
 * Botón atrás de Android estilo resto de apps: en pantallas internas
 * retrocede; en la raíz, el primer toque avisa (onFirstBackPress) y el
 * segundo dentro de 2 s cierra vía `App.exitApp()`.
 *
 * Sin listener JS, Capacitor solo recorre el historial del WebView (y con
 * historial vacío ni eso): la app nunca se cierra con el botón del sistema.
 * Devuelve null fuera del WebView o sin plugin App (se conserva lo anterior).
 */
export function setupAndroidBackButton(options: {
  isRoot: () => boolean;
  onFirstBackPress: () => void;
  doublePressMs?: number;
}): AndroidBackButtonHandle | null {
  let handle: { remove: () => void } | null = null;
  let removed = false;
  let lastPress = 0;
  try {
    const AppPlugin = ensureAppPlugin();
    if (!AppPlugin || typeof AppPlugin.addListener !== 'function') return null;
    const windowMs = Math.max(500, options.doublePressMs ?? 2000);
    const onBack = (event: { canGoBack?: boolean }) => {
      if (removed) return;
      let root = true;
      try {
        root = options.isRoot();
      } catch {
        root = true;
      }
      if (!root && event?.canGoBack) {
        try {
          window.history.back();
        } catch {
          /* noop */
        }
        return;
      }
      const now = Date.now();
      if (now - lastPress < windowMs) {
        lastPress = 0;
        try {
          const done = AppPlugin.exitApp();
          if (done && typeof (done as Promise<void>).catch === 'function') {
            (done as Promise<void>).catch(() => {});
          }
        } catch {
          /* noop */
        }
        return;
      }
      lastPress = now;
      try {
        options.onFirstBackPress();
      } catch {
        /* noop */
      }
    };
    const registered: unknown = AppPlugin.addListener('backButton', onBack);
    if (
      registered &&
      typeof (registered as Promise<{ remove?: () => void }>).then === 'function'
    ) {
      (registered as Promise<{ remove?: () => void }>).then(
        (h) => {
          const removeFn =
            h && typeof h.remove === 'function' ? h.remove.bind(h) : null;
          handle = removeFn ? { remove: () => removeFn() } : null;
        },
        () => {},
      );
    } else if (registered && typeof (registered as { remove?: unknown }).remove === 'function') {
      handle = registered as { remove: () => void };
    }
  } catch {
    return null;
  }
  return {
    remove: () => {
      removed = true;
      try {
        handle?.remove();
      } catch {
        /* noop */
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Push / FCM
// ---------------------------------------------------------------------------

/** Estados posibles del permiso de notificaciones nativo (sin pedir el diálogo). */
export type NativePushPermissionState = 'granted' | 'prompt' | 'denied' | 'unavailable';

/**
 * Estado crudo del permiso nativo. Distingue «aún no preguntado» (prompt: el
 * diálogo del sistema sí puede mostrarse) de «denegado permanente» (denied:
 * solo queda guiar a ajustes). Sin esto, un denegado permanente recibiría una
 * invitación que promete una activación imposible.
 */
export async function getNativePushPermissionState(): Promise<NativePushPermissionState> {
  const PN = plugin('PushNotifications');
  if (!PN) return 'unavailable';
  try {
    const res = await PN.checkPermissions();
    const receive = res?.receive;
    if (receive === 'granted') return 'granted';
    if (receive === 'denied') return 'denied';
    return 'prompt';
  } catch {
    return 'unavailable';
  }
}

/**
 * Pide el permiso de notificaciones nativo (Android 13+ muestra el diálogo).
 * En el WebView el `Notification.requestPermission()` web no existe, por eso
 * se delega al plugin.
 */
export async function requestNativePushPermission(): Promise<PushPermissionState> {
  const PN = plugin('PushNotifications');
  if (!PN) return 'unavailable';
  try {
    const perm = await PN.requestPermissions();
    return perm?.receive === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

/**
 * Registra el token FCM en el backend. El listener de `registration` debe
 * registrarse antes de llamar a `register()` porque el evento llega una vez.
 */
export function registerNativePush(
  apiBase: string,
  authToken: string,
): Promise<{ ok: boolean; reason?: string }> {
  return new Promise((resolve) => {
    const PN = plugin('PushNotifications');
    if (!PN) return resolve({ ok: false, reason: 'NOT_SUPPORTED' });

    let settled = false;
    const finish = (ok: boolean, reason?: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ ok, reason });
    };

    const timeout = window.setTimeout(() => finish(false, 'TIMEOUT'), 20000);

    let regHandler: any = null;
    let regErrHandler: any = null;
    const cleanup = () => {
      window.clearTimeout(timeout);
      try { regHandler?.remove?.(); } catch { /* noop */ }
      try { regErrHandler?.remove?.(); } catch { /* noop */ }
    };

    regHandler = PN.addListener('registration', async ({ value }: { value: string }) => {
      if (!value) return;
      try {
        const res = await fetch(`${apiBase}/notifications/fcm-token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`,
          },
          body: JSON.stringify({ token: value, platform: 'android' }),
        });
        if (res.ok) persistNativeFcmToken(value);
        finish(res.ok, res.ok ? undefined : 'SERVER_REJECTED');
      } catch {
        finish(false, 'NETWORK');
      }
    });

    regErrHandler = PN.addListener('registrationError', () => {
      finish(false, 'REGISTRATION_FAILED');
    });

    try {
      PN.register();
    } catch {
      finish(false, 'REGISTER_CALL_FAILED');
    }
  });
}

/**
 * Clave donde se guarda el último token FCM registrado en el backend.
 * Sirve para revocarlo al cerrar sesión o desactivar notificaciones.
 */
export const NATIVE_FCM_TOKEN_KEY = 'sadel.fcm_device_token';

/** Token FCM que este dispositivo tiene registrado (null si no hay). */
export function readNativeFcmToken(): string | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage.getItem(NATIVE_FCM_TOKEN_KEY);
  } catch {
    return null;
  }
}

function persistNativeFcmToken(token: string): void {
  try {
    window.localStorage.setItem(NATIVE_FCM_TOKEN_KEY, token);
  } catch {
    /* almacenamiento no disponible: la revocación queda degradada */
  }
}

export function clearNativeFcmToken(): void {
  try {
    window.localStorage.removeItem(NATIVE_FCM_TOKEN_KEY);
  } catch {
    /* noop */
  }
}

/**
 * Escucha el toque de una notificación nativa para navegar al pedido.
 * Devuelve una función de limpieza.
 */
export function onNativeNotificationTap(
  handler: (data: { orderId?: string; action?: string; section?: string }) => void,
): () => void {
  const PN = plugin('PushNotifications');
  const App = plugin('App');
  const cleanups: Array<() => void> = [];

  if (PN) {
    try {
      const h = PN.addListener('pushNotificationActionPerformed', (res: any) => {
        const data = res?.notification?.data ?? {};
        handler({
          orderId: data.orderId,
          action: data.action,
          section: data.section,
        });
      });
      cleanups.push(() => { try { h?.remove?.(); } catch { /* noop */ } });
    } catch { /* noop */ }
  }

  if (App) {
    try {
      const h = App.addListener('appUrlOpen', (res: any) => {
        try {
          const url = new URL(res?.url);
          handler({
            orderId: url.searchParams.get('orderId') ?? undefined,
            section: url.searchParams.get('section') ?? undefined,
          });
        } catch { /* noop */ }
      });
      cleanups.push(() => { try { h?.remove?.(); } catch { /* noop */ } });
    } catch { /* noop */ }
  }

  return () => cleanups.forEach((c) => c());
}

// ---------------------------------------------------------------------------
// Geolocalización nativa
// ---------------------------------------------------------------------------

/**
 * Obtiene una posición puntual usando el plugin nativo, normalizando posición
 * y errores a las interfaces DOM para reutilizar la lógica existente.
 * Devuelve `null` si no hay plugin nativo (para caer al `navigator.geolocation`).
 */
export async function nativeGetCurrentPosition(
  options: { enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number } = {},
): Promise<GeolocationPosition | null> {
  const Geo = plugin('Geolocation');
  if (!Geo) return null;

  const normalizePosition = (pos: any): GeolocationPosition => {
    return {
      coords: {
        latitude: pos?.coords?.latitude ?? 0,
        longitude: pos?.coords?.longitude ?? 0,
        accuracy: pos?.coords?.accuracy ?? 0,
        altitude: pos?.coords?.altitude ?? null,
        altitudeAccuracy: pos?.coords?.altitudeAccuracy ?? null,
        heading: pos?.coords?.heading ?? null,
        speed: pos?.coords?.speed ?? null,
      },
      timestamp: pos?.timestamp ?? Date.now(),
    } as unknown as GeolocationPosition;
  };

  const normalizeError = (err: any): GeolocationPositionError => {
    let code = 2;
    if (err?.code === 'PERMISSION_DENIED' || err?.code === 1) code = 1;
    else if (err?.code === 'TIMEOUT' || err?.code === 3) code = 3;
    return {
      code,
      message: err?.message ?? 'Error de geolocalización.',
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    } as GeolocationPositionError;
  };

  try {
    const status = await Geo.checkPermissions();
    if (status?.location === 'denied') {
      const req = await Geo.requestPermissions();
      if (req?.location !== 'granted') {
        throw normalizeError({ code: 'PERMISSION_DENIED', message: 'Permiso de ubicación denegado.' });
      }
    }
  } catch (err) {
    if (err && (err as any)?.code === 1) {
      // Permiso denegado: re-lanzar como error para que el llamador lo maneje.
      throw err;
    }
  }

  try {
    return await Geo.getCurrentPosition(
      {
        enableHighAccuracy: options.enableHighAccuracy ?? false,
        timeout: options.timeout,
        maximumAge: options.maximumAge,
      },
      (pos: any) => normalizePosition(pos),
      (err: any) => normalizeError(err),
    );
  } catch (err) {
    if (err && (err as any)?.code) throw err;
    return null;
  }
}

/**
 * Vigila la posición usando el plugin nativo, normalizando posición y errores
 * a las interfaces DOM para reutilizar la lógica existente. Devuelve `null`
 * si no hay plugin nativo (para caer al `navigator.geolocation`).
 */
export async function nativeGeoWatch(
  onPosition: (position: GeolocationPosition) => void,
  onError: (error: GeolocationPositionError) => void,
  options: { enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number } = {},
): Promise<{ clear: () => void } | null> {
  const Geo = plugin('Geolocation');
  if (!Geo) return null;

  const normalizePosition = (pos: any): GeolocationPosition => {
    return {
      coords: {
        latitude: pos?.coords?.latitude ?? 0,
        longitude: pos?.coords?.longitude ?? 0,
        accuracy: pos?.coords?.accuracy ?? 0,
        altitude: pos?.coords?.altitude ?? null,
        altitudeAccuracy: pos?.coords?.altitudeAccuracy ?? null,
        heading: pos?.coords?.heading ?? null,
        speed: pos?.coords?.speed ?? null,
      },
      timestamp: pos?.timestamp ?? Date.now(),
    } as unknown as GeolocationPosition;
  };

  const normalizeError = (err: any): GeolocationPositionError => {
    let code = 2;
    if (err?.code === 'PERMISSION_DENIED' || err?.code === 1) code = 1;
    else if (err?.code === 'TIMEOUT' || err?.code === 3) code = 3;
    return {
      code,
      message: err?.message ?? 'Error de geolocalización.',
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    } as GeolocationPositionError;
  };

  try {
    const status = await Geo.checkPermissions();
    if (status?.location === 'denied') {
      const req = await Geo.requestPermissions();
      if (req?.location !== 'granted') {
        onError(normalizeError({ code: 'PERMISSION_DENIED', message: 'Permiso de ubicación denegado.' }));
        return { clear: () => { /* noop */ } };
      }
    }
  } catch { /* noop */ }

  let callbackId: string | null = null;
  try {
    callbackId = await Geo.watchPosition(
      {
        enableHighAccuracy: options.enableHighAccuracy ?? true,
        timeout: options.timeout,
        maximumAge: options.maximumAge,
      },
      (pos: any) => onPosition(normalizePosition(pos)),
      (err: any) => onError(normalizeError(err)),
    );
  } catch {
    onError(normalizeError({ code: 'POSITION_UNAVAILABLE', message: 'No se pudo iniciar el seguimiento.' }));
    return null;
  }

  return {
    clear: () => {
      if (callbackId) {
        try { Geo.clearWatch({ id: callbackId }); } catch { /* noop */ }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Pantalla encendida (keep-awake)
// ---------------------------------------------------------------------------

/** Evita que la pantalla se apague mientras la app está abierta. */
export function nativeKeepAwake(): void {
  const K = plugin('KeepAwake');
  if (!K) return;
  try { K.keepAwake().catch(() => { /* noop */ }); } catch { /* noop */ }
}

/** Permite que la pantalla se apague de nuevo. */
export function nativeAllowSleep(): void {
  const K = plugin('KeepAwake');
  if (!K) return;
  try { K.allowSleep().catch(() => { /* noop */ }); } catch { /* noop */ }
}

// ---------------------------------------------------------------------------
// Haptics / vibración
// ---------------------------------------------------------------------------

/** Vibración nativa (fallback web: navigator.vibrate). */
export function nativeHaptic(pattern: number | number[] = 10): void {
  const H = plugin('Haptics');
  if (!H) return;
  const ms = typeof pattern === 'number' ? pattern : (pattern[0] ?? 10);
  try { H.vibrate({ duration: ms }).catch(() => { /* noop */ }); } catch { /* noop */ }
}

// ---------------------------------------------------------------------------
// Ajustes de batería (autoinicio en Xiaomi/Samsung/Huawei...)
// ---------------------------------------------------------------------------

/** Abre los ajustes de batería/autoinicio del sistema. */
export function nativeOpenBatterySettings(): void {
  const B = plugin('BatteryHelper');
  if (!B) return;
  try { B.openBatterySettings().catch(() => { /* noop */ }); } catch { /* noop */ }
}

/** Abre los ajustes de notificaciones de la app (permiso denegado). */
export function nativeOpenNotificationSettings(): void {
  const B = plugin('BatteryHelper');
  if (!B) return;
  try { B.openNotificationSettings().catch(() => { /* noop */ }); } catch { /* noop */ }
}

// ---------------------------------------------------------------------------
// Versión de la app (auto-actualización)
// ---------------------------------------------------------------------------

export type NativeAppVersion = {
  versionName: string;
  versionCode: number;
};

/**
 * Lee la versión de la app nativa instalada (Capacitor App plugin).
 * Devuelve `null` si no hay bridge nativo o el plugin no responde.
 */
export async function getNativeAppVersion(): Promise<NativeAppVersion | null> {
  const App = plugin('App');
  if (!App) return null;
  try {
    const info = await App.getInfo();
    const versionCode = Number.parseInt(String(info?.build ?? ''), 10);
    const versionName = String(info?.version ?? '');
    if (!versionName || !Number.isFinite(versionCode)) return null;
    return { versionName, versionCode };
  } catch {
    return null;
  }
}

/**
 * Consulta la versión publicada del APK del comensal.
 * Devuelve `null` si no hay release publicado o falla la petición.
 * (Implementación compartida en @sadel/shared; aquí se re-exporta para no
 * romper los importadores existentes).
 */
export { fetchPublishedAppVersion } from '@sadel/shared';
export type { PublishedAppVersion } from '@sadel/shared';