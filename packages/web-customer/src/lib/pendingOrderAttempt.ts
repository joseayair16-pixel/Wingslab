// Persistencia del intento de compra pendiente (lado cliente).
//
// Solo guarda la IDENTIDAD del intento (firma con hash, usuario, restaurante y
// clave), nunca el contenido del carrito ni datos de pago: así una recarga o un
// remontaje de la vista pueden recuperar la misma clave de idempotencia en vez
// de generar una nueva (lo que produciría un pedido duplicado).
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

export function readPendingOrderAttempt(
  storage: StorageLike | null = getSessionStorage()
): PendingOrderAttempt | null {
  try {
    if (!storage) return null;
    const raw = storage.getItem(PENDING_ORDER_STORAGE_KEY);
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
  storage: StorageLike | null = getSessionStorage()
): void {
  try {
    if (!storage) return;
    storage.setItem(PENDING_ORDER_STORAGE_KEY, JSON.stringify(attempt));
  } catch {
    // Cuota agotada o storage bloqueado: la idempotencia en memoria sigue vigente.
  }
}

export function clearPendingOrderAttempt(storage: StorageLike | null = getSessionStorage()): void {
  try {
    if (!storage) return;
    storage.removeItem(PENDING_ORDER_STORAGE_KEY);
  } catch {
    // noop: si no se puede limpiar, la entrada expira con la pestaña.
  }
}

/**
 * Devuelve la clave a reutilizar para un intento en curso, o null si no hay
 * intento pendiente que coincida en contenido (hash de firma), usuario y
 * restaurante. La coincidencia de usuario y restaurante evita que una clave de
 * otro contexto se reutilice por accidente.
 */
export function findReusableOrderKey(
  attempt: { userId: string; restaurantId: string; sigHash: string },
  storage: StorageLike | null = getSessionStorage()
): string | null {
  const pending = readPendingOrderAttempt(storage);
  if (!pending) return null;
  if (pending.sigHash !== attempt.sigHash) return null;
  if (pending.userId !== attempt.userId) return null;
  if (pending.restaurantId !== attempt.restaurantId) return null;
  return pending.key;
}