import { OrderStatus } from '@prisma/client';
import { prisma } from '../config/database';
import { getRedis } from '../config/redis';
import { getActiveSinceMs, getFirstInQueue } from './order-workflow.service';
import { sendFcmDataMessage, RING_MIN_APP_VERSION } from './fcm.service';
import { logger } from '../utils/logger';

/**
 * Alarma continua de pedidos (estilo Uber Eats / Rappi).
 *
 * La app nativa reproduce un sonido en bucle con un Foreground Service hasta que
 * el pedido se acepta/rechaza o expira la ventana de decisión. Este servicio es
 * la "fuente de verdad" de las alarmas activas: cada pocos segundos recalcula
 * qué pedidos DEBEN estar sonando y:
 *   - inicia la alarma en los dispositivos que aún no la tienen (redundante e
 *     idempotente con el propio push, como red de seguridad);
 *   - detiene la alarma de los pedidos que ya se resolvieron (aunque el
 *     operador los haya aceptado desde otro dispositivo o la aceptación haya
 *     ocurrido con la app cerrada).
 *
 * El estado de "alarma activa" se guarda en Redis con TTL para que un reinicio
 * del proceso no deje alarmas huérfanas.
 */

const RING_KEY_PREFIX = 'sadel:ring:';
const DRIVER_ACCEPT_WINDOW_MS = 2 * 60 * 1000;

/** Ventana de decisión del restaurante/tienda según método de pago y tipo. */
export function decisionWindowMs(paymentMethod: string, businessType?: string | null): number {
  if (paymentMethod === 'TRANSFER') return 10 * 60 * 1000;
  if (businessType && businessType !== 'RESTAURANT') return 8 * 60 * 1000;
  return 2 * 60 * 1000;
}

type RingDescriptor = {
  orderId: string;
  orderReference: string;
  userId: string;
  expiresAtMs: number;
  title: string;
  body: string;
  sound: string;
};

/**
 * Escanea claves por prefijo usando SCAN (nunca KEYS, que bloquea Redis).
 *
 * Ojo con el orden de retorno: ioredis resuelve `[keys, cursor]` y el Redis en
 * memoria de los tests devuelve `[cursor, keys]`. Se detecta por forma para
 * funcionar con ambos. Además se filtra por prefijo en memoria porque el Redis
 * en memoria ignora el patrón MATCH y devolvería claves ajenas.
 */
async function scanKeysByPrefix(prefix: string): Promise<string[]> {
  const redis = getRedis();
  const pattern = `${prefix}*`;
  const keys: string[] = [];
  let cursor = '0';

  do {
    const result = (await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200)) as unknown;
    const [first, second] = Array.isArray(result) ? result : [];
    const batch = (Array.isArray(first) ? first : second) as string[] | undefined;
    const nextCursor = (Array.isArray(first) ? second : first) as string | undefined;

    if (Array.isArray(batch)) {
      keys.push(...batch.filter((key) => typeof key === 'string' && key.startsWith(prefix)));
    }
    cursor = typeof nextCursor === 'string' ? nextCursor : '0';
  } while (cursor !== '0');

  return keys;
}

