import { createHmac } from 'node:crypto';
import { CARD_DECLINE_REASONS, createMercadoPagoCardOrder, fetchMercadoPagoOrder, mapMercadoPagoDeclineReason, matchesAccreditedMercadoPagoOrder, mercadoPagoChallengeUrl, mercadoPagoItemsFromSnapshot, refundAccreditedMercadoPagoOrder, safeProviderUrl, searchMercadoPagoOrdersByReference, verifyMercadoPagoOrderSignature } from './mercado-pago-orders';

const intentId = '8148d68d-73eb-4365-b96c-be7d555f7aee';
const id = 'ORD01TEST';
const payment = { id: 'PAY01TEST', amount: '145.50', status: 'processed', status_detail: 'accredited' };
const order = { id, type: 'online' as const, external_reference: intentId, country_code: 'MEX', total_amount: '145.50', total_paid_amount: '145.50', status: 'processed', status_detail: 'accredited', transactions: { payments: [payment] } };

afterEach(() => jest.restoreAllMocks());

test('mapea rechazos a un código cerrado y nunca expone el detalle crudo', () => {
  const rejected = (detail: string) => ({ ...order, status: 'failed', status_detail: detail });
  expect(mapMercadoPagoDeclineReason(rejected('cc_rejected_insufficient_amount'))).toBe('INSUFFICIENT_FUNDS');
  expect(mapMercadoPagoDeclineReason(rejected('cc_rejected_bad_filled_security_code'))).toBe('INVALID_CVV');
  expect(mapMercadoPagoDeclineReason(rejected('cc_rejected_expired_card'))).toBe('EXPIRED_CARD');
  expect(mapMercadoPagoDeclineReason(rejected('cc_rejected_card_disabled'))).toBe('UNSUPPORTED_CARD');
  expect(mapMercadoPagoDeclineReason(rejected('cc_rejected_max_attempts'))).toBe('TOO_MANY_ATTEMPTS');
  expect(mapMercadoPagoDeclineReason(rejected('cc_rejected_high_risk'))).toBe('SECURITY_REJECTED');
  expect(mapMercadoPagoDeclineReason(rejected('cc_rejected_call_for_authorize'))).toBe('AUTHORIZATION_REQUIRED');
  const unknownCode = mapMercadoPagoDeclineReason(rejected('detalle_nuevo_del_proveedor'));
  expect(unknownCode).toBe('GENERIC');
  expect(CARD_DECLINE_REASONS).toContain(unknownCode);
  expect(JSON.stringify(unknownCode)).not.toContain('detalle_nuevo_del_proveedor');
});

test('solo entrega URL de desafío HTTPS del proveedor para una orden pendiente de 3DS', () => {
  const url = 'https://www.mercadopago.com.mx/auth/card/validation';
  const pending = { ...order, status: 'action_required', status_detail: 'pending_challenge',
    transactions: { payments: [{ ...payment, payment_method: { transaction_security: { url } } }] } };
  expect(mercadoPagoChallengeUrl(pending)).toBe(url);
  expect(mercadoPagoChallengeUrl({ ...pending, status: 'processed', status_detail: 'accredited' })).toBeUndefined();
  for (const value of ['no es una URL', 'http://www.mercadopago.com.mx', 'https://www.mercadopago.com.mx:444', 'https://mercadopago.com.mx.example.test']) {
    expect(safeProviderUrl(value)).toBeUndefined();
  }
});

test('solo se devuelven URLs de verificación del dominio de Mercado Pago', () => {
  expect(safeProviderUrl('https://www.mercadopago.com.mx/auth/card?token=abc')).toBe('https://www.mercadopago.com.mx/auth/card?token=abc');
  expect(safeProviderUrl('https://www.mercadopago.com/auth/card?token=abc')).toBe('https://www.mercadopago.com/auth/card?token=abc');
  expect(safeProviderUrl('https://mercadopago.com.mx.evil.test/auth')).toBeUndefined();
  expect(safeProviderUrl('http://www.mercadopago.com.mx/auth')).toBeUndefined();
});

test('busca órdenes por external_reference con ventana temporal acotada', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ data: [order] })));
  await expect(searchMercadoPagoOrdersByReference('mock-secret', intentId, new Date('2026-11-24T12:00:00.000Z'))).resolves.toEqual([order]);
  const url = new URL(String(fetchMock.mock.calls[0][0]));
  expect(url.pathname).toBe('/v1/orders');
  expect(url.searchParams.get('external_reference')).toBe(intentId);
  expect(url.searchParams.get('begin_date')).toBe('2026-10-25T12:00:00.000Z');
  expect(url.searchParams.get('end_date')).toBe('2026-11-24T12:00:00.000Z');
});

test('solo reembolsa una orden acreditada y envía una clave idempotente estable', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
    id, status: 'processed', status_detail: 'refunded',
  }), { status: 201 }));
  await expect(refundAccreditedMercadoPagoOrder('mock-secret', order, intentId)).resolves.toMatchObject({
    id, status: 'processed', status_detail: 'refunded',
  });
  expect(fetchMock.mock.calls[0][0]).toBe(`https://api.mercadopago.com/v1/orders/${id}/refund`);
  expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ 'X-Idempotency-Key': intentId });
  expect(fetchMock.mock.calls[0][1]?.body).toBeUndefined();
  expect(new Headers(fetchMock.mock.calls[0][1]?.headers).has('Content-Type')).toBe(false);
  await expect(refundAccreditedMercadoPagoOrder('mock-secret', { ...order, status: 'processing' }, intentId)).rejects.toThrow();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('la firma vincula la orden y el identificador de solicitud', () => {
  const secret = 'unit-test-only';
  const signature = `ts=1795511173,v1=${createHmac('sha256', secret).update('id:ord01test;request-id:req-1;ts:1795511173;').digest('hex')}`;
  expect(verifyMercadoPagoOrderSignature(id, 'req-1', signature, secret)).toBe(true);
  expect(verifyMercadoPagoOrderSignature(id, 'req-2', signature, secret)).toBe(false);
  expect(verifyMercadoPagoOrderSignature('ORD02TEST', 'req-1', signature, secret)).toBe(false);
});

