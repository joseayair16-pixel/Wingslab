import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../errors/app-error';
import {
  fetchMercadoPagoOrder,
  mapMercadoPagoDeclineReason,
  matchesAccreditedMercadoPagoOrder,
  searchMercadoPagoOrdersByReference,
  type CardDeclineReason,
  type MercadoPagoOrder,
} from './mercado-pago-orders';

const stockSchema = z.array(z.object({ productId: z.string().min(1), quantity: z.number().int().min(1).max(1000) })).max(100);

/** Commit the submission claim before calling the provider. Use the intent UUID as its idempotency key. */
export async function claimCheckoutPaymentSubmission(db: PrismaClient, id: string, customerId: string, now = new Date()) {
  const result = await db.checkoutPaymentIntent.updateMany({
    where: { id, customerId, state: 'RESERVED', expiresAt: { gt: now } },
    data: { state: 'SUBMITTING' },
  });
  return result.count === 1;
}

/** Distributed throttle/claim for provider reconciliation; at most one lookup every 10 seconds per attempt. */
export async function claimCheckoutPaymentReconciliation(db: PrismaClient, id: string, now = new Date()) {
  const result = await db.checkoutPaymentIntent.updateMany({
    where: {
      id,
      state: 'SUBMITTING',
      OR: [{ lastReconciledAt: null }, { lastReconciledAt: { lte: new Date(now.getTime() - 10_000) } }],
    },
    data: { lastReconciledAt: now },
  });
  return result.count === 1;
}

/** Persist the provider order before returning; a retry must not create a second charge. */
export async function attachCheckoutProviderOrder(db: PrismaClient, id: string, providerOrderId: string) {
  const result = await db.checkoutPaymentIntent.updateMany({
    where: { id, state: 'SUBMITTING', OR: [{ providerOrderId: null }, { providerOrderId }] },
    data: { providerOrderId },
  });
  return result.count === 1;
}

/** Release reserved stock only after the provider confirms a terminal failure. */
export async function markCheckoutPaymentDeclined(
  db: PrismaClient,
  id: string,
  providerOrderId: string,
  declineReason: CardDeclineReason = 'GENERIC',
) {
  return db.$transaction(async tx => {
    const result = await tx.checkoutPaymentIntent.updateMany({
      where: { id, state: 'SUBMITTING', OR: [{ providerOrderId: null }, { providerOrderId }] },
      data: { state: 'DECLINED', providerOrderId, declineReason },
    });
    if (result.count !== 1) return false;
    const intent = await tx.checkoutPaymentIntent.findUniqueOrThrow({ where: { id }, select: { restaurantId: true, stock: true } });
    for (const { productId, quantity } of stockSchema.parse(intent.stock)) {
      await tx.product.updateMany({
        where: { id: productId, restaurantId: intent.restaurantId },
        data: { stock: { increment: quantity } },
      });
    }
    return true;
  });
}

/** Only consume a response retrieved server-to-server using the configured seller credentials. */
export async function recordVerifiedCheckoutPayment(db: PrismaClient, intentId: string, order: MercadoPagoOrder) {
  const intent = await db.checkoutPaymentIntent.findUnique({ where: { id: intentId } });
  if (!intent || !matchesAccreditedMercadoPagoOrder(order, {
    providerOrderId: intent.providerOrderId ?? order.id, intentId, amountCents: intent.amountCents,
  })) return false;
  if (intent.state === 'VERIFIED' || intent.state === 'ORDER_CREATED') return intent.providerOrderId === order.id;
  const result = await db.checkoutPaymentIntent.updateMany({
    where: { id: intentId, state: 'SUBMITTING', OR: [{ providerOrderId: null }, { providerOrderId: order.id }] },
    data: { providerOrderId: order.id, state: 'VERIFIED' },
  });
  if (result.count === 1) return true;
  const current = await db.checkoutPaymentIntent.findUnique({ where: { id: intentId } });
  return !!current && (current.state === 'VERIFIED' || current.state === 'ORDER_CREATED') && current.providerOrderId === order.id;
}

/** Internal only. The caller must price and validate the snapshot server-side. */
type CheckoutQuote = {
  customerId: string; restaurantId: string; requestKey: string; fingerprint: string;
  amountCents: number; snapshot: Prisma.InputJsonObject; stock: z.input<typeof stockSchema>;
};

export function reserveCheckoutPayment(db: PrismaClient, quote: CheckoutQuote) {
  return db.$transaction(tx => reserveCheckoutPaymentInTransaction(tx, quote));
}

