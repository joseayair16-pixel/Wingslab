import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { AppError } from '../errors/app-error';
import { RESTAURANT_ID } from '../config/single-restaurant';
import { loyaltyDiscount } from './loyalty-policy';

export const LOYALTY_KEY = 'wingslab.restaurant.loyalty.v1';
type Tx = Prisma.TransactionClient;
export type Program = { enabled: boolean; programVersion: number; stampGoal: number; rewardKind: 'AMOUNT' | 'PERCENT' | 'PRODUCT'; rewardValue: number | null; rewardProductId: string | null; rewardDescription: string; stampTerms: string; stampStartsAt: string | null; redemptionReady: boolean; activePeriods?: Array<{ from: string; to: string | null }> };
type Card = { id: string; goal: number; rewardKind: Program['rewardKind']; rewardValue: number | null; rewardProductId: string | null; rewardDescription: string; terms: string; state: string; sequence: number; stamps: number; reservedOrderId: string | null; redemptionState: string | null; completedAt?: Date | null };
const round = (v: number) => Math.round(v * 100);
export async function readProgram(tx: Tx): Promise<Program | null> {
  const setting = await tx.systemSetting.findUnique({ where: { key: LOYALTY_KEY } });
  if (!setting) return null;
  const parsed = JSON.parse(setting.value);
  return parsed.redemptionReady === true ? parsed : null;
}
async function lock(tx: Tx, customerId: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`order-create:${customerId}`}))::text`;
}
async function cards(tx: Tx, customerId: string): Promise<Card[]> {
  return tx.$queryRaw<Card[]>`SELECT c.*, (SELECT count(*)::int FROM "LoyaltyStamp" s WHERE s."cardId"=c.id) AS stamps,
    r."orderId" AS "reservedOrderId", r.state AS "redemptionState"
    FROM "LoyaltyCard" c LEFT JOIN "LoyaltyRedemption" r ON r."cardId"=c.id
    WHERE c."restaurantId"=${RESTAURANT_ID} AND c."customerId"=${customerId} ORDER BY c.sequence`;
}

/** Reconciles authoritative order states under the same customer lock as order
 * creation. Every completion/cancellation path is covered, including legacy
 * routes and jobs, without trusting socket events or the browser. */
export async function reconcileLoyalty(tx: Tx, customerId: string, program: Program) {
  await lock(tx, customerId);
  const released = await tx.$queryRaw<Array<{ id: string; orderId: string; cardId: string }>>`
    SELECT r.id,r."orderId",r."cardId" FROM "LoyaltyRedemption" r JOIN "LoyaltyCard" c ON c.id=r."cardId"
    JOIN "Order" o ON o.id=r."orderId" WHERE c."restaurantId"=${RESTAURANT_ID} AND c."customerId"=${customerId}
    AND r.state='RESERVED' AND (o.status::text IN ('CANCELLED','REJECTED') OR o."noShowReleasedAt" IS NOT NULL)`;
  for (const r of released) {
    await tx.auditLog.create({ data: { action: 'LOYALTY_RESERVATION_RELEASED', entity: 'Order', entityId: r.orderId, oldValue: JSON.stringify({ cardId: r.cardId }), newValue: '{"state":"RELEASED"}' } });
    await tx.$executeRaw`DELETE FROM "LoyaltyRedemption" WHERE id=${r.id} AND state='RESERVED'`;
  }
  if (!program.stampStartsAt) return cards(tx, customerId);
  const periods = program.activePeriods || [{ from: program.stampStartsAt, to: null }];
  if (!periods.length) return cards(tx, customerId);
  const periodFilter = Prisma.join(periods.map(period => Prisma.sql`(o."createdAt">=${new Date(period.from)} AND (${period.to === null} OR o."createdAt"<${new Date(period.to || '9999-01-01T00:00:00Z')}))`), ' OR ');
  const pending = await tx.$queryRaw<Array<{ id: string; earnedAt: Date }>>`
    SELECT o.id, COALESCE(o."deliveredAt",o."completedAt",o."pickedUpAt",o."updatedAt") AS "earnedAt"
    FROM "Order" o WHERE o."restaurantId"=${RESTAURANT_ID} AND o."customerId"=${customerId}
    AND o."paymentStatus"::text='COMPLETED' AND o."noShowReleasedAt" IS NULL
    AND o."createdAt">=${new Date(program.stampStartsAt)} AND (${periodFilter}) AND
    (o.status::text IN ('DELIVERED','COMPLETED') OR (o.status::text='PICKED_UP' AND o."fulfillmentType"::text='PICKUP'))
    AND NOT EXISTS(SELECT 1 FROM "LoyaltyStamp" s WHERE s."orderId"=o.id)
    ORDER BY o."createdAt",o.id`;
  let existing = await cards(tx, customerId);
  for (const order of pending) {
    let card = existing.find(c => c.state === 'OPEN');
    if (!card) {
      const id = randomUUID(), sequence = (existing[existing.length - 1]?.sequence ?? 0) + 1;
      await tx.$executeRaw`INSERT INTO "LoyaltyCard" (id,"customerId","restaurantId",sequence,"programVersion",goal,"rewardKind","rewardValue","rewardProductId","rewardDescription",terms)
        VALUES (${id},${customerId},${RESTAURANT_ID},${sequence},${program.programVersion},${program.stampGoal},${program.rewardKind},${program.rewardValue},${program.rewardProductId},${program.rewardDescription},${program.stampTerms})`;
      card = { id, sequence, goal: program.stampGoal, rewardKind: program.rewardKind, rewardValue: program.rewardValue, rewardProductId: program.rewardProductId, rewardDescription: program.rewardDescription, terms: program.stampTerms, state: 'OPEN', stamps: 0, reservedOrderId: null, redemptionState: null };
      existing.push(card);
    }
    await tx.$executeRaw`INSERT INTO "LoyaltyStamp" (id,"cardId","orderId","earnedAt") VALUES (${randomUUID()},${card.id},${order.id},${order.earnedAt})`;
    card.stamps++;
    if (card.stamps === card.goal) {
      await tx.$executeRaw`UPDATE "LoyaltyCard" SET state='COMPLETED',"completedAt"=${order.earnedAt} WHERE id=${card.id}`;
      card.state = 'COMPLETED';
    }
  }
  await tx.$executeRaw`UPDATE "LoyaltyRedemption" r SET state='COMPLETED',"completedAt"=COALESCE(o."deliveredAt",o."completedAt",o."pickedUpAt",o."updatedAt")
    FROM "Order" o,"LoyaltyCard" c WHERE r."orderId"=o.id AND r."cardId"=c.id AND c."restaurantId"=${RESTAURANT_ID} AND c."customerId"=${customerId}
    AND r.state='RESERVED' AND o."paymentStatus"::text='COMPLETED' AND o."noShowReleasedAt" IS NULL AND (o.status::text IN ('DELIVERED','COMPLETED') OR (o.status::text='PICKED_UP' AND o."fulfillmentType"::text='PICKUP'))`;
  return cards(tx, customerId);
}

export async function loyaltyState(tx: Tx, customerId: string) {
  const program = await readProgram(tx);
  if (!program) return null;
  const list = await reconcileLoyalty(tx, customerId, program);
  const reserved = list.some(c => c.redemptionState === 'RESERVED');
  const available = list.filter(c => c.state === 'COMPLETED' && !c.redemptionState);
  const open = list.find(c => c.state === 'OPEN');
  const next = available[0] || open;
  return { program, list, reserved, available, open, next, eligible: program.enabled && !reserved && !!next && (next.state === 'COMPLETED' || next.stamps === next.goal - 1) };
}

export async function loyaltyQuote(tx: Tx, customerId: string, subtotalCents: number, productIds: string[] = [], otherPromotion = false) {
  const state = await loyaltyState(tx, customerId);
  if (!state?.eligible || !state.next) return { eligible: false as const, reason: state && !state.program.enabled ? 'El programa está en pausa. Tus sellos y premios se conservan.' : state?.reserved ? 'Ya tienes una recompensa reservada en un pedido en curso.' : 'Sigue acumulando compras para tu próxima recompensa.' };
  if (otherPromotion) return { eligible: false as const, reason: 'La fidelidad no se combina con otras promociones.' };
  const promoted = productIds.length ? await tx.product.count({ where: { id: { in: productIds }, restaurantId: RESTAURANT_ID, OR: [{ discountPrice: { not: null } }, { promoType: { not: null } }] } }) : 0;
  if (promoted) return { eligible: false as const, reason: 'Tu carrito contiene productos con promoción. La recompensa se conserva para otra compra.' };
  const card = state.next;
  let gift: { id: string; name: string; trackStock: boolean; stock: number } | null = null;
  let discountCents = 0;
  if (card.rewardKind === 'PRODUCT') {
    const product = await tx.product.findFirst({ where: { id: card.rewardProductId!, restaurantId: RESTAURANT_ID, isAvailable: true, deleted: false, sellBy: 'UNIT', isAdultOnly: false }, select: { id: true, name: true, trackStock: true, stock: true, optionGroups: { select: { minSelection: true } } } });
    if (!product || (product.trackStock && product.stock < 1) || product.optionGroups.some(g => g.minSelection > 0)) return { eligible: false as const, reason: 'El producto de regalo no está disponible ahora. Tu recompensa se conserva.' };
    gift = { id: product.id, name: product.name, trackStock: product.trackStock, stock: product.stock };
  } else {
    discountCents = loyaltyDiscount({ subtotalCents, kind: card.rewardKind === 'AMOUNT' ? 'amount' : 'percent', value: card.rewardValue!, otherPromotionApplied: false });
  }
  return { eligible: true as const, cardId: card.id, discountCents, gift, rewardDescription: card.rewardDescription, terms: card.terms };
}

export async function reserveRuntimeReward(tx: Tx, customerId: string, orderId: string, quote: { cardId: string; discountCents: number }) {
  // Called only under the existing order-create lock, after final validation.
  const occupied = await tx.$queryRaw<Array<{ id: string }>>`SELECT r.id FROM "LoyaltyRedemption" r JOIN "LoyaltyCard" c ON c.id=r."cardId" WHERE c."customerId"=${customerId} AND c."restaurantId"=${RESTAURANT_ID} AND r.state='RESERVED'`;
  if (occupied.length) throw new AppError(409, 'LOYALTY_RESERVED', 'Tu recompensa ya está reservada en otro pedido.');
  await tx.$executeRaw`INSERT INTO "LoyaltyRedemption" (id,"cardId","orderId","discountCents") VALUES (${randomUUID()},${quote.cardId},${orderId},${quote.discountCents})`;
}

export const moneyCents = round;
