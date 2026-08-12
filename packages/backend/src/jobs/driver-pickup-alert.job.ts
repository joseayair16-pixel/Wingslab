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
          driverId: { not: null },
          driverArrivedAt: null,
          status: OrderStatus.READY,
        },
        include: {
          restaurant: {
            select: { name: true },
          },
          driver: {
            select: { userId: true },
          },
        },
      });

      if (lateOrders.length === 0) return;

      for (const order of lateOrders) {
        if (!order.driver?.userId) continue;

        const minutesLate = Math.floor((now.getTime() - order.readyAt!.getTime()) / 60000);

        if (order.lastPickupAlertedAt) {
          const elapsedSinceLastAlert = now.getTime() - order.lastPickupAlertedAt.getTime();
          if (elapsedSinceLastAlert < MIN_ALERT_INTERVAL_MS) continue;
        }

        const alertTitle = minutesLate >= 10
          ? '⚠️ Pedido esperando - Retraso crítico'
          : minutesLate >= 7
            ? '⏰ Pedido listo - Dirígete al restaurante'
            : '🕐 Pedido listo - Recógelo ahora';

        const alertBody = minutesLate >= 10
          ? `El pedido de ${order.restaurant.name} lleva ${minutesLate} min listo. Tu retraso está afectando el servicio. Dirígete al restaurante AHORA.`
          : `El pedido de ${order.restaurant.name} lleva ${minutesLate} min listo. Por favor pasa a recogerlo.`;

        try {
          await sendPushNotification(order.driver.userId, {
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

          logger.info(`[DriverPickupAlert] Alerta enviada al repartidor ${order.driver.userId} para pedido ${order.id} (${minutesLate} min tarde)`);
        } catch (pushErr) {
          logger.error(`[DriverPickupAlert] Error enviando alerta al repartidor ${order.driver.userId} para pedido ${order.id}:`, pushErr);
        }
      }
    } catch (error) {
      logger.error('[DriverPickupAlert] Error crítico ejecutando job:', error);
    }
  });

  logger.info('[DriverPickupAlert] Tarea programada iniciada (cada 30 segundos). Alerta a repartidores con 5+ min de retraso en recogida.');
}
