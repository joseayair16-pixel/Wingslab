import type { MetadataRoute } from 'next';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://pideloporsadel.app';
const backendUrl = process.env.BACKEND_URL || 'https://sadel-production.up.railway.app';

const STATIC_PAGES: MetadataRoute.Sitemap = [
  { url: siteUrl, changeFrequency: 'daily', priority: 1 },
  { url: `${siteUrl}/privacidad`, changeFrequency: 'monthly', priority: 0.3 },
  { url: `${siteUrl}/terminos`, changeFrequency: 'monthly', priority: 0.3 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const restaurantUrls: MetadataRoute.Sitemap = [];

  try {
    const limit = 50;
    let page = 1;
    let hasMore = true;
    let guard = 0;

    while (hasMore && guard < 30) {
      guard += 1;
      const res = await fetch(`${backendUrl}/restaurantes?page=${page}&limit=${limit}`, {
        next: { revalidate: 3600 },
      });
      if (!res.ok) break;

      const json = (await res.json()) as {
        data?: { items?: Array<{ id: string; updatedAt?: string }>; hasMore?: boolean };
      };
      const items = json?.data?.items ?? [];
      for (const item of items) {
        restaurantUrls.push({
          url: `${siteUrl}/restaurantes/${item.id}`,
          changeFrequency: 'daily',
          priority: 0.8,
          lastModified: item.updatedAt ? new Date(item.updatedAt) : undefined,
        });
      }

      hasMore = json?.data?.hasMore === true && items.length > 0;
      page += 1;
    }
  } catch {
    // Si el backend no responde, el sitemap solo incluye las páginas estáticas.
  }

  return [...STATIC_PAGES, ...restaurantUrls];
}
