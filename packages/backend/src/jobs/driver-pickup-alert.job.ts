import cron from 'node-cron';
import { FastifyInstance } from 'fastify';
import { OrderStatus } from '@prisma/client';
import { prisma } from '../config/database';
import { sendPushNotification } from '../services/notification.service';
import { logger } from '../utils/logger';

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const MIN_ALERT_INTERVAL_MS = 2 * 60 * 1000;

export function startDriverPickupAlertJob(_fastify: FastifyInstance) {
  cron.schedule('*/30 * * * * *', async () => {
    try {
      const now = new Date();
      const cutoff = new Date(now.getTime() - FIVE_MINUTES_MS);

      const lateOrders = await prisma.order.findMany({
        where: {
          readyAt: { not: null, lt: cutoff },
          status: OrderStatus.READY,
          // Sin repartidor SaDeL asignado aún (o con repartidor que no ha llegado):
          // cubre tanto a un conductor SaDeL como al personal del restaurante
          // (reparto propio/apoyo) que aún no recoge el pedido listo.
          driverArrivedAt: null,
        },
        include: {
          restaurant: {
            select: { userId: true, name: true, hasOwnDelivery: true },
          },
          driver: {
            select: { userId: true },
          },
          supportRestaurant: {
            select: { userId: true, name: true },
          },
          DeliveryToken: true,
        },
      });

      if (lateOrders.length === 0) return;

      for (const order of lateOrders) {
        const minutesLate = Math.floor((now.getTime() - order.readyAt!.getTime()) / 60000);

        if (order.lastPickupAlertedAt) {
          const elapsedSinceLastAlert = now.getTime() - order.lastPickupAlertedAt.getTime();
          if (elapsedSinceLastAlert < MIN_ALERT_INTERVAL_MS) continue;
        }

        // Destinatario de la alerta:
        //  - SaDeL: el conductor asignado (order.driver).
        //  - Reparto propio/apoyo: el restaurante que realiza la entrega
        //    (aliado si hay supportRestaurantId, si no el propio restaurante).
        const driverUserId = order.driver?.userId;
        const isOwnOrSupport =
          order.deliveredByRestaurant ||
          Boolean(order.supportRestaurantId) ||
          Boolean(order.DeliveryToken);
        const recipientUserId =
          driverUserId ||
          (isOwnOrSupport
            ? (order.supportRestaurant?.userId ?? order.restaurant?.userId)
            : undefined);
        if (!recipientUserId) continue;

        const delivererName = driverUserId
          ? 'repartidor'
          : (order.supportRestaurant?.name ?? order.restaurant?.name) || 'repartidor';

        const alertTitle = minutesLate >= 10
          ? '📦 Pedido esperando por ti'
          : minutesLate >= 7
            ? '🕐 Tu pedido está listo'
            : '✅ Pedido listo para recoger';

        const alertBody = minutesLate >= 10
          ? `El pedido de ${order.restaurant.name} te espera hace ${minutesLate} min. El cliente agradecerá tu pronta llegada.`
          : `El pedido de ${order.restaurant.name} está listo. Cuando puedas, pasa a recogerlo.`;

        try {
          await sendPushNotification(recipientUserId, {
            title: alertTitle,
            body: alertBody,
            icon: '/app-icon-192.png',
            badge: '/badge.png',
            vibrate: [1000, 300, 1000, 300, 1000],
            requireInteraction: true,
            data: {
              orderId: order.id,
              event: 'order:pickup-alert',
              url: `/?orderId=${order.id}`,
            },
          });

          await prisma.order.update({
            where: { id: order.id },
            data: { lastPickupAlertedAt: now },
          });

          logger.info(`[DriverPickupAlert] Alerta enviada a ${recipientUserId} para pedido ${order.id} (${minutesLate} min tarde, ${delivererName})`);
        } catch (pushErr) {
          logger.error(`[DriverPickupAlert] Error enviando alerta a ${recipientUserId} para pedido ${order.id}:`, pushErr);
        }
      }
    } catch (error) {
      logger.error('[DriverPickupAlert] Error crítico ejecutando job:', error);
    }
  });

  logger.info('[DriverPickupAlert] Tarea programada iniciada (cada 30 segundos). Alerta a repartidores (SaDeL, propio y apoyo) con 5+ min de retraso en recogida.');
}
