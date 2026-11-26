import { useState, useEffect, useCallback } from 'react';
import {
  waitForNativeBridge,
  saveStoredPushEndpoint,
  readStoredPushEndpoint,
} from '@sadel/shared';
import { getSubscriptionSecrets } from '../lib/subscriptionSecrets';
import {
  getNativePushPermissionState,
  isNativePlatform,
  readNativeFcmToken,
  registerNativePush,
  requestNativePushPermission,
} from '../lib/native';
import { saveSubscriptionSecrets } from '../lib/subscriptionSecrets';
import { isAppleMobileBrowser } from '../lib/pushPlatform';


const API_URL = '/api';

let cachedVapidKey: string | null = null;
let vapidKeyPromise: Promise<string> | null = null;

async function fetchVapidKey(): Promise<string> {
  if (cachedVapidKey) return cachedVapidKey;
  if (vapidKeyPromise) return vapidKeyPromise;

  vapidKeyPromise = (async () => {
    try {
      const res = await fetch(`${API_URL}/notifications/vapid-key`, { signal: AbortSignal.timeout(5000) });
      const data = await res.json();
      if (!res.ok || data?.configured !== true || typeof data.publicKey !== 'string' || !data.publicKey) {
        throw new Error('Las notificaciones push no están disponibles en este momento.');
      }
      cachedVapidKey = data.publicKey as string;
      return cachedVapidKey;
    } catch (err) {
      vapidKeyPromise = null;
      throw err;
    }
  })();

  return vapidKeyPromise;
}

export async function canOfferCustomerWebPush(): Promise<boolean> {
  if (!window.isSecureContext || isNativePlatform() || getPushSupportIssue() || needsIosPwaInstall() || !('PushManager' in window)) return false;
  if (Notification.permission === 'denied') return false;
  try {
    await fetchVapidKey();
    const registration = await navigator.serviceWorker.getRegistration();
    return Boolean(registration?.active);
  } catch {
    return false;
  }
}

function isIosDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return isAppleMobileBrowser(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
}

// Web Push en iOS solo existe desde 16.4. Esto devuelve el motivo de no soporte,
// o null si las notificaciones push sí están disponibles en este dispositivo.
function getPushSupportIssue(): string | null {
  if (typeof window === 'undefined') return null;
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    return 'Este navegador no soporta notificaciones push.';
  }
  if (!isIosDevice()) return null;

  const match = /OS (\d+)(?:[_.](\d+))?/.exec(navigator.userAgent);
  if (!match) return null;
  const major = parseInt(match[1], 10);
  const minor = match[2] ? parseInt(match[2], 10) : 0;
  if (major > 16 || (major === 16 && minor >= 4)) return null;
  return 'Tu iPhone necesita iOS 16.4 o superior para recibir notificaciones. Actualiza iOS e inténtalo de nuevo.';
}

function isPwaInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  return (navigator as any).standalone === true;
}

// En iOS, Web Push SOLO existe si la PWA está instalada en la pantalla de
// inicio (aunque sea iOS 16.4+, en Safari navegador no hay pushManager).
// Si falta la instalación, no hay que intentar suscribir: hay que guiar.
function needsIosPwaInstall(): boolean {
  if (!isIosDevice()) return false;
  // A browser that exposes PushManager can attempt registration directly;
  // do not block a capable desktop browser because of an ambiguous UA.
  if ('PushManager' in window) return false;
  const match = /OS (\d+)(?:[_.](\d+))?/.exec(navigator.userAgent);
  if (match && (Number(match[1]) < 16 || (Number(match[1]) === 16 && Number(match[2] || 0) < 4))) return false;
  return !isPwaInstalled();
}

