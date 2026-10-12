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
const scoped = { storage: createStorage(), scope: 'checkout.r1' };

describe('pendingOrderAttempt — recuperación del intento tras recarga', () => {
  it('persiste solo identidad (hash, usuario, restaurante, clave)', () => {
    const storage = createStorage();
    writePendingOrderAttempt(attempt, { storage });
    const raw = storage.data[PENDING_ORDER_STORAGE_KEY];
    expect(JSON.parse(raw)).toEqual(attempt);
    expect(raw).not.toContain('productId');
    expect(raw).not.toContain('street');
  });

  it('una vista nueva (simula recarga/remount) recupera la misma clave', () => {
    writePendingOrderAttempt(attempt, scoped);
    // "Recarga": nueva vista, referencias en memoria perdidas.
    expect(findReusableOrderKey(attempt, scoped)).toBe('key-1');
    expect(readPendingOrderAttempt(scoped)?.key).toBe('key-1');
  });

  it('no reutiliza la clave si cambió el contenido, el usuario o el restaurante', () => {
    writePendingOrderAttempt(attempt, scoped);
    expect(findReusableOrderKey({ ...attempt, sigHash: '99.zzz' }, scoped)).toBeNull();
    expect(findReusableOrderKey({ ...attempt, userId: 'u2' }, scoped)).toBeNull();
    expect(findReusableOrderKey({ ...attempt, restaurantId: 'r2' }, scoped)).toBeNull();
  });

  it('tras el éxito la entrada se limpia y el siguiente intento usa clave nueva', () => {
    writePendingOrderAttempt(attempt, scoped);
    clearPendingOrderAttempt(scoped);
    expect(findReusableOrderKey(attempt, scoped)).toBeNull();
    expect(readPendingOrderAttempt(scoped)).toBeNull();
  });

  it('es idempotente al reescribir el mismo intento', () => {
    writePendingOrderAttempt(attempt, scoped);
    writePendingOrderAttempt(attempt, scoped);
    expect(Object.keys(scoped.storage.data)).toHaveLength(1);
    expect(findReusableOrderKey(attempt, scoped)).toBe('key-1');
  });

  it('degrada sin lanzar cuando no hay storage (SSR / modo privado)', () => {
    expect(readPendingOrderAttempt({ storage: null })).toBeNull();
    expect(() => writePendingOrderAttempt(attempt, { storage: null })).not.toThrow();
    expect(() => clearPendingOrderAttempt({ storage: null })).not.toThrow();
    expect(findReusableOrderKey(attempt, { storage: null })).toBeNull();
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
    expect(readPendingOrderAttempt({ storage: throwing })).toBeNull();
    expect(() => writePendingOrderAttempt(attempt, { storage: throwing })).not.toThrow();
    expect(() => clearPendingOrderAttempt({ storage: throwing })).not.toThrow();

    const storage = createStorage();
    const scope = 'checkout.r1';
    const key = `${PENDING_ORDER_STORAGE_KEY}.${scope}`;
    storage.setItem(key, '{no-json');
    expect(readPendingOrderAttempt({ storage, scope })).toBeNull();
    storage.setItem(key, JSON.stringify({ key: '', sigHash: '' }));
    expect(readPendingOrderAttempt({ storage, scope })).toBeNull();
  });

  it('aisla los intentos por scope: abandonar un flujo no borra el de otro', () => {
    const storage = createStorage();
    const checkout = { storage, scope: 'checkout.r1' };
    const reorderOne = { storage, scope: 'reorder.order-1' };
    const reorderTwo = { storage, scope: 'reorder.order-2' };

    writePendingOrderAttempt({ ...attempt, key: 'key-checkout' }, checkout);
    writePendingOrderAttempt({ ...attempt, key: 'key-reorder-1' }, reorderOne);

    expect(findReusableOrderKey(attempt, checkout)).toBe('key-checkout');
    expect(findReusableOrderKey(attempt, reorderOne)).toBe('key-reorder-1');
    // Un reordenamiento de OTRO pedido no puede robar la clave pendiente.
    expect(findReusableOrderKey(attempt, reorderTwo)).toBeNull();

    // Finalizar uno no afecta al otro.
    clearPendingOrderAttempt(reorderOne);
    expect(findReusableOrderKey(attempt, checkout)).toBe('key-checkout');
    expect(findReusableOrderKey(attempt, reorderOne)).toBeNull();
  });
});