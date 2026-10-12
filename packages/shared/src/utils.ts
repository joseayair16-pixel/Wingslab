/**
 * Utility functions for SaDeL Platform
 */

/**
 * Format currency value
 */
export const formatCurrency = (
  amount: number,
  currency = 'USD',
  locale = 'en-US'
): string => {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(amount);
};

/**
 * Calculate distance between two coordinates in kilometers
 */
export const calculateDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

/**
 * Parse JWT token
 */
export const parseJWT = <T = Record<string, unknown>>(
  token: string
): T | null => {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload) as T;
  } catch {
    return null;
  }
};

/**
 * Format time remaining
 */
export const formatTimeRemaining = (minutes: number): string => {
  if (minutes < 1) return 'Less than 1 minute';
  if (minutes === 1) return '1 minute';
  return `${minutes} minutes`;
};

/**
 * Generate order reference
 */
export const generateOrderReference = (): string => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `SAD-${timestamp}-${random}`;
};

// ============== Business Type Labels ==============

export function isRestaurant(businessType?: string): boolean {
  return !businessType || businessType === 'RESTAURANT';
}

export function getBusinessRef(businessType?: string): string {
  return isRestaurant(businessType) ? 'restaurante' : 'tienda';
}

export function getBusinessRefCapitalized(businessType?: string): string {
  return isRestaurant(businessType) ? 'Restaurante' : 'Tienda';
}

export function getBusinessArticle(businessType?: string): string {
  return isRestaurant(businessType) ? 'el' : 'la';
}

export function getBusinessArticleCapitalized(businessType?: string): string {
  return isRestaurant(businessType) ? 'El' : 'La';
}

export function getBusinessPossessive(businessType?: string): string {
  return isRestaurant(businessType) ? 'tu restaurante' : 'tu tienda';
}

const RESTAURANT_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pendiente',
  CONFIRMED: 'Confirmado',
  PREPARING: 'En preparación',
  READY: 'Listo',
  PICKED_UP: 'Recogido',
  IN_TRANSIT: 'En camino',
  DELIVERED: 'Entregado',
  COMPLETED: 'Recogido en tienda',
  CANCELLED: 'Cancelado',
  REJECTED: 'Rechazado',
};

const STORE_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pendiente',
  CONFIRMED: 'Confirmado',
  PREPARING: 'Preparando pedido',
  READY: 'Listo',
  PICKED_UP: 'Recogido',
  IN_TRANSIT: 'En camino',
  DELIVERED: 'Entregado',
  COMPLETED: 'Recogido en tienda',
  CANCELLED: 'Cancelado',
  REJECTED: 'Rechazado',
};

export function getOrderStatusLabel(status: string, businessType?: string): string {
  return isRestaurant(businessType) ? RESTAURANT_STATUS_LABELS[status] || status : STORE_STATUS_LABELS[status] || status;
}

/**
 * Espera a que el bridge de Capacitor esté disponible antes de decidir si la
 * app corre en nativo o en el navegador.
 *
 * Las APKs de SaDeL cargan una URL remota (`server.url`). En ese modo
 * Capacitor inyecta `window.Capacitor` con
 * `WebViewCompat.addDocumentStartJavaScript`, que NO está disponible en
 * Android System WebView antiguas (<105). Cuando la inyección no ocurre, la
 * app degrada silenciosamente al camino web (service worker + web push) y
 * nunca registra el token FCM: el navegador recibe notificaciones y el APK no.
 *
 * `isReady` se inyecta para poder probar la espera sin un WebView real.
 * Devuelve true si el bridge apareció dentro del tiempo; false al agotarlo
 * (WebView antigua o entorno de navegador real, donde no debe existir).
 */
export async function waitForNativeBridge(options: {
  isReady: () => boolean;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<boolean> {
  // El bridge, cuando existe, se inyecta al inicio del documento: si aparece,
  // lo hace casi de inmediato. El límite solo protege contra WebViews que lo
  // inyectan tarde; en un navegador real (sin bridge) este es todo el retraso
  // antes de seguir por el camino web, así que se mantiene corto.
  const { isReady, timeoutMs = 1200, intervalMs = 100 } = options;
  if (isReady()) return true;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    if (isReady()) return true;
  }
  return false;
}
