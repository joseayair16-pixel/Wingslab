import cron from 'node-cron';
import { FastifyInstance } from 'fastify';
import { OrderStatus } from '@prisma/client';
import { prisma } from '../config/database';
import { autoAssignDriver, notifyCustomerNoDriversAvailable } from '../services/order-workflow.service';
import { emitNotification } from '../services/socket.service';
import { logger } from '../utils/logger';

export function startJitDispatchJob(fastify: FastifyInstance) {
  // Ejecutar cada 30 segundos
  cron.schedule('*/30 * * * * *', async () => {
    try {
      const now = new Date();
      
      // 1. Verificar pedidos asignados que no han sido aceptados en 2 minutos (Auto-Reject)
      const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000);
      const expiredAssignedOrders = await prisma.order.findMany({
        where: {
          driverId: { not: null },
          isAcceptedByDriver: false,
          driverAssignedAt: { lt: twoMinutesAgo },
          status: { in: [OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.READY] },
        },
      });

      for (const order of expiredAssignedOrders) {
        logger.info(`[JIT-Dispatch] Repartidor no aceptó el pedido ${order.id} a tiempo. Expulsando...`);
        await prisma.$transaction(async (tx) => {
          // Desvincular al repartidor
          await tx.order.update({
            where: { id: order.id },
            data: {
              driverId: null,
              driverAssignedAt: null,
              isAcceptedByDriver: false,
              noDriversAvailable: false, // Permitir que vuelva a buscar
            },
          });
          // Liberar al repartidor
          if (order.driverId) {
            await tx.driver.update({
              where: { id: order.driverId },
              data: { availability: 'AVAILABLE' }, // o mantener lo que tenía, pero AVAILABLE es seguro
            });
          }
          await tx.orderTracking.create({
            data: {
              orderId: order.id,
              status: order.status,
              notes: 'Repartidor expulsado automáticamente por no aceptar a tiempo.',
            },
          });
        });
      }

      // 2. JIT Buffer: 8 minutos (5 min trayecto + 3 min gracia) para nuevos pedidos
      const JIT_BUFFER_MS = 8 * 60 * 1000;
      
      const targetTime = new Date(now.getTime() + JIT_BUFFER_MS);

      const pendingDispatchOrders = await prisma.order.findMany({
        where: {
          driverId: null,
          fulfillmentType: 'DELIVERY',
          status: { in: [OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.READY] },
          restaurant: {
            hasOwnDelivery: false,
          },
          OR: [
            { preparationDeadlineAt: { lte: targetTime } },
            { preparationDeadlineAt: null, estimatedDeliveryTime: { lte: targetTime } },
            { noDriversAvailable: true },
          ],
        },
        include: {
          restaurant: { select: { userId: true, name: true, businessType: true } },
          customer: { select: { user: true } }
        },
      });

      if (pendingDispatchOrders.length === 0) {
        return;
      }

      for (const order of pendingDispatchOrders) {
        logger.info(`[JIT-Dispatch] Intentando asignar repartidor para pedido ${order.id} (Deadline: ${order.preparationDeadlineAt || order.estimatedDeliveryTime})`);
        
        try {
          // Utilizar la misma función de asignación (incluye reglas estrictas y relajadas)
          const assignResult = await autoAssignDriver(prisma, order.id, order.restaurant.userId);
          
            if (assignResult.success && assignResult.driver && assignResult.order) {
              const updatedOrder = assignResult.order;
              logger.info(`[JIT-Dispatch] Asignado exitosamente a repartidor ${assignResult.driver.id} para pedido ${order.id}`);
              
              // Emitir evento a driver
              emitNotification(
                fastify.io,
                assignResult.driver.userId,
                'DRIVER',
                'order:assigned',
                {
                  orderId: updatedOrder.id,
                  orderReference: updatedOrder.orderReference,
                  restaurantName: order.restaurant.name,
                  customerName: order.customer.user.name,
                }
              );

              // Notificar cliente
              emitNotification(
                fastify.io,
                order.customer.user.id,
                'CUSTOMER',
                'order:driver-assigned',
                {
                  orderId: updatedOrder.id,
                  driverName: assignResult.driver.user.name,
                }
              );

              // Notificar restaurante
              emitNotification(
                fastify.io,
                order.restaurant.userId,
                'RESTAURANT',
                'order:driver-assigned',
                {
                  orderId: updatedOrder.id,
                  driverName: assignResult.driver.user.name,
                }
              );
            } else if (assignResult.alreadyAssigned) {
              // Otro proceso concurrente ya asignó este pedido a un
              // repartidor. No marcar como "sin repartidor".
              logger.info(
                `[JIT-Dispatch] Pedido ${order.id} ya fue asignado por otro proceso; se omite noDriversAvailable.`
              );
            } else {
            // Si falla, revisamos si ya habíamos notificado
            const currentOrderData = await prisma.order.findUnique({
              where: { id: order.id },
              select: { noDriversAvailable: true }
            });
            
            if (currentOrderData && !currentOrderData.noDriversAvailable) {
              await prisma.order.update({
                where: { id: order.id },
                data: { noDriversAvailable: true },
              });

              emitNotification(
                fastify.io,
                order.restaurant.userId,
                'RESTAURANT',
                'order:no-drivers-available',
                {
                  orderId: order.id,
                  message: order.restaurant.businessType !== 'RESTAURANT'
                    ? 'Tu pedido está próximo a la hora de entrega, pero no hay repartidores disponibles en este momento.'
                    : 'Tu pedido está por estar listo, pero no hay repartidores disponibles en este momento.',
                }
              );

              notifyCustomerNoDriversAvailable(fastify.io, order);
            }
          }
        } catch (err) {
          logger.error(`[JIT-Dispatch] Error procesando pedido ${order.id}:`, err);
        }
      }
    } catch (error) {
      logger.error('[JIT-Dispatch] Error general en el job:', error);
    }
  });
}
