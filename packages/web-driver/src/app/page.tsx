'use client';
import { getWingslabSocketUrl } from '@sadel/shared';
import { Check, ChevronRight, ChevronUp, Clock, RefreshCw, User, X } from 'lucide-react';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SaDelLogo } from '../components/SaDelLogo';
import { IncomingOrderModal } from '../components/IncomingOrderModal';
import DriverNavigationMap from '../components/DriverNavigationMap';
import DriverTurnByTurnOverlay from '../components/DriverTurnByTurnOverlay';
import PushEnableBanner from '../components/PushEnableBanner';
import { isNativePlatform, requestNativePushPermission, registerNativePush, checkNativePushPermission, onNativeNotificationTap, nativeKeepAwake, nativeAllowSleep, hasNativeOrderAlarm, stopNativeOrderAlarm, isNativeAppInBackground, readNativeFcmToken, clearNativeFcmToken, cancelDeliveredNativeNotifications } from '../lib/native';
import { playAlertSound } from '../lib/sound';
import { EmptyState } from '../components/ui/EmptyState';
import { useForegroundPolling } from '../hooks/useForegroundPolling';
import { io } from 'socket.io-client';
import {
  AuthResponse,
  AuthUser,
  clearStoredSession,
  getRequestErrorMessage,
  isAuthRequestError,
  persistApiBase,
  persistStoredSession,
  readStoredSession,
  requestJson,
  setDefaultRefreshConfig,
  convertImageFileToDataUrl,
  preload,
  warmup,
  play,
  stopAll,
  vibrate,
  installWarmupListeners,
  installVisibilityResumeListener,
  waitForNativeBridge,
  revokeDevicePush,
  closeActiveWebNotifications,
  flushPendingDeviceUnpair,
} from '@sadel/shared';

import { AlertTriangle, Bike, Star, Briefcase, ArrowRight, Calendar, Moon, Settings, Menu, Hourglass, MapPin, Store, ClipboardList, BellOff, Map as MapIcon, CheckCircle2, Banknote, Package, Unlink, Phone, RadioTower, PartyPopper, Info } from 'lucide-react';

/**
 * ¿El sonido de "nuevo pedido" lo pone la app nativa (Foreground Service) en
 * lugar de esta página?
 *
 * Cuando el APK incluye el plugin `OrderAlarm` la alarma suena aunque el panel
 * esté en segundo plano y se detiene sola al vencer la ventana de decisión, así
 * que aquí el audio web se desactiva para no duplicarlo. En navegador, PWA y
 * APKs antiguos (sin el plugin) se mantiene el bucle web de siempre.
 */
function nativeAlarmHandlesSound(): boolean {
  return isNativePlatform() && hasNativeOrderAlarm();
}

type DriverAvailability = 'AVAILABLE' | 'BUSY' | 'OFFLINE';
type OrderStatus = 'CONFIRMED' | 'PREPARING' | 'READY' | 'PICKED_UP' | 'IN_TRANSIT' | 'DELIVERED';

type DriverProfile = {
  id: string;
  region: string;
  status: string;
  availability: DriverAvailability;
  rating: number;
  totalDeliveries: number;
  currentLatitude?: number | null;
  currentLongitude?: number | null;
  user: {
    id: string;
    name: string;
    phone: string;
    region: string;
    status: string;
    profilePhoto?: string | null;
  };
};







type DriverOrder = {
  id: string;
  orderReference: string;
  status: OrderStatus;
  totalAmount?: number;
  subtotal?: number;
  deliveryFee?: number | null;
  createdAt?: string;
  pickedUpAt?: string | null;
  deliveredAt?: string | null;
  estimatedDeliveryTime?: string | null;
  preparationDeadlineAt?: string | null;
  handoverPin?: string | null;
  deliveryPin?: string | null;
  restaurant: {
    id: string;
    name: string;
    address?: string;
    phone?: string;
    latitude?: number | null;
    longitude?: number | null;
    maxDeliveryTime?: number;
    businessType?: string;
    user?: { phone?: string };
  };
  customer: {
    user?: {
      id?: string;
      name?: string;
      phone?: string;
    };
  };
  address?: {
    street: string;
    number: string;
    neighborhood: string;
    reference?: string | null;
  };
  notes?: string | null;
  deliveryPreference?: 'NO_DOORBELL' | 'CALL_ON_ARRIVAL' | 'PREFER_WHATSAPP' | 'HONK_ON_ARRIVAL' | 'BEWARE_OF_DOG' | null;
  isAcceptedByDriver?: boolean;
  driverAssignedAt?: string | null;
  paymentMethod?: string;
  cashPaymentConfirmedAt?: string | null;
  driverArrivedAtCustomer?: string | null;
  noShowReleasedAt?: string | null;
  latitude?: number;
  longitude?: number;
  tracking?: Array<{
    id: string;
    status: string;
    notes?: string | null;
    createdAt: string;
  }>;
  items?: Array<{
    id: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
    specialInstructions?: string | null;
    sellBy?: string;
    weightG?: number | null;
    product: {
      name: string;
      description?: string | null;
      price: number;
      image?: string | null;
    };
    options?: Array<{
      id: string;
      name: string;
      price: number;
    }>;
  }>;
  dailyCounter?: number | null;
  batchId?: string | null;
  deliverySequence?: number | null;
};


type SuccessResponse<T> = {
  success: true;
  data: T;
};

type DriverAvailabilityResponse = {
  success: true;
  data: {
    id: string;
    availability: DriverAvailability;
    user: {
      id: string;
      name: string;
      phone: string;
    };
  };
};

type ToastTone = 'info' | 'success' | 'error';
type ToastItem = { id: string; tone: ToastTone; title: string; message: string };

type DriverRetryAction =
  | {
    kind: 'driver-action';
    orderId: string;
    actionKey: keyof typeof driverActionMap;
    label: string;
  }
  | {
    kind: 'availability';
    availability: DriverAvailability;
    label: string;
  };

const defaultApiBase = '/api';
const storageKey = 'sadel.driver';
const liveEvents = [
  'order:assigned',
  'order:preparing',
  'order:ready',
  'order:picked-up',
  'order:driver-rejected',
  'order:driver-auto-unassigned',
  'order:delivered',
] as const;

const driverActionMap: Record<
  string,
  {
    path: string;
    label: string;
  }
> = {
  accept: {
    path: 'aceptar',
    label: 'Aceptar pedido',
  },
  reject: {
    path: 'rechazar',
    label: 'Rechazar pedido',
  },
  pickedUp: {
    path: 'recogido',
    label: 'Marcar recogido',
  },
  inTransit: {
    path: 'en-camino',
    label: 'Salir a entrega',
  },
  delivered: {
    path: 'entregado',
    label: 'Confirmar entrega',
  },
  safePlace: {
    path: 'dejar-lugar-seguro',
    label: 'Dejar en un lugar seguro',
  },
  noShow: {
    path: 'cliente-no-salio',
    label: 'El cliente no salió',
  },
  arrived: {
    path: 'llegue',
    label: 'Notificar llegada',
  },
  arrivedRestaurant: {
    path: 'llegue-restaurante',
    label: 'Notificar llegada al restaurante',
  },
  releaseOrder: {
    path: 'liberar',
    label: 'Liberar pedido',
  },
};


