import { BusinessType, OperatingHours, RestaurantStatus } from '@prisma/client';

export function isRestaurantOpenNow(
  status: RestaurantStatus,
  isAcceptingOrders: boolean,
  isPaused: boolean,
  operatingHours?: OperatingHours[],
  currentDate = new Date()
): boolean {
  if (status !== RestaurantStatus.ACTIVE || !isAcceptingOrders || isPaused) {
    return false;
  }

  // Sin horario configurado no hay restriccion de tiempo (restaurantes antiguos).
  if (!operatingHours || operatingHours.length === 0) {
    return true;
  }

  const dayOfWeek = currentDate.getDay();
  const currentMinutes = currentDate.getHours() * 60 + currentDate.getMinutes();

  // Turnos del dia actual (puede haber mas de uno).
  for (const block of operatingHours) {
    if (block.dayOfWeek !== dayOfWeek || block.isClosed) continue;
    if (isWithinShift(block.openTime, block.closeTime, currentMinutes)) {
      return true;
    }
  }

  // Madrugada heredada del dia anterior (ej. martes 22:00 - miercoles 02:00).
  const yesterdayDay = (dayOfWeek + 6) % 7;
  for (const block of operatingHours) {
    if (block.dayOfWeek !== yesterdayDay || block.isClosed) continue;
    if (
      parseTimeToMinutes(block.closeTime) < parseTimeToMinutes(block.openTime) &&
      currentMinutes < parseTimeToMinutes(block.closeTime)
    ) {
      return true;
    }
  }

  return false;
}

const DAYS_ES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function parseTimeToMinutes(time24h: string): number {
  const [hStr, mStr] = time24h.split(':');
  return parseInt(hStr, 10) * 60 + parseInt(mStr, 10);
}

