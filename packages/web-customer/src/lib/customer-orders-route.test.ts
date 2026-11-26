import fs from 'node:fs';
import path from 'node:path';
const source = (file: string) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
const projectFile = (file: string) => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
describe('customer orders route', () => {
  test('verified payment returns home and offers the orders section', () => {
    const page = source('app/pago/tarjeta/page.tsx');
    const modal = source('components/CardPaymentResultModal.tsx');
    expect(page).toContain("router.replace('/')");
    expect(modal).toContain('/cuenta#pedidos');
    expect(page).not.toContain('href="/pedidos"');
  });
  test('legacy /pedidos links redirect instead of returning 404', () => {
    const config = projectFile('next.config.js');
    expect(config).toContain("source: '/pedidos'");
    expect(config).toContain("destination: '/cuenta#pedidos'");
  });
  test('an unavailable card session returns to checkout with an informational dialog', () => {
    const page = source('app/pago/tarjeta/page.tsx');
    const storefront = source('app/restaurantes/[restaurantId]/Storefront.tsx');
    expect(page).toContain('router.replace(`${back}&cardNotice=unavailable`)');
    expect(storefront).toContain('card-session-notice-title');
    expect(storefront).toContain("url.searchParams.delete('cardNotice')");
  });
});
