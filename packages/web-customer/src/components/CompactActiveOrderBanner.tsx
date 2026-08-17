import { MessageCircle } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { getBusinessArticleCapitalized, getBusinessRef, getOrderStatusLabel } from '@sadel/shared';
import LiveTrackingMap from './LiveTrackingMap';

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

export type DelayLevel = 1 | 2 | 3;

export type DelayState = {
  isDelayed: boolean;
  level: DelayLevel | 0;
  minutesOverdue: number;
  referenceTime: Date | null;
  isScheduled: boolean;
};

const DELAY_GRACE_MINUTES = 5;
const TERMINAL_STATUSES = ['DELIVERED', 'CANCELLED', 'REJECTED', 'DRIVER_ARRIVED'];

export function computeDelayState(order: CompactOrderDetail, now: number): DelayState {
  if (TERMINAL_STATUSES.includes(order.status)) {
    return { isDelayed: false, level: 0, minutesOverdue: 0, referenceTime: null, isScheduled: false };
  }

  const referenceIso = order.scheduledDeliveryAt || order.estimatedDeliveryTime;
  if (!referenceIso) {
    return { isDelayed: false, level: 0, minutesOverdue: 0, referenceTime: null, isScheduled: false };
  }

  const referenceTime = new Date(referenceIso);
  if (Number.isNaN(referenceTime.getTime())) {
    return { isDelayed: false, level: 0, minutesOverdue: 0, referenceTime: null, isScheduled: false };
  }

  const minutesOverdue = Math.floor((now - referenceTime.getTime()) / 60000);
  if (minutesOverdue < DELAY_GRACE_MINUTES) {
    return { isDelayed: false, level: 0, minutesOverdue, referenceTime, isScheduled: !!order.scheduledDeliveryAt };
  }

  const level: DelayLevel = minutesOverdue < 15 ? 1 : minutesOverdue < 30 ? 2 : 3;
  return { isDelayed: true, level, minutesOverdue, referenceTime, isScheduled: !!order.scheduledDeliveryAt };
}

