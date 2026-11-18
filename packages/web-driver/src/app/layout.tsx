import type { Metadata } from 'next';
import '../styles/globals.css';
import ServiceWorkerRegister from './ServiceWorkerRegister';
import InstallAppButton from '../components/InstallAppButton';
import SplashScreen from '../components/SplashScreen';

export const metadata: Metadata = {
  title: 'WingsLab · Reparto',
  description: 'Gestiona las entregas propias de WingsLab y consulta tu balance acordado.',
  robots: {
    index: false,
    follow: false,
  },
  manifest: '/manifest.json',
  icons: {
    icon: '/app-icon-192.png',
    apple: '/app-icon-192.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'WingsLab Reparto',
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
    <html lang="es">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var d=document.documentElement;var s=localStorage.getItem('darkMode');var isDark=s===null?window.matchMedia('(prefers-color-scheme: dark)').matches:s==='true';d.classList.toggle('dark',isDark);}catch(e){}})();`,
          }}
        />
        <meta name="color-scheme" content="light dark" />
        <meta name="theme-color" content="#f6f6f4" />
      </head>
      <body>
        <ServiceWorkerRegister />
        <InstallAppButton />
        <SplashScreen />
        {children}
      </body>
    </html>
  );
}
