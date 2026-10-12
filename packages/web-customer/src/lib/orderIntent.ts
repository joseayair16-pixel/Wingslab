// Identidad de intentos de compra (idempotencia) — funciones puras, sin React.
//
// Una "firma" describe el CONTENIDO COMERCIAL de un intento de compra. Se usa
// para reutilizar la misma clave de idempotencia entre reintentos del mismo
// intento (doble toque, timeout, respuesta perdida, recarga) y para generar
// una clave nueva cuando el usuario inicia un intento genuinamente distinto.
//
// La firma nunca identifica compras de forma permanente: tras un éxito el
// llamador rota la clave, así que dos compras intencionales sucesivas del mismo
// contenido generan dos pedidos distintos.

export type OrderIntentItem = {
  productId: string;
  quantity: number;
  specialInstructions?: string | null;
  optionIds?: readonly string[] | null;
  weightG?: number | null;
};

export type OrderIntent = {
  restaurantId: string;
  items: OrderIntentItem[];
  fulfillmentType?: string | null;
  /** Dirección de entrega (objeto) o null para recogida. */
  address: unknown;
  paymentMethod: string;
  notes?: string | null;
  promoCode?: string | null;
};

/**
 * Campos de dirección que forman parte de la identidad del pedido.
 * Se excluyen coordenadas y otros datos geográficos: son volátiles (p. ej. un
 * ajuste manual del pin o una reread del GPS) y no deben invalidar la clave.
 */
const ADDRESS_IDENTITY_FIELDS = [
  'street',
  'number',
  'apartment',
  'neighborhood',
  'city',
  'state',
  'zipCode',
  'country',
  'reference',
] as const;

/** Hash corto no criptográfico: permite comparar firmas sin persistir el contenido. */
export function hashOrderSignature(signature: string): string {
  let hash = 5381;
  for (let i = 0; i < signature.length; i += 1) {
    hash = ((hash << 5) + hash + signature.charCodeAt(i)) | 0;
  }
  return `${signature.length}.${(hash >>> 0).toString(36)}`;
}

/**
 * Normaliza una dirección a campos planos y ordenados, de modo que dos objetos
 * con los mismos datos pero distinto orden de claves (o campos extra como
 * coordenadas) produzcan exactamente la misma firma.
 */
function normalizeAddress(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const normalized: Record<string, string> = {};
  for (const field of ADDRESS_IDENTITY_FIELDS) {
    const raw = source[field];
    if (raw === null || raw === undefined) continue;
    const text = String(raw).trim();
    if (text) normalized[field] = text;
  }
  return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizeItem(item: OrderIntentItem): string {
  return [
    item.productId || '',
    String(item.quantity ?? 0),
    (item.specialInstructions || '').trim(),
    (item.optionIds || []).slice().sort().join('.'),
    item.weightG === null || item.weightG === undefined ? '' : String(item.weightG),
  ].join('|');
}

/**
 * Firma estable del intento de compra: dos llamadas con el mismo contenido
 * producen la misma firma (aunque cambie el orden de los items o de las claves
 * de la dirección); cualquier cambio real produce otra firma y, por tanto, una
 * clave de idempotencia nueva.
 */
export function buildOrderIntentSignature(intent: OrderIntent): string {
  const items = (intent.items || [])
    .map(normalizeItem)
    .sort()
    .join(';;');
  return [
    intent.restaurantId || '',
    items,
    intent.fulfillmentType || 'DELIVERY',
    JSON.stringify(normalizeAddress(intent.address)),
    intent.paymentMethod || '',
    (intent.notes || '').trim(),
    (intent.promoCode || '').trim(),
  ].join('||');
}

/**
 * Extrae la identidad del intento desde el body que se envía al backend, para
 * que la firma nunca pueda divergir de la solicitud real. Solo toma campos
 * estables: excluye ubicación actual, comprobante de pago y otros datos
 * volátiles que no cambian lo que el restaurante cobra o prepara.
 */
export function orderIntentFromRequestBody(body: {
  restaurantId?: string;
  items?: OrderIntentItem[];
  fulfillmentType?: string | null;
  paymentMethod?: string;
  notes?: string;
  promoCode?: string;
  deliveryAddress?: unknown;
} | null | undefined): OrderIntent {
  return {
    restaurantId: body?.restaurantId || '',
    items: (body?.items || []).map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      specialInstructions: item.specialInstructions,
      optionIds: item.optionIds,
      weightG: item.weightG,
    })),
    fulfillmentType: body?.fulfillmentType || 'DELIVERY',
    address: body?.deliveryAddress ?? null,
    paymentMethod: body?.paymentMethod || '',
    notes: body?.notes || '',
    promoCode: body?.promoCode || '',
  };
}