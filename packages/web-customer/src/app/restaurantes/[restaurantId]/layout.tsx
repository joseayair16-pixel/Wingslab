import type { Metadata } from 'next';
import { cache } from 'react';
import { getMenuThemeById } from '@sadel/shared';

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
  menuTheme?: string | null;
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
    const res = await fetch(`${backendUrl}/restaurantes/${id}`, { cache: 'no-store' });
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

// Extrae el primer color hex de un gradiente CSS para el theme-color de la PWA.
function gradientStartColor(gradient: string): string | null {
  const match = gradient.match(/#[0-9a-fA-F]{6}/);
  return match ? match[0].toLowerCase() : null;
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

  const menuTheme = getMenuThemeById(restaurant?.menuTheme ?? null);
  const menuThemeColor = menuTheme ? (gradientStartColor(menuTheme.gradientLight) ?? '#fafafa') : null;
  // Color del header compacto sticky: en claro usamos el inicio del gradiente
  // del tema (los temas tienen surface blanco en light, así que sin esto el
  // header se vería sin pintar); en oscuro, su superficie oscura real.
  const menuHeaderColor = menuTheme ? (gradientStartColor(menuTheme.gradientLight) ?? '#ffffff') : '#ffffff';
  const menuHeaderDarkColor = menuTheme?.surfaceDark ?? '#0c0c0e';

  return (
    <>
      {menuThemeColor && <meta name="theme-color" content={menuThemeColor} />}
      {restaurant && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(buildRestaurantJsonLd(restaurant)) }}
        />
      )}
      <style>{`:root {
  --menu-accent: ${accent};
  --menu-accent-strong: ${accentStrong};
  --menu-accent-soft: ${accentSoft};
  --menu-accent-soft-strong: ${accentSoftStrong};
  --menu-accent-hover: ${darkenHex(accent, 0.68)};
  --menu-bg: ${menuTheme ? menuTheme.gradientLight : '#fafafa'};
  --menu-bg-dark: ${menuTheme ? menuTheme.gradientDark : '#0b0b0d'};
  --menu-surface: ${menuTheme ? menuTheme.surface : '#ffffff'};
  --menu-surface-dark: ${menuTheme ? menuTheme.surfaceDark : '#0c0c0e'};
  --menu-header: ${menuHeaderColor};
  --menu-header-dark: ${menuHeaderDarkColor};
  --menu-card: ${menuTheme ? menuTheme.card : '#ffffff'};
  --menu-card-dark: ${menuTheme ? menuTheme.cardDark : '#0c0c0e'};
}`}</style>
      {children}
    </>
  );
}
