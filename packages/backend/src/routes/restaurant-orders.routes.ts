import { OrderStatus, UserRole, DriverAvailability } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { prisma } from '../config/database';
import { sendAppError } from '../errors/http';
import { authenticate, authorize, getAuthenticatedUser } from '../middleware/auth';
import { emitNotification } from '../services/socket.service';
import { sendPushNotification } from '../services/notification.service';
import {
  assignDriverToOrder,
  getAvailableDriversForRestaurant,
  getRestaurantScopedOrder,
  updateOrderStatusByRestaurant,
  extendOrderPreparationTime,
  rescheduleDeliveryTime,
  autoAssignDriver,
  handoverOrderFromRestaurant,
  completePickupByRestaurant,
  dequeueRestaurantOrder,
  respondToCancellationRequest,
  cancelOrderByRestaurant,
} from '../services/order-workflow.service';
import { restaurantOrderListSelect } from '../services/order-selects';
import { getOrCreateRequestContext } from '../utils/request-context';
import { getDistanceInKm, isRestaurant, getBusinessRef, getBusinessArticleCapitalized } from '../utils/restaurant';
import { buildCustomerDeliveryUrl } from '../utils/customer-web';

const listOrdersQuerySchema = z.object({
  status: z.nativeEnum(OrderStatus).optional(),
});

const assignDriverSchema = z.object({
  driverId: z.string().min(1, 'El repartidor es obligatorio.'),
});

const acceptOrderSchema = z
  .object({
    preparationTimeMinutes: z.coerce.number().int().min(5).max(90).optional(),
    scheduledDeliveryAt: z.string().datetime().optional(),
  })
  .optional();

const extendPreparationTimeSchema = z.object({
  additionalMinutes: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(20)]),
});

const rescheduleDeliverySchema = z.object({
  estimatedDeliveryAt: z.string().datetime(),
});

