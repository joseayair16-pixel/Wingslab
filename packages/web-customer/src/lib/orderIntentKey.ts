// Resolución de la clave de idempotencia de un intento de compra.
//
// Es la ÚNICA implementación del "qué clave envío": la usan tanto el checkout
// del restaurante como "Volver a pedir". Antes esa lógica vivía duplicada en
// cada componente, y solo el checkout sobrevivía a una recarga.
//
// Política (idéntica a la que valida el backend):
//  - Si ya hay un intento en curso para el MISMO contenido → se reutiliza su
//    clave. Da igual cuántas veces el usuario pulse el botón, cuántas veces
//    requestJson reintente por timeout o error de red, y aunque la página se
//    recargue: la clave se recupera de sessionStorage.
//  - Si el contenido cambió, cambió el usuario o es otro contexto (otra
//    ranura) → es un intento nuevo y legítima, y se mintea una clave nueva.
//  - La clave se rota únicamente cuando hay CONFIRMACIÓN de que el pedido
//    existe (respuesta exitosa). Un error no es confirmación: el resultado
//    sigue siendo ambiguo y la identidad se conserva.
//
// Nunca se guarda contenido del pedido: en storage solo va el hash de la firma.

import {
  buildOrderIntentSignature,
  hashOrderSignature,
  orderIntentFromRequestBody,
} from './orderIntent';
import {
  clearPendingOrderAttempt,
  findReusableOrderKey,
  writePendingOrderAttempt,
  type PendingOrderStorageOptions,
} from './pendingOrderAttempt';

type StorageOverride = PendingOrderStorageOptions['storage'];

/**
 * Contexto de la ranura del intento:
 *  - `checkout.<restaurantId>`: carrito normal, una ranura por restaurante.
 *  - `reorder.<orderId>`: "Volver a pedir", una ranura por pedido de origen.
 */
export type OrderIntentScope = {
  kind: 'checkout' | 'reorder';
  id: string;
};

/** Estado en memoria del intento en curso (lo que la vista guarda en refs). */
export type OrderIntentKeyState = {
  key: string;
  signatureHash: string;
};

export type OrderIntentKeySource = 'memoria' | 'sesion' | 'nueva';

export type ResolvedOrderIntentKey = OrderIntentKeyState & {
  source: OrderIntentKeySource;
};

export function orderIntentScope(scope: OrderIntentScope): string {
  return `${scope.kind}.${scope.id}`;
}

/** Clave aleatoria para un intento nuevo (idempotencia del lado cliente). */
export function newOrderIntentKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `ord-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Cuerpo que se envía a POST /pedidos (ver createOrderSchema del backend). */
export type OrderRequestBody = Parameters<typeof orderIntentFromRequestBody>[0];

export function orderIntentSignatureHash(body: OrderRequestBody): string {
  return hashOrderSignature(buildOrderIntentSignature(orderIntentFromRequestBody(body)));
}

export type ResolveOrderIntentKeyParams = {
  /** Body que se enviará a POST /pedidos (sin clientOrderKey). */
  body: OrderRequestBody;
  userId: string;
  scope: OrderIntentScope;
  /** Intento en curso en esta vista, si lo hay. */
  current?: OrderIntentKeyState | null;
  storage?: StorageOverride;
};

export function resolveOrderIntentKey({
  body,
  userId,
  scope,
  current,
  storage,
}: ResolveOrderIntentKeyParams): ResolvedOrderIntentKey {
  const signatureHash = orderIntentSignatureHash(body);

  // 1) Intento en curso en esta misma vista: reintento del mismo intento.
  if (current?.key && current.signatureHash === signatureHash) {
    return { key: current.key, signatureHash, source: 'memoria' };
  }

  const storageOptions = { storage, scope: orderIntentScope(scope) };

  // 2) Intento pendiente de una vista anterior (recarga/remontaje): mismo
  //    contenido, mismo usuario, mismo restaurante y misma ranura.
  const restaurantId =
    typeof (body as { restaurantId?: unknown })?.restaurantId === 'string'
      ? (body as { restaurantId: string }).restaurantId
      : '';
  const reusable = findReusableOrderKey({ userId, restaurantId, sigHash: signatureHash }, storageOptions);
  if (reusable) {
    return { key: reusable, signatureHash, source: 'sesion' };
  }

  // 3) Contenido, usuario o contexto distintos: intento nuevo y legítimo.
  const key = newOrderIntentKey();
  writePendingOrderAttempt({ userId, restaurantId, sigHash: signatureHash, key }, storageOptions);
  return { key, signatureHash, source: 'nueva' };
}

/**
 * Finaliza el intento: se llama SOLO cuando el servidor confirmó el pedido.
 * A partir de aquí la próxima compra idéntica es legítima y usa clave nueva.
 */
export function completeOrderIntent(scope: OrderIntentScope, storage?: StorageOverride): void {
  clearPendingOrderAttempt({ storage, scope: orderIntentScope(scope) });
}