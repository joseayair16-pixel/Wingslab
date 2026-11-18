import {
  buildRestaurantSeoDescription,
  buildRestaurantSeoTitle,
  getWingslabApiUrl,
  getWingslabSiteUrl,
  normalizeSeoText,
  WINGSLAB_BUSINESS,
} from '@sadel/shared';
import type { Metadata } from 'next';
import type { PublicRestaurantDetail } from './public-menu-types';

const FALLBACK_SHARE_IMAGE = '/app-icon-512.png';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPublicRestaurant(value: unknown): value is PublicRestaurantDetail {
  if (!isRecord(value)) return false;
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.description !== 'string' ||
    typeof value.address !== 'string' ||
    typeof value.status !== 'string' ||
    typeof value.isOpen !== 'boolean' ||
    typeof value.hasOwnDelivery !== 'boolean' ||
    !Array.isArray(value.categories)
  ) return false;

  return value.categories.every((category) =>
    isRecord(category) &&
    typeof category.id === 'string' &&
    typeof category.name === 'string' &&
    Array.isArray(category.products) &&
    category.products.every((product) =>
      isRecord(product) &&
      typeof product.id === 'string' &&
      typeof product.name === 'string' &&
      typeof product.description === 'string' &&
      typeof product.price === 'number'
    )
  );
}

function withoutInlineMedia(restaurant: PublicRestaurantDetail): PublicRestaurantDetail {
  const withoutDataUrl = (value: string | null | undefined) =>
    value?.trim().toLowerCase().startsWith('data:') ? null : value;

  return {
    ...restaurant,
    logo: withoutDataUrl(restaurant.logo),
    coverImage: withoutDataUrl(restaurant.coverImage),
    categories: restaurant.categories.map((category) => ({
      ...category,
      products: category.products.map((product) => ({
        ...product,
        image: withoutDataUrl(product.image),
        images: product.images?.filter((image) => !image.trim().toLowerCase().startsWith('data:')),
      })),
    })),
  };
}

async function fetchPublicRestaurant(): Promise<PublicRestaurantDetail | null> {
  try {
    const apiUrl = getWingslabApiUrl();
    const response = await fetch(new URL('/menu', apiUrl), {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) return null;

    const payload: unknown = await response.json();
    if (!isRecord(payload) || payload.success !== true || !isPublicRestaurant(payload.data)) return null;
    return withoutInlineMedia(payload.data);
  } catch {
    // SEO generation must not make the public menu unavailable when the API is down.
    return null;
  }
}

let inFlightPublicRestaurant: Promise<PublicRestaurantDetail | null> | null = null;

/** Fetches only the unauthenticated public menu; concurrent page/metadata renders share it. */
export function getPublicRestaurant(): Promise<PublicRestaurantDetail | null> {
  if (inFlightPublicRestaurant) return inFlightPublicRestaurant;

  const request = fetchPublicRestaurant();
  inFlightPublicRestaurant = request;
  void request.finally(() => {
    if (inFlightPublicRestaurant === request) inFlightPublicRestaurant = null;
  });
  return request;
}

function publicBusinessName(restaurant: PublicRestaurantDetail | null): string {
  return normalizeSeoText(restaurant?.name) || WINGSLAB_BUSINESS.name;
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

/** Only emit crawlable HTTP(S) images; memory-storage data URLs are never social images. */
export function resolveShareImage(
  restaurant: PublicRestaurantDetail | null,
  siteUrl: string,
): string {
  const fallback = new URL(FALLBACK_SHARE_IMAGE, siteUrl).toString();
  const candidates = [restaurant?.coverImage, restaurant?.logo];

  for (const candidate of candidates) {
    if (!candidate || candidate.trim().toLowerCase().startsWith('data:')) continue;
    try {
      const imageUrl = new URL(candidate, siteUrl);
      if (imageUrl.username || imageUrl.password || !['https:', 'http:'].includes(imageUrl.protocol)) continue;
      if (imageUrl.protocol === 'http:' && !isLoopback(imageUrl.hostname)) continue;
      return imageUrl.toString();
    } catch {
      // Ignore malformed configured URLs and use the next safe image.
    }
  }

  return fallback;
}

export function createStorefrontMetadata(
  restaurant: PublicRestaurantDetail | null,
  siteUrl: string,
): Metadata {
  const name = publicBusinessName(restaurant);
  const title = buildRestaurantSeoTitle({ ...(restaurant ?? {}), name });
  const description = buildRestaurantSeoDescription(restaurant);
  const shareImage = resolveShareImage(restaurant, siteUrl);
  const canonicalUrl = siteUrl.replace(/\/+$/, '');

  return {
    title: { absolute: title },
    description,
    alternates: { canonical: '/' },
    openGraph: {
      type: 'website',
      siteName: name,
      locale: 'es_MX',
      url: canonicalUrl,
      title,
      description,
      images: [{ url: shareImage, alt: `Menú de ${name}` }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [shareImage],
    },
    robots: { index: true, follow: true },
  };
}

function safeSocialUrl(value: string | null | undefined, allowedHosts: string[]): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || !allowedHosts.includes(url.hostname.toLowerCase())) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function buildOpeningHours(restaurant: PublicRestaurantDetail) {
  const days = [
    'https://schema.org/Sunday',
    'https://schema.org/Monday',
    'https://schema.org/Tuesday',
    'https://schema.org/Wednesday',
    'https://schema.org/Thursday',
    'https://schema.org/Friday',
    'https://schema.org/Saturday',
  ];

  return (restaurant.operatingHours ?? [])
    .filter((shift) =>
      Number.isInteger(shift.dayOfWeek) &&
      shift.dayOfWeek >= 0 && shift.dayOfWeek < days.length &&
      !shift.isClosed &&
      /^([01]\d|2[0-3]):[0-5]\d$/.test(shift.openTime) &&
      /^([01]\d|2[0-3]):[0-5]\d$/.test(shift.closeTime)
    )
    .map((shift) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: days[shift.dayOfWeek],
      opens: shift.openTime,
      closes: shift.closeTime,
    }));
}

