import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: { absolute: 'Mi cuenta | WingsLab' },
  description: 'Consulta tus pedidos y preferencias de cuenta de WingsLab.',
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
      noarchive: true,
      nosnippet: true,
    },
  },
};

export default function CustomerAccountLayout({ children }: { children: React.ReactNode }) {
  return children;
}
