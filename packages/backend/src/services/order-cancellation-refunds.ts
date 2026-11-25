import { PaymentMethod, PaymentStatus, PrismaClient, type Prisma } from '@prisma/client';
import { createTransferRefundTicket } from './refund-ticket.service';
import { enqueueRestaurantCardRefund } from './checkout-refund-enqueue';

type DbClient = PrismaClient | Prisma.TransactionClient;
type RefundableOrder = {
  id: string;
  clientOrderKey: string | null;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
};

/**
 * One entry point for every cancellation/rejection path: historical transfer
 * tickets and durable full card refunds. The card request is idempotent by
 * order ID, so concurrent cancellations issue at most one provider refund.
 */
export async function enqueueCancellationRefunds(
  client: DbClient,
  order: RefundableOrder,
  reason: string,
): Promise<string | null> {
  await createTransferRefundTicket(client, order.id, reason);
  return enqueueRestaurantCardRefund(client, order);
}
