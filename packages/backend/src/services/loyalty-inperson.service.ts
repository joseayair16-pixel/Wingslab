import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AppError } from '../errors/app-error';
import { RESTAURANT_ID } from '../config/single-restaurant';
import { calculateInPersonSaleItems, type InPersonSaleItemInput } from './loyalty-inperson-policy';
import { findLoyaltyGift, loyaltyQuote, loyaltyState, readProgram, type Program } from './loyalty-runtime.service';
import type { Prisma, PrismaClient } from '@prisma/client';

type Tx = Prisma.TransactionClient;
type PaymentMethod = 'CASH' | 'CARD' | 'TRANSFER' | 'OTHER';
type SaleInput = {
  code: string;
  items: InPersonSaleItemInput[];
  applyReward: boolean;
  paymentMethod: PaymentMethod;
  note?: string;
  staffUserId: string;
};
type ScanInput = { code: string; staffUserId: string };
type StampInput = ScanInput & { previewKey: string; deliverReward: boolean };
const SCAN_TTL_SECONDS = 90;
const VOID_WINDOW_MS = 5 * 60 * 1000;
const hash = (code: string) => createHash('sha256').update(code).digest('hex');
const lock = async (tx: Tx, customerId: string) => {
  // The same lock is used by online checkout, so stamps and rewards cannot race
  // between a web order, an in-person sale, and a correction.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`order-create:${customerId}`}))::text`;
};

async function openCard(tx: Tx, customerId: string, program: Program) {
  const existing = await tx.$queryRaw<Array<{ id: string; goal: number; stamps: number }>>`
    SELECT c.id,c.goal,(SELECT count(*)::int FROM "LoyaltyStamp" s WHERE s."cardId"=c.id) AS stamps
    FROM "LoyaltyCard" c WHERE c."restaurantId"=${RESTAURANT_ID} AND c."customerId"=${customerId} AND c.state='OPEN'
    ORDER BY c.sequence LIMIT 1`;
  if (existing[0]) return existing[0];
  const prior = await tx.$queryRaw<Array<{ sequence: number }>>`
    SELECT MAX(sequence)::int AS sequence FROM "LoyaltyCard" WHERE "restaurantId"=${RESTAURANT_ID} AND "customerId"=${customerId}`;
  const id = randomUUID();
  await tx.$executeRaw`INSERT INTO "LoyaltyCard" (id,"customerId","restaurantId",sequence,"programVersion",goal,"rewardKind","rewardValue","rewardProductId","rewardDescription",terms)
    VALUES (${id},${customerId},${RESTAURANT_ID},${(prior[0]?.sequence ?? 0) + 1},${program.programVersion},${program.stampGoal},${program.rewardKind},${program.rewardValue},${program.rewardProductId},${program.rewardDescription},${program.stampTerms})`;
  return { id, goal: program.stampGoal, stamps: 0 };
}

async function sessionForCode(tx: Tx, code: string, activeOnly: boolean) {
  const rows = await tx.$queryRaw<Array<{ id: string; customerId: string }>>`
    SELECT id,"customerId" FROM "LoyaltyScanSession"
    WHERE code=${hash(code)} AND "restaurantId"=${RESTAURANT_ID}
    AND (NOT ${activeOnly} OR ("consumedAt" IS NULL AND "expiresAt">timezone('UTC',clock_timestamp())))`;
  return rows[0] || null;
}

async function replayOrReject(tx: Tx, input: ScanInput, requestHash: string): Promise<unknown> {
  const session = await sessionForCode(tx, input.code, false);
  const prior = session ? await tx.loyaltyVisit.findUnique({ where: { scanSessionId: session.id } }) : null;
  if (prior?.voidedAt) throw new AppError(409, 'VISIT_ALREADY_VOIDED', 'Esta venta ya fue anulada. Solicita un nuevo código para otra compra.');
  if (prior?.resultJson && prior.requestHash === requestHash && prior.createdBy === input.staffUserId) {
    return JSON.parse(prior.resultJson);
  }
  throw new AppError(409, 'LOYALTY_CODE_INVALID', 'El código ya fue usado o expiró. Solicita uno nuevo.');
}