export function formatOverdueMinutes(minutes: number): string {
  if (minutes < 60) return `+${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `+${h} h ${m} min` : `+${h} h`;
}

const DELAY_PILL_STYLES: Record<number, { wrap: string; icon: string; text: string; iconPath: string }> = {
  1: {
    wrap: 'bg-amber-50 border-amber-200',
    icon: 'text-amber-600',
    text: 'text-amber-900',
    iconPath: 'M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z',
  },
  2: {
    wrap: 'bg-red-50 border-red-200',
    icon: 'text-red-600',
    text: 'text-red-900',
    iconPath: 'M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z',
  },
  3: {
    wrap: 'bg-red-50 border-red-300',
    icon: 'text-red-600',
    text: 'text-red-900',
    iconPath: 'M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z',
  },
};

export type TimelineStep = {
  key: string;
  label: string;
  description: string;
  state: 'done' | 'active' | 'pending';
};

export function getEtaWindowMinutes(status: string) {
  if (status === 'PENDING') {
    return { early: 5, late: 5 };
  }

  if (status === 'CONFIRMED' || status === 'PREPARING') {
    return { early: 4, late: 4 };
  }

  if (status === 'READY' || status === 'PICKED_UP') {
    return { early: 3, late: 3 };
  }

  if (status === 'IN_TRANSIT') {
    return { early: 2, late: 3 };
  }

  return { early: 0, late: 0 };
}

export function formatScheduleDateLabel(isoDate: string | null | undefined, now: number): string {
  if (!isoDate) return '';
  const scheduled = new Date(isoDate);
  if (Number.isNaN(scheduled.getTime())) return '';

  const today = new Date(now);
  const scheduledDate = new Date(scheduled.getFullYear(), scheduled.getMonth(), scheduled.getDate());
  const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const diffDays = Math.round((scheduledDate.getTime() - todayDate.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return 'Hoy';
  if (diffDays === 1) return 'Mañana';
  return scheduled.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

export function formatEstimatedArrivalMinutes(
  estimatedDeliveryTime: string | undefined,
  status: string,
  currentTimestamp: number,
  businessType?: string | null,
  fulfillmentType?: 'DELIVERY' | 'PICKUP'
) {
  const etaDate = new Date(estimatedDeliveryTime ?? '');
  if (Number.isNaN(etaDate.getTime())) {
    return null;
  }

  if (['DELIVERED', 'CANCELLED', 'REJECTED', 'DRIVER_ARRIVED', 'PICKED_UP'].includes(status)) {
    return null;
  }

  // En PENDING el restaurante aún no define su tiempo de preparación: el ETA
  // del backend es solo un valor por defecto, no una promesa real. Mejor no
  // mostrar un conteo hasta que el pedido sea confirmado.
  if (status === 'PENDING') {
    return null;
  }

  const msUntilEta = etaDate.getTime() - currentTimestamp;
  const prefix = fulfillmentType === 'PICKUP' ? 'Listo para recoger' : 'Llega';

  if (businessType && businessType !== 'RESTAURANT' && msUntilEta > 3 * 60 * 60 * 1000) {
    const timeStr = etaDate.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    const now = new Date(currentTimestamp);
    if (etaDate.toDateString() === now.toDateString()) {
      return `${prefix} aprox. ${timeStr}`;
    }
    const dayStr = etaDate.toLocaleDateString('es-MX', { weekday: 'long' });
    return `${prefix} aprox. ${dayStr} ${timeStr}`;
  }

  if (msUntilEta > 60 * 60 * 1000) {
    const timeStr = etaDate.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    const now = new Date(currentTimestamp);
    if (etaDate.toDateString() === now.toDateString()) {
      return `${prefix} aprox. ${timeStr}`;
    }
    const dayStr = etaDate.toLocaleDateString('es-MX', { weekday: 'long' });
    return `${prefix} aprox. ${dayStr} ${timeStr}`;
  }

  const windowMinutes = getEtaWindowMinutes(status);

  const startDiffMs = (etaDate.getTime() - windowMinutes.early * 60 * 1000) - currentTimestamp;
  const endDiffMs = (etaDate.getTime() + windowMinutes.late * 60 * 1000) - currentTimestamp;

  const startMin = Math.max(0, Math.round(startDiffMs / 60000));
  const endMin = Math.max(1, Math.round(endDiffMs / 60000));

  if (endMin <= 1) {
    return fulfillmentType === 'PICKUP' ? 'Listo para recoger en cualquier momento 🛍️' : 'Llega en cualquier momento 🛵';
  }

  if (startMin === 0) {
    return fulfillmentType === 'PICKUP' ? `Listo para recoger en menos de ${endMin} min 🛍️` : `Llega en menos de ${endMin} min 🛵`;
  }

  return fulfillmentType === 'PICKUP' ? `Listo para recoger en ${startMin} - ${endMin} min 🛍️` : `Llega en ${startMin} - ${endMin} min 🛵`;
}

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

export function buildFallbackTimelineSteps(
  status: string,
  businessType?: string,
  fulfillmentType?: 'DELIVERY' | 'PICKUP'
): TimelineStep[] {
  if (fulfillmentType === 'PICKUP') {
    return [
      {
        key: 'kitchen',
        label: getOrderStatusLabel('PREPARING', businessType),
        description: status === 'PENDING'
          ? `${getBusinessArticleCapitalized(businessType)} ${getBusinessRef(businessType)} está revisando tu solicitud`
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
        description: 'Tu pedido está listo para recoger en sucursal',
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
      label: getOrderStatusLabel('PREPARING', businessType),
      description: status === 'PENDING'
        ? `${getBusinessArticleCapitalized(businessType)} ${getBusinessRef(businessType)} está revisando tu solicitud`
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
      description: `${getBusinessArticleCapitalized(businessType)} ${getBusinessRef(businessType)} ha confirmado que tu pedido está listo`,
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

export const CompactActiveOrderBanner = memo(function CompactActiveOrderBanner({
  order,
  fallbackOrder,
  onOpenHistory,
  onOpenChat,
  unreadCount = 0,
  isTrackingEnabled = false,
  setIsTrackingEnabled,
  driverLocation,
  setDriverLocation,
}: {
  order?: CompactOrderDetail | null;
  fallbackOrder?: CompactOrderDetail | null;
  onOpenHistory: () => void;
  onOpenChat: () => void;
  unreadCount?: number;
  isTrackingEnabled?: boolean;
  setIsTrackingEnabled?: (val: boolean) => void;
  driverLocation?: { lat: number; lng: number } | null;
  setDriverLocation?: (val: { lat: number; lng: number } | null) => void;
}) {
  const [currentTimestamp, setCurrentTimestamp] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTimestamp(Date.now());
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  const currentOrder = order || fallbackOrder;
  if (!currentOrder) {
    return null;
  }

  const hasDriverArrived = currentOrder.status === 'IN_TRANSIT' && currentOrder.tracking?.some((t) => t.notes === 'DRIVER_ARRIVED');
  const activeStatus = hasDriverArrived ? 'DRIVER_ARRIVED' : currentOrder.status;

  const isPickup = currentOrder.fulfillmentType === 'PICKUP';
  const compactSteps = order
    ? buildTimelineSteps(order, activeStatus)
    : buildFallbackTimelineSteps(activeStatus, fallbackOrder?.restaurant?.businessType, currentOrder.fulfillmentType);

  const activeEtaTime = fallbackOrder?.estimatedDeliveryTime || order?.estimatedDeliveryTime;
  const restaurantName = order?.restaurant?.name || fallbackOrder?.restaurant?.name || '';
  const dynamicRemainingText = formatEstimatedArrivalMinutes(
    activeEtaTime,
    activeStatus,
    currentTimestamp,
    currentOrder.restaurant?.businessType,
    currentOrder.fulfillmentType
  );
  const delayState = computeDelayState(currentOrder, currentTimestamp);
  const showTrackingWidget = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'PICKED_UP', 'IN_TRANSIT', 'DRIVER_ARRIVED'].includes(activeStatus);

  // Calcular el progreso de la barra
  const doneCount = compactSteps.filter((s) => s.state === 'done').length;
  const activeCount = compactSteps.filter((s) => s.state === 'active').length;
  const progressPercent = Math.max(0, Math.min(100, ((doneCount + activeCount - 1) / (compactSteps.length - 1)) * 100));

  // Paso activo actual
  const activeStep = compactSteps.find((s) => s.state === 'active') || compactSteps[compactSteps.length - 1];

  return (
    <section className="rounded-[20px] border border-black/[0.04] bg-white px-4 py-3.5 shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
      {/* Fila principal: estado + tiempo + acciones */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {/* Indicador animado */}
          <div className="relative shrink-0">
            <div className="w-10 h-10 rounded-2xl bg-neutral-950 flex items-center justify-center">
              <span className="text-lg">
                {activeStatus === 'DELIVERED' ? '✅' :
                 activeStatus === 'PICKED_UP' && isPickup ? '🛍️' :
                 activeStatus === 'PICKED_UP' ? '🛵' :
                 activeStatus === 'IN_TRANSIT' ? '🛵' :
                 activeStatus === 'DRIVER_ARRIVED' ? '📍' :
                 activeStatus === 'READY' ? '📦' :
                 currentOrder.restaurant?.businessType && currentOrder.restaurant.businessType !== 'RESTAURANT' ? '📦' : '🍳'}
              </span>
            </div>
            {!['DELIVERED', 'CANCELLED', 'REJECTED'].includes(activeStatus) && (
              <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
                {delayState.isDelayed ? (
                  <>
                    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${delayState.level === 1 ? 'bg-amber-400' : 'bg-red-400'}`}></span>
                    <span className={`relative inline-flex rounded-full h-3 w-3 border-2 border-white ${delayState.level === 1 ? 'bg-amber-500' : 'bg-red-500'}`}></span>
                  </>
                ) : (
                  <>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 border-2 border-white"></span>
                  </>
                )}
              </span>
            )}
          </div>

          {/* Info condensada */}
          <div className="min-w-0">
            <p className="text-sm font-bold text-neutral-900 truncate">{activeStep?.label || 'Procesando'}</p>
            {currentOrder.noDriversAvailable && !delayState.isDelayed && activeStatus === 'READY' ? (
              <div className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                </span>
                <span className="text-[11px] font-bold text-amber-900 truncate">Buscando repartidor disponible…</span>
              </div>
            ) : delayState.isDelayed && delayState.referenceTime ? (
              <div className={`mt-1 inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 ${DELAY_PILL_STYLES[delayState.level].wrap}`}>
                <svg className={`w-3 h-3 shrink-0 ${DELAY_PILL_STYLES[delayState.level].icon}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={DELAY_PILL_STYLES[delayState.level].iconPath} />
                </svg>
                <span className={`text-[11px] font-bold truncate ${DELAY_PILL_STYLES[delayState.level].text}`}>
                  Va con retraso · {formatOverdueMinutes(delayState.minutesOverdue)}
                </span>
              </div>
            ) : order?.scheduledDeliveryAt && !order?.scheduledDeliveryCustomerAcceptedAt ? (
              <div className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-1">
                <svg className="w-3 h-3 text-amber-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="8" strokeWidth={2} />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 7v5l3 3" />
                </svg>
                <span className="text-[11px] font-bold text-amber-900 truncate">
                  {formatScheduleDateLabel(order.scheduledDeliveryAt, currentTimestamp)} · {new Date(order.scheduledDeliveryAt).toLocaleTimeString('es-MX', {
                    hour: '2-digit', minute: '2-digit'
                  })}
                </span>
              </div>
            ) : order?.scheduledDeliveryAt && order?.scheduledDeliveryCustomerAcceptedAt ? (
              <div className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-1">
                <svg className="w-3 h-3 text-emerald-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="8" strokeWidth={2} />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 7v5l3 3" />
                </svg>
                <span className="text-[11px] font-bold text-emerald-900 truncate">
                  {formatScheduleDateLabel(order.scheduledDeliveryAt, currentTimestamp)} · {new Date(order.scheduledDeliveryAt).toLocaleTimeString('es-MX', {
                    hour: '2-digit', minute: '2-digit'
                  })}
                </span>
              </div>
            ) : dynamicRemainingText ? (
              <p className="text-xs text-neutral-500 mt-0.5 truncate">{dynamicRemainingText}</p>
            ) : activeStatus === 'PENDING' ? (
              <p className="text-xs text-neutral-500 mt-0.5 truncate">
                Esperando confirmación del {getBusinessRef(currentOrder.restaurant?.businessType)}…
              </p>
            ) : (
              <p className="text-xs text-neutral-500 mt-0.5 truncate">{restaurantName}</p>
            )}
            {isPickup && currentOrder.dailyCounter && (
              <span className="inline-flex items-center gap-1 mt-1.5 px-2.5 py-1 rounded-full bg-neutral-100 border border-neutral-200 text-[11px] font-bold text-neutral-600">
                Pedido #{currentOrder.dailyCounter}
              </span>
            )}
            {(order?.batchId && order?.deliverySequence != null && activeStatus === 'IN_TRANSIT') && (
              <span className="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/30 text-[9px] font-bold text-amber-700 dark:text-amber-400">
                📦 Lote · Entrega {(order.deliverySequence ?? 0) + 1}
              </span>
            )}
          </div>
        </div>

        {/* Acciones */}
        <div className="shrink-0 flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenChat}
            title="Chat"
            className={`relative flex items-center justify-center w-9 h-9 rounded-full text-white shadow-sm transition-all active:scale-95 ${
              delayState.isDelayed
                ? 'bg-red-500 hover:bg-red-600 animate-order-delay-attention'
                : 'bg-sky-500 hover:bg-sky-600'
            }`}
          >
            <MessageCircle className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center px-1 animate-bounce shadow-sm">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={onOpenHistory}
            className="rounded-full bg-neutral-100 hover:bg-neutral-200 px-3.5 py-2 text-xs font-semibold text-neutral-800 transition-colors active:scale-[0.97]"
          >
            Detalle
          </button>
        </div>
      </div>

      {/* Estado de retraso: reaseguro (el chat se resalta en la esquina) */}
      {delayState.isDelayed && delayState.referenceTime && (
        <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50/70 px-3.5 py-3">
          <div className="flex items-start gap-2.5">
            <svg className={`w-4 h-4 shrink-0 mt-0.5 ${DELAY_PILL_STYLES[delayState.level].icon}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={DELAY_PILL_STYLES[delayState.level].iconPath} />
            </svg>
            <div className="min-w-0">
              <p className="text-xs font-bold text-neutral-900">
                Tu pedido va con retraso {delayState.level === 3 ? 'mayor al esperado' : ''}
              </p>
              <p className="text-[11px] text-neutral-600 mt-0.5 leading-snug">
                {delayState.level === 3
                  ? 'Lo sentimos mucho. Estamos trabajando para que llegue lo antes posible.'
                  : 'Estamos trabajando en tu pedido. Gracias por tu paciencia.'}
              </p>
              {delayState.isScheduled && (
                <p className="text-[11px] text-neutral-400 line-through mt-1 truncate">
                  Programada: {formatScheduleDateLabel(delayState.referenceTime.toISOString(), currentTimestamp)} ·{' '}
                  {delayState.referenceTime.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* PIN de recolección para pickup */}
      {isPickup && order?.pickupPin && ['READY', 'PICKED_UP', 'IN_TRANSIT'].includes(activeStatus) && (
        <div className="mt-3 flex items-center justify-center gap-2 py-2 px-3 bg-emerald-50/60 border border-emerald-200/60 rounded-xl">
          <span className="text-[9px] font-bold text-emerald-600 uppercase tracking-wider">PIN de recolección:</span>
          <span className="text-base font-black tracking-[0.25em] text-emerald-900 font-mono">{order.pickupPin}</span>
        </div>
      )}

      {/* Botón cómo llegar para pickup */}
      {isPickup && ['READY', 'PICKED_UP'].includes(activeStatus) && currentOrder.restaurant?.latitude && currentOrder.restaurant?.longitude && (
        <a
          href={`https://www.google.com/maps/dir/?api=1&destination=${currentOrder.restaurant.latitude},${currentOrder.restaurant.longitude}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 w-full flex items-center justify-center gap-2.5 rounded-full bg-sky-500 hover:bg-sky-600 py-3 text-sm font-bold text-white shadow-md transition hover:shadow-lg active:scale-[0.97]"
        >
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Cómo llegar
        </a>
      )}

      {/* deliveryPin en banner compacto — solo para transferencia */}
      {!isPickup && order?.paymentMethod === 'TRANSFER' && ((order?.deliveryPin || order?.handoverPin) && ['READY', 'PICKED_UP', 'IN_TRANSIT'].includes(activeStatus)) && (
        <div className="mt-3 flex items-center justify-center gap-2 py-2 px-3 bg-indigo-50/60 border border-indigo-200/60 rounded-xl">
          <span className="text-[9px] font-bold text-indigo-600 uppercase tracking-wider">PIN de entrega:</span>
          <span className="text-base font-black tracking-[0.25em] text-indigo-900 font-mono">{order?.deliveryPin || order?.handoverPin}</span>
        </div>
      )}

      {/* Barra de progreso minimal */}
      <div className="mt-3 mb-1">
        <div className="h-1 w-full bg-neutral-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ease-out ${
              delayState.isDelayed ? (delayState.level === 1 ? 'bg-amber-500' : 'bg-red-500') : 'bg-neutral-900'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="flex justify-between mt-1.5">
          {compactSteps.map((step) => {
            const isDone = step.state === 'done';
            const isActive = step.state === 'active';
            return (
              <span
                key={step.key}
                className={`text-[9px] font-medium ${
                  isActive ? 'text-neutral-900 font-bold' :
                  isDone ? 'text-neutral-500' : 'text-neutral-300'
                }`}
              >
                {step.label}
              </span>
            );
          })}
        </div>
      </div>

      {!isPickup && showTrackingWidget && (
        <div className="border-t border-black/[0.05] mt-4 pt-3">
          {isTrackingEnabled ? (
            <div className="space-y-2">
              {order ? (
                <LiveTrackingMap order={order} driverLocation={driverLocation || null} />
              ) : (
                <div className="h-52 w-full rounded-2xl border border-black/[0.05] bg-neutral-50 z-0 animate-scale-up no-invert md:h-64" />
              )}
              <button
                type="button"
                onClick={() => {
                  setIsTrackingEnabled?.(false);
                  setDriverLocation?.(null);
                }}
                className="w-full text-xs font-semibold py-2 px-3 rounded-lg border border-black/10 hover:bg-neutral-50 text-neutral-600 flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
              >
                <span>📴 Desactivar mapa (Ahorrar datos)</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsTrackingEnabled?.(true)}
              className="w-full py-2 px-3 rounded-xl border border-dashed border-neutral-300 hover:border-neutral-400 bg-neutral-50/50 flex items-center justify-between text-left hover:bg-neutral-50 transition-all active:scale-[0.98] group"
            >
              <div className="flex items-center gap-2.5">
                <span className="text-base group-hover:scale-110 transition-transform">🛵</span>
                <div>
                  <p className="text-xs font-bold text-neutral-900">Seguimiento en Vivo</p>
                  <p className="text-[10px] text-neutral-500">Sigue la ubicación de tu repartidor en tiempo real</p>
                </div>
              </div>
              <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 py-1 px-2.5 rounded-full group-hover:bg-indigo-100 transition-colors">
                Seguir
              </span>
            </button>
          )}
        </div>
      )}
    </section>
  );
});
