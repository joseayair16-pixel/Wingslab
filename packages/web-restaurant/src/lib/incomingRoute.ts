export type RoutePoint = { lat: number; lng: number };
export type IncomingRoute = { distanceMeters: number; path: RoutePoint[] };

function validRoute(distance: unknown, path: unknown): IncomingRoute | null {
  if (typeof distance !== 'number' || !Number.isFinite(distance) || distance < 0) return null;
  return { distanceMeters: distance, path: Array.isArray(path) ? path : [] };
}

/** Both methods return road distance; neither substitutes straight-line distance. */
export async function fetchIncomingRoute(google: any, origin: RoutePoint, destination: RoutePoint): Promise<IncomingRoute> {
  let modernError: unknown;
  try {
    const { Route } = await google.maps.importLibrary('routes');
    const { routes } = await Route.computeRoutes({
      origin, destination, travelMode: 'DRIVING', routingPreference: 'TRAFFIC_UNAWARE',
      computeAlternativeRoutes: false, polylineQuality: 'OVERVIEW', language: 'es', region: 'mx',
      fields: ['distanceMeters', 'path'],
    });
    const result = validRoute(routes?.[0]?.distanceMeters, routes?.[0]?.path);
    if (result) return result;
    throw new Error('Google Routes no devolvió distancia');
  } catch (error) {
    modernError = error;
  }

  // Some projects have Directions API enabled but not the newer Routes API.
  try {
    let DirectionsService = google.maps.DirectionsService;
    if (!DirectionsService && google.maps.importLibrary) {
      const library = await google.maps.importLibrary('routes');
      DirectionsService = library.DirectionsService || google.maps.DirectionsService;
    }
    if (!DirectionsService) throw new Error('DirectionsService no disponible');
    const response = await new DirectionsService().route({ origin, destination, travelMode: 'DRIVING' });
    const route = response.routes?.[0];
    const legs = route?.legs;
    const distances = legs?.map((leg: any) => leg.distance?.value);
    const distance = distances?.length && distances.every((value: unknown) => typeof value === 'number' && Number.isFinite(value))
      ? distances.reduce((sum: number, value: number) => sum + value, 0) : undefined;
    const result = validRoute(distance, route?.overview_path);
    if (result) return result;
    throw new Error('Google Directions no devolvió distancia');
  } catch (legacyError) {
    console.warn('[WingsLab] No se pudo calcular la ruta con Google Routes ni Directions.', { modernError, legacyError });
    throw new Error('No se pudo calcular la ruta. Revisa la conexión y la configuración de Google Maps.');
  }
}
