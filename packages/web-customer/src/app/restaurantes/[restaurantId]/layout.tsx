import type { Metadata } from 'next';
import { cache } from 'react';

export const dynamic = 'force-dynamic';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://pideloporsadel.app';
const backendUrl = process.env.BACKEND_URL || 'https://sadel-production.up.railway.app';

type RestaurantMeta = {
  id: string;
  name: string;
  description: string;
  address: string;
  region: string;
  logo?: string | null;
  accentColor?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  businessType?: string | null;
  hasOwnDelivery?: boolean;
  instagram?: string | null;
  facebook?: string | null;
  tiktok?: string | null;
  rating?: number;
  reviewCount?: number;
};

// cache() deduplica el fetch dentro de la misma petición: generateMetadata y el
// JSON-LD server-side comparten una sola llamada al backend.
const getRestaurant = cache(async (id: string): Promise<RestaurantMeta | null> => {
  try {
    const res = await fetch(`${backendUrl}/restaurantes/${id}`, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: RestaurantMeta };
    return json?.data ?? null;
  } catch {
    return null;
  }
});

function buildRestaurantJsonLd(restaurant: RestaurantMeta) {
  const sameAs: string[] = [];
  if (restaurant.instagram) sameAs.push(restaurant.instagram);
  if (restaurant.facebook) sameAs.push(restaurant.facebook);
  if (restaurant.tiktok) sameAs.push(restaurant.tiktok);

  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name: restaurant.name,
    url: `${siteUrl}/restaurantes/${restaurant.id}`,
    address: {
      '@type': 'PostalAddress',
      streetAddress: restaurant.address,
      addressRegion: restaurant.region,
      addressCountry: 'MX',
    },
  };

  if (restaurant.description) schema.description = restaurant.description;
  if (restaurant.logo) schema.image = restaurant.logo;
  if (restaurant.latitude && restaurant.longitude) {
    schema.geo = {
      '@type': 'GeoCoordinates',
      latitude: restaurant.latitude,
      longitude: restaurant.longitude,
    };
  }
  if (restaurant.rating && restaurant.reviewCount) {
    schema.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: Math.min(5, Math.max(0, restaurant.rating)),
      reviewCount: restaurant.reviewCount,
    };
  }
  if (sameAs.length > 0) schema.sameAs = sameAs;

  return schema;
}

export async function generateMetadata({ params }: { params: { restaurantId: string } }): Promise<Metadata> {
  const restaurant = await getRestaurant(params.restaurantId);
  const canonical = `${siteUrl}/restaurantes/${params.restaurantId}`;

  if (!restaurant) {
    return {
      title: 'Pídelo por aquí',
      description: 'Pide desde este negocio con SaDeL. Recoge en tienda o recibe en casa.',
      alternates: { canonical },
      robots: { index: true, follow: true },
    };
  }

  const ogTitle = `${restaurant.name} · Pídelo por SaDeL`;
  const description =
    restaurant.description?.trim() ||
    `Tu negocio físico, ahora también en digital: ${restaurant.name} llega a más personas con SaDeL. Pide en línea y recoge en tienda o recibe a domicilio.`;
  const shareImage = restaurant.logo || `${siteUrl}/app-icon-512.png`;

  return {
    metadataBase: new URL(siteUrl),
    title: restaurant.name,
    description,
    alternates: { canonical },
    openGraph: {
      type: 'website',
      siteName: 'SaDeL',
      locale: 'es_MX',
      url: canonical,
      title: ogTitle,
      description,
      images: [{ url: shareImage, alt: restaurant.name }],
    },
    twitter: {
      card: 'summary',
      title: ogTitle,
      description,
      images: [shareImage],
    },
    robots: { index: true, follow: true },
  };
}

function darkenHex(hex: string, factor = 0.78): string {
  const clean = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return '#0a7fbf';
  const r = Math.round(parseInt(clean.slice(0, 2), 16) * factor);
  const g = Math.round(parseInt(clean.slice(2, 4), 16) * factor);
  const b = Math.round(parseInt(clean.slice(4, 6), 16) * factor);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export default async function RestaurantLayout({
  params,
  children,
}: {
  params: { restaurantId: string };
  children: React.ReactNode;
}) {
  const restaurant = await getRestaurant(params.restaurantId);
  const accent =
    restaurant?.accentColor && /^#[0-9a-fA-F]{6}$/.test(restaurant.accentColor)
      ? restaurant.accentColor
      : '#0ea5e9';
  const accentStrong = darkenHex(accent);
  const accentSoft = `${accent}1A`;
  const accentSoftStrong = `${accent}2E`;

  return (
    <>
      {restaurant && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(buildRestaurantJsonLd(restaurant)) }}
        />
      )}
      <style>{`:root {
  --accent: ${accent};
  --accent-strong: ${accentStrong};
  --accent-soft: ${accentSoft};
  --accent-soft-strong: ${accentSoftStrong};
}`}</style>
      {children}
    </>
  );
}
