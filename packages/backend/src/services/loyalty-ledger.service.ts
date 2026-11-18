import { randomUUID } from 'node:crypto';
import { RESTAURANT_ID } from '../config/single-restaurant';

export type LoyaltySnapshot = {
  programVersion: number;
  goal: number;
  rewardKind: 'AMOUNT' | 'PERCENT' | 'PRODUCT';
  rewardValue: number | null;
  rewardProductId: string | null;
  rewardProductName: string | null;
  rewardDescription: string;
  terms: string;
};

// This adapter deliberately requires the caller's transaction. A reward must
// never be reserved independently from the order, inventory and final total.
type LedgerTransaction = {
  $queryRawUnsafe: (query: string, value: string) => Promise<unknown>;
  order: { findFirst: (args: unknown) => Promise<any> };
  loyaltyCard: {
    findFirst: (args: unknown) => Promise<any>;
    create: (args: unknown) => Promise<any>;
    update: (args: unknown) => Promise<any>;
  };
  loyaltyStamp: { findUnique: (args: unknown) => Promise<any>; create: (args: unknown) => Promise<any>; count: (args: unknown) => Promise<number> };
  loyaltyRedemption: { findUnique: (args: unknown) => Promise<any>; findFirst: (args: unknown) => Promise<any>; create: (args: unknown) => Promise<any>; update: (args: unknown) => Promise<any>; delete: (args: unknown) => Promise<any> };
  auditLog: { create: (args: unknown) => Promise<any> };
};

export async function lockLoyaltyCustomer(tx: LedgerTransaction, customerId: string) {
  // Same key as checkout: no second independent lock order/deadlock risk.
  await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))::text', `order-create:${customerId}`);
}

/** The caller must calculate discountCents from the server snapshot and insert
 * the owned order in this same transaction before reserving. */
export async function reserveLoyaltyReward(tx: LedgerTransaction, customerId: string, orderId: string, cardId: string, discountCents: number) {
  if (!Number.isSafeInteger(discountCents) || discountCents < 0) throw new Error('Invalid loyalty discount');
  await lockLoyaltyCustomer(tx, customerId);
  const order = await tx.order.findFirst({ where: { id: orderId, customerId, restaurantId: RESTAURANT_ID }, select: { status: true } });
  if (!order || order.status !== 'PENDING') throw new Error('Loyalty reward requires a newly created owned order');
  const existing = await tx.loyaltyRedemption.findUnique({ where: { orderId } });
  if (existing) {
    if (existing.cardId !== cardId || existing.discountCents !== discountCents) throw new Error('Loyalty reservation does not match order');
    return existing;
  }
  const busy = await tx.loyaltyRedemption.findFirst({ where: { state: 'RESERVED', card: { restaurantId: RESTAURANT_ID, customerId } } });
  if (busy) throw new Error('A loyalty reward is already reserved');
  const card = await tx.loyaltyCard.findFirst({ where: { id: cardId, restaurantId: RESTAURANT_ID, customerId, redemption: null } });
  if (!card) throw new Error('Loyalty reward is not available');
  const stamps = await tx.loyaltyStamp.count({ where: { cardId: card.id } });
  if (stamps < card.goal - 1 || stamps > card.goal) throw new Error('Not enough completed purchases');
  return tx.loyaltyRedemption.create({ data: { id: randomUUID(), cardId: card.id, orderId, discountCents } });
}

function validateSnapshot(snapshot: LoyaltySnapshot) {
  if (!Number.isSafeInteger(snapshot.goal) || snapshot.goal < 2 || snapshot.goal > 30 || !Number.isSafeInteger(snapshot.programVersion) || snapshot.programVersion < 1 || !snapshot.rewardDescription.trim()) throw new Error('Invalid loyalty snapshot');
  if (snapshot.rewardKind === 'PRODUCT') {
    if (!snapshot.rewardProductId || snapshot.rewardValue !== null) throw new Error('Invalid loyalty product');
  } else if (!['AMOUNT', 'PERCENT'].includes(snapshot.rewardKind) || !Number.isSafeInteger(snapshot.rewardValue) || snapshot.rewardValue! <= 0 || (snapshot.rewardKind === 'PERCENT' && snapshot.rewardValue! > 100) || snapshot.rewardProductId !== null) throw new Error('Invalid loyalty amount');
}

