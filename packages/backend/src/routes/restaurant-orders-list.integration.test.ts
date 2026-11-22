/**
 * Regresión del reporte "pedido activo invisible en el restaurante".
 *
 * El panel filtra por fecha en el cliente, pero el backend tampoco debe perder
 * pedidos en curso por el límite del historial. Esta prueba simula 50 pedidos
 * históricos más recientes y un pedido READY antiguo: el antiguo debe volver.
 */
import { OrderStatus, UserRole } from '@prisma/client';
import { FastifyInstance } from 'fastify';

import { buildApp } from '../app';
import { prisma } from '../config/database';

const previousMode = process.env.WINGSLAB_MODE;

function order(id: string, status: OrderStatus, createdAt: string) {
  return {
    id,
    orderReference: `REF-${id}`,
    status,
    createdAt: new Date(createdAt),
    dailyCounter: 1,
    customer: { user: { name: 'Cliente', lastName: 'Prueba' } },
    items: [],
  };
}

describe('GET /restaurant-panel/pedidos', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.WINGSLAB_MODE = 'test';
    app = await buildApp({ enableRateLimit: false, enableSocketIO: false, enableJobs: false });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    if (app) await app.close();
    jest.restoreAllMocks();
    if (previousMode === undefined) delete process.env.WINGSLAB_MODE;
    else process.env.WINGSLAB_MODE = previousMode;
  });

  it('devuelve un pedido activo antiguo aunque haya 50 pedidos históricos más nuevos', async () => {
    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({ status: 'ACTIVE' } as never);
    jest.spyOn(prisma.restaurant, 'findUnique').mockResolvedValue({
      id: 'restaurant-1',
      userId: 'restaurant-user-1',
      status: 'ACTIVE',
      statusReason: null,
    } as never);

    const oldActive = order('old-active', OrderStatus.READY, '2026-11-20T07:26:30.632Z');
    const history = Array.from({ length: 50 }, (_, index) =>
      order(`history-${index}`, OrderStatus.DELIVERED, `2026-11-22T${String(index % 24).padStart(2, '0')}:00:00.000Z`)
    );

    const findMany = jest.spyOn(prisma.order, 'findMany').mockImplementation(((args: {
      where?: { status?: { in?: OrderStatus[]; notIn?: OrderStatus[] } };
      take?: number;
    }) => {
      if (args.where?.status?.in) return Promise.resolve([oldActive]);
      if (args.where?.status?.notIn) return Promise.resolve(history);
      return Promise.resolve([]);
    }) as never);

    const token = app.jwt.sign({
      sub: 'restaurant-user-1',
      phone: '+5215599999999',
      role: UserRole.RESTAURANT,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/restaurant-panel/pedidos',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: Array<{ id: string }> };
    expect(body.data.map((item) => item.id)).toContain('old-active');

    // Los pedidos activos se consultan aparte y sin límite: nunca se truncan.
    const activeQuery = findMany.mock.calls
      .map(([args]) => args as { where?: { status?: { in?: OrderStatus[] } }; take?: number })
      .find((args) => Boolean(args.where?.status?.in));
    expect(activeQuery?.take).toBeUndefined();
    expect(activeQuery?.where?.status?.in).toEqual(
      expect.arrayContaining([OrderStatus.READY, OrderStatus.PREPARING, OrderStatus.IN_TRANSIT])
    );
  });

  it('tampoco trunca un pedido activo cuando se filtra por estado', async () => {
    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({ status: 'ACTIVE' } as never);
    jest.spyOn(prisma.restaurant, 'findUnique').mockResolvedValue({
      id: 'restaurant-1',
      userId: 'restaurant-user-1',
      status: 'ACTIVE',
      statusReason: null,
    } as never);

    const oldActive = order('old-active', OrderStatus.READY, '2026-11-20T07:26:30.632Z');
    const findMany = jest
      .spyOn(prisma.order, 'findMany')
      .mockResolvedValue([oldActive] as never);

    const token = app.jwt.sign({
      sub: 'restaurant-user-1',
      phone: '+5215599999999',
      role: UserRole.RESTAURANT,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/restaurant-panel/pedidos?status=READY',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect((response.json() as { data: Array<{ id: string }> }).data.map((item) => item.id)).toContain('old-active');
    const query = findMany.mock.calls[0][0] as { take?: number };
    expect(query.take).toBeUndefined();
  });
});
