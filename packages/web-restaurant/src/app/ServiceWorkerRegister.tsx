'use client';

import { useEffect } from 'react';

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        if (process.env.NODE_ENV !== 'production') {
          console.log('Service Worker registrado con éxito:', reg.scope);
        }
      }).catch((err) => {
        if (process.env.NODE_ENV !== 'production') {
          console.error('Error al registrar Service Worker:', err);
        }
      });
    }
  }, []);

  return null;
}
