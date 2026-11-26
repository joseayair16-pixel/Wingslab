import { completeUnassignedOwnDeliveryByRestaurant, prepareOwnDelivery, ownDeliveryAction, resolveOwnTicket } from './own-delivery.service';
import { getOrCreateDeliveryToken, readDeliveryToken } from './delivery-token.service';
import { hashToken } from '../utils/crypto';

const ID = 'cmwgzrpnm0047orggilrr3fxu', TOKEN = 't'.repeat(43);
function fixture(status = 'READY', orderId = ID) {
  let order: any = { id: orderId, status, updatedAt: new Date(1), fulfillmentType: 'DELIVERY', driverId: null,
    supportRestaurantId: null, deliveredByRestaurant: true, paymentMethod: 'CASH', paymentStatus: 'PENDING',
    totalAmount: 163, driverArrivedAtCustomer: null, latitude: 19.433, longitude: -99.134,
    restaurant: { id: 'restaurant', userId: 'owner', hasOwnDelivery: true, latitude: 19.4326, longitude: -99.1332 },
    customer: { user: { id: 'customer' } } };
  let row: any = { id: 'nonce', orderId: ID, token: hashToken(TOKEN), expiresAt: new Date(Date.now() + 60000) };
  const history: any[] = [];
  const db: any = {
    $executeRawUnsafe: jest.fn(async () => 1),
    order: {
      findFirst: jest.fn(async ({ where }) => where.restaurant.userId === 'owner' ? structuredClone(order) : null),
      findUniqueOrThrow: jest.fn(async () => structuredClone(order)),
      update: jest.fn(async ({ data }) => { order = { ...order, ...data, updatedAt: new Date() }; return structuredClone(order); }),
      updateMany: jest.fn(async ({ where, data }) => {
        if (order.status !== where.status || +order.updatedAt !== +where.updatedAt) return { count: 0 };
        order = { ...order, ...data, updatedAt: new Date() }; return { count: 1 };
      }),
    },
    orderTracking: { create: jest.fn(async ({ data }) => { history.push(data); return data; }) },
    deliveryToken: {
      findUnique: jest.fn(async ({ where }) => row && (where.orderId === row.orderId || where.token === row.token) ? { ...structuredClone(row), order: structuredClone(order) } : null),
      create: jest.fn(async ({ data }) => { row = data; return data; }),
      delete: jest.fn(async () => { row = null; }),
      deleteMany: jest.fn(async () => { row = null; }),
    },
  };
  db.$transaction = async (fn: any) => {
    const oldOrder = structuredClone(order), oldRow = structuredClone(row), length = history.length;
    try { return await fn(db); } catch (e) { order = oldOrder; row = oldRow; history.splice(length); throw e; }
  };
  return { db, history, order: () => order, setOrder: (data: any) => { order = { ...order, ...data }; }, setToken: (data: any) => { row = data; } };
}
beforeEach(() => { process.env.DATABASE_ENCRYPTION_KEY = 'independent-hermetic-key-'.repeat(3); });
test('QR assignment refuses wrong owner and unready orders', async () => {
  const f = fixture('PREPARING');
  await expect(prepareOwnDelivery(f.db, 'owner', ID)).rejects.toMatchObject({ code: 'INVALID_ORDER_STATE' });
  await expect(prepareOwnDelivery(f.db, 'other-owner', ID)).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' });
  expect(f.db.order.update).not.toHaveBeenCalled();
});
test('emergency completion requires a reason and explicit cash confirmation, without driver arrival', async () => {
  const f = fixture('IN_TRANSIT');
  await expect(completeUnassignedOwnDeliveryByRestaurant(f.db, 'owner', ID, { emergency: true, reason: 'corto' })).rejects.toMatchObject({ code: 'EMERGENCY_REASON_REQUIRED' });
  await expect(completeUnassignedOwnDeliveryByRestaurant(f.db, 'owner', ID, { emergency: true, reason: 'Teléfono sin batería' })).rejects.toMatchObject({ code: 'CASH_CONFIRMATION_REQUIRED' });
  const order = await completeUnassignedOwnDeliveryByRestaurant(f.db, 'owner', ID, { emergency: true, reason: 'Teléfono sin batería', cashReceived: true });
  expect(order.status).toBe('DELIVERED');
  expect(f.history[0].notes).toContain('Teléfono sin batería');
  expect(f.db.deliveryToken.deleteMany).toHaveBeenCalled();
});
test('a real restaurant-owned ready order can use the QR flow without a test-ID allowlist', async () => {
  const f = fixture('READY', 'wl_order_ready');
  f.setToken(null);
  f.setOrder({ deliveredByRestaurant: false });
  const result = await prepareOwnDelivery(f.db, 'owner', 'wl_order_ready');
  expect(result.order.status).toBe('READY');
  expect(result.order.deliveredByRestaurant).toBe(true);
});
test('own-delivery projections are passed to Prisma as select, never as include', async () => {
  const f = fixture();
  f.setToken(null);
  await prepareOwnDelivery(f.db, 'owner', ID);

  for (const call of f.db.order.findFirst.mock.calls) {
    expect(call[0]).toHaveProperty('select');
    expect(call[0]).not.toHaveProperty('include');
    expect(call[0].select.restaurant.select.hasOwnDelivery).toBe(true);
    expect(call[0].select.restaurant.select.userId).toBe(true);
    expect(call[0].select.customer.select.user.select.id).toBe(true);
    expect(call[0].select.customer.select.user.select).not.toHaveProperty('passwordHash');
  }
  for (const call of f.db.order.findUniqueOrThrow.mock.calls) {
    expect(call[0]).toHaveProperty('select');
    expect(call[0]).not.toHaveProperty('include');
  }
});
test('tokens reuse a valid QR, rotate after expiry and GET never creates', async () => {
  const f = fixture(); f.setToken(null);
  expect(await readDeliveryToken(f.db, ID)).toBeNull();
  const first = await getOrCreateDeliveryToken(f.db, ID);
  expect((await getOrCreateDeliveryToken(f.db, ID)).tokenStr).toBe(first.tokenStr);
  expect(f.db.deliveryToken.create).toHaveBeenCalledTimes(1);
  f.setToken({ id: 'expired', orderId: ID, token: hashToken(first.tokenStr), expiresAt: new Date(0) });
  const next = await getOrCreateDeliveryToken(f.db, ID);
  expect(next.tokenStr).not.toBe(first.tokenStr);
  await expect(resolveOwnTicket(f.db, first.tokenStr)).rejects.toMatchObject({ code: 'TOKEN_NOT_FOUND' });
});
test('preparing a QR keeps READY; repeated assignment reuses it without duplicate history', async () => {
  const f = fixture(); f.setToken(null); f.setOrder({ deliveredByRestaurant: false });
  const first = await prepareOwnDelivery(f.db, 'owner', ID);
  expect(first.order.status).toBe('READY');
  const second = await prepareOwnDelivery(f.db, 'owner', ID);
  expect(second.token.tokenStr).toBe(first.token.tokenStr);
  expect(f.history).toHaveLength(1);
});
test('a concurrent status/version change cannot create delivery history', async () => {
  const f = fixture(); f.db.order.updateMany.mockResolvedValueOnce({ count: 0 });
  await expect(ownDeliveryAction(f.db, TOKEN, 'start')).rejects.toMatchObject({ code: 'ORDER_STATE_CHANGED' });
  expect(f.history).toHaveLength(0); expect(f.order().status).toBe('READY');
});
test('start, location, arrival, CASH delivery: transactional and revoked after delivery', async () => {
  const f = fixture();
  expect((await ownDeliveryAction(f.db, TOKEN, 'start')).order.status).toBe('IN_TRANSIT');
  expect((await ownDeliveryAction(f.db, TOKEN, 'start')).changed).toBe(false);
  await expect(ownDeliveryAction(f.db, TOKEN, 'deliver', { cashReceived: true })).rejects.toMatchObject({ code: 'ARRIVAL_REQUIRED' });
  await ownDeliveryAction(f.db, TOKEN, 'location', { coords: [19.433, -99.134] });
  await expect(ownDeliveryAction(f.db, TOKEN, 'location', { coords: [100, 0] })).rejects.toMatchObject({ code: 'INVALID_COORDINATES' });
  await ownDeliveryAction(f.db, TOKEN, 'arrive');
  expect((await ownDeliveryAction(f.db, TOKEN, 'arrive')).changed).toBe(false);
  await expect(ownDeliveryAction(f.db, TOKEN, 'deliver')).rejects.toMatchObject({ code: 'CASH_CONFIRMATION_REQUIRED' });
  const delivered = await ownDeliveryAction(f.db, TOKEN, 'deliver', { cashReceived: true });
  expect(delivered.order.status).toBe('DELIVERED'); expect(delivered.order.paymentStatus).toBe('COMPLETED');
  expect(delivered.order.totalAmount).toBe(163);
  expect(f.history.map(h => h.status)).toEqual(['IN_TRANSIT', 'IN_TRANSIT', 'DELIVERED']);
  await expect(ownDeliveryAction(f.db, TOKEN, 'deliver', { cashReceived: true })).rejects.toMatchObject({ code: 'TOKEN_NOT_FOUND' });
});
test('card delivery requires the customer PIN and never collects cash', async () => {
  const f = fixture('IN_TRANSIT');
  f.setOrder({ paymentMethod: 'CREDIT_CARD', paymentStatus: 'COMPLETED', deliveryPin: '0042', driverArrivedAtCustomer: new Date() });
  await expect(ownDeliveryAction(f.db, TOKEN, 'deliver')).rejects.toMatchObject({ code: 'INVALID_PIN' });
  await expect(ownDeliveryAction(f.db, TOKEN, 'deliver', { pin: '9999' })).rejects.toMatchObject({ code: 'INVALID_PIN' });
  expect(f.order().status).toBe('IN_TRANSIT');
  const delivered = await ownDeliveryAction(f.db, TOKEN, 'deliver', { pin: '0042' });
  expect(delivered.order.status).toBe('DELIVERED');
  expect(delivered.order.paymentStatus).toBe('COMPLETED');
  expect(delivered.order.cashPaymentConfirmedAt).toBeUndefined();
});
test('failed history write rolls back order and token, preventing partial delivery', async () => {
  const f = fixture('IN_TRANSIT'); f.setOrder({ driverArrivedAtCustomer: new Date() });
  f.db.orderTracking.create.mockRejectedValueOnce(new Error('simulated failure'));
  await expect(ownDeliveryAction(f.db, TOKEN, 'deliver', { cashReceived: true })).rejects.toThrow('simulated failure');
  expect(f.order().status).toBe('IN_TRANSIT');expect(await resolveOwnTicket(f.db, TOKEN)).toBeTruthy();
});
test('closed/expired/wrong-mode tickets are refused without writes', async () => {
  const f = fixture('DELIVERED');
  await expect(resolveOwnTicket(f.db, TOKEN)).rejects.toMatchObject({ code: 'INVALID_ORDER_STATE' });
  f.setOrder({ status: 'READY', fulfillmentType: 'PICKUP' });
  await expect(resolveOwnTicket(f.db, TOKEN)).rejects.toMatchObject({ code: 'INVALID_DELIVERY_MODE' });
  expect(f.db.order.updateMany).not.toHaveBeenCalled();
});
