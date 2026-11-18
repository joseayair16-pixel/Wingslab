'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Bike, Banknote, Check, ChevronRight, Clock3, History, LoaderCircle, LogOut, MapPin, Navigation, PackageCheck, Phone, QrCode, RefreshCw, ScanLine, ShieldCheck, UserRound, X } from 'lucide-react';
import { AuthResponse, AuthUser, clearStoredSession, getRequestErrorMessage, getWingslabApiUrl, persistApiBase, persistStoredSession, readStoredSession, requestJson } from '@sadel/shared';
import type { Html5Qrcode } from 'html5-qrcode';

type Tab = 'deliveries' | 'history' | 'profile';
type Availability = 'AVAILABLE' | 'BUSY' | 'OFFLINE';

type DriverProfile = {
  id: string;
  status: string;
  availability: Availability;
  totalDeliveries: number;
  deliveryCompensation: number;
  user: AuthUser & { lastName?: string | null; mustChangePassword?: boolean };
};

type DriverOrder = {
  id: string;
  orderReference: string;
  dailyCounter?: number | null;
  status: 'READY' | 'IN_TRANSIT' | 'DELIVERED';
  paymentMethod: string;
  paymentStatus: string;
  totalAmount: number;
  deliveryFee: number;
  driverCompensation?: number | null;
  createdAt: string;
  deliveredAt?: string | null;
  estimatedDeliveryTime?: string | null;
  driverArrivedAtCustomer?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  restaurant: { id: string; name: string; address?: string | null; contactPhone?: string | null; latitude?: number | null; longitude?: number | null };
  customer: { user?: { id?: string; name?: string; lastName?: string | null; phone?: string } };
  address?: { street: string; number: string; apartment?: string | null; neighborhood: string; reference?: string | null; latitude?: number | null; longitude?: number | null } | null;
  driverEarning?: { amount: number; paid: boolean; payout?: { reference: string; paidAt: string } | null } | null;
};

type Envelope<T> = { success: true; data: T };

const STORAGE_KEY = 'wingslab.driver';

function orderLabel(order: Pick<DriverOrder, 'dailyCounter' | 'orderReference'>) {
  return order.dailyCounter ? `#${String(order.dailyCounter).padStart(2, '0')}` : order.orderReference;
}

function orderAddress(order: DriverOrder) {
  if (!order.address) return 'Dirección no disponible';
  const line = `${order.address.street} ${order.address.number}${order.address.apartment ? `, Int. ${order.address.apartment}` : ''}, ${order.address.neighborhood}`;
  return order.address.reference ? `${line}. ${order.address.reference}` : line;
}

