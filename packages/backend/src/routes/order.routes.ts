import { PaymentMethod, UserRole, OrderStatus } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { prisma } from '../config/database';
import { sendAppError } from '../errors/http';
import { authenticate, authorize, getAuthenticatedUser } from '../middleware/auth';
import { customerOrderDetailSelect, customerOrderListSelect } from '../services/order-selects';
import { emitNotification } from '../services/socket.service';
import { getOrCreateRequestContext } from '../utils/request-context';
import { createOrderForCustomer } from '../services/order.service';
import { sendPushNotification } from '../services/notification.service';
import { enqueueRestaurantOrder, requestOrderCancellation, retractCancellationRequest } from '../services/order-workflow.service';
import { sendWhatsAppNewOrder } from '../services/whatsapp.service';

const createOrderSchema = z.object({
  restaurantId: z.string().min(1, 'El restaurante es obligatorio.'),
  clientOrderKey: z.string().min(8, 'La clave de pedido es obligatoria.').max(64).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1, 'El producto es obligatorio.'),
        quantity: z.number().int().positive('La cantidad debe ser mayor a cero.'),
        specialInstructions: z.string().max(300).nullish().transform(v => v ?? undefined),
        optionIds: z.array(z.string()).nullish().transform(v => v ?? undefined),
        sellBy: z.enum(['UNIT', 'WEIGHT']).default('UNIT'),
        weightG: z.number().int().positive().nullish().transform(v => v ?? undefined),
      })
    )
    .min(1, 'Debes enviar al menos un producto.'),
  fulfillmentType: z.enum(['DELIVERY', 'PICKUP']).default('DELIVERY'),
  deliveryAddress: z.object({
    street: z.string().min(1, 'La calle es obligatoria.'),
    number: z.string().min(1, 'El numero es obligatorio.'),
    apartment: z.string().nullish().transform(v => v ?? undefined),
    neighborhood: z.string().min(1, 'La colonia es obligatoria.'),
    city: z.string().min(1, 'La ciudad es obligatoria.'),
    state: z.string().min(1, 'El estado es obligatorio.'),
    zipCode: z.string().min(1, 'El codigo postal es obligatorio.'),
    country: z.string().min(1, 'El pais es obligatorio.'),
    reference: z.string().nullish().transform(v => v ?? undefined),
    latitude: z.number().or(z.string().transform(v => parseFloat(v))),
    longitude: z.number().or(z.string().transform(v => parseFloat(v))),
  }).optional(),
  currentLocation: z.object({
    latitude: z.number().or(z.string().transform(v => parseFloat(v))),
    longitude: z.number().or(z.string().transform(v => parseFloat(v))),
    accuracy: z.number().nonnegative().optional(),
    capturedAt: z.union([z.string(), z.number()]).optional(),
  }).optional(),
  paymentMethod: z.enum([PaymentMethod.CASH, PaymentMethod.TRANSFER]),
  paymentProofUrl: z.string().url('El comprobante debe ser una URL valida.').nullish().transform(v => v ?? undefined),
  notes: z.string().max(500).nullish().transform(v => v ?? undefined),
  locationVerified: z.boolean().optional().default(false),
  promoCode: z.string().max(30).trim().optional().transform(v => v?.toUpperCase() ?? undefined),
}).superRefine((data, context) => {
  if (data.fulfillmentType === 'DELIVERY' && !data.deliveryAddress) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'La direccion de entrega es obligatoria para pedidos a domicilio.',
      path: ['deliveryAddress'],
    });
  }
  if (data.paymentMethod === PaymentMethod.TRANSFER && !data.paymentProofUrl?.trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'El comprobante de transferencia es obligatorio.',
      path: ['paymentProofUrl'],
    });
  }
});

const listMyOrdersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
});

