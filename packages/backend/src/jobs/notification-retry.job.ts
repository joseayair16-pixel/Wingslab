import cron from 'node-cron';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import { sendPushNotification, type NotificationPayload } from '../services/notification.service';
import { MAX_RETRY_ATTEMPTS } from '../services/notification-retry.service';
import { isRingPayload } from '../services/fcm.service';

/**
 * Ventana que se re-estampa al reenviar una alarma de pedido. El `expiresAt`
 * original es un instante absoluto: si el reintento ocurre después, la app
 * nativa lo descarta por vencido y el aviso no llegaría de ninguna forma.
 */
const RING_RETRY_WINDOW_MS = 2 * 60 * 1000;
const RETRY_CLAIM_LEASE_MS = 2 * 60 * 1000;

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
    // Atomic lease: multiple backend instances/overlapping cron ticks can read
    // the same row, but only one claims this exact due timestamp + attempt.
    const claim = await prisma.notificationRetry.updateMany({
      where: {
        id: retry.id,
        nextAttemptAt: { lte: now },
        attempts: retry.attempts,
        expiresAt: { gt: now },
      },
      data: { nextAttemptAt: new Date(Date.now() + RETRY_CLAIM_LEASE_MS) },
    }).catch(() => ({ count: 0 }));
    if (claim.count !== 1) continue;

    let payload: NotificationPayload;
    let webSubscriptionId: string | undefined;
    try {
      const { webSubscriptionId: target, ...notification } = JSON.parse(retry.payload) as NotificationPayload & { webSubscriptionId?: string };
      payload = notification;
      webSubscriptionId = target;
    } catch {
      await prisma.notificationRetry.deleteMany({ where: { id: retry.id } }).catch(() => undefined);
      continue;
    }

    try {
      // La alarma continua es la única notificación con caducidad propia: el
      // `expiresAt` que se encoló ya está vencido (los reintentos empiezan un
      // minuto después y el TTL llega a horas), así que se recalcula la ventana
      // desde ahora. Si no se re-sella, la app nativa descarta el data-message
      // y el reintento no serviría de nada.
      if (isRingPayload(payload) && payload.nativeRingExpiresAt !== undefined) {
        payload = { ...payload, nativeRingExpiresAt: Date.now() + RING_RETRY_WINDOW_MS };
      }

      const result = await sendPushNotification(retry.userId, payload, {
        skipRetryQueue: true, webSubscriptionId,
        ttl: Math.max(0, Math.floor((retry.expiresAt.getTime() - Date.now()) / 1000)),
      });
      if (result.success || (webSubscriptionId && result.reason === 'NO_SUBSCRIPTIONS')) {
        if (result.success) delivered += 1;
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
