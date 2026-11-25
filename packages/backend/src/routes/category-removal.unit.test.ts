import { UserRole } from '@prisma/client';
import { buildApp } from '../app';
import { prisma } from '../config/database';

describe('retirar categorías del menú', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let authorization: string;
  beforeAll(async () => {
    app = await buildApp({ enableRateLimit: false, enableSocketIO: false, enableJobs: false });
    authorization = `Bearer ${app.jwt.sign({ sub: 'owner-1', role: UserRole.RESTAURANT })}`;
  });
  beforeEach(() => {
    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({ status: 'ACTIVE' } as never);
    jest.spyOn(prisma.restaurant, 'findUnique').mockResolvedValue({ id: 'restaurant-1', userId: 'owner-1', status: 'ACTIVE' } as never);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => { await app.close(); });

  it('retira la categoría sin borrar productos históricos', async () => {
    const find = jest.spyOn(prisma.menuCategory, 'findFirst').mockResolvedValue({ id: 'category-1', products: [] } as never);
    const update = jest.spyOn(prisma.menuCategory, 'updateMany').mockResolvedValue({ count: 1 });
    const remove = jest.spyOn(prisma.menuCategory, 'delete');
    const response = await app.inject({ method: 'DELETE', url: '/restaurant-panel/categorias/category-1', headers: { authorization } });
    expect(response.statusCode).toBe(204);
    expect(find).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ deleted: false }), include: { products: { where: { deleted: false }, select: { id: true } } } }));
    expect(update).toHaveBeenCalledWith({ where: { id: 'category-1', restaurantId: 'restaurant-1', deleted: false, products: { none: { deleted: false } } }, data: { deleted: true } });
    expect(remove).not.toHaveBeenCalled();
  });

  it('no retira categorías con productos activos', async () => {
    jest.spyOn(prisma.menuCategory, 'findFirst').mockResolvedValue({ id: 'category-1', products: [{ id: 'product-1' }] } as never);
    const update = jest.spyOn(prisma.menuCategory, 'updateMany');
    const response = await app.inject({ method: 'DELETE', url: '/restaurant-panel/categorias/category-1', headers: { authorization } });
    expect(response.statusCode).toBe(409);
    expect(update).not.toHaveBeenCalled();
  });
});
