'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getWingslabApiUrl, readStoredSession, type AuthUser } from '@sadel/shared';
import { Home, ReceiptText, Award, User, MoreHorizontal, Store, CircleHelp, Moon, X, MapPin, Navigation, Clock3, CreditCard, ShoppingBag, LogOut } from 'lucide-react';
import officialLogo from '../assets/wingslab-wordmark.png';
import officialRedLogo from '../assets/wingslab-wordmark-red.png';
import { AuthModal } from './AuthModal';
import { haversineKm } from '../lib/route-optimizer';
import { WingsLabLoading } from './WingsLabLoading';

type PublicInfo = {
  name?: string; address?: string; contactPhone?: string | null; email?: string | null;
  latitude?: number | null; longitude?: number | null;
  pickupOnly?: boolean; hasOwnDelivery?: boolean; isOpen?: boolean;
  acceptedPaymentMethods?: string[]; operatingHours?: { dayOfWeek: number; openTime: string; closeTime: string; isClosed: boolean }[];
};
type Tab = 'inicio' | 'pedidos' | 'fidelidad' | 'perfil' | 'soporte';

export function CustomerNavigation({ active, onHome, onAuthenticated, onLogout }: { active: Tab; onHome?: () => void; onAuthenticated: (token: string, user: AuthUser) => void; onLogout?: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [pendingTab, setPendingTab] = useState<Exclude<Tab, 'inicio'> | null>(null);
  const [dark, setDark] = useState(false);
  const [info, setInfo] = useState<PublicInfo | null>(null);
  const [infoFailed, setInfoFailed] = useState(false);
  const [panel, setPanel] = useState<'info' | 'support' | null>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const [locationStatus, setLocationStatus] = useState<'idle' | 'loading' | 'denied' | 'unavailable'>('idle');
  const locationRequest = useRef(0);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const infoReturnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Do not spend bandwidth prefetching on metered or very slow connections.
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (connection?.saveData || connection?.effectiveType === 'slow-2g' || connection?.effectiveType === '2g') return;
    const timer = window.setTimeout(() => {
      if (active === 'inicio') {
        if (readStoredSession('sadel.customer').token) router.prefetch('/cuenta');
      } else {
        router.prefetch('/');
      }
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [active, router]);

  useEffect(() => {
    const sync = () => {
      const root = document.documentElement;
      const isDark = root.classList.contains('dark');
      if (root.classList.contains('pure-dark') !== isDark) root.classList.toggle('pure-dark', isDark);
      setDark(isDark);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false); };
    const focusOutside = (event: FocusEvent) => { if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false); };
    const keyboard = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('focusin', focusOutside); document.addEventListener('keydown', keyboard);
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', focusOutside); document.removeEventListener('keydown', keyboard); };
  }, [open]);
  useEffect(() => {
    if (!panel) return;
    const controller = new AbortController();
    setInfoFailed(false);
    void fetch(`${getWingslabApiUrl()}/menu`, { signal: controller.signal, cache: 'no-store' })
      .then(response => { if (!response.ok) throw new Error('unavailable'); return response.json(); })
      .then(result => { if (result?.data) setInfo(result.data); else setInfoFailed(true); })
      .catch(() => { if (!controller.signal.aborted) setInfoFailed(true); });
    return () => controller.abort();
  }, [panel]);
  useEffect(() => () => { locationRequest.current += 1; }, []);
  useEffect(() => {
    if (panel && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [panel]);
  useEffect(() => {
    const openInfo = () => { infoReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setOpen(false); setInfo(null); setPanel('info'); };
    window.addEventListener('wingslab:restaurant-info', openInfo);
    return () => window.removeEventListener('wingslab:restaurant-info', openInfo);
  }, []);
  function showPanel(next: 'info' | 'support') { infoReturnFocus.current = trigger.current; setOpen(false); setInfo(null); setPanel(next); }
  function requestDistance() {
    const latitude = info?.latitude;
    const longitude = info?.longitude;
    if (typeof latitude !== 'number' || typeof longitude !== 'number' || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || !navigator.geolocation) {
      setLocationStatus('unavailable');
      return;
    }
    const request = ++locationRequest.current;
    setLocationStatus('loading');
    navigator.geolocation.getCurrentPosition(position => {
      if (request !== locationRequest.current) return;
      setDistance(haversineKm(position.coords.latitude, position.coords.longitude, latitude, longitude));
      setLocationStatus('idle');
    }, error => {
      if (request !== locationRequest.current) return;
      setLocationStatus(error.code === 1 ? 'denied' : 'unavailable');
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  }
  useEffect(() => {
    if (panel !== 'info' || !info) return;
    requestDistance();
    return () => { locationRequest.current += 1; };
    // Solo se vuelve a consultar al abrir el panel o cambiar sus coordenadas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, info?.latitude, info?.longitude]);
  function toggleTheme() {
    const preference = dark ? 'light' : 'dark';
    try { localStorage.setItem('wingslab.theme', preference); } catch {}
    window.dispatchEvent(new CustomEvent('wingslab:theme', { detail: preference }));
  }
  function navigate(tab: Tab) {
    setOpen(false);
    if (tab === 'inicio') { if (onHome) onHome(); else router.push('/'); }
    else if (!readStoredSession('sadel.customer').token) setPendingTab(tab);
    else if (active !== 'inicio') { window.location.hash = tab; }
    else { setNavigating(true); router.push(`/cuenta#${tab}`); }
  }
  // Preload only the other route on deliberate interaction; hash changes within
  // /cuenta already switch sections without navigating or reloading data.
  function prefetchRoute(tab: Tab) {
    if (tab === 'inicio') {
      if (active !== 'inicio') router.prefetch('/');
    } else if (active === 'inicio') {
      router.prefetch('/cuenta');
    }
  }
  const days = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  return <>
    {navigating && <WingsLabLoading><button type="button" onClick={() => setNavigating(false)} className="absolute bottom-[max(2rem,env(safe-area-inset-bottom))] min-h-11 rounded-xl px-4 text-sm font-semibold text-white underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">Volver</button></WingsLabLoading>}
    <nav className="wl-bottom-nav wl-capsule-nav wl-customer-nav" aria-label="Navegación principal">
      <button type="button" aria-current={active === 'inicio' ? 'page' : undefined} onPointerEnter={() => prefetchRoute('inicio')} onFocus={() => prefetchRoute('inicio')} onClick={() => navigate('inicio')}><Home aria-hidden="true" />Inicio</button>
      <button type="button" aria-current={active === 'pedidos' ? 'page' : undefined} onPointerEnter={() => prefetchRoute('pedidos')} onFocus={() => prefetchRoute('pedidos')} onClick={() => navigate('pedidos')}><ReceiptText aria-hidden="true" />Pedidos</button>
      <button type="button" aria-current={active === 'fidelidad' ? 'page' : undefined} onPointerEnter={() => prefetchRoute('fidelidad')} onFocus={() => prefetchRoute('fidelidad')} onClick={() => navigate('fidelidad')}><Award aria-hidden="true" />Fidelidad</button>
      <button type="button" aria-current={active === 'perfil' ? 'page' : undefined} onPointerEnter={() => prefetchRoute('perfil')} onFocus={() => prefetchRoute('perfil')} onClick={() => navigate('perfil')}><User aria-hidden="true" />Perfil</button>
      <button ref={trigger} type="button" data-open={open} aria-expanded={open} aria-controls="wl-more-menu" aria-haspopup="true" onClick={() => setOpen(value => !value)}><MoreHorizontal aria-hidden="true" />Más</button>
      {open && <div ref={menu} id="wl-more-menu" className="wl-more-popover" aria-label="Más opciones">
        <button type="button" onClick={() => showPanel('info')}><Store aria-hidden="true" /><span>Información del restaurante</span></button>
        <button type="button" onClick={() => navigate('soporte')}><CircleHelp aria-hidden="true" /><span>Soporte</span></button>
        <button type="button" role="switch" aria-checked={dark} onClick={toggleTheme}><Moon aria-hidden="true" /><span>Modo oscuro</span><span className="wl-theme-switch" aria-hidden="true"><i /></span></button>
        {readStoredSession('sadel.customer').token && onLogout && <button type="button" onClick={() => { setOpen(false); onLogout(); }}><LogOut aria-hidden="true" /><span>Cerrar sesión</span></button>}
      </div>}
    </nav>
    <AuthModal isOpen={pendingTab !== null} apiBase={getWingslabApiUrl()} onClose={() => setPendingTab(null)} onSuccess={(token, user) => {
      const destination = pendingTab;
      setPendingTab(null);
      onAuthenticated(token, user);
      if (user.status && user.status !== 'ACTIVE') return;
      if (destination) { if (active !== 'inicio') window.location.hash = destination; else router.push(`/cuenta#${destination}`); }
    }} />
    <dialog ref={dialog} className="wl-info-dialog wl-premium-dialog" aria-labelledby="wl-info-title" onClose={() => { locationRequest.current += 1; setDistance(null); setLocationStatus('idle'); setPanel(null); infoReturnFocus.current?.focus(); }} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className="wl-info-heading"><div><h2 id="wl-info-title">Información del restaurante</h2></div><button type="button" aria-label="Cerrar" onClick={() => dialog.current?.close()}><X /></button></div>
      {infoFailed ? <p className="wl-info-message" role="alert">No se pudo cargar la información. Intenta de nuevo más tarde.</p> : !info ? <p className="wl-info-message" role="status">Cargando información…</p> : <div className="wl-info-content">
        <div className="wl-info-identity"><div><img className="wl-logo-on-light" src={officialRedLogo.src} alt="WingsLab" /><img className="wl-logo-on-dark" src={officialLogo.src} alt="" aria-hidden="true" />{info.name && info.name.toLowerCase() !== 'wingslab' && <p>{info.name}</p>}</div>{typeof info.isOpen === 'boolean' && <span className={`wl-info-status ${info.isOpen ? 'is-open' : 'is-closed'}`}><i aria-hidden="true" />{info.isOpen ? 'Abierto' : 'Cerrado'}</span>}</div>
        {info.address && <section className="wl-info-section"><span className="wl-info-icon"><MapPin /></span><div><h3>Ubicación</h3><p>{info.address}</p></div></section>}
        {typeof info.latitude === 'number' && typeof info.longitude === 'number' && <section className="wl-info-section"><span className="wl-info-icon"><Navigation aria-hidden="true" /></span><div><h3>Distancia a ti</h3>{distance !== null ? <p><strong>{distance < 1 ? `${Math.round(distance * 1000)} m` : `${distance.toFixed(1)} km`}</strong> aproximadamente en línea recta; no es distancia de envío.</p> : <><p role="status">{locationStatus === 'loading' || locationStatus === 'idle' ? 'Calculando distancia…' : locationStatus === 'denied' ? 'Permite la ubicación en los ajustes del navegador.' : 'No pudimos obtener tu ubicación.'}</p>{(locationStatus === 'denied' || locationStatus === 'unavailable') && <button type="button" className="wl-info-location-button" onClick={requestDistance}>Reintentar</button>}</>}</div></section>}
        {!!info.operatingHours?.length && <section className="wl-info-section"><span className="wl-info-icon"><Clock3 /></span><div><h3>Horarios</h3><div className="wl-info-hours">{info.operatingHours.map((h, i) => <div key={i}><span>{days[h.dayOfWeek] || 'Horario'}</span><span>{h.isClosed ? 'Cerrado' : `${h.openTime} – ${h.closeTime}`}</span></div>)}</div></div></section>}
        {!!info.acceptedPaymentMethods?.length && <section className="wl-info-section"><span className="wl-info-icon"><CreditCard /></span><div><h3>Métodos de pago</h3><div className="wl-info-payments">{info.acceptedPaymentMethods.map(m => <span key={m}>{({ CASH:'Efectivo', CREDIT_CARD:'Tarjeta', CARD:'Tarjeta', TRANSFER:'Transferencia' } as Record<string,string>)[m] || m}</span>)}</div></div></section>}
        {(info.pickupOnly === true || info.hasOwnDelivery === true) && <section className="wl-info-section"><span className="wl-info-icon"><ShoppingBag /></span><div><h3>Servicio</h3><p>{info.pickupOnly ? 'Recogida en tienda' : 'Entrega y recogida en tienda'}</p></div></section>}
      </div>}
    </dialog>
  </>;
}
