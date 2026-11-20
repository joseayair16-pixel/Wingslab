/* Pure policy shared by Node, Next configuration and browser code. No IO/env reads. */
export const browserOrigins = Object.freeze({
  backend: 'http://127.0.0.1:3101',
  restaurant: 'http://127.0.0.1:3102',
  customer: 'http://127.0.0.1:3103',
  driver: 'http://127.0.0.1:3104',
});

export function assertOrigin(value: string | undefined, role: string, profile: 'host' | 'container' = 'host'): string {
  const expected = role === 'internalApi'
    ? (profile === 'container' ? 'http://172.30.240.21:3101' : browserOrigins.backend)
    : browserOrigins[role as keyof typeof browserOrigins];
  let url: URL;
  try { url = new URL(value || ''); } catch { throw new Error(`[WingsLab] Missing origin: ${role}`); }
  if (!expected || url.origin !== expected || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`[WingsLab] Unapproved origin: ${role}`);
  }
  return url.origin;
}

export function assertConnection(value: string | undefined, kind: 'postgres' | 'redis', profile: 'host' | 'container'): string {
  if (!['host', 'container'].includes(profile)) throw new Error('[WingsLab] Invalid profile.');
  let url: URL;
  try { url = new URL(value || ''); } catch { throw new Error(`[WingsLab] Invalid ${kind} connection.`); }
  const postgres = kind === 'postgres';
  const host = profile === 'host' ? '127.0.0.1' : (postgres ? '172.30.240.10' : '172.30.240.11');
  const port = profile === 'host' ? (postgres ? '55433' : '56379') : (postgres ? '5432' : '6379');
  if (url.protocol !== (postgres ? 'postgresql:' : 'redis:') || url.hostname !== host || url.port !== port ||
      url.username !== (postgres ? 'wingslab_local' : 'default') ||
      url.pathname !== (postgres ? '/wingslab_local' : '/0') || url.password.length < 32 ||
      /replace|sample|changeme/i.test(url.password) || url.search || url.hash) {
    throw new Error(`[WingsLab] Unapproved ${kind} connection.`);
  }
  return url.toString();
}
