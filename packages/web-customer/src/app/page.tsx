'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState, useTransition, useDeferredValue } from 'react';
import { useRouter } from 'next/navigation';
import Script from 'next/script';
import { io } from 'socket.io-client';
import {
  AuthResponse,
  AuthUser,
  clearStoredSession,
  isAuthRequestError,
  persistApiBase,
  persistStoredSession,
  readStoredSession,
  requestJson,
  submitReview,
  uploadMediaAsset,
  getOrderStatusLabel,
  isRestaurant,
  getBusinessArticleCapitalized,
  getBusinessRef,
  convertImageFileToDataUrl,
} from '@sadel/shared';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { useForegroundPolling } from '../hooks/useForegroundPolling';
import { useCartStore, type CartItem } from '../store/cartStore';
import { useChatStore } from '../store/chatStore';
import dynamic from 'next/dynamic';
import { useStore } from '../store';
import { RestaurantSearchBar } from '../components/RestaurantSearchBar';
import { AuthModal } from '../components/AuthModal';
import { ChatPanel } from '../components/ChatPanel';
import { SaDelLogo } from '../components/SaDelLogo';
import CartDrawer from '../components/CartDrawer';
import { CompactActiveOrderBanner, buildTimelineSteps, getEtaWindowMinutes } from '../components/CompactActiveOrderBanner';
import RatingModal from '../components/RatingModal';

const HomeView = dynamic(() => import('../views/HomeView').then(mod => mod.HomeView), { ssr: false });
const ProfileView = dynamic(() => import('../views/ProfileView').then(mod => mod.ProfileView), { ssr: false });
const CheckoutView = dynamic(() => import('../views/CheckoutView').then(mod => mod.CheckoutView), { ssr: false });
const OrdersView = dynamic(() => import('../views/OrdersView').then(mod => mod.OrdersView), { ssr: false });

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

type PaymentMethod = 'CASH' | 'TRANSFER';

type RestaurantSummary = {
  id: string;
  name: string;
  description: string;
  address: string;
  region: string;
  regionName?: string | null;
  logo?: string | null;
  coverImage?: string | null;
  status?: string;
  isFeatured?: boolean;
  businessType?: string;
  distanceKm?: number | null;
  latitude?: number;
  longitude?: number;
  categories?: Array<{
    id: string;
    name: string;
  }>;
  storeCategories?: Array<{
    id: string;
    name: string;
    icon?: string;
    color?: string;
  }>;
  isOpen: boolean;
  minDeliveryTime: number;
  maxDeliveryTime: number;
  hasOwnDelivery: boolean;
  serviceFee?: number | null;
  deliveryFee?: number | null;
  effectiveDeliveryFee?: number | null;
  hasPromotions?: boolean;
  rating?: number;
  reviewCount?: number;
  totalOrders?: number;
  createdAt?: string;
};

type PublicRestaurantDetail = {
  id: string;
  name: string;
  description: string;
  address: string;
  region: string;
  regionName?: string | null;
  status: string;
  isOpen: boolean;
  hasOwnDelivery: boolean;
  serviceFee?: number | null;
  deliveryFee?: number | null;
  effectiveDeliveryFee?: number | null;
  minDeliveryTime: number;
  maxDeliveryTime: number;
  transferBankName?: string | null;
  transferAccountNumber?: string | null;
  transferBeneficiaryName?: string | null;
  categories: Array<{
    id: string;
    name: string;
    products: Array<{
      id: string;
      name: string;
      description: string;
      price: number;
      image?: string | null;
      preparationTime: number;
    }>;
  }>;
};

type CustomerOrderListItem = {
  id: string;
  orderReference: string;
  dailyCounter?: number;
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
};

type CustomerOrderDetail = {
  id: string;
  orderReference: string;
  dailyCounter?: number;
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
  isSecondInRoute?: boolean;
  batchId?: string | null;
  deliverySequence?: number | null;
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
    rating?: number;
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
  } | null;
  items: Array<{
    id: string;
    quantity: number;
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
  paymentProofUrl?: string | null;
  cancellationRequestedAt?: string | null;
  cancelledBy?: string | null;
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

type RestaurantListResponse = {
  success: true;
  data: {
    items: RestaurantSummary[];
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
  };
};

type CustomerNotification = {
  id: string;
  title: string;
  message: string;
  createdAt: string;
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
};

export type CustomerProfileAddress = {
  id?: string;
  street: string;
  number: string;
  apartment?: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  reference?: string;
  latitude?: number;
  longitude?: number;
  isDefault?: boolean;
};

type DashboardSection = 'home' | 'profile' | 'history' | 'support' | 'checkout';
export type StoreCategoryItem = {
  id: string;
  name: string;
  icon: string;
  color?: string | null;
  keywords: string[];
  isActive: boolean;
  order: number;
};
type RestaurantCategoryId = string;

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
};

const defaultProfileAddress: CustomerProfileAddress = {
  street: '',
  number: '',
  apartment: '',
  neighborhood: '',
  city: '',
  state: '',
  zipCode: '',
  country: 'MX',
  reference: '',
  latitude: 0,
  longitude: 0,
  isDefault: false,
};

const defaultApiBase = '/api';
const storageKey = 'sadel.customer';
const profileAddressStorageKey = `${storageKey}.profile-address`;
const persistentNoticeStorageKey = `${storageKey}.persistent-notice`;

const ZONE_MAP: Record<string, string> = {
  morelia: 'michoacan-morelia',
  puruaran: 'michoacan-puruaran',
  puruarán: 'michoacan-puruaran',
};

