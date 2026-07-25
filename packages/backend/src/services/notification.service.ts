import webpush from 'web-push';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';

let vapidConfigured = false;

function initVapid(): void {
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidEmail = process.env.VAPID_EMAIL || 'mailto:support@sadel.app';

  if (vapidPublicKey && vapidPrivateKey) {
    webpush.setVapidDetails(vapidEmail, vapidPublicKey, vapidPrivateKey);
    vapidConfigured = true;
    logger.info('[PushService] VAPID configurado correctamente');
  } else {
    vapidConfigured = false;
    logger.error('[PushService] VAPID no configurado — las notificaciones push NO funcionarán. Agrega VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY en .env.local');
  }
}

initVapid();

export type NotificationPayload = {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  vibrate?: number[];
  requireInteraction?: boolean;
  sound?: string;
  data?: Record<string, unknown>;
};

export const sendPushNotification = async (
  userId: string,
  payload: NotificationPayload
) => {
  if (!vapidConfigured) {
    logger.error(`[PushService] Intento de enviar push sin VAPID configurado (userId=${userId}, title="${payload.title}")`);
    return { success: false, reason: 'VAPID_NOT_CONFIGURED' };
  }

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId },
  });

  if (subscriptions.length === 0) {
    logger.info(`[PushService] Sin suscripciones push para usuario ${userId}`);
    return { success: false, reason: 'NO_SUBSCRIPTIONS' };
  }

  const payloadString = JSON.stringify(payload);
  const results = await Promise.allSettled(
    subscriptions.map(async (sub) => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      };

      try {
        await webpush.sendNotification(pushSubscription, payloadString);
        return { success: true, endpoint: sub.endpoint };
      } catch (error: any) {
        logger.error(`[PushService] Fallo al enviar push a ${sub.endpoint}`, { error: error.message, statusCode: error.statusCode });

        if (error.statusCode === 410 || error.statusCode === 404) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } });
          logger.info(`[PushService] Suscripción expirada eliminada: ${sub.id}`);
        }

        throw error;
      }
    })
  );

  const successful = results.filter((r) => r.status === 'fulfilled').length;
  logger.info(`[PushService] Resumen: ${successful}/${subscriptions.length} exitosos para usuario ${userId}`);

  return {
    success: successful > 0,
    totalSent: successful,
    totalAttempted: subscriptions.length,
  };
};
