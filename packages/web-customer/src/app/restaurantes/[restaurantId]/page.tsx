'use client';
import { AlertTriangle, ArrowLeft, Banknote, Bell, BellOff, Bike, Check, ChevronLeft, ChevronRight, ChevronUp, CircleCheck, CirclePlus, ClipboardCheck, Clock, Copy, DollarSign, Home, Landmark, Loader2, Mail, Map, MapPin, MessageCircle, Minus, Plus, RefreshCw, Search, ShoppingBag, Store, Tag, Ticket, Trash2, Upload, User, X } from 'lucide-react';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthUser, clearStoredSession, readStoredSession, requestJson, submitReview, uploadMediaAsset, convertImageFileToDataUrl, getOrderStatusLabel, isRestaurant, ApiRequestError, isAuthRequestError, setGlobalSessionExpiredHandler, forceSessionExpired } from '@sadel/shared';
import { io } from 'socket.io-client';
import { AuthModal } from '../../../components/AuthModal';
import { CompactActiveOrderBanner, computeDelayState, formatEstimatedArrivalMinutes, formatOverdueMinutes } from '../../../components/CompactActiveOrderBanner';
import { ensureGoogleMapsScript, getGoogleMaps } from '../../../lib/googleMaps';
import RatingModal from '../../../components/RatingModal';
import { useForegroundPolling } from '../../../hooks/useForegroundPolling';
import { SaDelLoader } from '../../../components/SaDelLoader';
import { SaDelLogo } from '../../../components/SaDelLogo';
import CartDrawer from '../../../components/CartDrawer';
import { createPlacesSource } from '../../../lib/places';
type PaymentMethod = 'CASH' | 'TRANSFER';
type OrderStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'PREPARING'
  | 'READY'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'REJECTED';

type ProductOption = {
  id: string;
  groupId: string;
  name: string;
  price: number;
  isAvailable: boolean;
};

type ProductOptionGroup = {
  id: string;
  productId: string;
  name: string;
  minSelection: number;
  maxSelection: number;
  options: ProductOption[];
};

type PublicRestaurantDetail = {
  id: string;
  name: string;
  description: string;
  address: string;
  region: string;
  logo?: string | null;
  coverImage?: string | null;
  status: string;
  isOpen: boolean;
  hasOwnDelivery: boolean;
  pickupOnly?: boolean;
  serviceFee?: number | null;
  deliveryFee?: number | null;
  effectiveDeliveryFee?: number | null;
  maxCashOrder?: number | null;
  pricingModel?: string | null;
  baseRate?: number | null;
  perKmRate?: number | null;
  minDeliveryFee?: number | null;
  maxDeliveryFee?: number | null;
  deliveryRadius?: number | null;
  businessType?: string;
  minDeliveryTime: number;
  maxDeliveryTime: number;
  latitude?: number;
  longitude?: number;
  transferBankName?: string | null;
  transferAccountNumber?: string | null;
  transferBeneficiaryName?: string | null;
  acceptsCash?: boolean | null;
  acceptedPaymentMethods?: string[];
  rating?: number;
  reviewCount?: number;
  accentColor?: string | null;
  instagram?: string | null;
  facebook?: string | null;
  tiktok?: string | null;
  promoFreeDeliveryThreshold?: number | null;
  promoMinOrderAmount?: number | null;
  promoMinOrderPercent?: number | null;
  categories: Array<{
    id: string;
    name: string;
      products: Array<{
        id: string;
        name: string;
        description: string;
        price: number;
        sellBy?: string;
        unitPrice?: number | null;
        minWeightG?: number | null;
        maxWeightG?: number | null;
        stepWeightG?: number | null;
        weightPresets?: string | number[] | null;
        image?: string | null;
        images?: string[];
        imagePosition?: string | null;
        imageZoom?: number | null;
        discountPrice?: number | null;
        promoType?: 'MULTI_BUY' | null;
        promoBuyQuantity?: number | null;
        promoPayQuantity?: number | null;
        isAdultOnly?: boolean;
        trackStock?: boolean;
        stock?: number;
        lowStockThreshold?: number;
        optionGroups?: ProductOptionGroup[];
      }>;
  }>;
};

import { usePushNotifications } from '../../../hooks/usePushNotifications';
import { useCustomerSounds } from '../../../hooks/useCustomerSounds';
import { ScheduleProposalModal } from '../../../components/ScheduleProposalModal';
import { useCartStore, type CartItem } from '../../../store/cartStore';

type CheckoutForm = {
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  reference: string;
  latitude: string;
  longitude: string;
  paymentMethod: PaymentMethod;
  notes: string;
  storeNotes: string;
  promoCode: string;
};

type DeliveryPreset = {
  city: string;
  state: string;
  zipCode: string;
  country: string;
  latitude: string;
  longitude: string;
  label: string;
};

type CustomerOrderListItem = {
  id: string;
  orderReference: string;
  dailyCounter: number;
  status: OrderStatus;
  totalAmount: number;
  paymentMethod: string;
  createdAt: string;
  estimatedDeliveryTime: string;
  review?: { id: string } | null;
  restaurant: {
    id: string;
    name: string;
    businessType?: string;
    logo?: string | null;
    address?: string;
    latitude?: number;
    longitude?: number;
  };
  fulfillmentType?: 'DELIVERY' | 'PICKUP';
  noDriversAvailable?: boolean;
  address: {
    street: string;
    number: string;
    neighborhood: string;
    reference?: string | null;
  } | null;
  cancellationRequestedAt?: string | null;
  cancelledBy?: string | null;
};

