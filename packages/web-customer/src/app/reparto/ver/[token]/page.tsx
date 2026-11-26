'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable react-hooks/exhaustive-deps */

import { useEffect, useRef, useState, use } from 'react';
import { Banknote, Check, Clock, CreditCard, MapPin, Package, Route, Store } from 'lucide-react';
import officialWordmark from '../../../../assets/wingslab-wordmark-red.png';
import officialWhiteWordmark from '../../../../assets/wingslab-wordmark.png';
import DeliveryRouteMap from '../../../../components/DeliveryRouteMap';
import DriverTurnByTurnOverlay from '../../../../components/DriverTurnByTurnOverlay';
import redWordmark from '../../../../assets/wingslab-wordmark-red.png';
import whiteWordmark from '../../../../assets/wingslab-wordmark.png';
import type { Html5Qrcode } from 'html5-qrcode';
import {
  optimizeRoute,
  orderReferenceToTime,
  reorderByTokens,
  extractTokenFromRaw,
  haversineKm,
} from '../../../../lib/route-optimizer';

interface DeliveryTicketData {
  id: string;
  orderReference: string;
  /** Número diario del pedido (01, 02…) como en el panel del restaurante. */
  dailyCounter?: number | null;
  status: string;
  totalAmount: number;
  deliveryFee?: number;
  paymentMethod: string;
  deliveryAddress: {
    street: string;
    number: string;
    neighborhood: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
    reference?: string | null;
    latitude: number;
    longitude: number;
  };
  notes?: string | null;
  items?: Array<{
    id: string;
    quantity: number;
    weightG?: number | null;
    specialInstructions?: string | null;
    product: { name: string; image?: string | null };
    options: Array<{ name: string }>;
  }>;
  handoverPin?: string | null;
  driverArrivedAtCustomer?: string | null;
  isSupportDelivery?: boolean;
  isOwnDelivery?: boolean;
  supportRestaurant?: {
    id: string;
    name: string;
  } | null;
  restaurant: {
    name: string;
    phone: string;
    businessType?: string;
    address?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  };
  customer: {
    name: string;
    lastName?: string | null;
    phone: string;
  };
}

interface ScannedDelivery {
  token: string;
  data: DeliveryTicketData;
  arrived: boolean;
  pickedUp: boolean;
  delivered: boolean;
  scannedAt: number;
  deliveredAt?: number;
}

interface PageProps {
  params: Promise<{
    token: string;
  }>;
}

// NORMALIZACIÓN ANTI-DUPLICADOS: el restaurante puede regenerar el QR de la
// misma orden (asumir-reparto hace upsert y crea un token nuevo). Si el
// repartidor escaneó dos QRs de la misma orden, hay dos entradas con tokens
// distintos pero la misma orderReference. Conservamos la entrada más reciente
// (mayor scannedAt) y descartamos el resto.
/** Nombre completo del cliente (nombre + apellido cuando exista). */
function fullCustomerName(customer: { name?: string | null; lastName?: string | null } | null | undefined): string {
  const first = (customer?.name || '').trim();
  const last = (customer?.lastName || '').trim();
  return [first, last].filter(Boolean).join(' ') || 'Cliente';
}

function dedupeByOrderReference(list: ScannedDelivery[]): ScannedDelivery[] {  const latestByRef = new Map<string, ScannedDelivery>();
  for (const item of list) {
    const ref = item.data.orderReference;
    if (!ref) {
      continue;
    }
    const existing = latestByRef.get(ref);
    if (!existing || (item.scannedAt || 0) > (existing.scannedAt || 0)) {
      latestByRef.set(ref, item);
    }
  }
  return list.filter((item) => {
    const ref = item.data.orderReference;
    if (!ref) return true;
    const latest = latestByRef.get(ref);
    return latest ? latest.token === item.token : false;
  });
}

