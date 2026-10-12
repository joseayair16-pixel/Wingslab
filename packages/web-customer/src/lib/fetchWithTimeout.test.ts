/**
 * Tests para `fetchWithTimeout` (límite temporal de peticiones best-effort).
 *
 * Se usan fake timers para no depender de esperas reales: la petición colgada
 * se aborta al avanzar el tiempo virtual, y `getTimerCount()` demuestra que el
 * temporizador siempre se limpia (sin fugas que mantengan vivo el proceso).
 */
import { fetchWithTimeout } from './fetchWithTimeout';

const URL = 'https://api.test/notifications/fcm-token';

describe('fetchWithTimeout', () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    jest.useFakeTimers();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('devuelve la respuesta cuando llega a tiempo y limpia el temporizador', async () => {
    const response = new Response('{"success":true}', { status: 200 });
    (global.fetch as jest.Mock).mockResolvedValue(response);

    const promise = fetchWithTimeout(URL, { method: 'DELETE', timeoutMs: 5000 });
    await expect(promise).resolves.toBe(response);

    const [calledUrl, calledInit] = (global.fetch as jest.Mock).mock.calls[0];
    expect(calledUrl).toBe(URL);
    expect(calledInit.method).toBe('DELETE');
    expect(calledInit.signal).toBeInstanceOf(AbortSignal);
    expect(calledInit.timeoutMs).toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('propaga el rechazo cuando la red falla (no lo convierte en éxito)', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new TypeError('fetch failed'));

    const promise = fetchWithTimeout(URL, { timeoutMs: 5000 });
    await expect(promise).rejects.toThrow('fetch failed');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('aborta la petición colgada al agotar el tiempo y limpia el temporizador', async () => {
    const seen: { signal: AbortSignal | null } = { signal: null };
    (global.fetch as jest.Mock).mockImplementation((_url: unknown, init: RequestInit) => {
      seen.signal = init.signal as AbortSignal;
      return new Promise(() => {
        // Nunca se resuelve: simula red estancada.
      });
    });

    const promise = fetchWithTimeout(URL, { timeoutMs: 5000 });
    const assertion = expect(promise).rejects.toMatchObject({ name: 'AbortError' });

    await jest.advanceTimersByTimeAsync(5000);
    await assertion;

    expect(seen.signal?.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('respeta un timeout personalizado', async () => {
    (global.fetch as jest.Mock).mockReturnValue(new Promise(() => {}));
    const promise = fetchWithTimeout(URL, { timeoutMs: 1500 });
    const assertion = expect(promise).rejects.toMatchObject({ name: 'AbortError' });

    await jest.advanceTimersByTimeAsync(1499);
    // Todavía pendiente: el temporizador no se disparó antes de tiempo.
    expect(jest.getTimerCount()).toBe(1);
    await jest.advanceTimersByTimeAsync(1);
    await assertion;
    expect(jest.getTimerCount()).toBe(0);
  });

  it('aborta de inmediato si la signal del llamador ya venía abortada', async () => {
    const controller = new AbortController();
    controller.abort();
    (global.fetch as jest.Mock).mockImplementation((_url: unknown, init: RequestInit) => {
      if (init.signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
      return new Promise(() => {});
    });

    await expect(
      fetchWithTimeout(URL, { timeoutMs: 5000, signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('propaga el abort del llamador aunque el timeout sea largo', async () => {
    const controller = new AbortController();
    (global.fetch as jest.Mock).mockReturnValue(new Promise(() => {}));
    const promise = fetchWithTimeout(URL, { timeoutMs: 60_000, signal: controller.signal });
    const assertion = expect(promise).rejects.toMatchObject({ name: 'AbortError' });

    controller.abort();
    await assertion;
    expect(jest.getTimerCount()).toBe(0);
  });
});
