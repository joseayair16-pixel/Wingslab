import { UserRole } from '@prisma/client';
import { buildApp } from '../app';
import { prisma } from '../config/database';

describe('retirar productos del menú', () => {
  const restaurant = { id: 'restaurant-1', userId: 'owner-1', status: 'ACTIVE', statusReason: null };
  let app: Awaited<ReturnType<typeof buildApp>>;
  let authorization: string;

  beforeAll(async () => {
    app = await buildApp({ enableRateLimit: false, enableSocketIO: false, enableJobs: false });
    authorization = `Bearer ${app.jwt.sign({ sub: 'owner-1', role: UserRole.RESTAURANT })}`;
  });
  beforeEach(() => {
    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({ status: 'ACTIVE' } as never);
    jest.spyOn(prisma.restaurant, 'findUnique').mockResolvedValue(restaurant as never);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => { await app.close(); });

  it('retira un producto conservando su registro histórico', async () => {
    const find = jest.spyOn(prisma.product, 'findFirst').mockResolvedValue({ id: 'product-1' } as never);
    const update = jest.spyOn(prisma.product, 'updateMany').mockResolvedValue({ count: 1 });
    const remove = jest.spyOn(prisma.product, 'delete');
    const response = await app.inject({ method: 'DELETE', url: '/restaurant-panel/productos/product-1', headers: { authorization } });
    expect(response.statusCode).toBe(200);
    expect(find).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'product-1', deleted: false }) }));
    expect(update).toHaveBeenCalledWith({ where: { id: 'product-1', restaurantId: 'restaurant-1', deleted: false }, data: { deleted: true, isAvailable: false } });
    expect(remove).not.toHaveBeenCalled();
  });

  it('retira en bloque solo productos activos del restaurante', async () => {
    const update = jest.spyOn(prisma.product, 'updateMany').mockResolvedValue({ count: 1 });
    const response = await app.inject({ method: 'DELETE', url: '/restaurant-panel/productos/bulk', headers: { authorization }, payload: { ids: ['product-1'] } });
    expect(response.statusCode).toBe(200);
    expect(update).toHaveBeenCalledWith({ where: { id: { in: ['product-1'] }, restaurantId: 'restaurant-1', deleted: false }, data: { deleted: true, isAvailable: false } });
  });
});
