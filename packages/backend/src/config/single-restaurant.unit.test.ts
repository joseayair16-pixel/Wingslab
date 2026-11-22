import { businessQueryArgs, assertRestaurantId, businessPrincipalAllowed, assertBusinessIdentity, RESTAURANT_ID } from './single-restaurant';
import { marketplaceRouteBlocked, registerSingleRestaurantBoundary } from '../middleware/single-restaurant';
import { prisma } from './database';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { errorHandler } from '../middleware/error.handler';

test('identity is configured, absent browser ID does not choose a restaurant', () => {
  expect(() => assertRestaurantId(undefined)).not.toThrow();
  expect(() => assertRestaurantId(RESTAURANT_ID)).not.toThrow();
  for (const value of ['other', '', null, { equals: RESTAURANT_ID }]) expect(() => assertRestaurantId(value)).toThrow();
});
test.each(['Order', 'Product', 'MenuCategory', 'PromoCode', 'Restaurant'])('%s queries intersect scope, never replace user predicates', model => {
  const where = { id: 'foreign-id', OR: [{ restaurantId: 'foreign' }], AND: [{ deleted: false }] };
  const result = businessQueryArgs(model, 'findUnique', { where });
  expect(result.where.id).toBe('foreign-id');
  expect(result.where.AND).toEqual([{ deleted: false }, { [model === 'Restaurant' ? 'id' : 'restaurantId']: RESTAURANT_ID }]);
  expect(where.AND).toEqual([{ deleted: false }]);
});
test.each(['updateMany', 'deleteMany', 'count', 'aggregate', 'upsert'])('scope applies to %s', operation => {
  expect(businessQueryArgs('Order', operation, { where: {} }).where.AND).toEqual([{ restaurantId: RESTAURANT_ID }]);
});
test('nested delivery and option resources are also scoped', () => {
  expect(businessQueryArgs('DeliveryToken', 'findUnique', { where: { token: 'hashed' } }).where.AND).toEqual([{ order: { restaurantId: RESTAURANT_ID } }]);
  expect(businessQueryArgs('ProductOption', 'updateMany', {}).where.AND).toEqual([{ group: { product: { restaurantId: RESTAURANT_ID } } }]);
});
test('creating businesses, foreign ownership changes and shared delivery cannot be enabled', () => {
  for (const operation of ['create', 'createMany', 'upsert', 'delete', 'deleteMany']) expect(() => businessQueryArgs('Restaurant', operation, {})).toThrow();
  expect(() => businessQueryArgs('Product', 'create', { data: { restaurantId: 'foreign' } })).toThrow();
  expect(() => businessQueryArgs('Product', 'update', { data: { restaurant: { connect: { id: 'foreign' } } } })).toThrow();
  expect(() => businessQueryArgs('Restaurant', 'update', { data: { supportsNetworkDelivery: true } })).toThrow();
  expect(() => businessQueryArgs('Restaurant', 'update', { data: { hasOwnDelivery: false } })).toThrow();
});
test('identity verification fails closed; only the configured restaurant owner is accepted', async () => {
  const db = { restaurant: { findUnique: jest.fn().mockResolvedValue(null) } };
  await expect(assertBusinessIdentity(db)).rejects.toThrow();
  db.restaurant.findUnique.mockResolvedValue({ userId: 'owner', user: { role: 'RESTAURANT' }, hasOwnDelivery: true });
  await expect(assertBusinessIdentity(db)).resolves.toBeUndefined();
  await expect(businessPrincipalAllowed(db, { sub: 'owner', role: 'RESTAURANT' })).resolves.toBe(true);
  await expect(businessPrincipalAllowed(db, { sub: 'other-owner', role: 'RESTAURANT' })).resolves.toBe(false);
  for (const role of ['ADMIN']) await expect(businessPrincipalAllowed(db, { sub: 'owner', role })).resolves.toBe(false);
  await expect(businessPrincipalAllowed(db, { sub: 'driver', role: 'DRIVER' })).resolves.toBe(false);
});
test.each(['/restaurantes', '/admin/restaurantes', '/public/solicitudes', '/restaurant/featured/packages', '/restaurant-panel/pedidos-apoyo', '/restaurant-panel/pedidos/123/solicitar-apoyo'])('marketplace route disabled: %s', path => expect(marketplaceRouteBlocked(path)).toBe(true));
test.each(['/auth/driver-login', '/driver-panel/perfil', '/restaurant-panel/repartidores', '/restaurant-panel/pedidos/123/repartidor'])('account-based driver routes are retired: %s', path => expect(marketplaceRouteBlocked(path)).toBe(true));
test('QR handover is preserved', () => expect(marketplaceRouteBlocked('/restaurant-panel/pedidos/123/handover')).toBe(false));

describe('HTTP boundary rejects tampering before handlers can write', () => {
  const app = Fastify();
  const handler = jest.fn(async () => ({ success: true }));
  beforeAll(async () => {
    await app.register(jwt, { secret: 'hermetic-single-restaurant-test-key' });
    registerSingleRestaurantBoundary(app);
    app.setErrorHandler(errorHandler);
    app.post('/pedidos', handler);
    app.patch('/restaurant-panel/perfil', handler);
    app.post('/restaurant-panel/pedidos/:id/repartidor', handler);
    app.get('/restaurantes/:id', handler);
    app.get('/admin/restaurantes', handler);
    app.get('/menu', handler);
    await app.ready();
  });
  beforeEach(() => {
    handler.mockClear();
    jest.spyOn(prisma.restaurant, 'findUnique').mockResolvedValue({ userId: 'owner' } as never);
    jest.spyOn(prisma.product, 'findFirst').mockResolvedValue(null);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => app.close());
  test.each([
    { method: 'GET', url: '/admin/restaurantes', status: 404 },
    { method: 'GET', url: '/restaurantes/foreign', status: 403 },
    { method: 'POST', url: '/pedidos', payload: { restaurantId: 'foreign' }, status: 403 },
    { method: 'POST', url: '/pedidos', payload: { items: [{ productId: 'foreign-product' }] }, status: 403 },
    { method: 'PATCH', url: '/restaurant-panel/perfil', payload: { supportsNetworkDelivery: true }, status: 403 },
  ])('$method $url is denied', async ({ status, ...request }) => {
    const response = await app.inject(request as any);
    expect(response.statusCode).toBe(status); expect(handler).not.toHaveBeenCalled();
  });
  test('retired account assignment never reaches its handler', async () => {
    const response = await app.inject({ method: 'POST', url: '/restaurant-panel/pedidos/order-1/repartidor', payload: { driverId: 'driver-id' } });
    expect(response.statusCode).toBe(404);
    expect(handler).not.toHaveBeenCalled();
  });
  test('a valid JWT of another restaurant cannot enter the panel', async () => {
    const token = app.jwt.sign({ sub: 'other-owner', role: 'RESTAURANT' });
    const response = await app.inject({ method: 'PATCH', url: '/restaurant-panel/perfil', headers: { authorization: `Bearer ${token}` }, payload: {} });
    expect(response.statusCode).toBe(403); expect(handler).not.toHaveBeenCalled();
  });
  test('canonical menu is public and cannot switch business by query', async () => {
    expect((await app.inject('/menu')).statusCode).toBe(200);
    handler.mockClear();
    expect((await app.inject('/menu?restaurantId=foreign')).statusCode).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });
});
