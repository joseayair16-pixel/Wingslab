/**
 * Observabilidad de la captura temporal de WhatsApp (Fase 1 — diagnóstico).
 *
 * Objetivo: permitir distinguir, a partir de los logs, un mensaje CAPTURADO de
 * uno DESCARTADO, y conocer el motivo exacto del descarte. Es puramente
 * observacional: no altera en ningún momento lo que la captura almacena.
 *
 * Reglas de privacidad aplicadas a todo lo que se registra:
 * - Nunca se registra el cuerpo del mensaje, un código de verificación, un
 *   teléfono en claro, un token, una clave ni el `phone_number_id` en claro.
 * - El remitente se registra como pseudónimo HMAC-SHA256 (clave de captura) o,
 *   si la captura está apagada, con una sal aleatoria por proceso. En ambos
 *   casos es irreversible por enumeración.
 * - El id de mensaje de Meta se registra como hash SHA-256 truncado, que es
 *   además el mismo prefijo que se guarda en el registro capturado: permite
 *   correlacionar log ↔ captura sin exponer el identificador original.
 * - `phone_number_id` solo se registra como booleano de coincidencia.
 */

import { createHmac, randomBytes } from 'node:crypto';

import { logger } from '../utils/logger';
import { buildCaptureEntryId, deriveCaptureHmacKey } from './whatsapp-capture.service';

/** Resultado del procesamiento de un mensaje entrante. */
export type CaptureDiagnosticResult = 'captured' | 'ignored' | 'error';

/** Estado del almacenamiento en Redis para ese mensaje. */
export type CaptureRedisStatus = 'ok' | 'error' | 'timeout' | 'not_attempted';

/** Línea estructurada de diagnóstico (sin datos sensibles). */
export type CaptureDiagnostic = {
  /** Tipo de mensaje declarado por Meta (text, button, interactive, image...). */
  type: string;
  /** Resultado del procesamiento. */
  result: CaptureDiagnosticResult;
  /** Motivo exacto (vocabulario cerrado, ver REDIS_STATUS_BY_REASON). */
  reason: string;
  /** ¿El phone_number_id del evento coincide con el autorizado? null si se desconoce. */
  phoneNumberIdMatch: boolean | null;
  /** Estado de Redis para este mensaje. */
  redis: CaptureRedisStatus;
  /** Hash truncado del id de mensaje de Meta (prefijo del registro capturado). */
  messageIdHash: string | null;
  /** Pseudónimo HMAC del remitente. */
  senderHash: string | null;
  errorCode?: 131051 | 131060 | 'missing' | 'other';
  unsupportedType?: string;
};

const UNSUPPORTED_TYPES = new Set([
  'button', 'edit', 'errors', 'gif', 'group_invite', 'hsm', 'image',
  'interactive', 'keep_in_chat', 'link_preview', 'list', 'location',
  'media_placeholder', 'order', 'pin', 'poll_creation', 'poll_update',
  'product', 'reaction',
]);

/** Solo valores de catálogo; nunca propagar texto libre del payload al log. */
export function unsupportedDiagnostic(errors: unknown, unsupported: unknown): {
  errorCode: 131051 | 131060 | 'missing' | 'other';
  unsupportedType: string;
} {
  const first = Array.isArray(errors) ? errors[0] : undefined;
  const code: unknown = first && typeof first === 'object' ? (first as { code?: unknown }).code : undefined;
  const errorCode = code == null
    ? (errors == null || (Array.isArray(errors) && errors.length === 0) || (first && typeof first === 'object') ? 'missing' : 'other')
    : code === 131051 || code === 131060 ? code : 'other';
  const subtype: unknown = unsupported && typeof unsupported === 'object'
    ? (unsupported as { type?: unknown }).type : undefined;
  const unsupportedType = subtype == null
    ? (unsupported == null || typeof unsupported === 'object' ? 'missing' : 'other')
    : typeof subtype === 'string' && UNSUPPORTED_TYPES.has(subtype) ? subtype : 'other';
  return { errorCode, unsupportedType };
}

/**
 * Tope de líneas de diagnóstico por evento. Evita que un remitente que insista
 * con muchos mensajes multimedia inunde los logs; el resumen del evento
 * conserva los conteos exactos.
 */
export const MAX_DIAGNOSTIC_LOGS_PER_EVENT = 25;

/**
 * Sal aleatoria por proceso. Solo se usa cuando la captura está apagada y no
 * hay clave dedicada disponible: permite distinguir remitentes dentro del
 * proceso, pero no es estable entre reinicios.
 */
const PROCESS_SALT = randomBytes(32);

