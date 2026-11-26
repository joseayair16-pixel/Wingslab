import { AppError } from '../errors/app-error';
import { hashToken } from '../utils/crypto';
import { getOrCreateDeliveryToken } from './delivery-token.service';
import { computeInTransitEta } from './order-workflow.service';
import { OrderStatus, PaymentMethod, PaymentStatus } from '@prisma/client';
import { driverActiveOrderListSelect } from './order-selects';
import { generateDeliveryPin } from './delivery-pin';

// Never use a raw `include` here: `customer.user` would carry the password
// hash and the whole User row into HTTP responses. This is the reviewed
// driver-facing projection, passed to Prisma as `select`, never as `include`.
const select = {
  ...driverActiveOrderListSelect,
  restaurant: {
    select: { ...driverActiveOrderListSelect.restaurant.select, hasOwnDelivery: true, userId: true },
  },
  customer: { select: { user: { select: { ...driverActiveOrderListSelect.customer.select.user.select, id: true } } } },
};
function allowed(order: any) {
  if (!order) throw new AppError(404, 'DELIVERY_NOT_AUTHORIZED', 'Pedido de reparto propio no encontrado.');
  if (!order.restaurant.hasOwnDelivery || order.fulfillmentType !== 'DELIVERY' ||
      order.driverId || order.supportRestaurantId) {
    throw new AppError(409, 'INVALID_DELIVERY_MODE', 'Este enlace solo admite reparto propio.');
  }
  if (!['READY', 'IN_TRANSIT'].includes(order.status)) throw new AppError(409, 'INVALID_ORDER_STATE', 'El pedido no está disponible para reparto.');
}
export async function resolveOwnTicket(db: any, token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new AppError(404, 'TOKEN_NOT_FOUND', 'Enlace de reparto no válido.');
  const row = await db.deliveryToken.findUnique({ where: { token: hashToken(token) }, include: { order: { select } } });
  if (!row) throw new AppError(404, 'TOKEN_NOT_FOUND', 'El enlace de reparto ya no está disponible.');
  if (new Date(row.expiresAt) <= new Date()) throw new AppError(410, 'TOKEN_EXPIRED', 'El enlace de reparto venció.');
  allowed(row.order);
  if (!row.order.deliveredByRestaurant) throw new AppError(409, 'DELIVERY_NOT_PREPARED', 'El restaurante aún no asignó el reparto propio.');
  return row;
}
export async function prepareOwnDelivery(db: any, restaurantUserId: string, orderId: string) {
  return db.$transaction(async (tx: any) => {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `own-delivery:${orderId}`);
    const order = await tx.order.findFirst({ where: { id: orderId, restaurant: { userId: restaurantUserId } }, select });
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Pedido no encontrado para tu restaurante.');
    allowed(order);
    if (order.status !== 'READY') throw new AppError(409, 'INVALID_ORDER_STATE', 'Marca el pedido listo antes de generar el QR.');
    if (order.paymentMethod !== PaymentMethod.CASH && !order.deliveryPin) {
      await tx.order.updateMany({
        where: { id: orderId, status: OrderStatus.READY, deliveryPin: null },
        data: { deliveryPin: order.handoverPin || generateDeliveryPin() },
      });
    }
    const token = await getOrCreateDeliveryToken(tx, orderId);
    if (!order.deliveredByRestaurant) {
      await tx.order.update({ where: { id: orderId }, data: { deliveredByRestaurant: true } });
      await tx.orderTracking.create({ data: { orderId, status: 'READY', notes: 'Reparto propio asignado mediante QR.' } });
    }
    return { order: await tx.order.findUniqueOrThrow({ where: { id: orderId }, select }), token };
  });
}

export async function ownDeliveryAction(db: any, token: string, action: 'start' | 'arrive' | 'location' | 'deliver', body: any = {}) {
  return db.$transaction(async (tx: any) => {
    const row = await resolveOwnTicket(tx, token);
    return applyOwnDeliveryAction(tx, row.order, action, body, row.id);
  });
}

export async function completeUnassignedOwnDeliveryByRestaurant(
  db: any,
  restaurantUserId: string,
  orderId: string,
  body: { pin?: string; cashReceived?: boolean; emergency?: boolean; reason?: string } = {},
) {
  return db.$transaction(async (tx: any) => {
    const order = await tx.order.findFirst({
      where: { id: orderId, restaurant: { userId: restaurantUserId } },
      select,
    });
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'No se encontró el pedido de este restaurante.');
    allowed(order);
    if (!order.deliveredByRestaurant) throw new AppError(409, 'DELIVERY_NOT_PREPARED', 'El restaurante aún no preparó el reparto propio.');
    if (order.status !== OrderStatus.IN_TRANSIT) throw new AppError(409, 'INVALID_ORDER_STATE', 'El pedido debe estar en camino para confirmar la entrega.');
    const reason = body.reason?.trim() || '';
    if (body.emergency && reason.length < 10) throw new AppError(400, 'EMERGENCY_REASON_REQUIRED', 'Describe el motivo de emergencia con al menos 10 caracteres.');
    if (!body.emergency && !order.driverArrivedAtCustomer) throw new AppError(409, 'ARRIVAL_REQUIRED', 'Registra primero la llegada al domicilio desde el QR de reparto.');
    if (order.paymentMethod === PaymentMethod.CASH && body.cashReceived !== true) {
      throw new AppError(400, 'CASH_CONFIRMATION_REQUIRED', 'Confirma que recibiste el efectivo del cliente.');
    }
    if (!body.emergency && order.paymentMethod !== PaymentMethod.CASH && (!order.deliveryPin || body.pin !== order.deliveryPin)) {
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

    await tx.orderTracking.create({ data: { orderId: order.id, status: OrderStatus.DELIVERED, notes: body.emergency ? `Entrega confirmada por emergencia por el restaurante (${restaurantUserId}). Motivo: ${reason}` : 'Entrega propia confirmada por el restaurante con validación del domicilio y pago.' } });
    await tx.deliveryToken.deleteMany({ where: { orderId: order.id } });
    return tx.order.findUniqueOrThrow({ where: { id: order.id }, select });
  });
}

async function applyOwnDeliveryAction(
  tx: any,
  order: any,
  action: 'start' | 'arrive' | 'location' | 'deliver',
  body: any,
  tokenRecordId: string | null,
) {
  allowed(order);
  const now = new Date();
  const where = {
    id: order.id,
    restaurantId: order.restaurantId,
    status: order.status,
    updatedAt: order.updatedAt,
    driverId: null,
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

  if (action === 'deliver') {
    if (tokenRecordId) await tx.deliveryToken.delete({ where: { id: tokenRecordId } });
    else await tx.deliveryToken.deleteMany({ where: { orderId: order.id } });
  }

  return { order: await tx.order.findUniqueOrThrow({ where: { id: order.id }, select }), changed: true };
}
