import { PrismaClient, OrderStatus } from '@prisma/client';
import cron from 'node-cron';
import { FastifyInstance } from 'fastify';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import { sendPushNotification } from '../services/notification.service';
import { emitNotification } from '../services/socket.service';

const NEARLY_READY_THRESHOLD_MIN = 3;

export function startPickupReadyJob(fastify: FastifyInstance) {
  cron.schedule('* * * * *', async () => {
    try {
      const nearlyReadyCount = await processNearlyReadyOrders(prisma, fastify.io);
      if (nearlyReadyCount > 0) {
        logger.info(`[PickupReady] ${nearlyReadyCount} notificaciones "casi listo" enviadas.`);
      }

      const unclaimedCount = await processUnclaimedReadyOrders(prisma, fastify.io);
      if (unclaimedCount > 0) {
        logger.info(`[PickupReady] ${unclaimedCount} alertas de pedidos no recogidos enviadas.`);
      }

      const autoCompletedCount = await processAutoCompletePickupOrders(prisma, fastify.io);
      if (autoCompletedCount > 0) {
        logger.info(`[PickupReady] ${autoCompletedCount} pedidos de recogida auto-completados por tiempo máximo.`);
      }
    } catch (err) {
      logger.error('[PickupReady] Error en ejecución del cron:', err);
    }
  });
}

async function processNearlyReadyOrders(db: PrismaClient, io: any) {
  const now = new Date();
  const threshold = new Date(now.getTime() + NEARLY_READY_THRESHOLD_MIN * 60 * 1000);

  const nearlyReadyOrders = await db.order.findMany({
    where: {
      fulfillmentType: 'PICKUP',
      status: OrderStatus.PREPARING,
      pickupReadyAt: { lte: threshold },
      nearlyReadySentAt: null,
    },
    select: {
      id: true,
      orderReference: true,
      pickupReadyAt: true,
      customer: {
        select: {
          userId: true,
          user: { select: { id: true, name: true } },
        },
      },
      restaurant: {
        select: { id: true, name: true, userId: true, businessType: true },
      },
    },
  });

  for (const order of nearlyReadyOrders) {
    try {
      await db.order.update({
        where: { id: order.id },
        data: { nearlyReadySentAt: now },
      });

      const businessRef = order.restaurant.businessType !== 'RESTAURANT' ? 'la tienda' : 'el restaurante';

      await sendPushNotification(order.customer.userId, {
        title: '¡Casi listo! 🔥',
        body: `Tu pedido ${order.orderReference} estará listo en minutos. En breve podrás pasar a ${businessRef} a recogerlo.`,
        data: {
          orderId: order.id,
          orderReference: order.orderReference,
          url: `/?orderId=${order.id}`,
        },
        tag: `nearly-ready-${order.id}`,
        requireInteraction: false,
      });

      emitNotification(
        io,
        order.customer.userId,
        'CUSTOMER',
        'order:nearly-ready',
        {
          orderId: order.id,
          orderReference: order.orderReference,
          pickupReadyAt: order.pickupReadyAt,
        },
        { requestId: 'cron-pickup', orderId: order.id }
      );

      logger.info(`[PickupReady] Notificación "casi listo" enviada para pedido ${order.id}`);
    } catch (err) {
      logger.error(`[PickupReady] Error al procesar notificación casi listo para pedido ${order.id}:`, err);
    }
  }

  return nearlyReadyOrders.length;
}

async function processUnclaimedReadyOrders(db: PrismaClient, _io: any) {
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);

  const unclaimedOrders = await db.order.findMany({
    where: {
      fulfillmentType: 'PICKUP',
      status: OrderStatus.READY,
      readyAt: { lte: thirtyMinAgo },
    },
    select: {
      id: true,
      orderReference: true,
      restaurantId: true,
      restaurant: { select: { userId: true, name: true } },
    },
  });

  for (const order of unclaimedOrders) {
    try {
      await sendPushNotification(order.restaurant.userId, {
        title: '⏰ Pedido esperando recogida',
        body: `El pedido ${order.orderReference} lleva más de 30 min listo y aún no ha sido recogido.`,
        data: {
          orderId: order.id,
          orderReference: order.orderReference,
          url: `/?orderId=${order.id}`,
        },
        tag: `unclaimed-${order.id}`,
        requireInteraction: true,
      });

      logger.info(`[PickupReady] Alerta de pedido no recogido enviada para ${order.id}`);
    } catch (err) {
      logger.error(`[PickupReady] Error al alertar pedido no recogido ${order.id}:`, err);
    }
  }

  return unclaimedOrders.length;
}

async function processAutoCompletePickupOrders(db: PrismaClient, io: any) {
  const cutoff = new Date(Date.now() - 120 * 60 * 1000);

  const staleOrders = await db.order.findMany({
    where: {
      fulfillmentType: 'PICKUP',
      status: OrderStatus.READY,
      readyAt: { lte: cutoff },
    },
    select: {
      id: true,
      orderReference: true,
      restaurant: { select: { name: true } },
      customer: { select: { userId: true, user: { select: { id: true, name: true } } } },
    },
  });

  for (const order of staleOrders) {
    try {
      await db.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.COMPLETED,
          completedAt: new Date(),
          actualDeliveryTime: new Date(),
        },
      });
      await db.orderTracking.create({
        data: {
          orderId: order.id,
          status: OrderStatus.COMPLETED,
          notes: 'Auto-completado por tiempo máximo de recolección (60 min).',
        },
      });
      await sendPushNotification(order.customer.userId, {
        title: 'Pedido completado ✅',
        body: `Tu pedido ${order.orderReference} en ${order.restaurant.name} ha sido marcado como recogido automáticamente.`,
        data: { orderId: order.id, orderReference: order.orderReference },
        tag: `auto-completed-${order.id}`,
        requireInteraction: false,
      });
      emitNotification(io, order.customer.userId, 'CUSTOMER', 'order:completed', {
        orderId: order.id,
        orderReference: order.orderReference,
      }, { requestId: 'cron-pickup', orderId: order.id });
      logger.info(`[PickupReady] Pedido ${order.id} auto-completado (READY > 60 min).`);
    } catch (err) {
      logger.error(`[PickupReady] Error auto-completando pedido ${order.id}:`, err);
    }
  }

  return staleOrders.length;
}
