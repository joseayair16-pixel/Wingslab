import { OrderStatus } from '@prisma/client';

import { extendOrderPreparationTime, rescheduleDeliveryTime } from './order-workflow.service';

function makeScheduledOrder(overrides: Record<string, unknown> = {}) {
  const scheduledDeliveryAt = new Date(Date.now() + 25 * 60 * 1000);
  const preparationDeadlineAt = new Date(Date.now() + 10 * 60 * 1000);
  const estimatedDeliveryTime = new Date(scheduledDeliveryAt.getTime());
  return {
    id: 'order-sched-1',
    status: OrderStatus.CONFIRMED,
    preparationTimeMinutes: 15,
    preparationDeadlineAt,
    estimatedDeliveryTime,
    scheduledDeliveryAt,
    etaExtendedMinutes: 0,
    overdueAlertLevel: 2,
    overdueAlertedAt: new Date(Date.now() - 60_000),
    scheduledReminderSentAt: new Date(Date.now() - 5 * 60_000),
    fulfillmentType: 'DELIVERY',
    latitude: null,
    longitude: null,
    restaurant: {
      id: 'rest-1',
      userId: 'rest-user-1',
      name: 'Super Manantiales',
      businessType: 'RESTAURANT',
      maxDeliveryTime: 30,
      latitude: null,
      longitude: null,
    },
    ...overrides,
  } as any;
}

function mockPrisma(order: any) {
  const tx = {
    order: { update: jest.fn().mockResolvedValue(order) },
    orderTracking: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma: any = {
    order: { findFirst: jest.fn().mockResolvedValue(order) },
    $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
  };
  return { prisma, tx };
}

describe('extendOrderPreparationTime — pedido programado', () => {
  it('desplaza scheduledDeliveryAt y estimatedDeliveryTime al agregar tiempo', async () => {
    const order = makeScheduledOrder();
    const { prisma, tx } = mockPrisma(order);

    await extendOrderPreparationTime({
      prisma,
      restaurantUserId: 'rest-user-1',
      orderId: order.id,
      additionalMinutes: 10,
    });

    expect(tx.order.update).toHaveBeenCalledTimes(1);
    const data = tx.order.update.mock.calls[0][0].data;

    // La hora acordada debe desplazarse hacia adelante (no quedarse fija en el
    // pasado, que era la causa del "rezagado" residual).
    expect(data.scheduledDeliveryAt).toBeDefined();
    expect(data.scheduledDeliveryAt.getTime()).toBeGreaterThan(
      order.scheduledDeliveryAt.getTime()
    );
    // La ETA debe coincidir con la nueva hora acordada.
    expect(data.estimatedDeliveryTime.getTime()).toBe(data.scheduledDeliveryAt.getTime());
    // El estado de rezagado debe limpiarse.
    expect(data.overdueAlertLevel).toBe(0);
    expect(data.overdueAlertedAt).toBeNull();
    // El recordatorio previo se recalcula con la nueva hora.
    expect(data.scheduledReminderSentAt).toBeNull();
  });

  it('sin fecha programada no toca scheduledDeliveryAt', async () => {
    const order = makeScheduledOrder({ scheduledDeliveryAt: null });
    const { prisma, tx } = mockPrisma(order);

    await extendOrderPreparationTime({
      prisma,
      restaurantUserId: 'rest-user-1',
      orderId: order.id,
      additionalMinutes: 5,
    });

    const data = tx.order.update.mock.calls[0][0].data;
    expect(data.scheduledDeliveryAt).toBeUndefined();
  });

  it('en recoger-en-tienda el deadline coincide con la hora acordada (travel = 0)', async () => {
    const order = makeScheduledOrder({ fulfillmentType: 'PICKUP' });
    const { prisma, tx } = mockPrisma(order);

    await extendOrderPreparationTime({
      prisma,
      restaurantUserId: 'rest-user-1',
      orderId: order.id,
      additionalMinutes: 20,
    });

    const data = tx.order.update.mock.calls[0][0].data;
    // Para pickup no hay trayecto: preparationDeadlineAt debe coincidir con
    // scheduledDeliveryAt (no desplazarse por estimateDeliveryTravelMinutes).
    expect(data.preparationDeadlineAt.getTime()).toBe(data.scheduledDeliveryAt.getTime());
  });
});

describe('rescheduleDeliveryTime', () => {
  it('reprograma y limpia el estado de rezagado y el recordatorio previo', async () => {
    const order = makeScheduledOrder();
    const { prisma, tx } = mockPrisma(order);
    const newEta = new Date(Date.now() + 60 * 60 * 1000);

    await rescheduleDeliveryTime({
      prisma,
      restaurantUserId: 'rest-user-1',
      orderId: order.id,
      estimatedDeliveryAt: newEta.toISOString(),
    });

    const data = tx.order.update.mock.calls[0][0].data;
    expect(data.scheduledDeliveryAt.getTime()).toBe(newEta.getTime());
    expect(data.overdueAlertLevel).toBe(0);
    expect(data.overdueAlertedAt).toBeNull();
    expect(data.scheduledReminderSentAt).toBeNull();
  });
});