import { getWingslabSiteUrl } from '@sadel/shared';
import type { MetadataRoute } from 'next';
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = getWingslabSiteUrl();
  return ['', '/privacidad', '/terminos'].map(path => ({ url: origin + path }));
}
