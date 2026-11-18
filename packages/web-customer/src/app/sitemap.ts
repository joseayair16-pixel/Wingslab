import { getWingslabSiteUrl } from '@sadel/shared';
import type { MetadataRoute } from 'next';
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = getWingslabSiteUrl();
  // Next.js normaliza la canónica raíz sin barra final; el sitemap debe usar
  // exactamente la misma URL para evitar señales contradictorias.
  return ['', '/privacidad', '/terminos'].map(path => ({
    url: `${origin}${path}`,
  }));
}
