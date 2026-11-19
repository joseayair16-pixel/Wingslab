'use client';

import { useEffect, useRef, useState } from 'react';
import whiteWordmark from '../assets/wingslab-wordmark.png';

type Phase = 'visible' | 'fading' | 'gone';

const MIN_VISIBLE_MS = 1000;
const FADE_MS = 200;
const SAFETY_TIMEOUT_MS = 6000;

/** Pantalla de carga oficial WingsLab: rojo corporativo + logotipo blanco + spinner. */
export default function SplashScreen() {
  const [phase, setPhase] = useState<Phase>('visible');
  const startedAt = useRef<number | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    startedAt.current = Date.now();
    // Fondo rojo desde el primer frame, también en modo oscuro.
    document.documentElement.classList.add('wl-booting');

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      const elapsed = Date.now() - (startedAt.current ?? Date.now());
      const wait = Math.max(0, MIN_VISIBLE_MS - elapsed);
      timers.current.push(window.setTimeout(() => setPhase('fading'), wait));
    };

    const onReady = () => finish();
    window.addEventListener('wingslab:app-ready', onReady);
    // Si el menú tarda o falla, el propio Storefront avisa; este timeout evita
    // que la pantalla quede bloqueada para siempre ante un error inesperado.
    timers.current.push(window.setTimeout(finish, SAFETY_TIMEOUT_MS));

    return () => {
      window.removeEventListener('wingslab:app-ready', onReady);
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, []);

  useEffect(() => {
    if (phase !== 'fading') return;
    const timer = window.setTimeout(() => {
      document.documentElement.classList.remove('wl-booting');
      setPhase('gone');
    }, FADE_MS);
    timers.current.push(timer);
    return () => clearTimeout(timer);
  }, [phase]);

  if (phase === 'gone') return null;

  return (
    <div
      aria-hidden="true"
      data-testid="wl-splash"
      className={`wl-splash ${phase === 'fading' ? 'is-fading' : ''}`}
    >
      <div className="wl-splash-inner">
        <img src={whiteWordmark.src} alt="" className="wl-splash-logo" draggable={false} />
        <span className="wl-splash-spinner" aria-hidden="true" />
      </div>
    </div>
  );
}
