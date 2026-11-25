const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');

const source = fs.readFileSync(require('node:path').join(__dirname, 'incomingRoute.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const mod = new Module('incomingRoute');
mod._compile(compiled, 'incomingRoute.js');
const { fetchIncomingRoute } = mod.exports;
const origin = { lat: 19, lng: -99 };
const destination = { lat: 19.01, lng: -99.01 };

test('uses real road distance even when Google returns no polyline', async () => {
  const google = { maps: { importLibrary: async () => ({ Route: { computeRoutes: async () => ({ routes: [{ distanceMeters: 1234 }] }) } }) } };
  assert.deepEqual(await fetchIncomingRoute(google, origin, destination), { distanceMeters: 1234, path: [] });
});

test('falls back to Directions road distance when Routes fails', async () => {
  const google = { maps: { importLibrary: async () => { throw new Error('Routes disabled'); }, DirectionsService: class { async route() { return { routes: [{ legs: [{ distance: { value: 500 } }, { distance: { value: 700 } }], overview_path: [origin, destination] }] }; } } } };
  assert.deepEqual(await fetchIncomingRoute(google, origin, destination), { distanceMeters: 1200, path: [origin, destination] });
});

test('reports failure instead of inventing distance', async () => {
  const google = { maps: { importLibrary: async () => ({ Route: { computeRoutes: async () => ({ routes: [] }) }, DirectionsService: class { async route() { return { routes: [] }; } } }) } };
  const warn = console.warn;
  console.warn = () => {};
  try { await assert.rejects(fetchIncomingRoute(google, origin, destination), /No se pudo calcular/); } finally { console.warn = warn; }
});
