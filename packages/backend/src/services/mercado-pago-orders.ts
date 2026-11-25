import { z } from 'zod';
import { createHmac, timingSafeEqual } from 'node:crypto';

const origin = 'https://api.mercadopago.com';
const orderId = z.string().regex(/^ORD[A-Z0-9]+$/);

export function verifyMercadoPagoOrderSignature(id: string, requestId: string, signature: string, secret: string): boolean {
  if (!orderId.safeParse(id).success || !/^[\w-]{1,128}$/.test(requestId) || !secret || signature.length > 256) return false;
  const parts = signature.split(',').map(part => part.trim());
  const timestamps = parts.filter(part => part.startsWith('ts='));
  const digests = parts.filter(part => part.startsWith('v1='));
  if (timestamps.length !== 1 || digests.length !== 1 || !/^ts=\d+$/.test(timestamps[0]) || !/^v1=[a-f\d]{64}$/i.test(digests[0])) return false;
  const manifest = `id:${id.toLowerCase()};request-id:${requestId};ts:${timestamps[0].slice(3)};`;
  return timingSafeEqual(createHmac('sha256', secret).update(manifest).digest(), Buffer.from(digests[0].slice(3), 'hex'));
}
const orderSchema = z.object({
  id: orderId,
  type: z.literal('online'),
  external_reference: z.string(),
  country_code: z.string().optional(),
  total_amount: z.string(),
  total_paid_amount: z.string().optional(),
  status: z.string(),
  status_detail: z.string(),
  transactions: z.object({ payments: z.array(z.object({
    id: z.string(), amount: z.string(), status: z.string(), status_detail: z.string(),
    payment_method: z.object({
      transaction_security: z.object({ url: z.string().optional(), status: z.string().optional() }).optional(),
    }).optional(),
  })) }).optional(),
});

export const MERCADO_PAGO_HOSTS = /^(?:[a-z\d-]+\.)*mercadopago\.com(?:\.mx)?$/i;

/** Only URLs on the provider's own domain may be handed to the browser. */
export function safeProviderUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port && MERCADO_PAGO_HOSTS.test(parsed.hostname) ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function mercadoPagoChallengeUrl(order: MercadoPagoOrder): string | undefined {
  if (order.status !== 'action_required' || order.status_detail !== 'pending_challenge') return undefined;
  return safeProviderUrl(order.transactions?.payments[0]?.payment_method?.transaction_security?.url);
}

export type MercadoPagoOrder = z.infer<typeof orderSchema>;

/**
 * Closed vocabulary shown to the customer. The provider's `status_detail`
 * is never stored or returned; only one of these codes is persisted.
 */
export const CARD_DECLINE_REASONS = [
  'INSUFFICIENT_FUNDS',
  'INVALID_CVV',
  'EXPIRED_CARD',
  'UNSUPPORTED_CARD',
  'AUTHORIZATION_REQUIRED',
  'TOO_MANY_ATTEMPTS',
  'SECURITY_REJECTED',
  'GENERIC',
] as const;
export type CardDeclineReason = typeof CARD_DECLINE_REASONS[number];

/** Map a rejected provider order to a safe code. Unknown details become GENERIC. */
export function mapMercadoPagoDeclineReason(order: MercadoPagoOrder): CardDeclineReason {
  const raw = [order.status_detail, order.transactions?.payments[0]?.status_detail]
    .filter(detail => typeof detail === 'string')
    .join(' ')
    .toLowerCase();
  const rules: Array<[CardDeclineReason, RegExp]> = [
    ['INSUFFICIENT_FUNDS', /insufficient|fondos|saldo|balance/],
    ['INVALID_CVV', /security_code|security code|cvv|código de seguridad/],
    ['EXPIRED_CARD', /expired|vencid|bad_filled_date|fecha/],
    ['UNSUPPORTED_CARD', /card_disabled|unsupported|not_supported|invalid_installments|tarjeta no|no admitida/],
    ['AUTHORIZATION_REQUIRED', /call_for_authorize|authorization|autoriz/],
    ['TOO_MANY_ATTEMPTS', /max_attempts|demasiados intentos/],
    ['SECURITY_REJECTED', /high_risk|fraud|blacklist|security|rechazad.*seguridad/],
  ];
  for (const [code, pattern] of rules) {
    if (pattern.test(raw)) return code;
  }
  return 'GENERIC';
}

