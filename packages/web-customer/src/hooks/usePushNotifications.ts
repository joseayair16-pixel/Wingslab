import { useState, useEffect, useCallback } from 'react';
import {
  checkNativePushPermission,
  isNativePlatform,
  registerNativePush,
  requestNativePushPermission,
} from '../lib/native';
import {
  saveSubscriptionSecrets,
  clearSubscriptionSecrets,
} from '../lib/subscriptionSecrets';

const API_URL = '/api';

let cachedVapidKey: string | null = null;
let vapidKeyPromise: Promise<string> | null = null;

async function fetchVapidKey(): Promise<string> {
  if (cachedVapidKey) return cachedVapidKey;
  if (vapidKeyPromise) return vapidKeyPromise;

  vapidKeyPromise = (async () => {
    try {
      const res = await fetch(`${API_URL}/notifications/vapid-key`);
      const data = await res.json();
      cachedVapidKey = data?.publicKey || null;
      if (!cachedVapidKey || data?.configured === false) {
        throw new Error('VAPID public key not returned');
      }
      return cachedVapidKey;
    } catch (err) {
      vapidKeyPromise = null;
      throw err;
    }
  })();

  return vapidKeyPromise;
}

function isIosDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  const iOS = /iPhone|iPad|iPod/i.test(ua);
  const iPadOS13 = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return iOS || iPadOS13;
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

export const usePushNotifications = () => {
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  // Estado (no valor en render) para evitar mismatch de hidratación: en SSR es null,
  // y se calcula del lado del cliente tras montar.
  const [pushSupportIssue, setPushSupportIssue] = useState<string | null>(null);

  // Dentro del WebView de la app nativa NO existe web-push (service worker /
  // pushManager): las notificaciones van por FCM nativo. Este flag corta todo
  // el flujo web-push para no registrar suscripciones duplicadas en el mismo
  // dispositivo (FCM + web-push al mismo usuario).
  const isNative = typeof window !== 'undefined' && isNativePlatform();

  useEffect(() => {
    if (isNative) {
      // Consultar el permiso nativo sin mostrar el diálogo (FCM).
      checkNativePushPermission().then((granted) => {
        setPermission(granted ? 'granted' : 'default');
        setIsSubscribed(granted);
      });
      return;
    }
    setPushSupportIssue(getPushSupportIssue());
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPermission(Notification.permission);
      
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then((registration) => {
          registration.pushManager.getSubscription().then((sub) => {
            setSubscription(sub);
            setIsSubscribed(!!sub);
          });
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subscribe = useCallback(async (tokenOverride?: string) => {
    try {
      if (typeof window === 'undefined') {
        return;
      }

      if (isNative) {
        // App nativa: pedir permiso FCM y registrar el token en el backend.
        const perm = await requestNativePushPermission();
        if (perm !== 'granted') {
          setPermission('default');
          throw new Error('Permiso de notificación no concedido');
        }
        setPermission('granted');
        try { localStorage.removeItem('sadel.push_optout'); } catch { /* noop */ }

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

      if (!('Notification' in window)) {
        return;
      }

      // Apple y Chrome exigen que el primer permiso se pida desde un gesto del
      // usuario. Si este método se llama sin gesto (p. ej. al cargar la página),
      // el permiso 'default' se ignora en silencio y la suscripción nunca ocurre.
      if (pushSupportIssue) {
        throw new Error(pushSupportIssue);
      }

      if (Notification.permission === 'default') {
        try {
          const permission = await Notification.requestPermission();
          setPermission(permission);
          if (permission !== 'granted') {
            return;
          }
        } catch {
          return;
        }
      }
      if (Notification.permission !== 'granted') {
        return;
      }

      // El usuario optó explícitamente por desactivarlas desde su perfil; al
      // suscribirse de nuevo (gesto) se limpia esa bandera.
      try { localStorage.removeItem('sadel.push_optout'); } catch { /* noop */ }

      const registration = await navigator.serviceWorker.ready;

      // ROBUSTEZ: si ya existe una suscripción válida se REUTILIZA tal cual.
      // Nunca se desuscribe una sub válida para re-crearla: eso mata las push
      // (sobre todo en iOS) si la recreación falla a mitad.
      const existingSub = await registration.pushManager.getSubscription();
      if (existingSub) {
        setSubscription(existingSub);
        setIsSubscribed(true);
        await sendSubscriptionToBackend(existingSub, tokenOverride);
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
      if (!sub) return;

      setSubscription(sub);
      setIsSubscribed(true);

      await sendSubscriptionToBackend(sub, tokenOverride);
      await persistSecrets(tokenOverride ?? null);

    } catch (error: any) {
      if (error?.message !== 'Permiso de notificación no concedido') {
        if (process.env.NODE_ENV !== 'production') {
          console.error('Error al suscribirse a notificaciones:', error);
        }
      }
      throw error;
    }
  }, []);

  const unsubscribe = async () => {
    // Marca el opt-out para que la auto-re-sincronización no lo vuelva a
    // suscribir en segundo plano: solo se reactiva con un gesto explícito.
    try { localStorage.setItem('sadel.push_optout', 'true'); } catch { /* noop */ }
    // Elimina el token/VAPID de IndexedDB para que el service worker tampoco
    // intente re-suscribirse en segundo plano tras el opt-out.
    await clearSubscriptionSecrets();
    if (isNative) {
      // La app nativa no puede "des-suscribir" el token FCM del dispositivo:
      // basta con el opt-out local para que el re-sync no lo vuelva a registrar.
      setIsSubscribed(false);
      return;
    }
    if (subscription) {
      await subscription.unsubscribe();
      setSubscription(null);
      setIsSubscribed(false);
    }
  };

  // Cuando el navegador rota la suscripción push (pushsubscriptionchange), el service
  // worker nos avisa para volver a suscribirnos con un endpoint nuevo. El permiso ya
  // fue concedido antes, así que esto no requiere gesto del usuario.
  useEffect(() => {
    if (isNative) return;
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'PUSH_SUBSCRIPTION_CHANGED') {
        subscribe().catch(() => {});
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [subscribe]);

  return { isSubscribed, permission, pushSupportIssue, subscribe, unsubscribe };
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
  if (!keys) return;

  const token = tokenOverride || (typeof window !== 'undefined' ? localStorage.getItem('sadel.customer.token') : null);

  const response = await fetch(`${API_URL}/notifications/subscribe`, {
    method: 'POST',
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
