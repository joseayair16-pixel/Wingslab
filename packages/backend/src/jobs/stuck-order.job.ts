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
        supportRestaurant: { select: { id: true, userId: true, name: true } },
        DeliveryToken: true,
        restaurant: { select: { id: true, userId: true, name: true } },
        customer: { select: { userId: true, user: { select: { name: true, phone: true } } } },
      };

      const [stuckPickup, stuckTransitRaw] = await Promise.all([
        prisma.order.findMany({
          where: { status: 'PICKED_UP' as any, pickedUpAt: { lt: pickupCutoff } },
          include: baseInclude,
          take: 100,
        }),
        prisma.order.findMany({
          where: {
            status: 'IN_TRANSIT' as any,
            inTransitAt: { not: null },
            estimatedDeliveryTime: { lt: transitCutoff },
          },
          include: baseInclude,
          take: 200,
        }),
      ]);

      // Solo considerar entregas cuyo ETA fue recalculado al salir (mayor que la
      // salida). El ETA original del pedido (calculado al crearlo) puede estar
      // vencido antes de siquiera asignar repartidor: eso NO es retraso real.
      const stuckTransit = stuckTransitRaw.filter((order: any) => {
        if (!order.inTransitAt || !order.estimatedDeliveryTime) return false;
        return new Date(order.estimatedDeliveryTime).getTime() > new Date(order.inTransitAt).getTime();
      });

      const allStuck: any[] = [...stuckPickup, ...stuckTransit];
      if (allStuck.length === 0) return;

      const uniqueIds = (ids: (string | undefined)[]): string[] =>
        Array.from(new Set(ids.filter((id): id is string => Boolean(id))));

      for (const order of allStuck) {
        try {
          const currentLevel = order.stuckAlertLevel || 0;
          const lastAlerted: Date | null = order.stuckAlertedAt || null;
          const minsSinceLastAlert = lastAlerted
            ? (now.getTime() - lastAlerted.getTime()) / 60000
            : Infinity;

          if (minsSinceLastAlert < ESCALATION_INTERVAL_MIN) continue;

          const minutesStuck = order.status === 'PICKED_UP'
            ? Math.floor((now.getTime() - new Date(order.pickedUpAt).getTime()) / 60000)
            : (() => {
                // Retraso de entrega: excedente sobre el ETA recalculado cuando el
                // repartidor SALIÓ del restaurante. Nunca el ETA original del pedido
                // (calculado al crearlo), que puede ya estar vencido antes de asignar
                // repartidor y dispararía alertas falsas. El filtro ya garantiza que
                // estimatedDeliveryTime > inTransitAt (ETA recalculado).
                const etaOverrun = order.estimatedDeliveryTime
                  ? Math.floor((now.getTime() - new Date(order.estimatedDeliveryTime).getTime()) / 60000)
                  : 0;
                return Math.max(0, etaOverrun);
              })();

          // ── Destinatarios ──────────────────────────────────────────────
          // Reparto SaDeL: el conductor asignado (order.driver).
          // Reparto propio / apoyo a red: no hay conductor catalogado; entrega
          // el personal del restaurante (el aliado si hay supportRestaurantId).
          // Sin driver y sin flujo propio/apoyo, este pedido no aplica aquí.
          const driver = order.driver;
          const driverUserId = driver?.userId;
          const originUserId = order.restaurant?.userId;
          const aliadoUserId = order.supportRestaurant?.userId;
          const isOwnOrSupport =
            order.deliveredByRestaurant ||
            Boolean(order.supportRestaurantId) ||
            Boolean(order.DeliveryToken);
          if (!driverUserId && !isOwnOrSupport) continue;

          const delivererUserId = aliadoUserId || originUserId;
          const restaurantTargets = uniqueIds([originUserId, aliadoUserId]);
          const delivererName =
            driver?.user?.name ||
            (order.supportRestaurant?.name
              ? `Repartidor de ${order.supportRestaurant.name}`
              : order.restaurant?.name) ||
            'N/A';

          const nextLevel = currentLevel + 1;

          if (currentLevel === 0) {
            if (driverUserId) {
              await sendPushNotification(driverUserId, {
                title: '🕐 Tu entrega va más lenta de lo esperado',
                body: order.status === 'PICKED_UP'
                  ? `Recogiste el pedido de ${order.restaurant.name} hace ${minutesStuck} min y aún no inicias la ruta. ¿Necesitas ayuda con la dirección?`
                  : `El pedido de ${order.restaurant.name} va con ${minutesStuck} min de retraso. Si tienes un imprevisto, avísanos por soporte.`,
                icon: PUSH_ICON_URL,
                badge: PUSH_ICON_URL,
                vibrate: [500, 200, 500, 200, 500],
                requireInteraction: true,
                data: { orderId: order.id, event: 'order:delivery-stuck', url: `/?orderId=${order.id}` },
              });

              emitNotification(fastify.io, driverUserId, 'DRIVER', 'order:delivery-stuck', {
                orderId: order.id,
                orderReference: order.orderReference,
                restaurantName: order.restaurant.name,
                minutesStuck,
                level: nextLevel,
              });
            } else if (delivererUserId) {
              // Reparto propio / apoyo: sin conductor catalogado, se alerta al
              // restaurante cuyo personal está realizando la entrega.
              await sendPushNotification(delivererUserId, {
                title: '🕐 Entrega en curso con retraso',
                body: order.status === 'PICKED_UP'
                  ? `El pedido de ${order.restaurant.name} se recogió hace ${minutesStuck} min y aún no sale a ruta. Verifica con tu personal.`
                  : `Tu repartidor lleva ${minutesStuck} min de retraso entregando el pedido de ${order.restaurant.name}. ¿Puedes verificar la entrega?`,
                icon: PUSH_ICON_URL,
                badge: PUSH_ICON_URL,
                vibrate: [500, 200, 500, 200, 500],
                requireInteraction: true,
                data: { orderId: order.id, event: 'order:delivery-stuck', url: `/?orderId=${order.id}` },
              });

              emitNotification(fastify.io, delivererUserId, 'RESTAURANT', 'order:delivery-stuck', {
                orderId: order.id,
                orderReference: order.orderReference,
                restaurantName: order.restaurant.name,
                minutesStuck,
                level: nextLevel,
                isOwnDelivery: true,
              });
            }

            await prisma.order.update({ where: { id: order.id }, data: { stuckAlertLevel: nextLevel, stuckAlertedAt: now } as any });

            logger.info(`[StuckOrder] Nivel 1: ${driverUserId ? `driver ${driverUserId}` : `restaurante ${delivererUserId || '?'}`} - pedido ${order.id} (${minutesStuck} min)`);
          } else if (currentLevel === 1) {
            if (driverUserId) {
              await sendPushNotification(driverUserId, {
                title: '🔴 Entrega Detenida — Acción Requerida',
                body: `Tu entrega de ${order.restaurant.name} está detenida. Contacta a soporte inmediatamente.`,
                icon: PUSH_ICON_URL,
                badge: PUSH_ICON_URL,
                vibrate: [1000, 300, 1000, 300, 1000],
                requireInteraction: true,
                data: { orderId: order.id, event: 'order:delivery-stuck', url: `/?orderId=${order.id}` },
              });
            }

            for (const uid of restaurantTargets) {
              emitNotification(fastify.io, uid, 'RESTAURANT', 'order:delivery-stuck-restaurant', {
                orderId: order.id,
                orderReference: order.orderReference,
                driverName: delivererName,
                minutesStuck,
                isOwnDelivery: !driverUserId,
              });
            }

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
                    description: `${delivererName} - Pedido ${order.orderReference} de ${order.restaurant.name} - ${order.status === 'PICKED_UP' ? `Recogido hace ${minutesStuck} min sin salir a ruta` : `${minutesStuck} min de retraso en entrega`}${driver ? '' : ' (reparto propio/apoyo)'} - Cliente: ${order.customer?.user?.name || 'N/A'}`,
                    createdBy: 'system',
                  },
                });
              }
            } catch (ticketErr) {
              logger.warn(`[StuckOrder] Error al crear ticket de soporte para ${order.id}:`, ticketErr);
            }

            await prisma.order.update({ where: { id: order.id }, data: { stuckAlertLevel: nextLevel, stuckAlertedAt: now } as any });

            logger.info(`[StuckOrder] Nivel 2: ${driver ? 'driver + ' : ''}restaurante + ticket - pedido ${order.id}`);
          } else {
            for (const uid of restaurantTargets) {
              emitNotification(fastify.io, uid, 'RESTAURANT', 'order:delivery-escalated', {
                orderId: order.id,
                orderReference: order.orderReference,
                driverName: delivererName,
                minutesStuck,
                level: nextLevel,
              });
            }

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

  logger.info(`[StuckOrder] Job iniciado (c/${POLL_INTERVAL_SEC}s). PICKED_UP>${PICKUP_STUCK_MIN}min | IN_TRANSIT+${TRANSIT_OVERDUE_MIN}min post-ETA | incluye reparto propio/apoyo (sin driver)`);
}