const chargeSchema = z.object({
  intentId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  amountCents: z.number().int().min(1).max(100_000_000),
  payerEmail: z.string().email().optional(),
  payerCustomerId: z.string().regex(/^[a-zA-Z0-9_+-]{1,128}$/).optional(),
  platformId: z.string().trim().min(1).max(128).optional(),
  requireThreeDs: z.literal(true).optional(),
  payerFirstName: z.string().trim().min(1).max(100).optional(),
  payerLastName: z.string().trim().min(1).max(100).optional(),
  identificationType: z.string().min(1).max(20).optional(),
  identificationNumber: z.string().min(3).max(32).optional(),
  cardToken: z.string().min(1).max(512),
  deviceId: z.string().regex(/^[\x21-\x7E]{1,512}$/).optional(),
  methodId: z.string().regex(/^[a-z0-9_]{1,40}$/),
  cardType: z.enum(['credit_card', 'debit_card']),
  issuerId: z.string().max(32).optional(),
  installments: z.literal(1),
  items: z.array(z.object({ title: z.string().trim().min(1), external_code: z.string().min(1), quantity: z.number().int().positive(), unit_price: z.string().regex(/^\d+\.\d{2}$/) })).optional(),
}).strict().refine(
  (charge) => Boolean(charge.identificationType) === Boolean(charge.identificationNumber),
  'El tipo y número de identificación deben enviarse juntos.',
).refine(
  charge => charge.payerCustomerId
    ? !charge.payerEmail && !charge.payerFirstName && !charge.payerLastName && !charge.identificationType
    : Boolean(charge.payerEmail),
  'Envía el ID del cliente de Mercado Pago o los datos del comprador, no ambos.',
);

