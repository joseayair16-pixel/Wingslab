import cron from 'node-cron';
import { FastifyInstance } from 'fastify';
import { OrderStatus } from '@prisma/client';
import { prisma } from '../config/database';
import {
  autoAssignDriver,
  incrementDriverRejection,
  notifyCustomerNoDriversAvailable,
} from '../services/order-workflow.service';
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
        include: {
          restaurant: { select: { userId: true, name: true } },
          driver: { select: { userId: true, user: { select: { name: true } } } },
        },
      });

      for (const order of expiredAssignedOrders) {
        logger.info(`[JIT-Dispatch] Repartidor no aceptó el pedido ${order.id} a tiempo. Expulsando...`);
        const driverName = order.driver?.user?.name || 'El repartidor';
        const requestId = `jit-auto-unassign-${order.id}`;

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
          // Liberar al repartidor: recalcular su disponibilidad real en vez de
          // marcarlo siempre AVAILABLE (si conserva otros pedidos activos debe
          // permanecer BUSY para no recibir asignaciones incorrectas).
          if (order.driverId) {
            const remainingActive = await tx.order.count({
              where: {
                driverId: order.driverId,
                id: { not: order.id },
                status: {
                  in: [
                    OrderStatus.CONFIRMED,
                    OrderStatus.PREPARING,
                    OrderStatus.READY,
                    OrderStatus.PICKED_UP,
                    OrderStatus.IN_TRANSIT,
                  ],
                },
              },
            });
            await tx.driver.update({
              where: { id: order.driverId },
              data: {
                availability: remainingActive > 0 ? 'BUSY' : 'AVAILABLE',
              },
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

        // Registrar el rechazo del driver expulsado (máx. 2) para que el mismo
        // pedido no se le reasigne en loop: con 2 rechazos queda excluido.
        if (order.driverId) {
          await incrementDriverRejection(order.id, order.driverId);
        }

        // Notificar al restaurante en tiempo real para que el panel se actualice
        // de inmediato (evita que muestre "Asignado (Esperando confirmación)"
        // hasta un refresco manual).
        emitNotification(
          fastify.io,
          order.restaurant?.userId,
          'RESTAURANT',
          'order:driver-auto-unassigned',
          {
            orderId: order.id,
            orderReference: order.orderReference,
            status: order.status,
            driverName,
            message: `El repartidor ${driverName} no aceptó el pedido ${order.orderReference} a tiempo; se le desvinculó automáticamente y el pedido quedó disponible para reasignar.`,
          },
          {
            requestId,
            orderId: order.id,
          }
        );

        // Notificar al repartidor expulsado para que su panel quede sincronizado
        // (el pedido pendiente de aceptar desaparece de su ruta).
        if (order.driver?.userId) {
          emitNotification(
            fastify.io,
            order.driver.userId,
            'DRIVER',
            'order:driver-auto-unassigned',
            {
              orderId: order.id,
              orderReference: order.orderReference,
              status: 'reject',
              message: `El pedido ${order.orderReference} fue desasignado porque no lo aceptaste a tiempo.`,
            },
            {
              requestId,
              orderId: order.id,
            }
          );
        }
      }

      // 2. Resolver solicitudes de apoyo a red vencidas (crash-safe).
      // Antes esto dependía de un setTimeout en memoria del proceso: si el server
      // se reiniciaba, "isSupportRequested" quedaba activo para siempre y el pedido
      // se atrapaba sin botones. Aquí se garantiza el cierre aunque se reinicie.
      const SUPPORT_WAIT_MS = 2 * 60 * 1000;
      const supportCutoff = new Date(now.getTime() - SUPPORT_WAIT_MS);
      const expiredSupportOrders = await prisma.order.findMany({
        where: {
          isSupportRequested: true,
          supportRestaurantId: null,
          supportRequestedAt: { lte: supportCutoff },
          driverId: null,
        },
        select: {
          id: true,
          orderReference: true,
          supportAttempts: true,
          restaurant: { select: { userId: true, name: true } },
        },
      });

      for (const supportOrder of expiredSupportOrders) {
        try {
          const attemptsUsed = supportOrder.supportAttempts ?? 0;
          const attemptsLeft = Math.max(0, 2 - attemptsUsed);
          const exhausted = attemptsLeft === 0;

          await prisma.order.update({
            where: { id: supportOrder.id },
            data: {
              isSupportRequested: false,
              supportRequestedAt: null,
            },
          });

          emitNotification(
            fastify.io,
            supportOrder.restaurant.userId,
            'RESTAURANT',
            exhausted ? 'order:support-exhausted' : 'order:support-rejected-all',
            {
              orderId: supportOrder.id,
              supportAttempts: attemptsUsed,
              attemptsLeft,
              exhausted,
              message: exhausted
                ? `Nadie aceptó tu solicitud de apoyo y agotaste tus 2 intentos para el pedido ${supportOrder.orderReference}. Entrega tú mismo el pedido.`
                : `Nadie aceptó tu solicitud de apoyo para el pedido ${supportOrder.orderReference}. Puedes reintentar (te queda${attemptsLeft === 1 ? '' : 'n'} ${attemptsLeft} intento${attemptsLeft === 1 ? '' : 's'}) o entregarlo tú mismo.`,
            },
            {
              requestId: `jit-support-timeout-${supportOrder.id}`,
              orderId: supportOrder.id,
            }
          );
          logger.info(`[JIT-Dispatch] Solicitud de apoyo vencida resuelta para pedido ${supportOrder.id}`);
        } catch (err) {
          logger.error(`[JIT-Dispatch] Error resolviendo apoyo vencido del pedido ${supportOrder.id}:`, err);
        }
      }

      // 3. JIT Buffer: 8 minutos (5 min trayecto + 3 min gracia) para nuevos pedidos
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
        orderBy: { createdAt: 'asc' },
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
