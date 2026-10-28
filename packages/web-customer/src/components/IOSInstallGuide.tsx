'use client';

import { Share, SquarePlus } from 'lucide-react';

export default function IOSInstallGuide() {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const isChrome = /CriOS/i.test(ua);
  const isSafari = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);

  return (
    <div className="text-sm leading-relaxed text-neutral-600">
      <p className="mb-4">En iPhone y iPad debes añadir SaDeL manualmente; el botón de esta página no puede instalarla por ti.</p>
      <ol className="space-y-3">
        <li className="flex gap-3"><span className="font-bold text-sky-700">1.</span><span>
          {isSafari ? 'En Safari, toca Compartir' : isChrome ? 'En Chrome, toca Compartir en la barra de direcciones o en el menú ⋯' : 'Busca Compartir en la barra o el menú del navegador'}{' '}
          <Share className="inline h-4 w-4 align-text-bottom" aria-label="icono de compartir" />. Si no ves la barra, desplázate hacia arriba.
        </span></li>
        <li className="flex gap-3"><span className="font-bold text-sky-700">2.</span><span>Desliza hacia arriba en el menú y toca <strong className="text-neutral-900">Añadir a pantalla de inicio</strong> <SquarePlus className="inline h-4 w-4 align-text-bottom" />. El nombre puede variar ligeramente.</span></li>
        <li className="flex gap-3"><span className="font-bold text-sky-700">3.</span><span>Si aparece la opción <strong className="text-neutral-900">Abrir como app web</strong>, actívala. Después toca <strong className="text-neutral-900">Añadir</strong> y abre SaDeL desde su nuevo icono en la pantalla de inicio.</span></li>
      </ol>
      <div className="mt-4 rounded-xl bg-sky-50 p-3 text-xs leading-relaxed text-sky-900">
        ¿No aparece la opción? Actualiza iOS y tu navegador. En Safari, revisa <strong>Editar acciones</strong> al final del menú Compartir. Si estás dentro de otra app o tu navegador no la ofrece, copia la dirección y ábrela en Safari; repite los pasos allí.
      </div>
      <p className="mt-3 text-xs text-neutral-500">Para recibir notificaciones, abre SaDeL desde su icono y actívalas cuando se te solicite. La disponibilidad depende de la versión de iOS y de tus permisos.</p>
    </div>
  );
}
