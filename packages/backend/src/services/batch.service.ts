import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import crypto from 'node:crypto';

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function sortByProximity(orders: { id: string; latitude: number; longitude: number }[], fromLat: number, fromLng: number) {
  return [...orders]
    .map((o) => ({
      ...o,
      distance: haversineKm(fromLat, fromLng, o.latitude, o.longitude),
    }))
    .sort((a, b) => a.distance - b.distance);
}

export type BatchOrderInfo = {
  id: string;
  orderReference: string;
  deliverySequence: number | null;
  status: string;
  restaurantId: string;
  latitude: number | null;
  longitude: number | null;
};

export async function createOrJoinBatch(
  db: typeof prisma,
  newOrderId: string,
  existingDriverOrders: { id: string; batchId: string | null; latitude: number; longitude: number; restaurantId: string }[],
  restaurantLatitude: number,
  restaurantLongitude: number,
): Promise<string | null> {
  const existingBatchOrder = existingDriverOrders.find((o) => o.batchId);
  const batchId = existingBatchOrder?.batchId || crypto.randomUUID();

  const ordersToUpdate: { id: string; latitude: number; longitude: number }[] = [
    ...existingDriverOrders,
    { id: newOrderId, latitude: restaurantLatitude, longitude: restaurantLongitude },
  ];

  const fromLat = restaurantLatitude;
  const fromLng = restaurantLongitude;
  const sorted = sortByProximity(ordersToUpdate, fromLat, fromLng);

  await db.$transaction(
    sorted.map((o, i) =>
      db.order.update({
        where: { id: o.id },
        data: { batchId, deliverySequence: i },
      })
    )
  );

  logger.info(`[Batch] Creado/actualizado batch ${batchId} con ${sorted.length} ordenes. Secuencia: ${sorted.map((o, i) => `${o.id}=${i}`).join(', ')}`);
  return batchId;
}

export async function pickupBatchOrders(
  db: typeof prisma,
  batchId: string,
  driverUserId: string,
): Promise<BatchOrderInfo[]> {
  const orders = await db.order.findMany({
    where: { batchId, driver: { userId: driverUserId } },
    select: {
      id: true,
      orderReference: true,
      deliverySequence: true,
      status: true,
      restaurantId: true,
      latitude: true,
      longitude: true,
    },
    orderBy: { deliverySequence: 'asc' },
  });

  if (orders.length === 0) return [];

  const now = new Date();
  for (const order of orders) {
    if (order.status === 'READY') {
      await db.orderTracking.create({
        data: {
          orderId: order.id,
          status: 'PICKED_UP',
          notes: `Recogido en lote ${batchId}`,
        },
      });
    }
  }

  await db.order.updateMany({
    where: { batchId, driver: { userId: driverUserId }, status: 'READY' },
    data: { status: 'PICKED_UP', pickedUpAt: now },
  });

  await db.order.updateMany({
    where: { batchId, driver: { userId: driverUserId }, status: 'PICKED_UP' },
    data: { status: 'IN_TRANSIT', inTransitAt: now },
  });

  const updated = await db.order.findMany({
    where: { batchId, driver: { userId: driverUserId } },
    select: {
      id: true,
      orderReference: true,
      deliverySequence: true,
      status: true,
      restaurantId: true,
      latitude: true,
      longitude: true,
    },
    orderBy: { deliverySequence: 'asc' },
  });

  logger.info(`[Batch] Recogido lote ${batchId}: ${updated.length} ordenes ahora IN_TRANSIT`);
  return updated;
}

export async function deliverBatchOrder(
  db: typeof prisma,
  orderId: string,
  batchId: string | null,
  driverUserId: string,
  _handoverPin?: string,
): Promise<{ nextOrder: BatchOrderInfo | null; total: number; completed: number }> {
  const batchOrders = batchId
    ? await db.order.findMany({
        where: { batchId, driver: { userId: driverUserId } },
        select: {
          id: true,
          orderReference: true,
          deliverySequence: true,
          status: true,
          restaurantId: true,
          latitude: true,
          longitude: true,
        },
        orderBy: { deliverySequence: 'asc' },
      })
    : [];

  if (batchOrders.length === 0) {
    return { nextOrder: null, total: 1, completed: 0 };
  }

  const completed = batchOrders.filter((o) => o.status === 'DELIVERED' || o.id === orderId).length;
  const total = batchOrders.length;
  const remaining = batchOrders.filter((o) => o.status !== 'DELIVERED' && o.id !== orderId);
  const nextOrder = remaining.length > 0 ? remaining[0] : null;

  logger.info(`[Batch] Progreso lote ${batchId}: ${completed}/${total} entregados. Siguiente: ${nextOrder?.id || 'ninguno'}`);
  return { nextOrder, total, completed };
}

export async function getBatchForOrder(
  db: typeof prisma,
  orderId: string,
  driverUserId: string,
): Promise<BatchOrderInfo[]> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { batchId: true },
  });

  if (!order?.batchId) return [];

  return db.order.findMany({
    where: { batchId: order.batchId, driver: { userId: driverUserId } },
    select: {
      id: true,
      orderReference: true,
      deliverySequence: true,
      status: true,
      restaurantId: true,
      latitude: true,
      longitude: true,
    },
    orderBy: { deliverySequence: 'asc' },
  });
}

export async function getBatchById(
  db: typeof prisma,
  batchId: string,
  driverUserId: string,
): Promise<BatchOrderInfo[]> {
  return db.order.findMany({
    where: { batchId, driver: { userId: driverUserId } },
    select: {
      id: true,
      orderReference: true,
      deliverySequence: true,
      status: true,
      restaurantId: true,
      latitude: true,
      longitude: true,
    },
    orderBy: { deliverySequence: 'asc' },
  });
}

export async function getBatchRestaurantUserId(
  db: typeof prisma,
  batchId: string,
): Promise<string | null> {
  const firstOrder = await db.order.findFirst({
    where: { batchId },
    select: {
      restaurant: {
        select: { userId: true },
      },
    },
  });
  return firstOrder?.restaurant?.userId || null;
}

export function buildBatchProgress(batchOrders: { deliverySequence: number | null; status: string }[]) {
  if (batchOrders.length === 0) return null;
  const total = batchOrders.length;
  const delivered = batchOrders.filter((o) => o.status === 'DELIVERED').length;
  const inTransit = batchOrders.filter((o) => o.status === 'IN_TRANSIT').length;
  const pickedUp = batchOrders.filter((o) => o.status === 'PICKED_UP').length;
  const ready = batchOrders.filter((o) => o.status === 'READY').length;
  const currentSequence = batchOrders.find((o) => o.status !== 'DELIVERED')?.deliverySequence ?? total;
  return { total, delivered, inTransit, pickedUp, ready, currentSequence };
}
