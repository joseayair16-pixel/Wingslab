import { getWingslabSiteUrl } from '@sadel/shared';
import type { MetadataRoute } from 'next';

const siteUrl = getWingslabSiteUrl();

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/reparto/', '/api/'],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
