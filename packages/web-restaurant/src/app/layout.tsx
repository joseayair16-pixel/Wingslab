import type { Metadata } from 'next';
import Script from 'next/script';
import '../styles/globals.css';
import ServiceWorkerRegister from './ServiceWorkerRegister';
import InstallAppButton from '../components/InstallAppButton';
import SplashScreen from '../components/SplashScreen';

export const metadata: Metadata = {
  title: 'SaDeL Restaurant',
  description: 'Opera pedidos, menu y despacho desde el panel de restaurante de SaDeL.',
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
            __html: `(function(){
  try {
    // Hard reset: la PWA SIEMPRE arranca en modo claro, sin importar el modo
    // del sistema ni valores legados de localStorage. El modo oscuro es por
    // sesión: solo se mantiene mientras el usuario no cierre/recargue la app.
    var d = document.documentElement;
    d.classList.remove('dark');
    if (window.localStorage) {
      try { window.localStorage.removeItem('darkMode'); } catch (e) {}
    }
    var cs = document.querySelector('meta[name="color-scheme"]');
    if (cs) cs.setAttribute('content', 'light');
  } catch (e) {}
})();`,
          }}
        />
        <meta name="color-scheme" content="light" />
        <meta name="theme-color" content="#f6f6f4" />
      </head>
      <body>
        <ServiceWorkerRegister />
        <InstallAppButton />
        <SplashScreen />
        <Script 
          src={`https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''}&libraries=places&loading=async`}
          strategy="lazyOnload"
        />
        {children}
      </body>
    </html>
  );
}
