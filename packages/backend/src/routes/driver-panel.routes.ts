import { DriverAvailability, OrderStatus, UserRole } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcryptjs from 'bcryptjs';

import { prisma } from '../config/database';
import { sendAppError } from '../errors/http';
import { authenticate, authorize, getAuthenticatedUser } from '../middleware/auth';
import { emitNotification } from '../services/socket.service';
import { sendPushNotification } from '../services/notification.service';
import { claimOwnDeliveryByQr, ownDeliveryDriverAction } from '../services/own-delivery.service';
import { revokeAllUserRefreshTokens } from '../services/refresh-token.service';
import { getOwnedDriver, getOwnDriverBalance } from '../services/restaurant-driver.service';
import { getOrCreateRequestContext } from '../utils/request-context';
import { RESTAURANT_ID } from '../config/single-restaurant';

const ownDriverOrderSelect = {
  id: true,
  orderReference: true,
  dailyCounter: true,
  status: true,
  fulfillmentType: true,
  paymentMethod: true,
  paymentStatus: true,
  totalAmount: true,
  deliveryFee: true,
  driverCompensation: true,
  deliveryDistanceKm: true,
  createdAt: true,
  estimatedDeliveryTime: true,
  driverAssignedAt: true,
  driverArrivedAtCustomer: true,
  lastDriverLatitude: true,
  lastDriverLongitude: true,
  lastDriverLocationAt: true,
  latitude: true,
  longitude: true,
  notes: true,
  deliveryPreference: true,
  restaurant: {
    select: { id: true, name: true, address: true, contactPhone: true, latitude: true, longitude: true },
  },
  customer: {
    select: { user: { select: { id: true, name: true, lastName: true, phone: true } } },
  },
  address: {
    select: { street: true, number: true, apartment: true, neighborhood: true, reference: true, latitude: true, longitude: true },
  },
} as const;

const availabilitySchema = z.object({ availability: z.enum([DriverAvailability.AVAILABLE, DriverAvailability.OFFLINE]) });
const passwordSchema = z.object({
  currentPassword: z.string().min(6),
  newPassword: z.string().min(10).max(128),
}).refine(value => value.currentPassword !== value.newPassword, {
  message: 'La nueva contraseña debe ser distinta a la temporal.',
  path: ['newPassword'],
});

const claimSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start') }),
  z.object({ action: z.literal('arrive') }),
  z.object({ action: z.literal('location'), coords: z.tuple([z.number(), z.number()]) }),
  z.object({ action: z.literal('deliver'), pin: z.string().optional(), cashReceived: z.boolean().optional() }),
]);

const pageSchema = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) });

