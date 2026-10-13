/**
 * Tubería de sesión del comensal: recuperación ante access vencido, socket
 * rechazado, 403 y carreras entre pestañas.
 *
 * Importa el fuente compartido por ruta relativa para no depender del `dist`
 * compilado. El código bajo prueba es el mismo en web, PWA y APK, así que
 * estas pruebas cubren las tres plataformas.
 */
import {
  ApiRequestError,
  handleSocketUnauthorized,
  isSessionInvalidError,
  persistStoredSession,
  readStoredSession,
  refreshStoredSessionForSocket,
  requestJson,
  setDefaultRefreshConfig,
  setGlobalSessionExpiredHandler,
} from '../../../shared/src/web';

const API = 'https://api.test';
const KEY = 'sadel.customer';
const USER: any = {
  id: 'user-1',
  name: 'Test',
  phone: '+520000000000',
  role: 'CUSTOMER',
  region: 'MX',
  status: 'ACTIVE',
};

type MemStore = Record<string, string>;

function installWindowStub() {
  const mem: MemStore = {};
  const listeners: Record<string, Array<(e: any) => void>> = {};
  const localStorage = {
    getItem: (k: string): string | null => (k in mem ? mem[k] : null),
    setItem: (k: string, v: string): void => {
      mem[k] = String(v);
    },
    removeItem: (k: string): void => {
      delete mem[k];
    },
    clear: (): void => {
      for (const k of Object.keys(mem)) delete mem[k];
    },
  };
  (globalThis as any).window = {
    localStorage,
    setTimeout: (fn: (...a: any[]) => void, ms?: number, ...rest: any[]): unknown =>
      setTimeout(fn, ms, ...rest),
    clearTimeout: (id: unknown): void => clearTimeout(id as any),
    addEventListener: (type: string, handler: (e: any) => void): void => {
      (listeners[type] = listeners[type] || []).push(handler);
    },
    removeEventListener: (type: string, handler: (e: any) => void): void => {
      listeners[type] = (listeners[type] || []).filter((h) => h !== handler);
    },
    dispatchEvent: (event: any): boolean => {
      for (const h of listeners[event?.type] || []) h(event);
      return true;
    },
  };
  (globalThis as any).CustomEvent = class {
    type: string;
    detail: unknown;
    constructor(type: string, init?: { detail?: unknown }) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  return { mem, localStorage };
}

function jsonResponse(status: number, body: unknown) {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => body,
  };
}

function seedSession(token: string, refreshToken: string | null) {
  persistStoredSession({ storageKey: KEY, apiBase: API, token, user: USER });
  if (refreshToken) {
    window.localStorage.setItem(`${KEY}.refreshToken`, refreshToken);
  } else {
    window.localStorage.removeItem(`${KEY}.refreshToken`);
  }
}

function wireDefaultConfig(spies: { refreshed: Array<{ t: string; r: string }>; failed: number }) {
  setDefaultRefreshConfig({
    refreshToken: () => readStoredSession(KEY).refreshToken,
    onRefreshed: (t, r) => {
      spies.refreshed.push({ t, r });
      const current = readStoredSession(KEY);
      if (current.user) {
        persistStoredSession({ storageKey: KEY, apiBase: API, token: t, refreshToken: r, user: current.user });
      }
    },
    onRefreshFailed: () => {
      spies.failed += 1;
    },
  });
}

beforeEach(() => {
  installWindowStub();
  setDefaultRefreshConfig(null);
  setGlobalSessionExpiredHandler(null);
});

afterEach(() => {
  setDefaultRefreshConfig(null);
  setGlobalSessionExpiredHandler(null);
  delete (globalThis as any).fetch;
});

