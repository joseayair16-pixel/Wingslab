'use client';

import { useSyncExternalStore } from 'react';

// Un solo temporizador compartido para todas las cuentas regresivas del panel.
// Evita un setInterval por pedido y propaga el tick solo a quienes lo consumen.
const listeners = new Set<() => void>();
let current = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    timer = setInterval(() => {
      current = Date.now();
      listeners.forEach((notify) => notify());
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot() {
  return current;
}

export function useSharedClock(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