export async function registerRestaurantOrderRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.register(async function restaurantOrdersScope(restaurantOrders) {
    restaurantOrders.addHook('preHandler', authenticate);
    restaurantOrders.addHook('preHandler', authorize([UserRole.RESTAURANT]));

    restaurantOrders.get('/restaurant-panel/pedidos', async (request, reply) => {
      const parsed = listOrdersQuerySchema.safeParse(request.query);

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_QUERY',
            message: parsed.error.issues[0]?.message || 'Query invalida.',
          },
        });
      }

      const user = getAuthenticatedUser(request);
      const myRestaurant = await prisma.restaurant.findUnique({ where: { userId: user.sub } });

      const items = await prisma.order.findMany({
        where: {
          OR: [
            { restaurant: { userId: user.sub } },
            ...(myRestaurant ? [{ supportRestaurantId: myRestaurant.id }] : []),
          ],
          ...(parsed.data.status ? { status: parsed.data.status } : {}),
        },
        select: restaurantOrderListSelect,
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      return reply.send({
        success: true,
        data: items,
      });
    });

    restaurantOrders.get('/restaurant-panel/pedidos/:id', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);

      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: params.error.issues[0]?.message || 'Parametros invalidos.',
          },
        });
      }

      const user = getAuthenticatedUser(request);
      const order = await getRestaurantScopedOrder(prisma, user.sub, params.data.id);

      if (!order) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'ORDER_NOT_FOUND',
            message: 'No se encontro el pedido.',
          },
        });
      }

      return reply.send({
        success: true,
        data: order,
      });
    });

    restaurantOrders.get('/restaurant-panel/pedidos/:id/delivery-token', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);

      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: params.error.issues[0]?.message || 'Parametros invalidos.',
          },
        });
      }

      const user = getAuthenticatedUser(request);

      try {
        const order = await prisma.order.findUnique({
          where: { id: params.data.id },
          include: { restaurant: true },
        });

        if (!order) {
          return reply.status(404).send({
            success: false,
            error: { code: 'ORDER_NOT_FOUND', message: 'No se encontró el pedido.' },
          });
        }

        // El token solo lo puede obtener el restaurante origen o el restaurante aliado que
        // aceptó la solicitud de apoyo (para mostrar el QR de entrega a su repartidor).
        const myRestaurant = await prisma.restaurant.findUnique({ where: { userId: user.sub } });
        const isOriginOwner = order.restaurant.userId === user.sub;
        const isSupportOwner = Boolean(myRestaurant && order.supportRestaurantId === myRestaurant.id);

        if (!isOriginOwner && !isSupportOwner) {
          return reply.status(403).send({
            success: false,
            error: { code: 'FORBIDDEN', message: 'No tienes permiso para ver este pedido.' },
          });
        }

        // Obtener o generar/autocurar el token de reparto existente
        let dToken = await (prisma as any).deliveryToken.findUnique({
          where: { orderId: order.id },
        });

        const crypto = require('node:crypto');
        const { hashToken } = require('../utils/crypto');
        const tokenStr = crypto.randomBytes(32).toString('hex');
        const hashedToken = hashToken(tokenStr);
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 3); // Vence en 3 horas

        if (!dToken) {
          dToken = await (prisma as any).deliveryToken.create({
            data: {
              orderId: order.id,
              token: hashedToken,
              expiresAt,
            },
          });
        } else {
          dToken = await (prisma as any).deliveryToken.update({
            where: { id: dToken.id },
            data: {
              token: hashedToken,
              expiresAt,
            },
          });
        }

        return reply.send({
          success: true,
          data: {
            token: tokenStr, // Devolver token en texto plano al cliente
            expiresAt: dToken.expiresAt,
            orderReference: order.orderReference,
            url: buildCustomerDeliveryUrl(tokenStr),
          },
        });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    restaurantOrders.get('/restaurant-panel/repartidores/disponibles', async (request, reply) => {
      const user = getAuthenticatedUser(request);

      try {
        const drivers = await getAvailableDriversForRestaurant(prisma, user.sub);

        return reply.send({
          success: true,
          data: drivers,
        });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    const restaurantActions = [
      {
        path: '/restaurant-panel/pedidos/:id/aceptar',
        status: OrderStatus.CONFIRMED,
        note: 'Pedido aceptado y confirmado.',
        customerEvent: 'order:accepted',
        pushTitle: '¡Pedido confirmado! 👍',
        pushBody: 'El restaurante aceptó tu solicitud y ha confirmado tu orden.',
        pushVibrate: [300, 100, 300],
        pushRequireInteraction: false,
        bodySchema: acceptOrderSchema,
      },
      {
        path: '/restaurant-panel/pedidos/:id/preparacion',
        status: OrderStatus.PREPARING,
        note: 'Pedido en preparación.',
        customerEvent: 'order:preparing',
        pushTitle: '¡En preparación! 🍳',
        pushBody: 'El restaurante comenzó a preparar tu orden.',
        pushVibrate: [300, 100, 300, 100, 300],
        pushRequireInteraction: false,
        bodySchema: null,
      },
      {
        path: '/restaurant-panel/pedidos/:id/rechazar',
        status: OrderStatus.REJECTED,
        note: 'Pedido rechazado.',
        customerEvent: 'order:rejected',
        pushTitle: 'Pedido rechazado 😔',
        pushBody: 'Lamentablemente el restaurante no pudo aceptar tu pedido.',
        pushVibrate: [800, 200, 800], // 2 heavy pulses
        pushRequireInteraction: true,
        bodySchema: null,
      },
      {
        path: '/restaurant-panel/pedidos/:id/listo',
        status: OrderStatus.READY,
        note: 'Pedido listo para recoger.',
        customerEvent: 'order:ready',
        pushTitle: '¡Tu pedido está listo! 🛍️',
        pushBody: 'El restaurante ha confirmado que tu orden está empacada y lista.',
        pushVibrate: [500, 250, 500, 250, 500, 250, 500],
        pushRequireInteraction: true,
        bodySchema: null,
      },
    ];

    for (const config of restaurantActions) {
      restaurantOrders.patch(config.path, async (request, reply) => {
        const params = z.object({ id: z.string().min(1) }).safeParse(request.params);

        if (!params.success) {
          return reply.status(400).send({
            success: false,
            error: {
              code: 'INVALID_PARAMS',
              message: params.error.issues[0]?.message || 'Parametros invalidos.',
            },
          });
        }

        const user = getAuthenticatedUser(request);
        const requestContext = getOrCreateRequestContext(request);
        const parsedBody = config.bodySchema ? config.bodySchema.safeParse(request.body) : null;

        if (parsedBody && !parsedBody.success) {
          return reply.status(400).send({
            success: false,
            error: {
              code: 'INVALID_PAYLOAD',
              message: parsedBody.error.issues[0]?.message || 'Datos invalidos.',
            },
          });
        }

        const preparationTimeMinutes =
          (config.status === OrderStatus.CONFIRMED || config.status === OrderStatus.PREPARING)
            ? parsedBody?.success
              ? parsedBody.data?.preparationTimeMinutes ?? 15
              : 15
            : undefined;

        const scheduledDeliveryAt =
          (config.status === OrderStatus.CONFIRMED || config.status === OrderStatus.PREPARING)
            ? parsedBody?.success
              ? parsedBody.data?.scheduledDeliveryAt
              : undefined
            : undefined;

        const isScheduleProposal = Boolean(scheduledDeliveryAt);

        try {
          let order = await updateOrderStatusByRestaurant({
            prisma,
            restaurantUserId: user.sub,
            orderId: params.data.id,
            nextStatus: config.status,
            trackingNote:
              (config.status === OrderStatus.CONFIRMED || config.status === OrderStatus.PREPARING)
                ? isScheduleProposal
                  ? `Pedido aceptado con fecha programada. Esperando confirmación del cliente.`
                  : `Pedido aceptado. Tiempo estimado de preparacion: ${preparationTimeMinutes === 35 ? '30+ min' : `${preparationTimeMinutes} min`
                  }.`
                : config.note,
            preparationTimeMinutes,
            scheduledDeliveryAt,
            isScheduleProposal,
          });

          // Dequeue resolved order and activate next in queue
          if (
            config.status === OrderStatus.CONFIRMED ||
            config.status === OrderStatus.PREPARING ||
            config.status === OrderStatus.REJECTED
          ) {
            const { nextOrderId, queueLength } = await dequeueRestaurantOrder(order.restaurant.id, params.data.id);
            if (nextOrderId && queueLength > 0) {
              emitNotification(
                fastify.io,
                user.sub,
                'RESTAURANT',
                'order:queue-next',
                {
                  orderId: nextOrderId,
                  queueLength,
                },
                {
                  requestId: requestContext.requestId,
                  orderId: nextOrderId,
                }
              );
            }
          }

          emitNotification(
            fastify.io,
            order.customer.user.id,
            'CUSTOMER',
            config.customerEvent,
            {
              orderId: params.data.id,
              status: config.status,
            },
            {
              requestId: requestContext.requestId,
              orderId: params.data.id,
            }
          );

          if (isScheduleProposal) {
            request.log.info(`[Push] Enviando notificacion de propuesta de programacion al comensal ${order.customer.user.id}`);
            try {
              const businessType = (order as any).restaurant?.businessType;
              const ref = getBusinessRef(businessType);
              const formattedDate = scheduledDeliveryAt
                ? new Date(scheduledDeliveryAt).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })
                : '';
              const formattedTime = scheduledDeliveryAt
                ? new Date(scheduledDeliveryAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
                : '';
              const pushResult = await sendPushNotification(order.customer.user.id, {
                title: `📅 ${ref} propuso una fecha de entrega`,
                body: `${ref} programó tu pedido para el ${formattedDate} a las ${formattedTime}. Ingresa para confirmar o cancelar.`,
                icon: '/app-icon-192.png',
                badge: '/badge.png',
                vibrate: [500, 200, 500, 200, 500],
                requireInteraction: true,
                tag: `schedule-proposal-${params.data.id}`,
                data: {
                  orderId: params.data.id,
                  event: 'order:schedule-proposal',
                  url: `/?orderId=${params.data.id}`,
                },
              });
              request.log.info(`[Push] Resultado notificacion propuesta programacion comensal ${order.customer.user.id}: ${JSON.stringify(pushResult)}`);
            } catch (pushErr) {
              request.log.error(pushErr as any, `[Push] Error al enviar notificacion de propuesta de programacion al comensal ${order.customer.user.id}`);
            }
          } else if (config.pushTitle && config.pushBody) {
            request.log.info(`[Push] Intentando enviar notificacion push al comensal ${order.customer.user.id} para el estado ${config.status}`);
            try {
              const businessType = (order as any).restaurant?.businessType;
              const isPickup = (order as any).fulfillmentType === 'PICKUP';
              const body = isPickup && config.status === OrderStatus.READY
                ? (isRestaurant(businessType)
                    ? 'Tu pedido está listo para recoger en sucursal. ¡Pasa por él! 🛍️'
                    : 'Tu pedido está listo para recoger en tienda. ¡Pasa por él! 🛍️')
                : isPickup
                  ? (isRestaurant(businessType)
                      ? config.pushBody
                      : config.pushBody
                        .replace(/el restaurante/gi, 'la tienda')
                        .replace(/del restaurante/gi, 'de la tienda')
                        .replace(/al restaurante/gi, 'a la tienda')
                        .replace(/tu orden/gi, 'tu pedido'))
                  : isRestaurant(businessType)
                    ? config.pushBody
                    : config.pushBody
                      .replace(/el restaurante/gi, 'la tienda')
                      .replace(/del restaurante/gi, 'de la tienda')
                      .replace(/al restaurante/gi, 'a la tienda')
                      .replace(/tu orden/gi, 'tu pedido');
              const pushResult = await sendPushNotification(order.customer.user.id, {
                title: config.pushTitle,
                body,
                icon: '/app-icon-192.png',
                badge: '/badge.png',
                vibrate: config.pushVibrate,
                requireInteraction: config.pushRequireInteraction,
                data: {
                  orderId: params.data.id,
                  event: config.customerEvent,
                  url: `/?orderId=${params.data.id}`,
                },
              });
              request.log.info(`[Push] Resultado de notificacion push para comensal ${order.customer.user.id}: ${JSON.stringify(pushResult)}`);
            } catch (pushErr) {
              request.log.error(pushErr as any, `[Push] Error al enviar notificacion push al comensal ${order.customer.user.id}`);
            }
          }

          if (order.driver?.user?.id) {
            emitNotification(
              fastify.io,
              order.driver.user.id,
              'DRIVER',
              config.customerEvent,
              {
                orderId: params.data.id,
                status: config.status,
              },
              {
                requestId: requestContext.requestId,
                orderId: params.data.id,
              }
            );

            // Push notification to driver when order is READY for pickup
            if (config.status === OrderStatus.READY) {
              request.log.info(`[Push] Enviando notificacion de recogida al repartidor ${order.driver.user.id} para pedido ${params.data.id}`);
              try {
                const pushResult = await sendPushNotification(order.driver.user.id, {
                  title: 'Pedido listo para recoger',
                  body: `El pedido de ${order.restaurant.name} está listo. Pasa a recogerlo a ${getBusinessRef(order.restaurant?.businessType)}.`,
                  icon: '/app-icon-192.png',
                  badge: '/badge.png',
                  vibrate: [500, 200, 500],
                  requireInteraction: true,
                  tag: `order-ready-${params.data.id}`,
                  data: {
                    orderId: params.data.id,
                    event: 'order:ready',
                    url: `/?orderId=${params.data.id}`,
                  },
                });
                request.log.info(`[Push] Resultado notificacion recogida repartidor ${order.driver.user.id}: ${JSON.stringify(pushResult)}`);
              } catch (pushErr) {
                request.log.error(pushErr as any, `[Push] Error al enviar notificacion de recogida al repartidor ${order.driver.user.id}`);
              }
            }
          }

          // Verificar disponibilidad de repartidores inmediatamente al aceptar (solo delivery, skip schedule proposals)
          if (!isScheduleProposal && (config.status === OrderStatus.CONFIRMED || config.status === OrderStatus.PREPARING) && !order.restaurant.hasOwnDelivery && order.fulfillmentType !== 'PICKUP') {
            try {
              const availableDrivers = await getAvailableDriversForRestaurant(prisma, user.sub, params.data.id);
              if (availableDrivers.length === 0) {
                emitNotification(
                  fastify.io,
                  user.sub,
                  'RESTAURANT',
                  'order:no-drivers-available-on-accept',
                  {
                    orderId: params.data.id,
                    message: 'Aceptaste el pedido, pero nota que no hay repartidores conectados en tu zona en este momento.',
                  },
                  {
                    requestId: requestContext.requestId,
                    orderId: params.data.id,
                  }
                );
              }
            } catch (err) {
              console.error('Failed to check available drivers on accept:', err);
            }
          }

          let shouldDispatchImmediately = false;
          if (isScheduleProposal) {
            request.log.info(`[JIT] Saltando asignacion para pedido ${order.id} porque es propuesta de programacion. Se asignara cuando el cliente confirme.`);
          } else if (config.status === OrderStatus.READY) {
            shouldDispatchImmediately = true;
          } else if (config.status === OrderStatus.CONFIRMED || config.status === OrderStatus.PREPARING) {
            if (order.preparationDeadlineAt) {
              const msUntilDeadline = new Date(order.preparationDeadlineAt).getTime() - Date.now();
              const JIT_BUFFER_MS = 8 * 60 * 1000;
              if (msUntilDeadline <= JIT_BUFFER_MS) {
                shouldDispatchImmediately = true;
              } else {
                request.log.info(`[JIT] Retrasando asignación para pedido ${order.id}. Faltan ${Math.round(msUntilDeadline / 60000)} min. Se asignará por cronjob en el momento óptimo.`);
              }
            } else if (order.estimatedDeliveryTime) {
              const msUntilDelivery = new Date(order.estimatedDeliveryTime).getTime() - Date.now();
              const JIT_BUFFER_MS = 8 * 60 * 1000;
              if (msUntilDelivery <= JIT_BUFFER_MS) {
                shouldDispatchImmediately = true;
              } else {
                request.log.info(`[JIT] Retrasando asignación para pedido ${order.id}. Faltan ${Math.round(msUntilDelivery / 60000)} min para la entrega. Se asignará por cronjob en el momento óptimo.`);
              }
            } else {
              shouldDispatchImmediately = true;
            }
          }

          // AUTO-ASSIGN DRIVER (Immediate or JIT fallback) — solo delivery
          if (shouldDispatchImmediately && !order.restaurant.hasOwnDelivery && !order.driverId && !order.driver && order.fulfillmentType !== 'PICKUP') {
            setTimeout(async () => {
              try {
                const assignResult = await autoAssignDriver(prisma, params.data.id, user.sub);
                if (assignResult.success && assignResult.driver && assignResult.order) {
                  const updatedOrder = assignResult.order;

                  emitNotification(
                    fastify.io,
                    assignResult.driver.userId,
                    'DRIVER',
                    'order:assigned',
                    {
                      orderId: updatedOrder.id,
                      orderReference: updatedOrder.orderReference,
                      restaurantName: updatedOrder.restaurant.name,
                      customerName: updatedOrder.customer.user.name,
                    },
                    {
                      requestId: requestContext.requestId,
                      orderId: updatedOrder.id,
                    }
                  );

                  emitNotification(
                    fastify.io,
                    updatedOrder.customer.user.id,
                    'CUSTOMER',
                    'order:driver-assigned',
                    {
                      orderId: updatedOrder.id,
                      driverName: assignResult.driver.user.name,
                    },
                    {
                      requestId: requestContext.requestId,
                      orderId: updatedOrder.id,
                    }
                  );

                  // Notify restaurant that driver was assigned
                  emitNotification(
                    fastify.io,
                    user.sub,
                    'RESTAURANT',
                    'order:driver-assigned',
                    {
                      orderId: updatedOrder.id,
                      driverName: assignResult.driver.user.name,
                    },
                    {
                      requestId: requestContext.requestId,
                      orderId: updatedOrder.id,
                    }
                  );

                  request.log.info(`Auto-assigned driver ${assignResult.driver.id} to order ${params.data.id} in background.`);
                } else {
                  // No drivers found: update database
                  await prisma.order.update({
                    where: { id: params.data.id },
                    data: { noDriversAvailable: true },
                  });

                  // Notify restaurant
                  emitNotification(
                    fastify.io,
                    user.sub,
                    'RESTAURANT',
                    'order:no-drivers-available',
                    {
                      orderId: params.data.id,
                      message: order.restaurant?.businessType !== 'RESTAURANT'
                        ? 'No se encontraron repartidores disponibles para la entrega programada.'
                        : 'No se encontraron repartidores disponibles para tu pedido.',
                    },
                    {
                      requestId: requestContext.requestId,
                      orderId: params.data.id,
                    }
                  );

                  request.log.info(`No drivers found for order ${params.data.id} in background.`);
                }
              } catch (err) {
                console.error('Failed to auto-assign driver immediately in background:', err);
              }
            }, 3500);
          }

          return reply.send({
            success: true,
            data: order,
          });
        } catch (error) {
          return sendAppError(reply, error);
        }
      });
    }

    restaurantOrders.post('/restaurant-panel/pedidos/:id/extender-tiempo', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      const parsedBody = extendPreparationTimeSchema.safeParse(request.body);

      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: params.error.issues[0]?.message || 'Parametros invalidos.',
          },
        });
      }

      if (!parsedBody.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: parsedBody.error.issues[0]?.message || 'Datos invalidos.',
          },
        });
      }

      const user = getAuthenticatedUser(request);
      const requestContext = getOrCreateRequestContext(request);

      try {
        const order = await extendOrderPreparationTime({
          prisma,
          restaurantUserId: user.sub,
          orderId: params.data.id,
          additionalMinutes: parsedBody.data.additionalMinutes,
        });

        emitNotification(
          fastify.io,
          order.customer.user.id,
          'CUSTOMER',
          'order:eta-updated',
          {
            orderId: params.data.id,
            status: order.status,
            estimatedDeliveryTime: order.estimatedDeliveryTime,
            additionalMinutes: parsedBody.data.additionalMinutes,
          },
          {
            requestId: requestContext.requestId,
            orderId: params.data.id,
          }
        );

        await sendPushNotification(order.customer.user.id, {
          title: 'Actualizamos tu hora estimada',
          body: `${getBusinessArticleCapitalized(order.restaurant?.businessType)} ${getBusinessRef(order.restaurant?.businessType)} agrego ${parsedBody.data.additionalMinutes} min para preparar bien tu pedido.`,
          data: {
            orderId: order.id,
            event: 'order:eta-updated',
            url: `/?orderId=${order.id}`,
          },
        }).catch((error) => {
          console.error('Error sending ETA update push notification:', error);
        });

        return reply.send({
          success: true,
          data: order,
        });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    restaurantOrders.post('/restaurant-panel/pedidos/:id/reprogramar-entrega', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      const parsedBody = rescheduleDeliverySchema.safeParse(request.body);

      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: params.error.issues[0]?.message || 'Parametros invalidos.',
          },
        });
      }

      if (!parsedBody.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: parsedBody.error.issues[0]?.message || 'Datos invalidos.',
          },
        });
      }

      const user = getAuthenticatedUser(request);
      const requestContext = getOrCreateRequestContext(request);

      try {
        const order = await rescheduleDeliveryTime({
          prisma,
          restaurantUserId: user.sub,
          orderId: params.data.id,
          estimatedDeliveryAt: parsedBody.data.estimatedDeliveryAt,
        });

        emitNotification(
          fastify.io,
          order.customer.user.id,
          'CUSTOMER',
          'order:eta-updated',
          {
            orderId: params.data.id,
            status: order.status,
            estimatedDeliveryTime: order.estimatedDeliveryTime,
          },
          {
            requestId: requestContext.requestId,
            orderId: params.data.id,
          }
        );

        await sendPushNotification(order.customer.user.id, {
          title: 'Reprogramamos tu entrega',
          body: `${getBusinessArticleCapitalized(order.restaurant?.businessType)} ${getBusinessRef(order.restaurant?.businessType)} reprogramo la entrega para ${new Date(parsedBody.data.estimatedDeliveryAt).toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short' })}.`,
          data: {
            orderId: order.id,
            event: 'order:eta-updated',
            url: `/?orderId=${order.id}`,
          },
        }).catch((error) => {
          console.error('Error sending reschedule push notification:', error);
        });

        return reply.send({
          success: true,
          data: order,
        });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    restaurantOrders.post('/restaurant-panel/pedidos/:id/asignar-repartidor', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      const parsed = assignDriverSchema.safeParse(request.body);

      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: params.error.issues[0]?.message || 'Parametros invalidos.',
          },
        });
      }

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: parsed.error.issues[0]?.message || 'Datos invalidos.',
          },
        });
      }

      const user = getAuthenticatedUser(request);
      const requestContext = getOrCreateRequestContext(request);

      try {
        const targetOrder = await prisma.order.findUnique({
          where: { id: params.data.id },
          select: { supportRestaurantId: true },
        });

        if (targetOrder?.supportRestaurantId) {
          return reply.status(400).send({
            success: false,
            error: {
              code: 'ALREADY_SUPPORTED',
              message: 'Este pedido ya fue aceptado por un restaurante aliado y no puede asignarse a un repartidor.',
            },
          });
        }

        const order = await assignDriverToOrder({
          prisma,
          restaurantUserId: user.sub,
          orderId: params.data.id,
          driverId: parsed.data.driverId,
        });

        if (!order.driver) {
          return reply.status(500).send({
            success: false,
            error: {
              code: 'DRIVER_ASSIGNMENT_FAILED',
              message: 'No se pudo completar la asignacion del repartidor.',
            },
          });
        }

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
            requestId: requestContext.requestId,
            orderId: order.id,
          }
        );

        try {
          await sendPushNotification(order.driver.userId, {
            title: '🛵 Nuevo pedido asignado',
            body: `${order.restaurant.name} — Gana $${Number(order.deliveryFee || 0).toFixed(2)} · ${Number(order.deliveryDistanceKm || 0).toFixed(1)} km`,
            icon: '/app-icon-192.png',
            badge: '/badge.png',
            vibrate: [500, 200, 500, 200, 500],
            requireInteraction: true,
            sound: '/sounds/notifica.wav',
            data: {
              orderId: order.id,
              orderReference: order.orderReference,
              url: `/?orderId=${order.id}`,
            },
            tag: `order-assigned-${order.id}`,
          });
        } catch (pushErr) {
          request.log.error(pushErr as any, `[Push] Error al notificar al repartidor ${order.driver.userId} sobre asignación manual`);
        }

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
            requestId: requestContext.requestId,
            orderId: order.id,
          }
        );

        return reply.send({
          success: true,
          data: order,
        });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    restaurantOrders.patch('/restaurant-panel/pedidos/:id/asumir-reparto', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);

      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: params.error.issues[0]?.message || 'Parametros invalidos.',
          },
        });
      }

      const user = getAuthenticatedUser(request);
      const requestContext = getOrCreateRequestContext(request);

      try {
        const order = await prisma.order.findUnique({
          where: { id: params.data.id },
          include: { restaurant: true },
        });

        if (!order) {
          return reply.status(404).send({
            success: false,
            error: {
              code: 'ORDER_NOT_FOUND',
              message: 'No se encontro el pedido.',
            },
          });
        }

        if (order.restaurant.userId !== user.sub) {
          return reply.status(403).send({
            success: false,
            error: {
              code: 'FORBIDDEN',
              message: 'No tienes permiso para modificar este pedido.',
            },
          });
        }

        // Avanzar el estado a IN_TRANSIT (asumiendo que el restaurante sale a entregarlo)
        const updatedOrder = await prisma.order.update({
          where: { id: order.id },
          data: {
            status: OrderStatus.IN_TRANSIT,
            driverId: null, // Asegurar que no tenga repartidor asignado
            deliveredByRestaurant: true,
          },
          include: {
            customer: {
              include: {
                user: true,
              },
            },
          },
        });

        // Registrar evento de tracking
        await prisma.orderTracking.create({
          data: {
            orderId: order.id,
            status: OrderStatus.IN_TRANSIT,
            notes: 'El repartidor inició la entrega del pedido.',
          },
        });

        // Notificar al cliente que el pedido va en camino (por el restaurante)
        emitNotification(
          fastify.io,
          updatedOrder.customer.user.id,
          'CUSTOMER',
          'order:in-transit',
          {
            orderId: updatedOrder.id,
            status: 'IN_TRANSIT',
            message: `${getBusinessArticleCapitalized(order.restaurant?.businessType)} ${getBusinessRef(order.restaurant?.businessType)} asumio el reparto y va en camino.`,
          },
          {
            requestId: requestContext.requestId,
            orderId: updatedOrder.id,
          }
        );

        // Notificar al restaurante
        emitNotification(
          fastify.io,
          user.sub,
          'RESTAURANT',
          'order:in-transit',
          {
            orderId: updatedOrder.id,
            orderReference: updatedOrder.orderReference,
            status: 'IN_TRANSIT',
            customerName: updatedOrder.customer?.user?.name,
          },
          {
            requestId: requestContext.requestId,
            orderId: updatedOrder.id,
          }
        );

        // Enviar notificación push al comensal
        request.log.info(`[Push] Intentando enviar notificacion push al comensal ${updatedOrder.customer.user.id} para reparto propio (IN_TRANSIT)`);
        try {
          const pushResult = await sendPushNotification(updatedOrder.customer.user.id, {
            title: '¡Tu pedido va en camino!',
            body: `${getBusinessArticleCapitalized(order.restaurant?.businessType)} ${getBusinessRef(order.restaurant?.businessType)} ha enviado tu pedido y va hacia tu dirección.`,
            icon: '/app-icon-192.png',
            badge: '/badge.png',
            vibrate: [300, 100, 300, 100, 300], // 3 pulses
            requireInteraction: false,
            data: {
              orderId: updatedOrder.id,
              event: 'order:in-transit',
              url: `/?orderId=${updatedOrder.id}`,
            },
          });
          request.log.info(`[Push] Resultado de notificacion push para comensal ${updatedOrder.customer.user.id}: ${JSON.stringify(pushResult)}`);
        } catch (pushErr) {
          request.log.error(pushErr as any, `[Push] Error al enviar notificacion push al comensal ${updatedOrder.customer.user.id}`);
        }

        // Generar un token de reparto seguro de un solo uso para código QR
        const crypto = require('node:crypto');
        const { hashToken } = require('../utils/crypto');
        const tokenStr = crypto.randomBytes(32).toString('hex');
        const hashedToken = hashToken(tokenStr);
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 3); // Vence en 3 horas

        const dToken = await (prisma as any).deliveryToken.upsert({
          where: { orderId: updatedOrder.id },
          update: {
            token: hashedToken,
            expiresAt,
          },
          create: {
            orderId: updatedOrder.id,
            token: hashedToken,
            expiresAt,
          },
        });

        return reply.send({
          success: true,
          data: {
            ...updatedOrder,
            deliveryToken: {
              token: tokenStr, // Devolver token en texto plano al cliente
              expiresAt: dToken.expiresAt,
              url: buildCustomerDeliveryUrl(tokenStr),
            },
          },
        });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    restaurantOrders.patch('/restaurant-panel/pedidos/:id/quitar-repartidor', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);

      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: params.error.issues[0]?.message || 'Parametros invalidos.',
          },
        });
      }

      const user = getAuthenticatedUser(request);
      const requestContext = getOrCreateRequestContext(request);

      try {
        const order = await prisma.order.findUnique({
          where: { id: params.data.id },
          include: { restaurant: true, driver: true },
        });

        if (!order) {
          return reply.status(404).send({
            success: false,
            error: {
              code: 'ORDER_NOT_FOUND',
              message: 'No se encontro el pedido.',
            },
          });
        }

        if (order.restaurant.userId !== user.sub) {
          return reply.status(403).send({
            success: false,
            error: {
              code: 'FORBIDDEN',
              message: 'No tienes permiso para modificar este pedido.',
            },
          });
        }

        if (!order.driverId) {
          return reply.status(400).send({
            success: false,
            error: {
              code: 'NO_DRIVER_ASSIGNED',
              message: 'Este pedido no tiene un repartidor asignado.',
            },
          });
        }

        if (order.driverArrivedAt) {
          return reply.status(400).send({
            success: false,
            error: {
              code: 'DRIVER_ALREADY_ARRIVED',
              message: 'No puedes quitar al repartidor porque ya llegó al establecimiento.',
            },
          });
        }

        const oldDriverUserId = order.driver?.userId;

        // Quitar el repartidor del pedido
        const updatedOrder = await prisma.order.update({
          where: { id: order.id },
          data: {
            driverId: null,
          },
          include: {
            customer: {
              include: {
                user: true,
              },
            },
          },
        });

        // Liberar al repartidor (ponerlo AVAILABLE de nuevo si estaba BUSY)
        // Solo si no tiene otros pedidos activos!
        const activeOrdersCount = await prisma.order.count({
          where: {
            driverId: order.driverId,
            status: { in: [OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.READY, OrderStatus.PICKED_UP, OrderStatus.IN_TRANSIT] },
          },
        });

        if (activeOrdersCount === 0) {
          await prisma.driver.update({
            where: { id: order.driverId },
            data: {
              availability: DriverAvailability.AVAILABLE,
            },
          });
        }

        // Notificar al cliente que el repartidor fue removido
        emitNotification(
          fastify.io,
          updatedOrder.customer.user.id,
          'CUSTOMER',
          'order:driver-unassigned',
          {
            orderId: updatedOrder.id,
            message: 'El repartidor fue desvinculado del pedido.',
          },
          {
            requestId: requestContext.requestId,
            orderId: updatedOrder.id,
          }
        );

        // Notificar al repartidor que fue removido
        if (oldDriverUserId) {
          emitNotification(
            fastify.io,
            oldDriverUserId,
            'DRIVER',
            'order:unassigned',
            {
              orderId: updatedOrder.id,
              message: 'Fuiste desvinculado de este pedido.',
            },
            {
              requestId: requestContext.requestId,
              orderId: updatedOrder.id,
            }
          );
        }

        return reply.send({
          success: true,
          data: updatedOrder,
        });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    restaurantOrders.patch('/restaurant-panel/pedidos/:id/confirmar-pago-efectivo', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);

      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_PARAMS', message: 'Parametros invalidos.' },
        });
      }

      const user = getAuthenticatedUser(request);

      try {
        const order = await prisma.order.findFirst({
          where: { id: params.data.id },
          include: { restaurant: true },
        });

        if (!order) {
          return reply.status(404).send({ success: false, error: { code: 'ORDER_NOT_FOUND', message: 'Pedido no encontrado.' } });
        }

        if (order.restaurant.userId !== user.sub) {
          return reply.status(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'No tienes permiso.' } });
        }

        if (order.paymentMethod !== 'CASH') {
          return reply.status(409).send({ success: false, error: { code: 'NOT_CASH_ORDER', message: 'Este pedido no es de pago en efectivo.' } });
        }

        if (order.status !== 'PICKED_UP') {
          return reply.status(409).send({ success: false, error: { code: 'INVALID_STATUS', message: 'El pedido debe estar en estado RECOGIDO para confirmar el pago.' } });
        }

        const updatedOrder = await prisma.order.update({
          where: { id: order.id },
          data: { cashPaymentConfirmedAt: new Date() },
        });

        // Notificar al repartidor en tiempo real para habilitar el botón
        try {
          fastify.io.to(`order:${order.id}`).emit('order:cash-payment-confirmed', { orderId: order.id });
          if (order.driverId) {
            fastify.io.to(`driver:${order.driverId}`).emit('order:cash-payment-confirmed', { orderId: order.id });
          }
        } catch (socketError) {
          console.error('[confirmar-pago-efectivo] Error al emitir socket:', socketError);
        }

        return reply.send({ success: true, data: updatedOrder });
      } catch (error) {
        console.error('[confirmar-pago-efectivo] Error:', error);
        return sendAppError(reply, error);
      }
    });

    restaurantOrders.patch('/restaurant-panel/pedidos/:id/handover', async (request, reply) => {

      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      const body = z.object({ pin: z.string().optional() }).safeParse(request.body);

      if (!params.success || !body.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: 'Parametros invalidos.',
          },
        });
      }

      const user = getAuthenticatedUser(request);
      const requestContext = getOrCreateRequestContext(request);

      try {
        const updatedOrder = await handoverOrderFromRestaurant({
          prisma,
          restaurantUserId: user.sub,
          orderId: params.data.id,
          pin: body.data.pin,
        });

        fastify.io.to(`order:${params.data.id}`).emit('order:updated', updatedOrder);
        if (updatedOrder.driver?.userId) {
          emitNotification(fastify.io, updatedOrder.driver.userId, 'DRIVER', 'order:status-changed', {
            orderId: params.data.id,
            status: updatedOrder.status,
          });
        }

        return reply.send({
          success: true,
          data: updatedOrder,
        });
      } catch (error) {
        if ((error as any)?.code === 'PIN_RESET') {
          const refreshedOrder = await prisma.order.findUnique({
            where: { id: params.data.id },
            select: { id: true, handoverPin: true, driverId: true, driver: { select: { userId: true } } },
          });
          if (refreshedOrder?.handoverPin && refreshedOrder.driver?.userId) {
            emitNotification(fastify.io, refreshedOrder.driver.userId, 'DRIVER', 'order:pin-reset', {
              orderId: params.data.id,
              handoverPin: refreshedOrder.handoverPin,
            });
          }
        }
        return sendAppError(reply, error);
      }
    });

    restaurantOrders.patch('/restaurant-panel/pedidos/:id/marcar-recogido', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      const body = z.object({ pin: z.string().optional() }).safeParse(request.body);

      if (!params.success || !body.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: 'Parametros invalidos.',
          },
        });
      }

      const user = getAuthenticatedUser(request);
      const requestContext = getOrCreateRequestContext(request);

      try {
        const updatedOrder = await completePickupByRestaurant({
          prisma,
          restaurantUserId: user.sub,
          orderId: params.data.id,
          pin: body.data.pin,
        });

        fastify.io.to(`order:${params.data.id}`).emit('order:updated', updatedOrder);
        if (updatedOrder.customer?.user?.id) {
          emitNotification(fastify.io, updatedOrder.customer.user.id, 'CUSTOMER', 'order:completed', {
            orderId: params.data.id,
            status: 'COMPLETED',
          });
          sendPushNotification(updatedOrder.customer.user.id, {
            title: '¡Pedido recogido! ✅',
            body: 'Gracias por tu compra. Que lo disfrutes.',
            vibrate: [300, 100, 300],
            requireInteraction: false,
          });
        }

        return reply.send({
          success: true,
          data: updatedOrder,
        });
      } catch (error) {
        if ((error as any)?.code === 'PIN_RESET') {
          const refreshedOrder = await prisma.order.findUnique({
            where: { id: params.data.id },
            select: { id: true, pickupPin: true, customer: { select: { user: { select: { id: true } } } } },
          });
          if (refreshedOrder?.pickupPin) {
            emitNotification(fastify.io, refreshedOrder.customer.user.id, 'CUSTOMER', 'order:pin-reset', {
              orderId: params.data.id,
              pickupPin: refreshedOrder.pickupPin,
            });
            sendPushNotification(refreshedOrder.customer.user.id, {
              title: '🔄 Nuevo PIN de recolección',
              body: `Tu nuevo PIN es: ${refreshedOrder.pickupPin}. Proporciónalo al restaurante para recoger tu pedido.`,
              vibrate: [500, 250, 500],
              requireInteraction: true,
            });
          }
        }
        return sendAppError(reply, error);
      }
    });

    restaurantOrders.patch('/restaurant-panel/pedidos/:id/entregado', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);

      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: params.error.issues[0]?.message || 'Parametros invalidos.',
          },
        });
      }

      const user = getAuthenticatedUser(request);
      const requestContext = getOrCreateRequestContext(request);

      try {
        const order = await prisma.order.findUnique({
          where: { id: params.data.id },
          include: { restaurant: true },
        });

        if (!order) {
          return reply.status(404).send({
            success: false,
            error: {
              code: 'ORDER_NOT_FOUND',
              message: 'No se encontro el pedido.',
            },
          });
        }

        if (order.restaurant.userId !== user.sub) {
          return reply.status(403).send({
            success: false,
            error: {
              code: 'FORBIDDEN',
              message: 'No tienes permiso para modificar este pedido.',
            },
          });
        }

        // Marcar como entregado
        const updatedOrder = await prisma.order.update({
          where: { id: order.id },
          data: {
            status: OrderStatus.DELIVERED,
            deliveredAt: new Date(),
            ...(order.paymentMethod === 'CASH' ? { paymentStatus: 'COMPLETED' } : {}),
          },
          include: {
            customer: {
              include: {
                user: true,
              },
            },
          },
        });

        // Registrar evento de tracking
        await prisma.orderTracking.create({
          data: {
            orderId: order.id,
            status: OrderStatus.DELIVERED,
            notes: 'Pedido entregado exitosamente.',
          },
        });

        // Notificar al cliente que el pedido fue entregado
        emitNotification(
          fastify.io,
          updatedOrder.customer.user.id,
          'CUSTOMER',
          'order:delivered',
          {
            orderId: updatedOrder.id,
            status: 'DELIVERED',
            message: 'Tu pedido ha sido entregado.',
          },
          {
            requestId: requestContext.requestId,
            orderId: updatedOrder.id,
          }
        );

        // Notificar al restaurante
        emitNotification(
          fastify.io,
          user.sub,
          'RESTAURANT',
          'order:delivered',
          {
            orderId: updatedOrder.id,
            orderReference: updatedOrder.orderReference,
            status: 'DELIVERED',
            customerName: updatedOrder.customer?.user?.name,
          },
          {
            requestId: requestContext.requestId,
            orderId: updatedOrder.id,
          }
        );

        // Enviar notificación push al comensal
        request.log.info(`[Push] Intentando enviar notificacion push al comensal ${updatedOrder.customer.user.id} para reparto propio (DELIVERED)`);
        try {
          const pushResult = await sendPushNotification(updatedOrder.customer.user.id, {
            title: '¡Pedido entregado! 🎉',
            body: 'Tu pedido ha sido entregado exitosamente. ¡Que lo disfrutes!',
            icon: '/app-icon-192.png',
            badge: '/badge.png',
            vibrate: [1000, 500, 1000, 500, 1000], // 3 long pulses
            requireInteraction: true,
            data: {
              orderId: updatedOrder.id,
              event: 'order:delivered',
              url: `/?orderId=${updatedOrder.id}`,
            },
          });
          request.log.info(`[Push] Resultado de notificacion push para comensal ${updatedOrder.customer.user.id}: ${JSON.stringify(pushResult)}`);
        } catch (pushErr) {
          request.log.error(pushErr as any, `[Push] Error al enviar notificacion push al comensal ${updatedOrder.customer.user.id}`);
        }

        return reply.send({
          success: true,
          data: updatedOrder,
        });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    // LISTAR PEDIDOS QUE SOLICITAN APOYO
    restaurantOrders.get('/restaurant-panel/pedidos-apoyo', async (request, reply) => {
      const user = getAuthenticatedUser(request);

      try {
        const myRestaurant = await prisma.restaurant.findUnique({
          where: { userId: user.sub },
        });

        if (!myRestaurant) {
          return reply.status(404).send({
            success: false,
            error: {
              code: 'RESTAURANT_NOT_FOUND',
              message: 'No se encontro tu restaurante.',
            },
          });
        }

        const orders = await prisma.order.findMany({
          where: {
            status: OrderStatus.READY,
            driverId: null,
            isSupportRequested: true,
            supportRestaurantId: null,
            restaurantId: { not: myRestaurant.id },
          },
          include: { restaurant: true },
        });

        // Filtrar por distancia <= 2km
        const nearbyOrders = orders.filter((order) => {
          if (!order.restaurant.latitude || !order.restaurant.longitude || !myRestaurant.latitude || !myRestaurant.longitude) {
            return false;
          }
          const dist = getDistanceInKm(
            { latitude: myRestaurant.latitude, longitude: myRestaurant.longitude },
            { latitude: order.restaurant.latitude, longitude: order.restaurant.longitude }
          );
          return dist <= 2.0;
        });

        return reply.send({
          success: true,
          data: nearbyOrders,
        });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    // SOLICITAR APOYO A OTROS RESTAURANTES
    restaurantOrders.patch('/restaurant-panel/pedidos/:id/solicitar-apoyo', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);

      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: params.error.issues[0]?.message || 'Parametros invalidos.',
          },
        });
      }

      const user = getAuthenticatedUser(request);
      const requestContext = getOrCreateRequestContext(request);

      try {
        const order = await prisma.order.findUnique({
          where: { id: params.data.id },
          include: { restaurant: true, address: true },
        });

        if (!order) {
          return reply.status(404).send({
            success: false,
            error: {
              code: 'ORDER_NOT_FOUND',
              message: 'No se encontro el pedido.',
            },
          });
        }

        if (order.restaurant.userId !== user.sub) {
          return reply.status(403).send({
            success: false,
            error: {
              code: 'FORBIDDEN',
              message: 'No tienes permiso para modificar este pedido.',
            },
          });
        }

        if (order.status !== OrderStatus.READY && !order.noDriversAvailable) {
          return reply.status(400).send({
            success: false,
            error: {
              code: 'INVALID_STATUS',
              message: 'Solo se puede solicitar apoyo para pedidos listos o sin repartidores disponibles.',
            },
          });
        }

        if (order.driverId) {
          return reply.status(400).send({
            success: false,
            error: {
              code: 'HAS_DRIVER',
              message: 'Este pedido ya tiene un repartidor asignado.',
            },
          });
        }

        if (order.supportRestaurantId) {
          return reply.status(400).send({
            success: false,
            error: {
              code: 'ALREADY_SUPPORTED',
              message: 'Este pedido ya fue aceptado por un restaurante aliado.',
            },
          });
        }

        const originLat = order.restaurant.latitude;
        const originLng = order.restaurant.longitude;

        if (!originLat || !originLng) {
          return reply.status(400).send({
            success: false,
            error: {
              code: 'NO_COORDINATES',
              message: 'El restaurante no tiene coordenadas configuradas.',
            },
          });
        }

        // Buscar restaurantes cercanos con reparto propio
        const restaurants = await prisma.restaurant.findMany({
          where: {
            id: { not: order.restaurant.id },
            hasOwnDelivery: true,
            status: 'ACTIVE',
            isAcceptingOrders: true,
          },
          select: {
            id: true,
            name: true,
            userId: true,
            latitude: true,
            longitude: true,
          },
        });

        const nearbyRestaurants = restaurants.filter((r) => {
          if (!r.latitude || !r.longitude) return false;
          const dist = getDistanceInKm(
            { latitude: originLat, longitude: originLng },
            { latitude: r.latitude, longitude: r.longitude }
          );
          return dist <= 2.0; // 2 km radius
        });

        if (nearbyRestaurants.length === 0) {
          return reply.status(404).send({
            success: false,
            error: {
              code: 'NO_RESTAURANTS_FOUND',
              message: 'No se encontraron restaurantes con reparto propio a menos de 2km.',
            },
          });
        }

        // Actualizar el pedido para marcar que solicita apoyo
        await prisma.order.update({
          where: { id: order.id },
          data: {
            isSupportRequested: true,
            supportCount: nearbyRestaurants.length,
            supportRejectionCount: 0,
          },
        });

        // Emitir notificaciones a los restaurantes cercanos
        for (const r of nearbyRestaurants) {
          const dist = getDistanceInKm(
            { latitude: originLat, longitude: originLng },
            { latitude: r.latitude!, longitude: r.longitude! }
          );
          emitNotification(
            fastify.io,
            r.userId,
            'RESTAURANT',
            'order:support-requested',
            {
              orderId: order.id,
              restaurantName: order.restaurant.name,
              deliveryFee: order.deliveryFee,
              address: order.address ? `${order.address.street} ${order.address.number}, ${order.address.neighborhood}` : 'Recoger en tienda',
              distanceToRestaurant: dist,
              message: `El restaurante ${order.restaurant.name} solicita apoyo para una entrega. Tarifa: $${order.deliveryFee}`,
            },
            {
              requestId: requestContext.requestId,
              orderId: order.id,
            }
          );

          // Send Push Notification to nearby restaurant
          void sendPushNotification(r.userId, {
            title: '¡Solicitud de Apoyo!',
            body: `El restaurante ${order.restaurant.name} solicita apoyo para una entrega. Tarifa: $${order.deliveryFee}`,
            data: {
              orderId: order.id,
              tag: `support-request-${order.id}`,
              vibrate: [500, 100, 500, 100, 500, 100, 500],
              url: `/?orderId=${order.id}`,
            }
          }).catch((err) => {
            request.log.error('Error sending push for support request', err);
          });
        }

        // Configurar temporizador de 2 minutos para cancelar la solicitud si nadie acepta
        setTimeout(async () => {
          try {
            const currentOrder = await prisma.order.findUnique({
              where: { id: order.id },
              select: { supportRestaurantId: true, restaurant: { select: { userId: true } }, orderReference: true },
            });

            if (currentOrder && !currentOrder.supportRestaurantId) {
              // Nadie aceptó en 2 minutos!
              await prisma.order.update({
                where: { id: order.id },
                data: {
                  isSupportRequested: false,
                },
              });

              emitNotification(
                fastify.io,
                currentOrder.restaurant.userId,
                'RESTAURANT',
                'order:support-rejected-all',
                {
                  orderId: order.id,
                  message: `Expiro el tiempo de 2 minutos y ningun restaurante acepto tu solicitud de apoyo para el pedido ${currentOrder.orderReference}.`,
                },
                {
                  requestId: requestContext.requestId,
                  orderId: order.id,
                }
              );
            }
          } catch (err) {
            console.error('Error in support request timeout:', err);
          }
        }, 2 * 60 * 1000);

        return reply.send({
          success: true,
          message: `Solicitud enviada a ${nearbyRestaurants.length} restaurantes cercanos.`,
        });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    // ACEPTAR APOYO DE OTRO RESTAURANTE
    restaurantOrders.post('/restaurant-panel/pedidos/:id/aceptar-apoyo', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);

      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: params.error.issues[0]?.message || 'Parametros invalidos.',
          },
        });
      }

      const user = getAuthenticatedUser(request);
      const requestContext = getOrCreateRequestContext(request);

      try {
        const supportRestaurant = await prisma.restaurant.findUnique({
          where: { userId: user.sub },
        });

        if (!supportRestaurant) {
          return reply.status(404).send({
            success: false,
            error: {
              code: 'RESTAURANT_NOT_FOUND',
              message: 'No se encontro tu restaurante.',
            },
          });
        }

        const order = await prisma.order.findUnique({
          where: { id: params.data.id },
          include: { restaurant: true },
        });

        if (!order) {
          return reply.status(404).send({
            success: false,
            error: {
              code: 'ORDER_NOT_FOUND',
              message: 'No se encontro el pedido.',
            },
          });
        }

        if (order.status !== OrderStatus.READY || order.driverId) {
          return reply.status(400).send({
            success: false,
            error: {
              code: 'INVALID_STATUS',
              message: 'Este pedido ya no esta disponible para apoyo.',
            },
          });
        }

        if (order.supportRestaurantId) {
          return reply.status(409).send({
            success: false,
            error: {
              code: 'ALREADY_SUPPORTED',
              message: 'Este pedido ya fue aceptado por otro restaurante aliado.',
            },
          });
        }

        // Marcar el pedido como tomado por apoyo (actualización atómica para evitar
        // que dos restaurantes acepten el mismo pedido de forma concurrente).
        const existingNotes = order.notes ? order.notes + ' | ' : '';
        const newNotes = existingNotes + `[Apoyo por: ${supportRestaurant.name}] [ApoyoId: ${supportRestaurant.id}]`;

        const acceptedCount = await prisma.order.updateMany({
          where: {
            id: order.id,
            status: OrderStatus.READY,
            driverId: null,
            supportRestaurantId: null,
          },
          data: {
            supportRestaurantId: supportRestaurant.id,
            notes: newNotes,
            isSupportRequested: false,
            noDriversAvailable: false,
          },
        });

        if (acceptedCount.count === 0) {
          return reply.status(409).send({
            success: false,
            error: {
              code: 'ALREADY_SUPPORTED',
              message: 'Este pedido ya fue aceptado por otro restaurante aliado o ya no está disponible.',
            },
          });
        }

        const updatedOrder = await prisma.order.findUniqueOrThrow({
          where: { id: order.id },
          include: {
            customer: {
              include: {
                user: true,
              },
            },
          },
        });

        // Notificar al restaurante original
        emitNotification(
          fastify.io,
          order.restaurant.userId,
          'RESTAURANT',
          'order:support-accepted',
          {
            orderId: order.id,
            supportRestaurantName: supportRestaurant.name,
            message: `El restaurante ${supportRestaurant.name} ha aceptado entregar tu pedido.`,
          },
          {
            requestId: requestContext.requestId,
            orderId: order.id,
          }
        );

        // Generar un token de reparto seguro de un solo uso para que el restaurante aliado
        // genere el QR de entrega (mismo mecanismo del reparto propio/express).
        const crypto = require('node:crypto');
        const { hashToken } = require('../utils/crypto');
        const supportTokenStr = crypto.randomBytes(32).toString('hex');
        const supportHashedToken = hashToken(supportTokenStr);
        const supportTokenExpiresAt = new Date();
        supportTokenExpiresAt.setHours(supportTokenExpiresAt.getHours() + 3); // Vence en 3 horas

        const supportDToken = await (prisma as any).deliveryToken.upsert({
          where: { orderId: order.id },
          update: {
            token: supportHashedToken,
            expiresAt: supportTokenExpiresAt,
          },
          create: {
            orderId: order.id,
            token: supportHashedToken,
            expiresAt: supportTokenExpiresAt,
          },
        });

        return reply.send({
          success: true,
          data: {
            ...updatedOrder,
            deliveryToken: {
              token: supportTokenStr, // Token en texto plano para el QR
              expiresAt: supportDToken.expiresAt,
              url: buildCustomerDeliveryUrl(supportTokenStr),
            },
          },
        });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    // RECHAZAR APOYO DE OTRO RESTAURANTE
    restaurantOrders.post('/restaurant-panel/pedidos/:id/rechazar-apoyo', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);

      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: params.error.issues[0]?.message || 'Parametros invalidos.',
          },
        });
      }

      const user = getAuthenticatedUser(request);
      const requestContext = getOrCreateRequestContext(request);

      try {
        const order = await prisma.order.findUnique({
          where: { id: params.data.id },
          include: { restaurant: true },
        });

        if (!order) {
          return reply.status(404).send({
            success: false,
            error: {
              code: 'ORDER_NOT_FOUND',
              message: 'No se encontro el pedido.',
            },
          });
        }

        if (!order.isSupportRequested) {
          return reply.status(400).send({
            success: false,
            error: {
              code: 'NOT_REQUESTING_SUPPORT',
              message: 'Este pedido no esta solicitando apoyo.',
            },
          });
        }

        const updatedOrder = await prisma.order.update({
          where: { id: order.id },
          data: {
            supportRejectionCount: { increment: 1 },
          },
        });

        // Si todos rechazaron, notificar al restaurante solicitante
        if (updatedOrder.supportRejectionCount >= updatedOrder.supportCount) {
          emitNotification(
            fastify.io,
            order.restaurant.userId,
            'RESTAURANT',
            'order:support-rejected-all',
            {
              orderId: order.id,
              message: `Ningun restaurante acepto tu solicitud de apoyo para el pedido ${order.orderReference}.`,
            },
            {
              requestId: requestContext.requestId,
              orderId: order.id,
            }
          );
        }

        return reply.send({
          success: true,
          message: 'Apoyo rechazado.',
        });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    // INICIAR ENTREGA DE APOYO
    restaurantOrders.post('/restaurant-panel/pedidos/:id/iniciar-entrega', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);

      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: params.error.issues[0]?.message || 'Parametros invalidos.',
          },
        });
      }

      const user = getAuthenticatedUser(request);
      const requestContext = getOrCreateRequestContext(request);

      try {
        const supportRestaurant = await prisma.restaurant.findUnique({
          where: { userId: user.sub },
        });

        if (!supportRestaurant) {
          return reply.status(404).send({
            success: false,
            error: {
              code: 'RESTAURANT_NOT_FOUND',
              message: 'No se encontro tu restaurante.',
            },
          });
        }

        const order = await prisma.order.findUnique({
          where: { id: params.data.id },
          include: { restaurant: true },
        });

        if (!order) {
          return reply.status(404).send({
            success: false,
            error: {
              code: 'ORDER_NOT_FOUND',
              message: 'No se encontro el pedido.',
            },
          });
        }

        if (!order.notes || !order.notes.includes(`[ApoyoId: ${supportRestaurant.id}]`)) {
          return reply.status(403).send({
            success: false,
            error: {
              code: 'FORBIDDEN',
              message: 'No tienes permiso para iniciar la entrega de este pedido.',
            },
          });
        }

        if (order.status !== OrderStatus.READY) {
          return reply.status(400).send({
            success: false,
            error: {
              code: 'INVALID_STATUS',
              message: 'El pedido no esta listo para entrega.',
            },
          });
        }

        const updatedOrder = await prisma.order.update({
          where: { id: order.id },
          data: {
            status: OrderStatus.IN_TRANSIT,
            inTransitAt: new Date(),
          },
          include: {
            customer: {
              include: {
                user: true,
              },
            },
          },
        });

        // Notificar al restaurante original
        emitNotification(
          fastify.io,
          order.restaurant.userId,
          'RESTAURANT',
          'order:in-transit',
          {
            orderId: order.id,
            status: 'IN_TRANSIT',
            message: `El restaurante ${supportRestaurant.name} va en camino a entregar tu pedido.`,
          },
          {
            requestId: requestContext.requestId,
            orderId: order.id,
          }
        );

        // Notificar al cliente
        emitNotification(
          fastify.io,
          updatedOrder.customer.user.id,
          'CUSTOMER',
          'order:in-transit',
          {
            orderId: updatedOrder.id,
            status: 'IN_TRANSIT',
            message: `Tu pedido va en camino (entregado por restaurante aliado: ${supportRestaurant.name}).`,
          },
          {
            requestId: requestContext.requestId,
            orderId: updatedOrder.id,
          }
        );

        return reply.send({
          success: true,
          data: updatedOrder,
        });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    // ── Respond to customer cancellation request ──
    const respondCancellationSchema = z.object({
      approve: z.boolean(),
      note: z.string().max(500).optional(),
    });

    restaurantOrders.post('/restaurant-panel/pedidos/:id/responder-solicitud-cancelacion', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_PARAMS', message: 'ID de pedido inválido.' } });
      }

      const parsed = respondCancellationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_PAYLOAD', message: parsed.error.issues[0]?.message || 'Datos inválidos.' } });
      }

      const user = getAuthenticatedUser(request);
      const requestContext = getOrCreateRequestContext(request);

      try {
        const { customerUserId, driverUserId } = await respondToCancellationRequest(
          prisma, params.data.id, user.sub, parsed.data.approve, parsed.data.note
        );

        const event = parsed.data.approve ? 'order:cancellation-approved' : 'order:cancellation-rejected';

        emitNotification(
          fastify.io,
          customerUserId,
          'CUSTOMER',
          event,
          {
            orderId: params.data.id,
            note: parsed.data.note || null,
          },
          {
            requestId: requestContext.requestId,
            orderId: params.data.id,
          }
        );

        // If driver was unassigned, notify them
        if (driverUserId && parsed.data.approve) {
          emitNotification(
            fastify.io,
            driverUserId,
            'DRIVER',
            'order:unassigned',
            { orderId: params.data.id },
            { requestId: requestContext.requestId, orderId: params.data.id }
          );

          try {
            await sendPushNotification(driverUserId, {
              title: 'Pedido cancelado — Liberado de la entrega',
              body: 'El cliente canceló el pedido. Ya no es necesario que realices la entrega.',
              icon: '/app-icon-192.png',
              badge: '/badge.png',
              vibrate: [600, 200, 600, 200, 600],
              requireInteraction: true,
              tag: `order-cancelled-${params.data.id}`,
              data: {
                orderId: params.data.id,
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
          data: {
            message: parsed.data.approve
              ? 'Cancelación aprobada. El cliente ha sido notificado.'
              : 'Solicitud de cancelación rechazada.',
          },
        });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    // ── Restaurant direct cancel ──
    const directCancelSchema = z.object({
      reason: z.string().min(10, 'El motivo debe tener al menos 10 caracteres.').max(1000),
    });

    restaurantOrders.patch('/restaurant-panel/pedidos/:id/cancelar', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_PARAMS', message: 'ID de pedido inválido.' } });
      }

      const parsed = directCancelSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_PAYLOAD', message: parsed.error.issues[0]?.message || 'El motivo es obligatorio (mín. 10 caracteres).' } });
      }

      const user = getAuthenticatedUser(request);
      const requestContext = getOrCreateRequestContext(request);

      try {
        const { customerUserId, driverUserId } = await cancelOrderByRestaurant(
          prisma, params.data.id, user.sub, parsed.data.reason
        );

        // Notify customer
        emitNotification(
          fastify.io,
          customerUserId,
          'CUSTOMER',
          'order:cancelled',
          {
            orderId: params.data.id,
            reason: parsed.data.reason,
            cancelledBy: 'RESTAURANT',
          },
          {
            requestId: requestContext.requestId,
            orderId: params.data.id,
          }
        );

        // Push notification to customer
        try {
          await sendPushNotification(customerUserId, {
            title: 'Pedido cancelado por el restaurante',
            body: `Motivo: ${parsed.data.reason}`,
            icon: '/app-icon-192.png',
            badge: '/badge.png',
            vibrate: [800, 200, 800],
            requireInteraction: true,
            data: {
              orderId: params.data.id,
              event: 'order:cancelled',
              url: `/?orderId=${params.data.id}`,
            },
          });
        } catch (pushErr) {
          request.log.error(pushErr as any, '[Push] Error al notificar cancelación al cliente');
        }

        // Notify driver if unassigned
        if (driverUserId) {
          emitNotification(
            fastify.io,
            driverUserId,
            'DRIVER',
            'order:unassigned',
            { orderId: params.data.id },
            { requestId: requestContext.requestId, orderId: params.data.id }
          );

          try {
            await sendPushNotification(driverUserId, {
              title: 'Pedido cancelado por el restaurante',
              body: `El restaurante canceló el pedido. Motivo: ${parsed.data.reason}`,
              icon: '/app-icon-192.png',
              badge: '/badge.png',
              vibrate: [600, 200, 600, 200, 600],
              requireInteraction: true,
              tag: `order-cancelled-${params.data.id}`,
              data: {
                orderId: params.data.id,
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
          data: { message: 'Pedido cancelado exitosamente.' },
        });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });
  });
}
