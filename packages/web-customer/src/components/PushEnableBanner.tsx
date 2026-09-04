'use client';
import { BellRing, X } from 'lucide-react';
import { useState } from 'react';

import {
  isNativePlatform,
  nativeOpenBatterySettings,
  nativeOpenNotificationSettings,
} from '../lib/native';

const STORAGE_KEY = 'sadel-customer-push-banner-dismissed';

type Props = {
  visible: boolean;
  isSubscribed: boolean;
  permission: NotificationPermission;
  pushSupportIssue: string | null;
  needsIosInstall?: boolean;
  onEnable: () => Promise<void>;
};

export default function PushEnableBanner({
  visible,
  isSubscribed,
  permission,
  pushSupportIssue,
  needsIosInstall = false,
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
      <div className="fixed inset-0 z-[9991] flex items-end justify-center p-0 max-sm:items-end sm:items-center sm:p-4">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-md" />
        <div className="relative w-full max-w-md overflow-hidden rounded-t-[32px] rounded-b-none bg-white p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-[0_32px_64px_-12px_rgba(0,0,0,0.18)] sm:rounded-[32px] sm:pb-6">
          <button
            type="button"
            onClick={() => {
              window.localStorage.setItem(STORAGE_KEY, 'true');
              setDismissed(true);
            }}
            aria-label="Cerrar"
            className="absolute right-5 top-5 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-600 transition hover:bg-neutral-200 active:scale-95"
          >
            <X className="h-5 w-5" strokeWidth={2.5} />
          </button>

          <div className="flex flex-col items-center pt-2 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-amber-100 text-3xl">
              🔕
            </div>
            <h3 className="mt-5 text-2xl font-bold tracking-[-0.03em] text-neutral-950">
              Notificaciones desactivadas
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-neutral-500">
              Para volver a recibir el estado de tus pedidos y avisos de tu repartidor,
              actívalas desde los ajustes del sistema.
            </p>

            <div className="mt-6 grid w-full gap-3">
              <button
                type="button"
                onClick={() => {
                  if (isNativePlatform()) {
                    nativeOpenNotificationSettings();
                  } else {
                    window.localStorage.setItem(STORAGE_KEY, 'true');
                    setDismissed(true);
                  }
                }}
                className="w-full rounded-2xl bg-[#0a0a0a] py-3.5 text-sm font-semibold text-[#ffffff] transition-all duration-200 hover:bg-[#262626] hover:shadow-[0_8px_24px_rgba(10,10,10,0.12)] active:scale-[0.98]"
              >
                {isNativePlatform() ? 'Abrir ajustes del sistema' : 'Entendido'}
              </button>
              <button
                type="button"
                onClick={() => {
                  window.localStorage.setItem(STORAGE_KEY, 'true');
                  setDismissed(true);
                }}
                className="w-full rounded-2xl border border-black/[0.08] bg-white py-3.5 text-sm font-semibold text-[#171717] transition-all duration-200 hover:bg-neutral-50 active:scale-[0.98] shadow-sm"
              >
                Ahora no
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (pushSupportIssue) return null;

  // iPhone sin la PWA instalada: Web Push no existe aunque iOS sea ≥16.4.
  // No intentamos suscribir (fallaría sin aviso): guiamos a instalar.
  if (needsIosInstall) {
    return (
      <div className="fixed inset-0 z-[9991] flex items-end justify-center p-0 max-sm:items-end sm:items-center sm:p-4">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-md" />
        <div className="relative w-full max-w-md overflow-hidden rounded-t-[32px] rounded-b-none bg-white p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-[0_32px_64px_-12px_rgba(0,0,0,0.18)] sm:rounded-[32px] sm:pb-6">
          <button
            type="button"
            onClick={() => {
              window.localStorage.setItem(STORAGE_KEY, 'true');
              setDismissed(true);
            }}
            aria-label="Cerrar"
            className="absolute right-5 top-5 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-600 transition hover:bg-neutral-200 active:scale-95"
          >
            <X className="h-5 w-5" strokeWidth={2.5} />
          </button>

          <div className="flex flex-col items-center pt-2 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-sky-100">
              <BellRing className="h-8 w-8 text-sky-600" strokeWidth={2} />
            </div>
            <h3 className="mt-5 text-2xl font-bold tracking-[-0.03em] text-neutral-950">
              Un paso más en tu iPhone
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-neutral-500">
              En iPhone las notificaciones solo llegan a la app instalada. Es un paso de 10 segundos:
            </p>

            <ol className="mt-5 w-full space-y-3 text-left">
              <li className="flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-bold text-sky-600">1</span>
                <span className="text-sm font-medium text-neutral-700">
                  Toca el botón <span className="font-bold">Compartir</span> de Safari (el cuadro con la flecha hacia arriba)
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-bold text-sky-600">2</span>
                <span className="text-sm font-medium text-neutral-700">
                  Elige <span className="font-bold">“Añadir a pantalla de inicio”</span>
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-bold text-sky-600">3</span>
                <span className="text-sm font-medium text-neutral-700">
                  Abre SaDeL desde tu pantalla de inicio y activa las notificaciones
                </span>
              </li>
            </ol>

            <div className="mt-7 grid w-full gap-3">
              <button
                type="button"
                onClick={() => {
                  window.localStorage.setItem(STORAGE_KEY, 'true');
                  setDismissed(true);
                }}
                className="w-full rounded-2xl bg-[#0a0a0a] py-3.5 text-sm font-semibold text-[#ffffff] transition-all duration-200 hover:bg-[#262626] active:scale-[0.98]"
              >
                Entendido
              </button>
              <button
                type="button"
                onClick={() => {
                  window.localStorage.setItem(STORAGE_KEY, 'true');
                  setDismissed(true);
                }}
                className="py-2 text-xs font-semibold text-neutral-500 transition hover:text-neutral-800"
              >
                Ahora no
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (permission !== 'default' && permission !== 'granted') return null;

  return (
    <div className="fixed inset-0 z-[9991] flex items-end justify-center p-0 max-sm:items-end sm:items-center sm:p-4 animate-[fadeIn_0.2s_ease-out]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md" />
      <div className="relative w-full max-w-md overflow-hidden rounded-t-[32px] rounded-b-none bg-white p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-[0_32px_64px_-12px_rgba(0,0,0,0.18)] sm:rounded-[32px] sm:pb-6 animate-[slideUp_0.3s_cubic-bezier(0.16,1,0.3,1)] max-sm:animate-[slideUp_0.3s_cubic-bezier(0.16,1,0.3,1)]">
        <button
          type="button"
          onClick={() => {
            window.localStorage.setItem(STORAGE_KEY, 'true');
            setDismissed(true);
          }}
          aria-label="Cerrar"
          className="absolute right-5 top-5 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-600 transition hover:bg-neutral-200 active:scale-95"
        >
          <X className="h-5 w-5" strokeWidth={2.5} />
        </button>

        <div className="flex flex-col items-center pt-2 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-sky-100">
            <BellRing className="h-8 w-8 text-sky-600" strokeWidth={2} />
          </div>
          <h3 className="mt-5 text-2xl font-bold tracking-[-0.03em] text-neutral-950">
            No te pierdas nada
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-neutral-500">
            Activa las notificaciones para enterarte al instante de lo que pasa
            con tu pedido.
          </p>

          <ul className="mt-5 w-full space-y-3 text-left">
            <li className="flex items-start gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-600">
                ✓
              </span>
              <span className="text-sm font-medium text-neutral-700">
                Estado de tu pedido en tiempo real
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-600">
                ✓
              </span>
              <span className="text-sm font-medium text-neutral-700">
                Cuándo llega tu repartidor
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-600">
                ✓
              </span>
              <span className="text-sm font-medium text-neutral-700">
                Mensajes del restaurante o la tienda
              </span>
            </li>
          </ul>

          {errorMessage && (
            <p className="mt-4 w-full rounded-2xl bg-red-50 px-4 py-2.5 text-xs font-semibold text-red-600">
              {errorMessage}
            </p>
          )}

          <div className="mt-7 grid w-full gap-3">
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
              className="w-full rounded-2xl bg-[#0a0a0a] py-3.5 text-sm font-semibold text-[#ffffff] transition-all duration-200 hover:bg-[#262626] hover:shadow-[0_8px_24px_rgba(10,10,10,0.12)] disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 disabled:shadow-none active:scale-[0.98]"
            >
              {busy ? 'Activando...' : 'Activar notificaciones'}
            </button>
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => {
                  window.localStorage.setItem(STORAGE_KEY, 'true');
                  setDismissed(true);
                }}
                className="py-2 text-xs font-semibold text-neutral-500 transition hover:text-neutral-800"
              >
                Ahora no
              </button>
              {isNativePlatform() && (
                <span className="text-neutral-300">·</span>
              )}
              {isNativePlatform() && (
                <button
                  type="button"
                  onClick={() => nativeOpenBatterySettings()}
                  className="py-2 text-xs font-semibold text-neutral-500 transition hover:text-neutral-800"
                >
                  🔋 Revisar batería
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
