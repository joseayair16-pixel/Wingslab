import {
  DriverAvailability,
  DriverStatus,
  OrderStatus,
  PrismaClient,
  RestaurantStatus,
  PaymentMethod,
  PaymentStatus,
} from '@prisma/client';
import { AppError, isAppError } from '../errors/app-error';
import { assertManualOrderAction } from '../config/order-actions';
import { MANUAL_ORDER_ACTIONS } from '@sadel/shared';
import {
  driverScopedOrderSelect,
  restaurantOrderWorkflowSelect,
  restaurantScopedOrderSelect,
} from './order-selects';
import {
  getDistanceInKm,
  getBusinessRef,
  getBusinessArticleCapitalized,
} from '../utils/restaurant';
import { restoreStockForOrder } from './stock.service';
import { getRedis } from '../config/redis';
import { logger } from '../utils/logger';
import { appEvents } from '../utils/events';
import { calculateOrderEta, estimateDeliveryTravelMinutes } from '../utils/order-eta';
import { sendPushNotification } from './notification.service';
import { emitNotification } from './socket.service';
import { sendWhatsAppDriverDemand } from './whatsapp.service';
import { createTransferRefundTicket } from './refund-ticket.service';
import {
  DriverCandidate,
  scoreDriverCandidate,
  isRouteCompatibleWithNewOrder,
  minutesSinceLastAssignment,
  driverDistanceToRestaurantKm,
} from './driver-scoring';

type WorkflowParams = {
  prisma: PrismaClient;
};

type RestaurantOrderActionParams = WorkflowParams & {
  restaurantUserId: string;
  orderId: string;
  nextStatus: OrderStatus;
  trackingNote: string;
  preparationTimeMinutes?: number;
  scheduledDeliveryAt?: string;
  isScheduleProposal?: boolean;
  cancellationReason?: string | null;
  cancelledBy?: string | null;
};

type AssignDriverParams = WorkflowParams & {
  restaurantUserId: string;
  orderId: string;
  driverId: string;
};

type ExtendPreparationTimeParams = WorkflowParams & {
  restaurantUserId: string;
  orderId: string;
  additionalMinutes: 5 | 10 | 15 | 20;
};

type RescheduleDeliveryParams = WorkflowParams & {
  restaurantUserId: string;
  orderId: string;
  estimatedDeliveryAt: string;
};

type DriverOrderActionParams = WorkflowParams & {
  driverUserId: string;
  orderId: string;
  action: 'accept' | 'reject' | 'picked_up' | 'in_transit' | 'delivered' | 'safe_place' | 'no_show';
  pin?: string;
};

const restaurantStatusTransitions: Record<OrderStatus, OrderStatus[]> = {
  PENDING: [
    OrderStatus.CONFIRMED,
    OrderStatus.PREPARING,
    OrderStatus.REJECTED,
    OrderStatus.CANCELLED,
  ],
  CONFIRMED: [OrderStatus.PREPARING, OrderStatus.READY, OrderStatus.CANCELLED],
  PREPARING: [OrderStatus.READY, OrderStatus.CANCELLED],
  READY: [OrderStatus.COMPLETED],
  PICKED_UP: [],
  IN_TRANSIT: [],
  DELIVERED: [],
  COMPLETED: [],
  CANCELLED: [],
  REJECTED: [],
};

// ====== Redis-Backed Restaurant Order Queue ======
// Manages the FIFO queue of pending orders per restaurant.
// Only the first order in the queue has its decision window active.
// Subsequent orders wait until the one before them is accepted/rejected.
// Keys:
//   restaurant:queue:<restaurantId> → Sorted Set (member=orderId, score=createdAt epoch ms)
//   restaurant:queue:active:<orderId> → String (epoch ms when this order became first in queue)

const QUEUE_ACTIVE_TTL = 15 * 60; // 15 min TTL for active-since keys (safety cleanup)

export async function enqueueRestaurantOrder(
  restaurantId: string,
  orderId: string,
  createdAt: Date
): Promise<{ position: number; queueLength: number }> {
  try {
    const redis = getRedis();
    const key = `restaurant:queue:${restaurantId}`;
    await redis.zadd(key, createdAt.getTime(), orderId);
    const queueLength = await redis.zcard(key);
    const position = await redis.zrank(key, orderId);
    // If this is the only order in queue, mark it as active now
    if (position === 0) {
      await redis.set(
        `restaurant:queue:active:${orderId}`,
        Date.now().toString(),
        'EX',
        QUEUE_ACTIVE_TTL
      );
    }
    return { position: position !== null ? position + 1 : queueLength, queueLength };
  } catch (err) {
    logger.error('[OrderQueue] Failed to enqueue order', { restaurantId, orderId, err });
    return { position: 1, queueLength: 1 };
  }
}

export async function dequeueRestaurantOrder(
  restaurantId: string,
  orderId: string
): Promise<{ nextOrderId: string | null; queueLength: number }> {
  try {
    const redis = getRedis();
    const key = `restaurant:queue:${restaurantId}`;
    await redis.zrem(key, orderId);
    await redis.del(`restaurant:queue:active:${orderId}`);
    const queueLength = await redis.zcard(key);
    // Activate the next order in queue (if any)
    const nextOrder = await redis.zrange(key, 0, 0);
    if (nextOrder.length > 0) {
      const nextOrderId = nextOrder[0];
      await redis.set(
        `restaurant:queue:active:${nextOrderId}`,
        Date.now().toString(),
        'EX',
        QUEUE_ACTIVE_TTL
      );
      return { nextOrderId, queueLength };
    }
    return { nextOrderId: null, queueLength };
  } catch (err) {
    logger.error('[OrderQueue] Failed to dequeue order', { restaurantId, orderId, err });
    return { nextOrderId: null, queueLength: 0 };
  }
}

export async function getRestaurantQueue(
  restaurantId: string
): Promise<{ orderId: string; position: number }[]> {
  try {
    const redis = getRedis();
    const key = `restaurant:queue:${restaurantId}`;
    const orders = await redis.zrange(key, 0, -1);
    return orders.map((orderId, index) => ({ orderId, position: index + 1 }));
  } catch (err) {
    logger.error('[OrderQueue] Failed to get queue', { restaurantId, err });
    return [];
  }
}

export async function getFirstInQueue(restaurantId: string): Promise<string | null> {
  try {
    const redis = getRedis();
    const key = `restaurant:queue:${restaurantId}`;
    const result = await redis.zrange(key, 0, 0);
    return result.length > 0 ? result[0] : null;
  } catch {
    return null;
  }
}

export async function getQueueLength(restaurantId: string): Promise<number> {
  try {
    const redis = getRedis();
    return await redis.zcard(`restaurant:queue:${restaurantId}`);
  } catch {
    return 0;
  }
}

export async function getActiveSinceMs(orderId: string): Promise<number | null> {
  try {
    const redis = getRedis();
    const val = await redis.get(`restaurant:queue:active:${orderId}`);
    return val ? parseInt(val, 10) : null;
  } catch {
    return null;
  }
}

// ====== Redis-Backed Driver Rejection Tracking ======
// Tracks how many times a driver has rejected an order.
// Max 2 rejections before temporary exclusion (15 min TTL) para que el pool
// nunca quede "congelado": si todos rechazan 2 veces, se reintenta al expirar.
// Keys: rejection:{orderId}:{driverId} → count (TTL: 15 minutes)

const REJECTION_TTL = 900;

// Capacidad de pedidos activos por repartidor.
// MAX_ACTIVE_ORDERS: tope normal (por defecto 3).
// OVERLOAD_MAX_ACTIVE_ORDERS: tope máximo en el pase de emergencia (por defecto 5)
// para evitar saturar a un único repartidor con todo el pool.
export function getMaxActiveOrders(): number {
  const n = parseInt(process.env.MAX_ACTIVE_ORDERS || '3', 10);
  return Number.isFinite(n) && n > 0 ? n : 3;
}
function getOverloadMaxActiveOrders(): number {
  const n = parseInt(process.env.OVERLOAD_MAX_ACTIVE_ORDERS || '5', 10);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

export async function getDriverRejectionCount(orderId: string, driverId: string): Promise<number> {
  try {
    const redis = getRedis();
    const val = await redis.get(`rejection:${orderId}:${driverId}`);
    return val ? parseInt(val, 10) : 0;
  } catch {
    return 0;
  }
}

export async function incrementDriverRejection(orderId: string, driverId: string): Promise<void> {
  try {
    const redis = getRedis();
    const key = `rejection:${orderId}:${driverId}`;
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, REJECTION_TTL);
    }
  } catch (err) {
    logger.error('Failed to increment driver rejection in Redis', { orderId, driverId, err });
  }
}

export async function getExcludedDriverIds(orderId: string): Promise<string[]> {
  try {
    const redis = getRedis();
    const pattern = `rejection:${orderId}:*`;
    const excluded: string[] = [];
    let cursor = '0';

    do {
      const result = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = result[0];
      const keys = result[1];

      if (keys.length > 0) {
        const counts = await redis.mget(...keys);
        for (let i = 0; i < keys.length; i++) {
          const driverId = keys[i].replace(`rejection:${orderId}:`, '');
          const count = parseInt(counts[i] || '0', 10);
          if (count >= 2) {
            excluded.push(driverId);
          }
        }
      }
    } while (cursor !== '0');

    return excluded;
  } catch {
    return [];
  }
}

const assignableRestaurantStatuses = new Set<OrderStatus>([
  OrderStatus.CONFIRMED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
]);

