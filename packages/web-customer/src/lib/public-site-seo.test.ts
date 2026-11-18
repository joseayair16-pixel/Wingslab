import type { PublicRestaurantDetail } from './public-menu-types';
import {
  createRestaurantStructuredData,
  createStorefrontMetadata,
  resolveShareImage,
  serializeStructuredData,
} from './public-site-seo';

const restaurant: PublicRestaurantDetail = {
  id: 'restaurant-1',
  name: 'WingsLab Centro',
  description: 'Alitas, hamburguesas y bebidas preparadas al momento.',
  address: 'Av. Principal 123',
  region: 'centro',
  regionName: 'Centro',
  logo: null,
  coverImage: 'data:image/webp;base64,abc',
  contactPhone: '+52 555 000 0000',
  instagram: 'https://www.instagram.com/wingslab/',
  facebook: 'javascript:alert(1)',
  tiktok: 'https://www.tiktok.com/@wingslab',
  businessType: 'RESTAURANT',
  status: 'ACTIVE',
  isOpen: true,
  hasOwnDelivery: true,
  minDeliveryTime: 30,
  maxDeliveryTime: 60,
  latitude: 19.4326,
  longitude: -99.1332,
  operatingHours: [
    { dayOfWeek: 5, shiftIndex: 0, openTime: '12:00', closeTime: '22:00', isClosed: false },
    { dayOfWeek: 6, shiftIndex: 0, openTime: '00:00', closeTime: '00:00', isClosed: true },
  ],
  categories: [],
};

describe('public restaurant SEO metadata', () => {
  test('derives title, description, canonical, and social card from restaurant settings', () => {
    const metadata = createStorefrontMetadata(restaurant, 'https://wingslab.example');

    expect(metadata.title).toEqual({ absolute: 'Menú en línea de WingsLab Centro' });
    expect(metadata.description).toContain(restaurant.description);
    expect(metadata.description).toContain('recibir a domicilio');
    expect(metadata.alternates?.canonical).toBe('/');
    expect(metadata.openGraph).toMatchObject({
      siteName: restaurant.name,
      url: 'https://wingslab.example',
      locale: 'es_MX',
    });
    expect(metadata.twitter).toMatchObject({ card: 'summary_large_image' });
  });

  test('prefers explicit SEO overrides configured in the restaurant panel', () => {
    const metadata = createStorefrontMetadata(
      {
        ...restaurant,
        seoTitle: 'Alitas a domicilio en la ciudad',
        seoDescription: 'Pide alitas buffalo y combos para compartir con entrega propia.',
      },
      'https://wingslab.example',
    );

    expect(metadata.title).toEqual({ absolute: 'Alitas a domicilio en la ciudad' });
    expect(metadata.description).toBe('Pide alitas buffalo y combos para compartir con entrega propia.');
    expect(metadata.openGraph).toMatchObject({
      title: 'Alitas a domicilio en la ciudad',
      description: 'Pide alitas buffalo y combos para compartir con entrega propia.',
    });
  });

  test('uses safe social image fallback for inline media and rejects insecure external images', () => {
    expect(resolveShareImage(restaurant, 'https://wingslab.example'))
      .toBe('https://wingslab.example/app-icon-512.png');
    expect(resolveShareImage({ ...restaurant, coverImage: 'http://untrusted.example/image.jpg' }, 'https://wingslab.example'))
      .toBe('https://wingslab.example/app-icon-512.png');
  });

  test('emits only configured structured data and safely serializes user text', () => {
    const structuredData = createRestaurantStructuredData(
      { ...restaurant, description: '</script><script>alert(1)</script>' },
      'https://wingslab.example',
    );
    const serialized = serializeStructuredData({ ...structuredData, name: '</script>' });

    expect(structuredData).toMatchObject({
      '@type': 'Restaurant',
      name: restaurant.name,
      url: 'https://wingslab.example',
      hasMenu: 'https://wingslab.example',
      telephone: restaurant.contactPhone,
      areaServed: restaurant.regionName,
      sameAs: ['https://www.instagram.com/wingslab/', 'https://www.tiktok.com/@wingslab'],
      geo: { latitude: 19.4326, longitude: -99.1332 },
    });
    expect(structuredData.description).not.toContain('<script>');
    expect(structuredData.openingHoursSpecification).toHaveLength(1);
    expect(serialized).not.toContain('</script>');
    expect(serialized).toContain('\\u003c/script');
  });
});
