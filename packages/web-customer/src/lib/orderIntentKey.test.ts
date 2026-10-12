import {
  completeOrderIntent,
  newOrderIntentKey,
  orderIntentScope,
  resolveOrderIntentKey,
  type OrderIntentScope,
  type OrderRequestBody,
} from './orderIntentKey';
import { PENDING_ORDER_STORAGE_KEY } from './pendingOrderAttempt';

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

let storage: Storage & { data: Record<string, string> };

beforeEach(() => {
  // Cada test parte de una sesión limpia (como una pestaña nueva).
  storage = createStorage();
});

const reorderBody = (overrides: Record<string, unknown> = {}): OrderRequestBody => ({
  restaurantId: 'rest-1',
  items: [{ productId: 'p1', quantity: 2 }],
  fulfillmentType: 'DELIVERY',
  deliveryAddress: { street: 'Av 1', number: '10', city: 'CDMX' },
  paymentMethod: 'CASH',
  ...overrides,
});

const reorderScope = { kind: 'reorder' as const, id: 'order-42' };

/**
 * Reproduce el ciclo de vida real del componente (ver app/page.tsx):
 *   1. resolver -> enviar
 *   2. ÉXITO  -> completeOrderIntent + refs limpios  (confirmación del servidor)
 *      FALLO  -> NO se limpia nada (el resultado sigue ambiguo)
 *   3. Tras un fallo, una recarga pierde los refs: la siguiente vista resuelve
 *      de nuevo y debe recuperar la MISMA clave desde sessionStorage.
 */
function attemptAsComponentWould(body: OrderRequestBody, scope: OrderIntentScope, userId = 'u1') {
  // "Recarga": la vista nueva no tiene refs en memoria.
  return resolveOrderIntentKey({ body, userId, scope, current: null, storage });
}

