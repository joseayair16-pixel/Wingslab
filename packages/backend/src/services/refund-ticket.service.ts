import { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { logger } from '../utils/logger';

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Crea automáticamente un ticket de soporte detallado cuando un pedido pagado
 * por TRANSFERENCIA se rechaza o cancela. El comensal ya no necesita llenar
 * formularios: soporte contactará al comensal y al restaurante para coordinar
 * la devolución.
 *
 * Idempotente: nunca se crean dos tickets para el mismo pedido.
 */
export async function createTransferRefundTicket(
  client: DbClient,
  orderId: string,
  reason: string
): Promise<void> {
  const order = await client.order.findFirst({
    where: { id: orderId },
    select: {
      id: true,
      orderReference: true,
      paymentMethod: true,
      totalAmount: true,
      paymentProofUrl: true,
      notes: true,
      cancellationReason: true,
      cancelledBy: true,
      restaurant: { select: { name: true } },
      customer: {
        select: {
          id: true,
          user: { select: { name: true, lastName: true, phone: true, email: true } },
        },
      },
    },
  });

  if (!order) return;
  if (order.paymentMethod !== 'TRANSFER') return;

  const existing = await client.supportTicket.findFirst({
    where: { orderNumber: order.orderReference, type: 'ORDER' },
    select: { id: true },
  });
  if (existing) return;

  const customerName = [order.customer.user.name, order.customer.user.lastName]
    .filter(Boolean)
    .join(' ');

  const description = [
    'REEMBOLSO POR TRANSFERENCIA — PEDIDO NO ENTREGADO',
    '',
    `Pedido: ${order.orderReference}`,
    `Restaurante: ${order.restaurant?.name ?? 'N/A'}`,
    `Cliente: ${customerName} (${order.customer.user.phone ?? 'sin teléfono'})`,
    `Email: ${order.customer.user.email ?? 'N/A'}`,
    `Monto total: $${order.totalAmount.toFixed(2)}`,
    `Método de pago: TRANSFERENCIA`,
    `Comprobante de pago: ${order.paymentProofUrl ?? 'No proporcionado'}`,
    `Motivo: ${reason}`,
    order.cancellationReason ? `Razón de cancelación: ${order.cancellationReason}` : '',
    order.cancelledBy ? `Cancelado por: ${order.cancelledBy}` : '',
    order.notes ? `Notas del pedido: ${order.notes}` : '',
    '',
    'ACCIÓN REQUERIDA: Soporte debe contactar al comensal y al restaurante para coordinar la devolución de este pago por transferencia.',
  ]
    .filter((line) => line !== '')
    .join('\n');

  await client.supportTicket.create({
    data: {
      type: 'ORDER',
      subject: `Reembolso por transferencia - Pedido ${order.orderReference}`,
      description,
      storeName: order.restaurant?.name ?? 'SaDeL',
      orderNumber: order.orderReference,
      customerId: order.customer.id,
    },
  });

  logger.info('Ticket de reembolso por transferencia creado automáticamente', {
    orderId: order.id,
    orderReference: order.orderReference,
    reason,
  });
}
