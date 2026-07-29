'use client';

import React, { useMemo } from 'react';

interface DashboardSectionProps {
  orders: any[];
  profile: any;
  products: any[];
  drivers: any[];
  kitchenClockNow: number;
  sessionOpenedAt: number | null;
  selectedWeekOffset: number;
  dashboardChartView: 'revenue' | 'orders';
  revenueMode: 'gross' | 'net';
  isPrintingTicket: boolean;
  unreadMessagesMap: Record<string, number>;
  updatingOperationalStatus: boolean;
  isBusinessOpen: boolean;
  isBusinessPaused: boolean;
  isWithinHours: boolean;
  operationalStatusLabel: string;
  restaurantName: string;
  onTogglePause: () => void;
  onToggleOperational: () => void;
  onSelectOrderForTicket: (order: any) => void;
  onSelectOrderForEtaExtension: (order: any) => void;
  onSetActiveTicketTab: (tab: string) => void;
  onPrintTicket: (order: any) => void;
  onSetDashboardChartView: (view: 'revenue' | 'orders') => void;
  onSetSelectedWeekOffset: (offset: number) => void;
  onSetRevenueMode: (mode: 'gross' | 'net') => void;
  onPushToast: (type: 'success' | 'error' | 'info', title: string, message?: string) => void;
  formatCurrency: (amount: number) => string;
  formatDate: (date: string) => string;
  getPreparationRemainingMs: (order: any, now: number) => number | null;
  isPreparationTimeUrgent: (order: any, now: number) => boolean;
  getRestaurantCollectionAmount: (order: any, hasOwnDelivery?: boolean) => number;
  getCustomerOrigin: () => string | null;
  formatWeekday: (date: Date) => string;
  formatCalendarDate: (date: Date) => string;
  formatHourLabel: (hour: number) => string;
  Panel: React.FC<any>;
}

