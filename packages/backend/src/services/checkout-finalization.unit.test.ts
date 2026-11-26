import type { PrismaClient } from '@prisma/client';
import { finalizeVerifiedCustomerCheckout } from './order.service';
import * as loyalty from './loyalty-runtime.service';

test('finaliza una reserva acreditada sin volver a descontar inventario', async () => {
  const order = { id: 'order-1' };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $queryRawUnsafe: jest.fn().mockResolvedValue([]),
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

test('un pago acreditado transfiere el regalo reservado al pedido una sola vez', async () => {
  const reserve = jest.spyOn(loyalty, 'reserveRuntimeReward').mockResolvedValue(undefined);
  const order = { id: 'order-1', createdAt: new Date() };
  const intent = { customerId: 'customer', restaurantId: 'restaurant', amountCents: 14000, snapshot: {
    fulfillmentType: 'PICKUP', subtotal: 140, taxAmount: 0, serviceFee: 0, deliveryFee: 0, promoDiscountAmount: 0,
    etaMs: 1000, loyaltyReservation: { cardId: 'card', discountCents: 0 },
    items: [
      { productId: 'product', quantity: 1, unitPrice: 140, subtotal: 140, sellBy: 'UNIT', options: [] },
      { productId: 'gift', quantity: 1, unitPrice: 0, subtotal: 0, sellBy: 'UNIT', options: [] },
    ],
  } };
  const tx = {
    $queryRawUnsafe: jest.fn(), $queryRaw: jest.fn(),
    checkoutPaymentIntent: { updateMany: jest.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValue({ count: 0 }), findUniqueOrThrow: jest.fn().mockResolvedValue(intent), findUnique: jest.fn().mockResolvedValue({ state: 'ORDER_CREATED' }) },
    order: { aggregate: jest.fn().mockResolvedValue({ _max: { dailyCounter: 0 } }), create: jest.fn().mockResolvedValue(order), findUniqueOrThrow: jest.fn().mockResolvedValue(order) },
    customer: { update: jest.fn() }, kitchenOrderOutbox: { create: jest.fn() },
  };
  const db = { $transaction: jest.fn(fn => fn(tx)) } as unknown as PrismaClient;
  try {
    await finalizeVerifiedCustomerCheckout(db, 'intent');
    await finalizeVerifiedCustomerCheckout(db, 'intent');
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(reserve).toHaveBeenCalledWith(tx, 'customer', 'order-1', { cardId: 'card', discountCents: 0 });
    expect(tx.order.create.mock.calls[0][0].data.items.create).toContainEqual(expect.objectContaining({ productId: 'gift', unitPrice: 0 }));
  } finally { reserve.mockRestore(); }
});
