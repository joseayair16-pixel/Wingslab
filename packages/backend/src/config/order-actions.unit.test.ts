import {
  AUTHORIZED_MANUAL_ORDER_IDS,
  AUTOMATIC_ORDER_DECISIONS_ENABLED,
  SIMULATED_ORDERS_ENABLED,
  manualOrderActionAllowed,
  manualOrderActionsForStatus,
  manualOrderAllowed,
  manualOrderTargetStatus,
} from '@sadel/shared';

import { assertManualOrderAction, requireManualOrderAction } from './order-actions';

const ALLOWED = AUTHORIZED_MANUAL_ORDER_IDS[0];

describe('capacidad de acciones manuales', () => {
  it('permite solo los tres estados manualizados y solo en el pedido autorizado', () => {
    expect(manualOrderActionsForStatus('PENDING')).toEqual(['accept']);
    expect(manualOrderActionsForStatus('CONFIRMED')).toEqual(['preparing']);
    expect(manualOrderActionsForStatus('PREPARING')).toEqual(['ready']);
    expect(manualOrderActionsForStatus('READY')).toEqual(['asumirReparto']);
    expect(manualOrderTargetStatus('accept')).toBe('CONFIRMED');
    expect(manualOrderTargetStatus('preparing')).toBe('PREPARING');
    expect(manualOrderTargetStatus('ready')).toBe('READY');
  });

  it('rechaza pedidos que no están en la lista explícita', () => {
    expect(manualOrderAllowed(ALLOWED, true)).toBe(true);
    expect(manualOrderAllowed('wl_order_pendiente', true)).toBe(false);
    expect(manualOrderActionAllowed('wl_order_pendiente', 'accept', true)).toBe(false);
  });

  it('rechaza cualquier acción fuera del conjunto autorizado', () => {
    expect(manualOrderActionAllowed(ALLOWED, 'reject', true)).toBe(false);
    expect(manualOrderActionAllowed(ALLOWED, 'delivered', true)).toBe(false);
    expect(manualOrderActionAllowed(ALLOWED, 'cancel', true)).toBe(false);
  });

  it('nunca autoriza fuera del runtime local verificado', () => {
    expect(manualOrderAllowed(ALLOWED, false)).toBe(false);
    expect(manualOrderActionAllowed(ALLOWED, 'accept', false)).toBe(false);
  });

  it('mantiene cerrados los automatismos y las simulaciones', () => {
    expect(AUTOMATIC_ORDER_DECISIONS_ENABLED).toBe(false);
    expect(SIMULATED_ORDERS_ENABLED).toBe(false);
  });
});

describe('guarda del backend', () => {
  it('lanza cuando la acción no está autorizada', () => {
    expect(() => assertManualOrderAction(ALLOWED, 'accept')).not.toThrow();
    expect(() => assertManualOrderAction('wl_order_pendiente', 'accept')).toThrow(/WINGSLAB_ORDER_ACTION_BLOCKED|autorizada/);
    expect(() => assertManualOrderAction(ALLOWED, 'reject')).toThrow(/WINGSLAB_ORDER_ACTION_BLOCKED|autorizada/);
  });

  function fakeRequest(method: string, route: string, params: Record<string, string> = {}) {
    return { method, routeOptions: { url: route }, params } as never;
  }

  function fakeReply() {
    const state = { statusCode: 0, payload: null as any };
    const reply = {
      status(code: number) { state.statusCode = code; return reply; },
      send(payload: unknown) { state.payload = payload; return reply; },
    };
    return { reply: reply as never, state };
  }

  it('bloquea mutaciones sobre pedidos no autorizados', async () => {
    const { reply, state } = fakeReply();
    await requireManualOrderAction(fakeRequest('PATCH', '/restaurant-panel/pedidos/:id/aceptar', { id: 'wl_order_pendiente' }), reply);
    expect(state.statusCode).toBe(403);
    expect(state.payload.error.code).toBe('WINGSLAB_ORDER_ACTION_BLOCKED');
  });

  it('permite mutaciones sobre el pedido autorizado', async () => {
    const { reply, state } = fakeReply();
    await requireManualOrderAction(fakeRequest('PATCH', '/restaurant-panel/pedidos/:id/aceptar', { id: ALLOWED }), reply);
    expect(state.statusCode).toBe(0);
  });

  it('no interfiere con las lecturas ni con rutas que no son de pedido', async () => {
    const { reply, state } = fakeReply();
    await requireManualOrderAction(fakeRequest('GET', '/restaurant-panel/pedidos'), reply);
    await requireManualOrderAction(fakeRequest('POST', '/restaurant-panel/ubicacion'), reply);
    expect(state.statusCode).toBe(0);
  });
});
