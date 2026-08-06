import cron from 'node-cron';
import { prisma } from '../config/database';
import { sendWhatsAppThankYou } from '../services/whatsapp.service';

const THANK_YOU_DELAY_MS = 5 * 60 * 1000; // 5+ minutes after delivery
const THANK_YOU_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // only retry deliveries up to 7 days old
const BATCH_SIZE = 30;

async function isThankYouEnabled(): Promise<boolean> {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: 'customerThankYouWhatsappEnabled' },
  });
  return setting?.value === 'true';
}

async function processThankYouMessages() {
  const enabled = await isThankYouEnabled();
  const cutoff = new Date(Date.now() - THANK_YOU_DELAY_MS);

  const orders = await prisma.order.findMany({
    where: {
      status: { in: ['DELIVERED', 'COMPLETED'] },
      deliveredAt: { lte: cutoff, gte: new Date(Date.now() - THANK_YOU_WINDOW_MS) },
      whatsappThankYouSentAt: null,
      whatsappThankYouSkippedAt: null,
    },
    include: {
      customer: {
        select: { user: { select: { phone: true, name: true } } },
      },
    },
    orderBy: { deliveredAt: 'asc' },
    take: BATCH_SIZE,
  });

  for (const order of orders) {
    if (!enabled || !order.customer.user.phone) {
      // Toggle OFF or no phone → the customer will never receive it.
      await prisma.order.update({
        where: { id: order.id },
        data: { whatsappThankYouSkippedAt: new Date() },
      });
      continue;
    }

    try {
      const result = await sendWhatsAppThankYou({
        customerPhone: order.customer.user.phone,
        customerName: order.customer.user.name,
        orderReference: order.orderReference,
      });
      if (result.sent) {
        await prisma.order.update({
          where: { id: order.id },
          data: { whatsappThankYouSentAt: new Date() },
        });
      }
      // If the template is still pending/not approved, leave the order unmarked
      // so it is retried once the template becomes available.
    } catch (error) {
      console.error(`[ThankYouMessages] Error order ${order.id}:`, error);
    }
  }
}

export function startThankYouMessagesJob() {
  cron.schedule('* * * * *', () => {
    processThankYouMessages().catch((err) =>
      console.error('[ThankYouMessages] Critical error:', err)
    );
  });
  console.log('[ThankYouMessages] Programado: cada minuto a partir de 5 min tras la entrega.');
}