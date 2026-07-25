import type { Metadata } from 'next';

export function generateStaticParams() {
  return [];
}

export function generateMetadata(): Metadata {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://sadel.app';

  return {
    title: 'SaDeL - Pide en línea',
    description: 'Descubre y pide desde tu restaurante favorito. Recibe en tu casa o negocio.',
    openGraph: {
      title: 'SaDeL - Pide en línea',
      description: 'Descubre y pide desde tu restaurante favorito.',
      url: siteUrl,
      siteName: 'SaDeL',
      images: [{ url: `${siteUrl}/SaDeL.png`, width: 400, height: 103 }],
      type: 'website',
      locale: 'es_MX',
    },
    twitter: {
      card: 'summary_large_image',
      title: 'SaDeL - Pide en línea',
      description: 'Descubre y pide desde tu restaurante favorito.',
      images: [`${siteUrl}/SaDeL.png`],
    },
    robots: 'index, follow',
  };
}

export default function RestaurantLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
