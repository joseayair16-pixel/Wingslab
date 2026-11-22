import { getWingslabSiteUrl } from '@sadel/shared';
import type { Metadata } from 'next';
import '../styles/globals.css';
import ServiceWorkerRegister from './ServiceWorkerRegister';
import InstallAppButton from '../components/InstallAppButton';
import AppUpdateBanner from '../components/AppUpdateBanner';
import SplashScreen from '../components/SplashScreen';
import DriverArrivalModal from '../components/DriverArrivalModal';
import { ClientOnly } from '../components/ClientOnly';

const siteUrl = getWingslabSiteUrl();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Menú en línea | WingsLab',
    template: '%s | WingsLab',
  },
  applicationName: 'WingsLab',
  manifest: '/manifest.webmanifest',
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
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es-MX" className="wl-booting" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){
  try {
    var d = document.documentElement;
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var preference = 'system';
    try { preference = localStorage.getItem('wingslab.theme') || 'system'; } catch (e) {}
    if (['light', 'dark', 'system'].indexOf(preference) < 0) preference = 'system';
    var apply = function() {
      var dark = preference === 'dark' || (preference === 'system' && mq.matches);
      d.classList.toggle('dark', dark);
      d.classList.toggle('pure-dark', dark);
      d.style.colorScheme = dark ? 'dark' : 'light';
      var cs = document.querySelector('meta[name="color-scheme"]');
      if (cs) cs.setAttribute('content', dark ? 'dark light' : 'light dark');
    };
    apply();
    if (mq.addEventListener) mq.addEventListener('change', apply);
    window.addEventListener('wingslab:theme', function(e) { preference = e.detail; apply(); });
    window.addEventListener('storage', function(e) { if (e.key === 'wingslab.theme') { preference = e.newValue || 'system'; apply(); } });
  } catch (e) {}
})();
(function(){try{
  var m=document.querySelector('meta[name="theme-color"]');
  if(m){var upd=function(){
    m.setAttribute('content', document.documentElement.classList.contains('dark') ? '#101012' : '#ffffff');
  };
  upd();
  new MutationObserver(upd).observe(document.documentElement,{attributes:true,attributeFilter:['class']});
}}catch(e){}})();`,
          }}
        />
        {/* Next emite este log de HMR desde su cliente de desarrollo; no es un error de la app. */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){var log=console.log;console.log=function(){if(arguments.length===1&&arguments[0]==='[HMR] connected')return;return log.apply(this,arguments)}})();` }} />
        <meta name="color-scheme" content="light dark" />
        <meta name="theme-color" content="#f20d12" />
        <style>{`html.wl-booting,html.wl-booting body{background-color:#f20d12!important}`}</style>
      </head>
      <body>
        <ServiceWorkerRegister />
        <ClientOnly><InstallAppButton /></ClientOnly>
        <ClientOnly><AppUpdateBanner /></ClientOnly>
        <SplashScreen />
        <ClientOnly>{children}</ClientOnly>
        <ClientOnly><DriverArrivalModal /></ClientOnly>
      </body>
    </html>
  );
}