function createDomainError(statusCode: number, code: string, message: string): AppError {
  return new AppError(statusCode, code, message);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function calculatePickedUpEta(order: {
  latitude: number | null;
  longitude: number | null;
  restaurant: {
    latitude?: number | null;
    longitude?: number | null;
    maxDeliveryTime?: number | null;
  };
}) {
  const minutes = estimateDeliveryTravelMinutes(order.restaurant, order);
  return new Date(Date.now() + minutes * 60 * 1000);
}

function calculateInTransitEta(order: {
  latitude: number | null;
  longitude: number | null;
  restaurant: {
    latitude?: number | null;
    longitude?: number | null;
    maxDeliveryTime?: number | null;
  };
}) {
  const minutes = clamp(
    Math.round(estimateDeliveryTravelMinutes(order.restaurant, order) * 0.65),
    5,
    18
  );
  return new Date(Date.now() + minutes * 60 * 1000);
}

export function computeInTransitEta(
  restaurant: {
    latitude?: number | null;
    longitude?: number | null;
    maxDeliveryTime?: number | null;
  },
  destination: { latitude: number | null; longitude: number | null }
): Date {
  return calculateInTransitEta({
    latitude: destination.latitude,
    longitude: destination.longitude,
    restaurant,
  });
}

export function canRestaurantTransitionTo(
  currentStatus: OrderStatus,
  nextStatus: OrderStatus
): boolean {
  return restaurantStatusTransitions[currentStatus].includes(nextStatus);
}

export async function getRestaurantScopedOrder(
  prisma: PrismaClient,
  restaurantUserId: string,
  orderId: string
) {
  return prisma.order.findFirst({
    where: {
      id: orderId,
      restaurant: {
        userId: restaurantUserId,
      },
    },
    select: restaurantScopedOrderSelect,
  });
}

export async function updateOrderStatusByRestaurant({
  prisma,
  restaurantUserId,
  orderId,
  nextStatus,
  trackingNote,
  preparationTimeMinutes,
  scheduledDeliveryAt,
  isScheduleProposal = false,
  cancellationReason,
  cancelledBy,
}: RestaurantOrderActionParams) {
  const manualAction = Object.keys(MANUAL_ORDER_ACTIONS).find(key =>
    MANUAL_ORDER_ACTIONS[key as keyof typeof MANUAL_ORDER_ACTIONS].to === nextStatus);
  assertManualOrderAction(orderId, manualAction || '');
  const updatedOrder = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId, restaurant: { userId: restaurantUserId } },
      select: restaurantScopedOrderSelect,
    });

    if (!order) {
      throw createDomainError(404, 'ORDER_NOT_FOUND', 'No se encontro el pedido.');
    }

    if (order.status !== MANUAL_ORDER_ACTIONS[manualAction as keyof typeof MANUAL_ORDER_ACTIONS].from) {
      throw createDomainError(409, 'INVALID_ORDER_TRANSITION', 'El estado actual no permite esta acción manual.');
    }

    if (!canRestaurantTransitionTo(order.status, nextStatus)) {
      throw createDomainError(
        409,
        'INVALID_ORDER_TRANSITION',
        'La accion no es valida para el estado actual del pedido.'
      );
    }

    if (nextStatus === OrderStatus.COMPLETED && order.fulfillmentType !== 'PICKUP') {
      throw createDomainError(
        400,
        'INVALID_FULFILLMENT_TYPE',
        'Solo pedidos para recoger en tienda pueden marcarse como recogidos.'
      );
    }

    if (
      order.paymentMethod === PaymentMethod.TRANSFER &&
      order.status === OrderStatus.PENDING &&
      nextStatus === OrderStatus.CONFIRMED
    ) {
      // La ventana de 10 minutos para confirmar una transferencia se mide desde
      // el momento en que el pedido quedó activo en la cola (activeSinceMs),
      // no desde createdAt, para que coincida con el clock que usa el job de
      // timeouts. Si nunca estuvo en cola, cae a createdAt.
      const activeSinceMs = await getActiveSinceMs(order.id);
      const effectiveStartMs = activeSinceMs ?? new Date(order.createdAt).getTime();
      const elapsedMinutes = (Date.now() - effectiveStartMs) / 60000;
      if (elapsedMinutes > 10) {
        throw createDomainError(
          400,
          'TRANSFER_TIMEOUT',
          'El tiempo límite de 10 minutos para confirmar el pago por transferencia ha expirado. Favor de rechazar la orden.'
        );
      }
    }

    // Bypass de pago: un pedido de transferencia solo puede avanzar a
    // PREPARING/READY si el comprobante ya fue confirmado (paymentStatus=COMPLETED,
    // que solo ocurre al pasar por CONFIRMED). Evita que un pedido llegue a
    // entregarse con la transferencia pendiente de confirmar.
    if (
      order.paymentMethod === PaymentMethod.TRANSFER &&
      order.paymentStatus !== PaymentStatus.COMPLETED &&
      nextStatus !== OrderStatus.CONFIRMED &&
      nextStatus !== OrderStatus.REJECTED &&
      nextStatus !== OrderStatus.CANCELLED
    ) {
      throw createDomainError(
        409,
        'PAYMENT_NOT_CONFIRMED',
        'Debes confirmar el comprobante de transferencia (aceptar el pedido) antes de prepararlo o entregarlo.'
      );
    }

    const now = new Date();
    const eta =
      (nextStatus === OrderStatus.CONFIRMED || nextStatus === OrderStatus.PREPARING) &&
      preparationTimeMinutes
        ? calculateOrderEta({
            restaurant: order.restaurant,
            order,
            preparationTimeMinutes,
            from: now,
            isPickup: order.fulfillmentType === 'PICKUP',
          })
        : null;

    let readyEstimatedDeliveryTime: Date | null = null;
    if (nextStatus === OrderStatus.READY && order.fulfillmentType !== 'PICKUP') {
      const travelMinutes = estimateDeliveryTravelMinutes(order.restaurant, order);
      readyEstimatedDeliveryTime = new Date(now.getTime() + travelMinutes * 60 * 1000);
    }

    const isAccepting =
      nextStatus === OrderStatus.CONFIRMED || nextStatus === OrderStatus.PREPARING;
    const isCancelling = nextStatus === OrderStatus.CANCELLED;

    const claimed = await tx.order.updateMany({
      where: { id: order.id, status: order.status, updatedAt: order.updatedAt },
      data: {
        status: nextStatus,
        ...(isAccepting ? { noDriversAvailable: false } : {}),
        ...(isCancelling
          ? {
              cancellationReason: cancellationReason ?? null,
              cancelledBy: cancelledBy ?? null,
            }
          : {}),
        ...(isAccepting && scheduledDeliveryAt
          ? (() => {
              // En recoger-en-tienda no hay trayecto de reparto: el cliente va a
              // la sucursal, así que el deadline de preparación coincide con la
              // hora acordada (travel = 0). Consistente con calculateOrderEta.
              const travelMinutes =
                order.fulfillmentType === 'PICKUP'
                  ? 0
                  : estimateDeliveryTravelMinutes(order.restaurant, order);
              const scheduledDate = new Date(scheduledDeliveryAt);
              const deadline = new Date(scheduledDate.getTime() - travelMinutes * 60 * 1000);
              return {
                scheduledDeliveryAt: scheduledDate,
                preparationTimeMinutes: preparationTimeMinutes ?? 1,
                ...(isScheduleProposal
                  ? { preparationStartedAt: null as any }
                  : { preparationStartedAt: now }),
                preparationDeadlineAt: deadline,
                etaExtendedMinutes: 0,
                estimatedDeliveryTime: scheduledDate,
              };
            })()
          : {}),
        ...(isAccepting && !scheduledDeliveryAt && preparationTimeMinutes && eta
          ? {
              preparationTimeMinutes,
              preparationStartedAt: now,
              preparationDeadlineAt: eta.preparationDeadlineAt,
              etaExtendedMinutes: 0,
              estimatedDeliveryTime: eta.estimatedDeliveryTime,
            }
          : {}),
        ...(nextStatus === OrderStatus.COMPLETED
          ? {
              completedAt: now,
              ...(order.paymentMethod === PaymentMethod.CASH
                ? { paymentStatus: PaymentStatus.COMPLETED, cashPaymentConfirmedAt: now }
                : {}),
            }
          : {}),
        ...(nextStatus === OrderStatus.READY
          ? {
              readyAt: now,
              ...(order.fulfillmentType !== 'PICKUP' ? { pickedUpAt: null } : {}),
              ...(order.fulfillmentType !== 'PICKUP' &&
              order.paymentMethod === PaymentMethod.TRANSFER
                ? (() => {
                    const samePin = Math.floor(1000 + Math.random() * 9000).toString();
                    return { handoverPin: samePin, deliveryPin: samePin };
                  })()
                : {}),
              ...(readyEstimatedDeliveryTime
                ? { estimatedDeliveryTime: readyEstimatedDeliveryTime }
                : {}),
            }
          : {}),
        ...(order.paymentMethod === PaymentMethod.TRANSFER
          ? nextStatus === OrderStatus.CONFIRMED
            ? { paymentStatus: PaymentStatus.COMPLETED }
            : nextStatus === OrderStatus.REJECTED
              ? { paymentStatus: PaymentStatus.FAILED }
              : {}
          : {}),
      },
    });
    if (claimed.count !== 1) {
      throw createDomainError(409, 'ORDER_STATE_CHANGED', 'Otro operador modificó el pedido. Consulta su estado antes de reintentar.');
    }
    const updated = await tx.order.findUniqueOrThrow({ where: { id: order.id }, select: restaurantOrderWorkflowSelect });

    await tx.orderTracking.create({
      data: {
        orderId: order.id,
        status: nextStatus,
        notes:
          eta && preparationTimeMinutes
            ? `${trackingNote} ETA actualizada con ${preparationTimeMinutes} min de preparacion y ${eta.travelMinutes} min estimados de trayecto.`
            : nextStatus === OrderStatus.READY && readyEstimatedDeliveryTime
              ? `${trackingNote} El pedido está listo. Se recalculó ETA de entrega para dentro de ${Math.round((readyEstimatedDeliveryTime.getTime() - now.getTime()) / 60000)} min de trayecto.`
              : trackingNote,
      },
    });

    logger.info('Restaurant order transition applied', {
      orderId: order.id,
      restaurantUserId,
      fromStatus: order.status,
      toStatus: nextStatus,
    });

    if (nextStatus === OrderStatus.REJECTED || nextStatus === OrderStatus.CANCELLED) {
      await createTransferRefundTicket(
        tx,
        order.id,
        nextStatus === OrderStatus.REJECTED
          ? 'El restaurante rechazó el pedido.'
          : 'El restaurante canceló el pedido.'
      );
      // Liberar el stock reservado al cancelar/rechazar la orden.
      await restoreStockForOrder(tx, order.id);
    }

    return updated;
  });

  // Never notify subscribers before the transaction has committed.
  appEvents.emit('order.status_changed', {
    orderId, status: nextStatus, initiator: { id: restaurantUserId, role: 'RESTAURANT' },
  });
  return updatedOrder;
}

// ====== Customer Cancellation Request ======

export async function requestOrderCancellation(
  prisma: PrismaClient,
  orderId: string,
  customerUserId: string,
  reason?: string | null
) {
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      customer: { userId: customerUserId },
      status: { in: [OrderStatus.PENDING, OrderStatus.CONFIRMED, OrderStatus.PREPARING] },
    },
    include: { restaurant: { select: { userId: true } } },
  });

  if (!order) {
    throw createDomainError(
      404,
      'ORDER_NOT_FOUND',
      'No se encontró el pedido o no se puede cancelar.'
    );
  }

  if (order.cancellationRejectedAt) {
    throw createDomainError(
      409,
      'CANCELLATION_ALREADY_REJECTED',
      'El restaurante ya rechazó tu solicitud de cancelación. No puedes volver a solicitarla.'
    );
  }

  if (order.cancellationRequestedAt) {
    throw createDomainError(
      409,
      'CANCELLATION_ALREADY_REQUESTED',
      'Ya hay una solicitud de cancelación activa.'
    );
  }

  if ((order.cancellationRequestCount ?? 0) >= 1) {
    throw createDomainError(
      409,
      'MAX_CANCELLATION_REQUESTS',
      'Ya solicitaste cancelación una vez. No puedes volver a solicitarla.'
    );
  }

  const now = new Date();
  await prisma.order.update({
    where: { id: order.id },
    data: {
      cancellationRequestedAt: now,
      cancellationReason: reason || null,
      cancellationRequestCount: { increment: 1 },
    },
  });

  return { restaurantUserId: order.restaurant.userId };
}

export async function retractCancellationRequest(
  prisma: PrismaClient,
  orderId: string,
  customerUserId: string
) {
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      customer: { userId: customerUserId },
      cancellationRequestedAt: { not: null },
    },
  });

  if (!order) {
    throw createDomainError(
      404,
      'NO_CANCELLATION_REQUEST',
      'No hay una solicitud de cancelación activa.'
    );
  }

  await prisma.order.update({
    where: { id: order.id },
    data: { cancellationRequestedAt: null },
  });
}

