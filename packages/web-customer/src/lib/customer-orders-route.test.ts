import fs from 'node:fs';
import path from 'node:path';
const source = (file: string) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
const projectFile = (file: string) => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
describe('customer orders route', () => {
  test('the payment confirmation opens the account orders section', () => {
    const page = source('app/pago/tarjeta/page.tsx');
    expect(page).toContain('/cuenta#pedidos');
    expect(page).not.toContain('href="/pedidos"');
  });
  test('legacy /pedidos links redirect instead of returning 404', () => {
    const config = projectFile('next.config.js');
    expect(config).toContain("source: '/pedidos'");
    expect(config).toContain("destination: '/cuenta#pedidos'");
  });
});
