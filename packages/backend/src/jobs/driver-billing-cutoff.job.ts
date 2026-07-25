import cron from 'node-cron';
import { prisma } from '../config/database';
import { createDriverBillingSettlement } from '../services/driver-billing.service';

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

async function processAllDrivers(): Promise<void> {
  const drivers = await prisma.driver.findMany({
    where: { status: { in: ['ACTIVE', 'INACTIVE'] } },
    select: { id: true },
  });

  console.log(`[DriverBillingCutoffJob] Found ${drivers.length} drivers to process.`);

  for (const driver of drivers) {
    try {
      const settlement = await createDriverBillingSettlement(prisma, driver.id);
      if (settlement) {
        console.log(`[DriverBillingCutoffJob] Created settlement ${settlement.reference} for driver ${driver.id}. Amount: $${settlement.amount}`);
      } else {
        console.log(`[DriverBillingCutoffJob] No debt for driver ${driver.id}. Skipped.`);
      }
    } catch (error) {
      console.error(`[DriverBillingCutoffJob] Failed to create settlement for driver ${driver.id}:`, error);
    }
  }
}

async function catchUpMissedCuts(): Promise<void> {
  const cutoff = new Date(Date.now() - MS_PER_WEEK);
  const overdue = await prisma.driver.findMany({
    where: {
      status: { in: ['ACTIVE', 'INACTIVE'] },
      OR: [
        { lastBillingSettledAt: null },
        { lastBillingSettledAt: { lt: cutoff } },
      ],
    },
    select: { id: true },
  });

  if (overdue.length === 0) return;

  console.log(`[DriverBillingCutoffJob] Catch-up: ${overdue.length} driver(s) missed a weekly cut. Processing...`);
  for (const driver of overdue) {
    try {
      const settlement = await createDriverBillingSettlement(prisma, driver.id);
      if (settlement) {
        console.log(`[DriverBillingCutoffJob] Catch-up: Created settlement ${settlement.reference} for driver ${driver.id}. Amount: $${settlement.amount}`);
      } else {
        console.log(`[DriverBillingCutoffJob] Catch-up: No debt for driver ${driver.id}. Skipped.`);
      }
    } catch (error) {
      console.error(`[DriverBillingCutoffJob] Catch-up: Failed to create settlement for driver ${driver.id}:`, error);
    }
  }
}

export function startDriverBillingCutoffJob(): Promise<void> {
  // Periodic catch-up every 30 minutes
  cron.schedule('*/30 * * * *', async () => {
    try {
      await catchUpMissedCuts();
    } catch (error) {
      console.error('[DriverBillingCutoffJob] Health check failed:', error);
    }
  });

  // Run every Sunday at 11:59 PM
  cron.schedule('59 23 * * 0', async () => {
    console.log('[DriverBillingCutoffJob] Starting weekly driver billing cut-off...');
    try {
      await processAllDrivers();
      console.log('[DriverBillingCutoffJob] Weekly driver billing cut-off completed.');
    } catch (error) {
      console.error('[DriverBillingCutoffJob] Critical error in driver billing cut-off job:', error);
    }
  });

  console.log('[DriverBillingCutoffJob] Scheduled for every Sunday at 11:59 PM. Health check every 30 min.');

  return catchUpMissedCuts().then(() => {
    console.log('[DriverBillingCutoffJob] Startup catch-up check complete.');
  });
}
