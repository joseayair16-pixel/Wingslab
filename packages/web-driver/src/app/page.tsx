'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SaDelLogo } from '../components/SaDelLogo';
import { IncomingOrderModal } from '../components/IncomingOrderModal';
import { io } from 'socket.io-client';
import {
  AuthResponse,
  AuthUser,
  clearStoredSession,
  getRequestErrorMessage,
  isAuthRequestError,
  isTransientRequestError,
  persistApiBase,
  persistStoredSession,
  readStoredSession,
  requestJson,
  convertImageFileToDataUrl,
} from '@sadel/shared';

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
  isSuspendedByDebt?: boolean;
  suspendedDebtAmount?: number;
  user: {
    id: string;
    name: string;
    phone: string;
    region: string;
    status: string;
    profilePhoto?: string | null;
  };
};

type WalletData = {
  todayEarnings: number;
  todayTripsCount: number;
  weeklyEarnings: number;
  weeklyTripsCount: number;
  activeDebt: number;
  currentDebt: number;
  pastDebt: number;
  lastBillingSettledAt: string | null;
  recentDeliveries: Array<{
    id: string;
    orderReference: string;
    deliveryFee: number;
    deliveredAt: string;
  }>;
  recentSettlements?: Array<{
    id: string;
    reference: string;
    periodStart: string;
    periodEnd: string;
    dueDate: string | null;
    settledAt: string | null;
    amount: number;
    deliveredOrders: number;
    deliveredRevenue: number;
    platformFeeTotal: number;
    status: string;
    paymentProofUrl?: string | null;
    notes?: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  hasPendingSettlement?: boolean;
  pendingSettlementDueDate?: string | null;
  nextCutoffDate?: string | null;
  nextCutoffLabel?: string | null;
  nextSuspensionDate?: string | null;
};

type WalletChartData = {
  weekStart: string;
  weekEnd: string;
  chartData: Array<{
    label: string;
    date: string;
    earnings: number;
    trips: number;
  }>;
};

type DebtOrder = {
  id: string;
  orderReference: string;
  deliveredAt: string;
  driverPlatformFee: number;
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
  'order:delivered',
] as const;

const availabilityOptions: Array<{ label: string; value: DriverAvailability; description: string }> = [
  {
    label: 'Conectado',
    value: 'AVAILABLE',
    description: 'Disponible para recibir y operar pedidos asignados en tu zona.',
  },
  {
    label: 'Desconectado',
    value: 'OFFLINE',
    description: 'Fuera de servicio. No recibirás notificaciones ni pedidos asignados.',
  },
];

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
  const [driverProfile, setDriverProfile] = useState<DriverProfile | null>(null);
  const [pendingOrders, setPendingOrders] = useState<DriverOrder[]>([]);
  const [historyOrders, setHistoryOrders] = useState<DriverOrder[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [loadingMoreHistory, setLoadingMoreHistory] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<'day' | 'week' | 'month' | 'all'>('all');
  const [historySubTab, setHistorySubTab] = useState<'orders' | 'payments'>('orders');
  const [selectedHistoryOrder, setSelectedHistoryOrder] = useState<DriverOrder | null>(null);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [updatingAvailability, setUpdatingAvailability] = useState<DriverAvailability | null>(null);
  const [activeActionKey, setActiveActionKey] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [driverWelcomeImage, setDriverWelcomeImage] = useState<string>('');

  useEffect(() => {
    if (!token) {
      fetch(`${apiBase}/settings`)
        .then(res => res.json())
        .then(data => {
          if (data.success && data.data.driverWelcomeImage) {
            setDriverWelcomeImage(data.data.driverWelcomeImage);
          }
        })
        .catch(console.error);
    }
  }, [token, apiBase]);

  // Pull to refresh
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const touchStartY = useRef(0);

  // UI States
  const [activeTab, setActiveTab] = useState<'active' | 'history' | 'wallet' | 'profile'>('active');
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);
  const [walletData, setWalletData] = useState<WalletData | null>(null);
  const [walletWeekOffset, setWalletWeekOffset] = useState(0);
  const [walletChartData, setWalletChartData] = useState<WalletChartData | null>(null);
  const [selectedChartDay, setSelectedChartDay] = useState<number | null>(null);
  const [loadingChart, setLoadingChart] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showDeveloperSettings, setShowDeveloperSettings] = useState(false);
  const [showWeeklyEarnings, setShowWeeklyEarnings] = useState(true);
  const [darkMode, setDarkMode] = useState(false);

  const [showDebtModal, setShowDebtModal] = useState(false);
  const [debtModalMode, setDebtModalMode] = useState<'past' | 'current'>('past');
  const [hideSuspensionOverlay, setHideSuspensionOverlay] = useState(false);
  const [loadingDebtDetails, setLoadingDebtDetails] = useState(false);
  const [driverSettlements, setDriverSettlements] = useState<any[]>([]);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [proofPreviewBase64, setProofPreviewBase64] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [debtDetails, setDebtDetails] = useState<{ pastOrders: DebtOrder[], pastDebt: number, currentOrders: DebtOrder[], currentDebt: number, totalDebt: number } | null>(null);
  const [debtModalError, setDebtModalError] = useState(false);

  // Pay modal state
  const [showPayModal, setShowPayModal] = useState(false);
  const [adminBankName, setAdminBankName] = useState('');
  const [adminBankAccount, setAdminBankAccount] = useState('');
  const [adminBankBeneficiary, setAdminBankBeneficiary] = useState('');
  const [bankDetailsLoaded, setBankDetailsLoaded] = useState(false);
  const [bankDetailsError, setBankDetailsError] = useState(false);
  // Payment history modal state
  const [showSettlementDetailModal, setShowSettlementDetailModal] = useState(false);
  const [selectedSettlement, setSelectedSettlement] = useState<any | null>(null);
  const [settlementPeriodOrders, setSettlementPeriodOrders] = useState<any[]>([]);
  const [loadingSettlementOrders, setLoadingSettlementOrders] = useState(false);
  // Proof image modal
  const [showProofModal, setShowProofModal] = useState(false);
  const [showProofSentModal, setShowProofSentModal] = useState(false);
  const [proofImageUrl, setProofImageUrl] = useState('');

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

  const orderRefMap = useMemo(() => {
    const map = new Map<string, DriverOrder>();
    for (const o of historyOrders) {
      if (o.orderReference && !map.has(o.orderReference)) {
        map.set(o.orderReference, o);
      }
    }
    return map;
  }, [historyOrders]);

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
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  // React PIN Modal States
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinModalOrderId, setPinModalOrderId] = useState('');
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
  const [tripStartedForOrderId, setTripStartedForOrderId] = useState<string | null>(null);

  const [socketStatus, setSocketStatus] = useState<'idle' | 'connecting' | 'connected' | 'reconnecting'>('idle');
  const [socketAttempts, setSocketAttempts] = useState(0);
  const [lastFailedAction, setLastFailedAction] = useState<DriverRetryAction | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [error, setError] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const seenLiveEventKeysRef = useRef<string[]>([]);
  const activeTabRef = useRef(activeTab);
  const pendingOrdersRef = useRef(pendingOrders);
  pendingOrdersRef.current = pendingOrders;
  const driverProfileRef = useRef(driverProfile);
  driverProfileRef.current = driverProfile;
  const gpsRescheduleRef = useRef<(() => void) | null>(null);

  // Refs de audio de alarma estilo Uber y Screen Wake Lock
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wakeLockRef = useRef<any>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const audioArrayBufferRef = useRef<ArrayBuffer | null>(null);
  const alarmSourceRef = useRef<AudioBufferSourceNode | null>(null);

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

  // Screen Wake Lock API para mantener la pantalla encendida cuando está disponible
  useEffect(() => {
    async function requestWakeLock() {
      if (typeof window !== 'undefined' && 'wakeLock' in navigator && driverProfile?.availability === 'AVAILABLE') {
        try {
          if (!wakeLockRef.current) {
            wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
            console.log('[WakeLock] Screen Wake Lock holds successfully.');
          }
        } catch (err) {
          console.warn('[WakeLock] Failed to request screen wake lock:', err);
        }
      }
    }

    async function releaseWakeLock() {
      if (wakeLockRef.current) {
        try {
          await wakeLockRef.current.release();
          wakeLockRef.current = null;
          console.log('[WakeLock] Screen Wake Lock released successfully.');
        } catch (err) {
          console.error('[WakeLock] Error releasing screen wake lock:', err);
        }
      }
    }

    if (driverProfile?.availability === 'AVAILABLE') {
      void requestWakeLock();
    } else {
      void releaseWakeLock();
    }

    return () => {
      if (wakeLockRef.current) {
        void releaseWakeLock();
      }
    };
  }, [driverProfile?.availability]);

  // Precargar el MP3 al montar (sin crear AudioContext; eso requiere gesto del usuario)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    fetch('/sounds/notifica.wav')
      .then((res) => res.arrayBuffer())
      .then((buffer) => {
        audioArrayBufferRef.current = buffer;
      })
      .catch(() => {
        console.warn('[Audio] No se pudo precargar notifica.wav, se usará fallback <audio>');
      });

    return () => {
      audioArrayBufferRef.current = null;
      audioBufferRef.current = null;
    };
  }, []);

  async function ensureAudioContextReady() {
    if (typeof window === 'undefined') return null;
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return null;

    let ctx = audioCtxRef.current;
    if (!ctx) {
      ctx = new AudioCtx();
      audioCtxRef.current = ctx;
    }

    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        return ctx;
      }
    }

    if (!audioBufferRef.current && audioArrayBufferRef.current) {
      try {
        const decoded = await ctx.decodeAudioData(audioArrayBufferRef.current.slice(0));
        audioBufferRef.current = decoded;
      } catch {
        // Si falla el decode, seguimos con fallback <audio>
      }
    }

    // Exponer en window para IncomingOrderModal
    if (typeof window !== 'undefined') {
      (window as any).__sadelAudioCtx = ctx;
      (window as any).__sadelAudioBuffer = audioBufferRef.current;
    }

    return ctx;
  }

  function playAlarmSound() {
    // Asegurar que no haya dos alarmas superpuestas
    stopAlarmSound(alarmSourceRef.current);

    // Intentar con Web Audio API (buffer precargado)
    const ctx = audioCtxRef.current;
    const buf = audioBufferRef.current;
    if (ctx && buf) {
      ctx.resume();
      const source = ctx.createBufferSource();
      source.buffer = buf;
      source.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 1.0;
      source.connect(gain);
      gain.connect(ctx.destination);
      source.start(0);
      alarmSourceRef.current = source;
      return source;
    }
    // Fallback: <audio> element
    const audioEl = document.getElementById('driver-alert-audio') as HTMLAudioElement | null;
    if (audioEl) {
      audioEl.loop = true;
      audioEl.volume = 1.0;
      audioEl.play().catch(() => {});
    }
    return null;
  }

  function stopAlarmSound(sourceNode: AudioBufferSourceNode | null) {
    if (sourceNode) {
      try { sourceNode.stop(); } catch (e) { /* ya terminó */ }
    }
    if (alarmSourceRef.current === sourceNode) {
      alarmSourceRef.current = null;
    }
    const audioEl = document.getElementById('driver-alert-audio') as HTMLAudioElement | null;
    if (audioEl) {
      audioEl.pause();
      audioEl.currentTime = 0;
    }
  }

  // Alarma acústica (bucle sonar Uber) y vibración periódica ante nueva asignación
  useEffect(() => {
    let vibrationInterval: NodeJS.Timeout | null = null;
    let sourceNode: AudioBufferSourceNode | null = null;
    let cancelled = false;

    if (pendingAssignedOrder) {
      if (process.env.NODE_ENV !== 'production') {
        console.log('[Alarm] New order assigned pending acceptance:', pendingAssignedOrder.id);
      }

      // Ensure AudioContext is ready before playing alarm
      void ensureAudioContextReady().finally(() => {
        if (cancelled) return;
        sourceNode = playAlarmSound();
      });

      // Vibración física repetitiva en dispositivos Android
      if (typeof window !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate([850, 450, 850, 450]);
        vibrationInterval = setInterval(() => {
          if (typeof window !== 'undefined' && 'vibrate' in navigator) {
            navigator.vibrate([850, 450, 850, 450]);
          }
        }, 2500);
      }

      // Respaldo: notificación del sistema vía Service Worker.
      // Nota: si la app está en primer plano, el sonido del OS + mp3 se duplican.
      // Por eso, solo mostramos notificación cuando la app está en segundo plano.
      if (document.visibilityState === 'hidden' && 'serviceWorker' in navigator && navigator.serviceWorker.controller) {
        try {
          navigator.serviceWorker.controller.postMessage({
            type: 'SHOW_NOTIFICATION',
            title: 'Nueva solicitud de entrega 🛵',
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
      stopAlarmSound(null);
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
      cancelled = true;
      stopAlarmSound(sourceNode);
      // Por seguridad, detener cualquier fuente activa (evita duplicados por callbacks async)
      stopAlarmSound(alarmSourceRef.current);
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

  // Reintentar sonido al volver a la pestaña SOLO si el pedido sigue sin aceptar
  useEffect(() => {
    if (!pendingAssignedOrder) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        const ctx = audioCtxRef.current;
        if (ctx && ctx.state === 'suspended') {
          ctx.resume();
        }
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [pendingAssignedOrder?.id, pendingAssignedOrder?.isAcceptedByDriver]);

  function warmupAudioContext() {
    // Solo se debe llamar desde un gesto del usuario (click/touch).
    void ensureAudioContextReady().then((ctx) => {
      if (!ctx) return;
      if (ctx.state !== 'running') return;
      // Crear y descartar un nodo silencioso para “desbloquear” algunos navegadores
      try {
        const silent = ctx.createOscillator();
        silent.frequency.value = 0;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        silent.connect(gain);
        gain.connect(ctx.destination);
        silent.start();
        silent.stop(0.01);
      } catch {
        // ignore
      }
    });
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    // Precalentar AudioContext para que suene en background sin restricción de autoplay
    warmupAudioContext();

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
      const isDark = window.localStorage.getItem('darkMode') === 'true';
      setDarkMode(isDark);
      if (isDark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }

      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').then((registration) => {
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

  function persistSession(nextToken: string, user: AuthUser) {
    setToken(nextToken);
    setSessionUser(user);
    persistStoredSession({
      storageKey,
      apiBase,
      token: nextToken,
      user,
    });
  }

  function clearSession(message?: string) {
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

      persistSession(payload.data.token, payload.data.user);
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
        requestJson<SuccessResponse<WalletData>>({
          apiBase,
          path: '/driver-panel/billetera',
          token,
          fallbackMessage: 'No se pudo cargar la billetera.',
          retry: {
            attempts: 2,
            backoffMs: 350,
          },
        }),
        requestJson<SuccessResponse<any[]>>({
          apiBase,
          path: '/driver-panel/billetera/settlements',
          token,
          fallbackMessage: 'No se pudieron cargar los comprobantes.',
        }).catch(() => ({ success: true, data: [] })),
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
      const walletData = requestData(results[3] as PromiseSettledResult<SuccessResponse<WalletData>>, null);
      const settlementsPayload = fulfill(results[4] as PromiseSettledResult<SuccessResponse<any[]>>, null);

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
      setWalletData(walletData);
      setDriverSettlements(
        walletData?.recentSettlements ||
        (settlementsPayload?.success ? settlementsPayload.data : []) ||
        []
      );
      setDeliveryPinInput('');
      setDeliveryPinError('');

      if (profileData?.isSuspendedByDebt && (activeTabRef.current !== 'active' && activeTabRef.current !== 'wallet')) {
        setActiveTab('wallet');
      }

      if (hadFailures) {
        pushToast('error', 'Sincronización parcial', 'Algunos datos no pudieron cargarse.');
      }
    } catch (requestError) {
      setDriverProfile(null);
      setPendingOrders([]);
      setHistoryOrders([]);
      setWalletData(null);
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

  const fetchWalletChartData = useCallback(async (offset: number) => {
    if (!token) return;
    setLoadingChart(true);
    setSelectedChartDay(null);
    try {
      const response = await requestJson<SuccessResponse<WalletChartData>>({
        apiBase,
        path: `/driver-panel/billetera/grafica?weekOffset=${offset}`,
        token,
        fallbackMessage: 'Error cargando gráfica.',
      });
      setWalletChartData(response.data);
    } catch (err) {
      console.error(err);
      pushToast('error', 'Error', 'No se pudo cargar la gráfica.');
    } finally {
      setLoadingChart(false);
    }
  }, [token, apiBase]);

  const openDebtModal = async (mode: 'past' | 'current') => {
    setShowDebtModal(true);
    setDebtModalMode(mode);
    setLoadingDebtDetails(true);
    setDebtModalError(false);
    try {
      const response = await requestJson<SuccessResponse<{ pastOrders: DebtOrder[], pastDebt: number, currentOrders: DebtOrder[], currentDebt: number, totalDebt: number }>>({
        apiBase,
        path: '/driver-panel/billetera/deuda',
        token,
      });
      if (response.success) {
        setDebtDetails(response.data);
      } else {
        setDebtModalError(true);
      }
    } catch (e) {
      console.error(e);
      setDebtModalError(true);
    } finally {
      setLoadingDebtDetails(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'wallet') {
      void fetchWalletChartData(walletWeekOffset);
    }
  }, [activeTab, walletWeekOffset, fetchWalletChartData]);

  const subscribeToPush = useCallback(async (tokenToUse: string) => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('Notification' in window)) return;

    try {
      const registration = await navigator.serviceWorker.ready;

      if (Notification.permission === 'default') {
        await Notification.requestPermission();
      }

      if (Notification.permission !== 'granted') {
        console.warn('Notification permission not granted');
        return;
      }

      const response = await fetch(`${apiBase}/notifications/vapid-key`);
      const data = await response.json();
      const publicKey = data.publicKey;

      if (!publicKey) {
        console.warn('No VAPID public key returned from backend');
        return;
      }

      const existingSub = await registration.pushManager.getSubscription();
      if (existingSub) {
        await existingSub.unsubscribe();
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });

      await fetch(`${apiBase}/notifications/subscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenToUse}`
        },
        body: JSON.stringify(subscription)
      });

      if (process.env.NODE_ENV !== 'production') {
        console.log('Subscribed to push notifications');
      }
    } catch (error) {
      console.error('Failed to subscribe to push:', error);
    }
  }, [apiBase]);

  useEffect(() => {
    if (token && sessionUser && sessionUser.role === 'DRIVER') {
      void subscribeToPush(token);
    }
  }, [token, sessionUser, subscribeToPush]);

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
      const deltaLat = Math.abs(lat - lastPosition.lat);
      const deltaLng = Math.abs(lng - lastPosition.lng);
      return !(deltaLat < 0.00015 && deltaLng < 0.00015);
    };

    const postLocation = async (lat: number, lng: number) => {
      const now = Date.now();
      if (now - lastPostAt < 15000) return;
      lastPostAt = now;

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
      } catch {
        // Error de red/backend: no es un fallo de GPS.
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

      lastPosition = { lat, lng };
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
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && !window.location.hostname.includes('192.168.') ? 'https://sadel-production.up.railway.app' : '');
    const socket = io(apiUrl || '', {
      path: apiUrl ? '/socket.io' : '/api/socket.io',
      transports: apiUrl ? ['websocket', 'polling'] : ['polling'],
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 30000,
    });

    let healthCheckInterval: any;
    let lastEventTime = Date.now();
    // Debounce para eventos no críticos: evita recargas en ráfaga
    let refreshDebounceTimer: any = null;
    const debouncedRefresh = () => {
      if (refreshDebounceTimer) return;
      refreshDebounceTimer = setTimeout(() => {
        refreshDebounceTimer = null;
        void loadDashboard();
      }, 3000);
    };

    socket.on('connect', () => {
      setSocketStatus('connected');
      setSocketAttempts(0);
      lastEventTime = Date.now();
      socket.emit('join-room', sessionUser.id, 'DRIVER');
      void loadDashboard();
      void loadPendingOrders();
    });

    socket.io.on('reconnect_attempt', (attempt) => {
      setSocketStatus('reconnecting');
      setSocketAttempts(attempt);
    });

    socket.on('reconnect', () => {
      // Reconexión exitosa: forzar recarga de pedidos pendientes
      lastEventTime = Date.now();
      void loadPendingOrders();
      void loadDashboard();
    });

    socket.on('disconnect', (reason) => {
      if (reason !== 'io client disconnect') {
        setSocketStatus('reconnecting');
        return;
      }
      setSocketStatus('idle');
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
      // Pedido entrante es crítico: refrescar sin debounce
      void loadPendingOrders();
      void loadDashboard();
    });

    // Handler GENERAL para el resto de eventos en vivo
    for (const eventName of liveEvents) {
      if (eventName === 'order:assigned') continue; // ya se manejó arriba
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
      pushToast('success', '✅ Pago confirmado', isStore ? 'La tienda confirmó el pago. Ya puedes iniciar el viaje.' : 'El restaurante confirmó el pago. Ya puedes iniciar el viaje.');
      debouncedRefresh();
    });

    // Actualizar status del pedido en tiempo real (ej. READY → PICKED_UP cuando restaurante confirma entrega)
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
      pushToast('info', '🔄 Nuevo PIN generado', 'El PIN anterior expiró. Muestra este nuevo PIN al restaurante.');
    });

    return () => {
      clearInterval(healthCheckInterval);
      if (refreshDebounceTimer) clearTimeout(refreshDebounceTimer);
      socket.offAny(markEvent);
      socket.emit('leave-room', sessionUser.id, 'DRIVER');
      socket.disconnect();
      setSocketStatus('idle');
      setSocketAttempts(0);
    };
  }, [apiBase, loadDashboard, loadPendingOrders, sessionUser, token]);

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

  // Abre el hermoso modal nativo en React para la recolección
  const openPinModal = (orderId: string) => {
    triggerHaptic(40);
    setPinModalOrderId(orderId);
    setPinInput('');
    setPinModalError('');
    setShowPinModal(true);
  };

  async function retryLastFailedAction() {
    if (!lastFailedAction) return;

    if (lastFailedAction.kind === 'availability') {
      await updateAvailability(lastFailedAction.availability);
      return;
    }
    await runDriverAction(lastFailedAction.orderId, lastFailedAction.actionKey);
  }

  const socketStatusLabel = socketStatusCopy[socketStatus];

  // Settlement detail modal
  const openSettlementDetailModal = async (settlement: any) => {
    setSelectedSettlement(settlement);
    setShowSettlementDetailModal(true);
    setLoadingSettlementOrders(true);
    try {
      const periodStart = settlement.periodStart ? new Date(settlement.periodStart).toISOString() : '';
      const periodEnd = settlement.periodEnd ? new Date(settlement.periodEnd).toISOString() : '';
      const res = await requestJson<{ success: boolean; data: { orders: any[]; totalDebt: number } }>({
        apiBase,
        path: `/driver-panel/billetera/periodo-actual/pedidos?periodStart=${encodeURIComponent(periodStart)}&periodEnd=${encodeURIComponent(periodEnd)}`,
        token,
      });
      if (res.success) {
        setSettlementPeriodOrders(res.data.orders);
      } else {
        setSettlementPeriodOrders([]);
      }
    } catch {
      setSettlementPeriodOrders([]);
      pushToast('error', 'Error', 'No se pudieron cargar los pedidos del periodo.');
    } finally {
      setLoadingSettlementOrders(false);
    }
  };

  // Pay modal: load admin bank details and open
  const openPayModal = useCallback(async () => {
    setShowPayModal(true);
    setProofPreviewBase64(null);
    setBankDetailsLoaded(false);
    setBankDetailsError(false);
    try {
      const res = await requestJson<{ success: boolean; data: { adminBankName: string; adminBankAccount: string; adminBankBeneficiary: string } }>({
        apiBase,
        path: '/settings',
        token,
      });
      if (res.success) {
        setAdminBankName(res.data.adminBankName);
        setAdminBankAccount(res.data.adminBankAccount);
        setAdminBankBeneficiary(res.data.adminBankBeneficiary);
        setBankDetailsLoaded(true);
      } else {
        setBankDetailsError(true);
      }
    } catch {
      setBankDetailsError(true);
    }
  }, [apiBase, token]);

  // ==========================================
  // PANTALLA 1: AUTENTICACIÓN (LOGIN) REDISEÑADO
  // ==========================================
  if (isCheckingSession) {
    return (
      <main className="min-h-screen bg-[#fbf8f1] dark:bg-black font-sans text-neutral-900 dark:text-zinc-100 flex items-center justify-center">
        <div className="animate-pulse opacity-50">Cargando...</div>
      </main>
    );
  }

  if (!token || !sessionUser) {
    return (
      <main 
        className="min-h-screen flex flex-col justify-between bg-[#f5f1e8] text-neutral-900 transition-colors duration-300 dark:bg-black dark:text-zinc-100 font-sans antialiased relative"
        style={driverWelcomeImage ? {
          backgroundImage: `linear-gradient(to bottom, rgba(0,0,0,0.6), rgba(0,0,0,0.8)), url(${driverWelcomeImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center'
        } : {}}
      >
        {/* Cabecera Técnica del Desarrollador (Login) */}
        <header className="px-6 py-4 flex justify-between items-center bg-transparent max-w-md mx-auto w-full z-10 relative">
          <div className="flex items-center gap-2">
            <SaDelLogo className="h-8 w-auto drop-shadow-md" forceDark={!!driverWelcomeImage} />
          </div>
        </header>

        <section className="w-full max-w-md mx-auto px-6 py-4 flex-1 flex flex-col justify-center">
          <div className="rounded-[36px] bg-white/90 p-8 backdrop-blur-xl dark:bg-zinc-950/80 shadow-[0_24px_80px_rgba(0,0,0,0.08)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.8)] transition duration-300 ring-1 ring-inset ring-black/5 dark:ring-white/5">
            <div className="text-center mb-8">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-[10px] font-black uppercase tracking-widest text-accent dark:bg-accent-hover/20 dark:text-sky-300">
                <span className="h-1.5 w-1.5 rounded-full bg-accent-hover animate-pulse" />
                Acceso Repartidor
              </span>
              <h1 className="text-3xl font-black tracking-tight text-neutral-900 dark:text-zinc-50 mt-4">
                Bienvenido a SaDeL
              </h1>
              <p className="text-sm font-medium text-neutral-500 dark:text-zinc-400 mt-2 leading-relaxed">
                Ingresa con tu número y contraseña para comenzar a recibir pedidos.
              </p>
            </div>

            <div className="space-y-5">
              <label className="block space-y-2">
                <span className="text-xs font-bold uppercase tracking-widest text-neutral-500 dark:text-zinc-400">Teléfono Celular</span>
                <div className="relative flex items-center">
                  <span className="absolute left-5 text-sm font-bold text-neutral-400">+52</span>
                  <input
                    type="tel"
                    placeholder="55 1234 5678"
                    className="w-full rounded-[20px] border-0 bg-neutral-100/80 px-4 py-4 pl-14 text-[15px] font-medium text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:bg-white focus:ring-2 focus:ring-accent dark:bg-zinc-900/80 dark:text-zinc-50 dark:focus:bg-zinc-900"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
              </label>

              <label className="block space-y-2">
                <span className="text-xs font-bold uppercase tracking-widest text-neutral-500 dark:text-zinc-400">Contraseña</span>
                <div className="relative flex items-center">
                  <input
                    type="password"
                    placeholder="••••••••••••"
                    className="w-full rounded-[20px] border-0 bg-neutral-100/80 px-5 py-4 text-[15px] font-medium text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:bg-white focus:ring-2 focus:ring-accent dark:bg-zinc-900/80 dark:text-zinc-50 dark:focus:bg-zinc-900"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </label>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => void loginWithPassword()}
                  disabled={verifyingCode || phone.trim().length < 8 || password.trim().length < 4}
                  className="w-full rounded-[20px] bg-neutral-950 py-4.5 font-bold tracking-wide text-white text-[15px] shadow-lg shadow-neutral-900/20 hover:bg-neutral-800 active:scale-[0.98] transition-all disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:shadow-none dark:bg-accent-hover dark:text-white dark:hover:bg-sky-400 dark:shadow-accent/30 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-600 flex items-center justify-center gap-2"
                  style={{ paddingTop: '1.125rem', paddingBottom: '1.125rem' }}
                >
                  {verifyingCode ? (
                    <>
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white" />
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
                  ⚠️ {error}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Footer simple de marca */}
        <footer className="px-6 py-6 text-center text-[10px] uppercase font-bold tracking-widest text-neutral-400 dark:text-zinc-600 max-w-sm mx-auto">
          SaDeL Logistics · Pro Console v2.0
        </footer>

        {/* Modal de Configuración Técnica Ocultable */}
        {showDeveloperSettings && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-[32px] border border-black/5 bg-white p-6 shadow-2xl dark:bg-zinc-950 dark:border-zinc-900 animate-fadeIn">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-sm font-black uppercase tracking-wider">Configuración Técnica</h3>
                <button
                  type="button"
                  onClick={() => setShowDeveloperSettings(false)}
                  className="h-8 w-8 rounded-full flex items-center justify-center border border-black/5 dark:border-zinc-900 bg-neutral-50 dark:bg-zinc-900"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-4">
                <label className="block space-y-1.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-neutral-500">API Endpoint Base</span>
                  <input
                    type="text"
                    value={apiBase}
                    onChange={(e) => setApiBase(e.target.value)}
                    placeholder="/api"
                    className="w-full rounded-xl border border-black/5 bg-neutral-50 px-4 py-3 text-xs outline-none focus:border-neutral-300 dark:bg-zinc-900 dark:border-zinc-800 dark:focus:border-zinc-700"
                  />
                </label>

                <p className="text-[10px] text-neutral-500 leading-relaxed">
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
  const handleSelectPaymentProof = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const dataUrl = await convertImageFileToDataUrl(file, 900, 900, 0.7);
      setProofPreviewBase64(dataUrl);
    } catch (err) {
      pushToast('error', 'Error', err instanceof Error ? err.message : 'No se pudo procesar la imagen. Formatos permitidos: JPG, PNG, HEIC.');
      setUploadingProof(false);
    }
  };

  const handleSubmitPaymentProof = async () => {
    if (!proofPreviewBase64) return;
    setUploadingProof(true);
    try {
      const uploadPayload = await requestJson<{ success: boolean; data: { url: string } }>({
        apiBase,
        path: '/uploads/images',
        token,
        options: { method: 'POST', body: JSON.stringify({ kind: 'payment-proof', source: proofPreviewBase64 }) },
        fallbackMessage: 'No se pudo subir la imagen.'
      });
      if (uploadPayload.success && uploadPayload.data?.url) {
        const settlementPayload = await requestJson<{ success: boolean; data: any }>({
          apiBase,
          path: '/driver-panel/billetera/settlements',
          token,
          options: { method: 'POST', body: JSON.stringify({ paymentProofUrl: uploadPayload.data.url }) },
          fallbackMessage: 'No se pudo registrar el comprobante.'
        });
        if (settlementPayload.success) {
          setProofPreviewBase64(null);
          setShowPayModal(false);
          setShowProofSentModal(true);
          loadDashboard();
        }
      }
    } catch {
      pushToast('error', 'Error', 'Error al subir el comprobante.');
    } finally {
      setUploadingProof(false);
    }
  };

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
      className={`min-h-screen bg-[#f5f1e8] text-neutral-900 transition-colors duration-300 dark:bg-black dark:text-zinc-300 font-sans antialiased select-none overflow-x-hidden ${activeTab === 'active' ? 'pb-20' : ''}`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onClick={warmupAudioContext}
    >
      {/* BARRA DE CONEXIÓN PERDIDA */}
        {!isOnline && (
          <div className="sticky top-0 z-[9999] bg-gradient-to-r from-rose-600 to-rose-500 dark:from-rose-800 dark:to-rose-700 text-white shadow-lg">
            <div className="max-w-md mx-auto flex items-center gap-3 px-4 py-2.5">
              <div className="h-7 w-7 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                <svg className="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728m-2.829-2.829a5 5 0 000-7.07m-4.243 4.243a1 1 0 010-1.414" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v.01M12 9v3" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-extrabold leading-tight">Sin conexión a Internet</p>
                <p className="text-[11px] text-rose-100 leading-tight mt-0.5">No recibirás pedidos nuevos hasta que te reconectes.</p>
              </div>
              <div className="h-2 w-2 rounded-full bg-white/80 animate-pulse shrink-0" />
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
          <div className="w-full max-w-xs rounded-[32px] bg-white dark:bg-zinc-950 shadow-2xl p-8 flex flex-col items-center text-center animate-in zoom-in-90 duration-300">
            {/* Checkmark animated */}
            <div className="relative mb-5">
              <div className="h-20 w-20 rounded-full bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center">
                <svg className="w-10 h-10 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <span className="absolute -top-1 -right-1 text-2xl animate-bounce">🛵</span>
            </div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-500 dark:text-emerald-400 mb-1">¡Todo listo!</p>
            <h3 className="text-xl font-black text-neutral-900 dark:text-zinc-50 leading-snug">Recolectado con éxito</h3>
            <p className="text-sm text-neutral-500 dark:text-zinc-400 mt-2 leading-relaxed max-w-[220px]">
              Dirígete al lugar de entrega y completa el pedido.
            </p>
            <div className="mt-6 w-full h-1 rounded-full bg-neutral-100 dark:bg-zinc-800 overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full animate-[shrink_4s_linear_forwards]" style={{ animation: 'shrink 4s linear forwards', width: '100%' }} />
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE DETALLES DEL PEDIDO PARA VERIFICAR EN TIENDA */}

      {selectedOrderDetail && (
        <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-md rounded-[32px] bg-white shadow-2xl overflow-hidden dark:bg-zinc-950 p-6 flex flex-col max-h-[85vh] animate-in slide-in-from-bottom-10 duration-300">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-neutral-100 dark:border-zinc-900 pb-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-400 dark:text-zinc-500">Verificación de Pedido</p>
                <h3 className="text-lg font-black text-neutral-900 dark:text-zinc-50 mt-0.5">#{selectedOrderDetail.orderReference.substring(0, 8)}</h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(10);
                  setSelectedOrderDetail(null);
                }}
                className="h-8 w-8 rounded-full bg-neutral-100 dark:bg-zinc-900 flex items-center justify-center text-sm font-black text-neutral-500 hover:bg-neutral-200 transition text-neutral-900 dark:text-zinc-50"
              >
                ✕
              </button>
            </div>

            {/* Content (Scrollable list of items) */}
            <div className="flex-grow overflow-y-auto py-4 space-y-4 pr-1">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-400 dark:text-zinc-500 mb-1">{selectedOrderDetail.restaurant.businessType && selectedOrderDetail.restaurant.businessType !== 'RESTAURANT' ? 'Tienda' : 'Restaurante'}</p>
                <p className="text-sm font-black text-neutral-800 dark:text-zinc-200">{selectedOrderDetail.restaurant.name}</p>
              </div>

              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-400 dark:text-zinc-500 mb-2">Artículos a entregar</p>
                {selectedOrderDetail.items && selectedOrderDetail.items.length > 0 ? (
                  <div className="divide-y divide-neutral-100 dark:divide-zinc-900/60 border border-neutral-100 dark:border-zinc-900/80 rounded-2xl overflow-hidden bg-neutral-50/50 dark:bg-zinc-900/20">
                    {selectedOrderDetail.items.map((item) => (
                      <div key={item.id} className="p-4 space-y-1">
                        <div className="flex items-start gap-3">
                          {item.product.image && (
                            <div className="shrink-0 w-12 h-12 rounded-xl overflow-hidden bg-neutral-100 dark:bg-zinc-800 border border-black/5">
                              <img
                                src={item.product.image}
                                alt={item.product.name}
                                className="w-full h-full object-cover"
                                loading="lazy"
                                decoding="async"
                              />
                            </div>
                          )}
                          <p className="text-sm font-black text-neutral-800 dark:text-zinc-200 leading-snug pt-0.5">
                            <span className="inline-block px-1.5 py-0.5 rounded bg-neutral-200 dark:bg-zinc-850 text-xs font-bold text-neutral-700 dark:text-zinc-300 mr-2">
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
                              <span key={opt.id} className="inline-block text-[10.5px] text-neutral-500 dark:text-zinc-400 font-medium">
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
                  <p className="text-xs text-neutral-400 dark:text-zinc-500 italic p-3 text-center border border-dashed border-neutral-200 dark:border-zinc-800 rounded-2xl">
                    No hay detalles de artículos disponibles para este pedido.
                  </p>
                )}
              </div>


            </div>

            {/* Footer */}
            <div className="pt-4 border-t border-neutral-100 dark:border-zinc-900 flex items-center justify-between gap-3">
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
                    <p className="text-[9px] font-bold uppercase tracking-widest text-neutral-400 dark:text-zinc-500 leading-none">A pagar en {selectedOrderDetail.restaurant.businessType && selectedOrderDetail.restaurant.businessType !== 'RESTAURANT' ? 'Tienda' : 'Restaurante'}</p>
                    <p className="text-xl font-black text-neutral-900 dark:text-white mt-1 leading-none">
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
        <div className="rounded-full bg-white dark:bg-zinc-950 p-2 shadow-lg border border-black/5 dark:border-zinc-900 flex items-center justify-center">
          <svg
            className={`h-5 w-5 text-neutral-700 dark:text-indigo-400 ${isRefreshing ? 'animate-spin' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            style={{ transform: isRefreshing ? 'none' : `rotate(${pullDistance * 4}deg)` }}
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </div>
      </div>

      {/* Toast notifications */}
      {toasts.length > 0 && (
        <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2 max-w-sm">
          {toasts.map((toast) => (
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
              <p className="font-bold">{toast.title}</p>
              {toast.message && <p className="mt-0.5 opacity-80">{toast.message}</p>}
              <button
                onClick={(e) => { e.stopPropagation(); dismissToast(toast.id); }}
                className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full text-current opacity-50 hover:opacity-100"
              >
                ✕
              </button>
            </div>
          ))}
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
          <div className="relative flex w-4/5 max-w-sm flex-col bg-[#fbf8f1] p-6 shadow-2xl dark:bg-zinc-950 dark:border-r dark:border-zinc-900 h-full animate-slideInLeft select-none text-neutral-900 dark:text-zinc-200">
            {/* Header / Profile info (clickable to account settings) */}
            <button
              type="button"
              onClick={() => {
                triggerHaptic(20);
                setActiveTab('profile');
                setIsMenuOpen(false);
              }}
              className="flex items-center text-left w-full gap-3 pb-6 border-b border-black/5 dark:border-zinc-900/80 hover:bg-neutral-500/10 p-2 -mx-2 rounded-2xl transition active:scale-[0.98]"
            >
              <div className="h-12 w-12 rounded-full bg-accent flex items-center justify-center text-white text-xl font-bold shadow-md shadow-accent/30 overflow-hidden shrink-0">
                {driverProfile?.user.profilePhoto ? (
                  <img src={driverProfile.user.profilePhoto} alt="Profile" className="h-full w-full object-cover" />
                ) : (
                  '👤'
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-black text-sm text-neutral-900 dark:text-white leading-tight truncate">
                  {driverProfile?.user.name || 'Cargando repartidor...'}
                </h3>
                {driverProfile && (
                  <div className="flex items-center gap-1.5 mt-1 text-[10px] font-bold text-neutral-500 dark:text-zinc-400">
                    <span>⭐ {driverProfile.rating.toFixed(1)}</span>
                    <span>•</span>
                    <span>💼 {driverProfile.totalDeliveries} viajes</span>
                  </div>
                )}
              </div>
              <span className="text-neutral-400 dark:text-zinc-500 text-xs font-bold">➔</span>
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
                    : 'hover:bg-black/5 dark:hover:bg-zinc-900 text-neutral-600 dark:text-zinc-400'
                  }`}
              >
                <span>🛵</span> Inicio
              </button>

              <button
                type="button"
                onClick={() => {
                  triggerHaptic(20);
                  setActiveTab('wallet');
                  setIsMenuOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-xs font-black uppercase tracking-wider transition ${activeTab === 'wallet'
                    ? 'bg-gradient-to-r from-sky-400 to-sky-600 text-white shadow-md shadow-sky-500/40'
                    : 'hover:bg-black/5 dark:hover:bg-zinc-900 text-neutral-600 dark:text-zinc-400'
                  }`}
              >
                <span>💳</span> Mi Billetera
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
                    : 'hover:bg-black/5 dark:hover:bg-zinc-900 text-neutral-600 dark:text-zinc-400'
                  }`}
              >
                <span>📅</span> Historial
              </button>

              <hr className="border-black/5 dark:border-zinc-900/80 my-4" />

              {/* Modo Oscuro Toggle */}
              <div className="flex items-center justify-between px-4 py-2 text-xs font-bold text-neutral-600 dark:text-zinc-400">
                <span className="flex items-center gap-3">
                  <span>🌙</span> Modo Oscuro
                </span>
                <button
                  type="button"
                  onClick={toggleDarkMode}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${darkMode ? 'bg-accent' : 'bg-neutral-300 dark:bg-zinc-800'
                    }`}
                >
                  <span
                    className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition ${darkMode ? 'translate-x-5' : 'translate-x-1'
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
                className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-xs font-bold text-neutral-600 dark:text-zinc-400 hover:bg-black/5 dark:hover:bg-zinc-900 transition"
              >
                <span>⚙️</span> Configuración de Red
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
                Cerrar Sesión ➔
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CABECERA PRINCIPAL (STICKY + BLUR) */}
      <header className="sticky top-0 z-40 border-b border-black/5 bg-[#fbf8f1]/90 dark:bg-black/90 dark:border-zinc-900/80 backdrop-blur-md px-6 py-6 transition">
        <div className="max-w-5xl mx-auto flex items-center justify-between w-full">
          {/* Superior Izquierda: Menu Hamburguesa */}
          <button
            type="button"
            onClick={() => {
              triggerHaptic(20);
              setIsMenuOpen(true);
            }}
            className="h-14 w-14 rounded-[20px] border border-black/5 dark:border-zinc-900 bg-white dark:bg-zinc-950 flex items-center justify-center shadow-md text-2xl text-neutral-800 dark:text-zinc-200 transition hover:scale-105 active:scale-95"
            aria-label="Menú principal"
          >
            ☰
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
                    Reintentar Acción ➔
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
                <p className="text-xs font-bold uppercase tracking-widest text-neutral-400 dark:text-zinc-500 mb-8">Servicio de Entrega Local</p>

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
                      <span className="text-xs font-bold text-neutral-500 dark:text-zinc-400">Buscando pedidos...</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-5 py-2 rounded-full bg-neutral-100 dark:bg-zinc-900 border border-neutral-200 dark:border-zinc-800">
                    <span className="flex h-2 w-2 rounded-full bg-neutral-400 dark:bg-zinc-500" />
                    <span className="text-xs font-black uppercase tracking-widest text-neutral-500 dark:text-zinc-400">Desconectado</span>
                  </div>
                )}

                {driverProfile?.availability !== 'AVAILABLE' && (
                  <p className="text-[11px] text-neutral-400 dark:text-zinc-500 mt-4 text-center max-w-[200px] leading-relaxed">
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

                    {/* QUEUE BADGE for non-active orders */}
                    {isQueued && (
                      <div className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-bold ${
                        isSameRestaurantBatch && (order.status === 'READY' || order.status === 'PICKED_UP' || order.status === 'IN_TRANSIT')
                          ? 'bg-neutral-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                          : isSameRestaurantBatch
                          ? 'bg-neutral-100 text-neutral-500 dark:bg-zinc-900 dark:text-zinc-400 border border-neutral-200 dark:border-zinc-800'
                          : 'bg-sky-900/10 text-sky-700 dark:text-sky-400 border border-sky-200 dark:border-sky-900/30'
                      }`}>
                        {isSameRestaurantBatch && order.status === 'READY'
                          ? <><span className="h-2 w-2 rounded-full bg-white dark:bg-zinc-900 animate-pulse inline-block" /> {isStore ? 'Misma tienda — recoger junto con el pedido activo' : 'Mismo restaurante — recoger junto con el pedido activo'}</>
                          : isSameRestaurantBatch && isDeliveryPhase
                          ? <><span className="h-2 w-2 rounded-full bg-white dark:bg-zinc-900 animate-pulse inline-block" /> Multi-ruta activa — {order.restaurant.name}</>
                          : isSameRestaurantBatch
                          ? <><span className="inline-block">⏳</span> Mismo restaurante — esperando a que esté listo</>
                          : <><span className="text-base">📍</span> Siguiente parada — {order.restaurant.name}</>
                        }
                      </div>
                    )}

                    {/* ═══════════════════════════════════════════════════
                        PEDIDO PRINCIPAL: FLUJO DE PANTALLA COMPLETA
                        ═══════════════════════════════════════════════════ */}
                    <div
                      className={
                        isQueued
                          ? `rounded-3xl bg-white dark:bg-zinc-950 border border-neutral-150 dark:border-zinc-800 overflow-hidden shadow-sm ${isQueueBlocked ? 'opacity-60' : ''}`
                          : `w-full bg-white dark:bg-zinc-950 border-0 flex-grow flex flex-col min-h-[calc(100vh-100px)] pb-[112px]`
                      }
                    >
                      {/* ─── FOLIO + STATUS ─── */}
                       <div className="px-5 pt-5 pb-3 flex items-start justify-between gap-3 border-b border-neutral-100 dark:border-zinc-800/80">
                          <div className="min-w-0 flex-1">
                            <p className="text-3xl font-black text-neutral-900 dark:text-zinc-50 leading-none tracking-tight">
                              Pedido #{order.dailyCounter || 'S/N'}
                            </p>
                            {order.customer.user?.name && (
                              <div className="flex items-center gap-2 mt-2">
                                <div className="flex items-center justify-center w-6 h-6 rounded-full bg-sky-100 dark:bg-sky-500/20 text-sky-600 dark:text-sky-400 shrink-0">
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                  </svg>
                                </div>
                                <p className="text-base font-bold text-neutral-700 dark:text-zinc-300 truncate">
                                  {order.customer.user.name}
                                </p>
                              </div>
                            )}
                            <p className="text-[11px] font-bold text-neutral-400 dark:text-zinc-500 mt-1.5 font-mono tracking-wide">
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
                                <p className="text-3xl font-black text-neutral-900 dark:text-zinc-50 leading-tight">
                                  {order.status === 'READY' ? 'Recoge el pedido' : isStore ? 'Dirígete a la tienda' : 'Dirígete al restaurante'}
                                </p>
                              </div>

                              {/* Restaurant header card */}
                              <div className="rounded-2xl bg-neutral-900 dark:bg-zinc-100 p-5 text-white dark:text-zinc-900 shadow-lg">
                                <div className="flex items-start gap-4">
                                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/20 dark:bg-zinc-900/20 text-2xl">
                                    🏪
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
                                  <a
                                    href={`https://www.google.com/maps/search/?api=1&query=${restaurantQuery}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => { e.stopPropagation(); triggerHaptic(20); }}
                                    className="flex items-center justify-center gap-2 py-3.5 rounded-2xl border border-neutral-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs font-bold text-neutral-700 dark:text-zinc-300 shadow-sm transition active:scale-[0.97]"
                                  >
                                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>
                                    Navegar
                                  </a>
                                )}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    triggerHaptic(10);
                                    setSelectedOrderDetail(order);
                                  }}
                                  className="flex items-center justify-center gap-2 py-3.5 rounded-2xl border border-neutral-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs font-bold text-neutral-700 dark:text-zinc-300 shadow-sm transition active:scale-[0.97]"
                                >
                                  <span>📋</span> Pedido
                                </button>
                              </div>

                              {/* Prep countdown card */}
                              {(() => {
                                if (order.status === 'READY') {
                                  return (
                                    <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/30 px-5 py-4 flex items-center gap-3">
                                      <span className="text-2xl">✅</span>
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
                                      <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 dark:text-zinc-500">Surtiendo tu pedido</p>
                                      <p className="text-sm font-black text-neutral-800 dark:text-zinc-200 mt-0.5">
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
                                      <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 dark:text-zinc-500">Recogiendo tu pedido</p>
                                      <p className="text-sm font-black text-neutral-800 dark:text-zinc-200 mt-0.5">
                                        {overdue ? `Debería estar listo (hace ${mins} min)` : `Aprox. ${mins} min`}
                                      </p>
                                    </div>
                                  );
                                }
                                if (prepDeadlineMs !== null) {
                                  return (
                                    <div className="rounded-2xl border border-amber-200 dark:border-amber-900/30 bg-amber-50 dark:bg-amber-950/20 px-5 py-4">
                                      <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 dark:text-zinc-500">Preparando tu pedido</p>
                                      <p className="text-sm font-black text-neutral-800 dark:text-zinc-200 mt-0.5">
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
                                      <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 dark:text-zinc-500">Preparando tu pedido</p>
                                      <p className="text-sm font-black text-neutral-800 dark:text-zinc-200 mt-0.5">
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
                                  className="w-full py-2.5 rounded-2xl text-sm font-bold text-neutral-400 dark:text-zinc-500 transition active:scale-[0.97] disabled:opacity-50 hover:text-rose-500"
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
                              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-2xl">
                                🏪
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
                            className="w-full py-3 rounded-2xl border border-neutral-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs font-bold text-neutral-600 dark:text-zinc-400 shadow-sm hover:bg-neutral-50 dark:hover:bg-zinc-800/80 transition active:scale-[0.97]"
                          >
                            <span>📋</span> Ver detalles del pedido
                          </button>

                          {/* Instruction */}
                          <div className="pb-1">
                            <p className="text-lg font-black text-neutral-900 dark:text-zinc-50 leading-tight">
                              {isCash ? 'Paga y recoge el pedido' : 'Muestra el PIN y recoge el pedido'}
                            </p>
                          </div>

                          {/* CASH: amount card */}
                          {isCash && order.totalAmount && (
                            <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/30 p-5">
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">{isStore ? 'Pagar en tienda' : 'Pagar al restaurante'}</p>
                                  <p className="text-3xl font-black text-neutral-900 dark:text-zinc-50 mt-0.5">{formatCurrency(batchTotalAmount)}</p>
                                </div>
                                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-200/60 dark:bg-emerald-800/40 text-emerald-600 dark:text-emerald-400 text-xl">
                                  💵
                                </div>
                              </div>
                            </div>
                          )}

                          {/* BATCH: list of orders included in the batch pickup */}
                          {isBatchPickup && (
                            <div className="rounded-2xl border border-neutral-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 p-4 space-y-2">
                              <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-400 dark:text-zinc-500 mb-2">📦 Pedidos incluidos en este lote</p>
                              {batchGroup.filter(o => o.status === 'READY' || o.status === 'PICKED_UP').map((batchOrder) => {
                                const batchOrderAmount = batchOrder.totalAmount && batchOrder.deliveryFee
                                  ? batchOrder.totalAmount - batchOrder.deliveryFee
                                  : batchOrder.totalAmount || 0;
                                return (
                                  <div key={batchOrder.id} className="flex items-center justify-between gap-2 rounded-xl bg-neutral-50 dark:bg-zinc-800/50 px-3 py-2.5">
                                    <div className="min-w-0 flex-1">
                                      <p className="text-sm font-bold text-neutral-900 dark:text-zinc-50 truncate">
                                        #{batchOrder.dailyCounter || 'S/N'} · {batchOrder.customer?.user?.name || 'Cliente'}
                                      </p>
                                      <p className="text-[10px] font-mono text-neutral-400 dark:text-zinc-500 truncate mt-0.5">
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
                            <div className="rounded-2xl bg-neutral-50 dark:bg-zinc-900/50 border border-neutral-200 dark:border-zinc-800 p-5 text-center">
                              <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-400 dark:text-zinc-500 mb-3">{isStore ? 'Muestra este PIN en la tienda' : 'Muestra este PIN al restaurante'}</p>
                              <p className="text-5xl font-black tracking-[0.5em] text-neutral-900 dark:text-zinc-50 font-mono py-2">{order.handoverPin}</p>
                              <p className="text-xs text-neutral-400 dark:text-zinc-500 mt-2">{isStore ? 'En tienda verificarán que eres el repartidor autorizado' : 'El restaurante verificará que eres el repartidor autorizado'}</p>
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
                                  ⏱️
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
                              const waitRemainingMin = arrivalMs ? Math.max(0, Math.ceil((MIN_WAIT_MS - waitMs) / 60000)) : 0;
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
                                  ⛓️‍💥 Liberar pedido
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
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                                </span>
                              </div>
                              <p className="text-2xl font-black leading-tight text-white">{customerAddressStr}</p>
                              {order.address?.reference && (
                                <p className="mt-2 text-sm text-white/60 leading-snug">📍 {order.address.reference}</p>
                              )}
                            </div>

                            {/* ── Maps button ── */}
                            {customerQuery && (
                              <a
                                href={`https://www.google.com/maps/search/?api=1&query=${customerQuery}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => { e.stopPropagation(); triggerHaptic(20); }}
                                className="flex items-center justify-center gap-2.5 w-full py-4 rounded-2xl bg-sky-500 text-white text-sm font-bold shadow-lg shadow-sky-500/30 hover:bg-sky-400 transition active:scale-[0.97]"
                              >
                                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>
                                Abrir en Google Maps
                              </a>
                            )}

                            {/* ── Delivery preference ── */}
                            {order.deliveryPreference && (
                              <div className="rounded-2xl border border-neutral-200 dark:border-zinc-800 px-4 py-3 flex items-start gap-3">
                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-950/20 text-base">
                                  {order.deliveryPreference === 'NO_DOORBELL' && '🤫'}
                                  {order.deliveryPreference === 'CALL_ON_ARRIVAL' && '📞'}
                                  {order.deliveryPreference === 'PREFER_WHATSAPP' && '💬'}
                                  {order.deliveryPreference === 'HONK_ON_ARRIVAL' && '🚗'}
                                  {order.deliveryPreference === 'BEWARE_OF_DOG' && '🐕'}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-bold text-neutral-900 dark:text-zinc-100">
                                    {order.deliveryPreference === 'NO_DOORBELL' && 'No tocar el timbre'}
                                    {order.deliveryPreference === 'CALL_ON_ARRIVAL' && 'Llamar al llegar'}
                                    {order.deliveryPreference === 'PREFER_WHATSAPP' && 'Avisar por WhatsApp'}
                                    {order.deliveryPreference === 'HONK_ON_ARRIVAL' && 'Tocar el claxon'}
                                    {order.deliveryPreference === 'BEWARE_OF_DOG' && 'Cuidado con el perro'}
                                  </p>
                                  <p className="text-xs text-neutral-500 dark:text-zinc-400 mt-0.5 leading-snug">
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
                                  className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl border border-neutral-200 dark:border-zinc-800 bg-neutral-50 dark:bg-zinc-900/50 text-xs font-bold text-neutral-700 dark:text-zinc-300 transition active:scale-[0.97]"
                                >
                                  <span className="text-base">📞</span> Llamar
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
                                  className="flex items-center justify-between w-full py-3 px-4 rounded-2xl border border-neutral-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs font-bold text-neutral-500 dark:text-zinc-400 transition active:scale-[0.98]"
                                >
                                  <span className="flex items-center gap-2">
                                    <span className="text-base">🏪</span> {isStore ? 'Tienda' : 'Restaurante'}
                                  </span>
                                  <svg
                                    className={`w-4 h-4 transition-transform duration-200 ${showRestaurantContact ? 'rotate-180' : ''}`}
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                    strokeWidth="2.5"
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                  </svg>
                                </button>
                                <div
                                  className={`grid transition-all duration-200 overflow-hidden ${showRestaurantContact ? 'grid-rows-[1fr] opacity-100 mt-2' : 'grid-rows-[0fr] opacity-0'}`}
                                >
                                  <div className="min-h-0">
                                    <div className="grid grid-cols-2 gap-2.5 mt-2">
                                      <a
                                        href={`tel:${order.restaurant.user.phone}`}
                                        onClick={(e) => { e.stopPropagation(); triggerHaptic(20); }}
                                        className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl border border-neutral-200 dark:border-zinc-800 bg-neutral-50 dark:bg-zinc-900/50 text-xs font-bold text-neutral-700 dark:text-zinc-300 transition active:scale-[0.97]"
                                      >
                                        <span className="text-base">📞</span> Llamar
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
                              <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-400 dark:text-zinc-500 mb-1">Entrega a {order.customer.user?.name || 'cliente'}</p>
                              <p className="text-xl font-black text-neutral-900 dark:text-zinc-50">
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
                                    <p className="text-4xl font-black text-neutral-900 dark:text-zinc-50 mt-0.5">{formatCurrency(order.totalAmount)}</p>
                                    <p className="text-xs text-emerald-600/70 dark:text-emerald-400/70 mt-1 leading-snug">Pago en efectivo — entrega cambio exacto si aplica</p>
                                  </div>
                                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-200/60 dark:bg-emerald-800/40 text-emerald-600 dark:text-emerald-400 text-2xl">
                                    💵
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* ── TRANSFER: PIN input ── */}
                            {isTransfer && (
                              <div className="space-y-3">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-400 dark:text-zinc-500">PIN de confirmación del cliente</p>
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
                                  className="w-full text-center tracking-[0.5em] text-2xl font-black rounded-2xl border border-neutral-200 dark:border-zinc-800 bg-neutral-50 dark:bg-zinc-900 py-4 outline-none focus:border-neutral-400 dark:focus:border-zinc-600 text-neutral-900 dark:text-zinc-50 transition"
                                  autoFocus
                                />
                                {deliveryPinError && (
                                  <p className="text-xs font-bold text-rose-600 dark:text-rose-400 text-center">{deliveryPinError}</p>
                                )}
                                <p className="text-[10px] text-neutral-400 dark:text-zinc-500 text-center leading-snug">El cliente te dará este PIN para confirmar que recibió el pedido</p>
                              </div>
                            )}

                            {/* ── Contact client ── */}
                            {order.customer.user?.phone && (
                              <div>
                                <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-400 dark:text-zinc-500 mb-2.5 ml-1">Contacto</p>
                                <div className="grid grid-cols-2 gap-3">
                                  <a
                                    href={`tel:${order.customer.user.phone}`}
                                    onClick={(e) => { e.stopPropagation(); triggerHaptic(20); }}
                                    className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl border border-neutral-200 dark:border-zinc-800 bg-neutral-50 dark:bg-zinc-900/50 text-xs font-bold text-neutral-700 dark:text-zinc-300 transition active:scale-[0.97]"
                                  >
                                    <span className="text-base">📞</span> Llamar Cliente
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
            {/* Sub-tab selector: Pedidos | Pagos */}
            <div className="flex gap-1.5 rounded-3xl border border-black/5 dark:border-zinc-900 bg-white dark:bg-zinc-950 p-1 shadow-sm">
              {(['orders', 'payments'] as const).map((sub) => (
                <button
                  key={sub}
                  onClick={() => setHistorySubTab(sub)}
                  className={`flex-1 px-3 py-2 rounded-2xl text-[10px] font-black uppercase tracking-wider transition-all ${
                    historySubTab === sub
                      ? 'bg-neutral-950 text-white dark:bg-white dark:text-neutral-950 shadow-md'
                      : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-zinc-300'
                  }`}
                >
                  {sub === 'orders' ? 'Pedidos' : 'Pagos'}
                </button>
              ))}
            </div>

            {historySubTab === 'orders' && (
              <>
                {/* Tarjeta de Resumen Acumulado en el Historial */}
                <div className="rounded-3xl border border-black/5 bg-white p-5 dark:bg-zinc-950 dark:border-zinc-900 shadow-sm transition">
                  <span className="text-[9px] font-extrabold uppercase tracking-widest text-sky-500 dark:text-sky-400">Métricas Totales Visibles</span>
                  <h3 className="text-lg font-black text-neutral-900 dark:text-zinc-50 leading-tight mt-1">Historial General</h3>

                  {/* Filtro por período */}
                  <div className="mt-3 flex gap-1.5">
                    {(['day', 'week', 'month', 'all'] as const).map((f) => (
                      <button
                        key={f}
                        onClick={() => setHistoryFilter(f)}
                        className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider transition-all ${
                          historyFilter === f
                            ? 'bg-sky-500 text-white shadow-md'
                            : 'bg-neutral-100 dark:bg-zinc-900 text-neutral-500 dark:text-zinc-400 hover:bg-neutral-200 dark:hover:bg-zinc-800'
                        }`}
                      >
                        {f === 'day' ? 'Hoy' : f === 'week' ? 'Semana' : f === 'month' ? 'Mes' : 'Todo'}
                      </button>
                    ))}
                  </div>

                  <div className="mt-3.5 grid grid-cols-2 gap-3.5">
                    <div className="rounded-2xl bg-neutral-50 p-4 dark:bg-zinc-900/60 shadow-inner">
                      <p className="text-[9px] font-black uppercase tracking-wider text-neutral-400">Viajes Completados</p>
                      <p className="text-2xl font-black text-neutral-950 dark:text-zinc-50 mt-1">
                        {filteredHistoryOrders.length}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-neutral-50 p-4 dark:bg-zinc-900/60 shadow-inner">
                      <p className="text-[9px] font-black uppercase tracking-wider text-sky-600 dark:text-sky-400">Tu Ganancia</p>
                      <p className="text-2xl font-black text-sky-600 dark:text-sky-400 mt-1">
                        {formatCurrency(
                          filteredHistoryOrders.reduce((sum, o) => sum + (o.deliveryFee || 0), 0)
                        )}
                      </p>
                    </div>
                  </div>
                  <p className="text-[9px] text-neutral-400 dark:text-zinc-600 mt-2 text-right">
                    Total facturado: {formatCurrency(filteredHistoryOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0))}
                  </p>
                </div>

                {filteredHistoryOrders.length === 0 ? (
                  <div className="rounded-[36px] border border-dashed border-black/10 bg-white/40 p-10 text-center dark:bg-zinc-950/15 dark:border-zinc-900">
                    <span className="text-3xl block mb-3">📅</span>
                    <h4 className="text-sm font-black text-neutral-850 dark:text-zinc-200">Sin resultados</h4>
                    <p className="text-xs text-neutral-500 dark:text-zinc-400 mt-1 leading-relaxed">
                      {historyFilter === 'all' ? 'Aún no registras entregas. ¡Sal a ruta e inicia a ganar!' : 'No hay entregas en este período.'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-5">
                    {groupedHistoryOrders.map(([dateLabel, orders]) => (
                      <div key={dateLabel}>
                        <div className="flex items-center gap-2 mb-2.5 px-1">
                          <h4 className="text-[10px] font-bold text-neutral-400 dark:text-zinc-500 uppercase tracking-wider">{dateLabel}</h4>
                          <div className="flex-1 h-px bg-neutral-200/50 dark:bg-zinc-800/50" />
                          <span className="text-[9px] font-bold text-neutral-300 dark:text-zinc-600">{orders.length} viaje{orders.length !== 1 ? 's' : ''}</span>
                        </div>
                        <div className="space-y-2">
                          {orders.map((order) => (
                            <article
                              key={order.id}
                              onClick={() => setSelectedHistoryOrder(order)}
                              className="rounded-2xl border border-black/5 bg-[#fbf8f1] p-4 flex justify-between items-center transition cursor-pointer hover:bg-[#f5f0e6] dark:bg-zinc-950 dark:border-zinc-900/60 dark:hover:bg-zinc-900"
                            >
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="h-5 w-5 rounded bg-emerald-500 text-white flex items-center justify-center text-[10px] font-bold shrink-0">✓</span>
                                  <span className="text-xs font-black text-neutral-950 dark:text-zinc-50 truncate">
                                    {order.restaurant.name} — {order.customer?.user?.name ?? 'Cliente'} #{order.dailyCounter ?? '?'}
                                  </span>
                                </div>
                                <p className="text-[9px] text-neutral-400 dark:text-zinc-500 mt-0.5 font-mono tracking-tight">
                                  {order.orderReference}
                                </p>
                                <p className="text-[9px] text-neutral-500 dark:text-zinc-400 mt-0.5">
                                  {order.deliveredAt ? formatDate(order.deliveredAt) : 'Completado'}
                                </p>
                              </div>

                              <div className="text-right">
                                {order.totalAmount && (
                                  <span className="text-xs font-black text-neutral-950 dark:text-zinc-50 block">
                                    {formatCurrency(order.totalAmount)}
                                  </span>
                                )}
                                <span className="text-[9px] uppercase font-bold text-neutral-400">
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
                        className="w-full py-3.5 bg-neutral-100 hover:bg-neutral-200 dark:bg-zinc-900 dark:hover:bg-zinc-800 text-neutral-700 dark:text-zinc-300 rounded-2xl text-xs font-black uppercase tracking-widest transition-colors disabled:opacity-50 mt-4"
                      >
                        {loadingMoreHistory ? 'Cargando...' : 'Cargar más antiguos'}
                      </button>
                    )}
                  </div>
                )}
              </>
            )}

            {historySubTab === 'payments' && (
              <div className="space-y-4">
                {driverSettlements.length === 0 ? (
                  <div className="rounded-[36px] border border-dashed border-black/10 bg-white/40 p-10 text-center dark:bg-zinc-950/15 dark:border-zinc-900">
                    <span className="text-3xl block mb-3">💰</span>
                    <h4 className="text-sm font-black text-neutral-850 dark:text-zinc-200">Sin pagos registrados</h4>
                    <p className="text-xs text-neutral-500 dark:text-zinc-400 mt-1 leading-relaxed">
                      Aún no hay cortes de comisión registrados.
                    </p>
                  </div>
                ) : (
                  driverSettlements.map((s) => {
                    const isPending = s.status === 'PENDING' || s.status === 'OVERDUE';
                    return (
                      <div
                        key={s.id}
                        className={`rounded-2xl border p-5 transition shadow-sm hover:shadow-md duration-200 ${
                          isPending
                            ? 'border-amber-200 bg-gradient-to-r from-amber-50/40 via-amber-50/10 to-white dark:from-amber-950/20 dark:to-zinc-950'
                            : s.status === 'PAID'
                              ? 'border-black/5 bg-gradient-to-r from-neutral-50/50 to-white dark:from-zinc-900/30 dark:to-zinc-950 hover:border-neutral-200'
                              : s.status === 'IN_REVIEW'
                                ? 'border-sky-200 bg-gradient-to-r from-sky-50/40 to-white dark:from-sky-950/20 dark:to-zinc-950'
                                : 'border-black/5 bg-gradient-to-r from-neutral-50/50 to-white dark:from-zinc-900/30 dark:to-zinc-950'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-extrabold text-neutral-950 dark:text-zinc-100 tracking-tight text-xs">{s.reference || 'Corte'}</p>
                            </div>
                            <p className="text-[10px] text-neutral-500 dark:text-zinc-400 font-medium">
                              Periodo: {new Date(s.periodStart).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })} - {new Date(s.periodEnd).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </p>
                          </div>
                          <div className="flex items-center gap-6">
                            <div className="text-right">
                              <p className="text-xl font-black text-neutral-950 dark:text-zinc-100">{formatCurrency(
                                s.status === 'PENDING' && (walletData?.pastDebt || 0) > 0 ? (walletData?.pastDebt ?? 0) : s.amount
                              )}</p>
                              <p className="text-[9px] text-neutral-500 dark:text-zinc-400 font-semibold mt-0.5">{s.deliveredOrders || 0} pedidos</p>
                            </div>
                            <div className="min-w-[100px] text-right">
                              <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[10px] font-bold ${
                                s.status === 'PAID'
                                  ? 'bg-emerald-100 border-emerald-200/40 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'
                                  : s.status === 'IN_REVIEW'
                                    ? 'bg-sky-100 border-sky-200/40 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300'
                                    : s.status === 'REJECTED'
                                      ? 'bg-rose-100 border-rose-200/40 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300'
                                      : s.status === 'OVERDUE'
                                        ? 'bg-red-100 border-red-200/40 text-red-800 dark:bg-red-900/30 dark:text-red-300 animate-pulse'
                                        : 'bg-amber-100 border-amber-200/40 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                              }`}>
                                {s.status === 'PAID' && '✅ Pagado'}
                                {s.status === 'IN_REVIEW' && '🔍 En revisión'}
                                {s.status === 'REJECTED' && '❌ Rechazado'}
                                {s.status === 'PENDING' && '⏱️ Pendiente'}
                                {s.status === 'OVERDUE' && '🚨 Vencido'}
                              </span>
                            </div>
                          </div>
                        </div>

                        {s.dueDate && (s.status === 'PENDING' || s.status === 'OVERDUE') && (
                          <div className={`mt-3 flex items-center gap-1.5 text-[10px] font-bold rounded-xl px-3 py-1.5 w-fit ${new Date(s.dueDate) < new Date() ? 'text-red-600 dark:text-red-400 bg-red-50/40 dark:bg-red-950/20 border border-red-200/40 dark:border-red-900/30' : 'text-amber-700 dark:text-amber-400 bg-amber-50/40 dark:bg-amber-950/20 border border-amber-100/40 dark:border-amber-900/30'}`}>
                            <span>{new Date(s.dueDate) < new Date() ? '🚨' : '📅'}</span>
                            <span>{new Date(s.dueDate) < new Date() ? 'Retrasado' : `Límite de pago: ${new Date(s.dueDate).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}`}</span>
                          </div>
                        )}

                        <div className="mt-4 flex gap-2 justify-end border-t border-black/5 dark:border-zinc-800 pt-3">
                          <button
                            type="button"
                            onClick={() => openSettlementDetailModal(s)}
                            className="rounded-xl border border-black/10 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3.5 py-2 text-[10px] font-bold text-neutral-700 dark:text-zinc-300 transition hover:bg-neutral-50 dark:hover:bg-zinc-800 active:scale-95 shadow-sm"
                          >
                            Ver detalles
                          </button>
                          {s.paymentProofUrl && (
                            <button
                              type="button"
                              onClick={() => { setProofImageUrl(s.paymentProofUrl ?? ''); setShowProofModal(true); }}
                              className="rounded-xl border border-black/10 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3.5 py-2 text-[10px] font-bold text-neutral-700 dark:text-zinc-300 transition hover:bg-neutral-50 dark:hover:bg-zinc-800 active:scale-95 shadow-sm inline-flex items-center gap-1.5"
                            >
                              🖼️ Ver comprobante
                            </button>
                          )}
                          {(s.status === 'PENDING' || s.status === 'OVERDUE') && (
                            <button
                              type="button"
                              onClick={openPayModal}
                              className="rounded-xl bg-neutral-950 dark:bg-white px-4 py-2 text-[10px] font-bold text-white dark:text-neutral-950 transition hover:bg-neutral-800 dark:hover:bg-neutral-200 active:scale-95 shadow-sm"
                            >
                              Pagar Corte
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}

        {/* ==========================================
            PESTAÑA: BILLETERA (GANANCIAS Y DEUDA)
            ========================================== */}
        {activeTab === 'wallet' && (
          <div className="space-y-4 animate-fadeIn">
            {/* Gráfica de Ganancias */}
            <div className="rounded-3xl border border-black/5 bg-white p-5 dark:bg-zinc-950 dark:border-zinc-900 shadow-sm transition">
              <div className="flex justify-between items-center mb-4">
                <span className="text-[9px] font-extrabold uppercase tracking-widest text-sky-500 dark:text-sky-400">Rendimiento</span>
                <select
                  value={walletWeekOffset}
                  onChange={(e) => setWalletWeekOffset(parseInt(e.target.value, 10))}
                  className="bg-neutral-100 dark:bg-zinc-900 text-xs font-black text-neutral-700 dark:text-zinc-300 rounded-lg px-2 py-1 outline-none appearance-none cursor-pointer border border-transparent focus:border-accent/50 transition-colors"
                >
                  {[0, 1, 2, 3, 4, 5, 6, 7].map(offset => (
                    <option key={offset} value={offset}>
                      {offset === 0 ? 'Semana Actual' : `Hace ${offset} sem.`}
                    </option>
                  ))}
                </select>
              </div>

              {loadingChart ? (
                <div className="h-44 flex items-center justify-center">
                  <div className="animate-spin h-6 w-6 border-2 border-accent border-t-transparent rounded-full"></div>
                </div>
              ) : walletChartData ? (
                <div className="mt-2">
                  <div className="flex justify-between items-end mb-6">
                    {(() => {
                      const displayedData = selectedChartDay !== null 
                        ? walletChartData.chartData[selectedChartDay] 
                        : { 
                            label: 'Total Semana', 
                            earnings: walletChartData.chartData.reduce((acc, d) => acc + d.earnings, 0),
                            trips: walletChartData.chartData.reduce((acc, d) => acc + d.trips, 0)
                          };
                      const dateTitle = selectedChartDay !== null && 'date' in displayedData
                        ? new Date(displayedData.date as string).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' })
                        : 'Total Semana';
                      
                      return (
                        <>
                          <div onClick={() => setSelectedChartDay(null)} className="cursor-pointer">
                            <p className="text-[10px] text-accent-hover dark:text-sky-400 uppercase tracking-widest font-black transition-colors">
                              {dateTitle}
                            </p>
                            <p className="text-2xl font-black text-neutral-900 dark:text-white mt-0.5 transition-all">
                              {formatCurrency(displayedData.earnings)}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] text-neutral-500 dark:text-zinc-500 uppercase tracking-widest font-black transition-colors">Viajes</p>
                            <p className="text-xl font-black text-neutral-900 dark:text-white mt-0.5 transition-all">
                              {displayedData.trips}
                            </p>
                          </div>
                        </>
                      );
                    })()}
                  </div>

                  {(() => {
                    const maxE = Math.max(...walletChartData.chartData.map(d => d.earnings), 50); // min max to avoid flatline at 0

                    return (
                      <div className="relative h-32 w-full mt-2 select-none">
                        <svg className="absolute inset-0 h-full w-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 100 100">
                          {/* Grid lines */}
                          <line x1="0" y1="10" x2="100" y2="10" stroke="currentColor" strokeWidth="0.5" strokeDasharray="2,2" className="text-black/5 dark:text-white/5" />
                          <line x1="0" y1="50" x2="100" y2="50" stroke="currentColor" strokeWidth="0.5" strokeDasharray="2,2" className="text-black/5 dark:text-white/5" />
                          <line x1="0" y1="90" x2="100" y2="90" stroke="currentColor" strokeWidth="0.5" strokeDasharray="2,2" className="text-black/5 dark:text-white/5" />

                          {/* Gradient definition */}
                          <defs>
                            <linearGradient id="gradientSky" x1="0%" y1="0%" x2="0%" y2="100%">
                              <stop offset="0%" stopColor="#0ea5e9" />
                              <stop offset="100%" stopColor="#7dd3fc" />
                            </linearGradient>
                          </defs>

                          {/* Data Bars */}
                          {walletChartData.chartData.map((d, i) => {
                            const barWidth = 7; // ancho relativo
                            const x = (i + 0.5) * (100 / 7) - (barWidth / 2);
                            const height = Math.max((d.earnings / maxE) * 80, 2); // altura mínima de 2
                            const y = 90 - height;
                            const isSelected = selectedChartDay === i;
                            const isFaded = selectedChartDay !== null && !isSelected;
                            
                            return (
                              <g key={`bar-group-${i}`} onClick={() => setSelectedChartDay(isSelected ? null : i)} className="cursor-pointer">
                                {/* Zona de toque más ancha */}
                                <rect
                                  x={(i * (100 / 7))}
                                  y="10"
                                  width={100 / 7}
                                  height="80"
                                  fill="transparent"
                                />
                                <rect
                                  x={x}
                                  y={y}
                                  width={barWidth}
                                  height={height}
                                  rx="1.5"
                                  fill="url(#gradientSky)"
                                  opacity={isFaded ? 0.3 : 1}
                                  className="drop-shadow-sm transition-all duration-300"
                                />
                              </g>
                            );
                          })}
                        </svg>

                        {/* X Axis Labels */}
                        <div className="absolute top-[100%] left-0 right-0 flex mt-2">
                          {walletChartData.chartData.map((d, i) => (
                            <div key={i} className="flex-1 flex justify-center">
                              <span className="text-[10px] font-black text-neutral-400 dark:text-zinc-500">{d.label}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <div className="h-44 flex items-center justify-center text-xs text-neutral-400">Sin datos</div>
              )}
            </div>

            {/* Tarjeta de Resumen General */}
            <div className="rounded-3xl border border-black/5 bg-white p-5 dark:bg-zinc-950 dark:border-zinc-900 shadow-sm transition">
              <span className="text-[9px] font-extrabold uppercase tracking-widest text-[#A78BFA]">Saldo y Ganancias</span>
              <h3 className="text-lg font-black text-neutral-900 dark:text-zinc-50 leading-tight mt-1">Resumen Financiero</h3>

              <div className="mt-5 space-y-4">
                {/* Deuda de la semana pasada (corte pendiente) */}
                {((walletData?.pastDebt || 0) > 0 || walletData?.recentSettlements?.some(s => s.status === 'PENDING' || s.status === 'OVERDUE' || s.status === 'IN_REVIEW')) && (() => {
                  const activeSettlement = walletData?.recentSettlements?.find(s => s.status === 'PENDING' || s.status === 'IN_REVIEW' || s.status === 'OVERDUE');
                  const hasProof = activeSettlement?.status === 'IN_REVIEW';
                  const displayDebt = (walletData?.pastDebt || 0) > 0 ? (walletData?.pastDebt || 0) : (activeSettlement?.amount || 0);
                  return (
                    <div className="rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-900/30 p-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-[9px] font-black uppercase tracking-wider text-amber-700 dark:text-amber-400">Corte de Semana Pasada</p>
                        </div>
                        <span className="text-xl">{hasProof ? '🔍' : displayDebt > 0 ? '⏰' : '✅'}</span>
                      </div>
                      <div className="flex justify-between items-baseline mt-4 border-t border-amber-200/40 dark:border-amber-900/30 pt-3">
                        <span className="text-xs font-black text-amber-800 dark:text-amber-300">Deuda pendiente:</span>
                        <span className="text-2xl font-black text-amber-700 dark:text-amber-400">
                          {formatCurrency(displayDebt)}
                        </span>
                      </div>
                      {walletData?.pendingSettlementDueDate && (
                        <div className={`mt-2 flex items-center gap-1.5 text-[11px] font-bold ${new Date(walletData.pendingSettlementDueDate) < new Date() ? 'text-red-600 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'}`}>
                          <span>{new Date(walletData.pendingSettlementDueDate) < new Date() ? '🚨' : '📅'}</span>
                          <span>{new Date(walletData.pendingSettlementDueDate) < new Date() ? 'Retrasado' : `Límite de pago: ${new Date(walletData.pendingSettlementDueDate).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}`}</span>
                        </div>
                      )}
                      {hasProof ? (
                        <div className="mt-3 space-y-2">
                          <div className="rounded-xl bg-sky-50 dark:bg-sky-950/20 border border-sky-200 dark:border-sky-900/30 p-3 flex items-center gap-2">
                            <span className="text-sm">🔍</span>
                            <div>
                              <p className="text-[10px] font-black text-sky-700 dark:text-sky-300 uppercase tracking-wider">Comprobante enviado</p>
                              <p className="text-[9px] text-sky-600 dark:text-sky-400">Esperando revisión del administrador</p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => openDebtModal('past')}
                              className="flex-1 py-2 bg-neutral-100 dark:bg-zinc-900 text-neutral-700 dark:text-zinc-300 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-neutral-200 dark:hover:bg-zinc-800 transition"
                            >
                              Ver detalle
                            </button>
                            {activeSettlement?.paymentProofUrl && (
                              <button
                                type="button"
                                onClick={() => { setProofImageUrl(activeSettlement.paymentProofUrl ?? ''); setShowProofModal(true); }}
                                className="py-2 px-3.5 bg-neutral-100 dark:bg-zinc-900 text-neutral-700 dark:text-zinc-300 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-neutral-200 dark:hover:bg-zinc-800 transition inline-flex items-center gap-1"
                              >
                                🖼️ Comprobante
                              </button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 flex gap-2">
                          <button
                            onClick={() => openDebtModal('past')}
                            className="flex-1 py-2 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-amber-200 dark:hover:bg-amber-900/60 transition"
                          >
                            Ver detalle
                          </button>
                          <button
                            onClick={openPayModal}
                            className="flex-1 py-2 bg-neutral-950 dark:bg-white text-white dark:text-neutral-950 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-neutral-800 dark:hover:bg-neutral-200 transition animate-wiggle"
                          >
                            Pagar ahora
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Deuda acumulada de esta semana */}
                {(walletData?.currentDebt || 0) > 0 && (
                  <div className="rounded-2xl bg-rose-50/50 dark:bg-rose-950/20 border border-rose-200/50 dark:border-rose-900/30 p-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-wider text-rose-600 dark:text-rose-450">Comisión por Servicio Ocupado</p>
                        <p className="text-[11px] text-neutral-500 dark:text-zinc-400 mt-1 leading-relaxed">
                          Deuda acumulada de esta semana. Se cortará el próximo domingo.
                        </p>
                      </div>
                      <span className="text-xl">⚠️</span>
                    </div>
                    <div className="flex justify-between items-baseline mt-4 border-t border-rose-200/40 dark:border-rose-900/30 pt-3">
                      <span className="text-xs font-black text-rose-800 dark:text-rose-300">Deuda acumulada:</span>
                      <span className="text-2xl font-black text-rose-700 dark:text-rose-450">
                        {formatCurrency(walletData?.currentDebt || 0)}
                      </span>
                    </div>
                    {(walletData?.currentDebt ?? 0) > 0 && (
                      <div className="mt-3">
                        <button
                          onClick={() => openDebtModal('current')}
                          className="w-full py-2 bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-rose-200 dark:hover:bg-rose-900/60 transition"
                        >
                          Ver detalle
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* If there's no debt at all — only after walletData loads */}
                {walletData && (!walletData?.currentDebt || walletData.currentDebt <= 0) && (!walletData?.pastDebt || walletData.pastDebt <= 0) && (
                  <div className="rounded-2xl bg-emerald-50/50 dark:bg-emerald-950/10 border border-emerald-200/50 dark:border-emerald-900/30 p-4 text-center">
                    <p className="text-2xl mb-1">✅</p>
                    <p className="text-sm font-black text-emerald-700 dark:text-emerald-400">Estás al día</p>
                    <p className="text-[10px] text-emerald-600 dark:text-emerald-500 mt-0.5">No tienes deuda pendiente</p>
                  </div>
                )}

                {/* Ganancias de la semana */}
                <div className="rounded-2xl bg-sky-50/55 dark:bg-sky-950/15 border border-sky-100 dark:border-sky-900/25 p-4">
                  <p className="text-[9px] font-black uppercase tracking-wider text-accent dark:text-[#A78BFA]">Semana en Curso</p>
                  <div className="flex justify-between items-baseline mt-2">
                    <span className="text-xs text-neutral-500 dark:text-zinc-450">Ganancias estimadas:</span>
                    <span className="text-xl font-black text-neutral-950 dark:text-zinc-100">
                      {formatCurrency(walletData?.weeklyEarnings || 0)}
                    </span>
                  </div>
                  <div className="flex justify-between items-baseline mt-1">
                    <span className="text-xs text-neutral-500 dark:text-zinc-450">Entregas de la semana:</span>
                    <span className="text-xs font-black text-neutral-900 dark:text-zinc-200">
                      {walletData?.weeklyTripsCount || 0} viajes
                    </span>
                  </div>
                </div>

                {/* Ganancias de hoy */}
                <div className="rounded-2xl bg-neutral-50 dark:bg-zinc-900/50 p-4">
                  <p className="text-[9px] font-black uppercase tracking-wider text-neutral-555 dark:text-zinc-400">Actividad de Hoy</p>
                  <div className="flex justify-between items-baseline mt-2">
                    <span className="text-xs text-neutral-500 dark:text-zinc-450">Ganancia neta hoy:</span>
                    <span className="text-lg font-black text-neutral-950 dark:text-zinc-100">
                      {formatCurrency(walletData?.todayEarnings || 0)}
                    </span>
                  </div>
                  <div className="flex justify-between items-baseline mt-1">
                    <span className="text-xs text-neutral-500 dark:text-zinc-450">Entregas de hoy:</span>
                    <span className="text-xs font-black text-neutral-900 dark:text-zinc-200">
                      {walletData?.todayTripsCount || 0} viajes
                    </span>
                  </div>
                </div>
              </div>
            </div>


            {/* Historial reciente de ganancias de los viajes */}
            <div className="rounded-3xl border border-black/5 bg-white p-5 dark:bg-zinc-950 dark:border-zinc-900 shadow-sm transition">
              <span className="text-[9px] font-extrabold uppercase tracking-widest text-sky-500 dark:text-sky-400">Detalle</span>
              <h3 className="text-lg font-black text-neutral-900 dark:text-zinc-50 leading-tight mt-1">Viajes Recientes (7d)</h3>

              <div className="mt-4 space-y-4">
                {!walletData?.recentDeliveries || walletData.recentDeliveries.length === 0 ? (
                  <div className="py-6 text-center text-xs text-neutral-400">
                    No hay viajes registrados en los últimos 7 días.
                  </div>
                ) : (() => {
                  const groups = new Map<string, typeof walletData.recentDeliveries>();
                  for (const d of walletData.recentDeliveries) {
                    const key = new Date(d.deliveredAt).toLocaleDateString('es-MX', {
                      year: 'numeric', month: 'short', day: 'numeric',
                    });
                    if (!groups.has(key)) groups.set(key, []);
                    groups.get(key)!.push(d);
                  }
                  const sorted = Array.from(groups.entries()).sort((a, b) => {
                    return new Date(b[1][0].deliveredAt).getTime() - new Date(a[1][0].deliveredAt).getTime();
                  });
                  return sorted.map(([dateLabel, deliveries]) => (
                    <div key={dateLabel}>
                      <div className="flex items-center gap-2 mb-2 px-1">
                        <h4 className="text-[10px] font-bold text-neutral-400 dark:text-zinc-500 uppercase tracking-wider">{dateLabel}</h4>
                        <div className="flex-1 h-px bg-neutral-200/50 dark:bg-zinc-800/50" />
                        <span className="text-[9px] font-bold text-neutral-300 dark:text-zinc-600">{deliveries.length} viaje{deliveries.length !== 1 ? 's' : ''}</span>
                      </div>
                      <div className="space-y-2">
                        {deliveries.map((delivery) => (
                          <div
                            key={delivery.id}
                            onClick={() => {
                              const order = orderRefMap.get(delivery.orderReference);
                              if (order) setSelectedHistoryOrder(order);
                            }}
                            className="rounded-2xl border border-black/5 bg-[#fbf8f1] p-3.5 flex justify-between items-center cursor-pointer hover:bg-[#f5f0e6] dark:bg-zinc-900/40 dark:border-zinc-900/50 dark:hover:bg-zinc-800/60 transition"
                          >
                            <div className="min-w-0 flex-1 mr-3">
                              {(() => {
                                const full = orderRefMap.get(delivery.orderReference);
                                return full ? (
                                  <>
                                    <span className="text-xs font-black text-neutral-900 dark:text-zinc-100 truncate block">
                                      {full.restaurant.name} — {full.customer?.user?.name ?? 'Cliente'} #{full.dailyCounter ?? '?'}
                                    </span>
                                    <p className="text-[8px] text-neutral-400 dark:text-zinc-500 mt-0.5 font-mono tracking-tight truncate">
                                      {delivery.orderReference}
                                    </p>
                                  </>
                                ) : (
                                  <span className="text-xs font-black text-neutral-900 dark:text-zinc-100">
                                    {delivery.orderReference}
                                  </span>
                                );
                              })()}
                              <p className="text-[9px] text-neutral-500 dark:text-zinc-400 mt-0.5">{formatDate(delivery.deliveredAt)}</p>
                            </div>
                            <span className="text-xs font-extrabold text-emerald-600 dark:text-emerald-400">
                              +{formatCurrency(delivery.deliveryFee)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </div>
          </div>
        )}

        {/* ==========================================
            PESTAÑA 3: SEGURIDAD Y PERFIL DEL REPARTIDOR
            ========================================== */}
        {activeTab === 'profile' && (
          <div className="space-y-4 animate-fadeIn">
            {/* Foto de Perfil Uploader */}
            {driverProfile && (
              <div className="rounded-3xl border border-black/5 bg-white p-5 dark:bg-zinc-950 dark:border-zinc-900 shadow-sm transition flex flex-col items-center">
                <span className="text-[9px] font-extrabold uppercase tracking-widest text-[#A78BFA] self-start">Identidad</span>
                <h3 className="text-lg font-black text-neutral-900 dark:text-zinc-50 leading-tight mt-1 self-start">Foto de Perfil</h3>
                <p className="text-xs text-neutral-500 dark:text-zinc-400 mt-1 leading-relaxed self-start">
                  Sube una foto clara y profesional para que los restaurantes y clientes puedan identificarte fácilmente.
                </p>

                <div className="relative mt-6 mb-2">
                  <div className="relative h-28 w-28 rounded-full border border-black/10 dark:border-zinc-800 bg-neutral-100 dark:bg-zinc-900 flex items-center justify-center overflow-hidden shadow-inner group">
                    {driverProfile.user.profilePhoto ? (
                      <img
                        src={driverProfile.user.profilePhoto}
                        alt="Profile Photo"
                        className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <span className="text-4xl text-neutral-400 select-none">👤</span>
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
              <div className="rounded-3xl border border-black/5 bg-white p-5 dark:bg-zinc-950 dark:border-zinc-900 shadow-sm transition">
                <span className="text-[9px] font-extrabold uppercase tracking-widest text-[#A78BFA]">Rendimiento</span>
                <h3 className="text-lg font-black text-neutral-900 dark:text-zinc-50 leading-tight mt-1">Estadísticas</h3>
                <div className="mt-5 flex items-stretch gap-0">
                  <div className="flex-1 text-center border-r border-black/5 dark:border-zinc-800 pr-3">
                    <p className="text-3xl font-black text-neutral-900 dark:text-zinc-50 tabular-nums">
                      {driverProfile.rating > 0 ? driverProfile.rating.toFixed(1) : <span className="text-base font-bold text-neutral-400">—</span>}
                    </p>
                    <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-neutral-500 dark:text-zinc-400">Calificación</p>
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
                    <p className="text-3xl font-black text-neutral-900 dark:text-zinc-50 tabular-nums">{driverProfile.totalDeliveries}</p>
                    <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-neutral-500 dark:text-zinc-400">Viajes</p>
                    <p className="mt-1 text-[10px] text-neutral-400 dark:text-zinc-500">
                      {driverProfile.totalDeliveries === 0 ? 'Sin actividad' : 'Completados'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Tarjeta informativa del repartidor */}
            {driverProfile && (
              <div className="rounded-3xl border border-black/5 bg-white p-5 dark:bg-zinc-950 dark:border-zinc-900 shadow-sm transition">
                <span className="text-[9px] font-extrabold uppercase tracking-widest text-[#A78BFA]">Datos del Repartidor</span>
                <h3 className="text-lg font-black text-neutral-900 dark:text-zinc-50 leading-tight mt-1">Información de Cuenta</h3>

                <div className="mt-4 space-y-3.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-neutral-450 font-bold dark:text-zinc-500 uppercase tracking-wider text-[9px]">Nombre completo</span>
                    <span className="font-extrabold text-neutral-900 dark:text-zinc-100">{driverProfile.user.name}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs pt-3 border-t border-black/5 dark:border-zinc-900/80">
                    <span className="text-neutral-450 font-bold dark:text-zinc-500 uppercase tracking-wider text-[9px]">Teléfono</span>
                    <span className="font-extrabold text-neutral-900 dark:text-zinc-100">{driverProfile.user.phone}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs pt-3 border-t border-black/5 dark:border-zinc-900/80">
                    <span className="text-neutral-450 font-bold dark:text-zinc-500 uppercase tracking-wider text-[9px]">Zona de reparto</span>
                    <span className="font-extrabold text-neutral-900 dark:text-zinc-100">{driverProfile.user.region}</span>
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
            <div className="rounded-3xl border border-black/5 bg-white p-5 dark:bg-zinc-950 dark:border-zinc-900 shadow-sm transition">
              <span className="text-[9px] font-extrabold uppercase tracking-widest text-[#A78BFA]">Ahorro de Datos y Energía</span>
              <h3 className="text-lg font-black text-neutral-900 dark:text-zinc-50 leading-tight mt-1">Preferencias de GPS</h3>
              <p className="text-xs text-neutral-500 dark:text-zinc-400 mt-1 leading-relaxed">
                Desactiva la transmisión en tiempo real para ahorrar el consumo de tu batería y datos Telcel. Tus clientes seguirán viendo tu estado de timeline.
              </p>

              <div className="mt-5 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="text-xl">📡</span>
                  <div>
                    <p className="text-xs font-bold text-neutral-900 dark:text-zinc-100">Compartir GPS en Vivo</p>
                    <p className="text-[10px] text-neutral-500 dark:text-zinc-400">
                      {shareLocationGps ? 'Activo (transmite ubicación)' : 'Apagado (ahorro máximo)'}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={toggleShareLocationGps}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${shareLocationGps ? 'bg-[#5B21B6] dark:bg-[#C4B5FD]' : 'bg-neutral-200 dark:bg-zinc-800'
                    }`}
                  aria-label="Alternar compartir ubicación en vivo"
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${shareLocationGps ? 'translate-x-6' : 'translate-x-1'
                      }`}
                  />
                </button>
              </div>
            </div>

            {/* Formulario Premium para cambiar contraseña */}
            <div className="rounded-3xl border border-black/5 bg-white p-5 dark:bg-zinc-950 dark:border-zinc-900 shadow-sm transition">
              <span className="text-[9px] font-extrabold uppercase tracking-widest text-[#A78BFA]">Seguridad de Acceso</span>
              <h3 className="text-lg font-black text-neutral-900 dark:text-zinc-50 leading-tight mt-1">Cambiar Contraseña</h3>
              <p className="text-xs text-neutral-500 dark:text-zinc-400 mt-1 leading-relaxed">
                Elige una contraseña segura de mínimo 6 caracteres para proteger tu cuenta.
              </p>

              <form onSubmit={handlePasswordChange} className="mt-5 space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-wider text-neutral-450 dark:text-zinc-400">
                    Contraseña actual
                  </label>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Ingresa tu contraseña actual"
                    required
                    className="w-full text-xs font-semibold rounded-2xl border border-black/5 bg-neutral-50 px-4 py-3.5 outline-none focus:border-[#C4B5FD] dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-50 dark:focus:border-[#A78BFA]"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-wider text-neutral-450 dark:text-zinc-400">
                    Nueva contraseña
                  </label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    required
                    className="w-full text-xs font-semibold rounded-2xl border border-black/5 bg-neutral-50 px-4 py-3.5 outline-none focus:border-[#C4B5FD] dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-50 dark:focus:border-[#A78BFA]"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-wider text-neutral-450 dark:text-zinc-400">
                    Confirmar nueva contraseña
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repite tu nueva contraseña"
                    required
                    className="w-full text-xs font-semibold rounded-2xl border border-black/5 bg-neutral-50 px-4 py-3.5 outline-none focus:border-[#C4B5FD] dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-50 dark:focus:border-[#A78BFA]"
                  />
                </div>

                {passwordError && (
                  <div className="rounded-2xl bg-rose-50 border border-rose-100 p-3.5 text-xs font-bold text-rose-800 text-center dark:bg-rose-950/20 dark:border-rose-900/30 dark:text-rose-450">
                    ⚠️ {passwordError}
                  </div>
                )}

                {passwordSuccess && (
                  <div className="rounded-2xl bg-emerald-50 border border-emerald-100 p-3.5 text-xs font-bold text-emerald-850 text-center dark:bg-emerald-950/20 dark:border-emerald-900/30 dark:text-emerald-450 animate-bounce">
                    🎉 {passwordSuccess}
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
          <div className="w-full max-w-md rounded-[32px] border border-black/5 bg-white p-6 shadow-2xl dark:bg-zinc-950 dark:border-zinc-900 animate-scaleUp">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-sm font-black uppercase tracking-wider">Centro de Desarrollador</h3>
              <button
                type="button"
                onClick={() => setShowDeveloperSettings(false)}
                className="h-8 w-8 rounded-full flex items-center justify-center border border-black/5 dark:border-zinc-900 bg-neutral-50 dark:bg-zinc-900 font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <label className="block space-y-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-neutral-500">API Endpoint Base</span>
                <input
                  type="text"
                  value={apiBase}
                  onChange={(e) => setApiBase(e.target.value)}
                  placeholder="/api"
                  className="w-full rounded-xl border border-black/5 bg-neutral-50 px-4 py-3 text-xs outline-none focus:border-neutral-300 dark:bg-zinc-900 dark:border-zinc-800"
                />
              </label>

              {/* Geolocalización del Contrato */}
              {driverProfile && (
                <div className="rounded-2xl border border-black/5 bg-neutral-50 p-4 dark:bg-zinc-900/60 space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-wider text-neutral-400">Geolocalización GPS</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-[9px] text-neutral-400 uppercase block">Latitud</span>
                      <span className="font-bold">{formatCoordinate(driverProfile.currentLatitude)}</span>
                    </div>
                    <div>
                      <span className="text-[9px] text-neutral-400 uppercase block">Longitud</span>
                      <span className="font-bold">{formatCoordinate(driverProfile.currentLongitude)}</span>
                    </div>
                  </div>
                </div>
              )}

              <p className="text-[10px] text-neutral-500 leading-relaxed">
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
          <div className="w-full max-w-sm rounded-[32px] border border-black/5 bg-white p-6 shadow-2xl dark:bg-zinc-950 dark:border-zinc-900 animate-scaleUp">
            <div className="text-center mb-5">
              <span className="text-[9px] font-black uppercase tracking-widest text-[#A78BFA] block">Seguridad del Restaurante</span>
              <h3 className="text-xl font-black text-neutral-900 dark:text-zinc-50 mt-1">Verificar Recogida</h3>
              <p className="text-xs text-neutral-500 dark:text-zinc-400 mt-1 leading-relaxed">
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
                className="w-full text-center tracking-[0.6em] text-lg font-black rounded-2xl border border-black/5 bg-neutral-50 py-3.5 outline-none focus:border-[#C4B5FD] dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-50 dark:focus:border-[#A78BFA]"
                autoFocus
              />

              {pinModalError && (
                <div className="rounded-xl bg-rose-50/80 border border-rose-100 p-3 text-[11px] font-bold text-rose-800 text-center dark:bg-rose-950/20 dark:border-rose-900/30 dark:text-rose-400">
                  ⚠️ {pinModalError}
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
                  className="py-3.5 rounded-2xl text-xs font-black uppercase tracking-wider border border-black/10 bg-white hover:bg-neutral-50 dark:bg-zinc-950 dark:border-zinc-900"
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
        <div className="fixed bottom-8 left-0 right-0 flex justify-center px-6 z-40 pointer-events-none">
          <button
            type="button"
            onClick={() => {
              if (driverProfile?.isSuspendedByDebt) {
                setHideSuspensionOverlay(false);
              } else if (driverProfile?.availability === 'AVAILABLE' || driverProfile?.availability === 'BUSY') {
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
                <svg className="h-7 w-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
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

      {/* ==========================================
          PANTALLA DE BLOQUEO POR DEUDA (FULL SCREEN)
          ========================================== */}
      {driverProfile?.isSuspendedByDebt && !hideSuspensionOverlay && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#f5f1e8] dark:bg-black p-6">
          <div className="w-full max-w-md mx-auto text-center">
            <div className="rounded-[32px] bg-rose-600/95 p-8 text-white shadow-2xl backdrop-blur-md shadow-rose-900/50 border border-rose-500">
              <span className="text-5xl mb-4 block">🛑</span>
              <h2 className="text-xl font-black uppercase tracking-widest mb-2">Cuenta Suspendida</h2>
              <p className="text-sm text-rose-100 font-bold leading-relaxed">
                No puedes trabajar hasta que liquides tu deuda pendiente de la semana anterior.
              </p>
              <div className="mt-6 inline-block bg-white/20 rounded-2xl px-6 py-4 border border-white/30">
                <p className="text-[10px] uppercase tracking-widest text-rose-100 font-black mb-1">Deuda Vencida</p>
                <p className="text-3xl font-black">{formatCurrency(driverProfile.suspendedDebtAmount || 0)}</p>
              </div>
              <button
                type="button"
                onClick={() => { setHideSuspensionOverlay(true); setActiveTab('wallet'); }}
                className="mt-4 w-full py-3 rounded-full border-2 border-white/40 text-white text-xs font-black uppercase tracking-widest hover:bg-white/10 transition-colors"
              >
                Ir a Billetera
              </button>
            </div>
          </div>
        </div>
      )}



      <audio id="driver-alert-audio" src="/sounds/notifica.wav" preload="auto" loop></audio>

      {/* ==========================================
          MODAL DE PAGO
          ========================================== */}
      {showPayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[32px] bg-white p-6 shadow-2xl dark:bg-zinc-950 dark:border-zinc-900 animate-fadeIn">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2Z" /></svg>
                  </div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-sky-600 dark:text-sky-400">Liquidación</p>
                </div>
                <h3 className="text-xl font-black text-neutral-900 dark:text-zinc-100">Pagar Deuda</h3>
              </div>
              <button
                type="button"
                onClick={() => { setShowPayModal(false); setProofPreviewBase64(null); }}
                className="h-8 w-8 rounded-full flex items-center justify-center border border-black/5 dark:border-zinc-900 bg-neutral-50 dark:bg-zinc-900"
              >
                ✕
              </button>
            </div>

            <div className="space-y-5">
              {/* Amount hero */}
              <div className="relative overflow-hidden rounded-[24px] bg-neutral-900 dark:bg-zinc-800 p-5 text-white shadow-lg">
                <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/5 blur-3xl"></div>
                <div className="relative z-10">
                  <p className="text-xs font-medium text-neutral-400">Total a liquidar</p>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-3xl font-black">{formatCurrency(walletData?.pastDebt || 0)}</span>
                    <span className="text-sm font-semibold text-neutral-400">MXN</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(String(walletData?.pastDebt || '0'));
                      pushToast('success', 'Copiado', 'Monto copiado al portapapeles.');
                    }}
                    className="mt-2 inline-flex items-center gap-1.5 text-[10px] font-bold text-neutral-300 hover:text-white transition"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
                    Copiar monto
                  </button>
                </div>
              </div>

              {/* Bank details */}
              <div className="rounded-[20px] border border-black/5 dark:border-zinc-800 bg-neutral-50 dark:bg-zinc-900/50 p-1">
                <div className="flex items-center gap-2 border-b border-black/5 dark:border-zinc-800 px-4 py-3">
                  <svg className="h-4 w-4 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 dark:text-zinc-400">Datos Bancarios</span>
                </div>
                {bankDetailsError ? (
                  <div className="px-4 py-4 text-center">
                    <p className="text-[11px] font-bold text-rose-600 dark:text-rose-400">Error al cargar datos bancarios</p>
                    <p className="text-[10px] text-neutral-500 mt-1">Intenta de nuevo o contacta a soporte.</p>
                  </div>
                ) : !bankDetailsLoaded ? (
                  <div className="px-4 py-4 text-center">
                    <div className="animate-spin h-5 w-5 border-2 border-sky-500 border-t-transparent rounded-full mx-auto"></div>
                    <p className="text-[10px] text-neutral-400 mt-2">Cargando datos bancarios...</p>
                  </div>
                ) : (
                  <div className="divide-y divide-black/5 dark:divide-zinc-800">
                    {[
                      { label: 'Banco', value: adminBankName },
                      { label: 'Cuenta', value: adminBankAccount },
                      { label: 'Beneficiario', value: adminBankBeneficiary },
                    ].map((row) => (
                      <div key={row.label} className="flex items-center justify-between px-4 py-2.5">
                        <span className="text-[11px] font-semibold text-neutral-500 dark:text-zinc-400">{row.label}</span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-black text-neutral-900 dark:text-zinc-100">{row.value}</span>
                          <button
                            type="button"
                            onClick={() => { navigator.clipboard.writeText(row.value); pushToast('success', 'Copiado', `${row.label} copiado.`); }}
                            className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900 active:scale-90 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100 transition"
                            title={`Copiar ${row.label.toLowerCase()}`}
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Upload proof */}
              <div className="rounded-[20px] border border-black/5 dark:border-zinc-800 p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 dark:text-zinc-400 mb-3">Sube tu comprobante de pago</p>
                {proofPreviewBase64 ? (
                  <div className="space-y-3">
                    <div className="relative rounded-2xl overflow-hidden bg-neutral-100 dark:bg-zinc-900 border border-black/5 dark:border-zinc-800 p-2">
                      <img src={proofPreviewBase64} alt="Vista previa" className="w-full max-h-40 object-contain rounded-xl" />
                      <button
                        type="button"
                        onClick={() => setProofPreviewBase64(null)}
                        disabled={uploadingProof}
                        className="absolute top-3 right-3 bg-black/60 text-white rounded-full p-1.5 hover:bg-black/80 transition disabled:opacity-50"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={handleSubmitPaymentProof}
                      disabled={uploadingProof}
                      className="w-full py-3 bg-neutral-950 dark:bg-white text-white dark:text-neutral-950 rounded-xl text-sm font-black uppercase tracking-widest hover:bg-neutral-800 dark:hover:bg-neutral-200 transition disabled:opacity-50"
                    >
                      {uploadingProof ? 'Subiendo...' : 'Enviar Comprobante'}
                    </button>
                  </div>
                ) : (
                  <>
                    <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleSelectPaymentProof} />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingProof}
                      className="w-full py-3 border-2 border-dashed border-neutral-300 dark:border-zinc-700 rounded-xl text-xs font-bold text-neutral-500 dark:text-zinc-400 hover:border-neutral-400 dark:hover:border-zinc-600 transition disabled:opacity-50"
                    >
                      📸 Seleccionar foto del comprobante
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==========================================
          MODAL DE DETALLE DEL PERÍODO DE PAGO
          ========================================== */}
      {showSettlementDetailModal && selectedSettlement && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[32px] border border-black/5 bg-white p-6 shadow-2xl dark:bg-zinc-950 dark:border-zinc-900 animate-fadeIn max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center mb-4 shrink-0">
              <h3 className="text-sm font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Detalle del Período</h3>
              <button
                type="button"
                onClick={() => setShowSettlementDetailModal(false)}
                className="h-8 w-8 rounded-full flex items-center justify-center border border-black/5 dark:border-zinc-900 bg-neutral-50 dark:bg-zinc-900"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <div className="rounded-2xl bg-neutral-50 dark:bg-zinc-900/50 p-4 mb-4">
                <p className="text-xs text-neutral-500 dark:text-zinc-400">
                  Período: {new Date(selectedSettlement.periodStart).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })} - {new Date(selectedSettlement.periodEnd).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
                <div className="flex justify-between items-baseline mt-2">
                  <span className="text-xs font-bold text-neutral-500 dark:text-zinc-400">
                    {selectedSettlement.status === 'PENDING' && (walletData?.pastDebt || 0) > 0 ? 'Deuda pendiente:' : 'Total pagado:'}
                  </span>
                  <span className="text-xl font-black text-emerald-600 dark:text-emerald-400">{formatCurrency(
                    selectedSettlement.status === 'PENDING' && (walletData?.pastDebt || 0) > 0 ? (walletData?.pastDebt ?? 0) : selectedSettlement.amount
                  )}</span>
                </div>
                <span className={`inline-block mt-2 text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full ${
                  selectedSettlement.status === 'PAID'
                    ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                    : selectedSettlement.status === 'IN_REVIEW'
                      ? 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300'
                      : 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300'
                }`}>
                  {selectedSettlement.status === 'PAID' && '✅ Pagado'}
                  {selectedSettlement.status === 'IN_REVIEW' && '🔍 En revisión'}
                  {selectedSettlement.status === 'REJECTED' && '❌ Rechazado'}
                  {selectedSettlement.status === 'PENDING' && '⏳ Pendiente'}
                  {selectedSettlement.status === 'OVERDUE' && '🚨 Vencido'}
                </span>
              </div>

              <div className="space-y-2">
                {loadingSettlementOrders ? (
                  <div className="flex justify-center py-8">
                    <div className="animate-spin h-6 w-6 border-2 border-emerald-500 border-t-transparent rounded-full"></div>
                  </div>
                ) : settlementPeriodOrders.length > 0 ? (
                  settlementPeriodOrders.map((order: any) => (
                    <div key={order.id} className="flex justify-between items-center p-3 rounded-2xl bg-neutral-50 dark:bg-zinc-900/50 border border-neutral-100 dark:border-zinc-800">
                      <div>
                        <p className="text-xs font-black text-neutral-900 dark:text-zinc-100">{order.orderReference}</p>
                        <p className="text-[10px] text-neutral-500 dark:text-zinc-400 mt-0.5">
                          {new Date(order.deliveredAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}
                        </p>
                      </div>
                      <span className="text-sm font-black text-rose-600 dark:text-rose-400">{formatCurrency(order.driverPlatformFee)}</span>
                    </div>
                  ))
                ) : (
                  <p className="text-center text-xs text-neutral-400 py-4">No se encontraron pedidos en este período.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Comprobante de Pago */}
      {showProofSentModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setShowProofSentModal(false)}
        >
          <div
            className="relative w-full max-w-sm rounded-[32px] border border-emerald-200 bg-white p-7 shadow-2xl dark:border-emerald-900/30 dark:bg-zinc-950 animate-scaleUp"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setShowProofSentModal(false)}
              className="absolute top-3 right-3 flex h-6 w-6 items-center justify-center rounded-full text-neutral-400 hover:text-neutral-700 dark:hover:text-zinc-200 transition"
            >
              ✕
            </button>
            <div className="text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/30 mb-4">
                <svg className="h-8 w-8 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-black text-neutral-900 dark:text-zinc-50">¡Listo!</h3>
              <p className="mt-2 text-sm text-neutral-500 dark:text-zinc-400 leading-relaxed">
                Comprobante enviado. La administración lo revisará y confirmará tu pago.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowProofSentModal(false)}
              className="mt-6 w-full rounded-full bg-emerald-600 hover:bg-emerald-700 active:scale-[0.97] text-white py-3 text-sm font-bold shadow-md shadow-emerald-600/20 transition"
            >
              Entendido
            </button>
          </div>
        </div>
      )}

      {showProofModal && proofImageUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={() => setShowProofModal(false)}>
          <div className="relative w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setShowProofModal(false)}
              className="absolute -top-3 -right-3 z-10 h-9 w-9 rounded-full bg-white dark:bg-zinc-900 border border-black/10 dark:border-zinc-700 flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition text-neutral-700 dark:text-zinc-300 text-sm"
            >
              ✕
            </button>
            <div className="rounded-[24px] overflow-hidden bg-white dark:bg-zinc-950 shadow-2xl border border-black/10 dark:border-zinc-800">
              <img
                src={proofImageUrl}
                alt="Comprobante de pago"
                className="w-full h-auto max-h-[80vh] object-contain"
              />
            </div>
            <div className="mt-3 flex justify-center gap-3">
              <a
                href={proofImageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 backdrop-blur-md px-4 py-2 text-[11px] font-bold text-white hover:bg-white/20 transition"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                Abrir en nueva pestaña
              </a>
              <button
                type="button"
                onClick={() => setShowProofModal(false)}
                className="rounded-xl bg-white/10 backdrop-blur-md px-4 py-2 text-[11px] font-bold text-white hover:bg-white/20 transition"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Detalle de Deuda */}
      {showDebtModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[32px] border border-black/5 bg-white p-6 shadow-2xl dark:bg-zinc-950 dark:border-zinc-900 animate-fadeIn max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center mb-4 shrink-0">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-sky-500" />
                <h3 className="text-sm font-black uppercase tracking-wider text-sky-600 dark:text-sky-400">
                  {debtModalMode === 'past' ? 'Corte de Semana Pasada' : 'Deuda de esta Semana'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowDebtModal(false)}
                className="h-8 w-8 rounded-full flex items-center justify-center border border-black/5 dark:border-zinc-900 bg-neutral-50 dark:bg-zinc-900 hover:bg-neutral-100 dark:hover:bg-zinc-800 transition"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto min-h-[200px]">
              {loadingDebtDetails ? (
                <div className="h-full flex items-center justify-center">
                  <div className="animate-spin h-6 w-6 border-2 border-sky-500 border-t-transparent rounded-full"></div>
                </div>
              ) : debtModalError ? (
                <div className="h-full flex flex-col items-center justify-center gap-3 px-4">
                  <p className="text-xs font-bold text-rose-600 dark:text-rose-400">Error al cargar la deuda</p>
                  <button
                    onClick={() => openDebtModal(debtModalMode)}
                    className="px-4 py-2 bg-neutral-100 dark:bg-zinc-900 text-xs font-bold rounded-xl hover:bg-neutral-200 dark:hover:bg-zinc-800 transition"
                  >
                    Reintentar
                  </button>
                </div>
              ) : debtDetails && (debtDetails.pastOrders.length > 0 || debtDetails.currentOrders.length > 0) ? (
                <div className="space-y-4">
                  {/* Semana Pasada */}
                  {debtModalMode === 'past' && debtDetails.pastOrders.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-[9px] font-black uppercase tracking-widest text-sky-600 dark:text-sky-400">Semana Pasada</span>
                        <div className="flex-1 h-px bg-sky-200/50 dark:bg-sky-900/30" />
                      </div>
                      <div className="space-y-2">
                        {debtDetails.pastOrders.map(order => (
                          <div key={order.id} className="flex justify-between items-center p-3 rounded-2xl bg-sky-50/50 dark:bg-sky-950/20 border border-sky-100 dark:border-sky-900/30">
                            <div className="min-w-0 flex-1 mr-3">
                              <p className="text-xs font-black text-neutral-900 dark:text-zinc-100 truncate">Pedido {order.orderReference}</p>
                              <p className="text-[10px] text-neutral-500 dark:text-zinc-400 mt-0.5">
                                Entregado: {new Date(order.deliveredAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                              </p>
                            </div>
                            <span className="text-sm font-black text-sky-700 dark:text-sky-400 shrink-0">
                              +{formatCurrency(order.driverPlatformFee)}
                            </span>
                          </div>
                        ))}
                        <div className="flex justify-between items-center px-3 py-2 border-t border-sky-100/50 dark:border-sky-900/20 mt-2">
                          <span className="text-[10px] font-black text-sky-700 dark:text-sky-400">Subtotal</span>
                          <span className="text-sm font-black text-sky-700 dark:text-sky-400">{formatCurrency(debtDetails.pastDebt)}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Semana Actual */}
                  {debtModalMode === 'current' && debtDetails.currentOrders.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-[9px] font-black uppercase tracking-widest text-sky-600 dark:text-sky-400">Semana Actual</span>
                        <div className="flex-1 h-px bg-sky-200/50 dark:bg-sky-900/30" />
                      </div>
                      <p className="text-[10px] text-neutral-500 dark:text-zinc-400 mb-3 leading-relaxed">
                        Pedidos entregados esta semana que generaron comisión. Se cortarán el próximo domingo.
                      </p>
                      <div className="space-y-2">
                        {debtDetails.currentOrders.map(order => (
                          <div key={order.id} className="flex justify-between items-center p-3 rounded-2xl bg-sky-50/50 dark:bg-sky-950/20 border border-sky-100 dark:border-sky-900/30">
                            <div className="min-w-0 flex-1 mr-3">
                              <p className="text-xs font-black text-neutral-900 dark:text-zinc-100 truncate">Pedido {order.orderReference}</p>
                              <p className="text-[10px] text-neutral-500 dark:text-zinc-400 mt-0.5">
                                Entregado: {new Date(order.deliveredAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                              </p>
                            </div>
                            <span className="text-sm font-black text-sky-700 dark:text-sky-400 shrink-0">
                              +{formatCurrency(order.driverPlatformFee)}
                            </span>
                          </div>
                        ))}
                        <div className="flex justify-between items-center px-3 py-2 border-t border-sky-100/50 dark:border-sky-900/20 mt-2">
                          <span className="text-[10px] font-black text-sky-700 dark:text-sky-400">Subtotal</span>
                          <span className="text-sm font-black text-sky-700 dark:text-sky-400">{formatCurrency(debtDetails.currentDebt)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-xs text-neutral-400 text-center px-4">
                  No hay deuda pendiente de cobro.<br/>¡Todo al corriente!
                </div>
              )}
            </div>

            {!loadingDebtDetails && debtDetails && (
              <div className="mt-4 pt-4 border-t border-black/5 dark:border-zinc-900 flex justify-between items-end shrink-0">
                <span className="text-xs font-black uppercase tracking-wider text-neutral-500">
                  {debtModalMode === 'past' ? 'Total corte pasado' : 'Deuda esta semana'}
                </span>
                <span className="text-2xl font-black text-sky-600 dark:text-sky-400">
                  {formatCurrency(debtModalMode === 'past' ? debtDetails.pastDebt : debtDetails.currentDebt)}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal de Detalle del Pedido en Historial */}
      {selectedHistoryOrder && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/70 backdrop-blur-md">
          <div className="w-full max-w-md rounded-[32px] bg-white shadow-2xl dark:bg-zinc-950 animate-fadeIn max-h-[85vh] flex flex-col overflow-hidden border border-black/5 dark:border-zinc-900">
            <div className="h-[3px] bg-sky-400/40 shrink-0" />

            <div className="p-5 pt-4 shrink-0 border-b border-black/5 dark:border-zinc-900">
              <div className="flex justify-between items-start">
                <div className="flex items-start gap-3">
                  <span className="h-9 w-9 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center text-white text-sm shadow-lg shadow-emerald-500/20 shrink-0 mt-0.5">✓</span>
                  <div>
                    <h3 className="text-sm font-black text-neutral-900 dark:text-zinc-50 leading-tight">
                      {selectedHistoryOrder.customer?.user?.name
                        ? `${selectedHistoryOrder.restaurant.name} — ${selectedHistoryOrder.customer.user.name}`
                        : selectedHistoryOrder.orderReference
                      }
                    </h3>
                    <p className="text-[9px] font-mono text-neutral-400 dark:text-zinc-500 mt-0.5 tracking-tight">
                      {selectedHistoryOrder.orderReference}
                      {selectedHistoryOrder.dailyCounter != null && (
                        <span className="ml-2 text-[9px] font-bold text-neutral-400 dark:text-zinc-500 not-italic font-sans">
                          · Pedido #{selectedHistoryOrder.dailyCounter}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedHistoryOrder(null)}
                  className="h-7 w-7 rounded-full flex items-center justify-center bg-neutral-100 dark:bg-zinc-900 text-neutral-400 hover:bg-neutral-200 dark:hover:bg-zinc-800 hover:text-neutral-600 dark:hover:text-zinc-300 transition-colors shrink-0 ml-3"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 pt-4 space-y-3">
              {/* Fecha de entrega */}
              <div className="flex items-center justify-between px-4 py-3 rounded-2xl bg-sky-50/60 dark:bg-sky-950/20 border border-sky-100/80 dark:border-sky-900/40">
                <span className="text-[9px] font-black uppercase tracking-wider text-sky-600 dark:text-sky-400 flex items-center gap-1.5">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  Entregado
                </span>
                <span className="text-xs font-bold text-neutral-800 dark:text-zinc-200">
                  {selectedHistoryOrder.deliveredAt ? formatDate(selectedHistoryOrder.deliveredAt) : '—'}
                </span>
              </div>

              {/* Restaurante / Tienda */}
              <div className="p-4 rounded-2xl bg-white dark:bg-zinc-900/60 border border-neutral-100 dark:border-zinc-800 shadow-sm">
                <span className="text-[9px] font-black uppercase tracking-wider text-neutral-400 flex items-center gap-1.5">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" /></svg>
                  {selectedHistoryOrder.restaurant.businessType && selectedHistoryOrder.restaurant.businessType !== 'RESTAURANT' ? 'Tienda' : 'Restaurante'}
                </span>
                <p className="text-sm font-black text-neutral-900 dark:text-zinc-50 mt-1.5">{selectedHistoryOrder.restaurant.name}</p>
                {selectedHistoryOrder.restaurant.address && (
                  <p className="text-[10px] text-neutral-500 dark:text-zinc-400 mt-1 leading-relaxed flex items-start gap-1">
                    <svg className="w-2.5 h-2.5 mt-0.5 shrink-0 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    {selectedHistoryOrder.restaurant.address}
                  </p>
                )}
              </div>

              {/* Dirección de entrega */}
              <div className="p-4 rounded-2xl bg-white dark:bg-zinc-900/60 border border-neutral-100 dark:border-zinc-800 shadow-sm">
                <span className="text-[9px] font-black uppercase tracking-wider text-neutral-400 flex items-center gap-1.5">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  Dirección de Entrega
                </span>
                {selectedHistoryOrder.address ? (
                  <>
                    <p className="text-sm font-black text-neutral-900 dark:text-zinc-50 mt-1.5">
                      {selectedHistoryOrder.address.street} {selectedHistoryOrder.address.number}
                    </p>
                    <p className="text-[10px] text-neutral-500 dark:text-zinc-400 mt-0.5">
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
                  <p className="text-xs text-neutral-400 mt-1.5">No disponible</p>
                )}
              </div>

              {/* Distancia */}
              {selectedHistoryOrder.restaurant.latitude != null &&
               selectedHistoryOrder.restaurant.longitude != null &&
               selectedHistoryOrder.latitude != null &&
               selectedHistoryOrder.longitude != null && (
                <div className="flex items-center justify-between px-4 py-3 rounded-2xl bg-neutral-50/80 dark:bg-zinc-900/40 border border-neutral-100 dark:border-zinc-800">
                  <span className="text-[9px] font-black uppercase tracking-wider text-neutral-400 flex items-center gap-1.5">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
                    Distancia Recorrida
                  </span>
                  <span className="text-xs font-black text-neutral-900 dark:text-zinc-50">
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
              <div className="rounded-2xl bg-gradient-to-b from-white to-neutral-50/80 dark:from-zinc-900/80 dark:to-zinc-900/40 border border-neutral-100 dark:border-zinc-800 overflow-hidden shadow-sm">
                <div className="px-4 pt-3.5 pb-2 bg-gradient-to-r from-sky-500/5 to-transparent">
                  <span className="text-[9px] font-black uppercase tracking-wider text-sky-600 dark:text-sky-400 flex items-center gap-1.5">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    Resumen Financiero
                  </span>
                </div>
                <div className="divide-y divide-neutral-100 dark:divide-zinc-800">
                  <div className="flex justify-between items-center px-4 py-3">
                    <span className="text-[11px] font-bold text-neutral-600 dark:text-zinc-400">Cobrado al Comensal</span>
                    <span className="text-sm font-black text-neutral-950 dark:text-zinc-50">
                      {formatCurrency(selectedHistoryOrder.totalAmount || 0)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center px-4 py-3">
                    <span className="text-[11px] font-bold text-neutral-600 dark:text-zinc-400">Pagado al{selectedHistoryOrder.restaurant.businessType && selectedHistoryOrder.restaurant.businessType !== 'RESTAURANT' ? 'a Tienda' : ' Restaurante'}</span>
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
                    <span className="text-[11px] font-bold text-neutral-600 dark:text-zinc-400">Tipo de Pago</span>
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
                <div className="rounded-2xl bg-white dark:bg-zinc-900/60 border border-neutral-100 dark:border-zinc-800 overflow-hidden shadow-sm">
                  <div className="px-4 pt-3.5 pb-2 border-b border-neutral-100 dark:border-zinc-800">
                    <span className="text-[9px] font-black uppercase tracking-wider text-neutral-400 flex items-center gap-1.5">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
                      Artículos ({selectedHistoryOrder.items.length})
                    </span>
                  </div>
                  <div className="divide-y divide-neutral-100 dark:divide-zinc-800">
                    {selectedHistoryOrder.items.map((item) => (
                      <div key={item.id} className="px-4 py-3">
                        <div className="flex justify-between items-start">
                          <div className="flex-1 min-w-0 mr-3">
                            <p className="text-xs font-black text-neutral-900 dark:text-zinc-50 truncate">
                              {item.quantity}x {item.product.name}
                            </p>
                            {item.options && item.options.length > 0 && (
                              <p className="text-[9px] text-neutral-400 dark:text-zinc-500 mt-0.5 truncate">
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
            <div className="w-full max-w-md rounded-3xl bg-white dark:bg-zinc-900 p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
              <div className="flex flex-col items-center text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-950/30 text-3xl mb-4">
                  ⛓️‍💥
                </div>
                <h2 className="text-xl font-black text-neutral-950 dark:text-zinc-50">¿Liberar pedido?</h2>
                <p className="text-sm text-neutral-500 dark:text-zinc-400 mt-2 leading-relaxed">
                  Has esperado <strong className="text-neutral-700 dark:text-zinc-300">{waitMin} minutos</strong> en el establecimiento.
                  Puedes liberarte de este pedido para que otro repartidor lo tome.
                </p>
                <p className="text-xs text-neutral-400 dark:text-zinc-500 mt-3 leading-relaxed bg-neutral-50 dark:bg-zinc-800/50 rounded-xl px-4 py-3 w-full">
                  Agradecemos tu espera y compromiso. Si decides liberarlo,{' '}
                  <strong>no se te volverá a asignar este pedido</strong> y podrás recibir otros.
                </p>
                <div className="flex gap-3 w-full mt-6">
                  <button
                    type="button"
                    onClick={() => { setReleaseConfirmOrderId(null); triggerHaptic(10); }}
                    className="flex-1 py-3.5 rounded-2xl border border-neutral-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm font-bold text-neutral-600 dark:text-zinc-400 transition active:scale-[0.97] hover:bg-neutral-50 dark:hover:bg-zinc-700"
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

const socketStatusCopy: Record<'idle' | 'connecting' | 'connected' | 'reconnecting', string> = {
  idle: 'Desconectado',
  connecting: 'Estableciendo enlace...',
  connected: 'Conexión activa',
  reconnecting: 'Reenlazando...',
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
