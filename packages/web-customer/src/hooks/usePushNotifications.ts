import { useState, useEffect, useCallback } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

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

export const usePushNotifications = () => {
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>('default');

  useEffect(() => {
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

      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      setSubscription(sub);
      setIsSubscribed(true);

      await sendSubscriptionToBackend(sub, tokenOverride);

    } catch (error: any) {
      if (error?.message !== 'Permiso de notificación no concedido') {
        console.error('Error al suscribirse a notificaciones:', error);
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

  return { isSubscribed, permission, subscribe, unsubscribe };
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