export const usePushNotifications = () => {
  const [isSubscribed, setIsSubscribed] = useState(false);
  // Estado (no valor en render) para evitar mismatch de hidratación: en SSR es null,
  // y se calcula del lado del cliente tras montar.
  const [pushSupportIssue, setPushSupportIssue] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  // iOS con Web Push soportado pero PWA sin instalar: suscribir fallaría en
  // silencio; la UI debe guiar a instalar en vez de intentar.
  const [needsIosInstall, setNeedsIosInstall] = useState(false);

  // Dentro del WebView de la app nativa NO existe web-push (service worker /
  // pushManager): las notificaciones van por FCM nativo. Este flag corta todo
  // el flujo web-push para no registrar suscripciones duplicadas en el mismo
  // dispositivo (FCM + web-push al mismo usuario).
  const isNative = typeof window !== 'undefined' && isNativePlatform();

  useEffect(() => {
    // El bridge de Capacitor se inyecta en el WebView y puede llegar DESPUÉS
    // del montaje. Sin esperar, la app decide "soy web" y se suscribe por
    // web-push dentro del APK: el token FCM nunca se registra y Android no
    // recibe nada. Se espera al bridge (con límite) antes de decidir canal.
    let cancelled = false;

    const detectNative = () => {
      // Consultar el permiso nativo sin mostrar el diálogo (FCM). Se distingue
      // denegado permanente (guiar a ajustes) de aún-no-preguntado (invitar):
      // colapsarlo todo a "no concedido" prometía activaciones imposibles.
      getNativePushPermissionState()
        .then((state) => {
          if (cancelled) return;
          setPermissionDenied(state === 'denied');
          setIsSubscribed(state === 'granted' && Boolean(readNativeFcmToken()));
        })
        .catch(() => {
          if (cancelled) return;
          setIsSubscribed(false);
        });
    };

    const detectWeb = () => {
      setPushSupportIssue(getPushSupportIssue());
      setNeedsIosInstall(needsIosPwaInstall());
      if (typeof window === 'undefined' || !('Notification' in window)) {
        // Sin API no hay permiso que evaluar (pushSupportIssue ya lo cubre).
        return;
      }
      setPermissionDenied(Notification.permission === 'denied');

      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready
          .then((registration) => registration.pushManager.getSubscription())
          .then(async (sub) => {
            if (cancelled) return;
            if (Notification.permission !== 'granted' || !sub || !localStorage.getItem('sadel.customer.token')) {
              setIsSubscribed(false);
              return;
            }
            // Reconcile with the server: a local endpoint alone does not prove
            // that this account is still registered after logout or DB changes.
            await sendSubscriptionToBackend(sub);
            // El service worker necesita el JWT y la VAPID vigentes para
            // re-suscribirse solo si el navegador rota el endpoint.
            await persistSecrets();
            if (!cancelled) setIsSubscribed(true);
          })
          .catch(() => {
            if (cancelled) return;
            setIsSubscribed(false);
          });
      }
    };

    void waitForNativeBridge({ isReady: () => isNativePlatform() }).then((bridgeReady) => {
      if (cancelled) return;
      if (bridgeReady) detectNative();
      else detectWeb();
    });

    // Si la app vuelve del segundo plano, el bridge pudo inyectarse más tarde:
    // se corrige el canal antes de asumir que es una web normal.
    const onVisible = () => {
      if (!cancelled && document.visibilityState === 'visible' && isNativePlatform()) {
        detectNative();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subscribe = useCallback(async (tokenOverride?: string) => {
    try {
      if (typeof window === 'undefined') {
        return;
      }

      if (isNativePlatform()) {
        // App nativa: pedir permiso FCM y registrar el token en el backend.
        const perm = await requestNativePushPermission();
        if (perm !== 'granted') {
          throw new Error('Permiso de notificación no concedido');
        }

        const token = tokenOverride || localStorage.getItem('sadel.customer.token') || '';
        const result = await registerNativePush(API_URL, token);
        if (result.ok) {
          setIsSubscribed(true);
          return;
        }
        throw new Error(
          result.reason === 'NOT_SUPPORTED'
            ? 'Este dispositivo no soporta notificaciones nativas.'
            : 'No se pudo registrar el token de notificaciones en el servidor.',
        );
      }

      // Apple y Chrome exigen que el primer permiso se pida desde un gesto del
      // usuario. Si este método se llama sin gesto (p. ej. al cargar la página),
      // el permiso 'default' se ignora en silencio y la suscripción nunca ocurre.
      const supportIssue = getPushSupportIssue();
      if (supportIssue || !('PushManager' in window)) {
        throw new Error(supportIssue || 'Este navegador no soporta notificaciones push.');
      }

      if (needsIosPwaInstall()) {
        throw new Error(
          'En iPhone las notificaciones solo llegan a la app instalada: toca Compartir y elige "Añadir a pantalla de inicio", luego ábrela desde tu pantalla de inicio.'
        );
      }

      if (Notification.permission === 'default') {
        await Notification.requestPermission();
      }
      if (Notification.permission !== 'granted') {
        throw new Error('Permite las notificaciones en los ajustes del navegador para activar los avisos.');
      }


      // El registro del layout puede estar todavía instalando. Esperarlo
      // brevemente evita pedir el permiso y fallar justo después.
      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>(resolve => window.setTimeout(() => resolve(null), 6000)),
      ]);
      if (!registration?.active) throw new Error('La aplicación todavía no está lista para activar las notificaciones. Inténtalo de nuevo en unos segundos.');

      // ROBUSTEZ: si ya existe una suscripción válida se REUTILIZA tal cual.
      // Nunca se desuscribe una sub válida para re-crearla: eso mata las push
      // (sobre todo en iOS) si la recreación falla a mitad.
      const existingSub = await registration.pushManager.getSubscription();
      if (existingSub) {
        await sendSubscriptionToBackend(existingSub, tokenOverride);
        setIsSubscribed(true);
        await persistSecrets(tokenOverride ?? null);
        return;
      }

      const publicKey = await fetchVapidKey();

      let sub: PushSubscription | null = null;
      let attempts = 0;
      while (!sub && attempts < 3) {
        try {
          sub = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey),
          });
        } catch (subscribeError: any) {
          attempts++;
          // AbortError: transitorio en iOS, se reintenta.
          // InvalidStateError: la clave VAPID cambió y la sub vieja quedó huérfana;
          // solo en ese caso (y no antes) se limpia y se vuelve a intentar.
          if (subscribeError?.name === 'InvalidStateError') {
            const stale = await registration.pushManager.getSubscription();
            if (stale) {
              try { await stale.unsubscribe(); } catch { /* noop */ }
            }
            await new Promise((r) => setTimeout(r, 500));
            continue;
          }
          if (subscribeError?.name === 'AbortError' && attempts < 3) {
            await new Promise((r) => setTimeout(r, 1000 * attempts));
            continue;
          }
          throw subscribeError;
        }
      }
      if (!sub) throw new Error('No se pudo crear la suscripción de notificaciones.');

      await sendSubscriptionToBackend(sub, tokenOverride);
      setIsSubscribed(true);
      await persistSecrets(tokenOverride ?? null);

    } catch (error: any) {
      if (typeof window !== 'undefined' && 'Notification' in window) {
        setPermissionDenied(Notification.permission === 'denied');
      }
      if (error?.message !== 'Permiso de notificación no concedido') {
        if (process.env.NODE_ENV !== 'production') {
          console.error('Error al suscribirse a notificaciones:', error);
        }
      }
      throw error;
    }
  }, []);

  // Cuando el navegador rota la suscripción push (pushsubscriptionchange), el service
  // worker nos avisa para volver a suscribirnos con un endpoint nuevo. El permiso ya
  // fue concedido antes, así que esto no requiere gesto del usuario.
  useEffect(() => {
    if (isNative) return;
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'PUSH_SUBSCRIPTION_CHANGED' &&
          !isNativePlatform() && window.Notification?.permission === 'granted' &&
          localStorage.getItem('sadel.customer.token')) {
        subscribe().catch(() => {});
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [isNative, subscribe]);

  // Un refresh silencioso del JWT cambia la credencial con la que el service
  // worker reportaría una rotación de suscripción. Si no se actualiza, el SW
  // sigue usando el token viejo y el backend responde 401; el re-registro muere.
  useEffect(() => {
    if (isNative) return;
    const onTokenRefreshed = (event: Event) => {
      const nextToken = (event as CustomEvent<string>).detail;
      if (!nextToken) return;
      void (async () => {
        const secrets = await getSubscriptionSecrets();
        if (secrets?.token === nextToken) return;
        await persistSecrets(nextToken);
        if (window.Notification?.permission === 'granted' &&
            localStorage.getItem('sadel.customer.token') === nextToken) {
          await subscribe(nextToken).catch(() => {});
        }
      })();
    };
    window.addEventListener('sadel:token-refreshed', onTokenRefreshed);
    return () => window.removeEventListener('sadel:token-refreshed', onTokenRefreshed);
  }, [isNative, subscribe]);

  return { isSubscribed, pushSupportIssue, needsIosInstall, permissionDenied, subscribe };
};

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function sendSubscriptionToBackend(subscription: PushSubscription, tokenOverride?: string) {
  const keys = subscription.toJSON().keys;
  if (!keys?.p256dh || !keys.auth) throw new Error('La suscripción de este dispositivo no es válida.');

  const token = tokenOverride || (typeof window !== 'undefined' ? localStorage.getItem('sadel.customer.token') : null);
  if (!token) throw new Error('Inicia sesión para activar las notificaciones.');

  const response = await fetch(`${API_URL}/notifications/subscribe`, {
    method: 'POST',
    signal: AbortSignal.timeout(8000),
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      endpoint: subscription.endpoint,
      keys: {
        p256dh: keys.p256dh,
        auth: keys.auth,
      },
    }),
  });

  if (!response.ok) {
    throw new Error('Fallo al guardar la suscripción en el backend');
  }

  saveStoredPushEndpoint('sadel.customer', subscription.endpoint);
}

// Guarda en IndexedDB el token y la VAPID public key para que el service worker
// pueda re-suscribirse por sí solo en pushsubscriptionchange, aunque la app esté
// cerrada. fetchVapidKey está cachead a nivel de módulo, así que esto es barato
// después del primer llamado.
async function persistSecrets(token?: string | null) {
  const t = token || (typeof window !== 'undefined' ? localStorage.getItem('sadel.customer.token') : null);
  if (!t) return;
  try {
    const vapidKey = await fetchVapidKey();
    await saveSubscriptionSecrets({ token: t, vapidKey });
  } catch {
    // El fallo al persistir no debe romper la suscripción principal.
  }
}
