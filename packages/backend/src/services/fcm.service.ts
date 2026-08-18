import fs from 'fs';
import { cert, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { getMessaging, type BaseMessage, type Message } from 'firebase-admin/messaging';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import type { NotificationPayload } from './notification.service';

let fcmConfigured = false;
let messagingInstance: ReturnType<typeof getMessaging> | null = null;

type ServiceAccountInput = {
  projectId?: string;
  clientEmail?: string;
  privateKey?: string;
};

/**
 * Inicializa firebase-admin usando una de estas fuentes (en orden):
 *  1. FIREBASE_SERVICE_ACCOUNT_PATH: ruta a un JSON de service account (dev local).
 *  2. FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY (Railway).
 *  3. GOOGLE_APPLICATION_CREDENTIALS (estándar de Google, path al JSON).
 * Si no hay ninguna, FCM queda desactivado (no-op) sin romper el envío web-push.
 */
function initFcm(): void {
  try {
    const serviceAccountPath =
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;

    if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
      const parsed = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
      initializeApp({ credential: cert(parsed as ServiceAccount) });
      fcmConfigured = true;
      messagingInstance = getMessaging();
      logger.info(`[FcmService] Configurado desde archivo: ${serviceAccountPath}`);
      return;
    }

    const envInput: ServiceAccountInput = {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY,
    };

    if (envInput.projectId && envInput.clientEmail && envInput.privateKey) {
      initializeApp({
        credential: cert({
          projectId: envInput.projectId,
          clientEmail: envInput.clientEmail,
          privateKey: envInput.privateKey.replace(/\\n/g, '\n'),
        } as ServiceAccount),
      });
      fcmConfigured = true;
      messagingInstance = getMessaging();
      logger.info('[FcmService] Configurado desde variables de entorno');
      return;
    }

    fcmConfigured = false;
    logger.error(
      '[FcmService] FCM no configurado — la app nativa no recibirá notificaciones. Agrega FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL y FIREBASE_PRIVATE_KEY (o FIREBASE_SERVICE_ACCOUNT_PATH).'
    );
  } catch (error: any) {
    fcmConfigured = false;
    logger.error('[FcmService] Error al configurar firebase-admin:', error?.message);
  }
}

initFcm();

export function isFcmConfigured(): boolean {
  return fcmConfigured;
}

/**
 * Mapea un canal de sonido (path del .wav en la web) al channelId nativo Android.
 * En la app nativa cada canal está registrado con su propio sonido en res/raw/.
 */
export function mapSoundToChannelId(sound?: string): string | undefined {
  if (!sound) return undefined;
  if (sound.includes('notifica')) return 'notifica';
  if (sound.includes('llegue')) return 'llegue';
  if (sound.includes('rezagado')) return 'rezagado';
  if (sound.includes('mensaje')) return 'mensaje';
  return undefined;
}

/**
 * Convierte un NotificationPayload (web-push) a un mensaje FCM.
 * - title/body → notification del sistema.
 * - sound → channelId (canal nativo con el .wav empaquetado).
 * - vibrate → patrón de vibración.
 * - requireInteraction → sticky (requiere interacción para cerrar).
 * - data → data (para deep-link al pedido al tocar).
 * - prioridad alta siempre (anti-Doze; la importancia de sonido la define el canal).
 */
export function buildFcmMessage(payload: NotificationPayload): BaseMessage {
  const channelId = mapSoundToChannelId(payload.sound);

  const message: BaseMessage = {
    notification: {
      title: payload.title,
      body: payload.body,
    },
    android: {
      priority: 'high',
      notification: {
        channelId: channelId || 'default',
        ...(payload.vibrate ? { vibrateTimingsMillis: payload.vibrate } : {}),
        sticky: payload.requireInteraction ?? true,
        ...(payload.icon ? { icon: 'ic_stat_sadel' } : {}),
      },
    },
    data: {
      ...(payload.data ? stringifyData(payload.data) : {}),
      click_action: 'OPEN_ORDER',
    },
  };

  return message;
}

function stringifyData(data: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    out[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  return out;
}

/**
 * Envía una notificación FCM a todos los tokens del usuario.
 * Los tokens inválidos (UNREGISTERED / INVALID_ARGUMENT) se eliminan.
 * Nunca lanza: los errores se loguean para no interrumpir el flujo web-push.
 */
export async function sendFcmNotification(
  userId: string,
  payload: NotificationPayload
): Promise<{ success: boolean; totalSent: number; totalAttempted: number }> {
  if (!fcmConfigured) {
    return { success: false, totalSent: 0, totalAttempted: 0 };
  }

  const tokens = await prisma.fcmToken.findMany({
    where: { userId },
    select: { id: true, token: true },
  });

  if (tokens.length === 0) {
    return { success: false, totalSent: 0, totalAttempted: 0 };
  }

  const message = buildFcmMessage(payload);
  let sent = 0;

  const results = await Promise.allSettled(
    tokens.map(async (t) => {
      const msg = { ...message, token: t.token } as Message;
      await messagingInstance!.send(msg);
      sent += 1;
    })
  );

  results.forEach((result, index) => {
    const tokenId = tokens[index].id;
    if (result.status === 'rejected') {
      const error: any = result.reason;
      const code = error?.errorInfo?.code || error?.code || '';
      logger.error(
        `[FcmService] Error enviando a token ${tokens[index].token.slice(0, 12)}… (${code}): ${error?.message || 'desconocido'}`
      );
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-argument') {
        prisma.fcmToken
          .delete({ where: { id: tokenId } })
          .then(() => logger.info(`[FcmService] Token FCM inválido eliminado: ${tokenId}`))
          .catch(() => undefined);
      }
    }
  });

  const totalAttempted = tokens.length;
  return { success: sent > 0, totalSent: sent, totalAttempted };
}

/**
 * Prueba un token FCM con un mensaje silencioso. Retorna `false` si el token
 * ya no está registrado (equivalente al 410/404 del web-push). Se usa en el
 * job de limpieza para eliminar tokens de dispositivos abandonados.
 */
export async function probeFcmToken(token: string): Promise<boolean> {
  if (!fcmConfigured) return true; // no concluyente: no borrar si FCM no está
  try {
    await messagingInstance!.send({
      token,
      android: { priority: 'high' },
      data: { probe: 'true' },
    });
    return true;
  } catch (error: any) {
    const code = error?.errorInfo?.code || error?.code || '';
    if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-argument') {
      return false;
    }
    return true; // error no concluyente (rate limit, red, etc.): conservar
  }
}