export const DashboardSection = React.memo(function DashboardSection({
  orders, profile, products, drivers, kitchenClockNow, sessionOpenedAt,
  selectedWeekOffset, dashboardChartView, revenueMode, isPrintingTicket,
  unreadMessagesMap, updatingOperationalStatus, isBusinessOpen, isBusinessPaused,
  isWithinHours, operationalStatusLabel, restaurantName,
  onTogglePause, onToggleOperational, onSelectOrderForTicket,
  onSelectOrderForEtaExtension, onSetActiveTicketTab, onPrintTicket,
  onSetDashboardChartView, onSetSelectedWeekOffset, onSetRevenueMode, onPushToast,
  formatCurrency, formatDate, getPreparationRemainingMs, isPreparationTimeUrgent,
  getRestaurantCollectionAmount,   getCustomerOrigin, formatWeekday, formatCalendarDate,
  formatHourLabel, Panel,
}: DashboardSectionProps) {
  const ProfileBadge = React.useCallback(function ProfileBadge({ tone, label, detail }: { tone: string; label: string; detail: string }) {
    const colorMap: Record<string, string> = {
      amber: 'bg-amber-50 text-amber-800 border-amber-200/50',
      violet: 'bg-violet-50 text-violet-800 border-violet-200/50',
      sky: 'bg-sky-50 text-sky-800 border-sky-200/50',
      emerald: 'bg-emerald-50 text-emerald-800 border-emerald-200/50',
    };
    return (
      <div className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold ${colorMap[tone] || 'bg-neutral-50 text-neutral-700 border-black/5'}`}>
        <span>{label}</span>
        <span className="opacity-70">·</span>
        <span>{detail}</span>
      </div>
    );
  }, []);
  const todayKey = new Date().toDateString();
  const todayOrders = useMemo(() => {
    return orders.filter((order: any) => !order.id.startsWith('mock-order-') && new Date(order.createdAt).toDateString() === todayKey);
  }, [orders]);

  const activeOrders = useMemo(() => {
    return orders.filter((order: any) =>
      ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'PICKED_UP', 'IN_TRANSIT'].includes(order.status)
    );
  }, [orders]);

  const PENDING_WARN_MS = 3 * 60 * 1000;
  const QUIET_WARN_MS = 20 * 60 * 1000;

  const stalePendingOrders = useMemo(() => activeOrders.filter((o: any) => {
    if (o.status !== 'PENDING') return false;
    return (kitchenClockNow - new Date(o.createdAt).getTime()) > PENDING_WARN_MS;
  }), [activeOrders, kitchenClockNow]);

  const overdueKitchenOrders = useMemo(() => activeOrders.filter((o: any) => {
    if (!['CONFIRMED', 'PREPARING'].includes(o.status)) return false;
    if (profile?.businessType && profile.businessType !== 'RESTAURANT') {
      if (!o.estimatedDeliveryTime) return false;
      return new Date(o.estimatedDeliveryTime).getTime() <= kitchenClockNow;
    }
    const ms = getPreparationRemainingMs(o, kitchenClockNow);
    return typeof ms === 'number' && ms <= 0;
  }), [activeOrders, kitchenClockNow, profile, getPreparationRemainingMs]);

  const lastOrderTime = useMemo(() => {
    if (orders.length === 0) return null;
    return Math.max(...orders.map((o: any) => new Date(o.createdAt).getTime()));
  }, [orders]);
  const timeSinceLastOrder = lastOrderTime !== null ? kitchenClockNow - lastOrderTime : Infinity;
  const timeSinceOpened = sessionOpenedAt !== null ? kitchenClockNow - sessionOpenedAt : Infinity;
  const isQuiet = isBusinessOpen && !isBusinessPaused
    && lastOrderTime !== null
    && timeSinceLastOrder > QUIET_WARN_MS
    && timeSinceOpened > QUIET_WARN_MS
    && todayOrders.length > 0;

  const projectedRevenue = useMemo(() => {
    return orders
      .filter((order: any) => !order.id.startsWith('mock-order-') && !['CANCELLED', 'REJECTED'].includes(order.status))
      .reduce((sum: number, order: any) => sum + order.totalAmount, 0);
  }, [orders]);

  const todayRevenue = useMemo(() => {
    return todayOrders
      .filter((order: any) => !['CANCELLED', 'REJECTED'].includes(order.status))
      .reduce((sum: number, order: any) => {
        const isHelper = profile?.id ? order.supportRestaurantId === profile.id : false;
        if (isHelper) return sum + order.deliveryFee;
        const deliveredByRestaurant = order.deliveredByRestaurant ?? false;
        const hasOwnDelivery = order.restaurant?.hasOwnDelivery ?? profile?.hasOwnDelivery;
        if (deliveredByRestaurant || hasOwnDelivery) return sum + order.totalAmount;
        return sum + (order.totalAmount - (order.deliveryFee || 0));
      }, 0);
  }, [todayOrders, profile]);

  const todayNetRevenue = useMemo(() => {
    return todayOrders
      .filter((order: any) => !['CANCELLED', 'REJECTED'].includes(order.status))
      .reduce((sum: number, order: any) => {
        const isHelper = profile?.id ? order.supportRestaurantId === profile.id : false;
        let orderGross = 0;
        if (isHelper) {
          orderGross = order.deliveryFee;
        } else {
          const deliveredByRestaurant = order.deliveredByRestaurant ?? false;
          const hasOwnDelivery = order.restaurant?.hasOwnDelivery ?? profile?.hasOwnDelivery;
          if (deliveredByRestaurant || hasOwnDelivery) {
            orderGross = order.totalAmount;
          } else {
            orderGross = order.totalAmount - (order.deliveryFee || 0);
          }
        }
        return sum + (orderGross - (order.serviceFee ?? 0) - (order.platformFee ?? 0));
      }, 0);
  }, [todayOrders, profile]);

  const availableProductsCount = useMemo(() => products.filter((p: any) => p.isAvailable).length, [products]);

  const dashboardMetrics = useMemo(() => [
    {
      label: 'Ingresos hoy',
      value: formatCurrency(revenueMode === 'gross' ? todayRevenue : todayNetRevenue),
      hint: revenueMode === 'gross' ? 'Ingresos brutos' : 'Ganancia neta real',
      tone: 'emerald', icon: 'revenue' as const, isRevenue: true,
    },
    {
      label: 'Proyeccion mensual',
      value: formatCurrency(projectedRevenue),
      hint: 'Ingreso total estimado del periodo.',
      tone: 'sky', icon: 'revenue' as const,
    },
    {
      label: 'Ordenes activas',
      value: String(activeOrders.length),
      hint: `${todayOrders.length} pedidos el día de hoy.`,
      tone: 'sky', icon: 'orders' as const,
      deliveredCount: todayOrders.filter((o: any) => ['DELIVERED', 'PICKED_UP', 'COMPLETED'].includes(o.status)).length,
      rejectedCount: todayOrders.filter((o: any) => ['REJECTED', 'CANCELLED'].includes(o.status)).length,
    },
    {
      label: 'Ticket promedio',
      value: formatCurrency(
        todayOrders.filter((o: any) => !['CANCELLED', 'REJECTED'].includes(o.status)).length > 0
          ? todayOrders.filter((o: any) => !['CANCELLED', 'REJECTED'].includes(o.status))
              .reduce((s: number, o: any) => s + o.totalAmount, 0) /
            todayOrders.filter((o: any) => !['CANCELLED', 'REJECTED'].includes(o.status)).length
          : 0
      ),
      hint: `Con ${availableProductsCount} productos activos.`,
      tone: 'sky', icon: 'catalog' as const,
    },
  ], [todayRevenue, todayNetRevenue, revenueMode, projectedRevenue, activeOrders.length, todayOrders, formatCurrency, availableProductsCount]);

  const weeklySeries = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const today = new Date();
    const currentDay = today.getDay();
    const distanceToMonday = currentDay === 0 ? 6 : currentDay - 1;
    const date = new Date(today);
    date.setHours(0, 0, 0, 0);
    date.setDate(today.getDate() - distanceToMonday - (selectedWeekOffset * 7) + index);
    const dayKey = date.toDateString();
    const dayOrders = orders.filter((order: any) => !order.id.startsWith('mock-order-') && new Date(order.createdAt).toDateString() === dayKey);
    const validOrders = dayOrders.filter((order: any) => !['CANCELLED', 'REJECTED'].includes(order.status));
    const dayRevenue = validOrders.reduce((sum: number, order: any) => sum + getRestaurantCollectionAmount(order, profile?.hasOwnDelivery), 0);
    return {
      label: formatWeekday(date),
      dateLabel: formatCalendarDate(date),
      orders: validOrders.length,
      deliveredOrders: dayOrders.filter((o: any) => o.status === 'DELIVERED').length,
      rejectedOrders: dayOrders.filter((o: any) => ['CANCELLED', 'REJECTED'].includes(o.status)).length,
      revenue: dayRevenue,
    };
  }), [orders, selectedWeekOffset, profile, getRestaurantCollectionAmount, formatWeekday, formatCalendarDate]);

  const weeklyMaxOrders = useMemo(() => Math.max(...weeklySeries.map((item: any) => item.orders), 1), [weeklySeries]);
  const weeklyMaxRevenue = useMemo(() => Math.max(...weeklySeries.map((item: any) => item.revenue), 1), [weeklySeries]);

  const chartWidth = 420;
  const chartHeight = 170;
  const chartPaddingX = 18;
  const chartPaddingTop = 35;
  const chartUsableWidth = chartWidth - chartPaddingX * 2;
  const chartUsableHeight = chartHeight - chartPaddingTop - 26;

  const weeklyOrderPoints = useMemo(() => weeklySeries.map((item: any, index: number) => {
    const x = chartPaddingX + (weeklySeries.length === 1 ? chartUsableWidth / 2 : (index / (weeklySeries.length - 1)) * chartUsableWidth);
    const y = chartPaddingTop + chartUsableHeight - (item.orders / weeklyMaxOrders) * chartUsableHeight;
    return { x, y, ...item };
  }), [weeklySeries, weeklyMaxOrders]);

  const weeklyOrdersPolyline = useMemo(() => weeklyOrderPoints.map((p: any) => `${p.x},${p.y}`).join(' '), [weeklyOrderPoints]);
  const weeklyOrdersArea = useMemo(() => [
    `${weeklyOrderPoints[0]?.x ?? chartPaddingX},${chartHeight - 26}`,
    ...weeklyOrderPoints.map((p: any) => `${p.x},${p.y}`),
    `${weeklyOrderPoints[weeklyOrderPoints.length - 1]?.x ?? chartWidth - chartPaddingX},${chartHeight - 26}`,
  ].join(' '), [weeklyOrderPoints]);

  const weeklyRevenuePoints = useMemo(() => weeklySeries.map((item: any, index: number) => {
    const x = chartPaddingX + (weeklySeries.length === 1 ? chartUsableWidth / 2 : (index / (weeklySeries.length - 1)) * chartUsableWidth);
    const y = chartPaddingTop + chartUsableHeight - (item.revenue / weeklyMaxRevenue) * chartUsableHeight;
    return { x, y, ...item };
  }), [weeklySeries, weeklyMaxRevenue]);

  const weeklyRevenuePolyline = useMemo(() => weeklyRevenuePoints.map((p: any) => `${p.x},${p.y}`).join(' '), [weeklyRevenuePoints]);
  const weeklyRevenueArea = useMemo(() => [
    `${weeklyRevenuePoints[0]?.x ?? chartPaddingX},${chartHeight - 26}`,
    ...weeklyRevenuePoints.map((p: any) => `${p.x},${p.y}`),
    `${weeklyRevenuePoints[weeklyRevenuePoints.length - 1]?.x ?? chartWidth - chartPaddingX},${chartHeight - 26}`,
  ].join(' '), [weeklyRevenuePoints]);

  const realOrders = useMemo(() => orders.filter((o: any) => !o.id.startsWith('mock-order-')), [orders]);
  const deliveredOrdersCount = useMemo(() => realOrders.filter((o: any) => o.status === 'DELIVERED').length, [realOrders]);
  const rejectedOrdersCount = useMemo(() => realOrders.filter((o: any) => o.status === 'REJECTED').length, [realOrders]);
  const cancelledOrdersCount = useMemo(() => realOrders.filter((o: any) => o.status === 'CANCELLED').length, [realOrders]);
  const completedOrdersCount = deliveredOrdersCount;
  const unresolvedOrdersCount = useMemo(() => realOrders.filter((o: any) =>
    ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'PICKED_UP', 'IN_TRANSIT'].includes(o.status)
  ).length, [realOrders]);
  const totalResolvedOrders = completedOrdersCount + rejectedOrdersCount + cancelledOrdersCount;
  const acceptedOrdersCount = useMemo(() => realOrders.filter((o: any) => o.status !== 'REJECTED').length, [realOrders]);
  const acceptanceRate = realOrders.length > 0 ? Math.round((acceptedOrdersCount / realOrders.length) * 100) : 0;
  const completionRate = totalResolvedOrders > 0 ? Math.round((completedOrdersCount / totalResolvedOrders) * 100) : 0;
  const averageProductsPerOrder = useMemo(() => realOrders.length
    ? (realOrders.reduce((sum: number, order: any) => sum + (order.items?.reduce((itemSum: number, item: any) => itemSum + item.quantity, 0) || 0), 0) / realOrders.length).toFixed(1)
    : '0.0', [realOrders]);

  const servicePerformanceCards = useMemo(() => [
    {
      label: 'Aceptacion',
      value: `${acceptanceRate}%`,
      description: `${rejectedOrdersCount} pedidos rechazados del total recibido.`,
      tone: acceptanceRate >= 85 ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-black/5 bg-neutral-50 text-neutral-700',
    },
    {
      label: 'Entregas completadas',
      value: `${completionRate}%`,
      description: `${completedOrdersCount} entregadas frente a ${totalResolvedOrders} ya resueltas.`,
      tone: 'border-black/5 bg-neutral-50 text-neutral-700',
    },
    {
      label: 'Carga activa',
      value: String(unresolvedOrdersCount),
      description: 'Pedidos que siguen dentro del flujo operativo.',
      tone: unresolvedOrdersCount > 0 ? 'border-sky-200 bg-sky-50 text-sky-800' : 'border-black/5 bg-neutral-50 text-neutral-700',
    },
    {
      label: 'Tamano por orden',
      value: averageProductsPerOrder,
      description: 'Promedio de productos por pedido capturado.',
      tone: 'border-black/5 bg-neutral-50 text-neutral-700',
    },
  ], [acceptanceRate, rejectedOrdersCount, completionRate, completedOrdersCount, totalResolvedOrders, unresolvedOrdersCount, averageProductsPerOrder]);

  const hasAlerts = stalePendingOrders.length > 0 || overdueKitchenOrders.length > 0 || isQuiet;

  return (
    <div className="space-y-3 md:space-y-5">
      {hasAlerts && (
        <div className="flex flex-col gap-2">
          {stalePendingOrders.length > 0 && (
            <button type="button" onClick={() => onSelectOrderForTicket(stalePendingOrders[0])}
              className="group flex w-full items-center gap-3 rounded-[20px] border border-rose-200 bg-gradient-to-r from-rose-50 to-rose-50/60 px-5 py-3.5 text-left shadow-[0_4px_16px_rgba(225,29,72,0.10)] transition-all duration-200 hover:border-rose-300 hover:shadow-[0_8px_24px_rgba(225,29,72,0.15)] hover:-translate-y-0.5"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-500 text-white shadow-[0_4px_10px_rgba(225,29,72,0.35)]">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 9v3m0 3h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-rose-900">
                  {stalePendingOrders.length === 1 ? '1 pedido lleva más de 3 min sin respuesta' : `${stalePendingOrders.length} pedidos llevan más de 3 min sin respuesta`}
                </p>
                <p className="text-xs text-rose-600 mt-0.5">Toca para atender · El cliente está esperando</p>
              </div>
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
              </span>
            </button>
          )}
          {overdueKitchenOrders.length > 0 && (
            <button type="button" onClick={() => onSelectOrderForEtaExtension(overdueKitchenOrders[0])}
              className="group flex w-full items-center gap-3 rounded-[20px] border border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50/60 px-5 py-3.5 text-left shadow-[0_4px_16px_rgba(251,146,60,0.10)] transition-all duration-200 hover:border-orange-300 hover:shadow-[0_8px_24px_rgba(251,146,60,0.15)] hover:-translate-y-0.5"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-500 text-white shadow-[0_4px_10px_rgba(251,146,60,0.35)]">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-orange-900">
                  {overdueKitchenOrders.length === 1 ? '1 pedido en cocina ha excedido su tiempo' : `${overdueKitchenOrders.length} pedidos en cocina han excedido su tiempo`}
                </p>
                <p className="text-xs text-orange-600 mt-0.5">Toca para extender el tiempo estimado</p>
              </div>
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-orange-500" />
              </span>
            </button>
          )}
          {isQuiet && stalePendingOrders.length === 0 && overdueKitchenOrders.length === 0 && (
            <div className="flex items-center gap-3 rounded-[20px] border border-sky-200 bg-gradient-to-r from-sky-50 to-blue-50/50 px-5 py-3.5 shadow-[0_4px_16px_rgba(14,165,233,0.08)]">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-600">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-sky-900">Sin actividad en los últimos 20 minutos</p>
                <p className="text-xs text-sky-600 mt-0.5">El negocio está abierto · Revisa tu visibilidad en la app</p>
              </div>
            </div>
          )}
        </div>
      )}

      <section className="relative overflow-hidden rounded-[28px] border border-black/5 bg-white p-5 shadow-[0_16px_50px_rgba(15,15,15,0.06)] backdrop-blur md:p-6">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-[-5%] top-[-20%] h-36 w-36 rounded-full bg-sky-200/35 blur-3xl" />
          <div className="absolute right-[-4%] bottom-[-20%] h-32 w-48 rounded-full bg-blue-200/25 blur-3xl" />
        </div>
        <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-neutral-400">Panel de Control</p>
            <h1 className="mt-1.5 truncate text-[1.9rem] font-semibold tracking-[-0.05em] text-neutral-950 md:text-[2.2rem]">{restaurantName}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700">
                ⭐ {profile?.stats?.rating ? profile.stats.rating.toFixed(1) : 'Nuevo'}
                {(profile?.stats?.reviewCount ?? 0) > 0 && <span className="font-normal text-amber-600">({profile?.stats?.reviewCount})</span>}
              </span>
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                profile?.status === 'ACTIVE' && isBusinessOpen && isWithinHours
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : isBusinessPaused
                  ? 'border-sky-200 bg-sky-50 text-sky-700'
                  : 'border-neutral-200 bg-neutral-100 text-neutral-600'
              }`}>
                {profile?.status === 'ACTIVE' && isBusinessOpen && isWithinHours && (
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-600" />
                  </span>
                )}
                {operationalStatusLabel}
              </span>
              {activeOrders.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-sky-600" />
                  </span>
                  {activeOrders.length} activa{activeOrders.length !== 1 ? 's' : ''}
                </span>
              )}
              {profile && (
                <button type="button" onClick={async () => {
                  const origin = getCustomerOrigin();
                  if (!origin) {
                    onPushToast('error', 'No configurado', 'Define NEXT_PUBLIC_CUSTOMER_URL en las variables de entorno para compartir tu tienda.');
                    return;
                  }
                  const url = `${origin}/restaurantes/${profile.id}`;
                  try {
                    await navigator.clipboard.writeText(url);
                    onPushToast('success', 'Enlace copiado', 'El enlace de tu tienda se copió al portapapeles.');
                  } catch {
                    onPushToast('error', 'Error', 'No se pudo copiar el enlace. Intenta de nuevo.');
                  }
                }} className="inline-flex items-center gap-1 rounded-full border border-black/10 bg-white px-2.5 py-1 text-xs font-semibold text-neutral-500 shadow-sm transition hover:bg-neutral-50 hover:text-neutral-800 active:scale-95" title="Copiar enlace de tu tienda">
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" /></svg>
                  Copiar link
                </button>
              )}
            </div>
          </div>
          {profile && profile?.status === 'ACTIVE' ? (
            <div className="flex flex-col sm:flex-row shrink-0 items-stretch sm:items-center gap-2">
              <button type="button" onClick={onTogglePause} disabled={updatingOperationalStatus || !isBusinessOpen}
                className={`w-full sm:w-auto rounded-full px-4 py-2.5 text-sm font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${
                  isBusinessPaused
                    ? 'bg-amber-500 text-white shadow-[0_4px_14px_rgba(245,158,11,0.35)] hover:bg-amber-600'
                    : 'border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50'
                }`}
              >
                {isBusinessPaused ? '▶ Reanudar' : '⏸ Pausar'}
              </button>
              <button type="button" onClick={onToggleOperational} disabled={updatingOperationalStatus}
                className={`w-full sm:w-auto rounded-full px-4 py-2.5 text-sm font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${
                  isBusinessOpen
                    ? 'bg-neutral-950 text-white hover:bg-neutral-800'
                    : 'bg-sky-600 text-white shadow-[0_4px_14px_rgba(14,165,233,0.4)] hover:bg-sky-700'
                }`}
              >
                {isBusinessOpen ? 'Cerrar Negocio' : '🚀 Abrir Negocio'}
              </button>
            </div>
          ) : profile === null ? (
            <div className="flex flex-col sm:flex-row shrink-0 items-stretch sm:items-center gap-2">
              <div className="w-full sm:w-[120px] h-[42px] rounded-full bg-neutral-100 animate-pulse" />
              <div className="w-full sm:w-[150px] h-[42px] rounded-full bg-neutral-100 animate-pulse" />
            </div>
          ) : null}
        </div>
        <div className="relative mt-4 flex flex-wrap gap-2 border-t border-black/5 pt-4">
          <ProfileBadge tone="amber" label="En cocina ahora" detail={`${activeOrders.filter((o: any) => ['PENDING','CONFIRMED','PREPARING'].includes(o.status)).length} pedidos`} />
          <ProfileBadge tone="violet" label="Ingreso proyectado" detail={formatCurrency(projectedRevenue)} />
          <ProfileBadge tone="sky" label="Catálogo activo" detail={`${availableProductsCount} de ${products.length} disponibles`} />
          {drivers.length > 0 && (
            <ProfileBadge tone="emerald" label="Repartidores" detail={`${drivers.length} disponible${drivers.length !== 1 ? 's' : ''}`} />
          )}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {dashboardMetrics.map((metric: any, index: number) => (
          <article key={metric.label} style={{ animationDelay: `${index * 60}ms` }}
            className="group relative overflow-hidden rounded-[24px] border border-black/5 bg-white p-4 md:p-5 shadow-[0_8px_30px_rgba(15,15,15,0.04)] transition-all duration-300 hover:shadow-[0_16px_40px_rgba(15,15,15,0.08)] hover:-translate-y-0.5"
          >
            <div className={`absolute left-0 top-0 h-full w-1 rounded-l-[24px] ${
              metric.tone === 'amber' ? 'bg-amber-400' :
              metric.tone === 'emerald' ? 'bg-sky-500' :
              metric.tone === 'sky' ? 'bg-sky-400' : 'bg-neutral-300'
            }`} />
            <div className="pl-2">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-neutral-400">{metric.label}</p>
                    {metric.isRevenue && (
                      <div className="inline-flex rounded-lg p-0.5 bg-neutral-100/80 border border-black/5 text-[10px] font-bold">
                        <button type="button" onClick={(e) => { e.stopPropagation(); onSetRevenueMode('gross'); }}
                          className={`px-2 py-0.5 rounded-md transition ${revenueMode === 'gross' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500 hover:text-neutral-900'}`}>Bruto</button>
                        <button type="button" onClick={(e) => { e.stopPropagation(); onSetRevenueMode('net'); }}
                          className={`px-2 py-0.5 rounded-md transition ${revenueMode === 'net' ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500 hover:text-neutral-900'}`}>Neto</button>
                      </div>
                    )}
                  </div>
                  <p className="mt-2 text-2xl md:text-3xl font-bold tracking-[-0.04em] text-neutral-950">{metric.value}</p>
                  <p className="mt-1 text-xs text-neutral-500 leading-normal">{metric.hint}</p>
                  {metric.icon === 'orders' && metric.deliveredCount !== undefined && metric.rejectedCount !== undefined && (
                    <div className="mt-3.5 flex items-center gap-3.5 border-t border-black/[0.04] pt-3">
                      <div className="group/stat flex items-center gap-2 transition-opacity hover:opacity-80" title="Pedidos entregados exitosamente">
                        <div className="relative flex h-5 w-5 items-center justify-center rounded-full bg-emerald-50 ring-1 ring-emerald-500/20">
                          <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
                        </div>
                        <span className="text-[12px] font-black text-neutral-800 leading-none">{metric.deliveredCount}</span>
                      </div>
                      <div className="h-3 w-px bg-black/[0.06]" />
                      <div className="group/stat flex items-center gap-2 transition-opacity hover:opacity-80" title="Pedidos rechazados o cancelados">
                        <div className="relative flex h-5 w-5 items-center justify-center rounded-full bg-rose-50 ring-1 ring-rose-500/20">
                          <div className="h-2 w-2 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.4)]" />
                        </div>
                        <span className="text-[12px] font-black text-neutral-800 leading-none">{metric.rejectedCount}</span>
                      </div>
                    </div>
                  )}
                </div>
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] ${
                  metric.tone === 'amber' ? 'border-sky-200 bg-sky-50 text-sky-700' :
                  metric.tone === 'emerald' ? 'border-sky-200 bg-sky-50 text-sky-700' :
                  metric.tone === 'sky' ? 'border-sky-200 bg-sky-50 text-sky-700' :
                  'border-neutral-200 bg-neutral-50 text-neutral-600'
                }`}>
                  <MetricGlyph kind={metric.icon} />
                </div>
              </div>
            </div>
          </article>
        ))}
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {servicePerformanceCards.map((card: any) => (
          <div key={card.label} className={`rounded-[22px] border p-4 ${card.tone}`}>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] opacity-70">{card.label}</p>
            <p className="mt-2 text-2xl font-bold tracking-tight">{card.value}</p>
            <p className="mt-1 text-[11px] leading-4 opacity-60">{card.description}</p>
          </div>
        ))}
      </section>

      <Panel title="Semana" subtitle="Ventas y pedidos" tone="violet">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex rounded-xl border border-black/8 bg-neutral-100/70 p-0.5">
            <button type="button" onClick={() => onSetDashboardChartView('revenue')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${dashboardChartView === 'revenue' ? 'bg-white shadow-sm text-sky-700' : 'text-neutral-500 hover:text-neutral-700'}`}>Ingresos</button>
            <button type="button" onClick={() => onSetDashboardChartView('orders')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${dashboardChartView === 'orders' ? 'bg-white shadow-sm text-sky-700' : 'text-neutral-500 hover:text-neutral-700'}`}>Pedidos</button>
          </div>
          <select value={selectedWeekOffset} onChange={(e) => onSetSelectedWeekOffset(Number(e.target.value))}
            className="rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-xs font-semibold text-neutral-700 focus:outline-none focus:ring-1 focus:ring-sky-500"
          >
            <option value={0}>Esta semana</option>
            <option value={1}>Hace 1 semana</option>
            <option value={2}>Hace 2 semanas</option>
            <option value={3}>Hace 3 semanas</option>
          </select>
        </div>
        <div className="mb-3 flex items-baseline gap-2 flex-wrap">
          <span className="text-2xl font-bold tracking-tight text-neutral-950">
            {dashboardChartView === 'revenue'
              ? formatCurrency(weeklySeries.reduce((s: number, d: any) => s + d.revenue, 0))
              : `${weeklySeries.reduce((s: number, d: any) => s + d.orders, 0)} ped.`}
          </span>
          <span className="text-xs text-neutral-400">
            {selectedWeekOffset === 0 ? 'esta semana' : selectedWeekOffset === 1 ? 'semana pasada' : `hace ${selectedWeekOffset} semanas`}
          </span>
          {dashboardChartView === 'orders' && (
            <div className="ml-auto flex items-center gap-2 text-xs font-medium">
              <span className="text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-md">
                {weeklySeries.reduce((s: number, d: any) => s + d.deliveredOrders, 0)} Entregados
              </span>
              <span className="text-rose-700 bg-rose-50 border border-rose-100 px-2 py-0.5 rounded-md">
                {weeklySeries.reduce((s: number, d: any) => s + d.rejectedOrders, 0)} Rechazados
              </span>
            </div>
          )}
        </div>
        <div className="relative h-[185px] w-full">
          <svg className="h-full w-full" viewBox={`0 0 ${chartWidth} ${chartHeight}`}>
            <defs>
              <linearGradient id="dashGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.22" />
                <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0.25, 0.5, 0.75].map((frac) => (
              <line key={frac} x1={chartPaddingX} x2={chartWidth - chartPaddingX}
                y1={chartPaddingTop + chartUsableHeight * (1 - frac)}
                y2={chartPaddingTop + chartUsableHeight * (1 - frac)}
                stroke="#e5e5e5" strokeWidth="1" strokeDasharray="4 3" />
            ))}
            <polygon points={dashboardChartView === 'revenue' ? weeklyRevenueArea : weeklyOrdersArea} fill="url(#dashGrad)" />
            <polyline points={dashboardChartView === 'revenue' ? weeklyRevenuePolyline : weeklyOrdersPolyline}
              fill="none" stroke="#0284c7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            {(dashboardChartView === 'revenue' ? weeklyRevenuePoints : weeklyOrderPoints).map((point: any, index: number) => (
              <g key={`${point.x}-${point.y}-${index}`}>
                <circle cx={point.x} cy={point.y} r="4" fill="white" stroke="#7c3aed" strokeWidth="2" />
                <text x={point.x} y={point.y - 9} textAnchor="middle" fontSize="8" fill="#0369a1" fontWeight="700">
                  {dashboardChartView === 'revenue' ? formatCurrency(point.revenue) : `${point.orders}`}
                </text>
              </g>
            ))}
            {weeklySeries.map((item: any, index: number) => {
              const x = chartPaddingX + (index / (weeklySeries.length - 1)) * chartUsableWidth;
              return (
                <text key={`${item.label}-${index}`} x={x} y={chartHeight - 5} textAnchor="middle" fontSize="10" fill="#a3a3a3">
                  {item.label}
                </text>
              );
            })}
          </svg>
        </div>
      </Panel>

      <Panel title={profile?.businessType !== 'RESTAURANT' ? 'Monitor de Pedidos' : 'Monitor de Ordenes en Vivo'}
        subtitle={profile?.businessType !== 'RESTAURANT' ? 'Flujo de surtido y despacho' : 'Flujo de cocina y despacho'} tone="violet"
      >
        <div className="grid gap-3 md:grid-cols-3">
          <OrderColumn
            title={profile?.businessType !== 'RESTAURANT' ? 'Por Surtir' : 'Por Aceptar'}
            dotClass="bg-amber-400"
            orders={activeOrders.filter((o: any) => o.status === 'PENDING')}
            emptyText="Sin pendientes"
            onSelectOrder={onSelectOrderForTicket}
            onSelectOrderChat={(order: any) => { onSetActiveTicketTab('chat'); onSelectOrderForTicket(order); }}
            onPrintTicket={onPrintTicket}
            isPrintingTicket={isPrintingTicket}
            unreadMessagesMap={unreadMessagesMap}
            formatCurrency={formatCurrency}
            formatDate={formatDate}
            profile={profile}
            getRestaurantCollectionAmount={getRestaurantCollectionAmount}
          />
          <OrderColumn
            title={profile?.businessType !== 'RESTAURANT' ? 'En Surtido' : 'En Cocina'}
            dotClass="bg-sky-500 animate-pulse"
            orders={activeOrders.filter((o: any) => ['CONFIRMED', 'PREPARING'].includes(o.status))}
            emptyText="Sin ordenes en cocina"
            onSelectOrder={onSelectOrderForTicket}
            onSelectOrderChat={(order: any) => { onSetActiveTicketTab('chat'); onSelectOrderForTicket(order); }}
            onPrintTicket={onPrintTicket}
            isPrintingTicket={isPrintingTicket}
            unreadMessagesMap={unreadMessagesMap}
            formatCurrency={formatCurrency}
            formatDate={formatDate}
            profile={profile}
            getRestaurantCollectionAmount={getRestaurantCollectionAmount}
            kitchenColumn
            kitchenClockNow={kitchenClockNow}
            onSelectOrderForEtaExtension={onSelectOrderForEtaExtension}
            getPreparationRemainingMs={getPreparationRemainingMs}
            isPreparationTimeUrgent={isPreparationTimeUrgent}
          />
          <OrderColumn
            title="Despacho"
            dotClass="bg-emerald-400"
            orders={activeOrders.filter((o: any) => ['READY', 'PICKED_UP', 'IN_TRANSIT'].includes(o.status))}
            emptyText="Sin entregas"
            onSelectOrder={onSelectOrderForTicket}
            onSelectOrderChat={(order: any) => { onSetActiveTicketTab('chat'); onSelectOrderForTicket(order); }}
            onPrintTicket={onPrintTicket}
            isPrintingTicket={isPrintingTicket}
            unreadMessagesMap={unreadMessagesMap}
            formatCurrency={formatCurrency}
            formatDate={formatDate}
            profile={profile}
            getRestaurantCollectionAmount={getRestaurantCollectionAmount}
            isDispatch
          />
        </div>
      </Panel>
    </div>
  );
});

function MetricGlyph({ kind }: { kind: string }) {
  if (kind === 'revenue') {
    return (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  }
  if (kind === 'orders') {
    return (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
      </svg>
    );
  }
  if (kind === 'catalog') {
    return (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
      </svg>
    );
  }
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

const OrderColumn = React.memo(function OrderColumn({
  title, dotClass, orders, emptyText,
  onSelectOrder, onSelectOrderChat, onPrintTicket, isPrintingTicket,
  unreadMessagesMap, formatCurrency, formatDate, profile, getRestaurantCollectionAmount,
  kitchenColumn, kitchenClockNow, onSelectOrderForEtaExtension, getPreparationRemainingMs, isPreparationTimeUrgent,
  isDispatch,
}: any) {
  return (
    <div className="rounded-[20px] border border-black/5 bg-neutral-50/80 p-3">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${dotClass}`} />
          <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-600">{title}</h3>
        </div>
        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-bold text-sky-700">{orders.length}</span>
      </div>
      <div className="space-y-2">
        {orders.map((order: any) => (
          <div key={order.id} onClick={() => onSelectOrder(order)}
            className="cursor-pointer rounded-xl border border-black/5 bg-white p-3 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-bold text-neutral-900">
                  {(order as any).dailyCounter ? `#${String((order as any).dailyCounter).padStart(2, '0')}` : order.orderReference.slice(-6)}
                </p>
                {order.id.startsWith('mock-order-') && (
                  <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[9px] font-bold text-sky-800 shrink-0 animate-pulse">SIMULACIÓN</span>
                )}
                {unreadMessagesMap[order.id] > 0 && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); onSelectOrderChat(order); }}
                    className="inline-flex items-center gap-0.5 rounded-full bg-rose-500 px-1.5 py-0.5 text-[9px] font-black text-white animate-pulse shadow-sm transition hover:bg-rose-600 active:scale-95"
                  >
                    💬 {unreadMessagesMap[order.id]}
                  </button>
                )}
              </div>
              <p className="text-xs font-bold text-neutral-900">{formatCurrency(getRestaurantCollectionAmount(order, profile?.hasOwnDelivery))}</p>
            </div>
            <p className="mt-1 truncate text-xs text-neutral-500">👤 {order.customer?.user?.name || 'Cliente'}</p>
            {kitchenColumn && (
              <KitchenOrderActions order={order} kitchenClockNow={kitchenClockNow}
                onExtendEta={onSelectOrderForEtaExtension} getPreparationRemainingMs={getPreparationRemainingMs}
                isPreparationTimeUrgent={isPreparationTimeUrgent} profile={profile}
              />
            )}
            {isDispatch && (
              <DispatchOrderActions order={order} />
            )}
            <div className="mt-2.5 flex items-center justify-between border-t border-dashed border-neutral-100 pt-2">
              <span className="text-[10px] text-neutral-400">
                {profile?.businessType !== 'RESTAURANT' && order.estimatedDeliveryTime ? formatDate(order.estimatedDeliveryTime) : formatDate(order.createdAt)}
              </span>
              <div className="flex items-center gap-2">
                {profile?.enableTicketPrinting !== false && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); onPrintTicket(order); }}
                    disabled={isPrintingTicket}
                    className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900 transition-colors" title="Imprimir comanda"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                  </button>
                )}
                {!kitchenColumn && !isDispatch && <span className="text-[10px] font-bold text-sky-600">Ver →</span>}
                {kitchenColumn && <span className="text-[11px] font-bold text-neutral-900 bg-neutral-100 px-2 py-0.5 rounded-md">{formatCurrency(getRestaurantCollectionAmount(order, profile?.hasOwnDelivery))}</span>}
              </div>
            </div>
          </div>
        ))}
        {orders.length === 0 && <div className="py-6 text-center text-xs text-neutral-400">{emptyText}</div>}
      </div>
    </div>
  );
});

