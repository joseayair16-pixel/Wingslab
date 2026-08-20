import cron from 'node-cron';
import { FastifyInstance } from 'fastify';
import { prisma } from '../config/database';
import { emitNotification } from '../services/socket.service';
import { createTransferRefundTicket } from '../services/refund-ticket.service';
import { logger } from '../utils/logger';

const OWN_DELIVERY_CANCEL_HOURS = 24;
const POLL_INTERVAL_MIN = 30;

/**
 * Estado terminal para repartos propios (deliveredByRestaurant) que nunca se
 * completaron. Un pedido en reparto propio pasa a IN_TRANSIT al generar el QR
 * y queda así para siempre si nadie lo entrega (el token expira a las 3h pero
 * el pedido no). Este job cancela esos pedidos tras 24h de inactividad y crea
 * el ticket de reembolso idempotente si el cliente pagó por transferencia.
 */
export function startOwnDeliveryTimeoutJob(fastify: FastifyInstance) {
  cron.schedule(`*/${POLL_INTERVAL_MIN} * * * *`, async () => {
    try {
      const cutoff = new Date(Date.now() - OWN_DELIVERY_CANCEL_HOURS * 60 * 60 * 1000);

      const stale = await prisma.order.findMany({
        where: {
          status: 'IN_TRANSIT' as any,
          deliveredByRestaurant: true,
          inTransitAt: { not: null, lt: cutoff },
        },
        select: {
          id: true,
          orderReference: true,
          paymentMethod: true,
          restaurant: { select: { userId: true, name: true } },
          customer: { select: { userId: true, user: { select: { name: true } } } },
        },
        take: 100,
      });

      if (stale.length === 0) return;

      for (const order of stale) {
        try {
          await prisma.order.update({
            where: { id: order.id },
            data: {
              status: 'CANCELLED' as any,
              cancelledBy: 'system',
              cancellationReason: 'Reparto propio no completado en 24h.',
            },
          });

          await prisma.orderTracking.create({
            data: {
              orderId: order.id,
              status: 'CANCELLED' as any,
              notes: 'Pedido cancelado automáticamente: reparto propio no completado en 24h.',
            },
          });

          await createTransferRefundTicket(prisma, order.id, 'Pedido no entregado por reparto propio.');

          emitNotification(fastify.io, order.customer.userId, 'CUSTOMER', 'order:cancelled', {
            orderId: order.id,
            status: 'CANCELLED',
            message: 'Tu pedido fue cancelado porque no se pudo completar la entrega.',
          });

          logger.info(
            `[OwnDeliveryTimeout] Pedido ${order.orderReference} cancelado por reparto propio no completado en ${OWN_DELIVERY_CANCEL_HOURS}h.`
          );
        } catch (err) {
          logger.error(`[OwnDeliveryTimeout] Error cancelando pedido ${order.id}:`, err);
        }
      }
    } catch (error) {
      logger.error('[OwnDeliveryTimeout] Error crítico:', error);
    }
  });

  logger.info(`[OwnDeliveryTimeout] Job iniciado (c/${POLL_INTERVAL_MIN}min). Cancela repartos propios sin entregar >${OWN_DELIVERY_CANCEL_HOURS}h`);
}