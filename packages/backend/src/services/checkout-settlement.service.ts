import type { PrismaClient } from '@prisma/client';
import type { Server as SocketIOServer } from 'socket.io';
import { recordVerifiedCheckoutPayment } from './checkout-payment-intent';
import { finalizeVerifiedCustomerCheckout } from './order.service';
import { dispatchCheckoutKitchenOutbox } from './checkout-kitchen-outbox';
import type { MercadoPagoOrder } from './mercado-pago-orders';

/**
 * Single idempotent settlement path shared by the charge response, the
 * webhook and the background reconciliation. A repeated call never creates a
 * second order and never enqueues the kitchen twice.
 */
export async function settleVerifiedCheckoutPayment(
  prisma: PrismaClient,
  io: SocketIOServer | undefined,
  intentId: string,
  order: MercadoPagoOrder,
  onError: (error: unknown, orderId: string) => void = () => {},
): Promise<boolean> {
  if (!await recordVerifiedCheckoutPayment(prisma, intentId, order)) return false;
  const result = await finalizeVerifiedCustomerCheckout(prisma, intentId);
  if (!result.isDuplicate) {
    await dispatchCheckoutKitchenOutbox(prisma, io, onError).catch(error => onError(error, result.order.id));
  }
  return true;
}
