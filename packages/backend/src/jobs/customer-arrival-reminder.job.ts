import cron from 'node-cron';
import { FastifyInstance } from 'fastify';
import { OrderStatus } from '@prisma/client';
import { prisma } from '../config/database';
import { sendPushNotification } from '../services/notification.service';
import { emitNotification } from '../services/socket.service';
import { logger } from '../utils/logger';

const REMINDER_AFTER_MS = 5 * 60 * 1000;

export function startCustomerArrivalReminderJob(fastify: FastifyInstance) {
  cron.schedule('*/30 * * * * *', async () => {
    try {
      const now = new Date();
      const threshold = new Date(now.getTime() - REMINDER_AFTER_MS);

      const pendingArrivals = await prisma.order.findMany({
        where: {
          status: OrderStatus.IN_TRANSIT,
          driverArrivedAtCustomer: { not: null, lte: threshold },
          lastArrivalReminderSentAt: null,
        },
        select: {
          id: true,
          orderReference: true,
          driverArrivedAtCustomer: true,
          restaurant: {
            select: { name: true },
          },
          customer: {
            select: { userId: true },
          },
        },
      });

      let sentCount = 0;

      for (const order of pendingArrivals) {
        if (!order.customer?.userId || !order.driverArrivedAtCustomer) continue;

        const minutesWaiting = Math.round(
          (now.getTime() - order.driverArrivedAtCustomer.getTime()) / 60000
        );

        try {
          await sendPushNotification(order.customer.userId, {
            title: '📦 Tu repartidor ya está en tu puerta',
            body: `El repartidor lleva ${minutesWaiting} min esperándote en tu punto de entrega. Sal a recibir tu pedido de ${order.restaurant.name}. 🙌`,
            data: {
              orderId: order.id,
              orderReference: order.orderReference,
              event: 'order:arrival-reminder',
              url: `/?orderId=${order.id}`,
            },
            tag: `arrival-reminder-${order.id}`,
            requireInteraction: true,
            vibrate: [300, 100, 300, 100, 500],
          });

          emitNotification(
            fastify.io,
            order.customer.userId,
            'CUSTOMER',
            'order:arrival-reminder',
            { orderId: order.id, orderReference: order.orderReference },
            { requestId: 'cron-arrival-reminder', orderId: order.id }
          );

          await prisma.order.update({
            where: { id: order.id },
            data: { lastArrivalReminderSentAt: now },
          });

          logger.info(`[CustomerArrivalReminder] Recordatorio enviado al cliente ${order.customer.userId} para pedido ${order.id} (${minutesWaiting} min espera)`);
          sentCount++;
        } catch (err) {
          logger.error(`[CustomerArrivalReminder] Error al enviar recordatorio para pedido ${order.id}:`, err);
        }
      }

      if (sentCount > 0) {
        logger.info(`[CustomerArrivalReminder] ${sentCount} recordatorios enviados a clientes.`);
      }
    } catch (error) {
      logger.error('[CustomerArrivalReminder] Error crítico ejecutando job:', error);
    }
  });

  logger.info('[CustomerArrivalReminder] Tarea programada iniciada (cada 30 segundos). Recordatorio a clientes con repartidor en el punto de entrega desde hace 5+ min.');
}
