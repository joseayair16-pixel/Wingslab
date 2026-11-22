type Point = { lat: number; lng: number };

/** Routes JS only. Small field masks avoid downloading unused route data. */
export async function computeDrivingRoute(google: any, origin: Point, destination: Point, navigation = false) {
  for (const point of [origin, destination]) {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng) || Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) {
      throw new Error('Coordenadas de ruta inválidas');
    }
  }
  const { Route } = await google.maps.importLibrary('routes');
  const { routes } = await Route.computeRoutes({
    origin, destination, travelMode: 'DRIVING', routingPreference: 'TRAFFIC_UNAWARE',
    computeAlternativeRoutes: false, polylineQuality: navigation ? 'HIGH_QUALITY' : 'OVERVIEW', language: 'es', region: 'mx',
    fields: navigation ? ['path', 'distanceMeters', 'durationMillis', 'legs'] : ['path'],
  });
  const route = routes?.[0];
  if (!route?.path?.length) throw new Error('No se encontró una ruta');
  // Normalize once for existing navigation math; no DirectionsService request.
  const latLng = (p: any) => new google.maps.LatLng(p.lat, p.lng);
  return {
    path: route.path.map(latLng),
    distance: { value: route.distanceMeters },
    duration: { value: route.durationMillis == null ? undefined : route.durationMillis / 1000 },
    steps: (route.legs || []).flatMap((leg: any) => (leg.steps || []).map((step: any) => ({
      start_location: step.startLocation ? latLng(step.startLocation) : undefined,
      end_location: step.endLocation ? latLng(step.endLocation) : undefined,
      instructions: step.instructions || '',
      maneuver: (step.maneuver || '').toLowerCase().replace(/_/g, '-'),
      distance: { value: step.distanceMeters, text: step.localizedValues?.distance || '' },
      duration: { value: (step.staticDurationMillis || 0) / 1000 },
    }))),
  };
}
