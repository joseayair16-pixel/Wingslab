'use client';

// Carga y espera de la librería de Google Maps de forma centralizada y robusta.
//
// Problema que resuelve: el layout carga el script de Maps con `loading=async`
// y, en paralelo, algunos componentes (DriverTurnByTurnOverlay) pueden inyectar
// un segundo script. Cuando dos cargas con parámetros distintos compiten, Google
// reinicia `google.maps` en caliente y puede haber un instante en el que
// `google.maps` existe pero `google.maps.Map` todavía no está definido. Los
// checks clásicos `if (!google?.maps)` no cubren ese caso y provocan
// `TypeError: google.maps.Map is not a constructor`.
//
// Este helper espera de verdad a que `google.maps.Map` sea un constructor
// utilizable y comparte una única promesa entre todos los consumidores.

const MAPS_POLL_INTERVAL_MS = 150;
const MAPS_TIMEOUT_MS = 15_000;

type GoogleMaps = any;

function hasMapConstructor(): boolean {
  if (typeof window === 'undefined') return false;
  const google = (window as any).google;
  return Boolean(google?.maps?.Map && typeof google.maps.Map === 'function');
}

export function getGoogleMaps(): GoogleMaps | null {
  if (typeof window === 'undefined') return null;
  return hasMapConstructor() ? (window as any).google : null;
}

// Espera hasta que `google.maps.Map` esté disponible. Nunca rechaza: si se
// agota el tiempo, resuelve `null` para que el consumidor decida cómo degradar.
export function waitForGoogleMaps(timeoutMs: number = MAPS_TIMEOUT_MS): Promise<GoogleMaps | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);

  const existing = getGoogleMaps();
  if (existing) return Promise.resolve(existing);

  const cacheKey = `sadel:maps-ready:${timeoutMs}`;
  const cached = (window as any)[cacheKey] as Promise<GoogleMaps | null> | undefined;
  if (cached) return cached;

  const promise = new Promise<GoogleMaps | null>((resolve) => {
    const start = Date.now();

    const tick = () => {
      const google = getGoogleMaps();
      if (google) {
        resolve(google);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        resolve(null);
        return;
      }
      setTimeout(tick, MAPS_POLL_INTERVAL_MS);
    };

    tick();
  });

  try {
    (window as any)[cacheKey] = promise;
    void promise.then(() => { if ((window as any)[cacheKey] === promise) delete (window as any)[cacheKey]; });
  } catch {
    // sin acceso a window global (tests/SSR): no cachear
  }

  return promise;
}

// Fuerza la carga del script de Maps si el layout todavía no lo incluyó.
// Reutiliza un script existente y evita inyectar duplicados con parámetros
// distintos que reinicien `google.maps`.
let mapsScriptPromise: Promise<GoogleMaps | null> | null = null;

export function ensureGoogleMapsScript(apiKey?: string): Promise<GoogleMaps | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);

  const existing = getGoogleMaps();
  if (existing) return Promise.resolve(existing);
  if (mapsScriptPromise) return mapsScriptPromise;

  const existingScript = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
  if (existingScript) {
    mapsScriptPromise = waitForGoogleMaps().then((google) => {
      if (!google) mapsScriptPromise = null;
      return google;
    });
    return mapsScriptPromise;
  }

  mapsScriptPromise = (async () => {
    let key = apiKey?.trim() || '';
    if (!key) {
      try {
        const response = await fetch('/wingslab-google-maps-config', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
        if (!response.ok) return null;
        const config = await response.json();
        if (config.enabled !== true || typeof config.apiKey !== 'string') return null;
        key = config.apiKey.trim();
      } catch {
        return null;
      }
    }
    if (!key) return null;
    return new Promise<GoogleMaps | null>((resolve) => {
      let settled = false;
      let timer: number | undefined;
      const finish = (value: GoogleMaps | null) => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) window.clearTimeout(timer);
        if (!value) {
          script.remove();
          mapsScriptPromise = null;
        }
        script.onerror = null;
        resolve(value);
      };

      const previousCallback = (window as any).__onSadelMapsLoaded;
      (window as any).__onSadelMapsLoaded = () => {
        if (typeof previousCallback === 'function') previousCallback();
        finish(getGoogleMaps());
      };
      const previousAuthFailure = (window as any).gm_authfailure;
      (window as any).gm_authfailure = () => {
        if (typeof previousAuthFailure === 'function') previousAuthFailure();
        finish(null);
      };

      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=__onSadelMapsLoaded&loading=async`;
      script.async = true;
      script.defer = true;
      script.dataset.sadelMaps = '1';
      script.onerror = () => finish(null);
      timer = window.setTimeout(() => finish(null), 12_000);
      document.head.appendChild(script);
    });
  })().then((google) => {
    if (!google) mapsScriptPromise = null;
    return google;
  });

  return mapsScriptPromise;
}
