import cron from 'node-cron';
import { FastifyInstance } from 'fastify';
import { OrderStatus } from '@prisma/client';
import { prisma } from '../config/database';
import { updateOrderStatusByRestaurant, dequeueRestaurantOrder, getFirstInQueue, getActiveSinceMs, respondToCancellationRequest } from '../services/order-workflow.service';
import { emitNotification } from '../services/socket.service';
import { sendPushNotification } from '../services/notification.service';
import { logger } from '../utils/logger';
import crypto from 'node:crypto';

const isStore = (businessType?: string | null) => businessType && businessType !== 'RESTAURANT';

const reminderSentLevel = new Map<string, number>();

const getDecisionWindow = (paymentMethod: string, businessType?: string | null): number => {
  if (paymentMethod === 'TRANSFER') return 10 * 60 * 1000;
  if (isStore(businessType)) return 8 * 60 * 1000;
  return 2 * 60 * 1000;
};

export function startOrderTimeoutJob(fastify: FastifyInstance) {
  cron.schedule('*/30 * * * * *', async () => {
    try {
      const pendingOrders = await prisma.order.findMany({
        where: {
          status: OrderStatus.PENDING,
        },
        include: {
          customer: {
            include: {
              user: true,
            },
          },
          restaurant: true,
        },
      });

      const now = Date.now();

      // ── Auto-approve stale cancellation requests (5 min timeout) ──
      const cancellationRequests = await prisma.order.findMany({
        where: {
          cancellationRequestedAt: { not: null },
          status: { in: [OrderStatus.PENDING, OrderStatus.CONFIRMED, OrderStatus.PREPARING] },
        },
        include: {
          restaurant: { select: { userId: true } },
          customer: { select: { userId: true } },
        },
      });

      for (const cr of cancellationRequests) {
        const elapsed = now - cr.cancellationRequestedAt!.getTime();
        if (elapsed >= 5 * 60 * 1000) {
          logger.info(`[OrderTimeoutJob] Auto-aprobando cancelación para pedido ${cr.id} (solicitada hace ${Math.round(elapsed / 1000)}s)`);
          try {
            const { customerUserId, driverUserId } = await respondToCancellationRequest(prisma, cr.id, cr.restaurant.userId, true, 'Auto-aprobado por falta de respuesta del restaurante.');

            emitNotification(fastify.io, customerUserId, 'CUSTOMER', 'order:cancellation-approved', {
              orderId: cr.id,
              note: 'El restaurante no respondió a tiempo. La cancelación fue aprobada automáticamente.',
            }, { requestId: crypto.randomBytes(8).toString('hex'), orderId: cr.id });

            if (driverUserId) {
              emitNotification(fastify.io, driverUserId, 'DRIVER', 'order:unassigned', { orderId: cr.id }, { requestId: crypto.randomBytes(8).toString('hex'), orderId: cr.id });
            }

            logger.info(`[OrderTimeoutJob] Cancelación auto-aprobada para pedido ${cr.id}`);
          } catch (err) {
            logger.error(`[OrderTimeoutJob] Error auto-aprobando cancelación para pedido ${cr.id}:`, err);
          }
        }
      }

      // Group pending orders by restaurant
      const ordersByRestaurant = new Map<string, typeof pendingOrders>();
      for (const order of pendingOrders) {
        const existing = ordersByRestaurant.get(order.restaurant.id) || [];
        existing.push(order);
        ordersByRestaurant.set(order.restaurant.id, existing);
      }

      for (const [restaurantId, orders] of ordersByRestaurant) {
        // Determine which order is first in the queue
        const firstInQueueId = await getFirstInQueue(restaurantId);

        for (const order of orders) {
          const businessType = order.restaurant.businessType;
          const isFirst = firstInQueueId === order.id;
          const orderAgeMs = now - order.createdAt.getTime();

          if (isFirst) {
            // This order's clock is running — use activeSince or createdAt
            const activeSinceMs = await getActiveSinceMs(order.id);
            const effectiveStartMs = activeSinceMs ?? order.createdAt.getTime();
            const decisionWindowMs = getDecisionWindow(order.paymentMethod, businessType);
            const elapsed = now - effectiveStartMs;

            // ── Store reminders (only for first in queue) ──
            if (isStore(businessType)) {
              const currentLevel = reminderSentLevel.get(order.id) || 0;

              if (currentLevel < 1 && elapsed >= 4 * 60 * 1000 && elapsed < 6 * 60 * 1000) {
                reminderSentLevel.set(order.id, 1);
                emitNotification(
                  fastify.io,
                  order.restaurant.userId,
                  'RESTAURANT',
                  'order:pending-reminder',
                  {
                    orderId: order.id,
                    status: OrderStatus.PENDING,
                    message: 'Hay un pedido entrante que no se ha aceptado. Revísalo en la web.',
                  },
                  {
                    requestId: crypto.randomBytes(8).toString('hex'),
                    orderId: order.id,
                  }
                );
                logger.info(`[OrderTimeoutJob] Recordatorio 1 enviado para pedido ${order.id} (tienda)`);
              }

              if (currentLevel < 2 && elapsed >= 6 * 60 * 1000 && elapsed < 8 * 60 * 1000) {
                reminderSentLevel.set(order.id, 2);
                emitNotification(
                  fastify.io,
                  order.restaurant.userId,
                  'RESTAURANT',
                  'order:pending-reminder',
                  {
                    orderId: order.id,
                    status: OrderStatus.PENDING,
                    message: 'Estás a punto de perder un pedido. Entra a la web para aceptarlo.',
                  },
                  {
                    requestId: crypto.randomBytes(8).toString('hex'),
                    orderId: order.id,
                  }
                );
                logger.info(`[OrderTimeoutJob] Recordatorio 2 enviado para pedido ${order.id} (tienda)`);
              }
            }

            // Auto-reject if decision window expired
            if (now >= effectiveStartMs + decisionWindowMs) {
              await rejectExpiredOrder(fastify, order);
            }
          } else if (firstInQueueId === null && orderAgeMs > 3 * 60 * 1000) {
            // Orphaned order: not in Redis queue but pending for >3 min.
            // This can happen after server restart. Use createdAt-based window.
            const decisionWindowMs = getDecisionWindow(order.paymentMethod, businessType);
            if (now >= order.createdAt.getTime() + decisionWindowMs) {
              await rejectExpiredOrder(fastify, order);
            }
          }
          // else: order is in queue but not first — clock is paused, skip
        }
      }
    } catch (error) {
      logger.error('[OrderTimeoutJob] Error critico ejecutando job de timeouts:', error);
    }
  });

  logger.info('[OrderTimeoutJob] Tarea programada iniciada (cada 30 segundos).');
}

