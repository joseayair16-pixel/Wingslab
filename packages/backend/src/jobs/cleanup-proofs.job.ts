import cron from 'node-cron';
import { prisma } from '../config/database';
import { urlToKey, deleteImages } from '../services/storage.service';
import { logger } from '../utils/logger';

const PROOF_RETENTION_DAYS = 90;

async function cleanupExpiredPaymentProofs() {
  const cutoff = new Date(Date.now() - PROOF_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const expiredRestaurantProofs = await prisma.restaurantBillingSettlement.findMany({
    where: {
      paymentProofUrl: { not: null },
      createdAt: { lte: cutoff },
    },
    select: { id: true, paymentProofUrl: true },
  });

  const expiredDriverProofs = await prisma.driverBillingSettlement.findMany({
    where: {
      paymentProofUrl: { not: null },
      createdAt: { lte: cutoff },
    },
    select: { id: true, paymentProofUrl: true },
  });

  const expiredFeaturedProofs = await prisma.featuredPurchase.findMany({
    where: {
      paymentProof: { not: null },
      createdAt: { lte: cutoff },
    },
    select: { id: true, paymentProof: true },
  });

  const allKeys = [
    ...expiredRestaurantProofs.map((r) => urlToKey(r.paymentProofUrl!)),
    ...expiredDriverProofs.map((r) => urlToKey(r.paymentProofUrl!)),
    ...expiredFeaturedProofs.map((r) => urlToKey(r.paymentProof!)),
  ].filter((k): k is string => !!k);

  if (allKeys.length === 0) return 0;

  await deleteImages(allKeys);

  await prisma.$transaction([
    prisma.restaurantBillingSettlement.updateMany({
      where: { id: { in: expiredRestaurantProofs.map((r) => r.id) } },
      data: { paymentProofUrl: null },
    }),
    prisma.driverBillingSettlement.updateMany({
      where: { id: { in: expiredDriverProofs.map((r) => r.id) } },
      data: { paymentProofUrl: null },
    }),
    prisma.featuredPurchase.updateMany({
      where: { id: { in: expiredFeaturedProofs.map((r) => r.id) } },
      data: { paymentProof: null },
    }),
  ]);

  return allKeys.length;
}

export function startCleanupProofsJob() {
  cron.schedule('0 3 * * 0', async () => {
    try {
      const deleted = await cleanupExpiredPaymentProofs();
      if (deleted > 0) {
        logger.info(`[CleanupProofs] ${deleted} comprobantes de pago antiguos eliminados de R2.`);
      }
    } catch (err) {
      logger.error('[CleanupProofs] Error en limpieza de comprobantes:', err);
    }
  });
}
