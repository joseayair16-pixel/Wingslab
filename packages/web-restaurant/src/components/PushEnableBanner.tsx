'use client';
import { X } from 'lucide-react';

import { useEffect, useState } from 'react';

import { getNativePushPermissionState, isNativePlatform, nativeOpenBatterySettings, readNativeFcmToken } from '../lib/native';

type EnableStatus = 'DENIED' | 'BLOCKED' | 'INSECURE' | 'NOT_SUPPORTED' | 'VAPID_NOT_CONFIGURED' | 'SUBSCRIBE_FAILED' | 'UNKNOWN';

type EnableResult =
  | { ok: true }
  | { ok: false; reason: EnableStatus };

type Props = {
  visible: boolean;
  onEnable: () => Promise<EnableResult>;
};

function isIosDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  const iOS = /iPhone|iPad|iPod/i.test(ua);
  const iPadOS13 = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return iOS || iPadOS13;
}

function getIosTooOld(): boolean {
  if (!isIosDevice()) return false;
  const match = /OS (\d+)(?:[_.](\d+))?/.exec(navigator.userAgent);
  if (!match) return false;
  const major = parseInt(match[1], 10);
  const minor = match[2] ? parseInt(match[2], 10) : 0;
  return !(major > 16 || (major === 16 && minor >= 4));
}

const STORAGE_KEY = 'wingslab-push-banner-dismissed';

const REASON_MESSAGES: Record<EnableStatus, string> = {
  DENIED: 'Rechazaste el permiso de notificaciones. Actívalo en los ajustes del navegador para no perder pedidos.',
  BLOCKED: 'Notificaciones bloqueadas en este sitio. Actívalas en los ajustes del navegador.',
  INSECURE: 'Estás entrando por HTTP. Abre el panel con https:// para poder activar las notificaciones.',
  NOT_SUPPORTED: 'Este navegador no soporta notificaciones push.',
  VAPID_NOT_CONFIGURED: 'Las notificaciones del servidor no están configuradas. Contacta al soporte de wingslab.',
  SUBSCRIBE_FAILED: 'No se pudo completar la suscripción. Inténtalo de nuevo en unos segundos.',
  UNKNOWN: 'Ocurrió un error al activar las notificaciones. Inténtalo de nuevo.',
};

