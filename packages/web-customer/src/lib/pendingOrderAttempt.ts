// Persistencia del intento de compra pendiente (lado cliente).
//
// Solo guarda la IDENTIDAD del intento (firma con hash, usuario, restaurante y
// clave), nunca el contenido del carrito, la dirección, las notas ni datos de
// pago: así una recarga o un remontaje de la vista pueden recuperar la misma
// clave de idempotencia en vez de generar una nueva (lo que produciría un
// pedido duplicado).
//
// Cada intento vive en su propia ranura ("scope"): el checkout de un
// restaurante y cada "Volver a pedir" de un pedido anterior son independientes,
// de modo que abandonar un flujo con una operación en curso no pisa el intento
// pendiente de otro.
//
// Todo acceso a storage va envuelto en try/catch: si no hay sessionStorage
// (modo privado estricto, SSR) se degrada silenciosamente al comportamiento en
// memoria, que ya cubre los reintentos dentro de la misma vista.

export const PENDING_ORDER_STORAGE_KEY = 'sadel.customer.pending-order';

export type PendingOrderAttempt = {
  userId: string;
  restaurantId: string;
  sigHash: string;
  key: string;
};

/**
 * Identifica la ranura del intento. Formato recomendado: `<flujo>.<id>`, p. ej.
 * `checkout.rest-1` o `reorder.order-9`. Sin scope se usa la clave raíz (una
 * única ranura compartida).
 */
export type PendingOrderScope = string;

export type PendingOrderStorageOptions = {
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  scope?: PendingOrderScope;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function getSessionStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined') return null;
    const storage = window.sessionStorage;
    return storage ? storage : null;
  } catch {
    // Acceso al storage bloqueado por el navegador.
    return null;
  }
}

function resolveStorage(options?: PendingOrderStorageOptions): StorageLike | null {
  if (options && 'storage' in options) return options.storage ?? null;
  return getSessionStorage();
}

function storageKeyForScope(scope?: PendingOrderScope): string {
  return scope ? `${PENDING_ORDER_STORAGE_KEY}.${scope}` : PENDING_ORDER_STORAGE_KEY;
}

function isPendingAttempt(value: unknown): value is PendingOrderAttempt {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PendingOrderAttempt>;
  return (
    typeof candidate.key === 'string' &&
    candidate.key.length > 0 &&
    typeof candidate.sigHash === 'string' &&
    candidate.sigHash.length > 0
  );
}

export function readPendingOrderAttempt(options?: PendingOrderStorageOptions): PendingOrderAttempt | null {
  try {
    const storage = resolveStorage(options);
    if (!storage) return null;
    const raw = storage.getItem(storageKeyForScope(options?.scope));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isPendingAttempt(parsed)) return null;
    return {
      userId: typeof parsed.userId === 'string' ? parsed.userId : '',
      restaurantId: typeof parsed.restaurantId === 'string' ? parsed.restaurantId : '',
      sigHash: parsed.sigHash,
      key: parsed.key,
    };
  } catch {
    return null;
  }
}

export function writePendingOrderAttempt(
  attempt: PendingOrderAttempt,
  options?: PendingOrderStorageOptions
): void {
  try {
    const storage = resolveStorage(options);
    if (!storage) return;
    storage.setItem(storageKeyForScope(options?.scope), JSON.stringify(attempt));
  } catch {
    // Cuota agotada o storage bloqueado: la idempotencia en memoria sigue vigente.
  }
}

export function clearPendingOrderAttempt(options?: PendingOrderStorageOptions): void {
  try {
    const storage = resolveStorage(options);
    if (!storage) return;
    storage.removeItem(storageKeyForScope(options?.scope));
  } catch {
    // noop: si no se puede limpiar, la entrada expira con la pestaña.
  }
}

/**
 * Devuelve la clave a reutilizar para un intento en curso, o null si no hay
 * intento pendiente que coincida en contenido (hash de firma), usuario y
 * restaurante dentro de la misma ranura. La coincidencia de usuario y
 * restaurante evita que una clave de otro contexto se reutilice por accidente.
 */
export function findReusableOrderKey(
  attempt: { userId: string; restaurantId: string; sigHash: string },
  options?: PendingOrderStorageOptions
): string | null {
  const pending = readPendingOrderAttempt(options);
  if (!pending) return null;
  if (pending.sigHash !== attempt.sigHash) return null;
  if (pending.userId !== attempt.userId) return null;
  if (pending.restaurantId !== attempt.restaurantId) return null;
  return pending.key;
}