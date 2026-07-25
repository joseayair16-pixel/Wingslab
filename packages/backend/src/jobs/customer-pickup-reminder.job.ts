import cron from 'node-cron';
import { FastifyInstance } from 'fastify';
import { OrderStatus } from '@prisma/client';
import { prisma } from '../config/database';
import { sendPushNotification } from '../services/notification.service';
import { emitNotification } from '../services/socket.service';
import { logger } from '../utils/logger';

const INTERVAL_BETWEEN_REMINDERS_MS = 5 * 60 * 1000;
const FIRST_REMINDER_AFTER_MS = 10 * 60 * 1000;

export function startCustomerPickupReminderJob(fastify: FastifyInstance) {
  cron.schedule('*/30 * * * * *', async () => {
    try {
      const now = new Date();
      const earliestReady = new Date(now.getTime() - FIRST_REMINDER_AFTER_MS);

      const readyOrders = await prisma.order.findMany({
        where: {
          fulfillmentType: 'PICKUP',
          status: OrderStatus.READY,
          readyAt: { not: null, lte: earliestReady },
        },
        select: {
          id: true,
          orderReference: true,
          readyAt: true,
          lastPickupAlertedAt: true,
          restaurant: {
            select: { name: true },
          },
          customer: {
            select: { userId: true },
          },
        },
      });

      let sentCount = 0;

      for (const order of readyOrders) {
        if (!order.customer?.userId || !order.readyAt) continue;

        if (order.lastPickupAlertedAt) {
          const elapsedSinceLastAlert = now.getTime() - order.lastPickupAlertedAt.getTime();
          if (elapsedSinceLastAlert < INTERVAL_BETWEEN_REMINDERS_MS) continue;
        }

        const minutesSinceReady = Math.round((now.getTime() - order.readyAt.getTime()) / 60000);

        let title: string;
        let body: string;

        if (minutesSinceReady >= 30) {
          title = '⏰ ¡Tu pedido te está esperando!';
          body = `Han pasado ${minutesSinceReady} min desde que tu pedido en ${order.restaurant.name} está listo. Pasa a recogerlo para que no se enfríe.`;
        } else if (minutesSinceReady >= 20) {
          title = '🔔 Pedido listo - No olvides pasar';
          body = `Tu pedido en ${order.restaurant.name} lleva 20 min esperándote. ¡Pasa a recogerlo!`;
        } else if (minutesSinceReady >= 15) {
          title = '⏳ Sigue listo para recoger';
          body = `Tu pedido en ${order.restaurant.name} ya está listo desde hace 15 min. Acércate a recogerlo.`;
        } else {
          title = '🛍️ ¡Tu pedido ya está listo!';
          body = `Tu pedido en ${order.restaurant.name} está esperando por ti. Pasa a recogerlo.`;
        }

        try {
          await sendPushNotification(order.customer.userId, {
            title,
            body,
            data: {
              orderId: order.id,
              orderReference: order.orderReference,
              event: 'order:pickup-reminder',
              url: `/?orderId=${order.id}`,
            },
            tag: `pickup-reminder-${order.id}`,
            requireInteraction: true,
            vibrate: [500, 250, 500, 250, 500],
          });

          emitNotification(
            fastify.io,
            order.customer.userId,
            'CUSTOMER',
            'order:pickup-reminder',
            { orderId: order.id, orderReference: order.orderReference },
            { requestId: 'cron-pickup-reminder', orderId: order.id }
          );

          await prisma.order.update({
            where: { id: order.id },
            data: { lastPickupAlertedAt: now },
          });

          logger.info(`[CustomerPickupReminder] Recordatorio enviado al cliente ${order.customer.userId} para pedido ${order.id} (${minutesSinceReady} min listo)`);
          sentCount++;
        } catch (err) {
          logger.error(`[CustomerPickupReminder] Error al enviar recordatorio para pedido ${order.id}:`, err);
        }
      }

      if (sentCount > 0) {
        logger.info(`[CustomerPickupReminder] ${sentCount} recordatorios enviados a clientes.`);
      }
    } catch (error) {
      logger.error('[CustomerPickupReminder] Error crítico ejecutando job:', error);
    }
  });

  logger.info('[CustomerPickupReminder] Tarea programada iniciada (cada 30 segundos). Recordatorios a clientes con pickup listo desde hace 10+ min.');
}
