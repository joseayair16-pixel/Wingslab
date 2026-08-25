import { Prisma } from '@prisma/client';

/**
 * Restaura el stock reservado de una orden al cancelarse o rechazarse.
 * Solo afecta ítems vendidos por unidad (sellBy=UNIT) de productos con
 * trackStock activo. Es idempotente a nivel de lógica: solo incrementa lo
 * que fue decrementado al crear la orden.
 */
export async function restoreStockForOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<void> {
  const items = await tx.orderItem.findMany({
    where: { orderId },
    select: { productId: true, quantity: true, sellBy: true },
  });
  if (items.length === 0) return;

  const products = await tx.product.findMany({
    where: { id: { in: items.map((i) => i.productId) } },
    select: { id: true, trackStock: true },
  });
  const trackById = new Map(products.map((p) => [p.id, p.trackStock]));

  for (const item of items) {
    if (item.sellBy === 'UNIT' && trackById.get(item.productId)) {
      await tx.product.update({
        where: { id: item.productId },
        data: { stock: { increment: item.quantity } },
      });
    }
  }
}
