'use client';
import { WINGSLAB_BUSINESS } from '@sadel/shared';
import { getWingslabSocketUrl } from '@sadel/shared';
import { AlertTriangle, ArrowLeft, Banknote, Bell, Bike, Check, ChevronLeft, ChevronRight, ChevronUp, CircleCheck, CirclePlus, ClipboardCheck, Clock, CreditCard, DollarSign, Gift, Home, Loader2, Mail, Map, MapPin, MessageCircle, Minus, Package, Plus, RefreshCw, Search, ShoppingBag, ShoppingCart, Store, Tag, Ticket, Trash2, User, X, ZoomIn, Flame, Drumstick, Sandwich, CupSoda, Utensils, MoreHorizontal, ReceiptText } from 'lucide-react';
import officialWordmark from '../../../assets/wingslab-wordmark-red.png';
import officialWhiteWordmark from '../../../assets/wingslab-wordmark.png';
import { Hamburger } from 'lucide-react';
import { categoryAtScrollLine, categoryScrollLine } from '../../../lib/categoryScroll';
import { CustomerNavigation } from '../../../components/CustomerNavigation';
import { CartIcon } from '../../../components/CartIcon';

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthUser, clearStoredSession, readStoredSession, requestJson, submitReview, getOrderStatusLabel, isRestaurant, ApiRequestError, isSessionInvalidError, handleSocketUnauthorized, setGlobalSessionExpiredHandler, forceSessionExpired, formatCurrency as formatSharedCurrency } from '@sadel/shared';
import { MenuPromotions } from '../../../components/MenuPromotions';
import { io } from 'socket.io-client';
import { AuthModal } from '../../../components/AuthModal';
import { CompactActiveOrderBanner, computeDelayState, formatEstimatedArrivalMinutes, formatOverdueMinutes } from '../../../components/CompactActiveOrderBanner';
import { buildWeekSchedule, formatHour12, formatNextOpen, getCurrentShiftClose } from '../../../lib/operatingHours';
import { completeOrderIntent, resolveOrderIntentKey } from '../../../lib/orderIntentKey';
import { buildOrderAcceptedNotice } from '../../../lib/orderStatusNotices';
import { ensureGoogleMapsScript, isGoogleMapsUnavailable } from '../../../lib/googleMaps';
import RatingModal from '../../../components/RatingModal';
import { useForegroundPolling } from '../../../hooks/useForegroundPolling';
import CartDrawer from '../../../components/CartDrawer';
import ImageZoomLightbox from '../../../components/ImageZoomLightbox';
import { setCardCheckoutDraft } from '../../../lib/card-checkout-draft';
import SavedCardSelector from '../../../components/SavedCardSelector';
import type { SavedCard } from '../../../lib/savedCards';
import { createPlacesSource, fetchSelectedPlaceFields } from '../../../lib/places';
import type { ProductOptionGroup, PublicRestaurantDetail } from '../../../lib/public-menu-types';
import type { MenuPromotion } from '../../../lib/menu-promotions';

function weightInputGrams(input: string, unit: 'g' | 'kg'): number | null {
  const normalized = input.replace(',', '.');
  if (!(unit === 'g' ? /^\d+$/ : /^\d+(?:\.\d{1,3})?$/).test(normalized)) return null;
  const grams = Math.round(Number(normalized) * (unit === 'kg' ? 1000 : 1));
  return Number.isSafeInteger(grams) ? grams : null;
}

function isValidWeightInput(input: string, unit: 'g' | 'kg', min: number, max: number): boolean {
  const grams = weightInputGrams(input, unit);
  return grams !== null && grams >= min && grams <= max;
}

// Para pedidos nuevos solo se ofrecen CASH y CREDIT_CARD; TRANSFER se mantiene
// en el tipo únicamente para poder renderizar pedidos históricos.
type PaymentMethod = 'CASH' | 'CREDIT_CARD' | 'TRANSFER';
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

import { canOfferCustomerWebPush, usePushNotifications } from '../../../hooks/usePushNotifications';
import { PushActivationButton } from '../../../components/PushActivationButton';
import { revokeCustomerPush } from '../../../lib/revokeCustomerPush';
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
  const [hasOverflow, setHasOverflow] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(1);
  const [thumbPct, setThumbPct] = useState(100);

  const updateArrows = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const tolerance = 4;
    const maxScroll = el.scrollWidth - el.clientWidth;
    setCanLeft(el.scrollLeft > tolerance);
    setCanRight(el.scrollLeft < maxScroll - tolerance);
    setHasOverflow(maxScroll > tolerance);
    setScrollProgress(maxScroll > 0 ? Math.min(1, Math.max(0, el.scrollLeft / maxScroll)) : 1);
    setThumbPct(maxScroll > 0 ? Math.min(100, (el.clientWidth / el.scrollWidth) * 100) : 100);
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
    <div>
      <div className="relative">
        <div
          ref={scrollRef}
          style={{
            // Fundido estable en el borde derecho: aplicar SIEMPRE el gradiente
            // (sin oscilar entre montado/desmontado según canRight) evita el
            // repintado/parpadeo del mask en Safari/iOS al hacer scroll.
            WebkitMaskImage: 'linear-gradient(to right, black 88%, transparent 100%)',
            maskImage: 'linear-gradient(to right, black 88%, transparent 100%)',
          }}
          className="flex gap-3 overflow-x-auto pb-2 scroll-smooth snap-x snap-proximity [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
      {hasOverflow && (
        <div
          className="mx-1 mt-1.5 h-[3px] rounded-full bg-black/[0.06] dark:bg-white/10"
          aria-hidden="true"
        >
          <div
            className="relative h-full rounded-full bg-neutral-900/60 dark:bg-white/60"
            style={{ width: `${thumbPct}%`, left: `${scrollProgress * (100 - thumbPct)}%` }}
          />
        </div>
      )}
    </div>
  );
}

