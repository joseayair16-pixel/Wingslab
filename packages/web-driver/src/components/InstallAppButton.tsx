'use client';
import { X } from 'lucide-react';

import { useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const STORAGE_KEY = 'sadel-install-prompt-dismissed';

function isIosDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  const iOS = /iPhone|iPad|iPod/i.test(ua);
  // iPadOS 13+ se reporta como Mac, pero Safari en modo tablet lo detecta por touch
  const iPadOS13 = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return iOS || iPadOS13;
}

export default function InstallAppButton() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSHelp, setShowIOSHelp] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'true') setIsDismissed(true);

    const mq = window.matchMedia('(display-mode: standalone)');
    setIsStandalone(mq.matches);
    const onChange = (event: MediaQueryListEvent) => setIsStandalone(event.matches);
    mq.addEventListener?.('change', onChange);

    setIsIOS(isIosDevice());

    // No se intercepta beforeinstallprompt: Chrome avisa si se llama
    // preventDefault() sin prompt() inmediato. Se usa el banner nativo.
    const onBeforeInstallPrompt = (event: Event) => {
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

    return () => {
      mq.removeEventListener?.('change', onChange);
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const handleAndroidInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
      setIsStandalone(true);
    } else {
      window.localStorage.setItem(STORAGE_KEY, 'true');
      setIsDismissed(true);
    }
  };

  const handleDismiss = () => {
    window.localStorage.setItem(STORAGE_KEY, 'true');
    setIsDismissed(true);
    setShowIOSHelp(false);
  };

  // Un CTA flotante está ocupando la parte baja: cedemos el espacio.
  const [bottomCtaVisible, setBottomCtaVisible] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onChange = (event: Event) => {
      setBottomCtaVisible((event as CustomEvent<boolean>).detail === true);
    };
    window.addEventListener('sadel:bottom-cta', onChange);
    return () => window.removeEventListener('sadel:bottom-cta', onChange);
  }, []);

  // Ya instalada, o el usuario ya la descartó, o hay un CTA debajo.
  if (isStandalone || isDismissed || bottomCtaVisible) return null;

  // Android/Chrome: solo mostrar si el navegador ofrece instalación.
  // iOS: no existe beforeinstallprompt, así que siempre mostramos la guía.
  const showBanner = isIOS || Boolean(deferredPrompt);
  if (!showBanner) return null;

  return (
    <>
      <div className="fixed inset-x-0 bottom-4 z-[9990] flex justify-center px-4 pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center gap-2.5 rounded-full border border-black/5 bg-surface py-2 pl-3 pr-2 shadow-[0_12px_40px_-8px_rgba(15,15,15,0.25)]">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-100 text-sky-600">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
          </span>
          <span className="text-sm font-semibold text-foreground">Instala WingsLab Reparto</span>
          <button
            type="button"
            onClick={isIOS ? () => setShowIOSHelp(true) : () => void handleAndroidInstall()}
            className="rounded-full bg-neutral-950 px-4 py-2 text-xs font-bold text-white transition hover:bg-neutral-800 active:scale-95"
          >
            Instalar
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Descartar"
            className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition hover:bg-surface-2 hover:text-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {isIOS && showIOSHelp && (
        <div className="fixed inset-0 z-[9995] flex items-end justify-center bg-black/45 px-4 pb-8 sm:items-center sm:pb-0">
          <div className="w-full max-w-sm rounded-[28px] bg-surface p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-foreground">Instalar WingsLab Reparto en tu iPhone</h3>
              <button
                type="button"
                onClick={() => setShowIOSHelp(false)}
                aria-label="Cerrar"
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-4 text-sm leading-relaxed text-muted">
              Apple no permite instalar apps desde el navegador automáticamente. Sigue estos pasos y la tendrás en tu pantalla de inicio en 10 segundos:
            </p>
            <ol className="space-y-3 text-sm">
              <li className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-bold text-sky-700">1</span>
                <span className="leading-relaxed text-foreground">
                  Toca el botón <span className="font-semibold text-foreground">Compartir</span>{' '}
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-surface-2 text-[10px] font-bold text-foreground"><ArrowUpRight className="h-5 w-5" /></span>{' '}
                  (abajo en Safari).
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-bold text-sky-700">2</span>
                <span className="leading-relaxed text-foreground">
                  Desplázate y toca <span className="font-semibold text-foreground">Añadir a pantalla de inicio</span>.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-bold text-sky-700">3</span>
                <span className="leading-relaxed text-foreground">
                  Toca <span className="font-semibold text-foreground">Añadir</span> arriba a la derecha. ¡Listo!
                </span>
              </li>
            </ol>
            <button
              type="button"
              onClick={() => setShowIOSHelp(false)}
              className="mt-6 w-full rounded-full bg-neutral-950 py-3 text-sm font-bold text-white transition hover:bg-neutral-800 active:scale-[0.98]"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </>
  );
}
