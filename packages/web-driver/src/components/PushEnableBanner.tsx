'use client';

import { useEffect, useState } from 'react';

type Props = {
  visible: boolean;
  onEnable: () => Promise<void>;
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

const STORAGE_KEY = 'sadel-push-banner-dismissed';

export default function PushEnableBanner({ visible, onEnable }: Props) {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [subscribed, setSubscribed] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  // Estado de permiso/suscripción + listener de rotación de suscripción del SW
  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;

    const refresh = () => {
      setPermission(Notification.permission);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready
          .then((reg) => reg.pushManager.getSubscription())
          .then((sub) => setSubscribed(!!sub))
          .catch(() => {});
      }
    };

    refresh();
    if (window.localStorage.getItem(STORAGE_KEY) === 'true') setDismissed(true);

    const onMessage = (event: MessageEvent) => {
      // El navegador rotó la suscripción push: re-suscribir con un endpoint nuevo
      if (event.data?.type === 'PUSH_SUBSCRIPTION_CHANGED') {
        void onEnable().catch(() => {});
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!visible || dismissed || busy) return null;
  if (subscribed) return null;
  if (permission === 'denied') {
    return (
      <div className="fixed inset-x-0 top-0 z-[9991] bg-amber-50 px-4 py-2.5 text-center text-xs font-medium text-amber-800 shadow-sm border-b border-amber-100">
        Notificaciones bloqueadas en el navegador. Actívalas en los ajustes del dispositivo para no perder pedidos.
      </div>
    );
  }
  if (permission !== 'default' && permission !== 'granted') return null;

  const iosTooOld = getIosTooOld();

  return (
    <div className="fixed inset-x-0 top-0 z-[9991] bg-sky-600 px-4 py-2.5 text-white shadow-md">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
        <p className="text-xs font-semibold leading-snug sm:text-sm">
          🔔 {iosTooOld
            ? 'Tu iPhone necesita iOS 16.4+ para recibir notificaciones. Actualiza iOS.'
            : 'Activa las notificaciones para no perderte ningún pedido.'}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {!iosTooOld && (
            <button
              type="button"
              onClick={() => { void onEnable().then(() => setBusy(false)); setBusy(true); }}
              className="rounded-full bg-white px-3.5 py-1.5 text-xs font-bold text-sky-700 transition hover:bg-sky-50 active:scale-95"
            >
              Activar
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              window.localStorage.setItem(STORAGE_KEY, 'true');
              setDismissed(true);
            }}
            aria-label="Descartar"
            className="flex h-6 w-6 items-center justify-center rounded-full text-white/70 transition hover:bg-white/15 hover:text-white"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
