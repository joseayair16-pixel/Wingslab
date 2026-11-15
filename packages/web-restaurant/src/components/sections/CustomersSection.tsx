'use client';

import { useCallback, useEffect, useState } from 'react';
import { Award, Search, Users } from 'lucide-react';

type RecentOrder = { id: string; totalAmount: number; status: string; createdAt: string };
type Customer = {
  id: string; name: string; joinedAt: string; orderCount: number; lifetimeValue: number;
  firstOrderAt: string | null; lastOrderAt: string | null; customerType: string; recentOrders: RecentOrder[];
};
const orderStatusLabels: Record<string, string> = {
  PENDING: 'Pendiente', CONFIRMED: 'Aceptado', PREPARING: 'En preparación', READY: 'Listo',
  PICKED_UP: 'Recogido', IN_TRANSIT: 'En reparto', DELIVERED: 'Entregado', COMPLETED: 'Completado',
  CANCELLED: 'Cancelado', REJECTED: 'Rechazado',
};

export function CustomersSection({ apiBase, token }: { apiBase: string; token: string }) {
  const [rows, setRows] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [config, setConfig] = useState({ enabled: false, pointsPer100: 1, rewardPoints: 100, rewardAmount: 10 });
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const request = useCallback(async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(apiBase + path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = await response.json();
    if (!response.ok) throw Error(json.error?.message || 'No se pudieron cargar los clientes.');
    return json;
  }, [apiBase, token]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const query = new URLSearchParams({ limit: '100' });
    if (search.trim()) query.set('search', search.trim());
    void request(`/restaurant-panel/clientes?${query.toString()}`)
      .then(result => { if (active) setRows(result.data); })
      .catch(reason => { if (active) setError(reason.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [request, search]);

  useEffect(() => {
    let active = true;
    void request('/restaurant-panel/lealtad')
      .then(result => { if (active) setConfig(result.data); })
      .catch(reason => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [request]);

  const save = async () => {
    try {
      const result = await request('/restaurant-panel/lealtad', 'PUT', config);
      setConfig(result.data); setSaved(true); window.setTimeout(() => setSaved(false), 2500);
    } catch (reason: any) { setError(reason.message); }
  };

  return <section className="space-y-5">
    <div className="rounded-3xl bg-gradient-to-r from-violet-50 to-fuchsia-50 p-6">
      <p className="text-xs font-bold uppercase tracking-widest text-violet-700">Relación con clientes</p>
      <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold"><Users className="h-6 w-6" />Clientes WingsLab</h1>
      <p className="mt-2 text-sm text-neutral-600">Solo clientes con compras de WingsLab. Sin contraseñas, teléfonos ni identificadores de dispositivos.</p>
    </div>
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-2xl border bg-white p-4"><p className="text-xs text-neutral-500">Clientes mostrados (máx. 100)</p><b className="text-2xl">{rows.length}</b></div>
      <div className="rounded-2xl border bg-white p-4"><p className="text-xs text-neutral-500">Recurrentes mostrados</p><b className="text-2xl">{rows.filter(c => c.customerType === 'RECURRENT').length}</b></div>
      <div className="rounded-2xl border bg-white p-4"><p className="text-xs text-neutral-500">Primera compra mostrada</p><b className="text-2xl">{rows.filter(c => c.customerType === 'NEW').length}</b></div>
    </div>
    <div className="rounded-2xl border bg-white p-5">
      <div className="flex items-center gap-2"><Award className="h-5 w-5 text-violet-600" /><h2 className="text-lg font-bold">Reglas de puntos</h2></div>
      <p className="mt-1 text-sm text-neutral-600">La acumulación se calcula con pedidos entregados/recogidos. El canje permanece deshabilitado hasta contar con un ledger transaccional de recompensas desplegado.</p>
      <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={config.enabled} onChange={e => setConfig({ ...config, enabled: e.target.checked })} />Activar acumulación de puntos</label>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="text-sm">Puntos por cada $100<input type="number" min="0.1" max="100" step="0.1" value={config.pointsPer100} onChange={e => setConfig({ ...config, pointsPer100: Number(e.target.value) })} className="mt-1 block w-full rounded-lg border p-2" /></label>
        <label className="text-sm">Puntos por recompensa<input type="number" min="1" value={config.rewardPoints} onChange={e => setConfig({ ...config, rewardPoints: Number(e.target.value) })} className="mt-1 block w-full rounded-lg border p-2" /></label>
        <label className="text-sm">Valor promocional ($)<input type="number" min="1" value={config.rewardAmount} onChange={e => setConfig({ ...config, rewardAmount: Number(e.target.value) })} className="mt-1 block w-full rounded-lg border p-2" /></label>
      </div>
      <button onClick={() => void save()} className="mt-4 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white">Guardar reglas</button>
      {saved && <span role="status" className="ml-3 text-sm text-emerald-700">Guardado</span>}
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
    <div className="rounded-2xl border bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Directorio e historial reciente</h2>
        <label className="flex items-center gap-2 rounded-lg border px-3"><Search className="h-4 w-4 text-neutral-400" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nombre" className="py-2 text-sm outline-none" /></label>
      </div>
      {loading ? <p className="mt-4 text-sm">Cargando…</p> : rows.length === 0 ? <p className="mt-4 text-sm text-neutral-500">No hay clientes en este filtro.</p> :
        <div className="mt-4 divide-y">{rows.map(customer => <div key={customer.id} className="py-3">
          <div className="grid gap-1 sm:grid-cols-[1fr_auto_auto] sm:items-center">
            <div><p className="font-semibold">{customer.name || 'Cliente WingsLab'}</p><p className="text-xs text-neutral-500">{customer.customerType === 'RECURRENT' ? 'Cliente recurrente' : 'Primera compra'} · Último pedido {customer.lastOrderAt ? new Date(customer.lastOrderAt).toLocaleDateString() : '—'}</p></div>
            <span className="text-sm">{customer.orderCount} pedidos</span><b className="text-sm">${customer.lifetimeValue.toFixed(2)}</b>
          </div>
          <details className="mt-2 text-xs text-neutral-600"><summary className="cursor-pointer font-semibold">Ver hasta 5 pedidos recientes</summary>
            <div className="mt-2 space-y-1 pl-3">{customer.recentOrders.map(order => <p key={order.id} className="flex flex-wrap justify-between gap-2"><span>{new Date(order.createdAt).toLocaleString()} · {orderStatusLabels[order.status] || order.status}</span><b>${order.totalAmount.toFixed(2)}</b></p>)}</div>
          </details>
        </div>)}</div>}
    </div>
  </section>;
}