export async function respondToCancellationRequest(
  prisma: PrismaClient,
  orderId: string,
  restaurantUserId: string,
  approve: boolean,
  note?: string | null
) {
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      restaurant: { userId: restaurantUserId },
      cancellationRequestedAt: { not: null },
    },
    include: {
      customer: { select: { userId: true } },
      driver: { select: { userId: true } },
    },
  });

  if (!order) {
    throw createDomainError(
      404,
      'NO_CANCELLATION_REQUEST',
      'No hay una solicitud de cancelación activa.'
    );
  }

  if (approve) {
    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.CANCELLED,
          cancelledBy: 'CUSTOMER',
          cancellationReason: note || order.cancellationReason || 'Solicitado por el cliente.',
          cancellationRequestedAt: null,
          noDriversAvailable: false,
          driverId: null,
          driverAssignedAt: null,
          isAcceptedByDriver: false,
        },
      });

      await tx.orderTracking.create({
        data: {
          orderId: order.id,
          status: OrderStatus.CANCELLED,
          notes: `Cancelación aprobada. ${note ? `Nota: ${note}` : 'Solicitado por el cliente.'}`,
        },
      });

      // Liberar al driver si estaba asignado
      if (order.driverId) {
        await tx.driver.updateMany({
          where: { id: order.driverId },
          data: { availability: 'AVAILABLE' as any },
        });
      }

      await createTransferRefundTicket(
        tx,
        order.id,
        `Cancelación aprobada (solicitada por el cliente). ${note ? `Nota: ${note}` : ''}`
      );

      await restoreStockForOrder(tx, order.id);
    });

    return { customerUserId: order.customer.userId, driverUserId: order.driver?.userId ?? null };
  } else {
    const now = new Date();
    await prisma.order.update({
      where: { id: order.id },
      data: {
        cancellationRequestedAt: null,
        cancellationRejectedAt: now,
      },
    });

    await prisma.orderTracking.create({
      data: {
        orderId: order.id,
        status: order.status as OrderStatus,
        notes: `Solicitud de cancelación rechazada. ${note ? `Motivo: ${note}` : 'El restaurante decidió continuar con el pedido.'}`,
      },
    });

    return { customerUserId: order.customer.userId, driverUserId: null };
  }
}

export async function cancelOrderByRestaurant(
  prisma: PrismaClient,
  orderId: string,
  restaurantUserId: string,
  reason: string
) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: {
        id: orderId,
        restaurant: { userId: restaurantUserId },
      },
      include: {
        customer: { select: { userId: true } },
        driver: { select: { userId: true } },
      },
    });

    if (!order) {
      throw createDomainError(
        404,
        'ORDER_NOT_FOUND',
        'No se encontró el pedido o ya no se puede cancelar.'
      );
    }

    // Claim atómico anti-doble-procesamiento: solo transiciona a CANCELLED si el
    // pedido sigue en un estado cancelable (CONFIRMED/PREPARING). Si otra vía
    // (entrega, otro flujo) ya lo movió de estado, count es 0 y no restauramos
    // stock ni duplicamos efectos.
    const claimed = await tx.order.updateMany({
      where: {
        id: order.id,
        status: { in: [OrderStatus.CONFIRMED, OrderStatus.PREPARING] },
      },
      data: {
        status: OrderStatus.CANCELLED,
        cancelledBy: 'RESTAURANT',
        cancellationReason: reason,
        noDriversAvailable: false,
        driverId: null,
        driverAssignedAt: null,
        isAcceptedByDriver: false,
      },
    });

    if (claimed.count === 0) {
      throw createDomainError(
        409,
        'ORDER_NOT_CANCELLABLE',
        'El pedido ya no se puede cancelar porque cambió su estado.'
      );
    }

    await tx.orderTracking.create({
      data: {
        orderId: order.id,
        status: OrderStatus.CANCELLED,
        notes: `Cancelado por el restaurante. Motivo: ${reason}`,
      },
    });

    if (order.driverId) {
      await tx.driver.updateMany({
        where: { id: order.driverId },
        data: { availability: 'AVAILABLE' as any },
      });
    }

    await createTransferRefundTicket(tx, order.id, `Cancelado por el restaurante. ${reason}`);

    await restoreStockForOrder(tx, order.id);

    return { customerUserId: order.customer.userId, driverUserId: order.driver?.userId ?? null };
  });
}

export async function assignDriverToOrder({
  prisma,
  restaurantUserId,
  orderId,
  driverId,
}: AssignDriverParams) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: {
        id: orderId,
        restaurant: {
          userId: restaurantUserId,
        },
      },
      select: {
        id: true,
        status: true,
        fulfillmentType: true,
        restaurant: {
          select: {
            id: true,
            region: true,
            hasOwnDelivery: true,
          },
        },
        customer: {
          select: {
            id: true,
            user: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!order) {
      throw createDomainError(404, 'ORDER_NOT_FOUND', 'No se encontro el pedido.');
    }

    if (order.restaurant.hasOwnDelivery) {
      throw createDomainError(
        409,
        'OWN_DELIVERY_ORDER',
        'Este restaurante maneja reparto propio para este pedido.'
      );
    }

    if (order.fulfillmentType === 'PICKUP') {
      throw createDomainError(
        409,
        'PICKUP_ORDER',
        'No se puede asignar un repartidor a un pedido para recoger en tienda.'
      );
    }

    if (!assignableRestaurantStatuses.has(order.status)) {
      throw createDomainError(
        409,
        'ORDER_NOT_ASSIGNABLE',
        'El pedido no esta en un estado valido para asignar repartidor.'
      );
    }

    const driver = await tx.driver.findFirst({
      where: {
        id: driverId,
        region: order.restaurant.region,
        status: DriverStatus.ACTIVE,
        availability: {
          in: [DriverAvailability.AVAILABLE, DriverAvailability.BUSY],
        },
      },
      include: {
        user: true,
      },
    });

    if (!driver) {
      throw createDomainError(
        409,
        'DRIVER_NOT_AVAILABLE',
        'El repartidor no esta disponible o no pertenece a la region.'
      );
    }

    // Asignación atómica: solo se asigna si el pedido sigue SIN repartidor.
    // Esto evita que dos procesos concurrentes (JIT job, sweep, auto-assign,
    // asignación manual) asignen el mismo pedido a 2 repartidores distintos
    // (carrera TOCTOU). updateMany con driverId: null es atómico a nivel de
    // fila en la base de datos: si otra transacción ya asignó, count = 0.
    const claimed = await tx.order.updateMany({
      where: {
        id: order.id,
        driverId: null,
        status: { in: [OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.READY] },
      },
      data: {
        driverId: driver.id,
        driverAssignedAt: new Date(),
        isAcceptedByDriver: false,
      },
    });

    if (claimed.count === 0) {
      throw createDomainError(
        409,
        'ORDER_ALREADY_ASSIGNED',
        'El pedido ya tiene un repartidor asignado o ya no es asignable.'
      );
    }

    // Reservar cupo inmediatamente: marcar BUSY al asignar (antes solo al
    // aceptar). Así un driver AVAILABLE no acumula N pedidos sin aceptar
    // durante la ventana de 2 min del JIT.
    await tx.driver.update({
      where: { id: driver.id },
      data: { availability: DriverAvailability.BUSY },
    });

    const updated = await tx.order.findUniqueOrThrow({
      where: { id: order.id },
      select: restaurantOrderWorkflowSelect,
    });

    await tx.orderTracking.create({
      data: {
        orderId: order.id,
        status: order.status,
        notes: `Repartidor asignado: ${driver.user.name}`,
      },
    });

    logger.info('Driver assigned to order', {
      orderId: order.id,
      restaurantUserId,
      driverId,
      driverUserId: updated.driver?.userId,
      status: order.status,
    });

    return updated;
  });
}

export async function extendOrderPreparationTime({
  prisma,
  restaurantUserId,
  orderId,
  additionalMinutes,
}: ExtendPreparationTimeParams) {
  const order = await getRestaurantScopedOrder(prisma, restaurantUserId, orderId);

  if (!order) {
    throw createDomainError(404, 'ORDER_NOT_FOUND', 'No se encontro el pedido.');
  }

  if (order.status !== OrderStatus.CONFIRMED && order.status !== OrderStatus.PREPARING) {
    throw createDomainError(
      409,
      'INVALID_ORDER_TRANSITION',
      'Solo puedes agregar tiempo mientras el pedido esta confirmado o en preparacion.'
    );
  }

  const currentPreparationMinutes = order.preparationTimeMinutes || 0;
  const currentDeadline = order.preparationDeadlineAt
    ? new Date(order.preparationDeadlineAt)
    : new Date();
  const now = new Date();

  // Si el pedido ya está vencido, usamos el momento actual como base
  const effectiveDeadline = currentDeadline < now ? now : currentDeadline;
  const currentEta = new Date(order.estimatedDeliveryTime);

  const nextDeadline = new Date(effectiveDeadline.getTime() + additionalMinutes * 60 * 1000);

  // Calculamos el tiempo real que se está desplazando la fecha límite original
  const actualAddedMs = nextDeadline.getTime() - currentDeadline.getTime();
  const actualAddedMinutes = Math.round(actualAddedMs / 60000);

  const nextEta = new Date(currentEta.getTime() + actualAddedMs);

  // Pedido programado (entrega/recogida en una hora acordada): al agregar tiempo
  // la hora acordada también debe desplazarse, o seguiría apareciendo "rezagado"
  // aunque el restaurante ya extendió el plazo. Se recalcula el deadline de
  // preparación igual que al aceptar el pedido (hora - trayecto estimado).
  const hasScheduledDelivery = Boolean(order.scheduledDeliveryAt);
  const travelMinutes = hasScheduledDelivery
    ? order.fulfillmentType === 'PICKUP'
      ? 0
      : estimateDeliveryTravelMinutes(order.restaurant, order)
    : 0;
  const nextScheduledDeliveryAt = hasScheduledDelivery
    ? new Date(new Date(order.scheduledDeliveryAt!).getTime() + actualAddedMs)
    : null;
  const nextScheduledDeadline = nextScheduledDeliveryAt
    ? new Date(nextScheduledDeliveryAt.getTime() - travelMinutes * 60 * 1000)
    : null;

  const updatedOrder = await prisma.$transaction(async (tx) => {
    const updated = await tx.order.update({
      where: { id: order.id },
      data: {
        preparationTimeMinutes: currentPreparationMinutes + actualAddedMinutes,
        preparationDeadlineAt: nextScheduledDeadline ?? nextDeadline,
        etaExtendedMinutes: (order.etaExtendedMinutes || 0) + actualAddedMinutes,
        estimatedDeliveryTime: nextScheduledDeliveryAt ?? nextEta,
        ...(nextScheduledDeliveryAt
          ? { scheduledDeliveryAt: nextScheduledDeliveryAt }
          : {}),
        overdueAlertLevel: 0,
        overdueAlertedAt: null,
        scheduledReminderSentAt: null,
      },
      select: restaurantOrderWorkflowSelect,
    });

    await tx.orderTracking.create({
      data: {
        orderId: order.id,
        status: order.status,
        notes: `${getBusinessArticleCapitalized(order.restaurant?.businessType)} ${getBusinessRef(order.restaurant?.businessType)} agrego ${additionalMinutes} min al tiempo de preparacion. Nueva ETA: ${nextEta.toISOString()}.`,
      },
    });

    return updated;
  });

  logger.info('Restaurant extended preparation time', {
    orderId: order.id,
    restaurantUserId,
    additionalMinutes,
    nextEta,
  });

  appEvents.emit('order.status_changed', {
    orderId: order.id,
    status: order.status,
    initiator: { id: restaurantUserId, role: 'RESTAURANT' },
  });

  return updatedOrder;
}

