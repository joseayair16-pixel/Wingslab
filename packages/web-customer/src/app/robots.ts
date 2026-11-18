import { getWingslabSiteUrl } from '@sadel/shared';
import type { MetadataRoute } from 'next';

const siteUrl = getWingslabSiteUrl();

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Las páginas privadas entregan noindex para que los buscadores puedan
        // procesar la directiva. robots.txt no es un mecanismo de privacidad.
        disallow: ['/api/'],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
