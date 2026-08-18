'use client';
import { X } from 'lucide-react';
import { useState } from 'react';

import { isNativePlatform, nativeOpenBatterySettings } from '../lib/native';

const STORAGE_KEY = 'sadel-customer-push-banner-dismissed';

type Props = {
  visible: boolean;
  isSubscribed: boolean;
  permission: NotificationPermission;
  pushSupportIssue: string | null;
  onEnable: () => Promise<void>;
};

export default function PushEnableBanner({
  visible,
  isSubscribed,
  permission,
  pushSupportIssue,
  onEnable,
}: Props) {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  });
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!visible || dismissed || busy || isSubscribed) return null;

  // En la app nativa el permiso llega vía FCM (no Notification API), pero el
  // hook ya lo expone normalizado: 'granted' / 'default' / 'denied'.
  if (permission === 'denied') {
    return (
      <div className="fixed inset-x-0 top-0 z-[9991] bg-amber-50 px-4 py-2.5 text-center text-xs font-medium text-amber-800 shadow-sm border-b border-amber-100">
        {isNativePlatform()
          ? 'Notificaciones desactivadas. Actívalas desde los Ajustes del sistema → Apps → SaDeL.'
          : 'Notificaciones bloqueadas. Para activarlas: toca el ícono 🔒 (o ℹ️) junto a la URL y habilita «Notificaciones».'}
      </div>
    );
  }

  if (pushSupportIssue) return null;
  if (permission !== 'default' && permission !== 'granted') return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[9991] bg-sky-600 px-4 py-2.5 text-white shadow-md">
      <div className="mx-auto flex max-w-5xl flex-col gap-1">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold leading-snug sm:text-sm">
            🔔 Activa las notificaciones para no perderte el estado de tus pedidos y a tu repartidor.
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
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setErrorMessage(null);
                try {
                  await onEnable();
                } catch (err: any) {
                  setErrorMessage(err?.message || 'No se pudieron activar las notificaciones. Inténtalo de nuevo.');
                } finally {
                  setBusy(false);
                }
              }}
              className="rounded-full bg-white px-3.5 py-1.5 text-xs font-bold text-sky-700 transition hover:bg-sky-50 active:scale-95 disabled:opacity-60"
            >
              {busy ? 'Activando...' : 'Activar'}
            </button>
            <button
              type="button"
              onClick={() => {
                window.localStorage.setItem(STORAGE_KEY, 'true');
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