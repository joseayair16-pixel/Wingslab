import Storefront from './restaurantes/[restaurantId]/Storefront';
import { getWingslabSiteUrl } from '@sadel/shared';
import {
  createRestaurantStructuredData,
  generateStorefrontMetadata,
  getPublicRestaurant,
  serializeStructuredData,
} from '../lib/public-site-seo';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return generateStorefrontMetadata();
}

export default async function WingsLabPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [restaurant, siteUrl] = await Promise.all([
    getPublicRestaurant(),
    Promise.resolve(getWingslabSiteUrl()),
  ]);
  const structuredData = restaurant
    ? serializeStructuredData(createRestaurantStructuredData(restaurant, siteUrl))
    : null;

  return (
    <>
      {structuredData ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: structuredData }}
        />
      ) : null}
      <Storefront searchParams={searchParams} initialRestaurant={restaurant} />
    </>
  );
}
