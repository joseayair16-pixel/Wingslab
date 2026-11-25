import webpush from 'web-push';
import { webPushEnabled } from '../config/isolation';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import { isFcmConfigured, sendFcmNotification } from './fcm.service';
import { computeRetryTtlMs, enqueueNotificationRetry } from './notification-retry.service';
import type { NotificationPayload, PushOptions } from './notification-types';

export type { NotificationPayload, PushOptions };

let vapidConfigured = false;

function initVapid(): void {
  if (!webPushEnabled()) return;
  const vapidPublicKey = process.env.WINGSLAB_WEB_PUSH_PUBLIC_KEY;
  const vapidPrivateKey = process.env.WINGSLAB_WEB_PUSH_PRIVATE_KEY;
  const vapidEmail = process.env.WINGSLAB_WEB_PUSH_CONTACT!;

  if (vapidPublicKey && vapidPrivateKey) {
    webpush.setVapidDetails(vapidEmail, vapidPublicKey, vapidPrivateKey);
    vapidConfigured = true;
    logger.info('[PushService] VAPID configurado correctamente');
  } else {
    vapidConfigured = false;
    logger.error('[PushService] Web Push opt-in activo pero su configuración VAPID está incompleta.');
  }
}

initVapid();

export function isVapidConfigured(): boolean {
  return vapidConfigured;
}

const RETRY_CONFIG = {
  maxAttempts: 3,
  baseDelayMs: 1000,
} as const;

function isTransientError(error: any): boolean {
  if (!error) return false;
  const code = error.statusCode;
  if (code === 429) return true;
  if (code >= 500 && code < 600) return true;
  if (code === undefined && error.message?.includes('network') || error.message?.includes('timeout') || error.message?.includes('ETIMEDOUT') || error.message?.includes('ECONNRESET')) return true;
  return false;
}

function isExpiredSubscription(error: any): boolean {
  return error?.statusCode === 410 || error?.statusCode === 404;
}

/**
 * Verifica si una suscripción push sigue viva enviando un push de prueba
 * silencioso (sin sonido ni vibración, visibilidad mínima). Devuelve
 * `true` si el endpoint respondió OK y `false` si expiró (410/404).
 */
export async function probePushSubscription(sub: {
  endpoint: string;
  p256dh: string;
  auth: string;
}): Promise<boolean> {
  if (!vapidConfigured) return true; // sin VAPID no podemos saber; no borrar
  const pushSubscription = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.p256dh, auth: sub.auth },
  };
  const payload = JSON.stringify({
    title: 'SaDeL',
    body: '',
    silent: true,
    tag: 'sadel-push-probe',
    data: { probe: true },
  });
  try {
    await webpush.sendNotification(pushSubscription, payload, {
      TTL: 60,
      urgency: 'very-low' as any,
    });
    return true;
  } catch (error: any) {
    if (isExpiredSubscription(error)) {
      return false;
    }
    if (isTransientError(error)) {
      // No concluyente: no borrar por un error de red transitorio.
      return true;
    }
    return true;
  }
}

function determineUrgency(payload: NotificationPayload): 'high' | 'normal' {
  if (payload.sound) return 'high';
  if (payload.requireInteraction) return 'high';
  if (payload.vibrate && payload.vibrate.some(v => v >= 500)) return 'high';
  return 'normal';
}

async function sendWithRetry(
  subscription: webpush.PushSubscription,
  payloadString: string,
  options: { ttl: number; urgency: string },
  attempt: number = 1
): Promise<{ success: boolean }> {
  try {
    await webpush.sendNotification(subscription, payloadString, {
      TTL: options.ttl,
      urgency: options.urgency as any,
      timeout: 5000,
    });
    return { success: true };
  } catch (error: any) {
    if (isExpiredSubscription(error)) {
      throw error;
    }

    if (isTransientError(error) && attempt < RETRY_CONFIG.maxAttempts) {
      const delay = RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt - 1);
      logger.warn(`[PushService] Reintento ${attempt}/${RETRY_CONFIG.maxAttempts} en ${delay}ms — HTTP ${error?.statusCode || 'sin estado'}`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return sendWithRetry(subscription, payloadString, options, attempt + 1);
    }

    throw error;
  }
}

