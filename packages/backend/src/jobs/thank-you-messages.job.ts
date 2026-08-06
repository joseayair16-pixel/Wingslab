import cron from 'node-cron';
import { prisma } from '../config/database';
import { sendWhatsAppThankYou } from '../services/whatsapp.service';

const THANK_YOU_DELAY_MS = 5 * 60 * 1000; // 5+ minutes after delivery
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
      deliveredAt: { lte: cutoff },
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
    const processedAt = new Date();
    if (!enabled || !order.customer.user.phone) {
      // Toggle OFF or no phone → the customer will never receive it.
      await prisma.order.update({
        where: { id: order.id },
        data: { whatsappThankYouSkippedAt: processedAt },
      });
      continue;
    }

    try {
      await sendWhatsAppThankYou({
        customerPhone: order.customer.user.phone,
        customerName: order.customer.user.name,
        orderReference: order.orderReference,
      });
    } catch (error) {
      console.error(`[ThankYouMessages] Error order ${order.id}:`, error);
    } finally {
      // Processed exactly once: mark sent after the attempt to avoid retries/floods.
      await prisma.order.update({
        where: { id: order.id },
        data: { whatsappThankYouSentAt: processedAt },
      });
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