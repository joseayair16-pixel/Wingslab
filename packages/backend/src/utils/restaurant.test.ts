import { RestaurantStatus } from '@prisma/client';

import { getDistanceInKm, isRestaurantOpenNow, resolveZoneFromCentroids, ZoneCentroid } from './restaurant';

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

describe('resolveZoneFromCentroids', () => {
  const morelia: ZoneCentroid = { code: 'michoacan-morelia', latitude: 19.7025, longitude: -101.1924, radiusKm: 20 };
  const puruaran: ZoneCentroid = { code: 'michoacan-puruaran', latitude: 19.4108, longitude: -102.5164, radiusKm: 20 };

  it('asigna la zona mas cercana cuando el usuario esta dentro del radio', () => {
    const result = resolveZoneFromCentroids({ latitude: 19.71, longitude: -101.2 }, [morelia, puruaran]);
    expect(result).toBe('michoacan-morelia');
  });

  it('asigna la otra zona cuando el usuario esta cerca de ella', () => {
    const result = resolveZoneFromCentroids({ latitude: 19.42, longitude: -102.5 }, [morelia, puruaran]);
    expect(result).toBe('michoacan-puruaran');
  });

  it('devuelve null cuando el usuario esta lejos de todas las zonas', () => {
    // Ciudad de Mexico (aprox. 19.43, -99.13) esta fuera del radio de ambas.
    const result = resolveZoneFromCentroids({ latitude: 19.4326, longitude: -99.1332 }, [morelia, puruaran]);
    expect(result).toBeNull();
  });

  it('devuelve null cuando no hay zonas activas', () => {
    const result = resolveZoneFromCentroids({ latitude: 19.7025, longitude: -101.1924 }, []);
    expect(result).toBeNull();
  });

  it('respeta el radio de entrega configurado por zona', () => {
    // Zona con radio pequeno: el usuario dentro del centroide pero fuera del radio.
    const tinyZone: ZoneCentroid = { code: 'zona-tiny', latitude: 19.7025, longitude: -101.1924, radiusKm: 1 };
    const result = resolveZoneFromCentroids({ latitude: 19.80, longitude: -101.1924 }, [tinyZone]);
    expect(result).toBeNull();
  });
});
