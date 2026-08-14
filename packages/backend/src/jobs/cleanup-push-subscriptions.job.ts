import cron from 'node-cron';
import { prisma } from '../config/database';
import { probePushSubscription } from '../services/notification.service';
import { logger } from '../utils/logger';

// Umbral de antigüedad: solo probamos endpoints que no se han re-sincronizado
// recientemente. Una app activa re-sincroniza su suscripción al cargar
// (updatedAt se actualiza), así que los endpoints "dormidos" son los que
// probablemente murieron (dispositivo abandonado, navegador limpiado, iOS rota).
const STALE_DAYS = 30;
const BATCH_SIZE = 25;

/**
 * Barre suscripciones push obsoletas y elimina las que ya no están activas
 * (el navegador responde 410/404). Complementa la limpieza "lazy" que ocurre
 * en cada envío: aquí se limpian endpoints muertos aunque no se haya enviado
 * push a ese usuario recientemente.
 */
async function cleanupStalePushSubscriptions() {
  const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);

  const stale = await prisma.pushSubscription.findMany({
    where: { updatedAt: { lte: cutoff } },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });

  if (stale.length === 0) return 0;

  const deadIds: string[] = [];
  for (let i = 0; i < stale.length; i += BATCH_SIZE) {
    const batch = stale.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (sub) => {
        try {
          const alive = await probePushSubscription(sub);
          return alive ? null : sub.id;
        } catch {
          return null; // error no concluyente: no borrar
        }
      })
    );
    for (const id of results) {
      if (id) deadIds.push(id);
    }
  }

  if (deadIds.length === 0) return 0;

  const deleted = await prisma.pushSubscription.deleteMany({
    where: { id: { in: deadIds } },
  });
  return deleted.count;
}

export function startCleanupPushSubscriptionsJob() {
  cron.schedule('0 4 * * 1', async () => {
    try {
      const deleted = await cleanupStalePushSubscriptions();
      if (deleted > 0) {
        logger.info(`[CleanupPush] ${deleted} suscripciones push obsoletas eliminadas.`);
      }
    } catch (err) {
      logger.error('[CleanupPush] Error en limpieza de suscripciones push:', err);
    }
  });
}
