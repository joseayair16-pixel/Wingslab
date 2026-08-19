import cron from 'node-cron';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import { sendPushNotification, type NotificationPayload } from '../services/notification.service';
import { MAX_RETRY_ATTEMPTS } from '../services/notification-retry.service';

/**
 * Reenvía notificaciones críticas que fallaron en su primer intento y quedaron
 * encoladas (columna de seguridad: FCM caído, rate-limit, red, etc.). Corre
 * cada 5 minutos; el backoff interno espacia los reintentos por notificación.
 */
export function startNotificationRetryJob() {
  cron.schedule('*/5 * * * *', async () => {
    try {
      const delivered = await processNotificationRetries();
      if (delivered > 0) {
        logger.info(`[NotificationRetry] ${delivered} notificaciones reenviadas en diferido.`);
      }
    } catch (err) {
      logger.error('[NotificationRetry] Error en job de reintentos:', err);
    }
  });
}

/** Backoff entre reintentos de la cola (creciente, con tope). */
function nextBackoffMs(attempts: number): number {
  const base = 60 * 1000; // 1 min
  return Math.min(base * Math.pow(2, attempts), 60 * 60 * 1000); // tope 1h
}

/**
 * Reintenta las notificaciones pendientes (nextAttemptAt <= ahora y no
 * expiradas). Un fallo vuelve a retrasar el siguiente intento con backoff;
 * al superar maxAttempts o expirar el TTL, se descarta definitivamente.
 */
export async function processNotificationRetries(batchSize = 50): Promise<number> {
  const now = new Date();
  const due = await prisma.notificationRetry.findMany({
    where: {
      nextAttemptAt: { lte: now },
      expiresAt: { gt: now },
    },
    orderBy: { nextAttemptAt: 'asc' },
    take: batchSize,
  });

  let delivered = 0;
  for (const retry of due) {
    let payload: NotificationPayload;
    try {
      payload = JSON.parse(retry.payload) as NotificationPayload;
    } catch {
      await prisma.notificationRetry.delete({ where: { id: retry.id } }).catch(() => undefined);
      continue;
    }

    try {
      const result = await sendPushNotification(retry.userId, payload, { skipRetryQueue: true });
      if (result.success) {
        delivered += 1;
        await prisma.notificationRetry.delete({ where: { id: retry.id } }).catch(() => undefined);
        continue;
      }

      await prisma.notificationRetry.update({
        where: { id: retry.id },
        data: {
          attempts: { increment: 1 },
          lastError: 'No entregado en reintento',
          nextAttemptAt: new Date(Date.now() + nextBackoffMs(retry.attempts)),
        },
      }).catch(() => undefined);
    } catch (error: any) {
      await prisma.notificationRetry.update({
        where: { id: retry.id },
        data: {
          attempts: { increment: 1 },
          lastError: error?.message || 'Error desconocido',
          nextAttemptAt: new Date(Date.now() + nextBackoffMs(retry.attempts)),
        },
      }).catch(() => undefined);
    }
  }

  // Limpia entradas que expiraron o agotaron intentos (housekeeping).
  await prisma.notificationRetry.deleteMany({
    where: {
      OR: [
        { expiresAt: { lte: new Date() } },
        { attempts: { gte: MAX_RETRY_ATTEMPTS } },
      ],
    },
  }).catch(() => undefined);

  return delivered;
}