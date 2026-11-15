'use client';
import { Smartphone, X } from 'lucide-react';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { fetchPublishedAppVersion, isNativePlatform } from '../lib/native';
import IOSInstallGuide from './IOSInstallGuide';

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
  const [isAndroid, setIsAndroid] = useState(false);
  const [apkUrl, setApkUrl] = useState<string | null>(null);
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

    // Android en navegador (no dentro de la app nativa): ofrecer el APK nativo.
    const ua = navigator.userAgent;
    setIsAndroid(/Android/i.test(ua));
    if (/Android/i.test(ua) && !isNativePlatform()) {
      fetchPublishedAppVersion('/api')
        .then((v) => { if (v?.url) setApkUrl(v.url); })
        .catch(() => { /* sin APK publicado: seguir con PWA */ });
    }

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
    const prompt = deferredPromptRef.current;
    if (!prompt) return;
    deferredPromptRef.current = null;
    setDeferredPrompt(null);
    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === 'dismissed') handleDismiss();
    } catch {
      setDeferredPrompt(null);
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

  // Ya instalada (PWA standalone o app nativa), en cooldown, sin razón para
  // mostrarse, o hay un CTA debajo.
  if (isStandalone || isNativePlatform() || !visible || bottomCtaVisible) return null;

  // Android: mostrar si hay APK nativo publicado o si el navegador ofrece PWA.
  // iOS: no existe beforeinstallprompt, así que siempre mostramos la guía.
  const showBanner = isIOS || Boolean(deferredPrompt) || (isAndroid && apkUrl !== null);
  if (!showBanner) return null;

  // En Android, la app nativa es la opción principal; la PWA queda de
  // respaldo si el APK no está publicado todavía.
  const androidNative = isAndroid && apkUrl !== null;
  const handleAndroidAction = () => {
    if (androidNative) {
      window.location.href = apkUrl!;
      return;
    }
    void handleAndroidInstall();
  };

  return (
    <>
      <div className="fixed inset-x-0 bottom-4 z-[9990] flex justify-center px-4 pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center gap-2.5 rounded-full border border-black/5 bg-white py-2 pl-3 pr-2 shadow-[0_12px_40px_-8px_rgba(15,15,15,0.25)]">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-100 text-sky-600">
            {androidNative ? (
              <Smartphone className="h-5 w-5" />
            ) : (
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
            )}
          </span>
          <span className="text-sm font-semibold text-neutral-900">
            {androidNative ? 'WingsLab local' : 'Instala WingsLab'}
          </span>
          <button
            type="button"
            onClick={isIOS ? () => setShowIOSHelp(true) : handleAndroidAction}
            className="rounded-full bg-neutral-950 px-4 py-2 text-xs font-bold text-white transition hover:bg-neutral-800 active:scale-95"
          >
            {androidNative ? 'Descargar' : 'Instalar'}
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Descartar"
            className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {isIOS && showIOSHelp && (
        <div className="fixed inset-0 z-[9995] flex items-end justify-center bg-black/45 px-4 pb-8 sm:items-center sm:pb-0" role="dialog" aria-modal="true" aria-label="Instalar SaDeL en iPhone o iPad">
          <div className="max-h-[85dvh] w-full max-w-sm overflow-y-auto rounded-[28px] bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-neutral-900">Instalar WingsLab en tu iPhone</h3>
              <button
                type="button"
                onClick={() => setShowIOSHelp(false)}
                aria-label="Cerrar"
                className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <IOSInstallGuide />
            <button
              type="button"
              onClick={() => setShowIOSHelp(false)}
              className="mt-4 w-full rounded-full bg-neutral-950 py-3 text-sm font-bold text-white transition hover:bg-neutral-800 active:scale-[0.98]"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </>
  );
}