function amount(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

async function requestOrder(accessToken: string, path: string, init?: RequestInit): Promise<MercadoPagoOrder> {
  if (!accessToken.trim()) throw new Error('Falta configurar el Access Token de Mercado Pago.');
  const response = await fetch(`${origin}${path}`, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Mercado Pago Orders respondió HTTP ${response.status}.`);
  // Strip provider fields that can contain card tokens or payer details.
  return orderSchema.parse(await response.json());
}

// Only send exact item breakdowns; never invent prices to absorb fees or discounts.
export function mercadoPagoItemsFromSnapshot(snapshot: unknown, totalCents: number) {
  const parsed = z.object({ items: z.array(z.object({ title: z.string().trim().min(1), productId: z.string().min(1), quantity: z.number().int().positive(), unitPrice: z.number().positive(), subtotal: z.number().positive() })).min(1) }).safeParse(snapshot);
  if (!parsed.success) return undefined;
  let sum = 0;
  const items = [];
  for (const line of parsed.data.items) {
    const cents = Math.round(line.unitPrice * 100);
    if (cents < 1 || Math.abs(line.unitPrice * 100 - cents) > 1e-6 || cents * line.quantity !== Math.round(line.subtotal * 100)) return undefined;
    sum += cents * line.quantity;
    items.push({ title: line.title, external_code: line.productId, quantity: line.quantity, unit_price: amount(cents) });
  }
  return sum === totalCents ? items : undefined;
}

/** Call after persisting the attempt and idempotency key. Resolve saved-card ownership before passing payerCustomerId. */
export function createMercadoPagoCardOrder(accessToken: string, input: z.input<typeof chargeSchema>) {
  const charge = chargeSchema.parse(input);
  const total = amount(charge.amountCents);
  return requestOrder(accessToken, '/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': charge.idempotencyKey,
      ...(charge.deviceId ? { 'X-meli-session-id': charge.deviceId } : {}) },
    body: JSON.stringify({
      type: 'online', processing_mode: 'automatic', capture_mode: 'automatic',
      external_reference: charge.intentId, total_amount: total,
      ...(charge.platformId ? { integration_data: { platform_id: charge.platformId } } : {}),
      ...(charge.requireThreeDs ? { config: { online: { transaction_security: { validation: 'on_fraud_risk', liability_shift: 'required' } } } } : {}),
      ...(charge.items?.length ? { items: charge.items } : {}),
      payer: charge.payerCustomerId ? { customer_id: charge.payerCustomerId } : {
        email: charge.payerEmail,
        ...(charge.payerFirstName ? { first_name: charge.payerFirstName } : {}),
        ...(charge.payerLastName ? { last_name: charge.payerLastName } : {}),
        ...(charge.identificationType && charge.identificationNumber
          ? { identification: { type: charge.identificationType, number: charge.identificationNumber } }
          : {}),
      },
      transactions: { payments: [{ amount: total, payment_method: {
        id: charge.methodId, type: charge.cardType, token: charge.cardToken,
        installments: charge.installments,
        statement_descriptor: 'WINGSLAB',
      } }] },
    }),
  });
}

export function fetchMercadoPagoOrder(accessToken: string, providerOrderId: string) {
  return requestOrder(accessToken, `/v1/orders/${orderId.parse(providerOrderId)}`);
}

/** Search by the persisted intent reference to recover a lost create-order response. */
export async function searchMercadoPagoOrdersByReference(accessToken: string, reference: string, now = new Date()) {
  const query = new URLSearchParams({
    begin_date: new Date(now.getTime() - 30 * 24 * 60 * 60_000).toISOString(),
    end_date: now.toISOString(),
    external_reference: z.string().uuid().parse(reference),
    type: 'online',
    page: '1',
    page_size: '100',
  });
  const response = await fetch(`${origin}/v1/orders?${query}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Mercado Pago Orders respondió HTTP ${response.status}.`);
  const result = z.object({ data: z.array(orderSchema).max(100) }).parse(await response.json());
  return result.data.filter(order => order.external_reference === reference);
}

/** Submit a full refund only for a verified, fully accredited single-payment order. */
export async function refundAccreditedMercadoPagoOrder(
  accessToken: string,
  order: MercadoPagoOrder,
  idempotencyKey: string,
) {
  const key = z.string().uuid().parse(idempotencyKey);
  const payment = order.transactions?.payments;
  if (order.country_code !== 'MEX' || order.status !== 'processed' || order.status_detail !== 'accredited' ||
      order.total_paid_amount !== order.total_amount || payment?.length !== 1 ||
      payment[0].status !== 'processed' || payment[0].status_detail !== 'accredited' ||
      payment[0].amount !== order.total_amount) {
    throw new Error('La orden no es elegible para un reembolso total.');
  }
  const response = await fetch(`${origin}/v1/orders/${orderId.parse(order.id)}/refund`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'X-Idempotency-Key': key,
    },
    // A total refund must omit the request body entirely. Sandbox rejected {}.
    redirect: 'error',
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Mercado Pago Refund respondió HTTP ${response.status}.`);
  const result = z.object({ id: orderId, status: z.string(), status_detail: z.string() }).parse(await response.json());
  if (result.id !== order.id || result.status_detail !== 'refunded') {
    throw new Error('Mercado Pago aún no confirmó el reembolso total.');
  }
  return result;
}

/** Use only on an order fetched with the configured seller account token. */
export function matchesAccreditedMercadoPagoOrder(order: MercadoPagoOrder, expected: {
  providerOrderId: string; intentId: string; amountCents: number;
}): boolean {
  if (!Number.isSafeInteger(expected.amountCents) || expected.amountCents < 1) return false;
  const total = amount(expected.amountCents);
  const payments = order.transactions?.payments;
  return order.id === expected.providerOrderId && order.external_reference === expected.intentId &&
    order.country_code === 'MEX' && order.status === 'processed' && order.status_detail === 'accredited' &&
    order.total_amount === total && order.total_paid_amount === total && payments?.length === 1 &&
    payments[0].amount === total && payments[0].status === 'processed' && payments[0].status_detail === 'accredited';
}
