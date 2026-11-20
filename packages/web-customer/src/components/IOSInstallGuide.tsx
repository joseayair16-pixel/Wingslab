'use client';

import { Share, SquarePlus } from 'lucide-react';

/** Guía exacta para añadir la PWA de WingsLab a la pantalla de inicio en iOS. */
export default function IOSInstallGuide({ browser }: { browser: 'safari' | 'chrome' }) {
  const safari = browser === 'safari';

  return (
    <div className="text-sm leading-relaxed text-neutral-600 dark:text-zinc-300">
      <p className="mb-4">
        {safari
          ? 'En Safari, sigue estos tres pasos para añadir WingsLab a tu pantalla de inicio.'
          : 'En Chrome, sigue estos pasos para añadir WingsLab a tu pantalla de inicio.'}
      </p>

      {safari ? (
        <ol className="space-y-3">
          <li className="flex gap-3">
            <span className="font-bold text-sky-700">1.</span>
            <span>
              Toca el botón de <strong className="text-neutral-900 dark:text-zinc-100">Compartir</strong>{' '}
              <Share className="inline h-4 w-4 align-text-bottom" aria-label="icono de compartir" />,
              en la barra inferior (o arriba a la derecha)
            </span>
          </li>
          <li className="flex gap-3">
            <span className="font-bold text-sky-700">2.</span>
            <span>
              Desliza las opciones hacia arriba y toca{' '}
              <strong className="text-neutral-900 dark:text-zinc-100">Añadir a pantalla de inicio</strong>{' '}
              <SquarePlus className="inline h-4 w-4 align-text-bottom" />
            </span>
          </li>
          <li className="flex gap-3">
            <span className="font-bold text-sky-700">3.</span>
            <span>
              Confirma el nombre <strong>WingsLab</strong> y toca{' '}
              <strong className="text-neutral-900 dark:text-zinc-100">Añadir</strong>. Abre la app desde su nuevo icono.
            </span>
          </li>
        </ol>
      ) : (
        <ol className="space-y-3">
          <li className="flex gap-3">
            <span className="font-bold text-sky-700">1.</span>
            <span>
              Toca <strong className="text-neutral-900 dark:text-zinc-100">Compartir</strong>{' '}
              <Share className="inline h-4 w-4 align-text-bottom" aria-label="icono de compartir" /> junto a la barra de direcciones.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="font-bold text-sky-700">2.</span>
            <span>
              Busca y toca <strong className="text-neutral-900 dark:text-zinc-100">Añadir a pantalla de inicio</strong>{' '}
              <SquarePlus className="inline h-4 w-4 align-text-bottom" />.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="font-bold text-sky-700">3.</span>
            <span>
              Confirma el nombre <strong>WingsLab</strong> y toca{' '}
              <strong className="text-neutral-900 dark:text-zinc-100">Añadir</strong>.
            </span>
          </li>
        </ol>
      )}

      <div className="mt-4 rounded-xl bg-sky-50 p-3 text-xs leading-relaxed text-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
        ¿No aparece «Añadir a pantalla de inicio»? Desplázate al final del menú Compartir y toca{' '}
        <strong>Editar acciones</strong> para activarla. Si tu navegador no muestra la opción, abre esta página en Safari e inténtalo allí.
      </div>
      <p className="mt-3 text-xs text-neutral-500 dark:text-zinc-400">
        Para recibir notificaciones, abre WingsLab desde su icono y acepta el permiso cuando se solicite.
      </p>
    </div>
  );
}
