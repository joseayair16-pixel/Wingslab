import { AppError } from '../errors/app-error';
import { hashToken } from '../utils/crypto';
import { getOrCreateDeliveryToken } from './delivery-token.service';
import { computeInTransitEta } from './order-workflow.service';
import { DriverAvailability, DriverStatus, OrderStatus, PaymentMethod, PaymentStatus } from '@prisma/client';
import { RESTAURANT_ID } from '../config/single-restaurant';
import { driverActiveOrderListSelect } from './order-selects';

// Never return a raw `include` here: `customer.user` would carry the password
// hash and the whole User row into HTTP responses. This select is the reviewed
// driver-facing projection; it keeps only operational fields.
const include = driverActiveOrderListSelect;
function allowed(order: any, allowAssignedDriver = false) {
  if (!order) throw new AppError(404, 'DELIVERY_NOT_AUTHORIZED', 'Pedido de reparto propio no encontrado.');
  if (!order.restaurant.hasOwnDelivery || order.fulfillmentType !== 'DELIVERY' ||
      (!allowAssignedDriver && order.driverId) || order.supportRestaurantId) {
    throw new AppError(409, 'INVALID_DELIVERY_MODE', 'Este enlace solo admite reparto propio.');
  }
  if (!['READY', 'IN_TRANSIT'].includes(order.status)) throw new AppError(409, 'INVALID_ORDER_STATE', 'El pedido no está disponible para reparto.');
}
export async function resolveOwnTicket(db: any, token: string, options: { allowAssignedDriver?: boolean } = {}) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new AppError(404, 'TOKEN_NOT_FOUND', 'Enlace de reparto no válido.');
  const row = await db.deliveryToken.findUnique({ where: { token: hashToken(token) }, include: { order: { include } } });
  if (!row) throw new AppError(404, 'TOKEN_NOT_FOUND', 'El enlace de reparto ya no está disponible.');
  if (new Date(row.expiresAt) <= new Date()) throw new AppError(410, 'TOKEN_EXPIRED', 'El enlace de reparto venció.');
  allowed(row.order, options.allowAssignedDriver === true);
  if (!row.order.deliveredByRestaurant) throw new AppError(409, 'DELIVERY_NOT_PREPARED', 'El restaurante aún no asignó el reparto propio.');
  return row;
}
export async function prepareOwnDelivery(db: any, restaurantUserId: string, orderId: string) {
  return db.$transaction(async (tx: any) => {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `own-delivery:${orderId}`);
    const order = await tx.order.findFirst({ where: { id: orderId, restaurant: { userId: restaurantUserId } }, include });
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Pedido no encontrado para tu restaurante.');
    allowed(order);
    if (order.status !== 'READY') throw new AppError(409, 'INVALID_ORDER_STATE', 'Marca el pedido listo antes de generar el QR.');
    const token = await getOrCreateDeliveryToken(tx, orderId);
    if (!order.deliveredByRestaurant) {
      await tx.order.update({ where: { id: orderId }, data: { deliveredByRestaurant: true } });
      await tx.orderTracking.create({ data: { orderId, status: 'READY', notes: 'Reparto propio asignado mediante QR.' } });
    }
    return { order: await tx.order.findUniqueOrThrow({ where: { id: orderId }, include }), token };
  });
}

export async function ownDeliveryAction(db: any, token: string, action: 'start' | 'arrive' | 'location' | 'deliver', body: any = {}) {
  return db.$transaction(async (tx: any) => {
    const row = await resolveOwnTicket(tx, token);
    return applyOwnDeliveryAction(tx, row.order, action, body, null, row.id);
  });
}

