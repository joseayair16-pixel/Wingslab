'use client';
import { X } from 'lucide-react';

import { useEffect, useState } from 'react';
import { Lock, Info, ArrowRight, AlertTriangle, Bell } from 'lucide-react';

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

const STORAGE_KEY = 'sadel-push-banner-dismissed';

const REASON_MESSAGES: Record<EnableStatus, string> = {
  DENIED: 'Rechazaste el permiso de notificaciones. Actívalo en los ajustes del navegador para no perder pedidos.',
  BLOCKED: 'Notificaciones bloqueadas en este sitio. Actívalas en los ajustes del navegador.',
  INSECURE: 'Estás entrando por HTTP. Abre el panel con https:// para poder activar las notificaciones.',
  NOT_SUPPORTED: 'Este navegador no soporta notificaciones push.',
  VAPID_NOT_CONFIGURED: 'Las notificaciones del servidor no están configuradas. Contacta al restaurante.',
  SUBSCRIBE_FAILED: 'No se pudo completar la suscripción. Inténtalo de nuevo en unos segundos.',
  UNKNOWN: 'Ocurrió un error al activar las notificaciones. Inténtalo de nuevo.',
};

export default function PushEnableBanner({ visible, onEnable }: Props) {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [subscribed, setSubscribed] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
        void (async () => {
          const result = await onEnable();
          if (result.ok) setSubscribed(true);
        })();
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const insecureContext = typeof window !== 'undefined' && window.isSecureContext === false;

  if (!visible || dismissed || busy) return null;
  if (subscribed) return null;
  if (permission === 'denied') {
    return (
      <div className="fixed inset-x-0 top-0 z-[9991] bg-amber-50 px-4 py-2.5 text-center text-xs font-medium text-amber-800 shadow-sm border-b border-amber-100">
        Notificaciones bloqueadas. Para activarlas: toca el ícono <Lock className="h-5 w-5" /> (o <Info className="h-5 w-5" />) junto a la URL y habilita
        «Notificaciones» en Chrome / «Permisos <ArrowRight className="h-5 w-5" /> Notificaciones» en Safari.
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
            <AlertTriangle className="h-5 w-5" /> Nota: estás en una conexión no segura (HTTP). Abre el panel con https:// para que las
            notificaciones puedan activarse.
          </p>
        )}
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold leading-snug sm:text-sm">
            <Bell className="h-5 w-5" /> {iosTooOld
              ? 'Tu iPhone necesita iOS 16.4+ para recibir notificaciones. Actualiza iOS.'
              : 'Activa las notificaciones para no perderte ningún pedido.'}
          </p>
          <div className="flex shrink-0 items-center gap-2">
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
                    } else {
                      setErrorMessage(REASON_MESSAGES[result.reason]);
                    }
                  } catch {
                    setErrorMessage(REASON_MESSAGES.UNKNOWN);
                  } finally {
                    setBusy(false);
                  }
                }}
                className="rounded-full bg-surface px-3.5 py-1.5 text-xs font-bold text-sky-700 transition hover:bg-sky-50 active:scale-95 disabled:opacity-60"
              >
                {busy ? 'Activando...' : 'Activar'}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                window.localStorage.setItem(STORAGE_KEY, 'true');
                setDismissed(true);
              }}
              aria-label="Descartar"
              className="flex h-6 w-6 items-center justify-center rounded-full text-white/70 transition hover:bg-surface/15 hover:text-white"
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