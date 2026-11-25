import { getWingslabSiteUrl } from '@sadel/shared';
import type { Metadata } from 'next';
import Script from 'next/script';
import '../styles/globals.css';
import ServiceWorkerRegister from './ServiceWorkerRegister';
import SessionRefreshBootstrap from '../components/SessionRefreshBootstrap';
import InstallAppButton from '../components/InstallAppButton';
import AppUpdateBanner from '../components/AppUpdateBanner';
import SplashScreen from '../components/SplashScreen';
import DriverArrivalModal from '../components/DriverArrivalModal';
import { ClientOnly, PageContent } from '../components/ClientOnly';

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
  colorScheme: 'light dark',
  themeColor: '#f20d12',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es-MX" className="wl-booting" suppressHydrationWarning>
      <body>
        <Script id="wingslab-theme" strategy="beforeInteractive"
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
    };
    apply();
    if (mq.addEventListener) mq.addEventListener('change', apply);
    window.addEventListener('wingslab:theme', function(e) { preference = e.detail; apply(); });
    window.addEventListener('storage', function(e) { if (e.key === 'wingslab.theme') { preference = e.newValue || 'system'; apply(); } });
  } catch (e) {}
})();`,
          }}
        />
        <ServiceWorkerRegister />
        <SessionRefreshBootstrap />
        <ClientOnly><InstallAppButton /></ClientOnly>
        <ClientOnly><AppUpdateBanner /></ClientOnly>
        <SplashScreen />
        <PageContent>{children}</PageContent>
        <ClientOnly><DriverArrivalModal /></ClientOnly>
      </body>
    </html>
  );
}