export async function rescheduleDeliveryTime({
  prisma,
  restaurantUserId,
  orderId,
  estimatedDeliveryAt,
}: RescheduleDeliveryParams) {
  const order = await getRestaurantScopedOrder(prisma, restaurantUserId, orderId);

  if (!order) {
    throw createDomainError(404, 'ORDER_NOT_FOUND', 'No se encontro el pedido.');
  }

  if (order.status !== OrderStatus.CONFIRMED && order.status !== OrderStatus.PREPARING) {
    throw createDomainError(
      409,
      'INVALID_ORDER_TRANSITION',
      'Solo puedes reprogramar la entrega mientras el pedido esta confirmado o en preparacion.'
    );
  }

  const newEta = new Date(estimatedDeliveryAt);

  const updatedOrder = await prisma.$transaction(async (tx) => {
    const updated = await tx.order.update({
      where: { id: order.id },
      data: {
        estimatedDeliveryTime: newEta,
        scheduledDeliveryAt: newEta,
        overdueAlertLevel: 0,
        overdueAlertedAt: null,
        scheduledReminderSentAt: null,
      },
      select: restaurantOrderWorkflowSelect,
    });

    await tx.orderTracking.create({
      data: {
        orderId: order.id,
        status: order.status,
        notes: `Se reprogramo la entrega para ${newEta.toLocaleString('es-MX', { dateStyle: 'long', timeStyle: 'short' })}.`,
      },
    });

    return updated;
  });

  logger.info('Restaurant rescheduled delivery', {
    orderId: order.id,
    restaurantUserId,
    newEta,
  });

  appEvents.emit('order.status_changed', {
    orderId: order.id,
    status: order.status,
    initiator: { id: restaurantUserId, role: 'RESTAURANT' },
  });

  return updatedOrder;
}

export async function getDriverScopedOrder(
  prisma: PrismaClient,
  driverUserId: string,
  orderId: string
) {
  return prisma.order.findFirst({
    where: {
      id: orderId,
      driver: {
        userId: driverUserId,
      },
    },
    select: driverScopedOrderSelect,
  });
}

export async function updateOrderStatusByDriver({
  prisma,
  driverUserId,
  orderId,
  action,
  pin,
}: DriverOrderActionParams) {
  const order = await getDriverScopedOrder(prisma, driverUserId, orderId);

  if (!order || !order.driver) {
    throw createDomainError(
      404,
      'ORDER_NOT_FOUND',
      'No se encontro el pedido asignado al repartidor.'
    );
  }

  const driver = order.driver;

  if (action === 'accept') {
    // Block suspended drivers from accepting orders
    if (driver.status !== DriverStatus.ACTIVE) {
      throw createDomainError(
        409,
        'DRIVER_SUSPENDED',
        'No puedes aceptar pedidos mientras tu cuenta esté suspendida. Dirígete a tu billetera para liquidar tu deuda.'
      );
    }

    // Nota: el cupo máximo de pedidos activos se reserva al ASIGNAR (ver
    // assignDriverToOrder), no al aceptar. Validarlo aquí podría bloquear la
    // aceptación de un pedido ya asignado y dejarlo varado sin salida.

    return prisma.$transaction(async (tx) => {
      // Claim guardado: solo se acepta si el pedido SIGUE asignado a este
      // repartidor y pendiente de aceptación. Evita la carrera con la expulsión
      // automática del JIT (2 min) y la reasignación a otro repartidor: si el
      // pedido ya cambió de dueño, count = 0 y se informa al driver.
      const claimed = await tx.order.updateMany({
        where: {
          id: order.id,
          driverId: driver.id,
          isAcceptedByDriver: false,
          status: { in: [OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.READY] },
        },
        data: {
          driverPlatformFee: driver.platformFeePerOrder || 0,
          isAcceptedByDriver: true,
        },
      });

      if (claimed.count === 0) {
        throw createDomainError(
          409,
          'ORDER_STATE_CHANGED',
          'El pedido ya no está asignado a ti o ya no requiere tu confirmación. Actualiza tu panel.'
        );
      }

      const updatedOrder = await tx.order.findUniqueOrThrow({
        where: { id: order.id },
        select: restaurantOrderWorkflowSelect,
      });

      await tx.driver.update({
        where: { id: driver.id },
        data: {
          availability: DriverAvailability.BUSY,
        },
      });

      await tx.orderTracking.create({
        data: {
          orderId: order.id,
          status: order.status,
          notes: 'Repartidor acepto el pedido.',
        },
      });

      logger.info('Driver accepted order', {
        orderId: order.id,
        driverUserId,
        status: order.status,
      });

      return updatedOrder;
    });
  }

  if (action === 'reject') {
    return prisma.$transaction(async (tx) => {
      // Release guardado: solo libera el pedido si SIGUE asignado a este
      // repartidor. Si ya fue expulsado y reasignado a otro, count = 0 y no
      // se toca el pedido del nuevo dueño ni se cuenta un rechazo ajeno.
      const released = await tx.order.updateMany({
        where: {
          id: order.id,
          driverId: driver.id,
          status: { in: [OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.READY] },
        },
        data: {
          driverId: null,
          driverAssignedAt: null,
          isAcceptedByDriver: false,
          noDriversAvailable: false,
        },
      });

      if (released.count === 0) {
        throw createDomainError(
          409,
          'ORDER_STATE_CHANGED',
          'El pedido ya no está asignado a ti. Actualiza tu panel.'
        );
      }

      const updatedOrder = await tx.order.findUniqueOrThrow({
        where: { id: order.id },
        select: restaurantOrderWorkflowSelect,
      });

      // Registrar que este repartidor rechazo la orden (máximo 2 veces)
      await incrementDriverRejection(order.id, driver.id);

      // Recalcular disponibilidad real: si aún tiene pedidos activos, sigue BUSY
      const remainingActiveAfterReject = await tx.order.count({
        where: {
          driverId: driver.id,
          id: { not: order.id },
          status: {
            in: [
              OrderStatus.CONFIRMED,
              OrderStatus.PREPARING,
              OrderStatus.READY,
              OrderStatus.PICKED_UP,
              OrderStatus.IN_TRANSIT,
            ],
          },
        },
      });

      await tx.driver.update({
        where: { id: driver.id },
        data: {
          availability: remainingActiveAfterReject > 0
            ? DriverAvailability.BUSY
            : DriverAvailability.AVAILABLE,
        },
      });

      await tx.orderTracking.create({
        data: {
          orderId: order.id,
          status: order.status,
          notes: 'Repartidor rechazo el pedido.',
        },
      });

      logger.info('Driver rejected order', {
        orderId: order.id,
        driverUserId,
        status: order.status,
        remainingActiveAfterReject,
      });

      return updatedOrder;
    });
  }

  if (action === 'picked_up') {
    if (order.status !== OrderStatus.READY) {
      throw createDomainError(
        409,
        'INVALID_ORDER_TRANSITION',
        'La accion no es valida para el estado actual del pedido.'
      );
    }

    if (order.handoverPin) {
      throw createDomainError(
        403,
        'HANDOVER_REQUIRED',
        'El pedido requiere que el restaurante confirme la entrega con el PIN. No puedes recogerlo directamente.'
      );
    }

    return prisma.$transaction(async (tx) => {
      // Guardado: exige que el pedido siga siendo de este repartidor y READY.
      const claimed = await tx.order.updateMany({
        where: {
          id: order.id,
          driverId: driver.id,
          status: OrderStatus.READY,
        },
        data: {
          status: OrderStatus.PICKED_UP,
          pickedUpAt: new Date(),
          estimatedDeliveryTime: calculatePickedUpEta(order),
        },
      });

      if (claimed.count === 0) {
        throw createDomainError(
          409,
          'ORDER_STATE_CHANGED',
          'El pedido cambió de estado o de repartidor. Actualiza tu panel.'
        );
      }

      const updatedOrder = await tx.order.findUniqueOrThrow({
        where: { id: order.id },
        select: restaurantOrderWorkflowSelect,
      });

      await tx.orderTracking.create({
        data: {
          orderId: order.id,
          status: OrderStatus.PICKED_UP,
          notes: 'Repartidor recogio el pedido.',
        },
      });

      logger.info('Driver picked up order', {
        orderId: order.id,
        driverUserId,
        fromStatus: order.status,
        toStatus: OrderStatus.PICKED_UP,
      });

      return updatedOrder;
    });
  }

  if (action === 'in_transit') {
    if (order.status !== OrderStatus.PICKED_UP) {
      throw createDomainError(
        409,
        'INVALID_ORDER_TRANSITION',
        'La accion no es valida para el estado actual del pedido.'
      );
    }

    return prisma.$transaction(async (tx) => {
      // Guardado: exige que el pedido siga siendo de este repartidor y PICKED_UP.
      const claimed = await tx.order.updateMany({
        where: {
          id: order.id,
          driverId: driver.id,
          status: OrderStatus.PICKED_UP,
        },
        data: {
          status: OrderStatus.IN_TRANSIT,
          inTransitAt: new Date(),
          estimatedDeliveryTime: calculateInTransitEta(order),
        },
      });

      if (claimed.count === 0) {
        throw createDomainError(
          409,
          'ORDER_STATE_CHANGED',
          'El pedido cambió de estado o de repartidor. Actualiza tu panel.'
        );
      }

      const updatedOrder = await tx.order.findUniqueOrThrow({
        where: { id: order.id },
        select: restaurantOrderWorkflowSelect,
      });

      await tx.orderTracking.create({
        data: {
          orderId: order.id,
          status: OrderStatus.IN_TRANSIT,
          notes: 'Repartidor va en camino.',
        },
      });

      logger.info('Driver started transit for order', {
        orderId: order.id,
        driverUserId,
        fromStatus: order.status,
        toStatus: OrderStatus.IN_TRANSIT,
      });

      return updatedOrder;
    });
  }

  const isNoContactRelease = action === 'safe_place' || action === 'no_show';

  // Bandera para disparar el reabastecimiento inmediato tras la transacción:
  // cuando el repartidor entrega/libera un pedido pero aún le quedan activos
  // (3→2 o 2→1), se le reasigna el siguiente pedido de la zona al instante.
  let shouldRefillFreeSlot = false;

  return prisma.$transaction(async (tx) => {
    const currentOrder = await tx.order.findUnique({
      where: { id: order.id },
      select: { status: true, deliveryPin: true, handoverPin: true, paymentMethod: true },
    });

    if (!currentOrder || currentOrder.status !== OrderStatus.IN_TRANSIT) {
      throw createDomainError(
        409,
        'INVALID_ORDER_TRANSITION',
        'La accion no es valida para el estado actual del pedido.'
      );
    }

    // Normal deliveries require the customer's PIN for non-cash orders.
    // The no-contact release actions (safe_place / no_show) skip the PIN: the
    // transfer was already paid or the cash order is turned into a debt.
    if (
      !isNoContactRelease &&
      currentOrder.paymentMethod !== PaymentMethod.CASH &&
      (currentOrder.deliveryPin || currentOrder.handoverPin) &&
      currentOrder.deliveryPin !== pin &&
      currentOrder.handoverPin !== pin
    ) {
      throw createDomainError(
        403,
        'INVALID_DELIVERY_PIN',
        'El PIN de entrega proporcionado por el cliente es incorrecto.'
      );
    }

    // CASH payments are marked completed only on a normal handover. On a
    // "cliente no salió" release the money was never collected, so the order
    // keeps its unpaid status and a CustomerBillingSettlement is created instead.
    const shouldMarkCashCompleted =
      currentOrder.paymentMethod === PaymentMethod.CASH && action === 'delivered';

    // On a "cliente no salió" release the driver never collected the cash, so the
    // order must generate NOTHING for the driver: no delivery earnings and no
    // platform commission owed. Zeroing both fields keeps it out of the driver's
    // wallet earnings, settlement revenue and debt/suspension aggregations.
    const shouldExemptDriverBilling = action === 'no_show';

    const updatedOrder = await (async () => {
      // Guardado: exige que el pedido siga siendo de este repartidor y IN_TRANSIT
      // (la lectura de currentOrder arriba ya validó el estado; esto lo revalida
      // de forma atómica junto con la escritura).
      const claimed = await tx.order.updateMany({
        where: {
          id: order.id,
          driverId: driver.id,
          status: OrderStatus.IN_TRANSIT,
        },
        data: {
          status: OrderStatus.DELIVERED,
          deliveredAt: new Date(),
          actualDeliveryTime: new Date(),
          estimatedDeliveryTime: new Date(),
          ...(shouldMarkCashCompleted ? { paymentStatus: PaymentStatus.COMPLETED } : {}),
          ...(shouldExemptDriverBilling ? { deliveryFee: 0, driverPlatformFee: 0 } : {}),
          ...(action === 'no_show' ? { noShowReleasedAt: new Date() } : {}),
        },
      });

      if (claimed.count === 0) {
        throw createDomainError(
          409,
          'ORDER_STATE_CHANGED',
          'El pedido cambió de estado o de repartidor. Actualiza tu panel.'
        );
      }

      return tx.order.findUniqueOrThrow({
        where: { id: order.id },
        select: restaurantOrderWorkflowSelect,
      });
    })();

    const remainingActiveOrdersCount = await tx.order.count({
      where: {
        driverId: driver.id,
        id: { not: order.id },
        status: {
          in: [
            OrderStatus.CONFIRMED,
            OrderStatus.PREPARING,
            OrderStatus.READY,
            OrderStatus.PICKED_UP,
            OrderStatus.IN_TRANSIT,
          ],
        },
      },
    });

    if (remainingActiveOrdersCount === 0) {
      const jitTarget = new Date(Date.now() + 8 * 60 * 1000);
      const pendingOrderInRegion = await tx.order.findFirst({
        where: {
          driverId: null,
          status: { in: [OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.READY] },
          restaurant: {
            region: driver.region,
            hasOwnDelivery: false,
          },
          OR: [
            { preparationDeadlineAt: { lte: jitTarget } },
            { preparationDeadlineAt: null, estimatedDeliveryTime: { lte: jitTarget } },
          ],
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, restaurant: { select: { userId: true } } },
      });

      if (pendingOrderInRegion) {
        // Asignación atómica: evita que otro proceso (JIT job, sweep,
        // asignación manual) asigne el mismo pedido a otro repartidor en
        // paralelo. Si otra transacción ganó la carrera, count = 0 y
        // simplemente se omite este pedido.
        const claimed = await tx.order.updateMany({
          where: {
            id: pendingOrderInRegion.id,
            driverId: null,
            status: { in: [OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.READY] },
          },
          data: {
            driverId: driver.id,
          },
        });

        if (claimed.count > 0) {
          await tx.orderTracking.create({
            data: {
              orderId: pendingOrderInRegion.id,
              status: OrderStatus.CONFIRMED,
              notes: `Repartidor auto-asignado por cola libre (Estrategia Anti-Rezago): ${driver.user.name}`,
            },
          });

          await tx.driver.update({
            where: { id: driver.id },
            data: {
              availability: DriverAvailability.BUSY,
            },
          });

          appEvents.emit('order.driver_auto_assigned_on_free_slot', {
            orderId: pendingOrderInRegion.id,
            driverId: driver.id,
            restaurantUserId: pendingOrderInRegion.restaurant.userId,
          });
        } else {
          // Otra transacción concurrente ya asignó el pedido pendiente a otro
          // repartidor. Este repartidor queda libre para futuros pedidos.
          await tx.driver.update({
            where: { id: driver.id },
            data: {
              availability: DriverAvailability.AVAILABLE,
            },
          });
        }
      } else {
        await tx.driver.update({
          where: { id: driver.id },
          data: {
            availability: DriverAvailability.AVAILABLE,
          },
        });
      }
    } else {
      await tx.driver.update({
        where: { id: driver.id },
        data: {
          availability: DriverAvailability.BUSY,
        },
      });
      // El repartidor liberó un hueco (3→2 o 2→1): reabastecerlo al instante.
      shouldRefillFreeSlot = true;
    }

    const deliveryTrackingNote =
      action === 'safe_place'
        ? 'Pedido dejado en un lugar seguro por el repartidor (sin contacto con el cliente).'
        : action === 'no_show'
          ? 'Cliente no salio a recibir. Pedido liberado por el repartidor.'
          : 'Pedido entregado al cliente.';

    await tx.orderTracking.create({
      data: {
        orderId: order.id,
        status: OrderStatus.DELIVERED,
        notes: deliveryTrackingNote,
      },
    });

    await tx.driver.update({
      where: { id: driver.id },
      data: { totalDeliveries: { increment: 1 } },
    });

    await tx.driverStats.upsert({
      where: { driverId: driver.id },
      update: { totalDeliveries: { increment: 1 } },
      create: { driverId: driver.id, totalDeliveries: 1 },
    });

    logger.info('Driver delivered order', {
      orderId: order.id,
      driverUserId,
      fromStatus: order.status,
      toStatus: OrderStatus.DELIVERED,
    });

    return updatedOrder;
  }).then(async (updatedOrder) => {
    // Reabastecimiento inmediato del hueco liberado (3→2 / 2→1), sin esperar
    // el polling de 30 s del JIT. Best-effort: nunca bloquea la respuesta.
    if (shouldRefillFreeSlot) {
      try {
        await refillDriverFreeSlot(prisma, driver.id);
      } catch (refillErr) {
        logger.warn(`[Refill] No se pudo reabastecer hueco del repartidor ${driver.id}:`, refillErr);
      }
    }
    return updatedOrder;
  });
}

