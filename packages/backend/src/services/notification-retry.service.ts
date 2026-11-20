import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import type { NotificationPayload } from './notification-types';
import { notificationRetryDedupeKey } from './notification-retry-key';

// TTL por tipo de evento: cuánto tiempo tiene sentido reintentar un aviso.
// Un pedido nuevo/repartidor llegó es urgente por horas; un chat, menos; y
// avisos genéricos caducan rápido para no molestar tarde.
const TTL_BY_EVENT: Record<string, number> = {
  'order:ready': 6 * 60 * 60 * 1000,
  'order:driver-arrived': 4 * 60 * 60 * 1000,
  'order:driver_arrived': 4 * 60 * 60 * 1000,
  'order:arrival-reminder': 4 * 60 * 60 * 1000,
  'order:in-transit': 4 * 60 * 60 * 1000,
  'order:delivered': 4 * 60 * 60 * 1000,
  'order:new': 6 * 60 * 60 * 1000,
  'order:assigned': 6 * 60 * 60 * 1000,
  'order:rejected': 6 * 60 * 60 * 1000,
  'new_chat_message': 2 * 60 * 60 * 1000,
  'order:eta-updated': 2 * 60 * 60 * 1000,
  'order:no-drivers': 3 * 60 * 60 * 1000,
};

const DEFAULT_TTL_MS = 3 * 60 * 60 * 1000; // 3h por defecto
export const MAX_RETRY_ATTEMPTS = 12;

/** Clave de dedupe: el mismo evento del mismo pedido no se encola dos veces. */
export function computeRetryTtlMs(payload: NotificationPayload): number {
  const event = typeof payload.data?.event === 'string' ? payload.data.event : '';
  const type = typeof payload.data?.type === 'string' ? payload.data.type : '';
  return TTL_BY_EVENT[event] ?? TTL_BY_EVENT[type] ?? DEFAULT_TTL_MS;
}

/**
 * Encola una notificación para reenvío en diferido. Usa upsert por clave de
 * dedupe para no acumular duplicados del mismo evento de un pedido; si ya
 * existe un intento pendiente para ese evento, no se duplica.
 */
export async function enqueueNotificationRetry(
  userId: string,
  payload: NotificationPayload,
  reason: string
): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + computeRetryTtlMs(payload));
    const key = notificationRetryDedupeKey(userId, payload);

    await prisma.notificationRetry.upsert({
      where: { dedupeKey: key ?? `uid-${userId}-${Date.now()}` },
      update: {
        userId,
        payload: JSON.stringify(payload),
        lastError: reason,
        expiresAt,
      },
      create: {
        userId,
        dedupeKey: key,
        payload: JSON.stringify(payload),
        lastError: reason,
        expiresAt,
        maxAttempts: MAX_RETRY_ATTEMPTS,
      },
    });
    logger.info(`[NotificationRetry] Encolado reenvío para usuario ${userId}${key ? ` (${key})` : ''}: ${reason}`);
  } catch (error: any) {
    logger.error('[NotificationRetry] Error al encolar reenvío:', error?.message);
  }
}
