import {
  restaurantOrderActionAllowed,
  restaurantOrderActionsForStatus,
  restaurantOrderTargetStatus,
  AUTOMATIC_ORDER_DECISIONS_ENABLED,
  SIMULATED_ORDERS_ENABLED,
} from '@sadel/shared';

describe('WingsLab restaurant order action policy', () => {
  it('offers only actions valid for the current status', () => {
    expect(restaurantOrderActionsForStatus('PENDING')).toEqual(['accept', 'reject', 'cancel']);
    expect(restaurantOrderActionsForStatus('CONFIRMED')).toEqual(['preparing', 'cancel']);
    expect(restaurantOrderActionsForStatus('PREPARING')).toEqual(['ready', 'cancel']);
    expect(restaurantOrderActionsForStatus('READY')).toEqual([
      'asumirReparto', 'handover', 'cancel', 'quitarRepartidor', 'marcarRecogido', 'iniciarEntrega',
    ]);
    expect(restaurantOrderActionAllowed('IN_TRANSIT', 'delivered')).toBe(true);
    expect(restaurantOrderActionAllowed('DELIVERED', 'delivered')).toBe(false);
  });

  it('maps actions to the committed state expected by the UI', () => {
    expect(restaurantOrderTargetStatus('accept')).toBe('CONFIRMED');
    expect(restaurantOrderTargetStatus('reject')).toBe('REJECTED');
    expect(restaurantOrderTargetStatus('asumirReparto')).toBe('READY');
    expect(restaurantOrderTargetStatus('handover')).toBe('PICKED_UP');
    expect(restaurantOrderTargetStatus('marcarRecogido')).toBe('COMPLETED');
  });

  it('keeps simulation and automatic decisions disabled', () => {
    expect(AUTOMATIC_ORDER_DECISIONS_ENABLED).toBe(false);
    expect(SIMULATED_ORDERS_ENABLED).toBe(false);
  });
});
