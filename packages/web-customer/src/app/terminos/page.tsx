import type { Metadata } from 'next';
import { PageHeader } from '../../components/PageHeader';

export const metadata: Metadata = {
  title: { absolute: 'Condiciones de uso de la demostración | WingsLab' },
  description: 'Condiciones de uso de la instalación de demostración local de WingsLab.',
  alternates: { canonical: '/terminos' },
  openGraph: {
    type: 'article',
    title: 'Condiciones de uso de la demostración | WingsLab',
    description: 'Condiciones de uso de la instalación de demostración local de WingsLab.',
    url: '/terminos',
  },
};

export default function TermsPage() {
  return <main className="wl-page-shell min-h-screen text-neutral-900 dark:text-neutral-100"><PageHeader /><div className="mx-auto max-w-3xl space-y-6 px-5 py-8"><h1 className="text-2xl font-bold">Condiciones de la demostración local</h1><p>WingsLab es la aplicación de un solo restaurante: su menú, sus pedidos y su reparto propio. No permite registrar ni seleccionar otros negocios.</p><p>Esta instalación usa datos ficticios. Los importes y confirmaciones de efectivo son registros de prueba y no generan cobros, transferencias ni comunicaciones externas.</p><p>El enlace de reparto permite consultar y operar únicamente el pedido autorizado mientras esté vigente. No debe compartirse fuera del entorno de prueba.</p><p>Antes de una apertura comercial se deberán publicar las condiciones del operador real. Este texto describe solamente la demostración local.</p><a href="/" className="font-semibold text-[#bb0a0e] underline">Volver al menú</a></div></main>;
}
