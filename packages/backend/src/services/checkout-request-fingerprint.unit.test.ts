import { checkoutRequestFingerprint } from './checkout-request-fingerprint';

test('ignora metadatos GPS variables al reintentar el mismo checkout', () => {
  const base = { items: [{ productId: 'p1', quantity: 1 }], fulfillmentType: 'DELIVERY', deliveryAddress: { street: 'Calle 1', latitude: 19.4, longitude: -99.1 } };
  expect(checkoutRequestFingerprint({ ...base, currentLocation: { latitude: 19.4, longitude: -99.1, capturedAt: 'one', accuracy: 8 } }))
    .toBe(checkoutRequestFingerprint({ ...base, currentLocation: { latitude: 19.4001, longitude: -99.1001, capturedAt: 'two', accuracy: 20 } }));
});

test('mantiene distintos los cambios reales del pedido', () => {
  const base = { items: [{ productId: 'p1', quantity: 1 }], fulfillmentType: 'DELIVERY' };
  expect(checkoutRequestFingerprint(base)).not.toBe(checkoutRequestFingerprint({ ...base, items: [{ productId: 'p1', quantity: 2 }] }));
});
