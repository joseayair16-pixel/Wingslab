'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { io } from 'socket.io-client';
import { MapPin, Plus, Search, Star, Trash2, LogOut, X, Loader2, Pencil, Camera, Smartphone, PackageCheck, ReceiptText, QrCode, Gift, Award, UserRound } from 'lucide-react';
import { getWingslabApiUrl, getWingslabSocketUrl, getOrderStatusLabel, readStoredSession, persistStoredSession, requestJson, clearStoredSession, forceSessionExpired, handleSocketUnauthorized, setGlobalSessionExpiredHandler, type AuthUser } from '@sadel/shared';
import { AuthModal } from '../../components/AuthModal';
import { OrdersView } from '../../views/OrdersView';
import { CustomerNavigation } from '../../components/CustomerNavigation';
import { CustomerSupport } from '../../components/CustomerSupport';
import { PageHeader } from '../../components/PageHeader';
import { LoyaltyQrPanel } from '../../components/LoyaltyQrPanel';
import { createPlacesSource, fetchSelectedPlaceFields, type PlacesSuggestion } from '../../lib/places';
import { ensureGoogleMapsScript } from '../../lib/googleMaps';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import { PushActivationButton } from '../../components/PushActivationButton';
import { revokeCustomerPush } from '../../lib/revokeCustomerPush';
import officialLogo from '../../assets/wingslab-wordmark.png';
import { LoyaltyCard } from '../../../../shared/src/loyalty-card';

const storageKey = 'sadel.customer';

function OrderNotificationSettings({ token }: { token: string }) {
  const { isSubscribed, subscribe, needsIosInstall, pushSupportIssue } = usePushNotifications();

  return <section className="wl-profile-card p-4" aria-label="Notificaciones de pedidos">
    <h2 className="font-bold">Notificaciones de pedidos</h2>
    <p className="mt-1 text-sm" role="status">{isSubscribed ? 'Activadas en este dispositivo.' : needsIosInstall ? 'Añade WingsLab a la pantalla de inicio y ábrelo desde allí para activar los avisos.' : pushSupportIssue || 'Recibe avisos de tus pedidos aunque no tengas WingsLab abierto.'}</p>
    {!isSubscribed && !needsIosInstall && !pushSupportIssue && <PushActivationButton activate={() => subscribe(token)} className="wl-profile-add mt-2 min-h-11" />}
  </section>;
}
const moneyFormatter = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const money = (amount: number) => moneyFormatter.format(amount);
const orderDateFormatter = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Mexico_City' });
function formatOrderDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? orderDateFormatter.format(date) : 'Fecha no disponible';
}

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

function RewardImage({ src }: { src?: string | null }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  if (!src || failed) return <span className="wl-reward-feature-icon"><Gift aria-hidden="true" /></span>;
  return <span className="wl-reward-feature-image-wrap" aria-hidden="true">
    {!loaded && <Gift className="wl-reward-feature-placeholder" />}
    <img src={src} alt="" className={`wl-reward-feature-image ${loaded ? 'is-loaded' : ''}`} decoding="async" fetchPriority="high" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
  </span>;
}