export const sendPushNotification = async (
  userId: string,
  payload: NotificationPayload,
  options?: PushOptions
) => {
  // No crear ruido en la cola cuando ningún proveedor de push está autorizado.
  // La ruta existente sigue siendo el único punto de envío cuando Web Push se opta.
  if (!vapidConfigured && !isFcmConfigured()) {
    return { success: false, reason: 'WEB_PUSH_DISABLED', totalSent: 0, totalAttempted: 0 };
  }

  const [subscriptions, fcmTokens] = await Promise.all([
    vapidConfigured ? prisma.pushSubscription.findMany({ where: { userId, id: options?.webSubscriptionId } }) : [],
    !options?.webSubscriptionId && isFcmConfigured() ? prisma.fcmToken.findMany({ where: { userId } }) : [],
  ]);

  const webPushEnabled = vapidConfigured && subscriptions.length > 0;
  // Preserve the existing FCM dispatcher for the APK, but don't activate it
  // here: FCM stays governed by its independent provider capability/config.
  const fcmEnabled = isFcmConfigured() && fcmTokens.length > 0;
  if (!webPushEnabled && !fcmEnabled) {
    return {
      success: false,
      reason: vapidConfigured ? 'NO_SUBSCRIPTIONS' : 'WEB_PUSH_DISABLED',
      totalSent: 0,
      totalAttempted: 0,
    };
  }

  let webPushResult: { success: boolean; totalSent: number; totalAttempted: number } | null = null;
  let fcmResult: { success: boolean; totalSent: number; totalAttempted: number } | null = null;

  if (webPushEnabled) {
    const payloadString = JSON.stringify(payload);
    const ttl = options?.ttl ?? Math.ceil(computeRetryTtlMs(payload) / 1000);
    const urgency = options?.urgency ?? determineUrgency(payload);

    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        const pushSubscription = {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        };

        try {
          await sendWithRetry(pushSubscription, payloadString, { ttl, urgency });
          return { success: true, endpoint: sub.endpoint };
        } catch (error: any) {
          // Privacidad: nunca loguear el endpoint completo (contiene el token
          // de empuje). El id de suscripción basta para depurar.
          logger.error(`[PushService] Fallo definitivo al enviar push (suscripción ${sub.id})`, {
            statusCode: error.statusCode,
            title: payload.title,
            userId,
          });

          if (isExpiredSubscription(error)) {
            await prisma.pushSubscription.deleteMany({ where: { id: sub.id, userId, p256dh: sub.p256dh, auth: sub.auth } });
            logger.info(`[PushService] Suscripción expirada eliminada: ${sub.id}`);
          } else if (isTransientError(error) && !options?.skipRetryQueue) {
            await enqueueNotificationRetry(userId, payload, 'Fallo temporal de Web Push', sub.id);
          }

          throw error;
        }
      })
    );

    const successful = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;
    webPushResult = { success: successful > 0, totalSent: successful, totalAttempted: subscriptions.length };

    if (failed > 0) {
      logger.warn(`[PushService] WebPush: ${successful}/${subscriptions.length} exitosos, ${failed} fallidos — usuario ${userId}, título "${payload.title}"`);
    } else if (successful > 0) {
      logger.info(`[PushService] WebPush: ${successful}/${subscriptions.length} exitosos — usuario ${userId}, título "${payload.title}"`);
    }
  }

  if (fcmEnabled) {
    try {
      fcmResult = await sendFcmNotification(userId, payload);
    } catch (error: any) {
      logger.error(`[PushService] FCM falló por completo — usuario ${userId}, título "${payload.title}": ${error?.message || 'desconocido'}`);
      fcmResult = { success: false, totalSent: 0, totalAttempted: fcmTokens.length };
    }
  }

  const delivered = (webPushResult?.success || fcmResult?.success) || false;

  // RED DE SEGURIDAD: si ningún canal entregó y no venimos de la propia cola
  // de reintentos, encolamos el reenvío en diferido. Así un aviso crítico no
  // se pierde por un bajón momentáneo de FCM/web-push: el job lo reintenta.
  if (fcmEnabled && !webPushEnabled && !delivered && !options?.skipRetryQueue) {
    await enqueueNotificationRetry(userId, payload, 'Ningún canal entregó en el intento inicial').catch((err: any) => {
      logger.error(`[PushService] No se pudo encolar reenvío para usuario ${userId}: ${err?.message || err}`);
    });
  }

  return {
    success: delivered,
    totalSent: (webPushResult?.totalSent || 0) + (fcmResult?.totalSent || 0),
    totalAttempted: (webPushResult?.totalAttempted || 0) + (fcmResult?.totalAttempted || 0),
  };
};