export async function registerDriverPanelRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.register(async function ownDriverScope(driverPanel) {
    driverPanel.addHook('preHandler', authenticate);
    driverPanel.addHook('preHandler', authorize([UserRole.DRIVER]));
    driverPanel.addHook('preHandler', async (request, reply) => {
      const route = request.routeOptions?.url ?? '';
      if (route === '/driver-panel/perfil' || route === '/driver-panel/password') return;
      const user = getAuthenticatedUser(request);
      const account = await prisma.user.findFirst({
        where: { id: user.sub, role: UserRole.DRIVER },
        select: { mustChangePassword: true },
      });
      if (!account || account.mustChangePassword) {
        return reply.status(403).send({
          success: false,
          error: { code: 'PASSWORD_CHANGE_REQUIRED', message: 'Cambia tu contraseña temporal antes de continuar.' },
        });
      }
    });

    driverPanel.get('/driver-panel/perfil', async (request, reply) => {
      try {
        const user = getAuthenticatedUser(request);
        const driver = await getOwnedDriver(prisma, user.sub);
        return reply.send({ success: true, data: { ...driver, deliveryCompensation: Number(driver.deliveryCompensation) } });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    driverPanel.patch('/driver-panel/password', async (request, reply) => {
      const parsed = passwordSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_PAYLOAD', message: parsed.error.issues[0]?.message || 'Revisa la nueva contraseña.' } });
      }
      try {
        const user = getAuthenticatedUser(request);
        await getOwnedDriver(prisma, user.sub);
        const account = await prisma.user.findUnique({ where: { id: user.sub }, select: { password: true } });
        if (!account || !await bcryptjs.compare(parsed.data.currentPassword, account.password)) {
          return reply.status(400).send({ success: false, error: { code: 'INVALID_CURRENT_PASSWORD', message: 'La contraseña temporal no es correcta.' } });
        }
        await prisma.user.update({
          where: { id: user.sub },
          data: { password: await bcryptjs.hash(parsed.data.newPassword, 12), mustChangePassword: false },
        });
        // Rotate sessions: the temporary-password session must not survive.
        await revokeAllUserRefreshTokens(user.sub);
        return reply.send({ success: true, message: 'Contraseña actualizada.' });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    driverPanel.patch('/driver-panel/disponibilidad', async (request, reply) => {
      const parsed = availabilitySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_PAYLOAD', message: parsed.error.issues[0]?.message || 'Disponibilidad inválida.' } });
      }
      try {
        const user = getAuthenticatedUser(request);
        const driver = await getOwnedDriver(prisma, user.sub);
        const activeOrders = await prisma.order.count({
          where: {
            restaurantId: RESTAURANT_ID,
            driverId: driver.id,
            status: { in: [OrderStatus.READY, OrderStatus.IN_TRANSIT] },
          },
        });
        if (parsed.data.availability === DriverAvailability.OFFLINE && activeOrders > 0) {
          return reply.status(409).send({ success: false, error: { code: 'ACTIVE_DELIVERIES', message: 'Termina tus entregas activas antes de desconectarte.' } });
        }
        const updated = await prisma.driver.update({
          where: { id: driver.id },
          data: { availability: activeOrders > 0 ? DriverAvailability.BUSY : parsed.data.availability },
          select: { id: true, status: true, availability: true },
        });
        return reply.send({ success: true, data: updated });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    driverPanel.get('/driver-panel/pedidos/pendientes', async (request, reply) => {
      try {
        const user = getAuthenticatedUser(request);
        const driver = await getOwnedDriver(prisma, user.sub);
        const items = await prisma.order.findMany({
          where: {
            restaurantId: driver.restaurantId,
            driverId: driver.id,
            deliveredByRestaurant: true,
            supportRestaurantId: null,
            fulfillmentType: 'DELIVERY',
            status: { in: [OrderStatus.READY, OrderStatus.IN_TRANSIT] },
          },
          select: ownDriverOrderSelect,
          orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
        });
        return reply.send({ success: true, data: items });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    driverPanel.get('/driver-panel/pedidos/:id', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      if (!params.success) return reply.status(400).send({ success: false, error: { code: 'INVALID_PARAMS', message: 'Pedido inválido.' } });
      try {
        const user = getAuthenticatedUser(request);
        const driver = await getOwnedDriver(prisma, user.sub);
        const order = await prisma.order.findFirst({
          where: { id: params.data.id, restaurantId: driver.restaurantId, driverId: driver.id, deliveredByRestaurant: true, supportRestaurantId: null },
          select: ownDriverOrderSelect,
        });
        if (!order) return reply.status(404).send({ success: false, error: { code: 'ORDER_NOT_FOUND', message: 'La entrega no está asignada a tu cuenta.' } });
        return reply.send({ success: true, data: order });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    driverPanel.get('/driver-panel/historial', async (request, reply) => {
      const parsed = pageSchema.safeParse(request.query);
      if (!parsed.success) return reply.status(400).send({ success: false, error: { code: 'INVALID_QUERY', message: 'Paginación inválida.' } });
      try {
        const user = getAuthenticatedUser(request);
        const driver = await getOwnedDriver(prisma, user.sub);
        const { page, limit } = parsed.data;
        const rows = await prisma.order.findMany({
          where: {
            restaurantId: driver.restaurantId,
            driverId: driver.id,
            deliveredByRestaurant: true,
            supportRestaurantId: null,
            status: OrderStatus.DELIVERED,
          },
          select: {
            ...ownDriverOrderSelect,
            deliveredAt: true,
            driverEarning: {
              select: { amount: true, payout: { select: { id: true, reference: true, paidAt: true } } },
            },
          },
          orderBy: { deliveredAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit + 1,
        });
        const hasMore = rows.length > limit;
        const items = rows.slice(0, limit).map((order: any) => ({
          ...order,
          driverEarning: order.driverEarning ? {
            amount: Number(order.driverEarning.amount),
            paid: Boolean(order.driverEarning.payout),
            payout: order.driverEarning.payout,
          } : null,
        }));
        return reply.send({ success: true, data: { items, hasMore } });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    driverPanel.get('/driver-panel/balance', async (request, reply) => {
      try {
        const user = getAuthenticatedUser(request);
        const driver = await getOwnedDriver(prisma, user.sub);
        return reply.send({ success: true, data: await getOwnDriverBalance(prisma, driver.id) });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    driverPanel.post('/driver-panel/qr/reclamar', async (request, reply) => {
      const parsed = claimSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ success: false, error: { code: 'INVALID_QR', message: 'El QR no contiene un enlace de reparto válido.' } });
      try {
        const user = getAuthenticatedUser(request);
        const result = await claimOwnDeliveryByQr(prisma, user.sub, parsed.data.token);
        if (result.changed) {
          emitNotification(fastify.io, user.sub, 'DRIVER', 'order:assigned', { orderId: result.order.id, orderReference: result.order.orderReference }, { orderId: result.order.id });
          emitNotification(fastify.io, result.order.restaurant.userId, 'RESTAURANT', 'order:driver-assigned', { orderId: result.order.id, driverName: result.driverName }, { orderId: result.order.id });
          emitNotification(fastify.io, result.order.customer.user.id, 'CUSTOMER', 'order:driver-assigned', { orderId: result.order.id, driverName: result.driverName }, { orderId: result.order.id });
        }
        return reply.send({ success: true, data: result.order });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    driverPanel.patch('/driver-panel/pedidos/:id/accion', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      const parsed = actionSchema.safeParse(request.body);
      if (!params.success || !parsed.success) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_PAYLOAD', message: 'Acción o pedido inválido.' } });
      }
      const user = getAuthenticatedUser(request);
      const requestContext = getOrCreateRequestContext(request);
      try {
        const result = await ownDeliveryDriverAction(prisma, user.sub, params.data.id, parsed.data.action, parsed.data);
        if (result.changed) {
          const action = parsed.data.action;
          const event = {
            start: 'order:in-transit',
            arrive: 'order:driver-arrived',
            location: 'order:driver-location',
            deliver: 'order:delivered',
          }[action];
          const payload = {
            orderId: result.order.id,
            status: result.order.status,
            updatedAt: result.order.updatedAt,
            ...(action === 'location' ? { latitude: result.order.lastDriverLatitude, longitude: result.order.lastDriverLongitude } : {}),
          };
          emitNotification(fastify.io, result.order.customer.user.id, 'CUSTOMER', event, payload, { requestId: requestContext.requestId, orderId: result.order.id });
          emitNotification(fastify.io, result.order.restaurant.userId, 'RESTAURANT', event, payload, { requestId: requestContext.requestId, orderId: result.order.id });
          if (action !== 'location') {
            const push = action === 'deliver'
              ? { title: '¡Pedido entregado!', body: 'El repartidor confirmó la entrega de tu pedido.' }
              : action === 'arrive'
                ? { title: '¡Ya llegó tu pedido!', body: 'El repartidor está en tu domicilio.' }
                : { title: '¡Tu pedido va en camino!', body: 'El repartidor recogió tu pedido y va hacia tu dirección.' };
            void sendPushNotification(result.order.customer.user.id, {
              ...push,
              icon: '/app-icon-192.png',
              badge: '/badge.png',
              data: { orderId: result.order.id, event, url: `/?orderId=${result.order.id}` },
            }).catch(error => request.log.warn({ err: error }, 'No se pudo enviar el aviso de entrega al cliente.'));
          }
        }
        return reply.send({ success: true, data: result.order });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });
  });
}
