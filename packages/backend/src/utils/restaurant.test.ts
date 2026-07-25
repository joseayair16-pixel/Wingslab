import { RestaurantStatus } from '@prisma/client';

import { getDistanceInKm, isRestaurantOpenNow } from './restaurant';

describe('restaurant utils', () => {
  it('detecta restaurante abierto con horario valido', () => {
    const result = isRestaurantOpenNow(
      RestaurantStatus.ACTIVE,
      true,
      false,
      [
        {
          id: '1',
          restaurantId: 'r1',
          dayOfWeek: 2,
          openTime: '09:00',
          closeTime: '18:00',
          isClosed: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      new Date('2026-04-14T15:30:00')
    );

    expect(result).toBe(true);
  });

  it('detecta restaurante cerrado cuando esta suspendido o fuera de horario', () => {
    const paused = isRestaurantOpenNow(RestaurantStatus.SUSPENDED, true, false, [], new Date('2026-04-14T15:30:00'));
    const afterHours = isRestaurantOpenNow(
      RestaurantStatus.ACTIVE,
      true,
      false,
      [
        {
          id: '1',
          restaurantId: 'r1',
          dayOfWeek: 2,
          openTime: '09:00',
          closeTime: '18:00',
          isClosed: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      new Date('2026-04-14T23:00:00')
    );

    expect(paused).toBe(false);
    expect(afterHours).toBe(false);
  });

  it('detecta restaurante cerrado cuando el toggle operativo esta apagado', () => {
    const closed = isRestaurantOpenNow(RestaurantStatus.ACTIVE, false, false, [], new Date('2026-04-14T15:30:00'));

    expect(closed).toBe(false);
  });

  it('detecta restaurante cerrado cuando esta pausado', () => {
    const paused = isRestaurantOpenNow(RestaurantStatus.ACTIVE, true, true, [], new Date('2026-04-14T15:30:00'));

    expect(paused).toBe(false);
  });

  it('calcula distancia aproximada entre coordenadas', () => {
    const distance = getDistanceInKm(
      { latitude: 19.4326, longitude: -99.1332 },
      { latitude: 19.427, longitude: -99.1677 }
    );

    expect(distance).toBeGreaterThan(3);
    expect(distance).toBeLessThan(5);
  });
});