export default function PushEnableBanner({ visible, onEnable }: Props) {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [subscribed, setSubscribed] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Estado de permiso/suscripción + listener de rotación de suscripción del SW
  useEffect(() => {
    const refresh = () => {
      // App nativa (Capacitor): el push es FCM, no hay suscripción web. Si el
      // permiso nativo ya está concedido, la app ya está activa: se oculta el
      // banner en vez de volver a pedir activación en cada entrada.
      // Se distingue "aún no preguntado" (prompt → botón Activar con el diálogo
      // del sistema) de "denegado permanente" (denied → instrucciones de Ajustes,
      // porque Android ya no vuelve a mostrar el diálogo).
      if (isNativePlatform()) {
        void getNativePushPermissionState()
          .then((state) => {
            if (state === 'granted' && !!readNativeFcmToken()) {
              setPermission('granted');
              setSubscribed(true);
            } else if (state === 'granted') {
              // El permiso de Android no prueba que FCM esté registrado en el
              // servidor. Mantén visible la activación hasta tener token local.
              setPermission('granted');
              setSubscribed(false);
            } else if (state === 'prompt') {
              setPermission('default');
              setSubscribed(false);
            } else {
              setPermission('denied');
              setSubscribed(false);
            }
          })
          .catch(() => {
            // Fallo temporal del bridge no equivale a permiso denegado: deja
            // una acción recuperable en vez de mandar al usuario a Settings.
            setPermission('default');
            setSubscribed(false);
          })
          .finally(() => setInitialized(true));
        return;
      }

      if (typeof window === 'undefined' || !('Notification' in window)) {
        setPermission('denied');
        setInitialized(true);
        return;
      }

      setPermission(Notification.permission);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready
          .then((reg) => reg.pushManager.getSubscription())
          .then((sub) => setSubscribed(!!sub))
          .catch(() => {})
          .finally(() => setInitialized(true));
      } else {
        setInitialized(true);
      }
    };

    refresh();

    // El descarte del banner expira a las 24h: si el restaurante cerró el banner
    // sin activar, se le vuelve a ofrecer en lugar de quedar sin notificaciones
    // para siempre (en Android es común perdérselo tras instalar la PWA).
    const dismissedAtRaw = window.localStorage.getItem(STORAGE_KEY);
    if (dismissedAtRaw) {
      const dismissedAt = parseInt(dismissedAtRaw, 10);
      const isExpired = !Number.isFinite(dismissedAt) || Date.now() - dismissedAt > 24 * 60 * 60 * 1000;
      if (isExpired) {
        setDismissed(false);
      } else {
        setDismissed(true);
      }
    }

    const onMessage = (event: MessageEvent) => {
      // El navegador rotó la suscripción push: re-suscribir con un endpoint nuevo
      if (event.data?.type === 'PUSH_SUBSCRIPTION_CHANGED') {
        void (async () => {
          const result = await onEnable();
          if (result.ok) setSubscribed(true);
        })();
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);

    // Re-evaluar al volver a primer plano (Android no dispara eventos de permiso).
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      navigator.serviceWorker.removeEventListener('message', onMessage);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const insecureContext = typeof window !== 'undefined' && window.isSecureContext === false;

  if (!visible || !initialized || dismissed || busy) return null;
  if (subscribed) return null;
  if (permission === 'denied') {
    return (
      <div className="fixed inset-x-0 top-0 z-[9991] bg-amber-50 px-4 py-2.5 text-center text-xs font-medium text-amber-800 shadow-sm border-b border-amber-100">
        <div className="mx-auto flex max-w-5xl items-center justify-center gap-2">
          <p className="flex-1">
            {isNativePlatform()
              ? 'Notificaciones bloqueadas en la app. Actívalas en: Ajustes → Aplicaciones → wingslab → Notificaciones.'
              : 'Notificaciones bloqueadas. Para activarlas: toca el ícono 🔒 (o ℹ️) junto a la URL y habilita «Notificaciones» en Chrome / «Permisos → Notificaciones» en Safari.'}
          </p>
          <button
            type="button"
            onClick={() => {
              window.localStorage.setItem(STORAGE_KEY, String(Date.now()));
              setDismissed(true);
            }}
            aria-label="Descartar"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-amber-400 transition hover:bg-amber-100 hover:text-amber-600"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }
  if (permission !== 'default' && permission !== 'granted') return null;

  const iosTooOld = getIosTooOld();

  return (
    <div className="fixed inset-x-0 top-0 z-[9991] bg-sky-600 px-4 py-2.5 text-white shadow-md">
      <div className="mx-auto flex max-w-5xl flex-col gap-1">
        {insecureContext && (
          <p className="text-[11px] font-semibold text-sky-100">
            ⚠️ Nota: estás en una conexión no segura (HTTP). Abre el panel con https:// para que las
            notificaciones puedan activarse.
          </p>
        )}
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold leading-snug sm:text-sm">
            🔔 {iosTooOld
              ? 'Tu iPhone necesita iOS 16.4+ para recibir notificaciones. Actualiza iOS.'
              : 'Activa las notificaciones para no perderte ningún pedido.'}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {isNativePlatform() && (
              <button
                type="button"
                onClick={() => nativeOpenBatterySettings()}
                className="rounded-full bg-white/15 px-3.5 py-1.5 text-xs font-bold text-white transition hover:bg-white/25 active:scale-95"
              >
                🔋 Batería
              </button>
            )}
            {!iosTooOld && (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setErrorMessage(null);
                  try {
                    const result = await onEnable();
                    if (result.ok) {
                      setSubscribed(true);
                    } else if (isNativePlatform() && result.reason === 'DENIED') {
                      // En la APK el diálogo del sistema ya no apareció (denegado
                      // permanente): la única vía es Ajustes del sistema.
                       setErrorMessage('El permiso quedó bloqueado. Actívalo en: Ajustes → Aplicaciones → wingslab → Notificaciones, y vuelve a entrar.');
                    } else {
                      setErrorMessage(REASON_MESSAGES[result.reason]);
                    }
                  } catch {
                    setErrorMessage(REASON_MESSAGES.UNKNOWN);
                  } finally {
                    setBusy(false);
                  }
                }}
                className="rounded-full bg-white px-3.5 py-1.5 text-xs font-bold text-sky-700 transition hover:bg-sky-50 active:scale-95 disabled:opacity-60"
              >
                {busy ? 'Activando...' : 'Activar'}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                window.localStorage.setItem(STORAGE_KEY, String(Date.now()));
                setDismissed(true);
              }}
              aria-label="Descartar"
              className="flex h-6 w-6 items-center justify-center rounded-full text-white/70 transition hover:bg-white/15 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        {errorMessage && (
          <p className="text-[11px] font-semibold text-amber-100">{errorMessage}</p>
        )}
      </div>
    </div>
  );
}
