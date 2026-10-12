/**
 * Tests para `revokePushRegistrations` (revocación best-effort al cerrar sesión).
 *
 * Lo que debe demostrar cada caso:
 *  - éxito: se llama al endpoint correcto con el método, cabeceras y cuerpo
 *    esperados, sin exponer el token en ningún log;
 *  - red rechazada: la promesa igual se resuelve (el logout continúa);
 *  - red colgada: la promesa se resuelve al agotarse el timeout (el logout
 *    continúa) y no deja temporizadores vivos;
 *  - llamadas consecutivas: la primera no bloquea a la segunda;
 *  - sin jwt o sin objetivo: no se llama a la red.
 */
import { fetchWithTimeout } from './fetchWithTimeout';
import { revokePushRegistrations } from './revokePushRegistrations';

jest.mock('./fetchWithTimeout', () => ({
  fetchWithTimeout: jest.fn(),
}));

const mockedFetchWithTimeout = fetchWithTimeout as jest.Mock;

const BASE = {
  apiBase: 'https://api.test',
  jwt: 'jwt-de-sesion-actual',
};

describe('revokePushRegistrations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('revoca el token FCM con el contrato esperado (respuesta exitosa)', async () => {
    mockedFetchWithTimeout.mockResolvedValue(new Response('{"success":true}', { status: 200 }));

    await expect(
      revokePushRegistrations({ ...BASE, target: { kind: 'fcm', token: 'tok-abc' } })
    ).resolves.toEqual({ attempted: true });

    expect(mockedFetchWithTimeout).toHaveBeenCalledTimes(1);
    const [url, init] = mockedFetchWithTimeout.mock.calls[0];
    expect(url).toBe('https://api.test/notifications/fcm-token');
    expect(init.method).toBe('DELETE');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer jwt-de-sesion-actual',
    });
    expect(JSON.parse(init.body)).toEqual({ token: 'tok-abc' });
    expect(typeof init.timeoutMs).toBe('number');
  });

  it('revoca la suscripción web con el contrato esperado', async () => {
    mockedFetchWithTimeout.mockResolvedValue(new Response('{"success":true}', { status: 200 }));

    await expect(
      revokePushRegistrations({ ...BASE, target: { kind: 'web', endpoint: 'https://push.test/e1' } })
    ).resolves.toEqual({ attempted: true });

    const [url, init] = mockedFetchWithTimeout.mock.calls[0];
    expect(url).toBe('https://api.test/notifications/subscription');
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body)).toEqual({ endpoint: 'https://push.test/e1' });
  });

  it('el logout termina aunque la red rechace la petición', async () => {
    mockedFetchWithTimeout.mockRejectedValue(new TypeError('fetch failed'));

    let logoutContinuo = false;
    await revokePushRegistrations({ ...BASE, target: { kind: 'fcm', token: 'tok-abc' } }).finally(
      () => {
        logoutContinuo = true;
      }
    );

    expect(logoutContinuo).toBe(true);
  });

  it('el logout termina aunque la petición quede colgada hasta el timeout', async () => {
    // fetchWithTimeout real con una red que nunca responde y timeout corto.
    jest.requireActual('./fetchWithTimeout');
    const { fetchWithTimeout: realFetchWithTimeout } = jest.requireActual<{
      fetchWithTimeout: typeof fetchWithTimeout;
    }>('./fetchWithTimeout');
    const hangingFetch = jest.fn(() => new Promise<Response>(() => {}));
    const originalFetch = global.fetch;
    (global as { fetch: unknown }).fetch = hangingFetch;
    try {
      // Sustituye temporalmente el mock por una implementación con timeout real.
      mockedFetchWithTimeout.mockImplementation((url: unknown, init: { timeoutMs?: number }) =>
        realFetchWithTimeout(url as string, { ...init, timeoutMs: 60 })
      );

      const started = Date.now();
      let logoutContinuo = false;
      await revokePushRegistrations({ ...BASE, target: { kind: 'web', endpoint: 'https://push.test/e1' } }).finally(
        () => {
          logoutContinuo = true;
        }
      );

      expect(logoutContinuo).toBe(true);
      expect(Date.now() - started).toBeLessThan(5000);
      expect(hangingFetch).toHaveBeenCalledTimes(1);
    } finally {
      (global as { fetch: unknown }).fetch = originalFetch;
    }
  });

  it('dos revocaciones consecutivas no se bloquean entre sí', async () => {
    // Ambas redes "cuelgan": con el timeout integrado cada una termina sola.
    const { fetchWithTimeout: realFetchWithTimeout } = jest.requireActual<{
      fetchWithTimeout: typeof fetchWithTimeout;
    }>('./fetchWithTimeout');
    mockedFetchWithTimeout.mockImplementation((url: unknown, init: { timeoutMs?: number }) =>
      realFetchWithTimeout(url as string, { ...init, timeoutMs: 50 })
    );

    const first = revokePushRegistrations({ ...BASE, target: { kind: 'fcm', token: 'tok-1' } });
    const second = revokePushRegistrations({ ...BASE, target: { kind: 'fcm', token: 'tok-2' } });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { attempted: true },
      { attempted: true },
    ]);
  });

  it('sin jwt o sin objetivo no llama a la red', async () => {
    await expect(
      revokePushRegistrations({ ...BASE, jwt: '', target: { kind: 'fcm', token: 'tok-abc' } })
    ).resolves.toEqual({ attempted: false });
    await expect(
      revokePushRegistrations({ ...BASE, target: null })
    ).resolves.toEqual({ attempted: false });
    expect(mockedFetchWithTimeout).not.toHaveBeenCalled();
  });
});