const KitchenOrderActions = React.memo(function KitchenOrderActions({ order, kitchenClockNow, onExtendEta, getPreparationRemainingMs, isPreparationTimeUrgent, profile }: any) {
  const isPreparing = order.status === 'PREPARING';
  const isStore = profile?.businessType && profile.businessType !== 'RESTAURANT';
  const overdueInfo = useMemo(() => {
    let isOverdue = false;
    let overdueMinutes = 0;
    if (order.scheduledDeliveryAt) {
      const scheduledMs = new Date(order.scheduledDeliveryAt).getTime() - kitchenClockNow;
      if (scheduledMs <= 0) {
        isOverdue = true;
        overdueMinutes = Math.max(1, Math.round(Math.abs(scheduledMs) / 60000));
      }
    } else {
      const remainingMs = getPreparationRemainingMs(order, kitchenClockNow);
      if (typeof remainingMs === 'number') {
        isOverdue = remainingMs <= 0;
        overdueMinutes = Math.max(1, Math.round(Math.abs(remainingMs) / 60000));
      }
    }
    return { isOverdue, overdueMinutes };
  }, [order, kitchenClockNow, getPreparationRemainingMs]);

  const isUrgent = isPreparationTimeUrgent(order, kitchenClockNow);

  return (
    <>
      <div className="mt-2 flex items-center gap-1.5">
        <span className={`inline-block h-2 w-2 rounded-full ${isPreparing ? 'animate-pulse bg-orange-500' : 'bg-sky-400'}`} />
        <span className={`text-[10px] font-semibold uppercase tracking-wide ${isPreparing ? 'text-orange-600' : 'text-sky-600'}`}>
          {isPreparing ? 'Preparando' : 'Confirmado'}
        </span>
      </div>
      {overdueInfo.isOverdue ? (
        <button type="button" onClick={(e) => { e.stopPropagation(); onExtendEta(order); }}
          className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl border border-rose-300 bg-rose-500 px-3 py-2.5 text-white shadow-[0_8px_20px_rgba(225,29,72,0.2)] animate-pulse transition hover:bg-rose-600 active:scale-95"
        >
          <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <div className="flex flex-col items-center">
            <span className="text-xs font-black uppercase tracking-wider text-center">Pedido rezagado</span>
            <span className="text-[10px] font-bold opacity-90">Atrasado {overdueInfo.overdueMinutes} min · Toca para reprogramar</span>
          </div>
        </button>
      ) : isStore && !order.preparationDeadlineAt ? null : (
        <button type="button" onClick={(e) => { e.stopPropagation(); onExtendEta(order); }}
          className={`absolute top-3 right-3 rounded-lg border px-2 py-1 text-[10px] font-black shadow-sm transition active:scale-95 ${
            isUrgent
              ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 ring-2 ring-rose-200/50 animate-pulse'
              : 'border-sky-100 bg-sky-50 text-sky-700 hover:bg-sky-100'
          }`}
        >
          <CountdownText order={order} />
        </button>
      )}
    </>
  );
});