export async function handoverOrderFromRestaurant({
  prisma,
  restaurantUserId,
  orderId,
  pin,
}: {
  prisma: PrismaClient;
  restaurantUserId: string;
  orderId: string;
  pin?: string;
}) {
  // Validate PIN and update attempts OUTSIDE the transaction so throws persist
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { restaurant: true },
  });

  if (!order) {
    throw createDomainError(404, 'ORDER_NOT_FOUND', 'No se encontro el pedido.');
  }

  if (order.restaurant.userId !== restaurantUserId) {
    throw createDomainError(403, 'FORBIDDEN', 'No tienes permiso para modificar este pedido.');
  }

  if (order.status !== OrderStatus.READY) {
    throw createDomainError(
      409,
      'INVALID_ORDER_TRANSITION',
      'El pedido no esta listo para entregar.'
    );
  }

  if (order.handoverPin) {
    if (order.handoverPin !== pin) {
      const newAttempts = (order.handoverPinAttempts || 0) + 1;

      if (newAttempts >= 3) {
        const newPin = Math.floor(1000 + Math.random() * 9000).toString();
        await prisma.order.update({
          where: { id: order.id },
          data: {
            handoverPin: newPin,
            handoverPinAttempts: 0,
            handoverPinUpdatedAt: new Date(),
          },
        });

        logger.warn('Handover PIN exhausted, new PIN generated', {
          orderId: order.id,
          restaurantUserId,
          oldPin: order.handoverPin,
          newPin,
        });

        throw createDomainError(
          403,
          'PIN_RESET',
          'PIN agotado. Se generó un nuevo PIN. Pídelo al repartidor.'
        );
      }

      await prisma.order.update({
        where: { id: order.id },
        data: { handoverPinAttempts: newAttempts },
      });

      throw createDomainError(403, 'INVALID_PIN', `PIN incorrecto. Intento ${newAttempts}/3.`);
    }

    await prisma.order.update({
      where: { id: order.id },
      data: { handoverPinAttempts: 0 },
    });
  }

  return prisma.$transaction(async (tx) => {
    const updatedOrder = await tx.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.PICKED_UP,
        pickedUpAt: new Date(),
        estimatedDeliveryTime: calculatePickedUpEta(order as any),
        ...(order.paymentMethod === PaymentMethod.CASH
          ? { paymentStatus: PaymentStatus.COMPLETED }
          : {}),
      },
      select: restaurantOrderWorkflowSelect,
    });

    await tx.orderTracking.create({
      data: {
        orderId: order.id,
        status: OrderStatus.PICKED_UP,
        notes: 'Restaurante confirmo la entrega al repartidor.',
      },
    });

    logger.info('Restaurant handed over order to driver', {
      orderId: order.id,
      restaurantUserId,
      fromStatus: order.status,
      toStatus: OrderStatus.PICKED_UP,
    });

    return updatedOrder;
  });
}

