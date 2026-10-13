/**
 * Sello de build: debe existir siempre (string no vacío) y registrarse una
 * sola vez sin romper en entornos sin window/console.
 */
import { WEB_BUILD_ID, logWebBuildOnce } from './buildInfo';

describe('buildInfo', () => {
  it('expone un identificador de bundle', () => {
    expect(typeof WEB_BUILD_ID).toBe('string');
    expect(WEB_BUILD_ID.length).toBeGreaterThan(0);
  });

  it('logWebBuildOnce no lanza y es idempotente', () => {
    (globalThis as any).window = {};
    const infos: unknown[][] = [];
    (globalThis as any).console = { info: (...a: unknown[]) => infos.push(a) };
    logWebBuildOnce();
    logWebBuildOnce();
    expect((globalThis as any).window.__SADEL_WEB_BUILD).toBe(WEB_BUILD_ID);
    expect(infos.length).toBeLessThanOrEqual(1);
    delete (globalThis as any).window;
  });
});
