/**
 * Captura TEMPORAL de mensajes entrantes de WhatsApp.
 *
 * Objetivo operativo: poder recuperar, durante una ventana de pocos minutos, un
 * código de verificación que una persona envió por WhatsApp al número de
 * negocio. NO es una bandeja de entrada ni un producto: es un puerto de
 * emergencia, reversible y apagado por defecto.
 *
 * Garantías de diseño:
 * - Apagada por defecto (`WHATSAPP_CAPTURE_ENABLED`). Requiere tres variables.
 * - Solo captura mensajes de TEXTO dirigidos al `phone_number_id` autorizado.
 * - Cifra con una clave DEDICADA, independiente de JWT_SECRET y de
 *   DATABASE_ENCRYPTION_KEY (si coincide con cualquiera de ellas se rechaza).
 * - El contenido vive cifrado en Redis con TTL corto y cupo acotado.
 * - Nunca escribe contenido, códigos, números completos ni secretos en logs.
 * - No toca PostgreSQL ni el esquema de la base de datos.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type Redis from 'ioredis';

import { getRedis } from '../config/redis';
import { logger } from '../utils/logger';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

/** Tope duro de vigencia de una captura: 10 minutos. */
export const CAPTURE_MAX_TTL_SECONDS = 600;
/** Tope duro de mensajes retenidos simultáneamente. */
export const CAPTURE_MAX_MESSAGES_LIMIT = 50;

const DEFAULT_TTL_SECONDS = 600;
const DEFAULT_MAX_MESSAGES = 10;

/** Longitud mínima de la clave dedicada (evita claves triviales o de ejemplo). */
const MIN_KEY_LENGTH = 16;

/**
 * Presupuesto máximo para escribir en Redis. Si Redis está lento o caído, la
 * captura se abandona: el webhook debe responderle a Meta sin delays.
 */
const CAPTURE_WRITE_TIMEOUT_MS = 1500;

const CAPTURE_MESSAGE_KEY_PREFIX = 'whatsapp:capture:msg:';
const CAPTURE_INDEX_KEY = 'whatsapp:capture:index';

export type WhatsAppCaptureReason =
  | 'enabled'
  | 'disabled_by_flag'
  | 'missing_phone_number_id'
  | 'missing_encryption_key'
  | 'weak_encryption_key'
  | 'reused_credential';

export type WhatsAppCaptureStatus = {
  /** Estado efectivo: solo `true` si se cumple TODAS las condiciones. */
  enabled: boolean;
  /** Motivo por el que la captura está activa o desactivada. */
  reason: WhatsAppCaptureReason;
  /** Vigencia aplicada a cada mensaje capturado (segundos). */
  ttlSeconds: number;
  /** Cupo máximo de mensajes retenidos. */
  maxMessages: number;
};

/** Campos mínimos que se conservan de un mensaje entrante. */
export type CapturedWhatsAppMessage = {
  /** Identificador corto (hash del id de Meta) para referenciar el mensaje. */
  id: string;
  /** Número del remitente tal como lo entrega Meta. */
  from: string;
  /** Texto recibido. */
  body: string;
  /** Timestamp informado por Meta. */
  timestamp: string | null;
  /** Momento de recepción en el backend (ISO). */
  receivedAt: string;
};

export type CaptureResult = {
  captured: boolean;
  reason: string;
};

