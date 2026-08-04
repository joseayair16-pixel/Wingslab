import { useState, useEffect, useCallback } from 'react';

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
      cachedVapidKey = data.publicKey;
      if (!cachedVapidKey) throw new Error('VAPID public key not returned');
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

  useEffect(() => {
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
  }, []);

  const subscribe = useCallback(async (tokenOverride?: string) => {
    try {
      if (typeof window === 'undefined' || !('Notification' in window)) {
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

      const registration = await navigator.serviceWorker.ready;

      const existingSub = await registration.pushManager.getSubscription();
      if (existingSub) {
        await existingSub.unsubscribe();
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
