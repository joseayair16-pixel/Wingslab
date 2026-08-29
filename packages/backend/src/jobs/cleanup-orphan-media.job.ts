import cron from 'node-cron';
import { RestaurantStatus } from '@prisma/client';
import { prisma } from '../config/database';
import { urlToKey, deleteImages } from '../services/storage.service';
import { logger } from '../utils/logger';

// GC de medios huérfanos: repurga de R2 los blobs de restaurantes ya eliminados (soft-delete)
// y nulifica las referencias para que las ejecuciones siguientes sean no-ops idempotentes.
async function purgeDeletedRestaurantMedia(): Promise<number> {
  const deleted = await prisma.restaurant.findMany({
    where: { status: RestaurantStatus.DELETED },
    select: { id: true, userId: true, logo: true, coverImage: true, featuredFlyer: true },
  });

  let purged = 0;
  for (const r of deleted) {
    const user = await prisma.user.findUnique({
      where: { id: r.userId },
      select: { profilePhoto: true },
    });
    const products = await prisma.product.findMany({
      where: { restaurantId: r.id },
      select: { image: true, images: true },
    });

    const keys = [
      r.logo,
      r.coverImage,
      r.featuredFlyer,
      user?.profilePhoto,
      ...products.flatMap((p) => [p.image, ...(p.images ?? [])]),
    ]
      .map(urlToKey)
      .filter((k): k is string => !!k);

    if (keys.length > 0) {
      try {
        await deleteImages(keys);
        purged += keys.length;
      } catch (err) {
        logger.error(`[OrphanMedia] Fallo al purgar R2 para restaurante ${r.id}:`, err);
      }
    }

    // Null references so subsequent runs skip them.
    await prisma.restaurant.update({
      where: { id: r.id },
      data: { logo: null, coverImage: null, featuredFlyer: null },
    });
    await prisma.product.updateMany({
      where: { restaurantId: r.id },
      data: { image: null, images: [] },
    });
    await prisma.user.update({
      where: { id: r.userId },
      data: { profilePhoto: null },
    });
  }

  if (purged > 0) {
    logger.info(`[OrphanMedia] ${purged} blobs huérfanos purgados de ${deleted.length} restaurantes eliminados.`);
  }
  return purged;
}

export function startCleanupOrphanMediaJob() {
  cron.schedule('10 3 * * 0', async () => {
    try {
      await purgeDeletedRestaurantMedia();
    } catch (err) {
      logger.error('[OrphanMedia] Error en GC de media huérfana:', err);
    }
  });
}
