'use client';

import { useEffect, useState } from 'react';

type Phase = 'visible' | 'fading' | 'gone';

export default function SplashScreen() {
  // mounted=false durante SSR y el primer render del cliente: así el splash va en el
  // HTML inicial y se pinta antes que el contenido (sin "flash" previo en la PWA).
  // Tras montar, si NO es standalone (navegación web normal) se quita al instante.
  const [mounted, setMounted] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [phase, setPhase] = useState<Phase>('visible');

  useEffect(() => {
    setMounted(true);

    const mq = window.matchMedia('(display-mode: standalone)');
    const standalone = mq.matches;
    setIsStandalone(standalone);

    // En navegación web normal el splash no debe aparecer: se elimina apenas hidrate.
    if (!standalone) {
      setPhase('gone');
      return;
    }

    const hide = () => setPhase((current) => (current === 'visible' ? 'fading' : current));

    if (document.readyState === 'complete') {
      setTimeout(hide, 1000);
    } else {
      window.addEventListener('load', hide);
    }
    const fallback = setTimeout(hide, 2500);

    return () => {
      window.removeEventListener('load', hide);
      clearTimeout(fallback);
    };
  }, []);

  useEffect(() => {
    if (phase === 'fading') {
      const timer = setTimeout(() => setPhase('gone'), 350);
      return () => clearTimeout(timer);
    }
  }, [phase]);

  const shouldShow = !mounted || (isStandalone && phase !== 'gone');
  if (!shouldShow) return null;

  return (
    <div
      aria-hidden="true"
      className={`fixed inset-0 z-[10000] flex flex-col items-center justify-center bg-[#fafaf9] transition-opacity duration-300 ${
        phase === 'fading' ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
    >
      <img
        src="/app-icon-512.png"
        alt=""
        className="h-20 w-20 rounded-[22px] object-cover shadow-[0_10px_40px_rgba(0,0,0,0.15)]"
      />
      <p className="mt-4 text-lg font-bold tracking-[-0.02em] text-neutral-800">SaDeL</p>
      <div className="mt-4 h-1 w-16 overflow-hidden rounded-full bg-neutral-200">
        <div className="h-full w-full rounded-full bg-sky-500 animate-pulse" />
      </div>
    </div>
  );
}
