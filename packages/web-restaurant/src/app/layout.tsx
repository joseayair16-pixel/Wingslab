import type { Metadata } from 'next';
import Script from 'next/script';
import '../styles/globals.css';
import ServiceWorkerRegister from './ServiceWorkerRegister';
import InstallAppButton from '../components/InstallAppButton';
import AppUpdateBanner from '../components/AppUpdateBanner';

export const metadata: Metadata = {
  title: 'WingsLab · Operaciones',
  description: 'Pedidos, cocina y reparto propio de WingsLab.',
  robots: {
    index: false,
    follow: false,
  },
  manifest: '/manifest.json',
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
    title: 'SaDeL Rest',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <Script
          id="restaurant-theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var d=document.documentElement,m=matchMedia('(prefers-color-scheme: dark)'),p='system';try{p=localStorage.getItem('wingslab.restaurant.theme')||'system'}catch(e){};function apply(){var dark=p==='dark'||(p==='system'&&m.matches);d.classList.toggle('dark',dark);d.style.colorScheme=dark?'dark':'light'}apply();m.addEventListener&&m.addEventListener('change',apply);window.addEventListener('wingslab:restaurant-theme',function(e){p=e.detail;apply()});window.addEventListener('storage',function(e){if(e.key==='wingslab.restaurant.theme'){p=e.newValue||'system';apply()}})}catch(e){}})();`,
          }}
        />
        {/* Next emite este log de HMR desde su cliente de desarrollo; no es un error de la app. */}
        <Script id="restaurant-hmr-log-filter" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: `(function(){var log=console.log;console.log=function(){if(arguments.length===1&&arguments[0]==='[HMR] connected')return;return log.apply(this,arguments)}})();` }} />
        <meta name="color-scheme" content="light dark" />
        <meta name="theme-color" content="#f6f6f4" />
      </head>
      <body>
        <ServiceWorkerRegister />
        <InstallAppButton />
        <AppUpdateBanner />
        {children}
      </body>
    </html>
  );
}
