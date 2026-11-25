'use client';

import { useEffect, useState } from 'react';

const hosts = ['wl-mp-card-number', 'wl-mp-expiration', 'wl-mp-security-code'];

export default function CardInputDiagnostic() {
  const [report, setReport] = useState('');
  useEffect(() => {
    if (!['127.0.0.1', 'localhost'].includes(location.hostname) ||
        process.env.NEXT_PUBLIC_WINGSLAB_MP_SANDBOX !== 'true') return;
    let lastHit = 'ninguno';
    const describe = (el: Element | null) => el ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}` : 'fuera de pantalla';
    const update = () => {
      if (location.hash !== '#diagnostico-clic') { setReport(''); return; }
      const lines = hosts.map(id => {
        const frame = document.getElementById(id)?.querySelector('iframe');
        if (!frame) return `${id}: sin iframe`;
        const rect = frame.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return `${id}: ${hit === frame ? 'iframe visible en el centro' : `elemento en el centro: ${describe(hit)}`}${frame.closest('[inert]') ? ' · inert' : ''}`;
      });
      setReport([...lines, `Foco: ${describe(document.activeElement)}${document.activeElement instanceof HTMLIFrameElement ? ` (${document.activeElement.name})` : ''}`,
        `Último clic en página: ${lastHit}`, `Service Worker: ${navigator.serviceWorker?.controller ? 'activo' : 'sin controlador'}`].join('\n'));
    };
    const onPointer = (event: PointerEvent) => {
      if (location.hash === '#diagnostico-clic') lastHit = describe(document.elementFromPoint(event.clientX, event.clientY));
    };
    let timer: number | undefined;
    const toggle = () => {
      window.clearInterval(timer);
      window.removeEventListener('pointerdown', onPointer, true);
      if (location.hash === '#diagnostico-clic') {
        window.addEventListener('pointerdown', onPointer, true);
        timer = window.setInterval(update, 250);
      }
      update();
    };
    window.addEventListener('hashchange', toggle);
    toggle();
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('hashchange', toggle);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, []);
  return report ? <pre className="pointer-events-none fixed inset-x-2 top-2 z-[2147483647] whitespace-pre-wrap rounded bg-black/90 p-2 text-xs text-white">{report}</pre> : null;
}
