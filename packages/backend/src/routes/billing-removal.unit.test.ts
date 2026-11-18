import { buildApp } from '../app';

describe('WingsLab route inventory after removing marketplace billing', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp({ enableJobs: false, enableRateLimit: false, enableSocketIO: false });
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  test.each([
    ['GET', '/restaurant-panel/facturacion'],
    ['GET', '/restaurant-panel/facturacion/periodo-actual/pedidos'],
    ['GET', '/restaurant-panel/facturacion/:id/pedidos'],
    ['POST', '/restaurant-panel/facturacion/:id/comprobante'],
    ['GET', '/driver-panel/billetera'],
    ['GET', '/driver-panel/billetera/deuda'],
    ['POST', '/driver-panel/billetera/settlements'],
    ['GET', '/driver-panel/billetera/grafica'],
    ['GET', '/driver-panel/billetera/periodo-actual/pedidos'],
    ['GET', '/driver-panel/billetera/settlements'],
  ] as const)('%s %s is removed, not merely hidden', (method, url) => {
    expect(app.hasRoute({ method, url })).toBe(false);
  });

  test.each([
    ['POST', '/auth/login'],
    ['POST', '/auth/restaurant-login'],
    ['POST', '/auth/driver-login'],
    ['POST', '/pedidos'],
    ['POST', '/pedidos/validar-cupon'],
    ['GET', '/customer/lealtad'],
    ['GET', '/restaurant-panel/reportes'],
    ['GET', '/restaurant-panel/campanas'],
    ['GET', '/restaurant-panel/clientes'],
    ['PATCH', '/restaurant-panel/pedidos/:id/asumir-reparto'],
    ['GET', '/driver-panel/perfil'],
    ['PATCH', '/driver-panel/password'],
    ['GET', '/driver-panel/pedidos/pendientes'],
    ['GET', '/driver-panel/historial'],
    ['GET', '/driver-panel/balance'],
    ['POST', '/driver-panel/qr/reclamar'],
    ['PATCH', '/driver-panel/pedidos/:id/accion'],
    ['GET', '/restaurant-panel/repartidores'],
    ['POST', '/restaurant-panel/repartidores'],
    ['POST', '/restaurant-panel/pedidos/:id/repartidor'],
    ['GET', '/public/delivery-ticket/:token'],
    ['POST', '/public/delivery-ticket/:token/ubicacion'],
    ['POST', '/public/delivery-ticket/:token/entregar'],
  ] as const)('%s %s remains registered', (method, url) => {
    expect(app.hasRoute({ method, url })).toBe(true);
  });
});
