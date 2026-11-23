import { deliveryDistanceKm } from './delivery-distance';

test('calculates approximate distance and rejects missing or invalid coordinates', () => {
  expect(deliveryDistanceKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.01 })).toBeCloseTo(1.112, 2);
  expect(deliveryDistanceKm(null, { latitude: 0, longitude: 0 })).toBeNull();
  expect(deliveryDistanceKm({ latitude: 91, longitude: 0 }, { latitude: 0, longitude: 0 })).toBeNull();
});
