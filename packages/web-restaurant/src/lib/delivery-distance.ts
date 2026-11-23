type Coordinates = { latitude?: number | null; longitude?: number | null } | null | undefined;

/** Distancia geográfica aproximada, no distancia de conducción. */
export function deliveryDistanceKm(origin: Coordinates, destination: Coordinates): number | null {
  const a = origin?.latitude, b = origin?.longitude, c = destination?.latitude, d = destination?.longitude;
  if (typeof a !== 'number' || typeof b !== 'number' || typeof c !== 'number' || typeof d !== 'number' ||
      ![a, b, c, d].every(Number.isFinite) || Math.abs(a) > 90 || Math.abs(c) > 90 || Math.abs(b) > 180 || Math.abs(d) > 180) return null;
  const radians = Math.PI / 180;
  const lat = (c - a) * radians, lng = (d - b) * radians;
  const h = Math.sin(lat / 2) ** 2 + Math.cos(a * radians) * Math.cos(c * radians) * Math.sin(lng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
