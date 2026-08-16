'use client';

import { useEffect } from 'react';
import {
  preload,
  preloadAll,
  play,
  vibrate,
  warmup,
  installWarmupListeners,
  installVisibilityResumeListener,
  reset,
  type SoundName,
} from '@sadel/shared';

const CUSTOMER_SOUNDS: SoundName[] = ['mensaje', 'llegue'];

/**
 * Hook compartido de efectos de sonido para la app del comensal.
 * Centraliza el desbloqueo por gesto, la precarga de buffers y la
 * reproducción, eliminando la duplicación entre páginas.
 */
export function useCustomerSounds() {
  // Precarga + desbloqueo por gesto + reintento al volver a la pestaña.
  useEffect(() => {
    preloadAll(CUSTOMER_SOUNDS);
    const uninstallWarmup = installWarmupListeners();
    const uninstallVisibility = installVisibilityResumeListener();
    return () => {
      uninstallWarmup();
      uninstallVisibility();
      reset();
    };
  }, []);

  /** Alerta general (rechazos y cancelaciones). Usa el pop de mensaje. */
  const playAlert = (): void => {
    if (!isSoundEnabled()) return;
    void warmup().finally(() => {
      play('mensaje');
      vibrate([200, 100, 200]);
    });
  };

  /** Sonido de llegada del repartidor / pedido listo. */
  const playLlegue = (): void => {
    if (!isSoundEnabled()) return;
    void warmup().finally(() => {
      play('llegue');
      vibrate([800, 400, 800, 400, 800]);
    });
  };

  /** Pop de mensaje del chat. */
  const playChat = (): void => {
    if (!isSoundEnabled()) return;
    void warmup().finally(() => {
      play('mensaje');
    });
  };

  /** Reproductor mínimo para desbloquear el audio al activar el toggle. */
  const unlock = (): void => {
    void warmup().finally(() => {
      play('mensaje');
    });
  };

  return { playAlert, playLlegue, playChat, unlock };
}

function isSoundEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem('customerAlertSoundEnabled') !== 'false';
  } catch {
    return true;
  }
}

export { preload };
