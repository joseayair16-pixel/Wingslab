import type { PrismaClient } from '@prisma/client';
import { fetchMercadoPagoOrder, searchMercadoPagoOrdersByReference } from './mercado-pago-orders';
import { reconcileSubmittedCheckoutPayments } from './checkout-payment-intent';

jest.mock('./mercado-pago-orders', () => ({
  fetchMercadoPagoOrder: jest.fn(),
  searchMercadoPagoOrdersByReference: jest.fn(),
  mapMercadoPagoDeclineReason: jest.fn(() => 'INSUFFICIENT_FUNDS'),
  matchesAccreditedMercadoPagoOrder: jest.fn(() => false),
}));

const providerOrder = (status: string, detail: string) => ({
  id: 'ORD01', type: 'online' as const, external_reference: 'intent-1', country_code: 'MEX',
  total_amount: '1.00', status, status_detail: detail,
});

function fixture(providerOrderId: string | null = 'ORD01') {
  const tx = {
    checkoutPaymentIntent: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ restaurantId: 'r', stock: [{ productId: 'p', quantity: 2 }] }),
    },
    product: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const db = {
    checkoutPaymentIntent: {
      findMany: jest.fn().mockResolvedValue([{ id: 'intent-1', providerOrderId }]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn((fn: (value: typeof tx) => unknown) => fn(tx)),
  } as unknown as PrismaClient;
  return { db, tx };
}

beforeEach(() => jest.clearAllMocks());

test('un fallo terminal confirmado libera stock y guarda el motivo seguro', async () => {
  const { db, tx } = fixture();
  jest.mocked(fetchMercadoPagoOrder).mockResolvedValue(providerOrder('failed', 'cc_rejected_insufficient_amount') as never);
  const onVerified = jest.fn().mockResolvedValue(false);
  const onError = jest.fn();
  const resolved = await reconcileSubmittedCheckoutPayments(db, 'token', { onVerified, onError });
  expect(resolved).toBe(1);
  expect(tx.checkoutPaymentIntent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ state: 'DECLINED', declineReason: 'INSUFFICIENT_FUNDS' }),
  }));
  expect(tx.product.updateMany).toHaveBeenCalledWith({ where: { id: 'p', restaurantId: 'r' }, data: { stock: { increment: 2 } } });
  expect(onError).not.toHaveBeenCalled();
});

test('un resultado pendiente conserva la reserva y no libera stock', async () => {
  const { db, tx } = fixture();
  jest.mocked(fetchMercadoPagoOrder).mockResolvedValue(providerOrder('action_required', 'pending_challenge') as never);
  const resolved = await reconcileSubmittedCheckoutPayments(db, 'token', { onVerified: jest.fn().mockResolvedValue(false), onError: jest.fn() });
  expect(resolved).toBe(0);
  expect(tx.product.updateMany).not.toHaveBeenCalled();
});

test('una referencia ambigua nunca se adjunta ni libera inventario', async () => {
  const { db, tx } = fixture(null);
  jest.mocked(searchMercadoPagoOrdersByReference).mockResolvedValue([
    providerOrder('failed', 'cc_rejected_other_reason'), providerOrder('failed', 'cc_rejected_other_reason'),
  ] as never);
  const resolved = await reconcileSubmittedCheckoutPayments(db, 'token', { onVerified: jest.fn().mockResolvedValue(false), onError: jest.fn() });
  expect(resolved).toBe(0);
  expect(fetchMercadoPagoOrder).not.toHaveBeenCalled();
  expect(tx.product.updateMany).not.toHaveBeenCalled();
});

test('una acreditación recuperada se entrega al settlement y no se rechaza', async () => {
  const { db, tx } = fixture();
  jest.mocked(fetchMercadoPagoOrder).mockResolvedValue(providerOrder('processed', 'accredited') as never);
  const onVerified = jest.fn().mockResolvedValue(true);
  const resolved = await reconcileSubmittedCheckoutPayments(db, 'token', { onVerified, onError: jest.fn() });
  expect(resolved).toBe(1);
  expect(onVerified).toHaveBeenCalledWith('intent-1', expect.objectContaining({ id: 'ORD01' }));
  expect(tx.product.updateMany).not.toHaveBeenCalled();
});
