'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, CircleAlert, Search, ShieldBan, ShoppingBag, Users, X } from 'lucide-react';
import { getRequestErrorMessage, requestJson } from '@sadel/shared';

type Customer = { id: string; user: { name: string; lastName: string | null; email: string; phone: string; status: 'ACTIVE' | 'SUSPENDED' | 'INACTIVE'; createdAt: string }; orderCount: number; totalSpent: number; lastOrderAt: string | null };
type CustomerPage = { items: Customer[]; page: number; total: number; totalPages: number };
type OrderPage = { items: { id: string; orderReference: string; dailyCounter: number | null; status: string; totalAmount: number; createdAt: string }[]; page: number; total: number; totalPages: number };
const statusLabels: Record<string, string> = { PENDING: 'Pendiente', CONFIRMED: 'Aceptado', PREPARING: 'En preparación', READY: 'Listo', PICKED_UP: 'Recogido', IN_TRANSIT: 'En reparto', DELIVERED: 'Entregado', COMPLETED: 'Completado', CANCELLED: 'Cancelado', REJECTED: 'Rechazado' };
const accountLabels: Record<string, string> = { ACTIVE: 'Activa', SUSPENDED: 'Suspendida', INACTIVE: 'Inactiva' };
const money = (value: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(value);
const date = (value: string) => new Date(value).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
const name = (customer: Customer) => [customer.user.name, customer.user.lastName].filter(Boolean).join(' ') || 'Cliente';

export function CustomersSection({ apiBase, token }: { apiBase: string; token: string }) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CustomerPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [orderPage, setOrderPage] = useState(1);
  const [orders, setOrders] = useState<OrderPage | null>(null);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState('');
  const [ordersVersion, setOrdersVersion] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const returnFocus = useRef<HTMLElement | null>(null);
  const detailRef = useRef<HTMLElement | null>(null);
  const call = useCallback(<T,>(path: string, options?: RequestInit) => requestJson<{ data: T }>({ apiBase, token, path, options, retry: { attempts: 0 }, fallbackMessage: 'No se pudo completar la solicitud.' }), [apiBase, token]);

  useEffect(() => { const timer = window.setTimeout(() => { setDebouncedSearch(search.trim()); setPage(1); }, 350); return () => window.clearTimeout(timer); }, [search]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    const query = new URLSearchParams({ search: debouncedSearch, status, page: String(page), limit: '20' });
    void call<CustomerPage>(`/restaurant-panel/directorio-clientes?${query}`).then(result => {
      if (!active) return;
      if (page > result.data.totalPages) { setPage(result.data.totalPages); return; }
      setData(result.data);
    }).catch(reason => { if (active) { setData(null); setError(getRequestErrorMessage(reason, 'No se pudo cargar el directorio.')); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [call, debouncedSearch, status, page, version]);
  useEffect(() => {
    if (!selected) return;
    let active = true; setOrders(null); setOrdersLoading(true); setOrdersError('');
    void call<OrderPage>(`/restaurant-panel/directorio-clientes/${encodeURIComponent(selected.id)}/pedidos?page=${orderPage}`).then(result => { if (active) setOrders(result.data); }).catch(reason => { if (active) setOrdersError(getRequestErrorMessage(reason, 'No se pudieron cargar los pedidos.')); }).finally(() => { if (active) setOrdersLoading(false); });
    return () => { active = false; };
  }, [call, selected?.id, orderPage, ordersVersion]);
  useEffect(() => {
    if (!selected) return;
    detailRef.current?.querySelector<HTMLButtonElement>('[aria-label="Cerrar detalle"]')?.focus();
    return () => { returnFocus.current?.focus(); };
  }, [selected?.id]);
  const open = (customer: Customer) => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setSelected(customer); setOrderPage(1); setConfirming(false); setReason(''); setActionError(''); };
  const close = () => { if (!saving) { setSelected(null); setConfirming(false); } };
  const suspend = async () => {
    if (!selected || reason.trim().length < 5 || saving) return;
    setSaving(true); setActionError('');
    try {
      await call(`/restaurant-panel/directorio-clientes/${encodeURIComponent(selected.id)}/suspender`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) });
      setSelected(current => current ? { ...current, user: { ...current.user, status: 'SUSPENDED' } } : null);
      setConfirming(false); setReason(''); setNotice('Cuenta suspendida. Los pedidos existentes no fueron cancelados.'); setVersion(value => value + 1);
    } catch (reason) { setActionError(`${getRequestErrorMessage(reason, 'No se pudo confirmar la suspensión.')} Cierra el detalle y consulta de nuevo antes de intentarlo.`); setVersion(value => value + 1); }
    finally { setSaving(false); }
  };
  const reactivate = async () => {
    if (!selected || saving || actionError || !window.confirm(`¿Reactivar la cuenta de ${name(selected)}? Solo se permite si la suspensión provino del restaurante y no existe un bloqueo por deuda.`)) return;
    setSaving(true); setActionError('');
    try {
      await call(`/restaurant-panel/directorio-clientes/${encodeURIComponent(selected.id)}/reactivar`, { method: 'POST', body: '{}' });
      setSelected(current => current ? { ...current, user: { ...current.user, status: 'ACTIVE' } } : null);
      setNotice('Cuenta reactivada.'); setVersion(value => value + 1);
    } catch (reason) { setActionError(`${getRequestErrorMessage(reason, 'No se pudo confirmar la reactivación.')} Cierra el detalle y consulta de nuevo antes de intentarlo.`); setVersion(value => value + 1); }
    finally { setSaving(false); }
  };

  return <section className="wl-campaigns wl-customers" aria-labelledby="customers-title">
    <header className="wl-campaign-header"><span className="wl-campaign-header-icon"><Users aria-hidden="true" /></span><div><p className="wl-campaign-eyebrow">Comunidad WingsLab</p><h1 id="customers-title">Clientes</h1><p>Consulta las cuentas registradas y el historial de pedidos de tu negocio.</p></div></header>
    {notice && <div role="status" className="wl-campaign-feedback">{notice}<button type="button" onClick={() => setNotice('')} aria-label="Cerrar aviso"><X size={16} /></button></div>}
    <div className="wl-campaign-card wl-customers-directory"><div className="wl-customers-heading"><div><h2>Directorio de clientes</h2><p>Incluye cuentas registradas, incluso si todavía no han comprado.</p></div><span className="wl-menu-count">{loading || !data ? 'Consultando…' : `${data.total} ${data.total === 1 ? 'cuenta' : 'cuentas'}`}</span></div>
      <div className="wl-customers-filters"><label className="wl-customers-search"><Search aria-hidden="true" /><span className="sr-only">Buscar clientes</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por nombre, correo o teléfono" /></label><label className="wl-customers-status"><span>Estado</span><select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="all">Todas las cuentas</option><option value="ACTIVE">Activas</option><option value="SUSPENDED">Suspendidas</option><option value="INACTIVE">Inactivas</option></select></label></div>
      {loading ? <p className="wl-campaign-empty" role="status">Cargando clientes…</p> : error ? <div className="wl-campaign-empty" role="alert">{error}<button type="button" className="wl-menu-action" onClick={() => setVersion(value => value + 1)}>Reintentar</button></div> : !data?.items.length ? <div className="wl-campaign-empty"><Users aria-hidden="true"/><strong>No encontramos clientes</strong><span>Prueba otra búsqueda o cambia el filtro de estado.</span></div> : <><div className="wl-customers-table"><div className="wl-customers-table-head"><span>Cliente</span><span>Estado</span><span>Compras completadas</span><span>Última compra</span><span></span></div>{data.items.map(customer => <article key={customer.id} className="wl-customers-row"><div className="wl-customers-person"><span className="wl-customers-avatar">{name(customer).slice(0, 1).toLocaleUpperCase('es')}</span><div><h3>{name(customer)}</h3><p>{customer.user.email}</p></div></div><span className={`wl-customers-badge is-${customer.user.status.toLowerCase()}`}>{accountLabels[customer.user.status]}</span><div className="wl-customers-purchases"><span className="wl-customers-mobile-label">Compras completadas</span><strong>{customer.orderCount} {customer.orderCount === 1 ? 'compra' : 'compras'}</strong><small>{money(customer.totalSpent)} acumulados</small></div><span className="wl-customers-date"><span className="wl-customers-mobile-label">Última compra</span><strong>{customer.lastOrderAt ? date(customer.lastOrderAt) : 'Sin compras'}</strong></span><button type="button" className="wl-menu-action" onClick={() => open(customer)}>Ver detalle</button></article>)}</div><div className="wl-customers-pagination"><span>Mostrando {(data.page - 1) * 20 + 1}–{(data.page - 1) * 20 + data.items.length} de {data.total}</span><div><button type="button" className="wl-menu-action" disabled={page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft aria-hidden="true"/>Anterior</button><span>Página {data.page} de {data.totalPages}</span><button type="button" className="wl-menu-action" disabled={page >= data.totalPages} onClick={() => setPage(value => value + 1)}>Siguiente<ChevronRight aria-hidden="true"/></button></div></div></>}
      <p className="wl-customers-footnote">Compras y acumulado consideran únicamente pedidos completados de WingsLab. Última compra según fecha de creación del pedido.</p>
    </div>
    {selected && <div className="wl-customers-overlay" onClick={event => { if (event.target === event.currentTarget) close(); }}><section ref={detailRef} className="wl-customers-detail" role="dialog" aria-modal="true" aria-labelledby="customer-detail-title" onKeyDown={event => { if (event.key === 'Escape') close(); if (event.key === 'Tab') { const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]')); if (!focusable.length) { event.preventDefault(); return; } const first = focusable[0], last = focusable[focusable.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } } }}><div className="wl-customers-detail-header"><div className="wl-customers-person"><span className="wl-customers-avatar">{name(selected).slice(0, 1).toLocaleUpperCase('es')}</span><div><p className="wl-campaign-eyebrow">Perfil de cliente</p><h2 id="customer-detail-title">{name(selected)}</h2></div></div><button type="button" className="wl-menu-action" onClick={close} disabled={saving} aria-label="Cerrar detalle"><X size={18}/></button></div><div className="wl-customers-detail-body"><div className="wl-customers-info"><div><span>Estado de la cuenta</span><strong>{accountLabels[selected.user.status]}</strong></div><div><span>Registrado</span><strong>{date(selected.user.createdAt)}</strong></div><div><span>Correo</span><strong>{selected.user.email || 'No disponible'}</strong></div><div><span>Teléfono</span><strong>{selected.user.phone || 'No disponible'}</strong></div><div><span>Compras completadas</span><strong>{selected.orderCount}</strong></div><div><span>Importe acumulado</span><strong>{money(selected.totalSpent)}</strong></div></div><div className="wl-customers-orders-title"><ShoppingBag aria-hidden="true"/><div><h3>Historial de pedidos</h3><p>Todos los estados · solo pedidos de WingsLab</p></div></div>{ordersLoading ? <p role="status" className="wl-customers-message">Cargando pedidos…</p> : ordersError ? <p role="alert" className="wl-customers-message">{ordersError} <button type="button" className="underline" onClick={() => setOrdersVersion(value => value + 1)}>Reintentar</button></p> : !orders?.items.length ? <p className="wl-customers-message">Este cliente todavía no tiene pedidos.</p> : <><div className="wl-customers-orders">{orders.items.map(order => <div key={order.id}><div><strong>Pedido {order.dailyCounter ? `#${String(order.dailyCounter).padStart(2, '0')}` : order.orderReference}</strong><small>{date(order.createdAt)} · {statusLabels[order.status] || order.status}</small></div><b>{money(order.totalAmount)}</b></div>)}</div><div className="wl-customers-pagination"><span>{orders.total} pedidos</span><div><button type="button" className="wl-menu-action" disabled={orderPage <= 1} onClick={() => setOrderPage(value => value - 1)}>Anterior</button><span>{orders.page} / {orders.totalPages}</span><button type="button" className="wl-menu-action" disabled={orderPage >= orders.totalPages} onClick={() => setOrderPage(value => value + 1)}>Siguiente</button></div></div></>}
      {selected.user.status === 'ACTIVE' && <div className="wl-customers-suspend"><h3>Administrar cuenta</h3><p>Suspender impide crear nuevos pedidos. No cancela pedidos existentes ni elimina información.</p>{!confirming ? <button type="button" className="wl-menu-action is-danger" disabled={!!actionError} onClick={() => { setConfirming(true); setActionError(''); }}><ShieldBan aria-hidden="true"/>Suspender cuenta</button> : <div className="wl-customers-confirm"><p><CircleAlert aria-hidden="true"/> Confirma la suspensión de {name(selected)}. El motivo quedará registrado para auditoría.</p><label>Motivo de la suspensión<textarea maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder="Explica el motivo (mínimo 5 caracteres)" /></label><div><button type="button" className="wl-menu-action" disabled={saving} onClick={() => setConfirming(false)}>Cancelar</button><button type="button" className="wl-campaign-button is-primary" disabled={saving || !!actionError || reason.trim().length < 5} onClick={() => void suspend()}>{saving ? 'Guardando…' : 'Confirmar suspensión'}</button></div></div>}{actionError && <p role="alert" className="wl-customers-action-error">{actionError}</p>}</div>}
      {selected.user.status === 'SUSPENDED' && <div className="wl-customers-suspend"><h3>Administrar cuenta</h3><p>Solo se puede reactivar una suspensión realizada desde este panel si la cuenta no ha cambiado y no tiene bloqueo por deuda. Las demás requieren revisión.</p><button type="button" className="wl-menu-action" disabled={saving || !!actionError} onClick={() => void reactivate()}>{saving ? 'Guardando…' : 'Reactivar cuenta'}</button>{actionError && <p role="alert" className="wl-customers-action-error">{actionError}</p>}</div>}
      </div></section></div>}
  </section>;
}
