import { fetchWithTimeout } from './fetchWithTimeout';

export type RevokeTarget = { kind: 'fcm'; token: string } | { kind: 'web'; endpoint: string };

export type RevokePushRegistrationsParams = {
  apiBase: string;
  jwt: string;
  target: RevokeTarget | null;
  timeoutMs?: number;
};

/**
 * Revoca en el backend el registro push de este dispositivo (token FCM o
 * suscripción Web Push) para que deje de recibir los avisos del usuario
 * actual al cerrar sesión o desactivar notificaciones.
 *
 * Garantías:
 *  - Siempre se resuelve (nunca rechaza): un fallo de red, un abort o el
 *    timeout solo significan "no se pudo revocar ahora". El logout continúa.
 *  - Cada llamada lleva su propio AbortController y su propio temporizador:
 *    dos revocaciones consecutivas no se bloquean entre sí.
 *  - El `jwt` y los identificadores se fijan al invocar (no se releen tarde),
 *    y el backend solo borra filas del propio `sub`: aunque una revocación
 *    de la sesión anterior llegara tarde, no puede borrar los registros de
 *    una sesión nueva (no habría coincidencia de `userId`).
 *  - No registra nada: ni tokens, ni endpoints, ni identificadores.
 */
export async function revokePushRegistrations({
  apiBase,
  jwt,
  target,
  timeoutMs = 5000,
}: RevokePushRegistrationsParams): Promise<{ attempted: boolean }> {
  if (!jwt || !target) return { attempted: false };

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${jwt}`,
  };

  try {
    if (target.kind === 'fcm') {
      await fetchWithTimeout(`${apiBase}/notifications/fcm-token`, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ token: target.token }),
        timeoutMs,
      });
    } else {
      await fetchWithTimeout(`${apiBase}/notifications/subscription`, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ endpoint: target.endpoint }),
        timeoutMs,
      });
    }
    return { attempted: true };
  } catch {
    // Best-effort: la red falló, se abortó o se agotó el tiempo. El logout
    // (o la desactivación) continúa; el registro se reasigna al próximo login.
    return { attempted: true };
  }
}