function AddressPinMap({ latitude, longitude, onChange }: { latitude: number; longitude: number; onChange: (latitude: number, longitude: number) => void }) {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const onChangeRef = useRef(onChange);
  const positionRef = useRef({ lat: latitude, lng: longitude });
  const [unavailable, setUnavailable] = useState(false);
  onChangeRef.current = onChange;
  positionRef.current = { lat: latitude, lng: longitude };

  useEffect(() => {
    let active = true;
    let listeners: any[] = [];
    void ensureGoogleMapsScript().then(google => {
      if (!active) return;
      if (!google?.maps || !elementRef.current) { setUnavailable(true); return; }
      const map = new google.maps.Map(elementRef.current, { center: positionRef.current, zoom: 17, streetViewControl: false, mapTypeControl: false, fullscreenControl: false });
      const marker = new google.maps.Marker({ map, position: positionRef.current, draggable: true, title: 'Ubicación de entrega' });
      mapRef.current = map;
      markerRef.current = marker;
      const update = (position: any) => {
        if (position) onChangeRef.current(position.lat(), position.lng());
      };
      listeners = [map.addListener('click', (event: any) => update(event.latLng)), marker.addListener('dragend', (event: any) => update(event.latLng))];
    }).catch(() => { if (active) setUnavailable(true); });
    return () => {
      active = false;
      listeners.forEach(listener => listener.remove());
      markerRef.current?.setMap(null);
      markerRef.current = null;
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const position = { lat: latitude, lng: longitude };
    markerRef.current?.setPosition(position);
    mapRef.current?.panTo(position);
  }, [latitude, longitude]);

  return <div className="wl-addr-map-section">
    <span className="wl-addr-map-label">Ubicación de entrega</span>
    <div ref={elementRef} role="region" aria-label="Mapa para fijar la ubicación de entrega" className="wl-addr-map" />
    <p className="wl-addr-map-hint">{unavailable ? 'No se pudo cargar el mapa. Intenta de nuevo.' : 'Arrastra el pin o toca el mapa para ajustar la ubicación exacta.'}</p>
  </div>;
}

export default function CustomerAccount() {
  const [token, setToken] = useState('');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [orders, setOrders] = useState<any[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersLoadFailed, setOrdersLoadFailed] = useState(false);
  const [ordersLimit, setOrdersLimit] = useState(12);
  const [ordersHasMore, setOrdersHasMore] = useState(false);
  const [addresses, setAddresses] = useState<any[]>([]);
  const [loyalty, setLoyalty] = useState<any>(null);
  const [selectedStamp, setSelectedStamp] = useState<{ index: number; detail: any } | null>(null);
  useEffect(() => {
    if (!selectedStamp) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelectedStamp(null); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [selectedStamp]);
  const [customerStats, setCustomerStats] = useState<{ totalOrders: number } | null>(null);
  const [showLoyaltyQr, setShowLoyaltyQr] = useState(false);
  const qrDialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (showLoyaltyQr && !qrDialogRef.current?.open) qrDialogRef.current?.showModal();
  }, [showLoyaltyQr]);
  const [loyaltyRevision, setLoyaltyRevision] = useState(0);
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
  const [addressSuggestions, setAddressSuggestions] = useState<PlacesSuggestion[]>([]);
  const [addressBusy, setAddressBusy] = useState(false);
  const [addressSelecting, setAddressSelecting] = useState(false);
  const [pinStatus, setPinStatus] = useState<'idle' | 'loading' | 'failed'>('idle');
  const [addressViewport, setAddressViewport] = useState<{ top: number; height: number } | null>(null);
  const [addressForm, setAddressForm] = useState({ ...emptyAddressForm });
  const [savingAddress, setSavingAddress] = useState(false);
  const [deletingAddressId, setDeletingAddressId] = useState<string | null>(null);
  const [addressToDelete, setAddressToDelete] = useState<{ id: string; label: string } | null>(null);
  const [deleteAddressError, setDeleteAddressError] = useState('');
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
  // Un refresh silencioso de requestJson renueva el token en localStorage pero
  // no el estado React. Sin esto, las llamadas y el socket de esta vista siguen
  // usando el token viejo hasta recargar la página.
  useEffect(() => {
    const onTokenRefreshed = (event: Event) => {
      const nextToken = (event as CustomEvent<string>).detail;
      if (nextToken) setToken(nextToken);
    };
    window.addEventListener('sadel:token-refreshed', onTokenRefreshed);
    return () => window.removeEventListener('sadel:token-refreshed', onTokenRefreshed);
  }, []);
  // Mismo cierre de sesión global que el storefront: un 401 irrecuperable o un
  // socket rechazado deben limpiar esta vista, no dejarla con datos obsoletos.
  useEffect(() => {
    setGlobalSessionExpiredHandler(() => {
      clearStoredSession(storageKey);
      setToken(''); setUser(null); setOrders([]); setAddresses([]);
      setLoyalty(null); setAuthOpen(true);
    });
    return () => setGlobalSessionExpiredHandler(null);
  }, []);
  // El perfil completo (apellido, foto y fecha real) vive en /customer/profile;
  // el login solo entrega un subconjunto. Una sola fuente de verdad: `user`.
  useEffect(() => {
    if (!token || section !== 'perfil') return;
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
  }, [apiBase, token, section]);
  useEffect(() => {
    if (!token || section !== 'perfil') return;
    let active = true;
    void requestJson<any>({ apiBase, path: '/customer/addresses', token })
      .then(result => { if (active) setAddresses(result.data); })
      .catch(() => { if (active) setError('No se pudieron consultar tus direcciones.'); });
    return () => { active = false; };
  }, [apiBase, token, section]);
  useEffect(() => {
    if (!token || section !== 'pedidos') return;
    let active = true;
    let ordersInFlight = false;
    let ordersRefreshPending = false;
    const load = async () => {
      if (!active) return;
      // No descartar indefinidamente una respuesta lenta por nuevas consultas.
      if (ordersInFlight) { ordersRefreshPending = true; return; }
      ordersInFlight = true;
      try {
        const result = await requestJson<any>({ apiBase, path: `/me/pedidos?limit=${ordersLimit}`, token });
        if (active) { setOrders(result.data.items); setOrdersHasMore(result.data.hasMore === true); setOrdersLoadFailed(false); }
      } catch { if (active) setOrdersLoadFailed(true); }
      finally {
        ordersInFlight = false;
        if (active) {
          setOrdersLoading(false);
          if (ordersRefreshPending) { ordersRefreshPending = false; void load(); }
        }
      }
    };
    void load();
    // Leer el token de localStorage en cada intento evita reconectar con el
    // access token viejo después de una rotación.
    const getSocketToken = () => readStoredSession(storageKey).token || token;
    const socket = io(getWingslabSocketUrl(), {
      auth: { token: getSocketToken() },
      transports: ['websocket', 'polling'],
      reconnection: true,
    });
    const handleReconnectAttempt = () => { socket.auth = { token: getSocketToken() }; };
    socket.io.on('reconnect_attempt', handleReconnectAttempt);
    socket.on('connect_error', (err) => {
      if (!String((err as Error)?.message || '').includes('UNAUTHORIZED')) return;
      socket.disconnect();
      void handleSocketUnauthorized({
        apiBase,
        storageKey,
        socket,
        isActive: () => active,
        onLoggedOut: () => forceSessionExpired(),
      });
    });
    const refreshVisible = () => { if (document.visibilityState === 'visible') void load(); };
    let connectedBefore = false;
    socket.on('connect', () => {
      socket.emit('join-room');
      if (connectedBefore) refreshVisible();
      connectedBefore = true;
    });
    for (const event of ['order:accepted', 'order:preparing', 'order:ready', 'order:in-transit', 'order:driver-arrived', 'order:delivered', 'order:rejected', 'order:cancelled']) socket.on(event, refreshVisible);
    const timer = window.setInterval(refreshVisible, 30000);
    document.addEventListener('visibilitychange', refreshVisible);
    window.addEventListener('online', refreshVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshVisible);
      window.removeEventListener('online', refreshVisible);
      socket.io.off('reconnect_attempt', handleReconnectAttempt);
      socket.disconnect();
    };
  }, [apiBase, token, section, ordersLimit]);
  useEffect(() => {
    if (!token) { setLoyalty(null); setLoyaltyError(false); return; }
    if (section !== 'fidelidad') return;
    let active = true;
    void requestJson<any>({ apiBase, path: '/customer/lealtad', token }).then(result => {
      if (!active) return;
      if (result.data?.rewardKind === 'PRODUCT' && result.data.rewardProductImage) {
        // Adelantar la descarga aunque el usuario todavía no abra Fidelidad.
        const image = new Image();
        image.src = result.data.rewardProductImage;
      }
      setLoyalty(result.data);
      setLoyaltyError(false);
    }).catch(() => { if (active) setLoyaltyError(true); });
    return () => { active = false; };
  }, [apiBase, token, section, loyaltyRevision]);
  const selectedOrderStatus = orders.find(order => order.id === selected)?.status;
  useEffect(() => {
    if (!detailOpen || !selected || !token) return;
    let active = true;
    setDetail(null);
    void requestJson<any>({ apiBase, path: `/me/pedidos/${selected}`, token }).then(r => { if (active) setDetail(r.data); }).catch(() => { if (active) setError('No se pudo cargar el pedido.'); });
    return () => { active = false; };
  }, [apiBase, token, selected, detailOpen, selectedOrderStatus]);

  const placesSourceRef = useRef<ReturnType<typeof createPlacesSource> | null>(null);
  const addressSelectionRef = useRef(0);
  const pinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const numberEditedRef = useRef(false);
  useEffect(() => () => { placesSourceRef.current?.cancel(); if (pinTimerRef.current) clearTimeout(pinTimerRef.current); addressSelectionRef.current += 1; }, []);
  useEffect(() => {
    if (!addressModalOpen || !window.visualViewport) return;
    const viewport = window.visualViewport;
    const update = () => setAddressViewport({ top: viewport.offsetTop, height: viewport.height });
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => { viewport.removeEventListener('resize', update); viewport.removeEventListener('scroll', update); };
  }, [addressModalOpen]);

  const cancelPinLookup = () => {
    if (pinTimerRef.current) clearTimeout(pinTimerRef.current);
    pinTimerRef.current = null;
    setPinStatus('idle');
  };

  const searchAddresses = (query: string) => {
    addressSelectionRef.current += 1;
    cancelPinLookup();
    numberEditedRef.current = false;
    setAddressSelecting(false);
    setAddressQuery(query);
    setAddressForm(current => ({ ...emptyAddressForm, reference: current.reference }));
    setAddressSuggestions([]);
    setAddressError('');
    if (!placesSourceRef.current) placesSourceRef.current = createPlacesSource();
    placesSourceRef.current.search(query, {
      onResults: setAddressSuggestions,
      onBusy: setAddressBusy,
    });
  };

  const selectAddressSuggestion = async (suggestion: PlacesSuggestion) => {
    const selection = ++addressSelectionRef.current;
    cancelPinLookup();
    numberEditedRef.current = false;
    placesSourceRef.current?.cancel();
    setAddressBusy(false);
    setAddressSelecting(true);
    setAddressSuggestions([]);
    try {
      const place = await fetchSelectedPlaceFields(suggestion, ['addressComponents', 'location', 'formattedAddress']);
      if (selection !== addressSelectionRef.current) return;
      if (!place.location) throw new Error('Place has no location');
      const component = (types: string[]) => place.addressComponents?.find((c: any) => c.types?.some((t: string) => types.includes(t)))?.longText || '';
      setAddressForm((current) => ({
        ...current,
        street: component(['route']) || place.formattedAddress || suggestion.name || '',
        number: component(['street_number']),
        neighborhood: component(['sublocality', 'neighborhood']),
        city: component(['locality']),
        state: component(['administrative_area_level_1']),
        zipCode: component(['postal_code']),
        country: component(['country']) || 'México',
        latitude: String(place.location.lat()),
        longitude: String(place.location.lng()),
      }));
      setAddressQuery(place.formattedAddress || suggestion.name || '');
      setAddressSuggestions([]);
      setAddressError('');
    } catch {
      if (selection === addressSelectionRef.current) setAddressError('No se pudo obtener la dirección. Intenta con otra.');
    } finally {
      if (selection === addressSelectionRef.current) setAddressSelecting(false);
    }
  };

  const moveAddressPin = (latitude: number, longitude: number) => {
    const selection = ++addressSelectionRef.current;
    if (pinTimerRef.current) clearTimeout(pinTimerRef.current);
    setAddressForm(current => ({ ...current, latitude: String(latitude), longitude: String(longitude) }));
    setAddressError('');
    setPinStatus('loading');
    pinTimerRef.current = setTimeout(async () => {
      pinTimerRef.current = null;
      try {
        const google = await ensureGoogleMapsScript();
        if (!google?.maps?.Geocoder) throw new Error('Geocoder unavailable');
        const result = await new google.maps.Geocoder().geocode({ location: { lat: latitude, lng: longitude } });
        if (selection !== addressSelectionRef.current) return;
        const address = result.results?.find((item: any) => item.address_components?.some((component: any) => component.types?.includes('route')));
        if (!address?.formatted_address) throw new Error('No street address found');
        const component = (types: string[]) => address.address_components?.find((item: any) => item.types?.some((type: string) => types.includes(type)))?.long_name || '';
        setAddressForm(current => ({ ...current, street: component(['route']),
          number: numberEditedRef.current ? current.number : component(['street_number']),
          neighborhood: component(['sublocality', 'neighborhood']), city: component(['locality']),
          state: component(['administrative_area_level_1']), zipCode: component(['postal_code']),
          country: component(['country']) || 'México' }));
        setAddressQuery(address.formatted_address);
        setPinStatus('idle');
      } catch {
        if (selection === addressSelectionRef.current) setPinStatus('failed');
      }
    }, 700);
  };

  const closeAddressModal = () => {
    addressSelectionRef.current += 1;
    cancelPinLookup();
    placesSourceRef.current?.cancel();
    setAddressModalOpen(false);
  };

  const openAddressModal = () => {
    addressSelectionRef.current += 1;
    cancelPinLookup();
    numberEditedRef.current = false;
    placesSourceRef.current?.cancel();
    setAddressBusy(false);
    setAddressSelecting(false);
    setAddressForm({ ...emptyAddressForm });
    setAddressQuery('');
    setAddressSuggestions([]);
    setAddressError('');
    setAddressModalOpen(true);
  };

  const saveAddress = async () => {
    if (!token || savingAddress) return;
    if (pinStatus !== 'idle') {
      setAddressError(pinStatus === 'loading' ? 'Espera a que se actualice la dirección.' : 'Selecciona otra dirección o ajusta el pin para intentar de nuevo.');
      return;
    }
    if (!addressForm.street.trim() || !addressForm.latitude || !addressForm.longitude) {
      setAddressError('Busca y selecciona una dirección de las sugerencias.');
      return;
    }
    if (!addressForm.number.trim()) {
      setAddressError('Escribe el número de domicilio o S/N si no tiene número.');
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
      closeAddressModal();
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
      setAddressToDelete(null);
    } catch {
      setDeleteAddressError('No se pudo eliminar la dirección. Intenta de nuevo.');
    } finally {
      setDeletingAddressId(null);
    }
  };

  const logout = () => {
    void revokeCustomerPush().catch(() => {});
    clearStoredSession(storageKey);
    setToken(''); setUser(null); setOrders([]); setAddresses([]);
    setOrdersLimit(12); setOrdersHasMore(false); setOrdersLoading(true); setOrdersLoadFailed(false);
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
          {loyaltyError && !loyalty ? <p role="alert" className="wl-fidelity-message">No se pudo consultar el programa de fidelidad.</p>
          : !loyalty ? <p role="status" className="wl-fidelity-message">Consultando tu tarjeta…</p>
          : !loyalty.enabled && !loyalty.redemptionEnabled ? <div className="wl-fidelity-card wl-premium-empty"><Award aria-hidden="true" /><h3>Programa no disponible</h3><p>El restaurante aún no ha activado su tarjeta de fidelidad.</p></div>
          : <>
            {loyaltyError && <p role="status" className="wl-fidelity-note">No se pudo actualizar tu tarjeta. <button type="button" className="underline" onClick={() => setLoyaltyRevision(value => value + 1)}>Reintentar</button></p>}
            {!loyalty.enabled && <p role="status" className="wl-fidelity-note">Programa en pausa. Tus sellos y premios se conservan.</p>}

            {/* Progreso fuera de la tarjeta, claro y confiable */}
            <div className="wl-loyalty-progress-panel">
              <div className="wl-loyalty-progress-top">
                <h2>Tu progreso</h2>
                <span className="wl-loyalty-progress-badge">{loyalty.stamps} <small>/ {loyalty.stampGoal} sellos</small></span>
              </div>
              <div className="wl-loyalty-progress-track" role="progressbar" aria-label="Progreso de sellos" aria-valuemin={0} aria-valuemax={loyalty.stampGoal} aria-valuenow={Math.min(loyalty.stamps, loyalty.stampGoal)}>
                <span style={{ width: `${Math.min(100, (loyalty.stamps / Math.max(1, loyalty.stampGoal)) * 100)}%` }} />
              </div>
              <p className="wl-loyalty-progress-copy">
                {loyalty.stamps >= loyalty.stampGoal
                  ? 'Recompensa disponible'
                  : `Faltan ${loyalty.stampGoal - loyalty.stamps} ${loyalty.stampGoal - loyalty.stamps === 1 ? 'sello' : 'sellos'} para tu recompensa`}
              </p>
            </div>

            <div className="wl-fidelity-card">
              <LoyaltyCard logoUrl={loyalty.brand?.logo || officialLogo.src} fallbackLogoUrl={officialLogo.src} name={loyalty.brand?.name} logoOnDark={!loyalty.brand?.logo} goal={loyalty.stampGoal} stamps={loyalty.stamps} reward={loyalty.rewardDescription} terms={loyalty.stampTerms} onStampClick={index => setSelectedStamp({ index, detail: loyalty.stampDetails?.[index] || null })} />
            </div>

            {/* Recompensa destacada y, debajo, la acción para acumular sellos. */}
            <section className="wl-reward-feature" aria-label="Tu recompensa">
              <RewardImage key={loyalty.rewardProductImage || 'gift'} src={loyalty.rewardKind === 'PRODUCT' ? loyalty.rewardProductImage : null} />
              <div className="min-w-0">
                <small className="wl-reward-feature-kicker">Tu recompensa</small>
                <b className="wl-reward-feature-value">{loyalty.rewardDescription || 'Tu próxima recompensa'}</b>
              </div>
            </section>

            {loyalty.enabled && <button type="button" className="wl-loyalty-qr-trigger" onClick={() => setShowLoyaltyQr(true)}><QrCode aria-hidden="true" /><span><strong>Mostrar QR en caja</strong><small>Recibe un sello por tu compra en el local</small></span></button>}

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
                      <button type="button" className="wl-profile-icon-button wl-profile-icon-button--delete" onClick={() => { setDeleteAddressError(''); setAddressToDelete({ id: address.id, label: addressLabel(address) }); }} disabled={!!deletingAddressId} aria-label="Eliminar dirección">
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
              {token && <OrderNotificationSettings key={user?.id} token={token} />}
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
              <div><span>En curso</span><strong>{ordersLoading ? '—' : orderSummary.active}</strong></div>
              <div><span>Completados</span><strong>{ordersLoading ? '—' : orderSummary.completed}</strong></div>
            </div>
            {ordersHasMore && <p className="mt-2 text-xs text-neutral-500 dark:text-zinc-400">Resumen de los {orders.length} pedidos cargados</p>}
          </section>
          <div id="pedidos">{ordersLoading ? <p role="status" className="wl-fidelity-message">Cargando tus pedidos…</p> : ordersLoadFailed && orders.length === 0 ? <p role="alert" className="wl-fidelity-message">No se pudieron cargar tus pedidos. Revisa tu conexión; volveremos a intentarlo.</p> : <>{ordersLoadFailed && <p role="status" className="wl-fidelity-message">No se pudieron actualizar tus pedidos. Comprueba tu conexión.</p>}<OrdersView sortedOrders={orders} visibleOrdersCount={orders.length} setSelectedOrderId={setSelected} setIsDetailModalOpen={setDetailOpen} formatCurrency={money} formatDate={formatOrderDate} StatusBadge={({ status }) => <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-800">{getOrderStatusLabel(status)}</span>} showLoadMore={ordersHasMore && ordersLimit < 100 && (orders.length >= ordersLimit || ordersLoadFailed)} loadMoreOrders={() => setOrdersLimit(limit => Math.min(100, limit + 12))} />{ordersHasMore && orders.length < ordersLimit && !ordersLoadFailed && <p role="status" className="wl-fidelity-message">Cargando más pedidos…</p>}</>}</div>
        </>}
      </>}
    </div>
    {showLoyaltyQr && loyalty && (
      <dialog
        ref={qrDialogRef}
        className="wl-loyalty-dialog wl-premium-dialog"
        aria-label="Código para compras en el local"
        onClose={() => setShowLoyaltyQr(false)}
        onClick={event => { if (event.target === event.currentTarget) qrDialogRef.current?.close(); }}
      >
        <LoyaltyQrPanel
          onClose={() => qrDialogRef.current?.close()}
          onRefresh={() => setLoyaltyRevision(value => value + 1)}
          brand={loyalty.brand}
          fallbackLogoUrl={officialLogo.src}
        />
      </dialog>
    )}
    {!authOpen && !detailOpen && !selectedStamp && !showLoyaltyQr && <CustomerNavigation active={section} onAuthenticated={(nextToken, nextUser) => { setToken(nextToken); setUser(nextUser); }} onLogout={logout} />}
    {selectedStamp && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-neutral-950/60 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-sm" onClick={() => setSelectedStamp(null)}>
      <section role="dialog" aria-modal="true" aria-labelledby="stamp-detail-title" className="max-h-full w-full max-w-sm overflow-y-auto rounded-[28px] border border-neutral-200 bg-white p-5 text-neutral-950 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 sm:p-6" onClick={event => event.stopPropagation()}>
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-neutral-950 text-white dark:bg-zinc-700"><Award aria-hidden="true" className="h-6 w-6" /></span>
          <div className="min-w-0 flex-1"><p className="text-xs font-semibold text-neutral-500 dark:text-zinc-400">Tu tarjeta de lealtad</p><h2 id="stamp-detail-title" className="mt-0.5 text-lg font-extrabold tracking-tight">Sello {selectedStamp.index + 1}</h2></div>
          <button autoFocus type="button" aria-label="Cerrar detalle del sello" onClick={() => setSelectedStamp(null)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-neutral-500 hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-600 dark:text-zinc-400 dark:hover:bg-zinc-800"><X aria-hidden="true" className="h-5 w-5" /></button>
        </div>
        {selectedStamp.detail ? <div className="mt-5 rounded-2xl border border-neutral-100 bg-neutral-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/70">
          <p className="text-sm font-bold">{selectedStamp.detail.source === 'IN_PERSON' ? 'Compra en tienda' : selectedStamp.detail.order ? 'Pedido asociado' : 'Información del pedido no disponible'}</p>
          <dl className="mt-3 space-y-2.5 text-sm">
            {selectedStamp.detail.earnedAt && <div className="flex justify-between gap-4"><dt className="text-neutral-500 dark:text-zinc-400">Fecha del sello</dt><dd className="text-right font-medium">{formatOrderDate(selectedStamp.detail.earnedAt)}</dd></div>}
            {selectedStamp.detail.order && <><div className="flex justify-between gap-4"><dt className="text-neutral-500 dark:text-zinc-400">Pedido</dt><dd className="break-all text-right font-semibold">{selectedStamp.detail.order.number ? `#${String(selectedStamp.detail.order.number).padStart(2, '0')}` : selectedStamp.detail.order.reference}</dd></div><div className="flex justify-between gap-4"><dt className="text-neutral-500 dark:text-zinc-400">Estado</dt><dd className="text-right font-medium">{getOrderStatusLabel(selectedStamp.detail.order.status)}</dd></div><div className="flex justify-between gap-4 border-t border-neutral-200 pt-2.5 dark:border-zinc-700"><dt className="font-semibold">Total</dt><dd className="font-extrabold tabular-nums">{money(selectedStamp.detail.order.total)}</dd></div></>}
            {selectedStamp.detail.source === 'IN_PERSON' && selectedStamp.detail.visitTotal != null && <div className="flex justify-between gap-4 border-t border-neutral-200 pt-2.5 dark:border-zinc-700"><dt className="font-semibold">Total</dt><dd className="font-extrabold tabular-nums">{money(selectedStamp.detail.visitTotal)}</dd></div>}
          </dl>
        </div> : <p className="mt-5 text-sm leading-6 text-neutral-600 dark:text-zinc-300">No hay información individual disponible para este sello.</p>}
      </section>
    </div>}
    {addressToDelete && <div className="wl-auth wl-address-delete-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-address-title" aria-describedby="delete-address-description" onClick={() => { if (!deletingAddressId) setAddressToDelete(null); }} onKeyDown={(event) => { if (event.key === 'Escape' && !deletingAddressId) setAddressToDelete(null); }}>
      <section className="wl-auth-sheet wl-address-delete-sheet" onClick={(event) => event.stopPropagation()}>
        <span className="wl-address-delete-icon"><Trash2 aria-hidden="true" /></span>
        <h2 id="delete-address-title">¿Eliminar dirección?</h2>
        <p id="delete-address-description">Se eliminará <strong>{addressToDelete.label}</strong> de tus direcciones guardadas.</p>
        {deleteAddressError && <p role="alert" className="wl-auth-error">{deleteAddressError}</p>}
        <div className="wl-address-delete-actions">
          <button type="button" className="wl-addr-cancel" autoFocus disabled={!!deletingAddressId} onClick={() => setAddressToDelete(null)}>Cancelar</button>
          <button type="button" className="wl-addr-save" disabled={!!deletingAddressId} onClick={() => void removeAddress(addressToDelete.id)}>{deletingAddressId ? 'Eliminando…' : 'Sí, eliminar'}</button>
        </div>
      </section>
    </div>}
    {detailOpen && <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-4"><section role="dialog" aria-modal="true" aria-label="Detalle de pedido" className="mx-auto my-8 max-w-lg space-y-4 rounded-2xl bg-white p-6"><button onClick={() => setDetailOpen(false)} className="float-right">Cerrar</button><h2 className="text-xl font-bold">Tu pedido WingsLab</h2>{detail ? <><p>{getOrderStatusLabel(detail.status)}</p><p>{money(detail.totalAmount)}</p>{detail.items?.map((item: any) => <p key={item.id}>{item.quantity} × {item.product?.name || item.productName}</p>)}{detail.tracking?.map((t: any) => <p key={t.id} className="text-sm text-neutral-600">{getOrderStatusLabel(t.status)}</p>)}<p className="text-xs text-neutral-500">{detail.orderReference}</p></> : <p>Cargando pedido…</p>}</section></div>}
    {addressModalOpen && (
      <div className="wl-auth wl-addr-overlay fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-[fadeIn_0.2s_ease-out]" style={addressViewport ? { top: addressViewport.top, height: addressViewport.height, bottom: 'auto' } : undefined} role="dialog" aria-modal="true" aria-labelledby="address-modal-title" onClick={closeAddressModal}>
        <section className="wl-auth-sheet relative flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden" onClick={(event) => event.stopPropagation()}>
          <button type="button" onClick={closeAddressModal} className="wl-addr-close absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-600 transition active:scale-95" aria-label="Cerrar"><X className="h-5 w-5" strokeWidth={2.5} /></button>
          <div className="wl-auth-scroll overflow-y-auto overflow-x-hidden flex-1">
            <div className="wl-auth-body wl-addr-body">
              <div className="wl-auth-intro"><h3 id="address-modal-title">Nueva dirección</h3><p>Encuentra tu dirección para recibir tus pedidos.</p></div>
              <div className="wl-addr-fields">
                <div className="wl-auth-field grid gap-1.5">
                  <label htmlFor="account-address-search">Buscar dirección</label>
                  <div className="relative">
                    <span className="wl-auth-field-icon" aria-hidden="true"><Search /></span>
                    <input id="account-address-search" type="search" value={addressQuery} onChange={(event) => searchAddresses(event.target.value)} placeholder="Calle, número, colonia…" autoComplete="off" aria-expanded={addressSuggestions.length > 0} aria-controls="account-address-suggestions" aria-autocomplete="list" />
                  </div>
                  {(addressBusy || addressSelecting) && <small className="wl-addr-search-status" role="status">{addressSelecting ? 'Ubicando dirección…' : 'Buscando direcciones…'}</small>}
                  {addressSuggestions.length > 0 && (
                    <div id="account-address-suggestions" className="wl-profile-suggestions wl-addr-suggestions">
                      {addressSuggestions.map((suggestion) => (
                        <button type="button" key={suggestion.place_id} onClick={() => void selectAddressSuggestion(suggestion)}>
                          <MapPin aria-hidden="true" /><span>{suggestion.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <label className="wl-auth-field grid gap-1.5"><span>Número de domicilio</span><div className="relative"><span className="wl-auth-field-icon" aria-hidden="true"><MapPin /></span><input value={addressForm.number} onChange={(event) => { numberEditedRef.current = true; setAddressForm(current => ({ ...current, number: event.target.value })); setAddressError(''); }} placeholder="Ej. 226 o S/N" autoComplete="off" /></div></label>
                {addressForm.latitude && addressForm.longitude ? (
                  <AddressPinMap latitude={Number(addressForm.latitude)} longitude={Number(addressForm.longitude)} onChange={moveAddressPin} />
                ) : null}
                {pinStatus === 'loading' && <p className="wl-addr-map-hint" role="status">Actualizando dirección…</p>}
                {pinStatus === 'failed' && <p className="wl-auth-error" role="alert">No pudimos obtener la dirección del pin. Muévelo de nuevo o selecciona otra dirección.</p>}
                {pinStatus === 'idle' && numberEditedRef.current && addressForm.latitude && <p className="wl-addr-map-hint">Conservamos el número que escribiste. Confirma que corresponda al pin.</p>}
                <label className="wl-auth-field grid gap-1.5"><span>Referencias <small>(opcional)</small></span><div className="relative"><span className="wl-auth-field-icon" aria-hidden="true"><MapPin /></span><input value={addressForm.reference} onChange={(e) => setAddressForm(current => ({ ...current, reference: e.target.value }))} placeholder="Ej. Casa azul, portón negro…" /></div></label>
              </div>
              {addressError && <p role="alert" className="wl-auth-error">{addressError}</p>}
              <div className="wl-addr-actions">
                <button type="button" onClick={closeAddressModal} className="wl-addr-cancel">Cancelar</button>
                <button type="button" onClick={() => void saveAddress()} disabled={savingAddress || addressSelecting || pinStatus !== 'idle'} className="wl-addr-save">{savingAddress ? <Loader2 className="mx-auto animate-spin" aria-hidden="true" /> : null}{savingAddress ? 'Guardando…' : 'Guardar dirección'}</button>
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
