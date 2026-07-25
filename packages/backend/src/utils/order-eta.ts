import { PaymentMethod } from '@prisma/client';
import { getDistanceInKm } from './restaurant';

type Coordinates = {
  latitude?: number | null;
  longitude?: number | null;
};

type EtaRestaurant = Coordinates & {
  maxDeliveryTime?: number | null;
};

type EtaOrder = Coordinates & {
  paymentMethod?: PaymentMethod;
};

function getPositiveNumberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function hasCoordinates(value: Coordinates): value is { latitude: number; longitude: number } {
  return (
    typeof value.latitude === 'number' &&
    Number.isFinite(value.latitude) &&
    typeof value.longitude === 'number' &&
    Number.isFinite(value.longitude)
  );
}

export function estimateDeliveryTravelMinutes(restaurant: EtaRestaurant, order: EtaOrder): number {
  const fallback = restaurant.maxDeliveryTime || 30;

  if (!hasCoordinates(restaurant) || !hasCoordinates(order)) {
    return fallback;
  }

  const distanceKm = getDistanceInKm(
    { latitude: restaurant.latitude, longitude: restaurant.longitude },
    { latitude: order.latitude, longitude: order.longitude }
  );
  const detourFactor = getPositiveNumberEnv('ETA_ROUTE_DETOUR_FACTOR', 1.3);
  const averageSpeedKmh = getPositiveNumberEnv('ETA_AVERAGE_DELIVERY_SPEED_KMH', 18);
  const handoffBufferMinutes = getPositiveNumberEnv('ETA_HANDOFF_BUFFER_MINUTES', 2);
  const minTravelMinutes = getPositiveNumberEnv('ETA_MIN_TRAVEL_MINUTES', 4);
  const maxTravelMinutes = getPositiveNumberEnv('ETA_MAX_TRAVEL_MINUTES', Math.max(fallback, 15));
  const routeMinutes = (distanceKm * detourFactor) / averageSpeedKmh * 60;

  return Math.round(Math.min(Math.max(routeMinutes + handoffBufferMinutes, minTravelMinutes), maxTravelMinutes));
}

export function calculateOrderEta(params: {
  restaurant: EtaRestaurant;
  order: EtaOrder;
  preparationTimeMinutes?: number | null;
  from?: Date;
  isPickup?: boolean;
}) {
  const from = params.from || new Date();
  const preparationMinutes = Math.max(0, params.preparationTimeMinutes || 0);
  const travelMinutes = params.isPickup ? 0 : estimateDeliveryTravelMinutes(params.restaurant, params.order);

  return {
    estimatedDeliveryTime: new Date(from.getTime() + (preparationMinutes + travelMinutes) * 60 * 1000),
    preparationDeadlineAt: preparationMinutes
      ? new Date(from.getTime() + preparationMinutes * 60 * 1000)
      : null,
    travelMinutes,
  };
}
