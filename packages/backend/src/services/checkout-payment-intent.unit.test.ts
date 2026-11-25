import type { PrismaClient } from '@prisma/client';
import { claimCheckoutPaymentReconciliation, claimCheckoutPaymentSubmission, expireCheckoutPayment, expireReservedCheckoutPaymentInTransaction, markCheckoutPaymentDeclined, recordVerifiedCheckoutPayment, reserveCheckoutPayment, sweepExpiredCheckoutPayments } from './checkout-payment-intent';

const quote = { customerId: 'c', restaurantId: 'r', requestKey: 'k', fingerprint: 'f', amountCents: 100, snapshot: {}, stock: [{ productId: 'p', quantity: 1 }, { productId: 'p', quantity: 2 }] };

test('solo reclama para cobro una reserva vigente del cliente', async () => {
  const { db, tx } = fixture();
  Object.assign(db, { checkoutPaymentIntent: tx.checkoutPaymentIntent });
  const now = new Date();
  expect(await claimCheckoutPaymentSubmission(db, 'intent', 'c', now)).toBe(true);
  expect(await claimCheckoutPaymentSubmission(db, 'intent', 'c', now)).toBe(false);
  expect(tx.checkoutPaymentIntent.updateMany).toHaveBeenCalledWith({ where: { id: 'intent', customerId: 'c', state: 'RESERVED', expiresAt: { gt: now } }, data: { state: 'SUBMITTING' } });
});

test('reclama la conciliación distribuida con ventana de diez segundos', async () => {
  const { db, tx } = fixture();
  Object.assign(db, { checkoutPaymentIntent: tx.checkoutPaymentIntent });
  const now = new Date('2026-11-24T12:00:00.000Z');
  expect(await claimCheckoutPaymentReconciliation(db, 'intent', now)).toBe(true);
  expect(tx.checkoutPaymentIntent.updateMany).toHaveBeenCalledWith({
    where: { id: 'intent', state: 'SUBMITTING', OR: [
      { lastReconciledAt: null }, { lastReconciledAt: { lte: new Date(now.getTime() - 10_000) } },
    ] },
    data: { lastReconciledAt: now },
  });
});

test('solo registra una acreditación con importe correcto y tolera su repetición', async () => {
  const { db, tx } = fixture();
  const findUnique = jest.fn().mockResolvedValue({ ...quote, state: 'SUBMITTING', providerOrderId: null });
  Object.assign(db, { checkoutPaymentIntent: { ...tx.checkoutPaymentIntent, findUnique } });
  const order = { id: 'ORD01', type: 'online' as const, external_reference: 'intent', country_code: 'MEX', total_amount: '1.00', total_paid_amount: '1.00', status: 'processed', status_detail: 'accredited', transactions: { payments: [{ id: 'PAY01', amount: '1.00', status: 'processed', status_detail: 'accredited' }] } };
  expect(await recordVerifiedCheckoutPayment(db, 'intent', { ...order, total_paid_amount: '0.00' })).toBe(false);
  expect(await recordVerifiedCheckoutPayment(db, 'intent', order)).toBe(true);
  findUnique.mockResolvedValue({ ...quote, state: 'VERIFIED', providerOrderId: order.id });
  expect(await recordVerifiedCheckoutPayment(db, 'intent', order)).toBe(true);
  expect(await recordVerifiedCheckoutPayment(db, 'intent', { ...order, id: 'ORD02' })).toBe(false);
  expect(tx.checkoutPaymentIntent.updateMany).toHaveBeenCalledTimes(1);
});
function fixture() {
  const intent = { ...quote, stock: [{ productId: 'p', quantity: 3 }] };
  const tx = { checkoutPaymentIntent: {
    createMany: jest.fn().mockResolvedValue({ count: 1 }), findUniqueOrThrow: jest.fn().mockResolvedValue(intent),
    updateMany: jest.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValue({ count: 0 }),
  }, product: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
  return { tx, db: { $transaction: jest.fn(fn => fn(tx)) } as unknown as PrismaClient };
}

test('consolida cantidades y no vuelve a descontar stock en un reintento', async () => {
  const { tx, db } = fixture();
  tx.checkoutPaymentIntent.createMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValue({ count: 0 });
  await reserveCheckoutPayment(db, quote);
  await reserveCheckoutPayment(db, quote);
  expect(tx.product.updateMany).toHaveBeenCalledTimes(1);
  expect(tx.product.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { stock: { decrement: 3 } } }));
  await expect(reserveCheckoutPayment(db, { ...quote, fingerprint: 'otro' })).rejects.toMatchObject({ code: 'CHECKOUT_KEY_CONFLICT' });
});

