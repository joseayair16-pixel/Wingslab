/**
 * Sistema de audio compartido para las apps SaDeL (web + PWA).
 *
 * Centraliza la política de autoplay del navegador: en la pestaña, el PRIMER
 * sonido requiere un gesto del usuario (pointerdown/keydown/touchstart/click).
 * Tras ese primer gesto, el audio queda desbloqueado para toda la sesión.
 *
 * La reproducción usa una cascada de 3 niveles:
 *   1. AudioBuffer (WAV decodificado vía Web Audio API) — mejor calidad.
 *   2. Oscilador programático — respaldo si el WAV no está disponible.
 *   3. Elemento <audio> — último recurso (sujeto a autoplay policy).
 *
 * Diseño:
 * - Contexto singleton por pestaña (nunca se crea un segundo contexto).
 * - Caché de buffers decodificados (no se re-decodifica en cada evento).
 * - stopAll() garantiza que ninguna fuente quede sonando (sin tonos colgados).
 * - reset() invalida buffers y cierra el contexto (evita buffers de contexto viejo).
 */

export type SoundName = 'notifica' | 'mensaje' | 'llegue' | 'rezagado';

export type PlayResult = 'played' | 'blocked' | 'unsupported' | 'muted';

export type SoundHandle = {
  stop: () => void;
};

type SoundConfig = {
  src: string;
  fallbackFrequency?: number;
  fallbackType?: OscillatorType;
};

const SOUNDS: Record<SoundName, SoundConfig> = {
  notifica: { src: '/sounds/notifica.wav', fallbackFrequency: 880, fallbackType: 'square' },
  mensaje: { src: '/sounds/mensaje.wav', fallbackFrequency: 1000, fallbackType: 'sine' },
  llegue: { src: '/sounds/llegue.wav', fallbackFrequency: 880, fallbackType: 'sine' },
  rezagado: { src: '/sounds/rezagado.wav', fallbackFrequency: 440, fallbackType: 'square' },
};

let audioContext: AudioContext | null = null;
let hasInteracted = false;
const buffers = new Map<SoundName, AudioBuffer>();
const rawBuffers = new Map<SoundName, ArrayBuffer>();
const activeHandles = new Set<{ stop: () => void }>();

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function getAudioContextClass(): typeof AudioContext | null {
  if (!isBrowser()) return null;
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return w.AudioContext || w.webkitAudioContext || null;
}

function getOrCreateContext(): AudioContext | null {
  if (audioContext) return audioContext;
  const Ctx = getAudioContextClass();
  if (!Ctx) return null;
  audioContext = new Ctx();
  return audioContext;
}

function findAudioElement(src: string): HTMLAudioElement | null {
  if (!isBrowser()) return null;
  const id = `sadel-audio-${src.split('/').pop()?.replace(/\W+/g, '-') || 'sound'}`;
  let el = document.getElementById(id) as HTMLAudioElement | null;
  if (!el) {
    el = document.createElement('audio');
    el.id = id;
    el.src = src;
    el.preload = 'auto';
    document.body.appendChild(el);
  }
  return el;
}

/**
 * Precarga el array buffer de un sonido sin crear el AudioContext
 * (así la descarga no queda bloqueada por la política de autoplay).
 */
export function preload(name: SoundName): void {
  if (!isBrowser()) return;
  if (rawBuffers.has(name) || buffers.has(name)) return;
  const config = SOUNDS[name];
  if (!config) return;
  fetch(config.src)
    .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then((buffer) => {
      rawBuffers.set(name, buffer);
    })
    .catch(() => {
      rawBuffers.delete(name);
    });
}

/** Precarga todos los sonidos registrados. */
export function preloadAll(names: SoundName[]): void {
  names.forEach(preload);
}

/** Marca que el usuario interactuó con la app (requerido para desbloquear el audio). */
export function markUserInteracted(): void {
  hasInteracted = true;
  if (audioContext && audioContext.state === 'suspended') {
    audioContext.resume().catch(() => undefined);
  }
}

export function hasUserInteracted(): boolean {
  return hasInteracted;
}

/**
 * Desbloquea el audio dentro de un gesto del usuario. Debe llamarse desde
 * pointerdown/keydown/touchstart/click. Reproduce un oscilador silencioso
 * para "primar" el motor de audio en iOS/Safari.
 */
export async function warmup(): Promise<boolean> {
  if (!isBrowser()) return false;
  const Ctx = getAudioContextClass();
  if (!Ctx) return false;
  const ctx = getOrCreateContext();
  if (!ctx) return false;

  hasInteracted = true;

  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      return false;
    }
  }

  // Decodificar buffers pendientes ahora que el contexto está activo.
  await Promise.all(
    Array.from(rawBuffers.entries()).map(async ([name, buffer]) => {
      if (buffers.has(name)) return;
      try {
        buffers.set(name, await ctx.decodeAudioData(buffer.slice(0)));
      } catch {
        // Se mantiene el fallback de oscilador.
      }
    }),
  );

  // Oscilador silencioso (gain 0) para desbloquear en iOS.
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.05);
  } catch {
    // Noop
  }

  return ctx.state === 'running';
}

/**
 * Reproduce un sonido con la cascada WAV → oscilador → <audio>.
 * Devuelve un handle para poder detenerlo (necesario para la alarma en bucle).
 */