// Reloj MM:SS para la espera sin contacto (negativos → 00:00).
function formatCountdown(remainingMs: number): string {
  const totalSec = Math.max(0, Math.ceil(remainingMs / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// Timestamp (ms) de cuando el repartidor llegó al domicilio del cliente.
function getCustomerArrivalTime(ticket: DeliveryTicketData, token?: string): number {
  if (ticket.driverArrivedAtCustomer) {
    const ts = new Date(ticket.driverArrivedAtCustomer).getTime();
    if (!Number.isNaN(ts)) return ts;
  }
  // Fallback: localStorage (persistido por el botón "Notificar: Ya llegué").
  if (token && typeof window !== 'undefined') {
    const raw = localStorage.getItem(`sadel_arrivedat_${token}`);
    if (raw) {
      const ts = parseInt(raw, 10);
      if (!Number.isNaN(ts) && ts > 0) return ts;
    }
  }
  return 0;
}

export default function DeliveryTicketPage({ params }: PageProps) {
  const { token } = use(params);
  
  const [isMounted, setIsMounted] = useState(false);
  const [deliveries, setDeliveries] = useState<ScannedDelivery[]>([]);
  const deliveriesRef = useRef<ScannedDelivery[]>([]);
  useEffect(() => {
    deliveriesRef.current = deliveries;
  }, [deliveries]);
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [llegueError, setLlegueError] = useState('');
  const [reviewPickupToken, setReviewPickupToken] = useState<string | null>(null);
  const [confirmedPickupToken, setConfirmedPickupToken] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [modalOpenedFromDashboard, setModalOpenedFromDashboard] = useState(false);
  // Reloj de cuenta regresiva para la espera sin contacto (lugar seguro / no salió).
  const [deliveryClock, setDeliveryClock] = useState<number>(() => Date.now());
  // Tokens para los modales de confirmación de "dejar en lugar seguro" y
  // "cliente no salió — liberar pedido" (entrega abandonada).
  const [safePlaceConfirmToken, setSafePlaceConfirmToken] = useState<string | null>(null);
  const [lugarSeguroSubmitting, setLugarSeguroSubmitting] = useState(false);
  const [lugarSeguroError, setLugarSeguroError] = useState('');
  const [noShowConfirmToken, setNoShowConfirmToken] = useState<string | null>(null);
  const [noShowSubmitting, setNoShowSubmitting] = useState(false);
  const [noShowError, setNoShowError] = useState('');
  // Repartidor de apoyo: tokens cuyo repartidor YA llegó al restaurante origen y
  // está esperando que confirme la entrega (PIN en transferencia / efectivo).
  const [waitingHandoverTokens, setWaitingHandoverTokens] = useState<string[]>([]);
  // Posición GPS actual del repartidor (para el mapa de navegación en la app).
  const [driverPos, setDriverPos] = useState<{ lat: number; lng: number } | null>(null);
  const [driverPositionAt, setDriverPositionAt] = useState<number | null>(null);
  // Navegación turn-by-turn in-app: destino 'pickup' (restaurante) o 'delivery' (domicilio).
  const [navOpenFor, setNavOpenFor] = useState<'pickup' | 'delivery' | null>(null);
  // Mapa embebido (abajo en la card de domicilio): por defecto NO se carga para
  // ahorrar datos móviles; el repartidor lo activa con un toque y se recuerda.
  const [mapEnabled, setMapEnabled] = useState<boolean>(false);

  useEffect(() => {
    try {
      if (localStorage.getItem('sadel:driverMapOn') === '1') setMapEnabled(true);
    } catch {
      /* almacenamiento no disponible */
    }
  }, []);
  const toggleMap = () => {
    setMapEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('sadel:driverMapOn', next ? '1' : '0');
      } catch {
        /* sin almacenamiento */
      }
      return next;
    });
  };

  // Modal "Agregar entrega": escáner QR o pegar enlace
  const [showAddModal, setShowAddModal] = useState(false);
  const [addMode, setAddMode] = useState<'qr' | 'link'>('qr');
  const [linkInput, setLinkInput] = useState('');
  const [addError, setAddError] = useState('');
  const [adding, setAdding] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  // Ref espejo del estado del modal para que los timers del escáner puedan
  // comprobar si el modal sigue abierto antes de encender la cámara.
  const addModalOpenRef = useRef(false);
  const scannerContainerId = 'sadel-qr-reader';

  // Ruta inteligente: orden optimizado de tokens activos (null = orden actual/ninguno)
  const [routeOrder, setRouteOrder] = useState<string[] | null>(null);

  // Métricas del turno: reloj en vivo y distancia recorrida acumulada (GPS).
  const [shiftNow, setShiftNow] = useState(() => Date.now());
  const [kmDriven, setKmDriven] = useState(0);
  const lastGpsPosRef = useRef<{ lat: number; lng: number } | null>(null);

  // Tick del reloj: refresca el tiempo de jornada cada 30s.
  useEffect(() => {
    const id = setInterval(() => setShiftNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  // Tick del reloj de espera sin contacto (cada segundo para cuenta regresiva en vivo).
  useEffect(() => {
    const id = setInterval(() => setDeliveryClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Acumular kilómetros recorridos con cada actualización de GPS.
  useEffect(() => {
    if (!driverPos) return;
    const prev = lastGpsPosRef.current;
    if (prev) {
      const d = haversineKm(prev.lat, prev.lng, driverPos.lat, driverPos.lng);
      if (d > 0.01) {
        setKmDriven((k) => k + d);
      }
    }
    lastGpsPosRef.current = driverPos;
  }, [driverPos]);

  // Dark mode automático por preferencia del sistema
  const [darkMode, setDarkMode] = useState(false);
  
  useEffect(() => {
    setIsMounted(true);
    // Limpieza del escáner al desmontar la página.
    return () => {
      const sc = scannerRef.current;
      if (sc) {
        scannerRef.current = null;
        try { void sc.stop().catch(() => {}); } catch (e) { /* sin cámara */ }
      }
    };
  }, []);

  const apiBase = '/api';

  const triggerHaptic = (pattern: number[]) => {
    if (typeof window !== 'undefined' && window.navigator && window.navigator.vibrate) {
      window.navigator.vibrate(pattern);
    }
  };

  // Use the same persisted preference as the customer experience.
  useEffect(() => {
    const apply = () => setDarkMode(document.documentElement.classList.contains('dark'));
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // Cargar tickets de localStorage y sincronizar el token actual de la URL
  const loadAndSyncTicket = async () => {
    try {
      setLoading(true);
      setError('');
      
      let currentList: ScannedDelivery[] = [];
      if (typeof window !== 'undefined') {
        const stored = localStorage.getItem('sadel_scanned_deliveries');
        if (stored) {
          try {
            currentList = JSON.parse(stored) as ScannedDelivery[];
            // Purga entradas obsoletas: entregadas hace más de 12h, o que llevan
            // más de 24h activas sin entregarse (sobran de días/jornadas previas).
            // Sin esta purga, el "Turno" se calcula desde scans antiguos y sale
            // duraciones absurdas (p.ej. "88h 36min").
            currentList = currentList.filter(item => {
              const age = Date.now() - item.scannedAt;
              if (item.delivered && age > 12 * 60 * 60 * 1000) return false;
              if (!item.delivered && age > 24 * 60 * 60 * 1000) return false;
              return true;
            });
          } catch (e) {
            currentList = [];
          }
        }
      }

      // Elimina duplicados de la misma orden escaneada con tokens distintos
      // (QR regenerado por el restaurante).
      currentList = dedupeByOrderReference(currentList);

      let fetchedTicket: DeliveryTicketData | null = null;
      let fetchErrMessage = '';
      let invalidToken = false;

      if (token) {
        try {
          const url = `${apiBase}/public/delivery-ticket/${encodeURIComponent(token)}`;
          const fetchTicket = () => {
            const controller = new AbortController();
            const timeout = window.setTimeout(() => controller.abort(), 8000);
            return fetch(url, { cache: 'no-store', signal: controller.signal })
              .finally(() => window.clearTimeout(timeout));
          };
          let response = await fetchTicket().catch(() => null);
          if (!response || response.status >= 500) {
            await new Promise(resolve => setTimeout(resolve, 750));
            response = await fetchTicket();
          }
          const data = await response.json().catch(() => null);

          if (response.ok && data?.success && data.data) {
            fetchedTicket = data.data as DeliveryTicketData;
          } else {
            invalidToken = (response.status === 404 || response.status === 410) && data?.success === false;
            fetchErrMessage = invalidToken
              ? data.error?.message || 'Este enlace de reparto ya no está activo.'
              : 'No pudimos consultar el reparto en este momento. Intenta de nuevo.';
          }
        } catch {
          fetchErrMessage = 'No pudimos conectar con el servicio de reparto. Intenta de nuevo.';
        }
      }

      if (fetchedTicket && token) {
        const existingIndex = currentList.findIndex(item => item.token === token);
        // La misma orden puede haberse escaneado antes con otro token (QR
        // regenerado por el restaurante). En ese caso actualizamos esa entrada
        // con el token nuevo y eliminamos la entrada duplicada.
        const existingRefIndex = existingIndex >= 0
          ? -1
          : currentList.findIndex(
              item => item.data.orderReference === fetchedTicket.orderReference
            );
        const targetIndex = existingIndex >= 0 ? existingIndex : existingRefIndex;

        const isArrived = typeof window !== 'undefined' 
          ? localStorage.getItem(`sadel_arrived_${token}`) === 'true' ||
            (targetIndex >= 0 && currentList[targetIndex].arrived)
          : false;

        const isPickedUp = typeof window !== 'undefined' 
          ? localStorage.getItem(`sadel_pickedup_${token}`) === 'true' ||
            (targetIndex >= 0 && currentList[targetIndex].pickedUp)
          : false;

        const isDelivered = fetchedTicket.status === 'DELIVERED';

        const updatedDelivery: ScannedDelivery = {
          token,
          data: fetchedTicket,
          arrived: isArrived,
          pickedUp: isPickedUp,
          delivered: isDelivered,
          scannedAt: targetIndex >= 0 ? currentList[targetIndex].scannedAt : Date.now(),
          deliveredAt: isDelivered 
            ? (targetIndex >= 0 ? (currentList[targetIndex].deliveredAt || Date.now()) : Date.now())
            : undefined,
        };

        if (targetIndex >= 0) {
          currentList[targetIndex] = updatedDelivery;
        } else {
          currentList.push(updatedDelivery);
        }

        if (typeof window !== 'undefined') {
          localStorage.setItem('sadel_scanned_deliveries', JSON.stringify(currentList));
        }
      } else if (fetchErrMessage) {
        // El token de la URL ya no existe en el backend (expiró, fue regenerado
        // o la orden se eliminó). Si había una entrada obsoleta con ese token,
        // eliminarla para que no quede atrapada en la ruta.
        const hasStaleEntry = invalidToken && currentList.some(item => item.token === token);
        if (hasStaleEntry) {
          currentList = currentList.filter(item => item.token !== token);
          if (typeof window !== 'undefined') {
            localStorage.setItem('sadel_scanned_deliveries', JSON.stringify(currentList));
          }
        }
        setError(fetchErrMessage);
      }

      setDeliveries(currentList);

      // LANDING SIEMPRE EN EL DASHBOARD: la vista de detalle solo se abre al
      // tocar una tarjeta. Única excepción: apoyo a red cuyo restaurante origen
      // aún no confirma la entrega (debe ver la espera de inmediato al escanear).
      const waitingHandoverForToken =
        typeof window !== 'undefined' &&
        localStorage.getItem(`sadel_pickupwaiting_${token || ''}`) === 'true';
      if (token && fetchedTicket && (waitingHandoverForToken || fetchedTicket.isOwnDelivery)) {
        setSelectedToken(token);
      } else {
        setSelectedToken(null);
      }

    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Este enlace de reparto ya no está activo o ha expirado.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      void loadAndSyncTicket();
    }
  }, [token]);

  // Sincronización entre pestañas: si otra pestaña agrega/entrega/elimina un
  // pedido, esta pestaña actualiza su lista al instante (storage event).
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'sadel_scanned_deliveries') {
        try {
          const stored = e.newValue;
          let parsed: ScannedDelivery[] = [];
          if (stored) {
            parsed = JSON.parse(stored) as ScannedDelivery[];
            parsed = parsed.filter(item =>
              !(item.delivered && Date.now() - item.scannedAt > 12 * 60 * 60 * 1000)
            );
          }
          setDeliveries(dedupeByOrderReference(parsed));
        } catch (err) {
          // JSON inválido desde otra pestaña: ignorar
        }
      } else if (e.key && e.key.startsWith('sadel_arrived_')) {
        const tok = e.key.replace('sadel_arrived_', '');
        if (e.newValue === 'true') {
          setDeliveries(prev => {
            const newList = prev.map(item =>
              item.token === tok ? { ...item, arrived: true } : item
            );
            return newList;
          });
        }
      } else if (e.key && e.key.startsWith('sadel_pickedup_')) {
        const tok = e.key.replace('sadel_pickedup_', '');
        if (e.newValue === 'true') {
          setDeliveries(prev => {
            const newList = prev.map(item =>
              item.token === tok ? { ...item, pickedUp: true } : item
            );
            return newList;
          });
        }
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Sincronizar en segundo plano las entregas guardadas (incluido el token de la
  // URL) de forma periódica. Revalida el estado real contra el backend y elimina
  // entradas obsoletas: tokens que ya no existen (404/410, expiraron o fueron
  // regenerados) o entregas que llevan demasiados días activas sin entregarse.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const MAX_ACTIVE_AGE = 24 * 60 * 60 * 1000; // 24h
    const syncDeliveries = async () => {
      const activeDeliveries = deliveriesRef.current.filter(d => !d.delivered);
      if (activeDeliveries.length === 0) return;

      const now = Date.now();
      for (const delivery of activeDeliveries) {
        try {
          const response = await fetch(`${apiBase}/public/delivery-ticket/${delivery.token}`);
          const data = await response.json();
          if (response.ok && data.success) {
            const ticketData = data.data as DeliveryTicketData;
            setDeliveries(prev => {
              if (!prev.some(item => item.token === delivery.token)) return prev;
              const wasDelivered = prev.find(item => item.token === delivery.token)?.delivered ?? false;
              const isNowDelivered = ticketData.status === 'DELIVERED';
              const newList = prev.map(item => {
                if (item.token === delivery.token) {
                  return {
                    ...item,
                    data: ticketData,
                    delivered: isNowDelivered,
                    deliveredAt: isNowDelivered 
                      ? (wasDelivered ? (item.deliveredAt || Date.now()) : Date.now())
                      : undefined,
                  };
                }
                return item;
              });
              localStorage.setItem('sadel_scanned_deliveries', JSON.stringify(newList));
              return newList;
            });
          } else {
            // El token ya no existe en el backend (expiró, fue regenerado o la
            // orden se eliminó): descartar la entrada obsoleta para que no se
            // reintente y no genere 404 en consola ni datos fantasma en la ruta.
            setDeliveries(prev => {
              if (!prev.some(item => item.token === delivery.token)) return prev;
              const newList = prev.filter(item => item.token !== delivery.token);
              localStorage.setItem('sadel_scanned_deliveries', JSON.stringify(newList));
              return newList;
            });
          }
        } catch (e) {
          console.error(`Error al actualizar token ${delivery.token} en segundo plano:`, e);
        }
      }

      // Purga final: entregas activas demasiado antiguas (jornadas previas) que
      // el backend sigue reportando como activas. Evita cards "atrapadas".
      setDeliveries(prev => {
        const purged = prev.filter(item => {
          if (item.delivered) return true;
          return now - (item.scannedAt || now) < MAX_ACTIVE_AGE;
        });
        if (purged.length !== prev.length) {
          localStorage.setItem('sadel_scanned_deliveries', JSON.stringify(purged));
        }
        return purged;
      });
    };

    void syncDeliveries();
    const id = setInterval(syncDeliveries, 30000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, token]);

  // Polling del repartidor de apoyo: mientras espera la confirmación del
  // restaurante origen (PIN/efectivo), consulta el estado del pedido. Cuando el
  // restaurante confirma la entrega, la entrega inicia y se libera la espera.
  useEffect(() => {
    if (!selectedToken) return;
    if (!isWaitingHandover(selectedToken)) return;

    const poll = async () => {
      try {
        const response = await fetch(`${apiBase}/public/delivery-ticket/${selectedToken}`);
        const data = await response.json();
        if (response.ok && data.success) {
          const ticketData = data.data as DeliveryTicketData;
          const started = ['PICKED_UP', 'IN_TRANSIT', 'DELIVERED'].includes(ticketData.status);
          setDeliveries(prev => {
            const newList = prev.map(item =>
              item.token === selectedToken
                ? { ...item, data: ticketData, pickedUp: item.pickedUp || started }
                : item
            );
            if (typeof window !== 'undefined') {
              localStorage.setItem('sadel_scanned_deliveries', JSON.stringify(newList));
            }
            return newList;
          });
          if (started || ticketData.status !== 'READY') {
            setWaitingHandoverTokens(prev => prev.filter(x => x !== selectedToken));
            if (typeof window !== 'undefined') {
              localStorage.removeItem(`sadel_pickupwaiting_${selectedToken}`);
            }
          }
        }
      } catch (e) {
        console.error('Error al verificar confirmación del restaurante:', e);
      }
    };

    void poll();
    // Guard de visibilidad: pausa el polling cuando la pestaña está oculta
    // (ahorra datos) y lo retoma al volver a primer plano.
    let interval: ReturnType<typeof setInterval> | null = null;
    const startPolling = () => {
      if (interval) return;
      interval = setInterval(poll, 4000);
    };
    const stopPolling = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        startPolling();
      } else {
        stopPolling();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    startPolling();
    return () => {
      if (interval) clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedToken, waitingHandoverTokens.length, apiBase]);

  // Tokens de entregas en ruta (PICKED_UP/IN_TRANSIT): el repartidor propio/apoyo
  // comparte su GPS con el cliente real de SaDeL para el seguimiento en vivo.
  const activeTrackingTokens = deliveries
    .filter((d) => ['PICKED_UP', 'IN_TRANSIT'].includes(d.data.status) && !d.delivered)
    .map((d) => d.token)
    .join(',');

  useEffect(() => {
    if (typeof window === 'undefined' || !navigator.geolocation) return;
    if (!activeTrackingTokens) return;

    const tokens = activeTrackingTokens.split(',');
    let watchId: number | null = null;
    const lastSent = new Map<string, { lat: number; lng: number; at: number }>();
    const lastAttempt = new Map<string, number>();
    const pending = new Set<string>();

    const postLocation = (tokenToPost: string, lat: number, lng: number) => {
      pending.add(tokenToPost);
      lastAttempt.set(tokenToPost, Date.now());
      fetch(`${apiBase}/public/delivery-ticket/${tokenToPost}/ubicacion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coords: [lat, lng] }),
      }).then((response) => {
        if (response.ok) lastSent.set(tokenToPost, { lat, lng, at: Date.now() });
      }).catch(() => {}).finally(() => pending.delete(tokenToPost));
    };

    const onPositionSuccess = (position: GeolocationPosition) => {
      if (document.visibilityState === 'hidden') return;
      const lat = parseFloat(position.coords.latitude.toFixed(6));
      const lng = parseFloat(position.coords.longitude.toFixed(6));
      const now = Date.now();
      setDriverPos({ lat, lng });
      setDriverPositionAt(position.timestamp);
      for (const t of tokens) {
        const sent = lastSent.get(t);
        if (pending.has(t) || now - (lastAttempt.get(t) || 0) < 10000) continue;
        const moved = !sent || Math.abs(lat - sent.lat) > 0.0002 || Math.abs(lng - sent.lng) > 0.0002;
        if (moved || (sent && now - sent.at >= 60000)) postLocation(t, lat, lng);
      }
    };

    const start = () => {
      if (watchId !== null) return;
      watchId = navigator.geolocation.watchPosition(onPositionSuccess, () => {}, {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 10000,
      });
    };
    const stop = () => {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        start();
      } else {
        stop();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    start();
    return () => {
      stop();
      // Al dejar de rastrear, olvidamos la última posición para que al retomar
      // el tracking no se cuente una distancia falsa desde un punto lejano.
      lastGpsPosRef.current = null;
      document.removeEventListener('visibilitychange', handleVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTrackingTokens, apiBase]);

  const activeDelivery = deliveries.find(d => d.token === selectedToken);
  const currentTicket = activeDelivery ? activeDelivery.data : null;
  const currentArrived = activeDelivery ? activeDelivery.arrived : false;
  const currentPickedUp = activeDelivery ? activeDelivery.pickedUp : false;
  const currentDelivered = activeDelivery ? activeDelivery.delivered : false;

  // Repartidor de apoyo esperando que el restaurante origen confirme la entrega
  const isWaitingHandover = (tok: string) =>
    waitingHandoverTokens.includes(tok) ||
    (typeof window !== 'undefined' && localStorage.getItem(`sadel_pickupwaiting_${tok}`) === 'true');

  // La entrega de apoyo se considera "iniciada" una vez el restaurante confirmó
  const currentSupportStarted = currentTicket
    ? ['PICKED_UP', 'IN_TRANSIT', 'DELIVERED'].includes(currentTicket.status)
    : false;

  // Notificar llegada genérico para un token
  const handleLlegueForToken = async (targetToken: string) => {
    const deliv = deliveries.find(d => d.token === targetToken);
    if (!deliv || deliv.arrived || notifying) return;

    try {
      setNotifying(true);
      setLlegueError('');
      triggerHaptic([40, 60, 40]);

      const response = await fetch(`${apiBase}/public/delivery-ticket/${targetToken}/llegue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error?.message || 'Error al notificar la llegada al cliente.');
      }

      setDeliveries(prev => {
        const newList = prev.map(item => {
          if (item.token === targetToken) {
            return { ...item, arrived: true };
          }
          return item;
        });
        if (typeof window !== 'undefined') {
          localStorage.setItem('sadel_scanned_deliveries', JSON.stringify(newList));
          localStorage.setItem(`sadel_arrived_${targetToken}`, 'true');
          localStorage.setItem(`sadel_arrivedat_${targetToken}`, String(Date.now()));
        }
        return newList;
      });

      triggerHaptic([100, 50, 150]);
    } catch (err: any) {
      console.error(err);
      setLlegueError(err.message || 'No se pudo enviar la notificación de llegada.');
      triggerHaptic([300, 100]);
    } finally {
      setNotifying(false);
    }
  };

  // Notificar llegada desde vista detalle
  const handleLlegue = async () => {
    if (!selectedToken) return;
    await handleLlegueForToken(selectedToken);
  };

  // Confirmar recogida en el restaurante origen (solo pedidos de apoyo a red)
  const handleLlegueRestauranteForToken = async (targetToken: string) => {
    if (notifying) return;
    if (isWaitingHandover(targetToken)) return;

    try {
      setNotifying(true);
      triggerHaptic([40, 60, 40]);

      const response = await fetch(`${apiBase}/public/delivery-ticket/${targetToken}/llegue-restaurante`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error?.message || 'Error al confirmar la recogida.');
      }

      // La llegada se notificó y el restaurante debe confirmar la entrega
      // (PIN en transferencia / efectivo). La entrega iniciará cuando confirme.
      if (data.data && data.data.needsHandover) {
        setWaitingHandoverTokens((prev) =>
          prev.includes(targetToken) ? prev : [...prev, targetToken]
        );
        if (typeof window !== 'undefined') {
          localStorage.setItem(`sadel_pickupwaiting_${targetToken}`, 'true');
        }
      } else {
        setDeliveries(prev => {
          const newList = prev.map(item => {
            if (item.token === targetToken) {
              return { ...item, pickedUp: true, data: { ...item.data, status: 'IN_TRANSIT' } };
            }
            return item;
          });
          if (typeof window !== 'undefined') {
            localStorage.setItem('sadel_scanned_deliveries', JSON.stringify(newList));
            localStorage.setItem(`sadel_pickedup_${targetToken}`, 'true');
          }
          return newList;
        });
      }

      triggerHaptic([100, 50, 150]);
    } catch (err: any) {
      console.error(err);
      setLlegueError(err.message || 'No se pudo confirmar la recogida del pedido.');
      triggerHaptic([300, 100]);
    } finally {
      setNotifying(false);
    }
  };

  const handleLlegueRestaurante = async () => {
    if (!selectedToken) return;
    await handleLlegueRestauranteForToken(selectedToken);
  };

  // Mostrar modal de confirmación antes de entregar (desde detalle)
  const handleDeliver = (e: React.FormEvent) => {
    e.preventDefault();
    triggerHaptic([30]);
    setError('');
    setShowConfirmModal(true);
  };

  // Mostrar modal directamente desde la lista/dashboard
  const handleDeliverDirectly = (targetToken: string) => {
    setPin('');
    setError('');
    setSelectedToken(targetToken);
    setModalOpenedFromDashboard(true);
    triggerHaptic([30]);
    setShowConfirmModal(true);
  };

  // Completar entrega real tras confirmación del modal
  const executeDeliver = async () => {
    if (submitting) return;
    const targetToken = selectedToken;
    if (!targetToken) return;

    // Buscar el ticket correspondiente al token activo
    const targetDelivery = deliveries.find(d => d.token === targetToken);
    if (!targetDelivery) return;
    const ticketData = targetDelivery.data;

    const isCash = ticketData.paymentMethod === 'CASH';
    if (!isCash && (ticketData.isOwnDelivery || ticketData.handoverPin) && !/^\d{4}$/.test(pin)) return;

    try {
      setSubmitting(true);
      setError('');
      triggerHaptic([40]);

      const response = await fetch(`${apiBase}/public/delivery-ticket/${targetToken}/entregar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isCash ? { cashReceived: true } : { pin }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error?.message || 'Error al completar la entrega.');
      }

      setDeliveries(prev => {
        const newList = prev.map(item => {
          if (item.token === targetToken) {
            return { 
              ...item, 
              delivered: true, 
              deliveredAt: Date.now(),
              data: { ...item.data, status: 'DELIVERED' } 
            };
          }
          return item;
        });
        if (typeof window !== 'undefined') {
          localStorage.setItem('sadel_scanned_deliveries', JSON.stringify(newList));
        }
        return newList;
      });

      setPin('');
      setShowConfirmModal(false);
      setModalOpenedFromDashboard(false);
      triggerHaptic([100, 50, 100, 50, 200]);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'No se pudo completar la entrega del pedido.');
      triggerHaptic([300, 100, 300]);
    } finally {
      setSubmitting(false);
    }
  };

  // ── ESPERA SIN CONTACTO ────────────────────────────────────────────────
  // Completar entrega: dejar el pedido en un lugar seguro (transferencia).
  const handleLugarSeguro = async () => {
    const targetToken = safePlaceConfirmToken;
    if (!targetToken) return;

    try {
      setLugarSeguroSubmitting(true);
      setLugarSeguroError('');
      triggerHaptic([40]);

      const response = await fetch(`${apiBase}/public/delivery-ticket/${targetToken}/lugar-seguro`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error?.message || 'No se pudo dejar el pedido en lugar seguro.');
      }

      setDeliveries(prev => {
        const newList = prev.map(item => {
          if (item.token === targetToken) {
            return {
              ...item,
              delivered: true,
              deliveredAt: Date.now(),
              data: { ...item.data, status: 'DELIVERED' },
            };
          }
          return item;
        });
        if (typeof window !== 'undefined') {
          localStorage.setItem('sadel_scanned_deliveries', JSON.stringify(newList));
        }
        return newList;
      });

      setSafePlaceConfirmToken(null);
      triggerHaptic([100, 50, 100, 50, 200]);
    } catch (err: any) {
      console.error(err);
      setLugarSeguroError(err.message || 'No se pudo completar la entrega.');
      triggerHaptic([300, 100, 300]);
    } finally {
      setLugarSeguroSubmitting(false);
    }
  };

  // Completar entrega: cliente no salió — liberar pedido (efectivo).
  const handleNoShow = async () => {
    const targetToken = noShowConfirmToken;
    if (!targetToken) return;

    try {
      setNoShowSubmitting(true);
      setNoShowError('');
      triggerHaptic([40]);

      const response = await fetch(`${apiBase}/public/delivery-ticket/${targetToken}/cliente-no-salio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error?.message || 'No se pudo liberar el pedido.');
      }

      setDeliveries(prev => {
        const newList = prev.map(item => {
          if (item.token === targetToken) {
            return {
              ...item,
              delivered: true,
              deliveredAt: Date.now(),
              data: { ...item.data, status: 'DELIVERED' },
            };
          }
          return item;
        });
        if (typeof window !== 'undefined') {
          localStorage.setItem('sadel_scanned_deliveries', JSON.stringify(newList));
        }
        return newList;
      });

      setNoShowConfirmToken(null);
      triggerHaptic([100, 50, 100, 50, 200]);
    } catch (err: any) {
      console.error(err);
      setNoShowError(err.message || 'No se pudo liberar el pedido.');
      triggerHaptic([300, 100, 300]);
    } finally {
      setNoShowSubmitting(false);
    }
  };

  // Eliminar un pedido del listado
  const handleRemoveDelivery = (tokenToRemove: string, e: React.MouseEvent) => {
    e.stopPropagation();
    triggerHaptic([50, 30]);

    setDeliveries(prev => {
      const newList = prev.filter(item => item.token !== tokenToRemove);
      if (typeof window !== 'undefined') {
        localStorage.setItem('sadel_scanned_deliveries', JSON.stringify(newList));
        localStorage.removeItem(`sadel_arrived_${tokenToRemove}`);
      }
      return newList;
    });

    if (selectedToken === tokenToRemove) {
      setSelectedToken(null);
    }

    // Si la ruta optimizada contenía el token eliminado, la descartamos para
    // no dejar referencias huérfanas.
    setRouteOrder(prev => prev ? prev.filter(t => t !== tokenToRemove) : prev);
  };

  // ──────────────────────────
  // MODAL "AGREGAR ENTREGA" (escáner QR / pegar enlace)
  // ──────────────────────────

  // Detener la cámara del escáner de forma segura (no-op si nunca se inició).
  const stopScanner = () => {
    const sc = scannerRef.current;
    if (sc && sc.isScanning) {
      try {
        void sc.stop().then(() => {
          try { sc.clear(); } catch (e) { /* sin cámara activa */ }
        }).catch(() => {});
      } catch (e) {
        // sin cámara activa: ignorar
      }
    } else if (sc) {
      try { sc.clear(); } catch (e) { /* ya limpio */ }
    }
  };

  const openAddModal = () => {
    triggerHaptic([20]);
    setAddMode('qr');
    setLinkInput('');
    setAddError('');
    setAdding(false);
    addModalOpenRef.current = true;
    setShowAddModal(true);
    // Iniciar la cámara tras un pequeño delay para que el contenedor exista.
    setTimeout(() => {
      if (addModalOpenRef.current) {
        void startScanner().catch(() => setAddError('No se pudo iniciar la cámara.'));
      }
    }, 150);
  };

  const closeAddModal = () => {
    triggerHaptic([10]);
    addModalOpenRef.current = false;
    stopScanner();
    setShowAddModal(false);
    setAddError('');
  };

  // Arrancar el escáner HTML5-QRCode dentro del contenedor del modal.
  // Reutiliza la instancia existente si la hay: crear una nueva sobre el mismo
  // contenedor sin liberar antes la cámara provoca "Camera already in use".
  const startScanner = async () => {
    if (typeof document === 'undefined') return;
    if (!addModalOpenRef.current) return;
    const el = document.getElementById(scannerContainerId);
    if (!el) return;

    let scanner = scannerRef.current;
    if (scanner && scanner.isScanning) return; // ya está escaneando
    if (!scanner) {
      // El escáner es pesado: solo se descarga cuando se abre la cámara.
      const { Html5Qrcode } = await import('html5-qrcode');
      if (!addModalOpenRef.current) return;
      scanner = new Html5Qrcode(scannerContainerId, { verbose: false });
      scannerRef.current = scanner;
    }

    const config = { fps: 10, qrbox: { width: 220, height: 220 } };
    scanner
      .start(
        { facingMode: 'environment' },
        config,
        async (decodedText) => {
          // Decodificación exitosa: parsear el token y agregar la entrega.
          // No cerramos el modal aquí: lo cierra addTokenToRoute si tiene éxito,
          // y si hay error (duplicado/expirado) el mensaje se ve dentro del modal.
          const decodedToken = extractTokenFromRaw(decodedText);
          if (!decodedToken) return;
          await addTokenToRoute(decodedToken, 'scanner');
        },
        (errorMessage: string) => {
          // Errores de decodificación son normales (sin QR en cuadro): ignorar.
          if (errorMessage && errorMessage.includes('NotFound')) {
            // sin QR detectado: no molestar
          }
        }
      )
      .catch((err: any) => {
        console.error('Error al iniciar el escáner:', err);
        setAddError(
          'No se pudo acceder a la cámara. Verifica los permisos o pega el enlace manualmente.'
        );
      });
  };

  // Cambiar entre pestañas QR / Link (reinicia el escáner según el modo).
  const switchAddMode = (mode: 'qr' | 'link') => {
    setAddMode(mode);
    setAddError('');
    if (mode === 'qr') {
      setTimeout(() => {
        if (addModalOpenRef.current) {
          void startScanner().catch(() => setAddError('No se pudo iniciar la cámara.'));
        }
      }, 100);
    } else {
      stopScanner();
    }
  };

  // Agregar un token (de escáner o link) a la ruta del repartidor.
  const addTokenToRoute = async (rawToken: string, _source: 'scanner' | 'link') => {
    const cleanToken = extractTokenFromRaw(rawToken);
    if (!cleanToken) {
      setAddError('No se pudo reconocer el enlace. Pega la liga completa del QR.');
      return;
    }

    // Fuente de verdad: leemos la lista actual de localStorage para que el dedupe
    // sea robusto ante re-renders pendientes o escaneos rápidos consecutivos.
    let currentList: ScannedDelivery[] = [];
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('sadel_scanned_deliveries');
      if (stored) {
        try {
          currentList = JSON.parse(stored) as ScannedDelivery[];
        } catch (e) {
          currentList = [];
        }
      }
    }

    // Dedupe: si el token ya está en la lista (activo o entregado), avisar.
    const alreadyExists = currentList.some((d) => d.token === cleanToken);
    if (alreadyExists) {
      setAddError('Esta entrega ya fue agregada a tu ruta.');
      setAdding(false);
      return;
    }

    try {
      setAdding(true);
      setAddError('');
      const response = await fetch(`${apiBase}/public/delivery-ticket/${cleanToken}`);
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error?.message || 'El enlace ya no está activo o ha expirado.');
      }

      const ticketData = data.data as DeliveryTicketData;

      // Dedupe por orden: el restaurante puede regenerar el QR y crear un token
      // nuevo para la misma orden. Si ya tenemos esa orderReference, no se agrega
      // (solo avisamos); así no aparecen pedidos duplicados en la ruta.
      const existingRef = currentList.find(
        (d) => d.data.orderReference === ticketData.orderReference
      );
      if (existingRef) {
        setAddError(
          existingRef.token === cleanToken
            ? 'Esta entrega ya fue agregada a tu ruta.'
            : 'Este pedido ya fue agregado con otro código QR.'
        );
        setAdding(false);
        return;
      }

      const isArrived = typeof window !== 'undefined'
        ? localStorage.getItem(`sadel_arrived_${cleanToken}`) === 'true'
        : false;
      const isPickedUp = typeof window !== 'undefined'
        ? localStorage.getItem(`sadel_pickedup_${cleanToken}`) === 'true'
        : false;

      const newDelivery: ScannedDelivery = {
        token: cleanToken,
        data: ticketData,
        arrived: isArrived,
        pickedUp: isPickedUp,
        delivered: ticketData.status === 'DELIVERED',
        scannedAt: Date.now(),
        deliveredAt: ticketData.status === 'DELIVERED' ? Date.now() : undefined,
      };

      const newList = [...currentList, newDelivery];
      setDeliveries(newList);
      if (typeof window !== 'undefined') {
        localStorage.setItem('sadel_scanned_deliveries', JSON.stringify(newList));
      }

      setLinkInput('');
      setAdding(false);
      setShowAddModal(false);
      stopScanner();
      triggerHaptic([50, 40, 50]);
    } catch (err: any) {
      console.error(err);
      setAddError(err.message || 'No se pudo agregar la entrega.');
      setAdding(false);
    }
  };

  // Agregar desde el campo de texto (link pegado manualmente).
  const handleAddByLink = () => {
    triggerHaptic([20]);
    void addTokenToRoute(linkInput, 'link');
  };

  // ──────────────────────────
  // RUTA INTELIGENTE
  // ──────────────────────────

  // Orden activo de los pedidos según la ruta optimizada (si existe) o el
  // orden natural de la lista (FIFO por hora de escaneo).
  const getActiveOrdered = () => {
    const active = deliveries.filter((d) => !d.delivered);
    if (routeOrder && routeOrder.length > 0) {
      return reorderByTokens(active, routeOrder);
    }
    return active;
  };

  // Optimizar la ruta desde el restaurante de origen (o posición del repartidor).
  const handleOptimizeRoute = () => {
    const active = deliveries.filter((d) => !d.delivered);
    if (active.length < 2) return;

    const origin =
      driverPos ??
      (() => {
        const first = active[0];
        if (first.data.restaurant.latitude && first.data.restaurant.longitude) {
          return { lat: first.data.restaurant.latitude, lng: first.data.restaurant.longitude };
        }
        return null;
      })();
    if (!origin) return;

    const points = active.map((d) => {
      const lat = d.data.deliveryAddress.latitude;
      const lng = d.data.deliveryAddress.longitude;
      return {
        token: d.token,
        lat,
        lng,
        orderTime: orderReferenceToTime(d.data.orderReference) || d.scannedAt,
      };
    });

    const result = optimizeRoute(origin, points);
    setRouteOrder(result.orderedTokens);
    triggerHaptic([50, 30, 80]);
  };

  const handleUndoRoute = () => {
    setRouteOrder(null);
    triggerHaptic([20]);
  };

// Tap en una tarjeta: elegir ese pedido como siguiente parada (lo mueve al
// inicio de la ruta) y abre el detalle. Si aún no hay ruta optimizada, se
// inicializa con el orden actual para que el tap tenga efecto inmediato.
  const handleChooseAsNext = (delivToken: string) => {
    triggerHaptic([20]);
    setSelectedToken(delivToken);
    setRouteOrder(prev => {
      const base =
        prev && prev.length > 0
          ? prev
          : deliveries.filter((d) => !d.delivered).map((d) => d.token);
      const next = base.filter((t) => t !== delivToken);
      next.unshift(delivToken);
      return next;
    });
  };

  const activeCount = deliveries.filter(d => !d.delivered).length;

  // ──────────────────────────
  // Clases reutilizables
  // ──────────────────────────
  const bg = darkMode ? 'bg-[#09090b]' : 'bg-white';
  const textPrimary = darkMode ? 'text-zinc-50' : 'text-neutral-900';
  const textSecondary = darkMode ? 'text-zinc-400' : 'text-neutral-500';
  const textTertiary = darkMode ? 'text-zinc-500' : 'text-neutral-400';
  const cardBg = darkMode ? 'bg-[#121214]' : 'bg-white';
  const cardBorder = darkMode ? 'border-zinc-800/60' : 'border-black/5';
  const divider = darkMode ? 'border-zinc-800/60' : 'border-black/5';

  // ──────────────────────────
  // PANTALLA DE CARGA / MONTAJE (EVITA HYDRATION ERRORS)
  // ──────────────────────────
  if (!isMounted || loading) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center px-4 text-center bg-white text-neutral-900 dark:bg-[#101012] dark:text-neutral-100">
        <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-black/10 border-t-sky-400" />
        <p className="mt-4 text-xs font-semibold tracking-wide text-neutral-500">Cargando ruta de entrega…</p>
      </div>
    );
  }

  // ──────────────────────────
  // PANTALLA DE ERROR
  // ──────────────────────────
  if (error && deliveries.length === 0) {
    return (
      <div className={`flex min-h-[100dvh] flex-col items-center justify-center px-6 text-center ${bg}`}>
        <div className={`flex h-14 w-14 items-center justify-center rounded-2xl ${darkMode ? 'bg-red-950/30 text-red-400' : 'bg-red-50 text-red-500'}`}>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-7 h-7">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
        </div>
        <h3 className={`mt-5 text-base font-bold tracking-tight ${textPrimary}`}>Enlace no disponible</h3>
        <p className={`mt-1.5 text-xs max-w-[260px] leading-relaxed ${textSecondary}`}>
          {error}
        </p>
        <button
          onClick={() => { triggerHaptic([30]); void loadAndSyncTicket(); }}
          className="mt-5 rounded-xl bg-sky-400 px-5 py-2.5 text-xs font-bold text-white transition active:scale-95 active-scale"
        >
          Reintentar
        </button>
      </div>
    );
  }

  // ══════════════════════════════════════
  // VISTA 1: DASHBOARD MULTI-PEDIDO
  // ══════════════════════════════════════
  if (selectedToken === null || currentDelivered) {
    const activeList = getActiveOrdered();
    const completedList = deliveries
      .filter(d => d.delivered)
      .sort((a, b) => {
        const timeA = a.deliveredAt || a.scannedAt || 0;
        const timeB = b.deliveredAt || b.scannedAt || 0;
        return timeB - timeA;
      });

    const totalCashAmount = activeList
      .filter(d => d.data.paymentMethod === 'CASH')
      .reduce((sum, d) => sum + d.data.totalAmount, 0);
    const totalCashCollected = completedList
      .filter(d => d.data.paymentMethod === 'CASH')
      .reduce((sum, d) => sum + d.data.totalAmount, 0);
    // Informativo: suma exacta del total de cada envío YA entregado en el turno.
    // No afecta ganancias ni cobros (ese dinero es del restaurante); algunos
    // restaurantes entregan los envíos a sus propios repartidores.
    const totalDeliveredAmount = completedList
      .reduce((sum, d) => sum + d.data.totalAmount, 0);
    // El "Turno" se ancla al scan más antiguo de las entregas AÚN ACTIVAS
    // (no entregadas). Si todas están entregadas, se toma el scan más reciente
    // como referencia para que el contador no se dispare con jornadas previas.
    const activeScanTimes = activeList
      .map((d) => d.scannedAt || 0)
      .filter((t) => t > 0);
    const firstScan = activeScanTimes.length > 0
      ? Math.min(...activeScanTimes)
      : deliveries.length > 0
        ? Math.max(...deliveries.map((d) => d.scannedAt || 0))
        : shiftNow;
    const shiftMinutes = Math.max(0, Math.floor((shiftNow - firstScan) / 60000));
    const shiftHours = Math.floor(shiftMinutes / 60);
    const shiftMinLeft = shiftMinutes % 60;
    const shiftTimeLabel = shiftHours > 0 ? `${shiftHours}h ${shiftMinLeft}min` : `${shiftMinutes}min`;
    const nextStop = activeList.length > 0 ? activeList[0] : null;

    return (
      <div className={`min-h-[100dvh] font-sans antialiased pb-12 transition-colors duration-300 ${darkMode ? 'bg-[#09090b]' : 'bg-[#f7f7f8]'} ${textPrimary}`}>
        {error && (
          <div className="mx-auto flex max-w-lg items-center justify-between gap-3 px-4 py-3 text-sm">
            <p role="status">{error}</p>
            <button type="button" onClick={() => void loadAndSyncTicket()} className="min-h-11 shrink-0 font-bold underline">Reintentar</button>
          </div>
        )}
        
        {/* ── HEADER CON "AGREGAR ENTREGA" ── */}
        <header className="wl-header wl-official-header sticky top-0 z-50 pt-[env(safe-area-inset-top)]">
          <div className="wl-delivery-header-inner">
            <div className="wl-delivery-brand" aria-label="WingsLab Reparto">
              <img className="wl-logo-on-light" src={redWordmark.src} alt="" />
              <img className="wl-logo-on-dark" src={whiteWordmark.src} alt="" />
              <span>Reparto</span>
            </div>
            <div className="flex shrink-0 items-center">
              <button
                type="button"
                onClick={openAddModal}
                className="flex min-h-11 items-center gap-1.5 rounded-full bg-red-700 px-3.5 text-xs font-bold text-white shadow-sm transition hover:bg-red-800 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="3" stroke="currentColor" className="w-3.5 h-3.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                <span>Agregar entrega</span>
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-lg px-4 pb-20">

          {/* ── PANEL "MI JORNADA" (Métricas reales del turno) ── */}
          <div className={`mt-4 overflow-hidden rounded-[24px] border p-4 shadow-[0_8px_24px_rgba(0,0,0,0.04)] transition-all ${
            darkMode 
              ? 'bg-gradient-to-br from-zinc-900 via-zinc-900 to-red-950/30 border-zinc-800' 
              : 'bg-gradient-to-br from-white via-white to-red-50 border-black/[0.06]'
          }`}>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"><Route className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" /></span>
                <div>
                <h2 className={`text-lg font-black tracking-tight ${textPrimary}`}>
                  Tu jornada
                </h2>
                <p className={`mt-0.5 text-sm font-medium ${darkMode ? 'text-zinc-300' : 'text-neutral-600'}`}>Resumen de tus entregas</p>
                </div>
              </div>
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wide ${
                darkMode 
                  ? 'border-zinc-700 bg-zinc-800/70 text-zinc-200' 
                  : 'border-neutral-200 bg-white text-neutral-700'
              }`}>
                <span className={`h-1.5 w-1.5 rounded-full ${activeList.length > 0 ? 'bg-emerald-500' : 'bg-neutral-400'}`} />
                {activeList.length > 0 ? 'En curso' : 'Sin pendientes'}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 min-[390px]:grid-cols-4">
              {[
                { label: 'Tiempo', value: shiftTimeLabel, Icon: Clock },
                { label: 'Kilómetros', value: `${kmDriven.toFixed(1)} km`, Icon: Route },
                { label: 'Pendientes', value: activeList.length, Icon: Package },
                { label: 'Entregadas', value: completedList.length, Icon: Check },
              ].map(({ label, value, Icon }) => (
                <div key={label} className={`min-w-0 rounded-xl px-3 py-3 ${darkMode ? 'bg-zinc-800' : 'bg-neutral-100'}`}>
                  <Icon className={`h-4 w-4 ${darkMode ? 'text-red-400' : 'text-red-700'}`} strokeWidth={2} aria-hidden="true" />
                  <p className={`mt-1.5 break-words text-base font-black leading-tight tabular-nums ${textPrimary}`}>{value}</p>
                  <p className={`mt-1 text-xs font-semibold leading-tight ${darkMode ? 'text-zinc-300' : 'text-neutral-700'}`}>{label}</p>
                </div>
              ))}
            </div>

            {/* Total generado de envíos entregados (informativo) */}
            {totalDeliveredAmount > 0 && (
              <div className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-3 dark:border-zinc-800">
                <span className={`text-xs font-bold ${darkMode ? 'text-zinc-300' : 'text-neutral-700'}`}>
                  Total de pedidos entregados
                </span>
                <span className={`text-lg font-extrabold tabular-nums ${darkMode ? 'text-emerald-400' : 'text-emerald-700'}`}>
                  ${totalDeliveredAmount.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                </span>
              </div>
            )}

            {/* Siguiente parada */}
            {nextStop && (
              <button
                type="button"
                onClick={() => setSelectedToken(nextStop.token)}
                className={`mt-5 w-full flex items-center gap-3 rounded-xl border p-3 text-left transition active:scale-[0.99] active-scale ${
                  darkMode 
                    ? 'border-zinc-800 bg-zinc-800/30 hover:bg-zinc-800/60' 
                    : 'border-black/[0.05] bg-neutral-50 hover:bg-neutral-100/70'
                }`}
              >
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                  darkMode ? 'bg-red-400/10 text-red-300' : 'bg-red-50 text-red-600'
                }`}>1</span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-[10px] font-medium uppercase tracking-wider ${textTertiary}`}>Siguiente parada</span>
                  <span className={`block text-sm font-semibold truncate mt-0.5 ${textPrimary}`}>{fullCustomerName(nextStop.data.customer)}</span>
                  <span className={`block text-[11px] truncate mt-0.5 ${textSecondary}`}>
                    {nextStop.data.deliveryAddress.street} {nextStop.data.deliveryAddress.number}
                  </span>
                </span>
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className={`w-4 h-4 shrink-0 ${textTertiary}`}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                </svg>
              </button>
            )}
          </div>

          {/* ── BANNER ALERTA DE COBRO EN EFECTIVO TOTAL ── */}
          {(totalCashAmount > 0 || totalCashCollected > 0) && (
            <div className={`mt-3 flex items-center gap-3 rounded-2xl px-4 py-3.5 border transition-all ${
              darkMode 
                ? 'bg-amber-950/20 border-amber-900/30' 
                : 'bg-amber-50 border-amber-200/50'
            }`}>
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${darkMode ? 'bg-amber-400/10 text-amber-300' : 'bg-amber-100 text-amber-700'}`}><Banknote className="h-5 w-5" aria-hidden="true" /></span>
              <div className="flex-1 min-w-0">
                <p className={`text-[10px] font-bold uppercase tracking-wider ${darkMode ? 'text-amber-400' : 'text-amber-700'}`}>
                  {totalCashAmount > 0 ? 'Efectivo por cobrar' : 'Efectivo cobrado'}
                </p>
                <p className={`text-xl font-black tracking-tight mt-0.5 ${darkMode ? 'text-amber-300' : 'text-amber-950'}`}>
                  ${(totalCashAmount > 0 ? totalCashAmount : totalCashCollected).toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                </p>
              </div>
              {totalCashAmount > 0 && (
                <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${
                  darkMode ? 'bg-amber-400/10 text-amber-300' : 'bg-amber-100 text-amber-800'
                }`}>
                  {totalCashCollected > 0 ? `+${totalCashCollected.toLocaleString('es-MX', { minimumFractionDigits: 0 })} cobrado` : 'pendiente de cobro'}
                </span>
              )}
            </div>
          )}

          {/* ── RUTA INTELIGENTE ── */}
          {activeList.length >= 2 && (
            <div className={`mt-4 rounded-2xl border p-4 transition-all ${
              routeOrder && routeOrder.length > 0
                ? (darkMode ? 'bg-emerald-950/20 border-emerald-900/40' : 'bg-emerald-50 border-emerald-200/60')
                : (darkMode ? 'bg-zinc-900/40 border-zinc-800' : 'bg-white border-black/[0.04]')
            }`}>
              {routeOrder && routeOrder.length > 0 ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-base ${
                      darkMode ? 'bg-emerald-400/10 text-emerald-300' : 'bg-emerald-100 text-emerald-700'
                    }`}><Route className="h-4 w-4" aria-hidden="true" /></span>
                    <div className="min-w-0">
                      <p className={`text-xs font-black uppercase tracking-wider ${darkMode ? 'text-emerald-300' : 'text-emerald-700'}`}>
                        Ruta inteligente
                      </p>
                      <p className={`text-[11px] mt-0.5 truncate ${textSecondary}`}>
                        {activeList.length} paradas ordenadas
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleUndoRoute}
                    className={`shrink-0 rounded-xl px-3 py-2 text-[11px] font-bold transition active:scale-95 active-scale border ${
                      darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-black/[0.08] text-neutral-600 hover:bg-neutral-100'
                    }`}
                  >
                    Deshacer
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleOptimizeRoute}
                  className="w-full flex items-center justify-between gap-3 text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-base ${
                      darkMode ? 'bg-red-400/10 text-red-300' : 'bg-red-50 text-red-500'
                    }`}><Route className="h-4 w-4" aria-hidden="true" /></span>
                    <div className="min-w-0">
                      <p className={`text-xs font-black uppercase tracking-wider ${textPrimary}`}>
                        Ordenar mi ruta
                      </p>
                      <p className={`text-[11px] mt-0.5 truncate ${textSecondary}`}>
                        Ordena las {activeList.length} entregas por cercanía y tiempo
                      </p>
                    </div>
                  </div>
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className={`w-4 h-4 shrink-0 ${textTertiary}`}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                  </svg>
                </button>
              )}
            </div>
          )}

          {/* ── LISTADO DE PEDIDOS ACTIVOS ── */}
          <div className="mt-6">
            <p className={`mb-3 text-xs font-extrabold uppercase tracking-wide ${darkMode ? 'text-zinc-300' : 'text-neutral-700'}`}>
              Ruta activa ({activeList.length})
            </p>

            {activeList.length === 0 ? (
              <div className={`flex items-center gap-3 rounded-2xl border px-4 py-4 ${
                darkMode ? 'border-zinc-800 bg-zinc-900/20' : 'border-neutral-200 bg-white'
              }`}>
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600">
                  <Check className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h3 className={`text-base font-extrabold tracking-tight ${textPrimary}`}>{completedList.length ? 'Ruta completada' : 'Sin entregas pendientes'}</h3>
                  <p className={`mt-1 text-sm font-medium leading-snug ${darkMode ? 'text-zinc-300' : 'text-neutral-600'}`}>Agrega una entrega desde el encabezado para comenzar.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3.5">
                {activeList.map((deliv, index) => {
                  const isCash = deliv.data.paymentMethod === 'CASH';
                  const addressObj = deliv.data.deliveryAddress;
                  if (!addressObj) return null;
                  const addressText = `${addressObj.street} ${addressObj.number}, ${addressObj.neighborhood}, ${addressObj.city}`;
                  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressText)}`;
                  const wazeUrl = addressObj.latitude && addressObj.longitude
                    ? `https://waze.com/ul?ll=${addressObj.latitude},${addressObj.longitude}&navigate=yes`
                    : null;

                  return (
                    <div
                      key={deliv.token}
                      className={`group relative rounded-[24px] border p-4 sm:p-5 shadow-[0_6px_22px_rgba(0,0,0,0.05)] ${cardBg} ${cardBorder}`}
                    >
                      {/* Botón Quitar de Ruta (Trash) */}
                      <button
                        type="button"
                        onClick={(e) => handleRemoveDelivery(deliv.token, e)}
                        className={`absolute top-3 right-3 flex h-11 w-11 items-center justify-center rounded-xl transition-all border ${
                          darkMode 
                            ? 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-red-400 hover:bg-zinc-800' 
                            : 'bg-neutral-50 border-neutral-100 text-neutral-400 hover:text-red-500 hover:bg-neutral-100'
                        }`}
                        title="Quitar de ruta"
                        aria-label={`Quitar de ruta la entrega de ${fullCustomerName(deliv.data.customer)}`}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-3.5 h-3.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.34 9a4.847 4.847 0 0 1-3.637-3.637L10 9m0 9v-6M4 6h16M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>

                      {/* AREA PRINCIPAL CLICKABLE (Abre Detalles + elige como siguiente) */}
                      <div 
                        onClick={() => handleChooseAsNext(deliv.token)}
                        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); handleChooseAsNext(deliv.token); } }}
                        role="button"
                        tabIndex={0}
                        aria-label={`Ver entrega de ${fullCustomerName(deliv.data.customer)}`}
                        className="cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                      >
                        {/* Fila superior: Índice y Pago */}
                        <div className="flex items-center gap-3 pr-12">
                          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-black shadow-sm ${
                            index === 0
                              ? (darkMode ? 'bg-red-400/20 text-red-300' : 'bg-red-600 text-white')
                              : (darkMode ? 'bg-red-400/10 text-red-300' : 'bg-red-50 text-red-500')
                          }`}>
                            {index + 1}
                          </span>
                          <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
                            isCash 
                              ? darkMode 
                                ? 'bg-amber-950/20 text-amber-400 border-amber-900/30' 
                                : 'bg-amber-50 text-amber-700 border-amber-200/50'
                              : darkMode 
                                ? 'bg-emerald-950/20 text-emerald-400 border-emerald-900/30' 
                                : 'bg-emerald-50 text-emerald-700 border-emerald-200/50'
                          }`}>
                            {isCash ? `Cobrar: $${deliv.data.totalAmount.toFixed(2)}` : deliv.data.paymentMethod === 'TRANSFER' ? 'Pagado por transferencia' : 'Pagado en línea'}
                          </span>
                        </div>

                        {/* Nombre del Cliente + número diario del pedido */}
                        <h3 className={`text-base font-extrabold tracking-tight mt-3 truncate pr-8 ${textPrimary}`}>
                          {typeof deliv.data.dailyCounter === 'number' && (
                            <span className={`mr-1.5 align-middle ${
                              darkMode ? 'text-neutral-400' : 'text-neutral-500'
                            }`}>
                              #{String(deliv.data.dailyCounter).padStart(2, '0')} ·
                            </span>
                          )}
                          {fullCustomerName(deliv.data.customer)}
                        </h3>

                        {/* Dirección */}
                        <div className="flex items-start gap-2 mt-2">
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className={`w-4 h-4 shrink-0 mt-0.5 ${textTertiary}`}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
                          </svg>
                          <div className="min-w-0 flex-1">
                            <p className={`text-xs font-bold leading-tight ${textPrimary}`}>
                              {addressObj.street} {addressObj.number}
                            </p>
                            <p className={`text-[11px] mt-0.5 truncate ${textSecondary}`}>
                              {addressObj.neighborhood}, {addressObj.city}
                            </p>
                          </div>
                        </div>

                        {/* Notas/Referencias de entrega */}
                        {addressObj.reference && (
                          <div className={`mt-2.5 rounded-2xl px-3 py-2 text-[11px] leading-relaxed flex gap-2 border ${
                            darkMode 
                              ? 'bg-zinc-900/40 border-zinc-800 text-zinc-300' 
                              : 'bg-neutral-50 border-black/[0.03] text-neutral-600'
                          }`}>
                            <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
                            <span className="break-words">{addressObj.reference}</span>
                          </div>
                        )}

                        {/* Fila de detalles: Restaurante y Estado */}
                        <div className={`flex items-center justify-between mt-3.5 pt-3 border-t ${darkMode ? 'border-white/[0.04]' : 'border-black/[0.03]'}`}>
                          <span className={`text-[10px] font-bold tracking-wide truncate ${textTertiary}`}>
                            {deliv.data.isSupportDelivery ? `Recoger en: ${deliv.data.restaurant.name}` : deliv.data.restaurant.name}
                          </span>
                          
                          <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            deliv.arrived
                              ? darkMode ? 'bg-emerald-950/20 text-emerald-400' : 'bg-emerald-50 text-emerald-700'
                              : darkMode ? 'bg-zinc-800 text-zinc-400' : 'bg-neutral-100 text-neutral-500'
                          }`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${deliv.arrived ? 'bg-emerald-400' : 'bg-zinc-400'}`} />
                            {deliv.data.isSupportDelivery && !deliv.pickedUp
                              ? 'En recogida'
                              : deliv.data.isOwnDelivery && deliv.data.status === 'READY' ? 'Listo para recoger' : deliv.arrived ? 'En destino' : 'En camino'}
                          </span>
                        </div>
                      </div>

                      {/* ACCIONES RÁPIDAS (Fila inferior de botones) */}
                      <div className={`flex flex-wrap items-center gap-2 mt-4 pt-3.5 border-t ${darkMode ? 'border-white/[0.05]' : 'border-black/[0.04]'}`}>
                        
                        {/* Navegar - Google Maps */}
                        <a
                          href={googleMapsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => { e.stopPropagation(); triggerHaptic([30]); }}
                          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-all active:scale-90 border ${
                            darkMode 
                              ? 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800' 
                              : 'bg-white border-black/[0.06] text-neutral-700 hover:bg-neutral-50'
                          }`}
                          title="Google Maps"
                          aria-label="Abrir dirección en Google Maps"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.2" stroke="currentColor" className="w-5 h-5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
                          </svg>
                        </a>

                        {/* Navegar - Waze (si tiene coordenadas) */}
                        {wazeUrl && (
                          <a
                            href={wazeUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => { e.stopPropagation(); triggerHaptic([30]); }}
                            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-all active:scale-90 border ${
                              darkMode 
                                ? 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800' 
                                : 'bg-white border-black/[0.06] text-neutral-700 hover:bg-neutral-50'
                            }`}
                            title="Navegar con Waze"
                            aria-label="Navegar con Waze"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.2" stroke="currentColor" className="w-5 h-5">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
                            </svg>
                          </a>
                        )}
                        {/* Llamar */}
                        <a
                          href={`tel:${deliv.data.customer.phone}`}
                          onClick={(e) => { e.stopPropagation(); triggerHaptic([30]); }}
                          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-all active:scale-90 border ${
                            darkMode 
                              ? 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800' 
                              : 'bg-white border-black/[0.06] text-neutral-700 hover:bg-neutral-50'
                          }`}
                          title="Llamar"
                          aria-label="Llamar al cliente"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                            <path fillRule="evenodd" d="M1.5 4.5a3 3 0 0 1 3-3h1.372c.86 0 1.61.586 1.819 1.42l1.105 4.423a1.875 1.875 0 0 1-.694 1.955l-1.293.97a15.216 15.216 0 0 0 5.58 5.58l.97-1.293a1.875 1.875 0 0 1 1.955-.694l4.423 1.105c.834.209 1.42.959 1.42 1.82V19.5a3 3 0 0 1-3 3h-2.25C8.552 22.5 1.5 15.448 1.5 6.75V4.5Z" clipRule="evenodd" />
                          </svg>
                        </a>

                        <div className="flex-1" />

                        {/* Acción Principal: Llegué o Entregar */}
                        {deliv.data.isOwnDelivery && deliv.data.status === 'READY' ? (
                          <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedToken(deliv.token); }} className="flex items-center justify-center gap-1.5 rounded-2xl border border-neutral-900 bg-neutral-900 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-neutral-800 active:scale-95 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700">
                            <Package className="h-4 w-4" aria-hidden="true" /> Tengo el pedido
                          </button>
                        ) : deliv.data.isSupportDelivery && !deliv.pickedUp ? (
                          isWaitingHandover(deliv.token) ? (
                            <button
                              type="button"
                              disabled
                              className={`flex items-center justify-center gap-1.5 rounded-2xl py-2.5 px-4 text-xs font-bold border ${
                                darkMode 
                                  ? 'bg-emerald-400/10 text-emerald-300 border-emerald-400/20' 
                                  : 'bg-emerald-50 text-emerald-600 border-emerald-200'
                              }`}
                            >
                              <div className={`h-3.5 w-3.5 animate-spin rounded-full border-2 ${darkMode ? 'border-emerald-300/40 border-t-emerald-300' : 'border-emerald-500/30 border-t-emerald-600'}`} />
                              <span>Esperando confirmación</span>
                            </button>
                          ) : (
                          <button
                            type="button"
                            disabled={notifying}
                            onClick={(e) => { e.stopPropagation(); void handleLlegueRestauranteForToken(deliv.token); }}
                            className={`flex items-center justify-center gap-1.5 rounded-2xl py-2.5 px-4 text-xs font-bold transition-all active:scale-95 active-scale disabled:opacity-50 border shadow-sm ${
                              darkMode 
                                ? 'bg-sky-400/10 text-sky-300 border-sky-400/20 hover:bg-sky-400/20'
                                : 'bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100'
                            }`}
                          >
                            {notifying ? (
                              <div className={`h-3.5 w-3.5 animate-spin rounded-full border-2 ${darkMode ? 'border-sky-300/40 border-t-sky-300' : 'border-sky-400/30 border-t-sky-500'}`} />
                            ) : (
                              <Store className="h-4 w-4" aria-hidden="true" />
                            )}
                            <span>¡Llegué al restaurante!</span>
                          </button>
                          )
                        ) : deliv.data.isSupportDelivery && deliv.pickedUp && deliv.data.status === 'PICKED_UP' ? (
                          <button
                            type="button"
                            disabled={notifying}
                            onClick={(e) => { e.stopPropagation(); void handleLlegueRestauranteForToken(deliv.token); }}
                            className={`flex items-center justify-center gap-1.5 rounded-2xl py-2.5 px-4 text-xs font-bold transition-all active:scale-95 active-scale disabled:opacity-50 border shadow-sm ${
                              darkMode 
                                ? 'bg-emerald-400/10 text-emerald-300 border-emerald-400/20 hover:bg-emerald-400/20' 
                                : 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100'
                            }`}
                          >
                            {notifying ? (
                              <div className={`h-3.5 w-3.5 animate-spin rounded-full border-2 ${darkMode ? 'border-emerald-300/40 border-t-emerald-300' : 'border-emerald-500/30 border-t-emerald-600'}`} />
                            ) : (
                              <Route className="h-4 w-4" aria-hidden="true" />
                            )}
                            <span>Iniciar entrega</span>
                          </button>
                        ) : !deliv.arrived ? (
                          <button
                            type="button"
                            disabled={notifying}
                            onClick={(e) => { e.stopPropagation(); void handleLlegueForToken(deliv.token); }}
                            className={`flex items-center justify-center gap-1.5 rounded-2xl py-2.5 px-4 text-xs font-bold transition-all active:scale-95 active-scale disabled:opacity-50 border shadow-sm ${
                              darkMode 
                                ? 'bg-sky-400/10 text-sky-300 border-sky-400/20 hover:bg-sky-400/20'
                                : 'bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100'
                            }`}
                          >
                            {notifying ? (
                              <div className={`h-3.5 w-3.5 animate-spin rounded-full border-2 ${darkMode ? 'border-sky-300/40 border-t-sky-300' : 'border-sky-400/30 border-t-sky-500'}`} />
                            ) : (
                              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-4 h-4">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
                              </svg>
                            )}
                            <span>¡Ya llegué!</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); if (deliv.data.isOwnDelivery && deliv.data.paymentMethod !== 'CASH') setSelectedToken(deliv.token); else handleDeliverDirectly(deliv.token); }}
                            className="flex items-center justify-center gap-1.5 rounded-2xl py-2.5 px-5 text-xs font-black uppercase tracking-wider transition-all active:scale-[0.97] active-scale bg-red-600 text-white hover:bg-red-500 shadow-[0_4px_14px_0_rgba(220,38,38,0.3)]"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="3" stroke="currentColor" className="w-4 h-4">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75 6 6 9-13.5" />
                            </svg>
                            <span>Entregar</span>
                          </button>
                        )}

                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── COMPLETADOS (Historial Elegante) ── */}
          {completedList.length > 0 && (
            <div className="mt-8">
              <p className={`mb-3 text-xs font-extrabold uppercase tracking-wide ${darkMode ? 'text-zinc-300' : 'text-neutral-700'}`}>
                Completados ({completedList.length})
              </p>
              <div className="space-y-2">
                {completedList.map(deliv => (
                  <button
                    key={deliv.token}
                    onClick={() => { triggerHaptic([30]); setSelectedToken(deliv.token); }}
                    className={`w-full text-left flex items-center justify-between rounded-2xl px-5 py-3.5 border transition active:scale-[0.98] active-scale ${cardBorder} ${
                      darkMode 
                        ? 'bg-zinc-900/30 hover:bg-zinc-900/60 text-zinc-400' 
                        : 'bg-white hover:bg-neutral-50/50 text-neutral-600'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        darkMode ? 'bg-emerald-950/40 text-emerald-400' : 'bg-emerald-50 text-emerald-600'
                      }`}>✓</span>
                      
                      <div className="min-w-0">
                        <span className={`block truncate text-sm font-extrabold ${darkMode ? 'text-zinc-100' : 'text-neutral-900'}`}>
                          {deliv.data.customer.name}
                        </span>
                        <span className={`mt-0.5 block text-xs font-semibold ${darkMode ? 'text-zinc-300' : 'text-neutral-600'}`}>
                          {deliv.data.dailyCounter != null ? `Pedido #${String(deliv.data.dailyCounter).padStart(2, '0')}` : 'Número de pedido no disponible'}
                        </span>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2.5 shrink-0">
                      <span className={`text-sm font-extrabold ${darkMode ? 'text-zinc-200' : 'text-neutral-800'}`}>
                        ${deliv.data.totalAmount.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                      </span>
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="3" stroke="currentColor" className={`w-3 h-3 ${
                        darkMode ? 'text-zinc-700' : 'text-neutral-300'
                      }`}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                      </svg>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </main>

        {/* ── MODAL "AGREGAR ENTREGA" ── */}
        {showAddModal && (
          <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center p-4">
            <style dangerouslySetInnerHTML={{ __html: `
              @keyframes modalFadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
              }
              @keyframes modalScaleUp {
                from { transform: scale(0.96); opacity: 0; }
                to { transform: scale(1); opacity: 1; }
              }
              .animate-modal-fade-in {
                animation: modalFadeIn 0.2s ease-out forwards;
              }
              .animate-modal-scale-up {
                animation: modalScaleUp 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
              }
            `}} />

            <div
              className="absolute inset-0 bg-black/45 backdrop-blur-[2px] animate-modal-fade-in"
              onClick={closeAddModal}
            />

            <div className={`relative w-full max-w-sm overflow-hidden rounded-[28px] border p-6 shadow-2xl animate-modal-scale-up ${cardBg} ${cardBorder}`}>
              <div className="text-center">
                <h3 className={`text-base font-extrabold tracking-tight ${textPrimary}`}>Agregar entrega</h3>
                <p className={`mt-1.5 text-xs ${textSecondary}`}>
                  Escanea el QR del pedido o pega el enlace para sumarlo a tu ruta.
                </p>
              </div>

              {/* Selector de modo */}
              <div className={`mt-4 grid grid-cols-2 gap-1 rounded-2xl p-1 border ${darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-neutral-100 border-black/[0.04]'}`}>
                <button
                  type="button"
                  onClick={() => switchAddMode('qr')}
                  className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold transition ${
                    addMode === 'qr'
                      ? 'bg-red-600 text-white shadow-sm'
                      : darkMode ? 'text-zinc-400' : 'text-neutral-500'
                  }`}
                >
                  📷 Escanear QR
                </button>
                <button
                  type="button"
                  onClick={() => switchAddMode('link')}
                  className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold transition ${
                    addMode === 'link'
                      ? 'bg-red-600 text-white shadow-sm'
                      : darkMode ? 'text-zinc-400' : 'text-neutral-500'
                  }`}
                >
                  🔗 Pegar enlace
                </button>
              </div>

              {/* Contenido según modo */}
              {addMode === 'qr' ? (
                <div className="mt-4">
                  <div
                    id={scannerContainerId}
                    className="w-full overflow-hidden rounded-2xl border bg-black"
                    style={{ minHeight: '220px' }}
                  />
                  <p className={`mt-2 text-center text-[10px] ${textTertiary}`}>
                    Apunta la cámara al código QR del pedido.
                  </p>
                </div>
              ) : (
                <div className="mt-4">
                  <input
                    type="text"
                    inputMode="url"
                    value={linkInput}
                    onChange={(e) => setLinkInput(e.target.value)}
                    placeholder="Pega aquí el enlace del QR…"
                    className={`w-full rounded-2xl border px-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400/50 transition-all ${
                      darkMode
                        ? 'border-zinc-800 bg-[#0a0a0a] text-white placeholder:text-zinc-700'
                        : 'border-neutral-200 bg-neutral-50 text-neutral-900 placeholder:text-neutral-400'
                    }`}
                  />
                  <button
                    type="button"
                    disabled={adding || !linkInput.trim()}
                    onClick={handleAddByLink}
                    className="mt-3 w-full rounded-2xl bg-red-600 py-3.5 text-xs font-black uppercase tracking-wider text-white hover:bg-red-500 transition active:scale-[0.98] active-scale disabled:opacity-40 shadow-[0_4px_14px_0_rgba(220,38,38,0.3)]"
                  >
                    {adding ? 'Agregando…' : 'Agregar a la ruta'}
                  </button>
                </div>
              )}

              {addError && (
                <div className={`mt-3 rounded-2xl px-4 py-3 text-xs font-semibold border ${
                  darkMode ? 'bg-red-950/20 border-red-900/40 text-red-400' : 'bg-red-50 border-red-200/60 text-red-600'
                }`}>
                  {addError}
                </div>
              )}

              <button
                type="button"
                onClick={closeAddModal}
                className={`mt-4 w-full rounded-2xl border py-3 text-xs font-bold transition active:scale-[0.97] active-scale ${
                  darkMode 
                    ? 'border-zinc-800 text-zinc-300 bg-zinc-900/40 hover:bg-zinc-800' 
                    : 'border-neutral-200 text-neutral-600 bg-neutral-50 hover:bg-neutral-100'
                }`}
              >
                Cerrar
              </button>
            </div>
          </div>
        )}
        {currentDelivered && currentTicket && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="delivery-completed-title">
            <div className={`relative max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto rounded-[28px] border p-5 text-center shadow-2xl sm:p-6 ${cardBg} ${cardBorder}`}>
              <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${darkMode ? 'bg-emerald-950/50 text-emerald-400' : 'bg-emerald-50 text-emerald-600'}`}>
                <svg aria-hidden="true" className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4.5 4.5L19 7" /></svg>
              </div>
              <h2 id="delivery-completed-title" className={`mt-4 text-xl font-extrabold tracking-tight ${textPrimary}`}>¡Entrega completada!</h2>
              <p className={`mt-1.5 text-sm ${textSecondary}`}>Entregado a {fullCustomerName(currentTicket.customer)}</p>
              <div className={`mt-5 rounded-2xl border p-4 text-left ${darkMode ? 'border-zinc-700 bg-zinc-800/60' : 'border-neutral-100 bg-neutral-50'}`}>
                <div className="flex items-start justify-between gap-3 text-sm"><span className={textSecondary}>Pedido</span><span className={`break-all text-right font-semibold ${textPrimary}`}>{currentTicket.orderReference}</span></div>
                <div className="mt-3 flex items-center justify-between gap-3 text-sm"><span className={textSecondary}>Pago</span><span className={`text-right font-semibold ${textPrimary}`}>{currentTicket.paymentMethod === 'CASH' ? 'Efectivo' : currentTicket.paymentMethod === 'TRANSFER' ? 'Transferencia' : 'En línea'}</span></div>
                <div className={`mt-3 flex items-center justify-between border-t pt-3 text-sm ${divider}`}><span className={textSecondary}>Total</span><span className={`text-lg font-extrabold ${textPrimary}`}>${currentTicket.totalAmount.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span></div>
              </div>
              {currentTicket.customer.phone && <div className="mt-4 flex gap-2">                <a href={`tel:${currentTicket.customer.phone}`} className={`flex min-h-12 flex-1 items-center justify-center rounded-2xl border px-3 text-sm font-bold ${cardBorder} ${textPrimary}`}>Llamar</a>
              </div>}
              <button type="button" onClick={() => { triggerHaptic([40, 20]); setSelectedToken(null); }} className="mt-4 min-h-12 w-full rounded-2xl bg-red-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-red-700 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600">{activeCount > 0 ? `Volver al tablero · ${activeCount} pendientes` : 'Volver al tablero'}</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ══════════════════════════════════════
  // VISTA: PEDIDO NO ENCONTRADO
  // ══════════════════════════════════════
  if (!currentTicket) {
    return (
      <div className={`flex min-h-[100dvh] flex-col items-center justify-center px-4 text-center ${bg}`}>
        <p className={`text-xs ${textSecondary}`}>No se encontró información del pedido.</p>
        <button 
          onClick={() => setSelectedToken(null)} 
          className="mt-4 px-4 py-2 bg-sky-400 text-white rounded-xl text-xs font-bold transition active:scale-95 active-scale"
        >
          Volver
        </button>
      </div>
    );
  }

  const addressObj = currentTicket.deliveryAddress;
  if (!addressObj) return <p className="text-sm text-neutral-500">Dirección no disponible</p>;
  const addressText = `${addressObj.street} ${addressObj.number}, ${addressObj.neighborhood}, ${addressObj.city}`;
  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressText)}`;

  // Solo mostrar distancia con un GPS reciente del repartidor, nunca del restaurante.
  const hasFreshDriverPosition = driverPos && driverPositionAt !== null &&
    deliveryClock - driverPositionAt <= 120000 && driverPositionAt <= deliveryClock + 10000;
  const deliveryDistanceKm =
    hasFreshDriverPosition && driverPos && Number.isFinite(addressObj.latitude) && Number.isFinite(addressObj.longitude)
      ? haversineKm(
          driverPos.lat,
          driverPos.lng,
          addressObj.latitude,
          addressObj.longitude
        )
      : null;

  const isCash = currentTicket.paymentMethod === 'CASH';
  const isTransfer = currentTicket.paymentMethod === 'TRANSFER';
  const ownDeliveryAwaitingPickup = !!currentTicket.isOwnDelivery && currentTicket.status === 'READY';

  // ══════════════════════════════════════
  // FASE 1 (SOLO APOYO A RED): DIRÍGETE AL RESTAURANTE ORIGEN A RECOGER
  // ══════════════════════════════════════
  if (currentTicket.isSupportDelivery && !currentPickedUp && !currentSupportStarted) {
    const pickupName = currentTicket.restaurant.name;
    const pickupAddress = currentTicket.restaurant.address || 'Restaurante origen';
    const pickupMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pickupAddress)}`;
    const pickupWazeUrl = currentTicket.restaurant.latitude && currentTicket.restaurant.longitude
      ? `https://waze.com/ul?ll=${currentTicket.restaurant.latitude},${currentTicket.restaurant.longitude}&navigate=yes`
      : null;
    const isCashPickup = currentTicket.paymentMethod === 'CASH';

    // El repartidor YA llegó y el restaurante origen debe confirmar la entrega
    if (isWaitingHandover(selectedToken || '')) {
      const isTransferPickup = currentTicket.paymentMethod === 'TRANSFER';

      return (
        <div className={`min-h-[100dvh] font-sans antialiased pb-12 transition-colors duration-300 ${bg} ${textPrimary}`}>
          <header className={`sticky top-0 z-50 border-b backdrop-blur-md transition-all duration-300 pt-[env(safe-area-inset-top)] ${
            darkMode ? 'bg-[#09090b]/90 border-zinc-800/60' : 'bg-white/90 border-black/[0.04]'
          }`}>
            <div className="mx-auto flex max-w-lg items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                <span className={`flex h-7 w-7 items-center justify-center rounded-xl shadow-sm ${
                  darkMode ? 'bg-sky-400/10 text-sky-300' : 'bg-sky-50 text-sky-500'
                }`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-11.25v4.5m0 0H7.5m4.5 0h4.5" />
                  </svg>
                </span>
                <span className={`text-[12px] font-extrabold uppercase tracking-widest ${darkMode ? 'text-zinc-200' : 'text-neutral-800'}`}>SaDeL Express</span>
              </div>
              <button
                type="button"
                onClick={() => { triggerHaptic([20]); setSelectedToken(null); }}
                className={`rounded-xl px-3 py-2 text-[11px] font-bold transition active:scale-95 active-scale border ${
                  darkMode ? 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800' : 'bg-white border-black/[0.06] text-neutral-700 hover:bg-neutral-50'
                }`}
              >
                Volver
              </button>
            </div>
          </header>

          <main className="mx-auto max-w-lg px-4 pb-20">
            <div className="mt-4 flex items-center gap-2">
              <span className={`text-[10px] font-black uppercase tracking-widest ${textTertiary}`}>Fase 1 de 2</span>
              <div className={`flex-1 h-1.5 overflow-hidden rounded-full ${darkMode ? 'bg-white/10' : 'bg-black/10'}`}>
                <div className="h-full w-1/2 bg-sky-400 rounded-full" />
              </div>
            </div>

            <div className={`mt-3 rounded-[28px] p-6 text-white shadow-[0_12px_40px_rgba(0,0,0,0.1)] ${
              darkMode ? 'bg-gradient-to-br from-emerald-800 to-emerald-950' : 'bg-gradient-to-br from-emerald-500 to-emerald-700'
            }`}>
              <div className="flex items-center gap-3">
                <span className="relative flex h-6 w-6">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-60" />
                  <span className="relative inline-flex h-6 w-6 rounded-full bg-white/30" />
                </span>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider opacity-80">Llegaste al restaurante</p>
                  <h1 className="text-2xl font-black tracking-tight mt-1">Esperando confirmación</h1>
                </div>
              </div>
              <p className="text-sm font-medium mt-3 opacity-95">
                Notificamos a <strong>{pickupName}</strong> que llegaste por el pedido{' '}
                <strong>#{currentTicket.orderReference}</strong> de{' '}
                <strong>{currentTicket.customer.name}</strong>. Entrégale lo necesario y espera
                a que confirme la entrega para iniciar el reparto.
              </p>
            </div>

            {/* Resumen del pedido: número y comensal */}
            <div className={`mt-4 rounded-[28px] border p-5 shadow-[0_4px_24px_rgba(0,0,0,0.015)] ${cardBg} ${cardBorder}`}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className={`text-[10px] font-black uppercase tracking-widest ${textTertiary}`}>Número de pedido</p>
                  <p className={`mt-1 text-lg font-black tracking-tight truncate ${textPrimary}`}>#{currentTicket.orderReference}</p>
                </div>
                <div className="min-w-0 text-right">
                  <p className={`text-[10px] font-black uppercase tracking-widest ${textTertiary}`}>Comensal</p>
                  <p className={`mt-1 text-lg font-black tracking-tight truncate ${textPrimary}`}>{currentTicket.customer.name}</p>
                </div>
              </div>
            </div>

            {/* PIN de entrega (transferencia): lo valida el restaurante origen */}
            {isTransferPickup && currentTicket.handoverPin && (
              <div className={`mt-4 rounded-[28px] border p-6 text-center shadow-[0_4px_24px_rgba(0,0,0,0.015)] ${cardBg} ${cardBorder}`}>
                <p className={`text-[10px] font-black uppercase tracking-widest ${textTertiary}`}>PIN de entrega</p>
                <p className={`mt-2 text-5xl font-black tracking-[0.4em] font-mono ${textPrimary}`}>
                  {currentTicket.handoverPin}
                </p>
                <p className={`mt-3 text-xs leading-relaxed ${textSecondary}`}>
                  Muéstrale este código al restaurante <strong className={textPrimary}>{pickupName}</strong>.
                  Ellos lo validarán para liberar la entrega y te pagarán el{' '}
                  <strong className={textPrimary}>envío</strong> en efectivo.
                </p>
                <div className={`mt-3 rounded-2xl border px-4 py-3 flex items-center justify-between ${
                  darkMode ? 'border-emerald-800/50 bg-emerald-950/30' : 'border-emerald-200 bg-emerald-50'
                }`}>
                  <span className={`text-[10px] font-black uppercase tracking-widest ${textTertiary}`}>Cobrarás por el envío</span>
                  <span className={`text-lg font-black ${darkMode ? 'text-emerald-300' : 'text-emerald-700'}`}>
                    {currentTicket.deliveryFee ? `$${currentTicket.deliveryFee.toFixed(2)}` : 'Tarifa de envío'}
                  </span>
                </div>
              </div>
            )}

            {/* Cobro en efectivo: solo el total del pedido, sin el envío */}
            {!isTransferPickup && (
              <div className={`mt-4 rounded-[28px] border p-5 shadow-[0_4px_24px_rgba(0,0,0,0.015)] ${cardBg} ${cardBorder}`}>
                <p className={`text-[10px] font-black uppercase tracking-widest ${textTertiary}`}>Cobro en la recogida</p>
                <p className={`mt-2 text-xs leading-relaxed ${textSecondary}`}>
                  El comensal te paga en <strong className={textPrimary}>efectivo el total al entregar</strong>.
                  De ese cobro te quedas <strong className={textPrimary}>{currentTicket.deliveryFee ? `$${currentTicket.deliveryFee.toFixed(2)}` : 'la tarifa'}</strong> por el envío;
                  el resto es del restaurante. Aquí solo recoges el pedido.
                </p>
              </div>
            )}

            <div className={`mt-5 flex items-center justify-center gap-2 rounded-2xl px-4 py-4 text-xs font-bold border ${
              darkMode ? 'bg-zinc-900 border-zinc-800 text-zinc-300' : 'bg-neutral-100 border-black/[0.06] text-neutral-600'
            }`}>
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              <span>Esperando confirmación del restaurante…</span>
            </div>
          </main>
        </div>
      );
    }

    return (
      <div className={`min-h-[100dvh] font-sans antialiased pb-12 transition-colors duration-300 ${bg} ${textPrimary}`}>
        <header className={`sticky top-0 z-50 border-b backdrop-blur-md transition-all duration-300 pt-[env(safe-area-inset-top)] ${
          darkMode ? 'bg-[#09090b]/90 border-zinc-800/60' : 'bg-white/90 border-black/[0.04]'
        }`}>
          <div className="mx-auto flex max-w-lg items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <span className={`flex h-7 w-7 items-center justify-center rounded-xl shadow-sm ${
                darkMode ? 'bg-sky-400/10 text-sky-300' : 'bg-sky-50 text-sky-500'
              }`}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0 1.5 1.5 0 0 1 3 0ZM18.75 18.75a1.5 1.5 0 0 1-3 0 1.5 1.5 0 0 1 3 0ZM6.75 18.75h10.5m-10.5-6h7.5L18 18.75m-6.75-6V8.25h5.25L18.75 12" />
                </svg>
              </span>
              <span className={`text-[12px] font-extrabold uppercase tracking-widest ${darkMode ? 'text-zinc-200' : 'text-neutral-800'}`}>SaDeL Express</span>
            </div>
            <button
              type="button"
              onClick={() => { triggerHaptic([20]); setSelectedToken(null); }}
              className={`rounded-xl px-3 py-2 text-[11px] font-bold transition active:scale-95 active-scale border ${
                darkMode ? 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800' : 'bg-white border-black/[0.06] text-neutral-700 hover:bg-neutral-50'
              }`}
            >
              Volver
            </button>
          </div>
        </header>

        <main className="mx-auto max-w-lg px-4 pb-20">
          <div className="mt-4 flex items-center gap-2">
            <span className={`text-[10px] font-black uppercase tracking-widest ${textTertiary}`}>Fase 1 de 2</span>
            <div className={`flex-1 h-1.5 overflow-hidden rounded-full ${darkMode ? 'bg-white/10' : 'bg-black/10'}`}>
              <div className="h-full w-1/2 bg-sky-400 rounded-full" />
            </div>
          </div>

          <div className={`mt-3 rounded-[28px] p-6 text-white shadow-[0_12px_40px_rgba(0,0,0,0.1)] ${
            darkMode ? 'bg-gradient-to-br from-sky-700 to-sky-900' : 'bg-gradient-to-br from-sky-400 to-sky-600'
          }`}>
            <p className="text-[10px] font-bold uppercase tracking-wider opacity-80">Recogida</p>
            <h1 className="text-2xl font-black tracking-tight mt-1">Dirígete al restaurante</h1>
            <p className="text-sm font-semibold mt-3 flex items-center gap-2">
              <Store className="h-5 w-5 shrink-0" aria-hidden="true" /> {pickupName}
            </p>
            <p className="text-xs mt-1 opacity-90">{pickupAddress}</p>
          </div>

          <div className={`mt-3 rounded-[28px] border p-5 shadow-[0_4px_24px_rgba(0,0,0,0.015)] ${cardBg} ${cardBorder}`}>
            <p className={`text-[10px] font-black uppercase tracking-widest ${textTertiary}`}>Cobro en la recogida</p>
            {isCashPickup ? (
              <p className={`mt-2 text-xs leading-relaxed ${textSecondary}`}>
                El comensal paga en <strong className={textPrimary}>efectivo el total</strong> al entregar. Aquí solo recoges el pedido.
              </p>
            ) : (
              <p className={`mt-2 text-xs leading-relaxed ${textSecondary}`}>
                El comensal ya pagó en línea (incluido el envío). Al recoger el pedido, el restaurante
                te entrega en efectivo el envío:{' '}
                <strong className={textPrimary}>{currentTicket.deliveryFee ? `$${currentTicket.deliveryFee.toFixed(2)}` : 'la tarifa de envío'}</strong>.
              </p>
            )}
            {currentTicket.supportRestaurant?.name && (
              <div className={`mt-3 flex items-center gap-2 rounded-2xl border px-3 py-2.5 text-xs font-bold ${
                darkMode ? 'bg-emerald-950/20 border-emerald-900/30 text-emerald-300' : 'bg-emerald-50 border-emerald-200/60 text-emerald-700'
              }`}>
                <span>🤝</span>
                <span>Entregas como: {currentTicket.supportRestaurant.name}</span>
              </div>
            )}
          </div>

          {/* Mapa de la recogida */}
          <div className={`mt-3 rounded-[28px] border p-5 shadow-[0_4px_24px_rgba(0,0,0,0.015)] ${cardBg} ${cardBorder}`}>
            {currentTicket.restaurant.latitude && currentTicket.restaurant.longitude && (
              <button
                type="button"
                onClick={() => { triggerHaptic([40]); setNavOpenFor('pickup'); }}
                className="w-full mb-3 flex items-center justify-center gap-2 rounded-2xl bg-sky-500 py-3.5 text-sm font-black text-white shadow-lg shadow-sky-500/30 transition active:scale-[0.97] hover:bg-sky-400"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
                  <circle cx="12" cy="9" r="2.5" />
                </svg>
                Navegar al restaurante
              </button>
            )}
            <div className="flex flex-col sm:flex-row gap-2.5">
              <a
                href={pickupMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => triggerHaptic([30])}
                className={`flex-1 flex items-center justify-center gap-1.5 rounded-2xl border py-3 text-xs font-bold transition active:scale-95 active-scale shadow-sm ${
                  darkMode ? 'bg-zinc-900 border-zinc-800 text-zinc-200 hover:bg-zinc-800' : 'bg-white border-black/[0.08] text-neutral-800 hover:bg-neutral-50'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75 3 9v11.25l6-2.25m0-11.25 6 2.25m-6-2.25V20.25m6-11.25 6-2.25V18l-6 2.25m0-11.25V20.25" />
                </svg>
                Google Maps
              </a>
              {pickupWazeUrl && (
                <a
                  href={pickupWazeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => triggerHaptic([30])}
                  className={`flex-1 flex items-center justify-center gap-1.5 rounded-2xl border py-3 text-xs font-bold transition active:scale-95 active-scale shadow-sm ${
                    darkMode ? 'bg-zinc-900 border-zinc-800 text-zinc-200 hover:bg-zinc-800' : 'bg-white border-black/[0.08] text-neutral-800 hover:bg-neutral-50'
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
                  </svg>
                  Waze
                </a>
              )}
            </div>
          </div>

          {llegueError && (
            <div className={`mt-3 rounded-2xl px-4 py-3 text-xs font-semibold border ${darkMode ? 'bg-red-950/20 border-red-900/40 text-red-400' : 'bg-red-50 border-red-200/60 text-red-600'}`}>
              {llegueError}
            </div>
          )}

          <button
            type="button"
            disabled={notifying}
            onClick={() => { triggerHaptic([40]); void handleLlegueRestaurante(); }}
            className="mt-6 w-full flex items-center justify-center gap-2 rounded-2xl bg-sky-600 py-4 text-sm font-black uppercase tracking-wider text-white hover:bg-sky-500 active:scale-[0.98] active-scale disabled:opacity-50 shadow-[0_8px_24px_0_rgba(14,165,233,0.3)] transition-all"
          >
            {notifying ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
              </svg>
            )}
            ¡Llegué al restaurante!
          </button>
        </main>

        {navOpenFor === 'pickup' && currentTicket.restaurant.latitude && currentTicket.restaurant.longitude && (
          <DriverTurnByTurnOverlay
            destination={{
              lat: currentTicket.restaurant.latitude,
              lng: currentTicket.restaurant.longitude,
              label: pickupName,
              emoji: '🏪',
            }}
            initialDriverPos={driverPos}
            dark={darkMode}
            onExit={() => setNavOpenFor(null)}
          />
        )}
      </div>
    );
  }

  // ══════════════════════════════════════
  // VISTA 2: DETALLE DEL PEDIDO (ACCIÓN)
  // ══════════════════════════════════════
  return (
    <div className={`min-h-[100dvh] font-sans antialiased pb-12 transition-colors duration-300 ${darkMode ? 'bg-[#09090b]' : 'bg-[#f7f7f8]'} ${textPrimary}`}>
      
      {/* ── HEADER DE DETALLE PREMIUM ── */}
      <header className="wl-header wl-official-header sticky top-0 z-50 pt-[env(safe-area-inset-top)]">
        <div className="wl-official-header-inner">
          <button
            type="button"
            onClick={() => { triggerHaptic([20]); setSelectedToken(null); }}
            className="wl-header-status"
            aria-label="Volver al tablero de reparto"
          >
            <svg className="wl-header-status-arrow" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="3" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
            <span>Volver</span>
          </button>
          <div className="wl-official-logo" aria-label="WingsLab Reparto">
            <img className="wl-logo-on-light" src={officialWordmark.src} width={783} height={229} alt="" fetchPriority="high" />
            <img className="wl-logo-on-dark" src={officialWhiteWordmark.src} width={783} height={229} alt="" />
          </div>
          <div className="wl-header-actions-right">
            <span className="wl-driver-header-status">
              <i aria-hidden="true" />
              Reparto
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-4 pb-20">

        {ownDeliveryAwaitingPickup && (
          <div className={`mt-4 rounded-[26px] border p-5 shadow-[0_8px_28px_rgba(0,0,0,0.04)] ${darkMode ? 'border-red-900/25 bg-gradient-to-br from-zinc-900 to-red-950/20' : 'border-red-100 bg-gradient-to-br from-white to-red-50/60'}`}>
            <div className="flex items-start gap-3">
              <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${darkMode ? 'bg-red-400/10 text-red-400' : 'bg-red-50 text-red-600'}`}>
                <Package className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className={`text-[10px] font-black uppercase tracking-[0.18em] ${darkMode ? 'text-red-400' : 'text-red-600'}`}>Pedido #{currentTicket.dailyCounter || currentTicket.orderReference}</p>
                <p className={`mt-1 text-sm leading-relaxed ${textSecondary}`}>{confirmedPickupToken === selectedToken ? 'Pedido revisado. Inicia la entrega cuando estés listo para salir.' : 'Revisa que llevas todos los productos antes de iniciar la entrega.'}</p>
              </div>
            </div>
            {llegueError && <p role="alert" className="mt-3 text-xs font-semibold text-red-600">{llegueError}</p>}
            <button type="button" disabled={notifying} onClick={() => {
              if (confirmedPickupToken === selectedToken) void handleLlegueRestaurante();
              else setReviewPickupToken(selectedToken);
            }} className={`mt-4 min-h-[52px] w-full rounded-2xl px-4 py-4 text-sm font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_10px_24px_-10px_rgba(0,0,0,0.55)] transition active:scale-[0.98] disabled:opacity-50 ${
              confirmedPickupToken === selectedToken
                ? 'border border-red-500/60 bg-neutral-900 ring-1 ring-red-500/30 hover:bg-neutral-800 dark:border-red-500/50 dark:bg-zinc-800 dark:hover:bg-zinc-700'
                : 'border border-neutral-900 bg-neutral-900 hover:bg-neutral-800 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700'
            }`}>
              {notifying ? 'Iniciando…' : confirmedPickupToken === selectedToken ? 'Iniciar entrega' : 'Tengo el pedido'}
            </button>
          </div>
        )}

        {ownDeliveryAwaitingPickup && reviewPickupToken === selectedToken && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 px-4 py-6" role="dialog" aria-modal="true" aria-labelledby="pickup-review-title">
            <div className={`flex max-h-[min(85dvh,680px)] w-full max-w-md flex-col overflow-hidden rounded-[28px] border shadow-2xl ${cardBg} ${cardBorder}`}>
              <div className="shrink-0 border-b border-neutral-200/70 px-5 py-5 dark:border-zinc-700 sm:px-6">
                <div className="flex items-start gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"><Package className="h-5 w-5" aria-hidden="true" /></span>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-red-600 dark:text-red-400">{currentTicket.dailyCounter != null ? `Pedido #${String(currentTicket.dailyCounter).padStart(2, '0')}` : 'Detalle del pedido'}</p>
                    <h2 id="pickup-review-title" className={`mt-1 text-lg font-extrabold tracking-tight ${textPrimary}`}>Revisa el pedido</h2>
                    <p className={`mt-1 text-sm leading-relaxed ${textSecondary}`}>Comprueba que llevas todos los productos antes de salir.</p>
                  </div>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 sm:px-6">
                {Boolean(currentTicket.items?.length) && <p className={`mb-3 text-xs font-bold uppercase tracking-wide ${textSecondary}`}>Productos · {currentTicket.items!.reduce((total, item) => total + item.quantity, 0)} unidades</p>}
                {currentTicket.items?.length ? currentTicket.items.map(item => (
                  <div key={item.id} className="flex items-start gap-3 border-b border-neutral-100 py-3 last:border-0 dark:border-zinc-800">
                    <span className="relative grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-neutral-100 text-neutral-400 dark:bg-zinc-800 dark:text-zinc-500">
                      <Package className="h-6 w-6" aria-hidden="true" />
                      {item.product?.image && <img src={item.product.image} alt="" className="absolute inset-0 h-full w-full object-cover" onError={(event) => { event.currentTarget.style.display = 'none'; }} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={`break-words text-sm font-extrabold ${textPrimary}`}>{item.product?.name || 'Producto'}</p>
                      {item.weightG ? <p className={`mt-0.5 text-xs ${textSecondary}`}>{item.weightG} g</p> : null}
                      {item.options?.length > 0 && <p className={`mt-1 text-xs leading-relaxed ${textSecondary}`}>{item.options.map(option => option.name).join(' · ')}</p>}
                      {item.specialInstructions && <p className={`mt-1 text-xs leading-relaxed ${textSecondary}`}>Nota: {item.specialInstructions}</p>}
                    </div>
                    <span aria-label={`Cantidad: ${item.quantity}`} className="shrink-0 rounded-xl bg-sky-50 px-3 py-2 text-sm font-extrabold text-sky-700 dark:bg-sky-400/10 dark:text-sky-300">×{item.quantity}</span>
                  </div>
                )) : <p role="alert" className="py-4 text-sm text-red-600">No se pudo cargar el contenido del pedido. Actualiza la página antes de continuar.</p>}
              </div>
              <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-neutral-200/70 p-4 dark:border-zinc-700">
                <button type="button" onClick={() => setReviewPickupToken(null)} className="min-h-11 rounded-xl border border-red-300 bg-white px-3 text-sm font-bold text-red-700 transition hover:bg-red-50 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/20">Volver</button>
                <button type="button" disabled={!currentTicket.items?.length} onClick={() => { setConfirmedPickupToken(selectedToken); setReviewPickupToken(null); }} className="min-h-11 rounded-xl border border-neutral-900 bg-neutral-900 px-3 text-sm font-bold text-white transition hover:bg-neutral-800 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700">Aceptar</button>
              </div>
            </div>
          </div>
        )}

        {ownDeliveryAwaitingPickup && confirmedPickupToken !== selectedToken && (
          <p role="status" className={`mt-4 flex items-start gap-2.5 rounded-2xl border px-4 py-3 text-xs font-semibold leading-relaxed ${darkMode ? 'border-sky-900/40 bg-sky-950/20 text-sky-300' : 'border-sky-100 bg-sky-50 text-sky-800'}`}>
            <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Revisa y confirma el pedido para habilitar los datos y las acciones de entrega.</span>
          </p>
        )}
        <div
          ref={(element) => {
            element?.toggleAttribute('inert', ownDeliveryAwaitingPickup && confirmedPickupToken !== selectedToken);
          }}
          aria-disabled={ownDeliveryAwaitingPickup && confirmedPickupToken !== selectedToken}
          className={ownDeliveryAwaitingPickup && confirmedPickupToken !== selectedToken ? 'opacity-50' : undefined}
        >
        {/* ── CLIENTE + CONTACTO ── */}
        <div className={`mt-4 rounded-[28px] border p-5 shadow-[0_4px_24px_rgba(0,0,0,0.015)] ${cardBg} ${cardBorder}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className={`text-[10px] font-black uppercase tracking-[0.18em] ${textSecondary}`}>Entregar a</p>
              <h1 className={`text-xl font-black tracking-tight mt-1 truncate ${textPrimary}`}>{fullCustomerName(currentTicket.customer)}</h1>
            </div>
            <div className="flex items-center gap-2.5 shrink-0">              <a
                href={`tel:${currentTicket.customer.phone}`}
                onClick={() => triggerHaptic([30])}
                className={`flex h-11 w-11 items-center justify-center rounded-xl transition-all active:scale-90 border shadow-sm ${
                  darkMode 
                    ? 'bg-zinc-800 border-zinc-700 text-zinc-100 hover:bg-zinc-700'
                    : 'bg-neutral-900 border-neutral-900 text-white hover:bg-neutral-800'
                }`}
                aria-label="Llamar al cliente"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                  <path fillRule="evenodd" d="M1.5 4.5a3 3 0 0 1 3-3h1.372c.86 0 1.61.586 1.819 1.42l1.105 4.423a1.875 1.875 0 0 1-.694 1.955l-1.293.97a15.216 15.216 0 0 0 5.58 5.58l.97-1.293a1.875 1.875 0 0 1 1.955-.694l4.423 1.105c.834.209 1.42.959 1.42 1.82V19.5a3 3 0 0 1-3 3h-2.25C8.552 22.5 1.5 15.448 1.5 6.75V4.5Z" clipRule="evenodd" />
                </svg>
              </a>
            </div>
          </div>
        </div>

        {/* ── DIRECCIÓN ── */}
        <div className={`mt-3 rounded-[28px] border p-5 shadow-[0_4px_24px_rgba(0,0,0,0.015)] ${cardBg} ${cardBorder}`}>
          <div className="flex items-start gap-3.5">
            <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full shadow-sm ${
              darkMode ? 'bg-zinc-800 text-zinc-300' : 'bg-neutral-100 text-neutral-700'
            }`}>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-base font-extrabold leading-snug ${textPrimary}`}>{addressObj.street} {addressObj.number}</p>
              <p className={`text-xs mt-1 ${textSecondary}`}>{addressObj.neighborhood}, {addressObj.city}</p>
              {deliveryDistanceKm !== null && (
                <span className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-extrabold tracking-wide uppercase ${
                  darkMode ? 'bg-sky-400/10 text-sky-400' : 'bg-sky-50 text-sky-700'
                }`}>
                  A tu destino: aprox. {deliveryDistanceKm < 1 ? `${Math.round(deliveryDistanceKm * 1000)} m` : `${deliveryDistanceKm.toFixed(1)} km`} en línea recta
                </span>
              )}
              {deliveryDistanceKm === null && <p className={`mt-2 text-[11px] ${textSecondary}`}>{driverPositionAt === null ? 'Distancia disponible al iniciar el reparto y recibir GPS.' : 'GPS desactualizado · Esperando ubicación para calcular la distancia.'}</p>}
            </div>
          </div>

          {addressObj.reference && (
            <div className={`mt-4 rounded-2xl px-4 py-3 text-xs leading-relaxed flex gap-2.5 border ${
              darkMode 
                ? 'bg-zinc-900/40 border-zinc-800 text-zinc-300' 
                : 'bg-neutral-50 border-black/[0.03] text-neutral-600'
            }`}>
              <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="break-words">{addressObj.reference}</span>
            </div>
          )}

          {/* Botones GPS y Waze */}
          <div className="mt-4">
            {addressObj.latitude && addressObj.longitude ? (
              <button
                type="button"
                onClick={() => { triggerHaptic([40]); setNavOpenFor('delivery'); }}
                className="mb-2.5 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-red-500/50 bg-neutral-900 py-3.5 text-sm font-black text-white shadow-sm transition hover:bg-neutral-800 active:scale-[0.97] dark:bg-zinc-800 dark:hover:bg-zinc-700"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
                  <circle cx="12" cy="9" r="2.5" />
                </svg>
                Navegar al domicilio
              </button>
            ) : (
              <div className={`mb-2.5 rounded-2xl border px-4 py-3 text-xs leading-relaxed ${darkMode ? 'border-amber-900/30 bg-amber-950/20 text-amber-300' : 'border-amber-200/60 bg-amber-50 text-amber-800'}`}>
                Este pedido no registró coordenadas GPS de la dirección. Usa Google Maps o Waze para ubicar al cliente.
              </div>
            )}
            <div className="flex gap-2.5">
            <a
              href={googleMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => triggerHaptic([30])}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-2xl border py-3 text-xs font-bold transition active:scale-95 shadow-sm ${
                darkMode
                  ? 'border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20'
                  : 'border-red-300 bg-white text-red-700 hover:bg-red-50'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75 3 9v11.25l6-2.25m0-11.25 6 2.25m-6-2.25V20.25m6-11.25 6-2.25V18l-6 2.25m0-11.25V20.25" />
              </svg>
              Google Maps
            </a>
            {addressObj.latitude && addressObj.longitude && (
              <a
                href={`https://waze.com/ul?ll=${addressObj.latitude},${addressObj.longitude}&navigate=yes`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => triggerHaptic([30])}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-2xl border py-3 text-xs font-bold transition active:scale-95 shadow-sm ${
                  darkMode
                    ? 'border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20'
                    : 'border-red-300 bg-white text-red-700 hover:bg-red-50'
                }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
                </svg>
                Waze
              </a>
            )}
          </div>
          </div>
        </div>

        {/* ── MAPA DE NAVEGACIÓN IN-APP (lazy: no gasta datos hasta activarlo) ── */}
        {addressObj.latitude && addressObj.longitude && (
          <div className={`mt-3 overflow-hidden rounded-[28px] border shadow-[0_4px_24px_rgba(0,0,0,0.015)] ${cardBorder}`}>
            {!mapEnabled ? (
              <button
                type="button"
                onClick={toggleMap}
                className="flex w-full flex-col items-center gap-2 px-5 py-6 text-center transition active:scale-[0.99]"
              >
                <span className={`flex h-11 w-11 items-center justify-center rounded-2xl ${darkMode ? 'bg-red-400/10 text-red-400' : 'bg-red-50 text-red-600'}`}>
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75 3 9v11.25l6-2.25m0-11.25 6 2.25m-6-2.25V20.25m6-11.25 6-2.25V18l-6 2.25m0-11.25V20.25" />
                  </svg>
                </span>
                <span className={`text-xs font-extrabold ${textPrimary}`}>Ver mapa del recorrido</span>
                <span className={`text-[10px] leading-relaxed ${textSecondary}`}>
                  Carga el mapa solo cuando lo necesites para ahorrar datos móviles.
                </span>
              </button>
            ) : (
              <>
                <div className={`flex items-center justify-between px-4 pt-3 ${cardBg}`}>
                  <p className={`text-[10px] font-black uppercase tracking-widest ${textSecondary}`}>
                    {currentTicket.restaurant.latitude && currentTicket.restaurant.longitude ? 'Ruta del restaurante al domicilio' : 'Ubicación del domicilio'}
                  </p>
                  <button
                    type="button"
                    onClick={toggleMap}
                    aria-label="Ocultar mapa"
                    className={`flex h-7 w-7 items-center justify-center rounded-lg text-[11px] font-bold transition active:scale-90 ${
                      darkMode ? 'bg-zinc-800 text-zinc-300' : 'bg-neutral-100 text-neutral-600'
                    }`}
                  >
                    ✕
                  </button>
                </div>
                <DeliveryRouteMap
                  origin={
                    currentTicket.restaurant.latitude && currentTicket.restaurant.longitude
                      ? {
                          lat: currentTicket.restaurant.latitude,
                          lng: currentTicket.restaurant.longitude,
                          label: currentTicket.restaurant.name,
                          emoji: '🏪',
                          color: '#f59e0b',
                        }
                      : null
                  }
                  destination={{
                    lat: addressObj.latitude,
                    lng: addressObj.longitude,
                    label: addressText,
                    emoji: '🏠',
                    color: '#ef4444',
                  }}
                  userPos={driverPos}
                  height={220}
                />
              </>
            )}
          </div>
        )}

        {/* ── ALERTA DE PAGO ── */}
        <div className={`mt-3 rounded-[28px] border p-5 shadow-[0_4px_24px_rgba(0,0,0,0.015)] ${
          isCash
            ? darkMode ? 'bg-amber-950/20 border-amber-900/30' : 'bg-amber-50 border-amber-200/50'
            : darkMode ? 'bg-emerald-950/20 border-emerald-900/30' : 'bg-emerald-50 border-emerald-200/50'
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-[10px] font-black uppercase tracking-widest ${isCash ? (darkMode ? 'text-amber-400' : 'text-amber-700') : (darkMode ? 'text-emerald-400' : 'text-emerald-700')}`}>
                {isCash ? 'Cobrar en efectivo' : isTransfer ? 'Pagado por transferencia' : 'Pago confirmado'}
              </p>
              <p className={`text-2xl font-black tracking-tight mt-1 ${isCash ? (darkMode ? 'text-amber-300' : 'text-amber-950') : (darkMode ? 'text-emerald-300' : 'text-emerald-950')}`}>
                ${currentTicket.totalAmount.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
              </p>
            </div>
            <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${isCash ? (darkMode ? 'bg-amber-400/10 text-amber-300' : 'bg-amber-100 text-amber-700') : (darkMode ? 'bg-emerald-400/10 text-emerald-300' : 'bg-emerald-100 text-emerald-700')}`}>
              {isCash ? <Banknote className="h-5 w-5" aria-hidden="true" /> : <CreditCard className="h-5 w-5" aria-hidden="true" />}
            </span>
          </div>
        </div>

        {/* ── BOTÓN LLEGUÉ ── */}
        {!ownDeliveryAwaitingPickup && <div className={`mt-3 rounded-[28px] border p-5 shadow-[0_4px_24px_rgba(0,0,0,0.015)] ${cardBg} ${cardBorder}`}>
          {llegueError && (
            <div className={`rounded-xl px-4 py-3 mb-3 text-xs font-semibold flex items-center gap-2 border ${
              darkMode ? 'bg-red-950/20 border-red-900/30 text-red-400' : 'bg-red-50 border-red-200/50 text-red-600'
            }`}>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-4 h-4 shrink-0">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
              <span>{llegueError}</span>
            </div>
          )}

          {currentArrived ? (
            <div className={`flex items-center gap-2 justify-center py-2.5 text-xs font-black uppercase tracking-wider ${
              darkMode ? 'text-emerald-400' : 'text-emerald-700'
            }`}>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="3" stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
              <span>Llegada notificada</span>
            </div>
          ) : currentTicket.isSupportDelivery && currentPickedUp && currentTicket.status === 'PICKED_UP' ? (
            <button
              type="button"
              disabled={notifying}
              onClick={() => { triggerHaptic([40]); void handleLlegueRestaurante(); }}
              className={`w-full flex items-center justify-center gap-2 rounded-2xl py-3.5 text-xs font-bold transition-all active:scale-95 active-scale disabled:opacity-50 border shadow-sm ${
                darkMode 
                  ? 'bg-red-400/10 text-red-300 border border-red-400/20 hover:bg-red-400/20'
                  : 'bg-white text-red-700 border border-red-300 hover:bg-red-50'
              }`}
            >
              {notifying ? (
                <>
                  <div className={`h-4 w-4 animate-spin rounded-full border-2 ${darkMode ? 'border-red-300/40 border-t-red-300' : 'border-red-400/30 border-t-red-500'}`} />
                  <span>Iniciando entrega…</span>
                </>
              ) : (
                <>
                  <span className="text-sm">🚀</span>
                  <span>Iniciar entrega</span>
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              disabled={notifying}
              onClick={handleLlegue}
              className={`w-full flex items-center justify-center gap-2 rounded-2xl py-3.5 text-xs font-bold transition-all active:scale-95 active-scale disabled:opacity-50 border shadow-sm ${
                darkMode 
                  ? 'bg-sky-400/10 text-sky-300 border border-sky-400/20 hover:bg-sky-400/20'
                  : 'bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100'
              }`}
            >
              {notifying ? (
                <>
                  <div className={`h-4 w-4 animate-spin rounded-full border-2 ${darkMode ? 'border-sky-300/40 border-t-sky-300' : 'border-sky-400/30 border-t-sky-500'}`} />
                  <span>Notificando llegada…</span>
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
                  </svg>
                  <span>Notificar: ¡Ya llegué!</span>
                </>
              )}
            </button>
          )}
        </div>}

        {/* ── CONFIRMAR ENTREGA + PIN ── */}
        {!ownDeliveryAwaitingPickup && <div className={`mt-3 rounded-[28px] border p-5 shadow-[0_4px_24px_rgba(0,0,0,0.015)] ${cardBg} ${cardBorder}`}>
          <form onSubmit={handleDeliver} className="space-y-4">
            {error && (
              <div className={`rounded-xl px-4 py-3 text-xs font-semibold text-center flex items-center justify-center gap-2 border ${
                darkMode ? 'bg-red-950/20 border-red-900/30 text-red-400' : 'bg-red-50 border-red-200/50 text-red-600'
              }`}>
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-4 h-4 shrink-0">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="relative flex w-full items-center justify-center gap-2.5 rounded-2xl border border-red-500/50 py-4 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_10px_24px_-10px_rgba(220,38,38,0.7)] ring-1 ring-red-500/20 transition-all hover:bg-neutral-800 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 active-scale bg-neutral-900"
            >
              {submitting ? (
                <>
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  <span className="text-sm font-black uppercase tracking-wider">Confirmando…</span>
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="3" stroke="currentColor" className="w-5 h-5 drop-shadow-sm">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                  </svg>
                  <span className="text-sm font-black uppercase tracking-wider drop-shadow-sm">Confirmar Entrega</span>
                </>
              )}
            </button>
          </form>
        </div>}

        {/* ── ESPERA SIN CONTACTO: LUGAR SEGURO / CLIENTE NO SALIÓ ── */}
        {(() => {
          const arrivalTime = getCustomerArrivalTime(currentTicket, selectedToken ?? undefined);
          const elapsedMs = arrivalTime ? deliveryClock - arrivalTime : 0;
          const SAFE_PLACE_MS = 10 * 60 * 1000;
          const NO_SHOW_MS = 15 * 60 * 1000;
          const remainingSafe = SAFE_PLACE_MS - elapsedMs;
          const remainingNoShow = NO_SHOW_MS - elapsedMs;
          const safePlaceReady = isTransfer && remainingSafe <= 0;
          const noShowReady = isCash && remainingNoShow <= 0;
          // Solo mostrar la sección en el último minuto de espera para
          // no presionar al repartidor mientras aún hay tiempo.
          const LAST_MINUTE_MS = 60 * 1000;
          const showTimer = (isCash || isTransfer) && arrivalTime > 0 &&
            (isTransfer ? remainingSafe <= LAST_MINUTE_MS : remainingNoShow <= LAST_MINUTE_MS);

          if (!showTimer || currentDelivered || currentTicket.isOwnDelivery) return null;

          return (
            <div className={`mt-3 rounded-[28px] border p-5 space-y-4 ${
              darkMode ? 'border-amber-900/30 bg-zinc-900' : 'border-amber-200 bg-white'
            }`}>
              <div className="flex items-center justify-between">
                <p className={`text-[10px] font-bold uppercase tracking-widest ${
                  darkMode ? 'text-amber-400' : 'text-amber-700'
                }`}>
                  Espera sin contacto
                </p>
                {arrivalTime > 0 ? (
                  <span className={`text-xs font-black tabular-nums ${
                    darkMode ? 'text-amber-300' : 'text-amber-800'
                  }`}>
                    {isTransfer
                      ? `Lugar seguro en ${formatCountdown(remainingSafe)}`
                      : `Liberar en ${formatCountdown(remainingNoShow)}`}
                  </span>
                ) : null}
              </div>
              <p className={`text-[10px] leading-snug ${
                darkMode ? 'text-amber-400/70' : 'text-amber-700/70'
              }`}>
                {isTransfer
                  ? 'Si el cliente no sale, podrás dejar el pedido en un lugar seguro y marcar la entrega.'
                  : 'Si el cliente no sale, podrás liberar el pedido; se le cobrará al cliente.'}
              </p>

              {isTransfer && (
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic([30, 20, 60]);
                    setLugarSeguroError('');
                    setSafePlaceConfirmToken(selectedToken);
                  }}
                  disabled={!safePlaceReady || lugarSeguroSubmitting}
                  className="w-full py-3 rounded-2xl border-2 border-amber-300 dark:border-amber-700/60 bg-white dark:bg-zinc-900 text-amber-800 dark:text-amber-300 text-sm font-black tracking-wide transition active:scale-[0.97] disabled:opacity-35 disabled:cursor-not-allowed"
                >
                  {lugarSeguroSubmitting
                    ? <span className="flex items-center justify-center gap-2"><span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />Procesando…</span>
                    : 'Dejar en un lugar seguro'}
                </button>
              )}

              {isCash && (
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic([30, 20, 60]);
                    setNoShowError('');
                    setNoShowConfirmToken(selectedToken);
                  }}
                  disabled={!noShowReady || noShowSubmitting}
                  className="w-full py-3 rounded-2xl border-2 border-rose-300 dark:border-rose-700/60 bg-white dark:bg-zinc-900 text-rose-700 dark:text-rose-400 text-sm font-black tracking-wide transition active:scale-[0.97] disabled:opacity-35 disabled:cursor-not-allowed"
                >
                  {noShowSubmitting
                    ? <span className="flex items-center justify-center gap-2"><span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />Procesando…</span>
                    : 'El cliente no salió — Liberar pedido'}
                </button>
              )}
            </div>
          );
        })()}

        {/* ── SOPORTE / RESTAURANTE ── */}
        <div className={`mt-3 rounded-[28px] border p-5 flex items-center justify-between gap-3 shadow-[0_4px_24px_rgba(0,0,0,0.015)] ${cardBg} ${cardBorder}`}>
          <div className="min-w-0">
            <p className={`text-[10px] font-black uppercase tracking-widest ${textTertiary}`}>{currentTicket.restaurant.businessType && currentTicket.restaurant.businessType !== 'RESTAURANT' ? 'Tienda' : 'Restaurante'}</p>
            <p className={`text-sm font-bold truncate mt-1 ${textPrimary}`}>{currentTicket.restaurant.name}</p>
            <p className={`text-[10px] mt-0.5 ${textTertiary}`}>Folio: {currentTicket.orderReference}</p>
          </div>
          <a
            href={`tel:${currentTicket.restaurant.phone}`}
            onClick={() => triggerHaptic([30])}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-all active:scale-90 border shadow-sm ${
              darkMode 
                ? 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800' 
                : 'bg-white border-black/[0.06] text-neutral-700 hover:bg-neutral-50'
            }`}
            aria-label={`Llamar ${currentTicket.restaurant.businessType && currentTicket.restaurant.businessType !== 'RESTAURANT' ? 'a la tienda' : 'al restaurante'}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path fillRule="evenodd" d="M1.5 4.5a3 3 0 0 1 3-3h1.372c.86 0 1.61.586 1.819 1.42l1.105 4.423a1.875 1.875 0 0 1-.694 1.955l-1.293.97a15.216 15.216 0 0 0 5.58 5.58l.97-1.293a1.875 1.875 0 0 1 1.955-.694l4.423 1.105c.834.209 1.42.959 1.42 1.82V19.5a3 3 0 0 1-3 3h-2.25C8.552 22.5 1.5 15.448 1.5 6.75V4.5Z" clipRule="evenodd" />
            </svg>
          </a>
        </div>
        </div>

        {/* ── MODAL CONFIRMACIÓN DE ENTREGA / COBRO ── */}
        {showConfirmModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]" role="dialog" aria-modal="true" aria-labelledby="delivery-confirm-title" aria-describedby="delivery-confirm-description">
            <style dangerouslySetInnerHTML={{ __html: `
              @keyframes modalFadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
              }
              @keyframes modalScaleUp {
                from { transform: scale(0.96); opacity: 0; }
                to { transform: scale(1); opacity: 1; }
              }
              .animate-modal-fade-in {
                animation: modalFadeIn 0.2s ease-out forwards;
              }
              .animate-modal-scale-up {
                animation: modalScaleUp 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
              }
            `}} />

            {/* Backdrop */}
            <div 
              className="absolute inset-0 bg-black/45 backdrop-blur-[2px] animate-modal-fade-in"
              onClick={() => { 
                if (submitting) return;
                triggerHaptic([10]); 
                setShowConfirmModal(false); 
                if (modalOpenedFromDashboard) {
                  setSelectedToken(null);
                  setModalOpenedFromDashboard(false);
                }
              }}
            />
            
            {/* Modal Card */}
            <div 
              className={`relative max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto rounded-[28px] border p-5 shadow-2xl motion-safe:animate-modal-scale-up sm:p-6 ${cardBg} ${cardBorder}`}
            >
              <div className="text-center">
                <div aria-hidden="true" className={`mx-auto flex h-12 w-12 items-center justify-center rounded-2xl ${darkMode ? 'bg-red-400/10 text-red-400' : 'bg-red-50 text-red-600'}`}>
                  {isCash ? <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="7" width="18" height="11" rx="2" /><path d="M6 4h12M7 12h.01M17 12h.01" /><circle cx="12" cy="12.5" r="2" /></svg> : <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M3 10h18M7 15h3" /></svg>}
                </div>
                <h3 id="delivery-confirm-title" className={`mt-3 text-xl font-extrabold tracking-tight ${textPrimary}`}>
                  {isCash ? 'Confirmar entrega y cobro' : 'Confirmar entrega'}
                </h3>
                
                <p id="delivery-confirm-description" className={`mt-1.5 text-sm leading-5 ${textSecondary}`}>
                  {isCash 
                    ? 'Confirma que entregaste el pedido y recibiste el efectivo.'
                    : 'Confirma que entregaste el pedido al cliente.'
                  }
                </p>

                {/* Bloque de cobro integrado estilo alerta del reparto */}
                <div className={`mt-4 rounded-2xl border px-4 py-4 ${
                  isCash
                    ? (darkMode ? 'bg-amber-950/20 border-amber-900/30' : 'bg-amber-50 border-amber-200/50')
                    : (darkMode ? 'bg-emerald-950/20 border-emerald-900/30' : 'bg-emerald-50 border-emerald-200/50')
                }`}>
                  <p className={`text-[10px] font-bold uppercase tracking-wider ${
                    isCash 
                      ? (darkMode ? 'text-amber-400' : 'text-amber-700') 
                      : (darkMode ? 'text-emerald-400' : 'text-emerald-700')
                  }`}>
                    {isCash ? 'Monto en efectivo' : currentTicket.paymentMethod === 'TRANSFER' ? 'Pagado con transferencia' : 'Pagado en línea'}
                  </p>
                  <p className={`text-3xl font-extrabold tracking-tight mt-1 ${
                    isCash 
                      ? (darkMode ? 'text-amber-300' : 'text-amber-950') 
                      : (darkMode ? 'text-emerald-300' : 'text-emerald-950')
                  }`}>
                    ${currentTicket.totalAmount.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                {isCash && <p className={`mt-3 text-xs ${textSecondary}`}>Prueba local: el registro de efectivo es ficticio.</p>}
                {!isCash && (currentTicket.isOwnDelivery || currentTicket.handoverPin) && (
                  <div className="mt-4 text-left">
                    <label htmlFor="delivery-confirm-pin" className={`block text-sm font-bold ${textPrimary}`}>PIN de entrega</label>
                    <p className={`mt-1 text-xs ${textSecondary}`}>Pide al cliente su PIN de 4 dígitos.</p>
                    <input id="delivery-confirm-pin" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={4} value={pin} onChange={(event) => { const value = event.target.value.replace(/\D/g, ''); setPin(value); if (value.length === 4) triggerHaptic([20]); }} placeholder="• • • •" className={`mt-2 w-full rounded-2xl border px-4 py-3 text-center text-2xl font-black tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-red-400/50 ${darkMode ? 'border-zinc-700 bg-zinc-950 text-white placeholder:text-zinc-600' : 'border-neutral-200 bg-neutral-50 text-neutral-900 placeholder:text-neutral-300'}`} />
                  </div>
                )}
                {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
              </div>

              <div className="mt-5 flex flex-col gap-2">
                <button
                  type="button"
                  disabled={submitting || (!isCash && !!(currentTicket.isOwnDelivery || currentTicket.handoverPin) && !/^\d{4}$/.test(pin))}
                  onClick={executeDeliver}
                  className="relative flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-red-500/50 bg-neutral-900 px-4 py-3 text-sm font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_10px_24px_-10px_rgba(220,38,38,0.7)] ring-1 ring-red-500/20 transition hover:bg-neutral-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
                >
                  {submitting ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      <span>Confirmando…</span>
                    </>
                  ) : (
                    <>
                      <span>{isCash ? 'Confirmar entrega y cobro' : 'Confirmar entrega'}</span>
                    </>
                  )}
                </button>
                
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => { 
                    triggerHaptic([10]); 
                    setShowConfirmModal(false); 
                    if (modalOpenedFromDashboard) {
                      setSelectedToken(null);
                      setModalOpenedFromDashboard(false);
                    }
                  }}
                  className={`min-h-12 w-full rounded-2xl border px-4 py-3 text-sm font-bold transition active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 ${
                    darkMode 
                      ? 'border-zinc-800 text-zinc-300 bg-zinc-900/40 hover:bg-zinc-800' 
                      : 'border-neutral-200 text-neutral-600 bg-neutral-50 hover:bg-neutral-100'
                  }`}
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}

      </main>

      {/* ═══════════════════════════════════════════════════════════════════
          MODAL: DEJAR EN LUGAR SEGURO (entrega abandonada - transferencia)
          ═══════════════════════════════════════════════════════════════════ */}
      {safePlaceConfirmToken && (() => {
        const safeOrder = deliveries.find(d => d.token === safePlaceConfirmToken);
        const arrivalTime = safeOrder ? getCustomerArrivalTime(safeOrder.data, safePlaceConfirmToken ?? undefined) : null;
        const waitMin = arrivalTime ? Math.floor((Date.now() - arrivalTime) / 60000) : 0;
        return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
            <div className={`w-full max-w-md rounded-3xl p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200 ${
              darkMode ? 'bg-zinc-900' : 'bg-white'
            }`}>
              <div className="flex flex-col items-center text-center">
                <div className={`flex h-16 w-16 items-center justify-center rounded-full text-3xl mb-4 ${
                  darkMode ? 'bg-amber-950/30 text-amber-300' : 'bg-amber-100 text-amber-600'
                }`}>
                  📦
                </div>
                <h2 className={`text-xl font-black ${darkMode ? 'text-zinc-50' : 'text-neutral-950'}`}>
                  ¿Dejar en un lugar seguro?
                </h2>
                <p className={`text-sm mt-2 leading-relaxed ${darkMode ? 'text-zinc-400' : 'text-muted'}`}>
                  Has esperado <strong className={darkMode ? 'text-zinc-300' : 'text-foreground'}>{waitMin} minutos</strong> sin que el cliente salga.
                  Puedes dejar el pedido en un lugar seguro y marcarlo como entregado.
                </p>
                <div className="w-full text-left mt-4 space-y-2.5">
                  <div className={`rounded-2xl border px-4 py-3 ${
                    darkMode ? 'border-red-900/30 bg-zinc-900' : 'border-red-200 bg-red-50'
                  }`}>
                    <p className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${
                      darkMode ? 'text-red-400' : 'text-red-600'
                    }`}>Para el cliente</p>
                    <p className={`text-xs leading-relaxed ${darkMode ? 'text-zinc-300' : 'text-muted'}`}>
                      El cliente <strong className={darkMode ? 'text-zinc-200' : 'text-foreground'}>ya pagó por transferencia</strong>. Deja el pedido donde pueda recogerlo; el pago ya está cubierto.
                    </p>
                  </div>
                  <div className={`rounded-2xl border px-4 py-3 ${
                    darkMode ? 'border-emerald-900/30 bg-zinc-900' : 'border-emerald-200 bg-emerald-50'
                  }`}>
                    <p className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${
                      darkMode ? 'text-emerald-400' : 'text-emerald-600'
                    }`}>Resultado</p>
                    <p className={`text-xs leading-relaxed ${darkMode ? 'text-zinc-300' : 'text-muted'}`}>
                      La entrega quedará marcada como completada. El cliente será notificado para que recoja su pedido.
                    </p>
                  </div>
                </div>
                {lugarSeguroError && (
                  <div className={`w-full mt-4 rounded-xl px-4 py-3 text-xs font-semibold text-center border ${
                    darkMode ? 'bg-red-950/20 border-red-900/30 text-red-400' : 'bg-red-50 border-red-200/50 text-red-600'
                  }`}>
                    {lugarSeguroError}
                  </div>
                )}
                <div className="flex gap-3 w-full mt-6">
                  <button
                    type="button"
                    onClick={() => { setSafePlaceConfirmToken(null); setLugarSeguroError(''); triggerHaptic([10]); }}
                    className={`flex-1 py-3.5 rounded-2xl border text-sm font-bold transition active:scale-[0.97] ${
                      darkMode
                        ? 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                        : 'border-neutral-200 bg-neutral-50 text-muted hover:bg-neutral-100'
                    }`}
                  >
                    Volver
                  </button>
                  <button
                    type="button"
                    onClick={() => { void handleLugarSeguro(); }}
                    disabled={lugarSeguroSubmitting}
                    className="flex-1 py-3.5 rounded-2xl bg-amber-500 text-sm font-bold text-white shadow-lg shadow-amber-500/30 transition active:scale-[0.97] hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                  >
                    {lugarSeguroSubmitting ? 'Procesando…' : 'Dejar en lugar seguro'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══════════════════════════════════════════════════════════════════
          MODAL: CLIENTE NO SALIÓ (entrega abandonada - efectivo)
          ═══════════════════════════════════════════════════════════════════ */}
      {noShowConfirmToken && (() => {
        const noShowOrder = deliveries.find(d => d.token === noShowConfirmToken);
        const arrivalTime = noShowOrder ? getCustomerArrivalTime(noShowOrder.data, noShowConfirmToken ?? undefined) : null;
        const waitMin = arrivalTime ? Math.floor((Date.now() - arrivalTime) / 60000) : 0;
        return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
            <div className={`w-full max-w-md rounded-3xl p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200 ${
              darkMode ? 'bg-zinc-900' : 'bg-white'
            }`}>
              <div className="flex flex-col items-center text-center">
                <div className={`flex h-16 w-16 items-center justify-center rounded-full text-3xl mb-4 ${
                  darkMode ? 'bg-rose-950/30 text-rose-300' : 'bg-rose-100 text-rose-600'
                }`}>
                  ⚠️
                </div>
                <h2 className={`text-xl font-black ${darkMode ? 'text-zinc-50' : 'text-neutral-950'}`}>
                  ¿Liberar el pedido?
                </h2>
                <p className={`text-sm mt-2 leading-relaxed ${darkMode ? 'text-zinc-400' : 'text-muted'}`}>
                  Has esperado <strong className={darkMode ? 'text-zinc-300' : 'text-foreground'}>{waitMin} minutos</strong> y el cliente no salió a recibir.
                </p>
                <div className={`w-full mt-4 rounded-2xl border px-4 py-3 ${
                  darkMode ? 'border-amber-900/30 bg-zinc-900' : 'border-amber-200 bg-amber-50'
                }`}>
                  <p className={`text-xs leading-relaxed ${darkMode ? 'text-zinc-300' : 'text-muted'}`}>
                    Asegúrate de haber intentado contactar al cliente. Al liberar el pedido{' '}
                    <strong className={darkMode ? 'text-zinc-200' : 'text-foreground'}>se le cobrará el monto total del pedido</strong> y{' '}
                    <strong className={darkMode ? 'text-zinc-200' : 'text-foreground'}>su cuenta quedará suspendida</strong> hasta que liquide el saldo pendiente.
                  </p>
                </div>
                {noShowError && (
                  <div className={`w-full mt-4 rounded-xl px-4 py-3 text-xs font-semibold text-center border ${
                    darkMode ? 'bg-red-950/20 border-red-900/30 text-red-400' : 'bg-red-50 border-red-200/50 text-red-600'
                  }`}>
                    {noShowError}
                  </div>
                )}
                <div className="flex gap-3 w-full mt-6">
                  <button
                    type="button"
                    onClick={() => { setNoShowConfirmToken(null); setNoShowError(''); triggerHaptic([10]); }}
                    className={`flex-1 py-3.5 rounded-2xl border text-sm font-bold transition active:scale-[0.97] ${
                      darkMode
                        ? 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                        : 'border-neutral-200 bg-neutral-50 text-muted hover:bg-neutral-100'
                    }`}
                  >
                    Volver
                  </button>
                  <button
                    type="button"
                    onClick={() => { void handleNoShow(); }}
                    disabled={noShowSubmitting}
                    className="flex-1 py-3.5 rounded-2xl bg-rose-500 text-sm font-bold text-white shadow-lg shadow-rose-500/30 transition active:scale-[0.97] hover:bg-rose-600 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                  >
                    {noShowSubmitting ? 'Procesando…' : 'Liberar pedido'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {navOpenFor === 'delivery' && addressObj.latitude && addressObj.longitude && (
        <DriverTurnByTurnOverlay
          destination={{
            lat: addressObj.latitude,
            lng: addressObj.longitude,
            label: `${addressObj.street} ${addressObj.number}, ${addressObj.neighborhood}, ${addressObj.city}`,
            emoji: '🏠',
          }}
          initialDriverPos={driverPos}
          dark={darkMode}
          onExit={() => setNavOpenFor(null)}
        />
      )}
    </div>
  );
}