function extractDeliveryToken(raw: string): string | null {
  const value = raw.trim();
  if (/^[A-Za-z0-9_-]{43}$/.test(value)) return value;
  try {
    const url = new URL(value, window.location.origin);
    const match = url.pathname.match(/\/reparto\/ver\/([A-Za-z0-9_-]{43})(?:\/|$)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export default function DriverHome() {
  const apiBase = useMemo(() => getWingslabApiUrl(), []);
  const [token, setToken] = useState('');
  const [sessionUser, setSessionUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [orders, setOrders] = useState<DriverOrder[]>([]);
  const [history, setHistory] = useState<DriverOrder[]>([]);
  const [tab, setTab] = useState<Tab>('deliveries');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loginPhone, setLoginPhone] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  const [deliveryTarget, setDeliveryTarget] = useState<string | null>(null);
  const [deliveryPin, setDeliveryPin] = useState('');
  const [cashReceived, setCashReceived] = useState(false);
  const [trackingOrderId, setTrackingOrderId] = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [manualQr, setManualQr] = useState('');
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const claimInFlight = useRef(false);

  const call = useCallback(<T,>(path: string, options?: RequestInit) => requestJson<T>({
    apiBase,
    path,
    token: token || undefined,
    options,
    fallbackMessage: 'No se pudo completar la solicitud.',
  }), [apiBase, token]);

  const clearSession = useCallback(() => {
    clearStoredSession(STORAGE_KEY);
    setToken('');
    setSessionUser(null);
    setProfile(null);
    setOrders([]);
    setHistory([]);
    setLoginPassword('');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  }, []);

  const loadDashboard = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      const profileResult = await call<Envelope<DriverProfile>>('/driver-panel/perfil');
      setProfile(profileResult.data);
      setSessionUser(profileResult.data.user);
      if (profileResult.data.user.mustChangePassword) {
        setOrders([]);
        setHistory([]);
        setLoading(false);
        return;
      }
      const [ordersResult, historyResult] = await Promise.all([
        call<Envelope<DriverOrder[]>>('/driver-panel/pedidos/pendientes'),
        call<Envelope<{ items: DriverOrder[]; hasMore: boolean }>>('/driver-panel/historial?page=1&limit=30'),
      ]);
      setOrders(ordersResult.data);
      setHistory(historyResult.data.items);
      persistStoredSession({ storageKey: STORAGE_KEY, apiBase, token, user: profileResult.data.user });
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'No se pudieron actualizar tus entregas.'));
      setNotice('');
      if (/UNAUTHORIZED|SESSION|CUENTA|PASSWORD_CHANGE_REQUIRED/i.test(getRequestErrorMessage(requestError, ''))) clearSession();
    } finally {
      setLoading(false);
    }
  }, [apiBase, call, clearSession, token]);

  useEffect(() => {
    const stored = readStoredSession(STORAGE_KEY);
    if (stored.token && stored.user?.role === 'DRIVER') {
      setToken(stored.token);
      setSessionUser(stored.user);
      if (stored.apiBase) persistApiBase(STORAGE_KEY, apiBase);
    }
    setIsCheckingSession(false);
  }, [apiBase]);

  useEffect(() => {
    if (token) void loadDashboard();
    else setLoading(false);
  }, [loadDashboard, token]);

  useEffect(() => {
    if (!token) return;
    const refresh = () => { if (document.visibilityState === 'visible') void loadDashboard(); };
    const interval = window.setInterval(refresh, 20_000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(interval); window.removeEventListener('focus', refresh); };
  }, [loadDashboard, token]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError('');
    try {
      const result = await requestJson<AuthResponse>({
        apiBase,
        path: '/auth/driver-login',
        options: { method: 'POST', body: JSON.stringify({ phone: loginPhone, password: loginPassword }) },
        fallbackMessage: 'No se pudo iniciar sesión.',
      });
      if (result.data.user.role !== 'DRIVER') throw new Error('Esta cuenta no es de repartidor.');
      setToken(result.data.token);
      setSessionUser(result.data.user);
      persistStoredSession({ storageKey: STORAGE_KEY, apiBase, token: result.data.token, refreshToken: result.data.refreshToken, user: result.data.user });
      setLoginPassword('');
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Teléfono o contraseña incorrectos.'));
    } finally {
      setWorking(false);
    }
  }

  async function changeTemporaryPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    if (newPassword !== confirmPassword) return setError('Las contraseñas nuevas no coinciden.');
    if (newPassword.length < 10) return setError('Usa al menos 10 caracteres para tu contraseña personal.');
    setWorking(true);
    try {
      await call('/driver-panel/password', {
        method: 'PATCH',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setNotice('Contraseña actualizada. Ya puedes comenzar tu turno.');
      await loadDashboard();
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'No se pudo cambiar la contraseña.'));
    } finally {
      setWorking(false);
    }
  }

  async function updateAvailability(next: 'AVAILABLE' | 'OFFLINE') {
    setAvailabilityBusy(true);
    setError('');
    try {
      await call('/driver-panel/disponibilidad', { method: 'PATCH', body: JSON.stringify({ availability: next }) });
      await loadDashboard();
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'No se pudo actualizar tu disponibilidad.'));
    } finally {
      setAvailabilityBusy(false);
    }
  }

  const claimQr = useCallback(async (raw: string) => {
    if (claimInFlight.current) return;
    const scannedToken = extractDeliveryToken(raw);
    if (!scannedToken) {
      setError('El QR no es un enlace de entrega WingsLab válido.');
      return;
    }
    claimInFlight.current = true;
    setWorking(true);
    setError('');
    setNotice('');
    try {
      const result = await call<Envelope<DriverOrder>>('/driver-panel/qr/reclamar', {
        method: 'POST',
        body: JSON.stringify({ token: scannedToken }),
      });
      setNotice(`Pedido ${orderLabel(result.data)} agregado a tus entregas.`);
      setShowScanner(false);
      setManualQr('');
      setTab('deliveries');
      await loadDashboard();
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'No se pudo reclamar este QR.'));
    } finally {
      claimInFlight.current = false;
      setWorking(false);
    }
  }, [call, loadDashboard]);

  const stopScanner = useCallback(async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (!scanner) return;
    try {
      if (scanner.isScanning) await scanner.stop();
      scanner.clear();
    } catch {
      // Puede no haber arrancado todavía; el modal se cierra de todos modos.
    }
  }, []);

  useEffect(() => {
    if (!showScanner) return;
    let mounted = true;
    let scanner: Html5Qrcode | null = null;
    void (async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (!mounted) return;
        scanner = new Html5Qrcode('wingslab-qr-reader');
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1 },
          decoded => { void claimQr(decoded); },
          () => undefined,
        );
      } catch {
        setError('No pudimos abrir la cámara. Revisa el permiso o pega el enlace del QR manualmente.');
      }
    })();
    return () => {
      mounted = false;
      void stopScanner();
    };
  }, [claimQr, showScanner, stopScanner]);

  useEffect(() => {
    if (!trackingOrderId) return;
    if (!orders.some(order => order.id === trackingOrderId && order.status === 'IN_TRANSIT')) {
      setTrackingOrderId(null);
      return;
    }
    if (!navigator.geolocation) {
      setTrackingOrderId(null);
      setError('Este dispositivo no permite compartir ubicación.');
      return;
    }

    let lastSentAt = 0;
    const watchId = navigator.geolocation.watchPosition(
      position => {
        const now = Date.now();
        if (now - lastSentAt < 12_000) return;
        lastSentAt = now;
        void call<Envelope<DriverOrder>>(`/driver-panel/pedidos/${encodeURIComponent(trackingOrderId)}/accion`, {
          method: 'PATCH',
          body: JSON.stringify({ action: 'location', coords: [position.coords.latitude, position.coords.longitude] }),
        }).catch(requestError => setError(getRequestErrorMessage(requestError, 'Se perdió el envío de ubicación.')));
      },
      () => {
        setTrackingOrderId(null);
        setError('No se pudo compartir tu ubicación. Revisa el permiso del dispositivo.');
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 5_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [call, orders, trackingOrderId]);

  async function performAction(order: DriverOrder, action: 'start' | 'arrive' | 'location' | 'deliver', extra: Record<string, unknown> = {}) {
    setWorking(true);
    setError('');
    setNotice('');
    try {
      const result = await call<Envelope<DriverOrder>>(`/driver-panel/pedidos/${encodeURIComponent(order.id)}/accion`, {
        method: 'PATCH',
        body: JSON.stringify({ action, ...extra }),
      });
      setNotice(action === 'deliver' ? `Entrega ${orderLabel(order)} confirmada.` : action === 'start' ? `Pedido ${orderLabel(order)} en camino.` : action === 'arrive' ? 'Llegada al domicilio registrada.' : 'Ubicación compartida con el cliente.');
      setDeliveryTarget(null);
      setDeliveryPin('');
      setCashReceived(false);
      if (action === 'deliver') setTrackingOrderId(null);
      await loadDashboard();
      if (action === 'deliver') setTab('history');
      return result.data;
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'No se pudo actualizar la entrega.'));
      return null;
    } finally {
      setWorking(false);
    }
  }

  function toggleLocationTracking(order: DriverOrder) {
    if (trackingOrderId === order.id) {
      setTrackingOrderId(null);
      setNotice('Dejaste de compartir tu ubicación.');
    } else {
      setError('');
      setNotice('El cliente podrá ver tu ubicación mientras esta entrega siga en curso.');
      setTrackingOrderId(order.id);
    }
  }

  if (isCheckingSession || loading && !token) {
    return <main className="grid min-h-[100dvh] place-items-center"><LoaderCircle className="animate-spin text-[#bb0a0e]" size={30} /></main>;
  }

  if (!token) {
    return (
      <main className="min-h-[100dvh] px-4 py-10 sm:grid sm:place-items-center sm:py-16">
        <section className="mx-auto w-full max-w-md overflow-hidden rounded-[32px] border border-[#eadfd3] bg-white shadow-[0_28px_80px_rgba(55,35,18,.1)]">
          <div className="bg-[#bb0a0e] px-7 pb-8 pt-9 text-white sm:px-9">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15"><Bike size={25} /></div>
            <p className="mt-6 text-xs font-bold uppercase tracking-[.24em] text-white/75">WingsLab · Reparto propio</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight">Tu turno empieza aquí</h1>
            <p className="mt-2 text-sm leading-6 text-white/80">Inicia sesión con los datos que te compartió el restaurante.</p>
          </div>
          <form onSubmit={signIn} className="grid gap-4 p-7 sm:p-9">
            {error ? <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
            <label className="grid gap-1.5 text-sm font-bold text-[#51473f]">Teléfono móvil<input required autoComplete="username" inputMode="tel" value={loginPhone} onChange={event => setLoginPhone(event.target.value)} placeholder="5512345678" className="h-13 rounded-2xl border border-[#e8ddd2] bg-[#fffefd] px-4 py-3 text-base font-medium text-[#191614] outline-none focus:border-[#bb0a0e] focus:ring-4 focus:ring-[#bb0a0e]/10" /></label>
            <label className="grid gap-1.5 text-sm font-bold text-[#51473f]">Contraseña<input required type="password" autoComplete="current-password" value={loginPassword} onChange={event => setLoginPassword(event.target.value)} className="h-13 rounded-2xl border border-[#e8ddd2] bg-[#fffefd] px-4 py-3 text-base font-medium text-[#191614] outline-none focus:border-[#bb0a0e] focus:ring-4 focus:ring-[#bb0a0e]/10" /></label>
            <button type="submit" disabled={working} className="mt-2 flex h-13 items-center justify-center gap-2 rounded-full bg-[#bb0a0e] px-5 font-bold text-white transition hover:bg-[#94070b] disabled:opacity-60">{working ? <LoaderCircle className="animate-spin" size={18} /> : <ChevronRight size={18} />} Entrar al panel</button>
            <p className="text-center text-xs leading-5 text-[#84796f]">¿No tienes acceso? Pídele al restaurante tu cuenta de repartidor.</p>
          </form>
        </section>
      </main>
    );
  }

  const mustChangePassword = Boolean(profile?.user.mustChangePassword ?? sessionUser?.mustChangePassword);

  if (mustChangePassword) {
    return (
      <main className="min-h-[100dvh] px-4 py-10 sm:grid sm:place-items-center">
        <section className="mx-auto w-full max-w-lg rounded-[32px] border border-[#eadfd3] bg-white p-7 shadow-[0_28px_80px_rgba(55,35,18,.1)] sm:p-9">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#fff0ef] text-[#bb0a0e]"><ShieldCheck size={24} /></span>
          <p className="mt-6 text-xs font-bold uppercase tracking-[.22em] text-[#bb0a0e]">Protege tu cuenta</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-[#191614]">Crea tu contraseña</h1>
          <p className="mt-2 text-sm leading-6 text-[#70675f]">Esta contraseña temporal solo sirve para el primer acceso. Antes de comenzar, elige una contraseña personal de al menos 10 caracteres.</p>
          <form onSubmit={changeTemporaryPassword} className="mt-6 grid gap-4">
            {error ? <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
            {notice ? <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{notice}</div> : null}
            <label className="grid gap-1.5 text-sm font-bold text-[#51473f]">Contraseña temporal<input required type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} className="h-12 rounded-2xl border border-[#e8ddd2] px-4 text-base outline-none focus:border-[#bb0a0e]" /></label>
            <label className="grid gap-1.5 text-sm font-bold text-[#51473f]">Nueva contraseña<input required minLength={10} type="password" autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} className="h-12 rounded-2xl border border-[#e8ddd2] px-4 text-base outline-none focus:border-[#bb0a0e]" /></label>
            <label className="grid gap-1.5 text-sm font-bold text-[#51473f]">Confirmar contraseña<input required minLength={10} type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} className="h-12 rounded-2xl border border-[#e8ddd2] px-4 text-base outline-none focus:border-[#bb0a0e]" /></label>
            <button type="submit" disabled={working} className="mt-1 flex h-12 items-center justify-center gap-2 rounded-full bg-[#bb0a0e] font-bold text-white disabled:opacity-60">{working ? <LoaderCircle className="animate-spin" size={18} /> : <Check size={18} />} Guardar contraseña</button>
            <button type="button" onClick={clearSession} className="mx-auto inline-flex items-center gap-2 py-2 text-sm font-semibold text-[#70675f]"><LogOut size={15} /> Cerrar sesión</button>
          </form>
        </section>
      </main>
    );
  }

  const activeCount = orders.length;

  return (
    <main className="min-h-[100dvh] pb-28">
      <header className="sticky top-0 z-30 border-b border-[#eadfd3] bg-[#faf7f2]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#bb0a0e] text-white"><Bike size={22} /></div><div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-[.22em] text-[#bb0a0e]">WingsLab</p><p className="truncate text-sm font-bold text-[#191614]">Hola, {profile?.user.name || sessionUser?.name || 'repartidor'}</p></div></div>
          <div className="flex items-center gap-2"><span className={`hidden rounded-full px-3 py-1.5 text-xs font-bold sm:inline-flex ${profile?.availability === 'OFFLINE' ? 'bg-neutral-100 text-neutral-600' : profile?.availability === 'BUSY' ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'}`}>{profile?.availability === 'OFFLINE' ? 'Desconectado' : profile?.availability === 'BUSY' ? 'En entrega' : 'Disponible'}</span><button type="button" onClick={() => void loadDashboard()} disabled={loading} aria-label="Actualizar" className="grid h-10 w-10 place-items-center rounded-full border border-[#eadfd3] bg-white text-[#51473f] disabled:opacity-50"><RefreshCw size={17} className={loading ? 'animate-spin' : ''} /></button></div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-5 px-4 py-5 sm:px-6 sm:py-7">
        <section className="overflow-hidden rounded-[30px] bg-[#191614] p-5 text-white shadow-[0_18px_45px_rgba(25,22,20,.13)] sm:p-7">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[.2em] text-white/55">Tu jornada WingsLab</p><h1 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">Tus entregas, a tu ritmo.</h1><p className="mt-1 text-sm text-white/65">{activeCount ? `${activeCount} entrega${activeCount === 1 ? '' : 's'} asignada${activeCount === 1 ? '' : 's'}` : 'Escanea el QR de un pedido listo o espera una asignación del restaurante.'}</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => setShowScanner(true)} disabled={working} className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-5 text-sm font-bold text-[#191614] hover:bg-[#fff0ef] disabled:opacity-50"><ScanLine size={18} /> Escanear pedido</button><button type="button" onClick={() => void updateAvailability(profile?.availability === 'OFFLINE' ? 'AVAILABLE' : 'OFFLINE')} disabled={availabilityBusy || profile?.availability === 'BUSY'} className={`inline-flex h-12 items-center gap-2 rounded-full px-5 text-sm font-bold ${profile?.availability === 'OFFLINE' ? 'bg-[#bb0a0e] text-white hover:bg-[#d31c20]' : 'bg-white/10 text-white hover:bg-white/15'} disabled:opacity-40`}>{availabilityBusy ? <LoaderCircle className="animate-spin" size={17} /> : <span className={`h-2 w-2 rounded-full ${profile?.availability === 'OFFLINE' ? 'bg-white/60' : 'bg-emerald-400'}`} />}{profile?.availability === 'OFFLINE' ? 'Conectarme' : 'Desconectarme'}</button></div></div>
        </section>

        {error ? <div role="alert" className="flex items-start justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="Cerrar aviso"><X size={16} /></button></div> : null}
        {notice ? <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900">{notice}</div> : null}

        {tab === 'deliveries' ? (
          <section aria-labelledby="deliveries-title" className="space-y-4">
            <div className="flex items-end justify-between"><div><p className="text-xs font-bold uppercase tracking-[.2em] text-[#bb0a0e]">En curso</p><h2 id="deliveries-title" className="mt-1 text-xl font-black text-[#191614]">Entregas asignadas</h2></div><span className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-[#70675f] ring-1 ring-[#eadfd3]">{activeCount}</span></div>
            {loading && orders.length === 0 ? <PanelEmpty icon={<LoaderCircle className="animate-spin" />} title="Sincronizando entregas" detail="Un momento, estamos consultando tus pedidos." /> : orders.length === 0 ? <PanelEmpty icon={<PackageCheck />} title="Todo tranquilo por ahora" detail="Cuando el restaurante te asigne una entrega, aparecerá aquí. También puedes reclamar un pedido con su QR." /> : orders.map(order => {
              const isCash = order.paymentMethod === 'CASH';
              const isConfirming = deliveryTarget === order.id;
              const destination = order.address?.latitude != null && order.address.longitude != null ? `https://maps.apple.com/?daddr=${order.address.latitude},${order.address.longitude}` : null;
              return (
                <article key={order.id} className="rounded-[28px] border border-[#eadfd3] bg-white p-5 shadow-[0_12px_35px_rgba(55,35,18,.05)] sm:p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><span className="rounded-full bg-[#fff0ef] px-3 py-1 text-xs font-black text-[#bb0a0e]">Pedido {orderLabel(order)}</span><span className={`rounded-full px-3 py-1 text-xs font-bold ${order.status === 'IN_TRANSIT' ? 'bg-sky-50 text-sky-800' : 'bg-emerald-50 text-emerald-800'}`}>{order.status === 'IN_TRANSIT' ? 'En camino' : 'Listo para recoger'}</span></div><h3 className="mt-3 text-lg font-black text-[#191614]">{order.restaurant.name}</h3><p className="mt-1 text-sm text-[#70675f]">Cliente: {order.customer.user?.name || 'Cliente'} {order.customer.user?.lastName || ''}</p></div></div>
                  <div className="mt-4 rounded-2xl bg-[#faf7f2] p-4"><p className="flex items-start gap-2 text-sm font-semibold leading-6 text-[#392f27]"><MapPin className="mt-1 shrink-0 text-[#bb0a0e]" size={17} />{orderAddress(order)}</p>{order.address?.reference ? <p className="ml-6 mt-1 text-xs text-[#70675f]">Referencia: {order.address.reference}</p> : null}<div className="mt-3 flex flex-wrap gap-2"><a href={`tel:${order.customer.user?.phone || ''}`} className="inline-flex items-center gap-1.5 rounded-full border border-[#e8ddd2] bg-white px-3 py-2 text-xs font-bold text-[#51473f]"><Phone size={14} /> Llamar cliente</a>{destination ? <a href={destination} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-[#e8ddd2] bg-white px-3 py-2 text-xs font-bold text-[#51473f]"><Navigation size={14} /> Abrir ruta</a> : null}</div></div>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-[#70675f]"><span className="inline-flex items-center gap-1.5"><Banknote size={15} />{isCash ? 'Pago en efectivo' : 'Pago cubierto por el cliente'}</span><span>{order.estimatedDeliveryTime ? `Entrega estimada ${new Date(order.estimatedDeliveryTime).toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' })}` : ''}</span></div>
                  {order.status === 'READY' ? <button type="button" disabled={working} onClick={() => void performAction(order, 'start')} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#bb0a0e] text-sm font-bold text-white hover:bg-[#94070b] disabled:opacity-50"><Navigation size={17} /> Iniciar entrega</button> : (
                    <div className="mt-4 grid gap-2 sm:grid-cols-3">
                      {!order.driverArrivedAtCustomer ? <button type="button" disabled={working} onClick={() => void performAction(order, 'arrive')} className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-[#e8ddd2] bg-white text-sm font-bold text-[#51473f] disabled:opacity-50"><MapPin size={16} /> Ya llegué</button> : <div className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-emerald-50 text-sm font-bold text-emerald-800"><Check size={16} /> Llegada registrada</div>}
                      <button type="button" disabled={working} onClick={() => toggleLocationTracking(order)} className={`inline-flex h-11 items-center justify-center gap-2 rounded-full border px-3 text-sm font-bold disabled:opacity-50 ${trackingOrderId === order.id ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-[#e8ddd2] bg-white text-[#51473f]'}`}><Navigation size={16} /> {trackingOrderId === order.id ? 'Dejar de compartir' : 'Compartir ubicación'}</button>
                      <button type="button" disabled={working || !order.driverArrivedAtCustomer} onClick={() => { setDeliveryTarget(isConfirming ? null : order.id); setDeliveryPin(''); setCashReceived(false); }} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[#191614] text-sm font-bold text-white disabled:opacity-40"><PackageCheck size={16} /> Confirmar entrega</button>
                    </div>
                  )}
                  {isConfirming ? <div className="mt-3 rounded-2xl border border-[#eadfd3] bg-[#faf7f2] p-4"><p className="text-sm font-bold text-[#191614]">Confirma la entrega con el cliente</p>{isCash ? <label className="mt-3 flex items-center gap-3 text-sm text-[#51473f]"><input type="checkbox" checked={cashReceived} onChange={event => setCashReceived(event.target.checked)} className="h-4 w-4 accent-[#bb0a0e]" />Confirmo que recibí el pago en efectivo.</label> : <label className="mt-3 grid gap-1.5 text-sm font-semibold text-[#51473f]">PIN de entrega del cliente<input autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={deliveryPin} onChange={event => setDeliveryPin(event.target.value.replace(/\D/g, '').slice(0, 6))} className="h-12 max-w-xs rounded-xl border border-[#e8ddd2] bg-white px-4 text-center text-xl font-black tracking-[.35em] outline-none focus:border-[#bb0a0e]" placeholder="••••" /></label>}<div className="mt-4 flex gap-2"><button type="button" onClick={() => setDeliveryTarget(null)} className="rounded-full border border-[#e8ddd2] px-4 py-2.5 text-sm font-bold text-[#51473f]">Cancelar</button><button type="button" disabled={working || (isCash ? !cashReceived : deliveryPin.length < 4)} onClick={() => void performAction(order, 'deliver', isCash ? { cashReceived: true } : { pin: deliveryPin })} className="inline-flex items-center gap-2 rounded-full bg-[#bb0a0e] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">{working ? <LoaderCircle className="animate-spin" size={16} /> : <Check size={16} />} Confirmar</button></div></div> : null}
                </article>
              );
            })}
          </section>
        ) : null}

        {tab === 'history' ? <section className="space-y-4"><div><p className="text-xs font-bold uppercase tracking-[.2em] text-[#bb0a0e]">Actividad</p><h2 className="mt-1 text-xl font-black text-[#191614]">Historial de entregas</h2></div>{history.length === 0 ? <PanelEmpty icon={<History />} title="Tu historial aparecerá aquí" detail="Las entregas se agregan cuando confirmas que llegaron al cliente." /> : history.map(order => <article key={order.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-[#eadfd3] bg-white p-4"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><Check size={19} /></span><div><p className="font-bold text-[#191614]">Pedido {orderLabel(order)} · {order.restaurant.name}</p><p className="mt-0.5 text-xs text-[#70675f]">{order.deliveredAt ? new Date(order.deliveredAt).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : 'Entrega completada'}</p></div></div></article>)}</section> : null}

        {tab === 'profile' ? <section className="space-y-4"><div><p className="text-xs font-bold uppercase tracking-[.2em] text-[#bb0a0e]">Tu cuenta</p><h2 className="mt-1 text-xl font-black text-[#191614]">Perfil de repartidor</h2></div><div className="rounded-[24px] border border-[#eadfd3] bg-white p-5"><div className="flex items-center gap-3"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#fff0ef] text-[#bb0a0e]"><UserRound size={22} /></span><div><p className="font-bold text-[#191614]">{profile?.user.name} {profile?.user.lastName || ''}</p><p className="mt-0.5 text-sm text-[#70675f]">{profile?.user.phone}</p></div></div><div className="mt-5 grid grid-cols-2 gap-3"><BalanceTile label="Entregas realizadas" value={String(profile?.totalDeliveries || 0)} detail="Total en WingsLab" /></div></div><button type="button" onClick={clearSession} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-[#eadfd3] bg-white font-bold text-[#51473f]"><LogOut size={17} /> Cerrar sesión</button></section> : null}
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-[#eadfd3] bg-white/95 px-2 pb-[max(.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl" aria-label="Secciones del repartidor"><div className="mx-auto grid max-w-lg grid-cols-3 gap-1">{([
        ['deliveries', 'Entregas', <Bike size={19} />], ['history', 'Historial', <History size={19} />], ['profile', 'Perfil', <UserRound size={19} />],
      ] as const).map(([key, label, icon]) => <button type="button" key={key} onClick={() => setTab(key)} className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl text-[10px] font-bold transition ${tab === key ? 'bg-[#fff0ef] text-[#bb0a0e]' : 'text-[#84796f] hover:bg-[#faf7f2]'}`}>{icon}{label}</button>)}</div></nav>

      {showScanner ? <div className="fixed inset-0 z-50 grid place-items-center bg-[#191614]/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="qr-modal-title"><section className="w-full max-w-md rounded-[28px] bg-white p-5 shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-[.2em] text-[#bb0a0e]">Reclamar entrega</p><h2 id="qr-modal-title" className="mt-1 text-xl font-black text-[#191614]">Escanea el QR del pedido</h2></div><button type="button" onClick={() => setShowScanner(false)} aria-label="Cerrar escáner" className="grid h-9 w-9 place-items-center rounded-full bg-[#faf7f2] text-[#51473f]"><X size={17} /></button></div><p className="mt-2 text-sm text-[#70675f]">Apunta la cámara al código de reparto que preparó el restaurante.</p><div id="wingslab-qr-reader" className="mt-4 min-h-[280px] overflow-hidden rounded-2xl bg-[#191614]" /><div className="mt-4 flex gap-2"><input value={manualQr} onChange={event => setManualQr(event.target.value)} placeholder="O pega aquí el enlace del QR" className="h-11 min-w-0 flex-1 rounded-xl border border-[#e8ddd2] px-3 text-sm outline-none focus:border-[#bb0a0e]" /><button type="button" disabled={working || !manualQr.trim()} onClick={() => void claimQr(manualQr)} className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-[#bb0a0e] px-4 text-sm font-bold text-white disabled:opacity-40"><QrCode size={16} /> Usar</button></div><p className="mt-3 text-xs leading-5 text-[#84796f]">Solo puedes reclamar entregas de WingsLab y cada QR se asigna a un solo repartidor.</p></section></div> : null}
    </main>
  );
}

function PanelEmpty({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return <div className="rounded-[28px] border border-dashed border-[#ddcfc0] bg-white/70 px-6 py-12 text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#fff0ef] text-[#bb0a0e]">{icon}</span><h3 className="mt-4 text-lg font-bold text-[#191614]">{title}</h3><p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-[#70675f]">{detail}</p></div>;
}

function BalanceTile({ label, value, detail, featured = false }: { label: string; value: string; detail: string; featured?: boolean }) {
  return <div className={`rounded-[24px] border p-5 ${featured ? 'border-[#bb0a0e]/15 bg-[#fff0ef]' : 'border-[#eadfd3] bg-white'}`}><p className="text-xs font-bold uppercase tracking-[.12em] text-[#70675f]">{label}</p><p className={`mt-2 text-2xl font-black tracking-tight ${featured ? 'text-[#bb0a0e]' : 'text-[#191614]'}`}>{value}</p><p className="mt-1 text-xs text-[#70675f]">{detail}</p></div>;
}