test('envía el total exacto y reutiliza la clave persistida en un reintento', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ ...order, payer: { email: 'test@example.com' } })));
  const input = { intentId, idempotencyKey: intentId, amountCents: 14550, payerEmail: 'test@example.com', identificationType: 'RFC', identificationNumber: 'XAXX010101000', cardToken: 'mock-token', methodId: 'visa', cardType: 'credit_card' as const, issuerId: '123', installments: 1 };
  expect(await createMercadoPagoCardOrder('mock-secret', input)).not.toHaveProperty('payer');
  await createMercadoPagoCardOrder('mock-secret', input);
  expect(fetchMock.mock.calls[0][1]?.body).toBe(fetchMock.mock.calls[1][1]?.body);
  expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ 'X-Idempotency-Key': intentId });
  const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
  expect(payload).toMatchObject({ total_amount: '145.50', transactions: { payments: [{ amount: '145.50', payment_method: { id: 'visa', installments: 1 } }] } });
  expect(payload.transactions.payments[0].payment_method).not.toHaveProperty('issuer_id');
  expect(payload.transactions.payments[0].payment_method.statement_descriptor).toBe('WINGSLAB');
  expect(payload.config?.online?.transaction_security).toBeUndefined();
  await createMercadoPagoCardOrder('mock-secret', { ...input, requireThreeDs: true });
  expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body)).config.online.transaction_security)
    .toEqual({ validation: 'on_fraud_risk', liability_shift: 'required' });
});

test('los ítems de Orders reflejan precios del servidor y no alteran el importe', () => {
  const snapshot = { items: [{ title: 'Producto', productId: 'product-1', quantity: 2, unitPrice: 72.75, subtotal: 145.50 }] };
  expect(mercadoPagoItemsFromSnapshot(snapshot, 14550)).toEqual([{ title: 'Producto', external_code: 'product-1', quantity: 2, unit_price: '72.75' }]);
  expect(mercadoPagoItemsFromSnapshot({ items: [{ ...snapshot.items[0], title: '' }] }, 14550)).toBeUndefined();
  expect(mercadoPagoItemsFromSnapshot(snapshot, 16050)).toBeUndefined();
  expect(mercadoPagoItemsFromSnapshot({ items: [{ ...snapshot.items[0], subtotal: 100 }] }, 10000)).toBeUndefined();
  expect(mercadoPagoItemsFromSnapshot({ items: [
    ...snapshot.items,
    { title: 'Regalo', productId: 'gift-1', quantity: 1, unitPrice: 0, subtotal: 0 },
  ] }, 14550)).toEqual([{ title: 'Producto', external_code: 'product-1', quantity: 2, unit_price: '72.75' }]);
});

test('una tarjeta guardada usa payer.customer_id y un token nuevo, no el ID de tarjeta', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(order)));
  const charge = {
    intentId, idempotencyKey: intentId, amountCents: 14550, payerCustomerId: '123-example',
    cardToken: 'fresh-token', methodId: 'visa', cardType: 'credit_card' as const, installments: 1,
  };
  await createMercadoPagoCardOrder('mock-secret', charge);
  const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
  expect(payload.payer).toEqual({ customer_id: '123-example' });
  expect(payload.transactions.payments[0].payment_method).toMatchObject({ token: 'fresh-token' });
  expect(payload.transactions.payments[0].payment_method).not.toHaveProperty('card_id');
  expect(() => createMercadoPagoCardOrder('mock-secret', { ...charge, payerEmail: 'buyer@example.com' })).toThrow();
});

test('permite crear una order sin identificación y solo incluye el par cuando está completo', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(order)));
  const { identificationType: _type, identificationNumber: _number, ...withoutIdentification } = {
    intentId, idempotencyKey: intentId, amountCents: 14550, payerEmail: 'test@example.com',
    identificationType: 'RFC', identificationNumber: 'XAXX010101000', cardToken: 'mock-token',
    methodId: 'visa', cardType: 'credit_card' as const, installments: 1,
  };

  await createMercadoPagoCardOrder('mock-secret', withoutIdentification);
  const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
  expect(requestBody.payer).toEqual({ email: 'test@example.com' });
  expect(() => createMercadoPagoCardOrder('mock-secret', { ...withoutIdentification, identificationType: 'RFC' })).toThrow();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('solo acepta una orden acreditada que coincide con el intento y el monto', () => {
  const expected = { providerOrderId: id, intentId, amountCents: 14550 };
  expect(matchesAccreditedMercadoPagoOrder(order, expected)).toBe(true);
  for (const change of [{ status: 'pending' }, { country_code: 'BRA' }, { total_paid_amount: '0.00' }, { external_reference: 'other' }, { transactions: { payments: [payment, payment] } }]) {
    expect(matchesAccreditedMercadoPagoOrder({ ...order, ...change }, expected)).toBe(false);
  }
});

test('rechaza identificadores que no pertenecen a Orders antes de hacer una consulta', () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch');
  expect(() => fetchMercadoPagoOrder('mock-secret', '../payments/123')).toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});
