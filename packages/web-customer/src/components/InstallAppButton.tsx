'use client';
import { Smartphone, X } from 'lucide-react';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import IOSInstallGuide from './IOSInstallGuide';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

interface DismissState {
  dismissCount: number;
  lastDismissedAt: number;
}

// Web/PWA only: the customer interface has no native APK or native shell.
const STORAGE_KEY = 'wingslab-install-prompt-state';
const SESSION_KEY = 'wingslab-install-session-views';
const COOLDOWNS_MS = [
  15 * 60 * 1000,
  3 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
  7 * 24 * 60 * 60 * 1000,
  30 * 24 * 60 * 60 * 1000,
];
const ENGAGED_PAGE_VIEWS = 3;
const HOME_DELAY_MS = 3000;
const MENU_PATH_RE = /^\/restaurantes\/[^/]+$/;

function isIosDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  const iOS = /iPhone|iPad|iPod/i.test(ua);
  const iPadOS13 = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return iOS || iPadOS13;
}

function readDismissState(): DismissState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { dismissCount: 0, lastDismissedAt: 0 };
    const parsed = JSON.parse(raw) as DismissState;
    if (typeof parsed.dismissCount === 'number' && typeof parsed.lastDismissedAt === 'number') return parsed;
  } catch {
    // estado corrupto o previo al cambio: se reinicia.
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
  const [iosBrowser, setIosBrowser] = useState<'safari' | 'chrome'>('safari');
  const [showIOSHelp, setShowIOSHelp] = useState(false);
  const [dismissState, setDismissState] = useState<DismissState>(() =>
    typeof window === 'undefined' ? { dismissCount: 0, lastDismissedAt: 0 } : readDismissState(),
  );
  const [sessionViews, setSessionViews] = useState(() =>
    typeof window === 'undefined' ? 0 : readSessionViews(),
  );
  const deferredPromptRef = useRef(deferredPrompt);
  deferredPromptRef.current = deferredPrompt;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setSessionViews((prev) => {
      const next = prev + 1;
      try { window.sessionStorage.setItem(SESSION_KEY, String(next)); } catch { /* ignorar */ }
      return next;
    });
  }, [pathname]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(display-mode: standalone)');
    setIsStandalone(mq.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
    const onChange = (event: MediaQueryListEvent) => setIsStandalone(event.matches);
    mq.addEventListener?.('change', onChange);

    setIsIOS(isIosDevice());
    const ua = navigator.userAgent;
    setIosBrowser(/CriOS/i.test(ua) ? 'chrome' : 'safari');

    const onBeforeInstallPrompt = (event: Event) => {
      // Intencional: sin preventDefault Chrome muestra su mini-infobar y el
      // evento se consume una sola vez. Lo guardamos para lanzar prompt() desde
      // el botón «Instalar» de la app (el aviso de Chrome es informativo).
      event.preventDefault();
      deferredPromptRef.current = event as BeforeInstallPromptEvent;
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      deferredPromptRef.current = null;
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

  useEffect(() => {
    if (isStandalone) {
      setVisible(false);
      return;
    }
    const cooldownIdx = Math.min(dismissState.dismissCount, COOLDOWNS_MS.length - 1);
    if (Date.now() - dismissState.lastDismissedAt < COOLDOWNS_MS[cooldownIdx]) {
      setVisible(false);
      return;
    }
    if (MENU_PATH_RE.test(pathname ?? '')) {
      setVisible(true);
      return;
    }
    if (sessionViews >= ENGAGED_PAGE_VIEWS) {
      setVisible(true);
      return;
    }
    if (dismissState.dismissCount === 0) {
      const timer = setTimeout(() => setVisible(true), HOME_DELAY_MS);
      return () => clearTimeout(timer);
    }
    setVisible(false);
  }, [isStandalone, dismissState, sessionViews, pathname]);

  const handleInstall = async () => {
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
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* sin persistencia */ }
    setDismissState(next);
    setVisible(false);
    setShowIOSHelp(false);
  };

  // Un CTA flotante ocupa la parte baja: el banner cede el espacio.
  const [bottomCtaVisible, setBottomCtaVisible] = useState(false);
  useEffect(() => {
    const onChange = (event: Event) => setBottomCtaVisible((event as CustomEvent<boolean>).detail === true);
    window.addEventListener('sadel:bottom-cta', onChange);
    return () => window.removeEventListener('sadel:bottom-cta', onChange);
  }, []);

  if (isStandalone || !visible || bottomCtaVisible) return null;
  // iOS uses manual instructions; other browsers need an installation prompt.
  const showBanner = isIOS || Boolean(deferredPrompt);
  if (!showBanner) return null;

  const openIOSGuide = () => {
    const ua = navigator.userAgent;
    setIosBrowser(/CriOS/i.test(ua) ? 'chrome' : 'safari');
    setShowIOSHelp(true);
  };

  return (
    <>
      <div className="wl-install-banner fixed inset-x-0 bottom-4 z-[9990] flex justify-center px-4 pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center gap-2.5 rounded-full border border-black/5 bg-white py-2 pl-3 pr-2 shadow-[0_12px_40px_-8px_rgba(15,15,15,0.25)]">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-100 text-sky-600">
            <Smartphone className="h-5 w-5" />
          </span>
          <span className="text-sm font-semibold text-neutral-900">Instala WingsLab</span>
          <button
            type="button"
            onClick={isIOS ? openIOSGuide : () => void handleInstall()}
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
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {isIOS && showIOSHelp && (
        <div className="fixed inset-0 z-[9995] flex items-end justify-center bg-black/45 px-4 pb-8 sm:items-center sm:pb-0" role="dialog" aria-modal="true" aria-label="Instalar WingsLab en iPhone o iPad">
          <div className="max-h-[85dvh] w-full max-w-sm overflow-y-auto rounded-[28px] bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-lg font-bold text-neutral-900">Instalar WingsLab</h3>
              <button type="button" onClick={() => setShowIOSHelp(false)} aria-label="Cerrar" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mb-4 grid grid-cols-2 gap-2 rounded-2xl bg-neutral-100 p-1" role="group" aria-label="Navegador que estás usando">
              <button type="button" onClick={() => setIosBrowser('safari')} aria-pressed={iosBrowser === 'safari'} className={`rounded-xl px-3 py-2 text-sm font-bold transition ${iosBrowser === 'safari' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500'}`}>Safari</button>
              <button type="button" onClick={() => setIosBrowser('chrome')} aria-pressed={iosBrowser === 'chrome'} className={`rounded-xl px-3 py-2 text-sm font-bold transition ${iosBrowser === 'chrome' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500'}`}>Chrome</button>
            </div>
            <IOSInstallGuide browser={iosBrowser} />
            <button type="button" onClick={() => setShowIOSHelp(false)} className="mt-4 w-full rounded-full bg-neutral-950 py-3 text-sm font-bold text-white transition hover:bg-neutral-800 active:scale-[0.98]">Entendido</button>
          </div>
        </div>
      )}
    </>
  );
}
