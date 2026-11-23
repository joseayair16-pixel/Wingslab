// Reglas de visibilidad de pedidos en el panel del restaurante.

import { ACTIVE_ORDER_STATUSES, isActiveOrderStatus } from '@sadel/shared';

export { ACTIVE_ORDER_STATUSES, isActiveOrderStatus };

// Un solo formateador evita crear cientos por render al filtrar pedidos.
const MEXICO_DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Mexico_City',
  year: 'numeric', month: '2-digit', day: '2-digit',
});

// Clave de día en horario de Ciudad de México, para filtrar pedidos por fecha
// sin depender de la zona horaria del dispositivo.
export function mexicoDayKey(value: string | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return MEXICO_DAY_FORMATTER.format(date);
}

/**
 * Un pedido en curso nunca se oculta por el filtro de fecha: si se creó antes
 * del periodo seleccionado pero sigue activo, el restaurante debe verlo y
 * poder gestionarlo. El filtro de periodo solo aplica al historial.
 */
export function isOrderInPeriod(
  order: { status: string; createdAt: string | Date; deliveredAt?: string | Date | null; completedAt?: string | Date | null },
  periodStartKey: string,
  todayKey: string,
): boolean {
  if (isActiveOrderStatus(order.status)) return true;
  // Los pedidos cerrados se agrupan por la fecha en que se entregaron/completaron,
  // no por la de creación (pueden llevar días en preparación).
  const closedAt = order.deliveredAt || order.completedAt || order.createdAt;
  const key = mexicoDayKey(closedAt);
  return Boolean(key) && key >= periodStartKey && key <= todayKey;
}
