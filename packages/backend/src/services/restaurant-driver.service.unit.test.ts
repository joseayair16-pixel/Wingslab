import { DriverAvailability, DriverStatus, OrderStatus } from '@prisma/client';
import {
  assignOwnDriverToOrder,
  createRestaurantDriver,
  payPendingDriverEarnings,
  updateRestaurantDriver,
} from './restaurant-driver.service';
import { RESTAURANT_ID } from '../config/single-restaurant';

const ownerId = 'restaurant-owner';
const driverId = 'own-driver-1';

function restaurantRow() {
  return { id: RESTAURANT_ID, region: 'WingsLab', status: 'ACTIVE' };
}

function baseDb(transaction: any) {
  return {
    restaurant: { findFirst: jest.fn().mockResolvedValue(restaurantRow()) },
    $transaction: jest.fn(async (callback: (tx: any) => unknown) => callback(transaction)),
  } as any;
}

describe('restaurant-owned driver management', () => {
  it('creates an account without requiring a delivery rate', async () => {
    const tx = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      user: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'user-driver-1' }) },
      driver: { create: jest.fn().mockResolvedValue({ id: driverId, deliveryCompensation: '0.00' }) },
    };
    await createRestaurantDriver(baseDb(tx), ownerId, { name: 'Alex', phone: '5512345678', email: 'alex@example.mx' });
    expect(tx.driver.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ deliveryCompensation: '0.00' }) }));
  });
  it('creates a WingsLab-only account with an unpredictable temporary password and required rotation', async () => {
    const driver = { id: driverId, status: DriverStatus.ACTIVE, availability: DriverAvailability.OFFLINE, deliveryCompensation: '52.50' };
    const tx = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'user-driver-1' }),
      },
      driver: { create: jest.fn().mockResolvedValue(driver) },
    };
    const db = baseDb(tx);

    const result = await createRestaurantDriver(db, ownerId, {
      name: 'Alex', lastName: 'Rivera', phone: '+52 55 1234 5678', email: ' ALEX@EXAMPLE.MX ', deliveryCompensation: 52.5,
    });

    expect(result.driver).toMatchObject({ id: driverId, deliveryCompensation: 52.5 });
    expect(result.temporaryPassword).toHaveLength(24);
    expect(tx.$executeRawUnsafe).toHaveBeenCalledTimes(2);
    expect(tx.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      email: 'alex@example.mx',
      phone: '5512345678',
      phoneNormalized: '5512345678',
      role: 'DRIVER',
      mustChangePassword: true,
    }) }));
    expect(tx.driver.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      restaurantId: RESTAURANT_ID,
      status: DriverStatus.ACTIVE,
      availability: DriverAvailability.OFFLINE,
      deliveryCompensation: '52.50',
    }) }));
    expect(JSON.stringify(tx.user.create.mock.calls)).not.toContain(result.temporaryPassword);
  });

  it('rejects duplicate accounts before creating a user or driver', async () => {
    const tx = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'existing-account' }), create: jest.fn() },
      driver: { create: jest.fn() },
    };
    const db = baseDb(tx);

    await expect(createRestaurantDriver(db, ownerId, {
      name: 'Alex', phone: '5512345678', email: 'alex@example.mx', deliveryCompensation: 50,
    })).rejects.toMatchObject({ code: 'DRIVER_ACCOUNT_EXISTS' });
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.driver.create).not.toHaveBeenCalled();
  });

  it('cannot deactivate a driver who still owns an active delivery', async () => {
    const tx = {
      driver: { findFirst: jest.fn().mockResolvedValue({ id: driverId, status: DriverStatus.ACTIVE, availability: DriverAvailability.BUSY }), update: jest.fn() },
      order: { count: jest.fn().mockResolvedValue(1) },
    };
    const db = baseDb(tx);

    await expect(updateRestaurantDriver(db, ownerId, driverId, { status: 'INACTIVE' }))
      .rejects.toMatchObject({ code: 'DRIVER_HAS_ACTIVE_DELIVERIES' });
    expect(tx.driver.update).not.toHaveBeenCalled();
  });

  it('assigns only an active driver from the owning restaurant', async () => {
    const order = {
      id: 'ready-delivery', status: OrderStatus.READY, fulfillmentType: 'DELIVERY', driverId: null,
      updatedAt: new Date(1), supportRestaurantId: null,
      restaurant: { id: RESTAURANT_ID, userId: ownerId, hasOwnDelivery: true },
      orderReference: 'WL-010',
    };
    const tx = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      order: {
        findFirst: jest.fn().mockResolvedValue(order),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ ...order, driverId, driver: { id: driverId, userId: 'driver-user', user: { name: 'Alex' } } }),
      },
      driver: {
        findFirst: jest.fn().mockResolvedValue({ id: driverId, userId: 'driver-user', availability: DriverAvailability.AVAILABLE, deliveryCompensation: '52.50' }),
        update: jest.fn(),
      },
      deliveryToken: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
      orderTracking: { create: jest.fn().mockResolvedValue({}) },
    };
    const db = baseDb(tx);
    process.env.DATABASE_ENCRYPTION_KEY = 'restaurant-driver-unit-test-secret';

    const result = await assignOwnDriverToOrder(db, ownerId, order.id, driverId);

    expect(result.order.driverId).toBe(driverId);
    expect(result.token.tokenStr).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tx.driver.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      id: driverId, restaurantId: RESTAURANT_ID, status: DriverStatus.ACTIVE,
      availability: { in: [DriverAvailability.AVAILABLE, DriverAvailability.BUSY] },
    }) }));
    expect(tx.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      driverId, deliveredByRestaurant: true,
    }) }));
  });

  it('rejects assignment to an unrelated driver without touching the order', async () => {
    const tx = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      order: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'ready-delivery', status: OrderStatus.READY, fulfillmentType: 'DELIVERY', driverId: null,
          updatedAt: new Date(1), supportRestaurantId: null,
          restaurant: { id: RESTAURANT_ID, userId: ownerId, hasOwnDelivery: true },
        }),
        updateMany: jest.fn(),
      },
      driver: { findFirst: jest.fn().mockResolvedValue(null) },
      deliveryToken: { findUnique: jest.fn(), create: jest.fn() },
    };
    const db = baseDb(tx);

    await expect(assignOwnDriverToOrder(db, ownerId, 'ready-delivery', 'foreign-driver'))
      .rejects.toMatchObject({ code: 'DRIVER_NOT_AVAILABLE' });
    expect(tx.deliveryToken.create).not.toHaveBeenCalled();
    expect(tx.order.updateMany).not.toHaveBeenCalled();
  });

  it('records one restaurant payout for exactly the pending earnings', async () => {
    const tx = {
      driver: { findFirst: jest.fn().mockResolvedValue({ id: driverId }) },
      driverEarning: {
        findMany: jest.fn().mockResolvedValue([{ id: 'earning-1', amount: '42.50' }, { id: 'earning-2', amount: '37.25' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      driverPayout: { create: jest.fn().mockImplementation(async ({ data }) => ({ id: 'payout-1', ...data, paidAt: new Date() })) },
    };
    const db = baseDb(tx);

    const payout = await payPendingDriverEarnings(db, ownerId, driverId, 'Transferencia hecha');

    expect(payout).toMatchObject({ id: 'payout-1', amount: 79.75, deliveries: 2, notes: 'Transferencia hecha' });
    expect(payout.reference).toMatch(/^WL-PAY-\d{8}-[A-F0-9]{8}$/);
    expect(tx.driverEarning.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['earning-1', 'earning-2'] }, payoutId: null },
      data: { payoutId: 'payout-1' },
    }));
  });

  it('rolls a payout back when another operation already claimed an earning', async () => {
    const tx = {
      driver: { findFirst: jest.fn().mockResolvedValue({ id: driverId }) },
      driverEarning: {
        findMany: jest.fn().mockResolvedValue([{ id: 'earning-1', amount: '20.00' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      driverPayout: { create: jest.fn().mockResolvedValue({ id: 'payout-1' }) },
    };
    const db = baseDb(tx);

    await expect(payPendingDriverEarnings(db, ownerId, driverId))
      .rejects.toMatchObject({ code: 'EARNINGS_ALREADY_PAID' });
  });

  it('does not create an empty payout', async () => {
    const tx = {
      driver: { findFirst: jest.fn().mockResolvedValue({ id: driverId }) },
      driverEarning: { findMany: jest.fn().mockResolvedValue([]) },
      driverPayout: { create: jest.fn() },
    };
    const db = baseDb(tx);
    await expect(payPendingDriverEarnings(db, ownerId, driverId)).rejects.toMatchObject({ code: 'NO_PENDING_EARNINGS' });
    expect(tx.driverPayout.create).not.toHaveBeenCalled();
  });
});
