import cron from 'node-cron';
import { FastifyInstance } from 'fastify';
import { OrderStatus } from '@prisma/client';
import { prisma } from '../config/database';
import { sendPushNotification } from '../services/notification.service';
import { emitNotification } from '../services/socket.service';
import { logger } from '../utils/logger';
import { getBusinessRef } from '../utils/restaurant';

const REMINDER_WINDOW_MIN = 15;
const PUSH_ICON_URL = process.env.PUSH_ICON_URL || '/icon.png';

export function startScheduledDeliveryReminderJob(fastify: FastifyInstance) {
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();
      const from = now;
      const until = new Date(now.getTime() + REMINDER_WINDOW_MIN * 60 * 1000);

      const orders = await prisma.order.findMany({
        where: {
          status: { in: [OrderStatus.CONFIRMED, OrderStatus.PREPARING] },
          scheduledDeliveryAt: { gte: from, lte: until },
          scheduledReminderSentAt: null,
        },
        select: {
          id: true,
          orderReference: true,
          dailyCounter: true,
          fulfillmentType: true,
          scheduledDeliveryAt: true,
          restaurant: {
            select: { id: true, userId: true, name: true, businessType: true },
          },
          customer: {
            select: {
              userId: true,
              user: { select: { id: true } },
            },
          },
        },
        take: 100,
      });

      if (orders.length === 0) return;

      for (const order of orders) {
        try {
          if (!order.restaurant) continue;

          const isPickup = order.fulfillmentType === 'PICKUP';
          const orderRef = order.dailyCounter
            ? `#${String(order.dailyCounter).padStart(2, '0')}`
            : order.orderReference || '';
          const timeLabel = order.scheduledDeliveryAt
            ? new Date(order.scheduledDeliveryAt).toLocaleTimeString('es-MX', {
                hour: '2-digit',
                minute: '2-digit',
              })
            : '';
          const businessRef = getBusinessRef(order.restaurant.businessType);

          // Marcar antes de enviar para evitar duplicados si el envío se
          // reintenta (idempotencia dentro de la ventana del cron).
          await prisma.order.update({
            where: { id: order.id },
            data: { scheduledReminderSentAt: now },
          });

          await sendPushNotification(order.restaurant.userId, {
            title: isPickup ? '🛍️ Recogida programada en 15 min' : '⏰ Entrega programada en 15 min',
            body: isPickup
              ? `Pedido ${orderRef}: un cliente pasará a recoger a las ${timeLabel}. Tenlo listo o reprograma si es necesario.`
              : `Pedido ${orderRef}: tienes una entrega acordada a las ${timeLabel}. Prepáralo o reprograma si es necesario.`,
            icon: PUSH_ICON_URL,
            badge: PUSH_ICON_URL,
            tag: `scheduled-reminder-${order.id}`,
            vibrate: [500, 200, 500],
            requireInteraction: true,
            data: {
              orderId: order.id,
              event: 'order:scheduled-reminder',
              url: `/pedidos?orderId=${order.id}`,
            },
          });

          emitNotification(
            fastify.io,
            order.restaurant.userId,
            'RESTAURANT',
            'order:scheduled-reminder',
            {
              orderId: order.id,
              orderReference: orderRef,
              scheduledAt: order.scheduledDeliveryAt,
              minutesLeft: REMINDER_WINDOW_MIN,
              fulfillmentType: order.fulfillmentType,
            }
          );

          // Avisar también al comensal: su entrega/recogida se acerca.
          const customerUserId = order.customer?.user?.id || order.customer?.userId;
          if (customerUserId) {
            await sendPushNotification(customerUserId, {
              title: isPickup ? '🛍️ Recogida programada · 15 min' : '⏰ Tu entrega está cerca',
              body: isPickup
                ? `Tu pedido ${orderRef} en ${order.restaurant.name} está programado para recogerse a las ${timeLabel}. Acércate a tiempo.`
                : `Tu pedido ${orderRef} de ${order.restaurant.name} está programado para llegar a las ${timeLabel}.`,
              icon: PUSH_ICON_URL,
              badge: PUSH_ICON_URL,
              tag: `scheduled-reminder-customer-${order.id}`,
              vibrate: [300, 100, 300],
              requireInteraction: false,
              data: {
                orderId: order.id,
                event: 'order:scheduled-upcoming',
                url: `/?orderId=${order.id}`,
              },
            }).catch((custErr) => {
              logger.warn(
                `[ScheduledDeliveryReminder] Error al notificar al comensal ${customerUserId}:`,
                custErr
              );
            });

            emitNotification(
              fastify.io,
              customerUserId,
              'CUSTOMER',
              'order:scheduled-upcoming',
              {
                orderId: order.id,
                orderReference: orderRef,
                scheduledAt: order.scheduledDeliveryAt,
                minutesLeft: REMINDER_WINDOW_MIN,
                fulfillmentType: order.fulfillmentType,
              }
            );
          }

          logger.info(
            `[ScheduledDeliveryReminder] Recordatorio previo enviado para pedido ${order.id} (${orderRef}) a ${businessRef}.`
          );
        } catch (orderErr) {
          logger.error(`[ScheduledDeliveryReminder] Error procesando pedido ${order.id}:`, orderErr);
        }
      }
    } catch (error) {
      logger.error('[ScheduledDeliveryReminder] Error crítico:', error);
    }
  });

  logger.info(`[ScheduledDeliveryReminder] Job iniciado (cada 1 min; ventana de ${REMINDER_WINDOW_MIN} min).`);
}