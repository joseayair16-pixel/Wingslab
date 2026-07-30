'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Script from 'next/script';
import { AuthUser, readStoredSession, requestJson, uploadMediaAsset, convertImageFileToDataUrl, getOrderStatusLabel, isRestaurant, getBusinessArticleCapitalized, getBusinessRef, ApiRequestError } from '@sadel/shared';
import { io } from 'socket.io-client';
import LiveTrackingMap from '../../../components/LiveTrackingMap';
import { AuthModal } from '../../../components/AuthModal';
import { SaDelLogo } from '../../../components/SaDelLogo';
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
  serviceFee?: number | null;
  deliveryFee?: number | null;
  effectiveDeliveryFee?: number | null;
  deliveryRadius?: number | null;
  minDeliveryTime: number;
  maxDeliveryTime: number;
  latitude?: number;
  longitude?: number;
  transferBankName?: string | null;
  transferAccountNumber?: string | null;
  transferBeneficiaryName?: string | null;
  rating?: number;
  reviewCount?: number;
  instagram?: string | null;
  facebook?: string | null;
  tiktok?: string | null;
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
        preparationTime: number;
        discountPrice?: number | null;
        isAdultOnly?: boolean;
        optionGroups?: ProductOptionGroup[];
      }>;
  }>;
};

