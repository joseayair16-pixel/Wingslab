import type { PrismaClient } from '@prisma/client';
import { dispatchCheckoutKitchenOutbox } from './checkout-kitchen-outbox';
import { enqueueRestaurantOrder } from './order-workflow.service';

jest.mock('./order-workflow.service', () => ({ enqueueRestaurantOrder: jest.fn() }));
jest.mock('./socket.service', () => ({ emitNotification: jest.fn() }));

const orderId = 'paid-order';
const createdAt = new Date('2026-11-24T12:00:00.000Z');

function fixture() {
  const db = {
    kitchenOrderOutbox: {
      findMany: jest.fn().mockResolvedValue([{ orderId }]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ orderId, restaurantId: 'restaurant', orderCreatedAt: createdAt }),
      findUnique: jest.fn().mockResolvedValue({ attempts: 1 }),
      update: jest.fn().mockResolvedValue(undefined),
    },
    order: { findUnique: jest.fn().mockResolvedValue({
      id: orderId, restaurantId: 'restaurant', orderReference: 'WL-001', paymentMethod: 'CREDIT_CARD', createdAt,
      restaurant: { userId: 'restaurant-user' },
    }) },
  } as unknown as PrismaClient;
  return db;
}

beforeEach(() => jest.clearAllMocks());

test('publica pedidos pagados y marca la fila entregada solo después de encolar', async () => {
  const db = fixture();
  (enqueueRestaurantOrder as jest.Mock).mockResolvedValue({ position: 1, queueLength: 1 });
  const now = new Date('2026-11-24T12:00:01.000Z');
  await expect(dispatchCheckoutKitchenOutbox(db, {} as never, jest.fn(), now)).resolves.toBe(1);
  expect(db.kitchenOrderOutbox.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ orderId, status: 'PENDING' }),
    data: expect.objectContaining({ status: 'PROCESSING', attempts: { increment: 1 } }),
  }));
  expect(enqueueRestaurantOrder).toHaveBeenCalledWith('restaurant', orderId, createdAt, { throwOnError: true });
  expect(db.kitchenOrderOutbox.update).toHaveBeenCalledWith(expect.objectContaining({
    where: { orderId }, data: expect.objectContaining({ status: 'DELIVERED', deliveredAt: expect.any(Date) }),
  }));
});

test('si falla Redis reprograma el outbox con backoff en lugar de perder el pedido', async () => {
  const db = fixture();
  (enqueueRestaurantOrder as jest.Mock).mockRejectedValue(new Error('redis down'));
  const onError = jest.fn();
  await expect(dispatchCheckoutKitchenOutbox(db, undefined, onError)).resolves.toBe(0);
  expect(onError).toHaveBeenCalledWith(expect.any(Error), orderId);
  expect(db.kitchenOrderOutbox.update).toHaveBeenLastCalledWith(expect.objectContaining({
    where: { orderId },
    data: expect.objectContaining({ status: 'PENDING', leaseUntil: null, lastError: expect.any(String), nextAttemptAt: expect.any(Date) }),
  }));
});
