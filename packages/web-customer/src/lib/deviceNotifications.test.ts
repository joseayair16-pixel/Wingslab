/**
 * Tests para `revokeDevicePush` (desvinculación del dispositivo al cerrar
 * sesión / desactivar notificaciones).
 *
 * Lo que debe demostrar cada caso:
 *  - sin identificadores no se toca la red;
 *  - con JWT revoca por los endpoints acotados al usuario (método, cabeceras
 *    y cuerpo exactos) y limpia la cola pendiente;
 *  - SI SOLO UNO de los dos identificadores se revoca, únicamente ese queda
 *    encolado (un fallo parcial nunca se da por éxito completo);
 *  - sin JWT (o con él caducado) recurre a POST /notifications/unpair por
 *    posesión del token/endpoint;
 *  - red caída: encola ambos identificadores sin guardar credenciales.
 */
import {
  revokeDevicePush,
  readPendingDeviceUnpair,
  clearPendingDeviceUnpair,
} from '@sadel/shared';

const API = 'https://api.test';
const JWT = 'jwt-de-sesion-actual';
const FCM = 'fcm-device-123';
const ENDPOINT = 'https://push.example/dev-123';

describe('revokeDevicePush', () => {
  let storage: Record<string, string>;
  const mockFetch = jest.fn();

  beforeEach(() => {
    storage = {};
    mockFetch.mockReset();
    (global as any).fetch = mockFetch;
    (global as any).window = {
      localStorage: {
        getItem: (key: string) => (key in storage ? storage[key] : null),
        setItem: (key: string, value: string) => {
          storage[key] = value;
        },
        removeItem: (key: string) => {
          delete storage[key];
        },
      },
    };
    clearPendingDeviceUnpair();
  });

  afterEach(() => {
    delete (global as any).window;
    delete (global as any).fetch;
  });

  it('sin identificadores no llama a la red', async () => {
    const result = await revokeDevicePush({ apiBase: API, jwt: JWT });
    expect(result).toEqual({ attempted: false, success: true });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('con JWT revoca token y endpoint en los endpoints acotados y limpia pendientes', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('{"success":true}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{"success":true}', { status: 200 }));

    const result = await revokeDevicePush({
      apiBase: API,
      jwt: JWT,
      fcmToken: FCM,
      endpoint: ENDPOINT,
    });

    expect(result).toEqual({ attempted: true, success: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const [fcmUrl, fcmInit] = mockFetch.mock.calls[0];
    expect(fcmUrl).toBe('https://api.test/notifications/fcm-token');
    expect(fcmInit.method).toBe('DELETE');
    expect(fcmInit.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${JWT}`,
    });
    expect(JSON.parse(fcmInit.body)).toEqual({ token: FCM });

    const [webUrl, webInit] = mockFetch.mock.calls[1];
    expect(webUrl).toBe('https://api.test/notifications/subscription');
    expect(webInit.method).toBe('DELETE');
    expect(JSON.parse(webInit.body)).toEqual({ endpoint: ENDPOINT });

    expect(readPendingDeviceUnpair()).toBeNull();
  });

  it('fallo parcial: encola SOLO el identificador que no se pudo revocar', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('{"success":true}', { status: 200 })) // fcm OK
      .mockRejectedValueOnce(new Error('red caída')) // endpoint falla
      .mockRejectedValueOnce(new Error('red caída')); // reintento /unpair también falla

    const result = await revokeDevicePush({
      apiBase: API,
      jwt: JWT,
      fcmToken: FCM,
      endpoint: ENDPOINT,
    });

    expect(result.success).toBe(false);
    expect(readPendingDeviceUnpair()).toEqual({ fcmToken: null, endpoint: ENDPOINT });
  });

  it('sin JWT desvincula por posesión en una sola llamada a /unpair', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{"success":true}', { status: 200 }));

    const result = await revokeDevicePush({
      apiBase: API,
      jwt: null,
      fcmToken: FCM,
      endpoint: ENDPOINT,
    });

    expect(result).toEqual({ attempted: true, success: true });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.test/notifications/unpair');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({ fcmToken: FCM, endpoint: ENDPOINT });
    expect(readPendingDeviceUnpair()).toBeNull();
  });

  it('JWT rechazado (401): reintenta sin sesión vía /unpair y tiene éxito', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{"success":true}', { status: 200 }));

    const result = await revokeDevicePush({
      apiBase: API,
      jwt: JWT,
      fcmToken: FCM,
      endpoint: ENDPOINT,
    });

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    const [url] = mockFetch.mock.calls[2];
    expect(url).toBe('https://api.test/notifications/unpair');
    expect(readPendingDeviceUnpair()).toBeNull();
  });

  it('red caída por completo: encola ambos identificadores (sin credenciales)', async () => {
    mockFetch.mockRejectedValue(new Error('offline'));

    const result = await revokeDevicePush({
      apiBase: API,
      jwt: JWT,
      fcmToken: FCM,
      endpoint: ENDPOINT,
    });

    expect(result).toEqual({ attempted: true, success: false });
    expect(readPendingDeviceUnpair()).toEqual({ fcmToken: FCM, endpoint: ENDPOINT });
    // La cola jamás debe contener la sesión ni usuarios: solo ids del dispositivo.
    expect(JSON.stringify(readPendingDeviceUnpair())).not.toContain(JWT);
  });
});
