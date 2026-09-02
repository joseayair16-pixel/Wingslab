import { DriverAvailability, DriverStatus, OrderStatus } from '@prisma/client';

jest.mock('../config/database', () => ({
  prisma: {
    order: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      groupBy: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    driver: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    restaurant: {
      findUnique: jest.fn(),
    },
    orderTracking: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('../config/redis', () => ({
  getRedis: jest.fn().mockImplementation(() => {
    throw new Error('redis no disponible en pruebas');
  }),
}));

jest.mock('./notification.service', () => ({
  sendPushNotification: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('./socket.service', () => ({
  emitNotification: jest.fn(),
}));

import { prisma } from '../config/database';
import { autoAssignDriver } from './order-workflow.service';

const prismaMock = prisma as unknown as {
  order: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    groupBy: jest.Mock;
    updateMany: jest.Mock;
    findMany: jest.Mock;
    findUniqueOrThrow: jest.Mock;
  };
  driver: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
  };
  restaurant: { findUnique: jest.Mock };
  orderTracking: { create: jest.Mock };
  $transaction: jest.Mock;
};

function makeDriver(id: string, options: { availability?: DriverAvailability; orders?: any[] } = {}) {
  return {
    id,
    userId: `user-${id}`,
    rating: 0,
    totalDeliveries: 0,
    currentLatitude: 20.5,
    currentLongitude: -103.5,
    createdAt: new Date(),
    updatedAt: new Date(),
    region: 'centro',
    status: DriverStatus.ACTIVE,
    availability: options.availability ?? DriverAvailability.AVAILABLE,
    orders: options.orders ?? [],
    user: { id: `user-${id}`, name: `Driver ${id}`, phone: '3311111111' },
  };
}

// Pool de repartidores controlado por cada test.
let driverPool: ReturnType<typeof makeDriver>[];

beforeEach(() => {
  jest.clearAllMocks();
  driverPool = [];

  prismaMock.order.findUnique.mockImplementation(async () => ({
    fulfillmentType: 'DELIVERY',
    supportRestaurantId: null,
    latitude: 20.5,
    longitude: -103.5,
    restaurant: {
      id: 'rest-1',
      name: 'Restaurante',
      userId: 'rest-user-1',
      hasOwnDelivery: false,
      deliveryFee: 30,
    } as any,
  }));

  prismaMock.order.findFirst.mockImplementation(async () => ({
    id: 'order-1',
    status: OrderStatus.CONFIRMED,
    fulfillmentType: 'DELIVERY',
    restaurant: {
      id: 'rest-1',
      region: 'centro',
      hasOwnDelivery: false,
      latitude: 20.5,
      longitude: -103.5,
    },
    customer: { user: { name: 'Cliente' } },
  } as never));

  prismaMock.restaurant.findUnique.mockResolvedValue({
    id: 'rest-1',
    status: 'ACTIVE' as const,
    region: 'centro',
    latitude: 20.5,
    longitude: -103.5,
  } as never);

  prismaMock.order.groupBy.mockResolvedValue([]);

  prismaMock.driver.findMany.mockImplementation(async ({ where }: any) => {
    const excluded = (where?.id?.notIn as string[]) ?? [];
    return driverPool.filter((d) => !excluded.includes(d.id));
  });

  // assignDriverToOrder internals
  prismaMock.driver.findFirst.mockImplementation(async ({ where }: any) => {
    return driverPool.find((d) => d.id === where.id) ?? null;
  });
  prismaMock.order.updateMany.mockResolvedValue({ count: 1 } as never);
  prismaMock.driver.update.mockResolvedValue({} as never);
  prismaMock.order.findUniqueOrThrow.mockResolvedValue({
    id: 'order-1',
    orderReference: 'R-12345',
    status: OrderStatus.CONFIRMED,
    driverId: 'driver-a',
    restaurant: { name: 'Restaurante' },
    deliveryFee: 30,
    deliveryDistanceKm: 2,
  } as never);
  prismaMock.orderTracking.create.mockResolvedValue({} as never);
  prismaMock.order.findMany.mockResolvedValue([]);

  prismaMock.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
});

describe('autoAssignDriver', () => {
  it('respeta el límite de pedidos activos (normal 3 / overload 5)', async () => {
    driverPool = [makeDriver('driver-a')];
    // 5 pedidos activos: rebasa el tope normal (3) y también el de overload (5).
    prismaMock.order.groupBy.mockResolvedValue([
      { driverId: 'driver-a', _count: { _all: 5 } },
    ] as never);

    const result = await autoAssignDriver(prisma as never, 'order-1', 'rest-user-1');

    expect(result.success).toBe(false);
    expect(prismaMock.order.updateMany).not.toHaveBeenCalled();
  });

  it('un repartidor con 4 pedidos solo se considera en el pase de overload (máx 5)', async () => {
    driverPool = [makeDriver('driver-a')];
    prismaMock.order.groupBy.mockResolvedValue([
      { driverId: 'driver-a', _count: { _all: 4 } },
    ] as never);

    const result = await autoAssignDriver(prisma as never, 'order-1', 'rest-user-1');

    // En overload el tope es 5, así que sí se puede asignar al de 4 pedidos.
    expect(result.success).toBe(true);
    expect((result as any).driver?.id).toBe('driver-a');
  });

  it('salta al saturado (tope 3) y asigna al siguiente con cupo', async () => {
    driverPool = [makeDriver('driver-a'), makeDriver('driver-b')];
    prismaMock.order.groupBy.mockResolvedValue([
      { driverId: 'driver-a', _count: { _all: 3 } },
      { driverId: 'driver-b', _count: { _all: 0 } },
    ] as never);

    const result = await autoAssignDriver(prisma as never, 'order-1', 'rest-user-1');

    expect(result.success).toBe(true);
    expect((result as any).driver?.id).toBe('driver-b');
  });

  it('los repartidores excluidos siguen excluidos (no se intentan asignar)', async () => {
    driverPool = [makeDriver('driver-a')];
    prismaMock.order.groupBy.mockResolvedValue([
      { driverId: 'driver-a', _count: { _all: 0 } },
    ] as never);

    const result = await autoAssignDriver(prisma as never, 'order-1', 'rest-user-1', 'driver-a');

    expect(result.success).toBe(false);
    expect(prismaMock.order.updateMany).not.toHaveBeenCalled();
  });

  it('el claim atómico sigue evitando doble asignación (ORDER_ALREADY_ASSIGNED)', async () => {
    driverPool = [makeDriver('driver-a')];
    prismaMock.order.groupBy.mockResolvedValue([
      { driverId: 'driver-a', _count: { _all: 0 } },
    ] as never);
    // Claim atómico devuelve 0: otro proceso ya asignó el pedido.
    prismaMock.order.updateMany.mockResolvedValue({ count: 0 } as never);

    const result = await autoAssignDriver(prisma as never, 'order-1', 'rest-user-1');

    expect(result.success).toBe(true);
    expect(result.alreadyAssigned).toBe(true);
  });
});