function triggerHaptic(pattern: number | number[] = 10) {
  if (typeof window !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(pattern);
  }
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export default function Home() {
  const [apiBase, setApiBase] = useState(defaultApiBase);
  const [token, setToken] = useState('');
  const [sessionUser, setSessionUser] = useState<AuthUser | null>(null);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [driverProfile, setDriverProfile] = useState<DriverProfile | null>(null);
  const [pendingOrders, setPendingOrders] = useState<DriverOrder[]>([]);
  const [historyOrders, setHistoryOrders] = useState<DriverOrder[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [loadingMoreHistory, setLoadingMoreHistory] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<'day' | 'week' | 'month' | 'all'>('all');
  const [selectedHistoryOrder, setSelectedHistoryOrder] = useState<DriverOrder | null>(null);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [updatingAvailability, setUpdatingAvailability] = useState<DriverAvailability | null>(null);
  const [activeActionKey, setActiveActionKey] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  // Pull to refresh
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const touchStartY = useRef(0);

  // UI States
  const [activeTab, setActiveTab] = useState<'active' | 'history' | 'profile'>('active');
  useEffect(() => {
    // Informa al banner de instalación si el FAB de conexión ocupa la parte baja.
    window.dispatchEvent(new CustomEvent('sadel:bottom-cta', { detail: activeTab === 'active' }));
  }, [activeTab]);
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showDeveloperSettings, setShowDeveloperSettings] = useState(false);
  const [showWeeklyEarnings, setShowWeeklyEarnings] = useState(true);
  const [darkMode, setDarkMode] = useState(false);

  // Calcular ganancias netas de la semana en curso (inicia el lunes)
  const weeklyEarnings = useMemo(() => {
    const now = new Date();
    const currentDay = now.getDay();
    const distanceToMonday = currentDay === 0 ? 6 : currentDay - 1;

    const startOfWeek = new Date();
    startOfWeek.setDate(now.getDate() - distanceToMonday);
    startOfWeek.setHours(0, 0, 0, 0);

    return historyOrders
      .filter((order) => {
        if (!order.deliveredAt) return false;
        const deliveryDate = new Date(order.deliveredAt);
        return deliveryDate >= startOfWeek;
      })
      .reduce((sum, order) => sum + (order.deliveryFee || 0), 0);
  }, [historyOrders]);

  const todayEarnings = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    return historyOrders
      .filter((order) => {
        if (!order.deliveredAt) return false;
        const deliveryDate = new Date(order.deliveredAt);
        return deliveryDate >= startOfToday;
      })
      .reduce((sum, order) => sum + (order.deliveryFee || 0), 0);
  }, [historyOrders]);

  const filteredHistoryOrders = useMemo(() => {
    const now = new Date();
    let start: Date;
    switch (historyFilter) {
      case 'day':
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        break;
      case 'week': {
        const currentDay = now.getDay();
        const distanceToMonday = currentDay === 0 ? 6 : currentDay - 1;
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - distanceToMonday, 0, 0, 0, 0);
        break;
      }
      case 'month':
        start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        break;
      default:
        start = new Date(0);
    }
    return historyOrders.filter((order) => {
      if (!order.deliveredAt) return false;
      return new Date(order.deliveredAt) >= start;
    });
  }, [historyOrders, historyFilter]);

  const groupedHistoryOrders = useMemo(() => {
    const groups = new Map<string, DriverOrder[]>();
    for (const order of filteredHistoryOrders) {
      if (!order.deliveredAt) continue;
      const key = new Date(order.deliveredAt).toLocaleDateString('es-MX', {
        year: 'numeric', month: 'short', day: 'numeric',
      });
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(order);
    }
    return Array.from(groups.entries()).sort((a, b) => {
      return new Date(b[1][0].deliveredAt!).getTime() - new Date(a[1][0].deliveredAt!).getTime();
    });
  }, [filteredHistoryOrders]);


  const batchGroups = useMemo(() => {
    const groups = new Map<string, DriverOrder[]>();
    for (const o of pendingOrders) {
      if (o.batchId) {
        if (!groups.has(o.batchId)) groups.set(o.batchId, []);
        groups.get(o.batchId)!.push(o);
      }
    }
    return groups;
  }, [pendingOrders]);

  const [shareLocationGps, setShareLocationGps] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem('shareLocationGps');
      return saved !== 'false';
    }
    return true;
  });

  const toggleShareLocationGps = () => {
    const nextVal = !shareLocationGps;
    setShareLocationGps(nextVal);
    triggerHaptic(20);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('shareLocationGps', nextVal.toString());
    }
    if (!nextVal) {
      pushToast('info', 'GPS en Vivo apagado', 'Has desactivado el envío de tu ubicación para ahorrar batería y datos.');
    } else {
      pushToast('success', 'GPS en Vivo encendido', 'Compartiendo tu recorrido con el cliente.');
    }
  };

  // Password change states
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  // React PIN Modal States
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinModalOrderId] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [pinModalError, setPinModalError] = useState('');

  // Flujo paso a paso de entrega (sin modal)
  const [arrivedAtRestaurantFor, setArrivedAtRestaurantFor] = useState<string[]>([]);
  const [arrivedAtCustomerFor, setArrivedAtCustomerFor] = useState<string[]>([]);
  const [releaseConfirmOrderId, setReleaseConfirmOrderId] = useState<string | null>(null);
  const [deliveryPinInput, setDeliveryPinInput] = useState('');
  const [deliveryPinError, setDeliveryPinError] = useState('');
  const [showRestaurantContact, setShowRestaurantContact] = useState(false);
  const [selectedOrderDetail, setSelectedOrderDetail] = useState<DriverOrder | null>(null);
  const [navigationMapOpenFor, setNavigationMapOpenFor] = useState<Record<string, 'pickup' | 'delivery' | null>>({});
  // Navegación turn-by-turn in-app (overlay full-screen) para el repartidor.
  const [turnByTurnFor, setTurnByTurnFor] = useState<Record<string, 'pickup' | 'delivery' | null>>({});
  const [tripStartedForOrderId, setTripStartedForOrderId] = useState<string | null>(null);

  // Reloj para la cuenta regresiva de entrega sin contacto (10 min transfer / 15 min cash)
  const [deliveryClock, setDeliveryClock] = useState<number>(() => Date.now());
  const [safePlaceConfirmOrderId, setSafePlaceConfirmOrderId] = useState<string | null>(null);
  const [noShowConfirmOrderId, setNoShowConfirmOrderId] = useState<string | null>(null);

  const [, setSocketStatus] = useState<'idle' | 'connecting' | 'connected' | 'reconnecting'>('idle');
  const [, setSocketAttempts] = useState(0);
  const [lastFailedAction, setLastFailedAction] = useState<DriverRetryAction | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [error, setError] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const seenLiveEventKeysRef = useRef<string[]>([]);
  const socketConnectedRef = useRef(false);
  const activeTabRef = useRef(activeTab);
  const pendingOrdersRef = useRef(pendingOrders);
  pendingOrdersRef.current = pendingOrders;
  const driverProfileRef = useRef(driverProfile);
  driverProfileRef.current = driverProfile;
  const gpsRescheduleRef = useRef<(() => void) | null>(null);
  // Ref a subscribeToPush (definida más abajo): el SW la invoca cuando el
  // navegador rota/expira la suscripción (pushsubscriptionchange).
  const subscribeToPushRef = useRef<((token: string) => Promise<unknown>) | null>(null);

  // Refs de audio de alarma estilo Uber y Screen Wake Lock
  const wakeLockRef = useRef<any>(null);

  // Buscar si hay un pedido asignado pendiente de aceptar (estilo Uber)
  const pendingAssignedOrder = pendingOrders.find((order) => {
    return order.isAcceptedByDriver === false;
  });

  // Detectar cambios de conectividad para mostrar alerta de conexión
  useEffect(() => {
    setIsOnline(navigator.onLine);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Screen Wake Lock API para mantener la pantalla encendida mientras la app está abierta
  useEffect(() => {
    async function acquireWakeLock() {
      try {
        if ('wakeLock' in navigator && driverProfile?.availability === 'AVAILABLE' && !wakeLockRef.current) {
          wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        }
      } catch {}
    }

    async function releaseWakeLock() {
      try {
        if (wakeLockRef.current) {
          await wakeLockRef.current.release();
          wakeLockRef.current = null;
        }
      } catch {}
    }

    if (driverProfile?.availability === 'AVAILABLE') {
      void acquireWakeLock();
    } else {
      void releaseWakeLock();
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && driverProfile?.availability === 'AVAILABLE') {
        void acquireWakeLock();
      } else if (document.visibilityState === 'hidden') {
        void releaseWakeLock();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      void releaseWakeLock();
    };
  }, [driverProfile?.availability]);

  // Sistema de audio compartido: precarga, desbloqueo por gesto y alarma en bucle.
  useEffect(() => {
    preload('notifica');
    const uninstallWarmup = installWarmupListeners();
    const uninstallVisibility = installVisibilityResumeListener();
    return () => {
      uninstallWarmup();
      uninstallVisibility();
      stopAll();
    };
  }, []);

  // Alarma acústica (bucle sonar Uber) y vibración periódica ante nueva asignación.
  // El sonido lo reproduce ÚNICAMENTE este efecto; IncomingOrderModal ya no
  // dispara audio para evitar el doble sonido.
  useEffect(() => {
    let vibrationInterval: NodeJS.Timeout | null = null;

    if (pendingAssignedOrder) {
      if (process.env.NODE_ENV !== 'production') {
        console.log('[Alarm] New order assigned pending acceptance:', pendingAssignedOrder.id);
      }

      // El AudioContext debe estar desbloqueado (gesto previo) para que suene.
      // Con el plugin de alarma nativa el sonido lo pone el Foreground Service
      // (suena en segundo plano y se corta al aceptar): aquí lo saltamos para
      // no duplicarlo. Navegador, PWA y APKs antiguos siguen con el bucle web.
      if (!nativeAlarmHandlesSound()) {
        void warmup().finally(() => {
          play('notifica', { loop: true });
        });
      }

      // Vibración física repetitiva en dispositivos Android
      if (typeof window !== 'undefined' && 'vibrate' in navigator) {
        vibrate([850, 450, 850, 450]);
        vibrationInterval = setInterval(() => {
          vibrate([850, 450, 850, 450]);
        }, 2500);
      }

      // Respaldo: notificación del sistema vía Service Worker.
      // Si la app está en primer plano, el sonido del OS + audio web se duplican,
      // por eso solo mostramos notificación cuando la app está en segundo plano.
      if (document.visibilityState === 'hidden' && 'serviceWorker' in navigator && navigator.serviceWorker.controller) {
        try {
          navigator.serviceWorker.controller.postMessage({
            type: 'SHOW_NOTIFICATION',
            title: 'Nueva solicitud de entrega ',
            body: pendingAssignedOrder.restaurant?.name
              ? `Pedido de ${pendingAssignedOrder.restaurant.name} — $${(pendingAssignedOrder.deliveryFee || 0).toFixed(2)} MXN`
              : `Nuevo pedido asignado — $${(pendingAssignedOrder.deliveryFee || 0).toFixed(2)} MXN`,
            data: { orderId: pendingAssignedOrder.id, url: '/' },
          });
        } catch (e) {
          console.warn('Failed to post SHOW_NOTIFICATION to service worker:', e);
        }
      }
    } else {
      stopAll();
      if (vibrationInterval) {
        clearInterval(vibrationInterval);
      }
      if (typeof window !== 'undefined' && 'vibrate' in navigator) {
        if (navigator.userActivation?.hasBeenActive ?? true) {
          try { navigator.vibrate(0); } catch (e) {}
        }
      }
    }

    return () => {
      stopAll();
      if (vibrationInterval) {
        clearInterval(vibrationInterval);
      }
      if (typeof window !== 'undefined' && 'vibrate' in navigator) {
        if (navigator.userActivation?.hasBeenActive ?? true) {
          try { navigator.vibrate(0); } catch (e) {}
        }
      }
    };
  }, [pendingAssignedOrder?.id]);

  const handleTouchStart = (e: React.TouchEvent) => {
    // Precalentar AudioContext para que suene sin restricción de autoplay.
    void warmup();

    if (window.scrollY === 0) {
      touchStartY.current = e.touches[0].clientY;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartY.current === 0) return;
    const currentY = e.touches[0].clientY;
    const distance = currentY - touchStartY.current;
    if (distance > 0 && window.scrollY === 0) {
      setPullDistance(Math.min(distance * 0.5, 80));
    }
  };

  const handleTouchEnd = () => {
    if (pullDistance > 60) {
      setIsRefreshing(true);
      void loadDashboard().then(() => {
        setIsRefreshing(false);
        setPullDistance(0);
      });
    } else {
      setPullDistance(0);
    }
    touchStartY.current = 0;
  };

  // Cargar modo oscuro y sesión al iniciar
  useEffect(() => {
    const savedSession = readStoredSession(storageKey);

    if (typeof window !== 'undefined') {
      // Elección explícita del usuario > preferencia del sistema.
      const darkPref = window.localStorage.getItem('darkMode');
      const isDark = darkPref === null
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
        : darkPref === 'true';
      setDarkMode(isDark);
      if (isDark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }

      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').then(() => {
          console.log('Service Worker registered');
        }).catch((error) => {
          console.error('Service Worker registration failed:', error);
        });
      }
    }

    if (savedSession.apiBase && savedSession.apiBase.startsWith('/')) {
      setApiBase(savedSession.apiBase);
    }
    if (savedSession.token) {
      setToken(savedSession.token);
    }
    if (savedSession.user) {
      setSessionUser(savedSession.user);
    }
    setIsCheckingSession(false);
  }, []);

  // Alternar Modo Oscuro
  const toggleDarkMode = () => {
    const nextVal = !darkMode;
    setDarkMode(nextVal);
    triggerHaptic(20);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('darkMode', nextVal.toString());
      if (nextVal) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
  };

  function persistSession(nextToken: string, user: AuthUser, refreshToken?: string) {
    setToken(nextToken);
    setSessionUser(user);
    persistStoredSession({
      storageKey,
      apiBase,
      token: nextToken,
      refreshToken,
      user,
    });
  }

  // Reintenta la desvinculación pendiente del dispositivo si el logout
  // anterior falló por red (misma cola best-effort que panel/comensal).
  useEffect(() => {
    void flushPendingDeviceUnpair(apiBase);
    const handleOnline = () => {
      void flushPendingDeviceUnpair(apiBase);
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [apiBase]);

  function clearSession(message?: string) {
    // 1. Silenciar alarma nativa y audio web de inmediato: una sesión cerrada
    //    no debe seguir sonando ni vibrando.
    try {
      stopNativeOrderAlarm();
    } catch {}
    try {
      stopAll();
    } catch {}

    // 2. Cancelar avisos de esta app ya entregados en la bandeja del sistema.
    try {
      cancelDeliveredNativeNotifications();
    } catch {}
    try {
      closeActiveWebNotifications();
    } catch {}

    // 3. Desvincular el push de ESTE dispositivo en el backend (best-effort:
    //    nunca bloquea el logout). El JWT y el token FCM se capturan ANTES de
    //    limpiar la sesión local; el endpoint web se lee ahora mismo del SW.
    //    Solo se borran filas de este dispositivo: los demás dispositivos del
    //    repartidor siguen recibiendo avisos.
    const currentToken = token || readStoredSession(storageKey).token;
    const currentFcm = readNativeFcmToken();
    void (async () => {
      let endpoint: string | null = null;
      try {
        if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
          // getRegistration() (y no .ready): no cuelga si aún no hay SW activo.
          const registration = await navigator.serviceWorker.getRegistration();
          const sub = await registration?.pushManager.getSubscription();
          endpoint = sub?.endpoint ?? null;
        }
      } catch {
        endpoint = null;
      }
      await revokeDevicePush({
        apiBase,
        jwt: currentToken,
        fcmToken: currentFcm,
        endpoint,
        timeoutMs: 3500,
      }).catch(() => {});
    })();
    clearNativeFcmToken();

    setToken('');
    setSessionUser(null);
    setDriverProfile(null);
    setPendingOrders([]);
    setHistoryOrders([]);
    setSocketStatus('idle');
    setSocketAttempts(0);
    setLastFailedAction(null);
    clearStoredSession(storageKey);
    if (message) {
      setAuthMessage(message);
    }
  }

  // Sesión deslizante de 30 días: cuando el access token expira, requestJson
  // renueva en silencio con el refresh token y guarda el token fresco.
  const clearSessionRef = useRef(clearSession);
  useEffect(() => {
    clearSessionRef.current = clearSession;
  });
  const sessionUserRef = useRef(sessionUser);
  useEffect(() => {
    sessionUserRef.current = sessionUser;
  }, [sessionUser]);
  useEffect(() => {
    setDefaultRefreshConfig({
      refreshToken: () => readStoredSession(storageKey).refreshToken,
      onRefreshed: (newToken, newRefreshToken) => {
        setToken(newToken);
        const currentUser = sessionUserRef.current;
        if (currentUser) {
          persistStoredSession({
            storageKey,
            apiBase,
            token: newToken,
            refreshToken: newRefreshToken,
            user: currentUser,
          });
        }
      },
      onRefreshFailed: () => {
        clearSessionRef.current('La sesión ha expirado. Ingresa de nuevo.');
      },
    });
  }, [storageKey, apiBase, setToken]);

  function pushToast(tone: ToastTone, title: string, message: string) {
    setToasts((current) => {
      const duplicate = current.some((t) => t.title === title && t.message === message);
      if (duplicate) return current;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setTimeout(() => dismissToast(id), 8000);
      return [{ id, tone, title, message }, ...current].slice(0, 6);
    });
  }

  function dismissToast(id: string) {
    setToasts((current) => current.filter((t) => t.id !== id));
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    triggerHaptic(20);
    setPasswordError('');
    setPasswordSuccess('');

    if (newPassword.length < 6) {
      setPasswordError('La nueva contraseña debe tener al menos 6 caracteres.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('La nueva contraseña y su confirmación no coinciden.');
      return;
    }

    setUpdatingPassword(true);

    try {
      await requestJson({
        apiBase,
        path: '/driver-panel/password',
        token,
        options: {
          method: 'PATCH',
          body: JSON.stringify({
            currentPassword,
            newPassword,
          }),
        },
        fallbackMessage: 'No se pudo actualizar la contraseña.',
      });

      setPasswordSuccess('¡Tu contraseña ha sido actualizada con éxito!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      triggerHaptic([40, 20]);
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Error al actualizar contraseña.');
      triggerHaptic(100);
    } finally {
      setUpdatingPassword(false);
    }
  }

  async function handlePhotoUpload(file: File) {
    if (!file) return;
    setIsUploadingPhoto(true);
    triggerHaptic(30);

    try {
      const base64String = await convertImageFileToDataUrl(file, 800, 800, 0.75);

      const uploadPayload = await requestJson<{ success: true; data: { url: string } }>({
        apiBase,
        path: '/uploads/images',
        token,
        options: {
          method: 'POST',
          body: JSON.stringify({
            kind: 'driver-photo',
            source: base64String,
            fileName: `driver_${driverProfile?.user.id}_photo.jpg`
          }),
        },
        fallbackMessage: 'No se pudo subir la foto de perfil.'
      });

      const uploadedUrl = uploadPayload.data.url;

      await requestJson({
        apiBase,
        path: '/driver-panel/perfil/photo',
        token,
        options: {
          method: 'PATCH',
          body: JSON.stringify({
            profilePhoto: uploadedUrl
          })
        },
        fallbackMessage: 'No se pudo guardar la foto de perfil en la cuenta.'
      });

      if (driverProfile) {
        setDriverProfile({
          ...driverProfile,
          user: {
            ...driverProfile.user,
            profilePhoto: uploadedUrl
          }
        });
      }

      triggerHaptic([40, 20]);
    } catch (err: any) {
      console.error(err);
      pushToast('error', 'Error al subir', err instanceof Error ? err.message : 'No se pudo actualizar tu foto.');
      triggerHaptic(100);
    } finally {
      setIsUploadingPhoto(false);
    }
  }

  async function loginWithPassword() {
    setVerifyingCode(true);
    setError('');
    setAuthMessage('');
    persistApiBase(storageKey, apiBase);
    triggerHaptic(30);

    try {
      const payload = await requestJson<AuthResponse>({
        apiBase,
        path: '/auth/driver-login',
        options: {
          method: 'POST',
          body: JSON.stringify({
            phone: phone.trim(),
            password: password.trim(),
          }),
        },
        fallbackMessage: 'Credenciales inválidas.',
        retry: {
          attempts: 1,
          backoffMs: 300,
        },
      });

      if (payload.data.user.role !== 'DRIVER') {
        clearSession('Esta cuenta no pertenece a un repartidor de SaDeL.');
        return;
      }

      persistSession(payload.data.token, payload.data.user, payload.data.refreshToken);
    } catch (requestError) {
      const message = getRequestErrorMessage(requestError, 'Error al iniciar sesión.');
      setError(message);
    } finally {
      setVerifyingCode(false);
    }
  }

  const loadDashboard = useCallback(async () => {
    setLoadingDashboard(true);
    setError('');
    persistApiBase(storageKey, apiBase);

    try {
      const results = await Promise.allSettled([
        requestJson<SuccessResponse<DriverProfile>>({
          apiBase,
          path: '/driver-panel/perfil',
          token,
          fallbackMessage: 'Error de red al cargar el perfil.',
          retry: {
            attempts: 2,
            backoffMs: 350,
          },
        }),
        requestJson<SuccessResponse<DriverOrder[]>>({
          apiBase,
          path: '/driver-panel/pedidos/pendientes',
          token,
          fallbackMessage: 'No se pudieron cargar los pedidos en ruta.',
          retry: {
            attempts: 2,
            backoffMs: 350,
          },
        }),
        requestJson<SuccessResponse<{ items: DriverOrder[]; hasMore: boolean }>>({
          apiBase,
          path: '/driver-panel/historial?page=1&limit=20',
          token,
          fallbackMessage: 'No se pudo cargar el historial reciente.',
          retry: {
            attempts: 2,
            backoffMs: 350,
          },
        }),
      ]);

      const fulfill = <T,>(r: PromiseSettledResult<T>, fallback: T): T =>
        r.status === 'fulfilled' ? r.value : fallback;
      const requestData = <T,>(r: PromiseSettledResult<SuccessResponse<T>>, fallback: T): T =>
        r.status === 'fulfilled' ? r.value.data : fallback;

      for (const r of results) {
        if (r.status === 'rejected' && isAuthRequestError(r.reason)) {
          clearSession('La sesión ha expirado. Ingresa de nuevo.');
          pushToast('error', 'Sesión expirada', 'Tu sesión ya no es válida.');
          return;
        }
      }

      const profileData = requestData(results[0] as PromiseSettledResult<SuccessResponse<DriverProfile>>, null);
      const pendingData = requestData(results[1] as PromiseSettledResult<SuccessResponse<DriverOrder[]>>, []);
      const historyData = fulfill(results[2] as PromiseSettledResult<SuccessResponse<{ items: DriverOrder[]; hasMore: boolean }>>, null);

      const hadFailures = results.some(r => r.status === 'rejected');

      setDriverProfile(profileData);
      const patched = pendingData || [];
      const arrivedRestIds = new Set(
        patched
          .filter(o => o.tracking?.some(t => t.notes === 'DRIVER_ARRIVED_RESTAURANT'))
          .map(o => o.id)
      );
      const arrivedCustIds = new Set(
        patched
          .filter(o => o.tracking?.some(t => t.notes === 'DRIVER_ARRIVED'))
          .map(o => o.id)
      );
      patched.sort((a, b) => {
        const aArrived = arrivedRestIds.has(a.id);
        const bArrived = arrivedRestIds.has(b.id);
        if (aArrived && !bArrived) return -1;
        if (!aArrived && bArrived) return 1;
        return (a.dailyCounter ?? 999999) - (b.dailyCounter ?? 999999);
      });
      setPendingOrders(patched);
      setArrivedAtRestaurantFor([...arrivedRestIds]);
      setArrivedAtCustomerFor([...arrivedCustIds]);

      if (historyData) {
        setHistoryOrders(historyData.data.items);
        setHistoryHasMore(historyData.data.hasMore);
        setHistoryPage(1);
      }
      setDeliveryPinInput('');
      setDeliveryPinError('');


      if (hadFailures) {
        pushToast('error', 'Sincronización parcial', 'Algunos datos no pudieron cargarse.');
      }
    } catch (requestError) {
      setDriverProfile(null);
      setPendingOrders([]);
      setHistoryOrders([]);
      const message = getRequestErrorMessage(requestError, 'Error de sincronización.');
      setError(message);
      if (isAuthRequestError(requestError)) {
        clearSession('La sesión ha expirado. Ingresa de nuevo.');
        pushToast('error', 'Sesión expirada', 'Tu sesión ya no es válida.');
      } else {
        pushToast(
          'error',
          'Sincronización fallida',
          message
        );
      }
    } finally {
      setLoadingDashboard(false);
    }
  }, [apiBase, token]);

  const loadPendingOrders = useCallback(async () => {
    try {
      const pendingPayload = await requestJson<SuccessResponse<DriverOrder[]>>({
        apiBase,
        path: '/driver-panel/pedidos/pendientes',
        token,
        fallbackMessage: 'No se pudieron cargar los pedidos en ruta.',
      });
      if (pendingPayload.success) {
        const data = pendingPayload.data;
        const arrivedRestIds = new Set(
          data
            .filter(o => o.tracking?.some(t => t.notes === 'DRIVER_ARRIVED_RESTAURANT'))
            .map(o => o.id)
        );
        const arrivedCustIds = new Set(
          data
            .filter(o => o.tracking?.some(t => t.notes === 'DRIVER_ARRIVED'))
            .map(o => o.id)
        );
        data.sort((a, b) => {
          const aArrived = arrivedRestIds.has(a.id);
          const bArrived = arrivedRestIds.has(b.id);
          if (aArrived && !bArrived) return -1;
          if (!aArrived && bArrived) return 1;
          return (a.dailyCounter ?? 999999) - (b.dailyCounter ?? 999999);
        });
        setPendingOrders(data);
        setArrivedAtRestaurantFor([...arrivedRestIds]);
        setArrivedAtCustomerFor([...arrivedCustIds]);
      }
    } catch {
      // Silent fail — loadDashboard lo hará completo después
    }
  }, [apiBase, token]);

  useEffect(() => {
    if (!token || !sessionUser || sessionUser.role !== 'DRIVER') {
      return;
    }
    void loadDashboard();
  }, [loadDashboard, token, sessionUser]);

  const subscribeToPush = useCallback(async (tokenToUse: string): Promise<
    | { ok: true }
    | { ok: false; reason: 'DENIED' | 'BLOCKED' | 'INSECURE' | 'NOT_SUPPORTED' | 'VAPID_NOT_CONFIGURED' | 'SUBSCRIBE_FAILED' | 'UNKNOWN' }
  > => {
    // App nativa (WebView Capacitor): FCM vía plugin nativo, sin serviceWorker web.
    if (isNativePlatform()) {
      const permission = await requestNativePushPermission();
      if (permission !== 'granted') {
        return { ok: false, reason: permission === 'unavailable' ? 'NOT_SUPPORTED' : 'DENIED' };
      }
      const result = await registerNativePush(apiBase, tokenToUse);
      if (!result.ok) {
        console.error('[Push] FCM registration failed:', result.reason);
        return { ok: false, reason: 'SUBSCRIBE_FAILED' };
      }
      return { ok: true };
    }

    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('Notification' in window)) {
      return { ok: false, reason: 'NOT_SUPPORTED' };
    }

    // Push/Notification requieren un contexto seguro (HTTPS). Sin ello el navegador
    // ignora la petición en silencio: es la causa #1 de "no llegan notificaciones".
    if (window.isSecureContext === false) {
      return { ok: false, reason: 'INSECURE' };
    }

    try {
      const registration = await navigator.serviceWorker.ready;

      if (Notification.permission === 'default') {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          return { ok: false, reason: 'DENIED' };
        }
      }

      if (Notification.permission !== 'granted') {
        return { ok: false, reason: 'BLOCKED' };
      }

      const response = await fetch(`${apiBase}/notifications/vapid-key`);
      let data: { publicKey?: string | null; configured?: boolean };
      try {
        data = await response.json();
      } catch {
        data = {};
      }
      const publicKey = data.publicKey;

      if (!publicKey || data.configured === false) {
        console.error('[Push] VAPID no configurado en el servidor:', data);
        return { ok: false, reason: 'VAPID_NOT_CONFIGURED' };
      }

      const existingSub = await registration.pushManager.getSubscription();
      if (existingSub) {
        // Reutilizamos la suscripción existente: recrearla en cada carga mata la
        // push en iOS y acumula endpoints huérfanos. Si el servidor la rechaza
        // (sub rota por VAPID distinto), la limpiamos y volvemos a suscribir.
        const subJson: any = existingSub.toJSON();
        const existingKey = subJson && typeof subJson === 'object' ? subJson.keys?.p256dh : undefined;
        if (!existingKey) {
          try {
            await existingSub.unsubscribe();
          } catch { /* noop */ }
        } else {
          const subResponse = await fetch(`${apiBase}/notifications/subscribe`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${tokenToUse}`
            },
            body: JSON.stringify(existingSub)
          });
          if (subResponse.ok) {
            if (process.env.NODE_ENV !== 'production') {
              console.log('Push subscription already active, re-synced to server');
            }
            return { ok: true };
          }
          // La sub quedó huérfana/inservible: descartarla y re-suscribir abajo.
          try {
            await existingSub.unsubscribe();
          } catch { /* noop */ }
        }
      }

      // Crear la suscripción con reintentos que manejan errores transitorios de
      // iOS (AbortError) y subs huérfanas por cambio de VAPID (InvalidStateError).
      let subscription: PushSubscription | null = null;
      const attempts = [0, 1, 2];
      for (const attempt of attempts) {
        try {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey)
          });
          break;
        } catch (subscribeError: any) {
          if (subscribeError?.name === 'InvalidStateError') {
            // La VAPID cambió: limpiar la sub vieja y reintentar una vez.
            const stale = await registration.pushManager.getSubscription();
            if (stale) {
              try { await stale.unsubscribe(); } catch { /* noop */ }
            }
            continue;
          }
          if (subscribeError?.name === 'AbortError' && attempt < attempts.length - 1) {
            await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
            continue;
          }
          console.error('[Push] Error al suscribir:', subscribeError);
          return { ok: false, reason: 'SUBSCRIBE_FAILED' };
        }
      }
      if (!subscription) {
        return { ok: false, reason: 'SUBSCRIBE_FAILED' };
      }

      const subResponse = await fetch(`${apiBase}/notifications/subscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenToUse}`
        },
        body: JSON.stringify(subscription)
      });

      if (!subResponse.ok) {
        console.error('[Push] Suscripción rechazada por el servidor:', subResponse.status);
        return { ok: false, reason: 'SUBSCRIBE_FAILED' };
      }

      if (process.env.NODE_ENV !== 'production') {
        console.log('Subscribed to push notifications');
      }
      return { ok: true };
    } catch (error) {
      console.error('Failed to subscribe to push:', error);
      return { ok: false, reason: 'SUBSCRIBE_FAILED' };
    }
  }, [apiBase]);

  // Exponer subscribeToPush al listener del Service Worker (rotación de subs).
  subscribeToPushRef.current = subscribeToPush;

  // Re-suscripción automática: si el navegador rota o expira la suscripción
  // (actualización de iOS/Chrome, inactividad), el SW avisa y aquí se recrea sin
  // que el repartidor tenga que hacer nada. Sin esto, dejaba de recibir
  // "Nuevo pedido asignado" hasta reabrir la app.
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    const handleSWMessage = (event: MessageEvent) => {
      if (event.data?.type === 'PUSH_SUBSCRIPTION_CHANGED') {
        const storedToken = readStoredSession(storageKey).token;
        if (storedToken && subscribeToPushRef.current) {
          void subscribeToPushRef.current(storedToken);
        }
      }
    };

    navigator.serviceWorker.addEventListener('message', handleSWMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handleSWMessage);
    };
  }, []);

  useEffect(() => {
    if (!token || typeof window === 'undefined') return;

    // El bridge de Capacitor puede inyectarse después del montaje. Sin esperar,
    // la app decide "soy web" dentro del APK, se suscribe por web-push y nunca
    // registra el token FCM: Android se queda sin notificaciones.
    let cancelled = false;
    void waitForNativeBridge({ isReady: () => isNativePlatform() }).then((bridgeReady) => {
      if (cancelled) return;

      if (bridgeReady) {
        // En la app nativa el permiso se consulta vía plugin y el token FCM se
        // re-sincroniza con el backend en cada arranque.
        checkNativePushPermission().then((granted) => {
          if (!cancelled && granted) void subscribeToPush(token);
        });
        return;
      }

      // Solo se restablece la suscripción cuando el permiso YA fue concedido en
      // una sesión anterior; el primer permiso se pide desde el banner.
      if (
        sessionUser &&
        sessionUser.role === 'DRIVER' &&
        'Notification' in window &&
        Notification.permission === 'granted'
      ) {
        void subscribeToPush(token);
      }
    });

    return () => { cancelled = true; };
  }, [token, sessionUser, subscribeToPush]);

  // Push nativo: al tocar la notificación FCM en la app del repartidor,
  // asegurar que el pedido entrante se muestre (IncomingOrderModal).
  useEffect(() => {
    if (typeof window === 'undefined' || !isNativePlatform() || !token) return;
    const off = onNativeNotificationTap(({ orderId }) => {
      if (!orderId) return;
      void loadPendingOrders();
    });
    return off;
  }, [token, loadPendingOrders]);

  // Screen Wake Lock: mantener la pantalla encendida mientras la app del repartidor está abierta.
  useEffect(() => {
    try {
      if (isNativePlatform()) {
        nativeKeepAwake();
      }
    } catch { /* noop */ }
    return () => {
      try {
        if (isNativePlatform()) {
          nativeAllowSleep();
        }
      } catch { /* noop */ }
    };
  }, []);

  // Efecto para el rastreo de ubicación (watchPosition; evita reinicios por pendingOrders)
  useEffect(() => {
    if (!token || !sessionUser || sessionUser.role !== 'DRIVER' || !shareLocationGps) {
      return;
    }

    if (typeof window === 'undefined' || !navigator.geolocation) {
      return;
    }

    const ACTIVE_STATUSES = ['CONFIRMED', 'PREPARING', 'READY', 'PICKED_UP', 'IN_TRANSIT'] as const;
    const GEO_PAUSE_KEY = 'sadel.driver.geoPausedUntil';

    let watchId: number | null = null;
    let cancelled = false;
    let consecutiveFailures = 0;
    let lastErrorLogAt = 0;
    let lastPosition: { lat: number; lng: number } | null = null;
    let lastPostAt = 0;
    let locationPostPending = false;

    const readPausedUntil = () => {
      const raw = window.sessionStorage.getItem(GEO_PAUSE_KEY);
      const parsed = raw ? Number(raw) : 0;
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const writePausedUntil = (until: number) => {
      if (until > Date.now()) {
        window.sessionStorage.setItem(GEO_PAUSE_KEY, String(until));
      } else {
        window.sessionStorage.removeItem(GEO_PAUSE_KEY);
      }
    };

    const getTrackingMode = () => {
      const orders = pendingOrdersRef.current;
      const hasActiveDeliveries = orders.some((order) =>
        ACTIVE_STATUSES.includes(order.status as (typeof ACTIVE_STATUSES)[number])
      );
      const isAvailable = driverProfileRef.current?.availability === 'AVAILABLE';
      return { hasActiveDeliveries, isAvailable, shouldTrack: hasActiveDeliveries || isAvailable };
    };

    const shouldSend = (lat: number, lng: number) => {
      if (!lastPosition) return true;
      if (Date.now() - lastPostAt >= 60000) return true;
      const deltaLat = Math.abs(lat - lastPosition.lat);
      const deltaLng = Math.abs(lng - lastPosition.lng);
      // Durante entregas activas toleramos menos desplazamiento para capturar
      // giros/paradas (rastro denso); en reposo solo enviamos si hubo movimiento claro.
      const { hasActiveDeliveries } = getTrackingMode();
      // Reposo: mínimo ~200 m de desplazamiento antes de volver a reportar.
      const threshold = hasActiveDeliveries ? 0.00006 : 0.002;
      return !(deltaLat < threshold && deltaLng < threshold);
    };

    const postLocation = async (lat: number, lng: number) => {
      const now = Date.now();
      const { hasActiveDeliveries } = getTrackingMode();
      // Limitar tráfico en reparto y confirmar periódicamente una posición detenida.
      const minInterval = hasActiveDeliveries ? 10000 : 60000;
      if (locationPostPending || now - lastPostAt < minInterval) return;
      lastPostAt = now;
      locationPostPending = true;

      try {
        await requestJson({
          apiBase,
          path: '/driver-panel/ubicacion',
          token,
          options: {
            method: 'POST',
            body: JSON.stringify({ coords: [lat, lng] }),
          },
          fallbackMessage: 'No se pudo actualizar la ubicación.',
        });
        lastPosition = { lat, lng };
      } catch {
        // Error de red/backend: no es un fallo de GPS.
      } finally {
        locationPostPending = false;
      }
    };

    const stopWatching = () => {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
    };

    const maybeLogGeoError = (error: GeolocationPositionError) => {
      if (error.code === 2 || error.code === 3) {
        const now = Date.now();
        if (now - lastErrorLogAt > 5 * 60 * 1000) {
          lastErrorLogAt = now;
          if (process.env.NODE_ENV !== 'production') {
            console.debug('Geolocation unavailable (transient). Will retry later.');
          }
        }
        return;
      }
      if (process.env.NODE_ENV !== 'production') {
        console.warn('Geolocation permission denied.');
      }
    };

    const onPositionSuccess = (position: GeolocationPosition) => {
      if (cancelled) return;

      consecutiveFailures = 0;
      writePausedUntil(0);

      const lat = parseFloat(position.coords.latitude.toFixed(6));
      const lng = parseFloat(position.coords.longitude.toFixed(6));

      if (document.visibilityState === 'hidden') return;
      if (!shouldSend(lat, lng)) return;

      void postLocation(lat, lng);
    };

    const onPositionError = (error: GeolocationPositionError) => {
      if (cancelled) return;

      consecutiveFailures += 1;
      maybeLogGeoError(error);

      if (error.code === 1) {
        stopWatching();
        return;
      }

      if (consecutiveFailures >= 3) {
        const pauseMs = consecutiveFailures >= 5 ? 15 * 60 * 1000 : 5 * 60 * 1000;
        writePausedUntil(Date.now() + pauseMs);
      }
    };

    const startWatching = () => {
      stopWatching();
      if (cancelled || document.visibilityState === 'hidden') return;

      const { hasActiveDeliveries, shouldTrack } = getTrackingMode();
      if (!shouldTrack) return;

      const pausedUntil = readPausedUntil();
      if (Date.now() < pausedUntil) return;

      watchId = navigator.geolocation.watchPosition(
        onPositionSuccess,
        onPositionError,
        {
          enableHighAccuracy: hasActiveDeliveries,
          timeout: hasActiveDeliveries ? 20000 : 12000,
          maximumAge: hasActiveDeliveries ? 10000 : 120000,
        }
      );
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        startWatching();
      } else {
        stopWatching();
      }
    };

    const handleOnline = () => {
      consecutiveFailures = 0;
      writePausedUntil(0);
      startWatching();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);
    gpsRescheduleRef.current = startWatching;
    startWatching();

    return () => {
      cancelled = true;
      gpsRescheduleRef.current = null;
      stopWatching();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
    };
  }, [token, sessionUser, apiBase, shareLocationGps, driverProfile?.availability]);

  const hasActiveDeliveriesForGps = pendingOrders.some((order) =>
    ['CONFIRMED', 'PREPARING', 'READY', 'PICKED_UP', 'IN_TRANSIT'].includes(order.status)
  );

  useEffect(() => {
    gpsRescheduleRef.current?.();
  }, [hasActiveDeliveriesForGps]);

  // Manejo de Websockets en Tiempo Real
  useEffect(() => {
    if (!token || !sessionUser || sessionUser.role !== 'DRIVER') {
      return;
    }

    setSocketStatus('connecting');
    const apiUrl = getWingslabSocketUrl();
    const socket = io(apiUrl, {
      path: '/socket.io',
      transports: apiUrl ? ['websocket', 'polling'] : ['polling'],
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 30000,
    });

    let healthCheckInterval: any;
    let lastEventTime = Date.now();
    // Debounce trailing con tope máximo: agrupa ráfagas de eventos en una sola
    // recarga, pero garantiza refresco aunque lleguen eventos continuos.
    let refreshDebounceTimer: any = null;
    let refreshScheduledAt = 0;
    const debouncedRefresh = () => {
      const now = Date.now();
      if (refreshDebounceTimer && now - refreshScheduledAt >= 10000) {
        clearTimeout(refreshDebounceTimer);
        refreshDebounceTimer = null;
        refreshScheduledAt = now;
        void loadDashboard();
        return;
      }
      if (refreshDebounceTimer) {
        clearTimeout(refreshDebounceTimer);
      } else {
        refreshScheduledAt = now;
      }
      refreshDebounceTimer = setTimeout(() => {
        refreshDebounceTimer = null;
        void loadDashboard();
      }, 3000);
    };

    socket.on('connect', () => {
      socketConnectedRef.current = true;
      setSocketStatus('connected');
      setSocketAttempts(0);
      lastEventTime = Date.now();
      socket.emit('join-room', sessionUser.id, 'DRIVER');
      void loadDashboard();
      void loadPendingOrders();
    });

    socket.io.on('reconnect_attempt', (attempt) => {
      socketConnectedRef.current = false;
      setSocketStatus('reconnecting');
      setSocketAttempts(attempt);
    });

    socket.on('reconnect', () => {
      // Reconexión exitosa: forzar recarga de pedidos pendientes
      socketConnectedRef.current = true;
      lastEventTime = Date.now();
      void loadPendingOrders();
      void loadDashboard();
    });

    socket.on('disconnect', (reason) => {
      if (reason !== 'io client disconnect') {
        socketConnectedRef.current = false;
        setSocketStatus('reconnecting');
        return;
      }
      socketConnectedRef.current = false;
      setSocketStatus('idle');
    });

    socket.on('connect_error', (err) => {
      // Fallo de conexión (red, servidor caído, DNS). Marcamos el socket como
      // caído para que el polling de respaldo recargue pedidos mientras
      // socket.io reintenta por su cuenta.
      socketConnectedRef.current = false;
      setSocketStatus('reconnecting');
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[Socket] connect_error:', err?.message || err);
      }
    });

    // Detectar socket zombie: si no se recibe ningún evento en 90s, forzar recarga
    healthCheckInterval = setInterval(() => {
      if (socket.connected && document.visibilityState !== 'hidden') {
        const idleTime = Date.now() - lastEventTime;
        if (idleTime > 90000) {
          if (process.env.NODE_ENV !== 'production') {
            console.warn('[Socket] Zombie detection: no events for 90s, forcing reload');
          }
          void loadPendingOrders();
          void loadDashboard();
          lastEventTime = Date.now();
        }
      }
    }, 60000);

    // Marcar último evento recibido para el health check
    const markEvent = () => { lastEventTime = Date.now(); };
    socket.onAny(markEvent);

    // Handler DEDICADO para order:assigned — actualiza inmediatamente sin debounce
    socket.on('order:assigned', (payload: { orderId?: string; orderReference?: string; restaurantName?: string; status?: string }) => {
      const liveEventKey = buildLiveEventKey('order:assigned', payload);
      if (seenLiveEventKeysRef.current.includes(liveEventKey)) return;
      seenLiveEventKeysRef.current = [...seenLiveEventKeysRef.current.slice(-39), liveEventKey];
      const liveMessage = buildDriverLiveMessage('order:assigned', payload);
      setAuthMessage(liveMessage);
      // Alerta sonora en primer plano (en segundo plano suena el canal nativo).
      // Con el plugin de alarma nativa el sonido lo pone el Foreground Service
      // en ambos casos, así que aquí no se duplica en ninguna situación.
      if (!nativeAlarmHandlesSound() && !isNativeAppInBackground()) {
        playAlertSound('/sounds/notifica.wav');
      }
      // Pedido entrante es crítico: refrescar sin debounce
      void loadPendingOrders();
      void loadDashboard();
    });

    // Handler DEDICADO para order:driver-auto-unassigned — el pedido pendiente
    // de aceptar debe salir de la ruta de inmediato (modal de aceptar se cierra).
    socket.on('order:driver-auto-unassigned', (payload: { orderId?: string; orderReference?: string; status?: string }) => {
      const liveEventKey = buildLiveEventKey('order:driver-auto-unassigned', payload);
      if (seenLiveEventKeysRef.current.includes(liveEventKey)) return;
      seenLiveEventKeysRef.current = [...seenLiveEventKeysRef.current.slice(-39), liveEventKey];
      const liveMessage = buildDriverLiveMessage('order:driver-auto-unassigned', payload);
      setAuthMessage(liveMessage);
      pushToast('info', 'Pedido desasignado', liveMessage);
      void loadPendingOrders();
      void loadDashboard();
    });

    // Handler GENERAL para el resto de eventos en vivo
    for (const eventName of liveEvents) {
      if (eventName === 'order:assigned') continue; // ya se manejó arriba
      if (eventName === 'order:driver-auto-unassigned') continue; // ya se manejó arriba
      socket.on(
        eventName,
        (payload: { orderId?: string; orderReference?: string; restaurantName?: string; status?: string }) => {
          const liveEventKey = buildLiveEventKey(eventName, payload);

          if (seenLiveEventKeysRef.current.includes(liveEventKey)) {
            return;
          }

          seenLiveEventKeysRef.current = [...seenLiveEventKeysRef.current.slice(-39), liveEventKey];
          const liveMessage = buildDriverLiveMessage(eventName, payload);
          setAuthMessage(liveMessage);
          // Eventos no críticos usar debounce para evitar recargas en ráfaga
          debouncedRefresh();
        }
      );
    }

    // Habilitar botón "Iniciar viaje" en tiempo real cuando el restaurante confirma el pago en efectivo
    socket.on('order:cash-payment-confirmed', (payload: { orderId: string }) => {
      const confirmedOrder = pendingOrders.find(o => o.id === payload.orderId);
      const isStore = confirmedOrder?.restaurant?.businessType && confirmedOrder.restaurant.businessType !== 'RESTAURANT';
      setPendingOrders((prev) =>
        prev.map((o) =>
          o.id === payload.orderId
            ? { ...o, cashPaymentConfirmedAt: new Date().toISOString() }
            : o
        )
      );
      pushToast('success', ' Pago confirmado', isStore ? 'La tienda confirmó el pago. Ya puedes iniciar el viaje.' : 'El restaurante confirmó el pago. Ya puedes iniciar el viaje.');
      debouncedRefresh();
    });

    // Actualizar status del pedido en tiempo real (ej. READY  PICKED_UP cuando restaurante confirma entrega)
    socket.on('order:status-changed', (payload: { orderId: string; status?: string }) => {
      setPendingOrders((prev) =>
        prev.map((o) =>
          o.id === payload.orderId
            ? { ...o, status: (payload.status || o.status) as DriverOrder['status'] }
            : o
        )
      );
    });

    // Cuando el PIN se agota (3 intentos fallidos), el servidor genera uno nuevo
    socket.on('order:pin-reset', (payload: { orderId: string; handoverPin: string }) => {
      setPendingOrders((prev) =>
        prev.map((o) =>
          o.id === payload.orderId
            ? { ...o, handoverPin: payload.handoverPin }
            : o
        )
      );
      pushToast('info', ' Nuevo PIN generado', 'El PIN anterior expiró. Muestra este nuevo PIN al restaurante.');
    });

    return () => {
      clearInterval(healthCheckInterval);
      if (refreshDebounceTimer) clearTimeout(refreshDebounceTimer);
      socket.offAny(markEvent);
      socket.emit('leave-room', sessionUser.id, 'DRIVER');
      socket.disconnect();
      socketConnectedRef.current = false;
      setSocketStatus('idle');
      setSocketAttempts(0);
    };
  }, [apiBase, loadDashboard, loadPendingOrders, sessionUser, token]);

  // Polling de respaldo: cuando el socket está caído, recarga los pedidos
  // pendientes en primer plano para no perder asignaciones (la push del OS
  // cubre el segundo plano; aquí cubrimos el hueco con la app abierta).
  useForegroundPolling(() => {
    if (!token || !sessionUser || sessionUser.role !== 'DRIVER') return;
    if (socketConnectedRef.current) return;
    void loadPendingOrders();
  }, 15_000);

  // Polling de respaldo solo cuando la pestaña está visible y hay efectivo pendiente
  useEffect(() => {
    const hasCashWaiting = pendingOrders.some(
      (o) => o.paymentMethod === 'CASH' && !o.cashPaymentConfirmedAt
    );
    if (!hasCashWaiting) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;

    function startPolling() {
      if (intervalId) clearInterval(intervalId);
      if (document.visibilityState === 'hidden') return;
      void loadPendingOrders();
      intervalId = setInterval(() => void loadPendingOrders(), 7000);
    }

    function stopPolling() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }

    startPolling();
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') startPolling();
      else stopPolling();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [pendingOrders, loadPendingOrders]);

  // Tic cada segundo mientras exista una entrega activa en el domicilio,
  // para actualizar la cuenta regresiva de "lugar seguro" / "cliente no salió".
  const hasActiveCustomerArrival = pendingOrders.some(
    (o) =>
      o.status === 'IN_TRANSIT' &&
      (arrivedAtCustomerFor.includes(o.id) || !!o.driverArrivedAtCustomer)
  );
  useEffect(() => {
    if (!hasActiveCustomerArrival) return;
    setDeliveryClock(Date.now());
    const id = setInterval(() => setDeliveryClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasActiveCustomerArrival]);

  async function updateAvailability(nextAvailability: DriverAvailability) {
    setUpdatingAvailability(nextAvailability);
    setError('');
    setAuthMessage('');
    triggerHaptic([30, 20]);

    try {
      const payload = await requestJson<DriverAvailabilityResponse>({
        apiBase,
        path: '/driver-panel/disponibilidad',
        token,
        options: {
          method: 'PATCH',
          body: JSON.stringify({
            availability: nextAvailability,
          }),
        },
        fallbackMessage: 'No se pudo cambiar el estado de disponibilidad.',
        retry: {
          attempts: 1,
          backoffMs: 400,
        },
      });

      setDriverProfile((current) =>
        current
          ? {
            ...current,
            availability: payload.data.availability,
            user: current.user,
          }
          : current
      );
      const message = `Estado operativo: ${availabilityLabelMap[nextAvailability]}.`;
      setAuthMessage(message);
      setLastFailedAction(null);
    } catch (requestError) {
      const message = getRequestErrorMessage(requestError, 'Error al cambiar estado.');
      setError(message);
      setLastFailedAction({
        kind: 'availability',
        availability: nextAvailability,
        label: `Cambiar estado a ${availabilityLabelMap[nextAvailability]}`,
      });
      pushToast('error', 'Operación fallida', message);
    } finally {
      setUpdatingAvailability(null);
    }
  }

  async function runDriverAction(orderId: string, actionKey: keyof typeof driverActionMap, pin?: string) {
    const action = driverActionMap[actionKey];

    // Flujo de Ahorro Extremo de Datos / Actualización Optimista para "Llegué"
    if (actionKey === 'arrived') {
      setActiveActionKey(null);
      triggerHaptic([60, 40, 60]);

      // Enviar la petición silenciosamente en segundo plano con más reintentos
      requestJson<SuccessResponse<DriverOrder>>({
        apiBase,
        path: `/driver-panel/pedidos/${orderId}/${action.path}`,
        token,
        options: {
          method: 'PATCH',
          body: pin ? JSON.stringify({ pin }) : undefined,
        },
        retry: {
          attempts: 5,
          backoffMs: 1000,
        },
      }).catch((requestError) => {
        const message = getRequestErrorMessage(requestError, `Acción no ejecutada.`);
        pushToast('error', 'Poca señal', 'No pudimos avisar al comensal. Reintentaremos pronto.');
        console.error('Background request failed for arrived:', message);
      });
      return;
    }

    setActiveActionKey(`${orderId}:${actionKey}`);
    setError('');
    setAuthMessage('');
    triggerHaptic(40);

    // Al aceptar o rechazar, la alarma continua nativa ya no debe sonar: se
    // corta al instante, sin esperar al push de "stop" del backend. Se hace
    // fuera del try para que un fallo de red no deje sonando la alarma.
    if (actionKey === 'accept' || actionKey === 'reject') {
      stopNativeOrderAlarm(orderId);
    }

    try {
      await requestJson<SuccessResponse<DriverOrder>>({
        apiBase,
        path: `/driver-panel/pedidos/${orderId}/${action.path}`,
        token,
        options: {
          method: 'PATCH',
          body: pin ? JSON.stringify({ pin }) : undefined,
        },
        fallbackMessage: `Error al procesar la acción "${action.label}".`,
        retry: {
          attempts: 1,
          backoffMs: 400,
        },
      });

      // Si la acción del PIN es correcta, cerramos modal/limpiamos
      if (pin) {
        setShowPinModal(false);
        setPinInput('');
        setPinModalError('');
        setDeliveryPinInput('');
        setDeliveryPinError('');
      }

      // Si es un rechazo, limpiar la clave de dedup para que la re-oficialización
      // (segundo intento) pueda disparar el evento order:assigned sin ser bloqueada
      if (actionKey === 'reject') {
        seenLiveEventKeysRef.current = seenLiveEventKeysRef.current.filter(
          (key) => !key.includes(`order:assigned:${orderId}`)
        );
      }

      await loadDashboard();
      setLastFailedAction(null);
      triggerHaptic([60, 40, 60]); // Patrón de éxito
    } catch (requestError) {
      const message = getRequestErrorMessage(requestError, `Acción no ejecutada.`);
      if (pin) {
        if (actionKey === 'delivered') {
          setDeliveryPinError(message);
        } else {
          setPinModalError(message);
        }
        triggerHaptic([300, 100]);
      } else {
        setError(message);
        setLastFailedAction({
          kind: 'driver-action',
          orderId,
          actionKey,
          label: action.label,
        });
        
        if (actionKey !== 'accept' && actionKey !== 'reject') {
          pushToast('error', 'Fallo en la operación', message);
        } else {
          // Si falló aceptar o rechazar (ej. otro repartidor lo tomó), simplemente recargamos
          loadDashboard().catch(() => {});
        }
      }
    } finally {
      setActiveActionKey(null);
    }
  }

  async function retryLastFailedAction() {
    if (!lastFailedAction) return;

    if (lastFailedAction.kind === 'availability') {
      await updateAvailability(lastFailedAction.availability);
      return;
    }
    await runDriverAction(lastFailedAction.orderId, lastFailedAction.actionKey);
  }

  // ==========================================
  // PANTALLA 1: AUTENTICACIÓN (LOGIN) REDISEÑADO
  // ==========================================
  if (isCheckingSession) {
    return (
      <main className="min-h-[100dvh] bg-surface dark:bg-black font-sans text-foreground dark:text-zinc-100 flex items-center justify-center">
        <div className="animate-pulse opacity-50">Cargando...</div>
      </main>
    );
  }

  if (!token || !sessionUser) {
    return (
      <main className="min-h-[100dvh] flex flex-col justify-between bg-surface text-foreground font-sans antialiased"
      >
        <header className="px-6 py-5 flex justify-between items-center max-w-md mx-auto w-full">
          <div className="flex items-center gap-2">
            <SaDelLogo className="h-8 w-auto" />
          </div>
        </header>

        <section className="w-full max-w-md mx-auto px-6 py-4 flex-1 flex flex-col justify-center">
          <div className="rounded-[32px] bg-surface p-8 shadow-[0_8px_32px_rgba(0,0,0,0.06)] border border-black/[0.06]">
            <div className="text-center mb-8">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-sky-600">
                <span className="h-1.5 w-1.5 rounded-full bg-sky-500 animate-pulse" />
                Acceso Repartidor
              </span>
              <h1 className="text-2xl font-bold tracking-tight text-foreground mt-5">
                Bienvenido a SaDeL
              </h1>
              <p className="text-sm text-muted mt-1.5 leading-relaxed">
                Ingresa con tu número y contraseña para comenzar a recibir pedidos.
              </p>
            </div>

            <div className="space-y-4">
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-muted">Teléfono Celular</span>
                <div className="relative flex items-center">
                  <span className="absolute left-4 text-sm font-semibold text-muted">+52</span>
                  <input
                    type="tel"
                    placeholder="55 1234 5678"
                    className="w-full rounded-2xl border border-black/[0.08] bg-surface px-4 py-3.5 pl-12 text-sm text-foreground outline-none transition-all placeholder:text-muted shadow-[0_1px_2px_rgba(0,0,0,0.02)] focus:border-black/20 focus:shadow-[0_4px_12px_rgba(0,0,0,0.04)] focus:ring-2 focus:ring-black/[0.04]"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-muted">Contraseña</span>
                <div className="relative flex items-center">
                  <input
                    type={showLoginPassword ? 'text' : 'password'}
                    placeholder="••••••••••••"
                    className="w-full rounded-2xl border border-black/[0.08] bg-surface px-4 py-3.5 pr-14 text-sm text-foreground outline-none transition-all placeholder:text-muted shadow-[0_1px_2px_rgba(0,0,0,0.02)] focus:border-black/20 focus:shadow-[0_4px_12px_rgba(0,0,0,0.04)] focus:ring-2 focus:ring-black/[0.04]"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowLoginPassword((current) => !current)}
                    aria-label={showLoginPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    tabIndex={-1}
                    className="absolute right-2 inset-y-0 my-auto flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors duration-200 hover:bg-surface-2 hover:text-foreground active:scale-95 focus-visible:text-foreground"
                  >
                    {showLoginPassword ? (
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                      </svg>
                    ) : (
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    )}
                  </button>
                </div>
              </label>

              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => void loginWithPassword()}
                  disabled={verifyingCode || phone.trim().length < 8 || password.trim().length < 4}
                  className="w-full rounded-2xl bg-[#0a0a0a] py-3.5 text-sm font-semibold text-white transition-all duration-200 hover:bg-[#262626] hover:shadow-[0_8px_24px_rgba(10,10,10,0.12)] disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted disabled:shadow-none active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  {verifyingCode ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                      Conectando...
                    </>
                  ) : (
                    'Iniciar Sesión'
                  )}
                </button>
              </div>

              {authMessage && (
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4 text-xs font-bold text-emerald-800 dark:border-emerald-950/20 dark:bg-emerald-950/10 dark:text-emerald-400 text-center animate-pulse">
                  {authMessage}
                </div>
              )}

              {error && (
                <div className="rounded-2xl border border-rose-100 bg-rose-50/50 p-4 text-xs font-bold text-rose-800 dark:border-rose-950/20 dark:bg-rose-950/10 dark:text-rose-400 text-center">
                  <AlertTriangle className="h-5 w-5" /> {error}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Footer simple de marca */}
        <footer className="px-6 py-6 text-center text-[11px] font-semibold tracking-wider text-muted max-w-sm mx-auto">
          SaDeL Logistics · Pro Console v2.0
        </footer>

        {/* Modal de Configuración Técnica Ocultable */}
        {showDeveloperSettings && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-[32px] border border-black/5 bg-surface p-6 shadow-2xl dark:bg-zinc-950 dark:border-zinc-900 animate-fadeIn">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-sm font-black uppercase tracking-wider">Configuración Técnica</h3>
                <button
                  type="button"
                  onClick={() => setShowDeveloperSettings(false)}
                  className="h-8 w-8 rounded-full flex items-center justify-center border border-black/5 dark:border-zinc-900 bg-surface-2 dark:bg-zinc-900"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-4">
                <label className="block space-y-1.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-muted">API Endpoint Base</span>
                  <input
                    type="text"
                    value={apiBase}
                    onChange={(e) => setApiBase(e.target.value)}
                    placeholder="/api"
                    className="w-full rounded-xl border border-black/5 bg-surface-2 px-4 py-3 text-xs outline-none focus:border-border dark:bg-zinc-900 dark:border-zinc-800 dark:focus:border-zinc-700"
                  />
                </label>

                <p className="text-[10px] text-muted leading-relaxed">
                  Modifica este campo únicamente bajo instrucción del equipo técnico. Las sesiones abiertas se sincronizarán a la URL especificada.
                </p>

                <button
                  type="button"
                  onClick={() => {
                    persistApiBase(storageKey, apiBase);
                    setShowDeveloperSettings(false);
                    pushToast('success', 'Endpoint Guardado', 'Configuración de red actualizada.');
                  }}
                  className="w-full py-3 bg-neutral-950 text-white rounded-xl text-xs font-bold dark:bg-zinc-900"
                >
                  Confirmar URL de Red
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    );
  }

  // ==========================================
  // COMPONENTES PRINCIPALES (LOGGED IN)
  // ==========================================
  const loadMoreHistory = async () => {
    if (loadingMoreHistory || !historyHasMore) return;
    setLoadingMoreHistory(true);
    const nextPage = historyPage + 1;
    try {
      const historyPayload = await requestJson<SuccessResponse<{ items: DriverOrder[]; hasMore: boolean }>>({
        apiBase,
        path: `/driver-panel/historial?page=${nextPage}&limit=20`,
        token,
        fallbackMessage: 'No se pudo cargar más historial.',
      });
      if (historyPayload.success) {
        setHistoryOrders(prev => [...prev, ...historyPayload.data.items]);
        setHistoryHasMore(historyPayload.data.hasMore);
        setHistoryPage(nextPage);
      }
    } catch (err) {
      alert('Error cargando más viajes.');
    } finally {
      setLoadingMoreHistory(false);
    }
  };

  const activeCount = pendingOrders.length;

  return (
    <main
      className={`min-h-[100dvh] bg-surface text-foreground transition-colors duration-300 dark:bg-black dark:text-zinc-300 font-sans antialiased select-none overflow-x-hidden ${activeTab === 'active' ? 'pb-20' : ''}`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onClick={() => void warmup()}
    >
      <PushEnableBanner
        visible={Boolean(token && sessionUser && sessionUser.role === 'DRIVER')}
        onEnable={() => subscribeToPush(token || '')}
      />

      {/* BARRA DE CONEXIÓN PERDIDA */}
        {!isOnline && (
          <div className="sticky top-0 z-[9999] bg-gradient-to-r from-rose-600 to-rose-500 dark:from-rose-800 dark:to-rose-700 text-white shadow-lg">
            <div className="max-w-md mx-auto flex items-center gap-3 px-4 py-2.5">
              <div className="h-7 w-7 rounded-full bg-surface/20 flex items-center justify-center shrink-0">
                <svg className="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728m-2.829-2.829a5 5 0 000-7.07m-4.243 4.243a1 1 0 010-1.414" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v.01M12 9v3" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-extrabold leading-tight">Sin conexión a Internet</p>
                <p className="text-[11px] text-rose-100 leading-tight mt-0.5">No recibirás pedidos nuevos hasta que te reconectes.</p>
              </div>
              <div className="h-2 w-2 rounded-full bg-surface/80 animate-pulse shrink-0" />
            </div>
          </div>
        )}
        {/* OVERLAY DE LLAMADA / SOLICITUD DE PEDIDO (ESTILO UBER) */}
      {pendingAssignedOrder && (
        <IncomingOrderModal
          order={pendingAssignedOrder}
          driverLat={driverProfile?.currentLatitude}
          driverLng={driverProfile?.currentLongitude}
          onAccept={(id) => runDriverAction(id, 'accept')}
          onReject={(id) => runDriverAction(id, 'reject')}
        />
      )}

      {/* MODAL DE ÉXITO: VIAJE INICIADO */}
      {tripStartedForOrderId && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-xs rounded-[32px] bg-surface dark:bg-zinc-950 shadow-2xl p-8 flex flex-col items-center text-center animate-in zoom-in-90 duration-300">
            {/* Checkmark animated */}
            <div className="relative mb-5">
              <div className="h-20 w-20 rounded-full bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center">
                <svg className="w-10 h-10 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <span className="absolute -top-1 -right-1 text-2xl animate-bounce"><Bike className="h-5 w-5" /></span>
            </div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-500 dark:text-emerald-400 mb-1">¡Todo listo!</p>
            <h3 className="text-xl font-black text-foreground dark:text-zinc-50 leading-snug">Recolectado con éxito</h3>
            <p className="text-sm text-muted dark:text-zinc-400 mt-2 leading-relaxed max-w-[220px]">
              Dirígete al lugar de entrega y completa el pedido.
            </p>
            <div className="mt-6 w-full h-1 rounded-full bg-surface-2 dark:bg-zinc-800 overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full animate-[shrink_4s_linear_forwards]" style={{ animation: 'shrink 4s linear forwards', width: '100%' }} />
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE DETALLES DEL PEDIDO PARA VERIFICAR EN TIENDA */}

      {selectedOrderDetail && (
        <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-md rounded-[32px] bg-surface shadow-2xl overflow-hidden dark:bg-zinc-950 p-6 flex flex-col max-h-[85vh] animate-in slide-in-from-bottom-10 duration-300">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border dark:border-zinc-900 pb-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted dark:text-zinc-500">Verificación de Pedido</p>
                <h3 className="text-lg font-black text-foreground dark:text-zinc-50 mt-0.5">#{selectedOrderDetail.orderReference.substring(0, 8)}</h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(10);
                  setSelectedOrderDetail(null);
                }}
                className="h-8 w-8 rounded-full bg-surface-2 dark:bg-zinc-900 flex items-center justify-center text-sm font-black text-muted hover:bg-surface-2 transition text-foreground dark:text-zinc-50"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Content (Scrollable list of items) */}
            <div className="flex-grow overflow-y-auto py-4 space-y-4 pr-1">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted dark:text-zinc-500 mb-1">{selectedOrderDetail.restaurant.businessType && selectedOrderDetail.restaurant.businessType !== 'RESTAURANT' ? 'Tienda' : 'Restaurante'}</p>
                <p className="text-sm font-black text-foreground dark:text-zinc-200">{selectedOrderDetail.restaurant.name}</p>
              </div>

              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted dark:text-zinc-500 mb-2">Artículos a entregar</p>
                {selectedOrderDetail.items && selectedOrderDetail.items.length > 0 ? (
                  <div className="divide-y divide-neutral-100 dark:divide-zinc-900/60 border border-border dark:border-zinc-900/80 rounded-2xl overflow-hidden bg-surface-2/50 dark:bg-zinc-900/20">
                    {selectedOrderDetail.items.map((item) => (
                      <div key={item.id} className="p-4 space-y-1">
                        <div className="flex items-start gap-3">
                          {item.product.image && (
                            <div className="shrink-0 w-12 h-12 rounded-xl overflow-hidden bg-surface-2 dark:bg-zinc-800 border border-black/5">
                              <img
                                src={item.product.image}
                                alt={item.product.name}
                                className="w-full h-full object-cover"
                                loading="lazy"
                                decoding="async"
                              />
                            </div>
                          )}
                          <p className="text-sm font-black text-foreground dark:text-zinc-200 leading-snug pt-0.5">
                            <span className="inline-block px-1.5 py-0.5 rounded bg-surface-2 dark:bg-zinc-850 text-xs font-bold text-foreground dark:text-zinc-300 mr-2">
                              {item.quantity}x
                            </span>
                            {item.product.name}
                          </p>
                          {item.sellBy === 'WEIGHT' && item.weightG ? (
                            <p className="text-[11px] font-semibold text-amber-600 mt-1 pl-9">
                              {item.weightG >= 1000 ? `${item.weightG / 1000}kg` : `${item.weightG}g`}
                            </p>
                          ) : null}
                        </div>

                        {/* Options */}
                        {item.options && item.options.length > 0 && (
                          <div className="pl-9 flex flex-wrap gap-1.5">
                            {item.options.map((opt) => (
                              <span key={opt.id} className="inline-block text-[10.5px] text-muted dark:text-zinc-400 font-medium">
                                + {opt.name}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Special Instructions */}
                        {item.specialInstructions && (
                          <div className="pl-9 mt-1">
                            <p className="text-xs italic text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 px-2.5 py-1 rounded-lg inline-block">
                              Nota: {item.specialInstructions}
                            </p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted dark:text-zinc-500 italic p-3 text-center border border-dashed border-border dark:border-zinc-800 rounded-2xl">
                    No hay detalles de artículos disponibles para este pedido.
                  </p>
                )}
              </div>


            </div>

            {/* Footer */}
            <div className="pt-4 border-t border-border dark:border-zinc-900 flex items-center justify-between gap-3">
              <div className="text-left">
                {selectedOrderDetail.paymentMethod === 'TRANSFER' ? (
                  <>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-sky-600 dark:text-sky-400 leading-none">Pagado por transferencia</p>
                    {selectedOrderDetail.deliveryFee ? (
                      <div className="mt-1 rounded-lg border border-dashed border-rose-200 bg-rose-50/60 dark:border-rose-900/30 dark:bg-rose-950/20 px-2.5 py-1.5">
                        <p className="text-[10px] font-semibold text-rose-600 dark:text-rose-400">Cobrar al restaurante</p>
                        <p className="text-base font-black text-rose-700 dark:text-rose-300">{formatCurrency(selectedOrderDetail.deliveryFee)}</p>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-muted dark:text-zinc-500 leading-none">A pagar en {selectedOrderDetail.restaurant.businessType && selectedOrderDetail.restaurant.businessType !== 'RESTAURANT' ? 'Tienda' : 'Restaurante'}</p>
                    <p className="text-xl font-black text-foreground dark:text-white mt-1 leading-none">
                      {selectedOrderDetail.totalAmount 
                        ? formatCurrency(selectedOrderDetail.totalAmount - (selectedOrderDetail.deliveryFee || 0)) 
                        : formatCurrency(0)}
                    </p>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(10);
                  setSelectedOrderDetail(null);
                }}
                className="px-6 py-3 rounded-2xl bg-neutral-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-black tracking-wide transition active:scale-[0.97]"
              >
                Cerrar detalles
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Indicador visual de pull-to-refresh */}
      <div
        className={`fixed top-0 left-0 right-0 z-50 flex justify-center pt-3 pointer-events-none transition-opacity duration-200 ${pullDistance > 0 || isRefreshing ? 'opacity-100' : 'opacity-0'}`}
        style={{ transform: `translateY(${Math.max(0, pullDistance - 40)}px)` }}
      >
        <div className="rounded-full bg-surface dark:bg-zinc-950 p-2 shadow-lg border border-black/5 dark:border-zinc-900 flex items-center justify-center">
          <RefreshCw strokeWidth={2.5} />
        </div>
      </div>

      {/* Toast notifications */}
      {toasts.length > 0 && (
        <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2 max-w-sm">
          {toasts.map((toast) => {
            const ToneIcon =
              toast.tone === 'error'
                ? AlertTriangle
                : toast.tone === 'success'
                  ? CheckCircle2
                  : Info;
            return (
            <div
              key={toast.id}
              onClick={() => dismissToast(toast.id)}
              className={`relative rounded-2xl border px-4 py-3 pr-10 text-sm shadow-lg backdrop-blur-md cursor-pointer transition hover:scale-[1.02] active:scale-[0.98] ${
                toast.tone === 'error'
                  ? 'border-red-200 bg-red-50/95 text-red-800 dark:border-red-900/30 dark:bg-red-950/40 dark:text-red-300'
                  : toast.tone === 'success'
                    ? 'border-emerald-200 bg-emerald-50/95 text-emerald-800 dark:border-emerald-900/30 dark:bg-emerald-950/40 dark:text-emerald-300'
                    : 'border-sky-200 bg-sky-50/95 text-sky-800 dark:border-sky-900/30 dark:bg-sky-950/40 dark:text-sky-300'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <ToneIcon className="h-5 w-5 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="font-bold">{toast.title}</p>
                  {toast.message && <p className="mt-0.5 opacity-80">{toast.message}</p>}
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); dismissToast(toast.id); }}
                className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full text-current opacity-50 hover:opacity-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            );
          })}
        </div>
      )}

      {/* MENÚ HAMBURGUESA LATERAL (SIDEBAR DRAWER) */}
      {isMenuOpen && (
        <div className="fixed inset-0 z-[100] flex">
          {/* Backdrop overlay */}
          <div
            className="fixed inset-0 bg-black/45 backdrop-blur-sm transition-opacity duration-300"
            onClick={() => setIsMenuOpen(false)}
          />

          {/* Drawer Content */}
          <div className="relative flex w-4/5 max-w-sm flex-col bg-surface p-6 shadow-2xl dark:bg-zinc-950 dark:border-r dark:border-zinc-900 h-full animate-slideInLeft select-none text-foreground dark:text-zinc-200">
            {/* Header / Profile info (clickable to account settings) */}
            <button
              type="button"
              onClick={() => {
                triggerHaptic(20);
                setActiveTab('profile');
                setIsMenuOpen(false);
              }}
              className="flex items-center text-left w-full gap-3 pb-6 border-b border-black/5 dark:border-zinc-900/80 hover:bg-surface-20/10 p-2 -mx-2 rounded-2xl transition active:scale-[0.98]"
            >
              <div className="h-12 w-12 rounded-full bg-accent flex items-center justify-center text-white text-xl font-bold shadow-md shadow-accent/30 overflow-hidden shrink-0">
                {driverProfile?.user.profilePhoto ? (
                  <img src={driverProfile.user.profilePhoto} alt="Profile" className="h-full w-full object-cover" />
                ) : (
                  ''
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-black text-sm text-foreground dark:text-white leading-tight truncate">
                  {driverProfile?.user.name || 'Cargando repartidor...'}
                </h3>
                {driverProfile && (
                  <div className="flex items-center gap-1.5 mt-1 text-[10px] font-bold text-muted dark:text-zinc-400">
                    <span><Star className="h-5 w-5" /> {driverProfile.rating.toFixed(1)}</span>
                    <span>•</span>
                    <span><Briefcase className="h-5 w-5" /> {driverProfile.totalDeliveries} viajes</span>
                  </div>
                )}
              </div>
              <span className="text-muted dark:text-zinc-500 text-xs font-bold"><ArrowRight className="h-5 w-5" /></span>
            </button>

            {/* Menu Options */}
            <div className="flex-1 py-6 space-y-2">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(20);
                  setActiveTab('active');
                  setIsMenuOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-xs font-black uppercase tracking-wider transition ${activeTab === 'active'
                    ? 'bg-gradient-to-r from-sky-400 to-sky-600 text-white shadow-md shadow-sky-500/40'
                    : 'hover:bg-black/5 dark:hover:bg-zinc-900 text-muted dark:text-zinc-400'
                  }`}
              >
                <span><Bike className="h-5 w-5" /></span> Inicio
              </button>



              <button
                type="button"
                onClick={() => {
                  triggerHaptic(20);
                  setActiveTab('history');
                  setIsMenuOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-xs font-black uppercase tracking-wider transition ${activeTab === 'history'
                    ? 'bg-gradient-to-r from-sky-400 to-sky-600 text-white shadow-md shadow-sky-500/40'
                    : 'hover:bg-black/5 dark:hover:bg-zinc-900 text-muted dark:text-zinc-400'
                  }`}
              >
                <span><Calendar className="h-5 w-5" /></span> Historial
              </button>

              <hr className="border-black/5 dark:border-zinc-900/80 my-4" />

              {/* Modo Oscuro Toggle */}
              <div className="flex items-center justify-between px-4 py-2 text-xs font-bold text-muted dark:text-zinc-400">
                <span className="flex items-center gap-3">
                  <span><Moon className="h-5 w-5" /></span> Modo Oscuro
                </span>
                <button
                  type="button"
                  onClick={toggleDarkMode}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${darkMode ? 'bg-accent' : 'bg-neutral-300 dark:bg-zinc-800'
                    }`}
                >
                  <span
                    className={`inline-block h-3 w-3 transform rounded-full bg-surface shadow transition ${darkMode ? 'translate-x-5' : 'translate-x-1'
                      }`}
                  />
                </button>
              </div>

              {/* Developer settings */}
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(20);
                  setShowDeveloperSettings(true);
                  setIsMenuOpen(false);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-xs font-bold text-muted dark:text-zinc-400 hover:bg-black/5 dark:hover:bg-zinc-900 transition"
              >
                <span><Settings className="h-5 w-5" /></span> Configuración de Red
              </button>
            </div>

            {/* Logout button at bottom */}
            <div className="pt-4 border-t border-black/5 dark:border-zinc-900/80">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic([40, 20]);
                  setIsMenuOpen(false);
                  clearSession('Cierre de sesión seguro.');
                }}
                className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/20 text-rose-600 hover:bg-rose-100 dark:hover:bg-rose-950/40 text-xs font-black uppercase tracking-wider transition"
              >
                Cerrar Sesión <ArrowRight className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CABECERA PRINCIPAL (STICKY + BLUR) */}
      <header className="sticky top-0 z-40 border-b border-black/5 bg-surface dark:bg-neutral-950 dark:border-zinc-900/80 px-6 py-6 transition">
        <div className="max-w-5xl mx-auto flex items-center justify-between w-full">
          {/* Superior Izquierda: Menu Hamburguesa */}
          <button
            type="button"
            onClick={() => {
              triggerHaptic(20);
              setIsMenuOpen(true);
            }}
            className="h-14 w-14 rounded-[20px] border border-black/5 dark:border-zinc-900 bg-surface dark:bg-zinc-950 flex items-center justify-center shadow-md text-2xl text-foreground dark:text-zinc-200 transition hover:scale-105 active:scale-95"
            aria-label="Menú principal"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Superior Central: Ovalo con Ganancias Semanales */}
          <div
            onClick={() => setShowWeeklyEarnings(!showWeeklyEarnings)}
            className="px-6 py-3.5 rounded-full border border-sky-400/20 bg-sky-500/10 dark:bg-sky-950/25 text-sky-600 dark:text-sky-400 flex items-center gap-2.5 text-base font-black shadow-inner cursor-pointer"
          >
            <span>{showWeeklyEarnings ? `Semana: ${formatCurrency(weeklyEarnings)}` : `Hoy: ${formatCurrency(todayEarnings)}`}</span>
          </div>

          {/* Superior Derecha: Balanceador Visual */}
          <div className="w-14" />
        </div>
      </header>

      {/* CUERPO OPERATIVO DEL PANEL */}
      <section className={`max-w-md mx-auto w-full flex-grow flex flex-col ${
        activeTab === 'active' && activeCount > 0 ? 'px-0 mt-0 gap-0' : 'px-4 mt-4 space-y-4'
      }`}>

        {/* ==========================================
            PESTAÑA 1: PEDIDOS ACTIVOS EN RUTA
            ========================================== */}
        {activeTab === 'active' && (
          <div className={activeCount > 0 ? "flex-1 w-full flex flex-col gap-0" : "space-y-4"}>

            {/* Si falló la última acción atómica */}
            {lastFailedAction && (
              <div className={activeCount > 0 ? "px-4 pt-4" : ""}>
                <div className="rounded-3xl border border-rose-100 bg-rose-50/80 p-4 dark:border-rose-950/20 dark:bg-rose-950/20 animate-fadeIn">
                  <p className="text-xs font-bold text-rose-800 dark:text-rose-300">Última acción fallida: {lastFailedAction.label}</p>
                  <p className="text-[10px] text-rose-700 dark:text-rose-400 mt-0.5">El estado del servidor no se actualizó. Puedes reintentar directamente.</p>
                  <button
                    type="button"
                    onClick={() => void retryLastFailedAction()}
                    disabled={Boolean(activeActionKey) || Boolean(updatingAvailability)}
                    className="mt-3 w-full rounded-xl bg-neutral-950 py-2.5 text-xs font-black uppercase tracking-wider text-white shadow dark:bg-rose-900"
                  >
                    Reintentar Acción <ArrowRight className="h-5 w-5" />
                  </button>
                </div>
              </div>
            )}

            {activeCount === 0 ? (
              <div className="flex flex-col items-center justify-center min-h-[68vh] gap-0 select-none pb-24">
                {/* SaDeL Logo */}
                <div className="relative flex items-center justify-center mb-6">
                  {driverProfile?.availability === 'AVAILABLE' && (
                    <>
                      <div className="absolute h-40 w-40 rounded-full border-2 border-sky-400/20 animate-ping" style={{ animationDuration: '2.5s' }} />
                      <div className="absolute h-52 w-52 rounded-full border border-sky-400/10 animate-ping" style={{ animationDuration: '3.5s', animationDelay: '0.5s' }} />
                    </>
                  )}
                  <div className={`relative h-28 w-28 rounded-full flex items-center justify-center shadow-2xl transition-all duration-500 ${driverProfile?.availability === 'AVAILABLE'
                      ? 'bg-gradient-to-br from-sky-400 to-sky-600 shadow-sky-500/40'
                      : 'bg-gradient-to-br from-neutral-300 to-neutral-400 dark:from-zinc-700 dark:to-zinc-800 shadow-black/20'
                    }`}>
                    <span className={`text-5xl ${driverProfile?.availability === 'AVAILABLE' ? 'animate-moto-ride' : ''}`}>🛵</span>
                  </div>
                </div>

                {/* Brand name */}
                <div className="mb-2">
                  <SaDelLogo className="h-11 w-auto" />
                </div>
                <p className="text-xs font-bold uppercase tracking-widest text-muted dark:text-zinc-500 mb-8">Servicio de Entrega Local</p>

                {/* Status indicator */}
                {driverProfile?.availability === 'AVAILABLE' ? (
                  <div className="flex flex-col items-center gap-4">
                    <div className="flex items-center gap-2 px-5 py-2 rounded-full bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50">
                      <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-xs font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-400">En línea</span>
                    </div>
                    {/* Searching animation */}
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-accent-hover animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="h-1.5 w-1.5 rounded-full bg-sky-300 animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                      <span className="text-xs font-bold text-muted dark:text-zinc-400">Buscando pedidos...</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-5 py-2 rounded-full bg-surface-2 dark:bg-zinc-900 border border-border dark:border-zinc-800">
                    <span className="flex h-2 w-2 rounded-full bg-neutral-400 dark:bg-zinc-500" />
                    <span className="text-xs font-black uppercase tracking-widest text-muted dark:text-zinc-400">Desconectado</span>
                  </div>
                )}

                {driverProfile?.availability !== 'AVAILABLE' && (
                  <p className="text-[11px] text-muted dark:text-zinc-500 mt-4 text-center max-w-[200px] leading-relaxed">
                    Presiona el botón de abajo para comenzar a recibir pedidos
                  </p>
                )}
              </div>
            ) : (
              pendingOrders.map((order, index) => {
                if (!order.restaurant) return null;
                const isQueued = index > 0;
                const activeOrder = pendingOrders[0];
                const isSameRestaurantBatch = activeOrder && order.restaurant.id === activeOrder.restaurant?.id;
                const isQueueBlocked = isQueued && isSameRestaurantBatch && !(order.status === 'READY' || order.status === 'PICKED_UP' || order.status === 'IN_TRANSIT');
                const isCash = order.paymentMethod === 'CASH' || order.paymentMethod === 'CASH_ON_DELIVERY' || !order.paymentMethod;
                const isTransfer = order.paymentMethod === 'TRANSFER';
                const isStore = order.restaurant.businessType && order.restaurant.businessType !== 'RESTAURANT';

                // Prep time countdown
                const prepDeadlineMs = order.preparationDeadlineAt ? new Date(order.preparationDeadlineAt).getTime() : null;
                const remainingPrepMin = prepDeadlineMs ? Math.max(0, Math.round((prepDeadlineMs - Date.now()) / 60000)) : null;

                // Maps URLs
                const restaurantQuery = order.restaurant?.latitude && order.restaurant.longitude
                  ? `${order.restaurant.latitude},${order.restaurant.longitude}`
                  : order.restaurant?.address ? encodeURIComponent(order.restaurant.address) : null;
                const customerAddressStr = formatAddress(order.address);
                const customerQuery = order.latitude && order.longitude
                  ? `${order.latitude},${order.longitude}`
                  : order.address ? encodeURIComponent(customerAddressStr) : null;

                // UI sub-state flags
                const driverIsAtRestaurant = arrivedAtRestaurantFor.includes(order.id);
                const driverIsAtCustomer = arrivedAtCustomerFor.includes(order.id);
                const isPickupPhase = order.status === 'CONFIRMED' || order.status === 'PREPARING' || order.status === 'READY' || order.status === 'PICKED_UP';
                const isDeliveryPhase = order.status === 'IN_TRANSIT';

                // Amount to pay restaurant (for cash: total - delivery fee = food cost)
                const amountToPayRestaurant = order.totalAmount && order.deliveryFee
                  ? order.totalAmount - order.deliveryFee
                  : order.totalAmount || 0;

                const batchGroup = order.batchId ? (batchGroups.get(order.batchId) || []) : [];
                const isBatchPickup = !isQueued && batchGroup.length >= 2 && order.batchId && order.deliverySequence === 0;
                const batchReadyCount = batchGroup.filter(o => o.status === 'READY' || o.status === 'PICKED_UP').length;
                const batchTotalAmount = isBatchPickup
                  ? batchGroup.filter(o => o.status === 'READY' || o.status === 'PICKED_UP').reduce((sum, o) => {
                      const amt = o.totalAmount && o.deliveryFee ? o.totalAmount - o.deliveryFee : o.totalAmount || 0;
                      return sum + amt;
                    }, 0)
                  : amountToPayRestaurant;

                // Step 0: Pending acceptance (CONFIRMED/PREPARING + AVAILABLE)
                if ((order.status === 'CONFIRMED' || order.status === 'PREPARING') && !order.isAcceptedByDriver) {
                  return null; // Handled by the separate pendingAssignedOrder overlay
                }

                return (
                  <div key={order.id} className={isQueued ? "px-4 py-2 space-y-3" : "w-full flex-grow flex flex-col"}>

                    {/* Navegación turn-by-turn in-app (overlay full-screen) */}
                    {turnByTurnFor[order.id] === 'pickup' && order.restaurant.latitude && order.restaurant.longitude && (
                      <DriverTurnByTurnOverlay
                        origin={null}
                        destination={{
                          lat: order.restaurant.latitude,
                          lng: order.restaurant.longitude,
                          label: order.restaurant.name,
                          emoji: '',
                        }}
                        dark={darkMode}
                        onExit={() => setTurnByTurnFor((prev) => ({ ...prev, [order.id]: null }))}
                      />
                    )}
                    {turnByTurnFor[order.id] === 'delivery' && order.latitude && order.longitude && (
                      <DriverTurnByTurnOverlay
                        origin={null}
                        destination={{
                          lat: order.latitude,
                          lng: order.longitude,
                          label: customerAddressStr,
                          emoji: '',
                        }}
                        dark={darkMode}
                        onExit={() => setTurnByTurnFor((prev) => ({ ...prev, [order.id]: null }))}
                      />
                    )}

                    {/* QUEUE BADGE for non-active orders */}
                    {isQueued && (
                      <div className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-bold ${
                        isSameRestaurantBatch && (order.status === 'READY' || order.status === 'PICKED_UP' || order.status === 'IN_TRANSIT')
                          ? 'bg-neutral-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                          : isSameRestaurantBatch
                          ? 'bg-surface-2 text-muted dark:bg-zinc-900 dark:text-zinc-400 border border-border dark:border-zinc-800'
                          : 'bg-sky-900/10 text-sky-700 dark:text-sky-400 border border-sky-200 dark:border-sky-900/30'
                      }`}>
                        {isSameRestaurantBatch && order.status === 'READY'
                          ? <><span className="h-2 w-2 rounded-full bg-surface dark:bg-zinc-900 animate-pulse inline-block" /> {isStore ? 'Misma tienda — recoger junto con el pedido activo' : 'Mismo restaurante — recoger junto con el pedido activo'}</>
                          : isSameRestaurantBatch && isDeliveryPhase
                          ? <><span className="h-2 w-2 rounded-full bg-surface dark:bg-zinc-900 animate-pulse inline-block" /> Multi-ruta activa — {order.restaurant.name}</>
                          : isSameRestaurantBatch
                          ? <><span className="inline-block"><Hourglass className="h-5 w-5" /></span> Mismo restaurante — esperando a que esté listo</>
                          : <><span className="text-base"><MapPin className="h-5 w-5" /></span> Siguiente parada — {order.restaurant.name}</>
                        }
                      </div>
                    )}

                    {/* ═══════════════════════════════════════════════════
                        PEDIDO PRINCIPAL: FLUJO DE PANTALLA COMPLETA
                        ═══════════════════════════════════════════════════ */}
                    <div
                      className={
                        isQueued
                          ? `rounded-3xl bg-surface dark:bg-zinc-950 border border-neutral-150 dark:border-zinc-800 overflow-hidden shadow-sm ${isQueueBlocked ? 'opacity-60' : ''}`
                          : `w-full bg-surface dark:bg-zinc-950 border-0 flex-grow flex flex-col min-h-[calc(100dvh-100px)] pb-[112px]`
                      }
                    >
                      {/* ─── FOLIO + STATUS ─── */}
                       <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3 border-b border-border dark:border-zinc-800/80">
                          <div className="min-w-0 flex-1">
                            <p className="text-3xl font-black text-foreground dark:text-zinc-50 leading-none tracking-tight">
                              Pedido #{order.dailyCounter || 'S/N'}
                            </p>
                            {order.customer.user?.name && (
                              <div className="flex items-center gap-2 mt-2">
                                <div className="flex items-center justify-center w-6 h-6 rounded-full bg-sky-100 dark:bg-sky-500/20 text-sky-600 dark:text-sky-400 shrink-0">
                                  <User className="w-3.5 h-3.5" strokeWidth={2.5} />
                                </div>
                                <p className="text-base font-bold text-foreground dark:text-zinc-300 truncate">
                                  {order.customer.user.name}
                                </p>
                              </div>
                            )}
                            <p className="text-[11px] font-bold text-muted dark:text-zinc-500 mt-1.5 font-mono tracking-wide">
                              #{order.orderReference}
                            </p>
                          </div>
                          <StatusBadge status={order.status} />
                        </div>

                       {/* ═══════════════════════════════════════
                           PASO 1: IR AL RESTAURANTE
                           (CONFIRMED / PREPARING / READY)
                           ═══════════════════════════════════════ */}
                        {isPickupPhase && !driverIsAtRestaurant && (
                          <div className={isQueued ? "p-5 space-y-4" : "flex-grow flex flex-col justify-between p-5 space-y-5"}>
                            <div className="space-y-4">
                              {/* Instruction banner */}
                              <div className="text-center pb-1">
                                <p className="text-3xl font-black text-foreground dark:text-zinc-50 leading-tight">
                                  {order.status === 'READY' ? 'Recoge el pedido' : isStore ? 'Dirígete a la tienda' : 'Dirígete al restaurante'}
                                </p>
                              </div>

                              {/* Restaurant header card */}
                              <div className="rounded-2xl bg-neutral-900 dark:bg-zinc-100 p-5 text-white dark:text-zinc-900 shadow-lg">
                                <div className="flex items-start gap-4">
                                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-surface/20 dark:bg-zinc-900/20 text-2xl">
                                    <Store className="h-5 w-5" />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-white/70 dark:text-zinc-900/70">Recoger en</p>
                                    <p className="text-xl font-black leading-tight mt-0.5">{order.restaurant.name}</p>
                                    {order.restaurant.address && (
                                      <p className="text-xs text-white/70 dark:text-zinc-900/70 mt-1 leading-snug line-clamp-2">{order.restaurant.address}</p>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Quick actions row */}
                              <div className="grid grid-cols-2 gap-2">
                                {restaurantQuery && (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); triggerHaptic(20); setTurnByTurnFor((prev) => ({ ...prev, [order.id]: 'pickup' })); }}
                                    className="flex items-center justify-center gap-2 py-3.5 rounded-2xl border border-border dark:border-zinc-800 bg-surface dark:bg-zinc-900 text-xs font-bold text-foreground dark:text-zinc-300 shadow-sm transition active:scale-[0.97]"
                                  >
                                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>
                                    Navegar
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    triggerHaptic(10);
                                    setSelectedOrderDetail(order);
                                  }}
                                  className="flex items-center justify-center gap-2 py-3.5 rounded-2xl border border-border dark:border-zinc-800 bg-surface dark:bg-zinc-900 text-xs font-bold text-foreground dark:text-zinc-300 shadow-sm transition active:scale-[0.97]"
                                >
                                  <span><ClipboardList className="h-5 w-5" /></span> Pedido
                                </button>
                              </div>

                              {/* Mapa embebido de navegación (opcional) — recogida */}
                              {isPickupPhase && restaurantQuery && (
                                <div className="space-y-2">
                                  {navigationMapOpenFor[order.id] === 'pickup' ? (
                                    <>
                                      <DriverNavigationMap
                                        origin={null}
                                        destination={
                                          order.restaurant.latitude && order.restaurant.longitude
                                            ? {
                                                id: `pickup:${order.id}`,
                                                lat: order.restaurant.latitude,
                                                lng: order.restaurant.longitude,
                                                label: order.restaurant.name,
                                                emoji: '',
                                              }
                                            : null
                                        }
                                      />
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          triggerHaptic(20);
                                          setNavigationMapOpenFor((prev) => ({ ...prev, [order.id]: null }));
                                        }}
                                        className="w-full py-2 rounded-lg border border-border dark:border-zinc-800 bg-surface dark:bg-zinc-900 text-[11px] font-bold text-muted dark:text-zinc-400 flex items-center justify-center gap-1.5 transition active:scale-[0.98]"
                                      >
                                        <BellOff className="h-5 w-5" /> Cerrar mapa
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        triggerHaptic(10);
                                        setNavigationMapOpenFor((prev) => ({ ...prev, [order.id]: 'pickup' }));
                                      }}
                                      className="w-full py-2.5 rounded-2xl border border-dashed border-border dark:border-zinc-700 bg-surface-2/50 dark:bg-zinc-900/40 flex items-center justify-center gap-2 text-xs font-bold text-foreground dark:text-zinc-300 transition active:scale-[0.98]"
                                    >
                                      <span className="text-sm"><MapIcon className="h-5 w-5" /></span> Ver mapa de navegación
                                    </button>
                                  )}
                                </div>
                              )}

                              {/* Prep countdown card */}
                              {(() => {
                                if (order.status === 'READY') {
                                  return (
                                    <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/30 px-5 py-4 flex items-center gap-3">
                                      <span className="text-2xl"><CheckCircle2 className="h-5 w-5" /></span>
                                      <div>
                                        <p className="text-xs font-black text-emerald-700 dark:text-emerald-400">Pedido listo para recoger</p>
                                        <p className="text-[11px] text-emerald-600 dark:text-emerald-500 mt-0.5">{isStore ? 'La tienda ya surtió todo' : 'El restaurante ya preparó todo'}</p>
                                      </div>
                                    </div>
                                  );
                                }
                                if (isStore && prepDeadlineMs !== null) {
                                  return (
                                    <div className="rounded-2xl border border-amber-200 dark:border-amber-900/30 bg-amber-50 dark:bg-amber-950/20 px-5 py-4">
                                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted dark:text-zinc-500">Surtiendo tu pedido</p>
                                      <p className="text-sm font-black text-foreground dark:text-zinc-200 mt-0.5">
                                        {remainingPrepMin === 0 ? 'Listo en cualquier momento' : `Aprox. ${remainingPrepMin} min`}
                                      </p>
                                    </div>
                                  );
                                }
                                if (isStore && order.estimatedDeliveryTime) {
                                  const diffMs = new Date(order.estimatedDeliveryTime).getTime() - Date.now();
                                  const overdue = diffMs < 0;
                                  const mins = Math.max(1, Math.round(Math.abs(diffMs) / 60000));
                                  return (
                                    <div className="rounded-2xl border border-amber-200 dark:border-amber-900/30 bg-amber-50 dark:bg-amber-950/20 px-5 py-4">
                                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted dark:text-zinc-500">Recogiendo tu pedido</p>
                                      <p className="text-sm font-black text-foreground dark:text-zinc-200 mt-0.5">
                                        {overdue ? `Debería estar listo (hace ${mins} min)` : `Aprox. ${mins} min`}
                                      </p>
                                    </div>
                                  );
                                }
                                if (prepDeadlineMs !== null) {
                                  return (
                                    <div className="rounded-2xl border border-amber-200 dark:border-amber-900/30 bg-amber-50 dark:bg-amber-950/20 px-5 py-4">
                                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted dark:text-zinc-500">Preparando tu pedido</p>
                                      <p className="text-sm font-black text-foreground dark:text-zinc-200 mt-0.5">
                                        {remainingPrepMin === 0 ? 'Listo en cualquier momento' : `Aprox. ${remainingPrepMin} min`}
                                      </p>
                                    </div>
                                  );
                                }
                                if (order.estimatedDeliveryTime && order.restaurant.maxDeliveryTime) {
                                  const readyMs = new Date(order.estimatedDeliveryTime).getTime() - (order.restaurant.maxDeliveryTime * 60000);
                                  const diffMs = readyMs - Date.now();
                                  const overdue = diffMs < 0;
                                  const mins = Math.max(1, Math.round(Math.abs(diffMs) / 60000));
                                  return (
                                    <div className="rounded-2xl border border-amber-200 dark:border-amber-900/30 bg-amber-50 dark:bg-amber-950/20 px-5 py-4">
                                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted dark:text-zinc-500">Preparando tu pedido</p>
                                      <p className="text-sm font-black text-foreground dark:text-zinc-200 mt-0.5">
                                        {overdue ? `Debería estar listo (hace ${mins} min)` : `Aprox. ${mins} min`}
                                      </p>
                                    </div>
                                  );
                                }
                                return null;
                              })()}
                            </div>

                            {!isQueued && (
                            <div className="space-y-3">
                              {/* Primary CTA: Arrived at restaurant */}
                              <button
                                type="button"
                                id={`btn-${order.id}-arrivedRestaurant`}
                                onClick={() => {
                                  triggerHaptic([40, 20, 40]);
                                  setArrivedAtRestaurantFor(prev => prev.includes(order.id) ? prev : [...prev, order.id]);
                                  void runDriverAction(order.id, 'arrivedRestaurant');
                                }}
                                className="w-full py-4 rounded-2xl bg-neutral-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-lg font-black tracking-wide transition active:scale-[0.97] shadow-lg shadow-neutral-900/20 dark:shadow-zinc-100/10"
                              >
                                {activeActionKey === `${order.id}:arrivedRestaurant`
                                  ? <span className="flex items-center justify-center gap-2"><span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />Llegando...</span>
                                  : isStore ? 'Llegué a la tienda' : 'Llegué al restaurante'
                                }
                              </button>

                              {/* Reject action (only available before acceptance lock) */}
                              {getDriverActions(order.status, driverProfile?.availability).includes('reject') && (
                                <button
                                  type="button"
                                  onClick={() => void runDriverAction(order.id, 'reject')}
                                  disabled={activeActionKey !== null}
                                  className="w-full py-2.5 rounded-2xl text-sm font-bold text-muted dark:text-zinc-500 transition active:scale-[0.97] disabled:opacity-50 hover:text-rose-500"
                                >
                                  {activeActionKey === `${order.id}:reject` ? 'Rechazando...' : 'Rechazar pedido'}
                                </button>
                              )}
                            </div>
                            )}
                          </div>
                        )}

                      {/* ═══════════════════════════════════════
                          PASO 1b: EN EL RESTAURANTE
                          (show payment info + verify pickup)
                          ═══════════════════════════════════════ */}
                      {isPickupPhase && driverIsAtRestaurant && (
                        <div className={isQueued ? "p-5 space-y-4" : "flex-grow flex flex-col justify-between p-5 space-y-6"}>
                          {/* Restaurant header card — app style */}
                          <div className="rounded-[20px] bg-neutral-900 dark:bg-zinc-800 p-5 text-white shadow-lg">
                            <div className="flex items-start gap-3.5">
                              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-surface/15 text-2xl">
                                <Store className="h-5 w-5" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">Recoger en</p>
                                <p className="text-xl font-black leading-tight mt-0.5">{order.restaurant.name}</p>
                                <p className="text-xs text-white/60 mt-1 leading-snug line-clamp-2">{order.restaurant.address || ''}</p>
                              </div>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              triggerHaptic(10);
                              setSelectedOrderDetail(order);
                            }}
                            className="w-full py-3 rounded-2xl border border-border dark:border-zinc-800 bg-surface dark:bg-zinc-900 text-xs font-bold text-muted dark:text-zinc-400 shadow-sm hover:bg-surface-2 dark:hover:bg-zinc-800/80 transition active:scale-[0.97]"
                          >
                            <span><ClipboardList className="h-5 w-5" /></span> Ver detalles del pedido
                          </button>

                          {/* Instruction */}
                          <div className="pb-1">
                            <p className="text-lg font-black text-foreground dark:text-zinc-50 leading-tight">
                              {isCash ? 'Paga y recoge el pedido' : 'Muestra el PIN y recoge el pedido'}
                            </p>
                          </div>

                          {/* CASH: amount card */}
                          {isCash && order.totalAmount && (
                            <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/30 p-5">
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">{isStore ? 'Pagar en tienda' : 'Pagar al restaurante'}</p>
                                  <p className="text-3xl font-black text-foreground dark:text-zinc-50 mt-0.5">{formatCurrency(batchTotalAmount)}</p>
                                </div>
                                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-200/60 dark:bg-emerald-800/40 text-emerald-600 dark:text-emerald-400 text-xl">
                                  <Banknote className="h-5 w-5" />
                                </div>
                              </div>
                            </div>
                          )}

                          {/* BATCH: list of orders included in the batch pickup */}
                          {isBatchPickup && (
                            <div className="rounded-2xl border border-border dark:border-zinc-800 bg-surface dark:bg-zinc-900/50 p-4 space-y-2">
                              <p className="text-[10px] font-bold uppercase tracking-widest text-muted dark:text-zinc-500 mb-2"><Package className="h-5 w-5" /> Pedidos incluidos en este lote</p>
                              {batchGroup.filter(o => o.status === 'READY' || o.status === 'PICKED_UP').map((batchOrder) => {
                                const batchOrderAmount = batchOrder.totalAmount && batchOrder.deliveryFee
                                  ? batchOrder.totalAmount - batchOrder.deliveryFee
                                  : batchOrder.totalAmount || 0;
                                return (
                                  <div key={batchOrder.id} className="flex items-center justify-between gap-2 rounded-xl bg-surface-2 dark:bg-zinc-800/50 px-3 py-2.5">
                                    <div className="min-w-0 flex-1">
                                      <p className="text-sm font-bold text-foreground dark:text-zinc-50 truncate">
                                        #{batchOrder.dailyCounter || 'S/N'} · {batchOrder.customer?.user?.name || 'Cliente'}
                                      </p>
                                      <p className="text-[10px] font-mono text-muted dark:text-zinc-500 truncate mt-0.5">
                                        {batchOrder.orderReference}
                                      </p>
                                    </div>
                                    <p className="text-sm font-black text-emerald-600 dark:text-emerald-400 shrink-0">
                                      {formatCurrency(batchOrderAmount)}
                                    </p>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* TRANSFER: PIN card */}
                          {isTransfer && order.handoverPin && (
                            <div className="rounded-2xl bg-surface-2 dark:bg-zinc-900/50 border border-border dark:border-zinc-800 p-5 text-center">
                              <p className="text-[10px] font-bold uppercase tracking-widest text-muted dark:text-zinc-500 mb-3">{isStore ? 'Muestra este PIN en la tienda' : 'Muestra este PIN al restaurante'}</p>
                              <p className="text-5xl font-black tracking-[0.5em] text-foreground dark:text-zinc-50 font-mono py-2">{order.handoverPin}</p>
                              <p className="text-xs text-muted dark:text-zinc-500 mt-2">{isStore ? 'En tienda verificarán que eres el repartidor autorizado' : 'El restaurante verificará que eres el repartidor autorizado'}</p>
                            </div>
                          )}

                          {/* Card de estado: tiempo estimado o confirmación de pago */}
                          {order.status === 'READY' || order.status === 'PICKED_UP' ? (
                            /* Pedido listo: mostrar confirmación de pago si es efectivo */
                            isCash && !order.cashPaymentConfirmedAt && (
                              <div className="rounded-2xl border border-amber-200 dark:border-amber-900/30 bg-amber-50 dark:bg-amber-950/20 px-5 py-4">
                                <div className="flex items-center gap-3">
                                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-200/60 dark:bg-amber-800/30 text-amber-600 dark:text-amber-400">
                                    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                  </div>
                                  <div>
                                    <p className="text-sm font-black text-amber-800 dark:text-amber-400">Esperando confirmación</p>
                                    <p className="text-xs text-amber-700 dark:text-amber-500 mt-0.5 leading-snug">{isStore ? 'En tienda confirmarán el pago en efectivo para que puedas continuar.' : 'El restaurante confirmará el pago en efectivo para que puedas continuar.'}</p>
                                  </div>
                                </div>
                              </div>
                            )
                          ) : (
                            /* Pedido NO listo: mostrar tiempo estimado */
                            <div className="rounded-2xl border border-sky-200 dark:border-sky-900/30 bg-sky-50 dark:bg-sky-950/20 px-5 py-4">
                              <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-200/60 dark:bg-sky-800/30 text-sky-600 dark:text-sky-400 text-lg">
                                  <Clock className="h-5 w-5" />
                                </div>
                                <div>
                                  <p className="text-sm font-black text-sky-800 dark:text-sky-400">{isStore ? 'Surtiendo pedido' : 'Preparando pedido'}</p>
                                  <p className="text-xs text-sky-700 dark:text-sky-500 mt-0.5 leading-snug">
                                    {isStore && order.estimatedDeliveryTime
                                      ? `Listo aprox. ${Math.max(0, Math.round((new Date(order.estimatedDeliveryTime).getTime() - Date.now()) / 60000))} min`
                                      : remainingPrepMin !== null
                                      ? (remainingPrepMin === 0 ? 'Listo en cualquier momento' : `Listo aprox. en ${remainingPrepMin} min`)
                                      : isStore ? 'La tienda está surtiendo tu pedido' : 'El restaurante está preparando tu pedido'}
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}

                          {!isQueued && (
                          <div className="space-y-2.5 pt-1">
                            {(() => {
                              const MIN_WAIT_MS = 5 * 60 * 1000;
                              const arrivalTracking = order.tracking?.find(t => t.notes === 'DRIVER_ARRIVED_RESTAURANT');
                              const arrivalMs = arrivalTracking ? new Date(arrivalTracking.createdAt).getTime() : 0;
                              const waitMs = arrivalMs ? Date.now() - arrivalMs : 0;
                              const canRelease = waitMs >= MIN_WAIT_MS && order.status !== 'READY' && order.status !== 'PICKED_UP';
                              return canRelease && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    triggerHaptic([30, 15, 30]);
                                    setReleaseConfirmOrderId(order.id);
                                  }}
                                  disabled={activeActionKey !== null && activeActionKey.startsWith(order.id)}
                                  className="w-full py-3 rounded-2xl border-2 border-dashed border-rose-300 dark:border-rose-800/50 bg-rose-50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-400 text-sm font-bold transition active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  <Unlink className="h-5 w-5" /> Liberar pedido
                                </button>
                              );
                            })()}
                            {(() => { return (
                                <button
                                  type="button"
                                  id={`btn-${order.id}-startDelivery`}
                                  onClick={() => {
                                    triggerHaptic([40, 20, 40]);
                                    const startDelivery = async () => {
                                      const actionKey = `${order.id}:startDelivery`;
                                      setActiveActionKey(actionKey);
                                      try {
                                        if (isBatchPickup) {
                                          const resp = await requestJson<{ success: boolean; data: { orders: DriverOrder[] } }>({
                                            apiBase,
                                            path: `/driver-panel/pedidos/batch/${order.batchId}/recogido`,
                                            token,
                                            options: { method: 'PATCH' },
                                            fallbackMessage: 'Error al recoger el lote.',
                                            retry: { attempts: 1, backoffMs: 400 },
                                          });
                                          if (resp.success && resp.data.orders) {
                                            setPendingOrders(prev => {
                                              const updatedIds = new Set(resp.data.orders.map(o => o.id));
                                              return prev.map(o => updatedIds.has(o.id) ? (resp.data.orders.find(u => u.id === o.id) || o) : o);
                                            });
                                          }
                                        } else {
                                          if (order.status !== 'PICKED_UP') {
                                            await requestJson<SuccessResponse<DriverOrder>>({
                                              apiBase,
                                              path: `/driver-panel/pedidos/${order.id}/recogido`,
                                              token,
                                              options: { method: 'PATCH' },
                                              fallbackMessage: 'Error al recoger el pedido.',
                                              retry: { attempts: 1, backoffMs: 400 },
                                            });
                                          }
                                          await requestJson<SuccessResponse<DriverOrder>>({
                                            apiBase,
                                            path: `/driver-panel/pedidos/${order.id}/en-camino`,
                                            token,
                                            options: { method: 'PATCH' },
                                            fallbackMessage: 'Error al iniciar el viaje.',
                                            retry: { attempts: 1, backoffMs: 400 },
                                          });
                                        }
                                        await loadDashboard();
                                        setTripStartedForOrderId(order.id);
                                        setTimeout(() => setTripStartedForOrderId(null), 4000);
                                        setLastFailedAction(null);
                                        triggerHaptic([60, 40, 60]);
                                      } catch (requestError) {
                                        try { await loadDashboard(); } catch (loadErr) { console.error('Dashboard refresh failed:', loadErr); }
                                        const message = getRequestErrorMessage(requestError, 'No pudimos iniciar la entrega.');
                                        pushToast('error', 'Error', message);
                                      } finally {
                                        setActiveActionKey(null);
                                      }
                                    };
                                    void startDelivery();
                                  }}
                                  disabled={
                                    activeActionKey !== null
                                    || (isBatchPickup ? batchReadyCount === 0 : (order.status !== 'READY' && order.status !== 'PICKED_UP'))
                                    || (isCash && !order.cashPaymentConfirmedAt)
                                    || (isTransfer && order.status !== 'PICKED_UP')
                                  }
                                  className="w-full py-4 rounded-2xl bg-neutral-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-base font-black tracking-wide transition active:scale-[0.97] shadow-lg shadow-neutral-900/20 dark:shadow-zinc-100/10 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
                                >
                                  {activeActionKey === `${order.id}:startDelivery`
                                    ? <span className="flex items-center justify-center gap-2"><span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />Iniciando...</span>
                                    : isBatchPickup
                                      ? `Recoger lote (${batchReadyCount} pedidos)`
                                      : 'Iniciar entrega'
                                  }
                                </button>
                              );
                            })()}
                          </div>
                          )}
                        </div>
                      )}

                      {/* ═══════════════════════════════════════
                          PASO 2: IR AL CLIENTE
                          (PICKED_UP / IN_TRANSIT — before "llegué")
                          ═══════════════════════════════════════ */}
                      {isDeliveryPhase && !driverIsAtCustomer && (
                        <div className={isQueued ? "p-5 space-y-4" : "flex-grow flex flex-col justify-between p-5 space-y-5"}>
                          <div className="space-y-4">
                            {/* ── Batch progress ── */}
                            {(() => {
                              const batchGroup = order.batchId ? (batchGroups.get(order.batchId) || []) : [];
                              if (batchGroup.length < 2 || order.deliverySequence == null) return null;
                              const totalDeliveries = batchGroup.filter(o => o.deliverySequence != null).length;
                              return (
                                <div className="rounded-2xl bg-sky-50 dark:bg-sky-950/20 border border-sky-200 dark:border-sky-900/30 px-4 py-3">
                                  <div className="flex items-center justify-between mb-1.5">
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-sky-600 dark:text-sky-400">Progreso del lote</p>
                                    <p className="text-xs font-black text-sky-700 dark:text-sky-300">Entrega {(order.deliverySequence ?? 0) + 1}/{totalDeliveries}</p>
                                  </div>
                                  <div className="w-full h-1.5 rounded-full bg-sky-200/50 dark:bg-sky-800/30 overflow-hidden">
                                    <div
                                      className="h-full rounded-full bg-sky-500 dark:bg-sky-400 transition-all duration-500"
                                      style={{ width: `${(order.deliverySequence / Math.max(1, totalDeliveries - 1)) * 100}%` }}
                                    />
                                  </div>
                                </div>
                              );
                            })()}

                            {/* ── Address hero ── */}
                            <div
                              onClick={(e) => {
                                e.stopPropagation();
                                triggerHaptic(10);
                                setSelectedOrderDetail(order);
                              }}
                              className="rounded-[24px] bg-neutral-900 dark:bg-zinc-800 p-5 text-white shadow-lg cursor-pointer transition active:scale-[0.98]"
                            >
                              <div className="flex items-center justify-between mb-3">
                                <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">Llevar a domicilio</span>
                                <span className="flex items-center gap-1.5 text-xs font-semibold text-white/50">
                                  {order.customer.user?.name || 'Cliente'}
                                  <ChevronRight className="w-3.5 h-3.5" />
                                </span>
                              </div>
                              <p className="text-2xl font-black leading-tight text-white">{customerAddressStr}</p>
                              {order.address?.reference && (
                                <p className="mt-2 text-sm text-white/60 leading-snug"><MapPin className="h-5 w-5" /> {order.address.reference}</p>
                              )}
                            </div>

                            {/* ── Maps button ── */}
                            {customerQuery && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); triggerHaptic(20); setTurnByTurnFor((prev) => ({ ...prev, [order.id]: 'delivery' })); }}
                                className="flex items-center justify-center gap-2.5 w-full py-4 rounded-2xl bg-sky-500 text-white text-sm font-bold shadow-lg shadow-sky-500/30 hover:bg-sky-400 transition active:scale-[0.97]"
                              >
                                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>
                                Navegar al domicilio
                              </button>
                            )}

                            {/* ── Mapa embebido de navegación (opcional) — entrega ── */}
                            {customerQuery && (
                              <div className="space-y-2">
                                {navigationMapOpenFor[order.id] === 'delivery' ? (
                                  <>
                                    <DriverNavigationMap
                                      origin={null}
                                      destination={
                                        order.latitude && order.longitude
                                          ? {
                                              id: `delivery:${order.id}`,
                                              lat: order.latitude,
                                              lng: order.longitude,
                                              label: customerAddressStr,
                                              emoji: '',
                                            }
                                          : null
                                      }
                                    />
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        triggerHaptic(20);
                                        setNavigationMapOpenFor((prev) => ({ ...prev, [order.id]: null }));
                                      }}
                                      className="w-full py-2 rounded-lg border border-border dark:border-zinc-800 bg-surface dark:bg-zinc-900 text-[11px] font-bold text-muted dark:text-zinc-400 flex items-center justify-center gap-1.5 transition active:scale-[0.98]"
                                    >
                                      <BellOff className="h-5 w-5" /> Cerrar mapa
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      triggerHaptic(10);
                                      setNavigationMapOpenFor((prev) => ({ ...prev, [order.id]: 'delivery' }));
                                    }}
                                    className="w-full py-2.5 rounded-2xl border border-dashed border-border dark:border-zinc-700 bg-surface-2/50 dark:bg-zinc-900/40 flex items-center justify-center gap-2 text-xs font-bold text-foreground dark:text-zinc-300 transition active:scale-[0.98]"
                                  >
                                    <span className="text-sm"><MapIcon className="h-5 w-5" /></span> Ver mapa de navegación
                                  </button>
                                )}
                              </div>
                            )}

                            {/* ── Delivery preference ── */}
                            {order.deliveryPreference && (
                              <div className="rounded-2xl border border-border dark:border-zinc-800 px-4 py-3 flex items-start gap-3">
                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-950/20 text-base">
                                  {order.deliveryPreference === 'NO_DOORBELL' && ''}
                                  {order.deliveryPreference === 'CALL_ON_ARRIVAL' && ''}
                                  {order.deliveryPreference === 'PREFER_WHATSAPP' && ''}
                                  {order.deliveryPreference === 'HONK_ON_ARRIVAL' && ''}
                                  {order.deliveryPreference === 'BEWARE_OF_DOG' && ''}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-bold text-foreground dark:text-zinc-100">
                                    {order.deliveryPreference === 'NO_DOORBELL' && 'No tocar el timbre'}
                                    {order.deliveryPreference === 'CALL_ON_ARRIVAL' && 'Llamar al llegar'}
                                    {order.deliveryPreference === 'PREFER_WHATSAPP' && 'Avisar por WhatsApp'}
                                    {order.deliveryPreference === 'HONK_ON_ARRIVAL' && 'Tocar el claxon'}
                                    {order.deliveryPreference === 'BEWARE_OF_DOG' && 'Cuidado con el perro'}
                                  </p>
                                  <p className="text-xs text-muted dark:text-zinc-400 mt-0.5 leading-snug">
                                    {order.deliveryPreference === 'NO_DOORBELL' && 'Llama o manda mensaje. No uses el timbre.'}
                                    {order.deliveryPreference === 'CALL_ON_ARRIVAL' && 'Llama por teléfono en cuanto llegues.'}
                                    {order.deliveryPreference === 'PREFER_WHATSAPP' && 'Avisa por WhatsApp que ya llegaste.'}
                                    {order.deliveryPreference === 'HONK_ON_ARRIVAL' && 'Toca el claxon en vez del timbre.'}
                                    {order.deliveryPreference === 'BEWARE_OF_DOG' && 'Hay mascotas en la propiedad.'}
                                  </p>
                                </div>
                              </div>
                            )}

                            {/* ── Contact buttons ── */}
                            {order.customer.user?.phone && (
                              <div className="grid grid-cols-2 gap-2.5">
                                <a
                                  href={`tel:${order.customer.user.phone}`}
                                  onClick={(e) => { e.stopPropagation(); triggerHaptic(20); }}
                                  className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl border border-border dark:border-zinc-800 bg-surface-2 dark:bg-zinc-900/50 text-xs font-bold text-foreground dark:text-zinc-300 transition active:scale-[0.97]"
                                >
                                  <span className="text-base"><Phone className="h-5 w-5" /></span> Llamar
                                </a>
                                <a
                                  href={`https://wa.me/52${order.customer.user.phone.replace(/\D/g,'')}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => { e.stopPropagation(); triggerHaptic(20); }}
                                  className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl border border-emerald-200 dark:border-emerald-900/30 bg-emerald-50 dark:bg-emerald-950/20 text-xs font-bold text-emerald-700 dark:text-emerald-400 transition active:scale-[0.97]"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#25D366]" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                                  WhatsApp
                                </a>
                              </div>
                            )}

                            {order.restaurant?.user?.phone && (
                              <div>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    triggerHaptic(10);
                                    setShowRestaurantContact((prev) => !prev);
                                  }}
                                  className="flex items-center justify-between w-full py-3 px-4 rounded-2xl border border-border dark:border-zinc-800 bg-surface dark:bg-zinc-900 text-xs font-bold text-muted dark:text-zinc-400 transition active:scale-[0.98]"
                                >
                                  <span className="flex items-center gap-2">
                                    <span className="text-base"><Store className="h-5 w-5" /></span> {isStore ? 'Tienda' : 'Restaurante'}
                                  </span>
                                  <ChevronUp />
                                </button>
                                <div
                                  className={`grid transition-all duration-200 overflow-hidden ${showRestaurantContact ? 'grid-rows-[1fr] opacity-100 mt-2' : 'grid-rows-[0fr] opacity-0'}`}
                                >
                                  <div className="min-h-0">
                                    <div className="grid grid-cols-2 gap-2.5 mt-2">
                                      <a
                                        href={`tel:${order.restaurant.user.phone}`}
                                        onClick={(e) => { e.stopPropagation(); triggerHaptic(20); }}
                                        className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl border border-border dark:border-zinc-800 bg-surface-2 dark:bg-zinc-900/50 text-xs font-bold text-foreground dark:text-zinc-300 transition active:scale-[0.97]"
                                      >
                                        <span className="text-base"><Phone className="h-5 w-5" /></span> Llamar
                                      </a>
                                      <a
                                        href={`https://wa.me/52${order.restaurant.user.phone.replace(/\D/g,'')}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={(e) => { e.stopPropagation(); triggerHaptic(20); }}
                                        className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl border border-emerald-200 dark:border-emerald-900/30 bg-emerald-50 dark:bg-emerald-950/20 text-xs font-bold text-emerald-700 dark:text-emerald-400 transition active:scale-[0.97]"
                                      >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#25D366]" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                                        WhatsApp
                                      </a>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>

                          {!isQueued && (
                          <div className="pt-2">
                            <button
                              type="button"
                              id={`btn-${order.id}-arrivedCustomer`}
                              onClick={() => {
                                triggerHaptic([40, 20, 40]);
                                setArrivedAtCustomerFor(prev => prev.includes(order.id) ? prev : [...prev, order.id]);
                                void runDriverAction(order.id, 'arrived');
                              }}
                              disabled={activeActionKey !== null}
                              className="w-full py-4 rounded-2xl bg-neutral-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-base font-black tracking-wide transition active:scale-[0.97] shadow-lg shadow-neutral-900/20 dark:shadow-zinc-100/10 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
                            >
                              {activeActionKey === `${order.id}:arrived`
                                ? <span className="flex items-center justify-center gap-2"><span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />Notificando...</span>
                                : 'Llegué con el cliente'
                              }
                            </button>
                          </div>
                          )}
                        </div>
                      )}

                      {/* ═══════════════════════════════════════
                          PASO 2b: ENTREGA AL CLIENTE
                          (after "llegué" — collect or verify)
                          ═══════════════════════════════════════ */}
                      {isDeliveryPhase && driverIsAtCustomer && (
                        <div className={isQueued ? "p-5 space-y-4" : "flex-grow flex flex-col justify-between p-5 space-y-6"}>
                          <div className="space-y-5">

                            {/* ── Delivery instruction ── */}
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-widest text-muted dark:text-zinc-500 mb-1">Entrega a {order.customer.user?.name || 'cliente'}</p>
                              <p className="text-xl font-black text-foreground dark:text-zinc-50">
                                {isCash ? 'Cobra al cliente' : 'Solicita el PIN al cliente'}
                              </p>
                            </div>

                            {/* ── Batch progress ── */}
                            {(() => {
                              const batchGroup = order.batchId ? (batchGroups.get(order.batchId) || []) : [];
                              if (batchGroup.length < 2 || order.deliverySequence == null) return null;
                              const totalDeliveries = batchGroup.filter(o => o.deliverySequence != null).length;
                              return (
                                <div className="rounded-2xl bg-sky-50 dark:bg-sky-950/20 border border-sky-200 dark:border-sky-900/30 px-4 py-3">
                                  <div className="flex items-center justify-between mb-1.5">
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-sky-600 dark:text-sky-400">Progreso del lote</p>
                                    <p className="text-xs font-black text-sky-700 dark:text-sky-300">Entrega {(order.deliverySequence ?? 0) + 1}/{totalDeliveries}</p>
                                  </div>
                                  <div className="w-full h-1.5 rounded-full bg-sky-200/50 dark:bg-sky-800/30 overflow-hidden">
                                    <div
                                      className="h-full rounded-full bg-sky-500 dark:bg-sky-400 transition-all duration-500"
                                      style={{ width: `${(order.deliverySequence / Math.max(1, totalDeliveries - 1)) * 100}%` }}
                                    />
                                  </div>
                                </div>
                              );
                            })()}

                            {/* ── CASH: amount card ── */}
                            {isCash && order.totalAmount && (
                              <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/30 p-5">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">Total a cobrar</p>
                                    <p className="text-4xl font-black text-foreground dark:text-zinc-50 mt-0.5">{formatCurrency(order.totalAmount)}</p>
                                    <p className="text-xs text-emerald-600/70 dark:text-emerald-400/70 mt-1 leading-snug">Pago en efectivo — entrega cambio exacto si aplica</p>
                                  </div>
                                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-200/60 dark:bg-emerald-800/40 text-emerald-600 dark:text-emerald-400 text-2xl">
                                    <Banknote className="h-5 w-5" />
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* ── TRANSFER: PIN input ── */}
                            {isTransfer && (
                              <div className="space-y-3">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-muted dark:text-zinc-500">PIN de confirmación del cliente</p>
                                <input
                                  type="tel"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  maxLength={6}
                                  value={deliveryPinInput}
                                  onChange={(e) => {
                                    setDeliveryPinInput(e.target.value.replace(/\D/g, ''));
                                    setDeliveryPinError('');
                                  }}
                                  placeholder="• • • •"
                                  className="w-full text-center tracking-[0.5em] text-2xl font-black rounded-2xl border border-border dark:border-zinc-800 bg-surface-2 dark:bg-zinc-900 py-4 outline-none focus:border-neutral-400 dark:focus:border-zinc-600 text-foreground dark:text-zinc-50 transition"
                                  autoFocus
                                />
                                {deliveryPinError && (
                                  <p className="text-xs font-bold text-rose-600 dark:text-rose-400 text-center">{deliveryPinError}</p>
                                )}
                                <p className="text-[10px] text-muted dark:text-zinc-500 text-center leading-snug">El cliente te dará este PIN para confirmar que recibió el pedido</p>
                              </div>
                            )}

                            {/* ── Contact client ── */}
                            {order.customer.user?.phone && (
                              <div>
                                <p className="text-[10px] font-bold uppercase tracking-widest text-muted dark:text-zinc-500 mb-2.5 ml-1">Contacto</p>
                                <div className="grid grid-cols-2 gap-3">
                                  <a
                                    href={`tel:${order.customer.user.phone}`}
                                    onClick={(e) => { e.stopPropagation(); triggerHaptic(20); }}
                                    className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl border border-border dark:border-zinc-800 bg-surface-2 dark:bg-zinc-900/50 text-xs font-bold text-foreground dark:text-zinc-300 transition active:scale-[0.97]"
                                  >
                                    <span className="text-base"><Phone className="h-5 w-5" /></span> Llamar Cliente
                                  </a>
                                  <a
                                    href={`https://wa.me/52${order.customer.user.phone.replace(/\D/g,'')}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => { e.stopPropagation(); triggerHaptic(20); }}
                                    className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl border border-emerald-200 dark:border-emerald-900/30 bg-emerald-50 dark:bg-emerald-950/20 text-xs font-bold text-emerald-700 dark:text-emerald-400 transition active:scale-[0.97]"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#25D366]" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                                    WA Cliente
                                  </a>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* ── Espera sin contacto: lugar seguro / cliente no salió ── */}
                          {(() => {
                            const arrivalTime = getCustomerArrivalTime(order);
                            const elapsedMs = arrivalTime ? deliveryClock - arrivalTime : 0;
                            const SAFE_PLACE_MS = 10 * 60 * 1000;
                            const NO_SHOW_MS = 15 * 60 * 1000;
                            const remainingSafe = SAFE_PLACE_MS - elapsedMs;
                            const remainingNoShow = NO_SHOW_MS - elapsedMs;
                            const safePlaceReady = isTransfer && remainingSafe <= 0;
                            const noShowReady = isCash && remainingNoShow <= 0;
                            // La sección solo aparece el último minuto de espera para
                            // no presionar al repartidor mientras aún hay tiempo.
                            const LAST_MINUTE_MS = 60 * 1000;
                            const showTimer = (isCash || isTransfer) &&
                              (isTransfer ? remainingSafe <= LAST_MINUTE_MS : remainingNoShow <= LAST_MINUTE_MS);

                            if (!showTimer) return null;

                            return (
                              <div className="rounded-2xl border border-amber-200 dark:border-amber-900/30 bg-surface dark:bg-zinc-900 px-4 py-3.5 space-y-3">
                                <div className="flex items-center justify-between">
                                  <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-400">
                                    Espera sin contacto
                                  </p>
                                  {arrivalTime ? (
                                    <span className="text-xs font-black tabular-nums text-amber-800 dark:text-amber-300">
                                      {isTransfer
                                        ? `Lugar seguro en ${formatCountdown(remainingSafe)}`
                                        : `Liberar en ${formatCountdown(remainingNoShow)}`}
                                    </span>
                                  ) : null}
                                </div>
                                <p className="text-[10px] text-amber-700/70 dark:text-amber-400/70 leading-snug">
                                  {isTransfer
                                    ? 'Si el cliente no sale, podrás dejar el pedido en un lugar seguro y marcar la entrega.'
                                    : 'Si el cliente no sale, podrás liberar el pedido; se le cobrará al cliente.'}
                                </p>

                                {isTransfer && (
                                  <button
                                    type="button"
                                    id={`btn-${order.id}-safe-place`}
                                    onClick={() => {
                                      triggerHaptic([30, 20, 60]);
                                      setSafePlaceConfirmOrderId(order.id);
                                    }}
                                    disabled={!safePlaceReady || activeActionKey !== null}
                                    className="w-full py-3 rounded-2xl border-2 border-amber-300 dark:border-amber-700/60 bg-surface dark:bg-zinc-900 text-amber-800 dark:text-amber-300 text-sm font-black tracking-wide transition active:scale-[0.97] disabled:opacity-35 disabled:cursor-not-allowed"
                                  >
                                    {activeActionKey === `${order.id}:safePlace`
                                      ? <span className="flex items-center justify-center gap-2"><span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />Procesando...</span>
                                      : 'Dejar en un lugar seguro'}
                                  </button>
                                )}

                                {isCash && (
                                  <button
                                    type="button"
                                    id={`btn-${order.id}-no-show`}
                                    onClick={() => {
                                      triggerHaptic([30, 20, 60]);
                                      setNoShowConfirmOrderId(order.id);
                                    }}
                                    disabled={!noShowReady || activeActionKey !== null}
                                    className="w-full py-3 rounded-2xl border-2 border-rose-300 dark:border-rose-700/60 bg-surface dark:bg-zinc-900 text-rose-700 dark:text-rose-400 text-sm font-black tracking-wide transition active:scale-[0.97] disabled:opacity-35 disabled:cursor-not-allowed"
                                  >
                                    {activeActionKey === `${order.id}:noShow`
                                      ? <span className="flex items-center justify-center gap-2"><span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />Procesando...</span>
                                      : 'El cliente no salió — Liberar pedido'}
                                  </button>
                                )}
                              </div>
                            );
                          })()}

                          {!isQueued && (
                          <div className="pt-3">
                            <button
                              type="button"
                              id={`btn-${order.id}-delivered`}
                              onClick={async () => {
                                if (isTransfer && !deliveryPinInput.trim()) {
                                  setDeliveryPinError('Ingresa el PIN del cliente');
                                  triggerHaptic(100);
                                  return;
                                }
                                await runDriverAction(order.id, 'delivered', isTransfer ? deliveryPinInput.trim() : undefined);
                                const remainingInBatch = pendingOrdersRef.current.filter(o => o.batchId === order.batchId && o.id !== order.id && o.status !== 'DELIVERED');
                                if (remainingInBatch.length > 0) {
                                  pushToast('info', 'Siguiente entrega', `Continúa con la entrega #${remainingInBatch[0].dailyCounter || ''} — ${remainingInBatch[0].customer.user?.name || 'cliente'}`);
                                }
                              }}
                              disabled={activeActionKey !== null}
                              className="w-full py-4 rounded-2xl bg-neutral-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-base font-black tracking-wide transition active:scale-[0.97] shadow-lg shadow-neutral-900/20 dark:shadow-zinc-100/10 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
                            >
                              {activeActionKey === `${order.id}:delivered`
                                ? <span className="flex items-center justify-center gap-2"><span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />Procesando...</span>
                                : 'Pedido entregado'
                              }
                            </button>
                          </div>
                          )}
                        </div>
                      )}

                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}


        {/* ==========================================
            PESTAÑA 2: HISTORIAL DE ENTREGAS
            ========================================== */}
        {activeTab === 'history' && (
          <div className="space-y-4">
            {(
              <>
                {/* Tarjeta de Resumen Acumulado en el Historial */}
                <div className="rounded-3xl border border-black/5 bg-surface p-5 dark:bg-zinc-950 dark:border-zinc-900 shadow-sm transition">
                  <span className="text-[9px] font-extrabold uppercase tracking-widest text-sky-500 dark:text-sky-400">Métricas Totales Visibles</span>
                  <h3 className="text-lg font-black text-foreground dark:text-zinc-50 leading-tight mt-1">Historial General</h3>

                  {/* Filtro por período */}
                  <div className="mt-3 flex gap-1.5">
                    {(['day', 'week', 'month', 'all'] as const).map((f) => (
                      <button
                        key={f}
                        onClick={() => setHistoryFilter(f)}
                        className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider transition-all ${
                          historyFilter === f
                            ? 'bg-sky-500 text-white shadow-md'
                            : 'bg-surface-2 dark:bg-zinc-900 text-muted dark:text-zinc-400 hover:bg-surface-2 dark:hover:bg-zinc-800'
                        }`}
                      >
                        {f === 'day' ? 'Hoy' : f === 'week' ? 'Semana' : f === 'month' ? 'Mes' : 'Todo'}
                      </button>
                    ))}
                  </div>

                  <div className="mt-3.5 grid grid-cols-2 gap-3.5">
                    <div className="rounded-2xl bg-surface-2 p-4 dark:bg-zinc-900/60 shadow-inner">
                      <p className="text-[9px] font-black uppercase tracking-wider text-muted">Viajes Completados</p>
                      <p className="text-2xl font-black text-neutral-950 dark:text-zinc-50 mt-1">
                        {filteredHistoryOrders.length}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-surface-2 p-4 dark:bg-zinc-900/60 shadow-inner">
                      <p className="text-[9px] font-black uppercase tracking-wider text-sky-600 dark:text-sky-400">Tu Ganancia</p>
                      <p className="text-2xl font-black text-sky-600 dark:text-sky-400 mt-1">
                        {formatCurrency(
                          filteredHistoryOrders.reduce((sum, o) => sum + (o.deliveryFee || 0), 0)
                        )}
                      </p>
                    </div>
                  </div>
                  <p className="text-[9px] text-muted dark:text-zinc-600 mt-2 text-right">
                    Total facturado: {formatCurrency(filteredHistoryOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0))}
                  </p>
                </div>

                {filteredHistoryOrders.length === 0 ? (
                  <EmptyState
                    icon={Calendar}
                    title="Sin resultados"
                    description={historyFilter === 'all' ? 'Aún no registras entregas. ¡Sal a ruta e inicia a ganar!' : 'No hay entregas en este período.'}
                  />
                ) : (
                  <div className="space-y-5">
                    {groupedHistoryOrders.map(([dateLabel, orders]) => (
                      <div key={dateLabel}>
                        <div className="flex items-center gap-2 mb-2.5 px-1">
                          <h4 className="text-[10px] font-bold text-muted dark:text-zinc-500 uppercase tracking-wider">{dateLabel}</h4>
                          <div className="flex-1 h-px bg-surface-2/50 dark:bg-zinc-800/50" />
                          <span className="text-[9px] font-bold text-neutral-300 dark:text-zinc-600">{orders.length} viaje{orders.length !== 1 ? 's' : ''}</span>
                        </div>
                        <div className="space-y-2">
                          {orders.map((order) => (
                            <article
                              key={order.id}
                              onClick={() => setSelectedHistoryOrder(order)}
                              className="rounded-2xl border border-black/5 bg-surface p-4 flex justify-between items-center transition cursor-pointer hover:bg-surface-2 dark:bg-zinc-950 dark:border-zinc-900/60 dark:hover:bg-zinc-900"
                            >
                              <div>
                                <div className="flex items-center gap-2">
                                  {order.noShowReleasedAt ? (
                                    <span className="h-5 w-5 rounded bg-rose-500 text-white flex items-center justify-center text-[10px] font-bold shrink-0" title="Cliente no salió a recibir"><AlertTriangle className="h-5 w-5" /></span>
                                  ) : (
                                    <span className="h-5 w-5 rounded bg-emerald-500 text-white flex items-center justify-center text-[10px] font-bold shrink-0"><Check className="h-5 w-5" /></span>
                                  )}
                                  <span className="text-xs font-black text-neutral-950 dark:text-zinc-50 truncate">
                                    {order.restaurant.name} — {order.customer?.user?.name ?? 'Cliente'} #{order.dailyCounter ?? '?'}
                                  </span>
                                  {order.noShowReleasedAt && (
                                    <span className="text-[8px] font-black uppercase tracking-wider text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/30 rounded-full px-2 py-0.5 shrink-0">
                                      Cliente no salió
                                    </span>
                                  )}
                                </div>
                                <p className="text-[9px] text-muted dark:text-zinc-500 mt-0.5 font-mono tracking-tight">
                                  {order.orderReference}
                                </p>
                                <p className="text-[9px] text-muted dark:text-zinc-400 mt-0.5">
                                  {order.deliveredAt ? formatDate(order.deliveredAt) : 'Completado'}
                                </p>
                              </div>

                              <div className="text-right">
                                {order.totalAmount && (
                                  <span className="text-xs font-black text-neutral-950 dark:text-zinc-50 block">
                                    {formatCurrency(order.totalAmount)}
                                  </span>
                                )}
                                <span className="text-[9px] uppercase font-bold text-muted">
                                  {order.paymentMethod === 'TRANSFER' ? 'Transferencia' : 'Efectivo'}
                                </span>
                              </div>
                            </article>
                          ))}
                        </div>
                      </div>
                    ))}
                    
                    {historyHasMore && (
                      <button 
                        onClick={loadMoreHistory} 
                        disabled={loadingMoreHistory}
                        className="w-full py-3.5 bg-surface-2 hover:bg-surface-2 dark:bg-zinc-900 dark:hover:bg-zinc-800 text-foreground dark:text-zinc-300 rounded-2xl text-xs font-black uppercase tracking-widest transition-colors disabled:opacity-50 mt-4"
                      >
                        {loadingMoreHistory ? 'Cargando...' : 'Cargar más antiguos'}
                      </button>
                    )}
                  </div>
                )}
              </>
            )}


          </div>
        )}


        {/* ==========================================
            PESTAÑA 3: SEGURIDAD Y PERFIL DEL REPARTIDOR
            ========================================== */}
        {activeTab === 'profile' && (
          <div className="space-y-4 animate-fadeIn">
            {/* Foto de Perfil Uploader */}
            {driverProfile && (
              <div className="rounded-3xl border border-black/5 bg-surface p-5 dark:bg-zinc-950 dark:border-zinc-900 shadow-sm transition flex flex-col items-center">
                <span className="text-[9px] font-extrabold uppercase tracking-widest text-[#A78BFA] self-start">Identidad</span>
                <h3 className="text-lg font-black text-foreground dark:text-zinc-50 leading-tight mt-1 self-start">Foto de Perfil</h3>
                <p className="text-xs text-muted dark:text-zinc-400 mt-1 leading-relaxed self-start">
                  Sube una foto clara y profesional para que los restaurantes y clientes puedan identificarte fácilmente.
                </p>

                <div className="relative mt-6 mb-2">
                  <div className="relative h-28 w-28 rounded-full border border-black/10 dark:border-zinc-800 bg-surface-2 dark:bg-zinc-900 flex items-center justify-center overflow-hidden shadow-inner group">
                    {driverProfile.user.profilePhoto ? (
                      <img
                        src={driverProfile.user.profilePhoto}
                        alt="Profile Photo"
                        className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <span className="text-4xl text-muted select-none"><User className="h-5 w-5" /></span>
                    )}

                    {isUploadingPhoto && (
                      <div className="absolute inset-0 bg-black/60 backdrop-blur-xs flex flex-col items-center justify-center text-white">
                        <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                        <span className="text-[8px] font-bold uppercase tracking-wider mt-1.5">Subiendo</span>
                      </div>
                    )}
                  </div>

                  <label className="absolute -bottom-1.5 -right-1.5 h-10 w-10 rounded-full bg-accent hover:bg-sky-750 text-white flex items-center justify-center cursor-pointer shadow-lg shadow-accent/30 active:scale-95 transition">
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={isUploadingPhoto}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          void handlePhotoUpload(file);
                        }
                      }}
                    />
                  </label>
                </div>
              </div>
            )}

            {/* Tarjeta de estadísticas del repartidor */}
            {driverProfile && (
              <div className="rounded-3xl border border-black/5 bg-surface p-5 dark:bg-zinc-950 dark:border-zinc-900 shadow-sm transition">
                <span className="text-[9px] font-extrabold uppercase tracking-widest text-[#A78BFA]">Rendimiento</span>
                <h3 className="text-lg font-black text-foreground dark:text-zinc-50 leading-tight mt-1">Estadísticas</h3>
                <div className="mt-5 flex items-stretch gap-0">
                  <div className="flex-1 text-center border-r border-black/5 dark:border-zinc-800 pr-3">
                    <p className="text-3xl font-black text-foreground dark:text-zinc-50 tabular-nums">
                      {driverProfile.rating > 0 ? driverProfile.rating.toFixed(1) : <span className="text-base font-bold text-muted">—</span>}
                    </p>
                    <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-muted dark:text-zinc-400">Calificación</p>
                    {driverProfile.rating > 0 && (
                      <div className="mt-1 flex items-center justify-center gap-0.5">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <svg key={star} className={`h-2.5 w-2.5 ${star <= Math.round(driverProfile.rating) ? 'text-amber-400' : 'text-neutral-200 dark:text-zinc-700'}`} fill="currentColor" viewBox="0 0 20 20">
                            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                          </svg>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 text-center pl-3">
                    <p className="text-3xl font-black text-foreground dark:text-zinc-50 tabular-nums">{driverProfile.totalDeliveries}</p>
                    <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-muted dark:text-zinc-400">Viajes</p>
                    <p className="mt-1 text-[10px] text-muted dark:text-zinc-500">
                      {driverProfile.totalDeliveries === 0 ? 'Sin actividad' : 'Completados'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Tarjeta informativa del repartidor */}
            {driverProfile && (
              <div className="rounded-3xl border border-black/5 bg-surface p-5 dark:bg-zinc-950 dark:border-zinc-900 shadow-sm transition">
                <span className="text-[9px] font-extrabold uppercase tracking-widest text-[#A78BFA]">Datos del Repartidor</span>
                <h3 className="text-lg font-black text-foreground dark:text-zinc-50 leading-tight mt-1">Información de Cuenta</h3>

                <div className="mt-4 space-y-3.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-neutral-450 font-bold dark:text-zinc-500 uppercase tracking-wider text-[9px]">Nombre completo</span>
                    <span className="font-extrabold text-foreground dark:text-zinc-100">{driverProfile.user.name}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs pt-3 border-t border-black/5 dark:border-zinc-900/80">
                    <span className="text-neutral-450 font-bold dark:text-zinc-500 uppercase tracking-wider text-[9px]">Teléfono</span>
                    <span className="font-extrabold text-foreground dark:text-zinc-100">{driverProfile.user.phone}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs pt-3 border-t border-black/5 dark:border-zinc-900/80">
                    <span className="text-neutral-450 font-bold dark:text-zinc-500 uppercase tracking-wider text-[9px]">Zona de reparto</span>
                    <span className="font-extrabold text-foreground dark:text-zinc-100">{driverProfile.user.region}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs pt-3 border-t border-black/5 dark:border-zinc-900/80">
                    <span className="text-neutral-450 font-bold dark:text-zinc-500 uppercase tracking-wider text-[9px]">Estado de cuenta</span>
                    <span className="inline-flex rounded-lg bg-emerald-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider border border-emerald-200 text-emerald-700 dark:bg-emerald-950/20 dark:border-emerald-900/30 dark:text-emerald-400">
                      {driverProfile.user.status}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Ajustes de Datos y Batería */}
            <div className="rounded-3xl border border-black/5 bg-surface p-5 dark:bg-zinc-950 dark:border-zinc-900 shadow-sm transition">
              <span className="text-[9px] font-extrabold uppercase tracking-widest text-[#A78BFA]">Ahorro de Datos y Energía</span>
              <h3 className="text-lg font-black text-foreground dark:text-zinc-50 leading-tight mt-1">Preferencias de GPS</h3>
              <p className="text-xs text-muted dark:text-zinc-400 mt-1 leading-relaxed">
                Desactiva la transmisión en tiempo real para ahorrar el consumo de tu batería y datos Telcel. Tus clientes seguirán viendo tu estado de timeline.
              </p>

              <div className="mt-5 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="text-xl"><RadioTower className="h-5 w-5" /></span>
                  <div>
                    <p className="text-xs font-bold text-foreground dark:text-zinc-100">Compartir GPS en Vivo</p>
                    <p className="text-[10px] text-muted dark:text-zinc-400">
                      {shareLocationGps ? 'Activo (transmite ubicación)' : 'Apagado (ahorro máximo)'}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={toggleShareLocationGps}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${shareLocationGps ? 'bg-[#5B21B6] dark:bg-[#C4B5FD]' : 'bg-surface-2 dark:bg-zinc-800'
                    }`}
                  aria-label="Alternar compartir ubicación en vivo"
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-surface transition-transform ${shareLocationGps ? 'translate-x-6' : 'translate-x-1'
                      }`}
                  />
                </button>
              </div>
            </div>

            {/* Formulario Premium para cambiar contraseña */}
            <div className="rounded-3xl border border-black/5 bg-surface p-5 dark:bg-zinc-950 dark:border-zinc-900 shadow-sm transition">
              <span className="text-[9px] font-extrabold uppercase tracking-widest text-[#A78BFA]">Seguridad de Acceso</span>
              <h3 className="text-lg font-black text-foreground dark:text-zinc-50 leading-tight mt-1">Cambiar Contraseña</h3>
              <p className="text-xs text-muted dark:text-zinc-400 mt-1 leading-relaxed">
                Elige una contraseña segura de mínimo 6 caracteres para proteger tu cuenta.
              </p>

              <form onSubmit={handlePasswordChange} className="mt-5 space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-wider text-neutral-450 dark:text-zinc-400">
                    Contraseña actual
                  </label>
                  <div className="relative">
                    <input
                      type={showCurrentPassword ? 'text' : 'password'}
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="Ingresa tu contraseña actual"
                      required
                      className="w-full text-xs font-semibold rounded-2xl border border-black/5 bg-surface-2 px-4 py-3.5 pr-12 outline-none focus:border-[#C4B5FD] dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-50 dark:focus:border-[#A78BFA]"
                    />
                    <PasswordToggleButton show={showCurrentPassword} onToggle={() => setShowCurrentPassword((v) => !v)} />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-wider text-neutral-450 dark:text-zinc-400">
                    Nueva contraseña
                  </label>
                  <div className="relative">
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Mínimo 6 caracteres"
                      required
                      className="w-full text-xs font-semibold rounded-2xl border border-black/5 bg-surface-2 px-4 py-3.5 pr-12 outline-none focus:border-[#C4B5FD] dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-50 dark:focus:border-[#A78BFA]"
                    />
                    <PasswordToggleButton show={showNewPassword} onToggle={() => setShowNewPassword((v) => !v)} />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-wider text-neutral-450 dark:text-zinc-400">
                    Confirmar nueva contraseña
                  </label>
                  <div className="relative">
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Repite tu nueva contraseña"
                      required
                      className="w-full text-xs font-semibold rounded-2xl border border-black/5 bg-surface-2 px-4 py-3.5 pr-12 outline-none focus:border-[#C4B5FD] dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-50 dark:focus:border-[#A78BFA]"
                    />
                    <PasswordToggleButton show={showConfirmPassword} onToggle={() => setShowConfirmPassword((v) => !v)} />
                  </div>
                </div>

                {passwordError && (
                  <div className="rounded-2xl bg-rose-50 border border-rose-100 p-3.5 text-xs font-bold text-rose-800 text-center dark:bg-rose-950/20 dark:border-rose-900/30 dark:text-rose-450">
                    <AlertTriangle className="h-5 w-5" /> {passwordError}
                  </div>
                )}

                {passwordSuccess && (
                  <div className="rounded-2xl bg-emerald-50 border border-emerald-100 p-3.5 text-xs font-bold text-emerald-850 text-center dark:bg-emerald-950/20 dark:border-emerald-900/30 dark:text-emerald-450 animate-bounce">
                    <PartyPopper className="h-5 w-5" /> {passwordSuccess}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={updatingPassword || !currentPassword || !newPassword || !confirmPassword}
                  className="w-full py-4 rounded-2xl text-xs font-black uppercase tracking-widest text-white bg-neutral-950 hover:bg-neutral-850 dark:bg-[#C4B5FD] dark:text-black transition shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {updatingPassword ? 'Guardando...' : 'Guardar Cambios'}
                </button>
              </form>
            </div>
          </div>
        )}

      </section>

      {/* ==========================================
          MODALES OPERATIVOS (PIN & CONFIGURACIÓN)
          ========================================== */}

      {/* 1. Modal de Configuración Técnica Ocultable */}
      {showDeveloperSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-md rounded-[32px] border border-black/5 bg-surface p-6 shadow-2xl dark:bg-zinc-950 dark:border-zinc-900 animate-scaleUp">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-black uppercase tracking-wider">Centro de Desarrollador</h3>
              <button
                type="button"
                onClick={() => setShowDeveloperSettings(false)}
                className="h-8 w-8 rounded-full flex items-center justify-center border border-black/5 dark:border-zinc-900 bg-surface-2 dark:bg-zinc-900 font-bold"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <label className="block space-y-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-muted">API Endpoint Base</span>
                <input
                  type="text"
                  value={apiBase}
                  onChange={(e) => setApiBase(e.target.value)}
                  placeholder="/api"
                  className="w-full rounded-xl border border-black/5 bg-surface-2 px-4 py-3 text-xs outline-none focus:border-border dark:bg-zinc-900 dark:border-zinc-800"
                />
              </label>

              {/* Geolocalización del Contrato */}
              {driverProfile && (
                <div className="rounded-2xl border border-black/5 bg-surface-2 p-4 dark:bg-zinc-900/60 space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-wider text-muted">Geolocalización GPS</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-[9px] text-muted uppercase block">Latitud</span>
                      <span className="font-bold">{formatCoordinate(driverProfile.currentLatitude)}</span>
                    </div>
                    <div>
                      <span className="text-[9px] text-muted uppercase block">Longitud</span>
                      <span className="font-bold">{formatCoordinate(driverProfile.currentLongitude)}</span>
                    </div>
                  </div>
                </div>
              )}

              <p className="text-[10px] text-muted leading-relaxed">
                Modifica estos campos bajo instrucción técnica. Para forzar la actualización de coordenadas o simular fallos, utiliza las herramientas del servidor base.
              </p>

              <button
                type="button"
                onClick={() => {
                  persistApiBase(storageKey, apiBase);
                  setShowDeveloperSettings(false);
                  pushToast('success', 'Endpoint Sincronizado', 'API base restablecida correctamente.');
                }}
                className="w-full py-3 bg-neutral-950 text-white rounded-xl text-xs font-bold dark:bg-[#C4B5FD] dark:text-black"
              >
                Guardar Cambios
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Hermoso Modal de Verificación de PIN en React */}
      {showPinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-sm rounded-[32px] border border-black/5 bg-surface p-6 shadow-2xl dark:bg-zinc-950 dark:border-zinc-900 animate-scaleUp">
            <div className="text-center mb-5">
              <span className="text-[9px] font-black uppercase tracking-widest text-[#A78BFA] block">Seguridad del Restaurante</span>
              <h3 className="text-xl font-black text-foreground dark:text-zinc-50 mt-1">Verificar Recogida</h3>
              <p className="text-xs text-muted dark:text-zinc-400 mt-1 leading-relaxed">
                Solicita al personal de cocina el **PIN de verificación de 4 dígitos** antes de retirar el pedido de las instalaciones.
              </p>
            </div>

            <div className="space-y-4">
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                placeholder="Ingresa el PIN numérico"
                className="w-full text-center tracking-[0.6em] text-lg font-black rounded-2xl border border-black/5 bg-surface-2 py-3.5 outline-none focus:border-[#C4B5FD] dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-50 dark:focus:border-[#A78BFA]"
                autoFocus
              />

              {pinModalError && (
                <div className="rounded-xl bg-rose-50/80 border border-rose-100 p-3 text-[11px] font-bold text-rose-800 text-center dark:bg-rose-950/20 dark:border-rose-900/30 dark:text-rose-400">
                  <AlertTriangle className="h-5 w-5" /> {pinModalError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(20);
                    setShowPinModal(false);
                    setPinInput('');
                    setPinModalError('');
                  }}
                  className="py-3.5 rounded-2xl text-xs font-black uppercase tracking-wider border border-black/10 bg-surface hover:bg-surface-2 dark:bg-zinc-950 dark:border-zinc-900"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void runDriverAction(pinModalOrderId, 'pickedUp', pinInput.trim())}
                  disabled={!pinInput.trim() || activeActionKey !== null}
                  className="py-3.5 rounded-2xl text-xs font-black uppercase tracking-wider text-white bg-neutral-950 hover:bg-neutral-850 dark:bg-[#C4B5FD] dark:text-black disabled:opacity-50"
                >
                  {activeActionKey !== null ? 'Validando...' : 'Verificar PIN'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==========================================
          BOTÓN FLOTANTE DE CONEXIÓN
          ========================================== */}
      {activeTab === 'active' && (
        <div className="fixed bottom-[calc(2rem+env(safe-area-inset-bottom))] left-0 right-0 flex justify-center px-6 z-40 pointer-events-none">
          <button
            type="button"
            onClick={() => {
              if (driverProfile?.availability === 'AVAILABLE' || driverProfile?.availability === 'BUSY') {
                void updateAvailability('OFFLINE');
              } else {
                void updateAvailability('AVAILABLE');
              }
            }}
            disabled={updatingAvailability !== null || loadingDashboard}
            className={`pointer-events-auto relative h-20 w-20 rounded-full shadow-2xl transition-all duration-300 active:scale-95 flex items-center justify-center flex-col gap-1 ${(driverProfile?.availability === 'AVAILABLE' || driverProfile?.availability === 'BUSY')
                ? 'bg-gradient-to-br from-rose-500 to-rose-700 shadow-rose-500/40 hover:brightness-110'
                : 'bg-gradient-to-br from-sky-400 to-sky-600 shadow-sky-500/40 hover:brightness-110'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            aria-label={(driverProfile?.availability === 'AVAILABLE' || driverProfile?.availability === 'BUSY') ? 'Desconectarse' : 'Conectarse'}
          >
            {updatingAvailability !== null ? (
              <svg className="h-7 w-7 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (driverProfile?.availability === 'AVAILABLE' || driverProfile?.availability === 'BUSY') ? (
              <>
                <X className="h-7 w-7 text-white" strokeWidth={2.5} />
                <span className="text-[9px] font-black text-white/90 uppercase tracking-wider leading-none">Pausar</span>
              </>
            ) : (
              <>
                <svg className="h-7 w-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span className="text-[9px] font-black text-white/90 uppercase tracking-wider leading-none">Iniciar</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Modal de Detalle del Pedido en Historial */}
      {selectedHistoryOrder && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/70 backdrop-blur-md">
          <div className="w-full max-w-md rounded-[32px] bg-surface shadow-2xl dark:bg-zinc-950 animate-fadeIn max-h-[85vh] flex flex-col overflow-hidden border border-black/5 dark:border-zinc-900">
            <div className="h-[3px] bg-sky-400/40 shrink-0" />

            <div className="p-5 pt-4 shrink-0 border-b border-black/5 dark:border-zinc-900">
              <div className="flex justify-between items-start">
                <div className="flex items-start gap-3">
                  <span className="h-9 w-9 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center text-white text-sm shadow-lg shadow-emerald-500/20 shrink-0 mt-0.5"><Check className="h-5 w-5" /></span>
                  <div>
                    <h3 className="text-sm font-black text-foreground dark:text-zinc-50 leading-tight">
                      {selectedHistoryOrder.customer?.user?.name
                        ? `${selectedHistoryOrder.restaurant.name} — ${selectedHistoryOrder.customer.user.name}`
                        : selectedHistoryOrder.orderReference
                      }
                    </h3>
                    <p className="text-[9px] font-mono text-muted dark:text-zinc-500 mt-0.5 tracking-tight">
                      {selectedHistoryOrder.orderReference}
                      {selectedHistoryOrder.dailyCounter != null && (
                        <span className="ml-2 text-[9px] font-bold text-muted dark:text-zinc-500 not-italic font-sans">
                          · Pedido #{selectedHistoryOrder.dailyCounter}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedHistoryOrder(null)}
                  className="h-7 w-7 rounded-full flex items-center justify-center bg-surface-2 dark:bg-zinc-900 text-muted hover:bg-surface-2 dark:hover:bg-zinc-800 hover:text-muted dark:hover:text-zinc-300 transition-colors shrink-0 ml-3"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 pt-4 space-y-3">
              {/* Fecha de entrega */}
              <div className={`flex items-center justify-between px-4 py-3 rounded-2xl border ${
                selectedHistoryOrder.noShowReleasedAt
                  ? 'bg-rose-50/60 dark:bg-rose-950/20 border-rose-100/80 dark:border-rose-900/40'
                  : 'bg-sky-50/60 dark:bg-sky-950/20 border-sky-100/80 dark:border-sky-900/40'
              }`}>
                <span className={`text-[9px] font-black uppercase tracking-wider flex items-center gap-1.5 ${
                  selectedHistoryOrder.noShowReleasedAt ? 'text-rose-600 dark:text-rose-400' : 'text-sky-600 dark:text-sky-400'
                }`}>
                  <Clock className="w-3 h-3" strokeWidth={2.5} />
                  {selectedHistoryOrder.noShowReleasedAt ? 'Liberado — cliente no salió' : 'Entregado'}
                </span>
                <span className="text-xs font-bold text-foreground dark:text-zinc-200">
                  {selectedHistoryOrder.deliveredAt ? formatDate(selectedHistoryOrder.deliveredAt) : '—'}
                </span>
              </div>

              {selectedHistoryOrder.noShowReleasedAt && (
                <div className="flex items-start gap-3 px-4 py-3 rounded-2xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/30">
                  <span className="text-base shrink-0 mt-0.5"><AlertTriangle className="h-5 w-5" /></span>
                  <div>
                    <p className="text-[11px] font-black text-amber-700 dark:text-amber-400">Pedido liberado con deuda</p>
                    <p className="text-[10px] text-amber-700/80 dark:text-amber-400/80 mt-0.5 leading-relaxed">
                      El comensal no salió a recibir. Se le cobró el total del pedido y quedó con saldo pendiente hasta que liquide. Este viaje no genera comisión para ti.
                    </p>
                  </div>
                </div>
              )}

              {/* Restaurante / Tienda */}
              <div className="p-4 rounded-2xl bg-surface dark:bg-zinc-900/60 border border-border dark:border-zinc-800 shadow-sm">
                <span className="text-[9px] font-black uppercase tracking-wider text-muted flex items-center gap-1.5">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" /></svg>
                  {selectedHistoryOrder.restaurant.businessType && selectedHistoryOrder.restaurant.businessType !== 'RESTAURANT' ? 'Tienda' : 'Restaurante'}
                </span>
                <p className="text-sm font-black text-foreground dark:text-zinc-50 mt-1.5">{selectedHistoryOrder.restaurant.name}</p>
                {selectedHistoryOrder.restaurant.address && (
                  <p className="text-[10px] text-muted dark:text-zinc-400 mt-1 leading-relaxed flex items-start gap-1">
                    <svg className="w-2.5 h-2.5 mt-0.5 shrink-0 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    {selectedHistoryOrder.restaurant.address}
                  </p>
                )}
              </div>

              {/* Dirección de entrega */}
              <div className="p-4 rounded-2xl bg-surface dark:bg-zinc-900/60 border border-border dark:border-zinc-800 shadow-sm">
                <span className="text-[9px] font-black uppercase tracking-wider text-muted flex items-center gap-1.5">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  Dirección de Entrega
                </span>
                {selectedHistoryOrder.address ? (
                  <>
                    <p className="text-sm font-black text-foreground dark:text-zinc-50 mt-1.5">
                      {selectedHistoryOrder.address.street} {selectedHistoryOrder.address.number}
                    </p>
                    <p className="text-[10px] text-muted dark:text-zinc-400 mt-0.5">
                      Col. {selectedHistoryOrder.address.neighborhood}
                    </p>
                    {selectedHistoryOrder.address.reference && (
                      <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1 bg-amber-50/50 dark:bg-amber-950/20 px-2.5 py-1.5 rounded-xl border border-amber-200/50 dark:border-amber-900/30">
                        <svg className="w-2.5 h-2.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" /></svg>
                        {selectedHistoryOrder.address.reference}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-muted mt-1.5">No disponible</p>
                )}
              </div>

              {/* Distancia */}
              {selectedHistoryOrder.restaurant.latitude != null &&
               selectedHistoryOrder.restaurant.longitude != null &&
               selectedHistoryOrder.latitude != null &&
               selectedHistoryOrder.longitude != null && (
                <div className="flex items-center justify-between px-4 py-3 rounded-2xl bg-surface-2/80 dark:bg-zinc-900/40 border border-border dark:border-zinc-800">
                  <span className="text-[9px] font-black uppercase tracking-wider text-muted flex items-center gap-1.5">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
                    Distancia Recorrida
                  </span>
                  <span className="text-xs font-black text-foreground dark:text-zinc-50">
                    {calculateDistance(
                      selectedHistoryOrder.restaurant.latitude,
                      selectedHistoryOrder.restaurant.longitude,
                      selectedHistoryOrder.latitude,
                      selectedHistoryOrder.longitude
                    ).toFixed(1)}{' '}
                    km
                  </span>
                </div>
              )}

              {/* Resumen Financiero */}
              <div className="rounded-2xl bg-gradient-to-b from-white to-neutral-50/80 dark:from-zinc-900/80 dark:to-zinc-900/40 border border-border dark:border-zinc-800 overflow-hidden shadow-sm">
                <div className="px-4 pt-3.5 pb-2 bg-gradient-to-r from-sky-500/5 to-transparent">
                  <span className="text-[9px] font-black uppercase tracking-wider text-sky-600 dark:text-sky-400 flex items-center gap-1.5">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    Resumen Financiero
                  </span>
                </div>
                  <div className="divide-y divide-neutral-100 dark:divide-zinc-800">
                  {selectedHistoryOrder.noShowReleasedAt ? (
                    <>
                      <div className="flex justify-between items-center px-4 py-3 bg-amber-50/60 dark:bg-amber-950/10">
                        <span className="text-[11px] font-bold text-amber-700 dark:text-amber-400">Deuda del Comensal (pendiente)</span>
                        <span className="text-sm font-black text-amber-600 dark:text-amber-400">
                          {formatCurrency(selectedHistoryOrder.totalAmount || 0)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center px-4 py-3">
                        <span className="text-[11px] font-bold text-muted dark:text-zinc-400">Recibido del Comensal</span>
                        <span className="text-sm font-black text-neutral-950 dark:text-zinc-50">$0.00</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between items-center px-4 py-3">
                      <span className="text-[11px] font-bold text-muted dark:text-zinc-400">Cobrado al Comensal</span>
                      <span className="text-sm font-black text-neutral-950 dark:text-zinc-50">
                        {formatCurrency(selectedHistoryOrder.totalAmount || 0)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between items-center px-4 py-3">
                    <span className="text-[11px] font-bold text-muted dark:text-zinc-400">Pagado al{selectedHistoryOrder.restaurant.businessType && selectedHistoryOrder.restaurant.businessType !== 'RESTAURANT' ? 'a Tienda' : ' Restaurante'}</span>
                    <span className="text-sm font-black text-amber-600 dark:text-amber-400">
                      {formatCurrency((selectedHistoryOrder.totalAmount ?? 0) - (selectedHistoryOrder.deliveryFee ?? 0))}
                    </span>
                  </div>
                  {selectedHistoryOrder.deliveryFee != null && (
                    <div className="flex justify-between items-center px-4 py-3 bg-emerald-50/40 dark:bg-emerald-950/10">
                      <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 10l4-4m0 0l4 4m-4-4v12" /></svg>
                        Tu Comisión de Envío
                      </span>
                      <span className="text-base font-black text-emerald-600 dark:text-emerald-400">
                        +{formatCurrency(selectedHistoryOrder.deliveryFee)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between items-center px-4 py-3">
                    <span className="text-[11px] font-bold text-muted dark:text-zinc-400">Tipo de Pago</span>
                    <span className={`text-[10px] font-black px-3 py-1.5 rounded-full border ${
                      selectedHistoryOrder.paymentMethod === 'TRANSFER'
                        ? 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/30 dark:text-sky-400 dark:border-sky-900/50'
                        : 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900/50'
                    }`}>
                      {paymentMethodLabel(selectedHistoryOrder.paymentMethod)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Artículos del pedido */}
              {selectedHistoryOrder.items && selectedHistoryOrder.items.length > 0 && (
                <div className="rounded-2xl bg-surface dark:bg-zinc-900/60 border border-border dark:border-zinc-800 overflow-hidden shadow-sm">
                  <div className="px-4 pt-3.5 pb-2 border-b border-border dark:border-zinc-800">
                    <span className="text-[9px] font-black uppercase tracking-wider text-muted flex items-center gap-1.5">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
                      Artículos ({selectedHistoryOrder.items.length})
                    </span>
                  </div>
                  <div className="divide-y divide-neutral-100 dark:divide-zinc-800">
                    {selectedHistoryOrder.items.map((item) => (
                      <div key={item.id} className="px-4 py-3">
                        <div className="flex justify-between items-start">
                          <div className="flex-1 min-w-0 mr-3">
                            <p className="text-xs font-black text-foreground dark:text-zinc-50 truncate">
                              {item.quantity}x {item.product.name}
                            </p>
                            {item.options && item.options.length > 0 && (
                              <p className="text-[9px] text-muted dark:text-zinc-500 mt-0.5 truncate">
                                {item.options.map((o) => o.name).join(', ')}
                              </p>
                            )}
                            {item.specialInstructions && (
                              <p className="text-[9px] text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1 bg-amber-50/50 dark:bg-amber-950/20 px-2 py-1 rounded-lg w-fit">
                                <svg className="w-2.5 h-2.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" /></svg>
                                {item.specialInstructions}
                              </p>
                            )}
                          </div>
                          <span className="text-xs font-black text-neutral-950 dark:text-zinc-50 shrink-0">
                            {formatCurrency(item.subtotal)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Liberar pedido — Confirmación ── */}
      {releaseConfirmOrderId && (() => {
        const releaseOrder = pendingOrders.find(o => o.id === releaseConfirmOrderId);
        const arrivalTracking = releaseOrder?.tracking?.find((t: { notes?: string | null, createdAt: string }) => t.notes === 'DRIVER_ARRIVED_RESTAURANT');
        const waitMin = arrivalTracking ? Math.floor((Date.now() - new Date(arrivalTracking.createdAt).getTime()) / 60000) : 0;
        return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
            <div className="w-full max-w-md rounded-3xl bg-surface dark:bg-zinc-900 p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
              <div className="flex flex-col items-center text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-950/30 text-3xl mb-4">
                  <Unlink className="h-5 w-5" />
                </div>
                <h2 className="text-xl font-black text-neutral-950 dark:text-zinc-50">¿Liberar pedido?</h2>
                <p className="text-sm text-muted dark:text-zinc-400 mt-2 leading-relaxed">
                  Has esperado <strong className="text-foreground dark:text-zinc-300">{waitMin} minutos</strong> en el establecimiento.
                  Puedes liberarte de este pedido para que otro repartidor lo tome.
                </p>
                <p className="text-xs text-muted dark:text-zinc-500 mt-3 leading-relaxed bg-surface-2 dark:bg-zinc-800/50 rounded-xl px-4 py-3 w-full">
                  Agradecemos tu espera y compromiso. Si decides liberarlo,{' '}
                  <strong>no se te volverá a asignar este pedido</strong> y podrás recibir otros.
                </p>
                <div className="flex gap-3 w-full mt-6">
                  <button
                    type="button"
                    onClick={() => { setReleaseConfirmOrderId(null); triggerHaptic(10); }}
                    className="flex-1 py-3.5 rounded-2xl border border-border dark:border-zinc-700 bg-surface dark:bg-zinc-800 text-sm font-bold text-muted dark:text-zinc-400 transition active:scale-[0.97] hover:bg-surface-2 dark:hover:bg-zinc-700"
                  >
                    Seguir esperando
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const orderId = releaseConfirmOrderId;
                      setReleaseConfirmOrderId(null);
                      triggerHaptic([40, 20, 60]);
                      void runDriverAction(orderId, 'releaseOrder');
                    }}
                    disabled={activeActionKey === `${releaseConfirmOrderId}:releaseOrder`}
                    className="flex-1 py-3.5 rounded-2xl bg-rose-500 text-sm font-bold text-white shadow-lg shadow-rose-500/30 transition active:scale-[0.97] hover:bg-rose-600 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                  >
                    {activeActionKey === `${releaseConfirmOrderId}:releaseOrder` ? 'Liberando...' : 'Sí, liberar pedido'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {safePlaceConfirmOrderId && (() => {
        const safeOrder = pendingOrders.find(o => o.id === safePlaceConfirmOrderId);
        const arrivalTime = safeOrder ? getCustomerArrivalTime(safeOrder) : null;
        const waitMin = arrivalTime ? Math.floor((Date.now() - arrivalTime) / 60000) : 0;
        return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
            <div className="w-full max-w-md rounded-3xl bg-surface dark:bg-zinc-900 p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
              <div className="flex flex-col items-center text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950/30 text-3xl mb-4">
                  <Package className="h-5 w-5" />
                </div>
                <h2 className="text-xl font-black text-neutral-950 dark:text-zinc-50">¿Dejar en un lugar seguro?</h2>
                <p className="text-sm text-muted dark:text-zinc-400 mt-2 leading-relaxed">
                  Has esperado <strong className="text-foreground dark:text-zinc-300">{waitMin} minutos</strong> sin que el cliente salga.
                  Puedes dejar el pedido en un lugar seguro y marcarlo como entregado.
                </p>
                <div className="w-full text-left mt-4 space-y-2.5">
                  <div className="rounded-2xl border border-sky-200 dark:border-sky-900/30 bg-surface dark:bg-zinc-900 px-4 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-sky-600 dark:text-sky-400 mb-1">Para el cliente</p>
                    <p className="text-xs text-muted dark:text-zinc-300 leading-relaxed">
                      El cliente <strong>ya pagó por transferencia</strong>. Deja el pedido donde pueda recogerlo; el pago ya está cubierto.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900/30 bg-surface dark:bg-zinc-900 px-4 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400 mb-1">Para ti (repartidor)</p>
                    <p className="text-xs text-muted dark:text-zinc-300 leading-relaxed">
                      Al dejar el pedido en lugar seguro la entrega cuenta <strong>normalmente</strong>: se te paga el envío y se aplica la comisión habitual como en cualquier entrega.
                    </p>
                  </div>
                </div>
                <div className="flex gap-3 w-full mt-6">
                  <button
                    type="button"
                    onClick={() => { setSafePlaceConfirmOrderId(null); triggerHaptic(10); }}
                    className="flex-1 py-3.5 rounded-2xl border border-border dark:border-zinc-700 bg-surface dark:bg-zinc-800 text-sm font-bold text-muted dark:text-zinc-400 transition active:scale-[0.97] hover:bg-surface-2 dark:hover:bg-zinc-700"
                  >
                    Volver
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const orderId = safePlaceConfirmOrderId;
                      setSafePlaceConfirmOrderId(null);
                      triggerHaptic([40, 20, 60]);
                      void runDriverAction(orderId, 'safePlace');
                    }}
                    disabled={activeActionKey === `${safePlaceConfirmOrderId}:safePlace`}
                    className="flex-1 py-3.5 rounded-2xl bg-amber-500 text-sm font-bold text-white shadow-lg shadow-amber-500/30 transition active:scale-[0.97] hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                  >
                    {activeActionKey === `${safePlaceConfirmOrderId}:safePlace` ? 'Procesando...' : 'Liberar pedido'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {noShowConfirmOrderId && (() => {
        const noShowOrder = pendingOrders.find(o => o.id === noShowConfirmOrderId);
        const arrivalTime = noShowOrder ? getCustomerArrivalTime(noShowOrder) : null;
        const waitMin = arrivalTime ? Math.floor((Date.now() - arrivalTime) / 60000) : 0;
        return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
            <div className="w-full max-w-md rounded-3xl bg-surface dark:bg-zinc-900 p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
              <div className="flex flex-col items-center text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-950/30 text-3xl mb-4">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <h2 className="text-xl font-black text-neutral-950 dark:text-zinc-50">¿Liberar el pedido?</h2>
                <p className="text-sm text-muted dark:text-zinc-400 mt-2 leading-relaxed">
                  Has esperado <strong className="text-foreground dark:text-zinc-300">{waitMin} minutos</strong> y el cliente no salió a recibir.
                </p>
                <div className="w-full text-left mt-4 rounded-2xl border border-amber-200 dark:border-amber-900/30 bg-surface dark:bg-zinc-900 px-4 py-3">
                  <p className="text-xs text-muted dark:text-zinc-300 leading-relaxed">
                    Asegúrate de haber intentado contactar al cliente. Al liberar el pedido{' '}
                    <strong>podrás disponer de él</strong> y deberás{' '}
                    <strong>contactar a soporte</strong> para la devolución o ajuste del pedido.
                  </p>
                </div>
                <div className="flex gap-3 w-full mt-6">
                  <button
                    type="button"
                    onClick={() => { setNoShowConfirmOrderId(null); triggerHaptic(10); }}
                    className="flex-1 py-3.5 rounded-2xl border border-border dark:border-zinc-700 bg-surface dark:bg-zinc-800 text-sm font-bold text-muted dark:text-zinc-400 transition active:scale-[0.97] hover:bg-surface-2 dark:hover:bg-zinc-700"
                  >
                    Volver
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const orderId = noShowConfirmOrderId;
                      setNoShowConfirmOrderId(null);
                      triggerHaptic([40, 20, 60]);
                      void runDriverAction(orderId, 'noShow');
                    }}
                    disabled={activeActionKey === `${noShowConfirmOrderId}:noShow`}
                    className="flex-1 py-3.5 rounded-2xl bg-rose-500 text-sm font-bold text-white shadow-lg shadow-rose-500/30 transition active:scale-[0.97] hover:bg-rose-600 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                  >
                    {activeActionKey === `${noShowConfirmOrderId}:noShow` ? 'Procesando...' : 'Liberar pedido'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

    </main>
  );
}

// ==========================================
// COMPONENTES AUXILIARES Y UTILERÍAS
// ==========================================

function StatusBadge({ status }: { status: OrderStatus }) {
  const palette: Record<OrderStatus, string> = {
    CONFIRMED: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-950/30 dark:bg-sky-950/20 dark:text-sky-400',
    PREPARING: 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-950/30 dark:bg-orange-950/20 dark:text-orange-400',
    READY: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-950/30 dark:bg-emerald-950/20 dark:text-emerald-400',
    PICKED_UP: 'border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-950/30 dark:bg-teal-950/20 dark:text-teal-400',
    IN_TRANSIT: 'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-950/30 dark:bg-cyan-950/20 dark:text-cyan-400',
    DELIVERED: 'border-lime-200 bg-lime-50 text-lime-700 dark:border-lime-950/30 dark:bg-lime-950/20 dark:text-lime-400',
  };

  return (
    <span className={`rounded-xl border px-2.5 py-1 text-[9.5px] font-black uppercase tracking-wider shadow-sm ${palette[status]}`}>
      {orderStatusLabelMap[status]}
    </span>
  );
}

const availabilityLabelMap: Record<DriverAvailability, string> = {
  AVAILABLE: 'Disponible',
  BUSY: 'Ocupado',
  OFFLINE: 'Desconectado',
};

const orderStatusLabelMap: Record<OrderStatus, string> = {
  CONFIRMED: 'Confirmado',
  PREPARING: 'Preparándose',
  READY: 'Listo en Cocina',
  PICKED_UP: 'Recogido',
  IN_TRANSIT: 'En Camino',
  DELIVERED: 'Entregado',
};

// Toast notifications intentionally disabled for the driver UI.

function buildLiveEventKey(
  eventName: (typeof liveEvents)[number],
  payload: { orderId?: string; orderReference?: string; restaurantName?: string; status?: string }
) {
  return [
    eventName,
    payload.orderId || 'order',
    payload.orderReference || 'reference',
    payload.restaurantName || 'restaurant',
    payload.status || 'status',
  ].join(':');
}

function buildDriverLiveMessage(
  eventName: (typeof liveEvents)[number],
  payload: { orderId?: string; orderReference?: string; restaurantName?: string; status?: string }
) {
  const orderLabel = payload.orderReference || payload.orderId || 'pedido';

  if (eventName === 'order:assigned') {
    return payload.restaurantName
      ? `Se te ha asignado el folio ${orderLabel} de ${payload.restaurantName}.`
      : `Nuevo pedido asignado: Folio ${orderLabel}.`;
  }

  if (eventName === 'order:preparing') {
    return `El folio ${orderLabel} sigue en proceso de preparación.`;
  }

  if (eventName === 'order:ready') {
    return `¡Folio ${orderLabel} listo! Pasa por él.`;
  }

  if (eventName === 'order:picked-up') {
    return `El folio ${orderLabel} fue recogido.`;
  }

  if (eventName === 'order:driver-rejected') {
    return `El folio ${orderLabel} fue desasignado o rechazado de tu ruta.`;
  }

  if (eventName === 'order:driver-auto-unassigned') {
    return `El folio ${orderLabel} fue desasignado porque no lo aceptaste a tiempo.`;
  }

  return `El folio ${orderLabel} ha finalizado su entrega con éxito.`;
}

function getDriverActions(
  status: OrderStatus,
  availability?: DriverAvailability
): Array<keyof typeof driverActionMap> {
  if ((status === 'CONFIRMED' || status === 'PREPARING') && availability === 'AVAILABLE') {
    return ['accept', 'reject'];
  }

  if (status === 'READY') {
    if (availability === 'AVAILABLE') {
      return ['reject', 'pickedUp'];
    }
    return ['pickedUp'];
  }

  if (status === 'PICKED_UP') {
    return ['inTransit'];
  }

  if (status === 'IN_TRANSIT') {
    return ['arrived', 'delivered'];
  }

  return [];
}

function formatAddress(address?: DriverOrder['address']) {
  if (!address) {
    return 'Ubicación no proporcionada.';
  }

  return `${address.street} ${address.number}, Col. ${address.neighborhood}`;
}

function formatCoordinate(value?: number | null) {
  return typeof value === 'number' ? value.toFixed(5) : 'Esperando GPS';
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

// Marca de tiempo de llegada al domicilio para la cuenta regresiva.
// Prioriza el timestamp del backend (order.driverArrivedAtCustomer) y como
// respaldo usa el tracking "DRIVER_ARRIVED" (sobrevive a recargas).
function getCustomerArrivalTime(order: DriverOrder): number | null {
  if (order.driverArrivedAtCustomer) {
    return new Date(order.driverArrivedAtCustomer).getTime();
  }
  const arrivalTracking = order.tracking?.find((t) => t.notes === 'DRIVER_ARRIVED');
  if (arrivalTracking?.createdAt) {
    return new Date(arrivalTracking.createdAt).getTime();
  }
  return null;
}

function formatCountdown(ms: number) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(date));
}

function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function paymentMethodLabel(method?: string): string {
  switch (method) {
    case 'CASH': return 'Efectivo';
    case 'TRANSFER': return 'Transferencia';
    case 'CREDIT_CARD': return 'Tarjeta de Crédito';
    case 'DEBIT_CARD': return 'Tarjeta de Débito';
    case 'DIGITAL_WALLET': return 'Billetera Digital';
    default: return 'Efectivo';
  }
}

function PasswordToggleButton({ show, onToggle }: { show: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
      tabIndex={-1}
      className="absolute right-2 inset-y-0 my-auto flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors duration-200 hover:bg-surface-2 hover:text-foreground dark:hover:bg-zinc-800 dark:hover:text-zinc-100 active:scale-95"
    >
      {show ? (
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.5"
            d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"
          />
        </svg>
      ) : (
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.5"
            d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      )}
    </button>
  );
}
