'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { io } from 'socket.io-client';
import { getWingslabApiUrl, getWingslabSocketUrl, getOrderStatusLabel, readStoredSession, persistStoredSession, requestJson, clearStoredSession, type AuthUser } from '@sadel/shared';
import { AuthModal } from '../../components/AuthModal';
import { OrdersView } from '../../views/OrdersView';
import { WingsLabLogo } from '../../components/WingsLabLogo';

const storageKey = 'sadel.customer';
const money = (amount: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(amount);
export default function CustomerAccount() {
  const [token, setToken] = useState('');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [orders, setOrders] = useState<any[]>([]);
  const [addresses, setAddresses] = useState<any[]>([]);
  const [loyalty, setLoyalty] = useState<any>(null);
  const [marketingConsent, setMarketingConsent] = useState<{ enabled: boolean; grantedAt: string | null; revokedAt: string | null } | null>(null);
  const [consentSaving, setConsentSaving] = useState(false);
  const [consentError, setConsentError] = useState('');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState<any>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const apiBase = getWingslabApiUrl();
  useEffect(() => {
    const saved = readStoredSession(storageKey);
    if (saved?.token) { setToken(saved.token); setUser(saved.user); }
  }, []);
  useEffect(() => {
    if (!token) return;
    let active = true;
    const load = async () => {
      try {
        const [result, addressResult, loyaltyResult] = await Promise.all([
          requestJson<any>({ apiBase, path: '/me/pedidos?limit=100', token }),
          requestJson<any>({ apiBase, path: '/customer/addresses', token }),
          requestJson<any>({ apiBase, path: '/customer/lealtad', token }),
        ]);
        if (active) { setOrders(result.data.items || result.data.orders || result.data); setAddresses(addressResult.data); setLoyalty(loyaltyResult.data); setError(''); }
      } catch { if (active) setError('No se pudo consultar tu cuenta. Intenta actualizar.'); }
    };
    void load();
    const socket = io(getWingslabSocketUrl(), { auth: { token }, transports: ['websocket', 'polling'] });
    socket.on('connect', () => socket.emit('join-room'));
    for (const event of ['order:accepted', 'order:preparing', 'order:ready', 'order:in-transit', 'order:driver-arrived', 'order:delivered']) socket.on(event, () => void load());
    const timer = window.setInterval(() => void load(), 15000);
    return () => { active = false; window.clearInterval(timer); socket.disconnect(); };
  }, [apiBase, token]);
  useEffect(() => {
    if (!token) { setMarketingConsent(null); return; }
    let active = true;
    void requestJson<any>({ apiBase, path: '/customer/marketing-consent', token })
      .then(result => { if (active) { setMarketingConsent(result.data); setConsentError(''); } })
      .catch(() => { if (active) setConsentError('No se pudo consultar tu consentimiento comercial.'); });
    return () => { active = false; };
  }, [apiBase, token]);
  useEffect(() => {
    if (!detailOpen || !selected || !token) return;
    let active = true;
    setDetail(null);
    void requestJson<any>({ apiBase, path: `/me/pedidos/${selected}`, token }).then(r => { if (active) setDetail(r.data); }).catch(() => { if (active) setError('No se pudo cargar el pedido.'); });
    return () => { active = false; };
  }, [apiBase, token, selected, detailOpen, orders]);
  return <main className="min-h-screen bg-neutral-50 text-neutral-900">
    <header className="border-b bg-white"><div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4"><Link href="/" aria-label="Menú WingsLab"><WingsLabLogo className="h-8 w-36" /></Link><Link href="/" className="text-sm font-semibold">Ver menú</Link></div></header>
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <h1 className="text-2xl font-bold">Mis pedidos y cuenta</h1>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {!token ? <button className="rounded-xl bg-orange-600 px-5 py-3 font-semibold text-white" onClick={() => setAuthOpen(true)}>Iniciar sesión</button> : <>
        <section className="rounded-2xl border bg-white p-4"><h2 className="font-semibold">{user?.name}</h2><p className="mt-1 text-sm text-neutral-500">Tu cuenta de WingsLab</p>
          {addresses.map(a => <p key={a.id} className="mt-3 text-sm">{a.street} {a.number}, {a.neighborhood}, {a.city}</p>)}
          {loyalty?.enabled&&<div className="mt-4 rounded-xl bg-orange-50 p-3"><b>{loyalty.points} puntos WingsLab</b><p className="text-xs text-neutral-600">Canje disponible al activar el programa integral de recompensas.</p></div>}
          <div className="mt-4 rounded-xl border bg-neutral-50 p-3">
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-1" checked={marketingConsent?.enabled || false} disabled={!marketingConsent || consentSaving}
                onChange={async event => {
                  const enabled = event.target.checked;
                  setConsentSaving(true); setConsentError('');
                  try {
                    const result = await requestJson<any>({ apiBase, path: '/customer/marketing-consent', token, options: { method: 'PUT', body: JSON.stringify({ enabled }) } });
                    setMarketingConsent(result.data);
                  } catch { setConsentError('No se pudo actualizar la autorización. Intenta de nuevo.'); }
                  finally { setConsentSaving(false); }
                }} />
              <span><b>Autorizo campañas comerciales de WingsLab</b><span className="mt-1 block text-xs text-neutral-600">Es independiente del permiso de notificaciones del dispositivo. Para recibir una campaña se requieren ambas autorizaciones y una suscripción vigente. Puedes revocar este consentimiento aquí cuando quieras; actualmente no se envían campañas.</span></span>
            </label>
            {consentSaving && <p className="mt-2 text-xs text-neutral-500">Guardando consentimiento…</p>}
            {consentError && <p role="alert" className="mt-2 text-xs text-red-700">{consentError}</p>}
          </div>
          <button className="mt-4 text-sm underline" onClick={() => { clearStoredSession(storageKey); setToken(''); setUser(null); setOrders([]); setAddresses([]); setMarketingConsent(null); }}>Cerrar sesión</button>
        </section>
        <OrdersView sortedOrders={orders} visibleOrdersCount={100} setSelectedOrderId={setSelected} setIsDetailModalOpen={setDetailOpen} formatCurrency={money} formatDate={s => new Date(s).toLocaleString('es-MX')} StatusBadge={({ status }) => <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-800">{getOrderStatusLabel(status)}</span>} showLoadMore={false} loadMoreOrders={() => {}} />
      </>}
    </div>
    {detailOpen && <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-4"><section role="dialog" aria-modal="true" aria-label="Detalle de pedido" className="mx-auto my-8 max-w-lg space-y-4 rounded-2xl bg-white p-6"><button onClick={() => setDetailOpen(false)} className="float-right">Cerrar</button><h2 className="text-xl font-bold">Tu pedido WingsLab</h2>{detail ? <><p>{getOrderStatusLabel(detail.status)}</p><p>{money(detail.totalAmount)}</p>{detail.items?.map((item: any) => <p key={item.id}>{item.quantity} × {item.product?.name || item.productName}</p>)}{detail.tracking?.map((t: any) => <p key={t.id} className="text-sm text-neutral-600">{getOrderStatusLabel(t.status)}</p>)}<p className="text-xs text-neutral-500">{detail.orderReference}</p></> : <p>Cargando pedido…</p>}</section></div>}
    <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} apiBase={apiBase} onSuccess={(nextToken, nextUser) => { persistStoredSession({ storageKey, apiBase, token: nextToken, user: nextUser }); setToken(nextToken); setUser(nextUser); setAuthOpen(false); }} />
  </main>;
}
