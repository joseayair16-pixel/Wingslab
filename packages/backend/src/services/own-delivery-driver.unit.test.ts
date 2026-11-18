import { DriverAvailability, DriverStatus, OrderStatus } from '@prisma/client';
import { claimOwnDeliveryByQr, ownDeliveryDriverAction } from './own-delivery.service';
import { hashToken } from '../utils/crypto';
import { RESTAURANT_ID } from '../config/single-restaurant';

const token = 'q'.repeat(43);
const userId = 'driver-user-1';
const driverId = 'own-driver-1';
const orderId = 'own-delivery-order-1';

function orderFixture(status: OrderStatus = OrderStatus.READY) {
  return {
    id: orderId,
    restaurantId: RESTAURANT_ID,
    status,
    updatedAt: new Date(1),
    fulfillmentType: 'DELIVERY',
    driverId: status === OrderStatus.READY ? null : driverId,
    driverCompensation: '47.25',
    supportRestaurantId: null,
    deliveredByRestaurant: true,
    paymentMethod: 'CASH',
    paymentStatus: 'PENDING',
    driverArrivedAtCustomer: status === OrderStatus.IN_TRANSIT ? new Date(2) : null,
    latitude: 19.43,
    longitude: -99.13,
    restaurant: { id: RESTAURANT_ID, userId: 'restaurant-user', hasOwnDelivery: true, latitude: 19.43, longitude: -99.13 },
    address: { street: 'Calle Uno', number: '10', neighborhood: 'Centro', latitude: 19.43, longitude: -99.13 },
    customer: { user: { id: 'customer-user', name: 'Cliente' } },
  };
}

function mockDb(order = orderFixture()) {
  const row = { id: 'delivery-ticket', orderId, token: hashToken(token), expiresAt: new Date(Date.now() + 60_000), order };
  const db: any = {
    $transaction: jest.fn(async (callback: (tx: any) => unknown) => callback(db)),
    deliveryToken: {
      findUnique: jest.fn().mockResolvedValue(row),
      delete: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    driver: {
      findFirst: jest.fn().mockResolvedValue({
        id: driverId,
        userId,
        restaurantId: RESTAURANT_ID,
        status: DriverStatus.ACTIVE,
        availability: DriverAvailability.AVAILABLE,
        deliveryCompensation: '55.00',
        user: { name: 'Alex' },
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    order: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn().mockResolvedValue(order),
      findUniqueOrThrow: jest.fn().mockResolvedValue(order),
      count: jest.fn().mockResolvedValue(0),
    },
    orderTracking: { create: jest.fn().mockResolvedValue({}) },
    driverEarning: { create: jest.fn().mockResolvedValue({}) },
    driverStats: { upsert: jest.fn().mockResolvedValue({}) },
  };
  return db;
}

describe('WingsLab QR claim and driver delivery actions', () => {
  it('claims a prepared QR only for an online active driver linked to the same restaurant', async () => {
    const db = mockDb();
    const result = await claimOwnDeliveryByQr(db, userId, token);

    expect(result.changed).toBe(true);
    expect(db.driver.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId, restaurantId: RESTAURANT_ID, status: DriverStatus.ACTIVE },
    }));
    expect(db.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: orderId, restaurantId: RESTAURANT_ID, status: OrderStatus.READY, driverId: null }),
      data: expect.objectContaining({ driverId, isAcceptedByDriver: true }),
    }));
  });

  it('rejects an offline driver or an expired/unmatched restaurant QR without claiming', async () => {
    const db = mockDb();
    db.driver.findFirst.mockResolvedValueOnce({
      id: driverId,
      userId,
      restaurantId: RESTAURANT_ID,
      status: DriverStatus.ACTIVE,
      availability: DriverAvailability.OFFLINE,
      deliveryCompensation: '55.00',
      user: { name: 'Alex' },
    });
    await expect(claimOwnDeliveryByQr(db, userId, token)).rejects.toMatchObject({ code: 'DRIVER_OFFLINE' });
    expect(db.order.updateMany).not.toHaveBeenCalled();
  });

  it('counts a completed delivery without creating a payment balance', async () => {
    const db = mockDb(orderFixture(OrderStatus.IN_TRANSIT));
    const result = await ownDeliveryDriverAction(db, userId, orderId, 'deliver', { cashReceived: true });

    expect(result.changed).toBe(true);
    expect(db.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: OrderStatus.DELIVERED }) }));
    expect(db.driverEarning.create).not.toHaveBeenCalled();
    expect(db.driver.update).toHaveBeenCalledWith({ where: { id: driverId }, data: { totalDeliveries: { increment: 1 } } });
    expect(db.driver.update).toHaveBeenLastCalledWith({ where: { id: driverId }, data: { availability: DriverAvailability.AVAILABLE } });
  });

  it('does not create earnings or mark an order delivered after a concurrent state change', async () => {
    const db = mockDb(orderFixture(OrderStatus.IN_TRANSIT));
    db.order.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(ownDeliveryDriverAction(db, userId, orderId, 'deliver', { cashReceived: true }))
      .rejects.toMatchObject({ code: 'ORDER_STATE_CHANGED' });
    expect(db.driverEarning.create).not.toHaveBeenCalled();
  });
});