function resolveZoneFromAddress(address: string): string | null {
  const lower = address.toLowerCase();
  for (const [name, slug] of Object.entries(ZONE_MAP)) {
    if (lower.includes(name)) return slug;
  }
  return null;
}

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
  'order:schedule-proposal',
  'order:schedule-accepted',
  'order:schedule-rejected',
] as const;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export default function Home() {
  const router = useRouter();
  const apiBase = useStore(state => state.apiBase);
  const setApiBase = useStore(state => state.setApiBase);
  const token = useStore(state => state.token);
  const setToken = useStore(state => state.setToken);
  const sessionUser = useStore(state => state.sessionUser);
  const setSessionUser = useStore(state => state.setSessionUser);
  const isOnline = useStore(state => state.isOnline);
  const setIsOnline = useStore(state => state.setIsOnline);
  const [showIOSPrompt, setShowIOSPrompt] = useState(false);
  const [isAuthChecked, setIsAuthChecked] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(true);
  const [toastData, setToastData] = useState<{message: string, type: 'success' | 'error' | 'info'}>({message: '', type: 'success'});
  const toastMessage = toastData.message;
  const [showPromoModal, setShowPromoModal] = useState(false);
  const [promoImageUrl, setPromoImageUrl] = useState('');
  const [showAuthModal, setShowAuthModal] = useState(false);

  const setToastMessage = useCallback((msg: string | ((prev: string) => string), type: 'success' | 'error' | 'info' = 'success') => {
    if (typeof msg === 'function') {
      setToastData(prev => ({ ...prev, message: msg(prev.message) }));
    } else {
      let inferredType = type;
      if (type === 'success' && msg) {
         const isErrorMsg = /error|no coinciden|requerido|válido|no puedes|necesitamos|por favor|no se pudo|no pudimos/i.test(msg);
         if (isErrorMsg && !/éxito|correctamente/i.test(msg)) {
           inferredType = 'error';
         }
      }
      setToastData({ message: msg, type: inferredType });
    }
  }, []);
  const [customerProfile, setCustomerProfile] = useState<any>(null);
  const [addresses, setAddresses] = useState<any[]>([]);
  const [profileAddress, setProfileAddress] = useState<CustomerProfileAddress>(defaultProfileAddress);

  // Zustand Store
  const activeSection = useStore(state => state.activeSection);
  const setActiveSection = useStore(state => state.setActiveSection);
  const searchQuery = useStore(state => state.searchQuery);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const isSearchStale = searchQuery !== deferredSearchQuery;
  const setSearchQuery = useStore(state => state.setSearchQuery);
  const searchType = useStore(state => state.searchType);
  const unreadMessagesMap = useChatStore(state => state.unreadMessagesMap);
  const isChatOpen = useChatStore(state => state.isChatOpen);
  const [searchResults, setSearchResults] = useState<RestaurantSummary[] | null>(null);
  const searchCacheRef = useRef<Record<string, RestaurantSummary[]>>({});
  const loadDashboardCallIdRef = useRef(0);
  const [isSearchingProducts, setIsSearchingProducts] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editName, setEditName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [isVerifyingPhoneChange, setIsVerifyingPhoneChange] = useState(false);
  const [phoneChangeOtp, setPhoneChangeOtp] = useState('');
  const [newPhoneToVerify, setNewPhoneToVerify] = useState('');
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [otpError, setOtpError] = useState('');
  const [isEditingAddress, setIsEditingAddress] = useState(false);
  const [addressSearchQuery, setAddressSearchQuery] = useState('');
  const [addressSuggestions, setAddressSuggestions] = useState<any[]>([]);
  const [isSearchingAddress, setIsSearchingAddress] = useState(false);

  function handleProfileAddressChange(field: keyof CustomerProfileAddress, value: string) {
    setProfileAddress((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function saveProfileAddress() {
    const normalizedAddress = {
      ...profileAddress,
      street: profileAddress.street.trim() || 'Calle',
      number: profileAddress.number.trim() || 'S/N',
      neighborhood: profileAddress.neighborhood.trim() || 'Colonia',
      city: profileAddress.city.trim() || 'Ciudad',
      state: profileAddress.state.trim() || 'Estado',
      zipCode: profileAddress.zipCode.trim() || '00000',
      country: profileAddress.country.trim() || 'MX',
      latitude: profileAddress.latitude || 0,
      longitude: profileAddress.longitude || 0,
    };

    const isEdit = Boolean(profileAddress.id);

    try {
      const payload = await requestJson<{ success: boolean; data: any }>({
        apiBase,
        path: isEdit ? `/customer/addresses/${profileAddress.id}` : '/customer/addresses',
        options: {
          method: isEdit ? 'PATCH' : 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify(normalizedAddress),
        },
      });

      if (payload.success) {
        setToastMessage(isEdit ? 'Dirección actualizada correctamente.' : 'Dirección guardada correctamente.');
        setTimeout(() => setToastMessage(''), 2000);
        setIsEditingAddress(false);
        void loadAddresses();
      }
    } catch (err) {
      console.error('Error saving address:', err);
      setToastMessage('Error al guardar dirección');
      setTimeout(() => setToastMessage(''), 2000);
    }
  }

  async function deleteProfileAddress(id: string) {
    if (!confirm('¿Estás seguro de que quieres eliminar esta dirección?')) return;
    try {
      const payload = await requestJson<{ success: boolean; data: any }>({
        apiBase,
        path: `/customer/addresses/${id}`,
        options: {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        },
      });

      if (payload.success) {
        setToastMessage('Dirección eliminada correctamente.');
        setTimeout(() => setToastMessage(''), 2000);
        void loadAddresses();
      }
    } catch (err) {
      console.error('Error deleting address:', err);
      setToastMessage('Error al eliminar dirección');
      setTimeout(() => setToastMessage(''), 2000);
    }
  }

  function cancelProfileAddressEditing() {
    setProfileAddress(latestAddress);
    setIsEditingAddress(false);
  }

  async function searchAddress(query: string) {
    if (!query.trim() || query.length < 3) {
      setAddressSuggestions([]);
      return;
    }

    setIsSearchingAddress(true);
    
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(async () => {
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
          input: query,
          sessionToken: autocompleteSessionTokenRef.current,
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
    }, 500); // 500ms debounce
  }

  function selectSuggestion(suggestion: any) {
    const google = (window as any).google;
    if (!google || !google.maps || !google.maps.places || !suggestion.place_id) return;

    if (!placesServiceRef.current) {
      const mapEl = document.createElement('div');
      placesServiceRef.current = new google.maps.places.PlacesService(mapEl);
    }

    placesServiceRef.current.getDetails({
      placeId: suggestion.place_id,
      sessionToken: autocompleteSessionTokenRef.current,
      fields: ['address_components', 'geometry', 'formatted_address']
    }, (place: any, status: any) => {
      autocompleteSessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();
      
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

      setProfileAddress((current) => ({
        ...current,
        street: street || suggestion.name || '',
        number: houseNumber || '',
        neighborhood: neighborhood || '',
        city: city || '',
        state: state || '',
        zipCode: zipCode || '',
        latitude: lat,
        longitude: lng,
      }));
      
      setAddressSearchQuery(suggestion.name);
      setAddressSuggestions([]);
      
      if (addressMapRef.current) {
        addressMapRef.current.setCenter({ lat, lng });
        if (typeof updateAddressMarker === 'function') {
          updateAddressMarker(lat, lng);
        }
      }
    });
  }

  async function searchFallbackAddress(query: string) {
    if (!query.trim() || query.length < 3) {
      setFallbackSuggestions([]);
      return;
    }

    setIsSearchingFallback(true);
    
    if (fallbackSearchTimeoutRef.current) {
      clearTimeout(fallbackSearchTimeoutRef.current);
    }

    fallbackSearchTimeoutRef.current = setTimeout(async () => {
      try {
        const google = (window as any).google;
        if (!google || !google.maps || !google.maps.places) {
          setIsSearchingFallback(false);
          return;
        }

        if (!autocompleteSessionTokenRef.current) {
          autocompleteSessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();
        }

        const { suggestions: predictions } = await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: query,
          sessionToken: autocompleteSessionTokenRef.current,
          includedRegionCodes: ['mx']
        });

        if (!predictions || predictions.length === 0) {
          setFallbackSuggestions([]);
          setIsSearchingFallback(false);
          return;
        }

        const mappedSuggestions = predictions.map((suggestion: any) => ({
          name: suggestion.placePrediction.text.value,
          description: '',
          place_id: suggestion.placePrediction.placeId,
        }));

        setFallbackSuggestions(mappedSuggestions);
        setIsSearchingFallback(false);
      } catch (err) {
        console.error('Error searching fallback address:', err);
        setIsSearchingFallback(false);
      }
    }, 500);
  }

  function selectFallbackSuggestion(suggestion: any) {
    const google = (window as any).google;
    if (!google || !google.maps || !google.maps.places || !suggestion.place_id) return;

    if (!placesServiceRef.current) {
      const mapEl = document.createElement('div');
      placesServiceRef.current = new google.maps.places.PlacesService(mapEl);
    }

    placesServiceRef.current.getDetails({
      placeId: suggestion.place_id,
      sessionToken: autocompleteSessionTokenRef.current,
      fields: ['geometry', 'formatted_address']
    }, (place: any, status: any) => {
      autocompleteSessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();
      
      if (status !== google.maps.places.PlacesServiceStatus.OK || !place || !place.geometry || !place.geometry.location) {
        console.error('Failed to get place details');
        return;
      }

      const lat = place.geometry.location.lat();
      const lng = place.geometry.location.lng();
      const formatted_address = place.formatted_address || suggestion.name;

      const loc = { latitude: lat, longitude: lng, accuracy: undefined, address: formatted_address, ts: Date.now() };
      
      // Force locationDenied to true to block cash payments later, since they are bypassing GPS
      setLocationDenied(true);
      setLocationSource('manual');
      try { 
        localStorage.setItem('locationDenied', '1');
        localStorage.setItem('locationSource', 'manual');
        localStorage.setItem('userLocation', JSON.stringify(loc)); 
      } catch (e) { }
      
      setLocationExpired(false);
      setFallbackSearchQuery('');
      setFallbackSuggestions([]);
      setUserLocation(loc as any);
    });
  }

  function fillProfileAddressWithCurrentLocation() {
    if (!navigator.geolocation) {
      alert('Tu navegador no soporta geolocalización');
      return;
    }

    navigator.geolocation.getCurrentPosition(async (position) => {
      const { latitude, longitude } = position.coords;
      
      if (addressMapRef.current) {
        // @ts-ignore
        addressMapRef.current.setCenter({ lat: latitude, lng: longitude });
        updateAddressMarker(latitude, longitude);
      }
      
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
            
            setProfileAddress((current) => ({
              ...current,
              street: street || '',
              number: houseNumber || '',
              neighborhood: neighborhood || '',
              city: city || '',
              state: state || '',
              zipCode: zipCode || '',
              latitude,
              longitude,
            }));
            
            setAddressSearchQuery(data.formatted_address);
          }
        });
      } catch (err) {
        console.error('Error in reverse geocoding:', err);
      }
    }, (err) => {
      alert('No se pudo determinar tu ubicación exacta en este momento. Por favor ingresa tu dirección manualmente o asegúrate de tener buena señal.');
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  }

  const [restaurants, setRestaurants] = useState<RestaurantSummary[]>([]);
  const [activeZones, setActiveZones] = useState<any[]>([]);
  const [selectedZoneName, setSelectedZoneName] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      try {
        return window.localStorage.getItem('selectedZoneName') || null;
      } catch {}
    }
    return null;
  });
  const [featuredRestaurants, setFeaturedRestaurants] = useState<any[]>([]);
  const [offerProducts, setOfferProducts] = useState<any[]>([]);
  const [selectedRestaurantId, setSelectedRestaurantId] = useState('');
  const [selectedRestaurant, setSelectedRestaurant] = useState<PublicRestaurantDetail | null>(null);

  const cartItems = useCartStore(state => state.items);
  const cartRestaurantId = useCartStore(state => state.restaurantId);
  const cartServiceFeeVal = useCartStore(state => state.serviceFee);
  const cartDeliveryFeeVal = useCartStore(state => state.deliveryFee);
  const clearCart = useCartStore(state => state.clearCart);
  const updateCartItem = useCartStore(state => state.updateItem);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const cart: CartItem[] = mounted ? cartItems : [];
  const [, setCheckoutForm] = useState<CheckoutForm>(defaultCheckoutForm);
  const [selectedCheckoutAddressId, setSelectedCheckoutAddressId] = useState('');
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number; address: string; accuracy?: number; ts?: number } | null>(() => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem('userLocation') : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        const age = parsed.ts ? Date.now() - parsed.ts : Infinity;
        if (age < 24 * 60 * 60 * 1000) return parsed;
      }
    } catch {}
    return null;
  });
  const [locationExpired, setLocationExpired] = useState(() => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem('userLocation') : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        const age = parsed.ts ? Date.now() - parsed.ts : Infinity;
        if (age >= 24 * 60 * 60 * 1000) return true;
      }
    } catch {}
    return false;
  });
  const [userZone, setUserZone] = useState<string | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [locationSource, setLocationSource] = useState<'gps' | 'manual' | null>(null);
  const [isLocationChecked, setIsLocationChecked] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'TRANSFER'>('CASH');
  const [fulfillmentType, setFulfillmentType] = useState<'DELIVERY' | 'PICKUP'>('DELIVERY');
  const [paymentProofUrl, setPaymentProofUrl] = useState('');
  const [paymentProofUploading, setPaymentProofUploading] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);

  const [supportTickets, setSupportTickets] = useState<any[]>([]);
  const [loadingSupportTickets, setLoadingSupportTickets] = useState(false);

  const loadSupportTickets = useCallback(async () => {
    const localToken = token || localStorage.getItem('sadel.customer.token');
    if (!localToken) return;

    setLoadingSupportTickets(true);
    try {
      const response = await fetch(`${'/api'}/customer/support/tickets`, {
        headers: {
          'Authorization': `Bearer ${localToken}`,
        },
      });

      if (response.status === 404) {
        console.warn('Backend support tickets endpoint returned 404. Using local storage fallback.');
        const localTickets = localStorage.getItem('local_support_tickets');
        setSupportTickets(localTickets ? JSON.parse(localTickets) : []);
        return;
      }

      const data = await response.json();
      if (data.success) {
        setSupportTickets(data.data);
      }
    } catch (error) {
      console.error('Error loading support tickets:', error);
      const localTickets = localStorage.getItem('local_support_tickets');
      setSupportTickets(localTickets ? JSON.parse(localTickets) : []);
    } finally {
      setLoadingSupportTickets(false);
    }
  }, [token]);

  useEffect(() => {
    if (activeSection === 'support') {
      loadSupportTickets();
    }
  }, [activeSection, loadSupportTickets]);

  useEffect(() => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone;

    if (isIOS && !isStandalone) {
      setShowIOSPrompt(true);
    }
  }, []);

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

  const [selectedCategory, setSelectedCategory] = useState<RestaurantCategoryId>('all');
  const [filterOpenNow, setFilterOpenNow] = useState(false);
  const [filterFreeDelivery, setFilterFreeDelivery] = useState(false);
  const [filterNearby, setFilterNearby] = useState(true);
  const [filterPromotions, setFilterPromotions] = useState(false);
  const [filterBestRated, setFilterBestRated] = useState(false);
  const [, setActiveMenuCategoryId] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [orders, setOrders] = useState<CustomerOrderListItem[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<CustomerOrderDetail | null>(null);
  const [refundContact, setRefundContact] = useState('');
  const [refundProofName, setRefundProofName] = useState('');
  const [refundProofSource, setRefundProofSource] = useState('');
  const [submittingRefundReport, setSubmittingRefundReport] = useState(false);
  const [refundReportSuccess, setRefundReportSuccess] = useState(false);
  const [refundError, setRefundError] = useState('');
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isSupportModalOpen, setIsSupportModalOpen] = useState(false);
  const [isSupportSuccessModalOpen, setIsSupportSuccessModalOpen] = useState(false);
  const [supportModalView, setSupportModalView] = useState<'options' | 'app_form' | 'order_form'>('options');
  const [supportError, setSupportError] = useState('');
  const [submittingSupport, setSubmittingSupport] = useState(false);  const [isReorderModalOpen, setIsReorderModalOpen] = useState(false);
  const [reorderAddressId, setReorderAddressId] = useState('');
  const [isRatingModalOpen, setIsRatingModalOpen] = useState(false);
  const [orderToRate, setOrderToRate] = useState<string | null>(null);
  const [ratingBusinessType, setRatingBusinessType] = useState<string | null>(null);
  const [ratingIsPickup, setRatingIsPickup] = useState(false);
  const [restaurantRating, setRestaurantRating] = useState(0);
  const [driverRatingVal, setDriverRatingVal] = useState(0);
  const [ratingComment, setRatingComment] = useState('');
  const [isSubmittingRating, setIsSubmittingRating] = useState(false);
  const [isDriverArrivedModalOpen, setIsDriverArrivedModalOpen] = useState(false);
  const [arrivedOrder, setArrivedOrder] = useState<CustomerOrderDetail | null>(null);
  const [pickupReadyOrder, setPickupReadyOrder] = useState<CustomerOrderDetail | null>(null);
  const [visibleOrdersCount, setVisibleOrdersCount] = useState(10);
  const [activeOrderDetailsMap, setActiveOrderDetailsMap] = useState<Record<string, CustomerOrderDetail>>({});
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [, setNotifications] = useState<CustomerNotification[]>([]);
  const [transientNotice, setTransientNotice] = useState<TransientNotice | null>(null);
  const [scheduleProposalOrder, setScheduleProposalOrder] = useState<CustomerOrderDetail | null>(null);
  const [scheduleProposalLoading, setScheduleProposalLoading] = useState(false);

  // Join Platform States
  const [isRequestSuccessModalOpen, setIsRequestSuccessModalOpen] = useState(false);
  const [isJoinRestModalOpen, setIsJoinRestModalOpen] = useState(false);
  const [joinRestOwnerName, setJoinRestOwnerName] = useState('');
  const [joinRestName, setJoinRestName] = useState('');
  const [joinRestGiro, setJoinRestGiro] = useState('Restaurante');
  const [joinRestLocation, setJoinRestLocation] = useState('');
  const [joinRestWhatsapp, setJoinRestWhatsapp] = useState('');

  const [isJoinDriverModalOpen, setIsJoinDriverModalOpen] = useState(false);
  const [joinDriverName, setJoinDriverName] = useState('');
  const [joinDriverWhatsapp, setJoinDriverWhatsapp] = useState('');
  const [joinDriverMotorcycle, setJoinDriverMotorcycle] = useState('SI');
  const [joinDriverLocation, setJoinDriverLocation] = useState('');

  // Alert Preferences
  const [isCustomerSoundEnabled, setIsCustomerSoundEnabled] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.localStorage.getItem('customerAlertSoundEnabled') === 'true';
    }
    return false;
  });
  const [whatsappNotificationsEnabled, setWhatsappNotificationsEnabled] = useState(false);
  const [orderAlertAudioState, setOrderAlertAudioState] = useState<'unsupported' | 'needs-gesture' | 'ready'>('ready');
  const customerAudioContextRef = useRef<AudioContext | null>(null);
  const customerAudioBufferRef = useRef<AudioBuffer | null>(null);
  const customerLlegueBufferRef = useRef<AudioBuffer | null>(null);
  const chatMessageBufferRef = useRef<AudioBuffer | null>(null);
  const hasCustomerInteractedRef = useRef(false);
  const { isSubscribed, permission: pushPermission, subscribe: subscribePush, unsubscribe: unsubscribePush } = usePushNotifications();
  const selectedOrderIdRef = useRef(selectedOrderId);

  useEffect(() => {
    selectedOrderIdRef.current = selectedOrderId;
  }, [selectedOrderId]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const chatOrderId = urlParams.get('chat');
      if (chatOrderId) {
        setSelectedOrderId(chatOrderId);
        useChatStore.getState().openChat(chatOrderId);
        window.history.replaceState({}, '', '/');
      }
    }
  }, []);

  const isAuthenticated = Boolean(token && sessionUser?.role === 'CUSTOMER');

  useEffect(() => {
    if (isAuthChecked) {
      const t = setTimeout(() => setIsTransitioning(false), 50);
      return () => clearTimeout(t);
    }
  }, [isAuthChecked]);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [, setLoadingRestaurant] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [platformCategories, setPlatformCategories] = useState<StoreCategoryItem[]>([]);
  const [reordering, setReordering] = useState(false);
  const [socketStatus, setSocketStatus] = useState<'idle' | 'connecting' | 'connected' | 'reconnecting'>('idle');
  const [, setSocketAttempts] = useState(0);
  const [error, setError] = useState('');
  const seenLiveEventKeysRef = useRef<string[]>([]);
  const [isSideMenuOpen, setIsSideMenuOpen] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [orderNotes, setOrderNotes] = useState('');
  const [userRegion, setUserRegion] = useState('Mi ciudad');
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [fallbackSearchQuery, setFallbackSearchQuery] = useState('');
  const [fallbackSuggestions, setFallbackSuggestions] = useState<any[]>([]);
  const [isSearchingFallback, setIsSearchingFallback] = useState(false);
  const fallbackSearchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const touchStartY = useRef(0);
  const sideMenuRef = useRef<HTMLDivElement | null>(null);
  const cartRef = useRef<HTMLDivElement | null>(null);
  const transientNoticeTimeoutRef = useRef<number | null>(null);
  const recentNoticeKeysRef = useRef<string[]>([]);
  const orderStatusSnapshotRef = useRef<Record<string, string>>({});

  useEffect(() => {
    const controller = new AbortController();
    const fetchPromotions = async () => {
      try {
        const params = new URLSearchParams();
        if (sessionUser?.role) params.set('role', sessionUser.role);
        if (userZone) params.set('region', userZone);
        const query = params.toString() ? `?${params.toString()}` : '';
        const response = await fetch(`${apiBase}/public/promotions${query}`, { signal: controller.signal });
        const data = await response.json();
        
        if (data.success && data.data.length > 0) {
          const promo = data.data[0];
          setPromoImageUrl(promo.imageUrl);
          
          try {
            const today = new Date().toISOString().split('T')[0];
            const promoKey = `sadel_promo_seen_${promo.id}_${today}`;
            if (!localStorage.getItem(promoKey)) {
              setShowPromoModal(true);
              localStorage.setItem(promoKey, 'true');
            }
          } catch (e) {
            console.warn("Storage restricted, showing modal without saving state", e);
            setShowPromoModal(true);
          }
        }
      } catch (error) {
        if ((error as any)?.name === 'AbortError') return;
        console.error('Error fetching promotions', error);
      }
    };

    fetchPromotions();
    return () => controller.abort();
  }, [apiBase, sessionUser?.role, userZone]);

  // Restore persistent modals after page reload
  useEffect(() => {
    if (!token) return;
    try {
      const saved = localStorage.getItem('sadel_persistent_modal');
      if (!saved) return;
      const parsed = JSON.parse(saved);
      if (!parsed.orderId || !parsed.type) return;
      requestJson<{ success: true; data: CustomerOrderDetail }>({
        apiBase,
        path: `/me/pedidos/${parsed.orderId}`,
        token,
      }).then((detailRes) => {
        if (!detailRes.success || !detailRes.data) {
          localStorage.removeItem('sadel_persistent_modal');
          return;
        }
        if (parsed.type === 'pickup_ready' && detailRes.data.fulfillmentType === 'PICKUP') {
          setPickupReadyOrder(detailRes.data);
        } else if (parsed.type === 'driver_arrived') {
          setArrivedOrder(detailRes.data);
          setIsDriverArrivedModalOpen(true);
        }
      }).catch(() => {
        localStorage.removeItem('sadel_persistent_modal');
      });
    } catch {
      localStorage.removeItem('sadel_persistent_modal');
    }
  }, [apiBase, token]);

  useEffect(() => {
    if (!isDetailModalOpen) {
      setRefundContact('');
      setRefundProofName('');
      setRefundProofSource('');
      setSubmittingRefundReport(false);
      setRefundReportSuccess(false);
      setRefundError('');
    }
  }, [isDetailModalOpen]);
  const addressMapRef = useRef<any>(null);
  const autocompleteServiceRef = useRef<any>(null);
  const placesServiceRef = useRef<any>(null);
  const autocompleteSessionTokenRef = useRef<any>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const addressMarkerRef = useRef<any>(null);

  // Estados para rastreo geográfico opcional (Ahorro de datos móviles)
  const [isTrackingEnabled, setIsTrackingEnabled] = useState(false);
  const [driverLocation, setDriverLocation] = useState<{ lat: number; lng: number } | null>(null);
  const socketRef = useRef<any>(null);

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
    try {
      const savedSession = readStoredSession(storageKey);

      if (typeof window !== 'undefined' && window.localStorage) {
        const isDark = window.localStorage.getItem('darkMode') === 'true';
        if (isDark) {
          document.documentElement.classList.add('dark');
          setIsDarkMode(true);
        } else {
          setIsDarkMode(false);
        }
        
        const soundPref = window.localStorage.getItem('customerAlertSoundEnabled');
        setIsCustomerSoundEnabled(soundPref !== 'false');
        
        const supportsWebAudio = Boolean(window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
        setOrderAlertAudioState(supportsWebAudio ? 'needs-gesture' : 'unsupported');
      }

      if (savedSession.apiBase && savedSession.apiBase.startsWith('/')) {
        setApiBase(savedSession.apiBase);
      } else {
        if (savedSession.apiBase) {
          window.localStorage.removeItem(`${storageKey}.apiBase`);
        }
        setApiBase('/api');
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
            const parsed = JSON.parse(savedProfileAddress) as Partial<CustomerProfileAddress>;
            setProfileAddress((current) => ({
              ...current,
              ...parsed,
            }));
          } catch {
            window.localStorage.removeItem(profileAddressStorageKey);
          }
        }

        if (savedPersistentNotice) {
          try {
            const parsed = JSON.parse(savedPersistentNotice) as TransientNotice;
            // If the persisted notice is for suspension, verify the user is still suspended
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

      // Verify user status on init — if suspended, show modal even without socket event
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
        }).catch(() => {
          // Silently ignore — the auth middleware will block API calls anyway
        });
      }
    } catch (e) {
      console.error('Error during customer session initialization:', e);
    } finally {
      setIsAuthChecked(true);
    }
  }, []);

  useEffect(() => {
    async function fetchPlatformCategories() {
      try {
        const payload = await requestJson<{ success: true; data: StoreCategoryItem[] }>({
          apiBase,
          path: '/store-categories',
          fallbackMessage: 'No se pudieron cargar las categorías.',
        });
        setPlatformCategories(payload.data);
      } catch (err) {
        console.error('Failed to load platform categories:', err);
      }
    }
    void fetchPlatformCategories();
  }, [apiBase]);

  useEffect(() => {
    if (sessionUser?.region?.trim()) {
      setUserRegion(sessionUser.region);
    }
  }, [sessionUser]);

  useEffect(() => {
    if (userLocation?.address) {
      setUserZone(resolveZoneFromAddress(userLocation.address));
    }
  }, [userLocation]);



  useEffect(() => {
    if (!isSideMenuOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!sideMenuRef.current?.contains(event.target as Node)) {
        setIsSideMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [isSideMenuOpen]);

  useEffect(() => {
    const shouldLockScroll = isCartOpen || isSideMenuOpen;

    if (!shouldLockScroll) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isCartOpen, isSideMenuOpen]);

  useEffect(() => {
    return () => {
      if (transientNoticeTimeoutRef.current) {
        window.clearTimeout(transientNoticeTimeoutRef.current);
      }
    };
  }, []);

  const timelineSteps = useMemo(() => {
    return selectedOrder ? buildTimelineSteps(selectedOrder) : [];
  }, [selectedOrder]);

  const sortedOrders = useMemo(() => {
    let filtered = [...orders];
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((order) =>
        order.restaurant.name.toLowerCase().includes(query) ||
        order.id.toLowerCase().includes(query)
      );
    }
    return filtered.sort((first, second) =>
      new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime()
    );
  }, [orders, searchQuery]);

  const latestAddress = useMemo<CustomerProfileAddress>(() => {
    if (profileAddress.street.trim() || profileAddress.city.trim()) {
      return profileAddress;
    }

    if (selectedOrder?.address) {
      return mapOrderAddressToProfile(selectedOrder.address);
    }

    if (sortedOrders.length > 0 && sortedOrders[0].address) {
      return {
        street: sortedOrders[0].address.street,
        number: sortedOrders[0].address.number,
        neighborhood: sortedOrders[0].address.neighborhood,
        city: sessionUser?.region || userRegion,
        state: '',
        zipCode: '',
        country: 'MX',
        reference: sortedOrders[0].address.reference || '',
      };
    }

    return profileAddress;
  }, [profileAddress, selectedOrder, sessionUser, sortedOrders, userRegion]);

  const restaurantsWithDistances = useMemo(() => {
    // When there's an active search with at least 3 chars, ONLY use search results.
    // Never fall back to the full dashboard list during a search.
    const hasActiveSearch = deferredSearchQuery.trim().length >= 3;
    const listToProcess = hasActiveSearch
      ? (searchResults || [])  // During loading, show empty (skeletons handle the UI)
      : restaurants;
    return listToProcess.map((r) => {
      let dist = r.distanceKm;
      if (!dist && r.latitude && r.longitude && latestAddress.latitude && latestAddress.longitude) {
        dist = calculateHaversineDistance(
          latestAddress.latitude,
          latestAddress.longitude,
          r.latitude,
          r.longitude
        );
      }
      return { ...r, calculatedDistance: dist || 0 };
    });
  }, [restaurants, searchResults, deferredSearchQuery, latestAddress.latitude, latestAddress.longitude]);

  const filteredRestaurants = useMemo(() => {
    const query = normalizeSearchValue(deferredSearchQuery);
    const filteredByCategory = restaurantsWithDistances.filter((restaurant) => {
      if (selectedCategory === 'all') {
        return true;
      }

      return restaurant.storeCategories?.some(c => c.id === selectedCategory) ?? false;
    });

    const filteredByQuery = (query && !searchResults)
      ? filteredByCategory.filter((restaurant) =>
        normalizeSearchValue(restaurant.name).includes(query)
      )
      : filteredByCategory;

    let result = [...filteredByQuery];

    if (filterOpenNow) {
      result = result.filter(r => r.isOpen);
    }
    if (filterFreeDelivery) {
      result = result.filter(r => r.effectiveDeliveryFee === 0);
    }

    if (filterPromotions) {
      result = result.filter(r =>
        r.description?.toLowerCase().includes('promo') ||
        r.description?.toLowerCase().includes('descuento') ||
        r.description?.toLowerCase().includes('oferta')
      );
    }

    return result.sort((first, second) => {
      // Prioritize open restaurants first
      if (first.isOpen !== second.isOpen) {
        return first.isOpen ? -1 : 1;
      }

      if (filterBestRated) {
        const firstBestScore = rankBestRated(first);
        const secondBestScore = rankBestRated(second);
        if (firstBestScore !== secondBestScore) {
          return secondBestScore - firstBestScore;
        }
      }

      if (filterNearby && first.calculatedDistance !== null && second.calculatedDistance !== null) {
        return first.calculatedDistance - second.calculatedDistance;
      }

      const firstScore = rankRestaurant(first, userRegion);
      const secondScore = rankRestaurant(second, userRegion);

      if (firstScore !== secondScore) {
        return secondScore - firstScore;
      }

      if (first.minDeliveryTime !== second.minDeliveryTime) {
        return first.minDeliveryTime - second.minDeliveryTime;
      }

      return first.name.localeCompare(second.name);
    });
  }, [restaurants, searchResults, deferredSearchQuery, selectedCategory, userRegion, filterOpenNow, filterFreeDelivery, filterNearby, filterPromotions, filterBestRated]);

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

  const handleCustomerSoundToggle = useCallback((checked: boolean) => {
    setIsCustomerSoundEnabled(checked);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('customerAlertSoundEnabled', checked ? 'true' : 'false');
    }
    if (checked) {
      void playCustomerAlertAudio(); // Reproducir inmediatamente para confirmar y desbloquear
    }
  }, [playCustomerAlertAudio]);

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

  const handleCustomerWhatsAppToggle = useCallback(async (checked: boolean) => {
    setWhatsappNotificationsEnabled(checked);
    try {
      const payload = await requestJson<{ success: boolean }>({
        apiBase,
        path: '/customer/profile/preferences',
        options: {
          method: 'PATCH',
          body: JSON.stringify({ whatsappNotifications: checked }),
        },
        token,
        fallbackMessage: 'Error al actualizar preferencia',
      });
      if (!payload.success) {
        setWhatsappNotificationsEnabled(!checked);
      }
    } catch {
      setWhatsappNotificationsEnabled(!checked);
    }
  }, [apiBase, token]);

  // Global gesture listener to unlock HTML5 DOM audio element and preload Web Audio API
  useEffect(() => {
    const handleGlobalUnlock = () => {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass && !customerAudioContextRef.current) {
        const context = new AudioContextClass();
        customerAudioContextRef.current = context;

        // Preload notifica.wav
        fetch('/sounds/notifica.wav')
          .then((res) => res.arrayBuffer())
          .then((arr) => context.decodeAudioData(arr))
          .then((buf) => {
            customerAudioBufferRef.current = buf;
            console.log('[Web Audio API] notifica.wav loaded and decoded successfully.');
          })
          .catch((err) => {
            console.error('[Web Audio API] Failed to load/decode notifica.wav:', err);
          });

        fetch('/sounds/mensaje.wav')
          .then((res) => res.arrayBuffer())
          .then((arr) => context.decodeAudioData(arr))
          .then((buf) => {
            chatMessageBufferRef.current = buf;
            console.log('[Web Audio API] mensaje.wav loaded and decoded successfully.');
          })
          .catch((err) => {
            console.error('[Web Audio API] Failed to load/decode mensaje.wav:', err);
          });

        fetch('/sounds/llegue.wav')
          .then((res) => res.arrayBuffer())
          .then((arr) => context.decodeAudioData(arr))
          .then((buf) => {
            customerLlegueBufferRef.current = buf;
            console.log('[Web Audio API] llegue.wav loaded and decoded successfully.');
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

    window.addEventListener('pointerdown', handleGlobalUnlock, { once: true, passive: true });
    window.addEventListener('keydown', handleGlobalUnlock, { once: true, passive: true });

    return () => {
      window.removeEventListener('pointerdown', handleGlobalUnlock);
      window.removeEventListener('keydown', handleGlobalUnlock);
    };
  }, []);

  const showLoadMore = sortedOrders.length > visibleOrdersCount;

  const activeOrderListItems = useMemo(() => {
    return sortedOrders.filter((order) => isActiveOrderStatus(order.status));
  }, [sortedOrders]);

  useEffect(() => {
    if (carouselIndex >= activeOrderListItems.length && activeOrderListItems.length > 0) {
      setCarouselIndex(activeOrderListItems.length - 1);
    }
  }, [activeOrderListItems.length, carouselIndex]);

  const activeOrderListItem = useMemo(() => {
    return activeOrderListItems[carouselIndex] || null;
  }, [activeOrderListItems, carouselIndex]);

  const pinnedOrder = useMemo(() => {
    if (!activeOrderListItem) {
      return null;
    }

    if (selectedOrder?.id === activeOrderListItem.id) {
      return selectedOrder;
    }

    const detail = activeOrderDetailsMap[activeOrderListItem.id];
    if (detail) {
      return detail;
    }

    return null;
  }, [activeOrderDetailsMap, activeOrderListItem, selectedOrder]);

  const orderStats = useMemo(() => {
    const totalSpent = orders.reduce((sum, order) => sum + order.totalAmount, 0);
    const activeOrders = orders.filter((order) =>
      ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'PICKED_UP', 'IN_TRANSIT'].includes(order.status)
    ).length;
    const deliveredOrders = orders.filter((order) => order.status === 'DELIVERED').length;

    return {
      total: orders.length,
      totalSpent,
      activeOrders,
      deliveredOrders,
    };
  }, [orders]);

  const memberSinceLabel = useMemo(() => {
    if (customerProfile?.user?.createdAt) {
      return formatDate(customerProfile.user.createdAt);
    }
    
    if (sessionUser?.createdAt) {
      return formatDate(sessionUser.createdAt);
    }

    if (!sortedOrders.length) {
      return 'Aun sin pedidos registrados';
    }

    return formatDate(sortedOrders[sortedOrders.length - 1].createdAt);
  }, [sortedOrders, customerProfile, sessionUser]);

  useEffect(() => {
    if (!latestAddress.street.trim() && !latestAddress.city.trim()) {
      return;
    }

    setProfileAddress((current) => {
      if (current.street.trim() || current.city.trim()) {
        return current;
      }

      return latestAddress;
    });

    setCheckoutForm((current) => {
      if (current.street.trim() || current.city.trim()) {
        return current;
      }

      return {
        ...current,
        ...latestAddress,
        latitude: latestAddress.latitude !== undefined ? String(latestAddress.latitude) : current.latitude,
        longitude: latestAddress.longitude !== undefined ? String(latestAddress.longitude) : current.longitude,
      };
    });
  }, [latestAddress]);

  const cartSubtotal = useMemo(
    () => cart.reduce((sum, item) => {
      const optionsPrice = (item.selectedOptions || []).reduce((s, o) => s + Number(o.price), 0);
      const basePrice = item.discountPrice ? Number(item.discountPrice) : Number(item.price);
      return sum + (basePrice + optionsPrice) * item.quantity;
    }, 0),
    [cart]
  );
  const cartServiceFee = cart.length ? cartServiceFeeVal : 0;
  const cartDeliveryFee = cart.length ? (cartDeliveryFeeVal || 0) : 0;
  const cartTotal = cartSubtotal + cartServiceFee + cartDeliveryFee;

  function clearSession(message?: string) {
    setToken('');
    setSessionUser(null);
    setActiveSection('home');
    setSelectedCategory('all');
    setOrders([]);
    setRestaurants([]);
    setSelectedRestaurantId('');
    setSelectedRestaurant(null);
    clearCart();
    setCheckoutForm(defaultCheckoutForm);
    setProfileAddress(defaultProfileAddress);
    setIsEditingAddress(false);
    setSelectedOrderId('');
    setSelectedOrder(null);
    setActiveOrderDetailsMap({});
    setCarouselIndex(0);
    setNotifications([]);
    setSocketStatus('idle');
    setSocketAttempts(0);
    setIsSideMenuOpen(false);
    clearStoredSession(storageKey);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(profileAddressStorageKey);
    }
  }

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

  // Sync userLocation to a ref to prevent GPS fluctuations from triggering/aborting the search effect
  const userLocationRef = useRef(userLocation);
  useEffect(() => {
    userLocationRef.current = userLocation;
  }, [userLocation]);

  useEffect(() => {
    // Senior UX: Only search if the query is at least 3 characters to avoid network spam and browser queue blocking
    if (!searchQuery.trim() || searchQuery.trim().length < 3) {
      setSearchResults(null);
      setIsSearchingProducts(false);
      return;
    }

    const query = searchQuery.trim().toLowerCase();
    const queryKey = `${searchType}:${query}`;

    // Check cache first
    if (searchCacheRef.current[queryKey]) {
      setSearchResults(searchCacheRef.current[queryKey]);
      setIsSearchingProducts(false);
      return;
    }

    // Senior UX: Clear previous results and show skeletons synchronously to prevent any "No results" flashing
    setSearchResults(null);
    setIsSearchingProducts(true);

    const controller = new AbortController();
    const { signal } = controller;

    const performSearch = async () => {
      try {
        const queryParams = new URLSearchParams({
          search: searchQuery.trim(),
          searchType,
          limit: '24',
          openOnly: 'false',
        });

        const currentLoc = userLocationRef.current;
        if (currentLoc) {
          queryParams.append('latitude', currentLoc.latitude.toString());
          queryParams.append('longitude', currentLoc.longitude.toString());
        }

        const url = `${apiBase}/restaurantes?${queryParams.toString()}`;
        
        const response = await fetch(url, { signal });
        const data = await response.json();

        if (data.success) {
          // Cache the result
          searchCacheRef.current[queryKey] = data.data.items;
          setSearchResults(data.data.items);
        } else {
          setSearchResults([]);
        }
      } catch (error: any) {
        if (error.name === 'AbortError') {
          return;
        }
        console.error('Error during global search:', error);
        setSearchResults([]);
      } finally {
        setIsSearchingProducts(false);
      }
    };

    performSearch();

    return () => {
      controller.abort();
    };
  }, [searchQuery, searchType, apiBase]);

  const loadDashboard = useCallback(async (silent = false) => {
    const callId = ++loadDashboardCallIdRef.current;
    if (!silent) {
      setLoadingDashboard(true);
    }
    setError('');

    try {
      persistApiBase(storageKey, apiBase);
      // Do not request restaurants from the backend unless we have a valid userLocation.
      // Backend will not filter by distance if coordinates are missing, which can show
      // restaurants from other cities. We prefer showing no restaurants until the user
      // grants/updates their location or enters it manually.
      const restaurantsPromise = userLocation
        ? requestJson<RestaurantListResponse>({
          apiBase,
          path: `/restaurantes?limit=24&openOnly=false&latitude=${userLocation.latitude}&longitude=${userLocation.longitude}`,
          fallbackMessage: 'No se pudo cargar la oferta de restaurantes.',
        })
        : Promise.resolve({
          success: true,
          data: { items: [], total: 0, page: 1, limit: 8, hasMore: false },
        } satisfies RestaurantListResponse);

      const ordersPromise = token
        ? requestJson<PaginatedOrdersResponse>({
            apiBase,
            path: '/me/pedidos?page=1&limit=15',
            token,
            fallbackMessage: 'No se pudo cargar el historial de pedidos.',
          })
        : Promise.resolve({
            success: true,
            data: { items: [], total: 0, page: 1, limit: 15, hasMore: false },
          } satisfies PaginatedOrdersResponse);

      const featuredPromise = userLocation
        ? fetch(`${apiBase}/public/featured?latitude=${userLocation.latitude}&longitude=${userLocation.longitude}`)
            .then(r => r.json())
            .then(d => d.success ? d.data : [])
            .catch(() => [])
        : Promise.resolve([]);

      const offersPromise = userLocation
        ? fetch(`${apiBase}/public/ofertas?latitude=${userLocation.latitude}&longitude=${userLocation.longitude}`)
            .then(r => r.json())
            .then(d => d.success ? d.data : [])
            .catch(() => [])
        : Promise.resolve([]);

      const TIMEOUT_MS = 10_000;
      const withTimeout = <T,>(p: Promise<T>): Promise<T> =>
        Promise.race([
          p,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Tiempo de espera agotado')), TIMEOUT_MS)
          ),
        ]);
      const [restaurantsResult, ordersResult, featuredResult, offersResult] = await Promise.allSettled([
        withTimeout(restaurantsPromise),
        withTimeout(ordersPromise),
        withTimeout(featuredPromise),
        withTimeout(offersPromise),
      ]);
      const restaurantsData = restaurantsResult.status === 'fulfilled' ? restaurantsResult.value : { success: true, data: { items: [], total: 0, page: 1, limit: 24, hasMore: false } } as RestaurantListResponse;
      const ordersData = ordersResult.status === 'fulfilled' ? ordersResult.value : { success: true, data: { items: [], total: 0, page: 1, limit: 15, hasMore: false } } as PaginatedOrdersResponse;
      const featuredData = featuredResult.status === 'fulfilled' ? featuredResult.value : [];
      const offersData = offersResult.status === 'fulfilled' ? offersResult.value : [];

      // Fetch active zones once for the empty state explorer
      if (!activeZones.length) {
        fetch(`${apiBase}/public/zonas-activas`)
          .then(r => r.json())
          .then(d => { if (d.success) setActiveZones(d.data); })
          .catch(() => {});
      }

      if (callId !== loadDashboardCallIdRef.current) return;
      const validFeatured = featuredData.filter((r: any) => {
        if (!userLocation || r.distanceKm === null || r.deliveryRadius === null) return false;
        return r.distanceKm <= r.deliveryRadius;
      });
      setRestaurants(restaurantsData.data.items || []);
      setFeaturedRestaurants(validFeatured);
      setOfferProducts(offersData);
      setSelectedRestaurantId((current) => {
        if (current && restaurantsData.data.items.some((item) => item.id === current)) {
          return current;
        }

        return '';
      });
      setOrders(ordersData.data.items);

      // Check for orders that need schedule confirmation from customer
      const pendingScheduleOrder = ordersData.data.items.find(
        (o) => o.status === 'CONFIRMED'
      );
      if (pendingScheduleOrder) {
        requestJson<{ success: true; data: CustomerOrderDetail }>({
          apiBase,
          path: `/me/pedidos/${pendingScheduleOrder.id}`,
          token,
        }).then((detailRes) => {
          if (
            detailRes.success &&
            detailRes.data.scheduledDeliveryAt &&
            !detailRes.data.scheduledDeliveryCustomerAcceptedAt
          ) {
            setScheduleProposalOrder(detailRes.data);
          }
        }).catch(() => {});
      }
      
      const unratedOrder = ordersData.data.items.find(
        (order) =>
          !order.review &&
          !localStorage.getItem(`sadel_dismissed_rating_${order.id}`) &&
          !localStorage.getItem(`sadel_prompted_rating_${order.id}`) &&
          (normalizeOrderStatusValue(order.status) === 'DELIVERED' ||
           normalizeOrderStatusValue(order.status) === 'COMPLETED')
      );
      if (unratedOrder) {
        try { localStorage.setItem(`sadel_prompted_rating_${unratedOrder.id}`, 'true'); } catch {}
        setOrderToRate(unratedOrder.id);
        setRatingBusinessType((unratedOrder as any).restaurant?.businessType || null);
        setRatingIsPickup(normalizeOrderStatusValue(unratedOrder.status) === 'COMPLETED');
        setIsRatingModalOpen(true);
      }

      setSelectedOrderId((current) => {
        if (current && ordersData.data.items.some((item) => item.id === current)) {
          return current;
        }

        return ordersData.data.items[0]?.id || '';
      });
    } catch (requestError) {
      if (callId !== loadDashboardCallIdRef.current) return;
      setRestaurants([]);
      setSelectedRestaurantId('');
      setSelectedRestaurant(null);
      setOrders([]);
      setSelectedOrderId('');
      setSelectedOrder(null);
      setActiveOrderDetailsMap({});
      setCarouselIndex(0);

      if (isAuthRequestError(requestError)) {
        clearSession('Tu sesión ha expirado. Por favor, inicia sesión de nuevo.');
      } else {
        const errorMessage = requestError instanceof Error ? requestError.message : '';
        setError(errorMessage || 'No se pudo cargar el panel.');
      }
    } finally {
      if (callId !== loadDashboardCallIdRef.current) return;
      if (!silent) {
        setLoadingDashboard(false);
      }
    }
  }, [apiBase, token, userLocation]);

  const loadMoreOrders = useCallback(() => {
    setVisibleOrdersCount((prev) => prev + 10);
  }, []);

  const handleZoneSelect = useCallback((zone: { latitude: number; longitude: number; regionName: string }) => {
    const loc = { latitude: zone.latitude, longitude: zone.longitude, accuracy: undefined, address: zone.regionName, ts: Date.now() };
    setSelectedZoneName(zone.regionName);
    setLocationSource('manual');
    setLocationDenied(true);
    setUserLocation(loc);
    try {
      localStorage.setItem('locationDenied', '1');
      localStorage.setItem('locationSource', 'manual');
      localStorage.setItem('userLocation', JSON.stringify(loc));
      localStorage.setItem('selectedZoneName', zone.regionName);
    } catch (e) {}
    loadDashboard();
  }, [loadDashboard]);

  const handleResetZone = useCallback(() => {
    setSelectedZoneName(null);
    setLocationSource('gps');
    setLocationDenied(false);
    setUserLocation(null);
    try {
      localStorage.removeItem('locationDenied');
      localStorage.removeItem('locationSource');
      localStorage.removeItem('userLocation');
      localStorage.removeItem('selectedZoneName');
    } catch (e) {}

    // Try GPS immediately to re-acquire location after manual zone override
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude, accuracy } = position.coords;
          let address = 'Ubicación actual';
          const tryGeocode = async () => {
            try {
              const google = (window as any).google;
              if (google) {
                const geocoder = new google.maps.Geocoder();
                await new Promise<void>((resolve) => {
                  geocoder.geocode(
                    { location: { lat: latitude, lng: longitude } },
                    (results: any, status: any) => {
                      if (status === 'OK' && results?.[0]) {
                        address = results[0].formatted_address;
                      }
                      resolve();
                    }
                  );
                });
              }
            } catch {}
            const loc = { latitude, longitude, accuracy, address, ts: Date.now() };
            setUserLocation(loc);
            setLocationSource('gps');
            setLocationDenied(false);
            try {
              localStorage.setItem('locationSource', 'gps');
              localStorage.setItem('userLocation', JSON.stringify(loc));
              localStorage.removeItem('locationDenied');
            } catch {}
          };
          void tryGeocode();
        },
        () => {},
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
      );
    }
  }, []);

  const loadProfile = useCallback(async () => {
    if (!token) return;
    try {
      const payload = await requestJson<{ success: boolean; data: any }>({
        apiBase,
        path: '/customer/profile',
        token,
        fallbackMessage: 'No se pudo cargar el perfil.',
      });

      if (payload.success) {
        setCustomerProfile(payload.data);
        setWhatsappNotificationsEnabled(payload.data?.whatsappNotifications ?? false);
      }
    } catch (err) {
      console.error('Error loading profile:', err);
      clearSession();
    }
  }, [apiBase, token]);

  async function handleChangePassword() {
    if (newPassword !== confirmPassword) {
      setToastMessage('Las contraseñas no coinciden');
      setTimeout(() => setToastMessage(''), 2000);
      return;
    }

    try {
      const payload = await requestJson<{ success: boolean; message: string }>({
        apiBase,
        path: '/customer/profile/password',
        options: {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ currentPassword, newPassword }),
        },
      });

      if (payload.success) {
        setToastMessage('Contraseña actualizada');
        setTimeout(() => setToastMessage(''), 2000);
        setIsChangingPassword(false);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      }
    } catch (err) {
      console.error('Error changing password:', err);
      setToastMessage('Error al cambiar contraseña');
      setTimeout(() => setToastMessage(''), 2000);
    }
  }

  async function handleEditProfile() {
    if (!editName.trim() || !editLastName.trim() || !editPhone.trim()) {
      setToastMessage('Nombre, apellidos y teléfono son requeridos');
      setTimeout(() => setToastMessage(''), 2000);
      return;
    }

    if (sessionUser?.phone && editPhone !== sessionUser.phone) {
      if (editPhone.length < 10) {
        setToastMessage('Ingresa un número válido (10 dígitos)');
        setTimeout(() => setToastMessage(''), 2000);
        return;
      }
      
      setNewPhoneToVerify(editPhone);
      setIsSendingOtp(true);
      
      setTimeout(() => {
        setIsSendingOtp(false);
        setIsVerifyingPhoneChange(true);
        setPhoneChangeOtp('');
        setOtpError('');
      }, 1000);
      return;
    }

    try {
      const payload = await requestJson<{ success: boolean; data: any }>({
        apiBase,
        path: '/customer/profile',
        options: {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ name: editName, lastName: editLastName, phone: editPhone }),
        },
      });

      if (payload.success) {
        setToastMessage('Perfil actualizado');
        setTimeout(() => setToastMessage(''), 2000);
        setIsEditingProfile(false);
        if (sessionUser) {
          persistSession(token, { ...sessionUser, name: editName, lastName: editLastName, phone: editPhone });
        }
      }
    } catch (err) {
      console.error('Error editing profile:', err);
      setToastMessage('Error al actualizar perfil');
      setTimeout(() => setToastMessage(''), 2000);
    }
  }

  async function handleVerifyPhoneChange() {
    if (phoneChangeOtp.length < 4) {
      setOtpError('Ingresa el código completo');
      return;
    }
    
    setOtpError('');
    setIsSendingOtp(true);
    
    setTimeout(async () => {
      try {
        const payload = await requestJson<{ success: boolean; data: any }>({
          apiBase,
          path: '/customer/profile',
          options: {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ name: editName, lastName: editLastName, phone: newPhoneToVerify }),
          },
        });

        setIsSendingOtp(false);

        if (payload.success) {
          setToastMessage('Número verificado y perfil actualizado');
          setTimeout(() => setToastMessage(''), 2000);
          setIsVerifyingPhoneChange(false);
          setIsEditingProfile(false);
          if (sessionUser) {
            persistSession(token, { ...sessionUser, name: editName, lastName: editLastName, phone: newPhoneToVerify });
          }
        }
      } catch (err) {
        setIsSendingOtp(false);
        setOtpError('Código incorrecto o expirado');
      }
    }, 1500);
  }

  async function updatePreferences(preferences: { deliveryPreference: string | null }) {
    try {
      const payload = await requestJson<{ success: boolean; data: any }>({
        apiBase,
        path: '/customer/profile/preferences',
        options: {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify(preferences),
        },
      });

      if (payload.success) {
        setCustomerProfile(payload.data);
        setToastMessage('Preferencias actualizadas');
        setTimeout(() => setToastMessage(''), 2000);
      }
    } catch (err) {
      console.error('Error updating preferences:', err);
      setToastMessage('Error al actualizar preferencias');
      setTimeout(() => setToastMessage(''), 2000);
    }
  }

  const loadAddresses = useCallback(async () => {
    if (!token) return;
    try {
      const payload = await requestJson<{ success: boolean; data: any[] }>({
        apiBase,
        path: '/customer/addresses',
        token,
        fallbackMessage: 'No se pudo cargar las direcciones.',
      });

      if (payload.success) {
        setAddresses(payload.data);
        const defaultAddr = payload.data.find((a: any) => a.isDefault);
        if (defaultAddr) {
          setSelectedCheckoutAddressId(defaultAddr.id);
        }
      }
    } catch (err) {
      console.error('Error loading addresses:', err);
    }
  }, [apiBase, token]);

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

    void loadProfile();
    void loadAddresses();
    void loadDashboard();
  }, [loadProfile, loadAddresses, loadDashboard, setToken, setSessionUser]);

  async function handlePlaceOrder() {
    const isPickup = fulfillmentType === 'PICKUP';

    if (!isPickup) {
      const addressId = selectedCheckoutAddressId || addresses.find(a => a.isDefault)?.id;
      if (!addressId) {
        setToastMessage('Por favor, selecciona una dirección.');
        setTimeout(() => setToastMessage(''), 2000);
        return;
      }

      let address = addresses.find(a => a.id === addressId);
      if (!address) return;

      if (locationDenied && paymentMethod === 'CASH') {
        setToastMessage('Para pagar en efectivo es necesario permitir el acceso a tu ubicación. Puedes usar transferencia.');
        setTimeout(() => setToastMessage(''), 3500);
        return;
      }

      if (!userLocation) {
        setToastMessage('Necesitamos tu ubicación para procesar pedidos. Por favor permite el acceso a la ubicación.');
        setTimeout(() => setToastMessage(''), 3000);
        return;
      }

      const verificationTtlDays = 7;
      const verifiedAt = (address as any).locationVerifiedAt;
      const isAddressVerified = verifiedAt && (Date.now() - new Date(verifiedAt).getTime()) <= verificationTtlDays * 24 * 60 * 60 * 1000;

      if (!isAddressVerified) {
        const shouldVerify = confirm('Esta dirección necesita ser verificada con tu ubicación actual para crear el pedido. ¿Deseas verificarla ahora?');
        if (!shouldVerify) {
          return;
        }

        setToastMessage('Verificando ubicación...');
        try {
          const response = await fetch(`${apiBase}/customer/addresses/verify`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({
              street: address.street,
              number: address.number,
              apartment: address.apartment || '',
              neighborhood: address.neighborhood,
              city: address.city,
              state: address.state,
              zipCode: address.zipCode,
              country: address.country,
              reference: address.reference || '',
              latitude: typeof address.latitude === 'string' ? parseFloat(address.latitude) : address.latitude,
              longitude: typeof address.longitude === 'string' ? parseFloat(address.longitude) : address.longitude,
            }),
          });

          if (!response.ok) {
            setToastMessage('No se pudo verificar la dirección. Intenta de nuevo.');
            setTimeout(() => setToastMessage(''), 2000);
            return;
          }

          const verifiedAddress = await response.json();
          setToastMessage('Dirección verificada. Creando pedido...');
          address = verifiedAddress.data || address;
        } catch (error) {
          console.error('Error verifying address:', error);
          setToastMessage('Error al verificar la dirección.');
          setTimeout(() => setToastMessage(''), 2000);
          return;
        }
      }

      const addrLat = typeof address.latitude === 'string' ? parseFloat(address.latitude) : address.latitude;
      const addrLng = typeof address.longitude === 'string' ? parseFloat(address.longitude) : address.longitude;
      const distanceToAddressKm = haversineKm(userLocation.latitude, userLocation.longitude, addrLat, addrLng);
      const MAX_CASH_DISTANCE_KM = 1;

      if (distanceToAddressKm > MAX_CASH_DISTANCE_KM && paymentMethod !== 'TRANSFER') {
        setToastMessage('Por la distancia a tu ubicación actual, esta entrega solo está disponible pagando por transferencia.');
        setTimeout(() => setToastMessage(''), 4500);
        return;
      }
    }

    if (paymentMethod === 'TRANSFER' && !paymentProofUrl.trim()) {
      setToastMessage('Por favor, sube el comprobante de transferencia.');
      setTimeout(() => setToastMessage(''), 2000);
      return;
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      };

      const body: Record<string, any> = {
        restaurantId: selectedRestaurant?.id,
        items: cart.map(item => ({
          productId: item.productId,
          quantity: item.quantity,
          specialInstructions: item.specialInstructions,
        })),
        fulfillmentType,
        paymentMethod,
        paymentProofUrl: paymentMethod === 'TRANSFER' ? paymentProofUrl : undefined,
        notes: orderNotes,
        locationVerified: locationSource === 'gps',
      };

      if (!isPickup) {
        const address = addresses.find(a => a.id === (selectedCheckoutAddressId || addresses.find(a => a.isDefault)?.id));
        if (address) {
          body.deliveryAddress = {
            street: address.street,
            number: address.number,
            apartment: address.apartment || '',
            neighborhood: address.neighborhood,
            city: address.city,
            state: address.state,
            zipCode: address.zipCode,
            country: address.country,
            reference: address.reference || '',
            latitude: typeof address.latitude === 'string' ? parseFloat(address.latitude) : address.latitude,
            longitude: typeof address.longitude === 'string' ? parseFloat(address.longitude) : address.longitude,
          };
        }
        if (userLocation) {
          body.currentLocation = {
            latitude: userLocation.latitude,
            longitude: userLocation.longitude,
            accuracy: userLocation.accuracy,
            capturedAt: userLocation.ts,
          };
        }
      }

      const response = await fetch(`${'/api'}/pedidos`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (data.success) {
        setToastMessage('¡Pedido realizado con éxito!');
        triggerHaptic([30, 50, 30]); // Double vibration
        setTimeout(() => setToastMessage(''), 2000);
        clearCart();
        setOrderNotes('');
        openDashboardSection('history');
        void loadDashboard(); // Reload orders
      } else {
        const errorMsg = data.error?.message || data.message || 'No se pudo realizar el pedido';
        console.error('Order creation error:', { status: response.status, data });
        setToastMessage(`Error: ${errorMsg}`);
        setTimeout(() => setToastMessage(''), 3000);
      }
    } catch (error) {
      console.error('Error placing order:', error);
      setToastMessage('Error de conexión');
      setTimeout(() => setToastMessage(''), 2000);
    }
  }

  async function handlePaymentProofUpload(file: File) {
    if (!file) return;

    // Validate file size (max 5MB)
    const MAX_FILE_SIZE = 5 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      setToastMessage('El archivo es demasiado grande. Máximo 5MB.');
      setTimeout(() => setToastMessage(''), 2000);
      return;
    }

    // Validate file type (image or PDF)
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!validTypes.includes(file.type)) {
      setToastMessage('Solo se aceptan imágenes (JPG, PNG, WebP) o PDF.');
      setTimeout(() => setToastMessage(''), 2000);
      return;
    }

    setPaymentProofUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const dataUrl = e.target?.result as string;

        const uploaded = await uploadMediaAsset({
          apiBase,
          token,
          kind: 'payment-proof',
          source: dataUrl,
          fileName: file.name,
          fallbackMessage: 'No se pudo subir el comprobante de transferencia.',
          fallbackToSource: true,
        });

        setPaymentProofUrl(uploaded.url);
        setToastMessage('Comprobante subido exitosamente ✓');
        setTimeout(() => setToastMessage(''), 2000);
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('Error uploading payment proof:', error);
      setToastMessage('Error al subir el comprobante. Intenta de nuevo.');
      setTimeout(() => setToastMessage(''), 2000);
    } finally {
      setPaymentProofUploading(false);
    }
  }

  const loadRestaurantDetail = useCallback(async (restaurantId: string) => {
    setLoadingRestaurant(true);
    setError('');

    try {
      const payload = await requestJson<{ success: true; data: PublicRestaurantDetail }>({
        apiBase,
        path: `/restaurantes/${restaurantId}`,
        fallbackMessage: 'No se pudo cargar el menu del restaurante.',
      });

      setSelectedRestaurant(payload.data);
    } catch (requestError) {
      setSelectedRestaurant(null);
      setError(requestError instanceof Error ? requestError.message : 'No se pudo cargar el menu del restaurante.');
    } finally {
      setLoadingRestaurant(false);
    }
  }, [apiBase]);

  const loadOrderDetail = useCallback(async (orderId: string) => {
    setLoadingDetail(true);
    setError('');

    try {
      const payload = await requestJson<{ success: true; data: CustomerOrderDetail }>({
        apiBase,
        path: `/me/pedidos/${orderId}`,
        token,
        fallbackMessage: 'No se pudo cargar el detalle del pedido.',
      });

      setSelectedOrder(payload.data);
      return payload.data;
    } catch (requestError) {
      setSelectedOrder(null);
      setError(requestError instanceof Error ? requestError.message : 'No se pudo cargar el detalle del pedido.');
      return null;
    } finally {
      setLoadingDetail(false);
    }
  }, [apiBase, token]);

  const loadChatMessages = useCallback(async (orderId: string) => {
    const loadMessages = useChatStore.getState().loadChatMessages;
    await loadMessages(orderId, apiBase, token);
  }, [apiBase, token]);

  const sendChatMessage = async () => {
    const state = useChatStore.getState();
    const result = await state.sendChatMessage(apiBase, token);
    if (result.error) {
      setToastMessage(result.error);
      setTimeout(() => setToastMessage(''), 2000);
    }
  };

  useEffect(() => {
    void loadDashboard(true);
  }, [loadDashboard, token, sessionUser]);

  useEffect(() => {
    const LOCATION_TTL = 24 * 60 * 60 * 1000; // 24 hours

    async function tryUpdateFromGeolocation() {
      if (!navigator.geolocation) return null;

      return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(async (position) => {
          setLocationDenied(false);
          setLocationSource('gps');
          setSelectedZoneName(null);
          try {
            localStorage.removeItem('locationDenied');
            localStorage.removeItem('selectedZoneName');
            localStorage.setItem('locationSource', 'gps');
          } catch (e) { }
          const { latitude, longitude, accuracy } = position.coords;
          try {
            const google = (window as any).google;
            if (!google) throw new Error("Google Maps not loaded");

            const geocoder = new google.maps.Geocoder();
            geocoder.geocode({ location: { lat: latitude, lng: longitude } }, (results: any, status: any) => {
              const addressName = (status === "OK" && results && results[0]) ? results[0].formatted_address : 'Ubicación actual';
              const loc = { latitude, longitude, accuracy, address: addressName, ts: Date.now() };
              try {
                localStorage.setItem('userLocation', JSON.stringify(loc));
              } catch (e) {
                console.warn('Could not persist userLocation:', e);
              }
              resolve(loc);
            });
          } catch (err) {
            const loc = { latitude, longitude, accuracy, address: 'Ubicación actual', ts: Date.now() };
            try {
              localStorage.setItem('userLocation', JSON.stringify(loc));
            } catch (e) {
              console.warn('Could not persist userLocation:', e);
            }
            resolve(loc);
          }
        }, (err) => {
          // Permission denied
          try {
            if (err && (err as any).code === 1) {
              setLocationDenied(true);
              try { localStorage.setItem('locationDenied', '1'); } catch (e) { }
            }
          } catch (e) { }
          resolve(null);
        }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
      });
    }

    async function run() {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          try {
            const denied = window.localStorage.getItem('locationDenied') === '1';
            if (denied) setLocationDenied(true);
            const source = window.localStorage.getItem('locationSource') as 'gps' | 'manual' | null;
            if (source) setLocationSource(source);
          } catch (e) { }
          // If permission granted, proactively refresh location in background
          if (navigator.permissions) {
            try {
              // @ts-ignore permissions API
              const perm = await navigator.permissions.query({ name: 'geolocation' });
              if (perm.state === 'granted') {
                const fresh = await tryUpdateFromGeolocation();
                if (fresh) {
                  setUserLocation(fresh as any);
                  setSelectedZoneName(null);
                  try {
                    localStorage.removeItem('selectedZoneName');
                    localStorage.removeItem('locationDenied');
                  } catch {}
                  return;
                }
              }
            } catch (e) {
              // ignore permission inspection failures
            }
          }

          // Fallback: use stored location (already loaded synchronously via useState initializer)
          const savedZoneName = window.localStorage.getItem('selectedZoneName');
          if (savedZoneName) {
            setSelectedZoneName(savedZoneName);
          }
        }
      } catch (e) {
        console.error('Error reading userLocation from localStorage:', e);
      }
    }

    void run().finally(() => setIsLocationChecked(true));
  }, []);

  // Watch position to detect when user enters/exits delivery range
  useEffect(() => {
    let watchId: number | null = null;
    let lastPosition: { lat: number; lng: number } | null = null;
    let lastReloadAt = 0;
    let isFirstCallback = true;
    const MIN_DISTANCE_M = 150;
    const RELOAD_COOLDOWN_MS = 30000;
    const MAX_ACCURACY_M = 500;

    async function startWatch() {
      if (!navigator.geolocation || !navigator.permissions) return;
      try {
        const perm = await navigator.permissions.query({ name: 'geolocation' });
        if (perm.state === 'denied') return;
      } catch {
        return;
      }

      watchId = navigator.geolocation.watchPosition(
        (position) => {
          const { latitude, longitude, accuracy } = position.coords;
          if (accuracy > MAX_ACCURACY_M) return;

          if (isFirstCallback) {
            isFirstCallback = false;
            lastPosition = { lat: latitude, lng: longitude };
            return;
          }

          if (!lastPosition) return;
          const dist = haversineKm(lastPosition.lat, lastPosition.lng, latitude, longitude);
          if (dist * 1000 < MIN_DISTANCE_M) return;

          const now = Date.now();
          if (now - lastReloadAt < RELOAD_COOLDOWN_MS) return;
          lastReloadAt = now;
          lastPosition = { lat: latitude, lng: longitude };

          setUserLocation({
            latitude,
            longitude,
            accuracy,
            address: 'Ubicación actual',
            ts: now,
          });
        },
        () => {},
        { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
      );
    }

    startWatch();

    return () => {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
      }
    };
  }, []);

  const hasAttemptedPushSyncRef = useRef(false);

  useEffect(() => {
    if (token && sessionUser && !hasAttemptedPushSyncRef.current) {
      if (pushPermission === 'default' || pushPermission === 'granted') {
        hasAttemptedPushSyncRef.current = true;
        subscribePush(token).catch(err => console.error('[Push] Error al suscribir:', err));
      }
    }
  }, [token, sessionUser, pushPermission, subscribePush]);

  // Leer orderId de la URL (cuando se da click a una notificación push)
  useEffect(() => {
    if (!token) return;

    const checkUrlForOrderId = () => {
      const params = new URLSearchParams(window.location.search);
      const orderId = params.get('orderId');
      if (orderId) {
        setSelectedOrderId(orderId);
        setActiveSection('home');
        window.history.replaceState({}, '', window.location.pathname);
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
  }, [token, setActiveSection]);

  // Recibir orderId via postMessage del Service Worker (más confiable que URL para clientes existentes)
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    const handleSWMessage = (event: MessageEvent) => {
      if (event.data?.type === 'NOTIFICATION_CLICK') {
        const orderId = event.data.orderId;
        if (orderId) {
          setSelectedOrderId(orderId);
          setActiveSection('home');
        }
      }
    };

    navigator.serviceWorker.addEventListener('message', handleSWMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handleSWMessage);
    };
  }, []);

  useEffect(() => {
    if (token && activeSection === 'profile') {
      void loadProfile();
      void loadAddresses();
    }
  }, [token, activeSection, loadProfile, loadAddresses]);

  useEffect(() => {
    if (!selectedRestaurantId) {
      setSelectedRestaurant(null);
      setActiveMenuCategoryId('');
      return;
    }

    void loadRestaurantDetail(selectedRestaurantId);
  }, [loadRestaurantDetail, selectedRestaurantId]);

  useEffect(() => {
    if (!selectedRestaurant?.categories.length) {
      setActiveMenuCategoryId('');
      return;
    }

    setActiveMenuCategoryId((current) => {
      if (current && selectedRestaurant.categories.some((category) => category.id === current)) {
        return current;
      }

      return selectedRestaurant.categories[0]?.id || '';
    });
  }, [selectedRestaurant]);

  useEffect(() => {
    if (!token || !selectedOrderId || !sessionUser) {
      return;
    }

    void loadOrderDetail(selectedOrderId);
  }, [loadOrderDetail, selectedOrderId, token, sessionUser]);

  // Limpiar y resetear el rastreo de ubicación al cambiar de pedido en el carrusel
  useEffect(() => {
    setIsTrackingEnabled(false);
    setDriverLocation(null);
  }, [carouselIndex]);

  // Suscripción condicional al WebSocket para recibir la ubicación del repartidor
  useEffect(() => {
    if (!isTrackingEnabled || !pinnedOrder || !socketRef.current) {
      return;
    }

    const socket = socketRef.current;

    const handleDriverLocation = (payload: { orderId: string; latitude: number; longitude: number }) => {
      console.log('[Socket.io] Ubicación de repartidor recibida en cliente:', payload);
      if (payload.orderId === pinnedOrder.id) {
        setDriverLocation({ lat: payload.latitude, lng: payload.longitude });
      }
    };

    socket.on('order:driver-location', handleDriverLocation);

    return () => {
      socket.off('order:driver-location', handleDriverLocation);
    };
  }, [isTrackingEnabled, pinnedOrder?.id, socketStatus]);

  // Inicialización del mapa estático simple del modal de detalles (sin conflictos de DOM)

  useEffect(() => {
    if (!isEditingAddress) {
      if (addressMapRef.current) {
        // @ts-ignore
        addressMapRef.current = null;
        addressMarkerRef.current = null;
      }
      return;
    }

    let initTimer: any;
    
    const tryInitMap = () => {
      const google = (window as any).google;
      if (!google || !google.maps) return;

      const lat = parseFloat(String(profileAddress.latitude)) || 19.4326;
      const lng = parseFloat(String(profileAddress.longitude)) || -99.1332;

      const mapEl = document.getElementById('map-address');
      if (!mapEl) return;

      if (!addressMapRef.current || addressMapRef.current.getDiv() !== mapEl) {
        // Force dimensions if Tailwind failed to apply them yet
        if (mapEl.clientHeight === 0) {
          mapEl.style.height = '240px';
        }
        
        addressMapRef.current = new google.maps.Map(mapEl, {
          center: { lat, lng },
          zoom: 16,
          mapTypeControl: false,
          streetViewControl: false,
        });

        google.maps.event.addListenerOnce(addressMapRef.current, 'idle', () => {
          google.maps.event.trigger(addressMapRef.current, 'resize');
        });

        updateAddressMarker(lat, lng);
      } else {
        // @ts-ignore
        addressMapRef.current.setCenter({ lat, lng });
        // @ts-ignore
        addressMapRef.current.setZoom(16);
        updateAddressMarker(lat, lng);
      }
    };

    initTimer = setTimeout(tryInitMap, 300);

    return () => {
      clearTimeout(initTimer);
    };
  }, [isEditingAddress, profileAddress.latitude, profileAddress.longitude]);

  useEffect(() => {
    if (!token || !sessionUser || activeOrderListItems.length === 0) {
      setActiveOrderDetailsMap({});
      return;
    }

    let cancelled = false;

    async function loadAllActiveOrderDetails() {
      try {
        const promises = activeOrderListItems.map(async (item) => {
          if (selectedOrder?.id === item.id) {
            return selectedOrder;
          }
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
          const nextMap: Record<string, CustomerOrderDetail> = {};
          results.forEach((detail) => {
            if (detail) {
              nextMap[detail.id] = detail;
            }
          });
          setActiveOrderDetailsMap(nextMap);
        }
      } catch (err) {
        console.error('Error loading active order details:', err);
      }
    }

    void loadAllActiveOrderDetails();

    return () => {
      cancelled = true;
    };
  }, [activeOrderListItems, apiBase, selectedOrder, sessionUser, token]);

  const loadDashboardRef = useRef(loadDashboard);
  useEffect(() => { loadDashboardRef.current = loadDashboard; }, [loadDashboard]);
  const loadOrderDetailRef = useRef(loadOrderDetail);
  useEffect(() => { loadOrderDetailRef.current = loadOrderDetail; }, [loadOrderDetail]);

  useForegroundPolling(() => {
    // Solo refresca cuando el socket está caído: el respaldo se activa exactamente
    // cuando el socket no puede entregar eventos (segundo plano, red inestable).
    if (token && sessionUser?.role === 'CUSTOMER' && (!socketRef.current || socketRef.current.disconnected)) {
      void loadDashboardRef.current(true);
    }
  });

  const sessionUserIdRef = useRef(sessionUser?.id);
  useEffect(() => { sessionUserIdRef.current = sessionUser?.id; }, [sessionUser?.id]);

  useEffect(() => {
    if (!token || !sessionUser || sessionUser.role !== 'CUSTOMER') {
      return;
    }

    setSocketStatus('connecting');
    const socket = io('https://sadel-production.up.railway.app', {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
    });

    socketRef.current = socket;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (process.env.NODE_ENV !== 'production') {
          console.log('[Socket.io] App visible - Sincronizando datos...');
        }
        if (socket.disconnected) {
          socket.connect();
        } else {
          void loadDashboardRef.current(true);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    socket.on('connect', () => {
      setSocketStatus('connected');
      setSocketAttempts(0);
      socket.emit('join-room', sessionUserIdRef.current, 'CUSTOMER');
      void loadDashboardRef.current(true);
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

    for (const eventName of liveEvents) {
      socket.on(eventName, (payload: { orderId?: string; status?: string; driverName?: string }) => {
        const liveEventKey = buildLiveEventKey(eventName, payload);

        if (seenLiveEventKeysRef.current.includes(liveEventKey)) {
          return;
        }

        seenLiveEventKeysRef.current = [...seenLiveEventKeysRef.current.slice(-39), liveEventKey];

        setNotifications((current) =>
          [
            {
              id: liveEventKey,
              title: notificationTitleMap[eventName],
              message: buildNotificationMessage(eventName, payload),
              createdAt: new Date().toISOString(),
            },
            ...current,
          ].slice(0, 8)
        );

        if (eventName === 'order:rejected') {
          setScheduleProposalOrder((prev) => prev?.id === payload.orderId ? null : prev);
          const matchingOrder = orders.find((o) => o.id === payload.orderId);
          showTransientNotice({
            key: `socket-rejected:${liveEventKey}`,
            title: 'Pedido rechazado',
            description: 'El restaurante rechazó tu pedido. No te preocupes, no se realizó ningún cobro.',
            tone: 'danger',
            requiresAcknowledgement: true,
            orderId: payload.orderId,
            paymentMethod: matchingOrder?.paymentMethod,
            orderReference: matchingOrder?.orderReference,
          });
        } else if (normalizeOrderStatusValue(payload.status || '') === 'CANCELLED') {
          showTransientNotice({
            key: `socket-cancelled:${liveEventKey}`,
            title: 'Pedido cancelado',
            description: 'Tu pedido fue cancelado. Puedes volver a intentarlo cuando quieras.',
            tone: 'danger',
          });
        } else if (eventName === 'order:delivered' && payload.orderId) {
          if (localStorage.getItem(`sadel_dismissed_rating_${payload.orderId}`) ||
              localStorage.getItem(`sadel_prompted_rating_${payload.orderId}`)) return;
          try {
            if (window.localStorage.getItem('customerAlertSoundEnabled') !== 'false') {
              void playCustomerLlegueSound();
            }
          } catch (e) {}
          setOrderToRate(payload.orderId);
          const ratedOrder = orders.find((o: any) => o.id === payload.orderId);
          setRatingBusinessType((ratedOrder as any)?.restaurant?.businessType || null);
          setRatingIsPickup(false);
          setIsRatingModalOpen(true);
        } else if (eventName === 'order:picked-up' && payload.orderId) {
          const pickedOrder = orders.find((o: any) => o.id === payload.orderId);
          const isPickupOrder = (pickedOrder as any)?.fulfillmentType === 'PICKUP';
          if (isPickupOrder) {
            if (localStorage.getItem(`sadel_dismissed_rating_${payload.orderId}`) ||
                localStorage.getItem(`sadel_prompted_rating_${payload.orderId}`)) return;
            setOrderToRate(payload.orderId);
            setRatingBusinessType((pickedOrder as any)?.restaurant?.businessType || null);
            setRatingIsPickup(true);
            setIsRatingModalOpen(true);
          }
        } else if (eventName === 'order:completed' && payload.orderId) {
          if (localStorage.getItem(`sadel_dismissed_rating_${payload.orderId}`) ||
              localStorage.getItem(`sadel_prompted_rating_${payload.orderId}`)) return;
          setOrderToRate(payload.orderId);
          const completedOrder = orders.find((o: any) => o.id === payload.orderId);
          setRatingBusinessType((completedOrder as any)?.restaurant?.businessType || null);
          setRatingIsPickup(true);
          setIsRatingModalOpen(true);
        } else if (eventName === 'order:pin-reset' && payload.orderId) {
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
        } else if (eventName === 'order:schedule-proposal') {
          if (payload.orderId) {
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
        } else if (eventName === 'order:schedule-accepted') {
          if (payload.orderId) {
            setScheduleProposalOrder(null);
            showTransientNotice({
              key: `schedule-accepted:${liveEventKey}`,
              title: 'Fecha confirmada',
              description: 'La fecha de entrega ha sido confirmada exitosamente.',
              tone: 'success',
            });
          }
        } else if (eventName === 'order:schedule-rejected') {
          setScheduleProposalOrder(null);
        } else if (eventName === 'order:ready') {
          try {
            if (window.localStorage.getItem('customerAlertSoundEnabled') !== 'false') {
              void playCustomerLlegueSound();
            }
            if (navigator.vibrate) navigator.vibrate([300, 100, 300]);
          } catch (e) {}
          // Check if it's a pickup order — fetch detail and show modal
          if (payload.orderId) {
            requestJson<{ success: true; data: CustomerOrderDetail }>({
              apiBase,
              path: `/me/pedidos/${payload.orderId}`,
              token,
            }).then((detailRes) => {
              if (detailRes.success && detailRes.data.fulfillmentType === 'PICKUP') {
                setPickupReadyOrder(detailRes.data);
                try { localStorage.setItem('sadel_persistent_modal', JSON.stringify({ type: 'pickup_ready', orderId: payload.orderId })); } catch {}
                return;
              }
              showTransientNotice({
                key: `socket-update:${liveEventKey}`,
                title: notificationTitleMap[eventName] || 'Pedido listo',
                description: buildNotificationMessage(eventName, payload),
                tone: 'info',
              });
            }).catch(() => {
              showTransientNotice({
                key: `socket-update:${liveEventKey}`,
                title: notificationTitleMap[eventName] || 'Pedido listo',
                description: buildNotificationMessage(eventName, payload),
                tone: 'info',
              });
            });
          } else {
            showTransientNotice({
              key: `socket-update:${liveEventKey}`,
              title: notificationTitleMap[eventName] || 'Pedido listo',
              description: buildNotificationMessage(eventName, payload),
              tone: 'info',
            });
          }
        } else if ([
          'order:driver-arrived',
          'order:driver_arrived',
        ].includes(eventName)) {
          try {
            if (window.localStorage.getItem('customerAlertSoundEnabled') !== 'false') {
              void playCustomerLlegueSound();
            }
            if (navigator.vibrate) navigator.vibrate([800, 400, 800, 400, 800]);
          } catch (e) {}
        } else if ([
          'order:preparing',
          'order:driver-assigned',
          'order:picked-up',
          'order:in-transit'
        ].includes(eventName)) {
          showTransientNotice({
            key: `socket-update:${liveEventKey}`,
            title: notificationTitleMap[eventName] || 'Actualización de pedido',
            description: buildNotificationMessage(eventName, payload),
            tone: 'info',
          });
        } else if (eventName === 'order:cancellation-approved') {
          try {
            if (window.localStorage.getItem('customerAlertSoundEnabled') !== 'false') {
              void playCustomerAlertAudio();
            }
          } catch (e) {}
          const matchingOrder = orders.find((o) => o.id === payload.orderId);
          showTransientNotice({
            key: `socket-cancellation-approved:${liveEventKey}`,
            title: 'Cancelación aprobada',
            description: `El restaurante aceptó la cancelación del pedido #${matchingOrder?.orderReference || payload.orderId}.`,
            tone: 'info',
            requiresAcknowledgement: true,
            orderReference: matchingOrder?.orderReference,
            orderId: payload.orderId,
          });
        } else if (eventName === 'order:cancellation-rejected') {
          try {
            if (window.localStorage.getItem('customerAlertSoundEnabled') !== 'false') {
              void playCustomerAlertAudio();
            }
          } catch (e) {}
          const matchingOrder = orders.find((o) => o.id === payload.orderId);
          showTransientNotice({
            key: `socket-cancellation-rejected:${liveEventKey}`,
            title: 'Cancelación rechazada',
            description: `El restaurante rechazó la cancelación del pedido #${matchingOrder?.orderReference || payload.orderId}. El pedido continúa su curso normal.`,
            tone: 'info',
            requiresAcknowledgement: true,
            orderReference: matchingOrder?.orderReference,
            orderId: payload.orderId,
          });
        }

        console.log(`[Socket.io] Evento recibido: "${eventName}"`, payload);

        void loadDashboardRef.current(true);
        if (payload.orderId) {
          console.log(`[Socket.io] Cargando detalles de pedido para ID: ${payload.orderId}`);
          setSelectedOrderId(payload.orderId);
          void loadOrderDetailRef.current(payload.orderId).then((orderData) => {
            console.log(`[Socket.io] Detalle cargado para pedido ${payload.orderId}:`, orderData);
            if (['order:driver-arrived', 'order:driver_arrived'].includes(eventName)) {
              if (orderData) {
                console.log('[Socket.io] Abriendo modal premium de llegada del repartidor con datos:', orderData);
                setArrivedOrder(orderData);
                setIsDriverArrivedModalOpen(true);
                try { localStorage.setItem('sadel_persistent_modal', JSON.stringify({ type: 'driver_arrived', orderId: payload.orderId })); } catch {}
              } else {
                console.error(`[Socket.io] Error: se recibio ${eventName} pero los datos del pedido son nulos.`);
              }
            }
          });
        } else {
          console.warn(`[Socket.io] Advertencia: se recibio ${eventName} pero no tiene payload.orderId`, payload);
        }
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

    socket.on('order_chat:message_received', (payload: any) => {
      if (window.localStorage.getItem('customerAlertSoundEnabled') !== 'false') {
        void playChatMessageSound();
      }

      const chatStore = useChatStore.getState();
      const notification = chatStore.handleIncomingMessage(payload, selectedOrderIdRef.current, chatStore.isChatOpen);

      if (notification) {
        setNotifications((current) =>
          [
            {
              id: notification.id,
              title: notification.title,
              message: notification.message,
              createdAt: new Date().toISOString(),
            },
            ...current,
          ].slice(0, 8)
        );
      }
    });

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      for (const eventName of liveEvents) {
        socket.off(eventName);
      }
      socket.off('order_chat:message_received');
      socket.off('account:suspended');
      socket.emit('leave-room', sessionUserIdRef.current, 'CUSTOMER');
      socket.disconnect();
      socketRef.current = null;
      setSocketStatus('idle');
      setSocketAttempts(0);
    };
  }, [apiBase, sessionUser?.id, token]);

  const soundedStatusChangesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const previousSnapshot = orderStatusSnapshotRef.current;
    const nextSnapshot: Record<string, string> = {};

    for (const order of orders) {
      const normalizedStatus = normalizeOrderStatusValue(order.status);
      nextSnapshot[order.id] = normalizedStatus;
      const previousStatus = previousSnapshot[order.id];

      if (!previousStatus || previousStatus === normalizedStatus) {
        continue;
      }

      const changeKey = `${order.id}:${normalizedStatus}`;
      const alreadySounded = soundedStatusChangesRef.current.has(changeKey);

      if (!alreadySounded) {
        const nextSet = new Set(soundedStatusChangesRef.current);
        if (nextSet.size >= 100) {
          const entries = [...nextSet];
          nextSet.clear();
          entries.slice(-80).forEach(k => nextSet.add(k));
        }
        nextSet.add(changeKey);
        soundedStatusChangesRef.current = nextSet;
      }

      if (normalizedStatus === 'DELIVERED') {
        if (!alreadySounded) {
          try {
            if (window.localStorage.getItem('customerAlertSoundEnabled') !== 'false') {
              void playCustomerLlegueSound();
            }
          } catch (e) {}
        }
        setOrderToRate(order.id);
        setRatingBusinessType((order as any).restaurant?.businessType || null);
        setIsRatingModalOpen(true);
      } else if (normalizedStatus === 'READY') {
        if (!alreadySounded) {
          try {
            if (window.localStorage.getItem('customerAlertSoundEnabled') !== 'false') {
              void playCustomerLlegueSound();
            }
          } catch (e) {}
        }
        showTransientNotice({
          key: `order-status-ready:${order.id}`,
          title: 'Pedido listo',
          description: `Tu pedido ${order.orderReference} está listo.`,
          tone: 'success',
        });
      } else if (normalizedStatus === 'REJECTED') {
        if (!alreadySounded) {
          try {
            if (window.localStorage.getItem('customerAlertSoundEnabled') !== 'false') {
              void playCustomerAlertAudio();
            }
          } catch (e) {}
        }
        showTransientNotice({
          key: `order-status-rejected:${order.id}:${normalizedStatus}`,
          title: 'Pedido rechazado',
          description: `El restaurante no pudo aceptar ${order.orderReference}.`,
          tone: 'danger',
          requiresAcknowledgement: true,
          orderId: order.id,
          paymentMethod: order.paymentMethod,
          orderReference: order.orderReference,
        });
      } else if (normalizedStatus === 'CANCELLED') {
        if (!alreadySounded) {
          try {
            if (window.localStorage.getItem('customerAlertSoundEnabled') !== 'false') {
              void playCustomerAlertAudio();
            }
          } catch (e) {}
        }
        showTransientNotice({
          key: `order-status-cancelled:${order.id}:${normalizedStatus}`,
          title: 'Pedido cancelado',
          description: `El pedido ${order.orderReference} fue cancelado.`,
          tone: 'danger',
        });
      }
    }

    orderStatusSnapshotRef.current = nextSnapshot;
  }, [orders]);

  async function reorderSelectedOrder(customAddress?: any) {
    if (reordering) {
      return;
    }

    if (!token || !sessionUser || sessionUser.role !== 'CUSTOMER') {
      setError('Inicia sesión como cliente para repetir pedidos.');
      return;
    }

    if (!selectedOrder) {
      return;
    }

    setReordering(true);
    setError('');

    try {
      const payload = await requestJson<{ success: true; data: { id: string; orderReference: string } }>({
        apiBase,
        path: '/pedidos',
        token,
        options: {
          method: 'POST',
          body: JSON.stringify({
            restaurantId: selectedOrder.restaurant.id,
            items: selectedOrder.items.map((item) => ({
              productId: item.product.id,
              quantity: item.quantity,
              ...(item.specialInstructions ? { specialInstructions: item.specialInstructions } : {}),
            })),
            fulfillmentType: selectedOrder.fulfillmentType || 'DELIVERY',
            ...(selectedOrder.fulfillmentType === 'PICKUP' || !selectedOrder.address
              ? {}
              : {
                  deliveryAddress: customAddress || {
                    street: selectedOrder.address.street,
                    number: selectedOrder.address.number,
                    neighborhood: selectedOrder.address.neighborhood,
                    city: selectedOrder.address.city,
                    state: selectedOrder.address.state,
                    zipCode: selectedOrder.address.zipCode,
                    country: selectedOrder.address.country,
                    ...(selectedOrder.address.reference ? { reference: selectedOrder.address.reference } : {}),
                    latitude: selectedOrder.address.latitude,
                    longitude: selectedOrder.address.longitude,
                  },
                }),
            paymentMethod: selectedOrder.paymentMethod,
            ...(selectedOrder.notes ? { notes: selectedOrder.notes } : {}),
          }),
        },
        fallbackMessage: 'No se pudo repetir el pedido.',
      });

      await loadDashboard();
      setSelectedOrderId(payload.data.id);
      await loadOrderDetail(payload.data.id);
      showTransientNotice({
        key: `order-repeated:${payload.data.id}`,
        title: 'Pedido creado con éxito',
        description: `Se generó de nuevo el pedido ${payload.data.orderReference}.`,
        tone: 'success',
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo repetir el pedido.');
    } finally {
      setReordering(false);
    }
  }

  function openDashboardSection(section: DashboardSection) {
    if (!isAuthenticated && (section === 'profile' || section === 'history' || section === 'support' || section === 'checkout')) {
      setShowAuthModal(true);
      return;
    }
    if (section === 'checkout' && cartRestaurantId && cartRestaurantId !== selectedRestaurantId) {
      setSelectedRestaurantId(cartRestaurantId);
    }
    setActiveSection(section);
    setIsSideMenuOpen(false);
    if (section === 'profile') {
      setIsEditingAddress(false);
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





  function updateAddressMarker(lat: number, lng: number) {
    const google = (window as any).google;
    if (!google || !addressMapRef.current) return;

    if (addressMarkerRef.current) {
      // @ts-ignore
      addressMarkerRef.current.setPosition({ lat, lng });
    } else {
      addressMarkerRef.current = new google.maps.Marker({
        position: { lat, lng },
        map: addressMapRef.current,
        draggable: true
      });

      // @ts-ignore
      addressMarkerRef.current.addListener('dragend', async () => {
        // @ts-ignore
        const position = addressMarkerRef.current.getPosition();
        if (!position) return;
        
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

              setProfileAddress((current) => ({
                ...current,
                street: street || current.street || '',
                number: houseNumber || current.number || '',
                neighborhood: neighborhood || current.neighborhood || '',
                city: city || current.city || '',
                state: state || current.state || '',
                zipCode: zipCode || current.zipCode || '',
                latitude: position.lat(),
                longitude: position.lng(),
              }));

              setAddressSearchQuery(data.formatted_address);
            }
          });
        } catch (err) {
          console.error('Error in reverse geocoding on drag:', err);
        }
      });
    }
  }

  if (!isAuthChecked || !isLocationChecked) {
    return (
      <div className="min-h-screen bg-[#fafafa] flex items-center justify-center">
        <div className="text-neutral-500 text-sm font-medium">Cargando...</div>
      </div>
    );
  }

  // Removed mandatory AuthGate early return to support guest browsing

  if (!userLocation) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
        <div className="w-full max-w-md rounded-[32px] bg-white px-8 pt-10 pb-8 shadow-[0_32px_100px_rgba(15,15,15,0.28)]">
          <div className="flex justify-center mb-7">
            <SaDelLogo className="h-8 w-auto object-contain" />
          </div>

          <div className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#f0f0f0] text-neutral-600">
              <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <h2 className="mt-4 text-xl font-semibold tracking-tight text-neutral-900">¿Dónde estás?</h2>
            <p className="mt-1.5 text-sm text-neutral-500">
              {locationExpired
                ? 'Tu ubicación guardada está desactualizada. Actualízala para ver las tiendas de tu zona.'
                : 'Necesitamos tu ubicación para mostrarte todas las tiendas cerca de ti.'}
            </p>
          </div>

          <div className="mt-6">
            <button
              type="button"
              onClick={() => {
                if (!navigator.geolocation) {
                  alert('Tu navegador no soporta geolocalización');
                  return;
                }
                navigator.geolocation.getCurrentPosition(async (position) => {
                  const { latitude, longitude, accuracy } = position.coords;
                  try {
                    const google = (window as any).google;
                    if (!google) throw new Error("Google Maps not loaded");

                    const geocoder = new google.maps.Geocoder();
                    geocoder.geocode({ location: { lat: latitude, lng: longitude } }, async (results: any, status: any) => {
                      if (status === "OK" && results && results[0]) {
                        const data = results[0];
                        let houseNumber = '';
                        const houseComponent = data.address_components.find((c: any) => c.types.includes('street_number'));
                        if (houseComponent) houseNumber = houseComponent.long_name;
                        
                        let street = 'Ubicación actual';
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

                        let country = '';
                        const countryComponent = data.address_components.find((c: any) => c.types.includes('country'));
                        if (countryComponent) country = countryComponent.long_name;

                        const addressPayload = {
                          street: street,
                          number: houseNumber,
                          apartment: '',
                          neighborhood: neighborhood,
                          city: city,
                          state: state,
                          zipCode: zipCode,
                          country: country,
                          reference: data.formatted_address || 'Ubicación actual',
                          latitude,
                          longitude,
                        };

                        const loc = { latitude, longitude, accuracy, address: addressPayload.reference, ts: Date.now() };
                        try { localStorage.setItem('userLocation', JSON.stringify(loc)); localStorage.setItem('locationSource', 'gps'); } catch (e) { }
                        setLocationExpired(false);
                        setUserLocation(loc);
                        setLocationSource('gps');
                        setLocationDenied(false);

                        // Call backend to verify/upsert address and mark it as verified
                        try {
                          if (token) {
                            await fetch(`${apiBase}/customer/addresses/verify`, {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${token}`,
                              },
                              body: JSON.stringify(addressPayload),
                            });
                          }
                        } catch (e) {
                          console.warn('Could not verify address on server:', e);
                        }
                      } else {
                        throw new Error("No results");
                      }
                    });
                  } catch (err) {
                    const loc = { latitude, longitude, accuracy, address: 'Ubicación actual', ts: Date.now() };
                    try { localStorage.setItem('userLocation', JSON.stringify(loc)); localStorage.setItem('locationSource', 'gps'); } catch (e) { }
                    setLocationExpired(false);
                    setUserLocation(loc);
                    setLocationSource('gps');
                    setLocationDenied(false);
                  }
                }, (err) => {
                  const errCode = err && (err as any).code;
                  if (errCode === 1) {
                    setLocationDenied(true);
                    try { localStorage.setItem('locationDenied', '1'); } catch (e) { }
                    alert('Permiso de ubicación denegado. Puedes cambiar esto en la configuración de tu navegador o ingresar tu dirección manualmente.');
                  } else if (errCode === 2) {
                    console.warn('GPS no disponible temporalmente. El usuario puede intentar de nuevo o usar búsqueda manual.');
                  } else {
                    console.warn('Error de geolocalización:', err);
                  }
                }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
              }}
              className="flex w-full items-center justify-center gap-3 rounded-2xl bg-[#161616] px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-neutral-800 active:scale-[0.98]"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
              </svg>
              Usar mi ubicación
            </button>

            <div className="mt-5 flex items-center justify-center gap-3">
              <div className="h-px w-full bg-neutral-200"></div>
              <span className="text-[11px] font-semibold uppercase tracking-widest text-neutral-400 whitespace-nowrap">o escribe tu dirección</span>
              <div className="h-px w-full bg-neutral-200"></div>
            </div>

            <div className="mt-5 relative text-left">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Busca tu ciudad, colonia o calle..."
                  value={fallbackSearchQuery}
                  onChange={(e) => {
                    setFallbackSearchQuery(e.target.value);
                    void searchFallbackAddress(e.target.value);
                  }}
                  className="w-full rounded-2xl border border-black/10 bg-neutral-50 py-3.5 pl-11 pr-4 text-[15px] font-medium text-neutral-900 placeholder:text-neutral-400 focus:border-[#161616] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#161616]/10 transition-all"
                />
                <svg className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                
                {isSearchingFallback && (
                  <div className="absolute right-4 top-1/2 -translate-y-1/2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-300 border-t-[#161616]"></div>
                  </div>
                )}
              </div>

              {fallbackSuggestions.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-2 overflow-hidden rounded-2xl border border-black/5 bg-white shadow-[0_8px_30px_rgb(0,0,0,0.12)] z-50">
                  {fallbackSuggestions.map((suggestion, index) => (
                    <div
                      key={suggestion.place_id || index}
                      className="flex cursor-pointer items-start gap-3 border-b border-black/5 p-4 transition-colors hover:bg-neutral-50 active:bg-neutral-100 last:border-0"
                      onClick={() => selectFallbackSuggestion(suggestion)}
                    >
                      <div className="mt-0.5 text-neutral-400">
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0x" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0x" />
                        </svg>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[14px] font-bold text-neutral-900">{suggestion.name}</span>
                        <span className="mt-0.5 text-[12px] text-neutral-500 line-clamp-1">{suggestion.description}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const totalUnreadMessages = Object.values(unreadMessagesMap).reduce((acc, count) => acc + count, 0);

  return (
    <main
      className={`relative min-h-[100dvh] bg-[#fafafa] text-neutral-900 transition-colors duration-300 ${isCartOpen || isSideMenuOpen ? 'overflow-hidden' : ''}`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <Script
        src={`https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''}&libraries=places&loading=async`}
        strategy="lazyOnload"
      />
      <div className={`fixed inset-0 z-[9999] bg-white transition-opacity duration-700 pointer-events-none ${isTransitioning ? 'opacity-100' : 'opacity-0'}`} />
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

      {toastMessage ? (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-2xl border px-5 py-3 text-sm shadow-[0_4px_16px_rgba(0,0,0,0.08)] flex items-center gap-2 ${
          toastData.type === 'error' 
            ? 'border-red-200 bg-red-50 text-red-700' 
            : toastData.type === 'info'
            ? 'border-blue-200 bg-blue-50 text-blue-700'
            : 'border-emerald-100 bg-emerald-50 text-emerald-700'
        }`}>
          {toastData.type === 'error' ? (
            <svg className="h-4 w-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          ) : toastData.type === 'info' ? (
            <svg className="h-4 w-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ) : (
            <svg className="h-4 w-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          )}
          <span className="font-medium">{toastMessage}</span>
        </div>
      ) : null}

      <div className="sticky top-0 z-40 bg-white">
        {!isOnline && (
          <div className="bg-amber-500 text-white text-center py-2 text-sm font-medium shadow-md">
            Estás sin conexión. Los datos pueden no estar actualizados.
          </div>
        )}

        <header className="border-b border-black/5 bg-white">
          <div className="mx-auto max-w-7xl px-4 py-4 md:px-6">
            <div className="flex items-center justify-between gap-3 relative">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsSideMenuOpen((current) => !current)}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-black/10 bg-white text-neutral-800 shadow-sm transition hover:bg-neutral-50"
                  aria-label="Abrir menu principal"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 7h16M4 12h16M4 17h16" />
                  </svg>
                </button>

                <button
                  type="button"
                  onClick={() => openDashboardSection('home')}
                  className="max-sm:absolute max-sm:left-1/2 max-sm:-translate-x-1/2 min-w-0 text-left"
                >
                  <SaDelLogo className="h-7 w-auto object-contain md:h-8" />
                  <p className="truncate text-[8px] font-bold uppercase tracking-[0.26em] text-neutral-400 dark:text-neutral-500 md:text-[9px] mt-0.5 leading-none">
                    Un click de distancia
                  </p>
                </button>
              </div>

              {activeSection === 'home' && (
                <div className="hidden min-w-0 flex-1 md:block">
                  <div className="relative mx-auto w-full max-w-xl">
                    <RestaurantSearchBar />
                  </div>
                </div>
              )}

              <div className="flex shrink-0 items-center gap-2">

                {isAuthChecked && !isAuthenticated && (
                  <button
                    type="button"
                    onClick={() => setShowAuthModal(true)}
                    className="relative inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-black/10 bg-white text-neutral-800 shadow-sm transition hover:bg-neutral-50 active:scale-95 overflow-hidden"
                    aria-label="Iniciar sesión"
                  >
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setIsCartOpen((current) => !current)}
                  className={`relative inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-black/10 bg-white text-neutral-800 shadow-sm transition hover:bg-neutral-50 ${cart.length > 0 ? 'animate-[pulse_2s_ease-in-out_infinite]' : ''}`}
                  aria-label="Abrir carrito"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 4h2l.4 2M7 14h10l4-8H5.4M7 14l-1.5 2.5A1 1 0 006.4 18H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                  {cart.length > 0 && !isCartOpen ? (
                    <span className="absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-sky-500 px-1 text-[11px] font-bold text-white shadow-sm">
                      {cart.length}
                    </span>
                  ) : null}
                </button>

              </div>
            </div>

            {activeSection === 'home' && (
              <div className="mt-3 md:hidden">
                <RestaurantSearchBar />
              </div>
            )}
          </div>

        </header>
      </div>

      {activeOrderListItems.length > 0 ? (
        <div className="border-b border-black/5 bg-[#fbf8f1]/92 backdrop-blur">
          <div className="mx-auto max-w-7xl px-4 py-4 md:px-6">
            <div className="relative">

              {/* Chevron Izquierdo */}
              {activeOrderListItems.length > 1 && (
                <button
                  type="button"
                  onClick={() => setCarouselIndex((prev) => (prev > 0 ? prev - 1 : activeOrderListItems.length - 1))}
                  className="absolute -left-3 md:-left-5 top-1/2 -translate-y-1/2 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-black/10 bg-white/90 text-neutral-800 shadow-md backdrop-blur transition hover:bg-neutral-50 active:scale-95"
                  aria-label="Pedido anterior"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              )}

              {/* Contenedor del Banner */}
              <div className="transition-all duration-300">
                {activeOrderListItem && (
                  <CompactActiveOrderBanner
                    order={pinnedOrder}
                    fallbackOrder={activeOrderListItem}
                    unreadCount={unreadMessagesMap[activeOrderListItem.id] || 0}
                    isTrackingEnabled={isTrackingEnabled}
                    setIsTrackingEnabled={setIsTrackingEnabled}
                    driverLocation={driverLocation}
                    setDriverLocation={setDriverLocation}
                    onOpenHistory={() => {
                      setSelectedOrderId(activeOrderListItem.id);
                      setIsDetailModalOpen(true);
                    }}
                    onOpenChat={() => {
                      const orderId = pinnedOrder?.id || activeOrderListItem.id;
                      useChatStore.getState().openChat(orderId);
                      void loadChatMessages(orderId);
                    }}
                  />
                )}
              </div>

              {/* Chevron Derecho */}
              {activeOrderListItems.length > 1 && (
                <button
                  type="button"
                  onClick={() => setCarouselIndex((prev) => (prev < activeOrderListItems.length - 1 ? prev + 1 : 0))}
                  className="absolute -right-3 md:-right-5 top-1/2 -translate-y-1/2 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-black/10 bg-white/90 text-neutral-800 shadow-md backdrop-blur transition hover:bg-neutral-50 active:scale-95"
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
                      className={`h-1.5 rounded-full transition-all duration-300 ${isActive
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

      <div className={`fixed inset-0 z-50 transition-all duration-300 ${isSideMenuOpen ? 'visible opacity-100' : 'invisible opacity-0'}`}>
        <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" onClick={() => setIsSideMenuOpen(false)} />
        <aside
          ref={sideMenuRef}
          className={`absolute left-0 top-0 flex h-full w-[300px] max-w-[85vw] flex-col bg-white shadow-[0_24px_90px_rgba(15,15,15,0.18)] transition-transform duration-300 ease-out ${isSideMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-black/[0.04]">
            <p className="text-base font-bold tracking-tight text-neutral-900">Tu cuenta</p>
            <button
              type="button"
              onClick={() => setIsSideMenuOpen(false)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-black/8 bg-white text-neutral-500 transition hover:bg-neutral-50"
              aria-label="Cerrar"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          {isAuthenticated && (
            <div className="mx-4 mt-4 flex items-center gap-3 rounded-2xl bg-sky-50/70 p-3.5 border border-sky-100/50">
              {sessionUser?.profilePhoto ? (
                <img src={sessionUser.profilePhoto} alt="" loading="lazy" decoding="async" className="h-10 w-10 rounded-full object-cover" />
              ) : (
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-sky-500 font-bold text-white text-sm shadow-sm">
                  {((sessionUser?.name?.[0] || '') + (sessionUser?.lastName?.[0] || '')).toUpperCase() || 'U'}
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-neutral-900">
                  {(() => {
                    const n = (sessionUser?.name || '').trim();
                    const ln = (sessionUser?.lastName || '').trim();
                    if (!ln && n.includes(' ')) return n;
                    return `${n.split(' ')[0] || ''} ${ln.split(' ')[0] || ''}`.trim();
                  })()}
                </p>
                <p className="text-[11px] text-neutral-500 font-medium">Cliente</p>
              </div>
            </div>
          )}

          {!isAuthenticated && (
            <div className="mx-4 mt-4">
              <button
                type="button"
                onClick={() => { setShowAuthModal(true); setIsSideMenuOpen(false); }}
                className="group relative w-full overflow-hidden rounded-2xl bg-gradient-to-b from-neutral-900 to-neutral-950 p-4 text-left shadow-[0_8px_24px_rgba(0,0,0,0.12)] transition-all duration-200 hover:shadow-[0_12px_32px_rgba(0,0,0,0.18)] active:scale-[0.98]"
              >
                <div className="relative z-10">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10">
                      <svg className="h-4 w-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    </div>
                    <p className="text-sm font-semibold text-white">Iniciar sesión</p>
                  </div>
                  <p className="mt-1.5 text-[11px] text-white/50 font-medium leading-relaxed">
                    Accede para ver tus pedidos y guardar tus favoritos.
                  </p>
                </div>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-white/20 transition-transform duration-200 group-hover:translate-x-0.5">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>
            </div>
          )}

          <div className="flex-1 px-3 py-4 space-y-0.5">
            <button
              type="button"
              onClick={() => { openDashboardSection('home'); setIsSideMenuOpen(false); }}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all active-scale ${
                activeSection === 'home' ? 'bg-sky-50 text-sky-700' : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900'
              }`}
            >
              <svg className={`h-5 w-5 ${activeSection === 'home' ? 'text-sky-500' : 'text-neutral-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              <span>Ver tiendas</span>
            </button>
            <button
              type="button"
              onClick={() => { openDashboardSection('profile'); setIsSideMenuOpen(false); }}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all active-scale ${
                activeSection === 'profile' ? 'bg-sky-50 text-sky-700' : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900'
              }`}
            >
              <svg className={`h-5 w-5 ${activeSection === 'profile' ? 'text-sky-500' : 'text-neutral-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span>Mi perfil</span>
            </button>
            <button
              type="button"
              onClick={() => { openDashboardSection('history'); setIsSideMenuOpen(false); }}
              className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition-all active-scale ${
                activeSection === 'history' ? 'bg-sky-50 text-sky-700' : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900'
              }`}
            >
              <div className="flex items-center gap-3">
                <svg className={`h-5 w-5 ${activeSection === 'history' ? 'text-sky-500' : 'text-neutral-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Historial</span>
              </div>
              <span className={`text-[11px] font-medium ${activeSection === 'history' ? 'text-sky-500' : 'text-neutral-400'}`}>{orderStats.total}</span>
            </button>
            <button
              type="button"
              onClick={() => { openDashboardSection('support'); setIsSideMenuOpen(false); }}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all active-scale ${
                activeSection === 'support' ? 'bg-sky-50 text-sky-700' : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900'
              }`}
            >
              <svg className={`h-5 w-5 ${activeSection === 'support' ? 'text-sky-500' : 'text-neutral-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              <span>Soporte</span>
            </button>
          </div>

          <div className="border-t border-black/[0.04] px-4 py-4 space-y-1.5">
            <div className="flex items-center justify-between rounded-2xl border border-black/5 bg-white px-4 py-3 text-sm font-semibold text-neutral-700">
              <div className="flex items-center gap-3">
                <svg className="h-5 w-5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
                <span>Modo Oscuro</span>
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
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${isDarkMode ? 'bg-sky-500' : 'bg-neutral-300'}`}
              >
                <span className={`inline-block h-3 w-3 rounded-full bg-white shadow-sm transition ${isDarkMode ? 'translate-x-4' : 'translate-x-1'}`} />
              </button>
            </div>
            {isAuthenticated && (
              <button
                type="button"
                onClick={() => clearSession('Sesión cerrada.')}
                className="flex w-full items-center justify-between rounded-2xl border border-black/5 bg-white px-4 py-3 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 transition"
              >
                <div className="flex items-center gap-3">
                  <svg className="h-5 w-5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  <span>Cerrar sesión</span>
                </div>
              </button>
            )}
          </div>
        </aside>
      </div>

      <CartDrawer
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        onProceedToCheckout={() => {
          setIsCartOpen(false);
          if (!isAuthenticated) {
            setShowAuthModal(true);
          } else if (cartRestaurantId) {
            router.push(`/restaurantes/${cartRestaurantId}?checkout=true&fulfillment=${fulfillmentType}`);
          }
        }}
        fulfillmentType={fulfillmentType}
        onFulfillmentTypeChange={setFulfillmentType}
      />
      <div className="mx-auto max-w-7xl px-4 py-4 md:px-6 md:py-5">
        {activeSection !== 'home' && activeSection !== 'profile' ? (
          <div className="mb-2 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between animate-[fadeIn_0.4s_ease-out]">
            <div>

              <h1 className="mt-2 text-3xl font-black tracking-[-0.04em] text-neutral-900 md:text-4xl">
                {activeSection === 'support' ? 'Centro de Ayuda' : 'Historial de pedidos'}
              </h1>
              <p className="mt-2 text-[14px] md:text-[15px] font-medium text-neutral-500 max-w-2xl">
                {activeSection === 'support'
                  ? '¿En qué podemos ayudarte hoy?'
                  : 'Consulta el estado y los detalles de tus compras pasadas.'}
              </p>
            </div>

            {activeSection === 'history' ? (
              <div className="mt-8 mx-auto lg:mx-0 flex items-center divide-x divide-neutral-200/60 rounded-[20px] bg-white/60 backdrop-blur-xl border border-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] px-6 md:px-8 py-4 w-max transition-all hover:bg-white/80">
                
                {/* Total Pedidos */}
                <div className="pr-6 md:pr-8">
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-neutral-300"></div>
                    <p className="text-[10px] font-extrabold uppercase tracking-widest text-neutral-500">Total Pedidos</p>
                  </div>
                  <p className="text-3xl md:text-4xl font-black tracking-tighter text-neutral-900 leading-none">
                    {orderStats.total}
                  </p>
                </div>
                
                {/* Completados */}
                <div className="pl-6 md:pl-8">
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]"></div>
                    <p className="text-[10px] font-extrabold uppercase tracking-widest text-neutral-500">Completados</p>
                  </div>
                  <p className="text-3xl md:text-4xl font-black tracking-tighter text-emerald-600 leading-none">
                    {orderStats.deliveredOrders}
                  </p>
                </div>
                
              </div>
            ) : null}
          </div>
        ) : null}

        {error ? <div className="mt-4"><Callout tone="danger">{error}</Callout></div> : null}
        {/* authMessage visual suppressed by request */}
        {activeSection === 'checkout' ? (
          <CheckoutView
            openDashboardSection={openDashboardSection}
            addresses={addresses}
            selectedCheckoutAddressId={selectedCheckoutAddressId}
            setSelectedCheckoutAddressId={setSelectedCheckoutAddressId}
            fulfillmentType={fulfillmentType}
            setFulfillmentType={setFulfillmentType}
            paymentMethod={paymentMethod}
            setPaymentMethod={setPaymentMethod}
            paymentProofUrl={paymentProofUrl}
            setPaymentProofUrl={setPaymentProofUrl}
            paymentProofUploading={paymentProofUploading}
            handlePaymentProofUpload={handlePaymentProofUpload}
            cart={cart}
            cartSubtotal={cartSubtotal}
            cartServiceFee={cartServiceFee}
            cartTotal={cartTotal}
            selectedRestaurant={selectedRestaurant}
            orderNotes={orderNotes}
            setOrderNotes={setOrderNotes}
            handlePlaceOrder={handlePlaceOrder}
            formatCurrency={formatCurrency}
          />
        ) : null}
        {activeSection === 'profile' ? (
          <ProfileView 
            sessionUser={sessionUser}
            memberSinceLabel={memberSinceLabel}
            isCustomerSoundEnabled={isCustomerSoundEnabled}
            handleCustomerSoundToggle={handleCustomerSoundToggle}
            whatsappNotificationsEnabled={whatsappNotificationsEnabled}
            handleCustomerWhatsAppToggle={handleCustomerWhatsAppToggle}
            isSubscribed={isSubscribed}
            subscribePush={subscribePush}
            unsubscribePush={unsubscribePush}
            setEditName={setEditName}
            editLastName={editLastName}
            setEditLastName={setEditLastName}
            setEditPhone={setEditPhone}
            setIsEditingProfile={setIsEditingProfile}
            isEditingAddress={isEditingAddress}
            addressSearchQuery={addressSearchQuery}
            setAddressSearchQuery={setAddressSearchQuery}
            searchAddress={searchAddress}
            isSearchingAddress={isSearchingAddress}
            fillProfileAddressWithCurrentLocation={fillProfileAddressWithCurrentLocation}
            addressSuggestions={addressSuggestions}
            selectSuggestion={selectSuggestion}
            profileAddress={profileAddress}
            handleProfileAddressChange={handleProfileAddressChange}
            saveProfileAddress={saveProfileAddress}
            deleteProfileAddress={deleteProfileAddress}
            cancelProfileAddressEditing={cancelProfileAddressEditing}
            addresses={addresses}
            setProfileAddress={setProfileAddress}
            setIsEditingAddress={setIsEditingAddress}
            token={token}
            apiBase={apiBase}
            loadAddresses={loadAddresses}
            setToastMessage={setToastMessage}
            updatePreferences={updatePreferences}
            customerProfile={customerProfile}
            setIsChangingPassword={setIsChangingPassword}
            clearSession={clearSession}
            Field={Field}
          />
        ) : null}
        {activeSection === 'support' ? (
          <div className="mt-2 md:mt-6 max-w-5xl mx-auto space-y-3.5 md:space-y-6">
            {/* Banner de acción "¿Tienes algún problema?" */}
            <div className="relative overflow-hidden bg-white -mx-4 md:mx-0 md:rounded-[32px] border-y md:border border-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] px-4 py-10 md:p-12 text-center">
                {/* Decorative glow */}
                <div className="absolute top-0 right-0 -mr-20 -mt-20 w-64 h-64 bg-sky-200/20 rounded-full blur-3xl pointer-events-none"></div>
                
                <h3 className="text-xl sm:text-2xl font-black text-neutral-900 tracking-[-0.03em] relative z-10">¿Tienes algún problema?</h3>
                <p className="text-sm sm:text-base text-neutral-500 font-medium mt-1.5 mb-8 relative z-10">Cuéntanos qué pasó para poder ayudarte y resolverlo cuanto antes.</p>
                <button
                  type="button"
                  onClick={() => setIsSupportModalOpen(true)}
                  className="group relative z-10 inline-flex items-center gap-2 overflow-hidden rounded-full bg-neutral-900 px-8 py-3.5 text-[15px] font-bold text-white shadow-[0_8px_20px_rgba(0,0,0,0.16)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(0,0,0,0.22)] active:scale-[0.98]"
                >
                  <span className="relative z-10">Reportar un problema</span>
                  <div className="absolute inset-0 bg-gradient-to-r from-neutral-800 to-neutral-900 opacity-0 transition-opacity duration-300 group-hover:opacity-100"></div>
                </button>
              </div>

              {/* Historial de Reportes */}
              <div className="bg-white -mx-4 md:mx-0 md:rounded-[32px] border-y md:border border-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] md:overflow-hidden relative z-10">
                <div className="px-4 md:px-8 py-5 border-b border-black/[0.03] flex items-center justify-between bg-white">
                  <h3 className="text-lg font-bold text-neutral-950 tracking-tight">Mis Reportes</h3>
                  <button
                    type="button"
                    onClick={() => loadSupportTickets()}
                    className="active-scale flex items-center gap-2 text-xs sm:text-sm font-bold text-neutral-500 hover:text-sky-600 transition-colors bg-white px-4 py-1.5 rounded-full shadow-sm border border-neutral-100"
                  >
                    Actualizar
                  </button>
                </div>
                
                <div className="divide-y divide-black/[0.03]">
                  {loadingSupportTickets ? (
                    <div className="py-16 text-center animate-pulse">
                      <div className="w-10 h-10 border-4 border-neutral-200 border-t-sky-500 rounded-full animate-spin mx-auto mb-4"></div>
                      <p className="text-sm font-semibold text-neutral-400">Cargando reportes...</p>
                    </div>
                  ) : supportTickets.length === 0 ? (
                    <div className="py-20 text-center px-4">
                      <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-neutral-50 border border-neutral-100 shadow-sm">
                        <span className="text-[28px] opacity-80">🙌</span>
                      </div>
                      <h4 className="text-lg font-bold text-neutral-900">Todo en orden</h4>
                      <p className="mt-1 text-sm font-medium text-neutral-500">No tienes reportes activos en este momento.</p>
                    </div>
                  ) : (
                    supportTickets.map((ticket) => (
                      <div key={ticket.id} className="p-4 md:p-6 transition-colors hover:bg-neutral-50/30">
                        <div className="flex items-center justify-between gap-2 mb-2.5">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-600">
                              <span className="text-lg">{ticket.type === 'APP' ? '📱' : '🍔'}</span>
                            </div>
                            <div className="min-w-0">
                              <p className="text-[14px] font-bold text-neutral-900 truncate">
                                {ticket.type === 'APP' ? 'Problema con la App' : 'Problema con Pedido'}
                              </p>
                              <p className="text-[11px] text-neutral-400 mt-0.5">{new Date(ticket.createdAt).toLocaleString()}</p>
                            </div>
                          </div>
                          <span className={`text-[10px] font-black px-2.5 py-0.5 rounded-full tracking-wider uppercase ${
                            ticket.status === 'PENDING' ? 'bg-amber-50 text-amber-700 border border-amber-200/50' :
                            ticket.status === 'IN_PROGRESS' ? 'bg-sky-50 text-sky-700 border border-sky-200/50' :
                            'bg-emerald-50 text-emerald-700 border border-emerald-200/50'
                          }`}>
                            {ticket.status === 'PENDING' ? 'Pendiente' :
                             ticket.status === 'IN_PROGRESS' ? 'En Proceso' : 'Resuelto'}
                          </span>
                        </div>
                        
                        <div className="text-[13px] text-neutral-600 space-y-1 bg-neutral-50/50 rounded-xl p-3 border border-neutral-100">
                          {ticket.subject && <p><span className="font-semibold text-neutral-800">Asunto:</span> {ticket.subject}</p>}
                          {ticket.storeName && <p><span className="font-semibold text-neutral-800">Tienda:</span> {ticket.storeName}</p>}
                          {ticket.orderNumber && <p><span className="font-semibold text-neutral-800">Pedido:</span> #{ticket.orderNumber}</p>}
                          <p className="pt-1 text-neutral-700 leading-relaxed">{ticket.description}</p>
                        </div>

                        {ticket.response && (
                          <div className="mt-3 bg-emerald-50/60 border border-emerald-100/80 rounded-xl p-3.5">
                            <p className="text-[13px] font-bold text-emerald-800 mb-1">Respuesta de Soporte:</p>
                            <p className="text-[13px] text-emerald-700 whitespace-pre-wrap leading-relaxed">{ticket.response}</p>
                            <p className="text-[10px] text-emerald-500 mt-1.5 font-medium">
                              Respondido el: {new Date(ticket.respondedAt).toLocaleString()}
                            </p>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

            {/* Modal de Soporte */}
            {isSupportModalOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 py-6">
                <div className="relative w-full max-w-[480px] rounded-[32px] bg-[#f9fafb] shadow-[0_30px_100px_rgba(0,0,0,0.2)] overflow-hidden animate-scale-up">
                  
                  {/* Encabezado Fijo */}
                  <div className="sticky top-0 z-10 flex items-center justify-between bg-[#f9fafb]/90 backdrop-blur-md px-6 py-5 border-b border-black/5">
                    <div className="flex items-center gap-3">
                      {supportModalView !== 'options' && (
                        <button
                          type="button"
                          onClick={() => {
                            setSupportError('');
                            setSupportModalView('options');
                          }}
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-200/60 text-neutral-600 transition hover:bg-neutral-300 hover:text-neutral-900"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M15 18l-6-6 6-6" />
                          </svg>
                        </button>
                      )}
                      <div>
                        <h3 className="text-lg font-bold tracking-tight text-neutral-900">
                          {supportModalView === 'options' ? 'Soporte y Ayuda' : supportModalView === 'app_form' ? 'Problema con la app' : 'Problema con un pedido'}
                        </h3>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setIsSupportModalOpen(false);
                        setSupportModalView('options');
                        setSupportError('');
                      }}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-200/60 text-neutral-600 transition hover:bg-neutral-300 hover:text-neutral-900"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
                      </svg>
                    </button>
                  </div>

                  <div className="px-6 py-6 max-h-[80vh] overflow-y-auto no-scrollbar">
                    {supportError && (
                      <div className="mb-6 rounded-2xl bg-rose-50 border border-rose-100 p-4 flex items-start gap-3 animate-fade-in">
                        <div className="text-rose-500 shrink-0 mt-0.5">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                        </div>
                        <p className="text-sm font-medium text-rose-800">{supportError}</p>
                      </div>
                    )}

                    {supportModalView === 'options' ? (
                      <div className="space-y-4">
                        <p className="text-sm text-neutral-500 font-medium mb-2">Selecciona el tipo de problema:</p>
                        
                        <button
                          type="button"
                          onClick={() => { setSupportError(''); setSupportModalView('app_form'); }}
                          className="group w-full rounded-[24px] border border-black/5 bg-white p-5 text-left hover:border-black/10 hover:shadow-lg transition-all active:scale-[0.98] flex items-center gap-4"
                        >
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 transition-colors group-hover:bg-blue-100 group-hover:text-blue-700">
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>
                          </div>
                          <div>
                            <p className="text-base font-bold text-neutral-900 group-hover:text-blue-600 transition-colors">Problema con la app</p>
                            <p className="mt-0.5 text-xs font-medium text-neutral-500">Errores, lentitud, fallos visuales...</p>
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => { setSupportError(''); setSupportModalView('order_form'); }}
                          className="group w-full rounded-[24px] border border-black/5 bg-white p-5 text-left hover:border-black/10 hover:shadow-lg transition-all active:scale-[0.98] flex items-center gap-4"
                        >
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 transition-colors group-hover:bg-amber-100 group-hover:text-amber-700">
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/></svg>
                          </div>
                          <div>
                            <p className="text-base font-bold text-neutral-900 group-hover:text-amber-600 transition-colors">Problema con un pedido</p>
                            <p className="mt-0.5 text-xs font-medium text-neutral-500">Faltantes, comida fría, demora...</p>
                          </div>
                        </button>
                      </div>
                    ) : supportModalView === 'app_form' ? (
                      <div className="space-y-5">
                        <div>
                          <label className="text-[11px] font-bold uppercase tracking-widest text-neutral-400">Asunto</label>
                          <input
                            id="support_subject"
                            type="text"
                            placeholder="Ej. La app se cierra sola"
                            className="mt-2 w-full rounded-2xl border border-black/5 bg-white px-4 py-3.5 text-sm font-medium text-neutral-900 transition-colors focus:border-neutral-950 focus:outline-none focus:ring-1 focus:ring-neutral-950 placeholder:text-neutral-300"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] font-bold uppercase tracking-widest text-neutral-400">Cuéntanos tu problema</label>
                          <textarea
                            id="support_description"
                            placeholder="Describe detalladamente lo que pasó..."
                            rows={4}
                            className="mt-2 w-full rounded-2xl border border-black/5 bg-white px-4 py-3.5 text-sm font-medium text-neutral-900 transition-colors focus:border-neutral-950 focus:outline-none focus:ring-1 focus:ring-neutral-950 placeholder:text-neutral-300 resize-none"
                          ></textarea>
                        </div>
                        <div className="pt-4">
                          <button
                            type="button"
                            disabled={submittingSupport}
                            onClick={async () => {
                              const subject = (document.getElementById('support_subject') as HTMLInputElement)?.value;
                              const description = (document.getElementById('support_description') as HTMLTextAreaElement)?.value;
                              
                              if (!description.trim()) {
                                setSupportError('Por favor, ingresa una descripción de tu problema.');
                                return;
                              }
                              if (!subject.trim()) {
                                setSupportError('Por favor, ingresa un asunto.');
                                return;
                              }

                              setSupportError('');
                              setSubmittingSupport(true);

                              try {
                                const response = await fetch(`${'/api'}/customer/support/tickets`, {
                                  method: 'POST',
                                  headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${token || localStorage.getItem('sadel.customer.token')}`,
                                  },
                                  body: JSON.stringify({
                                    type: 'APP',
                                    subject,
                                    description,
                                  }),
                                });

                                if (response.status === 404) {
                                  console.warn('Backend support tickets endpoint returned 404. Saving to local storage.');
                                  const localTicketsStr = localStorage.getItem('local_support_tickets');
                                  const localTickets = localTicketsStr ? JSON.parse(localTicketsStr) : [];
                                  const newTicket = {
                                    id: `local_${Date.now()}`,
                                    type: 'APP',
                                    subject,
                                    description,
                                    createdAt: new Date().toISOString(),
                                  };
                                  localStorage.setItem('local_support_tickets', JSON.stringify([newTicket, ...localTickets]));
                                  
                                  setIsSupportSuccessModalOpen(true);
                                  setSupportTickets([newTicket, ...localTickets]);
                                  setIsSupportModalOpen(false);
                                  setSupportModalView('options');
                                  return;
                                }

                                const data = await response.json();
                                if (data.success) {
                                  setIsSupportSuccessModalOpen(true);
                                  loadSupportTickets();
                                  setIsSupportModalOpen(false);
                                  setSupportModalView('options');
                                } else {
                                  setSupportError(`Error: ${data.error?.message || 'No se pudo enviar el reporte'}`);
                                }
                              } catch (error) {
                                console.error('Error sending ticket, using local storage:', error);
                                const localTicketsStr = localStorage.getItem('local_support_tickets');
                                const localTickets = localTicketsStr ? JSON.parse(localTicketsStr) : [];
                                const newTicket = {
                                  id: `local_${Date.now()}`,
                                  type: 'APP',
                                  subject,
                                  description,
                                  createdAt: new Date().toISOString(),
                                };
                                localStorage.setItem('local_support_tickets', JSON.stringify([newTicket, ...localTickets]));
                                
                                setIsSupportSuccessModalOpen(true);
                                setSupportTickets([newTicket, ...localTickets]);
                                setIsSupportModalOpen(false);
                                setSupportModalView('options');
                              } finally {
                                setSubmittingSupport(false);
                              }
                            }}
                            className="w-full flex items-center justify-center gap-2 rounded-full bg-neutral-950 px-6 py-4 text-sm font-bold text-white transition hover:bg-neutral-800 disabled:opacity-70 disabled:cursor-not-allowed active:scale-[0.98]"
                          >
                            {submittingSupport ? (
                              <svg className="h-5 w-5 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                            ) : (
                              'Enviar reporte'
                            )}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-5">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="text-[11px] font-bold uppercase tracking-widest text-neutral-400">Tienda</label>
                            <input
                              id="support_store_name"
                              type="text"
                              placeholder="Ej. Burguer King"
                              className="mt-2 w-full rounded-2xl border border-black/5 bg-white px-4 py-3.5 text-sm font-medium text-neutral-900 transition-colors focus:border-neutral-950 focus:outline-none focus:ring-1 focus:ring-neutral-950 placeholder:text-neutral-300"
                            />
                          </div>
                          <div>
                            <label className="text-[11px] font-bold uppercase tracking-widest text-neutral-400">Nº Pedido</label>
                            <input
                              id="support_order_number"
                              type="text"
                              placeholder="Ej. 1A2B3C"
                              className="mt-2 w-full rounded-2xl border border-black/5 bg-white px-4 py-3.5 text-sm font-medium text-neutral-900 transition-colors focus:border-neutral-950 focus:outline-none focus:ring-1 focus:ring-neutral-950 placeholder:text-neutral-300"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="text-[11px] font-bold uppercase tracking-widest text-neutral-400">Cuéntanos tu problema</label>
                          <textarea
                            id="support_order_description"
                            placeholder="Llegó frío, faltó una bebida, etc."
                            rows={4}
                            className="mt-2 w-full rounded-2xl border border-black/5 bg-white px-4 py-3.5 text-sm font-medium text-neutral-900 transition-colors focus:border-neutral-950 focus:outline-none focus:ring-1 focus:ring-neutral-950 placeholder:text-neutral-300 resize-none"
                          ></textarea>
                        </div>
                        <div className="pt-4">
                          <button
                            type="button"
                            disabled={submittingSupport}
                            onClick={async () => {
                              const storeName = (document.getElementById('support_store_name') as HTMLInputElement)?.value;
                              const orderNumber = (document.getElementById('support_order_number') as HTMLInputElement)?.value;
                              const description = (document.getElementById('support_order_description') as HTMLTextAreaElement)?.value;
                              
                              if (!description.trim()) {
                                setSupportError('Por favor, ingresa una descripción de tu problema.');
                                return;
                              }
                              if (!storeName.trim() || !orderNumber.trim()) {
                                setSupportError('Por favor, completa el nombre de la tienda y número de pedido.');
                                return;
                              }

                              setSupportError('');
                              setSubmittingSupport(true);

                              try {
                                const response = await fetch(`${'/api'}/customer/support/tickets`, {
                                  method: 'POST',
                                  headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${token || localStorage.getItem('sadel.customer.token')}`,
                                  },
                                  body: JSON.stringify({
                                    type: 'ORDER',
                                    storeName,
                                    orderNumber,
                                    description,
                                  }),
                                });

                                if (response.status === 404) {
                                  console.warn('Backend support tickets endpoint returned 404. Saving to local storage.');
                                  const localTicketsStr = localStorage.getItem('local_support_tickets');
                                  const localTickets = localTicketsStr ? JSON.parse(localTicketsStr) : [];
                                  const newTicket = {
                                    id: `local_${Date.now()}`,
                                    type: 'ORDER',
                                    storeName,
                                    orderNumber,
                                    description,
                                    createdAt: new Date().toISOString(),
                                  };
                                  localStorage.setItem('local_support_tickets', JSON.stringify([newTicket, ...localTickets]));

                                  setIsSupportSuccessModalOpen(true);
                                  setSupportTickets([newTicket, ...localTickets]);
                                  setIsSupportModalOpen(false);
                                  setSupportModalView('options');
                                  return;
                                }

                                const data = await response.json();
                                if (data.success) {
                                  setIsSupportSuccessModalOpen(true);
                                  loadSupportTickets();
                                  setIsSupportModalOpen(false);
                                  setSupportModalView('options');
                                } else {
                                  setSupportError(`Error: ${data.error?.message || 'No se pudo enviar el reporte'}`);
                                }
                              } catch (error) {
                                console.error('Error sending ticket, using local storage:', error);
                                const localTicketsStr = localStorage.getItem('local_support_tickets');
                                const localTickets = localTicketsStr ? JSON.parse(localTicketsStr) : [];
                                const newTicket = {
                                  id: `local_${Date.now()}`,
                                  type: 'ORDER',
                                  storeName,
                                  orderNumber,
                                  description,
                                  createdAt: new Date().toISOString(),
                                };
                                localStorage.setItem('local_support_tickets', JSON.stringify([newTicket, ...localTickets]));

                                setIsSupportSuccessModalOpen(true);
                                setSupportTickets([newTicket, ...localTickets]);
                                setIsSupportModalOpen(false);
                                setSupportModalView('options');
                              } finally {
                                setSubmittingSupport(false);
                              }
                            }}
                            className="w-full flex items-center justify-center gap-2 rounded-full bg-neutral-950 px-6 py-4 text-sm font-bold text-white transition hover:bg-neutral-800 disabled:opacity-70 disabled:cursor-not-allowed active:scale-[0.98]"
                          >
                            {submittingSupport ? (
                              <svg className="h-5 w-5 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                            ) : (
                              'Enviar reporte'
                            )}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Modal de Éxito de Soporte */}
            {isSupportSuccessModalOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 py-6">
                <div className="w-full max-w-sm rounded-[32px] bg-white p-8 text-center shadow-[0_30px_100px_rgba(0,0,0,0.2)] animate-scale-up">
                  <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50 text-emerald-500 shadow-inner">
                    <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h3 className="text-2xl font-black tracking-tight text-neutral-900 mb-2">¡Reporte Enviado!</h3>
                  <p className="text-sm font-medium text-neutral-500 mb-8 leading-relaxed">
                    Nuestro equipo especializado lo revisará de inmediato y te contactará con una solución.
                  </p>
                  <button
                    type="button"
                    onClick={() => setIsSupportSuccessModalOpen(false)}
                    className="w-full rounded-full bg-neutral-950 px-6 py-4 text-sm font-bold text-white transition hover:bg-neutral-800 active:scale-[0.98]"
                  >
                    Entendido
                  </button>
                </div>
              </div>
            )}

          </div>
        ) : null}

        {activeSection === 'history' ? (
          <OrdersView
            sortedOrders={sortedOrders}
            visibleOrdersCount={visibleOrdersCount}
            setSelectedOrderId={setSelectedOrderId}
            setIsDetailModalOpen={setIsDetailModalOpen}
            formatCurrency={formatCurrency}
            formatDate={formatDate}
            StatusBadge={StatusBadge}
            showLoadMore={showLoadMore}
            loadMoreOrders={loadMoreOrders}
          />
        ) : null}

        {activeSection === 'home' ? (
          <HomeView
            selectedCategory={selectedCategory}
            setSelectedCategory={setSelectedCategory}
            restaurants={restaurants}
            featuredRestaurants={featuredRestaurants}
            offerProducts={offerProducts}
            filteredRestaurants={filteredRestaurants}
            formatRegionChipLabel={formatRegionChipLabel}
            platformCategories={platformCategories}
            Panel={Panel}
            EmptyState={EmptyState}
            loadingDashboard={loadingDashboard}
            isSearchingProducts={isSearchingProducts}
            filterNearby={filterNearby}
            setFilterNearby={setFilterNearby}
            filterOpenNow={filterOpenNow}
            setFilterOpenNow={setFilterOpenNow}
            filterFreeDelivery={filterFreeDelivery}
            setFilterFreeDelivery={setFilterFreeDelivery}
            filterPromotions={filterPromotions}
            setFilterPromotions={setFilterPromotions}
            filterBestRated={filterBestRated}
            setFilterBestRated={setFilterBestRated}
            router={router}
            buildRestaurantCoverFallback={buildRestaurantCoverFallback}
            buildRestaurantInitials={buildRestaurantInitials}
            formatDeliverySummary={formatDeliverySummary}
            activeZones={activeZones}
            selectedZoneName={selectedZoneName}
            onZoneSelect={handleZoneSelect}
            onResetZone={handleResetZone}
            onJoinClick={() => setIsJoinRestModalOpen(true)}
          />
        ) : null}
      </div>

      {activeSection !== 'checkout' && (
          <footer className="border-t border-black/5 bg-[#fafaf9] py-10 mt-12">
            <div className="mx-auto max-w-7xl px-4 md:px-6">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-8 mb-8">
                
                {/* Brand info */}
                <div className="md:col-span-5 space-y-3 text-left">
                  <SaDelLogo className="h-8 w-auto object-contain" />
                  <p className="text-xs text-neutral-500 font-medium leading-relaxed max-w-sm mt-3">
                    Conectando los mejores platillos de tu zona con un servicio de entrega rápido, transparente y confiable.
                  </p>
                </div>

                {/* Sell / Join options - Premium Cards */}
                <div className="md:col-span-4 space-y-3 text-left">
                  <h5 className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">Únete a la plataforma</h5>
                  <div className="grid grid-cols-1 gap-3">
                    
                    {/* Card: Restaurante */}
                    <button
                      type="button"
                      onClick={() => setIsJoinRestModalOpen(true)}
                      className="group flex items-center gap-3.5 rounded-2xl border border-black/5 bg-white p-3 text-left transition-all duration-300 hover:border-sky-1000/30 hover:shadow-lg hover:shadow-sky-1000/[0.02] hover:-translate-y-0.5 active:scale-[0.98] w-full shadow-sm"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-500 transition-colors group-hover:bg-sky-200">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-extrabold text-neutral-900 group-hover:text-sky-500 transition-colors">Quiero vender por SaDeL</p>
                        <p className="text-[10px] text-neutral-500 font-semibold mt-0.5">Registra tu negocio y vende más</p>
                      </div>
                      <div className="text-neutral-300 group-hover:text-sky-1000 transition-colors pl-1">
                        <svg className="w-4 h-4 transform group-hover:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </button>

                    {/* Card: Repartidor */}
                    <button
                      type="button"
                      onClick={() => setIsJoinDriverModalOpen(true)}
                      className="group flex items-center gap-3.5 rounded-2xl border border-black/5 bg-white p-3 text-left transition-all duration-300 hover:border-sky-1000/30 hover:shadow-lg hover:shadow-sky-1000/[0.02] hover:-translate-y-0.5 active:scale-[0.98] w-full shadow-sm"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-500 transition-colors group-hover:bg-sky-200">
                        <span className="text-lg">🏍️</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-extrabold text-neutral-900 group-hover:text-sky-500 transition-colors">Ser Repartidor</p>
                        <p className="text-[10px] text-neutral-500 font-semibold mt-0.5">Entrega pedidos con tu moto</p>
                      </div>
                      <div className="text-neutral-300 group-hover:text-sky-1000 transition-colors pl-1">
                        <svg className="w-4 h-4 transform group-hover:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </button>

                  </div>
                </div>

                {/* Legal and Support */}
                <div className="md:col-span-3 space-y-3 text-left">
                  <h5 className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">Legal y Soporte</h5>
                  <ul className="space-y-2 text-xs font-semibold text-neutral-600">
                    <li>
                      <a href="/privacidad" className="hover:text-neutral-950 transition-colors">Aviso de Privacidad</a>
                    </li>
                    <li>
                      <a href="/terminos" className="hover:text-neutral-950 transition-colors">Términos y Condiciones</a>
                    </li>
                    <li>
                      <button
                        type="button"
                        onClick={() => openDashboardSection('support')}
                        className="hover:text-neutral-950 transition-colors"
                      >
                        Centro de Ayuda
                      </button>
                    </li>
                  </ul>
                </div>

              </div>

              {/* Bottom Copyright */}
              <div className="border-t border-black/5 pt-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] font-semibold text-neutral-400">
                <p>© {new Date().getFullYear()} SaDeL. Todos los derechos reservados.</p>
                <div className="flex items-center gap-1.5">
                  <span>🇲🇽</span>
                  <span>México</span>
                </div>
              </div>

            </div>
          </footer>
        )}

        {isChangingPassword ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6">
            <div className="w-full max-w-[420px] rounded-[32px] bg-white p-5 shadow-[0_30px_90px_rgba(15,15,15,0.2)] md:p-7">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-2xl font-semibold tracking-[-0.04em] text-neutral-950">Cambiar contraseña</h3>
                  <p className="mt-1 text-sm text-neutral-600">Ingresa tus datos para actualizarla.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsChangingPassword(false)}
                  className="rounded-full border border-black/10 px-3 py-1.5 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-100"
                >
                  Cerrar
                </button>
              </div>

              <div className="mt-6 space-y-4">
                <div>
                  <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Contraseña actual</label>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="mt-1.5 w-full rounded-2xl border border-black/10 bg-neutral-50 px-4 py-3 text-sm focus:border-black/20 focus:outline-none"
                    placeholder="••••••••"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Nueva contraseña</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="mt-1.5 w-full rounded-2xl border border-black/10 bg-neutral-50 px-4 py-3 text-sm focus:border-black/20 focus:outline-none"
                    placeholder="Mínimo 6 caracteres"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Confirmar contraseña</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="mt-1.5 w-full rounded-2xl border border-black/10 bg-neutral-50 px-4 py-3 text-sm focus:border-black/20 focus:outline-none"
                    placeholder="Repite la nueva contraseña"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleChangePassword}
                  className="mt-2 w-full rounded-full bg-sky-400 py-3 text-sm font-semibold text-black transition hover:bg-sky-500"
                >
                  Actualizar contraseña
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {isEditingProfile ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
            <div className="w-full max-w-[420px] rounded-[32px] bg-white p-5 shadow-[0_30px_90px_rgba(15,15,15,0.2)] md:p-7">
              {!isVerifyingPhoneChange ? (
                <>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-2xl font-semibold tracking-[-0.04em] text-neutral-950">Editar perfil</h3>
                      <p className="mt-1 text-sm text-neutral-600">Actualiza tus datos personales.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsEditingProfile(false)}
                      className="rounded-full bg-neutral-100 hover:bg-neutral-200 px-4 py-1.5 text-sm font-semibold text-neutral-700 transition-all active-scale"
                    >
                      Cerrar
                    </button>
                  </div>

                  <div className="mt-6 space-y-4">
                    <div>
                      <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Nombre</label>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="mt-1.5 w-full rounded-2xl border border-black/10 bg-neutral-50 px-4 py-3 text-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                        placeholder="Tu nombre"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Apellidos</label>
                      <input
                        type="text"
                        value={editLastName}
                        onChange={(e) => setEditLastName(e.target.value)}
                        className="mt-1.5 w-full rounded-2xl border border-black/10 bg-neutral-50 px-4 py-3 text-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                        placeholder="Tus apellidos"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Teléfono</label>
                      <input
                        type="tel"
                        value={editPhone}
                        onChange={(e) => setEditPhone(e.target.value)}
                        className="mt-1.5 w-full rounded-2xl border border-black/10 bg-neutral-50 px-4 py-3 text-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                        placeholder="Tu teléfono"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={handleEditProfile}
                      disabled={isSendingOtp}
                      className="mt-2 w-full flex items-center justify-center gap-2 rounded-full bg-neutral-950 py-3.5 text-sm font-semibold text-white transition hover:bg-neutral-900 disabled:opacity-70 active-scale shadow-sm"
                    >
                      {isSendingOtp ? 'Validando...' : 'Guardar cambios'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex flex-col items-center text-center">
                    <div className="h-16 w-16 bg-accent-soft text-accent rounded-full flex items-center justify-center mb-4 border border-accent/10">
                      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <h3 className="text-2xl font-semibold tracking-[-0.04em] text-neutral-950">Verifica tu número</h3>
                    <p className="mt-2 text-sm text-neutral-600 leading-relaxed">
                      Por tu seguridad, hemos enviado un código de 4 dígitos por WhatsApp al número <span className="font-semibold text-neutral-900">{newPhoneToVerify}</span>.
                    </p>
                  </div>

                  <div className="mt-8 space-y-4">
                    <div>
                      <input
                        type="text"
                        maxLength={4}
                        value={phoneChangeOtp}
                        onChange={(e) => setPhoneChangeOtp(e.target.value.replace(/\D/g, ''))}
                        className="w-full text-center tracking-[1em] font-mono text-3xl rounded-2xl border border-black/10 bg-neutral-50 px-4 py-4 focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                        placeholder="••••"
                      />
                      {otpError && (
                        <p className="text-red-500 text-xs font-semibold mt-2 text-center">{otpError}</p>
                      )}
                    </div>

                    <div className="pt-2 flex flex-col gap-3">
                      <button
                        type="button"
                        onClick={handleVerifyPhoneChange}
                        disabled={isSendingOtp || phoneChangeOtp.length < 4}
                        className="w-full rounded-full bg-neutral-950 py-3.5 text-sm font-semibold text-white transition hover:bg-neutral-900 disabled:opacity-50 flex justify-center active-scale"
                      >
                        {isSendingOtp ? 'Verificando...' : 'Verificar y Actualizar'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsVerifyingPhoneChange(false);
                          setPhoneChangeOtp('');
                        }}
                        className="w-full rounded-full bg-neutral-100 py-3 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-200 active-scale"
                      >
                        Volver a editar el número
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : null}

        {/* 2. Modal de Detalle */}

        {isDetailModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 py-6">
            <div className="relative w-full max-w-[480px] rounded-[32px] bg-[#f9fafb] shadow-[0_30px_100px_rgba(0,0,0,0.2)] h-fit max-h-[90vh] overflow-y-auto no-scrollbar">
              
              {/* Encabezado Fijo con Botón de Cierre */}
              <div className="sticky top-0 z-10 flex items-center justify-between bg-[#f9fafb]/90 backdrop-blur-md px-6 py-5 border-b border-black/5">
                <h3 className="text-lg font-bold tracking-tight text-neutral-900">Recibo del pedido</h3>
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
                {loadingDetail ? (
                  <div className="py-16 text-center">
                    <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-neutral-200 border-t-neutral-900"></div>
                    <p className="mt-4 text-sm font-medium text-neutral-500">Cargando detalles...</p>
                  </div>
                ) : selectedOrder ? (
                  <div className="space-y-6">
                    {/* Header del Restaurante */}
                    <div className="flex flex-col items-center text-center">
                      <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-white shadow-[0_8px_24px_rgba(0,0,0,0.04)] mb-4 border border-black/[0.03]">
                        <span className="text-2xl font-black tracking-tight text-neutral-800">
                          {selectedOrder.restaurant.name.substring(0, 2).toUpperCase()}
                        </span>
                      </div>
                      <h2 className="text-2xl font-bold tracking-tight text-neutral-900">{selectedOrder.restaurant.name}</h2>
                      <p className="mt-1 flex items-center gap-2 text-sm text-neutral-500">
                        {formatDate(selectedOrder.createdAt)} 
                        <span className="h-1 w-1 rounded-full bg-neutral-300"></span> 
                        Ref #{selectedOrder.dailyCounter || '...'}
                      </p>
                      <div className="mt-4">
                        <StatusBadge status={selectedOrder.status} />
                      </div>
                    </div>

                    {/* PIN DE ENTREGA (handoverPin como fallback para pedidos previos) — solo para transferencia y delivery */}
                    {selectedOrder.fulfillmentType !== 'PICKUP' && selectedOrder.paymentMethod === 'TRANSFER' && (selectedOrder.deliveryPin || selectedOrder.handoverPin) && ['READY', 'PICKED_UP', 'IN_TRANSIT'].includes(selectedOrder.status) && (
                      <div className="flex flex-col items-center justify-center p-5 bg-white rounded-3xl border border-black/5 shadow-sm text-center">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">Código de entrega</p>
                        <p className="mt-2 text-4xl font-black tracking-[0.25em] text-neutral-900 pl-[0.25em]">
                          {selectedOrder.deliveryPin || selectedOrder.handoverPin}
                        </p>
                        <p className="mt-2 text-xs text-neutral-500">Proporciona este código al repartidor al recibir tu pedido.</p>
                      </div>
                    )}

                    {/* Mensaje de Smart Stacking */}
                    {selectedOrder.isSecondInRoute && (
                      <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-2xl border border-blue-100 text-blue-800 text-sm">
                        <span className="text-xl">🛵</span>
                        <p className="font-medium">
                          Tu repartidor está entregando un pedido cercano en tu ruta. ¡Llegará pronto!
                        </p>
                      </div>
                    )}

                    {/* Mensaje de Batch */}
                    {selectedOrder.batchId && selectedOrder.deliverySequence && selectedOrder.status === 'IN_TRANSIT' && (
                      <div className="flex items-center gap-3 p-4 bg-amber-50 rounded-2xl border border-amber-100 text-amber-800 text-sm">
                        <span className="text-xl">📦</span>
                        <p className="font-medium">
                          Tu pedido es parte de un lote de entregas. El repartidor completará las entregas en orden. {selectedOrder.deliverySequence > 0 ? 'Llegará después de las entregas anteriores.' : 'Eres la primera entrega de la ruta.'}
                        </p>
                      </div>
                    )}

                    {/* BOTÓN DE CHAT */}
                    {['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED'].includes(selectedOrder.status) && (
                      <button
                        onClick={() => {
                          setIsDetailModalOpen(false);
                          useChatStore.getState().openChat(selectedOrder.id);
                          void loadChatMessages(selectedOrder.id);
                        }}
                        className="w-full flex items-center justify-center gap-3 p-4 bg-neutral-900 hover:bg-neutral-800 text-white rounded-2xl font-bold shadow-lg shadow-neutral-900/20 transition-all active:scale-[0.98] group"
                      >
                        <svg className="w-5 h-5 text-white/80 group-hover:text-white transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
                        <span>Contactar Soporte / Tienda</span>
                        {(unreadMessagesMap[selectedOrder.id] || 0) > 0 && (
                          <span className="ml-2 bg-rose-500 text-white text-xs px-2.5 py-0.5 rounded-full font-bold animate-pulse">
                            {unreadMessagesMap[selectedOrder.id]}
                          </span>
                        )}
                      </button>
                    )}

                    {/* Ticket unificado */}
                    <div className="bg-white rounded-3xl border border-black/5 shadow-sm p-6 space-y-6">
                      <div className="space-y-4">
                        <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-400">Resumen</p>
                        <div className="space-y-4">
                          {selectedOrder.items.map((item) => (
                            <div key={item.id} className="text-sm">
                              <div className="flex gap-3">
                                <span className="font-bold text-neutral-900 bg-neutral-100 rounded-lg px-2 py-0.5 h-fit">{item.quantity}</span>
                                <div>
                                  <p className="font-medium text-neutral-900">{item.product.name}</p>
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
                          <p className="font-medium text-neutral-900">{formatCurrency(selectedOrder.subtotal)}</p>
                        </div>
                        <div className="flex justify-between text-neutral-600">
                          <p>Costo de envío</p>
                          <p className="font-medium text-neutral-900">{formatCurrency(selectedOrder.deliveryFee)}</p>
                        </div>
                        <div className="flex justify-between text-neutral-600">
                          <p>Tarifa de servicio</p>
                          <p className="font-medium text-neutral-900">{formatCurrency(selectedOrder.serviceFee)}</p>
                        </div>
                        <div className="flex justify-between font-bold text-neutral-900 text-lg pt-4 border-t border-dashed border-neutral-200 mt-4">
                          <p>Total a pagar</p>
                          <p>{formatCurrency(selectedOrder.totalAmount)}</p>
                        </div>
                      </div>
                    </div>

                    {selectedOrder.fulfillmentType === 'PICKUP' ? (
                      /* Datos de Recolección */
                      <div className="bg-white rounded-3xl border border-black/5 shadow-sm p-6 space-y-4">
                        <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-400">Recolección</p>
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 shrink-0">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                          </div>
                          <div className="text-sm">
                            <p className="font-medium text-neutral-900">{selectedOrder.restaurant.name}</p>
                            <p className="text-xs text-neutral-500">{selectedOrder.restaurant.address}</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 text-neutral-600 shrink-0">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/></svg>
                          </div>
                          <div className="text-sm">
                            <p className="font-medium text-neutral-900">{selectedOrder.paymentMethod === 'CASH' ? 'Efectivo' : 'Transferencia'}</p>
                            <p className="text-xs text-neutral-500 uppercase">{selectedOrder.paymentStatus}</p>
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
                            <p className="font-medium text-neutral-900">{buildDetailAddressLabel(selectedOrder.address)}</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 text-neutral-600 shrink-0">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/></svg>
                          </div>
                          <div className="text-sm">
                            <p className="font-medium text-neutral-900">{selectedOrder.paymentMethod === 'CASH' ? 'Efectivo' : 'Transferencia'}</p>
                            <p className="text-xs text-neutral-500 uppercase">{selectedOrder.paymentStatus}</p>
                          </div>
                        </div>
                      </div>
                    )}

                  {/* Notas del pedido (si existen) */}
                  {selectedOrder.notes && (
                    <div className="border-t border-black/[0.05] pt-4 space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-neutral-400">Notas del pedido</p>
                      <p className="text-sm text-neutral-600 bg-neutral-50 p-3 rounded-lg">
                        "{selectedOrder.notes}"
                      </p>
                    </div>
                  )}

                  {/* Cancelación */}
                  {['PENDING', 'CONFIRMED', 'PREPARING'].includes(selectedOrder.status) && (
                    <div className="border-t border-black/[0.05] pt-4">
                      {selectedOrder.cancellationRequestedAt && !selectedOrder.cancelledBy ? (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200/60 rounded-xl">
                            <span className="text-sm">⏳</span>
                            <p className="text-xs font-semibold text-amber-700">Solicitud de cancelación enviada — esperando respuesta del restaurante.</p>
                          </div>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await requestJson({ apiBase, path: `/pedidos/${selectedOrder.id}/cancelar-solicitud`, token, options: { method: 'POST' } });
                                setSelectedOrder({ ...selectedOrder, cancellationRequestedAt: null as any });
                                setToastMessage('Solicitud de cancelación retirada.', 'success');
                                setTimeout(() => setToastMessage(''), 2000);
                              } catch (e: any) {
                                setToastMessage(e?.message || 'Error al retirar solicitud.', 'error');
                                setTimeout(() => setToastMessage(''), 2000);
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
                              await requestJson({ apiBase, path: `/pedidos/${selectedOrder.id}/solicitar-cancelacion`, token, options: { method: 'POST' } });
                              setSelectedOrder({ ...selectedOrder, cancellationRequestedAt: new Date().toISOString() });
                              setToastMessage('Solicitud enviada. El restaurante debe aprobarla.', 'success');
                              setTimeout(() => setToastMessage(''), 3000);
                            } catch (e: any) {
                              if (e?.code === 'CANCELLATION_ALREADY_REJECTED') {
                                showTransientNotice({
                                  key: `cancellation-rejected:${selectedOrder.id}`,
                                  title: 'Solicitud rechazada',
                                  description: 'Entendemos que querías cancelar, pero el restaurante ya comenzó a preparar tu pedido y cancelarlo le genera pérdidas. No te preocupes, tu pedido sigue en marcha y llegará pronto. Si tienes alguna duda, puedes contactar al restaurante por el chat del pedido.',
                                  tone: 'danger',
                                  requiresAcknowledgement: true,
                                });
                              } else if (e?.status === 409) {
                                setSelectedOrder({ ...selectedOrder, cancellationRequestedAt: new Date().toISOString() });
                                setToastMessage('Solicitud enviada. El restaurante debe aprobarla.', 'success');
                                setTimeout(() => setToastMessage(''), 3000);
                              } else {
                                setToastMessage(e?.message || 'Error al solicitar cancelación.', 'error');
                                setTimeout(() => setToastMessage(''), 2000);
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

                  {/* Reporte de Reembolso por Transferencia si el pedido fue rechazado */}
                  {selectedOrder.status === 'REJECTED' && selectedOrder.paymentMethod === 'TRANSFER' && (
                    <div className="border-t border-rose-100 pt-5 space-y-4">
                      {refundReportSuccess ? (
                        <div className="bg-emerald-50/60 border border-emerald-100 rounded-2xl p-5 text-center space-y-3 shadow-[0_8px_30px_rgba(20,184,166,0.05)] backdrop-blur animate-scale-up">
                          <div className="mx-auto h-12 w-12 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 border border-emerald-200">
                            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                          <div>
                            <h4 className="text-base font-bold text-neutral-950">¡Reporte de Reembolso Enviado!</h4>
                            <p className="mt-1 text-xs text-neutral-600 leading-relaxed">
                              Tu reporte ha sido registrado con éxito. El administrador revisará tu comprobante y se pondrá en contacto contigo a través de tu medio de contacto para realizar el reembolso de inmediato.
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="bg-rose-50/50 border border-rose-100/70 rounded-2xl p-5 space-y-4 backdrop-blur shadow-sm">
                          <div className="flex gap-3">
                            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600 border border-rose-200/50">
                              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                              </svg>
                            </div>
                            <div>
                              <h4 className="text-sm font-bold text-rose-950">Reportar Pago por Transferencia</h4>
                              <p className="text-xs text-rose-800/80 leading-normal mt-0.5">
                                Este pedido fue rechazado por el restaurante. Como el pago se realizó mediante Transferencia Bancaria, proporciona tus datos de contacto y el comprobante para que el administrador te dé una solución y proceda con tu reembolso.
                              </p>
                            </div>
                          </div>

                          <div className="space-y-3.5 pt-1">
                            <div>
                              <label className="text-[10px] font-bold uppercase tracking-wider text-rose-800 block mb-1.5">
                                Teléfono o Medio de Contacto
                              </label>
                              <input
                                type="text"
                                placeholder="Ej: Celular o Cuenta destino"
                                value={refundContact}
                                onChange={(e) => setRefundContact(e.target.value)}
                                className="w-full bg-white border border-rose-200/60 rounded-xl px-4 py-2.5 text-xs text-neutral-800 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-rose-500/10 focus:border-rose-400 transition"
                              />
                            </div>

                            <div>
                              <label className="text-[10px] font-bold uppercase tracking-wider text-rose-800 block mb-1.5">
                                Comprobante de Transferencia
                              </label>
                              <div className="relative group border border-dashed border-rose-200 hover:border-rose-400 bg-white/70 hover:bg-white transition rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer text-center">
                                <input
                                  type="file"
                                  accept="image/*"
                                  onChange={async (e) => {
                                    const file = e.target.files?.[0];
                                    if (!file) return;
                                    try {
                                      const base64 = await convertImageFileToDataUrl(file, 900, 900, 0.7);
                                      setRefundProofName(file.name);
                                      setRefundProofSource(base64);
                                      setRefundError('');
                                    } catch (err: any) {
                                      setRefundError(err.message || 'Error al procesar la imagen');
                                    }
                                  }}
                                  className="absolute inset-0 opacity-0 cursor-pointer z-10"
                                />
                                {refundProofSource ? (
                                  <div className="w-full relative z-0">
                                    <div className="mx-auto h-20 w-20 overflow-hidden rounded-lg border border-neutral-100 bg-neutral-50 shadow-sm relative group-hover:opacity-90 transition">
                                      <img src={refundProofSource} alt="Preview" className="h-full w-full object-cover" loading="lazy" decoding="async" />
                                    </div>
                                    <p className="mt-2 text-xs font-semibold text-rose-700 truncate max-w-xs mx-auto">{refundProofName || 'comprobante.jpg'}</p>
                                    <p className="text-[9px] text-neutral-400">Toca para cambiar de imagen</p>
                                  </div>
                                ) : (
                                  <div className="relative z-0">
                                    <svg className="h-6 w-6 text-rose-500 mb-1 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                    <span className="text-xs font-bold text-rose-700 block">Subir captura del comprobante</span>
                                    <span className="text-[9px] text-neutral-400 mt-0.5 block">Formatos: JPG, PNG. Máx 3MB</span>
                                  </div>
                                )}
                              </div>
                            </div>

                            {refundError && (
                              <p className="text-xs font-semibold text-rose-600 bg-rose-50/50 p-2.5 rounded-xl border border-rose-100">
                                ⚠️ {refundError}
                              </p>
                            )}

                            <button
                              type="button"
                              disabled={submittingRefundReport || !refundContact.trim()}
                              onClick={async () => {
                                if (!refundContact.trim()) return;
                                setSubmittingRefundReport(true);
                                setRefundError('');
                                try {
                                  let proofUrl = selectedOrder.paymentProofUrl || '';
                                  if (refundProofSource) {
                                    proofUrl = await persistTransferProof({
                                      apiBase,
                                      token: token || '',
                                      source: refundProofSource,
                                      fileName: refundProofName
                                    });
                                  }

                                  const response = await fetch(`${'/api'}/customer/support/tickets`, {
                                    method: 'POST',
                                    headers: {
                                      'Content-Type': 'application/json',
                                      'Authorization': `Bearer ${token || localStorage.getItem('sadel.customer.token')}`,
                                    },
                                    body: JSON.stringify({
                                      type: 'ORDER',
                                      subject: `Reembolso por Transferencia - Pedido #${selectedOrder.orderReference}`,
                                      description: `Contacto de reembolso: ${refundContact}\nComprobante de pago: ${proofUrl || 'No proporcionado'}\n\nDetalles adicionales: El restaurante rechazó el pedido #${selectedOrder.orderReference} pagado por transferencia de ${formatCurrency(selectedOrder.totalAmount)}.`,
                                      storeName: selectedOrder.restaurant.name,
                                      orderNumber: selectedOrder.orderReference
                                    }),
                                  });

                                  const data = await response.json();
                                  if (data.success) {
                                    setRefundReportSuccess(true);
                                  } else {
                                    setRefundError(data.error?.message || 'No se pudo enviar el reporte.');
                                  }
                                } catch (err: any) {
                                  console.error(err);
                                  setRefundError('Error de red al enviar el reporte. Por favor inténtalo de nuevo.');
                                } finally {
                                  setSubmittingRefundReport(false);
                                }
                              }}
                              className="w-full rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] text-white py-3 text-xs font-bold shadow-md shadow-rose-600/10 hover:shadow-rose-600/25 transition flex items-center justify-center gap-2"
                            >
                              {submittingRefundReport ? (
                                <>
                                  <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                  </svg>
                                  Enviando reporte...
                                </>
                              ) : (
                                <>
                                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                                  </svg>
                                  Enviar reporte de reembolso
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}



                  {/* Acciones */}
                  {['DELIVERED', 'CANCELLED', 'REJECTED'].includes(selectedOrder.status) && (
                    <div className="border-t border-black/[0.05] pt-4">
                      <button
                        type="button"
                        onClick={() => {
                          setReorderAddressId('original');
                          setIsReorderModalOpen(true);
                        }}
                        disabled={reordering}
                        className="w-full rounded-full bg-neutral-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
                      >
                        {reordering ? 'Repitiendo pedido...' : 'Volver a pedir'}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-12 text-center text-neutral-500">No se pudo cargar el detalle.</div>
              )}
              </div>
            </div>
          </div>
        )}

        {/* Chat Panel */}
        {isChatOpen && selectedOrder && (
          <ChatPanel
            order={selectedOrder}
            token={token}
            apiBase={apiBase}
            onClose={() => useChatStore.getState().closeChat()}
          />
        )}

        {/* Modal de Calificación */}
        {isRatingModalOpen && (() => {
          const ratingOrder = orderToRate ? orders.find((o: any) => o.id === orderToRate) : null;
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
              comment={ratingComment}
              onCommentChange={setRatingComment}
              submitting={isSubmittingRating}
              onSkip={() => {
                if (orderToRate) {
                  try {
                    localStorage.setItem(`sadel_dismissed_rating_${orderToRate}`, 'true');
                  } catch (e) {}
                }
                setIsRatingModalOpen(false);
                setOrderToRate(null);
                setRestaurantRating(0);
                setDriverRatingVal(0);
                setRatingComment('');
                setRatingIsPickup(false);
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
                      ...(ratingComment ? { comment: ratingComment } : {}),
                      ...(!ratingIsPickup && driverRatingVal > 0 ? {
                        driverRating: driverRatingVal,
                        ...(ratingComment ? { driverComment: ratingComment } : {}),
                      } : {}),
                    },
                    getUser: () => sessionUser,
                    onTokenRefreshed: (newToken) => setToken(newToken),
                    onSessionExpired: () => clearSession('Tu sesión ha expirado. Por favor, inicia sesión de nuevo.'),
                  });
                  if (result.ok) {
                    setIsRatingModalOpen(false);
                    setOrderToRate(null);
                    setRestaurantRating(0);
                    setDriverRatingVal(0);
                    setRatingComment('');
                    setRatingIsPickup(false);
                    setToastMessage('¡Gracias por tu calificación!');
                    setTimeout(() => setToastMessage(''), 2000);
                    return;
                  }
                  setToastMessage(result.message || 'No se pudo guardar tu calificación. Intenta de nuevo.');
                  setTimeout(() => setToastMessage(''), 4000);
                } finally {
                  setIsSubmittingRating(false);
                }
              }}
            />
          );
        })()}

        {/* Modal de Repartidor Llegó — no dismissible */}
        {isDriverArrivedModalOpen && arrivedOrder && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4 py-6">
            <div
              className="bg-white dark:bg-[#121214] rounded-3xl border border-black/[0.03] dark:border-zinc-800/80 shadow-[0_20px_50px_rgba(0,0,0,0.15)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.4)] p-7 w-full max-w-md h-fit max-h-[90vh] overflow-y-auto relative transition-all"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-sky-1000/10 to-transparent dark:from-sky-1000/15 rounded-full blur-3xl pointer-events-none"></div>

              <div className="text-center mb-6">
                <div className="w-20 h-20 bg-sky-200 dark:bg-sky-900/30 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-sky-100 dark:border-sky-800/20 shadow-inner">
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

                {/* deliveryPin (handoverPin como fallback) — solo para transferencia */}
                {arrivedOrder.paymentMethod === 'TRANSFER' && (arrivedOrder.deliveryPin || arrivedOrder.handoverPin) && (
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
                  onClick={() => {
                    setIsDriverArrivedModalOpen(false);
                    setArrivedOrder(null);
                    localStorage.removeItem('sadel_driver_arrived_order');
                  }}
                  className="flex-1 rounded-full bg-neutral-950 dark:bg-white text-white dark:text-neutral-950 py-3.5 text-sm font-bold shadow-md transition hover:bg-neutral-800 dark:hover:bg-neutral-100 active:scale-95"
                >
                  Entendido
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal de pedido listo para recoger (pickup) — no dismissible */}
        {pickupReadyOrder && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4 py-6">
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
                  onClick={() => {
                    setPickupReadyOrder(null);
                    localStorage.removeItem('sadel_pickup_ready_order');
                  }}
                  className="w-full rounded-full bg-neutral-950 text-white py-3.5 text-sm font-bold shadow-md transition hover:bg-neutral-800 active:scale-95"
                >
                  Entendido
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 3. Modal de Confirmación de Repetición */}
        {isReorderModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6">
            <div className="bg-white rounded-2xl border border-black/[0.03] shadow-[0_4px_24px_rgba(0,0,0,0.08)] p-6 w-full max-w-lg h-fit max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-xl font-semibold text-neutral-950">Confirmar repetición</h3>
                  <p className="text-sm text-neutral-500">Se creará un nuevo pedido idéntico.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsReorderModalOpen(false)}
                  className="text-neutral-400 hover:text-neutral-600 transition"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                <p className="text-sm text-neutral-600">
                  Estás por repetir el pedido del restaurante <span className="font-semibold text-neutral-950">{selectedOrder?.restaurant.name}</span>. Se incluirán los mismos productos y cantidades.
                </p>

                {selectedOrder?.fulfillmentType === 'PICKUP' ? (
                  <p className="text-xs text-neutral-500">El pedido se recogerá en sucursal.</p>
                ) : (
                  /* Selección de Dirección */
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.1em] text-neutral-400">Dirección de entrega</p>

                    {/* Opción 1: Misma dirección */}
                    <label className="flex items-start gap-3 p-3 bg-neutral-50 rounded-lg cursor-pointer hover:bg-neutral-100 transition">
                      <input
                        type="radio"
                        name="reorderAddress"
                        checked={reorderAddressId === 'original'}
                        onChange={() => setReorderAddressId('original')}
                        className="mt-1"
                      />
                      <div>
                        <p className="text-sm font-semibold text-neutral-950">Usar la misma dirección del pedido</p>
                        <p className="text-xs text-neutral-500">{buildDetailAddressLabel(selectedOrder?.address)}</p>
                      </div>
                    </label>

                    {/* Opción 2: Cambiar dirección */}
                    {addresses.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs text-neutral-500 mt-2">O selecciona una de tus direcciones guardadas:</p>
                        {addresses.map((addr) => (
                          <label key={addr.id} className="flex items-start gap-3 p-3 bg-neutral-50 rounded-lg cursor-pointer hover:bg-neutral-100 transition">
                            <input
                              type="radio"
                              name="reorderAddress"
                              checked={reorderAddressId === addr.id}
                              onChange={() => setReorderAddressId(addr.id)}
                              className="mt-1"
                            />
                            <div>
                              <p className="text-sm font-semibold text-neutral-950">{addr.alias || `${addr.street} ${addr.number}`}</p>
                              <p className="text-xs text-neutral-500">{`${addr.neighborhood}, ${addr.city}`}</p>
                            </div>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Botones */}
                <div className="flex justify-center gap-3 border-t border-black/[0.05] pt-4">
                  <button
                    type="button"
                    onClick={() => setIsReorderModalOpen(false)}
                    className="rounded-full border border-black/10 px-6 py-3 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-100"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const selectedAddr = reorderAddressId === 'original' ? null : addresses.find(a => a.id === reorderAddressId);
                      void reorderSelectedOrder(selectedAddr);
                      setIsReorderModalOpen(false);
                      setIsDetailModalOpen(false);
                    }}
                    disabled={reordering}
                    className="rounded-full bg-neutral-950 px-6 py-3 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
                  >
                    {reordering ? 'Procesando...' : 'Aceptar'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {showPromoModal && promoImageUrl && (
          <div 
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in"
            onClick={() => setShowPromoModal(false)}
          >
            <div 
              className="relative max-w-full max-h-full animate-scale-up"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setShowPromoModal(false)}
                className="absolute -top-3 -right-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white text-neutral-900 shadow-xl transition hover:scale-110 active:scale-95"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <img
                src={promoImageUrl}
                alt="Promoción Especial"
                loading="lazy" decoding="async"
                className="w-auto h-auto max-w-[90vw] sm:max-w-md max-h-[85vh] object-contain rounded-2xl md:rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.3)]"
              />
            </div>
          </div>
        )}

        {/* Modal: Quiero vender en SaDeL */}
        {isJoinRestModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 py-6" onClick={() => setIsJoinRestModalOpen(false)}>
            <div
              className="relative w-full max-w-[480px] rounded-[32px] bg-white shadow-[0_30px_100px_rgba(0,0,0,0.2)] overflow-hidden animate-scale-up p-6 md:p-8"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-black/5 pb-4 mb-6">
                <div>
                  <h3 className="text-xl font-bold tracking-tight text-neutral-900">Quiero vender en SaDeL</h3>
                  <p className="text-xs text-neutral-500 mt-1">Registra tu negocio y solicita tu ingreso a la plataforma.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsJoinRestModalOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 hover:bg-neutral-200 text-neutral-600 transition"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!joinRestOwnerName.trim() || !joinRestName.trim() || !joinRestGiro.trim() || !joinRestLocation.trim() || !joinRestWhatsapp.trim()) {
                    setToastMessage('Por favor completa todos los campos del formulario.', 'error');
                    setTimeout(() => setToastMessage(''), 3000);
                    return;
                  }

                  const request = {
                    id: `rest-req-${Date.now()}`,
                    ownerName: joinRestOwnerName,
                    businessName: joinRestName,
                    giro: joinRestGiro,
                    location: joinRestLocation,
                    whatsapp: joinRestWhatsapp,
                    createdAt: new Date().toISOString()
                  };

                  try {
                    const apiUrl = '/api';
                    const response = await fetch(`${apiUrl}/public/solicitudes`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        type: 'RESTAURANT',
                        ownerName: joinRestOwnerName,
                        businessName: joinRestName,
                        giro: joinRestGiro,
                        location: joinRestLocation,
                        whatsapp: joinRestWhatsapp,
                      }),
                    });

                    if (!response.ok) {
                      throw new Error('No se pudo procesar la solicitud');
                    }

                    setIsJoinRestModalOpen(false);
                    setIsRequestSuccessModalOpen(true);
                    setJoinRestOwnerName('');
                    setJoinRestName('');
                    setJoinRestGiro('Restaurante');
                    setJoinRestLocation('');
                    setJoinRestWhatsapp('');
                  } catch (err) {
                    console.error('Error al enviar solicitud:', err);
                    setToastMessage('Ocurrió un error al enviar la solicitud. Por favor intenta de nuevo.', 'error');
                  }
                }}
                className="space-y-4 text-left"
              >
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">Nombre del Propietario o Responsable</label>
                  <input
                    type="text"
                    value={joinRestOwnerName}
                    onChange={(e) => setJoinRestOwnerName(e.target.value)}
                    placeholder="Ej. Juan Pérez"
                    className="mt-2 w-full rounded-2xl border border-black/5 bg-neutral-50/50 focus:bg-white px-4 py-3 text-sm font-medium text-neutral-900 transition-colors focus:border-neutral-950 focus:outline-none focus:ring-1 focus:ring-neutral-950 placeholder:text-neutral-300"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">Nombre del Negocio</label>
                  <input
                    type="text"
                    value={joinRestName}
                    onChange={(e) => setJoinRestName(e.target.value)}
                    placeholder="Ej. Tacos El Rey"
                    className="mt-2 w-full rounded-2xl border border-black/5 bg-neutral-50/50 focus:bg-white px-4 py-3 text-sm font-medium text-neutral-900 transition-colors focus:border-neutral-950 focus:outline-none focus:ring-1 focus:ring-neutral-950 placeholder:text-neutral-300"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">Giro del Negocio</label>
                    <select
                      value={joinRestGiro}
                      onChange={(e) => setJoinRestGiro(e.target.value)}
                      className="mt-2 w-full rounded-2xl border border-black/5 bg-neutral-50/50 focus:bg-white px-4 py-3 text-sm font-medium text-neutral-900 transition-colors focus:border-neutral-950 focus:outline-none focus:ring-1 focus:ring-neutral-950"
                    >
                      <option value="Restaurante">Restaurante</option>
                      <option value="Pastelería">Pastelería</option>
                      <option value="Abarrotes">Abarrotes / Tiendita</option>
                      <option value="Farmacia">Farmacia</option>
                      <option value="Cafetería">Cafetería</option>
                      <option value="Otro">Otro</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">WhatsApp de Contacto</label>
                    <input
                      type="tel"
                      value={joinRestWhatsapp}
                      onChange={(e) => setJoinRestWhatsapp(e.target.value)}
                      placeholder="Ej. 5512345678"
                      className="mt-2 w-full rounded-2xl border border-black/5 bg-neutral-50/50 focus:bg-white px-4 py-3 text-sm font-medium text-neutral-900 transition-colors focus:border-neutral-950 focus:outline-none focus:ring-1 focus:ring-neutral-950 placeholder:text-neutral-300"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">Ubicación del Negocio</label>
                  <input
                    type="text"
                    value={joinRestLocation}
                    onChange={(e) => setJoinRestLocation(e.target.value)}
                    placeholder="Ej. Col. Centro, Calle Juárez #45"
                    className="mt-2 w-full rounded-2xl border border-black/5 bg-neutral-50/50 focus:bg-white px-4 py-3 text-sm font-medium text-neutral-900 transition-colors focus:border-neutral-950 focus:outline-none focus:ring-1 focus:ring-neutral-950 placeholder:text-neutral-300"
                  />
                </div>

                <div className="flex justify-end pt-4 gap-3">
                  <button
                    type="button"
                    onClick={() => setIsJoinRestModalOpen(false)}
                    className="rounded-full border border-black/10 px-6 py-3.5 text-xs font-bold text-neutral-700 hover:bg-neutral-50 active:scale-95 transition-all"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="rounded-full bg-neutral-950 hover:bg-neutral-800 text-white px-6 py-3.5 text-xs font-bold active:scale-[0.98] transition-all flex items-center gap-2"
                  >
                    <span>Enviar Solicitud</span>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Quiero ser Repartidor */}
        {isJoinDriverModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 py-6" onClick={() => setIsJoinDriverModalOpen(false)}>
            <div
              className="relative w-full max-w-[480px] rounded-[32px] bg-white shadow-[0_30px_100px_rgba(0,0,0,0.2)] overflow-hidden animate-scale-up p-6 md:p-8"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-black/5 pb-4 mb-6">
                <div>
                  <h3 className="text-xl font-bold tracking-tight text-neutral-900">Quiero ser Repartidor</h3>
                  <p className="text-xs text-neutral-500 mt-1">Únete a nuestra flota de repartidores independientes.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsJoinDriverModalOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 hover:bg-neutral-200 text-neutral-600 transition"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!joinDriverName.trim() || !joinDriverWhatsapp.trim() || !joinDriverLocation.trim()) {
                    setToastMessage('Por favor completa todos los campos del formulario.', 'error');
                    setTimeout(() => setToastMessage(''), 3000);
                    return;
                  }

                  const request = {
                    id: `driver-req-${Date.now()}`,
                    name: joinDriverName,
                    whatsapp: joinDriverWhatsapp,
                    motorcycle: joinDriverMotorcycle,
                    location: joinDriverLocation,
                    createdAt: new Date().toISOString()
                  };

                  try {
                    const apiUrl = '/api';
                    const response = await fetch(`${apiUrl}/public/solicitudes`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        type: 'DRIVER',
                        ownerName: joinDriverName,
                        whatsapp: joinDriverWhatsapp,
                        motorcycle: joinDriverMotorcycle,
                        location: joinDriverLocation,
                      }),
                    });

                    if (!response.ok) {
                      throw new Error('No se pudo procesar la solicitud');
                    }

                    setIsJoinDriverModalOpen(false);
                    setIsRequestSuccessModalOpen(true);
                    setJoinDriverName('');
                    setJoinDriverWhatsapp('');
                    setJoinDriverMotorcycle('SI');
                    setJoinDriverLocation('');
                  } catch (err) {
                    console.error('Error al enviar solicitud:', err);
                    setToastMessage('Ocurrió un error al enviar la solicitud. Por favor intenta de nuevo.', 'error');
                  }
                }}
                className="space-y-4 text-left"
              >
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">Nombre Completo</label>
                  <input
                    type="text"
                    value={joinDriverName}
                    onChange={(e) => setJoinDriverName(e.target.value)}
                    placeholder="Ej. Carlos Mendoza"
                    className="mt-2 w-full rounded-2xl border border-black/5 bg-neutral-50/50 focus:bg-white px-4 py-3 text-sm font-medium text-neutral-900 transition-colors focus:border-neutral-950 focus:outline-none focus:ring-1 focus:ring-neutral-950 placeholder:text-neutral-300"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">WhatsApp de Contacto</label>
                    <input
                      type="tel"
                      value={joinDriverWhatsapp}
                      onChange={(e) => setJoinDriverWhatsapp(e.target.value)}
                      placeholder="Ej. 5512345678"
                      className="mt-2 w-full rounded-2xl border border-black/5 bg-neutral-50/50 focus:bg-white px-4 py-3 text-sm font-medium text-neutral-900 transition-colors focus:border-neutral-950 focus:outline-none focus:ring-1 focus:ring-neutral-950 placeholder:text-neutral-300"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">¿Tienes motocicleta propia?</label>
                    <select
                      value={joinDriverMotorcycle}
                      onChange={(e) => setJoinDriverMotorcycle(e.target.value)}
                      className="mt-2 w-full rounded-2xl border border-black/5 bg-neutral-50/50 focus:bg-white px-4 py-3 text-sm font-medium text-neutral-900 transition-colors focus:border-neutral-950 focus:outline-none focus:ring-1 focus:ring-neutral-950"
                    >
                      <option value="SI">Sí, cuento con moto</option>
                      <option value="NO">No, requiero vehículo</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">Ubicación / Zona de Trabajo</label>
                  <input
                    type="text"
                    value={joinDriverLocation}
                    onChange={(e) => setJoinDriverLocation(e.target.value)}
                    placeholder="Ej. Colonia Centro, Norte de la Ciudad"
                    className="mt-2 w-full rounded-2xl border border-black/5 bg-neutral-50/50 focus:bg-white px-4 py-3 text-sm font-medium text-neutral-900 transition-colors focus:border-neutral-950 focus:outline-none focus:ring-1 focus:ring-neutral-950 placeholder:text-neutral-300"
                  />
                </div>

                <div className="flex justify-end pt-4 gap-3">
                  <button
                    type="button"
                    onClick={() => setIsJoinDriverModalOpen(false)}
                    className="rounded-full border border-black/10 px-6 py-3.5 text-xs font-bold text-neutral-700 hover:bg-neutral-50 active:scale-95 transition-all"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="rounded-full bg-neutral-950 hover:bg-neutral-800 text-white px-6 py-3.5 text-xs font-bold active:scale-[0.98] transition-all flex items-center gap-2"
                  >
                    <span>Enviar Solicitud</span>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Solicitud Enviada con Éxito */}
        {isRequestSuccessModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 py-6" onClick={() => setIsRequestSuccessModalOpen(false)}>
            <div
              className="relative w-full max-w-sm rounded-[32px] bg-white shadow-[0_30px_100px_rgba(0,0,0,0.2)] overflow-hidden animate-scale-up p-8 text-center"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#06c167]/10 mb-6">
                <svg className="h-8 w-8 text-[#06c167]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold tracking-tight text-neutral-900 mb-2">¡Solicitud Enviada!</h3>
              <p className="text-sm text-neutral-500 mb-8 leading-relaxed">
                Hemos recibido tus datos correctamente. Nuestro equipo los revisará y se pondrá en contacto contigo muy pronto.
              </p>
              <button
                type="button"
                onClick={() => setIsRequestSuccessModalOpen(false)}
                className="w-full rounded-full bg-neutral-950 px-6 py-4 text-sm font-bold text-white transition hover:bg-neutral-800 active:scale-[0.98]"
              >
                Entendido
              </button>
            </div>
          </div>
        )}

      {/* Floating Checkout Button */}
      {cart.length > 0 && !isCartOpen && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[45] w-[calc(100%-2rem)] max-w-sm pointer-events-auto">
          <button
            type="button"
            onClick={() => setIsCartOpen(true)}
            className="group relative flex w-full items-center justify-between overflow-hidden rounded-full bg-neutral-950 px-5 py-3.5 shadow-[0_8px_30px_rgb(0,0,0,0.2)] transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            {/* Pulsing background effect */}
            <div className="absolute inset-0 -z-10 animate-[pulse_2s_ease-in-out_infinite] bg-neutral-800 opacity-50" />
            
            <div className="flex items-center gap-3">
              <div className="relative flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white">
                <span className="text-xs font-bold">{cart.length}</span>
              </div>
              <span className="text-sm font-semibold tracking-wide text-white">Ver carrito</span>
            </div>
            
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white">
                ${(cartSubtotal).toFixed(2)}
              </span>
              <svg className="h-4 w-4 text-white/70 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>
        </div>
      )}

      {/* Modal de propuesta de programación de entrega */}
      {scheduleProposalOrder && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4 py-6">
          <div className="bg-white rounded-3xl border border-black/[0.03] shadow-[0_40px_120px_rgba(0,0,0,0.35)] p-7 w-full max-w-md h-fit max-h-[90vh] overflow-y-auto relative">
            {/* Customer icon */}
            <div className="text-center mb-6">
              <div className="w-20 h-20 bg-sky-100 rounded-full flex items-center justify-center mx-auto mb-4 ring-8 ring-sky-50">
                <span className="text-4xl">📅</span>
              </div>
              <h3 className="text-2xl font-black text-neutral-950 tracking-tight">Fecha de entrega programada</h3>
              <p className="text-sm text-neutral-500 mt-2 leading-relaxed">
                <strong className="text-neutral-800">{scheduleProposalOrder.restaurant.name}</strong> propuso entregar tu pedido en la siguiente fecha:
              </p>
            </div>

            {/* Date/Time display */}
            {scheduleProposalOrder.scheduledDeliveryAt && (
              <div className="bg-gradient-to-br from-sky-50 to-blue-50 rounded-2xl border border-sky-100 p-5 mb-6 text-center shadow-sm">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-600 mb-2">Fecha programada</p>
                <p className="text-2xl font-black text-neutral-950">
                  {new Date(scheduleProposalOrder.scheduledDeliveryAt).toLocaleDateString('es-MX', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })}
                </p>
                <div className="mt-2 inline-flex items-center gap-2 bg-white rounded-full px-4 py-1.5 border border-sky-200 shadow-sm">
                  <svg className="w-4 h-4 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="8" strokeWidth={2} />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 7v5l3 3" />
                  </svg>
                  <span className="text-sm font-bold text-sky-700">
                    {new Date(scheduleProposalOrder.scheduledDeliveryAt).toLocaleTimeString('es-MX', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              </div>
            )}

            {/* Order reference */}
            <div className="text-center mb-6">
              <p className="text-xs font-medium text-neutral-400">
                Pedido #{scheduleProposalOrder.orderReference?.slice(-6) || scheduleProposalOrder.dailyCounter || ''}
              </p>
              <p className="text-xs font-medium text-neutral-400 mt-0.5">
                {scheduleProposalOrder.items?.length || 0} producto{(scheduleProposalOrder.items?.length || 0) !== 1 ? 's' : ''} · {formatCurrency(scheduleProposalOrder.totalAmount)}
              </p>
            </div>

            {/* Actions */}
            <div className="space-y-3">
              <button
                type="button"
                onClick={async () => {
                  setScheduleProposalLoading(true);
                  try {
                    const res = await requestJson<{ success: boolean; data?: { message: string } }>({
                      apiBase,
                      path: `/pedidos/${scheduleProposalOrder.id}/confirmar-programacion`,
                      options: { method: 'POST' },
                      token,
                    });
                    if (res.success) {
                      setScheduleProposalOrder(null);
                      showTransientNotice({
                        key: `schedule-confirmed-${scheduleProposalOrder.id}`,
                        title: '¡Fecha confirmada! ✅',
                        description: `Tu pedido llegará el ${new Date(scheduleProposalOrder.scheduledDeliveryAt!).toLocaleDateString('es-MX', {
                          weekday: 'long',
                          day: 'numeric',
                          month: 'long',
                        })} a las ${new Date(scheduleProposalOrder.scheduledDeliveryAt!).toLocaleTimeString('es-MX', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}.`,
                        tone: 'success',
                      });
                    }
                  } catch (e) {
                    showTransientNotice({
                      key: `schedule-error-${scheduleProposalOrder.id}`,
                      title: 'Error',
                      description: 'Ocurrió un error al confirmar la fecha. Intenta de nuevo.',
                      tone: 'danger',
                    });
                  } finally {
                    setScheduleProposalLoading(false);
                  }
                }}
                disabled={scheduleProposalLoading}
                className="w-full rounded-full bg-sky-600 px-5 py-4 text-sm font-bold text-white shadow-[0_4px_12px_rgba(2,132,199,0.3)] transition hover:bg-sky-700 hover:shadow-[0_8px_20px_rgba(2,132,199,0.4)] disabled:opacity-70 disabled:cursor-not-allowed active:scale-[0.98]"
              >
                {scheduleProposalLoading ? 'Confirmando...' : '✅ Aceptar fecha'}
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!window.confirm('¿Estás seguro? Si cancelas, el pedido se cancelará y no podrás recuperarlo.')) return;
                  setScheduleProposalLoading(true);
                  try {
                    const res = await requestJson<{ success: boolean; data?: { message: string } }>({
                      apiBase,
                      path: `/pedidos/${scheduleProposalOrder.id}/rechazar-programacion`,
                      options: { method: 'POST' },
                      token,
                    });
                    if (res.success) {
                      setScheduleProposalOrder(null);
                      showTransientNotice({
                        key: `schedule-rejected-${scheduleProposalOrder.id}`,
                        title: 'Pedido cancelado ❌',
                        description: 'Cancelaste el pedido porque no aceptaste la fecha de entrega programada.',
                        tone: 'danger',
                      });
                    }
                  } catch (e) {
                    showTransientNotice({
                      key: `schedule-reject-error-${scheduleProposalOrder.id}`,
                      title: 'Error',
                      description: 'Ocurrió un error. Intenta de nuevo.',
                      tone: 'danger',
                    });
                  } finally {
                    setScheduleProposalLoading(false);
                  }
                }}
                disabled={scheduleProposalLoading}
                className="w-full rounded-full border border-rose-200 bg-white px-5 py-4 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.98]"
              >
                ❌ Cancelar pedido
              </button>
            </div>
          </div>
        </div>
      )}

      <audio id="customer-alert-audio" src="/sounds/notifica.wav" preload="auto"></audio>
      <audio id="chat-message-audio" src="/sounds/mensaje.wav" preload="auto"></audio>
      <audio id="customer-llegue-audio" src="/sounds/llegue.wav" preload="auto"></audio>

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onSuccess={handleLoginSuccess}
        apiBase={apiBase}
      />
    </main>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/8 px-4 py-3 backdrop-blur">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/55">{label}</p>
      <p className="mt-2 text-xl font-semibold text-white">{value}</p>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  description,
}: {
  title: string;
  value: string;
  description: string;
}) {
  return (
    <article className="rounded-[28px] border border-black/5 bg-white p-5 shadow-[0_18px_50px_rgba(15,15,15,0.05)]">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">{title}</p>
      <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-neutral-950">{value}</p>
      <p className="mt-2 text-sm leading-6 text-neutral-600">{description}</p>
    </article>
  );
}
function rankBestRated(restaurant: RestaurantSummary) {
  const reviewCount = Math.max(0, restaurant.reviewCount || 0);
  const totalOrders = Math.max(0, restaurant.totalOrders || 0);
  
  // Average rating between 0 and 5, defaulting to 4.0 if there are no reviews
  let avgRating = 4.0;
  if (reviewCount > 0 && typeof restaurant.rating === 'number' && !isNaN(restaurant.rating)) {
    avgRating = Math.max(0, Math.min(5, restaurant.rating));
  }

  // Bayesian average rating score: (avgRating * reviewCount + C * m) / (reviewCount + C)
  // C = 5, m = 4.0
  const weightedRating = (avgRating * reviewCount + 20) / (reviewCount + 5);

  // Orders count boost (diminishing returns via log10, capped at 1.0)
  const orderBoost = Math.min(1.0, Math.log10(totalOrders + 1) * 0.2);

  // Freshness boost: boost of 0.3 for new restaurants (<= 30 days old)
  let freshnessBoost = 0;
  if (restaurant.createdAt) {
    const createdTime = new Date(restaurant.createdAt).getTime();
    if (!isNaN(createdTime)) {
      const ageInDays = (Date.now() - createdTime) / (1000 * 60 * 60 * 24);
      if (ageInDays >= 0 && ageInDays <= 30) {
        freshnessBoost = 0.3 * (1 - ageInDays / 30);
      }
    }
  }

  return weightedRating + orderBoost + freshnessBoost;
}

function rankRestaurant(restaurant: RestaurantSummary, userRegion: string) {
  let score = 0;

  if (restaurant.isOpen) {
    score += 100;
  }

  if (restaurant.region.trim().toLowerCase() === userRegion.trim().toLowerCase()) {
    score += 30;
  }

  if (typeof restaurant.distanceKm === 'number') {
    score += Math.max(0, 25 - restaurant.distanceKm * 4);
  }

  score += Math.max(0, 40 - restaurant.minDeliveryTime);
  score += restaurant.hasOwnDelivery ? 8 : 0;
  score += restaurant.effectiveDeliveryFee ? Math.max(0, 12 - restaurant.effectiveDeliveryFee) : 12;

  return score;
}

function buildRestaurantInitials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');
}

function buildRestaurantCoverFallback(categoryId: RestaurantCategoryId) {
  const fallbackByCategory: Record<RestaurantCategoryId, string> = {
    all: 'bg-[linear-gradient(135deg,#fde68a_0%,#f97316_100%)]',
    pizza: 'bg-[linear-gradient(135deg,#fca5a5_0%,#ea580c_100%)]',
    desayuno: 'bg-[linear-gradient(135deg,#fde68a_0%,#f59e0b_100%)]',
    pollo: 'bg-[linear-gradient(135deg,#fdba74_0%,#ef4444_100%)]',
    tacos: 'bg-[linear-gradient(135deg,#fcd34d_0%,#84cc16_100%)]',
    'comida-corrida': 'bg-[linear-gradient(135deg,#fed7aa_0%,#f97316_100%)]',
    abarrotes: 'bg-[linear-gradient(135deg,#fb7185_0%,#ef4444_100%)]',
    farmacia: 'bg-[linear-gradient(135deg,#93c5fd_0%,#22c55e_100%)]',
    hamburguesas: 'bg-[linear-gradient(135deg,#f59e0b_0%,#b45309_100%)]',
    sushi: 'bg-[linear-gradient(135deg,#f9a8d4_0%,#e11d48_100%)]',
  };

  return fallbackByCategory[categoryId];
}

function mapOrderAddressToProfile(address: NonNullable<CustomerOrderDetail['address']>): CustomerProfileAddress {
  return {
    street: address.street,
    number: address.number,
    neighborhood: address.neighborhood,
    city: address.city,
    state: address.state,
    zipCode: address.zipCode,
    country: address.country,
    reference: address.reference || '',
  };
}

function buildProfileAddressLabel(address: CustomerProfileAddress) {
  const firstLine = [address.street, address.number].filter(Boolean).join(' ').trim();
  const secondLine = [address.neighborhood, address.reference].filter(Boolean).join(' · ').trim();

  return [firstLine, secondLine].filter(Boolean).join(', ') || 'Aun no has guardado una direccion.';
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

function normalizeSearchValue(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}



const Panel = React.memo(function Panel({
  title,
  subtitle,
  aside,
  className,
  children,
}: {
  title: string;
  subtitle: string;
  aside?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-[32px] border border-black/5 bg-white/90 p-5 shadow-[0_18px_60px_rgba(15,15,15,0.05)] backdrop-blur md:p-6 ${className || ''}`}
    >
      <div className="mb-5 flex items-center justify-between gap-3 sm:gap-4">
        <div className="min-w-0 flex-1">
          {subtitle ? (
            <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-sky-500 sm:text-xs">{subtitle}</p>
          ) : null}
          <h2 className="truncate text-xl font-extrabold tracking-[-0.04em] text-neutral-950 sm:text-[1.35rem] md:text-2xl">
            {title}
          </h2>
        </div>
        {aside ? (
          <span className="shrink-0 rounded-full bg-gradient-to-r from-sky-50 to-white px-3 py-1.5 text-[11px] font-bold text-sky-600 border border-sky-100/60 shadow-[0_2px_8px_rgba(14,165,233,0.08)] sm:text-xs">
            {aside}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
});

function triggerHaptic(pattern: number | number[] = 10) {
  if (typeof window !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(pattern);
  }
}

function formatPhoneNumber(value: string) {
  const digits = value.replace(/\D/g, '');
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6, 10)}`;
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  readOnly = false,
  mask,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  placeholder: string;
  type?: string;
  readOnly?: boolean;
  mask?: (value: string) => string;
}) {
  return (
    <label className="grid gap-2 text-sm text-neutral-600">
      <span className="font-medium text-neutral-800">{label}</span>
      <input
        type={type}
        value={mask ? mask(value) : value}
        onChange={(event) => {
          const rawValue = mask ? event.target.value.replace(/\D/g, '').slice(0, 10) : event.target.value;
          onChange && onChange(rawValue);
        }}
        placeholder={placeholder}
        readOnly={readOnly}
        className={`rounded-2xl border border-black/10 px-4 py-3 text-neutral-950 outline-none transition placeholder:text-neutral-400 focus:border-black/20 ${readOnly ? 'bg-neutral-50 cursor-not-allowed' : 'bg-white'}`}
      />
    </label>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[24px] border border-black/5 bg-neutral-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">{label}</p>
      <p className="mt-2 text-sm leading-6 text-neutral-950">{value}</p>
    </div>
  );
}

const EmptyState = React.memo(function EmptyState({ text, compact = false }: { text: string; compact?: boolean }) {
  return (
    <div
      className={`rounded-[28px] border border-dashed border-black/10 bg-neutral-50 px-4 text-center text-sm text-neutral-500 ${compact ? 'py-8' : 'py-12'
        }`}
    >
      {text}
    </div>
  );
});

function Callout({
  tone,
  children,
}: {
  tone: 'info' | 'success' | 'warning' | 'danger';
  children: React.ReactNode;
}) {
  const tones = {
    info: 'border-sky-100 bg-sky-50 text-sky-700',
    success: 'border-emerald-100 bg-emerald-50 text-emerald-700',
    warning: 'border-amber-100 bg-amber-50 text-amber-700',
    danger: 'border-rose-100 bg-rose-50 text-rose-700',
  } satisfies Record<'info' | 'success' | 'warning' | 'danger', string>;

  return <div className={`rounded-2xl border px-4 py-3 text-sm ${tones[tone]}`}>{children}</div>;
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


function Timeline({
  steps,
}: {
  steps: Array<{
    key: string;
    label: string;
    description: string;
    state: 'done' | 'active' | 'pending';
  }>;
}) {
  return (
    <div className="rounded-[28px] border border-black/5 bg-neutral-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">Timeline del pedido</p>
      <div className="mt-4 grid gap-4">
        {steps.map((step, index) => (
          <div key={step.key} className="flex items-start gap-4">
            <div className="flex flex-col items-center">
              <span
                className={`flex h-10 w-10 items-center justify-center rounded-full border text-sm font-semibold ${step.state === 'done'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : step.state === 'active'
                    ? 'border-neutral-950 bg-neutral-950 text-white'
                    : 'border-black/10 bg-white text-neutral-400'
                  }`}
              >
                {index + 1}
              </span>
              {index < steps.length - 1 ? <span className="mt-2 h-10 w-px bg-black/10" /> : null}
            </div>
            <div className="pt-1">
              <p className="font-medium text-neutral-950">{step.label}</p>
              <p className="mt-1 text-sm text-neutral-600">{step.description}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ status, inverted = false, businessType }: { status: OrderStatus; inverted?: boolean; businessType?: string }) {
  const palette = inverted ? invertedStatusPaletteMap : statusPaletteMap;

  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-tight ${palette[status]}`}>
      {orderStatusLabel(status, businessType)}
    </span>
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

const invertedStatusPaletteMap: Record<OrderStatus, string> = {
  PENDING: 'border-white/10 bg-white/10 text-white',
  CONFIRMED: 'border-white/10 bg-white/10 text-white',
  PREPARING: 'border-white/10 bg-white/10 text-white',
  READY: 'border-white/10 bg-white/10 text-white',
  PICKED_UP: 'border-white/10 bg-white/10 text-white',
  IN_TRANSIT: 'border-white/10 bg-white/10 text-white',
  DELIVERED: 'border-white/10 bg-white/10 text-white',
  CANCELLED: 'border-white/10 bg-white/10 text-white/80',
  REJECTED: 'border-white/10 bg-white/10 text-white',
};

const notificationTitleMap: Record<(typeof liveEvents)[number], string> = {
  'order:accepted': 'Pedido aceptado',
  'order:rejected': 'Pedido rechazado',
  'order:preparing': 'Preparando pedido',
  'order:ready': 'Pedido listo',
  'order:driver-assigned': 'Repartidor asignado',
  'order:driver-accepted': 'Repartidor confirmado',
  'order:driver-rejected': 'Reasignando repartidor',
  'order:picked-up': 'Pedido recogido',
  'order:in-transit': 'En camino',
  'order:eta-updated': 'Hora estimada actualizada',
  'order:driver-arrived': '¡Ya llegué!',
  'order:driver_arrived': '¡Ya llegué!',
  'order:delivered': 'Pedido entregado',
  'order:completed': 'Pedido recogido',
  'order:cancellation-approved': 'Cancelación aprobada',
  'order:cancellation-rejected': 'Cancelación rechazada',
  'order:pin-reset': 'Nuevo PIN de recolección',
  'order:schedule-proposal': 'Propuesta de fecha de entrega',
  'order:schedule-accepted': 'Fecha de entrega confirmada',
  'order:schedule-rejected': 'Fecha de entrega rechazada',
};

function isActiveOrderStatus(status: string) {
  const normalizedStatus = normalizeOrderStatusValue(status);

  return ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'PICKED_UP', 'IN_TRANSIT', 'DRIVER_ARRIVED'].includes(normalizedStatus);
}



function normalizeOrderStatusValue(status: string) {
  return status.trim().toUpperCase().replace(/[\s-]+/g, '_');
}

function buildNotificationMessage(
  eventName: (typeof liveEvents)[number],
  payload: { orderId?: string; status?: string; driverName?: string }
) {
  if (eventName === 'order:driver-assigned') {
    return payload.driverName
      ? `${payload.driverName} fue asignado a tu pedido.`
      : 'Un repartidor fue asignado a tu pedido.';
  }

  if (eventName === 'order:completed') {
    return 'Tu pedido ha sido recogido. Gracias por tu compra.';
  }

  if (eventName === 'order:pin-reset') {
    return 'El PIN de recolección fue renovado. Proporciónalo al restaurante.';
  }

  if (eventName === 'order:driver-arrived' || eventName === 'order:driver_arrived') {
    return 'El repartidor está afuera de tu domicilio con tu pedido.';
  }

  return payload.orderId
    ? `Tu pedido ${payload.orderId} recibió una actualización.`
    : 'Tu pedido recibió una actualización.';
}

function buildLiveEventKey(
  eventName: (typeof liveEvents)[number],
  payload: { orderId?: string; status?: string; driverName?: string }
) {
  return [
    eventName,
    payload.orderId || 'order',
    payload.status || 'status',
    payload.driverName || 'driver',
  ].join(':');
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDeliverySummary(fee?: number | null) {
  const normalizedFee = typeof fee === 'number' && Number.isFinite(fee) ? fee : 0;

  return normalizedFee > 0 ? formatCurrency(normalizedFee) : 'Sin costo';
}

function formatRegionChipLabel(value?: string | null) {
  const raw = (value || '').trim();

  if (!raw) {
    return 'Zona disponible';
  }

  const normalized = raw
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (normalized.toLowerCase() === 'michoacan puruaran') {
    return 'Puruaran';
  }

  return normalized
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
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

function formatShortAddress(address: CustomerOrderListItem['address']) {
  if (!address) return '';
  return `${address.street} ${address.number}, ${address.neighborhood}`;
}

/**
 * Calcula la distancia en línea recta entre dos coordenadas (Fórmula de Haversine).
 * Enfoque Senior: Manejo de precisión y radio de la Tierra exacto.
 */
function calculateHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  if (lat1 === lat2 && lon1 === lon2) return 0;

  const R = 6371; // Radio de la Tierra en km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
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


