import crypto from 'node:crypto';
import bcryptjs from 'bcryptjs';
import { DriverAvailability, DriverStatus, OrderStatus, UserRole } from '@prisma/client';

import { prisma } from '../config/database';
import { AppError } from '../errors/app-error';
import { RESTAURANT_ID } from '../config/single-restaurant';
import { getOrCreateDeliveryToken } from './delivery-token.service';

type DriverInput = {
  name: string;
  lastName?: string;
  phone: string;
  email: string;
  deliveryCompensation?: number;
};

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '').slice(-10);
}

function asMoney(value: unknown): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

async function restaurantForOwner(db: any, userId: string) {
  const restaurant = await db.restaurant.findFirst({
    where: { id: RESTAURANT_ID, userId, hasOwnDelivery: true },
    select: { id: true, region: true, status: true },
  });
  if (!restaurant) throw new AppError(404, 'RESTAURANT_NOT_FOUND', 'No se encontró el restaurante propio.');
  if (restaurant.status !== 'ACTIVE') throw new AppError(403, 'RESTAURANT_NOT_OPERABLE', 'El restaurante no está activo.');
  return restaurant;
}

export async function listRestaurantDrivers(db: any, restaurantUserId: string) {
  const restaurant = await restaurantForOwner(db, restaurantUserId);
  const [drivers, pendingByDriver, paidByDriver] = await Promise.all([
    db.driver.findMany({
      where: { restaurantId: restaurant.id },
      select: {
        id: true,
        status: true,
        availability: true,
        totalDeliveries: true,
        deliveryCompensation: true,
        createdAt: true,
        user: { select: { id: true, name: true, lastName: true, phone: true, email: true, profilePhoto: true } },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    }),
    db.driverEarning.groupBy({
      by: ['driverId'],
      where: { restaurantId: restaurant.id, payoutId: null },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.driverPayout.groupBy({
      by: ['driverId'],
      where: { restaurantId: restaurant.id },
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ]);

  const pending = new Map<string, { amount: number; deliveries: number }>();
  for (const row of pendingByDriver) {
    pending.set(row.driverId, { amount: asMoney(row._sum.amount), deliveries: row._count._all });
  }
  const paid = new Map<string, { amount: number; payouts: number }>();
  for (const row of paidByDriver) {
    paid.set(row.driverId, { amount: asMoney(row._sum.amount), payouts: row._count._all });
  }

  return drivers.map((driver: any) => ({
    ...driver,
    deliveryCompensation: asMoney(driver.deliveryCompensation),
    balance: {
      pending: pending.get(driver.id)?.amount ?? 0,
      pendingDeliveries: pending.get(driver.id)?.deliveries ?? 0,
      paid: paid.get(driver.id)?.amount ?? 0,
      payouts: paid.get(driver.id)?.payouts ?? 0,
    },
  }));
}

export async function createRestaurantDriver(db: any, restaurantUserId: string, input: DriverInput) {
  const restaurant = await restaurantForOwner(db, restaurantUserId);
  const phone = normalizePhone(input.phone);
  const email = input.email.trim().toLowerCase();
  if (!/^\d{10}$/.test(phone)) throw new AppError(400, 'INVALID_PHONE', 'Ingresa un teléfono mexicano de 10 dígitos.');
  if (input.deliveryCompensation !== undefined && (!Number.isFinite(input.deliveryCompensation) || input.deliveryCompensation <= 0)) {
    throw new AppError(400, 'INVALID_COMPENSATION', 'La compensación por entrega debe ser mayor a cero.');
  }

  const temporaryPassword = crypto.randomBytes(18).toString('base64url');
  try {
    const driver = await db.$transaction(async (tx: any) => {
      for (const lockKey of [`own-driver-phone:${phone}`, `own-driver-email:${email}`].sort()) {
        await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', lockKey);
      }
      const duplicate = await tx.user.findFirst({
        where: {
          OR: [
            { phoneNormalized: phone, role: UserRole.DRIVER },
            { email: { equals: email, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      });
      if (duplicate) throw new AppError(409, 'DRIVER_ACCOUNT_EXISTS', 'El teléfono o correo ya está asociado a una cuenta.');

      const user = await tx.user.create({
        data: {
          email,
          password: await bcryptjs.hash(temporaryPassword, 12),
          phone,
          phoneNormalized: phone,
          name: input.name.trim(),
          lastName: input.lastName?.trim() || null,
          role: UserRole.DRIVER,
          region: restaurant.region,
          status: 'ACTIVE',
          mustChangePassword: true,
        },
        select: { id: true },
      });

      return tx.driver.create({
        data: {
          userId: user.id,
          restaurantId: restaurant.id,
          region: restaurant.region,
          status: DriverStatus.ACTIVE,
          availability: DriverAvailability.OFFLINE,
          documentNumber: null,
          documentType: null,
          deliveryCompensation: (input.deliveryCompensation ?? 0).toFixed(2),
        },
        select: {
          id: true,
          status: true,
          availability: true,
          deliveryCompensation: true,
          createdAt: true,
          user: { select: { id: true, name: true, lastName: true, phone: true } },
        },
      });
    });

    return { driver: { ...driver, deliveryCompensation: asMoney(driver.deliveryCompensation) }, temporaryPassword };
  } catch (error: any) {
    if (error?.code === 'P2002') {
      throw new AppError(409, 'DRIVER_ACCOUNT_EXISTS', 'El teléfono o correo ya está asociado a una cuenta.');
    }
    throw error;
  }
}

export async function updateRestaurantDriver(
  db: any,
  restaurantUserId: string,
  driverId: string,
  input: { status?: 'ACTIVE' | 'INACTIVE'; deliveryCompensation?: number },
) {
  const restaurant = await restaurantForOwner(db, restaurantUserId);
  return db.$transaction(async (tx: any) => {
    const driver = await tx.driver.findFirst({
      where: { id: driverId, restaurantId: restaurant.id },
      select: { id: true, status: true, availability: true },
    });
    if (!driver) throw new AppError(404, 'DRIVER_NOT_FOUND', 'No se encontró el repartidor del restaurante.');

    if (input.deliveryCompensation !== undefined &&
      (!Number.isFinite(input.deliveryCompensation) || input.deliveryCompensation <= 0)) {
      throw new AppError(400, 'INVALID_COMPENSATION', 'La compensación por entrega debe ser mayor a cero.');
    }

    let availability = driver.availability;
    if (input.status === 'INACTIVE') {
      const activeOrders = await tx.order.count({
        where: {
          restaurantId: restaurant.id,
          driverId: driver.id,
          status: { in: [OrderStatus.READY, OrderStatus.PICKED_UP, OrderStatus.IN_TRANSIT] },
        },
      });
      if (activeOrders > 0) throw new AppError(409, 'DRIVER_HAS_ACTIVE_DELIVERIES', 'No se puede desactivar mientras tenga entregas activas.');
      availability = DriverAvailability.OFFLINE;
    }

    return tx.driver.update({
      where: { id: driver.id },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.deliveryCompensation !== undefined
          ? { deliveryCompensation: input.deliveryCompensation.toFixed(2) }
          : {}),
        ...(input.status === 'INACTIVE' ? { availability } : {}),
      },
      select: {
        id: true,
        status: true,
        availability: true,
        deliveryCompensation: true,
        user: { select: { id: true, name: true, lastName: true, phone: true } },
      },
    });
  });
}

export async function assignOwnDriverToOrder(
  db: any,
  restaurantUserId: string,
  orderId: string,
  driverId: string,
) {
  const restaurant = await restaurantForOwner(db, restaurantUserId);
  return db.$transaction(async (tx: any) => {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `own-driver-assignment:${orderId}`);
    const order = await tx.order.findFirst({
      where: { id: orderId, restaurantId: restaurant.id },
      select: {
        id: true,
        status: true,
        fulfillmentType: true,
        driverId: true,
        updatedAt: true,
        supportRestaurantId: true,
        restaurant: { select: { id: true, userId: true, hasOwnDelivery: true } },
      },
    });
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'No se encontró el pedido de este restaurante.');
    if (order.supportRestaurantId || !order.restaurant.hasOwnDelivery || order.fulfillmentType !== 'DELIVERY') {
      throw new AppError(409, 'OWN_DELIVERY_REQUIRED', 'Solo se asignan entregas a domicilio propias.');
    }
    if (order.status !== OrderStatus.READY) throw new AppError(409, 'ORDER_NOT_READY', 'El pedido debe estar listo antes de asignar repartidor.');
    if (order.driverId) throw new AppError(409, 'DRIVER_ALREADY_ASSIGNED', 'El pedido ya tiene un repartidor asignado.');

    const driver = await tx.driver.findFirst({
      where: {
        id: driverId,
        restaurantId: restaurant.id,
        status: DriverStatus.ACTIVE,
        availability: { in: [DriverAvailability.AVAILABLE, DriverAvailability.BUSY] },
      },
      select: { id: true, userId: true, availability: true, deliveryCompensation: true },
    });
    if (!driver) throw new AppError(409, 'DRIVER_NOT_AVAILABLE', 'El repartidor no está activo o no pertenece a este restaurante.');

    const token = await getOrCreateDeliveryToken(tx, order.id);
    const now = new Date();
    const assigned = await tx.order.updateMany({
      where: {
        id: order.id,
        restaurantId: restaurant.id,
        status: OrderStatus.READY,
        driverId: null,
        updatedAt: order.updatedAt,
      },
      data: {
        deliveredByRestaurant: true,
        driverId: driver.id,
        driverAssignedAt: now,
        isAcceptedByDriver: true,
      },
    });
    if (assigned.count !== 1) throw new AppError(409, 'ORDER_ALREADY_ASSIGNED', 'El pedido cambió o ya fue asignado. Actualiza la pantalla.');

    await tx.driver.update({ where: { id: driver.id }, data: { availability: DriverAvailability.BUSY } });
    await tx.orderTracking.create({
      data: { orderId: order.id, status: order.status, notes: 'Entrega asignada por el restaurante a un repartidor propio.' },
    });

    const updatedOrder = await tx.order.findUniqueOrThrow({
      where: { id: order.id },
      include: {
        restaurant: { select: { id: true, userId: true, name: true } },
        customer: { select: { user: { select: { id: true, name: true } } } },
        driver: { select: { id: true, userId: true, user: { select: { id: true, name: true } } } },
      },
    });
    return { order: updatedOrder, token };
  });
}

export async function payPendingDriverEarnings(
  db: any,
  restaurantUserId: string,
  driverId: string,
  notes?: string,
) {
  const restaurant = await restaurantForOwner(db, restaurantUserId);
  return db.$transaction(async (tx: any) => {
    const driver = await tx.driver.findFirst({
      where: { id: driverId, restaurantId: restaurant.id },
      select: { id: true },
    });
    if (!driver) throw new AppError(404, 'DRIVER_NOT_FOUND', 'No se encontró el repartidor del restaurante.');

    const earnings = await tx.driverEarning.findMany({
      where: { driverId, restaurantId: restaurant.id, payoutId: null },
      select: { id: true, amount: true },
      orderBy: { earnedAt: 'asc' },
    });
    if (!earnings.length) throw new AppError(409, 'NO_PENDING_EARNINGS', 'No hay entregas pendientes de pago.');

    const totalCents = earnings.reduce((sum: number, earning: any) => sum + Math.round(asMoney(earning.amount) * 100), 0);
    if (totalCents <= 0) throw new AppError(409, 'INVALID_EARNINGS_TOTAL', 'El saldo pendiente no es válido.');

    const reference = `WL-PAY-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const payout = await tx.driverPayout.create({
      data: {
        driverId,
        restaurantId: restaurant.id,
        reference,
        amount: (totalCents / 100).toFixed(2),
        notes: notes?.trim() || null,
      },
    });
    const claimed = await tx.driverEarning.updateMany({
      where: { id: { in: earnings.map((earning: any) => earning.id) }, payoutId: null },
      data: { payoutId: payout.id },
    });
    if (claimed.count !== earnings.length) {
      throw new AppError(409, 'EARNINGS_ALREADY_PAID', 'El saldo cambió durante la operación; actualiza y vuelve a consultar.');
    }
    return { ...payout, amount: asMoney(payout.amount), deliveries: earnings.length };
  });
}

export async function getOwnedDriver(db: any, userId: string) {
  const driver = await db.driver.findFirst({
    where: { userId, restaurantId: RESTAURANT_ID },
    select: {
      id: true,
      restaurantId: true,
      region: true,
      status: true,
      availability: true,
      totalDeliveries: true,
      deliveryCompensation: true,
      user: { select: { id: true, role: true, name: true, lastName: true, phone: true, profilePhoto: true, mustChangePassword: true } },
    },
  });
  if (!driver || driver.status !== DriverStatus.ACTIVE) {
    throw new AppError(403, 'DRIVER_NOT_ACTIVE', 'El perfil de repartidor no está activo para WingsLab.');
  }
  return driver;
}

export async function getOwnDriverBalance(db: any, driverId: string) {
  const [pending, paid, payouts] = await Promise.all([
    db.driverEarning.aggregate({
      where: { driverId, restaurantId: RESTAURANT_ID, payoutId: null },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.driverPayout.aggregate({
      where: { driverId, restaurantId: RESTAURANT_ID },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.driverPayout.findMany({
      where: { driverId, restaurantId: RESTAURANT_ID },
      select: { id: true, reference: true, amount: true, notes: true, paidAt: true },
      orderBy: { paidAt: 'desc' },
      take: 20,
    }),
  ]);
  return {
    pending: asMoney(pending._sum.amount),
    pendingDeliveries: pending._count._all,
    paid: asMoney(paid._sum.amount),
    payoutCount: paid._count._all,
    payouts: payouts.map((payout: any) => ({ ...payout, amount: asMoney(payout.amount) })),
  };
}