export async function reserveCheckoutPaymentInTransaction(tx: Prisma.TransactionClient, quote: CheckoutQuote) {
  if (!Number.isSafeInteger(quote.amountCents) || quote.amountCents < 1 || quote.amountCents > 100_000_000) {
    throw new AppError(400, 'INVALID_CHECKOUT_AMOUNT', 'El importe del pedido no es válido.');
  }
  const quantities = new Map<string, number>();
  for (const item of stockSchema.parse(quote.stock)) {
    quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
  }
  const stock = stockSchema.parse([...quantities.keys()].sort().map(productId => ({ productId, quantity: quantities.get(productId) })));
  {
    const inserted = await tx.checkoutPaymentIntent.createMany({
      data: { ...quote, stock, id: randomUUID(), expiresAt: new Date(Date.now() + 10 * 60_000) },
      skipDuplicates: true,
    });
    const intent = await tx.checkoutPaymentIntent.findUniqueOrThrow({
      where: { customerId_requestKey: { customerId: quote.customerId, requestKey: quote.requestKey } },
    });
    if (!inserted.count) {
      if (intent.fingerprint !== quote.fingerprint || intent.restaurantId !== quote.restaurantId || intent.amountCents !== quote.amountCents) {
        throw new AppError(409, 'CHECKOUT_KEY_CONFLICT', 'El intento corresponde a otro carrito.');
      }
      return intent;
    }
    for (const { productId, quantity } of stock) {
      const updated = await tx.product.updateMany({
        where: { id: productId, restaurantId: quote.restaurantId, deleted: false, isAvailable: true, trackStock: true, stock: { gte: quantity } },
        data: { stock: { decrement: quantity } },
      });
      if (updated.count !== 1) throw new AppError(409, 'CHECKOUT_STOCK_UNAVAILABLE', 'Un producto ya no tiene existencias suficientes.');
    }
    return intent;
  }
}

/** Release only unsubmitted reservations. A charge in flight needs reconciliation. */
export async function expireCheckoutPayment(db: PrismaClient, id: string, now = new Date()) {
  return db.$transaction(tx => expireReservedCheckoutPaymentInTransaction(tx, id, now, true));
}

/**
 * Atomically invalidate a reservation that has not entered SUBMITTING and
 * return its inventory. `onlyIfExpired=false` is used when the same customer
 * explicitly starts a different cart; the conditional state transition wins
 * or loses against a concurrent charge claim, so stock is never released for
 * an in-flight payment.
 */
export async function expireReservedCheckoutPaymentInTransaction(
  tx: Prisma.TransactionClient,
  id: string,
  now = new Date(),
  onlyIfExpired = false,
) {
  const claimed = await tx.checkoutPaymentIntent.updateMany({
    where: { id, state: 'RESERVED', ...(onlyIfExpired ? { expiresAt: { lte: now } } : {}) },
    data: { state: 'EXPIRED' },
  });
  if (!claimed.count) return false;
  const intent = await tx.checkoutPaymentIntent.findUniqueOrThrow({ where: { id }, select: { restaurantId: true, stock: true } });
  for (const { productId, quantity } of stockSchema.parse(intent.stock)) {
    await tx.product.updateMany({ where: { id: productId, restaurantId: intent.restaurantId }, data: { stock: { increment: quantity } } });
  }
  return true;
}

/** Bounded sweep; each claim is transactional, including with multiple workers. */
export async function sweepExpiredCheckoutPayments(db: PrismaClient, onError: (error: unknown, id: string) => void, now = new Date()) {
  const due = await db.checkoutPaymentIntent.findMany({
    where: { state: 'RESERVED', expiresAt: { lte: now } },
    orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
    take: 100,
    select: { id: true },
  });
  for (const { id } of due) {
    try { await expireCheckoutPayment(db, id, now); }
    catch (error) { onError(error, id); }
  }
}

/**
 * Background reconciliation for abandoned SUBMITTING intents: a request that
 * left the browser before the provider answered must not keep stock hostage
 * forever. Inventory is released ONLY on a provider-confirmed terminal failure;
 * pending and ambiguous outcomes keep the reservation and are retried later.
 */
export async function reconcileSubmittedCheckoutPayments(
  db: PrismaClient,
  accessToken: string,
  callbacks: {
    onVerified: (intentId: string, order: MercadoPagoOrder) => Promise<boolean>;
    onError: (error: unknown, intentId: string) => void;
  },
  now = new Date(),
  limit = 100,
) {
  if (!accessToken) return 0;
  const due = await db.checkoutPaymentIntent.findMany({
    where: { state: 'SUBMITTING' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: Math.min(Math.max(limit, 1), 100),
    select: { id: true, providerOrderId: true },
  });

  let resolved = 0;
  for (const candidate of due) {
    if (!await claimCheckoutPaymentReconciliation(db, candidate.id, now)) continue;
    try {
      let order: MercadoPagoOrder;
      if (candidate.providerOrderId) {
        order = await fetchMercadoPagoOrder(accessToken, candidate.providerOrderId);
      } else {
        // Recover a lost create-order response only when the reference is unique.
        const candidates = await searchMercadoPagoOrdersByReference(accessToken, candidate.id, now);
        if (candidates.length !== 1) continue;
        order = candidates[0];
        if (!await attachCheckoutProviderOrder(db, candidate.id, order.id)) continue;
      }
      if (order.external_reference !== candidate.id) continue;
      if (await callbacks.onVerified(candidate.id, order)) { resolved += 1; continue; }
      if (order.status === 'failed' || order.status === 'canceled') {
        if (await markCheckoutPaymentDeclined(db, candidate.id, order.id, mapMercadoPagoDeclineReason(order))) {
          resolved += 1;
        }
      }
    } catch (error) {
      callbacks.onError(error, candidate.id);
    }
  }
  return resolved;
}
