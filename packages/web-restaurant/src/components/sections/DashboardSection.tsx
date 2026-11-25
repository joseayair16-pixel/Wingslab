'use client';
import { CalendarDays, Check, Clock, Clock3, Copy, Pause, Play, Power, PackageCheck, ReceiptText, Users } from 'lucide-react';

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { isActiveOrderStatus, requestJson } from '@sadel/shared';

function useRestaurantReport(apiBase: string, token: string, query: string) {
  const [result, setResult] = useState<{ data: any; query: string; apiBase: string; token: string } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    setLoading(true); setError('');
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('La consulta tardó demasiado. Comprueba tu conexión e intenta de nuevo.')), 12000); });
    const request = requestJson<{ success: boolean; data: any }>({ apiBase, path: `/restaurant-panel/reportes?${query}`, token, timeoutMs: 10000, retry: { attempts: 0 }, fallbackMessage: 'No se pudo cargar el reporte.' });
    void Promise.race([request, deadline]).then(result => {
      if (!result?.data?.sales || !result.data.customers || !result.data.operations || !Array.isArray(result.data.topProducts) || !Array.isArray(result.data.promotions)) throw new Error('El reporte recibido está incompleto. Intenta de nuevo.');
      if (active) setResult({ data: result.data, query, apiBase, token });
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'No se pudo cargar el reporte.'); }).finally(() => { clearTimeout(timer); if (active) setLoading(false); });
    return () => { active = false; clearTimeout(timer); };
  }, [apiBase, token, query, attempt]);
  const currentResult = result?.apiBase === apiBase && result.token === token ? result : null;
  return { data: currentResult?.query === query ? currentResult.data : null, error, loading: loading || (!!currentResult && currentResult.query !== query && !error), retry: () => setAttempt(value => value + 1) };
}

interface DashboardSectionProps {
  apiBase: string;
  token: string;
  orders: any[];
  profile: any;
  products: any[];
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
  getRestaurantCollectionAmount: (order: any, profile?: { id?: string; hasOwnDelivery?: boolean } | null) => number;
  getCustomerOrigin: () => string | null;
  formatWeekday: (date: Date) => string;
  formatCalendarDate: (date: Date) => string;
  formatHourLabel: (hour: number) => string;
  Panel: React.FC<any>;
}

