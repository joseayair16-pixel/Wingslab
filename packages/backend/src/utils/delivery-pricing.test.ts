import { calculateDistanceDeliveryFee } from './delivery-pricing';

describe('calculateDistanceDeliveryFee', () => {
  it('devuelve null cuando el modelo no es distance o no hay distancia', () => {
    expect(calculateDistanceDeliveryFee({ pricingModel: 'fixed', distanceKm: 3 })).toBeNull();
    expect(calculateDistanceDeliveryFee({ pricingModel: 'distance', distanceKm: null })).toBeNull();
    expect(calculateDistanceDeliveryFee({ pricingModel: 'distance', distanceKm: undefined })).toBeNull();
  });

  it('cobra la tarifa base en el primer km', () => {
    expect(
      calculateDistanceDeliveryFee({
        pricingModel: 'distance',
        distanceKm: 0.5,
        baseRate: 20,
        perKmRate: 8,
        minDeliveryFee: 15,
        maxDeliveryFee: 150,
      })
    ).toBe(20);
  });

  it('suma el costo por km adicional', () => {
    expect(
      calculateDistanceDeliveryFee({
        pricingModel: 'distance',
        distanceKm: 3.5,
        baseRate: 20,
        perKmRate: 8,
        minDeliveryFee: 15,
        maxDeliveryFee: 150,
      })
    ).toBe(40);
  });

  it('respeta la tarifa minima', () => {
    expect(
      calculateDistanceDeliveryFee({
        pricingModel: 'distance',
        distanceKm: 0.1,
        baseRate: 5,
        perKmRate: 8,
        minDeliveryFee: 15,
        maxDeliveryFee: 150,
      })
    ).toBe(15);
  });

  it('respeta la tarifa maxima', () => {
    expect(
      calculateDistanceDeliveryFee({
        pricingModel: 'distance',
        distanceKm: 40,
        baseRate: 20,
        perKmRate: 8,
        minDeliveryFee: 15,
        maxDeliveryFee: 100,
      })
    ).toBe(100);
  });

  it('redondea a dos decimales', () => {
    expect(
      calculateDistanceDeliveryFee({
        pricingModel: 'distance',
        distanceKm: 2.37,
        baseRate: 20,
        perKmRate: 8,
        minDeliveryFee: 15,
        maxDeliveryFee: 150,
      })
    ).toBe(30.96);
  });
});
