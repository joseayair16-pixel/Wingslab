import { BillingCycle } from '@prisma/client';

import { prisma } from '../config/database';

type BillingSeed = {
  id: string;
  name?: string;
  billingCycle: BillingCycle;
  platformFeeRate: number;
  serviceFee: number;
  platformFeePerOrder: number;
  lastBillingSettledAt: Date | null;
  createdAt: Date;
};

export type RestaurantBillingSummary = {
  currentDebt: number;
  pastDebt: number;
  deliveredRevenue: number;
  serviceFeeRevenue: number;
  platformFeeRevenue: number;
  whatsappFeeRevenue: number;
  deliveredOrders: number;
  platformFeeRate: number;
  serviceFee: number;
  platformFeePerOrder: number;
  billingCycle: BillingCycle;
  periodStart: string;
  periodEnd: string;
  nextChargeDate: string;
};

export type RestaurantOperationalStats = {
  totalOrders: number;
  deliveredOrders: number;
  activeOrders: number;
  todayOrders: number;
  totalRevenue: number;
  deliveredRevenue: number;
};

type RevenueAttributionOrder = {
  restaurantId: string;
  supportRestaurantId: string | null;
  deliveredByRestaurant?: boolean | null;
  totalAmount: number;
  deliveryFee: number | null;
  restaurant?: { hasOwnDelivery?: boolean | null } | null;
};

/**
 * Ingreso que le corresponde a un restaurante por un pedido ya entregado.
 * - Restaurante de apoyo (el que prestó al repartidor): se lleva la tarifa de envío.
 * - Restaurante origen con entrega propia: se lleva el total (hizo el reparto).
 * - Restaurante origen con reparto de plataforma o apoyo a red: se lleva el total
 *   menos el envío, porque la tarifa de envío es de quien entrega (repartidor o aliado).
 */
export function attributedRevenueFor(order: RevenueAttributionOrder, viewerRestaurantId: string): number {
  if (order.supportRestaurantId && order.supportRestaurantId === viewerRestaurantId) {
    return order.deliveryFee || 0;
  }
  if (order.restaurantId !== viewerRestaurantId) {
    return 0;
  }
  if (order.deliveredByRestaurant || order.restaurant?.hasOwnDelivery) {
    return order.totalAmount;
  }
  return order.totalAmount - (order.deliveryFee || 0);
}

function resolveBillingStart(seed: BillingSeed, now: Date = new Date()) {
  if (seed.lastBillingSettledAt && seed.lastBillingSettledAt.getTime() <= now.getTime()) {
    return seed.lastBillingSettledAt;
  }
  return seed.createdAt;
}

function roundCurrency(value: number) {
  return Number(value.toFixed(2));
}

function getFixedCycleDates(cycle: BillingCycle) {
  const now = new Date();
  let start = new Date(now);
  let end = new Date(now);

  if (cycle === 'MONTHLY') {
    start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
  } else {
    // WEEKLY: Monday to Monday
    const day = start.getDay();
    const diff = start.getDate() - day + (day === 0 ? -6 : 1);
    start.setDate(diff);
    start.setHours(0, 0, 0, 0);
    
    end = new Date(start);
    end.setDate(end.getDate() + 7);
  }

  return { start, end };
}

