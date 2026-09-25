'use client';
import { AlertTriangle, Check, ChevronUp, Clock, Info, Mail, MessageCircle, Minus, Package, Pencil, Plus, RefreshCw, Sparkles, Tag, Trash2, User, Wand2, X } from 'lucide-react';

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
  forceSessionExpired,
  requestJson,
  uploadMediaAsset,
  convertImageFileToDataUrl,
  preloadAll,
  warmup,
  play,
  stopAll,
  getAudioState,
  installWarmupListeners,
  installVisibilityResumeListener,
  reset,
  getMenuThemeById,
} from '@sadel/shared';

import { useForegroundPolling } from '../hooks/useForegroundPolling';
import { printHtmlString, NativePrintError } from '../utils/printHelper';
import { generateTicketHtml } from '../utils/ticketGenerator';
import { SaDelLogo } from '../components/SaDelLogo';
import { SaDelLoader } from '../components/SaDelLoader';
import { DashboardSection } from '../components/sections/DashboardSection';
import { BillingSection } from '../components/sections/BillingSection';
import { SettingsSection } from '../components/sections/SettingsSection';
import { FeaturedSection } from '../components/sections/FeaturedSection';
import PushEnableBanner from '../components/PushEnableBanner';
import { createPlacesSource } from '../lib/places';
import { ensureGoogleMapsScript } from '../lib/googleMaps';
import {
  isNativePlatform,
  checkNativePushPermission,
  requestNativePushPermission,
  registerNativePush,
  onNativeNotificationTap,
  nativeGeoWatch,
  nativeKeepAwake,
  nativeAllowSleep,
  nativeHaptic,
} from '../lib/native';

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
  deliveryPricingModel?: string | null;
  deliveryBaseRate?: number | null;
  deliveryPerKmRate?: number | null;
  deliveryMinFee?: number | null;
  deliveryMaxFee?: number | null;
  maxCashOrder?: number | null;
  acceptsCash?: boolean | null;
  hasOwnDelivery: boolean;
  supportsNetworkDelivery?: boolean;
  pickupOnly?: boolean;
  autoOpenEnabled?: boolean;
  accentColor?: string | null;
  menuTheme?: string | null;
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
  promoFreeDeliveryThreshold?: number | null;
  promoMinOrderAmount?: number | null;
  promoMinOrderPercent?: number | null;
};

type OperatingHourItem = {
  dayOfWeek: number;
  shiftIndex: number;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
};

type OrderItem = {
  id: string;
  orderReference: string;
  restaurantId?: string;
  supportRestaurantId?: string | null;
  isSupportRequested?: boolean;
  supportRequestedAt?: string | null;
  supportCount?: number;
  supportRejectionCount?: number;
  supportAttempts?: number;
  supportRestaurant?: {
    id: string;
    name: string;
    contactPhone?: string | null;
  };
  status: OrderStatus;
  totalAmount: number;
  deliveryFee: number;
  serviceFee?: number;
  platformFee?: number;
  promoCode?: string | null;
  promoDiscountAmount?: number | null;
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
  scheduledDeliveryCustomerAcceptedAt?: string | null;
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
      lastName?: string;
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
  promoType?: 'MULTI_BUY' | null;
  promoBuyQuantity?: number | null;
  promoPayQuantity?: number | null;
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
  trackStock?: boolean;
  stock?: number | null;
  lowStockThreshold?: number | null;
  isAvailable: boolean;
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
  whatsappFeeRevenue: number;
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
    whatsappFeeTotal: number;
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
  supportsNetworkDelivery: boolean;
  pickupOnly: boolean;
  accentColor: string | null;
  menuTheme: string | null;
  minDeliveryTime: string;
  maxDeliveryTime: string;
  deliveryFee: string;
  deliveryRadius: string;
  deliveryPricingModel: 'fixed' | 'distance';
  deliveryBaseRate: string;
  deliveryPerKmRate: string;
  deliveryMinFee: string;
  deliveryMaxFee: string;
  maxCashOrder: string;
  acceptsCash: boolean;
  storeCategories: string[];
  enableTicketPrinting: boolean;
  whatsappNotifications: boolean;
  instagram: string;
  facebook: string;
  tiktok: string;
  promoFreeDeliveryThreshold: string;
  promoMinOrderAmount: string;
  promoMinOrderPercent: string;
};
type ProductDraft = {
  id?: string;
  categoryId: string;
  name: string;
  description: string;
  price: string;
  discountPrice?: string;
  promoType?: 'MULTI_BUY' | null;
  promoBuyQuantity?: string;
  promoPayQuantity?: string;
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
  trackStock: boolean;
  stock: string;
  lowStockThreshold: string;
  optionGroups?: ProductOptionGroup[];
};

function cloneOptionGroups(groups: ProductOptionGroup[]): ProductOptionGroup[] {
  return groups.map((group) => ({
    ...group,
    options: (group.options || []).map((option) => ({ ...option })),
  }));
}

function buildEmptyProductDraft(
  categoryId: string,
  template?: {
    sellBy?: ProductDraft['sellBy'];
    unitPrice?: string;
    minWeightG?: string;
    maxWeightG?: string;
    stepWeightG?: string;
    weightPresets?: number[];
    imagePosition?: string;
    imageZoom?: number;
    isAdultOnly?: boolean;
    optionGroups?: ProductOptionGroup[];
  },
): ProductDraft {
  return {
    id: undefined,
    categoryId,
    name: '',
    description: '',
    price: '',
    discountPrice: '',
    promoType: null,
    promoBuyQuantity: '',
    promoPayQuantity: '',
    sellBy: template?.sellBy || 'UNIT',
    unitPrice: template?.unitPrice || '',
    minWeightG: template?.minWeightG || '100',
    maxWeightG: template?.maxWeightG || '5000',
    stepWeightG: template?.stepWeightG || '100',
    weightPresets: template?.weightPresets?.length ? [...template.weightPresets] : [100, 200, 300, 500, 1000],
    image: '',
    images: [],
    imagePosition: template?.imagePosition || '50% 50%',
    imageZoom: template?.imageZoom || 100,
    isAdultOnly: template?.isAdultOnly ?? false,
    trackStock: false,
    stock: '',
    lowStockThreshold: '5',
    optionGroups: template?.optionGroups ? cloneOptionGroups(template.optionGroups) : [],
  };
}

function validateProductConsistency(draft: ProductDraft): string | null {
  const price = Number(draft.price);
  const discountPrice = draft.discountPrice ? Number(draft.discountPrice) : null;
  const buy = draft.promoBuyQuantity ? Number(draft.promoBuyQuantity) : 0;
  const pay = draft.promoPayQuantity ? Number(draft.promoPayQuantity) : 0;
  const hasPromo = draft.promoType === 'MULTI_BUY';

  if (!Number.isFinite(price) || price <= 0) {
    return 'El precio debe ser un número mayor a cero.';
  }

  if (discountPrice != null) {
    if (!Number.isFinite(discountPrice) || discountPrice <= 0) {
      return 'El precio especial debe ser un número mayor a cero.';
    }
    if (discountPrice >= price) {
      return 'El precio especial debe ser menor al precio normal para que el descuento sea válido.';
    }
  }

  if (hasPromo) {
    if (!Number.isFinite(buy) || !Number.isFinite(pay) || buy <= 0 || pay <= 0) {
      return 'Indica cantidades válidas para la promoción por cantidad (comprar y pagar mayores a cero).';
    }
    if (pay >= buy) {
      return 'La promoción no es válida: la cantidad a pagar debe ser menor a la cantidad a comprar (ej. comprar 2, pagar 1).';
    }
  }

  if (draft.sellBy === 'WEIGHT') {
    const min = Number(draft.minWeightG);
    const max = Number(draft.maxWeightG);
    const step = Number(draft.stepWeightG);

    if (!Number.isFinite(min) || min <= 0) {
      return 'Indica un peso mínimo válido (mayor a cero).';
    }
    if (!Number.isFinite(max) || max <= 0 || max <= min) {
      return 'El peso máximo debe ser mayor al mínimo.';
    }
    if (!Number.isFinite(step) || step <= 0) {
      return 'Indica un incremento de peso válido (mayor a cero).';
    }

    const presets = draft.weightPresets || [];
    for (const preset of presets) {
      if (!Number.isFinite(preset) || preset <= 0) {
        return 'Los accesos rápidos deben ser pesos válidos (mayores a cero).';
      }
      if (preset < min || preset > max) {
        return `El acceso rápido ${formatWeight(preset)} está fuera del rango permitido (${formatWeight(min)} – ${formatWeight(max)}).`;
      }
    }
  }

  if (draft.trackStock) {
    const stock = draft.stock ? Number(draft.stock) : 0;
    if (!Number.isFinite(stock) || stock < 0) {
      return 'El stock debe ser un número mayor o igual a cero.';
    }
    const threshold = draft.lowStockThreshold ? Number(draft.lowStockThreshold) : 5;
    if (!Number.isFinite(threshold) || threshold < 0) {
      return 'La alerta de pocas unidades debe ser un número mayor o igual a cero.';
    }
  }

  return null;
}

import {
  type ImportFieldKey,
  IMPORT_FIELD_LABELS,
  IMPORT_FIELD_ORDER,
  type CsvDelimiter,
  guessCsvDelimiter,
  parseCsvRows,
  detectCsvHeaderRow,
  autoMapImportColumns,
  parseImportPrice,
  isValidHttpUrl,
  resolveSellBy,
} from '../utils/csvImport';

// Logs de depuración: solo con ?debug en la URL para mantener la consola limpia en producción.
function isDebugEnabled(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug');
}
function debugLog(...args: unknown[]): void {
  if (isDebugEnabled()) {
    // eslint-disable-next-line no-console
    console.log(...args);
  }
}

const defaultApiBase = 'https://sadel-production.up.railway.app';
function getCanonicalCustomerUrl(): string {
  return 'https://pideloporsadel.app';
}

function getCustomerOrigin(): string {
  // NUNCA usar un *.vercel.app como origen del comensal: es un preview/deplegado
  // temporal, no el dominio público. Si la env quedó mal configurada, ignorarla.
  const customerUrl = process.env.NEXT_PUBLIC_CUSTOMER_URL;
  if (customerUrl && !customerUrl.includes('.vercel.app')) return customerUrl;
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
  }
  // La app del comensal nunca se sirve desde un hostname *.vercel.app
  // (esos dominios pertenecen al host actual del panel). Devolvemos el
  // origen canónico de producción para nunca generar links con el preview.
  return getCanonicalCustomerUrl();
}

/**
 * Origen de la app del comensal. El backend entrega la URL canónica en el
 * payload del QR (campo `url`); esta función es SOLO un fallback para
 * desarrollo/localhost o cuando el backend aun no la provee.
 */
function resolveCustomerOrigin(): string {
  const customerUrl = process.env.NEXT_PUBLIC_CUSTOMER_URL;
  if (customerUrl && !customerUrl.includes('.vercel.app')) return customerUrl;
  const guessed = getCustomerOrigin();
  if (guessed && !guessed.includes('.vercel.app')) return guessed;
  // Devolvemos el origen canónico de producción. NUNCA usamos el host actual
  // del panel (puede ser un preview de Vercel o el subdominio del panel).
  return getCanonicalCustomerUrl();
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
  'order:driver-auto-unassigned',
  'order:picked-up',
  'order:in-transit',
  'order:eta-updated',
  'order:delivered',
  'order:support-requested',
  'order:support-accepted',
  'order:support-rejected-all',
  'order:support-exhausted',
  'order:support-picked-up',
  'order:no-drivers-available',
  'order:driver-arrived-restaurant',
  'order:queue-next',
  'order:cancellation-requested',
  'order:cancellation-request-retracted',
  'order:schedule-accepted',
  'order:schedule-rejected',
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
    shiftIndex: 0,
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

  return items
    .map((item, index) => ({
      dayOfWeek: item.dayOfWeek,
      shiftIndex: typeof item.shiftIndex === 'number' ? item.shiftIndex : index,
      openTime: item.openTime || '09:00',
      closeTime: item.closeTime || '18:00',
      isClosed: item.isClosed ?? false,
    }))
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.shiftIndex - b.shiftIndex);
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
  if (typeof window === 'undefined') return;
  if (isNativePlatform()) {
    nativeHaptic(pattern);
    return;
  }
  if (navigator.vibrate) {
    navigator.vibrate(pattern);
  }
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
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
    icon: (<Clock className="w-4 h-4" strokeWidth={1.8} />),
    label: 'Horarios', desc: 'Días y horas de servicio' },
  { key: 'pagos',
    icon: (<Mail className="w-4 h-4" strokeWidth={1.8} />),
    label: 'Métodos de pago', desc: 'Transferencias y cuenta bancaria' },
  { key: 'seguridad',
    icon: (<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>),
    label: 'Seguridad', desc: 'Contraseña y acceso' },
  { key: 'preferencias',
    icon: (<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>),
    label: 'Preferencias', desc: 'Alertas y panel' },
  { key: 'cupones',
    icon: (<Tag className="w-4 h-4" strokeWidth={1.8} />),
    label: 'Cupones', desc: 'Códigos y descuentos' },
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