export function play(name: SoundName, options?: { loop?: boolean }): PlayResult {
  const loop = options?.loop ?? false;
  if (!isBrowser()) return 'unsupported';
  const ctx = getOrCreateContext();

  if (!ctx) {
    // Sin Web Audio API: último recurso con <audio>.
    const el = findAudioElement(SOUNDS[name].src);
    if (!el) return 'unsupported';
    const audioHandle = playAudioElement(el, loop);
    activeHandles.add(audioHandle);
    return hasInteracted ? 'played' : 'blocked';
  }

  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => undefined);
  }

  if (!hasInteracted && ctx.state !== 'running') {
    // No hay gesto todavía: no se puede oír. Se registra como bloqueado.
    return 'blocked';
  }

  const buffer = buffers.get(name);
  if (buffer) {
    try {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = loop;
      const gain = ctx.createGain();
      gain.gain.value = 1;
      source.connect(gain);
      gain.connect(ctx.destination);
      source.start(0);
      const handle = { stop: () => { try { source.stop(); } catch { /* noop */ } } };
      activeHandles.add(handle);
      if (!loop) {
        source.onended = () => activeHandles.delete(handle);
      }
      return 'played';
    } catch {
      // Continúa al oscilador de respaldo.
    }
  }

  return playOscillator(name, loop);
}

function playOscillator(name: SoundName, loop: boolean): PlayResult {
  const ctx = getOrCreateContext();
  if (!ctx) return 'unsupported';
  const config = SOUNDS[name];
  try {
    const osc = ctx.createOscillator();
    osc.type = config.fallbackType ?? 'sine';
    osc.frequency.value = config.fallbackFrequency ?? 880;
    const gain = ctx.createGain();
    gain.gain.value = 0.6;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    const handle: SoundHandle = { stop: () => { try { osc.stop(); } catch { /* noop */ } } };
    activeHandles.add(handle);
    if (!loop) {
      osc.stop(ctx.currentTime + 0.4);
      osc.onended = () => activeHandles.delete(handle);
    }
    return 'played';
  } catch {
    const el = findAudioElement(config.src);
    if (!el) return 'unsupported';
    const audioHandle = playAudioElement(el, loop);
    activeHandles.add(audioHandle);
    return hasInteracted ? 'played' : 'blocked';
  }
}

function playAudioElement(el: HTMLAudioElement, loop: boolean): SoundHandle {
  el.loop = loop;
  el.currentTime = 0;
  el.volume = 1;
  const playPromise = el.play();
  void playPromise.catch(() => undefined);
  return {
    stop: () => {
      el.pause();
      el.currentTime = 0;
    },
  };
}

/** Vibración del dispositivo (si está soportada). */
export function vibrate(pattern: number | number[]): void {
  if (!isBrowser()) return;
  if (navigator.vibrate) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // Noop
    }
  }
}

/** Detiene todas las fuentes activas (alarmas en bucle, osciladores, <audio>). */
export function stopAll(): void {
  for (const handle of Array.from(activeHandles)) {
    try {
      handle.stop();
    } catch {
      // Noop
    }
  }
  activeHandles.clear();
  if (isBrowser()) {
    document.querySelectorAll<HTMLAudioElement>('[id^="sadel-audio-"]').forEach((el) => {
      el.pause();
      el.currentTime = 0;
    });
  }
}

/**
 * Cierra el contexto e invalida la caché de buffers. Usar al desmontar
 * la app o al detectar que el contexto quedó inservible.
 */
export function reset(): void {
  stopAll();
  buffers.clear();
  rawBuffers.clear();
  if (audioContext) {
    try {
      audioContext.close();
    } catch {
      // Noop
    }
  }
  audioContext = null;
  hasInteracted = false;
}

/** Estado actual del motor de audio, útil para UI de "toca para activar". */
export function getAudioState(): 'ready' | 'needs-gesture' | 'unsupported' {
  if (!isBrowser()) return 'unsupported';
  if (!getAudioContextClass()) return 'unsupported';
  if (audioContext?.state === 'running') return 'ready';
  if (hasInteracted) return 'ready';
  return 'needs-gesture';
}

/** Registra un listener global que llama warmup() en el primer gesto real. */
export function installWarmupListeners(): () => void {
  if (!isBrowser()) return () => undefined;
  const onGesture = () => {
    warmup().catch(() => undefined);
  };
  window.addEventListener('pointerdown', onGesture, { passive: true, once: true });
  window.addEventListener('keydown', onGesture, { passive: true, once: true });
  window.addEventListener('touchstart', onGesture, { passive: true, once: true });
  return () => {
    window.removeEventListener('pointerdown', onGesture);
    window.removeEventListener('keydown', onGesture);
    window.removeEventListener('touchstart', onGesture);
  };
}

/** Registra un listener que reintenta resume() al volver a la pestaña. */
export function installVisibilityResumeListener(): () => void {
  if (!isBrowser()) return () => undefined;
  const onVisibility = () => {
    if (document.visibilityState === 'visible' && hasInteracted && audioContext) {
      if (audioContext.state === 'suspended') {
        audioContext.resume().catch(() => undefined);
      }
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  return () => document.removeEventListener('visibilitychange', onVisibility);
}
