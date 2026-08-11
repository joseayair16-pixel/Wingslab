import { RestaurantStatus } from '@prisma/client';

import {
  getDistanceInKm,
  getNextOpenTime,
  isRestaurantOpenNow,
  resolveZoneFromNearestRestaurant,
  ZoneRestaurant,
} from './restaurant';

function scheduleBlock(
  dayOfWeek: number,
  openTime: string,
  closeTime: string,
  overrides: Partial<{ isClosed: boolean; shiftIndex: number }> = {}
) {
  return {
    id: '1',
    restaurantId: 'r1',
    dayOfWeek,
    shiftIndex: overrides.shiftIndex ?? 0,
    openTime,
    closeTime,
    isClosed: overrides.isClosed ?? false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('restaurant utils', () => {
  it('detecta restaurante abierto con horario valido', () => {
    const result = isRestaurantOpenNow(
      RestaurantStatus.ACTIVE,
      true,
      false,
      [scheduleBlock(2, '09:00', '18:00')],
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
      [scheduleBlock(2, '09:00', '18:00')],
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

  it('maneja rangos que cruzan la medianoche', () => {
    const overnightSchedule = [scheduleBlock(2, '22:00', '02:00')];

    const beforeOpen = isRestaurantOpenNow(RestaurantStatus.ACTIVE, true, false, overnightSchedule, new Date('2026-04-14T21:59:00'));
    const openAtStart = isRestaurantOpenNow(RestaurantStatus.ACTIVE, true, false, overnightSchedule, new Date('2026-04-14T22:00:00'));
    const openAfterMidnight = isRestaurantOpenNow(RestaurantStatus.ACTIVE, true, false, overnightSchedule, new Date('2026-04-15T01:30:00'));
    const afterClose = isRestaurantOpenNow(RestaurantStatus.ACTIVE, true, false, overnightSchedule, new Date('2026-04-15T02:30:00'));

    expect(beforeOpen).toBe(false);
    expect(openAtStart).toBe(true);
    expect(openAfterMidnight).toBe(true);
    expect(afterClose).toBe(false);
  });

  it('soporta dos turnos por dia (comida + cena nocturna)', () => {
    const twoShifts = [
      scheduleBlock(2, '12:00', '16:00', { shiftIndex: 0 }),
      scheduleBlock(2, '19:00', '01:00', { shiftIndex: 1 }),
    ];

    const lunch = isRestaurantOpenNow(RestaurantStatus.ACTIVE, true, false, twoShifts, new Date('2026-04-14T13:30:00'));
    const gap = isRestaurantOpenNow(RestaurantStatus.ACTIVE, true, false, twoShifts, new Date('2026-04-14T17:00:00'));
    const dinner = isRestaurantOpenNow(RestaurantStatus.ACTIVE, true, false, twoShifts, new Date('2026-04-14T20:00:00'));
    const inheritedMorning = isRestaurantOpenNow(RestaurantStatus.ACTIVE, true, false, twoShifts, new Date('2026-04-15T00:30:00'));
    const closedAfterMorning = isRestaurantOpenNow(RestaurantStatus.ACTIVE, true, false, twoShifts, new Date('2026-04-15T02:00:00'));

    expect(lunch).toBe(true);
    expect(gap).toBe(false);
    expect(dinner).toBe(true);
    expect(inheritedMorning).toBe(true);
    expect(closedAfterMorning).toBe(false);
  });

  it('getNextOpenTime: elige el siguiente inicio mas cercano entre turnos y dias', () => {
    const twoShifts = [
      scheduleBlock(2, '12:00', '16:00', { shiftIndex: 0 }),
      scheduleBlock(2, '19:00', '01:00', { shiftIndex: 1 }),
    ];

    // Martes 10:00 -> abre hoy a las 12:00
    expect(getNextOpenTime(twoShifts, new Date('2026-04-14T10:00:00'))).toBe('hoy a las 12:00 pm');
    // Martes 17:00 -> siguiente turno de hoy a las 19:00
    expect(getNextOpenTime(twoShifts, new Date('2026-04-14T17:00:00'))).toBe('hoy a las 7:00 pm');
    // Martes 02:00 (madrugada) -> abre hoy a las 12:00
    expect(getNextOpenTime(twoShifts, new Date('2026-04-14T02:00:00'))).toBe('hoy a las 12:00 pm');
    // Miercoles 02:30 -> no hay turnos el Miercoles, vuelve el Martes siguiente
    expect(getNextOpenTime(twoShifts, new Date('2026-04-15T02:30:00'))).toBe('el Martes a las 12:00 pm');
  });

  it('getNextOpenTime: turno solo nocturno y siguiente semana', () => {
    const overnight = [scheduleBlock(2, '22:00', '02:00')];

    // Martes 10:00 -> abre hoy a las 22:00
    expect(getNextOpenTime(overnight, new Date('2026-04-14T10:00:00'))).toBe('hoy a las 10:00 pm');
    // Miercoles 03:00 -> la madrugada ya paso, vuelve el Martes siguiente
    expect(getNextOpenTime(overnight, new Date('2026-04-15T03:00:00'))).toBe('el Martes a las 10:00 pm');
  });

  it('getNextOpenTime: sin horario o cerrado todos los dias devuelve null', () => {
    expect(getNextOpenTime([], new Date('2026-04-14T10:00:00'))).toBeNull();
    const allClosed = [scheduleBlock(2, '09:00', '18:00', { isClosed: true })];
    expect(getNextOpenTime(allClosed, new Date('2026-04-14T10:00:00'))).toBeNull();
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

describe('resolveZoneFromNearestRestaurant', () => {
  const morelia: ZoneRestaurant = { region: 'michoacan-morelia', latitude: 19.7036972, longitude: -101.1660205, radiusKm: 5 };
  const puruaran: ZoneRestaurant = { region: 'michoacan-puruaran', latitude: 19.0955686, longitude: -101.5231974, radiusKm: 3 };

  it('asigna la zona del restaurante mas cercano cuando el usuario esta dentro de su radio', () => {
    // A ~2 km del restaurante de Morelia.
    const result = resolveZoneFromNearestRestaurant({ latitude: 19.72, longitude: -101.175 }, [morelia, puruaran]);
    expect(result).toBe('michoacan-morelia');
  });

  it('asigna la zona del otro restaurante cuando esta mas cerca de el', () => {
    const result = resolveZoneFromNearestRestaurant({ latitude: 19.11, longitude: -101.52 }, [morelia, puruaran]);
    expect(result).toBe('michoacan-puruaran');
  });

  it('devuelve null cuando el usuario esta fuera del radio de todos los restaurantes', () => {
    // CDMX: lejos de todos los radios.
    const result = resolveZoneFromNearestRestaurant({ latitude: 19.4326, longitude: -99.1332 }, [morelia, puruaran]);
    expect(result).toBeNull();
  });

  it('devuelve null cuando no hay restaurantes activos', () => {
    const result = resolveZoneFromNearestRestaurant({ latitude: 19.7036972, longitude: -101.1660205 }, []);
    expect(result).toBeNull();
  });

  it('respeta el radio de entrega del restaurante (no el de la zona)', () => {
    // A 7 km del restaurante de Morelia (radio 5 km) -> fuera.
    const result = resolveZoneFromNearestRestaurant({ latitude: 19.76, longitude: -101.14 }, [morelia, puruaran]);
    expect(result).toBeNull();
  });

  it('elige un restaurante mas lejano con radio mayor cuando el mas cercano no cubre al usuario', () => {
    // Restaurante A a ~4 km (radio 2 km, no cubre), restaurante B a ~8 km (radio 20 km, si cubre).
    const small: ZoneRestaurant = { region: 'zona-a', latitude: 19.7, longitude: -101.16, radiusKm: 2 };
    const large: ZoneRestaurant = { region: 'zona-b', latitude: 19.78, longitude: -101.14, radiusKm: 20 };
    const result = resolveZoneFromNearestRestaurant({ latitude: 19.735, longitude: -101.155 }, [small, large]);
    expect(result).toBe('zona-b');
  });
});
