'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

interface DismissState {
  dismissCount: number;
  lastDismissedAt: number;
}

// Estado persistente (por navegador): no es un descarte permanente, sino con backoff.
const STORAGE_KEY = 'sadel-install-prompt-state';
// Sesión actual (por pestaña): páginas visitadas para medir engagement.
const SESSION_KEY = 'sadel-install-session-views';

// Backoff exponencial por cantidad de descartes (ms).
const COOLDOWNS_MS = [
  15 * 60 * 1000, // 1°: vuelve a los 15 min
  3 * 60 * 60 * 1000, // 2°: 3 horas
  24 * 60 * 60 * 1000, // 3°: 24 horas
  7 * 24 * 60 * 60 * 1000, // 4°: 7 días
  30 * 24 * 60 * 60 * 1000, // 5°+: 30 días (prácticamente nunca)
];

// Cuántas páginas debe visitar en la sesión para que el banner vuelva solo.
const ENGAGED_PAGE_VIEWS = 3;
// Delay en el home para no interrumpir la primera impresión.
const HOME_DELAY_MS = 3000;
// Ver un menú de restaurante = alta intención: ahí siempre puede re-aparecer.
const MENU_PATH_RE = /^\/restaurantes\/[^/]+$/;

function isIosDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  const iOS = /iPhone|iPad|iPod/i.test(ua);
  // iPadOS 13+ se reporta como Mac, pero Safari en modo tablet lo detecta por touch
  const iPadOS13 = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return iOS || iPadOS13;
}

function readDismissState(): DismissState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { dismissCount: 0, lastDismissedAt: 0 };
    const parsed = JSON.parse(raw) as DismissState;
    if (
      typeof parsed.dismissCount === 'number' &&
      typeof parsed.lastDismissedAt === 'number'
    ) {
      return parsed;
    }
  } catch {
    // estado corrupto o previo al cambio (era 'true'/'false'): se reinicia.
  }
  return { dismissCount: 0, lastDismissedAt: 0 };
}