export async function completeUnassignedOwnDeliveryByRestaurant(
  db: any,
  restaurantUserId: string,
  orderId: string,
  body: { pin?: string; cashReceived?: boolean } = {},
) {
  return db.$transaction(async (tx: any) => {
    const order = await tx.order.findFirst({
      where: { id: orderId, restaurant: { userId: restaurantUserId } },
      include,
    });
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'No se encontró el pedido de este restaurante.');
    allowed(order);
    if (!order.deliveredByRestaurant) throw new AppError(409, 'DELIVERY_NOT_PREPARED', 'El restaurante aún no preparó el reparto propio.');
    if (order.status !== OrderStatus.IN_TRANSIT) throw new AppError(409, 'INVALID_ORDER_STATE', 'El pedido debe estar en camino para confirmar la entrega.');
    if (!order.driverArrivedAtCustomer) throw new AppError(409, 'ARRIVAL_REQUIRED', 'Registra primero la llegada al domicilio desde el QR de reparto.');
    if (order.paymentMethod === PaymentMethod.CASH && body.cashReceived !== true) {
      throw new AppError(400, 'CASH_CONFIRMATION_REQUIRED', 'Confirma que recibiste el efectivo del cliente.');
    }
    if (order.paymentMethod !== PaymentMethod.CASH && (!order.deliveryPin || body.pin !== order.deliveryPin)) {
      throw new AppError(400, 'INVALID_PIN', 'El PIN del cliente no es correcto.');
    }

    const now = new Date();
    const updated = await tx.order.updateMany({
      where: {
        id: order.id,
        restaurantId: order.restaurantId,
        driverId: null,
        status: OrderStatus.IN_TRANSIT,
        deliveredByRestaurant: true,
        updatedAt: order.updatedAt,
      },
      data: {
        status: OrderStatus.DELIVERED,
        deliveredAt: now,
        actualDeliveryTime: now,
        estimatedDeliveryTime: now,
        ...(order.paymentMethod === PaymentMethod.CASH
          ? { paymentStatus: PaymentStatus.COMPLETED, cashPaymentConfirmedAt: now }
          : {}),
      },
    });
    if (updated.count !== 1) throw new AppError(409, 'ORDER_STATE_CHANGED', 'El pedido cambió. Consulta su estado antes de volver a intentarlo.');

    await tx.orderTracking.create({ data: { orderId: order.id, status: OrderStatus.DELIVERED, notes: 'Entrega propia confirmada por el restaurante con validación del domicilio y pago.' } });
    await tx.deliveryToken.deleteMany({ where: { orderId: order.id } });
    return tx.order.findUniqueOrThrow({ where: { id: order.id }, include });
  });
}

export async function claimOwnDeliveryByQr(db: any, driverUserId: string, token: string) {
  return db.$transaction(async (tx: any) => {
    const row = await resolveOwnTicket(tx, token, { allowAssignedDriver: true });
    const order = row.order;
    const driver = await tx.driver.findFirst({
      where: { userId: driverUserId, restaurantId: order.restaurantId, status: DriverStatus.ACTIVE },
      select: { id: true, userId: true, restaurantId: true, status: true, availability: true, deliveryCompensation: true, user: { select: { name: true } } },
    });
    if (!driver || order.restaurantId !== RESTAURANT_ID) {
      throw new AppError(403, 'DRIVER_RESTAURANT_MISMATCH', 'Este QR no pertenece al restaurante que te dio de alta.');
    }
    if (![DriverAvailability.AVAILABLE, DriverAvailability.BUSY].includes(driver.availability)) {
      throw new AppError(409, 'DRIVER_OFFLINE', 'Conéctate para recibir una entrega por QR.');
    }
    if (order.status !== OrderStatus.READY && order.driverId !== driver.id) {
      throw new AppError(409, 'INVALID_ORDER_STATE', 'Solo se puede reclamar un pedido listo para reparto.');
    }
    if (order.driverId === driver.id) return { order, changed: false, driverName: driver.user.name };
    if (order.driverId) throw new AppError(409, 'ORDER_ALREADY_ASSIGNED', 'Este pedido ya fue asignado a otro repartidor.');

    const now = new Date();
    const claimed = await tx.order.updateMany({
      where: {
        id: order.id,
        restaurantId: driver.restaurantId,
        status: OrderStatus.READY,
        driverId: null,
        deliveredByRestaurant: true,
        updatedAt: order.updatedAt,
      },
      data: { driverId: driver.id, driverAssignedAt: now, isAcceptedByDriver: true },
    });
    if (claimed.count !== 1) throw new AppError(409, 'ORDER_ALREADY_ASSIGNED', 'El pedido cambió o ya fue reclamado. Actualiza tu panel.');

    await tx.driver.update({ where: { id: driver.id }, data: { availability: DriverAvailability.BUSY } });
    await tx.orderTracking.create({ data: { orderId: order.id, status: order.status, notes: 'Repartidor propio reclamó el QR desde WingsLab.' } });
    return { order: await tx.order.findUniqueOrThrow({ where: { id: order.id }, include }), changed: true, driverName: driver.user.name };
  });
}

export async function ownDeliveryDriverAction(
  db: any,
  driverUserId: string,
  orderId: string,
  action: 'start' | 'arrive' | 'location' | 'deliver',
  body: any = {},
) {
  return db.$transaction(async (tx: any) => {
    const driver = await tx.driver.findFirst({
      where: { userId: driverUserId, restaurantId: RESTAURANT_ID, status: DriverStatus.ACTIVE },
      select: { id: true, userId: true, restaurantId: true, deliveryCompensation: true },
    });
    if (!driver) throw new AppError(403, 'DRIVER_NOT_ACTIVE', 'El perfil de repartidor no está activo.');

    const order = await tx.order.findFirst({
      where: {
        id: orderId,
        restaurantId: driver.restaurantId,
        driverId: driver.id,
        deliveredByRestaurant: true,
        fulfillmentType: 'DELIVERY',
        supportRestaurantId: null,
        status: { in: [OrderStatus.READY, OrderStatus.IN_TRANSIT] },
      },
      include,
    });
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'No se encontró una entrega activa asignada a este repartidor.');
    return applyOwnDeliveryAction(tx, order, action, body, driver, null);
  });
}

