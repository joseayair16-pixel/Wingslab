import type { Metadata } from 'next';
import { PageHeader } from '../../components/PageHeader';

export const metadata: Metadata = {
  title: { absolute: 'Aviso de privacidad de la demostración | WingsLab' },
  description: 'Información sobre el uso de datos en la demostración local de WingsLab.',
  alternates: { canonical: '/privacidad' },
  openGraph: {
    type: 'article',
    title: 'Aviso de privacidad de la demostración | WingsLab',
    description: 'Información sobre el uso de datos en la demostración local de WingsLab.',
    url: '/privacidad',
  },
};

export default function PrivacyPage() {
  return <main className="wl-page-shell min-h-screen text-neutral-900 dark:text-neutral-100"><PageHeader /><div className="mx-auto max-w-3xl space-y-6 px-5 py-8"><h1 className="text-2xl font-bold">Privacidad de la demostración local</h1><p>Esta instalación de WingsLab utiliza exclusivamente cuentas, contactos, direcciones y pedidos ficticios. No introduzcas información personal real.</p><p>Los datos se conservan en la instalación local para probar pedidos y reparto propio. No se comparten con otros restaurantes ni con una red de repartidores.</p><p>La sesión y el carrito se guardan en el navegador. El reparto puede registrar coordenadas de prueba con permiso del navegador; el enlace de entrega se revoca al completar el pedido.</p><p>Las campañas comerciales se dirigen a las cuentas activas que acepten notificaciones en este dispositivo. Puedes dejar de recibirlas desactivando las notificaciones cuando quieras. En este entorno el proveedor push comercial y todo envío real están deshabilitados.</p><p>Los proveedores externos y las comunicaciones reales permanecen deshabilitados. Antes de operar con personas reales será necesario publicar el aviso del responsable del restaurante.</p><a href="/" className="font-semibold text-[#bb0a0e] underline">Volver al menú</a></div></main>;
}
