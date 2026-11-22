import { UserRole } from '@prisma/client';
import { isActiveOrderStatus } from '@sadel/shared';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { prisma } from '../config/database';
import { authenticate, getAuthenticatedUser } from '../middleware/auth';
import { emitNotification } from '../services/socket.service';
import { sendPushNotification } from '../services/notification.service';
import { getOrCreateRequestContext } from '../utils/request-context';

const sendMessageSchema = z.object({
  content: z.string().min(1, 'El mensaje no puede estar vacío.').max(1000, 'El mensaje es demasiado largo.'),
});
export function isChatOrderActive(status: string): boolean {
  return isActiveOrderStatus(status);
}

export async function registerOrderChatRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /orders/:orderId/messages - Retrieve historical chat messages for an order
  fastify.get('/orders/:orderId/messages', { preHandler: authenticate }, async (request, reply) => {
    const { orderId } = request.params as { orderId: string };
    const user = getAuthenticatedUser(request);

    try {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          restaurant: {
            select: { userId: true, name: true },
          },
          customer: {
            include: {
              user: {
                select: { id: true, name: true },
              },
            },
          },
        },
      });

      if (!order) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'El pedido no existe.',
          },
        });
      }
      if (!isChatOrderActive(order.status)) return reply.status(409).send({ success: false, error: { code: 'CHAT_CLOSED', message: 'El chat se cierra al finalizar o cancelar el pedido.' } });

      // Only the customer and restaurant assigned to the order may access its chat.
      const isCustomer = order.customer.user.id === user.sub;
      const isRestaurant = order.restaurant.userId === user.sub;

      if (!isCustomer && !isRestaurant) {
        return reply.status(403).send({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'No tienes permiso para ver el chat de este pedido.',
          },
        });
      }

      const messages = await prisma.orderMessage.findMany({
        where: { orderId },
        orderBy: { createdAt: 'asc' },
        include: {
          sender: {
            select: {
              name: true,
              role: true,
            },
          },
        },
      });

      // Mark messages sent by the counterparty as read
      const counterpartyRole = isCustomer ? UserRole.RESTAURANT : UserRole.CUSTOMER;
      await prisma.orderMessage.updateMany({
        where: {
          orderId,
          senderRole: counterpartyRole,
          isRead: false,
        },
        data: {
          isRead: true,
        },
      });

      return reply.send({
        success: true,
        messages: messages.map((msg) => ({
          id: msg.id,
          orderId: msg.orderId,
          content: msg.content,
          senderRole: msg.senderRole,
          senderId: msg.senderId,
          senderName: msg.sender.name,
          isRead: msg.isRead,
          createdAt: msg.createdAt,
        })),
      });
    } catch (error) {
      const err = error as Error;
      fastify.log.error({ err: err.message, stack: err.stack }, '[order-chat] GET /orders/:orderId/messages failed');
      return reply.status(500).send({
        success: false,
        error: {
          code: 'SERVER_ERROR',
          message: 'Error al recuperar los mensajes de la orden.',
        },
      });
    }
  });

  // POST /orders/:orderId/messages - Send a chat message
  fastify.post('/orders/:orderId/messages', { preHandler: authenticate }, async (request, reply) => {
    const { orderId } = request.params as { orderId: string };
    const user = getAuthenticatedUser(request);
    const requestContext = getOrCreateRequestContext(request);

    const parsed = sendMessageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_PAYLOAD',
          message: parsed.error.issues[0]?.message || 'El mensaje no es válido.',
        },
      });
    }

    const { content } = parsed.data;

    try {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          restaurant: {
            select: {
              userId: true,
              name: true,
            },
          },
          customer: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      });

      if (!order) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'El pedido no existe.',
          },
        });
      }
      if (!isChatOrderActive(order.status)) return reply.status(409).send({ success: false, error: { code: 'CHAT_CLOSED', message: 'El chat se cierra al finalizar o cancelar el pedido.' } });

      // Check authorization
      const isCustomer = order.customer.user.id === user.sub;
      const isRestaurant = order.restaurant.userId === user.sub;

      if (!isCustomer && !isRestaurant) {
        return reply.status(403).send({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'No tienes permiso para enviar mensajes en este pedido.',
          },
        });
      }

      const senderRole = isCustomer ? UserRole.CUSTOMER : UserRole.RESTAURANT;
      const senderName = isCustomer ? order.customer.user.name : order.restaurant.name;
      const recipientUserId = isCustomer ? order.restaurant.userId : order.customer.user.id;
      const recipientRole = isCustomer ? 'RESTAURANT' : 'CUSTOMER';

      // Create message in database
      const message = await prisma.orderMessage.create({
        data: {
          orderId,
          content,
          senderRole,
          senderId: user.sub,
        },
      });

      const messagePayload = {
        id: message.id,
        orderId: message.orderId,
        content: message.content,
        senderRole: message.senderRole,
        senderId: message.senderId,
        senderName,
        isRead: message.isRead,
        createdAt: message.createdAt.toISOString(),
      };

      // Emit WebSocket event to recipient room
      emitNotification(
        fastify.io,
        recipientUserId,
        recipientRole,
        'order_chat:message_received',
        messagePayload,
        {
          requestId: requestContext.requestId,
          orderId,
        }
      );

      // Trigger Web Push alert to recipient (in background)
      void sendPushNotification(recipientUserId, {
        title: isCustomer ? `Mensaje de Comensal - Pedido #${order.orderReference}` : `Mensaje de ${order.restaurant.name}`,
        body: content,
        sound: '/sounds/mensaje.wav',
        data: {
          orderId,
          type: 'new_chat_message',
          senderName,
          url: `/?orderId=${orderId}`,
        },
        tag: `order-chat-${orderId}`,
        requireInteraction: true,
      }).catch((err) => {
        fastify.log.error('Error dispatching push notification for order message', err);
      });

      return reply.status(201).send({
        success: true,
        message: messagePayload,
      });
    } catch (error) {
      const err = error as Error;
      fastify.log.error({ err: err.message, stack: err.stack }, '[order-chat] POST /orders/:orderId/messages failed');
      return reply.status(500).send({
        success: false,
        error: {
          code: 'SERVER_ERROR',
          message: 'Error al enviar el mensaje.',
        },
      });
    }
  });
}