export const DashboardSection = React.memo(function DashboardSection({
  apiBase, token, orders, profile, products, kitchenClockNow,
  selectedWeekOffset, dashboardChartView, revenueMode, isPrintingTicket,
  unreadMessagesMap, updatingOperationalStatus, isBusinessOpen, isBusinessPaused,
  isWithinHours, operationalStatusLabel, restaurantName,
  onTogglePause, onToggleOperational, onSelectOrderForTicket,
  onSelectOrderForEtaExtension, onSetActiveTicketTab, onPrintTicket,
  onSetDashboardChartView, onSetSelectedWeekOffset, onSetRevenueMode, onPushToast,
  formatCurrency, formatDate, getPreparationRemainingMs, isPreparationTimeUrgent,
  getRestaurantCollectionAmount,   getCustomerOrigin, formatWeekday, formatCalendarDate,
  Panel,
}: DashboardSectionProps) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [copyCount, setCopyCount] = useState(0);
  useEffect(() => {
    if (!copyCount) return;
    const timer = window.setTimeout(() => setCopyCount(0), 2000);
    return () => window.clearTimeout(timer);
  }, [copyCount]);
  const mexicoToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(kitchenClockNow));
  const [selectedDate, setSelectedDate] = useState('');
  const selectedDay = selectedDate || mexicoToday;
  const { data: report, error: reportError, loading: reportLoading, retry: retryReport } = useRestaurantReport(apiBase, token, `weekOffset=${weekOffset}`);
  const { data: today, error: todayError, loading: todayLoading, retry: retryToday } = useRestaurantReport(apiBase, token, `date=${selectedDay}`);
  const weekOptions = useMemo(() => {
    const anchor = new Date(`${mexicoToday}T12:00:00Z`);
    anchor.setUTCDate(anchor.getUTCDate() - (anchor.getUTCDay() + 6) % 7);
    const format = new Intl.DateTimeFormat('es-MX', { timeZone: 'UTC', day: 'numeric', month: 'short' });
    return Array.from({ length: 7 }, (_, offset) => {
      const start = new Date(anchor); start.setUTCDate(start.getUTCDate() - offset * 7);
      const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6);
      const label = offset === 0 ? 'Esta semana' : offset === 1 ? 'Semana pasada' : `Hace ${offset} semanas`;
      return { offset, label: `${label} · ${format.format(start)} – ${format.format(end)}`, shortLabel: label, range: `${format.format(start)} – ${format.format(end)}` };
    });
  }, [mexicoToday]);
  const dayLabel = useMemo(() => {
    if (selectedDay === mexicoToday) return 'Hoy';
    const yesterday = new Date(`${mexicoToday}T12:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    if (selectedDay === yesterday.toISOString().slice(0, 10)) return 'Ayer';
    return new Intl.DateTimeFormat('es-MX', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(`${selectedDay}T12:00:00Z`));
  }, [selectedDay, mexicoToday]);
  const activeOrders = useMemo(() => orders.filter(order => isActiveOrderStatus(order.status)), [orders]);
  const stalePendingOrders = useMemo(() => activeOrders.filter(order => order.status === 'PENDING' && kitchenClockNow - new Date(order.createdAt).getTime() > 180000), [activeOrders, kitchenClockNow]);
  const overdueKitchenOrders = useMemo(() => activeOrders.filter(order => {
    if (!['CONFIRMED', 'PREPARING'].includes(order.status)) return false;
    if (profile?.businessType && profile.businessType !== 'RESTAURANT') return !!order.estimatedDeliveryTime && new Date(order.estimatedDeliveryTime).getTime() <= kitchenClockNow;
    const remaining = getPreparationRemainingMs(order, kitchenClockNow);
    return typeof remaining === 'number' && remaining <= 0;
  }), [activeOrders, kitchenClockNow, profile, getPreparationRemainingMs]);
  const wasAutoPausedByInactivity = !isBusinessOpen && profile?.statusChangedBy === 'SYSTEM_ORDER_TIMEOUT_INACTIVITY';
  const columns = [
    { title: 'Por aceptar', dotClass: 'bg-amber-400', orders: activeOrders.filter(order => order.status === 'PENDING'), emptyText: 'Sin pedidos pendientes' },
    { title: 'En cocina', dotClass: 'bg-red-500', orders: activeOrders.filter(order => ['CONFIRMED', 'PREPARING'].includes(order.status)), emptyText: 'Sin pedidos en cocina', kitchenColumn: true },
    { title: 'Despacho', dotClass: 'bg-emerald-500', orders: activeOrders.filter(order => ['READY', 'PICKED_UP', 'IN_TRANSIT'].includes(order.status)), emptyText: 'Sin pedidos en despacho', isDispatch: true },
  ];
  return (
    <div className="wl-dashboard">
      <section className="wl-dash-hero" aria-labelledby="wl-dashboard-title">
        <div><p className="wl-dash-eyebrow">Estado del negocio</p><h2 id="wl-dashboard-title">{restaurantName}</h2><div className="wl-dash-status"><span className={`wl-dash-status-dot ${profile?.status === 'ACTIVE' && isBusinessOpen && isWithinHours && !isBusinessPaused ? 'is-open' : ''}`} />{operationalStatusLabel}{profile?.autoOpenEnabled && <span className="wl-dash-auto">· Apertura automática</span>}</div></div>
        {profile?.status === 'ACTIVE' && <div className="wl-dash-actions"><button type="button" onClick={async () => { const origin = getCustomerOrigin(); if (!origin) { onPushToast('error', 'No configurado', 'No hay una URL de tienda configurada.'); return; } try { await navigator.clipboard.writeText(`${origin}/restaurantes/${profile.id}`); setCopyCount(count => count + 1); } catch { setCopyCount(0); onPushToast('error', 'Error', 'No se pudo copiar el enlace.'); } }}>{copyCount ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />} <span aria-live="polite">{copyCount ? 'Copiado' : 'Copiar enlace'}</span></button><button type="button" onClick={onTogglePause} disabled={updatingOperationalStatus || !isBusinessOpen}>{isBusinessPaused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />} {isBusinessPaused ? 'Reanudar pedidos' : 'Pausar pedidos'}</button><button type="button" className="wl-dash-action-strong" onClick={onToggleOperational} disabled={updatingOperationalStatus}><Power aria-hidden="true" /> {isBusinessOpen ? 'Cerrar negocio' : 'Abrir negocio'}</button></div>}
      </section>
      {wasAutoPausedByInactivity && <div className="wl-dash-alert"><div><strong>El negocio se cerró por inactividad</strong><p>Un pedido no se respondió a tiempo. Cuando estés listo, vuelve a abrir tu negocio.</p></div><button type="button" disabled={updatingOperationalStatus} onClick={onToggleOperational}>Reabrir negocio</button></div>}
      {stalePendingOrders.length > 0 && <button type="button" className="wl-dash-alert wl-dash-alert-button" onClick={() => onSelectOrderForTicket(stalePendingOrders[0])}><span><strong>{stalePendingOrders.length === 1 ? '1 pedido lleva más de 3 min sin respuesta' : `${stalePendingOrders.length} pedidos llevan más de 3 min sin respuesta`}</strong><small>Selecciona para atenderlo</small></span><span aria-hidden="true">›</span></button>}
      {overdueKitchenOrders.length > 0 && <button type="button" className="wl-dash-alert wl-dash-alert-button" onClick={() => onSelectOrderForEtaExtension(overdueKitchenOrders[0])}><span><strong>{overdueKitchenOrders.length === 1 ? '1 pedido excedió su tiempo de preparación' : `${overdueKitchenOrders.length} pedidos excedieron su tiempo de preparación`}</strong><small>Selecciona para ajustar el tiempo</small></span><span aria-hidden="true">›</span></button>}
      <section className="wl-dash-panel wl-dash-today" aria-labelledby="wl-today-title">
        <div className="wl-dash-panel-heading">
          <div><p className="wl-dash-eyebrow">Resumen diario</p><h2 id="wl-today-title">Ventas del día</h2><p>Pedidos creados en la fecha elegida y completados · Ciudad de México.</p></div>
          <div className="wl-dash-date-controls"><label className="wl-dash-period"><CalendarDays aria-hidden="true" /> <span>{dayLabel}</span><input type="date" value={selectedDay} max={mexicoToday} aria-label="Fecha del resumen" onChange={event => setSelectedDate(event.target.value)} /></label>{selectedDay !== mexicoToday && <button type="button" onClick={() => setSelectedDate('')}>Ver hoy</button>}</div>
        </div>
        {todayError ? <div className="wl-dash-report-error" role="alert"><span>{todayError}</span><button type="button" onClick={retryToday}>Reintentar</button></div> : !today || todayLoading ? <p role="status" className="wl-dash-report-state">Cargando ventas del día…</p> : <><div className="wl-dash-today-grid"><article><span>Importe vendido</span><strong>{formatCurrency(today.sales.net)}</strong></article><article><span>Pedidos completados</span><strong>{today.sales.completedOrders}</strong></article><article><span>Ticket promedio</span><strong>{formatCurrency(today.sales.averageTicket)}</strong></article></div><p className="wl-dash-today-note">Total de pedidos completados; no descuenta costos ni representa ganancia.</p></>}
      </section>
        <section className="wl-dash-panel wl-dash-stats-panel" aria-busy={reportLoading} aria-label="Indicadores de la semana seleccionada"><p className="wl-dash-stats-label">Indicadores · {weekOptions.find(option => option.offset === weekOffset)?.label || "Semana seleccionada"}</p>{!report ? <p className="wl-dash-report-state">{reportError ? 'No se pudieron cargar los indicadores.' : 'Cargando indicadores…'}</p> : <div className="wl-dash-metrics"><article><PackageCheck aria-hidden="true" /><span>Pedidos completados</span><strong>{report.sales.completedOrders}</strong><small>Entregados o recogidos</small></article><article><ReceiptText aria-hidden="true" /><span>Ticket promedio</span><strong>{formatCurrency(report.sales.averageTicket)}</strong><small>Por pedido completado</small></article><article><Users aria-hidden="true" /><span>Compradores</span><strong>{report.customers.uniqueBuyers}</strong><small>Clientes con compras completadas</small></article><article><Clock3 aria-hidden="true" /><span>Inicio de preparación</span><strong>{report.operations.averagePreparationMinutes === null ? '—' : `${report.operations.averagePreparationMinutes} min`}</strong><small>Tiempo promedio desde el pedido</small></article></div>}</section>
      <section className="wl-dash-panel" aria-labelledby="wl-live-title"><div className="wl-dash-panel-heading"><div><p className="wl-dash-eyebrow">Operación en vivo</p><h2 id="wl-live-title">Pedidos en curso</h2><p>Consulta y atiende los pedidos de cada etapa.</p></div><span className="wl-dash-live">{activeOrders.length} {activeOrders.length === 1 ? 'pedido activo' : 'pedidos activos'}</span></div><div className="wl-dash-columns">{columns.map(column => <OrderColumn key={column.title} {...column} onSelectOrder={onSelectOrderForTicket} onSelectOrderChat={(order: any) => { onSetActiveTicketTab('chat'); onSelectOrderForTicket(order); }} onPrintTicket={onPrintTicket} isPrintingTicket={isPrintingTicket} unreadMessagesMap={unreadMessagesMap} formatCurrency={formatCurrency} formatDate={formatDate} profile={profile} getRestaurantCollectionAmount={getRestaurantCollectionAmount} kitchenClockNow={kitchenClockNow} onSelectOrderForEtaExtension={onSelectOrderForEtaExtension} getPreparationRemainingMs={getPreparationRemainingMs} isPreparationTimeUrgent={isPreparationTimeUrgent} />)}</div></section>
      <section className="wl-dash-results" aria-labelledby="business-report-title">
        <div className="wl-dash-panel wl-dash-sales"><div className="wl-dash-panel-heading"><div><p className="wl-dash-eyebrow">Resultados del negocio</p><h2 id="business-report-title">Resumen de ventas</h2><p>Pedidos creados en la semana y completados · Ciudad de México.</p></div><label className="wl-dash-period wl-dash-week-selector"><span className="sr-only">Seleccionar semana</span><select value={weekOffset} onChange={event => setWeekOffset(Number(event.target.value))}>{weekOptions.map(option => <option key={option.offset} value={option.offset}>{option.shortLabel}</option>)}</select><span className="wl-dash-week-range">{weekOptions.find(option => option.offset === weekOffset)?.range}</span></label></div>
          {reportError && <div role="alert" className="wl-dash-report-error"><span>{reportError}{report ? ' Se muestran los datos del periodo anterior.' : ''}</span><button type="button" onClick={retryReport}>Reintentar</button></div>}
          {report && <p role="status" className="wl-dash-updating">{reportLoading ? 'Actualizando resultados; se muestran los datos del periodo anterior…' : ''}</p>}
          {!report ? !reportError && <p role="status" className="wl-dash-report-state">Cargando resultados…</p> : <div className="wl-dash-sales-layout" aria-busy={reportLoading}><div className="wl-dash-sales-total"><span>Ventas completadas</span><strong>{formatCurrency(report.sales.net)}</strong><small>Importe total de pedidos completados; no es ganancia neta.</small></div><SalesTrend points={report.salesTrend} formatCurrency={formatCurrency} /></div>}
        </div>
      </section>
      {report && <div className="wl-dash-insight-panels"><section className="wl-dash-panel wl-dash-insight"><h2>Productos más vendidos</h2>{report.topProducts.length ? <ol>{report.topProducts.slice(0,3).map((product: any) => { const image = products.find((item: any) => item.id === product.productId)?.image; return <li key={product.productId}>{image ? <img src={image} alt="" loading="lazy" /> : <span className="wl-dash-product-placeholder" aria-hidden="true">◈</span>}<span>{product.name}</span><b>{product.units} uds.</b></li>; })}</ol> : <p>Aún no hay ventas completadas en este periodo.</p>}</section><section className="wl-dash-panel wl-dash-insight"><h2>Clientes y servicio</h2><dl><div><dt>Clientes nuevos</dt><dd>{report.customers.newBuyers}</dd></div><div><dt>Clientes recurrentes</dt><dd>{report.customers.repeatBuyers}</dd></div><div><dt>Tiempo hasta iniciar preparación</dt><dd>{report.operations.averagePreparationMinutes === null ? '—' : `${report.operations.averagePreparationMinutes} min`}</dd></div><div><dt>Tiempo de entrega</dt><dd>{report.operations.averageDeliveryMinutes === null ? '—' : `${report.operations.averageDeliveryMinutes} min`}</dd></div></dl></section></div>}
      {report?.promotions.length > 0 && <details className="wl-dash-panel wl-dash-promotions"><summary>Cupones utilizados</summary><ul>{report.promotions.map((promo: any) => <li key={promo.code}><span>{promo.code} · {promo.uses} usos</span><b>{formatCurrency(promo.discount)}</b></li>)}</ul></details>}
    </div>
  );
});

type SalesTrendPoint = { from: string; to: string; sales: number; completedOrders: number };
function SalesTrend({ points, formatCurrency }: { points?: SalesTrendPoint[]; formatCurrency: (amount: number) => string }) {
  const [selectedFrom, setSelectedFrom] = useState<string | null>(null);
  const detailId = useId();
  const plotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedFrom) return;
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && plotRef.current?.contains(target) && target.closest('.wl-dash-chart-point, .wl-dash-point-detail')) return;
      setSelectedFrom(null);
    };
    document.addEventListener('pointerdown', dismissOutside, true);
    return () => document.removeEventListener('pointerdown', dismissOutside, true);
  }, [selectedFrom]);
  if (!Array.isArray(points) || !points.length) return <p className="wl-dash-chart-empty">La evolución de ventas no está disponible.</p>;
  const max = Math.max(0, ...points.map(point => point.sales));
  const floor = 116, top = 18, left = 20, width = 380;
  const coordinates = points.map((point, index) => ({ ...point, x: left + (index / Math.max(1, points.length - 1)) * width, y: max > 0 ? floor - (point.sales / max) * (floor - top) : floor }));
  const selected = coordinates.find(point => point.from === selectedFrom);
  const line = coordinates.map(point => `${point.x},${point.y}`).join(' ');
  const area = `${left},${floor} ${line} ${left + width},${floor}`;
  const fullDate = (value: string) => new Date(value).toLocaleString('es-MX', { timeZone:'America/Mexico_City', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
  const weekday = (value: string, style: 'long' | 'short') => new Intl.DateTimeFormat('es-MX', { timeZone:'America/Mexico_City', weekday:style }).format(new Date(value));
  return <div className="wl-dash-chart">
    <div className="wl-dash-chart-top"><span>Ventas por día</span><span>{max > 0 ? `Máximo ${formatCurrency(max)}` : 'Sin ventas en el periodo'}</span></div>
    <div className="wl-dash-chart-plot">
      <div ref={plotRef} className="wl-dash-chart-interactive" onKeyDown={event => { if (event.key === 'Escape') setSelectedFrom(null); }}>
      <svg viewBox="0 0 420 132" role="img" aria-label="Evolución diaria de importes de pedidos completados">
        <defs><linearGradient id="wl-dashboard-sales-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f20d12" stopOpacity=".22" /><stop offset="100%" stopColor="#f20d12" stopOpacity="0" /></linearGradient></defs>
        {[18,51,83,116].map(y => <line key={y} x1={left} x2={left+width} y1={y} y2={y} className="wl-dash-chart-grid" />)}
        <polygon points={area} fill="url(#wl-dashboard-sales-gradient)" />
        <polyline points={line} fill="none" stroke="#e10b11" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {coordinates.map(point => <circle key={point.from} cx={point.x} cy={point.y} r="4" fill="#e10b11" stroke="var(--wl-admin-surface)" strokeWidth="2" />)}
      </svg>
      {coordinates.map(point => <button key={point.from} type="button" className="wl-dash-chart-point"
        style={{ left: `${point.x / 420 * 100}%`, top: `${point.y / 132 * 100}%` }}
        aria-label={`Ver ventas del ${weekday(point.from, 'long')}`}
        aria-pressed={selected?.from === point.from} aria-controls={detailId}
        onClick={() => setSelectedFrom(current => current === point.from ? null : point.from)} />)}
      <div id={detailId} aria-live="polite">
        {selected && <div className={`wl-dash-point-detail${selected.x > 210 ? ' is-left' : ''}`} style={{ left: `${selected.x / 420 * 100}%`, top: `${selected.y / 132 * 100}%` }}>
          <span>{new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(selected.from))}</span>
          <strong>{formatCurrency(selected.sales)}</strong>
          <span>{selected.completedOrders} {selected.completedOrders === 1 ? 'pedido completado' : 'pedidos completados'}</span>
        </div>}
      </div>
      </div>
      <div className="wl-dash-weekdays" aria-hidden="true">{coordinates.map(point => <span key={point.from} style={{ left: `${point.x / 420 * 100}%` }}><span className="wl-dash-weekday-full">{weekday(point.from, 'long')}</span><span className="wl-dash-weekday-short">{weekday(point.from, 'short').replace('.', '')}</span></span>)}</div>
    </div>
    <details className="wl-dash-chart-details"><summary>Ver datos de la gráfica</summary><div className="wl-dash-chart-table" role="table" aria-label="Ventas por intervalo">{points.map(point => <div key={point.from} role="row"><span role="cell">{fullDate(point.from)} – {fullDate(point.to)}</span><b role="cell">{formatCurrency(point.sales)} · {point.completedOrders} {point.completedOrders === 1 ? 'pedido' : 'pedidos'}</b></div>)}</div></details>
  </div>;
}

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
    <div className="wl-dashboard-column rounded-[20px] border border-black/5 bg-neutral-50/80 p-3">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${dotClass}`} />
          <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-600">{title}</h3>
        </div>
        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-bold text-sky-700">{orders.length}</span>
      </div>
      <div className="space-y-2">
        {orders.map((order: any) => (
          <div key={order.id} onClick={() => onSelectOrder(order)} role="button" tabIndex={0} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelectOrder(order); } }}
            className="wl-dashboard-order relative cursor-pointer rounded-xl border border-black/5 bg-white p-3 shadow-sm transition-all duration-200"
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
              <p className="text-xs font-bold text-neutral-900">{formatCurrency(getRestaurantCollectionAmount(order, profile))}</p>
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
