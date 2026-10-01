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
  /**
   * Marca este aviso como "alarma de pedido": en los dispositivos nativos
   * compatibles (appVersion >= RING_MIN_APP_VERSION) el push FCM se envía como
   * data-message para que la app inicie la alarma continua (Foreground Service)
   * en lugar de una notificación simple. En web/PWA se comporta igual que
   * siempre (notificación normal).
   */
  nativeRing?: boolean;
  /** epoch ms en el que la alarma nativa debe detenerse sola (fin de la ventana). */
  nativeRingExpiresAt?: number;
};

export type PushOptions = {
  ttl?: number;
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
  /** true cuando el envío proviene de la cola de reintentos (evita re-encolar). */
  skipRetryQueue?: boolean;
};