function readSessionViews(): number {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export default function InstallAppButton() {
  const pathname = usePathname();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [visible, setVisible] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSHelp, setShowIOSHelp] = useState(false);
  const [dismissState, setDismissState] = useState<DismissState>(() =>
    typeof window === 'undefined' ? { dismissCount: 0, lastDismissedAt: 0 } : readDismissState(),
  );
  const [sessionViews, setSessionViews] = useState(() =>
    typeof window === 'undefined' ? 0 : readSessionViews(),
  );
  const deferredPromptRef = useRef(deferredPrompt);
  deferredPromptRef.current = deferredPrompt;

  // Cuenta páginas visitadas en esta pestaña (engagement real).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setSessionViews((prev) => {
      const next = prev + 1;
      try {
        window.sessionStorage.setItem(SESSION_KEY, String(next));
      } catch {
        // privacidad/sin sesión: ignorar
      }
      return next;
    });
  }, [pathname]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mq = window.matchMedia('(display-mode: standalone)');
    setIsStandalone(mq.matches);
    const onChange = (event: MediaQueryListEvent) => setIsStandalone(event.matches);
    mq.addEventListener?.('change', onChange);

    setIsIOS(isIosDevice());

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
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

  // Decisión "inteligente" de cuándo mostrar el banner.
  useEffect(() => {
    if (isStandalone) {
      setVisible(false);
      return;
    }

    const cooldownIdx = Math.min(dismissState.dismissCount, COOLDOWNS_MS.length - 1);
    if (Date.now() - dismissState.lastDismissedAt < COOLDOWNS_MS[cooldownIdx]) {
      // La descartó hace poco: no molestar.
      setVisible(false);
      return;
    }

    // Alta intención: está viendo el menú de un restaurante.
    if (MENU_PATH_RE.test(pathname ?? '')) {
      setVisible(true);
      return;
    }

    // Sigue navegando: ya visitó varias páginas, se lo volvemos a ofrecer.
    if (sessionViews >= ENGAGED_PAGE_VIEWS) {
      setVisible(true);
      return;
    }

    // Usuario nuevo (nunca la descartó): ofrecer en el home, tras un breve delay.
    if (dismissState.dismissCount === 0) {
      const timer = setTimeout(() => setVisible(true), HOME_DELAY_MS);
      return () => clearTimeout(timer);
    }

    setVisible(false);
  }, [isStandalone, dismissState, sessionViews, pathname]);

  const handleAndroidInstall = async () => {
    if (!deferredPromptRef.current) return;
    await deferredPromptRef.current.prompt();
    const { outcome } = await deferredPromptRef.current.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
      setIsStandalone(true);
    } else {
      handleDismiss();
    }
  };

  const handleDismiss = () => {
    const next: DismissState = {
      dismissCount: dismissState.dismissCount + 1,
      lastDismissedAt: Date.now(),
    };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // sin persistencia: solo ocultar en esta sesión
    }
    setDismissState(next);
    setVisible(false);
    setShowIOSHelp(false);
  };

  // Un CTA flotante está ocupando la parte baja (ej: "Ver carrito", FAB del repartidor).
  // En ese caso cedemos el espacio: el banner no debe tapar acciones importantes.
  const [bottomCtaVisible, setBottomCtaVisible] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onChange = (event: Event) => {
      setBottomCtaVisible((event as CustomEvent<boolean>).detail === true);
    };
    window.addEventListener('sadel:bottom-cta', onChange);
    return () => window.removeEventListener('sadel:bottom-cta', onChange);
  }, []);

  // Ya instalada, en cooldown, sin razón para mostrarse, o hay un CTA debajo.
  if (isStandalone || !visible || bottomCtaVisible) return null;

  // Android/Chrome: solo mostrar si el navegador ofrece instalación.
  // iOS: no existe beforeinstallprompt, así que siempre mostramos la guía.
  const showBanner = isIOS || Boolean(deferredPrompt);
  if (!showBanner) return null;

  return (
    <>
      <div className="fixed inset-x-0 bottom-4 z-[9990] flex justify-center px-4 pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center gap-2.5 rounded-full border border-black/5 bg-white py-2 pl-3 pr-2 shadow-[0_12px_40px_-8px_rgba(15,15,15,0.25)]">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-100 text-sky-600">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
          </span>
          <span className="text-sm font-semibold text-neutral-900">Instala SaDeL</span>
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
            className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {isIOS && showIOSHelp && (
        <div className="fixed inset-0 z-[9995] flex items-end justify-center bg-black/45 px-4 pb-8 sm:items-center sm:pb-0">
          <div className="w-full max-w-sm rounded-[28px] bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-neutral-900">Instalar SaDeL en tu iPhone</h3>
              <button
                type="button"
                onClick={() => setShowIOSHelp(false)}
                aria-label="Cerrar"
                className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <p className="mb-4 text-sm leading-relaxed text-neutral-600">
              Apple no permite instalar apps desde el navegador automáticamente. Sigue estos pasos y la tendrás en tu pantalla de inicio en 10 segundos:
            </p>
            <ol className="space-y-3 text-sm">
              <li className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-bold text-sky-700">1</span>
                <span className="leading-relaxed text-neutral-700">
                  Toca el botón <span className="font-semibold text-neutral-900">Compartir</span>{' '}
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-neutral-100 text-[10px] font-bold text-neutral-700">⤴</span>{' '}
                  (abajo en Safari).
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-bold text-sky-700">2</span>
                <span className="leading-relaxed text-neutral-700">
                  Desplázate y toca <span className="font-semibold text-neutral-900">Añadir a pantalla de inicio</span>.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-bold text-sky-700">3</span>
                <span className="leading-relaxed text-neutral-700">
                  Toca <span className="font-semibold text-neutral-900">Añadir</span> arriba a la derecha. ¡Listo!
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