test('rechaza una reserva cuando el descuento condicional no encuentra stock', async () => {
  const { tx, db } = fixture();
  tx.product.updateMany.mockResolvedValueOnce({ count: 0 });
  await expect(reserveCheckoutPayment(db, quote)).rejects.toMatchObject({ code: 'CHECKOUT_STOCK_UNAVAILABLE' });
});

test('devuelve el stock solo si obtiene la transición de vencimiento', async () => {
  const { tx, db } = fixture();
  const now = new Date();
  expect(await expireCheckoutPayment(db, 'intent', now)).toBe(true);
  expect(await expireCheckoutPayment(db, 'intent', now)).toBe(false);
  expect(tx.checkoutPaymentIntent.updateMany).toHaveBeenCalledWith({ where: { id: 'intent', state: 'RESERVED', expiresAt: { lte: now } }, data: { state: 'EXPIRED' } });
  expect(tx.product.updateMany).toHaveBeenCalledTimes(1);
});

test('reemplazar una reserva sin enviar libera stock una sola vez', async () => {
  const { tx } = fixture();
  expect(await expireReservedCheckoutPaymentInTransaction(tx as never, 'intent')).toBe(true);
  expect(await expireReservedCheckoutPaymentInTransaction(tx as never, 'intent')).toBe(false);
  expect(tx.checkoutPaymentIntent.updateMany).toHaveBeenCalledWith({
    where: { id: 'intent', state: 'RESERVED' }, data: { state: 'EXPIRED' },
  });
  expect(tx.product.updateMany).toHaveBeenCalledTimes(1);
});

test('libera stock solo cuando el proveedor confirma un fallo terminal', async () => {
  const tx = {
    checkoutPaymentIntent: {
      updateMany: jest.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ restaurantId: 'r', stock: [{ productId: 'p', quantity: 2 }] }),
    },
    product: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const db = { $transaction: jest.fn((fn: (value: typeof tx) => unknown) => fn(tx)) } as unknown as PrismaClient;
  expect(await markCheckoutPaymentDeclined(db, 'intent', 'ORD01')).toBe(true);
  expect(await markCheckoutPaymentDeclined(db, 'intent', 'ORD01')).toBe(false);
  expect(tx.product.updateMany).toHaveBeenCalledTimes(1);
  expect(tx.product.updateMany).toHaveBeenCalledWith({
    where: { id: 'p', restaurantId: 'r' }, data: { stock: { increment: 2 } },
  });
});

test('persiste solo el código de rechazo cerrado, nunca el detalle del proveedor', async () => {
  const { db, tx } = fixture();
  expect(await markCheckoutPaymentDeclined(db, 'intent', 'ORD01', 'INVALID_CVV')).toBe(true);
  expect(tx.checkoutPaymentIntent.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({ data: { state: 'DECLINED', providerOrderId: 'ORD01', declineReason: 'INVALID_CVV' } })
  );
});

test('el barrido limita el lote y continúa si una reserva falla', async () => {
  const { db, tx } = fixture();
  const findMany = jest.fn().mockResolvedValue([{ id: 'failed' }, { id: 'next' }]);
  Object.assign(db, { checkoutPaymentIntent: { findMany } });
  tx.checkoutPaymentIntent.updateMany.mockReset().mockRejectedValueOnce(new Error('temporal')).mockResolvedValueOnce({ count: 1 });
  const onError = jest.fn();
  const now = new Date();
  await sweepExpiredCheckoutPayments(db, onError, now);
  expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { state: 'RESERVED', expiresAt: { lte: now } }, take: 100 }));
  expect(onError).toHaveBeenCalledWith(expect.any(Error), 'failed');
  expect(tx.product.updateMany).toHaveBeenCalledTimes(1);
});
