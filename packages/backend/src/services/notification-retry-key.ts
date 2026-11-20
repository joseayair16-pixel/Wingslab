import type { NotificationPayload } from './notification-types';

/** Stable retry identity, scoped to each recipient so one user's delivery never suppresses another's. */
export function notificationRetryDedupeKey(userId: string, payload: NotificationPayload): string | null {
  const event = typeof payload.data?.event === 'string' ? payload.data.event : '';
  const type = typeof payload.data?.type === 'string' ? payload.data.type : '';
  const orderId = typeof payload.data?.orderId === 'string' ? payload.data.orderId : '';
  const eventKey = event || type;
  if (!userId || !eventKey || !orderId) return null;
  return `${userId}:${orderId}:${eventKey}`;
}
