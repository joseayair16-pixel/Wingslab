/**
 * Origen canónico de la app del comensal (la única que sirve las rutas públicas
 * como /reparto/ver/[token] y /restaurantes/[id]).
 *
 * Regla de precedencia (sin necesidad de recompilar el frontend si cambia el dominio):
 *   1. CUSTOMER_WEB_URL  -> variable canónica de la app del comensal
 *   2. WEBAPP_URL        -> alias existente usado por los jobs/notificaciones
 * Sin fallback de producción. Solo se admite el origen local explícito.
 */
import { getWingslabCustomerUrl } from '@sadel/shared';

export const DEFAULT_CUSTOMER_WEB_URL = '';

export function getCustomerWebUrl(): string {
  return getWingslabCustomerUrl();
}

/** URL pública de entrega que codifica el QR de reparto (token de un solo uso). */
export function buildCustomerDeliveryUrl(token: string): string {
  const base = getCustomerWebUrl();
  return `${base}/reparto/ver/${encodeURIComponent(token)}`;
}