/** Longitud máxima del tipo de mensaje registrado: evita logs inflados. */
const MAX_TYPE_LENGTH = 32;

/**
 * Clave para el HMAC del remitente. Derivada de la clave de captura con
 * separación de dominio; la clave en crudo nunca sale del módulo de servicio.
 */
function senderHashKey(): Buffer {
  return deriveCaptureHmacKey('sender-hash-v1') ?? PROCESS_SALT;
}

/**
 * Normaliza el tipo de mensaje: valor acotado y sin caracteres de control,
 * para que la línea de log sea siempre una entrada JSON limpia.
 */
export function normalizeMessageType(type: string | undefined | null): string {
  const value = (type || '').trim().replace(/[^\w.-]/g, '');
  if (!value) return 'unknown';
  return value.slice(0, MAX_TYPE_LENGTH);
}

/**
 * Pseudónimo estable del remitente. Usa el BSUID (`from_user_id`) cuando Meta
 * lo provee, por ser el identificador que Meta recomienda (el teléfono puede no
 * estar disponible si el usuario adoptó un username).
 */
export function hashSender(senderKey: string | undefined | null): string | null {
  const value = (senderKey || '').trim();
  if (!value) return null;
  return createHmac('sha256', senderHashKey()).update(value).digest('hex').slice(0, 12);
}

/**
 * Hash del id de mensaje de Meta. Coincide con el `id` del registro capturado
 * (`entryId.slice(0, 16)`), de modo que el log permite localizar el mensaje en
 * la consulta administrativa sin revelar el identificador original.
 */
export function hashMetaMessageId(metaMessageId: string | undefined | null): string | null {
  const value = (metaMessageId || '').trim();
  if (!value) return null;
  return buildCaptureEntryId(value, '').slice(0, 16);
}

/** Relación entre el motivo devuelto por el servicio y el estado de Redis. */
const REDIS_STATUS_BY_REASON: Record<string, CaptureRedisStatus> = {
  stored: 'ok',
  storage_error: 'error',
  timeout: 'timeout',
};

/** Estado de Redis que corresponde al motivo informado por el servicio. */
export function redisStatusForReason(reason: string): CaptureRedisStatus {
  return REDIS_STATUS_BY_REASON[reason] ?? 'not_attempted';
}

/** Traduce el motivo del servicio al resultado de tres estados. */
export function resultForReason(reason: string): CaptureDiagnosticResult {
  if (reason === 'stored') return 'captured';
  if (reason === 'storage_error' || reason === 'timeout') return 'error';
  return 'ignored';
}

/**
 * Acumula los diagnósticos de un evento y emite las líneas estructuradas.
 *
 * Emite como máximo `MAX_DIAGNOSTIC_LOGS_PER_EVENT` líneas por mensaje y
 * siempre una línea de resumen con los conteos exactos, de modo que el volumen
 * de logs está acotado sin perder información agregada.
 */
export class CaptureDiagnosticRecorder {
  private emitted = 0;
  private suppressed = 0;
  private total = 0;
  private readonly byReason = new Map<string, number>();
  private readonly byResult = new Map<CaptureDiagnosticResult, number>();

  constructor(private readonly maxPerEvent: number = MAX_DIAGNOSTIC_LOGS_PER_EVENT) {}

  /** Registra un mensaje y emite su línea de diagnóstico (si no se alcanzó el tope). */
  record(diagnostic: CaptureDiagnostic): void {
    this.total += 1;
    this.byReason.set(diagnostic.reason, (this.byReason.get(diagnostic.reason) ?? 0) + 1);
    this.byResult.set(diagnostic.result, (this.byResult.get(diagnostic.result) ?? 0) + 1);

    if (this.emitted >= this.maxPerEvent) {
      this.suppressed += 1;
      return;
    }

    this.emitted += 1;
    logger.info('[WhatsApp Capture] Mensaje entrante', { ...diagnostic });
  }

  /** Número de mensajes registrados (con y sin línea emitida). */
  get count(): number {
    return this.total;
  }

  /** Líneas de diagnóstico emitidas para este evento. */
  get emittedCount(): number {
    return this.emitted;
  }

  /** Emite la línea de resumen del evento. */
  summarize(extra: Record<string, unknown> = {}): void {
    const byReason: Record<string, number> = {};
    for (const [reason, count] of this.byReason) {
      byReason[reason] = count;
    }

    logger.info('[WhatsApp Capture] Resumen de evento', {
      total: this.total,
      captured: this.byResult.get('captured') ?? 0,
      ignored: this.byResult.get('ignored') ?? 0,
      error: this.byResult.get('error') ?? 0,
      byReason,
      suppressed: this.suppressed,
      ...extra,
    });
  }
}
