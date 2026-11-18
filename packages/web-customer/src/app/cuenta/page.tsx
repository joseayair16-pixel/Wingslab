'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { MapPin, Plus, Search, Star, Trash2, LogOut, X, Loader2, Pencil, Camera, Smartphone, PackageCheck, ReceiptText, QrCode, Gift, Award, UserRound } from 'lucide-react';
import { getWingslabApiUrl, getWingslabSocketUrl, getOrderStatusLabel, readStoredSession, persistStoredSession, requestJson, clearStoredSession, type AuthUser } from '@sadel/shared';
import { AuthModal } from '../../components/AuthModal';
import { OrdersView } from '../../views/OrdersView';
import { CustomerNavigation } from '../../components/CustomerNavigation';
import { CustomerSupport } from '../../components/CustomerSupport';
import { PageHeader } from '../../components/PageHeader';
import { LoyaltyQrPanel } from '../../components/LoyaltyQrPanel';
import { createPlacesSource } from '../../lib/places';
import { waitForGoogleMaps } from '../../lib/googleMaps';
import officialLogo from '../../assets/wingslab-wordmark.png';
import { LoyaltyCard } from '../../../../shared/src/loyalty-card';

const storageKey = 'sadel.customer';
const money = (amount: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(amount);

type LoyaltyHistoryItem = {
  sequence: number; goal: number; stamps: number; rewardDescription: string;
  rewardKind: string; rewardValue: number | null; completedAt: string | null;
  redeemed: boolean; reserved: boolean;
};

const emptyAddressForm = {
  street: '', number: '', apartment: '', neighborhood: '', city: '',
  state: '', zipCode: '', country: 'MX', reference: '', latitude: '', longitude: '',
};

function profileInitials(name: string, phone: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (phone || '?').replace(/\D/g, '').slice(-2) || '?';
}

function memberSinceLabel(createdAt?: string): string {
  if (!createdAt) return 'Miembro de WingsLab';
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return 'Miembro de WingsLab';
  return `Miembro desde ${new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Mexico_City' }).format(date)}`;
}

function fullName(user: AuthUser | null): string {
  return [user?.name, user?.lastName].filter(Boolean).join(' ').trim() || 'Tu cuenta WingsLab';
}

function addressLabel(address: any): string {
  return [address.street, address.number].filter(Boolean).join(' ');
}

function addressDetail(address: any): string {
  return [address.neighborhood, address.city, address.state, address.zipCode].filter(Boolean).join(', ');
}
export default function CustomerAccount() {
  const [token, setToken] = useState('');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [orders, setOrders] = useState<any[]>([]);
  const [addresses, setAddresses] = useState<any[]>([]);
  const [loyalty, setLoyalty] = useState<any>(null);
  const [customerStats, setCustomerStats] = useState<{ totalOrders: number } | null>(null);
  const [showLoyaltyQr, setShowLoyaltyQr] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<{ name: string; lastName: string; photoSource: string | null }>({ name: '', lastName: '', photoSource: null });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState<any>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [section, setSection] = useState<'pedidos' | 'fidelidad' | 'perfil' | 'soporte'>('perfil');
  const [addressModalOpen, setAddressModalOpen] = useState(false);
  const [addressQuery, setAddressQuery] = useState('');
  const [addressSuggestions, setAddressSuggestions] = useState<any[]>([]);
  const [addressBusy, setAddressBusy] = useState(false);
  const [addressForm, setAddressForm] = useState({ ...emptyAddressForm });
  const [savingAddress, setSavingAddress] = useState(false);
  const [deletingAddressId, setDeletingAddressId] = useState<string | null>(null);
  const [addressError, setAddressError] = useState('');
  const [loyaltyError, setLoyaltyError] = useState(false);
  const apiBase = getWingslabApiUrl();
  const orderSummary = useMemo(() => {
    const completed = orders.filter((order: any) => ['DELIVERED', 'COMPLETED', 'PICKED_UP'].includes(order.status));
    const active = orders.filter((order: any) => ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'IN_TRANSIT'].includes(order.status));
    return { completed: completed.length, active: active.length };
  }, [orders]);
  useEffect(() => {
    const sync = () => { const hash = window.location.hash.slice(1); setSection(hash === 'pedidos' || hash === 'fidelidad' || hash === 'soporte' ? hash : 'perfil'); window.scrollTo(0, 0); };
    sync(); window.addEventListener('hashchange', sync); return () => window.removeEventListener('hashchange', sync);
  }, []);
  useEffect(() => {
    const saved = readStoredSession(storageKey);
    if (saved?.token) { setToken(saved.token); setUser(saved.user); }
  }, []);
  // El perfil completo (apellido, foto y fecha real) vive en /customer/profile;
  // el login solo entrega un subconjunto. Una sola fuente de verdad: `user`.
  useEffect(() => {
    if (!token) return;
    let active = true;
    void requestJson<any>({ apiBase, path: '/customer/profile', token })
      .then(result => {
        if (!active) return;
        const profileUser = result.data?.user;
        if (profileUser) {
          setUser(current => current ? {
            ...current,
            name: profileUser.name ?? current.name,
            lastName: profileUser.lastName ?? current.lastName,
            phone: profileUser.phone ?? current.phone,
            profilePhoto: profileUser.profilePhoto ?? null,
            createdAt: profileUser.createdAt ?? current.createdAt,
          } : current);
        }
        setCustomerStats({ totalOrders: Number(result.data?.totalOrders) || 0 });
      })
      .catch(() => {});
    return () => { active = false; };
  }, [apiBase, token]);
  useEffect(() => {
    if (!token) return;
    let active = true;
    const load = async () => {
      try {
        const [result, addressResult] = await Promise.all([
          requestJson<any>({ apiBase, path: '/me/pedidos?limit=100', token }),
          requestJson<any>({ apiBase, path: '/customer/addresses', token }),
        ]);
        if (active) { setOrders(result.data.items || result.data.orders || result.data); setAddresses(addressResult.data); setError(''); }
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
    if (!token) { setLoyalty(null); setLoyaltyError(false); return; }
    let active = true;
    void requestJson<any>({ apiBase, path: '/customer/lealtad', token }).then(result => { if (active) { setLoyalty(result.data); setLoyaltyError(false); } }).catch(() => { if (active) setLoyaltyError(true); });
    return () => { active = false; };
  }, [apiBase, token]);
  useEffect(() => {
    if (!detailOpen || !selected || !token) return;
    let active = true;
    setDetail(null);
    void requestJson<any>({ apiBase, path: `/me/pedidos/${selected}`, token }).then(r => { if (active) setDetail(r.data); }).catch(() => { if (active) setError('No se pudo cargar el pedido.'); });
    return () => { active = false; };
  }, [apiBase, token, selected, detailOpen, orders]);

  const placesSourceRef = useRef<ReturnType<typeof createPlacesSource> | null>(null);
  useEffect(() => () => placesSourceRef.current?.cancel(), []);

  const searchAddresses = (query: string) => {
    setAddressQuery(query);
    if (!placesSourceRef.current) placesSourceRef.current = createPlacesSource();
    placesSourceRef.current.search(query, {
      onResults: setAddressSuggestions,
      onBusy: setAddressBusy,
    });
  };

  const selectAddressSuggestion = async (suggestion: any) => {
    const google = await waitForGoogleMaps();
    if (!google?.maps?.places || !suggestion.place_id) {
      setAddressError('No se pudo consultar el lugar. Intenta de nuevo.');
      return;
    }
    const service = new google.maps.places.PlacesService(document.createElement('div'));
    service.getDetails({
      placeId: suggestion.place_id,
      fields: ['address_components', 'geometry', 'formatted_address'],
    }, (place: any, status: any) => {
      if (status !== google.maps.places.PlacesServiceStatus.OK || !place?.geometry?.location) {
        setAddressError('No se pudo obtener la dirección. Intenta con otra.');
        return;
      }
      const component = (types: string[]) => place.address_components?.find((c: any) => c.types.some((t: string) => types.includes(t)))?.long_name || '';
      setAddressForm((current) => ({
        ...current,
        street: component(['route']) || suggestion.description || suggestion.name || '',
        number: component(['street_number']),
        neighborhood: component(['sublocality', 'neighborhood']),
        city: component(['locality']),
        state: component(['administrative_area_level_1']),
        zipCode: component(['postal_code']),
        country: component(['country']) || 'México',
        latitude: String(place.geometry.location.lat()),
        longitude: String(place.geometry.location.lng()),
      }));
      setAddressQuery(suggestion.description || suggestion.name || '');
      setAddressSuggestions([]);
      setAddressError('');
    });
  };

  const openAddressModal = () => {
    setAddressForm({ ...emptyAddressForm });
    setAddressQuery('');
    setAddressSuggestions([]);
    setAddressError('');
    setAddressModalOpen(true);
  };

  const saveAddress = async () => {
    if (!token || savingAddress) return;
    if (!addressForm.street.trim() || !addressForm.number.trim() || !addressForm.latitude || !addressForm.longitude) {
      setAddressError('Busca y selecciona una dirección en el mapa.');
      return;
    }
    setSavingAddress(true);
    setAddressError('');
    try {
      const result = await requestJson<any>({
        apiBase, path: '/customer/addresses', token,
        options: {
          method: 'POST',
          body: JSON.stringify({
            street: addressForm.street.trim(), number: addressForm.number.trim(),
            apartment: addressForm.apartment.trim() || undefined,
            neighborhood: addressForm.neighborhood.trim() || 'Colonia',
            city: addressForm.city.trim() || 'Ciudad', state: addressForm.state.trim() || 'Estado',
            zipCode: addressForm.zipCode.trim() || '00000', country: addressForm.country.trim() || 'MX',
            reference: addressForm.reference.trim() || undefined,
            latitude: Number(addressForm.latitude), longitude: Number(addressForm.longitude),
            isDefault: addresses.length === 0,
          }),
        },
        fallbackMessage: 'No se pudo guardar la dirección.',
      });
      setAddresses((current: any[]) => [result.data, ...current]);
      setAddressModalOpen(false);
    } catch (e) {
      setAddressError(e instanceof Error ? e.message : 'No se pudo guardar la dirección.');
    } finally {
      setSavingAddress(false);
    }
  };

  const removeAddress = async (id: string) => {
    if (!token || deletingAddressId) return;
    setDeletingAddressId(id);
    try {
      await requestJson<any>({ apiBase, path: `/customer/addresses/${id}`, token, options: { method: 'DELETE' }, fallbackMessage: 'No se pudo eliminar la dirección.' });
      setAddresses((current: any[]) => current.filter((address) => address.id !== id));
    } catch {
      setError('No se pudo eliminar la dirección. Intenta de nuevo.');
    } finally {
      setDeletingAddressId(null);
    }
  };

  const logout = () => {
    clearStoredSession(storageKey);
    setToken(''); setUser(null); setOrders([]); setAddresses([]);
  };

  const openProfileEditor = () => {
    setEditForm({ name: user?.name || '', lastName: user?.lastName || '', photoSource: null });
    setEditError('');
    setEditOpen(true);
  };

  const pickProfilePhoto = async (file?: File) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setEditError('Selecciona un PNG, JPG o WebP de hasta 2 MiB.');
      return;
    }
    setEditError('');
    try {
      const source = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      setEditForm(current => ({ ...current, photoSource: source }));
    } catch {
      setEditError('No se pudo leer la imagen. Intenta con otra.');
    }
  };

  const saveProfile = async () => {
    if (!token || editSaving || !user) return;
    const name = editForm.name.trim();
    const lastName = editForm.lastName.trim();
    if (!name) { setEditError('Escribe tu nombre.'); return; }
    setEditSaving(true);
    setEditError('');
    try {
      let profilePhoto: string | undefined;
      if (editForm.photoSource) {
        const uploaded = await requestJson<any>({
          apiBase, path: '/uploads/images', token,
          options: { method: 'POST', body: JSON.stringify({ kind: 'customer-avatar', source: editForm.photoSource, fileName: 'avatar' }) },
          fallbackMessage: 'No se pudo subir la foto.',
        });
        profilePhoto = uploaded.data?.url;
      }
      const result = await requestJson<any>({
        apiBase, path: '/customer/profile', token,
        options: { method: 'PATCH', body: JSON.stringify({ name, lastName: lastName || null, ...(profilePhoto ? { profilePhoto } : {}) }) },
        fallbackMessage: 'No se pudo guardar el perfil.',
      });
      const updated = result.data;
      const next: AuthUser = {
        ...user,
        name: updated.name,
        lastName: updated.lastName,
        phone: updated.phone,
        profilePhoto: updated.profilePhoto,
      };
      setUser(next);
      persistStoredSession({ storageKey, apiBase, token, user: next });
      setEditOpen(false);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'No se pudo guardar el perfil.');
    } finally {
      setEditSaving(false);
    }
  };

  return <main className="wl-account wl-page-shell min-h-screen text-[#211c18]">
    <PageHeader />
    <div className={`mx-auto max-w-3xl space-y-6 px-4 py-6 pb-32 ${section === 'perfil' ? 'wl-profile-content' : section === 'pedidos' ? 'wl-orders-content' : section === 'fidelidad' ? 'wl-fidelity-content' : ''}`}>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {!token ? <div className="wl-premium-empty"><h2>Tu espacio en WingsLab</h2><p>Inicia sesión para consultar {section === 'pedidos' ? 'tus pedidos' : section === 'soporte' ? 'tus reportes y pedir ayuda' : section === 'fidelidad' ? 'tu fidelidad' : 'tu perfil'}.</p><button className="wl-primary-action" onClick={() => setAuthOpen(true)}>Iniciar sesión</button></div> : <>
        {section === 'soporte' && <CustomerSupport token={token} orders={orders} />}
        {section === 'fidelidad' && <>
          {loyaltyError ? <p role="alert" className="wl-fidelity-message">No se pudo consultar el programa de fidelidad.</p>
          : !loyalty ? <p role="status" className="wl-fidelity-message">Consultando tu tarjeta…</p>
          : !loyalty.enabled && !loyalty.redemptionEnabled ? <div className="wl-fidelity-card wl-premium-empty"><Award aria-hidden="true" /><h3>Programa no disponible</h3><p>El restaurante aún no ha activado su tarjeta de fidelidad.</p></div>
          : <>
            {!loyalty.enabled && <p role="status" className="wl-fidelity-note">Programa en pausa. Tus sellos y premios se conservan.</p>}

            {/* Progreso fuera de la tarjeta, claro y confiable */}
            <div className="wl-loyalty-progress-panel">
              <div className="wl-loyalty-progress-top">
                <div>
                  <span className="wl-kicker">Tu progreso</span>
                  <h2>{loyalty.stamps} de {loyalty.stampGoal} compras</h2>
                </div>
                <span className="wl-loyalty-progress-badge">
                  {Math.min(100, Math.round((loyalty.stamps / Math.max(1, loyalty.stampGoal)) * 100))}%
                </span>
              </div>
              <div className="wl-loyalty-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={loyalty.stampGoal} aria-valuenow={loyalty.stamps}>
                <span style={{ width: `${Math.min(100, (loyalty.stamps / Math.max(1, loyalty.stampGoal)) * 100)}%` }} />
              </div>
              <p className="wl-loyalty-progress-copy">
                {loyalty.stamps >= loyalty.stampGoal
                  ? '¡Tarjeta completa! Tu recompensa está lista.'
                  : `Te faltan ${loyalty.stampGoal - loyalty.stamps} ${loyalty.stampGoal - loyalty.stamps === 1 ? 'compra' : 'compras'} para tu recompensa.`}
              </p>
            </div>

            <div className="wl-fidelity-card">
              {loyalty.enabled ? (showLoyaltyQr ? <LoyaltyQrPanel onClose={() => setShowLoyaltyQr(false)} /> : <button type="button" className="wl-loyalty-qr-trigger" onClick={() => setShowLoyaltyQr(true)}><QrCode aria-hidden="true" /><span><strong>Compraste en el local</strong><small>Muestra tu código para que te pongan un sello</small></span></button>) : <p className="wl-loyalty-paused">El código QR estará disponible cuando el restaurante reactive el programa.</p>}
              <LoyaltyCard logoUrl={loyalty.brand?.logo || officialLogo.src} fallbackLogoUrl={officialLogo.src} name={loyalty.brand?.name} logoOnDark={!loyalty.brand?.logo} goal={loyalty.stampGoal} stamps={loyalty.stamps} reward={loyalty.rewardDescription} terms={loyalty.stampTerms} />
            </div>

            {/* Recompensa fuera de la tarjeta, con el estilo del footer de la card */}
            <section className="wl-reward-feature" aria-label="Tu recompensa">
              <span className="wl-reward-feature-icon"><Gift aria-hidden="true" /></span>
              <div className="min-w-0">
                <small className="wl-reward-feature-kicker">Tu recompensa</small>
                <b className="wl-reward-feature-value">{loyalty.rewardDescription || 'Tu próxima recompensa'}</b>
              </div>
            </section>

            {/* Historial de tarjetas / recompensas obtenidas */}
            <section className="wl-loyalty-history" aria-label="Historial de recompensas">
              <header className="wl-loyalty-history-head">
                <div><span className="wl-kicker">Tu historial</span><h3>Recompensas obtenidas</h3></div>
                {!!loyalty.completedCount && <span className="wl-loyalty-history-count">{loyalty.completedCount} en total</span>}
              </header>
              {Array.isArray(loyalty.history) && loyalty.history.length > 0 ? (
                <div className="wl-loyalty-history-list">
                  {loyalty.history.map((item: LoyaltyHistoryItem) => (
                    <article key={item.sequence} className="wl-loyalty-history-item">
                      <span className={`wl-loyalty-history-icon ${item.redeemed ? 'is-redeemed' : ''}`}><Award aria-hidden="true" /></span>
                      <div className="min-w-0">
                        <strong>{item.rewardDescription || 'Recompensa WingsLab'}</strong>
                        <p>
                          Tarjeta #{item.sequence} · {item.stamps} de {item.goal} compras
                          {item.completedAt ? ` · ${new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Mexico_City' }).format(new Date(item.completedAt))}` : ''}
                        </p>
                      </div>
                      <span className={`wl-loyalty-history-status ${item.redeemed ? 'is-redeemed' : item.reserved ? 'is-reserved' : ''}`}>
                        {item.redeemed ? 'Obtenida' : item.reserved ? 'En uso' : 'Disponible'}
                      </span>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="wl-loyalty-history-empty"><Award aria-hidden="true" /><p>Cuando completes tu primera tarjeta, aquí verás el registro de tu recompensa.</p></div>
              )}
            </section>

            <section className="wl-card-explanation"><h3>¿Cómo funciona?</h3><p>Un pedido completado equivale a un sello. No cuentan cancelaciones ni pedidos en reparto. El premio se aplica en la compra que completa la tarjeta.</p>{loyalty.reserved && <p>Tu premio está reservado en un pedido en curso. Si se cancela o rechaza, vuelve a estar disponible.</p>}<p>{loyalty.redemptionEnabled ? 'El carrito valida disponibilidad, muestra el descuento o agrega el producto de regalo automáticamente. Solo se usa una recompensa por pedido.' : 'El restaurante debe terminar de configurar el beneficio para habilitar el canje. Tus compras registradas se conservan.'}</p></section>
          </>}
        </>}
        {section === 'perfil' && <>
          <div className="wl-profile-grid">
            <div className="wl-profile-main">
              <section className="wl-profile-card wl-profile-hero" aria-label="Datos de tu cuenta">
                <span className="wl-profile-hero-glow wl-profile-hero-glow--one" aria-hidden="true" />
                <span className="wl-profile-hero-glow wl-profile-hero-glow--two" aria-hidden="true" />
                <div className="relative">
                  <div className="wl-profile-hero-top">
                    <div className="wl-profile-avatar-wrap">
                      <div className="wl-profile-avatar">
                        {user?.profilePhoto ? <img src={user.profilePhoto} alt="" /> : <span>{profileInitials(fullName(user), user?.phone || '')}</span>}
                      </div>
                      <label className="wl-profile-avatar-camera" aria-label="Cambiar foto de perfil">
                        <Camera aria-hidden="true" />
                        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void pickProfilePhoto(file).then(() => setEditOpen(true)); event.target.value = ''; }} />
                      </label>
                    </div>
                    <div className="wl-profile-hero-identity">
                      <p className="wl-profile-hero-kicker">Tu cuenta WingsLab</p>
                      <h2>{fullName(user)}</h2>
                      <p className="wl-profile-member"><Star aria-hidden="true" />{memberSinceLabel(user?.createdAt)}</p>
                    </div>
                  </div>
                  <div className="wl-profile-facts">
                    <div className="wl-profile-fact">
                      <span className="wl-profile-fact-icon"><Smartphone aria-hidden="true" /></span>
                      <div><span>Teléfono</span><strong>{user?.phone || '—'}</strong></div>
                    </div>
                    <div className="wl-profile-fact">
                      <span className="wl-profile-fact-icon"><PackageCheck aria-hidden="true" /></span>
                      <div><span>Pedidos realizados</span><strong>{customerStats ? customerStats.totalOrders : '—'}</strong></div>
                    </div>
                  </div>
                  <button type="button" className="wl-profile-cta" onClick={openProfileEditor}><Pencil aria-hidden="true" /> Editar perfil</button>
                </div>
              </section>

              <section className="wl-profile-card" aria-label="Mis direcciones">
                <header className="wl-profile-card-head">
                  <div className="wl-profile-card-title"><span className="wl-profile-card-icon"><MapPin aria-hidden="true" /></span><h3>Mis direcciones</h3></div>
                </header>
                <div className="wl-profile-list">
                  {addresses.length ? addresses.map((address: any) => (
                    <div key={address.id} className="wl-profile-address">
                      <span className="wl-profile-address-icon"><MapPin aria-hidden="true" /></span>
                      <div className="min-w-0 flex-1">
                        <p className="wl-profile-address-title">{addressLabel(address)}</p>
                        <p className="wl-profile-address-detail">{addressDetail(address)}</p>
                      </div>
                      <button type="button" className="wl-profile-icon-button" onClick={() => void removeAddress(address.id)} disabled={deletingAddressId === address.id} aria-label="Eliminar dirección">
                        {deletingAddressId === address.id ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
                      </button>
                    </div>
                  )) : <p className="wl-profile-empty">Aún no tienes direcciones guardadas.</p>}
                </div>
                <div className="wl-profile-card-foot">
                  <button type="button" className="wl-profile-add" onClick={openAddressModal}><Plus aria-hidden="true" /> Agregar nueva dirección</button>
                </div>
              </section>
            </div>

            <div className="wl-profile-side">
              <section className="wl-profile-card wl-profile-logout-card" aria-label="Sesión">
                <button type="button" className="wl-profile-logout" onClick={logout}>
                  <LogOut aria-hidden="true" /> Cerrar sesión de forma segura
                </button>
              </section>
            </div>
          </div>
        </>}
        {section === 'pedidos' && <>
          <section className="wl-orders-dashboard" aria-label="Resumen de tus pedidos">
            <div className="wl-orders-dashboard-head">
              <span className="wl-orders-dashboard-icon"><ReceiptText aria-hidden="true" /></span>
              <div>
                <p>WingsLab · Tu actividad</p>
                <h1>Historial de pedidos</h1>
              </div>
            </div>
            <div className="wl-orders-dashboard-grid">
              <div><span>En curso</span><strong>{orderSummary.active}</strong></div>
              <div><span>Completados</span><strong>{orderSummary.completed}</strong></div>
            </div>
          </section>
          <div id="pedidos"><OrdersView sortedOrders={orders} visibleOrdersCount={100} setSelectedOrderId={setSelected} setIsDetailModalOpen={setDetailOpen} formatCurrency={money} formatDate={s => new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Mexico_City' }).format(new Date(s))} StatusBadge={({ status }) => <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-800">{getOrderStatusLabel(status)}</span>} showLoadMore={false} loadMoreOrders={() => {}} /></div>
        </>}
      </>}
    </div>
    {!authOpen && !detailOpen && <CustomerNavigation active={section} onAuthenticated={(nextToken, nextUser) => { setToken(nextToken); setUser(nextUser); }} onLogout={logout} />}
    {detailOpen && <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-4"><section role="dialog" aria-modal="true" aria-label="Detalle de pedido" className="mx-auto my-8 max-w-lg space-y-4 rounded-2xl bg-white p-6"><button onClick={() => setDetailOpen(false)} className="float-right">Cerrar</button><h2 className="text-xl font-bold">Tu pedido WingsLab</h2>{detail ? <><p>{getOrderStatusLabel(detail.status)}</p><p>{money(detail.totalAmount)}</p>{detail.items?.map((item: any) => <p key={item.id}>{item.quantity} × {item.product?.name || item.productName}</p>)}{detail.tracking?.map((t: any) => <p key={t.id} className="text-sm text-neutral-600">{getOrderStatusLabel(t.status)}</p>)}<p className="text-xs text-neutral-500">{detail.orderReference}</p></> : <p>Cargando pedido…</p>}</section></div>}
    {addressModalOpen && (
      <div className="wl-auth fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-[fadeIn_0.2s_ease-out]" role="dialog" aria-modal="true" aria-label="Agregar dirección" onClick={() => setAddressModalOpen(false)}>
        <section className="wl-auth-sheet relative flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden" onClick={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => setAddressModalOpen(false)} className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-600 transition active:scale-95" aria-label="Cerrar"><X className="h-5 w-5" strokeWidth={2.5} /></button>
          <div className="wl-auth-scroll overflow-y-auto overflow-x-hidden flex-1">
            <div className="wl-auth-body wl-addr-body">
              <div className="wl-auth-intro"><h3>Nueva dirección</h3><p>Busca tu calle para agregarla a tus direcciones.</p></div>
              <div className="wl-addr-fields">
                <label className="wl-auth-field grid gap-1.5">
                  <span>Buscar dirección</span>
                  <div className="relative">
                    <span className="wl-auth-field-icon" aria-hidden="true"><Search /></span>
                    <input type="search" value={addressQuery} onChange={(event) => searchAddresses(event.target.value)} placeholder="Calle, número, colonia…" autoComplete="off" />
                  </div>
                  {addressBusy && <small>Buscando…</small>}
                  {addressSuggestions.length > 0 && (
                    <div className="wl-profile-suggestions">
                      {addressSuggestions.map((suggestion: any) => (
                        <button type="button" key={suggestion.place_id || suggestion.id} onClick={() => void selectAddressSuggestion(suggestion)}>
                          <MapPin aria-hidden="true" /><span>{suggestion.description || suggestion.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </label>
                <div className="wl-addr-row">
                  <label className="wl-auth-field grid gap-1.5"><span>Calle</span><div className="relative"><span className="wl-auth-field-icon" aria-hidden="true"><MapPin /></span><input value={addressForm.street} onChange={(e) => setAddressForm({ ...addressForm, street: e.target.value })} placeholder="Calle" /></div></label>
                  <label className="wl-auth-field grid gap-1.5"><span>Número</span><div className="relative"><span className="wl-auth-field-icon" aria-hidden="true"><MapPin /></span><input value={addressForm.number} onChange={(e) => setAddressForm({ ...addressForm, number: e.target.value })} placeholder="123" /></div></label>
                </div>
                <label className="wl-auth-field grid gap-1.5"><span>Colonia <small>(se completa al buscar)</small></span><div className="relative"><span className="wl-auth-field-icon" aria-hidden="true"><MapPin /></span><input value={addressForm.neighborhood} onChange={(e) => setAddressForm({ ...addressForm, neighborhood: e.target.value })} placeholder="Colonia" /></div></label>
                <label className="wl-auth-field grid gap-1.5"><span>Referencia <small>(opcional)</small></span><div className="relative"><span className="wl-auth-field-icon" aria-hidden="true"><MapPin /></span><input value={addressForm.reference} onChange={(e) => setAddressForm({ ...addressForm, reference: e.target.value })} placeholder="Ej. Casa azul, portón negro, entre calles…" /></div></label>
              </div>
              <p className="wl-auth-hint">Selecciona una sugerencia para completar calle, número, colonia y ubicación.</p>
              {addressError && <p role="alert" className="wl-auth-error">{addressError}</p>}
              <div className="wl-addr-actions">
                <button type="button" onClick={() => setAddressModalOpen(false)} className="wl-addr-cancel">Cancelar</button>
                <button type="button" onClick={() => void saveAddress()} disabled={savingAddress} className="wl-addr-save">{savingAddress ? <Loader2 className="mx-auto animate-spin" aria-hidden="true" /> : null}{savingAddress ? 'Guardando…' : 'Guardar dirección'}</button>
              </div>
            </div>
          </div>
        </section>
      </div>
    )}
    {editOpen && (
      <div className="wl-auth fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-[fadeIn_0.2s_ease-out]" role="dialog" aria-modal="true" aria-label="Editar perfil" onClick={() => setEditOpen(false)}>
        <section className="wl-auth-sheet relative flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden" onClick={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => setEditOpen(false)} className="absolute right-5 top-5 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-600 transition active:scale-95" aria-label="Cerrar modal de autenticación"><X className="h-5 w-5" strokeWidth={2.5} /></button>
          <div className="wl-auth-scroll overflow-y-auto overflow-x-hidden flex-1">
            <div className="wl-auth-brand"><img src={officialLogo.src} alt="WingsLab" width={783} height={229} /></div>
            <div className="wl-auth-body">
              <div className="wl-auth-intro"><h3>Editar perfil</h3><p>Actualiza tus datos y tu foto.</p></div>
              <div className="wl-edit-photo">
                <div className="wl-profile-avatar wl-profile-avatar--edit">
                  {editForm.photoSource || user?.profilePhoto
                    ? <img src={editForm.photoSource || user?.profilePhoto || ''} alt="" />
                    : <span>{profileInitials(fullName(user), user?.phone || '')}</span>}
                  <label className="wl-profile-avatar-camera" aria-label="Cambiar foto de perfil"><Camera aria-hidden="true" /><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void pickProfilePhoto(event.target.files?.[0])} /></label>
                </div>
                <small>Toca la cámara para elegir una foto · PNG, JPG o WebP · máximo 2 MiB.</small>
              </div>
              <div className="mt-6 grid gap-3">
                <label className="wl-auth-field grid gap-1.5"><span>Nombre</span><div className="relative"><span className="wl-auth-field-icon" aria-hidden="true"><UserRound /></span><input value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} placeholder="Tu nombre" /></div></label>
                <label className="wl-auth-field grid gap-1.5"><span>Apellido</span><div className="relative"><span className="wl-auth-field-icon" aria-hidden="true"><UserRound /></span><input value={editForm.lastName} onChange={(event) => setEditForm({ ...editForm, lastName: event.target.value })} placeholder="Tu apellido" /></div></label>
              </div>
              <p className="wl-auth-hint">Tu teléfono se usa para iniciar sesión y no se puede cambiar aquí.</p>
              {editError && <p role="alert" className="wl-auth-error">{editError}</p>}
              <div className="mt-6 grid gap-2">
                <button type="button" onClick={() => void saveProfile()} disabled={editSaving} className="bg-neutral-950">{editSaving ? <Loader2 className="mx-auto animate-spin" aria-hidden="true" /> : null}{editSaving ? 'Guardando…' : 'Guardar cambios'}</button>
                <button type="button" onClick={() => setEditOpen(false)} className="min-h-12 rounded-2xl border border-[var(--wl-border)] font-bold text-[var(--wl-text)]">Cancelar</button>
              </div>
            </div>
          </div>
        </section>
      </div>
    )}
    <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} apiBase={apiBase} onSuccess={(nextToken, nextUser) => { persistStoredSession({ storageKey, apiBase, token: nextToken, user: nextUser }); setToken(nextToken); setUser(nextUser); setAuthOpen(false); }} />
  </main>;
}