export async function completePickupByRestaurant({
  prisma,
  restaurantUserId,
  orderId,
  pin,
}: {
  prisma: PrismaClient;
  restaurantUserId: string;
  orderId: string;
  pin?: string;
}) {
  // Validate PIN and update attempts OUTSIDE the transaction so throws persist the count
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { restaurant: true },
  });

  if (!order) {
    throw createDomainError(404, 'ORDER_NOT_FOUND', 'No se encontro el pedido.');
  }

  if (order.restaurant.userId !== restaurantUserId) {
    throw createDomainError(403, 'FORBIDDEN', 'No tienes permiso para modificar este pedido.');
  }

  if (order.status !== OrderStatus.READY) {
    throw createDomainError(
      409,
      'INVALID_ORDER_TRANSITION',
      'El pedido no esta listo para recoger.'
    );
  }

  if (order.fulfillmentType !== 'PICKUP') {
    throw createDomainError(
      400,
      'INVALID_FULFILLMENT_TYPE',
      'Solo pedidos para recoger en sucursal pueden marcarse como recogidos.'
    );
  }

  if (order.paymentMethod === PaymentMethod.TRANSFER) {
    if (!order.pickupPin) {
      throw createDomainError(
        400,
        'NO_PICKUP_PIN',
        'Este pedido no tiene un PIN de recoleccion asignado.'
      );
    }

    // Auto-migrate old alphanumeric PINs (A3ZS) to numeric-only
    if (/[A-Za-z]/.test(order.pickupPin)) {
      const newPin = Math.floor(1000 + Math.random() * 9000).toString();
      await prisma.order.update({
        where: { id: order.id },
        data: {
          pickupPin: newPin,
          handoverPinAttempts: 0,
          handoverPinUpdatedAt: new Date(),
        },
      });

      logger.warn('Pickup PIN auto-migrated from legacy format to numeric', {
        orderId: order.id,
        restaurantUserId,
        oldPin: order.pickupPin,
        newPin,
      });

      throw createDomainError(
        403,
        'PIN_RESET',
        'PIN actualizado a formato numerico. Pidelo al cliente.'
      );
    }

    if (!pin || pin.trim() === '' || pin !== order.pickupPin) {
      const newAttempts = (order.handoverPinAttempts || 0) + 1;

      if (newAttempts >= 3) {
        const newPin = Math.floor(1000 + Math.random() * 9000).toString();
        await prisma.order.update({
          where: { id: order.id },
          data: {
            pickupPin: newPin,
            handoverPinAttempts: 0,
            handoverPinUpdatedAt: new Date(),
          },
        });

        logger.warn('Pickup PIN exhausted, new PIN generated', {
          orderId: order.id,
          restaurantUserId,
          oldPin: order.pickupPin,
          newPin,
        });

        throw createDomainError(
          403,
          'PIN_RESET',
          'PIN agotado. Se genero un nuevo PIN. Pidelo al cliente.'
        );
      }

      await prisma.order.update({
        where: { id: order.id },
        data: { handoverPinAttempts: newAttempts },
      });

      throw createDomainError(403, 'INVALID_PIN', `PIN incorrecto. Intento ${newAttempts}/3.`);
    }

    await prisma.order.update({
      where: { id: order.id },
      data: { handoverPinAttempts: 0 },
    });
  }

  return prisma.$transaction(async (tx) => {
    const updatedOrder = await tx.order.update({
      where: { id: orderId },
      data: {
        status: OrderStatus.COMPLETED,
        completedAt: new Date(),
        ...(order.paymentMethod === PaymentMethod.CASH
          ? { paymentStatus: PaymentStatus.COMPLETED }
          : {}),
      },
      select: restaurantOrderWorkflowSelect,
    });

    await tx.orderTracking.create({
      data: {
        orderId: order.id,
        status: OrderStatus.COMPLETED,
        notes: 'Pedido recogido por el cliente.',
      },
    });

    logger.info('Restaurant marked pickup order as completed', {
      orderId: order.id,
      restaurantUserId,
      fromStatus: order.status,
      toStatus: OrderStatus.COMPLETED,
    });

    return updatedOrder;
  });
}

export async function getAvailableDriversForRestaurant(
  prisma: PrismaClient,
  restaurantUserId: string,
  orderId?: string,
  excludeDriverIds: string[] = [],
  relaxRestrictions: boolean = false
) {
  const restaurant = await prisma.restaurant.findUnique({
    where: {
      userId: restaurantUserId,
    },
  });

  if (!restaurant) {
    throw createDomainError(
      404,
      'RESTAURANT_NOT_FOUND',
      'No se encontro el restaurante asociado a este usuario.'
    );
  }

  if (restaurant.status !== RestaurantStatus.ACTIVE) {
    return [];
  }

  // Obtener la orden objetivo si se proporciona orderId para calcular la distancia
  let targetOrder: { latitude: number | null; longitude: number | null } | null = null;
  if (orderId) {
    targetOrder = await prisma.order.findUnique({
      where: { id: orderId },
      select: { latitude: true, longitude: true },
    });
  }

  const drivers = await prisma.driver.findMany({
    where: {
      region: restaurant.region,
      status: DriverStatus.ACTIVE,
      id: excludeDriverIds.length > 0 ? { notIn: excludeDriverIds } : undefined,
      OR: relaxRestrictions
        ? [
            { availability: DriverAvailability.AVAILABLE },
            { availability: DriverAvailability.BUSY },
          ]
        : [
            { availability: DriverAvailability.AVAILABLE },
            {
              availability: DriverAvailability.BUSY,
              orders: {
                some: {
                  status: { in: [OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.READY] },
                },
              },
            },
          ],
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          phone: true,
        },
      },
      orders: {
        where: {
          status: {
            in: [
              OrderStatus.CONFIRMED,
              OrderStatus.PREPARING,
              OrderStatus.READY,
              OrderStatus.PICKED_UP,
              OrderStatus.IN_TRANSIT,
            ],
          },
        },
        select: {
          id: true,
          driverAssignedAt: true,
          latitude: true,
          longitude: true,
          restaurant: {
            select: {
              latitude: true,
              longitude: true,
            },
          },
        },
      },
    },
    orderBy: [{ rating: 'desc' }, { totalDeliveries: 'desc' }],
  });

  // Filtrar repartidores basados en las reglas de "Smart Stacking"
  return drivers.filter((driver) => {
    // Si esta disponible, siempre es valido
    if (driver.availability === DriverAvailability.AVAILABLE) {
      return true;
    }

    // Si esta OCUPADO, verificamos las condiciones de apilamiento:
    const activeOrders = driver.orders;

    // 1. Maximo 3 pedidos (ya tiene 1 o 2 activos, si le sumamos este serian 3)
    // This check is now handled by autoAssignDriver

    // Si relajamos restricciones, no validamos proximidad ni restaurante del pedido existente
    if (relaxRestrictions) {
      return true;
    }

    // 2. Proximidad y Compatibilidad de Ruta (Cross-Restaurant Smart Stacking)
    // Para apilar, al menos UNO de los pedidos actuales debe ser compatible con el nuevo pedido.
    // Compatibilidad significa: restaurante a <= 1 km Y destino a <= 2.5 km.
    if (
      targetOrder?.latitude &&
      targetOrder?.longitude &&
      restaurant.latitude &&
      restaurant.longitude &&
      activeOrders.length > 0
    ) {
      let isCompatibleRoute = false;

      for (const existingOrder of activeOrders) {
        if (
          existingOrder.latitude &&
          existingOrder.longitude &&
          existingOrder.restaurant?.latitude &&
          existingOrder.restaurant?.longitude
        ) {
          const restaurantDistance = getDistanceInKm(
            { latitude: restaurant.latitude, longitude: restaurant.longitude },
            {
              latitude: existingOrder.restaurant.latitude,
              longitude: existingOrder.restaurant.longitude,
            }
          );

          const customerDistance = getDistanceInKm(
            { latitude: targetOrder.latitude, longitude: targetOrder.longitude },
            { latitude: existingOrder.latitude, longitude: existingOrder.longitude }
          );

          if (restaurantDistance <= 1 && customerDistance <= 2.5) {
            isCompatibleRoute = true;
            break;
          }
        }
      }

      if (!isCompatibleRoute) {
        return false; // Ninguna de las rutas activas es compatible con este nuevo pedido
      }
    }

    return true;
  });
}

export type AutoAssignResult = {
  success: boolean;
  alreadyAssigned?: boolean;
  driver?: { id: string; userId: string; user: { name: string } };
  order?: any;
};

