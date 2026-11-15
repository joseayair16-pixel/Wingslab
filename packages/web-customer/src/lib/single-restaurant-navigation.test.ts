import fs from 'node:fs';
import path from 'node:path';
const source = (file: string) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
describe('single-restaurant route wiring', () => {
  test('root mounts the single-restaurant storefront', () => {
    const root = source('app/page.tsx');
    expect(root).toContain('<Storefront');
  });
  test('storefront derives identity from configuration and loads a canonical menu', () => {
    const menu = source('app/restaurantes/[restaurantId]/Storefront.tsx');
    expect(menu).toContain('restaurantId: WINGSLAB_BUSINESS.restaurantId');
    expect(menu).toContain('path: `/menu${getUserLocationQuery()}`');
    expect(menu).not.toContain('use(params)');
  });
  test('legacy business links reject other IDs instead of mounting their menus', () => {
    const route = source('app/restaurantes/[restaurantId]/page.tsx');
    expect(route).toContain('WINGSLAB_BUSINESS.restaurantId) notFound()');
    expect(route).toContain("redirect('/'");
  });
  test('account and sitemap do not discover businesses', () => {
    expect(source('app/cuenta/page.tsx')).not.toMatch(/\/restaurantes|\/public\/(featured|ofertas|zonas)/);
    expect(source('app/sitemap.ts')).not.toMatch(/fetch\(|\/restaurantes/);
  });
});
