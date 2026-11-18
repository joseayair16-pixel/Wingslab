import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: { absolute: 'Seguimiento de entrega | WingsLab' },
  description: 'Página privada para consultar y gestionar una entrega autorizada.',
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

export function generateStaticParams() {
  return [];
}

export default function DeliveryTicketLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
