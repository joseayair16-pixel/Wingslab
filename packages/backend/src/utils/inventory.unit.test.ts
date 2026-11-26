import { computeAvailability } from './inventory';

test('la disponibilidad manual no depende del inventario histórico', () => {
  expect(computeAvailability({ isAvailable: true, trackStock: true, stock: 0, lowStockThreshold: 5 }))
    .toEqual({ available: true, lowStock: false });
  expect(computeAvailability({ isAvailable: false, trackStock: true, stock: 100, lowStockThreshold: 5 }))
    .toEqual({ available: false, lowStock: false });
});
