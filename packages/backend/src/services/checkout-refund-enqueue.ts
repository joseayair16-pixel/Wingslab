import { randomUUID } from 'node:crypto';
import { PaymentMethod, PaymentStatus, PrismaClient, type Prisma } from '@prisma/client';
import { AppError } from '../errors/app-error';

type DbClient = PrismaClient | Prisma.TransactionClient;

/** Enqueue exactly one durable full refund for a paid card order. */
export async function enqueueRestaurantCardRefund(client: DbClient, order: {
  id: string; clientOrderKey: string | null; paymentMethod: PaymentMethod; paymentStatus: PaymentStatus;
}): Promise<string | null> {
  if (order.paymentMethod !== PaymentMethod.CREDIT_CARD || order.paymentStatus !== PaymentStatus.COMPLETED) return null;
  const intentId = /^mp:([0-9a-f-]{36})$/i.exec(order.clientOrderKey ?? '')?.[1];
  const intent = intentId && await client.checkoutPaymentIntent.findUnique({
    where: { id: intentId }, select: { providerOrderId: true },
  });
  if (!intentId || !intent || !intent.providerOrderId) {
    throw new AppError(409, 'CARD_REFUND_UNAVAILABLE', 'No se encontró el pago necesario para iniciar el reembolso.');
  }
  const id = randomUUID();
  // orderId is unique: a concurrent cancellation must not enqueue twice.
  const inserted = await client.checkoutRefundRequest.createMany({
    data: { id, orderId: order.id, intentId, providerOrderId: intent.providerOrderId },
    skipDuplicates: true,
  });
  if (inserted.count) return id;
  const existing = await client.checkoutRefundRequest.findUnique({ where: { orderId: order.id }, select: { id: true } });
  return existing?.id ?? null;
}
