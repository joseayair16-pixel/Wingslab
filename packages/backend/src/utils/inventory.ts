export interface AvailabilitySource {
  isAvailable: boolean;
  trackStock: boolean;
  stock: number;
  lowStockThreshold: number;
}

export interface Availability {
  available: boolean;
  lowStock: boolean;
}

export function computeAvailability(p: AvailabilitySource): Availability {
  return { available: p.isAvailable, lowStock: false };
}