describe('recuperación al abrir con access vencido (init del home)', () => {
  it('access vencido + refresh válido: recupera sin pedir login', async () => {
    seedSession('access-viejo', 'refresh-1');
    const spies = { refreshed: [] as Array<{ t: string; r: string }>, failed: 0 };
    let expiredCalls = 0;
    setGlobalSessionExpiredHandler(() => {
      expiredCalls += 1;
    });
    (globalThis as any).fetch = async (url: string, init?: any) => {
      if (String(url).endsWith('/auth/refresh')) {
        return jsonResponse(200, { success: true, data: { token: 'access-2', refreshToken: 'refresh-2' } });
      }
      if (String(url).endsWith('/auth/perfil')) {
        const auth = init?.headers?.authorization;
        if (auth === 'Bearer access-2') {
          return jsonResponse(200, { success: true, data: { status: 'ACTIVE' } });
        }
        return jsonResponse(401, { success: false, error: { code: 'UNAUTHORIZED', message: 'x' } });
      }
      throw new Error(`fetch inesperado: ${url}`);
    };
    wireDefaultConfig(spies);

    const data = await requestJson<{ success: boolean; data: { status: string } }>({
      apiBase: API,
      path: '/auth/perfil',
      token: 'access-viejo',
    });

    expect(data.data.status).toBe('ACTIVE');
    expect(spies.refreshed).toEqual([{ t: 'access-2', r: 'refresh-2' }]);
    expect(spies.failed).toBe(0);
    expect(expiredCalls).toBe(0);
    expect(readStoredSession(KEY).token).toBe('access-2');
    expect(readStoredSession(KEY).refreshToken).toBe('refresh-2');
  });

  it('la config fijada tras iniciar la petición igual aplica (lectura perezosa)', async () => {
    seedSession('access-viejo', 'refresh-1');
    const spies = { refreshed: [] as Array<{ t: string; r: string }>, failed: 0 };
    (globalThis as any).fetch = async (url: string, init?: any) => {
      // Cede el turno para que el llamador fije la config antes de responder.
      await Promise.resolve();
      if (String(url).endsWith('/auth/refresh')) {
        return jsonResponse(200, { success: true, data: { token: 'access-2', refreshToken: 'refresh-2' } });
      }
      const auth = init?.headers?.authorization;
      if (auth === 'Bearer access-2') {
        return jsonResponse(200, { success: true, data: { status: 'ACTIVE' } });
      }
      return jsonResponse(401, { success: false, error: { code: 'UNAUTHORIZED', message: 'x' } });
    };

    const pending = requestJson<{ success: boolean; data: { status: string } }>({
      apiBase: API,
      path: '/auth/perfil',
      token: 'access-viejo',
    });
    // Sin config explícita y sin default todavía: se fija después de disparar.
    wireDefaultConfig(spies);
    const data = await pending;

    expect(data.data.status).toBe('ACTIVE');
    expect(spies.failed).toBe(0);
  });

  it('refresh inválido/expirado: cierra sesión (comportamiento esperado)', async () => {
    seedSession('access-viejo', 'refresh-muerto');
    const spies = { refreshed: [] as Array<{ t: string; r: string }>, failed: 0 };
    let expiredCalls = 0;
    setGlobalSessionExpiredHandler(() => {
      expiredCalls += 1;
    });
    (globalThis as any).fetch = async (url: string, _init?: any) => {
      if (String(url).endsWith('/auth/refresh')) {
        return jsonResponse(401, { success: false, error: { code: 'INVALID_REFRESH_TOKEN', message: 'x' } });
      }
      return jsonResponse(401, { success: false, error: { code: 'UNAUTHORIZED', message: 'x' } });
    };
    wireDefaultConfig(spies);

    await expect(
      requestJson({ apiBase: API, path: '/auth/perfil', token: 'access-viejo' }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    expect(spies.refreshed).toEqual([]);
    expect(spies.failed).toBe(1);
    expect(expiredCalls).toBe(1);
  });
});

describe('403 no cierra sesión', () => {
  it('403 FORBIDDEN no notifica expiración y lanza error de permiso', async () => {
    seedSession('access-ok', 'refresh-1');
    let expiredCalls = 0;
    setGlobalSessionExpiredHandler(() => {
      expiredCalls += 1;
    });
    (globalThis as any).fetch = async () =>
      jsonResponse(403, { success: false, error: { code: 'FORBIDDEN', message: 'Sin permiso' } });
    wireDefaultConfig({ refreshed: [], failed: 0 });

    const err = await requestJson({ apiBase: API, path: '/x', token: 'access-ok' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect((err as ApiRequestError).kind).toBe('forbidden');
    expect(expiredCalls).toBe(0);
    expect(isSessionInvalidError(err)).toBe(false);
    // La sesión sigue intacta en almacenamiento.
    expect(readStoredSession(KEY).token).toBe('access-ok');
  });

  it.each([
    [{ status: 401, code: 'UNAUTHORIZED' }, true, '401 desloguea'],
    [{ status: 404, code: 'USER_NOT_FOUND' }, true, '404 usuario eliminado desloguea'],
    [{ status: 403, code: 'ACCOUNT_DISABLED' }, true, '403 cuenta deshabilitada desloguea'],
    [{ status: 403, code: 'FORBIDDEN' }, false, '403 permisos conserva sesión'],
    [{ status: 403, code: 'PHONE_CHANGE_CODE_REQUIRED' }, false, '403 flujo de negocio conserva sesión'],
    [{ status: 500, code: 'X' }, false, '500 conserva sesión'],
  ])('isSessionInvalidError(%j) === %s (%s)', (shape, expected) => {
    const err = new ApiRequestError({ message: 'm', kind: 'auth', status: shape.status, code: shape.code });
    expect(isSessionInvalidError(err)).toBe(expected);
  });

  it('errores no-API nunca desloguean', () => {
    expect(isSessionInvalidError(new Error('boom'))).toBe(false);
    expect(isSessionInvalidError(null)).toBe(false);
  });
});

describe('carrera entre pestañas al rotar', () => {
  it('si otra pestaña ya rotó, reintenta con el vigente en vez de desloguear', async () => {
    let currentRefresh: string | null = 'R1';
    seedSession('access-viejo', 'R1');
    const spies = { refreshed: [] as Array<{ t: string; r: string }>, failed: 0 };
    let refreshCalls = 0;
    (globalThis as any).fetch = async (url: string, init?: any) => {
      if (String(url).endsWith('/auth/refresh')) {
        refreshCalls += 1;
        const body = JSON.parse(init?.body || '{}');
        if (body.refreshToken === 'R1') {
          // La otra pestaña persistió R2 mientras tanto.
          currentRefresh = 'R2';
          window.localStorage.setItem(`${KEY}.refreshToken`, 'R2');
          return jsonResponse(401, { success: false, error: { code: 'INVALID_REFRESH_TOKEN', message: 'x' } });
        }
        if (body.refreshToken === 'R2') {
          return jsonResponse(200, { success: true, data: { token: 'access-3', refreshToken: 'R3' } });
        }
        throw new Error('refresh inesperado');
      }
      const auth = init?.headers?.authorization;
      if (auth === 'Bearer access-3') {
        return jsonResponse(200, { success: true, data: { ok: true } });
      }
      return jsonResponse(401, { success: false, error: { code: 'UNAUTHORIZED', message: 'x' } });
    };
    setDefaultRefreshConfig({
      refreshToken: () => currentRefresh,
      onRefreshed: (t, r) => {
        spies.refreshed.push({ t, r });
        currentRefresh = r;
        persistStoredSession({ storageKey: KEY, apiBase: API, token: t, refreshToken: r, user: USER });
      },
      onRefreshFailed: () => {
        spies.failed += 1;
      },
    });

    const data = await requestJson({ apiBase: API, path: '/cosa', token: 'access-viejo' });

    expect(data).toEqual({ success: true, data: { ok: true } });
    expect(refreshCalls).toBe(2);
    expect(spies.failed).toBe(0);
    expect(spies.refreshed).toEqual([{ t: 'access-3', r: 'R3' }]);
  });

  it('peticiones concurrentes comparten UNA sola rotación (sin tormenta)', async () => {
    seedSession('access-viejo', 'R1');
    let refreshCalls = 0;
    (globalThis as any).fetch = async (url: string, init?: any) => {
      if (String(url).endsWith('/auth/refresh')) {
        refreshCalls += 1;
        await new Promise((r) => setTimeout(r, 20));
        return jsonResponse(200, { success: true, data: { token: 'access-2', refreshToken: 'R2' } });
      }
      const auth = init?.headers?.authorization;
      if (auth === 'Bearer access-2') {
        return jsonResponse(200, { success: true, data: { ok: true } });
      }
      return jsonResponse(401, { success: false, error: { code: 'UNAUTHORIZED', message: 'x' } });
    };
    wireDefaultConfig({ refreshed: [], failed: 0 });

    const results = await Promise.all([
      requestJson({ apiBase: API, path: '/a', token: 'access-viejo' }),
      requestJson({ apiBase: API, path: '/b', token: 'access-viejo' }),
      requestJson({ apiBase: API, path: '/c', token: 'access-viejo' }),
    ]);

    expect(results).toHaveLength(3);
    expect(refreshCalls).toBe(1);
  });
});

describe('fallos transitorios no desloguean', () => {
  it('refresh con 500 persistente: error reintentable, sesión intacta', async () => {
    seedSession('access-viejo', 'R1');
    const spies = { refreshed: [] as Array<{ t: string; r: string }>, failed: 0 };
    let expiredCalls = 0;
    setGlobalSessionExpiredHandler(() => {
      expiredCalls += 1;
    });
    (globalThis as any).fetch = async (url: string) => {
      if (String(url).endsWith('/auth/refresh')) {
        return jsonResponse(500, { success: false });
      }
      return jsonResponse(401, { success: false, error: { code: 'UNAUTHORIZED', message: 'x' } });
    };
    wireDefaultConfig(spies);

    const err = await requestJson({ apiBase: API, path: '/cosa', token: 'access-viejo' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect((err as ApiRequestError).isTransient).toBe(true);
    expect(spies.failed).toBe(0);
    expect(expiredCalls).toBe(0);
    expect(readStoredSession(KEY).refreshToken).toBe('R1');
  });
});

describe('recuperación del socket (refreshStoredSessionForSocket/handleSocketUnauthorized)', () => {
  function fakeSocket() {
    const calls: string[] = [];
    return {
      calls,
      auth: null as unknown,
      disconnect: () => {
        calls.push('disconnect');
      },
      connect: () => {
        calls.push('connect');
      },
    };
  }

  it('renueva, persiste, avisa por evento y reconecta', async () => {
    seedSession('access-viejo', 'R1');
    const events: unknown[] = [];
    window.addEventListener('sadel:token-refreshed', (e: any) => events.push(e.detail));
    (globalThis as any).fetch = async (url: string) => {
      if (String(url).endsWith('/auth/refresh')) {
        return jsonResponse(200, { success: true, data: { token: 'access-2', refreshToken: 'R2' } });
      }
      throw new Error(`fetch inesperado: ${url}`);
    };

    const outcome = await refreshStoredSessionForSocket({ apiBase: API, storageKey: KEY });
    expect(outcome).toEqual({ ok: true, token: 'access-2' });
    expect(readStoredSession(KEY).token).toBe('access-2');
    expect(readStoredSession(KEY).refreshToken).toBe('R2');
    expect(events).toEqual(['access-2']);

    const socket = fakeSocket();
    let loggedOut = 0;
    const result = await handleSocketUnauthorized({
      apiBase: API,
      storageKey: KEY,
      socket,
      onLoggedOut: () => {
        loggedOut += 1;
      },
    });
    expect(result).toBe('reconnected');
    expect(socket.calls).toEqual(['disconnect', 'connect']);
    expect((socket.auth as any)?.token).toBe('access-2');
    expect(loggedOut).toBe(0);
  });

  it('sin refresh almacenado: logout esperado, sin reconectar', async () => {
    seedSession('access-viejo', null);
    const socket = fakeSocket();
    let loggedOut = 0;
    const result = await handleSocketUnauthorized({
      apiBase: API,
      storageKey: KEY,
      socket,
      onLoggedOut: () => {
        loggedOut += 1;
      },
    });
    expect(result).toBe('logged-out');
    expect(loggedOut).toBe(1);
    expect(socket.calls).toEqual(['disconnect']);
  });

  it('refresh definitivamente inválido: logout esperado, sin reconectar', async () => {
    seedSession('access-viejo', 'R-muerto');
    (globalThis as any).fetch = async (url: string) => {
      if (String(url).endsWith('/auth/refresh')) {
        return jsonResponse(401, { success: false, error: { code: 'INVALID_REFRESH_TOKEN', message: 'x' } });
      }
      throw new Error(`fetch inesperado: ${url}`);
    };
    const socket = fakeSocket();
    let loggedOut = 0;
    const result = await handleSocketUnauthorized({
      apiBase: API,
      storageKey: KEY,
      socket,
      onLoggedOut: () => {
        loggedOut += 1;
      },
    });
    expect(result).toBe('logged-out');
    expect(loggedOut).toBe(1);
    expect(socket.calls).toEqual(['disconnect']);
  });

  it('fallo transitorio: no desloguea, no reconecta solo, marca estado recuperable', async () => {
    seedSession('access-viejo', 'R1');
    (globalThis as any).fetch = async (url: string) => {
      if (String(url).endsWith('/auth/refresh')) {
        return jsonResponse(500, { success: false });
      }
      throw new Error(`fetch inesperado: ${url}`);
    };
    const socket = fakeSocket();
    const statuses: string[] = [];
    let loggedOut = 0;
    const result = await handleSocketUnauthorized({
      apiBase: API,
      storageKey: KEY,
      socket,
      onStatus: (s) => statuses.push(s),
      onLoggedOut: () => {
        loggedOut += 1;
      },
    });
    expect(result).toBe('deferred');
    expect(socket.calls).toEqual(['disconnect']);
    expect(statuses).toEqual(['reconnecting']);
    expect(loggedOut).toBe(0);
    expect(readStoredSession(KEY).refreshToken).toBe('R1');
  });

  it('si el componente se desmontó, no toca nada más', async () => {
    seedSession('access-viejo', 'R1');
    (globalThis as any).fetch = async (url: string) => {
      if (String(url).endsWith('/auth/refresh')) {
        return jsonResponse(200, { success: true, data: { token: 'access-2', refreshToken: 'R2' } });
      }
      throw new Error(`fetch inesperado: ${url}`);
    };
    const socket = fakeSocket();
    const result = await handleSocketUnauthorized({
      apiBase: API,
      storageKey: KEY,
      socket,
      isActive: () => false,
      onLoggedOut: () => {
        throw new Error('no debe desloguear');
      },
    });
    expect(result).toBe('deferred');
    expect(socket.calls).toEqual(['disconnect']);
  });

  it('dos recuperaciones concurrentes comparten una sola rotación', async () => {
    seedSession('access-viejo', 'R1');
    let refreshCalls = 0;
    (globalThis as any).fetch = async (url: string) => {
      if (String(url).endsWith('/auth/refresh')) {
        refreshCalls += 1;
        await new Promise((r) => setTimeout(r, 20));
        return jsonResponse(200, { success: true, data: { token: 'access-2', refreshToken: 'R2' } });
      }
      throw new Error(`fetch inesperado: ${url}`);
    };
    const [a, b] = await Promise.all([
      handleSocketUnauthorized({ apiBase: API, storageKey: KEY, socket: fakeSocket() }),
      handleSocketUnauthorized({ apiBase: API, storageKey: KEY, socket: fakeSocket() }),
    ]);
    expect(a).toBe('reconnected');
    expect(b).toBe('reconnected');
    expect(refreshCalls).toBe(1);
  });
});
