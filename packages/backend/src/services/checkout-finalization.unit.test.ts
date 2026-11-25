import type { PrismaClient } from '@prisma/client';
import { finalizeVerifiedCustomerCheckout } from './order.service';

test('finaliza una reserva acreditada sin volver a descontar inventario', async () => {
  const order = { id: 'order-1' };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    checkoutPaymentIntent: {
      updateMany: jest.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValue({ count: 0 }),
      findUnique: jest.fn().mockResolvedValue({ state: 'ORDER_CREATED' }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ customerId: 'customer', restaurantId: 'restaurant', amountCents: 14000, snapshot: {
        fulfillmentType: 'PICKUP', subtotal: 140, taxAmount: 0, serviceFee: 0, deliveryFee: 0, promoDiscountAmount: 0,
        etaMs: 600000, items: [{ productId: 'product', quantity: 1, unitPrice: 140, subtotal: 140, sellBy: 'UNIT', options: [] }],
      } }),
    },
    order: { aggregate: jest.fn().mockResolvedValue({ _max: { dailyCounter: 4 } }), create: jest.fn().mockResolvedValue(order), findUniqueOrThrow: jest.fn().mockResolvedValue(order) },
    customer: { update: jest.fn() },
    product: { updateMany: jest.fn() },
    kitchenOrderOutbox: { create: jest.fn() },
  };
  const db = { $transaction: jest.fn(fn => fn(tx)) } as unknown as PrismaClient;
  const id = '8148d68d-73eb-4365-b96c-be7d555f7aee';
  await expect(finalizeVerifiedCustomerCheckout(db, id)).resolves.toEqual({ order, isDuplicate: false });
  await expect(finalizeVerifiedCustomerCheckout(db, id)).resolves.toEqual({ order, isDuplicate: true });
  expect(tx.order.create).toHaveBeenCalledTimes(1);
  expect(tx.order.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ dailyCounter: 5 }) }));
  expect(tx.kitchenOrderOutbox.create).toHaveBeenCalledTimes(1);
  expect(tx.order.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ paymentStatus: 'COMPLETED', totalAmount: 140, clientOrderKey: `mp:${id}` }) }));
  expect(tx.product.updateMany).not.toHaveBeenCalled();
  tx.checkoutPaymentIntent.findUnique.mockResolvedValue({ state: 'SUBMITTING' });
  await expect(finalizeVerifiedCustomerCheckout(db, id)).rejects.toMatchObject({ code: 'PAYMENT_NOT_VERIFIED' });
});
