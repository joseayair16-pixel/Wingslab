import { AlertTriangle, Bike, Check, ChevronRight, CookingPot, MapPin, MessageCircle, PackageCheck, Radio, ShoppingBag, Timer, X } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { getBusinessArticleCapitalized, getBusinessRef, getOrderStatusLabel } from '@sadel/shared';
import LiveTrackingMap from './LiveTrackingMap';
import { buildTimelineSteps, type CompactOrderDetail, type TimelineStep } from './trackingSteps';

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
  // El repartidor llega con tracking DRIVER_ARRIVED y status real IN_TRANSIT:
  // se trata como terminal para que no aparezca el aviso de retraso ("llegó").
  const hasDriverArrived =
    order.status === 'IN_TRANSIT' && order.tracking?.some((t) => t.notes === 'DRIVER_ARRIVED');

  if (TERMINAL_STATUSES.includes(order.status) || hasDriverArrived) {
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

export function getEtaWindowMinutes(status: string) {  if (status === 'PENDING') {
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
  driverLocation?: { lat: number; lng: number; updatedAt?: string | null } | null;
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

  const lastReachedStep = compactSteps.reduce((last, step, index) => step.state !== 'pending' ? index : last, 0);
  const progressPercent = compactSteps.length > 1 ? (lastReachedStep / (compactSteps.length - 1)) * 100 : 0;

  // Paso activo actual
  const activeStep = compactSteps.find((s) => s.state === 'active') || compactSteps[compactSteps.length - 1];

  return (
    <section className="rounded-[24px] border border-white bg-white dark:border-zinc-800 dark:bg-zinc-900 p-4 shadow-[0_8px_30px_rgba(30,30,40,0.10)] sm:p-6">
      {/* Fila principal: estado + tiempo + acciones */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {/* Indicador animado */}
          <div className="relative shrink-0">
            <div className="relative w-12 h-12 sm:w-14 sm:h-14 overflow-hidden rounded-2xl bg-gradient-to-br from-neutral-800 to-neutral-950 flex items-center justify-center shadow-lg shadow-neutral-900/15">
              <span className="absolute inset-x-2 bottom-1 h-2 rounded-full bg-red-500/20 blur-sm" aria-hidden="true" />
              {(() => {
                const StageIcon = activeStatus === 'DELIVERED' ? Check :
                  activeStatus === 'DRIVER_ARRIVED' ? MapPin :
                  activeStatus === 'READY' ? PackageCheck :
                  activeStatus === 'PICKED_UP' || activeStatus === 'IN_TRANSIT' ? Bike :
                  currentOrder.restaurant?.businessType && currentOrder.restaurant.businessType !== 'RESTAURANT' ? ShoppingBag :
                  CookingPot;
                return <StageIcon className="relative h-6 w-6 text-white motion-safe:animate-[pulse_3s_ease-in-out_infinite] sm:h-7 sm:w-7" strokeWidth={1.7} aria-hidden="true" />;
              })()}
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
            <p className="text-base sm:text-xl font-bold text-neutral-950 dark:text-zinc-50 truncate">{activeStep?.label || 'Procesando'}</p>
            {restaurantName && <p className="text-xs sm:text-sm text-neutral-500 dark:text-zinc-400 truncate">{restaurantName}</p>}
            {currentOrder.noDriversAvailable && !delayState.isDelayed && activeStatus === 'READY' ? (
              <div className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                </span>
                <span className="text-[11px] font-bold text-amber-900 truncate">Buscando repartidor disponible…</span>
              </div>
            ) : delayState.isDelayed && delayState.referenceTime ? (
              null
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
              <p className="text-xs text-neutral-500 dark:text-zinc-400 mt-0.5 truncate">{dynamicRemainingText}</p>
            ) : activeStatus === 'PENDING' ? (
              <p className="text-xs text-neutral-500 dark:text-zinc-400 mt-0.5 truncate">
                Esperando confirmación del {getBusinessRef(currentOrder.restaurant?.businessType)}…
              </p>
            ) : (
              null
            )}
            {isPickup && currentOrder.dailyCounter && (
              <span className="inline-flex items-center gap-1 mt-1.5 px-2.5 py-1 rounded-full bg-neutral-100 border border-neutral-200 text-[11px] font-bold text-neutral-600 dark:text-zinc-400">
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
            aria-label="Abrir chat"
            className="relative flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-neutral-100 text-neutral-950 dark:bg-zinc-800 dark:text-zinc-100 shadow-sm transition-all hover:bg-neutral-200 dark:hover:bg-zinc-700 active:scale-95"
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
            className="inline-flex items-center gap-1 rounded-full bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-950/60 px-3 py-2.5 sm:px-5 text-xs sm:text-sm font-bold text-red-700 dark:text-red-300 transition-colors active:scale-[0.97]"
          >
            Detalle <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Estado de retraso: reaseguro (el chat se resalta en la esquina) */}
      {delayState.isDelayed && delayState.referenceTime && (
        <div className="mt-5 rounded-[20px] border border-orange-100 dark:border-orange-900/40 bg-gradient-to-r from-orange-50 to-red-50 dark:from-orange-950/30 dark:to-red-950/30 px-4 py-4 sm:px-5">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-orange-100 text-red-600 dark:bg-orange-900/40 dark:text-red-400 sm:h-14 sm:w-14"><AlertTriangle className="h-6 w-6" /></div>
            <div className="min-w-0 flex-1 border-l border-orange-200 dark:border-orange-900/40 pl-3 sm:pl-4">
              <p className="text-sm sm:text-lg font-bold text-red-700 dark:text-red-300">Va con retraso · {formatOverdueMinutes(delayState.minutesOverdue)}</p>
              <p className="mt-1 text-xs sm:text-sm text-neutral-700 dark:text-zinc-300">
                Tu pedido va con retraso {delayState.level === 3 ? 'mayor al esperado' : ''}
              </p>
              <p className="text-xs sm:text-sm text-neutral-600 dark:text-zinc-400 mt-0.5 leading-snug">
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
            <Timer aria-hidden="true" className="hidden h-12 w-12 shrink-0 text-red-500 sm:block" />
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

      {/* Etapas del pedido */}
      <div className="mt-6 mb-2">
        <div className="relative flex">
          <div className="absolute top-3 h-1 rounded-full bg-neutral-200 dark:bg-zinc-700" style={{ left: `${50 / compactSteps.length}%`, right: `${50 / compactSteps.length}%` }}>
            <div className="h-full rounded-full bg-red-500 transition-all duration-700" style={{ width: `${progressPercent}%` }} />
          </div>
          {compactSteps.map((step) => {
            const isDone = step.state === 'done';
            const isActive = step.state === 'active';
            return (
              <div key={step.key} className="relative flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
                <span className={`flex h-7 w-7 items-center justify-center rounded-full border-2 ${isDone ? 'border-red-500 bg-red-500 text-white' : isActive ? 'border-red-500 bg-white dark:bg-zinc-900' : 'border-neutral-300 bg-white dark:border-zinc-600 dark:bg-zinc-900'}`}>
                  {isDone ? <Check className="h-4 w-4" strokeWidth={3} /> : isActive ? <span className="h-4 w-4 rounded-full bg-red-500" /> : null}
                </span>
                <span className={`max-w-full rounded-full px-1.5 py-1 text-[10px] leading-tight sm:px-3 sm:text-xs ${isActive ? 'bg-red-50 font-bold text-red-800 dark:bg-red-950/50 dark:text-red-300' : 'font-medium text-neutral-500 dark:text-zinc-400'}`}>{step.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {!isPickup && showTrackingWidget && (
        <div className="mt-5">
          {isTrackingEnabled ? (
            <div className="overflow-hidden rounded-[20px] border border-neutral-100 dark:border-zinc-800 bg-gradient-to-br from-red-50/70 via-neutral-50 to-white dark:from-red-950/25 dark:via-zinc-900 dark:to-zinc-900 p-3 shadow-[0_4px_20px_rgba(0,0,0,0.06)] sm:p-4">
              <div className="flex items-center justify-between gap-3 pb-3 sm:pb-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400"><MapPin className="h-5 w-5" aria-hidden="true" /></span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm sm:text-base font-bold text-neutral-950 dark:text-zinc-50">Seguimiento en Vivo <Radio className="h-4 w-4 shrink-0 text-red-600" /></p>
                    <p className="mt-0.5 text-[11px] sm:text-xs leading-snug text-neutral-500 dark:text-zinc-400">Sigue la ubicación de tu repartidor en tiempo real</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsTrackingEnabled?.(false);
                    setDriverLocation?.(null);
                  }}
                  aria-label="Cerrar mapa y ahorrar datos"
                  title="Cerrar mapa y ahorrar datos"
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white dark:bg-zinc-800 px-3 py-2.5 text-xs font-bold text-red-700 dark:text-red-300 shadow-sm ring-1 ring-red-100 dark:ring-red-900/40 transition-colors hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
                >
                  <X className="h-4 w-4" /> <span className="hidden sm:inline">Cerrar</span>
                </button>
              </div>
              {order ? (
                <LiveTrackingMap order={order} driverLocation={driverLocation || null} />
              ) : (
                <div className="h-52 w-full rounded-2xl border border-black/[0.05] bg-neutral-50 z-0 animate-scale-up no-invert md:h-64" />
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsTrackingEnabled?.(true)}
              className="w-full rounded-[20px] border border-neutral-100 dark:border-zinc-800 bg-gradient-to-r from-red-50/70 to-neutral-50 dark:from-red-950/25 dark:to-zinc-900 p-3 sm:p-4 flex items-center gap-3 text-left shadow-[0_4px_16px_rgba(0,0,0,0.05)] hover:from-red-50 transition-all active:scale-[0.98] group"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <img src="/seguimiento-moto.webp" alt="" aria-hidden="true" className="h-14 w-16 shrink-0 object-contain mix-blend-multiply dark:mix-blend-normal dark:rounded-xl transition-transform group-hover:scale-105 sm:h-20 sm:w-24" />
                <div className="min-w-0 border-l border-red-100 dark:border-red-900/40 pl-3">
                  <p className="flex items-center gap-1.5 text-sm sm:text-base font-bold text-neutral-950 dark:text-zinc-50">Seguimiento en Vivo <Radio className="h-4 w-4 shrink-0 text-red-600" /></p>
                  <p className="mt-0.5 text-[11px] sm:text-xs leading-snug text-neutral-500 dark:text-zinc-400">Sigue la ubicación de tu repartidor en tiempo real</p>
                </div>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-gradient-to-b from-red-500 to-red-700 px-3 py-2.5 sm:px-5 text-xs sm:text-sm font-bold text-white shadow-md shadow-red-200 dark:shadow-none">
                <MapPin className="h-4 w-4" /> Seguir
              </span>
            </button>
          )}
        </div>
      )}
    </section>
  );
});
