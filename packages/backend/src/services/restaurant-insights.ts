export type InsightOrder = {
  id: string; customerId: string; status: string; totalAmount: number; createdAt: Date | string;
  preparationStartedAt?: Date | string | null; inTransitAt?: Date | string | null; deliveredAt?: Date | string | null;
  promoCode?: string | null; promoDiscountAmount?: number | null;
  items?: Array<{ quantity: number; subtotal?: number; product?: { id: string; name: string } | null }>;
};
const successful = new Set(['DELIVERED', 'COMPLETED', 'PICKED_UP']);
const mins = (a?: Date | string | null, b?: Date | string | null) => a && b ? Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 60000) : null;
export function buildRestaurantInsights(orders: InsightOrder[], days: number, now = new Date(), lifetimeOrderCounts: Record<string, number> = {}, startAt?: Date) {
  const counts: Record<string, number> = {};
  const paid = orders.filter(o => successful.has(o.status));
  const sales = paid.reduce((n, o) => n + o.totalAmount, 0);
  const end = now.getTime(), start = startAt ? startAt.getTime() : end - days * 86400000;
  const bucketCount = days === 1 ? 6 : days === 30 || days === 90 ? 6 : 7;
  const interval = (end - start) / bucketCount;
  const salesTrend = Array.from({ length: bucketCount }, (_, index) => ({
    from: new Date(start + interval * index).toISOString(),
    to: new Date(index === bucketCount - 1 ? end : start + interval * (index + 1)).toISOString(),
    sales: 0, completedOrders: 0,
  }));
  for (const order of paid) {
    const timestamp = new Date(order.createdAt).getTime();
    if (!Number.isFinite(timestamp) || timestamp < start || timestamp > end) continue;
    const bucket = salesTrend[interval > 0 ? Math.min(bucketCount - 1, Math.floor((timestamp - start) / interval)) : 0];
    bucket.sales += order.totalAmount;
    bucket.completedOrders++;
  }
  for (const bucket of salesTrend) bucket.sales = Math.round(bucket.sales * 100) / 100;
  const customerOrders = new Map<string, number>();
  const products = new Map<string, { productId: string; name: string; units: number; sales: number }>();
  const coupons = new Map<string, { code: string; uses: number; discount: number }>();
  for (const order of orders) {
    counts[order.status] = (counts[order.status] || 0) + 1;
    if (successful.has(order.status)) customerOrders.set(order.customerId, (customerOrders.get(order.customerId) || 0) + 1);
    if (successful.has(order.status)) for (const item of order.items || []) {
      const id = item.product?.id || 'deleted';
      const aggregate = products.get(id) || { productId: id, name: item.product?.name || 'Producto retirado', units: 0, sales: 0 };
      aggregate.units += item.quantity; aggregate.sales += item.subtotal || 0; products.set(id, aggregate);
    }
    if (order.promoCode && successful.has(order.status)) {
      const aggregate = coupons.get(order.promoCode) || { code: order.promoCode, uses: 0, discount: 0 };
      aggregate.uses++; aggregate.discount += order.promoDiscountAmount || 0; coupons.set(order.promoCode, aggregate);
    }
  }
  const totalPrep = paid.map(o => mins(o.createdAt, o.preparationStartedAt)).filter((x): x is number => x !== null);
  const totalDelivery = paid.map(o => mins(o.inTransitAt, o.deliveredAt)).filter((x): x is number => x !== null);
  return {
    period: { days, from: new Date(start).toISOString(), to: now.toISOString() },
    salesTrend,
    orders: { total: orders.length, pending: counts.PENDING || 0, preparing: (counts.CONFIRMED || 0) + (counts.PREPARING || 0), ready: counts.READY || 0,
      inTransit: counts.IN_TRANSIT || 0, delivered: (counts.DELIVERED || 0) + (counts.PICKED_UP || 0) + (counts.COMPLETED || 0), cancelled: (counts.CANCELLED || 0) + (counts.REJECTED || 0), byStatus: counts },
    sales: { net: Math.round(sales * 100) / 100, averageTicket: paid.length ? Math.round(sales / paid.length * 100) / 100 : 0, completedOrders: paid.length },
    customers: { uniqueBuyers: customerOrders.size,
      newBuyers: [...customerOrders.keys()].filter(id => (lifetimeOrderCounts[id] ?? customerOrders.get(id) ?? 0) === 1).length,
      repeatBuyers: [...customerOrders.keys()].filter(id => (lifetimeOrderCounts[id] ?? customerOrders.get(id) ?? 0) > 1).length },
    operations: { averagePreparationMinutes: totalPrep.length ? Math.round(totalPrep.reduce((a, b) => a + b, 0) / totalPrep.length) : null,
      averageDeliveryMinutes: totalDelivery.length ? Math.round(totalDelivery.reduce((a, b) => a + b, 0) / totalDelivery.length) : null },
    topProducts: [...products.values()].sort((a, b) => b.units - a.units).slice(0, 8),
    promotions: [...coupons.values()].sort((a, b) => b.uses - a.uses),
  };
}

export type CampaignSegment = 'subscribed' | 'new' | 'frequent' | 'inactive';
export function filterCampaignAudience<T extends { createdAt: Date | string; orders: Array<{ createdAt: Date | string }>; pushSubscriptions: unknown[]; fcmTokens: unknown[] }>(
  customers: T[], segment: CampaignSegment, now = new Date()) {
  const since30 = now.getTime() - 30 * 86400000, since90 = now.getTime() - 90 * 86400000;
  return customers.filter(customer => {
    // Aceptar notificaciones en este dispositivo habilita las campañas.
    if (!customer.pushSubscriptions.length && !customer.fcmTokens.length) return false;
    const dates = customer.orders.map(o => new Date(o.createdAt).getTime());
    const last = dates.length ? Math.max(...dates) : 0;
    if (segment === 'new') return dates.length === 1 && dates[0] >= since30;
    if (segment === 'frequent') return dates.filter(d => d >= since90).length >= 3;
    if (segment === 'inactive') return dates.length > 0 && last < since30;
    return true;
  });
}
