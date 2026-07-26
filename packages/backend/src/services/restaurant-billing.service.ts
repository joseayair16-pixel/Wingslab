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
  deliveredOrders: number;
  platformFeeRate: number;
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

function addCycle(date: Date, cycle: BillingCycle) {
  const next = new Date(date);

  if (cycle === 'MONTHLY') {
    next.setMonth(next.getMonth() + 1);
    return next;
  }

  next.setDate(next.getDate() + 7);
  return next;
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
      createdAt: {
        gte: debtStart,
        lte: periodEnd,
      },
    },
    _sum: {
      totalAmount: true,
    },
    _count: {
      id: true,
    },
  });
 
  const deliveredRevenue = aggregate._sum.totalAmount || 0;
  const deliveredOrders = aggregate._count.id;
  const serviceFeeRevenue = (seed.serviceFee || 0) * deliveredOrders;
  const platformFeeRevenue = (seed.platformFeePerOrder || 0) * deliveredOrders;
  
  // Calculate existing unpaid settlements debt
  const unpaidSettlements = await prisma.restaurantBillingSettlement.aggregate({
    where: {
      restaurantId: seed.id,
      status: { in: ['PENDING', 'OVERDUE'] }
    },
    _sum: { amount: true }
  });
  const pastDebt = unpaidSettlements._sum.amount || 0;

  const currentDebt = roundCurrency(serviceFeeRevenue + platformFeeRevenue + pastDebt);
 
  const { start: cycleStart, end: cycleEnd } = getFixedCycleDates(seed.billingCycle);

  return {
    currentDebt,
    pastDebt: roundCurrency(pastDebt),
    deliveredRevenue: roundCurrency(deliveredRevenue),
    serviceFeeRevenue: roundCurrency(serviceFeeRevenue),
    platformFeeRevenue: roundCurrency(platformFeeRevenue),
    deliveredOrders,
    platformFeeRate: seed.platformFeeRate,
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

  const [totalOrders, deliveredOrders, activeOrders, todayOrders, totalRevenue, deliveredRevenue] = await Promise.all([
    prisma.order.count({
      where: { restaurantId },
    }),
    prisma.order.count({
      where: { restaurantId, status: { in: ['DELIVERED', 'COMPLETED'] } },
    }),
    prisma.order.count({
      where: {
        restaurantId,
        status: {
          in: ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'PICKED_UP', 'IN_TRANSIT'],
        },
      },
    }),
    prisma.order.count({
      where: {
        restaurantId,
        createdAt: {
          gte: todayStart,
        },
      },
    }),
    prisma.order.aggregate({
      where: {
        restaurantId,
        status: {
          notIn: ['CANCELLED', 'REJECTED'],
        },
      },
      _sum: {
        totalAmount: true,
      },
    }),
    prisma.order.aggregate({
      where: { restaurantId, status: { in: ['DELIVERED', 'COMPLETED'] } },
      _sum: {
        totalAmount: true,
      },
    }),
  ]);

  return {
    totalOrders,
    deliveredOrders,
    activeOrders,
    todayOrders,
    totalRevenue: roundCurrency(totalRevenue._sum.totalAmount || 0),
    deliveredRevenue: roundCurrency(deliveredRevenue._sum.totalAmount || 0),
  };
}

export async function buildRestaurantWeeklyPerformance(restaurantId: string) {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - 6);
  startDate.setHours(0, 0, 0, 0);

  const orders = await prisma.order.findMany({
    where: {
      restaurantId,
      status: { in: ['DELIVERED', 'COMPLETED'] },
      createdAt: {
        gte: startDate,
      },
    },
    select: {
      createdAt: true,
      subtotal: true,
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
      existing.ingresos += order.subtotal;
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
      summaries.reduce((sum, summary) => sum + summary.serviceFeeRevenue + summary.platformFeeRevenue, 0)
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

  // Align periodEnd to the PREVIOUS Sunday at 23:59:59
  // On Sunday, go back 7 days; otherwise, go back to the most recent Sunday
  const dayOfWeek = now.getDay();
  const daysToPreviousSunday = dayOfWeek === 0 ? 7 : dayOfWeek;
  const periodEnd = new Date(now);
  periodEnd.setDate(periodEnd.getDate() - daysToPreviousSunday);
  periodEnd.setHours(23, 59, 59, 0);

  // Safety check: periodEnd must be in the past
  if (periodEnd.getTime() >= now.getTime()) {
    throw new Error(`El período de corte actual (${periodEnd.toISOString()}) aún no ha finalizado.`);
  }

  const periodStart = resolveBillingStart(restaurant);
  const summary = await buildRestaurantBillingSummary(restaurant, periodEnd);

  // Skip creating a settlement for empty periods (no orders, no debt)
  const newDebt = summary.serviceFeeRevenue + summary.platformFeeRevenue;
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
    prisma.restaurantBillingSettlement.create({
      data: {
        restaurantId,
        billingCycle: summary.billingCycle,
        feeRate: summary.platformFeeRate,
        periodStart,
        periodEnd,
        dueDate,
        deliveredOrders: summary.deliveredOrders,
        deliveredRevenue: summary.deliveredRevenue,
        amount: summary.serviceFeeRevenue + summary.platformFeeRevenue,
        serviceFeeTotal: summary.serviceFeeRevenue,
        platformFeeTotal: summary.platformFeeRevenue,
        status: 'PENDING',
        reference,
      },
    }),
    prisma.restaurant.update({
      where: { id: restaurantId },
      data: { lastBillingSettledAt: periodEnd },
    }),
  ]);

  return settlement;
}
