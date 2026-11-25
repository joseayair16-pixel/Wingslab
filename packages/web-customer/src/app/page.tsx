import Storefront from './restaurantes/[restaurantId]/Storefront';
import { getWingslabApiUrl, getWingslabSiteUrl } from '@sadel/shared';
import {
  createRestaurantStructuredData,
  generateStorefrontMetadata,
  getPublicRestaurant,
  serializeStructuredData,
} from '../lib/public-site-seo';
import type { Metadata } from 'next';
import { ClientOnly } from '../components/ClientOnly';
import { MENU_PROMOTIONS_PATH, menuPromotionImage, readMenuPromotions, type MenuPromotion } from '../lib/menu-promotions';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return generateStorefrontMetadata();
}

async function getInitialBanners(): Promise<MenuPromotion[]> {
  try {
    const response = await fetch(new URL(MENU_PROMOTIONS_PATH, getWingslabApiUrl()), {
      cache: 'no-store',
      signal: AbortSignal.timeout(350),
    });
    if (!response.ok) return [];
    // The server doesn't have the session in localStorage. Only preload and
    // render banners that are intended for both audiences.
    return readMenuPromotions(await response.json())?.filter(item => item.kind === 'banner' && item.audience === 'all') ?? [];
  } catch {
    // Promotions are optional and must not hold up the menu.
    return [];
  }
}

export default async function WingsLabPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [restaurant, initialBanners] = await Promise.all([
    getPublicRestaurant(),
    getInitialBanners(),
  ]);
  const structuredData = restaurant
    ? serializeStructuredData(createRestaurantStructuredData(restaurant, getWingslabSiteUrl()))
    : null;

  return (
    <>
      {initialBanners[0] && <link rel="preload" as="image" fetchPriority="high" href={menuPromotionImage('/api', initialBanners[0].imageId)} />}
      {structuredData ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: structuredData }}
        />
      ) : null}
      <ClientOnly><Storefront searchParams={searchParams} initialRestaurant={restaurant} initialBanners={initialBanners} /></ClientOnly>
    </>
  );
}
