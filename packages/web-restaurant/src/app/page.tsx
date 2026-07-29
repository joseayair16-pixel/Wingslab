'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { QRCodeSVG } from 'qrcode.react';
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
  uploadMediaAsset,
  convertImageFileToDataUrl,
} from '@sadel/shared';

import { printHtmlString } from '../utils/printHelper';
import { generateTicketHtml } from '../utils/ticketGenerator';
import { SaDelLogo } from '../components/SaDelLogo';
import { DashboardSection } from '../components/sections/DashboardSection';
import { BillingSection } from '../components/sections/BillingSection';
import { SettingsSection } from '../components/sections/SettingsSection';
import { FeaturedSection } from '../components/sections/FeaturedSection';

type OrderStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'PREPARING'
  | 'READY'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'COMPLETED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'REJECTED';

type StoreCategoryItem = {
  id: string;
  name: string;
  icon: string;
  color?: string | null;
  keywords: string[];
  isActive: boolean;
  order: number;
};

type RestaurantProfile = {
  id: string;
  name: string;
  description: string;
  address: string;
  latitude?: number | null;
  longitude?: number | null;
  region: string;
  businessType?: string;
  status: string;
  statusReason?: string | null;
  isAcceptingOrders: boolean;
  isPaused: boolean;
  contactPhone: string;
  email: string;
  logo?: string | null;
  coverImage?: string | null;
  deliveryFee?: number | null;
  deliveryRadius?: number | null;
  hasOwnDelivery: boolean;
  minDeliveryTime: number;
  maxDeliveryTime: number;
  transferBankName?: string | null;
  transferAccountNumber?: string | null;
  transferBeneficiaryName?: string | null;
  operatingHours?: OperatingHourItem[];
  stats?: {
    rating: number;
    reviewCount: number;
  } | null;
  storeCategories?: {
    category: StoreCategoryItem;
  }[];
  enableTicketPrinting?: boolean;
  whatsappNotifications?: boolean;
  instagram?: string | null;
  facebook?: string | null;
  tiktok?: string | null;
  featuredFlyer?: string | null;
};

type OperatingHourItem = {
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
};

type OrderItem = {
  id: string;
  orderReference: string;
  restaurantId?: string;
  supportRestaurantId?: string | null;
  status: OrderStatus;
  totalAmount: number;
  deliveryFee: number;
  serviceFee?: number;
  platformFee?: number;
  paymentMethod?: 'CASH' | 'TRANSFER' | 'CREDIT_CARD' | 'DEBIT_CARD' | 'DIGITAL_WALLET';
  paymentStatus?: 'PENDING' | 'COMPLETED' | 'FAILED';
  paymentProofUrl?: string | null;
  fulfillmentType?: 'DELIVERY' | 'PICKUP';
  pickupPin?: string | null;
  handoverPin?: string | null;
  handoverPinAttempts?: number;
  handoverPinUpdatedAt?: string | null;
  createdAt: string;
  estimatedDeliveryTime?: string;
  scheduledDeliveryAt?: string;
  preparationTimeMinutes?: number | null;
  preparationStartedAt?: string | null;
  preparationDeadlineAt?: string | null;
  cashPaymentConfirmedAt?: string | null;
  driverArrivedAt?: string | null;
  etaExtendedMinutes?: number;
  deliveryPreference?: 'NO_DOORBELL' | 'CALL_ON_ARRIVAL' | 'PREFER_WHATSAPP' | 'HONK_ON_ARRIVAL' | 'BEWARE_OF_DOG' | null;
  notes?: string | null;
  noDriversAvailable?: boolean;
  isAcceptedByDriver?: boolean;
  batchId?: string | null;
  deliverySequence?: number | null;
  deliveredByRestaurant?: boolean;
  address?: {
    street: string;
    number: string;
    neighborhood: string;
    reference?: string | null;
  };
  items?: Array<{
    id: string;
    quantity: number;
    specialInstructions?: string | null;
    sellBy?: string;
    weightG?: number | null;
    unitPrice?: number | null;
    product?: {
      id: string;
      name: string;
      image?: string | null;
    };
    options?: Array<{
      id: string;
      optionId: string;
      name: string;
      price: number;
    }>;
  }>;
  driver?: {
    id: string;
    user?: {
      id?: string;
      name?: string;
      phone?: string;
      profilePhoto?: string | null;
    };
  } | null;
  customer?: {
    user?: {
      name?: string;
      phone?: string;
      profilePhoto?: string | null;
    };
  };
  restaurant?: {
    id: string;
    name: string;
    hasOwnDelivery: boolean;
  };
};

type ProductOption = {
  id?: string;
  name: string;
  price: number;
  isAvailable?: boolean;
};

type ProductOptionGroup = {
  id?: string;
  name: string;
  minSelection: number;
  maxSelection: number;
  options: ProductOption[];
};

type ProductItem = {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  price: number;
  discountPrice?: number | null;
  sellBy?: 'UNIT' | 'WEIGHT';
  unitPrice?: number | null;
  minWeightG?: number | null;
  maxWeightG?: number | null;
  stepWeightG?: number | null;
  weightPresets?: number[] | null;
  image?: string | null;
  images?: string[];
  imagePosition?: string | null;
  imageZoom?: number | null;
  isAdultOnly?: boolean;
  isAvailable: boolean;
  preparationTime: number;
  category?: {
    id?: string;
    name: string;
  };
  optionGroups?: ProductOptionGroup[];
};

type CategoryItem = {
  id: string;
  name: string;
  description?: string | null;
  order: number;
};

type DriverItem = {
  id: string;
  user?: {
    name: string;
    phone: string;
  };
};

type BillingCycle = 'WEEKLY' | 'MONTHLY';

type RestaurantBillingSummary = {
  currentDebt: number;
  deliveredRevenue: number;
  serviceFeeRevenue: number;
  platformFeeRevenue: number;
  deliveredOrders: number;
  platformFeeRate: number;
  serviceFee: number;
  platformFeePerOrder: number;
  billingCycle: BillingCycle;
  periodStart: string;
  periodEnd: string;
  nextChargeDate: string;
  recentSettlements: Array<{
    id: string;
    amount: number;
    reference: string;
    settledAt?: string | null;
    status: 'PENDING' | 'PAID' | 'OVERDUE' | 'IN_REVIEW';
    dueDate?: string | null;
    periodStart: string;
    periodEnd: string;
    serviceFeeTotal: number;
    platformFeeTotal: number;
    paymentProofUrl?: string | null;
    createdAt: string;
    updatedAt?: string | null;
  }>;
};

type SuccessResponse<T> = {
  success: true;
  data: T;
};

type ToastItem = {
  id: string;
  tone: 'info' | 'success' | 'error';
  title: string;
  message: string;
};

type RestaurantRetryAction =
  | {
    kind: 'order-action';
    orderId: string;
    actionKey: keyof typeof restaurantActionMap;
    label: string;
  }
  | {
    kind: 'assign-driver';
    orderId: string;
    driverId: string;
    label: string;
  };

type RestaurantPortalSection = 'dashboard' | 'orders' | 'store' | 'settings' | 'billing' | 'featured';
type PreparationPresetMinutes = 10 | 15 | 20 | 30 | 45 | 60;
type StoreProfileDraft = {
  name: string;
  description: string;
  address: string;
  houseNumber: string;
  latitude: string;
  longitude: string;
  contactPhone: string;
  email: string;
  logo: string;
  coverImage: string;
  hasOwnDelivery: boolean;
  minDeliveryTime: string;
  maxDeliveryTime: string;
  deliveryFee: string;
  deliveryRadius: string;
  storeCategories: string[];
  enableTicketPrinting: boolean;
  whatsappNotifications: boolean;
  instagram: string;
  facebook: string;
  tiktok: string;
};
type ProductDraft = {
  id?: string;
  categoryId: string;
  name: string;
  description: string;
  price: string;
  discountPrice?: string;
  sellBy: 'UNIT' | 'WEIGHT';
  unitPrice: string;
  minWeightG: string;
  maxWeightG: string;
  stepWeightG: string;
  weightPresets: number[];
  image: string;
  images: string[];
  imagePosition?: string;
  imageZoom?: number;
  isAdultOnly: boolean;
  preparationTime: string;
  optionGroups?: ProductOptionGroup[];
};

const defaultApiBase = 'https://sadel-production.up.railway.app';
function getCustomerOrigin(): string {
  if (process.env.NEXT_PUBLIC_CUSTOMER_URL) return process.env.NEXT_PUBLIC_CUSTOMER_URL;
  if (typeof window !== 'undefined') {
    const { hostname, port, protocol } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:3000';
    }
    const prefixes = ['restaurante.', 'restaurant.', 'admin.', 'dashboard.', 'r.'];
    for (const prefix of prefixes) {
      if (hostname.startsWith(prefix)) {
        const rest = hostname.slice(prefix.length);
        return `${protocol}//app.${rest}${port ? `:${port}` : ''}`;
      }
    }
    if (!hostname.endsWith('.vercel.app')) {
      const subdomains = hostname.split('.');
      if (subdomains.length >= 3) {
        return `${protocol}//${subdomains.slice(1).join('.')}${port ? `:${port}` : ''}`;
      }
    }
    return `${protocol}//${hostname}${port ? `:${port}` : ''}`;
  }
  return '';
}
const storageKey = 'sadel.restaurant';
const orderAlertSoundPreferenceKey = `${storageKey}.orderAlertSoundEnabled`;
const newOrderDecisionWindowMs = 2 * 60 * 1000;
const storeOrderDecisionWindowMs = 8 * 60 * 1000;
const preparationTimePresets: Array<{
  value: PreparationPresetMinutes;
  label: string;
  description: string;
}> = [
    { value: 10, label: '10 min', description: 'Pedidos rapidos y flujo ligero.' },
    { value: 15, label: '15 min', description: 'Tiempo recomendado para operacion normal.' },
    { value: 20, label: '20 min', description: 'Carga media o pedido con varios productos.' },
    { value: 30, label: '30 min', description: 'Pedido grande o cocina con alta demanda.' },
    { value: 45, label: '45 min', description: 'Volumen muy alto o platillos complejos.' },
    { value: 60, label: '1 h', description: 'Pico extremo de operaciones.' },
  ];
const assignableStatuses: OrderStatus[] = ['CONFIRMED', 'PREPARING', 'READY'];
const orderStatusOptions: Array<{ label: string; value: 'ACTIVE' | 'REJECTED' | 'CANCELLED' | 'DELIVERED' | 'COMPLETED' }> = [
  { label: 'En preparacion', value: 'ACTIVE' },
  { label: 'Entregados / Recogidos', value: 'DELIVERED' },
  { label: 'Rechazados', value: 'REJECTED' },
  { label: 'Cancelados', value: 'CANCELLED' },
];

const liveEvents = [
  'order:created',
  'order:driver-accepted',
  'order:driver-rejected',
  'order:picked-up',
  'order:in-transit',
  'order:eta-updated',
  'order:delivered',
  'order:support-requested',
  'order:no-drivers-available',
  'order:driver-arrived-restaurant',
  'order:queue-next',
  'order:cancellation-requested',
  'order:cancellation-request-retracted',
] as const;


const weekDayOptions = [
  { dayOfWeek: 0, label: 'Domingo' },
  { dayOfWeek: 1, label: 'Lunes' },
  { dayOfWeek: 2, label: 'Martes' },
  { dayOfWeek: 3, label: 'Miercoles' },
  { dayOfWeek: 4, label: 'Jueves' },
  { dayOfWeek: 5, label: 'Viernes' },
  { dayOfWeek: 6, label: 'Sabado' },
] as const;

function buildDefaultOperatingHours(): OperatingHourItem[] {
  return weekDayOptions.map((item) => ({
    dayOfWeek: item.dayOfWeek,
    openTime: '09:00',
    closeTime: '18:00',
    isClosed: item.dayOfWeek === 0,
  }));
}

function normalizeOperatingHours(items?: OperatingHourItem[]): OperatingHourItem[] {
  const defaults = buildDefaultOperatingHours();

  if (!items?.length) {
    return defaults;
  }

  return defaults.map((base) => items.find((item) => item.dayOfWeek === base.dayOfWeek) || base);
}

const restaurantActionMap: Record<
  string,
  {
    path: string;
    label: string;
    successMessage: string;
  }
> = {
  accept: {
    path: 'aceptar',
    label: 'Aceptar pedido',
    successMessage: 'Pedido aceptado y tablero sincronizado.',
  },
  reject: {
    path: 'rechazar',
    label: 'Rechazar pedido',
    successMessage: 'Pedido rechazado y tablero sincronizado.',
  },
  preparing: {
    path: 'preparacion',
    label: 'Marcar en preparacion',
    successMessage: 'Pedido movido a preparacion.',
  },
  ready: {
    path: 'listo',
    label: 'Marcar listo',
    successMessage: 'Pedido marcado como listo.',
  },
  asumirReparto: {
    path: 'asumir-reparto',
    label: 'Entregar yo mismo',
    successMessage: 'Has asumido el reparto de este pedido.',
  },
  quitarRepartidor: {
    path: 'quitar-repartidor',
    label: 'Quitar repartidor',
    successMessage: 'Se ha desvinculado al repartidor del pedido.',
  },
  delivered: {
    path: 'entregado',
    label: 'Marcar entregado',
    successMessage: 'Pedido entregado con exito.',
  },
  handover: {
    path: 'handover',
    label: 'Confirmar entrega',
    successMessage: 'Pedido entregado al repartidor exitosamente.',
  },
  cancel: {
    path: 'cancelar',
    label: 'Cancelar pedido',
    successMessage: 'Pedido cancelado exitosamente.',
  },
  solicitarApoyo: {
    path: 'solicitar-apoyo',
    label: 'Pedir apoyo a red',
    successMessage: 'Solicitud de apoyo enviada a restaurantes cercanos.',
  },
  iniciarEntrega: {
    path: 'iniciar-entrega',
    label: 'Ir a entregar',
    successMessage: 'Has iniciado la entrega del pedido.',
  },
  confirmarPagoEfectivo: {
    path: 'confirmar-pago-efectivo',
    label: 'Confirmar pago en efectivo',
    successMessage: 'Pago en efectivo confirmado. El repartidor ya puede salir.',
  },
  marcarRecogido: {
    path: 'marcar-recogido',
    label: 'Marcar como recogido',
    successMessage: 'Pedido marcado como recogido por el cliente.',
  },
} as const;

function triggerHaptic(pattern: number | number[] = 10) {
  if (typeof window !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(pattern);
  }
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}


// Tabs de configuración del restaurante (definidas a nivel de módulo)
const settingsTabs = [
  { key: 'perfil',
    icon: (<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0H5m14 0h2m-2 0h-2M5 21H3m2 0h2m0-16h6m-6 4h6m-6 4h4" /></svg>),
    label: 'Perfil público', desc: 'Identidad y datos de contacto' },
  { key: 'ubicacion',
    icon: (<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>),
    label: 'Ubicación', desc: 'Dirección y mapa' },
  { key: 'entrega',
    icon: (<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" /></svg>),
    label: 'Entrega', desc: 'Modalidad, tiempos y costos' },
  { key: 'horarios',
    icon: (<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>),
    label: 'Horarios', desc: 'Días y horas de servicio' },
  { key: 'pagos',
    icon: (<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>),
    label: 'Métodos de pago', desc: 'Transferencias y cuenta bancaria' },
  { key: 'seguridad',
    icon: (<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>),
    label: 'Seguridad', desc: 'Contraseña y acceso' },
  { key: 'preferencias',
    icon: (<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>),
    label: 'Preferencias', desc: 'Alertas y panel' },
];


function parseStoreNotes(notes?: string | null): string | null {
  if (!notes) return null;
  let parsed = notes;
  if (parsed.includes('Repartidor:')) {
    parsed = parsed.split('Repartidor:')[0];
  }
  if (parsed.startsWith('Tienda:')) {
    parsed = parsed.replace('Tienda:', '');
  }
  // Remove internal support markers if any
  parsed = parsed.replace(/\[ApoyoId:[^\]]+\]/g, '');
  parsed = parsed.trim();
  return parsed || null;
}

function getRestaurantCollectionAmount(order: OrderItem, profileHasOwnDelivery?: boolean): number {
  if (order.deliveredByRestaurant || (order.restaurant?.hasOwnDelivery ?? profileHasOwnDelivery ?? true)) {
    return order.totalAmount;
  }
  return order.totalAmount - (order.deliveryFee || 0);
}

export default function Home() {
  const [apiBase, setApiBase] = useState(defaultApiBase);
  const [token, setToken] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [checkingAuth, setCheckingAuth] = useState(true);
  const settingsMapRef = useRef<any>(null);
  const settingsMarkerRef = useRef<any>(null);
  const ignoreAddressSearchRef = useRef(false);
  const autocompleteServiceRef = useRef<any>(null);
  const autocompleteSessionTokenRef = useRef<any>(null);
  const placesServiceRef = useRef<any>(null);
  const [addressSuggestions, setAddressSuggestions] = useState<any[]>([]);
  const [isSearchingAddress, setIsSearchingAddress] = useState(false);
  const [welcomeImage, setWelcomeImage] = useState('https://images.unsplash.com/photo-1552566626-52f8b828add9?auto=format&fit=crop&w=1600&q=80');
  const [showPromoModal, setShowPromoModal] = useState(false);
  const [promoImageUrl, setPromoImageUrl] = useState('');
  const [sessionUser, setSessionUser] = useState<AuthUser | null>(null);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [error, setError] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [profile, setProfile] = useState<RestaurantProfile | null>(null);
  const [platformCategories, setPlatformCategories] = useState<StoreCategoryItem[]>([]);
  const [transferBankName, setTransferBankName] = useState('');
  const [transferAccountNumber, setTransferAccountNumber] = useState('');
  const [transferBeneficiaryName, setTransferBeneficiaryName] = useState('');
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [supportRequestsQueue, setSupportRequestsQueue] = useState<Array<{
    orderId: string;
    restaurantName: string;
    deliveryFee: number;
    address: string;
    distanceToRestaurant: number;
  }>>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [drivers, setDrivers] = useState<DriverItem[]>([]);
  const [driverArrivedOrders, setDriverArrivedOrders] = useState<Record<string, boolean>>({});
  const [driverContactOpen, setDriverContactOpen] = useState<Record<string, boolean>>({});
  const [billingSummary, setBillingSummary] = useState<RestaurantBillingSummary | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  // Featured / Destacados
  const [featuredRequests, setFeaturedRequests] = useState<any[]>([]);
  const [featuredPackages, setFeaturedPackages] = useState<{ days: number; price: number }[]>([]);
  const [showFeaturedModal, setShowFeaturedModal] = useState(false);
  const [showPhonePreviewModal, setShowPhonePreviewModal] = useState(false);
  const [showMenuPreview, setShowMenuPreview] = useState(false);
  const [proofPreviewUrl, setProofPreviewUrl] = useState<string | null>(null);
  const [featuredDays, setFeaturedDays] = useState(1);
  const [featuredPaymentProof, setFeaturedPaymentProof] = useState('');
  const [featuredUploading, setFeaturedUploading] = useState(false);
  const [featuredSubmitting, setFeaturedSubmitting] = useState(false);
  const [featuredFlyerUploading, setFeaturedFlyerUploading] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<'ACTIVE' | 'REJECTED' | 'CANCELLED' | 'DELIVERED' | 'COMPLETED'>('ACTIVE');
  const [selectedDriverByOrder, setSelectedDriverByOrder] = useState<Record<string, string>>({});
  const [activeActionKey, setActiveActionKey] = useState<string | null>(null);
  const [showLogoutWarningModal, setShowLogoutWarningModal] = useState(false);
  const [activeSection, setActiveSection] = useState<RestaurantPortalSection>('dashboard');
  const [selectedOrderForTicket, setSelectedOrderForTicket] = useState<OrderItem | null>(null);
  const [selectedOrderForEtaExtension, setSelectedOrderForEtaExtension] = useState<OrderItem | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('');
  const [cancelConfirmOrder, setCancelConfirmOrder] = useState<OrderItem | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelRequestModalOrder, setCancelRequestModalOrder] = useState<OrderItem | null>(null);
  const [cancelRequestNote, setCancelRequestNote] = useState('');
  const [cancelRequestProcessing, setCancelRequestProcessing] = useState(false);
  const [comandaCancelNote, setComandaCancelNote] = useState('');

  useEffect(() => {
    if (selectedOrderForEtaExtension) {
      setRescheduleDate('');
      setRescheduleTime('');
    }
  }, [selectedOrderForEtaExtension]);
  
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showClosePromptModal, setShowClosePromptModal] = useState(false);
  const [extendingHours, setExtendingHours] = useState(false);
  const [activeHelpTab, setActiveHelpTab] = useState<'simulator' | 'faqs' | 'transfers' | 'support'>('simulator');
  const [supportSubject, setSupportSubject] = useState('');
  const [supportMessage, setSupportMessage] = useState('');
  const [supportCategory, setSupportCategory] = useState('SYSTEM');
  const [restaurantTickets, setRestaurantTickets] = useState<any[]>([]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = window.localStorage.getItem('local_restaurant_tickets');
        if (stored) {
          setRestaurantTickets(JSON.parse(stored));
        } else {
          const demoTickets = [
            {
              id: 'ticket-demo-1',
              category: 'BILLING',
              subject: 'Duda sobre fecha de corte',
              description: 'El corte de facturación de esta semana no coincide con el cierre del domingo.',
              status: 'RESOLVED',
              response: 'Hola, el corte se ejecuta el lunes en la madrugada. Ya quedó conciliado y pagado en tu historial.',
              respondedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
              createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
            },
            {
              id: 'ticket-demo-2',
              category: 'SYSTEM',
              subject: 'Retraso en sonido de alertas',
              description: 'Al recibir pedidos el sonido tarda unos segundos en activarse.',
              status: 'RESOLVED',
              response: 'Se optimizó la conexión websocket de tu terminal para reducir la latencia de audio. Favor de recargar la página.',
              respondedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
              createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
            }
          ];
          window.localStorage.setItem('local_restaurant_tickets', JSON.stringify(demoTickets));
          setRestaurantTickets(demoTickets);
        }
      } catch (e) {
        console.error('Error loading restaurant tickets:', e);
      }
    }
  }, [showHelpModal]);

  const simulateIncomingOrder = (paymentMethod: 'CASH' | 'TRANSFER' | 'CREDIT_CARD') => {
    const mockId = `mock-order-${Date.now()}`;
    const mockOrder: OrderItem = {
      id: mockId,
      orderReference: `SAD-${Math.floor(100000 + Math.random() * 900000)}`,
      status: 'PENDING',
      totalAmount: 385.00,
      deliveryFee: 35.00,
      paymentMethod: paymentMethod,
      paymentStatus: 'PENDING',
      paymentProofUrl: paymentMethod === 'TRANSFER' ? 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=600&q=80' : null,
      createdAt: new Date().toISOString(),
      notes: 'Favor de enviar salsa verde y roja extra, servilletas y limones. Tacos con cebolla y cilantro.',
      address: {
        street: 'Av. Paseo de la Reforma',
        number: '222',
        neighborhood: 'Juárez',
        reference: 'Torre Reforma, frente al Ángel'
      },
      items: [
        {
          id: `item-1-${Date.now()}`,
          quantity: 3,
          specialInstructions: 'Con cebolla y cilantro',
          product: {
            id: 'mock-p-1',
            name: 'Orden de Tacos al Pastor'
          },
          options: [
            { id: 'opt-1', optionId: '1', name: 'Con Queso', price: 15.00 }
          ]
        },
        {
          id: `item-2-${Date.now()}`,
          quantity: 2,
          product: {
            id: 'mock-p-2',
            name: 'Agua de Horchata Grande'
          }
        }
      ],
      customer: {
        id: 'mock-cust-1',
        user: {
          id: 'mock-u-1',
          name: 'Carlos Mendoza (Prueba)',
          phone: '5544332211'
        }
      }
    } as any;

    setOrders(current => [mockOrder, ...current]);
    setIncomingOrderQueue(current => [...current, mockId]);
    pushToast('info', 'Simulador Activo', 'Se disparó un pedido entrante de prueba.');
  };
  
  // Chat Real-Time State
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [loadingChat, setLoadingChat] = useState(false);
  const [sendingChatMessage, setSendingChatMessage] = useState(false);
  const [unreadMessagesMap, setUnreadMessagesMap] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem('sadel.restaurant.unread') || '{}'); } catch { return {}; }
  });

  useEffect(() => { localStorage.setItem('sadel.restaurant.unread', JSON.stringify(unreadMessagesMap)); }, [unreadMessagesMap]);

  useEffect(() => {
    if (selectedOrderForTicket) {
      setUnreadMessagesMap((prev) => {
        if (!prev[selectedOrderForTicket.id]) return prev;
        const copy = { ...prev };
        delete copy[selectedOrderForTicket.id];
        return copy;
      });
    }
  }, [selectedOrderForTicket]);
  const [activeTicketTab, setActiveTicketTab] = useState<'comanda' | 'chat'>('comanda');
  const selectedOrderForTicketIdRef = useRef(selectedOrderForTicket?.id || '');
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    selectedOrderForTicketIdRef.current = selectedOrderForTicket?.id || '';
    if (selectedOrderForTicket?.id) {
      // Clear unread count for this order
      setUnreadMessagesMap((prev) => {
        const next = { ...prev };
        delete next[selectedOrderForTicket.id];
        return next;
      });
      setActiveTicketTab('comanda'); // Reset tab to comanda on change
    }
  }, [selectedOrderForTicket]);

  useEffect(() => {
    if (activeTicketTab === 'chat' && selectedOrderForTicket) {
      setTimeout(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }, [chatMessages, activeTicketTab, selectedOrderForTicket]);

  const [zoomedImageUrl, setZoomedImageUrl] = useState<string | null>(null);
  const [paymentDetailOrder, setPaymentDetailOrder] = useState<typeof selectedOrderForTicket | null>(null);
  const [emergencyDeliveryOrderId, setEmergencyDeliveryOrderId] = useState<string | null>(null);
  const [unassignConfirmOrderId, setUnassignConfirmOrderId] = useState<string | null>(null);
  const [activeQrCodeData, setActiveQrCodeData] = useState<{ token: string; orderReference: string; id: string } | null>(null);
  const [incomingOrderQueue, setIncomingOrderQueue] = useState<string[]>([]);
  const [incomingOrderCountdownMs, setIncomingOrderCountdownMs] = useState<number>(newOrderDecisionWindowMs);
  const [kitchenClockNow, setKitchenClockNow] = useState(Date.now());
  const [sessionOpenedAt, setSessionOpenedAt] = useState<number | null>(null);
  const [acceptancePromptOrderId, setAcceptancePromptOrderId] = useState<string | null>(null);
  const [handoverPromptOrderId, setHandoverPromptOrderId] = useState<string | null>(null);
  const [handoverPinInput, setHandoverPinInput] = useState('');
  const [handoverError, setHandoverError] = useState<string | null>(null);
  const [handoverAttemptsLeft, setHandoverAttemptsLeft] = useState(3);
  const [pickupConfirmOrderId, setPickupConfirmOrderId] = useState<string | null>(null);
  const [pickupConfirmPinInput, setPickupConfirmPinInput] = useState('');
  const [pickupConfirmError, setPickupConfirmError] = useState<string | null>(null);
  const [pickupConfirmAttemptsLeft, setPickupConfirmAttemptsLeft] = useState(3);
  const [transferConfirmationOrder, setTransferConfirmationOrder] = useState<{
    id: string;
    preparationTimeMinutes: number;
    paymentProofUrl?: string | null;
    orderReference: string;
    collectionAmount: number;
    onConfirm: () => void;
  } | null>(null);
  const [transferRefundOrder, setTransferRefundOrder] = useState<OrderItem | null>(null);
  const [selectedPreparationTime, setSelectedPreparationTime] = useState<PreparationPresetMinutes>(15);
  const [isSelectingPrepTime, setIsSelectingPrepTime] = useState(false);
  const [isScheduledMode, setIsScheduledMode] = useState(false);
  const [scheduledDeliveryDate, setScheduledDeliveryDate] = useState('');
  const [scheduledDeliveryTime, setScheduledDeliveryTime] = useState('');
  const [storeDraft, setStoreDraft] = useState<StoreProfileDraft>({
    name: '',
    description: '',
    address: '',
    houseNumber: '',
    latitude: '',
    longitude: '',
    contactPhone: '',
    email: '',
    logo: '',
    coverImage: '',
    hasOwnDelivery: false,
    minDeliveryTime: '',
    maxDeliveryTime: '',
    deliveryFee: '',
    deliveryRadius: '',
    storeCategories: [],
    enableTicketPrinting: true,
    whatsappNotifications: false,
    instagram: '',
    facebook: '',
    tiktok: '',
  });
  const [savingStoreProfile, setSavingStoreProfile] = useState(false);
  const [showSaveSuccessModal, setShowSaveSuccessModal] = useState(false);
  const [operatingHoursDraft, setOperatingHoursDraft] = useState<OperatingHourItem[]>(
    buildDefaultOperatingHours()
  );
  const [savingOperatingHours, setSavingOperatingHours] = useState(false);
  const [currentPasswordDraft, setCurrentPasswordDraft] = useState('');
  const [newPasswordDraft, setNewPasswordDraft] = useState('');
  const [confirmPasswordDraft, setConfirmPasswordDraft] = useState('');
  const [updatingOperationalStatus, setUpdatingOperationalStatus] = useState(false);
  const [isStatusBlockedModalOpen, setIsStatusBlockedModalOpen] = useState(false);
  const [statusToast, setStatusToast] = useState<{
    type: 'open' | 'close' | 'pause' | 'resume';
    title: string;
    description: string;
  } | null>(null);
  const [showCloseConfirmModal, setShowCloseConfirmModal] = useState(false);

  useEffect(() => {
    if (statusToast) {
      const timer = setTimeout(() => setStatusToast(null), 3200);
      return () => clearTimeout(timer);
    }
  }, [statusToast]);

  const [savingPassword, setSavingPassword] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState('perfil');
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  useEffect(() => {
    if (activeSettingsTab !== 'ubicacion') {
      setAddressSuggestions([]);
    }
  }, [activeSettingsTab]);
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');

  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [creatingProduct, setCreatingProduct] = useState(false);
  const [savingProductChanges, setSavingProductChanges] = useState(false);
  const [processingProductImage, setProcessingProductImage] = useState(false);
  const [productImageValidationError, setProductImageValidationError] = useState('');
  const [activeAvailabilityProductId, setActiveAvailabilityProductId] = useState<string | null>(null);
  const [selectedWeekOffset, setSelectedWeekOffset] = useState(0);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [selectedSettlementForDetails, setSelectedSettlementForDetails] = useState<any | null>(null);
  const [settlementOrders, setSettlementOrders] = useState<any[]>([]);
  const [loadingSettlementOrders, setLoadingSettlementOrders] = useState(false);
  const [isPrintingTicket, setIsPrintingTicket] = useState(false);
  const [isCurrentPeriodDetailsOpen, setIsCurrentPeriodDetailsOpen] = useState(false);
  const [currentPeriodOrders, setCurrentPeriodOrders] = useState<any[]>([]);
  const [loadingCurrentPeriodOrders, setLoadingCurrentPeriodOrders] = useState(false);
  const [revenueMode, setRevenueMode] = useState<'gross' | 'net'>('gross');
  const [adminBankName, setAdminBankName] = useState('');
  const [adminBankAccount, setAdminBankAccount] = useState('');
  const [adminBankBeneficiary, setAdminBankBeneficiary] = useState('');
  const [isPayModalOpen, setIsPayModalOpen] = useState(false);
  const [selectedSettlementForPay, setSelectedSettlementForPay] = useState<any | null>(null);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [proofPreviewBase64, setProofPreviewBase64] = useState<string | null>(null);
  const [isDeleteProductModalOpen, setIsDeleteProductModalOpen] = useState(false);
  const [deletingProductId, setDeletingProductId] = useState<string | null>(null);
  const [deletingProductName, setDeletingProductName] = useState('');
  const [deletingProduct, setDeletingProduct] = useState(false);
  const [productDraft, setProductDraft] = useState<ProductDraft>({
    id: undefined,
    categoryId: '',
    name: '',
    description: '',
    price: '',
    sellBy: 'UNIT',
    unitPrice: '',
    minWeightG: '100',
    maxWeightG: '5000',
    stepWeightG: '100',
    weightPresets: [100, 200, 300, 500, 1000],
    image: '',
    images: [],
    imagePosition: '50% 50%',
    imageZoom: 100,
    isAdultOnly: false,
    preparationTime: '15',
  });
  const [isCoverImageModalOpen, setIsCoverImageModalOpen] = useState(false);
  const [coverImageDraft, setCoverImageDraft] = useState('');
  const [coverImageValidationError, setCoverImageValidationError] = useState('');
  const [coverImagePreviewError, setCoverImagePreviewError] = useState(false);
  const [savingCoverImage, setSavingCoverImage] = useState(false);
  const [processingCoverImage, setProcessingCoverImage] = useState(false);
  const [isLogoModalOpen, setIsLogoModalOpen] = useState(false);
  const [logoDraft, setLogoDraft] = useState('');
  const [logoValidationError, setLogoValidationError] = useState('');
  const [logoPreviewError, setLogoPreviewError] = useState(false);
  const [savingLogo, setSavingLogo] = useState(false);
  const [processingLogo, setProcessingLogo] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const touchStartY = useRef(0);
  const [socketStatus, setSocketStatus] = useState<'idle' | 'connecting' | 'connected' | 'reconnecting'>('idle');
  const [socketAttempts, setSocketAttempts] = useState(0);
  const [carouselIndexMap, setCarouselIndexMap] = useState<Record<string, number>>({});
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastTimeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const [dashboardChartView, setDashboardChartView] = useState<'revenue' | 'orders'>('revenue');
  const [isOrderAlertSoundEnabled, setIsOrderAlertSoundEnabled] = useState(true);
  const [orderAlertAudioState, setOrderAlertAudioState] = useState<'ready' | 'needs-gesture' | 'unsupported'>(
    'needs-gesture'
  );
  const [lastFailedAction, setLastFailedAction] = useState<RestaurantRetryAction | null>(null);
  const seenLiveEventKeysRef = useRef<Set<string>>(new Set());
  const ordersRef = useRef(orders);
  ordersRef.current = orders;
  const pendingNotificationOrderIdRef = useRef<string | null>(null);
  const navigateToOrder = useCallback((orderId: string) => {
    const currentOrders = ordersRef.current;
    const order = currentOrders?.find?.((o: any) => o.id === orderId);
    if (order) {
      setActiveSection('orders');
      setSelectedOrderForTicket(order);
    } else {
      pendingNotificationOrderIdRef.current = orderId;
      setActiveSection('orders');
    }
  }, []);
  const promptedIncomingOrderIdsRef = useRef<string[]>([]);
  const resolvedIncomingOrderIdsRef = useRef<string[]>([]);
  const autoRejectingOrderIdsRef = useRef<string[]>([]);
  const soundedIncomingOrderIdsRef = useRef<string[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioArrayBufferRef = useRef<ArrayBuffer | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const chatMessageArrayBufferRef = useRef<ArrayBuffer | null>(null);
  const chatMessageBufferRef = useRef<AudioBuffer | null>(null);
  const chatAudioRef = useRef<HTMLAudioElement | null>(null);
  const chatMessageAudioRef = useRef<HTMLAudioElement | null>(null);
  const wakeLockRef = useRef<any>(null);
  const alarmSourceRef = useRef<AudioBufferSourceNode | OscillatorNode | null>(null);
  const pulseIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const hasUserInteractedRef = useRef(false);
  const hasShownOrderAlertBlockedToastRef = useRef(false);
  const coverImageInputRef = useRef<HTMLInputElement | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const productImageInputRef = useRef<HTMLInputElement | null>(null);
  const productImageExtraInputRef = useRef<HTMLInputElement | null>(null);
  const cropDragRef = useRef<{
    isDragging: boolean;
    startX: number;
    startY: number;
    startPosition: string;
  }>({ isDragging: false, startX: 0, startY: 0, startPosition: '50% 50%' });
  const cropContainerRef = useRef<HTMLDivElement | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    void warmOrderAlertAudio(true);
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

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await fetch(`${apiBase}/settings`);
        const data = await response.json();
        if (data.success) {
          if (data.data.restaurantWelcomeImage) {
            setWelcomeImage(data.data.restaurantWelcomeImage);
          }
          if (data.data.restaurantPromoModalEnabled && data.data.restaurantPromoModalImage) {
            setPromoImageUrl(data.data.restaurantPromoModalImage);
            try {
              // Clean up legacy key
              if (localStorage.getItem('sadel_restaurant_promo_date')) {
                localStorage.removeItem('sadel_restaurant_promo_date');
              }
              const lastSeenTimestamp = localStorage.getItem('sadel_restaurant_promo_timestamp');
              const lastSeenImage = localStorage.getItem('sadel_restaurant_promo_image');
              const now = Date.now();
              const twentyFourHours = 24 * 60 * 60 * 1000;
              
              let shouldShow = false;
              if (!lastSeenTimestamp || lastSeenImage !== data.data.restaurantPromoModalImage) {
                shouldShow = true;
              } else {
                const parsedTimestamp = parseInt(lastSeenTimestamp, 10);
                if (isNaN(parsedTimestamp) || (now - parsedTimestamp) > twentyFourHours) {
                  shouldShow = true;
                }
              }

              if (shouldShow) {
                setShowPromoModal(true);
                localStorage.setItem('sadel_restaurant_promo_timestamp', now.toString());
                localStorage.setItem('sadel_restaurant_promo_image', data.data.restaurantPromoModalImage);
              }
            } catch (e) {
              console.warn("Storage restricted, showing modal without saving state", e);
              setShowPromoModal(true);
            }
          }
          if (data.data.adminBankName) setAdminBankName(data.data.adminBankName);
          if (data.data.adminBankAccount) setAdminBankAccount(data.data.adminBankAccount);
          if (data.data.adminBankBeneficiary) setAdminBankBeneficiary(data.data.adminBankBeneficiary);
        }
      } catch (error) {
        console.error('Error fetching settings:', error);
      }
    };
    fetchSettings();
  }, [apiBase]);

  useEffect(() => {
    const savedSession = readStoredSession(storageKey);
    if (savedSession.user) {
      setSessionUser(savedSession.user);
      setToken(savedSession.token || '');
      if (savedSession.refreshToken) setRefreshToken(savedSession.refreshToken);
    }
    setCheckingAuth(false);

    if (typeof window !== 'undefined') {
      const isDark = window.localStorage.getItem('darkMode') === 'true';

      const savedSection = window.localStorage.getItem('restaurantActiveSection');
      if (savedSection) {
        setActiveSection(savedSection as RestaurantPortalSection);
      }
      setIsDarkMode(isDark);
      if (isDark) {
        document.documentElement.classList.add('dark');
      }

      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').then((registration) => {
          console.log('Service Worker registered');
        }).catch((error) => {
          console.error('Service Worker registration failed:', error);
        });
      }

      const supportsWebAudio = Boolean(window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
      setOrderAlertAudioState(supportsWebAudio ? 'needs-gesture' : 'unsupported');

      const preloadAudio = new Audio('/sounds/notifica.wav');
      preloadAudio.preload = 'auto';
      preloadAudio.volume = 1.0;
      chatAudioRef.current = preloadAudio;

      const preloadChatAudio = new Audio('/sounds/mensaje.wav');
      preloadChatAudio.preload = 'auto';
      preloadChatAudio.volume = 1.0;
      chatMessageAudioRef.current = preloadChatAudio;

      fetch('/sounds/notifica.wav')
        .then((res) => res.arrayBuffer())
        .then((buffer) => { audioArrayBufferRef.current = buffer; })
        .catch(() => {});

      fetch('/sounds/mensaje.wav')
        .then((res) => res.arrayBuffer())
        .then((buffer) => { chatMessageArrayBufferRef.current = buffer; })
        .catch(() => {});

      // Cross-tab sound dedup: listen for alerts from other tabs
      try {
        const bc = new BroadcastChannel('sadel-order-alert');
        bc.onmessage = () => {
          (window as any).__sadelLastAlertFromOtherTab = Date.now();
        };
      } catch { /* BroadcastChannel not supported */ }

      const savedOrderAlertSoundPreference = window.localStorage.getItem(orderAlertSoundPreferenceKey);
      if (savedOrderAlertSoundPreference === 'false') {
        setIsOrderAlertSoundEnabled(false);
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
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && !checkingAuth) {
      window.localStorage.setItem('restaurantActiveSection', activeSection);
    }
  }, [activeSection, checkingAuth]);

  useEffect(() => {
    if (token) {
      void subscribeToPush(token);
    }
  }, [token]);

  // Leer orderId de la URL (cuando se da click a una notificación push)
  useEffect(() => {
    if (!token) return;

    const checkUrlForOrderId = () => {
      const params = new URLSearchParams(window.location.search);
      const orderId = params.get('orderId');
      if (orderId) {
        window.history.replaceState({}, '', window.location.pathname);
        navigateToOrder(orderId);
      }
    };

    checkUrlForOrderId();
    window.addEventListener('focus', checkUrlForOrderId);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') checkUrlForOrderId();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', checkUrlForOrderId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [token]);

  // Recibir orderId via postMessage del Service Worker (más confiable que URL para clientes existentes)
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    const handleSWMessage = (event: MessageEvent) => {
      if (event.data?.type === 'NOTIFICATION_CLICK') {
        const orderId = event.data.orderId;
        if (orderId) {
          navigateToOrder(orderId);
        }
      }
    };

    navigator.serviceWorker.addEventListener('message', handleSWMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handleSWMessage);
    };
  }, [navigateToOrder]);

  // Buscar en IndexedDB si postMessage se perdió (fallback para notificaciones)
  useEffect(() => {
    if (typeof window === 'undefined' || !token) return;

    const checkIndexedDB = async () => {
      try {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = window.indexedDB.open('sadel-push', 1);
          req.onupgradeneeded = () => req.result.createObjectStore('pending', { keyPath: 'id' });
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        const tx = db.transaction('pending', 'readonly');
        const store = tx.objectStore('pending');
        const data = await new Promise<{ id: string; value: string } | undefined>((resolve) => {
          const req = store.get('orderId');
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(undefined);
        });
        if (data?.value) {
          // Limpiar inmediatamente
          const cleanTx = db.transaction('pending', 'readwrite');
          cleanTx.objectStore('pending').delete('orderId');
          await new Promise(r => { cleanTx.oncomplete = r; });
          navigateToOrder(data.value);
        }
      } catch {}
    };

    checkIndexedDB();
  }, [token, navigateToOrder]);

  // Cuando se carguen órdenes y tengamos un orderId pendiente de notificación, seleccionarla
  useEffect(() => {
    const pendingId = pendingNotificationOrderIdRef.current;
    if (!pendingId || orders.length === 0) return;
    const order = orders.find((o) => o.id === pendingId);
    if (order) {
      setSelectedOrderForTicket(order);
      pendingNotificationOrderIdRef.current = null;
    }
  }, [orders]);

  useEffect(() => {
    if (activeSection !== 'settings' || activeSettingsTab !== 'ubicacion') {
      return;
    }

    const timer = setTimeout(() => {
      const google = (window as any).google;
      if (!google || !google.maps) {
        console.warn("Google Maps not loaded");
        return;
      }

      const lat = parseFloat(storeDraft.latitude) || 19.4326;
      const lng = parseFloat(storeDraft.longitude) || -99.1332;

      const mapElement = document.getElementById('settings-map');
      if (!mapElement) return;

      const isMapStillConnected = settingsMapRef.current && document.body.contains(settingsMapRef.current.getDiv());

      if (!isMapStillConnected) {
        const map = new google.maps.Map(mapElement, {
          center: { lat, lng },
          zoom: 16,
          mapTypeControl: false,
          streetViewControl: false,
        });
        settingsMapRef.current = map;

        const marker = new google.maps.Marker({
          position: { lat, lng },
          map: map,
          draggable: true,
        });
        settingsMarkerRef.current = marker;

        marker.addListener('dragend', async () => {
          const position = marker.getPosition();
          if (!position) return;
          
          setStoreDraft((current) => ({
            ...current,
            latitude: String(position.lat()),
            longitude: String(position.lng()),
          }));

          try {
            const geocoder = new google.maps.Geocoder();
            geocoder.geocode({ location: { lat: position.lat(), lng: position.lng() } }, (results: any, status: any) => {
              if (status === "OK" && results && results[0]) {
                const address = results[0].formatted_address;
                let houseNumber = '';
                const houseComponent = results[0].address_components.find((c: any) => c.types.includes('street_number'));
                if (houseComponent) houseNumber = houseComponent.long_name;

                setStoreDraft((current) => ({
                  ...current,
                  address: address,
                  houseNumber: houseNumber,
                }));
              }
            });
          } catch (err) {
            console.error('Error in reverse geocoding:', err);
          }
        });
      } else {
        const pos = { lat, lng };
        google.maps.event.trigger(settingsMapRef.current, 'resize');
        settingsMapRef.current.setCenter(pos);
        settingsMarkerRef.current.setPosition(pos);
      }
    }, 150);

    return () => {
      clearTimeout(timer);
    };
  }, [activeSection, activeSettingsTab, storeDraft.latitude, storeDraft.longitude]);

  useEffect(() => {
    if (!storeDraft.address || storeDraft.address.length < 5) {
      setAddressSuggestions([]);
      return;
    }

    if (profile && profile.address && storeDraft.address && profile.address.startsWith(storeDraft.address)) {
      setAddressSuggestions([]);
      return;
    }

    if (ignoreAddressSearchRef.current) {
      ignoreAddressSearchRef.current = false;
      return;
    }

    const timer = window.setTimeout(async () => {
      setIsSearchingAddress(true);
      try {
        const google = (window as any).google;
        if (!google || !google.maps || !google.maps.places) {
          setIsSearchingAddress(false);
          return;
        }

        if (!autocompleteSessionTokenRef.current) {
          autocompleteSessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();
        }

        const { suggestions: predictions } = await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: storeDraft.address,
          sessionToken: autocompleteSessionTokenRef.current,
          includedRegionCodes: ['mx']
        });

        if (!predictions || predictions.length === 0) {
          setAddressSuggestions([]);
          setIsSearchingAddress(false);
          return;
        }

        const mappedSuggestions = predictions.map((suggestion: any) => ({
          display_name: suggestion.placePrediction.text.text,
          place_id: suggestion.placePrediction.placeId,
        }));

        setAddressSuggestions(mappedSuggestions);
        setIsSearchingAddress(false);
      } catch (err) {
        console.error('Error searching address:', err);
        setIsSearchingAddress(false);
      }
    }, 500); // 500ms debounce

    return () => window.clearTimeout(timer);
  }, [storeDraft.address]);

  function persistSession(nextToken: string, user: AuthUser, nextRefreshToken?: string) {
    setToken(nextToken);
    setSessionUser(user);
    if (nextRefreshToken) setRefreshToken(nextRefreshToken);
    persistStoredSession({
      storageKey,
      apiBase,
      token: nextToken,
      refreshToken: nextRefreshToken,
      user,
    });
  }

  function buildRefreshConfig() {
    if (!refreshToken) return undefined;
    return {
      refreshToken,
      onRefreshed: (accessToken: string, newRefreshToken: string) => {
        setToken(accessToken);
        setRefreshToken(newRefreshToken);
        persistStoredSession({
          storageKey,
          apiBase,
          token: accessToken,
          refreshToken: newRefreshToken,
          user: sessionUser!,
        });
      },
      onRefreshFailed: () => {
        clearSession('Tu sesión expiró. Vuelve a iniciar sesión.');
      },
    } as const;
  }

  function apiRequest<T>(params: {
    apiBase: string;
    path: string;
    token?: string;
    options?: RequestInit;
    fallbackMessage?: string;
    retry?: { attempts?: number; backoffMs?: number };
  }): Promise<T> {
    return requestJson<T>({
      ...params,
      refreshConfig: buildRefreshConfig(),
    });
  }

  const subscribeToPush = async (tokenToUse: string) => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    // Request notification permission first
    if (Notification.permission === 'default') {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          return;
        }
      } catch {
        return;
      }
    }
    if (Notification.permission !== 'granted') {
      return;
    }

    const fetchWithRetry = async (url: string, retries = 3): Promise<Response> => {
      const delays = [1000, 2000, 4000];
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const res = await fetch(url);
          if (res.ok) return res;
          if (attempt < retries) {
            await new Promise(r => setTimeout(r, delays[attempt]));
          }
        } catch {
          if (attempt < retries) {
            await new Promise(r => setTimeout(r, delays[attempt]));
          }
        }
      }
      throw new Error('VAPID endpoint did not return a successful response after retries');
    };

    try {
      const registration = await navigator.serviceWorker.ready;

      const response = await fetchWithRetry(`${apiBase}/notifications/vapid-key`);
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

      const subResponse = await fetch(`${apiBase}/notifications/subscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tokenToUse}`
        },
        body: JSON.stringify(subscription)
      });

      if (!subResponse.ok) {
        console.error('Push subscription rejected by server:', subResponse.status, await subResponse.text().catch(() => ''));
        return;
      }

      console.log('Subscribed to push notifications');
    } catch (error) {
      console.error('Failed to subscribe to push:', error);
    }
  };

  function clearSession(message?: string) {
    setToken('');
    setRefreshToken('');
    setSessionUser(null);
    setPassword('');
    setIsLoginModalOpen(false);
    setIsMobileNavOpen(false);
    setActiveSection('dashboard');
    setProfile(null);
    setOrders([]);
    setProducts([]);
    setCategories([]);
    setDrivers([]);
    setSocketStatus('idle');
    setSocketAttempts(0);
    setToasts([]);
    setLastFailedAction(null);
    setSelectedOrderForTicket(null);
    setIncomingOrderQueue([]);
    setIncomingOrderCountdownMs(newOrderDecisionWindowMs);
    setAcceptancePromptOrderId(null);
    setSelectedPreparationTime(15);
    setStoreDraft({
      name: '',
      description: '',
      address: '',
      houseNumber: '',
      latitude: '',
      longitude: '',
      contactPhone: '',
      email: '',
      logo: '',
      coverImage: '',
      hasOwnDelivery: false,
      minDeliveryTime: '',
      maxDeliveryTime: '',
      deliveryFee: '',
      deliveryRadius: '',
      storeCategories: [],
    enableTicketPrinting: true,
    whatsappNotifications: false,
      instagram: '',
      facebook: '',
      tiktok: '',
    });
    setIsCategoryModalOpen(false);
    setNewCategoryName('');

    setIsProductModalOpen(false);
    setSavingProductChanges(false);
    setProcessingProductImage(false);
    setProductImageValidationError('');
    setActiveAvailabilityProductId(null);
    setIsDeleteProductModalOpen(false);
    setDeletingProductId(null);
    setDeletingProductName('');
    setIsCoverImageModalOpen(false);
    setCoverImageDraft('');
    setCoverImageValidationError('');
    setCoverImagePreviewError(false);
    setIsLogoModalOpen(false);
    setLogoDraft('');
    setLogoValidationError('');
    setLogoPreviewError(false);
      setProductDraft({
        id: undefined,
        categoryId: categories[0]?.id || '',
        name: '',
        description: '',
        price: '',
        discountPrice: '',
        sellBy: 'UNIT',
        unitPrice: '',
        minWeightG: '100',
        maxWeightG: '5000',
        stepWeightG: '100',
        weightPresets: [100, 200, 300, 500, 1000],
        image: '',
        images: [],
        imagePosition: '50% 50%',
        imageZoom: 100,
        isAdultOnly: false,
        preparationTime: '15',
      });
    promptedIncomingOrderIdsRef.current = [];
    resolvedIncomingOrderIdsRef.current = [];
    autoRejectingOrderIdsRef.current = [];
    clearStoredSession(storageKey);
    if (message) {
      setAuthMessage(message);
    }
  }

  useEffect(() => {
    if (
      !isLoginModalOpen &&
      !selectedOrderForTicket &&
      incomingOrderQueue.length === 0 &&
      !acceptancePromptOrderId &&
      !handoverPromptOrderId &&
      !isCoverImageModalOpen &&
      !isLogoModalOpen &&
      !isCategoryModalOpen &&
      !isProductModalOpen
    ) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [
    acceptancePromptOrderId,
    isCoverImageModalOpen,
    isLogoModalOpen,
    incomingOrderQueue.length,
    isCategoryModalOpen,
    isLoginModalOpen,
    isProductModalOpen,
    selectedOrderForTicket,
  ]);

  useEffect(() => {
    if (!selectedOrderForTicket) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (incomingOrderQueue.length > 0) {
        return;
      }

      if (event.key === 'Escape') {
        setSelectedOrderForTicket(null);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [incomingOrderQueue.length, selectedOrderForTicket]);

  // Crop drag global listeners
  useEffect(() => {
    const onMove = (clientX: number, clientY: number) => {
      const drag = cropDragRef.current;
      if (!drag.isDragging) return;
      const div = cropContainerRef.current;
      if (!div) return;
      const rect = div.getBoundingClientRect();
      const [startPctX, startPctY] = (drag.startPosition || '50% 50%').split('% ').map((v) => parseFloat(v));
      const deltaPctX = ((clientX - drag.startX) / rect.width) * 100;
      const deltaPctY = ((clientY - drag.startY) / rect.height) * 100;
      const x = Math.max(0, Math.min(100, startPctX + deltaPctX));
      const y = Math.max(0, Math.min(100, startPctY + deltaPctY));
      setProductDraft((curr) => ({ ...curr, imagePosition: `${Math.round(x)}% ${Math.round(y)}%` }));
    };
    const onUp = () => {
      cropDragRef.current.isDragging = false;
    };
    const handleMouseMove = (e: MouseEvent) => onMove(e.clientX, e.clientY);
    const handleMouseUp = () => onUp();
    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (touch) onMove(touch.clientX, touch.clientY);
    };
    const handleTouchEnd = () => onUp();
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd);
    const el = cropContainerRef.current;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      setProductDraft((curr) => ({ ...curr, imageZoom: Math.max(30, Math.min(300, (curr.imageZoom || 100) + (e.deltaY > 0 ? -10 : 10))) }));
    };
    if (el) el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      if (el) el.removeEventListener('wheel', handleWheel);
    };
  }, []);

  const pendingIncomingOrders = [...orders]
    .filter((order) => order.status === 'PENDING')
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  const pendingIncomingOrderMap = new Map(pendingIncomingOrders.map((order) => [order.id, order]));
  const queuedPendingOrderIds = incomingOrderQueue.filter((orderId) => pendingIncomingOrderMap.has(orderId));
  const queuedPendingOrders = queuedPendingOrderIds
    .map((orderId) => pendingIncomingOrderMap.get(orderId))
    .filter((order): order is OrderItem => Boolean(order));
  const activeIncomingOrder = queuedPendingOrders[0] || null;
  const waitingIncomingOrders = queuedPendingOrders.slice(1);
  const acceptancePromptOrder =
    (acceptancePromptOrderId ? orders.find((order) => order.id === acceptancePromptOrderId) : null) || null;
  const handoverPromptOrder =
    (handoverPromptOrderId ? orders.find((order) => order.id === handoverPromptOrderId) : null) || null;
  const pickupConfirmOrder =
    (pickupConfirmOrderId ? orders.find((order) => order.id === pickupConfirmOrderId) : null) || null;

  useEffect(() => {
    if (handoverPromptOrder?.handoverPinAttempts != null) {
      setHandoverAttemptsLeft(Math.max(0, 3 - (handoverPromptOrder.handoverPinAttempts as number)));
    } else if (handoverPromptOrder) {
      setHandoverAttemptsLeft(3);
    }
  }, [handoverPromptOrder?.id]);

  useEffect(() => {
    if (pickupConfirmOrder?.handoverPinAttempts != null) {
      setPickupConfirmAttemptsLeft(Math.max(0, 3 - (pickupConfirmOrder.handoverPinAttempts as number)));
    } else if (pickupConfirmOrder) {
      setPickupConfirmAttemptsLeft(3);
    }
  }, [pickupConfirmOrder?.id]);

  function pushToast(tone: ToastItem['tone'], title: string, message: string) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((current) => [{ id, tone, title, message }, ...current].slice(0, 6));
    const timeoutId = setTimeout(() => dismissToast(id), 4000);
    toastTimeoutsRef.current.set(id, timeoutId);
  }

  function dismissToast(id: string) {
    const timeoutId = toastTimeoutsRef.current.get(id);
    if (timeoutId) {
      clearTimeout(timeoutId);
      toastTimeoutsRef.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }

  const warmOrderAlertAudio = useCallback(async (interactive: boolean) => {
    if (typeof window === 'undefined') {
      return false;
    }

    if (interactive) {
      hasUserInteractedRef.current = true;
    }

    const AudioContextConstructor =
      window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextConstructor) {
      setOrderAlertAudioState('unsupported');
      return false;
    }

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextConstructor();
    }

    const context = audioContextRef.current;

    if (context.state === 'running') {
      setOrderAlertAudioState('ready');
      return true;
    }

    try {
      if (context.state === 'suspended') {
        await context.resume();
      }
      const nextAudioState = audioContextRef.current?.state === 'running' ? 'ready' : 'needs-gesture';
      setOrderAlertAudioState(nextAudioState);
      return nextAudioState === 'ready';
    } catch {
      setOrderAlertAudioState('needs-gesture');
      return false;
    }
  }, []);

  const playIncomingOrderAlert = useCallback(async () => {
    if (!isOrderAlertSoundEnabled) return false;

    // Cross-tab dedup: skip if another tab just played (within 1s)
    if (typeof window !== 'undefined' && (window as any).__sadelLastAlertFromOtherTab) {
      const elapsed = Date.now() - (window as any).__sadelLastAlertFromOtherTab;
      if (elapsed < 1000) return false;
    }

    // Broadcast to other tabs that we played
    try {
      const bc = new BroadcastChannel('sadel-order-alert');
      bc.postMessage('played');
      bc.close();
    } catch { /* BroadcastChannel not supported */ }

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return false;

      if (!audioContextRef.current) {
        audioContextRef.current = new AudioCtx();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') await ctx.resume();

      // 1. Try WAV buffer playback
      if (!audioBufferRef.current && audioArrayBufferRef.current) {
        audioBufferRef.current = await ctx.decodeAudioData(audioArrayBufferRef.current.slice(0));
      }
      if (audioBufferRef.current) {
        const source = ctx.createBufferSource();
        source.buffer = audioBufferRef.current;
        const gain = ctx.createGain();
        gain.gain.value = 1.0;
        source.connect(gain);
        gain.connect(ctx.destination);
        source.start(0);
        return true;
      }
    } catch {
      // WAV falló, seguimos con oscilador
    }

    // 2. Oscillator fallback (no necesita archivo WAV)
    try {
      if (audioContextRef.current) {
        const ctx = audioContextRef.current;
        if (ctx.state === 'suspended') await ctx.resume();
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = 880;

        const gain = ctx.createGain();
        gain.gain.value = 0.6;

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(0);

        let pulseState = true;
        if (pulseIntervalRef.current) {
          clearInterval(pulseIntervalRef.current);
        }
        pulseIntervalRef.current = setInterval(() => {
          pulseState = !pulseState;
          gain.gain.value = pulseState ? 0.6 : 0.0;
        }, 400);

        alarmSourceRef.current = osc;

        // Clean up pulse interval after ~4s (one-shot alert, not loop)
        setTimeout(() => {
          if (pulseIntervalRef.current) {
            clearInterval(pulseIntervalRef.current);
            pulseIntervalRef.current = null;
          }
        }, 4000);

        return true;
      }
    } catch {
      // oscilador falló, último recurso: <audio>
    }

    // 3. Fallback extremo: <audio>
    try {
      const audioEl = document.getElementById('restaurant-alert-audio') as HTMLAudioElement | null;
      if (audioEl) {
        audioEl.currentTime = 0;
        await audioEl.play();
        return true;
      }
    } catch {
      return false;
    }

    return false;
  }, [isOrderAlertSoundEnabled]);

  const playChatPopSound = useCallback(async () => {
    if (!isOrderAlertSoundEnabled) return;

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      if (!audioContextRef.current) {
        audioContextRef.current = new AudioCtx();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') await ctx.resume();

      if (!chatMessageBufferRef.current && chatMessageArrayBufferRef.current) {
        chatMessageBufferRef.current = await ctx.decodeAudioData(chatMessageArrayBufferRef.current.slice(0));
      }
      if (chatMessageBufferRef.current) {
        const source = ctx.createBufferSource();
        source.buffer = chatMessageBufferRef.current;
        const gain = ctx.createGain();
        gain.gain.value = 1.0;
        source.connect(gain);
        gain.connect(ctx.destination);
        source.start(0);
        return;
      }
    } catch (err) {
      console.warn('Failed to play chat sound via Web Audio API', err);
    }

    try {
      const audio = chatMessageAudioRef.current;
      if (audio) {
        audio.currentTime = 0;
        audio.volume = 1.0;
        await audio.play();
      }
    } catch (err) {
      console.warn('Failed to play chat sound via fallback', err);
    }
  }, [isOrderAlertSoundEnabled]);

  const handleOrderAlertSoundToggle = useCallback(
    (checked: boolean) => {
      setIsOrderAlertSoundEnabled(checked);

      if (typeof window !== 'undefined') {
        window.localStorage.setItem(orderAlertSoundPreferenceKey, checked ? 'true' : 'false');
      }

      if (checked) {
        hasShownOrderAlertBlockedToastRef.current = false;
        void warmOrderAlertAudio(true);
      }
    },
    [warmOrderAlertAudio]
  );

  const fetchSettlementOrders = async (settlementId: string) => {
    setLoadingSettlementOrders(true);
    try {
      const response = await fetch(`${apiBase}/restaurant-panel/facturacion/${settlementId}/pedidos`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await response.json();
      if (data.success) {
        setSettlementOrders(data.data);
      } else {
        pushToast('error', 'Error', 'No se pudieron cargar los pedidos.');
      }
    } catch (error) {
      console.error('Error fetching settlement orders:', error);
      pushToast('error', 'Error', 'Error de conexion.');
    } finally {
      setLoadingSettlementOrders(false);
    }
  };

  const fetchCurrentPeriodOrders = async () => {
    setLoadingCurrentPeriodOrders(true);
    try {
      const response = await fetch(`${apiBase}/restaurant-panel/facturacion/periodo-actual/pedidos`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await response.json();
      if (data.success) {
        setCurrentPeriodOrders(data.data);
      } else {
        pushToast('error', 'Error', 'No se pudieron cargar los pedidos del periodo actual.');
      }
    } catch (error) {
      console.error('Error fetching current period orders:', error);
      pushToast('error', 'Error', 'Error de conexion.');
    } finally {
      setLoadingCurrentPeriodOrders(false);
    }
  };

  const handleSelectProof = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      setProofPreviewBase64(reader.result as string);
    };
  };

  const handleSubmitProof = async () => {
    if (!proofPreviewBase64) return;
    setUploadingProof(true);

    try {
      const uploadResponse = await fetch(`${apiBase}/uploads/images`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          kind: 'payment-proof',
          source: proofPreviewBase64,
        }),
      });

      const uploadData = await uploadResponse.json();
      if (!uploadData.success) {
        pushToast('error', 'Error', 'No se pudo subir la imagen.');
        setUploadingProof(false);
        return;
      }

      const imageUrl = uploadData.data.url;

      const response = await fetch(`${apiBase}/restaurant-panel/facturacion/${selectedSettlementForPay?.id}/comprobante`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          paymentProofUrl: imageUrl,
        }),
      });

      const data = await response.json();
      if (data.success) {
        pushToast('success', 'Exito', 'Comprobante subido. El corte esta en revision.');
        setIsPayModalOpen(false);
        setProofPreviewBase64(null);
        loadDashboard();
      } else {
        pushToast('error', 'Error', 'No se pudo registrar el comprobante.');
      }
    } catch (error) {
      console.error('Error uploading proof:', error);
      pushToast('error', 'Error', 'Error de conexion.');
    } finally {
      setUploadingProof(false);
    }
  };

  function openAcceptOrderPrompt(orderId: string) {
    setSelectedPreparationTime(15);
    setAcceptancePromptOrderId(orderId);
  }

  async function loginWithPassword() {
    setVerifyingCode(true);
    setError('');
    setAuthMessage('');
    persistApiBase(storageKey, apiBase);

    try {
      const payload = await requestJson<AuthResponse>({
        apiBase,
        path: '/auth/restaurant-login',
        options: {
          method: 'POST',
          body: JSON.stringify({
            phone: phone.trim(),
            password: password.trim(),
          }),
        },
        fallbackMessage: 'No se pudo iniciar sesion.',
        retry: {
          attempts: 1,
          backoffMs: 300,
        },
      });

      if (payload.data.user.role !== 'RESTAURANT') {
        clearSession('La cuenta autenticada no pertenece a un restaurante.');
        return;
      }

      persistSession(payload.data.token, payload.data.user);
      setPassword('');
      setIsLoginModalOpen(false);
      pushToast('success', 'Sesion lista', `Bienvenido de nuevo, ${payload.data.user.name}.`);
    } catch (requestError) {
      const message = getRequestErrorMessage(requestError, 'No se pudo iniciar sesion.');
      setError(message);
      pushToast('error', 'Acceso denegado', message);
    } finally {
      setVerifyingCode(false);
    }
  }

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError('');
    persistApiBase(storageKey, apiBase);

    try {
      const [profileData, ordersData, productsData, categoriesData, driversData, billingData, storeCategoriesData, featuredPriceData, featuredRequestsData] = await Promise.all([
        apiRequest<SuccessResponse<RestaurantProfile>>({
          apiBase,
          path: '/restaurant-panel/perfil',
          token,
          fallbackMessage: 'No se pudo cargar el perfil del restaurante.',
          retry: {
            attempts: 2,
            backoffMs: 350,
          },
        }),
        apiRequest<SuccessResponse<OrderItem[]>>({
          apiBase,
          path: '/restaurant-panel/pedidos',
          token,
          fallbackMessage: 'No se pudieron cargar los pedidos.',
          retry: {
            attempts: 2,
            backoffMs: 350,
          },
        }),
        apiRequest<SuccessResponse<ProductItem[]>>({
          apiBase,
          path: '/restaurant-panel/productos',
          token,
          fallbackMessage: 'No se pudieron cargar los productos.',
          retry: {
            attempts: 2,
            backoffMs: 350,
          },
        }),
        apiRequest<SuccessResponse<CategoryItem[]>>({
          apiBase,
          path: '/restaurant-panel/categorias',
          token,
          fallbackMessage: 'No se pudieron cargar las categorias.',
          retry: {
            attempts: 2,
            backoffMs: 350,
          },
        }),
        apiRequest<SuccessResponse<DriverItem[]>>({
          apiBase,
          path: '/restaurant-panel/repartidores/disponibles',
          token,
          fallbackMessage: 'No se pudieron cargar los repartidores disponibles.',
          retry: {
            attempts: 2,
            backoffMs: 350,
          },
        }),
        apiRequest<SuccessResponse<RestaurantBillingSummary>>({
          apiBase,
          path: '/restaurant-panel/facturacion',
          token,
          fallbackMessage: 'No se pudo cargar el resumen de facturacion.',
          retry: {
            attempts: 2,
            backoffMs: 350,
          },
        }),
        apiRequest<SuccessResponse<StoreCategoryItem[]>>({
          apiBase,
          path: '/store-categories',
          fallbackMessage: 'No se pudieron cargar las categorías de plataforma.',
          retry: {
            attempts: 2,
            backoffMs: 350,
          },
        }),
        apiRequest<SuccessResponse<{ packages: { days: number; price: number }[] }>>({
          apiBase,
          path: '/restaurant/featured/packages',
          token,
        }).catch(() => ({ success: false, data: { packages: [] } })),
        apiRequest<SuccessResponse<any[]>>({
          apiBase,
          path: '/restaurant/featured/my-requests',
          token,
        }).catch(() => ({ success: false, data: [] })),
      ]);

      setProfile(profileData.data);
      setTransferBankName(profileData.data.transferBankName || '');
      setTransferAccountNumber(profileData.data.transferAccountNumber || '');
      setTransferBeneficiaryName(profileData.data.transferBeneficiaryName || '');
      setOrders((current) => {
        const mockOrders = current.filter((o) => o.id.startsWith('mock-order-'));
        return [...mockOrders, ...ordersData.data];
      });
      // Detectar llegadas de repartidor desde datos de la API
      {
        const arrived: Record<string, true> = {};
        for (const o of ordersData.data) {
          if (o.driverArrivedAt && o.isAcceptedByDriver) {
            arrived[o.id] = true;
          }
        }
        if (Object.keys(arrived).length > 0) {
          setDriverArrivedOrders((prev) => ({ ...prev, ...arrived }));
        }
      }
      setProducts(productsData.data);
      setCategories(categoriesData.data);
      setDrivers(driversData.data);
      setPlatformCategories(storeCategoriesData.data);
      setBillingSummary(billingData.data);
      setFeaturedPackages((featuredPriceData as any)?.data?.packages ?? []);
      setFeaturedRequests((featuredRequestsData as any)?.data ?? []);
      setStoreDraft({
        name: profileData.data.name || '',
        description: profileData.data.description || '',
        address: (profileData.data.address || '').replace(/, No\. .*$/, ''),
        houseNumber: (() => {
          const match = (profileData.data.address || '').match(/, No\. (.*)$/);
          return match ? match[1] : '';
        })(),
        latitude: profileData.data.latitude != null ? String(profileData.data.latitude) : '',
        longitude: profileData.data.longitude != null ? String(profileData.data.longitude) : '',
        contactPhone: profileData.data.contactPhone || '',
        email: profileData.data.email || '',
        logo: profileData.data.logo || '',
        coverImage: profileData.data.coverImage || '',
        hasOwnDelivery: profileData.data.hasOwnDelivery,
        minDeliveryTime: String(profileData.data.minDeliveryTime || ''),
        maxDeliveryTime: String(profileData.data.maxDeliveryTime || ''),
        deliveryFee: profileData.data.deliveryFee?.toString() || '',
        deliveryRadius: profileData.data.deliveryRadius?.toString() || '',
        storeCategories: profileData.data.storeCategories?.map(sc => sc.category.id) || [],
        enableTicketPrinting: profileData.data.enableTicketPrinting ?? true,
        whatsappNotifications: profileData.data.whatsappNotifications ?? false,
        instagram: profileData.data.instagram || '',
        facebook: profileData.data.facebook || '',
        tiktok: profileData.data.tiktok || '',
      });
      setOperatingHoursDraft(normalizeOperatingHours(profileData.data.operatingHours));
      setSelectedDriverByOrder((current) => {
        const next = { ...current };

        for (const order of ordersData.data) {
          if (order.driver?.id) {
            next[order.id] = order.driver.id;
          }
        }

        return next;
      });
    } catch (requestError) {
      setProfile(null);
      setOrders([]);
      setProducts([]);
      setCategories([]);
      setDrivers([]);
      setBillingSummary(null);
      setOperatingHoursDraft(buildDefaultOperatingHours());
      const message = getRequestErrorMessage(requestError, 'No se pudo cargar el panel.');
      setError(message);
      if (isAuthRequestError(requestError)) {
        clearSession('Tu sesion ya no es valida. Vuelve a iniciar sesion.');
        pushToast('error', 'Sesion expirada', 'Tu sesion ya no es valida. Vuelve a entrar al panel.');
      } else {
        pushToast(
          'error',
          isTransientRequestError(requestError) ? 'Sincronizacion incompleta' : 'Panel sin sincronizar',
          isTransientRequestError(requestError)
            ? `${message} Hubo reintentos automaticos y aun no fue posible resincronizar.`
            : message
        );
      }
    } finally {
      setLoading(false);
    }
  }, [apiBase, token]);

  // Carga ligera solo de pedidos — para usar en eventos live sin recargar todo el panel
  const loadOrdersOnly = useCallback(async () => {
    try {
      const ordersData = await apiRequest<SuccessResponse<OrderItem[]>>({
        apiBase,
        path: '/restaurant-panel/pedidos',
        token,
        fallbackMessage: 'No se pudieron cargar los pedidos.',
        retry: {
          attempts: 1,
          backoffMs: 300,
        },
      });
      if (ordersData.success) {
        setOrders((current) => {
          const mockOrders = current.filter((o) => o.id.startsWith('mock-order-'));
          return [...mockOrders, ...ordersData.data];
        });
        // Actualizar llegada de repartidores desde datos de la API
        const arrived: Record<string, true> = {};
        for (const o of ordersData.data) {
          if (o.driverArrivedAt && o.isAcceptedByDriver) {
            arrived[o.id] = true;
          }
        }
        if (Object.keys(arrived).length > 0) {
          setDriverArrivedOrders((prev) => ({ ...prev, ...arrived }));
        }
      }
    } catch {
      // Falla silenciosa — el loadDashboard completo se hará en reconexión
    }
  }, [apiBase, token]);

  const loadChatMessages = useCallback(async (orderId: string) => {
    if (!token) return;
    setLoadingChat(true);
    try {
      const response = await fetch(`${apiBase}/orders/${orderId}/messages`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      const data = await response.json();
      if (data.success) {
        setChatMessages(data.messages);
      }
    } catch (err) {
      console.error('Error loading chat messages:', err);
    } finally {
      setLoadingChat(false);
    }
  }, [apiBase, token]);

  const sendChatMessage = async (orderId: string) => {
    if (!token || !orderId || !chatInput.trim() || sendingChatMessage) return;
    const currentInput = chatInput;
    setChatInput('');
    setSendingChatMessage(true);

    try {
      const response = await fetch(`${apiBase}/orders/${orderId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ content: currentInput }),
      });
      const data = await response.json();
      if (data.success) {
        setChatMessages((prev) => [...prev, data.message]);
        // Mensaje enviado correctamente, no reproducimos sonido para el emisor
      } else {
        setChatInput(currentInput);
        pushToast('error', 'Error al enviar mensaje', 'Ocurrió un problema.');
      }
    } catch (err) {
      console.error('Error sending chat message:', err);
      setChatInput(currentInput);
      pushToast('error', 'Error de red', 'No se pudo enviar el mensaje.');
    } finally {
      setSendingChatMessage(false);
    }
  };


  useEffect(() => {
    if (!token || !sessionUser || sessionUser.role !== 'RESTAURANT') {
      return;
    }

    void loadDashboard();
  }, [loadDashboard, token, sessionUser?.id]);

  // Cargar mensajes de chat en tiempo real cuando se abre un ticket o se cambia a la pestaña de chat
  useEffect(() => {
    if (selectedOrderForTicket?.id) {
      void loadChatMessages(selectedOrderForTicket.id);
    }
  }, [selectedOrderForTicket?.id, activeTicketTab, loadChatMessages]);


  // Sincronizar reactivamente el pedido seleccionado en el modal de comanda cuando cambian los pedidos en tiempo real
  useEffect(() => {
    if (selectedOrderForTicket) {
      const updated = orders.find((o) => o.id === selectedOrderForTicket.id);
      if (updated && updated !== selectedOrderForTicket) {
        setSelectedOrderForTicket(updated);
      }
    }
  }, [orders, selectedOrderForTicket]);

  useEffect(() => {
    if (selectedOrderForEtaExtension) {
      const updated = orders.find((o) => o.id === selectedOrderForEtaExtension.id);
      if (updated !== selectedOrderForEtaExtension) {
        setSelectedOrderForEtaExtension(updated || null);
      }
    }
  }, [orders, selectedOrderForEtaExtension]);

  // Stable refs for event callbacks to prevent stale closures and avoid recreating WebSocket connections
  const handleConnectRef = useRef<() => void>();
  const handleLiveEventRef = useRef<(eventName: any, payload: any) => void>();
  const socketRef = useRef<any>(null);
  // Debounce timer para eventos ráfaga
  const liveEventDebounceRef = useRef<any>(null);

  // Sync refs on every render
  handleConnectRef.current = () => {
    setSocketStatus('connected');
    setSocketAttempts(0);
    if (socketRef.current) {
      if (process.env.NODE_ENV !== 'production') {
        console.log('[Socket] Conectado. Socket ID:', socketRef.current.id, '| Uniéndome al room RESTAURANT:', sessionUser?.id);
      }
      if (sessionUser) {
        socketRef.current.emit('join-room', sessionUser.id, 'RESTAURANT');
      }
    }
    // Al conectar/reconectar cargamos todo el panel (perfil, pedidos, etc.)
    void loadDashboard();
  };

  handleLiveEventRef.current = (eventName: any, payload: any) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[Socket] Live event procesando:', eventName, payload);
    }
    const liveEventKey = buildLiveEventKey(eventName, payload);

    if (seenLiveEventKeysRef.current.has(liveEventKey)) {
      if (process.env.NODE_ENV !== 'production') {
        console.log('[Socket] Evento duplicado ignorado. Key:', liveEventKey);
      }
      return;
    }

    seenLiveEventKeysRef.current.add(liveEventKey);
    if (seenLiveEventKeysRef.current.size > 40) {
      const first = seenLiveEventKeysRef.current.values().next().value;
      if (first) seenLiveEventKeysRef.current.delete(first);
    }

    if (eventName === 'order:support-requested') {
      setSupportRequestsQueue((current) => [...current, payload as any]);
      pushToast('info', 'Solicitud de apoyo', '¡Un restaurante cercano solicita apoyo!');
      return;
    }

    if (eventName === 'order:created') {
      // Play sound DIRECTLY — no depende del reload de pedidos
      void playIncomingOrderAlert();
    }

    if (eventName === 'order:driver-arrived-restaurant' && payload.orderId) {
      setDriverArrivedOrders((prev) => ({ ...prev, [payload.orderId!]: true }));
    }

    if (eventName === 'order:picked-up' && payload.orderId) {
      setDriverArrivedOrders((prev) => {
        const next = { ...prev };
        delete next[payload.orderId!];
        return next;
      });
    }

    if (eventName === 'order:cancellation-requested' && payload.orderId) {
      const order = ordersRef.current.find((o) => o.id === payload.orderId);
      if (order && ['PENDING', 'CONFIRMED', 'PREPARING'].includes(order.status)) {
        setCancelRequestModalOrder(order);
        setCancelRequestNote('');
      }
      void playIncomingOrderAlert();
    }

    if (eventName === 'order:cancellation-request-retracted' && payload.orderId) {
      if (cancelRequestModalOrder?.id === payload.orderId) {
        setCancelRequestModalOrder(null);
      }
    }

    const liveMessage = buildRestaurantLiveMessage(eventName, payload);
    setAuthMessage(liveMessage);
    pushToast('info', 'Actualizacion live', liveMessage);

    // Debounce: solo refrescar pedidos, no todo el panel
    // Si llegan múltiples eventos en 2s, se coalescen en una sola llamada
    if (liveEventDebounceRef.current) {
      clearTimeout(liveEventDebounceRef.current);
    }
    liveEventDebounceRef.current = setTimeout(() => {
      liveEventDebounceRef.current = null;
      void loadOrdersOnly();
    }, 2000);
  };

  useEffect(() => {
    if (!token || !sessionUser || sessionUser.role !== 'RESTAURANT') {
      if (socketRef.current) {
        if (process.env.NODE_ENV !== 'production') {
          console.log('[Socket] Limpiando/desconectando socket por cambio de sesión.');
        }
        socketRef.current.disconnect();
        socketRef.current = null;
        setSocketStatus('idle');
      }
      return;
    }

    // Reuse existing connection to prevent connection storms and Fast Refresh disconnects
    if (socketRef.current && socketRef.current.connected) {
      if (process.env.NODE_ENV !== 'production') {
        console.log('[Socket] Reutilizando conexión activa:', socketRef.current.id);
      }
      socketRef.current.emit('join-room', sessionUser.id, 'RESTAURANT');
      return;
    }

    // Always disconnect stale socket on re-mount (handles Fast Refresh)
    if (socketRef.current) {
      if (process.env.NODE_ENV !== 'production') {
        console.log('[Socket] Cerrando socket previo por re-montaje.');
      }
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    setSocketStatus('connecting');
    const socket = io('https://sadel-production.up.railway.app', {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      if (handleConnectRef.current) {
        handleConnectRef.current();
      }
    });

    socket.io.on('reconnect_attempt', (attempt) => {
      setSocketStatus('reconnecting');
      setSocketAttempts(attempt);
    });

    socket.on('disconnect', (reason) => {
      if (reason !== 'io client disconnect') {
        setSocketStatus('reconnecting');
        return;
      }
      setSocketStatus('idle');
    });

    // Debug: escuchar CUALQUIER evento que llegue
    if (process.env.NODE_ENV !== 'production') {
      socket.onAny((eventName: string, ...args: unknown[]) => {
        console.log('[Socket] Evento recibido:', eventName, JSON.stringify(args).slice(0, 300));
      });
    }

    for (const eventName of liveEvents) {
      socket.on(
        eventName,
        (payload: { orderId?: string; orderReference?: string; customerName?: string; status?: string }) => {
          if (handleLiveEventRef.current) {
            handleLiveEventRef.current(eventName, payload);
          }
        }
      );
    }

    socket.on('restaurant:open_reminder', () => {
      pushToast('info', '¡Es hora de abrir! ⏰', 'Tu horario de apertura ha llegado. Por favor abre tu restaurante.');
      void playIncomingOrderAlert();
    });

    socket.on('restaurant:late_open_reminder', () => {
      pushToast('error', 'Apertura Tardía ⚠️', 'Ya pasaron 15 minutos de tu hora de apertura. Tienes clientes esperando.');
      void playIncomingOrderAlert();
    });

    socket.on('restaurant:close_prompt', () => {
      setShowClosePromptModal(true);
      void playIncomingOrderAlert();
    });

    socket.on('restaurant:auto_closed', () => {
      pushToast('error', 'Auto-Cierre 💤', 'Tu restaurante se cerró automáticamente tras 10 minutos de inactividad después de tu hora de cierre.');
      void loadDashboard();
    });

    // Zombie socket detection: si no se reciben eventos en 90s, refrescar datos
    let lastEventTime = Date.now();
    const healthCheckInterval = setInterval(() => {
      if (socket.connected && document.visibilityState !== 'hidden') {
        const idleTime = Date.now() - lastEventTime;
        if (idleTime > 90000) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[Socket] Zombie detection: no events for 90s, reloading orders');
        }
          void loadOrdersOnly();
          lastEventTime = Date.now();
        }
      }
    }, 60000);
    socket.onAny(() => { lastEventTime = Date.now(); });

    socket.on('order_chat:message_received', (payload: any) => {
      // Play pop notification sound
      void playChatPopSound();

      if (payload.orderId === selectedOrderForTicketIdRef.current) {
        setChatMessages((prev) => {
          if (prev.some((msg) => msg.id === payload.id)) return prev;
          return [...prev, payload];
        });
      } else {
        setUnreadMessagesMap((prev) => ({
          ...prev,
          [payload.orderId]: (prev[payload.orderId] || 0) + 1,
        }));
      }
    });

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (!socket.connected) {
          socket.connect();
        }
        if (audioContextRef.current?.state === 'suspended' && hasUserInteractedRef.current) {
          void audioContextRef.current.resume();
        }
        loadOrdersOnly();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(healthCheckInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      socket.off('order_chat:message_received');
      // Disconnect socket ONLY when token or sessionUser.id/role changes, not on hot reload re-renders
      if (!token || !sessionUser || sessionUser.role !== 'RESTAURANT') {
        socket.emit('leave-room', sessionUser.id, 'RESTAURANT');
        socket.disconnect();
        if (socketRef.current === socket) {
          socketRef.current = null;
        }
        setSocketStatus('idle');
        setSocketAttempts(0);
      }
    };
  }, [apiBase, token, sessionUser?.id, sessionUser?.role]);

  useEffect(() => {
    if (!isOrderAlertSoundEnabled || orderAlertAudioState === 'unsupported') {
      return;
    }

    function unlockOrderAlertAudio() {
      void warmOrderAlertAudio(true);
    }

    window.addEventListener('pointerdown', unlockOrderAlertAudio, { passive: true });
    window.addEventListener('keydown', unlockOrderAlertAudio);

    return () => {
      window.removeEventListener('pointerdown', unlockOrderAlertAudio);
      window.removeEventListener('keydown', unlockOrderAlertAudio);
    };
  }, [isOrderAlertSoundEnabled, orderAlertAudioState, warmOrderAlertAudio]);

  useEffect(() => {
    if (orderAlertAudioState === 'ready') {
      hasShownOrderAlertBlockedToastRef.current = false;
    }
  }, [orderAlertAudioState]);

  useEffect(() => {
    return () => {
      if (pulseIntervalRef.current) {
        clearInterval(pulseIntervalRef.current);
        pulseIntervalRef.current = null;
      }
      try { alarmSourceRef.current?.stop(); } catch { /* ya terminó */ }
      alarmSourceRef.current = null;
      if (!audioContextRef.current) {
        return;
      }

      void audioContextRef.current.close();
      audioContextRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!pendingIncomingOrders.length) {
      if (incomingOrderQueue.length > 0) {
        setIncomingOrderQueue([]);
      }
      return;
    }

    const sortedQueue = [...incomingOrderQueue]
      .filter((orderId) => pendingIncomingOrderMap.has(orderId))
      .sort((left, right) => {
        const leftOrder = pendingIncomingOrderMap.get(left);
        const rightOrder = pendingIncomingOrderMap.get(right);
        return new Date(leftOrder?.createdAt || 0).getTime() - new Date(rightOrder?.createdAt || 0).getTime();
      });

    if (sortedQueue.length !== incomingOrderQueue.length || sortedQueue.some((orderId, index) => orderId !== incomingOrderQueue[index])) {
      setIncomingOrderQueue(sortedQueue);
    }
  }, [incomingOrderQueue, pendingIncomingOrderMap, pendingIncomingOrders.length]);

  useEffect(() => {
    if (!orders.length) {
      return;
    }

    const now = Date.now();
    const pendingOrders = [...orders]
      .filter((order) => order.status === 'PENDING')
      .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());

    for (const order of pendingOrders) {
      if (resolvedIncomingOrderIdsRef.current.includes(order.id)) {
        continue;
      }

      const createdAtMs = new Date(order.createdAt).getTime();
      const isStoreOrder = profile?.businessType && profile.businessType !== 'RESTAURANT';
      const decisionWindow = order.paymentMethod === 'TRANSFER' ? 10 * 60 * 1000 : isStoreOrder ? 8 * 60 * 1000 : 2 * 60 * 1000;
      const expiresAtMs = createdAtMs + decisionWindow;

      if (expiresAtMs <= now) {
        if (!autoRejectingOrderIdsRef.current.includes(order.id)) {
          autoRejectingOrderIdsRef.current = [...autoRejectingOrderIdsRef.current.slice(-29), order.id];
          resolvedIncomingOrderIdsRef.current = [...resolvedIncomingOrderIdsRef.current.slice(-79), order.id];
          setIncomingOrderQueue((current) => current.filter((queuedId) => queuedId !== order.id));
          void runOrderAction(order.id, 'reject', { silentSuccess: true, preserveFailedAction: false });
        }
        continue;
      }

      if (promptedIncomingOrderIdsRef.current.includes(order.id)) {
        continue;
      }

      promptedIncomingOrderIdsRef.current = [...promptedIncomingOrderIdsRef.current.slice(-79), order.id];
      setIncomingOrderQueue((current) => (current.includes(order.id) ? current : [...current, order.id]));

      if (!soundedIncomingOrderIdsRef.current.includes(order.id)) {
        soundedIncomingOrderIdsRef.current = [...soundedIncomingOrderIdsRef.current.slice(-79), order.id];

        if (isOrderAlertSoundEnabled) {
          void playIncomingOrderAlert().then((didPlay) => {
            if (didPlay || orderAlertAudioState !== 'needs-gesture') {
              return;
            }
            pushToast(
              'info',
              'Sonido bloqueado',
              'Toca la pantalla para habilitar el sonido de nuevos pedidos. El navegador requiere una interacción manual.'
            );
          });
        }
      }
    }
  }, [isOrderAlertSoundEnabled, orderAlertAudioState, orders, playIncomingOrderAlert]);

  useEffect(() => {
    if (!activeIncomingOrder || !isOrderAlertSoundEnabled) {
      return;
    }

    void playIncomingOrderAlert();

    const workerCode = `
      let interval;
      self.onmessage = function(e) {
        if (e.data === 'start') {
          interval = setInterval(() => self.postMessage('tick'), 3000);
        } else if (e.data === 'stop') {
          clearInterval(interval);
        }
      };
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    const worker = new Worker(workerUrl);

    worker.onmessage = () => {
      void playIncomingOrderAlert();
    };

    worker.postMessage('start');

    return () => {
      worker.postMessage('stop');
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
    };
  }, [activeIncomingOrder, isOrderAlertSoundEnabled, playIncomingOrderAlert]);

  // Screen Wake Lock: keep display on while the app is open
  useEffect(() => {
    async function acquireWakeLock() {
      try {
        if ('wakeLock' in navigator && !wakeLockRef.current) {
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

    void acquireWakeLock();

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void acquireWakeLock();
      } else {
        void releaseWakeLock();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      void releaseWakeLock();
    };
  }, []);

  useEffect(() => {
    const updateRootClock = () => {
      setKitchenClockNow(Date.now());
    };

    updateRootClock();
    let timer = window.setInterval(updateRootClock, 15000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        updateRootClock();
        if (!timer) {
          timer = window.setInterval(updateRootClock, 15000);
        }
      } else {
        if (timer) {
          window.clearInterval(timer);
          timer = 0;
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (timer) window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    return () => {
      for (const [id, timeoutId] of toastTimeoutsRef.current) {
        clearTimeout(timeoutId);
      }
      toastTimeoutsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!activeIncomingOrder) {
      setIncomingOrderCountdownMs(newOrderDecisionWindowMs);
      setIsSelectingPrepTime(false);
      setIsScheduledMode(false);
      setScheduledDeliveryDate('');
      setScheduledDeliveryTime('');
      return;
    }

    setIsSelectingPrepTime(false);
    setIsScheduledMode(false);
    setScheduledDeliveryDate('');
    setScheduledDeliveryTime('');
    const orderId = activeIncomingOrder.id;
    const isStoreOrder = profile?.businessType && profile.businessType !== 'RESTAURANT';
    const decisionWindow = activeIncomingOrder.paymentMethod === 'TRANSFER' ? 10 * 60 * 1000 : isStoreOrder ? 8 * 60 * 1000 : 2 * 60 * 1000;

    // When order becomes first in queue (active), start its decision window now.
    // The backend also uses this "active since" timestamp via Redis.
    // This ensures queued orders get a full window when they reach the front of the line.
    const activeSince = Date.now();

    function syncCountdown() {
      const expiresAt = activeSince + decisionWindow;
      const nextCountdown = Math.max(0, expiresAt - Date.now());
      setIncomingOrderCountdownMs(nextCountdown);

      if (nextCountdown === 0) {
        // El auto-rechazo se maneja en el backend (order-timeout.job).
      }
    }

    syncCountdown();
    const timer = window.setInterval(syncCountdown, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [activeIncomingOrder?.id]);

  async function runOrderAction(
    orderId: string,
    actionKey: keyof typeof restaurantActionMap,
    options?: {
      preparationTimeMinutes?: PreparationPresetMinutes;
      scheduledDeliveryAt?: string;
      preserveFailedAction?: boolean;
      silentSuccess?: boolean;
      pin?: string;
    }
  ) {
    const action = restaurantActionMap[actionKey];
    setActiveActionKey(`${orderId}:${actionKey}`);
    setError('');
    setAuthMessage('');

    const preserveFailedAction = options?.preserveFailedAction ?? true;
    const silentSuccess = options?.silentSuccess ?? false;
    const preparationTimeMinutes = options?.preparationTimeMinutes;
    const scheduledDeliveryAt = options?.scheduledDeliveryAt;

    resolvedIncomingOrderIdsRef.current = [...resolvedIncomingOrderIdsRef.current.slice(-79), orderId];
    setIncomingOrderQueue((current) => current.filter((queuedId) => queuedId !== orderId));

    if (orderId.startsWith('mock-order-')) {
      setOrders((current) =>
        current.map((o) => {
          if (o.id !== orderId) return o;

          let nextStatus: OrderStatus = o.status;
          let preparationDeadlineAt = o.preparationDeadlineAt;
          let driver = o.driver;
          let noDriversAvailable = o.noDriversAvailable;

          if (actionKey === 'accept') {
            nextStatus = 'PREPARING';
            const prepMinutes = preparationTimeMinutes ?? 15;
            preparationDeadlineAt = new Date(Date.now() + prepMinutes * 60 * 1000).toISOString();
          } else if (actionKey === 'reject') {
            nextStatus = 'REJECTED';
          } else if (actionKey === 'ready') {
            nextStatus = 'READY';
          } else if (actionKey === 'asumirReparto') {
            nextStatus = 'IN_TRANSIT';
          } else if (actionKey === 'delivered') {
            nextStatus = 'DELIVERED';
          } else if (actionKey === 'quitarRepartidor') {
            nextStatus = 'READY';
            driver = null;
          } else if (actionKey === 'solicitarApoyo') {
            noDriversAvailable = false;
          } else if (actionKey === 'marcarRecogido') {
            nextStatus = 'COMPLETED';
          } else if (actionKey === 'cancel') {
            nextStatus = 'CANCELLED';
          }

          return {
            ...o,
            status: nextStatus,
            preparationTimeMinutes: actionKey === 'accept' ? (preparationTimeMinutes ?? 15) : o.preparationTimeMinutes,
            preparationDeadlineAt,
            driver,
            noDriversAvailable,
            cashPaymentConfirmedAt: actionKey === 'confirmarPagoEfectivo' ? new Date().toISOString() : o.cashPaymentConfirmedAt,
          };
        })
      );

      if (actionKey === 'accept') {
        setAcceptancePromptOrderId(null);
      }

      setAuthMessage(
        actionKey === 'reject'
          ? 'Pedido de simulación rechazado.'
          : actionKey === 'accept'
            ? `Pedido de simulación aceptado. Preparacion estimada: ${preparationTimeMinutes ?? 15} min.`
            : `Acción de simulación "${action.label}" completada.`
      );

      triggerHaptic([30, 50, 30]);
      pushToast(
        'success',
        `Simulación: ${action.label}`,
        actionKey === 'reject'
          ? 'Se rechazó el pedido simulado.'
          : actionKey === 'accept'
            ? `El pedido simulado ahora está en cocina con ${preparationTimeMinutes ?? 15} min de preparación.`
            : `Simulación de "${action.label}" realizada con éxito.`
      );

      setActiveActionKey(null);
      return;
    }

    try {
      const res = await requestJson<SuccessResponse<any>>({
        apiBase,
        path: `/restaurant-panel/pedidos/${orderId}/${action.path}`,
        token,
        options: {
          method: 'PATCH',
          ...(actionKey === 'accept'
            ? {
              body: JSON.stringify({
                preparationTimeMinutes: preparationTimeMinutes ?? 15,
                ...(scheduledDeliveryAt ? { scheduledDeliveryAt } : {}),
              }),
            }
            : actionKey === 'handover'
            ? {
              body: JSON.stringify({
                pin: options?.pin,
              }),
            }
            : {}),
        },
        fallbackMessage: `No se pudo ejecutar la accion "${action.label}".`,
        retry: {
          attempts: 1,
          backoffMs: 400,
        },
      });

      if (actionKey === 'asumirReparto' && res?.data?.deliveryToken) {
        setActiveQrCodeData({
          token: res.data.deliveryToken.token,
          orderReference: res.data.orderReference,
          id: orderId,
        });
      }

      await loadOrdersOnly();
      if (actionKey === 'accept') {
        setAcceptancePromptOrderId(null);
      } else if (actionKey === 'handover') {
        setHandoverPromptOrderId(null);
        setHandoverPinInput('');
      }
      setAuthMessage(
        silentSuccess && actionKey === 'reject'
          ? 'El pedido vencido se rechazo automaticamente.'
          : actionKey === 'accept'
            ? `Pedido aceptado. Preparacion estimada: ${preparationTimeMinutes ?? 15} min.`
            : action.successMessage
      );
      setLastFailedAction(null);
      triggerHaptic([30, 50, 30]); // Double vibration
      pushToast(
        'success',
        silentSuccess && actionKey === 'reject' ? 'Pedido vencido' : action.label,
        silentSuccess && actionKey === 'reject'
          ? 'Se rechazo automaticamente un pedido pendiente al vencer los 2 minutos.'
          : actionKey === 'accept'
            ? `El cliente ya verá una entrega estimada con ${preparationTimeMinutes ?? 15} min de preparacion.`
            : action.successMessage
      );
    } catch (requestError) {
      const message = getRequestErrorMessage(requestError, `No se pudo ejecutar ${action.label}.`);

      // Verificar si la accion realmente se aplicó en el servidor a pesar del error de red
      // (el servidor pudo procesar el PATCH pero la respuesta HTTP no llegó al cliente)
      try {
        const verifyRes = await fetch(`${apiBase}/restaurant-panel/pedidos/${orderId}`, {
          headers: { authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (verifyRes.ok) {
          const verifyData = await verifyRes.json();
          const currentStatus: string | undefined = verifyData?.data?.status || verifyData?.status;
          const expectedStatuses: Record<string, string[]> = {
            accept: ['PREPARING'],
            ready: ['READY'],
            reject: ['REJECTED', 'CANCELLED'],
            delivered: ['DELIVERED'],
            handover: ['PICKED_UP', 'IN_TRANSIT'],
            asumirReparto: ['IN_TRANSIT'],
            quitarRepartidor: ['READY'],
            confirmarPagoEfectivo: ['DELIVERED', 'READY', 'IN_TRANSIT'],
            iniciarEntrega: ['IN_TRANSIT'],
            marcarRecogido: ['COMPLETED'],
          };
          const expected = expectedStatuses[actionKey];
          if (expected && expected.includes(currentStatus || '')) {
            await loadDashboard();
            setLastFailedAction(null);
            setAuthMessage(action.successMessage);
            triggerHaptic([30, 50, 30]);
            pushToast('success', action.label, action.successMessage);
            return;
          }
        }
      } catch {
        // Fallo la verificación, se muestra el error original
      }

      setError(message);
      if (preserveFailedAction) {
        setLastFailedAction({
          kind: 'order-action',
          orderId,
          actionKey,
          label: action.label,
        });
      }
      promptedIncomingOrderIdsRef.current = promptedIncomingOrderIdsRef.current.filter((id) => id !== orderId);
      resolvedIncomingOrderIdsRef.current = resolvedIncomingOrderIdsRef.current.filter((id) => id !== orderId);
      setIncomingOrderQueue((current) => (current.includes(orderId) ? current : [orderId, ...current]));
      pushToast(
        'error',
        isTransientRequestError(requestError) ? 'Fallo transitorio' : `Fallo al ${action.label.toLowerCase()}`,
        isTransientRequestError(requestError)
          ? `${message} Ya se intentó una vez más en automático. Puedes reintentar sin recargar.`
          : `${message} Puedes reintentar sin recargar.`
      );
    } finally {
      autoRejectingOrderIdsRef.current = autoRejectingOrderIdsRef.current.filter((id) => id !== orderId);
      setActiveActionKey(null);
    }
  }

  async function extendPreparationTime(orderId: string, additionalMinutes: number) {
    setActiveActionKey(`${orderId}:extend-${additionalMinutes}`);
    setError('');
    setAuthMessage('');

    try {
      await requestJson<SuccessResponse<OrderItem>>({
        apiBase,
        path: `/restaurant-panel/pedidos/${orderId}/extender-tiempo`,
        token,
        options: {
          method: 'POST',
          body: JSON.stringify({ additionalMinutes }),
        },
        fallbackMessage: 'No se pudo agregar tiempo al pedido.',
      });

      await loadOrdersOnly();
      setAuthMessage(`Se agregaron ${additionalMinutes} min y el cliente verá la nueva hora estimada.`);
      pushToast('success', 'Tiempo actualizado', `+${additionalMinutes} min agregados al pedido.`);
      return true;
    } catch (requestError) {
      const message = getRequestErrorMessage(requestError, 'No se pudo agregar tiempo al pedido.');
      setError(message);
      pushToast('error', 'No se pudo actualizar', message);
      return false;
    } finally {
      setActiveActionKey(null);
    }
  }

  async function assignDriver(orderId: string) {
    const driverId = selectedDriverByOrder[orderId];

    if (!driverId) {
      const message = 'Selecciona un repartidor antes de asignarlo.';
      setError(message);
      pushToast('error', 'Asignacion incompleta', message);
      return;
    }

    if (orderId.startsWith('mock-order-')) {
      const selectedDriver = drivers.find((d) => d.id === driverId);
      setOrders((current) =>
        current.map((o) => {
          if (o.id !== orderId) return o;
          return {
            ...o,
            driver: selectedDriver
              ? {
                  id: selectedDriver.id,
                  user: {
                    name: selectedDriver.user?.name || 'Repartidor de prueba',
                    phone: selectedDriver.user?.phone || '5544332211',
                  },
                }
              : null,
            status: 'IN_TRANSIT',
          };
        })
      );

      const message = 'Repartidor de prueba asignado. Pedido simulado en camino 🛵';
      setAuthMessage(message);
      pushToast('success', 'Simulación: Repartidor asignado', message);
      setActiveActionKey(null);
      return;
    }

    setActiveActionKey(`${orderId}:assign`);
    setError('');
    setAuthMessage('');

    try {
      await requestJson<SuccessResponse<OrderItem>>({
        apiBase,
        path: `/restaurant-panel/pedidos/${orderId}/asignar-repartidor`,
        token,
        options: {
          method: 'POST',
          body: JSON.stringify({ driverId }),
        },
        fallbackMessage: 'No se pudo asignar el repartidor.',
        retry: {
          attempts: 1,
          backoffMs: 400,
        },
      });

      await loadOrdersOnly();
      const message = 'Repartidor asignado y tablero sincronizado.';
      setAuthMessage(message);
      setLastFailedAction(null);
      pushToast('success', 'Repartidor asignado', message);
    } catch (requestError) {
      const message = getRequestErrorMessage(requestError, 'No se pudo asignar el repartidor.');
      setError(message);
      setLastFailedAction({
        kind: 'assign-driver',
        orderId,
        driverId,
        label: 'Asignar repartidor',
      });
      pushToast(
        'error',
        isTransientRequestError(requestError) ? 'Asignacion inestable' : 'Asignacion fallida',
        isTransientRequestError(requestError)
          ? `${message} Ya hubo un reintento automatico y puedes volver a intentarlo.`
          : `${message} Puedes reintentar la asignacion.`
      );
    } finally {
      setActiveActionKey(null);
    }
  }

  async function retryLastFailedAction() {
    if (!lastFailedAction) {
      return;
    }

    if (lastFailedAction.kind === 'order-action') {
      await runOrderAction(lastFailedAction.orderId, lastFailedAction.actionKey);
      return;
    }

    setSelectedDriverByOrder((current) => ({
      ...current,
      [lastFailedAction.orderId]: lastFailedAction.driverId,
    }));
    await assignDriver(lastFailedAction.orderId);
  }

  async function saveStoreProfile() {
    if (!token) {
      return;
    }

    setSavingStoreProfile(true);
    setError('');
    setAuthMessage('');

    try {
      const payloadBody = {
        name: storeDraft.name.trim(),
        description: storeDraft.description.trim(),
        address: `${storeDraft.address.trim()}${storeDraft.houseNumber.trim() ? `, No. ${storeDraft.houseNumber.trim()}` : ''}`,
        contactPhone: storeDraft.contactPhone.trim(),
        email: storeDraft.email.trim(),
        logo: storeDraft.logo.trim() || null,
        coverImage: storeDraft.coverImage.trim() || null,
        hasOwnDelivery: storeDraft.hasOwnDelivery,
        minDeliveryTime: Number(storeDraft.minDeliveryTime),
        maxDeliveryTime: Number(storeDraft.maxDeliveryTime),
        deliveryFee:
          storeDraft.hasOwnDelivery && storeDraft.deliveryFee.trim()
            ? Number(storeDraft.deliveryFee)
            : null,
        deliveryRadius: storeDraft.deliveryRadius.trim()
          ? Number(storeDraft.deliveryRadius)
          : null,
        storeCategories: storeDraft.storeCategories,
        enableTicketPrinting: storeDraft.enableTicketPrinting,
        instagram: storeDraft.instagram.trim() || null,
        facebook: storeDraft.facebook.trim() || null,
        tiktok: storeDraft.tiktok.trim() || null,
        transferBankName: transferBankName.trim() || null,
        transferAccountNumber: transferAccountNumber.trim() || null,
        transferBeneficiaryName: transferBeneficiaryName.trim() || null,
        ...(storeDraft.latitude.trim() ? { latitude: Number(storeDraft.latitude) } : {}),
        ...(storeDraft.longitude.trim() ? { longitude: Number(storeDraft.longitude) } : {}),
      };

      const payload = await requestJson<SuccessResponse<RestaurantProfile>>({
        apiBase,
        path: '/restaurant-panel/perfil',
        token,
        options: {
          method: 'PATCH',
          body: JSON.stringify(payloadBody),
        },
        fallbackMessage: 'No se pudo guardar la tienda.',
        retry: {
          attempts: 1,
          backoffMs: 400,
        },
      });

      setProfile(payload.data);
      setStoreDraft({
        name: payload.data.name || '',
        description: payload.data.description || '',
        address: (payload.data.address || '').replace(/, No\. .*$/, ''),
        houseNumber: (() => {
          const match = (payload.data.address || '').match(/, No\. (.*)$/);
          return match ? match[1] : '';
        })(),
        latitude: typeof payload.data.latitude === 'number' ? String(payload.data.latitude) : '',
        longitude: typeof payload.data.longitude === 'number' ? String(payload.data.longitude) : '',
        contactPhone: payload.data.contactPhone || '',
        email: payload.data.email || '',
        logo: payload.data.logo || '',
        coverImage: payload.data.coverImage || '',
        hasOwnDelivery: payload.data.hasOwnDelivery,
        minDeliveryTime: String(payload.data.minDeliveryTime || ''),
        maxDeliveryTime: String(payload.data.maxDeliveryTime || ''),
        deliveryFee: typeof payload.data.deliveryFee === 'number' ? String(payload.data.deliveryFee) : '',
        deliveryRadius: typeof payload.data.deliveryRadius === 'number' ? String(payload.data.deliveryRadius) : '',
        storeCategories: payload.data.storeCategories?.map((sc: any) => sc.category.id) || [],
        enableTicketPrinting: payload.data.enableTicketPrinting ?? true,
        whatsappNotifications: payload.data.whatsappNotifications ?? false,
        instagram: payload.data.instagram || '',
        facebook: payload.data.facebook || '',
        tiktok: payload.data.tiktok || '',
      });
      setTransferBankName(payload.data.transferBankName || '');
      setTransferAccountNumber(payload.data.transferAccountNumber || '');
      setTransferBeneficiaryName(payload.data.transferBeneficiaryName || '');
      const message = 'Tu tienda se actualizo correctamente.';
      setAuthMessage(message);
      pushToast('success', 'Mi Tienda', message);
      setShowSaveSuccessModal(true);
    } catch (requestError) {
      const message = getRequestErrorMessage(requestError, 'No se pudo guardar la tienda.');
      setError(message);
      pushToast('error', 'No se pudo guardar', message);
    } finally {
      setSavingStoreProfile(false);
    }
  }

  async function createCategory() {
    if (!token || !newCategoryName.trim()) {
      return;
    }

    setCreatingCategory(true);
    setError('');

    try {
      await requestJson<SuccessResponse<CategoryItem>>({
        apiBase,
        path: '/restaurant-panel/categorias',
        token,
        options: {
          method: 'POST',
          body: JSON.stringify({
            name: newCategoryName.trim(),

            order: categories.length,
          }),
        },
        fallbackMessage: 'No se pudo crear la categoria.',
      });

      setIsCategoryModalOpen(false);
      setNewCategoryName('');

      await loadDashboard();
      pushToast('success', 'Categoría creada', 'La nueva categoría ya esta disponible.');
      setShowSaveSuccessModal(true);
    } catch (requestError) {
      const message = getRequestErrorMessage(requestError, 'No se pudo crear la categoria.');
      setError(message);
      pushToast('error', 'Categoria no creada', message);
    } finally {
      setCreatingCategory(false);
    }
  }

  async function deleteCategory(categoryId: string, categoryName: string, productCount: number) {
    if (!token) {
      return;
    }

    if (productCount > 0) {
      pushToast(
        'error',
        'Categoria en uso',
        'Primero mueve o elimina los productos asociados antes de borrar esta categoria.'
      );
      return;
    }

    const confirmed = window.confirm(
      `Vas a eliminar la categoria "${categoryName}". Esta accion no se puede deshacer.`
    );

    if (!confirmed) {
      return;
    }

    const actionKey = `category:${categoryId}:delete`;
    setActiveActionKey(actionKey);
    setError('');

    try {
      await requestJson<void>({
        apiBase,
        path: `/restaurant-panel/categorias/${categoryId}`,
        token,
        options: {
          method: 'DELETE',
        },
        fallbackMessage: 'No se pudo eliminar la categoria.',
      });

      await loadDashboard();
      pushToast('success', 'Categoria eliminada', `"${categoryName}" ya no aparece en tu tienda.`);
    } catch (requestError) {
      const message = getRequestErrorMessage(requestError, 'No se pudo eliminar la categoria.');
      setError(message);
      pushToast('error', 'Categoria no eliminada', message);
    } finally {
      setActiveActionKey((current) => (current === actionKey ? null : current));
    }
  }

  async function moveCategoryUp(categoryId: string) {
    if (!token) return;
    const index = categories.findIndex((c) => c.id === categoryId);
    if (index <= 0) return;

    const currentCategory = categories[index];
    const prevCategory = categories[index - 1];

    try {
      await requestJson<void>({
        apiBase,
        path: `/restaurant-panel/categorias/${currentCategory.id}`,
        token,
        options: {
          method: 'PATCH',
          body: JSON.stringify({ order: prevCategory.order }),
        },
      });

      await requestJson<void>({
        apiBase,
        path: `/restaurant-panel/categorias/${prevCategory.id}`,
        token,
        options: {
          method: 'PATCH',
          body: JSON.stringify({ order: currentCategory.order }),
        },
      });

      await loadDashboard();
      pushToast('success', 'Orden actualizado', 'Se ha movido la categoría.');
    } catch (requestError) {
      pushToast('error', 'Error', 'No se pudo mover la categoría.');
    }
  }

  async function moveCategoryDown(categoryId: string) {
    if (!token) return;
    const index = categories.findIndex((c) => c.id === categoryId);
    if (index < 0 || index >= categories.length - 1) return;

    const currentCategory = categories[index];
    const nextCategory = categories[index + 1];

    try {
      await requestJson<void>({
        apiBase,
        path: `/restaurant-panel/categorias/${currentCategory.id}`,
        token,
        options: {
          method: 'PATCH',
          body: JSON.stringify({ order: nextCategory.order }),
        },
      });

      await requestJson<void>({
        apiBase,
        path: `/restaurant-panel/categorias/${nextCategory.id}`,
        token,
        options: {
          method: 'PATCH',
          body: JSON.stringify({ order: currentCategory.order }),
        },
      });

      await loadDashboard();
      pushToast('success', 'Orden actualizado', 'Se ha movido la categoría.');
    } catch (requestError) {
      pushToast('error', 'Error', 'No se pudo mover la categoría.');
    }
  }

  function openProductModal(categoryId?: string) {
    setProductImageValidationError('');
    setProductDraft({
      id: undefined,
      categoryId: categoryId || categories[0]?.id || '',
      name: '',
      description: '',
      price: '',
      discountPrice: '',
      sellBy: 'UNIT',
      unitPrice: '',
      minWeightG: '100',
      maxWeightG: '5000',
      stepWeightG: '100',
      weightPresets: [100, 200, 300, 500, 1000],
      image: '',
      images: [],
      imagePosition: '50% 50%',
      imageZoom: 100,
      isAdultOnly: false,
      preparationTime: '15',
      optionGroups: [],
    });
    setIsProductModalOpen(true);
  }

  function openEditProductModal(product: ProductItem) {
    setProductImageValidationError('');
    setProductDraft({
      id: product.id,
      categoryId: product.categoryId || product.category?.id || '',
      name: product.name,
      description: product.description,
      price: String(product.price),
      discountPrice: product.discountPrice ? String(product.discountPrice) : '',
      sellBy: product.sellBy || 'UNIT',
      unitPrice: product.unitPrice ? String(product.unitPrice) : '',
      minWeightG: product.minWeightG ? String(product.minWeightG) : '100',
      maxWeightG: product.maxWeightG ? String(product.maxWeightG) : '5000',
      stepWeightG: product.stepWeightG ? String(product.stepWeightG) : '100',
      weightPresets: product.weightPresets || [100, 200, 300, 500, 1000],
      image: product.image || '',
      images: product.images?.length ? product.images : (product.image ? [product.image] : []),
      imagePosition: product.imagePosition || '50% 50%',
      imageZoom: product.imageZoom || 100,
      isAdultOnly: product.isAdultOnly || false,
      preparationTime: String(product.preparationTime),
      optionGroups: product.optionGroups || [],
    });
    setIsProductModalOpen(true);

    if (token) {
      void requestJson<SuccessResponse<ProductItem>>({
        apiBase,
        path: `/restaurant-panel/productos/${product.id}`,
        token,
        fallbackMessage: 'No se pudieron cargar los detalles del producto.',
      }).then((response) => {
        if (response.success && response.data) {
          setProductDraft((current) => {
            if (current.id === product.id) {
              return {
                ...current,
                optionGroups: response.data.optionGroups || [],
              };
            }
            return current;
          });
        }
      }).catch((err) => {
        console.error('Error fetching full product details:', err);
      });
    }
  }

  function openDeleteProductModal(product: ProductItem) {
    setDeletingProductId(product.id);
    setDeletingProductName(product.name);
    setIsDeleteProductModalOpen(true);
  }

  function openCoverImageModal() {
    setCoverImageDraft(storeDraft.coverImage);
    setCoverImageValidationError('');
    setCoverImagePreviewError(false);
    setIsCoverImageModalOpen(true);
  }

  function openLogoModal() {
    setLogoDraft(storeDraft.logo);
    setLogoValidationError('');
    setLogoPreviewError(false);
    setIsLogoModalOpen(true);
  }

  async function handleCoverImageFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      const message = 'Selecciona un archivo de imagen valido para la portada.';
      setError(message);
      setCoverImageValidationError(message);
      pushToast('error', 'Imagen invalida', message);
      event.target.value = '';
      return;
    }

    setProcessingCoverImage(true);
    setError('');

    try {
      const imageUrl = await convertImageFileToDataUrl(file, 1200, 675, 0.80);
      setCoverImageDraft(imageUrl);
      setCoverImageValidationError('');
      setCoverImagePreviewError(false);
      pushToast('success', 'Imagen lista', 'La portada ya esta lista para guardarse.');
    } catch (fileError) {
      const message =
        fileError instanceof Error ? fileError.message : 'No se pudo preparar la imagen seleccionada.';
      setError(message);
      setCoverImageValidationError(message);
      pushToast('error', 'No se pudo cargar', message);
    } finally {
      setProcessingCoverImage(false);
      event.target.value = '';
    }
  }

  async function saveCoverImage() {
    if (!token) {
      return;
    }

    const nextCoverImage = coverImageDraft.trim();
    const validationMessage = getImageValidationMessage(nextCoverImage, 'cover');

    if (validationMessage) {
      setCoverImageValidationError(validationMessage);
      setError(validationMessage);
      pushToast('error', 'Portada no valida', validationMessage);
      return;
    }

    setSavingCoverImage(true);
    setError('');
    setCoverImageValidationError('');

    try {
      if (nextCoverImage) {
        await ensureImageSourceCanLoad(nextCoverImage, 'cover');
      }

      const persistedCoverImage = nextCoverImage
        ? await persistUploadedImageSource({
          apiBase,
          token,
          source: nextCoverImage,
          kind: 'restaurant-cover',
          fallbackMessage: 'No se pudo subir la portada.',
        })
        : '';

      const payload = await requestJson<SuccessResponse<RestaurantProfile>>({
        apiBase,
        path: '/restaurant-panel/perfil',
        token,
        options: {
          method: 'PATCH',
          body: JSON.stringify({
            coverImage: persistedCoverImage || null,
          }),
        },
        fallbackMessage: 'No se pudo guardar la portada.',
        retry: {
          attempts: 1,
          backoffMs: 400,
        },
      });

      setProfile(payload.data);
      setStoreDraft((current) => ({
        ...current,
        coverImage: payload.data.coverImage || '',
      }));
      setIsCoverImageModalOpen(false);
      setCoverImageDraft(payload.data.coverImage || '');
      setCoverImageValidationError('');
      setCoverImagePreviewError(false);
      pushToast('success', 'Portada actualizada', 'La nueva portada ya aparece en tu tienda.');
      setShowSaveSuccessModal(true);
    } catch (requestError) {
      const message = getRequestErrorMessage(requestError, 'No se pudo guardar la portada.');
      setError(message);
      setCoverImageValidationError(message);
      setCoverImagePreviewError(Boolean(nextCoverImage));
      pushToast('error', 'Portada no actualizada', message);
    } finally {
      setSavingCoverImage(false);
    }
  }

  async function handleLogoFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      const message = 'Selecciona un archivo de imagen valido para el logo.';
      setError(message);
      setLogoValidationError(message);
      pushToast('error', 'Imagen invalida', message);
      event.target.value = '';
      return;
    }

    setProcessingLogo(true);
    setError('');

    try {
      const imageUrl = await convertImageFileToDataUrl(file, 300, 300, 0.75);
      setLogoDraft(imageUrl);
      setLogoValidationError('');
      setLogoPreviewError(false);
      pushToast('success', 'Logo listo', 'La imagen de perfil ya esta lista para guardarse.');
    } catch (fileError) {
      const message = fileError instanceof Error ? fileError.message : 'No se pudo preparar la imagen seleccionada.';
      setError(message);
      setLogoValidationError(message);
      pushToast('error', 'No se pudo cargar', message);
    } finally {
      setProcessingLogo(false);
      event.target.value = '';
    }
  }

  async function saveLogo() {
    if (!token) {
      return;
    }

    const nextLogo = logoDraft.trim();
    const validationMessage = getImageValidationMessage(nextLogo, 'logo');

    if (validationMessage) {
      setLogoValidationError(validationMessage);
      setError(validationMessage);
      pushToast('error', 'Logo no valido', validationMessage);
      return;
    }

    setSavingLogo(true);
    setError('');
    setLogoValidationError('');

    try {
      if (nextLogo) {
        await ensureImageSourceCanLoad(nextLogo, 'logo');
      }

      const persistedLogo = nextLogo
        ? await persistUploadedImageSource({
          apiBase,
          token,
          source: nextLogo,
          kind: 'restaurant-logo',
          fallbackMessage: 'No se pudo subir el logo.',
        })
        : '';

      const payload = await requestJson<SuccessResponse<RestaurantProfile>>({
        apiBase,
        path: '/restaurant-panel/perfil',
        token,
        options: {
          method: 'PATCH',
          body: JSON.stringify({
            logo: persistedLogo || null,
          }),
        },
        fallbackMessage: 'No se pudo guardar el logo.',
        retry: {
          attempts: 1,
          backoffMs: 400,
        },
      });

      setProfile(payload.data);
      setStoreDraft((current) => ({
        ...current,
        logo: payload.data.logo || '',
      }));
      setIsLogoModalOpen(false);
      setLogoDraft(payload.data.logo || '');
      setLogoValidationError('');
      setLogoPreviewError(false);
      pushToast('success', 'Logo actualizado', 'La nueva imagen de perfil ya aparece en tu tienda.');
      setShowSaveSuccessModal(true);
    } catch (requestError) {
      const message = getRequestErrorMessage(requestError, 'No se pudo guardar el logo.');
      setError(message);
      setLogoValidationError(message);
      setLogoPreviewError(Boolean(nextLogo));
      pushToast('error', 'Logo no actualizado', message);
    } finally {
      setSavingLogo(false);
    }
  }

  async function createProduct() {
    if (!token || !productDraft.categoryId || !productDraft.name.trim()) {
      return;
    }

    const nextProductImage = productDraft.image.trim();
    const validationMessage = getImageValidationMessage(nextProductImage, 'product');

    if (validationMessage) {
      setProductImageValidationError(validationMessage);
      setError(validationMessage);
      pushToast('error', 'Imagen no valida', validationMessage);
      return;
    }

    setCreatingProduct(true);
    setError('');
    setProductImageValidationError('');

    try {
      if (nextProductImage) {
        await ensureImageSourceCanLoad(nextProductImage, 'product');
      }

      const persistedProductImage = nextProductImage
        ? await persistUploadedImageSource({
          apiBase,
          token,
          source: nextProductImage,
          kind: 'product-image',
          fallbackMessage: 'No se pudo subir la imagen del producto.',
        })
        : '';

      await requestJson<SuccessResponse<ProductItem>>({
        apiBase,
        path: '/restaurant-panel/productos',
        token,
        options: {
          method: 'POST',
          body: JSON.stringify({
            categoryId: productDraft.categoryId,
            name: productDraft.name.trim(),
            description: productDraft.description.trim(),
            price: Number(productDraft.price),
            discountPrice: productDraft.discountPrice ? Number(productDraft.discountPrice) : null,
            sellBy: productDraft.sellBy,
            unitPrice: productDraft.sellBy === 'WEIGHT' ? Number(productDraft.unitPrice) : null,
            minWeightG: productDraft.sellBy === 'WEIGHT' ? Number(productDraft.minWeightG) : null,
            maxWeightG: productDraft.sellBy === 'WEIGHT' ? Number(productDraft.maxWeightG) : null,
            stepWeightG: productDraft.sellBy === 'WEIGHT' ? Number(productDraft.stepWeightG) : null,
            weightPresets: productDraft.sellBy === 'WEIGHT' ? (productDraft.weightPresets?.length ? productDraft.weightPresets : null) : null,
            image: persistedProductImage || null,
            images: productDraft.images.length ? productDraft.images : (persistedProductImage ? [persistedProductImage] : []),
            imagePosition: productDraft.imagePosition || null,
            imageZoom: productDraft.imageZoom || null,
            isAdultOnly: productDraft.isAdultOnly,
            preparationTime: Number(productDraft.preparationTime),
            isAvailable: true,
            allergens: [],
            optionGroups: productDraft.optionGroups || [],
          }),
        },
        fallbackMessage: 'No se pudo crear el producto.',
      });

      setIsProductModalOpen(false);
      setProductDraft({
        id: undefined,
        categoryId: categories[0]?.id || '',
        name: '',
        description: '',
        price: '',
        discountPrice: '',
        sellBy: 'UNIT',
        unitPrice: '',
        minWeightG: '100',
        maxWeightG: '5000',
        stepWeightG: '100',
        weightPresets: [100, 200, 300, 500, 1000],
        image: '',
        images: [],
        imagePosition: '50% 50%',
        imageZoom: 100,
        isAdultOnly: false,
        preparationTime: '15',
      });
      setProductImageValidationError('');
      await loadDashboard();
      pushToast('success', 'Producto creado', 'El nuevo producto ya aparece en tu menu.');
      setShowSaveSuccessModal(true);
    } catch (requestError) {
      const message = getRequestErrorMessage(requestError, 'No se pudo crear el producto.');
      setError(message);
      pushToast('error', 'Producto no creado', message);
    } finally {
      setCreatingProduct(false);
    }
  }

  async function saveProductChanges() {
    if (!token || !productDraft.id || !productDraft.categoryId || !productDraft.name.trim()) {
      return;
    }

    const nextProductImage = productDraft.image.trim();
    const validationMessage = getImageValidationMessage(nextProductImage, 'product');

    if (validationMessage) {
      setProductImageValidationError(validationMessage);
      setError(validationMessage);
      pushToast('error', 'Imagen no valida', validationMessage);
      return;
    }

    setSavingProductChanges(true);
    setError('');
    setProductImageValidationError('');

    try {
      if (nextProductImage) {
        await ensureImageSourceCanLoad(nextProductImage, 'product');
      }

      const persistedProductImage = nextProductImage
        ? await persistUploadedImageSource({
          apiBase,
          token,
          source: nextProductImage,
          kind: 'product-image',
          fallbackMessage: 'No se pudo subir la imagen del producto.',
        })
        : '';

      await requestJson<SuccessResponse<ProductItem>>({
        apiBase,
        path: `/restaurant-panel/productos/${productDraft.id}`,
        token,
        options: {
          method: 'PATCH',
          body: JSON.stringify({
            categoryId: productDraft.categoryId,
            name: productDraft.name.trim(),
            description: productDraft.description.trim(),
            price: Number(productDraft.price),
            discountPrice: productDraft.discountPrice ? Number(productDraft.discountPrice) : null,
            sellBy: productDraft.sellBy,
            unitPrice: productDraft.sellBy === 'WEIGHT' ? Number(productDraft.unitPrice) : null,
            minWeightG: productDraft.sellBy === 'WEIGHT' ? Number(productDraft.minWeightG) : null,
            maxWeightG: productDraft.sellBy === 'WEIGHT' ? Number(productDraft.maxWeightG) : null,
            stepWeightG: productDraft.sellBy === 'WEIGHT' ? Number(productDraft.stepWeightG) : null,
            weightPresets: productDraft.sellBy === 'WEIGHT' ? (productDraft.weightPresets?.length ? productDraft.weightPresets : null) : null,
            image: persistedProductImage || null,
            images: productDraft.images.length ? productDraft.images : (persistedProductImage ? [persistedProductImage] : []),
            imagePosition: productDraft.imagePosition || null,
            imageZoom: productDraft.imageZoom || null,
            isAdultOnly: productDraft.isAdultOnly,
            preparationTime: Number(productDraft.preparationTime),
            optionGroups: productDraft.optionGroups || [],
          }),
        },
        fallbackMessage: 'No se pudo actualizar el producto.',
      });

      setIsProductModalOpen(false);
      setProductDraft({
        id: undefined,
        categoryId: categories[0]?.id || '',
        name: '',
        description: '',
        price: '',
        discountPrice: '',
        sellBy: 'UNIT',
        unitPrice: '',
        minWeightG: '100',
        maxWeightG: '5000',
        stepWeightG: '100',
        weightPresets: [100, 200, 300, 500, 1000],
        image: '',
        images: [],
        imagePosition: '50% 50%',
        imageZoom: 100,
        isAdultOnly: false,
        preparationTime: '15',
      });
      setProductImageValidationError('');
      await loadDashboard();
      pushToast('success', 'Producto actualizado', 'Los cambios del producto ya aparecen en tu menu.');
      setShowSaveSuccessModal(true);
    } catch (requestError) {
      const message = getRequestErrorMessage(requestError, 'No se pudo actualizar el producto.');
      setError(message);
      pushToast('error', 'Producto no actualizado', message);
    } finally {
      setSavingProductChanges(false);
    }
  }

  async function handleProductImageFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      const message = 'Selecciona un archivo de imagen valido para el producto.';
      setError(message);
      setProductImageValidationError(message);
      pushToast('error', 'Imagen invalida', message);
      event.target.value = '';
      return;
    }

    setProcessingProductImage(true);
    setError('');

    try {
      const imageUrl = await convertImageFileToDataUrl(file, 500, 500, 0.78);
      setProductDraft((current) => ({
        ...current,
        image: imageUrl,
        images: current.images.length > 0 ? [imageUrl, ...current.images.slice(1)] : [imageUrl],
      }));
      setProductImageValidationError('');
      pushToast('success', 'Imagen lista', 'La imagen del producto ya esta lista para guardarse.');
    } catch (fileError) {
      const message =
        fileError instanceof Error ? fileError.message : 'No se pudo preparar la imagen seleccionada.';
      setError(message);
      setProductImageValidationError(message);
      pushToast('error', 'No se pudo cargar', message);
    } finally {
      setProcessingProductImage(false);
      event.target.value = '';
    }
  }

  async function handleProductExtraImageFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) {
      event.target.value = '';
      return;
    }
    try {
      const imageUrl = await convertImageFileToDataUrl(file, 500, 500, 0.78);
      setProductDraft((curr) => ({
        ...curr,
        images: [...curr.images, imageUrl],
      }));
    } catch {
      event.target.value = '';
    }
  }

  async function deleteProduct() {
    if (!token || !deletingProductId) {
      return;
    }

    setDeletingProduct(true);
    setError('');

    try {
      await requestJson<SuccessResponse<{ id: string }>>({
        apiBase,
        path: `/restaurant-panel/productos/${deletingProductId}`,
        token,
        options: {
          method: 'DELETE',
        },
        fallbackMessage: 'No se pudo eliminar el producto.',
      });

      setIsDeleteProductModalOpen(false);
      setDeletingProductId(null);
      setDeletingProductName('');
      await loadDashboard();
      pushToast('success', 'Producto eliminado', 'El producto se elimino correctamente del menu.');
    } catch (requestError) {
      const message = getRequestErrorMessage(requestError, 'No se pudo eliminar el producto.');
      setError(message);
      pushToast('error', 'Producto no eliminado', message);
    } finally {
      setDeletingProduct(false);
    }
  }

  async function toggleProductAvailability(product: ProductItem) {
    if (!token) {
      return;
    }

    const nextAvailability = !product.isAvailable;
    setActiveAvailabilityProductId(product.id);
    setError('');

    try {
      await requestJson<SuccessResponse<ProductItem>>({
        apiBase,
        path: `/restaurant-panel/productos/${product.id}/disponibilidad`,
        token,
        options: {
          method: 'PATCH',
          body: JSON.stringify({
            isAvailable: nextAvailability,
          }),
        },
        fallbackMessage: 'No se pudo actualizar la disponibilidad del producto.',
      });

      setProducts((current) =>
        current.map((item) =>
          item.id === product.id
            ? {
              ...item,
              isAvailable: nextAvailability,
            }
            : item
        )
      );

      pushToast(
        'success',
        nextAvailability ? 'Producto disponible' : 'Producto agotado',
        nextAvailability
          ? `${product.name} ya se muestra en la interfaz del comensal.`
          : `${product.name} ya no se muestra en la interfaz del comensal.`
      );
    } catch (requestError) {
      const message = getRequestErrorMessage(
        requestError,
        'No se pudo actualizar la disponibilidad del producto.'
      );
      setError(message);
      pushToast('error', 'Disponibilidad no actualizada', message);
    } finally {
      setActiveAvailabilityProductId(null);
    }
  }

  async function saveOperatingHours() {
    if (!token) {
      return;
    }

    setSavingOperatingHours(true);
    setError('');

    try {
      const payload = await requestJson<SuccessResponse<OperatingHourItem[]>>({
        apiBase,
        path: '/restaurant-panel/horarios',
        token,
        options: {
          method: 'PUT',
          body: JSON.stringify(
            operatingHoursDraft.map((item) => ({
              dayOfWeek: item.dayOfWeek,
              openTime: item.openTime,
              closeTime: item.closeTime,
              isClosed: item.isClosed,
            }))
          ),
        },
        fallbackMessage: 'No se pudieron guardar los horarios.',
      });

      setOperatingHoursDraft(normalizeOperatingHours(payload.data));
      pushToast('success', 'Horarios actualizados', 'Tus horarios operativos ya quedaron guardados.');
      setShowSaveSuccessModal(true);
    } catch (requestError) {
      const message = getRequestErrorMessage(requestError, 'No se pudieron guardar los horarios.');
      setError(message);
      pushToast('error', 'Horarios no guardados', message);
    } finally {
      setSavingOperatingHours(false);
    }
  }

  async function savePasswordChange() {
    if (!token) {
      return;
    }

    if (!currentPasswordDraft.trim() || !newPasswordDraft.trim() || !confirmPasswordDraft.trim()) {
      pushToast('error', 'Campos incompletos', 'Completa los tres campos para actualizar tu contraseña.');
      return;
    }

    if (newPasswordDraft !== confirmPasswordDraft) {
      pushToast('error', 'Confirmacion invalida', 'La nueva contraseña y su confirmacion deben coincidir.');
      return;
    }

    setSavingPassword(true);
    setError('');

    try {
      await requestJson<SuccessResponse<{ updated: boolean }>>({
        apiBase,
        path: '/restaurant-panel/password',
        token,
        options: {
          method: 'PATCH',
          body: JSON.stringify({
            currentPassword: currentPasswordDraft,
            newPassword: newPasswordDraft,
          }),
        },
        fallbackMessage: 'No se pudo actualizar la contraseña.',
      });

      setCurrentPasswordDraft('');
      setNewPasswordDraft('');
      setConfirmPasswordDraft('');
      pushToast('success', 'Contraseña actualizada', 'Tu acceso ya usa la nueva contraseña.');
    } catch (requestError) {
      const message = getRequestErrorMessage(requestError, 'No se pudo actualizar la contraseña.');
      setError(message);
      pushToast('error', 'Contraseña no actualizada', message);
    } finally {
      setSavingPassword(false);
    }
  }

  async function togglePauseStatus() {
    if (!token || !profile) {
      return;
    }

    const nextIsPaused = !profile.isPaused;

    setUpdatingOperationalStatus(true);

    try {
      const payload = await requestJson<SuccessResponse<RestaurantProfile>>({
        apiBase,
        path: '/restaurant-panel/estado-operativo',
        token,
        options: {
          method: 'PATCH',
          body: JSON.stringify({
            isAcceptingOrders: profile.isAcceptingOrders,
            isPaused: nextIsPaused,
          }),
        },
      });

      if (payload.success) {
        setProfile(payload.data);
        setStatusToast(nextIsPaused
          ? { type: 'pause', title: '⏸ Negocio pausado', description: 'Tus clientes no podrán realizar pedidos por el momento.' }
          : { type: 'resume', title: '▶ Negocio reanudado', description: 'Ya puedes recibir pedidos nuevamente.' }
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido';
      pushToast('error', 'Error', message);
    } finally {
      setUpdatingOperationalStatus(false);
    }
  }

  async function performStatusUpdate(isAcceptingOrders: boolean) {
    if (!token || !profile) return;

    setUpdatingOperationalStatus(true);
    setError('');
    setAuthMessage('');

    try {
      const payload = await requestJson<SuccessResponse<RestaurantProfile>>({
        apiBase,
        path: '/restaurant-panel/estado-operativo',
        token,
        options: {
          method: 'PATCH',
          body: JSON.stringify({ isAcceptingOrders }),
        },
        fallbackMessage: 'No se pudo actualizar el estado operativo.',
        retry: { attempts: 1, backoffMs: 400 },
      });

      setProfile(payload.data);
      if (isAcceptingOrders) {
        setSessionOpenedAt(Date.now());
      }
      setStatusToast(isAcceptingOrders
        ? { type: 'open', title: '🚀 Negocio abierto', description: 'Los comensales pueden ver tu negocio y ya estás recibiendo pedidos.' }
        : { type: 'close', title: 'Negocio cerrado', description: 'Tu restaurante ya no recibe nuevos pedidos.' }
      );
    } catch (requestError) {
      const message = getRequestErrorMessage(requestError, 'No se pudo actualizar el estado operativo.');
      setError(message);
      pushToast('error', 'No se pudo actualizar', message);
    } finally {
      setUpdatingOperationalStatus(false);
    }
  }

  async function toggleOperationalStatus() {
    if (!token || !profile) {
      return;
    }

    if (profile.status !== 'ACTIVE') {
      setIsStatusBlockedModalOpen(true);
      return;
    }

    const nextIsAcceptingOrders = !profile.isAcceptingOrders;

    if (nextIsAcceptingOrders) {
      await performStatusUpdate(true);
    } else {
      setShowCloseConfirmModal(true);
    }
  }

  async function handleExtendHours() {
    if (!token || !apiBase) return;
    setExtendingHours(true);
    try {
      const response = await fetch(`${apiBase}/restaurant-panel/extender-cierre`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      if (data.success) {
        pushToast('success', 'Horario extendido', 'Tu restaurante permanecerá abierto 1 hora extra y luego se cerrará automáticamente.');
        setShowClosePromptModal(false);
      } else {
        pushToast('error', 'Error', 'No se pudo extender el horario. Intenta de nuevo.');
      }
    } catch (err) {
      pushToast('error', 'Error de red', 'No se pudo contactar al servidor.');
    } finally {
      setExtendingHours(false);
    }
  }

  const visibleOrders =
    selectedStatus === 'ACTIVE'
      ? orders.filter(
          (order) =>
            !['CANCELLED', 'REJECTED', 'DELIVERED', 'COMPLETED'].includes(order.status)
        )
      : selectedStatus === 'DELIVERED'
        ? orders.filter((order) => !order.id.startsWith('mock-order-') && ['DELIVERED', 'COMPLETED'].includes(order.status))
        : orders.filter((order) => !order.id.startsWith('mock-order-') && order.status === selectedStatus);
  const socketStatusLabel = socketStatusCopy[socketStatus];
  const orderAlertSoundDescription =
    orderAlertAudioState === 'unsupported'
      ? 'Este navegador no permite reproducir alertas de audio en este panel.'
      : orderAlertAudioState === 'ready'
        ? 'Sonará una alerta corta cuando entre un pedido nuevo.'
        : 'Se activará después de la primera interacción con el panel.';
  const isRestaurantSession = Boolean(sessionUser && sessionUser.role === 'RESTAURANT');
  const restaurantName = profile?.name || sessionUser?.name || 'Panel del restaurante';
  const activeOrders = useMemo(() => {
    return orders.filter((order) =>
      ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'PICKED_UP', 'IN_TRANSIT'].includes(order.status)
    );
  }, [orders]);

  const handlePrintTicket = useCallback(async (order: any) => {
    if (!order) return;
    setIsPrintingTicket(true);
    try {
      const html = generateTicketHtml(order, restaurantName, order.dailyCounter);
      await printHtmlString(html, `Comanda_${order.orderReference || 'Pedido'}`);
    } catch (error) {
      console.error('Error al imprimir ticket:', error);
      alert('Hubo un problema al intentar imprimir la comanda. Verifica que la impresora esté conectada o que el navegador tenga permisos para imprimir.');
    } finally {
      setIsPrintingTicket(false);
    }
  }, [restaurantName]);

  const storeCategories = useMemo(() => {
    return categories.map((category) => ({
      ...category,
      products: products.filter((product) => product.categoryId === category.id),
    }));
  }, [categories, products]);
  const isBusinessOpen = profile?.isAcceptingOrders ?? false;
  const isBusinessPaused = profile?.isPaused ?? false;
  const isWithinHours = isCurrentlyWithinOperatingHours(profile?.operatingHours);
  const operationalStatusLabel = getRestaurantOperationalStatusLabel(profile?.status, profile?.isAcceptingOrders, profile?.isPaused, isWithinHours);
  const operationalStatusTone = getRestaurantOperationalStatusTone(profile?.status, profile?.isAcceptingOrders, profile?.isPaused, isWithinHours);
  const navigationItems: Array<{ key: RestaurantPortalSection; label: string }> = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'orders', label: 'Ordenes' },
    { key: 'store', label: 'Mi Tienda' },
    { key: 'billing', label: 'Balance' },
    { key: 'featured', label: 'Destacados' },
    { key: 'settings', label: 'Configuracion' },
  ];

  if (checkingAuth) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-white dark:bg-neutral-900">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-sky-600 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">Cargando...</p>
        </div>
      </div>
    );
  }



  const getSecondsUntilNextCutoff = () => {
    const now = currentTime;
    const result = new Date(now);
    const day = result.getDay();
    const daysToAdd = day === 0 ? 0 : 7 - day;
    result.setDate(result.getDate() + daysToAdd);
    result.setHours(23, 59, 59, 999);
    const diff = result.getTime() - now.getTime();
    return Math.max(0, diff);
  };

  const getSecondsUntilNextSuspension = () => {
    const now = currentTime;
    const result = new Date(now);
    const day = result.getDay();
    let daysToAdd = 3 - day;
    if (daysToAdd < 0) {
      daysToAdd += 7;
    } else if (daysToAdd === 0) {
      if (now.getHours() > 23 || (now.getHours() === 23 && now.getMinutes() > 59)) {
        daysToAdd = 7;
      }
    }
    result.setDate(result.getDate() + daysToAdd);
    result.setHours(23, 59, 59, 999);
    const diff = result.getTime() - now.getTime();
    return Math.max(0, diff);
  };

  const formatTimeLeft = (diffMs: number) => {
    const totalSeconds = Math.floor(diffMs / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m`;
    }
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  const getDaysOverdue = (dueDateStr?: string | Date) => {
    if (!dueDateStr) return 0;
    const due = new Date(dueDateStr);
    const now = new Date(currentTime);
    due.setHours(0, 0, 0, 0);
    now.setHours(0, 0, 0, 0);
    const diffTime = now.getTime() - due.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : 0;
  };

  const getCycleProgress = () => {
    if (!billingSummary?.periodStart || !billingSummary?.nextChargeDate) return 0;
    const start = new Date(billingSummary.periodStart).getTime();
    const end = new Date(billingSummary.nextChargeDate).getTime();
    const now = currentTime.getTime();
    
    if (now >= end) return 100;
    if (now <= start) return 0;
    
    const total = end - start;
    const current = now - start;
    return Math.min(100, Math.max(0, Math.round((current / total) * 100)));
  };

  const currentSettingsTab = settingsTabs.find(t => t.key === activeSettingsTab) ?? settingsTabs[0];

  return (
    <main
      className={`min-h-[100dvh] text-neutral-900 ${isRestaurantSession ? 'py-0' : 'px-4 py-5 md:px-6 lg:px-8'
        }`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Toast notifications */}
      {toasts.length > 0 && (
        <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2 max-w-sm">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              onClick={() => dismissToast(toast.id)}
              className={`relative rounded-2xl border px-4 py-3 pr-10 text-sm shadow-lg backdrop-blur-md cursor-pointer transition hover:scale-[1.02] active:scale-[0.98] ${
                toast.tone === 'error'
                  ? 'border-red-200 bg-red-50/95 text-red-800'
                  : toast.tone === 'success'
                    ? 'border-emerald-200 bg-emerald-50/95 text-emerald-800'
                    : 'border-sky-200 bg-sky-50/95 text-sky-800'
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

      {/* Pull to refresh indicator */}
      <div
        className={`fixed top-0 left-0 right-0 z-50 flex justify-center pt-2 pointer-events-none transition-opacity ${pullDistance > 0 || isRefreshing ? 'opacity-100' : 'opacity-0'}`}
        style={{ transform: `translateY(${Math.max(0, pullDistance - 40)}px)` }}
      >
        <div className="rounded-full bg-white p-2 shadow-lg border border-black/5 flex items-center justify-center">
          <svg
            className={`h-5 w-5 text-neutral-600 ${isRefreshing ? 'animate-spin' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            style={{ transform: isRefreshing ? 'none' : `rotate(${pullDistance * 4}deg)` }}
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </div>
      </div>


      {activeIncomingOrder ? (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 px-3 py-3 sm:items-center sm:px-4 sm:py-5"
          role="dialog"
          aria-modal="true"
          aria-labelledby="incoming-order-title"
        >
          <div className="flex max-h-[min(92vh,960px)] w-full max-w-4xl flex-col overflow-hidden rounded-[30px] bg-white shadow-[0_32px_110px_rgba(15,15,15,0.35)] sm:rounded-[24px]">
            {/* HEADER */}
            <div className="border-b border-black/5 bg-neutral-50/50 px-5 py-5 sm:px-8">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75"></span>
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-sky-600"></span>
                    </span>
                    <p className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-600">
                      Nuevo pedido entrante
                    </p>
                  </div>
                  <h2
                    id="incoming-order-title"
                    className="mt-2 text-2xl font-bold tracking-[-0.04em] text-neutral-950 sm:text-3xl"
                  >
                    {(activeIncomingOrder as any).dailyCounter ? `#${String((activeIncomingOrder as any).dailyCounter).padStart(2, '0')}` : (
                      activeIncomingOrder.orderReference.slice(-6)
                    )}
                  </h2>
                  {waitingIncomingOrders.length > 0 && (
                    <p className="mt-1 text-sm font-medium text-amber-600">
                      +{waitingIncomingOrders.length} pedido{waitingIncomingOrders.length > 1 ? 's' : ''} en cola
                    </p>
                  )}
                </div>

                {/* TIMER PILL */}
                <div className="flex items-center gap-3 self-start rounded-full border border-rose-100 bg-rose-50 px-4 py-2.5 sm:self-center">
                  <svg className="h-5 w-5 text-rose-600" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <circle cx="12" cy="12" r="8" strokeWidth={1.7} />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 7v5l3 2" />
                  </svg>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.1em] text-rose-600">Expira en</p>
                    <p className="font-bold text-rose-700">
                      {formatCountdown(incomingOrderCountdownMs)}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* CONTENT */}
            {isSelectingPrepTime ? (
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-8 sm:px-10 flex flex-col items-center justify-center text-center">
                <div className="max-w-sm w-full space-y-6">
                  <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-sky-100 ring-8 ring-sky-50">
                    <svg className="h-10 w-10 text-sky-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-2xl font-black tracking-tight text-neutral-900">{profile?.businessType === 'RESTAURANT' ? 'Tiempo de preparación' : (isScheduledMode ? 'Programar entrega' : 'Tiempo estimado')}</h3>
                    <p className="mt-2 text-sm text-neutral-500 leading-relaxed">
                      {profile?.businessType === 'RESTAURANT'
                        ? 'Selecciona cuánto tiempo tomará preparar este pedido. El cliente y el repartidor recibirán esta estimación.'
                        : isScheduledMode
                          ? 'Elige la fecha y hora en que el pedido estará listo para entrega.'
                          : 'Selecciona cuánto tiempo tomará alistar este pedido. El cliente recibirá esta estimación.'}
                    </p>
                  </div>

                  {profile?.businessType !== 'RESTAURANT' && (
                    <div className="flex rounded-2xl border border-sky-200/50 bg-sky-50/50 p-1">
                      <button
                        type="button"
                        onClick={() => setIsScheduledMode(false)}
                        className={`flex-1 rounded-xl py-2.5 text-xs font-bold transition ${!isScheduledMode ? 'bg-white text-sky-700 shadow-sm' : 'text-sky-600 hover:text-sky-800'}`}
                      >
                        ⏱ Ahora
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsScheduledMode(true)}
                        className={`flex-1 rounded-xl py-2.5 text-xs font-bold transition ${isScheduledMode ? 'bg-white text-sky-700 shadow-sm' : 'text-sky-600 hover:text-sky-800'}`}
                      >
                        📅 Programar entrega
                      </button>
                    </div>
                  )}

                  {isScheduledMode ? (
                    <div className="space-y-4 pt-2">
                      <label className="grid gap-2 text-left text-sm">
                        <span className="text-xs font-bold uppercase tracking-wider text-neutral-600">Fecha de entrega</span>
                        <input
                          type="date"
                          value={scheduledDeliveryDate}
                          min={new Date().toISOString().split('T')[0]}
                          onChange={(e) => setScheduledDeliveryDate(e.target.value)}
                          className="w-full rounded-2xl border border-sky-200/60 bg-white px-5 py-3.5 text-sm font-medium text-neutral-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-500/20"
                        />
                      </label>
                      <label className="grid gap-2 text-left text-sm">
                        <span className="text-xs font-bold uppercase tracking-wider text-neutral-600">Hora de entrega</span>
                        <input
                          type="time"
                          value={scheduledDeliveryTime}
                          onChange={(e) => setScheduledDeliveryTime(e.target.value)}
                          className="w-full rounded-2xl border border-sky-200/60 bg-white px-5 py-3.5 text-sm font-medium text-neutral-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-500/20"
                        />
                      </label>
                      {scheduledDeliveryDate && scheduledDeliveryTime && (() => {
                        const scheduled = new Date(`${scheduledDeliveryDate}T${scheduledDeliveryTime}`);
                        if (scheduled <= new Date()) {
                          return (
                            <p className="text-xs font-bold text-rose-600 bg-rose-50 rounded-xl px-4 py-2">
                              La fecha y hora deben ser posteriores al momento actual.
                            </p>
                          );
                        }
                        return (
                          <p className="text-xs font-bold text-emerald-600 bg-emerald-50 rounded-xl px-4 py-2">
                            El cliente verá: <span className="font-black">{scheduled.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })} a las {scheduled.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</span>
                          </p>
                        );
                      })()}
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-3 pt-2">
                      {preparationTimePresets.map((preset) => (
                        <button
                          key={preset.value}
                          type="button"
                          onClick={() => setSelectedPreparationTime(preset.value)}
                          className={`flex flex-col items-center justify-center rounded-2xl border-2 p-4 text-center transition ${selectedPreparationTime === preset.value
                            ? 'border-sky-600 bg-sky-50 text-sky-700 shadow-sm'
                            : 'border-neutral-100 bg-white text-neutral-700 hover:border-sky-300 hover:bg-sky-50/50'
                            }`}
                        >
                          <span className="text-2xl font-black">{preset.value}</span>
                          <span className="text-[10px] font-bold uppercase tracking-widest opacity-70 mt-0.5">Minutos</span>
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-col gap-3 pt-6">
                    <button
                      type="button"
                      onClick={() => {
                        const isScheduled = isScheduledMode && scheduledDeliveryDate && scheduledDeliveryTime;
                        if (isScheduled) {
                          const scheduledAt = new Date(`${scheduledDeliveryDate}T${scheduledDeliveryTime}`).toISOString();
                          const onAccept = () => void runOrderAction(activeIncomingOrder.id, 'accept', { scheduledDeliveryAt: scheduledAt });
                          if (activeIncomingOrder.paymentMethod === 'TRANSFER') {
                            setTransferConfirmationOrder({
                              id: activeIncomingOrder.id,
                              preparationTimeMinutes: 10,
                              paymentProofUrl: activeIncomingOrder.paymentProofUrl,
                              orderReference: activeIncomingOrder.orderReference,
                              collectionAmount: getRestaurantCollectionAmount(activeIncomingOrder, profile?.hasOwnDelivery),
                              onConfirm: () => {
                                onAccept();
                                setIsSelectingPrepTime(false);
                                setIsScheduledMode(false);
                                setScheduledDeliveryDate('');
                                setScheduledDeliveryTime('');
                              },
                            });
                          } else {
                            onAccept();
                            setIsSelectingPrepTime(false);
                            setIsScheduledMode(false);
                            setScheduledDeliveryDate('');
                            setScheduledDeliveryTime('');
                          }
                        } else {
                          const onAccept = () => void runOrderAction(activeIncomingOrder.id, 'accept', { preparationTimeMinutes: selectedPreparationTime });
                          if (activeIncomingOrder.paymentMethod === 'TRANSFER') {
                            setTransferConfirmationOrder({
                              id: activeIncomingOrder.id,
                              preparationTimeMinutes: selectedPreparationTime,
                              paymentProofUrl: activeIncomingOrder.paymentProofUrl,
                              orderReference: activeIncomingOrder.orderReference,
                              collectionAmount: getRestaurantCollectionAmount(activeIncomingOrder, profile?.hasOwnDelivery),
                              onConfirm: () => {
                                onAccept();
                                setIsSelectingPrepTime(false);
                              },
                            });
                          } else {
                            onAccept();
                            setIsSelectingPrepTime(false);
                          }
                        }
                      }}
                      disabled={
                        Boolean(activeActionKey) ||
                        (isScheduledMode && (!scheduledDeliveryDate || !scheduledDeliveryTime))
                      }
                      className="w-full rounded-full bg-sky-600 px-5 py-4 text-sm font-bold text-white shadow-[0_4px_12px_rgba(2,132,199,0.3)] transition hover:bg-sky-700 hover:shadow-[0_8px_20px_rgba(2,132,199,0.4)] disabled:opacity-70 disabled:cursor-not-allowed"
                    >
                      {activeActionKey === `${activeIncomingOrder.id}:accept`
                        ? 'Aceptando...'
                        : isScheduledMode
                          ? 'Confirmar y Programar Entrega'
                          : 'Confirmar y Aceptar Pedido'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsSelectingPrepTime(false);
                        setIsScheduledMode(false);
                        setScheduledDeliveryDate('');
                        setScheduledDeliveryTime('');
                      }}
                      disabled={Boolean(activeActionKey)}
                      className="w-full rounded-full border border-neutral-200 bg-white px-5 py-3.5 text-sm font-bold text-neutral-600 transition hover:bg-neutral-50"
                    >
                      {profile?.businessType === 'RESTAURANT' ? 'Volver a la comanda' : 'Volver al pedido'}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8">
              <div className="grid gap-8 lg:grid-cols-[minmax(0,1.5fr)_320px]">

                {/* LEFT COLUMN: CHEF FOCUS (Items First!) */}
                <div className="space-y-6">
                  {/* COMANDA */}
                  <div className="rounded-3xl border border-sky-100 bg-white p-6 shadow-[0_8px_30px_rgba(2,132,199,0.06)] relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1.5 h-full bg-sky-600"></div>
                    <div className="flex items-center justify-between border-b border-black/5 pb-4">
                      <p className="text-sm font-bold uppercase tracking-[0.2em] text-neutral-800">{profile?.businessType === 'RESTAURANT' ? 'Comanda para Cocina' : 'Detalle del Pedido'}</p>
                      <span className="rounded-full bg-sky-100 px-4 py-1.5 text-xs font-bold text-sky-700">
                        {countOrderProducts(activeIncomingOrder)} {countOrderProducts(activeIncomingOrder) === 1 ? 'Producto' : 'Productos'}
                      </span>
                    </div>

                    <div className="divide-y divide-black/5 mt-2">
                      {activeIncomingOrder.items && activeIncomingOrder.items.length > 0 ? (
                        activeIncomingOrder.items.map((item) => (
                          <div key={item.id} className="grid grid-cols-[40px_40px_minmax(0,1fr)] gap-3.5 py-4 items-start">
                            <div className={`flex h-10 w-10 items-center justify-center rounded-xl text-base font-extrabold shrink-0 select-none ${
                              item.quantity > 1
                                ? 'bg-amber-500 text-white shadow-sm shadow-amber-500/20'
                                : 'bg-sky-50 text-sky-700'
                            }`}>
                              {item.quantity > 1 ? `x${item.quantity}` : '1'}
                            </div>

                            {item.product?.image ? (
                              <img
                                src={item.product.image}
                                alt={item.product.name}
                                className="h-10 w-10 rounded-xl object-cover border border-black/5 shrink-0 shadow-sm"
                                loading="lazy"
                                decoding="async"
                              />
                            ) : (
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neutral-50 border border-black/5 text-base shadow-sm">
                                {profile?.businessType === 'RESTAURANT' ? '🍽️' : '📦'}
                              </div>
                            )}

                            <div className="min-w-0">
                              <p className="text-[17px] font-black leading-snug text-neutral-950">
                                {item.product?.name || 'Producto'}
                              </p>
                              {item.sellBy === 'WEIGHT' && item.weightG ? (
                                <p className="mt-1 text-[13px] font-semibold text-amber-600">
                                  {item.weightG >= 1000 ? `${item.weightG / 1000}kg` : `${item.weightG}g`}
                                </p>
                              ) : null}
                              {item.options && item.options.length > 0 && (
                                <div className="mt-2 flex flex-col gap-1.5">
                                  {item.options.map((opt: any) => (
                                    <div
                                      key={opt.id}
                                      className="inline-flex w-fit items-center rounded-lg bg-sky-50 px-2.5 py-1 text-[13px] font-bold text-sky-800 border border-sky-100/60 shadow-sm"
                                    >
                                      <span className="mr-1.5 text-sky-500">➕</span> {opt.name}
                                    </div>
                                  ))}
                                </div>
                              )}
                              {item.specialInstructions && (
                                <div className="mt-2.5 flex gap-2 rounded-xl bg-amber-50 border-l-4 border-amber-500 p-3 shadow-sm">
                                  <span className="text-amber-500">⚠</span>
                                  <p className="text-[14px] font-bold text-amber-900 leading-tight">
                                    {item.specialInstructions}
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="py-6 text-sm text-neutral-500">
                          Este pedido no incluye productos detallados.
                        </div>
                      )}
                    </div>
                    {/* NEW: Global order notes right below the items! */}
                    {/* NEW: Global order notes right below the items! */}
                    {parseStoreNotes(activeIncomingOrder.notes) && (
                      <div className="mt-6 rounded-2xl bg-rose-50 border-2 border-rose-200 p-5 shadow-sm">
                        <p className="text-xs font-black uppercase tracking-[0.2em] text-rose-600 mb-2 flex items-center gap-2">
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                          Notas generales del pedido
                        </p>
                        <p className="text-base font-bold leading-relaxed text-rose-950 whitespace-pre-wrap">
                          {parseStoreNotes(activeIncomingOrder.notes)}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
                {/* RIGHT COLUMN: ACTIONS & BILLING */}
                <div className="space-y-5 lg:border-l lg:border-black/5 lg:pl-6">
                  
                  {/* COMPACT DELIVERY DATA FOR CASHIER */}
                  <div className="rounded-2xl border border-neutral-100 bg-neutral-50/50 p-4">
                    <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-neutral-400 mb-3">Resumen de Entrega</p>
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center gap-3">
                        {activeIncomingOrder.customer?.user?.profilePhoto ? (
                          <img
                            src={activeIncomingOrder.customer.user.profilePhoto}
                            alt={activeIncomingOrder.customer?.user?.name || 'Cliente'}
                            className="h-10 w-10 rounded-full object-cover border border-neutral-200"
                          />
                        ) : (
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-200 font-bold text-neutral-500 text-sm">
                            {activeIncomingOrder.customer?.user?.name?.substring(0, 2).toUpperCase() || 'CL'}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-neutral-900 truncate">
                            {activeIncomingOrder.customer?.user?.name || 'Cliente SaDeL'}
                          </p>
                          <p className="text-[11px] font-medium text-neutral-500">
                            {activeIncomingOrder.customer?.user?.phone || 'Sin teléfono'}
                          </p>
                        </div>
                      </div>
                      {(activeIncomingOrder as any).fulfillmentType === 'PICKUP' ? (
                        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 shadow-sm">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 mb-1">Recoger en sucursal</p>
                          <div className="flex items-center gap-2">
                            <svg className="w-5 h-5 text-emerald-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                            </svg>
                            <span className="text-sm font-bold text-emerald-800">
                              El cliente pasará por su pedido
                            </span>
                          </div>

                        </div>
                      ) : (
                      <div className="rounded-xl bg-white p-3 shadow-sm border border-black/5">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-0.5">Dirección</p>
                        <p className="text-[13px] font-bold text-neutral-800 leading-snug">
                          {formatIncomingOrderAddress(activeIncomingOrder.address)}
                        </p>
                        {activeIncomingOrder.address?.reference && (
                          <div className="mt-2 text-[12px] text-amber-800 bg-amber-50 rounded-lg p-1.5 font-medium border border-amber-100/50">
                            <span className="font-bold">Ref:</span> {activeIncomingOrder.address.reference}
                          </div>
                        )}
                        {activeIncomingOrder.deliveryPreference && (
                          <div className={`mt-2 rounded-lg p-2 text-[12px] font-bold border flex items-center gap-2 shadow-sm ${
                            activeIncomingOrder.deliveryPreference === 'NO_DOORBELL' ? 'border-orange-200 bg-orange-50 text-orange-700' :
                            activeIncomingOrder.deliveryPreference === 'CALL_ON_ARRIVAL' ? 'border-blue-200 bg-blue-50 text-blue-700' :
                            activeIncomingOrder.deliveryPreference === 'PREFER_WHATSAPP' ? 'border-green-200 bg-green-50 text-green-700' :
                            activeIncomingOrder.deliveryPreference === 'HONK_ON_ARRIVAL' ? 'border-indigo-200 bg-indigo-50 text-indigo-700' :
                            activeIncomingOrder.deliveryPreference === 'BEWARE_OF_DOG' ? 'border-rose-200 bg-rose-50 text-rose-700' : ''
                          }`}>
                            <span className="text-sm">
                              {activeIncomingOrder.deliveryPreference === 'NO_DOORBELL' && '🤫'}
                              {activeIncomingOrder.deliveryPreference === 'CALL_ON_ARRIVAL' && '📞'}
                              {activeIncomingOrder.deliveryPreference === 'PREFER_WHATSAPP' && '💬'}
                              {activeIncomingOrder.deliveryPreference === 'HONK_ON_ARRIVAL' && '🚗'}
                              {activeIncomingOrder.deliveryPreference === 'BEWARE_OF_DOG' && '🐕'}
                            </span>
                            <span>
                              {activeIncomingOrder.deliveryPreference === 'NO_DOORBELL' && 'No tocar el timbre'}
                              {activeIncomingOrder.deliveryPreference === 'CALL_ON_ARRIVAL' && 'Llamar al llegar'}
                              {activeIncomingOrder.deliveryPreference === 'PREFER_WHATSAPP' && 'Contactar por WhatsApp'}
                              {activeIncomingOrder.deliveryPreference === 'HONK_ON_ARRIVAL' && 'Tocar claxon'}
                              {activeIncomingOrder.deliveryPreference === 'BEWARE_OF_DOG' && 'Cuidado con el perro'}
                            </span>
                          </div>
                        )}
                      </div>
                      )}
                    </div>
                  </div>

                  {/* TOTAL */}
                  <div className="rounded-2xl bg-neutral-950 p-5 text-white shadow-lg">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">Total del pedido</p>
                    <p className="mt-1 text-3xl font-bold tracking-[-0.04em]">
                      {formatCurrency(getRestaurantCollectionAmount(activeIncomingOrder, profile?.hasOwnDelivery))}
                    </p>
                  </div>

                  {activeIncomingOrder.paymentMethod === 'TRANSFER' && (
                    <div className="rounded-2xl border border-sky-100 bg-gradient-to-br from-sky-50 to-blue-50 p-4 animate-float-gentle">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="flex h-2 w-2 rounded-full bg-sky-600 animate-pulse" />
                        <span className="text-xs font-bold uppercase tracking-wider text-sky-700 bg-sky-100/50 px-2 py-0.5 rounded-md border border-sky-200/30">
                          Pago por Transferencia
                        </span>
                      </div>
                      <p className="text-xs text-neutral-500 mb-3 leading-relaxed">
                        Verifica en tu banca móvil que el importe de <strong>{formatCurrency(getRestaurantCollectionAmount(activeIncomingOrder, profile?.hasOwnDelivery))}</strong> haya ingresado.
                      </p>
                      {activeIncomingOrder.paymentProofUrl ? (
                        <button
                          type="button"
                          onClick={() => setZoomedImageUrl(activeIncomingOrder.paymentProofUrl || null)}
                          className="w-full flex items-center justify-center gap-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white py-3 text-xs font-bold shadow-md shadow-sky-600/10 hover:shadow-sky-600/20 transition active:scale-95"
                        >
                          <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                          Ver comprobante
                        </button>
                      ) : (
                        <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-100/50 p-3 text-center text-xs font-semibold text-neutral-500">
                          Sin comprobante cargado
                        </div>
                      )}
                    </div>
                  )}

                  {['CREDIT_CARD', 'DEBIT_CARD', 'DIGITAL_WALLET'].includes(activeIncomingOrder.paymentMethod || '') && (
                    <div className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-teal-50 p-4 shadow-[0_4px_20px_rgba(16,185,129,0.06)]">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="flex h-2 w-2 rounded-full bg-emerald-500" />
                        <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 bg-emerald-100/50 px-2 py-0.5 rounded-md border border-emerald-200/30">
                          Pago en Línea Autorizado
                        </span>
                      </div>
                      <p className="text-xs text-emerald-600 font-medium">
                        ✓ Transacción validada por pasarela de pago.
                      </p>
                    </div>
                  )}

                  {/* PREPARATION TIME REMOVED FROM INCOMING MODAL AS REQUESTED */}

                  {/* OLD NOTES SECTION REMOVED - MOVED TO LEFT COLUMN FOR KITCHEN */}

                  {/* QUEUE INFO */}
                  {waitingIncomingOrders.length > 0 && (
                    <div className="rounded-xl border border-black/5 p-4 bg-neutral-50/50">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500 mb-2">
                        Siguientes en cola ({waitingIncomingOrders.length})
                      </p>
                      <div className="space-y-2">
                        {waitingIncomingOrders.slice(0, 2).map((order) => (
                          <div key={order.id} className="text-sm text-neutral-700 flex justify-between">
                            <span className="font-medium text-neutral-950">{order.orderReference}</span>
                            <span className="text-neutral-500">{order.customer?.user?.name?.split(' ')[0] || 'Cliente'}</span>
                          </div>
                        ))}
                        {waitingIncomingOrders.length > 2 && (
                          <p className="text-xs text-neutral-500 text-center mt-1">
                            +{waitingIncomingOrders.length - 2} más esperando...
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ACTIONS */}
                  <div className="space-y-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setIsSelectingPrepTime(true)}
                      disabled={Boolean(activeActionKey)}
                      className="w-full rounded-full bg-sky-600 px-5 py-4 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(2,132,199,0.3)] transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-sky-300"
                    >
                      Aceptar Pedido
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (activeIncomingOrder.paymentMethod === 'TRANSFER') {
                          setTransferRefundOrder(activeIncomingOrder);
                        } else {
                          void runOrderAction(activeIncomingOrder.id, 'reject');
                        }
                      }}
                      disabled={Boolean(activeActionKey)}
                      className="w-full rounded-full border border-rose-200 bg-white px-5 py-4 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {activeActionKey === `${activeIncomingOrder.id}:reject` ? 'Rechazando...' : 'Rechazar Pedido'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
            )}
          </div>
        </div>
      ) : null}

      {/* MODAL DE SOLICITUD DE APOYO */}
      {supportRequestsQueue.length > 0 ? (
        <div
          className="fixed inset-0 z-[75] flex items-end justify-center bg-black/60 px-3 py-3 sm:items-center sm:px-4 sm:py-5"
          role="dialog"
          aria-modal="true"
          aria-labelledby="support-request-title"
        >
          <div className="flex max-h-[min(92vh,960px)] w-full max-w-lg flex-col overflow-hidden rounded-[24px] bg-white shadow-[0_28px_90px_rgba(15,15,15,0.34)] sm:rounded-[20px]">
            <div className="border-b border-black/10 px-4 py-4 sm:px-7">
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-sky-600">
                Solicitud de entrega
              </p>
              <h2
                id="support-request-title"
                className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-neutral-950 sm:text-3xl"
              >
                Apoyo a {businessTypeLabel(profile?.businessType)}
              </h2>
              <p className="mt-2 text-sm text-neutral-600">
                {businessTypeLabel(profile?.businessType)} <strong>{supportRequestsQueue[0].restaurantName}</strong> solicita tu apoyo para entregar un pedido.
              </p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-7 sm:py-5">
              <div className="grid gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">Dirección de entrega</p>
                  <p className="mt-1 text-sm font-medium text-neutral-900">{supportRequestsQueue[0].address}</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">Tarifa de envío</p>
                    <p className="mt-1 text-lg font-bold text-emerald-600">${supportRequestsQueue[0].deliveryFee} MXN</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">Distancia</p>
                    <p className="mt-1 text-sm font-medium text-neutral-900">{supportRequestsQueue[0].distanceToRestaurant.toFixed(2)} km (aprox)</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-black/10 px-4 py-4 sm:px-7 sm:py-5">
              <div className="flex flex-col gap-3 sm:flex-row-reverse">
                <button
                  type="button"
                  onClick={async () => {
                    const res = await fetch(`${apiBase}/restaurant-panel/pedidos/${supportRequestsQueue[0].orderId}/aceptar-apoyo`, {
                      method: 'POST',
                      headers: { Authorization: `Bearer ${token}` },
                    });
                    const data = await res.json();
                    if (data.success) {
                      pushToast('success', 'Éxito', 'Has aceptado la solicitud de apoyo.');
                      setSupportRequestsQueue((current) => current.slice(1));
                      void loadOrdersOnly();
                    } else {
                      pushToast('error', 'Error', data.error?.message || 'No se pudo aceptar la solicitud.');
                    }
                  }}
                  className="w-full rounded-full bg-sky-600 px-5 py-4 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(2,132,199,0.3)] transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 sm:w-auto"
                >
                  Aceptar entrega
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const res = await fetch(`${apiBase}/restaurant-panel/pedidos/${supportRequestsQueue[0].orderId}/rechazar-apoyo`, {
                      method: 'POST',
                      headers: { Authorization: `Bearer ${token}` },
                    });
                    pushToast('info', 'Rechazado', 'Has rechazado la solicitud de apoyo.');
                    setSupportRequestsQueue((current) => current.slice(1));
                  }}
                  className="w-full rounded-full border border-black/10 bg-white px-5 py-4 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-50 sm:w-auto"
                >
                  Rechazar
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* MODAL DE ADVERTENCIA AL CERRAR SESIÓN */}
      {showLogoutWarningModal ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 px-4 py-5"
          role="dialog"
          aria-modal="true"
          aria-labelledby="logout-warning-title"
        >
          <div className="flex max-h-[min(92vh,960px)] w-full max-w-lg flex-col overflow-hidden rounded-[24px] bg-white shadow-[0_28px_90px_rgba(15,15,15,0.34)] sm:rounded-[20px]">
            <div className="border-b border-black/10 px-4 py-4 sm:px-7">
              <h2 id="logout-warning-title" className="text-2xl font-bold text-neutral-900">
                ¡Atención! Negocio Abierto
              </h2>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-7">
              <p className="text-sm text-neutral-600">
                Tu negocio sigue <strong>Abierto</strong> y los clientes pueden seguir haciendo pedidos. ¿Qué deseas hacer?
              </p>
            </div>

            <div className="border-t border-black/10 px-4 py-4 sm:px-7">
              <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setShowLogoutWarningModal(false)}
                  className="w-full rounded-full border border-black/10 bg-white px-5 py-4 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-50 sm:w-auto"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowLogoutWarningModal(false);
                    clearSession('Sesion cerrada. Regresaste al login.');
                  }}
                  className="w-full rounded-full bg-red-600 px-5 py-4 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(220,38,38,0.3)] transition hover:bg-red-700 sm:w-auto"
                >
                  Cerrar sesión de todos modos
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await toggleOperationalStatus();
                    setShowLogoutWarningModal(false);
                    clearSession('Negocio cerrado y sesion terminada.');
                  }}
                  className="w-full rounded-full bg-sky-600 px-5 py-4 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(2,132,199,0.3)] transition hover:bg-sky-700 sm:w-auto"
                >
                  Cerrar negocio y salir
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* MODAL DE DESTACADOS (PIZZAS POWER) */}
      {showFeaturedModal ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 px-4 py-5"
          role="dialog" aria-modal="true">
          <div className="flex max-h-[min(92vh,960px)] w-full max-w-lg flex-col overflow-hidden rounded-[24px] bg-white shadow-[0_28px_90px_rgba(15,15,15,0.34)]">
            <div className="border-b border-black/10 px-4 py-4 sm:px-7">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-neutral-900">Aparecer en destacados</h2>
                <button onClick={() => setShowFeaturedModal(false)} className="w-8 h-8 rounded-full bg-neutral-100 hover:bg-neutral-200 flex items-center justify-center text-neutral-500 transition-colors">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-7 space-y-5">
              <div className="rounded-2xl bg-gradient-to-br from-sky-50 to-blue-50 border border-sky-200 p-4">
                <p className="text-sm text-sky-900 leading-relaxed">
                  Al comprar días destacado, tu restaurante aparecerá en la sección de <strong>Restaurantes Destacados</strong>,
                  un carrusel horizontal que los clientes ven <strong>apenas abren la aplicación</strong>, antes que cualquier otro restaurante.
                </p>
              </div>

              <div>
                <label className="text-sm font-semibold text-neutral-700 block mb-2">Elige un paquete</label>
                {featuredPackages.length === 0 ? (
                  <p className="text-sm text-neutral-400">No hay paquetes disponibles por el momento.</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {featuredPackages.map(pkg => (
                      <button key={pkg.days} onClick={() => setFeaturedDays(pkg.days)}
                        className={`rounded-xl border-2 p-3 text-center transition-all duration-200 ${
                          featuredDays === pkg.days
                            ? 'border-sky-500 bg-sky-50 shadow-lg shadow-sky-300/20 scale-105'
                            : 'border-black/5 bg-white hover:border-sky-200 hover:bg-sky-50/50'
                        }`}>
                        <span className="block text-lg font-black text-neutral-900">{pkg.days}</span>
                        <span className="block text-[11px] text-neutral-400 font-medium">día{pkg.days > 1 ? 's' : ''}</span>
                        <span className="block mt-1 text-sm font-bold text-sky-600">${pkg.price.toFixed(2)}</span>
                        <span className="block text-[10px] text-neutral-400">MXN</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {featuredPackages.length > 0 && (() => {
                const selectedPkg = featuredPackages.find(p => p.days === featuredDays);
                return (
                  <div className="rounded-2xl bg-neutral-50 border border-black/5 p-4">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-neutral-600">Paquete seleccionado</span>
                      <span className="font-semibold text-neutral-900">{selectedPkg?.days ?? 0} día{(selectedPkg?.days ?? 0) > 1 ? 's' : ''}</span>
                    </div>
                    <div className="flex justify-between items-center mt-2 pt-2 border-t border-black/5">
                      <span className="text-sm font-semibold text-neutral-800">Total a pagar</span>
                      <span className="text-lg font-black text-sky-600">${(selectedPkg?.price ?? 0).toFixed(2)} MXN</span>
                    </div>
                  </div>
                );
              })()}

              <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-sky-100 flex items-center justify-center">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sky-700"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-neutral-900">Transferencia bancaria</p>
                    <p className="text-xs text-neutral-400">Transfiere el monto exacto a la siguiente cuenta</p>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between rounded-xl bg-neutral-50 border border-neutral-100 px-4 py-3">
                    <div>
                      <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">Banco</p>
                      <p className="text-sm font-bold text-neutral-900 mt-0.5">{adminBankName || 'Cargando...'}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-neutral-50 border border-neutral-100 px-4 py-3">
                    <div>
                      <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">Número de cuenta</p>
                      <p className="text-sm font-bold text-neutral-900 mt-0.5 font-mono tracking-wider">{adminBankAccount || 'Cargando...'}</p>
                    </div>
                    <button onClick={() => { navigator.clipboard.writeText(adminBankAccount || ''); pushToast('success', 'Copiado', 'Cuenta copiada al portapapeles.'); }}
                      className="shrink-0 w-9 h-9 rounded-lg bg-white border border-neutral-200 flex items-center justify-center text-neutral-400 hover:text-sky-600 hover:border-sky-200 transition-colors"
                      title="Copiar cuenta">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    </button>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-neutral-50 border border-neutral-100 px-4 py-3">
                    <div>
                      <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">Beneficiario</p>
                      <p className="text-sm font-bold text-neutral-900 mt-0.5">{adminBankBeneficiary || 'Cargando...'}</p>
                    </div>
                    <button onClick={() => { navigator.clipboard.writeText(adminBankBeneficiary || ''); pushToast('success', 'Copiado', 'Beneficiario copiado al portapapeles.'); }}
                      className="shrink-0 w-9 h-9 rounded-lg bg-white border border-neutral-200 flex items-center justify-center text-neutral-400 hover:text-sky-600 hover:border-sky-200 transition-colors"
                      title="Copiar beneficiario">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className="text-sm font-semibold text-neutral-700 block mb-3">Comprobante de pago</label>
                <div className="space-y-3">
                  <button disabled={featuredUploading}
                    onClick={async () => {
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.accept = 'image/*';
                      input.onchange = async () => {
                        const file = input.files?.[0];
                        if (!file) return;
                        setFeaturedUploading(true);
                        try {
                          const toBase64 = (f: File): Promise<string> => new Promise((res, rej) => {
                            const reader = new FileReader();
                            reader.onload = () => res(reader.result as string);
                            reader.onerror = rej;
                            reader.readAsDataURL(f);
                          });
                          const base64 = await toBase64(file);
                          const uploadRes = await fetch(`${apiBase}/uploads/images`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                            body: JSON.stringify({ kind: 'payment-proof', source: base64 }),
                          });
                          const uploadData = await uploadRes.json();
                          if (uploadData.success) {
                            setFeaturedPaymentProof(uploadData.data.url);
                          } else {
                            pushToast('error', 'Error', 'No se pudo subir la imagen.');
                          }
                        } catch {
                          pushToast('error', 'Error', 'Error al subir la imagen.');
                        } finally {
                          setFeaturedUploading(false);
                        }
                      };
                      input.click();
                    }}
                    className="rounded-xl bg-neutral-100 border border-black/10 px-4 py-3 text-sm font-medium text-neutral-700 hover:bg-neutral-200 transition-colors disabled:opacity-50"
                  >
                    {featuredUploading ? 'Subiendo...' : featuredPaymentProof ? 'Cambiar comprobante' : 'Subir comprobante'}
                  </button>
                  {featuredPaymentProof && (
                    <div className="rounded-xl border border-neutral-200 overflow-hidden bg-white">
                      <div className="relative group">
                        <img src={featuredPaymentProof} alt="Comprobante de pago"
                          className="w-full h-48 object-contain bg-neutral-50 p-2" />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors" />
                      </div>
                      <div className="flex items-center justify-between px-4 py-2.5 border-t border-neutral-100">
                        <div className="flex items-center gap-2">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                          <span className="text-xs font-medium text-emerald-700">Comprobante adjunto</span>
                        </div>
                        <button onClick={() => window.open(featuredPaymentProof, '_blank')}
                          className="text-xs font-semibold text-sky-600 hover:text-sky-700 underline-offset-2 hover:underline transition-colors">
                          Ver original
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="border-t border-black/10 px-4 py-4 sm:px-7">
              <div className="flex gap-3 justify-end">
                <button onClick={() => setShowFeaturedModal(false)}
                  className="rounded-full border border-black/10 px-5 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 transition-colors">
                  Cancelar
                </button>
                <button disabled={featuredSubmitting || !featuredPaymentProof}
                  onClick={async () => {
                    if (!featuredPaymentProof) return;
                    setFeaturedSubmitting(true);
                    try {
                      const res = await fetch(`${apiBase}/restaurant/featured/request`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                        body: JSON.stringify({ daysRequested: featuredDays, paymentProof: featuredPaymentProof }),
                      });
                      const data = await res.json();
                      if (data.success) {
                        pushToast('success', 'Solicitud enviada', 'Tu solicitud sera revisada por un administrador.');
                        setShowFeaturedModal(false);
                        const refreshRes = await fetch(`${apiBase}/restaurant/featured/my-requests`, {
                          headers: { Authorization: `Bearer ${token}` },
                        });
                        const refreshData = await refreshRes.json();
                        if (refreshData.success) setFeaturedRequests(refreshData.data);
                      } else {
                        pushToast('error', 'Error', data.error?.message || 'No se pudo enviar la solicitud.');
                      }
                    } catch {
                      pushToast('error', 'Error', 'Error de conexion.');
                    } finally {
                      setFeaturedSubmitting(false);
                    }
                  }}
                  className="rounded-full bg-gradient-to-r from-sky-600 to-blue-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-sky-300/30 hover:shadow-xl hover:shadow-sky-300/40 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                >
                  {featuredSubmitting ? 'Enviando...' : `Enviar solicitud — $${(featuredPackages.find(p => p.days === featuredDays)?.price ?? 0).toFixed(2)}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* MODAL DE VISTA PREVIA DE COMPROBANTE */}
      {proofPreviewUrl ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 px-4 py-5"
          role="dialog" aria-modal="true" onClick={() => setProofPreviewUrl(null)}>
          <div className="relative max-h-[90vh] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setProofPreviewUrl(null)}
              className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-white shadow-lg flex items-center justify-center text-neutral-500 hover:text-neutral-700 z-10 transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
            <img src={proofPreviewUrl} alt="Comprobante de pago"
              className="max-h-[85vh] max-w-[85vw] rounded-2xl shadow-2xl object-contain bg-white" />
          </div>
        </div>
      ) : null}

      {/* MODAL DE DESPACHO EXPRESS QR (REPARTO PROPIO) */}
      {activeQrCodeData ? (() => {
        const origin = getCustomerOrigin() || (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.host}` : 'http://localhost:3003');
        const deliveryUrl = `${origin}/reparto/ver/${activeQrCodeData.token}`;

        return (
          <div
            className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 px-4 py-5 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
          >
            <div className="w-full max-w-md overflow-hidden rounded-[28px] border border-black/10 bg-white p-6 shadow-[0_32px_120px_rgba(0,0,0,0.4)] text-center">
              <div className="flex flex-col items-center">
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-2xl">
                  🛵
                </span>
                <h3 className="mt-4 text-2xl font-bold tracking-tight text-neutral-900">
                  ¡Pedido Despachado!
                </h3>
                <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-amber-600">
                  Pedido {activeQrCodeData.orderReference}
                </p>
                <p className="mt-2 text-sm text-neutral-500 max-w-xs">
                  Pídele al repartidor que escanee este código QR con la cámara de su celular para abrir los mapas y la información de la entrega.
                </p>

                {/* Contenedor del QR Code */}
                <div className="mt-6 rounded-2xl bg-neutral-50 border border-neutral-100 p-6">
                  <QRCodeSVG value={deliveryUrl} size={200} level="M" includeMargin={false} />
                </div>

                <div className="mt-6 w-full gap-2 flex flex-col">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(deliveryUrl);
                      pushToast('success', 'Enlace copiado', 'El enlace se copió al portapapeles.');
                    }}
                    className="w-full rounded-xl bg-neutral-100 py-3 text-sm font-semibold text-neutral-700 hover:bg-neutral-200 transition"
                  >
                    📋 Copiar Enlace Directo
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveQrCodeData(null)}
                    className="w-full rounded-xl bg-neutral-950 py-3.5 text-sm font-semibold text-white shadow-lg hover:bg-neutral-900 transition"
                  >
                    Entendido, Cerrar
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })() : null}

      {handoverPromptOrder ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 px-4 py-5"
          role="dialog"
          aria-modal="true"
          aria-labelledby="handover-order-title"
        >
          <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="px-5 pt-6 sm:px-6">
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-emerald-600">{handoverPromptOrder.paymentMethod === 'TRANSFER' ? 'Recolección' : 'Pago en efectivo'}</p>
              <h3 id="handover-order-title" className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-neutral-950">
                {handoverPromptOrder.paymentMethod === 'TRANSFER' ? 'Validar PIN de recolección' : 'Confirmar pago en efectivo'}
              </h3>
              <p className="mt-2 text-sm leading-6 text-neutral-600">
                {handoverPromptOrder.paymentMethod === 'TRANSFER' 
                  ? 'Ingresa el PIN de recolección que el repartidor debe proporcionarte para liberar el pedido.' 
                  : 'Confirma que has recibido el dinero en efectivo correspondiente al costo de la comida.'}
              </p>
              {handoverPromptOrder.paymentMethod === 'TRANSFER' && (
                <div className="mt-4 rounded-2xl border border-dashed border-rose-200 bg-rose-50/60 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-rose-500 mb-1">
                    👉 Pagar al repartidor
                  </p>
                  <p className="text-3xl font-black text-rose-700">
                    {formatCurrency(handoverPromptOrder.deliveryFee || 0)}
                  </p>
                  <p className="text-xs text-rose-400 mt-1 leading-tight">Entrega este efectivo al repartidor al recoger el pedido.</p>
                </div>
              )}
              {handoverPromptOrder.paymentMethod === 'CASH' && (
                <div className="mt-4 rounded-2xl border border-emerald-100 dark:border-emerald-900/30 bg-emerald-50 dark:bg-emerald-950/20 p-4">
                  <p className="text-xs font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400 mb-1">
                    Cobrar al repartidor
                  </p>
                  <p className="text-3xl font-black text-neutral-900 dark:text-zinc-50">
                    {formatCurrency((handoverPromptOrder.totalAmount || 0) - (handoverPromptOrder.deliveryFee || 0))}
                  </p>
                </div>
              )}
            </div>

            <div className="px-5 py-5 sm:px-6">
              {handoverPromptOrder.paymentMethod === 'TRANSFER' && (
                <div className="mb-5">
                  <div className="flex items-center justify-between mb-2">
                    <label htmlFor="handover-pin" className="text-sm font-medium text-neutral-700">PIN de recolección</label>
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${
                      handoverAttemptsLeft <= 1 ? 'text-rose-500' : 'text-neutral-400'
                    }`}>
                      Intentos: {handoverAttemptsLeft}/3
                    </span>
                  </div>
                  <input
                    type="text"
                    id="handover-pin"
                    maxLength={4}
                    value={handoverPinInput}
                    onChange={(e) => {
                      setHandoverPinInput(e.target.value.replace(/\D/g, ''));
                      if (handoverError) setHandoverError(null);
                    }}
                    className={`mt-2 block w-full rounded-xl border px-4 py-3 text-2xl tracking-[0.5em] text-center font-bold shadow-sm focus:ring-emerald-500 ${
                      handoverError
                        ? 'border-rose-300 focus:border-rose-500 bg-rose-50'
                        : 'border-neutral-300 focus:border-emerald-500'
                    }`}
                    placeholder="0000"
                  />
                  {handoverError && (
                    <p className="mt-2 text-xs font-semibold text-rose-600 text-center">{handoverError}</p>
                  )}
                </div>
              )}

                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setHandoverPromptOrderId(null);
                    setHandoverPinInput('');
                    setHandoverError(null);
                    setHandoverAttemptsLeft(3);
                  }}
                  className="rounded-full px-5 py-3 text-sm font-semibold text-neutral-600 transition hover:bg-neutral-100"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (handoverPromptOrder.paymentMethod === 'CASH') {
                      const handleCashHandover = async () => {
                        setActiveActionKey(`${handoverPromptOrder.id}:handover`);
                        try {
                          await requestJson<SuccessResponse<any>>({
                            apiBase,
                            path: `/restaurant-panel/pedidos/${handoverPromptOrder.id}/handover`,
                            token,
                            options: {
                              method: 'PATCH',
                              body: JSON.stringify({}),
                            },
                            fallbackMessage: 'Error al entregar el pedido.',
                            retry: { attempts: 1, backoffMs: 400 },
                          });
                          await requestJson<SuccessResponse<any>>({
                            apiBase,
                            path: `/restaurant-panel/pedidos/${handoverPromptOrder.id}/confirmar-pago-efectivo`,
                            token,
                            options: {
                              method: 'PATCH',
                              body: JSON.stringify({}),
                            },
                            fallbackMessage: 'Error al confirmar el pago.',
                            retry: { attempts: 1, backoffMs: 400 },
                          });
                          await loadOrdersOnly();
                          setHandoverPromptOrderId(null);
                          setHandoverPinInput('');
                          setHandoverError(null);
                          setHandoverAttemptsLeft(3);
                        } catch (err) {
                          const msg = getRequestErrorMessage(err, 'Error al procesar la entrega.');
                          pushToast('error', 'Error', msg);
                          try { await loadOrdersOnly(); } catch {}
                        } finally {
                          setActiveActionKey(null);
                        }
                      };
                      void handleCashHandover();
                    } else {
                      const handleTransferHandover = async () => {
                        const actionKey = `${handoverPromptOrder.id}:handover`;
                        setActiveActionKey(actionKey);
                        setHandoverError(null);
                        try {
                          await requestJson<SuccessResponse<any>>({
                            apiBase,
                            path: `/restaurant-panel/pedidos/${handoverPromptOrder.id}/handover`,
                            token,
                            options: {
                              method: 'PATCH',
                              body: JSON.stringify({ pin: handoverPinInput }),
                            },
                            fallbackMessage: 'Error al confirmar la entrega.',
                            retry: { attempts: 0 },
                          });
                          await loadOrdersOnly();
                          setHandoverPromptOrderId(null);
                          setHandoverPinInput('');
                          setHandoverError(null);
                          setHandoverAttemptsLeft(3);
                          pushToast('success', 'Entrega confirmada', 'El pedido fue entregado al repartidor exitosamente.');
                        } catch (err) {
                          const msg = getRequestErrorMessage(err, '');
                          if (msg.includes('PIN_RESET') || msg.includes('PIN agotado')) {
                            setHandoverError('🔁 PIN agotado. Se generó un nuevo PIN. Pídelo al repartidor.');
                            setHandoverPinInput('');
                            setHandoverAttemptsLeft(3);
                            pushToast('info', '🔄 Nuevo PIN', 'El PIN anterior expiró. Pídelo al repartidor nuevamente.');
                          } else if (msg.includes('PIN incorrecto')) {
                            const match = msg.match(/Intento (\d+)\/3/);
                            const attempt = match ? parseInt(match[1]) : 0;
                            setHandoverAttemptsLeft(3 - attempt);
                            setHandoverError(`❌ PIN incorrecto. Intento ${attempt}/3.`);
                            setHandoverPinInput('');
                            pushToast('error', 'PIN incorrecto', `Intento ${attempt}/3.`);
                          } else {
                            setHandoverError(msg || 'Error al confirmar la entrega.');
                            pushToast('error', 'Error', msg || 'Error al confirmar la entrega.');
                          }
                          try { await loadOrdersOnly(); } catch {}
                        } finally {
                          setActiveActionKey(null);
                        }
                      };
                      void handleTransferHandover();
                    }
                  }}
                  disabled={Boolean(activeActionKey) || (handoverPromptOrder.paymentMethod === 'TRANSFER' && handoverPinInput.length < 4)}
                  className="rounded-full bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
                >
                  {activeActionKey === `${handoverPromptOrder.id}:handover` ? 'Procesando...' : 'Confirmar entrega'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {pickupConfirmOrder ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 px-4 py-5"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pickup-confirm-title"
        >
          <div className="relative w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl">
            <button
              type="button"
              onClick={() => {
                setPickupConfirmOrderId(null);
                setPickupConfirmPinInput('');
                setPickupConfirmError(null);
                setPickupConfirmAttemptsLeft(3);
              }}
              className="absolute top-4 right-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-700 transition-colors"
              aria-label="Cerrar"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
            <div className="px-5 pt-6 sm:px-6">
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-emerald-600">Recolección</p>
              <h3 id="pickup-confirm-title" className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-neutral-950">
                Confirmar recolección
              </h3>
              <p className="mt-2 text-sm leading-6 text-neutral-600">
                {pickupConfirmOrder.paymentMethod === 'CASH'
                  ? 'Confirma que has recibido el pago en efectivo del cliente.'
                  : 'Ingresa el PIN de recolección que el cliente debe proporcionarte para liberar el pedido.'}
              </p>

              {pickupConfirmOrder.paymentMethod === 'TRANSFER' ? (
                <div className="mt-6">
                  <div className="flex items-center justify-between mb-2">
                    <label htmlFor="pickup-pin" className="text-sm font-medium text-neutral-700">PIN de recolección</label>
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${
                      pickupConfirmAttemptsLeft <= 1 ? 'text-rose-500' : 'text-neutral-400'
                    }`}>
                      Intentos: {pickupConfirmAttemptsLeft}/3
                    </span>
                  </div>
                  <input
                    type="text"
                    id="pickup-pin"
                    maxLength={4}
                    value={pickupConfirmPinInput}
                    onChange={(e) => {
                      setPickupConfirmPinInput(e.target.value.replace(/\D/g, ''));
                      if (pickupConfirmError) setPickupConfirmError(null);
                    }}
                    className={`mt-2 block w-full rounded-xl border px-4 py-3 text-2xl tracking-[0.5em] text-center font-bold shadow-sm focus:ring-emerald-500 ${
                      pickupConfirmError
                        ? 'border-rose-300 focus:border-rose-500 bg-rose-50'
                        : 'border-neutral-300 focus:border-emerald-500'
                    }`}
                    placeholder="0000"
                  />
                  {pickupConfirmError && (
                    <p className="mt-2 text-xs font-semibold text-rose-600 text-center">{pickupConfirmError}</p>
                  )}
                </div>
              ) : (
                <div className="mt-6 rounded-2xl border border-emerald-100 bg-emerald-50 p-5">
                  <p className="text-xs font-bold uppercase tracking-widest text-emerald-600 mb-1">
                    Total a cobrar
                  </p>
                  <p className="text-3xl font-black text-neutral-900">
                    {formatCurrency(pickupConfirmOrder.totalAmount || 0)}
                  </p>
                  <p className="text-xs text-emerald-500 mt-1">El cliente paga en efectivo al recoger.</p>
                </div>
              )}
            </div>

            <div className="px-5 py-5 sm:px-6">
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setPickupConfirmOrderId(null);
                    setPickupConfirmPinInput('');
                    setPickupConfirmError(null);
                    setPickupConfirmAttemptsLeft(3);
                  }}
                  className="rounded-full px-5 py-3 text-sm font-semibold text-neutral-600 transition hover:bg-neutral-100"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={
                    Boolean(activeActionKey) ||
                    (pickupConfirmOrder.paymentMethod === 'TRANSFER' && pickupConfirmPinInput.length < 4)
                  }
                  onClick={async () => {
                    const orderId = pickupConfirmOrder.id;
                    setActiveActionKey(`${orderId}:marcarRecogido`);
                    setPickupConfirmError(null);
                    try {
                      await requestJson<SuccessResponse<any>>({
                        apiBase,
                        path: `/restaurant-panel/pedidos/${orderId}/marcar-recogido`,
                        token,
                        options: {
                          method: 'PATCH',
                          body: JSON.stringify(
                            pickupConfirmOrder.paymentMethod === 'TRANSFER'
                              ? { pin: pickupConfirmPinInput }
                              : {}
                          ),
                        },
                        fallbackMessage: 'Error al confirmar la recolección.',
                        retry: { attempts: 0 },
                      });
                      await loadOrdersOnly();
                      setPickupConfirmOrderId(null);
                      setPickupConfirmPinInput('');
                      setPickupConfirmError(null);
                      setPickupConfirmAttemptsLeft(3);
                      pushToast('success', 'Recolección confirmada', 'El pedido fue marcado como recogido exitosamente.');
                    } catch (err) {
                      const msg = getRequestErrorMessage(err, '');
                      if (msg.includes('PIN_RESET') || msg.includes('PIN agotado') || msg.includes('PIN actualizado')) {
                        setPickupConfirmError('🔁 PIN actualizado. Pídelo al cliente.');
                        setPickupConfirmPinInput('');
                        setPickupConfirmAttemptsLeft(3);
                        pushToast('info', '🔄 Nuevo PIN', 'El PIN fue renovado. Pídelo al cliente.');
                      } else if (msg.includes('PIN incorrecto')) {
                        const match = msg.match(/Intento (\d+)\/3/);
                        const attempt = match ? parseInt(match[1]) : 0;
                        setPickupConfirmAttemptsLeft(3 - attempt);
                        setPickupConfirmError(`❌ PIN incorrecto. Intento ${attempt}/3.`);
                        setPickupConfirmPinInput('');
                        pushToast('error', 'PIN incorrecto', `Intento ${attempt}/3.`);
                      } else {
                        setPickupConfirmError(msg || 'Error al confirmar la recolección.');
                        pushToast('error', 'Error', msg || 'Error al confirmar la recolección.');
                      }
                      try { await loadOrdersOnly(); } catch {}
                    } finally {
                      setActiveActionKey(null);
                    }
                  }}
                  className="rounded-full bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
                >
                  {activeActionKey === `${pickupConfirmOrder.id}:marcarRecogido`
                    ? 'Procesando...'
                    : 'Confirmar recolección'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {acceptancePromptOrder ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 px-4 py-5"
          role="dialog"
          aria-modal="true"
          aria-labelledby="accept-order-title"
        >
          <div className="w-full max-w-[620px] rounded-[24px] bg-white shadow-[0_28px_90px_rgba(15,15,15,0.34)]">
            <div className="border-b border-black/10 px-5 py-4 sm:px-6">
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-sky-600">Aceptar pedido</p>
              <h3 id="accept-order-title" className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-neutral-950">
                Define el tiempo estimado de preparación
              </h3>
              <p className="mt-2 text-sm leading-6 text-neutral-600">
                {acceptancePromptOrder.orderReference} · El cliente verá una llegada aproximada calculada con este tiempo
                de preparación más el traslado estimado.
              </p>
            </div>

            <div className="px-5 py-5 sm:px-6">
              <div className="grid gap-3">
                {preparationTimePresets.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => setSelectedPreparationTime(preset.value)}
                    className={`grid gap-1 border px-4 py-4 text-left transition ${selectedPreparationTime === preset.value
                      ? 'border-sky-500 bg-sky-50'
                      : 'border-black/10 bg-white hover:border-sky-200 hover:bg-sky-50/50'
                      }`}
                  >
                    <span className="text-base font-semibold text-neutral-950">{preset.label}</span>
                    <span className="text-sm text-neutral-600">{preset.description}</span>
                  </button>
                ))}
              </div>

              <div className="mt-5 border-t border-black/10 pt-4">
                <p className="text-sm text-neutral-600">
                  Entrega estimada para el cliente:{' '}
                  <span className="font-semibold text-neutral-950">
                    {formatDate(
                      calculateEstimatedArrivalPreview(
                        selectedPreparationTime,
                        profile?.maxDeliveryTime ?? 0
                      ).toISOString()
                    )}
                  </span>
                </p>
              </div>

              <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setAcceptancePromptOrderId(null)}
                  disabled={Boolean(activeActionKey)}
                  className="rounded-full border border-black/10 bg-white px-5 py-3 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Volver
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const onAccept = () => void runOrderAction(acceptancePromptOrder.id, 'accept', {
                      preparationTimeMinutes: selectedPreparationTime,
                    });
                    if (acceptancePromptOrder.paymentMethod === 'TRANSFER') {
                      setTransferConfirmationOrder({
                        id: acceptancePromptOrder.id,
                        preparationTimeMinutes: selectedPreparationTime,
                        paymentProofUrl: acceptancePromptOrder.paymentProofUrl,
                        orderReference: acceptancePromptOrder.orderReference,
                        collectionAmount: getRestaurantCollectionAmount(acceptancePromptOrder, profile?.hasOwnDelivery),
                        onConfirm: onAccept,
                      });
                    } else {
                      onAccept();
                    }
                  }}
                  disabled={Boolean(activeActionKey)}
                  className="rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-sky-300"
                >
                  {activeActionKey === `${acceptancePromptOrder.id}:accept`
                    ? 'Confirmando aceptacion...'
                    : 'Confirmar y aceptar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {showSaveSuccessModal ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-neutral-950/20 backdrop-blur-sm transition-opacity"
            onClick={() => setShowSaveSuccessModal(false)}
          />
          <div className="relative w-full max-w-[360px] rounded-[32px] bg-white p-8 text-center shadow-[0_32px_64px_rgba(0,0,0,0.1)]">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-green-50 text-green-500 ring-8 ring-green-50/50">
              <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="mb-3 text-[22px] font-bold tracking-tight text-neutral-900">Cambios guardados</h3>
            <p className="mb-8 text-[15px] leading-relaxed text-neutral-500">
              La configuración de tu tienda ha sido actualizada exitosamente.
            </p>
            <button
              type="button"
              onClick={() => setShowSaveSuccessModal(false)}
              className="w-full rounded-full bg-neutral-950 py-4 text-[15px] font-semibold text-white transition-all hover:bg-black focus:outline-none focus:ring-4 focus:ring-neutral-200 active:scale-[0.98]"
            >
              Entendido
            </button>
          </div>
        </div>
      ) : null}
      {statusToast ? (
        <div className="fixed inset-0 z-[75] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setStatusToast(null)} />
          <div className="relative w-full max-w-sm rounded-[32px] bg-white p-7 text-center shadow-[0_28px_90px_rgba(15,15,15,0.34)] border border-black/5 animate-in zoom-in-95 fade-in duration-300">
            <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ring-8 ${
              statusToast.type === 'open' ? 'bg-sky-50 text-sky-500 ring-sky-50/50' :
              statusToast.type === 'close' ? 'bg-neutral-100 text-neutral-500 ring-neutral-100/50' :
              statusToast.type === 'pause' ? 'bg-amber-50 text-amber-500 ring-amber-50/50' :
              'bg-emerald-50 text-emerald-500 ring-emerald-50/50'
            }`}>
              <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {statusToast.type === 'open' ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                ) : statusToast.type === 'close' ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : statusToast.type === 'pause' ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                )}
              </svg>
            </div>
            <h3 className="mt-5 text-xl font-bold tracking-tight text-neutral-900">{statusToast.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-neutral-500">{statusToast.description}</p>
          </div>
        </div>
      ) : null}
      {showCloseConfirmModal ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 px-4 py-6">
          <div className="absolute inset-0" onClick={() => setShowCloseConfirmModal(false)} />
          <div className="relative w-full max-w-[420px] rounded-[32px] bg-white p-6 shadow-[0_28px_90px_rgba(15,15,15,0.34)] border border-black/5">
            <div className="text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-neutral-100 text-neutral-500">
                <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20 12H4" />
                </svg>
              </div>
              <h3 className="mt-4 text-xl font-bold tracking-tight text-neutral-900">¿Cerrar negocio?</h3>
              <p className="mt-2 text-sm leading-relaxed text-neutral-500">
                Al cerrar el negocio dejarás de recibir nuevos pedidos. Los pedidos en curso no se verán afectados.
              </p>
            </div>
            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowCloseConfirmModal(false)}
                className="flex-1 rounded-full border border-neutral-200 bg-white px-5 py-3 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-50 active:scale-[0.98]"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={async () => {
                  setShowCloseConfirmModal(false);
                  await performStatusUpdate(false);
                }}
                className="flex-1 rounded-full bg-neutral-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-neutral-800 active:scale-[0.98]"
              >
                Cerrar ahora
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {isCategoryModalOpen ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 px-4 py-5">
          <div className="w-full max-w-[560px] rounded-[28px] bg-white p-5 shadow-[0_28px_90px_rgba(15,15,15,0.34)] sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">Mi tienda</p>
                <h3 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-neutral-950">
                  Nueva categoria
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsCategoryModalOpen(false)}
                className="rounded-full border border-black/10 px-4 py-2 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-100"
              >
                Cerrar
              </button>
            </div>

            <div className="mt-6 grid gap-4">
              <Field
                label="Nombre de la categoria"
                value={newCategoryName}
                onChange={setNewCategoryName}
                placeholder="Tacos, Bebidas, Postres..."
              />

            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => void createCategory()}
                disabled={creatingCategory || !newCategoryName.trim()}
                className="rounded-full bg-neutral-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
              >
                {creatingCategory ? 'Creando...' : 'Crear categoria'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {isDeleteProductModalOpen ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/55 px-4 py-4 sm:items-center sm:py-5">
          <div className="w-full max-w-[520px] rounded-[28px] bg-white p-5 shadow-[0_28px_90px_rgba(15,15,15,0.34)] sm:p-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-rose-500">Eliminar producto</p>
              <h3 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-neutral-950">
                Quieres eliminar este producto?
              </h3>
              <p className="mt-3 text-sm leading-6 text-neutral-600">
                {deletingProductName
                  ? `Se eliminara "${deletingProductName}" de tu menu publicado.`
                  : 'Se eliminara este producto de tu menu publicado.'}
              </p>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setIsDeleteProductModalOpen(false);
                  setDeletingProductId(null);
                  setDeletingProductName('');
                }}
                disabled={deletingProduct}
                className="rounded-full border border-black/10 px-5 py-3 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void deleteProduct()}
                disabled={deletingProduct}
                className="rounded-full bg-rose-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:bg-rose-300"
              >
                {deletingProduct ? 'Eliminando...' : 'Aceptar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {isProductModalOpen ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-sky-950/40 px-4 py-5 backdrop-blur-md transition-all duration-500">
          <div className="relative flex w-full max-w-[760px] max-h-[92vh] flex-col overflow-hidden rounded-[36px] bg-white shadow-[0_32px_120px_rgba(14,165,233,0.25)] ring-1 ring-sky-100">
            
            {/* Ambient Background Glows */}
            <div className="pointer-events-none absolute -left-20 -top-20 h-64 w-64 rounded-full bg-sky-300/20 blur-[80px]" />
            <div className="pointer-events-none absolute -right-20 top-1/2 h-64 w-64 rounded-full bg-blue-300/10 blur-[80px]" />

            {/* Premium Header */}
            <div className="relative shrink-0 border-b border-sky-100/50 bg-white/80 px-6 py-6 backdrop-blur-xl sm:px-10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-100 to-sky-50 text-sky-600 shadow-inner ring-1 ring-sky-200/50">
                    <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
                  </div>
                  <div>
                    <h3 className="text-xl font-bold tracking-tight text-neutral-900 sm:text-2xl">
                      {productDraft.id ? 'Editar producto' : 'Nuevo producto'}
                    </h3>
                    <p className="mt-1 text-sm font-medium text-sky-700/70">
                      {profile?.businessType === 'RESTAURANT' ? 'Gestiona la información, precios y extras de tu platillo.' : 'Gestiona la información, precios y variantes de tu producto.'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsProductModalOpen(false);
                    setProductImageValidationError('');
                    setProductDraft({
                      id: undefined,
                      categoryId: categories[0]?.id || '',
                      name: '',
                      description: '',
                      price: '',
                      discountPrice: '',
                      sellBy: 'UNIT',
                      unitPrice: '',
                      minWeightG: '100',
                      maxWeightG: '5000',
                      stepWeightG: '100',
                      weightPresets: [100, 200, 300, 500, 1000],
                      image: '',
                      images: [],
                      imagePosition: '50% 50%',
                      imageZoom: 100,
                      isAdultOnly: false,
                      preparationTime: '15',
                    });
                  }}
                  className="group inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600 transition-all hover:bg-sky-100 hover:text-sky-900"
                  aria-label="Cerrar"
                >
                  <svg className="h-5 w-5 transition-transform duration-300 group-hover:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>

            {/* Scrollable Content */}
            <div className="relative flex-1 overflow-y-auto bg-gradient-to-b from-sky-50/30 to-white px-6 py-8 sm:px-10">
              <div className="space-y-10">
                
                {/* 1. Información Básica */}
                <section>
                  <div className="mb-5 flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 to-sky-600 text-sm font-black text-white shadow-lg shadow-sky-500/30">1</span>
                    <h4 className="text-[13px] font-bold uppercase tracking-[0.15em] text-sky-900">Información Básica</h4>
                  </div>
                  <div className="rounded-[28px] border border-white bg-white/80 p-6 shadow-[0_8px_30px_rgba(14,165,233,0.06)] backdrop-blur-md ring-1 ring-sky-100/50 sm:p-8">
                    <div className="grid gap-5 sm:grid-cols-2">
                      <label className="grid gap-2 text-sm text-neutral-600 sm:col-span-2">
                        <span className="text-[12px] font-bold uppercase tracking-[0.1em] text-neutral-600">Categoría</span>
                        <select
                          value={productDraft.categoryId}
                          onChange={(event) =>
                            setProductDraft((current) => ({ ...current, categoryId: event.target.value }))
                          }
                          className="w-full rounded-[18px] border border-black/5 bg-neutral-100/50 px-5 py-3.5 text-[15px] font-medium text-neutral-950 shadow-inner outline-none transition-all hover:bg-neutral-100/80 focus:border-sky-300 focus:bg-white focus:ring-4 focus:ring-sky-500/20 focus:shadow-md"
                        >
                          <option value="">Selecciona una categoría...</option>
                          {categories.map((category) => (
                            <option key={category.id} value={category.id}>
                              {category.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Field
                        label={profile?.businessType === 'RESTAURANT' ? 'Nombre del Platillo' : 'Nombre del Producto'}
                        value={productDraft.name}
                        onChange={(value) => setProductDraft((current) => ({ ...current, name: value }))}
                        placeholder={profile?.businessType === 'RESTAURANT' ? 'Ej: Hamburguesa Clásica' : 'Ej: Camiseta Deportiva'}
                      />
                      {profile?.businessType === 'RESTAURANT' ? (
                        <Field
                          label="Tiempo de Prep (min)"
                          value={productDraft.preparationTime}
                          onChange={(value) =>
                            setProductDraft((current) => ({ ...current, preparationTime: value }))
                          }
                          placeholder="Ej: 15"
                        />
                      ) : (
                        <Field
                          label="SKU / Código"
                          value={productDraft.preparationTime}
                          onChange={(value) =>
                            setProductDraft((current) => ({ ...current, preparationTime: value }))
                          }
                          placeholder="Ej: PROD-001"
                        />
                      )}
                      <div className="sm:col-span-2">
                        <TextAreaField
                          label="Descripción"
                          value={productDraft.description}
                          onChange={(value) =>
                            setProductDraft((current) => ({ ...current, description: value }))
                          }
                          placeholder={profile?.businessType === 'RESTAURANT' ? 'Describe los ingredientes, la porción o lo que hace especial a este producto...' : 'Describe las características, talla, material o lo que hace especial a este producto...'}
                        />
                      </div>
                    </div>
                  </div>
                </section>

                {/* 2. Precios e Imagen */}
                <section>
                  <div className="mb-5 flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 to-sky-600 text-sm font-black text-white shadow-lg shadow-sky-500/30">2</span>
                    <h4 className="text-[13px] font-bold uppercase tracking-[0.15em] text-sky-900">Precios y Fotografía</h4>
                  </div>
                  <div className="rounded-[28px] border border-white bg-white/80 p-6 shadow-[0_8px_30px_rgba(14,165,233,0.06)] backdrop-blur-md ring-1 ring-sky-100/50 sm:p-8">
                    <div className="grid gap-5 sm:grid-cols-2">
                      {/* Tipo de venta */}
                      <div className="sm:col-span-2">
                        <label className="text-[12px] font-bold uppercase tracking-[0.1em] text-neutral-600">Tipo de venta</label>
                        <div className="mt-2 flex gap-2 rounded-[18px] border border-black/5 bg-neutral-100/50 p-1.5">
                          <button
                            type="button"
                            onClick={() => setProductDraft((current) => ({ ...current, sellBy: 'UNIT' }))}
                            className={`flex-1 rounded-xl py-2.5 text-xs font-bold transition-all ${
                              productDraft.sellBy === 'UNIT'
                                ? 'bg-white text-sky-700 shadow-sm'
                                : 'text-neutral-500 hover:text-neutral-700'
                            }`}
                          >
                            Por pieza
                          </button>
                          <button
                            type="button"
                            onClick={() => setProductDraft((current) => ({ ...current, sellBy: 'WEIGHT' }))}
                            className={`flex-1 rounded-xl py-2.5 text-xs font-bold transition-all ${
                              productDraft.sellBy === 'WEIGHT'
                                ? 'bg-white text-sky-700 shadow-sm'
                                : 'text-neutral-500 hover:text-neutral-700'
                            }`}
                          >
                            Por peso (kg)
                          </button>
                        </div>
                      </div>

                      {productDraft.sellBy === 'UNIT' ? (
                        <Field
                          label="Precio ($)"
                          value={productDraft.price}
                          onChange={(value) => setProductDraft((current) => ({ ...current, price: value }))}
                          placeholder="0.00"
                        />
                      ) : (
                        <Field
                          label="Precio por kg ($)"
                          value={productDraft.unitPrice}
                          onChange={(value) => setProductDraft((current) => ({ ...current, unitPrice: value, price: value || '0' }))}
                          placeholder="0.00"
                        />
                      )}
                      <Field
                        label="Precio Especial (Opcional)"
                        value={productDraft.discountPrice || ''}
                        onChange={(value) => setProductDraft((current) => ({ ...current, discountPrice: value }))}
                        placeholder="0.00"
                      />

                      {productDraft.sellBy === 'WEIGHT' && (
                        <div className="sm:col-span-2 rounded-2xl border border-sky-200/50 bg-sky-50/50 p-4">
                          <p className="mb-3 text-[12px] font-bold uppercase tracking-[0.1em] text-sky-700">Configuración de peso</p>
                          <div className="grid gap-4 sm:grid-cols-3">
                            <Field label="Mínimo (gramos)" value={productDraft.minWeightG} onChange={(v) => setProductDraft((c) => ({ ...c, minWeightG: v }))} placeholder="100" />
                            <Field label="Máximo (gramos)" value={productDraft.maxWeightG} onChange={(v) => setProductDraft((c) => ({ ...c, maxWeightG: v }))} placeholder="5000" />
                            <Field label="Incremento (gramos)" value={productDraft.stepWeightG} onChange={(v) => setProductDraft((c) => ({ ...c, stepWeightG: v }))} placeholder="100" />
                          </div>
                          <div className="mt-3">
                            <label className="text-[12px] font-bold uppercase tracking-[0.1em] text-neutral-600">Accesos rápidos (gramos)</label>
                            <div className="mt-1.5 flex flex-wrap gap-2">
                              {[
                                { label: '100g', value: 100 },
                                { label: '200g', value: 200 },
                                { label: '300g', value: 300 },
                                { label: '500g', value: 500 },
                                { label: '1kg', value: 1000 },
                                { label: '2kg', value: 2000 },
                                { label: '3kg', value: 3000 },
                              ].map((preset) => (
                                <button
                                  key={preset.value}
                                  type="button"
                                  onClick={() =>
                                    setProductDraft((current) => {
                                      const currentPresets = current.weightPresets || [];
                                      const has = currentPresets.includes(preset.value);
                                      return {
                                        ...current,
                                        weightPresets: has
                                          ? currentPresets.filter((p) => p !== preset.value)
                                          : [...currentPresets, preset.value].sort((a, b) => a - b),
                                      };
                                    })
                                  }
                                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
                                    (productDraft.weightPresets || []).includes(preset.value)
                                      ? 'border-sky-300 bg-sky-100 text-sky-700'
                                      : 'border-black/5 bg-white/60 text-neutral-500 hover:bg-white'
                                  }`}
                                >
                                  {preset.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="sm:col-span-2 mt-2">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                          <div className="flex-1 space-y-4">
                            <Field
                              label="URL de Fotografía"
                              value={productDraft.image}
                              onChange={(value) => {
                                setProductImageValidationError('');
                                setProductDraft((current) => ({
                                  ...current,
                                  image: value,
                                  images: current.images.length > 0 ? [value, ...current.images.slice(1)] : [value],
                                }));
                              }}
                              placeholder="https://ejemplo.com/imagen.jpg"
                            />
                            {productImageValidationError ? (
                              <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
                                {productImageValidationError}
                              </p>
                            ) : null}
                            <div className="flex items-center gap-3 rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 p-4 transition-colors hover:bg-neutral-100">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-neutral-500 shadow-sm">
                                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                              </div>
                              <div className="flex-1">
                                <p className="text-sm font-bold text-neutral-900">Subir imagen desde equipo</p>
                                 <p className="text-xs text-neutral-500">Formato cuadrado 1:1 para mejor resultado. Si usas otra proporción, ajusta el encuadre de la imagen.</p>
                              </div>
                              <input
                                ref={productImageInputRef}
                                type="file"
                                accept="image/*"
                                onChange={(event) => void handleProductImageFileChange(event)}
                                className="hidden"
                              />
                              <button
                                type="button"
                                onClick={() => productImageInputRef.current?.click()}
                                disabled={processingProductImage}
                                className="shrink-0 rounded-full bg-neutral-900 px-4 py-2 text-xs font-bold text-white transition hover:bg-neutral-800 disabled:opacity-50"
                              >
                                {processingProductImage ? 'Cargando...' : 'Examinar'}
                              </button>
                            </div>
                          </div>
                          
                          {/* Crop Preview */}
                          {productDraft.image.trim() && !productImageValidationError ? (
                            <div className="mt-4 flex flex-col items-center gap-1 sm:mt-0">
                              <div
                                ref={cropContainerRef}
                                className="group relative w-full select-none overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-100 shadow-sm sm:w-44 sm:aspect-square"
                                onMouseDown={(e) => {
                                  const div = cropContainerRef.current;
                                  if (!div) return;
                                  const rect = div.getBoundingClientRect();
                                  const x = Math.round(((e.clientX - rect.left) / rect.width) * 100);
                                  const y = Math.round(((e.clientY - rect.top) / rect.height) * 100);
                                  cropDragRef.current = {
                                    isDragging: true,
                                    startX: e.clientX,
                                    startY: e.clientY,
                                    startPosition: `${x}% ${y}%`,
                                  };
                                  setProductDraft((curr) => ({ ...curr, imagePosition: `${x}% ${y}%` }));
                                }}
                                onTouchStart={(e) => {
                                  const touches = e.touches;
                                  if (touches.length === 2) {
                                    cropDragRef.current.isDragging = false;
                                    const dx = touches[0].clientX - touches[1].clientX;
                                    const dy = touches[0].clientY - touches[1].clientY;
                                    const dist = Math.sqrt(dx * dx + dy * dy);
                                    (cropContainerRef.current as any).__pinchDist = dist;
                                    (cropContainerRef.current as any).__pinchZoom = productDraft.imageZoom || 100;
                                    return;
                                  }
                                  const div = cropContainerRef.current;
                                  if (!div || !touches[0]) return;
                                  const rect = div.getBoundingClientRect();
                                  const touch = touches[0];
                                  const x = Math.round(((touch.clientX - rect.left) / rect.width) * 100);
                                  const y = Math.round(((touch.clientY - rect.top) / rect.height) * 100);
                                  cropDragRef.current = {
                                    isDragging: true,
                                    startX: touch.clientX,
                                    startY: touch.clientY,
                                    startPosition: `${x}% ${y}%`,
                                  };
                                  setProductDraft((curr) => ({ ...curr, imagePosition: `${x}% ${y}%` }));
                                }}
                                onTouchMove={(e) => {
                                  const touches = e.touches;
                                  const el = cropContainerRef.current;
                                  if (touches.length === 2 && el) {
                                    const dx = touches[0].clientX - touches[1].clientX;
                                    const dy = touches[0].clientY - touches[1].clientY;
                                    const dist = Math.sqrt(dx * dx + dy * dy);
                                    const startDist = (el as any).__pinchDist;
                                    const startZoom = (el as any).__pinchZoom || 100;
                                    if (startDist > 0) {
                                      const ratio = dist / startDist;
                                      const newZoom = Math.max(30, Math.min(300, Math.round(startZoom * ratio)));
                                      setProductDraft((curr) => ({ ...curr, imageZoom: newZoom }));
                                    }
                                    return;
                                  }
                                }}
                                onTouchEnd={() => {
                                  cropDragRef.current.isDragging = false;
                                  if (cropContainerRef.current) {
                                    (cropContainerRef.current as any).__pinchDist = 0;
                                  }
                                }}
                              >
                                <div
                                  className="absolute inset-0 flex items-center justify-center overflow-hidden"
                                  style={{ transform: `scale(${(productDraft.imageZoom || 100) / 100})` }}
                                >
                                  <img
                                    src={productDraft.image}
                                    alt="Vista previa"
                                    className={`pointer-events-none h-full w-full ${(productDraft.imageZoom || 100) < 100 ? 'object-contain' : 'object-cover'}`}
                                    style={{ objectPosition: productDraft.imagePosition || '50% 50%' }}
                                    draggable={false}
                                  />
                                </div>
                                {productDraft.imagePosition && (
                                  <div className="pointer-events-none absolute inset-0">
                                    <div
                                      className="absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2"
                                      style={{
                                        left: productDraft.imagePosition.split(' ')[0],
                                        top: productDraft.imagePosition.split(' ')[1],
                                      }}
                                    >
                                      <div className="h-full w-full rounded-full border-[3px] border-white/90 shadow-[0_2px_12px_rgba(0,0,0,0.4)]" />
                                      <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/50" />
                                      <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-white/50" />
                                    </div>
                                  </div>
                                )}
                                <div className="pointer-events-none absolute right-2 top-2 z-10 flex items-center gap-1">
                                  <div className="rounded-md bg-black/50 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur">
                                    {(productDraft.imageZoom || 100) < 100 ? '' : '+'}{(productDraft.imageZoom || 100) - 100}%
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setProductDraft((curr) => ({ ...curr, imageZoom: Math.max(30, (curr.imageZoom || 100) - 10) }))}
                                    className="pointer-events-auto flex h-6 w-6 items-center justify-center rounded-md bg-black/50 text-xs font-bold text-white backdrop-blur transition hover:bg-black/70"
                                    title="Reducir zoom"
                                  >
                                    −
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setProductDraft((curr) => ({ ...curr, imageZoom: Math.min(300, (curr.imageZoom || 100) + 10) }))}
                                    className="pointer-events-auto flex h-6 w-6 items-center justify-center rounded-md bg-black/50 text-xs font-bold text-white backdrop-blur transition hover:bg-black/70"
                                    title="Aumentar zoom"
                                  >
                                    +
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setProductDraft((curr) => ({ ...curr, imageZoom: 100 }))}
                                    className="pointer-events-auto flex h-6 w-6 items-center justify-center rounded-md bg-black/50 text-[10px] font-bold text-white backdrop-blur transition hover:bg-black/70"
                                    title="Restablecer zoom"
                                  >
                                    ↺
                                  </button>
                                </div>
                                <div className="absolute inset-x-0 bottom-0 flex items-center justify-center bg-gradient-to-t from-black/50 to-transparent pb-2 pt-6 opacity-0 transition-opacity group-hover:opacity-100">
                                  <span className="rounded-full bg-white/90 px-3 py-1 text-[11px] font-semibold text-neutral-800 shadow-sm backdrop-blur">
                                    Arrastra para encuadrar, rueda/botones para zoom
                                  </span>
                                </div>
                              </div>
                            </div>
                          ) : null}

                          {/* Extra images for non-restaurant products */}
                          {profile?.businessType && profile.businessType !== 'RESTAURANT' && (
                            <div className="mt-4 space-y-3 sm:col-span-2">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-neutral-800">Imágenes adicionales</span>
                                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-500">{productDraft.images.length - 1} extra</span>
                              </div>
                              <div className="flex flex-wrap gap-3">
                                {productDraft.images.slice(1).map((url, idx) => (
                                  <div key={idx} className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-neutral-200 bg-neutral-100 shadow-sm">
                                    <img src={url} alt="" className="h-full w-full object-cover" />
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setProductDraft((curr) => ({
                                          ...curr,
                                          images: curr.images.filter((_, i) => i !== idx + 1),
                                        }))
                                      }
                                      className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-[11px] text-white opacity-0 transition group-hover:opacity-100"
                                    >
                                      ×
                                    </button>
                                  </div>
                                ))}
                                <button
                                  type="button"
                                  onClick={() => productImageExtraInputRef.current?.click()}
                                  className="flex h-16 w-16 items-center justify-center rounded-xl border-2 border-dashed border-neutral-300 bg-neutral-50 text-lg text-neutral-400 transition hover:border-sky-400 hover:text-sky-600"
                                  title="Agregar otra imagen"
                                >
                                  +
                                </button>
                                <input
                                  ref={productImageExtraInputRef}
                                  type="file"
                                  accept="image/*"
                                  onChange={(e) => void handleProductExtraImageFileChange(e)}
                                  className="hidden"
                                />
                              </div>
                              <p className="text-[11px] text-neutral-400">Puedes agregar hasta 5 imágenes. La primera será la principal.</p>
                            </div>
                          )}

                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-4 rounded-2xl border border-rose-100 bg-rose-50/50 p-4 transition-colors hover:bg-rose-50 sm:col-span-2 mt-2">
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600">
                            <span className="text-xs font-black">+18</span>
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-rose-950">Restricción de Edad</h4>
                            <p className="mt-0.5 text-xs font-medium text-rose-700/80">
                              {profile?.businessType === 'RESTAURANT' ? 'Activa esta opción si el producto contiene alcohol.' : 'Activa esta opción si es un producto para adultos.'}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setProductDraft((curr) => ({ ...curr, isAdultOnly: !curr.isAdultOnly }))}
                          className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ease-in-out focus:outline-none shadow-inner ${
                            productDraft.isAdultOnly ? 'bg-rose-500' : 'bg-neutral-300'
                          }`}
                          role="switch"
                          aria-checked={productDraft.isAdultOnly}
                        >
                          <span
                            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                              productDraft.isAdultOnly ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </div>
                    </div>
                  </div>
                </section>

                {/* 3. Personalizaciones */}
                <section>
                  <div className="mb-5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 to-sky-600 text-sm font-black text-white shadow-lg shadow-sky-500/30">3</span>
                      <h4 className="text-[13px] font-bold uppercase tracking-[0.15em] text-sky-900">{profile?.businessType === 'RESTAURANT' ? 'Extras y Modificadores' : 'Variantes del Producto'}</h4>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setProductDraft((current) => ({
                          ...current,
                          optionGroups: [
                            ...(current.optionGroups || []),
                            {
                              name: '',
                              minSelection: 0,
                              maxSelection: 1,
                              options: [{ name: '', price: 0 }]
                            }
                          ]
                        }));
                      }}
                      className="group flex items-center gap-1.5 rounded-full bg-gradient-to-r from-sky-50 to-white px-3 py-1.5 text-xs font-bold text-sky-600 border border-sky-100/60 shadow-[0_2px_8px_rgba(14,165,233,0.08)] transition hover:bg-sky-50 hover:text-sky-700"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
                      Añadir Grupo
                    </button>
                  </div>

                  {(!productDraft.optionGroups || productDraft.optionGroups.length === 0) ? (
                    <div className="flex flex-col items-center justify-center rounded-[28px] border border-dashed border-sky-200/50 bg-sky-50/30 py-10 text-center">
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-100 to-sky-50 text-sky-400">
                        <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
                      </div>
                      <h5 className="mt-4 text-sm font-bold text-sky-900">Sin opciones adicionales</h5>
                      <p className="mt-1.5 max-w-sm text-[13px] font-medium text-sky-700/60">
                        {profile?.businessType === 'RESTAURANT' ? 'Si tu producto tiene variantes como tamaño, sabor o ingredientes extra, añádelas aquí.' : 'Si tu producto tiene variantes como talla, color o material, añádelas aquí.'}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {productDraft.optionGroups.map((group, groupIdx) => (
                        <div key={groupIdx} className="relative overflow-hidden rounded-[24px] border border-sky-100/60 bg-white/80 backdrop-blur-sm shadow-sm transition-all hover:border-sky-200">
                          <div className="flex items-center justify-between border-b border-sky-100/50 bg-gradient-to-r from-sky-50/50 to-white px-5 py-3.5">
                            <h5 className="text-[11px] font-bold uppercase tracking-widest text-sky-700">Grupo de Opciones {groupIdx + 1}</h5>
                            <button
                              type="button"
                              onClick={() => {
                                setProductDraft((current) => {
                                  const nextGroups = [...(current.optionGroups || [])];
                                  nextGroups.splice(groupIdx, 1);
                                  return { ...current, optionGroups: nextGroups };
                                });
                              }}
                              className="rounded-full bg-white p-1.5 text-neutral-400 shadow-sm ring-1 ring-black/5 transition hover:bg-rose-50 hover:text-rose-600"
                              title="Eliminar grupo"
                            >
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>
                          </div>
                          
                          <div className="p-5">
                            <div className="grid gap-4 sm:grid-cols-12">
                              <div className="sm:col-span-6">
                                <label className="grid gap-1.5 text-xs font-bold text-neutral-800">
                                  <span>Nombre (Ej: Elige tu salsa)</span>
                                  <input
                                    type="text"
                                    required
                                    value={group.name}
                                    onChange={(e) => {
                                      setProductDraft((current) => {
                                        const nextGroups = [...(current.optionGroups || [])];
                                        if (nextGroups[groupIdx]) {
                                          nextGroups[groupIdx] = { ...nextGroups[groupIdx], name: e.target.value };
                                        }
                                        return { ...current, optionGroups: nextGroups };
                                      });
                                    }}
                                    placeholder="Nombre del grupo..."
                                    className="w-full rounded-xl border border-sky-100/60 bg-sky-50/30 px-4 py-2.5 text-sm font-medium text-neutral-900 outline-none transition hover:bg-sky-50/60 focus:border-sky-400 focus:bg-white focus:ring-2 focus:ring-sky-400/20"
                                  />
                                </label>
                              </div>
                              <div className="sm:col-span-3">
                                <label className="grid gap-1.5 text-xs font-bold text-neutral-800">
                                  <span>Mínimo</span>
                                  <input
                                    type="number"
                                    min="0"
                                    value={group.minSelection}
                                    onChange={(e) => {
                                      setProductDraft((current) => {
                                        const nextGroups = [...(current.optionGroups || [])];
                                        if (nextGroups[groupIdx]) {
                                          nextGroups[groupIdx] = {
                                            ...nextGroups[groupIdx],
                                            minSelection: Math.max(0, parseInt(e.target.value) || 0)
                                          };
                                        }
                                        return { ...current, optionGroups: nextGroups };
                                      });
                                    }}
                                    className="w-full rounded-xl border border-sky-100/60 bg-sky-50/30 px-4 py-2.5 text-center text-sm font-medium text-neutral-900 outline-none transition hover:bg-sky-50/60 focus:border-sky-400 focus:bg-white focus:ring-2 focus:ring-sky-400/20"
                                  />
                                </label>
                              </div>
                              <div className="sm:col-span-3">
                                <label className="grid gap-1.5 text-xs font-bold text-neutral-800">
                                  <span>Máximo</span>
                                  <input
                                    type="number"
                                    min="1"
                                    value={group.maxSelection}
                                    onChange={(e) => {
                                      setProductDraft((current) => {
                                        const nextGroups = [...(current.optionGroups || [])];
                                        if (nextGroups[groupIdx]) {
                                          nextGroups[groupIdx] = {
                                            ...nextGroups[groupIdx],
                                            maxSelection: Math.max(1, parseInt(e.target.value) || 1)
                                          };
                                        }
                                        return { ...current, optionGroups: nextGroups };
                                      });
                                    }}
                                    className="w-full rounded-xl border border-sky-100/60 bg-sky-50/30 px-4 py-2.5 text-center text-sm font-medium text-neutral-900 outline-none transition hover:bg-sky-50/60 focus:border-sky-400 focus:bg-white focus:ring-2 focus:ring-sky-400/20"
                                  />
                                </label>
                              </div>
                            </div>

                            <div className="mt-5 rounded-2xl bg-sky-50/30 p-4 ring-1 ring-sky-100/60">
                              <div className="mb-3 flex items-center justify-between">
                                <span className="text-[11px] font-bold uppercase tracking-wider text-sky-800">Elementos elegibles</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setProductDraft((current) => {
                                      const nextGroups = [...(current.optionGroups || [])];
                                      if (nextGroups[groupIdx]) {
                                        nextGroups[groupIdx].options = [
                                          ...nextGroups[groupIdx].options,
                                          { name: '', price: 0 }
                                        ];
                                      }
                                      return { ...current, optionGroups: nextGroups };
                                    });
                                  }}
                                  className="flex items-center gap-1 text-xs font-bold text-sky-600 transition hover:text-sky-800"
                                >
                                  + Añadir Opción
                                </button>
                              </div>

                              <div className="space-y-2">
                                {group.options.map((opt, optIdx) => (
                                  <div key={optIdx} className="group/opt flex items-center gap-2">
                                    <input
                                      type="text"
                                      required
                                      value={opt.name}
                                      onChange={(e) => {
                                        setProductDraft((current) => {
                                          const nextGroups = [...(current.optionGroups || [])];
                                          if (nextGroups[groupIdx]?.options[optIdx]) {
                                            nextGroups[groupIdx].options[optIdx].name = e.target.value;
                                          }
                                          return { ...current, optionGroups: nextGroups };
                                        });
                                      }}
                                      placeholder={profile?.businessType === 'RESTAURANT' ? 'Ej: Extra Queso...' : 'Ej: Color Rojo...'}
                                      className="flex-1 rounded-xl border border-sky-100/50 bg-white px-3 py-2 text-sm font-medium text-neutral-900 shadow-[0_2px_8px_rgba(14,165,233,0.04)] outline-none transition hover:border-sky-200 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20"
                                    />
                                    <div className="relative w-28 shrink-0">
                                      <span className="absolute left-3 top-2.5 text-xs font-bold text-sky-400">$</span>
                                      <input
                                        type="number"
                                        min="0"
                                        step="any"
                                        required
                                        value={opt.price}
                                        onChange={(e) => {
                                          setProductDraft((current) => {
                                            const nextGroups = [...(current.optionGroups || [])];
                                            if (nextGroups[groupIdx]?.options[optIdx]) {
                                              nextGroups[groupIdx].options[optIdx].price = Math.max(0, parseFloat(e.target.value) || 0);
                                            }
                                            return { ...current, optionGroups: nextGroups };
                                          });
                                        }}
                                        placeholder="0.00"
                                        className="w-full rounded-xl border border-sky-100/50 bg-white pl-6 pr-3 py-2 text-right text-sm font-medium text-neutral-900 shadow-[0_2px_8px_rgba(14,165,233,0.04)] outline-none transition hover:border-sky-200 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20"
                                      />
                                    </div>
                                    {group.options.length > 1 && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setProductDraft((current) => {
                                            const nextGroups = [...(current.optionGroups || [])];
                                            if (nextGroups[groupIdx]) {
                                              nextGroups[groupIdx].options.splice(optIdx, 1);
                                            }
                                            return { ...current, optionGroups: nextGroups };
                                          });
                                        }}
                                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white text-neutral-400 shadow-sm ring-1 ring-black/5 transition hover:bg-rose-50 hover:text-rose-600 sm:opacity-0 sm:group-hover/opt:opacity-100"
                                      >
                                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </div>

            {/* Sticky Footer */}
            <div className="relative shrink-0 border-t border-sky-100/50 bg-white/70 px-6 py-5 backdrop-blur-xl sm:px-10">
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsProductModalOpen(false)}
                  className="rounded-full px-5 py-3 text-sm font-bold text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void (productDraft.id ? saveProductChanges() : createProduct())}
                  disabled={
                    creatingProduct ||
                    savingProductChanges ||
                    processingProductImage ||
                    !productDraft.categoryId ||
                    !productDraft.name.trim() ||
                    !productDraft.description.trim() ||
                    !productDraft.price.trim() ||
                    Boolean(getImageValidationMessage(productDraft.image.trim(), 'product'))
                  }
                  className="group relative overflow-hidden rounded-full bg-gradient-to-r from-sky-500 to-sky-400 px-6 py-3 text-sm font-bold text-white shadow-[0_4px_16px_rgba(14,165,233,0.35)] ring-1 ring-sky-400/50 transition-all hover:scale-105 disabled:pointer-events-none disabled:opacity-60 disabled:shadow-none disabled:grayscale"
                >
                  <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-1000 group-hover:translate-x-full" />
                  <span className="relative z-10">
                    {productDraft.id
                      ? savingProductChanges
                        ? 'Guardando...'
                        : 'Guardar Cambios'
                      : creatingProduct
                        ? 'Creando...'
                      : 'Publicar Producto'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {isLogoModalOpen ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 px-4 py-5">
          <div className="w-full max-w-[680px] rounded-[28px] bg-white p-5 shadow-[0_28px_90px_rgba(15,15,15,0.34)] sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">Imagen de perfil</p>
                <h3 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-neutral-950">
                  Editar logo del restaurante
                </h3>
                <p className="mt-2 text-sm leading-6 text-neutral-600">
                  Puedes pegar una URL o subir una imagen desde tu equipo. Al guardar, el logo se actualiza en tu tienda.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsLogoModalOpen(false);
                  setLogoValidationError('');
                  setLogoPreviewError(false);
                }}
                className="rounded-full border border-black/10 px-4 py-2 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-100"
              >
                Cerrar
              </button>
            </div>

            <div className="mt-6 grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
              <div className="flex items-center justify-center overflow-hidden rounded-[24px] border border-black/5 bg-neutral-50 p-8">
                {logoDraft.trim() && !logoPreviewError ? (
                  <div className="flex h-40 w-40 items-center justify-center overflow-hidden rounded-[36px] border-4 border-white bg-white shadow-[0_10px_24px_rgba(15,15,15,0.14)]">
                    <img
                      src={logoDraft}
                      alt="Vista previa del logo"
                      className="h-full w-full object-cover"
                      onLoad={() => setLogoPreviewError(false)}
                      onError={() => setLogoPreviewError(true)}
                    />
                  </div>
                ) : (
                  <div className="flex h-40 w-40 items-center justify-center rounded-[36px] border-4 border-white bg-[linear-gradient(135deg,#fcd34d_0%,#f97316_100%)] text-3xl font-semibold text-white shadow-[0_10px_24px_rgba(15,15,15,0.14)]">
                    {logoDraft.trim() ? '!' : buildRestaurantInitials(storeDraft.name || profile?.name || 'Tu tienda')}
                  </div>
                )}
              </div>

              <div className="grid gap-4">
                <Field
                  label="URL actual"
                  value={logoDraft}
                  onChange={(value) => {
                    setLogoDraft(value);
                    setLogoValidationError('');
                    setLogoPreviewError(false);
                  }}
                  placeholder="https://..."
                />

                {logoValidationError ? (
                  <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {logoValidationError}
                  </p>
                ) : null}

                <div className="rounded-[24px] border border-black/5 bg-neutral-50 p-4">
                  <p className="text-sm font-semibold text-neutral-950">Subir imagen</p>
                  <p className="mt-1 text-sm leading-6 text-neutral-500">
                    Selecciona una imagen cuadrada o centrada y la prepararemos para guardarla como logo.
                  </p>
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/*"
                    onChange={(event) => void handleLogoFileChange(event)}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => logoInputRef.current?.click()}
                    disabled={processingLogo}
                    className="mt-4 rounded-full border border-black/10 bg-white px-4 py-3 text-sm font-semibold text-neutral-800 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:bg-neutral-200"
                  >
                    {processingLogo ? 'Procesando imagen...' : 'Subir imagen'}
                  </button>
                </div>

                <div className="rounded-[24px] border border-black/5 bg-neutral-50 p-4 text-sm leading-6 text-neutral-500">
                  Recomendacion: usa una imagen clara, centrada y preferentemente cuadrada para que el logo se vea bien en todos los tamaños.
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => void saveLogo()}
                disabled={savingLogo || processingLogo || Boolean(getImageValidationMessage(logoDraft.trim(), 'logo'))}
                className="rounded-full bg-neutral-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
              >
                {savingLogo ? 'Guardando...' : 'Guardar logo'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {isCoverImageModalOpen ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 px-4 py-5">
          <div className="w-full max-w-[680px] rounded-[28px] bg-white p-5 shadow-[0_28px_90px_rgba(15,15,15,0.34)] sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">Portada</p>
                <h3 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-neutral-950">
                  Editar imagen de portada
                </h3>
                <p className="mt-2 text-sm leading-6 text-neutral-600">
                  Puedes pegar una URL o subir una imagen desde tu equipo. Al guardar, la portada se actualiza en tu tienda.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsCoverImageModalOpen(false);
                  setCoverImageValidationError('');
                  setCoverImagePreviewError(false);
                }}
                className="rounded-full border border-black/10 px-4 py-2 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-100"
              >
                Cerrar
              </button>
            </div>

            <div className="mt-6 grid gap-5 lg:grid-cols-[1.08fr_0.92fr]">
              <div className="overflow-hidden rounded-[24px] border border-black/5 bg-neutral-50">
                {coverImageDraft.trim() && !coverImagePreviewError ? (
                  <img
                    src={coverImageDraft}
                    alt="Vista previa de la portada"
                    className="h-[260px] w-full object-cover"
                    onLoad={() => setCoverImagePreviewError(false)}
                    onError={() => setCoverImagePreviewError(true)}
                  />
                ) : (
                  <div className="flex h-[260px] items-center justify-center bg-[linear-gradient(135deg,#fcd34d_0%,#f97316_100%)] text-center text-sm font-medium text-white/90">
                    {coverImageDraft.trim() ? 'No se pudo mostrar esa imagen' : 'Tu portada se verá aquí'}
                  </div>
                )}
              </div>

              <div className="grid gap-4">
                <Field
                  label="URL actual"
                  value={coverImageDraft}
                  onChange={(value) => {
                    setCoverImageDraft(value);
                    setCoverImageValidationError('');
                    setCoverImagePreviewError(false);
                  }}
                  placeholder="https://..."
                />

                {coverImageValidationError ? (
                  <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {coverImageValidationError}
                  </p>
                ) : null}

                <div className="rounded-[24px] border border-black/5 bg-neutral-50 p-4">
                  <p className="text-sm font-semibold text-neutral-950">Subir imagen</p>
                  <p className="mt-1 text-sm leading-6 text-neutral-500">
                    Selecciona una imagen y la prepararemos para guardarla como portada.
                  </p>
                  <input
                    ref={coverImageInputRef}
                    type="file"
                    accept="image/*"
                    onChange={(event) => void handleCoverImageFileChange(event)}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => coverImageInputRef.current?.click()}
                    disabled={processingCoverImage}
                    className="mt-4 rounded-full border border-black/10 bg-white px-4 py-3 text-sm font-semibold text-neutral-800 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:bg-neutral-200"
                  >
                    {processingCoverImage ? 'Procesando imagen...' : 'Subir imagen'}
                  </button>
                </div>

                <div className="rounded-[24px] border border-black/5 bg-neutral-50 p-4 text-sm leading-6 text-neutral-500">
                  Recomendacion: usa una imagen horizontal, ligera y bien iluminada para que se vea bien en web y movil.
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => void saveCoverImage()}
                disabled={
                  savingCoverImage ||
                  processingCoverImage ||
                  Boolean(getImageValidationMessage(coverImageDraft.trim(), 'cover'))
                }
                className="rounded-full bg-neutral-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
              >
                {savingCoverImage ? 'Guardando...' : 'Guardar portada'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {!isRestaurantSession ? (
        <div className="relative mx-auto flex h-dvh flex-col">
          <header className="sticky top-0 z-40 flex items-center justify-center border-b border-black/5 bg-white px-4 py-4">
            <SaDelLogo className="h-9 w-auto object-contain md:h-10" />
          </header>

          <section className="relative flex flex-1 flex-col overflow-hidden md:grid md:grid-cols-2">
            <div className="relative flex flex-1 flex-col justify-end">
              <img
                src={welcomeImage}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-black/10 md:bg-gradient-to-r md:from-black/70 md:via-black/40 md:to-transparent" />
              <div className="relative z-10 px-5 pb-6 md:px-10 md:pb-10">
                <span className="inline-flex rounded-full bg-sky-500 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-white">
                  SaDeL Business
                </span>
                <h1 className="mt-3 max-w-md text-xl font-bold leading-tight text-white md:text-3xl md:leading-tight">
                  Panel de administración
                </h1>
                <p className="mt-1 max-w-sm text-sm text-white/80">
                  Gestiona pedidos, menú y operación de tu negocio.
                </p>
              </div>
            </div>

            <div className="flex flex-1 items-center justify-center bg-[#fafafa] px-6 py-6 md:py-12 md:px-10">
              <div className="w-full max-w-sm text-center">
                <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-50 shadow-sm ring-1 ring-sky-200/50">
                  <svg className="h-7 w-7 text-sky-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
                  </svg>
                </div>
                <h2 className="text-2xl font-bold text-neutral-900 md:text-3xl">
                  Inicia sesión
                </h2>
                <p className="mt-2 text-sm text-neutral-500">
                  Accede con el teléfono y contraseña de tu restaurante.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setError('');
                    setAuthMessage('');
                    setIsLoginModalOpen(true);
                  }}
                  className="mt-8 w-full rounded-full bg-sky-500 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-sky-500/30 transition-all duration-300 hover:bg-sky-600 hover:shadow-xl hover:shadow-sky-500/40 active:scale-[0.98]"
                >
                  Iniciar sesión
                </button>
              </div>
            </div>
          </section>

          {isLoginModalOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6 backdrop-blur-sm">
              <div className="mx-auto w-full max-w-[400px] rounded-3xl bg-white p-6 shadow-2xl md:p-8">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xl font-bold text-neutral-900">
                      Iniciar sesión
                    </h3>
                    <p className="mt-1 text-sm text-neutral-500">
                      Ingresa tus datos para continuar.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsLoginModalOpen(false)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="mt-6 grid gap-4">
                  <Field
                    label="Teléfono"
                    value={phone}
                    onChange={setPhone}
                    placeholder="5512345678"
                  />
                  <Field
                    label="Contraseña"
                    value={password}
                    onChange={setPassword}
                    placeholder="••••••••"
                    type="password"
                  />

                  <details className="group">
                    <summary className="cursor-pointer text-xs font-semibold text-neutral-400 transition hover:text-neutral-600">
                      Configuración avanzada
                    </summary>
                    <div className="mt-3">
                      <Field
                        label="API base URL"
                        value={apiBase}
                        onChange={setApiBase}
                        placeholder="/api"
                      />
                    </div>
                  </details>

                  <button
                    type="button"
                    onClick={() => {
                      void loginWithPassword();
                    }}
                    disabled={verifyingCode || !phone.trim() || !password.trim()}
                    className="mt-2 w-full rounded-full bg-sky-500 px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-sky-500/30 transition-all duration-300 hover:bg-sky-600 hover:shadow-xl hover:shadow-sky-500/40 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:shadow-none"
                  >
                    {verifyingCode ? 'Ingresando...' : 'Iniciar sesión'}
                  </button>

                  {authMessage ? (
                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                      {authMessage}
                    </div>
                  ) : null}
                  {error ? (
                    <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                      {error}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="min-h-[100dvh] bg-[#f7f4ec]">
          <header className="sticky top-0 z-40 w-full border-b border-black/5 bg-white">
            <div className="grid grid-cols-[56px_1fr_56px] items-center px-3 py-4 md:px-6 lg:grid-cols-[220px_1fr_220px]">
              <div className="mx-auto w-full max-w-[1540px] contents">
                <div className="flex items-center">
                  <button
                    type="button"
                    onClick={() => setIsMobileNavOpen(true)}
                    className={`relative inline-flex h-11 w-11 items-center justify-center rounded-2xl border transition hover:bg-neutral-100 lg:hidden ${
                      activeSection !== 'orders' && activeOrders.length > 0
                        ? 'border-sky-200 bg-sky-50 text-sky-700 animate-heartbeat'
                        : 'border-black/10 bg-white text-neutral-800'
                    }`}
                    aria-label="Abrir menu"
                  >
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 7h16M4 12h16M4 17h16" />
                    </svg>
                    {activeSection !== 'orders' && activeOrders.length > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-sky-600 text-[10px] font-black text-white ring-2 ring-white shadow-sm">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75"></span>
                        <span className="relative z-10">{activeOrders.length}</span>
                      </span>
                    )}
                  </button>
                  <SaDelLogo className="hidden h-9 w-auto object-contain lg:block" />
                </div>
                <div className="px-3 text-center flex flex-col items-center gap-0">
                  <SaDelLogo className="h-4 w-auto object-contain lg:hidden" />
                  <p className="truncate text-lg font-semibold tracking-[-0.03em] text-neutral-950 md:text-2xl">
                    {restaurantName}
                  </p>
                </div>
                <div className="flex items-center justify-end">
                  <span className="hidden rounded-full bg-sky-100 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-sky-700 lg:inline-flex">
                    {businessTypeLabel(profile?.businessType)}
                  </span>
                </div>
              </div>
            </div>
          </header>

          <div className="flex min-h-[calc(100dvh-5rem)] w-full bg-transparent">
            <aside className="fixed left-0 top-[5rem] hidden h-[calc(100dvh-5rem)] w-[260px] border-r border-black/5 bg-white lg:flex lg:flex-col">
              <div className="flex-1 overflow-y-auto px-4 py-6">
                <div className="relative overflow-hidden rounded-[28px] border border-sky-200/60 bg-white p-4 shadow-[0_16px_45px_rgba(14,165,233,0.08)]">
                  <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-sky-300/80 via-cyan-200/70 to-transparent" />
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-600">Operacion</p>
                  <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-neutral-950">{restaurantName}</p>
                  <p className="mt-1 text-sm text-neutral-500">{operationalStatusLabel}</p>
                </div>

                <nav className="mt-6 grid gap-2">
                  {navigationItems.map((item) => {
                    const showOrderWarning = item.key === 'orders' && activeSection !== 'orders' && activeOrders.length > 0;
                    return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setActiveSection(item.key)}
                      className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition-all duration-300 ${
                        activeSection === item.key
                        ? 'bg-neutral-950 text-white'
                        : showOrderWarning
                        ? 'bg-sky-100 text-sky-900 animate-heartbeat shadow-sm'
                        : 'text-neutral-700 hover:bg-white'
                        }`}
                    >
                      <RestaurantNavIcon kind={item.key} />
                      <span className="flex-1">{item.label}</span>
                      {item.key === 'orders' && activeSection !== 'orders' && activeOrders.length > 0 && (
                        <span className="ml-auto flex items-center gap-1.5 shrink-0">
                          <span className="relative flex h-2 w-2">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75"></span>
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-600"></span>
                          </span>
                          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-black text-sky-700">
                            {activeOrders.length}
                          </span>
                        </span>
                      )}
                    </button>
                  );
                  })}
                </nav>
              </div>

              <div className="mt-auto border-t border-black/5 px-4 py-5">
                <div className="grid gap-2">
                  <button
                    type="button"
                    onClick={() => setShowHelpModal(true)}
                    className="flex items-center gap-3 rounded-2xl border border-black/10 bg-white px-4 py-3 text-left text-sm font-semibold text-neutral-700 transition hover:border-black/15 hover:bg-neutral-50"
                  >
                    <HelpCircleIcon />
                    Ayuda
                  </button>

                  {/* Dark Mode Toggle */}
                  <div className="flex items-center justify-between rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm font-semibold text-neutral-800">
                    <div className="flex items-center gap-3">
                      <svg className="h-5 w-5 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                      </svg>
                      Modo Oscuro
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isDarkMode}
                      onClick={() => {
                        const isDark = document.documentElement.classList.toggle('dark');
                        setIsDarkMode(isDark);
                        window.localStorage.setItem('darkMode', isDark ? 'true' : 'false');
                        triggerHaptic(10);
                      }}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${isDarkMode ? 'bg-sky-600' : 'bg-neutral-300'}`}
                    >
                      <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow-sm transition ${isDarkMode ? 'translate-x-4' : 'translate-x-1'}`} />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      const isBusinessOpen = profile?.isAcceptingOrders ?? false;
                      if (isBusinessOpen) {
                        setShowLogoutWarningModal(true);
                      } else {
                        clearSession('Sesion cerrada. Regresaste al login.');
                      }
                    }}
                    className="flex items-center gap-3 rounded-2xl border border-black/10 bg-white px-4 py-3 text-left text-sm font-semibold text-neutral-800 transition hover:border-black/15 hover:bg-neutral-50"
                  >
                    <OpenStorefrontIcon />
                    Cerrar sesion
                  </button>
                </div>
              </div>
            </aside>

            <div className="flex-1 bg-[#f8f8f8] lg:ml-[260px] min-w-0">
              <div className="p-4 md:p-6 max-w-full overflow-hidden">
                {(() => {
                  const overdueCount = billingSummary?.recentSettlements?.filter((s: any) => s.status === 'OVERDUE').length ?? 0;
                  const isSuspended = profile?.status === 'SUSPENDED';
                  if (!isSuspended && overdueCount === 0) return null;

                  return (
                    <div className={`mb-5 relative overflow-hidden rounded-[24px] border p-4 shadow-sm transition-all duration-300 ${
                      isSuspended
                        ? 'border-rose-200 bg-gradient-to-r from-rose-50 to-red-50 text-rose-900 shadow-[0_4px_20px_rgba(220,38,38,0.06)]'
                        : 'border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50/60 text-amber-900 shadow-[0_4px_20px_rgba(217,119,6,0.06)]'
                    }`}>
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex items-start gap-3">
                          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white ${
                            isSuspended
                              ? 'bg-rose-600 shadow-[0_4px_12px_rgba(225,29,72,0.3)] animate-pulse'
                              : 'bg-amber-600 shadow-[0_4px_12px_rgba(217,119,6,0.3)]'
                          }`}>
                            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                          </span>
                          <div>
                            <p className="text-sm font-bold">
                              {isSuspended ? 'Cuenta Suspendida' : 'Acción Requerida: Pago Pendiente Vencido'}
                            </p>
                            <p className="text-xs text-neutral-600 mt-1">
                              {isSuspended
                                ? 'Tu restaurante se encuentra inactivo para recibir pedidos debido a un corte de facturación vencido. Realiza la transferencia y sube tu comprobante para la reactivación automática.'
                                : 'Tienes uno o más cortes de facturación vencidos. Recuerda liquidar antes de las 23:59 del miércoles para evitar la suspensión automática de tu servicio.'}
                            </p>
                          </div>
                        </div>
                        {activeSection !== 'billing' && (
                          <button
                            type="button"
                            onClick={() => setActiveSection('billing')}
                            className={`shrink-0 rounded-full px-4 py-2 text-xs font-bold transition-all duration-200 ${
                              isSuspended
                                ? 'bg-rose-600 text-white hover:bg-rose-700 shadow-[0_4px_12px_rgba(225,29,72,0.2)] font-semibold'
                                : 'bg-amber-600 text-white hover:bg-amber-700 shadow-[0_4px_12px_rgba(217,119,6,0.2)] font-semibold'
                            }`}
                          >
                            Ir a Facturación
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })()}

                                {activeSection === 'dashboard' ? (
                  <DashboardSection
                    orders={orders}
                    profile={profile}
                    products={products}
                    drivers={drivers}
                    kitchenClockNow={kitchenClockNow}
                    sessionOpenedAt={sessionOpenedAt}
                    selectedWeekOffset={selectedWeekOffset}
                    dashboardChartView={dashboardChartView}
                    revenueMode={revenueMode}
                    isPrintingTicket={isPrintingTicket}
                    unreadMessagesMap={unreadMessagesMap}
                    updatingOperationalStatus={updatingOperationalStatus}
                    isBusinessOpen={isBusinessOpen}
                    isBusinessPaused={isBusinessPaused}
                    isWithinHours={isWithinHours}
                    operationalStatusLabel={operationalStatusLabel}
                    restaurantName={restaurantName}
                    onTogglePause={() => void togglePauseStatus()}
                    onToggleOperational={() => void toggleOperationalStatus()}
                    onSelectOrderForTicket={setSelectedOrderForTicket}
                    onSelectOrderForEtaExtension={setSelectedOrderForEtaExtension}
                    onSetActiveTicketTab={(tab: string) => setActiveTicketTab(tab as 'comanda' | 'chat')}
                    onPrintTicket={handlePrintTicket}
                    onSetDashboardChartView={setDashboardChartView}
                    onSetSelectedWeekOffset={setSelectedWeekOffset}
                    onSetRevenueMode={setRevenueMode}
                    onPushToast={(type, title, message) => pushToast(type, title, message ?? '')}
                    formatCurrency={formatCurrency}
                    formatDate={formatDate}
                    getPreparationRemainingMs={getPreparationRemainingMs}
                    isPreparationTimeUrgent={isPreparationTimeUrgent}
                    getRestaurantCollectionAmount={getRestaurantCollectionAmount}
                    getCustomerOrigin={getCustomerOrigin}
                    formatWeekday={formatWeekday}
                    formatCalendarDate={formatCalendarDate}
                    formatHourLabel={formatHourLabel}
                    Panel={Panel}
                  />
                ) : null}

                {activeSection === 'billing' ? (
                  <BillingSection
                    billingSummary={billingSummary}
                    profile={profile}
                    getCycleProgress={getCycleProgress}
                    formatTimeLeft={formatTimeLeft}
                    getSecondsUntilNextCutoff={getSecondsUntilNextCutoff}
                    getSecondsUntilNextSuspension={getSecondsUntilNextSuspension}
                    formatSettlementReference={formatSettlementReference}
                    setSelectedSettlementForDetails={setSelectedSettlementForDetails}
                    setIsDetailsModalOpen={setIsDetailsModalOpen}
                    fetchSettlementOrders={fetchSettlementOrders}
                    setSelectedSettlementForPay={setSelectedSettlementForPay}
                    setIsPayModalOpen={setIsPayModalOpen}
                    setIsCurrentPeriodDetailsOpen={setIsCurrentPeriodDetailsOpen}
                    fetchCurrentPeriodOrders={fetchCurrentPeriodOrders}
                    getDaysOverdue={getDaysOverdue}
                  />
                ) : null}

                {activeSection === 'featured' ? (
                  <FeaturedSection
                    featuredPackages={featuredPackages}
                    featuredRequests={featuredRequests}
                    featuredFlyerUploading={featuredFlyerUploading}
                    showPhonePreviewModal={showPhonePreviewModal}
                    setFeaturedDays={setFeaturedDays}
                    setFeaturedPaymentProof={setFeaturedPaymentProof}
                    setShowFeaturedModal={setShowFeaturedModal}
                    setProofPreviewUrl={setProofPreviewUrl}
                    setShowPhonePreviewModal={setShowPhonePreviewModal}
                    setFeaturedFlyerUploading={setFeaturedFlyerUploading}
                    profile={profile}
                    setProfile={setProfile}
                    token={token}
                    apiBase={apiBase}
                    pushToast={pushToast}
                  />
                ) : null}

                {activeSection === 'orders' ? (
                   <Panel title={profile?.businessType !== 'RESTAURANT' ? 'Pedidos' : 'Ordenes'} subtitle={profile?.businessType !== 'RESTAURANT' ? 'Vista rapida para surtido y despacho' : 'Vista rapida para cocina y despacho'} tone="violet">
                    {lastFailedAction ? (
                      <div className="mb-4 rounded-[28px] border border-rose-100 bg-rose-50 p-4">
                        <p className="text-sm font-semibold text-rose-800">Ultima accion fallida: {lastFailedAction.label}</p>
                        <p className="mt-1 text-sm text-rose-700">
                          Puedes reintentarlo sin recargar el tablero.
                        </p>
                        <button
                          type="button"
                          onClick={() => void retryLastFailedAction()}
                          disabled={Boolean(activeActionKey)}
                          className="mt-3 rounded-full bg-neutral-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
                        >
                          Reintentar ultima accion
                        </button>
                      </div>
                    ) : null}
                    <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                      <label className="grid gap-2 text-sm text-neutral-600 md:min-w-56">
                        <span className="font-medium text-neutral-800">Filtro por estado</span>
                        <select
                          value={selectedStatus}
                          onChange={(event) => setSelectedStatus(event.target.value as 'ACTIVE' | 'REJECTED' | 'CANCELLED' | 'DELIVERED' | 'COMPLETED')}
                          className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-neutral-950 outline-none transition focus:border-black/20"
                        >
                          {orderStatusOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <button
                        type="button"
                        onClick={() => void loadDashboard()}
                        disabled={loading || !sessionUser}
                        className="ml-auto flex items-center gap-2 rounded-full border border-neutral-300 bg-white px-3 py-2 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-50 md:ml-0 md:px-4 md:py-3 disabled:cursor-not-allowed disabled:bg-neutral-300"
                      >
                        <svg className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.582m0 0a8.001 8.001 0 01-15.356-2m15.356 2H15" />
                        </svg>
                        {loading ? 'Sincronizando...' : 'Actualizar'}
                      </button>
                      {selectedStatus !== 'ACTIVE' ? (
                        <button
                          type="button"
                          onClick={() => setSelectedStatus('ACTIVE')}
                          className="flex items-center gap-2 rounded-full bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-600 md:py-3"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          Ver órdenes activas
                        </button>
                      ) : null}
                    </div>
                    {visibleOrders.length > 0 ? (
                      <div className="space-y-4">
                        {visibleOrders.map((order) => {
                          const isHelper = order.restaurantId !== profile?.id;
                          const hasOwnDelivery = order.restaurant?.hasOwnDelivery ?? profile?.hasOwnDelivery ?? false;
                          const isSupported = order.notes?.includes('[ApoyoId:');
                          const actionButtons = isHelper
                            ? (order.status === 'READY' ? ['iniciarEntrega'] : order.status === 'IN_TRANSIT' ? ['delivered'] : [])
                            : (isSupported ? [] : getRestaurantActions(order, hasOwnDelivery));
                          const selectedDriverId = selectedDriverByOrder[order.id] || '';
                          const canAssignDriver =
                            hasOwnDelivery &&
                            !order.driver &&
                            assignableStatuses.includes(order.status) &&
                            drivers.length > 0;

                          return (
                            <article
                              key={order.id}
                              className={`rounded-xl border border-neutral-200 bg-white px-5 py-4 shadow-sm border-l-4 ${order.status === 'PENDING' ? 'border-l-amber-500' :
                                order.status === 'CONFIRMED' ? 'border-l-sky-500' :
                                  order.status === 'PREPARING' ? 'border-l-sky-500' :
                                    order.status === 'READY' ? 'border-l-emerald-500' :
                                      order.status === 'COMPLETED' ? 'border-l-teal-500' :
                                        order.status === 'DELIVERED' ? 'border-l-neutral-400' :
                                          order.status === 'REJECTED' || order.status === 'CANCELLED' ? 'border-l-rose-500' :
                                            'border-l-neutral-300'
                                }`}
                            >
                              {/* Fila 1: Cabecera */}
                              <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-3">
                                  <p className="text-lg font-bold text-neutral-950">
                                    {(order as any).dailyCounter ? `#${String((order as any).dailyCounter).padStart(2, '0')}` : (
                                      <>
                                        <span className="text-neutral-600 font-medium">{order.orderReference.slice(0, -6)}</span>
                                        {order.orderReference.slice(-6)}
                                      </>
                                    )}
                                  </p>
                                  {order.id.startsWith('mock-order-') && (
                                    <span className="rounded bg-sky-100 px-2 py-0.5 text-xs font-bold text-sky-800 animate-pulse">
                                      SIMULACIÓN
                                    </span>
                                  )}
                                  <StatusBadge status={order.status} />
                                  {(order as any).cancellationRequestedAt && !(order as any).cancelledBy && ['CONFIRMED', 'PREPARING'].includes(order.status) && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 border border-sky-300 px-2.5 py-0.5 text-xs font-bold text-sky-700 shadow-sm">
                                      🧾 Cancelación solicitada
                                    </span>
                                  )}
                                  {(order as any).cancelledBy === 'RESTAURANT' && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 border border-rose-300 px-2.5 py-0.5 text-xs font-bold text-rose-700 shadow-sm">
                                      Cancelado por ti
                                    </span>
                                  )}
                                  {unreadMessagesMap[order.id] > 0 && (
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); setSelectedOrderForTicket(order); setActiveTicketTab('chat'); }}
                                      className="inline-flex items-center gap-1 rounded-full bg-rose-500 px-2 py-0.5 text-xs font-black text-white animate-pulse shadow-sm shadow-rose-200 transition hover:bg-rose-600 active:scale-95"
                                    >
                                      💬 {unreadMessagesMap[order.id]} mensaje{unreadMessagesMap[order.id] > 1 ? 's' : ''} nuevo{unreadMessagesMap[order.id] > 1 ? 's' : ''}
                                    </button>
                                  )}
                                </div>
                                  <div className="flex items-center gap-2">
                                    {(() => {
                                      if (profile?.businessType === 'RESTAURANT') return null;
                                      if (!order.scheduledDeliveryAt) return null;
                                      return (
                                        <button
                                          type="button"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            setSelectedOrderForEtaExtension(order);
                                          }}
                                          className="text-xs text-neutral-500 font-medium flex items-center gap-1 bg-neutral-100/60 px-2 py-1 rounded-lg border border-black/5 shrink-0 hover:bg-neutral-200 transition active:scale-95"
                                        >
                                          📅 {formatDate(order.estimatedDeliveryTime || order.scheduledDeliveryAt || order.createdAt)}
                                        </button>
                                      );
                                    })()}
                                    {profile?.businessType !== 'RESTAURANT' && order.preparationTimeMinutes && order.preparationTimeMinutes > 1 && (order.status === 'CONFIRMED' || order.status === 'PREPARING') && (() => {
                                      const remainingMs = getPreparationRemainingMs(order, kitchenClockNow);
                                      if (remainingMs !== null && remainingMs <= 0) return null;
                                      return (
                                        <button
                                          type="button"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            setSelectedOrderForEtaExtension(order);
                                          }}
                                          className={`rounded-lg border px-3 py-1.5 shadow-sm transition active:scale-95 flex items-center justify-center ${
                                            isPreparationTimeUrgent(order, kitchenClockNow)
                                              ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 ring-2 ring-rose-200/50'
                                              : 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100'
                                          }`}
                                          title="Modificar tiempo de preparación"
                                        >
                                          <CountdownText order={order} className="font-black tabular-nums text-xs" />
                                        </button>
                                      );
                                    })()}
                                    {profile?.businessType === 'RESTAURANT' && (order.status === 'CONFIRMED' || order.status === 'PREPARING') && (() => {
                                      const remainingMs = getPreparationRemainingMs(order, kitchenClockNow);
                                      if (remainingMs !== null && remainingMs <= 0) return null;
                                      return (
                                        <button
                                          type="button"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            setSelectedOrderForEtaExtension(order);
                                          }}
                                          className={`rounded-lg border px-3 py-1.5 shadow-sm transition active:scale-95 flex items-center justify-center ${
                                            isPreparationTimeUrgent(order, kitchenClockNow)
                                              ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 ring-2 ring-rose-200/50'
                                              : 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100'
                                          }`}
                                          title="Modificar tiempo de preparación"
                                        >
                                          <CountdownText order={order} className="font-black tabular-nums text-xs" />
                                        </button>
                                      );
                                    })()}
                                  </div>
                                </div>
                                
                                {/* Fila 2: Cuerpo */}
                                <div className="grid gap-2 text-sm text-neutral-600 mb-4">
                                  <p className="flex items-center gap-2">
                                    <svg className="w-4 h-4 text-neutral-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                    </svg>
                                    {order.customer?.user?.name || 'Cliente SaDeL'}
                                  </p>
                                  <p className="flex items-center gap-2">
                                    {(order as any).fulfillmentType === 'PICKUP' ? (
                                      <>
                                        <svg className="w-4 h-4 text-emerald-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                                        </svg>
                                        <span className="font-semibold text-emerald-700">Recoger en sucursal</span>
                                      </>
                                    ) : (
                                      <>
                                        <svg className="w-4 h-4 text-neutral-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                        </svg>
                                        {formatAddress(order.address)}
                                      </>
                                    )}
                                  </p>
                                  {(order as any).fulfillmentType !== 'PICKUP' && (
                                  <div className="flex items-center gap-2">
                                    <svg className="w-4 h-4 text-neutral-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                    </svg>
                                    {order.driver?.user?.name && order.isAcceptedByDriver ? (
                                      <div className="relative">
                                        <button
                                          type="button"
                                          onClick={() => setDriverContactOpen(prev => ({ ...prev, [order.id]: !prev[order.id] }))}
                                          className="flex items-center gap-1.5 bg-neutral-100 dark:bg-zinc-800 rounded-full pr-3 pl-1 py-1 transition active:scale-[0.97]"
                                        >
                                          {order.driver.user.profilePhoto ? (
                                            <img src={order.driver.user.profilePhoto} alt={order.driver.user.name} className="w-5 h-5 rounded-full object-cover shadow-sm" />
                                          ) : (
                                            <div className="w-5 h-5 rounded-full bg-sky-100 dark:bg-sky-900 flex items-center justify-center text-[9px] font-bold text-sky-600 dark:text-sky-300">
                                              {order.driver.user.name.charAt(0).toUpperCase()}
                                            </div>
                                          )}
                                          <span className="font-semibold text-neutral-800 dark:text-zinc-200 text-xs">
                                            🛵 {order.driver.user.name}
                                          </span>
                                  {(order as any).fulfillmentType !== 'PICKUP' && driverArrivedOrders[order.id] && ['CONFIRMED', 'PREPARING', 'READY'].includes(order.status) && (
                                            <span className="text-[10px] font-bold text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400 ml-1 px-1.5 py-0.5 rounded-full">● En el restaurante</span>
                                          )}
                                        </button>
                                        {driverContactOpen[order.id] && order.driver.user.phone && (
                                          <div className="absolute top-full left-0 mt-1.5 z-50 flex gap-1.5">
                                            <a
                                              href={`tel:${order.driver.user.phone}`}
                                              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-neutral-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-bold shadow-lg transition active:scale-[0.95]"
                                            >
                                              <span>📞</span> Llamar
                                            </a>
                                            <a
                                              href={`https://wa.me/52${order.driver.user.phone.replace(/\D/g, '')}`}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold shadow-lg transition active:scale-[0.95]"
                                            >
                                              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" /></svg>
                                              WhatsApp
                                            </a>
                                          </div>
                                        )}
                                      </div>
                                    ) : order.driver?.user?.name && !order.isAcceptedByDriver ? (
                                      <span className="font-medium text-sky-600 bg-sky-50 px-2 py-0.5 rounded border border-sky-100/50">
                                        Asignado (Esperando confirmación)
                                      </span>
                                    ) : hasOwnDelivery ? (
                                      <span className="font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100/50">
                                        {order.status === 'DELIVERED'
                                          ? 'Entregado por el restaurante (Reparto propio)'
                                          : order.status === 'IN_TRANSIT'
                                            ? 'En camino (Reparto propio)'
                                            : 'Reparto propio (Sin asignar)'}
                                      </span>
                                    ) : (
                                      <span className="font-medium text-sky-600 bg-sky-50 px-2 py-0.5 rounded border border-sky-100/50">
                                        Sin repartidor asignado
                                      </span>
                                    )}
                                    {order.driver && !order.driverArrivedAt && !driverArrivedOrders[order.id] && !['PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'].includes(order.status) && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setUnassignConfirmOrderId(order.id);
                                        }}
                                        disabled={activeActionKey === `${order.id}:quitarRepartidor`}
                                        className="ml-2 text-xs font-semibold text-red-600 hover:text-red-500 disabled:text-neutral-400"
                                      >
                                        {activeActionKey === `${order.id}:quitarRepartidor` ? 'Quitando...' : '✖ Quitar'}
                                      </button>
                                    )}
                                    {order.batchId && order.deliverySequence && (
                                      <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-900/30 px-2 py-0.5 text-[9px] font-bold text-violet-700 dark:text-violet-400">
                                        📦 Lote #{(order.deliverySequence ?? 0) + 1}
                                      </span>
                                    )}
                                  </div>
                                )}

                                  {/* Vista previa de productos para cocineros */}
                                  {order.items && order.items.length > 0 && (
                                    <div
                                      onClick={() => setSelectedOrderForTicket(order)}
                                      className="mt-2.5 mb-3 rounded-xl bg-neutral-50/80 p-3 border border-black/5 cursor-pointer transition hover:bg-neutral-100/80"
                                    >
                                      <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-2 flex items-center gap-1">
                                        <span>{profile?.businessType !== 'RESTAURANT' ? '📦' : '🍳'}</span> {profile?.businessType !== 'RESTAURANT' ? 'Productos a surtir' : 'Productos a preparar'}
                                      </p>
                                      <div className="space-y-1.5">
                                        {order.items.map((item, idx) => (
                                          <div key={item.id || idx} className="flex justify-between items-center gap-2 text-xs">
                                            <span className="font-semibold text-neutral-800 truncate">
                                              {item.product?.name}
                                            </span>
                                            <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-black shrink-0 ${
                                              item.quantity > 1 ? 'bg-amber-500 text-white shadow-sm' : 'bg-neutral-200 text-neutral-700'
                                            }`}>
                                              x{item.quantity}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                {(() => {
                                  const isStore = profile?.businessType && profile.businessType !== 'RESTAURANT';
                                  const ms = getPreparationRemainingMs(order, kitchenClockNow);
                                  let isDelayed = false;
                                  let overdueMinutes = 0;
                                  if (order.scheduledDeliveryAt) {
                                    const scheduledMs = new Date(order.scheduledDeliveryAt).getTime() - kitchenClockNow;
                                    if (scheduledMs <= 0) {
                                      isDelayed = true;
                                      overdueMinutes = Math.max(1, Math.round(Math.abs(scheduledMs) / 60000));
                                    }
                                  } else {
                                    const safeMs = ms ?? 0;
                                    isDelayed = safeMs <= 0;
                                    overdueMinutes = isDelayed ? Math.max(1, Math.round(Math.abs(safeMs) / 60000)) : 0;
                                  }
                                  const validStatus = order.status === 'CONFIRMED' || order.status === 'PREPARING';
                                  if (validStatus && isDelayed) {
                                    return (
                                      <button
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setSelectedOrderForEtaExtension(order);
                                        }}
                                        className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl border border-rose-300 bg-rose-500 px-3 py-2.5 text-white shadow-[0_8px_20px_rgba(225,29,72,0.2)] animate-pulse transition hover:bg-rose-600 active:scale-95"
                                      >
                                        <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                        <div className="flex flex-col items-center">
                                          <span className="text-xs font-black uppercase tracking-wider text-center">Pedido rezagado</span>
                                          <span className="text-[10px] font-bold opacity-90">Atrasado {overdueMinutes} min · Toca para reprogramar</span>
                                        </div>
                                      </button>
                                    );
                                  }
                                  return null;
                                })()}

                                {(order as any).fulfillmentType !== 'PICKUP' && (order.status === 'CONFIRMED' || order.status === 'PREPARING') && !order.driver && !order.noDriversAvailable && !hasOwnDelivery && (
                  <div className="mt-2 flex items-center gap-2 rounded-xl border border-sky-100 bg-sky-50/70 px-3 py-2 text-xs font-semibold text-sky-800 shadow-sm animate-pulse w-fit">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500"></span>
                    </span>
                                    Asignando repartidor...
                                  </div>
                                )}

                                {(order as any).fulfillmentType !== 'PICKUP' && (order.status === 'CONFIRMED' || order.status === 'PREPARING') && !order.driver && order.noDriversAvailable && !hasOwnDelivery && (
                                  <div className="mt-2 flex flex-col gap-1 rounded-xl border border-rose-200 bg-rose-50/80 px-4 py-2.5 text-xs font-semibold text-rose-800 shadow-sm">
                                    <div className="flex items-center gap-2">
                                      <span className="relative flex h-2.5 w-2.5">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-600"></span>
                                      </span>
                                      <span>No hay repartidores disponibles en tu zona</span>
                                    </div>
                                    <span className="text-[10px] font-normal text-rose-600 leading-normal">
                                      Puedes asumir la entrega tú mismo o solicitar apoyo a la red de restaurantes cercanos.
                                    </span>
                                  </div>
                                )}
                                {parseStoreNotes(order.notes) ? (
                                  <div className="mt-2 rounded-[16px] border border-amber-100 bg-amber-50 px-4 py-2 text-sm text-amber-800">
                                    <span className="font-semibold">Nota:</span> {parseStoreNotes(order.notes)}
                                  </div>
                                ) : null}

                                {/* Pago en efectivo ya confirmado */}
                                {order.status === 'PICKED_UP' && order.paymentMethod === 'CASH' && (order as any).cashPaymentConfirmedAt && (
                                  <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                                    <span>✅</span> Pago en efectivo confirmado — repartidor habilitado para salir
                                  </div>
                                )}

                                {order.status === 'PENDING' && (
                                  <div
                                    className={`mt-3 overflow-hidden rounded-2xl border p-4 shadow-sm transition-all duration-300 ${order.paymentMethod === 'TRANSFER'
                                      ? 'border-sky-100 bg-gradient-to-br from-sky-50/70 to-blue-50/70 animate-float-gentle shadow-md shadow-sky-500/5'
                                      : 'border-black/5 bg-gradient-to-br from-neutral-50/50 to-white'
                                      }`}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {order.paymentMethod === 'TRANSFER' ? (
                                      <div className="flex flex-col gap-3">
                                        <div className="flex items-center justify-between gap-2">
                                          <div className="flex items-center gap-2">
                                            <span className="flex h-2.5 w-2.5 rounded-full bg-sky-600 animate-pulse" />
                                            <span className="text-xs font-bold uppercase tracking-wider text-sky-700 bg-sky-50 border border-sky-100 px-2 py-0.5 rounded-md">
                                              Pago por Transferencia
                                            </span>
                                          </div>
                                          <TransferCountdown createdAt={order.createdAt} />
                                        </div>
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white/60 backdrop-blur-md rounded-xl p-3 border border-white/80">
                                          <div className="flex flex-col">
                                            <span className="text-xs font-medium text-neutral-500">Estado de pago</span>
                                            <span className="text-sm font-bold text-neutral-800 flex items-center gap-1.5 mt-0.5">
                                              <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
                                              Por verificar en banca
                                            </span>
                                          </div>
                                          {order.paymentProofUrl ? (
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setZoomedImageUrl(order.paymentProofUrl || null);
                                              }}
                                              className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white px-4 py-2.5 text-xs font-bold shadow-md shadow-sky-600/10 hover:shadow-sky-600/20 transition active:scale-95 shrink-0"
                                            >
                                              <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                              </svg>
                                              Ver comprobante
                                            </button>
                                          ) : (
                                            <span className="text-xs font-semibold text-neutral-400 bg-neutral-100/80 px-3 py-2 rounded-xl border border-neutral-200/50">
                                              Sin comprobante
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    ) : ['CREDIT_CARD', 'DEBIT_CARD', 'DIGITAL_WALLET'].includes(order.paymentMethod || '') ? (
                                      <div className="flex flex-col gap-2">
                                        <div className="flex items-center gap-2">
                                          <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                                          <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-md">
                                            Pago en Línea Autorizado
                                          </span>
                                        </div>
                                        <p className="text-xs text-emerald-600 font-medium bg-emerald-50/50 rounded-xl p-3 border border-emerald-100/50">
                                          ✓ Transacción validada por pasarela de pago. No requiere comprobante físico.
                                        </p>
                                      </div>
                                    ) : null}
                                  </div>
                                )}
                              </div>

                              {/* Fila 3: Pie (Total y Botones) */}
                              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-neutral-100 pt-3">
                                <div>
                                  {(() => {
                                    if (isHelper) {
                                      return (
                                        <>
                                          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">Apoyo de entrega</p>
                                          <p className="text-xl font-bold text-neutral-950">{formatCurrency(order.deliveryFee)}</p>
                                        </>
                                      );
                                    }

                                    const foodAmount = order.totalAmount - order.deliveryFee;

                                    if (hasOwnDelivery && (order as any).fulfillmentType !== 'PICKUP') {
                                      return (
                                        <>
                                          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-600">
                                            {order.status === 'DELIVERED' ? 'Recibido (Envío propio)' : 'Total a recibir (Envío propio)'}
                                          </p>
                                          <p className="text-xl font-bold text-neutral-950">{formatCurrency(order.totalAmount)}</p>
                                        </>
                                      );
                                    }

                                    // Restaurant delivering themselves
                                    if (order.deliveredByRestaurant) {
                                      return (
                                        <>
                                          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-600">
                                            {order.status === 'DELIVERED' ? 'Cobrado (Entrega propia)' : 'Total a cobrar (Entrega propia)'}
                                          </p>
                                          <p className="text-xl font-bold text-neutral-950">{formatCurrency(order.totalAmount)}</p>
                                          {order.status !== 'DELIVERED' && (
                                            <p className="text-[10px] text-neutral-500">Tú realizas la entrega. El cliente paga el total.</p>
                                          )}
                                        </>
                                      );
                                    }

                                    // Platform delivery
                                    if ((order as any).fulfillmentType === 'PICKUP') {
                                      if (order.paymentMethod === 'TRANSFER') {
                                        return (
                                          <>
                                            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-sky-600">
                                              Recibido por transferencia
                                            </p>
                                            <p className="text-xl font-bold text-neutral-950">{formatCurrency(order.totalAmount)}</p>
                                            <p className="text-[10px] text-emerald-600 font-semibold flex items-center gap-1 mt-1">
                                              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                              El cliente recoge en sucursal
                                            </p>
                                          </>
                                        );
                                      }
                                      return (
                                        <>
                                          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-600">
                                            Total a recibir
                                          </p>
                                          <p className="text-xl font-bold text-neutral-950">{formatCurrency(order.totalAmount)}</p>
                                          <p className="text-[10px] text-emerald-600 font-semibold flex items-center gap-1 mt-1">
                                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                            El cliente recoge en sucursal
                                          </p>
                                        </>
                                      );
                                    }

                                    if (order.paymentMethod === 'CASH') {
                                      return (
                                        <>
                                          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-600">
                                            {order.status === 'DELIVERED' || order.cashPaymentConfirmedAt ? 'Cobrado al repartidor' : 'Cobrar al repartidor'}
                                          </p>
                                          <p className="text-xl font-bold text-neutral-950">{formatCurrency(foodAmount)}</p>
                                          {order.status !== 'DELIVERED' && !order.cashPaymentConfirmedAt && (
                                            <p className="text-[10px] text-neutral-500">El repartidor cobra el total al cliente.</p>
                                          )}
                                        </>
                                      );
                                    }

                                    if (order.paymentMethod === 'TRANSFER') {
                                      return (
                                        <>
                                          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-sky-600">
                                            Recibido por transferencia
                                          </p>
                                          <p className="text-xl font-bold text-neutral-950">{formatCurrency(order.totalAmount)}</p>
                                          {order.status !== 'DELIVERED' && !order.deliveredByRestaurant && (order as any).fulfillmentType !== 'PICKUP' && (
                                            <div className="mt-2 rounded-xl border border-dashed border-rose-200 bg-rose-50/60 px-3 py-2">
                                              <div className="flex items-center justify-between">
                                                <span className="text-[11px] font-semibold text-rose-600">👉 Pagar al repartidor</span>
                                                <span className="text-sm font-bold text-rose-700">{formatCurrency(order.deliveryFee)}</span>
                                              </div>
                                              <p className="text-[9px] text-rose-400 mt-0.5 leading-tight">Entregar en efectivo al repartidor al recoger el pedido</p>
                                            </div>
                                          )}
                                        </>
                                      );
                                    }

                                    // Fallback if paymentMethod is missing
                                    return (
                                      <>
                                        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">Total (Sin envío)</p>
                                        <p className="text-xl font-bold text-neutral-950">{formatCurrency(foodAmount)}</p>
                                      </>
                                    );
                                  })()}
                                </div>
                                <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 items-stretch sm:items-center justify-end min-w-0" onClick={(e) => e.stopPropagation()}>
                                  {order.status !== 'IN_TRANSIT' || (!hasOwnDelivery && !!order.driver) ? (
                                    <button
                                      type="button"
                                      onClick={() => setSelectedOrderForTicket(order)}
                                      className="w-full sm:w-auto justify-center rounded-full bg-gradient-to-r from-sky-600 to-blue-600 px-5 py-2.5 sm:py-2 text-sm font-semibold text-white shadow-sm hover:from-sky-500 hover:to-blue-500 transition flex items-center gap-2"
                                    >
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                                      </svg>
                                      Ver comanda
                                    </button>
                                  ) : null}

                                  {order.status === 'IN_TRANSIT' && (hasOwnDelivery || !order.driver) && (
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        try {
                                          const response = await fetch(`${apiBase}/restaurant-panel/pedidos/${order.id}/delivery-token`, {
                                            headers: {
                                              Authorization: `Bearer ${token}`,
                                            },
                                          });
                                          const res = await response.json();
                                          if (res.success && res.data) {
                                            setActiveQrCodeData({
                                              token: res.data.token,
                                              orderReference: res.data.orderReference,
                                              id: order.id,
                                            });
                                          } else {
                                            pushToast('error', 'Error', 'No se encontró un reparto activo para este pedido.');
                                          }
                                        } catch (err) {
                                          pushToast('error', 'Error de red', 'No se pudo conectar con el servidor.');
                                        }
                                      }}
                                      className="w-full sm:w-auto justify-center rounded-full bg-amber-500 px-5 py-2.5 sm:py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-600 transition flex items-center gap-2"
                                    >
                                      <span>🛵 Ver QR de reparto</span>
                                    </button>
                                  )}

                                  {/* Botones de Accion */}
                                  {actionButtons.length > 0 ? (
                                    <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                                      {actionButtons.map((actionKey) => {
                                        const action = restaurantActionMap[actionKey];
                                        const isBusy = activeActionKey === `${order.id}:${actionKey}`;
                                        const tone =
                                          actionKey === 'accept'
                                            ? 'primary'
                                            : actionKey === 'reject' || actionKey === 'cancel'
                                              ? 'danger'
                                              : actionKey === 'preparing'
                                                ? 'warning'
                                                : 'success';

                                        return (
                                          <ActionButton
                                            key={actionKey}
                                            onClick={() => {
                                              if (actionKey === 'accept') {
                                                openAcceptOrderPrompt(order.id);
                                              } else if (actionKey === 'handover') {
                                                setHandoverPromptOrderId(order.id);
                                              } else if (actionKey === 'delivered') {
                                                setEmergencyDeliveryOrderId(order.id);
                                              } else if (actionKey === 'reject' && order.paymentMethod === 'TRANSFER') {
                                                setTransferRefundOrder(order);
                                              } else if (actionKey === 'cancel') {
                                                const reason = window.prompt('Motivo de cancelación (mín. 10 caracteres):');
                                                if (reason && reason.trim().length >= 10) {
                                                  void runOrderAction(order.id, actionKey, { preserveFailedAction: true });
                                                  // Send cancel with reason via PATCH
                                                  requestJson({
                                                    apiBase,
                                                    path: `/restaurant-panel/pedidos/${order.id}/cancelar`,
                                                    token,
                                                    options: {
                                                      method: 'PATCH',
                                                      body: JSON.stringify({ reason: reason.trim() }),
                                                    },
                                                    fallbackMessage: 'No se pudo cancelar el pedido.',
                                                  }).then(() => {
                                                    loadOrdersOnly();
                                                    pushToast('success', 'Pedido cancelado', `Motivo: ${reason.trim()}`);
                                                  }).catch((err: any) => {
                                                    pushToast('error', 'Error', err?.message || 'No se pudo cancelar.');
                                                  });
                                                } else if (reason !== null) {
                                                  window.alert('El motivo debe tener al menos 10 caracteres.');
                                                }
                                              } else {
                                                void runOrderAction(order.id, actionKey);
                                              }
                                            }}
                                            disabled={isBusy}
                                            tone={tone}
                                          >
                                            {isBusy ? 'Procesando...' : action.label}
                                          </ActionButton>
                                        );
                                      })}
                                    </div>
                                  ) : null}

                                </div>
                              </div>

                              {/* Asignar Repartidor (Si aplica) */}
                              {canAssignDriver ? (
                                <div className="mt-3 grid gap-3 rounded-[24px] border border-emerald-100 bg-emerald-50 p-4 md:grid-cols-[1fr_auto] md:items-end" onClick={(e) => e.stopPropagation()}>
                                  <label className="grid gap-2 text-sm text-emerald-700">
                                    <span className="font-medium">Asignar repartidor</span>
                                    <select
                                      value={selectedDriverId}
                                      onChange={(event) =>
                                        setSelectedDriverByOrder((current) => ({
                                          ...current,
                                          [order.id]: event.target.value,
                                        }))
                                      }
                                      className="rounded-2xl border border-emerald-200 bg-white px-4 py-3 text-neutral-950 outline-none transition focus:border-emerald-300"
                                    >
                                      <option value="">
                                        Selecciona un repartidor disponible
                                      </option>
                                      {drivers.map((driver) => (
                                        <option key={driver.id} value={driver.id}>
                                          {driver.user?.name || 'Repartidor'} · {driver.user?.phone || 'Sin telefono'}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <button
                                    type="button"
                                    onClick={() => void assignDriver(order.id)}
                                    disabled={activeActionKey === `${order.id}:assign` || !selectedDriverId}
                                    className="rounded-full border border-sky-300 bg-sky-500 px-4 py-3 font-semibold text-white shadow-[0_12px_30px_rgba(14,165,233,0.22)] transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:border-black/5 disabled:bg-neutral-300 disabled:shadow-none"
                                  >
                                    {activeActionKey === `${order.id}:assign`
                                      ? 'Asignando...'
                                      : 'Asignar repartidor'}
                                  </button>
                                </div>
                              ) : null}

                              {/* Pickup: Confirmar recolección */}
                              {((order as any).fulfillmentType === 'PICKUP' && order.status === 'READY') ? (
                                <div className="flex flex-col sm:flex-row gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setPickupConfirmOrderId(order.id);
                                      setPickupConfirmPinInput('');
                                      setPickupConfirmError(null);
                                      setPickupConfirmAttemptsLeft(3);
                                    }}
                                    className="flex-1 rounded-xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(16,185,129,0.2)] transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-500"
                                  >
                                    ✅ Confirmar recolección
                                  </button>
                                </div>
                              ) : null}

                              {/* Boton de Emergencia: Asumir Reparto o Pedir Apoyo (solo delivery) */}
                              {((order as any).fulfillmentType !== 'PICKUP' && (order.status === 'READY' || ((order.status === 'CONFIRMED' || order.status === 'PREPARING') && order.noDriversAvailable)) && !order.driver) ? (
                                <div className="flex flex-col sm:flex-row gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    type="button"
                                    onClick={() => void runOrderAction(order.id, 'asumirReparto')}
                                    disabled={activeActionKey === `${order.id}:asumirReparto`}
                                    className="flex-1 rounded-xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(16,185,129,0.2)] transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-500"
                                  >
                                    {activeActionKey === `${order.id}:asumirReparto`
                                      ? 'Procesando...'
                                      : '🚴‍♂️ Ir a entregar'}
                                  </button>
                                  {!profile?.hasOwnDelivery && (
                                    <button
                                      type="button"
                                      onClick={() => void runOrderAction(order.id, 'solicitarApoyo')}
                                      disabled={activeActionKey === `${order.id}:solicitarApoyo`}
                                      className="flex-1 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-700 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400"
                                    >
                                      {activeActionKey === `${order.id}:solicitarApoyo`
                                        ? 'Enviando...'
                                        : '🤝 Pedir apoyo a red'}
                                    </button>
                                  )}
                                </div>
                              ) : null}
                            </article>
                          );
                        })}
                      </div>
                    ) : (
                      <>
                        {profile?.status === 'ACTIVE' && profile?.isAcceptingOrders ? (
                          <div className="flex flex-col items-center justify-center rounded-[32px] border border-emerald-100 bg-[radial-gradient(ellipse_at_top_right,rgba(240,253,244,0.7),rgba(255,255,255,0.8)_60%,rgba(248,250,252,0.6)_100%)] px-6 py-16 text-center shadow-[0_20px_60px_rgba(15,15,15,0.04)]">
                            <div className="relative mb-6 flex h-28 w-28 items-center justify-center rounded-full bg-emerald-100 shadow-[0_12px_30px_rgba(16,185,129,0.2)]">
                              <div className="absolute inset-0 animate-ping rounded-full border-[3px] border-emerald-400 opacity-30" style={{ animationDuration: '2s' }} />
                              <div className="absolute -inset-4 animate-[spin_6s_linear_infinite] rounded-full border-2 border-dashed border-emerald-200" />
                              <span className="relative z-10 text-5xl">👨‍🍳</span>
                            </div>
                            <h3 className="text-2xl font-bold tracking-tight text-neutral-900">
                              Abierto y listo
                            </h3>
                            <p className="mt-3 max-w-sm text-[15px] leading-relaxed text-neutral-500">
                              Tu restaurante está en línea y en condiciones de operar. El sistema de notificación en vivo está <strong className="text-emerald-700">activo</strong> y esperando pedidos.
                            </p>
                          </div>
                        ) : (
                          <EmptyState text="No hay pedidos en el estado filtrado o todavia no se han cargado." />
                        )}
                      </>
                    )}
                  </Panel>
                ) : null}

                {activeSection === 'store' && profile ? (
                    <div className="space-y-6">
                      <section className="overflow-hidden rounded-[32px] border border-black/5 bg-white shadow-[0_18px_60px_rgba(15,15,15,0.05)]">
                        <div className="relative">
                          {storeDraft.coverImage.trim() ? (
                            <img
                              src={storeDraft.coverImage}
                              alt={`Portada de ${storeDraft.name || 'tu tienda'}`}
                              className="h-64 w-full object-cover md:h-80 lg:h-96"
                            />
                          ) : (
                            <div className="h-64 w-full bg-gradient-to-br from-sky-400 via-sky-600 to-sky-900 md:h-80 lg:h-96" />
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                          <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4 md:p-6 lg:p-8">
                            <div className="flex items-center gap-2">
                              <div className="rounded-full bg-white/90 backdrop-blur-md px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest text-sky-900 shadow-sm border border-white/40 ring-1 ring-black/5">
                                Vista Previa: Tu Tienda
                              </div>
                              <button
                                type="button"
                                onClick={() => setShowMenuPreview(true)}
                                className="rounded-full bg-white/90 backdrop-blur-md px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest text-neutral-700 shadow-sm border border-white/40 ring-1 ring-black/5 transition hover:bg-white hover:text-sky-900"
                              >
                                📱 Menu en cliente
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={openCoverImageModal}
                              className="inline-flex items-center gap-2 rounded-full bg-white/92 px-4 py-2.5 text-sm font-semibold text-neutral-800 shadow-[0_10px_20px_rgba(15,15,15,0.12)] transition hover:bg-white"
                            >
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={1.9}
                                  d="M15.232 5.232l3.536 3.536M9 17l-4 1 1-4L15.5 4.5a2.121 2.121 0 013 3L9 17z"
                                />
                              </svg>
                              Editar portada
                            </button>
                          </div>
                          <div className="absolute inset-x-0 bottom-0 hidden p-6 md:p-8 lg:block">
                            <div className="flex items-end gap-6">
                              <div className="relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-[32px] border-4 border-white bg-white shadow-[0_16px_40px_rgba(0,0,0,0.2)] lg:h-28 lg:w-28">
                                {storeDraft.logo.trim() ? (
                                  <img
                                    src={storeDraft.logo}
                                    alt={`Logo de ${storeDraft.name || 'tu tienda'}`}
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <span className="text-3xl font-bold tracking-tight text-neutral-900">
                                    {buildRestaurantInitials(storeDraft.name || profile.name)}
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={openLogoModal}
                                  className="absolute bottom-1.5 right-1.5 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-sky-600 shadow-md transition hover:bg-white hover:text-sky-800 hover:scale-110"
                                  aria-label="Editar logo"
                                >
                                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M15.232 5.232l3.536 3.536M9 17l-4 1 1-4L15.5 4.5a2.121 2.121 0 013 3L9 17z"
                                    />
                                  </svg>
                                </button>
                              </div>
                              <div className="mb-2 text-white text-shadow-sm">
                                <h1 className="text-4xl font-bold tracking-tight">
                                  {storeDraft.name || 'Nombre de tu tienda'}
                                </h1>
                                <p className="mt-2 max-w-2xl text-[15px] font-medium leading-relaxed text-white/90">
                                  {storeDraft.description || 'Agrega una descripcion atractiva para tus clientes.'}
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="relative px-4 pb-5 pt-0 text-sm text-neutral-600 md:px-6 md:pb-6 lg:px-7 lg:pt-5">
                          <div className="-mt-12 flex flex-col items-center text-center lg:hidden relative z-10">
                            <div className="relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-[32px] border-4 border-white bg-white shadow-[0_12px_32px_rgba(0,0,0,0.12)]">
                              {storeDraft.logo.trim() ? (
                                <img
                                  src={storeDraft.logo}
                                  alt={`Logo de ${storeDraft.name || 'tu tienda'}`}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <span className="text-3xl font-bold tracking-tight text-neutral-900">
                                  {buildRestaurantInitials(storeDraft.name || profile.name)}
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={openLogoModal}
                                className="absolute bottom-1 right-1 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-sky-600 shadow-md transition hover:bg-white hover:text-sky-800 hover:scale-110"
                                aria-label="Editar logo"
                              >
                                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M15.232 5.232l3.536 3.536M9 17l-4 1 1-4L15.5 4.5a2.121 2.121 0 013 3L9 17z"
                                  />
                                </svg>
                              </button>
                            </div>
                            <p className="mt-4 text-3xl font-bold tracking-tight text-neutral-950">
                              {storeDraft.name || 'Nombre de tu tienda'}
                            </p>
                            <p className="mt-2 max-w-sm text-[15px] font-medium leading-relaxed text-neutral-500">
                              {storeDraft.description || 'Agrega una descripcion atractiva para tus clientes.'}
                            </p>
                          </div>

                          <div className="mt-5 flex flex-wrap justify-center gap-3 lg:mt-6 lg:justify-start">
                            <div className="group flex items-center gap-2 rounded-full bg-white/80 backdrop-blur-md px-4 py-2.5 text-[13px] font-medium text-neutral-700 shadow-sm ring-1 ring-black/5 transition hover:bg-white hover:shadow-md">
                              <svg className="h-4 w-4 text-sky-500 transition-transform group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.243-4.243a8 8 0 1111.314 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                              <span>
                                <span className="font-bold text-neutral-900">Direccion:</span>{' '}
                                {storeDraft.address || 'Agrega tu direccion principal'}
                              </span>
                            </div>

                            <div className="group flex items-center gap-2 rounded-full bg-white/80 backdrop-blur-md px-4 py-2.5 text-[13px] font-medium text-neutral-700 shadow-sm ring-1 ring-black/5 transition hover:bg-white hover:shadow-md">
                              <svg className="h-4 w-4 text-sky-500 transition-transform group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <span>
                                <span className="font-bold text-neutral-900">Entrega:</span>{' '}
                                {storeDraft.deliveryFee.trim()
                                  ? formatCurrency(Number(storeDraft.deliveryFee))
                                  : 'Sin costo'}
                              </span>
                            </div>

                            <div
                              className={`group flex items-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-bold shadow-sm ring-1 transition hover:shadow-md ${profile.status === 'ACTIVE' && profile.isAcceptingOrders
                                ? 'bg-emerald-50/80 text-emerald-700 ring-emerald-200/60 hover:bg-emerald-100'
                                : profile.status === 'SUSPENDED'
                                  ? 'bg-sky-50/80 text-sky-700 ring-sky-200/60 hover:bg-sky-100'
                                  : 'bg-neutral-100/80 text-neutral-500 ring-black/5 hover:bg-neutral-200'
                                }`}
                            >
                              <svg className={`h-4 w-4 transition-transform group-hover:scale-110 ${profile.status === 'ACTIVE' && profile.isAcceptingOrders ? 'text-emerald-500' : profile.status === 'SUSPENDED' ? 'text-amber-500' : 'text-neutral-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <span>
                                {getRestaurantOperationalStatusLabel(
                                  profile.status,
                                  profile.isAcceptingOrders
                                )}
                              </span>
                            </div>
                          </div>
                        </div>
                      </section>

                      <div className="-mx-1 overflow-x-auto px-1 pb-4 pt-2 sticky top-0 z-20 bg-gradient-to-b from-[#faf9f7] via-[#faf9f7]/95 to-transparent backdrop-blur-sm">
                        <div className="flex min-w-max gap-3 px-2">
                          {storeCategories.map((category) => (
                            <div
                              key={category.id}
                              className="group/cat flex items-center gap-2 rounded-full bg-white/80 backdrop-blur-md px-5 py-2.5 text-[13px] font-bold text-sky-900 shadow-sm border border-sky-100/60 ring-1 ring-black/5 transition-all hover:bg-white hover:shadow-md hover:scale-105"
                            >
                              <span>{category.name}</span>
                              <button
                                type="button"
                                onClick={() =>
                                  void deleteCategory(
                                    category.id,
                                    category.name,
                                    category.products.length
                                  )
                                }
                                disabled={
                                  Boolean(activeActionKey) || category.products.length > 0
                                }
                                className={`inline-flex h-7 w-7 items-center justify-center rounded-full border text-xs font-bold transition ${category.products.length > 0
                                  ? 'cursor-not-allowed border-black/5 bg-neutral-100 text-neutral-300'
                                  : 'border-black/10 bg-neutral-50 text-neutral-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600'
                                  } disabled:cursor-not-allowed`}
                                aria-label={`Eliminar categoria ${category.name}`}
                                title={
                                  category.products.length > 0
                                    ? 'No puedes borrarla mientras tenga productos.'
                                    : `Eliminar categoria ${category.name}`
                                }
                              >
                                ×
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() => setIsCategoryModalOpen(true)}
                            className="rounded-full border border-dashed border-sky-300 bg-sky-50/50 px-5 py-2.5 text-[13px] font-bold text-sky-700 shadow-sm transition hover:bg-sky-100 hover:border-sky-400"
                          >
                            + Agregar categoria
                          </button>
                        </div>
                      </div>

                      <div className="space-y-6">
                        {storeCategories.map((category) => (
                          <section key={category.id} className="rounded-[24px] px-0 py-0">
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
                              <div>
                                <div className="flex items-center gap-3">
                                  <h2 className="text-2xl font-semibold tracking-[-0.03em] text-neutral-950">
                                    {category.name}
                                  </h2>
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => void moveCategoryUp(category.id)}
                                      className="p-1.5 rounded-full hover:bg-neutral-100 text-neutral-500 hover:text-sky-600 transition"
                                      title="Subir categoría"
                                    >
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                                      </svg>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void moveCategoryDown(category.id)}
                                      className="p-1.5 rounded-full hover:bg-neutral-100 text-neutral-500 hover:text-sky-600 transition"
                                      title="Bajar categoría"
                                    >
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                      </svg>
                                    </button>
                                  </div>
                                </div>
                                <p className="mt-1 text-sm text-neutral-500">
                                  {category.products.length} productos en esta categoria
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  void deleteCategory(
                                    category.id,
                                    category.name,
                                    category.products.length
                                  )
                                }
                                disabled={
                                  Boolean(activeActionKey) || category.products.length > 0
                                }
                                className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${category.products.length > 0
                                  ? 'cursor-not-allowed border-black/5 bg-neutral-100 text-neutral-400'
                                  : 'border-black/10 bg-white text-neutral-700 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700'
                                  } disabled:cursor-not-allowed`}
                                title={
                                  category.products.length > 0
                                    ? 'Primero elimina o mueve sus productos.'
                                    : `Eliminar categoria ${category.name}`
                                }
                              >
                                {activeActionKey === `category:${category.id}:delete`
                                  ? 'Eliminando...'
                                  : 'Eliminar categoria'}
                              </button>
                            </div>

                            <div className="mt-5 grid gap-4 md:grid-cols-2">
                              {category.products.map((product) => (
                                <article
                                  key={product.id}
                                  className="group overflow-hidden rounded-[32px] border border-sky-100/50 bg-white/70 backdrop-blur-md shadow-[0_4px_20px_rgba(14,165,233,0.03)] ring-1 ring-black/5 transition-all hover:scale-[1.02] hover:bg-white hover:shadow-[0_12px_32px_rgba(14,165,233,0.12)] hover:ring-sky-200/60"
                                >
                                  <div className="flex h-full flex-col gap-0 sm:flex-row">
                                    <div className="relative h-48 w-full shrink-0 sm:h-auto sm:w-44 sm:aspect-square">
                                      {product.image ? (
                                        <>
                                          <div
                                            className="h-full w-full overflow-hidden"
                                            style={{ transform: `scale(${(product.imageZoom ?? 100) / 100})`, transformOrigin: 'center center' }}
                                          >
                                            <img
                                              src={(product.images?.length ?? 0) > 1 && carouselIndexMap[product.id] ? product.images![carouselIndexMap[product.id]] : product.image}
                                              alt={product.name}
                                              className="h-full w-full object-cover transition-opacity duration-300"
                                              style={{ objectPosition: product.imagePosition || undefined }}
                                              loading="lazy"
                                              decoding="async"
                                            />
                                          </div>
                                          {(product.images?.length ?? 0) > 1 && (
                                            <>
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setCarouselIndexMap((prev) => {
                                                    const images = product.images || [];
                                                    const current = prev[product.id] || 0;
                                                    return { ...prev, [product.id]: (current - 1 + images.length) % images.length };
                                                  });
                                                }}
                                                className="absolute left-2 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/80 text-sm text-neutral-800 shadow-md backdrop-blur-sm transition hover:bg-white"
                                              >
                                                ‹
                                              </button>
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setCarouselIndexMap((prev) => {
                                                    const images = product.images || [];
                                                    const current = prev[product.id] || 0;
                                                    return { ...prev, [product.id]: (current + 1) % images.length };
                                                  });
                                                }}
                                                className="absolute right-2 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/80 text-sm text-neutral-800 shadow-md backdrop-blur-sm transition hover:bg-white"
                                              >
                                                ›
                                              </button>
                                              <div className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 gap-1.5">
                                                {(product.images || []).map((_, idx) => (
                                                  <span
                                                    key={idx}
                                                    className={`h-1.5 rounded-full transition-all ${idx === (carouselIndexMap[product.id] || 0) ? 'w-4 bg-white' : 'w-1.5 bg-white/60'}`}
                                                  />
                                                ))}
                                              </div>
                                            </>
                                          )}
                                        </>
                                      ) : (
                                        <div className="h-full w-full bg-gradient-to-br from-neutral-100 to-neutral-200" />
                                      )}
                                    </div>

                                    <div className="flex flex-1 flex-col justify-between p-5 sm:p-6">
                                      <div>
                                        <div className="flex items-start justify-between gap-3">
                                          <h3 className="text-lg font-semibold text-neutral-950 flex items-center gap-2">
                                            {product.name}
                                            {product.isAdultOnly && (
                                              <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 tracking-wider">
                                                +18
                                              </span>
                                            )}
                                          </h3>
                                          <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-neutral-500">
                                            {product.preparationTime} min
                                          </span>
                                        </div>
                                        <p className="mt-2 text-sm leading-6 text-neutral-600">
                                          {product.description}
                                        </p>
                                        {product.discountPrice ? (
                                          <div className="mt-4 flex items-center gap-2">
                                            <p className="text-xl font-bold text-sky-600">
                                              {formatCurrency(product.discountPrice)}
                                            </p>
                                            <p className="text-sm font-medium text-neutral-400 line-through">
                                              {formatCurrency(product.price)}
                                            </p>
                                          </div>
                                        ) : (
                                          <p className="mt-4 text-xl font-semibold text-neutral-950">
                                            {formatCurrency(product.price)}
                                          </p>
                                        )}
                                      </div>

                                      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <button
                                            type="button"
                                            role="switch"
                                            aria-checked={product.isAvailable}
                                            onClick={() => void toggleProductAvailability(product)}
                                            disabled={activeAvailabilityProductId === product.id}
                                            className={`relative inline-flex h-11 w-[74px] items-center rounded-full border px-1 transition ${product.isAvailable
                                              ? 'border-emerald-300 bg-emerald-500'
                                              : 'border-neutral-300 bg-neutral-300'
                                              } disabled:cursor-not-allowed disabled:opacity-60`}
                                          >
                                            <span
                                              className={`inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-700 shadow-sm transition ${product.isAvailable ? 'translate-x-[28px]' : 'translate-x-0'
                                                }`}
                                            >
                                              {product.isAvailable ? 'On' : 'Off'}
                                            </span>
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => openEditProductModal(product)}
                                            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-black/10 bg-white text-neutral-800 transition hover:bg-neutral-100"
                                            aria-label={`Editar ${product.name}`}
                                          >
                                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                strokeWidth={1.9}
                                                d="M15.232 5.232l3.536 3.536M9 17l-4 1 1-4L15.5 4.5a2.121 2.121 0 013 3L9 17z"
                                              />
                                            </svg>
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => openDeleteProductModal(product)}
                                            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-rose-200 bg-rose-50 text-rose-600 transition hover:bg-rose-100"
                                            aria-label={`Eliminar ${product.name}`}
                                          >
                                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                strokeWidth={1.9}
                                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3m-7 0h8"
                                              />
                                            </svg>
                                          </button>
                                        </div>
                                        <span className="text-sm text-neutral-400">
                                          {activeAvailabilityProductId === product.id
                                            ? 'Actualizando disponibilidad...'
                                            : product.isAvailable
                                              ? 'Disponible y visible en cliente'
                                              : 'Agotado y oculto en cliente'}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                </article>
                              ))}

                              <button
                                type="button"
                                onClick={() => openProductModal(category.id)}
                                className="group flex min-h-[320px] flex-col items-center justify-center rounded-[32px] border-2 border-dashed border-sky-200/60 bg-sky-50/20 text-center shadow-sm transition-all hover:border-sky-400 hover:bg-sky-50/60 hover:shadow-[0_12px_32px_rgba(14,165,233,0.1)]"
                              >
                                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 to-sky-500 text-3xl font-light text-white shadow-lg shadow-sky-500/20 transition-transform duration-300 group-hover:scale-110">
                                  +
                                </span>
                                <p className="mt-5 text-lg font-semibold text-sky-900">Agregar producto</p>
                                <p className="mt-2 max-w-[18rem] text-[13px] leading-6 text-sky-700/70">
                                  Crea un nuevo producto dentro de <span className="font-bold">{category.name}</span> con imagen, descripcion y costo.
                                </p>
                              </button>
                            </div>
                          </section>
                        ))}

                        {storeCategories.length === 0 ? (
                          <EmptyState text="Todavia no tienes categorias. Crea la primera para empezar a publicar tu menu." />
                        ) : null}
                      </div>

                {showMenuPreview ? (
                  <div
                    className="fixed inset-0 z-[85] flex items-center justify-center bg-black/60 px-4 py-5 backdrop-blur-sm animate-fade-in"
                    onClick={() => setShowMenuPreview(false)}
                  >
                    <div
                      className="relative flex items-center justify-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => setShowMenuPreview(false)}
                        className="absolute -top-12 right-0 sm:right-auto sm:-top-12 sm:left-1/2 sm:-translate-x-1/2 flex items-center gap-1.5 rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-neutral-700 shadow-lg hover:bg-white hover:text-neutral-900 transition-all z-10"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        Cerrar vista previa
                      </button>
                      <div className="relative w-[340px] h-[620px] bg-neutral-900 rounded-[44px] p-3 shadow-2xl ring-1 ring-white/10 overflow-hidden">
                        <div className="absolute top-0 inset-x-0 h-6 flex justify-center z-20">
                          <div className="w-32 h-5.5 bg-neutral-900 rounded-b-2xl"></div>
                        </div>
                        <div className="relative w-full h-full bg-white rounded-[36px] overflow-hidden flex flex-col">
                          <div className="flex justify-between items-center px-5 pt-3 pb-0.5 text-[9px] font-bold text-neutral-900">
                            <span>9:41</span>
                            <div className="flex gap-1 items-center">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M15.67 4H14V2h-4v2H8.33C7.6 4 7 4.6 7 5.33v15.33C7 21.4 7.6 22 8.33 22h7.33c.74 0 1.34-.6 1.34-1.33V5.33C17 4.6 16.4 4 15.67 4z"/></svg>
                            </div>
                          </div>
                          <div className="px-3.5 py-1.5 border-b border-neutral-100">
                            <h1 className="text-sm font-black text-neutral-900">{storeDraft.name || profile.name}</h1>
                            <p className="text-[10px] text-neutral-500 mt-0.5">Menú</p>
                          </div>
                          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-4">
                            {storeCategories.length === 0 ? (
                              <div className="flex flex-col items-center justify-center h-full text-center">
                                <p className="text-xs text-neutral-400">Sin categorias disponibles</p>
                              </div>
                            ) : (
                              storeCategories.map((category) => (
                                <div key={category.id}>
                                  <h2 className="text-xs font-bold text-neutral-900 mb-2">{category.name}</h2>
                                  {category.products.length === 0 ? (
                                    <div className="flex items-center justify-center h-20 rounded-2xl border border-dashed border-neutral-200 bg-neutral-50">
                                      <p className="text-[10px] text-neutral-400">Sin productos</p>
                                    </div>
                                  ) : (
                                    <div className="space-y-2">
                                      {category.products.map((product) => (
                                        <article
                                          key={product.id}
                                          className="overflow-hidden rounded-2xl border border-black/[0.04] bg-white shadow-[0_1px_6px_rgba(0,0,0,0.02)]"
                                        >
                                          <div className="flex h-full gap-0">
                                            <div className="relative h-28 w-28 shrink-0">
                                              {product.image ? (
                                                <>
                                                  <div
                                                    className="h-full w-full overflow-hidden"
                                                    style={{ transform: `scale(${(product.imageZoom ?? 100) / 100})`, transformOrigin: 'center center' }}
                                                  >
                                                    <img
                                                      src={product.image}
                                                      alt={product.name}
                                                      className="h-full w-full object-contain transition-opacity duration-300"
                                                      style={{ objectPosition: product.imagePosition || undefined }}
                                                      loading="lazy"
                                                    />
                                                  </div>
                                                  {product.discountPrice ? (
                                                    <div className="absolute left-1 top-1 z-10 flex items-center gap-1 rounded-full bg-rose-500/90 px-2 py-0.5 text-[8px] font-bold text-white shadow-sm backdrop-blur-sm">
                                                      <span>-{Math.round((1 - product.discountPrice / product.price) * 100)}%</span>
                                                    </div>
                                                  ) : null}
                                                </>
                                              ) : (
                                                <div className="h-full w-full bg-gradient-to-br from-neutral-100 to-neutral-200" />
                                              )}
                                            </div>
                                            <div className="flex flex-1 flex-col justify-between p-3 min-w-0">
                                              <div>
                                                <h3 className="text-[11px] font-semibold text-neutral-950 break-words leading-tight">{product.name}</h3>
                                                <p className="mt-1 text-[9px] leading-relaxed text-neutral-500 break-words line-clamp-2">{product.description}</p>
                                                {product.discountPrice ? (
                                                  <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                                                    <span className="text-xs font-bold text-rose-600">{formatCurrency(product.discountPrice)}</span>
                                                    <span className="text-[9px] text-neutral-400 line-through">{formatCurrency(product.price)}</span>
                                                    <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[7px] font-bold text-rose-600">-{Math.round((1 - product.discountPrice / product.price) * 100)}%</span>
                                                  </div>
                                                ) : (
                                                  <p className="mt-1.5 text-xs font-semibold text-neutral-950">{formatCurrency(product.price)}</p>
                                                )}
                                              </div>
                                              <div className="mt-2 flex items-center justify-end">
                                                <div className="rounded-full bg-neutral-100 px-3 py-1 text-[8px] font-bold text-neutral-900">
                                                  Agregar
                                                </div>
                                              </div>
                                            </div>
                                          </div>
                                        </article>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))
                            )}
                          </div>
                          <div className="absolute bottom-1.5 inset-x-0 flex justify-center">
                            <div className="w-20 h-1 bg-black/15 rounded-full"></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                    </div>

                ) : null}

                {(activeSection === 'settings' || (activeSection === 'store' && !profile)) ? (
                  <SettingsSection
                    profile={profile}
                    setProfile={setProfile}
                    sessionUser={sessionUser}
                    storeDraft={storeDraft}
                    setStoreDraft={setStoreDraft}
                    platformCategories={platformCategories}
                    isSearchingAddress={isSearchingAddress}
                    addressSuggestions={addressSuggestions}
                    setAddressSuggestions={setAddressSuggestions}
                    placesServiceRef={placesServiceRef}
                    autocompleteSessionTokenRef={autocompleteSessionTokenRef}
                    ignoreAddressSearchRef={ignoreAddressSearchRef}
                    settingsMapRef={settingsMapRef}
                    settingsMarkerRef={settingsMarkerRef}
                    operatingHoursDraft={operatingHoursDraft}
                    setOperatingHoursDraft={setOperatingHoursDraft}
                    savingOperatingHours={savingOperatingHours}
                    transferBankName={transferBankName}
                    setTransferBankName={setTransferBankName}
                    transferAccountNumber={transferAccountNumber}
                    setTransferAccountNumber={setTransferAccountNumber}
                    transferBeneficiaryName={transferBeneficiaryName}
                    setTransferBeneficiaryName={setTransferBeneficiaryName}
                    currentPasswordDraft={currentPasswordDraft}
                    setCurrentPasswordDraft={setCurrentPasswordDraft}
                    newPasswordDraft={newPasswordDraft}
                    setNewPasswordDraft={setNewPasswordDraft}
                    confirmPasswordDraft={confirmPasswordDraft}
                    setConfirmPasswordDraft={setConfirmPasswordDraft}
                    savingPassword={savingPassword}
                    isOrderAlertSoundEnabled={isOrderAlertSoundEnabled}
                    orderAlertAudioState={orderAlertAudioState}
                    socketStatus={socketStatus}
                    socketStatusLabel={socketStatusLabel}
                    socketAttempts={socketAttempts}
                    token={token}
                    apiBase={apiBase}
                    activeSettingsTab={activeSettingsTab}
                    setActiveSettingsTab={setActiveSettingsTab}
                    settingsTabs={settingsTabs}
                    savingStoreProfile={savingStoreProfile}
                    saveStoreProfile={saveStoreProfile}
                    saveOperatingHours={saveOperatingHours}
                    savePasswordChange={savePasswordChange}
                    handleOrderAlertSoundToggle={handleOrderAlertSoundToggle}
                    playIncomingOrderAlert={playIncomingOrderAlert}
                    pushToast={pushToast}
                    businessTypeLabel={businessTypeLabel}
                    Field={Field}
                    TextAreaField={TextAreaField}
                    ToggleField={ToggleField}
                  />
                ) : null}
              </div>
            </div>
          </div>

            {selectedOrderForTicket ? (
              <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-3 py-4 sm:px-6"
              role="dialog"
              aria-modal="true"
              aria-labelledby="ticket-modal-title"
            >
              <div
                className="absolute inset-0"
                onClick={() => setSelectedOrderForTicket(null)}
                aria-hidden="true"
              />
              <div className="relative z-10 flex max-h-[92vh] w-full max-w-3xl lg:max-w-6xl flex-col overflow-hidden rounded-[24px] bg-white shadow-[0_32px_100px_rgba(15,15,15,0.28)] transition-all duration-300">
                <button
                  type="button"
                  onClick={() => setSelectedOrderForTicket(null)}
                  className="absolute top-4 right-4 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-neutral-900/80 text-white shadow-md transition hover:bg-neutral-900 active:scale-90"
                  aria-label="Cerrar comanda"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
                  </svg>
                </button>
                <div className="border-b-2 border-dashed border-neutral-200 px-5 py-4 sm:px-7 bg-neutral-50 shrink-0">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-neutral-500">
                          {profile?.businessType !== 'RESTAURANT' ? 'Detalle del Pedido' : 'Comanda de Cocina'}
                        </p>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={selectedOrderForTicket.status} />
                          {selectedOrderForTicket.id.startsWith('mock-order-') && (
                            <span className="inline-flex items-center gap-1 rounded bg-sky-100 px-2 py-0.5 text-xs font-black tracking-wide text-sky-800 animate-pulse">
                              ⚠️ MODO SIMULACIÓN
                            </span>
                          )}
                        </div>
                      </div>
                      <h3
                        id="ticket-modal-title"
                        className="mt-2 text-4xl font-bold tracking-[-0.04em] text-neutral-950"
                      >
                        {(selectedOrderForTicket as any).dailyCounter
                          ? `#${String((selectedOrderForTicket as any).dailyCounter).padStart(2, '0')}`
                          : selectedOrderForTicket.orderReference.slice(-6)}
                      </h3>
                      <p className="mt-1 text-sm text-neutral-500">
                        Ref: {selectedOrderForTicket.orderReference}
                      </p>
                        <div className="mt-3.5 inline-flex items-center gap-2.5 rounded-xl bg-sky-50/70 border border-sky-100 px-3 py-2 text-sm font-semibold text-sky-900 shadow-[0_4px_12px_rgba(14,165,233,0.04)]">
                          {selectedOrderForTicket.customer?.user?.profilePhoto ? (
                            <img 
                              src={selectedOrderForTicket.customer.user.profilePhoto} 
                              alt="Perfil del comensal" 
                              className="h-8 w-8 rounded-full object-cover border border-sky-200 shadow-sm"
                            />
                          ) : (
                            <span className="text-lg">👤</span>
                          )}
                          <div className="flex flex-col items-start leading-tight">
                            <span className="text-[9px] uppercase tracking-[0.12em] text-sky-500 font-bold">Comensal</span>
                            <span className="text-base font-bold text-neutral-950">
                              {selectedOrderForTicket.customer?.user?.name || 'Cliente SaDeL'}
                            </span>
                          </div>
                        </div>
                        </div>
                    <div className="flex items-center gap-2 sm:self-start">
                      {/* Botón de Cancelar dentro de la comanda */}
                      {['CONFIRMED', 'PREPARING'].includes(selectedOrderForTicket.status) && !(selectedOrderForTicket as any).cancellationRequestedAt && !(selectedOrderForTicket as any).cancelledBy && (
                        <button
                          type="button"
                          onClick={() => {
                            setCancelReason('');
                            setCancelConfirmOrder(selectedOrderForTicket);
                          }}
                          className="flex items-center gap-2 rounded-full bg-rose-500 hover:bg-rose-400 active:scale-95 text-white px-4 py-2.5 text-sm font-bold shadow-md shadow-rose-200/60 transition-all"
                        >
                          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
                          </svg>
                          <span className="hidden sm:inline">Cancelar</span>
                        </button>
                      )}
                      {profile?.enableTicketPrinting !== false && (
                        <button
                          type="button"
                          onClick={() => handlePrintTicket(selectedOrderForTicket)}
                          disabled={isPrintingTicket}
                          className="relative flex items-center gap-2 rounded-full bg-white border border-neutral-200 hover:bg-neutral-50 active:scale-95 text-neutral-900 px-4 py-2.5 text-sm font-bold shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                          </svg>
                          <span className="hidden sm:inline">{isPrintingTicket ? 'Imprimiendo...' : 'Imprimir'}</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>


                {/* Navegación por Pestañas (Visible solo en Móviles y Tablets para alternar entre comanda y chat) */}
                <div className="flex border-b border-neutral-200 bg-white px-5 sm:px-7 lg:hidden shrink-0">
                  <button
                    type="button"
                    onClick={() => setActiveTicketTab('comanda')}
                    className={`flex-1 py-3 text-center text-sm font-bold border-b-2 transition duration-200 flex items-center justify-center gap-2 ${
                      activeTicketTab === 'comanda'
                        ? 'border-sky-600 text-sky-600'
                        : 'border-transparent text-neutral-500 hover:text-neutral-800'
                    }`}
                  >
                    📋 {profile?.businessType !== 'RESTAURANT' ? 'Pedido' : 'Comanda'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTicketTab('chat')}
                    className={`flex-1 py-3 text-center text-sm font-bold border-b-2 transition duration-200 flex items-center justify-center gap-2 relative ${
                      activeTicketTab === 'chat'
                        ? 'border-emerald-600 text-emerald-600'
                        : 'border-transparent text-neutral-500 hover:text-neutral-800'
                    }`}
                  >
                    💬 Chat con Cliente
                    {chatMessages.length > 0 && (
                      <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
                    )}
                  </button>
                </div>

                {/* Contenedor Principal Split (Horizontal en desktop) */}
                <div className="flex flex-1 flex-col lg:flex-row overflow-hidden min-h-0">
                  
                  {/* LADO IZQUIERDO: Detalle de la Comanda */}
                  <div
                    className={`flex-1 flex flex-col min-h-0 overflow-hidden ${
                      activeTicketTab === 'comanda' ? 'flex' : 'hidden lg:flex'
                    } lg:border-r lg:border-neutral-200`}
                  >
                    <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
                      {/* Indicaciones Generales ARRIBA si existen */}
                      {parseStoreNotes(selectedOrderForTicket.notes) ? (
                        <div className="mb-6 rounded-xl border-l-4 border-l-amber-500 border border-amber-100 bg-amber-50 px-5 py-4 text-sm text-amber-900 shadow-sm">
                          <p className="font-bold text-xs uppercase tracking-[0.1em] text-amber-600 mb-1">⚠️ Indicaciones Generales</p>
                          <p className="text-base font-semibold">{parseStoreNotes(selectedOrderForTicket.notes)}</p>
                        </div>
                      ) : null}

                      {/* Flujo de Transferencia Bancaria — versión compacta */}
                      {selectedOrderForTicket.paymentMethod === 'TRANSFER' && (
                        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-sky-100 bg-sky-50/40 px-5 py-4">
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-100 text-sky-600">
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                              </svg>
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-sky-700">Transferencia</p>
                              <p className="text-[10px] text-sky-500 font-medium">
                                {selectedOrderForTicket.paymentStatus === 'COMPLETED' ? '✓ Pagado' : selectedOrderForTicket.paymentStatus === 'PENDING' ? '⏳ Pendiente' : '✗ Rechazado'}
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setPaymentDetailOrder(selectedOrderForTicket)}
                            className="ml-auto flex items-center gap-1.5 rounded-full border border-sky-200 bg-white px-3.5 py-2 text-xs font-bold text-sky-700 shadow-sm transition hover:bg-sky-50 hover:border-sky-300 active:scale-[0.97]"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                            Ver pago
                          </button>
                        </div>
                      )}

                      <div className="border-b border-dashed border-neutral-200 pb-3">
                        <div className="grid grid-cols-[48px_48px_minmax(0,1fr)] gap-4 text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-400">
                          <span className="text-center select-none">Cant.</span>
                          <span className="text-center select-none">Foto</span>
                          <span className="pl-1">Producto e indicaciones</span>
                        </div>
                      </div>

                      <div className="divide-y divide-neutral-100">
                        {selectedOrderForTicket.items && selectedOrderForTicket.items.length > 0 ? (
                          selectedOrderForTicket.items.map((item) => (
                            <div key={item.id} className="grid grid-cols-[48px_48px_minmax(0,1fr)] gap-4 py-5 items-start">
                              <div className={`flex h-12 w-12 items-center justify-center rounded-xl text-2xl font-black shrink-0 select-none ${
                                item.quantity > 1
                                  ? 'bg-amber-500 text-white shadow-sm shadow-amber-500/20'
                                  : 'bg-sky-50 text-sky-600'
                              }`}>
                                {item.quantity > 1 ? `x${item.quantity}` : '1'}
                              </div>

                              {item.product?.image ? (
                                <img
                                  src={item.product.image}
                                  alt={item.product.name}
                                  className="h-12 w-12 rounded-xl object-cover border border-black/5 shrink-0 shadow-sm"
                                  loading="lazy"
                                  decoding="async"
                                />
                              ) : (
                                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-neutral-50 border border-black/5 text-lg shadow-sm">
                                  🍽️
                                </div>
                              )}

                              <div className="min-w-0 pt-1">
                                <p className="text-lg font-bold leading-6 text-neutral-950">
                                  {item.product?.name || 'Producto'}
                                </p>
                                {item.sellBy === 'WEIGHT' && item.weightG ? (
                                  <p className="mt-1 text-sm font-semibold text-amber-600">
                                    {item.weightG >= 1000 ? `${item.weightG / 1000}kg` : `${item.weightG}g`}
                                  </p>
                                ) : null}
                                {item.options && item.options.length > 0 && (
                                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                                    {item.options.map((opt: any) => (
                                      <span
                                        key={opt.id}
                                        className="inline-flex items-center rounded-lg bg-sky-50 dark:bg-sky-950/40 border border-sky-100 dark:border-sky-900/30 px-2 py-0.5 text-xs font-bold text-sky-700 dark:text-sky-300"
                                      >
                                        ✦ {opt.name}
                                        {opt.price > 0 && (
                                          <span className="ml-1 text-[10px] font-extrabold text-sky-500">
                                            (+{formatCurrency(opt.price)})
                                          </span>
                                        )}
                                      </span>
                                    ))}
                                  </div>
                                )}
                                {item.specialInstructions ? (
                                  <div className="mt-2 rounded-lg border-l-4 border-l-rose-500 border border-rose-100 bg-rose-50 px-4 py-2 text-sm text-rose-800 font-bold">
                                    🚨 {item.specialInstructions}
                                  </div>
                                ) : (
                                  <p className="mt-1 text-sm leading-6 text-neutral-400">
                                    Sin especificaciones.
                                  </p>
                                )}
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="py-8 text-sm text-neutral-500 text-center">
                            Este pedido no incluye productos detallados.
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Ingreso neto sticky/bottom en su propia sección de comanda */}
                    <div className="border-t-2 border-dashed border-neutral-200 pt-4 bg-neutral-50 px-5 sm:px-7 pb-5 shrink-0">
                      <div className="flex items-end justify-between gap-4">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
                            Ingreso neto del pedido
                          </p>
                          <p className="mt-1 text-4xl font-bold tracking-[-0.04em] text-neutral-950">
                            {formatCurrency(getRestaurantCollectionAmount(selectedOrderForTicket, profile?.hasOwnDelivery))}
                          </p>
                        </div>
                        <div className="text-xs text-neutral-400 font-medium">
                          SaDeL Restaurant Portal
                        </div>
                      </div>
                    </div>
                    </div>

                    {/* Cancelación solicitada por el cliente — dentro de la comanda */}
                    {(selectedOrderForTicket as any).cancellationRequestedAt && !(selectedOrderForTicket as any).cancelledBy && ['CONFIRMED', 'PREPARING'].includes(selectedOrderForTicket.status) && (
                      <div className="border-t-2 border-dashed border-neutral-200 pt-4 px-5 sm:px-7 pb-5 shrink-0 bg-white">
                        <div className="flex flex-col gap-3">
                          <div className="flex items-center gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200/60 rounded-xl">
                            <span className="text-sm">🧾</span>
                            <p className="text-xs font-semibold text-amber-700">Cliente solicita cancelar</p>
                          </div>
                          <div className="flex flex-col gap-2">
                            <textarea
                              value={comandaCancelNote}
                              onChange={(e) => setComandaCancelNote(e.target.value)}
                              placeholder="Nota para el cliente (opcional)..."
                              rows={1}
                              className="w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm font-medium text-neutral-900 placeholder-neutral-400 outline-none focus:border-amber-300 focus:bg-white focus:ring-2 focus:ring-amber-200/50 transition resize-none"
                            />
                            <div className="flex gap-2">
                              <button
                                type="button"
                                disabled={selectedOrderForTicket.status === 'PREPARING'}
                                onClick={async () => {
                                  try {
                                    await requestJson({
                                      apiBase,
                                      path: `/restaurant-panel/pedidos/${selectedOrderForTicket.id}/responder-solicitud-cancelacion`,
                                      token,
                                      options: { method: 'POST', body: JSON.stringify({ approve: true, note: comandaCancelNote.trim() || undefined }) },
                                      fallbackMessage: 'Error al aprobar cancelación.',
                                    });
                                    pushToast('success', 'Cancelación aprobada', 'El cliente será notificado.');
                                    loadOrdersOnly();
                                  } catch (err: any) {
                                    pushToast('error', 'Error', err?.message || 'No se pudo procesar.');
                                  }
                                }}
                                className={`flex-1 rounded-full px-4 py-2 text-sm font-bold transition-colors active:scale-[0.97] ${selectedOrderForTicket.status === 'PREPARING' ? 'bg-neutral-200 text-neutral-400 cursor-not-allowed' : 'bg-emerald-500 hover:bg-emerald-600 text-white'}`}
                              >
                                Aprobar
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    await requestJson({
                                      apiBase,
                                      path: `/restaurant-panel/pedidos/${selectedOrderForTicket.id}/responder-solicitud-cancelacion`,
                                      token,
                                      options: { method: 'POST', body: JSON.stringify({ approve: false, note: comandaCancelNote.trim() || undefined }) },
                                      fallbackMessage: 'Error al rechazar cancelación.',
                                    });
                                    pushToast('info', 'Cancelación rechazada', 'El pedido continúa su curso.');
                                    loadOrdersOnly();
                                  } catch (err: any) {
                                    pushToast('error', 'Error', err?.message || 'No se pudo procesar.');
                                  }
                                }}
                                className="flex-1 rounded-full bg-neutral-100 hover:bg-neutral-200 border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-700 transition-colors active:scale-[0.97]"
                              >
                                Rechazar
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                  {/* LADO DERECHO: Chat en Tiempo Real */}
                  <div
                    className={`w-full lg:w-[420px] shrink-0 flex flex-col min-h-0 overflow-hidden ${
                      activeTicketTab === 'chat' ? 'flex' : 'hidden lg:flex'
                    } bg-neutral-50`}
                  >
                    {/* Encabezado del Chat */}
                    <div className="bg-white border-b border-neutral-200/80 px-4 py-3 flex items-center justify-between shrink-0 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
                      <div className="flex items-center gap-2">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                        <p className="text-xs font-bold uppercase tracking-wider text-neutral-600">
                          Chat con el Comensal
                        </p>
                      </div>
                      <span className="text-[10px] bg-neutral-100 border border-neutral-200 text-neutral-500 font-semibold px-2 py-0.5 rounded-full shadow-sm">
                        Canal Directo
                      </span>
                    </div>

                    {/* Lista de Mensajes */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[300px] flex flex-col">
                      {loadingChat ? (
                        <div className="flex flex-col items-center justify-center flex-1 py-12 space-y-3">
                          <svg className="animate-spin h-6 w-6 text-emerald-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          <p className="text-xs font-bold text-neutral-400 uppercase tracking-widest">Cargando conversación...</p>
                        </div>
                      ) : chatMessages.length === 0 ? (
                        <div className="flex flex-col items-center justify-center flex-1 py-12 px-6 text-center space-y-4">
                          <div className="h-16 w-16 bg-neutral-200/40 rounded-full flex items-center justify-center text-neutral-400 border border-neutral-200/30">
                            <svg className="h-8 w-8 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                            </svg>
                          </div>
                          <div>
                            <p className="text-sm font-bold text-neutral-700">Sin mensajes en esta orden</p>
                            <p className="mt-1.5 text-xs text-neutral-500 leading-relaxed">
                              Utiliza este canal directo para avisarle al cliente si algún platillo se agotó, si hay retrasos o para confirmar cualquier especificación de su pedido.
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {chatMessages.map((msg, idx) => {
                            const isMe = msg.senderRole === 'RESTAURANT';
                            const dateStr = msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                            
                            return (
                              <div key={msg.id || idx} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                                <div className="flex items-center gap-1.5 mb-1 px-1">
                                  <span className="text-[10px] font-bold text-neutral-400">
                                    {isMe ? `Tú (${businessTypeLabel(profile?.businessType)})` : msg.senderName || 'Comensal'}
                                  </span>
                                  <span className="text-[9px] text-neutral-400">•</span>
                                  <span className="text-[9px] text-neutral-400 font-medium">{dateStr}</span>
                                </div>
                                <div
                                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm font-semibold shadow-sm leading-relaxed ${
                                    isMe
                                      ? 'bg-emerald-600 text-white rounded-tr-none'
                                      : 'bg-white text-neutral-800 border border-neutral-200/60 rounded-tl-none'
                                  }`}
                                >
                                  {msg.content}
                                </div>
                              </div>
                            );
                          })}
                          <div ref={chatEndRef} />
                        </div>
                      )}
                    </div>

                    {/* Barra de Entrada del Chat */}
                    {['CONFIRMED', 'PREPARING', 'READY', 'IN_TRANSIT'].includes(selectedOrderForTicket.status) ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void sendChatMessage(selectedOrderForTicket.id);
                        }}
                        className="p-3 bg-white border-t border-neutral-200/80 flex items-center gap-2 shrink-0 shadow-[0_-1px_3px_rgba(0,0,0,0.02)]"
                      >
                        <input
                          type="text"
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          placeholder="Escribe un mensaje al comensal..."
                          disabled={sendingChatMessage}
                          className="flex-1 bg-neutral-50 border border-neutral-200 hover:border-neutral-300 focus:border-emerald-500 focus:bg-white text-sm font-semibold rounded-full px-4 py-2.5 outline-none transition disabled:opacity-70"
                        />
                        <button
                          type="submit"
                          disabled={!chatInput.trim() || sendingChatMessage}
                          className="h-10 w-10 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white rounded-full flex items-center justify-center transition disabled:opacity-50 disabled:scale-100 shadow-sm shrink-0"
                        >
                          {sendingChatMessage ? (
                            <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                          ) : (
                            <svg className="h-5 w-5 rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                            </svg>
                          )}
                        </button>
                      </form>
                    ) : (
                      <div className="p-4 bg-neutral-50 border-t border-neutral-200/80 shrink-0 text-center">
                        <div className="inline-flex items-center justify-center gap-2 bg-neutral-100 border border-neutral-200 text-neutral-500 text-xs font-semibold px-4 py-3 rounded-xl w-full shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)]">
                          <svg className="w-4 h-4 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                          </svg>
                          Chat bloqueado en este estado del pedido
                        </div>
                      </div>
                    )}
                  </div>

                </div>
              </div>
              </div>
            ) : null}

            {selectedOrderForEtaExtension ? (() => {
              const isStore = profile?.businessType && profile.businessType !== 'RESTAURANT';
              const remainingMs = getPreparationRemainingMs(selectedOrderForEtaExtension, kitchenClockNow);
              const isUrgent = isPreparationTimeUrgent(selectedOrderForEtaExtension, kitchenClockNow);
              const orderLabel = (selectedOrderForEtaExtension as any).dailyCounter
                ? `#${String((selectedOrderForEtaExtension as any).dailyCounter).padStart(2, '0')}`
                : selectedOrderForEtaExtension.orderReference.slice(-6);

              return (
                <div
                  className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 px-4 py-6 backdrop-blur-sm"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="extend-eta-title"
                >
                  <div
                    className="absolute inset-0"
                    onClick={() => setSelectedOrderForEtaExtension(null)}
                    aria-hidden="true"
                  />
                  <div className="relative z-10 w-full max-w-md rounded-[28px] bg-white p-5 shadow-[0_28px_90px_rgba(15,15,15,0.28)]">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.22em] text-neutral-400">{isStore ? 'Entrega programada' : 'Tiempo de preparación'}</p>
                        <h3 id="extend-eta-title" className="mt-1 text-2xl font-black tracking-[-0.04em] text-neutral-950">
                          {isStore ? `Reprogramar entrega ${orderLabel}` : `Agregar tiempo a ${orderLabel}`}
                        </h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedOrderForEtaExtension(null)}
                        className="rounded-full bg-neutral-100 px-3 py-2 text-xs font-bold text-neutral-600 transition hover:bg-neutral-200"
                      >
                        Cerrar
                      </button>
                    </div>

                    <div className={`mt-5 rounded-2xl border p-4 ${
                      isStore ? 'border-sky-200 bg-sky-50 text-sky-800' :
                      isUrgent
                        ? 'border-sky-200 bg-sky-50 text-sky-800'
                        : 'border-neutral-200 bg-neutral-50 text-neutral-700'
                    }`}>
                      {!isStore && (
                        <>
                          <p className="text-[11px] font-bold uppercase tracking-[0.18em] opacity-80">Cuenta regresiva actual</p>
                          <p className="mt-1 font-black tabular-nums text-3xl">
                            <CountdownText order={selectedOrderForEtaExtension} />
                          </p>
                          {typeof remainingMs === 'number' && remainingMs <= 2 * 60 * 1000 && remainingMs > 0 ? (
                            <p className="mt-2 text-xs font-bold">Está por agotarse el tiempo. Agrega minutos si cocina lo necesita.</p>
                          ) : null}
                        </>
                      )}
                      {isStore ? (
                        <div className="space-y-3">
                          <p className="text-xs font-semibold opacity-80">Entrega programada actual: {formatDate(selectedOrderForEtaExtension.estimatedDeliveryTime || selectedOrderForEtaExtension.createdAt)}</p>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-[10px] font-bold uppercase tracking-wider opacity-70">Nueva fecha</label>
                              <input
                                type="date"
                                value={rescheduleDate || (selectedOrderForEtaExtension.estimatedDeliveryTime ? new Date(selectedOrderForEtaExtension.estimatedDeliveryTime).toISOString().split('T')[0] : '')}
                                onChange={(e) => setRescheduleDate(e.target.value)}
                                className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm font-semibold text-neutral-900 outline-none transition focus:border-black/20"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-bold uppercase tracking-wider opacity-70">Nueva hora</label>
                              <input
                                type="time"
                                value={rescheduleTime || (selectedOrderForEtaExtension.estimatedDeliveryTime ? new Date(selectedOrderForEtaExtension.estimatedDeliveryTime).toTimeString().slice(0, 5) : '')}
                                onChange={(e) => setRescheduleTime(e.target.value)}
                                className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm font-semibold text-neutral-900 outline-none transition focus:border-black/20"
                              />
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={activeActionKey === `${selectedOrderForEtaExtension.id}:reprogram`}
                            onClick={async () => {
                              const defaultDate = selectedOrderForEtaExtension.estimatedDeliveryTime ? new Date(selectedOrderForEtaExtension.estimatedDeliveryTime).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
                              const defaultTime = selectedOrderForEtaExtension.estimatedDeliveryTime ? new Date(selectedOrderForEtaExtension.estimatedDeliveryTime).toTimeString().slice(0, 5) : new Date().toTimeString().slice(0, 5);
                              const dateStr = rescheduleDate || defaultDate;
                              const timeStr = rescheduleTime || defaultTime;
                              const newDateTime = new Date(`${dateStr}T${timeStr}`);
                              const currentEta = selectedOrderForEtaExtension.estimatedDeliveryTime ? new Date(selectedOrderForEtaExtension.estimatedDeliveryTime).getTime() : Date.now();
                              if (Math.abs(newDateTime.getTime() - currentEta) < 60000) {
                                setSelectedOrderForEtaExtension(null);
                                return;
                              }
                              setActiveActionKey(`${selectedOrderForEtaExtension.id}:reprogram`);
                              try {
                                await requestJson({
                                  apiBase,
                                  path: `/restaurant-panel/pedidos/${selectedOrderForEtaExtension.id}/reprogramar-entrega`,
                                  token,
                                  options: {
                                    method: 'POST',
                                    body: JSON.stringify({ estimatedDeliveryAt: newDateTime.toISOString() }),
                                  },
                                  fallbackMessage: 'No se pudo reprogramar la entrega.',
                                });
                                await loadOrdersOnly();
                                pushToast('success', 'Entrega reprogramada', `Nueva entrega programada para ${newDateTime.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}.`);
                                setRescheduleDate('');
                                setRescheduleTime('');
                                setSelectedOrderForEtaExtension(null);
                              } catch (err) {
                                const message = getRequestErrorMessage(err, 'No se pudo reprogramar la entrega.');
                                pushToast('error', 'Error al reprogramar', message);
                              } finally {
                                setActiveActionKey(null);
                              }
                            }}
                            className="w-full rounded-2xl border border-sky-200 bg-sky-600 px-4 py-3 text-center text-sm font-bold text-white shadow-sm transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500"
                          >
                            Reprogramar entrega
                          </button>
                        </div>
                      ) : (
                        <p className="mt-2 text-xs font-semibold opacity-80">
                          ETA cliente: {formatShortTime(selectedOrderForEtaExtension.estimatedDeliveryTime)}
                          {selectedOrderForEtaExtension.etaExtendedMinutes ? ` · +${selectedOrderForEtaExtension.etaExtendedMinutes} min acumulados` : ''}
                        </p>
                      )}
                    </div>

                    <div className="mt-5 grid grid-cols-4 gap-2">
                      {[5, 10, 15, 20].map((minutes) => (
                        <button
                          key={minutes}
                          type="button"
                          disabled={activeActionKey === `${selectedOrderForEtaExtension.id}:extend-${minutes}`}
                          onClick={async () => {
                            const updated = await extendPreparationTime(selectedOrderForEtaExtension.id, minutes);
                            if (updated) {
                              setRescheduleDate('');
                              setRescheduleTime('');
                              setSelectedOrderForEtaExtension(null);
                            }
                          }}
                          className="rounded-2xl border border-black/5 bg-neutral-800 px-3 py-3 text-center text-sm font-bold text-white shadow-sm transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500"
                        >
                          +{minutes}
                        </button>
                      ))}
                    </div>

                    <p className="mt-4 text-xs leading-5 text-neutral-500">
                      El cliente verá la nueva hora estimada y se registrará el ajuste en el seguimiento del pedido.
                    </p>
                  </div>
                </div>
              );
            })() : null}

            {/* Modal de Zoom de Comprobante de Transferencia */}
          {zoomedImageUrl ? (
            <div
              className="fixed inset-0 z-[90] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm animate-fade-in"
              role="dialog"
              aria-modal="true"
            >
              <div
                className="absolute inset-0 cursor-zoom-out"
                onClick={() => setZoomedImageUrl(null)}
                aria-hidden="true"
              />
              <div className="relative max-h-[100dvh] max-w-full overflow-auto p-4 flex flex-col items-center justify-center">
                <button
                  type="button"
                  onClick={() => setZoomedImageUrl(null)}
                  className="absolute top-4 right-4 z-10 rounded-full bg-white/10 p-3 text-white backdrop-blur-md transition hover:bg-white/20 hover:scale-105 active:scale-95 shadow-lg"
                  aria-label="Cerrar vista"
                >
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
                <img
                  src={zoomedImageUrl}
                  alt="Comprobante en Pantalla Completa"
                  className="max-h-[85vh] max-w-[90vw] rounded-2xl object-contain shadow-[0_25px_60px_-15px_rgba(0,0,0,0.7)] transition duration-300"
                />
                <p className="mt-4 text-sm font-semibold tracking-wider text-neutral-400 animate-pulse">
                  Haz clic fuera de la imagen para cerrar
                </p>
              </div>
            </div>
          ) : null}

          {/* Modal de Detalle de Pago (Transferencia) */}
          {paymentDetailOrder ? (
            <div
              className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 px-4 py-5 backdrop-blur-sm animate-fade-in"
              role="dialog"
              aria-modal="true"
            >
              <div className="absolute inset-0" onClick={() => setPaymentDetailOrder(null)} aria-hidden="true" />
              <div className="relative w-full max-w-md overflow-hidden rounded-[28px] bg-white shadow-[0_32px_110px_rgba(15,15,15,0.35)] animate-scale-up">
                <div className="flex items-center justify-between border-b border-neutral-100 px-6 py-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400">Detalle del Pago</p>
                    <p className="text-lg font-black text-neutral-900 mt-0.5">#{paymentDetailOrder.orderReference.substring(0, 8)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPaymentDetailOrder(null)}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 text-sm font-black text-neutral-500 transition hover:bg-neutral-200 active:scale-90"
                  >
                    ✕
                  </button>
                </div>

                <div className="px-6 py-5 space-y-5">
                  {/* Estado */}
                  <div className="flex items-center justify-between rounded-2xl bg-neutral-50 px-4 py-3 border border-neutral-100">
                    <span className="text-sm font-semibold text-neutral-600">Estado del pago</span>
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${
                      paymentDetailOrder.paymentStatus === 'COMPLETED'
                        ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20'
                        : paymentDetailOrder.paymentStatus === 'PENDING'
                        ? 'bg-sky-50 text-sky-700 ring-1 ring-sky-600/20'
                        : 'bg-rose-50 text-rose-700 ring-1 ring-rose-600/20'
                    }`}>
                      {paymentDetailOrder.paymentStatus === 'COMPLETED' ? '✓ Aprobado' : paymentDetailOrder.paymentStatus === 'PENDING' ? '⏳ Pendiente' : '✗ Rechazado'}
                    </span>
                  </div>

                  {/* Datos bancarios */}
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-400 mb-3">Cuenta receptora</p>
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between rounded-xl border border-neutral-100 bg-white px-4 py-3">
                        <span className="text-xs font-semibold text-neutral-500">Banco</span>
                        <span className="text-sm font-bold text-neutral-900">{profile?.transferBankName || 'No configurado'}</span>
                      </div>
                      <div className="flex items-center justify-between rounded-xl border border-neutral-100 bg-white px-4 py-3">
                        <span className="text-xs font-semibold text-neutral-500">Cuenta / CLABE</span>
                        <span className="text-sm font-bold font-mono text-neutral-900 tracking-wider">{profile?.transferAccountNumber || 'No configurado'}</span>
                      </div>
                      <div className="flex items-center justify-between rounded-xl border border-neutral-100 bg-white px-4 py-3">
                        <span className="text-xs font-semibold text-neutral-500">Beneficiario</span>
                        <span className="text-sm font-bold text-neutral-900">{profile?.transferBeneficiaryName || 'No configurado'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Comprobante */}
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-400 mb-3">Comprobante de pago</p>
                    {paymentDetailOrder.paymentProofUrl ? (
                      <div
                        onClick={() => setZoomedImageUrl(paymentDetailOrder.paymentProofUrl || null)}
                        className="group relative cursor-pointer overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50 shadow-sm transition hover:shadow-md"
                      >
                        <img
                          src={paymentDetailOrder.paymentProofUrl}
                          alt="Comprobante de Transferencia"
                          className="w-full h-48 object-contain bg-white p-2"
                        />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition duration-300 group-hover:opacity-100">
                          <div className="rounded-full bg-white/20 p-3 backdrop-blur-sm">
                            <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" />
                            </svg>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-neutral-200 bg-neutral-50 px-4 py-8 text-center">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 text-neutral-400 mb-3">
                          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </div>
                        <p className="text-sm font-semibold text-neutral-500">Sin comprobante adjunto</p>
                        <p className="text-xs text-neutral-400 mt-1">El cliente no ha subido un comprobante de pago.</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="border-t border-neutral-100 px-6 py-4">
                  <button
                    type="button"
                    onClick={() => setPaymentDetailOrder(null)}
                    className="w-full rounded-full bg-neutral-900 py-3 text-sm font-bold text-white transition hover:bg-neutral-800 active:scale-[0.98]"
                  >
                    Cerrar
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {/* Modal de Confirmación de Revisión de Cuenta para Transferencias */}
          {transferConfirmationOrder ? (
            <div
              className="fixed inset-0 z-[85] flex items-center justify-center bg-black/60 px-4 py-5 backdrop-blur-sm animate-fade-in"
              role="dialog"
              aria-modal="true"
            >
              <div
                className="absolute inset-0"
                onClick={() => setTransferConfirmationOrder(null)}
                aria-hidden="true"
              />
              <div className="relative w-full max-w-[500px] overflow-hidden rounded-[28px] bg-white p-6 shadow-[0_32px_110px_rgba(15,15,15,0.35)] border border-black/5 animate-scale-up">
                <div className="text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-amber-600 mb-4 border border-amber-100 animate-pulse">
                    <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-bold text-neutral-950 tracking-tight">
                    ¿Ya revisaste tu cuenta bancaria?
                  </h3>
                  <p className="mt-3 text-sm text-neutral-600 leading-relaxed">
                    Estás por aceptar el pedido <strong className="text-neutral-950 font-semibold">{transferConfirmationOrder.orderReference}</strong> por un total de <strong className="text-sky-600 font-bold">{formatCurrency(transferConfirmationOrder.collectionAmount)}</strong>.
                  </p>

                  <div className="mt-5 rounded-2xl bg-amber-50/70 p-4 border border-amber-100/60 text-left">
                    <div className="flex gap-2">
                      <svg className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p className="text-xs text-amber-800 leading-relaxed font-semibold">
                        Asegúrate de que la transferencia se refleje en tus saldos actuales de tu banca móvil. Los comprobantes editados o falsos son comunes y pueden causar pérdidas para el negocio.
                      </p>
                    </div>
                  </div>

                  {transferConfirmationOrder.paymentProofUrl && (
                    <div className="mt-5 flex items-center justify-center">
                      <button
                        type="button"
                        onClick={() => setZoomedImageUrl(transferConfirmationOrder.paymentProofUrl || null)}
                        className="inline-flex items-center gap-2 rounded-xl bg-sky-50 hover:bg-sky-100 active:scale-[0.97] text-sky-700 px-4 py-2.5 text-xs font-bold border border-sky-100/60 transition shadow-sm"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                        Inspeccionar comprobante recibido
                      </button>
                    </div>
                  )}

                  <div className="mt-6 flex flex-col gap-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        transferConfirmationOrder.onConfirm();
                        setTransferConfirmationOrder(null);
                      }}
                      className="w-full rounded-full bg-sky-600 hover:bg-sky-700 active:scale-[0.98] text-white py-3.5 text-sm font-bold shadow-md shadow-sky-600/10 hover:shadow-sky-600/25 transition"
                    >
                      Sí, ya verifiqué (Aceptar)
                    </button>
                    <button
                      type="button"
                      onClick={() => setTransferConfirmationOrder(null)}
                      className="w-full rounded-full border border-neutral-200 bg-white hover:bg-neutral-50 active:scale-[0.98] text-neutral-700 py-3.5 text-sm font-semibold transition"
                    >
                      Aún no reviso (Cerrar)
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* Modal de Confirmación de Entrega de Emergencia para Restaurante */}
          {emergencyDeliveryOrderId ? (
            <div
              className="fixed inset-0 z-[85] flex items-center justify-center bg-black/60 px-4 py-5 backdrop-blur-sm animate-fade-in"
              role="dialog"
              aria-modal="true"
            >
              <div
                className="absolute inset-0"
                onClick={() => setEmergencyDeliveryOrderId(null)}
                aria-hidden="true"
              />
              <div className="relative w-full max-w-[500px] overflow-hidden rounded-[28px] bg-white p-6 shadow-[0_32px_110px_rgba(15,15,15,0.35)] border border-black/5 animate-scale-up">
                <div className="text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-rose-50 text-rose-600 mb-4 border border-rose-100 animate-pulse">
                    <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-bold text-neutral-950 tracking-tight">
                    ¿Marcar como entregado?
                  </h3>
                  <p className="mt-3 text-sm text-neutral-600 leading-relaxed">
                    Esta acción <strong className="text-rose-600 font-semibold">solo debe realizarse en casos de emergencia</strong> o fuerza mayor.
                  </p>

                  <div className="mt-5 rounded-2xl bg-rose-50/70 p-4 border border-rose-100/60 text-left">
                    <div className="flex gap-2.5">
                      <svg className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div className="text-xs text-rose-800 leading-relaxed space-y-1.5 font-medium">
                        <p>
                          El flujo normal requiere que sea el <strong className="font-bold">repartidor asignado</strong> quien marque la entrega utilizando la geolocalización y el NIP correspondiente del comensal.
                        </p>
                        <p>
                          Al forzar la entrega desde tu panel administrativo, el pedido se considerará completado de inmediato y se dará por finalizado.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 flex flex-col gap-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        const orderId = emergencyDeliveryOrderId;
                        setEmergencyDeliveryOrderId(null);
                        void runOrderAction(orderId, 'delivered');
                      }}
                      className="w-full rounded-full bg-rose-600 hover:bg-rose-700 active:scale-[0.98] text-white py-3.5 text-sm font-bold shadow-md shadow-rose-600/10 hover:shadow-rose-600/25 transition"
                    >
                      Sí, marcar como entregado (Emergencia)
                    </button>
                    <button
                      type="button"
                      onClick={() => setEmergencyDeliveryOrderId(null)}
                      className="w-full rounded-full border border-neutral-200 bg-white hover:bg-neutral-50 active:scale-[0.98] text-neutral-700 py-3.5 text-sm font-semibold transition"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* Modal de Confirmación de Quitar Repartidor */}
          {unassignConfirmOrderId ? (
            <div
              className="fixed inset-0 z-[85] flex items-center justify-center bg-black/60 px-4 py-5 backdrop-blur-sm animate-fade-in"
              role="dialog"
              aria-modal="true"
            >
              <div
                className="absolute inset-0"
                onClick={() => setUnassignConfirmOrderId(null)}
                aria-hidden="true"
              />
              <div className="relative w-full max-w-[460px] overflow-hidden rounded-[28px] bg-white p-6 shadow-[0_32px_110px_rgba(15,15,15,0.35)] border border-black/5 animate-scale-up">
                <div className="text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-amber-600 mb-4 border border-amber-100">
                    <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-bold text-neutral-950 tracking-tight">
                    ¿Quitar repartidor?
                  </h3>
                  <p className="mt-3 text-sm text-neutral-600 leading-relaxed">
                    El pedido será <strong className="font-semibold text-amber-600">desasignado del repartidor actual</strong> y se asignará automáticamente a otro disponible o quedará en espera.
                  </p>

                  <div className="mt-6 flex flex-col gap-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        const orderId = unassignConfirmOrderId;
                        setUnassignConfirmOrderId(null);
                        void runOrderAction(orderId, 'quitarRepartidor');
                      }}
                      className="w-full rounded-full bg-rose-600 hover:bg-rose-700 active:scale-[0.98] text-white py-3.5 text-sm font-bold shadow-md shadow-rose-600/10 hover:shadow-rose-600/25 transition"
                    >
                      Sí, quitar repartidor
                    </button>
                    <button
                      type="button"
                      onClick={() => setUnassignConfirmOrderId(null)}
                      className="w-full rounded-full border border-neutral-200 bg-white hover:bg-neutral-50 active:scale-[0.98] text-neutral-700 py-3.5 text-sm font-semibold transition"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* Modal de Reembolso Requerido para Transferencias */}
          {transferRefundOrder ? (
            <div
              className="fixed inset-0 z-[85] flex items-center justify-center bg-black/60 px-4 py-5 backdrop-blur-sm animate-fade-in"
              role="dialog"
              aria-modal="true"
            >
              <div
                className="absolute inset-0"
                onClick={() => setTransferRefundOrder(null)}
                aria-hidden="true"
              />
              <div className="relative w-full max-w-[500px] overflow-hidden rounded-[28px] bg-white p-6 shadow-[0_32px_110px_rgba(15,15,15,0.35)] border border-black/5 animate-scale-up">
                <div className="text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-rose-50 text-rose-600 mb-4 border border-rose-100 animate-pulse">
                    <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-bold text-neutral-950 tracking-tight">
                    🚨 Reembolso Requerido
                  </h3>
                  <p className="mt-3 text-sm text-neutral-600 leading-relaxed">
                    Este pedido fue pagado mediante <strong className="text-neutral-950">Transferencia Bancaria</strong>. Al rechazar el pedido, el cliente recibirá una notificación para registrar su información de reembolso y el administrador coordinará la devolución de los fondos.
                  </p>

                  <div className="mt-5 rounded-2xl bg-rose-50/70 p-4 border border-rose-100/60 text-left">
                    <div className="flex flex-col gap-2">
                      <div className="flex justify-between items-center border-b border-rose-100/50 pb-2">
                        <span className="text-xs text-rose-800 font-semibold">Monto a reembolsar:</span>
                        <span className="text-base font-bold text-rose-700">{formatCurrency(getRestaurantCollectionAmount(transferRefundOrder, profile?.hasOwnDelivery))}</span>
                      </div>
                      <div className="flex justify-between items-center text-xs text-rose-800 font-medium">
                        <span>Referencia del pedido:</span>
                        <span className="font-bold">{transferRefundOrder.orderReference}</span>
                      </div>
                    </div>
                  </div>



                  {transferRefundOrder.paymentProofUrl && (
                    <div className="mt-4 flex items-center justify-center">
                      <button
                        type="button"
                        onClick={() => setZoomedImageUrl(transferRefundOrder.paymentProofUrl || null)}
                        className="inline-flex items-center gap-2 rounded-xl bg-sky-50 hover:bg-sky-100 active:scale-[0.97] text-sky-700 px-4 py-2.5 text-xs font-bold border border-sky-100/60 transition shadow-sm"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                        Inspeccionar comprobante recibido
                      </button>
                    </div>
                  )}

                  <div className="mt-6 flex flex-col gap-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        const orderId = transferRefundOrder.id;
                        setTransferRefundOrder(null);
                        void runOrderAction(orderId, 'reject');
                      }}
                      className="w-full rounded-full bg-rose-600 hover:bg-rose-700 active:scale-[0.98] text-white py-3.5 text-sm font-bold shadow-md shadow-rose-600/10 hover:shadow-rose-600/25 transition"
                    >
                      Entendido, rechazar pedido
                    </button>
                    <button
                      type="button"
                      onClick={() => setTransferRefundOrder(null)}
                      className="w-full rounded-full border border-neutral-200 bg-white hover:bg-neutral-50 active:scale-[0.98] text-neutral-700 py-3.5 text-sm font-semibold transition"
                    >
                      Volver (No rechazar)
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {isMobileNavOpen ? (
            <div className="fixed inset-0 z-50 lg:hidden">
              <div className="absolute inset-0 bg-black/40" onClick={() => setIsMobileNavOpen(false)} />
              <aside className="absolute left-0 top-0 flex h-full w-[300px] max-w-[86vw] flex-col overflow-hidden bg-[#fffdf8] shadow-[0_24px_90px_rgba(15,15,15,0.18)]">
                <div className="shrink-0 border-b border-black/5 px-5 py-5">
                  <div className="flex items-center justify-between gap-3">
                    <SaDelLogo className="h-9 w-auto object-contain" />
                    <button
                      type="button"
                      onClick={() => setIsMobileNavOpen(false)}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-black/10 bg-white text-neutral-700 transition hover:bg-neutral-50"
                      aria-label="Cerrar menu"
                    >
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  </div>
                  <p className="mt-4 truncate text-sm font-medium text-neutral-500">{restaurantName}</p>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
                  <div className="relative overflow-hidden rounded-[28px] border border-sky-200/60 bg-white p-4 shadow-[0_16px_45px_rgba(14,165,233,0.08)]">
                    <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-sky-300/80 via-cyan-200/70 to-transparent" />
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-600">Operacion</p>
                    <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-neutral-950">{restaurantName}</p>
                    <p className="mt-1 text-sm text-neutral-500">{operationalStatusLabel}</p>
                  </div>

                  <nav className="mt-6 grid gap-2">
                    {navigationItems.map((item) => {
                      const showOrderWarning = item.key === 'orders' && activeSection !== 'orders' && activeOrders.length > 0;
                      return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => {
                          setActiveSection(item.key);
                          setIsMobileNavOpen(false);
                        }}
                        className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition-all duration-300 ${
                          activeSection === item.key
                          ? 'bg-neutral-950 text-white'
                          : showOrderWarning
                          ? 'bg-sky-100 text-sky-900 animate-heartbeat shadow-sm'
                          : 'text-neutral-700 hover:bg-white'
                          }`}
                      >
                        <RestaurantNavIcon kind={item.key} />
                        <span className="flex-1">{item.label}</span>
                        {item.key === 'orders' && activeSection !== 'orders' && activeOrders.length > 0 && (
                          <span className="ml-auto flex items-center gap-1.5 shrink-0">
                            <span className="relative flex h-2 w-2">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75"></span>
                              <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-600"></span>
                            </span>
                            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-black text-sky-700">
                              {activeOrders.length}
                            </span>
                          </span>
                        )}
                      </button>
                    );
                    })}
                  </nav>
                </div>

                <div className="shrink-0 border-t border-black/5 bg-[#fffdf8] px-4 py-5">
                  <div className="grid gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowHelpModal(true);
                        setIsMobileNavOpen(false);
                      }}
                      className="flex items-center gap-3 rounded-2xl border border-black/10 bg-white px-4 py-3 text-left text-sm font-semibold text-neutral-700 transition hover:border-black/15 hover:bg-neutral-50"
                    >
                      <HelpCircleIcon />
                      Ayuda
                    </button>
                    {/* Dark Mode Toggle */}
                    <div className="flex items-center justify-between rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm font-semibold text-neutral-800">
                      <div className="flex items-center gap-3">
                        <svg className="h-5 w-5 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                        </svg>
                        Modo Oscuro
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={isDarkMode}
                        onClick={() => {
                          const isDark = document.documentElement.classList.toggle('dark');
                          setIsDarkMode(isDark);
                          window.localStorage.setItem('darkMode', isDark ? 'true' : 'false');
                          triggerHaptic(10);
                        }}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${isDarkMode ? 'bg-sky-600' : 'bg-neutral-300'}`}
                      >
                        <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow-sm transition ${isDarkMode ? 'translate-x-4' : 'translate-x-1'}`} />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const isBusinessOpen = profile?.isAcceptingOrders ?? false;
                        if (isBusinessOpen) {
                          setShowLogoutWarningModal(true);
                        } else {
                          clearSession('Sesion cerrada. Regresaste al login.');
                        }
                      }}
                      className="flex items-center gap-3 rounded-2xl border border-black/10 bg-white px-4 py-3 text-left text-sm font-semibold text-neutral-800 transition hover:border-black/15 hover:bg-neutral-50"
                    >
                      <OpenStorefrontIcon />
                      Cerrar sesion
                    </button>
                  </div>
                </div>
              </aside>
            </div>
          ) : null}
          {showClosePromptModal ? (
            <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 px-4 py-6">
              <div
                className="absolute inset-0"
                onClick={() => {}}
              />
              <div className="relative w-full max-w-[520px] rounded-[32px] border border-black/5 bg-[linear-gradient(180deg,#fffdf8_0%,#f6f1e6_100%)] p-6 shadow-[0_30px_90px_rgba(15,15,15,0.22)]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-neutral-400">
                      Horario de Cierre
                    </p>
                    <h3 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-neutral-950">
                      ¿Deseas cerrar ahora?
                    </h3>
                    <p className="mt-3 text-sm leading-6 text-neutral-600">
                      Tu horario de cierre programado ha llegado. Puedes cerrar el restaurante ahora para dejar de recibir pedidos, o mantenerlo abierto un momento más.
                    </p>
                    <p className="mt-2 text-xs leading-5 text-neutral-500 font-medium">
                      Si ignoras este aviso, se cerrará automáticamente en 10 minutos.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowClosePromptModal(false)}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-black/10 bg-white text-neutral-700 transition hover:bg-neutral-50"
                    aria-label="Cerrar aviso"
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M18 6L6 18M6 6L18 18"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
                <div className="mt-8 flex items-center justify-end gap-3 border-t border-black/5 pt-5">
                  <button
                    type="button"
                    disabled={extendingHours}
                    onClick={handleExtendHours}
                    className="inline-flex h-[52px] items-center justify-center rounded-full border border-black/10 bg-white px-6 font-medium text-neutral-800 transition hover:bg-neutral-50 disabled:opacity-50"
                  >
                    {extendingHours ? 'Extendiendo...' : 'Mantener Abierto'}
                  </button>
                  <button
                    type="button"
                    disabled={updatingOperationalStatus}
                    onClick={() => {
                      setShowClosePromptModal(false);
                      if (profile?.isAcceptingOrders) {
                        void toggleOperationalStatus();
                      }
                    }}
                    className="inline-flex h-[52px] items-center justify-center rounded-full bg-neutral-900 px-6 font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50"
                  >
                    Cerrar Ahora
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {isStatusBlockedModalOpen ? (
            <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 px-4 py-6">
              <div
                className="absolute inset-0"
                onClick={() => setIsStatusBlockedModalOpen(false)}
              />
              <div className="relative w-full max-w-[520px] rounded-[32px] border border-black/5 bg-[linear-gradient(180deg,#fffdf8_0%,#f6f1e6_100%)] p-6 shadow-[0_30px_90px_rgba(15,15,15,0.22)]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-neutral-400">
                      Estado administrativo
                    </p>
                    <h3 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-neutral-950">
                      No puedes abrir el restaurante
                    </h3>
                    <p className="mt-3 text-sm leading-6 text-neutral-600">
                      Tu restaurante está {profile?.status === 'DELETED' ? 'eliminado' : 'suspendido'} por administración.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsStatusBlockedModalOpen(false)}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-black/10 bg-white text-neutral-700 transition hover:bg-neutral-50"
                    aria-label="Cerrar aviso"
                  >
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>

                <div className="mt-5 rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-900">
                  <span className="font-semibold">Motivo:</span>{' '}
                  {profile?.statusReason?.trim() || 'No hay un motivo registrado. Contacta a administración.'}
                </div>

                <div className="mt-5 rounded-[24px] border border-black/5 bg-white/80 px-4 py-4 text-sm leading-6 text-neutral-600">
                  {profile?.statusReason?.includes('pago vencido') || profile?.statusReason?.includes('impago') ? (
                    <span>
                      Si tu suspensión es por un corte vencido, puedes liquidar tu saldo y subir el comprobante de pago directamente en la pestaña de <strong>Facturación</strong>. Una vez que el administrador confirme el pago, tu cuenta se reactivará automáticamente.
                    </span>
                  ) : (
                    <span>
                      Solo el panel de administración puede reactivar el restaurante. Cuando administración lo deje en estado activo,
                      aquí podrás volver a mover el switch de abierto/cerrado normalmente.
                    </span>
                  )}
                </div>

                <div className="mt-6 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setIsStatusBlockedModalOpen(false)}
                    className="rounded-full bg-neutral-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-neutral-800"
                  >
                    Entendido
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {isDetailsModalOpen ? (
            <div className="fixed inset-0 z-[80] flex items-start sm:items-center justify-center bg-black/55 px-2 py-4 sm:px-4 sm:py-5 backdrop-blur-sm animate-fade-in overflow-y-auto">
              <div className="w-full max-w-[640px] rounded-[28px] bg-white p-4 sm:p-6 shadow-[0_28px_90px_rgba(15,15,15,0.34)] max-h-[90vh] sm:max-h-[85vh] flex flex-col animate-scale-up mx-auto">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">Facturación</p>
                    <h3 className="mt-2 text-xl sm:text-2xl font-bold tracking-[-0.03em] text-neutral-950">
                      Detalle del Corte
                    </h3>
                    <p className="text-xs text-neutral-500 mt-1">
                      Referencia: {selectedSettlementForDetails ? formatSettlementReference(selectedSettlementForDetails.reference) : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsDetailsModalOpen(false)}
                    className="shrink-0 rounded-full border border-black/10 px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-semibold text-neutral-700 transition hover:bg-neutral-100"
                  >
                    Cerrar
                  </button>
                </div>

                {/* Summary Cards */}
                <div className="mt-5 sm:mt-6 grid grid-cols-3 gap-2 sm:gap-3 rounded-2xl bg-neutral-50 p-3 sm:p-4 border border-black/5">
                  <div className="text-center">
                    <p className="text-[10px] uppercase font-bold text-neutral-400">Pedidos</p>
                    <p className="text-base sm:text-lg font-bold text-neutral-950 mt-1">{settlementOrders.length}</p>
                  </div>
                  <div className="text-center border-x border-black/5 px-2">
                    <p className="text-[10px] uppercase font-bold text-neutral-400">Volumen Bruto</p>
                    <p className="text-base sm:text-lg font-bold text-neutral-950 mt-1">
                      ${settlementOrders.reduce((sum: number, o: any) => sum + (o.totalAmount || 0), 0).toFixed(2)}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] uppercase font-bold text-neutral-400">Total Deuda</p>
                    <p className="text-base sm:text-lg font-bold text-sky-700 mt-1">
                      ${(selectedSettlementForDetails?.amount ?? 0).toFixed(2)}
                    </p>
                  </div>
                </div>

                <div className="mt-4 sm:mt-6 overflow-y-auto flex-1 space-y-3 pr-0.5 sm:pr-1 -mr-0.5 sm:-mr-1">
                  {loadingSettlementOrders ? (
                    <div className="flex justify-center py-12">
                      <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-900"></div>
                    </div>
                  ) : settlementOrders.length > 0 ? (
                    settlementOrders.map((order: any) => (
                      <div key={order.id} className="rounded-2xl border border-black/5 bg-white p-3 sm:p-4 text-sm transition hover:shadow-md hover:border-neutral-200">
                        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 sm:gap-0">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm sm:text-base font-bold text-neutral-950 leading-tight">
                                {order.customer?.user?.name || 'Comensal Anónimo'}
                              </span>
                              {order.dailyCounter && (
                                <span className="text-[11px] font-bold text-neutral-500 bg-neutral-100/80 rounded-full px-2 py-0.5">
                                  Pedido #{order.dailyCounter}
                                </span>
                              )}
                              <span className="text-[10px] font-bold text-neutral-500 bg-neutral-100 rounded-full px-2 py-0.5 whitespace-nowrap">
                                Facturado
                              </span>
                            </div>
                            <p className="text-[10px] text-neutral-400 mt-1.5 font-mono tracking-tight">
                              {order.orderReference}
                            </p>
                            <p className="text-[11px] text-neutral-500 mt-0.5">
                              {new Date(order.createdAt).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}
                            </p>
                          </div>
                          <div className="flex sm:flex-col items-center sm:items-end gap-3 sm:gap-0 sm:text-right">
                            <div className="text-right shrink-0">
                              <span className="text-[10px] sm:text-[11px] font-bold text-neutral-400 block uppercase leading-tight">Total</span>
                              <span className="text-base sm:text-lg font-extrabold text-neutral-950">${(order.totalAmount || 0).toFixed(2)}</span>
                            </div>
                            <div className="text-xs bg-sky-50/50 text-sky-700 border border-sky-100/30 rounded-lg p-1.5 sm:p-2 inline-block text-left shrink-0">
                              <p className="flex justify-between gap-3 sm:gap-4">
                                <span className="text-[10px] text-sky-600 font-semibold">Servicio:</span>
                                <span className="font-bold tabular-nums">${(order.serviceFee || 0).toFixed(2)}</span>
                              </p>
                              <p className="flex justify-between gap-3 sm:gap-4 mt-0.5">
                                <span className="text-[10px] text-sky-600 font-semibold">Plataforma:</span>
                                <span className="font-bold tabular-nums">${(order.platformFee || 0).toFixed(2)}</span>
                              </p>
                              <div className="border-t border-sky-200/50 mt-1 pt-1 flex justify-between gap-3 sm:gap-4 font-black">
                                <span className="text-[10px] text-sky-700">Comisión Total:</span>
                                <span className="tabular-nums">${((order.serviceFee || 0) + (order.platformFee || 0)).toFixed(2)}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-center text-neutral-500 py-4">No se encontraron pedidos para este corte.</p>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {isCurrentPeriodDetailsOpen ? (
            <div className="fixed inset-0 z-[80] flex items-start sm:items-center justify-center bg-black/55 px-2 py-4 sm:px-4 sm:py-5 backdrop-blur-sm animate-fade-in overflow-y-auto">
              <div className="w-full max-w-[640px] rounded-[28px] bg-white p-4 sm:p-6 shadow-[0_28px_90px_rgba(15,15,15,0.34)] max-h-[90vh] sm:max-h-[85vh] flex flex-col animate-scale-up mx-auto">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">Semana Actual</p>
                    <h3 className="mt-2 text-xl sm:text-2xl font-bold tracking-[-0.03em] text-neutral-950">
                      Desglose de Comisiones
                    </h3>
                    <p className="text-xs text-neutral-500 mt-1">
                      Pedidos entregados desde el último corte ({billingSummary?.periodStart ? new Date(billingSummary.periodStart).toLocaleDateString() : '--'} al día de hoy)
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsCurrentPeriodDetailsOpen(false)}
                    className="shrink-0 rounded-full border border-black/10 px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-semibold text-neutral-700 transition hover:bg-neutral-100"
                  >
                    Cerrar
                  </button>
                </div>

                {/* Summary Cards */}
                <div className="mt-5 sm:mt-6 grid grid-cols-3 gap-2 sm:gap-3 rounded-2xl bg-neutral-50 p-3 sm:p-4 border border-black/5">
                  <div className="text-center">
                    <p className="text-[10px] uppercase font-bold text-neutral-400">Pedidos</p>
                    <p className="text-base sm:text-lg font-bold text-neutral-950 mt-1">{currentPeriodOrders.length}</p>
                  </div>
                  <div className="text-center border-x border-black/5 px-2">
                    <p className="text-[10px] uppercase font-bold text-neutral-400">Volumen Bruto</p>
                    <p className="text-base sm:text-lg font-bold text-neutral-950 mt-1">
                      ${currentPeriodOrders.reduce((sum: number, o: any) => sum + (o.totalAmount || 0), 0).toFixed(2)}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] uppercase font-bold text-neutral-400">Total Deuda</p>
                    <p className="text-base sm:text-lg font-bold text-sky-700 mt-1">
                      ${(billingSummary?.currentDebt ?? 0).toFixed(2)}
                    </p>
                  </div>
                </div>

                {/* Order List */}
                <div className="mt-4 sm:mt-6 overflow-y-auto flex-1 space-y-3 pr-0.5 sm:pr-1 -mr-0.5 sm:-mr-1">
                  {loadingCurrentPeriodOrders ? (
                    <div className="flex justify-center py-12">
                      <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-900"></div>
                    </div>
                  ) : currentPeriodOrders.length > 0 ? (
                    currentPeriodOrders.map((order: any) => (
                      <div key={order.id} className="rounded-2xl border border-black/5 bg-white p-3 sm:p-4 text-sm transition hover:shadow-md hover:border-neutral-200">
                        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 sm:gap-0">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm sm:text-base font-bold text-neutral-950 leading-tight">
                                {order.customer?.user?.name || 'Comensal Anónimo'}
                              </span>
                              {order.dailyCounter && (
                                <span className="text-[11px] font-bold text-neutral-500 bg-neutral-100/80 rounded-full px-2 py-0.5">
                                  Pedido #{order.dailyCounter}
                                </span>
                              )}
                              <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200/40 rounded-full px-2 py-0.5 whitespace-nowrap">
                                Entregado
                              </span>
                            </div>
                            <p className="text-[10px] text-neutral-400 mt-1.5 font-mono tracking-tight">
                              {order.orderReference}
                            </p>
                            <p className="text-[11px] text-neutral-500 mt-0.5">
                              {new Date(order.createdAt).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}
                            </p>
                          </div>
                          <div className="flex sm:flex-col items-center sm:items-end gap-3 sm:gap-0 sm:text-right">
                            <div className="text-right shrink-0">
                              <span className="text-[10px] sm:text-[11px] font-bold text-neutral-400 block uppercase leading-tight">Total</span>
                              <span className="text-base sm:text-lg font-extrabold text-neutral-950">${(order.totalAmount || 0).toFixed(2)}</span>
                            </div>
                            <div className="text-xs bg-sky-50/50 text-sky-700 border border-sky-100/30 rounded-lg p-1.5 sm:p-2 inline-block text-left shrink-0">
                              <p className="flex justify-between gap-3 sm:gap-4">
                                <span className="text-[10px] text-sky-600 font-semibold">Servicio:</span>
                                <span className="font-bold tabular-nums">${(order.serviceFee || 0).toFixed(2)}</span>
                              </p>
                              <p className="flex justify-between gap-3 sm:gap-4 mt-0.5">
                                <span className="text-[10px] text-sky-600 font-semibold">Plataforma:</span>
                                <span className="font-bold tabular-nums">${(order.platformFee || 0).toFixed(2)}</span>
                              </p>
                              <div className="border-t border-sky-200/50 mt-1 pt-1 flex justify-between gap-3 sm:gap-4 font-black">
                                <span className="text-[10px] text-sky-700">Comisión Total:</span>
                                <span className="tabular-nums">${((order.serviceFee || 0) + (order.platformFee || 0)).toFixed(2)}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-8 text-neutral-500">
                      <span className="text-3xl block mb-2">🍽️</span>
                      <p className="font-semibold text-neutral-700">No hay pedidos registrados aún</p>
                      <p className="text-xs mt-1">Los pedidos entregados en esta semana aparecerán aquí.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {/* Modal de Confirmación de Cancelación de Pedido */}
          {cancelConfirmOrder ? (
            <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/60 px-4 py-5 backdrop-blur-sm animate-fade-in" role="dialog" aria-modal="true">
              <div className="absolute inset-0" onClick={() => setCancelConfirmOrder(null)} aria-hidden="true" />
              <div className="relative w-full max-w-[460px] overflow-hidden rounded-[28px] bg-white p-6 shadow-[0_32px_110px_rgba(15,15,15,0.35)] border border-black/5 animate-scale-up">
                <div className="text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-rose-50 text-rose-600 mb-4 border border-rose-100">
                    <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/>
                    </svg>
                  </div>
                  <h3 className="text-xl font-bold text-neutral-950 tracking-tight">¿Cancelar pedido?</h3>
                  <p className="mt-3 text-sm text-neutral-600 leading-relaxed">
                    Esta acción <strong className="text-rose-600 font-semibold">no se puede deshacer</strong>. 
                    El pedido será cancelado y se notificará al cliente y al repartidor (si está asignado).
                  </p>

                  <div className="mt-5 rounded-2xl bg-amber-50/70 p-4 border border-amber-100/60 text-left">
                    <div className="flex gap-2.5">
                      <svg className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div className="text-xs text-amber-800 leading-relaxed space-y-2 font-medium">
                        <p>Al cancelar:</p>
                        <ul className="list-disc pl-4 space-y-1">
                          <li>El cliente recibirá una notificación de cancelación.</li>
                          <li>El repartidor será desasignado automáticamente.</li>
                          <li>Si el pago fue por transferencia, se requerirá reembolso.</li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  <div className="mt-5">
                    <label className="block text-left text-xs font-semibold text-neutral-600 mb-1.5">
                      Motivo de cancelación <span className="text-rose-500">*</span>
                    </label>
                    <textarea
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      placeholder="Describe por qué cancelas el pedido (mín. 10 caracteres)"
                      rows={3}
                      className="w-full rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm font-medium text-neutral-900 placeholder-neutral-400 outline-none focus:border-rose-300 focus:bg-white focus:ring-2 focus:ring-rose-200/50 transition resize-none"
                    />
                    {cancelReason.trim().length > 0 && cancelReason.trim().length < 10 && (
                      <p className="mt-1 text-xs font-semibold text-rose-500">Mínimo 10 caracteres</p>
                    )}
                  </div>

                  <div className="mt-6 flex flex-col gap-2.5">
                    <button
                      type="button"
                      disabled={cancelReason.trim().length < 10}
                      onClick={async () => {
                        try {
                          await requestJson({
                            apiBase,
                            path: `/restaurant-panel/pedidos/${cancelConfirmOrder.id}/cancelar`,
                            token,
                            options: { method: 'PATCH', body: JSON.stringify({ reason: cancelReason.trim() }) },
                            fallbackMessage: 'No se pudo cancelar el pedido.',
                          });
                          setCancelConfirmOrder(null);
                          pushToast('success', 'Pedido cancelado', `Motivo: ${cancelReason.trim()}`);
                          loadOrdersOnly();
                        } catch (err: any) {
                          pushToast('error', 'Error', err?.message || 'No se pudo cancelar.');
                        }
                      }}
                      className="w-full rounded-full bg-rose-600 hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] text-white py-3.5 text-sm font-bold shadow-md shadow-rose-600/10 hover:shadow-rose-600/25 transition"
                    >
                      Sí, cancelar pedido
                    </button>
                    <button
                      type="button"
                      onClick={() => setCancelConfirmOrder(null)}
                      className="w-full rounded-full border border-neutral-200 bg-white hover:bg-neutral-50 active:scale-[0.98] text-neutral-700 py-3.5 text-sm font-semibold transition"
                    >
                      No, mantener pedido
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* Modal de Solicitud de Cancelación del Cliente */}
          {cancelRequestModalOrder ? (
            <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 px-4 py-5 backdrop-blur-sm animate-fade-in" role="dialog" aria-modal="true">
              <div className="absolute inset-0" onClick={() => setCancelRequestModalOrder(null)} aria-hidden="true" />
              <div className="relative w-full max-w-[460px] overflow-hidden rounded-[28px] bg-white p-6 shadow-[0_32px_110px_rgba(15,15,15,0.35)] border border-black/5 animate-scale-up">
                <div className="text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-amber-600 mb-4 border border-amber-100">
                    <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                  </div>
                  <h3 className="text-xl font-bold text-neutral-950 tracking-tight">Solicitud de cancelación</h3>
                  <p className="mt-2 text-sm text-neutral-600 leading-relaxed">
                    El cliente <strong className="text-neutral-900 font-semibold">{cancelRequestModalOrder.customer?.user?.name || 'Comensal'}</strong> solicita cancelar el pedido <strong className="text-neutral-900 font-semibold">#{cancelRequestModalOrder.orderReference}</strong>.
                  </p>

                  <div className="mt-4 rounded-2xl bg-neutral-50 p-4 border border-neutral-200/60 text-left space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">Pedido</span>
                      <span className="text-xs font-bold text-neutral-900">#{cancelRequestModalOrder.orderReference}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">Total</span>
                      <span className="text-sm font-bold text-neutral-900">${cancelRequestModalOrder.totalAmount}</span>
                    </div>
                  </div>

                  <div className="mt-5 rounded-2xl bg-amber-50/70 p-4 border border-amber-100/60 text-left">
                    <div className="flex gap-2.5">
                      <svg className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                      </svg>
                      <p className="text-xs font-semibold text-amber-800 leading-relaxed">
                        {cancelRequestModalOrder.status === 'PREPARING'
                          ? 'El pedido ya está en preparación. Si lo cancelas perderás los ingredientes y el tiempo invertido. Puedes rechazar la solicitud.'
                          : 'Si el pedido aún no se prepara, puedes aprobar la cancelación para evitar pérdidas de ingredientes y tiempo. De lo contrario, recházala.'}
                      </p>
                    </div>
                  </div>

                  <div className="mt-6 flex flex-col gap-2.5">
                    <button
                      type="button"
                      disabled={cancelRequestProcessing || cancelRequestModalOrder.status === 'PREPARING'}
                      onClick={async () => {
                        setCancelRequestProcessing(true);
                        try {
                          await requestJson({
                            apiBase,
                            path: `/restaurant-panel/pedidos/${cancelRequestModalOrder.id}/responder-solicitud-cancelacion`,
                            token,
                            options: { method: 'POST', body: JSON.stringify({ approve: true }) },
                            fallbackMessage: 'Error al aprobar cancelación.',
                          });
                          setCancelRequestModalOrder(null);
                          pushToast('success', 'Cancelación aprobada', 'El cliente será notificado.');
                          loadOrdersOnly();
                        } catch (err: any) {
                          pushToast('error', 'Error', err?.message || 'No se pudo procesar.');
                        } finally {
                          setCancelRequestProcessing(false);
                        }
                      }}
                      className={`w-full rounded-full py-3.5 text-sm font-bold shadow-md transition ${cancelRequestModalOrder.status === 'PREPARING' ? 'bg-neutral-200 text-neutral-400 cursor-not-allowed' : 'bg-emerald-500 hover:bg-emerald-600 active:scale-[0.98] text-white shadow-emerald-600/10 hover:shadow-emerald-600/25'}`}
                    >
                      {cancelRequestModalOrder.status === 'PREPARING' ? 'No disponible (pedido en preparación)' : 'Sí, aprobar cancelación'}
                    </button>
                    <button
                      type="button"
                      disabled={cancelRequestProcessing}
                      onClick={async () => {
                        setCancelRequestProcessing(true);
                        try {
                          await requestJson({
                            apiBase,
                            path: `/restaurant-panel/pedidos/${cancelRequestModalOrder.id}/responder-solicitud-cancelacion`,
                            token,
                            options: { method: 'POST', body: JSON.stringify({ approve: false }) },
                            fallbackMessage: 'Error al rechazar cancelación.',
                          });
                          setCancelRequestModalOrder(null);
                          pushToast('info', 'Cancelación rechazada', 'El pedido continúa su curso.');
                          loadOrdersOnly();
                        } catch (err: any) {
                          pushToast('error', 'Error', err?.message || 'No se pudo procesar.');
                        } finally {
                          setCancelRequestProcessing(false);
                        }
                      }}
                      className="w-full rounded-full border border-neutral-200 bg-white hover:bg-neutral-50 active:scale-[0.98] text-neutral-700 py-3.5 text-sm font-semibold transition"
                    >
                      No, rechazar cancelación
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {isPayModalOpen ? (
            <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm px-4 py-5 animate-in fade-in duration-300">
              <div className="w-full max-w-[540px] my-auto rounded-[32px] bg-white p-5 sm:p-8 shadow-2xl ring-1 ring-black/5 animate-in zoom-in-95 duration-300">
                <div className="flex items-start justify-between gap-3 mb-5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2Z" /></svg>
                      </div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-600">Liquidación</p>
                    </div>
                    <h3 className="text-xl sm:text-2xl font-black tracking-tight text-neutral-900 truncate">
                      Pagar Corte
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsPayModalOpen(false)}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 transition hover:bg-neutral-200 hover:text-neutral-900 active:scale-95"
                    title="Cerrar"
                  >
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>

                <div className="space-y-5 sm:space-y-6">
                  {/* Amount to Pay (Hero Section) */}
                  <div className="relative overflow-hidden rounded-[24px] bg-neutral-900 p-5 sm:p-6 text-white shadow-lg">
                    <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/5 blur-3xl"></div>
                    <div className="relative z-10 flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-neutral-400">Total a liquidar</p>
                        <div className="mt-1 flex items-baseline gap-1 flex-wrap">
                          <span className="text-2xl sm:text-3xl lg:text-4xl font-black break-all">${selectedSettlementForPay?.amount}</span>
                          <span className="text-sm font-semibold text-neutral-400 shrink-0">MXN</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(String(selectedSettlementForPay?.amount ?? ''));
                          pushToast('success', 'Monto copiado', 'Pegalo en tu app de banco.');
                        }}
                        className="group flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-white transition hover:bg-white hover:text-neutral-900 active:scale-95"
                        title="Copiar monto"
                      >
                        <svg className="h-5 w-5 transition-transform group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Digital Receipt (Bank Details) */}
                  <div className="rounded-[24px] border border-black/5 bg-neutral-50">
                    <div className="flex items-center gap-2 border-b border-black/5 px-4 py-3">
                      <svg className="h-4 w-4 shrink-0 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
                      <span className="text-xs font-bold uppercase tracking-wider text-neutral-500">Datos Bancarios</span>
                    </div>
                    <div className="divide-y divide-black/5">
                      {[
                        { label: 'Banco', value: adminBankName || 'Cargando...', clip: adminBankName },
                        { label: 'CLABE / Cuenta', value: adminBankAccount || 'Cargando...', clip: adminBankAccount, highlight: true },
                        { label: 'Beneficiario', value: adminBankBeneficiary || 'Cargando...', clip: adminBankBeneficiary },
                        { label: 'Referencia', value: profile?.name || 'Nombre del restaurante', clip: profile?.name },
                      ].map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between gap-2 px-4 py-3 transition hover:bg-black/[0.02]">
                          <div className="min-w-0">
                            <p className="text-[11px] font-semibold text-neutral-500">{item.label}</p>
                            <p className={`mt-0.5 text-sm truncate ${item.highlight ? 'font-bold text-neutral-900' : 'font-semibold text-neutral-700'}`}>
                              {item.value}
                            </p>
                          </div>
                          {item.clip && (
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(item.clip!);
                                pushToast('success', 'Copiado', `${item.label} copiado al portapapeles.`);
                              }}
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 transition hover:bg-neutral-200 hover:text-neutral-900 active:scale-90"
                              title={`Copiar ${item.label.toLowerCase()}`}
                            >
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Warning Note */}
                  <div className="flex gap-3 rounded-2xl bg-amber-50 p-4 border border-amber-100/50">
                    <div className="shrink-0 pt-0.5">
                      <svg className="h-5 w-5 text-amber-500" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-amber-900">Instrucciones Importantes</p>
                      <p className="mt-1 text-xs text-amber-800/80 leading-relaxed">
                        Transfiere el monto exacto y usa el nombre de tu restaurante como <b>Referencia</b>. Al finalizar, sube el comprobante (ej. captura de tu app bancaria) aquí abajo.
                      </p>
                    </div>
                  </div>

                  {/* Upload Zone (Drag & Drop UI) */}
                  {/* Upload Zone & Preview */}
                  <div className="mt-6">
                    {proofPreviewBase64 ? (
                      <div className="space-y-4">
                        <div className="relative overflow-hidden rounded-[24px] border-2 border-black/10 bg-neutral-50 p-2">
                          <img 
                            src={proofPreviewBase64} 
                            alt="Vista previa del comprobante" 
                            className="max-h-48 w-full rounded-2xl object-contain"
                          />
                          <button
                            type="button"
                            onClick={() => setProofPreviewBase64(null)}
                            disabled={uploadingProof}
                            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md transition hover:bg-black/70 disabled:opacity-50"
                          >
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                        
                        <button
                          type="button"
                          onClick={handleSubmitProof}
                          disabled={uploadingProof}
                          className={`w-full flex items-center justify-center gap-2 rounded-full py-3.5 text-sm font-bold text-white transition-all active:scale-95 ${
                            uploadingProof ? 'bg-blue-400' : 'bg-blue-600 hover:bg-blue-700 hover:shadow-lg hover:shadow-blue-600/20'
                          }`}
                        >
                          {uploadingProof ? (
                            <>
                              <svg className="h-5 w-5 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                              Subiendo...
                            </>
                          ) : (
                            <>
                              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                              Enviar Comprobante
                            </>
                          )}
                        </button>
                      </div>
                    ) : (
                      <>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleSelectProof}
                          className="hidden"
                          id="proof-upload"
                          disabled={uploadingProof}
                        />
                        <label
                          htmlFor="proof-upload"
                          className={`group relative flex flex-col items-center justify-center gap-3 overflow-hidden rounded-[24px] border-2 border-dashed p-5 sm:p-8 transition-all ${
                            uploadingProof
                              ? 'cursor-not-allowed border-black/10 bg-black/5'
                              : 'cursor-pointer border-blue-500/30 bg-blue-50/30 hover:border-blue-500 hover:bg-blue-50/80'
                          }`}
                        >
                          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-sm transition-transform group-hover:scale-110 group-active:scale-95">
                            <svg className="h-7 w-7 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                          </div>
                          <div className="text-center">
                            <p className="text-sm font-bold text-neutral-900">Haz clic para elegir foto</p>
                            <p className="mt-1 text-xs font-medium text-neutral-500">
                              Soporta JPG, PNG hasta 10MB
                            </p>
                          </div>
                        </label>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* Modal del Centro de Ayuda y Soporte */}
          {showHelpModal ? (
            <div
              className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 px-4 py-5 backdrop-blur-sm animate-fade-in"
              role="dialog"
              aria-modal="true"
            >
              {/* Backdrop click to close */}
              <div
                className="absolute inset-0"
                onClick={() => setShowHelpModal(false)}
              />

              {/* Main Card */}
              <div className="relative z-10 w-full max-w-5xl rounded-[32px] bg-white border border-neutral-100 shadow-[0_32px_100px_rgba(15,15,15,0.22)] flex flex-col overflow-hidden max-h-[85vh] transition-all duration-300">
                
                {/* Cabecera / Header */}
                <div className="border-b border-black/5 bg-gradient-to-r from-neutral-50 to-white px-6 py-5 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-sky-600 to-blue-500 text-white shadow-lg shadow-blue-500/20">
                      <HelpCircleIcon />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold tracking-tight text-neutral-950">Centro de Ayuda y Soporte</h2>
                      <p className="mt-0.5 text-xs text-neutral-500 font-medium">
                        Capacitación operativa, resolución de dudas y contacto directo con la administración.
                      </p>
                    </div>
                  </div>
                  
                  <button
                    type="button"
                    onClick={() => setShowHelpModal(false)}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-black/5 bg-white text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 active:scale-95 shadow-sm"
                    aria-label="Cerrar modal"
                  >
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>

                {/* Subcontainer for Tabs and Content */}
                <div className="flex flex-col md:flex-row flex-1 overflow-hidden min-h-0">
                  
                  {/* Left Navigation Tabs (Desktop) / Horizontal Tabs (Mobile) */}
                  <div className="shrink-0 border-b md:border-b-0 md:border-r border-black/5 bg-[#faf8f5]/80 p-4 md:w-60 overflow-x-auto md:overflow-x-visible md:overflow-y-auto scrollbar-none flex md:flex-col gap-2 flex-row">
                    
                    {/* Tab Button 1: Simulador */}
                    <button
                      type="button"
                      onClick={() => setActiveHelpTab('simulator')}
                      className={`flex items-center gap-3 rounded-2xl px-4 py-3.5 text-left text-sm font-semibold transition-all duration-200 shrink-0 whitespace-nowrap ${
                        activeHelpTab === 'simulator'
                          ? 'bg-gradient-to-r from-sky-600 to-blue-600 text-white shadow-md shadow-blue-600/10 ring-1 ring-sky-500/20'
                          : 'text-neutral-600 hover:bg-sky-50/70 hover:text-sky-700'
                      }`}
                    >
                      <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                        <rect x="3" y="4" width="18" height="12" rx="3.5" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10 9l5 3-5 3V9z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 20h6M12 16v4" />
                      </svg>
                      Simulador de Pedidos
                    </button>

                    {/* Tab Button 2: FAQs */}
                    <button
                      type="button"
                      onClick={() => setActiveHelpTab('faqs')}
                      className={`flex items-center gap-3 rounded-2xl px-4 py-3.5 text-left text-sm font-semibold transition-all duration-200 shrink-0 whitespace-nowrap ${
                        activeHelpTab === 'faqs'
                          ? 'bg-gradient-to-r from-sky-600 to-blue-600 text-white shadow-md shadow-blue-600/10 ring-1 ring-sky-500/20'
                          : 'text-neutral-600 hover:bg-sky-50/70 hover:text-sky-700'
                      }`}
                    >
                      <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Crisis y FAQs
                    </button>

                    {/* Tab Button 3: Transfers */}
                    <button
                      type="button"
                      onClick={() => setActiveHelpTab('transfers')}
                      className={`flex items-center gap-3 rounded-2xl px-4 py-3.5 text-left text-sm font-semibold transition-all duration-200 shrink-0 whitespace-nowrap ${
                        activeHelpTab === 'transfers'
                          ? 'bg-gradient-to-r from-sky-600 to-blue-600 text-white shadow-md shadow-blue-600/10 ring-1 ring-sky-500/20'
                          : 'text-neutral-600 hover:bg-sky-50/70 hover:text-sky-700'
                      }`}
                    >
                      <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                      Validar Transferencias
                    </button>

                    {/* Tab Button 4: Support */}
                    <button
                      type="button"
                      onClick={() => setActiveHelpTab('support')}
                      className={`flex items-center gap-3 rounded-2xl px-4 py-3.5 text-left text-sm font-semibold transition-all duration-200 shrink-0 whitespace-nowrap ${
                        activeHelpTab === 'support'
                          ? 'bg-gradient-to-r from-sky-600 to-blue-600 text-white shadow-md shadow-blue-600/10 ring-1 ring-sky-500/20'
                          : 'text-neutral-600 hover:bg-sky-50/70 hover:text-sky-700'
                      }`}
                    >
                      <svg className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 18v-6a9 9 0 0 1 18 0v6" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3v5zm-18 0a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3v5z" />
                      </svg>
                      Soporte y Reportes
                    </button>

                  </div>

                  {/* Right Content Area */}
                  <div className="flex-1 overflow-y-auto p-6 md:p-8 min-h-0 bg-[#fafaf9]/20">
                    
                    {/* Tab 1: Simulator */}
                    {activeHelpTab === 'simulator' && (
                      <div className="space-y-6 animate-fade-in">
                        <div>
                          <h3 className="text-lg font-bold text-neutral-950">Simulador de Pedidos Entrantes</h3>
                          <p className="mt-1 text-sm text-neutral-500 leading-relaxed font-medium">
                            Usa esta herramienta para entrenar a tu personal en el uso del sistema. Al activar cualquiera de los pedidos de prueba, se simulará un pedido real con alerta de sonido y pantalla de confirmación.
                          </p>
                        </div>

                        <div className="grid gap-5 sm:grid-cols-3">
                          {/* CASH CARD */}
                          <div className="rounded-[28px] border border-black/5 bg-white p-5 flex flex-col justify-between hover:shadow-[0_12px_30px_rgba(0,0,0,0.04)] hover:border-black/10 transition-all duration-300">
                            <div>
                              <div className="flex items-center justify-between">
                                <span className="inline-flex rounded-xl bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700 border border-emerald-100">
                                  Efectivo
                                </span>
                                <div className="h-8 w-8 rounded-xl bg-emerald-50/50 flex items-center justify-center">
                                  <svg className="h-5 w-5 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                                    <rect x="2" y="6" width="20" height="12" rx="2" />
                                    <circle cx="12" cy="12" r="3" />
                                    <path d="M6 12h.01M18 12h.01" />
                                  </svg>
                                </div>
                              </div>
                              <h4 className="mt-4 text-base font-bold text-neutral-950">Cobro en Caja</h4>
                              <p className="mt-1.5 text-xs text-neutral-500 leading-relaxed font-medium">
                                Ideal para entrenar al personal en el flujo de cobranza física, cambio de efectivo y entrega en mostrador.
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                simulateIncomingOrder('CASH');
                                setShowHelpModal(false);
                              }}
                              className="mt-6 w-full rounded-2xl bg-neutral-950 hover:bg-sky-600 hover:shadow-lg hover:shadow-sky-600/10 text-white py-3 text-xs font-bold transition-all duration-200 active:scale-[0.98]"
                            >
                              Simular Pedido
                            </button>
                          </div>

                          {/* TRANSFER CARD */}
                          <div className="rounded-[28px] border border-black/5 bg-white p-5 flex flex-col justify-between hover:shadow-[0_12px_30px_rgba(0,0,0,0.04)] hover:border-black/10 transition-all duration-300">
                            <div>
                              <div className="flex items-center justify-between">
                                <span className="inline-flex rounded-xl bg-blue-50 px-2.5 py-1 text-[10px] font-bold text-blue-700 border border-blue-100">
                                  Transferencia
                                </span>
                                <div className="h-8 w-8 rounded-xl bg-blue-50/50 flex items-center justify-center">
                                  <svg className="h-5 w-5 text-blue-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                                    <path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3" />
                                  </svg>
                                </div>
                              </div>
                              <h4 className="mt-4 text-base font-bold text-neutral-950">Pago Offline</h4>
                              <p className="mt-1.5 text-xs text-neutral-500 leading-relaxed font-medium">
                                Simula un pago offline por transferencia. Útil para practicar la validación de capturas de pantalla de bancos.
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                simulateIncomingOrder('TRANSFER');
                                setShowHelpModal(false);
                              }}
                              className="mt-6 w-full rounded-2xl bg-neutral-950 hover:bg-sky-600 hover:shadow-lg hover:shadow-sky-600/10 text-white py-3 text-xs font-bold transition-all duration-200 active:scale-[0.98]"
                            >
                              Simular Pedido
                            </button>
                          </div>

                          {/* CREDIT CARD */}
                          <div className="rounded-[28px] border border-black/5 bg-white p-5 flex flex-col justify-between hover:shadow-[0_12px_30px_rgba(0,0,0,0.04)] hover:border-black/10 transition-all duration-300">
                            <div>
                              <div className="flex items-center justify-between">
                                <span className="inline-flex rounded-xl bg-purple-50 px-2.5 py-1 text-[10px] font-bold text-purple-700 border border-purple-100">
                                  Tarjeta
                                </span>
                                <div className="h-8 w-8 rounded-xl bg-purple-50/50 flex items-center justify-center">
                                  <svg className="h-5 w-5 text-purple-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                                    <rect x="2" y="5" width="20" height="14" rx="2" />
                                    <line x1="2" y1="10" x2="22" y2="10" />
                                    <rect x="6" y="14" width="4" height="2" rx="0.5" />
                                  </svg>
                                </div>
                              </div>
                              <h4 className="mt-4 text-base font-bold text-neutral-950">Pasarela Digital</h4>
                              <p className="mt-1.5 text-xs text-neutral-500 leading-relaxed font-medium">
                                Simula el flujo automatizado con tarjetas de crédito/débito. Aprobación inmediata sin validaciones manuales.
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                simulateIncomingOrder('CREDIT_CARD');
                                setShowHelpModal(false);
                              }}
                              className="mt-6 w-full rounded-2xl bg-neutral-950 hover:bg-sky-600 hover:shadow-lg hover:shadow-sky-600/10 text-white py-3 text-xs font-bold transition-all duration-200 active:scale-[0.98]"
                            >
                              Simular Pedido
                            </button>
                          </div>
                        </div>

                        <div className="rounded-[24px] bg-amber-50/60 border border-amber-200/50 p-4 text-xs text-amber-900 leading-relaxed font-medium flex gap-3">
                          <span className="text-base">💡</span>
                          <div>
                            <span className="font-bold block mb-0.5">Nota para capacitación:</span>
                            Una vez detonado el pedido, la campana de alerta sonará indefinidamente hasta que el cajero haga clic en &quot;Aceptar Pedido&quot; o &quot;Rechazar Pedido&quot;. Es la manera perfecta de simular el estrés real de una cocina en horas pico.
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Tab 2: FAQs */}
                    {activeHelpTab === 'faqs' && (
                      <div className="space-y-6 animate-fade-in">
                        <div>
                          <h3 className="text-lg font-bold text-neutral-950">Resolución de Crisis Comunes</h3>
                          <p className="mt-1 text-sm text-neutral-500 font-medium">
                            Manuales de respuesta rápida para emergencias operativas dentro del restaurante.
                          </p>
                        </div>

                        <div className="space-y-4">
                          <details className="group border border-neutral-200/70 rounded-[24px] bg-white p-5 [&_summary::-webkit-details-marker]:hidden open:border-sky-200 open:shadow-[0_8px_24px_rgba(99,102,241,0.04)] transition-all duration-300">
                            <summary className="flex cursor-pointer items-center justify-between font-bold text-neutral-800 hover:text-neutral-950 text-sm sm:text-base outline-none">
                              <span className="flex items-center gap-3">
                                <div className="h-7 w-7 rounded-lg bg-neutral-50 flex items-center justify-center group-open:bg-sky-50 group-open:text-sky-600 transition-colors">
                                  <svg className="h-4.5 w-4.5 text-neutral-500 group-open:text-sky-600 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                                    <path d="M12 20h.01M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 14 0M1.5 9.5a15 15 0 0 1 21 0" />
                                  </svg>
                                </div>
                                ¿Qué hago si se cae el Internet en la cocina?
                              </span>
                              <span className="transition duration-300 group-open:rotate-180 shrink-0 ml-2">
                                <svg className="h-4.5 w-4.5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                              </span>
                            </summary>
                            <div className="mt-4 text-xs sm:text-sm text-neutral-600 leading-relaxed border-t border-neutral-100 pt-4 font-medium pl-10">
                              Nuestra plataforma cuenta con tolerancia sin conexión. Si pierdes señal temporalmente, los pedidos en curso se mantendrán guardados localmente. Te recomendamos revisar el indicador de conexión (punto verde/rojo) en la parte superior. Si persisten los problemas, puedes abrir el portal desde un teléfono celular usando datos móviles para no perder ventas.
                            </div>
                          </details>

                          <details className="group border border-neutral-200/70 rounded-[24px] bg-white p-5 [&_summary::-webkit-details-marker]:hidden open:border-sky-200 open:shadow-[0_8px_24px_rgba(99,102,241,0.04)] transition-all duration-300">
                            <summary className="flex cursor-pointer items-center justify-between font-bold text-neutral-800 hover:text-neutral-950 text-sm sm:text-base outline-none">
                              <span className="flex items-center gap-3">
                                <div className="h-7 w-7 rounded-lg bg-neutral-50 flex items-center justify-center group-open:bg-sky-50 group-open:text-sky-600 transition-colors">
                                  <svg className="h-4.5 w-4.5 text-neutral-500 group-open:text-sky-600 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                                    <circle cx="5" cy="18" r="3" />
                                    <circle cx="19" cy="18" r="3" />
                                    <path d="M12 18h4m-8 0h4m2 0V11m0 0H8.5a2.5 2.5 0 0 1-2.5-2.5V7m6 4h3.5a2.5 2.5 0 0 0 2.5-2.5V7" />
                                  </svg>
                                </div>
                                ¿Cómo procedo si el repartidor asignado se demora demasiado?
                              </span>
                              <span className="transition duration-300 group-open:rotate-180 shrink-0 ml-2">
                                <svg className="h-4.5 w-4.5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                              </span>
                            </summary>
                            <div className="mt-4 text-xs sm:text-sm text-neutral-600 leading-relaxed border-t border-neutral-100 pt-4 font-medium pl-10">
                              Si el repartidor tarda en llegar por el pedido ya preparado, puedes ver los datos de contacto del repartidor directamente en el ticket del pedido. Si no responde, comunícate de inmediato con Soporte SaDeL desde la pestaña &quot;Soporte&quot; para reasignar otro repartidor y evitar que la comida se enfríe.
                            </div>
                          </details>

                          <details className="group border border-neutral-200/70 rounded-[24px] bg-white p-5 [&_summary::-webkit-details-marker]:hidden open:border-sky-200 open:shadow-[0_8px_24px_rgba(99,102,241,0.04)] transition-all duration-300">
                            <summary className="flex cursor-pointer items-center justify-between font-bold text-neutral-800 hover:text-neutral-950 text-sm sm:text-base outline-none">
                              <span className="flex items-center gap-3">
                                <div className="h-7 w-7 rounded-lg bg-neutral-50 flex items-center justify-center group-open:bg-sky-50 group-open:text-sky-600 transition-colors">
                                  <svg className="h-4.5 w-4.5 text-neutral-500 group-open:text-sky-600 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                                    <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z" />
                                  </svg>
                                </div>
                                ¿Qué hago ante una disputa sobre especificaciones de un platillo?
                              </span>
                              <span className="transition duration-300 group-open:rotate-180 shrink-0 ml-2">
                                <svg className="h-4.5 w-4.5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                              </span>
                            </summary>
                            <div className="mt-4 text-xs sm:text-sm text-neutral-600 leading-relaxed border-t border-neutral-100 pt-4 font-medium pl-10">
                              Siempre verifica el apartado de &quot;Instrucciones especiales&quot; y las notas del ticket antes de cocinar. Si un cliente reclama que un ingrediente no debió incluirse pero no lo especificó en sus notas de pedido, puedes contactar al cliente mediante el chat integrado del pedido en el portal para aclarar la situación de manera profesional.
                            </div>
                          </details>
                        </div>
                      </div>
                    )}

                    {/* Tab 3: Transfers */}
                    {activeHelpTab === 'transfers' && (
                      <div className="space-y-6 animate-fade-in">
                        <div>
                          <h3 className="text-lg font-bold text-neutral-950">Guía de Seguridad para Transferencias</h3>
                          <p className="mt-1.5 text-sm text-neutral-500 leading-relaxed font-medium">
                            Las transferencias electrónicas sin conexión (offline) son cómodas pero propensas a fraudes con comprobantes falsificados. Sigue este protocolo para proteger tu negocio.
                          </p>
                        </div>

                        <div className="space-y-4">
                          <div className="flex gap-4 p-5 rounded-[24px] border border-black/5 bg-white hover:border-sky-100 transition-all duration-300 shadow-[0_4px_12px_rgba(0,0,0,0.01)]">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-sky-600 to-blue-500 text-white text-sm font-bold shadow-md shadow-blue-500/10">
                              1
                            </div>
                            <div>
                              <h4 className="text-sm font-bold text-neutral-950">Inspecciona el Comprobante Visualmente</h4>
                              <p className="mt-1 text-xs sm:text-sm text-neutral-600 leading-relaxed font-medium">
                                Haz clic en <span className="font-semibold text-neutral-900">Ver comprobante</span> en el ticket del pedido. Revisa con cuidado:
                              </p>
                              <ul className="mt-2.5 list-disc list-inside text-xs text-neutral-500 space-y-1 pl-1 font-medium">
                                <li>Fecha y hora exactas del movimiento bancario.</li>
                                <li>El monto total transferido coincide exactamente con el ticket del pedido.</li>
                                <li>No hay señales de edición fotográfica o tipografías extrañas en los números.</li>
                              </ul>
                            </div>
                          </div>

                          <div className="flex gap-4 p-5 rounded-[24px] border border-black/5 bg-white hover:border-sky-100 transition-all duration-300 shadow-[0_4px_12px_rgba(0,0,0,0.01)]">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-sky-600 to-blue-500 text-white text-sm font-bold shadow-md shadow-blue-500/10">
                              2
                            </div>
                            <div>
                              <h4 className="text-sm font-bold text-neutral-950">Confirma en tu Aplicación Bancaria (Firme)</h4>
                              <p className="mt-1 text-xs sm:text-sm text-neutral-600 leading-relaxed font-medium">
                                <span className="font-bold text-red-600">Paso obligatorio:</span> Abre la aplicación móvil del banco receptor del restaurante. Confirma que el abono se haya procesado como &quot;Saldo Disponible&quot; o dinero firme. Nunca confíes únicamente en la captura de pantalla que envía el cliente.
                              </p>
                            </div>
                          </div>

                          <div className="flex gap-4 p-5 rounded-[24px] border border-black/5 bg-white hover:border-sky-100 transition-all duration-300 shadow-[0_4px_12px_rgba(0,0,0,0.01)]">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-sky-600 to-blue-500 text-white text-sm font-bold shadow-md shadow-blue-500/10">
                              3
                            </div>
                            <div>
                              <h4 className="text-sm font-bold text-neutral-950">Transiciona el Estado del Pedido</h4>
                              <p className="mt-1 text-xs sm:text-sm text-neutral-600 leading-relaxed font-medium">
                                Solo después de comprobar el saldo real en tu cuenta, haz clic en <span className="font-semibold text-emerald-600">Aceptar y Registrar Pago</span> en el portal. Esto autoriza al repartidor a salir con la comida y garantiza que el cobro esté asegurado.
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-[24px] border border-rose-200 bg-rose-50/40 p-4 text-xs text-rose-950 flex gap-3 font-medium leading-relaxed">
                          <svg className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                          <div>
                            <span className="font-bold block text-rose-900">Alerta de Fraude Común (Transferencias Programadas):</span>
                            Muchos estafadores programan transferencias para el día siguiente, le toman captura, y después las cancelan antes de que se ejecuten. Siempre valida que el dinero esté realmente abonado y disponible en tu app bancaria antes de entregar el producto.
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Tab 4: Support */}
                    {activeHelpTab === 'support' && (
                      <div className="space-y-6 animate-fade-in">
                        <div>
                          <h3 className="text-lg font-bold text-neutral-950">Canales de Soporte Técnico</h3>
                          <p className="mt-1 text-sm text-neutral-500 font-medium">
                            ¿Tienes algún problema con el sistema o el servicio? Estamos listos para ayudarte.
                          </p>
                        </div>

                        {/* WhatsApp CTA - Official Color and Brand Icon */}
                        <div className="rounded-[28px] border border-[#25D366]/20 bg-[#25D366]/5 p-5 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-[0_8px_30px_rgba(37,211,102,0.03)] transition-all duration-300">
                          <div className="flex items-center gap-4">
                            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#25D366] text-white shadow-lg shadow-[#25D366]/20 shrink-0">
                              <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.955c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.549 4.142 1.594 5.945L.057 23.957l6.23-1.636a11.83 11.83 0 005.765 1.472h.004c6.555 0 11.89-5.335 11.893-11.893a11.815 11.815 0 00-3.414-8.358z"/>
                              </svg>
                            </div>
                            <div>
                              <h4 className="text-base font-bold text-neutral-950">Chat Directo con Soporte</h4>
                              <p className="mt-0.5 text-xs text-neutral-500 leading-relaxed font-medium">
                                Escríbenos directamente por WhatsApp. Tiempo promedio de respuesta: menos de 5 minutos.
                              </p>
                            </div>
                          </div>
                          <a
                            href="https://wa.me/525512345678?text=Hola%20Soporte%20SaDeL%2C%20necesito%20ayuda%20con%20mi%20portal%20de%20restaurante."
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 rounded-2xl bg-[#25D366] hover:bg-[#20ba5a] active:scale-[0.98] text-white px-6 py-3.5 text-xs font-bold shadow-md shadow-[#25D366]/10 hover:shadow-[#25D366]/20 transition-all duration-200 text-center flex items-center justify-center gap-2"
                          >
                            Abrir WhatsApp
                          </a>
                        </div>

                        {/* Columns Container */}
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 border-t border-black/5 pt-6">
                          
                          {/* Left Column: Form */}
                          <div className="lg:col-span-6 space-y-4">
                            <div>
                              <h4 className="text-sm font-bold text-neutral-950 uppercase tracking-wider">Reportar una Incidencia</h4>
                              <p className="mt-1 text-xs text-neutral-500 font-medium">
                                Envía un boleto de reporte. Nuestro equipo técnico lo resolverá en segundo plano y te contactará.
                              </p>
                            </div>

                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                if (!supportSubject.trim() || !supportMessage.trim()) {
                                  pushToast('error', 'Campos incompletos', 'Por favor llena todos los datos del reporte.');
                                  return;
                                }

                                const newTicket = {
                                  id: `ticket-local-${Date.now()}`,
                                  category: supportCategory,
                                  subject: supportSubject,
                                  description: supportMessage,
                                  status: 'PENDING',
                                  createdAt: new Date().toISOString(),
                                };

                                try {
                                  const stored = localStorage.getItem('local_restaurant_tickets');
                                  const tickets = stored ? JSON.parse(stored) : [];
                                  const updatedTickets = [newTicket, ...tickets];
                                  localStorage.setItem('local_restaurant_tickets', JSON.stringify(updatedTickets));
                                  setRestaurantTickets(updatedTickets);

                                  pushToast('success', 'Reporte Registrado', 'Tu reporte ha sido enviado exitosamente. Un administrador lo revisará.');
                                  setSupportSubject('');
                                  setSupportMessage('');
                                } catch (err) {
                                  console.error('Error saving support ticket:', err);
                                  pushToast('error', 'Error al enviar', 'No se pudo guardar tu reporte.');
                                }
                              }}
                              className="space-y-4 text-left"
                            >
                              <div>
                                <label className="text-[11px] font-bold uppercase tracking-widest text-neutral-400">
                                  Categoría del Problema
                                </label>
                                <select
                                  value={supportCategory}
                                  onChange={(e) => setSupportCategory(e.target.value)}
                                  className="mt-2 w-full rounded-2xl border border-black/5 bg-white px-4 py-3.5 text-sm font-medium text-neutral-900 transition-colors focus:border-neutral-950 focus:outline-none focus:ring-1 focus:ring-neutral-950"
                                >
                                  <option value="SYSTEM">Falla del Sistema o Portal</option>
                                  <option value="DRIVER">Problema con Repartidor / Pedido</option>
                                  <option value="BILLING">Dudas de Facturación o Cortes</option>
                                  <option value="OTHER">Otro problema administrativo</option>
                                </select>
                              </div>

                              <div>
                                <label className="text-[11px] font-bold uppercase tracking-widest text-neutral-400">
                                  Asunto del Reporte
                                </label>
                                <input
                                  type="text"
                                  value={supportSubject}
                                  onChange={(e) => setSupportSubject(e.target.value)}
                                  placeholder="Ej. El sonido de alertas no suena"
                                  className="mt-2 w-full rounded-2xl border border-black/5 bg-white px-4 py-3.5 text-sm font-medium text-neutral-900 transition-colors focus:border-neutral-950 focus:outline-none focus:ring-1 focus:ring-neutral-950 placeholder:text-neutral-300"
                                />
                              </div>

                              <div>
                                <label className="text-[11px] font-bold uppercase tracking-widest text-neutral-400">
                                  Descripción detallada
                                </label>
                                <textarea
                                  rows={4}
                                  value={supportMessage}
                                  onChange={(e) => setSupportMessage(e.target.value)}
                                  placeholder="Describe detalladamente qué ocurrió, qué estabas haciendo y cualquier error visible..."
                                  className="mt-2 w-full rounded-2xl border border-black/5 bg-white px-4 py-3.5 text-sm font-medium text-neutral-900 transition-colors focus:border-neutral-950 focus:outline-none focus:ring-1 focus:ring-neutral-950 placeholder:text-neutral-300 resize-none"
                                />
                              </div>

                              <div className="flex justify-end pt-2">
                                  <button
                                    type="submit"
                                    className="w-full sm:w-auto rounded-2xl bg-neutral-950 hover:bg-neutral-800 active:scale-[0.98] text-white px-6 py-3.5 text-xs font-bold transition-all duration-300 shadow-md shadow-neutral-950/10"
                                  >
                                    Enviar Reporte de Falla
                                  </button>
                              </div>
                            </form>
                          </div>

                          {/* Right Column: History */}
                          <div className="lg:col-span-6 space-y-4">
                            <div className="flex items-center justify-between">
                              <div>
                                <h4 className="text-sm font-bold text-neutral-950 uppercase tracking-wider">Mis Reportes</h4>
                                <p className="mt-1 text-xs text-neutral-500 font-medium">
                                  Historial de tus solicitudes de soporte.
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  try {
                                    const stored = localStorage.getItem('local_restaurant_tickets');
                                    if (stored) setRestaurantTickets(JSON.parse(stored));
                                  } catch (e) {
                                    console.error(e);
                                  }
                                }}
                                className="text-xs font-bold text-neutral-500 hover:text-neutral-950 transition-colors flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-black/5 bg-white hover:bg-neutral-50 shadow-sm"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                                </svg>
                                Actualizar
                              </button>
                            </div>

                            {/* Ticket List */}
                            <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1 no-scrollbar">
                              {restaurantTickets.length === 0 ? (
                                <div className="border border-dashed border-black/10 rounded-2xl p-8 text-center bg-white/50">
                                  <p className="text-sm text-neutral-400 font-semibold">No tienes reportes registrados.</p>
                                  <p className="text-xs text-neutral-400 mt-1">Usa el formulario de la izquierda para enviar uno.</p>
                                </div>
                              ) : (
                                restaurantTickets.map((ticket) => (
                                  <div key={ticket.id} className="border border-black/5 rounded-2xl p-4 bg-white hover:shadow-[0_8px_24px_rgba(0,0,0,0.02)] transition-all duration-300">
                                    <div className="flex items-center justify-between mb-3">
                                      <div className="flex items-center gap-2.5">
                                        <span className="text-lg">
                                          {ticket.category === 'SYSTEM' ? '💻' :
                                           ticket.category === 'DRIVER' ? '🛵' :
                                           ticket.category === 'BILLING' ? '💵' : '📂'}
                                        </span>
                                        <div>
                                          <p className="text-xs font-bold text-neutral-800">
                                            {ticket.category === 'SYSTEM' ? 'Sistema / Portal' :
                                             ticket.category === 'DRIVER' ? 'Repartidor / Pedido' :
                                             ticket.category === 'BILLING' ? 'Facturación / Cortes' : 'Otro / Administrativo'}
                                          </p>
                                          <p className="text-[10px] font-semibold text-neutral-400">
                                            {new Date(ticket.createdAt).toLocaleString()}
                                          </p>
                                        </div>
                                      </div>
                                      
                                      <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold tracking-wide uppercase ${
                                        ticket.status === 'PENDING' ? 'bg-sky-50 text-sky-700 border border-sky-200/50' :
                                        ticket.status === 'IN_PROGRESS' ? 'bg-blue-50 text-blue-700 border border-blue-200/50' :
                                        'bg-emerald-50 text-emerald-700 border border-emerald-200/50'
                                      }`}>
                                        {ticket.status === 'PENDING' ? 'Pendiente' :
                                         ticket.status === 'IN_PROGRESS' ? 'En Proceso' : 'Resuelto'}
                                      </span>
                                    </div>
                                    
                                    <div className="text-xs text-neutral-700 font-medium space-y-1">
                                      <p><span className="text-neutral-400 font-bold uppercase tracking-wider text-[9px] mr-1">Asunto:</span> {ticket.subject}</p>
                                      <p className="text-neutral-600 text-xs mt-1.5 whitespace-pre-wrap">{ticket.description}</p>
                                    </div>

                                    {ticket.response && (
                                      <div className="mt-3 bg-emerald-50/50 border border-emerald-100/50 rounded-xl p-3">
                                        <div className="flex items-center gap-1.5 mb-1 text-emerald-800 font-bold text-xs">
                                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                                          </svg>
                                          <span>Respuesta del Soporte:</span>
                                        </div>
                                        <p className="text-xs text-emerald-700 font-medium leading-relaxed whitespace-pre-wrap">{ticket.response}</p>
                                        {ticket.respondedAt && (
                                          <p className="text-[9px] text-emerald-500 font-semibold mt-1">
                                            Respondido el: {new Date(ticket.respondedAt).toLocaleString()}
                                          </p>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                  </div>

                </div>

              </div>
            </div>
          ) : null}
        </div>
      )}

      {showPromoModal && promoImageUrl && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 p-6 animate-fade-in">
          <div className="relative w-full max-w-sm sm:max-w-md bg-white rounded-3xl overflow-hidden shadow-2xl animate-scale-up">
            <button
              type="button"
              onClick={() => setShowPromoModal(false)}
              className="absolute top-4 right-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur transition hover:bg-black/70 hover:scale-110"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <div className="relative w-full overflow-hidden bg-transparent">
              <img
                src={promoImageUrl}
                alt="Aviso Especial"
                className="w-full h-auto max-h-[65vh] object-contain block mx-auto"
              />
            </div>
            <div className="p-5 flex justify-center bg-white border-t border-black/5">
              <button
                type="button"
                onClick={() => setShowPromoModal(false)}
                className="w-full rounded-2xl bg-neutral-950 py-3.5 text-sm font-bold text-white transition hover:bg-neutral-800 active:scale-95 shadow-sm"
              >
                ¡Entendido!
              </button>
            </div>
          </div>
        </div>
      )}
      <audio id="restaurant-alert-audio" src="/sounds/notifica.wav" preload="auto" loop></audio>
    </main>
  );
}

function Panel({
  title,
  subtitle,
  tone = 'sand',
  children,
}: {
  title: string;
  subtitle: string;
  tone?: 'amber' | 'emerald' | 'sand' | 'sky' | 'rose' | 'slate' | 'violet';
  children: React.ReactNode;
}) {
  const toneStyles: Record<
    NonNullable<Parameters<typeof Panel>[0]['tone']>,
    { accent: string; chip: string }
  > = {
    amber: {
      accent: 'from-amber-300/80 via-orange-200/70 to-transparent',
      chip: 'bg-sky-100 text-sky-700',
    },
    emerald: {
      accent: 'from-emerald-300/80 via-lime-200/70 to-transparent',
      chip: 'bg-emerald-100 text-emerald-700',
    },
    sand: {
      accent: 'from-stone-300/70 via-amber-100/60 to-transparent',
      chip: 'bg-stone-100 text-stone-700',
    },
    violet: {
      accent: 'from-sky-300/80 via-blue-200/70 to-transparent',
      chip: 'bg-sky-100 text-sky-700',
    },
    sky: {
      accent: 'from-sky-300/80 via-cyan-200/70 to-transparent',
      chip: 'bg-sky-100 text-sky-700',
    },
    rose: {
      accent: 'from-rose-300/80 via-orange-100/70 to-transparent',
      chip: 'bg-rose-100 text-rose-700',
    },
    slate: {
      accent: 'from-slate-300/80 via-neutral-200/70 to-transparent',
      chip: 'bg-slate-100 text-slate-700',
    },
  };
  const palette = toneStyles[tone];

  return (
    <section className="relative overflow-hidden rounded-[28px] border border-black/5 bg-white p-4 shadow-[0_18px_50px_rgba(15,15,15,0.05)] backdrop-blur md:p-5">
      <div className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${palette.accent}`} />
      <div className="relative mb-4 border-b border-black/5 pb-3">
        <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${palette.chip}`}>
          {subtitle}
        </span>
        <h2 className="mt-1.5 text-[1.45rem] font-semibold tracking-[-0.035em] text-neutral-950 md:text-[1.6rem]">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function RestaurantNavIcon({ kind }: { kind: RestaurantPortalSection }) {
  if (kind === 'dashboard') {
    return (
      <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <rect x="4" y="5" width="7" height="6" rx="1.5" strokeWidth={1.7} />
        <rect x="13" y="5" width="7" height="6" rx="1.5" strokeWidth={1.7} />
        <rect x="4" y="13" width="7" height="6" rx="1.5" strokeWidth={1.7} />
        <rect x="13" y="13" width="7" height="6" rx="1.5" strokeWidth={1.7} />
      </svg>
    );
  }

  if (kind === 'orders') {
    return (
      <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 7h10M7 12h10M7 17h6" />
        <rect x="4" y="4" width="16" height="16" rx="4" strokeWidth={1.6} />
      </svg>
    );
  }

  if (kind === 'store') {
    return (
      <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M4 10h16v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8Z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M5 10V7l2-3h10l2 3v3" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M9 14h6" />
      </svg>
    );
  }

  if (kind === 'billing') {
    return (
      <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <rect x="3" y="5" width="18" height="14" rx="3" strokeWidth={1.7} />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M3 10h18" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M7 15h.01M11 15h2" />
      </svg>
    );
  }

  if (kind === 'featured') {
    return (
      <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
    );
  }

  if (kind === 'settings') {
    return (
      <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <circle cx="12" cy="12" r="3" strokeWidth={1.7} />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    );
  }

  return (
    <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 4v3m0 10v3m8-8h-3M7 12H4" />
      <circle cx="12" cy="12" r="4" strokeWidth={1.7} />
    </svg>
  );
}

function HelpCircleIcon() {
  return (
    <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <circle cx="12" cy="12" r="8" strokeWidth={1.7} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M9.75 9.5a2.25 2.25 0 1 1 3.52 1.85c-.9.62-1.27 1.05-1.27 1.9" />
      <circle cx="12" cy="16.8" r=".8" fill="currentColor" stroke="none" />
    </svg>
  );
}

function OpenStorefrontIcon() {
  return (
    <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M4 10h16v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8Z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M5 10V7l2-3h10l2 3v3" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M9 14h6" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M9 10c0 1.1-.9 2-2 2s-2-.9-2-2m8 0c0 1.1-.9 2-2 2s-2-.9-2-2m8 0c0 1.1-.9 2-2 2s-2-.9-2-2" />
    </svg>
  );
}


function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
}) {
  return (
    <label className="group grid min-w-0 gap-2 text-sm text-neutral-600">
      <span className="text-[12px] font-bold uppercase tracking-[0.1em] text-neutral-600 transition-colors group-focus-within:text-sky-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="block w-full min-w-0 rounded-[18px] border border-black/5 bg-neutral-100/50 px-5 py-3.5 text-[15px] font-medium text-neutral-950 shadow-inner outline-none transition-all duration-300 placeholder:text-neutral-400 hover:bg-neutral-100/80 focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-400/20 focus:shadow-md"
      />
    </label>
  );
}

const BUSINESS_TYPE_LABELS: Record<string, string> = {
  RESTAURANT: 'Restaurante',
  STORE: 'Tienda',
};

function businessTypeLabel(type?: string | null): string {
  return (type && BUSINESS_TYPE_LABELS[type]) || 'Restaurante';
}

function TimeField({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="group grid min-w-0 gap-2 text-sm text-neutral-600">
      <span className="text-[12px] font-bold uppercase tracking-[0.1em] text-neutral-600 transition-colors group-focus-within:text-sky-500">{label}</span>
      <input
        type="time"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="block w-full min-w-0 rounded-[18px] border border-black/5 bg-neutral-100/50 px-5 py-3.5 text-[15px] font-medium text-neutral-950 shadow-inner outline-none transition-all duration-300 focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-400/20 focus:shadow-md hover:bg-neutral-100/80 disabled:cursor-not-allowed disabled:bg-neutral-100/50 disabled:text-neutral-400 disabled:shadow-none"
      />
    </label>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
  description,
  compact = false,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
  compact?: boolean;
  disabled?: boolean;
}) {
  return (
    <div
      className={`min-w-0 rounded-[24px] border border-white/40 bg-white/40 backdrop-blur-sm shadow-[0_4px_20px_-10px_rgba(0,0,0,0.05)] transition-all hover:bg-white/60 ${compact
        ? 'flex flex-col gap-2 border-0 bg-transparent px-0 py-0 sm:flex-row sm:items-center sm:justify-between'
        : 'flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between'
        }`}
    >
      <div className="min-w-0">
        <p className="text-[16px] font-bold tracking-tight text-neutral-950">{label}</p>
        {description ? <p className="mt-1.5 text-sm font-medium leading-relaxed text-neutral-500">{description}</p> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-disabled={disabled}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-[44px] w-[76px] shrink-0 items-center rounded-full border px-1.5 shadow-[inset_0_2px_4px_rgba(0,0,0,0.1)] transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-50 ${checked ? 'border-sky-400 bg-gradient-to-r from-sky-500 to-sky-400 shadow-[0_4px_12px_rgba(14,165,233,0.3)] ring-1 ring-sky-400/50' : 'border-neutral-300 bg-neutral-200'
          }`}
      >
        <span
          className={`inline-flex h-[32px] w-[32px] items-center justify-center rounded-full bg-white text-[10px] font-black uppercase tracking-[0.1em] shadow-[0_2px_8px_rgba(0,0,0,0.2)] transition-transform duration-300 ${checked ? 'translate-x-[32px] text-sky-500' : 'translate-x-0 text-neutral-400'
            }`}
        >
          {checked ? 'On' : 'Off'}
        </span>
      </button>
    </div>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="group grid min-w-0 gap-2 text-sm text-neutral-600">
      <span className="text-[12px] font-bold uppercase tracking-[0.1em] text-neutral-600 transition-colors group-focus-within:text-sky-500">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={4}
        className="block min-h-[140px] w-full min-w-0 rounded-[24px] border border-black/5 bg-neutral-100/50 px-5 py-4 text-[15px] font-medium text-neutral-950 shadow-inner outline-none transition-all duration-300 placeholder:text-neutral-400 hover:bg-neutral-100/80 focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-400/20 focus:shadow-md"
      />
    </label>
  );
}

function Info({ label, value, full = false }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={`rounded-[24px] border border-black/5 bg-neutral-50 p-4 ${full ? 'md:col-span-2' : ''}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">{label}</p>
      <p className="mt-2 text-sm leading-6 text-neutral-950">{value}</p>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-[28px] border border-dashed border-black/10 bg-neutral-50 px-4 py-10 text-center text-sm text-neutral-500">
      {text}
    </div>
  );
}

function StatusBadge({ status }: { status: OrderStatus }) {
  const palette: Record<OrderStatus, string> = {
    PENDING: 'border-sky-200 bg-sky-50 text-sky-700',
    CONFIRMED: 'border-sky-200 bg-sky-50 text-sky-700',
    PREPARING: 'border-orange-200 bg-orange-50 text-orange-700',
    READY: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    PICKED_UP: 'border-teal-200 bg-teal-50 text-teal-700',
    IN_TRANSIT: 'border-cyan-200 bg-cyan-50 text-cyan-700',
    COMPLETED: 'border-teal-200 bg-teal-50 text-teal-700',
    DELIVERED: 'border-lime-200 bg-lime-50 text-lime-700',
    CANCELLED: 'border-neutral-200 bg-neutral-100 text-neutral-600',
    REJECTED: 'border-rose-200 bg-rose-50 text-rose-700',
  };

  return (
    <span className={`rounded-full border px-3 py-1.5 text-xs font-medium ${palette[status]}`}>
      {statusLabelMap[status]}
    </span>
  );
}

function TransferCountdown({ createdAt }: { createdAt: string | Date }) {
  const [timeLeft, setTimeLeft] = useState<number>(600);

  useEffect(() => {
    const calculateTimeLeft = () => {
      const difference = new Date(createdAt).getTime() + 10 * 60 * 1000 - Date.now();
      return Math.max(0, Math.floor(difference / 1000));
    };

    setTimeLeft(calculateTimeLeft());
    const timer = setInterval(() => {
      setTimeLeft(calculateTimeLeft());
    }, 1000);

    return () => clearInterval(timer);
  }, [createdAt]);

  if (timeLeft <= 0) {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 border border-rose-200 px-3 py-1 text-xs font-bold text-rose-600 animate-pulse">
        <span>⚠️ Tiempo Expirado</span>
      </div>
    );
  }

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;

  return (
    <div className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 border border-sky-200 px-3 py-1 text-xs font-bold text-sky-700">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
        <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500"></span>
      </span>
      <span>
        Aceptar en: {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
      </span>
    </div>
  );
}


function ActionButton({
  tone,
  disabled = false,
  children,
  onClick,
}: {
  tone: 'primary' | 'danger' | 'warning' | 'success' | 'neutral';
  disabled?: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  const palette: Record<typeof tone, string> = {
    primary:
      'border-sky-300 bg-sky-500 text-white shadow-[0_12px_30px_rgba(14,165,233,0.22)] hover:bg-sky-400',
    danger:
      'border-rose-300 bg-rose-500 text-white shadow-[0_12px_30px_rgba(244,63,94,0.22)] hover:bg-rose-400',
    warning:
      'border-amber-300 bg-amber-400 text-amber-950 shadow-[0_12px_30px_rgba(251,191,36,0.22)] hover:bg-amber-300',
    success:
      'border-emerald-300 bg-emerald-500 text-white shadow-[0_12px_30px_rgba(16,185,129,0.22)] hover:bg-emerald-400',
    neutral:
      'border-slate-300 bg-slate-700 text-white shadow-[0_12px_30px_rgba(51,65,85,0.2)] hover:bg-slate-600',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full sm:w-auto rounded-full border px-5 py-2.5 sm:py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:border-black/5 disabled:bg-neutral-200 disabled:text-neutral-400 disabled:shadow-none ${palette[tone]}`}
    >
      {children}
    </button>
  );
}

const statusLabelMap: Record<OrderStatus, string> = {
  PENDING: 'Pendiente',
  CONFIRMED: 'Confirmado',
  PREPARING: 'En preparacion',
  READY: 'Listo',
  PICKED_UP: 'Recogido',
  IN_TRANSIT: 'En camino',
  COMPLETED: 'Recogido',
  DELIVERED: 'Entregado',
  CANCELLED: 'Cancelado',
  REJECTED: 'Rechazado',
};

const socketStatusCopy: Record<'idle' | 'connecting' | 'connected' | 'reconnecting', string> = {
  idle: 'Tiempo real inactivo.',
  connecting: 'Conectando tablero en tiempo real...',
  connected: 'Tablero en tiempo real activo.',
  reconnecting: 'Reconectando tablero en tiempo real...',
};

function buildLiveEventKey(
  eventName: (typeof liveEvents)[number],
  payload: { orderId?: string; orderReference?: string; customerName?: string; status?: string }
) {
  return [
    eventName,
    payload.orderId || 'order',
    payload.orderReference || 'reference',
    payload.status || 'status',
    payload.customerName || 'customer',
  ].join(':');
}

function buildRestaurantLiveMessage(
  eventName: (typeof liveEvents)[number],
  payload: { orderId?: string; orderReference?: string; customerName?: string; status?: string }
) {
  const orderLabel = payload.orderReference || payload.orderId || 'pedido activo';

  if (eventName === 'order:created') {
    return payload.customerName
      ? `Entró ${orderLabel} para ${payload.customerName}.`
      : `Entró ${orderLabel} y el tablero se resincronizó.`;
  }

  if (eventName === 'order:driver-accepted') {
    return `Un repartidor confirmó ${orderLabel}.`;
  }

  if (eventName === 'order:driver-rejected') {
    return `Se rechazó la asignación de ${orderLabel}; revisa la salida.`;
  }

  if (eventName === 'order:picked-up') {
    return `${orderLabel} ya fue recogido.`;
  }

  if (eventName === 'order:in-transit') {
    return `${orderLabel} ya va en camino.`;
  }

  if (eventName === 'order:support-requested') {
    return `¡Un restaurante cercano solicita apoyo para una entrega!`;
  }

  if (eventName === 'order:no-drivers-available' as any) {
    return `No hay repartidores disponibles para ${orderLabel}.`;
  }

  if (eventName === 'order:driver-arrived-restaurant' as any) {
    const driverName = (payload as any).driverName || 'El repartidor';
    return `¡${driverName} llegó al restaurante para recoger ${orderLabel}!`;
  }

  if (eventName === 'order:queue-next') {
    return `Siguiente pedido activado. ${orderLabel} ahora está en turno.`;
  }

  if (eventName === 'order:cancellation-requested') {
    return `🧾 Cliente solicita cancelar ${orderLabel}.`;
  }

  if (eventName === 'order:cancellation-request-retracted') {
    return `El cliente retiró la solicitud de cancelación de ${orderLabel}.`;
  }

  return `${orderLabel} quedó entregado.`;
}


function getRestaurantActions(order: OrderItem, hasOwnDelivery: boolean): Array<keyof typeof restaurantActionMap> {
  const status = order.status;
  if (status === 'PENDING') {
    return ['accept', 'reject'];
  }

  if (status === 'CONFIRMED' || status === 'PREPARING') {
    return ['ready'];
  }

  if (status === 'READY') {
    if (!hasOwnDelivery && order.driver) {
      return ['handover'];
    }
  }

  if (status === 'IN_TRANSIT') {
    if (hasOwnDelivery) {
      return ['delivered'];
    }
    return [];
  }

  return [];
}

function formatAddress(address?: OrderItem['address']) {
  if (!address) {
    return 'Direccion no disponible.';
  }

  const base = `${address.street} ${address.number}, ${address.neighborhood}`;
  return address.reference ? `${base}. Ref: ${address.reference}` : base;
}

function formatIncomingOrderAddress(address?: OrderItem['address']) {
  if (!address) {
    return 'Direccion no disponible.';
  }

  return `${address.street} ${address.number}, ${address.neighborhood}`;
}

function buildRestaurantInitials(name: string) {
  const words = name
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)
    .slice(0, 2);

  return words.map((word) => word[0]?.toUpperCase() || '').join('') || 'ST';
}

function countOrderProducts(order: OrderItem) {
  return order.items?.reduce((sum, item) => sum + item.quantity, 0) || 0;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatSettlementReference(ref: string): string {
  if (!ref) return '';
  const parts = ref.split('-');
  if (parts[0] === 'SETTLE' && parts.length >= 5) {
    const cuid = parts[1];
    const year = parts[2].slice(-2);
    const month = parts[3].padStart(2, '0');
    const day = parts[4].padStart(2, '0');
    const suffix = cuid.slice(-6).toUpperCase();
    return `CRT-${year}${month}${day}-${suffix}`;
  }
  if (ref.startsWith('OP-') && parts.length >= 3) {
    const suffix = parts[1].toUpperCase();
    const timestamp = Number(parts[2]);
    if (!isNaN(timestamp)) {
      const date = new Date(timestamp);
      const year = date.getFullYear().toString().slice(-2);
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const day = date.getDate().toString().padStart(2, '0');
      return `OP-${year}${month}${day}-${suffix}`;
    }
  }
  return ref;
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(date));
}

function formatHourLabel(hour: number) {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);

  return new Intl.DateTimeFormat('es-MX', {
    hour: 'numeric',
  }).format(date);
}

function formatWeekday(date: Date) {
  return new Intl.DateTimeFormat('es-MX', { weekday: 'short' })
    .format(date)
    .replace('.', '')
    .slice(0, 3);
}

function formatCalendarDate(date: Date) {
  return new Intl.DateTimeFormat('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date);
}

function formatCountdown(remainingMs: number) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getPreparationRemainingMs(order: OrderItem, nowMs: number) {
  if (!order.preparationDeadlineAt) {
    return null;
  }

  return new Date(order.preparationDeadlineAt).getTime() - nowMs;
}

function formatPreparationCountdown(order: OrderItem, nowMs: number) {
  const remainingMs = getPreparationRemainingMs(order, nowMs);

  if (remainingMs === null) {
    return order.preparationTimeMinutes ? `${order.preparationTimeMinutes} min estimados` : 'Tiempo por definir';
  }

  if (remainingMs <= 0) {
    return `Tiempo vencido por ${formatCountdown(Math.abs(remainingMs))}`;
  }

  return `${formatCountdown(remainingMs)} restantes`;
}

function isPreparationTimeUrgent(order: OrderItem, nowMs: number) {
  const remainingMs = getPreparationRemainingMs(order, nowMs);
  return typeof remainingMs === 'number' && remainingMs <= 2 * 60 * 1000;
}

function shouldShowExtendTimeControls(order: OrderItem) {
  return order.status === 'CONFIRMED' || order.status === 'PREPARING';
}

function formatShortTime(date?: string | null) {
  if (!date) {
    return 'Calculando';
  }

  return new Intl.DateTimeFormat('es-MX', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(date));
}

function calculateEstimatedArrivalPreview(
  preparationTimeMinutes: PreparationPresetMinutes,
  deliveryWindowMinutes: number
) {
  return new Date(Date.now() + (preparationTimeMinutes + Math.max(deliveryWindowMinutes, 0)) * 60 * 1000);
}

async function persistUploadedImageSource(params: {
  apiBase: string;
  token: string;
  source: string;
  kind: 'restaurant-cover' | 'restaurant-logo' | 'product-image';
  fallbackMessage: string;
}) {
  if (!params.source.startsWith('data:')) {
    return params.source;
  }

  const uploaded = await uploadMediaAsset({
    apiBase: params.apiBase,
    token: params.token,
    kind: params.kind,
    source: params.source,
    fallbackMessage: params.fallbackMessage,
    fallbackToSource: true,
  });

  return uploaded.url;
}

function isCurrentlyWithinOperatingHours(operatingHours?: any[]) {
  return true;
}

function getRestaurantOperationalStatusLabel(status?: string, isAcceptingOrders?: boolean, isPaused?: boolean, isWithinHours = true) {
  if (status === 'ACTIVE') {
    if (isPaused) return 'Negocio pausado';
    if (!isAcceptingOrders) return 'Negocio cerrado';
    return isWithinHours ? 'Negocio abierto' : 'Cerrado (fuera de horario)';
  }

  if (status === 'DELETED') {
    return 'Negocio eliminado';
  }

  return 'Negocio suspendido';
}

function getRestaurantOperationalStatusTone(status?: string, isAcceptingOrders?: boolean, isPaused?: boolean, isWithinHours = true) {
  if (status === 'ACTIVE') {
    if (isPaused) return 'bg-sky-100 text-sky-700';
    if (!isAcceptingOrders) return 'bg-neutral-100 text-neutral-600';
    return isWithinHours ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700 border-rose-200';
  }

  if (status === 'DELETED') {
    return 'bg-rose-100 text-rose-700';
  }

  return 'bg-sky-100 text-sky-700';
}

function getImageValidationMessage(value: string, kind: 'cover' | 'logo' | 'product') {
  if (!value) {
    return '';
  }

  if (value.startsWith('data:')) {
    return /^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(value)
      ? ''
      : kind === 'cover'
        ? 'La portada debe ser una imagen valida en formato data URL.'
        : kind === 'logo'
          ? 'El logo debe ser una imagen valida en formato data URL.'
          : 'La imagen del producto debe ser una imagen valida en formato data URL.';
  }

  try {
    const parsedUrl = new URL(value);

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return kind === 'cover'
        ? 'La portada debe usar una URL http(s) o una imagen cargada desde tu equipo.'
        : kind === 'logo'
          ? 'El logo debe usar una URL http(s) o una imagen cargada desde tu equipo.'
          : 'La imagen del producto debe usar una URL http(s) o una imagen cargada desde tu equipo.';
    }

    return '';
  } catch {
    return kind === 'cover'
      ? 'Pega una URL valida o sube una imagen desde tu equipo.'
      : kind === 'logo'
        ? 'Pega una URL valida o sube una imagen desde tu equipo para el logo.'
        : 'Pega una URL valida o sube una imagen desde tu equipo para el producto.';
  }
}

async function ensureImageSourceCanLoad(source: string, kind: 'cover' | 'logo' | 'product') {
  await new Promise<void>((resolve, reject) => {
    const image = new Image();
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(
        new Error(
          kind === 'cover'
            ? 'No se pudo verificar la portada. Revisa la URL o intenta con otra imagen.'
            : kind === 'logo'
              ? 'No se pudo verificar el logo. Revisa la URL o intenta con otra imagen.'
              : 'No se pudo verificar la imagen del producto. Revisa la URL o intenta con otra imagen.'
        )
      );
    }, 8000);

    function cleanup() {
      window.clearTimeout(timeoutId);
      image.onload = null;
      image.onerror = null;
    }

    image.onload = () => {
      cleanup();
      resolve();
    };
    image.onerror = () => {
      cleanup();
      reject(
        new Error(
          kind === 'cover'
            ? 'La URL no devuelve una imagen valida para la portada.'
            : kind === 'logo'
              ? 'La URL no devuelve una imagen valida para el logo.'
              : 'La URL no devuelve una imagen valida para el producto.'
        )
      );
    };
    image.src = source;
  });
}

interface CountdownTextProps {
  order: OrderItem;
  className?: string;
}

const CountdownText: React.FC<CountdownTextProps> = ({ order, className = "" }) => {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!order.preparationDeadlineAt) {
      return;
    }

    const updateTimer = () => {
      setNow(Date.now());
    };

    updateTimer();
    const intervalId = window.setInterval(updateTimer, 1000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        updateTimer();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [order.preparationDeadlineAt]);

  const remainingMs = getPreparationRemainingMs(order, now);

  if (remainingMs === null) {
    return (
      <span className={className}>
        {order.preparationTimeMinutes ? `${order.preparationTimeMinutes} min estimados` : 'Tiempo por definir'}
      </span>
    );
  }

  const isUrgent = remainingMs <= 2 * 60 * 1000;
  const isExpired = remainingMs <= 0;

  const textClass = isUrgent ? 'text-amber-600 font-bold' : '';

  if (isExpired) {
    const overdueMin = Math.max(1, Math.round(Math.abs(remainingMs) / 60000));
    return (
      <span className={className}>
        Atrasado {overdueMin} min
      </span>
    );
  }

  return (
    <span className={`${textClass} ${className}`}>
      {formatCountdown(remainingMs)} restantes
    </span>
  );
};
