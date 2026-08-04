'use client';

import { useEffect, useState } from 'react';
import { SaDelLogo } from './SaDelLogo';

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
      className={`sadel-splash fixed inset-0 z-[10000] flex flex-col items-center justify-center bg-[#fafaf9] transition-opacity duration-300 ${
        phase === 'fading' ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
    >
      <SaDelLogo
        className="sadel-loader-logo animate-sadel-breathe select-none pointer-events-none h-[68px] w-auto"
      />
      <p className="sadel-splash-title mt-4 text-lg font-bold tracking-[-0.02em] text-neutral-800">SaDeL</p>
      <div className="sadel-splash-track mt-4 h-1 w-16 overflow-hidden rounded-full bg-neutral-200">
        <div className="sadel-splash-fill h-full w-full rounded-full bg-sky-500 animate-pulse" />
      </div>
    </div>
  );
}