/** Pedidos de restaurante/tienda que deben estar sonando (solo el activo en cola). */
async function computeRestaurantRings(desired: RingDescriptor[]): Promise<void> {
  const pendingOrders = await prisma.order.findMany({
    where: { status: OrderStatus.PENDING },
    select: {
      id: true,
      orderReference: true,
      createdAt: true,
      paymentMethod: true,
      restaurantId: true,
      restaurant: { select: { userId: true, businessType: true, name: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (pendingOrders.length === 0) return;

  const byRestaurant = new Map<string, typeof pendingOrders>();
  for (const order of pendingOrders) {
    const list = byRestaurant.get(order.restaurantId) ?? [];
    list.push(order);
    byRestaurant.set(order.restaurantId, list);
  }

  for (const [restaurantId, orders] of byRestaurant) {
    let firstId: string | null = null;
    try {
      firstId = await getFirstInQueue(restaurantId);
    } catch {
      firstId = null;
    }

    const active = orders.find((o) => o.id === firstId) ?? orders[0];
    if (!active) continue;

    let activeSinceMs: number | null = null;
    try {
      activeSinceMs = await getActiveSinceMs(active.id);
    } catch {
      activeSinceMs = null;
    }

    const startMs = activeSinceMs ?? active.createdAt.getTime();
    const windowMs = decisionWindowMs(active.paymentMethod, active.restaurant.businessType);

    desired.push({
      orderId: active.id,
      orderReference: active.orderReference,
      userId: active.restaurant.userId,
      expiresAtMs: startMs + windowMs,
      title: '¡Nuevo pedido recibido!',
      body: `${active.orderReference} · ${active.restaurant.name}`,
      sound: 'notifica',
    });
  }
}

/** Pedidos asignados a un repartidor que aún no acepta (ventana de 2 minutos). */
async function computeDriverRings(desired: RingDescriptor[]): Promise<void> {
  const now = Date.now();
  const assignedOrders = await prisma.order.findMany({
    where: {
      driverId: { not: null },
      isAcceptedByDriver: false,
      driverAssignedAt: { not: null },
      status: { in: [OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.READY] },
      driver: { isNot: null },
    },
    select: {
      id: true,
      orderReference: true,
      driverAssignedAt: true,
      restaurant: { select: { name: true } },
      driver: { select: { userId: true } },
    },
  });

  for (const order of assignedOrders) {
    const assignedAtMs = order.driverAssignedAt?.getTime();
    if (!assignedAtMs) continue;
    const expiresAtMs = assignedAtMs + DRIVER_ACCEPT_WINDOW_MS;
    if (now >= expiresAtMs) continue; // el JIT job ya lo expulsa

    desired.push({
      orderId: order.id,
      orderReference: order.orderReference,
      userId: order.driver!.userId,
      expiresAtMs,
      title: '🛵 Nuevo pedido asignado',
      body: `${order.restaurant.name} · ${order.orderReference} — tócalo para aceptar`,
      sound: 'notifica',
    });
  }
}

async function computeDesiredRings(): Promise<RingDescriptor[]> {
  const desired: RingDescriptor[] = [];
  await computeRestaurantRings(desired);
  await computeDriverRings(desired);
  return desired;
}

function buildStartData(d: RingDescriptor): Record<string, string> {
  return {
    type: 'order-ring-start',
    orderId: d.orderId,
    orderReference: d.orderReference,
    title: d.title,
    body: d.body,
    sound: d.sound,
    expiresAt: String(d.expiresAtMs),
    url: `/?orderId=${d.orderId}`,
    click_action: 'OPEN_ORDER',
  };
}

/**
 * Recalcula las alarmas activas e inicia/detiene las que correspondan.
 * Nunca lanza: cualquier error se registra para no tumbar el job.
 */
export async function reconcileOrderRings(): Promise<void> {
  let desired: RingDescriptor[] = [];
  try {
    desired = await computeDesiredRings();
  } catch (error: any) {
    logger.error('[OrderRing] Error calculando alarmas activas:', error?.message || error);
    return;
  }

  const desiredIds = new Set(desired.map((d) => d.orderId));
  const redis = getRedis();

  // ── Iniciar alarmas que aún no están registradas ──
  for (const d of desired) {
    const key = `${RING_KEY_PREFIX}${d.orderId}`;
    let exists = 0;
    try {
      exists = await redis.exists(key);
    } catch {
      exists = 0;
    }
    if (exists) continue;

    const res = await sendFcmDataMessage(d.userId, buildStartData(d), {
      minAppVersion: RING_MIN_APP_VERSION,
    });
    if (!res.success) continue;

    try {
      const ttl = Math.max(30, Math.ceil((d.expiresAtMs - Date.now()) / 1000) + 120);
      await redis.set(key, JSON.stringify({ userId: d.userId }), 'EX', ttl);
    } catch {
      /* el TTL es una optimización; si falla, la siguiente pasada reintenta */
    }
  }

  // ── Detener alarmas de pedidos ya resueltos ──
  let keys: string[] = [];
  try {
    keys = await scanKeysByPrefix(RING_KEY_PREFIX);
  } catch {
    keys = [];
  }

  for (const key of keys) {
    const orderId = key.slice(RING_KEY_PREFIX.length);
    if (desiredIds.has(orderId)) continue;

    let userId: string | undefined;
    try {
      const raw = await redis.get(key);
      if (raw) userId = JSON.parse(raw)?.userId;
    } catch {
      userId = undefined;
    }

    if (userId) {
      await sendFcmDataMessage(
        userId,
        { type: 'order-ring-stop', orderId, url: `/?orderId=${orderId}` },
        { minAppVersion: RING_MIN_APP_VERSION }
      );
    }

    try {
      await redis.del(key);
    } catch {
      /* TTL acaba limpiándola */
    }
  }
}