async function rejectExpiredOrder(fastify: FastifyInstance, order: any) {
  logger.info(`[OrderTimeoutJob] El pedido ${order.id} (${order.orderReference}) expiró. Auto-rechazando...`);
  reminderSentLevel.delete(order.id);

  try {
    await updateOrderStatusByRestaurant({
      prisma,
      restaurantUserId: order.restaurant.userId,
      orderId: order.id,
      nextStatus: OrderStatus.REJECTED,
      trackingNote: 'Pedido rechazado automáticamente por falta de respuesta del restaurante en el tiempo límite.',
    });

    // Dequeue and activate next in line
    await dequeueRestaurantOrder(order.restaurant.id, order.id);

    const requestId = crypto.randomBytes(8).toString('hex');

    emitNotification(
      fastify.io,
      order.customer.user.id,
      'CUSTOMER',
      'order:rejected',
      {
        orderId: order.id,
        status: OrderStatus.REJECTED,
      },
      {
        requestId,
        orderId: order.id,
      }
    );

    emitNotification(
      fastify.io,
      order.restaurant.userId,
      'RESTAURANT',
      'order:rejected',
      {
        orderId: order.id,
        status: OrderStatus.REJECTED,
      },
      {
        requestId,
        orderId: order.id,
      }
    );

    try {
      const businessType = order.restaurant.businessType;
      const businessRef = isStore(businessType) ? 'tienda' : 'restaurante';
      await sendPushNotification(order.customer.user.id, {
        title: 'Pedido no aceptado a tiempo 😔',
        body: `El ${businessRef} no pudo atender tu solicitud a tiempo y el pedido fue cancelado. ¡Intenta con otro ${businessRef} o más tarde!`,
        icon: '/SaDeL.png',
        badge: '/SaDeL.png',
        vibrate: [800, 200, 800],
        requireInteraction: true,
        data: {
          orderId: order.id,
          event: 'order:rejected',
          url: `/?orderId=${order.id}`,
        },
      });
    } catch (pushErr) {
      logger.error(`[OrderTimeoutJob] Fallo al enviar push notification al comensal ${order.customer.user.id}`, pushErr);
    }

    logger.info(`[OrderTimeoutJob] Pedido ${order.id} auto-rechazado exitosamente.`);
  } catch (err) {
    logger.error(`[OrderTimeoutJob] Error rechazando pedido ${order.id}:`, err);
  }
}