export function createRestaurantStructuredData(
  restaurant: PublicRestaurantDetail | null,
  siteUrl: string,
): JsonRecord {
  const name = publicBusinessName(restaurant);
  const canonicalUrl = siteUrl.replace(/\/+$/, '');
  const structuredData: JsonRecord = {
    '@context': 'https://schema.org',
    '@type': restaurant?.businessType === 'STORE' ? 'Store' : 'Restaurant',
    name,
    url: canonicalUrl,
    description: buildRestaurantSeoDescription(restaurant),
    image: resolveShareImage(restaurant, siteUrl),
    hasMenu: canonicalUrl,
  };

  if (restaurant?.address.trim()) {
    structuredData.address = {
      '@type': 'PostalAddress',
      streetAddress: normalizeSeoText(restaurant.address),
    };
  }

  if (restaurant?.contactPhone?.trim()) structuredData.telephone = normalizeSeoText(restaurant.contactPhone);
  if (restaurant?.regionName?.trim()) structuredData.areaServed = normalizeSeoText(restaurant.regionName);

  if (
    restaurant &&
    typeof restaurant.latitude === 'number' && Number.isFinite(restaurant.latitude) &&
    restaurant.latitude >= -90 && restaurant.latitude <= 90 &&
    typeof restaurant.longitude === 'number' && Number.isFinite(restaurant.longitude) &&
    restaurant.longitude >= -180 && restaurant.longitude <= 180
  ) {
    structuredData.geo = {
      '@type': 'GeoCoordinates',
      latitude: restaurant.latitude,
      longitude: restaurant.longitude,
    };
  }

  const sameAs = [
    safeSocialUrl(restaurant?.instagram, ['instagram.com', 'www.instagram.com']),
    safeSocialUrl(restaurant?.facebook, ['facebook.com', 'www.facebook.com']),
    safeSocialUrl(restaurant?.tiktok, ['tiktok.com', 'www.tiktok.com']),
  ].filter((value): value is string => value !== null);
  if (sameAs.length) structuredData.sameAs = sameAs;

  const openingHours = restaurant ? buildOpeningHours(restaurant) : [];
  if (openingHours.length) structuredData.openingHoursSpecification = openingHours;

  return structuredData;
}

export function serializeStructuredData(value: JsonRecord): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export async function generateStorefrontMetadata(): Promise<Metadata> {
  const [restaurant, siteUrl] = await Promise.all([
    getPublicRestaurant(),
    Promise.resolve(getWingslabSiteUrl()),
  ]);
  return createStorefrontMetadata(restaurant, siteUrl);
}
