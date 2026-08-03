import type { Metadata } from 'next';
import Script from 'next/script';
import '../styles/globals.css';
import ServiceWorkerRegister from './ServiceWorkerRegister';

export const metadata: Metadata = {
  title: 'SaDeL Restaurant',
  description: 'Opera pedidos, menu y despacho desde el panel de restaurante de SaDeL.',
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
            __html: `(function(){try{var d=document.documentElement;var isDark=localStorage.getItem('darkMode')==='true';if(isDark){d.classList.add('dark');}else{d.classList.remove('dark');}}catch(e){}})();`,
          }}
        />
        <meta name="color-scheme" content="light dark" />
        <meta name="theme-color" content="#f6f6f4" />
      </head>
      <body>
        <ServiceWorkerRegister />
        <Script 
          src={`https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''}&libraries=places&loading=async`}
          strategy="lazyOnload"
        />
        {children}
      </body>
    </html>
  );
}
