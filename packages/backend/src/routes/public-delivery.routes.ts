/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */

import { OrderStatus } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../config/database';
import { sendAppError } from '../errors/http';
import { emitNotification } from '../services/socket.service';
import { sendPushNotification } from '../services/notification.service';


export async function registerPublicDeliveryRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/public/delivery-ticket/:token', async (request, reply) => {
    const params = z.object({ token: z.string().min(1) }).safeParse(request.params);

    if (!params.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_PARAMS', message: 'Token invalido.' },
      });
    }

    try {
      const { hashToken } = require('../utils/crypto');
      const hashedToken = hashToken(params.data.token);
      const dToken = await (prisma as any).deliveryToken.findFirst({
        where: {
          OR: [
            { token: hashedToken },
            { token: params.data.token }
          ]
        },
        include: {
          order: {
            include: {
              restaurant: {
                select: {
                  name: true,
                  contactPhone: true,
                  businessType: true,
                  address: true,
                  latitude: true,
                  longitude: true,
                },
              },
              address: true,
              customer: {
                include: {
                  user: {
                    select: {
                      id: true,
                      name: true,
                      phone: true,
                    },
                  },
                },
              },
            },
          },
        },
      }) as any;

      if (!dToken) {
        return reply.status(404).send({
          success: false,
          error: { code: 'TOKEN_NOT_FOUND', message: 'El enlace de reparto no existe o ha expirado.' },
        });
      }

      if (new Date() > dToken.expiresAt) {
        // Eliminar token expirado
        await (prisma as any).deliveryToken.delete({ where: { id: dToken.id } });
        return reply.status(410).send({
          success: false,
          error: { code: 'TOKEN_EXPIRED', message: 'El enlace de reparto ha expirado por seguridad.' },
        });
      }

      return reply.send({
        success: true,
        data: {
          id: dToken.order.id,
          orderReference: dToken.order.orderReference,
          status: dToken.order.status,
          totalAmount: dToken.order.totalAmount,
          deliveryFee: dToken.order.deliveryFee,
          paymentMethod: dToken.order.paymentMethod,
          deliveryAddress: dToken.order.address,
          notes: dToken.order.notes,
          handoverPin: dToken.order.handoverPin,
          isSupportDelivery: Boolean(dToken.order.supportRestaurantId),
          restaurant: {
            name: dToken.order.restaurant.name,
            phone: dToken.order.restaurant.contactPhone,
            businessType: dToken.order.restaurant.businessType,
            address: dToken.order.restaurant.address,
            latitude: dToken.order.restaurant.latitude,
            longitude: dToken.order.restaurant.longitude,
          },
          customer: {
            name: dToken.order.customer.user.name,
            phone: dToken.order.customer.user.phone,
          },
        },
      });
    } catch (error) {
      return sendAppError(reply, error);
    }
  });

  fastify.post('/public/delivery-ticket/:token/entregar', async (request, reply) => {
    const params = z.object({ token: z.string().min(1) }).safeParse(request.params);
    const bodySchema = z.object({ pin: z.string().optional() });
    const body = bodySchema.safeParse(request.body);

    if (!params.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_PARAMS', message: 'Token invalido.' },
      });
    }

    try {
      const { hashToken } = require('../utils/crypto');
      const hashedToken = hashToken(params.data.token);
      const dToken = await (prisma as any).deliveryToken.findFirst({
        where: {
          OR: [
            { token: hashedToken },
            { token: params.data.token }
          ]
        },
        include: {
          order: {
            include: {
              restaurant: true,
              customer: {
                include: {
                  user: true,
                },
              },
            },
          },
        },
      }) as any;

      if (!dToken) {
        return reply.status(404).send({
          success: false,
          error: { code: 'TOKEN_NOT_FOUND', message: 'El enlace de reparto no existe o ya fue completado.' },
        });
      }

      if (new Date() > dToken.expiresAt) {
        await (prisma as any).deliveryToken.delete({ where: { id: dToken.id } });
        return reply.status(410).send({
          success: false,
          error: { code: 'TOKEN_EXPIRED', message: 'El enlace de reparto ha expirado.' },
        });
      }

      const order = dToken.order;

      // Si el pedido tiene un PIN requerido por seguridad (solo para transferencias), es obligatorio proporcionarlo y debe coincidir exactamente
      if (order.paymentMethod === 'TRANSFER' && (order.handoverPin || order.deliveryPin)) {
        const providedPin = body.success ? body.data.pin : undefined;
        const validPin = providedPin && providedPin.trim() !== '' && (
          providedPin === order.handoverPin || providedPin === order.deliveryPin
        );
        if (!validPin) {
          return reply.status(400).send({
            success: false,
            error: { code: 'INVALID_PIN', message: 'El PIN de seguridad del cliente es obligatorio y es incorrecto.' },
          });
        }
      }


      // 1. Actualizar el pedido en base de datos
      const updatedOrder = await prisma.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.DELIVERED,
          deliveredAt: new Date(),
        },
      });

      // 2. Crear registro de tracking
      await prisma.orderTracking.create({
        data: {
          orderId: order.id,
          status: OrderStatus.DELIVERED,
          notes: 'Pedido entregado exitosamente por reparto propio.',
        },
      });

      // 3. Eliminar el token para que sea de un solo uso
      await (prisma as any).deliveryToken.delete({ where: { id: dToken.id } });

      // 4. Notificaciones
      // Sockets
      emitNotification(
        fastify.io,
        order.customer.user.id,
        'CUSTOMER',
        'order:delivered',
        {
          orderId: order.id,
          status: 'DELIVERED',
          message: 'Tu pedido ha sido entregado.',
        },
        {
          orderId: order.id,
        }
      );

      // Sockets - RESTAURANT
      emitNotification(
        fastify.io,
        order.restaurant.userId,
        'RESTAURANT',
        'order:delivered',
        {
          orderId: order.id,
          orderReference: order.orderReference,
          status: 'DELIVERED',
          customerName: order.customer?.user?.name,
        },
        {
          orderId: order.id,
        }
      );

      // Push Notification
      request.log.info(`[Push] Intentando enviar notificacion push al comensal ${order.customer.user.id} para reparto propio completado (DELIVERED)`);
      try {
        const pushResult = await sendPushNotification(order.customer.user.id, {
          title: '¡Pedido entregado! 🎉',
          body: 'Tu pedido ha sido entregado exitosamente. ¡Que lo disfrutes!',
          icon: '/app-icon-192.png',
          badge: '/badge.png',
          vibrate: [1000, 500, 1000, 500, 1000],
          requireInteraction: true,
          data: {
            orderId: order.id,
            event: 'order:delivered',
            url: `/?orderId=${order.id}`,
          },
        });
        request.log.info(`[Push] Resultado de notificacion push para comensal ${order.customer.user.id}: ${JSON.stringify(pushResult)}`);
      } catch (pushErr) {
        request.log.error(pushErr as any, `[Push] Error al enviar notificacion push al comensal ${order.customer.user.id}`);
      }

      return reply.send({
        success: true,
        message: 'Pedido entregado correctamente y token invalidado.',
        data: updatedOrder,
      });
    } catch (error) {
      return sendAppError(reply, error);
    }
  });

  fastify.post('/public/delivery-ticket/:token/llegue', async (request, reply) => {
    const params = z.object({ token: z.string().min(1) }).safeParse(request.params);

    if (!params.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_PARAMS', message: 'Token invalido.' },
      });
    }

    try {
      const { hashToken } = require('../utils/crypto');
      const hashedToken = hashToken(params.data.token);
      const dToken = await (prisma as any).deliveryToken.findFirst({
        where: {
          OR: [
            { token: hashedToken },
            { token: params.data.token }
          ]
        },
        include: {
          order: {
            include: {
              restaurant: true,
              customer: {
                include: {
                  user: true,
                },
              },
            },
          },
        },
      }) as any;

      if (!dToken) {
        return reply.status(404).send({
          success: false,
          error: { code: 'TOKEN_NOT_FOUND', message: 'El enlace de reparto no existe o ya fue completado.' },
        });
      }

      if (new Date() > dToken.expiresAt) {
        await (prisma as any).deliveryToken.delete({ where: { id: dToken.id } });
        return reply.status(410).send({
          success: false,
          error: { code: 'TOKEN_EXPIRED', message: 'El enlace de reparto ha expirado.' },
        });
      }

      const order = dToken.order;

      // 1. Crear registro de tracking
      await prisma.orderTracking.create({
        data: {
          orderId: order.id,
          status: OrderStatus.IN_TRANSIT,
          notes: 'DRIVER_ARRIVED',
        },
      });

            // 2. Notificaciones
      // Sockets
      emitNotification(
        fastify.io,
        order.customer.user.id,
        'CUSTOMER',
        'order:driver-arrived',
        {
          orderId: order.id,
          status: 'IN_TRANSIT',
          message: 'Tu repartidor ha llegado a tu domicilio.',
        },
        {
          orderId: order.id,
        }
      );

      // Sockets - RESTAURANT
      emitNotification(
        fastify.io,
        order.restaurant.userId,
        'RESTAURANT',
        'order:in-transit',
        {
          orderId: order.id,
          orderReference: order.orderReference,
          status: 'IN_TRANSIT',
          customerName: order.customer?.user?.name,
        },
        {
          orderId: order.id,
        }
      );

      // Push Notification
      request.log.info(`[Push] Intentando enviar notificacion push al comensal ${order.customer.user.id} para llegada del repartidor`);
      try {
        const pushResult = await sendPushNotification(order.customer.user.id, {
          title: '¡Tu repartidor ha llegado! 🛵',
          body: 'El repartidor ya está en tu domicilio con tu pedido. ¡Sal a recibirlo!',
          icon: '/app-icon-192.png',
          badge: '/badge.png',
          vibrate: [100, 50, 100, 50, 100],
          requireInteraction: true,
          data: {
            orderId: order.id,
            event: 'order:driver-arrived',
            url: `/?orderId=${order.id}`,
          },
        });
        request.log.info(`[Push] Resultado de notificacion push para comensal ${order.customer.user.id}: ${JSON.stringify(pushResult)}`);
      } catch (pushErr) {
        request.log.error(pushErr as any, `[Push] Error al enviar notificacion push al comensal ${order.customer.user.id}`);
      }

      return reply.send({
        success: true,
        message: 'Llegada notificada exitosamente al comensal.',
      });
    } catch (error) {
      return sendAppError(reply, error);
    }
  });

  fastify.post('/public/delivery-ticket/:token/llegue-restaurante', async (request, reply) => {
    const params = z.object({ token: z.string().min(1) }).safeParse(request.params);

    if (!params.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_PARAMS', message: 'Token invalido.' },
      });
    }

    try {
      const { hashToken } = require('../utils/crypto');
      const hashedToken = hashToken(params.data.token);
      const dToken = await (prisma as any).deliveryToken.findFirst({
        where: {
          OR: [
            { token: hashedToken },
            { token: params.data.token }
          ]
        },
        include: {
          order: {
            include: {
              restaurant: true,
              supportRestaurant: { select: { id: true, name: true } },
              customer: { include: { user: true } },
            },
          },
        },
      }) as any;

      if (!dToken) {
        return reply.status(404).send({
          success: false,
          error: { code: 'TOKEN_NOT_FOUND', message: 'El enlace de reparto no existe o ya fue completado.' },
        });
      }

      if (new Date() > dToken.expiresAt) {
        await (prisma as any).deliveryToken.delete({ where: { id: dToken.id } });
        return reply.status(410).send({
          success: false,
          error: { code: 'TOKEN_EXPIRED', message: 'El enlace de reparto ha expirado.' },
        });
      }

      const order = dToken.order;

      // Este avance de estado solo aplica a entregas de apoyo a red: el repartidor del
      // restaurante aliado llega al restaurante origen a recoger el pedido.
      if (order.supportRestaurantId) {
        if (order.status === OrderStatus.READY) {
          await prisma.order.update({
            where: { id: order.id },
            data: {
              status: OrderStatus.IN_TRANSIT,
              inTransitAt: new Date(),
            },
          });

          // Registrar evento de tracking
          await prisma.orderTracking.create({
            data: {
              orderId: order.id,
              status: OrderStatus.IN_TRANSIT,
              notes: 'SUPPORT_PICKED_UP',
            },
          });

          // Notificar al restaurante origen que ya recogieron su pedido
          emitNotification(
            fastify.io,
            order.restaurant.userId,
            'RESTAURANT',
            'order:support-picked-up',
            {
              orderId: order.id,
              orderReference: order.orderReference,
              status: 'IN_TRANSIT',
              supportRestaurantName: order.supportRestaurant?.name,
              message: `El repartidor de ${order.supportRestaurant?.name || 'tu aliado'} recogió el pedido. Va en camino a entregarlo.`,
            },
            {
              orderId: order.id,
            }
          );

          // Notificar al comensal que la entrega va en camino
          emitNotification(
            fastify.io,
            order.customer.user.id,
            'CUSTOMER',
            'order:in-transit',
            {
              orderId: order.id,
              status: 'IN_TRANSIT',
              message: `Tu pedido va en camino (entregado por restaurante aliado${order.supportRestaurant?.name ? `: ${order.supportRestaurant.name}` : ''}).`,
            },
            {
              orderId: order.id,
            }
          );
        }
        // Si ya estaba IN_TRANSIT, el avance es idempotente: no se vuelve a notificar.
      }

      return reply.send({
        success: true,
        message: 'Recogida confirmada en el restaurante.',
      });
    } catch (error) {
      return sendAppError(reply, error);
    }
  });
}