export async function autoAssignDriver(
  prisma: PrismaClient,
  orderId: string,
  restaurantUserId: string,
  excludeDriverId?: string
): Promise<AutoAssignResult> {
  const orderType = await prisma.order.findUnique({
    where: { id: orderId },
    select: { fulfillmentType: true, supportRestaurantId: true },
  });
  if (orderType?.fulfillmentType === 'PICKUP') {
    return { success: false as const };
  }

  // Un pedido ya tomado por un restaurante aliado (apoyo a red) no debe
  // reasignarse a un repartidor de la plataforma.
  if (orderType?.supportRestaurantId) {
    return { success: false as const };
  }

  const excludedDriverIds = await getExcludedDriverIds(orderId);
  const excludeIds = new Set(excludedDriverIds);

  if (excludeDriverId) {
    excludeIds.add(excludeDriverId);
  }
  const excludeDriverIdsArray = Array.from(excludeIds);

  // Datos de contexto del pedido/restaurante, cargados una sola vez para
  // calcular distancia y compatibilidad de ruta en todos los pases.
  const [routingContextRestaurant, routingContextOrder] = await Promise.all([
    prisma.restaurant.findUnique({
      where: { userId: restaurantUserId },
      select: { latitude: true, longitude: true },
    }),
    prisma.order.findUnique({
      where: { id: orderId },
      select: { latitude: true, longitude: true },
    }),
  ]);

  const tryAssign = async (
    drivers: DriverCandidate[],
    options: { allowOverload?: boolean } = {}
  ): Promise<{
    driver: DriverCandidate;
    order: any;
  } | 'ALREADY_ASSIGNED' | null> => {
    if (drivers.length === 0) return null;

    // La carga actual se pondera con peso alto dentro del score (LOAD_PER_ACTIVE)
    // y el orden final lo decide el score, no la posición en base de datos.
    // Conteo batch (una sola query) de todos los pedidos activos de los candidatos.
    const activeOrdersCounts = await prisma.order.groupBy({
      by: ['driverId'],
      where: {
        driverId: { in: drivers.map((d) => d.id) },
        status: { in: ['CONFIRMED', 'PREPARING', 'READY', 'PICKED_UP', 'IN_TRANSIT'] as any },
      },
      _count: { _all: true },
    });
    const activeOrdersCountById = new Map<string, number>(
      activeOrdersCounts.map((row) => [row.driverId!, row._count._all])
    );

    const orderedCandidates = drivers
      .map((candidate) => {
        const activeOrdersCount = activeOrdersCountById.get(candidate.id) ?? 0;
        const distanceKm = driverDistanceToRestaurantKm(candidate, routingContextRestaurant);
        const routeCompatible =
          routingContextRestaurant?.latitude != null &&
          routingContextRestaurant.longitude != null &&
          routingContextOrder?.latitude != null &&
          routingContextOrder.longitude != null &&
          isRouteCompatibleWithNewOrder({
            restaurant: {
              latitude: routingContextRestaurant.latitude,
              longitude: routingContextRestaurant.longitude,
            },
            newOrder: {
              latitude: routingContextOrder.latitude,
              longitude: routingContextOrder.longitude,
            },
            activeOrders: candidate.orders ?? [],
          });

        const score = scoreDriverCandidate({
          activeOrdersCount,
          distanceKm,
          routeCompatible,
          idleMinutes: minutesSinceLastAssignment(candidate),
          rating: candidate.rating ?? 0,
        });

        return { candidate, activeOrdersCount, score };
      })
      .sort((a, b) => b.score - a.score);

    for (const { candidate } of orderedCandidates) {
      // En pase normal, cada repartidor lleva máx. 3 pedidos activos.
      // En el pase de "overload" (emergencia) se permite exceder el tope
      // normal, pero hasta un máximo configurable para evitar saturar a un
      // único repartidor con todo el pool de pedidos.
      const maxActive = options.allowOverload ? getOverloadMaxActiveOrders() : getMaxActiveOrders();

      // Mutex distribuido por repartidor: la evaluación del tope + el claim del
      // pedido se serializan por driver. Si otro proceso concurrente (JIT job,
      // sweep, auto-assign) está evaluando o acabó de asignar a este repartidor,
      // se devuelve null y saltamos al siguiente candidato. Esto cierra la
      // ventana TOCTOU en la que el groupBy (no atómico) podía ver un driver con
      // cupo libre que ya había tomado otro claim.
      const assignedOrder = await withDriverCapacityLock<
        Awaited<ReturnType<typeof assignDriverToOrder>> | 'ALREADY_ASSIGNED' | null
      >(
        candidate.id,
        async () => {
          // Recalcular la carga DENTRO del lock para garantizar frescura antes
          // del claim (ya sin competencia por este driver).
          const freshCount = await prisma.order.groupBy({
            by: ['driverId'],
            where: {
              driverId: candidate.id,
              status: { in: ['CONFIRMED', 'PREPARING', 'READY', 'PICKED_UP', 'IN_TRANSIT'] as any },
            },
            _count: { _all: true },
          });
          const freshActive = (freshCount[0]?._count?._all) ?? 0;
          if (freshActive >= maxActive) return null;

          let claimed: Awaited<ReturnType<typeof assignDriverToOrder>>;
          try {
            claimed = await assignDriverToOrder({
              prisma,
              restaurantUserId,
              orderId,
              driverId: candidate.id,
            });
          } catch (assignErr) {
            // Otra transacción concurrente (JIT job, sweep, asignación manual)
            // ya asignó este pedido a otro repartidor. No es un fallo: hay que
            // detener la cascada sin marcarlo como "sin repartidor".
            if (isAppError(assignErr) && assignErr.code === 'ORDER_ALREADY_ASSIGNED') {
              return 'ALREADY_ASSIGNED';
            }
            throw assignErr;
          }

          try {
            const existingOrders = await prisma.order.findMany({
              where: {
                driverId: candidate.id,
                id: { not: orderId },
                status: { in: ['CONFIRMED', 'PREPARING', 'READY', 'PICKED_UP', 'IN_TRANSIT'] as any },
              },
              select: {
                id: true,
                batchId: true,
                restaurantId: true,
                latitude: true,
                longitude: true,
                status: true,
              },
            });

            if (existingOrders.length > 0) {
              const newOrderData = await prisma.order.findUnique({
                where: { id: orderId },
                select: { restaurantId: true, latitude: true, longitude: true },
              });

              if (newOrderData) {
                const sameRestaurantOrders = existingOrders.filter(
                  (o) =>
                    o.restaurantId === newOrderData.restaurantId &&
                    // Solo agrupar si el driver aún no ha recogido (está esperando en el restaurante)
                    (o.status === 'CONFIRMED' || o.status === 'PREPARING')
                );
                const allOrders = [
                  ...sameRestaurantOrders,
                  { id: orderId, ...newOrderData, batchId: null, status: '' },
                ];
                if (allOrders.length >= 2) {
                  const { createOrJoinBatch } = await import('../services/batch.service');
                  const batchOrders = sameRestaurantOrders
                    .filter((o) => o.latitude != null && o.longitude != null)
                    .map((o) => ({
                      id: o.id,
                      batchId: o.batchId || null,
                      latitude: o.latitude!,
                      longitude: o.longitude!,
                      restaurantId: o.restaurantId,
                    }));
                  if (
                    batchOrders.length > 0 &&
                    newOrderData.latitude != null &&
                    newOrderData.longitude != null
                  ) {
                    await createOrJoinBatch(
                      prisma as any,
                      orderId,
                      batchOrders,
                      newOrderData.latitude,
                      newOrderData.longitude
                    );
                  }
                }
              }
            }
          } catch (batchErr) {
            logger.warn(`[Batch] No se pudo crear batch para orden ${orderId}:`, batchErr);
          }

          return claimed;
        }
      );

      if (assignedOrder === 'ALREADY_ASSIGNED') {
        return 'ALREADY_ASSIGNED';
      }
      if (!assignedOrder) continue;

      void sendPushNotification(candidate.userId, {
        title: '🛵 Nuevo pedido asignado',
        body: `${assignedOrder.restaurant.name} — Gana $${Number(assignedOrder.deliveryFee || 0).toFixed(2)} · ${Number(assignedOrder.deliveryDistanceKm || 0).toFixed(1)} km`,
        icon: '/app-icon-192.png',
        badge: '/badge.png',
        vibrate: [500, 200, 500, 200, 500],
        requireInteraction: true,
        sound: '/sounds/notifica.wav',
        nativeRing: true,
        nativeRingExpiresAt: Date.now() + 2 * 60 * 1000,
        data: {
          orderId: assignedOrder.id,
          orderReference: assignedOrder.orderReference,
          url: `/?orderId=${assignedOrder.id}`,
        },
        tag: `order-assigned-${assignedOrder.id}`,
      }).catch((pushErr) => {
        logger.error(`[Push] Fallo al notificar nueva asignación al repartidor ${candidate.userId}`, pushErr);
      });

      // Si la orden ya está READY al asignar, enviar también push de recogida
      if (assignedOrder.status === OrderStatus.READY) {
        void sendPushNotification(candidate.userId, {
          title: 'Pedido listo para recoger',
          body: `El pedido de ${assignedOrder.restaurant.name} está listo. Pasa a recogerlo.`,
          icon: '/app-icon-192.png',
          badge: '/badge.png',
          vibrate: [500, 200, 500],
          requireInteraction: true,
          tag: `order-ready-${assignedOrder.id}`,
          data: {
            orderId: assignedOrder.id,
            event: 'order:ready',
            url: `/?orderId=${assignedOrder.id}`,
          },
        }).catch((pushErr) => {
          logger.error(`[Push] Fallo al notificar "listo para recoger" al repartidor ${candidate.userId}`, pushErr);
        });
      }

      return { driver: candidate, order: assignedOrder };
    }
    return null;
  };

  const strictResult = await tryAssign(
    await getAvailableDriversForRestaurant(
      prisma,
      restaurantUserId,
      orderId,
      excludeDriverIdsArray,
      false
    )
  );
  if (strictResult === 'ALREADY_ASSIGNED') {
    return { success: true as const, alreadyAssigned: true as const };
  }
  if (strictResult) return { success: true as const, ...strictResult };

  const relaxedResult = await tryAssign(
    await getAvailableDriversForRestaurant(
      prisma,
      restaurantUserId,
      orderId,
      excludeDriverIdsArray,
      true
    )
  );
  if (relaxedResult === 'ALREADY_ASSIGNED') {
    return { success: true as const, alreadyAssigned: true as const };
  }
  if (relaxedResult) return { success: true as const, ...relaxedResult };

  // ── Degradación progresiva (emergencia) ───────────────────────────────
  // Si estricto y relajado fallaron, primero relajamos el tope de pedidos
  // activos (permite repartidores con 3+ pedidos), y después intentamos con
  // repartidores de la misma zona aunque estén BUSY sin pedidos activos o
  // con rutas incompatibles. Con esto el pool nunca queda "congelado".

  const overloadedResult = await tryAssign(
    await getAvailableDriversForRestaurant(
      prisma,
      restaurantUserId,
      orderId,
      excludeDriverIdsArray,
      true
    ),
    { allowOverload: true }
  );
  if (overloadedResult === 'ALREADY_ASSIGNED') {
    return { success: true as const, alreadyAssigned: true as const };
  }
  if (overloadedResult) return { success: true as const, ...overloadedResult };

  const lastResortResult = await tryAssign(
    await getAnyDriverForRestaurant(
      prisma,
      restaurantUserId,
      excludeDriverIdsArray
    ),
    { allowOverload: true }
  );
  if (lastResortResult === 'ALREADY_ASSIGNED') {
    return { success: true as const, alreadyAssigned: true as const };
  }
  if (lastResortResult) return { success: true as const, ...lastResortResult };

  return { success: false as const };
}

/**
 * Último recurso de auto-asignación: repartidores ACTIVE de la misma zona
 * (incluso OFFLINE no se consideran, pero sí BUSY sin pedidos activos y
 * AVAILABLE que hayan sido excluidos por smart-stacking estricto).
 * Ignora disponibilidad para no dejar pedidos sin repartidor.
 */
async function getAnyDriverForRestaurant(
  prisma: PrismaClient,
  restaurantUserId: string,
  excludeDriverIds: string[]
) {
  const restaurant = await prisma.restaurant.findUnique({
    where: { userId: restaurantUserId },
  });
  if (!restaurant || restaurant.status !== RestaurantStatus.ACTIVE) {
    return [];
  }

  const drivers = await prisma.driver.findMany({
    where: {
      region: restaurant.region,
      status: DriverStatus.ACTIVE,
      availability: { in: [DriverAvailability.AVAILABLE, DriverAvailability.BUSY] },
      id: excludeDriverIds.length > 0 ? { notIn: excludeDriverIds } : undefined,
    },
    include: {
      user: {
        select: { id: true, name: true, phone: true },
      },
      orders: {
        where: {
          status: {
            in: [
              OrderStatus.CONFIRMED,
              OrderStatus.PREPARING,
              OrderStatus.READY,
              OrderStatus.PICKED_UP,
              OrderStatus.IN_TRANSIT,
            ],
          },
        },
        select: {
          id: true,
          driverAssignedAt: true,
          latitude: true,
          longitude: true,
          restaurant: {
            select: {
              latitude: true,
              longitude: true,
            },
          },
        },
      },
    },
    orderBy: [{ rating: 'desc' }, { totalDeliveries: 'desc' }],
    take: 10,
  });

  return drivers.map((d) => ({
    id: d.id,
    userId: d.userId,
    rating: d.rating,
    totalDeliveries: d.totalDeliveries,
    currentLatitude: d.currentLatitude,
    currentLongitude: d.currentLongitude,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    orders: d.orders,
    user: { id: d.user.id, name: d.user.name },
  }));
}

/**
 * Reabastecimiento inmediato del hueco de un repartidor BUSY que acaba de
 * liberar un pedido (3→2 o 2→1). Encuentra el siguiente pedido pendiente de su
 * zona (FIFO por createdAt, dentro de la ventana JIT), valida la compatibilidad
 * de ruta (smart stacking) y lo asigna de forma atómica a ESTE repartidor, sin
 * esperar el polling de 30 s del JIT. Emite las notificaciones de asignación.
 */
