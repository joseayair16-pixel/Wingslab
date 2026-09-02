import {
  DRIVER_SCORE,
  scoreDriverCandidate,
  isRouteCompatibleWithNewOrder,
  minutesSinceLastAssignment,
  driverDistanceToRestaurantKm,
  DriverCandidate,
} from './driver-scoring';

function makeCandidate(overrides: Partial<DriverCandidate> = {}): DriverCandidate {
  return {
    id: 'driver-1',
    userId: 'user-1',
    rating: 0,
    totalDeliveries: 0,
    currentLatitude: 20.5,
    currentLongitude: -103.5,
    createdAt: new Date(),
    updatedAt: new Date(),
    user: { id: 'user-1', name: 'Driver' },
    orders: [],
    ...overrides,
  };
}

describe('scoreDriverCandidate', () => {
  it('0 pedidos activos gana normalmente sobre 2 (misma distancia)', () => {
    for (let i = 0; i < 200; i++) {
      const idle = scoreDriverCandidate({
        activeOrdersCount: 0,
        distanceKm: 1,
        routeCompatible: false,
        idleMinutes: 0,
        rating: 0,
      });
      const overloaded = scoreDriverCandidate({
        activeOrdersCount: 2,
        distanceKm: 1,
        routeCompatible: false,
        idleMinutes: 0,
        rating: 0,
      });
      expect(idle).toBeGreaterThan(overloaded);
    }
  });

  it('1 pedido activo gana normalmente sobre 2', () => {
    for (let i = 0; i < 200; i++) {
      const light = scoreDriverCandidate({
        activeOrdersCount: 1,
        distanceKm: 1,
        routeCompatible: false,
        idleMinutes: 0,
        rating: 0,
      });
      const busier = scoreDriverCandidate({
        activeOrdersCount: 2,
        distanceKm: 1,
        routeCompatible: false,
        idleMinutes: 0,
        rating: 0,
      });
      expect(light).toBeGreaterThan(busier);
    }
  });

  it('un BUSY con ruta claramente superior gana sobre 0 pedidos lejos', () => {
    // A: 0 pedidos, 4 km del restaurante  -> base -40
    // B: 2 pedidos, 300 m, ruta compatible -> base -80 + 50 - 3 = -33
    // Diferencia de base 7 > 6 (2 * jitter), por lo que B gana siempre.
    for (let i = 0; i < 200; i++) {
      const idleFar = scoreDriverCandidate({
        activeOrdersCount: 0,
        distanceKm: 4,
        routeCompatible: false,
        idleMinutes: 0,
        rating: 0,
      });
      const busyNearPerfect = scoreDriverCandidate({
        activeOrdersCount: 2,
        distanceKm: 0.3,
        routeCompatible: true,
        idleMinutes: 0,
        rating: 0,
      });
      expect(busyNearPerfect).toBeGreaterThan(idleFar);
    }
  });

  it('la carga tiene bastante peso: 0 vs 0 vs 2, gana uno de los vacíos', () => {
    for (let i = 0; i < 200; i++) {
      const empty = scoreDriverCandidate({
        activeOrdersCount: 0,
        distanceKm: 2,
        routeCompatible: false,
        idleMinutes: 0,
        rating: 0,
      });
      const loaded = scoreDriverCandidate({
        activeOrdersCount: 2,
        distanceKm: 2,
        routeCompatible: false,
        idleMinutes: 0,
        rating: 0,
      });
      expect(empty).toBeGreaterThan(loaded);
    }
  });

  it('el jitter no permite que un candidato claramente peor gane', () => {
    // Diferencia de 80 puntos (2 pedidos vs 0) >> margen de jitter (6).
    for (let i = 0; i < 500; i++) {
      const best = scoreDriverCandidate({
        activeOrdersCount: 0,
        distanceKm: 0,
        routeCompatible: false,
        idleMinutes: 0,
        rating: 5,
      });
      const worst = scoreDriverCandidate({
        activeOrdersCount: 2,
        distanceKm: 6,
        routeCompatible: false,
        idleMinutes: 0,
        rating: 0,
      });
      expect(best).toBeGreaterThan(worst);
    }
  });

  it('la aleatoriedad acotada sí existe entre candidatos prácticamente empatados', () => {
    const bases: number[] = [];
    for (let i = 0; i < 200; i++) {
      bases.push(
        scoreDriverCandidate({
          activeOrdersCount: 0,
          distanceKm: 1,
          routeCompatible: false,
          idleMinutes: 0,
          rating: 0,
        })
      );
    }
    const max = Math.max(...bases);
    const min = Math.min(...bases);
    // rango esperado: base -3 .. base + 3 (el jitter existe, no es deterministico)
    expect(max - min).toBeGreaterThan(0);
    expect(max - min).toBeLessThanOrEqual(2 * DRIVER_SCORE.JITTER + 1e-9);
  });
});