function clampNumber(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

/**
 * Estado de la clave dedicada. Devuelve 'ok' o el motivo del rechazo.
 * Nunca devuelve ni registra el valor de la clave.
 */
function checkCaptureKey(): 'ok' | WhatsAppCaptureReason {
  const raw = (process.env.WHATSAPP_CAPTURE_ENCRYPTION_KEY || '').trim();
  if (!raw) return 'missing_encryption_key';
  if (raw.length < MIN_KEY_LENGTH) return 'weak_encryption_key';
  // La clave debe ser material independiente: reutilizar una credencial existente
  // ampliaría el radio de impacto de una filtración y se rechaza en silencio.
  if (raw === (process.env.DATABASE_ENCRYPTION_KEY || '').trim()) return 'reused_credential';
  if (raw === (process.env.JWT_SECRET || '').trim()) return 'reused_credential';
  return 'ok';
}

function readCaptureKey(): string | null {
  const status = checkCaptureKey();
  if (status !== 'ok') return null;
  return (process.env.WHATSAPP_CAPTURE_ENCRYPTION_KEY || '').trim();
}

/**
 * Resuelve el estado efectivo de la captura. Se lee en cada llamada (no al
 * cargar el módulo) para que el interruptor por variable de entorno sea
 * inmediato y verificable sin recompilar.
 */
export function resolveWhatsAppCaptureStatus(): WhatsAppCaptureStatus {
  const flag = (process.env.WHATSAPP_CAPTURE_ENABLED || '').trim().toLowerCase();
  const phoneNumberId = (process.env.WHATSAPP_CAPTURE_PHONE_NUMBER_ID || '').trim();
  const ttlSeconds = clampNumber(
    process.env.WHATSAPP_CAPTURE_TTL_SECONDS,
    DEFAULT_TTL_SECONDS,
    1,
    CAPTURE_MAX_TTL_SECONDS
  );
  const maxMessages = clampNumber(
    process.env.WHATSAPP_CAPTURE_MAX_MESSAGES,
    DEFAULT_MAX_MESSAGES,
    1,
    CAPTURE_MAX_MESSAGES_LIMIT
  );

  if (flag !== 'true') {
    return { enabled: false, reason: 'disabled_by_flag', ttlSeconds, maxMessages };
  }
  if (!phoneNumberId) {
    return { enabled: false, reason: 'missing_phone_number_id', ttlSeconds, maxMessages };
  }
  const keyStatus = checkCaptureKey();
  if (keyStatus !== 'ok') {
    return { enabled: false, reason: keyStatus, ttlSeconds, maxMessages };
  }
  return { enabled: true, reason: 'enabled', ttlSeconds, maxMessages };
}

/** ¿Está la captura activa y correctamente configurada? */
export function isWhatsAppCaptureEnabled(): boolean {
  return resolveWhatsAppCaptureStatus().enabled;
}

/** Configuración efectiva (sin exponer credenciales). */
export function getWhatsAppCaptureConfig(): WhatsAppCaptureStatus {
  return resolveWhatsAppCaptureStatus();
}

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

/** Cifra con AES-256-GCM. Formato: iv:authTag:datos (hex). */
function encryptPayload(plain: string, secret: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, deriveKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted.toString('hex')}`;
}

/** Descifra un payload capturado. Devuelve null si la clave no autentica. */
function decryptPayload(payload: string, secret: string): string | null {
  const parts = payload.split(':');
  if (parts.length !== 3) return null;

  const [ivHex, tagHex, dataHex] = parts;
  if (!/^[a-f0-9]{24}$/i.test(ivHex)) return null;
  if (!/^[a-f0-9]{32}$/i.test(tagHex)) return null;

  try {
    const decipher = createDecipheriv(ALGORITHM, deriveKey(secret), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(dataHex, 'hex'), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * Corre una operación con presupuesto de tiempo. Si se agota, devuelve null y
 * la operación original sigue su curso en segundo plano (sin rejections sin
 * manejar). Evita que un Redis lento retrase la respuesta del webhook a Meta.
 */
async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  const expiry = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
  });

  // La promesa original nunca debe quedar con un rejection sin capturar.
  operation.catch(() => undefined);

  try {
    return await Promise.race([operation, expiry]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Identificador estable de la captura. Se deriva del id de mensaje de Meta
 * (estable entre reintentos) y, si Meta no lo envía, de una huella del
 * contenido. Nunca se guarda el id original en claro.
 */
export function buildCaptureEntryId(metaMessageId: string | null, fallbackSeed: string): string {
  const seed = metaMessageId && metaMessageId.trim() ? metaMessageId.trim() : fallbackSeed;
  return createHash('sha256').update(seed).digest('hex');
}

/** Clave Redis donde vive un mensaje capturado (cifrado). */
export function buildCaptureMessageKey(entryId: string): string {
  return `${CAPTURE_MESSAGE_KEY_PREFIX}${entryId}`;
}

/** Descarta los mensajes más antiguos cuando se supera el cupo. */
async function trimIndex(redis: Redis, maxMessages: number): Promise<void> {
  const count = await redis.zcard(CAPTURE_INDEX_KEY);
  if (count <= maxMessages) return;

  const overflow = count - maxMessages;
  const oldest = await redis.zrange(CAPTURE_INDEX_KEY, 0, overflow - 1);
  if (oldest.length === 0) return;

  await redis.zrem(CAPTURE_INDEX_KEY, ...oldest);
  await redis.del(...oldest.map((entryId) => buildCaptureMessageKey(entryId)));
}

/**
 * Captura un mensaje entrante de texto.
 *
 * - Ignora si la captura está desactivada o mal configurada.
 * - Ignora si el `phone_number_id` no es el autorizado (no se capturan mensajes
 *   destinados a otros números conectados a la misma WABA).
 * - Ignora cuerpos vacíos y mensajes no textuales.
 * - Es idempotente: un reintento de Meta con el mismo id no duplica la entrada.
 */
export async function captureIncomingTextMessage(params: {
  metaMessageId: string | null;
  phoneNumberId: string;
  from: string;
  body: string;
  timestamp: string | null;
}): Promise<CaptureResult> {
  const status = resolveWhatsAppCaptureStatus();
  if (!status.enabled) {
    return { captured: false, reason: status.reason };
  }

  const allowedPhoneNumberId = (process.env.WHATSAPP_CAPTURE_PHONE_NUMBER_ID || '').trim();
  if (!allowedPhoneNumberId || params.phoneNumberId !== allowedPhoneNumberId) {
    return { captured: false, reason: 'phone_number_not_allowed' };
  }

  const body = typeof params.body === 'string' ? params.body : '';
  if (!body.trim()) {
    return { captured: false, reason: 'empty_body' };
  }

  const secret = readCaptureKey();
  if (!secret) {
    return { captured: false, reason: 'missing_encryption_key' };
  }

  const fallbackSeed = `${params.from}|${params.timestamp ?? ''}|${body}`;
  const entryId = buildCaptureEntryId(params.metaMessageId, fallbackSeed);
  const messageKey = buildCaptureMessageKey(entryId);

  const payload: CapturedWhatsAppMessage = {
    id: entryId.slice(0, 16),
    from: params.from,
    body,
    timestamp: params.timestamp,
    receivedAt: new Date().toISOString(),
  };

  const result = await withTimeout(
    storeCapturedMessage({ entryId, messageKey, payload: JSON.stringify(payload), secret, status }),
    CAPTURE_WRITE_TIMEOUT_MS
  );

  if (result === null) {
    // Redis no respondió a tiempo: se abandona la captura, no el webhook.
    logger.warn('[WhatsApp Capture] Tiempo agotado al guardar', { reason: 'timeout' });
    return { captured: false, reason: 'timeout' };
  }

  return result;
}

/** Escritura efectiva en Redis (cifrado + índice + cupo). */
async function storeCapturedMessage(params: {
  entryId: string;
  messageKey: string;
  payload: string;
  secret: string;
  status: WhatsAppCaptureStatus;
}): Promise<CaptureResult> {
  const { entryId, messageKey, payload, secret, status } = params;

  try {
    const redis = getRedis();

    // Idempotencia: la clave existe → Meta ya nos entregó este mensaje.
    if ((await redis.exists(messageKey)) > 0) {
      return { captured: false, reason: 'duplicate' };
    }

    // NX evita la carrera entre dos entregas simultáneas del mismo mensaje.
    const stored = (await redis.set(
      messageKey,
      encryptPayload(payload, secret),
      'EX',
      status.ttlSeconds,
      'NX'
    )) as 'OK' | null;
    if (stored !== 'OK') {
      return { captured: false, reason: 'duplicate' };
    }

    await redis.zadd(CAPTURE_INDEX_KEY, Date.now(), entryId);
    await redis.expire(CAPTURE_INDEX_KEY, status.ttlSeconds);
    await trimIndex(redis, status.maxMessages);

    return { captured: true, reason: 'stored' };
  } catch {
    // Nunca propagar el error al webhook: la entrega a Meta debe seguir
    // respondiendo 200. El detalle se omite a propósito (podría incluir argumentos).
    logger.warn('[WhatsApp Capture] No se pudo guardar el mensaje capturado', {
      reason: 'storage_error',
    });
    return { captured: false, reason: 'storage_error' };
  }
}

/**
 * Lee los identificadores del índice en orden ascendente (más antiguo primero).
 *
 * El rango se calcula con ZCARD en lugar de usar `0 -1`: el rango inclusivo
 * explícito se comporta igual en Redis real y en el doble en memoria usado por
 * las pruebas, y además acota la lectura al tamaño real del índice.
 */
async function readIndexEntries(redis: Redis): Promise<string[]> {
  const total = await redis.zcard(CAPTURE_INDEX_KEY);
  if (total === 0) return [];
  return redis.zrange(CAPTURE_INDEX_KEY, 0, total - 1);
}

/**
 * Lista los mensajes capturados (más reciente primero). Los que ya expiraron se
 * omiten y se limpian del índice.
 */
export async function listCapturedMessages(): Promise<CapturedWhatsAppMessage[]> {
  const status = resolveWhatsAppCaptureStatus();
  if (!status.enabled) return [];

  const secret = readCaptureKey();
  if (!secret) return [];

  try {
    const redis = getRedis();
    const entryIds = await readIndexEntries(redis);
    if (entryIds.length === 0) return [];

    const rawValues = await redis.mget(...entryIds.map((entryId) => buildCaptureMessageKey(entryId)));

    const messages: CapturedWhatsAppMessage[] = [];
    const stale: string[] = [];

    entryIds.forEach((entryId, index) => {
      const raw = rawValues[index];
      if (!raw) {
        stale.push(entryId);
        return;
      }
      const decrypted = decryptPayload(raw, secret);
      if (!decrypted) {
        stale.push(entryId);
        return;
      }
      try {
        const parsed = JSON.parse(decrypted) as CapturedWhatsAppMessage;
        if (parsed && typeof parsed.body === 'string') {
          messages.push(parsed);
        } else {
          stale.push(entryId);
        }
      } catch {
        stale.push(entryId);
      }
    });

    if (stale.length > 0) {
      try {
        await redis.zrem(CAPTURE_INDEX_KEY, ...stale);
      } catch {
        // Limpieza best-effort: si falla, la siguiente lectura lo reintenta.
      }
    }

    // zrange devuelve ascendente (más antiguo primero); lo invertimos.
    return messages.reverse();
  } catch {
    logger.warn('[WhatsApp Capture] No se pudo leer la captura', { reason: 'read_error' });
    return [];
  }
}

/** Borra todos los mensajes capturados. Devuelve cuántos se eliminaron. */
export async function clearCapturedMessages(): Promise<number> {
  try {
    const redis = getRedis();
    const entryIds = await readIndexEntries(redis);
    if (entryIds.length > 0) {
      await redis.del(...entryIds.map((entryId) => buildCaptureMessageKey(entryId)));
      await redis.zrem(CAPTURE_INDEX_KEY, ...entryIds);
    }
    await redis.del(CAPTURE_INDEX_KEY);
    return entryIds.length;
  } catch {
    logger.warn('[WhatsApp Capture] No se pudo limpiar la captura', { reason: 'clear_error' });
    return 0;
  }
}
