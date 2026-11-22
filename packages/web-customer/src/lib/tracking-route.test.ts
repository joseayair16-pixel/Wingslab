import assert from 'node:assert/strict';
import { distanceToRouteMeters, isFreshRouteLocation, reserveRouteRequest } from './tracking-route';

test('distance follows segments, including endpoints and repeated points', () => {
  const path = [{ lat: 0, lng: 0 }, { lat: 0, lng: 0.01 }];
  assert.equal(distanceToRouteMeters({ lat: 0, lng: 0.005 }, path), 0);
  assert.ok(Math.abs(distanceToRouteMeters({ lat: 0.001, lng: 0.005 }, path) - 111.32) < 1);
  assert.ok(distanceToRouteMeters({ lat: 0, lng: 0.02 }, path) > 1000);
  assert.equal(distanceToRouteMeters(path[0], [path[0], path[0]]), 0);
  assert.equal(distanceToRouteMeters(path[0], []), Infinity);
});

test('rejects stale, missing, future and invalid GPS', () => {
  const point = { lat: 19.7, lng: -101.2 }, now = 1000000;
  assert.equal(isFreshRouteLocation(point, now - 1000, now), true);
  assert.equal(isFreshRouteLocation(point, now - 120001, now), false);
  assert.equal(isFreshRouteLocation(point, NaN, now), false);
  assert.equal(isFreshRouteLocation(point, now + 10001, now), false);
  assert.equal(isFreshRouteLocation({ lat: 91, lng: 0 }, now, now), false);
});

test('budget survives callers remounting and enforces cooldown and total cap', () => {
  const key = 'budget-test';
  assert.equal(reserveRouteRequest(key, 1000000), 'reserved');
  assert.equal(reserveRouteRequest(key, 1000001), 'cooldown');
  for (let i = 1; i < 12; i++) assert.equal(reserveRouteRequest(key, 1000000 + i * 60000), 'reserved');
  assert.equal(reserveRouteRequest(key, 99999999), 'exhausted');
  assert.equal(reserveRouteRequest('different-order', 1000000), 'reserved');
});
