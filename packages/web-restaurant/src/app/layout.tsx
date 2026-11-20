import type { Metadata } from 'next';
import '../styles/globals.css';
import ServiceWorkerRegister from './ServiceWorkerRegister';
import InstallAppButton from '../components/InstallAppButton';
import AppUpdateBanner from '../components/AppUpdateBanner';
import SplashScreen from '../components/SplashScreen';

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
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var d=document.documentElement,m=matchMedia('(prefers-color-scheme: dark)'),p='system';try{p=localStorage.getItem('wingslab.restaurant.theme')||'system'}catch(e){};function apply(){var dark=p==='dark'||(p==='system'&&m.matches);d.classList.toggle('dark',dark);d.style.colorScheme=dark?'dark':'light'}apply();m.addEventListener&&m.addEventListener('change',apply);window.addEventListener('wingslab:restaurant-theme',function(e){p=e.detail;apply()});window.addEventListener('storage',function(e){if(e.key==='wingslab.restaurant.theme'){p=e.newValue||'system';apply()}})}catch(e){}})();`,
          }}
        />
        <meta name="color-scheme" content="light dark" />
        <meta name="theme-color" content="#f6f6f4" />
      </head>
      <body>
        <ServiceWorkerRegister />
        <InstallAppButton />
        <AppUpdateBanner />
        <SplashScreen />
        {children}
      </body>
    </html>
  );
}