type CustomerOrderDetail = {
  id: string;
  orderReference: string;
  dailyCounter: number;
  status: OrderStatus;
  totalAmount: number;
  subtotal: number;
  taxAmount: number;
  serviceFee: number;
  deliveryFee: number;
  promoCode?: string | null;
  promoDiscountAmount?: number | null;
  paymentMethod: PaymentMethod;
  paymentStatus: string;
  estimatedDeliveryTime: string;
  etaExtendedMinutes?: number;
  lastDriverLatitude?: number | null;
  lastDriverLongitude?: number | null;
  lastDriverLocationAt?: string | null;
  preparationDeadlineAt?: string | null;
  notes?: string | null;
  handoverPin?: string | null;
  deliveryPin?: string | null;
  pickupPin?: string | null;
  createdAt: string;
  review?: { id: string } | null;
  restaurant: {
    id: string;
    name: string;
    businessType?: string;
    logo?: string | null;
    contactPhone: string;
    address?: string;
    latitude?: number;
    longitude?: number;
  };
  driver?: {
    id: string;
    user: {
      name: string;
      phone: string;
    };
  } | null;
  address: {
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
  items: Array<{
    id: string;
    quantity: number;
    price: number;
    sellBy?: string;
    weightG?: number | null;
    unitPrice?: number | null;
    specialInstructions?: string | null;
    product: {
      id: string;
      name: string;
      image?: string | null;
    };
  }>;
  tracking: Array<{
    id: string;
    status: OrderStatus;
    notes?: string | null;
    createdAt: string;
  }>;
  cancellationRequestedAt?: string | null;
  cancellationReason?: string | null;
  cancelledBy?: string | null;
  noDriversAvailable?: boolean;
  fulfillmentType?: 'DELIVERY' | 'PICKUP';
  scheduledDeliveryAt?: string | null;
  scheduledDeliveryCustomerAcceptedAt?: string | null;
};

type PaginatedOrdersResponse = {
  success: true;
  data: {
    items: CustomerOrderListItem[];
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
  };
};

type TransientNotice = {
  id: string;
  title: string;
  description: string;
  tone: 'success' | 'danger' | 'info';
  requiresAcknowledgement?: boolean;
  dismissible?: boolean;
  orderId?: string;
  paymentMethod?: string;
  orderReference?: string;
};

const defaultApiBase = '/api';
const storageKey = 'sadel.customer';
const profileAddressStorageKey = `${storageKey}.profile-address`;
const persistentNoticeStorageKey = `${storageKey}.persistent-notice`;

const defaultCheckoutForm: CheckoutForm = {
  street: '',
  number: '',
  neighborhood: '',
  city: '',
  state: '',
  zipCode: '',
  country: 'MX',
  reference: '',
  latitude: '19.4326',
  longitude: '-99.1332',
  paymentMethod: 'CASH',
  notes: '',
  storeNotes: '',
  promoCode: '',
};

function getUserLocationQuery(): string {
  if (typeof window === 'undefined') return '';
  try {
    const locStr = window.localStorage.getItem('userLocation');
    if (locStr) {
      const loc = JSON.parse(locStr);
      if (loc && typeof loc.latitude === 'number' && typeof loc.longitude === 'number' && isFinite(loc.latitude) && isFinite(loc.longitude)) {
        return `?latitude=${encodeURIComponent(loc.latitude)}&longitude=${encodeURIComponent(loc.longitude)}`;
      }
    }
  } catch (e) {}
  return '';
}

function CarouselOrGrid({
  isCarousel,
  children,
  gridClassName = 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3',
}: {
  isCarousel: boolean;
  children: React.ReactNode;
  gridClassName?: string;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateArrows = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const tolerance = 4;
    setCanLeft(el.scrollLeft > tolerance);
    setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - tolerance);
  }, []);

  useEffect(() => {
    if (!isCarousel) return;
    const el = scrollRef.current;
    if (!el) return;
    updateArrows();
    el.addEventListener('scroll', updateArrows, { passive: true });
    window.addEventListener('resize', updateArrows);
    return () => {
      el.removeEventListener('scroll', updateArrows);
      window.removeEventListener('resize', updateArrows);
    };
  }, [isCarousel, updateArrows]);

  if (!isCarousel) {
    return <div className={gridClassName}>{children}</div>;
  }

  const scrollByAmount = (dir: number) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * 260, behavior: 'smooth' });
  };

  return (
    <div className="relative">
      <div
        ref={scrollRef}
        className="flex gap-3 overflow-x-auto pb-2 scroll-smooth snap-x snap-mandatory [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
        <div className="w-4 shrink-0 sm:w-8" />
      </div>
      <button
        type="button"
        aria-label="Ver más productos"
        onClick={() => scrollByAmount(1)}
        className={`absolute right-3 top-1/2 z-20 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-neutral-600 shadow-lg shadow-black/10 ring-1 ring-black/5 backdrop-blur transition-all duration-200 hover:bg-white hover:text-neutral-900 active:scale-90 sm:flex ${canRight ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      >
        <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
      </button>
      <button
        type="button"
        aria-label="Ver productos anteriores"
        onClick={() => scrollByAmount(-1)}
        className={`absolute left-3 top-1/2 z-20 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-neutral-600 shadow-lg shadow-black/10 ring-1 ring-black/5 backdrop-blur transition-all duration-200 hover:bg-white hover:text-neutral-900 active:scale-90 sm:flex ${canLeft ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      >
        <ChevronLeft className="h-4 w-4" strokeWidth={2.5} />
      </button>
    </div>
  );
}

export default function RestaurantPage({
  params,
  searchParams,
}: {
  params: { restaurantId: string };
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  const router = useRouter();
  const [apiBase, setApiBase] = useState(defaultApiBase);
  const [token, setToken] = useState('');
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [sessionUser, setSessionUser] = useState<AuthUser | null>(null);
  const { permission: pushPermission, subscribe: subscribePush } = usePushNotifications();
  const [isPushReminderModalOpen, setIsPushReminderModalOpen] = useState(false);
  const [showMaxCashModal, setShowMaxCashModal] = useState(false);
  const [showGpsCashModal, setShowGpsCashModal] = useState(false);
  const [rawRestaurant, setRawRestaurant] = useState<PublicRestaurantDetail | null>(null);

  const restaurant = useMemo(() => {
    if (!rawRestaurant) return null;

    let isAdult = true;
    if (sessionUser?.dateOfBirth) {
      const today = new Date();
      const birthDate = new Date(sessionUser.dateOfBirth);
      let age = today.getFullYear() - birthDate.getFullYear();
      const m = today.getMonth() - birthDate.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      isAdult = age >= 18;
    }

    const processedCategories = rawRestaurant.categories
      .map((category) => ({
        ...category,
        products: category.products.filter((p) => !p.isAdultOnly || isAdult),
      }))
      .filter((category) => category.products.length > 0);

    const promotedProducts = processedCategories.flatMap((c) =>
      c.products.filter((p) => p.discountPrice != null || getMultiBuyInfo(p).isMultiBuy)
    );

    const categories = promotedProducts.length > 0
      ? [
          { id: '__promotions__', name: 'Promociones', products: promotedProducts },
          ...processedCategories,
        ]
      : processedCategories;

    return { ...rawRestaurant, categories };
  }, [rawRestaurant, sessionUser?.dateOfBirth]);

  const [productSearchQuery, setProductSearchQuery] = useState('');

  const filteredRestaurant = useMemo(() => {
    if (!productSearchQuery.trim() || !restaurant) return restaurant;
    const q = productSearchQuery.trim().toLowerCase();
    const filteredCategories = restaurant.categories
      .map((cat) => ({
        ...cat,
        products: cat.products.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.description.toLowerCase().includes(q)
        ),
      }))
      .filter((cat) => cat.products.length > 0);
    return filteredCategories.length > 0
      ? { ...restaurant, categories: filteredCategories }
      : null;
  }, [restaurant, productSearchQuery]);

  const searchResults = useMemo(() => {
    if (!productSearchQuery.trim() || !filteredRestaurant) return [];
    const seen = new Set<string>();
    return filteredRestaurant.categories.flatMap((cat) =>
      cat.products
        .filter((p) => {
          if (seen.has(p.id)) return false;
          seen.add(p.id);
          return true;
        })
        .map((p) => ({ ...p, categoryName: cat.name, categoryId: cat.id }))
    );
  }, [filteredRestaurant, productSearchQuery]);

  const [activeOrderListItems, setActiveOrderListItems] = useState<CustomerOrderListItem[]>([]);
  const [activeOrderDetailsMap, setActiveOrderDetailsMap] = useState<Record<string, CustomerOrderDetail>>({});
  const [cancelledOrderNotice, setCancelledOrderNotice] = useState<CustomerOrderDetail | null>(null);
  const activeOrderDetailsMapRef = useRef(activeOrderDetailsMap);
  activeOrderDetailsMapRef.current = activeOrderDetailsMap;
  const [unreadMessagesMap, setUnreadMessagesMap] = useState<Record<string, number>>({});
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [isScrolledPastHeader, setIsScrolledPastHeader] = useState(false);

  // Chat State
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [loadingChat, setLoadingChat] = useState(false);
  const [sendingChatMessage, setSendingChatMessage] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error'>('success');
  const [isTrackingEnabled, setIsTrackingEnabled] = useState(false);
  const [driverLocation, setDriverLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const handleLoginSuccess = useCallback((newToken: string, newUser: AuthUser) => {
    setToken(newToken);
    setSessionUser(newUser);
    setShowAuthModal(false);

    if (newUser.status && newUser.status !== 'ACTIVE') {
      showTransientNotice({
        key: 'account-suspended-v2',
        title: 'Cuenta suspendida',
        description: 'Tu cuenta ha sido suspendida por incumplimiento de términos y condiciones.',
        tone: 'danger',
        requiresAcknowledgement: true,
        dismissible: false,
      });
    }
  }, []);

  const { playAlert, playLlegue, playChat } = useCustomerSounds();

  const isChatOpenRef = useRef(isChatOpen);
  const selectedOrderIdRef = useRef(selectedOrderId);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    isChatOpenRef.current = isChatOpen;
  }, [isChatOpen]);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolledPastHeader(window.scrollY > 280);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    // Check initial position
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    selectedOrderIdRef.current = selectedOrderId;
  }, [selectedOrderId]);

  useEffect(() => {
    if (isChatOpen) {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, isChatOpen]);

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
        setUnreadMessagesMap((prev) => {
          if (!prev[orderId]) return prev;
          const copy = { ...prev };
          delete copy[orderId];
          return copy;
        });
      }
    } catch (err) {
      console.error('Error loading chat messages:', err);
    } finally {
      setLoadingChat(false);
    }
  }, [apiBase, token]);

  const sendChatMessage = async () => {
    if (!token || !selectedOrderId || !chatInput.trim() || sendingChatMessage) return;
    const currentInput = chatInput;
    setChatInput('');
    setSendingChatMessage(true);

    try {
      const response = await fetch(`${apiBase}/orders/${selectedOrderId}/messages`, {
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
      } else {
        setChatInput(currentInput);
      }
    } catch (err) {
      console.error('Error sending message:', err);
      setChatInput(currentInput);
    } finally {
      setSendingChatMessage(false);
    }
  };

  const activeOrder = useMemo(() => {
    const item = activeOrderListItems[carouselIndex];
    if (!item) return null;
    return activeOrderDetailsMap[item.id] || null;
  }, [activeOrderListItems, activeOrderDetailsMap, carouselIndex]);

  useEffect(() => {
    if (carouselIndex >= activeOrderListItems.length && activeOrderListItems.length > 0) {
      setCarouselIndex(activeOrderListItems.length - 1);
    }
  }, [activeOrderListItems.length, carouselIndex]);

  // Posición inicial del repartidor: si el seguimiento se abre cuando el
  // repartidor ya va en ruta, el mapa arranca en su última posición conocida
  // en BD sin esperar el siguiente ping de la APK.
  useEffect(() => {
    if (driverLocation || !isTrackingEnabled) return;
    if (!activeOrder) return;
    const lat = activeOrder.lastDriverLatitude;
    const lng = activeOrder.lastDriverLongitude;
    if (lat == null || lng == null) return;
    const routeStatuses = ['PICKED_UP', 'IN_TRANSIT', 'DRIVER_ARRIVED'];
    if (!routeStatuses.includes(activeOrder.status)) return;
    setDriverLocation({ lat, lng });
  }, [activeOrder, driverLocation, isTrackingEnabled]);

  const cartRestaurantId = useCartStore(state => state.restaurantId);
  const cartItems = useCartStore(state => state.items);
  const addItem = useCartStore(state => state.addItem);
  const decreaseQuantity = useCartStore(state => state.decreaseQuantity);
  const updateCartItemAction = useCartStore(state => state.updateItem);
  const clearCartAction = useCartStore(state => state.clearCart);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const cart: CartItem[] = mounted && cartRestaurantId === params.restaurantId ? cartItems : [];
  const [checkoutForm, setCheckoutForm] = useState<CheckoutForm>(defaultCheckoutForm);

  // Si el restaurante solo acepta un método de pago, ajusta el seleccionado por
  // defecto para que el checkout siempre arranque con una opción válida.
  useEffect(() => {
    if (!rawRestaurant) return;
    const accepted = getAcceptedPaymentMethods(rawRestaurant);
    if (accepted.length === 1 && checkoutForm.paymentMethod !== accepted[0]) {
      setCheckoutForm((current) => ({ ...current, paymentMethod: accepted[0] as 'CASH' | 'TRANSFER' }));
    }
  }, [rawRestaurant, checkoutForm.paymentMethod]);
  const [promoCodeState, setPromoCodeState] = useState<'idle' | 'validating' | 'valid' | 'invalid'>('idle');
  const [promoCodeInfo, setPromoCodeInfo] = useState<{ code: string; type: 'PERCENT' | 'AMOUNT' | 'FREE_DELIVERY'; value: number; discount: number; description?: string | null } | null>(null);
  const [isCouponOpen, setIsCouponOpen] = useState(false);
  const [couponFeedback, setCouponFeedback] = useState<{ tone: 'success' | 'error'; title: string; message?: string } | null>(null);
  const couponFeedbackTimerRef = useRef<number | null>(null);
  const [loadingRestaurant, setLoadingRestaurant] = useState(true);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(() => searchParams?.checkout === 'true');
  const [cartJustUpdated, setCartJustUpdated] = useState(false);
  const [cartPulse, setCartPulse] = useState(false);
  const [hideCartButton, setHideCartButton] = useState(false);

  // Ocultar el botón flotante de carrito al llegar al fondo de la página para
  // no tapar las redes sociales del footer; reaparece al hacer scroll hacia arriba.
  useEffect(() => {
    const handleScroll = () => {
      const scrolledToBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 80;
      setHideCartButton(scrolledToBottom);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);
  const [transferProofName, setTransferProofName] = useState('');
  const [transferProofSource, setTransferProofSource] = useState('');
  // Guía de errores: true cuando el usuario intentó confirmar y faltaba algo.
  const [attemptedCheckout, setAttemptedCheckout] = useState(false);
  const [showInstructions, setShowInstructions] = useState(() =>
    Boolean(checkoutForm.storeNotes || checkoutForm.notes)
  );
  const [error, setError] = useState('');
  const [menuReloadKey, setMenuReloadKey] = useState(0);
  const [deliveryErrorModal, setDeliveryErrorModal] = useState('');
  const [fulfillmentType, setFulfillmentType] = useState<'DELIVERY' | 'PICKUP'>(
    searchParams?.fulfillment === 'PICKUP' ? 'PICKUP' : 'DELIVERY'
  );

  // Negocios configurados como "solo recoger en tienda": nunca se ofrece entrega.
  const isPickupOnly = restaurant?.pickupOnly === true;

  const handleFulfillmentChange = (type: 'DELIVERY' | 'PICKUP') => {
    if (isPickupOnly && type !== 'PICKUP') return;
    setFulfillmentType(type);
  };

  useEffect(() => {
    if (isPickupOnly) {
      setFulfillmentType('PICKUP');
    }
  }, [isPickupOnly]);

  useEffect(() => {
    if (searchParams?.fulfillment === 'PICKUP') {
      setFulfillmentType('PICKUP');
    }
  }, [searchParams]);

  useEffect(() => {
    if (searchParams?.product && restaurant) {
      const productId = typeof searchParams.product === 'string' ? searchParams.product : searchParams.product[0];
      for (const category of restaurant.categories) {
        const prod = category.products.find((p) => p.id === productId);
        if (prod) {
          setCustomizingProduct(prod);
          break;
        }
      }
    }
  }, [searchParams, restaurant]);

  useEffect(() => {
    if (!searchParams?.focusProduct || !restaurant) return;
    const productId = typeof searchParams.focusProduct === 'string' ? searchParams.focusProduct : searchParams.focusProduct[0];
    let cleanupTimer: ReturnType<typeof setTimeout> | null = null;
    const timer = setTimeout(() => {
      const el = document.getElementById(productId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Latido premium: doble pulso con glow accent que señala el producto
        // y se asienta solo (ver globals.css · product-focus-heartbeat).
        el.classList.add('product-focus-heartbeat');
        cleanupTimer = setTimeout(() => el.classList.remove('product-focus-heartbeat'), 1500);
      }
    }, 500);
    return () => {
      clearTimeout(timer);
      if (cleanupTimer) clearTimeout(cleanupTimer);
    };
  }, [searchParams, restaurant]);

  const [transientNotice, setTransientNotice] = useState<TransientNotice | null>(null);
  // Latido del banner de pedido activo al crear un pedido (scroll + animación).
  const [orderCreatedPulse, setOrderCreatedPulse] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const categoryNavRef = useRef<HTMLDivElement | null>(null);

  // Auto-centrar la pestaña de categoría activa dentro del carrusel del
  // header sticky: cubre tanto taps como el scroll-spy que marca categorías
  // mientras el usuario recorre el menú.
  useEffect(() => {
    const nav = categoryNavRef.current;
    if (!nav || !activeCategory) return;
    const el = nav.querySelector<HTMLButtonElement>(`[data-category-id="${activeCategory}"]`);
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    });
  }, [activeCategory]);

  const [isRatingModalOpen, setIsRatingModalOpen] = useState(false);
  const [orderToRate, setOrderToRate] = useState<string | null>(null);
  const [ratingBusinessType, setRatingBusinessType] = useState<string | null>(null);
  const [ratingIsPickup, setRatingIsPickup] = useState(false);
  const [restaurantRating, setRestaurantRating] = useState(0);
  const [driverRatingVal, setDriverRatingVal] = useState(0);
  const [isSubmittingRating, setIsSubmittingRating] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [addresses, setAddresses] = useState<any[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [showMapForAddress, setShowMapForAddress] = useState<string | null>(null);
  const [isAddingNewAddress, setIsAddingNewAddress] = useState(false);
  const [newAddressStep, setNewAddressStep] = useState<'search' | 'details'>('search');
  const [addressSearchQuery, setAddressSearchQuery] = useState('');
  const [addressSuggestions, setAddressSuggestions] = useState<any[]>([]);
  const [isSearchingAddress, setIsSearchingAddress] = useState(false);
  const [locatingAddress, setLocatingAddress] = useState(false);
  const checkoutRef = useRef<HTMLDivElement | null>(null);
  const checkoutMapRef = useRef<any>(null);
  const checkoutMarkerRef = useRef<any>(null);
  const categorySectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const transientNoticeTimeoutRef = useRef<number | null>(null);
  const recentNoticeKeysRef = useRef<string[]>([]);
  const lastActiveOrderStatusRef = useRef<string>('');
  const recentCreatedOrderRef = useRef<{ id: string; orderReference: string; paymentMethod?: string } | null>(null);
  const orderCreatedPulseTimerRef = useRef<number | null>(null);
  const loadActiveOrdersRef = useRef<() => void>(() => {});
  const creatingOrderRef = useRef(false);
  const clientOrderKeyRef = useRef('');
  const socketRef = useRef<any>(null);

  // Clave de idempotencia: se regenera cuando cambia el carrito, pero se mantiene
  // estable entre reintentos del mismo pedido (red caída, doble toque).
  useEffect(() => {
    clientOrderKeyRef.current = '';
  }, [cartItems]);

  const [pickupReadyOrder, setPickupReadyOrder] = useState<CustomerOrderDetail | null>(null);
  const [scheduleProposalOrder, setScheduleProposalOrder] = useState<CustomerOrderDetail | null>(null);
  const [copiedField, setCopiedField] = useState<'account' | 'beneficiary' | 'amount' | null>(null);

  // Image preview modal for store products
  const [previewProduct, setPreviewProduct] = useState<{
    images: string[];
    name: string;
    description: string;
    price: number;
    discountPrice?: number | null;
    promoType?: 'MULTI_BUY' | null;
    promoBuyQuantity?: number | null;
    promoPayQuantity?: number | null;
    sellBy?: string;
    unitPrice?: number | null;
    id: string;
    optionGroups?: ProductOptionGroup[];
  } | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);

  // Product options / customization modal state
  const [customizingProduct, setCustomizingProduct] = useState<PublicRestaurantDetail['categories'][number]['products'][number] | null>(null);
  const [carouselIndexMap, setCarouselIndexMap] = useState<Record<string, number>>({});
  const [selectedOptionsForProduct, setSelectedOptionsForProduct] = useState<Record<string, any[]>>({});
  const [customizingQuantity, setCustomizingQuantity] = useState(1);
  const [customizingWeight, setCustomizingWeight] = useState(0);
  const [customizingInstructions, setCustomizingInstructions] = useState('');

  const openProductPreview = (product: PublicRestaurantDetail['categories'][number]['products'][number]) => {
    const imgs = product.images?.length ? product.images : product.image ? [product.image] : [];
    setPreviewProduct({
      images: imgs,
      name: product.name,
      description: product.description,
      price: product.price,
      discountPrice: product.discountPrice,
      promoType: product.promoType,
      promoBuyQuantity: product.promoBuyQuantity,
      promoPayQuantity: product.promoPayQuantity,
      sellBy: product.sellBy,
      unitPrice: product.unitPrice,
      id: product.id,
      optionGroups: product.optionGroups,
    });
    setPreviewIndex(0);
  };

  const handleCopyText = (text: string | undefined | null, field: 'account' | 'beneficiary' | 'amount') => {
    if (!text) return;
    void navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => {
      setCopiedField(null);
    }, 1500);
  };

  const handlePullToRefresh = useCallback(() => {
    setIsRefreshing(true);
    // Fuerza el chequeo de una versión nueva de la PWA además del refresco de datos.
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker
        .getRegistration()
        .then((reg) => {
          void reg?.update().catch(() => {});
        })
        .catch(() => {});
    }
    // Recarga completa: garantiza el menú más reciente y la última versión de la PWA.
    window.setTimeout(() => {
      window.location.reload();
    }, 350);
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
          handlePullToRefresh();
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

  const deliveryPreset = useMemo(
    () => getDeliveryPreset(sessionUser?.region || restaurant?.region),
    [restaurant?.region, sessionUser?.region]
  );

  useEffect(() => {
    try {
      const savedSession = readStoredSession(storageKey);

      if (typeof window !== 'undefined' && window.localStorage) {
        if (document.documentElement.classList.contains('dark')) {
          document.documentElement.classList.add('dark');
          document.documentElement.classList.add('pure-dark');
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

      if (typeof window !== 'undefined' && window.localStorage) {
        const savedProfileAddress = window.localStorage.getItem(profileAddressStorageKey);
        const savedPersistentNotice = window.localStorage.getItem(persistentNoticeStorageKey);

        if (savedProfileAddress) {
          try {
            const parsed = JSON.parse(savedProfileAddress) as Partial<CheckoutForm>;
            const { notes: _notes, storeNotes: _storeNotes, promoCode: _promoCode, ...safeParsed } = parsed;
            setCheckoutForm((current) => ({
              ...current,
              ...safeParsed,
            }));
          } catch {
            window.localStorage.removeItem(profileAddressStorageKey);
          }
        }

        if (savedPersistentNotice) {
          try {
            const parsed = JSON.parse(savedPersistentNotice) as TransientNotice;
            if (parsed.id === 'account-suspended' || parsed.id === 'account-suspended-v2') {
              window.localStorage.removeItem(persistentNoticeStorageKey);
            } else {
              setTransientNotice(parsed);
            }
          } catch {
            window.localStorage.removeItem(persistentNoticeStorageKey);
          }
        }
      }

      if (savedSession.token && savedSession.user) {
        const apiBaseUrl = savedSession.apiBase || '/api';
        requestJson<{ success: true; data: { status: string } }>({
          apiBase: apiBaseUrl,
          path: '/auth/perfil',
          token: savedSession.token,
        }).then((res) => {
          if (res.success && res.data.status !== 'ACTIVE') {
            showTransientNotice({
              key: 'account-suspended-v2',
              title: 'Cuenta suspendida',
              description: 'Tu cuenta ha sido suspendida por incumplimiento de términos y condiciones.',
              tone: 'danger',
              requiresAcknowledgement: true,
              dismissible: false,
            });
          }
        }).catch((err) => {
          const apiError = err as ApiRequestError;
          const userDeleted = apiError?.status === 404 && apiError?.code === 'USER_NOT_FOUND';
          if (isAuthRequestError(err) || userDeleted) {
            clearStoredSession(storageKey);
            setToken('');
            setSessionUser(null);
            setShowAuthModal(true);
          }
        });
      }

      setIsAuthReady(true);
    } catch (e) {
      console.error('Error during restaurant customer session initialization:', e);
      setIsAuthReady(true);
    }

    return () => {
      document.documentElement.classList.remove('pure-dark');
    };
  }, []);

  // Cualquier 401 del API cierra la sesión globalmente (usuario eliminado, token inválido, etc.)
  useEffect(() => {
    setGlobalSessionExpiredHandler(() => {
      clearStoredSession(storageKey);
      setToken('');
      setSessionUser(null);
      setShowAuthModal(true);
    });
    return () => setGlobalSessionExpiredHandler(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setCheckoutForm((current) => applyDeliveryPreset(current, deliveryPreset));
  }, [deliveryPreset]);

  useEffect(() => {
    return () => {
      if (transientNoticeTimeoutRef.current) {
        window.clearTimeout(transientNoticeTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadRestaurant() {
      setLoadingRestaurant(true);
      setError('');

      try {
        const payload = await requestJson<{ success: true; data: PublicRestaurantDetail }>({
          apiBase,
          path: `/restaurantes/${params.restaurantId}${getUserLocationQuery()}`,
          fallbackMessage: 'No se pudo cargar el menu del restaurante.',
          timeoutMs: 10_000,
          retry: { attempts: 1, backoffMs: 300 },
        });

        if (!cancelled) {
          setRawRestaurant(payload.data);
        }
      } catch (requestError) {
        if (!cancelled) {
          setRawRestaurant(null);
          setError(requestError instanceof Error ? requestError.message : 'No se pudo cargar el restaurante.');
        }
      } finally {
        if (!cancelled) {
          setLoadingRestaurant(false);
        }
      }
    }

    void loadRestaurant();

    return () => {
      cancelled = true;
    };
  }, [apiBase, params.restaurantId, menuReloadKey]);

  useEffect(() => {
    if (!document.documentElement) return;
    const hex =
      rawRestaurant?.accentColor && /^#[0-9a-fA-F]{6}$/.test(rawRestaurant.accentColor)
        ? rawRestaurant.accentColor
        : '#0ea5e9';
    const clean = hex.replace('#', '');
    const shade = (factor: number) =>
      `#${[0, 2, 4].map((i) => Math.round(parseInt(clean.slice(i, i + 2), 16) * factor).toString(16).padStart(2, '0')).join('')}`;
    const strong = shade(0.78);
    const hover = shade(0.68);
    const style = document.documentElement.style;
    style.setProperty('--menu-accent', hex);
    style.setProperty('--menu-accent-strong', strong);
    style.setProperty('--menu-accent-hover', hover);
    style.setProperty('--menu-accent-soft', `${hex}1A`);
    style.setProperty('--menu-accent-soft-strong', `${hex}2E`);
  }, [rawRestaurant?.accentColor]);

  useEffect(() => {
    if (!token || sessionUser?.role !== 'CUSTOMER') {
      setActiveOrderListItems([]);
      setActiveOrderDetailsMap({});
      loadActiveOrdersRef.current = () => {};
      return;
    }

    let cancelled = false;

    async function loadActiveOrders() {
      try {
        const ordersPayload = await requestJson<PaginatedOrdersResponse>({
          apiBase,
          path: '/me/pedidos?page=1&limit=12',
          token,
          fallbackMessage: 'No se pudo cargar el pedido activo.',
        });

        const recentCreatedOrder = recentCreatedOrderRef.current;
        if (recentCreatedOrder) {
          const recentOrder = ordersPayload.data.items.find((order) => order.id === recentCreatedOrder.id);
          const normalizedRecentStatus = recentOrder ? normalizeOrderStatusValue(recentOrder.status) : '';

          if (normalizedRecentStatus === 'REJECTED') {
            showTransientNotice({
              key: `restaurant-recent-order-rejected:${recentCreatedOrder.id}`,
              title: 'Pedido rechazado',
              description: 'El restaurante rechazó tu pedido. No te preocupes, no se realizó ningún cobro.',
              tone: 'danger',
              requiresAcknowledgement: true,
              orderId: recentCreatedOrder.id,
              paymentMethod: recentCreatedOrder.paymentMethod,
              orderReference: recentCreatedOrder.orderReference,
            });
            recentCreatedOrderRef.current = null;
          }

          if (normalizedRecentStatus === 'CANCELLED') {
            // Si la canceló el restaurante con motivo, se muestra el modal PERSISTENTE
            // con el motivo (no el aviso genérico).
            if (recentOrder?.cancelledBy === 'RESTAURANT') {
              requestJson<{ success: true; data: CustomerOrderDetail }>({
                apiBase,
                path: `/me/pedidos/${recentOrder.id}`,
                token,
              })
                .then((detailRes) => {
                  if (detailRes.success && detailRes.data && detailRes.data.cancelledBy === 'RESTAURANT') {
                    setCancelledOrderNotice(detailRes.data);
                  }
                })
                .catch(() => {});
            } else {
              showTransientNotice({
                key: `restaurant-recent-order-cancelled:${recentCreatedOrder.id}`,
                title: 'Pedido cancelado',
                description: `Tu pedido ${recentCreatedOrder.orderReference} fue cancelado.`,
                tone: 'danger',
              });
            }
            recentCreatedOrderRef.current = null;
          }
        }

        // El modal de calificación persiste hasta que el usuario califique o salte.
        const unratedOrder = ordersPayload.data.items.find(
          (order) =>
            !order.review &&
            !localStorage.getItem(`sadel_dismissed_rating_${order.id}`) &&
            (normalizeOrderStatusValue(order.status) === 'DELIVERED' ||
             normalizeOrderStatusValue(order.status) === 'COMPLETED')
        );
        if (unratedOrder) {
          setOrderToRate(unratedOrder.id);
          setRatingBusinessType((unratedOrder as any).restaurant?.businessType || null);
          setRatingIsPickup(normalizeOrderStatusValue(unratedOrder.status) === 'COMPLETED');
          setIsRatingModalOpen(true);
        }

        const activeItems = ordersPayload.data.items.filter((order) => isActiveOrderStatus(order.status));

        if (activeItems.length === 0) {
          if (!cancelled) {
            setActiveOrderListItems([]);
            setActiveOrderDetailsMap({});
          }
          return;
        }

        const promises = activeItems.map(async (item) => {
          try {
            const res = await requestJson<{ success: true; data: CustomerOrderDetail }>({
              apiBase,
              path: `/me/pedidos/${item.id}`,
              token,
              fallbackMessage: `No se pudo cargar el seguimiento del pedido ${item.orderReference}`,
            });
            return res.data;
          } catch (err) {
            console.error(`Failed to load order detail for ${item.id}`, err);
            return null;
          }
        });

        const results = await Promise.all(promises);

        if (!cancelled) {
          setActiveOrderListItems(activeItems);
          const nextMap: Record<string, CustomerOrderDetail> = {};
          results.forEach((detail) => {
            if (detail) {
              nextMap[detail.id] = detail;
            }
          });
          setActiveOrderDetailsMap(nextMap);
        }
      } catch {
        if (!cancelled) {
          setActiveOrderListItems([]);
          setActiveOrderDetailsMap({});
        }
      }
    }

    void loadActiveOrders();

    const handleUpdate = () => {
      void loadActiveOrders();
    };
    window.addEventListener('order-updated', handleUpdate);
    loadActiveOrdersRef.current = loadActiveOrders;

    return () => {
      cancelled = true;
      window.removeEventListener('order-updated', handleUpdate);
    };
  }, [apiBase, sessionUser?.role, token]);

  useForegroundPolling(() => {
    // Sincronización de respaldo siempre activa cuando hay pedidos en curso:
    // el socket puede reportar "conectado" y aun así perder eventos (iOS suspende
    // la PWA en segundo plano, red inestable). El polling garantiza que el estado
    // real del pedido siempre se refleje, sin importar si el socket funcionó.
    if (token && sessionUser?.role === 'CUSTOMER') {
      const socketDown = !socketRef.current || socketRef.current.disconnected;
      if (socketDown || activeOrderListItems.length > 0) {
        loadActiveOrdersRef.current();
      }
    }
  }, 20_000);

  useEffect(() => {
    if (!token || !sessionUser || sessionUser.role !== 'CUSTOMER') {
      return;
    }

    const getSocketToken = () => readStoredSession(storageKey).token || '';
    const socket = io(process.env.NEXT_PUBLIC_SOCKET_URL || 'https://sadel-production.up.railway.app', {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
      auth: { token: getSocketToken() },
    });

    socket.on('reconnect_attempt', () => {
      socket.auth = { token: getSocketToken() };
    });

    socket.on('connect', () => {
      socket.emit('join-room', sessionUser.id, 'CUSTOMER');
    });

    socket.on('connect_error', (err) => {
      // Token expirado/inválido: cortar el bucle de reconexión y forzar el
      // flujo de sesión expirada en vez de reintentar indefinidamente.
      if (String((err as Error)?.message || '').includes('UNAUTHORIZED')) {
        socket.disconnect();
        forceSessionExpired();
        return;
      }
      // Fallo de conexión: el polling de respaldo recarga pedidos mientras
      // socket.io reintenta por su cuenta.
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[Socket] connect_error:', err?.message || err);
      }
    });

    const liveEvents = [
      'order:accepted',
      'order:rejected',
      'order:preparing',
      'order:ready',
      'order:driver-assigned',
      'order:driver-accepted',
      'order:driver-rejected',
      'order:picked-up',
      'order:in-transit',
      'order:eta-updated',
      'order:driver-arrived',
      'order:driver_arrived',
      'order:delivered',
      'order:completed',
      'order:cancellation-approved',
      'order:cancellation-rejected',
      'order:pin-reset',
      'order_chat:message_received',
      'order:driver-location',
      'order:schedule-proposal',
      'order:schedule-accepted',
      'order:schedule-rejected',
      'order:no-drivers-available',
      'order:delay',
    ];

    for (const eventName of liveEvents) {
      socket.on(eventName, (payload: any) => {
        if (process.env.NODE_ENV !== 'production') {
          console.log(`[Socket.io] [Restaurante] Evento recibido: "${eventName}"`, payload);
        }

        if (eventName === 'order:driver-location') {
          if (recentCreatedOrderRef.current?.id === payload.orderId || activeOrderListItems.some((o) => o.id === payload.orderId)) {
            setDriverLocation({ lat: payload.latitude, lng: payload.longitude });
          }
        }
        
        if (eventName === 'order:rejected') {
          const matchingOrder = activeOrderListItems.find((o) => o.id === payload.orderId)
            || (recentCreatedOrderRef.current?.id === payload.orderId ? recentCreatedOrderRef.current : null);
          const paymentMethod = matchingOrder?.paymentMethod;
          const orderReference = matchingOrder?.orderReference || recentCreatedOrderRef.current?.orderReference;

          const description = 'El restaurante rechazó tu pedido. No te preocupes, no se realizó ningún cobro.';

          setTransientNotice({
            id: `socket-rejected:${payload.orderId}`,
            title: 'Pedido rechazado',
            description,
            tone: 'danger',
            requiresAcknowledgement: true,
            orderId: payload.orderId,
            paymentMethod,
            orderReference,
          });
          
          if (typeof window !== 'undefined') {
            window.localStorage.setItem(
              persistentNoticeStorageKey,
              JSON.stringify({
                id: `socket-rejected:${payload.orderId}`,
                title: 'Pedido rechazado',
                description,
                tone: 'danger',
                requiresAcknowledgement: true,
                orderId: payload.orderId,
                paymentMethod,
                orderReference,
              })
            );
          }
        }

        if (eventName === 'order:delivered' && payload.orderId) {
          if (localStorage.getItem(`sadel_dismissed_rating_${payload.orderId}`)) return;
          setOrderToRate(payload.orderId);
          const order = activeOrderDetailsMapRef.current[payload.orderId];
          setRatingBusinessType(order?.restaurant?.businessType || null);
          setRatingIsPickup(false);
          setIsRatingModalOpen(true);
        }

        if (eventName === 'order:picked-up' && payload.orderId) {
          const existing = activeOrderDetailsMapRef.current[payload.orderId];
          const isPickup = existing?.fulfillmentType === 'PICKUP';
          if (isPickup) {
            if (localStorage.getItem(`sadel_dismissed_rating_${payload.orderId}`)) return;
            setOrderToRate(payload.orderId);
            setRatingBusinessType(existing?.restaurant?.businessType || null);
            setRatingIsPickup(true);
            setIsRatingModalOpen(true);
          }
        }

        if (eventName === 'order:completed' && payload.orderId) {
          if (localStorage.getItem(`sadel_dismissed_rating_${payload.orderId}`)) return;
          setOrderToRate(payload.orderId);
          const order = activeOrderDetailsMapRef.current[payload.orderId];
          setRatingBusinessType(order?.restaurant?.businessType || null);
          setRatingIsPickup(true);
          setIsRatingModalOpen(true);
        }

        if (eventName === 'order:pin-reset' && payload.orderId) {
          requestJson<{ success: true; data: CustomerOrderDetail }>({
            apiBase,
            path: `/me/pedidos/${payload.orderId}`,
            token,
          }).then((detailRes) => {
            if (detailRes.success) {
              setPickupReadyOrder((prev: any) =>
                prev?.id === payload.orderId ? detailRes.data : prev
              );
              setActiveOrderDetailsMap((prev) => ({
                ...prev,
                [payload.orderId!]: detailRes.data,
              }));
            }
          }).catch(() => {});
        }

        if (['order:driver-arrived', 'order:driver_arrived'].includes(eventName) && payload.orderId) {
          // El modal de llegada lo gestiona el listener global (DriverArrivalModal).
          // Aquí solo se persiste la referencia para que el modal global lo restaure
          // sin importar la ruta en la que navegue el comensal.
          try {
            localStorage.setItem('sadel_persistent_modal', JSON.stringify({ type: 'driver_arrived', orderId: payload.orderId }));
          } catch (e) {}
        }

        if (eventName === 'order:cancellation-approved') {
          try {
            if (window.localStorage.getItem('customerAlertSoundEnabled') !== 'false') {
              void playAlert();
            }
          } catch (e) {}
          const matchingOrder = activeOrderListItems.find((o) => o.id === payload.orderId)
            || (recentCreatedOrderRef.current?.id === payload.orderId ? recentCreatedOrderRef.current : null);
          setTransientNotice({
            id: `socket-cancellation-approved:${payload.orderId}`,
            title: 'Cancelación aprobada',
            description: `El restaurante aceptó la cancelación del pedido #${matchingOrder?.orderReference || payload.orderId}.`,
            tone: 'info',
            requiresAcknowledgement: true,
            orderReference: matchingOrder?.orderReference,
            orderId: payload.orderId,
          });
        }

        if (eventName === 'order:cancellation-rejected') {
          try {
            if (window.localStorage.getItem('customerAlertSoundEnabled') !== 'false') {
              void playAlert();
            }
          } catch (e) {}
          const matchingOrder = activeOrderListItems.find((o) => o.id === payload.orderId)
            || (recentCreatedOrderRef.current?.id === payload.orderId ? recentCreatedOrderRef.current : null);
          setTransientNotice({
            id: `socket-cancellation-rejected:${payload.orderId}`,
            title: 'Cancelación rechazada',
            description: `El restaurante rechazó la cancelación del pedido #${matchingOrder?.orderReference || payload.orderId}. El pedido continúa su curso normal.`,
            tone: 'info',
            requiresAcknowledgement: true,
            orderReference: matchingOrder?.orderReference,
            orderId: payload.orderId,
          });
        }

        if (eventName === 'order:ready' && payload.orderId) {
          requestJson<{ success: true; data: CustomerOrderDetail }>({
            apiBase,
            path: `/me/pedidos/${payload.orderId}`,
            token,
            fallbackMessage: 'No se pudo cargar el detalle del pedido.',
          }).then((res) => {
            if (res.success && res.data.fulfillmentType === 'PICKUP') {
              setPickupReadyOrder(res.data);
            }
          }).catch(() => {});
        }

        if (eventName === 'order:schedule-proposal' && payload.orderId) {
          try {
            if (window.localStorage.getItem('customerAlertSoundEnabled') !== 'false') {
              void playLlegue();
            }
            if (navigator.vibrate) navigator.vibrate([300, 100, 300]);
          } catch (e) {}
          requestJson<{ success: true; data: CustomerOrderDetail }>({
            apiBase,
            path: `/me/pedidos/${payload.orderId}`,
            token,
          }).then((detailRes) => {
            if (detailRes.success) {
              setScheduleProposalOrder(detailRes.data);
            }
          }).catch(() => {});
        }

        if (eventName === 'order:schedule-accepted') {
          setScheduleProposalOrder(null);
          showTransientNotice({
            key: `schedule-accepted:${payload.orderId}`,
            title: 'Fecha confirmada',
            description: 'La fecha de entrega ha sido confirmada exitosamente.',
            tone: 'success',
          });
        }

        if (eventName === 'order:schedule-rejected') {
          setScheduleProposalOrder(null);
        }

        if (
          ['order:ready', 'order:delivered', 'order:in-transit', 'order:eta-updated'].includes(eventName)
        ) {
          try {
            if (window.localStorage.getItem('customerAlertSoundEnabled') !== 'false') {
              void playLlegue();
            }
          } catch (e) {}
        }

        if (
          ['order:rejected', 'order:cancellation-approved', 'order:cancellation-rejected'].includes(eventName)
        ) {
          try {
            if (window.localStorage.getItem('customerAlertSoundEnabled') !== 'false') {
              void playAlert();
            }
          } catch (e) {}
        }

        if (eventName === 'order_chat:message_received') {
          if (window.localStorage.getItem('customerAlertSoundEnabled') !== 'false') {
            void playChat();
          }

          if (payload.orderId === selectedOrderIdRef.current) {
            setChatMessages((prev) => {
              if (prev.some((msg) => msg.id === payload.id)) return prev;
              return [...prev, payload];
            });

            if (!isChatOpenRef.current) {
              setUnreadMessagesMap((prev) => ({
                ...prev,
                [payload.orderId]: (prev[payload.orderId] || 0) + 1
              }));
            }
          } else {
            setUnreadMessagesMap((prev) => ({
              ...prev,
              [payload.orderId]: (prev[payload.orderId] || 0) + 1
            }));
          }
        }

        // Emitir evento para recargar datos
        window.dispatchEvent(new CustomEvent('order-updated'));
      });
    }

    socket.on('account:suspended', (payload: { status: string; reason?: string; message: string }) => {
      showTransientNotice({
        key: 'account-suspended',
        title: 'Cuenta suspendida',
        description: payload.message || 'Tu cuenta ha sido suspendida por incumplimiento de términos y condiciones.',
        tone: 'danger',
        requiresAcknowledgement: true,
        dismissible: false,
      });
    });

    return () => {
      for (const eventName of liveEvents) {
        socket.off(eventName);
      }
      socket.off('account:suspended');
      socket.emit('leave-room', sessionUser.id, 'CUSTOMER');
      socket.disconnect();
      socketRef.current = null;
    };
  }, [apiBase, sessionUser?.id, token]);

  useEffect(() => {
    if (!isCheckoutOpen || showMaxCashModal || showGpsCashModal || deliveryErrorModal || isPushReminderModalOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!checkoutRef.current?.contains(event.target as Node)) {
        setIsCheckoutOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [isCheckoutOpen, showMaxCashModal, showGpsCashModal, deliveryErrorModal, isPushReminderModalOpen]);

  useEffect(() => {
    if (!isCheckoutOpen || (isAddingNewAddress && newAddressStep === 'search') || (!showMapForAddress && !isAddingNewAddress)) {
      checkoutMapRef.current = null;
      checkoutMarkerRef.current = null;
      return;
    }

    let cancelled = false;

    const initCheckoutMap = (google: any) => {
      const lat = parseFloat(checkoutForm.latitude) || 19.4326;
      const lng = parseFloat(checkoutForm.longitude) || -99.1332;

      if (!checkoutMapRef.current) {
        try {
          const mapEl = document.getElementById('map-checkout');
          if (!mapEl) return;

          checkoutMapRef.current = new google.maps.Map(mapEl, {
            center: { lat, lng },
            zoom: 16,
            mapTypeControl: false,
            streetViewControl: false,
          });
        } catch (mapErr) {
          console.error('Error initializing checkout map:', mapErr);
          return;
        }
      } else {
        const currentCenter = checkoutMapRef.current.getCenter();
        if (currentCenter) {
            const dist = Math.abs(currentCenter.lat() - lat) + Math.abs(currentCenter.lng() - lng);
            if (dist > 0.0001) {
            checkoutMapRef.current.setCenter({ lat, lng });
            checkoutMapRef.current.setZoom(16);
            }
        }
      }

      if (checkoutMarkerRef.current) {
        checkoutMarkerRef.current.setPosition({ lat, lng });
        
        if (isAddingNewAddress && newAddressStep === 'details') {
          checkoutMarkerRef.current.setDraggable(true);
        } else {
          checkoutMarkerRef.current.setDraggable(false);
        }
      } else {
        checkoutMarkerRef.current = new google.maps.Marker({
          position: { lat, lng },
          map: checkoutMapRef.current,
          draggable: isAddingNewAddress && newAddressStep === 'details'
        });

        checkoutMarkerRef.current.addListener('dragend', async () => {
          const position = checkoutMarkerRef.current.getPosition();
          if (!position) return;
          
          setCheckoutForm((current) => ({
            ...current,
            latitude: String(position.lat()),
            longitude: String(position.lng()),
          }));

          try {
            const geocoder = new google.maps.Geocoder();
            geocoder.geocode({ location: { lat: position.lat(), lng: position.lng() } }, (results: any, status: any) => {
              if (status === "OK" && results && results[0]) {
                const data = results[0];
                let houseNumber = '';
                const houseComponent = data.address_components.find((c: any) => c.types.includes('street_number'));
                if (houseComponent) houseNumber = houseComponent.long_name;
                
                let street = '';
                const routeComponent = data.address_components.find((c: any) => c.types.includes('route'));
                if (routeComponent) street = routeComponent.long_name;
                
                let neighborhood = '';
                const sublocComponent = data.address_components.find((c: any) => c.types.includes('sublocality') || c.types.includes('neighborhood'));
                if (sublocComponent) neighborhood = sublocComponent.long_name;
                
                let city = '';
                const locComponent = data.address_components.find((c: any) => c.types.includes('locality'));
                if (locComponent) city = locComponent.long_name;
                
                let state = '';
                const adminComponent = data.address_components.find((c: any) => c.types.includes('administrative_area_level_1'));
                if (adminComponent) state = adminComponent.long_name;
                
                let zipCode = '';
                const zipComponent = data.address_components.find((c: any) => c.types.includes('postal_code'));
                if (zipComponent) zipCode = zipComponent.long_name;

                setCheckoutForm((current) => ({
                  ...current,
                  street: street || current.street || '',
                  number: houseNumber || current.number || '',
                  neighborhood: neighborhood || current.neighborhood || '',
                  city: city || current.city || '',
                  state: state || current.state || '',
                  zipCode: zipCode || current.zipCode || '',
                }));
                if (data.formatted_address) {
                  setAddressSearchQuery(data.formatted_address);
                }
              }
            });
          } catch (err) {
            console.error('Error reverse geocoding on checkout marker drag:', err);
          }
        });
      }
    };

    void ensureGoogleMapsScript().then((google) => {
      if (cancelled || !google) return;
      initCheckoutMap(google);
    });

    return () => {
      cancelled = true;
    };
  }, [isCheckoutOpen, isAddingNewAddress, newAddressStep, showMapForAddress, checkoutForm.latitude, checkoutForm.longitude]);

  useEffect(() => {
    if (!isCheckoutOpen || !token) return;

    async function loadAddresses() {
      try {
        const payload = await requestJson<{ success: boolean; data: any[] }>({
          apiBase,
          path: '/customer/addresses',
          token,
          fallbackMessage: 'No se pudo cargar las direcciones.',
        });

        if (payload.success) {
          setAddresses(payload.data);
          const defaultAddr = payload.data.find((a: any) => a.isDefault) || payload.data[0];
          if (defaultAddr) {
            setSelectedAddressId(defaultAddr.id);
            setCheckoutForm((current) => ({
              ...current,
              street: defaultAddr.street || '',
              number: defaultAddr.number || '',
              neighborhood: defaultAddr.neighborhood || '',
              city: defaultAddr.city || '',
              state: defaultAddr.state || '',
              zipCode: defaultAddr.zipCode || '',
              latitude: String(defaultAddr.latitude),
              longitude: String(defaultAddr.longitude),
            }));
          } else {
            setSelectedAddressId(null);
            setCheckoutForm((current) => ({
              ...current,
              street: current.street || '',
              number: current.number || '',
              neighborhood: current.neighborhood || '',
              city: current.city || '',
              state: current.state || '',
              zipCode: current.zipCode || '',
              latitude: current.latitude || '19.4326',
              longitude: current.longitude || '-99.1332',
            }));
          }
        }
      } catch (err) {
        console.error('Error loading addresses:', err);
      }
    }

    loadAddresses();
  }, [isCheckoutOpen, token, apiBase]);

  useEffect(() => {
    const shouldLockScroll = isCartOpen || isCheckoutOpen;

    if (!shouldLockScroll) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isCartOpen, isCheckoutOpen]);

  useEffect(() => {
    if (!activeOrder) {
      lastActiveOrderStatusRef.current = '';
      return;
    }

    const normalizedStatus = normalizeOrderStatusValue(activeOrder.status);
    const previousStatus = lastActiveOrderStatusRef.current;
    lastActiveOrderStatusRef.current = normalizedStatus;

    if (previousStatus === normalizedStatus) {
      return;
    }

    if (normalizedStatus === 'REJECTED') {
      showTransientNotice({
        key: `restaurant-order-rejected:${activeOrder.id}:${normalizedStatus}`,
        title: 'Pedido rechazado',
        description: 'El restaurante rechazó tu pedido. No te preocupes, no se realizó ningún cobro.',
        tone: 'danger',
        requiresAcknowledgement: true,
        orderId: activeOrder.id,
        paymentMethod: activeOrder.paymentMethod,
        orderReference: activeOrder.orderReference,
      });
    }

    if (normalizedStatus === 'CANCELLED') {
      // Restaurante con motivo → modal PERSISTENTE; cualquier otro origen → aviso genérico.
      if (activeOrder.cancelledBy === 'RESTAURANT') {
        setCancelledOrderNotice(activeOrder);
        return;
      }
      showTransientNotice({
        key: `restaurant-order-cancelled:${activeOrder.id}:${normalizedStatus}`,
        title: 'Pedido cancelado',
        description: `El pedido ${activeOrder.orderReference} fue cancelado.`,
        tone: 'danger',
      });
    }
  }, [activeOrder]);

  useEffect(() => {
    if (!cartJustUpdated) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setCartJustUpdated(false);
    }, 900);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [cartJustUpdated]);

  useEffect(() => {
    if (!cart.length || isCartOpen) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setCartPulse(true);
      window.setTimeout(() => setCartPulse(false), 1200);
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [cart.length, isCartOpen]);

  const cartSubtotal = useMemo(
    () => cart.reduce((sum, item) => {
      const optionsPrice = (item.selectedOptions || []).reduce((s, o) => s + toMoney(o.price), 0);
      return sum + (toMoney(item.price) + optionsPrice) * Math.max(0, item.quantity);
    }, 0),
    [cart]
  );

  const totalProducts = useMemo(
    () => cart.reduce((sum, item) => sum + Math.max(0, item.quantity), 0),
    [cart]
  );
  const discountAmount = useMemo(
    () => cart.reduce((sum, item) => {
      const price = toMoney(item.price);
      const basePrice = item.discountPrice ? toMoney(item.discountPrice) : price;
      const discountPriceSaving = (price - basePrice) * Math.max(0, item.quantity);

      let multiBuySaving = 0;
      const buy = item.promoBuyQuantity ?? 0;
      const pay = item.promoPayQuantity ?? 0;
      if (
        item.promoType === 'MULTI_BUY' &&
        item.sellBy !== 'WEIGHT' &&
        buy > 0 &&
        pay > 0 &&
        pay < buy &&
        item.quantity >= buy
      ) {
        const groups = Math.floor(item.quantity / buy);
        const remainder = item.quantity % buy;
        const paidUnits = groups * pay + remainder;
        multiBuySaving = basePrice * (item.quantity - paidUnits);
      }

      return sum + discountPriceSaving + multiBuySaving;
    }, 0),
    [cart]
  );
  const serviceFee = toMoney(restaurant?.serviceFee);
  // Distancia efectiva: mientras se navega el menú usa la ubicación activa (para
  // coincidir con el preview de la página principal); durante el checkout usa las
  // coordenadas de la dirección de entrega ingresada. No se usa restaurant.distanceKm
  // porque el backend lo calculó con la ubicación del usuario al cargar la página y
  // quedaría desactualizado si la dirección de entrega difiere.
  const distanceKm = useMemo(() => {
    if (!restaurant || !restaurant.latitude || !restaurant.longitude) return null;

    let customerLat = NaN;
    let customerLng = NaN;

    // Si el checkout no está abierto, usamos por defecto la ubicación activa del usuario (userLocation)
    // para coincidir con lo que vio en la página principal (HomeView).
    if (!isCheckoutOpen) {
      if (typeof window !== 'undefined') {
        try {
          const locStr = window.localStorage.getItem('userLocation');
          if (locStr) {
            const loc = JSON.parse(locStr);
            if (loc && loc.latitude && loc.longitude) {
              customerLat = loc.latitude;
              customerLng = loc.longitude;
            }
          }
        } catch (e) {}
      }
    }

    // Si está en el proceso de checkout o no se encontró la ubicación activa en localStorage,
    // usamos las coordenadas del formulario/perfil guardado.
    if (isNaN(customerLat) || isNaN(customerLng)) {
      customerLat = parseFloat(checkoutForm.latitude);
      customerLng = parseFloat(checkoutForm.longitude);
    }

    // Si las coordenadas resultantes son las del Zócalo (por defecto), intentamos rellenar con userLocation
    if (customerLat === 19.4326 && customerLng === -99.1332) {
      if (typeof window !== 'undefined') {
        try {
          const locStr = window.localStorage.getItem('userLocation');
          if (locStr) {
            const loc = JSON.parse(locStr);
            if (loc && loc.latitude && loc.longitude) {
              customerLat = loc.latitude;
              customerLng = loc.longitude;
            }
          }
        } catch (e) {}
      }
    }

    if (isNaN(customerLat) || isNaN(customerLng)) return null;

    return calculateHaversineDistance(
      customerLat,
      customerLng,
      restaurant.latitude,
      restaurant.longitude
    );
  }, [restaurant, checkoutForm.latitude, checkoutForm.longitude, isCheckoutOpen]);

  // Envío dinámico recalculado con la distancia efectiva (dirección de entrega real
  // durante el checkout), usando la misma fórmula que el backend. El preview del
  // backend (effectiveDeliveryFee) solo se usa como respaldo.
  const deliveryFee = useMemo(() => {
    if (fulfillmentType === 'PICKUP') return 0;
    if (!restaurant) return 0;
    let fee = 0;
    if (
      typeof distanceKm === 'number' &&
      restaurant.pricingModel === 'distance' &&
      typeof restaurant.baseRate === 'number' &&
      typeof restaurant.perKmRate === 'number'
    ) {
      const extraKm = Math.max(0, distanceKm - 1);
      fee = restaurant.baseRate + extraKm * restaurant.perKmRate;
      if (typeof restaurant.minDeliveryFee === 'number') fee = Math.max(fee, restaurant.minDeliveryFee);
      if (typeof restaurant.maxDeliveryFee === 'number') fee = Math.min(fee, restaurant.maxDeliveryFee);
    } else if (restaurant.hasOwnDelivery) {
      fee = toMoney(restaurant.deliveryFee);
    } else {
      fee = toMoney(restaurant.effectiveDeliveryFee);
    }
    const effectiveSubtotal = cartSubtotal - discountAmount;
    if (
      restaurant.promoFreeDeliveryThreshold != null &&
      restaurant.promoFreeDeliveryThreshold > 0 &&
      effectiveSubtotal >= restaurant.promoFreeDeliveryThreshold
    ) {
      fee = 0;
    }
    return Math.round(fee * 100) / 100;
  }, [restaurant, distanceKm, fulfillmentType, cartSubtotal, discountAmount]);

  // Aviso amable de distancia: si el usuario está fuera del radio de entrega,
  // se explica UNA sola vez por negocio y sesión (modal) qué puede hacer:
  // recoger en tienda, pagar con transferencia o agendar (tiendas).
  const [showDistanceNotice, setShowDistanceNotice] = useState(false);
  useEffect(() => {
    if (!restaurant || typeof distanceKm !== 'number') return;
    if (restaurant.pickupOnly) return;
    const radiusKm = restaurant.deliveryRadius || 3;
    if (distanceKm <= radiusKm) return;
    let seen: string | null = null;
    try {
      seen = sessionStorage.getItem(`distanceNotice:${restaurant.id}`);
    } catch {}
    if (seen === '1') return;
    setShowDistanceNotice(true);
    try {
      sessionStorage.setItem(`distanceNotice:${restaurant.id}`, '1');
    } catch {}
  }, [restaurant, distanceKm]);

  const effectiveSubtotal = Math.max(0, cartSubtotal - discountAmount);
  const couponDiscount = promoCodeState === 'valid' && promoCodeInfo ? promoCodeInfo.discount : 0;
  const minOrderDiscount =
    restaurant?.promoMinOrderPercent != null &&
    restaurant?.promoMinOrderPercent > 0 &&
    restaurant?.promoMinOrderAmount != null &&
    restaurant?.promoMinOrderAmount > 0 &&
    effectiveSubtotal >= restaurant.promoMinOrderAmount
      ? Math.round(effectiveSubtotal * restaurant.promoMinOrderPercent / 100 * 100) / 100
      : 0;
  const orderTotal = Math.max(0, effectiveSubtotal - couponDiscount - minOrderDiscount + serviceFee + (fulfillmentType === 'PICKUP' ? 0 : deliveryFee));
  const checkoutValidationMessage = useMemo(() => {
    return getCheckoutValidationMessage(checkoutForm, cart, restaurant, token, Boolean(transferProofSource));
  }, [cart, checkoutForm, restaurant, token, transferProofSource]);

function triggerHaptic(pattern: number | number[] = 10) {
  if (typeof window !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(pattern);
  }
}

function getProductAvailability(p: { trackStock?: boolean; stock?: number; lowStockThreshold?: number }) {
  const tracked = !!p.trackStock;
  const stock = typeof p.stock === 'number' ? p.stock : 0;
  const threshold = typeof p.lowStockThreshold === 'number' ? p.lowStockThreshold : 5;
  const available = tracked ? stock > 0 : true;
  const lowStock = tracked && stock > 0 && stock <= threshold;
  const maxQty = available ? (tracked ? stock : Number.POSITIVE_INFINITY) : 0;
  return { available, lowStock, maxQty, tracked };
}

function StockBadge({ avail }: { avail: ReturnType<typeof getProductAvailability> }) {
  if (!avail.available) {
    return (
      <div className="absolute bottom-1.5 left-1.5 z-10 flex items-center gap-1 rounded-full bg-neutral-900/90 px-2 py-0.5 text-[9px] font-bold text-white shadow-sm">
        Agotado
      </div>
    );
  }
  if (avail.lowStock) {
    return (
      <div className="absolute bottom-1.5 left-1.5 z-10 flex items-center gap-1 rounded-full bg-amber-500/90 px-2 py-0.5 text-[9px] font-bold text-white shadow-sm">
        Pocas unidades
      </div>
    );
  }
  return null;
}

  function addToCart(product: PublicRestaurantDetail['categories'][number]['products'][number]) {
    const hasOptions = product.optionGroups && product.optionGroups.length > 0;
    const isWeightProduct = product.sellBy === 'WEIGHT';
    const availability = getProductAvailability(product);

    if (!availability.available) {
      setError('Este producto está agotado.');
      return;
    }

    if (hasOptions || isWeightProduct) {
      setCustomizingProduct(product);
      setCustomizingQuantity(1);
      setCustomizingWeight(isWeightProduct ? (product.minWeightG || 100) : 0);
      setCustomizingInstructions('');
      const initialSelection: Record<string, any[]> = {};
      (product.optionGroups || []).forEach((group) => {
        initialSelection[group.id] = [];
      });
      setSelectedOptionsForProduct(initialSelection);
      triggerHaptic(15);
      return;
    }

    addItem({
      cartItemId: product.id,
      productId: product.id,
      name: product.name,
      price: product.price,
      discountPrice: (product as any).discountPrice,
      promoType: product.promoType,
      promoBuyQuantity: product.promoBuyQuantity,
      promoPayQuantity: product.promoPayQuantity,
      image: product.image,
      quantity: 1,
      specialInstructions: '',
      selectedOptions: [],
      sellBy: 'UNIT',
      maxStock: availability.tracked ? (product.stock ?? 0) : null,
    } as any, params.restaurantId as string, restaurant?.serviceFee || 0, restaurant?.effectiveDeliveryFee || 0);
    setCartJustUpdated(true);
    triggerHaptic(15); // Small vibration
  }

  function decreaseQuantityForProduct(productId: string) {
    decreaseQuantity(productId);
    triggerHaptic(10);
  }

  function addCustomizedItemToCart() {
    if (!customizingProduct) return;

    for (const group of customizingProduct.optionGroups || []) {
      const selected = selectedOptionsForProduct[group.id] || [];
      if (selected.length < group.minSelection) {
        setError(`Por favor selecciona al menos ${group.minSelection} opción(es) para ${group.name}.`);
        return;
      }
    }

    const flatSelectedOptions = Object.entries(selectedOptionsForProduct).flatMap(([groupId, opts]) => {
      const groupName = customizingProduct.optionGroups?.find((g: any) => g.id === groupId)?.name || '';
      return opts.map(o => ({
        id: o.id,
        groupId,
        groupName,
        name: o.name,
        price: o.price,
      }));
    });

    const optionFingerprint = flatSelectedOptions.map(o => o.id).sort().join(',');
    const cartItemId = `${customizingProduct.id}-${optionFingerprint || 'no-options'}-${Date.now()}`;

    const isWeightProduct = customizingProduct.sellBy === 'WEIGHT';
    const itemPrice = isWeightProduct
      ? (customizingProduct.unitPrice || 0) * customizingWeight / 1000
      : customizingProduct.price;

    const availability = getProductAvailability(customizingProduct);
    const qty = availability.tracked
      ? Math.min(customizingQuantity, availability.maxQty)
      : customizingQuantity;

    addItem({
      cartItemId,
      productId: customizingProduct.id,
      name: customizingProduct.name,
      price: itemPrice,
      discountPrice: customizingProduct.discountPrice,
      promoType: customizingProduct.promoType,
      promoBuyQuantity: customizingProduct.promoBuyQuantity,
      promoPayQuantity: customizingProduct.promoPayQuantity,
      image: customizingProduct.image,
      quantity: qty,
      specialInstructions: customizingInstructions,
      selectedOptions: flatSelectedOptions as any,
      sellBy: customizingProduct.sellBy || 'UNIT',
      weightG: isWeightProduct ? customizingWeight : null,
      unitPrice: isWeightProduct ? customizingProduct.unitPrice : null,
      maxStock: availability.tracked ? (customizingProduct.stock ?? 0) : null,
    } as any, params.restaurantId as string, restaurant?.serviceFee || 0, restaurant?.effectiveDeliveryFee || 0);

    setCustomizingProduct(null);
    setCartJustUpdated(true);
    triggerHaptic(15);
  }

  const handleToggleCheckboxOption = (group: any, option: any) => {
    setSelectedOptionsForProduct((prev) => {
      const current = prev[group.id] || [];
      const isSelected = current.some((o) => o.id === option.id);
      if (isSelected) {
        return {
          ...prev,
          [group.id]: current.filter((o) => o.id !== option.id),
        };
      } else {
        if (current.length >= group.maxSelection) {
          return prev;
        }
        return {
          ...prev,
          [group.id]: [...current, option],
        };
      }
    });
    triggerHaptic(10);
  };

  const handleSelectRadioOption = (group: any, option: any) => {
    setSelectedOptionsForProduct((prev) => {
      const currentSelection = prev[group.id] || [];
      const isAlreadySelected = currentSelection.some((o: any) => o.id === option.id);
      
      if (isAlreadySelected && group.minSelection === 0) {
        return {
          ...prev,
          [group.id]: [],
        };
      }

      return {
        ...prev,
        [group.id]: [option],
      };
    });
    triggerHaptic(10);
  };

  useEffect(() => {
    if (!restaurant?.categories) return;
    
    // Initialize active category so the selector has an active tab on first load
    if (!activeCategory && restaurant.categories.length > 0) {
      setActiveCategory(restaurant.categories[0].id);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveCategory(entry.target.id);
          }
        });
      },
      { rootMargin: '-184px 0px -60% 0px', threshold: 0 }
    );

    Object.values(categorySectionRefs.current).forEach((section) => {
      if (section) observer.observe(section);
    });

    return () => observer.disconnect();
  }, [restaurant]);

  function scrollToCategory(categoryId: string) {
    setActiveCategory(categoryId);
    const target = categorySectionRefs.current[categoryId];

    if (!target) {
      return;
    }

    const stickyHeader = document.querySelector('[data-sticky-header]');
    const stickyHeight = stickyHeader ? stickyHeader.getBoundingClientRect().height + 72 : 184;

    const targetPosition = target.getBoundingClientRect().top + window.scrollY - stickyHeight;

    window.scrollTo({
      top: targetPosition,
      behavior: 'smooth',
    });
  }

  async function saveAndSelectAddress() {
    if (!token) return;

    if (!checkoutForm.street.trim()) {
      setError('Por favor, ingresa una calle válida.');
      return;
    }
    if (!checkoutForm.number.trim()) {
      setError('El número de casa/apto es obligatorio.');
      return;
    }

    try {
      setError('');
      const payload = await requestJson<{ success: boolean; data: any }>({
        apiBase,
        path: '/customer/addresses/verify',
        options: {
          method: 'POST',
          body: JSON.stringify({
            street: checkoutForm.street.trim(),
            number: checkoutForm.number.trim(),
            neighborhood: checkoutForm.neighborhood.trim() || 'Colonia',
            city: checkoutForm.city.trim() || 'Ciudad',
            state: checkoutForm.state.trim() || 'Estado',
            zipCode: checkoutForm.zipCode.trim() || '00000',
            country: checkoutForm.country.trim() || 'MX',
            reference: checkoutForm.reference.trim(),
            latitude: parseFloat(checkoutForm.latitude),
            longitude: parseFloat(checkoutForm.longitude),
            isDefault: addresses.length === 0,
          }),
        },
        token,
      });

      if (payload.success) {
        const refreshPayload = await requestJson<{ success: boolean; data: any[] }>({
          apiBase,
          path: '/customer/addresses',
          token,
          fallbackMessage: 'No se pudo cargar las direcciones actualizadas.',
        });
        
        if (refreshPayload.success) {
          setAddresses(refreshPayload.data);
        }

        setSelectedAddressId(payload.data.id);
        setIsAddingNewAddress(false);
        setNewAddressStep('search');
        
        setCheckoutForm((current) => ({
          ...current,
          street: payload.data.street || '',
          number: payload.data.number || '',
          neighborhood: payload.data.neighborhood || '',
          city: payload.data.city || '',
          state: payload.data.state || '',
          zipCode: payload.data.zipCode || '',
          latitude: String(payload.data.latitude),
          longitude: String(payload.data.longitude),
        }));

        setTransientNotice({
          id: 'address-saved',
          title: '¡Dirección agregada!',
          description: 'Se ha guardado y seleccionado tu nueva dirección.',
          tone: 'success',
        });
        setTimeout(() => setTransientNotice(null), 2500);
      }
    } catch (err) {
      console.error('Error saving checkout address:', err);
      setError(err instanceof Error ? err.message : 'Error al guardar la dirección.');
    }
  }

  async function fillCheckoutWithCurrentLocation() {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      setError('La geolocalización no está soportada por tu navegador.');
      return;
    }

    setLocatingAddress(true);
    setError('');
    
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        setCheckoutForm((current) => ({
          ...current,
          latitude: String(latitude),
          longitude: String(longitude),
        }));

        try {
            const google = getGoogleMaps();
            if (!google) throw new Error("Google Maps not loaded");

            const geocoder = new google.maps.Geocoder();
            geocoder.geocode({ location: { lat: latitude, lng: longitude } }, (results: any, status: any) => {
              if (status === "OK" && results && results[0]) {
                const data = results[0];
                let houseNumber = '';
                const houseComponent = data.address_components.find((c: any) => c.types.includes('street_number'));
                if (houseComponent) houseNumber = houseComponent.long_name;
                
                let street = 'Ubicación GPS';
                const routeComponent = data.address_components.find((c: any) => c.types.includes('route'));
                if (routeComponent) street = routeComponent.long_name;
                
                let neighborhood = '';
                const sublocComponent = data.address_components.find((c: any) => c.types.includes('sublocality') || c.types.includes('neighborhood'));
                if (sublocComponent) neighborhood = sublocComponent.long_name;
                
                let city = '';
                const locComponent = data.address_components.find((c: any) => c.types.includes('locality'));
                if (locComponent) city = locComponent.long_name;
                
                let state = '';
                const adminComponent = data.address_components.find((c: any) => c.types.includes('administrative_area_level_1'));
                if (adminComponent) state = adminComponent.long_name;
                
                let zipCode = '';
                const zipComponent = data.address_components.find((c: any) => c.types.includes('postal_code'));
                if (zipComponent) zipCode = zipComponent.long_name;

                setCheckoutForm((current) => ({
                  ...current,
                  street: street,
                  number: houseNumber,
                  neighborhood: neighborhood,
                  city: city,
                  state: state,
                  zipCode: zipCode,
                }));
                
                setAddressSearchQuery(data.formatted_address || 'Ubicación GPS');
                setNewAddressStep('details');
              } else {
                  throw new Error("No results");
              }
            });
        } catch (err) {
          console.error('Error reverse geocoding current location:', err);
          setCheckoutForm((current) => ({
            ...current,
            street: 'Ubicación GPS',
            number: '',
            neighborhood: '',
            city: '',
            state: '',
            zipCode: '',
          }));
          setAddressSearchQuery('Ubicación GPS');
          setNewAddressStep('details');
        } finally {
          setLocatingAddress(false);
        }
      },
      (err) => {
        console.error('Error getting geolocation:', err);
        setLocatingAddress(false);
        setError('No pudimos acceder a tu ubicación. Por favor busca tu dirección manualmente.');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function updateCartItem(
    cartItemId: string,
    patch: Partial<Pick<CartItem, 'quantity' | 'specialInstructions'>>
  ) {
    updateCartItemAction(cartItemId, patch);
  }

  function getCartQuantity(productId: string) {
    return cart
      .filter((item) => item.productId === productId)
      .reduce((sum, item) => sum + item.quantity, 0);
  }

  async function getCurrentOrderLocation() {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      throw new Error('LOCATION_UNSUPPORTED');
    }

    const waitForPosition = (highAccuracy: boolean, timeoutMs: number): Promise<GeolocationPosition> =>
      new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: highAccuracy,
          timeout: timeoutMs,
          maximumAge: highAccuracy ? 0 : 120_000,
        });
      });

    let position: GeolocationPosition;
    try {
      position = await waitForPosition(false, 10_000);
      if (position.coords.accuracy > 200) {
        try {
          position = await waitForPosition(true, 12_000);
        } catch { }
      }
    } catch {
      try {
        position = await waitForPosition(true, 12_000);
      } catch {
        position = await waitForPosition(false, 10_000);
      }
    }

    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      capturedAt: Date.now(),
    };
  }

  function showCouponFeedback(tone: 'success' | 'error', title: string, message?: string) {
    if (couponFeedbackTimerRef.current) {
      window.clearTimeout(couponFeedbackTimerRef.current);
    }
    setCouponFeedback({ tone, title, message });
    couponFeedbackTimerRef.current = window.setTimeout(() => {
      setCouponFeedback(null);
      couponFeedbackTimerRef.current = null;
    }, 2000);
  }

  async function validatePromoCode() {
    const code = checkoutForm.promoCode.trim().toUpperCase();
    if (!code) return;
    if (!restaurant) {
      setPromoCodeState('invalid');
      showCouponFeedback('error', 'No se pudo validar el cupón', 'Selecciona un restaurante primero.');
      return;
    }
    setPromoCodeState('validating');
    setPromoCodeInfo(null);
    try {
      const effectiveSubtotal = Math.max(0, cartSubtotal - discountAmount);
      const payload = await requestJson<{
        success: true;
        data: { code: string; type: 'PERCENT' | 'AMOUNT' | 'FREE_DELIVERY'; value: number; description?: string | null; minOrderAmount?: number | null; discount: number };
      }>({
        apiBase,
        path: '/pedidos/validar-cupon',
        token,
        options: {
          method: 'POST',
          body: JSON.stringify({
            restaurantId: restaurant.id,
            promoCode: code,
            subtotal: effectiveSubtotal,
            isPickup: fulfillmentType === 'PICKUP',
            deliveryFee: deliveryFee,
          }),
        },
        fallbackMessage: 'No se pudo validar el cupón.',
      });
      setPromoCodeState('valid');
      setPromoCodeInfo(payload.data);
      const typeLabel =
        payload.data.type === 'PERCENT'
          ? `${payload.data.value}% de descuento`
          : payload.data.type === 'AMOUNT'
            ? `-${formatCurrency(payload.data.discount)} en tu pedido`
            : 'Envío gratis';
      showCouponFeedback('success', `Cupón ${payload.data.code} aplicado`, typeLabel);
    } catch (e: any) {
      setPromoCodeState('invalid');
      const msg = e instanceof Error ? e.message : 'El código promocional no es válido.';
      showCouponFeedback('error', 'Cupón no válido', msg);
    }
  }

  async function createOrder() {
    if (creatingOrderRef.current || creatingOrder || !restaurant) {
      return;
    }
    creatingOrderRef.current = true;
    if (checkoutValidationMessage) {
      setError(checkoutValidationMessage);
      return;
    }

    setCreatingOrder(true);
    setError('');

    try {
      const normalizedCheckoutForm = applyDeliveryPreset(checkoutForm, deliveryPreset);
      let currentLocation: Awaited<ReturnType<typeof getCurrentOrderLocation>> | null = null;

      try {
        currentLocation = await getCurrentOrderLocation();
      } catch (geoError: any) {
        console.error('Geolocation error:', geoError);
        // Si falla la geolocalización por CUALQUIER motivo (denegado o error técnico del dispositivo),
        // bloqueamos el pago en efectivo para estar sincronizados con el servidor.
        if (normalizedCheckoutForm.paymentMethod === 'CASH') {
          setShowGpsCashModal(true);
          setCreatingOrder(false);
          return;
        }
      }

      // 1. Límite de Pedidos Activos (Máximo 2)
      if (activeOrderListItems.length >= 2) {
        setError('Seguridad: Ya tienes 2 pedidos en proceso. Espera a que alguno se entregue para realizar otro.');
        setCreatingOrder(false);
        return;
      }

      // 3. Límite de Monto para Pago en Efectivo (configurado por el restaurante)
      const MAX_CASH_AMOUNT = restaurant?.maxCashOrder && restaurant.maxCashOrder > 0 ? restaurant.maxCashOrder : 500;
      if (normalizedCheckoutForm.paymentMethod === 'CASH' && orderTotal > MAX_CASH_AMOUNT) {
        setShowMaxCashModal(true);
        setCreatingOrder(false);
        return;
      }

      // 4. Límite de Cobertura del Restaurante (solo para delivery)
      if (fulfillmentType !== 'PICKUP' && restaurant?.latitude && restaurant?.longitude) {
        const restLat = restaurant.latitude;
        const restLng = restaurant.longitude;
        const deliveryLat = parseFloat(normalizedCheckoutForm.latitude);
        const deliveryLng = parseFloat(normalizedCheckoutForm.longitude);
        
        const R = 6371;
        const dLat = (deliveryLat - restLat) * Math.PI / 180;
        const dLon = (deliveryLng - restLng) * Math.PI / 180;
        const a = 
          Math.sin(dLat/2) * Math.sin(dLat/2) +
          Math.cos(restLat * Math.PI / 180) * Math.cos(deliveryLat * Math.PI / 180) * 
          Math.sin(dLon/2) * Math.sin(dLon/2); 
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
        const distanceToRestaurant = R * c;
        
        const maxRadius = restaurant.deliveryRadius || 3;
        
        if (distanceToRestaurant > maxRadius) {
          setDeliveryErrorModal(`Lo sentimos, esta dirección queda fuera de la zona de cobertura de este restaurante (Máximo ${maxRadius} km).`);
          setCreatingOrder(false);
          return;
        }
      }

      // Geolocation check (solo para delivery y pago en efectivo)
      if (fulfillmentType !== 'PICKUP' && normalizedCheckoutForm.paymentMethod === 'CASH' && currentLocation) {
        const userLat = currentLocation.latitude;
        const userLng = currentLocation.longitude;
        const deliveryLat = parseFloat(normalizedCheckoutForm.latitude);
        const deliveryLng = parseFloat(normalizedCheckoutForm.longitude);
        
        const R = 6371;
        const dLat = (deliveryLat - userLat) * Math.PI / 180;
        const dLon = (deliveryLng - userLng) * Math.PI / 180;
        const a = 
          Math.sin(dLat/2) * Math.sin(dLat/2) +
          Math.cos(userLat * Math.PI / 180) * Math.cos(deliveryLat * Math.PI / 180) * 
          Math.sin(dLon/2) * Math.sin(dLon/2); 
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
        const distance = R * c;
        
        const MAX_DISTANCE_KM = 1;
        
        if (distance > MAX_DISTANCE_KM) {
          setDeliveryErrorModal(`Estás demasiado lejos de la dirección de entrega (${distance.toFixed(1)} km). Para pedir a esta distancia debes usar pago por transferencia.`);
          setCreatingOrder(false);
          return;
        }
      }
      const paymentProofUrl =
        normalizedCheckoutForm.paymentMethod === 'TRANSFER' && transferProofSource
          ? await persistTransferProof({
              apiBase,
              token,
              source: transferProofSource,
              fileName: transferProofName,
            })
          : '';

      const combinedNotes = [
        normalizedCheckoutForm.storeNotes.trim() ? `Tienda: ${normalizedCheckoutForm.storeNotes.trim()}` : '',
        fulfillmentType !== 'PICKUP' && normalizedCheckoutForm.notes.trim() ? `Repartidor: ${normalizedCheckoutForm.notes.trim()}` : ''
      ].filter(Boolean).join('\n');

      if (fulfillmentType !== 'PICKUP') {
      const verifiedAddressPayload = {
        street: normalizedCheckoutForm.street.trim(),
        number: normalizedCheckoutForm.number.trim(),
        neighborhood: normalizedCheckoutForm.neighborhood.trim(),
        city: normalizedCheckoutForm.city.trim(),
        state: normalizedCheckoutForm.state.trim(),
        zipCode: normalizedCheckoutForm.zipCode.trim(),
        country: normalizedCheckoutForm.country.trim(),
        ...(normalizedCheckoutForm.reference.trim()
          ? { reference: normalizedCheckoutForm.reference.trim() }
          : {}),
        latitude: parseFloat(normalizedCheckoutForm.latitude),
        longitude: parseFloat(normalizedCheckoutForm.longitude),
      };

      await requestJson<{ success: boolean; data: any }>({
        apiBase,
        path: '/customer/addresses/verify',
        token,
        options: {
          method: 'POST',
          body: JSON.stringify(verifiedAddressPayload),
        },
        fallbackMessage: 'No se pudo verificar la dirección de entrega.',
      });
      }

      const body: Record<string, any> = {
        restaurantId: restaurant.id,
        clientOrderKey: (clientOrderKeyRef.current ||= (typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `ord-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`)),
        items: cart.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          ...(item.specialInstructions.trim()
            ? { specialInstructions: item.specialInstructions.trim() }
            : {}),
          optionIds: (item.selectedOptions || []).map((o) => o.id),
          sellBy: item.sellBy || 'UNIT',
          ...(item.sellBy === 'WEIGHT' && item.weightG
            ? { weightG: item.weightG }
            : {}),
        })),
        fulfillmentType,
        paymentMethod: normalizedCheckoutForm.paymentMethod,
        ...(paymentProofUrl ? { paymentProofUrl } : {}),
        ...(combinedNotes ? { notes: combinedNotes } : {}),
        locationVerified: !!currentLocation,
        ...(promoCodeState === 'valid' && promoCodeInfo
          ? { promoCode: promoCodeInfo.code }
          : {}),
      };

      if (fulfillmentType !== 'PICKUP') {
        body.deliveryAddress = {
          street: normalizedCheckoutForm.street.trim(),
          number: normalizedCheckoutForm.number.trim(),
          neighborhood: normalizedCheckoutForm.neighborhood.trim(),
          city: normalizedCheckoutForm.city.trim(),
          state: normalizedCheckoutForm.state.trim(),
          zipCode: normalizedCheckoutForm.zipCode.trim(),
          country: normalizedCheckoutForm.country.trim(),
          ...(normalizedCheckoutForm.reference.trim()
            ? { reference: normalizedCheckoutForm.reference.trim() }
            : {}),
          latitude: parseFloat(normalizedCheckoutForm.latitude),
          longitude: parseFloat(normalizedCheckoutForm.longitude),
        };
      }
      if (currentLocation) {
        body.currentLocation = currentLocation;
      }

      const payload = await requestJson<{ success: true; data: { id: string; orderReference: string } }>({
        apiBase,
        path: '/pedidos',
        token,
        options: {
          method: 'POST',
          body: JSON.stringify(body),
        },
        fallbackMessage: 'No se pudo crear el pedido.',
      });

      setCheckoutForm(normalizedCheckoutForm);
      if (typeof window !== 'undefined') {
        // No persistimos el cupón: el código de un pedido anterior no debe
        // re-aplicarse solo en pedidos futuros (debe validarse con "Aplicar").
        const { promoCode: _promoCode, ...checkoutToPersist } = normalizedCheckoutForm;
        window.localStorage.setItem(profileAddressStorageKey, JSON.stringify(checkoutToPersist));
      }

      try {
        const createdOrderPayload = await requestJson<{ success: true; data: CustomerOrderDetail }>({
          apiBase,
          path: `/me/pedidos/${payload.data.id}`,
          token,
          fallbackMessage: 'No se pudo cargar el pedido recién creado.',
        });

        const newOrderListItem: CustomerOrderListItem = {
          id: createdOrderPayload.data.id,
          orderReference: createdOrderPayload.data.orderReference,
          dailyCounter: createdOrderPayload.data.dailyCounter,
          status: createdOrderPayload.data.status,
          totalAmount: createdOrderPayload.data.totalAmount,
          paymentMethod: createdOrderPayload.data.paymentMethod,
          createdAt: createdOrderPayload.data.createdAt,
          estimatedDeliveryTime: createdOrderPayload.data.estimatedDeliveryTime,
          restaurant: {
            id: createdOrderPayload.data.restaurant.id,
            name: createdOrderPayload.data.restaurant.name,
            logo: createdOrderPayload.data.restaurant.logo,
          },
          address: createdOrderPayload.data.address ? {
            street: createdOrderPayload.data.address.street,
            number: createdOrderPayload.data.address.number,
            neighborhood: createdOrderPayload.data.address.neighborhood,
            reference: createdOrderPayload.data.address.reference,
          } : null,
        };

        setActiveOrderListItems((prev) => [newOrderListItem, ...prev]);
        setActiveOrderDetailsMap((prev) => ({
          ...prev,
          [createdOrderPayload.data.id]: createdOrderPayload.data,
        }));
        setCarouselIndex(0);
      } catch {
        // No-op
      }

      clearCartAction();
      setCheckoutForm((prev) => ({ ...prev, notes: '', storeNotes: '', promoCode: '' }));
      setPromoCodeState('idle');
      setPromoCodeInfo(null);
      setIsCouponOpen(false);
      setCouponFeedback(null);
      if (couponFeedbackTimerRef.current) {
        window.clearTimeout(couponFeedbackTimerRef.current);
        couponFeedbackTimerRef.current = null;
      }
      setIsCheckoutOpen(false);
      setTransferProofName('');
      setTransferProofSource('');
      recentCreatedOrderRef.current = {
        id: payload.data.id,
        orderReference: payload.data.orderReference,
        paymentMethod: checkoutForm.paymentMethod,
      };
      showTransientNotice({
        key: `restaurant-order-created:${payload.data.id}`,
        title: 'Pedido creado con éxito',
        description: 'Tu pedido fue enviado al restaurante. Espera mientras lo preparan.',
        tone: 'success',
      });
      triggerHaptic([30, 50, 30]); // Double vibration

      // Lleva al usuario arriba para ver el banner del pedido activo y lo "late".
      if (typeof window !== 'undefined') {
        window.setTimeout(() => {
          window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
        }, 60);
      }
      setOrderCreatedPulse(true);
      if (orderCreatedPulseTimerRef.current) {
        window.clearTimeout(orderCreatedPulseTimerRef.current);
      }
      orderCreatedPulseTimerRef.current = window.setTimeout(() => {
        setOrderCreatedPulse(false);
      }, 1600);
    } catch (requestError) {
      if (requestError instanceof ApiRequestError && ['OUT_OF_DELIVERY_RANGE', 'CUSTOMER_TOO_FAR_FROM_DELIVERY_ADDRESS', 'CUSTOMER_LOCATION_REQUIRED', 'CUSTOMER_LOCATION_INVALID', 'CUSTOMER_LOCATION_LOW_ACCURACY'].includes(requestError.code || '')) {
        setDeliveryErrorModal(requestError.message);
      } else {
        setError(requestError instanceof Error ? requestError.message : 'No se pudo crear el pedido.');
      }
    } finally {
      setCreatingOrder(false);
      creatingOrderRef.current = false;
    }
  }

  async function handleTransferProofChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0];

    if (!selectedFile) {
      setTransferProofName('');
      setTransferProofSource('');
      return;
    }

    if (!selectedFile.type.startsWith('image/')) {
      setError('Selecciona una imagen valida para el comprobante.');
      setTransferProofName('');
      setTransferProofSource('');
      event.target.value = '';
      return;
    }

    try {
      const proofDataUrl = await convertImageFileToDataUrl(selectedFile, 900, 900, 0.7);
      setTransferProofName(selectedFile.name);
      setTransferProofSource(proofDataUrl);
      setError('');
    } catch (fileError) {
      setError(
        fileError instanceof Error
          ? fileError.message
          : 'No se pudo preparar la imagen del comprobante.'
      );
      setTransferProofName('');
      setTransferProofSource('');
    } finally {
      event.target.value = '';
    }
  }

  function showTransientNotice({
    key,
    title,
    description,
    tone,
    requiresAcknowledgement = false,
    dismissible = true,
    orderId,
    paymentMethod,
    orderReference,
  }: {
    key: string;
    title: string;
    description: string;
    tone: 'success' | 'danger' | 'info';
    requiresAcknowledgement?: boolean;
    dismissible?: boolean;
    orderId?: string;
    paymentMethod?: string;
    orderReference?: string;
  }) {
    if (recentNoticeKeysRef.current.includes(key)) {
      return;
    }

    recentNoticeKeysRef.current = [...recentNoticeKeysRef.current.slice(-19), key];
    setTransientNotice({
      id: key,
      title,
      description,
      tone,
      requiresAcknowledgement,
      dismissible,
      orderId,
      paymentMethod,
      orderReference,
    });

    if (requiresAcknowledgement && typeof window !== 'undefined') {
      window.localStorage.setItem(
        persistentNoticeStorageKey,
        JSON.stringify({
          id: key,
          title,
          description,
          tone,
          requiresAcknowledgement,
          orderId,
          paymentMethod,
          orderReference,
        } satisfies TransientNotice)
      );
    }

    if (transientNoticeTimeoutRef.current) {
      window.clearTimeout(transientNoticeTimeoutRef.current);
    }

    if (!requiresAcknowledgement) {
      transientNoticeTimeoutRef.current = window.setTimeout(() => {
        setTransientNotice((current) => (current?.id === key ? null : current));
      }, 2200);
    }
  }



  return (
    <main
      className="min-h-[100dvh] bg-[var(--menu-bg)] text-neutral-900 transition-colors duration-500 dark:bg-[var(--menu-bg-dark)] dark:text-zinc-100"
      style={{ background: 'var(--menu-bg)', backgroundAttachment: 'fixed' }}
    >
      {/* Pull to refresh indicator */}
      <div
        className={`fixed top-0 left-0 right-0 z-50 flex justify-center pt-2 pointer-events-none transition-opacity ${pullDistance > 0 || isRefreshing ? 'opacity-100' : 'opacity-0'}`}
        style={{ transform: `translateY(${Math.max(0, pullDistance - 40)}px)` }}
      >
        <div className="rounded-full bg-white p-2 shadow-lg border border-black/5 flex items-center justify-center">
          <RefreshCw className={`h-5 w-5 ${isRefreshing ? 'animate-spin' : ''}`} />
        </div>
      </div>

      {transientNotice ? (
        <TransientNoticeBanner
          notice={transientNotice}
          onClose={() => {
            const wasSuspension = transientNotice.id === 'account-suspended' || transientNotice.id === 'account-suspended-v2';
            setTransientNotice(null);
            if (typeof window !== 'undefined') {
              window.localStorage.removeItem(persistentNoticeStorageKey);
              if (wasSuspension) {
                window.localStorage.removeItem(storageKey);
                setToken('');
                setSessionUser(null);
                setShowAuthModal(true);
              }
            }
          }}
          apiBase={apiBase}
          token={token || undefined}
        />
      ) : null}
      <div className="sticky top-0 z-40">
        <header className="border-b border-black/5 bg-[var(--menu-header,#ffffff)] dark:bg-[var(--menu-header-dark,#0c0c0e)] sticky top-0 z-40 shadow-[0_4px_20px_rgba(0,0,0,0.03)] pt-[env(safe-area-inset-top)]">
          <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-4 md:px-6">
            <button
              type="button"
              onClick={() => router.push('/')}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border transition-all border-black/10 bg-white text-neutral-800 shadow-sm hover:bg-neutral-50 dark:bg-neutral-900 dark:border-white/10 dark:text-neutral-200"
              aria-label="Volver al inicio"
            >
              <ChevronLeft className="h-5 w-5" strokeWidth={2.5} />
            </button>

            <div className="min-w-0 flex-1 relative flex items-center">
              {/* SaDeL Logo (visible when at top) */}
              <div className={`transition-all duration-300 ${!isScrolledPastHeader ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'}`}>
                <button
                  type="button"
                  onClick={() => router.push('/')}
                  className="min-w-0 text-left"
                >
                  <SaDelLogo className="h-7 w-auto object-contain md:h-8" />
                  <p className="truncate text-[8px] font-bold uppercase tracking-[0.12em] text-neutral-400 dark:text-neutral-500 md:text-[9px] mt-0.5 leading-none">
                    ¡Pídelo por aquí!
                  </p>
                </button>
              </div>

              {/* Restaurant Name (visible when scrolled) - Centered absolutely over the header */}
              <div className={`absolute inset-0 flex items-center justify-center transition-all duration-300 transform ${isScrolledPastHeader ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'}`}>
                <p className="text-base md:text-lg font-bold tracking-tight text-neutral-950 dark:text-white truncate max-w-[200px] sm:max-w-xs md:max-w-md">{restaurant?.name || 'Cargando...'}</p>
              </div>
            </div>

            {isAuthReady && !token && (
              <button
                type="button"
                onClick={() => setShowAuthModal(true)}
                className="relative inline-flex h-11 w-11 items-center justify-center rounded-full border transition-all overflow-hidden active:scale-95 active-scale border-black/10 bg-white text-neutral-800 shadow-sm hover:bg-neutral-50 dark:bg-neutral-900 dark:border-white/10 dark:text-neutral-200"
                aria-label="Iniciar sesión"
              >
                <User className="h-5 w-5" />
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsCartOpen(true)}
              className={`relative inline-flex h-11 w-11 items-center justify-center rounded-full border transition-all border-black/10 bg-white text-neutral-800 shadow-sm hover:bg-neutral-50 dark:bg-neutral-900 dark:border-white/10 dark:text-neutral-200 ${
                cartJustUpdated ? 'scale-110 ring-4 ring-[#06c167]/20' : ''
              } ${cart.length > 0 ? 'animate-[pulse_2s_ease-in-out_infinite]' : ''}`}
              aria-label="Abrir carrito"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h2l.4 2M7 14h10l4-8H5.4M7 14l-1.5 2.5A1 1 0 006.4 18H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              {cart.length > 0 && !isCartOpen ? (
                 <span className={`absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-sky-500 px-1 text-[11px] font-bold text-white shadow-sm ${
                  cartJustUpdated ? 'animate-pulse' : ''
                }`}>
                  {totalProducts}
                </span>
              ) : null}
            </button>
          </div>
        </header>
      </div>

    {activeOrderListItems.length > 0 ? (
        <div className="border-b border-black/5 bg-white">
            <div className="mx-auto max-w-7xl px-4 py-4 md:px-6">
              <div className="relative">
              
              {/* Chevron Izquierdo */}
              {activeOrderListItems.length > 1 && (
                <button
                  type="button"
                  onClick={() => setCarouselIndex((prev) => (prev > 0 ? prev - 1 : activeOrderListItems.length - 1))}
                  className="absolute -left-3 md:-left-5 top-1/2 -translate-y-1/2 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-black/10 bg-white/90 text-neutral-800 shadow-md backdrop-blur transition hover:bg-neutral-50 active:scale-95 active-scale"
                  aria-label="Pedido anterior"
                >
                  <ChevronLeft className="h-4 w-4" strokeWidth={2.5} />
                </button>
              )}

              {/* Contenedor del Banner */}
              <div className={`transition-all duration-300 ${orderCreatedPulse ? 'animate-order-heartbeat' : ''}`}>
                {activeOrder && (
                  <CompactActiveOrderBanner
                    order={activeOrder}
                    onOpenHistory={() => {
                      setSelectedOrderId(activeOrder.id);
                      setIsDetailModalOpen(true);
                    }}
                    onOpenChat={() => {
                      setSelectedOrderId(activeOrder.id);
                      setIsChatOpen(true);
                      void loadChatMessages(activeOrder.id);
                    }}
                    unreadCount={unreadMessagesMap[activeOrder.id] || 0}
                    isTrackingEnabled={isTrackingEnabled}
                    setIsTrackingEnabled={(val) => {
                      if (!val) setDriverLocation(null);
                      setIsTrackingEnabled(val);
                    }}
                    driverLocation={driverLocation}
                  />
                )}
              </div>

              {/* Chevron Derecho */}
              {activeOrderListItems.length > 1 && (
                <button
                  type="button"
                  onClick={() => setCarouselIndex((prev) => (prev < activeOrderListItems.length - 1 ? prev + 1 : 0))}
                  className="absolute -right-3 md:-right-5 top-1/2 -translate-y-1/2 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-black/10 bg-white/90 text-neutral-800 shadow-md backdrop-blur transition hover:bg-neutral-50 active:scale-95 active-scale"
                  aria-label="Siguiente pedido"
                >
                  <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
                </button>
              )}
            </div>

            {/* Puntos Indicadores */}
            {activeOrderListItems.length > 1 && (
              <div className="mt-3 flex items-center justify-center gap-1.5">
                {activeOrderListItems.map((item, idx) => {
                  const isActive = idx === carouselIndex;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setCarouselIndex(idx)}
                      className={`h-1.5 rounded-full transition-all duration-300 ${
                        isActive 
                          ? 'w-4 bg-neutral-900 shadow-sm' 
                          : 'w-1.5 bg-neutral-300 hover:bg-neutral-400'
                      }`}
                      aria-label={`Ir al pedido ${idx + 1}`}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
    ) : null}

        {/* Modal de Personalización de Producto (Uber Eats / Rappi Style) */}
        {customizingProduct && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md px-4 py-6" onClick={() => setCustomizingProduct(null)}>
            <div className="relative bg-white dark:bg-neutral-900 rounded-[32px] overflow-hidden shadow-2xl flex flex-col w-full max-w-2xl max-h-[90vh] border border-black/5 dark:border-zinc-800 animate-fade-in" onClick={(e) => e.stopPropagation()}>
              
              {/* Botón de Cerrar */}
              <button
                type="button"
                onClick={() => setCustomizingProduct(null)}
                className="absolute top-4 right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/40 hover:bg-black/60 text-white backdrop-blur transition shadow-md"
                aria-label="Cerrar personalización"
              >
                <X className="h-5 w-5" strokeWidth={2.5} />
              </button>

              {/* Imagen y Detalles del Producto */}
              <div className="overflow-y-auto flex-1">
                {customizingProduct.image ? (
                  <div className="relative h-64 w-full bg-neutral-100 dark:bg-neutral-950 overflow-hidden">
                    <img src={customizingProduct.image} className="w-full h-full object-cover" alt={customizingProduct.name} loading="lazy" decoding="async" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent"></div>
                    <div className="absolute bottom-6 left-6 right-6 text-white">
                      <h3 className="text-2xl font-bold tracking-[-0.03em]">{customizingProduct.name}</h3>
                      <p className="mt-1 text-sm text-neutral-200 leading-relaxed max-w-md">{customizingProduct.description}</p>
                    </div>
                  </div>
                ) : (
                  <div className="p-6 pb-4 border-b border-black/5 dark:border-zinc-800 dark:bg-neutral-950">
                    <h3 className="text-2xl font-bold text-neutral-950 dark:text-white tracking-[-0.03em]">{customizingProduct.name}</h3>
                    <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed max-w-md">{customizingProduct.description}</p>
                  </div>
                )}

                {/* Grupos de Modificadores */}
                <div className="divide-y divide-black/5 dark:divide-zinc-800">
                  {(customizingProduct.optionGroups || []).map((group: any) => {
                    const selected = selectedOptionsForProduct[group.id] || [];
                    const isRequired = group.minSelection > 0;
                    const isLimitReached = selected.length >= group.maxSelection;
                    const isRequirementMet = selected.length >= group.minSelection && selected.length <= group.maxSelection;

                    return (
                      <div key={group.id} className="p-6">
                        <div className="flex items-start justify-between gap-4 mb-4">
                          <div>
                            <h4 className="font-semibold text-neutral-950 dark:text-white text-base">
                              {group.name}
                            </h4>
                            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400 font-medium">
                              {isRequired
                                ? `Obligatorio · Elige de ${group.minSelection} a ${group.maxSelection} opciones`
                                : `Opcional · Elige hasta ${group.maxSelection} opciones`
                              }
                            </p>
                          </div>
                          <div>
                            {isRequired ? (
                              <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
                                isRequirementMet
                                  ? 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400'
                                  : 'bg-sky-100 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400'
                              }`}>
                                {isRequirementMet ? 'Listo' : 'Faltan datos'}
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded-full bg-neutral-100 dark:bg-neutral-800 px-2.5 py-1 text-xs font-semibold text-neutral-600 dark:text-neutral-300">
                                Opcional
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="space-y-2">
                          {(group.options || []).map((opt: any) => {
                            const isChecked = selected.some((o) => o.id === opt.id);
                            const isSingleSelection = group.maxSelection === 1;
                            const isSelectionDisabled = isLimitReached && !isChecked && !isSingleSelection;

                            return (
                              <button
                                key={opt.id}
                                type="button"
                                disabled={!opt.isAvailable || isSelectionDisabled}
                                onClick={() => {
                                  if (isSingleSelection) {
                                    handleSelectRadioOption(group, opt);
                                  } else {
                                    handleToggleCheckboxOption(group, opt);
                                  }
                                }}
                                className={`flex w-full items-center justify-between gap-4 rounded-2xl border p-4 text-left transition ${
                                  isChecked
                                    ? 'border-sky-400/30 bg-sky-100/40 dark:bg-sky-900/10'
                                    : 'border-black/5 dark:border-zinc-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/40'
                                } ${(!opt.isAvailable || isSelectionDisabled) ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                              >
                                <div className="flex items-center gap-3">
                                  {isSingleSelection ? (
                                    <div className={`flex h-5 w-5 items-center justify-center rounded-full border transition ${
                                      isChecked
                                        ? 'border-sky-500 bg-sky-500 text-white'
                                        : 'border-black/20 dark:border-zinc-700 bg-white dark:bg-neutral-800'
                                    }`}>
                                      {isChecked && <div className="h-2 w-2 rounded-full bg-white" />}
                                    </div>
                                  ) : (
                                    <div className={`flex h-5 w-5 items-center justify-center rounded-lg border transition ${
                                      isChecked
                                        ? 'border-sky-500 bg-sky-500 text-white'
                                        : 'border-black/20 dark:border-zinc-700 bg-white dark:bg-neutral-800'
                                    }`}>
                                      {isChecked && (
                                        <Check className="h-3.5 w-3.5" strokeWidth={3} />
                                      )}
                                    </div>
                                  )}
                                  <div>
                                    <p className="font-semibold text-neutral-900 dark:text-neutral-100 text-sm">
                                      {opt.name}
                                    </p>
                                    {!opt.isAvailable && (
                                      <p className="mt-0.5 text-xs text-rose-500 font-semibold">Agotado</p>
                                    )}
                                  </div>
                                </div>
                                {opt.price > 0 && (
                                  <span className="text-sm font-semibold text-neutral-600 dark:text-neutral-300">
                                    + {formatCurrency(opt.price)}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}

                  {customizingProduct.sellBy === 'WEIGHT' && (() => {
                    const minG = customizingProduct.minWeightG || 100;
                    const maxG = customizingProduct.maxWeightG || 5000;
                    const stepG = customizingProduct.stepWeightG || 100;
                    let presets: number[] = [];
                    if (customizingProduct.weightPresets) {
                      if (Array.isArray(customizingProduct.weightPresets)) {
                        presets = customizingProduct.weightPresets;
                      } else if (typeof customizingProduct.weightPresets === 'string') {
                        try { presets = JSON.parse(customizingProduct.weightPresets); } catch {}
                      }
                    }
                    if (presets.length === 0) presets = [100, 200, 300, 500, 1000];

                    return (
                      <div className="p-6">
                        <label className="text-sm text-neutral-600 font-semibold mb-3 block">Peso</label>
                        <div className="flex flex-wrap gap-2 mb-4">
                          {presets.map((p) => (
                            <button
                              key={p}
                              type="button"
                              onClick={() => setCustomizingWeight(p)}
                              className={`rounded-full border px-4 py-2 text-sm font-semibold transition-all ${
                                customizingWeight === p
                                  ? 'border-sky-400 bg-sky-50 text-sky-600'
                                  : 'border-black/5 bg-white text-neutral-600 hover:bg-neutral-50'
                              }`}
                            >
                              {p >= 1000 ? `${p / 1000}kg` : `${p}g`}
                            </button>
                          ))}
                        </div>
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            disabled={customizingWeight <= minG}
                            onClick={() => setCustomizingWeight(w => Math.max(minG, w - stepG))}
                            className={`flex h-10 w-10 items-center justify-center rounded-full border text-lg text-neutral-600 transition ${
                              customizingWeight <= minG
                                ? 'border-black/5 opacity-30 cursor-not-allowed'
                                : 'border-black/5 hover:bg-neutral-50'
                            }`}
                          >
                            -
                          </button>
                          <div className="flex-1 relative">
                            <input
                              type="number"
                              min={minG}
                              max={maxG}
                              step={stepG}
                              value={customizingWeight}
                              onChange={(e) => {
                                const v = parseInt(e.target.value) || minG;
                                setCustomizingWeight(Math.max(minG, Math.min(maxG, v)));
                              }}
                              className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-center text-lg font-bold text-neutral-950 outline-none"
                            />
                            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-neutral-400">gramos</span>
                          </div>
                          <button
                            type="button"
                            disabled={customizingWeight >= maxG}
                            onClick={() => setCustomizingWeight(w => Math.min(maxG, w + stepG))}
                            className={`flex h-10 w-10 items-center justify-center rounded-full border text-lg text-neutral-600 transition ${
                              customizingWeight >= maxG
                                ? 'border-black/5 opacity-30 cursor-not-allowed'
                                : 'border-black/5 hover:bg-neutral-50'
                            }`}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Notas Especiales */}
                  <div className="p-6">
                    <label className="grid gap-2 text-sm text-neutral-600 dark:text-neutral-400 font-semibold">
                      <span>¿Alguna indicación especial?</span>
                      <input
                        value={customizingInstructions}
                        onChange={(e) => setCustomizingInstructions(e.target.value)}
                        placeholder="Ej. Salsa aparte, sin cebolla, bien tostado..."
                        className="rounded-2xl border border-black/10 dark:border-zinc-800 bg-white dark:bg-neutral-800 px-4 py-3 text-neutral-950 dark:text-white outline-none transition placeholder:text-neutral-400 focus:border-black/20"
                      />
                    </label>
                  </div>
                </div>
              </div>

              {/* Footer con Sumatorias */}
              <div className="border-t border-black/5 dark:border-zinc-800 bg-white/95 dark:bg-neutral-900/95 backdrop-blur px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4 sticky bottom-0 z-10 pb-[calc(1rem+env(safe-area-inset-bottom))]">
                {/* Selector de Cantidad */}
                <div className="flex items-center gap-2 rounded-full border border-black/5 dark:border-zinc-800 bg-neutral-50 dark:bg-neutral-950 px-3 py-1.5 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setCustomizingQuantity(q => Math.max(1, q - 1))}
                    className="flex h-9 w-9 items-center justify-center rounded-full text-lg text-neutral-700 dark:text-neutral-300 transition hover:bg-neutral-200 dark:hover:bg-neutral-800"
                  >
                    -
                  </button>
                  <span className="min-w-[2rem] text-center text-sm font-semibold text-neutral-950 dark:text-white">
                    {customizingQuantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCustomizingQuantity(q => Math.max(1, Math.min(q + 1, getProductAvailability(customizingProduct).tracked ? getProductAvailability(customizingProduct).maxQty : q + 1)))}
                    disabled={getProductAvailability(customizingProduct).tracked && customizingQuantity >= getProductAvailability(customizingProduct).maxQty}
                    className="flex h-9 w-9 items-center justify-center rounded-full text-lg text-neutral-700 dark:text-neutral-300 transition hover:bg-neutral-200 dark:hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    +
                  </button>
                </div>

                {/* Botón de Confirmación */}
                {(() => {
                  const isWeightProduct = customizingProduct.sellBy === 'WEIGHT';
                  const basePrice = isWeightProduct
                    ? (customizingProduct.unitPrice || 0) * customizingWeight / 1000
                    : (customizingProduct.discountPrice ? toMoney(customizingProduct.discountPrice) : toMoney(customizingProduct.price));
                  const selectedOptions = Object.values(selectedOptionsForProduct).flatMap(o => o);
                  const extraPrice = selectedOptions.reduce((s, o) => s + toMoney(o.price), 0);
                  const totalItemPrice = (basePrice + extraPrice) * customizingQuantity;

                  const isMissingRequired = (customizingProduct.optionGroups || []).some((group: any) => {
                    const selected = selectedOptionsForProduct[group.id] || [];
                    return selected.length < group.minSelection;
                  });

                  return (
                    <button
                      type="button"
                      disabled={isMissingRequired}
                      onClick={addCustomizedItemToCart}
                      className="flex-1 w-full rounded-full bg-neutral-950 dark:bg-white text-white dark:text-neutral-950 font-bold py-4 px-6 shadow-lg transition duration-200 flex items-center justify-between gap-4 disabled:bg-neutral-300 dark:disabled:bg-neutral-800 dark:disabled:text-neutral-500 disabled:cursor-not-allowed active:scale-98"
                    >
                      <span>{isMissingRequired ? 'Elige las opciones obligatorias' : 'Agregar al carrito'}</span>
                      {!isMissingRequired && (
                        <span className="bg-white/10 dark:bg-black/10 px-3 py-1 rounded-lg text-sm font-semibold">
                          {formatCurrency(totalItemPrice)}
                        </span>
                      )}
                    </button>
                  );
                })()}
              </div>

            </div>
          </div>
        )}

        {/* Modal de Calificación */}
        {isRatingModalOpen && (() => {
          const ratingOrder = orderToRate ? activeOrderDetailsMap[orderToRate] || null : null;
          const isPickupRating = ratingOrder ? (ratingOrder as any)?.fulfillmentType === 'PICKUP' : ratingIsPickup;
          const bizType = ratingOrder?.restaurant?.businessType || ratingBusinessType;
          return (
            <RatingModal
              open
              isPickup={isPickupRating}
              bizType={bizType}
              restaurantRating={restaurantRating}
              onRestaurantRatingChange={setRestaurantRating}
              driverRating={driverRatingVal}
              onDriverRatingChange={setDriverRatingVal}
              submitting={isSubmittingRating}
              onSkip={() => {
                if (orderToRate) {
                  try {
                    localStorage.setItem(`sadel_dismissed_rating_${orderToRate}`, 'true');
                  } catch (e) {}
                  setActiveOrderListItems((prev) => prev.filter((o) => o.id !== orderToRate));
                  setActiveOrderDetailsMap((prev) => {
                    const next = { ...prev };
                    delete next[orderToRate];
                    return next;
                  });
                }
                setIsRatingModalOpen(false);
                setRestaurantRating(0);
                setDriverRatingVal(0);
                setRatingIsPickup(false);
                setOrderToRate(null);
              }}
              onSubmit={async () => {
                if (!orderToRate || isSubmittingRating) return;
                setIsSubmittingRating(true);
                try {
                  const result = await submitReview({
                    apiBase,
                    storageKey,
                    orderId: orderToRate,
                    payload: {
                      rating: restaurantRating,
                      ...(isPickupRating ? {} : { driverRating: driverRatingVal || undefined }),
                    },
                    getUser: () => sessionUser,
                    onTokenRefreshed: (newToken) => setToken(newToken),
                  });
                  if (result.ok) {
                    showTransientNotice({ key: 'rating-submitted', title: '¡Gracias!', description: 'Tu calificación nos ayuda a mejorar.', tone: 'success' });
                  } else {
                    showTransientNotice({ key: 'rating-error', title: 'Error', description: result.message || 'No se pudo guardar tu calificación.', tone: 'danger' });
                  }
                  if (orderToRate) {
                    setActiveOrderListItems((prev) => prev.filter((o) => o.id !== orderToRate));
                    setActiveOrderDetailsMap((prev) => {
                      const next = { ...prev };
                      delete next[orderToRate];
                      return next;
                    });
                  }
                  setIsRatingModalOpen(false);
                  setRestaurantRating(0);
                  setDriverRatingVal(0);
                  setRatingIsPickup(false);
                  setOrderToRate(null);
                } finally {
                  setIsSubmittingRating(false);
                }
              }}
            />
          );
        })()}

        {/* Modal PERSISTENTE de cancelación por el restaurante (con motivo) */}
        {cancelledOrderNotice && (
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 backdrop-blur-sm px-4 py-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancelled-order-title"
          >
            <div className="relative w-full max-w-[460px] overflow-hidden rounded-[28px] border border-black/5 bg-white p-6 shadow-[0_32px_110px_rgba(15,15,15,0.35)]">
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-rose-100 bg-rose-50 text-rose-600">
                  <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <path d="m15 9-6 6m0-6 6 6" />
                  </svg>
                </div>
                <h3 id="cancelled-order-title" className="text-xl font-bold tracking-tight text-neutral-950">
                  Pedido cancelado
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-neutral-500">
                  {cancelledOrderNotice.restaurant?.name || 'El restaurante'} canceló tu pedido{' '}
                  <strong className="text-neutral-800">{cancelledOrderNotice.orderReference}</strong>.
                </p>

                {cancelledOrderNotice.cancellationReason && (
                  <div className="mt-4 rounded-2xl border border-amber-100/70 bg-amber-50/80 p-4 text-left">
                    <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-amber-600">Motivo de la cancelación</p>
                    <p className="text-sm font-semibold leading-relaxed text-amber-900">
                      {cancelledOrderNotice.cancellationReason}
                    </p>
                  </div>
                )}

                {cancelledOrderNotice.paymentMethod === 'TRANSFER' && (
                  <p className="mt-4 text-xs leading-relaxed text-neutral-500">
                    Si realizaste una transferencia, el reembolso se gestionará automáticamente.
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => {
                    try { localStorage.setItem(`sadel_cancel_ack_${cancelledOrderNotice.id}`, 'true'); } catch { /* noop */ }
                    setCancelledOrderNotice(null);
                  }}
                  className="mt-6 w-full rounded-full bg-neutral-950 py-3.5 text-sm font-bold text-white shadow-md transition hover:bg-neutral-800 active:scale-95"
                >
                  Entendido
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal de pedido listo para recoger (pickup) */}
        {pickupReadyOrder && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm px-4 py-6" onClick={() => setPickupReadyOrder(null)}>
            <div
              className="bg-white rounded-3xl border border-black/[0.03] shadow-[0_20px_50px_rgba(0,0,0,0.15)] p-7 w-full max-w-md h-fit max-h-[90vh] overflow-y-auto relative transition-all"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-center mb-6">
                <div className="w-20 h-20 bg-emerald-200 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-emerald-100 shadow-inner">
                  <span className="text-4xl"><svg className="h-10 w-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" /></svg></span>
                </div>
                <h3 className="text-2xl font-black text-neutral-950 tracking-tight">¡Tu pedido está listo!</h3>
                <p className="text-sm text-neutral-500 mt-1">Pasa por tu pedido a {pickupReadyOrder.restaurant.name}.</p>
                {pickupReadyOrder.dailyCounter && (
                  <p className="text-xs font-bold text-neutral-400 mt-2">
                    Pedido #{String(pickupReadyOrder.dailyCounter).padStart(3, '0')}
                  </p>
                )}
              </div>

              <div className="space-y-4">
                {/* Total a pagar */}
                <div className="p-5 rounded-2xl bg-emerald-50/40 border border-emerald-100/50">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider">
                        {pickupReadyOrder.paymentMethod === 'CASH' ? 'Total a pagar en sucursal' : 'Total del pedido'}
                      </p>
                      <p className="text-3xl font-black text-neutral-900 mt-1">
                        {formatCurrency(pickupReadyOrder.totalAmount)}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                        pickupReadyOrder.paymentMethod === 'CASH'
                          ? 'bg-amber-100 text-amber-800 border border-amber-200'
                          : pickupReadyOrder.paymentMethod === 'TRANSFER'
                            ? 'bg-sky-100 text-sky-700 border border-sky-200'
                            : 'bg-green-100 text-green-800 border border-green-200'
                      }`}>
                        {pickupReadyOrder.paymentMethod === 'CASH' ? <><svg className="h-3.5 w-3.5 inline-block align-text-bottom" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> Efectivo</> : pickupReadyOrder.paymentMethod === 'TRANSFER' ? <><svg className="h-3.5 w-3.5 inline-block align-text-bottom" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" /></svg> Transferencia</> : '💳 Pago Online'}
                      </span>
                      <p className="text-[10px] text-neutral-400 mt-1.5 font-medium">
                        {pickupReadyOrder.paymentMethod === 'CASH' ? 'Paga al recoger' : 'Ya pagado'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* PIN de recolección */}
                {pickupReadyOrder.pickupPin && (
                  <div className="p-5 rounded-2xl bg-emerald-50/60 border border-emerald-200/60 text-center">
                    <p className="text-[10px] font-semibold text-emerald-600 uppercase tracking-widest">PIN de recolección</p>
                    <p className="text-4xl font-extrabold tracking-[0.25em] text-emerald-900 font-mono mt-2 mb-1.5">
                      {pickupReadyOrder.pickupPin}
                    </p>
                    <p className="text-[11px] text-neutral-500 leading-relaxed">
                      Proporciona este PIN al restaurante para recoger tu pedido.
                    </p>
                  </div>
                )}

                {/* Cómo llegar */}
                {pickupReadyOrder.restaurant.latitude && pickupReadyOrder.restaurant.longitude && (
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${pickupReadyOrder.restaurant.latitude},${pickupReadyOrder.restaurant.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-2.5 rounded-full border-2 border-sky-200 bg-sky-50 py-3.5 text-sm font-bold text-sky-600 shadow-sm transition hover:bg-sky-100 hover:shadow-md active:scale-[0.97]"
                  >
                    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Cómo llegar al restaurante
                  </a>
                )}
              </div>

              <div className="mt-6">
                <button
                  type="button"
                  onClick={() => setPickupReadyOrder(null)}
                  className="w-full rounded-full bg-neutral-950 text-white py-3.5 text-sm font-bold shadow-md transition hover:bg-neutral-800 active:scale-95"
                >
                  Entendido
                </button>
              </div>
            </div>
          </div>
        )}

      {scheduleProposalOrder && (
        <ScheduleProposalModal
          order={scheduleProposalOrder}
          apiBase={apiBase}
          token={token}
          formatCurrency={formatCurrency}
          onClose={() => setScheduleProposalOrder(null)}
          showNotice={showTransientNotice}
          onAccepted={() => {
            window.dispatchEvent(new CustomEvent('order-updated'));
          }}
          onRejected={() => {
            window.dispatchEvent(new CustomEvent('order-updated'));
          }}
        />
      )}

      <CartDrawer
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        onProceedToCheckout={() => {
          setIsCartOpen(false);
          if (!token) {
            setShowAuthModal(true);
          } else {
            setIsCheckoutOpen(true);
          }
        }}
        fulfillmentType={fulfillmentType}
        onFulfillmentTypeChange={handleFulfillmentChange}
        isRestaurantOpen={restaurant?.isOpen}
        overrideServiceFee={serviceFee}
        overrideDeliveryFee={deliveryFee}
        pickupOnly={restaurant?.pickupOnly === true}
        freeDeliveryThreshold={restaurant?.promoFreeDeliveryThreshold ?? null}
      />

      <div className={`fixed inset-0 z-50 transition-opacity duration-300 ${isCheckoutOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={() => setIsCheckoutOpen(false)} />
        <div
          ref={checkoutRef}
          className={`absolute right-0 top-0 flex h-full w-full max-w-[580px] flex-col overflow-hidden bg-[#faf9f6] shadow-[0_0_0_1px_rgba(0,0,0,0.04),0_40px_100px_rgba(15,15,15,0.25)] sm:rounded-l-[36px] transition-all duration-[350ms] ease-[cubic-bezier(0.16,1,0.3,1)] lg:inset-x-auto lg:left-1/2 lg:top-1/2 lg:h-fit lg:max-h-[92vh] lg:w-full lg:max-w-4xl lg:rounded-[32px] ${isCheckoutOpen ? 'translate-x-0 opacity-100 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:scale-100' : 'translate-x-full opacity-100 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:scale-95 lg:opacity-0'}`}
        >
            <section className="flex h-full flex-col">
              {/* ── Header ── */}
              <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-black/[0.04] bg-white px-5 py-4 sm:px-6">
                <div className="flex items-center gap-3.5">
                  <div className="relative flex h-12 w-12 items-center justify-center rounded-[18px] bg-gradient-to-br from-[var(--accent)] to-[var(--accent-strong)] text-white shadow-lg shadow-accent/25">
                    <ClipboardCheck className="h-5 w-5" strokeWidth={1.8} />
                    {totalProducts > 0 && !isCheckoutOpen && (
                      <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-neutral-900 px-1 text-[10px] font-bold text-white shadow-md">
                        {totalProducts}
                      </span>
                    )}
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-neutral-400">Finalizar</p>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-bold tracking-[-0.03em] text-neutral-950">Confirmar pedido</h2>
                      {isPickupOnly ? (
                        <span className="rounded-full bg-[var(--accent-soft-strong)] px-2.5 py-0.5 text-[10px] font-bold text-[var(--accent-strong)] ring-1 ring-[var(--accent-soft-strong)]">
                          <ShoppingBag className="h-3 w-3 inline-block align-text-bottom" strokeWidth={1.5} /> Solo recoger
                        </span>
                      ) : fulfillmentType === 'PICKUP' ? (
                        <span className="rounded-full bg-[var(--accent-soft-strong)] px-2.5 py-0.5 text-[10px] font-bold text-[var(--accent-strong)] ring-1 ring-[var(--accent-soft-strong)]">
                          <Store className="h-3 w-3 inline-block align-text-bottom" strokeWidth={1.5} /> Recoger
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-300/50">
                          <Bike className="h-3 w-3 inline-block align-text-bottom" strokeWidth={1.5} /> Envío
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCheckoutOpen(false)}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 transition-all hover:bg-neutral-200 hover:text-neutral-700 active:scale-90"
                  aria-label="Cerrar checkout"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-4 pb-8 pt-5 sm:px-5 lg:px-6">
                {/* Desktop: formulario (izq.) + pago (der.). Móvil: columna única. */}
                <div className="space-y-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-5 lg:space-y-0 xl:gap-6">
                  <div className="space-y-4">

                  {fulfillmentType === 'PICKUP' ? (
                    <div className="rounded-[22px] border border-black/[0.04] bg-white p-3 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                      <div className="mb-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-50">
                            <Store className="h-3 w-3 text-[var(--accent)]" strokeWidth={1.5} />
                          </div>
                          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-neutral-400">
                            Recoger en
                          </p>
                        </div>
                        <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[9px] font-bold text-[var(--accent)]">
                          Paso 1
                        </span>
                      </div>
                      <div className="overflow-hidden rounded-2xl border border-black/[0.04] bg-gradient-to-br from-white to-neutral-50/80 shadow-sm">
                        <div className="p-4 pb-0">
                          <div className="flex items-start gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--accent)] to-[var(--accent-strong)] shadow-sm shadow-[0_2px_8px_var(--accent-soft)]">
                              <Store className="h-5 w-5 text-white" strokeWidth={1.5} />
                            </div>
                            <div className="min-w-0 flex-1 pt-0.5">
                              <p className="text-[14px] font-bold leading-tight text-neutral-900">
                                {restaurant?.name || 'Restaurante'}
                              </p>
                              {restaurant?.address && (
                                <p className="mt-0.5 text-[12px] leading-relaxed text-neutral-500 line-clamp-1">
                                  {restaurant.address}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="px-4 pb-4">
                          <div className="mt-2 flex items-center gap-2 rounded-xl bg-amber-50/80 px-3 py-2.5">
                            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-100">
                              <Clock className="h-3 w-3 text-amber-700" strokeWidth={1.5} />
                            </div>
                            <p className="text-[11px] font-medium leading-snug text-amber-700">
                              Te avisaremos cuando esté listo
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                  /* ── PASO 1 (DELIVERY): DIRECCIÓN DE ENTREGA ── */
                  <div className="rounded-[22px] border border-black/[0.04] bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                    <div className="mb-4 flex items-center justify-between border-b border-black/[0.05] pb-3">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)] text-[11px] font-black text-white">1</span>
                        <div>
                          <h3 className="text-[13px] font-bold tracking-tight text-neutral-900">Dirección de entrega</h3>
                          <p className="text-[11px] font-medium text-neutral-500 dark:text-zinc-400">¿A dónde enviamos tu pedido?</p>
                        </div>
                      </div>
                    </div>

                    {/* Modo: Mostrando Direcciones Guardadas */}
                    {addresses.length > 0 && !isAddingNewAddress && (
                      <div className="space-y-3.5">
                        {/* Selector Horizontal Premium */}
                        <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-none">
                          {addresses.map((addr) => {
                            const isSelected = selectedAddressId === addr.id;
                            return (
                              <button
                                key={addr.id}
                                type="button"
                                onClick={() => {
                                  setSelectedAddressId(addr.id);
                                  const target = addr;
                                  setCheckoutForm((current) => ({
                                    ...current,
                                    street: target.street || '',
                                    number: target.number || '',
                                    neighborhood: target.neighborhood || '',
                                    city: target.city || '',
                                    state: target.state || '',
                                    zipCode: target.zipCode || '',
                                    latitude: String(target.latitude),
                                    longitude: String(target.longitude),
                                  }));
                                }}
                                className={`relative flex w-64 shrink-0 flex-col rounded-2xl border p-3.5 text-left transition-all ${
                                  isSelected
                                    ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--menu-accent)_7%,white)] ring-2 ring-[var(--accent)]/35'
                                    : 'border-black/[0.08] bg-white opacity-95 hover:border-black/20 hover:opacity-100'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                                    {addr.isDefault ? <><Home className="h-3 w-3 inline-block align-text-bottom" strokeWidth={1.5} /> Casa (Principal)</> : <><MapPin className="h-3 w-3 inline-block align-text-bottom" strokeWidth={1.5} /> Dirección</>}
                                  </span>
                                  {isSelected && (
                                    <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[var(--accent)] text-white">
                                      <Check className="h-3 w-3" strokeWidth={3} />
                                    </span>
                                  )}
                                </div>
                                <p className="mt-2 text-sm font-bold text-neutral-900 truncate">
                                  {addr.street} {addr.number}
                                </p>
                                <p className="text-xs text-neutral-500 truncate mt-0.5">
                                  {addr.neighborhood || 'Sin colonia'}, {addr.city || 'Sin ciudad'}
                                </p>
                              </button>
                            );
                          })}

                          {/* Botón rápido para agregar otra dirección */}
                          <button
                            type="button"
                            onClick={() => {
                              setIsAddingNewAddress(true);
                              setNewAddressStep('search');
                              setAddressSearchQuery('');
                              setAddressSuggestions([]);
                              setSelectedAddressId(null);
                              setCheckoutForm((current) => ({
                                ...current,
                                street: '',
                                number: '',
                                neighborhood: '',
                                city: '',
                                state: '',
                                zipCode: '',
                                latitude: '19.4326',
                                longitude: '-99.1332',
                              }));
                            }}
                            className="flex w-32 shrink-0 flex-col items-center justify-center rounded-2xl border border-dashed border-sky-200 bg-sky-50/20 p-3.5 text-center transition-all hover:bg-sky-50/50"
                          >
                            <span className="text-xl text-[var(--accent)] font-bold">+</span>
                            <span className="text-xs font-bold text-[var(--accent)] mt-0.5">Nueva</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Modo: Sin direcciones guardadas */}
                    {addresses.length === 0 && !isAddingNewAddress && (
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={() => {
                            setIsAddingNewAddress(true);
                            setNewAddressStep('search');
                            setAddressSearchQuery('');
                            setAddressSuggestions([]);
                            setSelectedAddressId(null);
                            setCheckoutForm((current) => ({
                              ...current,
                              street: '',
                              number: '',
                              neighborhood: '',
                              city: '',
                              state: '',
                              zipCode: '',
                              latitude: '19.4326',
                              longitude: '-99.1332',
                            }));
                          }}
                          className="w-full rounded-2xl border border-[var(--accent)] bg-sky-50 px-4 py-4 text-sm font-bold text-[var(--accent-strong)] transition-all active-scale hover:bg-[var(--accent-soft-strong)]/50 shadow-sm flex items-center justify-center gap-2"
                        >
                          <CirclePlus className="h-4 w-4" strokeWidth={1.5} /> Agregar dirección de entrega
                        </button>
                      </div>
                    )}

                    {/* Mapa: oculto por defecto; el usuario decide verlo */}
                    {!isAddingNewAddress && addresses.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowMapForAddress((v) => (v ? null : selectedAddressId || 'checkout-form'))}
                        className={`mt-3 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-all active:scale-95 ${
                          showMapForAddress
                            ? 'border-[var(--accent)] bg-[var(--accent)] text-white shadow-sm shadow-[0_4px_14px_var(--accent-soft)]'
                            : 'border-sky-200 bg-sky-50/60 text-[var(--accent)] hover:bg-[var(--accent-soft-strong)]'
                        }`}
                      >
                        <Map className="h-3.5 w-3.5" strokeWidth={1.5} />
                        {showMapForAddress ? 'Ocultar mapa' : 'Ver mapa de entrega'}
                      </button>
                    )}

                    {/* Referencias del domicilio (solo direcciones guardadas) */}
                    {!isAddingNewAddress && (
                      <div className="mt-4">
                        <Field 
                          label="Referencias del domicilio" 
                          value={checkoutForm.reference} 
                          onChange={(value) => setCheckoutForm((current) => ({ ...current, reference: value }))} 
                        />
                      </div>
                    )}

                    {/* Modo: Flujo de Agregar Nueva Dirección */}
                    {isAddingNewAddress && (
                      <div className="space-y-4">
                        {newAddressStep === 'search' ? (
                          <div className="space-y-3">
                            <div className="relative">
                              <label className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">Buscar dirección de entrega</label>
                              <div className="mt-1.5 relative">
                                <input
                                  type="text"
                                  placeholder="Escribe calle, número y colonia..."
                                  value={addressSearchQuery}
                                  onChange={(e) => {
                                    setAddressSearchQuery(e.target.value);
                                    void searchAddress(e.target.value, setAddressSuggestions, setIsSearchingAddress);
                                  }}
                                  className="w-full rounded-2xl border border-black/10 bg-white p-3.5 text-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-sky-300/20 pr-10 shadow-sm transition-all placeholder:text-neutral-400"
                                />
                                {isSearchingAddress ? (
                                  <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
                                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-200 border-t-sky-500" />
                                  </div>
                                ) : addressSearchQuery ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setAddressSearchQuery('');
                                      setAddressSuggestions([]);
                                    }}
                                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 transition-colors"
                                  >
                                    ✕
                                  </button>
                                ) : null}
                              </div>

                              {addressSuggestions.length > 0 && (
                                <div className="absolute z-[999] mt-2 w-full rounded-2xl border border-black/5 bg-white shadow-xl overflow-hidden transition-all duration-200">
                                  {addressSuggestions.map((suggestion, idx) => (
                                    <button
                                      key={idx}
                                      type="button"
                                      onClick={() => {
                                        handleSelectSuggestion(
                                          suggestion,
                                          setCheckoutForm,
                                          setAddressSearchQuery,
                                          setAddressSuggestions,
                                          setNewAddressStep
                                        );
                                      }}
                                      className="w-full px-4 py-3.5 text-left text-sm hover:bg-sky-50/40 border-b border-black/5 last:border-b-0 transition-colors flex flex-col gap-0.5"
                                    >
                                      <div className="flex items-center gap-2">
                                        <span className="text-[var(--accent)]"><MapPin className="h-3.5 w-3.5" strokeWidth={1.5} /></span>
                                        <p className="font-semibold text-neutral-900 line-clamp-1">{suggestion.name}</p>
                                      </div>
                                      <p className="text-xs text-neutral-500 truncate pl-6">{suggestion.description}</p>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>

                            <button
                              type="button"
                              onClick={() => void fillCheckoutWithCurrentLocation()}
                              disabled={locatingAddress}
                              className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-[var(--accent)] px-4 py-4 text-sm font-bold text-white shadow-lg shadow-[0_4px_14px_var(--accent-soft)] transition hover:bg-[var(--accent)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 disabled:shadow-none"
                            >
                              {locatingAddress ? (
                                <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                              ) : (
                                <MapPin className="h-5 w-5 shrink-0 text-rose-500 fill-rose-500" strokeWidth={1.5} />
                              )}
                              <span>{locatingAddress ? 'Obteniendo tu ubicación...' : 'Usar mi ubicación actual'}</span>
                            </button>

                            {addresses.length > 0 && (
                              <div className="pt-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setIsAddingNewAddress(false);
                                    const defaultAddr = addresses.find((a) => a.isDefault) || addresses[0];
                                    if (defaultAddr) {
                                      setSelectedAddressId(defaultAddr.id);
                                      setCheckoutForm((current) => ({
                                        ...current,
                                        street: defaultAddr.street || '',
                                        number: defaultAddr.number || '',
                                        neighborhood: defaultAddr.neighborhood || '',
                                        city: defaultAddr.city || '',
                                        state: defaultAddr.state || '',
                                        zipCode: defaultAddr.zipCode || '',
                                        latitude: String(defaultAddr.latitude),
                                        longitude: String(defaultAddr.longitude),
                                      }));
                                    }
                                  }}
                                  className="flex w-full items-center justify-center gap-2 rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-xs font-bold text-neutral-600 transition-all hover:border-neutral-300 hover:text-neutral-900 active:scale-[0.98] shadow-sm"
                                >
                                  <ArrowLeft className="h-4 w-4 shrink-0" strokeWidth={2} />
                                  Ver direcciones guardadas ({addresses.length})
                                </button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-4">
                            <div className="rounded-2xl border border-neutral-100 bg-neutral-50 p-3.5 flex items-start justify-between gap-3 shadow-sm">
                              <div className="flex-1 min-w-0">
                                <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">Dirección base</p>
                                <p className="text-sm font-bold text-neutral-900 truncate mt-0.5">{checkoutForm.street} {checkoutForm.number}</p>
                                <p className="text-xs text-neutral-500 truncate mt-0.5">{checkoutForm.neighborhood || 'Sin colonia'}, {checkoutForm.city || 'Sin ciudad'}</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setNewAddressStep('search');
                                  setAddressSearchQuery('');
                                  setAddressSuggestions([]);
                                }}
                                className="rounded-xl border border-sky-100 bg-white px-3 py-1.5 text-xs font-bold text-[var(--accent)] transition hover:bg-sky-50 shadow-sm shrink-0"
                              >
                                Cambiar
                              </button>
                            </div>

                            <div className="flex items-center gap-2.5 rounded-2xl bg-sky-50/50 px-4 py-3 text-xs text-[var(--accent-strong)] border border-sky-100 shadow-sm">
                              <span className="text-base shrink-0"><MapPin className="h-4 w-4" strokeWidth={1.5} /></span>
                              <p className="font-semibold leading-relaxed">Mueve el pin en el mapa para ubicar exactamente el lugar de tu entrega.</p>
                            </div>

                            <div className="grid gap-3.5 md:grid-cols-2">
                              <Field
                                label="Número de casa / Apto / Interior"
                                value={checkoutForm.number}
                                onChange={(value) => setCheckoutForm((current) => ({ ...current, number: value }))}
                              />
                              <Field
                                label="Referencias del domicilio"
                                value={checkoutForm.reference}
                                onChange={(value) => setCheckoutForm((current) => ({ ...current, reference: value }))}
                              />
                            </div>

                            <div className="flex items-center justify-end gap-3.5 pt-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setNewAddressStep('search');
                                  setAddressSearchQuery('');
                                  setAddressSuggestions([]);
                                }}
                                className="rounded-xl border border-black/10 bg-white px-4 py-2.5 text-xs font-bold text-neutral-600 transition hover:bg-neutral-50 shadow-sm"
                              >
                                Atrás
                              </button>
                              <button
                                type="button"
                                onClick={() => void saveAndSelectAddress()}
                                className="rounded-xl bg-[var(--accent)] px-5 py-2.5 text-xs font-bold text-white transition hover:bg-[var(--accent)] shadow-sm shadow-accent/10"
                              >
                                Confirmar dirección
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Google Map (aparece al seleccionar dirección o al agregar una nueva) */}
                    <div
                      id="map-checkout"
                      className={`relative h-48 w-full rounded-2xl border border-black/5 mt-4 overflow-hidden shadow-inner no-invert transition-opacity duration-300 ${(showMapForAddress || (isAddingNewAddress && newAddressStep !== 'search')) ? '' : 'hidden'}`}
                    >
                      {showMapForAddress && !isAddingNewAddress && (
                        <button
                          type="button"
                          onClick={() => setShowMapForAddress(null)}
                          className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-full bg-white/95 px-3 py-1 text-[10px] font-bold text-neutral-600 shadow-md backdrop-blur transition-all hover:bg-white active:scale-95"
                        >
                          <X className="h-3 w-3" strokeWidth={2.5} /> Ocultar mapa
                        </button>
                      )}
                    </div>
                  </div>
                  )}

                  {/* ── PASO 2: INSTRUCCIONES (colapsable, opcional) ── */}
                  <div className="rounded-[22px] border border-black/[0.04] bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                    <button
                      type="button"
                      onClick={() => setShowInstructions((v) => !v)}
                      aria-expanded={showInstructions}
                      className="-mx-2 mb-1 flex w-full items-center justify-between gap-3 rounded-xl px-2 py-1 text-left transition-colors hover:bg-neutral-50 active:scale-[0.99] dark:hover:bg-zinc-800/50"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-200 text-[11px] font-black text-neutral-500 dark:bg-zinc-700 dark:text-zinc-300">2</span>
                        <div>
                          <h3 className="text-[13px] font-bold tracking-tight text-neutral-900">Instrucciones</h3>
                          <p className="text-[11px] font-medium text-neutral-500 dark:text-zinc-400">Opcional · para la tienda o el repartidor</p>
                        </div>
                      </div>
                      <ChevronUp className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform duration-200 ${showInstructions ? '' : 'rotate-180'}`} strokeWidth={2} />
                    </button>
                    {showInstructions && (
                    <div className="mt-4 space-y-3.5">
                      <Field 
                        label="Instrucciones para la tienda" 
                        value={checkoutForm.storeNotes} 
                        onChange={(value) => setCheckoutForm((current) => ({ ...current, storeNotes: value }))} 
                      />

                      {fulfillmentType !== 'PICKUP' && (
                      <Field 
                        label="Instrucciones para el repartidor" 
                        value={checkoutForm.notes} 
                        onChange={(value) => setCheckoutForm((current) => ({ ...current, notes: value }))} 
                      />
                      )}
                    </div>
                    )}
                  </div>

                  {/* ── PASO 2.5: CUPÓN (opcional, colapsable) ── */}
                  <div className="rounded-[22px] border border-black/[0.04] bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                    <button
                      type="button"
                      onClick={() => setIsCouponOpen((v) => !v)}
                      aria-expanded={isCouponOpen || promoCodeState === 'valid'}
                      className="-mx-2 mb-1 flex w-full items-center justify-between gap-3 rounded-xl px-2 py-1 text-left transition-colors hover:bg-neutral-50 active:scale-[0.99] dark:hover:bg-zinc-800/50"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-neutral-500 dark:bg-zinc-700 dark:text-zinc-300">
                          <Ticket className="h-3.5 w-3.5" strokeWidth={1.8} />
                        </span>
                        <div>
                          <h3 className="text-[13px] font-bold tracking-tight text-neutral-900">Cupón de descuento</h3>
                          <p className="text-[11px] font-medium text-neutral-500 dark:text-zinc-400">¿Tienes un código? Aplícalo aquí</p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {promoCodeState === 'valid' && promoCodeInfo && !isCouponOpen && (
                          <span className="text-[11px] font-black text-emerald-600">-{formatCurrency(promoCodeInfo.discount)}</span>
                        )}
                        <ChevronUp className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform duration-200 ${isCouponOpen || promoCodeState === 'valid' ? '' : 'rotate-180'}`} strokeWidth={2} />
                      </div>
                    </button>

                    {(isCouponOpen || promoCodeState === 'valid') && (
                    <>
                    {promoCodeState === 'valid' && promoCodeInfo ? (
                      <div className="space-y-3.5">
                        <div className="overflow-hidden rounded-2xl border border-sky-200/70 bg-gradient-to-br from-sky-50/90 via-white to-blue-50/60">
                          <div className="flex items-start gap-3 border-b border-sky-100/80 px-4 py-3.5">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--accent)] to-[var(--accent-strong)] text-white shadow-[0_6px_14px_-4px_rgba(2,132,199,0.5)]">
                              <CircleCheck className="h-5 w-5" strokeWidth={2.5} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-[13px] font-bold text-neutral-900">
                                Cupón {promoCodeInfo.code} aplicado correctamente
                              </p>
                              <p className="mt-0.5 text-[11px] font-semibold text-[var(--accent-strong)]">
                                {promoCodeInfo.type === 'PERCENT' && `${promoCodeInfo.value}% de descuento`}
                                {promoCodeInfo.type === 'AMOUNT' && `-${formatCurrency(promoCodeInfo.value)} en tu pedido`}
                                {promoCodeInfo.type === 'FREE_DELIVERY' && 'Envío gratis en este pedido'}
                              </p>
                            </div>
                          </div>
                          <div className="space-y-1.5 px-4 py-3.5 text-[12px]">
                            <div className="flex items-center justify-between">
                              <span className="text-neutral-500">Total sin cupón</span>
                              <span className="font-semibold text-neutral-900">{formatCurrency(orderTotal + promoCodeInfo.discount)}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-neutral-500">Cupón {promoCodeInfo.code}</span>
                              <span className="font-bold text-[var(--accent-strong)]">-{formatCurrency(promoCodeInfo.discount)}</span>
                            </div>
                            {promoCodeInfo.description && (
                              <p className="pt-1 text-[11px] text-neutral-400">{promoCodeInfo.description}</p>
                            )}
                            <div className="mt-1.5 flex items-center justify-between rounded-xl bg-gradient-to-br from-[var(--accent)] to-[var(--accent-strong)] px-3.5 py-2.5 shadow-[0_8px_18px_-6px_rgba(2,132,199,0.5)]">
                              <span className="text-[11px] font-bold uppercase tracking-wide text-white/90">Nuevo total</span>
                              <span className="text-[15px] font-extrabold tracking-tight text-white">{formatCurrency(orderTotal)}</span>
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setCheckoutForm((current) => ({ ...current, promoCode: '' }));
                            setPromoCodeState('idle');
                            setPromoCodeInfo(null);
                            setIsCouponOpen(false);
                          }}
                          className="text-[11px] font-semibold text-neutral-400 underline-offset-2 hover:text-neutral-600 hover:underline"
                        >
                          Quitar cupón
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                        <div className="min-w-0 flex-1">
                          <Field
                            label="Código promocional"
                            value={checkoutForm.promoCode}
                            onChange={(value) => {
                              setCheckoutForm((current) => ({ ...current, promoCode: value.toUpperCase() }));
                              setPromoCodeState('idle');
                              setPromoCodeInfo(null);
                            }}
                            placeholder="Ej. VERANO10"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => void validatePromoCode()}
                          disabled={!checkoutForm.promoCode.trim() || promoCodeState === 'validating'}
                          className="inline-flex h-[46px] w-full shrink-0 items-center justify-center gap-1.5 rounded-xl bg-neutral-950 px-4 text-sm font-bold text-white transition hover:bg-neutral-800 active:scale-[0.97] disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 sm:mt-6 sm:w-auto"
                        >
                          {promoCodeState === 'validating' ? (
                            <Loader2 className="h-4 w-4 animate-spin text-white" />
                          ) : (
                            <Search className="h-4 w-4" />
                          )}
                          {promoCodeState === 'validating' ? 'Validando...' : 'Aplicar'}
                        </button>
                      </div>
                    )}
                    </>
                    )}
                  </div>
                  </div>

                  {/* ── Columna derecha (desktop): PAGO Y DETALLES ── */}
                  <div className="space-y-4">
                  {/* ── PASO 3: PAGO Y DETALLES ── */}
                  <div className="rounded-[22px] border border-black/[0.04] bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                    <div className="mb-4 flex items-center justify-between border-b border-black/[0.05] pb-3">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)] text-[11px] font-black text-white">3</span>
                        <div>
                          <h3 className="text-[13px] font-bold tracking-tight text-neutral-900">Método de pago</h3>
                          <p className="text-[11px] font-medium text-neutral-500 dark:text-zinc-400">¿Cómo prefieres pagar?</p>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      {/* Selector de Método de Pago */}
                      <div>
                        {(() => {
                          const accepted = getAcceptedPaymentMethods(restaurant);
                          const showCash = accepted.includes('CASH');
                          const showTransfer = accepted.includes('TRANSFER');
                          if (!showCash && !showTransfer) return null;
                          return (
                            <div className="flex gap-1.5 rounded-2xl bg-neutral-100 p-1">
                              {showCash && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCheckoutForm((current) => ({ ...current, paymentMethod: 'CASH' }));
                                    setTransferProofName('');
                                    setTransferProofSource('');
                                  }}
                                  className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-bold transition-all ${
                                    checkoutForm.paymentMethod === 'CASH'
                                      ? 'bg-[var(--accent)] text-white shadow-sm shadow-[0_4px_14px_var(--accent-soft)]'
                                      : 'text-neutral-500 hover:text-neutral-800'
                                  }`}
                                >
                                  <DollarSign className="h-4 w-4" strokeWidth={1.5} />
                                  Efectivo
                                </button>
                              )}
                              {showTransfer && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCheckoutForm((current) => ({ ...current, paymentMethod: 'TRANSFER' }));
                                  }}
                                  className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-bold transition-all ${
                                    checkoutForm.paymentMethod === 'TRANSFER'
                                      ? 'bg-[var(--accent)] text-white shadow-sm shadow-[0_4px_14px_var(--accent-soft)]'
                                      : 'text-neutral-500 hover:text-neutral-800'
                                  }`}
                                >
                                  <Landmark className="h-4 w-4" strokeWidth={1.5} />
                                  Transferencia
                                </button>
                              )}
                            </div>
                          );
                        })()}
                      </div>

                      {/* CONDICIONAL: Detalles de Transferencia Integrados */}
                      {checkoutForm.paymentMethod === 'TRANSFER' && (
                        <div className="space-y-4 pt-2 animate-in fade-in duration-300">
                          {hasTransferDetails(restaurant) ? (
                            <div className="rounded-2xl border border-[var(--accent)] bg-white p-4">
                              <p className="text-xs font-semibold text-neutral-500 mb-3 flex items-center gap-1.5">
                                <Landmark className="h-4 w-4 text-[var(--accent)]" strokeWidth={1.5} />
                                Transferencia bancaria
                              </p>
                              {/* Checklist rápido del flujo de transferencia */}
                              <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[10px] font-semibold text-neutral-400 dark:text-zinc-500">
                                <span className="flex items-center gap-1"><span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--accent-soft-strong)] text-[9px] font-black text-[var(--accent-strong)]">1</span>Transfiere el monto exacto</span>
                                <ChevronRight className="h-3 w-3" strokeWidth={2.5} />
                                <span className="flex items-center gap-1"><span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--accent-soft-strong)] text-[9px] font-black text-[var(--accent-strong)]">2</span>Sube tu comprobante</span>
                                <ChevronRight className="h-3 w-3" strokeWidth={2.5} />
                                <span className="flex items-center gap-1"><span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--accent-soft-strong)] text-[9px] font-black text-[var(--accent-strong)]">3</span>Confirmamos tu pedido</span>
                              </div>
                              <div className="rounded-xl bg-neutral-50 px-4 py-3 text-center mb-3">
                                <p className="text-[11px] text-neutral-500 font-medium">Monto exacto a transferir</p>
                                <p className="text-xl font-extrabold text-neutral-900 mt-0.5">{formatCurrency(orderTotal)}</p>
                              </div>
                              <div className="space-y-2.5 text-sm">
                                <div className="flex items-center justify-between border-b border-neutral-100 pb-2">
                                  <span className="text-neutral-500 text-[13px]">Banco</span>
                                  <span className="font-semibold text-neutral-900">{restaurant?.transferBankName}</span>
                                </div>
                                <div className="flex items-center justify-between border-b border-neutral-100 pb-2">
                                  <span className="text-neutral-500 text-[13px]">Cuenta</span>
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono font-semibold text-neutral-900 select-all">{restaurant?.transferAccountNumber}</span>
                                    <button
                                      type="button"
                                      onClick={() => handleCopyText(restaurant?.transferAccountNumber, 'account')}
                                      className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 active:scale-90 transition-all relative"
                                      title="Copiar"
                                    >
                                      {copiedField === 'account' ? (
                                        <Check className="h-3.5 w-3.5 text-emerald-500" strokeWidth={3} />
                                      ) : (
                                        <Copy className="h-3.5 w-3.5" strokeWidth={2} />
                                      )}
                                    </button>
                                  </div>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-neutral-500 text-[13px]">Beneficiario</span>
                                  <div className="flex items-center gap-2">
                                    <span className="font-semibold text-neutral-900">{restaurant?.transferBeneficiaryName}</span>
                                    <button
                                      type="button"
                                      onClick={() => handleCopyText(restaurant?.transferBeneficiaryName, 'beneficiary')}
                                      className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 active:scale-90 transition-all relative"
                                      title="Copiar"
                                    >
                                      {copiedField === 'beneficiary' ? (
                                        <Check className="h-3.5 w-3.5 text-emerald-500" strokeWidth={3} />
                                      ) : (
                                        <Copy className="h-3.5 w-3.5" strokeWidth={2} />
                                      )}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 text-sm text-amber-800 leading-relaxed">
                              <AlertTriangle className="h-4 w-4 inline-block align-text-bottom" strokeWidth={1.5} /> Este restaurante aún no ha configurado sus datos de transferencia. Usa efectivo o vuelve más tarde.
                            </div>
                          )}

                          {/* Zona de Carga de Archivos Premium */}
                          <div className="space-y-2">
                            <label className="text-sm font-semibold text-neutral-800">Comprobante de transferencia</label>
                            {transferProofSource ? (
                              <div className="space-y-3">
                                <div className="relative overflow-hidden rounded-2xl border border-black/[0.06] bg-neutral-900/5">
                                  <img
                                    src={transferProofSource}
                                    alt={transferProofName}
                                    loading="lazy" decoding="async"
                                    className="w-full h-48 object-contain bg-neutral-100"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setTransferProofSource('');
                                      setTransferProofName('');
                                    }}
                                    className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white text-sm hover:bg-black/70 transition-all"
                                  >
                                    ✕
                                  </button>
                                </div>
                                <label className="relative flex cursor-pointer items-center justify-center gap-2.5 rounded-2xl border-2 border-dashed border-neutral-200 bg-white px-5 py-4 text-sm font-bold text-neutral-700 transition-all hover:border-[var(--accent)] hover:bg-sky-50/40 hover:text-[var(--accent-strong)] active:scale-[0.97] shadow-sm hover:shadow-md group">
                                  <input
                                    type="file"
                                    accept="image/*"
                                    onChange={(event) => void handleTransferProofChange(event)}
                                    className="sr-only"
                                  />
                                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-50 text-[var(--accent)] group-hover:bg-[var(--accent-soft-strong)] transition-colors">
                                    <Upload className="h-4 w-4" strokeWidth={1.5} />
                                  </div>
                                  <div className="flex flex-col items-start">
                                    <span className="text-sm font-bold">Cambiar comprobante de pago</span>
                                    <span className="text-[10px] font-medium text-neutral-400 group-hover:text-[var(--accent)] transition-colors">Toca para seleccionar otro archivo</span>
                                  </div>
                                </label>
                              </div>
                            ) : (
                              <label
                                id="transfer-proof-upload"
                                className={`relative flex cursor-pointer items-center justify-center gap-2.5 rounded-2xl border-2 border-dashed px-5 py-4 text-sm font-bold transition-all active:scale-[0.97] shadow-sm group ${
                                  attemptedCheckout && checkoutForm.paymentMethod === 'TRANSFER'
                                    ? 'border-rose-300 bg-rose-50/50 text-rose-700 hover:border-rose-400'
                                    : 'border-neutral-200 bg-white text-neutral-700 hover:border-[var(--accent)] hover:bg-sky-50/40 hover:text-[var(--accent-strong)] hover:shadow-md'
                                }`}
                              >
                                <input
                                  type="file"
                                  accept="image/*"
                                  onChange={(event) => void handleTransferProofChange(event)}
                                  className="sr-only"
                                />
                                <div className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${attemptedCheckout && checkoutForm.paymentMethod === 'TRANSFER' ? 'bg-rose-100 text-rose-500' : 'bg-sky-50 text-[var(--accent)] group-hover:bg-[var(--accent-soft-strong)]'}`}>
                                  <Upload className="h-4 w-4" strokeWidth={1.5} />
                                </div>
                                <div className="flex flex-col items-start">
                                  <span className="text-sm font-bold">Subir comprobante de pago</span>
                                  {attemptedCheckout && checkoutForm.paymentMethod === 'TRANSFER' ? (
                                    <span className="text-[10px] font-bold text-rose-500">Necesario para confirmar tu pedido</span>
                                  ) : (
                                    <span className="text-[10px] font-medium text-neutral-400 group-hover:text-[var(--accent)] transition-colors">JPG, PNG o captura de pantalla</span>
                                  )}
                                </div>
                              </label>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>





                  {/* Redundant login card transformed into a premium callout */}
                  {checkoutValidationMessage && !token && (
                    <div className="rounded-2xl border border-sky-100 bg-sky-50/60 p-5 text-center shadow-sm animate-in fade-in duration-300">
                      <p className="text-sm font-bold text-neutral-900">
                        ¿Listo para confirmar tu pedido?
                      </p>
                      <p className="text-xs text-neutral-500 mt-1.5 leading-relaxed">
                        Inicia sesión o regístrate para que podamos guardar tus datos y procesar tu envío de inmediato.
                      </p>
                      <button
                        type="button"
                        onClick={() => setShowAuthModal(true)}
                        className="mt-4 inline-flex items-center justify-center rounded-xl bg-[var(--accent)] px-6 py-3 text-xs font-bold text-white shadow-md shadow-accent/25 transition-all hover:bg-[var(--accent)] hover:shadow-lg active:scale-95"
                      >
                        Iniciar sesión / Registrarse
                      </button>
                    </div>
                  )}
                  </div>
                  </div>
                </div>

                <div className="sticky bottom-0 z-10 border-t border-black/[0.04] bg-white/95 px-4 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] backdrop-blur-xl sm:px-5 shadow-[0_-12px_30px_-8px_rgba(0,0,0,0.08)]">
                  {/* Validation Warning Callout (Animated and Professional) */}
                  {checkoutValidationMessage && token && (
                    <div className="mb-3.5 flex justify-center animate-in slide-in-from-bottom-2 fade-in duration-300">
                      <div className="flex items-center gap-2 rounded-full border border-rose-200/60 bg-rose-50/80 px-3.5 py-1.5 text-[11px] font-medium text-rose-600 shadow-sm backdrop-blur-md">
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-rose-500/20"><AlertTriangle className="h-3 w-3 text-rose-500" strokeWidth={1.5} /></span>
                        <span>{checkoutValidationMessage}</span>
                      </div>
                    </div>
                  )}

                  {/* Buttons Row */}
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setIsCheckoutOpen(false);
                        setIsCartOpen(true);
                      }}
                      className="group flex items-center justify-center gap-1.5 rounded-2xl bg-neutral-100/80 px-4 py-3.5 text-sm font-semibold text-neutral-600 transition-all hover:bg-neutral-200/80 active:scale-[0.97] active-scale shrink-0"
                    >
                      <ChevronLeft className="h-4 w-4 text-neutral-500 transition-transform group-hover:-translate-x-0.5" strokeWidth={2.5} />
                      <span className="hidden sm:inline">Volver</span>
                    </button>
                    
                    {!token ? (
                      <button
                        type="button"
                        onClick={() => setShowAuthModal(true)}
                        className="group relative flex-1 overflow-hidden rounded-2xl bg-[var(--accent)] px-5 py-3.5 text-[15px] font-bold text-white shadow-[0_8px_20px_-6px_rgba(14,165,233,0.4)] transition-all hover:bg-[var(--accent-strong)] hover:shadow-[0_12px_24px_-8px_rgba(14,165,233,0.5)] active:scale-[0.97] active-scale"
                      >
                        <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-1000 group-hover:translate-x-full" />
                        <span className="relative flex items-center justify-center gap-2">
                          Iniciar sesión
                          <Check className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2.5} />
                        </span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          if (creatingOrder) return;
                          // Guía al error en lugar de bloquear en silencio:
                          // falta comprobante → sacudir + scroll al upload.
                          if (checkoutValidationMessage) {
                            setAttemptedCheckout(true);
                            if (checkoutForm.paymentMethod === 'TRANSFER' && !transferProofSource) {
                              const el = document.getElementById('transfer-proof-upload');
                              if (el) {
                                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                el.classList.remove('animate-nudge');
                                void (el as HTMLElement).offsetWidth; // reinicia la animación
                                el.classList.add('animate-nudge');
                              }
                              return;
                            }
                          }
                          if (pushPermission !== 'granted') {
                            setIsPushReminderModalOpen(true);
                          } else {
                            void createOrder();
                          }
                        }}
                        aria-disabled={creatingOrder || Boolean(checkoutValidationMessage)}
                        className={`group relative flex-1 overflow-hidden rounded-2xl px-5 py-3.5 text-[15px] font-bold text-white transition-all active:scale-[0.97] active-scale ${
                          checkoutValidationMessage && !creatingOrder
                            ? 'bg-neutral-400 shadow-none'
                            : 'bg-[var(--accent)] shadow-[0_8px_20px_-6px_rgba(14,165,233,0.4)] hover:bg-[var(--accent-strong)] hover:shadow-[0_12px_24px_-8px_rgba(14,165,233,0.5)]'
                        }`}
                      >
                        <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-1000 group-hover:translate-x-full disabled:hidden" />
                        <span className="relative flex items-center justify-center gap-2">
                          {creatingOrder ? 'Procesando...' : `Confirmar • ${formatCurrency(orderTotal)}`}
                          {!creatingOrder && (
                            <Check className="h-4 w-4 transition-transform group-hover:translate-x-1" strokeWidth={2.5} />
                          )}
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              </section>
          </div>
        </div>

      {/* Push Reminder Modal */}
      {isPushReminderModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" onClick={() => setIsPushReminderModalOpen(false)}></div>
          <div className="relative w-full max-w-sm rounded-[32px] bg-white p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft text-3xl">
              {pushPermission === 'denied' ? <BellOff className="h-8 w-8 text-neutral-600" strokeWidth={1.5} /> : <Bell className="h-8 w-8 text-[var(--accent)]" strokeWidth={1.5} />}
            </div>
            <h3 className="text-center text-xl font-bold tracking-tight text-neutral-900">
              {pushPermission === 'denied' ? 'Notificaciones bloqueadas' : '¡No pierdas de vista tu pedido!'}
            </h3>
            <p className="mt-3 text-center text-sm leading-relaxed text-neutral-600">
              {pushPermission === 'denied' ? (
                <>Para recibir alertas en tiempo real, dale clic al <span className="font-semibold text-neutral-900">candadito en la barra de direcciones</span> de tu navegador y activa las notificaciones manualmente.</>
              ) : (
                <>Te recomendamos <span className="font-semibold text-neutral-900">permitir las notificaciones</span> para poder avisarte en tiempo real sobre el estado y la llegada de tu pedido.</>
              )}
            </p>
            <div className="mt-6 flex flex-col gap-3">
              {pushPermission === 'denied' ? (
                <button
                  type="button"
                  onClick={() => {
                    setIsPushReminderModalOpen(false);
                    void createOrder();
                  }}
                  className="w-full rounded-full bg-[var(--accent)] px-4 py-3.5 text-sm font-semibold text-white shadow-[0_8px_16px_rgba(135,206,235,0.25)] transition hover:bg-[var(--accent)] active:scale-[0.98] active-scale"
                >
                  Entendido, continuar con mi pedido
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setIsPushReminderModalOpen(false);
                      subscribePush()
                        .then(() => {
                          void createOrder();
                        })
                        .catch(() => {
                          void createOrder();
                        });
                    }}
                    className="w-full rounded-full bg-[var(--accent)] px-4 py-3.5 text-sm font-semibold text-white shadow-[0_8px_16px_rgba(135,206,235,0.25)] transition hover:bg-[var(--accent)] active:scale-[0.98] active-scale"
                  >
                    Aceptar y Continuar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsPushReminderModalOpen(false);
                      void createOrder();
                    }}
                    className="w-full rounded-full px-4 py-3 text-sm font-semibold text-neutral-500 transition hover:bg-neutral-100 active:scale-[0.98] active-scale"
                  >
                    No gracias, continuar sin alertas
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Max Cash Limit Modal */}
      {showMaxCashModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" onClick={() => setShowMaxCashModal(false)}></div>
          <div className="relative w-full max-w-sm rounded-[32px] bg-white p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-rose-100 text-3xl">
              <Banknote className="h-8 w-8 text-rose-500" strokeWidth={1.5} />
            </div>
            <h3 className="text-center text-xl font-bold tracking-tight text-neutral-900">
              Monto Excedido
            </h3>
            <p className="mt-3 text-center text-sm leading-relaxed text-neutral-600">
              Por seguridad de los repartidores, los pedidos mayores a <span className="font-semibold text-neutral-900">${restaurant?.maxCashOrder && restaurant.maxCashOrder > 0 ? restaurant.maxCashOrder : 500}</span> no pueden pagarse en efectivo.
            </p>
            <div className="mt-6 flex flex-col gap-3">
              <button
                type="button"
                onClick={() => {
                  setCheckoutForm((prev) => ({ ...prev, paymentMethod: 'TRANSFER' }));
                  setShowMaxCashModal(false);
                }}
                className="w-full rounded-full bg-[var(--accent)] px-4 py-3.5 text-sm font-semibold text-white shadow-[0_8px_16px_rgba(135,206,235,0.25)] transition hover:bg-[var(--accent)] active:scale-[0.98] active-scale"
              >
                Cambiar a Transferencia
              </button>
              <button
                type="button"
                onClick={() => setShowMaxCashModal(false)}
                className="w-full rounded-full px-4 py-3 text-sm font-semibold text-neutral-500 transition hover:bg-neutral-100 active:scale-[0.98] active-scale"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GPS Cash Error Modal */}
      {showGpsCashModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" onClick={() => setShowGpsCashModal(false)}></div>
          <div className="relative w-full max-w-sm rounded-[32px] bg-white p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-rose-100 text-3xl">
              <MapPin className="h-8 w-8 text-rose-500" strokeWidth={1.5} />
            </div>
            <h3 className="text-center text-xl font-bold tracking-tight text-neutral-900">
              Ubicación no disponible
            </h3>
            <p className="mt-3 text-center text-sm leading-relaxed text-neutral-600">
              No pudimos acceder a tu GPS. Por políticas de seguridad, los pagos en <span className="font-semibold text-neutral-900">Efectivo</span> requieren ubicación precisa.
            </p>
            <p className="mt-2 text-center text-sm leading-relaxed text-neutral-600">
              Puedes continuar tu pedido ahora mismo cambiando el método a <span className="font-semibold text-neutral-900">Transferencia</span>.
            </p>
            <div className="mt-6 flex flex-col gap-3">
              <button
                type="button"
                onClick={() => {
                  setCheckoutForm((prev) => ({ ...prev, paymentMethod: 'TRANSFER' }));
                  setShowGpsCashModal(false);
                }}
                className="w-full rounded-full bg-[var(--accent)] px-4 py-3.5 text-sm font-semibold text-white shadow-[0_8px_16px_rgba(135,206,235,0.25)] transition hover:bg-[var(--accent)] active:scale-[0.98] active-scale"
              >
                Cambiar a Transferencia
              </button>
              <button
                type="button"
                onClick={() => setShowGpsCashModal(false)}
                className="w-full rounded-full px-4 py-3 text-sm font-semibold text-neutral-500 transition hover:bg-neutral-100 active:scale-[0.98] active-scale"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delivery Error Modal */}
      {deliveryErrorModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" onClick={() => setDeliveryErrorModal('')}></div>
          <div className="relative w-full max-w-sm rounded-[32px] bg-white p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-rose-100 text-3xl">
              <MapPin className="h-8 w-8 text-rose-500" strokeWidth={1.5} />
            </div>
            <h3 className="text-center text-xl font-bold tracking-tight text-neutral-900">
              Pedido no disponible
            </h3>
            <p className="mt-3 text-center text-sm leading-relaxed text-neutral-600">
              {deliveryErrorModal}
            </p>
            <div className="mt-6 flex flex-col gap-3">
              <button
                type="button"
                onClick={() => setDeliveryErrorModal('')}
                className="w-full rounded-full bg-[var(--accent)] px-4 py-3.5 text-sm font-semibold text-white shadow-[0_8px_16px_rgba(135,206,235,0.25)] transition hover:bg-[var(--accent)] active:scale-[0.98] active-scale"
              >
                Aceptar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-7xl px-4 pb-5 pt-0 md:px-6 md:pb-8 md:pt-0">

        {error ? (
          <div className="mt-5">
            <Callout tone="danger">{error}</Callout>
            <button
              type="button"
              onClick={() => setMenuReloadKey((k) => k + 1)}
              className="mt-3 rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500"
            >
              Reintentar
            </button>
          </div>
        ) : null}

        {loadingRestaurant ? (
          <div className="space-y-6">
            {/* Header Skeleton */}
            <div className={`-mx-4 ${error ? 'mt-4' : 'mt-0'} lg:mx-0 lg:mt-0 overflow-hidden border-y border-black/5 bg-white shadow-[0_18px_60px_rgba(15,15,15,0.05)] lg:rounded-[32px] lg:border lg:border-black/5`}>
              <div className="relative h-52 w-full bg-neutral-100 animate-pulse md:h-72 lg:h-64" />
              <div className="p-5 md:p-7">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex items-center gap-4">
                    <div className="h-16 w-16 rounded-2xl bg-neutral-100 animate-pulse" />
                    <div className="space-y-2">
                      <div className="h-6 w-48 rounded bg-neutral-100 animate-pulse" />
                      <div className="h-4 w-32 rounded bg-neutral-100 animate-pulse" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Categories Skeleton */}
            <div className="flex gap-2 overflow-x-auto pb-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-10 w-24 flex-shrink-0 rounded-full bg-neutral-100 animate-pulse" />
              ))}
            </div>

            {/* Menu Items Skeleton */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="rounded-[24px] border border-black/5 bg-white p-4 shadow-[0_12px_40px_rgba(15,15,15,0.04)]">
                  <div className="flex gap-4">
                    <div className="h-20 w-20 flex-shrink-0 rounded-2xl bg-neutral-100 animate-pulse" />
                    <div className="flex-1 space-y-2">
                      <div className="h-5 w-3/4 rounded bg-neutral-100 animate-pulse" />
                      <div className="h-3 w-full rounded bg-neutral-100 animate-pulse" />
                      <div className="h-5 w-1/4 rounded bg-neutral-100 animate-pulse" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : restaurant ? (
          <div className="space-y-6">
            <div className="space-y-0">
              <section className={`-mx-4 ${error ? 'mt-4' : 'mt-0'} lg:mx-0 lg:mt-0 overflow-hidden border-y border-black/5 dark:border-zinc-900/80 bg-[var(--menu-surface)] dark:bg-[var(--menu-surface-dark)] shadow-[0_18px_60px_rgba(15,15,15,0.05)] dark:shadow-none lg:rounded-[32px] lg:border lg:border-black/5 lg:dark:border-zinc-900/80`}>
                <div className="relative">
                  {restaurant.coverImage ? (
                      <img
                        src={restaurant.coverImage}
                        alt={`Banner de ${restaurant.name}`}
                        loading="lazy" decoding="async"
                        className="h-52 w-full object-cover md:h-72 lg:h-64"
                        fetchPriority="high"
                      />
                  ) : (
                    <div className="h-52 w-full bg-[linear-gradient(135deg,#fcd34d_0%,#f97316_100%)] md:h-72 lg:h-64" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/15 to-transparent" />

                  <div className="absolute inset-x-0 bottom-0 hidden p-7 lg:block">
                    <div className="flex items-end gap-4">
                      <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-[28px] border-4 border-white dark:border-neutral-900 bg-white dark:bg-neutral-900 shadow-[0_10px_24px_rgba(15,15,15,0.14)] dark:shadow-none">
                        {restaurant.logo ? (
                          <img
                            src={restaurant.logo}
                            alt={`Logo de ${restaurant.name}`}
                            loading="lazy" decoding="async"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="text-xl font-semibold text-neutral-900 dark:text-white">{buildRestaurantInitials(restaurant.name)}</span>
                        )}
                      </div>
                      <div className="text-white">
                        <p className="text-3xl font-semibold tracking-[-0.04em]">{restaurant.name}</p>
                        <div className="mt-1 flex items-center gap-1 text-sm font-semibold text-white">
                          <svg className="h-3.5 w-3.5 inline-block -mt-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.007 5.404.433c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.433 2.082-5.006z" /></svg> {restaurant.rating ? restaurant.rating.toFixed(1) : 'Nuevo'}
                          {(restaurant.reviewCount ?? 0) > 0 && (
                            <span className="font-normal text-white/70"> ({restaurant.reviewCount} reseñas)</span>
                          )}
                        </div>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-white/80">{restaurant.description}</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="relative px-4 pb-2 pt-0 text-sm text-neutral-600 dark:text-neutral-300 md:px-6 md:pb-3 lg:px-7 lg:pt-5">
                  <div className="-mt-14 flex flex-col items-center text-center lg:hidden">
                    <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-[22px] border-4 border-white dark:border-neutral-900 bg-white dark:bg-neutral-900 shadow-[0_8px_20px_rgba(15,15,15,0.14)] dark:shadow-none">
                      {restaurant.logo ? (
                        <img
                          src={restaurant.logo}
                          alt={`Logo de ${restaurant.name}`}
                          loading="lazy" decoding="async"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-lg font-semibold text-neutral-900 dark:text-white">{buildRestaurantInitials(restaurant.name)}</span>
                      )}
                    </div>
                    <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-neutral-950 dark:text-white">{restaurant.name}</p>
                    <div className="mt-0.5 flex items-center gap-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                      <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M10.788 3.21c.448-1.077 1.976-1.077 2.424 0l2.082 5.007 5.404.433c1.164.093 1.636 1.545.749 2.305l-4.117 3.527 1.257 5.273c.271 1.136-.964 2.033-1.96 1.425L12 18.354 7.373 21.18c-.996.608-2.231-.29-1.96-1.425l1.257-5.273-4.117-3.527c-.887-.76-.415-2.212.749-2.305l5.404-.433 2.082-5.006z" /></svg> {restaurant.rating ? restaurant.rating.toFixed(1) : 'Nuevo'}
                      {(restaurant.reviewCount ?? 0) > 0 && (
                        <span className="font-normal text-neutral-500 dark:text-neutral-400"> ({restaurant.reviewCount} reseñas)</span>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-col lg:flex-row items-stretch lg:items-center gap-1.5 lg:gap-0 lg:divide-x divide-black/[0.06] rounded-2xl lg:rounded-full border border-black/[0.04] bg-[var(--menu-surface)] p-1.5 shadow-[0_2px_12px_rgba(0,0,0,0.02)] lg:p-1 lg:pr-3 transition-all hover:shadow-[0_6px_20px_rgba(0,0,0,0.04)] dark:divide-zinc-800 dark:border-zinc-800/60 dark:bg-[var(--menu-surface-dark)]">
                    {/* Address */}
                    <div className="w-full flex-1 rounded-xl lg:rounded-full bg-neutral-50 lg:bg-transparent px-3 py-2.5 lg:py-1.5 text-[12px] text-neutral-600 flex items-center gap-2 dark:bg-zinc-800/60 dark:text-zinc-300 lg:dark:bg-transparent">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white shadow-sm border border-black/[0.03] lg:bg-neutral-100 lg:shadow-none lg:border-transparent dark:bg-zinc-700 dark:lg:bg-transparent">
                        <svg className="h-3 w-3 text-neutral-500 dark:text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      </div>
                      <span className="truncate font-medium">{restaurant.address}</span>
                    </div>

                    {/* Stats Grid for Mobile / Flex for Desktop */}
                    <div className="flex w-full lg:w-auto gap-1.5 lg:gap-0">
                      <div className="flex flex-1 lg:flex-none flex-col items-center justify-center gap-0 rounded-xl lg:rounded-none bg-neutral-50 lg:bg-transparent px-2 py-1.5 lg:px-4 dark:bg-transparent">
                        <span className="text-[9px] font-extrabold uppercase tracking-widest text-neutral-400 dark:text-zinc-500">Distancia</span>
                        <div className="flex items-center gap-1 text-[12px] font-semibold text-neutral-700 dark:text-zinc-200">
                          <svg className="h-3 w-3 text-neutral-400 dark:text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                          </svg>
                          <span>{distanceKm ? `${distanceKm.toFixed(1)} km` : '-- km'}</span>
                        </div>
                      </div>
                      <div className="flex flex-1 lg:flex-none flex-col items-center justify-center gap-0 rounded-xl lg:rounded-none bg-neutral-50 lg:bg-transparent px-2 py-1.5 lg:px-4 dark:bg-transparent">
                        <span className="text-[9px] font-extrabold uppercase tracking-widest text-neutral-400 dark:text-zinc-500">Envío</span>
                        <div className="flex items-center gap-1 text-[12px] font-semibold text-neutral-700 dark:text-zinc-200">
                          <svg className="h-3 w-3 text-neutral-400 dark:text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span>{formatDeliverySummary(deliveryFee)}</span>
                        </div>
                      </div>
                      <div className="flex flex-1 lg:flex-none flex-col items-center justify-center gap-0 rounded-xl lg:rounded-none bg-neutral-50 lg:bg-transparent px-2 py-1.5 lg:px-4 dark:bg-transparent">
                        <span className="text-[9px] font-extrabold uppercase tracking-widest text-neutral-400 dark:text-zinc-500">Estado</span>
                        <div className="flex items-center gap-1.5 text-[12px]">
                          <span className="relative flex h-2 w-2 shrink-0">
                            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${restaurant.isOpen ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
                            <span className={`relative inline-flex rounded-full h-2 w-2 ${restaurant.isOpen ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
                          </span>
                          <span className={`font-bold ${restaurant.isOpen ? 'text-emerald-600' : 'text-red-600'}`}>{restaurant.isOpen ? 'Abierto' : 'Cerrado'}</span>
                        </div>
                      </div>
                      {(() => {
                        const accepted = restaurant.acceptedPaymentMethods ?? (hasTransferDetails(restaurant) ? ['CASH', 'TRANSFER'] : ['CASH']);
                        const onlyCash = accepted.length === 1 && accepted[0] === 'CASH';
                        const onlyTransfer = accepted.length === 1 && accepted[0] === 'TRANSFER';
                        if (!onlyCash && !onlyTransfer) return null;
                        return (
                          <div className="flex flex-1 lg:flex-none flex-col items-center justify-center gap-0 rounded-xl lg:rounded-none bg-neutral-50 lg:bg-transparent px-2 py-1.5 lg:px-4 dark:bg-transparent">
                            <span className="text-[9px] font-extrabold uppercase tracking-widest text-neutral-400 dark:text-zinc-500">Pago</span>
                            <div className="flex items-center gap-1 text-[12px] font-semibold text-neutral-700 dark:text-zinc-200">
                              {onlyCash ? (
                                <>
                                  <svg className="h-3 w-3 text-neutral-400 dark:text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                  Efectivo
                                </>
                              ) : (
                                <>
                                  <svg className="h-3 w-3 text-neutral-400 dark:text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" /></svg>
                                  Transferencia
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  {(() => {
                    const promos: { key: string; icon: 'delivery' | 'percent'; title: string; subtitle: string }[] = [];
                    if (
                      restaurant.promoFreeDeliveryThreshold != null &&
                      restaurant.promoFreeDeliveryThreshold > 0
                    ) {
                      promos.push({
                        key: 'free-delivery',
                        icon: 'delivery',
                        title: 'Envío gratis',
                        subtitle: `En pedidos desde ${formatCurrency(restaurant.promoFreeDeliveryThreshold)}`,
                      });
                    }
                    if (
                      restaurant.promoMinOrderAmount != null &&
                      restaurant.promoMinOrderAmount > 0 &&
                      restaurant.promoMinOrderPercent != null &&
                      restaurant.promoMinOrderPercent > 0
                    ) {
                      promos.push({
                        key: 'min-order',
                        icon: 'percent',
                        title: `${restaurant.promoMinOrderPercent}% de descuento`,
                        subtitle: `Aplicado automáticamente en pedidos desde ${formatCurrency(restaurant.promoMinOrderAmount)}`,
                      });
                    }
                    if (!promos.length) return null;
                    return (
                      <div className="mt-3 flex flex-wrap justify-center gap-2">
                        {promos.map((promo) => (
                          <div
                            key={promo.key}
                            className="flex items-center gap-2.5 rounded-full border border-sky-100 bg-gradient-to-br from-sky-50/90 to-blue-50/50 py-1.5 pl-2 pr-3.5 dark:border-sky-500/20 dark:from-sky-500/10 dark:to-blue-500/5"
                          >
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-[0_4px_10px_-2px_rgba(2,132,199,0.5)]">
                              {promo.icon === 'delivery' ? (
                                <span className="text-[13px] leading-none">🛵</span>
                              ) : (
                                <Tag className="h-4 w-4" strokeWidth={1.8} />
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-[12px] font-bold text-neutral-900 dark:text-white">{promo.title}</p>
                              <p className="truncate text-[11px] font-medium text-neutral-500 dark:text-zinc-400">{promo.subtitle}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </section>

              {showDistanceNotice && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-md px-4 py-6" onClick={() => setShowDistanceNotice(false)}>
                  <div
                    className="relative w-full max-w-md rounded-[28px] border border-black/5 bg-white p-6 shadow-[0_24px_80px_rgba(15,15,15,0.25)] dark:border-zinc-800 dark:bg-neutral-900"
                    onClick={(e) => e.stopPropagation()}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Fuera de la zona de entrega"
                  >
                    <button
                      type="button"
                      onClick={() => setShowDistanceNotice(false)}
                      className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 active:scale-90 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                      aria-label="Cerrar"
                    >
                      <X className="h-4 w-4" />
                    </button>

                    <div className="flex flex-col items-center text-center">
                      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-[20px] bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-[0_10px_28px_rgba(2,132,199,0.45)]">
                        <MapPin className="h-6 w-6" strokeWidth={2} />
                      </div>
                      <h3 className="text-lg font-extrabold tracking-tight text-neutral-900 dark:text-white">Estás fuera de la zona de entrega</h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-neutral-500 dark:text-zinc-400">
                        {restaurant?.name} entrega a domicilio dentro de{' '}
                        <strong className="font-bold text-neutral-900 dark:text-white">{restaurant?.deliveryRadius || 3} km</strong> y estás a{' '}
                        <strong className="font-bold text-neutral-900 dark:text-white">{typeof distanceKm === 'number' ? `${distanceKm.toFixed(1)} km` : '—'}</strong>.
                      </p>
                    </div>

                    <div className="mt-5 space-y-2.5">
                      <div className="flex items-start gap-3 rounded-2xl border border-black/[0.05] bg-neutral-50 p-3.5 dark:border-zinc-800 dark:bg-zinc-800/50">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-sky-600 shadow-sm dark:bg-zinc-900 dark:text-sky-400">
                          <Store className="h-[18px] w-[18px]" strokeWidth={1.8} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[13px] font-bold text-neutral-900 dark:text-white">Recoger en tienda</p>
                          <p className="text-xs leading-relaxed text-neutral-500 dark:text-zinc-400">Pide ahora y pasa por tu pedido sin costo de envío.</p>
                        </div>
                      </div>

                      {getAcceptedPaymentMethods(restaurant).includes('TRANSFER') && (
                        <div className="flex items-start gap-3 rounded-2xl border border-black/[0.05] bg-neutral-50 p-3.5 dark:border-zinc-800 dark:bg-zinc-800/50">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-600 shadow-sm dark:bg-zinc-900 dark:text-emerald-400">
                            <Banknote className="h-[18px] w-[18px]" strokeWidth={1.8} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[13px] font-bold text-neutral-900 dark:text-white">Pago por transferencia</p>
                            <p className="text-xs leading-relaxed text-neutral-500 dark:text-zinc-400">Este negocio acepta transferencias con comprobante directo.</p>
                          </div>
                        </div>
                      )}

                      {restaurant?.businessType && restaurant.businessType !== 'RESTAURANT' && (
                        <div className="flex items-start gap-3 rounded-2xl border border-black/[0.05] bg-neutral-50 p-3.5 dark:border-zinc-800 dark:bg-zinc-800/50">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-violet-600 shadow-sm dark:bg-zinc-900 dark:text-violet-400">
                            <Clock className="h-[18px] w-[18px]" strokeWidth={1.8} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[13px] font-bold text-neutral-900 dark:text-white">Entrega programada</p>
                            <p className="text-xs leading-relaxed text-neutral-500 dark:text-zinc-400">Las tiendas pueden coordinar el día y la hora de tu entrega.</p>
                          </div>
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowDistanceNotice(false)}
                      className="mt-5 w-full rounded-2xl bg-neutral-900 py-3.5 text-sm font-bold text-white transition-all duration-200 hover:bg-neutral-800 active:scale-[0.98] dark:bg-white dark:text-neutral-950 dark:hover:bg-zinc-200"
                    >
                      Entendido, ver menú
                    </button>
                  </div>
                </div>
              )}

              <div data-sticky-header className="sticky top-[calc(env(safe-area-inset-top)+72px)] z-20 -mx-4 mb-6 bg-[var(--menu-surface)] shadow-[0_1px_2px_rgba(0,0,0,0.03),0_8px_24px_rgba(0,0,0,0.05)] border-b border-black/[0.04] md:-mx-6 lg:-mx-7 dark:bg-[var(--menu-surface-dark)] dark:border-zinc-800/60">
                <div className="px-4 py-3 md:px-6 md:py-3.5 lg:px-7">
                  <div className="relative w-full max-w-2xl mx-auto lg:mx-0">
                    <Search className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-neutral-400 dark:text-zinc-500" strokeWidth={1.8} />
                    <input
                      type="text"
                      placeholder={`Buscar en ${restaurant?.name || 'el menú'}...`}
                      value={productSearchQuery}
                      onChange={(e) => setProductSearchQuery(e.target.value)}
                      className={`w-full rounded-full border bg-white pl-11 pr-11 py-3 text-base text-neutral-900 outline-none transition-all duration-200 placeholder:text-neutral-400 focus:border-black/25 focus:shadow-[0_4px_16px_rgba(0,0,0,0.07)] active:border-black/15 dark:bg-neutral-900 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-600 dark:focus:shadow-none ${
                        productSearchQuery
                          ? 'border-black/20 dark:border-zinc-700'
                          : 'border-black/[0.09] dark:border-zinc-800'
                      }`}
                    />
                    {productSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setProductSearchQuery('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-neutral-400 hover:text-neutral-700 transition-colors rounded-full hover:bg-neutral-100 active:scale-90 dark:text-zinc-500 dark:hover:text-zinc-200 dark:hover:bg-zinc-800"
                        aria-label="Limpiar búsqueda"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
                {!productSearchQuery.trim() && (
                <div className="pb-2.5">
                  <div
                    ref={categoryNavRef}
                    className="flex overflow-x-auto px-4 pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden snap-x snap-proximity md:snap-none md:px-6 lg:px-7"
                  >
                    <div className="flex min-w-max gap-1.5 mx-auto sm:gap-2">
                      {(productSearchQuery.trim() ? (filteredRestaurant?.categories ?? []) : restaurant.categories).map((category) => {
                        const isActive = activeCategory === category.id;
                        return (
                          <button
                            type="button"
                            key={category.id}
                            data-category-id={category.id}
                            onClick={() => scrollToCategory(category.id)}
                            aria-current={isActive ? 'true' : undefined}
                            className={`whitespace-nowrap rounded-full px-4 py-2.5 text-[13px] font-semibold transition-all duration-200 active:scale-[0.97] ${
                              isActive
                                ? 'text-[var(--menu-accent)] dark:text-sky-400 shadow-[inset_0_0_0_1.5px_var(--menu-accent)] dark:shadow-[inset_0_0_0_1.5px_rgb(56_189_248/0.45)]'
                                : 'text-neutral-500 hover:bg-black/[0.045] hover:text-neutral-800 dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-zinc-100'
                            }`}
                            style={
                              isActive
                                ? { backgroundColor: 'color-mix(in srgb, var(--menu-accent) 13%, transparent)' }
                                : undefined
                            }
                          >
                            {category.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
                )}
              </div>

              {productSearchQuery.trim() ? (
                searchResults.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-neutral-100">
                      <Search className="h-7 w-7 text-neutral-400" strokeWidth={1.8} />
                    </div>
                    <p className="text-lg font-semibold text-neutral-700">Sin resultados</p>
                    <p className="mt-1 text-sm text-neutral-500">No encontramos productos que coincidan con tu búsqueda.</p>
                    <button
                      type="button"
                      onClick={() => setProductSearchQuery('')}
                      className="mt-4 rounded-full bg-neutral-100 px-6 py-2.5 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-200"
                    >
                      Limpiar búsqueda
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {searchResults.map((product) => {
                      const quantity = getCartQuantity(product.id);
                      return (
                        <article id={product.id} key={product.id} className="overflow-hidden rounded-[24px] border border-black/[0.04] bg-[var(--menu-card)] transition-all duration-300 shadow-[0_2px_12px_rgba(0,0,0,0.02)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] dark:border-zinc-800 dark:bg-[var(--menu-card-dark)]">
                          <div className="flex gap-4 p-4">
                            <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-2xl sm:h-28 sm:w-28">
                              {product.image ? (
                                <img src={product.image} alt={product.name} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                              ) : (
                                <div className="h-full w-full bg-gradient-to-br from-neutral-100 to-neutral-200 dark:from-zinc-800 dark:to-zinc-900" />
                              )}
                            </div>
                            <div className="flex min-w-0 flex-1 flex-col justify-between">
                              <div>
                                <h3 className="text-base font-semibold text-neutral-950 dark:text-white">{product.name}</h3>
                                <p className="mt-0.5 text-sm text-neutral-500 line-clamp-2 leading-snug dark:text-zinc-400">{product.description}</p>
                              </div>
                              <div className="mt-2 flex items-center justify-between gap-3">
                                {product.discountPrice ? (
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-lg font-bold text-neutral-950 dark:text-white">{formatCurrency(product.discountPrice)}</span>
                                    <span className="text-xs text-neutral-400 line-through dark:text-zinc-500">{formatCurrency(product.price)}</span>
                                  </div>
                                ) : (
                                  <span className="text-lg font-bold text-neutral-950 dark:text-white">{formatCurrency(product.price)}</span>
                                )}
                                {quantity > 0 ? (
                                  <div className="flex items-center gap-0.5 rounded-full border border-black/[0.06] bg-neutral-50 p-0.5 dark:border-zinc-700 dark:bg-neutral-800">
                                    <button type="button" onClick={() => { if (product.optionGroups?.length) { decreaseQuantityForProduct(product.id); } else { updateCartItem(product.id, { quantity: quantity - 1 }); } }} className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 transition-all hover:bg-white active:scale-90 dark:text-zinc-300 dark:hover:bg-zinc-700">
                                      {quantity === 1 ? (
                                        <Trash2 className="h-3 w-3 text-red-500" />
                                      ) : (
                                        <Minus className="h-3 w-3" strokeWidth={2.5} />
                                      )}
                                    </button>
                                    <span className="flex h-7 w-7 items-center justify-center text-xs font-bold text-neutral-900 dark:text-white">{quantity}</span>
                                    <button type="button" onClick={() => addToCart(product)} className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 transition-all hover:bg-white active:scale-90 dark:text-zinc-300 dark:hover:bg-zinc-700">
                                      <Plus className="h-3 w-3" strokeWidth={2.5} />
                                    </button>
                                  </div>
                                ) : (
                                  <button type="button" onClick={() => addToCart(product)} disabled={!restaurant?.isOpen} className="rounded-full bg-neutral-100 px-4 py-2 text-sm font-bold text-neutral-900 transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:text-neutral-400 dark:bg-zinc-100 dark:text-neutral-950 dark:hover:bg-white dark:disabled:bg-zinc-800 dark:disabled:text-zinc-600">
                                    Agregar
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )
              ) : restaurant.categories.map((category) => {
                const isPromotions = category.id === '__promotions__';
                const isPromoCarousel = isPromotions && category.products.length <= 6;
                const isStore = !isRestaurant((restaurant as any).businessType);
                const isLargeCategory = isStore && !isPromotions && category.products.length > 4;
                return (
                <section
                  key={category.id}
                  id={category.id}
                  ref={(node) => {
                    categorySectionRefs.current[category.id] = node;
                  }}
                  className="scroll-mt-[184px] mb-10 px-0 py-0 md:scroll-mt-[184px]"
                >
                  <div className="flex items-center justify-between gap-4 mb-2">
                    <h2 className="text-2xl font-bold tracking-[-0.03em] text-neutral-950 dark:text-white">{category.name}</h2>
                    <span className="shrink-0 rounded-full bg-gradient-to-r from-sky-50 to-white px-3 py-1.5 text-[11px] font-bold text-[var(--menu-accent)] border border-sky-100/60 shadow-[0_2px_8px_rgba(14,165,233,0.08)] sm:text-xs">
                      {category.products.length} productos
                    </span>
                  </div>

                  <div className={isPromoCarousel || isLargeCategory ? "relative mt-5" : "mt-5 overflow-hidden"}>
                    <CarouselOrGrid
                      isCarousel={isPromoCarousel || isLargeCategory}
                      gridClassName={
                        isStore && !isPromotions && category.products.length <= 4
                          ? 'grid grid-cols-2 gap-4 lg:grid-cols-2'
                          : 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3'
                      }
                    >
                    {category.products.map((product) => {
                      const quantity = getCartQuantity(product.id);
                      const avail = getProductAvailability(product);

                      return (
                        isPromoCarousel ? (
                          <article id={product.id} key={product.id} className="group w-32 shrink-0 snap-start overflow-hidden rounded-2xl border border-black/[0.04] bg-white transition-all duration-300 shadow-[0_2px_8px_rgba(0,0,0,0.02)] hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] active:scale-[0.98] dark:border-zinc-800 dark:bg-neutral-900">
                          
                            <div className="relative overflow-hidden">
                              {product.image ? (
                                <img src={product.image} alt={product.name} className="h-20 w-full object-cover transition duration-300 group-hover:scale-105" loading="lazy" decoding="async" />
                              ) : (
                                <div className="flex h-20 w-full items-center justify-center bg-gradient-to-br from-neutral-100 to-neutral-200 dark:from-zinc-800 dark:to-zinc-900">
                                  <svg className="h-6 w-6 text-neutral-400 dark:text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM13.5 10.5h-3" />
                                  </svg>
                                </div>
                              )}
                              {product.discountPrice && (
                                <div className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-rose-500/90 px-1.5 py-0.5 text-[8px] font-bold text-white shadow-sm backdrop-blur-sm">
                                  <span>-{Math.round((1 - product.discountPrice / product.price) * 100)}%</span>
                                </div>
                              )}
                              {getMultiBuyInfo(product).isMultiBuy && (
                                <div className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-emerald-600/90 px-1.5 py-0.5 text-[8px] font-bold text-white shadow-sm">
                                  <span>{getMultiBuyInfo(product).buy}x{getMultiBuyInfo(product).pay}</span>
                                </div>
                              )}
                              <StockBadge avail={avail} />
                            </div>
                            <div className="px-1.5 pb-1.5 pt-1">
                              <h3 className="truncate text-[11px] font-bold leading-tight text-neutral-900 dark:text-white">{product.name}</h3>
                              {product.sellBy === 'WEIGHT' ? (
                                <p className="mt-0.5 text-[11px] font-bold text-neutral-900 dark:text-white">{formatCurrency(product.unitPrice || product.price)}/kg</p>
                              ) : getMultiBuyInfo(product).isMultiBuy ? (
                                <div className="mt-0.5">
                                  <p className="text-xs font-bold text-neutral-900 dark:text-white">{formatCurrency(getMultiBuyInfo(product).basePrice)}</p>
                                  <p className="truncate text-[9px] font-semibold text-emerald-600">Llevando {getMultiBuyInfo(product).buy}: {formatCurrency(getMultiBuyInfo(product).effectiveUnitPrice)} c/u</p>
                                </div>
                              ) : product.discountPrice ? (
                                <div className="mt-0.5 flex items-baseline gap-1">
                                  <span className="text-xs font-bold text-rose-600">{formatCurrency(product.discountPrice)}</span>
                                  <span className="text-[9px] text-neutral-400 line-through dark:text-zinc-500">{formatCurrency(product.price)}</span>
                                </div>
                              ) : (
                                <p className="mt-0.5 text-xs font-bold text-neutral-900 dark:text-white">{formatCurrency(product.price)}</p>
                              )}
                              {product.discountPrice && (
                                <span className="mt-0.5 inline-block rounded-full bg-emerald-50 px-1 py-0.5 text-[8px] font-bold text-emerald-600 dark:bg-emerald-500/10">
                                  -{formatCurrency(product.price - product.discountPrice)}
                                </span>
                              )}
                              <div className="mt-1.5">
                                {quantity > 0 ? (
                                  <div className="flex w-fit items-center gap-0.5 rounded-lg border border-black/[0.06] bg-neutral-50 p-0.5 dark:border-zinc-700 dark:bg-neutral-800">
                                    <button type="button" onClick={() => { if (product.optionGroups?.length) { decreaseQuantityForProduct(product.id); } else { updateCartItem(product.id, { quantity: quantity - 1 }); } }} className="flex h-5 w-5 items-center justify-center rounded-md text-neutral-500 transition-all hover:bg-white active:scale-90 dark:text-zinc-300 dark:hover:bg-zinc-700" aria-label={`Quitar una unidad de ${product.name}`}>
                                      {quantity === 1 ? (
                                        <Trash2 className="h-2.5 w-2.5 text-red-500" />
                                      ) : (
                                        <Minus className="h-2 w-2" strokeWidth={2.5} />
                                      )}
                                    </button>
                                    <span className="flex h-5 w-5 items-center justify-center text-[10px] font-bold text-neutral-900 dark:text-white">{quantity}</span>
                                    <button type="button" onClick={() => addToCart(product)} disabled={!avail.available || (avail.tracked && quantity >= avail.maxQty)} className="flex h-5 w-5 items-center justify-center rounded-md text-neutral-500 transition-all hover:bg-white active:scale-90 dark:text-zinc-300 dark:hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed" aria-label={`Agregar una unidad de ${product.name}`}>
                                      <Plus className="h-2 w-2" strokeWidth={2.5} />
                                    </button>
                                  </div>
                                ) : (
                                  <button type="button" onClick={() => addToCart(product)} disabled={!restaurant.isOpen || !avail.available} className="w-full rounded-lg bg-neutral-900 py-1.5 text-[10px] font-bold text-white transition hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-400 dark:bg-white dark:text-neutral-950 dark:hover:bg-zinc-200 dark:disabled:bg-neutral-800 dark:disabled:text-zinc-600">
                                    Agregar
                                  </button>
                                )}
                              </div>
                            </div>
                          </article>
                        ) : isLargeCategory ? (
                          <article id={product.id} key={product.id} className="w-[42vw] shrink-0 snap-start sm:w-52 overflow-hidden rounded-2xl border border-black/[0.04] bg-white transition-all duration-300 shadow-[0_2px_12px_rgba(0,0,0,0.02)] hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] dark:border-zinc-800 dark:bg-neutral-900">
                            <div className="flex h-full flex-col">
                              <div
                                className="relative aspect-square overflow-hidden bg-neutral-50 cursor-pointer dark:bg-neutral-900"
                                onClick={() => openProductPreview(product)}
                              >
                                {product.image ? (
                                  <img
                                    src={(product.images?.length ?? 0) > 1 && carouselIndexMap[product.id] ? product.images![carouselIndexMap[product.id]] : product.image}
                                    alt={product.name}
                                    className="h-full w-full object-contain transition duration-300 hover:scale-105"
                                    style={{ objectPosition: product.imagePosition || 'center' }}
                                    loading="lazy"
                                    decoding="async"
                                  />
                                ) : (
                                  <div className="h-full w-full bg-gradient-to-br from-neutral-100 to-neutral-200 dark:from-zinc-800 dark:to-zinc-900" />
                                )}
                                {product.discountPrice && (
                                  <div className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-rose-500/90 px-2 py-0.5 text-[9px] font-bold text-white shadow-sm">
                                    <span>-{Math.round((1 - product.discountPrice / product.price) * 100)}%</span>
                                  </div>
                                )}
                                {getMultiBuyInfo(product).isMultiBuy && (
                                  <div className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-emerald-600/90 px-2 py-0.5 text-[9px] font-bold text-white shadow-sm">
                                    <span>{getMultiBuyInfo(product).buy}x{getMultiBuyInfo(product).pay}</span>
                                  </div>
                                )}
                                <StockBadge avail={avail} />
                              </div>
                              <div className="flex flex-1 flex-col p-3">
<h3 className="text-sm font-bold leading-snug text-neutral-900 line-clamp-2 dark:text-white">{product.name}</h3>
                                {product.sellBy === 'WEIGHT' ? (
                                  <p className="mt-0.5 text-xs font-semibold text-neutral-500 dark:text-zinc-400">{formatCurrency(product.unitPrice || product.price)}/kg</p>
                                ) : getMultiBuyInfo(product).isMultiBuy ? (
                                  <div className="mt-0.5">
                                    <p className="text-xs font-bold text-neutral-900 dark:text-white">{formatCurrency(getMultiBuyInfo(product).basePrice)}</p>
                                    <p className="truncate text-[9px] font-semibold text-emerald-600">Llevando {getMultiBuyInfo(product).buy}: {formatCurrency(getMultiBuyInfo(product).effectiveUnitPrice)} c/u</p>
                                  </div>
                                ) : product.discountPrice ? (
                                  <div className="mt-0.5 flex items-baseline gap-1.5">
                                    <span className="text-xs font-bold text-rose-600">{formatCurrency(product.discountPrice)}</span>
                                    <span className="text-[10px] text-neutral-400 line-through dark:text-zinc-500">{formatCurrency(product.price)}</span>
                                  </div>
                                ) : (
                                  <p className="mt-0.5 text-xs font-semibold text-neutral-500 dark:text-zinc-400">{formatCurrency(product.price)}</p>
                                )}
                                {product.description && (
                                  <div className="mt-1.5">
                                    <p className="text-[11px] leading-snug text-neutral-500 line-clamp-2 dark:text-zinc-400">{product.description}</p>
                                    {product.description.length > 60 && (
                                      <button
                                        type="button"
                                        onClick={() => openProductPreview(product)}
                                        className="mt-0.5 text-[11px] font-bold text-neutral-900 underline-offset-2 transition hover:underline dark:text-white"
                                      >
                                        Ver más
                                      </button>
                                    )}
                                  </div>
                                )}
                                <div className="mt-auto pt-3">
                                  {quantity > 0 ? (
                                    <div className="flex w-fit items-center gap-0.5 rounded-full border border-black/[0.06] bg-neutral-50 p-0.5 dark:border-zinc-700 dark:bg-neutral-800">
                                      <button type="button" onClick={() => { if (product.optionGroups?.length) { decreaseQuantityForProduct(product.id); } else { updateCartItem(product.id, { quantity: quantity - 1 }); } }} className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 transition-all hover:bg-white active:scale-90 dark:text-zinc-300 dark:hover:bg-zinc-700" aria-label={`Quitar una unidad de ${product.name}`}>
                                        {quantity === 1 ? (
                                          <Trash2 className="h-3 w-3 text-red-500" />
                                        ) : (
                                          <Minus className="h-3 w-3" strokeWidth={2.5} />
                                        )}
                                      </button>
                                      <span className="flex h-7 w-7 items-center justify-center text-xs font-bold text-neutral-900 dark:text-white">{quantity}</span>
                                      <button type="button" onClick={() => addToCart(product)} disabled={!avail.available || (avail.tracked && quantity >= avail.maxQty)} className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 transition-all hover:bg-white active:scale-90 dark:text-zinc-300 dark:hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed" aria-label={`Agregar una unidad de ${product.name}`}>
                                        <Plus className="h-3 w-3" strokeWidth={2.5} />
                                      </button>
                                    </div>
                                  ) : (
                                    <button type="button" onClick={() => addToCart(product)} disabled={!restaurant.isOpen || !avail.available} className="w-full rounded-xl bg-neutral-900 py-2.5 text-[11px] font-bold text-white transition hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-400 dark:bg-white dark:text-neutral-950 dark:hover:bg-zinc-200 dark:disabled:bg-neutral-800 dark:disabled:text-zinc-600">
                                      Agregar
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </article>
                        ) : isStore ? (
                          <article id={product.id} key={product.id} className="overflow-hidden rounded-2xl border border-black/[0.04] bg-white transition-all duration-300 shadow-[0_2px_12px_rgba(0,0,0,0.02)] hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] dark:border-zinc-800 dark:bg-neutral-900">
                            <div className="flex h-full flex-col">
                              <div
                                className="relative aspect-square overflow-hidden bg-neutral-50 cursor-pointer dark:bg-neutral-900"
                                onClick={() => openProductPreview(product)}
                              >
                                {product.image ? (
                                  <img
                                    src={(product.images?.length ?? 0) > 1 && carouselIndexMap[product.id] ? product.images![carouselIndexMap[product.id]] : product.image}
                                    alt={product.name}
                                    className="h-full w-full object-contain transition duration-300 hover:scale-105"
                                    style={{ objectPosition: product.imagePosition || 'center' }}
                                    loading="lazy"
                                    decoding="async"
                                  />
                                ) : (
                                  <div className="h-full w-full bg-gradient-to-br from-neutral-100 to-neutral-200 dark:from-zinc-800 dark:to-zinc-900" />
                                )}
                                {product.discountPrice && (
                                  <div className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-rose-500/90 px-2 py-0.5 text-[9px] font-bold text-white shadow-sm">
                                    <span>-{Math.round((1 - product.discountPrice / product.price) * 100)}%</span>
                                  </div>
                                )}
                                {getMultiBuyInfo(product).isMultiBuy && (
                                  <div className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-emerald-600/90 px-2 py-0.5 text-[9px] font-bold text-white shadow-sm">
                                    <span>{getMultiBuyInfo(product).buy}x{getMultiBuyInfo(product).pay}</span>
                                  </div>
                                )}
                                <StockBadge avail={avail} />
                              </div>
                              <div className="flex flex-1 flex-col p-3">
                                <h3 className="text-sm font-bold leading-snug text-neutral-900 line-clamp-2 dark:text-white">{product.name}</h3>
                                {product.sellBy === 'WEIGHT' ? (
                                  <p className="mt-0.5 text-xs font-semibold text-neutral-500 dark:text-zinc-400">{formatCurrency(product.unitPrice || product.price)}/kg</p>
                                ) : getMultiBuyInfo(product).isMultiBuy ? (
                                  <div className="mt-0.5">
                                    <p className="text-xs font-bold text-neutral-900 dark:text-white">{formatCurrency(getMultiBuyInfo(product).basePrice)}</p>
                                    <p className="truncate text-[9px] font-semibold text-emerald-600">Llevando {getMultiBuyInfo(product).buy}: {formatCurrency(getMultiBuyInfo(product).effectiveUnitPrice)} c/u</p>
                                  </div>
                                ) : product.discountPrice ? (
                                  <div className="mt-0.5 flex items-baseline gap-1.5">
                                    <span className="text-xs font-bold text-rose-600">{formatCurrency(product.discountPrice)}</span>
                                    <span className="text-[10px] text-neutral-400 line-through dark:text-zinc-500">{formatCurrency(product.price)}</span>
                                  </div>
                                ) : (
                                  <p className="mt-0.5 text-xs font-semibold text-neutral-500 dark:text-zinc-400">{formatCurrency(product.price)}</p>
                                )}
                                {product.description && (
                                  <div className="mt-1.5">
                                    <p className="text-[11px] leading-snug text-neutral-500 line-clamp-2 dark:text-zinc-400">{product.description}</p>
                                    {product.description.length > 60 && (
                                      <button
                                        type="button"
                                        onClick={() => openProductPreview(product)}
                                        className="mt-0.5 text-[11px] font-bold text-neutral-900 underline-offset-2 transition hover:underline dark:text-white"
                                      >
                                        Ver más
                                      </button>
                                    )}
                                  </div>
                                )}
                                <div className="mt-auto pt-3">
                                  {quantity > 0 ? (
                                    <div className="flex w-fit items-center gap-0.5 rounded-full border border-black/[0.06] bg-neutral-50 p-0.5 dark:border-zinc-700 dark:bg-neutral-800">
                                      <button type="button" onClick={() => { if (product.optionGroups?.length) { decreaseQuantityForProduct(product.id); } else { updateCartItem(product.id, { quantity: quantity - 1 }); } }} className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 transition-all hover:bg-white active:scale-90 dark:text-zinc-300 dark:hover:bg-zinc-700" aria-label={`Quitar una unidad de ${product.name}`}>
                                        {quantity === 1 ? (
                                          <Trash2 className="h-3 w-3 text-red-500" />
                                        ) : (
                                          <Minus className="h-3 w-3" strokeWidth={2.5} />
                                        )}
                                      </button>
                                      <span className="flex h-7 w-7 items-center justify-center text-xs font-bold text-neutral-900 dark:text-white">{quantity}</span>
                                      <button type="button" onClick={() => addToCart(product)} disabled={!avail.available || (avail.tracked && quantity >= avail.maxQty)} className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 transition-all hover:bg-white active:scale-90 dark:text-zinc-300 dark:hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed" aria-label={`Agregar una unidad de ${product.name}`}>
                                        <Plus className="h-3 w-3" strokeWidth={2.5} />
                                      </button>
                                    </div>
                                  ) : (
                                    <button type="button" onClick={() => addToCart(product)} disabled={!restaurant.isOpen || !avail.available} className="w-full rounded-xl bg-neutral-900 py-2.5 text-[11px] font-bold text-white transition hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-400 dark:bg-white dark:text-neutral-950 dark:hover:bg-zinc-200 dark:disabled:bg-neutral-800 dark:disabled:text-zinc-600">
                                      Agregar
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </article>
                        ) : (
                          <article id={product.id} key={product.id} className="overflow-hidden rounded-2xl border border-black/[0.04] bg-white transition-all duration-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] dark:border-zinc-800 dark:bg-neutral-900">
                            <div className="flex gap-3 p-3">
                              <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl sm:h-28 sm:w-28">
                                {product.image ? (
                                  <>
                                    <img
                                      src={(product.images?.length ?? 0) > 1 && carouselIndexMap[product.id] ? product.images![carouselIndexMap[product.id]] : product.image}
                                      alt={product.name}
                                      loading="lazy" decoding="async"
                                      className="h-full w-full object-cover transition-opacity duration-300"
                                      style={{ objectPosition: product.imagePosition || undefined }}
                                    />
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
                                          className="absolute left-1 top-1/2 z-10 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-white/70 text-[10px] text-neutral-700 shadow-sm transition hover:bg-white"
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
                                          className="absolute right-1 top-1/2 z-10 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-white/70 text-[10px] text-neutral-700 shadow-sm transition hover:bg-white"
                                        >
                                          ›
                                        </button>
                                        <div className="absolute bottom-1 left-1/2 z-10 flex -translate-x-1/2 gap-1">
                                          {(product.images || []).map((_, idx) => (
                                            <span
                                              key={idx}
                                              className={`h-1 rounded-full transition-all ${idx === (carouselIndexMap[product.id] || 0) ? 'w-3 bg-white' : 'w-1 bg-white/60'}`}
                                            />
                                          ))}
                                        </div>
                                      </>
                                    )}
                                  </>
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-neutral-100 to-neutral-200">
                                    <svg className="h-6 w-6 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM13.5 10.5h-3" />
                                    </svg>
                                  </div>
                                )}
                                {product.discountPrice && (
                                  <div className="absolute left-1.5 top-1.5 z-10 flex items-center gap-0.5 rounded-full bg-rose-500/90 px-1.5 py-0.5 text-[8px] font-bold text-white shadow-sm">
                                    <span>-{Math.round((1 - product.discountPrice / product.price) * 100)}%</span>
                                  </div>
                                )}
                                {getMultiBuyInfo(product).isMultiBuy && (
                                  <div className="absolute right-1.5 top-1.5 z-10 flex items-center gap-0.5 rounded-full bg-emerald-600/90 px-1.5 py-0.5 text-[8px] font-bold text-white shadow-sm">
                                    <span>{getMultiBuyInfo(product).buy}x{getMultiBuyInfo(product).pay}</span>
                                  </div>
                                )}
                                <StockBadge avail={avail} />
                              </div>
                              <div className="flex min-w-0 flex-1 flex-col">
                                <div className="flex flex-col gap-0.5">
                                  <h3 className="truncate text-sm font-bold text-neutral-900 dark:text-white">{product.name}</h3>
                                  {product.description && (
                                    <p className="text-xs leading-relaxed text-neutral-500 line-clamp-2 dark:text-zinc-400">{product.description}</p>
                                  )}
                                  <div className="mt-0.5">
                                    {product.sellBy === 'WEIGHT' ? (
                                      <span className="text-sm font-bold text-neutral-900 dark:text-white">{formatCurrency(product.unitPrice || product.price)}/kg</span>
                                    ) : getMultiBuyInfo(product).isMultiBuy ? (
                                      <div className="mt-0.5">
                                        <span className="text-sm font-bold text-neutral-900 dark:text-white">{formatCurrency(getMultiBuyInfo(product).basePrice)}</span>
                                        <p className="truncate text-[10px] font-semibold text-emerald-600">Llevando {getMultiBuyInfo(product).buy}: {formatCurrency(getMultiBuyInfo(product).effectiveUnitPrice)} c/u</p>
                                      </div>
                                    ) : product.discountPrice ? (
                                      <div className="flex items-baseline gap-1.5">
                                        <span className="text-sm font-bold text-rose-600">{formatCurrency(product.discountPrice)}</span>
                                        <span className="text-[10px] text-neutral-400 line-through dark:text-zinc-500">{formatCurrency(product.price)}</span>
                                      </div>
                                    ) : (
                                      <span className="text-sm font-bold text-neutral-900 dark:text-white">{formatCurrency(product.price)}</span>
                                    )}
                                  </div>
                                </div>
                                <div className="mt-auto pt-3 flex justify-end">
                                  {quantity > 0 ? (
                                    <div className="flex w-fit items-center gap-0.5 rounded-full border border-black/[0.06] bg-neutral-50 p-0.5 dark:border-zinc-700 dark:bg-neutral-800">
                                      <button type="button" onClick={() => { if (product.optionGroups?.length) { decreaseQuantityForProduct(product.id); } else { updateCartItem(product.id, { quantity: quantity - 1 }); } }} className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 transition-all hover:bg-white active:scale-90 dark:text-zinc-300 dark:hover:bg-zinc-700" aria-label={`Quitar una unidad de ${product.name}`}>
                                        {quantity === 1 ? (
                                          <Trash2 className="h-3 w-3 text-red-500" />
                                        ) : (
                                          <Minus className="h-3 w-3" strokeWidth={2.5} />
                                        )}
                                      </button>
                                      <span className="flex h-7 w-7 items-center justify-center text-xs font-bold text-neutral-900 dark:text-white">{quantity}</span>
                                      <button type="button" onClick={() => addToCart(product)} disabled={!avail.available || (avail.tracked && quantity >= avail.maxQty)} className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 transition-all hover:bg-white active:scale-90 dark:text-zinc-300 dark:hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed" aria-label={`Agregar una unidad de ${product.name}`}>
                                        <Plus className="h-3 w-3" strokeWidth={2.5} />
                                      </button>
                                    </div>
                                  ) : (
                                    <button type="button" onClick={() => addToCart(product)} disabled={!restaurant.isOpen || !avail.available} className="rounded-xl bg-neutral-900 px-5 py-2.5 text-[11px] font-bold text-white transition hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-400 dark:bg-white dark:text-neutral-950 dark:hover:bg-zinc-200 dark:disabled:bg-neutral-800 dark:disabled:text-zinc-600">
                                      Agregar
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </article>
                        )
                      );
                    })}
                    </CarouselOrGrid>
                     
                  </div>
                </section>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="mt-8">
            <EmptyState text="No encontramos este restaurante." />
          </div>
        )}

        {restaurant && (
          <div className="border-t border-black/5 pt-8 pb-4 mt-8">
            <p className="text-center text-sm font-semibold text-neutral-500 mb-4">
              Sigue a {restaurant.name} en redes sociales
            </p>
            <div className="flex items-center justify-center gap-4 min-h-[48px]">
              {restaurant.instagram && (
                <a
                  href={restaurant.instagram}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-pink-500 via-purple-500 to-orange-400 text-white shadow-lg shadow-pink-200/50 transition-all hover:scale-110 hover:shadow-xl"
                  aria-label="Instagram"
                >
                  <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
                </a>
              )}
              {restaurant.facebook && (
                <a
                  href={restaurant.facebook}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#1877F2] text-white shadow-lg shadow-blue-200/50 transition-all hover:scale-110 hover:shadow-xl"
                  aria-label="Facebook"
                >
                  <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                </a>
              )}
              {restaurant.tiktok && (
                <a
                  href={restaurant.tiktok}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-12 w-12 items-center justify-center rounded-2xl bg-black text-white shadow-lg shadow-neutral-300/50 transition-all hover:scale-110 hover:shadow-xl"
                  aria-label="TikTok"
                >
                  <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>
                </a>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modal de Detalle de Pedido */}
      {isDetailModalOpen && selectedOrderId && activeOrderDetailsMap[selectedOrderId] && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 py-6">
          <div className="relative w-full max-w-[480px] rounded-[32px] bg-[#f9fafb] shadow-[0_30px_100px_rgba(0,0,0,0.2)] h-fit max-h-[90vh] overflow-y-auto no-scrollbar">
            {/* Encabezado Fijo con Botón de Cierre */}
            <div className="sticky top-0 z-10 flex items-center justify-between bg-[#f9fafb]/90 backdrop-blur-md px-6 py-5 border-b border-black/5">
              <h3 className="text-lg font-bold tracking-tight text-neutral-900">Detalles del pedido</h3>
              <button
                type="button"
                onClick={() => setIsDetailModalOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-200/60 text-neutral-600 transition hover:bg-neutral-300 hover:text-neutral-900"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
                </svg>
              </button>
            </div>

            <div className="px-6 py-6 space-y-6">
              <div className="space-y-6">
                {/* Header del Restaurante */}
                <div className="flex flex-col items-center text-center">
                  <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-white shadow-[0_8px_24px_rgba(0,0,0,0.04)] mb-4 border border-black/[0.03]">
                    <span className="text-2xl font-black tracking-tight text-neutral-800">
                      {activeOrderDetailsMap[selectedOrderId].restaurant.name.substring(0, 2).toUpperCase()}
                    </span>
                  </div>
                  <h2 className="text-2xl font-bold tracking-tight text-neutral-900">{activeOrderDetailsMap[selectedOrderId].restaurant.name}</h2>
                  <p className="mt-1 flex items-center gap-2 text-sm text-neutral-500">
                    {formatDate(activeOrderDetailsMap[selectedOrderId].createdAt)} 
                    <span className="h-1 w-1 rounded-full bg-neutral-300"></span> 
                    Ref #{(activeOrderDetailsMap[selectedOrderId] as any).dailyCounter || '...'}
                  </p>
                  <div className="mt-4">
                    <StatusBadge status={activeOrderDetailsMap[selectedOrderId].status} businessType={activeOrderDetailsMap[selectedOrderId].restaurant?.businessType} />
                  </div>
                </div>

                {/* Entrega programada */}
                {activeOrderDetailsMap[selectedOrderId].scheduledDeliveryAt && (
                  <div className={`flex items-center gap-3 p-4 rounded-2xl border shadow-sm ${activeOrderDetailsMap[selectedOrderId].scheduledDeliveryCustomerAcceptedAt ? 'bg-emerald-50 border-emerald-100' : 'bg-amber-50 border-amber-100'}`}>
                    <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white ${activeOrderDetailsMap[selectedOrderId].scheduledDeliveryCustomerAcceptedAt ? 'bg-emerald-600' : 'bg-amber-500'}`}>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="8" strokeWidth={2} />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 7v5l3 3" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <p className={`text-[10px] font-bold uppercase tracking-widest ${activeOrderDetailsMap[selectedOrderId].scheduledDeliveryCustomerAcceptedAt ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {activeOrderDetailsMap[selectedOrderId].scheduledDeliveryCustomerAcceptedAt ? 'Entrega programada' : 'Fecha programada'}
                      </p>
                      <p className="text-sm font-black text-neutral-900 leading-snug">
                        {new Date(activeOrderDetailsMap[selectedOrderId].scheduledDeliveryAt!).toLocaleDateString('es-MX', {
                          weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
                        })}
                      </p>
                      <p className="text-sm font-bold text-neutral-600">
                        {new Date(activeOrderDetailsMap[selectedOrderId].scheduledDeliveryAt!).toLocaleTimeString('es-MX', {
                          hour: '2-digit', minute: '2-digit'
                        })}
                      </p>
                    </div>
                  </div>
                )}

                {/* Mensaje de Smart Stacking */}
                {(activeOrderDetailsMap[selectedOrderId] as any).isSecondInRoute && (
                  <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-2xl border border-blue-100 text-blue-800 text-sm">
                    <span className="text-xl"><svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z" /></svg></span>
                    <p className="font-medium">
                      Tu repartidor está entregando un pedido cercano en tu ruta. ¡Llegará pronto!
                    </p>
                  </div>
                )}

                {/* Sin repartidor disponible: informar proactivamente */}
                {(() => {
                  const orderDetail = activeOrderDetailsMap[selectedOrderId];
                  if (orderDetail?.noDriversAvailable && orderDetail.status === 'READY') {
                    return (
                      <div className="flex items-start gap-3 p-4 rounded-2xl border border-amber-300 bg-amber-50/80 shadow-sm">
                        <span className="relative flex h-3 w-3 mt-1 shrink-0">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600">Buscando repartidor</p>
                          <p className="text-sm font-bold text-neutral-900">
                            Todavía no hay un repartidor disponible para tu pedido.
                          </p>
                          <p className="text-xs text-neutral-600 mt-1 leading-snug">
                            Estamos trabajando para asignarlo lo antes posible. No canceles tu pedido, llegará.
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedOrderId(selectedOrderId);
                              setIsChatOpen(true);
                              setIsDetailModalOpen(false);
                              void loadChatMessages(selectedOrderId);
                            }}
                            className="mt-3 w-full flex items-center justify-center gap-2 rounded-full bg-amber-500 hover:bg-amber-600 py-2.5 text-xs font-bold text-white shadow-sm transition-all active:scale-[0.97]"
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                            Contactar al negocio
                          </button>
                        </div>
                      </div>
                    );
                  }
                  return null;
                })()}

                {/* ETA — se muestra mientras el pedido no ha terminado */}
                {(() => {
                  const orderDetail = activeOrderDetailsMap[selectedOrderId];
                  const delayState = computeDelayState(orderDetail, Date.now());
                  if (delayState.isDelayed && delayState.referenceTime) {
                    return (
                      <div className="flex items-start gap-3 p-4 rounded-2xl border border-red-200 bg-red-50/70 shadow-sm">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-500 text-white">
                          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                          </svg>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-red-600">Va con retraso</p>
                          <p className="text-sm font-bold text-neutral-900">
                            Lleva {formatOverdueMinutes(delayState.minutesOverdue)} de retraso
                          </p>
                          <p className="text-xs text-neutral-600 mt-1 leading-snug">
                            {delayState.level === 3
                              ? 'Lo sentimos mucho. Estamos trabajando para que llegue lo antes posible.'
                              : 'Estamos trabajando en tu pedido. Gracias por tu paciencia.'}
                          </p>
                          {delayState.isScheduled && (
                            <p className="text-[11px] text-neutral-400 line-through mt-1">
                              Programada: {new Date(delayState.referenceTime).toLocaleDateString('es-MX', {
                                weekday: 'long', day: 'numeric', month: 'long'
                              })} ·{' '}
                              {new Date(delayState.referenceTime).toLocaleTimeString('es-MX', {
                                hour: '2-digit', minute: '2-digit'
                              })}
                            </p>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedOrderId(selectedOrderId);
                              setIsChatOpen(true);
                              setIsDetailModalOpen(false);
                              void loadChatMessages(selectedOrderId);
                            }}
                            className="mt-3 w-full flex items-center justify-center gap-2 rounded-full bg-red-500 hover:bg-red-600 py-2.5 text-xs font-bold text-white shadow-sm transition-all active:scale-[0.97]"
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                            Contactar al negocio
                          </button>
                        </div>
                      </div>
                    );
                  }
                  const etaText = formatEstimatedArrivalMinutes(
                    orderDetail.estimatedDeliveryTime,
                    orderDetail.status,
                    Date.now(),
                    orderDetail.restaurant?.businessType,
                    orderDetail.fulfillmentType
                  );
                  if (!etaText) return null;
                  return (
                    <div className="flex items-center gap-3 p-4 bg-white rounded-2xl border border-black/5 shadow-sm">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white">
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <circle cx="12" cy="12" r="8.5" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5V12l3 2" />
                        </svg>
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">Tiempo estimado</p>
                        <p className="text-sm font-bold text-neutral-900">{etaText}</p>
                      </div>
                    </div>
                  );
                })()}

                {/* Ticket unificado */}
                <div className="bg-white rounded-3xl border border-black/5 shadow-sm p-6 space-y-6">
                  <div className="space-y-4">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-400">Resumen</p>
                    <div className="space-y-4">
                      {activeOrderDetailsMap[selectedOrderId].items.map((item) => (
                        <div key={item.id} className="text-sm">
                          <div className="flex gap-3">
                            <span className="font-bold text-neutral-900 bg-neutral-100 rounded-lg px-2 py-0.5 h-fit">{item.quantity}</span>
                            <div>
                              <p className="font-medium text-neutral-900">{item.product.name}</p>
                              {item.sellBy === 'WEIGHT' && item.weightG && (
                                <p className="text-xs text-neutral-500 mt-0.5">
                                  {item.weightG >= 1000 ? `${item.weightG / 1000}kg` : `${item.weightG}g`} · {formatCurrency(item.unitPrice || 0)}/kg
                                </p>
                              )}
                              {item.specialInstructions && (
                                <p className="text-xs text-neutral-500 mt-1">
                                  Nota: "{item.specialInstructions}"
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border-t border-dashed border-neutral-200 pt-5 space-y-3 text-sm">
                    <div className="flex justify-between text-neutral-600">
                      <p>Subtotal</p>
                      <p className="font-medium text-neutral-900">{formatCurrency(activeOrderDetailsMap[selectedOrderId].subtotal)}</p>
                    </div>
                    <div className="flex justify-between text-neutral-600">
                      <p>Costo de envío</p>
                      <p className="font-medium text-neutral-900">{formatCurrency(activeOrderDetailsMap[selectedOrderId].deliveryFee)}</p>
                    </div>
                    <div className="flex justify-between text-neutral-600">
                      <p>Tarifa de servicio</p>
                      <p className="font-medium text-neutral-900">{formatCurrency(activeOrderDetailsMap[selectedOrderId].serviceFee)}</p>
                    </div>
                    {Number(activeOrderDetailsMap[selectedOrderId].promoDiscountAmount || 0) > 0 && (
                      <div className="flex justify-between text-sky-700">
                        <p>Descuento{activeOrderDetailsMap[selectedOrderId].promoCode ? ` (${activeOrderDetailsMap[selectedOrderId].promoCode})` : ''}</p>
                        <p className="font-bold text-sky-700">-{formatCurrency(Number(activeOrderDetailsMap[selectedOrderId].promoDiscountAmount))}</p>
                      </div>
                    )}
                    <div className="flex justify-between font-bold text-neutral-900 text-lg pt-4 border-t border-dashed border-neutral-200 mt-4">
                      <p>Total a pagar</p>
                      <p>{formatCurrency(activeOrderDetailsMap[selectedOrderId].totalAmount)}</p>
                    </div>
                  </div>
                </div>

                {activeOrderDetailsMap[selectedOrderId].fulfillmentType === 'PICKUP' ? (
                  /* Datos de Recolección */
                  <div className="bg-white rounded-3xl border border-black/5 shadow-sm p-6 space-y-4">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-400">Recolección</p>
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 shrink-0">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                      </div>
                      <div className="text-sm">
                        <p className="font-medium text-neutral-900">{activeOrderDetailsMap[selectedOrderId].restaurant.name}</p>
                        <p className="text-xs text-neutral-500">{activeOrderDetailsMap[selectedOrderId].restaurant.address}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 text-neutral-600 shrink-0">
                        <Mail className="w-4 h-4" />
                      </div>
                      <div className="text-sm">
                        <p className="font-medium text-neutral-900">{activeOrderDetailsMap[selectedOrderId].paymentMethod === 'CASH' ? 'Efectivo' : 'Transferencia'}</p>
                        <p className="text-xs text-neutral-500 uppercase">{activeOrderDetailsMap[selectedOrderId].paymentStatus}</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Datos de Entrega */
                  <div className="bg-white rounded-3xl border border-black/5 shadow-sm p-6 space-y-4">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-400">Entrega</p>
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 text-neutral-600 shrink-0">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                      </div>
                      <div className="text-sm">
                        <p className="font-medium text-neutral-900">{buildDetailAddressLabel(activeOrderDetailsMap[selectedOrderId].address)}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 text-neutral-600 shrink-0">
                        <Mail className="w-4 h-4" />
                      </div>
                      <div className="text-sm">
                        <p className="font-medium text-neutral-900">{activeOrderDetailsMap[selectedOrderId].paymentMethod === 'CASH' ? 'Efectivo' : 'Transferencia'}</p>
                        <p className="text-xs text-neutral-500 uppercase">{activeOrderDetailsMap[selectedOrderId].paymentStatus}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* deliveryPin (o handoverPin como fallback para pedidos previos) — solo delivery */}
                {activeOrderDetailsMap[selectedOrderId].fulfillmentType !== 'PICKUP' && (activeOrderDetailsMap[selectedOrderId].deliveryPin || activeOrderDetailsMap[selectedOrderId].handoverPin) && ['READY', 'PICKED_UP', 'IN_TRANSIT'].includes(activeOrderDetailsMap[selectedOrderId].status) && (
                  <div className="flex flex-col items-center justify-center p-5 bg-indigo-50/50 dark:bg-indigo-950/15 rounded-3xl border border-indigo-100/50 dark:border-indigo-900/30 shadow-sm text-center">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">Código de entrega</p>
                    <p className="mt-2 text-4xl font-black tracking-[0.25em] text-indigo-950 dark:text-indigo-200 font-mono pl-[0.25em]">
                      {activeOrderDetailsMap[selectedOrderId].deliveryPin || activeOrderDetailsMap[selectedOrderId].handoverPin}
                    </p>
                    <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">Proporciona este código al repartidor al recibir tu pedido.</p>
                  </div>
                )}

                {/* Notas del pedido */}
                {activeOrderDetailsMap[selectedOrderId].notes && (
                  <div className="border-t border-black/[0.05] pt-4 space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.1em] text-neutral-400">Notas del pedido</p>
                    <p className="text-sm text-neutral-600 bg-neutral-50 p-3 rounded-lg">
                      "{activeOrderDetailsMap[selectedOrderId].notes}"
                    </p>
                  </div>
                )}

                {['PENDING', 'CONFIRMED', 'PREPARING'].includes(activeOrderDetailsMap[selectedOrderId].status) && (
                  <div className="border-t border-black/[0.05] pt-4">
                    {activeOrderDetailsMap[selectedOrderId].cancellationRequestedAt && !activeOrderDetailsMap[selectedOrderId].cancelledBy ? (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200/60 rounded-xl">
                          <span className="text-sm">⏳</span>
                          <p className="text-xs font-semibold text-amber-700">Solicitud de cancelación enviada — esperando respuesta del restaurante.</p>
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await requestJson({ apiBase, path: `/pedidos/${selectedOrderId}/cancelar-solicitud`, token, options: { method: 'POST' } });
                              setActiveOrderDetailsMap(prev => ({
                                ...prev,
                                [selectedOrderId!]: { ...prev[selectedOrderId!], cancellationRequestedAt: null as any },
                              }));
                              setToastMsg('Solicitud de cancelación retirada.');
                              setToastType('success');
                              setTimeout(() => setToastMsg(''), 2000);
                            } catch (e: any) {
                              setToastMsg(e?.message || 'Error al retirar solicitud.');
                              setToastType('error');
                              setTimeout(() => setToastMsg(''), 2000);
                            }
                          }}
                          className="w-full rounded-xl bg-neutral-100 hover:bg-neutral-200 py-3 text-sm font-semibold text-neutral-700 transition-colors active:scale-[0.97] active-scale"
                        >
                          Retirar solicitud de cancelación
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                          onClick={async () => {
                          try {
                            await requestJson({ apiBase, path: `/pedidos/${selectedOrderId}/solicitar-cancelacion`, token, options: { method: 'POST' } });
                            setActiveOrderDetailsMap(prev => ({
                              ...prev,
                              [selectedOrderId!]: { ...prev[selectedOrderId!], cancellationRequestedAt: new Date().toISOString() },
                            }));
                            setToastMsg('Solicitud enviada. El restaurante debe aprobarla.');
                            setToastType('success');
                            setTimeout(() => setToastMsg(''), 3000);
                          } catch (e: any) {
                            if (e?.code === 'CANCELLATION_ALREADY_REJECTED') {
                              setTransientNotice({
                                id: `cancellation-rejected:${selectedOrderId}`,
                                title: 'Solicitud rechazada',
                                description: 'Entendemos que querías cancelar, pero el restaurante ya comenzó a preparar tu pedido y cancelarlo le genera pérdidas. No te preocupes, tu pedido sigue en marcha y llegará pronto. Si tienes alguna duda, puedes contactar al restaurante por el chat del pedido.',
                                tone: 'danger',
                                requiresAcknowledgement: true,
                              });
                            } else if (e?.status === 409) {
                              setActiveOrderDetailsMap(prev => ({
                                ...prev,
                                [selectedOrderId!]: { ...prev[selectedOrderId!], cancellationRequestedAt: new Date().toISOString() },
                              }));
                              setToastMsg('Solicitud enviada. El restaurante debe aprobarla.');
                              setToastType('success');
                              setTimeout(() => setToastMsg(''), 3000);
                            } else {
                              setToastMsg(e?.message || 'Error al solicitar cancelación.');
                              setToastType('error');
                              setTimeout(() => setToastMsg(''), 2000);
                            }
                          }
                        }}
                        className="w-full rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 py-3 text-sm font-semibold text-rose-700 transition-colors active:scale-[0.97] active-scale"
                      >
                        Solicitar cancelación
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {isChatOpen && selectedOrderId && activeOrderDetailsMap[selectedOrderId] && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm animate-fade-in" onClick={() => setIsChatOpen(false)}>
          <div
            className="w-full max-w-md bg-white/95 backdrop-blur-md h-full flex flex-col shadow-2xl border-l border-neutral-200 animate-slide-left"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-4 border-b border-neutral-100 flex items-center justify-between bg-accent-soft/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[var(--accent)] flex items-center justify-center text-white font-bold shadow-md shadow-sky-200">
                  {activeOrderDetailsMap[selectedOrderId].restaurant.name.substring(0, 2).toUpperCase()}
                </div>
                <div>
                  <h4 className="font-bold text-neutral-900 leading-tight">{activeOrderDetailsMap[selectedOrderId].restaurant.name}</h4>
                  <p className="text-xs text-neutral-500">Soporte y chat de pedido</p>
                </div>
              </div>
              <button
                className="p-2 hover:bg-neutral-100 rounded-full transition-colors"
                onClick={() => setIsChatOpen(false)}
              >
                <X className="w-6 h-6 text-neutral-500" />
              </button>
            </div>

            {/* Feed de Mensajes */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-neutral-50/50">
              {loadingChat ? (
                <div className="h-full flex items-center justify-center text-neutral-500">
                  <SaDelLoader size="sm" label="Cargando chat..." />
                </div>
              ) : chatMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 text-neutral-400">
                  <span className="text-4xl mb-3">💬</span>
                  <p className="font-semibold text-neutral-700">¡Inicia la conversación!</p>
                  <p className="text-xs mt-1 max-w-xs">Escribe si tienes dudas sobre tu pedido, dirección o algún inconveniente.</p>
                </div>
              ) : (
                chatMessages.map((msg: any) => {
                  const isMe = msg.senderRole === 'CUSTOMER';
                  return (
                    <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                      <div
                        className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-[15px] shadow-sm ${
                          isMe
                            ? 'bg-[var(--accent)] text-white rounded-br-sm'
                            : 'bg-white border border-neutral-100 text-neutral-800 rounded-bl-sm'
                        }`}
                      >
                        <p className="whitespace-pre-wrap leading-snug">{msg.content}</p>
                      </div>
                      <span className="text-[10px] text-neutral-400 mt-1.5 px-1 font-medium">
                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  );
                })
              )}
              <div ref={chatBottomRef} />
            </div>

            {/* Chat Input */}
            <div className="p-4 border-t border-black/5 bg-white">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendChatMessage();
                }}
                className="flex items-end gap-2"
              >
                <textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Escribe un mensaje..."
                  className="flex-1 max-h-32 min-h-[44px] rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-sky-1000 focus:bg-white focus:outline-none focus:ring-4 focus:ring-sky-1000/10 transition-all resize-none"
                  rows={1}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void sendChatMessage();
                    }
                  }}
                />
                <button
                  type="submit"
                  disabled={!chatInput.trim() || sendingChatMessage}
                  className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-xl bg-[var(--accent)] text-white transition hover:bg-[var(--accent)] active:scale-95 active-scale disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-sky-200"
                >
                  {sendingChatMessage ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <svg className="w-5 h-5 translate-x-px -translate-y-px" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  )}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Floating Checkout Button */}
      {cart.length > 0 && !isCartOpen && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[45] w-[calc(100%-2rem)] max-w-sm pointer-events-auto pb-[env(safe-area-inset-bottom)] transition-all duration-300 ${
          hideCartButton ? 'pointer-events-none translate-y-24 opacity-0' : ''
        }`}>
          <button
            type="button"
            onClick={() => setIsCartOpen(true)}
            className={`group relative flex w-full items-center justify-between overflow-hidden rounded-full bg-neutral-950 px-5 py-3.5 shadow-[0_8px_30px_rgb(0,0,0,0.2)] transition-all hover:scale-[1.02] active:scale-[0.98] active-scale ${
              cartJustUpdated ? 'scale-[1.05] ring-4 ring-[#0ea5e9]/40' : ''
            } ${cartPulse ? 'scale-[1.04] ring-4 ring-[#0ea5e9]/40 animate-cart-pulse' : ''}`}
          >
            {/* Pulsing background effect */}
            <div className="absolute inset-0 -z-10 animate-[pulse_2s_ease-in-out_infinite] bg-neutral-800 opacity-50" />
            
            <div className="flex items-center gap-3">
              <div className="relative flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white">
                <span className="text-xs font-bold">{totalProducts}</span>
              </div>
              <span className="text-sm font-semibold tracking-wide text-white">Ver carrito</span>
            </div>
            
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white">
                ${(cartSubtotal - discountAmount).toFixed(2)}
              </span>
              <ChevronRight className="h-4 w-4 text-white/70 transition-transform group-hover:translate-x-1" />
            </div>
          </button>
        </div>
      )}

      <style>{`
        @keyframes cartPulse {
          0%, 100% { transform: scale(1); }
          10% { transform: scale(1.04); }
          20% { transform: scale(1.02); }
          30% { transform: scale(1.05); }
          40% { transform: scale(1.02); }
          55% { transform: scale(1.04); }
          70% { transform: scale(1); }
        }
        .animate-cart-pulse {
          animation: cartPulse 1.2s ease-in-out;
        }
      `}</style>

      {toastMsg ? (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-2xl border px-5 py-3 text-sm shadow-[0_4px_16px_rgba(0,0,0,0.08)] flex items-center gap-2 ${
          toastType === 'error'
            ? 'border-red-200 bg-red-50 text-red-700'
            : 'border-emerald-100 bg-emerald-50 text-emerald-700'
        }`}>
          {toastType === 'error' ? (
            <AlertTriangle className="h-4 w-4 text-red-500" />
          ) : (
            <Check className="h-4 w-4 text-emerald-500" />
          )}
          <span className="font-medium">{toastMsg}</span>
        </div>
      ) : null}

      {/* Feedback profesional del cupón (modal auto-cierra a los 2s) */}
      {couponFeedback && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 px-4 backdrop-blur-[2px] animate-fade-in" onClick={() => setCouponFeedback(null)}>
          <div className="relative w-full max-w-[340px] overflow-hidden rounded-[28px] border border-white/60 bg-white shadow-[0_32px_90px_-16px_rgba(15,15,15,0.35)] animate-scale-up" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setCouponFeedback(null)}
              className="absolute right-3 top-3 z-20 flex h-7 w-7 items-center justify-center rounded-full bg-black/15 text-white transition hover:bg-black/25 active:scale-90"
              aria-label="Cerrar"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>

            <div className={`relative overflow-hidden px-6 pb-5 pt-7 text-center ${couponFeedback.tone === 'success' ? 'bg-gradient-to-br from-sky-500 via-sky-600 to-blue-600' : 'bg-gradient-to-br from-rose-500 via-rose-600 to-red-600'}`}>
              <div className="absolute -right-6 -top-6 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
              <div className="absolute -bottom-8 -left-6 h-28 w-28 rounded-full bg-white/10 blur-2xl" />
              <div className="relative z-10 mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-white/15 text-white ring-1 ring-white/25 backdrop-blur-md">
                {couponFeedback.tone === 'success' ? (
                  <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                ) : (
                  <Tag className="h-8 w-8" />
                )}
              </div>
              <p className="relative z-10 text-lg font-black tracking-[-0.02em] text-white">{couponFeedback.title}</p>
            </div>

            <div className="px-6 py-5 text-center">
              {couponFeedback.message ? (
                <p className="text-[13px] font-medium leading-relaxed text-neutral-600">{couponFeedback.message}</p>
              ) : (
                <p className="text-[13px] font-medium leading-relaxed text-neutral-400">Tu cupón se ha tenido en cuenta en este pedido.</p>
              )}
            </div>

            <div className="h-1 w-full overflow-hidden bg-neutral-100">
              <div
                key={couponFeedback.title}
                className={`h-full ${couponFeedback.tone === 'success' ? 'bg-gradient-to-r from-sky-500 to-blue-600' : 'bg-gradient-to-r from-rose-500 to-red-600'}`}
                style={{ animation: 'couponFeedbackProgress 2s linear forwards' }}
              />
            </div>
          </div>
        </div>
      )}

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onSuccess={handleLoginSuccess}
        apiBase={apiBase}
      />

      {/* Quick View Modal for Stores */}
      {previewProduct && (
        <div
          className="animate-overlay-fade fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm px-3 py-4 sm:px-6 sm:py-8"
          onClick={() => setPreviewProduct(null)}
        >
          <div
            className="animate-modal-pop relative flex w-full max-w-4xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-black/5 sm:flex-row sm:max-h-[85vh] dark:bg-neutral-900 dark:ring-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              type="button"
              onClick={() => setPreviewProduct(null)}
              className="absolute right-3 top-3 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-neutral-700 shadow-md backdrop-blur-sm transition hover:bg-white hover:scale-105 active:scale-95 dark:bg-neutral-800/90 dark:text-zinc-300 dark:hover:bg-neutral-700"
            >
              <X className="h-4 w-4" />
            </button>

            {/* Image section */}
            <div className="relative flex w-full items-center justify-center bg-neutral-50 sm:w-[55%] sm:min-h-[500px] dark:bg-neutral-800/40">
              {previewProduct.images.length > 0 ? (
                <img
                  src={previewProduct.images[previewIndex]}
                  alt={previewProduct.name}
                  loading="lazy" decoding="async"
                  className="h-64 w-full object-contain p-6 sm:h-full sm:max-h-[500px] sm:p-8"
                />
              ) : (
                <div className="flex h-64 w-full flex-col items-center justify-center gap-3 text-neutral-300 sm:h-full dark:text-zinc-600">
                  <svg className="h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                  </svg>
                  <span className="text-sm font-medium text-neutral-400 dark:text-zinc-500">Sin imagen</span>
                </div>
              )}
              {previewProduct.discountPrice && (
                <div className="absolute left-4 top-4 z-10 rounded-full bg-rose-500/90 px-3 py-1 text-[11px] font-bold text-white shadow-lg backdrop-blur-sm">
                  -{Math.round((1 - previewProduct.discountPrice / previewProduct.price) * 100)}%
                </div>
              )}
              {getMultiBuyInfo(previewProduct).isMultiBuy && (
                <div className="absolute right-4 top-4 z-10 rounded-full bg-emerald-600/90 px-3 py-1 text-[11px] font-bold text-white shadow-lg backdrop-blur-sm">
                  {getMultiBuyInfo(previewProduct).buy}x{getMultiBuyInfo(previewProduct).pay}
                </div>
              )}
              {previewProduct.images.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => setPreviewIndex((prev) => (prev - 1 + previewProduct.images.length) % previewProduct.images.length)}
                    className="absolute left-2 top-1/2 z-10 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-neutral-700 shadow-md backdrop-blur-sm transition hover:bg-white hover:scale-105 active:scale-95 dark:bg-neutral-900/80 dark:text-zinc-300 dark:hover:bg-neutral-800"
                  >
                    <ChevronLeft className="h-4 w-4" strokeWidth={2.5} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewIndex((prev) => (prev + 1) % previewProduct.images.length)}
                    className="absolute right-2 top-1/2 z-10 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-neutral-700 shadow-md backdrop-blur-sm transition hover:bg-white hover:scale-105 active:scale-95 dark:bg-neutral-900/80 dark:text-zinc-300 dark:hover:bg-neutral-800"
                  >
                    <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
                  </button>
                  <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 gap-1.5">
                    {previewProduct.images.map((_, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setPreviewIndex(idx)}
                        className={`h-1.5 rounded-full transition-all duration-300 ${idx === previewIndex ? 'w-5 bg-neutral-900 dark:bg-white' : 'w-1.5 bg-neutral-300 hover:bg-neutral-500 dark:bg-zinc-600'}`}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Details section */}
            <div className="flex w-full flex-col justify-between p-5 sm:w-[45%] sm:p-7">
              <div className="overflow-y-auto">
                <h2 className="text-xl font-bold leading-tight text-neutral-900 sm:text-2xl dark:text-white">{previewProduct.name}</h2>
                {previewProduct.description && (
                  <p className="mt-3 text-sm leading-relaxed text-neutral-600 dark:text-zinc-300">{previewProduct.description}</p>
                )}
                <div className="mt-5">
                  {previewProduct.sellBy === 'WEIGHT' ? (
                    <p className="text-2xl font-bold text-neutral-900 dark:text-white">{formatCurrency(previewProduct.unitPrice || previewProduct.price)}<span className="text-base font-medium text-neutral-500 dark:text-zinc-400">/kg</span></p>
                  ) : getMultiBuyInfo(previewProduct).isMultiBuy ? (
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                        <span className="text-2xl font-bold text-neutral-900 dark:text-white">{formatCurrency(getMultiBuyInfo(previewProduct).basePrice)}</span>
                        <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-500">{formatCurrency(getMultiBuyInfo(previewProduct).effectiveUnitPrice)} c/u llevando {getMultiBuyInfo(previewProduct).buy}</span>
                      </div>
                      <span className="inline-block rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
                        Compra {getMultiBuyInfo(previewProduct).buy} paga {getMultiBuyInfo(previewProduct).pay} · ahorras {formatCurrency(getMultiBuyInfo(previewProduct).savingsPerGroup)}
                      </span>
                    </div>
                  ) : previewProduct.discountPrice ? (
                    <div className="space-y-1">
                      <div className="flex items-baseline gap-2.5">
                        <span className="text-2xl font-bold text-rose-600 dark:text-rose-500">{formatCurrency(previewProduct.discountPrice)}</span>
                        <span className="text-sm text-neutral-400 line-through dark:text-zinc-500">{formatCurrency(previewProduct.price)}</span>
                      </div>
                      <span className="inline-block rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
                        Ahorras {formatCurrency(previewProduct.price - previewProduct.discountPrice)}
                      </span>
                    </div>
                  ) : (
                    <p className="text-2xl font-bold text-neutral-900 dark:text-white">{formatCurrency(previewProduct.price)}</p>
                  )}
                </div>
              </div>
              <div className="mt-6 flex items-center gap-3 border-t border-neutral-100 pt-5 dark:border-zinc-800">
                {previewProduct.optionGroups?.length ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPreviewProduct(null);
                      addToCart(previewProduct as any);
                    }}
                    className="flex-1 rounded-xl bg-neutral-900 py-3.5 text-sm font-bold text-white shadow-lg shadow-neutral-900/20 transition hover:bg-neutral-800 active:scale-[0.97] dark:bg-white dark:text-neutral-950 dark:hover:bg-zinc-200 dark:shadow-none"
                  >
                    Personalizar y agregar
                  </button>
                ) : (() => {
                  const qty = getCartQuantity(previewProduct.id);
                  return (
                    <>
                      {qty > 0 && (
                        <div className="flex items-center justify-between rounded-xl bg-neutral-50 p-1 dark:bg-neutral-800">
                          <button
                            type="button"
                            onClick={() => {
                              if (qty <= 1) setPreviewProduct(null);
                              updateCartItem(previewProduct.id, { quantity: qty - 1 });
                            }}
                            className="flex h-10 w-10 items-center justify-center rounded-lg text-neutral-500 transition hover:bg-white hover:text-neutral-800 active:scale-90 dark:text-zinc-300 dark:hover:bg-neutral-700 dark:hover:text-zinc-100"
                          >
                            {qty === 1 ? (
                              <Trash2 className="h-4 w-4 text-red-500" />
                            ) : (
                              <Minus className="h-4 w-4" strokeWidth={2.5} />
                            )}
                          </button>
                          <span className="flex h-10 w-10 items-center justify-center text-base font-bold text-neutral-900 dark:text-white">{qty}</span>
                          <button
                            type="button"
                            onClick={() => addToCart(previewProduct as any)}
                            className="flex h-10 w-10 items-center justify-center rounded-lg text-neutral-500 transition hover:bg-white hover:text-neutral-800 active:scale-90 dark:text-zinc-300 dark:hover:bg-neutral-700 dark:hover:text-zinc-100"
                          >
                            <Plus className="h-4 w-4" strokeWidth={2.5} />
                          </button>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          if (qty === 0) addToCart(previewProduct as any);
                          setPreviewProduct(null);
                        }}
                        className="flex-1 rounded-xl bg-neutral-900 py-3.5 text-sm font-bold text-white shadow-lg shadow-neutral-900/20 transition hover:bg-neutral-800 active:scale-[0.97] dark:bg-white dark:text-neutral-950 dark:hover:bg-zinc-200 dark:shadow-none"
                      >
                        {qty > 0 ? 'Listo' : 'Agregar al carrito'}
                      </button>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
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
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="grid gap-1.5 text-sm text-neutral-600">
      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-neutral-500">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        className="rounded-xl border border-black/[0.08] bg-neutral-50/70 px-4 py-3 text-sm text-neutral-950 outline-none transition placeholder:text-neutral-400/80 focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-400/15"
      />
    </label>
  );
}

function EmptyState({ text, compact = false }: { text: string; compact?: boolean }) {
  return (
    <div className={`rounded-[28px] border border-dashed border-black/10 bg-neutral-50 text-center text-neutral-500 ${compact ? 'px-4 py-6' : 'px-6 py-12'}`}>
      <p className="text-sm leading-6">{text}</p>
    </div>
  );
}

function Callout({
  tone,
  children,
}: {
  tone: 'danger' | 'success' | 'warning';
  children: React.ReactNode;
}) {
  const palette = {
    danger: 'border-rose-200 bg-rose-50 text-rose-700',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    warning: 'border-amber-200 bg-amber-50 text-amber-700',
  } as const;

  return (
    <div className={`rounded-[24px] border px-4 py-3 text-sm leading-6 ${palette[tone]}`}>
      {children}
    </div>
  );
}

function TransientNoticeBanner({
  notice,
  onClose,
  onRefundAction: _onRefundAction,
  apiBase: _apiBase,
  token: _token,
}: {
  notice: TransientNotice;
  onClose: () => void;
  onRefundAction?: (orderId: string) => void;
  apiBase?: string;
  token?: string;
}) {
  const styles = {
    success: {
      iconCircle: 'bg-emerald-50 text-emerald-600 border-emerald-200',
      badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      label: 'Información',
    },
    danger: {
      iconCircle: 'bg-rose-50 text-rose-600 border-rose-200',
      badge: 'bg-rose-50 text-rose-700 border-rose-200',
      label: 'Aviso',
    },
    info: {
      iconCircle: 'bg-sky-50 text-[var(--accent)] border-sky-200',
      badge: 'bg-sky-50 text-[var(--accent-strong)] border-sky-200',
      label: 'Información',
    },
  } as const;

  const s = styles[notice.tone];

  const isTransferRefund = notice.tone === 'danger' && notice.paymentMethod === 'TRANSFER' && notice.orderId;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={notice.dismissible !== false ? onClose : undefined} />
      <div className="relative w-full max-w-md rounded-[32px] bg-white px-6 py-8 text-center shadow-[0_30px_100px_rgba(0,0,0,0.2)] border border-black/5 animate-in zoom-in-95 fade-in slide-in-from-bottom-4 duration-300">
        {notice.dismissible !== false && (
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 transition hover:bg-neutral-200 hover:text-neutral-800 active:scale-95"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        )}

        <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full border ${s.iconCircle}`}>
          <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {notice.tone === 'success' ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            ) : notice.tone === 'danger' ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            )}
          </svg>
        </div>

        <span className={`mt-4 inline-flex rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${s.badge}`}>
          {s.label}
        </span>

        <p className="mt-4 text-xl font-bold tracking-tight text-neutral-900">{notice.title}</p>

        <p className="mt-2 text-sm text-neutral-500 leading-relaxed">{notice.description}</p>

        {isTransferRefund ? (
          <div className="mt-6 w-full">
            <div className="rounded-2xl bg-neutral-50 p-4 border border-neutral-200/60 text-left">
              <p className="text-sm font-semibold text-neutral-800 leading-relaxed">
                Tu pago fue por transferencia. Serás contactado para coordinar la devolución.
              </p>
            </div>
            <p className="mt-3 text-xs text-neutral-500 leading-relaxed">
              Nuestro equipo de soporte revisará tu pedido y se pondrá en contacto contigo y con el restaurante para procesar el reembolso.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-5 w-full rounded-full bg-neutral-950 px-6 py-3.5 text-xs font-bold text-white shadow-lg shadow-neutral-950/25 transition-all hover:bg-neutral-800 hover:shadow-xl active:scale-[0.97]"
            >
              Entendido
            </button>
          </div>
        ) : (
          notice.requiresAcknowledgement && (
            <button
              type="button"
              onClick={onClose}
              className="mt-6 rounded-full bg-neutral-950 px-8 py-3.5 text-sm font-bold text-white shadow-lg shadow-neutral-950/25 transition-all hover:bg-neutral-800 hover:shadow-xl active:scale-[0.97]"
            >
              Entendido
            </button>
          )
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status, businessType }: { status: OrderStatus; businessType?: string }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-tight ${statusPaletteMap[status]}`}>
      {orderStatusLabel(status, businessType)}
    </span>
  );
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  }).format(toMoney(amount));
}

function formatDeliverySummary(fee?: number | null) {
  const normalizedFee = toMoney(fee);

  return normalizedFee > 0 ? formatCurrency(normalizedFee) : 'Sin costo';
}

function toMoney(value: number | null | undefined) {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    return 0;
  }

  return value;
}

type MultiBuyInfo = {
  isMultiBuy: boolean;
  buy?: number;
  pay?: number;
  basePrice: number;
  effectiveUnitPrice: number;
  discountPercent: number;
  savingsPerGroup: number;
};

function getMultiBuyInfo(product: {
  price: number;
  discountPrice?: number | null;
  promoType?: 'MULTI_BUY' | null;
  promoBuyQuantity?: number | null;
  promoPayQuantity?: number | null;
  sellBy?: string;
}): MultiBuyInfo {
  const basePrice = product.discountPrice ?? product.price;
  const buy = product.promoBuyQuantity ?? 0;
  const pay = product.promoPayQuantity ?? 0;
  const isMultiBuy =
    product.promoType === 'MULTI_BUY' &&
    product.sellBy !== 'WEIGHT' &&
    buy > 0 &&
    pay > 0 &&
    pay < buy;

  if (!isMultiBuy) {
    return {
      isMultiBuy: false,
      basePrice,
      effectiveUnitPrice: basePrice,
      discountPercent: 0,
      savingsPerGroup: 0,
    };
  }

  const effectiveUnitPrice = (basePrice * pay) / buy;
  const discountPercent = Math.round((1 - pay / buy) * 100);
  return {
    isMultiBuy,
    buy,
    pay,
    basePrice,
    effectiveUnitPrice,
    discountPercent,
    savingsPerGroup: basePrice * (buy - pay),
  };
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(date));
}



function buildDetailAddressLabel(address: CustomerOrderDetail['address'] | null | undefined) {
  if (!address) return '';
  return [
    `${address.street} ${address.number}`.trim(),
    address.neighborhood,
    address.city,
  ]
    .filter(Boolean)
    .join(', ');
}

async function persistTransferProof(params: {
  apiBase: string;
  token: string;
  source: string;
  fileName?: string;
}) {
  if (!params.source.startsWith('data:')) {
    return params.source;
  }

  const uploaded = await uploadMediaAsset({
    apiBase: params.apiBase,
    token: params.token,
    kind: 'payment-proof',
    source: params.source,
    fileName: params.fileName,
    fallbackMessage: 'No se pudo subir el comprobante de transferencia.',
    fallbackToSource: true,
  });

  return uploaded.url;
}

function getCheckoutValidationMessage(
  checkoutForm: CheckoutForm,
  cart: CartItem[],
  selectedRestaurant: PublicRestaurantDetail | null,
  token: string,
  hasTransferProof: boolean
) {
  if (!token) {
    return 'Inicia sesion como cliente para confirmar pedidos.';
  }

  if (!selectedRestaurant) {
    return 'Selecciona un restaurante antes de pasar al checkout.';
  }

  if (!selectedRestaurant.isOpen) {
    return 'El restaurante seleccionado no esta disponible para recibir pedidos ahora.';
  }

  if (cart.length === 0) {
    return 'Agrega al menos un producto al carrito.';
  }

  if (checkoutForm.paymentMethod === 'TRANSFER' && !hasTransferDetails(selectedRestaurant)) {
    return 'Este restaurante aun no ha configurado sus datos de transferencia.';
  }

  const acceptedMethods = getAcceptedPaymentMethods(selectedRestaurant);
  if (checkoutForm.paymentMethod === 'CASH' && !acceptedMethods.includes('CASH')) {
    return 'Este restaurante no acepta pagos en efectivo. Usa transferencia.';
  }
  if (checkoutForm.paymentMethod === 'TRANSFER' && !acceptedMethods.includes('TRANSFER')) {
    return 'Este restaurante no acepta pagos por transferencia. Usa efectivo.';
  }

  if (
    !checkoutForm.street.trim() ||
    !checkoutForm.number.trim() ||
    !checkoutForm.neighborhood.trim()
  ) {
    return 'Completa la dirección de entrega para continuar.';
  }

  if (checkoutForm.paymentMethod === 'TRANSFER' && !hasTransferProof) {
    return 'Carga la imagen del comprobante de transferencia para continuar.';
  }

  return '';
}

/**
 * Calcula la distancia en línea recta entre dos coordenadas (Fórmula de Haversine).
 */
function calculateHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  if (lat1 === lat2 && lon1 === lon2) return 0;
  
  const R = 6371; // Radio de la Tierra en km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
    
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

let autocompleteSessionToken: any = null;
let placesService: any = null;
let addressSearchSource: ReturnType<typeof createPlacesSource> | null = null;

function searchAddress(query: string, setAddressSuggestions: (val: any[]) => void, setIsSearchingAddress: (val: boolean) => void) {
  if (!addressSearchSource) {
    addressSearchSource = createPlacesSource();
  }
  addressSearchSource.search(query, {
    onResults: setAddressSuggestions,
    onBusy: setIsSearchingAddress,
  });
}

function handleSelectSuggestion(
  suggestion: any,
  setCheckoutForm: any,
  setAddressSearchQuery: any,
  setAddressSuggestions: any,
  setNewAddressStep: any
) {
  const google = getGoogleMaps();
  if (!google || !google.maps || !google.maps.places || !suggestion.place_id) return;

  if (!placesService) {
    const mapEl = document.createElement('div');
    placesService = new google.maps.places.PlacesService(mapEl);
  }

  placesService.getDetails({
    placeId: suggestion.place_id,
    sessionToken: autocompleteSessionToken,
    fields: ['address_components', 'geometry', 'formatted_address']
  }, (place: any, status: any) => {
    autocompleteSessionToken = new google.maps.places.AutocompleteSessionToken();
    
    if (status !== google.maps.places.PlacesServiceStatus.OK || !place || !place.geometry || !place.geometry.location) {
      console.error('Failed to get place details');
      return;
    }

    let houseNumber = '';
    const houseComponent = place.address_components.find((c: any) => c.types.includes('street_number'));
    if (houseComponent) houseNumber = houseComponent.long_name;
    
    let street = '';
    const routeComponent = place.address_components.find((c: any) => c.types.includes('route'));
    if (routeComponent) street = routeComponent.long_name;
    
    let neighborhood = '';
    const sublocComponent = place.address_components.find((c: any) => c.types.includes('sublocality') || c.types.includes('neighborhood'));
    if (sublocComponent) neighborhood = sublocComponent.long_name;
    
    let city = '';
    const locComponent = place.address_components.find((c: any) => c.types.includes('locality'));
    if (locComponent) city = locComponent.long_name;
    
    let state = '';
    const adminComponent = place.address_components.find((c: any) => c.types.includes('administrative_area_level_1'));
    if (adminComponent) state = adminComponent.long_name;
    
    let zipCode = '';
    const zipComponent = place.address_components.find((c: any) => c.types.includes('postal_code'));
    if (zipComponent) zipCode = zipComponent.long_name;

    const lat = place.geometry.location.lat();
    const lng = place.geometry.location.lng();

    setCheckoutForm((current: any) => ({
      ...current,
      street: street || suggestion.name || '',
      number: houseNumber || '',
      neighborhood: neighborhood || '',
      city: city || '',
      state: state || '',
      zipCode: zipCode || '',
      latitude: String(lat),
      longitude: String(lng),
    }));
    
    setAddressSearchQuery(suggestion.name);
    setAddressSuggestions([]);
    setNewAddressStep('details');
  });
}

function buildRestaurantInitials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');
}

function hasTransferDetails(restaurant: PublicRestaurantDetail | null) {
  if (!restaurant) {
    return false;
  }

  return Boolean(
    restaurant.transferBankName?.trim() &&
      restaurant.transferAccountNumber?.trim() &&
      restaurant.transferBeneficiaryName?.trim()
  );}

function getAcceptedPaymentMethods(restaurant: PublicRestaurantDetail | null): string[] {
  if (restaurant?.acceptedPaymentMethods?.length) {
    return restaurant.acceptedPaymentMethods;
  }
  // Fallback para datos viejos en caché: derivar del estado actual.
  const methods: string[] = [];
  if (restaurant?.acceptsCash !== false) methods.push('CASH');
  if (hasTransferDetails(restaurant)) methods.push('TRANSFER');
  return methods;
}

function orderStatusLabel(status: OrderStatus, businessType?: string): string {
  return getOrderStatusLabel(status, businessType);
}

const statusPaletteMap: Record<OrderStatus, string> = {
  PENDING: 'border-amber-200 bg-amber-50 text-amber-700',
  CONFIRMED: 'border-sky-200 bg-sky-50 text-[var(--accent-strong)]',
  PREPARING: 'border-orange-200 bg-orange-50 text-orange-700',
  READY: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  PICKED_UP: 'border-teal-200 bg-teal-50 text-teal-700',
  IN_TRANSIT: 'border-cyan-200 bg-cyan-50 text-cyan-700',
  DELIVERED: 'border-lime-200 bg-lime-50 text-lime-700',
  CANCELLED: 'border-neutral-200 bg-neutral-100 text-neutral-600',
  REJECTED: 'border-rose-200 bg-rose-50 text-rose-700',
};

function isActiveOrderStatus(status: string) {
  const normalizedStatus = normalizeOrderStatusValue(status);

  return ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'PICKED_UP', 'IN_TRANSIT', 'DRIVER_ARRIVED'].includes(normalizedStatus);
}


function normalizeOrderStatusValue(status: string) {
  return status.trim().toUpperCase().replace(/[\s-]+/g, '_');
}

function applyDeliveryPreset(form: CheckoutForm, preset: DeliveryPreset): CheckoutForm {
  return {
    ...form,
    city: form.city.trim() || preset.city,
    state: form.state.trim() || preset.state,
    zipCode: form.zipCode.trim() || preset.zipCode,
    country: form.country.trim() || preset.country,
    latitude: form.latitude.trim() || preset.latitude,
    longitude: form.longitude.trim() || preset.longitude,
  };
}

function getDeliveryPreset(region?: string): DeliveryPreset {
  const normalizedRegion = normalizeRegion(region);

  if (normalizedRegion.includes('puruaran')) {
    return {
      city: 'Puruaran',
      state: 'Michoacan',
      zipCode: '61682',
      country: 'MX',
      latitude: '19.3076',
      longitude: '-101.1419',
      label: 'Puruaran, Michoacan',
    };
  }

  return {
    city: toDisplayRegion(region) || 'Puruaran',
    state: 'Michoacan',
    zipCode: '61682',
    country: 'MX',
    latitude: '19.3076',
    longitude: '-101.1419',
    label: `${toDisplayRegion(region) || 'Puruaran'}, Michoacan`,
  };
}

function normalizeRegion(value?: string) {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function toDisplayRegion(value?: string) {
  const normalized = (value || '')
    .replace(/[-_]+/g, ' ')
    .trim();

  if (!normalized) {
    return '';
  }

  return normalized
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