import { usePushNotifications } from '../../../hooks/usePushNotifications';
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
  paymentMethod: PaymentMethod;
  paymentStatus: string;
  estimatedDeliveryTime: string;
  etaExtendedMinutes?: number;
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
  cancelledBy?: string | null;
  fulfillmentType?: 'DELIVERY' | 'PICKUP';
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
      c.products.filter((p) => p.discountPrice != null)
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

  const customerAudioContextRef = useRef<AudioContext | null>(null);
  const customerAudioBufferRef = useRef<AudioBuffer | null>(null);
  const customerLlegueBufferRef = useRef<AudioBuffer | null>(null);
  const chatMessageBufferRef = useRef<AudioBuffer | null>(null);

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

  const playCustomerAlertAudio = useCallback(() => {
    try {
      if (typeof window === 'undefined') return;
      if (window.localStorage.getItem('customerAlertSoundEnabled') === 'false') return;

      // HTML5 Audio fallback
      const audioEl = document.getElementById('customer-alert-audio') as HTMLAudioElement | null;
      if (audioEl) {
        audioEl.currentTime = 0;
        audioEl.play().catch(() => {});
      }

      // Web Audio API playing (extremely robust)
      const context = customerAudioContextRef.current;
      const buffer = customerAudioBufferRef.current;
      if (context && buffer) {
        if (context.state === 'suspended') {
          context.resume().catch(() => {});
        }
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        source.start(0);
      }
    } catch (err) {
      console.error('Error reproducing customer audio alert:', err);
    }
  }, []);

  const playChatMessageSound = useCallback(() => {
    try {
      if (typeof window === 'undefined') return;
      if (window.localStorage.getItem('customerAlertSoundEnabled') === 'false') return;

      const audioEl = document.getElementById('chat-message-audio') as HTMLAudioElement | null;
      if (audioEl) {
        audioEl.currentTime = 0;
        audioEl.volume = 1.0;
        audioEl.play().catch(() => {});
      }

      const context = customerAudioContextRef.current;
      const buffer = chatMessageBufferRef.current;
      if (context && buffer) {
        if (context.state === 'suspended') {
          context.resume().catch(() => {});
        }
        const source = context.createBufferSource();
        source.buffer = buffer;
        const gain = context.createGain();
        gain.gain.value = 1.0;
        source.connect(gain);
        gain.connect(context.destination);
        source.start(0);
      }
    } catch (err) {
      console.error('Error reproducing chat message sound:', err);
    }
  }, []);

  const playCustomerLlegueSound = useCallback(() => {
    try {
      if (typeof window === 'undefined') return;
      if (window.localStorage.getItem('customerAlertSoundEnabled') === 'false') return;

      const audioEl = document.getElementById('customer-llegue-audio') as HTMLAudioElement | null;
      if (audioEl) {
        audioEl.currentTime = 0;
        audioEl.volume = 1.0;
        audioEl.play().catch(() => {});
      }

      const context = customerAudioContextRef.current;
      const buffer = customerLlegueBufferRef.current;
      if (context && buffer) {
        if (context.state === 'suspended') {
          context.resume().catch(() => {});
        }
        const source = context.createBufferSource();
        source.buffer = buffer;
        const gain = context.createGain();
        gain.gain.value = 1.0;
        source.connect(gain);
        gain.connect(context.destination);
        source.start(0);
      }
    } catch (err) {
      console.error('Error reproducing llegue sound:', err);
    }
  }, []);

  useEffect(() => {
    const handleGlobalInteraction = () => {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass && !customerAudioContextRef.current) {
        const context = new AudioContextClass();
        customerAudioContextRef.current = context;

        fetch('/sounds/notifica.wav')
          .then((res) => res.arrayBuffer())
          .then((arr) => context.decodeAudioData(arr))
          .then((buf) => {
            customerAudioBufferRef.current = buf;
            if (process.env.NODE_ENV !== 'production') {
              console.log('[Web Audio API] notifica.wav loaded and decoded successfully.');
            }
          })
          .catch((err) => {
            console.error('[Web Audio API] Failed to load/decode notifica.wav:', err);
          });

        fetch('/sounds/mensaje.wav')
          .then((res) => res.arrayBuffer())
          .then((arr) => context.decodeAudioData(arr))
          .then((buf) => {
            chatMessageBufferRef.current = buf;
            if (process.env.NODE_ENV !== 'production') {
              console.log('[Web Audio API] mensaje.wav loaded and decoded successfully.');
            }
          })
          .catch((err) => {
            console.error('[Web Audio API] Failed to load/decode mensaje.wav:', err);
          });

        fetch('/sounds/llegue.wav')
          .then((res) => res.arrayBuffer())
          .then((arr) => context.decodeAudioData(arr))
          .then((buf) => {
            customerLlegueBufferRef.current = buf;
            if (process.env.NODE_ENV !== 'production') {
              console.log('[Web Audio API] llegue.wav loaded and decoded successfully.');
            }
          })
          .catch((err) => {
            console.error('[Web Audio API] Failed to load/decode llegue.wav:', err);
          });
      } else if (customerAudioContextRef.current && customerAudioContextRef.current.state === 'suspended') {
        customerAudioContextRef.current.resume().catch(() => {});
      }

      // Silent unlock: play an inaudible oscillator to prime the audio engine
      // without playing any actual .wav files (avoids spurious notification sounds on iOS)
      if (customerAudioContextRef.current) {
        try {
          const ctx = customerAudioContextRef.current;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          gain.gain.value = 0;
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 0.05);
        } catch (e) {
          // ignore
        }
      }
    };
    document.addEventListener('pointerdown', handleGlobalInteraction, { once: true, passive: true });
    document.addEventListener('keydown', handleGlobalInteraction, { once: true, passive: true });

    return () => {
      document.removeEventListener('pointerdown', handleGlobalInteraction);
      document.removeEventListener('keydown', handleGlobalInteraction);
    };
  }, []);


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

  const cartStore = useCartStore();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const cart: CartItem[] = mounted && cartStore.restaurantId === params.restaurantId ? cartStore.items : [];
  const [checkoutForm, setCheckoutForm] = useState<CheckoutForm>(defaultCheckoutForm);
  const [loadingRestaurant, setLoadingRestaurant] = useState(true);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [cartJustUpdated, setCartJustUpdated] = useState(false);
  const [transferProofName, setTransferProofName] = useState('');
  const [transferProofSource, setTransferProofSource] = useState('');
  const [error, setError] = useState('');
  const [deliveryErrorModal, setDeliveryErrorModal] = useState('');
  const [fulfillmentType, setFulfillmentType] = useState<'DELIVERY' | 'PICKUP'>(
    searchParams?.fulfillment === 'PICKUP' ? 'PICKUP' : 'DELIVERY'
  );

  useEffect(() => {
    if (searchParams?.checkout === 'true') {
      setIsCheckoutOpen(true);
    }
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
    const timer = setTimeout(() => {
      const el = document.getElementById(productId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('ring-2', 'ring-sky-400', 'ring-offset-2', 'rounded-[28px]');
        setTimeout(() => el.classList.remove('ring-2', 'ring-sky-400', 'ring-offset-2'), 2500);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [searchParams, restaurant]);

  const [transientNotice, setTransientNotice] = useState<TransientNotice | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [isRatingModalOpen, setIsRatingModalOpen] = useState(false);
  const [orderToRate, setOrderToRate] = useState<string | null>(null);
  const [ratingBusinessType, setRatingBusinessType] = useState<string | null>(null);
  const [ratingIsPickup, setRatingIsPickup] = useState(false);
  const [restaurantRating, setRestaurantRating] = useState(0);
  const [driverRatingVal, setDriverRatingVal] = useState(0);
  const [ratingComment, setRatingComment] = useState('');
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const touchStartY = useRef(0);
  const [addresses, setAddresses] = useState<any[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [isAddingNewAddress, setIsAddingNewAddress] = useState(false);
  const [newAddressStep, setNewAddressStep] = useState<'search' | 'details'>('search');
  const [addressSearchQuery, setAddressSearchQuery] = useState('');
  const [addressSuggestions, setAddressSuggestions] = useState<any[]>([]);
  const [isSearchingAddress, setIsSearchingAddress] = useState(false);
  const cartRef = useRef<HTMLDivElement | null>(null);
  const checkoutRef = useRef<HTMLDivElement | null>(null);
  const checkoutMapRef = useRef<any>(null);
  const checkoutMarkerRef = useRef<any>(null);
  const categorySectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const transientNoticeTimeoutRef = useRef<number | null>(null);
  const recentNoticeKeysRef = useRef<string[]>([]);
  const lastActiveOrderStatusRef = useRef<string>('');
  const recentCreatedOrderRef = useRef<{ id: string; orderReference: string; paymentMethod?: string } | null>(null);
  const creatingOrderRef = useRef(false);

  // Estados para Modal de Repartidor Llegó
  const [isDriverArrivedModalOpen, setIsDriverArrivedModalOpen] = useState(false);
  const [arrivedOrder, setArrivedOrder] = useState<CustomerOrderDetail | null>(null);
  const [pickupReadyOrder, setPickupReadyOrder] = useState<CustomerOrderDetail | null>(null);
  const [copiedField, setCopiedField] = useState<'account' | 'beneficiary' | 'amount' | null>(null);

  // Image preview modal for store products
  const [previewProduct, setPreviewProduct] = useState<{
    images: string[];
    name: string;
    description: string;
    price: number;
    discountPrice?: number | null;
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

  const handleCopyText = (text: string | undefined | null, field: 'account' | 'beneficiary' | 'amount') => {
    if (!text) return;
    void navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => {
      setCopiedField(null);
    }, 1500);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
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
      void requestJson<{ success: true; data: PublicRestaurantDetail }>({
        apiBase,
        path: `/restaurantes/${params.restaurantId}${getUserLocationQuery()}`,
        fallbackMessage: 'No se pudo cargar el menu del restaurante.',
      }).then((payload) => {
        setRawRestaurant(payload.data);
        setIsRefreshing(false);
        setPullDistance(0);
      }).catch(() => {
        setIsRefreshing(false);
        setPullDistance(0);
      });
    } else {
      setPullDistance(0);
    }
    touchStartY.current = 0;
  };

  const deliveryPreset = useMemo(
    () => getDeliveryPreset(sessionUser?.region || restaurant?.region),
    [restaurant?.region, sessionUser?.region]
  );

  useEffect(() => {
    try {
      const savedSession = readStoredSession(storageKey);

      if (typeof window !== 'undefined' && window.localStorage) {
        const isDark = window.localStorage.getItem('darkMode') === 'true';
        if (isDark) {
          document.documentElement.classList.add('dark');
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
            const { notes, storeNotes, ...safeParsed } = parsed;
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
        }).catch(() => {});
      }

      setIsAuthReady(true);
    } catch (e) {
      console.error('Error during restaurant customer session initialization:', e);
      setIsAuthReady(true);
    }
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
  }, [apiBase, params.restaurantId]);

  useEffect(() => {
    if (!token || sessionUser?.role !== 'CUSTOMER') {
      setActiveOrderListItems([]);
      setActiveOrderDetailsMap({});
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
            showTransientNotice({
              key: `restaurant-recent-order-cancelled:${recentCreatedOrder.id}`,
              title: 'Pedido cancelado',
              description: `Tu pedido ${recentCreatedOrder.orderReference} fue cancelado.`,
              tone: 'danger',
            });
            recentCreatedOrderRef.current = null;
          }
        }

        // Check if there is any delivered order that has not been rated and not dismissed
        const unratedOrder = ordersPayload.data.items.find(
          (order) =>
            normalizeOrderStatusValue(order.status) === 'DELIVERED' &&
            !order.review &&
            !localStorage.getItem(`sadel_dismissed_rating_${order.id}`)
        );
        if (unratedOrder) {
          setOrderToRate(unratedOrder.id);
          setRatingBusinessType((unratedOrder as any).restaurant?.businessType || null);
          setRatingIsPickup(false);
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

    return () => {
      cancelled = true;
      window.removeEventListener('order-updated', handleUpdate);
    };
  }, [apiBase, sessionUser?.role, token]);

  useEffect(() => {
    if (!token || !sessionUser || sessionUser.role !== 'CUSTOMER') {
      return;
    }

    const socket = io('https://sadel-production.up.railway.app', {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
    });

    socket.on('connect', () => {
      socket.emit('join-room', sessionUser.id, 'CUSTOMER');
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
          setOrderToRate(payload.orderId);
          const order = activeOrderDetailsMapRef.current[payload.orderId];
          setRatingBusinessType(order?.restaurant?.businessType || null);
          setRatingIsPickup(false);
          setIsRatingModalOpen(true);
        }

        if (eventName === 'order:completed' && payload.orderId) {
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
          if (process.env.NODE_ENV !== 'production') {
            console.log(`[Socket.io] [Restaurante] Cargando detalles de pedido para ID de llegada: ${payload.orderId}`);
          }
          requestJson<{ success: true; data: CustomerOrderDetail }>({
            apiBase,
            path: `/me/pedidos/${payload.orderId}`,
            token,
            fallbackMessage: 'No se pudo cargar el detalle del pedido.',
          }).then((res) => {
            if (process.env.NODE_ENV !== 'production') {
              console.log(`[Socket.io] [Restaurante] Detalle cargado con éxito para modal de llegada:`, res.data);
            }
            setArrivedOrder(res.data);
            setIsDriverArrivedModalOpen(true);
          }).catch((err) => {
            if (process.env.NODE_ENV !== 'production') {
              console.error(`[Socket.io] [Restaurante] Error al obtener detalles de pedido en llegada:`, err);
            }
          });
        }

        if (eventName === 'order:cancellation-approved') {
          try {
            if (window.localStorage.getItem('customerAlertSoundEnabled') !== 'false') {
              void playCustomerAlertAudio();
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
              void playCustomerAlertAudio();
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

        if (
          ['order:ready', 'order:driver_arrived', 'order:driver-arrived', 'order:delivered'].includes(eventName)
        ) {
          try {
            if (window.localStorage.getItem('customerAlertSoundEnabled') !== 'false') {
              void playCustomerLlegueSound();
            }
          } catch (e) {}
        }

        if (
          ['order:rejected', 'order:cancellation-approved', 'order:cancellation-rejected'].includes(eventName) ||
          eventName === 'order:in-transit' ||
          eventName === 'order:eta-updated'
        ) {
          try {
            if (window.localStorage.getItem('customerAlertSoundEnabled') !== 'false') {
              void playCustomerAlertAudio();
            }
          } catch (e) {}
        }

        if (eventName === 'order_chat:message_received') {
          if (window.localStorage.getItem('customerAlertSoundEnabled') !== 'false') {
            void playChatMessageSound();
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
    };
  }, [apiBase, sessionUser, token]);

  useEffect(() => {
    if (!isCartOpen || showMaxCashModal || showGpsCashModal || deliveryErrorModal || isPushReminderModalOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!cartRef.current?.contains(event.target as Node)) {
        setIsCartOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [isCartOpen, showMaxCashModal, showGpsCashModal, deliveryErrorModal, isPushReminderModalOpen]);

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
    if (!isCheckoutOpen || (isAddingNewAddress && newAddressStep === 'search')) {
      return;
    }

    const timer = setTimeout(() => {
      const google = (window as any).google;
      if (!google || !google.maps) {
        console.warn("Google Maps not loaded");
        return;
      }

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
    }, 150);

    return () => clearTimeout(timer);
  }, [isCheckoutOpen, isAddingNewAddress, newAddressStep, checkoutForm.latitude, checkoutForm.longitude]);

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
      const discountPrice = item.discountPrice ? toMoney(item.discountPrice) : price;
      return sum + (price - discountPrice) * Math.max(0, item.quantity);
    }, 0),
    [cart]
  );
  const serviceFee = toMoney(restaurant?.serviceFee);
  const estimatedDeliveryFee = toMoney(restaurant?.effectiveDeliveryFee);
  const orderTotal = Math.max(0, cartSubtotal - discountAmount + serviceFee + (fulfillmentType === 'PICKUP' ? 0 : estimatedDeliveryFee));
  const checkoutValidationMessage = useMemo(() => {
    return getCheckoutValidationMessage(checkoutForm, cart, restaurant, token, Boolean(transferProofSource));
  }, [cart, checkoutForm, restaurant, token, transferProofSource]);

  const distanceKm = useMemo(() => {
    if (!restaurant || !restaurant.latitude || !restaurant.longitude) return null;
    
    if (typeof (restaurant as any).distanceKm === 'number') {
      return (restaurant as any).distanceKm;
    }
    
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

function triggerHaptic(pattern: number | number[] = 10) {
  if (typeof window !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(pattern);
  }
}

  function addToCart(product: PublicRestaurantDetail['categories'][number]['products'][number]) {
    const hasOptions = product.optionGroups && product.optionGroups.length > 0;
    const isWeightProduct = product.sellBy === 'WEIGHT';
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

    cartStore.addItem({
      cartItemId: product.id,
      productId: product.id,
      name: product.name,
      price: product.price,
      discountPrice: (product as any).discountPrice,
      image: product.image,
      quantity: 1,
      specialInstructions: '',
      selectedOptions: [],
      sellBy: 'UNIT',
    }, params.restaurantId as string, restaurant?.serviceFee || 0, restaurant?.effectiveDeliveryFee || 0);
    setCartJustUpdated(true);
    triggerHaptic(15); // Small vibration
  }

  function decreaseQuantityForProduct(productId: string) {
    cartStore.decreaseQuantity(productId);
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

    cartStore.addItem({
      cartItemId,
      productId: customizingProduct.id,
      name: customizingProduct.name,
      price: itemPrice,
      discountPrice: customizingProduct.discountPrice,
      image: customizingProduct.image,
      quantity: 1,
      specialInstructions: customizingInstructions,
      selectedOptions: flatSelectedOptions as any,
      sellBy: customizingProduct.sellBy || 'UNIT',
      weightG: isWeightProduct ? customizingWeight : null,
      unitPrice: isWeightProduct ? customizingProduct.unitPrice : null,
    }, params.restaurantId as string, restaurant?.serviceFee || 0, restaurant?.effectiveDeliveryFee || 0);

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

    setIsSearchingAddress(true);
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
            const google = (window as any).google;
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
          setIsSearchingAddress(false);
        }
      },
      (err) => {
        console.error('Error getting geolocation:', err);
        setIsSearchingAddress(false);
        setError('No pudimos acceder a tu ubicación. Por favor busca tu dirección manualmente.');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function updateCartItem(
    cartItemId: string,
    patch: Partial<Pick<CartItem, 'quantity' | 'specialInstructions'>>
  ) {
    cartStore.updateItem(cartItemId, patch);
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
      if (position.coords.accuracy > 100) {
        try {
          position = await waitForPosition(true, 15_000);
        } catch { }
      }
    } catch {
      try {
        position = await waitForPosition(true, 15_000);
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

      // 3. Límite de Monto para Pago en Efectivo
      const MAX_CASH_AMOUNT = 500; // Limit for cash orders
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
        if (currentLocation) {
          body.currentLocation = currentLocation;
        }
      }

      const payload = await requestJson<{ success: true; data: { id: string; orderReference: string } }>({
        apiBase,
        path: '/pedidos',
        token,
        options: {
          method: 'POST',
          headers: fulfillmentType !== 'PICKUP' && currentLocation ? { 'X-Location-Verified': '1' } : undefined,
          body: JSON.stringify(body),
        },
        fallbackMessage: 'No se pudo crear el pedido.',
      });

      setCheckoutForm(normalizedCheckoutForm);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(profileAddressStorageKey, JSON.stringify(normalizedCheckoutForm));
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

      cartStore.clearCart();
      setCheckoutForm((prev) => ({ ...prev, notes: '', storeNotes: '' }));
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
      className="min-h-[100dvh] bg-[#fafafa] text-neutral-900 transition-colors duration-500"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <Script
        src={`https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''}&libraries=places&loading=async`}
        strategy="lazyOnload"
      />
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
        <header className="border-b border-black/5 bg-white dark:bg-neutral-950 sticky top-0 z-40 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
          <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-4 md:px-6">
            <button
              type="button"
              onClick={() => router.push('/')}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border transition-all border-black/10 bg-white text-neutral-800 shadow-sm hover:bg-neutral-50 dark:bg-neutral-900 dark:border-white/10 dark:text-neutral-200"
              aria-label="Volver al inicio"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
              </svg>
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
                  <p className="truncate text-[8px] font-bold uppercase tracking-[0.26em] text-neutral-400 dark:text-neutral-500 md:text-[9px] mt-0.5 leading-none">
                    Un click de distancia
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
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
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
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              )}

              {/* Contenedor del Banner */}
              <div className="transition-all duration-300">
                {activeOrder && (
                  <CompactActiveOrderBanner
                    order={activeOrder}
                    carouselLabel={activeOrderListItems.length > 1 ? `Pedido ${carouselIndex + 1} de ${activeOrderListItems.length}` : undefined}
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
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                  </svg>
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
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
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
                                  : 'bg-accent-soft dark:bg-sky-900/30 text-accent-hover dark:text-sky-400'
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
                                    ? 'border-sky-500/30 bg-accent-soft/40 dark:bg-sky-900/10'
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
                                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                        </svg>
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
                                  ? 'border-sky-400 bg-sky-50 text-sky-700'
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
              <div className="border-t border-black/5 dark:border-zinc-800 bg-white/95 dark:bg-neutral-900/95 backdrop-blur px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4 sticky bottom-0 z-10">
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
                    onClick={() => setCustomizingQuantity(q => q + 1)}
                    className="flex h-9 w-9 items-center justify-center rounded-full text-lg text-neutral-700 dark:text-neutral-300 transition hover:bg-neutral-200 dark:hover:bg-neutral-800"
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
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6" onClick={(e) => e.stopPropagation()}>
            <div className="bg-white rounded-2xl border border-black/[0.03] shadow-[0_4px_24px_rgba(0,0,0,0.08)] p-6 w-full max-w-md h-fit max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-3xl">{isPickupRating ? '🛍️' : '🎉'}</span>
                </div>
                <h3 className="text-2xl font-semibold text-neutral-950">{isPickupRating ? '¡Pedido recogido!' : '¡Tu pedido ha llegado!'}</h3>
                <p className="text-sm text-neutral-500">{isPickupRating ? 'Gracias por tu compra. ¿Nos ayudas a mejorar calificando tu experiencia?' : (bizType && bizType !== 'RESTAURANT' ? '¡Disfruta tu pedido! ¿Nos ayudas a mejorar calificando tu experiencia?' : '¡Buen provecho! ¿Nos ayudas a mejorar calificando tu experiencia?')}</p>
              </div>

              <div className="space-y-6">
                {/* Calificación Restaurante */}
                <div>
                  <label className="text-sm font-medium text-neutral-700 block mb-2 text-center">{bizType && bizType !== 'RESTAURANT' ? '¿Qué tal estuvo tu pedido?' : '¿Qué tal estuvo la comida?'}</label>
                  <div className="flex gap-2 justify-center">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setRestaurantRating(star)}
                        className={`text-3xl transition ${
                          restaurantRating >= star ? 'text-amber-400' : 'text-neutral-200'
                        }`}
                      >
                        ★
                      </button>
                    ))}
                  </div>
                </div>

                {/* Calificación Repartidor (solo delivery) */}
                {!isPickupRating && (
                <div>
                  <label className="text-sm font-medium text-neutral-700 block mb-2 text-center">¿Qué tal el servicio de entrega?</label>
                  <div className="flex gap-2 justify-center">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setDriverRatingVal(star)}
                        className={`text-3xl transition ${
                          driverRatingVal >= star ? 'text-amber-400' : 'text-neutral-200'
                        }`}
                      >
                        ★
                      </button>
                    ))}
                  </div>
                </div>
                )}

                {/* Comentarios */}
                <div>
                  <label htmlFor="rating-comment" className="text-sm font-medium text-neutral-700 block mb-2">
                    ¿Algo que quieras agregar?
                  </label>
                  <textarea
                    id="rating-comment"
                    value={ratingComment}
                    onChange={(e) => setRatingComment(e.target.value)}
                    placeholder={bizType && bizType !== 'RESTAURANT' ? 'Cuéntanos qué tal estuvo tu pedido o el servicio...' : 'Cuéntanos qué tal estuvo la comida o el servicio...'}
                    className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-neutral-950 outline-none transition focus:border-emerald-300 min-h-[80px] text-sm"
                  />
                </div>

                {/* Botones */}
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      if (orderToRate) {
                        try {
                          localStorage.setItem(`sadel_dismissed_rating_${orderToRate}`, 'true');
                        } catch (e) {}
                      }
                      setIsRatingModalOpen(false);
                      setRestaurantRating(0);
                      setDriverRatingVal(0);
                      setRatingComment('');
                      setRatingIsPickup(false);
                      setOrderToRate(null);
                    }}
                    className="flex-1 rounded-full bg-neutral-50 text-sm font-semibold text-neutral-600 py-3 transition hover:bg-neutral-100"
                  >
                    Saltar
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!orderToRate) return;
                      try {
                        const response = await fetch(`${apiBase}/customer/pedidos/${orderToRate}/review`, {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            authorization: `Bearer ${token}`,
                          },
                          body: JSON.stringify({
                            rating: restaurantRating,
                            driverRating: isPickupRating ? null : (driverRatingVal || null),
                            comment: ratingComment || '',
                          }),
                        });
                        if (response.ok) {
                          showTransientNotice({ key: 'rating-submitted', title: '¡Gracias!', description: 'Tu calificación nos ayuda a mejorar.', tone: 'success' });
                        } else {
                          showTransientNotice({ key: 'rating-error', title: 'Error', description: 'No se pudo guardar tu calificación.', tone: 'danger' });
                        }
                      } catch (e) {
                        showTransientNotice({ key: 'rating-error', title: 'Error', description: 'No se pudo conectar con el servidor.', tone: 'danger' });
                      }
                      setIsRatingModalOpen(false);
                      setRestaurantRating(0);
                      setDriverRatingVal(0);
                      setRatingComment('');
                      setRatingIsPickup(false);
                      setOrderToRate(null);
                    }}
                    disabled={restaurantRating === 0}
                    className="flex-1 rounded-full bg-emerald-600 text-sm font-semibold text-white py-3 transition hover:bg-emerald-500 disabled:bg-emerald-200 disabled:cursor-not-allowed"
                  >
                    Enviar calificación
                  </button>
                </div>
              </div>
            </div>
          </div>
          );
        })()}

        {/* Modal de Repartidor Llegó */}
        {isDriverArrivedModalOpen && arrivedOrder && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm px-4 py-6" onClick={() => setIsDriverArrivedModalOpen(false)}>
            <div 
              className="bg-white dark:bg-[#121214] rounded-3xl border border-black/[0.03] dark:border-zinc-800/80 shadow-[0_20px_50px_rgba(0,0,0,0.15)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.4)] p-7 w-full max-w-md h-fit max-h-[90vh] overflow-y-auto relative transition-all" 
              onClick={(e) => e.stopPropagation()}
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-sky-1000/10 to-transparent dark:from-sky-1000/15 rounded-full blur-3xl pointer-events-none"></div>
              
              <div className="text-center mb-6">
                <div className="w-20 h-20 bg-accent-soft dark:bg-sky-900/30 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-sky-100 dark:border-sky-800/20 shadow-inner">
                  <span className="text-4xl animate-bounce">🛵</span>
                </div>
                <h3 className="text-2xl font-black text-neutral-950 dark:text-white tracking-tight">¡Tu repartidor ha llegado!</h3>
                <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">El repartidor ya está afuera de tu domicilio con tu pedido.</p>
              </div>

              <div className="space-y-4">
                {/* Total a pagar */}
                <div className="p-5 rounded-2xl bg-amber-50/40 dark:bg-amber-950/10 border border-amber-100/50 dark:border-amber-900/20">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-[10px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                        {arrivedOrder.paymentMethod === 'CASH' ? 'Total a pagar' : 'Total del pedido'}
                      </p>
                      <p className="text-3xl font-black text-neutral-900 dark:text-white mt-1">
                        {formatCurrency(arrivedOrder.totalAmount)}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                        arrivedOrder.paymentMethod === 'CASH'
                          ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40'
                          : arrivedOrder.paymentMethod === 'TRANSFER'
                            ? 'bg-sky-100 dark:bg-sky-900/30 text-sky-800 dark:text-sky-400 border border-sky-200 dark:border-sky-800/40'
                            : 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400 border border-green-200 dark:border-green-800/40'
                      }`}>
                        {arrivedOrder.paymentMethod === 'CASH' ? '💵 Efectivo' : arrivedOrder.paymentMethod === 'TRANSFER' ? '🏦 Transferencia' : '💳 Pago Online'}
                      </span>
                      <p className="text-[10px] text-neutral-400 dark:text-neutral-500 mt-1.5 font-medium">
                        {arrivedOrder.paymentMethod === 'CASH' ? 'Prepara el efectivo exacto' : 'Ya pagado vía app'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* deliveryPin (handoverPin como fallback) */}
                {(arrivedOrder.deliveryPin || arrivedOrder.handoverPin) && (
                  <div className="p-5 rounded-2xl bg-indigo-50/50 dark:bg-indigo-950/15 border border-indigo-100/50 dark:border-indigo-900/30 text-center">
                    <p className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-widest">Código de entrega</p>
                    <p className="text-4xl font-extrabold tracking-[0.25em] text-indigo-950 dark:text-indigo-200 font-mono mt-2 mb-1.5 pl-[0.25em]">
                      {arrivedOrder.deliveryPin || arrivedOrder.handoverPin}
                    </p>
                    <p className="text-[11px] text-neutral-500 dark:text-neutral-400 leading-relaxed">
                      Proporciona este código al repartidor para confirmar la entrega.
                    </p>
                  </div>
                )}
              </div>

              {/* Botón de cierre */}
              <div className="mt-6 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsDriverArrivedModalOpen(false)}
                  className="flex-1 rounded-full bg-neutral-950 dark:bg-white text-white dark:text-neutral-950 py-3.5 text-sm font-bold shadow-md transition hover:bg-neutral-800 dark:hover:bg-neutral-100 active:scale-95 active-scale"
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
                  <span className="text-4xl">🛍️</span>
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
                            ? 'bg-sky-100 text-sky-800 border border-sky-200'
                            : 'bg-green-100 text-green-800 border border-green-200'
                      }`}>
                        {pickupReadyOrder.paymentMethod === 'CASH' ? '💵 Efectivo' : pickupReadyOrder.paymentMethod === 'TRANSFER' ? '🏦 Transferencia' : '💳 Pago Online'}
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
                    className="w-full flex items-center justify-center gap-2.5 rounded-full border-2 border-sky-200 bg-sky-50 py-3.5 text-sm font-bold text-sky-700 shadow-sm transition hover:bg-sky-100 hover:shadow-md active:scale-[0.97]"
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

      {isCartOpen ? (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={() => setIsCartOpen(false)} />
          <div
            ref={cartRef}
            className="absolute right-0 top-0 flex h-full w-full max-w-[520px] flex-col overflow-hidden bg-white/95 backdrop-blur-3xl shadow-[0_0_0_1px_rgba(0,0,0,0.04),0_40px_100px_rgba(15,15,15,0.25)] sm:rounded-l-[36px]"
            style={{ animation: 'slideInRight 0.35s cubic-bezier(0.16,1,0.3,1)' }}
          >
              {/* ── Header ── */}
              <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-black/[0.04] bg-white px-5 py-4 sm:px-6">
                <div className="flex items-center gap-3.5">
                  <div className="relative flex h-12 w-12 items-center justify-center rounded-[18px] bg-gradient-to-br from-neutral-900 to-neutral-700 text-white shadow-lg shadow-neutral-900/20">
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 4h2l.4 2M7 14h10l4-8H5.4M7 14l-1.5 2.5A1 1 0 006.4 18H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    {totalProducts > 0 && !isCartOpen && (
                      <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white shadow-md shadow-accent/30">
                        {totalProducts}
                      </span>
                    )}
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-neutral-400">Tu pedido</p>
                    <h2 className="text-lg font-bold tracking-[-0.03em] text-neutral-950">Carrito</h2>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCartOpen(false)}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 transition-all hover:bg-neutral-200 hover:text-neutral-700 active:scale-90"
                  aria-label="Cerrar carrito"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* ── Product List ── */}
              <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-5">
                {cart.length ? (
                  <div className="space-y-3">
                    {cart.map((item, idx) => {
                      const itemUnitPrice = (() => {
                        const base = item.discountPrice ? toMoney(item.discountPrice) : toMoney(item.price);
                        const optionsSum = (item.selectedOptions || []).reduce((s, o) => s + toMoney(o.price), 0);
                        return base + optionsSum;
                      })();
                      const lineTotal = itemUnitPrice * item.quantity;
                      const isWeightItem = item.sellBy === 'WEIGHT';

                      return (
                        <div
                          key={item.cartItemId}
                          className="group rounded-[22px] border border-black/[0.04] bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)] transition-all hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)]"
                          style={{ animation: `fadeInUp 0.3s ease-out ${idx * 0.05}s both` }}
                        >
                          <div className="flex items-start gap-3.5">
                            {/* Product Icon */}
                            {item.image ? (
                               <img src={item.image} className="h-14 w-14 shrink-0 rounded-2xl object-cover" alt={item.name} loading="lazy" decoding="async" />
                            ) : (
                              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-100 to-sky-50 text-2xl">
                                🍽️
                              </div>
                            )}
                            {/* Info */}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2">
                                <p className="font-semibold leading-snug text-neutral-900">{item.name}</p>
                                <span className="shrink-0 rounded-lg bg-neutral-900 px-2.5 py-1 text-xs font-bold text-white shadow-sm">
                                  {formatCurrency(lineTotal)}
                                </span>
                              </div>
                              {item.selectedOptions && item.selectedOptions.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {item.selectedOptions.map((opt) => (
                                    <span
                                      key={opt.id}
                                      className="inline-flex items-center rounded-full bg-accent-soft px-2.5 py-0.5 text-[11px] font-medium text-accent-hover"
                                    >
                                      {opt.name} {opt.price > 0 ? `+${formatCurrency(opt.price)}` : ''}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {isWeightItem && item.weightG ? (
                                <p className="mt-1.5 text-[11px] text-neutral-400">
                                  {item.weightG >= 1000 ? `${item.weightG / 1000}kg` : `${item.weightG}g`} · {formatCurrency(item.unitPrice || 0)}/kg
                                </p>
                              ) : (
                                <p className="mt-1.5 text-[11px] text-neutral-400">
                                  {formatCurrency(itemUnitPrice)} c/u
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Quantity Stepper (Full Width) */}
                          <div className="mt-3.5 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-0.5 rounded-full border border-black/[0.06] bg-neutral-50 p-0.5">
                              <button
                                type="button"
                                onClick={() => updateCartItem(item.cartItemId, { quantity: item.quantity - 1 })}
                                className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 transition-all hover:bg-white hover:text-neutral-800 hover:shadow-sm active:scale-90"
                                aria-label={`Quitar una unidad de ${item.name}`}
                              >
                                {item.quantity === 1 ? (
                                  <svg className="h-3.5 w-3.5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                ) : (
                                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20 12H4" />
                                  </svg>
                                )}
                              </button>
                              <span className="flex h-8 w-8 items-center justify-center text-xs font-bold text-neutral-900">{item.quantity}</span>
                              <button
                                type="button"
                                onClick={() => updateCartItem(item.cartItemId, { quantity: item.quantity + 1 })}
                                className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 transition-all hover:bg-white hover:text-neutral-800 hover:shadow-sm active:scale-90"
                                aria-label={`Agregar una unidad de ${item.name}`}
                              >
                                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                                </svg>
                              </button>
                            </div>

                            {/* Expand special instructions toggle area */}
                            <input
                              value={item.specialInstructions}
                              onChange={(event) => updateCartItem(item.cartItemId, { specialInstructions: event.target.value })}
                              placeholder="Nota: sin cebolla, etc."
                              className="flex-1 rounded-xl border border-transparent bg-neutral-50 px-2.5 py-1.5 text-xs text-neutral-700 outline-none transition-all placeholder:text-neutral-400 focus:border-sky-200 focus:bg-white focus:ring-2 focus:ring-sky-200/50"
                            />

                            {/* Quick Delete Trash Button */}
                            <button
                              type="button"
                              onClick={() => updateCartItem(item.cartItemId, { quantity: 0 })}
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-500 transition-all hover:bg-red-100 hover:text-red-600 active:scale-90"
                              title="Eliminar del carrito"
                            >
                              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex flex-1 items-center justify-center px-6 py-10 text-center relative overflow-hidden min-h-[320px]">
                    {/* Decorative glow */}
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 bg-sky-400/10 rounded-full blur-3xl pointer-events-none"></div>
                    
                    <div className="w-full max-w-[320px] relative z-10">
                      <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-[32px] bg-gradient-to-br from-white to-sky-50/50 shadow-[0_8px_32px_rgba(14,165,233,0.15)] border border-white">
                        <div className="absolute inset-0 rounded-[32px] border border-sky-200/30"></div>
                        <span className="text-[42px] drop-shadow-sm">🛒</span>
                      </div>
                      
                      <h3 className="mt-8 text-2xl font-black tracking-[-0.03em] text-neutral-900">Tu carrito está vacío</h3>
                      <p className="mt-2 text-[15px] font-medium leading-relaxed text-neutral-500">
                        Explora el menú y agrega productos deliciosos para comenzar tu pedido.
                      </p>
                      
                      <button
                        type="button"
                        onClick={() => setIsCartOpen(false)}
                        className="group relative mt-8 inline-flex items-center gap-2 overflow-hidden rounded-full bg-neutral-900 px-8 py-3.5 text-[15px] font-bold text-white shadow-[0_8px_20px_rgba(0,0,0,0.16)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(0,0,0,0.22)] active:scale-[0.98]"
                      >
                        <span className="relative z-10">Explorar menú</span>
                        <svg className="relative z-10 h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                        </svg>
                        <div className="absolute inset-0 bg-gradient-to-r from-neutral-800 to-neutral-900 opacity-0 transition-opacity duration-300 group-hover:opacity-100"></div>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Summary Footer ── */}
              {cart.length ? (
                <div className="sticky bottom-0 z-10 border-t border-black/[0.04] bg-white/90 px-4 pb-5 pt-4 backdrop-blur-xl sm:px-5">
                  {/* Summary Card */}
                  <div className="rounded-[24px] bg-gradient-to-b from-neutral-50 to-neutral-100/60 p-4 ring-1 ring-black/[0.04]">
                    <div className="space-y-2.5 text-[13px]">
                      <div className="flex items-center justify-between text-neutral-500">
                        <span className="flex items-center gap-1.5">
                          <span className="text-xs">📦</span> Productos
                        </span>
                        <span className="font-medium text-neutral-700">{totalProducts}</span>
                      </div>
                      <div className="flex items-center justify-between text-neutral-500">
                        <span>Subtotal</span>
                        <span className="font-medium text-neutral-700">{formatCurrency(cartSubtotal)}</span>
                      </div>
                      {discountAmount > 0 && (
                        <div className="flex items-center justify-between text-emerald-600">
                          <span className="flex items-center gap-1">
                            <span className="text-xs">🏷️</span> Descuento
                          </span>
                          <span className="font-semibold">-{formatCurrency(discountAmount)}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between text-neutral-500">
                        <span>Servicio</span>
                        <span className="font-medium text-neutral-700">{formatCurrency(serviceFee)}</span>
                      </div>
                      {fulfillmentType !== 'PICKUP' && (
                      <div className="flex items-center justify-between text-neutral-500">
                        <span className="flex items-center gap-1">
                          <span className="text-xs">🛵</span> Envío
                        </span>
                        <span className="font-medium text-neutral-700">{formatCurrency(estimatedDeliveryFee)}</span>
                      </div>
                      )}
                    </div>
                    <div className="mt-3 flex items-center justify-between rounded-2xl bg-neutral-900 px-4 py-3 shadow-lg shadow-neutral-900/15">
                      <span className="text-sm font-semibold text-neutral-300">Total a pagar</span>
                      <span className="text-lg font-extrabold tracking-tight text-white">{formatCurrency(orderTotal)}</span>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-1.5 rounded-2xl bg-neutral-100 p-1">
                    <button
                      type="button"
                      onClick={() => setFulfillmentType('DELIVERY')}
                      className={`relative flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-[11px] font-bold transition-all duration-200 ${
                        fulfillmentType === 'DELIVERY'
                          ? 'bg-sky-500 text-white shadow-md shadow-sky-500/30 scale-[1.02]'
                          : 'bg-transparent text-neutral-500 hover:text-neutral-800'
                      }`}
                    >
                      {fulfillmentType === 'DELIVERY' && (
                        <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-white shadow-sm">
                          <svg className="h-2.5 w-2.5 text-sky-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </span>
                      )}
                      <span>🛵</span> Enviar a domicilio
                    </button>
                    <button
                      type="button"
                      onClick={() => setFulfillmentType('PICKUP')}
                      className={`relative flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-[11px] font-bold transition-all duration-200 ${
                        fulfillmentType === 'PICKUP'
                          ? 'bg-sky-500 text-white shadow-md shadow-sky-500/30 scale-[1.02]'
                          : 'bg-transparent text-neutral-500 hover:text-neutral-800'
                      }`}
                    >
                      {fulfillmentType === 'PICKUP' && (
                        <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-white shadow-sm">
                          <svg className="h-2.5 w-2.5 text-sky-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </span>
                      )}
                      <span>🏪</span> Recoger en tienda
                    </button>
                  </div>

                  {restaurant && !restaurant.isOpen ? (
                    <div className="mt-3">
                      <Callout tone="warning">Este restaurante está cerrado en este momento.</Callout>
                    </div>
                  ) : null}

                  {/* Action Buttons */}
                  <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setIsCartOpen(false)}
                      className="group flex items-center justify-center gap-2 rounded-2xl border border-black/[0.06] bg-white px-5 py-3.5 text-[15px] font-semibold text-neutral-700 shadow-sm transition-all hover:bg-neutral-50 hover:shadow active:scale-[0.97] active-scale"
                    >
                      <svg className="h-4 w-4 text-neutral-400 transition-transform group-hover:-translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                      Seguir comprando
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsCartOpen(false);
                        if (!token) {
                          setShowAuthModal(true);
                        } else {
                          setIsCheckoutOpen(true);
                        }
                      }}
                      disabled={!restaurant?.isOpen}
                      className="group relative flex overflow-hidden items-center justify-center gap-2 rounded-2xl bg-sky-500 px-5 py-3.5 text-[15px] font-bold text-white shadow-[0_8px_20px_-6px_rgba(14,165,233,0.4)] transition-all hover:bg-sky-400 hover:shadow-[0_12px_24px_-8px_rgba(14,165,233,0.5)] active:scale-[0.97] active-scale disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 disabled:shadow-none animate-pulse-glow"
                    >
                      <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-1000 group-hover:translate-x-full disabled:hidden" />
                      <span className="relative flex items-center justify-center gap-2">
                        Completar pedido
                        <svg className="h-4 w-4 shrink-0 animate-arrow-slide group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                        </svg>
                      </span>
                    </button>
                  </div>
                </div>
              ) : null}
          </div>
          <style>{`
            @keyframes slideInRight {
              from { transform: translateX(100%); }
              to { transform: translateX(0); }
            }
            @keyframes fadeInUp {
              from { opacity: 0; transform: translateY(12px); }
              to { opacity: 1; transform: translateY(0); }
            }
            @keyframes pulseGlow {
              0%, 60%, 100% {
                transform: scale(1);
                box-shadow: 0 4px 12px -1px rgba(14, 165, 233, 0.25), 0 2px 4px -1px rgba(14, 165, 233, 0.15);
              }
              20% {
                transform: scale(1.015);
                box-shadow: 0 8px 24px -2px rgba(14, 165, 233, 0.4), 0 4px 10px -1px rgba(14, 165, 233, 0.25);
              }
            }
            .animate-pulse-glow:not(:disabled) {
              animation: pulseGlow 2.5s infinite cubic-bezier(0.4, 0, 0.2, 1);
            }
            @keyframes arrowSlide {
              0%, 60%, 100% {
                transform: translateX(0);
              }
              20%, 40% {
                transform: translateX(3px);
              }
              30% {
                transform: translateX(1px);
              }
            }
            .animate-arrow-slide {
              animation: arrowSlide 2.5s infinite ease-in-out;
            }
          `}</style>
        </div>
      ) : null}

      <div className={`fixed inset-0 z-50 transition-opacity duration-300 ${isCheckoutOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={() => setIsCheckoutOpen(false)} />
        <div
          ref={checkoutRef}
          className={`absolute right-0 top-0 flex h-full w-full max-w-[580px] flex-col overflow-hidden bg-[#faf9f6] shadow-[0_0_0_1px_rgba(0,0,0,0.04),0_40px_100px_rgba(15,15,15,0.25)] sm:rounded-l-[36px] transition-transform duration-350 ease-[cubic-bezier(0.16,1,0.3,1)] ${isCheckoutOpen ? 'translate-x-0' : 'translate-x-full'}`}
        >
            <section className="flex h-full flex-col">
              {/* ── Header ── */}
              <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-black/[0.04] bg-white px-5 py-4 sm:px-6">
                <div className="flex items-center gap-3.5">
                  <div className="relative flex h-12 w-12 items-center justify-center rounded-[18px] bg-gradient-to-br from-sky-400 to-sky-600 text-white shadow-lg shadow-accent/25">
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                    </svg>
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
                      {fulfillmentType === 'PICKUP' ? (
                        <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-[10px] font-bold text-sky-700 ring-1 ring-sky-300/50">
                          🏪 Recoger
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-300/50">
                          🛵 Envío
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
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-8 pt-5 sm:px-5">

                  {fulfillmentType === 'PICKUP' ? (
                    <div className="rounded-[22px] border border-black/[0.04] bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                      <div className="mb-4 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-50">
                            <span className="text-[11px]">🏪</span>
                          </div>
                          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-neutral-400">
                            Recoger en
                          </p>
                        </div>
                        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[9px] font-bold text-emerald-600">
                          Paso 1
                        </span>
                      </div>
                      <div className="overflow-hidden rounded-2xl border border-black/[0.04] bg-gradient-to-br from-white to-neutral-50/80 shadow-sm">
                        <div className="p-5 pb-0">
                          <div className="flex items-start gap-3.5">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-sm shadow-emerald-200/50">
                              <span className="text-xl text-white">🏪</span>
                            </div>
                            <div className="min-w-0 flex-1 pt-0.5">
                              <p className="text-[15px] font-bold leading-tight text-neutral-900">
                                {restaurant?.name || 'Restaurante'}
                              </p>
                              {restaurant?.address && (
                                <p className="mt-1 text-[13px] leading-relaxed text-neutral-500 line-clamp-2">
                                  {restaurant.address}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="mt-4 px-5">
                          <div className="flex items-center gap-2.5 rounded-xl bg-amber-50/80 px-3.5 py-3">
                            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100">
                              <span className="text-[11px]">⏰</span>
                            </div>
                            <p className="text-[12px] font-medium leading-snug text-amber-700">
                              Te avisaremos cuando esté listo para recoger
                            </p>
                          </div>
                        </div>
                        <div className="p-5 pt-4">
                          <button
                            type="button"
                            onClick={() => {
                              if (restaurant?.latitude && restaurant?.longitude) {
                                window.open(
                                  `https://www.google.com/maps/dir/?api=1&destination=${restaurant.latitude},${restaurant.longitude}`,
                                  '_blank'
                                );
                              } else if (restaurant?.address) {
                                window.open(
                                  `https://www.google.com/maps/search/${encodeURIComponent(restaurant.address)}`,
                                  '_blank'
                                );
                              }
                            }}
                            className="flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 py-3 text-[13px] font-semibold text-white transition hover:bg-neutral-800 active:scale-[0.98]"
                          >
                            <span>📍</span> Cómo llegar
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                  /* ── PASO 1 (DELIVERY): DIRECCIÓN DE ENTREGA ── */
                  <div className="rounded-[22px] border border-black/[0.04] bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                    <div className="flex items-center justify-between border-b border-black/[0.03] pb-2.5 mb-3.5">
                      <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-neutral-400 flex items-center gap-1.5">
                        <span>📍</span> Dirección de entrega
                      </p>
                      <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[9px] font-bold text-sky-600">
                        Paso 1
                      </span>
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
                                    ? 'border-sky-500 bg-sky-50/30 ring-1 ring-sky-500/30'
                                    : 'border-black/[0.06] bg-white hover:border-black/10'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                                    {addr.isDefault ? '🏠 Casa (Principal)' : '📍 Dirección'}
                                  </span>
                                  {isSelected && (
                                    <span className="flex h-4.5 w-4.5 items-center justify-center rounded-full bg-sky-500 text-[10px] font-bold text-white">
                                      ✓
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
                            <span className="text-xl text-sky-500 font-bold">+</span>
                            <span className="text-xs font-bold text-sky-600 mt-0.5">Nueva</span>
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
                          className="w-full rounded-2xl border border-sky-300 bg-sky-50 px-4 py-4 text-sm font-bold text-sky-700 transition-all active-scale hover:bg-sky-100/50 shadow-sm flex items-center justify-center gap-2"
                        >
                          <span>➕</span> Agregar dirección de entrega
                        </button>
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
                                  className="w-full rounded-2xl border border-black/10 bg-white p-3.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-300/20 pr-10 shadow-sm transition-all placeholder:text-neutral-400"
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
                                        <span className="text-sky-500">📍</span>
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
                              disabled={isSearchingAddress}
                              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-sky-100 bg-sky-50/50 px-4 py-3.5 text-sm font-semibold text-sky-600 transition hover:bg-sky-50 disabled:opacity-50 shadow-sm"
                            >
                              <span>🛰️</span>
                              <span>Usar mi ubicación actual (GPS)</span>
                            </button>

                            {addresses.length > 0 && (
                              <div className="flex justify-end pt-1">
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
                                  className="text-xs font-bold text-neutral-500 hover:text-neutral-800 transition-colors"
                                >
                                  Cancelar
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
                                className="rounded-xl border border-sky-100 bg-white px-3 py-1.5 text-xs font-bold text-sky-600 transition hover:bg-sky-50 shadow-sm shrink-0"
                              >
                                Cambiar
                              </button>
                            </div>

                            <div className="flex items-center gap-2.5 rounded-2xl bg-sky-50/50 px-4 py-3 text-xs text-sky-700 border border-sky-100 shadow-sm">
                              <span className="text-base shrink-0">📍</span>
                              <p className="font-semibold leading-relaxed">Mueve el pin en el mapa para ubicar exactamente el lugar de tu entrega.</p>
                            </div>

                            <div className="grid gap-3.5 md:grid-cols-2">
                              <Field
                                label="Número de casa / Apto / Interior"
                                value={checkoutForm.number}
                                onChange={(value) => setCheckoutForm((current) => ({ ...current, number: value }))}
                                placeholder="Ej. Casa 3, Apto 402"
                              />
                              <Field
                                label="Referencias del domicilio"
                                value={checkoutForm.reference}
                                onChange={(value) => setCheckoutForm((current) => ({ ...current, reference: value }))}
                                placeholder="Ej. Portón café, junto al parque"
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
                                className="rounded-xl bg-sky-500 px-5 py-2.5 text-xs font-bold text-white transition hover:bg-sky-600 shadow-sm shadow-accent/10"
                              >
                                Confirmar dirección
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Google Map */}
                    <div
                      id="map-checkout"
                      className={`h-48 w-full rounded-2xl border border-black/5 mt-4 overflow-hidden shadow-inner no-invert ${(isAddingNewAddress && newAddressStep === 'search') ? 'hidden' : 'opacity-100'}`}
                    />
                  </div>
                  )}

                  {/* ── PASO 2: PAGO Y DETALLES ── */}
                  <div className="rounded-[22px] border border-black/[0.04] bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                    <div className="flex items-center justify-between border-b border-black/[0.03] pb-2.5 mb-3.5">
                      <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-neutral-400 flex items-center gap-1.5">
                        <span>📋</span> Detalles del pedido
                      </p>
                      <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[9px] font-bold text-sky-600">
                        Paso 2
                      </span>
                    </div>

                    <div className="space-y-4">
                      {/* Referencias (solo para delivery y si no está agregando dirección) */}
                      {fulfillmentType !== 'PICKUP' && !isAddingNewAddress && (
                        <Field 
                          label="Referencias del domicilio" 
                          value={checkoutForm.reference} 
                          onChange={(value) => setCheckoutForm((current) => ({ ...current, reference: value }))} 
                          placeholder="Ej. Depto 4B, timbre blanco, portón café" 
                        />
                      )}

                      {/* Selector de Método de Pago con Tarjetas Premium */}
                      <div className="space-y-2">
                        <label className="text-sm font-semibold text-neutral-800">Método de pago</label>
                        <div className="grid grid-cols-2 gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              setCheckoutForm((current) => ({ ...current, paymentMethod: 'CASH' }));
                              setTransferProofName('');
                              setTransferProofSource('');
                            }}
                            className={`flex flex-col items-center justify-center rounded-2xl border p-4 text-center transition-all ${
                              checkoutForm.paymentMethod === 'CASH'
                                ? 'border-sky-500 bg-sky-50/30 ring-1 ring-sky-500/30'
                                : 'border-black/[0.06] bg-white hover:border-black/10'
                            }`}
                          >
                            <span className="text-2xl">💵</span>
                            <span className="mt-2 text-sm font-bold text-neutral-900">Efectivo</span>
                            <span className="text-[10px] text-neutral-400 mt-0.5">Paga al recibir</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setCheckoutForm((current) => ({ ...current, paymentMethod: 'TRANSFER' }));
                            }}
                            className={`flex flex-col items-center justify-center rounded-2xl border p-4 text-center transition-all ${
                              checkoutForm.paymentMethod === 'TRANSFER'
                                ? 'border-sky-500 bg-sky-50/30 ring-1 ring-sky-500/30'
                                : 'border-black/[0.06] bg-white hover:border-black/10'
                            }`}
                          >
                            <span className="text-2xl">🏦</span>
                            <span className="mt-2 text-sm font-bold text-neutral-900">Transferencia</span>
                            <span className="text-[10px] text-neutral-400 mt-0.5">Sube tu comprobante</span>
                          </button>
                        </div>
                      </div>

                      {/* CONDICIONAL: Detalles de Transferencia Integrados */}
                      {checkoutForm.paymentMethod === 'TRANSFER' && (
                        <div className="space-y-4 pt-2 animate-in fade-in duration-300">
                          {hasTransferDetails(restaurant) ? (
                            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
                              <div className="flex items-center gap-2 mb-4">
                                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-200 text-emerald-800 text-xs">🏦</span>
                                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-700">Datos bancarios</p>
                              </div>
                              <div className="space-y-1.5 text-sm text-emerald-900">
                                <div className="text-center bg-emerald-800/10 rounded-xl px-4 py-3 border border-emerald-200/60">
                                  <p className="text-[9px] font-extrabold uppercase tracking-wider text-emerald-600 mb-0.5">Monto a transferir</p>
                                  <p className="font-extrabold text-emerald-950 text-lg">{formatCurrency(orderTotal)}</p>
                                </div>
                                <div className="flex items-center justify-between gap-3 bg-white/70 rounded-xl px-4 py-3 border border-emerald-200/60">
                                  <span className="text-emerald-700 font-medium">Banco</span>
                                  <span className="font-bold text-emerald-950">{restaurant?.transferBankName}</span>
                                </div>
                                <div className="flex items-center justify-between gap-3 bg-white/70 rounded-xl px-4 py-3 border border-emerald-200/60">
                                  <span className="text-emerald-700 font-medium">Cuenta o tarjeta</span>
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-emerald-950 select-all">{restaurant?.transferAccountNumber}</span>
                                    <button
                                      type="button"
                                      onClick={() => handleCopyText(restaurant?.transferAccountNumber, 'account')}
                                      className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-200/60 text-emerald-700 hover:bg-emerald-300/70 active:scale-90 relative transition-all group"
                                      title="Copiar número de cuenta"
                                    >
                                      {copiedField === 'account' ? (
                                        <svg className="h-4 w-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                        </svg>
                                      ) : (
                                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                                        </svg>
                                      )}
                                      {copiedField === 'account' && (
                                        <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 shadow-sm">
                                          <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                          </svg>
                                        </span>
                                      )}
                                    </button>
                                  </div>
                                </div>
                                <div className="flex items-center justify-between gap-3 bg-white/70 rounded-xl px-4 py-3 border border-emerald-200/60">
                                  <span className="text-emerald-700 font-medium">Beneficiario</span>
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-emerald-950">{restaurant?.transferBeneficiaryName}</span>
                                    <button
                                      type="button"
                                      onClick={() => handleCopyText(restaurant?.transferBeneficiaryName, 'beneficiary')}
                                      className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-200/60 text-emerald-700 hover:bg-emerald-300/70 active:scale-90 relative transition-all group"
                                      title="Copiar beneficiario"
                                    >
                                      {copiedField === 'beneficiary' ? (
                                        <svg className="h-4 w-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                        </svg>
                                      ) : (
                                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                                        </svg>
                                      )}
                                      {copiedField === 'beneficiary' && (
                                        <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 shadow-sm">
                                          <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                          </svg>
                                        </span>
                                      )}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 text-sm text-amber-800 leading-relaxed">
                              ⚠️ Este restaurante aún no ha configurado sus datos de transferencia. Usa efectivo o vuelve más tarde.
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
                                <label className="relative flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-neutral-300 bg-neutral-50/50 px-4 py-3 text-center transition-all hover:bg-neutral-50 hover:border-neutral-400 group">
                                  <input
                                    type="file"
                                    accept="image/*"
                                    onChange={(event) => void handleTransferProofChange(event)}
                                    className="sr-only"
                                  />
                                  <span className="text-sm font-medium text-neutral-600 group-hover:text-neutral-800 transition-colors">
                                    Cambiar comprobante
                                  </span>
                                </label>
                              </div>
                            ) : (
                              <label className="relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-300 bg-neutral-50/50 px-4 py-6 text-center transition-all hover:bg-neutral-50 hover:border-sky-400 group">
                                <input
                                  type="file"
                                  accept="image/*"
                                  onChange={(event) => void handleTransferProofChange(event)}
                                  className="sr-only"
                                />
                                <span className="text-3xl transition-transform group-hover:scale-110">📤</span>
                                <span className="mt-2 text-sm font-bold text-neutral-800">
                                  Subir foto del comprobante
                                </span>
                                <span className="text-xs text-neutral-400 mt-1 max-w-[280px] leading-relaxed">
                                  Toma una foto del ticket de transferencia o selecciónala desde tus archivos
                                </span>
                              </label>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── PASO 3: INSTRUCCIONES ── */}
                  <div className="rounded-[22px] border border-black/[0.04] bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                    <div className="flex items-center justify-between border-b border-black/[0.03] pb-2.5 mb-3.5">
                      <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-neutral-400 flex items-center gap-1.5">
                        <span>📝</span> Instrucciones especiales
                      </p>
                      <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[9px] font-bold text-sky-600">
                        Paso 3
                      </span>
                    </div>
                    <div className="space-y-3.5">
                      <Field 
                        label="Instrucciones para la tienda" 
                        value={checkoutForm.storeNotes} 
                        onChange={(value) => setCheckoutForm((current) => ({ ...current, storeNotes: value }))} 
                        placeholder="Ej. Sin cebolla, salsas extra, sin cubiertos..." 
                      />

                      {fulfillmentType !== 'PICKUP' && (
                      <Field 
                        label="Instrucciones para el repartidor" 
                        value={checkoutForm.notes} 
                        onChange={(value) => setCheckoutForm((current) => ({ ...current, notes: value }))} 
                        placeholder="Ej. Tocar timbre del portón café, dejar con guardia..." 
                      />
                      )}
                    </div>
                  </div>

                  {/* ── PASO 4: RESUMEN DE PAGO ── */}
                  <div className="rounded-[22px] border border-black/[0.04] bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                    <div className="flex items-center justify-between border-b border-black/[0.03] pb-2.5 mb-3.5">
                      <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-neutral-400 flex items-center gap-1.5">
                        <span>💰</span> Resumen del pago
                      </p>
                      <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[9px] font-bold text-sky-600">
                        Paso 4
                      </span>
                    </div>
                    <div className="space-y-3 text-sm">
                      <div className="flex items-center justify-between text-neutral-500">
                        <span>Subtotal</span>
                        <span className="font-semibold text-neutral-800">{formatCurrency(cartSubtotal)}</span>
                      </div>
                      {discountAmount > 0 && (
                        <div className="flex items-center justify-between text-emerald-600 font-semibold bg-emerald-50 px-2 py-1 rounded-lg">
                          <span>Descuento</span>
                          <span>-{formatCurrency(discountAmount)}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between text-neutral-500">
                        <span>Servicio</span>
                        <span className="font-semibold text-neutral-800">{formatCurrency(serviceFee)}</span>
                      </div>
                      {fulfillmentType !== 'PICKUP' && (
                      <div className="flex items-center justify-between text-neutral-500">
                        <span>Envío</span>
                        <span className="font-semibold text-neutral-800">{formatCurrency(estimatedDeliveryFee)}</span>
                      </div>
                      )}
                      <div className="border-t border-black/5 pt-3 mt-3 flex items-center justify-between font-extrabold text-neutral-950 text-base">
                        <span>Total a pagar</span>
                        <span className="text-lg tracking-tight text-neutral-950">{formatCurrency(orderTotal)}</span>
                      </div>
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
                        className="mt-4 inline-flex items-center justify-center rounded-xl bg-sky-500 px-6 py-3 text-xs font-bold text-white shadow-md shadow-accent/25 transition-all hover:bg-sky-600 hover:shadow-lg active:scale-95"
                      >
                        Iniciar sesión / Registrarse
                      </button>
                    </div>
                  )}
                </div>

                <div className="sticky bottom-0 z-10 border-t border-black/[0.04] bg-white/95 px-4 pb-6 pt-4 backdrop-blur-xl sm:px-5 shadow-[0_-12px_30px_-8px_rgba(0,0,0,0.08)]">
                  {/* Validation Warning Callout (Animated and Professional) */}
                  {checkoutValidationMessage && token && (
                    <div className="mb-3.5 flex justify-center animate-in slide-in-from-bottom-2 fade-in duration-300">
                      <div className="flex items-center gap-2 rounded-full border border-rose-200/60 bg-rose-50/80 px-3.5 py-1.5 text-[11px] font-medium text-rose-600 shadow-sm backdrop-blur-md">
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-rose-500/20 text-[9px]">⚠️</span>
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
                      <svg className="h-4 w-4 text-neutral-500 transition-transform group-hover:-translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                      </svg>
                      <span className="hidden sm:inline">Volver</span>
                    </button>
                    
                    {!token ? (
                      <button
                        type="button"
                        onClick={() => setShowAuthModal(true)}
                        className="group relative flex-1 overflow-hidden rounded-2xl bg-sky-500 px-5 py-3.5 text-[15px] font-bold text-white shadow-[0_8px_20px_-6px_rgba(14,165,233,0.4)] transition-all hover:bg-sky-400 hover:shadow-[0_12px_24px_-8px_rgba(14,165,233,0.5)] active:scale-[0.97] active-scale"
                      >
                        <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-1000 group-hover:translate-x-full" />
                        <span className="relative flex items-center justify-center gap-2">
                          Iniciar sesión
                          <svg className="h-4 w-4 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                        </span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          if (pushPermission !== 'granted') {
                            setIsPushReminderModalOpen(true);
                          } else {
                            void createOrder();
                          }
                        }}
                        disabled={creatingOrder || Boolean(checkoutValidationMessage)}
                        className="group relative flex-1 overflow-hidden rounded-2xl bg-sky-500 px-5 py-3.5 text-[15px] font-bold text-white shadow-[0_8px_20px_-6px_rgba(14,165,233,0.4)] transition-all hover:bg-sky-400 hover:shadow-[0_12px_24px_-8px_rgba(14,165,233,0.5)] active:scale-[0.97] active-scale disabled:pointer-events-none disabled:bg-neutral-100 disabled:text-neutral-400 disabled:shadow-none"
                      >
                        <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-1000 group-hover:translate-x-full disabled:hidden" />
                        <span className="relative flex items-center justify-center gap-2">
                          {creatingOrder ? 'Procesando...' : `Confirmar • ${formatCurrency(orderTotal)}`}
                          {!creatingOrder && (
                            <svg className="h-4 w-4 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                            </svg>
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
              {pushPermission === 'denied' ? '🔒' : '🔔'}
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
                  className="w-full rounded-full bg-sky-500 px-4 py-3.5 text-sm font-semibold text-white shadow-[0_8px_16px_rgba(135,206,235,0.25)] transition hover:bg-sky-600 active:scale-[0.98] active-scale"
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
                    className="w-full rounded-full bg-sky-500 px-4 py-3.5 text-sm font-semibold text-white shadow-[0_8px_16px_rgba(135,206,235,0.25)] transition hover:bg-sky-600 active:scale-[0.98] active-scale"
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
              💸
            </div>
            <h3 className="text-center text-xl font-bold tracking-tight text-neutral-900">
              Monto Excedido
            </h3>
            <p className="mt-3 text-center text-sm leading-relaxed text-neutral-600">
              Por seguridad de los repartidores, los pedidos mayores a <span className="font-semibold text-neutral-900">$500</span> no pueden pagarse en efectivo.
            </p>
            <div className="mt-6 flex flex-col gap-3">
              <button
                type="button"
                onClick={() => {
                  setCheckoutForm((prev) => ({ ...prev, paymentMethod: 'TRANSFER' }));
                  setShowMaxCashModal(false);
                }}
                className="w-full rounded-full bg-sky-500 px-4 py-3.5 text-sm font-semibold text-white shadow-[0_8px_16px_rgba(135,206,235,0.25)] transition hover:bg-sky-600 active:scale-[0.98] active-scale"
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
              📍
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
                className="w-full rounded-full bg-sky-500 px-4 py-3.5 text-sm font-semibold text-white shadow-[0_8px_16px_rgba(135,206,235,0.25)] transition hover:bg-sky-600 active:scale-[0.98] active-scale"
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
              📍
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
                className="w-full rounded-full bg-sky-500 px-4 py-3.5 text-sm font-semibold text-white shadow-[0_8px_16px_rgba(135,206,235,0.25)] transition hover:bg-sky-600 active:scale-[0.98] active-scale"
              >
                Aceptar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-7xl px-4 py-5 md:px-6 md:py-8">

        {error ? <div className="mt-5"><Callout tone="danger">{error}</Callout></div> : null}

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
            <div className="space-y-6">
              <section className={`-mx-4 ${error ? 'mt-4' : 'mt-0'} lg:mx-0 lg:mt-0 overflow-hidden border-y border-black/5 dark:border-zinc-900/80 bg-white dark:bg-[#0c0c0e] shadow-[0_18px_60px_rgba(15,15,15,0.05)] dark:shadow-none lg:rounded-[32px] lg:border lg:border-black/5 lg:dark:border-zinc-900/80`}>
                <div className="relative">
                  {restaurant.coverImage ? (
                    <img
                      src={restaurant.coverImage}
                      alt={`Portada de ${restaurant.name}`}
                      className="h-52 w-full object-cover md:h-72 lg:h-64"
                      fetchPriority="high"
                      decoding="async"
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
                            className="h-full w-full object-cover"
                            decoding="async"
                          />
                        ) : (
                          <span className="text-xl font-semibold text-neutral-900 dark:text-white">{buildRestaurantInitials(restaurant.name)}</span>
                        )}
                      </div>
                      <div className="text-white">
                        <p className="text-3xl font-semibold tracking-[-0.04em]">{restaurant.name}</p>
                        <div className="mt-1 flex items-center gap-1 text-sm font-semibold text-white">
                          ⭐ {restaurant.rating ? restaurant.rating.toFixed(1) : 'Nuevo'}
                          {(restaurant.reviewCount ?? 0) > 0 && (
                            <span className="font-normal text-white/70"> ({restaurant.reviewCount} reseñas)</span>
                          )}
                        </div>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-white/80">{restaurant.description}</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="relative px-4 pb-4 pt-0 text-sm text-neutral-600 dark:text-neutral-300 md:px-6 md:pb-5 lg:px-7 lg:pt-5">
                  <div className="-mt-8 flex flex-col items-center text-center lg:hidden">
                    <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-[22px] border-4 border-white dark:border-neutral-900 bg-white dark:bg-neutral-900 shadow-[0_8px_20px_rgba(15,15,15,0.14)] dark:shadow-none">
                      {restaurant.logo ? (
                        <img
                          src={restaurant.logo}
                          alt={`Logo de ${restaurant.name}`}
                          className="h-full w-full object-cover"
                          decoding="async"
                        />
                      ) : (
                        <span className="text-lg font-semibold text-neutral-900 dark:text-white">{buildRestaurantInitials(restaurant.name)}</span>
                      )}
                    </div>
                    <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-neutral-950 dark:text-white">{restaurant.name}</p>
                    <div className="mt-0.5 flex items-center gap-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                      ⭐ {restaurant.rating ? restaurant.rating.toFixed(1) : 'Nuevo'}
                      {(restaurant.reviewCount ?? 0) > 0 && (
                        <span className="font-normal text-neutral-500 dark:text-neutral-400"> ({restaurant.reviewCount} reseñas)</span>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-col lg:flex-row items-stretch lg:items-center gap-1.5 lg:gap-0 lg:divide-x divide-black/[0.06] rounded-2xl lg:rounded-full border border-black/[0.04] bg-white p-1.5 shadow-[0_2px_12px_rgba(0,0,0,0.02)] lg:p-1 lg:pr-3 transition-all hover:shadow-[0_6px_20px_rgba(0,0,0,0.04)]">
                    {/* Address */}
                    <div className="w-full flex-1 rounded-xl lg:rounded-full bg-neutral-50 lg:bg-transparent px-3 py-2.5 lg:py-1.5 text-[12px] text-neutral-600 flex items-center gap-2">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white shadow-sm border border-black/[0.03] lg:bg-neutral-100 lg:shadow-none lg:border-transparent">
                        <svg className="h-3 w-3 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      </div>
                      <span className="truncate font-medium">{restaurant.address}</span>
                    </div>

                    {/* Stats Grid for Mobile / Flex for Desktop */}
                    <div className="flex w-full lg:w-auto gap-1.5 lg:gap-0">
                      <div className="flex flex-1 lg:flex-none flex-col items-center justify-center gap-0 rounded-xl lg:rounded-none bg-neutral-50 lg:bg-transparent px-2 py-1.5 lg:px-4">
                        <span className="text-[9px] font-extrabold uppercase tracking-widest text-neutral-400">Distancia</span>
                        <div className="flex items-center gap-1 text-[12px] font-semibold text-neutral-700">
                          <svg className="h-3 w-3 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                          </svg>
                          <span>{distanceKm ? `${distanceKm.toFixed(1)} km` : '-- km'}</span>
                        </div>
                      </div>
                      <div className="flex flex-1 lg:flex-none flex-col items-center justify-center gap-0 rounded-xl lg:rounded-none bg-neutral-50 lg:bg-transparent px-2 py-1.5 lg:px-4">
                        <span className="text-[9px] font-extrabold uppercase tracking-widest text-neutral-400">Envío</span>
                        <div className="flex items-center gap-1 text-[12px] font-semibold text-neutral-700">
                          <svg className="h-3 w-3 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span>{formatDeliverySummary(restaurant.effectiveDeliveryFee)}</span>
                        </div>
                      </div>
                      <div className="flex flex-1 lg:flex-none flex-col items-center justify-center gap-0 rounded-xl lg:rounded-none bg-neutral-50 lg:bg-transparent px-2 py-1.5 lg:px-4">
                        <span className="text-[9px] font-extrabold uppercase tracking-widest text-neutral-400">Estado</span>
                        <div className="flex items-center gap-1.5 text-[12px]">
                          <span className="relative flex h-2 w-2 shrink-0">
                            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${restaurant.isOpen ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
                            <span className={`relative inline-flex rounded-full h-2 w-2 ${restaurant.isOpen ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
                          </span>
                          <span className={`font-bold ${restaurant.isOpen ? 'text-emerald-600' : 'text-red-600'}`}>{restaurant.isOpen ? 'Abierto' : 'Cerrado'}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <div data-sticky-header className="sticky top-[72px] z-20 -mx-4 bg-white/90 backdrop-blur-2xl border-b border-black/[0.04] md:-mx-6 lg:-mx-7">
                <div className="px-4 py-3 md:px-6 lg:px-7">
                  <div className="relative w-full">
                    <input
                      type="text"
                      placeholder={`Buscar en ${restaurant?.name || 'el menú'}...`}
                      value={productSearchQuery}
                      onChange={(e) => setProductSearchQuery(e.target.value)}
                      className="w-full rounded-full border border-black/10 bg-white px-5 py-3 pr-11 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-black/20"
                    />
                    {productSearchQuery ? (
                      <button
                        type="button"
                        onClick={() => setProductSearchQuery('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-neutral-400 hover:text-neutral-700 transition-colors rounded-full hover:bg-neutral-100"
                        aria-label="Limpiar búsqueda"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    ) : (
                      <svg className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 21l-5.2-5.2m1.7-4.3a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    )}
                  </div>
                </div>
                {!productSearchQuery.trim() && (
                <div className="px-4 pb-3 md:px-6 lg:px-7">
                  <div className="-mx-1 overflow-x-auto px-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <div className="flex min-w-max gap-1 sm:gap-1">
                      {(productSearchQuery.trim() ? (filteredRestaurant?.categories ?? []) : restaurant.categories).map((category) => {
                        const isActive = activeCategory === category.id;
                        return (
                          <button
                            type="button"
                            key={category.id}
                            onClick={() => scrollToCategory(category.id)}
                            className={`relative px-4 py-3 text-[13.5px] font-semibold transition-all duration-200 ${
                              isActive
                                ? 'text-sky-600'
                                : 'text-neutral-500 hover:text-neutral-800'
                            }`}
                          >
                            {category.name}
                            <span className={`absolute bottom-0 left-1/2 h-[3px] rounded-full bg-sky-500 transition-all duration-300 ${
                              isActive ? 'w-5/6 -translate-x-1/2' : 'w-0 -translate-x-1/2'
                            }`} />
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
                      <svg className="h-7 w-7 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 21l-5.2-5.2m1.7-4.3a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
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
                        <article id={product.id} key={product.id} className="overflow-hidden rounded-[24px] border border-black/[0.04] bg-white transition-all duration-300 shadow-[0_2px_12px_rgba(0,0,0,0.02)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)]">
                          <div className="flex gap-4 p-4">
                            <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-2xl sm:h-28 sm:w-28">
                              {product.image ? (
                                <img src={product.image} alt={product.name} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                              ) : (
                                <div className="h-full w-full bg-gradient-to-br from-neutral-100 to-neutral-200" />
                              )}
                            </div>
                            <div className="flex min-w-0 flex-1 flex-col justify-between">
                              <div>
                                <h3 className="text-base font-semibold text-neutral-950">{product.name}</h3>
                                <p className="mt-0.5 text-sm text-neutral-500 line-clamp-2 leading-snug">{product.description}</p>
                              </div>
                              <div className="mt-2 flex items-center justify-between gap-3">
                                {product.discountPrice ? (
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-lg font-bold text-neutral-950">{formatCurrency(product.discountPrice)}</span>
                                    <span className="text-xs text-neutral-400 line-through">{formatCurrency(product.price)}</span>
                                  </div>
                                ) : (
                                  <span className="text-lg font-bold text-neutral-950">{formatCurrency(product.price)}</span>
                                )}
                                {quantity > 0 ? (
                                  <div className="flex items-center gap-0.5 rounded-full border border-black/[0.06] bg-neutral-50 p-0.5">
                                    <button type="button" onClick={() => { if (product.optionGroups?.length) { decreaseQuantityForProduct(product.id); } else { updateCartItem(product.id, { quantity: quantity - 1 }); } }} className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 transition-all hover:bg-white active:scale-90">
                                      {quantity === 1 ? (
                                        <svg className="h-3 w-3 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                      ) : (
                                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20 12H4" /></svg>
                                      )}
                                    </button>
                                    <span className="flex h-7 w-7 items-center justify-center text-xs font-bold text-neutral-900">{quantity}</span>
                                    <button type="button" onClick={() => addToCart(product)} className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 transition-all hover:bg-white active:scale-90">
                                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
                                    </button>
                                  </div>
                                ) : (
                                  <button type="button" onClick={() => addToCart(product)} disabled={!restaurant?.isOpen} className="rounded-full bg-neutral-100 px-4 py-2 text-sm font-bold text-neutral-900 transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:text-neutral-400">
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
                    <span className="shrink-0 rounded-full bg-gradient-to-r from-sky-50 to-white px-3 py-1.5 text-[11px] font-bold text-sky-600 border border-sky-100/60 shadow-[0_2px_8px_rgba(14,165,233,0.08)] sm:text-xs">
                      {category.products.length} productos
                    </span>
                  </div>

                  <div className={isPromoCarousel || isLargeCategory ? "relative mt-5" : "mt-5 overflow-hidden"}>
                    <div className={isPromoCarousel || isLargeCategory
                      ? "flex gap-3 overflow-x-auto pb-2 scroll-smooth snap-x snap-mandatory [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                      : "grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
                    }>
                    {category.products.map((product) => {
                      const quantity = getCartQuantity(product.id);

                      return (
                        isPromoCarousel ? (
                          <article id={product.id} key={product.id} className="group w-32 shrink-0 snap-start overflow-hidden rounded-2xl border border-black/[0.04] bg-white transition-all duration-300 shadow-[0_2px_8px_rgba(0,0,0,0.02)] hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] active:scale-[0.98]">
                          
                            <div className="relative overflow-hidden">
                              {product.image ? (
                                <img src={product.image} alt={product.name} className="h-20 w-full object-cover transition duration-300 group-hover:scale-105" loading="lazy" decoding="async" />
                              ) : (
                                <div className="flex h-20 w-full items-center justify-center bg-gradient-to-br from-neutral-100 to-neutral-200">
                                  <svg className="h-6 w-6 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM13.5 10.5h-3" />
                                  </svg>
                                </div>
                              )}
                              {product.discountPrice && (
                                <div className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-rose-500/90 px-1.5 py-0.5 text-[8px] font-bold text-white shadow-sm backdrop-blur-sm">
                                  <span>-{Math.round((1 - product.discountPrice / product.price) * 100)}%</span>
                                </div>
                              )}
                            </div>
                            <div className="px-1.5 pb-1.5 pt-1">
                              <h3 className="truncate text-[11px] font-bold leading-tight text-neutral-900">{product.name}</h3>
                              {product.sellBy === 'WEIGHT' ? (
                                <p className="mt-0.5 text-[11px] font-bold text-neutral-900">{formatCurrency(product.unitPrice || product.price)}/kg</p>
                              ) : product.discountPrice ? (
                                <div className="mt-0.5 flex items-baseline gap-1">
                                  <span className="text-xs font-bold text-rose-600">{formatCurrency(product.discountPrice)}</span>
                                  <span className="text-[9px] text-neutral-400 line-through">{formatCurrency(product.price)}</span>
                                </div>
                              ) : (
                                <p className="mt-0.5 text-xs font-bold text-neutral-900">{formatCurrency(product.price)}</p>
                              )}
                              {product.discountPrice && (
                                <span className="mt-0.5 inline-block rounded-full bg-emerald-50 px-1 py-0.5 text-[8px] font-bold text-emerald-600">
                                  -{formatCurrency(product.price - product.discountPrice)}
                                </span>
                              )}
                              <div className="mt-1.5">
                                {quantity > 0 ? (
                                  <div className="flex w-fit items-center gap-0.5 rounded-lg border border-black/[0.06] bg-neutral-50 p-0.5">
                                    <button type="button" onClick={() => { if (product.optionGroups?.length) { decreaseQuantityForProduct(product.id); } else { updateCartItem(product.id, { quantity: quantity - 1 }); } }} className="flex h-5 w-5 items-center justify-center rounded-md text-neutral-500 transition-all hover:bg-white active:scale-90" aria-label={`Quitar una unidad de ${product.name}`}>
                                      {quantity === 1 ? (
                                        <svg className="h-2.5 w-2.5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                      ) : (
                                        <svg className="h-2 w-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20 12H4" /></svg>
                                      )}
                                    </button>
                                    <span className="flex h-5 w-5 items-center justify-center text-[10px] font-bold text-neutral-900">{quantity}</span>
                                    <button type="button" onClick={() => addToCart(product)} className="flex h-5 w-5 items-center justify-center rounded-md text-neutral-500 transition-all hover:bg-white active:scale-90" aria-label={`Agregar una unidad de ${product.name}`}>
                                      <svg className="h-2 w-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
                                    </button>
                                  </div>
                                ) : (
                                  <button type="button" onClick={() => addToCart(product)} disabled={!restaurant.isOpen} className="w-full rounded-lg bg-neutral-900 py-1.5 text-[10px] font-bold text-white transition hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-400">
                                    Agregar
                                  </button>
                                )}
                              </div>
                            </div>
                          </article>
                        ) : isLargeCategory ? (
                          <article id={product.id} key={product.id} className="w-[44vw] shrink-0 snap-start sm:w-52 overflow-hidden rounded-2xl border border-black/[0.04] bg-white transition-all duration-300 shadow-[0_2px_12px_rgba(0,0,0,0.02)] hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)]">
                            <div className="flex h-full flex-col">
                              <div
                                className="relative aspect-square overflow-hidden bg-neutral-50 cursor-pointer"
                                onClick={() => {
                                  const imgs = product.images?.length ? product.images : product.image ? [product.image] : [];
                                  if (imgs.length) {
                                    setPreviewProduct({
                                      images: imgs,
                                      name: product.name,
                                      description: product.description,
                                      price: product.price,
                                      discountPrice: product.discountPrice,
                                      sellBy: product.sellBy,
                                      unitPrice: product.unitPrice,
                                      id: product.id,
                                      optionGroups: product.optionGroups,
                                    });
                                    setPreviewIndex(0);
                                  }
                                }}
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
                                  <div className="h-full w-full bg-gradient-to-br from-neutral-100 to-neutral-200" />
                                )}
                                {product.discountPrice && (
                                  <div className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-rose-500/90 px-2 py-0.5 text-[9px] font-bold text-white shadow-sm">
                                    <span>-{Math.round((1 - product.discountPrice / product.price) * 100)}%</span>
                                  </div>
                                )}
                              </div>
                              <div className="flex flex-1 flex-col p-3">
                                 <h3 className="text-sm font-bold leading-snug text-neutral-900 line-clamp-2">{product.name}</h3>
                                {product.sellBy === 'WEIGHT' ? (
                                  <p className="mt-0.5 text-xs font-semibold text-neutral-500">{formatCurrency(product.unitPrice || product.price)}/kg</p>
                                ) : product.discountPrice ? (
                                  <div className="mt-0.5 flex items-baseline gap-1.5">
                                    <span className="text-xs font-bold text-rose-600">{formatCurrency(product.discountPrice)}</span>
                                    <span className="text-[10px] text-neutral-400 line-through">{formatCurrency(product.price)}</span>
                                  </div>
                                ) : (
                                  <p className="mt-0.5 text-xs font-semibold text-neutral-500">{formatCurrency(product.price)}</p>
                                )}
                                <div className="mt-auto pt-3">
                                  {quantity > 0 ? (
                                    <div className="flex w-fit items-center gap-0.5 rounded-full border border-black/[0.06] bg-neutral-50 p-0.5">
                                      <button type="button" onClick={() => { if (product.optionGroups?.length) { decreaseQuantityForProduct(product.id); } else { updateCartItem(product.id, { quantity: quantity - 1 }); } }} className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 transition-all hover:bg-white active:scale-90" aria-label={`Quitar una unidad de ${product.name}`}>
                                        {quantity === 1 ? (
                                          <svg className="h-3 w-3 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                        ) : (
                                          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20 12H4" /></svg>
                                        )}
                                      </button>
                                      <span className="flex h-7 w-7 items-center justify-center text-xs font-bold text-neutral-900">{quantity}</span>
                                      <button type="button" onClick={() => addToCart(product)} className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 transition-all hover:bg-white active:scale-90" aria-label={`Agregar una unidad de ${product.name}`}>
                                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
                                      </button>
                                    </div>
                                  ) : (
                                    <button type="button" onClick={() => addToCart(product)} disabled={!restaurant.isOpen} className="w-full rounded-xl bg-neutral-900 py-2.5 text-[11px] font-bold text-white transition hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-400">
                                      Agregar
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </article>
                        ) : isStore ? (
                          <article id={product.id} key={product.id} className="overflow-hidden rounded-2xl border border-black/[0.04] bg-white transition-all duration-300 shadow-[0_2px_12px_rgba(0,0,0,0.02)] hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)]">
                            <div className="flex h-full flex-col">
                              <div className="relative aspect-square overflow-hidden bg-neutral-50">
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
                                  <div className="h-full w-full bg-gradient-to-br from-neutral-100 to-neutral-200" />
                                )}
                                {product.discountPrice && (
                                  <div className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-rose-500/90 px-2 py-0.5 text-[9px] font-bold text-white shadow-sm">
                                    <span>-{Math.round((1 - product.discountPrice / product.price) * 100)}%</span>
                                  </div>
                                )}
                              </div>
                              <div className="flex flex-1 flex-col p-3">
                                <h3 className="text-sm font-bold leading-snug text-neutral-900 line-clamp-2">{product.name}</h3>
                                {product.sellBy === 'WEIGHT' ? (
                                  <p className="mt-0.5 text-xs font-semibold text-neutral-500">{formatCurrency(product.unitPrice || product.price)}/kg</p>
                                ) : product.discountPrice ? (
                                  <div className="mt-0.5 flex items-baseline gap-1.5">
                                    <span className="text-xs font-bold text-rose-600">{formatCurrency(product.discountPrice)}</span>
                                    <span className="text-[10px] text-neutral-400 line-through">{formatCurrency(product.price)}</span>
                                  </div>
                                ) : (
                                  <p className="mt-0.5 text-xs font-semibold text-neutral-500">{formatCurrency(product.price)}</p>
                                )}
                                <div className="mt-auto pt-3">
                                  {quantity > 0 ? (
                                    <div className="flex w-fit items-center gap-0.5 rounded-full border border-black/[0.06] bg-neutral-50 p-0.5">
                                      <button type="button" onClick={() => { if (product.optionGroups?.length) { decreaseQuantityForProduct(product.id); } else { updateCartItem(product.id, { quantity: quantity - 1 }); } }} className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 transition-all hover:bg-white active:scale-90" aria-label={`Quitar una unidad de ${product.name}`}>
                                        {quantity === 1 ? (
                                          <svg className="h-3 w-3 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                        ) : (
                                          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20 12H4" /></svg>
                                        )}
                                      </button>
                                      <span className="flex h-7 w-7 items-center justify-center text-xs font-bold text-neutral-900">{quantity}</span>
                                      <button type="button" onClick={() => addToCart(product)} className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 transition-all hover:bg-white active:scale-90" aria-label={`Agregar una unidad de ${product.name}`}>
                                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
                                      </button>
                                    </div>
                                  ) : (
                                    <button type="button" onClick={() => addToCart(product)} disabled={!restaurant.isOpen} className="w-full rounded-xl bg-neutral-900 py-2.5 text-[11px] font-bold text-white transition hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-400">
                                      Agregar
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </article>
                        ) : (
                          <article id={product.id} key={product.id} className="overflow-hidden rounded-2xl border border-black/[0.04] bg-white transition-all duration-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)]">
                            <div className="flex gap-3 p-3">
                              <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl sm:h-28 sm:w-28">
                                {product.image ? (
                                  <>
                                    <img
                                      src={(product.images?.length ?? 0) > 1 && carouselIndexMap[product.id] ? product.images![carouselIndexMap[product.id]] : product.image}
                                      alt={product.name}
                                      className="h-full w-full object-cover transition-opacity duration-300"
                                      style={{ objectPosition: product.imagePosition || undefined }}
                                      loading="lazy"
                                      decoding="async"
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
                              </div>
                              <div className="flex min-w-0 flex-1 flex-col">
                                <div className="flex flex-col gap-0.5">
                                  <h3 className="truncate text-sm font-bold text-neutral-900">{product.name}</h3>
                                  {product.description && (
                                    <p className="text-xs leading-relaxed text-neutral-500 line-clamp-2">{product.description}</p>
                                  )}
                                  <div className="mt-0.5">
                                    {product.sellBy === 'WEIGHT' ? (
                                      <span className="text-sm font-bold text-neutral-900">{formatCurrency(product.unitPrice || product.price)}/kg</span>
                                    ) : product.discountPrice ? (
                                      <div className="flex items-baseline gap-1.5">
                                        <span className="text-sm font-bold text-rose-600">{formatCurrency(product.discountPrice)}</span>
                                        <span className="text-[10px] text-neutral-400 line-through">{formatCurrency(product.price)}</span>
                                      </div>
                                    ) : (
                                      <span className="text-sm font-bold text-neutral-900">{formatCurrency(product.price)}</span>
                                    )}
                                  </div>
                                </div>
                                <div className="mt-auto pt-3">
                                  {quantity > 0 ? (
                                    <div className="flex w-fit items-center gap-0.5 rounded-full border border-black/[0.06] bg-neutral-50 p-0.5">
                                      <button type="button" onClick={() => { if (product.optionGroups?.length) { decreaseQuantityForProduct(product.id); } else { updateCartItem(product.id, { quantity: quantity - 1 }); } }} className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 transition-all hover:bg-white active:scale-90" aria-label={`Quitar una unidad de ${product.name}`}>
                                        {quantity === 1 ? (
                                          <svg className="h-3 w-3 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                        ) : (
                                          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20 12H4" /></svg>
                                        )}
                                      </button>
                                      <span className="flex h-7 w-7 items-center justify-center text-xs font-bold text-neutral-900">{quantity}</span>
                                      <button type="button" onClick={() => addToCart(product)} className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 transition-all hover:bg-white active:scale-90" aria-label={`Agregar una unidad de ${product.name}`}>
                                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
                                      </button>
                                    </div>
                                  ) : (
                                    <button type="button" onClick={() => addToCart(product)} disabled={!restaurant.isOpen} className="w-full rounded-xl bg-neutral-900 py-2.5 text-[11px] font-bold text-white transition hover:bg-neutral-800 disabled:bg-neutral-200 disabled:text-neutral-400">
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
                      {(isPromoCarousel || isLargeCategory) && <div className="w-4 shrink-0 sm:w-8" />}
                    </div>
                     
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

                {/* Mensaje de Smart Stacking */}
                {(activeOrderDetailsMap[selectedOrderId] as any).isSecondInRoute && (
                  <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-2xl border border-blue-100 text-blue-800 text-sm">
                    <span className="text-xl">🛵</span>
                    <p className="font-medium">
                      Tu repartidor está entregando un pedido cercano en tu ruta. ¡Llegará pronto!
                    </p>
                  </div>
                )}

                {/* BOTÓN DE CHAT */}
                {['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED'].includes(activeOrderDetailsMap[selectedOrderId].status) && (
                  <button
                    onClick={() => {
                      setIsDetailModalOpen(false);
                      setIsChatOpen(true);
                      void loadChatMessages(selectedOrderId!);
                    }}
                    className="w-full flex items-center justify-center gap-3 p-4 bg-neutral-900 hover:bg-neutral-800 text-white rounded-2xl font-bold shadow-lg shadow-neutral-900/20 transition-all active:scale-[0.98] active-scale group"
                  >
                    <svg className="w-5 h-5 text-white/80 group-hover:text-white transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
                    <span>Contactar Soporte / Tienda</span>
                    {(unreadMessagesMap[selectedOrderId] || 0) > 0 && (
                      <span className="ml-2 bg-rose-500 text-white text-xs px-2.5 py-0.5 rounded-full font-bold animate-pulse">
                        {unreadMessagesMap[selectedOrderId]}
                      </span>
                    )}
                  </button>
                )}

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
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/></svg>
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
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/></svg>
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
                <div className="w-10 h-10 rounded-xl bg-sky-500 flex items-center justify-center text-white font-bold shadow-md shadow-sky-200">
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
                <svg className="w-6 h-6 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Feed de Mensajes */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-neutral-50/50">
              {loadingChat ? (
                <div className="h-full flex items-center justify-center text-neutral-500">
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin"></div>
                    <p className="text-sm">Cargando chat...</p>
                  </div>
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
                            ? 'bg-sky-500 text-white rounded-br-sm'
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
                  className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-xl bg-sky-500 text-white transition hover:bg-sky-600 active:scale-95 active-scale disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-sky-200"
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
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[45] w-[calc(100%-2rem)] max-w-sm pointer-events-auto">
          <button
            type="button"
            onClick={() => setIsCartOpen(true)}
            className={`group relative flex w-full items-center justify-between overflow-hidden rounded-full bg-neutral-950 px-5 py-3.5 shadow-[0_8px_30px_rgb(0,0,0,0.2)] transition-all hover:scale-[1.02] active:scale-[0.98] active-scale ${
              cartJustUpdated ? 'scale-[1.05] ring-4 ring-[#0ea5e9]/40' : ''
            }`}
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
              <svg className="h-4 w-4 text-white/70 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
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
            <svg className="h-4 w-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          ) : (
            <svg className="h-4 w-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          )}
          <span className="font-medium">{toastMsg}</span>
        </div>
      ) : null}

      <audio id="customer-alert-audio" src="/sounds/notifica.wav" preload="auto"></audio>
      <audio id="chat-message-audio" src="/sounds/mensaje.wav" preload="auto"></audio>
      <audio id="customer-llegue-audio" src="/sounds/llegue.wav" preload="auto"></audio>

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onSuccess={handleLoginSuccess}
        apiBase={apiBase}
      />

      {/* Quick View Modal for Stores */}
      {previewProduct && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm px-3 py-4 sm:px-6 sm:py-8"
          onClick={() => setPreviewProduct(null)}
        >
          <div
            className="relative flex w-full max-w-4xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl sm:flex-row sm:max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              type="button"
              onClick={() => setPreviewProduct(null)}
              className="absolute right-3 top-3 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-neutral-700 shadow-md backdrop-blur-sm transition hover:bg-white hover:scale-105 active:scale-95"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>

            {/* Image section */}
            <div className="relative flex w-full items-center justify-center bg-neutral-50 sm:w-[55%] sm:min-h-[500px]">
              <img
                src={previewProduct.images[previewIndex]}
                alt={previewProduct.name}
                className="h-64 w-full object-contain p-6 sm:h-full sm:max-h-[500px] sm:p-8"
              />
              {previewProduct.discountPrice && (
                <div className="absolute left-4 top-4 z-10 rounded-full bg-rose-500/90 px-3 py-1 text-[11px] font-bold text-white shadow-lg backdrop-blur-sm">
                  -{Math.round((1 - previewProduct.discountPrice / previewProduct.price) * 100)}%
                </div>
              )}
              {previewProduct.images.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => setPreviewIndex((prev) => (prev - 1 + previewProduct.images.length) % previewProduct.images.length)}
                    className="absolute left-2 top-1/2 z-10 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-neutral-700 shadow-md backdrop-blur-sm transition hover:bg-white hover:scale-105 active:scale-95"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewIndex((prev) => (prev + 1) % previewProduct.images.length)}
                    className="absolute right-2 top-1/2 z-10 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-neutral-700 shadow-md backdrop-blur-sm transition hover:bg-white hover:scale-105 active:scale-95"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
                  </button>
                  <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 gap-1.5">
                    {previewProduct.images.map((_, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setPreviewIndex(idx)}
                        className={`h-1.5 rounded-full transition-all duration-300 ${idx === previewIndex ? 'w-5 bg-neutral-900' : 'w-1.5 bg-neutral-300 hover:bg-neutral-500'}`}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Details section */}
            <div className="flex w-full flex-col justify-between p-5 sm:w-[45%] sm:p-7">
              <div className="overflow-y-auto">
                <h2 className="text-xl font-bold leading-tight text-neutral-900 sm:text-2xl">{previewProduct.name}</h2>
                {previewProduct.description && (
                  <p className="mt-3 text-sm leading-relaxed text-neutral-600">{previewProduct.description}</p>
                )}
                <div className="mt-5">
                  {previewProduct.sellBy === 'WEIGHT' ? (
                    <p className="text-2xl font-bold text-neutral-900">{formatCurrency(previewProduct.unitPrice || previewProduct.price)}<span className="text-base font-medium text-neutral-500">/kg</span></p>
                  ) : previewProduct.discountPrice ? (
                    <div className="space-y-1">
                      <div className="flex items-baseline gap-2.5">
                        <span className="text-2xl font-bold text-rose-600">{formatCurrency(previewProduct.discountPrice)}</span>
                        <span className="text-sm text-neutral-400 line-through">{formatCurrency(previewProduct.price)}</span>
                      </div>
                      <span className="inline-block rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-600">
                        Ahorras {formatCurrency(previewProduct.price - previewProduct.discountPrice)}
                      </span>
                    </div>
                  ) : (
                    <p className="text-2xl font-bold text-neutral-900">{formatCurrency(previewProduct.price)}</p>
                  )}
                </div>
              </div>
              <div className="mt-6 flex items-center gap-3 border-t border-neutral-100 pt-5">
                {previewProduct.optionGroups?.length ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPreviewProduct(null);
                      addToCart(previewProduct as any);
                    }}
                    className="flex-1 rounded-xl bg-neutral-900 py-3.5 text-sm font-bold text-white shadow-lg shadow-neutral-900/20 transition hover:bg-neutral-800 active:scale-[0.97]"
                  >
                    Personalizar y agregar
                  </button>
                ) : (() => {
                  const qty = getCartQuantity(previewProduct.id);
                  return qty > 0 ? (
                    <div className="flex w-full items-center justify-between rounded-xl bg-neutral-50 p-1">
                      <button
                        type="button"
                        onClick={() => {
                          if (qty <= 1) {
                            setPreviewProduct(null);
                          }
                          updateCartItem(previewProduct.id, { quantity: qty - 1 });
                        }}
                        className="flex h-10 w-10 items-center justify-center rounded-lg text-neutral-500 transition hover:bg-white hover:text-neutral-800 active:scale-90"
                      >
                        {qty === 1 ? (
                          <svg className="h-4 w-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        ) : (
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20 12H4" /></svg>
                        )}
                      </button>
                      <span className="flex h-10 w-10 items-center justify-center text-base font-bold text-neutral-900">{qty}</span>
                      <button
                        type="button"
                        onClick={() => addToCart(previewProduct as any)}
                        className="flex h-10 w-10 items-center justify-center rounded-lg text-neutral-500 transition hover:bg-white hover:text-neutral-800 active:scale-90"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => addToCart(previewProduct as any)}
                      className="flex-1 rounded-xl bg-neutral-900 py-3.5 text-sm font-bold text-white shadow-lg shadow-neutral-900/20 transition hover:bg-neutral-800 active:scale-[0.97]"
                    >
                      Agregar al carrito
                    </button>
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

function CompactActiveOrderBanner({
  order,
  onOpenHistory,
  onOpenChat,
  carouselLabel,
  unreadCount = 0,
  isTrackingEnabled = false,
  setIsTrackingEnabled,
  driverLocation,
}: {
  order: CustomerOrderDetail;
  onOpenHistory: () => void;
  onOpenChat: () => void;
  carouselLabel?: string;
  unreadCount?: number;
  isTrackingEnabled?: boolean;
  setIsTrackingEnabled?: (val: boolean) => void;
  driverLocation?: { lat: number; lng: number } | null;
}) {
  const [currentTimestamp, setCurrentTimestamp] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTimestamp(Date.now());
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  const hasDriverArrived = order.status === 'IN_TRANSIT' && (order as any).tracking?.some((t: any) => t.notes === 'DRIVER_ARRIVED');
  const activeStatus = hasDriverArrived ? 'DRIVER_ARRIVED' : order.status;
  const isPickup = (order as any).fulfillmentType === 'PICKUP';

  const steps = buildTimelineSteps(order, activeStatus);
  const dynamicRemainingText = formatEstimatedArrivalMinutes(order.estimatedDeliveryTime, activeStatus, currentTimestamp, order.restaurant?.businessType, (order as any).fulfillmentType);

  // Calcular el progreso de la barra
  const doneCount = steps.filter(s => s.state === 'done').length;
  const activeCount = steps.filter(s => s.state === 'active').length;
  const progressPercent = Math.max(0, Math.min(100, ((doneCount + activeCount - 1) / (steps.length - 1)) * 100));

  // Paso activo actual
  const activeStep = steps.find(s => s.state === 'active') || steps[steps.length - 1];

  return (
    <section className="rounded-[20px] border border-black/[0.04] bg-white px-4 py-3.5 shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
      {/* Fila principal: estado + tiempo + acciones */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {/* Indicador animado */}
          <div className="relative shrink-0">
            <div className="w-10 h-10 rounded-2xl bg-neutral-950 flex items-center justify-center">
              <span className="text-lg">
                {activeStatus === 'DELIVERED' ? '✅' :
                 activeStatus === 'PICKED_UP' && isPickup ? '🛍️' :
                 activeStatus === 'PICKED_UP' ? '🛵' :
                 activeStatus === 'IN_TRANSIT' ? '🛵' :
                 activeStatus === 'DRIVER_ARRIVED' ? '📍' :
                 activeStatus === 'READY' ? '📦' :
                 order?.restaurant?.businessType && order.restaurant.businessType !== 'RESTAURANT' ? '📦' : '🍳'}
              </span>
            </div>
            {!['DELIVERED', 'CANCELLED', 'REJECTED'].includes(activeStatus) && (
              <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 border-2 border-white"></span>
              </span>
            )}
          </div>

          {/* Info condensada */}
          <div className="min-w-0">
            <p className="text-sm font-bold text-neutral-900 truncate">{activeStep?.label || 'Procesando'}</p>
            {dynamicRemainingText ? (
              <p className="text-xs text-neutral-500 mt-0.5 truncate">{dynamicRemainingText}</p>
            ) : (
              <p className="text-xs text-neutral-500 mt-0.5 truncate">{order.restaurant.name}</p>
            )}
            {isPickup && order.dailyCounter && (
              <span className="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full bg-neutral-100 border border-neutral-200 text-[9px] font-bold text-neutral-600">
                Pedido #{String(order.dailyCounter).padStart(3, '0')}
              </span>
            )}
          </div>
        </div>

        {/* Acciones */}
        <div className="shrink-0 flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenChat}
            title="Chat"
            className="relative flex items-center justify-center w-9 h-9 rounded-full bg-sky-500 hover:bg-sky-600 active:scale-95 active-scale text-white shadow-sm transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center px-1 animate-bounce shadow-sm">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={onOpenHistory}
            className="rounded-full bg-neutral-100 hover:bg-neutral-200 px-3.5 py-2 text-xs font-semibold text-neutral-800 transition-colors active:scale-[0.97] active-scale"
          >
            Detalle
          </button>
        </div>
      </div>

      {/* PIN de recolección para pickup */}
      {isPickup && (order as any).pickupPin && ['READY', 'PICKED_UP', 'IN_TRANSIT'].includes(activeStatus) && (
        <div className="mt-3 flex items-center justify-center gap-2 py-2 px-3 bg-emerald-50/60 border border-emerald-200/60 rounded-xl">
          <span className="text-[9px] font-bold text-emerald-600 uppercase tracking-wider">PIN de recolección:</span>
          <span className="text-base font-black tracking-[0.25em] text-emerald-900 font-mono">{(order as any).pickupPin}</span>
        </div>
      )}

      {/* Botón cómo llegar para pickup */}
      {isPickup && ['READY', 'PICKED_UP'].includes(activeStatus) && (order as any)?.restaurant?.latitude && (order as any)?.restaurant?.longitude && (
        <a
          href={`https://www.google.com/maps/dir/?api=1&destination=${(order as any).restaurant.latitude},${(order as any).restaurant.longitude}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 w-full flex items-center justify-center gap-2.5 rounded-full border-2 border-sky-200 bg-sky-50 py-3 text-sm font-bold text-sky-700 shadow-sm transition hover:bg-sky-100 hover:shadow-md active:scale-[0.97]"
        >
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Cómo llegar
        </a>
      )}

      {/* deliveryPin en banner compacto */}
      {!isPickup && ((order.deliveryPin || order.handoverPin) && ['READY', 'PICKED_UP', 'IN_TRANSIT'].includes(activeStatus)) && (
        <div className="mt-3 flex items-center justify-center gap-2 py-2 px-3 bg-indigo-50/60 border border-indigo-200/60 rounded-xl">
          <span className="text-[9px] font-bold text-indigo-600 uppercase tracking-wider">PIN de entrega:</span>
          <span className="text-base font-black tracking-[0.25em] text-indigo-900 font-mono">{order.deliveryPin || order.handoverPin}</span>
        </div>
      )}

      {/* Barra de progreso minimal */}
      <div className="mt-3 mb-1">
        <div className="h-1 w-full bg-neutral-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-neutral-900 rounded-full transition-all duration-700 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="flex justify-between mt-1.5">
          {steps.map((step) => {
            const isDone = step.state === 'done';
            const isActive = step.state === 'active';
            return (
              <span
                key={step.key}
                className={`text-[9px] font-medium ${
                  isActive ? 'text-neutral-900 font-bold' :
                  isDone ? 'text-neutral-500' : 'text-neutral-300'
                }`}
              >
                {step.label}
              </span>
            );
          })}
        </div>
      </div>

      {!isPickup && ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'PICKED_UP', 'IN_TRANSIT', 'DRIVER_ARRIVED'].includes(order.status) && (
        <div className="border-t border-black/[0.05] mt-4 pt-3">
          {isTrackingEnabled ? (
            <div className="space-y-2">
              <LiveTrackingMap order={order} driverLocation={driverLocation || null} />
              <button
                type="button"
                onClick={() => setIsTrackingEnabled && setIsTrackingEnabled(false)}
                className="w-full text-xs font-semibold py-2 px-3 rounded-lg border border-black/10 hover:bg-neutral-50 text-neutral-600 flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] active-scale"
              >
                <span>📴 Desactivar mapa (Ahorrar datos)</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsTrackingEnabled && setIsTrackingEnabled(true)}
              className="w-full py-2 px-3 rounded-xl border border-dashed border-neutral-300 hover:border-neutral-400 bg-neutral-50/50 flex items-center justify-between text-left hover:bg-neutral-50 transition-all active:scale-[0.98] active-scale group"
            >
              <div className="flex items-center gap-2.5">
                <span className="text-base group-hover:scale-110 transition-transform">🛵</span>
                <div>
                  <p className="text-xs font-bold text-neutral-900">Seguimiento en Vivo</p>
                  <p className="text-[10px] text-neutral-500">Sigue la ubicación de tu repartidor en tiempo real</p>
                </div>
              </div>
              <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 py-1 px-2.5 rounded-full group-hover:bg-indigo-100 transition-colors">
                Seguir
              </span>
            </button>
          )}
        </div>
      )}
    </section>
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
    <label className="grid gap-2 text-sm text-neutral-600">
      <span className="font-medium text-neutral-800">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-neutral-950 outline-none transition placeholder:text-neutral-400 focus:border-black/20"
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
  onRefundAction,
  apiBase,
  token,
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
      iconCircle: 'bg-sky-50 text-sky-600 border-sky-200',
      badge: 'bg-sky-50 text-sky-700 border-sky-200',
      label: 'Información',
    },
  } as const;

  const s = styles[notice.tone];

  const isTransferRefund = notice.tone === 'danger' && notice.paymentMethod === 'TRANSFER' && notice.orderId;

  const [contact, setContact] = useState('');
  const [proofName, setProofName] = useState('');
  const [proofSource, setProofSource] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

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
          success ? (
            <div className="mt-6 w-full text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 border border-emerald-200">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="mt-3 text-sm font-bold text-neutral-900">¡Reporte Enviado!</p>
              <p className="mt-1 text-xs text-neutral-500 leading-relaxed max-w-[280px] mx-auto">
                Tu reporte ha sido registrado con éxito. El administrador revisará tu comprobante y se pondrá en contacto contigo para realizar el reembolso.
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
            <div className="w-full mt-5 space-y-3.5">
              <div className="rounded-2xl bg-neutral-50 p-4 border border-neutral-200/60 text-left">
                <p className="text-sm font-semibold text-neutral-800 leading-relaxed">
                  Tu pago fue por transferencia. Para procesar el reembolso, comparte tus datos de contacto y el comprobante.
                </p>
              </div>

              <div className="w-full text-left">
                <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-600 block mb-1.5">
                  Teléfono o medio de contacto
                </label>
                <input
                  type="text"
                  placeholder="Celular o cuenta destino"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  className="w-full bg-white border border-neutral-200 rounded-xl px-4 py-3 text-sm text-neutral-800 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-950/10 focus:border-neutral-400 transition"
                />
              </div>

              <div className="w-full text-left">
                <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-600 block mb-1.5">
                  Comprobante de transferencia
                </label>
                <div className="relative group border border-dashed border-neutral-200 hover:border-neutral-400 bg-white/70 hover:bg-white transition rounded-xl p-3 flex flex-col items-center justify-center cursor-pointer text-center">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        const base64 = await convertImageFileToDataUrl(file, 900, 900, 0.7);
                        setProofName(file.name);
                        setProofSource(base64);
                        setErrorMsg('');
                      } catch (err: any) {
                        setErrorMsg(err.message || 'Error al procesar la imagen');
                      }
                    }}
                    className="absolute inset-0 opacity-0 cursor-pointer z-10"
                  />
                  {proofSource ? (
                    <div className="w-full relative z-0">
                      <div className="mx-auto h-16 w-16 overflow-hidden rounded-lg border border-neutral-100 bg-neutral-50 shadow-sm relative group-hover:opacity-90 transition">
                        <img src={proofSource} alt="Preview" className="h-full w-full object-cover" loading="lazy" decoding="async" />
                      </div>
                      <p className="mt-1 text-[11px] font-semibold text-neutral-700 truncate max-w-xs mx-auto">{proofName || 'comprobante.jpg'}</p>
                      <p className="text-[9px] text-neutral-400">Toca para cambiar</p>
                    </div>
                  ) : (
                    <div className="relative z-0">
                      <svg className="h-5 w-5 text-neutral-400 mb-1 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <span className="text-[11px] font-bold text-neutral-600 block">Subir comprobante</span>
                      <span className="text-[8px] text-neutral-400 mt-0.5 block">JPG, PNG. Máx 3MB</span>
                    </div>
                  )}
                </div>
              </div>

              {errorMsg && (
                <p className="w-full text-left text-[11px] font-semibold text-amber-600 bg-amber-50/50 p-2 rounded-lg border border-amber-100">
                  {errorMsg}
                </p>
              )}

              <div className="mt-4 flex flex-col gap-2 w-full">
                <button
                  type="button"
                  disabled={submitting || !contact.trim()}
                  onClick={async () => {
                    if (!contact.trim()) return;
                    setSubmitting(true);
                    setErrorMsg('');
                    try {
                      let uploadedUrl = '';
                      if (proofSource) {
                        uploadedUrl = await persistTransferProof({
                          apiBase: apiBase || '/api',
                          token: token || localStorage.getItem('sadel.customer.token') || '',
                          source: proofSource,
                          fileName: proofName,
                        });
                      }

                      const response = await fetch(`${apiBase || '/api'}/customer/support/tickets`, {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          'Authorization': `Bearer ${token || localStorage.getItem('sadel.customer.token')}`,
                        },
                        body: JSON.stringify({
                          type: 'ORDER',
                          subject: `Reembolso por Transferencia - Pedido #${notice.orderReference || notice.orderId || 'SAD'}`,
                          description: `Contacto de reembolso: ${contact}\nComprobante de pago: ${uploadedUrl || 'No proporcionado'}\n\nDetalles adicionales: El restaurante rechazó el pedido #${notice.orderReference || notice.orderId || 'SAD'} pagado por transferencia.`,
                          storeName: 'SaDeL',
                          orderNumber: notice.orderReference || notice.orderId || 'SAD',
                        }),
                      });

                      if (response.status === 404) {
                        const localTicketsStr = localStorage.getItem('local_support_tickets');
                        const localTickets = localTicketsStr ? JSON.parse(localTicketsStr) : [];
                        const newTicket = {
                          id: `local_${Date.now()}`,
                          type: 'ORDER',
                          storeName: 'SaDeL',
                          orderNumber: notice.orderReference || notice.orderId || 'SAD',
                          description: `Contacto de reembolso: ${contact}\nComprobante de pago: ${uploadedUrl || 'No proporcionado'}\n\nDetalles adicionales: El restaurante rechazó el pedido #${notice.orderReference || notice.orderId || 'SAD'} pagado por transferencia.`,
                          createdAt: new Date().toISOString(),
                        };
                        localStorage.setItem('local_support_tickets', JSON.stringify([newTicket, ...localTickets]));
                        setSuccess(true);
                        return;
                      }

                      const data = await response.json();
                      if (data.success) {
                        setSuccess(true);
                      } else {
                        setErrorMsg(data.error?.message || 'No se pudo enviar el reporte.');
                      }
                    } catch (err: any) {
                      console.error(err);
                      setErrorMsg('Error de red al enviar el reporte. Por favor inténtalo de nuevo.');
                    } finally {
                      setSubmitting(false);
                    }
                  }}
                  className="w-full rounded-full bg-neutral-950 hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.97] text-white py-3 text-sm font-bold shadow-lg shadow-neutral-950/20 transition flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <>
                      <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Enviando reporte...
                    </>
                  ) : (
                    'Enviar reporte de reembolso'
                  )}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full rounded-full border border-neutral-200 bg-transparent px-6 py-3 text-sm font-semibold text-neutral-600 transition hover:bg-neutral-50 active:scale-[0.97]"
                >
                  Cerrar
                </button>
              </div>
            </div>
          )
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

function formatDate(date: string) {
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(date));
}

function formatShortTime(date: Date) {
  return new Intl.DateTimeFormat('es-MX', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function getEtaWindowMinutes(status: string) {
  if (status === 'PENDING') {
    return { early: 5, late: 5 };
  }

  if (status === 'CONFIRMED' || status === 'PREPARING') {
    return { early: 4, late: 4 };
  }

  if (status === 'READY' || status === 'PICKED_UP') {
    return { early: 3, late: 3 };
  }

  if (status === 'IN_TRANSIT') {
    return { early: 2, late: 3 };
  }

  return { early: 0, late: 0 };
}

function formatEstimatedArrivalWindow(estimatedDeliveryTime: string, status: string, currentTimestamp: number = Date.now()) {
  const etaDate = new Date(estimatedDeliveryTime);

  if (Number.isNaN(etaDate.getTime())) {
    return 'Calculando...';
  }

  if (status === 'DELIVERED') {
    return `Entregado ${formatShortTime(etaDate)}`;
  }

  if (status === 'CANCELLED' || status === 'REJECTED') {
    return formatDate(estimatedDeliveryTime);
  }

  const windowMinutes = getEtaWindowMinutes(status);
  let start = new Date(etaDate.getTime() - windowMinutes.early * 60 * 1000);
  let end = new Date(etaDate.getTime() + windowMinutes.late * 60 * 1000);

  // If delayed, adjust window start dynamically to avoid displaying times in the past
  if (['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'PICKED_UP', 'IN_TRANSIT'].includes(status) && currentTimestamp > start.getTime()) {
    let bufferMinutes = 3;
    if (status === 'PENDING') bufferMinutes = 8;
    else if (status === 'CONFIRMED' || status === 'PREPARING') bufferMinutes = 5;
    else if (status === 'READY' || status === 'PICKED_UP') bufferMinutes = 3;
    else if (status === 'IN_TRANSIT') bufferMinutes = 2;

    start = new Date(currentTimestamp + bufferMinutes * 60 * 1000);
    // Keep a tight window even when delayed
    const delayedWindowSize = windowMinutes.early + windowMinutes.late;
    end = new Date(start.getTime() + delayedWindowSize * 60 * 1000);
  }

  return `Entre ${formatShortTime(start)} y ${formatShortTime(end)}`;
}

function formatEstimatedArrivalMinutes(estimatedDeliveryTime: string, status: string, currentTimestamp: number, businessType?: string | null, fulfillmentType?: 'DELIVERY' | 'PICKUP') {
  const etaDate = new Date(estimatedDeliveryTime);
  if (Number.isNaN(etaDate.getTime())) {
    return null;
  }

  if (['DELIVERED', 'CANCELLED', 'REJECTED', 'PENDING', 'DRIVER_ARRIVED'].includes(status)) {
    return null;
  }

  const msUntilEta = etaDate.getTime() - currentTimestamp;
  const prefix = fulfillmentType === 'PICKUP' ? 'Listo para recoger' : 'Llega';

  if (businessType && businessType !== 'RESTAURANT' && msUntilEta > 3 * 60 * 60 * 1000) {
    const timeStr = etaDate.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    const now = new Date(currentTimestamp);
    if (etaDate.toDateString() === now.toDateString()) {
      return `${prefix} aprox. ${timeStr}`;
    }
    const dayStr = etaDate.toLocaleDateString('es-MX', { weekday: 'long' });
    return `${prefix} aprox. ${dayStr} ${timeStr}`;
  }

  if (msUntilEta > 60 * 60 * 1000) {
    const timeStr = etaDate.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    const now = new Date(currentTimestamp);
    if (etaDate.toDateString() === now.toDateString()) {
      return `${prefix} aprox. ${timeStr}`;
    }
    const dayStr = etaDate.toLocaleDateString('es-MX', { weekday: 'long' });
    return `${prefix} aprox. ${dayStr} ${timeStr}`;
  }

  const windowMinutes = getEtaWindowMinutes(status);
  
  const startDiffMs = (etaDate.getTime() - windowMinutes.early * 60 * 1000) - currentTimestamp;
  const endDiffMs = (etaDate.getTime() + windowMinutes.late * 60 * 1000) - currentTimestamp;
  
  const startMin = Math.max(0, Math.round(startDiffMs / 60000));
  const endMin = Math.max(1, Math.round(endDiffMs / 60000));

  if (endMin <= 1) {
    return fulfillmentType === 'PICKUP' ? 'Listo para recoger en cualquier momento 🛍️' : 'Llega en cualquier momento 🛵';
  }

  if (startMin === 0) {
    return fulfillmentType === 'PICKUP' ? `Listo para recoger en menos de ${endMin} min 🛍️` : `Llega en menos de ${endMin} min 🛵`;
  }

  return fulfillmentType === 'PICKUP' ? `Listo para recoger en ${startMin} - ${endMin} min 🛍️` : `Llega en ${startMin} - ${endMin} min 🛵`;
}

function getEtaMessage(order: CustomerOrderDetail | null) {
  if (!order) return null;

  if (order.etaExtendedMinutes && order.etaExtendedMinutes > 0) {
    return {
      type: 'warning' as const,
      text: `${getBusinessArticleCapitalized(order.restaurant?.businessType)} ${getBusinessRef(order.restaurant?.businessType)} extendió el tiempo de preparación por ${order.etaExtendedMinutes} min para que tu orden quede perfecta.`,
    };
  }

  if (['READY', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED'].includes(order.status)) {
    const readyTracking = order.tracking?.find(t => t.status === 'READY');
    if (readyTracking && order.preparationDeadlineAt) {
      const readyTime = new Date(readyTracking.createdAt).getTime();
      const deadlineTime = new Date(order.preparationDeadlineAt).getTime();
      const differenceMinutes = Math.round((deadlineTime - readyTime) / 60000);
      if (differenceMinutes >= 3) {
        return {
          type: 'success' as const,
          text: `¡Tu comida se preparó súper rápido! Estuvo lista ${differenceMinutes} min antes de lo esperado.`,
        };
      }
    }
  }

  return null;
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
let searchTimeout: NodeJS.Timeout | null = null;
let placesService: any = null;

async function searchAddress(query: string, setAddressSuggestions: (val: any[]) => void, setIsSearchingAddress: (val: boolean) => void) {
  if (!query.trim() || query.length < 3) {
    setAddressSuggestions([]);
    return;
  }

  setIsSearchingAddress(true);

  if (searchTimeout) {
    clearTimeout(searchTimeout);
  }

  searchTimeout = setTimeout(async () => {
    try {
      const google = (window as any).google;
      if (!google || !google.maps || !google.maps.places) {
        setIsSearchingAddress(false);
        return;
      }

      if (!autocompleteSessionToken) {
        autocompleteSessionToken = new google.maps.places.AutocompleteSessionToken();
      }

      const { suggestions: predictions } = await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: query,
        sessionToken: autocompleteSessionToken,
        includedRegionCodes: ['mx']
      });

      if (!predictions || predictions.length === 0) {
        setAddressSuggestions([]);
        setIsSearchingAddress(false);
        return;
      }

      const mappedSuggestions = predictions.map((suggestion: any) => ({
        name: suggestion.placePrediction.text.value,
        description: '',
        place_id: suggestion.placePrediction.placeId,
      }));

      setAddressSuggestions(mappedSuggestions);
      setIsSearchingAddress(false);
    } catch (err) {
      console.error('Error searching address:', err);
      setIsSearchingAddress(false);
    }
  }, 500);
}

function handleSelectSuggestion(
  suggestion: any,
  setCheckoutForm: any,
  setAddressSearchQuery: any,
  setAddressSuggestions: any,
  setNewAddressStep: any
) {
  const google = (window as any).google;
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
  );
}

function orderStatusLabel(status: OrderStatus, businessType?: string): string {
  return getOrderStatusLabel(status, businessType);
}

const statusPaletteMap: Record<OrderStatus, string> = {
  PENDING: 'border-amber-200 bg-amber-50 text-amber-700',
  CONFIRMED: 'border-sky-200 bg-sky-50 text-sky-700',
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

function buildTimelineSteps(order: CustomerOrderDetail, activeStatusOverride?: string) {
  const status = activeStatusOverride || order.status;
  const isPickup = order.fulfillmentType === 'PICKUP';

  if (isPickup) {
    return [
      {
        key: 'kitchen',
        label: getOrderStatusLabel('PREPARING', order.restaurant?.businessType),
        description: status === 'PENDING'
          ? `${getBusinessArticleCapitalized(order.restaurant?.businessType)} ${getBusinessRef(order.restaurant?.businessType)} está revisando tu solicitud`
          : 'Estamos preparando tu pedido',
        state: status === 'PENDING' || status === 'CONFIRMED' || status === 'PREPARING'
          ? 'active'
          : ['READY', 'PICKED_UP', 'IN_TRANSIT', 'DRIVER_ARRIVED', 'DELIVERED'].includes(status)
            ? 'done'
            : 'pending',
      },
      {
        key: 'ready',
        label: 'Pedido listo',
        description: `Tu pedido está listo para recoger en ${order.restaurant.name}`,
        state: status === 'READY'
          ? 'active'
          : ['PICKED_UP', 'IN_TRANSIT', 'DRIVER_ARRIVED', 'DELIVERED'].includes(status)
            ? 'done'
            : 'pending',
      },
      {
        key: 'picked_up',
        label: 'Recogido',
        description: 'Ya recogiste tu pedido. ¡Buen provecho!',
        state: ['PICKED_UP', 'IN_TRANSIT', 'DRIVER_ARRIVED', 'DELIVERED'].includes(status)
          ? 'done'
          : 'pending',
      },
    ] as Array<{
      key: string;
      label: string;
      description: string;
      state: 'done' | 'active' | 'pending';
    }>;
  }

  return [
    {
      key: 'kitchen',
      label: getOrderStatusLabel('PREPARING', order.restaurant?.businessType),
      description: status === 'PENDING'
        ? `${getBusinessArticleCapitalized(order.restaurant?.businessType)} ${getBusinessRef(order.restaurant?.businessType)} está revisando tu solicitud`
        : 'Estamos preparando tu pedido',
      state: status === 'PENDING' || status === 'CONFIRMED' || status === 'PREPARING'
        ? 'active'
        : ['READY', 'PICKED_UP', 'IN_TRANSIT', 'DRIVER_ARRIVED', 'DELIVERED'].includes(status)
          ? 'done'
          : 'pending',
    },
    {
      key: 'ready',
      label: 'Pedido listo',
      description: `${getBusinessArticleCapitalized(order.restaurant?.businessType)} ${getBusinessRef(order.restaurant?.businessType)} ha confirmado que tu pedido está listo`,
      state: status === 'READY'
        ? 'active'
        : ['PICKED_UP', 'IN_TRANSIT', 'DRIVER_ARRIVED', 'DELIVERED'].includes(status)
          ? 'done'
          : 'pending',
    },
    {
      key: 'transit',
      label: status === 'DRIVER_ARRIVED' ? '¡Tu pedido ha llegado! 📍' : 'En camino',
      description: status === 'DRIVER_ARRIVED' ? 'Sal a recibir a tu repartidor' : 'El repartidor está en camino, tu pedido llega pronto',
      state: status === 'PICKED_UP' || status === 'IN_TRANSIT' || status === 'DRIVER_ARRIVED'
        ? 'active'
        : status === 'DELIVERED'
          ? 'done'
          : 'pending',
    },
    {
      key: 'delivered',
      label: 'Entregado',
      description: 'El pedido llegó a tu domicilio.',
      state: status === 'DELIVERED' ? 'done' : 'pending',
    },
  ] as Array<{
    key: string;
    label: string;
    description: string;
    state: 'done' | 'active' | 'pending';
  }>;
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