describe('orderIntentKey — identidad del intento de compra', () => {
  it('mintea una clave nueva y la persiste al iniciar un intento', () => {
    const resolved = resolveOrderIntentKey({
      body: reorderBody(),
      userId: 'u1',
      scope: reorderScope,
      storage,
    });
    expect(resolved.source).toBe('nueva');
    expect(resolved.key.length).toBeGreaterThanOrEqual(8);
    expect(storage.data[`${PENDING_ORDER_STORAGE_KEY}.${orderIntentScope(reorderScope)}`]).toContain(resolved.key);
  });

  it('doble pulsación en la misma vista reutiliza la clave (mismo contenido)', () => {
    const first = resolveOrderIntentKey({ body: reorderBody(), userId: 'u1', scope: reorderScope, storage });
    // El componente guarda el estado en refs; el segundo clic lo pasa como `current`.
    const second = resolveOrderIntentKey({
      body: reorderBody(),
      userId: 'u1',
      scope: reorderScope,
      current: { key: first.key, signatureHash: first.signatureHash },
      storage,
    });
    expect(second.key).toBe(first.key);
    expect(second.source).toBe('memoria');
  });

  it('volver a pulsar tras un timeout NO genera una clave nueva', () => {
    const first = resolveOrderIntentKey({ body: reorderBody(), userId: 'u1', scope: reorderScope, storage });
    // Timeout/red caída: el componente NO limpia refs ni sesión.
    const retry = resolveOrderIntentKey({
      body: reorderBody(),
      userId: 'u1',
      scope: reorderScope,
      current: { key: first.key, signatureHash: first.signatureHash },
      storage,
    });
    expect(retry.key).toBe(first.key);
  });

  it('tras perder la respuesta y recargar, recupera la MISMA clave', () => {
    const first = attemptAsComponentWould(reorderBody(), reorderScope);
    expect(first.source).toBe('nueva');

    // Recarga de la página: refs perdidos, sessionStorage intacto.
    const afterReload = attemptAsComponentWould(reorderBody(), reorderScope);
    expect(afterReload.key).toBe(first.key);
    expect(afterReload.source).toBe('sesion');

    // Y un segundo reintento post-recarga sigue siendo el mismo intento.
    const secondRetry = resolveOrderIntentKey({
      body: reorderBody(),
      userId: 'u1',
      scope: reorderScope,
      current: { key: afterReload.key, signatureHash: afterReload.signatureHash },
      storage,
    });
    expect(secondRetry.key).toBe(first.key);
  });

  it('el contenido persistido no contiene PII ni datos de pago', () => {
    const body = reorderBody({
      notes: 'llamar al llegar por favor',
      paymentProofUrl: 'data:image/png;base64,SECRETO',
    });
    resolveOrderIntentKey({ body, userId: 'u1', scope: reorderScope, storage });
    const raw = storage.data[`${PENDING_ORDER_STORAGE_KEY}.${orderIntentScope(reorderScope)}`];
    expect(raw).not.toContain('productId');
    expect(raw).not.toContain('Av 1');
    expect(raw).not.toContain('llamar al llegar');
    expect(raw).not.toContain('SECRETO');
    expect(JSON.parse(raw)).toEqual({
      userId: 'u1',
      restaurantId: 'rest-1',
      sigHash: expect.any(String),
      key: expect.any(String),
    });
  });

  it('tras la confirmación del servidor, la compra idéntica siguiente usa clave nueva', () => {
    const first = attemptAsComponentWould(reorderBody(), reorderScope);
    // Confirmación recibida: el componente limpia refs y finaliza el intento.
    completeOrderIntent(reorderScope, storage);

    const nextPurchase = attemptAsComponentWould(reorderBody(), reorderScope);
    expect(nextPurchase.source).toBe('nueva');
    expect(nextPurchase.key).not.toBe(first.key);
  });

  it('no reutiliza claves entre usuarios', () => {
    const mine = attemptAsComponentWould(reorderBody(), reorderScope, 'u1');
    const other = attemptAsComponentWould(reorderBody(), reorderScope, 'u2');
    expect(other.key).not.toBe(mine.key);
    expect(other.source).toBe('nueva');
  });

  it('no reutiliza claves entre pedidos de origen distintos con contenido idéntico', () => {
    const first = attemptAsComponentWould(reorderBody(), { kind: 'reorder', id: 'order-1' });
    const second = attemptAsComponentWould(reorderBody(), { kind: 'reorder', id: 'order-2' });
    expect(second.key).not.toBe(first.key);
    // Y el primero sigue pendiente: abandonarlo no lo destruye.
    expect(attemptAsComponentWould(reorderBody(), { kind: 'reorder', id: 'order-1' }).key).toBe(first.key);
  });

  it('no reutiliza claves entre el checkout y el reordenamiento', () => {
    const checkout = attemptAsComponentWould(reorderBody(), { kind: 'checkout', id: 'rest-1' });
    const reorder = attemptAsComponentWould(reorderBody(), reorderScope);
    expect(reorder.key).not.toBe(checkout.key);
    expect(attemptAsComponentWould(reorderBody(), { kind: 'checkout', id: 'rest-1' }).key).toBe(checkout.key);
  });

  it('no reutiliza claves entre restaurantes distintos', () => {
    const a = attemptAsComponentWould(reorderBody(), { kind: 'checkout', id: 'rest-1' });
    const b = attemptAsComponentWould(
      reorderBody({ restaurantId: 'rest-2' }),
      { kind: 'checkout', id: 'rest-2' }
    );
    expect(b.key).not.toBe(a.key);
  });

  it('un cambio real de contenido abre un intento nuevo', () => {
    const base = attemptAsComponentWould(reorderBody(), reorderScope);
    const variants = [
      reorderBody({ items: [{ productId: 'p1', quantity: 3 }] }),
      reorderBody({ items: [{ productId: 'p2', quantity: 2 }] }),
      reorderBody({ paymentMethod: 'TRANSFER' }),
      reorderBody({ fulfillmentType: 'PICKUP', deliveryAddress: undefined }),
      reorderBody({ notes: 'sin cebolla' }),
      reorderBody({ deliveryAddress: { street: 'Av 2', number: '10', city: 'CDMX' } }),
    ];
    for (const variant of variants) {
      const changed = resolveOrderIntentKey({
        body: variant,
        userId: 'u1',
        scope: reorderScope,
        current: { key: base.key, signatureHash: base.signatureHash },
        storage,
      });
      expect(changed.key).not.toBe(base.key);
      expect(changed.source).toBe('nueva');
    }
  });

  it('sin sessionStorage degrada a idempotencia en memoria sin lanzar', () => {
    const first = resolveOrderIntentKey({
      body: reorderBody(),
      userId: 'u1',
      scope: reorderScope,
      storage: null,
    });
    const retry = resolveOrderIntentKey({
      body: reorderBody(),
      userId: 'u1',
      scope: reorderScope,
      current: { key: first.key, signatureHash: first.signatureHash },
      storage: null,
    });
    expect(retry.key).toBe(first.key);
    // Sin storage no hay recuperación tras recarga: clave nueva, comportamiento
    // equivalente al de antes de esta mejora.
    const afterReload = resolveOrderIntentKey({
      body: reorderBody(),
      userId: 'u1',
      scope: reorderScope,
      current: null,
      storage: null,
    });
    expect(afterReload.key).not.toBe(first.key);
  });

  it('las claves generadas cumplen el contrato del backend (8-64 chars)', () => {
    for (let i = 0; i < 50; i += 1) {
      const key = newOrderIntentKey();
      expect(key.length).toBeGreaterThanOrEqual(8);
      expect(key.length).toBeLessThanOrEqual(64);
    }
  });
});