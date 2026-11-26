import { Prisma } from '@prisma/client';

/** Legacy hook: orders no longer change product inventory. */
export async function restoreStockForOrder(
  _tx: Prisma.TransactionClient,
  _orderId: string,
): Promise<void> {
}