export async function registerOrderRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.register(async function customerScope(customer) {
    customer.addHook('preHandler', authenticate);
    customer.addHook('preHandler', authorize([UserRole.CUSTOMER]));

    customer.post('/pedidos/validar-cupon', {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
        },
      },
    }, async (request, reply) => {
      const validateCouponSchema = z.object({
        restaurantId: z.string().min(1, 'El restaurante es obligatorio.'),
        promoCode: z.string().max(30).trim().transform(v => v.toUpperCase()),
        subtotal: z.number().nonnegative(),
        isPickup: z.boolean().optional().default(false),
        deliveryFee: z.number().nonnegative().optional().default(0),
      });

      const parsed = validateCouponSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: parsed.error.issues[0]?.message || 'Datos invalidos.',
          },
        });
      }

      const { restaurantId, promoCode, subtotal, isPickup, deliveryFee } = parsed.data;

      const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
      if (!restaurant) {
        return reply.status(404).send({
          success: false,
          error: { code: 'RESTAURANT_NOT_FOUND', message: 'El restaurante no existe.' },
        });
      }

      const promo = await prisma.promoCode.findFirst({
        where: {
          restaurantId: restaurant.id,
          code: { equals: promoCode, mode: 'insensitive' },
          isActive: true,
          AND: [
            { OR: [{ validFrom: null }, { validFrom: { lte: new Date() } }] },
            { OR: [{ validUntil: null }, { validUntil: { gte: new Date() } }] },
          ],
        },
      });

      if (!promo) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_PROMO_CODE', message: 'El código promocional no es válido.' },
        });
      }
      if (promo.maxUses != null && promo.usesCount >= promo.maxUses) {
        return reply.status(400).send({
          success: false,
          error: { code: 'PROMO_CODE_EXHAUSTED', message: 'El código promocional ya no está disponible.' },
        });
      }
      if (promo.minOrderAmount != null && subtotal < promo.minOrderAmount) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'PROMO_CODE_MIN_ORDER',
            message: `Este código aplica a partir de $${promo.minOrderAmount.toFixed(2)} de compra.`,
          },
        });
      }

      let discount = 0;
      if (promo.type === 'PERCENT') {
        discount = Math.round((subtotal * promo.value) / 100 * 100) / 100;
      } else if (promo.type === 'AMOUNT') {
        discount = Math.min(promo.value, subtotal);
      } else if (promo.type === 'FREE_DELIVERY') {
        discount = isPickup ? 0 : deliveryFee;
      }

      return reply.status(200).send({
        success: true,
        data: {
          code: promo.code,
          type: promo.type,
          value: promo.value,
          description: promo.description,
          minOrderAmount: promo.minOrderAmount,
          discount: discount,
        },
      });
    });

    customer.post('/pedidos', {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
    }, async (request, reply) => {
      const parsed = createOrderSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: parsed.error.issues[0]?.message || 'Datos invalidos.',
          },
        });
      }

      // Optional enforcement: require client to mark requests as location-verified
      const requireVerified = String(process.env.REQUIRE_LOCATION_VERIFIED || '').toLowerCase() === 'true' || process.env.REQUIRE_LOCATION_VERIFIED === '1';
      if (requireVerified) {
        const verified = String(request.headers['x-location-verified'] || '') === '1' || String(request.headers['x-location-verified'] || '').toLowerCase() === 'true';
        if (!verified) {
          return reply.status(403).send({
            success: false,
            error: { code: 'LOCATION_PERMISSION_REQUIRED', message: 'Se requiere que el cliente confirme acceso a la ubicación para crear pedidos.' },
          });
        }
      }

      const user = getAuthenticatedUser(request);
      const requestContext = getOrCreateRequestContext(request);


      try {
        const { order, isDuplicate } = await createOrderForCustomer({
          prisma,
          customerUserId: user.sub,
          input: parsed.data as any,
          requestHeaders: request.headers,
        });

        // Pedido duplicado (reintento del cliente): no se vuelve a notificar al restaurante.
        if (isDuplicate) {
          return reply.status(200).send({
            success: true,
            data: order,
            isDuplicate: true,
          });
        }

        const queueInfo = await enqueueRestaurantOrder(order.restaurant.id, order.id, order.createdAt);

        emitNotification(
          fastify.io,
          order.restaurant.userId,
          'RESTAURANT',
          'order:created',
          {
            orderId: order.id,
            orderReference: order.orderReference,
            totalAmount: order.totalAmount,
            paymentMethod: order.paymentMethod,
            customerName: order.customer.user.name,
            queuePosition: queueInfo.position,
            queueLength: queueInfo.queueLength,
          },
          {
            requestId: requestContext.requestId,
            orderId: order.id,
          }
        );

        // Send Push Notification to Restaurant
        const restaurantEarnings = order.subtotal + ((order.restaurant as any)?.hasOwnDelivery ? order.deliveryFee : 0);
        void sendPushNotification(order.restaurant.userId, {
          title: '¡Nuevo Pedido Recibido!',
          body: `Pedido ${order.orderReference} — Ingreso: $${restaurantEarnings.toFixed(2)}.`,
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
          tag: `new-order-${order.id}`,
        }).catch((err) => {
          request.log.error('Error sending push for new order', err);
        });

        // Send WhatsApp Notification to Restaurant (if enabled)
        void (async () => {
          try {
            const restaurant = await prisma.restaurant.findUnique({
              where: { id: order.restaurant.id },
              select: { contactPhone: true, whatsappNotifications: true },
            });
            if (restaurant?.whatsappNotifications && restaurant?.contactPhone) {
              const panelBase = (process.env.RESTAURANT_PANEL_URL || process.env.WEBAPP_URL || '').replace(/\/+$/, '');
              const panelUrl = panelBase ? `${panelBase}/?orderId=${order.id}` : '';
              void sendWhatsAppNewOrder({
                restaurantPhone: restaurant.contactPhone,
                orderNumber: order.dailyCounter ?? 0,
                panelUrl,
              });
            }
          } catch {}
        })();


        return reply.status(201).send({
          success: true,
          data: order,
          isDuplicate: false,
        });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    customer.get('/me/pedidos', async (request, reply) => {
      const parsed = listMyOrdersQuerySchema.safeParse(request.query);

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
      const customerProfile = await prisma.customer.findUnique({
        where: { userId: user.sub },
      });

      if (!customerProfile) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'CUSTOMER_NOT_FOUND',
            message: 'No se encontro el perfil del cliente.',
          },
        });
      }

      const { page, limit } = parsed.data;
      const [items, total] = await prisma.$transaction([
        prisma.order.findMany({
          where: { customerId: customerProfile.id },
          select: customerOrderListSelect,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.order.count({
          where: { customerId: customerProfile.id },
        }),
      ]);

      return reply.send({
        success: true,
        data: {
          items,
          total,
          page,
          limit,
          hasMore: page * limit < total,
        },
      });
    });

    customer.get('/me/pedidos/:id', async (request, reply) => {
      const params = z.object({ id: z.string().min(1, 'El id es obligatorio.') }).safeParse(request.params);

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
      const customerProfile = await prisma.customer.findUnique({
        where: { userId: user.sub },
      });

      if (!customerProfile) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'CUSTOMER_NOT_FOUND',
            message: 'No se encontro el perfil del cliente.',
          },
        });
      }

      const order = await prisma.order.findFirst({
        where: {
          id: params.data.id,
          customerId: customerProfile.id,
        },
        select: customerOrderDetailSelect,
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

      // Verificar si el repartidor tiene otros pedidos activos y este es el segundo
      let isSecondInRoute = false;
      if (order.driverId) {
        const otherActiveOrders = await prisma.order.findMany({
          where: {
            driverId: order.driverId,
            id: { not: order.id },
            status: { in: [OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.READY, OrderStatus.PICKED_UP, OrderStatus.IN_TRANSIT] },
          },
        });

        // Caso 1: Este pedido esta en 'PICKED_UP' (recolectado) pero hay otro en 'IN_TRANSIT' (en camino)
        // Significa que el repartidor decidio llevar el otro primero.
        if (order.status === OrderStatus.PICKED_UP && otherActiveOrders.some(o => o.status === OrderStatus.IN_TRANSIT)) {
          isSecondInRoute = true;
        }

        // Caso 2: Ambos estan en el mismo estado (ej. ambos 'PICKED_UP' o ambos 'READY').
        // En este caso, asumimos que el mas antiguo se entrega primero, por lo que el mas nuevo es el segundo.
        const sameStatusOrders = otherActiveOrders.filter(o => o.status === order.status);
        if (sameStatusOrders.length > 0) {
          const oldestOrder = await prisma.order.findFirst({
            where: {
              driverId: order.driverId,
              status: order.status,
            },
            orderBy: { createdAt: 'asc' },
          });

          if (oldestOrder && oldestOrder.id !== order.id) {
            isSecondInRoute = true;
          }
        }
      }

      return reply.send({
        success: true,
        data: {
          ...order,
          isSecondInRoute,
        },
      });
    });

    // ── Customer Cancellation Request ──
    const cancellationRequestSchema = z.object({
      reason: z.string().max(500).optional(),
    }).optional().default({});

    customer.post('/pedidos/:id/solicitar-cancelacion', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_PARAMS', message: 'ID de pedido inválido.' } });
      }

      const parsed = cancellationRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_PAYLOAD', message: parsed.error.issues[0]?.message || 'Datos inválidos.' } });
      }

      const user = getAuthenticatedUser(request);
      const requestContext = getOrCreateRequestContext(request);

      try {
        const { restaurantUserId } = await requestOrderCancellation(prisma, params.data.id, user.sub, parsed.data.reason);

        emitNotification(
          fastify.io,
          restaurantUserId,
          'RESTAURANT',
          'order:cancellation-requested',
          {
            orderId: params.data.id,
            reason: parsed.data.reason || null,
          },
          {
            requestId: requestContext.requestId,
            orderId: params.data.id,
          }
        );

        return reply.send({ success: true, data: { message: 'Solicitud de cancelación enviada al restaurante.' } });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    customer.post('/pedidos/:id/cancelar-solicitud', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_PARAMS', message: 'ID de pedido inválido.' } });
      }

      const user = getAuthenticatedUser(request);
      const requestContext = getOrCreateRequestContext(request);

      try {
        const order = await prisma.order.findFirst({
          where: { id: params.data.id, customer: { userId: user.sub } },
          include: { restaurant: { select: { userId: true } } },
        });

        if (!order || !order.cancellationRequestedAt) {
          return reply.status(404).send({ success: false, error: { code: 'NO_CANCELLATION_REQUEST', message: 'No hay una solicitud activa.' } });
        }

        await retractCancellationRequest(prisma, params.data.id, user.sub);

        emitNotification(
          fastify.io,
          order.restaurant.userId,
          'RESTAURANT',
          'order:cancellation-request-retracted',
          {
            orderId: params.data.id,
          },
          {
            requestId: requestContext.requestId,
            orderId: params.data.id,
          }
        );

        return reply.send({ success: true, data: { message: 'Solicitud de cancelación retirada.' } });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    // ── Customer accepts scheduled delivery proposal ──
    customer.post('/pedidos/:id/confirmar-programacion', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_PARAMS', message: 'ID de pedido inválido.' } });
      }

      const user = getAuthenticatedUser(request);
      const requestContext = getOrCreateRequestContext(request);

      try {
        const order = await prisma.order.findFirst({
          where: {
            id: params.data.id,
            customer: { userId: user.sub },
            status: OrderStatus.CONFIRMED,
            scheduledDeliveryAt: { not: null },
            scheduledDeliveryCustomerAcceptedAt: null,
          },
          select: {
            id: true,
            orderReference: true,
            scheduledDeliveryAt: true,
            restaurant: {
              select: {
                id: true,
                userId: true,
                name: true,
                businessType: true,
                hasOwnDelivery: true,
              },
            },
            customer: {
              select: {
                user: {
                  select: { id: true, name: true },
                },
              },
            },
            fulfillmentType: true,
          },
        });

        if (!order) {
          return reply.status(404).send({
            success: false,
            error: { code: 'ORDER_NOT_FOUND', message: 'No se encontró el pedido o no está pendiente de confirmación de entrega.' },
          });
        }

        const now = new Date();
        await prisma.$transaction(async (tx) => {
          await tx.order.update({
            where: { id: order.id },
            data: {
              scheduledDeliveryCustomerAcceptedAt: now,
              preparationStartedAt: now,
            },
          });
          await tx.orderTracking.create({
            data: {
              orderId: order.id,
              status: OrderStatus.CONFIRMED,
              notes: 'El cliente aceptó la fecha de entrega programada. La preparación ha comenzado.',
            },
          });
        });

        // Notify restaurant via socket
        emitNotification(
          fastify.io,
          order.restaurant.userId,
          'RESTAURANT',
          'order:schedule-accepted',
          {
            orderId: order.id,
            message: 'El cliente aceptó la fecha de entrega programada.',
          },
          {
            requestId: requestContext.requestId,
            orderId: order.id,
          }
        );

        // Send push confirmation to customer
        try {
          const businessType = order.restaurant.businessType;
          const ref = businessType === 'RESTAURANT' ? 'el restaurante' : 'la tienda';
          const formattedDate = order.scheduledDeliveryAt
            ? new Date(order.scheduledDeliveryAt).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })
            : '';
          const formattedTime = order.scheduledDeliveryAt
            ? new Date(order.scheduledDeliveryAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
            : '';
          await sendPushNotification(order.customer.user.id, {
            title: '¡Fecha confirmada! ✅',
            body: `Tu pedido llegará el ${formattedDate} a las ${formattedTime}. ${ref} ya está preparándolo.`,
            icon: '/app-icon-192.png',
            badge: '/badge.png',
            vibrate: [300, 100, 300],
            requireInteraction: false,
            tag: `schedule-accepted-${order.id}`,
            data: {
              orderId: order.id,
              event: 'order:schedule-accepted',
              url: `/?orderId=${order.id}`,
            },
          });
        } catch (pushErr) {
          request.log.error(pushErr as any, `[Push] Error al enviar notificacion de confirmacion al comensal ${order.customer.user.id}`);
        }

        return reply.send({
          success: true,
          data: {
            message: 'Fecha de entrega confirmada. Tu pedido ya está en preparación.',
          },
        });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    // ── Customer rejects scheduled delivery proposal → cancels order ──
    customer.post('/pedidos/:id/rechazar-programacion', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_PARAMS', message: 'ID de pedido inválido.' } });
      }

      const user = getAuthenticatedUser(request);
      const requestContext = getOrCreateRequestContext(request);

      try {
        const order = await prisma.order.findFirst({
          where: {
            id: params.data.id,
            customer: { userId: user.sub },
            status: OrderStatus.CONFIRMED,
            scheduledDeliveryAt: { not: null },
            scheduledDeliveryCustomerAcceptedAt: null,
          },
          select: {
            id: true,
            orderReference: true,
            restaurant: {
              select: {
                id: true,
                userId: true,
                name: true,
                businessType: true,
              },
            },
            customer: {
              select: {
                user: { select: { id: true, name: true } },
              },
            },
          },
        });

        if (!order) {
          return reply.status(404).send({
            success: false,
            error: { code: 'ORDER_NOT_FOUND', message: 'No se encontró el pedido o no está pendiente de confirmación de entrega.' },
          });
        }

        const cancellationReason = 'El cliente no aceptó la fecha de entrega programada.';

        await prisma.order.update({
          where: { id: order.id },
          data: {
            status: OrderStatus.CANCELLED,
            cancellationReason,
            cancelledBy: 'CUSTOMER',
          },
        });

        await prisma.orderTracking.create({
          data: {
            orderId: order.id,
            status: OrderStatus.CANCELLED,
            notes: cancellationReason,
          },
        });

        // Notify restaurant via socket
        emitNotification(
          fastify.io,
          order.restaurant.userId,
          'RESTAURANT',
          'order:schedule-rejected',
          {
            orderId: order.id,
            message: 'El cliente no aceptó la fecha de entrega programada. El pedido ha sido cancelado.',
          },
          {
            requestId: requestContext.requestId,
            orderId: order.id,
          }
        );

        // Push to customer
        try {
          await sendPushNotification(order.customer.user.id, {
            title: 'Pedido cancelado ❌',
            body: 'Cancelaste el pedido porque no aceptaste la fecha de entrega programada.',
            icon: '/app-icon-192.png',
            badge: '/badge.png',
            vibrate: [300, 100, 300],
            requireInteraction: false,
            data: {
              orderId: order.id,
              event: 'order:schedule-rejected',
              url: `/?orderId=${order.id}`,
            },
          });
        } catch (pushErr) {
          request.log.error(pushErr as any, `[Push] Error al enviar notificacion de cancelacion al comensal ${order.customer.user.id}`);
        }

        return reply.send({
          success: true,
          data: {
            message: 'Pedido cancelado. No se te hará ningún cobro.',
          },
        });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });
  });
}
