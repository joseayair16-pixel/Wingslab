import type { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { emitNotification } from './socket.service';
import { enqueueRestaurantOrder } from './order-workflow.service';
import { sendPushNotification } from './notification.service';

const BATCH_SIZE = 50;
const LEASE_MS = 30_000;
const MAX_BACKOFF_MS = 5 * 60_000;

/** Durable retry for enqueueing an already-committed paid order into the restaurant queue. */
export async function dispatchCheckoutKitchenOutbox(
  db: PrismaClient,
  io: SocketIOServer | undefined,
  onError: (error: unknown, orderId: string) => void,
  now = new Date(),
  limit = BATCH_SIZE,
) {
  const due = await db.kitchenOrderOutbox.findMany({
    where: {
      status: 'PENDING',
      nextAttemptAt: { lte: now },
      OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
    },
    orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
    take: Math.min(Math.max(limit, 1), BATCH_SIZE),
    select: { orderId: true },
  });

  let delivered = 0;
  for (const { orderId } of due) {
    const claimed = await db.kitchenOrderOutbox.updateMany({
      where: {
        orderId,
        status: 'PENDING',
        nextAttemptAt: { lte: now },
        OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
      },
      data: { status: 'PROCESSING', leaseUntil: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 } },
    });
    if (!claimed.count) continue;

    try {
      const row = await db.kitchenOrderOutbox.findUniqueOrThrow({ where: { orderId } });
      const order = await db.order.findUnique({
        where: { id: orderId },
        select: {
          id: true, restaurantId: true, orderReference: true, paymentMethod: true, createdAt: true,
          restaurant: { select: { userId: true } },
        },
      });
      if (!order) throw new Error('El pedido confirmado no está disponible.');

      // Redis ZADD is idempotent by order ID. Throw on Redis failure so outbox retry is real.
      await enqueueRestaurantOrder(row.restaurantId, orderId, row.orderCreatedAt, { throwOnError: true });
      if (io) emitNotification(io, order.restaurant.userId, 'RESTAURANT', 'order:created', {
        orderId, orderReference: order.orderReference, paymentMethod: order.paymentMethod,
      }, { orderId });
      // Push is independent of queue delivery: do not replay a paid order if
      // the provider fails; the notification service owns transient retries.
      void sendPushNotification(order.restaurant.userId, {
        title: '¡Nuevo pedido pagado!',
        body: `Pedido ${order.orderReference} — pago con tarjeta confirmado.`,
        icon: '/app-icon-192.png',
        badge: '/badge.png',
        vibrate: [500, 200, 500, 200, 500],
        requireInteraction: true,
        sound: '/sounds/notifica.wav',
        tag: `new-order-${orderId}`,
        data: { orderId, orderReference: order.orderReference, event: 'order:created', url: `/?orderId=${orderId}` },
      }).catch(error => onError(error, orderId));
      await db.kitchenOrderOutbox.update({
        where: { orderId },
        data: { status: 'DELIVERED', deliveredAt: new Date(), leaseUntil: null, lastError: null },
      });
      delivered += 1;
    } catch (error) {
      onError(error, orderId);
      const row = await db.kitchenOrderOutbox.findUnique({ where: { orderId }, select: { attempts: true } });
      const attempts = row?.attempts ?? 1;
      const backoff = Math.min(5_000 * (2 ** Math.min(attempts - 1, 6)), MAX_BACKOFF_MS);
      await db.kitchenOrderOutbox.update({
        where: { orderId },
        data: {
          status: 'PENDING', leaseUntil: null,
          nextAttemptAt: new Date(Date.now() + backoff),
          lastError: 'No se pudo entregar el pedido a cocina.',
        },
      }).catch(retryError => onError(retryError, orderId));
    }
  }
  return delivered;
}
