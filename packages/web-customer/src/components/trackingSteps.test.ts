import { buildTimelineSteps } from './trackingSteps';

describe.each(['DELIVERY', 'PICKUP'] as const)('seguimiento para %s', (fulfillmentType) => {
  test('espera confirmación antes de mostrar preparación', () => {
    const order = { id: 'order-1', status: 'PENDING', fulfillmentType, restaurant: { businessType: 'RESTAURANT' } };
    expect(buildTimelineSteps(order)[0]).toMatchObject({ label: 'Esperando confirmación', state: 'active' });
    expect(buildTimelineSteps({ ...order, status: 'CONFIRMED' })[0]).toMatchObject({ label: 'En preparación', state: 'active' });
  });
});