export async function buildRestaurantBillingSummary(seed: BillingSeed, cutEnd?: Date): Promise<RestaurantBillingSummary> {
  const debtStart = resolveBillingStart(seed);
  const periodEnd = cutEnd || new Date();

  const aggregate = await prisma.order.aggregate({
    where: {
      restaurantId: seed.id,
      status: { in: ['DELIVERED', 'COMPLETED'] },
      OR: [
        { deliveredAt: { gte: debtStart, lte: periodEnd } },
        { completedAt: { gte: debtStart, lte: periodEnd } },
      ],
    },
    _sum: {
      whatsappFee: true,
      platformFee: true,
    },
    _count: {
      id: true,
    },
  });

  // Para el ingreso del origen se resta la tarifa de envío de los pedidos de apoyo a
  // red (esa tarifa le pertenece al restaurante aliado que hizo la entrega).
  const deliveredRevenueOrders = await prisma.order.findMany({
    where: {
      restaurantId: seed.id,
      status: { in: ['DELIVERED', 'COMPLETED'] },
      OR: [
        { deliveredAt: { gte: debtStart, lte: periodEnd } },
        { completedAt: { gte: debtStart, lte: periodEnd } },
      ],
    },
    select: {
      restaurantId: true,
      totalAmount: true,
      deliveryFee: true,
      supportRestaurantId: true,
      deliveredByRestaurant: true,
      restaurant: { select: { hasOwnDelivery: true } },
    },
  });
  const deliveredRevenue = deliveredRevenueOrders.reduce(
    (sum, order) => sum + attributedRevenueFor(order, seed.id),
    0
  );
  const deliveredOrders = aggregate._count.id;
  const serviceFeeRevenue = (seed.serviceFee || 0) * deliveredOrders;
  // La comision de la plataforma se suma desde el fee real guardado por pedido
  // (tarifa fija o porcentaje sobre el subtotal neto), no se recalcula de la config.
  const platformFeeRevenue = aggregate._sum.platformFee || 0;
  const whatsappFeeRevenue = aggregate._sum.whatsappFee || 0;
  
  // Calculate existing unpaid settlements debt
  const unpaidSettlements = await prisma.restaurantBillingSettlement.aggregate({
    where: {
      restaurantId: seed.id,
      status: { in: ['PENDING', 'OVERDUE'] }
    },
    _sum: { amount: true }
  });
  const pastDebt = unpaidSettlements._sum.amount || 0;

  const currentDebt = roundCurrency(serviceFeeRevenue + platformFeeRevenue + whatsappFeeRevenue + pastDebt);
 
  const { start: cycleStart, end: cycleEnd } = getFixedCycleDates(seed.billingCycle);

  return {
    currentDebt,
    pastDebt: roundCurrency(pastDebt),
    deliveredRevenue: roundCurrency(deliveredRevenue),
    serviceFeeRevenue: roundCurrency(serviceFeeRevenue),
    platformFeeRevenue: roundCurrency(platformFeeRevenue),
    whatsappFeeRevenue: roundCurrency(whatsappFeeRevenue),
    deliveredOrders,
    platformFeeRate: seed.platformFeeRate,
    serviceFee: seed.serviceFee,
    platformFeePerOrder: seed.platformFeePerOrder,
    billingCycle: seed.billingCycle,
    periodStart: cycleStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    nextChargeDate: cycleEnd.toISOString(),
  };
}

export async function buildRestaurantBillingSummaryMap(seeds: BillingSeed[]) {
  const entries = await Promise.all(
    seeds.map(async (seed) => [seed.id, await buildRestaurantBillingSummary(seed)] as const)
  );

  return new Map(entries);
}

export async function buildRestaurantOperationalStats(restaurantId: string): Promise<RestaurantOperationalStats> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const orders = await prisma.order.findMany({
    where: {
      OR: [
        { restaurantId },
        { supportRestaurantId: restaurantId },
      ],
    },
    select: {
      status: true,
      createdAt: true,
      restaurantId: true,
      supportRestaurantId: true,
      deliveredByRestaurant: true,
      totalAmount: true,
      deliveryFee: true,
      restaurant: { select: { hasOwnDelivery: true } },
    },
  });

  let totalOrders = 0;
  let deliveredOrders = 0;
  let activeOrders = 0;
  let todayOrders = 0;
  let totalRevenue = 0;
  let deliveredRevenue = 0;

  for (const order of orders) {
    if (order.createdAt >= todayStart) {
      todayOrders += 1;
    }
    if (order.status === 'CANCELLED' || order.status === 'REJECTED') {
      continue;
    }
    totalOrders += 1;
    totalRevenue += attributedRevenueFor(order, restaurantId);
    if (order.status === 'DELIVERED' || order.status === 'COMPLETED') {
      deliveredOrders += 1;
      deliveredRevenue += attributedRevenueFor(order, restaurantId);
    }
    if (['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'PICKED_UP', 'IN_TRANSIT'].includes(order.status)) {
      activeOrders += 1;
    }
  }

  return {
    totalOrders,
    deliveredOrders,
    activeOrders,
    todayOrders,
    totalRevenue: roundCurrency(totalRevenue),
    deliveredRevenue: roundCurrency(deliveredRevenue),
  };
}