function getRestaurantCollectionAmount(
  order: OrderItem,
  profile?: { id?: string; hasOwnDelivery?: boolean } | null
): number {
  if (order.supportRestaurantId && profile?.id && order.restaurantId !== profile.id) {
    return order.deliveryFee || 0;
  }
  if (order.deliveredByRestaurant || (order.restaurant?.hasOwnDelivery ?? profile?.hasOwnDelivery ?? true)) {
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
  const autocompleteSessionTokenRef = useRef<any>(null);
  const placesServiceRef = useRef<any>(null);
  const addressSearchSourceRef = useRef<ReturnType<typeof createPlacesSource> | null>(null);
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
    distanceToDeliveryKm?: number | null;
    supportAttempts?: number;
    attemptsLeft?: number;
    expiresAt: number;
  }>>([]);
  const [supportNotifyByOrder, setSupportNotifyByOrder] = useState<Record<string, { attemptsLeft: number; exhausted: boolean }>>({});
  const [supportAliadoNamesByOrder, setSupportAliadoNamesByOrder] = useState<Record<string, string>>({});
  const [supportCountdownNow, setSupportCountdownNow] = useState(() => Date.now());
  const supportAlertLoopRef = useRef<ReturnType<typeof setInterval> | null>(null);
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
  const [, setCancelRequestNote] = useState('');
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
  const [activeHelpTab, setActiveHelpTab] = useState<'simulator' | 'faqs' | 'transfers' | 'support' | 'notifications'>('simulator');
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
  const [activeQrCodeData, setActiveQrCodeData] = useState<{ token: string; orderReference: string; id: string; url?: string } | null>(null);
  const [incomingOrderQueue, setIncomingOrderQueue] = useState<string[]>([]);
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
  const [scheduledMeridiem, setScheduledMeridiem] = useState<'AM' | 'PM'>('PM');
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
    supportsNetworkDelivery: true,
    pickupOnly: false,
    accentColor: null,
    menuTheme: null,
    minDeliveryTime: '',
    maxDeliveryTime: '',
    deliveryFee: '',
    deliveryRadius: '',
    deliveryPricingModel: 'fixed',
    deliveryBaseRate: '',
    deliveryPerKmRate: '',
    deliveryMinFee: '',
    deliveryMaxFee: '',
    maxCashOrder: '',
    acceptsCash: true,
    storeCategories: [],
    enableTicketPrinting: true,
    whatsappNotifications: false,
    instagram: '',
    facebook: '',
    tiktok: '',
    promoFreeDeliveryThreshold: '',
    promoMinOrderAmount: '',
    promoMinOrderPercent: '',
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
  const [generatingProductImage, setGeneratingProductImage] = useState(false);
  const [productImageValidationError, setProductImageValidationError] = useState('');
  const [activeAvailabilityProductId, setActiveAvailabilityProductId] = useState<string | null>(null);
  const [continueAfterSave, setContinueAfterSave] = useState(false);
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
    trackStock: false,
    stock: '',
    lowStockThreshold: '5',
  });
  const [weightUnit, setWeightUnit] = useState<'kg' | 'g'>('kg');
  const [presetInput, setPresetInput] = useState('');
  const [presetInputError, setPresetInputError] = useState('');
  const [productConfigInherited, setProductConfigInherited] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importHasHeader, setImportHasHeader] = useState(false);
  const [importColumnMap, setImportColumnMap] = useState<Record<ImportFieldKey, number | undefined>>({
    name: 0,
    price: 1,
    category: 2,
    sellBy: 3,
    description: 4,
    discountPrice: 5,
    image: 6,
  });
  const [importDefaultCategoryId, setImportDefaultCategoryId] = useState('');
  const [importCreateMissingCategories, setImportCreateMissingCategories] = useState(true);
  const [importingProducts, setImportingProducts] = useState(false);
  const [importResult, setImportResult] = useState<{
    created: number;
    skipped: number;
    errors: { index: number; name: string; message: string }[];
  } | null>(null);
  const [storeViewMode, setStoreViewMode] = useState<'cards' | 'list'>('list');
  const [storeSearchQuery, setStoreSearchQuery] = useState('');
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [bulkCategoryTargetId, setBulkCategoryTargetId] = useState('');
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [isBulkDeleteModalOpen, setIsBulkDeleteModalOpen] = useState(false);
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
  const pendingEtaExtensionOrderIdRef = useRef<string | null>(null);
  // Ref a la función de suscripción push (se define más abajo); el SW la invoca
  // cuando el navegador rota/expira la suscripción (PUSH_SUBSCRIPTION_CHANGED).
  const subscribeToPushRef = useRef<((token: string) => Promise<unknown>) | null>(null);

  // ============================================================
  // Tracking GPS del reparto propio / apoyo (reparto a cargo del
  // restaurante). Se activa solo cuando el restaurante va en camino
  // a entregar un pedido (deliveredByRestaurant o ApoyoId en IN_TRANSIT).
  // ============================================================
  const gpsRescheduleRef = useRef<(() => void) | null>(null);

  const hasActiveOwnDeliveries = useMemo(
    () =>
      orders.some(
        (o) =>
          o.fulfillmentType !== 'PICKUP' &&
          ['PICKED_UP', 'IN_TRANSIT'].includes(o.status) &&
          (o.deliveredByRestaurant === true ||
            (typeof o.notes === 'string' && o.notes.includes('[ApoyoId:')))
      ),
    [orders]
  );

  useEffect(() => {
    gpsRescheduleRef.current?.();
  }, [hasActiveOwnDeliveries]);

  useEffect(() => {
    if (!token || !sessionUser || sessionUser.role !== 'RESTAURANT') {
      return;
    }

    if (typeof window === 'undefined') {
      return;
    }

    const GEO_PAUSE_KEY = 'sadel.restaurant.geoPausedUntil';

    let watchId: number | null = null;
    let nativeWatch: { clear: () => void } | null = null;
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

    // El restaurante solo comparte ubicación mientras tiene un reparto
    // propio/apoyo EN TRÁNSITO (el panel no corre de fondo como el repartidor).
    const getTrackingMode = () => {
      const currentOrders = ordersRef.current;
      const hasActive = currentOrders.some(
        (o) =>
          o.fulfillmentType !== 'PICKUP' &&
          ['PICKED_UP', 'IN_TRANSIT'].includes(o.status) &&
          (o.deliveredByRestaurant === true ||
            (typeof o.notes === 'string' && o.notes.includes('[ApoyoId:')))
      );
      return { hasActive, shouldTrack: hasActive };
    };

    const shouldSend = (lat: number, lng: number) => {
      if (!lastPosition) return true;
      const deltaLat = Math.abs(lat - lastPosition.lat);
      const deltaLng = Math.abs(lng - lastPosition.lng);
      return !(deltaLat < 0.00006 && deltaLng < 0.00006);
    };

    const postLocation = async (lat: number, lng: number) => {
      const now = Date.now();
      // Cadencia densa: el rastreo solo corre mientras se entrega.
      if (now - lastPostAt < 6000) return;
      lastPostAt = now;

      try {
        await requestJson({
          apiBase,
          path: '/restaurant-panel/ubicacion',
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
      if (nativeWatch) {
        nativeWatch.clear();
        nativeWatch = null;
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

    const startWatching = async () => {
      stopWatching();
      if (cancelled || document.visibilityState === 'hidden') return;

      const { shouldTrack } = getTrackingMode();
      if (!shouldTrack) return;

      const pausedUntil = readPausedUntil();
      if (Date.now() < pausedUntil) return;

      if (isNativePlatform()) {
        // En la app nativa se usa el GPS del plugin (con permiso runtime);
        // si no hay plugin disponible, se cae al watch del navegador.
        nativeWatch = await nativeGeoWatch(onPositionSuccess, onPositionError, {
          enableHighAccuracy: true,
          timeout: 20000,
          maximumAge: 10000,
        });
        if (!nativeWatch) {
          watchId = navigator.geolocation.watchPosition(
            onPositionSuccess,
            onPositionError,
            {
              enableHighAccuracy: true,
              timeout: 20000,
              maximumAge: 10000,
            }
          );
        }
        return;
      }

      // Alta precisión: rastreo activo solo al entregar.
      watchId = navigator.geolocation.watchPosition(
        onPositionSuccess,
        onPositionError,
        {
          enableHighAccuracy: true,
          timeout: 20000,
          maximumAge: 10000,
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
  }, [token, sessionUser, apiBase]);
  const navigateToOrder = useCallback((orderId: string) => {
    const currentOrders = ordersRef.current;
    const order = currentOrders?.find?.((o: any) => o.id === orderId);
    if (order) {
      setActiveSection('orders');
      setSelectedOrderForTicket(order);
      if (pendingEtaExtensionOrderIdRef.current === orderId) {
        setSelectedOrderForEtaExtension(order);
        pendingEtaExtensionOrderIdRef.current = null;
      }
    } else {
      pendingNotificationOrderIdRef.current = orderId;
      setActiveSection('orders');
    }
  }, []);
  const promptedIncomingOrderIdsRef = useRef<string[]>([]);
  const resolvedIncomingOrderIdsRef = useRef<string[]>([]);
  const autoRejectingOrderIdsRef = useRef<string[]>([]);
  const soundedIncomingOrderIdsRef = useRef<string[]>([]);
  const wakeLockRef = useRef<any>(null);
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
  const lastProductConfigRef = useRef<{
    sellBy: ProductDraft['sellBy'];
    unitPrice: string;
    minWeightG: string;
    maxWeightG: string;
    stepWeightG: string;
    weightPresets: number[];
    imagePosition: string;
    imageZoom: number;
    isAdultOnly: boolean;
    optionGroups: ProductOptionGroup[];
  } | null>(null);
  const productNameInputRef = useRef<HTMLInputElement | null>(null);
  const productPriceInputRef = useRef<HTMLInputElement | null>(null);
  const productModalScrollRef = useRef<HTMLDivElement | null>(null);

  // Pull-to-refresh con listeners nativos en window (misma implementación que
  // la app del cliente): el gesto se captura con passive:false + preventDefault
  // para que el navegador no lo secuestre como scroll, y se excluyen contenedores
  // scrolleables internos (listas, modales, carruseles).
  const loadDashboardRef = useRef<() => Promise<void>>(async () => {});
  const handlePullToRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await loadDashboardRef.current();
    } finally {
      setIsRefreshing(false);
      setPullDistance(0);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !('ontouchstart' in window)) return;

    let startY = -1;
    let tracking = false;
    let reloading = false;

    const atTop = () => {
      const docEl = document.documentElement;
      const scrollTop = window.pageYOffset || docEl.scrollTop || 0;
      return scrollTop <= 1;
    };

    const onTouchStart = (e: TouchEvent) => {
      // Desbloquear audio de notificaciones en el primer toque (iOS).
      void warmup();
      if (reloading) return;
      if (!atTop()) return;
      const target = e.target as HTMLElement | null;
      if (target && target.closest('.overflow-x-auto, .overflow-y-auto, .overflow-auto, [data-no-pull]')) return;
      startY = e.touches[0]?.clientY ?? -1;
      tracking = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!tracking || reloading) return;
      if (!atTop()) {
        tracking = false;
        setPullDistance(0);
        return;
      }
      const currentY = e.touches[0]?.clientY ?? -1;
      if (startY < 0 || currentY < 0) return;
      const distance = currentY - startY;
      if (distance <= 0) return;
      e.preventDefault();
      setPullDistance(Math.min(distance * 0.5, 80));
    };

    const onTouchEnd = () => {
      if (!tracking || reloading) return;
      tracking = false;
      setPullDistance((current) => {
        if (current > 40) {
          reloading = true;
          void handlePullToRefresh().finally(() => { reloading = false; });
          return current;
        }
        return 0;
      });
      startY = -1;
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [handlePullToRefresh]);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const data = await requestJson<{
          success: boolean;
          data: {
            restaurantWelcomeImage?: string;
            restaurantPromoModalEnabled?: boolean;
            restaurantPromoModalImage?: string;
            adminBankName?: string;
            adminBankAccount?: string;
            adminBankBeneficiary?: string;
          };
        }>({ apiBase, path: '/settings', token });
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
  }, [apiBase, token]);

  useEffect(() => {
    const savedSession = readStoredSession(storageKey);
    if (savedSession.user) {
      setSessionUser(savedSession.user);
      setToken(savedSession.token || '');
      if (savedSession.refreshToken) setRefreshToken(savedSession.refreshToken);
    }
    setCheckingAuth(false);

    if (typeof window !== 'undefined') {
      // El modo oscuro es por sesión: siempre se inicia claro y solo se
      // mantiene mientras el usuario no cierre/recargue la app. Estado del
      // switch sincronizado con la clase real en <html>.
      setIsDarkMode(document.documentElement.classList.contains('dark'));

      const savedSection = window.localStorage.getItem('restaurantActiveSection');
      if (savedSection) {
        setActiveSection(savedSection as RestaurantPortalSection);
      }

      preloadAll(['notifica', 'mensaje', 'llegue', 'rezagado']);

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
    // Solo se restablece la suscripción cuando el permiso YA fue concedido en una
    // sesión anterior. El primer permiso (estado 'default') debe pedirse desde un
    // gesto del usuario (banner "Activar notificaciones"); pedirlo al cargar la
    // página es ignorado en silencio por iOS y Chrome.
    if (!token || typeof window === 'undefined') return;

    if (isNativePlatform()) {
      // En la app nativa el permiso se consulta vía plugin (sin diálogo) y el
      // token FCM se re-sincroniza con el backend en cada arranque.
      let cancelled = false;
      checkNativePushPermission().then((granted) => {
        if (!cancelled && granted) void subscribeToPush(token);
      });
      return () => { cancelled = true; };
    }

    if ('Notification' in window && Notification.permission === 'granted') {
      void subscribeToPush(token);
    }
  }, [token]);

  // Leer orderId de la URL (cuando se da click a una notificación push)
  useEffect(() => {
    if (!token) return;

    const checkUrlForOrderId = () => {
      const params = new URLSearchParams(window.location.search);
      const orderId = params.get('orderId');
      const section = params.get('section');
      if (section === 'billing') {
        window.history.replaceState({}, '', window.location.pathname);
        setActiveSection('billing');
        window.localStorage.setItem('restaurantActiveSection', 'billing');
      }
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
          if (event.data.action === 'extend-eta') {
            pendingEtaExtensionOrderIdRef.current = orderId;
          }
          navigateToOrder(orderId);
        }
      }
      // El navegador rotó/expiró la suscripción push: re-suscribir de inmediato
      // para que el restaurante no se quede sin avisos de pedidos. Sin esto la
      // notificación solo volvía tras reabrir la app manualmente.
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
  }, [navigateToOrder]);

  // En la app nativa, el toque de una notificación FCM llega por el plugin de
  // Capacitor (no hay service worker): navegar al pedido correspondiente.
  useEffect(() => {
    if (typeof window === 'undefined' || !isNativePlatform() || !token) return;

    const off = onNativeNotificationTap(({ orderId, action }) => {
      if (!orderId) return;
      if (action === 'extend-eta') {
        pendingEtaExtensionOrderIdRef.current = orderId;
      }
      navigateToOrder(orderId);
    });
    return off;
  }, [token, navigateToOrder]);

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
        const data = await new Promise<{ id: string; value: string; action?: string } | undefined>((resolve) => {
          const req = store.get('orderId');
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(undefined);
        });
        if (data?.value) {
          // Limpiar inmediatamente
          const cleanTx = db.transaction('pending', 'readwrite');
          cleanTx.objectStore('pending').delete('orderId');
          await new Promise(r => { cleanTx.oncomplete = r; });
          if (data.action === 'extend-eta') {
            pendingEtaExtensionOrderIdRef.current = data.value;
          }
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
      if (pendingEtaExtensionOrderIdRef.current === pendingId) {
        setSelectedOrderForEtaExtension(order);
        pendingEtaExtensionOrderIdRef.current = null;
      }
      pendingNotificationOrderIdRef.current = null;
    }
  }, [orders]);

  useEffect(() => {
    if (activeSection !== 'settings' || activeSettingsTab !== 'ubicacion') {
      return;
    }

    let cancelled = false;

    const initSettingsMap = (google: any) => {
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
    };

    void ensureGoogleMapsScript().then((google) => {
      if (cancelled || !google) return;
      initSettingsMap(google);
    });

    return () => {
      cancelled = true;
    };
  }, [activeSection, activeSettingsTab, storeDraft.latitude, storeDraft.longitude]);

  useEffect(() => {
    if (!storeDraft.address || storeDraft.address.length < 5) {
      addressSearchSourceRef.current?.cancel();
      setAddressSuggestions([]);
      return;
    }

    if (profile && profile.address && storeDraft.address && profile.address.startsWith(storeDraft.address)) {
      addressSearchSourceRef.current?.cancel();
      setAddressSuggestions([]);
      return;
    }

    if (ignoreAddressSearchRef.current) {
      ignoreAddressSearchRef.current = false;
      return;
    }

    if (!addressSearchSourceRef.current) {
      addressSearchSourceRef.current = createPlacesSource({ minLength: 5 });
    }

    addressSearchSourceRef.current.search(storeDraft.address, {
      onResults: (suggestions) => setAddressSuggestions(suggestions.map((s) => ({ display_name: s.name, place_id: s.place_id }))),
      onBusy: setIsSearchingAddress,
    });

    return () => addressSearchSourceRef.current?.cancel();
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

  const subscribeToPush = async (tokenToUse: string): Promise<
    | { ok: true }
    | { ok: false; reason: 'DENIED' | 'BLOCKED' | 'INSECURE' | 'NOT_SUPPORTED' | 'VAPID_NOT_CONFIGURED' | 'SUBSCRIBE_FAILED' | 'UNKNOWN' }
  > => {
    if (typeof window === 'undefined') {
      return { ok: false, reason: 'NOT_SUPPORTED' };
    }

    // App nativa (WebView Capacitor): no hay serviceWorker ni Notification web,
    // se usa FCM con el permiso y el token del plugin.
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

    if (!('serviceWorker' in navigator) || !('Notification' in window)) {
      return { ok: false, reason: 'NOT_SUPPORTED' };
    }

    // Push/Notification requieren un contexto seguro (HTTPS). Sin ello el navegador
    // ignora la petición en silencio: es la causa #1 de "no llegan notificaciones".
    if (window.isSecureContext === false) {
      return { ok: false, reason: 'INSECURE' };
    }

    // Request notification permission first
    if (Notification.permission === 'default') {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          return { ok: false, reason: 'DENIED' };
        }
      } catch {
        return { ok: false, reason: 'DENIED' };
      }
    }
    if (Notification.permission !== 'granted') {
      return { ok: false, reason: 'BLOCKED' };
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
      let data: { publicKey?: string | null; configured?: boolean; error?: { code?: string } };
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
            debugLog('Push subscription already active, re-synced to server');
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
        console.error('Push subscription rejected by server:', subResponse.status, await subResponse.text().catch(() => ''));
        return { ok: false, reason: 'SUBSCRIBE_FAILED' };
      }

      debugLog('Subscribed to push notifications');
      return { ok: true };
    } catch (error) {
      console.error('Failed to subscribe to push:', error);
      return { ok: false, reason: 'SUBSCRIBE_FAILED' };
    }
  };

  // Exponer subscribeToPush al listener del Service Worker (rotación de subs).
  subscribeToPushRef.current = subscribeToPush;

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
        supportsNetworkDelivery: true,
        pickupOnly: false,
        accentColor: null,
        menuTheme: null,
        minDeliveryTime: '',
        maxDeliveryTime: '',
        deliveryFee: '',
        deliveryRadius: '',
        deliveryPricingModel: 'fixed',
        deliveryBaseRate: '',
        deliveryPerKmRate: '',
        deliveryMinFee: '',
        deliveryMaxFee: '',
        maxCashOrder: '',
        acceptsCash: true,
        storeCategories: [],
        enableTicketPrinting: true,
    whatsappNotifications: false,
      instagram: '',
      facebook: '',
      tiktok: '',
      promoFreeDeliveryThreshold: '',
      promoMinOrderAmount: '',
      promoMinOrderPercent: '',
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
      setProductDraft(buildEmptyProductDraft(categories[0]?.id || ''));
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

  const warmOrderAlertAudio = useCallback(async () => {
    const ok = await warmup();
    setOrderAlertAudioState(getAudioState());
    return ok;
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

    const result = play('notifica');
    setOrderAlertAudioState(getAudioState());
    return result === 'played';
  }, [isOrderAlertSoundEnabled]);

  const playDriverArrivedAlert = useCallback(async () => {
    if (!isOrderAlertSoundEnabled) return false;
    const result = play('llegue');
    setOrderAlertAudioState(getAudioState());
    return result === 'played';
  }, [isOrderAlertSoundEnabled]);

  // Alerta de apoyo continua: mientras haya una solicitud sin responder, suena
  // cada pocos segundos y se actualiza el countdown visible del modal.
  useEffect(() => {
    if (supportRequestsQueue.length === 0) {
      if (supportAlertLoopRef.current) {
        clearInterval(supportAlertLoopRef.current);
        supportAlertLoopRef.current = null;
      }
      return;
    }

    let lastSoundAt = 0;
    const tick = () => {
      setSupportCountdownNow(Date.now());
      if (Date.now() - lastSoundAt >= 3000) {
        lastSoundAt = Date.now();
        void playIncomingOrderAlert();
      }
    };
    tick();
    supportAlertLoopRef.current = setInterval(tick, 1000);

    return () => {
      if (supportAlertLoopRef.current) {
        clearInterval(supportAlertLoopRef.current);
        supportAlertLoopRef.current = null;
      }
    };
  }, [supportRequestsQueue.length, playIncomingOrderAlert]);

  // Ticker global (1s) para el countdown de "esperando respuesta de la red" en
  // las tarjetas de pedido. Independiente del loop de sonido para que el countdown
  // avance incluso sin solicitudes de apoyo en cola.
  const supportWaitTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    const tick = () => setSupportCountdownNow(Date.now());
    tick();
    supportWaitTickRef.current = setInterval(tick, 1000);
    return () => {
      if (supportWaitTickRef.current) {
        clearInterval(supportWaitTickRef.current);
        supportWaitTickRef.current = null;
      }
    };
  }, []);

  // Auto-rechazo del modal cuando se agotan los 2 minutos sin responder
  useEffect(() => {
    const headItem = supportRequestsQueue[0];
    if (!headItem || !headItem.expiresAt) return;
    if (headItem.expiresAt > supportCountdownNow) return;

    setSupportRequestsQueue((prev) => prev.filter((item) => item.orderId !== headItem.orderId));
    pushToast('info', 'Tiempo agotado', `La solicitud de ${headItem.restaurantName} expiró sin responder.`);

    void fetch(`${apiBase}/restaurant-panel/pedidos/${headItem.orderId}/rechazar-apoyo`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => undefined);
  }, [supportRequestsQueue, supportCountdownNow, apiBase, token, pushToast]);

  const playOverdueAlert = useCallback(async () => {
    if (!isOrderAlertSoundEnabled) return false;
    const result = play('rezagado');
    setOrderAlertAudioState(getAudioState());
    return result === 'played';
  }, [isOrderAlertSoundEnabled]);

  const playChatPopSound = useCallback(async () => {
    if (!isOrderAlertSoundEnabled) return;
    play('mensaje');
  }, [isOrderAlertSoundEnabled]);

  const handleOrderAlertSoundToggle = useCallback(
    (checked: boolean) => {
      setIsOrderAlertSoundEnabled(checked);

      if (typeof window !== 'undefined') {
        window.localStorage.setItem(orderAlertSoundPreferenceKey, checked ? 'true' : 'false');
      }

      if (checked) {
        hasShownOrderAlertBlockedToastRef.current = false;
        void warmOrderAlertAudio();
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

  const billingFetchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const billingFetchInFlight = useRef(false);

  const fetchBillingSummary = useCallback(async () => {
    if (!token) return;
    if (billingFetchInFlight.current) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    billingFetchInFlight.current = true;
    try {
      const response = await fetch(`${apiBase}/restaurant-panel/facturacion`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (data.success) {
        setBillingSummary(data.data);
      }
    } catch (err) {
      console.error('[Billing] Error fetching summary:', err);
    } finally {
      billingFetchInFlight.current = false;
    }
  }, [apiBase, token]);

  const enqueueBillingRefetch = useCallback((immediate = false) => {
    if (billingFetchRef.current) clearTimeout(billingFetchRef.current);
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const delay = immediate ? 0 : 300;
    billingFetchRef.current = setTimeout(() => {
      void fetchBillingSummary();
    }, delay);
  }, [fetchBillingSummary]);

  // Refetch billing summary when entering the Balance section
  useEffect(() => {
    if (activeSection === 'billing') {
      enqueueBillingRefetch(true);
    }
  }, [activeSection, enqueueBillingRefetch]);

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
      const firstName = (payload.data.user.name || '').split(' ')[0] || 'negocio';
      pushToast(
        'success',
        `¡Bienvenido de nuevo, ${firstName}! 👋`,
        'Sesión iniciada. Tu tienda está lista: revisa tus pedidos y arranca el día con todo. 💪',
      );
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
        address: (() => {
          const raw = profileData.data.address || '';
          if (/pendiente de registro|pendiente de configurac/i.test(raw.trim())) return '';
          return raw.replace(/, No\. .*$/, '');
        })(),
        houseNumber: (() => {
          const match = (profileData.data.address || '').match(/, No\. (.*)$/);
          const tail = match ? match[1] : '';
          return tail && !/pendiente de registro|pendiente de configurac/i.test(tail) ? tail : '';
        })(),
        latitude: profileData.data.latitude ? String(profileData.data.latitude) : '',
        longitude: profileData.data.longitude ? String(profileData.data.longitude) : '',
        contactPhone: profileData.data.contactPhone || '',
        email: profileData.data.email || '',
        logo: profileData.data.logo || '',
        coverImage: profileData.data.coverImage || '',
        hasOwnDelivery: profileData.data.hasOwnDelivery,
        supportsNetworkDelivery: profileData.data.supportsNetworkDelivery ?? true,
        pickupOnly: profileData.data.pickupOnly ?? false,
        accentColor: profileData.data.accentColor ?? null,
        menuTheme: profileData.data.menuTheme ?? null,
        minDeliveryTime: String(profileData.data.minDeliveryTime || ''),
        maxDeliveryTime: String(profileData.data.maxDeliveryTime || ''),
        deliveryFee: profileData.data.deliveryFee?.toString() || '',
        deliveryRadius: profileData.data.deliveryRadius?.toString() || '',
        deliveryPricingModel: profileData.data.deliveryPricingModel === 'distance' ? 'distance' : 'fixed',
        deliveryBaseRate: profileData.data.deliveryBaseRate != null ? String(profileData.data.deliveryBaseRate) : '',
        deliveryPerKmRate: profileData.data.deliveryPerKmRate != null ? String(profileData.data.deliveryPerKmRate) : '',
        deliveryMinFee: profileData.data.deliveryMinFee != null ? String(profileData.data.deliveryMinFee) : '',
        deliveryMaxFee: profileData.data.deliveryMaxFee != null ? String(profileData.data.deliveryMaxFee) : '',
        maxCashOrder: profileData.data.maxCashOrder != null ? String(profileData.data.maxCashOrder) : '',
        acceptsCash: profileData.data.acceptsCash !== false,
        storeCategories: profileData.data.storeCategories?.map(sc => sc.category.id) || [],
        enableTicketPrinting: profileData.data.enableTicketPrinting ?? true,
        whatsappNotifications: profileData.data.whatsappNotifications ?? false,
        instagram: profileData.data.instagram || '',
        facebook: profileData.data.facebook || '',
        tiktok: profileData.data.tiktok || '',
        promoFreeDeliveryThreshold: profileData.data.promoFreeDeliveryThreshold?.toString() || '',
        promoMinOrderAmount: profileData.data.promoMinOrderAmount?.toString() || '',
        promoMinOrderPercent: profileData.data.promoMinOrderPercent?.toString() || '',
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

  // El pull-to-refresh (listener nativo) usa esta referencia para evitar
  // dependencias circulares: siempre apunta al loadDashboard vigente.
  loadDashboardRef.current = loadDashboard;

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
        debugLog('[Socket] Conectado. Socket ID:', socketRef.current.id, '| Uniéndome al room RESTAURANT:', sessionUser?.id);
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
      debugLog('[Socket] Live event procesando:', eventName, payload);
    }
    const liveEventKey = buildLiveEventKey(eventName, payload);

    if (seenLiveEventKeysRef.current.has(liveEventKey)) {
      if (process.env.NODE_ENV !== 'production') {
        debugLog('[Socket] Evento duplicado ignorado. Key:', liveEventKey);
      }
      return;
    }

    seenLiveEventKeysRef.current.add(liveEventKey);
    if (seenLiveEventKeysRef.current.size > 40) {
      const first = seenLiveEventKeysRef.current.values().next().value;
      if (first) seenLiveEventKeysRef.current.delete(first);
    }

    if (eventName === 'order:support-requested') {
      setSupportRequestsQueue((current) => {
        const exists = current.some((item) => item.orderId === (payload as any).orderId);
        if (exists) return current;
        return [...current, { ...(payload as any), expiresAt: Date.now() + 2 * 60 * 1000 }];
      });
      void playIncomingOrderAlert();
      pushToast('info', 'Solicitud de apoyo', '¡Un restaurante cercano solicita apoyo!');
      return;
    }

    if (eventName === 'order:support-rejected-all' || eventName === 'order:support-exhausted') {
      const payloadAny = payload as any;
      if (payloadAny.orderId) {
        setSupportNotifyByOrder((prev) => ({
          ...prev,
          [payloadAny.orderId]: {
            attemptsLeft: Number(payloadAny.attemptsLeft ?? 0),
            exhausted: Boolean(payloadAny.exhausted || eventName === 'order:support-exhausted'),
          },
        }));
      }
      pushToast(eventName === 'order:support-exhausted' ? 'error' : 'info', 'Apoyo a red', payloadAny.message || 'Nadie aceptó tu solicitud de apoyo.');
      void loadOrdersOnly();
      return;
    }

    if (eventName === 'order:support-accepted' && (payload as any).orderId) {
      setSupportNotifyByOrder((prev) => {
        const next = { ...prev };
        delete next[(payload as any).orderId];
        return next;
      });
      if ((payload as any).supportRestaurantName) {
        setSupportAliadoNamesByOrder((prev) => ({ ...prev, [(payload as any).orderId]: (payload as any).supportRestaurantName }));
      }
      void loadOrdersOnly();
    }

    if (eventName === 'order:created') {
      // Play sound DIRECTLY — no depende del reload de pedidos
      void playIncomingOrderAlert();
    }

    if (eventName === 'order:driver-arrived-restaurant' && payload.orderId) {
      setDriverArrivedOrders((prev) => ({ ...prev, [payload.orderId!]: true }));
      void playDriverArrivedAlert();
      if (payload.isSupportDelivery) {
        if (payload.driverName) {
          setSupportAliadoNamesByOrder((prev) => ({ ...prev, [payload.orderId!]: payload.driverName }));
        }
        pushToast('info', '🛵 Repartidor de apoyo',
          payload.driverName
            ? `${payload.driverName} llegó a tu local. Entrégalo para iniciar la entrega.`
            : 'El repartidor de apoyo llegó a tu local. Entrégalo para iniciar la entrega.');
      }
    }

    if (eventName === 'order:driver-auto-unassigned' && payload.orderId) {
      // El repartidor no aceptó a tiempo y fue desvinculado: refrescar pedidos
      // para que reaparezcan las opciones de reasignar / apoyo / entrega propia.
      setDriverArrivedOrders((prev) => {
        const next = { ...prev };
        delete next[payload.orderId!];
        return next;
      });
      void loadOrdersOnly();
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
          debugLog('[Socket] Limpiando/desconectando socket por cambio de sesión.');
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
        debugLog('[Socket] Reutilizando conexión activa:', socketRef.current.id);
      }
      socketRef.current.emit('join-room', sessionUser.id, 'RESTAURANT');
      return;
    }

    // Always disconnect stale socket on re-mount (handles Fast Refresh)
    if (socketRef.current) {
      if (process.env.NODE_ENV !== 'production') {
        debugLog('[Socket] Cerrando socket previo por re-montaje.');
      }
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    setSocketStatus('connecting');
    const getSocketToken = () => readStoredSession(storageKey).token || '';
    const socket = io('https://sadel-production.up.railway.app', {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      auth: { token: getSocketToken() },
    });

    socket.on('reconnect_attempt', () => {
      socket.auth = { token: getSocketToken() };
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

    socket.on('connect_error', (err) => {
      // Token expirado/inválido: cortar el bucle de reconexión y forzar el
      // flujo de sesión expirada en vez de reintentar indefinidamente.
      if (String((err as Error)?.message || '').includes('UNAUTHORIZED')) {
        socket.disconnect();
        forceSessionExpired();
        return;
      }
      // Fallo de conexión (red, servidor caído, DNS). Marcamos el estado para
      // que el polling de respaldo recargue pedidos mientras socket.io reintenta.
      setSocketStatus('reconnecting');
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[Socket] connect_error:', err?.message || err);
      }
    });

    // Debug: escuchar CUALQUIER evento que llegue
    if (process.env.NODE_ENV !== 'production') {
      socket.onAny((eventName: string, ...args: unknown[]) => {
        debugLog('[Socket] Evento recibido:', eventName, JSON.stringify(args).slice(0, 300));
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

    socket.on('restaurant:auto_closed_inactivity', () => {
      pushToast('info', 'Hicimos una pausa ☕', 'Un pedido no se respondió a tiempo y se canceló. Pusimos tu negocio en pausa para que nadie más tenga que esperar. Reabre cuando quieras.');
      void loadDashboard();
    });

    socket.on('order:overdue', (payload: any) => {
      pushToast('error', 'Pedido rezagado ⚠️', `Pedido ${payload?.orderReference || ''} lleva ${payload?.minutesOverdue ?? 0} min de retraso. Agrega tiempo o reprograma la entrega.`);
      void playOverdueAlert();
      void loadOrdersOnly();
    });

    socket.on('billing:updated', () => {
      enqueueBillingRefetch(false);
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
        void warmup();
        loadOrdersOnly();
        enqueueBillingRefetch(false);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(healthCheckInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      socket.off('order_chat:message_received');
      socket.off('billing:updated');
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

  // Respaldo anti-inconsistencia: cuando el socket está caído, ningún evento live
  // llega y el zombie-detection (que requiere socket.connected) tampoco corre.
  // Este polling refresca las órdenes para que el panel nunca muestre datos viejos.
  useForegroundPolling(() => {
    if (token && sessionUser?.role === 'RESTAURANT') {
      if (!socketRef.current || socketRef.current.disconnected) {
        void loadOrdersOnly();
      }
      if (activeSection === 'billing') {
        enqueueBillingRefetch(false);
      }
    }
  });

  // Warmup global por gesto + cleanup del contexto de audio compartido.
  useEffect(() => {
    if (!isOrderAlertSoundEnabled || orderAlertAudioState === 'unsupported') {
      return;
    }
    const uninstallWarmup = installWarmupListeners();
    const uninstallVisibility = installVisibilityResumeListener();
    return () => {
      uninstallWarmup();
      uninstallVisibility();
    };
  }, [isOrderAlertSoundEnabled, orderAlertAudioState]);

  useEffect(() => {
    if (orderAlertAudioState === 'ready') {
      hasShownOrderAlertBlockedToastRef.current = false;
    }
  }, [orderAlertAudioState]);

  useEffect(() => {
    return () => {
      stopAll();
      reset();
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
        if (isNativePlatform()) {
          nativeKeepAwake();
          return;
        }
        if ('wakeLock' in navigator && !wakeLockRef.current) {
          wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        }
      } catch {}
    }

    async function releaseWakeLock() {
      try {
        if (isNativePlatform()) {
          nativeAllowSleep();
          return;
        }
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
      for (const [, timeoutId] of toastTimeoutsRef.current) {
        clearTimeout(timeoutId);
      }
      toastTimeoutsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!activeIncomingOrder) {
      setIsSelectingPrepTime(false);
      setIsScheduledMode(false);
      setScheduledDeliveryDate('');
      setScheduledDeliveryTime('');
      setScheduledMeridiem('PM');
      return;
    }

    setIsSelectingPrepTime(false);
    setIsScheduledMode(false);
    setScheduledDeliveryDate('');
    setScheduledDeliveryTime('');
    setScheduledMeridiem('PM');
    // El countdown vive en <IncomingOrderCountdown> (timer aislado) para no
    // re-renderizar toda la página cada segundo.
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

    // Optimistic UI: al solicitar apoyo, el panel de "esperando respuesta" debe
    // aparecer de inmediato (el evento de socket puede tardar o no llegar).
    if (actionKey === 'solicitarApoyo') {
      setOrders((current) =>
        current.map((o) =>
          o.id === orderId
            ? {
                ...o,
                isSupportRequested: true,
                supportRequestedAt: new Date().toISOString(),
                supportAttempts: (o.supportAttempts ?? 0) + 1,
              }
            : o
        )
      );
      setSupportNotifyByOrder((prev) => {
        const next = { ...prev };
        delete next[orderId];
        return next;
      });
    }

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
          url: res.data.deliveryToken.url,
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
    const targetOrder = ordersRef.current.find((o) => o.id === orderId);

    if (targetOrder?.fulfillmentType === 'PICKUP') {
      const message = 'Este pedido es de recoger en tienda; no requiere repartidor.';
      pushToast('error', 'Pedido sin reparto', message);
      return;
    }

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

  type SettingsSectionKey = 'perfil' | 'ubicacion' | 'entrega' | 'pagos';

  function buildSettingsPayload(section: SettingsSectionKey): Record<string, unknown> {
    const num = (v: string) => (v.trim() ? Number(v.trim()) : undefined);
    const body: Record<string, unknown> = {};

    if (section === 'perfil') {
      body.name = storeDraft.name.trim();
      body.description = storeDraft.description.trim();
      body.contactPhone = storeDraft.contactPhone.trim();
      body.email = storeDraft.email.trim();
      body.instagram = storeDraft.instagram.trim() || null;
      body.facebook = storeDraft.facebook.trim() || null;
      body.tiktok = storeDraft.tiktok.trim() || null;
      body.storeCategories = storeDraft.storeCategories;
      body.accentColor = storeDraft.accentColor ?? null;
      body.menuTheme = storeDraft.menuTheme ?? null;
      return body;
    }

    if (section === 'ubicacion') {
      body.address = `${storeDraft.address.trim()}${storeDraft.houseNumber.trim() ? `, No. ${storeDraft.houseNumber.trim()}` : ''}`;
      if (storeDraft.latitude.trim()) body.latitude = Number(storeDraft.latitude);
      if (storeDraft.longitude.trim()) body.longitude = Number(storeDraft.longitude);
      return body;
    }

    if (section === 'entrega') {
      const minT = num(storeDraft.minDeliveryTime);
      const maxT = num(storeDraft.maxDeliveryTime);
      body.pickupOnly = storeDraft.pickupOnly ?? false;
      if (storeDraft.pickupOnly) {
        // Solo recoger en tienda excluye la entrega: se apagan reparto propio y apoyo.
        body.hasOwnDelivery = false;
        body.supportsNetworkDelivery = false;
        body.deliveryFee = null;
      } else {
        body.hasOwnDelivery = storeDraft.hasOwnDelivery;
        body.supportsNetworkDelivery = storeDraft.supportsNetworkDelivery ?? true;
      }
      body.deliveryPricingModel = storeDraft.hasOwnDelivery ? storeDraft.deliveryPricingModel : 'fixed';
      if (storeDraft.hasOwnDelivery) {
        const distance = storeDraft.deliveryPricingModel === 'distance';
        body.deliveryRadius = num(storeDraft.deliveryRadius) ?? 3;
        body.deliveryFee = distance ? null : (num(storeDraft.deliveryFee) ?? null);
        if (distance) {
          body.deliveryBaseRate = num(storeDraft.deliveryBaseRate) ?? 20;
          body.deliveryPerKmRate = num(storeDraft.deliveryPerKmRate) ?? 8;
          body.deliveryMinFee = num(storeDraft.deliveryMinFee) ?? 15;
          body.deliveryMaxFee = num(storeDraft.deliveryMaxFee) ?? 150;
        }
      } else {
        body.deliveryFee = null;
      }
      if (minT !== undefined) body.minDeliveryTime = minT;
      if (maxT !== undefined) body.maxDeliveryTime = maxT;
      body.promoFreeDeliveryThreshold = num(storeDraft.promoFreeDeliveryThreshold) ?? null;
      body.promoMinOrderAmount = num(storeDraft.promoMinOrderAmount) ?? null;
      body.promoMinOrderPercent = num(storeDraft.promoMinOrderPercent) ?? null;
      return body;
    }

    // pagos
    body.maxCashOrder = num(storeDraft.maxCashOrder) ?? 500;
    body.acceptsCash = storeDraft.acceptsCash;
    body.transferBankName = transferBankName.trim() || null;
    body.transferAccountNumber = transferAccountNumber.trim() || null;
    body.transferBeneficiaryName = transferBeneficiaryName.trim() || null;
    return body;
  }

  async function saveStoreProfile(section: SettingsSectionKey = 'perfil') {
    if (!token) {
      return;
    }

    setSavingStoreProfile(true);
    setError('');
    setAuthMessage('');

    try {
      const payloadBody = buildSettingsPayload(section);

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
        supportsNetworkDelivery: payload.data.supportsNetworkDelivery ?? true,
        pickupOnly: payload.data.pickupOnly ?? false,
        accentColor: payload.data.accentColor ?? null,
        menuTheme: payload.data.menuTheme ?? null,
        minDeliveryTime: String(payload.data.minDeliveryTime || ''),
        maxDeliveryTime: String(payload.data.maxDeliveryTime || ''),
        deliveryFee: typeof payload.data.deliveryFee === 'number' ? String(payload.data.deliveryFee) : '',
        deliveryRadius: typeof payload.data.deliveryRadius === 'number' ? String(payload.data.deliveryRadius) : '',
        deliveryPricingModel: payload.data.deliveryPricingModel === 'distance' ? 'distance' : 'fixed',
        deliveryBaseRate: payload.data.deliveryBaseRate != null ? String(payload.data.deliveryBaseRate) : '',
        deliveryPerKmRate: payload.data.deliveryPerKmRate != null ? String(payload.data.deliveryPerKmRate) : '',
        deliveryMinFee: payload.data.deliveryMinFee != null ? String(payload.data.deliveryMinFee) : '',
        deliveryMaxFee: payload.data.deliveryMaxFee != null ? String(payload.data.deliveryMaxFee) : '',
        maxCashOrder: payload.data.maxCashOrder != null ? String(payload.data.maxCashOrder) : '',
        acceptsCash: payload.data.acceptsCash !== false,
        storeCategories: payload.data.storeCategories?.map((sc: any) => sc.category.id) || [],
        enableTicketPrinting: payload.data.enableTicketPrinting ?? true,
        whatsappNotifications: payload.data.whatsappNotifications ?? false,
        instagram: payload.data.instagram || '',
        facebook: payload.data.facebook || '',
        tiktok: payload.data.tiktok || '',
        promoFreeDeliveryThreshold: payload.data.promoFreeDeliveryThreshold?.toString() || '',
        promoMinOrderAmount: payload.data.promoMinOrderAmount?.toString() || '',
        promoMinOrderPercent: payload.data.promoMinOrderPercent?.toString() || '',
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
    const template = lastProductConfigRef.current || undefined;
    setProductDraft(buildEmptyProductDraft(categoryId || categories[0]?.id || '', template));
    setProductConfigInherited(Boolean(template));
    setIsProductModalOpen(true);
  }

  function openDuplicateProductModal(product: ProductItem) {
    setProductImageValidationError('');
    setProductConfigInherited(false);
    setProductDraft({
      id: undefined,
      categoryId: product.categoryId || product.category?.id || '',
      name: `${product.name} (Copia)`,
      description: product.description,
      price: String(product.price),
      discountPrice: product.discountPrice ? String(product.discountPrice) : '',
      promoType: product.promoType || null,
      promoBuyQuantity: product.promoBuyQuantity ? String(product.promoBuyQuantity) : '',
      promoPayQuantity: product.promoPayQuantity ? String(product.promoPayQuantity) : '',
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
      trackStock: product.trackStock || false,
      stock: product.stock != null ? String(product.stock) : '',
      lowStockThreshold: product.lowStockThreshold != null ? String(product.lowStockThreshold) : '5',
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
            if (!current.id) {
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

  function openEditProductModal(product: ProductItem) {
    setProductImageValidationError('');
    setProductConfigInherited(false);
    setProductDraft({
      id: product.id,
      categoryId: product.categoryId || product.category?.id || '',
      name: product.name,
      description: product.description,
      price: String(product.price),
      discountPrice: product.discountPrice ? String(product.discountPrice) : '',
      promoType: product.promoType || null,
      promoBuyQuantity: product.promoBuyQuantity ? String(product.promoBuyQuantity) : '',
      promoPayQuantity: product.promoPayQuantity ? String(product.promoPayQuantity) : '',
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
      trackStock: product.trackStock || false,
      stock: product.stock != null ? String(product.stock) : '',
      lowStockThreshold: product.lowStockThreshold != null ? String(product.lowStockThreshold) : '5',
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

    const consistencyError = validateProductConsistency(productDraft);
    if (consistencyError) {
      pushToast('error', 'Configuración no válida', consistencyError);
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
            promoType:
              productDraft.sellBy === 'UNIT' && productDraft.promoType === 'MULTI_BUY'
                ? 'MULTI_BUY'
                : null,
            promoBuyQuantity:
              productDraft.sellBy === 'UNIT' && productDraft.promoBuyQuantity
                ? Number(productDraft.promoBuyQuantity)
                : null,
            promoPayQuantity:
              productDraft.sellBy === 'UNIT' && productDraft.promoPayQuantity
                ? Number(productDraft.promoPayQuantity)
                : null,
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
            trackStock: productDraft.trackStock,
            stock: productDraft.trackStock ? (productDraft.stock ? Number(productDraft.stock) : 0) : 0,
            lowStockThreshold: productDraft.lowStockThreshold ? Number(productDraft.lowStockThreshold) : 5,
            isAvailable: true,
            allergens: [],
            optionGroups: productDraft.optionGroups || [],
          }),
        },
        fallbackMessage: 'No se pudo crear el producto.',
      });

      const publishedCategoryId = productDraft.categoryId;
      storeLastProductConfig(productDraft);
      setProductImageValidationError('');
      await loadDashboard();

      if (continueAfterSave) {
        setProductDraft(buildEmptyProductDraft(publishedCategoryId, lastProductConfigRef.current || undefined));
        setProductConfigInherited(true);
        pushToast('success', 'Producto creado', 'Producto publicado. Listo para el siguiente.');
        requestAnimationFrame(() => {
          productModalScrollRef.current?.scrollTo({ top: 0 });
          productNameInputRef.current?.focus();
        });
      } else {
        setIsProductModalOpen(false);
        setProductDraft(buildEmptyProductDraft(categories[0]?.id || ''));
        pushToast('success', 'Producto creado', 'El nuevo producto ya aparece en tu menu.');
        setShowSaveSuccessModal(true);
      }
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

    const consistencyError = validateProductConsistency(productDraft);
    if (consistencyError) {
      pushToast('error', 'Configuración no válida', consistencyError);
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
            promoType:
              productDraft.sellBy === 'UNIT' && productDraft.promoType === 'MULTI_BUY'
                ? 'MULTI_BUY'
                : null,
            promoBuyQuantity:
              productDraft.sellBy === 'UNIT' && productDraft.promoBuyQuantity
                ? Number(productDraft.promoBuyQuantity)
                : null,
            promoPayQuantity:
              productDraft.sellBy === 'UNIT' && productDraft.promoPayQuantity
                ? Number(productDraft.promoPayQuantity)
                : null,
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
            optionGroups: productDraft.optionGroups || [],
          }),
        },
        fallbackMessage: 'No se pudo actualizar el producto.',
      });

      storeLastProductConfig(productDraft);
      setIsProductModalOpen(false);
      setProductDraft(buildEmptyProductDraft(categories[0]?.id || ''));
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

  async function handleGenerateProductImage() {
    const productName = productDraft.name.trim();
    const productDescription = productDraft.description.trim();
    if (!token || generatingProductImage || productName.length < 2 || productDescription.length < 4) {
      return;
    }

    setGeneratingProductImage(true);
    setError('');
    setProductImageValidationError('');

    try {
      const response = await requestJson<SuccessResponse<{ url: string }>>({
        apiBase,
        path: '/restaurant-panel/productos/generar-imagen',
        token,
        options: {
          method: 'POST',
          body: JSON.stringify({
            name: productName,
            description: productDescription,
            category: categories.find((category) => category.id === productDraft.categoryId)?.name || undefined,
          }),
        },
        fallbackMessage: 'No se pudo generar la imagen con IA.',
      });

      const generatedUrl = response.data.url;

      setProductDraft((current) => ({
        ...current,
        image: generatedUrl,
        images: current.images.length > 0 ? [generatedUrl, ...current.images] : [generatedUrl],
      }));

      pushToast('success', 'Imagen generada', 'La imagen con IA ya esta lista para guardarse.');
    } catch (requestError) {
      const message = getRequestErrorMessage(requestError, 'No se pudo generar la imagen con IA.');
      setError(message);
      pushToast('error', 'Imagen no generada', message);
    } finally {
      setGeneratingProductImage(false);
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
              shiftIndex: item.shiftIndex,
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
      const paperWidth = (() => {
        try {
          return window.localStorage.getItem('sadel.restaurant.paperWidth') === '58' ? '58mm' as const : '80mm' as const;
        } catch {
          return '80mm' as const;
        }
      })();
      const html = generateTicketHtml(order, restaurantName, order.dailyCounter, { paperWidth });
      await printHtmlString(html, `Comanda_${order.orderReference || 'Pedido'}`);
    } catch (error) {
      console.error('Error al imprimir ticket:', error);
      if (error instanceof NativePrintError) {
        alert('No se pudo abrir la impresión del sistema. Verifica que el teléfono tenga una impresora configurada (Ajustes → Impresión) e inténtalo de nuevo.');
      } else {
        alert('Hubo un problema al intentar imprimir la comanda. Verifica que la impresora esté conectada o que el navegador tenga permisos para imprimir.');
      }
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

  const canSubmitProduct = Boolean(
    productDraft.categoryId &&
      productDraft.name.trim() &&
      productDraft.description.trim() &&
      productDraft.price.trim() &&
      !getImageValidationMessage(productDraft.image.trim(), 'product'),
  );

  function storeLastProductConfig(draft: ProductDraft) {
    lastProductConfigRef.current = {
      sellBy: draft.sellBy,
      unitPrice: draft.unitPrice,
      minWeightG: draft.minWeightG,
      maxWeightG: draft.maxWeightG,
      stepWeightG: draft.stepWeightG,
      weightPresets: draft.weightPresets,
      imagePosition: draft.imagePosition || '50% 50%',
      imageZoom: draft.imageZoom || 100,
      isAdultOnly: draft.isAdultOnly,
      optionGroups: draft.optionGroups ? cloneOptionGroups(draft.optionGroups) : [],
    };
  }

  function resetInheritedProductConfig() {
    lastProductConfigRef.current = null;
    setProductConfigInherited(false);
    setProductDraft((current) => ({
      ...current,
      sellBy: 'UNIT',
      unitPrice: '',
      minWeightG: '100',
      maxWeightG: '5000',
      stepWeightG: '100',
      weightPresets: [100, 200, 300, 500, 1000],
      imagePosition: '50% 50%',
      imageZoom: 100,
      isAdultOnly: false,
      optionGroups: [],
    }));
  }

  function submitProductNow() {
    if (!canSubmitProduct || creatingProduct || savingProductChanges || processingProductImage) {
      return;
    }
    void (productDraft.id ? saveProductChanges() : createProduct());
  }

  useEffect(() => {
    if (isProductModalOpen) {
      productModalScrollRef.current?.scrollTo({ top: 0 });
      productNameInputRef.current?.focus();
    }
  }, [isProductModalOpen]);

  const importDelimiter: CsvDelimiter = importText ? guessCsvDelimiter(importText) : ',';
  const importRawRows = useMemo(() => parseCsvRows(importText, importDelimiter), [importText, importDelimiter]);
  const importHeaderRow = importHasHeader ? (importRawRows[0] || []) : [];
  const importDataRows = useMemo(
    () => (importHasHeader ? importRawRows.slice(1) : importRawRows),
    [importHasHeader, importRawRows],
  );
  const importColumnCount = useMemo(
    () => importRawRows.reduce((max, row) => Math.max(max, row.length), 0),
    [importRawRows],
  );
  const importCategoryIdByName = useMemo(() => {
    const map = new Map<string, string>();
    categories.forEach((category) => {
      const key = category.name.trim().toLowerCase();
      if (key && !map.has(key)) {
        map.set(key, category.id);
      }
    });
    return map;
  }, [categories]);

  useEffect(() => {
    if (!isImportModalOpen || !importText.trim()) {
      return;
    }
    const rows = parseCsvRows(importText, guessCsvDelimiter(importText));
    if (rows.length === 0) {
      return;
    }
    const hasHeader = detectCsvHeaderRow(rows[0]);
    setImportHasHeader(hasHeader);
    setImportColumnMap(autoMapImportColumns(hasHeader ? rows[0] : []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importText, isImportModalOpen]);

  type ImportPreviewRow = {
    rowIndex: number;
    name: string;
    price: number | null;
    discountPrice: number | null;
    description: string;
    sellBy: 'UNIT' | 'WEIGHT';
    image: string;
    categoryTargetId: string;
    willCreateCategory: boolean;
    categoryLabel: string;
    errors: string[];
    isValid: boolean;
  };

  const importPreview = useMemo<ImportPreviewRow[]>(() => {
    return importDataRows.map((row, rowIndex) => {
      const cell = (field: ImportFieldKey): string => {
        const index = importColumnMap[field];
        return index !== undefined ? (row[index] ?? '').trim() : '';
      };

      const errors: string[] = [];
      const name = cell('name');
      const price = parseImportPrice(cell('price'), importDelimiter);
      const hasDescriptionColumn = importColumnMap.description !== undefined;
      const rawDescription = cell('description');
      const description = rawDescription || name;
      const categoryName = cell('category');
      const discountPrice = parseImportPrice(cell('discountPrice'), importDelimiter);
      const sellBy = resolveSellBy(cell('sellBy'));
      const image = cell('image');

      if (!name.trim()) {
        errors.push('Falta el nombre');
      } else if (name.trim().length < 2) {
        errors.push('Nombre muy corto');
      }
      if (price === null) {
        errors.push('Precio inválido o vacío');
      } else if (price <= 0) {
        errors.push('El precio debe ser mayor a 0');
      }
      // La descripción es opcional: solo se valida su longitud cuando el usuario
      // suministró explícitamente una columna de descripción y un valor no vacío.
      if (hasDescriptionColumn && rawDescription && rawDescription.trim().length < 5) {
        errors.push('Descripción muy corta');
      }
      if (image && !isValidHttpUrl(image)) {
        errors.push('URL de imagen inválida');
      }

      let categoryTargetId = '';
      let willCreateCategory = false;
      let categoryLabel = '';
      if (categoryName) {
        const existingId = importCategoryIdByName.get(categoryName.trim().toLowerCase());
        if (existingId) {
          categoryTargetId = existingId;
          categoryLabel = categoryName.trim();
        } else if (importCreateMissingCategories) {
          willCreateCategory = true;
          categoryLabel = categoryName.trim();
        } else {
          errors.push(`Categoría no existe: ${categoryName.trim()}`);
          categoryLabel = categoryName.trim();
        }
      } else if (importDefaultCategoryId) {
        categoryTargetId = importDefaultCategoryId;
        categoryLabel = 'Predeterminada';
      } else {
        errors.push('Selecciona una categoría por defecto o añade la columna Categoría');
        categoryLabel = '';
      }

      return {
        rowIndex,
        name: name.trim(),
        price,
        discountPrice,
        description: description.trim(),
        sellBy,
        image,
        categoryTargetId,
        willCreateCategory,
        categoryLabel,
        errors,
        // Una fila es válida cuando no tiene errores y la categoría está
        // resuelta: ya sea una existente (categoryTargetId) o una nueva que se
        // creará automáticamente (willCreateCategory). Sin este caso, las filas
        // con categorías nuevas quedaban siempre como "con errores".
        isValid: errors.length === 0 && (Boolean(categoryTargetId) || willCreateCategory),
      };
    });
  }, [importDataRows, importColumnMap, importDelimiter, importCreateMissingCategories, importDefaultCategoryId, importCategoryIdByName]);

  const importValidCount = importPreview.filter((row) => row.isValid).length;
  const importErrorCount = importPreview.length - importValidCount;

  function openImportModal() {
    setImportText('');
    setImportHasHeader(false);
    setImportColumnMap({
      name: 0,
      price: 1,
      category: 2,
      sellBy: 3,
      description: 4,
      discountPrice: 5,
      image: 6,
    });
    setImportDefaultCategoryId(categories[0]?.id || '');
    setImportCreateMissingCategories(true);
    setImportResult(null);
    setIsImportModalOpen(true);
  }

  async function handleImportSubmit() {
    if (!token || importingProducts) {
      return;
    }

    const rowsToImport = importPreview.filter((row) => row.isValid);
    if (rowsToImport.length === 0) {
      return;
    }

    setImportingProducts(true);
    setError('');

    try {
      const missingCategoryNames = [...new Set(
        importPreview.filter((row) => row.willCreateCategory).map((row) => row.categoryLabel),
      )].filter((name) => name !== '');

      const createdCategoryIds = new Map<string, string>();
      for (const name of missingCategoryNames) {
        const response = await requestJson<SuccessResponse<CategoryItem>>({
          apiBase,
          path: '/restaurant-panel/categorias',
          token,
          options: {
            method: 'POST',
            body: JSON.stringify({ name, description: null, order: categories.length }),
          },
          fallbackMessage: `No se pudo crear la categoría "${name}".`,
        });
        if (response.success && response.data?.id) {
          createdCategoryIds.set(name.toLowerCase(), response.data.id);
        }
      }

      const productsPayload = rowsToImport.map((row) => {
        const categoryId = row.willCreateCategory
          ? createdCategoryIds.get(row.categoryLabel.toLowerCase()) || ''
          : row.categoryTargetId;
        return {
          categoryId,
          name: row.name.slice(0, 200),
          description: row.description.slice(0, 500),
          price: row.price as number,
          discountPrice: row.discountPrice,
          sellBy: row.sellBy,
          unitPrice: row.sellBy === 'WEIGHT' ? (row.price as number) : null,
          minWeightG: row.sellBy === 'WEIGHT' ? 100 : null,
          maxWeightG: row.sellBy === 'WEIGHT' ? 5000 : null,
          stepWeightG: row.sellBy === 'WEIGHT' ? 100 : null,
          weightPresets: row.sellBy === 'WEIGHT' ? [100, 200, 300, 500, 1000] : null,
          image: row.image || null,
          imagePosition: null,
          imageZoom: null,
          isAvailable: true,
          isAdultOnly: false,
          allergens: [],
        };
      });

      const response = await requestJson<SuccessResponse<{
        created: number;
        skipped: number;
        products: ProductItem[];
        errors: { index: number; name: string; message: string }[];
      }>>({
        apiBase,
        path: '/restaurant-panel/productos/batch',
        token,
        options: {
          method: 'POST',
          body: JSON.stringify({ products: productsPayload }),
        },
        fallbackMessage: 'No se pudo importar la lista de productos.',
      });

      if (response.success && response.data) {
        setImportResult(response.data);
        if (response.data.created > 0) {
          await loadDashboard();
          pushToast('success', 'Menú importado', `${response.data.created} producto${response.data.created === 1 ? '' : 's'} importado${response.data.created === 1 ? '' : 's'}.`);
        }
        if (response.data.skipped > 0) {
          pushToast('info', 'Importación parcial', `${response.data.skipped} fila${response.data.skipped === 1 ? '' : 's'} con errores. Revisa el detalle.`);
        }
      }
    } catch (requestError) {
      const message = getRequestErrorMessage(requestError, 'No se pudo importar la lista de productos.');
      setError(message);
      pushToast('error', 'Importación fallida', message);
    } finally {
      setImportingProducts(false);
    }
  }

  const filteredStoreCategories = useMemo(() => {
    const query = storeSearchQuery.trim().toLowerCase();
    if (!query) {
      return storeCategories;
    }
    return storeCategories
      .map((category) => ({
        ...category,
        products: category.products.filter(
          (product) =>
            product.name.toLowerCase().includes(query) ||
            (product.description || '').toLowerCase().includes(query),
        ),
      }))
      .filter((category) => category.products.length > 0);
  }, [storeCategories, storeSearchQuery]);

  const selectedProductCount = selectedProductIds.size;

  function toggleProductSelection(productId: string) {
    setSelectedProductIds((current) => {
      const next = new Set(current);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  }

  function exitSelectionMode() {
    setIsSelectionMode(false);
    setSelectedProductIds(new Set());
  }

  function enterSelectionMode() {
    setSelectedProductIds(new Set());
    setIsSelectionMode(true);
  }

  async function handleBulkAvailability(isAvailable: boolean) {
    if (!token || selectedProductIds.size === 0 || bulkActionLoading) {
      return;
    }
    setBulkActionLoading(true);
    try {
      await requestJson<SuccessResponse<{ updated: number }>>({
        apiBase,
        path: '/restaurant-panel/productos/bulk/disponibilidad',
        token,
        options: {
          method: 'PATCH',
          body: JSON.stringify({ ids: [...selectedProductIds], isAvailable }),
        },
        fallbackMessage: 'No se pudo actualizar la disponibilidad.',
      });
      await loadDashboard();
      pushToast('success', isAvailable ? 'Productos disponibles' : 'Productos agotados', `${selectedProductIds.size} producto${selectedProductIds.size === 1 ? '' : 's'} actualizado${selectedProductIds.size === 1 ? '' : 's'}.`);
    } catch (requestError) {
      const message = getRequestErrorMessage(requestError, 'No se pudo actualizar la disponibilidad.');
      setError(message);
      pushToast('error', 'Error', message);
    } finally {
      setBulkActionLoading(false);
    }
  }

  async function handleBulkMoveCategory(categoryId: string) {
    if (!categoryId || !token || selectedProductIds.size === 0 || bulkActionLoading) {
      return;
    }
    setBulkActionLoading(true);
    try {
      await requestJson<SuccessResponse<{ updated: number }>>({
        apiBase,
        path: '/restaurant-panel/productos/bulk/categoria',
        token,
        options: {
          method: 'PATCH',
          body: JSON.stringify({ ids: [...selectedProductIds], categoryId }),
        },
        fallbackMessage: 'No se pudo mover los productos.',
      });
      await loadDashboard();
      setBulkCategoryTargetId('');
      pushToast('success', 'Productos movidos', `${selectedProductIds.size} producto${selectedProductIds.size === 1 ? '' : 's'} movido${selectedProductIds.size === 1 ? '' : 's'}.`);
    } catch (requestError) {
      const message = getRequestErrorMessage(requestError, 'No se pudo mover los productos.');
      setError(message);
      pushToast('error', 'Error', message);
    } finally {
      setBulkActionLoading(false);
    }
  }

  async function handleBulkDelete() {
    if (!token || selectedProductIds.size === 0 || bulkActionLoading) {
      return;
    }
    setBulkActionLoading(true);
    try {
      await requestJson<SuccessResponse<{ deleted: number }>>({
        apiBase,
        path: '/restaurant-panel/productos/bulk',
        token,
        options: {
          method: 'DELETE',
          body: JSON.stringify({ ids: [...selectedProductIds] }),
        },
        fallbackMessage: 'No se pudo eliminar los productos.',
      });
      setIsBulkDeleteModalOpen(false);
      const deletedCount = selectedProductIds.size;
      await loadDashboard();
      exitSelectionMode();
      pushToast('success', 'Productos eliminados', `${deletedCount} producto${deletedCount === 1 ? '' : 's'} eliminado${deletedCount === 1 ? '' : 's'}.`);
    } catch (requestError) {
      const message = getRequestErrorMessage(requestError, 'No se pudo eliminar los productos.');
      setError(message);
      pushToast('error', 'Error', message);
    } finally {
      setBulkActionLoading(false);
    }
  }

  async function handleBulkGenerateMissingImages() {
    if (!token || bulkActionLoading) {
      return;
    }

    const missingCount = products.filter((product) => !product.image?.trim()).length;

    if (missingCount === 0) {
      pushToast('info', 'Nada que generar', 'Todos tus productos ya tienen imagen.');
      return;
    }

    const confirmed = window.confirm(
      `Se generaran imagenes con IA para ${missingCount} producto${missingCount === 1 ? '' : 's'} sin foto. Puede tardar un par de minutos y respeta el limite diario. \u00bfContinuar?`
    );
    if (!confirmed) {
      return;
    }

    setBulkActionLoading(true);
    setError('');
    try {
      const response = await requestJson<SuccessResponse<{
        generadas: number;
        fallidas: number;
        pendientes: number;
        limiteDiario: number;
      }>>({
        apiBase,
        path: '/restaurant-panel/productos/generar-imagenes-faltantes',
        token,
        options: {
          method: 'POST',
          body: JSON.stringify({}),
        },
        fallbackMessage: 'No se pudieron generar las imagenes.',
      });

      await loadDashboard();

      const { generadas, fallidas, pendientes, limiteDiario } = response.data;
      pushToast(
        'success',
        'Imagenes generadas',
        `${generadas} imagen${generadas === 1 ? '' : 'es'} creada${generadas === 1 ? '' : 's'}${
          fallidas > 0 ? `, ${fallidas} fallida${fallidas === 1 ? '' : 's'}` : ''
        }${
          pendientes > 0
            ? `, ${pendientes} pendiente${pendientes === 1 ? '' : 's'} (limite diario ${limiteDiario})`
            : ''
        }.`
      );
    } catch (requestError) {
      const message = getRequestErrorMessage(requestError, 'No se pudieron generar las imagenes.');
      setError(message);
      pushToast('error', 'Error', message);
    } finally {
      setBulkActionLoading(false);
    }
  }

  const isBusinessOpen = profile?.isAcceptingOrders ?? false;
  const isBusinessPaused = profile?.isPaused ?? false;
  const isWithinHours = isCurrentlyWithinOperatingHours(profile?.operatingHours);
  const operationalStatusLabel = getRestaurantOperationalStatusLabel(profile?.status, profile?.isAcceptingOrders, profile?.isPaused, isWithinHours);
  const navigationItems: Array<{ key: RestaurantPortalSection; label: string }> = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'orders', label: 'Ordenes' },
    { key: 'store', label: 'Mi Tienda' },
    { key: 'billing', label: 'Balance' },
    { key: 'featured', label: 'Destacados' },
    { key: 'settings', label: 'Configuracion' },
  ];

  if (checkingAuth) {
    return <SaDelLoader fullScreen className="bg-white" />;
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

  return (
    <main
      className={`min-h-[100dvh] text-neutral-900 ${isRestaurantSession ? 'py-0' : 'px-4 py-5 md:px-6 lg:px-8'
        }`}
    >
      <PushEnableBanner
        visible={Boolean(token)}
        onEnable={() => subscribeToPush(token || '')}
      />

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
          <RefreshCw />
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
            <div className="border-b border-black/5 bg-neutral-50/50 px-5 py-4 sm:px-8">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
                    className="mt-1.5 text-xl font-bold tracking-[-0.04em] text-neutral-950 sm:text-2xl"
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

                {/* TIMER PILL (timer aislado para no re-renderizar la página) */}
                <IncomingOrderCountdown
                  key={activeIncomingOrder.id}
                  windowMs={
                    activeIncomingOrder.paymentMethod === 'TRANSFER'
                      ? 10 * 60 * 1000
                      : profile?.businessType && profile.businessType !== 'RESTAURANT'
                        ? storeOrderDecisionWindowMs
                        : newOrderDecisionWindowMs
                  }
                />
              </div>
            </div>

            {/* CONTENT */}
            {isSelectingPrepTime ? (
              <>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-8 sm:px-10 flex flex-col items-center text-center">
                <div className="my-auto w-full max-w-sm space-y-6">
                  <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-sky-100 ring-8 ring-sky-50">
                    <Clock className="h-10 w-10 text-sky-600" />
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
                    <div className="space-y-5 pt-2">
                      <div className="text-left">
                        <span className="text-xs font-bold uppercase tracking-wider text-neutral-600">Fecha de entrega</span>
                        <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-7">
                          {buildScheduleDayOptions().map((option) => {
                            const selected = scheduledDeliveryDate === option.value;
                            return (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() => setScheduledDeliveryDate(option.value)}
                                className={`flex flex-col items-center justify-center rounded-2xl border-2 px-1 py-3 text-center transition ${
                                  selected
                                    ? 'border-sky-600 bg-sky-50 text-sky-700 shadow-sm'
                                    : 'border-neutral-100 bg-white text-neutral-700 hover:border-sky-300 hover:bg-sky-50/50'
                                }`}
                              >
                                <span className="text-sm font-black">{option.label}</span>
                                {!option.isToday && (
                                  <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider opacity-60 mt-0.5">
                                    {new Date(`${option.value}T00:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="text-left">
                        <span className="text-xs font-bold uppercase tracking-wider text-neutral-600">Hora de entrega</span>
                        <div className="mt-2 flex items-center gap-2">
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            autoComplete="off"
                            enterKeyHint="done"
                            placeholder="06:30"
                            maxLength={5}
                            value={scheduledDeliveryTime}
                            onChange={(e) => setScheduledDeliveryTime(formatScheduleTimeMask(scheduledDeliveryTime, e.target.value))}
                            className="w-full rounded-2xl border border-sky-200/60 bg-white px-5 py-3.5 text-center text-lg font-bold tracking-[0.15em] text-neutral-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-500/20"
                          />
                          <div className="flex shrink-0 rounded-2xl border border-sky-200/60 bg-sky-50/40 p-1">
                            {(['AM', 'PM'] as const).map((m) => (
                              <button
                                key={m}
                                type="button"
                                onClick={() => setScheduledMeridiem(m)}
                                className={`rounded-xl px-3 py-2.5 text-sm font-black transition sm:px-4 ${scheduledMeridiem === m ? 'bg-sky-600 text-white shadow-md' : 'text-sky-600 hover:text-sky-800'}`}
                              >
                                {m}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                      {(() => {
                        const scheduled = buildScheduledDeliveryDate(scheduledDeliveryDate, scheduledDeliveryTime, scheduledMeridiem);
                        if (!scheduled) {
                          return (
                            <p className="text-xs font-bold text-neutral-500 bg-neutral-100 rounded-xl px-4 py-2 text-left">
                              Escribe la hora en formato 12h, por ejemplo 06:30.
                            </p>
                          );
                        }
                        if (scheduled <= new Date()) {
                          return (
                            <p className="text-xs font-bold text-rose-600 bg-rose-50 rounded-xl px-4 py-2 text-left">
                              La fecha y hora deben ser posteriores al momento actual.
                            </p>
                          );
                        }
                        return (
                          <p className="text-xs font-bold text-emerald-600 bg-emerald-50 rounded-xl px-4 py-2 text-left">
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

                  </div>
              </div>
<div className="shrink-0 border-t border-black/5 bg-white px-5 py-4 sm:px-8 shadow-[0_-8px_30px_rgba(0,0,0,0.06)]">
                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
                    <button
                      type="button"
                      onClick={() => {
                        setIsSelectingPrepTime(false);
                        setIsScheduledMode(false);
                        setScheduledDeliveryDate('');
                        setScheduledDeliveryTime('');
                        setScheduledMeridiem('PM');
                      }}
                      disabled={Boolean(activeActionKey)}
                      className="w-full rounded-full border border-neutral-200 bg-white px-6 py-3.5 text-sm font-bold text-neutral-600 transition hover:bg-neutral-50 hover:text-neutral-800 active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed sm:w-auto"
                    >
                      Volver
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const scheduled = buildScheduledDeliveryDate(scheduledDeliveryDate, scheduledDeliveryTime, scheduledMeridiem);
                        const isScheduled = isScheduledMode && scheduled !== null && scheduled.getTime() > Date.now();
                        if (isScheduled) {
                          const scheduledAt = scheduled!.toISOString();
                          const onAccept = () => void runOrderAction(activeIncomingOrder.id, 'accept', { scheduledDeliveryAt: scheduledAt });
                          if (activeIncomingOrder.paymentMethod === 'TRANSFER') {
                            setTransferConfirmationOrder({
                              id: activeIncomingOrder.id,
                              preparationTimeMinutes: 10,
                              paymentProofUrl: activeIncomingOrder.paymentProofUrl,
                              orderReference: activeIncomingOrder.orderReference,
                              collectionAmount: getRestaurantCollectionAmount(activeIncomingOrder, profile),
                              onConfirm: () => {
                                onAccept();
                                setIsSelectingPrepTime(false);
                                setIsScheduledMode(false);
                                setScheduledDeliveryDate('');
                                setScheduledDeliveryTime('');
                                setScheduledMeridiem('PM');
                              },
                            });
                          } else {
                            onAccept();
                            setIsSelectingPrepTime(false);
                            setIsScheduledMode(false);
                            setScheduledDeliveryDate('');
                            setScheduledDeliveryTime('');
                            setScheduledMeridiem('PM');
                          }
                        } else {
                          const onAccept = () => void runOrderAction(activeIncomingOrder.id, 'accept', { preparationTimeMinutes: selectedPreparationTime });
                          if (activeIncomingOrder.paymentMethod === 'TRANSFER') {
                            setTransferConfirmationOrder({
                              id: activeIncomingOrder.id,
                              preparationTimeMinutes: selectedPreparationTime,
                              paymentProofUrl: activeIncomingOrder.paymentProofUrl,
                              orderReference: activeIncomingOrder.orderReference,
                              collectionAmount: getRestaurantCollectionAmount(activeIncomingOrder, profile),
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
                        (isScheduledMode && !(() => {
                          const s = buildScheduledDeliveryDate(scheduledDeliveryDate, scheduledDeliveryTime, scheduledMeridiem);
                          return s !== null && s.getTime() > Date.now();
                        })())
                      }
                      className="w-full rounded-full bg-sky-600 px-5 py-4 text-sm font-bold text-white shadow-[0_4px_12px_rgba(2,132,199,0.3)] transition hover:bg-sky-700 hover:shadow-[0_8px_20px_rgba(2,132,199,0.4)] active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed sm:flex-1"
                    >
                      {activeActionKey === `${activeIncomingOrder.id}:accept`
                        ? 'Aceptando...'
                        : isScheduledMode
                          ? 'Confirmar y Programar Entrega'
                          : 'Confirmar y Aceptar Pedido'}
                    </button>
                  </div>
              </div>
              </>
            ) : (
              <><div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-8">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_320px]">

                {/* LEFT COLUMN: CHEF FOCUS (Items First!) */}
                <div className="space-y-6">
                  {/* COMANDA */}
                  <div className="rounded-3xl border border-sky-100 bg-white p-5 shadow-[0_8px_30px_rgba(2,132,199,0.06)] relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1.5 h-full bg-sky-600"></div>
                    <div className="flex items-center justify-between border-b border-black/5 pb-3.5">
                      <p className="text-sm font-bold uppercase tracking-[0.2em] text-neutral-800">{profile?.businessType === 'RESTAURANT' ? 'Comanda para Cocina' : 'Detalle del Pedido'}</p>
                      <span className="rounded-full bg-sky-100 px-4 py-1.5 text-xs font-bold text-sky-700">
                        {countOrderProducts(activeIncomingOrder)} {countOrderProducts(activeIncomingOrder) === 1 ? 'Producto' : 'Productos'}
                      </span>
                    </div>

                    <div className="divide-y divide-black/5 mt-2">
                      {activeIncomingOrder.items && activeIncomingOrder.items.length > 0 ? (
                        activeIncomingOrder.items.map((item) => (
                          <div key={item.id} className="grid grid-cols-[40px_40px_minmax(0,1fr)] gap-3.5 py-3 items-start">
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
                              <p className="text-[15px] font-black leading-snug text-neutral-950 line-clamp-2">
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
                          <AlertTriangle className="h-4 w-4" strokeWidth={2.5} />
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
                <div className="space-y-4 lg:border-l lg:border-black/5 lg:pl-6">
                  
                  {/* COMPACT DELIVERY DATA FOR CASHIER */}
                  <div className="rounded-2xl border border-neutral-100 bg-neutral-50/50 p-4">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-neutral-400">Resumen de Entrega</p>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        (activeIncomingOrder as any).fulfillmentType === 'PICKUP'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-sky-100 text-sky-700'
                      }`}>
                        {(activeIncomingOrder as any).fulfillmentType === 'PICKUP' ? '🛍️ Recogida' : '🛵 Envío'}
                      </span>
                    </div>
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center gap-3">
                        {activeIncomingOrder.customer?.user?.profilePhoto ? (
                          <img
                            src={activeIncomingOrder.customer.user.profilePhoto}
                            alt={getCustomerFullName(activeIncomingOrder.customer?.user) || 'Cliente'}
                            className="h-10 w-10 rounded-full object-cover border border-neutral-200"
                          />
                        ) : (
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-200 font-bold text-neutral-500 text-sm">
                            {getCustomerInitials(activeIncomingOrder.customer?.user) || 'CL'}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-neutral-900 truncate">
                            {getCustomerFullName(activeIncomingOrder.customer?.user) || 'Cliente SaDeL'}
                          </p>
                          <p className="text-[11px] font-medium text-neutral-500">
                            {formatPhoneDigits(activeIncomingOrder.customer?.user?.phone) || 'Sin teléfono'}
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
                      </div>
                      )}
                    </div>
                  </div>

                  {/* TOTAL */}
                  <div className="rounded-2xl bg-neutral-950 p-4 text-white shadow-lg">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">Total del pedido</p>
                      <p className="text-2xl font-bold tracking-[-0.04em]">
                        {formatCurrency(getRestaurantCollectionAmount(activeIncomingOrder, profile))}
                      </p>
                    </div>
                    {(activeIncomingOrder as any).fulfillmentType !== 'PICKUP' && (activeIncomingOrder.deliveryFee || 0) > 0 && (
                      <p className="mt-1 text-[11px] font-medium text-neutral-400">
                        Incluye envío de {formatCurrency(activeIncomingOrder.deliveryFee || 0)}
                      </p>
                    )}
                  </div>

                  {activeIncomingOrder.paymentMethod === 'CASH' && (
                    <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-yellow-50 p-4">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="flex h-2 w-2 rounded-full bg-amber-500" />
                        <span className="text-xs font-bold uppercase tracking-wider text-amber-700 bg-amber-100/50 px-2 py-0.5 rounded-md border border-amber-200/30">
                          Pago en Efectivo
                        </span>
                      </div>
                      <p className="text-xs text-amber-800 font-bold">
                        💵 Cobra en efectivo al entregar: {formatCurrency(getRestaurantCollectionAmount(activeIncomingOrder, profile))}
                      </p>
                    </div>
                  )}

                  {activeIncomingOrder.paymentMethod === 'TRANSFER' && (
                    <div className="rounded-2xl border border-sky-100 bg-gradient-to-br from-sky-50 to-blue-50 p-4 animate-float-gentle">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="flex h-2 w-2 rounded-full bg-sky-600 animate-pulse" />
                        <span className="text-xs font-bold uppercase tracking-wider text-sky-700 bg-sky-100/50 px-2 py-0.5 rounded-md border border-sky-200/30">
                          Pago por Transferencia
                        </span>
                      </div>
                      <p className="text-xs text-neutral-500 mb-3 leading-relaxed">
                        Verifica en tu banca móvil que el importe de <strong>{formatCurrency(getRestaurantCollectionAmount(activeIncomingOrder, profile))}</strong> haya ingresado.
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
                            <span className="text-neutral-500">{getCustomerFullName(order.customer?.user) || 'Cliente'}</span>
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

                </div>
              </div>
            </div>
            {/* STICKY FOOTER WITH ACTIONS */}
            <div className="shrink-0 border-t border-black/5 bg-white px-5 py-3 sm:px-8 shadow-[0_-8px_30px_rgba(0,0,0,0.06)]">
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsSelectingPrepTime(true)}
                  disabled={Boolean(activeActionKey)}
                  className="flex-1 rounded-full bg-sky-600 px-5 py-3.5 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(2,132,199,0.3)] transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-sky-300"
                >
                  {activeActionKey === `${activeIncomingOrder.id}:accept` ? 'Aceptando...' : 'Aceptar Pedido'}
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
                  className="flex-1 rounded-full border border-rose-200 bg-white px-5 py-3.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {activeActionKey === `${activeIncomingOrder.id}:reject` ? 'Rechazando...' : 'Rechazar Pedido'}
                </button>
              </div>
            </div>
            </>
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

              {(() => {
                const remainingMs = Math.max(0, supportRequestsQueue[0].expiresAt - supportCountdownNow);
                const secs = Math.ceil(remainingMs / 1000);
                const mm = String(Math.floor(secs / 60)).padStart(2, '0');
                const ss = String(secs % 60).padStart(2, '0');
                const progress = remainingMs / (2 * 60 * 1000);
                return (
                  <div className="mt-3 flex items-center gap-3 rounded-2xl border border-sky-100 bg-sky-50/70 px-4 py-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-600 text-[11px] font-black text-white tabular-nums">
                      {mm}:{ss}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-sky-100">
                        <div
                          className="h-full rounded-full bg-sky-500 transition-[width] duration-1000 ease-linear"
                          style={{ width: `${progress * 100}%` }}
                        />
                      </div>
                      <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-700">
                        Si no respondes, se rechazará automáticamente en 2 minutos
                      </p>
                    </div>
                  </div>
                );
              })()}
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
                    <p className="mt-1 text-sm font-medium text-neutral-900">
                      {supportRequestsQueue[0].distanceToDeliveryKm != null
                        ? `${supportRequestsQueue[0].distanceToDeliveryKm.toFixed(2)} km hasta la entrega`
                        : `${supportRequestsQueue[0].distanceToRestaurant.toFixed(2)} km (aprox)`}
                    </p>
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

                      // Mostrar el QR de entrega inmediatamente (igual que reparto propio/express)
                      if (data.data?.deliveryToken?.token) {
                        setActiveQrCodeData({
                          token: data.data.deliveryToken.token,
                          orderReference: data.data.orderReference || '',
                          id: supportRequestsQueue[0].orderId,
                          url: data.data.deliveryToken.url,
                        });
                      }
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
                    await fetch(`${apiBase}/restaurant-panel/pedidos/${supportRequestsQueue[0].orderId}/rechazar-apoyo`, {
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
                        <span className="block mt-1 text-sm font-bold text-sky-600">${(pkg.price ?? 0).toFixed(2)}</span>
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
        const deliveryUrl =
          activeQrCodeData.url && /^https?:\/\//i.test(activeQrCodeData.url)
            ? activeQrCodeData.url
            : `${resolveCustomerOrigin()}/reparto/ver/${activeQrCodeData.token}`;

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
                      const message = `🛵 Entrega SaDeL — Pedido ${activeQrCodeData.orderReference}\nAbre este enlace para ver la ruta y entregar: ${deliveryUrl}`;
                      window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
                    }}
                    className="w-full rounded-xl bg-[#25D366] py-3 text-sm font-semibold text-white shadow-md shadow-emerald-600/20 hover:bg-[#1fb857] transition active:scale-[0.98]"
                  >
                    <span className="inline-flex items-center gap-2">
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                      Enviar por WhatsApp
                    </span>
                  </button>
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
                        collectionAmount: getRestaurantCollectionAmount(acceptancePromptOrder, profile),
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
              <Check className="h-10 w-10" />
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
                <Minus className="h-7 w-7" strokeWidth={1.8} />
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
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-sky-950/40 backdrop-blur-md transition-all duration-500 sm:items-center sm:px-4 sm:py-5"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              submitProductNow();
            }
          }}
        >
          <div className="relative flex h-[94vh] w-full max-w-[760px] flex-col overflow-hidden rounded-t-[36px] bg-white shadow-[0_32px_120px_rgba(14,165,233,0.25)] ring-1 ring-sky-100 sm:h-auto sm:max-h-[92vh] sm:rounded-[36px]">
            
            {/* Ambient Background Glows */}
            <div className="pointer-events-none absolute -left-20 -top-20 h-64 w-64 rounded-full bg-sky-300/20 blur-[80px]" />
            <div className="pointer-events-none absolute -right-20 top-1/2 h-64 w-64 rounded-full bg-blue-300/10 blur-[80px]" />

            {/* Premium Header */}
            <div className="relative shrink-0 border-b border-sky-100/50 bg-white/80 px-5 py-4 backdrop-blur-xl sm:px-10 sm:py-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 sm:gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-100 to-sky-50 text-sky-600 shadow-inner ring-1 ring-sky-200/50 sm:h-14 sm:w-14">
                    <svg className="h-6 w-6 sm:h-7 sm:w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-lg font-bold tracking-tight text-neutral-900 sm:text-2xl">
                      {productDraft.id ? 'Editar producto' : 'Nuevo producto'}
                    </h3>
                    <p className="mt-0.5 text-[13px] font-medium text-sky-700/70 sm:mt-1 sm:text-sm">
                      {profile?.businessType === 'RESTAURANT' ? 'Información, precios y extras de tu platillo.' : 'Información, precios y variantes de tu producto.'}
                    </p>
                    {productConfigInherited && !productDraft.id ? (
                      <div className="mt-2.5 inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-full bg-sky-50 px-3 py-1.5 text-[12px] font-semibold text-sky-700 ring-1 ring-sky-200/60">
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                        <span>Configuración heredada del último producto</span>
                        <button
                          type="button"
                          onClick={resetInheritedProductConfig}
                          className="rounded-full border border-sky-200 bg-white px-2.5 py-0.5 text-[11px] font-bold text-sky-700 transition hover:bg-sky-100"
                        >
                          Restablecer
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsProductModalOpen(false);
                    setProductImageValidationError('');
                    setProductConfigInherited(false);
                    setProductDraft(buildEmptyProductDraft(categories[0]?.id || ''));
                  }}
                  className="group inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600 transition-all hover:bg-sky-100 hover:text-sky-900 sm:h-12 sm:w-12"
                  aria-label="Cerrar"
                >
                  <X className="h-5 w-5 transition-transform duration-300 group-hover:rotate-90" strokeWidth={2.5} />
                </button>
              </div>
            </div>

            {/* Scrollable Content */}
            <div ref={productModalScrollRef} className="relative flex-1 overflow-y-auto bg-gradient-to-b from-sky-50/30 to-white px-5 py-6 sm:px-10 sm:py-8">
              <div className="space-y-10">
                
                {/* 1. Información Básica */}
                <section>
                  <div className="mb-5 flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 to-sky-600 text-sm font-black text-white shadow-lg shadow-sky-500/30">1</span>
                    <h4 className="text-[13px] font-bold uppercase tracking-[0.15em] text-sky-900">Información Básica</h4>
                  </div>
                  <div className="rounded-[28px] border border-white bg-white/80 p-5 shadow-[0_8px_30px_rgba(14,165,233,0.06)] backdrop-blur-md ring-1 ring-sky-100/50 sm:p-8">
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
                        inputRef={productNameInputRef}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
                            event.preventDefault();
                            productPriceInputRef.current?.focus();
                          }
                        }}
                      />
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
                  <div className="rounded-[28px] border border-white bg-white/80 p-5 shadow-[0_8px_30px_rgba(14,165,233,0.06)] backdrop-blur-md ring-1 ring-sky-100/50 sm:p-8">
                    <div className="grid gap-5 sm:grid-cols-2">
                      {/* Tipo de venta */}
                      <div className="sm:col-span-2">
                        <label className="text-[12px] font-bold uppercase tracking-[0.1em] text-neutral-600">Tipo de venta</label>
                        <div className="mt-2 flex gap-2 rounded-[18px] border border-black/5 bg-neutral-100/50 p-1.5">
                          <button
                            type="button"
                            onClick={() => setProductDraft((current) => ({ ...current, sellBy: 'UNIT' }))}
                            className={`flex-1 rounded-xl py-3 text-[13px] font-bold transition-all sm:py-2.5 sm:text-xs ${
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
                            className={`flex-1 rounded-xl py-3 text-[13px] font-bold transition-all sm:py-2.5 sm:text-xs ${
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
                          inputRef={productPriceInputRef}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                              event.preventDefault();
                              submitProductNow();
                            }
                          }}
                        />
                      ) : (
                        <Field
                          label="Precio por kg ($)"
                          value={productDraft.unitPrice}
                          onChange={(value) => setProductDraft((current) => ({ ...current, unitPrice: value, price: value || '0' }))}
                          placeholder="0.00"
                          inputRef={productPriceInputRef}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                              event.preventDefault();
                              submitProductNow();
                            }
                          }}
                        />
                      )}
                      <Field
                        label="Precio Especial (Opcional)"
                        value={productDraft.discountPrice || ''}
                        onChange={(value) => setProductDraft((current) => ({ ...current, discountPrice: value }))}
                        placeholder="0.00"
                      />

                      {productDraft.sellBy === 'UNIT' && (
                        <div className="sm:col-span-2 rounded-2xl border border-emerald-200/60 bg-emerald-50/40 p-4">
                          <label className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.1em] text-emerald-700">
                            <input
                              type="checkbox"
                              checked={productDraft.promoType === 'MULTI_BUY'}
                              onChange={(event) =>
                                setProductDraft((current) => ({
                                  ...current,
                                  promoType: event.target.checked ? 'MULTI_BUY' : null,
                                  ...(event.target.checked
                                    ? {}
                                    : { promoBuyQuantity: '', promoPayQuantity: '' }),
                                }))
                              }
                              className="h-4 w-4 accent-emerald-600"
                            />
                            Promoción por cantidad (2x1, 3x2...)
                          </label>
                          {productDraft.promoType === 'MULTI_BUY' && (
                            <div className="mt-3 grid gap-4 sm:grid-cols-2">
                              <Field
                                label="Comprar (cantidad)"
                                value={productDraft.promoBuyQuantity || ''}
                                onChange={(value) => setProductDraft((current) => ({ ...current, promoBuyQuantity: value }))}
                                placeholder="ej. 3"
                                type="number"
                              />
                              <Field
                                label="Pagar (cantidad)"
                                value={productDraft.promoPayQuantity || ''}
                                onChange={(value) => setProductDraft((current) => ({ ...current, promoPayQuantity: value }))}
                                placeholder="ej. 2"
                                type="number"
                              />
                            </div>
                          )}
                          <p className="mt-2 text-[11px] leading-snug text-neutral-500">
                            El cliente ve "Comprar N, pagar M" y su ahorro automáticamente. Solo aplica a productos por pieza.
                          </p>
                        </div>
                      )}

                      {productDraft.sellBy === 'WEIGHT' && (() => {
                        const minGrams = Number(productDraft.minWeightG) || 0;
                        const maxGrams = Number(productDraft.maxWeightG) || 0;
                        const pricePerKg = Number(productDraft.unitPrice) || 0;
                        const presets = [...(productDraft.weightPresets || [])].sort((a, b) => a - b);

                        const exampleWeights = Array.from(
                          new Set([minGrams, 500, 1000, maxGrams].filter((w) => w > 0 && w >= minGrams && w <= maxGrams)),
                        ).sort((a, b) => a - b);

                        const handleAddPreset = () => {
                          const grams = unitToGrams(presetInput, weightUnit);
                          const min = Number(productDraft.minWeightG) || 0;
                          const max = Number(productDraft.maxWeightG) || 0;
                          if (grams === null) {
                            setPresetInputError('Escribe un peso válido (ej. 500 o 1.5).');
                            return;
                          }
                          if (min > 0 && grams < min) {
                            setPresetInputError(`El mínimo permitido es ${formatWeight(min)}.`);
                            return;
                          }
                          if (max > 0 && grams > max) {
                            setPresetInputError(`El máximo permitido es ${formatWeight(max)}.`);
                            return;
                          }
                          if ((productDraft.weightPresets || []).includes(grams)) {
                            setPresetInputError('Ese peso ya está en la lista.');
                            return;
                          }
                          setPresetInputError('');
                          setPresetInput('');
                          setProductDraft((c) => ({
                            ...c,
                            weightPresets: [...(c.weightPresets || []), grams].sort((a, b) => a - b),
                          }));
                        };

                        const handleMinChange = (v: string) => {
                          const grams = unitToGrams(v, weightUnit);
                          setProductDraft((c) => {
                            const newMin = grams !== null && grams > 0 ? String(grams) : '';
                            const filteredPresets = (c.weightPresets || []).filter(
                              (p) => (newMin ? p >= Number(newMin) : true),
                            );
                            return { ...c, minWeightG: newMin, weightPresets: filteredPresets };
                          });
                        };

                        const handleMaxChange = (v: string) => {
                          const grams = unitToGrams(v, weightUnit);
                          setProductDraft((c) => {
                            const newMax = grams !== null && grams > 0 ? String(grams) : '';
                            const filteredPresets = (c.weightPresets || []).filter(
                              (p) => (newMax ? p <= Number(newMax) : true),
                            );
                            return { ...c, maxWeightG: newMax, weightPresets: filteredPresets };
                          });
                        };

                        return (
                          <div className="sm:col-span-2 rounded-[24px] border border-sky-200/60 bg-sky-50/50 p-5 sm:p-6">
                            {/* Encabezado + selector de unidad */}
                            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-sky-700">Venta por peso</p>
                                <p className="mt-0.5 text-[13px] font-medium text-neutral-500">
                                  Tus clientes eligen cuántos gramos quieren pedir.
                                </p>
                              </div>
                              <div className="flex gap-1.5 rounded-full border border-sky-200 bg-white/70 p-1">
                                {(['g', 'kg'] as const).map((unit) => (
                                  <button
                                    key={unit}
                                    type="button"
                                    onClick={() => setWeightUnit(unit)}
                                    className={`rounded-full px-4 py-1.5 text-[12px] font-bold transition-all ${
                                      weightUnit === unit
                                        ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30'
                                        : 'text-neutral-500 hover:text-sky-700'
                                    }`}
                                  >
                                    {unit}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Vista previa de precios en vivo */}
                            {pricePerKg > 0 && exampleWeights.length > 0 && (
                              <div className="mb-5 rounded-2xl border border-sky-100 bg-white/80 p-4">
                                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">
                                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                                  Tus clientes verán costos así
                                </p>
                                <div className="mt-2.5 flex flex-wrap gap-2">
                                  {exampleWeights.map((w) => (
                                    <div
                                      key={w}
                                      className="flex items-baseline gap-1.5 rounded-xl border border-neutral-200/80 bg-white px-3 py-1.5 shadow-sm"
                                    >
                                      <span className="text-[13px] font-bold text-neutral-800">{formatWeight(w)}</span>
                                      <span className="text-[13px] font-black text-emerald-600">
                                        {formatCurrency((pricePerKg * w) / 1000)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                                <p className="mt-2 text-[11px] text-neutral-400">
                                  Se calcula con tu precio de {formatCurrency(pricePerKg)} por kilo.
                                </p>
                              </div>
                            )}

                            {/* Rango de peso */}
                            <div className="grid gap-4 sm:grid-cols-3">
                              <div className="space-y-1">
                                <Field
                                  label={`Mínimo (${weightUnit})`}
                                  value={weightToUnit(productDraft.minWeightG, weightUnit)}
                                  onChange={handleMinChange}
                                  placeholder={weightUnit === 'kg' ? '0.1' : '100'}
                                />
                                <p className="text-[11px] leading-snug text-neutral-400">Lo menos que puede pedir.</p>
                              </div>
                              <div className="space-y-1">
                                <Field
                                  label={`Máximo (${weightUnit})`}
                                  value={weightToUnit(productDraft.maxWeightG, weightUnit)}
                                  onChange={handleMaxChange}
                                  placeholder={weightUnit === 'kg' ? '5' : '5000'}
                                />
                                <p className="text-[11px] leading-snug text-neutral-400">El tope por pedido.</p>
                              </div>
                              <div className="space-y-1">
                                <Field
                                  label={`Incremento (${weightUnit})`}
                                  value={weightToUnit(productDraft.stepWeightG, weightUnit)}
                                  onChange={(v) => {
                                    const grams = unitToGrams(v, weightUnit);
                                    setProductDraft((c) => ({
                                      ...c,
                                      stepWeightG: grams !== null && grams > 0 ? String(grams) : '',
                                    }));
                                  }}
                                  placeholder={weightUnit === 'kg' ? '0.05' : '50'}
                                />
                                <p className="text-[11px] leading-snug text-neutral-400">De cuánto en cuánto sube.</p>
                              </div>
                            </div>

                            {/* Accesos rápidos editables */}
                            <div className="mt-6 rounded-2xl border border-sky-100 bg-white/70 p-4">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-sky-700">
                                    Accesos rápidos
                                  </p>
                                  <p className="mt-0.5 text-[11px] text-neutral-400">
                                    Botones que tus clientes tocan para pedir rápido.
                                  </p>
                                </div>
                                {presets.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setProductDraft((c) => {
                                        const min = Number(c.minWeightG) || 0;
                                        const max = Number(c.maxWeightG) || 0;
                                        return {
                                          ...c,
                                          weightPresets: [100, 250, 500, 1000, 2000].filter(
                                            (p) => (min ? p >= min : true) && (max ? p <= max : true),
                                          ),
                                        };
                                      })
                                    }
                                    className="rounded-full px-3 py-1.5 text-[11px] font-bold text-sky-600 transition hover:bg-sky-50"
                                  >
                                    Restablecer
                                  </button>
                                )}
                              </div>

                              {presets.length > 0 ? (
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {presets.map((p) => (
                                    <span
                                      key={p}
                                      className="group flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 py-1 pl-3 pr-1 text-[13px] font-bold text-sky-800"
                                    >
                                      {formatWeight(p)}
                                      <button
                                        type="button"
                                        title={`Quitar ${formatWeight(p)}`}
                                        onClick={() =>
                                          setProductDraft((c) => ({
                                            ...c,
                                            weightPresets: (c.weightPresets || []).filter((x) => x !== p),
                                          }))
                                        }
                                        className="flex h-5 w-5 items-center justify-center rounded-full text-sky-500 transition hover:bg-sky-100 hover:text-sky-700"
                                      >
                                        <X className="h-3 w-3" />
                                      </button>
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <p className="mt-3 rounded-xl border border-dashed border-neutral-200 bg-white px-4 py-3 text-[12px] text-neutral-400">
                                  Aún no hay accesos rápidos. Agrega los más comunes abajo.
                                </p>
                              )}

                              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                                <input
                                  value={presetInput}
                                  onChange={(e) => {
                                    setPresetInput(e.target.value);
                                    if (presetInputError) setPresetInputError('');
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      handleAddPreset();
                                    }
                                  }}
                                  aria-label={`Agregar acceso rápido en ${weightUnit}`}
                                  placeholder={weightUnit === 'kg' ? 'Ej. 0.75 kg' : 'Ej. 750'}
                                  inputMode="decimal"
                                  className="block w-full min-w-0 rounded-[18px] border border-black/5 bg-neutral-100/50 px-5 py-3 text-[15px] font-medium text-neutral-950 shadow-inner outline-none transition-all duration-300 placeholder:text-neutral-400 hover:bg-neutral-100/80 focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-400/20 sm:min-w-0"
                                />
                                <button
                                  type="button"
                                  onClick={handleAddPreset}
                                  className="shrink-0 rounded-[18px] bg-sky-600 px-5 py-3 text-[13px] font-bold text-white shadow-lg shadow-sky-600/25 transition hover:bg-sky-700 active:scale-[0.98]"
                                >
                                  <Plus className="mr-1 inline-block h-4 w-4" />
                                  Agregar
                                </button>
                              </div>
                              {presetInputError ? (
                                <p className="mt-2 flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-700">
                                  <Info className="h-3.5 w-3.5 shrink-0" />
                                  {presetInputError}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        );
                      })()}

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
                                <p className="text-xs text-neutral-500">PNG o JPG. Recomendado 1:1.</p>
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

                            <div className="flex items-center gap-3 rounded-2xl border border-dashed border-sky-200 bg-sky-50 p-4 transition-colors">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-600 shadow-sm">
                                <Wand2 className="h-5 w-5" />
                              </div>
                              <div className="flex-1">
                                <p className="text-sm font-bold text-sky-900">Generar con IA</p>
                                <p className="text-xs text-sky-700/70">
                                  Se crea con el nombre y la descripcion del producto.
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => void handleGenerateProductImage()}
                                disabled={
                                  generatingProductImage ||
                                  productDraft.name.trim().length < 2 ||
                                  productDraft.description.trim().length < 4
                                }
                                className="shrink-0 rounded-full bg-sky-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-sky-300"
                                title={
                                  productDraft.name.trim().length < 2
                                    ? 'Escribe el nombre del producto para poder generar la imagen.'
                                    : productDraft.description.trim().length < 4
                                      ? 'Escribe la descripcion del producto para que la imagen coincida con lo que se ofrece.'
                                      : 'Generar una imagen con IA para este producto'
                                }
                              >
                                {generatingProductImage ? 'Creando...' : 'Generar'}
                              </button>
                            </div>
                          </div>
                          
                          {/* Crop Preview */}
                          {productDraft.image.trim() && !productImageValidationError ? (
                            <div className="mt-4 flex flex-col items-center gap-1 sm:mt-0">
                              <div
                                ref={cropContainerRef}
                                className="group relative w-full select-none overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-100 shadow-sm aspect-[4/3] sm:w-44 sm:aspect-square"
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
                                    Arrastra para encuadrar y haz zoom
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
                              {profile?.businessType === 'RESTAURANT' ? 'Activa si contiene alcohol.' : 'Activa si es para adultos.'}
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

                      <div className="rounded-2xl border border-amber-100 bg-amber-50/50 p-4 sm:col-span-2 mt-2">
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                              <Package className="h-4 w-4" />
                            </div>
                            <div>
                              <h4 className="text-sm font-bold text-amber-950">Control de inventario</h4>
                              <p className="mt-0.5 text-xs font-medium text-amber-700/80">
                                Limita las unidades disponibles por pedido. Las ventas presenciales debes descontarlas manualmente aquí.
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setProductDraft((curr) => ({ ...curr, trackStock: !curr.trackStock }))}
                            className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ease-in-out focus:outline-none shadow-inner ${
                              productDraft.trackStock ? 'bg-amber-500' : 'bg-neutral-300'
                            }`}
                            role="switch"
                            aria-checked={productDraft.trackStock}
                          >
                            <span
                              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                                productDraft.trackStock ? 'translate-x-6' : 'translate-x-1'
                              }`}
                            />
                          </button>
                        </div>
                        {productDraft.trackStock && (
                          <div className="mt-4 grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-xs font-bold text-neutral-700">Unidades en stock</label>
                              <input
                                type="number"
                                min={0}
                                value={productDraft.stock}
                                onChange={(e) => setProductDraft((curr) => ({ ...curr, stock: e.target.value }))}
                                className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
                                placeholder="0"
                              />
                            </div>
                            <div>
                              <label className="text-xs font-bold text-neutral-700">Alerta de pocas unidades</label>
                              <input
                                type="number"
                                min={0}
                                value={productDraft.lowStockThreshold}
                                onChange={(e) => setProductDraft((curr) => ({ ...curr, lowStockThreshold: e.target.value }))}
                                className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-white"
                                placeholder="5"
                              />
                            </div>
                          </div>
                        )}
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
                      <Plus className="h-4 w-4" strokeWidth={2.5} />
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
                        {profile?.businessType === 'RESTAURANT' ? 'Añade tamaños, sabores o ingredientes extra.' : 'Añade talla, color o material.'}
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
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                          
                          <div className="p-5">
                            <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-12">
                              <div className="sm:col-span-6 min-w-0">
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
                              <div className="sm:col-span-3 min-w-0">
                                <label className="grid gap-1.5 text-xs font-bold text-neutral-800">
                                  <span>Mínimo</span>
                                  <EditableNumberInput
                                    integer
                                    min={0}
                                    value={group.minSelection}
                                    onCommit={(v) => {
                                      setProductDraft((current) => {
                                        const nextGroups = [...(current.optionGroups || [])];
                                        if (nextGroups[groupIdx]) {
                                          nextGroups[groupIdx] = {
                                            ...nextGroups[groupIdx],
                                            minSelection: v,
                                          };
                                        }
                                        return { ...current, optionGroups: nextGroups };
                                      });
                                    }}
                                    className="w-full rounded-xl border border-sky-100/60 bg-sky-50/30 px-4 py-2.5 text-center text-sm font-medium text-neutral-900 outline-none transition hover:bg-sky-50/60 focus:border-sky-400 focus:bg-white focus:ring-2 focus:ring-sky-400/20"
                                  />
                                </label>
                              </div>
                              <div className="sm:col-span-3 min-w-0">
                                <label className="grid gap-1.5 text-xs font-bold text-neutral-800">
                                  <span>Máximo</span>
                                  <EditableNumberInput
                                    integer
                                    min={1}
                                    value={group.maxSelection}
                                    onCommit={(v) => {
                                      setProductDraft((current) => {
                                        const nextGroups = [...(current.optionGroups || [])];
                                        if (nextGroups[groupIdx]) {
                                          nextGroups[groupIdx] = {
                                            ...nextGroups[groupIdx],
                                            maxSelection: v,
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
                                      <EditableNumberInput
                                        min={0}
                                        step="any"
                                        value={opt.price}
                                        onCommit={(v) => {
                                          setProductDraft((current) => {
                                            const nextGroups = [...(current.optionGroups || [])];
                                            if (nextGroups[groupIdx]?.options[optIdx]) {
                                              nextGroups[groupIdx].options[optIdx].price = v;
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
                                        <X className="h-4 w-4" />
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
            <div className="relative shrink-0 border-t border-sky-100/50 bg-white/70 px-5 py-4 backdrop-blur-xl sm:px-10 sm:py-5">
              {!productDraft.id ? (
                <div className="mb-3 flex items-center justify-between gap-3">
                  <label className="flex cursor-pointer select-none items-center gap-2.5 rounded-full border border-sky-100 bg-sky-50/60 px-4 py-2.5 text-[13px] font-semibold text-sky-800 transition hover:bg-sky-50">
                    <input
                      type="checkbox"
                      checked={continueAfterSave}
                      onChange={(event) => setContinueAfterSave(event.target.checked)}
                      className="h-5 w-5 shrink-0 accent-sky-500"
                    />
                    Añadir otro al publicar
                  </label>
                  <span className="hidden text-[11px] font-medium text-neutral-400 sm:block">
                    Enter en precio publica · Cmd/Ctrl + Enter en cualquier campo
                  </span>
                </div>
              ) : null}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsProductModalOpen(false)}
                  className="flex-1 rounded-full border border-black/10 px-5 py-3 text-sm font-bold text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900 sm:flex-none"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void submitProductNow()}
                  disabled={creatingProduct || savingProductChanges || processingProductImage || !canSubmitProduct}
                  className="group relative flex-1 overflow-hidden rounded-full bg-gradient-to-r from-sky-500 to-sky-400 px-6 py-3 text-sm font-bold text-white shadow-[0_4px_16px_rgba(14,165,233,0.35)] ring-1 ring-sky-400/50 transition-all hover:scale-105 disabled:pointer-events-none disabled:opacity-60 disabled:shadow-none disabled:grayscale sm:flex-none"
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
      {isImportModalOpen ? (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-sky-950/40 backdrop-blur-md sm:items-center sm:px-4 sm:py-6">
          <div className="relative flex h-[94vh] w-full max-w-[900px] flex-col overflow-hidden rounded-t-[36px] bg-white shadow-[0_32px_120px_rgba(14,165,233,0.25)] ring-1 ring-sky-100 sm:h-auto sm:max-h-[92vh] sm:rounded-[36px]">
            <div className="pointer-events-none absolute -left-20 -top-20 h-64 w-64 rounded-full bg-sky-300/20 blur-[80px]" />
            <div className="pointer-events-none absolute -right-20 top-1/2 h-64 w-64 rounded-full bg-blue-300/10 blur-[80px]" />

            <div className="relative shrink-0 border-b border-sky-100/50 bg-white/80 px-5 py-4 backdrop-blur-xl sm:px-8 sm:py-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 sm:gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-100 to-sky-50 text-sky-600 shadow-inner ring-1 ring-sky-200/50 sm:h-14 sm:w-14">
                    <svg className="h-6 w-6 sm:h-7 sm:w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-lg font-bold tracking-tight text-neutral-900 sm:text-2xl">Importar menú</h3>
                    <p className="mt-0.5 text-[13px] font-medium text-sky-700/70 sm:text-sm">
                      Pega una tabla de Excel o Sheets y crea todos los productos de una vez.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsImportModalOpen(false);
                    setImportResult(null);
                    setImportText('');
                  }}
                  className="group inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600 transition-all hover:bg-sky-100 hover:text-sky-900 sm:h-12 sm:w-12"
                  aria-label="Cerrar importación"
                >
                  <X className="h-5 w-5 transition-transform duration-300 group-hover:rotate-90" strokeWidth={2.5} />
                </button>
              </div>
            </div>

            <div className="relative flex-1 overflow-y-auto bg-gradient-to-b from-sky-50/30 to-white px-5 py-5 sm:px-8">
              {importResult ? (
                <div className="mx-auto max-w-[520px] py-8 text-center">
                  <div className={`mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full ring-8 ${importResult.created > 0 ? 'bg-emerald-50 text-emerald-500 ring-emerald-50/50' : 'bg-amber-50 text-amber-500 ring-amber-50/50'}`}>
                    {importResult.skipped === 0 ? (
                      <Check className="h-10 w-10" strokeWidth={2.5} />
                    ) : (
                      <Info className="h-10 w-10" />
                    )}
                  </div>
                  <h3 className="mb-2 text-[22px] font-bold tracking-tight text-neutral-900">
                    {importResult.created > 0 ? `Se importaron ${importResult.created} producto${importResult.created === 1 ? '' : 's'}` : 'Ningún producto importado'}
                  </h3>
                  {importResult.skipped > 0 ? (
                    <p className="mb-5 text-[15px] leading-relaxed text-neutral-500">
                      {importResult.skipped} fila{importResult.skipped === 1 ? '' : 's'} con errores fueron omitid{importResult.skipped === 1 ? 'a' : 'as'}.
                    </p>
                  ) : (
                    <p className="mb-5 text-[15px] leading-relaxed text-neutral-500">
                      Ya aparecen en tu menú publico.
                    </p>
                  )}

                  {importResult.errors.length > 0 ? (
                    <div className="mb-6 max-h-48 overflow-y-auto rounded-2xl border border-rose-100 bg-rose-50/60 p-3 text-left">
                      <p className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wide text-rose-600">Detalle de errores</p>
                      {importResult.errors.map((error, index) => (
                        <p key={index} className="px-1 py-1 text-[13px] leading-5 text-neutral-700">
                          <span className="font-bold text-rose-700">Fila {error.index + 1}</span>
                          <span className="text-neutral-500"> · {error.name}</span>
                          <span className="text-rose-600"> — {error.message}</span>
                        </p>
                      ))}
                    </div>
                  ) : null}

                  <div className="flex items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setImportResult(null);
                        setImportText('');
                        setImportHasHeader(false);
                      }}
                      className="rounded-full border border-black/10 px-5 py-3 text-sm font-bold text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900"
                    >
                      Importar otra lista
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsImportModalOpen(false)}
                      className="rounded-full bg-gradient-to-r from-sky-500 to-sky-400 px-6 py-3 text-sm font-bold text-white shadow-[0_4px_16px_rgba(14,165,233,0.35)] ring-1 ring-sky-400/50 transition-all hover:scale-105"
                    >
                      Listo
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <label className="grid gap-2">
                      <span className="text-[12px] font-bold uppercase tracking-[0.1em] text-neutral-600">Pega aquí tus filas</span>
                      <textarea
                        value={importText}
                        onChange={(event) => setImportText(event.target.value)}
                        rows={6}
                        placeholder={'nombre,precio,categoría,tipo,descripción\nTacos al pastor,45,Tacos,pieza,Tres tortillas con pastor y piña\nHamburguesa doble,90,Burgers,pieza,Pan artesanal con doble carne'}
                        className="w-full rounded-[18px] border border-black/5 bg-white px-5 py-4 text-[15px] font-medium text-neutral-950 shadow-inner outline-none transition-all placeholder:text-neutral-400 focus:border-sky-400 focus:ring-4 focus:ring-sky-400/20"
                      />
                    </label>
                    <p className="mt-2 text-[13px] leading-6 text-neutral-500">
                      Se detecta automáticamente el separador (coma, punto y coma o tabulación) y los encabezados. Sin encabezados, el orden por defecto es: Nombre, Precio, Categoría, Tipo de venta, Descripción, Precio especial e Imagen.
                    </p>
                  </div>

                  {importDataRows.length > 0 ? (
                    <>
                      <div className="mt-5 rounded-[28px] border border-sky-100 bg-white/80 p-5 shadow-[0_8px_30px_rgba(14,165,233,0.06)] ring-1 ring-sky-100/50">
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                          <p className="text-sm font-bold text-neutral-900">Mapeo de columnas</p>
                          <label className="flex cursor-pointer select-none items-center gap-2 text-[13px] font-semibold text-sky-800">
                            <input
                              type="checkbox"
                              checked={importHasHeader}
                              onChange={(event) => setImportHasHeader(event.target.checked)}
                              className="h-4 w-4 accent-sky-500"
                            />
                            Primera fila es encabezado
                          </label>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                          {IMPORT_FIELD_ORDER.map((field) => (
                            <label key={field} className="grid gap-1.5">
                              <span className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">{IMPORT_FIELD_LABELS[field]}</span>
                              <select
                                value={importColumnMap[field] ?? ''}
                                onChange={(event) =>
                                  setImportColumnMap((current) => ({
                                    ...current,
                                    [field]: event.target.value === '' ? undefined : Number(event.target.value),
                                  }))
                                }
                                className="w-full rounded-xl border border-black/5 bg-neutral-50 px-3 py-2.5 text-sm font-semibold text-neutral-800 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20"
                              >
                                <option value="">— Sin usar —</option>
                                {Array.from({ length: importColumnCount }, (_, index) => (
                                  <option key={index} value={index}>
                                    {String.fromCharCode(65 + index)}{importHeaderRow[index] ? ` · ${importHeaderRow[index]}` : ''}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ))}
                          <label className="grid gap-1.5">
                            <span className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">Categoría por defecto</span>
                            <select
                              value={importDefaultCategoryId}
                              onChange={(event) => setImportDefaultCategoryId(event.target.value)}
                              className="w-full rounded-xl border border-black/5 bg-neutral-50 px-3 py-2.5 text-sm font-semibold text-neutral-800 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20"
                            >
                              <option value="">— Sin usar —</option>
                              {categories.map((category) => (
                                <option key={category.id} value={category.id}>{category.name}</option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <label className="mt-4 flex cursor-pointer select-none items-center gap-2 text-[13px] font-semibold text-sky-800">
                          <input
                            type="checkbox"
                            checked={importCreateMissingCategories}
                            onChange={(event) => setImportCreateMissingCategories(event.target.checked)}
                            className="h-4 w-4 accent-sky-500"
                          />
                          Crear automáticamente las categorías que falten
                        </label>
                      </div>

                      <div className="mt-5 rounded-[28px] border border-sky-100 bg-white/70 p-4 shadow-sm">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-bold text-neutral-900">Vista previa</p>
                          <p className="text-[13px] font-semibold">
                            <span className="text-emerald-600">{importValidCount} listo{importValidCount === 1 ? '' : 's'}</span>
                            {importErrorCount > 0 ? (
                              <>
                                <span className="text-neutral-300"> · </span>
                                <span className="text-rose-600">{importErrorCount} con errores</span>
                              </>
                            ) : null}
                          </p>
                        </div>
                        <div className="max-h-72 overflow-y-auto rounded-2xl border border-black/5">
                          <table className="w-full text-left text-sm">
                            <thead className="sticky top-0 bg-neutral-50 text-[11px] font-bold uppercase tracking-wide text-neutral-500">
                              <tr>
                                <th className="px-3 py-2">Nombre</th>
                                <th className="px-3 py-2">Precio</th>
                                <th className="px-3 py-2">Categoría</th>
                                <th className="px-3 py-2">Estado</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-black/5 bg-white">
                              {importPreview.map((row) => (
                                <tr key={row.rowIndex} className="align-top">
                                  <td className="px-3 py-2 font-medium text-neutral-900">{row.name || '—'}</td>
                                  <td className="px-3 py-2 text-neutral-700">{row.price !== null ? formatCurrency(row.price) : '—'}</td>
                                  <td className="px-3 py-2 text-neutral-700">
                                    {row.willCreateCategory ? (
                                      <span className="font-semibold text-amber-600">{row.categoryLabel} (nueva)</span>
                                    ) : (
                                      row.categoryLabel || '—'
                                    )}
                                  </td>
                                  <td className="px-3 py-2">
                                    {row.isValid ? (
                                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">Listo</span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700">{row.errors[0]}</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </>
                  ) : null}
                </>
              )}
            </div>

            <div className="relative shrink-0 border-t border-sky-100/50 bg-white/70 px-5 py-4 backdrop-blur-xl sm:px-8 sm:py-5">
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setIsImportModalOpen(false);
                    setImportResult(null);
                    setImportText('');
                  }}
                  className="rounded-full border border-black/10 px-5 py-3 text-sm font-bold text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900"
                >
                  Cancelar
                </button>
                {!importResult ? (
                  <button
                    type="button"
                    onClick={() => void handleImportSubmit()}
                    disabled={importingProducts || importValidCount === 0}
                    className="group relative flex-1 overflow-hidden rounded-full bg-gradient-to-r from-sky-500 to-sky-400 px-6 py-3 text-sm font-bold text-white shadow-[0_4px_16px_rgba(14,165,233,0.35)] ring-1 ring-sky-400/50 transition-all hover:scale-105 disabled:pointer-events-none disabled:opacity-60 disabled:shadow-none disabled:grayscale sm:flex-none"
                  >
                    <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-1000 group-hover:translate-x-full" />
                    {importingProducts
                      ? 'Importando...'
                      : `Importar ${importValidCount} producto${importValidCount === 1 ? '' : 's'}`}
                  </button>
                ) : null}
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
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <form
                  className="mt-6 grid gap-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void loginWithPassword();
                  }}
                >
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

                  <button
                    type="submit"
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
                </form>
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
                            <AlertTriangle className="h-5 w-5" />
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
                          className="relative flex items-center gap-2 rounded-full bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-600 md:py-3 animate-heartbeat"
                        >
                          <span aria-hidden="true" className="pointer-events-none absolute -inset-1 -z-10 rounded-full bg-sky-400/40 animate-ping" />
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
                          const supportNotifyHere = supportNotifyByOrder[order.id];
                          const supportExhaustedHere =
                            (supportNotifyHere?.exhausted ?? false) ||
                            ((order.supportAttempts ?? 0) >= 2 && !order.supportRestaurantId && !order.isSupportRequested);
                          const actionButtons = isHelper
                            // Se conserva el flujo manual del apoyo (iniciar entrega / marcar entregado);
                            // el QR de express es la vía principal que usa el repartidor aliado.
                            ? (order.status === 'READY' ? ['iniciarEntrega'] : order.status === 'IN_TRANSIT' ? ['delivered'] : [])
                            // Pedido de apoyo (restaurante origen): al llegar el repartidor aliado se
                            // habilita confirmar la entrega (PIN en transferencia / efectivo), igual que
                            // con un repartidor SaDeL.
                            : (isSupported
                                ? (order.status === 'READY' && driverArrivedOrders[order.id]
                                    ? ['handover'] as Array<keyof typeof restaurantActionMap>
                                    : [])
                                : getRestaurantActions(order, hasOwnDelivery, Boolean(driverArrivedOrders[order.id])));
                          const selectedDriverId = selectedDriverByOrder[order.id] || '';
                          const canAssignDriver =
                            !hasOwnDelivery &&
                            order.fulfillmentType !== 'PICKUP' &&
                            order.status === 'READY' &&
                            !order.driver &&
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
                              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 mb-3">
                                <div className="flex flex-wrap items-center gap-2 sm:gap-3 min-w-0">
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
                                  <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2 sm:justify-end">
                                    {(() => {
                                      if (profile?.businessType === 'RESTAURANT') return null;
                                      if (!order.scheduledDeliveryAt) return null;
                                      const isCustomerPending = !order.scheduledDeliveryCustomerAcceptedAt && order.status === 'CONFIRMED';
                                      const isCustomerAccepted = !!order.scheduledDeliveryCustomerAcceptedAt;
                                      return (
                                        <>
                                          {isCustomerPending && (
                                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-1 text-[10px] font-bold text-amber-700 shadow-sm shrink-0">
                                              <span className="relative flex h-1.5 w-1.5">
                                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75"></span>
                                                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-600"></span>
                                              </span>
                                              Pendiente de confirmación
                                            </span>
                                          )}
                                          {isCustomerAccepted && (
                                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-[10px] font-bold text-emerald-700 shadow-sm shrink-0">
                                              ✅ Cliente confirmó fecha
                                            </span>
                                          )}
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
                                        </>
                                      );
                                    })()}
                                    {profile?.businessType !== 'RESTAURANT' && order.preparationTimeMinutes && order.preparationTimeMinutes > 1 && (order.status === 'CONFIRMED' || order.status === 'PREPARING') && isPrepCountdownRelevant(order, kitchenClockNow) && (() => {
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
                                    {profile?.businessType === 'RESTAURANT' && (order.status === 'CONFIRMED' || order.status === 'PREPARING') && isPrepCountdownRelevant(order, kitchenClockNow) && (() => {
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
                                    <User className="w-4 h-4 text-neutral-400 shrink-0" />
                                    {getCustomerFullName(order.customer?.user) || 'Cliente SaDeL'}
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
                                    ) : order.supportRestaurant?.name || (isSupported && supportAliadoNamesByOrder[order.id]) ? (
                                      <span className="inline-flex items-center gap-1.5 bg-emerald-50 border border-emerald-100 rounded-full pr-3 pl-1 py-1">
                                        <div className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center text-[9px] font-bold text-emerald-700">
                                          🤝
                                        </div>
                                        <span className="font-semibold text-emerald-800 dark:text-emerald-300 text-xs">
                                          {isHelper
                                            ? `🧑‍🍳 ${order.restaurant?.name || 'Red aliada'}`
                                            : `🛵 ${order.supportRestaurant?.name || supportAliadoNamesByOrder[order.id] || 'Restaurante aliado'}`}
                                        </span>
                                        <span className="text-[9px] font-bold text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded-full">
                                          {isHelper ? 'Entrega de apoyo' : 'Apoyo a red'}
                                        </span>
                                        {!isHelper && driverArrivedOrders[order.id] && order.status === 'READY' && (
                                          <span className="text-[9px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full">
                                            🛵 Repartidor en tienda
                                          </span>
                                        )}
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
                                        <span>{isHelper ? '🛵' : profile?.businessType !== 'RESTAURANT' ? '📦' : '🍳'}</span> {isHelper ? 'Productos a entregar' : profile?.businessType !== 'RESTAURANT' ? 'Productos a surtir' : 'Productos a preparar'}
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
                                   if (validStatus && order.scheduledDeliveryAt && !isDelayed) {
                                     const scheduledTime = new Date(order.scheduledDeliveryAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
                                     return (
                                       <div className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl border border-sky-100 bg-sky-50/70 px-3 py-2.5 text-xs font-semibold text-sky-800">
                                         <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
                                         <span>{order.fulfillmentType === 'PICKUP' ? 'Recogida programada' : 'Entrega programada'} · {scheduledTime}</span>
                                       </div>
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
                                          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-600">Apoyo de entrega · Tu tarifa</p>
                                          <p className="text-xl font-bold text-neutral-950">{formatCurrency(order.deliveryFee)}</p>
                                          <p className="text-[10px] text-emerald-600 font-medium flex items-center gap-1 mt-1">
                                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                            {order.paymentMethod === 'CASH'
                                              ? `Entregas ${formatCurrency(order.totalAmount - (order.deliveryFee || 0))} al restaurante y cobras ${formatCurrency(order.totalAmount)} al cliente`
                                              : 'Recibe la tarifa por la entrega del apoyo'}
                                          </p>
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
                                      const supportDelivery = !!order.supportRestaurantId;
                                      return (
                                        <>
                                          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-600">
                                            {supportDelivery
                                              ? (['DELIVERED', 'PICKED_UP', 'IN_TRANSIT'].includes(order.status) || order.cashPaymentConfirmedAt ? 'Cobrado al restaurante aliado' : 'Cobrar al restaurante que entrega')
                                              : (order.status === 'DELIVERED' || order.cashPaymentConfirmedAt ? 'Cobrado al repartidor' : 'Cobrar al repartidor')}
                                          </p>
                                          <p className="text-xl font-bold text-neutral-950">{formatCurrency(foodAmount)}</p>
                                          {!['PICKED_UP', 'IN_TRANSIT', 'DELIVERED'].includes(order.status) && !order.cashPaymentConfirmedAt && (
                                            supportDelivery
                                              ? <p className="text-[10px] text-neutral-500">Entregar al aliado al recoger; él cobra el total al cliente y le queda el envío.</p>
                                              : <p className="text-[10px] text-neutral-500">El repartidor cobra el total al cliente.</p>
                                          )}
                                        </>
                                      );
                                    }

                                    if (order.paymentMethod === 'TRANSFER') {
                                      const handedOver = ['PICKED_UP', 'IN_TRANSIT', 'DELIVERED'].includes(order.status);
                                      return (
                                        <>
                                          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-sky-600">
                                            Recibido por transferencia
                                          </p>
                                          <p className="text-xl font-bold text-neutral-950">{formatCurrency(order.totalAmount)}</p>
                                          {order.supportRestaurantId ? (
                                            handedOver ? (
                                              <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2">
                                                <div className="flex items-center justify-between">
                                                  <span className="text-[11px] font-semibold text-emerald-600">✅ Ya pagado al repartidor de apoyo</span>
                                                  <span className="text-sm font-bold text-emerald-700">{formatCurrency(order.deliveryFee)}</span>
                                                </div>
                                                <p className="text-[9px] text-emerald-500 mt-0.5 leading-tight">
                                                  El total del pedido cuenta como ingreso del restaurante aliado; él gana solo el envío.
                                                </p>
                                              </div>
                                            ) : (
                                              (order as any).fulfillmentType !== 'PICKUP' && (
                                                <div className="mt-2 rounded-xl border border-dashed border-rose-200 bg-rose-50/60 px-3 py-2">
                                                  <div className="flex items-center justify-between">
                                                    <span className="text-[11px] font-semibold text-rose-600">👉 Pagar al restaurante aliado</span>
                                                    <span className="text-sm font-bold text-rose-700">{formatCurrency(order.deliveryFee)}</span>
                                                  </div>
                                                  <p className="text-[9px] text-rose-400 mt-0.5 leading-tight">
                                                    Entregar en efectivo al restaurante aliado al recoger el pedido
                                                  </p>
                                                </div>
                                              )
                                            )
                                          ) : (
                                            !handedOver && !order.deliveredByRestaurant && (order as any).fulfillmentType !== 'PICKUP' && (
                                              <div className="mt-2 rounded-xl border border-dashed border-rose-200 bg-rose-50/60 px-3 py-2">
                                                <div className="flex items-center justify-between">
                                                  <span className="text-[11px] font-semibold text-rose-600">👉 Pagar al repartidor</span>
                                                  <span className="text-sm font-bold text-rose-700">{formatCurrency(order.deliveryFee)}</span>
                                                </div>
                                                <p className="text-[9px] text-rose-400 mt-0.5 leading-tight">
                                                  Entregar en efectivo al repartidor al recoger el pedido
                                                </p>
                                              </div>
                                            )
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

                                  {Number(order.promoDiscountAmount || 0) > 0 && (
                                    <div className="mt-3 inline-flex flex-wrap items-center gap-1.5 rounded-xl border border-sky-100 bg-sky-50/60 px-3 py-2">
                                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-500 text-white">
                                        <Tag className="h-3 w-3" strokeWidth={2.5} />
                                      </span>
                                      <span className="text-[11px] font-semibold text-neutral-500">Descuento aplicado</span>
                                      <span className="text-[12px] font-bold text-sky-700">-{formatCurrency(Number(order.promoDiscountAmount))}</span>
                                    </div>
                                  )}
                                </div>
                                <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 items-stretch sm:items-center justify-end min-w-0" onClick={(e) => e.stopPropagation()}>
                                  {!isHelper && (order.status !== 'IN_TRANSIT' || (!hasOwnDelivery && !!order.driver)) ? (
                                    <button
                                      type="button"
                                      onClick={() => setSelectedOrderForTicket(order)}
                                      className="w-full sm:w-auto justify-center rounded-full bg-gradient-to-r from-sky-600 to-blue-600 px-5 py-2.5 sm:py-2 text-sm font-semibold text-white shadow-sm hover:from-sky-500 hover:to-blue-500 transition flex items-center gap-2"
                                    >
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                                      </svg>
                                      {profile?.businessType !== 'RESTAURANT' ? 'Ver orden' : 'Ver comanda'}
                                    </button>
                                  ) : null}

                                  {order.status === 'IN_TRANSIT' && !isHelper && !order.supportRestaurantId && (hasOwnDelivery || !order.driver) && (
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
                                              url: res.data.url,
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

                                  {isHelper && !['DELIVERED', 'COMPLETED', 'REJECTED', 'CANCELLED', 'PENDING'].includes(order.status) && (
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
                                              url: res.data.url,
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

                                  {/* Botones de Accion (solo para pedidos propios; las entregas de apoyo usan el QR) */}
                                  {!isHelper && actionButtons.length > 0 ? (
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

                              {/* Asignar Repartidor (Solo emergencia: pedido listo sin repartidor) */}
                              {canAssignDriver ? (
                                <div className="mt-3 grid gap-3 rounded-[24px] border border-amber-200 bg-amber-50 p-4 md:grid-cols-[1fr_auto] md:items-end" onClick={(e) => e.stopPropagation()}>
                                  <label className="grid gap-2 text-sm text-amber-800">
                                    <span className="font-semibold flex items-center gap-1.5">
                                      <span className="text-base">⚠️</span> Asignar repartidor (emergencia)
                                    </span>
                                    <span className="text-xs font-normal text-amber-600">El pedido está listo sin repartidor. Elige uno disponible para no retrasar la entrega.</span>
                                    <select
                                      value={selectedDriverId}
                                      onChange={(event) =>
                                        setSelectedDriverByOrder((current) => ({
                                          ...current,
                                          [order.id]: event.target.value,
                                        }))
                                      }
                                      className="rounded-2xl border border-amber-200 bg-white px-4 py-3 text-neutral-950 outline-none transition focus:border-amber-300"
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
                                    className="rounded-full border border-amber-300 bg-amber-500 px-4 py-3 font-semibold text-white shadow-[0_12px_30px_rgba(245,158,11,0.22)] transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:border-black/5 disabled:bg-neutral-300 disabled:shadow-none"
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
                              {((order as any).fulfillmentType !== 'PICKUP' && !order.supportRestaurantId && (order.status === 'READY' || ((order.status === 'CONFIRMED' || order.status === 'PREPARING') && order.noDriversAvailable)) && !order.driver) ? (
                                <div className="flex flex-col gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
                                  {/* Esperando respuesta de la red: solo informativo, nunca bloquea acciones */}
                                  {order.isSupportRequested && order.supportRequestedAt && (
                                    <div className="rounded-[16px] border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
                                      <div className="flex items-center gap-2">
                                        <span className="relative flex h-2.5 w-2.5 shrink-0">
                                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-sky-500"></span>
                                        </span>
                                        <div className="min-w-0 flex-1">
                                          <p className="font-semibold">Esperando respuesta de la red…</p>
                                          <p className="text-xs text-sky-600 mt-0.5">
                                            {(() => {
                                              const elapsedMs = Math.max(0, supportCountdownNow - new Date(order.supportRequestedAt!).getTime());
                                              const remainingMs = Math.max(0, 2 * 60 * 1000 - elapsedMs);
                                              const secs = Math.ceil(remainingMs / 1000);
                                              const mm = Math.floor(secs / 60);
                                              const ss = secs % 60;
                                              return remainingMs <= 0
                                                ? 'Finalizando solicitud…'
                                                : `Si nadie responde en ${mm}:${String(ss).padStart(2, '0')} min, el pedido queda para ti.`;
                                            })()}
                                          </p>
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                  {supportNotifyHere ? (
                                    <div className="rounded-[16px] border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                                      <div className="flex items-center gap-2">
                                        <span className="text-base">😕</span>
                                        <div className="min-w-0 flex-1">
                                          <p className="font-semibold">Nadie aceptó tu solicitud de apoyo</p>
                                          {supportNotifyHere.exhausted ? (
                                            <p className="text-xs text-rose-600 mt-0.5">Agotaste los 2 intentos. Solo puedes ir a entregar tú mismo.</p>
                                          ) : (
                                            <p className="text-xs text-rose-600 mt-0.5">
                                              Puedes reintentar (te queda{supportNotifyHere.attemptsLeft === 1 ? '' : 'n'} {supportNotifyHere.attemptsLeft} intento{supportNotifyHere.attemptsLeft === 1 ? '' : 's'}) o entregarlo tú mismo.
                                            </p>
                                          )}
                                        </div>
                                        {!supportNotifyHere.exhausted && !order.isSupportRequested && (
                                          <button
                                            type="button"
                                            onClick={() => void runOrderAction(order.id, 'solicitarApoyo')}
                                            disabled={activeActionKey === `${order.id}:solicitarApoyo`}
                                            className="shrink-0 rounded-full bg-rose-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                                          >
                                            {activeActionKey === `${order.id}:solicitarApoyo` ? 'Reenviando...' : 'Reintentar'}
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  ) : null}
                                  <div className="flex flex-col sm:flex-row gap-2">
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
                                    {!profile?.hasOwnDelivery && !supportExhaustedHere && !supportNotifyHere?.exhausted && !order.isSupportRequested && (
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

                {activeSection === 'store' && loading ? (
                  <div className="flex flex-col items-center justify-center rounded-[32px] border border-black/5 bg-white px-6 py-20 text-center shadow-[0_10px_30px_rgba(15,15,15,0.04)]">
                    <SaDelLoader size="md" label="Cargando tu tienda..." />
                  </div>
                ) : null}

                {activeSection === 'store' && profile ? (
                    <div className={`space-y-6 ${isSelectionMode ? 'pb-32' : ''}`}>
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
                          <div className="absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-3 p-4 md:p-6 lg:p-8">
                            <div className="flex flex-wrap min-w-0 items-center gap-2">
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
                              <Pencil className="h-4 w-4" strokeWidth={1.9} />
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
                                  <Pencil className="h-4 w-4" />
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
                                <Pencil className="h-4 w-4" />
                              </button>
                            </div>
                            <p className="mt-4 text-3xl font-bold tracking-tight text-neutral-950 break-words">
                              {storeDraft.name || 'Nombre de tu tienda'}
                            </p>
                            <p className="mt-2 max-w-sm text-[15px] font-medium leading-relaxed text-neutral-500 break-words">
                              {storeDraft.description || 'Agrega una descripcion atractiva para tus clientes.'}
                            </p>
                          </div>

                          <div className="mt-5 flex flex-wrap justify-center gap-3 lg:mt-6 lg:justify-start">
                            <div className="group flex max-w-full min-w-0 items-center gap-2 rounded-full bg-white/80 backdrop-blur-md px-4 py-2.5 text-[13px] font-medium text-neutral-700 shadow-sm ring-1 ring-black/5 transition hover:bg-white hover:shadow-md">
                              <svg className="h-4 w-4 shrink-0 text-sky-500 transition-transform group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.243-4.243a8 8 0 1111.314 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                              <span className="min-w-0 break-words">
                                <span className="font-bold text-neutral-900">Direccion:</span>{' '}
                                {storeDraft.address || 'Agrega tu direccion principal'}
                              </span>
                            </div>

                            <div className="group flex max-w-full min-w-0 items-center gap-2 rounded-full bg-white/80 backdrop-blur-md px-4 py-2.5 text-[13px] font-medium text-neutral-700 shadow-sm ring-1 ring-black/5 transition hover:bg-white hover:shadow-md">
                              <svg className="h-4 w-4 shrink-0 text-sky-500 transition-transform group-hover:scale-110" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <span className="min-w-0 break-words">
                                <span className="font-bold text-neutral-900">Entrega:</span>{' '}
                                {storeDraft.hasOwnDelivery && storeDraft.deliveryPricingModel === 'distance'
                                  ? 'Por distancia'
                                  : storeDraft.deliveryFee.trim()
                                    ? formatCurrency(Number(storeDraft.deliveryFee))
                                    : 'Sin costo'}
                              </span>
                            </div>

                            <div
                              className={`group flex max-w-full min-w-0 items-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-bold shadow-sm ring-1 transition hover:shadow-md ${profile.status === 'ACTIVE' && profile.isAcceptingOrders
                                ? 'bg-emerald-50/80 text-emerald-700 ring-emerald-200/60 hover:bg-emerald-100'
                                : profile.status === 'SUSPENDED'
                                  ? 'bg-sky-50/80 text-sky-700 ring-sky-200/60 hover:bg-sky-100'
                                  : 'bg-neutral-100/80 text-neutral-500 ring-black/5 hover:bg-neutral-200'
                                }`}
                            >
                              <Clock />
                              <span className="min-w-0 break-words">
                                {getRestaurantOperationalStatusLabel(
                                  profile.status,
                                  profile.isAcceptingOrders
                                )}
                              </span>
                            </div>
                          </div>
                        </div>
                      </section>

                      <div className="flex flex-col gap-3 rounded-[24px] border border-black/5 bg-white p-3 shadow-[0_10px_30px_rgba(15,15,15,0.04)] sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="inline-flex rounded-full border border-black/10 bg-neutral-100/70 p-1 shadow-inner">
                            <button
                              type="button"
                              onClick={() => setStoreViewMode('list')}
                              aria-pressed={storeViewMode === 'list'}
                              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-bold transition ${storeViewMode === 'list' ? 'bg-white text-sky-700 shadow-sm' : 'text-neutral-500 hover:text-neutral-800'}`}
                            >
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
                              Lista
                            </button>
                            <button
                              type="button"
                              onClick={() => setStoreViewMode('cards')}
                              aria-pressed={storeViewMode === 'cards'}
                              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-bold transition ${storeViewMode === 'cards' ? 'bg-white text-sky-700 shadow-sm' : 'text-neutral-500 hover:text-neutral-800'}`}
                            >
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
                              Tarjetas
                            </button>
                          </div>
                          <div className="relative min-w-0 flex-1 sm:min-w-[220px] sm:max-w-xs">
                            <svg className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                            <input
                              type="text"
                              value={storeSearchQuery}
                              onChange={(event) => setStoreSearchQuery(event.target.value)}
                              placeholder="Buscar en tu menú..."
                              className="w-full rounded-full border border-black/10 bg-neutral-50 py-2.5 pl-10 pr-9 text-base font-medium text-neutral-900 shadow-inner outline-none transition placeholder:text-neutral-400 focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-400/20 sm:text-sm"
                            />
                            {storeSearchQuery ? (
                              <button
                                type="button"
                                onClick={() => setStoreSearchQuery('')}
                                className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-neutral-400 transition hover:bg-neutral-200 hover:text-neutral-700"
                                aria-label="Limpiar búsqueda"
                              >
                                <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                              </button>
                            ) : null}
                          </div>
                                </div>
                                  <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2 sm:justify-end">
                          {isSelectionMode ? (
                            <button
                              type="button"
                              onClick={exitSelectionMode}
                              className="rounded-full border border-sky-200 bg-sky-50 px-4 py-2.5 text-[13px] font-bold text-sky-800 transition hover:bg-sky-100"
                            >
                              Salir de selección
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={enterSelectionMode}
                              className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2.5 text-[13px] font-bold text-neutral-700 transition hover:bg-neutral-50 hover:text-neutral-900"
                            >
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
                              Seleccionar varios
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="-mx-1 overflow-x-auto px-1 pb-4 pt-2 scrollbar-none sticky top-0 z-20 bg-gradient-to-b from-[#f8f8f8] via-[#f8f8f8]/95 to-transparent backdrop-blur-sm">
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
<button
                              type="button"
                              onClick={openImportModal}
                              className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white px-5 py-2.5 text-[13px] font-bold text-sky-800 shadow-sm transition hover:bg-sky-50 hover:border-sky-400"
                              title="Importa todo tu menú pegando una tabla de Excel o Sheets"
                            >
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                              Importar menú
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleBulkGenerateMissingImages()}
                              disabled={bulkActionLoading}
                              className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white px-5 py-2.5 text-[13px] font-bold text-sky-800 shadow-sm transition hover:bg-sky-50 hover:border-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
                              title="Genera con IA una imagen para cada producto del menú que todavía no tiene foto"
                            >
                              <Sparkles className="h-4 w-4" />
                              {bulkActionLoading ? 'Generando...' : 'Generar imágenes'}
                            </button>
                        </div>
                      </div>

                      {storeViewMode === 'cards' ? (
                      <div className="space-y-6">
                        {filteredStoreCategories.map((category) => (
                          <section key={category.id} className="rounded-[24px] px-0 py-0">
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
                              <div className="min-w-0">
                                <div className="flex min-w-0 items-center gap-3">
                                  <h2 className="min-w-0 text-2xl font-semibold tracking-[-0.03em] text-neutral-950 break-words">
                                    {category.name}
                                  </h2>
                                  <div className="flex shrink-0 items-center gap-1">
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
                                      <ChevronUp className="w-4 h-4" />
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

                            <div className="mt-5 grid grid-cols-1 min-[420px]:grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
                              {category.products.map((product) => (
                                <article
                                  key={product.id}
                                  className="group overflow-hidden rounded-[32px] border border-sky-100/50 bg-white/70 backdrop-blur-md shadow-[0_4px_20px_rgba(14,165,233,0.03)] ring-1 ring-black/5 transition-all hover:scale-[1.02] hover:bg-white hover:shadow-[0_12px_32px_rgba(14,165,233,0.12)] hover:ring-sky-200/60"
                                >
                                  <div className="flex h-full flex-col">
                                    <div className="relative aspect-[4/3] w-full shrink-0">
                                      {isSelectionMode ? (
                                        <button
                                          type="button"
                                          onClick={() => toggleProductSelection(product.id)}
                                          className={`absolute left-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full border-2 shadow-md transition ${selectedProductIds.has(product.id) ? 'border-sky-500 bg-sky-500 text-white' : 'border-white bg-white/90 text-transparent hover:border-sky-300 hover:text-sky-200'}`}
                                          aria-label={selectedProductIds.has(product.id) ? `Quitar ${product.name} de la selección` : `Seleccionar ${product.name}`}
                                        >
                                          <Check className="h-5 w-5" strokeWidth={3} />
                                        </button>
                                      ) : null}
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

                                    <div className="flex flex-1 flex-col justify-between p-4 sm:p-5">
                                      <div>
                                        <div className="flex items-start justify-between gap-2">
                                          <h3 className="flex min-w-0 items-center gap-2 text-base font-semibold text-neutral-950 sm:text-lg break-words">
                                            {product.name}
                                            {product.isAdultOnly && (
                                              <span className="shrink-0 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 tracking-wider">
                                                +18
                                              </span>
                                            )}
                                          </h3>
                                        </div>
                                        <p className="mt-2 text-sm leading-6 text-neutral-600 break-words line-clamp-3">
                                          {product.description}
                                        </p>
                                        {product.promoType === 'MULTI_BUY' && product.promoBuyQuantity != null && product.promoPayQuantity != null && product.promoBuyQuantity > 0 && product.promoPayQuantity > 0 ? (
                                          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50/70 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                                            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M12 5v14" /></svg>
                                            {product.promoBuyQuantity} x {product.promoPayQuantity}
                                          </div>
                                        ) : null}
                                        {product.discountPrice ? (
                                          <div className="mt-3 flex items-center gap-2">
                                            <p className="text-lg font-bold text-sky-600 sm:text-xl">
                                              {formatCurrency(product.discountPrice)}
                                            </p>
                                            <p className="text-sm font-medium text-neutral-400 line-through">
                                              {formatCurrency(product.price)}
                                            </p>
                                          </div>
                                        ) : (
                                          <p className="mt-3 text-lg font-semibold text-neutral-950 sm:text-xl">
                                            {formatCurrency(product.price)}
                                          </p>
                                        )}
                                      </div>

                                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
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
                                            <Pencil className="h-4 w-4" strokeWidth={1.9} />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => openDuplicateProductModal(product)}
                                            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-sky-100 bg-sky-50 text-sky-600 transition hover:bg-sky-100"
                                            aria-label={`Duplicar ${product.name}`}
                                            title="Duplicar producto"
                                          >
                                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                strokeWidth={1.9}
                                                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                                              />
                                            </svg>
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => openDeleteProductModal(product)}
                                            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-rose-200 bg-rose-50 text-rose-600 transition hover:bg-rose-100"
                                            aria-label={`Eliminar ${product.name}`}
                                          >
                                            <Trash2 className="h-4 w-4" strokeWidth={1.9} />
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
                                className="group flex min-h-[200px] flex-col items-center justify-center rounded-[32px] border-2 border-dashed border-sky-200/60 bg-sky-50/20 text-center shadow-sm transition-all hover:border-sky-400 hover:bg-sky-50/60 hover:shadow-[0_12px_32px_rgba(14,165,233,0.1)] sm:min-h-[260px]"
                              >
                                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 to-sky-500 text-2xl font-light text-white shadow-lg shadow-sky-500/20 transition-transform duration-300 group-hover:scale-110 sm:h-16 sm:w-16 sm:text-3xl">
                                  +
                                </span>
                                <p className="mt-4 text-base font-semibold text-sky-900 sm:mt-5 sm:text-lg">Agregar producto</p>
                                <p className="mt-2 max-w-[16rem] px-3 text-[12px] leading-6 text-sky-700/70 sm:max-w-[18rem] sm:text-[13px]">
                                  Crea un nuevo producto dentro de <span className="font-bold">{category.name}</span> con imagen, descripcion y costo.
                                </p>
                              </button>
                            </div>
                          </section>
                        ))}

                        {storeCategories.length === 0 ? (
                          <EmptyState text="Todavia no tienes categorias. Crea la primera para empezar a publicar tu menu." />
                        ) : filteredStoreCategories.length === 0 ? (
                          <EmptyState text="No hay resultados para tu busqueda." />
                        ) : null}
                      </div>
                      ) : (
                        <div className="space-y-6">
                          {filteredStoreCategories.length === 0 ? (
                            <div className="overflow-hidden rounded-[28px] border border-sky-100/60 bg-white/80 shadow-[0_10px_30px_rgba(15,15,15,0.04)]">
                              <EmptyState text={storeSearchQuery.trim() ? 'No hay resultados para tu busqueda.' : 'Aun no tienes productos. Agrega el primero o importa tu menu.'} />
                            </div>
                          ) : (
                            filteredStoreCategories.map((category) => (
                              <section key={category.id} className="overflow-hidden rounded-[28px] border border-sky-100/60 bg-white/80 shadow-[0_10px_30px_rgba(15,15,15,0.04)]">
                                <div className="flex flex-col gap-2 border-b border-black/5 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                                  <div className="flex items-center gap-3">
                                    <h3 className="text-[15px] font-bold tracking-tight text-neutral-900">{category.name}</h3>
                                    <span className="inline-flex items-center rounded-full bg-sky-50 px-2.5 py-0.5 text-[11px] font-bold text-sky-700 ring-1 ring-sky-200/70">
                                      {category.products.length} producto{category.products.length === 1 ? '' : 's'}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => openProductModal(category.id)}
                                      className="inline-flex items-center gap-1.5 rounded-full bg-neutral-950 px-3.5 py-2 text-[12px] font-bold text-white transition hover:bg-neutral-800 active:scale-[0.97]"
                                    >
                                      <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                                      Agregar producto
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void deleteCategory(category.id, category.name, category.products.length)}
                                      disabled={Boolean(activeActionKey) || category.products.length > 0}
                                      title={category.products.length > 0 ? 'Primero elimina o mueve sus productos.' : `Eliminar categoria ${category.name}`}
                                      className="inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-white px-3.5 py-2 text-[12px] font-semibold text-neutral-700 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:border-black/5 disabled:bg-neutral-100 disabled:text-neutral-400"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                                      {activeActionKey === `category:${category.id}:delete` ? 'Eliminando...' : 'Eliminar'}
                                    </button>
                                  </div>
                                </div>
                                <div className="divide-y divide-black/5">
                                  {category.products.length === 0 ? (
                                    <div className="flex flex-col items-center gap-3 px-4 py-8 text-center sm:flex-row sm:justify-between sm:px-5 sm:text-left">
                                      <div className="min-w-0">
                                        <p className="text-[13px] font-semibold text-neutral-700">
                                          Esta categoria no tiene productos aun.
                                        </p>
                                        <p className="mt-0.5 text-[12px] text-neutral-400">
                                          Agrega el primero para publicarlo en tu menu.
                                        </p>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => openProductModal(category.id)}
                                        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-neutral-950 px-4 py-2 text-[12px] font-bold text-white transition hover:bg-neutral-800 active:scale-[0.97]"
                                      >
                                        <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                                        Agregar producto
                                      </button>
                                    </div>
                                  ) : (
                                    category.products.map((product) => (
                                      <div
                                        key={product.id}
                                        className={`flex flex-col gap-3 px-4 py-3.5 transition hover:bg-sky-50/40 sm:flex-row sm:items-center sm:gap-4 ${selectedProductIds.has(product.id) ? 'bg-sky-50/60' : ''}`}
                                      >
                                        {isSelectionMode ? (
                                          <button
                                            type="button"
                                            onClick={() => toggleProductSelection(product.id)}
                                            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition ${selectedProductIds.has(product.id) ? 'border-sky-500 bg-sky-500 text-white' : 'border-neutral-300 bg-white text-transparent hover:border-sky-300'}`}
                                            aria-label={selectedProductIds.has(product.id) ? `Quitar ${product.name} de la selección` : `Seleccionar ${product.name}`}
                                          >
                                            <Check className="h-4 w-4" strokeWidth={3} />
                                          </button>
                                        ) : null}
                                        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl border border-black/5 bg-neutral-100">
                                          {product.image ? (
                                            <img src={product.image} alt={product.name} className="h-full w-full object-cover" loading="lazy" />
                                          ) : (
                                            <div className="flex h-full w-full items-center justify-center text-lg font-bold text-neutral-300">{product.name.charAt(0).toUpperCase()}</div>
                                          )}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                            <p className="truncate text-[15px] font-bold text-neutral-900">{product.name}</p>
                                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-50 px-2.5 py-0.5 text-[11px] font-bold text-sky-700 ring-1 ring-sky-200/70">
                                              {category.name}
                                            </span>
                                            {product.promoType === 'MULTI_BUY' && product.promoBuyQuantity != null && product.promoPayQuantity != null && product.promoBuyQuantity > 0 && product.promoPayQuantity > 0 ? (
                                              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">
                                                {product.promoBuyQuantity} x {product.promoPayQuantity}
                                              </span>
                                            ) : null}
                                            {!product.isAvailable ? (
                                              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-neutral-500">Agotado</span>
                                            ) : null}
                                          </div>
                                          {product.description ? (
                                            <p className="mt-1 truncate text-[13px] text-neutral-500">{product.description}</p>
                                          ) : null}
                                        </div>
                                        <div className="flex flex-wrap items-center justify-between gap-3 sm:w-auto sm:flex-nowrap sm:justify-start sm:gap-4">
                                          <div className="flex items-center gap-1.5">
                                            <span className="text-[15px] font-bold text-neutral-900">{product.discountPrice ? formatCurrency(product.discountPrice) : formatCurrency(product.price)}</span>
                                          </div>
                                          <button
                                            type="button"
                                            role="switch"
                                            aria-checked={product.isAvailable}
                                            onClick={() => void toggleProductAvailability(product)}
                                            disabled={activeAvailabilityProductId === product.id}
                                            className={`relative inline-flex h-10 w-[68px] items-center rounded-full border px-1 transition ${product.isAvailable ? 'border-emerald-300 bg-emerald-500' : 'border-neutral-300 bg-neutral-300'} disabled:cursor-not-allowed disabled:opacity-60`}
                                          >
                                            <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-700 shadow-sm transition ${product.isAvailable ? 'translate-x-[26px]' : 'translate-x-0'}`}>
                                              {product.isAvailable ? 'On' : 'Off'}
                                            </span>
                                          </button>
                                          <div className="flex items-center gap-1.5">
                                            <button
                                              type="button"
                                              onClick={() => openEditProductModal(product)}
                                              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white text-neutral-800 transition hover:bg-neutral-100"
                                              aria-label={`Editar ${product.name}`}
                                            >
                                              <Pencil className="h-4 w-4" strokeWidth={1.9} />
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => openDuplicateProductModal(product)}
                                              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-sky-100 bg-sky-50 text-sky-600 transition hover:bg-sky-100"
                                              aria-label={`Duplicar ${product.name}`}
                                              title="Duplicar producto"
                                            >
                                              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => openDeleteProductModal(product)}
                                              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-rose-200 bg-rose-50 text-rose-600 transition hover:bg-rose-100"
                                              aria-label={`Eliminar ${product.name}`}
                                            >
                                              <Trash2 className="h-4 w-4" strokeWidth={1.9} />
                                            </button>
                                          </div>
                                        </div>
                                      </div>
                                    ))
                                  )}
                                </div>
                              </section>
                            ))
                          )}
                        </div>
                      )}

                      {isSelectionMode ? (
                        <div className="fixed inset-x-0 bottom-4 z-[70] px-4">
                          <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-center gap-2 rounded-3xl border border-sky-100 bg-white/95 px-4 py-3 shadow-[0_20px_50px_rgba(15,15,15,0.2)] backdrop-blur-xl ring-1 ring-black/5">
                            <span className="mx-1 text-[13px] font-bold text-neutral-900">
                              {selectedProductCount === 0 ? 'Nada seleccionado' : `${selectedProductCount} seleccionado${selectedProductCount === 1 ? '' : 's'}`}
                            </span>
                            <div className="mx-1 h-5 w-px bg-black/10" />
                            <button
                              type="button"
                              onClick={() => void handleBulkAvailability(true)}
                              disabled={bulkActionLoading || selectedProductCount === 0}
                              className="rounded-full bg-emerald-500 px-4 py-2 text-[13px] font-bold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Disponible
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleBulkAvailability(false)}
                              disabled={bulkActionLoading || selectedProductCount === 0}
                              className="rounded-full border border-neutral-300 bg-white px-4 py-2 text-[13px] font-bold text-neutral-600 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Agotado
                            </button>
                            <select
                              value={bulkCategoryTargetId}
                              onChange={(event) => void handleBulkMoveCategory(event.target.value)}
                              disabled={bulkActionLoading || selectedProductCount === 0}
                              className="rounded-full border border-black/10 bg-white px-3.5 py-2 text-[13px] font-semibold text-neutral-700 outline-none transition focus:border-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <option value="">Mover a categoría...</option>
                              {categories.map((category) => (
                                <option key={category.id} value={category.id}>{category.name}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => setIsBulkDeleteModalOpen(true)}
                              disabled={bulkActionLoading || selectedProductCount === 0}
                              className="rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-[13px] font-bold text-rose-600 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Eliminar
                            </button>
                          </div>
                        </div>
                      ) : null}

                      {isBulkDeleteModalOpen ? (
                        <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/55 px-4 py-4 sm:items-center sm:py-5">
                          <div className="w-full max-w-[520px] rounded-[28px] bg-white p-5 shadow-[0_28px_90px_rgba(15,15,15,0.34)] sm:p-6">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-rose-500">Eliminar productos</p>
                              <h3 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-neutral-950">
                                Eliminar {selectedProductCount} producto{selectedProductCount === 1 ? '' : 's'}?
                              </h3>
                              <p className="mt-3 text-sm leading-6 text-neutral-600">
                                Se eliminaran de tu menu publicado y de la tienda del cliente. Esta accion no se puede deshacer.
                              </p>
                            </div>
                            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                              <button
                                type="button"
                                onClick={() => setIsBulkDeleteModalOpen(false)}
                                disabled={bulkActionLoading}
                                className="rounded-full border border-black/10 px-5 py-3 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Cancelar
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleBulkDelete()}
                                disabled={bulkActionLoading}
                                className="rounded-full bg-rose-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {bulkActionLoading ? 'Eliminando...' : 'Eliminar ahora'}
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : null}

                {showMenuPreview ? (() => {
                  // La vista previa refleja EN VIVO el tema y color elegidos en
                  // "Mi tienda", antes incluso de guardar cambios.
                  const previewTheme = getMenuThemeById(storeDraft.menuTheme ?? null);
                  const previewAccent = /^#[0-9a-fA-F]{6}$/.test(storeDraft.accentColor || '')
                    ? (storeDraft.accentColor as string)
                    : '#0ea5e9';
                  return (
                  <div
                    className="fixed inset-0 z-[85] flex items-center justify-center bg-black/60 px-4 py-5 backdrop-blur-sm animate-fade-in"
                    onClick={() => setShowMenuPreview(false)}
                  >
                      <div className="relative flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                        {/* Resplandor ambiental con el color elegido */}
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" aria-hidden="true">
                          <div className="h-[440px] w-[440px] rounded-full opacity-20 blur-3xl" style={{ backgroundColor: previewAccent }} />
                        </div>
                      <button
                        onClick={() => setShowMenuPreview(false)}
                        className="absolute -top-12 right-0 sm:right-auto sm:-top-12 sm:left-1/2 sm:-translate-x-1/2 flex items-center gap-1.5 rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-neutral-700 shadow-lg hover:bg-white hover:text-neutral-900 transition-all z-10"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        Cerrar vista previa
                      </button>
                      <div className="relative w-full max-w-[340px] h-[620px] bg-neutral-900 rounded-[44px] p-3 shadow-2xl ring-1 ring-white/10 overflow-hidden mx-auto">
                        <div className="absolute top-0 inset-x-0 h-6 flex justify-center z-20">
                          <div className="w-32 h-5.5 bg-neutral-900 rounded-b-2xl"></div>
                        </div>
                        <div className="relative w-full h-full rounded-[36px] overflow-hidden flex flex-col" style={{ background: previewTheme?.gradientLight ?? '#ffffff' }}>
                          <div className="flex justify-between items-center px-5 pt-3 pb-0.5 text-[9px] font-bold text-neutral-900">
                            <span>9:41</span>
                            <div className="flex gap-1 items-center">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M15.67 4H14V2h-4v2H8.33C7.6 4 7 4.6 7 5.33v15.33C7 21.4 7.6 22 8.33 22h7.33c.74 0 1.34-.6 1.34-1.33V5.33C17 4.6 16.4 4 15.67 4z"/></svg>
                            </div>
                          </div>
                          <div className="px-3.5 py-1.5 border-b border-black/5" style={{ backgroundColor: previewTheme?.surface ?? '#ffffff' }}>
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
                                   <div className="mb-2 flex items-center gap-1.5">
                                     <span className="h-3 w-[3px] rounded-full" style={{ backgroundColor: previewAccent }} aria-hidden="true" />
                                     <h2 className="text-xs font-bold text-neutral-900">{category.name}</h2>
                                   </div>
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
                                                <div className="rounded-full px-3 py-1 text-[8px] font-bold text-white shadow-sm" style={{ backgroundColor: previewAccent }}>
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
                  );
                  })() : null}

                    </div>

                ) : null}

                {(activeSection === 'settings' || (activeSection === 'store' && !profile && !loading)) ? (
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
                    onEnablePush={() => subscribeToPush(token || '')}
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
                {(() => {
                  const stampKey =
                    selectedOrderForTicket.status === 'CANCELLED' || (selectedOrderForTicket as any).cancelledBy
                      ? 'CANCELLED'
                      : selectedOrderForTicket.status;
                  const stamp = ticketStampConfig[stampKey] || null;
                  if (!stamp) return null;
                  return (
                    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center select-none mix-blend-multiply">
                      <div className={`absolute -rotate-12 translate-x-4 translate-y-3 border-[7px] ${stamp.borderSoft} px-8 py-3 sm:px-16 sm:py-5`}>
                        <div className={`border-2 border-dashed ${stamp.borderSoft} px-3 py-1.5 text-center sm:px-6 sm:py-2.5`}>
                          <span className={`text-3xl font-black uppercase leading-none tracking-[0.18em] ${stamp.textSoft} sm:text-6xl lg:text-7xl`}>
                            {stamp.label}
                          </span>
                        </div>
                      </div>
                      <div className={`absolute -rotate-12 border-[7px] ${stamp.borderStrong} px-8 py-3 sm:px-16 sm:py-5`}>
                        <div className={`border-2 border-dashed ${stamp.borderStrong} px-3 py-1.5 text-center sm:px-6 sm:py-2.5`}>
                          <span className={`text-3xl font-black uppercase leading-none tracking-[0.18em] ${stamp.textStrong} sm:text-6xl lg:text-7xl`}>
                            {stamp.label}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })()}
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
                              {getCustomerFullName(selectedOrderForTicket.customer?.user) || 'Cliente SaDeL'}
                            </span>
                          </div>
                        </div>
                        </div>
                    <div className="flex items-center gap-2 sm:self-start">
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
                              <Mail className="h-4 w-4" />
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
                            {!!profile?.id && selectedOrderForTicket.restaurantId !== profile.id && selectedOrderForTicket.supportRestaurantId
                              ? 'Tu tarifa por la entrega'
                              : 'Ingreso neto del pedido'}
                          </p>
                          <p className="mt-1 text-4xl font-bold tracking-[-0.04em] text-neutral-950">
                            {formatCurrency(getRestaurantCollectionAmount(selectedOrderForTicket, profile))}
                          </p>
                          {!!profile?.id && selectedOrderForTicket.restaurantId !== profile.id && selectedOrderForTicket.supportRestaurantId && (
                            <p className="text-[10px] text-emerald-600 font-medium mt-1">
                              Apoyo a red — te corresponde la tarifa de envío por entregar el pedido de {selectedOrderForTicket.restaurant?.name || 'otro restaurante'}.
                            </p>
                          )}
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
                          <SaDelLoader size="sm" label="Cargando conversación..." />
                        </div>
                      ) : chatMessages.length === 0 ? (
                        <div className="flex flex-col items-center justify-center flex-1 py-12 px-6 text-center space-y-4">
                          <div className="h-16 w-16 bg-neutral-200/40 rounded-full flex items-center justify-center text-neutral-400 border border-neutral-200/30">
                            <MessageCircle className="h-8 w-8 text-neutral-400" />
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

                {/* FOOTER: acciones del pedido (Cancelar se separa del botón de cierre) */}
                <div className="shrink-0 border-t border-neutral-200 bg-white px-5 py-3 sm:px-7 flex items-center justify-between gap-3">
                  <span className="hidden text-[11px] font-medium text-neutral-400 sm:block">
                    {selectedOrderForTicket.orderReference}
                  </span>
                  {['CONFIRMED', 'PREPARING'].includes(selectedOrderForTicket.status) && !(selectedOrderForTicket as any).cancellationRequestedAt && !(selectedOrderForTicket as any).cancelledBy && (
                    <button
                      type="button"
                      onClick={() => {
                        setCancelReason('');
                        setCancelConfirmOrder(selectedOrderForTicket);
                      }}
                      className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50/70 hover:bg-rose-100 active:scale-95 text-rose-700 px-4 py-2.5 text-sm font-bold shadow-sm transition-all"
                    >
                      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <path d="m4.9 4.9 14.2 14.2" />
                      </svg>
                      Cancelar pedido
                    </button>
                  )}
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
                          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
                            <div className="min-w-0">
                              <label className="text-[10px] font-bold uppercase tracking-wider opacity-70">Nueva fecha</label>
                              <input
                                type="date"
                                value={rescheduleDate || (selectedOrderForEtaExtension.estimatedDeliveryTime ? new Date(selectedOrderForEtaExtension.estimatedDeliveryTime).toISOString().split('T')[0] : '')}
                                onChange={(e) => setRescheduleDate(e.target.value)}
                                className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm font-semibold text-neutral-900 outline-none transition focus:border-black/20"
                              />
                            </div>
                            <div className="min-w-0">
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
                  <X className="h-6 w-6" />
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
                    <AlertTriangle className="h-7 w-7" />
                  </div>
                  <h3 className="text-xl font-bold text-neutral-950 tracking-tight">
                    ¿Ya revisaste tu cuenta bancaria?
                  </h3>
                  <p className="mt-3 text-sm text-neutral-600 leading-relaxed">
                    Estás por aceptar el pedido <strong className="text-neutral-950 font-semibold">{transferConfirmationOrder.orderReference}</strong> por un total de <strong className="text-sky-600 font-bold">{formatCurrency(transferConfirmationOrder.collectionAmount)}</strong>.
                  </p>

                  <div className="mt-5 rounded-2xl bg-amber-50/70 p-4 border border-amber-100/60 text-left">
                    <div className="flex gap-2">
                      <Info className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
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
                    <AlertTriangle className="h-7 w-7" />
                  </div>
                  <h3 className="text-xl font-bold text-neutral-950 tracking-tight">
                    ¿Marcar como entregado?
                  </h3>
                  <p className="mt-3 text-sm text-neutral-600 leading-relaxed">
                    Esta acción <strong className="text-rose-600 font-semibold">solo debe realizarse en casos de emergencia</strong> o fuerza mayor.
                  </p>

                  <div className="mt-5 rounded-2xl bg-rose-50/70 p-4 border border-rose-100/60 text-left">
                    <div className="flex gap-2.5">
                      <Info className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
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
                    <AlertTriangle className="h-7 w-7" />
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
                    <AlertTriangle className="h-7 w-7" />
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
                        <span className="text-base font-bold text-rose-700">{formatCurrency(getRestaurantCollectionAmount(transferRefundOrder, profile))}</span>
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
                      <X className="h-5 w-5" strokeWidth={1.8} />
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
                    <X className="h-5 w-5" strokeWidth={1.8} />
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
                                {getCustomerFullName(order.customer?.user) || 'Comensal Anónimo'}
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
                              {order.whatsappFee > 0 && (
                                <p className="flex justify-between gap-3 sm:gap-4 mt-0.5">
                                  <span className="text-[10px] text-sky-600 font-semibold">WhatsApp:</span>
                                  <span className="font-bold tabular-nums">${(order.whatsappFee || 0).toFixed(2)}</span>
                                </p>
                              )}
                              <div className="border-t border-sky-200/50 mt-1 pt-1 flex justify-between gap-3 sm:gap-4 font-black">
                                <span className="text-[10px] text-sky-700">Comisión Total:</span>
                                <span className="tabular-nums">${((order.serviceFee || 0) + (order.platformFee || 0) + (order.whatsappFee || 0)).toFixed(2)}</span>
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
                                {getCustomerFullName(order.customer?.user) || 'Comensal Anónimo'}
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
                              {order.whatsappFee > 0 && (
                                <p className="flex justify-between gap-3 sm:gap-4 mt-0.5">
                                  <span className="text-[10px] text-sky-600 font-semibold">WhatsApp:</span>
                                  <span className="font-bold tabular-nums">${(order.whatsappFee || 0).toFixed(2)}</span>
                                </p>
                              )}
                              <div className="border-t border-sky-200/50 mt-1 pt-1 flex justify-between gap-3 sm:gap-4 font-black">
                                <span className="text-[10px] text-sky-700">Comisión Total:</span>
                                <span className="tabular-nums">${((order.serviceFee || 0) + (order.platformFee || 0) + (order.whatsappFee || 0)).toFixed(2)}</span>
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
                      <Info className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
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
                    El cliente <strong className="text-neutral-900 font-semibold">{getCustomerFullName(cancelRequestModalOrder.customer?.user) || 'Comensal'}</strong> solicita cancelar el pedido <strong className="text-neutral-900 font-semibold">#{cancelRequestModalOrder.orderReference}</strong>.
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
                      <Info className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
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
            <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
              <div className="w-full max-w-[540px] max-h-[92dvh] overflow-y-auto rounded-t-[28px] sm:rounded-[32px] bg-white p-5 sm:p-8 shadow-xl ring-1 ring-black/5 animate-in zoom-in-95 duration-300">
                <div className="flex items-start justify-between gap-3 mb-5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600">
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2Z" /></svg>
                      </div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-sky-600">Liquidación</p>
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
                    <X className="h-5 w-5" />
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
                      <Mail className="h-4 w-4 shrink-0 text-neutral-400" />
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
                  <div className="flex gap-3 rounded-2xl bg-sky-50/60 p-4 border border-sky-100">
                    <div className="shrink-0 pt-0.5">
                      <svg className="h-5 w-5 text-sky-500" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-sky-900">Instrucciones Importantes</p>
                      <p className="mt-1 text-xs text-sky-800/80 leading-relaxed">
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
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        
                        <button
                          type="button"
                          onClick={handleSubmitProof}
                          disabled={uploadingProof}
                          className={`w-full flex items-center justify-center gap-2 rounded-full py-3.5 text-sm font-bold text-white transition-all active:scale-95 ${
                            uploadingProof ? 'bg-sky-400' : 'bg-sky-500 hover:bg-sky-600 hover:shadow-lg hover:shadow-sky-500/20'
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
                              : 'cursor-pointer border-sky-500/30 bg-sky-50/30 hover:border-sky-500 hover:bg-sky-50/80'
                          }`}
                        >
                          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-sm transition-transform group-hover:scale-110 group-active:scale-95">
                            <svg className="h-7 w-7 text-sky-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
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
                    <X className="h-5 w-5" strokeWidth={1.8} />
                  </button>
                </div>

                {/* Subcontainer for Tabs and Content */}
                <div className="flex flex-col md:flex-row flex-1 overflow-hidden min-h-0">
                  
                  {/* Left Navigation Tabs (Desktop) / Horizontal Tabs (Mobile) */}
                  <div className="shrink-0 border-b md:border-b-0 md:border-r border-black/5 bg-[#faf8f5]/80 p-4 md:w-60 overflow-x-auto md:overflow-x-visible md:overflow-y-auto scrollbar-none flex md:flex-col gap-2 flex-row">
                    
                    {/* Tab Button 0: Notificaciones */}
                    <button
                      type="button"
                      onClick={() => setActiveHelpTab('notifications')}
                      className={`flex items-center gap-3 rounded-2xl px-4 py-3.5 text-left text-sm font-semibold transition-all duration-200 shrink-0 whitespace-nowrap ${
                        activeHelpTab === 'notifications'
                          ? 'bg-gradient-to-r from-sky-600 to-blue-600 text-white shadow-md shadow-blue-600/10 ring-1 ring-sky-500/20'
                          : 'text-neutral-600 hover:bg-sky-50/70 hover:text-sky-700'
                      }`}
                    >
                      <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
                      </svg>
                      Notificaciones
                    </button>

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
                    
                    {/* Tab 0: Notifications */}
                    {activeHelpTab === 'notifications' && (
                      <div className="space-y-6 animate-fade-in">
                        {/* Banner principal llamativo */}
                        <div className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-sky-600 via-blue-600 to-indigo-600 p-6 sm:p-8 text-white shadow-[0_16px_40px_-12px_rgba(37,99,235,0.45)]">
                          <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
                          <div className="absolute -bottom-16 -left-8 h-44 w-44 rounded-full bg-white/5" />
                          <div className="relative">
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[10px] font-bold uppercase tracking-widest backdrop-blur">
                              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                              </svg>
                              No te pierdas ningún pedido
                            </span>
                            <h3 className="mt-3 text-xl sm:text-2xl font-bold leading-tight">
                              Las alertas de nuevos pedidos llegan aunque cierres la app
                            </h3>
                            <p className="mt-2 max-w-xl text-sm sm:text-base text-sky-100 leading-relaxed">
                              Configura tu teléfono <strong className="text-white">una sola vez</strong> y recibe cada
                              pedido con sonido de alarma, sin importar la plataforma.
                            </p>
                          </div>
                        </div>

                        {/* Tarjetas por plataforma */}
                        <div className="grid gap-5 sm:grid-cols-2">
                          {/* Android */}
                          <div className="rounded-[28px] border border-emerald-100 bg-white p-5 sm:p-6 flex flex-col shadow-[0_8px_24px_-12px_rgba(16,185,129,0.15)]">
                            <div className="flex items-center gap-3">
                              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M16.5 8.963V5.25m.75 14.634a48.465 48.465 0 01-6 0m6 0c-.706.214-1.44.348-2.25.435m6 0a24.24 24.24 0 003.75-.435M9.75 21a1.5 1.5 0 003 0V9.75a1.5 1.5 0 00-3 0V21z" />
                                </svg>
                              </div>
                              <div>
                                <h4 className="text-base font-bold text-neutral-950">Android</h4>
                                <span className="text-xs font-semibold text-emerald-600">Samsung, Xiaomi, Motorola, etc.</span>
                              </div>
                            </div>

                            <ol className="mt-5 space-y-3 text-sm">
                              <li className="flex items-start gap-3">
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[11px] font-bold text-emerald-700">1</span>
                                <span className="leading-relaxed text-neutral-700">
                                  <strong className="text-neutral-900">Instala la app</strong> tocando el botón "Instalar" que aparece en la parte inferior (o menú ⋮ → "Agregar a pantalla de inicio").
                                </span>
                              </li>
                              <li className="flex items-start gap-3">
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[11px] font-bold text-emerald-700">2</span>
                                <span className="leading-relaxed text-neutral-700">
                                  <strong className="text-neutral-900">Activa las notificaciones</strong> en el perfil del portal (pestaña "Notificaciones Push").
                                </span>
                              </li>
                              <li className="flex items-start gap-3">
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[11px] font-bold text-emerald-700">3</span>
                                <span className="leading-relaxed text-neutral-700">
                                  <strong className="text-neutral-900">Excluye SaDeL del ahorro de batería:</strong> Ajustes del teléfono → Batería → Optimización de batería → busca SaDeL → "Sin restricciones". <em className="text-emerald-700 font-medium">Esto evita que el teléfono "mate" la app y retrase los pedidos.</em>
                                </span>
                              </li>
                              <li className="flex items-start gap-3">
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[11px] font-bold text-emerald-700">4</span>
                                <span className="leading-relaxed text-neutral-700">
                                  <strong className="text-neutral-900">Ponle sonido de alarma:</strong> Ajustes → Notificaciones → SaDeL → Sonido → elige un tono fuerte (ej. "Alarma"). Así el "Nuevo pedido" se escucha aunque estés lejos del teléfono.
                                </span>
                              </li>
                            </ol>
                          </div>

                          {/* iPhone / iOS */}
                          <div className="rounded-[28px] border border-neutral-200/80 bg-white p-5 sm:p-6 flex flex-col shadow-[0_8px_24px_-12px_rgba(0,0,0,0.12)]">
                            <div className="flex items-center gap-3">
                              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-neutral-900 text-white">
                                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                                  <rect x="7" y="2.75" width="10" height="18.5" rx="2.75" />
                                  <path strokeLinecap="round" d="M10.5 18.5h3" />
                                </svg>
                              </div>
                              <div>
                                <h4 className="text-base font-bold text-neutral-950">iPhone (iOS)</h4>
                                <span className="text-xs font-semibold text-neutral-500">Requiere iOS 16.4 o superior</span>
                              </div>
                            </div>

                            <ol className="mt-5 space-y-3 text-sm">
                              <li className="flex items-start gap-3">
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[11px] font-bold text-neutral-700">1</span>
                                <span className="leading-relaxed text-neutral-700">
                                  <strong className="text-neutral-900">Instala a pantalla de inicio</strong> (obligatorio para recibir pedidos): botón Compartir → "Añadir a pantalla de inicio". Desde Safari normal <em className="font-medium text-neutral-500">no</em> llegan notificaciones.
                                </span>
                              </li>
                              <li className="flex items-start gap-3">
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[11px] font-bold text-neutral-700">2</span>
                                <span className="leading-relaxed text-neutral-700">
                                  <strong className="text-neutral-900">Activa las notificaciones</strong> en el perfil del portal.
                                </span>
                              </li>
                              <li className="flex items-start gap-3">
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[11px] font-bold text-neutral-700">3</span>
                                <span className="leading-relaxed text-neutral-700">
                                  <strong className="text-neutral-900">Revisa los ajustes del iPhone:</strong> Ajustes → Notificaciones → SaDeL → permitir notificaciones y sonido.
                                </span>
                              </li>
                              <li className="flex items-start gap-3">
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-[11px] font-bold text-neutral-700">4</span>
                                <span className="leading-relaxed text-neutral-700">
                                  <strong className="text-neutral-900">Evita "No molestar" o un "Foco" activo</strong> durante horario de servicio, o el iPhone retendrá las alertas.
                                </span>
                              </li>
                            </ol>
                          </div>
                        </div>

                        {/* Nota de cierre */}
                        <div className="rounded-[24px] border border-sky-100 bg-sky-50/70 p-5 text-sm leading-relaxed text-sky-900">
                          <p className="font-semibold">💡 ¿Quieres probar si tu teléfono está bien configurado?</p>
                          <p className="mt-1 text-sky-800/90">
                            Abre la pestaña <strong>Simulador de Pedidos</strong> y activa un pedido de prueba: si suena la
                            alerta con la app cerrada, todo está listo. Si no llega, revisa los pasos de tu plataforma arriba.
                          </p>
                        </div>
                      </div>
                    )}

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
                                <ChevronUp className="h-4.5 w-4.5 text-neutral-400" />
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
                                <ChevronUp className="h-4.5 w-4.5 text-neutral-400" />
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
                                <ChevronUp className="h-4.5 w-4.5 text-neutral-400" />
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
                          <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
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
              <X className="w-4 h-4" strokeWidth={2.5} />
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
  inputRef,
  onKeyDown,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
  inputRef?: React.Ref<HTMLInputElement>;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === 'password';

  return (
    <label className="group grid min-w-0 gap-2 text-sm text-neutral-600">
      <span className="text-[12px] font-bold uppercase tracking-[0.1em] text-neutral-600 transition-colors group-focus-within:text-sky-500">{label}</span>
      <div className="relative">
        <input
          ref={inputRef}
          type={isPassword && showPassword ? 'text' : type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className={`block w-full min-w-0 rounded-[18px] border border-black/5 bg-neutral-100/50 py-3.5 text-base font-medium text-neutral-950 shadow-inner outline-none transition-all duration-300 placeholder:text-neutral-400 hover:bg-neutral-100/80 focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-400/20 focus:shadow-md sm:text-[15px] ${isPassword ? 'px-5 pr-14' : 'px-5'}`}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword((current) => !current)}
            aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            tabIndex={-1}
            className="absolute right-2 inset-y-0 my-auto flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 transition-colors duration-200 hover:bg-sky-500/10 hover:text-sky-600 active:scale-95 focus-visible:text-sky-600"
          >
            {showPassword ? <EyeSlashIcon /> : <EyeIcon />}
          </button>
        )}
      </div>
    </label>
  );
}

function EyeIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function EyeSlashIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"
      />
    </svg>
  );
}

function EditableNumberInput({
  value,
  onCommit,
  min,
  integer = false,
  step,
  placeholder,
  className,
}: {
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  integer?: boolean;
  step?: string;
  placeholder?: string;
  className?: string;
}) {
  const [text, setText] = useState<string>(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  function commit() {
    const parsed = integer ? parseInt(text, 10) : parseFloat(text);
    let next = Number.isFinite(parsed) ? parsed : 0;
    if (min !== undefined && next < min) next = min;
    setText(String(next));
    onCommit(next);
  }

  return (
    <input
      type="number"
      min={min}
      step={step}
      inputMode="numeric"
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      placeholder={placeholder}
      className={className}
    />
  );
}

const BUSINESS_TYPE_LABELS: Record<string, string> = {
  RESTAURANT: 'Restaurante',
  STORE: 'Tienda',
};

function businessTypeLabel(type?: string | null): string {
  return (type && BUSINESS_TYPE_LABELS[type]) || 'Restaurante';
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

const ticketStampConfig: Record<string, { label: string; borderSoft: string; borderStrong: string; textSoft: string; textStrong: string }> = {
  CANCELLED: {
    label: 'CANCELADO',
    borderSoft: 'border-rose-600/15',
    borderStrong: 'border-rose-600/55',
    textSoft: 'text-rose-600/15',
    textStrong: 'text-rose-600/60',
  },
  DELIVERED: {
    label: 'ENTREGADO',
    borderSoft: 'border-emerald-600/15',
    borderStrong: 'border-emerald-600/55',
    textSoft: 'text-emerald-600/15',
    textStrong: 'text-emerald-600/60',
  },
  COMPLETED: {
    label: 'RECOGIDO',
    borderSoft: 'border-emerald-600/15',
    borderStrong: 'border-emerald-600/55',
    textSoft: 'text-emerald-600/15',
    textStrong: 'text-emerald-600/60',
  },
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

  if (eventName === 'order:driver-auto-unassigned') {
    const driverName = (payload as any).driverName || 'El repartidor';
    return `${driverName} no aceptó ${orderLabel} a tiempo; se le desvinculó y quedó disponible para reasignar.`;
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

  if (eventName === 'order:support-accepted') {
    const supportName = (payload as any).supportRestaurantName || 'Un restaurante aliado';
    return `¡${supportName} aceptó entregar ${orderLabel}!`;
  }

  if (eventName === 'order:support-picked-up') {
    const supportName = (payload as any).supportRestaurantName || 'Tu aliado';
    return `${supportName} recogió ${orderLabel} y va en camino.`;
  }

  if (eventName === 'order:support-rejected-all') {
    return `Nadie aceptó la solicitud de apoyo de ${orderLabel}.`;
  }

  if (eventName === 'order:support-exhausted') {
    return `Agotaste los 2 intentos de apoyo para ${orderLabel}; entrega tú mismo.`;
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

  if (eventName === 'order:schedule-accepted') {
    return `📅 El cliente aceptó la fecha programada de ${orderLabel}.`;
  }

  if (eventName === 'order:schedule-rejected') {
    return `❌ El cliente no aceptó la fecha programada de ${orderLabel}; el pedido fue cancelado.`;
  }

  return `${orderLabel} quedó entregado.`;
}


function getRestaurantActions(
  order: OrderItem,
  hasOwnDelivery: boolean,
  driverArrived?: boolean,
): Array<keyof typeof restaurantActionMap> {
  const status = order.status;
  if (status === 'PENDING') {
    return ['accept', 'reject'];
  }

  if (status === 'CONFIRMED' || status === 'PREPARING') {
    return ['ready'];
  }

  if (status === 'READY') {
    // El handover ("Confirmar entrega") solo se habilita cuando el repartidor
    // YA llegó al restaurante: es el momento en que entrega el PIN de
    // recolección. Sin llegada (solo "asignado") no debe ofrecerse.
    if (!hasOwnDelivery && order.driver && (driverArrived || order.driverArrivedAt)) {
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

type CustomerUser = {
  name?: string;
  lastName?: string;
};

function getCustomerFullName(user?: CustomerUser | null): string {
  const name = user?.name?.trim();
  if (!name) return '';
  const surname = user?.lastName?.trim().split(/\s+/)[0];
  return surname ? `${name} ${surname}` : name;
}

function getCustomerInitials(user?: CustomerUser | null): string {
  const fullName = getCustomerFullName(user);
  if (!fullName) return 'CL';
  const parts = fullName.split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() || '').join('') || 'CL';
}

function formatPhoneDigits(phone?: string | null): string {
  const digits = (phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 12 && digits.startsWith('52')) {
    return digits.slice(2);
  }
  if (digits.length === 13 && digits.startsWith('52')) {
    return digits.slice(2);
  }
  if (digits.length > 10) {
    return digits.slice(-10);
  }
  return digits;
}

function formatWeight(grams: number): string {
  if (!Number.isFinite(grams) || grams <= 0) return '';
  const kg = grams / 1000;
  return kg >= 1 || Number.isInteger(kg)
    ? `${new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 }).format(kg)} kg`
    : `${grams} g`;
}

function weightToUnit(grams: string | number, unit: 'kg' | 'g'): string {
  const num = typeof grams === 'number' ? grams : Number(grams);
  if (!Number.isFinite(num)) return '';
  if (unit === 'kg') {
    const kg = num / 1000;
    return String(Number(kg.toFixed(3)));
  }
  return String(Math.round(num));
}

function unitToGrams(value: string, unit: 'kg' | 'g'): number | null {
  const cleaned = value.trim().replace(',', '.').replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num <= 0) return null;
  return unit === 'kg' ? Math.round(num * 1000) : Math.round(num);
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

type ScheduleDayOption = {
  value: string;
  label: string;
  isToday: boolean;
};

function buildScheduleDayOptions(): ScheduleDayOption[] {
  const options: ScheduleDayOption[] = [];
  const today = new Date();

  for (let i = 0; i < 7; i++) {
    const day = new Date(today);
    day.setDate(today.getDate() + i);
    const value = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;

    if (i === 0) {
      options.push({ value, label: 'Hoy', isToday: true });
    } else if (i === 1) {
      options.push({ value, label: 'Mañana', isToday: false });
    } else {
      options.push({ value, label: formatWeekday(day), isToday: false });
    }
  }

  return options;
}

function formatScheduleTimeMask(prevValue: string, rawValue: string): string {
  const isBackspace = rawValue.length < prevValue.length;
  const prevDigits = prevValue.replace(/\D/g, '');
  const nextDigits = rawValue.replace(/\D/g, '');
  const digits = isBackspace ? prevDigits.slice(0, -1) : nextDigits.slice(0, 4);
  if (!digits) return '';

  const hour = digits.slice(0, 2).padStart(2, '0');
  const minute = digits.slice(2);
  return minute ? `${hour}:${minute}` : `${hour}:`;
}

function parseScheduleTime12h(time: string, meridiem: 'AM' | 'PM'): string | null {
  const match = time.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;

  let hour24 = hour;
  if (meridiem === 'PM' && hour !== 12) hour24 = hour + 12;
  if (meridiem === 'AM' && hour === 12) hour24 = 0;

  return `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function buildScheduledDeliveryDate(date: string, time: string, meridiem: 'AM' | 'PM'): Date | null {
  const time24 = parseScheduleTime12h(time, meridiem);
  if (!time24) return null;
  const scheduled = new Date(`${date}T${time24}`);
  return Number.isNaN(scheduled.getTime()) ? null : scheduled;
}

function formatCountdown(remainingMs: number) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// Countdown aislado del countdown del modal: mantiene su propio timer para que
// re-renderizar cada segundo no redibuje toda la página del panel.
function IncomingOrderCountdown({ windowMs }: { windowMs: number }) {
  const [remainingMs, setRemainingMs] = useState(windowMs);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRemainingMs((prev) => Math.max(0, prev - 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const urgent = remainingMs <= 30000 && remainingMs > 0;
  const expired = remainingMs <= 0;

  return (
    <div
      className={`flex items-center gap-3 self-start rounded-full border px-4 py-2.5 sm:self-center ${
        expired
          ? 'border-neutral-200 bg-neutral-100'
          : urgent
            ? 'border-red-200 bg-red-50 animate-pulse'
            : 'border-rose-100 bg-rose-50'
      }`}
    >
      <svg className={`h-5 w-5 ${expired ? 'text-neutral-400' : urgent ? 'text-red-600' : 'text-rose-600'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <circle cx="12" cy="12" r="8" strokeWidth={1.7} />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 7v5l3 2" />
      </svg>
      <div>
        <p className={`text-xs font-medium uppercase tracking-[0.1em] ${expired ? 'text-neutral-400' : urgent ? 'text-red-600' : 'text-rose-600'}`}>
          {expired ? 'Vencido' : 'Expira en'}
        </p>
        <p className={`font-bold tabular-nums ${expired ? 'text-neutral-500' : urgent ? 'text-red-700' : 'text-rose-700'}`}>
          {formatCountdown(remainingMs)}
        </p>
      </div>
    </div>
  );
}

function getPreparationRemainingMs(order: OrderItem, nowMs: number) {
  if (!order.preparationDeadlineAt) {
    return null;
  }

  return new Date(order.preparationDeadlineAt).getTime() - nowMs;
}

function isPreparationTimeUrgent(order: OrderItem, nowMs: number) {
  const remainingMs = getPreparationRemainingMs(order, nowMs);
  return typeof remainingMs === 'number' && remainingMs <= 2 * 60 * 1000;
}

// En pedidos programados la cuenta regresiva de preparación no debe mostrarse
// hasta que falte (aprox.) el tiempo de preparación para la entrega; antes de
// eso solo es ruido visual (chips gigantes tipo "1539:34 restantes").
function isPrepCountdownRelevant(order: OrderItem, nowMs: number) {
  if (!order.scheduledDeliveryAt) return true;
  const prepMs = (order.preparationTimeMinutes || 0) * 60 * 1000;
  // Colchón de 30 min para anticipar la preparación antes de la ventana.
  return new Date(order.scheduledDeliveryAt).getTime() - nowMs <= prepMs + 30 * 60 * 1000;
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
  if (!operatingHours || operatingHours.length === 0) {
    return true;
  }

  const now = new Date();
  const dayOfWeek = now.getDay();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const toMinutes = (time?: string) => {
    if (!time) return NaN;
    const [h, m] = String(time).split(':').map(Number);
    return h * 60 + m;
  };

  const isWithinRange = (schedule: any) => {
    const openMinutes = toMinutes(schedule.openTime);
    const closeMinutes = toMinutes(schedule.closeTime);
    if (openMinutes === closeMinutes) {
      return false;
    }
    if (closeMinutes < openMinutes) {
      return currentMinutes >= openMinutes || currentMinutes < closeMinutes;
    }
    return currentMinutes >= openMinutes && currentMinutes < closeMinutes;
  };

  for (const block of operatingHours) {
    if (block.dayOfWeek !== dayOfWeek || block.isClosed) continue;
    if (isWithinRange(block)) {
      return true;
    }
  }

  const yesterdayDay = (dayOfWeek + 6) % 7;
  for (const block of operatingHours) {
    if (block.dayOfWeek !== yesterdayDay || block.isClosed) continue;
    if (
      toMinutes(block.closeTime) < toMinutes(block.openTime) &&
      currentMinutes < toMinutes(block.closeTime)
    ) {
      return true;
    }
  }

  return false;
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
