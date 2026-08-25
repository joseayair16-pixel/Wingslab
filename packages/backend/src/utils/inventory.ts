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

/**
 * Deriva la disponibilidad que se expone al cliente a partir de los campos
 * de inventario. Cuando trackStock=false se ignora el stock y se usa
 * isAvailable (comportamiento clásico del catálogo).
 *
 * Nunca se expone el número crudo de stock al cliente.
 */
export function computeAvailability(p: AvailabilitySource): Availability {
  const available = p.trackStock ? p.stock > 0 : p.isAvailable;
  const lowStock = p.trackStock && p.stock > 0 && p.stock <= p.lowStockThreshold;
  return { available, lowStock };
}