export async function buildRestaurantWeeklyPerformance(restaurantId: string) {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - 6);
  startDate.setHours(0, 0, 0, 0);

  const orders = await prisma.order.findMany({
    where: {
      OR: [
        { restaurantId, status: { in: ['DELIVERED', 'COMPLETED'] } },
        { supportRestaurantId: restaurantId, status: { in: ['DELIVERED', 'COMPLETED'] } },
      ],
      createdAt: {
        gte: startDate,
      },
    },
    select: {
      createdAt: true,
      subtotal: true,
      deliveryFee: true,
      restaurantId: true,
      supportRestaurantId: true,
    },
  });

  const dailyMap = new Map<string, { name: string; ingresos: number }>();

  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(endDate.getDate() - i);
    const dayName = new Intl.DateTimeFormat('es-MX', { weekday: 'short', timeZone: 'America/Mexico_City' }).format(date);
    const formattedName = dayName.charAt(0).toUpperCase() + dayName.slice(1, 3); // Lun, Mar, Mié
    
    // Convert to local YYYY-MM-DD for key
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateKey = `${year}-${month}-${day}`;
    
    dailyMap.set(dateKey, { name: formattedName, ingresos: 0 });
  }

  for (const order of orders) {
    const d = order.createdAt;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const dateKey = `${year}-${month}-${day}`;
    
    const existing = dailyMap.get(dateKey);
    if (existing) {
      // Entregas de apoyo: el restaurante aliado ingresa la tarifa de envío.
      const isSupportDelivery = order.supportRestaurantId === restaurantId;
      existing.ingresos += isSupportDelivery
        ? (order.deliveryFee || 0)
        : order.subtotal;
    }
  }

  return Array.from(dailyMap.values()).map((item) => ({
    name: item.name,
    ingresos: roundCurrency(item.ingresos),
  }));
}

export async function buildRestaurantOverview() {
  const restaurants = await prisma.restaurant.findMany({
    select: {
      id: true,
      status: true,
      hasOwnDelivery: true,
      billingCycle: true,
      platformFeeRate: true,
      serviceFee: true,
      platformFeePerOrder: true,
      lastBillingSettledAt: true,
      createdAt: true,
    },
  });

  const billingSummaryMap = await buildRestaurantBillingSummaryMap(
    restaurants.map((restaurant) => ({
      id: restaurant.id,
      billingCycle: restaurant.billingCycle,
      platformFeeRate: restaurant.platformFeeRate,
      serviceFee: restaurant.serviceFee,
      platformFeePerOrder: restaurant.platformFeePerOrder,
      lastBillingSettledAt: restaurant.lastBillingSettledAt,
      createdAt: restaurant.createdAt,
    }))
  );

  const summaries = [...billingSummaryMap.values()];

  return {
    totalRestaurants: restaurants.length,
    activeRestaurants: restaurants.filter((restaurant) => restaurant.status === 'ACTIVE').length,
    pausedRestaurants: restaurants.filter((restaurant) => restaurant.status === 'SUSPENDED').length,
    ownDeliveryRestaurants: restaurants.filter((restaurant) => restaurant.hasOwnDelivery).length,
    weeklyBillingRestaurants: restaurants.filter((restaurant) => restaurant.billingCycle === 'WEEKLY').length,
    monthlyBillingRestaurants: restaurants.filter((restaurant) => restaurant.billingCycle === 'MONTHLY').length,
    restaurantsWithDebt: summaries.filter((summary) => summary.currentDebt > 0).length,
    totalOutstandingDebt: roundCurrency(
      summaries.reduce((sum, summary) => sum + summary.currentDebt, 0)
    ),
    totalPastDebt: roundCurrency(
      summaries.reduce((sum, summary) => sum + summary.pastDebt, 0)
    ),
    totalAccruedDebt: roundCurrency(
      summaries.reduce((sum, summary) => sum + summary.serviceFeeRevenue + summary.platformFeeRevenue + summary.whatsappFeeRevenue, 0)
    ),
  };
}