/** Call with a completed, server-verified order, never a client-provided status.
 * Unique orderId and the customer advisory lock make reconciliation idempotent.
 * Existing cards keep their snapshots; only newly opened cards use new rules. */
export async function recordLoyaltyStamp(tx: LedgerTransaction, customerId: string, orderId: string, snapshot: LoyaltySnapshot, earnedAt: Date) {
  validateSnapshot(snapshot);
  await lockLoyaltyCustomer(tx, customerId);
  const order = await tx.order.findFirst({ where: { id: orderId, customerId, restaurantId: RESTAURANT_ID }, select: { status: true, fulfillmentType: true } });
  if (!order || !(['DELIVERED', 'COMPLETED'].includes(order.status) || (order.status === 'PICKED_UP' && order.fulfillmentType === 'PICKUP'))) throw new Error('Only completed owned orders can earn stamps');
  const existing = await tx.loyaltyStamp.findUnique({ where: { orderId } });
  if (existing) return { stamp: existing, duplicate: true };
  let card = await tx.loyaltyCard.findFirst({ where: { restaurantId: RESTAURANT_ID, customerId, state: 'OPEN' }, orderBy: { sequence: 'asc' } });
  if (!card) {
    const previous = await tx.loyaltyCard.findFirst({ where: { restaurantId: RESTAURANT_ID, customerId }, orderBy: { sequence: 'desc' }, select: { sequence: true } });
    card = await tx.loyaltyCard.create({ data: { id: randomUUID(), customerId, restaurantId: RESTAURANT_ID, sequence: (previous?.sequence ?? 0) + 1, ...snapshot } });
  }
  const count = await tx.loyaltyStamp.count({ where: { cardId: card.id } });
  if (count >= card.goal) throw new Error('Inconsistent open loyalty card');
  const stamp = await tx.loyaltyStamp.create({ data: { id: randomUUID(), cardId: card.id, orderId, earnedAt } });
  if (count + 1 === card.goal) await tx.loyaltyCard.update({ where: { id: card.id }, data: { state: 'COMPLETED', completedAt: earnedAt } });
  return { stamp, duplicate: false };
}

/** Completion/release must be called inside the same transaction as the final
 * order transition. No transaction is opened or committed by this helper. */
export async function settleLoyaltyReservation(tx: LedgerTransaction, customerId: string, orderId: string, outcome: 'completed' | 'cancelled', now: Date) {
  await lockLoyaltyCustomer(tx, customerId);
  const order = await tx.order.findFirst({ where: { id: orderId, customerId, restaurantId: RESTAURANT_ID }, select: { status: true, fulfillmentType: true } });
  if (!order) throw new Error('Loyalty order ownership mismatch');
  const completed = ['DELIVERED', 'COMPLETED'].includes(order.status) || (order.status === 'PICKED_UP' && order.fulfillmentType === 'PICKUP');
  if ((outcome === 'completed' && !completed) || (outcome === 'cancelled' && !['CANCELLED', 'REJECTED'].includes(order.status))) throw new Error('Loyalty settlement does not match order state');
  const reservation = await tx.loyaltyRedemption.findUnique({ where: { orderId } });
  if (!reservation || reservation.state === 'COMPLETED') return;
  if (outcome === 'completed') {
    await tx.loyaltyRedemption.update({ where: { id: reservation.id }, data: { state: 'COMPLETED', completedAt: now } });
  } else {
    await tx.auditLog.create({ data: { action: 'LOYALTY_RESERVATION_RELEASED', entity: 'Order', entityId: orderId, oldValue: JSON.stringify({ cardId: reservation.cardId, discountCents: reservation.discountCents }), newValue: JSON.stringify({ state: 'RELEASED' }) } });
    await tx.loyaltyRedemption.delete({ where: { id: reservation.id } });
  }
}
