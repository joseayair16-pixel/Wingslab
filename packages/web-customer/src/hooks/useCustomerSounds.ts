'use client';

import { useCallback, useEffect } from 'react';
import {
  play,
  preloadOnFirstInteraction,
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
  // Descarga diferida al primer gesto + desbloqueo + reintento al volver.
  // No se precarga al montar: en la mayoría de visitas nunca suena una alerta.
  useEffect(() => {
    const uninstallPreload = preloadOnFirstInteraction(CUSTOMER_SOUNDS);
    const uninstallWarmup = installWarmupListeners();
    const uninstallVisibility = installVisibilityResumeListener();
    return () => {
      uninstallPreload();
      uninstallWarmup();
      uninstallVisibility();
      reset();
    };
  }, []);

  /** Alerta general (rechazos y cancelaciones). Usa el pop de mensaje. */
  const playAlert = useCallback((): void => {
    if (!isSoundEnabled()) return;
    play('mensaje');
    vibrate([200, 100, 200]);
  }, []);

  /** Sonido de llegada del repartidor / pedido listo. */
  const playLlegue = useCallback((): void => {
    if (!isSoundEnabled()) return;
    play('llegue');
    vibrate([800, 400, 800, 400, 800]);
  }, []);

  /** Pop de mensaje del chat. */
  const playChat = useCallback((): void => {
    if (!isSoundEnabled()) return;
    play('mensaje');
  }, []);

  /** Reproductor mínimo para desbloquear el audio al activar el toggle. */
  const unlock = useCallback((): void => {
    void warmup().finally(() => {
      play('mensaje');
    });
  }, []);

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
