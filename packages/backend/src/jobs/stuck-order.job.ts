import cron from 'node-cron';
import { FastifyInstance } from 'fastify';
import { prisma } from '../config/database';
import { sendPushNotification } from '../services/notification.service';
import { emitNotification } from '../services/socket.service';
import { logger } from '../utils/logger';

const PICKUP_STUCK_MIN = 15;
const TRANSIT_OVERDUE_MIN = 15;
const ESCALATION_INTERVAL_MIN = 5;
const POLL_INTERVAL_SEC = 30;
const PUSH_ICON_URL = process.env.PUSH_ICON_URL || '/icon.png';

export function startStuckOrderJob(fastify: FastifyInstance) {
  cron.schedule(`*/${POLL_INTERVAL_SEC} * * * * *`, async () => {
    try {
      const now = new Date();
      const pickupCutoff = new Date(now.getTime() - PICKUP_STUCK_MIN * 60 * 1000);
      const transitCutoff = new Date(now.getTime() - TRANSIT_OVERDUE_MIN * 60 * 1000);

      const baseInclude = {
        driver: { select: { userId: true, user: { select: { name: true } } } },
        restaurant: { select: { id: true, userId: true, name: true } },
        customer: { select: { userId: true, user: { select: { name: true, phone: true } } } },
      };

      const [stuckPickup, stuckTransit] = await Promise.all([
        prisma.order.findMany({
          where: { status: 'PICKED_UP' as any, pickedUpAt: { lt: pickupCutoff } },
          include: baseInclude,
          take: 100,
        }),
        prisma.order.findMany({
          where: { status: 'IN_TRANSIT' as any, estimatedDeliveryTime: { lt: transitCutoff } },
          include: baseInclude,
          take: 100,
        }),
      ]);

      const allStuck: any[] = [...stuckPickup, ...stuckTransit];
      if (allStuck.length === 0) return;

      for (const order of allStuck) {
        try {
          if (!order.driver) continue;

          const currentLevel = order.stuckAlertLevel || 0;
          const lastAlerted: Date | null = order.stuckAlertedAt || null;
          const minsSinceLastAlert = lastAlerted
            ? (now.getTime() - lastAlerted.getTime()) / 60000
            : Infinity;

          if (minsSinceLastAlert < ESCALATION_INTERVAL_MIN) continue;

          const minutesStuck = order.status === 'PICKED_UP'
            ? Math.floor((now.getTime() - new Date(order.pickedUpAt).getTime()) / 60000)
            : Math.floor((now.getTime() - new Date(order.estimatedDeliveryTime).getTime()) / 60000);

          const nextLevel = currentLevel + 1;

          if (currentLevel === 0) {
            await sendPushNotification(order.driver.userId, {
              title: '⚠️ ¿Problemas con la entrega?',
              body: order.status === 'PICKED_UP'
                ? `Recogiste el pedido de ${order.restaurant.name} hace ${minutesStuck} min pero no has salido a ruta. ¿Necesitas ayuda?`
                : `Llevas ${minutesStuck} min de retraso entregando el pedido de ${order.restaurant.name}. Contacta a soporte.`,
              icon: PUSH_ICON_URL,
              badge: PUSH_ICON_URL,
              vibrate: [500, 200, 500, 200, 500],
              requireInteraction: true,
              data: { orderId: order.id, event: 'order:delivery-stuck', url: `/?orderId=${order.id}` },
            });

            emitNotification(fastify.io, order.driver.userId, 'DRIVER', 'order:delivery-stuck', {
              orderId: order.id,
              orderReference: order.orderReference,
              restaurantName: order.restaurant.name,
              minutesStuck,
              level: nextLevel,
            });

            await prisma.order.update({ where: { id: order.id }, data: { stuckAlertLevel: nextLevel, stuckAlertedAt: now } as any });

            logger.info(`[StuckOrder] Nivel 1: driver ${order.driver.userId} - pedido ${order.id} (${minutesStuck} min)`);
          } else if (currentLevel === 1) {
            await sendPushNotification(order.driver.userId, {
              title: '🔴 Entrega Detenida — Acción Requerida',
              body: `Tu entrega de ${order.restaurant.name} está detenida. Contacta a soporte inmediatamente.`,
              icon: PUSH_ICON_URL,
              badge: PUSH_ICON_URL,
              vibrate: [1000, 300, 1000, 300, 1000],
              requireInteraction: true,
              data: { orderId: order.id, event: 'order:delivery-stuck', url: `/?orderId=${order.id}` },
            });

            emitNotification(fastify.io, order.restaurant.userId, 'RESTAURANT', 'order:delivery-stuck-restaurant', {
              orderId: order.id,
              orderReference: order.orderReference,
              driverName: order.driver.user.name,
              minutesStuck,
            });

            try {
              const existing = await (prisma as any).supportTicket.findFirst({
                where: { orderId: order.id, status: { in: ['PENDING', 'IN_PROGRESS'] } },
              });
              if (!existing) {
                await (prisma as any).supportTicket.create({
                  data: {
                    orderId: order.id,
                    type: 'ORDER',
                    status: 'PENDING',
                    title: `Entrega detenida - Pedido ${order.orderReference}`,
                    description: `Repartidor ${order.driver.user.name} - Pedido ${order.orderReference} de ${order.restaurant.name} - ${order.status === 'PICKED_UP' ? `Recogido hace ${minutesStuck} min sin salir a ruta` : `${minutesStuck} min de retraso en entrega`} - Cliente: ${order.customer?.user?.name || 'N/A'}`,
                    createdBy: 'system',
                  },
                });
              }
            } catch (ticketErr) {
              logger.warn(`[StuckOrder] Error al crear ticket de soporte para ${order.id}:`, ticketErr);
            }

            await prisma.order.update({ where: { id: order.id }, data: { stuckAlertLevel: nextLevel, stuckAlertedAt: now } as any });

            logger.info(`[StuckOrder] Nivel 2: restaurante + ticket - pedido ${order.id}`);
          } else {
            emitNotification(fastify.io, order.restaurant.userId, 'RESTAURANT', 'order:delivery-escalated', {
              orderId: order.id,
              orderReference: order.orderReference,
              driverName: order.driver.user.name,
              minutesStuck,
              level: nextLevel,
            });

            await prisma.order.update({ where: { id: order.id }, data: { stuckAlertedAt: now } as any });

            logger.info(`[StuckOrder] Nivel ${nextLevel}: re-notificación - pedido ${order.id}`);
          }
        } catch (orderErr) {
          logger.error(`[StuckOrder] Error procesando pedido ${order.id}:`, orderErr);
        }
      }
    } catch (error) {
      logger.error('[StuckOrder] Error crítico:', error);
    }
  });

  logger.info(`[StuckOrder] Job iniciado (c/${POLL_INTERVAL_SEC}s). PICKED_UP>${PICKUP_STUCK_MIN}min | IN_TRANSIT+${TRANSIT_OVERDUE_MIN}min post-ETA`);
}
