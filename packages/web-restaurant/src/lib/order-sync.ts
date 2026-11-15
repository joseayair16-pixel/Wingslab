type VersionedOrder = { id: string; status?: string; updatedAt?: string };
const stages = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY'];
function mergeFields(current: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    const old = current[key];
    merged[key] = value && old && typeof value === 'object' && typeof old === 'object' &&
      !Array.isArray(value) && !Array.isArray(old)
      ? mergeFields(old as Record<string, unknown>, value as Record<string, unknown>) : value;
  }
  return merged;
}
/** Merge authoritative partial DTOs, never discard absent items/address/nested customer fields. */
export function mergeConfirmedOrder<T extends VersionedOrder>(current: T, incoming: Partial<T> & { id: string }): T {
  if (incoming.id !== current.id) return current;
  const oldTime = Date.parse(current.updatedAt || ''), newTime = Date.parse(incoming.updatedAt || '');
  if (Number.isFinite(oldTime) && (!Number.isFinite(newTime) || newTime < oldTime)) return current;
  if (newTime === oldTime && stages.includes(current.status || '') && stages.includes(incoming.status || '') &&
    stages.indexOf(incoming.status!) < stages.indexOf(current.status!)) return current;
  return mergeFields(current as unknown as Record<string, unknown>, incoming as Record<string, unknown>) as T;
}
export function reconcileOrders<T extends VersionedOrder>(current: T[], incoming: T[]): T[] {
  const existing = new Map(current.map(order => [order.id, order]));
  return incoming.map(order => existing.has(order.id) ? mergeConfirmedOrder(existing.get(order.id)!, order) : order);
}
/** A response begun before a mutation/event/session change or a newer GET cannot win. */
export function createOrderSyncGate() {
  let sequence = 0, revision = 0;
  return {
    begin: () => ({ sequence: ++sequence, revision }),
    invalidate: () => { revision++; },
    current: (ticket: { sequence: number; revision: number }) => ticket.sequence === sequence && ticket.revision === revision,
  };
}
export function createOrderActionFlight() {
  const busy = new Set<string>();
  return {
    acquire: (id: string) => { if (busy.has(id)) return false; busy.add(id); return true; },
    release: (id: string) => { busy.delete(id); },
    has: (id: string) => busy.has(id),
  };
}
