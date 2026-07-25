import type { Metadata } from 'next';

const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001').replace(/\/+$/, '');

type PublicRestaurantDetail = {
  id: string;
  name: string;
  description: string;
  address: string;
  region: string;
  logo?: string | null;
  coverImage?: string | null;
  status: string;
  isOpen: boolean;
};

async function getRestaurant(id: string): Promise<PublicRestaurantDetail | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${apiBase}/restaurantes/${id}`, {
      signal: controller.signal,
      next: { revalidate: 60 },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const json = await res.json();
    if (json.success && json.data) return json.data as PublicRestaurantDetail;
  } catch {}
  return null;
}

function buildOgImage(restaurant: PublicRestaurantDetail | null, siteUrl: string): { url: string; width: number; height: number } {
  if (restaurant?.logo) return { url: restaurant.logo, width: 1200, height: 630 };
  if (restaurant?.coverImage) return { url: restaurant.coverImage, width: 1200, height: 630 };
  return { url: `${siteUrl}/SaDeL.png`, width: 400, height: 103 };
}

export async function generateMetadata({ params }: { params: { restaurantId: string } }): Promise<Metadata> {
  const restaurant = await getRestaurant(params.restaurantId);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://sadel.app';

  const title = restaurant
    ? `${restaurant.name} | SaDeL - Pide en línea`
    : 'SaDeL - Pide en línea';

  const description = restaurant?.description?.trim()
    ? restaurant.description
    : 'Descubre y pide desde tu restaurante favorito. Recibe en tu casa o negocio.';

  const ogImage = buildOgImage(restaurant, siteUrl);

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${siteUrl}/restaurantes/${params.restaurantId}`,
      siteName: 'SaDeL',
      images: [{ ...ogImage, alt: restaurant?.name || 'SaDeL' }],
      type: 'website',
      locale: 'es_MX',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImage.url],
    },
    robots: 'index, follow',
  };
}

export default function RestaurantLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
