'use client';
import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  fetchPublishedAppVersion,
  getNativeAppVersion,
  isNativePlatform,
} from '../lib/native';

type PublishedVersion = {
  versionName: string;
  versionCode: number;
  url: string;
  changelog?: string;
  required?: boolean;
};

const CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Banner de actualización para la app nativa (Capacitor).
 * Compara la versión instalada con la publicada en el backend y, si hay una
 * versión nueva, ofrece descargarla. Solo se muestra dentro del WebView nativo;
 * en el navegador no se renderiza nada.
 */
export default function AppUpdateBanner() {
  const [update, setUpdate] = useState<PublishedVersion | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!isNativePlatform()) return;

    let cancelled = false;

    const check = async () => {
      if (cancelled) return;
      const [installed, published] = await Promise.all([
        getNativeAppVersion(),
        fetchPublishedAppVersion('/api'),
      ]);
      if (cancelled) return;
      if (!installed || !published) return;
      if (published.versionCode > installed.versionCode) {
        setUpdate(published);
      }
    };

    void check();
    const timer = window.setInterval(() => void check(), CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (!update || dismissed) return null;

  const handleDownload = () => {
    setChecking(true);
    try {
      window.location.href = update.url;
    } finally {
      window.setTimeout(() => setChecking(false), 1500);
    }
  };

  return (
    <div className="fixed inset-x-0 bottom-4 z-[9990] flex justify-center px-4 pb-[env(safe-area-inset-bottom)]">
      <div className="w-full max-w-sm rounded-2xl border border-black/5 bg-white p-4 shadow-[0_12px_40px_-8px_rgba(15,15,15,0.25)]">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-600">
            <Download className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-neutral-900">
              Nueva versión disponible
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-neutral-500">
              SaDeL v{update.versionName} ya está lista. Actualiza para tener
              las últimas mejoras{update.required ? ' y seguir usando la app' : ''}.
            </p>
            {update.changelog ? (
              <p className="mt-1 text-xs leading-relaxed text-neutral-600">
                {update.changelog}
              </p>
            ) : null}
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={handleDownload}
                disabled={checking}
                className="flex-1 rounded-full bg-neutral-950 px-4 py-2 text-xs font-bold text-white transition hover:bg-neutral-800 active:scale-[0.98] disabled:opacity-60"
              >
                {checking ? 'Descargando…' : 'Actualizar ahora'}
              </button>
              <button
                type="button"
                onClick={() => setDismissed(true)}
                className="rounded-full border border-black/10 px-4 py-2 text-xs font-bold text-neutral-600 transition hover:bg-neutral-100"
              >
                Ahora no
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}