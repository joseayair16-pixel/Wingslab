import type { PrismaClient } from '@prisma/client';
import { fetchMercadoPagoOrder, refundAccreditedMercadoPagoOrder } from './mercado-pago-orders';
import { processCheckoutRefundOutbox } from './checkout-refund-outbox';

jest.mock('./mercado-pago-orders', () => ({
  fetchMercadoPagoOrder: jest.fn(),
  refundAccreditedMercadoPagoOrder: jest.fn(),
}));

function fixture() {
  return {
    checkoutRefundRequest: {
      findMany: jest.fn().mockResolvedValue([{ id: 'stable-refund-key', orderId: 'order-1' }]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'stable-refund-key', orderId: 'order-1', intentId: 'intent-1', providerOrderId: 'provider-1' }),
      findUnique: jest.fn().mockResolvedValue({ attempts: 1 }),
      update: jest.fn().mockResolvedValue(undefined),
    },
  } as unknown as PrismaClient;
}

beforeEach(() => jest.clearAllMocks());

test('reconcilia y reintenta el reembolso con la misma clave estable', async () => {
  const db = fixture();
  (fetchMercadoPagoOrder as jest.Mock).mockResolvedValue({ id: 'provider-1', external_reference: 'intent-1', status: 'processed', status_detail: 'accredited' });
  (refundAccreditedMercadoPagoOrder as jest.Mock).mockResolvedValue({ status_detail: 'refunded' });

  await expect(processCheckoutRefundOutbox(db, 'sandbox-token', jest.fn())).resolves.toBe(1);
  expect(refundAccreditedMercadoPagoOrder).toHaveBeenCalledWith('sandbox-token', expect.any(Object), 'stable-refund-key');
  expect(db.checkoutRefundRequest.update).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 'stable-refund-key' }, data: expect.objectContaining({ state: 'REFUNDED', refundedAt: expect.any(Date) }),
  }));
});

test('sin credenciales no reclama ni modifica reembolsos pendientes', async () => {
  const db = fixture();
  await expect(processCheckoutRefundOutbox(db, undefined, jest.fn())).resolves.toBe(0);
  expect(db.checkoutRefundRequest.findMany).not.toHaveBeenCalled();
});

test('si falla el proveedor conserva el reembolso pendiente con backoff', async () => {
  const db = fixture();
  (fetchMercadoPagoOrder as jest.Mock).mockRejectedValue(new Error('network'));
  const onError = jest.fn();
  await expect(processCheckoutRefundOutbox(db, 'sandbox-token', onError)).resolves.toBe(0);
  expect(onError).toHaveBeenCalledWith(expect.any(Error), 'order-1');
  expect(db.checkoutRefundRequest.update).toHaveBeenLastCalledWith(expect.objectContaining({
    where: { id: 'stable-refund-key' },
    data: expect.objectContaining({ state: 'PENDING', leaseUntil: null, nextAttemptAt: expect.any(Date) }),
  }));
});