async function applyOwnDeliveryAction(
  tx: any,
  order: any,
  action: 'start' | 'arrive' | 'location' | 'deliver',
  body: any,
  driver: { id: string; restaurantId: string; deliveryCompensation: any } | null,
  tokenRecordId: string | null,
) {
  allowed(order, driver !== null);
  if (driver && (order.driverId !== driver.id || order.restaurantId !== driver.restaurantId)) {
    throw new AppError(403, 'ORDER_NOT_ASSIGNED', 'Este pedido no está asignado a este repartidor.');
  }
  const now = new Date();
  const where = {
    id: order.id,
    restaurantId: order.restaurantId,
    status: order.status,
    updatedAt: order.updatedAt,
    ...(driver ? { driverId: driver.id } : { driverId: null }),
  };
  let data: any;
  let note: string | undefined;
  if (action === 'start') {
    if (order.status === OrderStatus.IN_TRANSIT) return { order, changed: false };
    data = {
      status: OrderStatus.IN_TRANSIT,
      pickedUpAt: now,
      inTransitAt: now,
      estimatedDeliveryTime: computeInTransitEta(order.restaurant, order),
    };
    note = 'Pedido recogido. Reparto propio en camino.';
  } else {
    if (order.status !== OrderStatus.IN_TRANSIT) throw new AppError(409, 'INVALID_ORDER_STATE', 'Primero recoge el pedido e inicia el reparto.');
    if (action === 'location') {
      const [lat, lng] = Array.isArray(body.coords) ? body.coords : [];
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        throw new AppError(400, 'INVALID_COORDINATES', 'Coordenadas no válidas.');
      }
      data = { lastDriverLatitude: lat, lastDriverLongitude: lng, lastDriverLocationAt: now };
    } else if (action === 'arrive') {
      if (order.driverArrivedAtCustomer) return { order, changed: false };
      data = { driverArrivedAtCustomer: now };
      note = 'DRIVER_ARRIVED';
    } else {
      if (!order.driverArrivedAtCustomer) throw new AppError(409, 'ARRIVAL_REQUIRED', 'Registra primero la llegada al domicilio.');
      if (order.paymentMethod === PaymentMethod.CASH && body.cashReceived !== true) {
        throw new AppError(400, 'CASH_CONFIRMATION_REQUIRED', 'Confirma que recibiste el efectivo del cliente.');
      }
      if (order.paymentMethod !== PaymentMethod.CASH && (!order.deliveryPin || body.pin !== order.deliveryPin)) {
        throw new AppError(400, 'INVALID_PIN', 'El PIN del cliente no es correcto.');
      }
      data = {
        status: OrderStatus.DELIVERED,
        deliveredAt: now,
        actualDeliveryTime: now,
        estimatedDeliveryTime: now,
        ...(order.paymentMethod === PaymentMethod.CASH
          ? { paymentStatus: PaymentStatus.COMPLETED, cashPaymentConfirmedAt: now }
          : {}),
      };
      note = 'Entrega confirmada por el repartidor propio.';
    }
  }

  const updated = await tx.order.updateMany({ where, data });
  if (updated.count !== 1) throw new AppError(409, 'ORDER_STATE_CHANGED', 'El pedido cambió. Consulta su estado antes de repetir.');
  if (note) await tx.orderTracking.create({ data: { orderId: order.id, status: data.status || order.status, notes: note } });

  if (action === 'deliver' && driver) {
    await tx.driver.update({ where: { id: driver.id }, data: { totalDeliveries: { increment: 1 } } });
    await tx.driverStats.upsert({
      where: { driverId: driver.id },
      update: { totalDeliveries: { increment: 1 } },
      create: { driverId: driver.id, totalDeliveries: 1 },
    });
    const activeCount = await tx.order.count({
      where: {
        driverId: driver.id,
        id: { not: order.id },
        status: { in: [OrderStatus.READY, OrderStatus.IN_TRANSIT] },
      },
    });
    if (activeCount === 0) {
      await tx.driver.update({ where: { id: driver.id }, data: { availability: DriverAvailability.AVAILABLE } });
    }
  }

  if (action === 'deliver') {
    if (tokenRecordId) await tx.deliveryToken.delete({ where: { id: tokenRecordId } });
    else await tx.deliveryToken.deleteMany({ where: { orderId: order.id } });
  }

  return { order: await tx.order.findUniqueOrThrow({ where: { id: order.id }, include }), changed: true };
}
