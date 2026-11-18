import { buildRestaurantInsights, filterCampaignAudience } from './restaurant-insights';
const now = new Date('2026-11-01T12:00:00Z');
test('reports aggregate completed sales, statuses, customer repeat rate, top items and coupon use', () => {
  const orders: any[] = [
    { id: '1', customerId: 'a', status: 'DELIVERED', totalAmount: 120, createdAt: new Date(+now - 600000), preparationStartedAt: now, inTransitAt: now, deliveredAt: new Date(+now + 120000), promoCode: 'ALAS', promoDiscountAmount: 10, items: [{ quantity: 2, product: { id: 'p', name: 'Alitas' } }] },
    { id: '2', customerId: 'a', status: 'COMPLETED', totalAmount: 80, createdAt: now, promoCode: 'ALAS', promoDiscountAmount: 5, items: [{ quantity: 1, product: { id: 'p', name: 'Alitas' } }] },
    { id: '3', customerId: 'b', status: 'PENDING', totalAmount: 90, createdAt: now },
    { id: '4', customerId: 'c', status: 'CANCELLED', totalAmount: 99, createdAt: now },
  ];
  const r = buildRestaurantInsights(orders, 30, now);
  expect(r.sales).toEqual({ net: 200, averageTicket: 100, completedOrders: 2 });
  expect(r.orders).toMatchObject({ total: 4, pending: 1, delivered: 2, cancelled: 1 });
  expect(r.customers).toEqual({ uniqueBuyers: 1, newBuyers: 0, repeatBuyers: 1 });
  expect(r.operations).toEqual({ averagePreparationMinutes: 10, averageDeliveryMinutes: 2 });
  expect(r.topProducts[0]).toMatchObject({ name: 'Alitas', units: 3 });
  expect(r.promotions[0]).toEqual({ code: 'ALAS', uses: 2, discount: 15 });
});
test('lifetime order counts identify repeat buyers with one recent order in the selected period', () => {
  const r = buildRestaurantInsights([{ id: 'recent', customerId: 'returning', status: 'DELIVERED', totalAmount: 40, createdAt: now }], 30, now, { returning: 4 });
  expect(r.customers).toEqual({ uniqueBuyers: 1, newBuyers: 0, repeatBuyers: 1 });
});
test.each([1, 7, 30, 90])('sales trend uses completed orders and exact %i-day interval boundaries', days => {
  const start = +now - days * 86400000;
  const orders: any[] = [
    { id:'first', customerId:'a', status:'DELIVERED', totalAmount:120.25, createdAt:new Date(start) },
    { id:'last', customerId:'b', status:'COMPLETED', totalAmount:80.5, createdAt:now },
    { id:'pending', customerId:'c', status:'PENDING', totalAmount:500, createdAt:now },
    { id:'cancelled', customerId:'d', status:'CANCELLED', totalAmount:300, createdAt:now },
  ];
  const result = buildRestaurantInsights(orders, days, now);
  expect(result.salesTrend[0]).toMatchObject({ from:new Date(start).toISOString(), sales:120.25, completedOrders:1 });
  expect(result.salesTrend[result.salesTrend.length-1]).toMatchObject({ to:now.toISOString(), sales:80.5, completedOrders:1 });
  expect(result.salesTrend.reduce((sum, bucket) => sum + bucket.sales, 0)).toBe(result.sales.net);
  expect(result.salesTrend.reduce((sum, bucket) => sum + bucket.completedOrders, 0)).toBe(result.sales.completedOrders);
});
test('today report uses its supplied local-day start instead of a rolling 24 hours', () => {
  const start = new Date('2026-11-01T06:00:00Z');
  const orders: any[] = [{ id:'1', customerId:'a', status:'DELIVERED', totalAmount:50, createdAt:new Date('2026-11-01T07:00:00Z') }];
  const report = buildRestaurantInsights(orders, 1, now, {}, start);
  expect(report.period.from).toBe(start.toISOString());
  expect(report.salesTrend.reduce((sum, bucket) => sum + bucket.sales, 0)).toBe(50);
});
test('campaign audience requires accepted notifications and respects segments', () => {
  const customers: any[] = [
    { createdAt: now, orders: [{ createdAt: now }], pushSubscriptions: [{}], fcmTokens: [] },
    { createdAt: now, orders: Array.from({ length: 3 }, (_, i) => ({ createdAt: new Date(+now - i * 86400000) })), pushSubscriptions: [], fcmTokens: [{}] },
    { createdAt: now, orders: [{ createdAt: new Date(+now - 60 * 86400000) }], pushSubscriptions: [{}], fcmTokens: [] },
    { createdAt: now, orders: [{ createdAt: now }], pushSubscriptions: [{}], fcmTokens: [{}] },
    { createdAt: now, orders: [{ createdAt: now }], pushSubscriptions: [], fcmTokens: [] },
  ];
  expect(filterCampaignAudience(customers, 'subscribed', now)).toHaveLength(4);
  expect(filterCampaignAudience(customers, 'new', now)).toHaveLength(2);
  expect(filterCampaignAudience(customers, 'frequent', now)).toHaveLength(1);
  expect(filterCampaignAudience(customers, 'inactive', now)).toHaveLength(1);
});
