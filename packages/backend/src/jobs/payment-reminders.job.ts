import cron from 'node-cron';
import { prisma } from '../config/database';
import {
  sendWhatsAppPaymentReminder,
  sendWhatsAppPaymentSuspended,
} from '../services/whatsapp.service';

// Mexico uses UTC-6 year-round (DST abolished in 2022).
function getMexicoParts(now: Date) {
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const mexico = new Date(utcMs - 6 * 3_600_000); // UTC-6
  return {
    day: mexico.getUTCDay(), // 0 = Sunday
    hours: mexico.getUTCHours(),
    minutes: mexico.getUTCMinutes(),
  };
}

function isWednesdayAfterNoon(now: Date): boolean {
  const { day, hours, minutes } = getMexicoParts(now);
  if (day !== 3 || hours < 12) return false;
  return hours > 12 || minutes >= 0;
}

function buildBalanceUrl(): string {
  const base = (process.env.RESTAURANT_PANEL_URL || process.env.WEBAPP_URL || '').replace(/\/+$/, '');
  return base ? `${base}/?section=billing` : '';
}

async function processReminders() {
  if (!isWednesdayAfterNoon(new Date())) return;

  const balanceUrl = buildBalanceUrl();

  // === Message 1: friendly payment reminder (PENDING debt, no proof uploaded) ===
  const pending = await prisma.restaurantBillingSettlement.findMany({
    where: {
      status: 'PENDING',
      paymentProofUrl: null,
      reminderSentAt: null,
    },
    include: {
      restaurant: { select: { id: true, name: true, contactPhone: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  for (const settlement of pending) {
    const phone = settlement.restaurant.contactPhone;
    if (!phone) continue;
    try {
      const result = await sendWhatsAppPaymentReminder({
        restaurantPhone: phone,
        restaurantName: settlement.restaurant.name,
        reference: settlement.reference,
        balanceUrl,
      });
      if (result.sent) {
        await prisma.restaurantBillingSettlement.update({
          where: { id: settlement.id },
          data: { reminderSentAt: new Date() },
        });
      }
    } catch (error) {
      console.error(`[PaymentReminders] Error reminder ${settlement.reference}:`, error);
    }
  }

  // === Message 2: suspended account (OVERDUE debt, no proof uploaded) ===
  const overdue = await prisma.restaurantBillingSettlement.findMany({
    where: {
      status: 'OVERDUE',
      paymentProofUrl: null,
      suspendedReminderSentAt: null,
      restaurant: { status: 'SUSPENDED' },
    },
    include: {
      restaurant: { select: { id: true, name: true, contactPhone: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  // Send at most once per restaurant: pick the earliest unmatched OVERDUE settlement.
  const seen = new Set<string>();
  for (const settlement of overdue) {
    const restaurantId = settlement.restaurantId;
    if (seen.has(restaurantId)) continue;
    seen.add(restaurantId);

    const phone = settlement.restaurant.contactPhone;
    if (!phone) continue;
    try {
      const result = await sendWhatsAppPaymentSuspended({
        restaurantPhone: phone,
        restaurantName: settlement.restaurant.name,
        reference: settlement.reference,
        balanceUrl,
      });
      if (result.sent) {
        await prisma.restaurantBillingSettlement.update({
          where: { id: settlement.id },
          data: { suspendedReminderSentAt: new Date() },
        });
      }
    } catch (error) {
      console.error(`[PaymentReminders] Error suspended ${settlement.reference}:`, error);
    }
  }
}

export function startPaymentRemindersJob() {
  // Check every 10 minutes; only acts on Wednesday >= 12:00 (America/Mexico_City).
  cron.schedule('*/10 * * * *', () => {
    processReminders().catch((err) =>
      console.error('[PaymentReminders] Critical error:', err)
    );
  });
  console.log('[PaymentReminders] Programado: miércoles a partir de las 12:00 (hora México).');
}