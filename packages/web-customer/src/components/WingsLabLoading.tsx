import type { ReactNode } from 'react';
import whiteWordmark from '../assets/wingslab-wordmark.png';

/** Pantalla de carga compartida; su duración depende de quien la muestra. */
export function WingsLabLoadingContent({ children }: { children?: ReactNode }) {
  return (
      <div className="wl-splash-inner" role="status" aria-label="Cargando WingsLab">
        <img src={whiteWordmark.src} alt="" className="wl-splash-logo" draggable={false} />
        <span className="wl-splash-spinner" aria-hidden="true" />
        {children}
      </div>
  );
}

export function WingsLabLoading({ children }: { children?: ReactNode }) {
  return <div className="wl-splash"><WingsLabLoadingContent />{children}</div>;
}
