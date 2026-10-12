import {
  PENDING_ORDER_STORAGE_KEY,
  clearPendingOrderAttempt,
  findReusableOrderKey,
  readPendingOrderAttempt,
  writePendingOrderAttempt,
} from './pendingOrderAttempt';

function createStorage(): Storage & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return {
    data,
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
    removeItem: (key: string) => {
      delete data[key];
    },
    clear: () => {
      for (const key of Object.keys(data)) delete data[key];
    },
    key: () => null,
    length: 0,
  } as unknown as Storage & { data: Record<string, string> };
}

const attempt = { userId: 'u1', restaurantId: 'r1', sigHash: '12.abc', key: 'key-1' };

describe('pendingOrderAttempt — recuperación del intento tras recarga', () => {
  it('persiste solo identidad (hash, usuario, restaurante, clave)', () => {
    const storage = createStorage();
    writePendingOrderAttempt(attempt, storage);
    const raw = storage.data[PENDING_ORDER_STORAGE_KEY];
    expect(JSON.parse(raw)).toEqual(attempt);
    expect(raw).not.toContain('productId');
    expect(raw).not.toContain('street');
  });

  it('una vista nueva (simula recarga/remount) recupera la misma clave', () => {
    const storage = createStorage();
    writePendingOrderAttempt(attempt, storage);
    // "Recarga": nueva vista, referencias en memoria perdidas.
    expect(findReusableOrderKey(attempt, storage)).toBe('key-1');
    expect(readPendingOrderAttempt(storage)?.key).toBe('key-1');
  });

  it('no reutiliza la clave si cambió el contenido, el usuario o el restaurante', () => {
    const storage = createStorage();
    writePendingOrderAttempt(attempt, storage);
    expect(findReusableOrderKey({ ...attempt, sigHash: '99.zzz' }, storage)).toBeNull();
    expect(findReusableOrderKey({ ...attempt, userId: 'u2' }, storage)).toBeNull();
    expect(findReusableOrderKey({ ...attempt, restaurantId: 'r2' }, storage)).toBeNull();
  });

  it('tras el éxito la entrada se limpia y el siguiente intento usa clave nueva', () => {
    const storage = createStorage();
    writePendingOrderAttempt(attempt, storage);
    clearPendingOrderAttempt(storage);
    expect(findReusableOrderKey(attempt, storage)).toBeNull();
    expect(readPendingOrderAttempt(storage)).toBeNull();
  });

  it('es idempotente al reescribir el mismo intento', () => {
    const storage = createStorage();
    writePendingOrderAttempt(attempt, storage);
    writePendingOrderAttempt(attempt, storage);
    expect(Object.keys(storage.data)).toHaveLength(1);
    expect(findReusableOrderKey(attempt, storage)).toBe('key-1');
  });

  it('degrada sin lanzar cuando no hay storage (SSR / modo privado)', () => {
    expect(readPendingOrderAttempt(null)).toBeNull();
    expect(() => writePendingOrderAttempt(attempt, null)).not.toThrow();
    expect(() => clearPendingOrderAttempt(null)).not.toThrow();
    expect(findReusableOrderKey(attempt, null)).toBeNull();
  });

  it('degrada sin lanzar cuando el storage falla (cuota, JSON corrupto)', () => {
    const throwing = {
      getItem: () => {
        throw new Error('boom');
      },
      setItem: () => {
        throw new Error('boom');
      },
      removeItem: () => {
        throw new Error('boom');
      },
    } as unknown as Storage;
    expect(readPendingOrderAttempt(throwing)).toBeNull();
    expect(() => writePendingOrderAttempt(attempt, throwing)).not.toThrow();
    expect(() => clearPendingOrderAttempt(throwing)).not.toThrow();

    const storage = createStorage();
    storage.setItem(PENDING_ORDER_STORAGE_KEY, '{no-json');
    expect(readPendingOrderAttempt(storage)).toBeNull();
    storage.setItem(PENDING_ORDER_STORAGE_KEY, JSON.stringify({ key: '', sigHash: '' }));
    expect(readPendingOrderAttempt(storage)).toBeNull();
  });
});