export default function RestaurantPage({
  searchParams,
  initialRestaurant,
  initialBanners,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
  initialRestaurant?: PublicRestaurantDetail | null;
  initialBanners: MenuPromotion[];
}) {
  // En Next 15+ params/searchParams son Promises en client components: se
  // 'desenvuelven' con use() (un solo resultado, estable entre renders).
  const urlParams = { restaurantId: WINGSLAB_BUSINESS.restaurantId };
  const urlSearchParams = searchParams ? use(searchParams) : undefined;
  const router = useRouter();
  const [apiBase, setApiBase] = useState(defaultApiBase);
  const [token, setToken] = useState('');
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [sessionUser, setSessionUser] = useState<AuthUser | null>(null);
  const { isSubscribed, subscribe: subscribePush } = usePushNotifications();
  const [isPushReminderModalOpen, setIsPushReminderModalOpen] = useState(false);
  const [showMaxCashModal, setShowMaxCashModal] = useState(false);
  const [showGpsCashModal, setShowGpsCashModal] = useState(false);
  const [rawRestaurant, setRawRestaurant] = useState<PublicRestaurantDetail | null>(initialRestaurant ?? null);

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

    return { ...rawRestaurant, name: rawRestaurant.id === WINGSLAB_BUSINESS.restaurantId ? WINGSLAB_BUSINESS.name : rawRestaurant.name, categories };
  }, [rawRestaurant, sessionUser?.dateOfBirth]);

  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [showRestaurantInfo, setShowRestaurantInfo] = useState(false);
  const [menuTab, setMenuTab] = useState<'home' | 'promos'>('home');
  const featuredProducts = restaurant?.categories.find(category => category.id === '__promotions__')?.products ?? [];

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
  const [headerIsPinned, setHeaderIsPinned] = useState(false);

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
  const [driverLocation, setDriverLocation] = useState<{ orderId: string; lat: number; lng: number; updatedAt?: string | null } | null>(null);
  const trackingOrderIdRef = useRef<string | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const handleLogout = useCallback(() => {
    void revokeCustomerPush().catch(() => {});
    clearStoredSession(storageKey);
    setToken('');
    setSessionUser(null);
  }, []);

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
      setHeaderIsPinned(window.scrollY > 0);
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
  trackingOrderIdRef.current = activeOrder?.id ?? null;

  useEffect(() => {
    if (carouselIndex >= activeOrderListItems.length && activeOrderListItems.length > 0) {
      setCarouselIndex(activeOrderListItems.length - 1);
    }
  }, [activeOrderListItems.length, carouselIndex]);

  // Posición inicial del repartidor: si el seguimiento se abre cuando el
  // repartidor ya va en ruta, el mapa arranca en su última posición conocida
  // en BD sin esperar el siguiente ping de la APK.
  useEffect(() => {
    if (!isTrackingEnabled) return;
    if (!activeOrder) return;
    const lat = activeOrder.lastDriverLatitude;
    const lng = activeOrder.lastDriverLongitude;
    if (lat == null || lng == null) return;
    const routeStatuses = ['PICKED_UP', 'IN_TRANSIT', 'DRIVER_ARRIVED'];
    if (!routeStatuses.includes(activeOrder.status)) return;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
    const incomingTime = Date.parse(activeOrder.lastDriverLocationAt || '');
    setDriverLocation(previous => {
      if (previous?.orderId === activeOrder.id && (!Number.isFinite(incomingTime) || incomingTime <= Date.parse(previous.updatedAt || ''))) return previous;
      return { orderId: activeOrder.id, lat, lng, updatedAt: activeOrder.lastDriverLocationAt };
    });
  }, [activeOrder, isTrackingEnabled]);

  const cartRestaurantId = useCartStore(state => state.restaurantId);
  const cartItems = useCartStore(state => state.items);
  const addItem = useCartStore(state => state.addItem);
  const decreaseQuantity = useCartStore(state => state.decreaseQuantity);
  const updateCartItemAction = useCartStore(state => state.updateItem);
  const clearCartAction = useCartStore(state => state.clearCart);
  const refreshCartItemImages = useCartStore(state => state.refreshItemImages);
  const refreshCartItemPrices = useCartStore(state => state.refreshItemPrices);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    return () => {
      if (preConfirmTimerRef.current !== null) {
        window.clearInterval(preConfirmTimerRef.current);
      }
      if (preConfirmCommitTimerRef.current !== null) {
        window.clearTimeout(preConfirmCommitTimerRef.current);
      }
    };
  }, []);
  const cart: CartItem[] = mounted && cartRestaurantId === urlParams.restaurantId ? cartItems : [];

  // El carrito guarda un snapshot de `image` al agregar el producto. Si la
  // imagen se subió con posterioridad (o el producto no la tenía al agregarse),
  // el snapshot queda vacío y el drawer muestra el ícono genérico. Aquí
  // re-hidratamos la imagen faltante con los datos frescos del menú cargado.
  const cartImageSync = useMemo(() => {
    if (!restaurant?.categories?.length) return [];
    const imageByProductId = Object.fromEntries(
      restaurant.categories
        .flatMap((category) => category.products || [])
        .filter((product) => product.image)
        .map((product) => [product.id, product.image] as const)
    ) as Record<string, string>;
    return cartItems
      .filter((item) => !item.image && imageByProductId[item.productId])
      .map((item) => ({
        cartItemId: item.cartItemId,
        image: imageByProductId[item.productId],
      }));
  }, [restaurant, cartItems]);

  useEffect(() => {
    if (cartImageSync.length) refreshCartItemImages(cartImageSync);
  }, [cartImageSync, refreshCartItemImages]);
  const [checkoutForm, setCheckoutForm] = useState<CheckoutForm>(defaultCheckoutForm);
  const [selectedSavedCard, setSelectedSavedCard] = useState<SavedCard | null>(null);
  const [savedCardsLoading, setSavedCardsLoading] = useState(false);
  const handleSavedCardSelect = useCallback((card: SavedCard | null) => setSelectedSavedCard(card), []);

  // Si el restaurante solo acepta un método de pago, ajusta el seleccionado por
  // defecto para que el checkout siempre arranque con una opción válida.
  useEffect(() => {
    if (!rawRestaurant) return;
    const accepted = getAcceptedPaymentMethods(rawRestaurant);
    if (accepted.length === 1 && checkoutForm.paymentMethod !== accepted[0]) {
      setCheckoutForm((current) => ({ ...current, paymentMethod: accepted[0] as PaymentMethod }));
    }
  }, [rawRestaurant, checkoutForm.paymentMethod]);
  const [promoCodeState, setPromoCodeState] = useState<'idle' | 'validating' | 'valid' | 'invalid'>('idle');
  const [promoCodeInfo, setPromoCodeInfo] = useState<{ code: string; type: 'PERCENT' | 'AMOUNT' | 'FREE_DELIVERY' | 'FREE_PRODUCT'; value: number; discount: number; description?: string | null; gift?: { id: string; name: string } | null } | null>(null);
  const [isCouponOpen, setIsCouponOpen] = useState(false);
  const [couponFeedback, setCouponFeedback] = useState<{ tone: 'success' | 'error'; title: string; message?: string } | null>(null);
  const couponFeedbackTimerRef = useRef<number | null>(null);
  const [loadingRestaurant, setLoadingRestaurant] = useState(!initialRestaurant);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [isPreConfirmOpen, setIsPreConfirmOpen] = useState(false);
  const [isHoursModalOpen, setIsHoursModalOpen] = useState(false);
  const [preConfirmCountdown, setPreConfirmCountdown] = useState(4);
  const preConfirmPhaseRef = useRef<'idle' | 'countdown' | 'committed'>('idle');
  const preConfirmTimerRef = useRef<number | null>(null);
  const preConfirmCommitTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (preConfirmTimerRef.current !== null) {
      window.clearInterval(preConfirmTimerRef.current);
      preConfirmTimerRef.current = null;
    }
    if (preConfirmCommitTimerRef.current !== null) {
      window.clearTimeout(preConfirmCommitTimerRef.current);
      preConfirmCommitTimerRef.current = null;
    }
  }, []);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(() => urlSearchParams?.checkout === 'true');
  const cardCheckoutRequestRef = useRef(0);
  const [showInstructions, setShowInstructions] = useState(() =>
    Boolean(checkoutForm.storeNotes || checkoutForm.notes)
  );
  const [error, setError] = useState('');
  const [menuReloadKey, setMenuReloadKey] = useState(0);
  const [deliveryErrorModal, setDeliveryErrorModal] = useState('');
  const [locationNotice, setLocationNotice] = useState(false);
  const locationNoticeRef = useRef<HTMLDialogElement>(null);
  const [fulfillmentType, setFulfillmentType] = useState<'DELIVERY' | 'PICKUP'>(
    urlSearchParams?.fulfillment === 'PICKUP' ? 'PICKUP' : 'DELIVERY'
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
    if (urlSearchParams?.fulfillment === 'PICKUP') {
      setFulfillmentType('PICKUP');
    }
  }, [urlSearchParams]);

  useEffect(() => {
    if (urlSearchParams?.product && restaurant) {
      const productId = typeof urlSearchParams.product === 'string' ? urlSearchParams.product : urlSearchParams.product[0];
      for (const category of restaurant.categories) {
        const prod = category.products.find((p) => p.id === productId);
        if (prod) {
          setCustomizingProduct(prod);
          break;
        }
      }
    }
  }, [urlSearchParams, restaurant]);

  useEffect(() => {
    if (!urlSearchParams?.focusProduct || !restaurant) return;
    const productId = typeof urlSearchParams.focusProduct === 'string' ? urlSearchParams.focusProduct : urlSearchParams.focusProduct[0];
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
  }, [urlSearchParams, restaurant]);

  const [transientNotice, setTransientNotice] = useState<TransientNotice | null>(null);
  // Latido del banner de pedido activo al crear un pedido (scroll + animación).
  const [orderCreatedPulse, setOrderCreatedPulse] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const activeCategoryRef = useRef<string | null>(null);
  const categoryNavRef = useRef<HTMLDivElement | null>(null);
  const categorySearchRef = useRef<HTMLDivElement | null>(null);
  const categoryScrollTargetRef = useRef<string | null>(null);
  const categoryScrollIdleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isRatingModalOpen, setIsRatingModalOpen] = useState(false);
  const [orderToRate, setOrderToRate] = useState<string | null>(null);
  const [ratingIsPickup, setRatingIsPickup] = useState(false);
  const [restaurantRating, setRestaurantRating] = useState(0);
  const [ratingComment, setRatingComment] = useState('');
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
  const checkoutLayerRef = useRef<HTMLDivElement | null>(null);
  const closeCheckout = useCallback(() => {
    cardCheckoutRequestRef.current += 1;
    const layer = checkoutLayerRef.current;
    if (layer?.contains(document.activeElement)) {
      if (cartButtonRef.current?.isConnected) cartButtonRef.current.focus({ preventScroll: true });
      else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    }
    setIsCheckoutOpen(false);
  }, []);
  const checkoutMapRef = useRef<any>(null);
  const checkoutMarkerRef = useRef<any>(null);
  const [checkoutMapUnavailable, setCheckoutMapUnavailable] = useState(false);
  const markerGeocodeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markerGeocodeSeqRef = useRef(0);
  // Libera la instancia del mapa del checkout sin tocar el DOM (el div
  // #map-checkout lo gestiona Google Maps y React no debe desmontarlo).
  // Evita listeners duplicados (dragend) y fugas al mostrar/ocultar el mapa.
  const teardownCheckoutMap = useCallback(() => {
    if (markerGeocodeTimerRef.current) clearTimeout(markerGeocodeTimerRef.current);
    markerGeocodeTimerRef.current = null;
    markerGeocodeSeqRef.current += 1;
    try {
      const mapsEvent = (window as any)?.google?.maps?.event;
      if (mapsEvent) {
        if (checkoutMarkerRef.current) mapsEvent.clearInstanceListeners(checkoutMarkerRef.current);
        if (checkoutMapRef.current) mapsEvent.clearInstanceListeners(checkoutMapRef.current);
      }
      try {
        checkoutMarkerRef.current?.setMap(null);
      } catch {
        // noop: el marcador puede pertenecer ya a una instancia descartada.
      }
    } catch {
      // noop: sin API de Maps cargada no hay nada que limpiar.
    }
    checkoutMarkerRef.current = null;
    checkoutMapRef.current = null;
    const mapEl = document.getElementById('map-checkout');
    // Descarta el DOM que quedó bajo el div (no existe destroy() oficial en Maps; limpiar el contenedor evita stacked al re-mostrar).
    if (mapEl) mapEl.innerHTML = '';
  }, []);
  const categorySectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const transientNoticeTimeoutRef = useRef<number | null>(null);
  const recentNoticeKeysRef = useRef<string[]>([]);
  const lastActiveOrderStatusRef = useRef<string>('');
  const recentCreatedOrderRef = useRef<{ id: string; orderReference: string; paymentMethod?: string } | null>(null);
  const orderCreatedPulseTimerRef = useRef<number | null>(null);
  const loadActiveOrdersRef = useRef<() => void>(() => {});
  const creatingOrderRef = useRef(false);
  const clientOrderKeyRef = useRef('');
  const cartSignatureRef = useRef('');
  const socketRef = useRef<any>(null);

  // Clave de idempotencia: estable entre reintentos del MISMO contenido de compra
  // (red caída, timeout, doble toque, recarga) y solo cambia cuando cambia el
  // contenido real o cuando el intento anterior terminó con éxito.
  // Se deriva del body que realmente se envía, de modo que la firma y la
  // solicitud no pueden divergir, y en storage solo queda el hash (nunca el
  // contenido del carrito, la dirección ni datos de pago).
  // Ranura propia por restaurante: un checkout pendiente en curso no se pisa al
  // navegar a otro restaurante ni al usar "Volver a pedir".
  const checkoutScope = useMemo(
    () => ({ kind: 'checkout' as const, id: restaurant?.id || '' }),
    [restaurant?.id]
  );
  const ensureClientOrderKey = useCallback((body: Record<string, any>, context: { userId: string }) => {
    const resolved = resolveOrderIntentKey({
      body,
      userId: context.userId,
      scope: checkoutScope,
      current: clientOrderKeyRef.current
        ? { key: clientOrderKeyRef.current, signatureHash: cartSignatureRef.current }
        : null,
    });
    clientOrderKeyRef.current = resolved.key;
    cartSignatureRef.current = resolved.signatureHash;
    return resolved.key;
  }, [checkoutScope]);
  const resetClientOrderKey = useCallback(() => {
    clientOrderKeyRef.current = '';
    cartSignatureRef.current = '';
    completeOrderIntent(checkoutScope);
  }, [checkoutScope]);

  const [pickupReadyOrder, setPickupReadyOrder] = useState<CustomerOrderDetail | null>(null);
  const [scheduleProposalOrder, setScheduleProposalOrder] = useState<CustomerOrderDetail | null>(null);
  const [previewProduct, setPreviewProduct] = useState<(PublicRestaurantDetail['categories'][number]['products'][number] & { images: string[] }) | null>(null);
  const previewDialogRef = useRef<HTMLDialogElement>(null);
  const previewSuspendedRef = useRef(false);
  const [previewIndex, setPreviewIndex] = useState(0);

  // Product options / customization modal state
  const [customizingProduct, setCustomizingProduct] = useState<PublicRestaurantDetail['categories'][number]['products'][number] | null>(null);
  const [carouselIndexMap, setCarouselIndexMap] = useState<Record<string, number>>({});
  const [selectedOptionsForProduct, setSelectedOptionsForProduct] = useState<Record<string, any[]>>({});
  const [customizingQuantity, setCustomizingQuantity] = useState(1);
  const [customizingWeight, setCustomizingWeight] = useState(0);
  const [weightInput, setWeightInput] = useState('');
  const [weightUnit, setWeightUnit] = useState<'g' | 'kg'>('g');
  const [customizingInstructions, setCustomizingInstructions] = useState('');
  const [weightLimitWarning, setWeightLimitWarning] = useState(false);
  const [weightLimitPendingValue, setWeightLimitPendingValue] = useState(0);

  const [previewLightboxOpen, setPreviewLightboxOpen] = useState(false);
  const [customizingLightboxOpen, setCustomizingLightboxOpen] = useState(false);

  const openProductPreview = (product: PublicRestaurantDetail['categories'][number]['products'][number]) => {
    const imgs = product.images?.length ? product.images : product.image ? [product.image] : [];
    setPreviewProduct({ ...product, images: imgs });
    setPreviewIndex(0);
    setPreviewLightboxOpen(false);
  };

  useEffect(() => {
    const dialog = previewDialogRef.current;
    if (previewProduct && !customizingProduct && dialog && !dialog.open) dialog.showModal();
  }, [previewProduct, customizingProduct]);

  const currentPreviewProduct = previewProduct
    ? restaurant?.categories.flatMap(category => category.products).find(product => product.id === previewProduct.id) ?? null
    : null;

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
    // Un refresh silencioso de acceso (requestJson) renueva el token en
    // localStorage pero no el estado React; suscribirse al evento lo mantiene
    // al día para el chat y las llamadas API que usan el estado.
    const onTokenRefreshed = (event: Event) => {
      const nextToken = (event as CustomEvent<string>).detail;
      if (nextToken) setToken(nextToken);
    };
    window.addEventListener('sadel:token-refreshed', onTokenRefreshed);

    try {
      const savedSession = readStoredSession(storageKey);

      if (typeof window !== 'undefined' && window.localStorage) {
        if (document.documentElement.classList.contains('dark')) {
          document.documentElement.classList.add('dark');
          document.documentElement.classList.add('pure-dark');
        }
      }

      // `readStoredSession` already rejects cross-origin values (e.g. //evil.com);
      // keep an explicit guard as defence in depth before using it with the JWT.
      if (savedSession.apiBase && /^\/(?!\/)/.test(savedSession.apiBase) && !savedSession.apiBase.includes('..')) {
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
          // Solo ante sesión irrecuperable; un 403 de permisos/negocio o un
          // fallo transitorio conserva la sesión.
          if (isSessionInvalidError(err)) {
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
      window.removeEventListener('sadel:token-refreshed', onTokenRefreshed);
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
      setError('');

      try {
        const payload = await requestJson<{ success: true; data: PublicRestaurantDetail }>({
          apiBase,
          path: `/menu${getUserLocationQuery()}`,
          token: token || undefined,
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
          // La pantalla de carga espera a que el menú esté listo (o a que falle,
          // para mostrar el estado de error existente con su reintento).
          window.dispatchEvent(new Event('wingslab:app-ready'));
        }
      }
    }

    void loadRestaurant();

    return () => {
      cancelled = true;
    };
  }, [apiBase, urlParams.restaurantId, menuReloadKey, token]);

  useEffect(() => {
    let cancelled = false;
    const refreshStatus = async () => {
      try {
        const response = await fetch(`${apiBase}/menu`, { cache: 'no-store' });
        if (!response.ok) return;
        const result = await response.json();
        if (!cancelled && typeof result?.data?.isOpen === 'boolean') {
          setRawRestaurant(current => current ? { ...current, isOpen: result.data.isOpen } : current);
        }
      } catch { /* Keep the last successfully loaded restaurant state. */ }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') void refreshStatus(); };
    const timer = window.setInterval(refreshStatus, 60000);
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [apiBase]);

  useEffect(() => {
    if (!token || sessionUser?.role !== 'CUSTOMER') {
      setActiveOrderListItems([]);
      setActiveOrderDetailsMap({});
      loadActiveOrdersRef.current = () => {};
      return;
    }

    let cancelled = false;

    let loadRevision = 0;
    async function loadActiveOrders() {
      const revision = ++loadRevision;
      try {
        const ordersPayload = await requestJson<PaginatedOrdersResponse>({
          apiBase,
          path: '/me/pedidos?page=1&limit=12',
          token,
          fallbackMessage: 'No se pudo cargar el pedido activo.',
        });
        if (cancelled || revision !== loadRevision) return;

        const recentCreatedOrder = recentCreatedOrderRef.current;
        if (recentCreatedOrder) {
          const recentOrder = ordersPayload.data.items.find((order) => order.id === recentCreatedOrder.id);
          const normalizedRecentStatus = recentOrder ? normalizeOrderStatusValue(recentOrder.status) : '';

          if (normalizedRecentStatus === 'REJECTED') {
            showTransientNotice({
              key: `restaurant-recent-order-rejected:${recentCreatedOrder.id}`,
              title: 'Pedido rechazado',
              description: 'El restaurante no pudo aceptar tu pedido.',
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

        if (!cancelled && revision === loadRevision) {
          setActiveOrderListItems(activeItems);
          const nextMap: Record<string, CustomerOrderDetail> = {};
          results.forEach((detail) => {
            if (detail) {
              nextMap[detail.id] = detail;
            }
          });
          setActiveOrderDetailsMap(nextMap);

          // Respaldo al socket: si hay una propuesta de horario pendiente que el
          // cliente aún no acepta/rechaza, abrir el modal desde aquí también
          // (igual que la home). Sin esto, si el evento socket se perdió o el
          // cliente entró al menú DESPUÉS de la propuesta, nunca aparecía.
          const pendingProposal = results.find(
            (detail) =>
              detail &&
              detail.status === 'CONFIRMED' &&
              detail.scheduledDeliveryAt &&
              !detail.scheduledDeliveryCustomerAcceptedAt
          );
          if (pendingProposal) {
            setScheduleProposalOrder((prev) => prev ?? pendingProposal);
          }
        }
      } catch {
        // Keep the last known state during transient failures; polling will retry.
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
    const socket = io(getWingslabSocketUrl(), {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
      auth: { token: getSocketToken() },
    });

    const handleReconnectAttempt = () => {
      socket.auth = { token: getSocketToken() };
    };
    socket.io.on('reconnect_attempt', handleReconnectAttempt);

    socket.on('connect', () => {
      socket.emit('join-room', sessionUser.id, 'CUSTOMER');
      loadActiveOrdersRef.current();
    });

    socket.on('connect_error', (err) => {
      // Token rechazado: intentar renovar y reconectar antes de sentenciar la
      // sesión. Solo un refresh definitivamente inválido cierra sesión; un
      // fallo transitorio deja el polling de respaldo sin formar bucles.
      if (String((err as Error)?.message || '').includes('UNAUTHORIZED')) {
        socket.disconnect();
        void handleSocketUnauthorized({
          apiBase,
          storageKey,
          socket,
          isActive: () => socketRef.current === socket,
          onLoggedOut: () => forceSessionExpired(),
        });
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
          if (trackingOrderIdRef.current === payload.orderId && Number.isFinite(payload.latitude) && Number.isFinite(payload.longitude) && Math.abs(payload.latitude) <= 90 && Math.abs(payload.longitude) <= 180) {
            const updatedAt = payload.locationUpdatedAt || payload.updatedAt;
            const incomingTime = Date.parse(updatedAt || '');
            if (!Number.isFinite(incomingTime)) return;
            setDriverLocation(previous => previous && previous.orderId === payload.orderId && Date.parse(previous.updatedAt || '') >= incomingTime ? previous : { orderId: payload.orderId, lat: payload.latitude, lng: payload.longitude, updatedAt });
          }
        }
        
        if (eventName === 'order:rejected') {
          const matchingOrder = activeOrderListItems.find((o) => o.id === payload.orderId)
            || (recentCreatedOrderRef.current?.id === payload.orderId ? recentCreatedOrderRef.current : null);
          const paymentMethod = matchingOrder?.paymentMethod;
          const orderReference = matchingOrder?.orderReference || recentCreatedOrderRef.current?.orderReference;

          const description = 'El restaurante no pudo aceptar tu pedido.';

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
          setRatingIsPickup(false);
          setIsRatingModalOpen(true);
        }

        if (eventName === 'order:picked-up' && payload.orderId) {
          const existing = activeOrderDetailsMapRef.current[payload.orderId];
          const isPickup = existing?.fulfillmentType === 'PICKUP';
          if (isPickup) {
            if (localStorage.getItem(`sadel_dismissed_rating_${payload.orderId}`)) return;
            setOrderToRate(payload.orderId);
            setRatingIsPickup(true);
            setIsRatingModalOpen(true);
          }
        }

        if (eventName === 'order:completed' && payload.orderId) {
          if (localStorage.getItem(`sadel_dismissed_rating_${payload.orderId}`)) return;
          setOrderToRate(payload.orderId);
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

        if (eventName === 'order:accepted' && payload.orderId) {
          // El restaurante confirmó el pedido mientras el comensal navega el
          // menú: avisar aquí mismo, porque esta vista no entra al centro de
          // notificaciones del inicio.
          try {
            if (window.localStorage.getItem('customerAlertSoundEnabled') !== 'false') {
              void playLlegue();
            }
            if (navigator.vibrate) navigator.vibrate([300, 100, 300]);
          } catch (e) {}
          const matchingOrder = activeOrderListItems.find((o) => o.id === payload.orderId)
            || (recentCreatedOrderRef.current?.id === payload.orderId ? recentCreatedOrderRef.current : null);
          const acceptedNotice = buildOrderAcceptedNotice(payload.orderId, matchingOrder?.orderReference);
          setTransientNotice({
            id: acceptedNotice.key,
            title: acceptedNotice.title,
            description: payload.status === 'PREPARING' ? 'El restaurante aceptó tu pedido y ya lo está preparando.' : acceptedNotice.description,
            tone: acceptedNotice.tone,
            orderId: acceptedNotice.orderId,
            orderReference: acceptedNotice.orderReference,
          });
        }

        if (eventName === 'order:ready' && payload.orderId) {
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
            fallbackMessage: 'No se pudo cargar el detalle del pedido.',
          }).then((res) => {
            if (res.success && res.data.fulfillmentType === 'PICKUP') {
              setPickupReadyOrder(res.data);
            }
          }).catch(() => {
            // La notificación del pedido listo se envía independientemente del detalle.
          });
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
      socket.io.off('reconnect_attempt', handleReconnectAttempt);
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
    if (!isCheckoutOpen || showMaxCashModal || showGpsCashModal || deliveryErrorModal || locationNotice || isPushReminderModalOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!checkoutRef.current?.contains(event.target as Node)) {
        closeCheckout();
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [closeCheckout, isCheckoutOpen, showMaxCashModal, showGpsCashModal, deliveryErrorModal, locationNotice, isPushReminderModalOpen]);

  useEffect(() => {
    if (locationNotice && locationNoticeRef.current && !locationNoticeRef.current.open) {
      locationNoticeRef.current.showModal();
    }
  }, [locationNotice]);

  useEffect(() => {
    if (!isCheckoutOpen || (isAddingNewAddress && newAddressStep === 'search') || (!showMapForAddress && !isAddingNewAddress)) {
      teardownCheckoutMap();
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
          const location = { lat: position.lat(), lng: position.lng() };
          
          setCheckoutForm((current) => ({
            ...current,
            latitude: String(location.lat),
            longitude: String(location.lng),
          }));

          // Collapse quick successive drags into one billable reverse-geocode request.
          if (markerGeocodeTimerRef.current) clearTimeout(markerGeocodeTimerRef.current);
          const requestSeq = ++markerGeocodeSeqRef.current;
          markerGeocodeTimerRef.current = setTimeout(() => {
            markerGeocodeTimerRef.current = null;

            try {
              const geocoder = new google.maps.Geocoder();
              geocoder.geocode({ location }, (results: any, status: any) => {
              if (requestSeq !== markerGeocodeSeqRef.current) return;
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
              if (requestSeq === markerGeocodeSeqRef.current) console.error('Error reverse geocoding on checkout marker drag:', err);
            }
          }, 500);
        });
      }
    };

    void ensureGoogleMapsScript().then((google) => {
      if (cancelled) return;
      if (!google || isGoogleMapsUnavailable()) {
        setCheckoutMapUnavailable(true);
        return;
      }
      setCheckoutMapUnavailable(false);
      initCheckoutMap(google);
    });

    return () => {
      cancelled = true;
    };
  }, [isCheckoutOpen, isAddingNewAddress, newAddressStep, showMapForAddress, checkoutForm.latitude, checkoutForm.longitude, teardownCheckoutMap]);

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
    if (!rawRestaurant || cartItems.length === 0) return;
    const freshByProduct: Record<string, { price: number; discountPrice?: number | null; maxStock?: number | null }> = {};
    for (const category of rawRestaurant.categories) {
      for (const product of category.products) {
        freshByProduct[product.id] = {
          price: product.price,
          discountPrice: product.discountPrice ?? null,
          maxStock: product.trackStock ? (product.stock ?? 0) : null,
        };
      }
    }
    const updates: Array<{ productId: string; price: number; discountPrice?: number | null; maxStock?: number | null }> = [];
    for (const item of cartItems) {
      const fresh = freshByProduct[item.productId];
      if (fresh) updates.push({ productId: item.productId, price: fresh.price, discountPrice: fresh.discountPrice, maxStock: fresh.maxStock });
    }
    if (updates.length) refreshCartItemPrices(updates);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCheckoutOpen, rawRestaurant, refreshCartItemPrices, cartItems.length]);

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
        description: 'El restaurante no pudo aceptar tu pedido.',
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
  // El carrito se hidruta desde localStorage (Zustand persist): en SSR es 0.
  // Mostramos 0 en el primer render del cliente y el valor real tras el mount
  // para evitar un mismatch de hidratación (React error #418).
  const [displayCartCount, setDisplayCartCount] = useState(0);
  useEffect(() => { setDisplayCartCount(totalProducts); }, [totalProducts]);
  const cartButtonRef = useRef<HTMLButtonElement>(null);
  const cartAnimationSource = useRef<{ x: number; y: number; time: number } | null>(null);
  const previousCartCount = useRef(totalProducts);
  useEffect(() => {
    const rememberSource = (event: MouseEvent) => {
      const button = (event.target as Element | null)?.closest('button');
      if (!button || button.closest('.wl-cart-drawer') || button === cartButtonRef.current) return;
      const rect = button.getBoundingClientRect();
      cartAnimationSource.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, time: Date.now() };
    };
    document.addEventListener('click', rememberSource, true);
    return () => document.removeEventListener('click', rememberSource, true);
  }, []);
  useEffect(() => {
    const previous = previousCartCount.current;
    previousCartCount.current = totalProducts;
    const source = cartAnimationSource.current;
    if (totalProducts <= previous || !source || Date.now() - source.time > 1000) return;
    cartAnimationSource.current = null;
    const target = cartButtonRef.current;
    if (!target || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const destination = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const flying = document.createElement('span');
    flying.className = 'wl-cart-flying';
    flying.setAttribute('aria-hidden', 'true');
    flying.textContent = `+${totalProducts - previous}`;
    document.body.appendChild(flying);
    const animation = flying.animate([
      { transform: `translate(${source.x}px, ${source.y}px) translate(-50%, -50%) scale(.8)`, opacity: 1, offset: 0 },
      { transform: `translate(${(source.x + destination.x) / 2}px, ${Math.min(source.y, destination.y) - 70}px) translate(-50%, -50%) scale(1.1)`, opacity: 1, offset: .5 },
      { transform: `translate(${destination.x}px, ${destination.y}px) translate(-50%, -50%) scale(.35)`, opacity: 0, offset: 1 },
    ], { duration: 650, easing: 'ease-in-out' });
    animation.onfinish = () => { flying.remove(); if (target.isConnected) target.animate([{ transform:'scale(1)', backgroundColor:'#ffffff1f', boxShadow:'0 0 0 0 #fff0' }, { transform:'scale(1.12)', backgroundColor:'#ffffff70', boxShadow:'0 0 0 8px #fff5' }, { transform:'scale(1)', backgroundColor:'#ffffff1f', boxShadow:'0 0 0 0 #fff0' }, { transform:'scale(1.06)', backgroundColor:'#ffffff55', boxShadow:'0 0 0 4px #fff3' }, { transform:'scale(1)', backgroundColor:'#ffffff1f', boxShadow:'0 0 0 0 #fff0' }], { duration: 550, easing:'ease-out' }); };
    animation.oncancel = () => flying.remove();
  }, [totalProducts]);
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

    // Si el checkout no está abierto, usamos por defecto la ubicación activa del usuario (userLocation).
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
  const [loyaltyQuote, setLoyaltyQuote] = useState<{ source: string; eligible: boolean; cardId?: string; discountCents?: number; gift?: { id: string; name: string } | null; rewardDescription?: string; reason?: string } | null>(null);
  const [useLoyalty, setUseLoyalty] = useState(true);
  const [loyaltyLoading, setLoyaltyLoading] = useState(false);
  const [loyaltyQuoteFailed, setLoyaltyQuoteFailed] = useState(false);
  const loyaltyKey = JSON.stringify({ subtotalCents: Math.round(effectiveSubtotal * 100), productIds: cart.map(item => item.productId), otherPromotion: couponDiscount > 0 || minOrderDiscount > 0 || discountAmount > 0 || (fulfillmentType !== 'PICKUP' && restaurant?.promoFreeDeliveryThreshold != null && effectiveSubtotal >= restaurant.promoFreeDeliveryThreshold) });
  useEffect(() => {
    if (!token || !isCheckoutOpen || !cart.length) { setLoyaltyQuote(null); setLoyaltyLoading(false); setLoyaltyQuoteFailed(false); return; }
    let active = true;
    setLoyaltyLoading(true);
    setLoyaltyQuoteFailed(false);
    const timer = window.setTimeout(() => {
      void requestJson<{ data: { eligible: boolean; cardId?: string; discountCents?: number; gift?: { id: string; name: string } | null; rewardDescription?: string; reason?: string } }>({ apiBase, token, path: '/customer/lealtad/cotizar', options: { method: 'POST', body: loyaltyKey }, retry: { attempts: 0 } })
        .then(result => { if (active) setLoyaltyQuote({ ...result.data, source: loyaltyKey }); })
        .catch(() => { if (active) { setLoyaltyQuote({ source: loyaltyKey, eligible: false }); setLoyaltyQuoteFailed(true); } })
        .finally(() => { if (active) setLoyaltyLoading(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [apiBase, token, isCheckoutOpen, loyaltyKey]);
  const loyaltyAvailable = !loyaltyLoading && loyaltyQuote?.source === loyaltyKey && loyaltyQuote.eligible;
  const loyaltyApplied = useLoyalty && loyaltyAvailable;
  const loyaltyDiscount = loyaltyApplied ? (loyaltyQuote?.discountCents || 0) / 100 : 0;
  const orderTotal = Math.max(0, effectiveSubtotal - couponDiscount - minOrderDiscount - loyaltyDiscount + serviceFee + (fulfillmentType === 'PICKUP' ? 0 : deliveryFee));
  const checkoutValidationMessage = useMemo(() => {
    return getCheckoutValidationMessage(checkoutForm, cart, restaurant, token, fulfillmentType, promoCodeState === 'valid' || loyaltyApplied);
  }, [cart, checkoutForm, restaurant, token, fulfillmentType, promoCodeState, loyaltyApplied]);

function triggerHaptic(pattern: number | number[] = 10) {
  if (typeof window !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(pattern);
  }
}

function getProductAvailability(p: { trackStock?: boolean; stock?: number; lowStockThreshold?: number; isAvailable?: boolean }) {
  const tracked = !!p.trackStock;
  const stock = typeof p.stock === 'number' ? p.stock : 0;
  const threshold = typeof p.lowStockThreshold === 'number' ? p.lowStockThreshold : 5;
  const available = p.isAvailable !== false && (!tracked || stock > 0);
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

type CustomerProduct = PublicRestaurantDetail['categories'][number]['products'][number];

function ProductImage({
  product,
  carouselIndex,
  imgClassName = '',
  onClick,
  eager = false,
}: {
  product: CustomerProduct;
  carouselIndex?: number | undefined;
  imgClassName?: string;
  onClick?: React.MouseEventHandler;
  eager?: boolean;
}) {
  const images = product.images?.length ? product.images : [];
  const src = images.length > 1 && typeof carouselIndex === 'number' ? images[carouselIndex % images.length] : product.image;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) return <div className="wl-product-placeholder"><Utensils aria-hidden="true" /><span>Fotografía no disponible</span></div>;

  return (
    <div className="h-full w-full overflow-hidden" style={{ transform: `scale(${(product.imageZoom ?? 100) / 100})`, transformOrigin: 'center center' }}>
      <img
        src={src}
        alt={product.name}
        onError={() => setFailed(true)}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        draggable={false}
        onClick={onClick}
        className={`h-full w-full object-contain transition duration-300 ${imgClassName}`}
        style={{ objectPosition: product.imagePosition || undefined }}
      />
    </div>
  );
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
      setWeightInput(isWeightProduct ? String(product.minWeightG || 100) : '');
      setWeightUnit('g');
      setCustomizingInstructions('');
      setWeightLimitWarning(false);
      setWeightLimitPendingValue(0);
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
    } as any, urlParams.restaurantId as string, restaurant?.serviceFee || 0, restaurant?.effectiveDeliveryFee || 0);
    triggerHaptic(15); // Small vibration
  }

  function decreaseQuantityForProduct(productId: string) {
    decreaseQuantity(productId);
    triggerHaptic(10);
  }

  function addCustomizedItemToCart() {
    if (!customizingProduct) return;
    if (customizingProduct.sellBy === 'WEIGHT' && (!isValidWeightInput(weightInput, weightUnit, customizingProduct.minWeightG || 100, customizingProduct.maxWeightG || 5000))) return;

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
    } as any, urlParams.restaurantId as string, restaurant?.serviceFee || 0, restaurant?.effectiveDeliveryFee || 0);

    setCustomizingProduct(null);
    setWeightLimitWarning(false);
    setWeightLimitPendingValue(0);
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
    if (!restaurant?.categories || menuTab !== 'home' || productSearchQuery.trim()) return;
    const header = document.querySelector<HTMLElement>('.wl-header');
    const nav = categoryNavRef.current;
    if (!nav) return;
    const search = categorySearchRef.current;
    const list = nav.querySelector<HTMLElement>('.wl-category-scroll');
    let frame = 0;
    let sections: Array<{ id: string; top: number }> = [];
    let line = 0;
    let viewportHeight = 0;
    let pageHeight = 0;
    let needsMeasure = true;
    const elements = restaurant.categories.flatMap(({ id }) => {
      const element = categorySectionRefs.current[id];
      return element && id !== '__promotions__' ? [{ id, element }] : [];
    });
    const measure = (scrollY: number) => {
      const headerHeight = header?.getBoundingClientRect().height ?? 68;
      const searchHeight = search?.getBoundingClientRect().height ?? 0;
      search?.style.setProperty('--wl-search-header-offset', `${headerHeight}px`);
      nav.style.setProperty('--wl-category-header-offset', `${headerHeight + searchHeight}px`);
      viewportHeight = window.innerHeight;
      pageHeight = document.documentElement.scrollHeight;
      line = categoryScrollLine(headerHeight + searchHeight, nav.getBoundingClientRect().height, viewportHeight);
      sections = elements.flatMap(({ id, element }) => {
        const rect = element.getBoundingClientRect();
        return rect.height ? [{ id, top: rect.top + scrollY }] : [];
      });
      needsMeasure = false;
    };
    const update = () => {
      frame = 0;
      const scrollY = window.scrollY;
      if (needsMeasure) measure(scrollY);
      const headerBottom = header?.getBoundingClientRect().bottom ?? 0;
      const searchRect = search?.getBoundingClientRect();
      const navRect = nav.getBoundingClientRect();
      const joined = Boolean(searchRect && Math.abs(searchRect.top - headerBottom) <= 2 && Math.abs(navRect.top - searchRect.bottom) <= 2);
      search?.classList.toggle('is-joined', joined);
      nav.classList.toggle('is-joined', joined);
      header?.classList.toggle('wl-controls-joined', joined);
      if (categoryScrollTargetRef.current) return;
      const last = sections[sections.length - 1];
      const viewportEnd = scrollY + viewportHeight;
      const next = viewportEnd >= pageHeight - 2 && last && last.top < viewportEnd ? last.id : categoryAtScrollLine(sections, scrollY + line);
      if (next !== activeCategoryRef.current) {
        activeCategoryRef.current = next;
        setActiveCategory(next);
        revealActive();
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const invalidate = () => { needsMeasure = true; schedule(); };
    const revealActive = () => {
      if (!list || categoryScrollTargetRef.current) return;
      const button = Array.from(list.querySelectorAll<HTMLButtonElement>('[data-category-id]'))
        .find(element => element.dataset.categoryId === activeCategoryRef.current);
      if (!button) return;
      const viewport = list.getBoundingClientRect();
      const item = button.getBoundingClientRect();
      const delta = item.left < viewport.left ? item.left - viewport.left : item.right > viewport.right ? item.right - viewport.right : 0;
      if (Math.abs(delta) > 1) list.scrollBy({ left: delta, behavior: 'instant' });
    };
    const clearPending = () => {
      categoryScrollTargetRef.current = null;
      if (categoryScrollIdleRef.current) clearTimeout(categoryScrollIdleRef.current);
      categoryScrollIdleRef.current = null;
    };
    const onScroll = () => {
      if (categoryScrollTargetRef.current) {
        // Wait for the actual end of smooth scrolling rather than a fixed
        // travel time or the moment the target passes the tracking line.
        if (categoryScrollIdleRef.current) clearTimeout(categoryScrollIdleRef.current);
        categoryScrollIdleRef.current = setTimeout(clearPending, 180);
      }
      schedule();
    };
    const onManualScroll = () => { clearPending(); schedule(); };
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(invalidate);
    if (header) resizeObserver?.observe(header);
    if (search) resizeObserver?.observe(search);
    resizeObserver?.observe(nav);
    resizeObserver?.observe(document.body);
    for (const { element } of elements) resizeObserver?.observe(element);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('wheel', onManualScroll, { passive: true });
    window.addEventListener('touchstart', onManualScroll, { passive: true });
    window.addEventListener('resize', invalidate);
    schedule();
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('wheel', onManualScroll); window.removeEventListener('touchstart', onManualScroll); window.removeEventListener('resize', invalidate); resizeObserver?.disconnect(); clearPending(); if (frame) cancelAnimationFrame(frame); search?.classList.remove('is-joined'); nav.classList.remove('is-joined'); header?.classList.remove('wl-controls-joined'); };
  }, [restaurant, menuTab, productSearchQuery]);

  function goHome() {
    setMenuTab('home');
    setProductSearchQuery('');
    activeCategoryRef.current = null;
    setActiveCategory(null);
    if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function scrollToCategory(categoryId: string) {
    const target = categorySectionRefs.current[categoryId];

    if (!target) {
      return;
    }

    activeCategoryRef.current = categoryId;
    setActiveCategory(categoryId);

    const stickyHeight = (document.querySelector('.wl-header')?.getBoundingClientRect().height ?? 68)
      + (categorySearchRef.current?.getBoundingClientRect().height ?? 0)
      + (categoryNavRef.current?.getBoundingClientRect().height ?? 0);

    const targetPosition = target.getBoundingClientRect().top + window.scrollY - stickyHeight;
    categoryScrollTargetRef.current = categoryId;
    if (categoryScrollIdleRef.current) clearTimeout(categoryScrollIdleRef.current);
    // Also clear the guard if the destination is already in place and the
    // browser therefore emits no scroll event.
    categoryScrollIdleRef.current = setTimeout(() => {
      categoryScrollTargetRef.current = null;
      categoryScrollIdleRef.current = null;
    }, 180);

    window.scrollTo({
      top: targetPosition,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
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
    if (locatingAddress) return;
    if (typeof window === 'undefined' || !navigator.geolocation) {
      setLocationNotice(true);
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
            const google = await ensureGoogleMapsScript();
            if (!google) throw new Error("Google Maps not loaded");

            const geocoder = new google.maps.Geocoder();
            await new Promise<void>((resolve, reject) => geocoder.geocode({ location: { lat: latitude, lng: longitude } }, (results: any, status: any) => {
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
                resolve();
              } else {
                  reject(new Error('No reverse-geocoding result'));
              }
            }));
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
        setLocationNotice(true);
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
        data: { code: string; type: 'PERCENT' | 'AMOUNT' | 'FREE_DELIVERY' | 'FREE_PRODUCT'; value: number; description?: string | null; minOrderAmount?: number | null; discount: number; gift?: { id: string; name: string } | null };
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
            : payload.data.type === 'FREE_PRODUCT'
              ? `${payload.data.gift?.name || 'Producto gratis'} de regalo en tu pedido`
              : 'Envío gratis';
      showCouponFeedback('success', `Cupón ${payload.data.code} aplicado`, typeLabel);
    } catch (e: any) {
      setPromoCodeState('invalid');
      const msg = e instanceof Error ? e.message : 'El código promocional no es válido.';
      showCouponFeedback('error', 'Cupón no válido', msg);
    }
  }

  function stopPreConfirmTimers() {
    if (preConfirmTimerRef.current !== null) {
      window.clearInterval(preConfirmTimerRef.current);
      preConfirmTimerRef.current = null;
    }
    if (preConfirmCommitTimerRef.current !== null) {
      window.clearTimeout(preConfirmCommitTimerRef.current);
      preConfirmCommitTimerRef.current = null;
    }
  }

  function clearPreConfirm() {
    if (preConfirmPhaseRef.current !== 'countdown') return;
    preConfirmPhaseRef.current = 'idle';
    stopPreConfirmTimers();
    setIsPreConfirmOpen(false);
    setPreConfirmCountdown(4);
  }

  function commitPreOrder() {
    if (preConfirmPhaseRef.current !== 'countdown') return;
    preConfirmPhaseRef.current = 'committed';
    stopPreConfirmTimers();
    setIsPreConfirmOpen(false);
    setPreConfirmCountdown(4);
    void createOrder();
  }

  function openPreConfirm() {
    if (preConfirmPhaseRef.current === 'countdown' || creatingOrderRef.current) return;
    preConfirmPhaseRef.current = 'countdown';
    setPreConfirmCountdown(4);
    setIsPreConfirmOpen(true);
    const deadline = Date.now() + 4000;
    preConfirmTimerRef.current = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setPreConfirmCountdown(remaining);
      if (remaining === 0) commitPreOrder();
    }, 100);
  }

  // This public flag is injected only by the explicit local sandbox config.
  // The backend independently enforces its private sandbox charge gate.
  const cardEnabled = process.env.NEXT_PUBLIC_WINGSLAB_MP_SANDBOX === 'true' && getAcceptedPaymentMethods(restaurant).includes('CREDIT_CARD');

  async function startCardCheckout() {
    if (!cardEnabled || !token || !sessionUser?.id) return;
    if (promoCodeState === 'valid' || loyaltyApplied) {
      setError('Para pagar con tarjeta, quita el cupón o la recompensa aplicados. Solo están disponibles con efectivo.');
      return;
    }
    const request = ++cardCheckoutRequestRef.current;
    setError('');
    const form = applyDeliveryPreset(checkoutForm, deliveryPreset);

    // Con tarjeta el GPS es best-effort: un permiso denegado o un error del
    // dispositivo no bloquea el pago (las restricciones de ubicación son solo
    // para efectivo).
    let location: Awaited<ReturnType<typeof getCurrentOrderLocation>> | null = null;
    try {
      location = await getCurrentOrderLocation();
    } catch {
      // El cobro continúa sin coordenadas actuales.
    }
    if (request !== cardCheckoutRequestRef.current) return;

    if (fulfillmentType !== 'PICKUP') {
      // La dirección debe existir en el backend. La verificación usa las
      // coordenadas de la dirección, no el GPS del dispositivo.
      try {
        await requestJson<{ success: boolean; data: any }>({
          apiBase,
          path: '/customer/addresses/verify',
          token,
          options: {
            method: 'POST',
            body: JSON.stringify({
              street: form.street.trim(), number: form.number.trim(),
              neighborhood: form.neighborhood.trim(), city: form.city.trim(),
              state: form.state.trim(), zipCode: form.zipCode.trim(), country: form.country.trim(),
              ...(form.reference.trim() ? { reference: form.reference.trim() } : {}),
              latitude: parseFloat(form.latitude), longitude: parseFloat(form.longitude),
            }),
          },
          fallbackMessage: 'No se pudo verificar la dirección de entrega.',
        });
      } catch {
        // La reserva puede crear la dirección; no exigimos GPS para tarjeta.
      }
    }
    if (request !== cardCheckoutRequestRef.current) return;

    const body: Record<string, unknown> = {
      items: cart.map(item => ({
        productId: item.productId,
        quantity: item.quantity,
        ...(item.specialInstructions.trim() ? { specialInstructions: item.specialInstructions.trim() } : {}),
        optionIds: (item.selectedOptions || []).map(o => o.id),
        sellBy: item.sellBy || 'UNIT',
        ...(item.sellBy === 'WEIGHT' && item.weightG ? { weightG: item.weightG } : {}),
      })),
      fulfillmentType,
      paymentMethod: 'CREDIT_CARD',
      locationVerified: !!location,
      ...(location ? { currentLocation: location } : {}),
      ...(form.storeNotes.trim() || form.notes.trim()
        ? { notes: [form.storeNotes.trim() ? `Tienda: ${form.storeNotes.trim()}` : '', fulfillmentType !== 'PICKUP' && form.notes.trim() ? `Repartedor: ${form.notes.trim()}` : ''].filter(Boolean).join('\n') }
        : {}),
      ...(fulfillmentType !== 'PICKUP' ? {
        deliveryAddress: {
          street: form.street.trim(), number: form.number.trim(), neighborhood: form.neighborhood.trim(),
          city: form.city.trim(), state: form.state.trim(), zipCode: form.zipCode.trim(), country: form.country.trim(),
          ...(form.reference.trim() ? { reference: form.reference.trim() } : {}),
          latitude: parseFloat(form.latitude), longitude: parseFloat(form.longitude),
        },
      } : {}),
    };
    setCardCheckoutDraft({ body, userId: sessionUser.id, restaurantId: urlParams.restaurantId, savedCard: selectedSavedCard });
    closeCheckout();
    router.push('/pago/tarjeta');
  }

  async function createOrder() {
    if (creatingOrderRef.current || creatingOrder || !restaurant) {
      return;
    }
    if (loyaltyLoading || (token && isCheckoutOpen && loyaltyQuote?.source !== loyaltyKey)) {
      setError('Espera a que termine de consultar tu recompensa antes de confirmar.');
      return;
    }
    creatingOrderRef.current = true;
    if (checkoutValidationMessage) {
      setError(checkoutValidationMessage);
      // La guardia se libera: no se envió nada y no hay operación en curso.
      // El siguiente clic vuelve a intentarlo con normalidad.
      creatingOrderRef.current = false;
      return;
    }

    setCreatingOrder(true);
    setError('');

    let orderRequestStarted = false;
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
      if (normalizedCheckoutForm.paymentMethod === 'CASH' && fulfillmentType !== 'PICKUP' && restaurant?.latitude && restaurant?.longitude) {
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
          setDeliveryErrorModal(`El pago en efectivo no está disponible porque la dirección está fuera del radio de entrega (máximo ${maxRadius} km). ${cardEnabled ? 'Selecciona Tarjeta para continuar.' : 'El restaurante no tiene tarjeta habilitada; elige una dirección dentro de cobertura.'}`);
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
          setDeliveryErrorModal(`El pago en efectivo no está disponible porque estás demasiado lejos de la dirección de entrega (${distance.toFixed(1)} km). ${cardEnabled ? 'Selecciona Tarjeta para continuar.' : 'El restaurante no tiene tarjeta habilitada; verifica tu dirección y ubicación.'}`);
          setCreatingOrder(false);
          return;
        }
      }
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
        ...(combinedNotes ? { notes: combinedNotes } : {}),
        locationVerified: !!currentLocation,
        ...(loyaltyApplied && loyaltyQuote?.cardId ? { loyalty: { cardId: loyaltyQuote.cardId, discountCents: loyaltyQuote.discountCents || 0, expectedTotalCents: Math.round(orderTotal * 100) } } : {}),
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

      // La clave se calcula con el body ya completo para que la identidad del
      // intento refleje exactamente lo que se envía (items, tipo de entrega,
      // dirección, pago, notas y cupón).
      body.clientOrderKey = ensureClientOrderKey(body, {
        userId: sessionUser?.id || '',
      });

      orderRequestStarted = true;
      const payload = await requestJson<{ success: true; data: { id: string; orderReference: string }; isDuplicate?: boolean }>({
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
      // Pedido creado y confirmado por el servidor: la próxima compra usa clave nueva.
      // Si el POST hubiera fallado/timeout, la clave se conserva para que un reintento
      // sea deduplicado por el backend (idempotencia) en vez de duplicar el pedido.
      resetClientOrderKey();
      setCheckoutForm((prev) => ({ ...prev, notes: '', storeNotes: '', promoCode: '' }));
      setPromoCodeState('idle');
      setPromoCodeInfo(null);
      setIsCouponOpen(false);
      setCouponFeedback(null);
      if (couponFeedbackTimerRef.current) {
        window.clearTimeout(couponFeedbackTimerRef.current);
        couponFeedbackTimerRef.current = null;
      }
      closeCheckout();
      recentCreatedOrderRef.current = {
        id: payload.data.id,
        orderReference: payload.data.orderReference,
        paymentMethod: checkoutForm.paymentMethod,
      };
      showTransientNotice({
        key: `restaurant-order-created:${payload.data.id}`,
        title: payload.isDuplicate ? 'Pedido ya recibido' : 'Pedido creado con éxito',
        description: payload.isDuplicate
          ? `Tu pedido ${payload.data.orderReference} ya había sido enviado al restaurante.`
          : 'Tu pedido fue enviado al restaurante. Espera mientras lo preparan.',
        tone: 'success',
      });
      triggerHaptic([30, 50, 30]); // Double vibration

      // Recordatorio de notificaciones (no bloqueante): se sugiere activar push
      // tras el éxito del pedido, en lugar de condicionar la confirmación.
      if (!payload.isDuplicate && !isSubscribed) {
        void canOfferCustomerWebPush().then((available) => {
          if (!available || recentCreatedOrderRef.current?.id !== payload.data.id) return;
          setIsPushReminderModalOpen(true);
        });
      }

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
      if (orderRequestStarted && (!(requestError instanceof ApiRequestError) || !requestError.status || requestError.status >= 500)) {
        setError('No pudimos confirmar si el pedido fue recibido. Revisa tus pedidos antes de volver a comprar; no cambies el carrito ni repitas el pedido hasta comprobarlo.');
      } else if (requestError instanceof ApiRequestError && requestError.code === 'PROMO_CODE_EXHAUSTED') {
        setPromoCodeState('invalid');
        setPromoCodeInfo(null);
        setCheckoutForm((prev) => ({ ...prev, promoCode: '' }));
        setError(requestError.message);
      } else if (requestError instanceof ApiRequestError && ['OUT_OF_DELIVERY_RANGE', 'CUSTOMER_TOO_FAR_FROM_DELIVERY_ADDRESS', 'CUSTOMER_LOCATION_REQUIRED', 'CUSTOMER_LOCATION_INVALID', 'CUSTOMER_LOCATION_LOW_ACCURACY'].includes(requestError.code || '')) {
        setDeliveryErrorModal(requestError.message);
      } else {
        setError(requestError instanceof Error ? requestError.message : 'No se pudo crear el pedido.');
      }
    } finally {
      setCreatingOrder(false);
      creatingOrderRef.current = false;
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
      className="wl-storefront min-h-[100dvh] text-neutral-900"
      data-order-overlay={isCartOpen || isCheckoutOpen || !!customizingProduct || showAuthModal ? 'open' : undefined}
    >
      {/* Pull to refresh indicator */}
      <div
        className={`fixed top-0 left-0 right-0 z-50 flex justify-center pt-2 pointer-events-none transition-opacity ${pullDistance > 0 || isRefreshing ? 'opacity-100' : 'opacity-0'}`}
        style={{ transform: `translateY(${Math.max(0, pullDistance - 40)}px)` }}
      >
        <div className="rounded-full bg-white dark:bg-zinc-800 p-2 shadow-lg border border-black/5 dark:border-white/10 flex items-center justify-center">
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
      <header suppressHydrationWarning className={`wl-header wl-official-header sticky top-0 z-40 pt-[env(safe-area-inset-top)] ${headerIsPinned ? 'wl-header-pinned' : ''}`}>
        <div className="wl-official-header-inner">
          <span aria-hidden="true" />
          <button type="button" onClick={goHome} className="wl-official-logo" aria-label="WingsLab, ir al inicio">
            <img className="wl-logo-on-light" src={officialWordmark.src} width={783} height={229} alt="" fetchPriority="high" />
            <img className="wl-logo-on-dark" src={officialWhiteWordmark.src} width={783} height={229} alt="" />
          </button>
          <div className="wl-header-actions-right">
            {!sessionUser && (
              <button
                type="button"
                className="wl-header-profile"
                aria-label="Iniciar sesión o crear cuenta"
                onClick={() => setShowAuthModal(true)}
              >
                <User aria-hidden="true" />
              </button>
            )}
            <button ref={cartButtonRef} type="button" onClick={() => setIsCartOpen(true)} className="wl-header-cart wl-official-cart" aria-label={`Abrir carrito de compra, ${displayCartCount} ${displayCartCount === 1 ? 'producto' : 'productos'}`}>
              <CartIcon strokeWidth={1.8} /><span className="wl-cart-count" aria-hidden="true">{displayCartCount > 99 ? '99+' : displayCartCount}</span>
            </button>
          </div>
        </div>
      </header>
      <CustomerNavigation active="inicio" onHome={goHome} onAuthenticated={handleLoginSuccess} onLogout={handleLogout} />

    {activeOrderListItems.length > 0 ? (
        <div className="border-b border-black/5 bg-white dark:border-zinc-800 dark:bg-neutral-900">
            <div className="mx-auto max-w-7xl px-4 py-4 md:px-6">
              <div className="relative">
              
              {/* Chevron Izquierdo */}
              {activeOrderListItems.length > 1 && (
                <button
                  type="button"
                  onClick={() => setCarouselIndex((prev) => (prev > 0 ? prev - 1 : activeOrderListItems.length - 1))}
                  className="absolute -left-3 md:-left-5 top-1/2 -translate-y-1/2 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-black/10 bg-white/90 text-neutral-800 shadow-md backdrop-blur transition hover:bg-neutral-50 active:scale-95 active-scale dark:border-white/10 dark:bg-zinc-800/90 dark:text-zinc-200 dark:hover:bg-zinc-700"
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
                    driverLocation={driverLocation?.orderId === activeOrder?.id ? driverLocation : null}
                  />
                )}
              </div>

              {/* Chevron Derecho */}
              {activeOrderListItems.length > 1 && (
                <button
                  type="button"
                  onClick={() => setCarouselIndex((prev) => (prev < activeOrderListItems.length - 1 ? prev + 1 : 0))}
                  className="absolute -right-3 md:-right-5 top-1/2 -translate-y-1/2 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-black/10 bg-white/90 text-neutral-800 shadow-md backdrop-blur transition hover:bg-neutral-50 active:scale-95 active-scale dark:border-white/10 dark:bg-zinc-800/90 dark:text-zinc-200 dark:hover:bg-zinc-700"
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
          <div className="wl-customize fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4 py-4 backdrop-blur-sm sm:px-6 sm:py-6" onClick={() => setCustomizingProduct(null)}>

                <div role="dialog" aria-modal="true" aria-labelledby="customize-product-title" className="relative bg-white dark:bg-neutral-900 rounded-[24px] sm:rounded-[32px] overflow-hidden shadow-[0_28px_90px_rgba(0,0,0,0.32)] flex flex-col w-full max-w-2xl max-h-[calc(100dvh-2rem)] sm:max-h-[90dvh] border border-black/5 dark:border-zinc-800 animate-fade-in" onClick={(e) => e.stopPropagation()}>
              
              {/* Botón de Cerrar */}
              <button
                type="button"
                onClick={() => setCustomizingProduct(null)}
                className="absolute top-3 right-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-neutral-950/65 text-white shadow-md backdrop-blur-sm transition hover:bg-neutral-950/85 active:scale-95"
                aria-label="Cerrar personalización"
              >
                <X className="h-5 w-5" strokeWidth={2.5} />
              </button>

              {/* Imagen y Detalles del Producto */}
              <div className="min-h-0 overflow-y-auto overscroll-contain flex-1">
                {customizingProduct.image ? (
                  <div className="relative h-48 w-full overflow-hidden bg-gradient-to-br from-neutral-100 to-neutral-200 min-[420px]:h-56 sm:h-72 dark:from-neutral-900 dark:to-neutral-950">
                    <img
                      src={customizingProduct.image}
                      className="h-full w-full cursor-zoom-in object-contain"
                      alt={customizingProduct.name}
                      loading="eager"
                      decoding="async"
                      fetchPriority="high"
                      draggable={false}
                      onClick={() => setCustomizingLightboxOpen(true)}
                    />
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent"></div>
                    <div className="absolute bottom-6 left-6 right-6 text-white">
                      <h3 id="customize-product-title" className="text-2xl font-bold tracking-[-0.03em] drop-shadow-sm">{customizingProduct.name}</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCustomizingLightboxOpen(true)}
                      aria-label="Ampliar imagen"
                      className="absolute bottom-4 right-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition hover:bg-black/60"
                    >
                      <ZoomIn className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div className="px-5 pb-4 pt-6 pr-16 sm:px-6 border-b border-black/5 dark:border-zinc-800 dark:bg-neutral-950">
                    <h3 id="customize-product-title" className="text-2xl font-bold text-neutral-950 dark:text-white tracking-[-0.03em]">{customizingProduct.name}</h3>
                  </div>
                )}

                <ImageZoomLightbox
                  open={customizingLightboxOpen && !!customizingProduct?.image}
                  images={customizingProduct?.image ? [customizingProduct.image] : []}
                  index={0}
                  onIndexChange={() => {}}
                  name={customizingProduct?.name ?? ''}
                  onClose={() => setCustomizingLightboxOpen(false)}
                />

                {/* Grupos de Modificadores */}
                <div className="divide-y divide-black/5 dark:divide-zinc-800">
                  {(customizingProduct.optionGroups || []).map((group: any) => {
                    const selected = selectedOptionsForProduct[group.id] || [];
                    const isRequired = group.minSelection > 0;
                    const isLimitReached = selected.length >= group.maxSelection;
                    const isRequirementMet = selected.length >= group.minSelection && selected.length <= group.maxSelection;

                    return (
                      <div key={group.id} className="px-5 py-5 sm:p-6">
                        <div className="flex items-start justify-between gap-4 mb-4">
                          <div>
                            <h4 className="font-semibold text-neutral-950 dark:text-white text-base">
                              {group.name}
                            </h4>
                            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400 font-medium">
                              {isRequired
                                ? group.minSelection === 1 && group.maxSelection === 1 ? 'Obligatorio · Elige una opción' : `Obligatorio · Elige de ${group.minSelection} a ${group.maxSelection} opciones`
                                : `Opcional · Elige hasta ${group.maxSelection} opciones`
                              }
                            </p>
                          </div>
                          <div>
                            {isRequired ? (
                              <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
                                isRequirementMet
                                  ? 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400'
                                  : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
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
                                aria-pressed={isChecked}
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
                                    ? 'border-red-400 bg-red-50 dark:border-red-700 dark:bg-red-900/20'
                                    : 'border-neutral-200 bg-white dark:bg-neutral-900 dark:border-zinc-700 hover:bg-neutral-50 dark:hover:bg-neutral-800/40'
                                } ${(!opt.isAvailable || isSelectionDisabled) ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                              >
                                <div className="flex items-center gap-3">
                                  {isSingleSelection ? (
                                    <div className={`flex h-5 w-5 items-center justify-center rounded-full border transition ${
                                      isChecked
                                        ? 'border-red-500 bg-red-500 text-white'
                                        : 'border-black/20 dark:border-zinc-700 bg-white dark:bg-neutral-800'
                                    }`}>
                                      {isChecked && <div className="h-2 w-2 rounded-full bg-white" />}
                                    </div>
                                  ) : (
                                    <div className={`flex h-5 w-5 items-center justify-center rounded-lg border transition ${
                                      isChecked
                                        ? 'border-red-500 bg-red-500 text-white'
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
                    const unitPrice = customizingProduct.unitPrice || 0;
                    const weightEstimate = (unitPrice * customizingWeight) / 1000;
                    let presets: number[] = [];
                    if (customizingProduct.weightPresets) {
                      if (Array.isArray(customizingProduct.weightPresets)) {
                        presets = customizingProduct.weightPresets;
                      } else if (typeof customizingProduct.weightPresets === 'string') {
                        try { presets = JSON.parse(customizingProduct.weightPresets); } catch {}
                      }
                    }
                    presets = presets.filter((p) => p >= minG && p <= maxG);
                    if (presets.length === 0) presets = [100, 200, 300, 500, 1000].filter((p) => p >= minG && p <= maxG);
                    const formatGrams = (grams: number) => (grams >= 1000 ? `${grams / 1000}kg` : `${grams}g`);

                    const validWeight = isValidWeightInput(weightInput, weightUnit, minG, maxG);
                    const updateWeight = (value: number) => {
                      setCustomizingWeight(value);
                      setWeightInput(String(weightUnit === 'kg' ? value / 1000 : value));
                    };
                    const changeUnit = (unit: 'g' | 'kg') => {
                      if (unit === weightUnit) return;
                      const grams = weightInputGrams(weightInput, weightUnit);
                      setWeightUnit(unit);
                      if (grams !== null) setWeightInput(String(unit === 'kg' ? grams / 1000 : grams));
                    };

                    return (
                      <div className="px-5 py-5 sm:p-6">
                        <div className="flex items-center justify-between gap-3">
                          <label htmlFor="custom-weight" className="text-base font-bold text-neutral-950 dark:text-white">Elige el peso</label>
                          {validWeight && <div className="flex items-baseline gap-1.5 rounded-full bg-neutral-950 dark:bg-white text-white dark:text-neutral-950 px-3.5 py-1 shadow-sm">
                            <span className="text-[13px] font-bold">≈ {formatGrams(customizingWeight)}</span>
                            <span className="h-3.5 w-px bg-white/20 dark:bg-black/20" />
                            <span className="text-[13px] font-black">{formatCurrency(weightEstimate)}</span>
                          </div>}
                        </div>

                        {presets.length > 0 && (
                          <div className="mb-5 mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label="Cantidades sugeridas">
                            {presets.map((p) => (
                              <button
                                key={p}
                                type="button"
                                onClick={() => updateWeight(p)}
                                aria-pressed={validWeight && customizingWeight === p}
                                className={`min-h-12 rounded-2xl border px-2 py-2 text-sm font-bold transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
                                  validWeight && customizingWeight === p
                                    ? 'border-red-500 bg-red-50 text-red-700 shadow-sm dark:border-red-500/60 dark:bg-red-500/15 dark:text-red-300'
                                    : 'border-neutral-200 bg-neutral-50 text-neutral-700 hover:bg-neutral-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700'
                                }`}
                              >
                                {formatGrams(p)}
                              </button>
                            ))}
                          </div>
                        )}

                        <div className="mb-2 flex items-center justify-between gap-3">
                          <span className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Cantidad personalizada</span>
                          <div role="group" aria-label="Unidad de peso" className="flex gap-1 rounded-xl border border-neutral-200 bg-neutral-100 p-1 dark:border-zinc-700 dark:bg-zinc-800">
                            {(['g', 'kg'] as const).map((unit) => (
                              <button key={unit} type="button" onClick={() => changeUnit(unit)} aria-pressed={weightUnit === unit} aria-label={unit === 'g' ? 'Gramos' : 'Kilogramos'} className={`min-h-11 min-w-12 rounded-lg px-3 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${weightUnit === unit ? 'bg-red-600 text-white shadow-sm dark:bg-red-500 dark:text-white' : 'text-neutral-600 hover:bg-white dark:text-zinc-300 dark:hover:bg-zinc-700'}`}>
                                {unit}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={customizingWeight <= minG}
                            onClick={() => updateWeight(Math.max(minG, customizingWeight - stepG))}
                            aria-label="Disminuir peso"
                            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border text-xl text-neutral-600 dark:text-neutral-200 transition ${
                              customizingWeight <= minG
                                ? 'border-black/5 opacity-30 cursor-not-allowed'
                                : 'border-black/5 hover:bg-neutral-50 dark:border-white/10 dark:hover:bg-zinc-800'
                            }`}
                          >
                            -
                          </button>
                          <div className="flex-1 relative">
                            <input
                              type="text"
                              id="custom-weight"
                              inputMode={weightUnit === 'kg' ? 'decimal' : 'numeric'}
                              value={weightInput}
                              onChange={(e) => {
                                const raw = e.target.value;
                                setWeightInput(raw);
                                const grams = weightInputGrams(raw, weightUnit);
                                if (grams !== null && grams >= minG && grams <= maxG) setCustomizingWeight(grams);
                              }}
                              aria-invalid={!validWeight}
                              aria-describedby="weight-help"
                              className="w-full rounded-xl border border-black/10 bg-neutral-50 py-3 pl-3 pr-16 text-center text-lg font-bold text-neutral-950 outline-none focus:border-red-500 focus:ring-4 focus:ring-red-500/10 dark:border-white/15 dark:bg-zinc-800 dark:text-neutral-100"
                            />
                            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-neutral-400">{weightUnit}</span>
                          </div>
                          <button
                            type="button"
                            disabled={customizingWeight >= maxG}
                            onClick={() => updateWeight(Math.min(maxG, customizingWeight + stepG))}
                            aria-label="Aumentar peso"
                            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border text-xl text-neutral-600 dark:text-neutral-200 transition ${
                              customizingWeight >= maxG
                                ? 'border-black/5 opacity-30 cursor-not-allowed'
                                : 'border-black/5 hover:bg-neutral-50 dark:border-white/10 dark:hover:bg-zinc-800'
                            }`}
                          >
                            +
                          </button>
                        </div>

                        <p id="weight-help" className={`mt-3 text-center text-xs font-medium ${validWeight ? 'text-neutral-500 dark:text-neutral-400' : 'text-rose-600 dark:text-rose-400'}`}>
                          {validWeight ? `Escribe la cantidad que prefieras · ${formatGrams(minG)} a ${formatGrams(maxG)}` : `Ingresa un peso entre ${formatGrams(minG)} y ${formatGrams(maxG)}${weightUnit === 'kg' ? ' (hasta 3 decimales)' : ' en gramos enteros'}`}
                        </p>
                      </div>
                    );
                  })()}

                  {/* Notas Especiales */}
                  <div className="px-5 py-5 sm:p-6">
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
              <div className="shrink-0 border-t border-black/5 dark:border-zinc-800 bg-white dark:bg-neutral-900 px-4 py-3 sm:px-6 flex flex-row items-center gap-2 sm:gap-3">
                {/* Selector de Cantidad */}
                <div className="flex shrink-0 items-center rounded-2xl border border-black/5 dark:border-zinc-800 bg-neutral-50 dark:bg-neutral-950 px-1 py-1 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setCustomizingQuantity(q => Math.max(1, q - 1))}
                    aria-label="Disminuir cantidad"
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
                    aria-label="Aumentar cantidad"
                    disabled={getProductAvailability(customizingProduct).tracked && customizingQuantity >= getProductAvailability(customizingProduct).maxQty}
                    className="flex h-9 w-9 items-center justify-center rounded-full text-lg text-neutral-700 dark:text-neutral-300 transition hover:bg-neutral-200 dark:hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    +
                  </button>
                </div>

                {/* Botón de Confirmación */}
                {(() => {
                  const isWeightProduct = customizingProduct.sellBy === 'WEIGHT';
                  const invalidWeight = isWeightProduct && !isValidWeightInput(weightInput, weightUnit, customizingProduct.minWeightG || 100, customizingProduct.maxWeightG || 5000);
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
                      disabled={isMissingRequired || invalidWeight}
                      onClick={addCustomizedItemToCart}
                      className="min-w-0 flex-1 rounded-2xl bg-red-700 text-white text-sm font-bold min-h-12 py-3 px-3 sm:px-4 shadow-sm transition duration-200 flex items-center justify-between gap-2 disabled:bg-neutral-200 disabled:text-neutral-600 dark:disabled:bg-neutral-800 dark:disabled:text-neutral-400 disabled:cursor-not-allowed active:scale-[0.98]"
                    >
                      <span>{invalidWeight ? 'Revisa el peso' : isMissingRequired ? 'Elige las opciones obligatorias' : 'Agregar al carrito'}</span>
                      {!isMissingRequired && !invalidWeight && (
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

        {/* Modal de límite de peso */}
        {weightLimitWarning && customizingProduct && (() => {
          const maxG = customizingProduct.maxWeightG || 5000;
          const unitPrice = customizingProduct.unitPrice || 0;
          const clampedWeight = Math.min(weightLimitPendingValue || 0, maxG);
          return (
            <div
              className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 backdrop-blur-sm px-4 py-6 animate-overlay-fade"
              role="dialog"
              aria-modal="true"
              onClick={() => setWeightLimitWarning(false)}
            >
              <div
                className="relative w-full max-w-sm overflow-hidden rounded-3xl bg-white dark:bg-neutral-900 shadow-2xl ring-1 ring-black/5 dark:ring-white/10 animate-modal-pop"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="p-6">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-6 w-6" />
                  </div>
                  <h3 className="text-center text-base font-bold text-neutral-950 dark:text-white">
                    Cantidad no disponible
                  </h3>
                  <p className="mt-2 text-center text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
                    Este producto se ofrece en cantidades de hasta{' '}
                    <span className="font-bold text-neutral-800 dark:text-neutral-200">{maxG >= 1000 ? `${maxG / 1000}kg` : `${maxG}g`}</span>{' '}
                    por pedido.
                    {clampedWeight > 0 && (
                      <>
                        {' '}Te pediste{' '}
                        <span className="font-bold text-neutral-800 dark:text-neutral-200">{weightLimitPendingValue >= 1000 ? `${weightLimitPendingValue / 1000}kg` : `${weightLimitPendingValue}g`}</span>
                        {' '}({formatCurrency((unitPrice * weightLimitPendingValue) / 1000)}).
                      </>
                    )}
                  </p>
                  <div className="mt-5 flex flex-col gap-2">
                    <button
                      type="button"
                      autoFocus
                      onClick={() => {
                         setCustomizingWeight(clampedWeight);
                         setWeightInput(String(weightUnit === 'kg' ? clampedWeight / 1000 : clampedWeight));
                        setWeightLimitWarning(false);
                      }}
                      className="w-full rounded-full bg-neutral-950 dark:bg-white px-5 py-3 text-sm font-bold text-white dark:text-neutral-950 transition active:scale-[0.98]"
                    >
                      Ajustar al máximo disponible
                    </button>
                    <button
                      type="button"
                      onClick={() => setWeightLimitWarning(false)}
                      className="w-full rounded-full px-5 py-3 text-sm font-semibold text-neutral-500 dark:text-neutral-400 transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    >
                      Elegir otra cantidad
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Modal de Calificación */}
        {isRatingModalOpen && (() => {
          const ratingOrder = orderToRate ? activeOrderDetailsMap[orderToRate] || null : null;
          const isPickupRating = ratingOrder ? (ratingOrder as any)?.fulfillmentType === 'PICKUP' : ratingIsPickup;
          return (
            <RatingModal
              open
              isPickup={isPickupRating}
              restaurantRating={restaurantRating}
              onRestaurantRatingChange={setRestaurantRating}
              comment={ratingComment}
              onCommentChange={setRatingComment}
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
                setRatingComment('');
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
                      comment: ratingComment.trim() || undefined,
                    },
                    getUser: () => sessionUser,
                    onTokenRefreshed: (newToken) => setToken(newToken),
                  });
                  if (result.ok) {
                    showTransientNotice({ key: 'rating-submitted', title: '¡Gracias!', description: 'Tu calificación nos ayuda a mejorar.', tone: 'success' });
                  } else {
                    showTransientNotice({ key: 'rating-error', title: 'Error', description: result.message || 'No se pudo guardar tu calificación.', tone: 'danger' });
                    return;
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
                  setRatingComment('');
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
            <div className="relative w-full max-w-[460px] overflow-hidden rounded-[28px] border border-black/5 bg-white p-6 shadow-[0_32px_110px_rgba(15,15,15,0.35)] dark:border-white/10 dark:bg-neutral-900">
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-rose-100 bg-rose-50 text-rose-600">
                  <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <path d="m15 9-6 6m0-6 6 6" />
                  </svg>
                </div>
                <h3 id="cancelled-order-title" className="text-xl font-bold tracking-tight text-neutral-950 dark:text-neutral-50">
                  Pedido cancelado
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-neutral-500">
                  {cancelledOrderNotice.restaurant?.name || 'El restaurante'} canceló tu pedido{' '}
                  <strong className="text-neutral-800">{cancelledOrderNotice.orderReference}</strong>.
                </p>

                {cancelledOrderNotice.cancellationReason && (
                  <div className="mt-4 rounded-2xl border border-amber-100/70 bg-amber-50/80 p-4 text-left dark:border-amber-500/30 dark:bg-amber-500/10">
                    <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-amber-600">Motivo de la cancelación</p>
                    <p className="text-sm font-semibold leading-relaxed text-amber-900 dark:text-amber-200">
                      {cancelledOrderNotice.cancellationReason}
                    </p>
                  </div>
                )}

                {(cancelledOrderNotice.paymentMethod === 'TRANSFER' || cancelledOrderNotice.paymentMethod === 'CREDIT_CARD') && (
                  <p className="mt-4 text-xs leading-relaxed text-neutral-500">
                    {cancelledOrderNotice.paymentMethod === 'CREDIT_CARD'
                      ? 'El reembolso total de tu pago con tarjeta se procesa automáticamente.'
                      : 'Si realizaste una transferencia, el reembolso se gestionará automáticamente.'}
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
              className="bg-white dark:bg-neutral-900 rounded-3xl border border-black/[0.03] dark:border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.15)] p-7 w-full max-w-md h-fit max-h-[90vh] overflow-y-auto relative transition-all"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-center mb-6">
                <div className="w-20 h-20 bg-emerald-200 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-emerald-100 shadow-inner">
                  <span className="text-4xl"><svg className="h-10 w-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" /></svg></span>
                </div>
                <h3 className="text-2xl font-black text-neutral-950 dark:text-neutral-50 tracking-tight">¡Tu pedido está listo!</h3>
                <p className="text-sm text-neutral-500 mt-1">Pasa por tu pedido a {pickupReadyOrder.restaurant.name}.</p>
                {pickupReadyOrder.dailyCounter && (
                  <p className="text-xs font-bold text-neutral-400 mt-2">
                    Pedido #{String(pickupReadyOrder.dailyCounter).padStart(3, '0')}
                  </p>
                )}
              </div>

              <div className="space-y-4">
                {/* Total a pagar */}
                <div className="p-5 rounded-2xl bg-emerald-50/40 border border-emerald-100/50 dark:bg-emerald-500/10 dark:border-emerald-500/30">
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
                        {pickupReadyOrder.paymentMethod === 'CASH' ? <><svg className="h-3.5 w-3.5 inline-block align-text-bottom" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> Efectivo</> : pickupReadyOrder.paymentMethod === 'TRANSFER' ? <><svg className="h-3.5 w-3.5 inline-block align-text-bottom" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" /></svg> Transferencia</> : 'Tarjeta'}
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
                    className="w-full flex items-center justify-center gap-2.5 rounded-full border-2 border-sky-200 bg-sky-50 py-3.5 text-sm font-bold text-sky-600 shadow-sm transition hover:bg-sky-100 hover:shadow-md active:scale-[0.97] dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300 dark:hover:bg-sky-500/20"
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
        restaurantId={cartRestaurantId}
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
        deliveryFeePending={!restaurant || (restaurant.pricingModel === 'distance' && distanceKm === null && !(restaurant.promoFreeDeliveryThreshold && cartSubtotal - discountAmount >= restaurant.promoFreeDeliveryThreshold))}
        pickupOnly={restaurant?.pickupOnly === true}
        freeDeliveryThreshold={restaurant?.promoFreeDeliveryThreshold ?? null}
      />

      <div ref={checkoutLayerRef} aria-hidden={!isCheckoutOpen} inert={!isCheckoutOpen} className={`wl-checkout-layer fixed inset-0 z-50 transition-opacity duration-300 ${isCheckoutOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={closeCheckout} />
        <div
          ref={checkoutRef}
          className={`wl-checkout absolute right-0 top-0 flex h-full w-full max-w-[580px] flex-col overflow-hidden bg-white dark:bg-[#0c0c0e] shadow-[0_0_0_1px_rgba(0,0,0,0.04),0_40px_100px_rgba(15,15,15,0.25)] sm:rounded-l-[36px] transition-[transform,opacity] duration-[350ms] ease-[cubic-bezier(0.16,1,0.3,1)] lg:bottom-auto lg:right-auto lg:left-1/2 lg:top-1/2 lg:h-auto lg:max-h-[92vh] lg:w-full lg:max-w-4xl lg:rounded-[32px] ${isCheckoutOpen ? 'translate-x-0 opacity-100 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:scale-100' : 'translate-x-full opacity-100 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:scale-95 lg:opacity-0'}`}
        >
            <section className="flex min-h-0 flex-1 flex-col lg:max-h-[92dvh]">
              {/* ── Header ── */}
              <div className="wl-checkout-heading sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-black/[0.04] dark:border-white/10 bg-white dark:bg-neutral-950 px-5 py-4 sm:px-6">
                <div className="flex min-w-0 items-center gap-3.5">
                  <div className="relative flex h-12 w-12 items-center justify-center rounded-[18px] bg-gradient-to-br from-[var(--accent)] to-[var(--accent-strong)] text-white shadow-lg shadow-accent/25">
                    <ClipboardCheck className="h-5 w-5" strokeWidth={1.8} />
                    {totalProducts > 0 && isCheckoutOpen && (
                      <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-neutral-900 px-1 text-[10px] font-bold text-white shadow-md">
                        {totalProducts}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-neutral-400">Finalizar</p>
                    <div className="wl-checkout-title-line">
                      <h2 className="text-lg font-bold tracking-[-0.03em] text-neutral-950 dark:text-neutral-50">Confirmar pedido</h2>
                      {isPickupOnly ? (
                        <span className="wl-checkout-fulfillment wl-checkout-fulfillment--pickup">
                          <ShoppingBag aria-hidden="true" /> Solo recoger
                        </span>
                      ) : fulfillmentType === 'PICKUP' ? (
                        <span className="wl-checkout-fulfillment wl-checkout-fulfillment--pickup">
                          <Store aria-hidden="true" /> Recoger en tienda
                        </span>
                      ) : (
                        <span className="wl-checkout-fulfillment wl-checkout-fulfillment--delivery">
                          <Bike aria-hidden="true" /> Envío a domicilio
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeCheckout}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 transition-colors hover:bg-neutral-200 hover:text-neutral-700 active:scale-90 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
                  aria-label="Cerrar confirmación del pedido"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="wl-checkout-content min-h-0 flex-1 overflow-y-auto [overflow-anchor:none] px-4 pb-8 pt-5 sm:px-5 lg:px-6">
                {/* Desktop: formulario (izq.) + pago (der.). Móvil: columna única. */}
                <div className="space-y-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-5 lg:space-y-0 xl:gap-6">
                  <div className="space-y-4">

                  {fulfillmentType === 'PICKUP' ? (
                    <div className="rounded-[22px] border border-black/[0.04] bg-white dark:bg-neutral-900 p-3 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                      <div className="mb-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-red-50 dark:bg-red-900/40">
                            <Store className="h-3 w-3 text-[var(--accent)]" strokeWidth={1.5} />
                          </div>
                          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-neutral-400">
                            Recoger en
                          </p>
                        </div>
                        <span className="rounded-full bg-red-50 dark:bg-red-900/40 px-2 py-0.5 text-[9px] font-bold text-[var(--accent)]">
                          Paso 1
                        </span>
                      </div>
                      <div className="overflow-hidden rounded-2xl border border-black/[0.04] dark:border-white/10 bg-gradient-to-br from-white to-neutral-50/80 dark:from-neutral-900 dark:to-zinc-900 shadow-sm">
                        <div className="p-4 pb-0">
                          <div className="flex items-start gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--accent)] to-[var(--accent-strong)] shadow-sm shadow-[0_2px_8px_var(--accent-soft)]">
                              <Store className="h-5 w-5 text-white" strokeWidth={1.5} />
                            </div>
                            <div className="min-w-0 flex-1 pt-0.5">
                              <p className="text-[14px] font-bold leading-tight text-neutral-900 dark:text-neutral-100">
                                {restaurant?.name || 'Restaurante'}
                              </p>
                              {restaurant?.address && (
                                <p className="mt-0.5 text-[12px] leading-relaxed text-neutral-500 dark:text-zinc-400 line-clamp-1">
                                  {restaurant.address}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="px-4 pb-4">
                          <div className="mt-2 flex items-center gap-2 rounded-xl bg-amber-50/80 dark:bg-amber-500/10 px-3 py-2.5">
                            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-500/20">
                              <Clock className="h-3 w-3 text-amber-700 dark:text-amber-400" strokeWidth={1.5} />
                            </div>
                            <p className="text-[11px] font-medium leading-snug text-amber-700 dark:text-amber-400">
                              Te avisaremos cuando esté listo
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                  /* ── PASO 1 (DELIVERY): DIRECCIÓN DE ENTREGA ── */
                  <div className="rounded-[22px] border border-black/[0.04] bg-white dark:bg-neutral-900 p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                    <div className="mb-4 flex items-center justify-between border-b border-black/[0.05] dark:border-white/10 pb-3">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent)] text-[11px] font-black text-white">1</span>
                        <div>
                          <h3 className="text-[13px] font-bold tracking-tight text-neutral-900 dark:text-neutral-100">Dirección de entrega</h3>
                          <p className="text-[11px] font-medium text-neutral-500 dark:text-zinc-400">¿A dónde enviamos tu pedido?</p>
                        </div>
                      </div>
                    </div>

                    {/* Modo: Mostrando Direcciones Guardadas */}
                    {addresses.length > 0 && !isAddingNewAddress && (
                      <div className="space-y-3">
                        {addresses.length > 1 && (
                          <p className="text-[12px] font-medium leading-relaxed text-neutral-500 dark:text-zinc-400">
                            Selecciona la dirección donde quieres recibir este pedido.
                          </p>
                        )}
                        <div className="grid gap-2.5" role="group" aria-label="Direcciones guardadas">
                          {addresses.map((addr) => {
                            const isSelected = selectedAddressId === addr.id;
                            const addressLine = [addr.neighborhood, addr.city, addr.state, addr.zipCode]
                              .filter(Boolean)
                              .join(', ');
                            return (
                              <button
                                key={addr.id}
                                type="button"
                                aria-pressed={isSelected}
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
                                className={`relative flex w-full min-w-0 flex-col rounded-2xl border-2 p-3.5 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-900 ${
                                  isSelected
                                    ? 'border-[var(--accent)] bg-[var(--menu-accent-soft)] shadow-[0_0_0_2px_var(--accent-soft-strong),0_8px_22px_rgba(15,23,42,0.08)]'
                                    : 'border-black/[0.08] bg-white hover:border-black/20 hover:bg-neutral-50 dark:border-white/15 dark:bg-zinc-800 dark:hover:border-white/25 dark:hover:bg-zinc-800/80'
                                }`}
                              >
                                <div className="flex w-full items-center justify-between gap-3">
                                  <span className="flex min-w-0 items-center gap-1.5 text-[12px] font-semibold text-neutral-600 dark:text-zinc-300">
                                    {addr.isDefault
                                      ? <><Home className="h-4 w-4 shrink-0 text-neutral-400" strokeWidth={1.8} /><span>Casa</span><span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-500 dark:bg-white/10 dark:text-zinc-300">Principal</span></>
                                      : <><MapPin className="h-4 w-4 shrink-0 text-neutral-400" strokeWidth={1.8} /><span>Dirección</span></>}
                                  </span>
                                  {isSelected ? (
                                    <span className="inline-flex min-h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-[var(--accent)] px-2.5 text-[11px] font-bold text-white shadow-sm">
                                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                                      Se entregará aquí
                                    </span>
                                  ) : (
                                    <span aria-hidden="true" className="h-5 w-5 shrink-0 rounded-full border-2 border-neutral-300 bg-white dark:border-zinc-500 dark:bg-zinc-800" />
                                  )}
                                </div>
                                <p className="mt-2.5 w-full text-[15px] font-bold leading-snug text-neutral-950 dark:text-white">
                                  {addr.street} {addr.number}
                                </p>
                                <p className="mt-1 w-full text-[12px] leading-relaxed text-neutral-500 dark:text-zinc-400">
                                  {addressLine || 'Agrega los detalles de esta dirección'}
                                </p>
                              </button>
                            );
                          })}

                          {/* Acción para agregar otro domicilio */}
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
                            className="flex min-h-[58px] w-full items-center gap-3 rounded-2xl border border-dashed border-[var(--accent-soft-strong)] bg-[var(--accent-soft)] px-4 py-3 text-left transition-colors hover:bg-[var(--accent-soft-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-900"
                          >
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-[var(--accent-strong)] shadow-sm ring-1 ring-black/[0.04] dark:bg-neutral-800 dark:ring-white/10">
                              <Plus className="h-4 w-4" strokeWidth={2.2} />
                            </span>
                            <span className="min-w-0">
                              <span className="block text-[13px] font-bold text-[var(--accent-strong)]">Agregar otra dirección</span>
                              <span className="mt-0.5 block text-[11px] text-neutral-500 dark:text-zinc-400">Para recibir este pedido en otro domicilio</span>
                            </span>
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
                          className="w-full rounded-2xl border border-[var(--accent)] bg-red-50 px-4 py-4 text-sm font-bold text-[var(--accent-strong)] transition-all active-scale hover:bg-[var(--accent-soft-strong)]/50 shadow-sm flex items-center justify-center gap-2 dark:bg-red-500/15 dark:text-red-200"
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
                            : 'border-red-200 bg-red-50/60 text-[var(--accent)] hover:bg-[var(--accent-soft-strong)] dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300'
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
                                  className="w-full rounded-2xl border border-black/10 dark:border-white/15 bg-white dark:bg-zinc-800 p-3.5 text-sm dark:text-neutral-100 focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-red-300/20 pr-10 shadow-sm transition-all placeholder:text-neutral-400 dark:placeholder:text-zinc-500"
                                />
                                {isSearchingAddress ? (
                                  <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
                                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-200 border-t-red-500" />
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
                                <div className="absolute z-[999] mt-2 w-full rounded-2xl border border-black/5 dark:border-white/15 bg-white dark:bg-neutral-900 shadow-xl overflow-hidden transition-all duration-200">
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
                                      className="w-full px-4 py-3.5 text-left text-sm hover:bg-red-50/40 dark:hover:bg-neutral-800/60 border-b border-black/5 dark:border-white/10 last:border-b-0 transition-colors flex flex-col gap-0.5 dark:text-neutral-200"
                                    >
                                      <div className="flex items-center gap-2">
                                        <span className="text-[var(--accent)]"><MapPin className="h-3.5 w-3.5" strokeWidth={1.5} /></span>
                                        <p className="font-semibold text-neutral-900 dark:text-neutral-100 line-clamp-1">{suggestion.name}</p>
                                      </div>
                                      <p className="text-xs text-neutral-500 dark:text-zinc-400 truncate pl-6">{suggestion.description}</p>
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
                                  className="flex w-full items-center justify-center gap-2 rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-xs font-bold text-neutral-600 transition-all hover:border-neutral-300 hover:text-neutral-900 active:scale-[0.98] shadow-sm dark:border-white/15 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:border-white/25 dark:hover:text-zinc-50"
                                >
                                  <ArrowLeft className="h-4 w-4 shrink-0" strokeWidth={2} />
                                  Ver direcciones guardadas ({addresses.length})
                                </button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-4">
                            <div className="rounded-2xl border border-neutral-100 dark:border-white/10 bg-neutral-50 dark:bg-zinc-800/70 p-3.5 flex items-start justify-between gap-3 shadow-sm">
                              <div className="flex-1 min-w-0">
                                <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">Dirección base</p>
                                <p className="text-sm font-bold text-neutral-900 dark:text-neutral-100 truncate mt-0.5">{checkoutForm.street} {checkoutForm.number}</p>
                                <p className="text-xs text-neutral-500 dark:text-zinc-400 truncate mt-0.5">{checkoutForm.neighborhood || 'Sin colonia'}, {checkoutForm.city || 'Sin ciudad'}</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setNewAddressStep('search');
                                  setAddressSearchQuery('');
                                  setAddressSuggestions([]);
                                }}
                                className="rounded-xl border border-red-100 dark:border-white/15 bg-white dark:bg-zinc-800 px-3 py-1.5 text-xs font-bold text-[var(--accent)] transition hover:bg-red-50 dark:hover:bg-zinc-700 shadow-sm shrink-0"
                              >
                                Cambiar
                              </button>
                            </div>

                            <div className="flex items-center gap-2.5 rounded-2xl bg-red-50/50 dark:bg-red-500/10 px-4 py-3 text-xs text-[var(--accent-strong)] dark:text-red-200 border border-red-100 dark:border-red-500/30 shadow-sm">
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
                                className="rounded-xl border border-black/10 bg-white px-4 py-2.5 text-xs font-bold text-neutral-600 transition hover:bg-neutral-50 shadow-sm dark:border-white/15 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
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

                    {/* Google Map (aparece al seleccionar dirección o al agregar una nueva).
                        El div #map-checkout lo gestiona Google Maps en exclusiva: React no
                        debe reconciliar hijos dentro de él (provoca NotFoundError al
                        ocultar). El botón flotante vive como hermano, no como hijo. */}
                    <div className="relative mt-4">
                      <div
                        id="map-checkout"
                        className={`relative h-48 w-full rounded-2xl border border-black/5 overflow-hidden shadow-inner no-invert transition-opacity duration-300 ${checkoutMapUnavailable ? 'hidden' : (showMapForAddress || (isAddingNewAddress && newAddressStep !== 'search')) ? '' : 'hidden'}`}
                      />
                      {checkoutMapUnavailable && (showMapForAddress || (isAddingNewAddress && newAddressStep !== 'search')) && (
                        <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-black/10 bg-neutral-50 px-5 text-center dark:border-white/10 dark:bg-zinc-900">
                          <MapPin className="h-6 w-6 text-[var(--accent-strong)]" aria-hidden="true" />
                          <p className="text-[13px] font-bold text-neutral-800 dark:text-neutral-100">Mapa no disponible</p>
                          <p className="text-[11px] leading-snug text-neutral-500 dark:text-zinc-400">
                            {[checkoutForm.street, checkoutForm.number, checkoutForm.neighborhood, checkoutForm.city].filter(Boolean).join(', ') || 'Tu ubicación'}
                          </p>
                          <a
                            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${checkoutForm.street} ${checkoutForm.number}, ${checkoutForm.neighborhood}, ${checkoutForm.city}, ${checkoutForm.state}`.trim() || `${checkoutForm.latitude},${checkoutForm.longitude}`)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-3.5 py-2 text-[11px] font-bold text-white shadow-sm"
                          >
                            <Map className="h-3.5 w-3.5" aria-hidden="true" /> Abrir en Google Maps
                          </a>
                        </div>
                      )}
                      {showMapForAddress && !isAddingNewAddress && (
                        <button
                          type="button"
                          onClick={() => setShowMapForAddress(null)}
                          className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-full bg-white/95 px-3 py-1 text-[10px] font-bold text-neutral-600 shadow-md backdrop-blur transition-all hover:bg-white active:scale-95 dark:bg-zinc-800/95 dark:text-zinc-300 dark:hover:bg-zinc-700"
                        >
                          <X className="h-3 w-3" strokeWidth={2.5} /> Ocultar mapa
                        </button>
                      )}
                    </div>
                  </div>
                  )}

                  {/* ── PASO 2: INSTRUCCIONES (colapsable, opcional) ── */}
                  <div className="rounded-[22px] border border-red-200/80 bg-white p-4 shadow-sm dark:border-red-900/60 dark:bg-neutral-900">
                    <button
                      type="button"
                      onClick={() => setShowInstructions((v) => !v)}
                      aria-expanded={showInstructions}
                      aria-controls="checkout-instructions"
                      className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl text-left transition-colors active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-red-600"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50 text-sm font-black text-red-700 dark:bg-red-950/50 dark:text-red-300">2</span>
                        <div>
                          <h3 className="text-sm font-bold tracking-tight text-neutral-900 dark:text-neutral-100">Instrucciones</h3>
                          <p className="text-[11px] font-medium text-neutral-500 dark:text-zinc-400">Opcional · para la tienda o el repartidor</p>
                        </div>
                      </div>
                      <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-red-700 dark:text-red-300">{showInstructions ? 'Cerrar' : 'Agregar'}<ChevronUp aria-hidden="true" className={`h-4 w-4 transition-transform duration-200 ${showInstructions ? '' : 'rotate-180'}`} strokeWidth={2.5} /></span>
                    </button>
                    {showInstructions && (
                    <div id="checkout-instructions" className="mt-4 space-y-3.5">
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

                  {loyaltyQuoteFailed && loyaltyQuote?.source === loyaltyKey && <p role="status" className="wl-checkout-loyalty-error">No se pudo consultar tu recompensa. Puedes continuar sin usarla.</p>}
                  {loyaltyAvailable && loyaltyQuote && (
                    <section className="wl-checkout-loyalty" aria-label="Tarjeta de fidelidad">
                      <h3>Tarjeta de fidelidad</h3>
                      <p>¡Tienes una recompensa disponible!</p>
                      <label><input type="checkbox" checked={useLoyalty} onChange={event => setUseLoyalty(event.target.checked)} /><span><strong>{loyaltyQuote.rewardDescription || 'Aplicar recompensa'}</strong><small>{loyaltyQuote.gift ? `${loyaltyQuote.gift.name} se agregará sin costo.` : `Descuento de ${formatCurrency((loyaltyQuote.discountCents || 0) / 100)} en esta compra.`}</small></span></label>
                      <p>Se reserva al confirmar y vuelve a estar disponible si el pedido se cancela. No se combina con promociones.</p>
                    </section>
                  )}
                  {/* ── PASO 2.5: CUPÓN (opcional, colapsable) ── */}
                  <div className="rounded-[22px] border border-red-200/80 bg-white p-4 shadow-sm dark:border-red-900/60 dark:bg-neutral-900">
                    <button
                      type="button"
                      onClick={() => setIsCouponOpen((v) => !v)}
                      aria-expanded={isCouponOpen}
                      aria-controls="checkout-coupon"
                      className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl text-left transition-colors active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-red-600"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300">
                          <Ticket className="h-4 w-4" strokeWidth={1.8} />
                        </span>
                        <div>
                          <h3 className="text-sm font-bold tracking-tight text-neutral-900 dark:text-neutral-100">Cupón de descuento</h3>
                          <p className="text-[11px] font-medium text-neutral-500 dark:text-zinc-400">¿Tienes un código? Aplícalo aquí</p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {promoCodeState === 'valid' && promoCodeInfo && !isCouponOpen && (
                          <span className="text-[11px] font-black text-emerald-600">-{formatCurrency(promoCodeInfo.discount)}</span>
                        )}
                        <span className="flex items-center gap-1 text-xs font-bold text-red-700 dark:text-red-300">{isCouponOpen ? 'Cerrar' : promoCodeState === 'valid' ? 'Ver' : 'Agregar'}<ChevronUp aria-hidden="true" className={`h-4 w-4 transition-transform duration-200 ${isCouponOpen ? '' : 'rotate-180'}`} strokeWidth={2.5} /></span>
                      </div>
                    </button>

                    {isCouponOpen && (
                    <div id="checkout-coupon" className="mt-4">
                    {promoCodeState === 'valid' && promoCodeInfo ? (
                      <div className="space-y-3.5">
                        <div className="overflow-hidden rounded-2xl border border-red-200/70 bg-gradient-to-br from-red-50/90 via-white to-red-50/60">
                          <div className="flex items-start gap-3 border-b border-red-100/80 px-4 py-3.5">
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
                                {promoCodeInfo.type === 'FREE_PRODUCT' && `${promoCodeInfo.gift?.name || 'Producto gratis'} de regalo en este pedido`}
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
                    </div>
                    )}
                  </div>
                  </div>

                  {/* ── Columna derecha (desktop): PAGO Y DETALLES ── */}
                  <div className="space-y-4">
                  {/* ── PASO 3: PAGO Y DETALLES ── */}
                  <div className="rounded-[24px] border border-black/[0.06] bg-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.04)] dark:border-white/10 dark:bg-neutral-900 sm:p-5">
                    <div className="mb-4 flex items-center justify-between border-b border-black/[0.05] pb-4 dark:border-white/10">
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-black text-white">3</span>
                        <div>
                          <h3 className="text-sm font-bold tracking-tight text-neutral-900 dark:text-neutral-100">Método de pago</h3>
                          <p className="mt-0.5 text-xs text-neutral-500 dark:text-zinc-400">Elige cómo quieres pagar</p>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      {/* Selector de Método de Pago */}
                      <div>
                        {(() => {
                          const accepted = getAcceptedPaymentMethods(restaurant);
                          const showCash = accepted.includes('CASH');
                          const showCard = cardEnabled && accepted.includes('CREDIT_CARD');
                          if (!showCash && !showCard) return null;
                          return (
                            <div role="group" aria-label="Método de pago" className="flex gap-1 rounded-2xl border border-neutral-200/80 bg-neutral-100 p-1 dark:border-white/10 dark:bg-zinc-800">
                              {showCash && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    cardCheckoutRequestRef.current += 1;
                                    setCheckoutForm((current) => ({ ...current, paymentMethod: 'CASH' }));
                                  }}
                                  aria-pressed={checkoutForm.paymentMethod === 'CASH'}
                                  className={`flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-900 ${
                                    checkoutForm.paymentMethod === 'CASH'
                                      ? 'bg-[var(--accent)] text-white shadow-sm'
                                      : 'text-neutral-600 hover:bg-white/60 dark:text-zinc-300 dark:hover:bg-white/5'
                                  }`}
                                >
                                  <DollarSign className="h-4 w-4" strokeWidth={1.5} />
                                  Efectivo
                                </button>
                              )}
                              {showCard && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    cardCheckoutRequestRef.current += 1;
                                    setCheckoutForm((current) => ({ ...current, paymentMethod: 'CREDIT_CARD' }));
                                  }}
                                  aria-pressed={checkoutForm.paymentMethod === 'CREDIT_CARD'}
                                  className={`flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-900 ${
                                    checkoutForm.paymentMethod === 'CREDIT_CARD'
                                      ? 'bg-[var(--accent)] text-white shadow-sm'
                                      : 'text-neutral-600 hover:bg-white/60 dark:text-zinc-300 dark:hover:bg-white/5'
                                  }`}
                                >
                                  <CreditCard className="h-4 w-4" strokeWidth={1.5} />
                                  Tarjeta
                                </button>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                      {checkoutForm.paymentMethod === 'CREDIT_CARD' && cardEnabled && token && (
                        <div className="space-y-3">
                          <SavedCardSelector apiBase={apiBase} token={token} selectedId={selectedSavedCard?.id ?? null}
                            onSelect={handleSavedCardSelect} onLoadingChange={setSavedCardsLoading} />
                          <p className="flex items-start gap-2 px-1 text-[11px] leading-relaxed text-neutral-500 dark:text-zinc-400">
                            <CreditCard className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            {selectedSavedCard
                              ? 'Confirma tu tarjeta con el código de seguridad.'
                              : 'Datos protegidos por Mercado Pago.'}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>





                  {/* Redundant login card transformed into a premium callout */}
                  {checkoutValidationMessage && !token && (
                    <div className="rounded-2xl border border-red-100 dark:border-red-500/30 bg-red-50/60 dark:bg-red-500/10 p-5 text-center shadow-sm animate-in fade-in duration-300">
                      <p className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                        ¿Listo para confirmar tu pedido?
                      </p>
                      <p className="text-xs text-neutral-500 dark:text-zinc-400 mt-1.5 leading-relaxed">
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

                <div className="sticky bottom-0 z-10 border-t border-black/[0.04] dark:border-white/10 bg-white/95 dark:bg-neutral-950/95 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-xl sm:px-5 shadow-[0_-12px_30px_-8px_rgba(0,0,0,0.08)]">
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
                  {error && token && (
                    <div className="mb-3.5 flex justify-center animate-in slide-in-from-bottom-2 fade-in duration-300">
                      <div className="flex items-center gap-2 rounded-2xl border border-rose-200/60 bg-rose-50/80 px-3.5 py-2 text-[12px] font-medium text-rose-600 shadow-sm backdrop-blur-md">
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-rose-500/20"><AlertTriangle className="h-3 w-3 text-rose-500" strokeWidth={1.5} /></span>
                        <span className="text-left">{error}</span>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        closeCheckout();
                        setIsCartOpen(true);
                      }}
                      className="group flex items-center justify-center gap-1.5 rounded-2xl bg-neutral-100/80 px-4 py-3.5 text-sm font-semibold text-neutral-600 transition-all hover:bg-neutral-200/80 active:scale-[0.97] active-scale shrink-0 dark:bg-zinc-800/80 dark:text-zinc-300 dark:hover:bg-zinc-700/80"
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
                          if (creatingOrder || (checkoutForm.paymentMethod === 'CREDIT_CARD' && savedCardsLoading)) return;
                          if (checkoutValidationMessage) {
                            setError(checkoutValidationMessage);
                            return;
                          }
                          // Con tarjeta no pasamos por /pedidos: abrimos el
                          // checkout de Mercado Pago, que hace de confirmación.
                          if (checkoutForm.paymentMethod === 'CREDIT_CARD') {
                            void startCardCheckout();
                            return;
                          }
                          // El modal de confirmación (cuenta regresiva) NO depende del
                          // permiso de notificaciones: debe aparecer SIEMPRE al confirmar,
                          // igual en web, PWA y app nativa.
                          openPreConfirm();
                        }}
                        disabled={creatingOrder || (checkoutForm.paymentMethod === 'CREDIT_CARD' && savedCardsLoading)}
                        aria-disabled={creatingOrder || Boolean(checkoutValidationMessage) || (checkoutForm.paymentMethod === 'CREDIT_CARD' && savedCardsLoading)}
                        className={`group relative flex-1 overflow-hidden rounded-2xl px-5 py-3.5 text-[15px] font-bold text-white transition-all active:scale-[0.97] active-scale ${
                          (checkoutValidationMessage && !creatingOrder) || (checkoutForm.paymentMethod === 'CREDIT_CARD' && savedCardsLoading)
                            ? 'bg-neutral-400 shadow-none'
                            : 'bg-[var(--accent)] shadow-[0_8px_20px_-6px_rgba(14,165,233,0.4)] hover:bg-[var(--accent-strong)] hover:shadow-[0_12px_24px_-8px_rgba(14,165,233,0.5)]'
                        }`}
                      >
                        <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-1000 group-hover:translate-x-full disabled:hidden" />
                        <span className="relative flex items-center justify-center gap-2">
                          {creatingOrder
                            ? 'Procesando...'
                             : checkoutForm.paymentMethod === 'CREDIT_CARD'
                               ? savedCardsLoading ? 'Cargando tarjetas…' : `Continuar con tarjeta • ${formatCurrency(orderTotal)}`
                              : `Confirmar • ${formatCurrency(orderTotal)}`}
                          {!creatingOrder && !(checkoutForm.paymentMethod === 'CREDIT_CARD' && savedCardsLoading) && (
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

      {/* Pre-confirm Order Modal (estilo SaDeL) */}
      {isPreConfirmOpen && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center">
          <button
            type="button"
            aria-label="Volver a revisar el pedido"
            className="absolute inset-0 bg-neutral-950/55 backdrop-blur-sm"
            onClick={clearPreConfirm}
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="pre-confirm-title"
            aria-describedby="pre-confirm-description"
            tabIndex={-1}
            className="relative flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] border border-black/[0.06] bg-white shadow-[0_-24px_80px_rgba(15,15,15,0.28)] dark:border-white/10 dark:bg-neutral-950 sm:max-h-[min(88dvh,760px)] sm:rounded-[28px] animate-in slide-in-from-bottom-4 fade-in duration-300"
          >
            <div className="flex shrink-0 items-start gap-3.5 border-b border-black/[0.06] px-5 pb-4 pt-5 dark:border-white/10 sm:px-6">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent-strong)] ring-1 ring-[var(--accent-soft-strong)]">
                <ShoppingBag className="h-5 w-5" strokeWidth={1.9} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--accent-strong)]">Último paso</p>
                <h2 id="pre-confirm-title" className="mt-0.5 text-lg font-extrabold tracking-tight text-neutral-950 dark:text-neutral-50">Confirma tu pedido</h2>
                <p id="pre-confirm-description" className="mt-1 text-[12px] leading-relaxed text-neutral-500 dark:text-zinc-400">
                  Revisa los productos, la entrega y el total antes de enviarlo.
                </p>
              </div>
              <button
                type="button"
                onClick={clearPreConfirm}
                aria-label="Volver a revisar el pedido"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 transition hover:bg-neutral-200 hover:text-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              >
                <X className="h-4 w-4" strokeWidth={2.2} />
              </button>
            </div>

            <div className="shrink-0 px-4 pt-4 sm:px-6">
              <div className="flex items-center gap-3.5 rounded-2xl border border-[var(--accent-soft-strong)] bg-[var(--accent-soft)] px-3.5 py-3 dark:bg-red-500/10">
                <div className="relative h-14 w-14 shrink-0" aria-hidden="true">
                  <svg className="h-14 w-14 -rotate-90 text-black/10 dark:text-white/15" viewBox="0 0 56 56">
                    <circle cx="28" cy="28" r="24" fill="none" stroke="currentColor" strokeWidth="4" />
                    <circle
                      cx="28" cy="28" r="24" fill="none"
                      stroke="var(--accent)" strokeWidth="4" strokeLinecap="round"
                      strokeDasharray={`${2 * Math.PI * 24}`}
                      strokeDashoffset={`${2 * Math.PI * 24 * (1 - preConfirmCountdown / 4)}`}
                      className="transition-[stroke-dashoffset] duration-1000 ease-linear"
                    />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-[23px] font-extrabold tabular-nums text-neutral-950 dark:text-white">
                    {preConfirmCountdown}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--accent-strong)]">
                    {preConfirmCountdown > 0 ? 'Envío automático en' : 'Preparando el envío'}
                  </p>
                  <p aria-live="polite" aria-atomic="true" className="mt-0.5 text-[15px] font-bold leading-snug text-neutral-950 dark:text-neutral-50">
                    {preConfirmCountdown > 0
                      ? `${preConfirmCountdown} ${preConfirmCountdown === 1 ? 'segundo' : 'segundos'}`
                      : 'Tu pedido se está enviando'}
                  </p>
                  <p className="mt-1 text-[11px] leading-snug text-neutral-600 dark:text-zinc-400">
                    También puedes enviarlo ahora o volver a revisar.
                  </p>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
              <section className="rounded-2xl border border-black/[0.07] bg-white p-3.5 dark:border-white/10 dark:bg-zinc-900">
                <div className="flex items-start gap-3">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${fulfillmentType === 'PICKUP' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-[var(--accent-soft)] text-[var(--accent-strong)]'}`}>
                    {fulfillmentType === 'PICKUP'
                      ? <Store className="h-[18px] w-[18px]" strokeWidth={1.9} />
                      : <MapPin className="h-[18px] w-[18px]" strokeWidth={1.9} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-500 dark:text-zinc-400">
                      {fulfillmentType === 'PICKUP' ? 'Recoger en tienda' : 'Dirección de entrega'}
                    </p>
                    <p className="mt-1 text-[14px] font-bold leading-snug text-neutral-950 dark:text-neutral-50">
                      {fulfillmentType === 'PICKUP' ? restaurant?.name : `${checkoutForm.street} ${checkoutForm.number}`.trim() || 'Sin dirección'}
                    </p>
                    {fulfillmentType === 'PICKUP' ? (
                      restaurant?.address && <p className="mt-0.5 text-[12px] leading-relaxed text-neutral-600 dark:text-zinc-400">{restaurant.address}</p>
                    ) : (
                      <>
                        <p className="mt-0.5 text-[12px] leading-relaxed text-neutral-600 dark:text-zinc-400">
                          {[checkoutForm.neighborhood, checkoutForm.city, checkoutForm.state, checkoutForm.zipCode].filter(Boolean).join(', ')}
                        </p>
                        {checkoutForm.reference?.trim() && (
                          <p className="mt-1 text-[11px] leading-relaxed text-neutral-500 dark:text-zinc-400">
                            <span className="font-semibold text-neutral-700 dark:text-zinc-300">Referencia:</span> {checkoutForm.reference.trim()}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-black/[0.07] bg-white p-3.5 dark:border-white/10 dark:bg-zinc-900">
                <div className="mb-2.5 flex items-center justify-between gap-3">
                  <h3 className="text-[12px] font-bold text-neutral-900 dark:text-neutral-100">Productos</h3>
                  <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[10px] font-semibold tabular-nums text-neutral-600 dark:bg-white/10 dark:text-zinc-300">
                    {totalProducts} {totalProducts === 1 ? 'artículo' : 'artículos'}
                  </span>
                </div>
                <div className="space-y-2">
                  {cart.map((item) => (
                    <div key={item.cartItemId} className="flex min-w-0 items-start gap-2.5 text-[12px] leading-snug">
                      {item.image ? <img src={item.image} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover bg-neutral-100 dark:bg-zinc-800" /> : <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-400 dark:bg-zinc-800"><ShoppingBag className="h-5 w-5" /></span>}
                      <span className="min-w-8 rounded-md bg-neutral-100 px-1.5 py-1 text-center text-[10px] font-bold tabular-nums text-neutral-700 dark:bg-white/10 dark:text-zinc-200">
                        {item.sellBy === 'WEIGHT' && item.weightG
                          ? `${(item.weightG / 1000).toFixed(2)} kg`
                          : `${item.quantity} ×`}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-neutral-800 dark:text-zinc-200">{item.name}</p>
                        {item.selectedOptions?.length ? (
                          <p className="mt-0.5 line-clamp-1 text-[10px] text-neutral-500 dark:text-zinc-400">
                            {item.selectedOptions.map((option) => option.name).join(' · ')}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section aria-label="Total y forma de pago" className="rounded-2xl bg-neutral-950 px-4 py-3.5 text-white shadow-[0_8px_24px_rgba(15,15,15,0.14)]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold text-neutral-300">Total del pedido</p>
                    <p className="mt-1 text-[28px] font-extrabold leading-none tracking-tight tabular-nums">{formatCurrency(orderTotal)}</p>
                  </div>
                  <span className="inline-flex max-w-[48%] items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1.5 text-right text-[10px] font-semibold leading-snug text-neutral-100">
                    {checkoutForm.paymentMethod === 'CASH' ? <Banknote className="h-3.5 w-3.5 shrink-0" /> : <CreditCard className="h-3.5 w-3.5 shrink-0" />}
                    {checkoutForm.paymentMethod === 'CASH'
                      ? fulfillmentType === 'PICKUP' ? 'Efectivo al recoger' : 'Efectivo al recibir'
                      : 'Tarjeta'}
                  </span>
                </div>
              </section>
            </div>

            <div className="shrink-0 border-t border-black/[0.06] bg-white/95 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl dark:border-white/10 dark:bg-neutral-950/95 sm:px-6">
              <div className="flex flex-col gap-2 sm:flex-row-reverse">
                <button
                  type="button"
                  onClick={commitPreOrder}
                  className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] px-5 py-3 text-[14px] font-bold text-white shadow-[0_8px_20px_-6px_rgba(14,165,233,0.42)] transition-colors hover:bg-[var(--accent-strong)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-950 sm:flex-1"
                >
                  <Check className="h-4 w-4" strokeWidth={2.6} />
                  Enviar pedido ahora
                </button>
                <button
                  type="button"
                  onClick={clearPreConfirm}
                  className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-2xl border border-neutral-200 bg-white px-5 py-3 text-[13px] font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2 dark:border-white/15 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus-visible:ring-offset-neutral-950 sm:flex-1"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Volver a revisar
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Horario de atención */}
      {isHoursModalOpen && restaurant && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsHoursModalOpen(false)} />
          <div className="relative flex max-h-[92vh] w-full max-w-sm flex-col overflow-hidden rounded-t-[32px] bg-white dark:bg-neutral-950 shadow-[0_-24px_80px_rgba(15,15,15,0.35)] sm:rounded-[32px] animate-in slide-in-from-bottom-4 fade-in duration-300">
            {/* Drag handle */}
            <div className="flex justify-center pt-3">
              <div className="h-1.5 w-10 rounded-full bg-neutral-300 dark:bg-zinc-700" />
            </div>

            {/* Cabecera */}
            <div className="flex items-center gap-4 px-6 pb-4 pt-3">
              {restaurant.logo ? (
                <img
                  src={restaurant.logo}
                  alt={`Logo de ${restaurant.name}`}
                  className="h-12 w-12 shrink-0 rounded-2xl border border-black/5 object-cover shadow-sm"
                />
              ) : (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-400 dark:bg-zinc-800 dark:text-zinc-500">
                  <Clock className="h-6 w-6" strokeWidth={1.8} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">Horario de atención</p>
                <h3 className="truncate text-lg font-extrabold tracking-tight text-neutral-950 dark:text-neutral-50">{restaurant.name}</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsHoursModalOpen(false)}
                aria-label="Cerrar"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 transition hover:bg-neutral-200 hover:text-neutral-700 active:scale-90 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
              >
                <X className="h-4 w-4" strokeWidth={2.5} />
              </button>
            </div>

            {/* Estado actual */}
            {(() => {
              const hours = restaurant.operatingHours;
              const hasHours = Array.isArray(hours) && hours.length > 0;
              const currentClose = hasHours ? getCurrentShiftClose(hours, new Date()) : null;
              return (
                <div className="px-6">
                  {hasHours ? (
                    <div className={`flex items-center gap-2.5 rounded-2xl border px-4 py-3 ${
                      restaurant.isOpen
                        ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10'
                        : 'border-rose-200/70 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/10'
                    }`}>
                      <span className="relative flex h-2 w-2 shrink-0">
                        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${restaurant.isOpen ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                        <span className={`relative inline-flex h-2 w-2 rounded-full ${restaurant.isOpen ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                      </span>
                      <p className={`text-[13px] font-bold leading-snug ${restaurant.isOpen ? 'text-emerald-800 dark:text-emerald-300' : 'text-rose-800 dark:text-rose-300'}`}>
                        {restaurant.isOpen
                          ? `Abierto ahora${currentClose ? ` · Cierra a las ${formatHour12(currentClose)}` : ''}`
                          : `Cerrado ahora${restaurant.nextOpenTime ? ` · Abre ${formatNextOpen(restaurant.nextOpenTime)}` : ''}`}
                      </p>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2.5 rounded-2xl border border-sky-200/70 bg-sky-50 px-4 py-3 dark:border-sky-500/30 dark:bg-sky-500/10">
                      <Clock className="h-4 w-4 shrink-0 text-sky-600" strokeWidth={2} />
                      <p className="text-[13px] font-semibold leading-snug text-sky-800 dark:text-sky-300">
                        Este negocio no tiene un horario configurado; atiende en horario libre.
                      </p>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Semana */}
            {Array.isArray(restaurant.operatingHours) && restaurant.operatingHours.length > 0 && (
              <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-2 pt-4">
                <div className="overflow-hidden rounded-2xl border border-black/[0.05] bg-white dark:border-white/10 dark:bg-zinc-900">
                  {buildWeekSchedule(restaurant.operatingHours).map((row, idx) => {
                    const isToday = new Date().getDay() === row.dayOfWeek;
                    return (
                      <div
                        key={row.dayOfWeek}
                        className={`flex items-center justify-between gap-3 px-4 py-3 ${
                          idx > 0 ? 'border-t border-black/[0.04]' : ''
                        } ${isToday ? 'bg-[var(--menu-soft)] ring-1 ring-inset ring-black/[0.03]' : ''}`}
                      >
                        <div className="flex items-center gap-2.5">
                          {isToday && <span className="h-1.5 w-1.5 rounded-full bg-[var(--menu-accent)]" />}
                          <span className={`text-[13px] ${isToday ? 'font-black text-neutral-950' : 'font-semibold text-neutral-700'}`}>
                            {row.label}
                          </span>
                          {isToday && (
                            <span className="rounded-full bg-neutral-950 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
                              Hoy
                            </span>
                          )}
                        </div>
                        <div className="text-right">
                          {row.shifts.length === 0 ? (
                            <span className="text-[12px] font-medium text-neutral-400">Cerrado</span>
                          ) : (
                            <div className="flex flex-col items-end">
                              {row.shifts.map((s, i) => (
                                <span key={i} className={`text-[12px] font-semibold tabular-nums ${isToday ? 'text-neutral-950' : 'text-neutral-600'}`}>
                                  {formatHour12(s.openTime)} – {formatHour12(s.closeTime)}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-3 text-center text-[11px] font-medium text-neutral-400">
                  Los horarios pueden variar en días festivos.
                </p>
              </div>
            )}

            {/* Acción */}
            <div className="border-t border-black/[0.05] px-6 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-4">
              <button
                type="button"
                onClick={() => setIsHoursModalOpen(false)}
                className="w-full rounded-full bg-neutral-950 px-5 py-3.5 text-sm font-bold text-white transition hover:bg-neutral-800 active:scale-[0.98]"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Push Reminder Modal */}
      {isPushReminderModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" onClick={() => setIsPushReminderModalOpen(false)}></div>
          <div className="relative w-full max-w-sm rounded-[32px] bg-white p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft text-3xl">
              <Bell className="h-8 w-8 text-[var(--accent)]" strokeWidth={1.5} />
            </div>
            <h3 className="text-center text-xl font-bold tracking-tight text-neutral-900">
              ¡No pierdas de vista tu pedido!
            </h3>
            <p className="mt-3 text-center text-sm leading-relaxed text-neutral-600">
              Tu pedido ya se envió. Puedes activar avisos en este dispositivo o consultar el estado desde Pedidos.
            </p>
            <div className="mt-6 flex flex-col gap-3">
                  <PushActivationButton
                    activate={subscribePush}
                    onActivated={() => setIsPushReminderModalOpen(false)}
                    className="w-full rounded-full bg-[var(--accent)] px-4 py-3.5 text-sm font-semibold text-white shadow-[0_8px_16px_rgba(135,206,235,0.25)] transition active:scale-[0.98] active-scale"
                  />
                  <button
                    type="button"
                    onClick={() => setIsPushReminderModalOpen(false)}
                    className="w-full rounded-full px-4 py-3 text-sm font-semibold text-neutral-500 transition hover:bg-neutral-100 active:scale-[0.98] active-scale"
                  >
                    Ahora no
                  </button>
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
              {cardEnabled && (
                <button
                  type="button"
                  onClick={() => {
                    setCheckoutForm((prev) => ({ ...prev, paymentMethod: 'CREDIT_CARD' }));
                    setShowMaxCashModal(false);
                  }}
                  className="w-full rounded-full bg-[var(--accent)] px-4 py-3.5 text-sm font-semibold text-white shadow-[0_8px_16px_rgba(135,206,235,0.25)] transition hover:bg-[var(--accent)] active:scale-[0.98] active-scale"
                >
                  Cambiar a Tarjeta
                </button>
              )}
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
              {cardEnabled
                ? 'Puedes continuar tu pedido ahora mismo eligiendo Tarjeta; con tarjeta no necesitamos tu GPS.'
                : 'Este restaurante no tiene tarjeta habilitada. Activa tu ubicación para pagar en efectivo.'}
            </p>
            <div className="mt-6 flex flex-col gap-3">
              {cardEnabled && (
                <button
                  type="button"
                  onClick={() => {
                    setCheckoutForm((prev) => ({ ...prev, paymentMethod: 'CREDIT_CARD' }));
                    setShowGpsCashModal(false);
                  }}
                  className="w-full rounded-full bg-[var(--accent)] px-4 py-3.5 text-sm font-semibold text-white shadow-[0_8px_16px_rgba(135,206,235,0.25)] transition hover:bg-[var(--accent)] active:scale-[0.98] active-scale"
                >
                  Cambiar a Tarjeta
                </button>
              )}
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
      {locationNotice && (
        <dialog ref={locationNoticeRef} className="wl-location-notice" aria-labelledby="wl-location-notice-title" aria-describedby="wl-location-notice-description" onClose={() => setLocationNotice(false)}>
          <span className="wl-location-notice-icon"><MapPin aria-hidden="true" /></span>
          <h2 id="wl-location-notice-title">Ubicación no disponible</h2>
          <p id="wl-location-notice-description">Busca tu dirección para continuar.</p>
          <button type="button" autoFocus onClick={() => locationNoticeRef.current?.close()}>Aceptar</button>
        </dialog>
      )}
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

      <div className="wl-catalog-shell mx-auto max-w-7xl px-4 pb-5 pt-0 md:px-6 md:pb-8 md:pt-0">

        {error ? (
          <div className="mt-5">
            <Callout tone="danger">{error}</Callout>
            <button
              type="button"
              onClick={() => setMenuReloadKey((k) => k + 1)}
              className="mt-3 min-h-11 rounded-full bg-[#bb0a0e] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#94070b]"
            >
              Reintentar
            </button>
          </div>
        ) : null}

        {loadingRestaurant ? (
          <div className="wl-menu-loading" role="status" aria-label="Cargando menú">
            <div className="wl-skeleton-banner animate-pulse" />
            <div className="wl-skeleton-categories">{[1,2,3,4].map(value => <div key={value} className="animate-pulse" />)}</div>
            <div className="wl-products-grid">{[1,2,3,4].map(value => <div key={value} className="wl-skeleton-product animate-pulse" />)}</div>
          </div>
        ) : restaurant ? (
          <div className="wl-menu">
            <MenuPromotions apiBase={apiBase} token={token} authReady={isAuthReady} initialBanners={initialBanners} viewerId={sessionUser?.id} allowModal={!isCheckoutOpen && !isCartOpen && !showAuthModal} />
            <div className="space-y-0">
              <h1 className="wl-menu-title">Menú de {restaurant.name}</h1>
              <section className="wl-restaurant-info" hidden={!showRestaurantInfo}>
                <div className="wl-hero-details relative px-4 pb-2 pt-0 text-sm text-neutral-600 md:px-6 md:pb-3 lg:px-7 lg:pt-5">
                  <div className="-mx-4 mt-3 flex min-w-0 flex-col gap-1.5 bg-[var(--menu-surface)] p-1.5 md:-mx-6 lg:mx-0 lg:flex-row lg:items-stretch lg:gap-0 lg:divide-x lg:divide-black/[0.06] lg:rounded-2xl lg:border lg:border-black/[0.06] lg:shadow-[0_6px_24px_rgba(15,23,42,0.06)] dark:divide-zinc-700 lg:dark:border-zinc-700/70 dark:bg-[var(--menu-surface-dark)]">
                    {/* Address */}
                    <div className="flex w-full min-w-0 flex-1 items-center gap-3 rounded-2xl bg-neutral-50 px-3 py-3 text-neutral-700 lg:bg-transparent lg:px-4 dark:bg-zinc-800/70 dark:text-zinc-200 lg:dark:bg-transparent">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-black/[0.04] bg-white text-neutral-500 shadow-sm dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      </div>
                      <span className="min-w-0"><span className="block text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-500 dark:text-zinc-400">Dirección</span><span className="mt-0.5 block break-words text-[13px] font-medium leading-5">{restaurant.address}</span></span>
                    </div>

                    {/* Stats Grid for Mobile / Flex for Desktop */}
                    <div className="flex w-full min-w-0 gap-1 lg:w-auto lg:gap-0">
                      <div className="flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl bg-neutral-50 px-1 py-2 text-center lg:flex-none lg:rounded-none lg:bg-transparent lg:px-4 dark:bg-zinc-800/70 lg:dark:bg-transparent">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-neutral-500 dark:text-zinc-400">Distancia</span>
                        <div className="flex items-center justify-center gap-1 text-[12px] font-semibold leading-4 text-neutral-800 dark:text-zinc-100">
                          <svg className="h-3 w-3 text-neutral-400 dark:text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                          </svg>
                          <span>{distanceKm ? `${distanceKm.toFixed(1)} km` : '-- km'}</span>
                        </div>
                      </div>
                      <div className="flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl bg-neutral-50 px-1 py-2 text-center lg:flex-none lg:rounded-none lg:bg-transparent lg:px-4 dark:bg-zinc-800/70 lg:dark:bg-transparent">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-neutral-500 dark:text-zinc-400">{isPickupOnly ? 'Servicio' : 'Envío'}</span>
                        <div className="flex items-center justify-center gap-1 text-[12px] font-semibold leading-4 text-neutral-800 dark:text-zinc-100">
                          {isPickupOnly ? (
                            <>
                              <ShoppingBag className="h-3 w-3 shrink-0 text-emerald-600" strokeWidth={2.5} />
                              <span className="font-bold text-emerald-700 dark:text-emerald-400">Solo recoger en tienda</span>
                            </>
                          ) : (
                            <>
                              <svg className="h-3 w-3 text-neutral-400 dark:text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              <span>{formatDeliverySummary(deliveryFee)}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsHoursModalOpen(true)}
                        title="Ver horarios del negocio"
                        className="flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl bg-neutral-50 px-1 py-2 text-center transition-colors hover:bg-neutral-100 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500 lg:flex-none lg:rounded-none lg:bg-transparent lg:px-4 dark:bg-zinc-800/70 dark:hover:bg-zinc-700 lg:dark:bg-transparent"
                      >
                        <span className="text-[10px] font-bold uppercase tracking-wide text-neutral-500 dark:text-zinc-400">Estado</span>
                        <div className="flex items-center gap-1.5 text-[12px]">
                          <span className="relative flex h-2 w-2 shrink-0">
                            <span className={`relative inline-flex rounded-full h-2 w-2 ${restaurant.isOpen ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
                          </span>
                          <span className={`font-bold ${restaurant.isOpen ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>{restaurant.isOpen ? 'Abierto' : 'Cerrado'}</span>
                        </div>
                      </button>
                      {(() => {
                         const accepted = getAcceptedPaymentMethods(restaurant);
                        const onlyCash = accepted.length === 1 && accepted[0] === 'CASH';
                        const onlyCard = accepted.length === 1 && accepted[0] === 'CREDIT_CARD';
                        if (!onlyCash && !onlyCard) return null;
                        return (
                          <div className="flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl bg-neutral-50 px-1 py-2 text-center lg:flex-none lg:rounded-none lg:bg-transparent lg:px-4 dark:bg-zinc-800/70 lg:dark:bg-transparent">
                            <span className="text-[10px] font-bold uppercase tracking-wide text-neutral-500 dark:text-zinc-400">Pago</span>
                            <div className="flex min-w-0 items-center justify-center gap-1 break-words text-[12px] font-semibold leading-4 text-neutral-800 dark:text-zinc-100">
                              {onlyCash ? (
                                <>
                                  <svg className="h-3 w-3 text-neutral-400 dark:text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                  Efectivo
                                </>
                              ) : (
                                <>
                                  <CreditCard className="h-3 w-3 text-neutral-400 dark:text-zinc-500" strokeWidth={2} />
                                  Tarjeta
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
                      !isPickupOnly &&
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

                      {getAcceptedPaymentMethods(restaurant).includes('CREDIT_CARD') && (
                        <div className="flex items-start gap-3 rounded-2xl border border-black/[0.05] bg-neutral-50 p-3.5 dark:border-zinc-800 dark:bg-zinc-800/50">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-600 shadow-sm dark:bg-zinc-900 dark:text-emerald-400">
                            <CreditCard className="h-[18px] w-[18px]" strokeWidth={1.8} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[13px] font-bold text-neutral-900 dark:text-white">Pago con tarjeta</p>
                            <p className="text-xs leading-relaxed text-neutral-500 dark:text-zinc-400">Puedes pagar con tarjeta sin importar la distancia a la dirección de entrega.</p>
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

              {!productSearchQuery.trim() && featuredProducts.length > 0 && <section id="wl-featured" className="wl-featured" aria-labelledby="wl-featured-title">
                <div className="wl-section-heading"><h2 id="wl-featured-title"><Flame aria-hidden="true" />Destacados</h2><button type="button" onClick={() => setMenuTab('promos')}>Ver todos <ChevronRight aria-hidden="true" /></button></div>
                <div className="wl-featured-track">{featuredProducts.map(product => <button key={product.id} type="button" className="wl-featured-card" disabled={!getProductAvailability(product).available} aria-label={`Agregar ${product.name} desde destacados`} onClick={() => addToCart(product)}>
                  {product.image && <img src={product.image} alt="" loading="lazy" />}<span><strong>{product.name}</strong><b>{formatCurrency(product.discountPrice ?? product.price)}</b></span>
                </button>)}</div>
              </section>}
              <div ref={categorySearchRef} className="wl-menu-search">
                <div className="py-1">
                  <div className="relative w-full max-w-2xl mx-auto lg:mx-0">
                    <span className="pointer-events-none absolute left-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300"><Search aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={2} /></span>
                    <input
                      type="text"
                      placeholder="¿Qué se te antoja hoy?"
                      aria-label="Buscar productos en el menú"
                      value={productSearchQuery}
                      onChange={(e) => setProductSearchQuery(e.target.value)}
                      className="min-h-[52px] w-full rounded-full border border-neutral-200 bg-white py-2 pl-14 pr-12 text-base font-medium text-neutral-950 shadow-[0_4px_18px_rgba(23,23,23,0.05)] outline-none transition-colors placeholder:font-normal placeholder:text-neutral-500 focus:border-red-500 focus:ring-2 focus:ring-red-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-400 dark:focus:border-red-400 dark:focus:ring-red-950"
                    />
                    {productSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setProductSearchQuery('')}
                        className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-red-700 transition-colors hover:text-red-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-600 dark:text-red-300 dark:hover:text-red-100"
                        aria-label="Cerrar y limpiar búsqueda"
                        title="Cerrar búsqueda"
                      >
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/70"><X aria-hidden="true" className="h-4 w-4" strokeWidth={2.5} /></span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
              {!productSearchQuery.trim() && menuTab === 'home' && <div className="wl-section-heading"><h2>Categorías</h2></div>}
              {!productSearchQuery.trim() && menuTab === 'home' && <>
                 <div ref={categoryNavRef} className="wl-menu-nav wl-reference-categories">
                  <div
                    className="wl-category-scroll flex overflow-x-auto px-4 pb-0.5 md:px-6 lg:px-6"
                  >
                    <div className="flex min-w-max gap-1.5 mx-auto sm:gap-2">
                      {restaurant.categories.filter(category => category.id !== '__promotions__').map((category) => {
                        const isActive = activeCategory === category.id;
                        return (
                          <button
                            type="button"
                            key={category.id}
                            data-category-id={category.id}
                            onClick={() => scrollToCategory(category.id)}
                            aria-current={isActive ? 'true' : undefined}
                            className="wl-category-tab"
                          >
                            <span className={`wl-category-tab-name${/\s/.test(category.name.trim()) ? '' : ' is-single-word'}`} title={category.name}>{category.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </>}

              {!restaurant.categories.length && <p className="wl-content-empty">Estamos preparando el menú. Vuelve pronto para consultar los productos disponibles.</p>}
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
                  <div className="divide-y divide-neutral-200 dark:divide-zinc-800" aria-label="Resultados de búsqueda">
                    {searchResults.map((product) => {
                      const quantity = getCartQuantity(product.id);
                      const availability = getProductAvailability(product);
                      return (
                        <article id={product.id} key={product.id} data-wl-product className="py-4">
                          <div className="flex gap-3 sm:gap-4">
                            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl sm:h-24 sm:w-24">
                              {product.image ? (
                                <ProductImage product={product} />
                              ) : (
                                <div className="wl-product-placeholder"><Drumstick aria-hidden="true" /><span>Sin fotografía</span></div>
                              )}
                            </div>
                            <div className="flex min-w-0 flex-1 flex-col justify-between">
                              <div>
                                <h3 className="text-base font-semibold text-neutral-950 dark:text-white">{product.name}</h3>
                                {product.description && <button type="button" className="wl-product-description-trigger mt-0.5 text-sm text-neutral-500 dark:text-zinc-400" onClick={() => openProductPreview(product)} aria-label={`Ver detalle de ${product.name}`}><span className="line-clamp-2 leading-snug">{product.description}</span></button>}
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
                                    <button type="button" aria-label={`Quitar una unidad de ${product.name}`} onClick={() => { if (product.optionGroups?.length) { decreaseQuantityForProduct(product.id); } else { updateCartItem(product.id, { quantity: quantity - 1 }); } }} className="flex h-11 w-11 items-center justify-center rounded-full text-neutral-500 transition-all hover:bg-white active:scale-90 dark:text-zinc-300 dark:hover:bg-zinc-700">
                                      {quantity === 1 ? (
                                        <Trash2 className="h-3 w-3 text-red-500" />
                                      ) : (
                                        <Minus className="h-3 w-3" strokeWidth={2.5} />
                                      )}
                                    </button>
                                    <span className="flex h-7 w-7 items-center justify-center text-xs font-bold text-neutral-900 dark:text-white">{quantity}</span>
                                    <button type="button" aria-label={`Agregar una unidad de ${product.name}`} onClick={() => addToCart(product)} disabled={!availability.available || (availability.tracked && quantity >= availability.maxQty)} className="flex h-11 w-11 items-center justify-center rounded-full text-neutral-500 transition-all hover:bg-white active:scale-90 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-700">
                                      <Plus className="h-3 w-3" strokeWidth={2.5} />
                                    </button>
                                  </div>
                                ) : (
                                  <button type="button" aria-label={`Agregar ${product.name} al carrito`} onClick={() => addToCart(product)} disabled={!availability.available} className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-red-700 px-4 text-sm font-bold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-400">
                                    <CartIcon aria-hidden="true" className="h-4 w-4" />Agregar
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
              ) : restaurant.categories.filter(category => menuTab === 'promos' ? category.id === '__promotions__' : category.id !== '__promotions__').map((category) => {
                const isPromotions = category.id === '__promotions__';
                const isPromoCarousel = false;
                const isStore = !isRestaurant((restaurant as any).businessType);
                const isLargeCategory = isStore && !isPromotions && category.products.length > 4;
                return (
                <section
                  key={category.id}
                  id={category.id}
                  ref={(node) => {
                    categorySectionRefs.current[category.id] = node;
                  }}
                  className="wl-category scroll-mt-[184px] mb-10 px-0 py-0 md:scroll-mt-[184px]"
                >
                  <div className="wl-section-heading"><h2>{category.name}</h2><span className="wl-category-product-count">{category.products.length} {category.products.length === 1 ? 'producto' : 'productos'}</span></div>

                  <div className={isPromoCarousel || isLargeCategory ? "relative" : "overflow-hidden"}>
                    <CarouselOrGrid
                      isCarousel={false}
                      gridClassName="wl-products-grid"
                    >
                    {category.products.map((product) => {
                      const quantity = getCartQuantity(product.id);
                      const avail = getProductAvailability(product);

                      return (
                        isPromoCarousel ? (
                          <article id={product.id} key={product.id} data-wl-product className="group w-32 shrink-0 snap-start overflow-hidden rounded-2xl border border-black/[0.04] bg-white transition-all duration-300 shadow-[0_2px_8px_rgba(0,0,0,0.02)] hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] active:scale-[0.98] dark:border-zinc-800 dark:bg-neutral-900">
                          
                            <div className="relative h-20 w-full overflow-hidden">
                              {product.image ? (
                                <div className="h-full w-full transition-transform duration-300 group-hover:scale-105">
                                  <ProductImage product={product} />
                                </div>
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
                                  <button type="button" onClick={() => addToCart(product)} disabled={!avail.available} className="w-full rounded-lg bg-neutral-900 py-1.5 text-[10px] font-bold text-white transition hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-400 dark:bg-white dark:text-neutral-950 dark:hover:bg-zinc-200 dark:disabled:bg-neutral-800 dark:disabled:text-zinc-600">
                                    Agregar
                                  </button>
                                )}
                              </div>
                            </div>
                          </article>
                        ) : isLargeCategory ? (
                          <article id={product.id} key={product.id} data-wl-product className="w-[42vw] shrink-0 snap-start sm:w-52 overflow-hidden rounded-2xl border border-black/[0.04] bg-white transition-all duration-300 shadow-[0_2px_12px_rgba(0,0,0,0.02)] hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] dark:border-zinc-800 dark:bg-neutral-900">
                            <div className="flex h-full flex-col">
                              <div
                                className="relative aspect-square overflow-hidden bg-neutral-50 cursor-pointer dark:bg-neutral-900"
                                onClick={() => openProductPreview(product)}
                              >
                                {product.image ? (
                                  <div className="h-full w-full transition-transform duration-300 hover:scale-105">
                                    <ProductImage product={product} carouselIndex={carouselIndexMap[product.id]} />
                                  </div>
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
                                  <p className="mt-1 text-base font-black tracking-[-0.02em] text-neutral-950 dark:text-white">
                                    {formatCurrency(product.unitPrice || product.price)}
                                    <span className="ml-1 text-xs font-bold text-neutral-400 dark:text-zinc-500">/kg</span>
                                  </p>
                                ) : getMultiBuyInfo(product).isMultiBuy ? (
                                  <div className="mt-1">
                                    <p className="text-base font-black tracking-[-0.02em] text-neutral-950 dark:text-white">{formatCurrency(getMultiBuyInfo(product).basePrice)}</p>
                                    <p className="truncate text-[9px] font-semibold text-emerald-600">Llevando {getMultiBuyInfo(product).buy}: {formatCurrency(getMultiBuyInfo(product).effectiveUnitPrice)} c/u</p>
                                  </div>
                                ) : product.discountPrice ? (
                                  <div className="mt-1 flex items-baseline gap-2">
                                    <span className="text-base font-black tracking-[-0.02em] text-rose-600">{formatCurrency(product.discountPrice)}</span>
                                    <span className="text-[11px] font-semibold text-neutral-400 line-through dark:text-zinc-500">{formatCurrency(product.price)}</span>
                                  </div>
                                ) : (
                                  <p className="mt-1 text-base font-black tracking-[-0.02em] text-neutral-950 dark:text-white">{formatCurrency(product.price)}</p>
                                )}
                                {product.description && (
                                  <div className="mt-1.5">
                                    <button type="button" className="wl-product-description-trigger text-[11px] text-neutral-500 dark:text-zinc-400" onClick={() => openProductPreview(product)} aria-label={`Ver detalle de ${product.name}`}><span className="line-clamp-2 leading-snug">{product.description}</span></button>
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
                                    <button type="button" onClick={() => addToCart(product)} disabled={!avail.available} className="w-full rounded-xl bg-neutral-900 py-2.5 text-[11px] font-bold text-white transition hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-400 dark:bg-white dark:text-neutral-950 dark:hover:bg-zinc-200 dark:disabled:bg-neutral-800 dark:disabled:text-zinc-600">
                                      Agregar
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </article>
                        ) : isStore ? (
                          <article id={product.id} key={product.id} data-wl-product className="overflow-hidden rounded-2xl border border-black/[0.04] bg-white transition-all duration-300 shadow-[0_2px_12px_rgba(0,0,0,0.02)] hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] dark:border-zinc-800 dark:bg-neutral-900">
                            <div className="flex h-full flex-col">
                              <div
                                className="relative aspect-square overflow-hidden bg-neutral-50 cursor-pointer dark:bg-neutral-900"
                                onClick={() => openProductPreview(product)}
                              >
                                {product.image ? (
                                  <div className="h-full w-full transition-transform duration-300 hover:scale-105">
                                    <ProductImage product={product} carouselIndex={carouselIndexMap[product.id]} />
                                  </div>
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
                                  <p className="mt-1 text-base font-black tracking-[-0.02em] text-neutral-950 dark:text-white">
                                    {formatCurrency(product.unitPrice || product.price)}
                                    <span className="ml-1 text-xs font-bold text-neutral-400 dark:text-zinc-500">/kg</span>
                                  </p>
                                ) : getMultiBuyInfo(product).isMultiBuy ? (
                                  <div className="mt-1">
                                    <p className="text-base font-black tracking-[-0.02em] text-neutral-950 dark:text-white">{formatCurrency(getMultiBuyInfo(product).basePrice)}</p>
                                    <p className="truncate text-[9px] font-semibold text-emerald-600">Llevando {getMultiBuyInfo(product).buy}: {formatCurrency(getMultiBuyInfo(product).effectiveUnitPrice)} c/u</p>
                                  </div>
                                ) : product.discountPrice ? (
                                  <div className="mt-1 flex items-baseline gap-2">
                                    <span className="text-base font-black tracking-[-0.02em] text-rose-600">{formatCurrency(product.discountPrice)}</span>
                                    <span className="text-[11px] font-semibold text-neutral-400 line-through dark:text-zinc-500">{formatCurrency(product.price)}</span>
                                  </div>
                                ) : (
                                  <p className="mt-1 text-base font-black tracking-[-0.02em] text-neutral-950 dark:text-white">{formatCurrency(product.price)}</p>
                                )}
                                {product.description && (
                                  <div className="mt-1.5">
                                    <button type="button" className="wl-product-description-trigger text-[11px] text-neutral-500 dark:text-zinc-400" onClick={() => openProductPreview(product)} aria-label={`Ver detalle de ${product.name}`}><span className="line-clamp-2 leading-snug">{product.description}</span></button>
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
                                    <button type="button" onClick={() => addToCart(product)} disabled={!avail.available} className="w-full rounded-xl bg-neutral-900 py-2.5 text-[11px] font-bold text-white transition hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-400 dark:bg-white dark:text-neutral-950 dark:hover:bg-zinc-200 dark:disabled:bg-neutral-800 dark:disabled:text-zinc-600">
                                      Agregar
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </article>
                        ) : (
                          <article id={product.id} key={product.id} data-wl-product className="overflow-hidden rounded-2xl border border-black/[0.04] bg-white transition-all duration-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] dark:border-zinc-800 dark:bg-neutral-900">
                            <div className="flex gap-3 p-3">
                              <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl sm:h-28 sm:w-28">
                                {product.image ? (
                                  <>
                                    <ProductImage product={product} carouselIndex={carouselIndexMap[product.id]} />
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
                                  <div className="wl-product-placeholder"><Utensils aria-hidden="true" /><span>Sin fotografía</span></div>
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
                              <div className="wl-product-content flex min-w-0 flex-1 flex-col">
                                <div className="wl-product-copy flex flex-col gap-0.5">
                                  <h3 className="wl-product-list-title text-lg font-black leading-tight text-neutral-950 dark:text-white">{product.name}</h3>
                                  {product.description && (
                                    <button type="button" className="wl-product-description-trigger text-xs text-neutral-500 dark:text-zinc-400" onClick={() => openProductPreview(product)} aria-label={`Ver detalle de ${product.name}`}><span className="line-clamp-2 leading-relaxed">{product.description}</span></button>
                                  )}
                                </div>
                                <div className="wl-product-purchase">
                                  <div className="wl-product-price">
                                    {product.sellBy === 'WEIGHT' ? (
                                      <p className="text-base font-black tracking-[-0.02em] text-neutral-950 dark:text-white">
                                        {formatCurrency(product.unitPrice || product.price)}
                                        <span className="ml-1 text-xs font-bold text-neutral-400 dark:text-zinc-500">/kg</span>
                                      </p>
                                    ) : getMultiBuyInfo(product).isMultiBuy ? (
                                      <div className="mt-0.5">
                                        <span className="text-base font-black tracking-[-0.02em] text-neutral-950 dark:text-white">{formatCurrency(getMultiBuyInfo(product).basePrice)}</span>
                                        <p className="truncate text-[10px] font-semibold text-emerald-600">Llevando {getMultiBuyInfo(product).buy}: {formatCurrency(getMultiBuyInfo(product).effectiveUnitPrice)} c/u</p>
                                      </div>
                                    ) : product.discountPrice ? (
                                      <div className="flex items-baseline gap-1.5">
                                        <span className="text-base font-black tracking-[-0.02em] text-rose-600">{formatCurrency(product.discountPrice)}</span>
                                        <span className="text-xs text-neutral-400 line-through dark:text-zinc-500">{formatCurrency(product.price)}</span>
                                      </div>
                                    ) : (
                                      <span className="text-base font-black tracking-[-0.02em] text-neutral-950 dark:text-white">{formatCurrency(product.price)}</span>
                                    )}
                                  </div>
                                <div className="wl-product-actions">
                                  {quantity > 0 ? (
                                    <div className="wl-product-stepper" role="group" aria-label={`Cantidad de ${product.name}`}>
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
                                    <button type="button" onClick={() => addToCart(product)} disabled={!avail.available} className="wl-product-add rounded-xl bg-neutral-900 px-5 py-2.5 text-[11px] font-bold text-white transition hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-400 dark:bg-white dark:text-neutral-950 dark:hover:bg-zinc-200 dark:disabled:bg-neutral-800 dark:disabled:text-zinc-600" aria-label={`Agregar ${product.name} al carrito`}>
                                      <CartIcon aria-hidden="true" strokeWidth={2} />
                                      <span>Agregar</span>
                                    </button>
                                  )}
                                </div>
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
              Síguenos en redes sociales
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/60 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-sm sm:py-6">
          <div role="dialog" aria-modal="true" aria-labelledby="order-detail-title" className="relative h-fit max-h-full w-full max-w-[480px] overflow-y-auto overscroll-contain rounded-[28px] bg-[#faf9f8] shadow-[0_30px_100px_rgba(0,0,0,0.25)] no-scrollbar">
            {/* Encabezado Fijo con Botón de Cierre */}
            <div className="sticky top-0 z-10 flex items-center justify-between bg-[#faf9f8]/95 backdrop-blur-md px-5 sm:px-6 py-4 border-b border-black/5">
              <div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-red-600">Tu pedido</p><h3 id="order-detail-title" className="text-lg font-bold tracking-tight text-neutral-950">Detalles del pedido</h3></div>
              <button
                type="button"
                onClick={() => setIsDetailModalOpen(false)}
                aria-label="Cerrar detalles del pedido"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-neutral-600 shadow-sm ring-1 ring-black/5 transition hover:bg-red-50 hover:text-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
                </svg>
              </button>
            </div>

            <div className="px-4 sm:px-6 py-5 space-y-4">
              <div className="space-y-4">
                {/* Header del Restaurante */}
                <div className="flex items-center gap-4 rounded-[22px] border border-white bg-gradient-to-r from-red-50/80 to-white p-4 shadow-[0_4px_18px_rgba(0,0,0,0.04)]">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-neutral-950 shadow-lg shadow-neutral-900/10">
                    <span className="text-lg font-black tracking-tight text-white">
                      {activeOrderDetailsMap[selectedOrderId].restaurant.name.substring(0, 2).toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1"><h2 className="truncate text-lg font-bold tracking-tight text-neutral-950">{activeOrderDetailsMap[selectedOrderId].restaurant.name}</h2>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                    {formatDate(activeOrderDetailsMap[selectedOrderId].createdAt)} 
                    <span className="h-1 w-1 rounded-full bg-neutral-300"></span> 
                    Ref #{(activeOrderDetailsMap[selectedOrderId] as any).dailyCounter || '...'}
                  </p>
                  <div className="mt-2">
                    <StatusBadge status={activeOrderDetailsMap[selectedOrderId].status} businessType={activeOrderDetailsMap[selectedOrderId].restaurant?.businessType} />
                  </div>
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
                      <div className="flex items-start gap-3 p-4 rounded-[20px] border border-orange-100 bg-gradient-to-r from-orange-50 to-red-50">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-orange-100 text-red-600">
                          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                          </svg>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-red-600">Va con retraso</p>
                          <p className="text-sm font-bold text-red-800">
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
                            className="mt-3 inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-b from-red-500 to-red-700 px-4 py-2.5 text-xs font-bold text-white shadow-md shadow-red-200 transition-all hover:from-red-600 active:scale-[0.97]"
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
                <div className="bg-white rounded-[22px] border border-neutral-100 shadow-[0_4px_18px_rgba(0,0,0,0.04)] p-5 space-y-5">
                  <div className="space-y-4">
                    <p className="text-sm font-bold text-neutral-950">Resumen del pedido</p>
                    <div className="space-y-4">
                      {activeOrderDetailsMap[selectedOrderId].items.map((item) => (
                        <div key={item.id} className="text-sm">
                          <div className="flex gap-3">
                            <span className="flex h-8 min-w-8 items-center justify-center rounded-xl bg-red-50 px-2 text-xs font-bold text-red-700">{item.quantity}×</span>
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

                  <div className="border-t border-dashed border-neutral-200 pt-5 space-y-3 text-sm dark:border-zinc-700">
                    <div className="flex justify-between text-neutral-600">
                      <p>Subtotal</p>
                      <p className="font-medium text-neutral-900">{formatCurrency(activeOrderDetailsMap[selectedOrderId].subtotal)}</p>
                    </div>
                    <div className="flex justify-between text-neutral-600">
                      <p>Costo de envío</p>
                      <p className="font-medium text-neutral-900">{formatCurrency(activeOrderDetailsMap[selectedOrderId].deliveryFee)}</p>
                    </div>
                    {Number(activeOrderDetailsMap[selectedOrderId].serviceFee || 0) > 0 && <div className="flex justify-between text-neutral-600">
                      <p>Tarifa de servicio</p>
                      <p className="font-medium text-neutral-900">{formatCurrency(activeOrderDetailsMap[selectedOrderId].serviceFee)}</p>
                    </div>}
                    {Number(activeOrderDetailsMap[selectedOrderId].promoDiscountAmount || 0) > 0 && (
                      <div className="flex justify-between text-sky-700">
                        <p>Descuento{activeOrderDetailsMap[selectedOrderId].promoCode ? ` (${activeOrderDetailsMap[selectedOrderId].promoCode})` : ''}</p>
                        <p className="font-bold text-sky-700">-{formatCurrency(Number(activeOrderDetailsMap[selectedOrderId].promoDiscountAmount))}</p>
                      </div>
                    )}
                    <div className="flex justify-between font-bold text-neutral-950 text-lg pt-4 border-t border-dashed border-neutral-200 mt-4">
                      <p>Total a pagar</p>
                      <p className="text-red-700">{formatCurrency(activeOrderDetailsMap[selectedOrderId].totalAmount)}</p>
                    </div>
                  </div>
                </div>

                {activeOrderDetailsMap[selectedOrderId].fulfillmentType === 'PICKUP' ? (
                  /* Datos de Recolección */
                  <div className="bg-white rounded-[22px] border border-neutral-100 shadow-[0_4px_18px_rgba(0,0,0,0.04)] p-5 space-y-4">
                    <p className="text-sm font-bold text-neutral-950">Recolección y pago</p>
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
                        <p className="font-medium text-neutral-900">{formatPaymentMethodLabel(activeOrderDetailsMap[selectedOrderId].paymentMethod)}</p>
                        <p className="text-xs text-neutral-500">{activeOrderDetailsMap[selectedOrderId].paymentStatus === 'PENDING' ? 'Pago pendiente' : activeOrderDetailsMap[selectedOrderId].paymentStatus === 'PAID' ? 'Pagado' : activeOrderDetailsMap[selectedOrderId].paymentStatus}</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Datos de Entrega */
                  <div className="bg-white rounded-[22px] border border-neutral-100 shadow-[0_4px_18px_rgba(0,0,0,0.04)] p-5 space-y-4">
                    <p className="text-sm font-bold text-neutral-950">Entrega y pago</p>
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-red-50 text-red-600 shrink-0">
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
                        <p className="font-medium text-neutral-900">{formatPaymentMethodLabel(activeOrderDetailsMap[selectedOrderId].paymentMethod)}</p>
                        <p className="text-xs text-neutral-500">{activeOrderDetailsMap[selectedOrderId].paymentStatus === 'PENDING' ? 'Pago pendiente' : activeOrderDetailsMap[selectedOrderId].paymentStatus === 'PAID' ? 'Pagado' : activeOrderDetailsMap[selectedOrderId].paymentStatus}</p>
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
                  <p role="status" className="py-6 text-center text-sm text-neutral-500 dark:text-zinc-400">Cargando chat…</p>
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
                  aria-label="Enviar mensaje"
                  className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-xl bg-[var(--accent)] text-white transition hover:bg-[var(--accent)] active:scale-95 active-scale disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-sky-200"
                >
                  {sendingChatMessage ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M22 2 11 13m11-11-7 20-4-9-9-4Z" />
                    </svg>
                  )}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {displayCartCount > 0 && !isCartOpen && !isCheckoutOpen && !customizingProduct && !showAuthModal && (
        <div className="wl-floating-cart">
          <button type="button" onClick={() => setIsCartOpen(true)}
            aria-label={`Ver carrito, ${displayCartCount} ${displayCartCount === 1 ? 'producto' : 'productos'}, subtotal ${formatCurrency(effectiveSubtotal)}`}>
            <span className="wl-floating-cart-count" aria-hidden="true">{displayCartCount > 99 ? '99+' : displayCartCount}</span>
            <span className="wl-floating-cart-label">Ver carrito</span>
            <span className="wl-floating-cart-total"><small>Subtotal</small><strong>{formatCurrency(effectiveSubtotal)}</strong></span>
            <ChevronRight className="wl-floating-cart-arrow" aria-hidden="true" />
          </button>
        </div>
      )}

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

      {/* Product details: the browser manages focus and Escape for the dialog. */}
      {previewProduct && (
        <dialog
          ref={previewDialogRef}
          className={`wl-product-detail-dialog${previewProduct.images.length ? '' : ' is-text-only'}`}
          aria-labelledby="wl-product-detail-title"
          aria-describedby={previewProduct.description ? 'wl-product-detail-description' : undefined}
          onClose={() => { if (previewSuspendedRef.current) { previewSuspendedRef.current = false; return; } setPreviewProduct(null); setPreviewLightboxOpen(false); }}
          onClick={event => { if (event.target === event.currentTarget) event.currentTarget.close(); }}
        >
          <div
            className="wl-product-detail-card relative flex w-full flex-col overflow-hidden bg-white dark:bg-neutral-900"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              type="button"
              onClick={() => previewDialogRef.current?.close()}
              aria-label="Cerrar detalle del producto"
              className="absolute right-3 top-3 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-neutral-700 shadow-md backdrop-blur-sm transition hover:bg-white dark:bg-neutral-800/90 dark:text-zinc-300 dark:hover:bg-neutral-700"
            >
              <X className="h-4 w-4" />
            </button>

            {/* Image section */}
            <div className={`wl-product-detail-media${previewProduct.images.length ? '' : ' is-empty'}`}>
              {previewProduct.images.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setPreviewLightboxOpen(true)}
                  aria-label="Ampliar imagen"
                  className="relative flex h-full w-full cursor-zoom-in items-center justify-center appearance-none border-0 bg-transparent p-2 sm:p-4"
                >
                  <img
                    key={previewIndex}
                    src={previewProduct.images[previewIndex]}
                    alt={previewProduct.name}
                    loading="eager" decoding="async" fetchPriority="high"
                    draggable={false}
                    className="max-h-full max-w-full object-contain"
                    style={{ width: 'auto', height: 'auto' }}
                  />
                  <span className="pointer-events-none absolute bottom-4 right-4 flex items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-white opacity-80 backdrop-blur-sm transition hover:opacity-100 dark:bg-white/20">
                    <ZoomIn className="h-3.5 w-3.5" /> Ampliar
                  </span>
                </button>
              ) : (
                <div className="wl-product-detail-placeholder">
                  <Utensils aria-hidden="true" />
                  <span>Foto no disponible</span>
                </div>
              )}
              {previewProduct.discountPrice && (
                <div className="absolute left-4 top-4 z-10 rounded-full bg-rose-500/90 px-3 py-1 text-[11px] font-bold text-white shadow-lg backdrop-blur-sm">
                  -{Math.round((1 - previewProduct.discountPrice / previewProduct.price) * 100)}%
                </div>
              )}
              {getMultiBuyInfo(previewProduct).isMultiBuy && (
                <div className="absolute left-4 top-12 z-10 rounded-full bg-emerald-600/90 px-3 py-1 text-[11px] font-bold text-white shadow-lg backdrop-blur-sm">
                  {getMultiBuyInfo(previewProduct).buy}x{getMultiBuyInfo(previewProduct).pay}
                </div>
              )}
              {previewProduct.images.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => setPreviewIndex((prev) => (prev - 1 + previewProduct.images.length) % previewProduct.images.length)}
                    aria-label="Imagen anterior"
                    className="absolute left-2 top-1/2 z-10 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-neutral-700 shadow-md backdrop-blur-sm transition hover:bg-white hover:scale-105 active:scale-95 dark:bg-neutral-900/80 dark:text-zinc-300 dark:hover:bg-neutral-800"
                  >
                    <ChevronLeft className="h-4 w-4" strokeWidth={2.5} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewIndex((prev) => (prev + 1) % previewProduct.images.length)}
                    aria-label="Imagen siguiente"
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
                        aria-label={`Ver imagen ${idx + 1}`}
                        aria-current={idx === previewIndex ? 'true' : undefined}
                        className={`h-1.5 rounded-full transition-all duration-300 ${idx === previewIndex ? 'w-5 bg-neutral-900 dark:bg-white' : 'w-1.5 bg-neutral-300 hover:bg-neutral-500 dark:bg-zinc-600'}`}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>

            <ImageZoomLightbox
              open={previewLightboxOpen && !!previewProduct}
              images={previewProduct?.images ?? []}
              index={previewIndex}
              onIndexChange={setPreviewIndex}
              name={previewProduct?.name ?? ''}
              onClose={() => setPreviewLightboxOpen(false)}
              portalTarget={previewDialogRef.current}
            />

            {/* Details section */}
            <div className="wl-product-detail-content">
              <div className="wl-product-detail-copy min-h-0 flex-1 overflow-y-auto">
                <p className="wl-product-detail-kicker">Menú WingsLab</p>
                <h2 id="wl-product-detail-title" className="wl-product-detail-title">{previewProduct.name}</h2>
                {previewProduct.description && (
                  <p id="wl-product-detail-description" className="wl-product-detail-description">{previewProduct.description}</p>
                )}
                <div className="wl-product-detail-price">
                  {previewProduct.sellBy === 'WEIGHT' ? (
                    <p className="wl-product-current-price text-2xl font-bold">{formatCurrency(previewProduct.unitPrice || previewProduct.price)}<span className="text-base font-medium text-neutral-500 dark:text-zinc-400">/kg</span></p>
                  ) : getMultiBuyInfo(previewProduct).isMultiBuy ? (
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                        <span className="wl-product-current-price text-2xl font-bold">{formatCurrency(getMultiBuyInfo(previewProduct).basePrice)}</span>
                        <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-500">{formatCurrency(getMultiBuyInfo(previewProduct).effectiveUnitPrice)} c/u llevando {getMultiBuyInfo(previewProduct).buy}</span>
                      </div>
                      <span className="inline-block rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
                        Compra {getMultiBuyInfo(previewProduct).buy} paga {getMultiBuyInfo(previewProduct).pay} · ahorras {formatCurrency(getMultiBuyInfo(previewProduct).savingsPerGroup)}
                      </span>
                    </div>
                  ) : previewProduct.discountPrice ? (
                    <div className="space-y-1">
                      <div className="flex items-baseline gap-2.5">
                        <span className="wl-product-current-price text-2xl font-bold">{formatCurrency(previewProduct.discountPrice)}</span>
                        <span className="text-sm text-neutral-400 line-through dark:text-zinc-500">{formatCurrency(previewProduct.price)}</span>
                      </div>
                      <span className="inline-block rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
                        Ahorras {formatCurrency(previewProduct.price - previewProduct.discountPrice)}
                      </span>
                    </div>
                  ) : (
                    <p className="wl-product-current-price text-2xl font-bold">{formatCurrency(previewProduct.price)}</p>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3 border-t border-neutral-100 p-4 dark:border-zinc-800 sm:px-7 sm:py-5">
                {(previewProduct.optionGroups?.length || previewProduct.sellBy === 'WEIGHT') ? (
                  <button
                    type="button"
                    disabled={!currentPreviewProduct || !getProductAvailability(currentPreviewProduct).available}
                    onClick={() => {
                      if (!currentPreviewProduct) return;
                      previewSuspendedRef.current = true;
                      previewDialogRef.current?.close();
                      addToCart(currentPreviewProduct);
                    }}
                    className="wl-product-detail-primary flex-1"
                  >
                    {!currentPreviewProduct || !getProductAvailability(currentPreviewProduct).available ? 'Producto no disponible' : 'Personalizar y agregar'}
                  </button>
                ) : (() => {
                  const qty = getCartQuantity(previewProduct.id);
                  return (
                    <>
                      {qty > 0 && (
                        <div className="flex items-center justify-between rounded-xl bg-neutral-50 p-1 dark:bg-neutral-800">
                          <button
                            type="button"
                            aria-label={`Quitar una unidad de ${previewProduct.name}`}
                            onClick={() => {
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
                            aria-label={`Agregar una unidad de ${previewProduct.name}`}
                            disabled={!currentPreviewProduct || !getProductAvailability(currentPreviewProduct).available || qty >= getProductAvailability(currentPreviewProduct).maxQty}
                            onClick={() => { if (currentPreviewProduct) addToCart(currentPreviewProduct); }}
                            className="flex h-10 w-10 items-center justify-center rounded-lg text-neutral-500 transition hover:bg-white hover:text-neutral-800 active:scale-90 dark:text-zinc-300 dark:hover:bg-neutral-700 dark:hover:text-zinc-100"
                          >
                            <Plus className="h-4 w-4" strokeWidth={2.5} />
                          </button>
                        </div>
                      )}
                      <button
                        type="button"
                        disabled={qty === 0 && (!currentPreviewProduct || !getProductAvailability(currentPreviewProduct).available)}
                        onClick={() => {
                          if (qty === 0 && currentPreviewProduct) addToCart(currentPreviewProduct);
                          else if (qty > 0) previewDialogRef.current?.close();
                        }}
                        className="wl-product-detail-primary flex-1"
                      >
                        {qty > 0 ? 'Listo' : !currentPreviewProduct || !getProductAvailability(currentPreviewProduct).available ? 'Producto no disponible' : 'Agregar al carrito'}
                      </button>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        </dialog>
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
    <label className="grid gap-1.5 text-sm text-neutral-600 dark:text-zinc-300">
      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-neutral-500 dark:text-zinc-400">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        className="rounded-xl border border-black/[0.08] dark:border-white/10 bg-neutral-50/70 dark:bg-zinc-800 px-4 py-3 text-sm text-neutral-950 dark:text-neutral-100 outline-none transition placeholder:text-neutral-400/80 dark:placeholder:text-zinc-500 focus:border-sky-400 focus:bg-white dark:focus:bg-zinc-700 focus:ring-4 focus:ring-sky-400/15"
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
      iconCircle: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
    },
    danger: {
      iconCircle: 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300',
    },
    info: {
      iconCircle: 'bg-neutral-100 text-neutral-700 dark:bg-zinc-800 dark:text-zinc-200',
    },
  } as const;

  const s = styles[notice.tone];

  const isTransferRefund = notice.tone === 'danger' && notice.paymentMethod === 'TRANSFER' && notice.orderId;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]" role="dialog" aria-modal="true" aria-labelledby="transient-notice-title" aria-describedby="transient-notice-description">
      <div aria-hidden="true" className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={notice.dismissible !== false ? onClose : undefined} />
      <div className="relative max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto rounded-[28px] border border-neutral-200 bg-white px-5 pb-5 pt-7 text-center shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 sm:p-7">
        {notice.dismissible !== false && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar aviso"
            className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full text-neutral-500 transition hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        )}

        <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-2xl ${s.iconCircle}`}>
          <svg aria-hidden="true" className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {notice.tone === 'success' ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            ) : notice.tone === 'danger' ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            )}
          </svg>
        </div>

        <h2 id="transient-notice-title" className="mt-5 text-xl font-extrabold tracking-tight text-neutral-950 dark:text-white">{notice.title}</h2>

        <p id="transient-notice-description" className="mx-auto mt-2 max-w-xs text-sm leading-6 text-neutral-600 dark:text-zinc-300">{notice.description}</p>

        {isTransferRefund ? (
          <div className="mt-6 w-full">
            <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-left dark:border-zinc-700 dark:bg-zinc-800">
              <p className="text-sm font-semibold leading-relaxed text-neutral-800 dark:text-zinc-100">
                Tu pago fue por transferencia. Serás contactado para coordinar la devolución.
              </p>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-neutral-500 dark:text-zinc-400">
              Nuestro equipo de soporte revisará tu pedido y se pondrá en contacto contigo y con el restaurante para procesar el reembolso.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-5 min-h-12 w-full rounded-2xl bg-red-700 px-5 py-3 text-sm font-bold text-white transition hover:bg-red-800 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
            >
              Entendido
            </button>
          </div>
        ) : (
          notice.requiresAcknowledgement && (
            <button
              type="button"
              onClick={onClose}
              className="mt-6 min-h-12 w-full rounded-2xl bg-red-700 px-5 py-3 text-sm font-bold text-white transition hover:bg-red-800 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
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
  return formatSharedCurrency(toMoney(amount), 'MXN', 'es-MX');
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
// ── Horario de atención (modal del chip "Estado") ──────────────────────────
// Los helpers viven en `lib/operatingHours`; solo se importan y consumen aquí.

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

function getCheckoutValidationMessage(
  checkoutForm: CheckoutForm,
  cart: CartItem[],
  selectedRestaurant: PublicRestaurantDetail | null,
  token: string,
  fulfillmentType: 'DELIVERY' | 'PICKUP',
  hasCardReward: boolean,
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

  const acceptedMethods = getAcceptedPaymentMethods(selectedRestaurant);
  if (!acceptedMethods.includes(checkoutForm.paymentMethod)) {
    return checkoutForm.paymentMethod === 'CREDIT_CARD'
      ? 'Este restaurante no acepta pagos con tarjeta. Selecciona efectivo.'
      : 'Este restaurante no acepta pagos en efectivo.';
  }
  // Con tarjeta no se descuentan cupones ni recompensas: bloqueamos aquí para
  // que el total mostrado siempre coincida con el importe cobrado.
  if (checkoutForm.paymentMethod === 'CREDIT_CARD' && hasCardReward) {
    return 'Los cupones y recompensas solo están disponibles con efectivo. Quítalos para pagar con tarjeta.';
  }

  if (
    fulfillmentType !== 'PICKUP' &&
    (!checkoutForm.street.trim() ||
      !checkoutForm.number.trim() ||
      !checkoutForm.neighborhood.trim())
  ) {
    return 'Completa la dirección de entrega para continuar.';
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

async function handleSelectSuggestion(
  suggestion: any,
  setCheckoutForm: any,
  setAddressSearchQuery: any,
  setAddressSuggestions: any,
  setNewAddressStep: any
) {
  if (!suggestion.place_id) return;

  try {
    const place = await fetchSelectedPlaceFields(suggestion, ['addressComponents', 'location', 'formattedAddress']);
    if (!place.location) throw new Error('Place has no location');
    const components = place.addressComponents || [];
    const getComponent = (type: string) => components.find((c: any) => c.types?.includes(type))?.longText || '';
    const houseNumber = getComponent('street_number');
    const street = getComponent('route');
    const neighborhood = getComponent('sublocality') || getComponent('neighborhood');
    const city = getComponent('locality');
    const state = getComponent('administrative_area_level_1');
    const zipCode = getComponent('postal_code');
    const lat = place.location.lat();
    const lng = place.location.lng();

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
    
    setAddressSearchQuery(place.formattedAddress || suggestion.name);
    setAddressSuggestions([]);
    setNewAddressStep('details');
  } catch {
    console.error('Could not load selected Places result.');
  }
}

function buildRestaurantInitials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');
}

/** Etiqueta única para pedidos nuevos e históricos (TRANSFER solo historia). */
function formatPaymentMethodLabel(method: string): string {
  if (method === 'CASH') return 'Efectivo';
  if (method === 'CREDIT_CARD' || method === 'CARD') return 'Tarjeta';
  if (method === 'TRANSFER') return 'Transferencia';
  return method;
}

function getAcceptedPaymentMethods(restaurant: PublicRestaurantDetail | null): string[] {
  if (restaurant?.acceptedPaymentMethods) {
    return restaurant.acceptedPaymentMethods.filter(method => method === 'CASH' || method === 'CREDIT_CARD');
  }
  // Fallback para datos viejos en caché: derivar del estado actual.
  const methods: string[] = [];
  if (restaurant?.acceptsCash !== false) methods.push('CASH');
  if (restaurant?.acceptsCard === true) methods.push('CREDIT_CARD');
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
