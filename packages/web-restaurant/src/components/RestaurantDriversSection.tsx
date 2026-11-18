'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bike, Check, LoaderCircle, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { getRequestErrorMessage, requestJson } from '@sadel/shared';

type DriverItem = {
  id: string;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  availability: 'AVAILABLE' | 'BUSY' | 'OFFLINE';
  totalDeliveries: number;
  deliveryCompensation: number;
  createdAt: string;
  user: { id: string; name: string; lastName?: string | null; phone: string; email?: string | null; profilePhoto?: string | null };
  balance: { pending: number; pendingDeliveries: number; paid: number; payouts: number };
};

type Props = {
  apiBase: string;
  token: string;
  onDriversChange?: (drivers: DriverItem[]) => void;
};

export function RestaurantDriversSection({ apiBase, token, onDriversChange }: Props) {
  const [drivers, setDrivers] = useState<DriverItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newDriver, setNewDriver] = useState({ name: '', lastName: '', phone: '', email: '' });
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [busyDriver, setBusyDriver] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [selectedDriver, setSelectedDriver] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [activity, setActivity] = useState<{ counts: Array<{ driverId: string; count: number }>; orders: Array<{ id: string; orderReference: string; dailyCounter: number | null; deliveredAt: string }>; hasMore: boolean } | null>(null);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState('');
  const [activityAttempt, setActivityAttempt] = useState(0);

  const loadDrivers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await requestJson<{ success: true; data: DriverItem[] }>({
        apiBase,
        path: '/restaurant-panel/repartidores',
        token,
        fallbackMessage: 'No se pudieron cargar los repartidores.',
      });
      setDrivers(result.data);
      onDriversChange?.(result.data);
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'No se pudieron cargar los repartidores.'));
    } finally {
      setLoading(false);
    }
  }, [apiBase, token, onDriversChange]);

  useEffect(() => { void loadDrivers(); }, [loadDrivers]);

  useEffect(() => {
    let active = true;
    setActivityLoading(true); setActivityError('');
    const params = new URLSearchParams({ days: String(days), page: String(page) });
    if (selectedDriver) params.set('driverId', selectedDriver);
    void requestJson<{ data: NonNullable<typeof activity> }>({ apiBase, token, path: `/restaurant-panel/repartidores/actividad?${params}`, fallbackMessage: 'No se pudo cargar la actividad.' })
      .then(result => { if (active) setActivity(result.data); })
      .catch(reason => { if (active) { setActivity(null); setActivityError(getRequestErrorMessage(reason, 'No se pudo cargar la actividad.')); } })
      .finally(() => { if (active) setActivityLoading(false); });
    return () => { active = false; };
  }, [apiBase, token, days, selectedDriver, page, activityAttempt]);

  async function createDriver(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result = await requestJson<{ success: true; data: { driver: DriverItem; temporaryPassword: string } }>({
        apiBase,
        path: '/restaurant-panel/repartidores',
        token,
        options: { method: 'POST', body: JSON.stringify(newDriver) },
        fallbackMessage: 'No se pudo crear la cuenta del repartidor.',
      });
      setTemporaryPassword(result.data.temporaryPassword);
      setNotice(`Cuenta creada para ${result.data.driver.user.name}. Comparte la contraseña temporal de forma segura; no volverá a mostrarse.`);
      setNewDriver({ name: '', lastName: '', phone: '', email: '' });
      setShowCreate(false);
      await loadDrivers();
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'No se pudo crear la cuenta.'));
    } finally {
      setSaving(false);
    }
  }

  async function updateDriver(driver: DriverItem, values: { status?: 'ACTIVE' | 'INACTIVE'; deliveryCompensation?: number }) {
    setBusyDriver(driver.id);
    setError('');
    setNotice('');
    try {
      await requestJson({
        apiBase,
        path: `/restaurant-panel/repartidores/${encodeURIComponent(driver.id)}`,
        token,
        options: { method: 'PATCH', body: JSON.stringify(values) },
        fallbackMessage: 'No se pudo actualizar al repartidor.',
      });
      await loadDrivers();
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'No se pudo actualizar al repartidor.'));
    } finally {
      setBusyDriver(null);
    }
  }

  return (
    <section className="mx-auto max-w-6xl space-y-6 px-1 pb-12" aria-labelledby="own-drivers-title">
      <header className="rounded-[30px] border border-[#eadfd3] bg-white p-6 shadow-[0_16px_48px_rgba(55,35,18,.06)] sm:p-8">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.22em] text-[#bb0a0e]">WingsLab · Operación propia</p>
            <h1 id="own-drivers-title" className="mt-2 text-3xl font-black tracking-tight text-[#191614] sm:text-4xl">Repartidores</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#70675f]">Administra tu equipo y consulta las entregas realizadas por cada repartidor.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => { void loadDrivers(); setActivityAttempt(value => value + 1); }} disabled={loading} className="inline-flex h-11 items-center gap-2 rounded-full border border-[#e8ddd2] bg-white px-4 text-sm font-bold text-[#51473f] hover:bg-[#faf7f2] disabled:opacity-50"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Actualizar</button>
            <button type="button" onClick={() => { setShowCreate(value => !value); setTemporaryPassword(''); setNotice(''); }} className="inline-flex h-11 items-center gap-2 rounded-full bg-[#bb0a0e] px-5 text-sm font-bold text-white shadow-sm hover:bg-[#94070b]"><Plus size={17} /> Nuevo repartidor</button>
          </div>
        </div>
      </header>

      {error ? <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">{error}</div> : null}
      {notice ? <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900">{notice}</div> : null}

      {temporaryPassword ? (
        <div className="rounded-3xl border border-amber-200 bg-[#fff8e9] p-5 shadow-sm">
          <div className="flex items-start gap-3"><ShieldCheck className="mt-1 shrink-0 text-amber-700" size={22} /><div className="min-w-0 flex-1"><p className="font-bold text-[#382a16]">Contraseña temporal · mostrar una sola vez</p><p className="mt-1 text-sm text-[#75634a]">El repartidor tendrá que crear una contraseña personal al iniciar sesión.</p><div className="mt-3 flex flex-wrap items-center gap-2"><code className="select-all rounded-xl border border-amber-200 bg-white px-4 py-3 font-mono text-base font-bold tracking-wide text-[#241b11]">{temporaryPassword}</code><button type="button" onClick={() => void navigator.clipboard?.writeText(temporaryPassword)} className="rounded-xl bg-[#392c1d] px-4 py-3 text-sm font-bold text-white">Copiar</button></div></div></div>
        </div>
      ) : null}

      {showCreate ? (
        <form onSubmit={createDriver} className="rounded-[28px] border border-[#eadfd3] bg-white p-5 shadow-sm sm:p-7">
          <div className="mb-5 flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#fff0ef] text-[#bb0a0e]"><Bike size={21} /></span><div><h2 className="text-xl font-bold text-[#191614]">Dar de alta a tu equipo</h2><p className="text-sm text-[#70675f]">La cuenta queda vinculada únicamente a WingsLab.</p></div></div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {([
              ['name', 'Nombre', 'María'], ['lastName', 'Apellidos', 'García López'], ['phone', 'Teléfono móvil', '5512345678'], ['email', 'Correo electrónico', 'repartidor@correo.mx'],
            ] as const).map(([key, label, placeholder]) => (
              <label key={key} className="grid gap-1.5 text-sm font-semibold text-[#51473f]">{label}<input required={key !== 'lastName'} type={key === 'email' ? 'email' : 'text'} inputMode={key === 'phone' ? 'tel' : undefined} value={newDriver[key]} onChange={event => setNewDriver(current => ({ ...current, [key]: event.target.value }))} placeholder={placeholder} className="h-12 rounded-2xl border border-[#e8ddd2] bg-[#fffefd] px-4 text-[15px] text-[#191614] outline-none transition focus:border-[#bb0a0e] focus:ring-4 focus:ring-[#bb0a0e]/10" /></label>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => setShowCreate(false)} className="rounded-full border border-[#e8ddd2] px-5 py-3 text-sm font-bold text-[#51473f]">Cancelar</button><button type="submit" disabled={saving} className="inline-flex min-w-44 items-center justify-center gap-2 rounded-full bg-[#bb0a0e] px-5 py-3 text-sm font-bold text-white disabled:opacity-60">{saving ? <LoaderCircle className="animate-spin" size={17} /> : <Check size={17} />} Crear cuenta</button></div>
        </form>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold text-[#191614]">Tu equipo</h2><p className="text-sm text-[#70675f]">Consulta las entregas completadas en el periodo seleccionado.</p></div><label className="flex items-center gap-2 text-sm font-bold text-[#51473f]">Periodo <select value={days} onChange={event => { setDays(Number(event.target.value)); setPage(1); }} className="h-11 rounded-xl border border-[#e8ddd2] bg-white px-3"><option value={1}>Últimas 24 horas</option><option value={7}>Últimos 7 días</option><option value={30}>Últimos 30 días</option><option value={90}>Últimos 90 días</option></select></label></div>
      {activityError && <div role="alert" className="rounded-2xl bg-red-50 p-4 text-sm text-red-800">{activityError} <button type="button" className="font-bold underline" onClick={() => setActivityAttempt(value => value + 1)}>Reintentar</button></div>}
      {loading && drivers.length === 0 ? <div className="rounded-3xl border border-[#eadfd3] bg-white p-10 text-center text-sm text-[#70675f]"><LoaderCircle className="mx-auto mb-3 animate-spin text-[#bb0a0e]" />Cargando equipo…</div> : drivers.length === 0 ? (
        <div className="rounded-[28px] border border-dashed border-[#ddcfc0] bg-white/70 px-6 py-12 text-center"><Bike className="mx-auto text-[#bb0a0e]" size={32} /><h2 className="mt-3 text-lg font-bold text-[#191614]">Todavía no hay repartidores</h2><p className="mt-1 text-sm text-[#70675f]">Agrega a tu primer integrante para asignar pedidos listos.</p></div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {drivers.map(driver => {
            const active = driver.status === 'ACTIVE';
            const busy = busyDriver === driver.id;
            const count = activity?.counts.find(item => item.driverId === driver.id)?.count ?? 0;
            return (
              <article key={driver.id} className="rounded-[28px] border border-[#eadfd3] bg-white p-5 shadow-[0_12px_35px_rgba(55,35,18,.05)] sm:p-6">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3"><span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-[#fff0ef] text-[#bb0a0e]">{driver.user.profilePhoto ? <img src={driver.user.profilePhoto} alt="" className="h-full w-full object-cover" /> : <Bike size={22} />}</span><div className="min-w-0"><h2 className="truncate font-bold text-[#191614]">{driver.user.name} {driver.user.lastName || ''}</h2><p className="mt-0.5 text-sm text-[#70675f]">{driver.user.phone}</p></div></div>
                  <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${active ? 'bg-emerald-50 text-emerald-800' : 'bg-neutral-100 text-neutral-600'}`}>{active ? driver.availability === 'OFFLINE' ? 'Desconectado' : driver.availability === 'BUSY' ? 'En entrega' : 'Disponible' : 'Inactivo'}</span>
                </div>
                <div className="mt-5 rounded-2xl bg-[#faf7f2] p-4"><p className="text-xs font-semibold text-[#70675f]">Entregas completadas en el periodo</p><p className="mt-1 text-2xl font-black text-[#191614]">{activityLoading ? '…' : activityError ? '—' : count}</p><p className="mt-1 text-xs text-[#70675f]">{driver.totalDeliveries} en total</p></div>
                <div className="mt-4 flex flex-wrap gap-2 border-t border-[#f0e9e2] pt-4"><button type="button" onClick={() => { setPage(1); setSelectedDriver(selectedDriver === driver.id ? null : driver.id); }} aria-expanded={selectedDriver === driver.id} className="h-10 rounded-xl bg-[#191614] px-4 text-xs font-bold text-white">{selectedDriver === driver.id ? 'Cerrar detalle' : 'Ver detalle y entregas'}</button><button type="button" disabled={busy || (active && driver.availability !== 'OFFLINE')} onClick={() => void updateDriver(driver, { status: active ? 'INACTIVE' : 'ACTIVE' })} className="h-10 rounded-xl border border-[#e8ddd2] px-4 text-xs font-bold text-[#51473f] disabled:opacity-40">{active ? 'Desactivar' : 'Reactivar'}</button></div>
                {selectedDriver === driver.id && <div className="mt-4 border-t border-[#f0e9e2] pt-4"><h3 className="font-bold text-[#191614]">Información y entregas</h3><p className="mt-2 text-sm text-[#70675f]">Teléfono: {driver.user.phone}</p><p className="mt-1 text-sm text-[#70675f]">Correo: {driver.user.email || 'No disponible'}</p><p className="mt-1 text-sm text-[#70675f]">En el equipo desde: {new Date(driver.createdAt).toLocaleDateString('es-MX')}</p><h4 className="mt-4 text-sm font-bold text-[#191614]">Entregas del periodo</h4>{activityLoading ? <p className="mt-2 text-sm text-[#70675f]" role="status">Cargando entregas…</p> : activityError ? null : !activity?.orders.length ? <p className="mt-2 text-sm text-[#70675f]">No hay entregas completadas en este periodo.</p> : <ul className="mt-2 divide-y divide-[#f0e9e2]">{activity.orders.map(order => <li key={order.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm"><span className="font-semibold">Pedido {order.dailyCounter ? `#${String(order.dailyCounter).padStart(2, '0')}` : order.orderReference}</span><span className="text-[#70675f]">{new Date(order.deliveredAt).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}</span></li>)}</ul>}<div className="mt-3 flex gap-2"><button type="button" disabled={page === 1 || activityLoading} onClick={() => setPage(value => value - 1)} className="rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-40">Anterior</button><span className="py-2 text-xs text-[#70675f]">Página {page}</span><button type="button" disabled={!activity?.hasMore || activityLoading} onClick={() => setPage(value => value + 1)} className="rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-40">Siguiente</button></div></div>}
                {busy ? <p className="mt-3 flex items-center gap-2 text-xs text-[#70675f]"><LoaderCircle size={14} className="animate-spin" />Guardando cambios…</p> : null}
              </article>
            );
          })}
        </div>
      )}


    </section>
  );
}
