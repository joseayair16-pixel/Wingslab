/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */

import { OrderStatus } from '@prisma/client';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../config/database';
import { sendAppError } from '../errors/http';
import { emitNotification } from '../services/socket.service';
import { sendPushNotification } from '../services/notification.service';
import { hashToken } from '../utils/crypto';
import { ownDeliveryAction, resolveOwnTicket } from '../services/own-delivery.service';


export async function registerPublicDeliveryRoutes(fastify: FastifyInstance): Promise<void> {
  const deliveryTicketRateLimitConfig = {
    // One scoped bearer capability per authorized own-delivery order. All
    // state changes use the transactional service; legacy recovery/debt paths
    // remain unavailable in this local phase.
    preHandler: async (request: FastifyRequest, reply: any) => {
      try {
        const token = (request.params as { token: string }).token;
        await resolveOwnTicket(prisma, token);
        reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
        if (request.method === 'GET') return;
        const suffix = request.url.split('?')[0].split('/').pop();
        const actions = { 'llegue-restaurante': 'start', llegue: 'arrive', ubicacion: 'location', entregar: 'deliver' } as const;
        const action = actions[suffix as keyof typeof actions];
        if (!action) return reply.status(403).send({ success: false, error: { code: 'DELIVERY_ACTION_BLOCKED', message: 'Esta operación no está habilitada en WingsLab.' } });
        const result = await ownDeliveryAction(prisma, token, action, request.body || {});
        const order = result.order;
        if (result.changed) {
          const event = { start: 'order:in-transit', arrive: 'order:driver-arrived', location: 'order:driver-location', deliver: 'order:delivered' }[action];
          const payload = { orderId: order.id, status: order.status, updatedAt: order.updatedAt,
            ...(action === 'location' ? { latitude: order.lastDriverLatitude, longitude: order.lastDriverLongitude } : {}) };
          emitNotification(fastify.io, order.customer.user.id, 'CUSTOMER', event, payload, { orderId: order.id });
          emitNotification(fastify.io, order.restaurant.userId, 'RESTAURANT', event, payload, { orderId: order.id });
          if (action === 'deliver') {
            void sendPushNotification(order.customer.user.id, {
              title: '¡Pedido entregado!',
              body: 'Gracias por elegir WingsLab. ¡Que disfrutes tu pedido!',
              icon: '/app-icon-192.png',
              badge: '/badge.png',
              data: { orderId: order.id, event, url: `/?orderId=${order.id}` },
            }).catch(err => fastify.log.error({ err, orderId: order.id }, 'No se pudo enviar el push de entrega'));
          }
        }
        return reply.send({ success: true, data: { id: order.id, status: order.status,
          arrived: action === 'arrive' || action === 'start', needsHandover: false,
          paymentStatus: order.paymentStatus }, message: action === 'deliver' ? 'Entrega confirmada.' : 'Pedido actualizado.' });
      } catch (error) { return sendAppError(reply, error); }
    },
    config: {
      rateLimit: {
        max: 60,
        timeWindow: '1 minute',
        keyGenerator: (request: FastifyRequest) => request.ip,
      },
    },
  };

  fastify.get('/public/delivery-ticket/:token', deliveryTicketRateLimitConfig, async (request, reply) => {
    const params = z.object({ token: z.string().min(1) }).safeParse(request.params);

    if (!params.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_PARAMS', message: 'Token invalido.' },
      });
    }

    try {
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
              supportRestaurant: {
                select: {
                  id: true,
                  name: true,
                },
              },
              address: true,
              customer: {
                include: {
                  user: {
                    select: {
                      id: true,
                      name: true,
                      lastName: true,
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

      // Revocación efectiva: si el pedido ya se cerró (entregado, cancelado o
      // rechazado), el enlace muere aquí aunque siga vigente el TTL.
      if (['DELIVERED', 'COMPLETED', 'CANCELLED', 'REJECTED'].includes(dToken.order.status)) {
        await (prisma as any).deliveryToken.delete({ where: { id: dToken.id } });
        return reply.status(410).send({
          success: false,
          error: {
            code: 'ORDER_CLOSED',
            message: 'Este pedido ya fue cerrado (entregado o cancelado). El enlace ya no es válido.',
          },
        });
      }

      return reply.send({
        success: true,
        data: {
          id: dToken.order.id,
          orderReference: dToken.order.orderReference,
          dailyCounter: dToken.order.dailyCounter ?? null,
          status: dToken.order.status,
          isOwnDelivery: true,
          driverArrivedAtCustomer: dToken.order.driverArrivedAtCustomer ?? null,
          totalAmount: dToken.order.totalAmount,
          deliveryFee: dToken.order.deliveryFee,
          paymentMethod: dToken.order.paymentMethod,
          deliveryAddress: dToken.order.address,
          notes: dToken.order.notes,
          handoverPin: dToken.order.handoverPin,
          isSupportDelivery: Boolean(dToken.order.supportRestaurantId),
          supportRestaurant: dToken.order.supportRestaurant
            ? {
                id: dToken.order.supportRestaurant.id,
                name: dToken.order.supportRestaurant.name,
              }
            : null,
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
            lastName: (dToken.order.customer.user as any).lastName ?? null,
            phone: dToken.order.customer.user.phone,
          },
        },
      });
    } catch (error) {
      return sendAppError(reply, error);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // LUGAR SEGURO (entrega abandonada - transferencia/online)
  // ─────────────────────────────────────────────────────────────────────────
  // Si el repartidor llegó al domicilio y esperó 10+ minutos sin contacto con
  // el cliente, puede dejar el pedido en un lugar seguro. El pago (transferencia
  // o en línea) ya está cubierto, por lo que la entrega simplemente se marca
  // como DELIVERED sin tocar el paymentStatus y se notifica al comensal.
  fastify.post('/public/delivery-ticket/:token/lugar-seguro', deliveryTicketRateLimitConfig, async (request, reply) => {
    const params = z.object({ token: z.string().min(1) }).safeParse(request.params);

    if (!params.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_PARAMS', message: 'Token invalido.' },
      });
    }

    try {
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

      if (order.status === OrderStatus.DELIVERED) {
        await (prisma as any).deliveryToken
          .delete({ where: { id: dToken.id } })
          .catch((err: unknown) => request.log.error({ err }, `Fallo al invalidar token de entrega ${dToken.id} (lugar seguro, ya entregado)`));
        return reply.send({
          success: true,
          message: 'El pedido ya fue entregado.',
          data: order,
        });
      }

      // Solo aplica a pagos ya cubiertos (transferencia / en línea).
      if (order.paymentMethod === 'CASH') {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PAYMENT_METHOD',
            message: 'Un pedido de pago en efectivo no puede dejarse en un lugar seguro.',
          },
        });
      }

      // Debe haber registrado la llegada al domicilio para anclar la espera.
      if (!order.driverArrivedAtCustomer) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'DRIVER_NOT_ARRIVED',
            message: 'Debes registrar que llegaste con el cliente antes de continuar.',
          },
        });
      }

      const waitMs = Date.now() - new Date(order.driverArrivedAtCustomer).getTime();
      const SAFE_PLACE_WAIT_MS = 10 * 60 * 1000;
      if (waitMs < SAFE_PLACE_WAIT_MS) {
        const faltaMin = Math.ceil((SAFE_PLACE_WAIT_MS - waitMs) / 60000);
        return reply.status(409).send({
          success: false,
          error: {
            code: 'ARRIVAL_TIMEOUT_NOT_ELAPSED',
            message: `Aun no han pasado los 10 minutos. Intenta en ${faltaMin} minuto(s) o confirma la entrega con el cliente.`,
          },
        });
      }

      const DELIVERABLE_STATES: OrderStatus[] = ['READY', 'PICKED_UP', 'IN_TRANSIT'];
      const claimed = await prisma.order.updateMany({
        where: {
          id: order.id,
          status: { in: DELIVERABLE_STATES },
        },
        data: {
          status: OrderStatus.DELIVERED,
          deliveredAt: new Date(),
        },
      });

      if (claimed.count === 0) {
        await (prisma as any).deliveryToken
          .delete({ where: { id: dToken.id } })
          .catch((err: unknown) => request.log.error({ err }, `Fallo al invalidar token de entrega ${dToken.id} (lugar seguro, ya cerrado)`));
        return reply.status(409).send({
          success: false,
          error: { code: 'ALREADY_DELIVERED', message: 'Este pedido ya fue entregado.' },
        });
      }

      const updatedOrder = await prisma.order.findUnique({
        where: { id: order.id },
        include: {
          restaurant: true,
          customer: { include: { user: true } },
        },
      }) as any;

      await prisma.orderTracking.create({
        data: {
          orderId: order.id,
          status: OrderStatus.DELIVERED,
          notes: 'Pedido dejado en un lugar seguro por el repartidor (sin contacto con el cliente).',
        },
      });

      await (prisma as any).deliveryToken.delete({ where: { id: dToken.id } });

      // Sockets
      emitNotification(
        fastify.io,
        order.restaurant.userId,
        'RESTAURANT',
        'order:delivered',
        {
          orderId: order.id,
          orderReference: order.orderReference,
          status: 'safe_place',
          customerName: order.customer?.user?.name,
        },
        {
          orderId: order.id,
        }
      );

      emitNotification(
        fastify.io,
        order.customer.user.id,
        'CUSTOMER',
        'order:delivered',
        {
          orderId: order.id,
          status: 'safe_place',
          message: 'Tu pedido fue dejado en un lugar seguro.',
        },
        {
          orderId: order.id,
        }
      );

      // Push notification
      try {
        const pushResult = await sendPushNotification(order.customer.user.id, {
          title: 'Tu pedido fue dejado en un lugar seguro',
          body: 'El repartidor espero mas de 10 minutos y dejo tu pedido en un lugar seguro. ¡Recogelo cuando puedas!',
          icon: '/app-icon-192.png',
          badge: '/badge.png',
          vibrate: [300, 100, 300],
          requireInteraction: true,
          data: {
            orderId: order.id,
            event: 'order:delivered',
            url: `/?orderId=${order.id}`,
          },
        });
        request.log.info(`[Push] Resultado de notificacion push (lugar seguro) para comensal ${order.customer.user.id}: ${JSON.stringify(pushResult)}`);
      } catch (pushErr) {
        request.log.error(pushErr as any, `[Push] Error al notificar entrega en lugar seguro (comensal ${order.customer.user.id})`);
      }

      return reply.send({
        success: true,
        message: 'El pedido fue dejado en un lugar seguro y marcado como entregado.',
        data: updatedOrder,
      });
    } catch (error) {
      return sendAppError(reply, error);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // CLIENTE NO SALIÓ - LIBERAR PEDIDO (entrega abandonada - efectivo)
  // ─────────────────────────────────────────────────────────────────────────
  // Pedidos en efectivo: tras 15 minutos sin que el cliente salga a recibir, el
  // repartidor puede liberar el pedido. Se crea un CustomerBillingSettlement por
  // el total, la cuenta del comensal queda suspendida hasta que liquide y el
  // pedido se marca como DELIVERED sin paymentStatus (el efectivo nunca se cobró).
  fastify.post('/public/delivery-ticket/:token/cliente-no-salio', deliveryTicketRateLimitConfig, async (request, reply) => {
    const params = z.object({ token: z.string().min(1) }).safeParse(request.params);

    if (!params.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_PARAMS', message: 'Token invalido.' },
      });
    }

    try {
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
              driver: {
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

      if (order.status === OrderStatus.DELIVERED) {
        await (prisma as any).deliveryToken
          .delete({ where: { id: dToken.id } })
          .catch((err: unknown) => request.log.error({ err }, `Fallo al invalidar token de entrega ${dToken.id} (no salio, ya entregado)`));
        return reply.send({
          success: true,
          message: 'El pedido ya fue entregado.',
          data: order,
        });
      }

      // Solo aplica a pedidos en efectivo (el dinero que nunca se cobró se
      // convierte en deuda). Si el pago ya estaba cubierto, el repartidor debe
      // usar el flujo de "lugar seguro".
      if (order.paymentMethod !== 'CASH') {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PAYMENT_METHOD',
            message: 'Este flujo es solo para pedidos de pago en efectivo. Usa lugar seguro para pedidos pagados.',
          },
        });
      }

      if (!order.driverArrivedAtCustomer) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'DRIVER_NOT_ARRIVED',
            message: 'Debes registrar que llegaste con el cliente antes de continuar.',
          },
        });
      }

      const arrivedAtCustomer = order.driverArrivedAtCustomer;
      const waitMs = Date.now() - new Date(arrivedAtCustomer).getTime();
      const NO_SHOW_WAIT_MS = 15 * 60 * 1000;
      if (waitMs < NO_SHOW_WAIT_MS) {
        const faltaMin = Math.ceil((NO_SHOW_WAIT_MS - waitMs) / 60000);
        return reply.status(409).send({
          success: false,
          error: {
            code: 'ARRIVAL_TIMEOUT_NOT_ELAPSED',
            message: `Aun no han pasado los 15 minutos. Intenta en ${faltaMin} minuto(s) o confirma la entrega con el cliente.`,
          },
        });
      }

      // Idempotency guard: nunca crear una segunda deuda para el mismo pedido.
      const existingSettlement = await prisma.customerBillingSettlement.findUnique({
        where: { orderId: order.id },
        select: { id: true },
      });
      if (existingSettlement) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'SETTLEMENT_ALREADY_EXISTS',
            message: 'Este pedido ya genero una deuda. Revisa con soporte.',
          },
        });
      }

      // 1) Crear la deuda + suspender al cliente + abrir ticket de soporte DE
      //    FORMA ATÓMICA. El unique(orderId) serializa lanzamientos simultáneos.
      //    Crear la deuda ANTES de marcar el pedido entregado garantiza que nunca
      //    exista un pedido entregado sin facturar.
      let settlementId: string;
      try {
        const created = await prisma.$transaction(async (tx) => {
          const reference = `CUS-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

          const settlement = await tx.customerBillingSettlement.create({
            data: {
              customerId: order.customer.id,
              reference,
              orderId: order.id,
              amount: order.totalAmount,
              status: 'PENDING',
              dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              notes: `Pedido no recibido - el repartidor llego y espero 15+ minutos sin respuesta del cliente. Pedido #${order.orderReference}.`,
            },
          });

          // debtAmount acumula: un cliente puede deber por más de un pedido.
          await tx.customer.update({
            where: { id: order.customer.id },
            data: { isSuspendedByDebt: true, debtAmount: { increment: order.totalAmount } },
          });

          await tx.user.update({
            where: { id: order.customer.user.id },
            data: { status: 'SUSPENDED' },
          });

          await tx.supportTicket.create({
            data: {
              type: 'ORDER',
              subject: 'Cliente no salio a recibir pedido',
              description: [
                `Pedido: #${order.orderReference}`,
                `Repartidor: ${order.driver?.user?.name || 'N/A'}`,
                `Hora de llegada al domicilio: ${arrivedAtCustomer.toISOString()}`,
                `Tiempo de espera: 15+ minutos`,
                `Monto del pedido: $${order.totalAmount.toFixed(2)}`,
                `Restaurante: ${order.restaurant.name}`,
                `Referencia de deuda: ${settlement.reference}`,
              ].join('\n'),
              status: 'PENDING',
              customerId: order.customer.id,
              orderNumber: order.orderReference,
              storeName: order.restaurant.name,
            },
          });

          return settlement;
        });
        settlementId = created.id;
      } catch (debtErr: any) {
        if (debtErr?.code === 'P2002') {
          return reply.status(409).send({
            success: false,
            error: {
              code: 'SETTLEMENT_ALREADY_EXISTS',
              message: 'Este pedido ya genero una deuda. Revisa con soporte.',
            },
          });
        }
        throw debtErr;
      }

      // 2) Completar la entrega (DELIVERED, token invalidado) con la marca del
      //    release. Si falla, revertir la deuda para no cobrar al cliente un
      //    pedido que en realidad no fue liberado.
      try {
        const DELIVERABLE_STATES: OrderStatus[] = ['READY', 'PICKED_UP', 'IN_TRANSIT'];
        const claimed = await prisma.order.updateMany({
          where: {
            id: order.id,
            status: { in: DELIVERABLE_STATES },
          },
          data: {
            status: OrderStatus.DELIVERED,
            deliveredAt: new Date(),
            noShowReleasedAt: new Date(),
          },
        });

        if (claimed.count === 0) {
          throw new Error('El pedido cambió de estado o fue cerrado por otro flujo.');
        }

        const updatedOrder = await prisma.order.findUnique({
          where: { id: order.id },
          include: {
            restaurant: true,
            customer: { include: { user: true } },
          },
        }) as any;

        await prisma.orderTracking.create({
          data: {
            orderId: order.id,
            status: OrderStatus.DELIVERED,
            notes: 'Cliente no salio a recibir. Pedido liberado por el repartidor.',
          },
        });

        await (prisma as any).deliveryToken.delete({ where: { id: dToken.id } });

        emitNotification(
          fastify.io,
          order.restaurant.userId,
          'RESTAURANT',
          'order:delivered',
          {
            orderId: order.id,
            orderReference: order.orderReference,
            status: 'no_show',
            customerName: order.customer?.user?.name,
          },
          {
            orderId: order.id,
          }
        );

        emitNotification(
          fastify.io,
          order.customer.user.id,
          'CUSTOMER',
          'account:suspended',
          {
            reason: 'unpaid_delivery',
            orderId: order.id,
          },
          {
            orderId: order.id,
          }
        );

        try {
          await sendPushNotification(order.customer.user.id, {
            title: 'No pudimos entregar tu pedido',
            body: 'El repartidor llego a tu domicilio y espero, pero no saliste a recibirlo. Para volver a pedir en SaDeL, cubre el saldo pendiente en la app.',
            icon: '/app-icon-192.png',
            badge: '/badge.png',
            vibrate: [300, 100, 300],
            requireInteraction: true,
            data: {
              orderId: order.id,
              event: 'account:suspended',
              url: '/mi-deuda',
            },
          });
        } catch (pushErr) {
          request.log.error(pushErr as any, `[Push] Error al notificar suspension de cuenta (comensal ${order.customer.user.id})`);
        }

        return reply.send({
          success: true,
          message: 'El pedido fue liberado y la deuda quedó registrada. La cuenta del comensal está suspendida hasta que liquide.',
          data: updatedOrder,
        });
      } catch (deliveryErr) {
        // Compensación: revertir la deuda si la entrega no pudo completarse.
        try {
          await prisma.$transaction(async (tx) => {
            await tx.customerBillingSettlement.delete({ where: { id: settlementId } });
            const remaining = await tx.customerBillingSettlement.aggregate({
              where: { customerId: order.customer.id, status: { not: 'PAID' } },
              _sum: { amount: true },
            });
            const remainingDebt = remaining._sum.amount || 0;
            await tx.customer.update({
              where: { id: order.customer.id },
              data: remainingDebt > 0
                ? { isSuspendedByDebt: true, debtAmount: remainingDebt }
                : { isSuspendedByDebt: false, debtAmount: 0 },
            });
            if (remainingDebt === 0) {
              await tx.user.update({
                where: { id: order.customer.user.id },
                data: { status: 'ACTIVE' },
              });
            }
          });
        } catch (compErr) {
          request.log.error(
            compErr as any,
            '[Deuda] No se pudo revertir la deuda tras fallar la entrega'
          );
        }
        return sendAppError(reply, deliveryErr);
      }
    } catch (error) {
      return sendAppError(reply, error);
    }
  });

  fastify.post('/public/delivery-ticket/:token/entregar', deliveryTicketRateLimitConfig, async (request, reply) => {
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

      // Idempotencia: si el pedido ya fue entregado (vía QR, tablet o repartidor),
      // responder éxito sin re-notificar ni volver a actualizar.
      if (order.status === OrderStatus.DELIVERED) {
        await (prisma as any).deliveryToken
          .delete({ where: { id: dToken.id } })
          .catch((err: unknown) => request.log.error({ err }, `Fallo al invalidar token de entrega ${dToken.id} (ya entregado)`));
        return reply.send({
          success: true,
          message: 'El pedido ya fue entregado.',
          data: order,
        });
      }

      // Validación de estado: solo se puede entregar un pedido que ya está en ruta
      // (listo, recogido o en tránsito). Evita entregar un pedido antes de tiempo
      // (PENDING/CONFIRMED/PREPARING) o re-entregar uno ya completado/cancelado.
      const DELIVERABLE_STATES: OrderStatus[] = ['READY', 'PICKED_UP', 'IN_TRANSIT'];
      if (!DELIVERABLE_STATES.includes(order.status)) {
        return reply.status(409).send({
          success: false,
          error: { code: 'INVALID_ORDER_STATE', message: 'El pedido aún no está listo para entregarse.' },
        });
      }

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

      // Claim atómico anti-doble-entrega: solo un request puede transicionar el
      // pedido a DELIVERED. Si dos POST llegan casi simultáneos, el segundo ve
      // count=0 (el primero ya lo entregó) y responde sin re-notificar ni duplicar.
      // En reparto propio con pago en efectivo el dinero ya fue cobrado por
      // el repartidor en la puerta: marcar el pago como COMPLETED (mismo
      // comportamiento que la tablet del restaurante). Transferencias y pagos
      // en línea quedan como estén (el cobro se confirma por otro medio).
      const claimed = await prisma.order.updateMany({
        where: {
          id: order.id,
          status: { in: DELIVERABLE_STATES },
        },
        data: {
          status: OrderStatus.DELIVERED,
          deliveredAt: new Date(),
          ...(order.paymentMethod === 'CASH' ? { paymentStatus: 'COMPLETED' } : {}),
        },
      });

      if (claimed.count === 0) {
        // Ya fue entregado/completado/cancelado por otro flujo (o carrera).
        await (prisma as any).deliveryToken
          .delete({ where: { id: dToken.id } })
          .catch((err: unknown) => request.log.error({ err }, `Fallo al invalidar token de entrega ${dToken.id} (alcanzado la marca)`));
        return reply.status(409).send({
          success: false,
          error: { code: 'ALREADY_DELIVERED', message: 'Este pedido ya fue entregado.' },
        });
      }

      const updatedOrder = await prisma.order.findUnique({
        where: { id: order.id },
        include: {
          restaurant: true,
          customer: { include: { user: true } },
        },
      }) as any;

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

  fastify.post('/public/delivery-ticket/:token/ubicacion', deliveryTicketRateLimitConfig, async (request, reply) => {
    const params = z.object({ token: z.string().min(1) }).safeParse(request.params);
    const bodySchema = z.object({
      coords: z
        .tuple([z.number().finite().min(-90).max(90), z.number().finite().min(-180).max(180)]),
    });
    const body = bodySchema.safeParse(request.body);

    if (!params.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_PARAMS', message: 'Token invalido.' },
      });
    }

    if (!body.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_PAYLOAD', message: 'Datos invalidos.' },
      });
    }

    try {
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
          error: { code: 'TOKEN_NOT_FOUND', message: 'El enlace de reparto no existe o ha expirado.' },
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
      const [latitude, longitude] = body.data.coords;

      await prisma.order.update({
        where: { id: order.id },
        data: {
          lastDriverLatitude: latitude,
          lastDriverLongitude: longitude,
          lastDriverLocationAt: new Date(),
        },
      });

      emitNotification(
        fastify.io,
        order.customer.user.id,
        'CUSTOMER',
        'order:driver-location',
        {
          orderId: order.id,
          latitude,
          longitude,
        },
        {
          orderId: order.id,
        }
      );

      return reply.send({
        success: true,
      });
    } catch (error) {
      return sendAppError(reply, error);
    }
  });

  fastify.post('/public/delivery-ticket/:token/llegue', deliveryTicketRateLimitConfig, async (request, reply) => {
    const params = z.object({ token: z.string().min(1) }).safeParse(request.params);

    if (!params.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_PARAMS', message: 'Token invalido.' },
      });
    }

    try {
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

      // Persistir la llegada a la puerta del comensal para que la app del cliente
      // pueda reconstruir el modal "Tu repartidor ha llegado" al abrir/volver a la
      // pestaña aunque el evento de socket se hubiera perdido (app cerrada o en
      // segundo plano). Guardado para no pisar el ancla de los umbrales de
      // entrega abandonada.
      if (!order.driverArrivedAtCustomer) {
        await prisma.order.update({
          where: { id: order.id },
          data: { driverArrivedAtCustomer: new Date() },
        });
      }

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

  fastify.post('/public/delivery-ticket/:token/llegue-restaurante', deliveryTicketRateLimitConfig, async (request, reply) => {
    const params = z.object({ token: z.string().min(1) }).safeParse(request.params);

    if (!params.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_PARAMS', message: 'Token invalido.' },
      });
    }

    try {
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

      // Flujo de apoyo a red: el repartidor del restaurante aliado llega al
      // restaurante origen a recoger el pedido. Primero se NOTIFICA la llegada
      // (sin avanzar estado); solo cuando el restaurante confirma la entrega
      // (PIN en transferencia / cobro en efectivo) la entrega inicia.
      if (order.supportRestaurantId) {
        if (order.status === OrderStatus.READY) {
          if (!order.driverArrivedAt) {
            await prisma.order.update({
              where: { id: order.id },
              data: { driverArrivedAt: new Date() },
            });

            await prisma.orderTracking.create({
              data: {
                orderId: order.id,
                status: OrderStatus.READY,
                notes: 'SUPPORT_DRIVER_ARRIVED_RESTAURANT',
              },
            });

            // Notificar al restaurante origen que el repartidor de apoyo llegó
            emitNotification(
              fastify.io,
              order.restaurant.userId,
              'RESTAURANT',
              'order:driver-arrived-restaurant',
              {
                orderId: order.id,
                orderReference: order.orderReference,
                status: order.status,
                driverName: order.supportRestaurant?.name || 'El repartidor de apoyo',
                isSupportDelivery: true,
              },
              {
                orderId: order.id,
              }
            );

            try {
              await sendPushNotification(order.restaurant.userId, {
                title: '🛵 Repartidor de apoyo en tu establecimiento',
                body: `${order.supportRestaurant?.name || 'Tu restaurante aliado'} ha llegado por el pedido ${order.orderReference}. Entrégalo (PIN o efectivo) para que inicie la entrega.`,
                icon: '/app-icon-192.png',
                badge: '/badge.png',
                tag: `driver-arrived-${order.id}`,
                vibrate: [300, 100, 300, 100, 300],
                requireInteraction: true,
                data: {
                  orderId: order.id,
                  event: 'order:driver-arrived-restaurant',
                  url: `/?orderId=${order.id}`,
                },
              });
            } catch (pushErr) {
              request.log.error(pushErr as any, '[Push] Error al notificar llegada de repartidor de apoyo al restaurante origen');
            }
          }

          return reply.send({
            success: true,
            message: 'Llegada notificada al restaurante. Espera a que confirme la entrega para iniciar el reparto.',
            data: {
              arrived: true,
              needsHandover: true,
              status: order.status,
            },
          });
        }

        // El restaurante origen ya confirmó la entrega (PIN/efectivo): inicia la entrega
        if (order.status === OrderStatus.PICKED_UP) {
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

          // Push al restaurante origen: el aliado ya recogió el pedido
          try {
            await sendPushNotification(order.restaurant.userId, {
              title: '¡Pedido recogido por tu aliado! 🛒',
              body: `${order.supportRestaurant?.name || 'Tu restaurante aliado'} recogió el pedido ${order.orderReference} y va en camino a entregarlo.`,
              icon: '/app-icon-192.png',
              badge: '/badge.png',
              vibrate: [500, 100, 500, 100, 500],
              requireInteraction: true,
              data: {
                orderId: order.id,
                event: 'order:support-picked-up',
                url: `/?orderId=${order.id}`,
              },
            });
          } catch (pushErr) {
            request.log.error(pushErr as any, '[Push] Error al notificar recogida de apoyo al restaurante origen');
          }

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

          // Push al comensal: la entrega va en camino
          try {
            await sendPushNotification(order.customer.user.id, {
              title: '¡Tu pedido va en camino! 🛵',
              body: `Tu pedido va en camino y será entregado por ${order.supportRestaurant?.name || 'un restaurante aliado'}.`,
              icon: '/app-icon-192.png',
              badge: '/badge.png',
              vibrate: [500, 100, 500, 100, 500],
              requireInteraction: true,
              data: {
                orderId: order.id,
                event: 'order:in-transit',
                url: `/?orderId=${order.id}`,
              },
            });
          } catch (pushErr) {
            request.log.error(pushErr as any, '[Push] Error al notificar en camino al comensal (apoyo)');
          }

          return reply.send({
            success: true,
            message: 'Recogida confirmada por el restaurante. ¡Va en camino a entregarlo!',
            data: {
              arrived: true,
              needsHandover: false,
              status: 'IN_TRANSIT',
            },
          });
        }

        // Ya en camino: idempotente
        if (order.status === OrderStatus.IN_TRANSIT) {
          return reply.send({
            success: true,
            message: 'La entrega ya está en camino.',
            data: {
              arrived: true,
              needsHandover: false,
              status: order.status,
            },
          });
        }
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
