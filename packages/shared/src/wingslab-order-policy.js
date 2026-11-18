const AUTOMATIC_ORDER_DECISIONS_ENABLED = false;
const SIMULATED_ORDERS_ENABLED = false;
const RESTAURANT_ORDER_ACTIONS = Object.freeze({
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
/** @param {string} status */
function restaurantOrderActionsForStatus(status) {
  return Object.keys(RESTAURANT_ORDER_ACTIONS).filter(key => RESTAURANT_ORDER_ACTIONS[key].from.includes(status));
}
/** @param {string} action */
function restaurantOrderActionAllowed(status, action) {
  return RESTAURANT_ORDER_ACTIONS[action]?.from.includes(status) === true;
}
/** @param {string} action */
function restaurantOrderTargetStatus(action) { return RESTAURANT_ORDER_ACTIONS[action]?.to; }
module.exports = { AUTOMATIC_ORDER_DECISIONS_ENABLED, SIMULATED_ORDERS_ENABLED,
  RESTAURANT_ORDER_ACTIONS, restaurantOrderActionsForStatus,
  restaurantOrderActionAllowed, restaurantOrderTargetStatus };
