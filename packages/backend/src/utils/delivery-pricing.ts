export type DistancePricingConfig = {
  pricingModel?: string | null;
  distanceKm?: number | null;
  baseRate?: number | null;
  perKmRate?: number | null;
  minDeliveryFee?: number | null;
  maxDeliveryFee?: number | null;
};

export function calculateDistanceDeliveryFee(input: DistancePricingConfig): number | null {
  if (input.pricingModel !== 'distance' || input.distanceKm === null || input.distanceKm === undefined) {
    return null;
  }

  const extraKm = Math.max(0, input.distanceKm - 1);
  let fee = (input.baseRate ?? 0) + extraKm * (input.perKmRate ?? 0);
  if (input.minDeliveryFee != null) fee = Math.max(fee, input.minDeliveryFee);
  if (input.maxDeliveryFee != null) fee = Math.min(fee, input.maxDeliveryFee);
  return Math.round(fee * 100) / 100;
}
