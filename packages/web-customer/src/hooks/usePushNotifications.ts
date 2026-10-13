import { useState, useEffect, useCallback } from 'react';
import {
  waitForNativeBridge,
  revokeDevicePush,
  saveStoredPushEndpoint,
  readStoredPushEndpoint,
  clearStoredPushEndpoint,
} from '@sadel/shared';
import {
  clearNativeFcmToken,
  getNativePushPermissionState,
  isNativePlatform,
  readNativeFcmToken,
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
  if (getPushSupportIssue()) return false; // ya hay otro motivo (browser/versión)
  return !isPwaInstalled();
}

export const usePushNotifications = () => {
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  // Estado (no valor en render) para evitar mismatch de hidratación: en SSR es null,
  // y se calcula del lado del cliente tras montar.
  const [pushSupportIssue, setPushSupportIssue] = useState<string | null>(null);
  // iOS con Web Push soportado pero PWA sin instalar: suscribir fallaría en
  // silencio; la UI debe guiar a instalar en vez de intentar.
  const [needsIosInstall, setNeedsIosInstall] = useState(false);
  // Detección asentada (permiso + suscripción consultados). Hasta entonces la
  // UI no debe invitar: evita el parpadeo de aparecer y desaparecer.
  const [pushReady, setPushReady] = useState(false);

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
          if (state === 'granted') {
            setPermission('granted');
            setIsSubscribed(true);
          } else if (state === 'denied') {
            setPermission('denied');
            setIsSubscribed(false);
          } else {
            setPermission('default');
            setIsSubscribed(false);
          }
        })
        .catch(() => {
          if (cancelled) return;
          setPermission('default');
          setIsSubscribed(false);
        })
        .finally(() => {
          if (!cancelled) setPushReady(true);
        });
    };

    const detectWeb = () => {
      setPushSupportIssue(getPushSupportIssue());
      setNeedsIosInstall(needsIosPwaInstall());
      if (typeof window === 'undefined' || !('Notification' in window)) {
        // Sin API no hay permiso que evaluar (pushSupportIssue ya lo cubre).
        setPushReady(true);
        return;
      }

      setPermission(Notification.permission);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready
          .then((registration) => registration.pushManager.getSubscription())
          .then((sub) => {
            if (cancelled) return;
            setSubscription(sub);
            setIsSubscribed(!!sub);
          })
          .catch(() => {
            if (cancelled) return;
            setIsSubscribed(false);
          })
          .finally(() => {
            if (!cancelled) setPushReady(true);
          });
      } else {
        setPushReady(true);
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

      if (needsIosInstall) {
        throw new Error(
          'En iPhone las notificaciones solo llegan a la app instalada: toca Compartir y elige "Añadir a pantalla de inicio", luego ábrela desde tu pantalla de inicio.'
        );
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

  const unsubscribe = async (options?: { isLogout?: boolean }) => {
    const isLogout = options?.isLogout ?? false;

    // Solo si el usuario opta explícitamente por desactivar notificaciones
    // (no en logout) se persiste el opt-out local: cerrar sesión no debe
    // silenciar al próximo usuario de este dispositivo.
    if (!isLogout) {
      try { localStorage.setItem('sadel.push_optout', 'true'); } catch { /* noop */ }
    }

    // Capturar credencial e identificadores ANTES de cualquier await: en
    // logout el llamador limpia el almacenamiento local en el mismo tick y la
    // revocación debe seguir usando el JWT de ESTA sesión, para que el backend
    // solo borre filas de este usuario (aunque la petición llegue tarde, no
    // puede tocar las filas que registre el próximo usuario de este dispositivo).
    let jwt: string | null = null;
    try {
      jwt = localStorage.getItem('sadel.customer.token');
    } catch {
      jwt = null;
    }
    const deviceToken = isNative ? readNativeFcmToken() : null;
    const endpoint = !isNative
      ? ((subscription as PushSubscription)?.endpoint || readStoredPushEndpoint('sadel.customer'))
      : null;

    // Los secretos (JWT + VAPID) se borran SIEMPRE, también en logout: si
    // quedan en el IndexedDB del service worker, el SW puede re-suscribir y
    // RE-REGISTRAR en el backend la sesión recién cerrada (pushsubscriptionchange
    // con reintentos), reviviendo sus notificaciones, y deja un JWT aún válido
    // guardado en el dispositivo. Borrarlos no desuscribe la suscripción del
    // navegador: en el próximo login la auto-sincronización vuelve a guardarlos.
    await clearSubscriptionSecrets();

    // Revoca las filas del backend para que este dispositivo deje de recibir
    // los avisos del usuario actual al cerrar sesión o desactivar notificaciones.
    const revokeOnServer = async () => {
      await revokeDevicePush({
        apiBase: API_URL,
        jwt,
        fcmToken: deviceToken,
        endpoint,
        timeoutMs: 3500,
      });
    };

    if (isNative) {
      await revokeOnServer();
      clearNativeFcmToken();
      setIsSubscribed(false);
      return;
    }

    if (subscription) {
      if (!isLogout) {
        try {
          await subscription.unsubscribe();
        } catch {}
      }
      setSubscription(null);
      setIsSubscribed(false);
      await revokeOnServer();
      clearStoredPushEndpoint('sadel.customer');
    } else {
      await revokeOnServer();
      clearStoredPushEndpoint('sadel.customer');
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

  // Si el usuario cambia el permiso desde los ajustes del navegador/sitio, la
  // UI debe enterarse sin recargar: el modal desaparece y la re-sincronización
  // (que observa `permission`) registra la suscripción sin pedir nada.
  useEffect(() => {
    if (isNative) return;
    if (typeof window === 'undefined') return;
    try {
      const permissions = (navigator as any)?.permissions;
      if (!permissions || typeof permissions.query !== 'function') return;
      let status: any = null;
      let cancelled = false;
      permissions
        .query({ name: 'notifications' })
        .then((s: any) => {
          if (cancelled) return;
          status = s;
          s.onchange = () => {
            if (cancelled) return;
            const next = (s.state ?? 'default') as NotificationPermission;
            setPermission(next);
          };
        })
        .catch(() => {});
      return () => {
        cancelled = true;
        try {
          if (status) status.onchange = null;
        } catch {
          /* noop */
        }
      };
    } catch {
      /* Permissions API no disponible */
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { isSubscribed, subscription, permission, pushSupportIssue, needsIosInstall, pushReady, subscribe, unsubscribe };
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
