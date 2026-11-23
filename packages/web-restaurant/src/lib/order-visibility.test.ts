import { isActiveOrderStatus, isOrderInPeriod, mexicoDayKey } from './order-visibility';

describe('order visibility', () => {
  const today = '2026-11-22';

  it('keeps an active order visible even when it was created days earlier', () => {
    const order = { status: 'READY', createdAt: '2026-11-20T07:26:30.632Z' };
    expect(isOrderInPeriod(order, today, today)).toBe(true);
  });

  it('hides an old finished order from the current period', () => {
    const order = { status: 'DELIVERED', createdAt: '2026-11-20T07:26:30.632Z' };
    expect(isOrderInPeriod(order, today, today)).toBe(false);
  });

  it('groups a delivered order by its delivery date, not its creation date', () => {
    const order = {
      status: 'DELIVERED',
      createdAt: '2026-11-20T07:26:30.632Z',
      deliveredAt: '2026-11-22T18:00:00.000Z',
    };
    expect(isOrderInPeriod(order, today, today)).toBe(true);
  });

  it('shows a finished order from today', () => {
    const order = { status: 'DELIVERED', createdAt: '2026-11-22T18:00:00.000Z' };
    expect(isOrderInPeriod(order, today, today)).toBe(true);
  });

  it('ignores orders with an invalid date', () => {
    const order = { status: 'DELIVERED', createdAt: 'not-a-date' };
    expect(isOrderInPeriod(order, today, today)).toBe(false);
  });

  it('recognizes every in-progress status as active', () => {
    for (const status of ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'PICKED_UP', 'IN_TRANSIT']) {
      expect(isActiveOrderStatus(status)).toBe(true);
    }
    for (const status of ['DELIVERED', 'COMPLETED', 'CANCELLED', 'REJECTED']) {
      expect(isActiveOrderStatus(status)).toBe(false);
    }
  });

  it('computes the day in Mexico City time, not the device timezone', () => {
    expect(mexicoDayKey('2026-11-21T05:59:00.000Z')).toBe('2026-11-20');
    expect(mexicoDayKey('2026-11-21T06:00:00.000Z')).toBe('2026-11-21');
  });
});
