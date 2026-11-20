import { notificationRetryDedupeKey } from './notification-retry-key';

describe('notification retry deduplication', () => {
  const payload = { title: 'Pedido actualizado', data: { event: 'order:ready', orderId: 'order-1' } };

  it('deduplicates the same event for the same recipient', () => {
    expect(notificationRetryDedupeKey('user-1', payload)).toBe(
      notificationRetryDedupeKey('user-1', payload),
    );
  });

  it('keeps retries for different recipients independent', () => {
    expect(notificationRetryDedupeKey('restaurant-user', payload)).not.toBe(
      notificationRetryDedupeKey('customer-user', payload),
    );
  });

  it('returns no stable dedupe key when event or order identity is missing', () => {
    expect(notificationRetryDedupeKey('user-1', { title: 'Aviso' })).toBeNull();
  });
});
