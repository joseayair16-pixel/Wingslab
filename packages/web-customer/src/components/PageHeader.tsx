import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import officialWordmark from '../assets/wingslab-wordmark.png';
import redWordmark from '../assets/wingslab-wordmark-red.png';

/** Encabezado compartido de las páginas interiores del comensal. */
export function PageHeader() {
  return (
    <header className="wl-page-header">
      <div className="wl-page-header-inner">
        <Link href="/" className="wl-page-back">
          <ArrowLeft aria-hidden="true" />
          <span>Ver menú</span>
        </Link>
        <Link href="/" aria-label="WingsLab, inicio" className="wl-page-brand">
          <img className="wl-logo-on-light" src={redWordmark.src} alt="" />
          <img className="wl-logo-on-dark" src={officialWordmark.src} alt="" />
        </Link>
        <span className="wl-page-header-spacer" aria-hidden="true" />
      </div>
    </header>
  );
}