const DispatchOrderActions = React.memo(function DispatchOrderActions({ order }: any) {
  const isPickedUp = order.status === 'PICKED_UP';
  const isInTransit = order.status === 'IN_TRANSIT';
  let dotClass = 'bg-emerald-400';
  let textClass = 'text-emerald-600';
  let statusLabel = 'Listo';
  if (isPickedUp) { dotClass = 'bg-teal-400'; textClass = 'text-teal-600'; statusLabel = 'Recogido'; }
  if (isInTransit) { dotClass = 'bg-cyan-400 animate-bounce'; textClass = 'text-cyan-600'; statusLabel = 'En camino 🛵'; }
  return (
    <div className="mt-2 flex items-center gap-1.5">
      <span className={`inline-block h-2 w-2 rounded-full ${dotClass}`} />
      <span className={`text-[10px] font-semibold uppercase tracking-wide ${textClass}`}>{statusLabel}</span>
    </div>
  );
});

const CountdownText: React.FC<{ order: any; className?: string }> = ({ order, className = '' }) => {
  const timerKey = `${order.id}-${order.status}-${order.etaExtendedAt || ''}`;
  const [remaining, setRemaining] = React.useState<string>('--');
  React.useEffect(() => {
    function tick() {
      if (typeof window === 'undefined') return;
      try {
        const raw = localStorage.getItem(`prep_deadline_${order.id}`);
        if (raw) {
          const deadline = parseInt(raw, 10);
          const diff = deadline - Date.now();
          if (diff <= 0) { setRemaining('0s'); return; }
          const m = Math.floor(diff / 60000);
          const s = Math.floor((diff % 60000) / 1000);
          setRemaining(`${m}m ${s}s`);
          return;
        }
      } catch {}
      if (order.preparationDeadlineAt) {
        const diff = new Date(order.preparationDeadlineAt).getTime() - Date.now();
        if (diff <= 0) { setRemaining('0s'); return; }
        const m = Math.floor(diff / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        setRemaining(`${m}m ${s}s`);
        return;
      }
      setRemaining('--');
    }
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [order.id, order.preparationDeadlineAt, timerKey]);
  return <span className={`tabular-nums ${className}`}>{remaining}</span>;
};
