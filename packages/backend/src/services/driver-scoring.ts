import { getDistanceInKm } from '../utils/restaurant';

/**
 * Pesos y umbrales del score de candidatos al asignar pedidos automáticamente.
 *
 * Reglas de calibración (mayor score = mejor candidato):
 *  - LOAD_PER_ACTIVE       40  Fuerte penalización por pedido activo.
 *  - ROUTE_COMPATIBLE_BONUS 50  Bonus si la ruta nueva es compatible (smart stacking).
 *  - DISTANCE_PER_KM        10  Penalización por km de distancia al restaurante.
 *  - MAX_DISTANCE_KM         6  Tope de distancia considerada.
 *  - IDLE_PER_MINUTE       0.5  Bonus por minuto sin asignación.
 *  - MAX_IDLE_MINUTES      120  Tope del bonus de ocio.
 *  - RATING_PER_POINT        5  Peso del rating (0..5), secundario.
 *  - JITTER                  3  Aleatoriedad acotada: solo mezcla candidatos
 *                               prácticamente empatados (< 3 puntos).
 */
export const DRIVER_SCORE = {
  LOAD_PER_ACTIVE: 40,
  ROUTE_COMPATIBLE_BONUS: 50,
  DISTANCE_PER_KM: 10,
  MAX_DISTANCE_KM: 6,
  IDLE_PER_MINUTE: 0.5,
  MAX_IDLE_MINUTES: 120,
  RATING_PER_POINT: 5,
  JITTER: 3,
} as const;

export type DriverCandidateOrder = {
  id: string;
  driverAssignedAt?: Date | null;
  latitude: number | null;
  longitude: number | null;
  restaurant?: { latitude: number | null; longitude: number | null } | null;
};

export type DriverCandidate = {
  id: string;
  userId: string;
  rating: number;
  totalDeliveries: number;
  currentLatitude: number | null;
  currentLongitude: number | null;
  createdAt: Date;
  updatedAt: Date;
  user: { id?: string; name: string };
  orders?: DriverCandidateOrder[];
};

export type DriverScoreInput = {
  activeOrdersCount: number;
  /** km del repartidor al restaurante; null si no se puede calcular (GPS no reportado). */
  distanceKm: number | null;
  /** true si la ruta nueva es compatible con alguno de sus pedidos activos. */
  routeCompatible: boolean;
  /** minutos desde su última asignación (proxy si no hay dato exacto). */
  idleMinutes: number;
  rating: number;
};

/**
 * Score de candidato. Incluye un jitter acotado a DRIVER_SCORE.JITTER para
 * repartir rachas entre candidatos prácticamente empatados sin permitir que
 * un candidato claramente inferior gane.
 */
export function scoreDriverCandidate(input: DriverScoreInput): number {
  const base =
    -DRIVER_SCORE.LOAD_PER_ACTIVE * input.activeOrdersCount +
    (input.routeCompatible ? DRIVER_SCORE.ROUTE_COMPATIBLE_BONUS : 0) -
    (input.distanceKm == null || input.distanceKm < 0
      ? 0
      : DRIVER_SCORE.DISTANCE_PER_KM * Math.min(input.distanceKm, DRIVER_SCORE.MAX_DISTANCE_KM)) +
    DRIVER_SCORE.IDLE_PER_MINUTE * Math.min(Math.max(input.idleMinutes, 0), DRIVER_SCORE.MAX_IDLE_MINUTES) +
    DRIVER_SCORE.RATING_PER_POINT * Math.max(input.rating, 0);

  const jitter = (Math.random() * 2 - 1) * DRIVER_SCORE.JITTER;
  return base + jitter;
}

/**
 * Smart stacking: un pedido nuevo es compatible con la ruta actual de un
 * repartidor si el restaurante del pedido está a <= 1 km del restaurante de
 * ALGUNO de sus pedidos activos Y el destino nuevo está a <= 2.5 km del
 * destino de ese mismo pedido.
 */
export function isRouteCompatibleWithNewOrder(params: {
  restaurant: { latitude: number | null; longitude: number | null };
  newOrder: { latitude: number | null; longitude: number | null };
  activeOrders: DriverCandidateOrder[];
}): boolean {
  const { restaurant, newOrder, activeOrders } = params;

  if (activeOrders.length === 0) return false;
  if (!restaurant.latitude || !restaurant.longitude) return false;
  if (!newOrder.latitude || !newOrder.longitude) return false;

  for (const existingOrder of activeOrders) {
    if (
      !existingOrder.latitude ||
      !existingOrder.longitude ||
      !existingOrder.restaurant?.latitude ||
      !existingOrder.restaurant?.longitude
    ) {
      continue;
    }

    const restaurantDistance = getDistanceInKm(
      { latitude: restaurant.latitude, longitude: restaurant.longitude },
      {
        latitude: existingOrder.restaurant.latitude,
        longitude: existingOrder.restaurant.longitude,
      }
    );

    const customerDistance = getDistanceInKm(
      { latitude: newOrder.latitude, longitude: newOrder.longitude },
      { latitude: existingOrder.latitude, longitude: existingOrder.longitude }
    );

    if (restaurantDistance <= 1 && customerDistance <= 2.5) {
      return true;
    }
  }

  return false;
}

/**
 * Minutos transcurridos (aprox.) desde que el repartidor recibió su última
 * asignación. Se usa el driverAssignedAt más reciente de sus pedidos activos;
 * si no tiene pedidos activos se usa updatedAt del repartidor como proxy
 * (fecha de su último cambio de disponibilidad). Sin N+1.
 */
export function minutesSinceLastAssignment(candidate: DriverCandidate): number {
  const now = Date.now();

  const assignedAt = (candidate.orders ?? [])
    .map((order) => order.driverAssignedAt?.getTime() ?? 0)
    .filter((ts) => ts > 0);

  const referenceMs = assignedAt.length > 0 ? Math.max(...assignedAt) : candidate.updatedAt.getTime();

  return (now - referenceMs) / 60_000;
}

/**
 * Distancia en km del repartidor al restaurante usando su GPS reportado.
 * Devuelve null si falta alguna coordenada.
 */
export function driverDistanceToRestaurantKm(
  candidate: DriverCandidate,
  restaurant: { latitude: number | null; longitude: number | null } | null
): number | null {
  if (
    candidate.currentLatitude == null ||
    candidate.currentLongitude == null ||
    !restaurant ||
    restaurant.latitude == null ||
    restaurant.longitude == null
  ) {
    return null;
  }

  return getDistanceInKm(
    { latitude: candidate.currentLatitude, longitude: candidate.currentLongitude },
    { latitude: restaurant.latitude, longitude: restaurant.longitude }
  );
}