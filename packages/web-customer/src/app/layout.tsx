import { getWingslabSiteUrl, wingslabExternalServicesEnabled } from '@sadel/shared';
import type { Metadata } from 'next';
import Script from 'next/script';
import '../styles/globals.css';
import ServiceWorkerRegister from './ServiceWorkerRegister';
import InstallAppButton from '../components/InstallAppButton';
import AppUpdateBanner from '../components/AppUpdateBanner';
import SplashScreen from '../components/SplashScreen';
import DriverArrivalModal from '../components/DriverArrivalModal';

const siteUrl = getWingslabSiteUrl();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'WingsLab — Del antojo a tu puerta',
    template: '%s | WingsLab',
  },
  description:
    'El menú de WingsLab, promociones y pedidos con recogida o reparto propio. Sigue tu pedido desde la cocina hasta la entrega.',
  applicationName: 'WingsLab',
  manifest: '/manifest.webmanifest',
  alternates: {
    canonical: '/',
  },
  keywords: [
    'pedir comida en línea',
    'entrega a domicilio',
    'recoger en tienda',
    'menú WingsLab',
    'comida rápida',
    'pídelo por aquí',
    'WingsLab',
  ],
  openGraph: {
    type: 'website',
    siteName: 'WingsLab',
    locale: 'es_MX',
    url: siteUrl,
    title: 'WingsLab — Del antojo a tu puerta',
    description:
      'Pide comida y productos en línea desde tu localidad. Entrega a domicilio o recogida en tienda, con seguimiento en tiempo real.',
    images: [
      {
        url: `${siteUrl}/app-icon-512.png`,
        width: 512,
        height: 512,
        alt: 'WingsLab',
      },
    ],
  },
  twitter: {
    card: 'summary',
    title: 'WingsLab — Del antojo a tu puerta',
    description: 'Pide comida y productos en línea desde tu localidad.',
    images: [`${siteUrl}/app-icon-512.png`],
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: '/apple-touch-icon-180.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'WingsLab',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
};

export const viewport: import('next').Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){
  try {
    // Hard reset: la PWA SIEMPRE arranca en modo claro, sin importar el modo
    // del sistema, valores legados de localStorage o el splash.
    var d = document.documentElement;
    d.classList.remove('dark');
    d.classList.remove('pure-dark');
    if (window.localStorage) {
      try { window.localStorage.removeItem('darkMode'); } catch (e) {}
    }
    var cs = document.querySelector('meta[name="color-scheme"]');
    if (cs) cs.setAttribute('content', 'light');
  } catch (e) {}
})();
(function(){try{
  var m=document.querySelector('meta[name="theme-color"]');
  if(m){var upd=function(){
    m.setAttribute('content', document.documentElement.classList.contains('dark') ? '#0b0b0d' : '#fafafa');
  };
  upd();
  new MutationObserver(upd).observe(document.documentElement,{attributes:true,attributeFilter:['class']});
}}catch(e){}})();`,
          }}
        />
        <meta name="color-scheme" content="light" />
        <meta name="theme-color" content="#fafafa" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
        />
      </head>
      <body>
        {wingslabExternalServicesEnabled() && process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ? (
          <Script
            src={`https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&libraries=places&loading=async`}
            strategy="lazyOnload"
          />
        ) : null}
        <ServiceWorkerRegister />
        <InstallAppButton />
        <AppUpdateBanner />
        <SplashScreen />
        {children}
        <DriverArrivalModal />
      </body>
    </html>
  );
}
