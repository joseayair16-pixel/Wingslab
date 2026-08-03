'use client';

import { useEffect, useState } from 'react';

export default function ServiceWorkerRegister() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    let registration: ServiceWorkerRegistration | null = null;

    const handleUpdateFound = () => {
      const newWorker = registration?.installing;
      if (!newWorker) return;

      newWorker.addEventListener('statechange', () => {
        // Hay una versión vieja controlando la página y una nueva ya instalada.
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          setUpdateAvailable(true);
        }
      });
    };

    const checkForUpdates = () => {
      registration?.update().catch(() => {});
    };

    navigator.serviceWorker.register('/sw.js').then((reg) => {
      registration = reg;
      reg.addEventListener('updatefound', handleUpdateFound);
    }).catch(() => {});

    // En PWAs instaladas iOS no siempre se detecta el update al abrir; se verifica
    // cada vez que la app vuelve a primer plano.
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkForUpdates();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      registration?.removeEventListener('updatefound', handleUpdateFound);
    };
  }, []);

  if (!updateAvailable) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[9999] flex items-center justify-center gap-3 bg-emerald-600 px-4 py-3 text-sm font-medium text-white shadow-lg">
      <span>Nueva versión disponible.</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="font-semibold underline"
      >
        Actualizar ahora
      </button>
    </div>
  );
}
