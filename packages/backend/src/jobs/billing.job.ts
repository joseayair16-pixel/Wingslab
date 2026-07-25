import cron from 'node-cron';
import { prisma } from '../config/database';
import { createBillingSettlement } from '../services/restaurant-billing.service';

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

async function processAllRestaurants(): Promise<void> {
  const restaurants = await prisma.restaurant.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, name: true },
  });

  console.log(`[BillingJob] Found ${restaurants.length} active restaurants to process.`);

  for (const restaurant of restaurants) {
    try {
      console.log(`[BillingJob] Processing ${restaurant.name} (${restaurant.id})...`);
      await createBillingSettlement(restaurant.id);
      console.log(`[BillingJob] Successfully created settlement for ${restaurant.name}.`);
    } catch (error) {
      console.error(`[BillingJob] Failed to create settlement for ${restaurant.name}:`, error);
    }
  }
}

async function catchUpMissedCuts(): Promise<void> {
  const cutoff = new Date(Date.now() - MS_PER_WEEK);
  const overdue = await prisma.restaurant.findMany({
    where: {
      status: 'ACTIVE',
      OR: [
        { lastBillingSettledAt: null },
        { lastBillingSettledAt: { lt: cutoff } },
      ],
    },
    select: { id: true, name: true },
  });

  if (overdue.length === 0) return;

  console.log(`[BillingJob] Catch-up: ${overdue.length} restaurant(s) missed a weekly cut. Processing...`);
  for (const restaurant of overdue) {
    try {
      console.log(`[BillingJob] Catch-up: Processing ${restaurant.name} (${restaurant.id})...`);
      await createBillingSettlement(restaurant.id);
      console.log(`[BillingJob] Catch-up: Successfully created settlement for ${restaurant.name}.`);
    } catch (error) {
      console.error(`[BillingJob] Catch-up: Failed to create settlement for ${restaurant.name}:`, error);
    }
  }
}

export function startBillingJob() {
  // Periodic catch-up: every 30 minutes, check if any restaurant missed a weekly cut.
  // This ensures that even if the server was down on Sunday at 23:59, the cut is
  // recovered within 30 minutes of restarting — no matter what day it is.
  cron.schedule('*/30 * * * *', async () => {
    try {
      await catchUpMissedCuts();
    } catch (error) {
      console.error('[BillingJob] Health check failed:', error);
    }
  });

  // Run every Sunday at 11:59 PM for the exact scheduled cut
  cron.schedule('59 23 * * 0', async () => {
    console.log('[BillingJob] Starting weekly billing cut-off...');
    try {
      await processAllRestaurants();
      console.log('[BillingJob] Weekly billing cut-off completed.');
    } catch (error) {
      console.error('[BillingJob] Critical error in billing job:', error);
    }
  });

  // Also run once immediately at startup to catch up on cuts missed while the server was off
  catchUpMissedCuts().then(() => {
    console.log('[BillingJob] Startup catch-up check complete.');
  });

  console.log('[BillingJob] Scheduled for every Sunday at 11:59 PM. Health check every 30 min.');
}
