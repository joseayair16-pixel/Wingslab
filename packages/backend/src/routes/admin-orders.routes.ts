import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../config/database';
import { authenticate, authorize } from '../middleware/auth';
import { OrderStatus, UserRole } from '@prisma/client';
import { emitNotification } from '../services/socket.service';
import { sendPushNotification } from '../services/notification.service';
import { createTransferRefundTicket } from '../services/refund-ticket.service';
import { restoreStockForOrder } from '../services/stock.service';

const querySchema = z.object({
  status: z.nativeEnum(OrderStatus).optional(),
  restaurantId: z.string().optional(),
  customerId: z.string().optional(),
  noDriversAvailable: z.enum(['true', 'false']).optional(),
  date: z.string().optional(),
  page: z.string().regex(/^\d+$/).transform(Number).default('1'),
  limit: z.string().regex(/^\d+$/).transform(Number).default('20'),
});

const cancelSchema = z.object({
  reason: z.string().min(10, 'El motivo debe tener al menos 10 caracteres'),
});

export const registerAdminOrdersRoutes = async (fastify: FastifyInstance) => {
  fastify.register(async (app) => {
    app.addHook('onRequest', authenticate);
    app.addHook('onRequest', authorize([UserRole.ADMIN]));

    // Get all orders with pagination and filters
    app.get('/admin/orders', async (request, reply) => {
      try {
        const query = querySchema.parse(request.query);
        
        const where: any = {};
        if (query.status) {
          where.status = query.status;
        } else {
          where.status = { notIn: [OrderStatus.DELIVERED, OrderStatus.COMPLETED, OrderStatus.CANCELLED, OrderStatus.REJECTED] };
        }
        if (query.restaurantId) where.restaurantId = query.restaurantId;
        if (query.customerId) where.customerId = query.customerId;
        if (query.noDriversAvailable === 'true') where.noDriversAvailable = true;
        if (query.date) {
          const start = new Date(query.date);
          start.setHours(0, 0, 0, 0);
          const end = new Date(query.date);
          end.setHours(23, 59, 59, 999);
          where.createdAt = { gte: start, lte: end };
        }

        const skip = (query.page - 1) * query.limit;

        const [orders, total] = await Promise.all([
          prisma.order.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip,
            take: query.limit,
            include: {
              restaurant: { select: { id: true, name: true, region: true, hasOwnDelivery: true } },
              customer: { include: { user: { select: { id: true, name: true, phone: true } } } },
              driver: { include: { user: { select: { id: true, name: true, phone: true } } } },
            },
          }),
          prisma.order.count({ where }),
        ]);

        return reply.send({
          success: true,
          data: {
            orders,
            meta: {
              total,
              page: query.page,
              limit: query.limit,
              totalPages: Math.ceil(total / query.limit),
            },
          },
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            success: false,
            error: { message: 'Invalid query parameters', details: error.errors },
          });
        }
        return reply.status(500).send({
          success: false,
          error: { message: 'Error fetching orders' },
        });
      }
    });

    // Get single order detail
    app.get('/admin/orders/:id', async (request, reply) => {
      try {
        const { id } = request.params as { id: string };

        const order = await prisma.order.findUnique({
          where: { id },
          select: {
            id: true,
            orderReference: true,
            dailyCounter: true,
            restaurantId: true,
            customerId: true,
            driverId: true,
            driverAssignedAt: true,
            isAcceptedByDriver: true,
            supportRestaurantId: true,
            isSupportRequested: true,
            noDriversAvailable: true,
            addressId: true,
            latitude: true,
            longitude: true,
            subtotal: true,
            taxAmount: true,
            serviceFee: true,
            platformFee: true,
            driverPlatformFee: true,
            deliveryFee: true,
            totalAmount: true,
            status: true,
            paymentMethod: true,
            paymentStatus: true,
            paymentProofUrl: true,
            estimatedDeliveryTime: true,
            actualDeliveryTime: true,
            preparationTimeMinutes: true,
            preparationStartedAt: true,
            preparationDeadlineAt: true,
            etaExtendedMinutes: true,
            notes: true,
            handoverPin: true,
            cashPaymentConfirmedAt: true,
            deliveryPreference: true,
            pickedUpAt: true,
            inTransitAt: true,
            deliveredAt: true,
            readyAt: true,
            driverArrivedAt: true,
            lastPickupAlertedAt: true,
            batchId: true,
            deliverySequence: true,
            stuckAlertLevel: true,
            stuckAlertedAt: true,
            createdAt: true,
            updatedAt: true,
            restaurant: {
              select: {
                id: true, name: true, region: true, hasOwnDelivery: true,
                logo: true, contactPhone: true, status: true,
                user: { select: { email: true } },
              },
            },
            customer: { select: { id: true, user: { select: { id: true, name: true, phone: true } } } },
            driver: { select: { id: true, rating: true, user: { select: { id: true, name: true, phone: true } } } },
            address: true,
            items: {
              select: {
                id: true, quantity: true, unitPrice: true, subtotal: true,
                specialInstructions: true,
                product: { select: { id: true, name: true, image: true } },
                options: { select: { id: true, name: true, price: true } },
              },
            },
            tracking: {
              orderBy: { createdAt: 'desc' },
              select: { id: true, status: true, notes: true, createdAt: true },
            },
          },
        });

        if (!order) {
          return reply.status(404).send({
            success: false,
            error: { message: 'Order not found' },
          });
        }

        return reply.send({
          success: true,
          data: order,
        });
      } catch (error) {
        return reply.status(500).send({
          success: false,
          error: { message: 'Error fetching order details' },
        });
      }
    });

    // Force cancel order
    app.post('/admin/orders/:id/cancel', async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const { reason } = cancelSchema.parse(request.body);

        const order = await prisma.order.findUnique({
          where: { id },
          include: {
            restaurant: { select: { name: true } },
            driver: { select: { userId: true } },
          },
        });
        if (!order) {
          return reply.status(404).send({ success: false, error: { message: 'Order not found' } });
        }

        if (order.status === 'DELIVERED' || order.status === 'CANCELLED') {
          return reply.status(400).send({ success: false, error: { message: `Cannot cancel order in status ${order.status}` } });
        }

        // Perform cancellation
        const updatedOrder = await prisma.$transaction(async (tx) => {
          const canceled = await tx.order.update({
            where: { id },
            data: {
              status: 'CANCELLED',
              driverId: null,
              driverAssignedAt: null,
              isAcceptedByDriver: false,
            },
          });

          // Free the driver if assigned
          if (order.driverId) {
            await tx.driver.updateMany({
              where: { id: order.driverId },
              data: { availability: 'AVAILABLE' as any },
            });
          }

          // Add tracking log
          await tx.orderTracking.create({
            data: {
              orderId: id,
              status: 'CANCELLED',
              latitude: order.latitude,
              longitude: order.longitude,
              notes: `Administrador forzó la cancelación: ${reason}`,
            },
          });

          await createTransferRefundTicket(tx, id, `Cancelado por un administrador. ${reason}`);

          await restoreStockForOrder(tx, id);

          return canceled;
        });

        // Notify driver via push if assigned
        if (order.driver?.userId) {
          try {
            await sendPushNotification(order.driver.userId, {
              title: 'Pedido cancelado por el administrador',
              body: `El pedido de ${order.restaurant?.name || 'tu zona'} fue cancelado por un administrador. Motivo: ${reason}`,
              icon: '/app-icon-192.png',
              badge: '/badge.png',
              vibrate: [600, 200, 600, 200, 600],
              requireInteraction: true,
              tag: `order-cancelled-${id}`,
              data: {
                orderId: id,
                event: 'order:cancelled',
                url: '/',
              },
            });
          } catch (pushErr) {
            request.log.error(pushErr as any, '[Push] Error al notificar cancelación al repartidor');
          }
        }

        return reply.send({
          success: true,
          message: 'Order forcefully canceled',
          data: updatedOrder,
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            success: false,
            error: { message: error.errors[0].message },
          });
        }
        return reply.status(500).send({
          success: false,
          error: { message: 'Error canceling order' },
        });
      }
    });

    // Get stuck orders (escalated deliveries)
    app.get('/admin/orders/stuck', async (request, reply) => {
      try {
        const orders = await prisma.order.findMany({
          where: {
            stuckAlertLevel: { gt: 0 },
            status: { in: [OrderStatus.PICKED_UP, OrderStatus.IN_TRANSIT] },
          },
          orderBy: [{ stuckAlertLevel: 'desc' }, { stuckAlertedAt: 'asc' }],
          include: {
            restaurant: { select: { id: true, name: true } },
            customer: { include: { user: { select: { id: true, name: true, phone: true } } } },
            driver: { include: { user: { select: { id: true, name: true, phone: true } } } },
          },
        });

        return reply.send({ success: true, data: orders });
      } catch (error) {
        return reply.status(500).send({ success: false, error: { message: 'Error fetching stuck orders' } });
      }
    });

    // Resolve a stuck order (admin action)
    const resolveSchema = z.object({
      action: z.enum(['reassign', 'cancel_refund', 'force_deliver', 'force_complete']),
      reason: z.string().min(5),
    });

    app.post('/admin/orders/:id/resolve-stuck', async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const { action, reason } = resolveSchema.parse(request.body);
        const adminId = (request.user as any).id;

        const order = await prisma.order.findUnique({
          where: { id },
          include: {
            driver: { select: { userId: true } },
            restaurant: { select: { userId: true } },
            customer: { select: { userId: true } },
          },
        });
        if (!order) {
          return reply.status(404).send({ success: false, error: { message: 'Order not found' } });
        }

        const result = await prisma.$transaction(async (tx) => {
          if (action === 'reassign') {
            await tx.order.update({
              where: { id },
              data: {
                status: 'READY',
                driverId: null,
                noDriversAvailable: false,
                stuckAlertLevel: 0,
                stuckAlertedAt: null,
              },
            });
            await tx.orderTracking.create({
              data: { orderId: id, status: 'READY', notes: `Reasignación forzada por admin ${adminId}: ${reason}` },
            });
            return { status: 'READY', message: 'Order returned to READY. Driver unassigned.' };
          }

          if (action === 'cancel_refund') {
            await tx.order.update({
              where: { id },
              data: { status: 'CANCELLED', stuckAlertLevel: 0, stuckAlertedAt: null },
            });
            await tx.orderTracking.create({
              data: { orderId: id, status: 'CANCELLED', notes: `Cancelado por admin ${adminId} (entrega atascada): ${reason}` },
            });
            await createTransferRefundTicket(tx, id, `Cancelado por un administrador (entrega atascada). ${reason}`);
            await restoreStockForOrder(tx, id);
            return { status: 'CANCELLED', message: 'Order cancelled. Customer should be refunded.' };
          }

          if (action === 'force_deliver') {
            await tx.order.update({
              where: { id },
              data: { status: 'DELIVERED', deliveredAt: new Date(), stuckAlertLevel: 0, stuckAlertedAt: null },
            });
            await tx.orderTracking.create({
              data: { orderId: id, status: 'DELIVERED', notes: `Forzado como entregado por admin ${adminId}: ${reason}` },
            });
            return { status: 'DELIVERED', message: 'Order forcefully marked as delivered.' };
          }

          if (action === 'force_complete') {
            await tx.order.update({
              where: { id },
              data: { status: 'COMPLETED', completedAt: new Date(), stuckAlertLevel: 0, stuckAlertedAt: null },
            });
            await tx.orderTracking.create({
              data: { orderId: id, status: 'COMPLETED', notes: `Forzado como completado por admin ${adminId}: ${reason}` },
            });
            return { status: 'COMPLETED', message: 'Order forcefully completed (pickup).' };
          }

          return { status: order.status, message: 'No action taken.' };
        });

        // Notify all parties about the resolution
        const eventPayload = {
          orderId: id,
          orderReference: order.orderReference,
          action,
          reason,
        };
        if (order.driver?.userId) {
          emitNotification(fastify.io, order.driver.userId, 'DRIVER', 'order:stuck-resolved', eventPayload);
        }
        if (order.restaurant?.userId) {
          emitNotification(fastify.io, order.restaurant.userId, 'RESTAURANT', 'order:stuck-resolved', eventPayload);
        }
        if (order.customer?.userId) {
          emitNotification(fastify.io, order.customer.userId, 'CUSTOMER', 'order:stuck-resolved', eventPayload);
        }

        return reply.send({ success: true, data: result });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({ success: false, error: { message: error.errors[0].message } });
        }
        return reply.status(500).send({ success: false, error: { message: 'Error resolving stuck order' } });
      }
    });

    // Force reassign driver
    app.post('/admin/orders/:id/reassign', async (request, reply) => {
      try {
        const { id } = request.params as { id: string };

        const order = await prisma.order.findUnique({ where: { id } });
        if (!order) {
          return reply.status(404).send({ success: false, error: { message: 'Order not found' } });
        }

        if (order.status === 'DELIVERED' || order.status === 'CANCELLED') {
          return reply.status(400).send({ success: false, error: { message: `Cannot reassign order in status ${order.status}` } });
        }

        const updatedOrder = await prisma.$transaction(async (tx) => {
          // Unassign driver and put order back to looking for drivers (READY or PENDING, depending on preparation)
          // Usually if driver is unassigned, it goes back to READY if preparation is done, or PENDING if not.
          // But to be safe, we just clear the driverId and let the assignment job pick it up.
          const reassigned = await tx.order.update({
            where: { id },
            data: { 
              driverId: null,
              noDriversAvailable: false, // Reset this flag
            },
          });

          await tx.orderTracking.create({
            data: {
              orderId: id,
              status: reassigned.status,
              latitude: order.latitude,
              longitude: order.longitude,
              notes: `Administrador reasignó el repartidor y el pedido vuelve a estar disponible.`,
            },
          });

          return reassigned;
        });

        return reply.send({
          success: true,
          message: 'Driver unassigned. System will find a new driver.',
          data: updatedOrder,
        });
      } catch (error) {
        return reply.status(500).send({
          success: false,
          error: { message: 'Error reassigning driver' },
        });
      }
    });

  });
};
