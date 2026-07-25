import { PrismaClient, OrderStatus } from '@prisma/client';

export async function getDriverOverdueDebt(
  prisma: PrismaClient,
  driverId: string,
  lastBillingSettledAt: Date | null,
  createdAt: Date
): Promise<number> {
  const now = new Date();

  // 1. Sum all overdue or past-due PENDING settlements.
  //    When a settlement is created, lastBillingSettledAt advances past those orders,
  //    so the order-based calculation (step 2) no longer sees them.
  const settlementAgg = await prisma.driverBillingSettlement.aggregate({
    where: {
      driverId,
      status: { in: ['OVERDUE', 'PENDING'] },
      dueDate: { lte: now },
    },
    _sum: { amount: true },
  });

  const settlementDebt = settlementAgg._sum.amount || 0;
  if (settlementDebt > 0) {
    return settlementDebt;
  }

  // 2. Fallback: check unpaid orders since last anchor.
  //    Catches cases where no settlement exists yet but orders are past the suspension date.
  const debtAnchor = lastBillingSettledAt || createdAt;

  const oldestUnpaidOrder = await prisma.order.findFirst({
    where: {
      driverId,
      status: OrderStatus.DELIVERED,
      deliveredAt: { gt: debtAnchor },
      driverPlatformFee: { gt: 0 },
    },
    orderBy: { deliveredAt: 'asc' },
    select: { deliveredAt: true },
  });

  if (!oldestUnpaidOrder?.deliveredAt) {
    return 0;
  }

  const d = new Date(oldestUnpaidOrder.deliveredAt);
  const daysToSunday = d.getDay() === 0 ? 0 : 7 - d.getDay();
  const cutoffSunday = new Date(d);
  cutoffSunday.setDate(d.getDate() + daysToSunday);
  cutoffSunday.setHours(23, 59, 59, 999);

  const suspensionWednesday = new Date(cutoffSunday);
  suspensionWednesday.setDate(cutoffSunday.getDate() + 3);
  suspensionWednesday.setHours(23, 59, 59, 999);

  if (now > suspensionWednesday) {
    const totalDebtQuery = await prisma.order.aggregate({
      where: {
        driverId,
        status: OrderStatus.DELIVERED,
        deliveredAt: { gt: debtAnchor },
      },
      _sum: { driverPlatformFee: true },
    });

    return totalDebtQuery._sum.driverPlatformFee || 0;
  }

  return 0;
}

export async function checkDriverSuspension(
  prisma: PrismaClient,
  driverId: string,
  lastBillingSettledAt: Date | null,
  createdAt: Date
): Promise<{ isSuspendedByDebt: boolean; suspendedDebtAmount: number }> {
  const amount = await getDriverOverdueDebt(prisma, driverId, lastBillingSettledAt, createdAt);
  return {
    isSuspendedByDebt: amount > 0,
    suspendedDebtAmount: amount,
  };
}

export async function enforceDriverBillingSuspension(
  prisma: PrismaClient,
  driverId: string,
  userId: string
): Promise<void> {
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const pastDuePending = await tx.driverBillingSettlement.findMany({
      where: {
        driverId,
        status: 'PENDING',
        dueDate: { lte: now },
      },
      select: { id: true },
    });

    if (pastDuePending.length > 0) {
      await tx.driverBillingSettlement.updateMany({
        where: { id: { in: pastDuePending.map(s => s.id) } },
        data: { status: 'OVERDUE' },
      });
    }

    const overdueCount = await tx.driverBillingSettlement.count({
      where: { driverId, status: 'OVERDUE' },
    });

    if (overdueCount > 0) {
      const driver = await tx.driver.findUnique({
        where: { id: driverId },
        select: { status: true },
      });

      if (driver && (driver.status === 'ACTIVE' || driver.status === 'INACTIVE')) {
        await tx.driver.update({
          where: { id: driverId },
          data: { status: 'SUSPENDED', availability: 'OFFLINE' },
        });
        await tx.user.update({
          where: { id: userId },
          data: { status: 'SUSPENDED' },
        });
      }
    }
  });
}

export async function createDriverBillingSettlement(
  prisma: PrismaClient,
  driverId: string
): Promise<any> {
  return prisma.$transaction(async (tx) => {
    const driver = await tx.driver.findUnique({
      where: { id: driverId },
      select: {
        id: true,
        lastBillingSettledAt: true,
        createdAt: true,
      },
    });

    if (!driver) {
      throw new Error('Driver not found');
    }

    // Check for existing unpaid settlement INSIDE the transaction
    const existingUnpaid = await tx.driverBillingSettlement.findFirst({
      where: {
        driverId,
        status: { in: ['PENDING', 'IN_REVIEW', 'OVERDUE'] },
      },
      select: { id: true, amount: true },
    });
    if (existingUnpaid) {
      console.log(`[DriverBilling] Driver ${driverId} already has unpaid settlement ${existingUnpaid.id} ($${existingUnpaid.amount}). Skipping.`);
      return null;
    }

    const debtAnchor = driver.lastBillingSettledAt || driver.createdAt;

    // Aggregate orders since last settlement
    const aggregate = await tx.order.aggregate({
      where: {
        driverId,
        status: OrderStatus.DELIVERED,
        deliveredAt: { gt: debtAnchor },
      },
      _sum: {
        deliveryFee: true,
        driverPlatformFee: true,
      },
      _count: {
        id: true,
      },
    });

    const deliveredOrders = aggregate._count.id;
    const deliveredRevenue = aggregate._sum.deliveryFee || 0;
    const platformFeeTotal = aggregate._sum.driverPlatformFee || 0;
    const amount = platformFeeTotal;

    if (amount <= 0) {
      await tx.driver.update({
        where: { id: driverId },
        data: { lastBillingSettledAt: new Date() },
      });
      return null;
    }

    // Calculate period end: last Sunday at 23:59:59
    // On Sunday, this aligns to today; mid-week, it finds the previous Sunday
    const periodEnd = new Date();
    const sunday = new Date(periodEnd);
    const dayOfWeek = sunday.getDay();
    sunday.setDate(sunday.getDate() - dayOfWeek);
    sunday.setHours(23, 59, 59, 0);

    const dueDate = new Date(sunday);
    dueDate.setDate(sunday.getDate() + 3);
    dueDate.setHours(23, 59, 59, 0);

    // Generate reference with millisecond precision to avoid collisions
    const yy = sunday.getFullYear().toString().slice(-2);
    const mm = (sunday.getMonth() + 1).toString().padStart(2, '0');
    const dd = sunday.getDate().toString().padStart(2, '0');
    const driverShortId = driverId.slice(-6).toUpperCase();
    const ts = Date.now().toString(36).slice(-4).toUpperCase();
    const reference = `CRT-${yy}${mm}${dd}-${driverShortId}-${ts}`;

    const s = await tx.driverBillingSettlement.create({
      data: {
        driverId,
        reference,
        periodStart: debtAnchor,
        periodEnd: sunday,
        dueDate,
        deliveredOrders,
        deliveredRevenue,
        amount,
        platformFeeTotal,
        status: 'PENDING',
      },
    });

    await tx.driver.update({
      where: { id: driverId },
      data: { lastBillingSettledAt: sunday },
    });

    return s;
  });
}
