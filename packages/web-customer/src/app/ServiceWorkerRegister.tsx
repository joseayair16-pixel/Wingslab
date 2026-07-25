'use client';

import { useEffect } from 'react';

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then((registration) => {
        if (registration) {
          registration.unregister().then(() => {
            navigator.serviceWorker.register('/sw.js').then((reg) => {
              console.log('Service Worker registrado con éxito:', reg.scope);
            });
          });
        } else {
          navigator.serviceWorker.register('/sw.js').then((reg) => {
            console.log('Service Worker registrado con éxito:', reg.scope);
          });
        }
      });
    }
  }, []);

  return null;
}
