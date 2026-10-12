// Adaptador nativo para la app Android (Capacitor).
//
// El panel web se sirve igual en el navegador y dentro del WebView de la app.
// Este módulo detecta el bridge de Capacitor y usa sus plugins (FCM, GPS
// nativo, haptics, keep-awake, impresión); fuera del WebView todo se degrada
// al comportamiento web estándar, de modo que la PWA no cambia.

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

// ---------------------------------------------------------------------------
// Push / FCM
// ---------------------------------------------------------------------------

/** Estado del permiso de notificaciones nativo (sin pedir el diálogo). */
export async function checkNativePushPermission(): Promise<boolean> {
  const PN = plugin('PushNotifications');
  if (!PN) return false;
  try {
    const res = await PN.checkPermissions();
    return res?.receive === 'granted';
  } catch {
    return false;
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
 *
 * Se envía también el `versionCode` nativo: el backend lo usa para saber si el
 * dispositivo soporta la alarma continua por Foreground Service (y, si no,
 * seguir enviando la notificación normal).
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
          body: JSON.stringify({
            token: value,
            platform: 'android',
            ...(await nativeAppVersion()),
          }),
        });
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

/** `versionCode` del APK en ejecución (null si no se puede leer). */
async function nativeAppVersion(): Promise<{ appVersion?: number }> {
  try {
    const App = plugin('App');
    if (!App?.getInfo) return {};
    const info = await App.getInfo();
    const build = Number.parseInt(String(info?.build ?? ''), 10);
    if (!Number.isFinite(build) || build < 0) return {};
    return { appVersion: build };
  } catch {
    return {};
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
// Alarma continua de pedidos
// ---------------------------------------------------------------------------

/**
 * ¿El APK incluye el plugin de alarma continua (Foreground Service)? Los APKs
 * antiguos no lo tienen: en ese caso se conserva el bucle de audio web para no
 * perder el aviso.
 */
export function hasNativeOrderAlarm(): boolean {
  return Boolean(plugin('OrderAlarm'));
}

/**
 * Silencia la alarma nativa del pedido. Si no se indica `orderId` se detiene
 * toda. Es un no-op en navegador y en APKs sin el plugin.
 */
export function stopNativeOrderAlarm(orderId?: string): void {
  const Alarm = plugin('OrderAlarm');
  if (!Alarm) return;
  try {
    const promise = orderId ? Alarm.stop({ orderId }) : Alarm.stop({});
    if (promise?.catch) promise.catch(() => { /* noop */ });
  } catch { /* noop */ }
}

/**
 * ¿El panel nativo está en segundo plano (app cerrada, minimizada o con la
 * pantalla apagada)?
 *
 * El WebView sigue ejecutando JavaScript con la app en segundo plano, así que
 * los sonidos que reproduce la web se oirían junto a la notificación del
 * sistema, que ya suena con su propio canal. Cuando esto es `true` el sonido lo
 * pone Android y la web debe callarse para que solo se oiga una vez.
 */
export function isNativeAppInBackground(): boolean {
  if (!isNativePlatform()) return false;
  if (typeof document === 'undefined') return true;
  return document.visibilityState !== 'visible';
}

// ---------------------------------------------------------------------------
// Geolocalización nativa
// ---------------------------------------------------------------------------

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
// Impresión nativa
// ---------------------------------------------------------------------------

/**
 * Imprime un documento HTML usando el diálogo nativo de Android (PrintManager).
 * Retorna `false` si no hay plugin nativo disponible.
 */
export async function nativePrintHtml(html: string): Promise<boolean> {
  const P = plugin('Printer');
  if (!P) return false;
  try {
    await P.printHtml({ name: 'SaDeL Comanda', html });
    return true;
  } catch {
    return false;
  }
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

// ---------------------------------------------------------------------------
// Versión de la app instalada (para el banner de actualización)
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