async function claimScanCode(tx: Tx, code: string) {
  const candidate = await sessionForCode(tx, code, true);
  if (!candidate) return null;
  // Same customer -> QR lock order as issuance, including during concurrent retries.
  await lock(tx, candidate.customerId);
  const consumed = await tx.$queryRaw<Array<{ id: string; customerId: string }>>`
    UPDATE "LoyaltyScanSession" SET "consumedAt"=timezone('UTC',clock_timestamp())
    WHERE id=${candidate.id} AND code=${hash(code)} AND "customerId"=${candidate.customerId}
      AND "restaurantId"=${RESTAURANT_ID} AND "consumedAt" IS NULL AND "expiresAt">timezone('UTC',clock_timestamp())
    RETURNING id,"customerId"`;
  return consumed[0] || null;
}

async function appendStamp(tx: Tx, card: { id: string; goal: number; stamps: number }, visitId: string) {
  await tx.loyaltyStamp.create({ data: { id: randomUUID(), cardId: card.id, source: 'IN_PERSON', visitId } });
  const stamps = card.stamps + 1;
  const completed = stamps >= card.goal;
  if (completed) await tx.loyaltyCard.update({ where: { id: card.id }, data: { state: 'COMPLETED', completedAt: new Date() } });
  return { stamps, goal: card.goal, completed };
}

async function saleCatalog(tx: Tx, items: InPersonSaleItemInput[]) {
  const ids = [...new Set(items.map(item => item.productId))];
  if (!ids.length) throw new AppError(400, 'INVALID_SALE_ITEMS', 'Agrega productos a la venta.');
  return tx.product.findMany({
    where: { id: { in: ids }, restaurantId: RESTAURANT_ID },
    select: {
      id: true, name: true, price: true, discountPrice: true, promoType: true,
      promoBuyQuantity: true, promoPayQuantity: true, sellBy: true, unitPrice: true,
      minWeightG: true, maxWeightG: true, stepWeightG: true, trackStock: true,
      stock: true, isAvailable: true, deleted: true, isAdultOnly: true,
      optionGroups: { select: { id: true, name: true, minSelection: true, maxSelection: true,
        options: { select: { id: true, name: true, price: true, isAvailable: true } } } },
    },
  });
}

async function quoteSale(tx: Tx, customerId: string, input: InPersonSaleItemInput[], applyReward: boolean) {
  const catalog = await saleCatalog(tx, input);
  const calculated = calculateInPersonSaleItems(input, catalog);
  const byId = new Map(catalog.map(product => [product.id, product]));
  for (const [productId, quantity] of calculated.stockRequired) {
    const product = byId.get(productId);
    if (!product || product.stock < quantity) throw new AppError(409, 'INSUFFICIENT_STOCK', `No hay existencias suficientes de ${product?.name || 'un producto'}.`);
  }
  const productIds = [...new Set(calculated.items.map(item => item.productId))];
  const reward = await loyaltyQuote(tx, customerId, calculated.subtotalCents, productIds, calculated.hasPromotion);
  let rewardEligible = reward.eligible;
  let rewardUnavailableReason = !reward.eligible ? reward.reason : null;
  if (reward.eligible && reward.gift?.trackStock) {
    const saleQuantity = calculated.stockRequired.get(reward.gift.id) ?? 0;
    if (reward.gift.stock < saleQuantity + 1) {
      rewardEligible = false;
      rewardUnavailableReason = 'No hay existencias suficientes para vender el producto y entregar además la recompensa.';
    }
  }
  const apply = applyReward && rewardEligible;
  let rewardAppliedCents = 0;
  let rewardDescription: string | null = null;
  let rewardProductId: string | null = null;
  if (apply && reward.eligible) {
    rewardAppliedCents = reward.discountCents;
    rewardDescription = reward.gift ? `${reward.gift.name} de regalo` : reward.rewardDescription;
    rewardProductId = reward.gift?.id ?? null;
  }
  return {
    ...calculated,
    rewardEligible,
    rewardUnavailableReason,
    rewardApplied: apply,
    rewardAppliedCents,
    rewardDescription,
    rewardProductId,
    totalCents: calculated.subtotalCents - rewardAppliedCents,
  };
}

