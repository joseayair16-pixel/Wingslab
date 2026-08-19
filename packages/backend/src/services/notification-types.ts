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
};

export type PushOptions = {
  ttl?: number;
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
  /** true cuando el envío proviene de la cola de reintentos (evita re-encolar). */
  skipRetryQueue?: boolean;
};