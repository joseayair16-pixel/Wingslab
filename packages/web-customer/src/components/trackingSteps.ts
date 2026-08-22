import { getBusinessArticleCapitalized, getBusinessRef, getOrderStatusLabel } from '@sadel/shared';

// Tipos y lógica compartidos entre la tarjeta de seguimiento (CompactActiveOrderBanner)
// y el mapa en vivo (LiveTrackingMap). Fuente única de verdad para las etapas del
// pedido: ambos componentes derivan SIEMPRE del mismo timeline, garantizando que
// los estados mostrados sean consistentes entre sí.

export type CompactOrderDetail = {
  id: string;
  status: string;
  estimatedDeliveryTime?: string;
  fulfillmentType?: 'DELIVERY' | 'PICKUP';
  dailyCounter?: number;
  paymentMethod?: string;
  deliveryPin?: string | null;
  handoverPin?: string | null;
  pickupPin?: string | null;
  batchId?: string | null;
  deliverySequence?: number | null;
  tracking?: Array<{ notes?: string | null }>;
  restaurant?: {
    name?: string;
    businessType?: string;
    latitude?: number;
    longitude?: number;
  } | null;
  address?: {
    latitude?: number;
    longitude?: number;
    street?: string;
    number?: string;
    neighborhood?: string;
    reference?: string | null;
  } | null;
  scheduledDeliveryAt?: string | null;
  scheduledDeliveryCustomerAcceptedAt?: string | null;
  etaExtendedMinutes?: number;
  preparationDeadlineAt?: string | null;
  noDriversAvailable?: boolean;
};

export type TimelineStep = {
  key: string;
  label: string;
  description: string;
  state: 'done' | 'active' | 'pending';
};

export function buildTimelineSteps(order: CompactOrderDetail, activeStatusOverride?: string): TimelineStep[] {
  const status = activeStatusOverride || order.status;
  const isPickup = order.fulfillmentType === 'PICKUP';

  if (isPickup) {
    return [
      {
        key: 'kitchen',
        label: getOrderStatusLabel('PREPARING', order.restaurant?.businessType),
        description: status === 'PENDING'
          ? `${getBusinessArticleCapitalized(order.restaurant?.businessType)} ${getBusinessRef(order.restaurant?.businessType)} está revisando tu solicitud`
          : 'Estamos preparando tu pedido',
        state: status === 'PENDING' || status === 'CONFIRMED' || status === 'PREPARING'
          ? 'active'
          : ['READY', 'PICKED_UP', 'IN_TRANSIT', 'DRIVER_ARRIVED', 'DELIVERED'].includes(status)
            ? 'done'
            : 'pending',
      },
      {
        key: 'ready',
        label: 'Pedido listo',
        description: `Tu pedido está listo para recoger en ${order.restaurant?.name}`,
        state: status === 'READY'
          ? 'active'
          : ['PICKED_UP', 'IN_TRANSIT', 'DRIVER_ARRIVED', 'DELIVERED'].includes(status)
            ? 'done'
            : 'pending',
      },
      {
        key: 'picked_up',
        label: 'Recogido',
        description: 'Ya recogiste tu pedido. ¡Buen provecho!',
        state: ['PICKED_UP', 'IN_TRANSIT', 'DRIVER_ARRIVED', 'DELIVERED'].includes(status)
          ? 'done'
          : 'pending',
      },
    ];
  }

  return [
    {
      key: 'kitchen',
      label: getOrderStatusLabel('PREPARING', order.restaurant?.businessType),
      description: status === 'PENDING'
        ? `${getBusinessArticleCapitalized(order.restaurant?.businessType)} ${getBusinessRef(order.restaurant?.businessType)} está revisando tu solicitud`
        : 'Estamos preparando tu pedido',
      state: status === 'PENDING' || status === 'CONFIRMED' || status === 'PREPARING'
        ? 'active'
        : ['READY', 'PICKED_UP', 'IN_TRANSIT', 'DRIVER_ARRIVED', 'DELIVERED'].includes(status)
          ? 'done'
          : 'pending',
    },
    {
      key: 'ready',
      label: 'Pedido listo',
      description: `${getBusinessArticleCapitalized(order.restaurant?.businessType)} ${getBusinessRef(order.restaurant?.businessType)} ha confirmado que tu pedido está listo`,
      state: status === 'READY'
        ? 'active'
        : ['PICKED_UP', 'IN_TRANSIT', 'DRIVER_ARRIVED', 'DELIVERED'].includes(status)
          ? 'done'
          : 'pending',
    },
    {
      key: 'transit',
      label: status === 'DRIVER_ARRIVED' ? '¡Tu pedido ha llegado! 📍' : 'En camino',
      description: status === 'DRIVER_ARRIVED' ? 'Sal a recibir a tu repartidor' : 'El repartidor está en camino, tu pedido llega pronto',
      state: status === 'PICKED_UP' || status === 'IN_TRANSIT' || status === 'DRIVER_ARRIVED'
        ? 'active'
        : status === 'DELIVERED'
          ? 'done'
          : 'pending',
    },
    {
      key: 'delivered',
      label: 'Entregado',
      description: 'El pedido llegó a tu domicilio.',
      state: status === 'DELIVERED' ? 'done' : 'pending',
    },
  ];
}
