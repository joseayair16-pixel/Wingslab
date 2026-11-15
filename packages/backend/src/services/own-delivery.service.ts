import { AppError } from '../errors/app-error';
import { assertManualOrderAction, isLocalVerifiedRuntime } from '../config/order-actions';
import { manualOrderAllowed } from '@sadel/shared';
import { hashToken } from '../utils/crypto';
import { getOrCreateDeliveryToken } from './delivery-token.service';
import { computeInTransitEta } from './order-workflow.service';

const include = { restaurant: true, address: true, customer: { include: { user: true } } };
function allowed(order: any) {
  if (!order || !manualOrderAllowed(order.id, isLocalVerifiedRuntime())) throw new AppError(403, 'DELIVERY_NOT_AUTHORIZED', 'Pedido no autorizado para reparto local.');
  if (!order.restaurant.hasOwnDelivery || order.fulfillmentType !== 'DELIVERY' || order.driverId || order.supportRestaurantId) {
    throw new AppError(409, 'INVALID_DELIVERY_MODE', 'Este enlace solo admite reparto propio.');
  }
  if (!['READY', 'IN_TRANSIT'].includes(order.status)) throw new AppError(409, 'INVALID_ORDER_STATE', 'El pedido no está disponible para reparto.');
}
export async function resolveOwnTicket(db: any, token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new AppError(404, 'TOKEN_NOT_FOUND', 'Enlace de reparto no válido.');
  const row = await db.deliveryToken.findUnique({ where: { token: hashToken(token) }, include: { order: { include } } });
  if (!row) throw new AppError(404, 'TOKEN_NOT_FOUND', 'El enlace de reparto ya no está disponible.');
  if (new Date(row.expiresAt) <= new Date()) throw new AppError(410, 'TOKEN_EXPIRED', 'El enlace de reparto venció.');
  allowed(row.order);
  if (!row.order.deliveredByRestaurant) throw new AppError(409, 'DELIVERY_NOT_PREPARED', 'El restaurante aún no asignó el reparto propio.');
  return row;
}
export async function prepareOwnDelivery(db: any, restaurantUserId: string, orderId: string) {
  assertManualOrderAction(orderId, 'asumirReparto');
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
    const row = await resolveOwnTicket(tx, token), order = row.order, now = new Date();
    const where: any = { id: order.id, status: order.status, updatedAt: order.updatedAt };
    let data: any, note: string | undefined;
    if (action === 'start') {
      if (order.status === 'IN_TRANSIT') return { order, changed: false };
      data = { status: 'IN_TRANSIT', pickedUpAt: now, inTransitAt: now, estimatedDeliveryTime: computeInTransitEta(order.restaurant, order) };
      note = 'Pedido recogido. Reparto propio en camino.';
    } else {
      if (order.status !== 'IN_TRANSIT') throw new AppError(409, 'INVALID_ORDER_STATE', 'Primero recoge el pedido e inicia el reparto.');
      if (action === 'location') {
        const [lat, lng] = Array.isArray(body.coords) ? body.coords : [];
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new AppError(400, 'INVALID_COORDINATES', 'Coordenadas no válidas.');
        data = { lastDriverLatitude: lat, lastDriverLongitude: lng, lastDriverLocationAt: now };
      } else if (action === 'arrive') {
        if (order.driverArrivedAtCustomer) return { order, changed: false };
        data = { driverArrivedAtCustomer: now };
        note = 'DRIVER_ARRIVED';
      } else {
        if (!order.driverArrivedAtCustomer) throw new AppError(409, 'ARRIVAL_REQUIRED', 'Registra primero la llegada al domicilio.');
        if (order.paymentMethod === 'CASH' && body.cashReceived !== true) throw new AppError(400, 'CASH_CONFIRMATION_REQUIRED', 'Confirma la recepción ficticia del efectivo.');
        if (order.paymentMethod !== 'CASH' && (!order.deliveryPin || body.pin !== order.deliveryPin)) throw new AppError(400, 'INVALID_PIN', 'El PIN del cliente no es correcto.');
        data = { status: 'DELIVERED', deliveredAt: now, actualDeliveryTime: now, estimatedDeliveryTime: now,
          ...(order.paymentMethod === 'CASH' ? { paymentStatus: 'COMPLETED', cashPaymentConfirmedAt: now } : {}) };
        note = 'Entrega confirmada por reparto propio. Registro local ficticio, sin movimiento real de dinero.';
      }
    }
    const claimed = await tx.order.updateMany({ where, data });
    if (claimed.count !== 1) throw new AppError(409, 'ORDER_STATE_CHANGED', 'El pedido cambió. Consulta su estado antes de repetir.');
    if (note) await tx.orderTracking.create({ data: { orderId: order.id, status: data.status || order.status, notes: note } });
    if (action === 'deliver') await tx.deliveryToken.delete({ where: { id: row.id } });
    return { order: await tx.order.findUniqueOrThrow({ where: { id: order.id }, include }), changed: true };
  });
}
