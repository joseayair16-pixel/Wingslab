import type { PrismaClient } from '@prisma/client';
import { enqueueRestaurantCardRefund } from './checkout-refund-enqueue';

const order = {
  id: 'order-1',
  clientOrderKey: 'mp:8148d68d-73eb-4365-b96c-be7d555f7aee',
  paymentMethod: 'CREDIT_CARD' as const,
  paymentStatus: 'COMPLETED' as const,
};

function fixture() {
  const checkoutRefundRequest = {
    createMany: jest.fn().mockResolvedValue({ count: 1 }),
    findUnique: jest.fn().mockResolvedValue({ id: 'existing-refund' }),
  };
  const checkoutPaymentIntent = {
    findUnique: jest.fn().mockResolvedValue({ providerOrderId: 'ORD01' }),
  };
  return { db: { checkoutRefundRequest, checkoutPaymentIntent } as unknown as PrismaClient, checkoutRefundRequest, checkoutPaymentIntent };
}

test('encola un solo reembolso para un pedido pagado con tarjeta', async () => {
  const { db, checkoutRefundRequest } = fixture();
  const id = await enqueueRestaurantCardRefund(db, order);
  expect(typeof id).toBe('string');
  expect(checkoutRefundRequest.createMany).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ orderId: 'order-1', intentId: '8148d68d-73eb-4365-b96c-be7d555f7aee', providerOrderId: 'ORD01' }),
    skipDuplicates: true,
  }));
});

test('no encola nada para efectivo ni para pagos no completados', async () => {
  const { db, checkoutRefundRequest } = fixture();
  expect(await enqueueRestaurantCardRefund(db, { ...order, paymentMethod: 'CASH' as const })).toBeNull();
  expect(await enqueueRestaurantCardRefund(db, { ...order, paymentStatus: 'PENDING' as const })).toBeNull();
  expect(checkoutRefundRequest.createMany).not.toHaveBeenCalled();
});

test('si otra cancelación ya encoló el reembolso, devuelve la solicitud existente', async () => {
  const { db, checkoutRefundRequest } = fixture();
  checkoutRefundRequest.createMany.mockResolvedValueOnce({ count: 0 });
  expect(await enqueueRestaurantCardRefund(db, order)).toBe('existing-refund');
  expect(checkoutRefundRequest.findUnique).toHaveBeenCalledWith({ where: { orderId: 'order-1' }, select: { id: true } });
});
