import { FastifyInstance } from 'fastify';
import { UserRole } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '../config/database';
import { sendAppError } from '../errors/http';
import { authenticate, authorize, getAuthenticatedUser } from '../middleware/auth';
import { emitNotification } from '../services/socket.service';
import { sendPushNotification } from '../services/notification.service';
import { buildCustomerDeliveryUrl } from '../utils/customer-web';
import { getOrCreateRequestContext } from '../utils/request-context';
import { requireRestaurantOperable } from './restaurant-panel.routes';
import {
  assignOwnDriverToOrder,
  createRestaurantDriver,
  listRestaurantDrivers,
  payPendingDriverEarnings,
  updateRestaurantDriver,
} from '../services/restaurant-driver.service';

const createDriverSchema = z.object({
  name: z.string().trim().min(2).max(80),
  lastName: z.string().trim().max(80).optional(),
  phone: z.string().trim().min(10).max(20),
  email: z.string().trim().email().max(254),
  deliveryCompensation: z.coerce.number().positive().max(5000).optional(),
});

const updateDriverSchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  deliveryCompensation: z.coerce.number().positive().max(5000).optional(),
}).refine(value => value.status !== undefined || value.deliveryCompensation !== undefined, {
  message: 'Indica un cambio de estado o de compensación.',
});

const payDriverSchema = z.object({ notes: z.string().trim().max(500).optional() }).optional();
const assignDriverSchema = z.object({ driverId: z.string().min(1) });

export async function registerRestaurantDriverRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.register(async function restaurantDriverScope(scope) {
    scope.addHook('preHandler', authenticate);
    scope.addHook('preHandler', authorize([UserRole.RESTAURANT]));
    scope.addHook('preHandler', requireRestaurantOperable);

    scope.get('/restaurant-panel/repartidores', async (request, reply) => {
      try {
        const user = getAuthenticatedUser(request);
        return reply.send({ success: true, data: await listRestaurantDrivers(prisma, user.sub) });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    scope.get('/restaurant-panel/repartidores/actividad', async (request, reply) => {
      const query = z.object({ days: z.coerce.number().int().refine(value => [1, 7, 30, 90].includes(value)), driverId: z.string().min(1).optional(), page: z.coerce.number().int().min(1).max(10000).default(1) }).safeParse(request.query);
      if (!query.success) return reply.status(400).send({ success: false, error: { code: 'INVALID_QUERY', message: 'Selecciona un periodo válido.' } });
      try {
        const user = getAuthenticatedUser(request);
        const drivers = await listRestaurantDrivers(prisma, user.sub);
        const ids = drivers.map((driver: any) => driver.id);
        const { days, driverId, page } = query.data;
        if (driverId && !ids.includes(driverId)) return reply.status(404).send({ success: false, error: { code: 'DRIVER_NOT_FOUND', message: 'No se encontró el repartidor.' } });
        const from = new Date(Date.now() - days * 86400000);
        const where = { driverId: { in: ids }, status: 'DELIVERED' as const, deliveredAt: { gte: from, lte: new Date() } };
        const counts = await prisma.order.groupBy({ by: ['driverId'], where, _count: { _all: true } });
        const orders = driverId ? await prisma.order.findMany({ where: { ...where, driverId }, select: { id: true, orderReference: true, dailyCounter: true, deliveredAt: true }, orderBy: [{ deliveredAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 20, take: 21 }) : [];
        return reply.send({ success: true, data: { counts: counts.map(row => ({ driverId: row.driverId, count: row._count._all })), orders: orders.slice(0, 20), hasMore: orders.length > 20 } });
      } catch (error) { return sendAppError(reply, error); }
    });

    scope.post('/restaurant-panel/repartidores', async (request, reply) => {
      const parsed = createDriverSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_PAYLOAD', message: parsed.error.issues[0]?.message || 'Revisa los datos del repartidor.' } });
      }
      try {
        const user = getAuthenticatedUser(request);
        const result = await createRestaurantDriver(prisma, user.sub, parsed.data);
        return reply.status(201).send({ success: true, data: result });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    scope.patch('/restaurant-panel/repartidores/:id', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      const parsed = updateDriverSchema.safeParse(request.body);
      if (!params.success || !parsed.success) {
        const message = params.success ? parsed.error?.issues[0]?.message : params.error.issues[0]?.message;
        return reply.status(400).send({ success: false, error: { code: 'INVALID_PAYLOAD', message: message || 'Datos inválidos.' } });
      }
      try {
        const user = getAuthenticatedUser(request);
        return reply.send({ success: true, data: await updateRestaurantDriver(prisma, user.sub, params.data.id, parsed.data) });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    scope.post('/restaurant-panel/repartidores/:id/pagos', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      const parsed = payDriverSchema.safeParse(request.body);
      if (!params.success || !parsed.success) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_PAYLOAD', message: 'Datos de pago inválidos.' } });
      }
      try {
        const user = getAuthenticatedUser(request);
        const payout = await payPendingDriverEarnings(prisma, user.sub, params.data.id, parsed.data?.notes);
        return reply.status(201).send({ success: true, data: payout });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    scope.post('/restaurant-panel/pedidos/:id/repartidor', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      const parsed = assignDriverSchema.safeParse(request.body);
      if (!params.success || !parsed.success) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_PAYLOAD', message: 'Indica un repartidor válido.' } });
      }
      const user = getAuthenticatedUser(request);
      const requestContext = getOrCreateRequestContext(request);
      try {
        const result = await assignOwnDriverToOrder(prisma, user.sub, params.data.id, parsed.data.driverId);
        const order = result.order;
        if (!order.driver) throw new Error('La asignación no devolvió el perfil del repartidor.');

        emitNotification(fastify.io, order.driver.userId, 'DRIVER', 'order:assigned', {
          orderId: order.id,
          orderReference: order.orderReference,
          restaurantName: order.restaurant.name,
        }, { requestId: requestContext.requestId, orderId: order.id });
        emitNotification(fastify.io, order.customer.user.id, 'CUSTOMER', 'order:driver-assigned', {
          orderId: order.id,
          driverName: order.driver.user.name,
        }, { requestId: requestContext.requestId, orderId: order.id });
        emitNotification(fastify.io, user.sub, 'RESTAURANT', 'order:driver-assigned', {
          orderId: order.id,
          driverName: order.driver.user.name,
        }, { requestId: requestContext.requestId, orderId: order.id });

        void sendPushNotification(order.driver.userId, {
          title: 'Nueva entrega asignada',
          body: `${order.restaurant.name} te asignó el pedido ${order.orderReference}.`,
          icon: '/app-icon-192.png',
          badge: '/badge.png',
          tag: `own-driver-order-${order.id}`,
          requireInteraction: true,
          data: { orderId: order.id, event: 'order:assigned', url: '/' },
        }).catch(error => request.log.warn({ err: error }, 'No se pudo enviar el aviso push de nueva entrega.'));

        return reply.send({
          success: true,
          data: {
            ...order,
            deliveryToken: {
              token: result.token.tokenStr,
              expiresAt: result.token.expiresAt,
              url: buildCustomerDeliveryUrl(result.token.tokenStr),
            },
          },
        });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });
  });
}
