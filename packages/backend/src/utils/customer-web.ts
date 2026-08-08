/**
 * Origen canónico de la app del comensal (la única que sirve las rutas públicas
 * como /reparto/ver/[token] y /restaurantes/[id]).
 *
 * Regla de precedencia (sin necesidad de recompilar el frontend si cambia el dominio):
 *   1. CUSTOMER_WEB_URL  -> variable canónica de la app del comensal
 *   2. WEBAPP_URL        -> alias existente usado por los jobs/notificaciones
 *   3. 'https://sadel.app' -> dominio de producción actual
 */
export const DEFAULT_CUSTOMER_WEB_URL = 'https://sadel.app';

export function getCustomerWebUrl(): string {
  return (process.env.CUSTOMER_WEB_URL || process.env.WEBAPP_URL || DEFAULT_CUSTOMER_WEB_URL).replace(/\/+$/, '');
}

/** URL pública de entrega que codifica el QR de reparto (token de un solo uso). */
export function buildCustomerDeliveryUrl(token: string): string {
  const base = getCustomerWebUrl();
  return `${base}/reparto/ver/${encodeURIComponent(token)}`;
}