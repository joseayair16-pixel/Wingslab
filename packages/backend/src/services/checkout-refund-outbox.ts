import type { PrismaClient } from '@prisma/client';
import { fetchMercadoPagoOrder, refundAccreditedMercadoPagoOrder } from './mercado-pago-orders';

const BATCH_SIZE = 20;
const LEASE_MS = 30_000;
const MAX_BACKOFF_MS = 6 * 60 * 60_000;

/** Retry durable full-refund requests without ever issuing a new idempotency key. */
export async function processCheckoutRefundOutbox(
  db: PrismaClient,
  accessToken: string | undefined,
  onError: (error: unknown, orderId: string) => void,
  now = new Date(),
  limit = BATCH_SIZE,
) {
  if (!accessToken) return 0;
  const due = await db.checkoutRefundRequest.findMany({
    where: {
      OR: [
        { state: 'PENDING', nextAttemptAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] },
        { state: 'PROCESSING', leaseUntil: { lte: now } },
      ],
    },
    orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
    take: Math.min(Math.max(limit, 1), BATCH_SIZE),
    select: { id: true, orderId: true },
  });

  let refunded = 0;
  for (const candidate of due) {
    const claimed = await db.checkoutRefundRequest.updateMany({
      where: {
        id: candidate.id,
        OR: [
          { state: 'PENDING', nextAttemptAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] },
          { state: 'PROCESSING', leaseUntil: { lte: now } },
        ],
      },
      data: { state: 'PROCESSING', leaseUntil: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 } },
    });
    if (!claimed.count) continue;

    try {
      const request = await db.checkoutRefundRequest.findUniqueOrThrow({ where: { id: candidate.id } });
      const order = await fetchMercadoPagoOrder(accessToken, request.providerOrderId);
      if (order.external_reference !== request.intentId) throw new Error('La orden del proveedor no coincide con el intento local.');

      // A lost refund response is reconciled by reading the order before retrying.
      if (order.status === 'refunded' || (order.status === 'processed' && order.status_detail === 'refunded')) {
        await db.checkoutRefundRequest.update({
          where: { id: request.id },
          data: { state: 'REFUNDED', refundedAt: new Date(), leaseUntil: null, lastError: null },
        });
        refunded += 1;
        continue;
      }

      await refundAccreditedMercadoPagoOrder(accessToken, order, request.id);
      await db.checkoutRefundRequest.update({
        where: { id: request.id },
        data: { state: 'REFUNDED', refundedAt: new Date(), leaseUntil: null, lastError: null },
      });
      refunded += 1;
    } catch (error) {
      onError(error, candidate.orderId);
      const request = await db.checkoutRefundRequest.findUnique({ where: { id: candidate.id }, select: { attempts: true } });
      const attempts = request?.attempts ?? 1;
      const backoff = Math.min(15_000 * (2 ** Math.min(attempts - 1, 10)), MAX_BACKOFF_MS);
      await db.checkoutRefundRequest.update({
        where: { id: candidate.id },
        data: {
          state: 'PENDING', leaseUntil: null, nextAttemptAt: new Date(Date.now() + backoff),
          lastError: 'El reembolso no pudo confirmarse; requiere reintento.',
        },
      }).catch(retryError => onError(retryError, candidate.orderId));
    }
  }
  return refunded;
}
