import cron from 'node-cron';
import { prisma } from '../config/database';

async function processOverdueSettlements() {
  console.log('[BillingOverdueJob] Starting overdue settlements check...');

  try {
    const now = new Date();

    // === STEP 1: Mark PENDING settlements past due as OVERDUE and suspend restaurants ===
    const pendingOverdue = await prisma.restaurantBillingSettlement.findMany({
      where: {
        status: 'PENDING',
        dueDate: { lte: now },
      },
      select: {
        id: true,
        reference: true,
        restaurantId: true,
        restaurant: { select: { name: true, status: true } },
      },
    });

    console.log(`[BillingOverdueJob] Found ${pendingOverdue.length} PENDING settlements past due.`);

    for (const settlement of pendingOverdue) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.restaurantBillingSettlement.update({
            where: { id: settlement.id },
            data: { status: 'OVERDUE' },
          });

          const restaurant = await tx.restaurant.findUnique({
            where: { id: settlement.restaurantId },
            select: { status: true },
          });

          if (restaurant && restaurant.status === 'ACTIVE') {
            await tx.restaurant.update({
              where: { id: settlement.restaurantId },
              data: {
                status: 'SUSPENDED',
                statusReason: `Suspensión automática por pago vencido. Corte: ${settlement.reference}`,
                statusChangedAt: new Date(),
                statusChangedBy: 'SYSTEM_BILLING_OVERDUE',
                isAcceptingOrders: false,
              },
            });
            console.log(`[BillingOverdueJob] Suspended restaurant ${settlement.restaurant.name} (${settlement.restaurantId}).`);
          }
        });
      } catch (error) {
        console.error(`[BillingOverdueJob] Failed to process settlement ${settlement.reference}:`, error);
      }
    }

    // === STEP 2: Data repair — OVERDUE settlements whose restaurant is still ACTIVE ===
    const overdueSettlements = await prisma.restaurantBillingSettlement.findMany({
      where: { status: 'OVERDUE' },
      select: {
        id: true,
        reference: true,
        restaurantId: true,
        restaurant: { select: { name: true, status: true } },
      },
    });

    const activeWithOverdue = overdueSettlements.filter(s => s.restaurant.status === 'ACTIVE');
    if (activeWithOverdue.length > 0) {
      console.log(`[BillingOverdueJob] Repair: ${activeWithOverdue.length} restaurant(s) ACTIVE with OVERDUE settlements.`);
    }

    for (const settlement of activeWithOverdue) {
      try {
        await prisma.$transaction(async (tx) => {
          const restaurant = await tx.restaurant.findUnique({
            where: { id: settlement.restaurantId },
            select: { status: true },
          });
          if (restaurant && restaurant.status === 'ACTIVE') {
            await tx.restaurant.update({
              where: { id: settlement.restaurantId },
              data: {
                status: 'SUSPENDED',
                statusReason: `Suspensión automática por pago vencido. Corte: ${settlement.reference}`,
                statusChangedAt: new Date(),
                statusChangedBy: 'SYSTEM_BILLING_OVERDUE',
                isAcceptingOrders: false,
              },
            });
            console.log(`[BillingOverdueJob] (Repair) Suspended restaurant ${settlement.restaurant.name} (${settlement.restaurantId}).`);
          }
        });
      } catch (error) {
        console.error(`[BillingOverdueJob] Failed repair for settlement ${settlement.reference}:`, error);
      }
    }

    console.log('[BillingOverdueJob] Overdue check completed.');
  } catch (error) {
    console.error('[BillingOverdueJob] Critical error:', error);
  }
}

export function startBillingOverdueJob() {
  // Run immediately on startup to catch any existing data inconsistencies
  processOverdueSettlements();

  // Schedule: daily at midnight
  cron.schedule('0 0 * * *', () => {
    processOverdueSettlements();
  });

  console.log('[BillingOverdueJob] Scheduled daily at midnight + immediate startup run.');
}
