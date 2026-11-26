'use client';

import { useSyncExternalStore } from 'react';

// Un solo temporizador compartido para todas las cuentas regresivas del panel.
// Evita un setInterval por pedido y propaga el tick solo a quienes lo consumen.
const listeners = new Set<() => void>();
let current = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
function tick() {
  current = Date.now();
  listeners.forEach((notify) => notify());
}
function onVisibilityChange() {
  if (document.visibilityState === 'visible') tick();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    current = Date.now();
    timer = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  };
}

function getSnapshot() {
  return current;
}

export function useSharedClock(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
