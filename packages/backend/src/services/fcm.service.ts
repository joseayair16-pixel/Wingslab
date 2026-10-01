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
 * Versión mínima del APK (versionCode nativo) que soporta la alarma continua
 * por Foreground Service. Los tokens de versiones anteriores siguen recibiendo
 * la notificación normal (retrocompatible).
 */
export const RING_MIN_APP_VERSION = 2;

/** ¿El token pertenece a una app capaz de alarma continua? */
export function isRingCapableAppVersion(appVersion?: number | null): boolean {
  return typeof appVersion === 'number' && Number.isFinite(appVersion) && appVersion >= RING_MIN_APP_VERSION;
}

/**
 * ¿Este payload es una alarma de pedido (nuevo pedido / asignación) que debe
 * usar la alarma continua en el dispositivo nativo? Se marca explícitamente con
 * `nativeRing`, y además se detecta por convención de `tag` como red de
 * seguridad para no depender de que cada sitio de envío lo recuerde. Un
 * `nativeRing: false` explícito manda sobre la convención (p. ej. pedidos que
 * esperan en cola y aún no tienen la ventana de decisión corriendo).
 */
export function isRingPayload(payload: NotificationPayload): boolean {
  if (payload.nativeRing === true) return true;
  if (payload.nativeRing === false) return false;
  const tag = typeof payload.tag === 'string' ? payload.tag : '';
  return tag.startsWith('new-order-') || tag.startsWith('order-assigned-');
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
 * Deriva el sonido del evento cuando el payload no trae `sound`. Muchos pushes
 * al comensal no especifican sonido (la web lo reproduce por socket.io), pero
 * la app nativa necesita el channelId correcto para sonar aunque esté cerrada.
 */
function inferSoundFromEvent(payload: NotificationPayload): string | undefined {
  const event = typeof payload.data?.event === 'string' ? payload.data.event : '';
  const type = typeof payload.data?.type === 'string' ? payload.data.type : '';
  if (type === 'new_chat_message') return '/sounds/mensaje.wav';
  if (event === 'order:rezagado') return '/sounds/rezagado.wav';
  if (event === 'order:cancellation-approved' || event === 'order:cancellation-rejected' || event === 'order:rejected') {
    return '/sounds/mensaje.wav';
  }
  if (
    event.startsWith('order:') ||
    event.startsWith('order_chat:') ||
    event === 'restaurant:order_ready'
  ) {
    return '/sounds/llegue.wav';
  }
  return undefined;
}

/**
 * Convierte un NotificationPayload (web-push) a un mensaje FCM normal, con el
 * bloque `notification` del sistema.
 * - title/body → notification del sistema.
 * - sound → channelId (canal nativo con el .wav empaquetado).
 * - vibrate → patrón de vibración.
 * - requireInteraction → sticky (requiere interacción para cerrar).
 * - data → data (para deep-link al pedido al tocar).
 * - prioridad alta siempre (anti-Doze; la importancia de sonido la define el canal).
 *
 * NUNCA se usa para la alarma continua: el mensaje de alarma debe ser
 * data-only y decidir por token (capability del APK), y eso lo hace
 * `sendFcmNotification`, que llama a `buildRingDataMessage` solo para los
 * tokens con appVersion >= RING_MIN_APP_VERSION.
 */
export function buildFcmMessage(payload: NotificationPayload): BaseMessage {
  const effectiveSound = payload.sound || inferSoundFromEvent(payload);
  const channelId = mapSoundToChannelId(effectiveSound) || 'default';

  const message: BaseMessage = {
    notification: {
      title: payload.title,
      body: payload.body,
    },
    android: {
      priority: 'high',
      notification: {
        channelId,
        ...(payload.vibrate ? { vibrateTimingsMillis: payload.vibrate } : {}),
        sticky: payload.requireInteraction ?? true,
        icon: 'ic_stat_sadel',
      },
    },
    data: {
      ...(payload.data ? stringifyData(payload.data) : {}),
      click_action: 'OPEN_ORDER',
    },
  };

  return message;
}

/**
 * Construye un data-message (sin bloque `notification`) para que la app nativa
 * inicie la alarma continua. El sistema NO muestra nada por sí solo: es la app
 * (OrderAlarmService) la que muestra una única notificación y reproduce el
 * sonido en bucle. Llega incluso con la app cerrada porque se envía con
 * prioridad alta.
 */
export function buildRingDataMessage(payload: NotificationPayload): BaseMessage {
  const effectiveSound = payload.sound || inferSoundFromEvent(payload) || '/sounds/notifica.wav';
  const rawSound = mapSoundToChannelId(effectiveSound) || 'notifica';

  return {
    android: { priority: 'high' },
    data: {
      ...(payload.data ? stringifyData(payload.data) : {}),
      type: 'order-ring-start',
      title: payload.title,
      body: payload.body,
      sound: rawSound,
      expiresAt: String(payload.nativeRingExpiresAt && payload.nativeRingExpiresAt > 0 ? payload.nativeRingExpiresAt : 0),
      click_action: 'OPEN_ORDER',
    },
  };
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
 * Errores transitorios de FCM que merecen reintento con backoff:
 *  - rate-limit (429 / messaging/rate-exceeded)
 *  - servidor ocupado / caída temporal (5xx / messaging/server-unavailable / messaging/internal-error)
 *  - errores de red / timeout
 */
function isTransientFcmError(error: any): boolean {
  if (!error) return false;
  const code = error?.errorInfo?.code || error?.code || '';
  if (code === 'messaging/server-unavailable' || code === 'messaging/internal-error' || code === 'messaging/rate-exceeded') {
    return true;
  }
  const status = error?.status || error?.statusCode;
  if (typeof status === 'number') {
    if (status === 429 || status === 500 || status === 503) return true;
  }
  const message = String(error?.message || error?.errorInfo?.message || '');
  return /network|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up/i.test(message);
}

/** Backoff exponencial con jitter (evita thundering herd entre miles de tokens). */
function delayWithBackoff(attempt: number): Promise<void> {
  const baseMs = 1000;
  const jitter = Math.random() * 500;
  const delay = Math.min(baseMs * Math.pow(2, attempt - 1) + jitter, 10000);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

const FCM_MAX_ATTEMPTS = 3;

/**
 * Envía una notificación FCM a todos los tokens del usuario con reintentos
 * robustos (backoff exponencial + jitter) ante errores transitorios de FCM
 * (rate-limit, sobrecarga, red). Los tokens inválidos (UNREGISTERED /
 * INVALID_ARGUMENT) se eliminan sin reintentar: re-intentarlos no tiene sentido.
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
    select: { id: true, token: true, appVersion: true },
  });

  if (tokens.length === 0) {
    return { success: false, totalSent: 0, totalAttempted: 0 };
  }

  // Mensaje normal (notificación del sistema) para dispositivos no compatibles
  // o para avisos que no son alarma.
  const normalMessage = buildFcmMessage(payload);
  // Data-message de alarma continua para dispositivos compatibles.
  const ringMessage = isRingPayload(payload) ? buildRingDataMessage(payload) : null;
  let sent = 0;

  const results = await Promise.allSettled(
    tokens.map(async (t) => {
      const base =
        ringMessage && isRingCapableAppVersion(t.appVersion) ? ringMessage : normalMessage;
      const msg = { ...base, token: t.token } as Message;
      let lastError: any = null;

      for (let attempt = 1; attempt <= FCM_MAX_ATTEMPTS; attempt++) {
        try {
          await messagingInstance!.send(msg);
          sent += 1;
          return { ok: true as const, tokenId: t.id };
        } catch (error: any) {
          lastError = error;
          const code = error?.errorInfo?.code || error?.code || '';
          // Token muerto: no tiene sentido reintentar; se elimina.
          if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-argument') {
            return { ok: false as const, tokenId: t.id, fatal: true as const, code, message: error?.message };
          }
          // Error transitorio: reintentar con backoff.
          if (isTransientFcmError(error) && attempt < FCM_MAX_ATTEMPTS) {
            await delayWithBackoff(attempt);
            continue;
          }
          // Error definitivo no transitorio: fallar este token sin más.
          return { ok: false as const, tokenId: t.id, fatal: false as const, code, message: error?.message };
        }
      }
      return { ok: false as const, tokenId: t.id, fatal: false as const, code: lastError?.errorInfo?.code || lastError?.code || '', message: lastError?.message };
    })
  );

  for (let i = 0; i < results.length; i++) {
    const tokenRow = tokens[i];
    const result = results[i];

    if (result.status === 'rejected') {
      logger.error(`[FcmService] Fallo definitivo al enviar a token ${tokenRow.token.slice(0, 12)}… (${result.reason?.message || 'desconocido'})`);
      continue;
    }

    const r = result.value;
    if (r.fatal) {
      prisma.fcmToken
        .delete({ where: { id: r.tokenId } })
        .then(() => logger.info(`[FcmService] Token FCM inválido eliminado: ${r.tokenId}`))
        .catch(() => undefined);
    } else {
      logger.warn(
        `[FcmService] Error enviando a token ${tokenRow.token.slice(0, 12)}… (${r.code || 'unknown'}): ${r.message || 'desconocido'}`
      );
    }
  }

  const totalAttempted = tokens.length;
  return { success: sent > 0, totalSent: sent, totalAttempted };
}

/**
 * Envía un data-message (sin bloque `notification`) a todos los tokens del
 * usuario. Se usa para iniciar/detener la alarma continua nativa. Solo se envía
 * a dispositivos capaces (appVersion >= RING_MIN_APP_VERSION), de modo que los
 * APKs antiguos no reciben data-messages que no sabrían interpretar.
 * Los tokens muertos se eliminan. Nunca lanza.
 */
export async function sendFcmDataMessage(
  userId: string,
  data: Record<string, string>,
  options: { minAppVersion?: number } = {}
): Promise<{ success: boolean; totalSent: number; totalAttempted: number }> {
  if (!fcmConfigured) {
    return { success: false, totalSent: 0, totalAttempted: 0 };
  }

  const minVersion = options.minAppVersion ?? RING_MIN_APP_VERSION;
  const tokens = await prisma.fcmToken.findMany({
    where: { userId },
    select: { id: true, token: true, appVersion: true },
  });

  const capableTokens = tokens.filter((t) => {
    const version = t.appVersion;
    if (typeof version !== 'number' || !Number.isFinite(version)) return false;
    return version >= Math.max(RING_MIN_APP_VERSION, minVersion);
  });
  if (capableTokens.length === 0) {
    return { success: false, totalSent: 0, totalAttempted: 0 };
  }

  let sent = 0;
  await Promise.allSettled(
    capableTokens.map(async (t) => {
      try {
        await messagingInstance!.send({
          token: t.token,
          android: { priority: 'high' },
          data,
        });
        sent += 1;
      } catch (error: any) {
        const code = error?.errorInfo?.code || error?.code || '';
        if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-argument') {
          prisma.fcmToken
            .delete({ where: { id: t.id } })
            .then(() => logger.info(`[FcmService] Token FCM inválido eliminado: ${t.id}`))
            .catch(() => undefined);
        } else {
          logger.warn(
            `[FcmService] Error enviando data-message a token ${t.token.slice(0, 12)}… (${code || 'unknown'}): ${error?.message || 'desconocido'}`
          );
        }
      }
    })
  );

  return { success: sent > 0, totalSent: sent, totalAttempted: capableTokens.length };
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