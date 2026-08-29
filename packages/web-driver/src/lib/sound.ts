'use client';

// Reproducción de alertas sonoras en la web del repartidor (primer plano).
// En segundo plano/cerrado el sonido lo pone el canal nativo Android (ver
// MainActivity de la app Capacitor); aquí cubrimos el caso en que la app
// está abierta y recibe la asignación por socket.io.

let audioCtx: AudioContext | null = null;
let unlocked = false;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const Ctx: typeof AudioContext =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtx) audioCtx = new Ctx();
    return audioCtx;
  } catch {
    return null;
  }
}

function unlock(): void {
  if (unlocked) return;
  const ctx = getCtx();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => undefined);
  }
  unlocked = true;
}

// Los navegadores/WebView bloquean el audio hasta una interacción del usuario.
// Desbloqueamos el contexto en el primer gesto para garantizar que la alerta suene.
if (typeof window !== 'undefined') {
  const events = ['pointerdown', 'touchstart', 'keydown', 'click'];
  const handler = () => {
    unlock();
    events.forEach((e) => window.removeEventListener(e, handler));
  };
  events.forEach((e) => window.addEventListener(e, handler, { once: true, passive: true }));
}

export function playAlertSound(src: string): void {
  try {
    const ctx = getCtx();
    if (ctx) unlock();
    const audio = new Audio(src);
    audio.preload = 'auto';
    audio.volume = 1;
    const played = audio.play();
    if (played && typeof played.catch === 'function') {
      played.catch(() => undefined); // autoplay bloqueado: se ignora sin romper el flujo
    }
  } catch {
    // Entorno sin audio: no debe romper la asignación del pedido.
  }
}
