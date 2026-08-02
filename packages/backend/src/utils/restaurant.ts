import { BusinessType, OperatingHours, RestaurantStatus } from '@prisma/client';

export function isRestaurantOpenNow(
  status: RestaurantStatus,
  isAcceptingOrders: boolean,
  isPaused: boolean,
  _operatingHours?: OperatingHours[],
  _currentDate = new Date()
): boolean {
  if (status !== RestaurantStatus.ACTIVE || !isAcceptingOrders || isPaused) {
    return false;
  }
  
  return true;
}

const DAYS_ES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function formatTime12h(time24h: string): string {
  const [hStr, mStr] = time24h.split(':');
  let h = parseInt(hStr, 10);
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${mStr} ${ampm}`;
}

export function getNextOpenTime(operatingHours: OperatingHours[], currentDate = new Date()): string | null {
  if (!operatingHours || operatingHours.length === 0) return null;

  const currentDay = currentDate.getDay();
  const currentTime = `${String(currentDate.getHours()).padStart(2, '0')}:${String(currentDate.getMinutes()).padStart(2, '0')}`;

  // Check the rest of today
  const todaySchedule = operatingHours.find((h) => h.dayOfWeek === currentDay);
  if (todaySchedule && !todaySchedule.isClosed) {
    if (currentTime < todaySchedule.openTime) {
      return `hoy a las ${formatTime12h(todaySchedule.openTime)}`;
    } else if (currentTime >= todaySchedule.openTime && currentTime <= todaySchedule.closeTime) {
      const [currH, currM] = currentTime.split(':').map(Number);
      const [openH, openM] = todaySchedule.openTime.split(':').map(Number);
      const diffMinutes = (currH * 60 + currM) - (openH * 60 + openM);

      if (diffMinutes <= 90) {
        return 'pronto';
      }
      // If > 90 mins have passed, assume they won't open today and fall through to next days
    }
  }

  // Check the next 6 days
  for (let i = 1; i <= 6; i++) {
    const nextDay = (currentDay + i) % 7;
    const schedule = operatingHours.find((h) => h.dayOfWeek === nextDay);
    if (schedule && !schedule.isClosed) {
      if (i === 1) return `mañana a las ${formatTime12h(schedule.openTime)}`;
      return `el ${DAYS_ES[nextDay]} a las ${formatTime12h(schedule.openTime)}`;
    }
  }

  return null;
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
    if (distance < bestDistance) {
      best = restaurant;
      bestDistance = distance;
    }
  }

  if (!best) return null;
  return bestDistance <= best.radiusKm ? best.region : null;
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
