import cron from 'node-cron';
import { prisma } from '../config/database';
import { sendWhatsAppPaymentSuspended } from '../services/whatsapp.service';
import { claimNotification, releaseNotification } from '../services/payment-notification.guard';

function buildBalanceUrl(): string {
  const base = (process.env.RESTAURANT_PANEL_URL || process.env.WEBAPP_URL || '').replace(/\/+$/, '');
  return base ? `${base}/?section=billing` : '';
}

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
        restaurant: { select: { name: true, status: true, contactPhone: true } },
      },
    });

    console.log(`[BillingOverdueJob] Found ${pendingOverdue.length} PENDING settlements past due.`);

    for (const settlement of pendingOverdue) {
      const claimedAt = new Date();
      let claimed = false;
      try {
        await prisma.$transaction(async (tx) => {
          // Reclamación atómica: marca OVERDUE + bloquea la notificación en un
          // solo update; una 2a instancia no puede repetir el envío.
          const res = await tx.restaurantBillingSettlement.updateMany({
            where: {
              id: settlement.id,
              status: 'PENDING',
              suspendedReminderSentAt: null,
            },
            data: {
              status: 'OVERDUE',
              suspendedReminderSentAt: claimedAt,
            },
          });
          if (res.count === 0) return;
          claimed = true;

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

        if (claimed) {
          const result = await sendWhatsAppPaymentSuspended({
            restaurantPhone: settlement.restaurant.contactPhone || '',
            restaurantName: settlement.restaurant.name,
            reference: settlement.reference,
            balanceUrl: buildBalanceUrl(),
          });
          if (!result.sent) {
            await releaseNotification(prisma, settlement.id, 'suspendedReminderSentAt', claimedAt);
          }
        }
      } catch (error) {
        if (claimed) {
          await releaseNotification(prisma, settlement.id, 'suspendedReminderSentAt', claimedAt).catch(() => {});
        }
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
        restaurant: { select: { name: true, status: true, contactPhone: true } },
      },
    });

    const activeWithOverdue = overdueSettlements.filter(s => s.restaurant.status === 'ACTIVE');
    if (activeWithOverdue.length > 0) {
      console.log(`[BillingOverdueJob] Repair: ${activeWithOverdue.length} restaurant(s) ACTIVE with OVERDUE settlements.`);
    }

    for (const settlement of activeWithOverdue) {
      const claimedAt = new Date();
      try {
        let suspended = false;
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
            suspended = true;
            console.log(`[BillingOverdueJob] (Repair) Suspended restaurant ${settlement.restaurant.name} (${settlement.restaurantId}).`);
          }
        });

        if (suspended) {
          // Reparación no debe re-mensajear: solo notifica si este corte aún no fue avisado.
          const claimed = await claimNotification(prisma, settlement.id, 'suspendedReminderSentAt', claimedAt);
          if (!claimed) continue;
          const result = await sendWhatsAppPaymentSuspended({
            restaurantPhone: settlement.restaurant.contactPhone || '',
            restaurantName: settlement.restaurant.name,
            reference: settlement.reference,
            balanceUrl: buildBalanceUrl(),
          });
          if (!result.sent) {
            await releaseNotification(prisma, settlement.id, 'suspendedReminderSentAt', claimedAt);
          }
        }
      } catch (error) {
        await releaseNotification(prisma, settlement.id, 'suspendedReminderSentAt', claimedAt).catch(() => {});
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
