import { appEvents } from '../utils/events';
import { emitNotification } from '../services/socket.service';
import { sendPushNotification } from '../services/notification.service';
import { invalidateBillingCache } from '../services/restaurant-billing.service';
import { prisma } from '../config/database';
import { FastifyInstance } from 'fastify';
import { logger } from '../utils/logger';

export const setupNotificationSubscribers = (fastify: FastifyInstance) => {
  appEvents.on('order.status_changed', async (data) => {
    const { orderId, status, initiator } = data;
    logger.info(`Event order.status_changed received for order ${orderId}`);

    try {
      // Fetch order details to know who to notify
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          customer: {
            include: { user: true },
          },
          restaurant: {
            include: { user: true },
          },
          driver: {
            include: { user: true },
          },
        },
      });

      if (!order) {
        logger.error(`Order ${orderId} not found in subscriber`);
        return;
      }

      // 1. Notify Customer via Socket.io & Web Push
      // Skip generic notifications if the status has a dedicated, premium notification in the route controllers
      const isCustomizedStatus = [
        'CONFIRMED',
        'PREPARING',
        'REJECTED',
        'READY',
        'PICKED_UP',
        'IN_TRANSIT',
        'DELIVERED',
      ].includes(status);

      if (!isCustomizedStatus) {
        emitNotification(
          fastify.io,
          order.customer.userId,
          'CUSTOMER',
          'order_status_updated',
          { orderId, status, message: `Tu pedido está ${status}` }
        );

        await sendPushNotification(order.customer.userId, {
          title: 'Actualización de tu pedido',
          body: `Tu pedido de ${order.restaurant.name} está ahora ${status}.`,
          data: { orderId, status, url: `/?orderId=${orderId}` },
        });
      }

      // 3. Notify Restaurant if initiator was not restaurant
      if (initiator.role !== 'RESTAURANT') {
        emitNotification(
          fastify.io,
          order.restaurant.userId,
          'RESTAURANT',
          'order_status_updated',
          { orderId, status }
        );
      }

      // 4. Notify Driver if assigned and not initiator
      if (order.driver && initiator.role !== 'DRIVER') {
        emitNotification(
          fastify.io,
          order.driver.userId,
          'DRIVER',
          'order_status_updated',
          { orderId, status }
        );
      }

      // Billing summary invalidation: emit refresh signal when order money changes hands
      if (status === 'DELIVERED' || status === 'COMPLETED') {
        emitNotification(
          fastify.io,
          order.restaurant.userId,
          'RESTAURANT',
          'billing:updated',
          { orderId, status, restaurantId: order.restaurant.id }
        );
        invalidateBillingCache(order.restaurant.id);
      }

    } catch (error) {
      logger.error(`Error in order.status_changed subscriber:`, error);
    }
  });

  appEvents.on('order.driver_auto_assigned_on_free_slot', async (data) => {
    const { orderId, driverId, restaurantUserId } = data;
    logger.info(`Event order.driver_auto_assigned_on_free_slot received for order ${orderId}`);

    try {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          customer: { include: { user: true } },
          restaurant: true,
          driver: { include: { user: true } },
        },
      });

      if (!order || !order.driver) {
        logger.error(`Order or driver not found in auto-assign free slot subscriber`);
        return;
      }

      // 1. Notify Driver
      emitNotification(
        fastify.io,
        order.driver.userId,
        'DRIVER',
        'order:assigned',
        {
          orderId: order.id,
          orderReference: order.orderReference,
          restaurantName: order.restaurant.name,
          customerName: order.customer.user.name,
        },
        {
          requestId: 'system-auto-assign-free-slot',
          orderId: order.id,
        }
      );

      // 2. Notify Customer
      emitNotification(
        fastify.io,
        order.customer.user.id,
        'CUSTOMER',
        'order:driver-assigned',
        {
          orderId: order.id,
          driverName: order.driver.user.name,
        },
        {
          requestId: 'system-auto-assign-free-slot',
          orderId: order.id,
        }
      );

      // 3. Notify Restaurant
      emitNotification(
        fastify.io,
        restaurantUserId,
        'RESTAURANT',
        'order:driver-accepted',
        {
          orderId: order.id,
          status: 'assigned',
        },
        {
          requestId: 'system-auto-assign-free-slot',
          orderId: order.id,
        }
      );
    } catch (error) {
      logger.error(`Error in order.driver_auto_assigned_on_free_slot subscriber:`, error);
    }
  });

  logger.info('Notification subscribers setup complete');
};
