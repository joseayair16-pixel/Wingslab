import cron from 'node-cron';
import { prisma } from '../config/database';

async function processOverdueDriverSettlements() {
  console.log('[DriverBillingOverdueJob] Starting overdue driver settlements check...');

  try {
    const now = new Date();

    // === STEP 1: Mark PENDING settlements past due as OVERDUE and suspend drivers ===
    const pendingOverdue = await prisma.driverBillingSettlement.findMany({
      where: {
        status: 'PENDING',
        dueDate: { lte: now },
      },
      select: {
        id: true,
        reference: true,
        driverId: true,
        driver: {
          select: { id: true, status: true, userId: true },
        },
      },
    });

    console.log(`[DriverBillingOverdueJob] Found ${pendingOverdue.length} PENDING driver settlements past due.`);

    for (const settlement of pendingOverdue) {
      try {
        await prisma.$transaction(async (tx) => {
          // Re-read settlement inside transaction to prevent race with admin PAID
          const current = await tx.driverBillingSettlement.findUnique({
            where: { id: settlement.id },
            select: { status: true },
          });
          if (!current || current.status !== 'PENDING') {
            console.log(`[DriverBillingOverdueJob] Skipping settlement ${settlement.reference}: status changed to ${current?.status}.`);
            return;
          }

          // 1. Mark settlement as OVERDUE
          await tx.driverBillingSettlement.update({
            where: { id: settlement.id },
            data: { status: 'OVERDUE' },
          });

          // 2. Re-read driver status fresh inside transaction to avoid TOCTOU
          const driver = await tx.driver.findUnique({
            where: { id: settlement.driverId },
            select: { status: true },
          });

          if (driver && (driver.status === 'ACTIVE' || driver.status === 'INACTIVE')) {
            await tx.driver.update({
              where: { id: settlement.driverId },
              data: {
                status: 'SUSPENDED',
                availability: 'OFFLINE',
              },
            });

            await tx.user.update({
              where: { id: settlement.driver.userId },
              data: { status: 'SUSPENDED' },
            });

            console.log(`[DriverBillingOverdueJob] Suspended driver ${settlement.driverId} due to overdue settlement ${settlement.reference}.`);
          }
        });
      } catch (error) {
        console.error(`[DriverBillingOverdueJob] Failed to process settlement ${settlement.reference}:`, error);
      }
    }

    // === STEP 2: Data repair — OVERDUE settlements whose driver is still ACTIVE/INACTIVE ===
    const overdueSettlements = await prisma.driverBillingSettlement.findMany({
      where: { status: 'OVERDUE' },
      select: {
        id: true,
        reference: true,
        driverId: true,
        driver: {
          select: { id: true, status: true, userId: true },
        },
      },
    });

    const activeWithOverdue = overdueSettlements.filter(
      s => s.driver.status === 'ACTIVE' || s.driver.status === 'INACTIVE'
    );
    if (activeWithOverdue.length > 0) {
      console.log(`[DriverBillingOverdueJob] Repair: ${activeWithOverdue.length} driver(s) ACTIVE/INACTIVE with OVERDUE settlements.`);
    }

    for (const settlement of activeWithOverdue) {
      try {
        await prisma.$transaction(async (tx) => {
          const driver = await tx.driver.findUnique({
            where: { id: settlement.driverId },
            select: { status: true },
          });
          if (driver && (driver.status === 'ACTIVE' || driver.status === 'INACTIVE')) {
            await tx.driver.update({
              where: { id: settlement.driverId },
              data: {
                status: 'SUSPENDED',
                availability: 'OFFLINE',
              },
            });

            await tx.user.update({
              where: { id: settlement.driver.userId },
              data: { status: 'SUSPENDED' },
            });

            console.log(`[DriverBillingOverdueJob] (Repair) Suspended driver ${settlement.driverId}.`);
          }
        });
      } catch (error) {
        console.error(`[DriverBillingOverdueJob] Failed repair for settlement ${settlement.reference}:`, error);
      }
    }

    console.log('[DriverBillingOverdueJob] Overdue driver check completed.');
  } catch (error) {
    console.error('[DriverBillingOverdueJob] Critical error:', error);
  }
}

export function scheduleDriverBillingOverdueCron() {
  cron.schedule('0 0 * * *', () => {
    processOverdueDriverSettlements();
  });

  console.log('[DriverBillingOverdueJob] Scheduled daily at midnight.');
}

export { processOverdueDriverSettlements };