export async function refillDriverFreeSlot(
  prisma: PrismaClient,
  driverId: string,
  options: { emitNotifications?: boolean } = {}
): Promise<{ order: any; driver: { id: string; userId: string; user: { name: string } } } | null> {
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: {
      id: true,
      region: true,
      availability: true,
      userId: true,
      user: { select: { name: true } },
    },
  });
  if (!driver || driver.availability === DriverAvailability.OFFLINE) return null;

  const activeCount = await prisma.order.count({
    where: {
      driverId: driver.id,
      isAcceptedByDriver: true,
      status: {
        in: [
          OrderStatus.CONFIRMED,
          OrderStatus.PREPARING,
          OrderStatus.READY,
          OrderStatus.PICKED_UP,
          OrderStatus.IN_TRANSIT,
        ],
      },
    },
  });
  // El repartidor ya está a tope; no hay hueco que reabastecer.
  if (activeCount >= getMaxActiveOrders()) return null;

  const jitTarget = new Date(Date.now() + 8 * 60 * 1000);
  const pendingOrder = await prisma.order.findFirst({
    where: {
      driverId: null,
      supportRestaurantId: null,
      isSupportRequested: false,
      fulfillmentType: 'DELIVERY',
      status: { in: [OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.READY] },
      restaurant: {
        region: driver.region,
        hasOwnDelivery: false,
      },
      OR: [
        { preparationDeadlineAt: { lte: jitTarget } },
        { preparationDeadlineAt: null, estimatedDeliveryTime: { lte: jitTarget } },
        { noDriversAvailable: true },
      ],
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, restaurant: { select: { userId: true } } },
  });

  if (!pendingOrder) return null;

  // Validar smart-stacking: que este repartidor (BUSY con pedidos) sea elegible
  // para el nuevo pedido según proximidad/compatibilidad de ruta.
  const eligible = await getAvailableDriversForRestaurant(
    prisma,
    pendingOrder.restaurant.userId,
    pendingOrder.id,
    [],
    false
  );
  if (!eligible.some((d) => d.id === driver.id)) return null;

  // Asignación atómica: solo se asigna si el pedido sigue sin repartidor.
  // Se setea driverAssignedAt e isAcceptedByDriver:false para que el auto-expulsión
  // del JIT (2 min sin aceptar) aplique también a los pedidos reabastecidos.
  const claimed = await prisma.order.updateMany({
    where: {
      id: pendingOrder.id,
      driverId: null,
      status: { in: [OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.READY] },
    },
    data: {
      driverId: driver.id,
      driverAssignedAt: new Date(),
      isAcceptedByDriver: false,
    },
  });
  if (claimed.count === 0) return null;

  // El repartidor ya tiene un pedido activo: marcarlo BUSY.
  await prisma.driver.update({
    where: { id: driver.id },
    data: { availability: DriverAvailability.BUSY },
  });

  const order = await prisma.order.findUniqueOrThrow({
    where: { id: pendingOrder.id },
    select: restaurantOrderWorkflowSelect,
  });

  await prisma.orderTracking.create({
    data: {
      orderId: order.id,
      status: order.status,
      notes: `Repartidor auto-asignado por reabastecimiento de hueco: ${driver.user.name}`,
    },
  });

  if (options.emitNotifications !== false) {
    appEvents.emit('order.driver_auto_assigned_on_free_slot', {
      orderId: order.id,
      driverId: driver.id,
      restaurantUserId: pendingOrder.restaurant.userId,
    });
    void sendPushNotification(driver.userId, {
      title: '🛵 Nuevo pedido asignado',
      body: `${order.restaurant.name} — Gana $${Number(order.deliveryFee || 0).toFixed(2)} · ${Number(order.deliveryDistanceKm || 0).toFixed(1)} km`,
      icon: '/app-icon-192.png',
      badge: '/badge.png',
      vibrate: [500, 200, 500, 200, 500],
      requireInteraction: true,
      sound: '/sounds/notifica.wav',
      nativeRing: true,
      nativeRingExpiresAt: Date.now() + 2 * 60 * 1000,
      data: {
        orderId: order.id,
        orderReference: order.orderReference,
        url: `/?orderId=${order.id}`,
      },
      tag: `order-assigned-${order.id}`,
    }).catch((pushErr) => {
      logger.error(`[Push] Fallo al notificar reasignación al repartidor ${driver.id}`, pushErr);
    });
  }

  logger.info(`[Refill] Repartidor ${driver.id} reabastecido con pedido ${order.id}`);
  return {
    order,
    driver: { id: driver.id, userId: driver.userId, user: { name: driver.user.name } },
  };
}

export async function sweepUnassignedOrdersForRegion(prisma: PrismaClient, region: string) {
  const jitTarget = new Date(Date.now() + 8 * 60 * 1000);
  const unassignedOrders = await prisma.order.findMany({
    where: {
      driverId: null,
      supportRestaurantId: null,
      isSupportRequested: false,
      fulfillmentType: 'DELIVERY',
      status: { in: [OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.READY] },
      restaurant: {
        region: region,
        hasOwnDelivery: false,
      },
      OR: [
        { preparationDeadlineAt: { lte: jitTarget } },
        { preparationDeadlineAt: null, estimatedDeliveryTime: { lte: jitTarget } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, restaurant: { select: { userId: true } } },
  });

  const assignedOrders = [];
  let pendingCount = 0;

  for (const order of unassignedOrders) {
    try {
      const assignResult = await autoAssignDriver(prisma, order.id, order.restaurant.userId);
      if (assignResult.success && assignResult.driver && assignResult.order) {
        const updatedOrder = await prisma.order.update({
          where: { id: order.id },
          data: { noDriversAvailable: false },
          include: {
            restaurant: true,
            customer: { include: { user: true } },
          },
        });

        assignedOrders.push({
          order: updatedOrder,
          driver: assignResult.driver,
        });
      } else if (assignResult.alreadyAssigned) {
        // Otro proceso concurrente ya asignó el pedido a un repartidor.
        // No contarlo como pendiente ni marcarlo como "sin repartidor".
        logger.info(`Order ${order.id} already assigned by another process; sweep skips it.`);
      } else {
        pendingCount += 1;
      }
    } catch (err) {
      pendingCount += 1;
      logger.error(`Sweep failed for order ${order.id}`, err);
    }
  }

  // Si quedan pedidos de entrega sin repartidor, invita (vía WhatsApp) a los
  // repartidores activos pero OFFLINE de la zona a conectarse. Controlado por
  // WHATSAPP_DRIVER_DEMAND_ENABLED y DRIVER_DEMAND_THRESHOLD.
  if (pendingCount > 0) {
    try {
      await notifyOfflineDriversOfDemand(prisma, region, pendingCount);
    } catch (err) {
      logger.error(`[DriverDemand] Fallo al notificar demanda en zona ${region}`, err);
    }
  }

  return assignedOrders;
}

// ─────────────────────────────────────────────────────────────────────────────
// Aviso de demanda a repartidores (reclutamiento por WhatsApp en horas pico)
// ─────────────────────────────────────────────────────────────────────────────
// Cuando hay pedidos de entrega esperando sin repartidor suficiente en una zona,
// se invita (vía plantilla WhatsApp) a los repartidores ACTIVOS pero OFFLINE de esa
// zona a conectarse para tomar entregas. Controlado por WHATSAPP_DRIVER_DEMAND_ENABLED
// y con cooldown por repartidor para no spamear.
const demandCooldownMs = 3 * 60 * 60 * 1000; // 3 horas por repartidor
const driverDemandNotifiedAt = new Map<string, number>();

function isDriverDemandEnabled(): boolean {
  return String(process.env.WHATSAPP_DRIVER_DEMAND_ENABLED || '').toLowerCase() === 'true';
}

function getDriverAppUrl(): string {
  const base = process.env.DRIVER_APP_URL || process.env.WEBAPP_URL || process.env.RESTAURANT_PANEL_URL || '';
  return base.replace(/\/+$/, '') || '';
}

export async function notifyOfflineDriversOfDemand(
  prisma: PrismaClient,
  region: string,
  pendingCount: number
): Promise<number> {
  if (!isDriverDemandEnabled()) return 0;
  if (!pendingCount || pendingCount <= 0) return 0;

  // Umbral mínimo de pedidos sin repartidor para disparar el aviso.
  const threshold =
    parseInt(String(process.env.DRIVER_DEMAND_THRESHOLD || '1'), 10) || 1;
  if (pendingCount < threshold) return 0;

  const appUrl = getDriverAppUrl();
  if (!appUrl) {
    logger.warn('[DriverDemand] Falta DRIVER_APP_URL/WEBAPP_URL. Aviso omitido.');
    return 0;
  }

  const offlineDrivers = await prisma.driver.findMany({
    where: {
      region,
      status: DriverStatus.ACTIVE,
      availability: DriverAvailability.OFFLINE,
      user: { status: 'ACTIVE' as any },
    },
    select: { id: true, user: { select: { phone: true, name: true } } },
  });

  let sentCount = 0;
  const now = Date.now();

  for (const driver of offlineDrivers) {
    const phone = driver.user?.phone;
    if (!phone) continue;

    const lastSent = driverDemandNotifiedAt.get(driver.id) || 0;
    if (now - lastSent < demandCooldownMs) continue;

    const result = await sendWhatsAppDriverDemand({
      driverPhone: phone,
      pendingCount,
      appUrl,
    });

    if (result.sent) {
      driverDemandNotifiedAt.set(driver.id, now);
      sentCount += 1;
      logger.info(`[DriverDemand] Aviso enviado a repartidor ${driver.id} (zona ${region}).`);
    } else {
      logger.warn(`[DriverDemand] No se envió a repartidor ${driver.id} (zona ${region}).`);
    }
  }

  return sentCount;
}

// ─────────────────────────────────────────────────────────────────────────────
// Aviso al cliente cuando un pedido de entrega no tiene repartidor disponible.
// Notifica por socket + push para reducir reclamos por "pedido sin actualización".
// ─────────────────────────────────────────────────────────────────────────────
export function notifyCustomerNoDriversAvailable(
  io: import('socket.io').Server,
  order: {
    id: string;
    restaurant?: { name?: string; businessType?: string } | null;
    customer?: { user?: { id?: string; name?: string } } | null;
  }
): void {
  const customerUserId = order.customer?.user?.id;
  if (!customerUserId) return;

  const businessRef = order.restaurant?.businessType !== 'RESTAURANT' ? 'tu negocio' : 'tu restaurante';

  emitNotification(
    io,
    customerUserId,
    'CUSTOMER',
    'order:no-drivers-available',
    {
      orderId: order.id,
      message: `Todavía no hay un repartidor disponible para tu pedido, pero seguiremos intentando asignarlo. Gracias por tu paciencia.`,
    }
  );

  void sendPushNotification(customerUserId, {
    title: '⏳ Buscando repartidor',
    body: `Tu pedido de ${businessRef} aún no tiene repartidor asignado. Estamos trabajando para asignarlo lo antes posible.`,
    icon: '/app-icon-192.png',
    badge: '/badge.png',
    vibrate: [500, 200, 500],
    requireInteraction: true,
    tag: `no-drivers-${order.id}`,
    data: {
      orderId: order.id,
      event: 'order:no-drivers-available',
      url: `/?orderId=${order.id}`,
    },
  }).catch((pushErr) => {
    logger.error(`[Push] Fallo al notificar "sin repartidor" al cliente ${customerUserId}`, pushErr);
  });
}

function randomNonce(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
  } catch {
    // ignore
  }
  return `${process.pid}:${Math.random().toString(36).slice(2)}:${Date.now()}`;
}

/**
 * Mutex distribuido por repartidor (Redis SET NX + TTL + liberación con script
 * Lua que verifica el nonce). Serializa la evaluación del tope de carga y el
 * claim del pedido del MISMO driver entre procesos concurrentes (JIT job,
 * sweep, auto-assign), cerrando la ventana en la que dos transacciones podrían
 * leer el conteo de pedidos activos sin ver el claim del otro.
 *
 * Fail-open: si Redis no está disponible, se ejecuta fn igual (sin bloqueo)
 * para no detener la asignación en producción.
 */
async function withDriverCapacityLock<T>(
  driverId: string,
  fn: () => Promise<T>
): Promise<T | null> {
  const lockKey = `driver:capacity-lock:${driverId}`;
  const nonce = randomNonce();
  let redis: ReturnType<typeof getRedis> | null = null;
  let acquired = false;
  try {
    redis = getRedis();
    const res = await redis.set(lockKey, nonce, 'EX', 4, 'NX');
    acquired = res === 'OK';
  } catch (e) {
    // Redis no disponible (incluye getRedis) → fail-open: proceder sin lock.
    logger.warn(`[DriverCapacityLock] fallback sin lock (redis) para driver ${driverId}`, {
      err: (e as Error).message,
    });
    return fn();
  }
  if (!acquired) return null;
  try {
    return await fn();
  } finally {
    try {
      await redis!.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        lockKey,
        nonce
      );
    } catch (releaseErr) {
      // El lock expira por TTL; no re-ejecutamos fn.
      logger.warn(`[DriverCapacityLock] error al liberar lock para driver ${driverId}`, {
        err: (releaseErr as Error).message,
      });
    }
  }
}