/** Creates a new code and invalidates any prior code for that customer. */
export async function createScanSession(db: PrismaClient, customerId: string) {
  return db.$transaction(async (tx: Tx) => {
    await lock(tx, customerId);
    const code = randomBytes(18).toString('base64url');
    const sessionId = randomUUID();
    const clock = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    const now = clock[0]?.now;
    if (!now) throw new Error('Database clock unavailable.');
    const expiresAt = new Date(now.getTime() + SCAN_TTL_SECONDS * 1000);
    // Keep request idempotency for a week, then let the visit retain its
    // snapshot while releasing obsolete QR-session rows.
    await tx.loyaltyScanSession.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 7 * 86400000) } } });
    await tx.loyaltyScanSession.updateMany({
      where: { customerId, restaurantId: RESTAURANT_ID, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    await tx.loyaltyScanSession.create({ data: { id: sessionId, customerId, restaurantId: RESTAURANT_ID, code: hash(code), expiresAt } });
    return { sessionId, code, expiresAt: expiresAt.toISOString(), ttlSeconds: SCAN_TTL_SECONDS };
  }, { timeout: 15000 });
}

export async function getScanStatus(db: PrismaClient, customerId: string, sessionId: string) {
  const readSession = (tx: Tx) => tx.loyaltyScanSession.findFirst({
    where: { id: sessionId, customerId, restaurantId: RESTAURANT_ID },
    select: { expiresAt: true, consumedAt: true, visit: { select: { id: true, voidedAt: true,
      stamps: { where: { source: 'IN_PERSON' }, take: 1, select: { card: { select: {
        goal: true, rewardDescription: true, terms: true,
        redemption: { select: { state: true, visitId: true } },
      } } } }, resultJson: true,
    } } },
  });
  let session = await readSession(db);
  const expiredAtRead = session !== null && !session.consumedAt && session.expiresAt.getTime() <= Date.now();
  if (expiredAtRead) {
    // At expiry a confirmation may already hold the row lock but not have
    // committed its stamp. Wait and reread before reporting a terminal state.
    session = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "LoyaltyScanSession" WHERE id=${sessionId}
        AND "customerId"=${customerId} AND "restaurantId"=${RESTAURANT_ID} FOR SHARE`;
      return readSession(tx);
    });
  }
  if (!session) throw new AppError(404, 'LOYALTY_QR_NOT_FOUND', 'No se encontró el código.');
  const visit = session.visit;
  if (visit?.voidedAt) return { state: 'voided' as const };
  const stamp = visit?.stamps[0];
  if (visit?.resultJson && stamp) {
    const { stamps, completed } = JSON.parse(visit.resultJson) as { stamps: number; completed: boolean };
    const { goal, rewardDescription, terms, redemption } = stamp.card;
    return { state: 'applied' as const, receipt: {
      stamps, goal, completed, terms, rewardDescription,
      rewardDelivered: completed && redemption?.visitId === visit.id && redemption?.state === 'COMPLETED',
    } };
  }
  if (session.consumedAt) return { state: 'invalidated' as const };
  // Don't check the clock again here: crossing expiry between checks would
  // skip the locked reread and could hide a confirmation that is committing.
  return { state: expiredAtRead ? 'expired' as const : 'active' as const };
}

// The open card is the one receiving the stamp, never an older unclaimed reward.
function stampTarget(state: NonNullable<Awaited<ReturnType<typeof loyaltyState>>>, sessionId: string) {
  const { open, program } = state;
  const goal = open?.goal ?? program.stampGoal;
  const stamps = open?.stamps ?? 0;
  const rewardKind = open?.rewardKind ?? program.rewardKind;
  const rewardValue = open ? open.rewardValue : program.rewardValue;
  const rewardProductId = open ? open.rewardProductId : program.rewardProductId;
  const rewardDescription = open?.rewardDescription ?? program.rewardDescription;
  const completesCard = stamps + 1 === goal;
  const previewKey = hash(JSON.stringify([sessionId, open?.id ?? program.programVersion, stamps, goal, rewardKind, rewardValue, rewardProductId, rewardDescription, state.reserved]));
  return { stamps, goal, rewardKind, rewardValue, rewardProductId, rewardDescription, completesCard, previewKey };
}

/** Scanning previews the customer; only staff confirmation consumes the QR. */
export async function previewInPerson(db: PrismaClient, code: string) {
  return db.$transaction(async (tx: Tx) => {
    const session = await sessionForCode(tx, code, true);
    if (!session) throw new AppError(409, 'LOYALTY_CODE_INVALID', 'El código expiró o ya fue usado. Pide al cliente que muestre uno nuevo.');
    const state = await loyaltyState(tx, session.customerId);
    if (!state || !state.program.enabled) throw new AppError(409, 'LOYALTY_PROGRAM_OFF', 'El programa de fidelidad está en pausa.');
    // loyaltyState waits on the customer lock. The QR may have expired, been
    // replaced or been consumed while waiting for that lock.
    if (!(await sessionForCode(tx, code, true))) throw new AppError(409, 'LOYALTY_CODE_INVALID', 'El código expiró o ya fue usado. Pide al cliente que muestre uno nuevo.');
    const customer = await tx.customer.findUniqueOrThrow({ where: { id: session.customerId }, select: { user: { select: { name: true, lastName: true } } } });
    const target = stampTarget(state, session.id);
    const { rewardProductId, ...preview } = target;
    const gift = target.completesCard && !state.reserved && target.rewardKind === 'PRODUCT'
      ? await findLoyaltyGift(tx, rewardProductId)
      : null;
    const rewardBlockedReason = !target.completesCard ? null : state.reserved
      ? 'Tiene una recompensa reservada en un pedido en curso.'
      : target.rewardKind === 'PRODUCT' && !gift ? 'El producto de regalo no está disponible. Puedes registrar el sello sin entregarlo.' : null;
    return {
      ...preview,
      customerName: [customer.user.name, customer.user.lastName].filter(Boolean).join(' ') || 'Cliente WingsLab',
      rewardBlockedReason,
    };
  }, { timeout: 30000 });
}

/** Records loyalty only. No sale, payment, or customer-supplied products. */
export async function registerInPersonStamp(db: PrismaClient, input: StampInput) {
  const requestHash = hash(JSON.stringify(['stamp', input.previewKey, input.deliverReward]));
  return db.$transaction(async tx => {
    const session = await claimScanCode(tx, input.code);
    if (!session) return replayOrReject(tx, input, requestHash);
    const { id: scanSessionId, customerId } = session;
    const state = await loyaltyState(tx, customerId);
    if (!state?.program.enabled) throw new AppError(409, 'LOYALTY_PROGRAM_OFF', 'El programa está en pausa. No se agregó el sello.');
    const target = stampTarget(state, scanSessionId);
    if (target.previewKey !== input.previewKey) {
      throw new AppError(409, 'LOYALTY_PREVIEW_CHANGED', 'Cambió el progreso de la tarjeta. Verifica el código de nuevo.');
    }
    if (input.deliverReward && (!target.completesCard || state.reserved)) {
      throw new AppError(409, 'LOYALTY_REWARD_UNAVAILABLE', 'La recompensa no se puede entregar en esta compra.');
    }
    const gift = input.deliverReward && target.rewardKind === 'PRODUCT' ? await findLoyaltyGift(tx, target.rewardProductId) : null;
    if (input.deliverReward && target.rewardKind === 'PRODUCT' && !gift) {
      throw new AppError(409, 'LOYALTY_GIFT_UNAVAILABLE', 'El producto de regalo no está disponible. Puedes agregar el sello sin entregar la recompensa.');
    }
    if (gift?.trackStock) {
      const updated = await tx.product.updateMany({
        where: { id: gift.id, restaurantId: RESTAURANT_ID, isAvailable: true, deleted: false, trackStock: true, stock: { gte: 1 } },
        data: { stock: { decrement: 1 } },
      });
      if (updated.count !== 1) throw new AppError(409, 'LOYALTY_GIFT_UNAVAILABLE', 'El producto se agotó. Puedes agregar el sello sin entregar la recompensa.');
    }
    const card = state.open ?? await openCard(tx, customerId, state.program);
    const visitId = randomUUID();
    await tx.loyaltyVisit.create({ data: {
      id: visitId, customerId, restaurantId: RESTAURANT_ID, scanSessionId, requestHash,
      amountCents: 0, createdBy: input.staffUserId,
      rewardDescription: input.deliverReward ? target.rewardDescription : null,
      rewardProductId: gift?.id ?? null, giftStockDecremented: gift?.trackStock ?? false,
    } });
    const progress = await appendStamp(tx, card, visitId);
    if (input.deliverReward) {
      // Discounts are confirmed at the counter; this flow has no sale total.
      await tx.loyaltyRedemption.create({ data: { id: randomUUID(), cardId: card.id, visitId, state: 'COMPLETED', discountCents: 0, completedAt: new Date() } });
    }
    const result = { ...progress, visitId, rewardDelivered: input.deliverReward, rewardDescription: target.rewardDescription };
    await tx.loyaltyVisit.update({ where: { id: visitId }, data: { resultJson: JSON.stringify(result) } });
    await tx.auditLog.create({ data: { userId: input.staffUserId, action: 'LOYALTY_IN_PERSON_STAMP', entity: 'LoyaltyVisit', entityId: visitId, newValue: JSON.stringify(result) } });
    return result;
  }, { timeout: 30000 });
}

/** Quotes against trusted current catalog prices; browser prices are never used. */
export async function quoteInPerson(db: PrismaClient, code: string, items: InPersonSaleItemInput[], applyReward: boolean) {
  return db.$transaction(async (tx: Tx) => {
    const session = await sessionForCode(tx, code, true);
    if (!session) throw new AppError(409, 'LOYALTY_CODE_INVALID', 'El código expiró o ya fue usado. Pide al cliente que muestre uno nuevo.');
    const state = await loyaltyState(tx, session.customerId);
    if (!state || !state.program.enabled) throw new AppError(409, 'LOYALTY_PROGRAM_OFF', 'El programa de fidelidad está en pausa.');
    const quote = await quoteSale(tx, session.customerId, items, applyReward);
    const customer = await tx.customer.findUniqueOrThrow({ where: { id: session.customerId }, select: { user: { select: { name: true, lastName: true } } } });
    return { ...quote, customerName: [customer.user.name, customer.user.lastName].filter(Boolean).join(' ') || 'Cliente WingsLab', stamps: state.open?.stamps ?? 0, goal: state.next?.goal ?? state.program.stampGoal, availableRewards: state.available.length, reserved: state.reserved };
  }, { timeout: 30000 });
}

function normalizeSaleInput(input: SaleInput) {
  return JSON.stringify({
    items: input.items.map(item => ({ productId: item.productId, quantity: item.quantity, weightG: item.weightG ?? null, optionIds: [...(item.optionIds ?? [])].sort() })),
    applyReward: input.applyReward, paymentMethod: input.paymentMethod, note: input.note?.trim() || null,
  });
}

/** Atomically consumes QR, validates products/prices/promotions, records a paid
 * local sale, updates optional stock and awards/redeems loyalty. Repeated exact
 * requests with the same QR are idempotent after a lost HTTP response. */
export async function registerInPerson(prisma: PrismaClient, input: SaleInput) {
  if (!['CASH', 'CARD', 'TRANSFER', 'OTHER'].includes(input.paymentMethod)) throw new AppError(400, 'INVALID_PAYMENT_METHOD', 'Selecciona una forma de pago válida.');
  const requestHash = hash(normalizeSaleInput(input));
  return prisma.$transaction(async (tx: Tx) => {
    const session = await claimScanCode(tx, input.code);
    if (!session) return replayOrReject(tx, input, requestHash);
    const { id: scanSessionId, customerId } = session;
    const program = await readProgram(tx);
    if (!program?.enabled) throw new AppError(409, 'LOYALTY_PROGRAM_OFF', 'El programa está en pausa. No se registró la compra.');
    const state = await loyaltyState(tx, customerId);
    if (!state) throw new AppError(409, 'LOYALTY_PROGRAM_OFF', 'El programa no está configurado.');
    const catalog = await saleCatalog(tx, input.items);
    const sale = calculateInPersonSaleItems(input.items, catalog);
    const productIds = [...new Set(sale.items.map(item => item.productId))];
    const productById = new Map(catalog.map(product => [product.id, product]));

    let reward: Awaited<ReturnType<typeof loyaltyQuote>> | null = null;
    if (input.applyReward) {
      reward = await loyaltyQuote(tx, customerId, sale.subtotalCents, productIds, sale.hasPromotion);
      if (!reward.eligible) throw new AppError(409, 'LOYALTY_REWARD_UNAVAILABLE', reward.reason || 'La recompensa no puede aplicarse a esta compra.');
      if (reward.gift?.trackStock && reward.gift.stock < (sale.stockRequired.get(reward.gift.id) ?? 0) + 1) {
        throw new AppError(409, 'LOYALTY_GIFT_UNAVAILABLE', 'No hay existencias suficientes para vender el producto y entregar además la recompensa.');
      }
    }

    // Stock is optional. Only products with trackStock=true are reserved, and
    // all checks and decrements are atomic with the sale.
    for (const [productId, quantity] of sale.stockRequired) {
      const updated = await tx.product.updateMany({ where: { id: productId, restaurantId: RESTAURANT_ID, isAvailable: true, deleted: false, trackStock: true, stock: { gte: quantity } }, data: { stock: { decrement: quantity } } });
      if (updated.count !== 1) throw new AppError(409, 'INSUFFICIENT_STOCK', `No hay existencias suficientes de ${productById.get(productId)?.name || 'un producto'}.`);
    }

    let giftStockDecremented = false;
    let rewardProductId: string | null = null;
    let rewardDescription: string | null = null;
    let rewardAppliedCents = 0;
    if (reward?.eligible) {
      if (reward.gift) {
        rewardProductId = reward.gift.id;
        rewardDescription = `${reward.gift.name} de regalo`;
        if (reward.gift.trackStock) {
          const updated = await tx.product.updateMany({ where: { id: reward.gift.id, restaurantId: RESTAURANT_ID, isAvailable: true, deleted: false, trackStock: true, stock: { gte: 1 } }, data: { stock: { decrement: 1 } } });
          if (updated.count !== 1) throw new AppError(409, 'LOYALTY_GIFT_UNAVAILABLE', 'El producto de regalo se agotó. No se aplicó la recompensa.');
          giftStockDecremented = true;
        }
      } else {
        rewardAppliedCents = reward.discountCents;
        rewardDescription = reward.rewardDescription;
      }
    }

    const visitId = randomUUID();
    const totalCents = sale.subtotalCents - rewardAppliedCents;
    await tx.loyaltyVisit.create({ data: {
      id: visitId, customerId, restaurantId: RESTAURANT_ID, scanSessionId, requestHash,
      amountCents: sale.subtotalCents, totalCents, rewardAppliedCents, rewardDescription,
      rewardProductId, giftStockDecremented, itemsJson: JSON.stringify(sale.items),
      paymentMethod: input.paymentMethod, createdBy: input.staffUserId, note: input.note?.trim() || null,
    } });
    if (reward?.eligible) {
      await tx.loyaltyRedemption.create({ data: { id: randomUUID(), cardId: reward.cardId, visitId, state: 'COMPLETED', discountCents: rewardAppliedCents, completedAt: new Date() } });
    }
    const card = await openCard(tx, customerId, program);
    const { stamps, completed } = await appendStamp(tx, card, visitId);
    await tx.auditLog.create({ data: { userId: input.staffUserId, action: 'LOYALTY_IN_PERSON_VISIT', entity: 'LoyaltyVisit', entityId: visitId,
      newValue: JSON.stringify({ subtotalCents: sale.subtotalCents, totalCents, rewardAppliedCents, completed, giftStockDecremented, paymentMethod: input.paymentMethod }) } });
    const result = { visitId, customerId, stamps, goal: card.goal, completed, subtotalCents: sale.subtotalCents, totalCents, rewardAppliedCents, rewardDescription, amountCents: sale.subtotalCents, paymentMethod: input.paymentMethod };
    await tx.loyaltyVisit.update({ where: { id: visitId }, data: { resultJson: JSON.stringify(result) } });
    return result;
  }, { timeout: 30000 });
}

/** Reverses a recent mistake without corrupting later loyalty movements. */
export async function voidInPerson(prisma: PrismaClient, visitId: string, staffUserId: string) {
  return prisma.$transaction(async (tx: Tx) => {
    const visit = await tx.loyaltyVisit.findFirst({ where: { id: visitId, restaurantId: RESTAURANT_ID } });
    if (!visit) throw new AppError(404, 'VISIT_NOT_FOUND', 'No se encontró la venta.');
    await lock(tx, visit.customerId);
    const current = await tx.loyaltyVisit.findUnique({ where: { id: visitId } });
    if (!current) throw new AppError(404, 'VISIT_NOT_FOUND', 'No se encontró la venta.');
    if (current.voidedAt) {
      if (current.voidedBy === staffUserId) return { ok: true, alreadyVoided: true };
      throw new AppError(409, 'VISIT_ALREADY_VOIDED', 'La venta ya fue anulada.');
    }
    if (current.createdBy !== staffUserId) throw new AppError(403, 'VOID_FORBIDDEN', 'Solo quien registró la venta puede anularla.');
    const age = await tx.$queryRaw<Array<{ ageMs: number }>>`SELECT (EXTRACT(EPOCH FROM (clock_timestamp()-${current.createdAt}::timestamptz)) * 1000)::float8 AS "ageMs"`;
    if ((age[0]?.ageMs ?? Infinity) > VOID_WINDOW_MS) throw new AppError(409, 'VOID_WINDOW_CLOSED', 'El plazo para corregir la venta terminó.');

    const stamp = await tx.loyaltyStamp.findFirst({ where: { visitId, source: 'IN_PERSON' } });
    const redemption = await tx.loyaltyRedemption.findFirst({ where: { visitId } });
    let card: { id: string; sequence: number; state: string } | null = null;
    if (stamp) {
      card = await tx.loyaltyCard.findUnique({ where: { id: stamp.cardId }, select: { id: true, sequence: true, state: true } });
      if (card) {
        const laterCards = await tx.loyaltyCard.count({ where: { customerId: current.customerId, restaurantId: RESTAURANT_ID, sequence: { gt: card.sequence } } });
        const otherRedemption = await tx.loyaltyRedemption.findFirst({ where: { cardId: card.id, OR: [{ visitId: null }, { visitId: { not: visitId } }] } });
        const laterStamp = await tx.loyaltyStamp.findFirst({
          where: { cardId: card.id, id: { not: stamp.id }, earnedAt: { gte: stamp.earnedAt } },
          select: { id: true },
        });
        if (laterCards || otherRedemption || laterStamp) throw new AppError(409, 'VISIT_HAS_DEPENDENCIES', 'No se puede anular: ya hay movimientos posteriores o el premio de esta tarjeta fue usado.');
      }
    }
    let items: Array<{ productId: string; quantity: number; stockDeducted: boolean }>;
    try { items = JSON.parse(current.itemsJson) as typeof items; } catch { throw new AppError(409, 'VISIT_ITEMS_UNKNOWN', 'No se puede verificar el detalle de esta venta. Requiere revisión manual.'); }
    if (!Array.isArray(items)) throw new AppError(409, 'VISIT_ITEMS_UNKNOWN', 'No se puede verificar el detalle de esta venta. Requiere revisión manual.');
    if (items.some(item => !item || typeof item.productId !== 'string' || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || typeof item.stockDeducted !== 'boolean')) {
      throw new AppError(409, 'VISIT_ITEMS_UNKNOWN', 'El detalle histórico no permite restaurar existencias con seguridad. Requiere revisión manual.');
    }
    if (current.rewardProductId && current.giftStockDecremented === null) throw new AppError(409, 'VISIT_STOCK_UNKNOWN', 'No se puede verificar el inventario original de esta recompensa. Requiere revisión manual.');

    // Restore only quantities actually deducted. A product without stock
    // tracking never has its stock changed by a sale or by a correction.
    for (const item of items) {
      if (!item.stockDeducted) continue;
      await tx.product.updateMany({ where: { id: item.productId, restaurantId: RESTAURANT_ID }, data: { stock: { increment: item.quantity } } });
    }
    if (current.rewardProductId && current.giftStockDecremented) {
      await tx.product.updateMany({ where: { id: current.rewardProductId, restaurantId: RESTAURANT_ID }, data: { stock: { increment: 1 } } });
    }
    if (stamp) {
      if (card?.state === 'COMPLETED') await tx.loyaltyCard.update({ where: { id: card.id }, data: { state: 'OPEN', completedAt: null } });
      await tx.loyaltyStamp.delete({ where: { id: stamp.id } });
    }
    if (redemption) await tx.loyaltyRedemption.delete({ where: { id: redemption.id } });
    await tx.loyaltyVisit.update({ where: { id: visitId }, data: { voidedAt: new Date(), voidedBy: staffUserId } });
    await tx.auditLog.create({ data: { userId: staffUserId, action: 'LOYALTY_IN_PERSON_VISIT_VOIDED', entity: 'LoyaltyVisit', entityId: visitId,
      oldValue: JSON.stringify({ amountCents: current.amountCents, totalCents: current.totalCents, rewardAppliedCents: current.rewardAppliedCents }) } });
    return { ok: true, alreadyVoided: false };
  }, { timeout: 20000 });
}

export async function recentVisits(db: PrismaClient, limit = 20) {
  return db.$transaction(async (tx: Tx) => {
    const list = await tx.loyaltyVisit.findMany({
      where: { restaurantId: RESTAURANT_ID },
      select: { id: true, amountCents: true, totalCents: true, paymentMethod: true, itemsJson: true, rewardAppliedCents: true, rewardDescription: true, createdBy: true, voidedAt: true, createdAt: true,
        customer: { select: { user: { select: { name: true, lastName: true } } } } },
      orderBy: { createdAt: 'desc' }, take: Math.min(50, Math.max(1, limit)),
    });
    return list.map(visit => ({
      ...visit,
      items: (() => { try { return JSON.parse(visit.itemsJson); } catch { return []; } })(),
      customerName: [visit.customer.user.name, visit.customer.user.lastName].filter(Boolean).join(' ') || 'Cliente',
      customer: undefined,
    }));
  }, { timeout: 15000 });
}