describe('isRouteCompatibleWithNewOrder', () => {
  const restaurant = { latitude: 20.5, longitude: -103.5 };
  const newOrder = { latitude: 20.51, longitude: -103.51 };
  const nearRestaurant = {
    id: 'existing-1',
    latitude: 20.5,
    longitude: -103.5,
    restaurant: { latitude: 20.5005, longitude: -103.5005 },
  };
  const farRestaurant = {
    id: 'existing-2',
    latitude: 20.55,
    longitude: -103.55,
    restaurant: { latitude: 20.56, longitude: -103.56 },
  };

  it('devuelve true cuando restaurante <=1km y destino <=2.5km', () => {
    expect(
      isRouteCompatibleWithNewOrder({
        restaurant,
        newOrder,
        activeOrders: [nearRestaurant as any],
      })
    ).toBe(true);
  });

  it('devuelve false cuando los pedidos activos son incompatibles', () => {
    expect(
      isRouteCompatibleWithNewOrder({
        restaurant,
        newOrder,
        activeOrders: [farRestaurant as any],
      })
    ).toBe(false);
  });

  it('devuelve false sin pedidos activos', () => {
    expect(
      isRouteCompatibleWithNewOrder({
        restaurant,
        newOrder,
        activeOrders: [],
      })
    ).toBe(false);
  });

  it('devuelve false si faltan coordenadas del pedido nuevo o del restaurante', () => {
    expect(
      isRouteCompatibleWithNewOrder({
        restaurant: { latitude: null, longitude: null },
        newOrder,
        activeOrders: [nearRestaurant as any],
      })
    ).toBe(false);
    expect(
      isRouteCompatibleWithNewOrder({
        restaurant,
        newOrder: { latitude: null, longitude: null },
        activeOrders: [nearRestaurant as any],
      })
    ).toBe(false);
  });
});

describe('minutesSinceLastAssignment', () => {
  it('usa el driverAssignedAt más reciente de los pedidos activos', () => {
    const now = Date.now();
    const older = new Date(now - 60 * 60 * 1000);
    const recent = new Date(now - 10 * 60 * 1000);
    const candidate = makeCandidate({
      updatedAt: new Date(now - 30 * 60 * 1000),
      orders: [
        { id: 'o1', driverAssignedAt: older, latitude: 1, longitude: 1 },
        { id: 'o2', driverAssignedAt: recent, latitude: 1, longitude: 1 },
      ],
    });
    const idle = minutesSinceLastAssignment(candidate);
    expect(idle).toBeGreaterThan(8);
    expect(idle).toBeLessThan(12);
  });

  it('usa updatedAt como proxy cuando no hay pedidos activos', () => {
    const candidate = makeCandidate({
      updatedAt: new Date(Date.now() - 20 * 60 * 1000),
      orders: [],
    });
    const idle = minutesSinceLastAssignment(candidate);
    expect(idle).toBeGreaterThan(18);
    expect(idle).toBeLessThan(22);
  });
});

describe('driverDistanceToRestaurantKm', () => {
  it('calcula distancia con GPS del repartidor y del restaurante', () => {
    const candidate = makeCandidate({
      currentLatitude: 20.5,
      currentLongitude: -103.5,
    });
    const distance = driverDistanceToRestaurantKm(candidate, {
      latitude: 20.51,
      longitude: -103.51,
    });
    expect(distance).toBeCloseTo(1.39, 0);
  });

  it('devuelve null si falta el GPS del repartidor', () => {
    const candidate = makeCandidate({ currentLatitude: null, currentLongitude: null });
    expect(driverDistanceToRestaurantKm(candidate, { latitude: 20.5, longitude: -103.5 })).toBeNull();
  });

  it('devuelve null si falta el restaurante', () => {
    expect(driverDistanceToRestaurantKm(makeCandidate(), null)).toBeNull();
  });
});