function formatTime12h(time24h: string): string {
  const [hStr, mStr] = time24h.split(':');
  let h = parseInt(hStr, 10);
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${mStr} ${ampm}`;
}

/**
 * Devuelve true cuando `currentMinutes` esta dentro de un turno, soportando
 * turnos que cruzan la medianoche (ej. 22:00 - 02:00).
 */
function isWithinShift(openTime: string, closeTime: string, currentMinutes: number): boolean {
  const open = parseTimeToMinutes(openTime);
  const close = parseTimeToMinutes(closeTime);

  // Rango de cero minutos: no abierto.
  if (open === close) {
    return false;
  }

  if (close < open) {
    return currentMinutes >= open || currentMinutes < close;
  }

  return currentMinutes >= open && currentMinutes < close;
}

export function getNextOpenTime(operatingHours: OperatingHours[], currentDate = new Date()): string | null {
  if (!operatingHours || operatingHours.length === 0) return null;

  const currentDay = currentDate.getDay();
  const currentMinutes = currentDate.getHours() * 60 + currentDate.getMinutes();

  let bestOffset: number | null = null;
  let bestMinutes = Infinity;

  for (let dayOffset = 0; dayOffset <= 6; dayOffset++) {
    const day = (currentDay + dayOffset) % 7;
    const blocks = operatingHours
      .filter((h) => h.dayOfWeek === day && !h.isClosed)
      .sort((a, b) => parseTimeToMinutes(a.openTime) - parseTimeToMinutes(b.openTime));

    for (const block of blocks) {
      const open = parseTimeToMinutes(block.openTime);
      const close = parseTimeToMinutes(block.closeTime);

      if (open === close) continue;

      // El turno de hoy ya inicio (o ya paso); su siguiente apertura es en otro dia.
      if (dayOffset === 0 && open <= currentMinutes) {
        continue;
      }

      const candidateMinutes = dayOffset * 1440 + open;
      if (candidateMinutes < bestMinutes) {
        bestMinutes = candidateMinutes;
        bestOffset = dayOffset;
      }
    }
  }

  if (bestOffset === null) return null;

  const day = (currentDay + bestOffset) % 7;
  const openMinutesOfDay = bestMinutes % 1440;
  const openTime = formatTime12h(
    `${String(Math.floor(openMinutesOfDay / 60)).padStart(2, '0')}:${String(openMinutesOfDay % 60).padStart(2, '0')}`
  );

  if (bestOffset === 0) {
    if (bestMinutes - currentMinutes <= 90) {
      return 'pronto';
    }
    return `hoy a las ${openTime}`;
  }
  if (bestOffset === 1) {
    return `mañana a las ${openTime}`;
  }
  return `el ${DAYS_ES[day]} a las ${openTime}`;
}

export function getDistanceInKm(
  origin: { latitude: number; longitude: number },
  destination: { latitude: number; longitude: number }
): number {
  const earthRadiusKm = 6371;
  const deltaLatitude = toRadians(destination.latitude - origin.latitude);
  const deltaLongitude = toRadians(destination.longitude - origin.longitude);
  const startLatitude = toRadians(origin.latitude);
  const endLatitude = toRadians(destination.latitude);

  const a =
    Math.sin(deltaLatitude / 2) * Math.sin(deltaLatitude / 2) +
    Math.sin(deltaLongitude / 2) *
      Math.sin(deltaLongitude / 2) *
      Math.cos(startLatitude) *
      Math.cos(endLatitude);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusKm * c;
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export interface ZoneRestaurant {
  region: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
}

/**
 * Returns the region of the active restaurant nearest to the given
 * coordinates, but only when the user is within that restaurant's effective
 * delivery radius. When no restaurant is close enough (or there are no active
 * restaurants), it returns null so callers can fall back to global-only
 * content. The zone follows the restaurants that can actually serve the user
 * instead of a static zone centroid.
 */
export function resolveZoneFromNearestRestaurant(
  coordinates: { latitude: number; longitude: number },
  restaurants: ZoneRestaurant[]
): string | null {
  if (restaurants.length === 0) return null;

  let best: ZoneRestaurant | null = null;
  let bestDistance = Infinity;

  for (const restaurant of restaurants) {
    const distance = getDistanceInKm(coordinates, {
      latitude: restaurant.latitude,
      longitude: restaurant.longitude,
    });
    if (distance <= restaurant.radiusKm && distance < bestDistance) {
      best = restaurant;
      bestDistance = distance;
    }
  }

  return best?.region ?? null;
}

export function isRestaurant(businessType?: string): boolean {
  return !businessType || businessType === BusinessType.RESTAURANT;
}

export function getBusinessRef(businessType?: string): string {
  return isRestaurant(businessType) ? 'restaurante' : 'tienda';
}

export function getBusinessRefCapitalized(businessType?: string): string {
  return isRestaurant(businessType) ? 'Restaurante' : 'Tienda';
}

export function getBusinessArticle(businessType?: string): string {
  return isRestaurant(businessType) ? 'el' : 'la';
}

export function getBusinessArticleCapitalized(businessType?: string): string {
  return isRestaurant(businessType) ? 'El' : 'La';
}

export function getBusinessPossessive(businessType?: string): string {
  return isRestaurant(businessType) ? 'tu restaurante' : 'tu tienda';
}

export function getBusinessPossessiveCapitalized(businessType?: string): string {
  return isRestaurant(businessType) ? 'Tu restaurante' : 'Tu tienda';
}

const RESTAURANT_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pendiente',
  CONFIRMED: 'Confirmado',
  PREPARING: 'En preparación',
  READY: 'Listo',
  PICKED_UP: 'Recogido',
  IN_TRANSIT: 'En camino',
  DELIVERED: 'Entregado',
  CANCELLED: 'Cancelado',
  REJECTED: 'Rechazado',
};

const STORE_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pendiente',
  CONFIRMED: 'Confirmado',
  PREPARING: 'Preparando pedido',
  READY: 'Listo',
  PICKED_UP: 'Recogido',
  IN_TRANSIT: 'En camino',
  DELIVERED: 'Entregado',
  CANCELLED: 'Cancelado',
  REJECTED: 'Rechazado',
};

export function getStatusLabel(status: string, businessType?: string): string {
  return isRestaurant(businessType) ? RESTAURANT_STATUS_LABELS[status] || status : STORE_STATUS_LABELS[status] || status;
}

export function getPrepLabel(businessType?: string): string {
  return isRestaurant(businessType) ? 'preparación' : 'preparación del pedido';
}

export function getPrepVerb(businessType?: string): string {
  return isRestaurant(businessType) ? 'preparar' : 'preparar';
}

export function getKitchenRef(businessType?: string): string {
  return isRestaurant(businessType) ? 'cocina' : 'tienda';
}
