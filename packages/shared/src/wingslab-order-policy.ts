export const AUTOMATIC_ORDER_DECISIONS_ENABLED = false;
export const SIMULATED_ORDERS_ENABLED = false;

// Pedidos que siguen en curso y, por tanto, nunca deben ocultarse por fecha.
export const ACTIVE_ORDER_STATUSES = Object.freeze([
  'PENDING',
  'CONFIRMED',
  'PREPARING',
  'READY',
  'PICKED_UP',
  'IN_TRANSIT',
] as const);

export function isActiveOrderStatus(status: string): boolean {
  return (ACTIVE_ORDER_STATUSES as readonly string[]).includes(status);
}

type ActionRule = Readonly<{ from: ReadonlyArray<string>; to: string }>;

export const RESTAURANT_ORDER_ACTIONS: Readonly<Record<string, ActionRule>> = Object.freeze({
  accept: Object.freeze({ from: Object.freeze(['PENDING']), to: 'CONFIRMED' }),
  reject: Object.freeze({ from: Object.freeze(['PENDING']), to: 'REJECTED' }),
  preparing: Object.freeze({ from: Object.freeze(['CONFIRMED']), to: 'PREPARING' }),
  ready: Object.freeze({ from: Object.freeze(['PREPARING']), to: 'READY' }),
  asumirReparto: Object.freeze({ from: Object.freeze(['READY']), to: 'READY' }),
  handover: Object.freeze({ from: Object.freeze(['READY']), to: 'PICKED_UP' }),
  delivered: Object.freeze({ from: Object.freeze(['IN_TRANSIT']), to: 'DELIVERED' }),
  cancel: Object.freeze({ from: Object.freeze(['PENDING', 'CONFIRMED', 'PREPARING', 'READY']), to: 'CANCELLED' }),
  quitarRepartidor: Object.freeze({ from: Object.freeze(['READY']), to: 'READY' }),
  confirmarPagoEfectivo: Object.freeze({ from: Object.freeze(['PICKED_UP']), to: 'PICKED_UP' }),
  marcarRecogido: Object.freeze({ from: Object.freeze(['READY']), to: 'COMPLETED' }),
  iniciarEntrega: Object.freeze({ from: Object.freeze(['READY']), to: 'IN_TRANSIT' }),
});

export function restaurantOrderActionsForStatus(status: string): string[] {
  return Object.keys(RESTAURANT_ORDER_ACTIONS).filter(key => RESTAURANT_ORDER_ACTIONS[key].from.includes(status));
}

export function restaurantOrderActionAllowed(status: string, action: string): boolean {
  return RESTAURANT_ORDER_ACTIONS[action]?.from.includes(status) === true;
}

export function restaurantOrderTargetStatus(action: string): string | undefined {
  return RESTAURANT_ORDER_ACTIONS[action]?.to;
}
