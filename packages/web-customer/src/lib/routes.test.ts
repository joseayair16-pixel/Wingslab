import { computeDrivingRoute } from './routes';

function fixture(routes: any[] = [{ path: [{ lat: 19, lng: -101 }] }]) {
  const computeRoutes = jest.fn().mockResolvedValue({ routes });
  const google = { maps: {
    importLibrary: jest.fn().mockResolvedValue({ Route: { computeRoutes } }),
    LatLng: class { constructor(public latitude: number, public longitude: number) {} },
  } };
  return { google, computeRoutes };
}
const point = { lat: 19, lng: -101 };

test('uses Routes JS and requests only the path for tracking', async () => {
  const { google, computeRoutes } = fixture();
  const result = await computeDrivingRoute(google, point, point);
  expect(google.maps.importLibrary).toHaveBeenCalledWith('routes');
  expect(computeRoutes).toHaveBeenCalledWith(expect.objectContaining({ fields: ['path'], computeAlternativeRoutes: false }));
  expect(result.path).toHaveLength(1);
});

test('rejects invalid coordinates before loading Google', async () => {
  const { google } = fixture();
  await expect(computeDrivingRoute(google, { lat: 91, lng: 0 }, point)).rejects.toThrow();
  expect(google.maps.importLibrary).not.toHaveBeenCalled();
});

test('empty routes reject instead of leaving a pending calculation', async () => {
  const { google } = fixture([]);
  await expect(computeDrivingRoute(google, point, point)).rejects.toThrow('No se encontró');
});

test('converts navigation units and preserves plain instructions', async () => {
  const { google } = fixture([{ path: [point], distanceMeters: 500, durationMillis: 60000,
    legs: [{ steps: [{ instructions: 'Gira a la derecha', maneuver: 'TURN_RIGHT', distanceMeters: 100 }] }] }]);
  const result = await computeDrivingRoute(google, point, point, true);
  expect(result.duration.value).toBe(60);
  expect(result.steps[0].maneuver).toBe('turn-right');
});

test('navigation requests high-quality geometry and navigation fields', async () => {
  const { google, computeRoutes } = fixture([{ path: [point, { lat: 19.001, lng: -101.001 }] }]);
  await computeDrivingRoute(google, point, point, true);
  expect(computeRoutes).toHaveBeenCalledWith(expect.objectContaining({
    polylineQuality: 'HIGH_QUALITY',
    fields: ['path', 'distanceMeters', 'durationMillis', 'legs'],
  }));
});