export async function createBillingSettlement(restaurantId: string) {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: {
      id: true,
      billingCycle: true,
      platformFeeRate: true,
      serviceFee: true,
      platformFeePerOrder: true,
      lastBillingSettledAt: true,
      createdAt: true,
    },
  });

  if (!restaurant) {
    throw new Error('Restaurant not found');
  }

  const now = new Date();

  // Auto-heal: if lastBillingSettledAt is in the future, reject the bad settlement
  if (restaurant.lastBillingSettledAt && restaurant.lastBillingSettledAt.getTime() > now.getTime()) {
    await prisma.restaurantBillingSettlement.updateMany({
      where: {
        restaurantId,
        status: 'PENDING',
        periodEnd: restaurant.lastBillingSettledAt,
      },
      data: { status: 'REJECTED', notes: 'Anulado automáticamente: corte generado antes de tiempo.' },
    });
    await prisma.restaurant.update({
      where: { id: restaurantId },
      data: { lastBillingSettledAt: null },
    });
    restaurant.lastBillingSettledAt = null;
  }

  // Auto-heal: reject any $0 PENDING settlements with delivered orders (clearly incorrect)
  await prisma.restaurantBillingSettlement.updateMany({
    where: {
      restaurantId,
      status: 'PENDING',
      amount: 0,
      deliveredOrders: { gt: 0 },
    },
    data: { status: 'REJECTED', notes: 'Anulado automáticamente: monto $0 con pedidos entregados.' },
  });

  // Align periodEnd to the most recent Sunday at 23:59:59
  // On Sunday, periodEnd = today at 23:59 (covers current week)
  // On other days, periodEnd = previous Sunday at 23:59
  const dayOfWeek = now.getDay();
  const periodEnd = new Date(now);
  periodEnd.setDate(periodEnd.getDate() - dayOfWeek);
  periodEnd.setHours(23, 59, 59, 0);

  // Safety check: allow up to 5 min tolerance for the scheduled Sunday 23:59 cron
  const MS_TOLERANCE = 5 * 60 * 1000;
  if (periodEnd.getTime() > now.getTime() + MS_TOLERANCE) {
    throw new Error(`El período de corte actual (${periodEnd.toISOString()}) aún no ha finalizado.`);
  }

  const periodStart = resolveBillingStart(restaurant);
  const summary = await buildRestaurantBillingSummary(restaurant, periodEnd);

  // Skip creating a settlement for empty periods (no orders, no debt)
  const newDebt = summary.serviceFeeRevenue + summary.platformFeeRevenue + summary.whatsappFeeRevenue;
  if (summary.deliveredOrders === 0 && newDebt === 0) {
    // Just update lastBillingSettledAt to mark the period as processed
    // so future periods start from here
    await prisma.restaurant.update({
      where: { id: restaurantId },
      data: { lastBillingSettledAt: periodEnd },
    });
    console.log(`[BillingJob] Periodo vacío para restaurante ${restaurant.id}. Marcado como procesado.`);
    return null;
  }

  // Calculate due date (3 days after period end = Wednesday)
  const dueDate = new Date(periodEnd);
  dueDate.setDate(dueDate.getDate() + 3);

  const yy = periodEnd.getFullYear().toString().slice(-2);
  const mm = (periodEnd.getMonth() + 1).toString().padStart(2, '0');
  const dd = periodEnd.getDate().toString().padStart(2, '0');
  const shortId = restaurantId.slice(-6).toUpperCase();
  const reference = `CRT-${yy}${mm}${dd}-${shortId}`;

  const [settlement] = await prisma.$transaction([
    prisma.restaurantBillingSettlement.upsert({
      where: { reference },
      create: {
        restaurantId,
        billingCycle: summary.billingCycle,
        feeRate: summary.platformFeeRate,
        periodStart,
        periodEnd,
        dueDate,
        deliveredOrders: summary.deliveredOrders,
        deliveredRevenue: summary.deliveredRevenue,
        amount: summary.serviceFeeRevenue + summary.platformFeeRevenue + summary.whatsappFeeRevenue,
        serviceFeeTotal: summary.serviceFeeRevenue,
        platformFeeTotal: summary.platformFeeRevenue,
        whatsappFeeTotal: summary.whatsappFeeRevenue,
        status: 'PENDING',
        reference,
      },
      update: {
        amount: summary.serviceFeeRevenue + summary.platformFeeRevenue + summary.whatsappFeeRevenue,
        serviceFeeTotal: summary.serviceFeeRevenue,
        platformFeeTotal: summary.platformFeeRevenue,
        whatsappFeeTotal: summary.whatsappFeeRevenue,
        deliveredOrders: summary.deliveredOrders,
        deliveredRevenue: summary.deliveredRevenue,
        status: 'PENDING',
      },
    }),
    prisma.restaurant.update({
      where: { id: restaurantId },
      data: { lastBillingSettledAt: periodEnd },
    }),
  ]);

  invalidateBillingCache(restaurantId);

  return settlement;
}

// ── in-memory cache (lightweight, self-healing via TTL) ──

const billingCacheTtlMs = 15_000;

const billingCacheMap = new Map<string, { data: unknown; expiresAt: number }>();

export function invalidateBillingCache(restaurantId: string) {
  billingCacheMap.delete(restaurantId);
}

export function getCachedBillingSummary(restaurantId: string): unknown | null {
  const entry = billingCacheMap.get(restaurantId);
  if (entry && Date.now() < entry.expiresAt) return entry.data;
  billingCacheMap.delete(restaurantId);
  return null;
}

export function setCachedBillingSummary(restaurantId: string, data: unknown) {
  billingCacheMap.set(restaurantId, { data, expiresAt: Date.now() + billingCacheTtlMs });
}
