/* Explicit local test capability. Not a replacement for JWT, ownership or state validation. */
const AUTHORIZED_MANUAL_ORDER_IDS = Object.freeze(['cmwgzrpnm0047orggilrr3fxu']);
const AUTOMATIC_ORDER_DECISIONS_ENABLED = false;
const SIMULATED_ORDERS_ENABLED = false;
const MANUAL_ORDER_ACTIONS = Object.freeze({
  accept: Object.freeze({ from: 'PENDING', to: 'CONFIRMED', path: 'aceptar' }),
  preparing: Object.freeze({ from: 'CONFIRMED', to: 'PREPARING', path: 'preparacion' }),
  ready: Object.freeze({ from: 'PREPARING', to: 'READY', path: 'listo' }),
  asumirReparto: Object.freeze({ from: 'READY', to: 'READY', path: 'asumir-reparto' }),
});
/** @param {string} orderId @param {string} action @param {boolean} localVerified */
function manualOrderActionAllowed(orderId, action, localVerified) {
  return localVerified === true && AUTHORIZED_MANUAL_ORDER_IDS.includes(orderId) &&
    Object.prototype.hasOwnProperty.call(MANUAL_ORDER_ACTIONS, action);
}
/** Order-level capability: only explicitly authorized fictional orders may be mutated. */
function manualOrderAllowed(orderId, localVerified) {
  return localVerified === true && AUTHORIZED_MANUAL_ORDER_IDS.includes(orderId);
}
/** @param {string} status */
function manualOrderActionsForStatus(status) {
  return Object.keys(MANUAL_ORDER_ACTIONS).filter(key => MANUAL_ORDER_ACTIONS[key].from === status);
}
/** @param {string} action */
function manualOrderTargetStatus(action) { return MANUAL_ORDER_ACTIONS[action]?.to; }
module.exports = { AUTHORIZED_MANUAL_ORDER_IDS, AUTOMATIC_ORDER_DECISIONS_ENABLED,
  SIMULATED_ORDERS_ENABLED, MANUAL_ORDER_ACTIONS, manualOrderActionAllowed,
  manualOrderActionsForStatus, manualOrderTargetStatus, manualOrderAllowed };
