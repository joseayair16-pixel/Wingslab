import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import officialWordmark from '../assets/wingslab-wordmark.png';

/** Encabezado compartido de las páginas interiores del comensal.
 *  El degradado del cuerpo se aplica con `.wl-page-shell` para que la transición
 *  del rojo al fondo sea idéntica a la página de inicio. */
export function PageHeader() {
  return (
    <header className="wl-page-header">
      <div className="wl-page-header-inner">
        <Link href="/" className="wl-page-back">
          <ArrowLeft aria-hidden="true" />
          <span>Ver menú</span>
        </Link>
        <Link href="/" aria-label="WingsLab, inicio" className="wl-page-brand">
          <img src={officialWordmark.src} alt="WingsLab" />
        </Link>
        <span className="wl-page-header-spacer" aria-hidden="true" />
      </div>
    </header>
  );
}
