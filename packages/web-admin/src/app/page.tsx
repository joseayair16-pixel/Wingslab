'use client';

import Head from 'next/head';
import { SaDelLogo } from '../components/SaDelLogo';
import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend } from 'recharts';
import {
  AuthResponse,
  AuthUser,
  clearStoredSession,
  persistApiBase,
  persistStoredSession,
  readStoredSession,
  requestJson,
  uploadMediaAsset,
  getOrderStatusLabel,
  convertImageFileToDataUrl,
} from '@sadel/shared';

type RestaurantStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED';
type BillingCycle = 'WEEKLY' | 'MONTHLY';
type UserAccountStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
type CustomerRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type DriverAccountStatus = 'ACTIVE' | 'SUSPENDED';

export type OrderStatus = 'PENDING' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'PICKED_UP' | 'IN_TRANSIT' | 'DELIVERED' | 'COMPLETED' | 'CANCELLED' | 'REJECTED';

export interface OrderItem {
  id: string;
  orderReference: string;
  status: OrderStatus;
  totalAmount: number;
  subtotal: number;
  taxAmount: number;
  serviceFee: number;
  platformFee: number;
  deliveryFee: number;
  paymentMethod: string;
  paymentStatus: string;
  createdAt: string;
  estimatedDeliveryTime: string;
  actualDeliveryTime: string | null;
  etaExtendedMinutes: number;
  preparationTimeMinutes: number | null;
  preparationStartedAt: string | null;
  isSupportRequested: boolean;
  supportCount: number;
  supportRejectionCount: number;
  noDriversAvailable: boolean;
  notes: string | null;
  deliveryPreference: string | null;
  handoverPin: string | null;
  restaurant: { id: string; name: string; region: string; hasOwnDelivery?: boolean };
  customer: { id: string; name?: string; phone?: string | null; user?: { id: string; name: string; phone: string | null } };
  driver: { id: string; name?: string; phone?: string | null; user?: { id: string; name: string; phone: string | null } } | null;
}

export interface OrderDetail extends OrderItem {
  address: { street: string; neighborhood: string; externalNumber: string; internalNumber?: string; reference?: string; };
  items: any[];
  tracking: any[];
}
type DriverAvailabilityStatus = 'AVAILABLE' | 'BUSY' | 'OFFLINE';

type RestaurantBillingSummary = {
  currentDebt: number;
  pastDebt: number;
  deliveredRevenue: number;
  serviceFeeRevenue: number;
  platformFeeRevenue: number;
  whatsappFeeRevenue: number;
  deliveredOrders: number;
  platformFeeRate: number;
  billingCycle: BillingCycle;
  periodStart: string;
  periodEnd: string;
  nextChargeDate: string;
};

type RestaurantOverview = {
  totalRestaurants: number;
  activeRestaurants: number;
  pausedRestaurants: number;
  ownDeliveryRestaurants: number;
  weeklyBillingRestaurants: number;
  monthlyBillingRestaurants: number;
  restaurantsWithDebt: number;
  totalOutstandingDebt: number;
  totalPastDebt: number;
  totalAccruedDebt: number;
};

type BusinessType = 'RESTAURANT' | 'STORE';

type RestaurantItem = {
  id: string;
  name: string;
  logo?: string | null;
  description: string;
  region: string;
  status: RestaurantStatus;
  address: string;
  minDeliveryTime: number;
  maxDeliveryTime: number;
  hasOwnDelivery: boolean;
  serviceFee?: number | null;
  effectiveDeliveryFee?: number | null;
  billingCycle: BillingCycle;
  platformFeeRate: number;
  lastBillingSettledAt?: string | null;
  billingContactEmail?: string | null;
  billingSummary?: RestaurantBillingSummary;
  hasOverdueSettlement?: boolean;
  hasInReviewSettlement?: boolean;
  hasPendingSettlement?: boolean;
  businessType?: BusinessType;
  user?: {
    name: string;
    phone: string;
    email: string;
  };
};

type RestaurantListResponse = {
  success: true;
  data: {
    items: RestaurantItem[];
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
  };
};

type StoreCategoryItem = {
  id: string;
  name: string;
  icon: string;
  color?: string | null;
  keywords: string[];
  isActive: boolean;
  order: number;
};

type RegionItem = {
  id: string;
  code: string;
  name: string;
  country: string;
  state: string;
  city: string;
  baseDeliveryFee: number;
  deliveryRadius: number;
  supportedPayments: string[];
  isActive: boolean;
  pricingModel: 'fixed' | 'distance';
  baseRate: number;
  perKmRate: number;
  minDeliveryFee: number;
  maxDeliveryFee: number;
};

type RegionEditForm = {
  baseDeliveryFee: string;
  deliveryRadius: string;
  isActive: boolean;
  pricingModel: 'fixed' | 'distance';
  baseRate: string;
  perKmRate: string;
  minDeliveryFee: string;
  maxDeliveryFee: string;
};

type CreateRegionForm = {
  name: string;
  country: string;
  state: string;
  city: string;
  baseDeliveryFee: string;
  deliveryRadius: string;
  pricingModel: 'fixed' | 'distance';
  baseRate: string;
  perKmRate: string;
  minDeliveryFee: string;
  maxDeliveryFee: string;
  supportedPayments: string;
  isActive: boolean;
};

type CreateRestaurantForm = {
  restaurantName: string;
  username: string;
  password: string;
  region: string;
  businessType: BusinessType;
  serviceFee: string;
  platformFeePerOrder: string;
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
};

type RestaurantOverviewResponse = {
  success: true;
  data: RestaurantOverview;
};

type CustomerOverview = {
  totalCustomers: number;
  activeCustomers: number;
  suspendedCustomers: number;
  inactiveCustomers: number;
  newCustomersThisMonth: number;
  customersWithOrders: number;
  activeInLast30Days: number;
  highRiskCustomers: number;
  totalRevenue: number;
  totalRefunds: number;
  totalAddresses: number;
  totalFavorites: number;
  totalReviews: number;
};

type CustomerItem = {
  id: string;
  customerId: string;
  name: string;
  phone: string;
  email: string;
  region: string;
  status: UserAccountStatus;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  totalOrders: number;
  deliveredOrders: number;
  cancelledOrders: number;
  rejectedOrders: number;
  activeOrders: number;
  totalSpent: number;
  refundCount: number;
  addressCount: number;
  favoriteCount: number;
  reviewCount: number;
  riskLevel: CustomerRiskLevel;
  riskScore: number;
  riskFlags: string[];
  averageTicket: number;
  paymentMethods: string[];
};

type CustomerListResponse = {
  success: true;
  data: {
    items: CustomerItem[];
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
  };
};

type CustomerDetail = {
  id: string;
  customerId: string;
  name: string;
  lastName: string | null;
  phone: string;
  email: string;
  region: string;
  status: UserAccountStatus;
  profilePhoto: string | null;
  dateOfBirth: string | null;
  createdAt: string;
  updatedAt: string;
  totalOrdersRecorded: number;
  rating: number;
  summary: {
    totalOrders: number;
    deliveredOrders: number;
    cancelledOrders: number;
    rejectedOrders: number;
    activeOrders: number;
    totalSpent: number;
    refundCount: number;
    riskLevel: CustomerRiskLevel;
    riskScore: number;
    riskFlags: string[];
    averageTicket: number;
    paymentMethods: string[];
    favoriteCount: number;
    reviewCount: number;
    addressCount: number;
    lastOrderAt?: string | null;
  };
  addresses: Array<{
    id: string;
    street: string;
    number: string;
    apartment?: string | null;
    neighborhood: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
    reference?: string | null;
    isDefault: boolean;
  }>;
  recentOrders: Array<{
    id: string;
    orderReference: string;
    totalAmount: number;
    status: string;
    paymentMethod: string;
    paymentStatus: string;
    createdAt: string;
    restaurant: {
      id: string;
      name: string;
      region: string;
    };
    address: {
      street: string;
      number: string;
      neighborhood: string;
      city: string;
      state: string;
    };
    driver?: {
      id: string;
      user: {
        name: string;
      };
    } | null;
  }>;
  refunds: Array<{
    customerId: string;
    amount: number;
    createdAt: string;
  }>;
  favorites: Array<{
    id: string;
    restaurantId: string;
    createdAt: string;
  }>;
  reviews: Array<{
    id: string;
    restaurantId: string;
    rating: number;
    comment?: string | null;
    createdAt: string;
  }>;
};

type CustomerDetailResponse = {
  success: true;
  data: CustomerDetail;
};

type CustomerOverviewResponse = {
  success: true;
  data: CustomerOverview;
};

type CustomerFilters = {
  search: string;
  status: '' | UserAccountStatus;
  risk: '' | CustomerRiskLevel;
  region: string;
  sort: 'recent' | 'orders' | 'spend' | 'risk';
};

type RestaurantFilters = {
  search: string;
  status: '' | 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  region: string;
  businessType: '' | BusinessType;
};

type DriverOverview = {
  totalDrivers: number;
  activeDrivers: number;
  availableDrivers: number;
  busyDrivers: number;
  offlineDrivers: number;
  suspendedDrivers: number;
  inactiveDrivers: number;
  driversWithExpiredLicense: number;
  driversWithExpiringLicense: number;
  activeAssignments: number;
  totalDeliveries: number;
  averageRating: number;
  newDriversThisMonth: number;
  totalPastDebt: number;
  totalAccruedDebt: number;
};

type DriverItem = {
  id: string;
  userId: string;
  region: string;
  status: DriverAccountStatus;
  availability: DriverAvailabilityStatus;
  rating: number;
  totalDeliveries: number;
  documentNumber: string;
  documentType: string;
  profilePhoto?: string | null;
  licensePhoto?: string | null;
  licenseExpiry?: string | null;
  bankAccount?: string | null;
  currentLatitude?: number | null;
  currentLongitude?: number | null;
  createdAt: string;
  updatedAt: string;
  licenseState: 'valid' | 'expiring' | 'expired' | 'missing';
  activeDebt: number;
  debtStatus: 'none' | 'current' | 'overdue' | 'suspended';
  user: {
    id: string;
    name: string;
    phone: string;
    email: string;
    region: string;
    status: UserAccountStatus;
    createdAt?: string;
    updatedAt?: string;
  };
  _count?: {
    orders: number;
    settlements?: number;
  };
};

type DriverListResponse = {
  success: true;
  data: {
    items: DriverItem[];
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
  };
};

type DriverDetail = DriverItem & {
  stats?: {
    totalDeliveries: number;
    totalEarnings: number;
    rating: number;
    avgDeliveryTime: number;
  } | null;
  platformFeePerOrder: number;
  summary: {
    activeOrders: number;
    deliveredOrders: number;
    averageRating: number;
    totalDeliveries: number;
    activeDebt: number;
    isSuspendedByDebt?: boolean;
    suspendedDebtAmount?: number;
    lastKnownLocation?: {
      latitude: number;
      longitude: number;
    } | null;
  };
  recentOrders: Array<{
    id: string;
    orderReference: string;
    totalAmount: number;
    status: string;
    createdAt: string;
    restaurant: {
      id: string;
      name: string;
      region: string;
    };
    customer: {
      id: string;
      user: {
        id: string;
        name: string;
        phone: string;
      };
    };
  }>;
};

type DriverOverviewResponse = {
  success: true;
  data: DriverOverview;
};

type DriverDetailResponse = {
  success: true;
  data: DriverDetail;
};

type DriverFilters = {
  search: string;
  status: '' | DriverAccountStatus;
  availability: '' | DriverAvailabilityStatus;
  region: string;
  debt: '' | 'none' | 'current' | 'overdue' | 'suspended';
};

type CreateDriverForm = {
  name: string;
  phone: string;
  email: string;
  password: string;
  region: string;
  documentNumber: string;
  documentType: string;
  bankAccount: string;
  licenseExpiry: string;
  platformFeePerOrder: string;
  status: DriverAccountStatus;
  availability: DriverAvailabilityStatus;
};

type AdminPortalSection =
  | 'dashboard'
  | 'restaurants'
  | 'drivers'
  | 'users'
  | 'settings'
  | 'support'
  | 'categories'
  | 'requests'
  | 'orders'
  | 'promotions'
  | 'billboards'
  | 'notifications'
  | 'stuck'
  | 'featured'
  | 'customer-debts';

const defaultApiBase = '/api';
const storageKey = 'sadel.admin';
const defaultRestaurantServiceFee = '5';

export default function Home() {
  const [apiBase, setApiBase] = useState(defaultApiBase);
  const [token, setToken] = useState('');
  const [sessionUser, setSessionUser] = useState<AuthUser | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [restaurants, setRestaurants] = useState<RestaurantItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingRegions, setLoadingRegions] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [savingRegion, setSavingRegion] = useState(false);
  const [error, setError] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [storeCategories, setStoreCategories] = useState<StoreCategoryItem[]>([]);
  const [loadingStoreCategories, setLoadingStoreCategories] = useState(false);
  const [isCreateCategoryModalOpen, setIsCreateCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<StoreCategoryItem | null>(null);
  const [regions, setRegions] = useState<RegionItem[]>([]);
  const [selectedRegionCode, setSelectedRegionCode] = useState('');
  const [selectedRegion, setSelectedRegion] = useState<RegionItem | null>(null);
  const [regionForm, setRegionForm] = useState<RegionEditForm | null>(null);
  const [settingsTab, setSettingsTab] = useState<'regions' | 'brand' | 'payments' | 'categories'>('regions');
  const [isCreateRegionOpen, setIsCreateRegionOpen] = useState(false);
  const [creatingRegion, setCreatingRegion] = useState(false);
  const [createRegionForm, setCreateRegionForm] = useState<CreateRegionForm>(createRegionFormState());
  const [isCreateRestaurantOpen, setIsCreateRestaurantOpen] = useState(false);
  const [creatingRestaurant, setCreatingRestaurant] = useState(false);
  const [createRestaurantForm, setCreateRestaurantForm] = useState<CreateRestaurantForm>(
    createRestaurantFormState()
  );
  const [customerOverview, setCustomerOverview] = useState<CustomerOverview | null>(null);
  const [customers, setCustomers] = useState<CustomerItem[]>([]);
  const [customersTotal, setCustomersTotal] = useState(0);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [loadingCustomerDetail, setLoadingCustomerDetail] = useState(false);
  const [updatingCustomerStatus, setUpdatingCustomerStatus] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerDetail | null>(null);
  const [customerFilters, setCustomerFilters] = useState<CustomerFilters>({
    search: '',
    status: '',
    risk: '',
    region: '',
    sort: 'recent',
  });
  const [customerPage, setCustomerPage] = useState(1);
  const [customerDetailTab, setCustomerDetailTab] = useState<'profile' | 'orders' | 'addresses' | 'actions'>('profile');
  const [customerActionStatus, setCustomerActionStatus] = useState<UserAccountStatus>('SUSPENDED');
  const [customerActionReason, setCustomerActionReason] = useState('');
  const [driverOverview, setDriverOverview] = useState<DriverOverview | null>(null);

  // Orders State
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [ordersPage, setOrdersPage] = useState(1);
  const [orderFilters, setOrderFilters] = useState<{status: string, noDriversAvailable: string, date: string}>({ status: '', noDriversAvailable: '', date: '' });
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<OrderDetail | null>(null);
  const [loadingOrderDetail, setLoadingOrderDetail] = useState(false);
  const [ordersAutoRefresh, setOrdersAutoRefresh] = useState(true);

  // Deuda de clientes (pedidos no recibidos)
  const [customerSettlements, setCustomerSettlements] = useState<any[]>([]);
  const [customerSettlementsTotal, setCustomerSettlementsTotal] = useState(0);
  const [customerSettlementFilter, setCustomerSettlementFilter] = useState('');
  const [loadingCustomerSettlements, setLoadingCustomerSettlements] = useState(false);
  const [customerSettlementActionLoading, setCustomerSettlementActionLoading] = useState<string | null>(null);
  const [viewingCustomerProofUrl, setViewingCustomerProofUrl] = useState<string | null>(null);

  const [drivers, setDrivers] = useState<DriverItem[]>([]);
  const [driversTotal, setDriversTotal] = useState(0);
  const [loadingDrivers, setLoadingDrivers] = useState(false);
  const [loadingDriverDetail, setLoadingDriverDetail] = useState(false);
  const [selectedDriverId, setSelectedDriverId] = useState('');
  const [selectedDriver, setSelectedDriver] = useState<DriverDetail | null>(null);
  const [driverSettlements, setDriverSettlements] = useState<any[]>([]);
  const [settlementActionLoading, setSettlementActionLoading] = useState<string | null>(null);
  const [viewingDriverProofUrl, setViewingDriverProofUrl] = useState<string | null>(null);
  const [showDriverOrderHistory, setShowDriverOrderHistory] = useState(false);
  const [driverOrderHistory, setDriverOrderHistory] = useState<any[]>([]);
  const [loadingDriverOrderHistory, setLoadingDriverOrderHistory] = useState(false);
  const [driverOrderHistoryTotal, setDriverOrderHistoryTotal] = useState(0);
  const [driverOrderHistoryPage, setDriverOrderHistoryPage] = useState(1);
  const [driverOrderHistoryHasMore, setDriverOrderHistoryHasMore] = useState(false);
  const [driverFinanzas, setDriverFinanzas] = useState<any>(null);
  const [loadingDriverFinanzas, setLoadingDriverFinanzas] = useState(false);
  const [driverFilters, setDriverFilters] = useState<DriverFilters>({
    search: '',
    status: '',
    availability: '',
    region: '',
    debt: '',
  });
  const [isCreateDriverOpen, setIsCreateDriverOpen] = useState(false);
  const [creatingDriver, setCreatingDriver] = useState(false);
  const [createDriverForm, setCreateDriverForm] = useState<CreateDriverForm>(createDriverFormState());
  const [driverActionStatus, setDriverActionStatus] = useState<DriverAccountStatus>('SUSPENDED');
  const [driverActionReason, setDriverActionReason] = useState('');
  const [updatingDriverStatus, setUpdatingDriverStatus] = useState(false);
  const [removingDriver, setRemovingDriver] = useState(false);
  const [driverBillingFee, setDriverBillingFee] = useState<number>(0);
  const [updatingDriverBilling, setUpdatingDriverBilling] = useState(false);
  const [restaurantFilters, setRestaurantFilters] = useState<RestaurantFilters>({
    search: '',
    status: '',
    region: '',
    businessType: '',
  });
  const [summary, setSummary] = useState({
    total: 0,
    active: 0,
    ownDelivery: 0,
  });
  const [restaurantOverview, setRestaurantOverview] = useState<RestaurantOverview | null>(null);
  const [tickets, setTickets] = useState<any[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [ticketFilter, setTicketFilter] = useState<'ALL' | 'PENDING' | 'IN_PROGRESS' | 'RESOLVED'>('ALL');
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [ticketResponse, setTicketResponse] = useState('');
  const [isResolvingTicket, setIsResolvingTicket] = useState(false);
  const [isDeletingTicket, setIsDeletingTicket] = useState(false);
  const selectedTicket = tickets.find(t => t.id === selectedTicketId) || null;
  const isAdminSession = Boolean(sessionUser && sessionUser.role === 'ADMIN');
  const [activeSection, setActiveSectionState] = useState<AdminPortalSection>('dashboard');

  const setActiveSection = (section: AdminPortalSection) => {
    setActiveSectionState(section);
    if (typeof window !== 'undefined') {
      localStorage.setItem('adminActiveSection', section);
    }
  };
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const activeRestaurantRegions = regions.filter((regionItem) => regionItem.isActive);
  const [restaurantWelcomeImage, setRestaurantWelcomeImage] = useState('');
  const [adminBankName, setAdminBankName] = useState('');
  const [adminBankAccount, setAdminBankAccount] = useState('');
  const [adminBankBeneficiary, setAdminBankBeneficiary] = useState('');
  const [promoModalEnabled, setPromoModalEnabled] = useState(false);
  const [driverWelcomeImage, setDriverWelcomeImage] = useState('');
  const [promoModalImage, setPromoModalImage] = useState('');
  const [restaurantPromoModalEnabled, setRestaurantPromoModalEnabled] = useState(false);
  const [restaurantPromoModalImage, setRestaurantPromoModalImage] = useState('');
  const [isSavingBrandSettings, setIsSavingBrandSettings] = useState(false);

  // Platform Requests (Affiliations) State
  const [platformRequests, setPlatformRequests] = useState<any[]>([]);
  const [loadingPlatformRequests, setLoadingPlatformRequests] = useState(false);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [platformRequestsFilter, setPlatformRequestsFilter] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'>('PENDING');

  // Approval Modal State
  const [isApproveRequestModalOpen, setIsApproveRequestModalOpen] = useState(false);
  const [approveRegion, setApproveRegion] = useState('');
  const [approvePassword, setApprovePassword] = useState('sadel123');
  const [isSubmittingApproval, setIsSubmittingApproval] = useState(false);
  const [isSubmittingRejection, setIsSubmittingRejection] = useState(false);

  // Dashboard Stats State
  const [dashboardStats, setDashboardStats] = useState<any | null>(null);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [dashboardInboxTab, setDashboardInboxTab] = useState<'settlements' | 'affiliations' | 'tickets'>('settlements');
  const [dashboardTicketResponse, setDashboardTicketResponse] = useState<{ [ticketId: string]: string }>({});
  const [dashboardSubmittingTicketId, setDashboardSubmittingTicketId] = useState<string | null>(null);
  const [viewingSettlementUrl, setViewingSettlementUrl] = useState<string | null>(null);
  const [dashboardApprovingAffiliationId, setDashboardApprovingAffiliationId] = useState<string | null>(null);

  // Promotions State
  const [promotions, setPromotions] = useState<any[]>([]);
  const [loadingPromotions, setLoadingPromotions] = useState(false);
  const [isPromoModalOpen, setIsPromoModalOpen] = useState(false);
  const [editingPromo, setEditingPromo] = useState<any | null>(null);
  const [promoForm, setPromoForm] = useState({ title: '', imageUrl: '', targetUrl: '', isActive: true, regions: [] as string[], targetRole: 'ALL' });

  // Billboards (Uber Eats style banners) State
  const [billboards, setBillboards] = useState<any[]>([]);
  const [loadingBillboards, setLoadingBillboards] = useState(false);
  const [isBillboardModalOpen, setIsBillboardModalOpen] = useState(false);
  const [editingBillboard, setEditingBillboard] = useState<any | null>(null);
  const [billboardForm, setBillboardForm] = useState({ imageUrl: '', linkUrl: '', isActive: true, regions: [] as string[], sortIndex: 0 });

  // Notifications State
  const [notificationForm, setNotificationForm] = useState({ title: '', body: '', targetRole: 'ALL', targetRegion: '' });
  const [isSendingNotification, setIsSendingNotification] = useState(false);

  // Featured / Destacados State
  const [featuredRequests, setFeaturedRequests] = useState<any[]>([]);
  const [loadingFeatured, setLoadingFeatured] = useState(false);
  const [featuredPage, setFeaturedPage] = useState(1);
  const [featuredTotal, setFeaturedTotal] = useState(0);
  const [featuredStatusFilter, setFeaturedStatusFilter] = useState<string>('');
  const [featuredPackages, setFeaturedPackages] = useState<{ days: number; price: number }[]>([]);
  const [featuredPackageInputs, setFeaturedPackageInputs] = useState<{ days: string; price: string }[]>([]);
  const [adminProofPreviewUrl, setAdminProofPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await fetch(`${apiBase}/settings`);
        const data = await response.json();
        if (data.success) {
          setRestaurantWelcomeImage(data.data.restaurantWelcomeImage || '');
          setDriverWelcomeImage(data.data.driverWelcomeImage || '');
          setAdminBankName(data.data.adminBankName || '');
          setAdminBankAccount(data.data.adminBankAccount || '');
          setAdminBankBeneficiary(data.data.adminBankBeneficiary || '');
          setPromoModalEnabled(data.data.promoModalEnabled || false);
          setPromoModalImage(data.data.promoModalImage || '');
          setRestaurantPromoModalEnabled(data.data.restaurantPromoModalEnabled || false);
          setRestaurantPromoModalImage(data.data.restaurantPromoModalImage || '');
        }
      } catch (error) {
        console.error('Error fetching settings:', error);
      }
    };
    fetchSettings();
  }, [apiBase]);

  async function saveBrandSettings() {
    if (isSavingBrandSettings) return;
    setIsSavingBrandSettings(true);
    try {
      const response = await fetch(`${apiBase}/admin/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          restaurantWelcomeImage,
          driverWelcomeImage,
          adminBankName,
          adminBankAccount,
          adminBankBeneficiary,
          promoModalEnabled,
          promoModalImage,
          restaurantPromoModalEnabled,
          restaurantPromoModalImage,
        }),
      });
      const data = await response.json();
      if (data.success) {
        alert('Ajustes guardados correctamente.');
      } else {
        setError(data.error?.message || 'No se pudieron guardar los ajustes.');
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      setError('No se pudieron guardar los ajustes.');
    } finally {
      setIsSavingBrandSettings(false);
    }
  }

  async function saveCategory(category: Partial<StoreCategoryItem>) {
    try {
      const isEdit = !!category.id;
      const url = isEdit ? `/admin/store-categories/${category.id}` : '/admin/store-categories';
      const method = isEdit ? 'PUT' : 'POST';

      const payload = await requestJson<{ success: true; data: StoreCategoryItem }>({
        apiBase,
        path: url,
        token,
        options: {
          method,
          body: JSON.stringify({
            ...category,
            keywords: Array.isArray(category.keywords) ? category.keywords : typeof category.keywords === 'string' ? (category.keywords as string).split(',').map(k => k.trim()).filter(Boolean) : [],
          }),
        },
        fallbackMessage: 'No se pudo guardar la categoria.',
      });

      if (isEdit) {
        setStoreCategories(storeCategories.map(c => c.id === payload.data.id ? payload.data : c));
      } else {
        setStoreCategories([...storeCategories, payload.data]);
      }
      setIsCreateCategoryModalOpen(false);
      setEditingCategory(null);
    } catch (requestError) {
      alert(requestError instanceof Error ? requestError.message : 'No se pudo guardar la categoria.');
    }
  }

  async function deleteCategory(id: string) {
    if (!confirm('¿Estás seguro de eliminar esta categoría?')) return;
    try {
      await requestJson({
        apiBase,
        path: `/admin/store-categories/${id}`,
        token,
        options: { method: 'DELETE' },
        fallbackMessage: 'No se pudo eliminar la categoria.',
      });
      setStoreCategories(storeCategories.filter(c => c.id !== id));
    } catch (requestError) {
      alert(requestError instanceof Error ? requestError.message : 'No se pudo eliminar la categoria.');
    }
  }

  useEffect(() => {
    const savedSession = readStoredSession(storageKey);

    if (savedSession.token) {
      setToken(savedSession.token);
    }

    if (savedSession.user) {
      setSessionUser(savedSession.user);
    }
    
    setIsCheckingSession(false);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const requestedSection = new URLSearchParams(window.location.search).get('section');

    if (
      requestedSection === 'dashboard' ||
      requestedSection === 'restaurants' ||
      requestedSection === 'drivers' ||
      requestedSection === 'users' ||
      requestedSection === 'settings' ||
      requestedSection === 'categories' ||
      requestedSection === 'featured' ||
      requestedSection === 'stuck'
    ) {
      setActiveSection(requestedSection as AdminPortalSection);
    } else {
      const savedSection = localStorage.getItem('adminActiveSection') as AdminPortalSection;
      if (savedSection) {
        setActiveSection(savedSection);
      }
    }
  }, []);

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
    setRestaurants([]);
    setRegions([]);
    setSelectedRegionCode('');
    setSelectedRegion(null);
    setRegionForm(null);
    setCustomerOverview(null);
    setCustomers([]);
    setCustomersTotal(0);
    setSelectedCustomerId('');
    setSelectedCustomer(null);
    setCustomerActionStatus('SUSPENDED');
    setCustomerActionReason('');
    setDriverOverview(null);
    setDrivers([]);
    setDriversTotal(0);
    setSelectedDriverId('');
    setSelectedDriver(null);
    setDriverActionStatus('SUSPENDED');
    setDriverActionReason('');
    setDriverFinanzas(null);
    setSummary({
      total: 0,
      active: 0,
      ownDelivery: 0,
    });
    clearStoredSession(storageKey);
    if (message) {
      setAuthMessage(message);
    }
  }

  async function loginWithPassword() {
    setVerifyingCode(true);
    setError('');
    setAuthMessage('');

    try {
      const payload = await requestJson<AuthResponse>({
        apiBase,
        path: '/auth/admin-login',
        options: {
          method: 'POST',
          body: JSON.stringify({
            phone: phone.trim(),
            password: password.trim(),
          }),
        },
        fallbackMessage: 'No se pudo iniciar sesion.',
      });

      if (payload.data.user.role !== 'ADMIN') {
        clearSession('Tu sesion es valida, pero este panel solo permite administradores.');
        return;
      }

      persistSession(payload.data.token, payload.data.user);
      setAuthMessage(`Sesion iniciada como ${payload.data.user.name}.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo iniciar sesion.');
    } finally {
      setVerifyingCode(false);
    }
  }
  const loadRestaurants = useCallback(async (event?: FormEvent, filtersOverride?: RestaurantFilters) => {
    event?.preventDefault();
    setLoading(true);
    setError('');
    persistApiBase(storageKey, apiBase);

    const activeFilters = filtersOverride || restaurantFilters;

    const params = new URLSearchParams({
      page: '1',
      limit: '50',
    });
    if (activeFilters.search) {
      params.append('search', activeFilters.search);
    }
    if (activeFilters.status) {
      params.append('status', activeFilters.status);
    }
    if (activeFilters.region) {
      params.append('region', activeFilters.region);
    }
    if (activeFilters.businessType) {
      params.append('businessType', activeFilters.businessType);
    }

    try {
      const payload = await requestJson<RestaurantListResponse>({
        apiBase,
        path: `/admin/restaurantes?${params.toString()}`,
        token,
        fallbackMessage: 'No se pudo cargar la informacion.',
      });

      const items = payload.data.items;
      setRestaurants(items);
      setSummary({
        total: payload.data.total,
        active: items.filter((item) => item.status === 'ACTIVE').length,
        ownDelivery: items.filter((item) => item.hasOwnDelivery).length,
      });
    } catch (requestError) {
      setRestaurants([]);
      setSummary({
        total: 0,
        active: 0,
        ownDelivery: 0,
      });
      setError(
        requestError instanceof Error ? requestError.message : 'No se pudo cargar la informacion.'
      );
    } finally {
      setLoading(false);
    }
  }, [apiBase, token, restaurantFilters]);  const loadRegions = useCallback(async () => {
    setLoadingRegions(true);
    setError('');

    try {
      const payload = await requestJson<{ success: true; data: RegionItem[] }>({
        apiBase,
        path: '/admin/regiones',
        token,
        fallbackMessage: 'No se pudo cargar la configuracion de regiones.',
      });

      const items = payload.data;
      setRegions(items);
      setSelectedRegionCode((current) => {
        if (current && items.some((item) => item.code === current)) {
          return current;
        }

        return items[0]?.code || '';
      });
    } catch (requestError) {
      setRegions([]);
      setSelectedRegionCode('');
      setSelectedRegion(null);
      setRegionForm(null);
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'No se pudo cargar la configuracion de regiones.'
      );
    } finally {
      setLoadingRegions(false);
    }
  }, [apiBase, token]);

  const loadStoreCategories = useCallback(async () => {
    setLoadingStoreCategories(true);
    setError('');

    try {
      const payload = await requestJson<{ success: true; data: StoreCategoryItem[] }>({
        apiBase,
        path: '/admin/store-categories',
        token,
        fallbackMessage: 'No se pudieron cargar las categorías de la plataforma.',
      });

      setStoreCategories(payload.data);
    } catch (requestError) {
      setStoreCategories([]);
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'No se pudieron cargar las categorías de la plataforma.'
      );
    } finally {
      setLoadingStoreCategories(false);
    }
  }, [apiBase, token]);

  const loadRestaurantOverview = useCallback(async () => {
    try {
      const payload = await requestJson<RestaurantOverviewResponse>({
        apiBase,
        path: '/admin/restaurantes/overview',
        token,
        fallbackMessage: 'No se pudo cargar el resumen general de restaurantes.',
      });

      setRestaurantOverview(payload.data);
    } catch (requestError) {
      setRestaurantOverview(null);
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'No se pudo cargar el resumen general de restaurantes.'
      );
    }
  }, [apiBase, token]);

  const loadCustomerOverview = useCallback(async () => {
    try {
      const payload = await requestJson<CustomerOverviewResponse>({
        apiBase,
        path: '/admin/usuarios/overview',
        token,
        fallbackMessage: 'No se pudo cargar el resumen general de comensales.',
      });

      setCustomerOverview(payload.data);
    } catch (requestError) {
      setCustomerOverview(null);
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'No se pudo cargar el resumen general de comensales.'
      );
    }
  }, [apiBase, token]);

  const loadCustomers = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      setLoadingCustomers(true);
      setError('');

      const params = new URLSearchParams({
        page: String(customerPage),
        limit: '18',
        sort: customerFilters.sort,
      });

      if (customerFilters.search.trim()) {
        params.set('search', customerFilters.search.trim());
      }

      if (customerFilters.status) {
        params.set('status', customerFilters.status);
      }

      if (customerFilters.risk) {
        params.set('risk', customerFilters.risk);
      }

      if (customerFilters.region.trim()) {
        params.set('region', customerFilters.region.trim());
      }

      try {
        const payload = await requestJson<CustomerListResponse>({
          apiBase,
          path: `/admin/usuarios?${params.toString()}`,
          token,
          fallbackMessage: 'No se pudo cargar la base de comensales.',
        });

        setCustomers(payload.data.items);
        setCustomersTotal(payload.data.total);
        setSelectedCustomerId((current) => {
          if (current && payload.data.items.some((item) => item.id === current)) {
            return current;
          }

          return payload.data.items[0]?.id || '';
        });
      } catch (requestError) {
        setCustomers([]);
        setCustomersTotal(0);
        setSelectedCustomerId('');
        setSelectedCustomer(null);
        setError(
          requestError instanceof Error ? requestError.message : 'No se pudo cargar la base de comensales.'
        );
      } finally {
        setLoadingCustomers(false);
      }
    },
    [apiBase, customerFilters, customerPage, token]
  );

  const loadCustomerDetail = useCallback(
    async (customerUserId: string) => {
      if (!customerUserId) {
        setSelectedCustomer(null);
        return;
      }

      setLoadingCustomerDetail(true);
      setError('');

      try {
        const payload = await requestJson<CustomerDetailResponse>({
          apiBase,
          path: `/admin/usuarios/${customerUserId}`,
          token,
          fallbackMessage: 'No se pudo cargar el detalle del comensal.',
        });

        setSelectedCustomer(payload.data);
        setCustomerActionStatus(
          payload.data.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'
        );
        setCustomerActionReason('');
      } catch (requestError) {
        setSelectedCustomer(null);
        setError(
          requestError instanceof Error ? requestError.message : 'No se pudo cargar el detalle del comensal.'
        );
      } finally {
        setLoadingCustomerDetail(false);
      }
    },
    [apiBase, token]
  );

  const loadDriverOverview = useCallback(async () => {
    try {
      const payload = await requestJson<DriverOverviewResponse>({
        apiBase,
        path: '/admin/repartidores/overview',
        token,
        fallbackMessage: 'No se pudo cargar el resumen de repartidores.',
      });

      setDriverOverview(payload.data);
    } catch (requestError) {
      setDriverOverview(null);
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'No se pudo cargar el resumen de repartidores.'
      );
    }
  }, [apiBase, token]);

  const loadDrivers = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      setLoadingDrivers(true);
      setError('');

      const params = new URLSearchParams({
        page: '1',
        limit: '18',
      });

      if (driverFilters.search.trim()) {
        params.set('search', driverFilters.search.trim());
      }

      if (driverFilters.status) {
        params.set('status', driverFilters.status);
      }

      if (driverFilters.availability) {
        params.set('availability', driverFilters.availability);
      }

      if (driverFilters.region.trim()) {
        params.set('region', driverFilters.region.trim());
      }

      if (driverFilters.debt) {
        params.set('debt', driverFilters.debt);
      }

      try {
        const payload = await requestJson<DriverListResponse>({
          apiBase,
          path: `/admin/repartidores?${params.toString()}`,
          token,
          fallbackMessage: 'No se pudo cargar la base de repartidores.',
        });

        setDrivers(payload.data.items);
        setDriversTotal(payload.data.total);
        setSelectedDriverId((current) => {
          if (current && payload.data.items.some((item) => item.id === current)) {
            return current;
          }

          return payload.data.items[0]?.id || '';
        });
      } catch (requestError) {
        setDrivers([]);
        setDriversTotal(0);
        setSelectedDriverId('');
        setSelectedDriver(null);
        setError(
          requestError instanceof Error ? requestError.message : 'No se pudo cargar la base de repartidores.'
        );
      } finally {
        setLoadingDrivers(false);
      }
    },
    [apiBase, driverFilters, token]
  );

  const loadTickets = useCallback(async () => {
    setLoadingTickets(true);
    setError('');

    try {
      const payload = await requestJson<{ success: true; data: any[] }>({
        apiBase,
        path: '/admin/support/tickets',
        token,
        fallbackMessage: 'No se pudo cargar los reportes.',
      });

      setTickets(payload.data);
    } catch (requestError) {
      setTickets([]);
      setError(
        requestError instanceof Error ? requestError.message : 'No se pudo cargar los reportes.'
      );
    } finally {
      setLoadingTickets(false);
    }
  }, [apiBase, token]);

  useEffect(() => {
    if (activeSection === 'support' && isAdminSession) {
      loadTickets();
    }
  }, [activeSection, isAdminSession, loadTickets]);

  useEffect(() => {
    if (activeSection === 'categories' && isAdminSession) {
      loadStoreCategories();
    }
  }, [activeSection, isAdminSession, loadStoreCategories]);

  const loadDashboardStats = useCallback(async () => {
    setLoadingDashboard(true);
    setError('');
    try {
      const payload = await requestJson<{ success: true; data: any }>({
        apiBase,
        path: '/admin/dashboard-stats',
        token,
        fallbackMessage: 'No se pudieron cargar las estadísticas del dashboard.',
      });
      setDashboardStats(payload.data);
    } catch (requestError) {
      setDashboardStats(null);
      setError(
        requestError instanceof Error ? requestError.message : 'No se pudieron cargar las estadísticas del dashboard.'
      );
    } finally {
      setLoadingDashboard(false);
    }
  }, [apiBase, token]);

  useEffect(() => {
    if (activeSection === 'dashboard' && isAdminSession) {
      loadDashboardStats();
      const interval = setInterval(() => {
        void loadDashboardStats();
      }, 30000);
      return () => clearInterval(interval);
    }
  }, [activeSection, isAdminSession, loadDashboardStats]);

  const confirmSettlementFromDashboard = async (settlementId: string) => {
    try {
      const response = await fetch(`${apiBase}/admin/billing/settlements/${settlementId}/confirm`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (data.success) {
        void loadDashboardStats();
        void loadRestaurants();
      } else {
        alert(data.error?.message || 'No se pudo confirmar el pago.');
      }
    } catch (error) {
      console.error(error);
      alert('Error de red al confirmar el pago.');
    }
  };

  const rejectSettlementFromDashboard = async (settlementId: string) => {
    if (!confirm('¿Estás seguro de rechazar este comprobante? Volverá al estado PENDING.')) {
      return;
    }
    try {
      const response = await fetch(`${apiBase}/admin/billing/settlements/${settlementId}/reject`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (data.success) {
        void loadDashboardStats();
        void loadRestaurants();
      } else {
        alert(data.error?.message || 'No se pudo rechazar el comprobante.');
      }
    } catch (error) {
      console.error(error);
      alert('Error de red al rechazar el comprobante.');
    }
  };

  const resolveTicketFromDashboard = async (ticketId: string, responseText: string) => {
    if (!responseText.trim()) {
      alert('Por favor escribe una respuesta.');
      return;
    }
    setDashboardSubmittingTicketId(ticketId);
    try {
      const response = await fetch(`${apiBase}/admin/support/tickets/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ 
          status: 'RESOLVED',
          response: responseText.trim(),
        }),
      });
      const data = await response.json();
      if (data.success) {
        setDashboardTicketResponse(prev => {
          const next = { ...prev };
          delete next[ticketId];
          return next;
        });
        void loadDashboardStats();
        void loadTickets();
      } else {
        alert(data.error?.message || 'No se pudo resolver el ticket.');
      }
    } catch (error) {
      console.error(error);
      alert('Error de red al resolver el ticket.');
    } finally {
      setDashboardSubmittingTicketId(null);
    }
  };

  const loadPlatformRequests = useCallback(async () => {
    setLoadingPlatformRequests(true);
    setError('');

    try {
      const payload = await requestJson<{ success: true; data: any[] }>({
        apiBase,
        path: '/admin/solicitudes',
        token,
        fallbackMessage: 'No se pudo cargar las solicitudes de afiliación.',
      });

      setPlatformRequests(payload.data);
    } catch (requestError) {
      setPlatformRequests([]);
      setError(
        requestError instanceof Error ? requestError.message : 'No se pudo cargar las solicitudes de afiliación.'
      );
    } finally {
      setLoadingPlatformRequests(false);
    }
  }, [apiBase, token]);

  const approvePlatformRequest = async (requestId: string, reqRegion: string, reqPassword?: string) => {
    if (!reqRegion) {
      setError('La región es obligatoria para la aprobación.');
      return;
    }
    setIsSubmittingApproval(true);
    setError('');
    try {
      await requestJson<{ success: true; data: any }>({
        apiBase,
        path: `/admin/solicitudes/${requestId}/approve`,
        token,
        options: {
          method: 'POST',
          body: JSON.stringify({
            region: reqRegion,
            password: reqPassword || 'sadel123'
          })
        },
        fallbackMessage: 'No se pudo aprobar la solicitud.',
      });
      
      await loadPlatformRequests();
      void loadRestaurants();
      void loadDrivers();
      void loadDashboardStats();

      setIsApproveRequestModalOpen(false);
      setSelectedRequestId(null);
    } catch (requestError: any) {
      setError(
        requestError instanceof Error ? requestError.message : 'No se pudo aprobar la solicitud.'
      );
    } finally {
      setIsSubmittingApproval(false);
    }
  };

  const rejectPlatformRequest = async (requestId: string) => {
    if (!window.confirm('¿Estás seguro de que deseas rechazar esta solicitud?')) {
      return;
    }
    setIsSubmittingRejection(true);
    setError('');
    try {
      await requestJson<{ success: true; data: any }>({
        apiBase,
        path: `/admin/solicitudes/${requestId}/reject`,
        token,
        options: {
          method: 'POST',
        },
        fallbackMessage: 'No se pudo rechazar la solicitud.',
      });

      await loadPlatformRequests();
      void loadDashboardStats();
      setSelectedRequestId(null);
    } catch (requestError: any) {
      setError(
        requestError instanceof Error ? requestError.message : 'No se pudo rechazar la solicitud.'
      );
    } finally {
      setIsSubmittingRejection(false);
    }
  };

  const loadOrders = useCallback(async () => {
    if (!token) return;
    try {
      setLoadingOrders(true);
      const query = new URLSearchParams({
        page: String(ordersPage),
        limit: '20',
      });
      if (orderFilters.status) query.set('status', orderFilters.status);
      if (orderFilters.noDriversAvailable) query.set('noDriversAvailable', orderFilters.noDriversAvailable);
      if (orderFilters.date) query.set('date', orderFilters.date);

      const data = await requestJson<{ success: true; data: { orders: OrderItem[]; meta: { total: number } } }>({
        apiBase,
        path: `/admin/orders?${query}`,
        token,
        fallbackMessage: 'No se pudieron cargar los pedidos.',
      });
      setOrders(data.data.orders);
      setOrdersTotal(data.data.meta.total);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingOrders(false);
    }
  }, [apiBase, token, ordersPage, orderFilters]);

  useEffect(() => {
    if (activeSection === 'orders' && isAdminSession && ordersAutoRefresh) {
      loadOrders();
      const interval = setInterval(() => {
        void loadOrders();
      }, 15000);
      return () => clearInterval(interval);
    }
  }, [activeSection, isAdminSession, ordersAutoRefresh, loadOrders]);

  const loadOrderDetail = useCallback(async (id: string) => {
    if (!token || !id) return;
    try {
      setLoadingOrderDetail(true);
      const data = await requestJson<{ success: true; data: OrderDetail }>({
        apiBase,
        path: `/admin/orders/${id}`,
        token,
        fallbackMessage: 'No se pudo cargar el detalle del pedido.',
      });
      setSelectedOrder(data.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingOrderDetail(false);
    }
  }, [apiBase, token]);

  const handleCancelOrder = async (id: string) => {
    if (!confirm('¿Estás seguro de forzar la cancelación de este pedido? Esto registrará una auditoría.')) return;
    try {
      await requestJson({
        apiBase,
        path: `/admin/orders/${id}/cancel`,
        token,
        options: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'Cancelado por el Administrador desde el Panel Web' }),
        },
        fallbackMessage: 'No se pudo cancelar el pedido.',
      });
      alert('Pedido cancelado exitosamente');
      loadOrderDetail(id);
      loadOrders();
    } catch (e: any) {
      alert(e.message || 'Error de conexión');
    }
  };

  const handleReassignOrder = async (id: string) => {
    if (!confirm('¿Estás seguro de liberar este pedido para reasignación? El repartidor actual será removido.')) return;
    try {
      await requestJson({
        apiBase,
        path: `/admin/orders/${id}/reassign`,
        token,
        options: {
          method: 'POST',
        },
        fallbackMessage: 'No se pudo reasignar el pedido.',
      });
      alert('Pedido liberado exitosamente. Se buscará un nuevo repartidor.');
      loadOrderDetail(id);
      loadOrders();
    } catch (e: any) {
      alert(e.message || 'Error de conexión');
    }
  };

  const loadPromotions = useCallback(async () => {
    setLoadingPromotions(true);
    try {
      const payload = await requestJson<{ success: boolean, data: any[] }>({
        apiBase,
        path: '/admin/promotions',
        token,
        fallbackMessage: 'Error cargando promociones.',
      });
      if (payload.success) setPromotions(payload.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingPromotions(false);
    }
  }, [apiBase, token]);

  const savePromotion = async () => {
    try {
      const isEdit = !!editingPromo?.id;
      const url = isEdit ? `/admin/promotions/${editingPromo.id}` : '/admin/promotions';
      const method = isEdit ? 'PATCH' : 'POST';

      const payload = await requestJson<{ success: boolean, data: any }>({
        apiBase,
        path: url,
        token,
        options: {
          method,
          body: JSON.stringify({ ...promoForm, targetUrl: promoForm.targetUrl || null }),
        },
        fallbackMessage: 'Error guardando promoción.',
      });
      if (payload.success) {
        setIsPromoModalOpen(false);
        loadPromotions();
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  const deletePromotion = async (id: string) => {
    if (!confirm('¿Estás seguro de eliminar esta promoción?')) return;
    try {
      await requestJson({
        apiBase,
        path: `/admin/promotions/${id}`,
        token,
        options: { method: 'DELETE' },
        fallbackMessage: 'Error eliminando promoción.',
      });
      loadPromotions();
    } catch (e: any) {
      alert(e.message);
    }
  };

  useEffect(() => {
    if (activeSection === 'promotions' && isAdminSession) {
      loadPromotions();
    }
  }, [activeSection, isAdminSession, loadPromotions]);

  const loadBillboards = useCallback(async () => {
    setLoadingBillboards(true);
    try {
      const payload = await requestJson<{ success: boolean, data: any[] }>({
        apiBase,
        path: '/admin/billboards',
        token,
        fallbackMessage: 'Error cargando billboards.',
      });
      if (payload.success) setBillboards(payload.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingBillboards(false);
    }
  }, [apiBase, token]);

  const saveBillboard = async () => {
    try {
      const isEdit = !!editingBillboard?.id;
      const url = isEdit ? `/admin/billboards/${editingBillboard.id}` : '/admin/billboards';
      const method = isEdit ? 'PATCH' : 'POST';

      const payload = await requestJson<{ success: boolean, data: any }>({
        apiBase,
        path: url,
        token,
        options: {
          method,
          body: JSON.stringify({ ...billboardForm, linkUrl: billboardForm.linkUrl || null }),
        },
        fallbackMessage: 'Error guardando billboard.',
      });
      if (payload.success) {
        setIsBillboardModalOpen(false);
        loadBillboards();
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  const deleteBillboard = async (id: string) => {
    if (!confirm('¿Estás seguro de eliminar este banner?')) return;
    try {
      await requestJson({
        apiBase,
        path: `/admin/billboards/${id}`,
        token,
        options: { method: 'DELETE' },
        fallbackMessage: 'Error eliminando banner.',
      });
      loadBillboards();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const toggleBillboardActive = async (billboard: any) => {
    try {
      await requestJson({
        apiBase,
        path: `/admin/billboards/${billboard.id}`,
        token,
        options: {
          method: 'PATCH',
          body: JSON.stringify({ isActive: !billboard.isActive }),
        },
        fallbackMessage: 'Error actualizando banner.',
      });
      loadBillboards();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const moveBillboard = async (billboard: any, direction: -1 | 1) => {
    const sorted = [...billboards].sort((a, b) => a.sortIndex - b.sortIndex);
    const index = sorted.findIndex((b) => b.id === billboard.id);
    const swapIndex = index + direction;
    if (index === -1 || swapIndex < 0 || swapIndex >= sorted.length) return;
    const target = sorted[swapIndex];
    const aIndex = billboard.sortIndex ?? index;
    const bIndex = target.sortIndex ?? swapIndex;
    try {
      await requestJson({
        apiBase,
        path: `/admin/billboards/${billboard.id}`,
        token,
        options: { method: 'PATCH', body: JSON.stringify({ sortIndex: bIndex }) },
        fallbackMessage: 'Error reordenando banner.',
      });
      await requestJson({
        apiBase,
        path: `/admin/billboards/${target.id}`,
        token,
        options: { method: 'PATCH', body: JSON.stringify({ sortIndex: aIndex }) },
        fallbackMessage: 'Error reordenando banner.',
      });
      loadBillboards();
    } catch (e: any) {
      alert(e.message);
    }
  };

  useEffect(() => {
    if (activeSection === 'billboards' && isAdminSession) {
      loadBillboards();
    }
  }, [activeSection, isAdminSession, loadBillboards]);

  const loadFeaturedRequests = useCallback(async () => {
    setLoadingFeatured(true);
    try {
      const params = new URLSearchParams({ page: String(featuredPage), limit: '10' });
      if (featuredStatusFilter) params.set('status', featuredStatusFilter);
      const res = await fetch(`${apiBase}/admin/featured/requests?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setFeaturedRequests(data.data.items);
        setFeaturedTotal(data.data.total);
      }
    } catch { /* ignore */ }
    finally { setLoadingFeatured(false); }
  }, [apiBase, token, featuredPage, featuredStatusFilter]);

  const loadFeaturedSettings = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/admin/featured/settings`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        const pkgs: { days: number; price: number }[] = data.data.packages || [];
        setFeaturedPackages(pkgs);
        setFeaturedPackageInputs(pkgs.map(p => ({ days: String(p.days), price: String(p.price) })));
      }
    } catch { /* ignore */ }
  }, [apiBase, token]);

  useEffect(() => {
    if (activeSection === 'featured' && isAdminSession) {
      loadFeaturedRequests();
      loadFeaturedSettings();
    }
  }, [activeSection, isAdminSession, loadFeaturedRequests, loadFeaturedSettings]);

  useEffect(() => {
    if (activeSection === 'requests' && isAdminSession) {
      void loadPlatformRequests();
    }
  }, [activeSection, isAdminSession, loadPlatformRequests]);

  const loadDriverDetail = useCallback(
    async (driverId: string) => {
      if (!driverId) {
        setSelectedDriver(null);
        return;
      }

      setLoadingDriverDetail(true);
      setError('');

      try {
        const payload = await requestJson<DriverDetailResponse>({
          apiBase,
          path: `/admin/repartidores/${driverId}`,
          token,
          fallbackMessage: 'No se pudo cargar el detalle del repartidor.',
        });

        const settlementsPayload = await requestJson<{ success: boolean; data: any[] }>({
          apiBase,
          path: `/admin/repartidores/${driverId}/settlements`,
          token,
          fallbackMessage: 'No se pudo cargar el historial de pagos.',
        }).catch(() => ({ data: [] }));

        setSelectedDriver(payload.data);
        setDriverSettlements(settlementsPayload.data || []);
        setDriverBillingFee(payload.data.platformFeePerOrder || 0);
        setDriverActionStatus(payload.data.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE');
        setDriverActionReason('');
      } catch (requestError) {
        setSelectedDriver(null);
        setError(
          requestError instanceof Error ? requestError.message : 'No se pudo cargar el detalle del repartidor.'
        );
      } finally {
        setLoadingDriverDetail(false);
      }
    },
    [apiBase, token]
  );
  const loadDriverOrderHistory = useCallback(
    async (driverId: string, pageNum: number = 1, append: boolean = false) => {
      if (!driverId) return;
      setLoadingDriverOrderHistory(true);
      try {
        const payload = await requestJson<{ success: boolean; data: { items: any[]; total: number; hasMore: boolean } }>({
          apiBase,
          path: `/admin/repartidores/${driverId}/orders?page=${pageNum}&limit=20`,
          token,
          fallbackMessage: 'No se pudo cargar el historial.',
        });
        if (append) {
          setDriverOrderHistory(prev => [...prev, ...payload.data.items]);
        } else {
          setDriverOrderHistory(payload.data.items);
        }
        setDriverOrderHistoryTotal(payload.data.total);
        setDriverOrderHistoryPage(pageNum);
        setDriverOrderHistoryHasMore(payload.data.hasMore);
      } catch {
        if (!append) setDriverOrderHistory([]);
        setDriverOrderHistoryTotal(0);
      } finally {
        setLoadingDriverOrderHistory(false);
      }
    },
    [apiBase, token]
  );

  const loadDriverFinanzas = useCallback(async (driverId: string) => {
    if (!driverId) return;
    setLoadingDriverFinanzas(true);
    try {
      const payload = await requestJson<{ success: boolean; data: any }>({
        apiBase,
        path: `/admin/repartidores/${driverId}/finanzas`,
        token,
        fallbackMessage: 'No se pudo cargar la información financiera.',
      });
      setDriverFinanzas(payload.data);
    } catch {
      setDriverFinanzas(null);
    } finally {
      setLoadingDriverFinanzas(false);
    }
  }, [apiBase, token]);

  async function submitNotificationBroadcast(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !sessionUser || sessionUser.role !== 'ADMIN') return;

    if (!notificationForm.title.trim() || !notificationForm.body.trim()) {
      alert('Por favor ingresa un título y un mensaje');
      return;
    }

    setIsSendingNotification(true);
    try {
      const response = await fetch(`${apiBase}/admin/notifications/broadcast`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(notificationForm),
      });

      const data = await response.json();
      if (data.success) {
        alert(`Difusión exitosa. Notificando a ${data.data.targetedUsers} usuarios.`);
        setNotificationForm({ title: '', body: '', targetRole: 'ALL', targetRegion: '' });
      } else {
        alert(data.error?.message || 'Error al enviar notificación');
      }
    } catch (err) {
      console.error(err);
      alert('Error de conexión al enviar notificación');
    } finally {
      setIsSendingNotification(false);
    }
  }

  useEffect(() => {
    if (!token || !sessionUser || sessionUser.role !== 'ADMIN') {
      return;
    }

    void loadRestaurants();
    void loadRestaurantOverview();
    void loadRegions();
    void loadCustomerOverview();
    void loadCustomers();
    void loadDriverOverview();
    void loadDrivers();
    void loadPlatformRequests();
    void loadOrders();
  }, [
    loadDriverOverview,
    loadDrivers,
    loadCustomerOverview,
    loadCustomers,
    loadRegions,
    loadRestaurantOverview,
    loadRestaurants,
    loadPlatformRequests,
    loadOrders,
    token,
    sessionUser,
  ]);

  // Reactive: re-fetch drivers when dropdown filters change (not search text)
  const prevDropdownFilters = useRef({ status: '', availability: '', region: '', debt: '' });
  useEffect(() => {
    if (!token || !sessionUser) return;
    const prev = prevDropdownFilters.current;
    const changed =
      prev.status !== driverFilters.status ||
      prev.availability !== driverFilters.availability ||
      prev.region !== driverFilters.region ||
      prev.debt !== driverFilters.debt;
    if (changed) {
      prevDropdownFilters.current = {
        status: driverFilters.status,
        availability: driverFilters.availability,
        region: driverFilters.region,
        debt: driverFilters.debt,
      };
      void loadDrivers();
    }
  }, [driverFilters.status, driverFilters.availability, driverFilters.region, driverFilters.debt, loadDrivers, token, sessionUser]);

  useEffect(() => {
    if (selectedOrderId) {
      void loadOrderDetail(selectedOrderId);
    } else {
      setSelectedOrder(null);
    }
  }, [selectedOrderId, loadOrderDetail]);

  useEffect(() => {
    if (!selectedRegionCode) {
      setSelectedRegion(null);
      setRegionForm(null);
      return;
    }

    const nextRegion = regions.find((item) => item.code === selectedRegionCode) || null;
    setSelectedRegion(nextRegion);
    setRegionForm(nextRegion ? createRegionEditFormState(nextRegion) : null);
  }, [regions, selectedRegionCode]);

  useEffect(() => {
    if (!token || !sessionUser || sessionUser.role !== 'ADMIN' || !selectedCustomerId) {
      return;
    }

    void loadCustomerDetail(selectedCustomerId);
  }, [loadCustomerDetail, selectedCustomerId, sessionUser, token]);

  useEffect(() => {
    if (!token || !sessionUser || sessionUser.role !== 'ADMIN' || !selectedDriverId) {
      return;
    }

    void loadDriverDetail(selectedDriverId);
    void loadDriverFinanzas(selectedDriverId);
    setShowDriverOrderHistory(false);
    setDriverOrderHistory([]);
  }, [loadDriverDetail, loadDriverFinanzas, selectedDriverId, sessionUser, token]);

  async function saveRegionChanges(event: FormEvent) {
    event.preventDefault();

    if (!selectedRegion || !regionForm) {
      return;
    }

    setSavingRegion(true);
    setError('');
    setAuthMessage('');

    const baseDeliveryFee = parseRequiredDecimal(regionForm.baseDeliveryFee);
    const deliveryRadius = parseRequiredDecimal(regionForm.deliveryRadius);
    if (!Number.isFinite(baseDeliveryFee) || !Number.isFinite(deliveryRadius)) {
      setError('Los valores numericos no son validos.');
      setSavingRegion(false);
      return;
    }

    try {
      const payload = await requestJson<{ success: true; data: RegionItem }>({
        apiBase,
        path: `/admin/regiones/${selectedRegion.code}`,
        token,
        options: {
          method: 'PATCH',
          body: JSON.stringify({
            baseDeliveryFee,
            deliveryRadius,
            isActive: regionForm.isActive,
            pricingModel: regionForm.pricingModel,
            ...(regionForm.pricingModel === 'distance' ? {
              baseRate: parseRequiredDecimal(regionForm.baseRate),
              perKmRate: parseRequiredDecimal(regionForm.perKmRate),
              minDeliveryFee: parseRequiredDecimal(regionForm.minDeliveryFee),
              maxDeliveryFee: parseRequiredDecimal(regionForm.maxDeliveryFee),
            } : {}),
          }),
        },
        fallbackMessage: 'No se pudo guardar la configuracion de la region.',
      });

      setRegions((current) =>
        current.map((item) => (item.code === payload.data.code ? payload.data : item))
      );
      setAuthMessage(`Region ${payload.data.name} actualizada.`);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'No se pudo guardar la configuracion de la region.'
      );
    } finally {
      setSavingRegion(false);
    }
  }

  function openCreateRestaurantModal() {
    setCreateRestaurantForm(
      createRestaurantFormState(getPreferredRestaurantRegionCode(regions, selectedRegionCode))
    );
    setAuthMessage('');
    setError('');
    setIsCreateRestaurantOpen(true);
  }

  function closeCreateRestaurantModal() {
    setIsCreateRestaurantOpen(false);
    setCreateRestaurantForm(createRestaurantFormState(getPreferredRestaurantRegionCode(regions, selectedRegionCode)));
  }

  async function createRestaurant(event: FormEvent) {
    event.preventDefault();

    setCreatingRestaurant(true);
    setError('');
    setAuthMessage('');

    const normalizedPhone = normalizeCredentialPhone(createRestaurantForm.username);
    const fallbackEmail = buildLocalRestaurantEmail(normalizedPhone);
    const restaurantName = createRestaurantForm.restaurantName.trim();
    const serviceFee = parseRequiredDecimal(createRestaurantForm.serviceFee);
    const platformFeePerOrder = parseRequiredDecimal(createRestaurantForm.platformFeePerOrder);

    if (normalizedPhone.length < 8) {
      setError('Captura un telefono valido para el acceso del restaurante.');
      setCreatingRestaurant(false);
      return;
    }

    if (!Number.isFinite(serviceFee) || serviceFee < 0) {
      setError('Captura un costo de servicio valido.');
      setCreatingRestaurant(false);
      return;
    }

    if (!Number.isFinite(platformFeePerOrder) || platformFeePerOrder < 0) {
      setError('Captura un costo de uso de plataforma valido.');
      setCreatingRestaurant(false);
      return;
    }

    try {
      await requestJson<{ success: true; data: RestaurantItem }>({
        apiBase,
        path: '/admin/restaurantes',
        token,
        options: {
          method: 'POST',
          body: JSON.stringify({
            ownerName: restaurantName,
            ownerPhone: normalizedPhone,
            password: createRestaurantForm.password.trim(),
            name: restaurantName,
            description: `Restaurante ${restaurantName} creado desde el panel administrativo.`,
            address: 'Dirección pendiente de registro',
            latitude: 0,
            longitude: 0,
            region: createRestaurantForm.region.trim(),
            contactPhone: normalizedPhone,
            email: fallbackEmail,
            serviceFee,
            platformFeePerOrder,
            hasOwnDelivery: false,
            minDeliveryTime: 30,
            maxDeliveryTime: 45,
            billingCycle: 'WEEKLY',
            platformFeeRate: 0,
            billingContactEmail: fallbackEmail,
            businessType: createRestaurantForm.businessType,
          }),
        },
        fallbackMessage: 'No se pudo crear el restaurante.',
      });

      await Promise.all([loadRestaurants(), loadRestaurantOverview()]);
      closeCreateRestaurantModal();
      setAuthMessage(
        `Restaurante ${restaurantName} creado correctamente. Permanecera oculto al cliente hasta que el negocio active su toggle de abierto.`
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : 'No se pudo crear el restaurante.'
      );
    } finally {
      setCreatingRestaurant(false);
    }
  }

  function openCreateRegionModal() {
    setCreateRegionForm(createRegionFormState());
    setAuthMessage('');
    setError('');
    setIsCreateRegionOpen(true);
  }

  function closeCreateRegionModal() {
    setIsCreateRegionOpen(false);
    setCreateRegionForm(createRegionFormState());
  }

  async function createRegion(event: FormEvent) {
    event.preventDefault();

    setCreatingRegion(true);
    setError('');
    setAuthMessage('');

    const nextRegionCode = buildRegionCode({
      state: createRegionForm.state,
      city: createRegionForm.city,
      country: createRegionForm.country,
    });

    try {
      const payload = await requestJson<{ success: true; data: RegionItem }>({
        apiBase,
        path: '/admin/regiones',
        token,
        options: {
          method: 'POST',
          body: JSON.stringify({
            code: nextRegionCode,
            name: createRegionForm.name.trim(),
            country: createRegionForm.country.trim(),
            state: createRegionForm.state.trim(),
            city: createRegionForm.city.trim(),
            baseDeliveryFee: parseRequiredDecimal(createRegionForm.baseDeliveryFee),
            deliveryRadius: parseRequiredDecimal(createRegionForm.deliveryRadius),
            supportedPayments: parseSupportedPayments(createRegionForm.supportedPayments),
            isActive: createRegionForm.isActive,
            pricingModel: createRegionForm.pricingModel,
            ...(createRegionForm.pricingModel === 'distance' ? {
              baseRate: parseRequiredDecimal(createRegionForm.baseRate),
              perKmRate: parseRequiredDecimal(createRegionForm.perKmRate),
              minDeliveryFee: parseRequiredDecimal(createRegionForm.minDeliveryFee),
              maxDeliveryFee: parseRequiredDecimal(createRegionForm.maxDeliveryFee),
            } : {}),
          }),
        },
        fallbackMessage: 'No se pudo crear la zona.',
      });

      setRegions((current) => sortRegionsByName([...current, payload.data]));
      setSelectedRegionCode(payload.data.code);
      setCreateRestaurantForm((current) => ({ ...current, region: payload.data.code }));
      closeCreateRegionModal();
      setAuthMessage(`Zona ${payload.data.name} creada correctamente.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo crear la zona.');
    } finally {
      setCreatingRegion(false);
    }
  }

  async function updateCustomerStatus(event: FormEvent) {
    event.preventDefault();

    if (!selectedCustomer) {
      return;
    }

    setUpdatingCustomerStatus(true);
    setError('');
    setAuthMessage('');

    try {
      const payload = await requestJson<{
        success: true;
        data: { id: string; name: string; status: UserAccountStatus; reason?: string | null };
      }>({
        apiBase,
        path: `/admin/usuarios/${selectedCustomer.id}/status`,
        token,
        options: {
          method: 'POST',
          body: JSON.stringify({
            status: customerActionStatus,
            reason: customerActionReason.trim() || undefined,
          }),
        },
        fallbackMessage: 'No se pudo actualizar el estado del comensal.',
      });

      await Promise.all([
        loadCustomers(),
        loadCustomerOverview(),
        loadCustomerDetail(selectedCustomer.id),
      ]);
      setAuthMessage(
        `Cuenta de ${payload.data.name} actualizada a ${getUserStatusLabel(payload.data.status).toLowerCase()}.`
      );
      setCustomerActionReason('');
      setCustomerActionStatus(payload.data.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE');
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'No se pudo actualizar el estado del comensal.'
      );
    } finally {
      setUpdatingCustomerStatus(false);
    }
  }

  function openCreateDriverModal() {
    setCreateDriverForm(createDriverFormState(getPreferredRestaurantRegionCode(regions, selectedRegionCode)));
    setAuthMessage('');
    setError('');
    setIsCreateDriverOpen(true);
  }

  function closeCreateDriverModal() {
    setIsCreateDriverOpen(false);
    setCreateDriverForm(createDriverFormState(getPreferredRestaurantRegionCode(regions, selectedRegionCode)));
  }

  async function createDriver(event: FormEvent) {
    event.preventDefault();

    setCreatingDriver(true);
    setError('');
    setAuthMessage('');

    try {
      const payload = await requestJson<{ success: true; data: { id: string; user: { name: string } } }>({
        apiBase,
        path: '/admin/repartidores',
        token,
        options: {
          method: 'POST',
          body: JSON.stringify({
            name: createDriverForm.name.trim(),
            phone: normalizeCredentialPhone(createDriverForm.phone),
            email: createDriverForm.email.trim() || undefined,
            password: createDriverForm.password.trim(),
            region: createDriverForm.region.trim(),
            documentNumber: createDriverForm.documentNumber.trim(),
            documentType: createDriverForm.documentType.trim(),
            bankAccount: createDriverForm.bankAccount.trim() || undefined,
            licenseExpiry: createDriverForm.licenseExpiry
              ? new Date(createDriverForm.licenseExpiry).toISOString()
              : undefined,
            platformFeePerOrder: parseFloat(createDriverForm.platformFeePerOrder || '0'),
            status: createDriverForm.status,
            availability: createDriverForm.availability,
          }),
        },
        fallbackMessage: 'No se pudo crear el repartidor.',
      });

      await Promise.all([loadDrivers(), loadDriverOverview()]);
      setSelectedDriverId(payload.data.id);
      closeCreateDriverModal();
      setAuthMessage(`Repartidor ${payload.data.user.name} creado correctamente.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo crear el repartidor.');
    } finally {
      setCreatingDriver(false);
    }
  }

  
  async function updateDriverBilling(event?: React.FormEvent, settleDebt: boolean = false) {
    if (event) event.preventDefault();
    if (!token || !selectedDriverId) return;

    setUpdatingDriverBilling(true);
    try {
      await requestJson({
        apiBase,
        path: `/admin/repartidores/${selectedDriverId}/billing`,
        token,
        options: {
          method: 'PUT',
          body: JSON.stringify({
            platformFeePerOrder: settleDebt ? undefined : Number(driverBillingFee),
            settleDebt,
          }),
        }
      });
      await loadDriverDetail(selectedDriverId);
      await loadDriverFinanzas(selectedDriverId);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Error al actualizar finanzas del repartidor.');
    } finally {
      setUpdatingDriverBilling(false);
    }
  }

  const loadCustomerSettlements = useCallback(async () => {
    if (!token) return;
    setLoadingCustomerSettlements(true);
    try {
      const query = customerSettlementFilter
        ? `?status=${encodeURIComponent(customerSettlementFilter)}`
        : '';
      const payload = await requestJson<{ success: true; data: { settlements: any[]; total: number } }>({
        apiBase,
        path: `/admin/customer-settlements${query}`,
        token,
        fallbackMessage: 'No se pudieron cargar las deudas de clientes.',
      });
      if (payload.success) {
        setCustomerSettlements(payload.data.settlements || []);
        setCustomerSettlementsTotal(payload.data.total || 0);
      }
    } catch (err) {
      console.error('Failed to load customer settlements:', err);
    } finally {
      setLoadingCustomerSettlements(false);
    }
  }, [apiBase, token, customerSettlementFilter]);

  useEffect(() => {
    if (activeSection === 'customer-debts' && isAdminSession) {
      void loadCustomerSettlements();
    }
  }, [activeSection, isAdminSession, customerSettlementFilter, loadCustomerSettlements]);

  async function updateCustomerSettlementStatus(settlementId: string, status: 'PAID' | 'REJECTED') {
    if (!token) return;
    const confirmMsg = status === 'PAID'
      ? '¿Aprobar este pago? Se reactivará la cuenta del cliente automáticamente.'
      : '¿Rechazar este comprobante? El cliente podrá subir uno nuevo.';
    if (!confirm(confirmMsg)) return;

    setCustomerSettlementActionLoading(settlementId);
    try {
      const payload = await requestJson<{ success: boolean }>({
        apiBase,
        path: `/admin/customer-settlements/${settlementId}`,
        token,
        options: {
          method: 'PATCH',
          body: JSON.stringify({ status }),
        },
        fallbackMessage: 'No se pudo actualizar el estado de la deuda.',
      });
      if (payload.success) {
        await loadCustomerSettlements();
      }
    } catch (err) {
      alert('Error: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setCustomerSettlementActionLoading(null);
    }
  }

  async function updateSettlementStatus(settlementId: string, status: 'PAID' | 'REJECTED' | 'REVERT') {
    if (!token || !selectedDriverId) return;
    const confirmMsg = status === 'PAID'
      ? '¿Aprobar este pago? Se reactivará la cuenta del repartidor automáticamente.'
      : status === 'REJECTED'
      ? '¿Rechazar este comprobante? El repartidor podrá subir uno nuevo.'
      : '¿Revertir este pago? La deuda volverá a estado PENDIENTE y el repartidor deberá pagar nuevamente.';
    if (!confirm(confirmMsg)) return;

    setSettlementActionLoading(settlementId);
    try {
      const payload = await requestJson<{ success: boolean }>({
        apiBase,
        path: `/admin/repartidores/${selectedDriverId}/settlements/${settlementId}/status`,
        token,
        options: {
          method: 'PUT',
          body: JSON.stringify({ status })
        },
        fallbackMessage: 'No se pudo actualizar el comprobante.'
      });
      if (payload.success) {
        await loadDriverDetail(selectedDriverId);
        await loadDriverFinanzas(selectedDriverId);
      }
    } catch (err) {
      alert('Error: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSettlementActionLoading(null);
    }
  }

  async function updateDriverStatus(event: FormEvent) {
    event.preventDefault();

    if (!selectedDriver) {
      return;
    }

    setUpdatingDriverStatus(true);
    setError('');
    setAuthMessage('');

    try {
      const payload = await requestJson<{
        success: true;
        data: { id: string; user: { name: string }; status: DriverAccountStatus; reason?: string | null };
      }>({
        apiBase,
        path: `/admin/repartidores/${selectedDriver.id}/status`,
        token,
        options: {
          method: 'POST',
          body: JSON.stringify({
            status: driverActionStatus,
            reason: driverActionReason.trim() || undefined,
          }),
        },
        fallbackMessage: 'No se pudo actualizar el estado del repartidor.',
      });

      await Promise.all([loadDrivers(), loadDriverOverview(), loadDriverDetail(selectedDriver.id), loadDriverFinanzas(selectedDriver.id)]);
      setAuthMessage(
        `Estado de ${payload.data.user.name} actualizado a ${getDriverStatusLabel(payload.data.status).toLowerCase()}.`
      );
      setDriverActionReason('');
      setDriverActionStatus(payload.data.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE');
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'No se pudo actualizar el estado del repartidor.'
      );
    } finally {
      setUpdatingDriverStatus(false);
    }
  }

  async function removeDriver() {
    if (!selectedDriver) {
      return;
    }

    setRemovingDriver(true);
    setError('');
    setAuthMessage('');

    try {
      const payload = await requestJson<{
        success: true;
        data: { id: string; user: { name: string }; deleted: boolean };
      }>({
        apiBase,
        path: `/admin/repartidores/${selectedDriver.id}`,
        token,
        options: {
          method: 'DELETE',
          body: JSON.stringify({
            reason: driverActionReason.trim() || 'Baja administrativa.',
          }),
        },
        fallbackMessage: 'No se pudo dar de baja al repartidor.',
      });

      await Promise.all([loadDrivers(), loadDriverOverview()]);
      setSelectedDriverId('');
      setSelectedDriver(null);
      setDriverActionReason('');
      setAuthMessage(`Repartidor ${payload.data.user.name} dado de baja logicamente.`);
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : 'No se pudo dar de baja al repartidor.'
      );
    } finally {
      setRemovingDriver(false);
    }
  }

  if (isCheckingSession) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#f7f4ec]">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-neutral-300 border-t-neutral-900" />
      </div>
    );
  }

  if (!isAdminSession) {
    return (
      <main className="flex h-dvh flex-col bg-[#f7f4ec] p-4 text-neutral-900 md:p-6">
        <div className="mx-auto flex h-full max-w-[1540px] flex-col">
          <header className="flex shrink-0 items-center justify-center border-b border-black/5 bg-white/80 px-4 py-5 backdrop-blur">
            <p className="text-3xl font-semibold tracking-[-0.05em] text-neutral-950 md:text-4xl">SaDeL</p>
          </header>

          <section className="grid flex-1 gap-0 overflow-hidden rounded-b-[32px] bg-white shadow-[0_24px_80px_rgba(15,15,15,0.06)] lg:grid-cols-2">
            <div className="relative min-h-[35vh] overflow-hidden bg-neutral-950 lg:min-h-full">
              <img
                src="https://images.unsplash.com/photo-1552566626-52f8b828add9?auto=format&fit=crop&w=1600&q=80"
                alt="Interior de un restaurante como portada del acceso administrativo de SaDeL"
                className="h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-black/10 lg:bg-gradient-to-r lg:from-black/70 lg:via-black/40 lg:to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-6 text-white md:p-8 lg:p-10">
                <span className="inline-flex rounded-full bg-[#d7b46a] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.24em] text-neutral-950">
                  SaDeL Admin
                </span>
                <h1 className="mt-4 max-w-xl text-2xl font-semibold leading-tight tracking-[-0.05em] md:text-4xl lg:text-5xl">
                  Acceso exclusivo para administracion y control operativo.
                </h1>
                <p className="mt-3 max-w-lg text-sm leading-6 text-white/80 md:text-base md:leading-7">
                  Entra aqui para supervisar restaurantes, revisar regiones y operar la plataforma.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-center bg-[#fbfbf8] px-5 py-8 md:px-8 md:py-10">
              <div className="w-full max-w-[420px] text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">Bienvenido</p>
                <h2 className="mt-3 text-2xl font-semibold leading-tight tracking-[-0.05em] text-neutral-950 md:text-3xl lg:text-4xl">
                  Inicia sesion para administrar SaDeL
                </h2>
                <p className="mt-3 text-sm leading-6 text-neutral-500 md:text-base md:leading-7">
                  Acceso exclusivo para el equipo administrativo autorizado.
                </p>

                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void loginWithPassword();
                  }}
                  className="mt-8 grid gap-4 text-left"
                >
                  <Field
                    label="Usuario"
                    value={phone}
                    onChange={setPhone}
                    placeholder="5512345678"
                  />
                  <Field
                    label="Contraseña"
                    value={password}
                    onChange={setPassword}
                    placeholder="Ingresa tu contraseña"
                    type="password"
                  />

                  <button
                    type="submit"
                    disabled={verifyingCode || !phone.trim() || !password.trim()}
                    className="mt-2 rounded-full bg-neutral-950 px-6 py-3.5 text-sm font-semibold text-white transition-all duration-300 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-500 active:scale-[0.98]"
                  >
                    {verifyingCode ? 'Ingresando...' : 'Iniciar sesion'}
                  </button>

                  {error ? <Callout tone="danger">{error}</Callout> : null}
                </form>

                <div className="mt-8 rounded-2xl border border-black/5 bg-white px-5 py-4 text-left">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">Acceso administrativo</p>
                  <p className="mt-2 text-sm leading-6 text-neutral-500">
                    Usa las credenciales asignadas por el equipo de SaDeL. Este panel permite controlar la operacion completa.
                  </p>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    );
  }

  const adminUser = sessionUser as AuthUser;
  const navigationItems: Array<{ key: AdminPortalSection; label: string }> = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'orders', label: 'Pedidos en Vivo' },
    { key: 'restaurants', label: 'Restaurantes' },
    { key: 'drivers', label: 'Repartidores' },
    { key: 'users', label: 'Comensales' },
    { key: 'requests', label: 'Solicitudes' },
    { key: 'support', label: 'Soporte' },
    { key: 'customer-debts', label: 'Deuda de Clientes' },
    { key: 'promotions', label: 'Promociones' },
    { key: 'billboards', label: 'Publicidad' },
    { key: 'featured', label: 'Destacados' },
    { key: 'notifications', label: 'Notificaciones' },
    { key: 'stuck', label: 'Entregas Atascadas' },
    { key: 'settings', label: 'Configuracion' },
  ];

  return (
    <div className="min-h-screen bg-[#f7f4ec]">
      <header className="sticky top-0 z-40 w-full border-b border-black/5 bg-white/92 backdrop-blur">
        <div className="grid grid-cols-[56px_1fr_56px] items-center px-3 py-4 md:px-6 lg:grid-cols-[220px_1fr_220px]">
          <div className="mx-auto w-full max-w-[1540px] contents">
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => setIsMobileNavOpen(true)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-black/10 bg-white text-neutral-800 transition hover:bg-neutral-100 lg:hidden"
                aria-label="Abrir menu"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 7h16M4 12h16M4 17h16" />
                </svg>
              </button>
              <SaDelLogo className="hidden h-10 w-auto lg:block" />
            </div>
            <div className="px-3 text-center">
              <p className="truncate text-lg font-semibold tracking-[-0.03em] text-neutral-950 md:text-2xl">
                Panel de control
              </p>
            </div>
            <div className="flex items-center justify-end" />
          </div>
        </div>
      </header>

      <div className="flex min-h-[calc(100vh-5rem)] w-full bg-transparent">
        <aside className="fixed left-0 top-[5rem] hidden h-[calc(100vh-5rem)] w-[260px] border-r border-black/5 bg-[#fbfbf8] lg:flex lg:flex-col">
          <div className="flex-1 overflow-y-auto px-4 py-6">
            <div className="rounded-[28px] border border-black/5 bg-[linear-gradient(180deg,#ffffff_0%,#f5f2ea_100%)] p-4 shadow-[0_16px_45px_rgba(15,15,15,0.04)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-neutral-400">Sesion admin</p>
              <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-neutral-950">{adminUser.name}</p>
              <p className="mt-1 text-sm text-neutral-500">{adminUser.region}</p>
            </div>

            <nav className="mt-6 grid gap-2">
              {navigationItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveSection(item.key)}
                  className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition ${
                    activeSection === item.key
                      ? 'bg-neutral-950 text-white'
                      : 'text-neutral-700 hover:bg-white'
                  }`}
                >
                  <AdminNavIcon kind={item.key} />
                  {item.label}
                </button>
              ))}
            </nav>
          </div>

          <div className="border-t border-black/5 p-4">
            <button
              type="button"
              onClick={() => clearSession()}
              className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition text-rose-600 hover:bg-rose-50"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Cerrar sesión
            </button>
          </div>
        </aside>

        <div className="flex-1 bg-[#f7f4ec] lg:ml-[260px]">
          <div className="p-4 md:p-6">
            {activeSection === 'dashboard' ? (
              <div className="space-y-6">
                {/* Header Bar */}
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between bg-white rounded-3xl border border-black/5 p-5 shadow-sm">
                  <div>
                    <h1 className="text-2xl font-bold tracking-tight text-neutral-950">
                      Consola Central de Operaciones
                    </h1>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                      </span>
                      <p className="text-xs text-neutral-500 font-medium">
                        Monitoreo en vivo · Auto-actualización activa (30s)
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {loadingDashboard && (
                      <span className="text-xs text-neutral-400 font-semibold flex items-center gap-1.5 bg-neutral-50 border border-black/5 px-3 py-1.5 rounded-full">
                        <svg className="animate-spin h-3.5 w-3.5 text-neutral-400" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Sincronizando...
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => void loadDashboardStats()}
                      disabled={loadingDashboard}
                      className={`inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-bold text-neutral-700 hover:bg-neutral-50 shadow-sm transition active:scale-95 ${
                        loadingDashboard ? 'opacity-50 cursor-not-allowed' : ''
                      }`}
                    >
                      <svg className={`h-3.5 w-3.5 ${loadingDashboard ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8H17" />
                      </svg>
                      Sincronizar ahora
                    </button>
                  </div>
                </div>

                {loadingDashboard && !dashboardStats ? (
                  <div className="flex flex-col items-center justify-center min-h-[350px] gap-3 bg-white/50 backdrop-blur rounded-[32px] border border-black/5">
                    <div className="h-10 w-10 animate-spin rounded-full border-4 border-neutral-900 border-t-transparent" />
                    <p className="text-sm font-semibold text-neutral-500">Cargando consola central...</p>
                  </div>
                ) : (() => {
                  const stats = dashboardStats?.kpis || {
                    activeOrdersCount: 0,
                    todayOrdersCount: 0,
                    todayGMV: 0,
                    todayNetRevenue: 0,
                    todayRestaurantFees: 0,
                    todayDriverFees: 0,
                    todayServiceFees: 0,
                    noDriversOrdersCount: 0,
                    pendingSettlementsCount: 0,
                    pendingAffiliationsCount: 0,
                    pendingTicketsCount: 0,
                    totalDrivers: 0,
                    activeDrivers: 0,
                    expiredLicenseCount: 0,
                    totalRestaurants: 0,
                    activeRestaurants: 0,
                    suspendedRestaurants: 0,
                  };
                  const netRev = dashboardStats?.netRevenue || { weekly: { amount: 0, orders: 0 }, monthly: { amount: 0, orders: 0 }, allTime: { amount: 0, orders: 0 } };
                  const regionData = dashboardStats?.regionEarnings || [];
                  const comparisons = dashboardStats?.comparisons || { gmvChange: null, netChange: null };

                  return (
                    <div className="space-y-6">
                      {/* Quick Actions */}
                      <div className="flex flex-wrap gap-3 mb-2">
                        <button onClick={() => setActiveSection('restaurants')} className="flex items-center gap-2 px-4 py-2 bg-neutral-900 text-white rounded-full text-sm font-semibold hover:bg-neutral-800 transition">
                          🍽️ Gestionar Restaurantes
                        </button>
                        <button onClick={() => setActiveSection('categories')} className="flex items-center gap-2 px-4 py-2 bg-white border border-black/10 text-neutral-900 rounded-full text-sm font-semibold hover:bg-neutral-50 transition shadow-sm">
                          🏷️ Categorías
                        </button>
                        <button onClick={() => setActiveSection('support')} className="flex items-center gap-2 px-4 py-2 bg-white border border-black/10 text-neutral-900 rounded-full text-sm font-semibold hover:bg-neutral-50 transition shadow-sm">
                          🎫 Tickets de Soporte
                        </button>
                      </div>

                      {/* KPIs Grid */}
                      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 3xl:grid-cols-7">
                        {/* KPI 1: Pedidos Activos */}
                        <div className="group relative overflow-hidden rounded-[28px] border border-black/5 bg-white p-5 shadow-sm transition hover:shadow-md">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-400">Pedidos Activos</span>
                            <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-neutral-100 text-sm transition group-hover:scale-110">🛍️</div>
                          </div>
                          <div className="mt-3 flex items-baseline gap-2">
                            <span className="text-2xl font-extrabold text-neutral-950 tracking-tight">{stats.activeOrdersCount}</span>
                            {stats.noDriversOrdersCount > 0 ? (
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-100 px-2 py-0.5 text-[9px] font-bold text-rose-800 animate-pulse">⚠️ {stats.noDriversOrdersCount} sin chofer</span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block"></span>Asignados</span>
                            )}
                          </div>
                          <p className="mt-1.5 text-[11px] text-neutral-500 font-medium">En preparación o tránsito</p>
                        </div>

                        {/* KPI 2: Ganancia Neta Hoy */}
                        <div className="group relative overflow-hidden rounded-[28px] border border-black/5 bg-white p-5 shadow-sm transition hover:shadow-md">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-400">Ganancia Neta Hoy</span>
                            <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-emerald-100 text-sm transition group-hover:scale-110">💰</div>
                          </div>
                          <div className="mt-3 flex items-baseline gap-2">
                            <span className="text-2xl font-extrabold text-neutral-950 tracking-tight">{formatCurrency(stats.todayNetRevenue)}</span>
                            <span className="text-[10px] font-semibold text-neutral-400">({stats.todayOrdersCount} ord.)</span>
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-neutral-500">
                            <span>Rest: <strong className="text-neutral-800">{formatCurrency(stats.todayRestaurantFees)}</strong></span>
                            <span>Driver: <strong className="text-neutral-800">{formatCurrency(stats.todayDriverFees)}</strong></span>
                            <span>Servicio: <strong className="text-neutral-800">{formatCurrency(stats.todayServiceFees)}</strong></span>
                          </div>
                          <p className="mt-1 text-[11px] text-neutral-400">GMV: {formatCurrency(stats.todayGMV)}</p>
                        </div>

                        {/* KPI 3: Volumen Semanal */}
                        <div className="group relative overflow-hidden rounded-[28px] border border-black/5 bg-white p-5 shadow-sm transition hover:shadow-md">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-400">Comisiones Semana</span>
                            <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-indigo-100 text-sm transition group-hover:scale-110">📊</div>
                          </div>
                          <div className="mt-3 flex items-baseline gap-2">
                            <span className="text-2xl font-extrabold text-neutral-950 tracking-tight">{formatCurrency(netRev.weekly.amount)}</span>
                            <span className="text-[10px] font-semibold text-neutral-400">{netRev.weekly.orders} ord.</span>
                          </div>
                          <p className="mt-1.5 text-[11px] text-neutral-500 font-medium">Esta semana</p>
                        </div>

                        {/* KPI 4: Volumen Mensual */}
                        <div className="group relative overflow-hidden rounded-[28px] border border-black/5 bg-white p-5 shadow-sm transition hover:shadow-md">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-400">Comisiones Mes</span>
                            <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-violet-100 text-sm transition group-hover:scale-110">📈</div>
                          </div>
                          <div className="mt-3 flex items-baseline gap-2">
                            <span className="text-2xl font-extrabold text-neutral-950 tracking-tight">{formatCurrency(netRev.monthly.amount)}</span>
                            <span className="text-[10px] font-semibold text-neutral-400">{netRev.monthly.orders} ord.</span>
                          </div>
                          <p className="mt-1.5 text-[11px] text-neutral-500 font-medium">Este mes</p>
                        </div>

                        {/* KPI 5: Flota de Repartidores */}
                        <div className="group relative overflow-hidden rounded-[28px] border border-black/5 bg-white p-5 shadow-sm transition hover:shadow-md">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-400">Flota de Repartidores</span>
                            <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-neutral-100 text-sm transition group-hover:scale-110">🛵</div>
                          </div>
                          <div className="mt-3 flex items-baseline gap-2">
                            <span className="text-2xl font-extrabold text-neutral-950 tracking-tight">{stats.activeDrivers}</span>
                            <span className="text-sm font-semibold text-neutral-400">/ {stats.totalDrivers}</span>
                          </div>
                          <div className="mt-2">
                            <div className="h-1.5 w-full rounded-full bg-neutral-100 overflow-hidden"><div className="h-full bg-neutral-950 rounded-full transition-all duration-500" style={{ width: `${stats.totalDrivers > 0 ? (stats.activeDrivers / stats.totalDrivers) * 100 : 0}%` }} /></div>
                            {stats.expiredLicenseCount > 0 && <p className="mt-1 text-[9px] text-amber-600 font-semibold">⚠️ {stats.expiredLicenseCount} licencias vencidas</p>}
                          </div>
                        </div>

                        {/* KPI 6: Inbox Administrativo */}
                        <div className="group relative overflow-hidden rounded-[28px] border border-black/5 bg-white p-5 shadow-sm transition hover:shadow-md">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-400">Inbox Administrativo</span>
                            <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-neutral-100 text-sm transition group-hover:scale-110">📥</div>
                          </div>
                          <div className="mt-3 flex items-baseline gap-2">
                            <span className="text-2xl font-extrabold text-neutral-950 tracking-tight">{stats.pendingSettlementsCount + stats.pendingAffiliationsCount + stats.pendingTicketsCount}</span>
                            <span className="text-[10px] font-semibold text-neutral-400">pendientes</span>
                          </div>
                          <p className="mt-1.5 text-[11px] text-neutral-500 font-medium truncate">{stats.pendingSettlementsCount} pagos · {stats.pendingAffiliationsCount} sol. · {stats.pendingTicketsCount} tck.</p>
                        </div>

                        {/* KPI 7: Restaurantes */}
                        <div className="group relative overflow-hidden rounded-[28px] border border-black/5 bg-white p-5 shadow-sm transition hover:shadow-md">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-400">Restaurantes Asociados</span>
                            <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-neutral-100 text-sm transition group-hover:scale-110">🍽️</div>
                          </div>
                          <div className="mt-3 flex items-baseline gap-2">
                            <span className="text-2xl font-extrabold text-neutral-950 tracking-tight">{stats.activeRestaurants}</span>
                            <span className="text-sm font-semibold text-neutral-400">/ {stats.totalRestaurants}</span>
                          </div>
                          <div className="mt-2">
                            <div className="h-1.5 w-full rounded-full bg-neutral-100 overflow-hidden"><div className="h-full bg-sky-500 rounded-full transition-all duration-500" style={{ width: `${stats.totalRestaurants > 0 ? (stats.activeRestaurants / stats.totalRestaurants) * 100 : 0}%` }} /></div>
                            {stats.suspendedRestaurants > 0 && <p className="mt-1 text-[9px] text-rose-600 font-semibold">⚠️ {stats.suspendedRestaurants} suspendidos</p>}
                          </div>
                        </div>
                      </div>

                      {/* Charts Section */}
                      <div className="grid gap-6 xl:grid-cols-2">
                        <div className="rounded-[28px] border border-black/5 bg-white p-5 shadow-sm">
                          <div className="mb-3 flex items-start justify-between">
                            <div>
                              <h3 className="text-base font-bold text-neutral-950">Ganancia Neta vs GMV</h3>
                              <p className="text-[11px] text-neutral-500 mt-0.5">Últimos 30 días · Comisiones de restaurante + repartidor</p>
                            </div>
                            {comparisons.netChange !== null && (
                              <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold ${Number(comparisons.netChange) >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                                {Number(comparisons.netChange) >= 0 ? '▲' : '▼'} {Math.abs(Number(comparisons.netChange))}% vs período ant.
                              </span>
                            )}
                          </div>
                          <div className="h-[250px] w-full">
                            <ResponsiveContainer width="100%" height={250}>
                              <AreaChart data={dashboardStats?.chartData || []} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                <defs>
                                  <linearGradient id="colorNet" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                                  </linearGradient>
                                  <linearGradient id="colorGMV" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#0f172a" stopOpacity={0.12}/>
                                    <stop offset="95%" stopColor="#0f172a" stopOpacity={0}/>
                                  </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#888' }} dy={10} />
                                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#888' }} tickFormatter={(val) => `$${val}`} />
                                <Tooltip
                                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                  formatter={(value: number, name: string) => [`$${value.toFixed(2)}`, name === 'netRevenue' ? 'Ganancia Neta' : 'GMV']}
                                />
                                <Area type="monotone" dataKey="gmv" stroke="#0f172a" strokeWidth={1.5} fillOpacity={1} fill="url(#colorGMV)" strokeDasharray="4 3" />
                                <Area type="monotone" dataKey="netRevenue" stroke="#10b981" strokeWidth={2.5} fillOpacity={1} fill="url(#colorNet)" />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                          <div className="mt-3 flex items-center gap-4 text-[11px]">
                            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-emerald-500/30 border border-emerald-500" /> Ganancia Neta (comisiones)</span>
                            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-neutral-500/20 border border-neutral-400 border-dashed" /> GMV (ventas totales)</span>
                          </div>
                        </div>

                        <div className="rounded-[28px] border border-black/5 bg-white p-5 shadow-sm">
                          <div className="mb-3">
                            <h3 className="text-base font-bold text-neutral-950">Pedidos (Últimos 30 Días)</h3>
                            <p className="text-[11px] text-neutral-500 mt-0.5">Volumen diario de pedidos procesados</p>
                          </div>
                          <div className="h-[250px] w-full">
                            <ResponsiveContainer width="100%" height={250}>
                              <BarChart data={dashboardStats?.chartData || []} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#888' }} dy={10} />
                                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#888' }} />
                                <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} cursor={{ fill: '#f3f4f6' }} formatter={(value: number) => [value, 'Pedidos']} />
                                <Bar dataKey="orders" fill="#0f172a" radius={[4, 4, 0, 0]} />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      </div>

                      {/* Main Dashboard Panels */}
                      <div className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
                        {/* Monitor Operativo en Vivo (Left Column) */}
                        <div className="rounded-[28px] border border-black/5 bg-white p-5 shadow-sm flex flex-col min-h-[400px]">
                          <div className="flex items-center justify-between pb-3 border-b border-black/5 mb-3">
                            <div>
                              <h3 className="text-base font-bold text-neutral-950">Monitor Operativo en Vivo</h3>
                              <p className="text-[11px] text-neutral-500 mt-0.5">Últimos pedidos registrados en tránsito o preparación</p>
                            </div>
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-2.5 py-1 text-[10px] font-semibold text-neutral-600">{dashboardStats?.activeOrders?.length || 0} pedidos</span>
                          </div>

                          <div className="flex-1 overflow-y-auto max-h-[450px] space-y-2.5 pr-1">
                            {!dashboardStats?.activeOrders || dashboardStats.activeOrders.length === 0 ? (
                              <div className="flex flex-col items-center justify-center h-56 text-neutral-400">
                                <span className="text-3xl mb-2">🍜</span>
                                <p className="text-sm font-medium text-neutral-500">No hay pedidos activos actualmente.</p>
                              </div>
                            ) : (
                              dashboardStats.activeOrders.map((order: any) => {
                                const orderTime = new Date(order.createdAt);
                                return (
                                  <div key={order.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-black/5 bg-neutral-50/50 hover:bg-neutral-50 transition">
                                    <div className="flex items-start gap-2.5 min-w-0">
                                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 font-mono text-[9px] font-bold text-neutral-700">#{order.orderReference.slice(-4)}</div>
                                      <div className="min-w-0">
                                        <p className="font-semibold text-neutral-950 text-sm truncate">{order.restaurantName}</p>
                                        <p className="text-[11px] text-neutral-500 truncate mt-0.5">Cliente: {order.customerName}</p>
                                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                          {order.noDriversAvailable ? (
                                            <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-100 px-1.5 py-0.5 text-[8px] font-bold text-rose-800 animate-pulse">⚠️ Sin repartidor disponible</span>
                                          ) : (
                                            <span className="text-[10px] text-neutral-500 font-semibold flex items-center gap-0.5 bg-white border border-black/5 px-1.5 py-0.5 rounded-full">🛵 {order.driverName || 'Por asignar'}</span>
                                          )}
                                          <span className="text-[9px] text-neutral-400 font-medium">{orderTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      <p className="font-bold text-neutral-900 text-xs">{formatCurrency(order.totalAmount)}</p>
                                      {(() => {
                                        const style: Record<string, string> = { PENDING: 'bg-amber-50 text-amber-700', CONFIRMED: 'bg-blue-50 text-blue-700', PREPARING: 'bg-indigo-50 text-indigo-700', READY: 'bg-violet-50 text-violet-700', PICKED_UP: 'bg-sky-50 text-sky-700', IN_TRANSIT: 'bg-sky-50 text-sky-700', COMPLETED: 'bg-teal-50 text-teal-700' };
                                        const label: Record<string, string> = { PENDING: 'Pendiente', CONFIRMED: 'Confirmado', PREPARING: 'Cocina', READY: 'Listo', PICKED_UP: 'Recogido', IN_TRANSIT: 'Camino', COMPLETED: 'Recogido' };
                                        return <span className={`rounded-full border px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider ${style[order.status] || 'bg-neutral-100 text-neutral-600'}`}>{label[order.status] || order.status}</span>;
                                      })()}
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>

                        {/* Earnings by Region (Right Column) */}
                        <div className="rounded-[28px] border border-black/5 bg-white overflow-hidden shadow-sm flex flex-col min-h-[400px]">
                          <div className="p-5 pb-3 border-b border-black/5">
                            <h3 className="text-base font-bold text-neutral-950">Ganancias por Zona</h3>
                            <p className="text-[11px] text-neutral-500 mt-0.5">Últimos 30 días · Comisiones netas por región</p>
                          </div>
                          <div className="flex-1 overflow-y-auto max-h-[450px]">
                            {regionData.length === 0 ? (
                              <div className="flex flex-col items-center justify-center h-56 text-center text-neutral-400">
                                <span className="text-3xl mb-2">📍</span>
                                <p className="text-xs font-semibold text-neutral-500">Sin datos</p>
                                <p className="text-[10px] text-neutral-400 mt-1 max-w-[200px]">No hay actividad en los últimos 30 días.</p>
                              </div>
                            ) : (
                              <div className="divide-y divide-black/5">
                                {regionData.map((r: any) => (
                                  <div key={r.region} className="px-5 py-3.5 hover:bg-neutral-50/50 transition">
                                    <div className="flex items-center justify-between mb-1.5">
                                      <span className="text-sm font-bold text-neutral-950 capitalize">{r.region.replace(/-/g, ' ')}</span>
                                      <span className="text-xs font-semibold text-neutral-500">{r.orders} pedidos</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs text-neutral-500">Comisión neta</span>
                                      <span className="text-sm font-extrabold text-emerald-600">{formatCurrency(r.netRevenue)}</span>
                                    </div>
                                    <div className="mt-1.5 flex gap-3 text-[10px] text-neutral-400">
                                      <span>Rest: {formatCurrency(r.restaurantFees)}</span>
                                      <span>Driver: {formatCurrency(r.driverFees)}</span>
                                      <span>Serv: {formatCurrency(r.serviceFees)}</span>
                                    </div>
                                    <div className="mt-2 h-1.5 w-full rounded-full bg-neutral-100 overflow-hidden">
                                      <div className="h-full bg-emerald-500 rounded-full transition-all duration-500" style={{ width: `${Math.min(100, (r.netRevenue / Math.max(...regionData.map((x: any) => x.netRevenue))) * 100)}%` }} />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="border-t border-black/5 px-5 py-3 bg-neutral-50/30">
                            <div className="flex items-center justify-between text-sm">
                              <span className="font-bold text-neutral-950">Total neto 30d</span>
                              <span className="font-extrabold text-emerald-600">{formatCurrency(regionData.reduce((s: number, r: any) => s + r.netRevenue, 0))}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Bandeja Inbox Cero */}
                      <div className="rounded-[28px] border border-black/5 bg-white overflow-hidden shadow-sm">
                        <div className="p-5 pb-3 border-b border-black/5">
                          <h3 className="text-base font-bold text-neutral-950">Bandeja Inbox Cero</h3>
                          <p className="text-[11px] text-neutral-500 mt-0.5">Acciones rápidas pendientes de resolución</p>
                        </div>
                        <div className="flex border-b border-black/5 bg-neutral-50/50 p-1.5 gap-1">
                          <button type="button" onClick={() => setDashboardInboxTab('settlements')} className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-bold rounded-2xl transition ${dashboardInboxTab === 'settlements' ? 'bg-white text-neutral-950 shadow-sm border border-black/5' : 'text-neutral-500 hover:text-neutral-950'}`}>
                            Pagos{stats.pendingSettlementsCount > 0 && <span className="bg-amber-100 text-amber-800 text-[10px] font-extrabold px-1.5 py-0.5 rounded-full">{stats.pendingSettlementsCount}</span>}
                          </button>
                          <button type="button" onClick={() => setDashboardInboxTab('affiliations')} className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-bold rounded-2xl transition ${dashboardInboxTab === 'affiliations' ? 'bg-white text-neutral-950 shadow-sm border border-black/5' : 'text-neutral-500 hover:text-neutral-950'}`}>
                            Solicitudes{stats.pendingAffiliationsCount > 0 && <span className="bg-indigo-100 text-indigo-800 text-[10px] font-extrabold px-1.5 py-0.5 rounded-full">{stats.pendingAffiliationsCount}</span>}
                          </button>
                          <button type="button" onClick={() => setDashboardInboxTab('tickets')} className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-bold rounded-2xl transition ${dashboardInboxTab === 'tickets' ? 'bg-white text-neutral-950 shadow-sm border border-black/5' : 'text-neutral-500 hover:text-neutral-950'}`}>
                            Soporte{stats.pendingTicketsCount > 0 && <span className="bg-rose-100 text-rose-800 text-[10px] font-extrabold px-1.5 py-0.5 rounded-full">{stats.pendingTicketsCount}</span>}
                          </button>
                        </div>
                        <div className="p-5 max-h-[350px] overflow-y-auto">
                          {dashboardInboxTab === 'settlements' && (
                            dashboardStats?.pendingSettlements?.length ? dashboardStats.pendingSettlements.map((s: any) => (
                              <div key={s.id} className="flex items-center justify-between p-3 rounded-xl border border-black/5 bg-neutral-50/50 mb-2 last:mb-0">
                                <div>
                                  <p className="text-sm font-bold text-neutral-950">{s.restaurant.name}</p>
                                  <p className="text-[10px] text-neutral-500">{new Date(s.periodStart).toLocaleDateString()} - {new Date(s.periodEnd).toLocaleDateString()}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="font-extrabold text-sm">{formatCurrency(s.amount)}</span>
                                  {s.paymentProofUrl && <button onClick={() => setViewingSettlementUrl(s.paymentProofUrl)} className="text-[10px] font-bold text-neutral-700 bg-white border border-black/10 px-2 py-1 rounded-full hover:bg-neutral-100">📄</button>}
                                  <button onClick={() => confirmSettlementFromDashboard(s.id)} className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/50 px-2 py-1 rounded-full hover:bg-emerald-100">✓</button>
                                  <button onClick={() => rejectSettlementFromDashboard(s.id)} className="text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200/50 px-2 py-1 rounded-full hover:bg-rose-100">✗</button>
                                </div>
                              </div>
                            )) : (
                              <div className="flex flex-col items-center justify-center h-32 text-neutral-400"><span className="text-2xl mb-1">✨</span><p className="text-xs font-semibold text-neutral-500">Inbox Cero</p></div>
                            )
                          )}
                          {dashboardInboxTab === 'affiliations' && (
                            dashboardStats?.pendingAffiliations?.length ? dashboardStats.pendingAffiliations.map((req: any) => (
                              <div key={req.id} className="flex items-center justify-between p-3 rounded-xl border border-black/5 bg-neutral-50/50 mb-2 last:mb-0">
                                <div>
                                  <p className="text-sm font-bold text-neutral-950">{req.ownerName} <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-extrabold ${req.type === 'RESTAURANT' ? 'bg-violet-100 text-violet-800' : 'bg-indigo-100 text-indigo-800'}`}>{req.type === 'RESTAURANT' ? 'Negocio' : 'Chofer'}</span></p>
                                  <p className="text-[10px] text-neutral-500">{req.whatsapp}</p>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <a href={`https://wa.me/${req.whatsapp.replace(/\D/g, '')}?text=Hola%20${encodeURIComponent(req.ownerName)},%20te%20escribimos%20de%20SaDeL%20para%20darle%20seguimiento%20a%20tu%20alta.`} target="_blank" rel="noreferrer" className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/50 px-2 py-1 rounded-full hover:bg-emerald-100">💬</a>
                                  <button onClick={() => { setSelectedRequestId(req.id); setApproveRegion(regions[0]?.code || ''); setApprovePassword('sadel123'); setIsApproveRequestModalOpen(true); }} className="text-[10px] font-bold text-white bg-neutral-950 px-2 py-1 rounded-full hover:bg-neutral-800">Aprobar</button>
                                  <button onClick={() => rejectPlatformRequest(req.id)} className="text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200/50 px-2 py-1 rounded-full hover:bg-rose-100">✗</button>
                                </div>
                              </div>
                            )) : (
                              <div className="flex flex-col items-center justify-center h-32 text-neutral-400"><span className="text-2xl mb-1">✨</span><p className="text-xs font-semibold text-neutral-500">Inbox Cero</p></div>
                            )
                          )}
                          {dashboardInboxTab === 'tickets' && (
                            dashboardStats?.pendingTickets?.length ? dashboardStats.pendingTickets.map((t: any) => (
                              <div key={t.id} className="p-3 rounded-xl border border-black/5 bg-neutral-50/50 mb-2 last:mb-0">
                                <p className="text-xs font-bold text-neutral-950 mb-1">{t.customer?.user?.name || 'Cliente'} <span className="text-[9px] font-extrabold text-rose-800 bg-rose-100 px-1.5 py-0.5 rounded-full">{t.type === 'ORDER' ? 'Pedido' : 'App'}</span></p>
                                <p className="text-[11px] text-neutral-600 mb-2">{t.description}</p>
                                <div className="flex gap-2">
                                  <input value={dashboardTicketResponse[t.id] || ''} onChange={(e) => setDashboardTicketResponse(p => ({ ...p, [t.id]: e.target.value }))} placeholder="Respuesta..." className="flex-1 text-xs p-2 border border-black/10 rounded-xl outline-none focus:border-black/30" />
                                  <button disabled={dashboardSubmittingTicketId === t.id || !(dashboardTicketResponse[t.id] || '').trim()} onClick={() => resolveTicketFromDashboard(t.id, dashboardTicketResponse[t.id] || '')} className="text-[10px] font-bold text-white bg-neutral-950 px-3 py-1.5 rounded-full hover:bg-neutral-800 disabled:opacity-40">{dashboardSubmittingTicketId === t.id ? '...' : 'Cerrar'}</button>
                                </div>
                              </div>
                            )) : (
                              <div className="flex flex-col items-center justify-center h-32 text-neutral-400"><span className="text-2xl mb-1">✨</span><p className="text-xs font-semibold text-neutral-500">Inbox Cero</p></div>
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            ) : null}


            {activeSection === 'orders' ? (
              <div className="space-y-6">
                <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h1 className="text-3xl font-bold tracking-tight text-neutral-900">Pedidos en Vivo</h1>
                    <p className="mt-1 text-sm text-neutral-500">
                      Monitorea y resuelve problemas con pedidos en tiempo real.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                      <select
                      value={orderFilters.status}
                      onChange={(e) => { setOrderFilters((f) => ({ ...f, status: e.target.value })); setOrdersPage(1); }}
                      className="rounded-full border border-black/10 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-700 outline-none transition focus:border-neutral-950"
                    >
                      <option value="">Activos</option>
                      <option value="PENDING">Pendiente</option>
                      <option value="PREPARING">Preparando</option>
                      <option value="READY">Listo / Buscando Repartidor</option>
                      <option value="PICKED_UP">Recogido</option>
                      <option value="IN_TRANSIT">En camino</option>
                      <option value="DELIVERED">Entregado</option>
                      <option value="COMPLETED">Recogido en tienda</option>
                      <option value="CANCELLED">Cancelado</option>
                    </select>
                    <input
                      type="date"
                      value={orderFilters.date}
                      onChange={(e) => { setOrderFilters((f) => ({ ...f, date: e.target.value })); setOrdersPage(1); }}
                      className="rounded-full border border-black/10 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-700 outline-none transition focus:border-neutral-950"
                    />
                    <label className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-700 cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={orderFilters.noDriversAvailable === 'true'}
                        onChange={(e) => { setOrderFilters((f) => ({ ...f, noDriversAvailable: e.target.checked ? 'true' : '' })); setOrdersPage(1); }}
                        className="rounded border-black/20"
                      />
                      <span className="text-rose-600">Alerta: Sin Repartidor</span>
                    </label>
                    <button
                      onClick={loadOrders}
                      className="relative rounded-full bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-800"
                    >
                      {loadingOrders ? 'Cargando...' : 'Actualizar'}
                      {ordersAutoRefresh && !loadingOrders && (
                        <span className="absolute -right-1 -top-1 flex h-3 w-3">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setOrdersAutoRefresh((v) => !v)}
                      className={`rounded-full border px-4 py-2.5 text-sm font-semibold transition ${
                        ordersAutoRefresh
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-black/10 bg-white text-neutral-500'
                      }`}
                    >
                      {ordersAutoRefresh ? 'Auto 15s' : 'Auto-off'}
                    </button>
                  </div>
                </header>

                <div className="rounded-[32px] border border-black/5 bg-white/70 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl">
                  {loadingOrders ? (
                    <div className="p-12 text-center text-neutral-500">Cargando pedidos...</div>
                  ) : orders.length === 0 ? (
                    <div className="p-12 text-center">
                      <span className="text-4xl">📭</span>
                      <p className="mt-4 text-sm text-neutral-500">No se encontraron pedidos con estos filtros.</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm text-neutral-600">
                        <thead className="border-b border-black/5 bg-neutral-50/50 text-xs uppercase tracking-wider text-neutral-400">
                          <tr>
                            <th className="px-6 py-4 font-semibold">Referencia</th>
                            <th className="px-6 py-4 font-semibold">Estado</th>
                            <th className="px-6 py-4 font-semibold">Restaurante</th>
                            <th className="px-6 py-4 font-semibold">Cliente</th>
                            <th className="px-6 py-4 font-semibold">Repartidor</th>
                            <th className="px-6 py-4 font-semibold">Monto</th>
                            <th className="px-6 py-4 font-semibold text-right">Acciones</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-black/5">
                          {orders.map((order) => {
                            const isActiveOrder = ['PENDING', 'PREPARING', 'READY', 'PICKED_UP', 'IN_TRANSIT'].includes(order.status);
                            
                            return (
                              <tr 
                                key={order.id} 
                                className={`transition ${
                                  isActiveOrder 
                                    ? 'bg-white hover:bg-blue-50/30' 
                                    : 'bg-neutral-50/50 opacity-60 hover:opacity-100 hover:bg-black/[0.02]'
                                }`}
                              >
                                <td className="px-6 py-4">
                                  <div className="flex items-center gap-2">
                                    {isActiveOrder && (
                                      <span className="relative flex h-2 w-2 shrink-0">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                                      </span>
                                    )}
                                    <div className={`font-mono font-bold ${isActiveOrder ? 'text-blue-900' : 'text-neutral-700'}`}>
                                      {order.orderReference}
                                    </div>
                                  </div>
                                  <div className={`text-xs mt-0.5 ${isActiveOrder ? 'text-blue-600/70 ml-4' : 'text-neutral-400'}`}>
                                    {new Date(order.createdAt).toLocaleDateString()} a las {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </div>
                                </td>
                              <td className="px-6 py-4">
                                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                                  order.status === 'DELIVERED' ? 'bg-emerald-100 text-emerald-800' :
                                  order.status === 'COMPLETED' ? 'bg-teal-100 text-teal-800' :
                                  order.status === 'CANCELLED' ? 'bg-neutral-100 text-neutral-800' :
                                  order.noDriversAvailable ? 'bg-rose-100 text-rose-800 animate-pulse' :
                                  'bg-blue-50 text-blue-700'
                                }`}>
                                  {order.noDriversAvailable ? '⚠️ SIN REPARTIDOR' : order.status}
                                </span>
                              </td>
                              <td className="px-6 py-4">
                                <div className="font-medium text-neutral-900">{order.restaurant.name}</div>
                                <div className="text-xs text-neutral-400 font-semibold tracking-wider">{order.restaurant.region}</div>
                              </td>
                              <td className="px-6 py-4">
                                <div>{order.customer?.user?.name || order.customer?.name || 'Cliente'}</div>
                                <div className="text-xs text-neutral-400">{order.customer?.user?.phone || order.customer?.phone || 'Sin tel'}</div>
                              </td>
                              <td className="px-6 py-4">
                                {order.driver ? (
                                  <div>
                                    <div>{order.driver?.user?.name || order.driver?.name}</div>
                                    <div className="text-xs text-neutral-400">{order.driver?.user?.phone || order.driver?.phone || 'Sin tel'}</div>
                                  </div>
                                ) : (
                                  <span className="text-neutral-400 italic">
                                    {order.restaurant?.hasOwnDelivery ? 'Repartidor Propio' : 'No asignado'}
                                  </span>
                                )}
                              </td>
                              <td className="px-6 py-4 font-medium text-neutral-900">
                                ${(order.totalAmount || 0).toFixed(2)}
                              </td>
                              <td className="px-6 py-4 text-right">
                                <button
                                  onClick={() => setSelectedOrderId(order.id)}
                                  className="text-sm font-semibold text-indigo-600 hover:text-indigo-800 transition"
                                >
                                  Auditar
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {ordersTotal > 20 && (
                    <div className="flex items-center justify-between border-t border-black/5 px-6 py-4">
                      <p className="text-sm text-neutral-500">Total: {ordersTotal} pedidos</p>
                      <div className="flex gap-2">
                        <button
                          disabled={ordersPage === 1}
                          onClick={() => setOrdersPage(p => Math.max(1, p - 1))}
                          className="rounded-xl border border-black/10 px-4 py-2 text-sm font-semibold text-neutral-700 disabled:opacity-50"
                        >
                          Anterior
                        </button>
                        <button
                          disabled={orders.length < 20}
                          onClick={() => setOrdersPage(p => p + 1)}
                          className="rounded-xl border border-black/10 px-4 py-2 text-sm font-semibold text-neutral-700 disabled:opacity-50"
                        >
                          Siguiente
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Modal de Detalle de Pedido */}
                {selectedOrderId && (
                  <div className="fixed inset-0 z-[100] flex items-center justify-center bg-neutral-950/40 backdrop-blur-sm p-4">
                    <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-[32px] bg-white shadow-2xl">
                      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-black/5 bg-white/90 px-6 py-4 backdrop-blur">
                        <div>
                          <h2 className="text-xl font-bold text-neutral-900">
                            Auditoría de Pedido {selectedOrder?.orderReference || '...'}
                          </h2>
                          {selectedOrder && (
                            <p className="text-xs text-neutral-500 font-medium">
                              Creado el {new Date(selectedOrder.createdAt).toLocaleDateString()} a las {new Date(selectedOrder.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => setSelectedOrderId('')}
                          className="rounded-full p-2 text-neutral-500 hover:bg-neutral-100"
                        >
                          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                      
                      <div className="p-6">
                        {loadingOrderDetail || !selectedOrder ? (
                          <div className="text-center text-neutral-500 py-12">Cargando detalles...</div>
                        ) : (
                          <div className="space-y-8">
                            {/* TOP ROW: KPIs */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                              <div className="rounded-2xl border border-black/5 p-4 bg-neutral-50">
                                <p className="text-xs font-semibold uppercase text-neutral-400">Estado</p>
                                <p className="mt-1 font-bold text-neutral-900">
                                  {{
                                    PENDING: 'Pendiente', CONFIRMED: 'Confirmado', PREPARING: 'Preparando',
                                    READY: 'Listo', PICKED_UP: 'Recogido', IN_TRANSIT: 'En Camino',
                                    DELIVERED: 'Entregado', COMPLETED: 'Recogido en tienda', CANCELLED: 'Cancelado', REJECTED: 'Rechazado'
                                  }[selectedOrder.status as string] || selectedOrder.status}
                                </p>
                              </div>
                              <div className="rounded-2xl border border-black/5 p-4 bg-neutral-50">
                                <p className="text-xs font-semibold uppercase text-neutral-400">
                                  Pago ({{CASH: 'Efectivo', CARD: 'Tarjeta'}[selectedOrder.paymentMethod as string] || selectedOrder.paymentMethod || '?'})
                                </p>
                                <p className={`mt-1 font-bold ${selectedOrder.paymentStatus === 'COMPLETED' ? 'text-emerald-600' : 'text-amber-600'}`}>
                                  {{COMPLETED: 'Pagado', PENDING: 'Pendiente', FAILED: 'Fallido', REFUNDED: 'Reembolsado'}[selectedOrder.paymentStatus as string] || selectedOrder.paymentStatus || 'PENDIENTE'}
                                </p>
                              </div>
                              <div className="col-span-2 rounded-2xl border border-black/5 p-4 bg-neutral-50">
                                <p className="text-xs font-semibold uppercase text-neutral-400">Alertas Operativas</p>
                                <p className="mt-1 font-bold text-rose-600">
                                  {selectedOrder.noDriversAvailable && <span className="mr-2">⚠️ Sin Repartidor</span>}
                                  {selectedOrder.supportRejectionCount > 0 && <span className="mr-2">❌ Rechazado {selectedOrder.supportRejectionCount} veces</span>}
                                  {selectedOrder.isSupportRequested && <span>🆘 Soporte Solicitado</span>}
                                  {!selectedOrder.noDriversAvailable && !selectedOrder.supportRejectionCount && !selectedOrder.isSupportRequested && <span className="text-emerald-600">Ninguna detectada</span>}
                                </p>
                              </div>
                            </div>

                            <div className="grid md:grid-cols-2 gap-8">
                              <div className="space-y-8">
                                {/* INVOLUCRADOS */}
                                <div>
                                  <h3 className="text-sm font-bold uppercase tracking-wider text-neutral-900 mb-4">Involucrados</h3>
                                  <ul className="space-y-4">
                                    <li className="flex items-center justify-between border-b border-black/5 pb-2">
                                      <span className="text-sm text-neutral-500">Cliente</span>
                                      <span className="text-sm font-medium text-neutral-900">
                                        {selectedOrder.customer?.user?.name || selectedOrder.customer?.name || 'Cliente'} ({selectedOrder.customer?.user?.phone || selectedOrder.customer?.phone || 'Sin tel'})
                                      </span>
                                    </li>
                                    <li className="flex items-center justify-between border-b border-black/5 pb-2">
                                      <span className="text-sm text-neutral-500">Restaurante</span>
                                      <span className="text-sm font-medium text-neutral-900">{selectedOrder.restaurant?.name || 'N/A'}</span>
                                    </li>
                                    <li className="flex items-center justify-between border-b border-black/5 pb-2">
                                      <span className="text-sm text-neutral-500">Repartidor</span>
                                      <span className="text-sm font-medium text-neutral-900">
                                        {selectedOrder.driver 
                                          ? (selectedOrder.driver?.user?.name || selectedOrder.driver?.name) 
                                          : (selectedOrder.restaurant?.hasOwnDelivery ? 'Propio (Del Restaurante)' : 'No asignado')}
                                      </span>
                                    </li>
                                  </ul>
                                </div>

                                {/* FINANZAS */}
                                <div>
                                  <h3 className="text-sm font-bold uppercase tracking-wider text-neutral-900 mb-4">Finanzas</h3>
                                  <ul className="space-y-3">
                                    <li className="flex justify-between text-sm"><span className="text-neutral-500">Subtotal</span><span className="font-medium">${(selectedOrder.subtotal || 0).toFixed(2)}</span></li>
                                    <li className="flex justify-between text-sm"><span className="text-neutral-500">Costo de Envío</span><span className="font-medium">${(selectedOrder.deliveryFee || 0).toFixed(2)}</span></li>
                                    <li className="flex justify-between text-sm"><span className="text-neutral-500">Tarifa de Servicio</span><span className="font-medium">${(selectedOrder.serviceFee || 0).toFixed(2)}</span></li>
                                    {(selectedOrder.taxAmount || 0) > 0 && <li className="flex justify-between text-sm"><span className="text-neutral-500">Impuestos</span><span className="font-medium">${(selectedOrder.taxAmount || 0).toFixed(2)}</span></li>}
                                    <li className="flex justify-between font-bold border-t border-black/5 pt-3"><span className="text-neutral-900">Total Pagado</span><span className="text-neutral-900">${(selectedOrder.totalAmount || 0).toFixed(2)}</span></li>
                                  </ul>
                                </div>

                                {/* LOGISTICA */}
                                <div>
                                  <h3 className="text-sm font-bold uppercase tracking-wider text-neutral-900 mb-4">Logística & SLA</h3>
                                  <ul className="space-y-3">
                                    <li className="flex justify-between text-sm"><span className="text-neutral-500">Dirección</span><span className="font-medium text-right max-w-[60%]">{selectedOrder.address?.street} {selectedOrder.address?.externalNumber}, {selectedOrder.address?.neighborhood}</span></li>
                                    {selectedOrder.address?.reference && <li className="flex justify-between text-sm"><span className="text-neutral-500">Referencias</span><span className="font-medium text-right max-w-[60%]">{selectedOrder.address?.reference}</span></li>}
                                    {selectedOrder.notes && <li className="flex justify-between text-sm"><span className="text-neutral-500">Notas para Repartidor</span><span className="font-medium text-right max-w-[60%] italic">{selectedOrder.notes}</span></li>}
                                    <li className="flex justify-between text-sm"><span className="text-neutral-500">PIN de Seguridad</span><span className="font-mono font-bold tracking-widest">{selectedOrder.handoverPin || 'N/A'}</span></li>
                                    
                                    <li className="flex justify-between border-t border-black/5 pt-3 text-sm"><span className="text-neutral-500">ETA Prometido al Cliente</span><span className="font-medium">{selectedOrder.estimatedDeliveryTime ? new Date(selectedOrder.estimatedDeliveryTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'N/A'}</span></li>
                                    {selectedOrder.etaExtendedMinutes > 0 && <li className="flex justify-between text-sm"><span className="text-neutral-500">Extensión solicitada (Restaurante)</span><span className="font-medium text-amber-600">+{selectedOrder.etaExtendedMinutes} min</span></li>}
                                    
                                    {(() => {
                                      let delayText = 'A tiempo';
                                      let isLate = false;
                                      if (selectedOrder.estimatedDeliveryTime) {
                                        const actualEvent = selectedOrder.tracking?.find((t: any) => t.status === 'DELIVERED' || t.status === 'COMPLETED');
                                        const realDeliveredAt = selectedOrder.actualDeliveryTime ? new Date(selectedOrder.actualDeliveryTime) : (actualEvent ? new Date(actualEvent.createdAt) : null);
                                        const compareTime = realDeliveredAt || new Date();
                                        
                                        const diffMs = compareTime.getTime() - new Date(selectedOrder.estimatedDeliveryTime).getTime();
                                        const diffMin = Math.floor(diffMs / 60000);
                                        
                                        if (diffMin > 0) {
                                          isLate = true;
                                          delayText = diffMin > 60 ? `${Math.floor(diffMin/60)}h ${diffMin%60}m` : `${diffMin} min`;
                                          if (!realDeliveredAt) delayText = 'Retrasado por ' + delayText;
                                        }
                                      }
                                      return (
                                        <li className="flex justify-between text-sm font-semibold">
                                          <span className="text-neutral-900">{selectedOrder.status === 'DELIVERED' || selectedOrder.status === 'COMPLETED' ? 'Demora Real de Entrega' : 'Estado de Tiempo'}</span>
                                          <span className={isLate ? 'text-rose-600' : 'text-emerald-600'}>{delayText}</span>
                                        </li>
                                      );
                                    })()}
                                  </ul>
                                </div>
                              </div>
                              
                              <div>
                                <h3 className="text-sm font-bold uppercase tracking-wider text-neutral-900 mb-4">Línea de Tiempo</h3>
                                <div className="space-y-4">
                                  {selectedOrder.tracking?.map((track: any) => (
                                    <div key={track.id} className="flex gap-4">
                                      <div className="w-16 shrink-0 text-xs text-neutral-400 text-right pt-0.5">
                                        <div className="font-semibold">{new Date(track.createdAt).toLocaleDateString()}</div>
                                        <div>{new Date(track.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                                      </div>
                                      <div className="relative pb-4 last:pb-0">
                                        <div className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-indigo-500"></div>
                                        <div className="absolute left-[3px] top-4 -bottom-4 w-px bg-black/10 last:hidden"></div>
                                        <div className="pl-6">
                                          <p className="text-sm font-semibold text-neutral-900">
                                            {{
                                              PENDING: 'Pendiente', CONFIRMED: 'Confirmado', PREPARING: 'Preparando',
                                              READY: 'Listo', PICKED_UP: 'Recogido', IN_TRANSIT: 'En Camino',
                                              DELIVERED: 'Entregado', COMPLETED: 'Recogido en tienda', CANCELLED: 'Cancelado', REJECTED: 'Rechazado'
                                            }[track.status as string] || track.status}
                                          </p>
                                          {track.notes && <p className="text-xs text-neutral-500 mt-1">{track.notes}</p>}
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>

                            <div className="border-t border-black/10 pt-6">
                              <h3 className="text-sm font-bold uppercase tracking-wider text-rose-800 mb-4">Acciones Operativas</h3>
                              <div className="flex flex-wrap gap-4">
                                <button
                                  onClick={() => handleCancelOrder(selectedOrder.id)}
                                  disabled={selectedOrder.status === 'DELIVERED' || selectedOrder.status === 'CANCELLED'}
                                  className="rounded-full bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                                >
                                  Forzar Cancelación
                                </button>
                                <button
                                  onClick={() => handleReassignOrder(selectedOrder.id)}
                                  disabled={!selectedOrder.driver || selectedOrder.status === 'DELIVERED' || selectedOrder.status === 'CANCELLED'}
                                  className="rounded-full bg-white border border-rose-200 text-rose-700 px-5 py-2.5 text-sm font-semibold transition hover:bg-rose-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  Liberar Repartidor
                                </button>
                              </div>
                              <p className="mt-3 text-xs text-neutral-500">Estas acciones registrarán una nota obligatoria en la auditoría del pedido y el cliente será notificado automáticamente (si aplica).</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {activeSection === 'restaurants' ? (
              <div className="space-y-8">
                {/* Métricas */}
                <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                  <MetricCard
                    label="Restaurantes totales"
                    value={String(restaurantOverview?.totalRestaurants || summary.total)}
                    detail="Base completa registrada"
                  />
                  <MetricCard
                    label="Con deuda activa"
                    value={String(restaurantOverview?.restaurantsWithDebt || 0)}
                    detail="Requieren seguimiento de cobro"
                  />
                  <MetricCard
                    label="Deuda pendiente"
                    value={formatCurrency(restaurantOverview?.totalPastDebt || 0)}
                    detail="Cortes anteriores sin pagar"
                  />
                  <MetricCard
                    label="Deuda acumulada"
                    value={formatCurrency(restaurantOverview?.totalAccruedDebt || 0)}
                    detail="Comisiones del periodo actual"
                  />
                  <MetricCard
                    label="Ciclo dominante"
                    value={
                      (restaurantOverview?.weeklyBillingRestaurants || 0) >=
                      (restaurantOverview?.monthlyBillingRestaurants || 0)
                        ? 'Semanal'
                        : 'Mensual'
                    }
                    detail="Configuración más usada"
                  />
                </section>

                {/* Control Bar (Filtros y Acción) */}
                <div className="sticky top-20 z-10 -mx-4 px-4 py-3 md:static md:mx-0 md:px-0 md:py-0">
                  <div className="flex flex-col gap-4 rounded-3xl bg-white/80 p-3 shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-black/5 backdrop-blur-xl md:flex-row md:items-center md:justify-between md:p-4">
                    <form
                      onSubmit={loadRestaurants}
                      className="flex flex-1 flex-col flex-wrap items-center gap-3 md:flex-row"
                    >
                      <div className="relative w-full md:w-64">
                        <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <input
                          placeholder="Buscar restaurante..."
                          className="w-full rounded-2xl border-none bg-neutral-100/50 py-2.5 pl-10 pr-4 text-sm text-neutral-900 outline-none ring-1 ring-inset ring-black/5 transition focus:bg-white focus:ring-2 focus:ring-black/10"
                          type="text"
                          value={restaurantFilters.search}
                          onChange={(e) => setRestaurantFilters((current) => ({ ...current, search: e.target.value }))}
                        />
                      </div>
                      <select
                        className="w-full rounded-2xl border-none bg-neutral-100/50 py-2.5 px-4 text-sm text-neutral-600 outline-none ring-1 ring-inset ring-black/5 transition focus:bg-white focus:ring-2 focus:ring-black/10 md:w-auto"
                        value={restaurantFilters.status}
                        onChange={(e) => setRestaurantFilters((current) => ({ ...current, status: e.target.value as RestaurantFilters['status'] }))}
                      >
                        <option value="">Estado: Todos</option>
                        <option value="ACTIVE">Activos</option>
                        <option value="SUSPENDED">Suspendidos</option>
                        <option value="DELETED">Eliminados</option>
                      </select>
                      <select
                        className="w-full rounded-2xl border-none bg-neutral-100/50 py-2.5 px-4 text-sm text-neutral-600 outline-none ring-1 ring-inset ring-black/5 transition focus:bg-white focus:ring-2 focus:ring-black/10 md:w-auto"
                        value={restaurantFilters.businessType}
                        onChange={(e) => setRestaurantFilters((current) => ({ ...current, businessType: e.target.value as RestaurantFilters['businessType'] }))}
                      >
                        <option value="">Tipo: Todos</option>
                        <option value="RESTAURANT">Restaurante</option>
                        <option value="STORE">Tienda</option>
                      </select>
                      <select
                        className="w-full rounded-2xl border-none bg-neutral-100/50 py-2.5 px-4 text-sm text-neutral-600 outline-none ring-1 ring-inset ring-black/5 transition focus:bg-white focus:ring-2 focus:ring-black/10 md:w-auto"
                        value={restaurantFilters.region}
                        onChange={(e) => setRestaurantFilters((current) => ({ ...current, region: e.target.value }))}
                      >
                        <option value="">Zona: Todas</option>
                        {regions.map((regionItem) => (
                          <option key={regionItem.code} value={regionItem.code}>{regionItem.name}</option>
                        ))}
                      </select>
                      <div className="flex w-full justify-end gap-2 md:w-auto">
                        <button
                          type="button"
                          onClick={() => {
                            const cleared: RestaurantFilters = { search: '', status: '', region: '', businessType: '' };
                            setRestaurantFilters(cleared);
                            void loadRestaurants(undefined, cleared);
                          }}
                          className="rounded-full px-4 py-2.5 text-sm font-semibold text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900"
                        >
                          Limpiar
                        </button>
                        <button
                          type="submit"
                          className="rounded-full bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-black"
                        >
                          Filtrar
                        </button>
                      </div>
                    </form>

                    <div className="hidden h-8 w-px bg-black/5 md:block" />

                    <button
                      type="button"
                      onClick={openCreateRestaurantModal}
                      className="group relative w-full overflow-hidden rounded-full bg-neutral-950 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-neutral-900/20 ring-1 ring-black/10 transition hover:bg-neutral-900 md:w-auto"
                    >
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] transition-transform duration-700 ease-out group-hover:translate-x-[100%]" />
                      <span className="relative flex items-center justify-center gap-2">
                        Agregar nuevo
                        <svg className="h-4 w-4 transition-transform group-hover:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                      </span>
                    </button>
                  </div>
                </div>

                {/* Lista de Restaurantes */}
                <PanelCard
                  title="Directorio de restaurantes"
                  subtitle="Vista operativa"
                  aside={`${restaurants.length} resultados`}
                >
                  {restaurants.length > 0 ? (
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                      {restaurants.map((restaurant) => (
                        <Link
                          key={restaurant.id}
                          href={`/restaurantes/${restaurant.id}`}
                          className="group relative flex flex-col overflow-hidden rounded-[24px] bg-white p-5 shadow-sm ring-1 ring-black/5 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_12px_40px_-10px_rgba(0,0,0,0.1)] hover:ring-black/10"
                        >
                          {/* Resplandor sutil en hover */}
                          <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-neutral-100 opacity-0 blur-2xl transition duration-500 group-hover:opacity-100" />
                          
                          <div className="relative flex items-start gap-4">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-neutral-50 text-sm font-semibold text-neutral-500 shadow-inner ring-1 ring-black/5 transition group-hover:ring-black/10">
                              {restaurant.logo ? (
                                <img
                                  src={restaurant.logo}
                                  alt={`Logo de ${restaurant.name}`}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <span>{getRestaurantInitials(restaurant.name)}</span>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-base font-semibold tracking-tight text-neutral-900 transition group-hover:text-black">
                                {restaurant.name}
                              </p>
                              <div className="mt-1 flex flex-wrap items-center gap-2">
                                <span className="truncate text-xs font-medium text-neutral-500">
                                  {restaurant.region || 'Sin zona'}
                                </span>
                                {restaurant.businessType && restaurant.businessType !== 'RESTAURANT' && (
                                  <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-700 ring-1 ring-violet-200/50">
                                    {businessTypeLabel(restaurant.businessType)}
                                  </span>
                                )}
                                <RestaurantBillingStatusPill restaurant={restaurant} />
                              </div>
                            </div>
                          </div>
                          
                          {(restaurant as any)._count?.billingSettlements > 0 && (
                            <div className="absolute top-3 right-3 flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 ring-1 ring-amber-500/20 shadow-sm z-10">
                               <span className="relative flex h-2 w-2 items-center justify-center">
                                 <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 bg-amber-500"></span>
                                 <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-600"></span>
                               </span>
                               <span className="text-[9px] font-bold uppercase tracking-wider text-amber-700">Revisión de Pago</span>
                            </div>
                          )}

                          {restaurant.billingSummary && (restaurant.billingSummary.pastDebt > 0 || restaurant.billingSummary.serviceFeeRevenue + restaurant.billingSummary.platformFeeRevenue + restaurant.billingSummary.whatsappFeeRevenue > 0) && (
                            <div className="relative mt-4 rounded-xl bg-gradient-to-br from-amber-50 to-orange-50/50 p-3 ring-1 ring-amber-500/10 space-y-2">
                              {restaurant.billingSummary.pastDebt > 0 && (
                                <div>
                                  <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600/80">Deuda Pendiente</p>
                                  <p className="text-sm font-semibold text-amber-700">{formatCurrency(restaurant.billingSummary.pastDebt)}</p>
                                </div>
                              )}
                              {restaurant.billingSummary.serviceFeeRevenue + restaurant.billingSummary.platformFeeRevenue + restaurant.billingSummary.whatsappFeeRevenue > 0 && (
                                <div>
                                  <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600/80">Deuda Acumulada</p>
                                  <p className="text-sm font-semibold text-amber-700">{formatCurrency(restaurant.billingSummary.serviceFeeRevenue + restaurant.billingSummary.platformFeeRevenue + restaurant.billingSummary.whatsappFeeRevenue)}</p>
                                </div>
                              )}
                            </div>
                          )}
                        </Link>
                      ))}
                    </div>
                  ) : !loading && !error ? (
                    <EmptyState text="Aun no hay restaurantes cargados para esta vista administrativa." />
                  ) : (
                    <EmptyState text="No hay resultados para los filtros actuales." />
                  )}
                </PanelCard>
              </div>
            ) : null}

                        {activeSection === 'drivers' ? (
              <div className="space-y-6">
                <section className="relative overflow-hidden rounded-[32px] border border-black/5 bg-white p-6 shadow-[0_20px_70px_rgba(15,15,15,0.06)] md:p-8">
                  <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-gradient-to-br from-neutral-100 to-transparent opacity-50 blur-3xl"></div>
                  <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div className="max-w-3xl">
                      <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-neutral-400">Flota y Operativa</p>
                      <h1 className="mt-2 text-[2rem] font-bold tracking-tight text-neutral-950 md:text-[2.5rem]">
                        Centro de Control de Repartidores
                      </h1>
                      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-neutral-500">
                        Supervisa disponibilidad, estado de licencias, y aplica medidas preventivas ante anomalías operativas de forma inteligente.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={openCreateDriverModal}
                      className="group relative inline-flex items-center justify-center overflow-hidden rounded-full bg-neutral-950 px-6 py-3.5 text-sm font-semibold text-white transition-all hover:scale-105 hover:bg-neutral-900 hover:shadow-xl hover:shadow-neutral-900/20 active:scale-95"
                    >
                      <span className="relative z-10 flex items-center gap-2">
                        Agregar repartidor
                        <svg className="h-4 w-4 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>
                      </span>
                    </button>
                  </div>
                </section>

                <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-6">
                  <div className="group relative overflow-hidden rounded-[26px] bg-white p-5 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] ring-1 ring-black/5 transition hover:-translate-y-0.5 hover:shadow-[0_8px_30px_-4px_rgba(0,0,0,0.1)]">
                    <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br from-neutral-100 to-transparent opacity-50 blur-2xl transition group-hover:scale-150 group-hover:from-neutral-200"></div>
                    <div className="relative">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400">Flota total</p>
                      <p className="mt-3 text-3xl font-semibold tracking-tight text-neutral-900">{driverOverview?.totalDrivers || 0}</p>
                      <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-600">
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
                        {driverOverview?.newDriversThisMonth || 0} altas este mes
                      </p>
                    </div>
                  </div>
                  <div className="group relative overflow-hidden rounded-[26px] bg-white p-5 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] ring-1 ring-black/5 transition hover:-translate-y-0.5 hover:shadow-[0_8px_30px_-4px_rgba(0,0,0,0.1)]">
                    <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br from-neutral-100 to-transparent opacity-50 blur-2xl transition group-hover:scale-150 group-hover:from-neutral-200"></div>
                    <div className="relative">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400">Disponibles ahora</p>
                      <p className="mt-3 text-3xl font-semibold tracking-tight text-neutral-900">{driverOverview?.availableDrivers || 0}</p>
                      <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-indigo-600">
                        <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75"></span><span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-500"></span></span>
                        {driverOverview?.busyDrivers || 0} ocupados en ruta
                      </p>
                    </div>
                  </div>
                  <div className="group relative overflow-hidden rounded-[26px] bg-white p-5 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] ring-1 ring-black/5 transition hover:-translate-y-0.5 hover:shadow-[0_8px_30px_-4px_rgba(0,0,0,0.1)]">
                    <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br from-neutral-100 to-transparent opacity-50 blur-2xl transition group-hover:scale-150 group-hover:from-neutral-200"></div>
                    <div className="relative">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400">Anomalías (Suspendidos)</p>
                      <p className="mt-3 text-3xl font-semibold tracking-tight text-neutral-900">{driverOverview?.suspendedDrivers || 0}</p>
                      <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-amber-600">
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                        {driverOverview?.driversWithExpiredLicense || 0} licencias críticas
                      </p>
                    </div>
                  </div>
                  <div className="group relative overflow-hidden rounded-[26px] bg-white p-5 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] ring-1 ring-black/5 transition hover:-translate-y-0.5 hover:shadow-[0_8px_30px_-4px_rgba(0,0,0,0.1)]">
                    <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br from-amber-50 to-orange-50 opacity-50 blur-2xl transition group-hover:scale-150 group-hover:from-amber-100"></div>
                    <div className="relative">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400">Deuda pendiente</p>
                      <p className="mt-3 text-3xl font-semibold tracking-tight text-neutral-900">{formatCurrency(driverOverview?.totalPastDebt || 0)}</p>
                      <p className="mt-2 text-xs font-medium text-amber-600">Cortes anteriores sin pagar</p>
                    </div>
                  </div>
                  <div className="group relative overflow-hidden rounded-[26px] bg-white p-5 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] ring-1 ring-black/5 transition hover:-translate-y-0.5 hover:shadow-[0_8px_30px_-4px_rgba(0,0,0,0.1)]">
                    <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br from-sky-50 to-blue-50 opacity-50 blur-2xl transition group-hover:scale-150 group-hover:from-sky-100"></div>
                    <div className="relative">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400">Deuda acumulada</p>
                      <p className="mt-3 text-3xl font-semibold tracking-tight text-neutral-900">{formatCurrency(driverOverview?.totalAccruedDebt || 0)}</p>
                      <p className="mt-2 text-xs font-medium text-sky-600">Comisiones del periodo actual</p>
                    </div>
                  </div>
                  <div className="group relative overflow-hidden rounded-[26px] bg-white p-5 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] ring-1 ring-black/5 transition hover:-translate-y-0.5 hover:shadow-[0_8px_30px_-4px_rgba(0,0,0,0.1)]">
                    <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br from-neutral-100 to-transparent opacity-50 blur-2xl transition group-hover:scale-150 group-hover:from-neutral-200"></div>
                    <div className="relative">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400">Desempeño global</p>
                      <p className="mt-3 text-3xl font-semibold tracking-tight text-neutral-900">{driverOverview?.totalDeliveries || 0} <span className="text-sm font-medium text-neutral-400">entregas</span></p>
                      <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-neutral-500">
                        ⭐ Rating medio {driverOverview?.averageRating?.toFixed(1) || '0.0'}
                      </p>
                    </div>
                  </div>
                </div>

                <section className="rounded-[28px] border border-black/5 bg-white p-5 shadow-[0_4px_20px_rgba(0,0,0,0.04)] md:p-6">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-neutral-400">Búsqueda y cobertura</p>
                      <h3 className="mt-0.5 text-lg font-bold tracking-tight text-neutral-900">Filtro de flota</h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1 text-xs font-bold text-neutral-600 ring-1 ring-inset ring-black/5">
                        <span className={`h-1.5 w-1.5 rounded-full ${loadingDrivers ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500'}`} />
                        {loadingDrivers ? 'Actualizando...' : `${driversTotal} repartidores`}
                      </span>
                      {(driverFilters.search || driverFilters.status || driverFilters.availability || driverFilters.region || driverFilters.debt) && (
                        <button
                          type="button"
                          onClick={() => { setDriverFilters({ search: '', status: '', availability: '', region: '', debt: '' }); }}
                          className="inline-flex items-center gap-1 rounded-full border border-black/10 px-3 py-1 text-xs font-semibold text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900"
                        >
                          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                          Limpiar filtros
                        </button>
                      )}
                    </div>
                  </div>
                  <form onSubmit={loadDrivers} className="flex flex-wrap gap-3">
                    {/* Search */}
                    <div className="relative flex-1 min-w-[200px]">
                      <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                      <input
                        placeholder="Nombre, teléfono..."
                        className="h-10 w-full rounded-full border border-black/10 bg-neutral-50 pl-9 pr-4 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 hover:bg-white focus:border-neutral-400 focus:bg-white focus:ring-2 focus:ring-neutral-100"
                        type="text"
                        value={driverFilters.search}
                        onChange={(e) => setDriverFilters((f) => ({ ...f, search: e.target.value }))}
                      />
                    </div>
                    {/* Status */}
                    <select
                      className="h-10 rounded-full border border-black/10 bg-neutral-50 px-4 text-sm font-medium text-neutral-700 outline-none transition hover:bg-white focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100 cursor-pointer"
                      value={driverFilters.status}
                      onChange={(e) => {
                        const v = e.target.value as typeof driverFilters.status;
                        setDriverFilters((f) => ({ ...f, status: v }));
                      }}
                    >
                      <option value="">Todos los estados</option>
                      <option value="ACTIVE">Activos</option>
                      <option value="SUSPENDED">Suspendidos</option>
                      <option value="INACTIVE">Inactivos</option>
                    </select>
                    {/* Availability */}
                    <select
                      className="h-10 rounded-full border border-black/10 bg-neutral-50 px-4 text-sm font-medium text-neutral-700 outline-none transition hover:bg-white focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100 cursor-pointer"
                      value={driverFilters.availability}
                      onChange={(e) => {
                        const v = e.target.value as typeof driverFilters.availability;
                        setDriverFilters((f) => ({ ...f, availability: v }));
                      }}
                    >
                      <option value="">Toda disponibilidad</option>
                      <option value="AVAILABLE">Disponible</option>
                      <option value="BUSY">En ruta</option>
                      <option value="OFFLINE">Offline</option>
                    </select>
                    {/* Region */}
                    <select
                      className="h-10 rounded-full border border-black/10 bg-neutral-50 px-4 text-sm font-medium text-neutral-700 outline-none transition hover:bg-white focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100 cursor-pointer"
                      value={driverFilters.region}
                      onChange={(e) => {
                        setDriverFilters((f) => ({ ...f, region: e.target.value }));
                      }}
                    >
                      <option value="">Todas las zonas</option>
                      {regions.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
                    </select>
                    {/* Debt status */}
                    <select
                      className="h-10 rounded-full border border-black/10 bg-neutral-50 px-4 text-sm font-medium text-neutral-700 outline-none transition hover:bg-white focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100 cursor-pointer"
                      value={driverFilters.debt}
                      onChange={(e) => {
                        setDriverFilters((f) => ({ ...f, debt: e.target.value as typeof driverFilters.debt }));
                      }}
                    >
                      <option value="">Toda deuda</option>
                      <option value="none">Sin deuda</option>
                      <option value="current">Deuda actual</option>
                      <option value="overdue">Deuda vencida</option>
                      <option value="suspended">Suspendido por deuda</option>
                    </select>
                    {/* Submit */}
                    <button
                      type="submit"
                      className="h-10 rounded-full bg-neutral-950 px-5 text-sm font-semibold text-white transition hover:bg-neutral-800 active:scale-95 flex items-center gap-2 shadow-sm"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                      Buscar
                    </button>
                  </form>
                </section>

                <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
                  <section className="flex flex-col overflow-hidden rounded-[28px] border border-black/5 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
                    <div className="border-b border-black/5 bg-neutral-50/30 px-5 py-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400">Vista priorizada</p>
                          <h3 className="mt-0.5 text-base font-bold tracking-tight text-neutral-900">Directorio de flota</h3>
                        </div>
                        <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-bold text-neutral-500">{drivers.length}</span>
                      </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3" style={{ maxHeight: 'calc(100vh - 380px)', minHeight: '520px' }}>
                      {drivers.length ? (
                        <div className="space-y-1.5">
                          {drivers.map((driver) => {
                            const hasDeliveries = (driver as any).totalDeliveries > 0;
                            const hasPendingReview = (driver._count?.settlements ?? 0) > 0;
                            const hasAlert = driver.licenseState === 'expired' || (hasDeliveries && driver.rating < 3.5) || driver.status === 'SUSPENDED';
                            const isSelected = selectedDriverId === driver.id;
                            return (
                              <button
                                key={driver.id}
                                type="button"
                                onClick={() => setSelectedDriverId(driver.id)}
                                className={`group relative w-full overflow-hidden rounded-[20px] border p-3.5 text-left transition-all duration-200 ${
                                  isSelected
                                    ? 'border-neutral-950 bg-neutral-950 shadow-lg shadow-neutral-950/10'
                                    : 'border-black/5 bg-white hover:border-black/10 hover:bg-neutral-50/80 hover:shadow-sm'
                                }`}
                              >
                                {hasAlert && !isSelected && (
                                  <div className="absolute right-0 top-0 h-full w-1 rounded-r-[20px] bg-rose-500" />
                                )}
                                <div className="flex items-center gap-3">
                                  <div className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-black transition-colors ${
                                    isSelected ? 'bg-white/15 text-white' : 'bg-neutral-100 text-neutral-700'
                                  }`}>
                                    {getRestaurantInitials(driver.user.name)}
                                    {driver.availability === 'BUSY' && (
                                      <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-amber-400" />
                                    )}
                                    {driver.availability === 'AVAILABLE' && (
                                      <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />
                                    )}
                                    {driver.availability === 'OFFLINE' && (
                                      <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-neutral-400" />
                                    )}
                                    {driver.debtStatus === 'current' && (
                                      <span className="absolute -top-0.5 -left-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-amber-400" />
                                    )}
                                    {driver.debtStatus === 'overdue' && (
                                      <span className="absolute -top-0.5 -left-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-rose-500" />
                                    )}
                                    {driver.debtStatus === 'suspended' && (
                                      <span className="absolute -top-0.5 -left-0.5 flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-600 opacity-75"></span><span className="relative inline-flex h-2.5 w-2.5 rounded-full border-2 border-white bg-rose-600"></span></span>
                                    )}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className={`truncate text-sm font-bold ${ isSelected ? 'text-white' : 'text-neutral-900'}`}>
                                      {driver.user.name}
                                    </p>
                                    <p className={`mt-0.5 truncate text-xs ${ isSelected ? 'text-white/60' : 'text-neutral-400'}`}>
                                      {driver.user.phone}
                                    </p>
                                  </div>
                                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                                    <DriverStatusPill status={driver.status} inverted={isSelected} />
                                    {hasPendingReview && (
                                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-500 ring-1 ring-inset ring-amber-500/20">
                                        <span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75"></span><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500"></span></span>
                                        Revisar Pago
                                      </span>
                                    )}
                                    {driver.debtStatus === 'current' && (
                                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-500 ring-1 ring-inset ring-amber-500/20">
                                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                        Deuda actual
                                      </span>
                                    )}
                                    {driver.debtStatus === 'overdue' && (
                                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-rose-500 ring-1 ring-inset ring-rose-500/20">
                                        <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                                        Deuda vencida
                                      </span>
                                    )}
                                    {driver.debtStatus === 'suspended' && (
                                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-600/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-rose-600 ring-1 ring-inset ring-rose-600/30">
                                        <span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-600 opacity-75"></span><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-rose-600"></span></span>
                                        Suspendido
                                      </span>
                                    )}
                                    {!hasPendingReview && hasAlert ? (
                                      <span className="inline-flex items-center rounded-full bg-rose-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-rose-500 ring-1 ring-inset ring-rose-500/20">
                                        ⚠ Alerta
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      ) : loadingDrivers ? (
                        <div className="flex h-full items-center justify-center">
                          <div className="space-y-2 text-center">
                            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-neutral-200 border-t-neutral-600" />
                            <p className="text-xs font-medium text-neutral-400">Cargando flota...</p>
                          </div>
                        </div>
                      ) : (
                        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
                          <svg className="h-8 w-8 text-neutral-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                          <p className="text-sm font-medium text-neutral-400">Sin resultados para los filtros aplicados.</p>
                        </div>
                      )}
                    </div>
                  </section>

                  <div className="space-y-6">
                    {selectedDriver ? (
                      <>
                        {/* Risk & Anomaly Banner */}
                        {(() => {
                          const hasDeliveries = selectedDriver.summary.totalDeliveries > 0;
                          const isNewDriver = !hasDeliveries;
                          const ratingAlert = hasDeliveries && selectedDriver.summary.averageRating < 3.5;
                          const gpsAlert = !isNewDriver && selectedDriver.status === 'ACTIVE' && !selectedDriver.summary.lastKnownLocation;
                          const licenseAlert = selectedDriver.licenseState === 'expired';
                          const suspendedAlert = selectedDriver.status === 'SUSPENDED';

                          if (!ratingAlert && !gpsAlert && !licenseAlert && !suspendedAlert) return null;

                          return (
                            <div className="animate-fade-in flex items-start gap-4 rounded-[28px] border border-rose-200 bg-rose-50/50 p-5 shadow-sm ring-1 ring-inset ring-rose-500/10">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600">
                                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                              </div>
                              <div>
                                <h4 className="font-bold text-rose-900">Anomalía Operativa Detectada</h4>
                                <ul className="mt-1 list-inside list-disc text-sm font-medium text-rose-700">
                                  {licenseAlert && <li>La licencia de conducir ha expirado. RIESGO LEGAL.</li>}
                                  {ratingAlert && <li>El rating promedio es crítico ({selectedDriver.summary.averageRating.toFixed(1)}). RIESGO DE SERVICIO.</li>}
                                  {suspendedAlert && <li>La cuenta está actualmente suspendida de operaciones.</li>}
                                  {gpsAlert && <li>El conductor figura activo pero el GPS no reporta señal de ubicación.</li>}
                                </ul>
                              </div>
                            </div>
                          );
                        })()}

                        <section className="rounded-[32px] border border-black/5 bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
                          <div className="border-b border-black/5 bg-neutral-50/50 p-6 md:p-8">
                            <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
                              <div className="flex items-center gap-5">
                                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-[24px] bg-neutral-950 text-2xl font-bold text-white shadow-xl shadow-neutral-950/20">
                                  {getRestaurantInitials(selectedDriver.user.name)}
                                </div>
                                <div>
                                  <h2 className="text-2xl font-bold text-neutral-950">{selectedDriver.user.name}</h2>
                                  <p className="mt-1 font-medium text-neutral-500">{selectedDriver.user.phone} · {selectedDriver.user.email}</p>
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    <DriverStatusPill status={selectedDriver.status} />
                                    <DriverAvailabilityPill availability={selectedDriver.availability} />
                                    <LicenseStatePill state={selectedDriver.licenseState} />
                                  </div>
                                </div>
                              </div>
                              <div className="text-left md:text-right">
                                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400">Zona Asignada</p>
                                <p className="mt-1 font-semibold text-neutral-900">{formatRegionLabel(selectedDriver.region, regions)}</p>
                              </div>
                            </div>
                          </div>
                          
                          <div className="grid gap-px bg-black/5 sm:grid-cols-2 lg:grid-cols-4">
                            <div className="bg-white p-6">
                              <p className="text-xs font-bold uppercase text-neutral-400">Total Entregas</p>
                              <p className="mt-2 text-2xl font-bold text-neutral-900">{selectedDriver.summary.totalDeliveries}</p>
                            </div>
                            <div className="bg-white p-6">
                              <p className="text-xs font-bold uppercase text-neutral-400">Rating Promedio</p>
                              <p className="mt-2 text-2xl font-bold text-neutral-900 flex items-center gap-2">
                                {selectedDriver.summary.averageRating.toFixed(1)}
                                <svg className="h-5 w-5 text-amber-400" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10.868 2.884c-.321-.772-1.415-.772-1.736 0l-1.83 4.401-4.753.381c-.833.067-1.171 1.107-.536 1.651l3.62 3.102-1.106 4.637c-.194.813.691 1.456 1.405 1.02L10 15.591l4.069 2.485c.713.436 1.598-.207 1.404-1.02l-1.106-4.637 3.62-3.102c.635-.544.297-1.584-.536-1.65l-4.752-.382-1.831-4.401z" clipRule="evenodd" /></svg>
                              </p>
                            </div>
                            <div className="bg-white p-6">
                              <p className="text-xs font-bold uppercase text-neutral-400">Tiempo Promedio</p>
                              <p className="mt-2 text-2xl font-bold text-neutral-900">{selectedDriver.stats?.avgDeliveryTime || 0} <span className="text-sm font-medium text-neutral-400">min</span></p>
                            </div>
                            <div className="bg-white p-6">
                              <p className="text-xs font-bold uppercase text-neutral-400">Ubicación GPS</p>
                              {selectedDriver.summary.lastKnownLocation ? (
                                <p className="mt-2 text-sm font-bold text-emerald-600">Señal Activa</p>
                              ) : (
                                <p className="mt-2 text-sm font-bold text-rose-600">Sin Señal</p>
                              )}
                            </div>
                          </div>
                        </section>

                        <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
                          <div className="space-y-6">
                            <section className="rounded-[32px] border border-rose-100 bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
                              <div className="border-b border-rose-100 bg-rose-50/30 p-6">
                                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-rose-500">Gestión de Riesgo</p>
                                <h3 className="mt-1 text-lg font-bold text-neutral-900">Auditoría y Estado</h3>
                              </div>
                              <div className="p-6">
                                <form onSubmit={updateDriverStatus} className="space-y-5">
                                  <label className="grid gap-2 text-sm">
                                    <span className="font-bold text-neutral-800">Forzar nuevo estado</span>
                                    <select 
                                      className="rounded-2xl border border-black/10 bg-neutral-50/50 px-4 py-3.5 font-medium text-neutral-950 outline-none transition-all focus:border-rose-300 focus:bg-white focus:ring-4 focus:ring-rose-100"
                                      value={driverActionStatus}
                                      onChange={(e) => setDriverActionStatus(e.target.value as DriverAccountStatus)}
                                    >
                                      <option value="ACTIVE">Activar cuenta</option>
                                      <option value="SUSPENDED">Suspender cuenta</option>
                                      <option value="INACTIVE">Desactivar cuenta</option>
                                    </select>
                                  </label>
                                  <label className="grid gap-2 text-sm">
                                    <span className="font-bold text-neutral-800">Resolución administrativa</span>
                                    <textarea
                                      value={driverActionReason}
                                      onChange={(e) => setDriverActionReason(e.target.value)}
                                      placeholder="Motivo obligatorio para auditoría interna..."
                                      rows={4}
                                      className="rounded-2xl border border-black/10 bg-neutral-50/50 px-4 py-3.5 font-medium text-neutral-950 outline-none transition-all placeholder:text-neutral-400 focus:border-rose-300 focus:bg-white focus:ring-4 focus:ring-rose-100"
                                    />
                                  </label>
                                  <div className="flex flex-col gap-3 pt-2">
                                    <button
                                      type="submit"
                                      disabled={updatingDriverStatus || (driverActionStatus !== 'ACTIVE' && !driverActionReason.trim())}
                                      className="w-full rounded-full bg-neutral-950 py-3.5 text-sm font-bold text-white transition-all hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
                                    >
                                      {updatingDriverStatus ? 'Aplicando resolución...' : 'Ejecutar cambio'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void removeDriver()}
                                      disabled={removingDriver || !driverActionReason.trim()}
                                      className="w-full rounded-full border border-rose-200 bg-white py-3.5 text-sm font-bold text-rose-600 transition-all hover:bg-rose-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                      {removingDriver ? 'Ejecutando...' : 'Dar de baja definitiva (Peligro)'}
                                    </button>
                                  </div>
                                </form>
                              </div>
                            </section>

                            <section className="rounded-[32px] border bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
                              <div className="border-b border-black/5 bg-neutral-50/50 px-6 py-4 flex items-center justify-between">
                                <div>
                                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#A78BFA]">Saldo y Ganancias</p>
                                  <h3 className="text-lg font-bold text-neutral-900 mt-0.5">Resumen Financiero</h3>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-bold text-neutral-400">Tarifa por pedido:</span>
                                  <span className="rounded-full bg-neutral-100 px-3 py-1 text-sm font-bold text-neutral-900">${driverBillingFee.toFixed(1)}</span>
                                </div>
                              </div>
                              <div className="p-6 space-y-4">
                                {loadingDriverFinanzas ? (
                                  <div className="flex items-center justify-center py-8">
                                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-200 border-t-neutral-600" />
                                  </div>
                                ) : !driverFinanzas ? (
                                  <div className="py-6 text-center text-sm text-neutral-400">No se pudo cargar la información financiera.</div>
                                ) : (
                                  <>
                                    {/* Suspended Banner */}
                                    {selectedDriver.summary?.isSuspendedByDebt && (
                                      <div className="rounded-2xl bg-rose-600 p-4 text-white">
                                        <div className="flex items-center gap-2 mb-1">
                                          <span className="text-lg">🛑</span>
                                          <p className="font-black text-sm uppercase tracking-wider">Cuenta Suspendida por Deuda</p>
                                        </div>
                                        <p className="text-xs font-medium text-rose-100">
                                          Límite de pago superado. Se adeuda un total vencido de <strong className="text-white">{formatCurrency(selectedDriver.summary?.suspendedDebtAmount || 0)}</strong>. El repartidor no podrá conectarse hasta registrar el pago.
                                        </p>
                                      </div>
                                    )}


                                    {/* Current Week Debt */}
                                    {(driverFinanzas.currentDebt || 0) > 0 && (
                                      <div className="rounded-2xl bg-rose-50/50 border border-rose-200/50 p-4">
                                        <div className="flex justify-between items-start">
                                          <div>
                                            <p className="text-[9px] font-black uppercase tracking-wider text-rose-600">Comisión por Servicio Acumulada</p>
                                            <p className="text-[11px] text-neutral-500 mt-1 leading-relaxed">
                                              Deuda acumulada de esta semana. Se cortará el próximo domingo.
                                            </p>
                                          </div>
                                          <span className="text-xl">⚠️</span>
                                        </div>
                                        <div className="flex justify-between items-baseline mt-4 border-t border-rose-200/40 pt-3">
                                          <span className="text-xs font-black text-rose-800">Deuda acumulada:</span>
                                          <span className="text-2xl font-black text-rose-700">{formatCurrency(driverFinanzas.currentDebt)}</span>
                                        </div>
                                      </div>
                                    )}

                                    {/* No debt at all */}
                                    {driverFinanzas && (!driverFinanzas.currentDebt || driverFinanzas.currentDebt <= 0) && (!driverFinanzas.pastDebt || driverFinanzas.pastDebt <= 0) && (
                                      <div className="rounded-2xl bg-emerald-50/50 border border-emerald-200/50 p-4 text-center">
                                        <p className="text-2xl mb-1">✅</p>
                                        <p className="text-sm font-black text-emerald-700">Está al día</p>
                                        <p className="text-[10px] text-emerald-600 mt-0.5">No tiene deuda pendiente</p>
                                      </div>
                                    )}

                                    {/* Week in Progress */}
                                    <div className="rounded-2xl bg-sky-50/55 border border-sky-100 p-4">
                                      <p className="text-[9px] font-black uppercase tracking-wider text-sky-600">Semana en Curso</p>
                                      <div className="flex justify-between items-baseline mt-2">
                                        <span className="text-xs text-neutral-500">Ganancias estimadas:</span>
                                        <span className="text-xl font-black text-neutral-950">{formatCurrency(driverFinanzas.weeklyEarnings || 0)}</span>
                                      </div>
                                      <div className="flex justify-between items-baseline mt-1">
                                        <span className="text-xs text-neutral-500">Entregas de la semana:</span>
                                        <span className="text-xs font-black text-neutral-900">{driverFinanzas.weeklyTripsCount || 0} viajes</span>
                                      </div>
                                    </div>

                                    {/* Today's Activity */}
                                    <div className="rounded-2xl bg-neutral-50 p-4">
                                      <p className="text-[9px] font-black uppercase tracking-wider text-neutral-500">Actividad de Hoy</p>
                                      <div className="flex justify-between items-baseline mt-2">
                                        <span className="text-xs text-neutral-500">Ganancia neta hoy:</span>
                                        <span className="text-lg font-black text-neutral-950">{formatCurrency(driverFinanzas.todayEarnings || 0)}</span>
                                      </div>
                                      <div className="flex justify-between items-baseline mt-1">
                                        <span className="text-xs text-neutral-500">Entregas de hoy:</span>
                                        <span className="text-xs font-black text-neutral-900">{driverFinanzas.todayTripsCount || 0} viajes</span>
                                      </div>
                                    </div>

                                    {/* Tarifa form inline */}
                                    <form onSubmit={(e) => updateDriverBilling(e, false)} className="flex items-end gap-3 pt-2 border-t border-black/5">
                                      <div className="flex-1">
                                        <p className="text-[10px] font-bold text-neutral-500 mb-1">Tarifa por pedido (MXN)</p>
                                        <div className="relative">
                                          <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-neutral-400">$</span>
                                          <input
                                            type="number"
                                            min="0"
                                            step="0.5"
                                            className="w-full rounded-xl border border-black/10 bg-neutral-50 py-2.5 pl-7 pr-3 text-sm font-medium text-neutral-950 outline-none transition-all focus:border-emerald-300 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                                            value={driverBillingFee}
                                            onChange={(e) => setDriverBillingFee(Number(e.target.value))}
                                          />
                                        </div>
                                      </div>
                                      <button
                                        type="submit"
                                        disabled={updatingDriverBilling}
                                        className="shrink-0 rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-[10px] font-bold text-neutral-900 transition hover:bg-neutral-50 disabled:opacity-50"
                                      >
                                        {updatingDriverBilling ? '...' : 'Guardar'}
                                      </button>
                                    </form>
                                  </>
                                )}
                              </div>
                            </section>

                            {/* Driver Settlements */}
                            <section className="rounded-[32px] border border-black/5 bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
                              <div className="border-b border-black/5 p-6 bg-neutral-50/50">
                                <h3 className="font-bold text-neutral-900">Historial de Pagos</h3>
                                <p className="text-xs text-neutral-500 mt-1">Registro de cortes de caja liquidados</p>
                              </div>
                              <div className="divide-y divide-black/5 max-h-[300px] overflow-y-auto">
                                {driverSettlements.length === 0 ? (
                                  <div className="p-8 text-center text-neutral-400">
                                    <svg className="mx-auto h-12 w-12 text-neutral-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                    <p className="text-sm font-medium">No hay historial de pagos registrados aún.</p>
                                    <p className="text-xs mt-1">Los recibos aparecerán aquí al registrar un corte.</p>
                                  </div>
                                ) : (
                                  driverSettlements.map((settlement, i) => {
                                    const isDebtSettlement = (settlement.status === 'PENDING' || settlement.status === 'IN_REVIEW') && driverFinanzas?.pendingSettlement?.reference === settlement.reference && (driverFinanzas?.pastDebt || 0) > 0;
                                    return (
                                    <div key={settlement.id || i} className={`p-4 px-6 transition-colors ${
                                      settlement.status === 'IN_REVIEW' ? 'bg-amber-50/80 hover:bg-amber-100' :
                                      settlement.status === 'OVERDUE' ? 'bg-red-50/80 hover:bg-red-100' :
                                      settlement.status === 'PENDING' ? 'bg-neutral-50/80' :
                                      'hover:bg-neutral-50'
                                    }`}>
                                      <div className="flex justify-between items-start gap-4">
                                        <div className="min-w-0 flex-1">
                                          <p className="text-sm font-bold text-neutral-900">{formatDateTime(settlement.createdAt)}</p>
                                          <p className="text-xs text-neutral-500 font-medium mt-0.5">Periodo: {formatDateTime(settlement.periodStart).split(',')[0]} - {formatDateTime(settlement.periodEnd).split(',')[0]}</p>
                                          {settlement.reference && (
                                            <p className="text-[10px] font-mono text-neutral-400 mt-0.5">{settlement.reference}</p>
                                          )}
                                          {isDebtSettlement && (
                                            <p className="mt-2 text-[10px] font-medium text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5 inline-flex items-center gap-1.5 border border-amber-200/40">
                                              <span>●</span>Deuda: {formatCurrency(driverFinanzas.pastDebt)} — Cobro por servicio del periodo
                                            </p>
                                          )}
                                        </div>
                                        <div className="shrink-0 text-right">
                                          <p className={`text-lg font-black ${
                                            settlement.status === 'IN_REVIEW' ? 'text-amber-600' :
                                            settlement.status === 'OVERDUE' ? 'text-red-600' :
                                            settlement.status === 'REJECTED' ? 'text-rose-500' :
                                            settlement.status === 'PAID' ? 'text-emerald-600' :
                                            'text-neutral-600'
                                          }`}>{formatCurrency(
                                            isDebtSettlement
                                              ? driverFinanzas.pastDebt
                                              : settlement.amount
                                          )}</p>
                                          <p className={`text-[10px] font-bold uppercase tracking-wider mt-0.5 ${
                                            settlement.status === 'IN_REVIEW' ? 'text-amber-500' :
                                            settlement.status === 'OVERDUE' ? 'text-red-500' :
                                            settlement.status === 'REJECTED' ? 'text-rose-500' :
                                            settlement.status === 'PAID' ? 'text-emerald-500' :
                                            'text-neutral-400'
                                          }`}>
                                            {settlement.status === 'IN_REVIEW' ? 'En Revisión' :
                                             settlement.status === 'OVERDUE' ? 'Vencido' :
                                             settlement.status === 'REJECTED' ? 'Rechazado' :
                                             settlement.status === 'PAID' ? 'Pagado' :
                                             'Pendiente'}
                                          </p>
                                          {settlement.dueDate && settlement.status === 'PENDING' && (
                                            <p className="text-[9px] text-amber-600 font-bold mt-1">
                                              Límite: {formatDateTime(settlement.dueDate).split(',')[0]}
                                            </p>
                                          )}
                                        </div>
                                      </div>
                                      <div className="flex gap-2 mt-3 flex-wrap">
                                        {settlement.paymentProofUrl && (
                                          <button
                                            type="button"
                                            onClick={() => setViewingDriverProofUrl(settlement.paymentProofUrl)}
                                            className="text-[10px] font-bold uppercase tracking-wider text-amber-600 bg-amber-100 px-3 py-1 rounded-full hover:bg-amber-200"
                                          >
                                            Ver Comprobante
                                          </button>
                                        )}
                                        {settlement.status === 'IN_REVIEW' && (
                                          <>
                                            <button
                                              onClick={() => updateSettlementStatus(settlement.id, 'PAID')}
                                              disabled={settlementActionLoading === settlement.id}
                                              className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 bg-emerald-100 px-3 py-1 rounded-full hover:bg-emerald-200 disabled:opacity-50"
                                            >
                                              {settlementActionLoading === settlement.id ? '...' : 'Aprobar'}
                                            </button>
                                            <button
                                              onClick={() => updateSettlementStatus(settlement.id, 'REJECTED')}
                                              disabled={settlementActionLoading === settlement.id}
                                              className="text-[10px] font-bold uppercase tracking-wider text-rose-600 bg-rose-100 px-3 py-1 rounded-full hover:bg-rose-200 disabled:opacity-50"
                                            >
                                              Rechazar
                                            </button>
                                          </>
                                        )}
                                        {settlement.status === 'PAID' && (
                                          <div className="flex gap-2 items-center">
                                            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 bg-emerald-100 px-3 py-1 rounded-full">
                                              Pagado
                                            </span>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                if (confirm('¿Revertir este pago? La deuda volverá a estado PENDIENTE y el repartidor deberá pagar nuevamente.')) {
                                                  void updateSettlementStatus(settlement.id, 'REVERT');
                                                }
                                              }}
                                              disabled={settlementActionLoading === settlement.id}
                                              className="text-[10px] font-bold uppercase tracking-wider text-amber-600 bg-amber-100 px-3 py-1 rounded-full hover:bg-amber-200 disabled:opacity-50"
                                            >
                                              Revertir
                                            </button>
                                          </div>
                                        )}
                                        {settlement.status === 'OVERDUE' && (
                                          <span className="text-[10px] font-bold uppercase tracking-wider text-red-600 bg-red-100 px-3 py-1 rounded-full animate-pulse">
                                            Vencido
                                          </span>
                                        )}
                                        {settlement.status === 'REJECTED' && (
                                          <span className="text-[10px] font-bold uppercase tracking-wider text-rose-600 bg-rose-100 px-3 py-1 rounded-full">
                                            Rechazado
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    );
                                  })
                                )}
                              </div>
                            </section>

                            <section className="rounded-[32px] border border-black/5 bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-6">
                              <h3 className="font-bold text-neutral-900 mb-4">Información Legal</h3>
                              <div className="space-y-3">
                                <div className="flex justify-between border-b border-black/5 pb-2 text-sm">
                                  <span className="font-medium text-neutral-500">Documento</span>
                                  <span className="font-bold text-neutral-900">{selectedDriver.documentType} {selectedDriver.documentNumber}</span>
                                </div>
                                <div className="flex justify-between border-b border-black/5 pb-2 text-sm">
                                  <span className="font-medium text-neutral-500">Cuenta Bancaria</span>
                                  <span className="font-bold text-neutral-900">{selectedDriver.bankAccount || 'No registrada'}</span>
                                </div>
                                <div className="flex justify-between pt-1 text-sm">
                                  <span className="font-medium text-neutral-500">Creación</span>
                                  <span className="font-bold text-neutral-900">{formatDateTime(selectedDriver.user.createdAt).split(',')[0]}</span>
                                </div>
                              </div>
                            </section>
                          </div>

                          <div className="space-y-6">
                            {(() => {
                              const activeStatuses = ['CONFIRMED', 'PREPARING', 'READY', 'PICKED_UP', 'IN_TRANSIT'];
                              const activeOrders = selectedDriver.recentOrders.filter(o => activeStatuses.includes(o.status));
                              return activeOrders.length ? (
                                <section className="rounded-[32px] border border-black/5 bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
                                  <div className="border-b border-black/5 p-6 md:px-8">
                                    <h3 className="text-lg font-bold text-neutral-900">Operativa en Tiempo Real</h3>
                                  </div>
                                  <div className="p-6 md:p-8">
                                    <div className="space-y-4">
                                      {activeOrders.map((order) => (
                                        <div key={order.id} className="flex flex-wrap items-center justify-between gap-4 rounded-[24px] border border-emerald-200 bg-emerald-50/50 p-5 transition-colors hover:bg-emerald-50">
                                          <div>
                                            <div className="flex items-center gap-3">
                                              <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
                                              <p className="font-bold text-neutral-900">{order.orderReference}</p>
                                              <span className="rounded-md bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700 shadow-sm ring-1 ring-inset ring-emerald-200">
                                                {formatOrderStatusLabel(order.status)}
                                              </span>
                                            </div>
                                            <p className="mt-2 text-sm font-medium text-neutral-600">
                                              🏢 {order.restaurant.name} <span className="mx-2 text-neutral-300">|</span> 👤 {order.customer.user.name}
                                            </p>
                                          </div>
                                          <div className="text-right">
                                            <p className="text-lg font-bold text-neutral-950">{formatCurrency(order.totalAmount)}</p>
                                            <p className="text-xs font-medium text-neutral-400">{formatDateTime(order.createdAt)}</p>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                </section>
                              ) : null;
                            })()}

                            <section className="rounded-[32px] border border-black/5 bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
                              <div className="border-b border-black/5 p-6 md:px-8">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!showDriverOrderHistory) {
                                      setShowDriverOrderHistory(true);
                                      void loadDriverOrderHistory(selectedDriver.id, 1);
                                    } else {
                                      setShowDriverOrderHistory(false);
                                      setDriverOrderHistory([]);
                                    }
                                  }}
                                  className="flex w-full items-center justify-between"
                                >
                                  <div className="text-left">
                                    <h3 className="text-lg font-bold text-neutral-900">Historial de Pedidos</h3>
                                    <p className="mt-0.5 text-sm text-neutral-500">
                                      {showDriverOrderHistory
                                        ? `${driverOrderHistoryTotal} pedidos encontrados`
                                        : `${selectedDriver.summary.totalDeliveries} entregas realizadas`}
                                    </p>
                                  </div>
                                  <div className={`flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 transition-transform ${showDriverOrderHistory ? 'rotate-180' : ''}`}>
                                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                  </div>
                                </button>
                              </div>
                              {showDriverOrderHistory && (
                                <div className="p-6 md:p-8">
                                  {loadingDriverOrderHistory && driverOrderHistory.length === 0 ? (
                                    <div className="flex items-center justify-center py-12">
                                      <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-200 border-t-neutral-600" />
                                    </div>
                                  ) : driverOrderHistory.length === 0 ? (
                                    <div className="rounded-[24px] border border-dashed border-black/10 bg-neutral-50 py-12 text-center">
                                      <p className="font-medium text-neutral-500">Sin pedidos registrados.</p>
                                    </div>
                                  ) : (
                                    <>
                                      <div className="space-y-3">
                                        {driverOrderHistory.map((order: any) => (
                                          <div key={order.id} className="flex flex-wrap items-center justify-between gap-4 rounded-[24px] border border-black/5 bg-neutral-50/50 p-4 transition-colors hover:bg-neutral-50">
                                            <div className="min-w-0 flex-1">
                                              <div className="flex items-center gap-2">
                                                <p className="font-bold text-neutral-900 truncate">{order.orderReference}</p>
                                                <span className="shrink-0 rounded-md bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-neutral-500 shadow-sm ring-1 ring-inset ring-black/5">
                                                  {formatOrderStatusLabel(order.status)}
                                                </span>
                                              </div>
                                              <p className="mt-1.5 text-sm text-neutral-600">
                                                🏢 {order.restaurant?.name || '—'}{' '}
                                                <span className="mx-2 text-neutral-300">|</span>
                                                👤 {order.customer?.user?.name || '—'}
                                              </p>
                                              <p className="mt-1 text-[11px] font-medium text-neutral-400">
                                                {formatDateTime(order.createdAt)}
                                              </p>
                                            </div>
                                            <div className="shrink-0 text-right">
                                              <p className="text-lg font-bold text-neutral-950">{formatCurrency(order.totalAmount)}</p>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                      {driverOrderHistoryHasMore && (
                                        <div className="mt-4 text-center">
                                          <button
                                            type="button"
                                            onClick={() => loadDriverOrderHistory(selectedDriver.id, driverOrderHistoryPage + 1, true)}
                                            disabled={loadingDriverOrderHistory}
                                            className="rounded-full border border-black/10 bg-white px-6 py-2.5 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-100 disabled:opacity-50"
                                          >
                                            {loadingDriverOrderHistory ? 'Cargando...' : 'Cargar más pedidos'}
                                          </button>
                                        </div>
                                      )}
                                    </>
                                  )}
                                </div>
                              )}
                            </section>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="flex h-[400px] items-center justify-center rounded-[32px] border border-dashed border-black/10 bg-white/50 p-12 text-center backdrop-blur">
                        <div className="max-w-sm">
                          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-neutral-100 text-neutral-400">
                            <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" /></svg>
                          </div>
                          <p className="mt-4 font-bold text-neutral-900">Selecciona un repartidor</p>
                          <p className="mt-2 text-sm text-neutral-500">Revisa métricas detalladas, audita documentación o aplica bloqueos preventivos al instante.</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

{activeSection === 'users' ? (
              <div className="space-y-5">
                <section className="overflow-hidden rounded-[28px] border border-black/5 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,246,242,0.96))] p-5 shadow-[0_20px_70px_rgba(15,15,15,0.06)] backdrop-blur md:p-6">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-neutral-400">Comensales</p>
                  <h1 className="mt-2 text-[1.8rem] font-semibold tracking-[-0.05em] text-neutral-950 md:text-[2rem]">
                    Centro de control de usuarios
                  </h1>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-500">
                    Supervisa actividad, identifica cuentas con riesgo, revisa historial de pedidos y aplica acciones de suspensión o desactivación.
                  </p>
                </section>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
                  <MetricCard label="Comensales totales" value={String(customerOverview?.totalCustomers ?? 0)} detail={`${customerOverview?.newCustomersThisMonth ?? 0} nuevos este mes`} />
                  <MetricCard label="Activos" value={String(customerOverview?.activeCustomers ?? 0)} detail={`${customerOverview?.activeInLast30Days ?? 0} con actividad reciente`} />
                  <MetricCard label="Con pedidos" value={String(customerOverview?.customersWithOrders ?? 0)} detail="Han realizado al menos un pedido" />
                  <MetricCard label="Ingresos" value={formatCurrency(customerOverview?.totalRevenue ?? 0)} detail={`${customerOverview?.totalRefunds ?? 0} en reembolsos`} />
                  <MetricCard label="Riesgo alto" value={String(customerOverview?.highRiskCustomers ?? 0)} detail="Requieren atencion prioritaria" />
                  <MetricCard label="Nuevos (mes)" value={String(customerOverview?.newCustomersThisMonth ?? 0)} detail="Registrados este mes" />
                  <MetricCard label="Suspendidos" value={String(customerOverview?.suspendedCustomers ?? 0)} detail={`${customerOverview?.inactiveCustomers ?? 0} inactivos adicionales`} />
                </div>

                <div className="grid gap-6 xl:grid-cols-[440px_1fr] items-start">
                  <div className="space-y-4">
                    <PanelCard title="Base de comensales" subtitle="Filtro y monitoreo" aside={loadingCustomers ? 'Actualizando...' : `${customersTotal} registros`}>
                      <form onSubmit={loadCustomers} className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <Field label="Busqueda" value={customerFilters.search} onChange={(v) => setCustomerFilters((c) => ({ ...c, search: v }))} placeholder="Nombre, telefono o correo" />
                          <SelectField label="Estado" value={customerFilters.status} onChange={(v) => setCustomerFilters((c) => ({ ...c, status: v as CustomerFilters['status'] }))} options={[{ value: '', label: 'Todos' }, { value: 'ACTIVE', label: 'Activos' }, { value: 'SUSPENDED', label: 'Suspendidos' }, { value: 'INACTIVE', label: 'Inactivos' }]} />
                          <SelectField label="Riesgo" value={customerFilters.risk} onChange={(v) => setCustomerFilters((c) => ({ ...c, risk: v as CustomerFilters['risk'] }))} options={[{ value: '', label: 'Todos' }, { value: 'HIGH', label: 'Alto' }, { value: 'MEDIUM', label: 'Medio' }, { value: 'LOW', label: 'Bajo' }]} />
                          <SelectField label="Zona" value={customerFilters.region} onChange={(v) => setCustomerFilters((c) => ({ ...c, region: v }))} options={[{ value: '', label: 'Todas' }, ...regions.map((r) => ({ value: r.code, label: r.name }))]} />
                          <SelectField label="Orden" value={customerFilters.sort} onChange={(v) => setCustomerFilters((c) => ({ ...c, sort: v as CustomerFilters['sort'] }))} options={[{ value: 'recent', label: 'Actividad reciente' }, { value: 'risk', label: 'Mayor riesgo' }, { value: 'orders', label: 'Mas pedidos' }, { value: 'spend', label: 'Mayor gasto' }]} />
                          <div className="flex items-end gap-2">
                            <button type="submit" className="flex-1 rounded-full bg-neutral-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-neutral-800">{loadingCustomers ? 'Buscando...' : 'Buscar'}</button>
                            <button type="button" onClick={() => { setCustomerFilters({ search: '', status: '', risk: '', region: '', sort: 'recent' }); setCustomerPage(1); }} className="rounded-full border border-black/10 px-4 py-3 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-100">Limpiar</button>
                          </div>
                        </div>
                      </form>
                    </PanelCard>

                    <div className="space-y-2">
                      {customers.length > 0 ? customers.map((customer) => (
                        <button key={customer.id} type="button" onClick={() => { setSelectedCustomerId(customer.id); setCustomerDetailTab('profile'); }} className={`w-full rounded-[20px] border px-4 py-3 text-left transition ${selectedCustomerId === customer.id ? 'border-neutral-950 bg-neutral-950 text-white shadow-md' : 'border-black/5 bg-white hover:border-black/10 hover:shadow-sm'}`}>
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${selectedCustomerId === customer.id ? 'bg-white/15 text-white' : 'bg-neutral-100 text-neutral-600'}`}>{getRestaurantInitials(customer.name)}</div>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold">{customer.name}</p>
                                <p className={`truncate text-xs ${selectedCustomerId === customer.id ? 'text-white/60' : 'text-neutral-400'}`}>{customer.phone}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <StatusPill status={customer.status} inverted={selectedCustomerId === customer.id} />
                              <RiskPill level={customer.riskLevel} inverted={selectedCustomerId === customer.id} />
                            </div>
                          </div>
                          <div className={`mt-2.5 grid grid-cols-3 gap-2 text-xs ${selectedCustomerId === customer.id ? 'text-white/70' : 'text-neutral-500'}`}>
                            <span><strong className={selectedCustomerId === customer.id ? 'text-white' : 'text-neutral-800'}>{customer.totalOrders}</strong> pedidos</span>
                            <span><strong className={selectedCustomerId === customer.id ? 'text-white' : 'text-neutral-800'}>{formatCurrency(customer.totalSpent)}</strong></span>
                            <span className="truncate">{formatDateTime(customer.lastActivityAt)}</span>
                          </div>
                          {customer.riskFlags.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {customer.riskFlags.slice(0, 2).map((flag) => (
                                <span key={flag} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${selectedCustomerId === customer.id ? 'bg-white/12 text-white/85' : 'bg-rose-50 text-rose-600'}`}>{flag}</span>
                              ))}
                              {customer.riskFlags.length > 2 && (
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${selectedCustomerId === customer.id ? 'bg-white/12 text-white/60' : 'bg-neutral-100 text-neutral-500'}`}>+{customer.riskFlags.length - 2}</span>
                              )}
                            </div>
                          )}
                        </button>
                      )) : loadingCustomers ? (
                        <EmptyState text="Cargando comensales..." compact />
                      ) : (
                        <EmptyState text="No hay comensales para los filtros seleccionados." compact />
                      )}

                      {customersTotal > 18 && (
                        <div className="flex items-center justify-between pt-2">
                          <p className="text-xs text-neutral-500">Pagina {customerPage} de {Math.ceil(customersTotal / 18)}</p>
                          <div className="flex gap-1">
                            <button type="button" onClick={() => setCustomerPage((p) => Math.max(1, p - 1))} disabled={customerPage <= 1} className="rounded-full border border-black/10 px-3 py-1.5 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40">Anterior</button>
                            <button type="button" onClick={() => setCustomerPage((p) => p + 1)} disabled={customerPage * 18 >= customersTotal} className="rounded-full border border-black/10 px-3 py-1.5 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40">Siguiente</button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-4">
                    {selectedCustomer && !loadingCustomerDetail ? (
                      <>
                        <div className="flex items-center justify-between gap-4 rounded-2xl border border-black/5 bg-[#faf8f3] p-4">
                          <div className="flex items-center gap-3 min-w-0">
                            {selectedCustomer.profilePhoto ? (
                              <img src={selectedCustomer.profilePhoto} alt="" className="h-12 w-12 shrink-0 rounded-[16px] object-cover" />
                            ) : (
                              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] bg-neutral-950 text-base font-bold text-white">{getRestaurantInitials(selectedCustomer.name)}</div>
                            )}
                            <div className="min-w-0">
                              <p className="text-base font-bold text-neutral-950 truncate">{selectedCustomer.name}{selectedCustomer.lastName ? ` ${selectedCustomer.lastName}` : ''}</p>
                              <p className="text-xs text-neutral-500 truncate">{selectedCustomer.phone} &middot; {selectedCustomer.email}</p>
                              <p className="text-[11px] text-neutral-400">Zona: {formatRegionLabel(selectedCustomer.region, regions)}</p>
                            </div>
                          </div>
                          <div className="flex flex-col gap-1.5 shrink-0">
                            <StatusPill status={selectedCustomer.status} />
                            <RiskPill level={selectedCustomer.summary.riskLevel} />
                          </div>
                        </div>

                        <div className="flex gap-1 rounded-2xl bg-neutral-100/70 p-1">
                          {([{ key: 'profile', label: 'Perfil' }, { key: 'orders', label: `Pedidos (${selectedCustomer.recentOrders.length})` }, { key: 'addresses', label: `Direcciones (${selectedCustomer.addresses.length})` }, { key: 'actions', label: 'Acciones' }] as const).map((tab) => (
                            <button key={tab.key} type="button" onClick={() => setCustomerDetailTab(tab.key)} className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition ${customerDetailTab === tab.key ? 'bg-white text-neutral-950 shadow-sm' : 'text-neutral-500 hover:text-neutral-800'}`}>{tab.label}</button>
                          ))}
                        </div>

                        {customerDetailTab === 'profile' && (
                          <PanelCard title="Informacion del perfil" subtitle="Datos del comensal">
                            <div className="grid grid-cols-4 gap-3">
                              <div className="rounded-2xl bg-neutral-50 p-3 text-center"><p className="text-xl font-bold text-neutral-900">{selectedCustomer.summary.totalOrders}</p><p className="text-[11px] text-neutral-500">Pedidos</p></div>
                              <div className="rounded-2xl bg-neutral-50 p-3 text-center"><p className="text-xl font-bold text-neutral-900">{formatCurrency(selectedCustomer.summary.totalSpent)}</p><p className="text-[11px] text-neutral-500">Facturado</p></div>
                              <div className="rounded-2xl bg-neutral-50 p-3 text-center"><p className="text-xl font-bold text-neutral-900">{selectedCustomer.summary.refundCount}</p><p className="text-[11px] text-neutral-500">Reembolsos</p></div>
                              <div className="rounded-2xl bg-neutral-50 p-3 text-center"><p className="text-xl font-bold text-neutral-900">{selectedCustomer.rating.toFixed(1)}</p><p className="text-[11px] text-neutral-500">Rating</p></div>
                            </div>
                            {selectedCustomer.summary.riskFlags.length > 0 ? (
                              <Callout tone={selectedCustomer.summary.riskLevel === 'HIGH' ? 'danger' : 'info'}>{selectedCustomer.summary.riskFlags.join(' · ')}</Callout>
                            ) : (
                              <Callout tone="success">La cuenta no presenta señales operativas relevantes de riesgo.</Callout>
                            )}
                            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                              <InfoRow label="Estado" value={getUserStatusLabel(selectedCustomer.status)} />
                              <InfoRow label="Nombre completo" value={`${selectedCustomer.name}${selectedCustomer.lastName ? ` ${selectedCustomer.lastName}` : ''}`} />
                              <InfoRow label="Telefono" value={selectedCustomer.phone} />
                              <InfoRow label="Correo" value={selectedCustomer.email} />
                              <InfoRow label="Fecha de nacimiento" value={selectedCustomer.dateOfBirth ? formatDateTime(selectedCustomer.dateOfBirth) : 'No registrada'} />
                              <InfoRow label="Region" value={formatRegionLabel(selectedCustomer.region, regions)} />
                              <InfoRow label="Fecha de alta" value={formatDateTime(selectedCustomer.createdAt)} />
                              <InfoRow label="Ultima actividad" value={selectedCustomer.summary.lastOrderAt ? formatDateTime(selectedCustomer.summary.lastOrderAt) : 'Sin actividad'} />
                              <InfoRow label="Direcciones" value={String(selectedCustomer.summary.addressCount)} />
                              <InfoRow label="Metodos de pago" value={selectedCustomer.summary.paymentMethods.length ? selectedCustomer.summary.paymentMethods.join(', ') : 'Sin historial'} />
                              <InfoRow label="Pedido activo" value={selectedCustomer.summary.activeOrders > 0 ? `${selectedCustomer.summary.activeOrders} activos` : 'Ninguno'} />
                              <InfoRow label="Favoritos / reseñas" value={`${selectedCustomer.summary.favoriteCount} / ${selectedCustomer.summary.reviewCount}`} />
                            </div>
                          </PanelCard>
                        )}

                        {customerDetailTab === 'orders' && (
                          <PanelCard title="Historial de pedidos" subtitle="Registro completo" aside={`${selectedCustomer.recentOrders.length} registros`}>
                            {selectedCustomer.recentOrders.length > 0 ? (
                              <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                                {selectedCustomer.recentOrders.map((order) => (
                                  <div key={order.id} className="rounded-2xl border border-black/5 bg-neutral-50 p-3">
                                    <div className="flex items-start justify-between gap-2">
                                      <div>
                                        <p className="text-sm font-semibold text-neutral-950">{order.orderReference}</p>
                                        <p className="text-xs text-neutral-500">{order.restaurant.name} &middot; {formatDateTime(order.createdAt)}</p>
                                      </div>
                                      <div className="text-right">
                                        <p className="text-sm font-bold text-neutral-950">{formatCurrency(order.totalAmount)}</p>
                                        <p className="text-xs text-neutral-500">{formatOrderStatusLabel(order.status)} &middot; {order.paymentMethod}</p>
                                      </div>
                                    </div>
                                    <p className="mt-2 text-xs text-neutral-600">{order.address.street} {order.address.number}, {order.address.neighborhood}, {order.address.city}</p>
                                    {order.driver?.user.name && <p className="mt-1 text-xs text-neutral-500">Repartidor: {order.driver.user.name}</p>}
                                  </div>
                                ))}
                              </div>
                            ) : (<EmptyState text="Este comensal aun no tiene pedidos." compact />)}
                          </PanelCard>
                        )}

                        {customerDetailTab === 'addresses' && (
                          <PanelCard title="Direcciones registradas" subtitle="Cobertura y referencias" aside={`${selectedCustomer.addresses.length} guardadas`}>
                            {selectedCustomer.addresses.length > 0 ? (
                              <div className="space-y-2">
                                {selectedCustomer.addresses.map((address) => (
                                  <div key={address.id} className="rounded-2xl border border-black/5 bg-neutral-50 p-3">
                                    <div className="flex items-start justify-between gap-2">
                                      <p className="text-sm font-semibold text-neutral-950">{address.street} {address.number}</p>
                                      {address.isDefault && <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-700">Principal</span>}
                                    </div>
                                    <p className="mt-1.5 text-xs text-neutral-600">{address.neighborhood}, {address.city}, {address.state}, {address.zipCode}</p>
                                    {address.reference && <p className="mt-1 text-xs text-neutral-500">{address.reference}</p>}
                                  </div>
                                ))}
                              </div>
                            ) : (<EmptyState text="Sin direcciones registradas." compact />)}
                          </PanelCard>
                        )}

                        {customerDetailTab === 'actions' && (
                          <PanelCard title="Acciones sobre la cuenta" subtitle="Control administrativo" aside={updatingCustomerStatus ? 'Aplicando...' : 'Operativo'}>
                            <form onSubmit={updateCustomerStatus} className="space-y-4">
                              <SelectField label="Nuevo estado" value={customerActionStatus} onChange={(v) => setCustomerActionStatus(v as UserAccountStatus)} options={[{ value: 'ACTIVE', label: 'Activar cuenta' }, { value: 'SUSPENDED', label: 'Suspender cuenta' }, { value: 'INACTIVE', label: 'Desactivar cuenta' }]} />
                              <label className="grid gap-1.5 text-sm text-neutral-600">
                                <span className="font-medium text-neutral-800">Motivo administrativo</span>
                                <textarea value={customerActionReason} onChange={(e) => setCustomerActionReason(e.target.value)} placeholder="Describe el motivo de la accion" rows={3} className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-neutral-950 outline-none transition placeholder:text-neutral-400 focus:border-black/20 resize-none" />
                              </label>
                              <Callout tone={customerActionStatus === 'ACTIVE' ? 'info' : 'danger'}>
                                {customerActionStatus === 'ACTIVE' ? 'Al reactivar la cuenta, el usuario podra volver a autenticarse y operar con normalidad.' : customerActionStatus === 'SUSPENDED' ? 'La suspension bloquea el acceso del comensal. No se puede aplicar si tiene pedidos activos.' : 'La desactivacion es una baja logica. Se conserva el historial, pero el acceso queda bloqueado.'}
                              </Callout>
                              <button type="submit" disabled={updatingCustomerStatus || (customerActionStatus !== 'ACTIVE' && !customerActionReason.trim())} className="w-full rounded-full bg-neutral-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300">{updatingCustomerStatus ? 'Aplicando cambio...' : 'Aplicar estado'}</button>
                            </form>
                          </PanelCard>
                        )}
                      </>
                    ) : loadingCustomerDetail ? (
                      <PanelCard title="Cargando..." subtitle="Detalle del comensal"><EmptyState text="Cargando informacion del comensal..." compact /></PanelCard>
                    ) : (
                      <PanelCard title="Detalle del comensal" subtitle="Selecciona un comensal"><EmptyState text="Selecciona un comensal de la lista para revisar su actividad y aplicar acciones." compact /></PanelCard>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {/* Block removed and moved to settings */}

            {activeSection === 'support' ? (
              <div className="grid gap-6 xl:grid-cols-[380px_1fr] items-start">
                {/* Master View (Left Panel) */}
                <div className="flex flex-col h-[calc(100vh-140px)] rounded-3xl border border-black/5 bg-white shadow-sm overflow-hidden">
                  <div className="p-5 border-b border-black/5 shrink-0 bg-white z-10">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-xl font-bold text-neutral-950 tracking-tight">Soporte</h2>
                      <button
                        type="button"
                        onClick={() => loadTickets()}
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 text-neutral-600 hover:bg-neutral-200 hover:text-neutral-900 transition"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                      </button>
                    </div>
                    <div className="flex gap-2 overflow-x-auto pb-1 hide-scrollbar">
                      {(['ALL', 'PENDING', 'IN_PROGRESS', 'RESOLVED'] as const).map((filter) => (
                        <button
                          key={filter}
                          type="button"
                          onClick={() => setTicketFilter(filter)}
                          className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition ${
                            ticketFilter === filter
                              ? 'bg-neutral-950 text-white shadow-sm'
                              : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                          }`}
                        >
                          {filter === 'ALL' ? 'Todos' :
                           filter === 'PENDING' ? 'Pendientes' :
                           filter === 'IN_PROGRESS' ? 'En Proceso' : 'Resueltos'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-neutral-50/50">
                    {loadingTickets ? (
                      <div className="flex items-center justify-center h-32">
                        <svg className="h-6 w-6 animate-spin text-neutral-400" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                      </div>
                    ) : tickets.filter((t) => ticketFilter === 'ALL' || t.status === ticketFilter).length === 0 ? (
                      <div className="text-center py-12 px-4">
                        <div className="mx-auto w-12 h-12 bg-neutral-100 rounded-full flex items-center justify-center text-xl mb-3">📬</div>
                        <p className="text-sm text-neutral-500 font-medium">Bandeja limpia</p>
                      </div>
                    ) : (
                      tickets
                        .filter((t) => ticketFilter === 'ALL' || t.status === ticketFilter)
                        .map((ticket) => (
                        <button
                          key={ticket.id}
                          onClick={() => {
                            setSelectedTicketId(ticket.id);
                            setTicketResponse('');
                          }}
                          className={`w-full text-left p-4 rounded-2xl border transition-all ${
                            selectedTicketId === ticket.id 
                              ? 'bg-white border-neutral-950 shadow-[0_4px_20px_rgba(0,0,0,0.06)]' 
                              : 'bg-white border-black/5 hover:border-black/15 shadow-sm'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase ${
                                ticket.status === 'PENDING' ? 'bg-amber-100 text-amber-800' :
                                ticket.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-800' :
                                'bg-emerald-100 text-emerald-800'
                              }`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${
                                  ticket.status === 'PENDING' ? 'bg-amber-500' :
                                  ticket.status === 'IN_PROGRESS' ? 'bg-blue-500' :
                                  'bg-emerald-500'
                                }`}></span>
                                {ticket.status === 'PENDING' ? 'Pendiente' :
                                 ticket.status === 'IN_PROGRESS' ? 'En Proceso' : 'Resuelto'}
                            </span>
                            <span className="text-[11px] font-medium text-neutral-400">
                              {new Date(ticket.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                          <div className="flex items-start gap-3">
                            <div className={`shrink-0 flex h-8 w-8 items-center justify-center rounded-lg text-sm ${ticket.type === 'APP' ? 'bg-blue-50/80 text-blue-600' : 'bg-orange-50/80 text-orange-600'}`}>
                              {ticket.type === 'APP' ? '📱' : '🍔'}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold text-neutral-950 truncate text-[13px]">
                                {ticket.customer.name}
                              </p>
                              <p className="text-[13px] text-neutral-500 truncate mt-0.5">
                                {ticket.subject || (ticket.type === 'APP' ? 'Reporte de la Aplicación' : 'Reporte de Pedido')}
                              </p>
                            </div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>

                {/* Detail View (Right Panel) */}
                <div className="flex flex-col h-[calc(100vh-140px)] rounded-3xl border border-black/5 bg-white shadow-sm overflow-hidden relative">
                  {selectedTicket ? (
                    <>
                      <div className="flex-shrink-0 border-b border-black/5 bg-white px-8 py-6 z-10">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 text-xl">
                              {selectedTicket.type === 'APP' ? '📱' : '🍔'}
                            </div>
                            <div>
                              <h3 className="text-xl font-bold tracking-tight text-neutral-950">
                                {selectedTicket.type === 'APP' ? 'Problema con la Plataforma' : 'Problema de Operación'}
                              </h3>
                              <p className="text-sm font-medium text-neutral-500">
                                Ticket #{selectedTicket.id.slice(-6).toUpperCase()} · {new Date(selectedTicket.createdAt).toLocaleString()}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {selectedTicket.status !== 'IN_PROGRESS' && selectedTicket.status !== 'RESOLVED' && (
                              <button
                                type="button"
                                disabled={isResolvingTicket}
                                onClick={async () => {
                                  setIsResolvingTicket(true);
                                  try {
                                    await fetch(`${apiBase}/admin/support/tickets/${selectedTicket.id}`, {
                                      method: 'PATCH',
                                      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                                      body: JSON.stringify({ status: 'IN_PROGRESS' }),
                                    });
                                    await loadTickets();
                                  } finally {
                                    setIsResolvingTicket(false);
                                  }
                                }}
                                className="rounded-full bg-blue-50 px-4 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100 transition disabled:opacity-50"
                              >
                                {isResolvingTicket ? 'Actualizando...' : 'Tomar Ticket (En Proceso)'}
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={isDeletingTicket}
                              onClick={async () => {
                                if (!confirm('¿Eliminar este ticket de soporte permanentemente?')) return;
                                setIsDeletingTicket(true);
                                try {
                                  await fetch(`${apiBase}/admin/support/tickets/${selectedTicket.id}`, {
                                    method: 'DELETE',
                                    headers: { 'Authorization': `Bearer ${token}` },
                                  });
                                  setSelectedTicketId(null);
                                  await loadTickets();
                                } finally {
                                  setIsDeletingTicket(false);
                                }
                              }}
                              className="rounded-full bg-red-50 px-4 py-2 text-xs font-bold text-red-700 hover:bg-red-100 transition disabled:opacity-50"
                            >
                              {isDeletingTicket ? 'Eliminando...' : 'Eliminar'}
                            </button>
                          </div>
                        </div>
                        
                        <div className="flex flex-wrap gap-x-6 gap-y-3 mt-4">
                          <div>
                            <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-400 mb-1">Cliente</p>
                            <p className="text-sm font-semibold text-neutral-800">{selectedTicket.customer.name}</p>
                            <p className="text-xs text-neutral-500">{selectedTicket.customer.phone}</p>
                          </div>
                          {selectedTicket.storeName && (
                            <div>
                              <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-400 mb-1">Tienda Implicada</p>
                              <p className="text-sm font-semibold text-neutral-800">{selectedTicket.storeName}</p>
                            </div>
                          )}
                          {selectedTicket.orderNumber && (
                            <div>
                              <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-400 mb-1">Núm. de Pedido</p>
                              <p className="text-sm font-semibold text-neutral-800">#{selectedTicket.orderNumber}</p>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex-1 overflow-y-auto p-8 bg-[#fafafa]">
                        <div className="max-w-2xl mx-auto space-y-8">
                          
                          {/* User Message Bubble */}
                          <div>
                            <div className="flex items-end gap-3">
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-xs font-bold text-neutral-600">
                                {selectedTicket.customer.name.substring(0, 2).toUpperCase()}
                              </div>
                              <div className="bg-white rounded-2xl rounded-bl-sm border border-black/5 p-5 shadow-sm max-w-[85%]">
                                {selectedTicket.subject && (
                                  <h4 className="font-bold text-neutral-900 mb-2">{selectedTicket.subject}</h4>
                                )}
                                <p className="text-[15px] leading-relaxed text-neutral-700 whitespace-pre-wrap">
                                  {selectedTicket.description}
                                </p>
                                
                                {(() => {
                                  const proofUrlMatch = selectedTicket.description.match(/Comprobante de pago:\s*(https?:\/\/[^\s\n]+)/);
                                  if (!proofUrlMatch) return null;
                                  const proofUrl = proofUrlMatch[1];
                                  return (
                                    <div className="mt-5 rounded-xl border border-black/5 overflow-hidden bg-neutral-50 p-2">
                                      <p className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider px-2 pt-2 pb-3 flex items-center gap-2">
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"></path></svg>
                                        Archivo Adjunto
                                      </p>
                                      <div className="group relative rounded-lg overflow-hidden border border-black/5 cursor-zoom-in aspect-video max-w-sm" onClick={() => window.open(proofUrl, '_blank')}>
                                        <img src={proofUrl} alt="Comprobante" className="w-full h-full object-cover transition duration-300 group-hover:scale-105" />
                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                                          <span className="bg-white/90 backdrop-blur text-black text-xs font-bold px-3 py-1.5 rounded-full shadow-sm">Expandir imagen</span>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })()}
                              </div>
                            </div>
                          </div>

                          {/* Admin Response Bubble or Input */}
                          {selectedTicket.response ? (
                            <div className="flex items-end justify-end gap-3">
                              <div className="bg-neutral-900 text-white rounded-2xl rounded-br-sm p-5 shadow-[0_4px_24px_rgba(0,0,0,0.12)] max-w-[85%]">
                                <h4 className="font-bold text-white/90 mb-2 flex items-center gap-2">
                                  <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"></path></svg>
                                  Respuesta Oficial
                                </h4>
                                <p className="text-[15px] leading-relaxed text-white/80 whitespace-pre-wrap">
                                  {selectedTicket.response}
                                </p>
                                <p className="text-[10px] text-white/50 mt-4 text-right">
                                  Resuelto el {new Date(selectedTicket.respondedAt as string).toLocaleString()}
                                </p>
                              </div>
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></svg>
                              </div>
                            </div>
                          ) : (
                            <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-sm">
                              <label className="block text-xs font-bold uppercase tracking-wider text-neutral-500 mb-3">Redactar Resolución</label>
                              <textarea
                                id={`response_${selectedTicket.id}`}
                                value={ticketResponse}
                                onChange={(e) => setTicketResponse(e.target.value)}
                                placeholder="Escribe un mensaje claro y profesional para el cliente..."
                                rows={4}
                                className="w-full resize-none rounded-xl bg-neutral-50 p-4 text-[15px] text-neutral-900 placeholder:text-neutral-400 border border-transparent focus:border-neutral-300 focus:bg-white focus:outline-none focus:ring-4 focus:ring-neutral-100 transition"
                              ></textarea>
                              <div className="mt-4 flex items-center justify-between border-t border-black/5 pt-4">
                                <p className="text-[11px] text-neutral-400 font-medium">Al resolver, el ticket se cerrará y el cliente será notificado.</p>
                                <button
                                  type="button"
                                  disabled={isResolvingTicket}
                                  onClick={async () => {
                                    setIsResolvingTicket(true);
                                    try {
                                      await fetch(`${apiBase}/admin/support/tickets/${selectedTicket.id}`, {
                                        method: 'PATCH',
                                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                                        body: JSON.stringify({ 
                                          status: 'RESOLVED',
                                          ...(ticketResponse.trim() ? { response: ticketResponse.trim() } : {}),
                                        }),
                                      });
                                      await loadTickets();
                                      setTicketResponse('');
                                    } finally {
                                      setIsResolvingTicket(false);
                                    }
                                  }}
                                  className="rounded-full bg-neutral-950 px-6 py-2.5 text-sm font-bold text-white hover:bg-neutral-800 hover:shadow-lg transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  {isResolvingTicket ? 'Resolviendo...' : 'Cerrar y Resolver Ticket'}
                                </button>
                              </div>
                            </div>
                          )}

                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center p-12 text-center bg-[#fafafa]">
                      <div className="w-20 h-20 mb-6 rounded-full bg-white border border-black/5 flex items-center justify-center shadow-sm">
                        <svg className="w-8 h-8 text-neutral-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"></path></svg>
                      </div>
                      <h3 className="text-xl font-bold text-neutral-900 mb-2">Ningún ticket seleccionado</h3>
                      <p className="text-neutral-500 max-w-sm">
                        Selecciona un reporte de la lista lateral para ver todos sus detalles, evidencias y redactar una respuesta.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {activeSection === 'requests' ? (
              <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-3xl font-black tracking-tight text-neutral-900">
                      Solicitudes de Afiliación
                    </h2>
                    <p className="mt-1 text-base text-neutral-500">
                      Administra prospectos de Negocios y Repartidores para tu plataforma.
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex gap-2 overflow-x-auto pb-1 hide-scrollbar">
                      {(['PENDING', 'APPROVED', 'REJECTED', 'ALL'] as const).map((filter) => (
                        <button
                          key={filter}
                          type="button"
                          onClick={() => setPlatformRequestsFilter(filter)}
                          className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-all ${
                            platformRequestsFilter === filter
                              ? 'bg-neutral-950 text-white shadow-[0_4px_10px_rgba(0,0,0,0.1)]'
                              : 'bg-white text-neutral-600 border border-black/10 hover:bg-neutral-50 hover:text-neutral-900'
                          }`}
                        >
                          {filter === 'ALL' ? 'Todas' :
                           filter === 'PENDING' ? 'Pendientes' :
                           filter === 'APPROVED' ? 'Aprobadas' : 'Rechazadas'}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => loadPlatformRequests()}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white border border-black/10 text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 transition-all shadow-sm"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                    </button>
                  </div>
                </div>

                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {loadingPlatformRequests ? (
                    <div className="col-span-full py-12 text-center text-sm font-medium text-neutral-500">
                      Cargando solicitudes...
                    </div>
                  ) : platformRequests.filter((r) => platformRequestsFilter === 'ALL' || r.status === platformRequestsFilter).length === 0 ? (
                    <div className="col-span-full rounded-3xl border border-dashed border-black/10 bg-white/50 px-6 py-16 text-center">
                      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-neutral-100 text-3xl">📋</div>
                      <h3 className="text-lg font-bold text-neutral-900">No hay solicitudes</h3>
                      <p className="mt-2 text-sm text-neutral-500">No hay ninguna solicitud que coincida con este filtro.</p>
                    </div>
                  ) : (
                    platformRequests
                      .filter((r) => platformRequestsFilter === 'ALL' || r.status === platformRequestsFilter)
                      .map((req) => (
                      <div key={req.id} className="group flex flex-col justify-between overflow-hidden rounded-[24px] border border-black/5 bg-white shadow-sm transition-all hover:shadow-lg hover:-translate-y-1">
                        <div className="p-5 flex-1">
                          <div className="flex items-center justify-between mb-4">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase ${
                              req.type === 'RESTAURANT' ? 'bg-violet-100 text-violet-800' : 'bg-indigo-100 text-indigo-800'
                            }`}>
                              {req.type === 'RESTAURANT' ? '🏪 Negocio' : '🛵 Repartidor'}
                            </span>
                            <span className="text-[11px] font-medium text-neutral-400">
                              {new Date(req.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                          
                          <h4 className="text-lg font-bold text-neutral-900 truncate">{req.ownerName}</h4>
                          {req.type === 'RESTAURANT' && (
                            <p className="text-[12px] font-medium text-neutral-500 truncate mt-0.5">
                              {req.businessName} · {req.giro}
                            </p>
                          )}
                          <div className="mt-3 text-xs font-semibold text-neutral-500 flex items-center gap-1.5">
                            📞 {req.whatsapp}
                          </div>
                        </div>

                        <div className="p-4 bg-neutral-50/50 border-t border-black/5 flex items-center justify-between">
                          <span className={`text-[10px] font-bold uppercase tracking-wider ${
                            req.status === 'PENDING' ? 'text-amber-600' :
                            req.status === 'APPROVED' ? 'text-emerald-600' :
                            'text-rose-600'
                          }`}>
                            {req.status === 'PENDING' ? 'Pendiente' :
                             req.status === 'APPROVED' ? 'Aprobada' : 'Rechazada'}
                          </span>
                          <button
                            onClick={() => setSelectedRequestId(req.id)}
                            className="rounded-full bg-neutral-950 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-neutral-800 active:scale-95"
                          >
                            Ver Detalles
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* MODAL DETALLES */}
                {selectedRequestId && (() => {
                  const selectedReq = platformRequests.find(r => r.id === selectedRequestId);
                  if (!selectedReq) return null;
                  return (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
                      <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-sm" onClick={() => setSelectedRequestId(null)}></div>
                      <div className="relative w-full max-w-2xl overflow-hidden rounded-[32px] bg-white shadow-2xl animate-in zoom-in-95 duration-200">
                        
                        <div className="border-b border-black/5 px-8 py-6 flex justify-between items-center bg-neutral-50/50">
                          <div className="flex items-center gap-4">
                            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white border border-black/5 shadow-sm text-2xl">
                              {selectedReq.type === 'RESTAURANT' ? '🏪' : '🛵'}
                            </div>
                            <div>
                              <h3 className="text-xl font-bold tracking-tight text-neutral-950">
                                {selectedReq.type === 'RESTAURANT' ? 'Solicitud de Negocio' : 'Solicitud de Repartidor'}
                              </h3>
                              <div className="flex items-center gap-3 mt-1">
                                <p className="text-xs font-medium text-neutral-500">ID: {selectedReq.id}</p>
                                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                  selectedReq.status === 'PENDING' ? 'bg-amber-100 text-amber-800' :
                                  selectedReq.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800' :
                                  'bg-rose-100 text-rose-800'
                                }`}>
                                  {selectedReq.status === 'PENDING' ? 'Pendiente' :
                                   selectedReq.status === 'APPROVED' ? 'Aprobada' : 'Rechazada'}
                                </span>
                              </div>
                            </div>
                          </div>
                          <button onClick={() => setSelectedRequestId(null)} className="rounded-full p-2 bg-neutral-200/50 text-neutral-500 hover:text-black transition">
                            ✕
                          </button>
                        </div>

                        <div className="p-8 space-y-6 max-h-[70vh] overflow-y-auto bg-[#fafafa]">
                          <div className="bg-white rounded-2xl border border-black/5 p-6 shadow-sm space-y-4">
                            <h4 className="font-bold text-neutral-900 border-b border-black/5 pb-2">Información del Solicitante</h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">Responsable / Nombre</p>
                                <p className="text-sm font-semibold text-neutral-800 mt-0.5">{selectedReq.ownerName}</p>
                              </div>
                              <div>
                                <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">WhatsApp</p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-sm font-semibold text-neutral-800">{selectedReq.whatsapp}</span>
                                  <a
                                    href={`https://wa.me/52${selectedReq.whatsapp.replace(/\D/g, '')}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 px-2 py-0.5 text-xs font-bold transition"
                                  >
                                    Chatear 💬
                                  </a>
                                </div>
                              </div>
                              <div className="md:col-span-2">
                                <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">Ubicación / Cobertura</p>
                                <p className="text-sm font-semibold text-neutral-800 mt-0.5">{selectedReq.location}</p>
                              </div>
                              {selectedReq.type === 'RESTAURANT' ? (
                                <>
                                  <div>
                                    <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">Nombre del Negocio</p>
                                    <p className="text-sm font-semibold text-neutral-800 mt-0.5">{selectedReq.businessName}</p>
                                  </div>
                                  <div>
                                    <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">Giro Comercial</p>
                                    <p className="text-sm font-semibold text-neutral-800 mt-0.5">{selectedReq.giro}</p>
                                  </div>
                                </>
                              ) : (
                                <div>
                                  <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">¿Tiene Moto?</p>
                                  <span className={`inline-flex px-2 py-0.5 text-xs font-bold rounded-full mt-1 ${selectedReq.motorcycle === 'SI' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                                    {selectedReq.motorcycle === 'SI' ? 'Sí, propia' : 'No'}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>

                          {selectedReq.status === 'PENDING' && (
                            <div className="flex items-center justify-end gap-3 pt-2">
                              <button
                                type="button"
                                disabled={isSubmittingRejection}
                                onClick={() => rejectPlatformRequest(selectedReq.id)}
                                className="rounded-full border border-rose-200 bg-white px-6 py-3 text-sm font-bold text-rose-600 hover:bg-rose-50 active:scale-95 transition-all disabled:opacity-50"
                              >
                                {isSubmittingRejection ? 'Rechazando...' : 'Rechazar Solicitud'}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setApproveRegion(regions[0]?.code || '');
                                  setApprovePassword('sadel123');
                                  setIsApproveRequestModalOpen(true);
                                }}
                                className="rounded-full bg-neutral-950 text-white hover:bg-neutral-800 px-6 py-3 text-sm font-bold active:scale-95 transition-all"
                              >
                                Aprobar y Dar de Alta
                              </button>
                            </div>
                          )}

                          {selectedReq.status === 'APPROVED' && (
                            <div className="rounded-2xl bg-emerald-50/50 border border-emerald-200/50 p-4 text-emerald-800 text-sm font-semibold text-center">
                              ✓ Esta solicitud ha sido aprobada y el usuario ha sido dado de alta.
                            </div>
                          )}

                          {selectedReq.status === 'REJECTED' && (
                            <div className="rounded-2xl bg-rose-50/50 border border-rose-200/50 p-4 text-rose-800 text-sm font-semibold text-center">
                              ✗ Esta solicitud ha sido rechazada.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            ) : null}
            {activeSection === 'promotions' ? (
              <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-3xl font-black tracking-tight text-neutral-900">
                      Promociones por Zona
                    </h2>
                    <p className="mt-1 text-base text-neutral-500">
                      Crea y administra los banners promocionales dinámicos.
                    </p>
                  </div>
                  <button
                    onClick={() => { setEditingPromo(null); setPromoForm({ title: '', imageUrl: '', targetUrl: '', isActive: true, regions: [], targetRole: 'ALL' }); setIsPromoModalOpen(true); }}
                    className="flex items-center justify-center gap-2 rounded-2xl bg-black px-6 py-3.5 text-sm font-semibold text-white shadow-[0_8px_16px_rgba(0,0,0,0.15)] transition-all hover:scale-[1.02] active:scale-[0.98]"
                  >
                    + Nueva Promoción
                  </button>
                </div>

                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {loadingPromotions ? (
                    <div className="col-span-full py-12 text-center text-sm font-medium text-neutral-500">
                      Cargando promociones...
                    </div>
                  ) : promotions.length === 0 ? (
                    <div className="col-span-full rounded-3xl border border-dashed border-black/10 bg-white/50 px-6 py-16 text-center">
                      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-neutral-100 text-3xl">
                        ✨
                      </div>
                      <h3 className="text-lg font-bold text-neutral-900">Sin Promociones</h3>
                      <p className="mt-2 text-sm text-neutral-500">
                        Crea tu primera promoción segmentada por zona para empezar a atraer clientes.
                      </p>
                    </div>
                  ) : (
                    promotions.map((promo) => (
                      <div key={promo.id} className="group relative overflow-hidden rounded-[24px] border border-black/5 bg-white shadow-sm transition-all hover:shadow-lg">
                        <div className="aspect-[16/9] w-full overflow-hidden bg-neutral-100 relative">
                          <img src={promo.imageUrl} alt={promo.title} className="h-full w-full object-cover" />
                          <div className="absolute top-3 right-3 flex gap-2">
                            <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider shadow-sm backdrop-blur ${promo.isActive ? 'bg-green-500/90 text-white' : 'bg-neutral-500/90 text-white'}`}>
                              {promo.isActive ? 'Activa' : 'Inactiva'}
                            </span>
                          </div>
                        </div>
                        <div className="p-5">
                          <h4 className="text-lg font-bold text-neutral-900">{promo.title}</h4>
                          <p className="mt-1 text-xs text-neutral-500 line-clamp-1">
                            {promo.regions.length > 0 ? `Zonas: ${promo.regions.join(', ')}` : 'Todas las zonas (Global)'} | Rol: {promo.targetRole === 'ALL' ? 'Todos' : promo.targetRole === 'CUSTOMER' ? 'Clientes' : promo.targetRole === 'RESTAURANT' ? 'Restaurantes' : 'Repartidores'}
                          </p>
                          <div className="mt-4 flex gap-2">
                            <button
                              onClick={() => { setEditingPromo(promo); setPromoForm({ title: promo.title, imageUrl: promo.imageUrl, targetUrl: promo.targetUrl || '', isActive: promo.isActive, regions: promo.regions || [], targetRole: promo.targetRole || 'ALL' }); setIsPromoModalOpen(true); }}
                              className="flex-1 rounded-xl bg-neutral-100 py-2.5 text-sm font-semibold text-neutral-700 transition-colors hover:bg-neutral-200"
                            >
                              Editar
                            </button>
                            <button
                              onClick={() => deletePromotion(promo.id)}
                              className="rounded-xl bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-600 transition-colors hover:bg-red-100"
                            >
                              Eliminar
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Modal Formulario Promoción */}
                {isPromoModalOpen && (
                  <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
                    <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-sm" onClick={() => setIsPromoModalOpen(false)}></div>
                    <div className="relative w-full max-w-lg overflow-hidden rounded-[32px] bg-white shadow-2xl animate-in zoom-in-95 duration-200">
                      <div className="border-b border-black/5 px-8 py-6 flex justify-between items-center bg-neutral-50/50">
                        <h3 className="text-xl font-bold text-neutral-900">
                          {editingPromo ? 'Editar Promoción' : 'Nueva Promoción'}
                        </h3>
                        <button onClick={() => setIsPromoModalOpen(false)} className="rounded-full p-2 bg-neutral-200/50 text-neutral-500 hover:text-black">
                          ✕
                        </button>
                      </div>
                      <div className="p-8 space-y-5 max-h-[70vh] overflow-y-auto">
                        <div className="flex gap-4">
                          <div className="flex-1">
                            <label className="text-xs font-bold uppercase tracking-widest text-neutral-500">Título</label>
                            <input type="text" value={promoForm.title} onChange={(e) => setPromoForm({ ...promoForm, title: e.target.value })} className="mt-2 w-full rounded-2xl border border-black/10 bg-neutral-50 px-4 py-3.5 text-sm focus:border-black focus:ring-1 focus:ring-black" placeholder="Ej. Cyber Monday GDL" />
                          </div>
                          <div className="flex-1">
                            <label className="text-xs font-bold uppercase tracking-widest text-neutral-500">Destinatarios</label>
                            <select value={promoForm.targetRole} onChange={(e) => setPromoForm({ ...promoForm, targetRole: e.target.value })} className="mt-2 w-full rounded-2xl border border-black/10 bg-neutral-50 px-4 py-3.5 text-sm focus:border-black focus:ring-1 focus:ring-black">
                              <option value="ALL">Todos los Usuarios</option>
                              <option value="CUSTOMER">Solo Clientes</option>
                              <option value="RESTAURANT">Solo Restaurantes</option>
                              <option value="DRIVER">Solo Repartidores</option>
                            </select>
                          </div>
                        </div>
                        <div>
                          <ImageUploadField
                            label="Imagen de la Promoción (Vertical 9:16)"
                            placeholder="URL de la imagen o subir..."
                            value={promoForm.imageUrl}
                            onChange={(val) => setPromoForm({ ...promoForm, imageUrl: val })}
                            apiBase={apiBase}
                            token={token!}
                          />
                        </div>
                        <div>
                          <label className="text-xs font-bold uppercase tracking-widest text-neutral-500">Zonas Asignadas</label>
                          <p className="mb-2 text-xs text-neutral-400">Si no seleccionas ninguna, será Global.</p>
                          <div className="flex flex-wrap gap-2">
                            {regions.map((region) => (
                              <button
                                key={region.code}
                                type="button"
                                onClick={() => {
                                  const current = promoForm.regions || [];
                                  setPromoForm({
                                    ...promoForm,
                                    regions: current.includes(region.code) ? current.filter((r) => r !== region.code) : [...current, region.code],
                                  });
                                }}
                                className={`rounded-xl px-4 py-2 text-xs font-bold transition-all ${promoForm.regions?.includes(region.code) ? 'bg-black text-white shadow-md' : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'}`}
                              >
                                {region.name}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 mt-2">
                          <input type="checkbox" id="isActivePromo" checked={promoForm.isActive} onChange={(e) => setPromoForm({ ...promoForm, isActive: e.target.checked })} className="h-5 w-5 rounded border-black/20 text-black focus:ring-black" />
                          <label htmlFor="isActivePromo" className="text-sm font-semibold text-neutral-700">Promoción Activa</label>
                        </div>
                      </div>
                      <div className="border-t border-black/5 bg-neutral-50/50 p-6 flex justify-end gap-3">
                        <button onClick={() => setIsPromoModalOpen(false)} className="rounded-xl px-5 py-3 text-sm font-semibold text-neutral-600 hover:bg-neutral-200">Cancelar</button>
                        <button onClick={savePromotion} disabled={!promoForm.title || !promoForm.imageUrl} className="rounded-xl bg-black px-8 py-3 text-sm font-bold text-white shadow-md hover:bg-neutral-800 disabled:opacity-50">Guardar</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {activeSection === 'billboards' ? (
              <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-3xl font-black tracking-tight text-neutral-900">
                      Publicidad (Billboards)
                    </h2>
                    <p className="mt-1 text-base text-neutral-500">
                      Banners a ancho completo estilo Uber Eats (960×408). Se muestran en el carrusel del home del comensal.
                    </p>
                  </div>
                  <button
                    onClick={() => { setEditingBillboard(null); setBillboardForm({ imageUrl: '', linkUrl: '', isActive: true, regions: [], sortIndex: billboards.length }); setIsBillboardModalOpen(true); }}
                    className="flex items-center justify-center gap-2 rounded-2xl bg-black px-6 py-3.5 text-sm font-semibold text-white shadow-[0_8px_16px_rgba(0,0,0,0.15)] transition-all hover:scale-[1.02] active:scale-[0.98]"
                  >
                    + Nuevo Billboard
                  </button>
                </div>

                <div className="flex items-center gap-2 rounded-2xl border border-black/5 bg-white px-4 py-3 text-xs text-neutral-500">
                  <svg className="h-4 w-4 shrink-0 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 4l5.586 5.586a2 2 0 012.828 0L19 11.757V19a2 2 0 01-2 2H7a2 2 0 01-2-2V7L4 4z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9.5 4h10v10" />
                  </svg>
                  El carrusel se inserta en la lista de restaurantes/tiendas: si hay 10 o menos se coloca en medio; si hay más de 10, a un cuarto.
                </div>

                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {loadingBillboards ? (
                    <div className="col-span-full py-12 text-center text-sm font-medium text-neutral-500">
                      Cargando billboards...
                    </div>
                  ) : billboards.length === 0 ? (
                    <div className="col-span-full rounded-3xl border border-dashed border-black/10 bg-white/50 px-6 py-16 text-center">
                      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-neutral-100 text-3xl">
                        📣
                      </div>
                      <h3 className="text-lg font-bold text-neutral-900">Sin billboards</h3>
                      <p className="mt-2 text-sm text-neutral-500">
                        Sube tu primer banner publicitario para mostrarlo en el home de los comensales.
                      </p>
                    </div>
                  ) : (
                    [...billboards]
                      .sort((a, b) => a.sortIndex - b.sortIndex)
                      .map((billboard, index) => (
                        <div key={billboard.id} className="group relative overflow-hidden rounded-[24px] border border-black/5 bg-white shadow-sm transition-all hover:shadow-lg">
                          <div className="relative w-full overflow-hidden bg-neutral-100" style={{ aspectRatio: '2.35 / 1' }}>
                            <img src={billboard.imageUrl} alt={billboard.imageUrl} className="h-full w-full object-cover" />
                            <div className="absolute top-3 right-3 flex gap-2">
                              <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider shadow-sm backdrop-blur ${billboard.isActive ? 'bg-green-500/90 text-white' : 'bg-neutral-500/90 text-white'}`}>
                                {billboard.isActive ? 'Activo' : 'Inactivo'}
                              </span>
                            </div>
                          </div>
                          <div className="p-5">
                            <div className="flex items-center gap-2">
                              <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-[10px] font-bold text-neutral-500">#{billboard.sortIndex}</span>
                              {billboard.linkUrl ? (
                                <span className="rounded-full bg-sky-50 px-2.5 py-0.5 text-[10px] font-bold text-sky-600">🔗 Cliclable</span>
                              ) : (
                                <span className="rounded-full bg-neutral-50 px-2.5 py-0.5 text-[10px] font-bold text-neutral-400">Solo imagen</span>
                              )}
                            </div>
                            <p className="mt-1 text-xs text-neutral-500 line-clamp-1 break-all">
                              {billboard.linkUrl || 'Sin enlace'}
                            </p>
                            <p className="mt-1 text-xs text-neutral-500">
                              {billboard.regions.length > 0 ? `Zonas: ${billboard.regions.join(', ')}` : 'Todas las zonas (Global)'}
                            </p>
                            <div className="mt-4 flex gap-2">
                              <button
                                onClick={() => { setEditingBillboard(billboard); setBillboardForm({ imageUrl: billboard.imageUrl, linkUrl: billboard.linkUrl || '', isActive: billboard.isActive, regions: billboard.regions || [], sortIndex: billboard.sortIndex ?? index }); setIsBillboardModalOpen(true); }}
                                className="flex-1 rounded-xl bg-neutral-100 py-2.5 text-sm font-semibold text-neutral-700 transition-colors hover:bg-neutral-200"
                              >
                                Editar
                              </button>
                              <button
                                onClick={() => toggleBillboardActive(billboard)}
                                className="flex-1 rounded-xl bg-neutral-100 py-2.5 text-sm font-semibold text-neutral-700 transition-colors hover:bg-neutral-200"
                              >
                                {billboard.isActive ? 'Desactivar' : 'Activar'}
                              </button>
                              <button
                                onClick={() => deleteBillboard(billboard.id)}
                                className="rounded-xl bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-600 transition-colors hover:bg-red-100"
                              >
                                Eliminar
                              </button>
                            </div>
                            <div className="mt-2 flex items-center gap-2">
                              <button
                                onClick={() => moveBillboard(billboard, -1)}
                                disabled={index === 0}
                                className="flex-1 rounded-xl border border-black/5 py-2 text-sm font-semibold text-neutral-500 transition-colors hover:bg-neutral-50 disabled:opacity-40"
                              >
                                ↑ Subir
                              </button>
                              <button
                                onClick={() => moveBillboard(billboard, 1)}
                                disabled={index === billboards.length - 1}
                                className="flex-1 rounded-xl border border-black/5 py-2 text-sm font-semibold text-neutral-500 transition-colors hover:bg-neutral-50 disabled:opacity-40"
                              >
                                ↓ Bajar
                              </button>
                            </div>
                          </div>
                        </div>
                      ))
                  )}
                </div>

                {/* Modal Formulario Billboard */}
                {isBillboardModalOpen && (
                  <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
                    <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-sm" onClick={() => setIsBillboardModalOpen(false)}></div>
                    <div className="relative w-full max-w-lg overflow-hidden rounded-[32px] bg-white shadow-2xl animate-in zoom-in-95 duration-200">
                      <div className="border-b border-black/5 px-8 py-6 flex justify-between items-center bg-neutral-50/50">
                        <h3 className="text-xl font-bold text-neutral-900">
                          {editingBillboard ? 'Editar Billboard' : 'Nuevo Billboard'}
                        </h3>
                        <button onClick={() => setIsBillboardModalOpen(false)} className="rounded-full p-2 bg-neutral-200/50 text-neutral-500 hover:text-black">
                          ✕
                        </button>
                      </div>
                      <div className="p-8 space-y-5 max-h-[70vh] overflow-y-auto">
                        <div>
                          <ImageUploadField
                            label="Imagen del Billboard (960×408, ratio 2.35:1)"
                            placeholder="URL de la imagen o subir..."
                            value={billboardForm.imageUrl}
                            onChange={(val) => setBillboardForm({ ...billboardForm, imageUrl: val })}
                            apiBase={apiBase}
                            token={token!}
                            maxWidth={1920}
                            maxHeight={816}
                            fileNamePrefix="billboard"
                          />
                          <p className="mt-2 text-xs text-neutral-400">
                            Formato exacto Uber Eats: 960×408px. Se recorta automáticamente con object-cover.
                          </p>
                        </div>
                        <div>
                          <label className="text-xs font-bold uppercase tracking-widest text-neutral-500">Enlace (opcional)</label>
                          <input type="text" value={billboardForm.linkUrl} onChange={(e) => setBillboardForm({ ...billboardForm, linkUrl: e.target.value })} className="mt-2 w-full rounded-2xl border border-black/10 bg-neutral-50 px-4 py-3.5 text-sm focus:border-black focus:ring-1 focus:ring-black" placeholder="https://... o ruta interna (/restaurantes/...) — vacío = no clicable" />
                          <p className="mt-2 text-xs text-neutral-400">Si se deja vacío, el banner no será clicable.</p>
                        </div>
                        <div>
                          <label className="text-xs font-bold uppercase tracking-widest text-neutral-500">Zonas Asignadas</label>
                          <p className="mb-2 text-xs text-neutral-400">Si no seleccionas ninguna, será Global.</p>
                          <div className="flex flex-wrap gap-2">
                            {regions.map((region) => (
                              <button
                                key={region.code}
                                type="button"
                                onClick={() => {
                                  const current = billboardForm.regions || [];
                                  setBillboardForm({
                                    ...billboardForm,
                                    regions: current.includes(region.code) ? current.filter((r) => r !== region.code) : [...current, region.code],
                                  });
                                }}
                                className={`rounded-xl px-4 py-2 text-xs font-bold transition-all ${billboardForm.regions?.includes(region.code) ? 'bg-black text-white shadow-md' : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'}`}
                              >
                                {region.name}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 mt-2">
                          <input type="checkbox" id="isActiveBillboard" checked={billboardForm.isActive} onChange={(e) => setBillboardForm({ ...billboardForm, isActive: e.target.checked })} className="h-5 w-5 rounded border-black/20 text-black focus:ring-black" />
                          <label htmlFor="isActiveBillboard" className="text-sm font-semibold text-neutral-700">Billboard Activo</label>
                        </div>
                      </div>
                      <div className="border-t border-black/5 bg-neutral-50/50 p-6 flex justify-end gap-3">
                        <button onClick={() => setIsBillboardModalOpen(false)} className="rounded-xl px-5 py-3 text-sm font-semibold text-neutral-600 hover:bg-neutral-200">Cancelar</button>
                        <button onClick={saveBillboard} disabled={!billboardForm.imageUrl} className="rounded-xl bg-black px-8 py-3 text-sm font-bold text-white shadow-md hover:bg-neutral-800 disabled:opacity-50">Guardar</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {activeSection === 'featured' ? (
              <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-3xl font-black tracking-tight text-neutral-900">Restaurantes Destacados</h2>
                    <p className="mt-1 text-base text-neutral-500">
                      Gestiona las solicitudes de restaurantes para aparecer en el carrusel de destacados.
                    </p>
                  </div>
                </div>

                {/* Package Configuration */}
                <div className="rounded-2xl border border-black/5 bg-white p-5">
                  <h3 className="text-sm font-bold text-neutral-900 mb-3">Paquetes de precio</h3>
                  <p className="text-xs text-neutral-400 mb-4">Define paquetes de días con precio fijo. Ej: 1 día $12, 7 días $70.</p>
                  <div className="space-y-2 mb-4">
                    {featuredPackageInputs.map((pkg, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input type="number" min="1" max="30" value={pkg.days}
                          onChange={(e) => {
                            const next = [...featuredPackageInputs];
                            next[i] = { ...next[i], days: e.target.value };
                            setFeaturedPackageInputs(next);
                          }}
                          className="w-20 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm font-semibold text-neutral-900 focus:outline-none focus:ring-2 focus:ring-black/20 text-center" />
                        <span className="text-sm text-neutral-500">día(s) — $</span>
                        <input type="number" min="0" step="0.01" value={pkg.price}
                          onChange={(e) => {
                            const next = [...featuredPackageInputs];
                            next[i] = { ...next[i], price: e.target.value };
                            setFeaturedPackageInputs(next);
                          }}
                          className="w-24 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm font-semibold text-neutral-900 focus:outline-none focus:ring-2 focus:ring-black/20" />
                        <span className="text-sm text-neutral-500">MXN</span>
                        <button onClick={() => {
                          setFeaturedPackageInputs(prev => prev.filter((_, j) => j !== i));
                        }} className="p-2 text-red-500 hover:text-red-700 transition-colors" title="Eliminar paquete">
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={() => {
                      setFeaturedPackageInputs(prev => [...prev, { days: '', price: '' }]);
                    }} className="rounded-xl border border-dashed border-black/20 px-4 py-2 text-sm font-semibold text-neutral-500 hover:text-neutral-700 hover:border-neutral-400 transition-colors">
                      + Agregar paquete
                    </button>
                    <button onClick={async () => {
                      const packages = featuredPackageInputs
                        .map(p => ({ days: parseInt(p.days), price: parseFloat(p.price) }))
                        .filter(p => !isNaN(p.days) && p.days > 0 && !isNaN(p.price) && p.price >= 0);
                      if (packages.length === 0) { alert('Agrega al menos un paquete válido.'); return; }
                      try {
                        const res = await fetch(`${apiBase}/admin/featured/settings`, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                          body: JSON.stringify({ packages }),
                        });
                        const data = await res.json();
                        if (data.success) {
                          setFeaturedPackages(packages);
                          alert('Paquetes guardados correctamente.');
                        } else {
                          alert(data.error?.message || 'Error al guardar.');
                        }
                      } catch { alert('No se pudo guardar.'); }
                    }} className="rounded-xl bg-black px-5 py-2.5 text-sm font-bold text-white hover:bg-neutral-800 transition-colors">
                      Guardar paquetes
                    </button>
                  </div>
                  {featuredPackages.length > 0 && (
                    <div className="mt-3 text-xs text-neutral-400">
                      Guardados: {featuredPackages.map(p => `${p.days} día(s) = $${p.price}`).join(' | ')}
                    </div>
                  )}
                </div>

                {/* Filters */}
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-neutral-600">Filtrar:</span>
                  {['', 'PENDING', 'APPROVED', 'REJECTED', 'EXPIRED'].map(s => (
                    <button key={s} onClick={() => { setFeaturedStatusFilter(s); setFeaturedPage(1); }}
                      className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                        featuredStatusFilter === s ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-600 border border-black/10 hover:bg-neutral-100'
                      }`}>
                      {s === '' ? 'Todas' : s === 'PENDING' ? 'Pendientes' : s === 'APPROVED' ? 'Aprobadas' : s === 'REJECTED' ? 'Rechazadas' : 'Vencidas'}
                    </button>
                  ))}
                </div>

                {/* List */}
                {loadingFeatured ? (
                  <div className="text-center py-12 text-neutral-400 font-semibold">Cargando...</div>
                ) : featuredRequests.length === 0 ? (
                  <div className="text-center py-12 text-neutral-400 font-semibold">No hay solicitudes.</div>
                ) : (
                  <div className="space-y-3">
                    {featuredRequests.map((req: any) => (
                      <div key={req.id} className="rounded-2xl border border-black/5 bg-white p-5">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            {req.restaurant?.logo ? (
                              <img src={req.restaurant.logo} alt="" className="w-10 h-10 rounded-full object-cover" />
                            ) : (
                              <div className="w-10 h-10 rounded-full bg-neutral-200 flex items-center justify-center text-sm font-bold text-neutral-500">{req.restaurant?.name?.[0] || '?'}</div>
                            )}
                            <div>
                              <p className="font-bold text-neutral-900">{req.restaurant?.name || 'Restaurante'}</p>
                              <p className="text-xs text-neutral-500">{req.daysRequested} día(s) — ${req.totalPrice.toFixed(2)} MXN — {new Date(req.createdAt).toLocaleDateString('es-MX')}</p>
                            </div>
                          </div>
                          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                            req.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800' :
                            req.status === 'REJECTED' ? 'bg-rose-100 text-rose-800' :
                            req.status === 'EXPIRED' ? 'bg-neutral-100 text-neutral-500' :
                            'bg-amber-100 text-amber-800'
                          }`}>
                            {req.status === 'PENDING' ? 'Pendiente' : req.status === 'APPROVED' ? 'Aprobado' : req.status === 'REJECTED' ? 'Rechazado' : 'Vencido'}
                          </span>
                        </div>
                        {req.paymentProof && (
                          <div className="mt-3">
                            <button onClick={() => setAdminProofPreviewUrl(req.paymentProof)}
                              className="flex items-center gap-1.5 rounded-lg border border-black/10 bg-white px-3.5 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 hover:border-neutral-300 transition-colors">
                              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                              Ver comprobante de pago
                            </button>
                          </div>
                        )}
                        {req.adminNotes && (
                          <div className="mt-2 text-sm text-neutral-600 bg-neutral-50 rounded-xl p-3">
                            <span className="font-semibold">Notas:</span> {req.adminNotes}
                          </div>
                        )}
                        {req.status === 'PENDING' && (
                          <div className="mt-4 flex gap-2">
                            <button onClick={async () => {
                              try {
                                const res = await fetch(`${apiBase}/admin/featured/requests/${req.id}`, {
                                  method: 'PATCH',
                                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                                  body: JSON.stringify({ status: 'APPROVED' }),
                                });
                                const data = await res.json();
                                if (data.success) {
                                  alert(`Solicitud de ${req.restaurant?.name} aprobada por ${req.daysRequested} día(s).`);
                                  loadFeaturedRequests();
                                } else alert(data.error?.message || 'Error al aprobar.');
                              } catch { alert('Error de conexión.'); }
                            }} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 transition-colors">
                              Aprobar
                            </button>
                            <button onClick={async () => {
                              const notes = prompt('Motivo del rechazo (opcional):');
                              try {
                                const res = await fetch(`${apiBase}/admin/featured/requests/${req.id}`, {
                                  method: 'PATCH',
                                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                                  body: JSON.stringify({ status: 'REJECTED', adminNotes: notes || undefined }),
                                });
                                const data = await res.json();
                                if (data.success) {
                                  alert(`Solicitud de ${req.restaurant?.name} rechazada.`);
                                  loadFeaturedRequests();
                                } else alert(data.error?.message || 'Error al rechazar.');
                              } catch { alert('Error de conexión.'); }
                            }} className="rounded-xl border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 transition-colors">
                              Rechazar
                            </button>
                          </div>
                        )}
                        {req.startDate && (
                          <div className="mt-2 text-xs text-neutral-500">
                            {(req.status === 'APPROVED' || req.status === 'EXPIRED') && (
                              <>Válido: {new Date(req.startDate).toLocaleDateString('es-MX')} — {new Date(req.endDate).toLocaleDateString('es-MX')}</>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                    {featuredTotal > 10 && (
                      <div className="flex justify-center gap-2 mt-4">
                        <button disabled={featuredPage <= 1} onClick={() => setFeaturedPage(p => Math.max(1, p - 1))} className="rounded-xl px-4 py-2 text-sm font-semibold bg-white border border-black/10 hover:bg-neutral-100 disabled:opacity-50">Anterior</button>
                        <span className="text-sm text-neutral-500 self-center">Pág. {featuredPage}</span>
                        <button disabled={featuredPage * 10 >= featuredTotal} onClick={() => setFeaturedPage(p => p + 1)} className="rounded-xl px-4 py-2 text-sm font-semibold bg-white border border-black/10 hover:bg-neutral-100 disabled:opacity-50">Siguiente</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : null}

            {/* MODAL DE VISTA PREVIA DE COMPROBANTE (ADMIN) */}
            {adminProofPreviewUrl ? (
              <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 px-4 py-5"
                role="dialog" aria-modal="true" onClick={() => setAdminProofPreviewUrl(null)}>
                <div className="relative max-h-[90vh] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => setAdminProofPreviewUrl(null)}
                    className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-white shadow-lg flex items-center justify-center text-neutral-500 hover:text-neutral-700 z-10 transition-colors">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </button>
                  <img src={adminProofPreviewUrl} alt="Comprobante de pago"
                    className="max-h-[85vh] max-w-[85vw] rounded-2xl shadow-2xl object-contain bg-white" />
                </div>
              </div>
            ) : null}

            {activeSection === 'notifications' ? (
              <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div>
                  <h2 className="text-3xl font-black tracking-tight text-neutral-900">Difusión Masiva</h2>
                  <p className="mt-1 text-base text-neutral-500">
                    Envía notificaciones Push en tiempo real a tus usuarios.
                  </p>
                </div>
                
                <div className="grid lg:grid-cols-[1fr_360px] gap-8 items-start">
                  {/* Left Column: Form */}
                  <div className="bg-white rounded-[32px] border border-black/5 shadow-sm p-8 relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none">
                      <svg className="w-40 h-40 text-blue-600" fill="currentColor" viewBox="0 0 24 24"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2zm-2 1H8v-6c0-2.48 1.51-4.5 4-4.5s4 2.02 4 4.5v6z" /></svg>
                    </div>
                    
                    <div className="relative z-10">
                      <h3 className="text-xl font-bold text-neutral-900 mb-8 flex items-center gap-3">
                        <div className="p-2.5 bg-blue-50 text-blue-600 rounded-2xl shadow-sm">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                        </div>
                        Crear Nueva Campaña
                      </h3>

                      <form onSubmit={submitNotificationBroadcast} className="flex flex-col gap-6">
                        <div className="space-y-1.5">
                          <label className="block text-sm font-bold text-neutral-700">Título de la Notificación</label>
                          <input
                            type="text"
                            required
                            maxLength={50}
                            placeholder="Ej: ¡Envío Gratis este Fin de Semana!"
                            value={notificationForm.title}
                            onChange={(e) => setNotificationForm({ ...notificationForm, title: e.target.value })}
                            className="w-full px-4 py-3.5 rounded-2xl border-2 border-black/5 bg-neutral-50/50 hover:bg-neutral-50 focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all font-semibold text-neutral-900 placeholder:text-neutral-400 placeholder:font-medium outline-none"
                          />
                        </div>
                        
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <label className="block text-sm font-bold text-neutral-700">Mensaje</label>
                            <span className="text-xs font-bold text-neutral-400">{notificationForm.body.length} / 150</span>
                          </div>
                          <textarea
                            required
                            rows={3}
                            maxLength={150}
                            placeholder="Escribe el contenido de la alerta..."
                            value={notificationForm.body}
                            onChange={(e) => setNotificationForm({ ...notificationForm, body: e.target.value })}
                            className="w-full px-4 py-3.5 rounded-2xl border-2 border-black/5 bg-neutral-50/50 hover:bg-neutral-50 focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all font-medium text-neutral-900 placeholder:text-neutral-400 resize-none outline-none"
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-2">
                          <div className="space-y-1.5">
                            <label className="block text-sm font-bold text-neutral-700">Destinatarios</label>
                            <div className="relative">
                              <select
                                value={notificationForm.targetRole}
                                onChange={(e) => setNotificationForm({ ...notificationForm, targetRole: e.target.value })}
                                className="w-full pl-4 pr-10 py-3.5 rounded-2xl border-2 border-black/5 bg-neutral-50/50 hover:bg-neutral-50 focus:bg-white focus:border-blue-500 transition-all font-semibold text-neutral-900 outline-none appearance-none cursor-pointer"
                              >
                                <option value="ALL">Todos los Usuarios</option>
                                <option value="CUSTOMER">Solo Clientes</option>
                                <option value="RESTAURANT">Solo Restaurantes</option>
                                <option value="DRIVER">Solo Repartidores</option>
                              </select>
                              <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none text-neutral-400">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                              </div>
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <label className="block text-sm font-bold text-neutral-700">Zona Geográfica</label>
                            <div className="relative">
                              <select
                                value={notificationForm.targetRegion}
                                onChange={(e) => setNotificationForm({ ...notificationForm, targetRegion: e.target.value })}
                                className="w-full pl-4 pr-10 py-3.5 rounded-2xl border-2 border-black/5 bg-neutral-50/50 hover:bg-neutral-50 focus:bg-white focus:border-blue-500 transition-all font-semibold text-neutral-900 outline-none appearance-none cursor-pointer"
                              >
                                <option value="">Global (Todas las zonas)</option>
                                {regions.map((r) => (
                                  <option key={r.code} value={r.code}>{r.name}</option>
                                ))}
                              </select>
                              <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none text-neutral-400">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="pt-6 mt-4 border-t border-black/5 flex justify-end">
                          <button
                            type="submit"
                            disabled={isSendingNotification || !notificationForm.title || !notificationForm.body}
                            className="group relative flex items-center gap-3 px-8 py-4 bg-neutral-950 text-white rounded-2xl font-bold hover:bg-blue-600 disabled:opacity-50 disabled:hover:bg-neutral-950 transition-all active:scale-95 overflow-hidden shadow-md shadow-black/10"
                          >
                            {isSendingNotification ? (
                              <>
                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                <span>Enviando...</span>
                              </>
                            ) : (
                              <>
                                <span className="relative z-10">Lanzar Notificación</span>
                                <svg className="w-5 h-5 relative z-10 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                              </>
                            )}
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>

                  {/* Right Column: Live Preview (iPhone Mockup) */}
                  <div className="sticky top-8 hidden lg:flex justify-center">
                    <div className="relative w-[300px] h-[600px] bg-neutral-900 rounded-[48px] p-3 shadow-2xl shadow-black/20 ring-1 ring-black/10 overflow-hidden transform transition-transform hover:-translate-y-2 duration-500">
                      {/* Notch */}
                      <div className="absolute top-0 inset-x-0 h-7 flex justify-center z-20">
                        <div className="w-32 h-6 bg-neutral-900 rounded-b-3xl"></div>
                      </div>
                      
                      {/* Screen Content */}
                      <div className="relative w-full h-full bg-[#f2f2f7] rounded-[36px] overflow-hidden flex flex-col">
                        {/* Wallpaper / Header area */}
                        <div className="h-48 bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 relative">
                          <div className="absolute inset-0 bg-black/10"></div>
                          {/* Top Bar (Time/Battery) */}
                          <div className="flex justify-between items-center px-6 pt-3 text-white text-[10px] font-bold z-10 relative">
                            <span>9:41</span>
                            <div className="flex gap-1.5 items-center">
                              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
                              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M15.67 4H14V2h-4v2H8.33C7.6 4 7 4.6 7 5.33v15.33C7 21.4 7.6 22 8.33 22h7.33c.74 0 1.34-.6 1.34-1.33V5.33C17 4.6 16.4 4 15.67 4z"/></svg>
                            </div>
                          </div>
                          
                          {/* Date text */}
                          <div className="text-center mt-6 text-white font-medium">
                            <p className="text-4xl font-light">9:41</p>
                            <p className="text-xs mt-1 font-semibold opacity-90">Domingo, 15 de Octubre</p>
                          </div>
                        </div>

                        {/* Notifications List Area */}
                        <div className="flex-1 -mt-16 px-3 z-10">
                          {/* Live Notification Bubble */}
                          <div className="bg-white/90 backdrop-blur-md rounded-[20px] p-3.5 shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-white/20 animate-in slide-in-from-top-4 fade-in duration-500">
                            <div className="flex items-center gap-2 mb-1.5">
                              <div className="w-5 h-5 bg-blue-600 rounded-md shadow-sm flex items-center justify-center text-white font-black text-[10px]">S</div>
                              <span className="text-[10px] font-bold text-neutral-500 tracking-wide">SADEL APP</span>
                              <span className="text-[10px] text-neutral-400 ml-auto font-medium">Ahora</span>
                            </div>
                            <h4 className="font-bold text-[13px] text-neutral-900 leading-tight">
                              {notificationForm.title || 'Tu Título Aquí'}
                            </h4>
                            <p className="text-[12px] text-neutral-600 mt-0.5 leading-snug line-clamp-3 break-words">
                              {notificationForm.body || 'Empieza a escribir en el formulario para ver cómo lucirá tu notificación.'}
                            </p>
                          </div>
                          
                          {/* Fake older notifications to make it look realistic */}
                          <div className="mt-3 bg-white/60 backdrop-blur-md rounded-[20px] p-3.5 shadow-sm border border-white/20 opacity-60">
                            <div className="flex items-center gap-2 mb-1.5">
                              <div className="w-5 h-5 bg-green-500 rounded-md flex items-center justify-center text-white"><svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></div>
                              <span className="text-[10px] font-bold text-neutral-500 tracking-wide">WHATSAPP</span>
                              <span className="text-[10px] text-neutral-400 ml-auto">Hace 1h</span>
                            </div>
                            <h4 className="font-bold text-[13px] text-neutral-900 leading-tight">Mamá</h4>
                            <p className="text-[12px] text-neutral-600 mt-0.5 leading-snug">No olvides comprar el pan al regresar a casa.</p>
                          </div>
                        </div>

                        {/* Home indicator */}
                        <div className="absolute bottom-2 inset-x-0 flex justify-center z-10">
                          <div className="w-24 h-1 bg-black/20 rounded-full"></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {activeSection === 'settings' ? (
              <div className="flex flex-col gap-6">
                {/* Menú Horizontal Premium de Configuración */}
                <nav className="flex items-center gap-3 overflow-x-auto pb-2 hide-scrollbar">
                  {[
                    { id: 'regions', icon: '🌎', label: 'Zonas y Cobertura' },
                    { id: 'categories', icon: '🏷️', label: 'Categorías' },
                    { id: 'brand', icon: '🎨', label: 'Marca y UX' },
                    { id: 'payments', icon: '💳', label: 'Pagos' },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setSettingsTab(tab.id as any)}
                      className={`flex shrink-0 items-center gap-2.5 rounded-full px-5 py-3 transition ${
                        settingsTab === tab.id
                          ? 'bg-neutral-950 text-white shadow-md'
                          : 'bg-white border border-black/5 text-neutral-600 hover:border-black/10 hover:bg-neutral-50 hover:text-neutral-900'
                      }`}
                    >
                      <span className="text-lg">{tab.icon}</span>
                      <span className="text-sm font-semibold">{tab.label}</span>
                    </button>
                  ))}
                </nav>

                {/* Contenido Principal */}
                <section className="flex-1 min-w-0">
                  <div className="rounded-[32px] border border-black/5 bg-white/70 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl md:p-8">
                    {settingsTab === 'regions' && (
                      <div className="space-y-6">
                        <div className="flex items-center justify-between">
                          <h2 className="text-2xl font-bold text-neutral-900">Zonas y Cobertura</h2>
                          <button
                            type="button"
                            onClick={openCreateRegionModal}
                            className="rounded-full bg-neutral-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-800 shadow-sm"
                          >
                            Agregar zona +
                          </button>
                        </div>
                        <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
                          <div className="space-y-6">
                            <PanelCard
                    title="Regiones SaDeL"
                    subtitle="Tarifa base de repartidores"
                    aside={regions.length ? `${regions.length} regiones` : undefined}
                  >
                    {regions.length > 0 ? (
                      <div className="space-y-3">
                        {regions.map((regionItem) => (
                          <button
                            key={regionItem.code}
                            type="button"
                            onClick={() => setSelectedRegionCode(regionItem.code)}
                            className={`w-full rounded-[24px] border px-4 py-4 text-left transition ${
                              selectedRegionCode === regionItem.code
                                ? 'border-neutral-950 bg-neutral-950 text-white'
                                : 'border-black/5 bg-neutral-50 hover:border-black/10 hover:bg-white'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-semibold">{regionItem.name}</p>
                                <p className={`mt-1 text-xs ${selectedRegionCode === regionItem.code ? 'text-white/65' : 'text-neutral-500'}`}>
                                  {regionItem.city}, {regionItem.state}
                                </p>
                              </div>
                              <span
                                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                                  regionItem.isActive
                                    ? selectedRegionCode === regionItem.code
                                      ? 'bg-white/12 text-white'
                                      : 'bg-emerald-50 text-emerald-700'
                                    : selectedRegionCode === regionItem.code
                                      ? 'bg-white/10 text-white/80'
                                      : 'bg-neutral-200 text-neutral-600'
                                }`}
                              >
                                {regionItem.isActive ? 'Activa' : 'Inactiva'}
                              </span>
                            </div>
                            <p className={`mt-3 text-sm ${selectedRegionCode === regionItem.code ? 'text-white/80' : 'text-neutral-600'}`}>
                              {regionItem.pricingModel === 'distance'
                                ? `Envío dinámico: $${regionItem.baseRate} 1er km + $${regionItem.perKmRate}/km`
                                : `Tarifa fija: ${formatCurrency(regionItem.baseDeliveryFee)}`}
                            </p>
                          </button>
                        ))}
                      </div>
                    ) : loadingRegions ? (
                      <EmptyState text="Cargando regiones..." compact />
                    ) : (
                      <EmptyState text="No hay regiones configuradas." compact />
                    )}
                  </PanelCard>
                          </div>
                          <div className="space-y-6">
                            <PanelCard
                    title="Configuracion de region"
                    subtitle="Costo real para repartidores SaDeL"
                    aside={selectedRegion?.name || 'Sin region'}
                  >
                    {selectedRegion && regionForm ? (
                      <form onSubmit={saveRegionChanges} className="space-y-5">
                        <div className="grid gap-3 md:grid-cols-2">
                          <InfoRow label="Region" value={selectedRegion.name} />
                          <InfoRow label="Cobertura" value={`${selectedRegion.city}, ${selectedRegion.state}`} />
                          <InfoRow
                            label="Pagos"
                            value={selectedRegion.supportedPayments.length ? selectedRegion.supportedPayments.join(', ') : 'Sin dato'}
                          />
                          <InfoRow label="Pais" value={selectedRegion.country} />
                        </div>

                        <div className="rounded-[28px] border border-emerald-100 bg-emerald-50 p-5 text-sm leading-7 text-emerald-900">
                          {regionForm.pricingModel === 'distance'
                            ? 'El costo de envío se calcula según la distancia: tarifa base por el primer km + tarifa por km extra. El cliente ve el precio exacto al instante.'
                            : 'La tarifa que ve el cliente cuando un restaurante usa repartidores SaDeL sale de esta region.'}
                        </div>

                        {/* Pricing model selector */}
                        <div className="grid gap-2">
                          <label className="text-sm font-semibold text-neutral-700">Modelo de tarifa</label>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setRegionForm((current) => (current ? { ...current, pricingModel: 'fixed' } : current))}
                              className={`flex-1 rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
                                regionForm.pricingModel === 'fixed'
                                  ? 'border-neutral-950 bg-neutral-950 text-white'
                                  : 'border-black/10 bg-white text-neutral-700 hover:bg-neutral-50'
                              }`}
                            >
                              Tarifa fija
                            </button>
                            <button
                              type="button"
                              onClick={() => setRegionForm((current) => (current ? { ...current, pricingModel: 'distance' } : current))}
                              className={`flex-1 rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
                                regionForm.pricingModel === 'distance'
                                  ? 'border-neutral-950 bg-neutral-950 text-white'
                                  : 'border-black/10 bg-white text-neutral-700 hover:bg-neutral-50'
                              }`}
                            >
                              Por distancia
                            </button>
                          </div>
                        </div>

                        {regionForm.pricingModel === 'fixed' ? (
                        <div className="grid gap-4 md:grid-cols-3">
                          <Field
                            label="Tarifa fija"
                            value={regionForm.baseDeliveryFee}
                            onChange={(value) => setRegionForm((current) => (current ? { ...current, baseDeliveryFee: value } : current))}
                            placeholder="35"
                          />
                          <Field
                            label="Radio de entrega (km)"
                            value={regionForm.deliveryRadius}
                            onChange={(value) => setRegionForm((current) => (current ? { ...current, deliveryRadius: value } : current))}
                            placeholder="20"
                          />
                        </div>
                        ) : (
                        <div className="grid gap-4 md:grid-cols-2">
                          <Field
                            label="Precio 1er km ($)"
                            value={regionForm.baseRate}
                            onChange={(value) => setRegionForm((current) => (current ? { ...current, baseRate: value } : current))}
                            placeholder="20"
                          />
                          <Field
                            label="Precio km extra ($)"
                            value={regionForm.perKmRate}
                            onChange={(value) => setRegionForm((current) => (current ? { ...current, perKmRate: value } : current))}
                            placeholder="8"
                          />
                          <Field
                            label="Tarifa mínima ($)"
                            value={regionForm.minDeliveryFee}
                            onChange={(value) => setRegionForm((current) => (current ? { ...current, minDeliveryFee: value } : current))}
                            placeholder="15"
                          />
                          <Field
                            label="Tarifa máxima ($)"
                            value={regionForm.maxDeliveryFee}
                            onChange={(value) => setRegionForm((current) => (current ? { ...current, maxDeliveryFee: value } : current))}
                            placeholder="150"
                          />
                          <Field
                            label="Radio de entrega (km)"
                            value={regionForm.deliveryRadius}
                            onChange={(value) => setRegionForm((current) => (current ? { ...current, deliveryRadius: value } : current))}
                            placeholder="20"
                          />
                        </div>
                        )}

                        <label className="flex items-center gap-3 rounded-2xl border border-black/10 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
                          <input
                            type="checkbox"
                            checked={regionForm.isActive}
                            onChange={(event) =>
                              setRegionForm((current) => (current ? { ...current, isActive: event.target.checked } : current))
                            }
                            className="h-4 w-4 rounded border-black/20"
                          />
                          <span>Region activa para operación</span>
                        </label>

                        <div className="flex flex-wrap gap-3">
                          <button
                            type="submit"
                            disabled={savingRegion}
                            className="rounded-full bg-neutral-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
                          >
                            {savingRegion ? 'Guardando region...' : 'Guardar region'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setRegionForm(createRegionEditFormState(selectedRegion))}
                            disabled={savingRegion}
                            className="rounded-full border border-black/10 px-4 py-3 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:border-black/5 disabled:text-neutral-400"
                          >
                            Restablecer
                          </button>
                        </div>
                      </form>
                    ) : (
                      <EmptyState text="Selecciona una region para editar la tarifa de repartidores SaDeL." />
                    )}
                  </PanelCard>
                          </div>
                        </div>
                      </div>
                    )}
            {settingsTab === 'categories' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-bold text-neutral-900">Categorías de la Plataforma</h2>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => loadStoreCategories()}
                      className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-neutral-50 shadow-sm"
                    >
                      Actualizar
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCategory({
                          id: '',
                          name: '',
                          icon: '',
                          color: '',
                          keywords: [],
                          isActive: true,
                          order: storeCategories.length,
                        });
                        setIsCreateCategoryModalOpen(true);
                      }}
                      className="rounded-full bg-neutral-950 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 shadow-sm"
                    >
                      Nueva Categoría
                    </button>
                  </div>
                </div>

                {loadingStoreCategories ? (
                  <div className="flex items-center justify-center rounded-2xl border border-black/5 bg-white p-12 shadow-sm">
                    <div className="flex items-center gap-3 text-neutral-500">
                      <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <span className="font-medium">Cargando...</span>
                    </div>
                  </div>
                ) : storeCategories.length === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-2xl border border-black/5 bg-white p-12 text-center shadow-sm">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 text-2xl mb-4">
                      🍽️
                    </div>
                    <p className="text-neutral-500 mb-6">No se encontraron categorías de la plataforma.</p>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCategory({
                          id: '',
                          name: '',
                          icon: '',
                          color: '',
                          keywords: [],
                          isActive: true,
                          order: 0,
                        });
                        setIsCreateCategoryModalOpen(true);
                      }}
                      className="rounded-full bg-neutral-950 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-800 shadow-sm"
                    >
                      Crear primera categoría
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {storeCategories.map((category) => (
                      <div
                        key={category.id}
                        className="group relative flex flex-col justify-between rounded-2xl border border-black/5 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            <div
                              className="flex h-12 w-12 items-center justify-center rounded-xl text-2xl shadow-sm"
                              style={{ backgroundColor: category.color || '#faf7f1' }}
                            >
                              {category.icon}
                            </div>
                            <div>
                              <h3 className="font-semibold text-neutral-900">{category.name}</h3>
                              <div className="flex items-center gap-2 mt-1">
                                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${category.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                                  {category.isActive ? 'Activo' : 'Inactivo'}
                                </span>
                                <span className="text-xs text-neutral-500">Orden: {category.order}</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 border-t border-black/5 pt-4">
                          <p className="text-xs text-neutral-500 mb-2 font-medium">Palabras Clave:</p>
                          <div className="flex flex-wrap gap-1">
                            {category.keywords.length > 0 ? category.keywords.map((kw, i) => (
                              <span key={i} className="inline-block rounded border border-black/10 bg-neutral-50 px-1.5 py-0.5 text-[10px] text-neutral-600">
                                {kw}
                              </span>
                            )) : <span className="text-xs text-neutral-400 italic">Sin palabras clave</span>}
                          </div>
                        </div>

                        <div className="absolute top-4 right-4 flex opacity-0 transition-opacity group-hover:opacity-100 gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingCategory({ ...category });
                              setIsCreateCategoryModalOpen(true);
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 text-neutral-600 hover:bg-blue-100 hover:text-blue-600 transition"
                            title="Editar"
                          >
                            ✏️
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteCategory(category.id)}
                            className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 text-neutral-600 hover:bg-red-100 hover:text-red-600 transition"
                            title="Eliminar"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
                    {settingsTab === 'brand' && (
                      <div className="space-y-6">
                        <div className="flex items-center justify-between mb-2">
                          <h2 className="text-2xl font-bold text-neutral-900">Marca y Experiencia (UX)</h2>
                        </div>
                        <div className="grid gap-6 md:grid-cols-2">
                          <div className="space-y-6">
                            <PanelCard
                    title="Ajustes de Marca"
                    subtitle="Imagenes de bienvenida"
                  >
                    <div className="space-y-4">
                      <Field
                        label="Imagen Restaurante"
                        value={restaurantWelcomeImage}
                        onChange={setRestaurantWelcomeImage}
                        placeholder="URL de la imagen"
                      />
                      <Field
                        label="Imagen Repartidor"
                        value={driverWelcomeImage}
                        onChange={setDriverWelcomeImage}
                        placeholder="URL de la imagen"
                      />
                      <button
                        type="button"
                        onClick={saveBrandSettings}
                        disabled={isSavingBrandSettings}
                        className="w-full rounded-full bg-neutral-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:bg-neutral-400 disabled:cursor-not-allowed"
                      >
                        {isSavingBrandSettings ? 'Guardando...' : 'Guardar Ajustes'}
                      </button>
                    </div>
                  </PanelCard>
                          </div>
                          {/* Removed Legacy Promo Modals here */}
                        </div>
                      </div>
                    )}
                    {settingsTab === 'payments' && (
                      <div className="space-y-6">
                        <div className="flex items-center justify-between mb-2">
                          <h2 className="text-2xl font-bold text-neutral-900">Pagos y Facturación</h2>
                        </div>
                        <div className="max-w-xl">
                          <PanelCard
                    title="Datos de Pago"
                    subtitle="Cuenta para recibir transferencias"
                  >
                    <div className="space-y-4">
                      <Field
                        label="Banco"
                        value={adminBankName}
                        onChange={setAdminBankName}
                        placeholder="Ej. BBVA"
                      />
                      <Field
                        label="Numero de cuenta / Tarjeta"
                        value={adminBankAccount}
                        onChange={setAdminBankAccount}
                        placeholder="Ej. 1234 5678 9012 3456"
                      />
                      <Field
                        label="Beneficiario"
                        value={adminBankBeneficiary}
                        onChange={setAdminBankBeneficiary}
                        placeholder="Ej. Administrador SaDeL"
                      />
                      <button
                        type="button"
                        onClick={saveBrandSettings}
                        disabled={isSavingBrandSettings}
                        className="w-full rounded-full bg-neutral-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:bg-neutral-400 disabled:cursor-not-allowed"
                      >
                        {isSavingBrandSettings ? 'Guardando...' : 'Guardar Datos de Pago'}
                      </button>
                    </div>
                  </PanelCard>
                        </div>
                      </div>
                    )}

                  </div>
                </section>
              </div>
            ) : null}

            {activeSection === 'stuck' ? (
              <StuckOrdersPanel apiBase={apiBase} token={token} />
            ) : null}

            {activeSection === 'customer-debts' ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold tracking-[-0.03em] text-neutral-950">Deuda de clientes</h2>
                    <p className="text-sm text-neutral-500 mt-0.5">
                      Pedidos no recibidos (cliente no salió). Aprobar el pago reactiva la cuenta del cliente.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={customerSettlementFilter}
                      onChange={(e) => setCustomerSettlementFilter(e.target.value)}
                      className="rounded-2xl border border-black/10 bg-white px-3 py-2 text-sm font-medium text-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-900/10"
                    >
                      <option value="">Todos los estados</option>
                      <option value="PENDING">Pendiente</option>
                      <option value="IN_REVIEW">En revisión</option>
                      <option value="PAID">Pagado</option>
                      <option value="REJECTED">Rechazado</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => void loadCustomerSettlements()}
                      className="rounded-2xl border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-50"
                    >
                      Actualizar
                    </button>
                  </div>
                </div>

                {loadingCustomerSettlements ? (
                  <div className="rounded-[28px] border border-dashed border-black/10 bg-white/40 p-10 text-center text-sm text-neutral-500">
                    Cargando...
                  </div>
                ) : customerSettlements.length === 0 ? (
                  <div className="rounded-[28px] border border-dashed border-black/10 bg-white/40 p-10 text-center">
                    <span className="text-3xl block mb-3">💳</span>
                    <h4 className="text-sm font-bold text-neutral-800">Sin deudas</h4>
                    <p className="text-xs text-neutral-500 mt-1">No hay deudas de clientes en este estado.</p>
                  </div>
                ) : (
                  <div className="grid gap-3">
                    {customerSettlements.map((s: any) => (
                      <div key={s.id} className="rounded-[24px] border border-black/5 bg-white p-5 shadow-sm">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-bold text-neutral-950">
                                {s.customer?.user?.name || 'Cliente'}
                              </span>
                              <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                                s.status === 'PENDING'
                                  ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                  : s.status === 'IN_REVIEW'
                                    ? 'bg-sky-50 text-sky-700 border border-sky-200'
                                    : s.status === 'PAID'
                                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                      : 'bg-rose-50 text-rose-700 border border-rose-200'
                              }`}>
                                {s.status === 'PENDING' ? 'Pendiente' : s.status === 'IN_REVIEW' ? 'En revisión' : s.status === 'PAID' ? 'Pagado' : 'Rechazado'}
                              </span>
                            </div>
                            <p className="text-xs text-neutral-500 mt-1">
                              {s.order?.restaurant?.name || '—'} · Pedido{' '}
                              <span className="font-mono">{s.order?.orderReference || s.reference}</span>
                            </p>
                            {s.customer?.user?.phone && (
                              <p className="text-xs text-neutral-400 mt-0.5">📞 {s.customer.user.phone}</p>
                            )}
                            {s.paymentProofUrl ? (
                              <button
                                type="button"
                                onClick={() => setViewingCustomerProofUrl(s.paymentProofUrl)}
                                className="mt-2 text-xs font-semibold text-sky-600 underline"
                              >
                                Ver comprobante
                              </button>
                            ) : null}
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-lg font-black text-neutral-950">
                              {new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(s.amount)}
                            </p>
                            <div className="mt-2 flex gap-2">
                              {s.status === 'IN_REVIEW' && (
                                <>
                                  <button
                                    type="button"
                                    disabled={customerSettlementActionLoading === s.id}
                                    onClick={() => void updateCustomerSettlementStatus(s.id, 'PAID')}
                                    className="rounded-xl bg-emerald-500 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-600 disabled:opacity-50"
                                  >
                                    Aprobar pago
                                  </button>
                                  <button
                                    type="button"
                                    disabled={customerSettlementActionLoading === s.id}
                                    onClick={() => void updateCustomerSettlementStatus(s.id, 'REJECTED')}
                                    className="rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-bold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
                                  >
                                    Rechazar
                                  </button>
                                </>
                              )}
                              {s.status === 'PENDING' && (
                                <span className="text-[10px] text-neutral-400 font-medium">Sin comprobante</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {isMobileNavOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setIsMobileNavOpen(false)} />
          <aside className="absolute left-0 top-0 flex h-full w-[300px] max-w-[86vw] flex-col overflow-hidden bg-[#fffdf8] shadow-[0_24px_90px_rgba(15,15,15,0.18)]">
            <div className="shrink-0 border-b border-black/5 px-5 py-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-2xl font-semibold tracking-[-0.05em] text-neutral-950">SaDeL</p>
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
              <p className="mt-4 truncate text-sm font-medium text-neutral-500">{adminUser.name}</p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
              <nav className="grid gap-2">
                {navigationItems.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      setActiveSection(item.key);
                      setIsMobileNavOpen(false);
                    }}
                    className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition ${
                      activeSection === item.key
                        ? 'bg-neutral-950 text-white'
                        : 'text-neutral-700 hover:bg-white'
                    }`}
                  >
                    <AdminNavIcon kind={item.key} />
                    {item.label}
                  </button>
                ))}
              </nav>

              <button
                type="button"
                onClick={() => {
                  clearSession();
                  setIsMobileNavOpen(false);
                }}
                className="mt-4 flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition text-rose-600 hover:bg-rose-50"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Cerrar sesión
              </button>
            </div>
          </aside>
        </div>
      ) : null}

      {isCreateRestaurantOpen ? (
        <div className="fixed inset-0 z-[60] bg-black/45 flex items-center justify-center p-4 overflow-hidden">
          <div
            className="absolute inset-0"
            onClick={() => {
              if (!creatingRestaurant) {
                closeCreateRestaurantModal();
              }
            }}
          />
          <section className="relative z-10 w-full max-w-lg rounded-2xl border border-black/5 bg-[#fffdf8] shadow-[0_28px_90px_rgba(15,15,15,0.2)] flex flex-col max-h-[95vh]">
            {/* Header fijo */}
            <div className="flex-shrink-0 flex items-center justify-between gap-3 p-4 border-b border-black/5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-neutral-400">
                  Alta administrativa
                </p>
                <h3 className="mt-1 text-lg font-semibold text-neutral-950">
                  Nuevo restaurante
                </h3>
              </div>
              <button
                type="button"
                onClick={closeCreateRestaurantModal}
                disabled={creatingRestaurant}
                className="flex-shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-black/10 bg-white text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Cerrar formulario"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            {/* Contenido scrolleable */}
            <div className="overflow-y-auto flex-1 min-h-0">
              <form id="restaurant-form" onSubmit={createRestaurant} className="space-y-3 p-4">
              <div className="grid gap-2">
                <Field
                  label="Nombre del restaurante"
                  value={createRestaurantForm.restaurantName}
                  onChange={(value) =>
                    setCreateRestaurantForm((current) => ({ ...current, restaurantName: value }))
                  }
                  placeholder="Tacos Centro"
                />
                <Field
                  label="Telefono de acceso"
                  value={createRestaurantForm.username}
                  onChange={(value) =>
                    setCreateRestaurantForm((current) => ({ ...current, username: value }))
                  }
                  placeholder="5512345678"
                  type="tel"
                />
                <Field
                  label="Contraseña"
                  value={createRestaurantForm.password}
                  onChange={(value) =>
                    setCreateRestaurantForm((current) => ({ ...current, password: value }))
                  }
                  placeholder="Minimo 6 caracteres"
                  type="password"
                />
                <Field
                  label="Tarifa de servicio"
                  value={createRestaurantForm.serviceFee}
                  onChange={(value) =>
                    setCreateRestaurantForm((current) => ({ ...current, serviceFee: value }))
                  }
                  placeholder="35"
                  type="number"
                />
                <label className="grid gap-1.5 text-sm">
                  <span className="font-semibold tracking-tight text-neutral-800">Tipo de negocio</span>
                    <select
                    value={createRestaurantForm.businessType}
                    onChange={(e) =>
                      setCreateRestaurantForm((current) => ({ ...current, businessType: e.target.value as BusinessType }))
                    }
                    className="w-full rounded-2xl border-none bg-neutral-100/50 px-4 py-3 text-neutral-900 outline-none ring-1 ring-inset ring-black/5 transition focus:bg-white focus:ring-2 focus:ring-black/10"
                  >
                    <option value="RESTAURANT">Restaurante</option>
                    <option value="STORE">Tienda</option>
                  </select>
                </label>
              </div>

              {/* Zonas - compacto */}
              <div className="border-t border-black/5 pt-3">
                <p className="text-sm font-semibold text-neutral-950 mb-2">Zona de operación</p>
                <div className="grid gap-2">
                  {activeRestaurantRegions.length > 0 ? (
                    activeRestaurantRegions.map((regionItem) => {
                      const isSelected = createRestaurantForm.region === regionItem.code;
                      return (
                        <button
                          key={regionItem.code}
                          type="button"
                          onClick={() =>
                            setCreateRestaurantForm((current) => ({ ...current, region: regionItem.code }))
                          }
                          className={`rounded-lg border px-3 py-2 text-sm text-left transition ${
                            isSelected
                              ? 'border-neutral-950 bg-neutral-950 text-white'
                              : 'border-black/5 bg-white hover:border-black/10'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium text-sm">{regionItem.name}</p>
                              <p className={`text-xs ${isSelected ? 'text-white/70' : 'text-neutral-500'}`}>
                                {regionItem.city}
                              </p>
                            </div>
                            <span className={`text-xs font-semibold ${isSelected ? 'text-white' : 'text-emerald-700'}`}>
                              {isSelected ? '✓' : '○'}
                            </span>
                          </div>
                        </button>
                      );
                    })
                  ) : (
                    <EmptyState text="No hay zonas activas disponibles." compact />
                  )}
                </div>
              </div>
            </form>
            </div>

            {/* Footer fijo con botones */}
            <div className="flex-shrink-0 flex flex-wrap justify-end gap-2 border-t border-black/5 p-3 bg-[#fffdf8]">
              <button
                type="button"
                onClick={closeCreateRestaurantModal}
                disabled={creatingRestaurant}
                className="rounded-lg border border-black/10 px-3 py-2 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="submit"
                form="restaurant-form"
                disabled={
                  creatingRestaurant ||
                  !createRestaurantForm.restaurantName.trim() ||
                  !createRestaurantForm.username.trim() ||
                  !createRestaurantForm.password.trim() ||
                  !createRestaurantForm.region.trim() ||
                  !createRestaurantForm.serviceFee.trim()
                }
                className="rounded-lg bg-neutral-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
              >
                {creatingRestaurant ? 'Creando...' : 'Crear'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {isCreateCategoryModalOpen && editingCategory ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm sm:p-6">
          <div className="w-full max-w-lg overflow-hidden rounded-3xl bg-white shadow-2xl animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-black/5 px-6 py-4 bg-neutral-50">
              <h3 className="text-lg font-bold text-neutral-900">{editingCategory.id ? 'Editar Categoría' : 'Nueva Categoría'}</h3>
              <button
                onClick={() => {
                  setIsCreateCategoryModalOpen(false);
                  setEditingCategory(null);
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 hover:bg-black/5 hover:text-neutral-900 transition"
              >
                ✕
              </button>
            </div>
            <div className="p-6">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  saveCategory(editingCategory);
                }}
                className="space-y-4"
              >
                <div>
                  <label className="block text-sm font-semibold text-neutral-700 mb-1">Nombre</label>
                  <input
                    type="text"
                    required
                    value={editingCategory.name}
                    onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })}
                    className="w-full rounded-xl border border-black/10 bg-white px-4 py-2.5 text-neutral-900 shadow-sm focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900"
                    placeholder="Ej. Hamburguesas"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-neutral-700 mb-1">Emoji / Icono</label>
                    <input
                      type="text"
                      required
                      value={editingCategory.icon}
                      onChange={(e) => setEditingCategory({ ...editingCategory, icon: e.target.value })}
                      className="w-full rounded-xl border border-black/10 bg-white px-4 py-2.5 text-neutral-900 shadow-sm focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900"
                      placeholder="Ej. 🍔"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-neutral-700 mb-1">Color de Fondo (Hex)</label>
                    <input
                      type="text"
                      value={editingCategory.color || ''}
                      onChange={(e) => setEditingCategory({ ...editingCategory, color: e.target.value })}
                      className="w-full rounded-xl border border-black/10 bg-white px-4 py-2.5 text-neutral-900 shadow-sm focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900"
                      placeholder="Ej. #FEE2E2"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-neutral-700 mb-1">Orden</label>
                  <input
                    type="number"
                    required
                    min="0"
                    value={editingCategory.order}
                    onChange={(e) => setEditingCategory({ ...editingCategory, order: parseInt(e.target.value) || 0 })}
                    className="w-full rounded-xl border border-black/10 bg-white px-4 py-2.5 text-neutral-900 shadow-sm focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-neutral-700 mb-1">Palabras Clave (separadas por coma)</label>
                  <input
                    type="text"
                    value={Array.isArray(editingCategory.keywords) ? editingCategory.keywords.join(', ') : editingCategory.keywords}
                    onChange={(e) => setEditingCategory({ ...editingCategory, keywords: e.target.value as any })}
                    className="w-full rounded-xl border border-black/10 bg-white px-4 py-2.5 text-neutral-900 shadow-sm focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900"
                    placeholder="Ej. burger, smash, comida rapida"
                  />
                  <p className="mt-1 text-[11px] text-neutral-500">Usado para inferir la categoría de los restaurantes existentes en la migración.</p>
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <input
                    type="checkbox"
                    id="isActiveCategory"
                    checked={editingCategory.isActive}
                    onChange={(e) => setEditingCategory({ ...editingCategory, isActive: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-neutral-900 focus:ring-neutral-900"
                  />
                  <label htmlFor="isActiveCategory" className="text-sm font-medium text-neutral-700">
                    Categoría Activa (Visible en la app)
                  </label>
                </div>

                <div className="pt-4 flex items-center justify-end gap-3 border-t border-black/5">
                  <button
                    type="button"
                    onClick={() => {
                      setIsCreateCategoryModalOpen(false);
                      setEditingCategory(null);
                    }}
                    className="rounded-xl px-5 py-2.5 text-sm font-semibold text-neutral-600 hover:bg-neutral-100 transition"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="rounded-xl bg-neutral-950 px-5 py-2.5 text-sm font-semibold text-white hover:bg-neutral-800 transition"
                  >
                    Guardar Categoría
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}

      {isCreateRegionOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 px-4 py-6">
          <div
            className="absolute inset-0"
            onClick={() => {
              if (!creatingRegion) {
                closeCreateRegionModal();
              }
            }}
          />
          <section className="relative z-10 w-full max-w-3xl rounded-[32px] border border-black/5 bg-[#fffdf8] p-5 shadow-[0_28px_90px_rgba(15,15,15,0.2)] md:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-neutral-400">
                  Configuracion
                </p>
                <h3 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-neutral-950">
                  Nueva zona de operacion
                </h3>
                <p className="mt-2 text-sm leading-6 text-neutral-500">
                  Define una nueva ciudad o localidad donde SaDeL quedara disponible para alta de restaurantes y operacion comercial.
                </p>
              </div>
              <button
                type="button"
                onClick={closeCreateRegionModal}
                disabled={creatingRegion}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-black/10 bg-white text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Cerrar formulario de zona"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            <form onSubmit={createRegion} className="mt-6 space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  label="Nombre de la zona"
                  value={createRegionForm.name}
                  onChange={(value) => setCreateRegionForm((current) => ({ ...current, name: value }))}
                  placeholder="CDMX Centro"
                />
                <Field
                  label="Pais"
                  value={createRegionForm.country}
                  onChange={(value) => setCreateRegionForm((current) => ({ ...current, country: value }))}
                  placeholder="Mexico"
                />
                <Field
                  label="Estado"
                  value={createRegionForm.state}
                  onChange={(value) => setCreateRegionForm((current) => ({ ...current, state: value }))}
                  placeholder="Ciudad de Mexico"
                />
                <Field
                  label="Ciudad o localidad"
                  value={createRegionForm.city}
                  onChange={(value) => setCreateRegionForm((current) => ({ ...current, city: value }))}
                  placeholder="Centro"
                />
                {/* Pricing model selector */}
                <div className="grid gap-2">
                  <label className="text-sm font-semibold text-neutral-700">Modelo de tarifa</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setCreateRegionForm((current) => ({ ...current, pricingModel: 'fixed' }))}
                      className={`flex-1 rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
                        createRegionForm.pricingModel === 'fixed'
                          ? 'border-neutral-950 bg-neutral-950 text-white'
                          : 'border-black/10 bg-white text-neutral-700 hover:bg-neutral-50'
                      }`}
                    >
                      Tarifa fija
                    </button>
                    <button
                      type="button"
                      onClick={() => setCreateRegionForm((current) => ({ ...current, pricingModel: 'distance' }))}
                      className={`flex-1 rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
                        createRegionForm.pricingModel === 'distance'
                          ? 'border-neutral-950 bg-neutral-950 text-white'
                          : 'border-black/10 bg-white text-neutral-700 hover:bg-neutral-50'
                      }`}
                    >
                      Por distancia
                    </button>
                  </div>
                </div>
                {createRegionForm.pricingModel === 'fixed' ? (
                <Field
                  label="Tarifa fija ($)"
                  value={createRegionForm.baseDeliveryFee}
                  onChange={(value) => setCreateRegionForm((current) => ({ ...current, baseDeliveryFee: value }))}
                  placeholder="35"
                  type="number"
                />
                ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  <Field
                    label="Precio 1er km ($)"
                    value={createRegionForm.baseRate}
                    onChange={(value) => setCreateRegionForm((current) => ({ ...current, baseRate: value }))}
                    placeholder="20"
                    type="number"
                  />
                  <Field
                    label="Precio km extra ($)"
                    value={createRegionForm.perKmRate}
                    onChange={(value) => setCreateRegionForm((current) => ({ ...current, perKmRate: value }))}
                    placeholder="8"
                    type="number"
                  />
                  <Field
                    label="Tarifa mínima ($)"
                    value={createRegionForm.minDeliveryFee}
                    onChange={(value) => setCreateRegionForm((current) => ({ ...current, minDeliveryFee: value }))}
                    placeholder="15"
                    type="number"
                  />
                  <Field
                    label="Tarifa máxima ($)"
                    value={createRegionForm.maxDeliveryFee}
                    onChange={(value) => setCreateRegionForm((current) => ({ ...current, maxDeliveryFee: value }))}
                    placeholder="150"
                    type="number"
                  />
                </div>
                )}
                <Field
                  label="Radio de entrega (km)"
                  value={createRegionForm.deliveryRadius}
                  onChange={(value) => setCreateRegionForm((current) => ({ ...current, deliveryRadius: value }))}
                  placeholder="20"
                  type="number"
                />
                <Field
                  label="Pagos soportados"
                  value={createRegionForm.supportedPayments}
                  onChange={(value) => setCreateRegionForm((current) => ({ ...current, supportedPayments: value }))}
                  placeholder="CASH, TRANSFER"
                />
              </div>

              <div className="rounded-[24px] border border-black/5 bg-neutral-50 p-4 text-sm leading-7 text-neutral-600">
                <span className="font-semibold text-neutral-900">Codigo interno:</span>{' '}
                {buildRegionCode({
                  country: createRegionForm.country,
                  state: createRegionForm.state,
                  city: createRegionForm.city,
                }) || 'Completa pais, estado y ciudad para generarlo'}.
                <p className="mt-2 text-xs leading-6 text-neutral-500">
                  Este codigo se usa solo para identificar la zona internamente. El nombre visible para la operacion y para los usuarios es el que escribes en &quot;Nombre de la zona&quot;.
                </p>
              </div>

              <label className="flex items-center gap-3 rounded-2xl border border-black/10 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
                <input
                  type="checkbox"
                  checked={createRegionForm.isActive}
                  onChange={(event) =>
                    setCreateRegionForm((current) => ({ ...current, isActive: event.target.checked }))
                  }
                  className="h-4 w-4 rounded border-black/20"
                />
                <span>Zona activa para alta de restaurantes y operacion</span>
              </label>

              <div className="flex flex-wrap justify-end gap-3">
                <button
                  type="button"
                  onClick={closeCreateRegionModal}
                  disabled={creatingRegion}
                  className="rounded-full border border-black/10 px-4 py-3 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={
                    creatingRegion ||
                    !createRegionForm.name.trim() ||
                    !createRegionForm.country.trim() ||
                    !createRegionForm.state.trim() ||
                    !createRegionForm.city.trim() ||
                    !createRegionForm.deliveryRadius.trim() ||
                    !createRegionForm.supportedPayments.trim() ||
                    (createRegionForm.pricingModel === 'fixed' && !createRegionForm.baseDeliveryFee.trim()) ||
                    (createRegionForm.pricingModel === 'distance' && (
                      !createRegionForm.baseRate.trim() ||
                      !createRegionForm.perKmRate.trim() ||
                      !createRegionForm.minDeliveryFee.trim() ||
                      !createRegionForm.maxDeliveryFee.trim()
                    ))
                  }
                  className="rounded-full bg-neutral-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
                >
                  {creatingRegion ? 'Creando zona...' : 'Crear zona'}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {isCreateDriverOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 px-4 py-6">
          <div
            className="absolute inset-0"
            onClick={() => {
              if (!creatingDriver) {
                closeCreateDriverModal();
              }
            }}
          />
          <section className="relative z-10 w-full max-w-2xl overflow-hidden rounded-[32px] border border-black/5 bg-white shadow-[0_40px_100px_-10px_rgba(0,0,0,0.3)]">
            <div className="absolute left-0 top-0 h-1.5 w-full bg-gradient-to-r from-emerald-400 to-teal-500" />
            <div className="p-6 sm:p-8">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-600 ring-1 ring-inset ring-emerald-500/20">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Nuevo Repartidor
                  </div>
                  <h3 className="mt-4 text-2xl font-bold tracking-tight text-neutral-950 sm:text-3xl">
                    Alta operativa
                  </h3>
                  <p className="mt-2 text-sm text-neutral-500 leading-relaxed">
                    Registra los datos esenciales para darle acceso a la plataforma. El resto de la información legal podrá ser completada después.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeCreateDriverModal}
                  disabled={creatingDriver}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 transition hover:bg-neutral-200 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Cerrar modal"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form onSubmit={createDriver} className="mt-8 flex flex-col gap-8">
                {/* Sección 1 */}
                <div>
                  <h4 className="mb-4 text-sm font-bold tracking-tight text-neutral-900 flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-100 text-xs text-neutral-500">1</span>
                    Datos de Acceso
                  </h4>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Nombre completo" value={createDriverForm.name} onChange={(v) => setCreateDriverForm(c => ({ ...c, name: v }))} placeholder="Ej. Luis Pérez" />
                    <Field label="Teléfono (WhatsApp)" value={createDriverForm.phone} onChange={(v) => setCreateDriverForm(c => ({ ...c, phone: v }))} placeholder="55 1234 5678" />
                    <Field label="Correo electrónico" value={createDriverForm.email} onChange={(v) => setCreateDriverForm(c => ({ ...c, email: v }))} placeholder="opcional@correo.com" />
                    <Field label="Contraseña provisional" value={createDriverForm.password} onChange={(v) => setCreateDriverForm(c => ({ ...c, password: v }))} placeholder="Min. 6 caracteres" type="password" />
                  </div>
                </div>

                <div className="h-px w-full bg-gradient-to-r from-transparent via-black/5 to-transparent" />

                {/* Sección 2 */}
                <div>
                  <h4 className="mb-4 text-sm font-bold tracking-tight text-neutral-900 flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-100 text-xs text-neutral-500">2</span>
                    Requisitos Operativos
                  </h4>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="sm:col-span-3">
                      <SelectField
                        label="Zona de cobertura"
                        value={createDriverForm.region}
                        onChange={(v) => setCreateDriverForm(c => ({ ...c, region: v }))}
                        options={regions.length ? regions.map(r => ({ value: r.code, label: r.name })) : [{ value: '', label: 'Sin zonas' }]}
                      />
                    </div>
                    <Field label="Tipo doc." value={createDriverForm.documentType} onChange={(v) => setCreateDriverForm(c => ({ ...c, documentType: v }))} placeholder="INE" />
                    <div className="sm:col-span-2">
                      <Field label="Número de identificación" value={createDriverForm.documentNumber} onChange={(v) => setCreateDriverForm(c => ({ ...c, documentNumber: v }))} placeholder="Folio o ID" />
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="mt-2 flex flex-wrap justify-end gap-3 rounded-[24px] bg-neutral-50/80 p-3 ring-1 ring-inset ring-black/5">
                  <button
                    type="button"
                    onClick={closeCreateDriverModal}
                    disabled={creatingDriver}
                    className="rounded-xl px-5 py-2.5 text-sm font-bold text-neutral-600 transition hover:bg-neutral-200 disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={
                      creatingDriver ||
                      !createDriverForm.name.trim() ||
                      !createDriverForm.phone.trim() ||
                      createDriverForm.password.trim().length < 6 ||
                      !createDriverForm.region.trim() ||
                      !createDriverForm.documentNumber.trim() ||
                      !createDriverForm.documentType.trim()
                    }
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-500 hover:shadow-xl disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:shadow-none"
                  >
                    {creatingDriver ? (
                      <>
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                        Creando cuenta...
                      </>
                    ) : (
                      'Dar de Alta al Repartidor'
                    )}
                  </button>
                </div>
              </form>
            </div>
          </section>
        </div>
      ) : null}

      {isApproveRequestModalOpen && (() => {
        const selectedReq = platformRequests.find(r => r.id === selectedRequestId) || dashboardStats?.pendingAffiliations?.find((r: any) => r.id === selectedRequestId);
        if (!selectedReq) return null;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm sm:p-6">
            <div className="w-full max-w-lg overflow-hidden rounded-[32px] bg-white shadow-2xl animate-scale-up">
              <div className="flex items-center justify-between border-b border-black/5 px-6 py-4 bg-neutral-50">
                <div>
                  <h3 className="text-lg font-bold text-neutral-900">Aprobar y Dar de Alta</h3>
                  <p className="text-xs text-neutral-500 mt-0.5">Asigna la zona de cobertura y una contraseña para el nuevo usuario.</p>
                </div>
                <button
                  onClick={() => setIsApproveRequestModalOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 hover:bg-neutral-200 text-neutral-600 transition"
                >
                  ✕
                </button>
              </div>
              <div className="p-6 space-y-4 text-left">
                <div>
                  <p className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider">Solicitante</p>
                  <p className="text-sm font-semibold text-neutral-800 mt-0.5">{selectedReq.ownerName} ({selectedReq.whatsapp})</p>
                </div>
                {selectedReq.type === 'RESTAURANT' && (
                  <div>
                    <p className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider">Nombre del Negocio</p>
                    <p className="text-sm font-semibold text-neutral-800 mt-0.5">{selectedReq.businessName}</p>
                  </div>
                )}

                <div>
                  <SelectField
                     label="Zona / Región Comercial"
                     value={approveRegion}
                     onChange={(value) => setApproveRegion(value)}
                     options={regions.length ? regions.map((regionItem) => ({ value: regionItem.code, label: regionItem.name })) : [{ value: '', label: 'Sin regiones' }]}
                  />
                </div>

                <div>
                  <Field
                    label="Contraseña Temporal"
                    value={approvePassword}
                    onChange={(value) => setApprovePassword(value)}
                    placeholder="sadel123"
                    type="text"
                  />
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-black/5">
                  <button
                    type="button"
                    onClick={() => setIsApproveRequestModalOpen(false)}
                    disabled={isSubmittingApproval}
                    className="rounded-full border border-black/10 px-5 py-3 text-xs font-bold text-neutral-700 hover:bg-neutral-50 transition"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={isSubmittingApproval || !approveRegion}
                    onClick={() => approvePlatformRequest(selectedReq.id, approveRegion, approvePassword)}
                    className="rounded-full bg-neutral-950 text-white hover:bg-neutral-800 px-6 py-3 text-xs font-bold transition flex items-center gap-2"
                  >
                    {isSubmittingApproval ? (
                      <>
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        <span>Aprobando...</span>
                      </>
                    ) : (
                      <span>Confirmar Aprobación</span>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {viewingSettlementUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm sm:p-6">
          <div className="w-full max-w-2xl overflow-hidden rounded-[32px] bg-white shadow-2xl animate-scale-up">
            <div className="flex items-center justify-between border-b border-black/5 px-6 py-4 bg-neutral-50">
              <div>
                <h3 className="text-lg font-bold text-neutral-900">Comprobante de Pago</h3>
                <p className="text-xs text-neutral-500 mt-0.5">Comprobante de transferencia enviado por el restaurante.</p>
              </div>
              <button
                onClick={() => setViewingSettlementUrl(null)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 hover:bg-neutral-200 text-neutral-600 transition"
              >
                ✕
              </button>
            </div>
            <div className="p-6 flex justify-center bg-neutral-100 max-h-[70vh] overflow-y-auto">
              <img
                src={viewingSettlementUrl}
                alt="Comprobante de pago"
                className="max-w-full h-auto rounded-xl object-contain shadow-sm"
              />
            </div>
            <div className="flex justify-end p-4 gap-3 border-t border-black/5 bg-white">
              <button
                type="button"
                onClick={() => setViewingSettlementUrl(null)}
                className="rounded-full bg-neutral-950 text-white hover:bg-neutral-800 px-6 py-2.5 text-xs font-bold transition"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}


      {viewingDriverProofUrl && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
          <div className="relative flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-[32px] bg-white shadow-2xl animate-scale-up">
            <div className="flex items-center justify-between border-b border-black/5 bg-neutral-50/50 px-6 py-4">
              <div>
                <h3 className="text-xl font-bold tracking-tight text-neutral-950">Comprobante de Pago</h3>
                <p className="mt-1 text-xs text-neutral-500">Comprobante subido por el repartidor para validar el pago.</p>
              </div>
              <button
                type="button"
                onClick={() => setViewingDriverProofUrl(null)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white border border-black/5 text-neutral-500 hover:bg-neutral-100 transition shadow-sm"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="relative flex flex-1 items-center justify-center overflow-auto bg-neutral-100/50 p-6 min-h-[40vh]">
              <img
                src={viewingDriverProofUrl}
                alt="Comprobante de pago del repartidor"
                className="max-h-[65vh] w-auto max-w-full rounded-xl object-contain shadow-md border border-black/5"
              />
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-black/5 bg-white px-6 py-4">
              <button
                type="button"
                onClick={() => setViewingDriverProofUrl(null)}
                className="rounded-full px-5 py-2.5 text-sm font-semibold text-neutral-600 hover:bg-neutral-100 transition"
              >
                Cerrar
              </button>
              <a
                href={viewingDriverProofUrl}
                download={`Comprobante-${selectedDriver?.user?.name || 'Repartidor'}.jpg`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-neutral-950 px-6 py-2.5 text-sm font-bold text-white transition hover:bg-neutral-800 shadow-lg shadow-neutral-900/20 active:scale-95"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                Descargar Imagen
              </a>
            </div>
          </div>
        </div>
      )}

      {viewingCustomerProofUrl && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
          <div className="relative flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-[32px] bg-white shadow-2xl animate-scale-up">
            <div className="flex items-center justify-between border-b border-black/5 bg-neutral-50/50 px-6 py-4">
              <div>
                <h3 className="text-xl font-bold tracking-tight text-neutral-950">Comprobante de Pago</h3>
                <p className="mt-1 text-xs text-neutral-500">Comprobante subido por el cliente para liquidar su deuda.</p>
              </div>
              <button
                type="button"
                onClick={() => setViewingCustomerProofUrl(null)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white border border-black/5 text-neutral-500 hover:bg-neutral-100 transition shadow-sm"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="relative flex flex-1 items-center justify-center overflow-auto bg-neutral-100/50 p-6 min-h-[40vh]">
              <img
                src={viewingCustomerProofUrl}
                alt="Comprobante de pago del cliente"
                className="max-h-[65vh] w-auto max-w-full rounded-xl object-contain shadow-md border border-black/5"
              />
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-black/5 bg-white px-6 py-4">
              <button
                type="button"
                onClick={() => setViewingCustomerProofUrl(null)}
                className="rounded-full px-5 py-2.5 text-sm font-semibold text-neutral-600 hover:bg-neutral-100 transition"
              >
                Cerrar
              </button>
              <a
                href={viewingCustomerProofUrl}
                download="Comprobante-cliente.jpg"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-neutral-950 px-6 py-2.5 text-sm font-bold text-white transition hover:bg-neutral-800 shadow-lg shadow-neutral-900/20 active:scale-95"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                Descargar Imagen
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminNavIcon({ kind }: { kind: AdminPortalSection }) {
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

  if (kind === 'restaurants') {
    return (
      <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M5 10h14v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-8Z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M4 10V7l2-3h12l2 3v3" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M9 14h6" />
      </svg>
    );
  }

  if (kind === 'drivers') {
    return (
      <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <circle cx="8" cy="17" r="2" strokeWidth={1.7} />
        <circle cx="17" cy="17" r="2" strokeWidth={1.7} />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M3 7h11v8H3zM14 10h3l3 3v2h-2" />
      </svg>
    );
  }

  if (kind === 'users') {
    return (
      <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <circle cx="12" cy="8" r="3.2" strokeWidth={1.7} />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M5 19a7 7 0 0 1 14 0" />
      </svg>
    );
  }

  if (kind === 'requests') {
    return (
      <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2Z" />
      </svg>
    );
  }

  if (kind === 'orders') {
    return (
      <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M3 6h18" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M16 10a4 4 0 0 1-8 0" />
      </svg>
    );
  }

  if (kind === 'support') {
    return (
      <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M3 18v-6a9 9 0 0 1 18 0v6" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
      </svg>
    );
  }

  if (kind === 'promotions') {
    return (
      <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
        <line x1="7" y1="7" x2="7.01" y2="7" strokeWidth={2.5} strokeLinecap="round" />
      </svg>
    );
  }

  if (kind === 'billboards') {
    return (
      <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <rect x="2" y="6" width="20" height="12" rx="2" strokeWidth={1.7} />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 6v12" />
      </svg>
    );
  }

  if (kind === 'notifications') {
    return (
      <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
    );
  }

  if (kind === 'featured') {
    return (
      <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <polygon strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
      </svg>
    );
  }

  if (kind === 'stuck') {
    return (
      <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <circle cx="12" cy="12" r="9" strokeWidth={1.7} />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 7v5l3 3" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 8V4m0 0l-2 2m2-2l2 2" />
      </svg>
    );
  }

  if (kind === 'customer-debts') {
    return (
      <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <rect x="3" y="6" width="18" height="13" rx="2" strokeWidth={1.7} />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M3 10h18" />
        <circle cx="8" cy="14" r="1" fill="currentColor" />
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

function StuckOrdersPanel({ apiBase, token }: { apiBase: string; token: string }) {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [resolving, setResolving] = useState<string | null>(null);
  const [errorMap, setErrorMap] = useState<Record<string, string>>({});
  const [confirmAction, setConfirmAction] = useState<{ orderId: string; action: string } | null>(null);

  useEffect(() => {
    loadOrders();
    const interval = setInterval(loadOrders, 30000);
    return () => clearInterval(interval);
  }, []);

  async function loadOrders() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${apiBase}/admin/orders/stuck`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.success) setOrders(json.data);
      else setError(json.error?.message || 'Error al cargar');
    } catch {
      setError('Error de conexión');
    } finally {
      setLoading(false);
    }
  }

  async function resolveOrder(orderId: string, action: string) {
    setConfirmAction(null);
    setResolving(orderId);
    setErrorMap((prev) => ({ ...prev, [orderId]: '' }));
    try {
      const res = await fetch(`${apiBase}/admin/orders/${orderId}/resolve-stuck`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, reason: `Resuelto vía panel admin: ${action}` }),
      });
      const json = await res.json();
      if (json.success) {
        setOrders((prev) => prev.filter((o) => o.id !== orderId));
      } else {
        setErrorMap((prev) => ({ ...prev, [orderId]: json.error?.message || 'Error al resolver' }));
      }
    } catch {
      setErrorMap((prev) => ({ ...prev, [orderId]: 'Error de conexión' }));
    } finally {
      setResolving(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-neutral-200 border-t-neutral-900" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-[32px] border border-red-200 bg-red-50 p-8 text-center">
        <p className="font-semibold text-red-700">{error}</p>
        <button onClick={loadOrders} className="mt-4 rounded-full bg-red-600 px-6 py-2 text-sm font-semibold text-white hover:bg-red-700">
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black tracking-tight text-neutral-900">Entregas Atascadas</h2>
          <p className="mt-1 text-base text-neutral-500">
            Pedidos en PICKED_UP / IN_TRANSIT sin progreso. {orders.length} detectado{orders.length !== 1 ? 's' : ''}.
          </p>
        </div>
        <button onClick={loadOrders} className="flex items-center gap-2 rounded-full border border-black/10 bg-white px-5 py-3 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 transition">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Actualizar
        </button>
      </div>

      {orders.length === 0 ? (
        <div className="rounded-[32px] border border-emerald-100 bg-emerald-50/50 p-12 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
            <svg className="h-8 w-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="text-xl font-bold text-emerald-800">No hay entregas atascadas</h3>
          <p className="mt-2 text-emerald-600">Todos los pedidos activos fluyen con normalidad.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {orders.map((order: any) => (
            <div key={order.id} className="rounded-[32px] border border-rose-100 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center rounded-full bg-rose-100 px-3 py-1 text-xs font-bold text-rose-700">
                      Nivel {order.stuckAlertLevel}
                    </span>
                    <span className="text-sm font-semibold text-neutral-500">#{order.orderReference}</span>
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${
                      order.status === 'PICKED_UP' ? 'bg-amber-100 text-amber-700' : 'bg-orange-100 text-orange-700'
                    }`}>
                      {order.status === 'PICKED_UP' ? 'Recogido' : 'En Ruta'}
                    </span>
                  </div>
                  <h4 className="mt-3 text-lg font-bold text-neutral-900">{order.restaurant?.name || '?'}</h4>
                  <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-neutral-500">
                    <span>Cliente: {order.customer?.user?.name || 'N/A'}</span>
                    <span>Repartidor: {order.driver?.user?.name || 'N/A'}</span>
                  </div>
                  {order.stuckAlertedAt && (
                    <p className="mt-1 text-xs text-neutral-400">
                      Última alerta: {new Date(order.stuckAlertedAt).toLocaleString('es-MX')}
                    </p>
                  )}
                  {errorMap[order.id] && (
                    <p className="mt-2 text-sm font-semibold text-red-600">{errorMap[order.id]}</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col gap-2">
                  <button
                    onClick={() => resolveOrder(order.id, 'reassign')}
                    disabled={resolving === order.id}
                    className="rounded-full bg-amber-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-amber-600 disabled:opacity-50 transition"
                  >
                    {resolving === order.id ? (
                      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    ) : 'Reasignar'}
                  </button>
                  <button
                    onClick={() => setConfirmAction({ orderId: order.id, action: 'force_deliver' })}
                    disabled={resolving === order.id}
                    className="rounded-full bg-emerald-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-600 disabled:opacity-50 transition"
                  >
                    Forzar Entrega
                  </button>
                  <button
                    onClick={() => setConfirmAction({ orderId: order.id, action: 'cancel_refund' })}
                    disabled={resolving === order.id}
                    className="rounded-full bg-red-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-red-600 disabled:opacity-50 transition"
                  >
                    Cancelar + Reembolso
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setConfirmAction(null)}>
          <div className="mx-4 w-full max-w-md rounded-[32px] bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-bold text-neutral-900">
              {confirmAction.action === 'force_deliver' ? '¿Forzar entrega?' : '¿Cancelar y reembolsar?'}
            </h3>
            <p className="mt-2 text-sm text-neutral-500">
              {confirmAction.action === 'force_deliver'
                ? 'La orden se marcará como entregada. Asegúrate de que el cliente recibió su pedido.'
                : 'La orden se cancelará y el cliente deberá ser reembolsado. Esta acción no se puede deshacer.'}
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setConfirmAction(null)}
                className="rounded-full border border-black/10 bg-white px-6 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 transition"
              >
                Volver
              </button>
              <button
                onClick={() => resolveOrder(confirmAction.orderId, confirmAction.action)}
                className={`rounded-full px-6 py-2.5 text-sm font-bold text-white transition ${
                  confirmAction.action === 'force_deliver'
                    ? 'bg-emerald-500 hover:bg-emerald-600'
                    : 'bg-red-500 hover:bg-red-600'
                }`}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  readOnly = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
  readOnly?: boolean;
}) {
  return (
    <label className="grid gap-2 text-sm text-neutral-600">
      <span className="font-medium text-neutral-800">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        className={`rounded-2xl border border-black/10 px-4 py-3 text-neutral-950 outline-none transition placeholder:text-neutral-400 focus:border-black/20 ${
          readOnly ? 'bg-neutral-100 cursor-not-allowed' : 'bg-white'
        }`}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="grid gap-2 text-sm text-neutral-600">
      <span className="font-medium text-neutral-800">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-neutral-950 outline-none transition focus:border-black/20"
      >
        {options.map((option) => (
          <option key={`${label}-${option.value || 'empty'}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function StatusPill({ status, inverted = false }: { status: UserAccountStatus; inverted?: boolean }) {
  const styles = inverted
    ? {
        ACTIVE: 'bg-white/12 text-white',
        SUSPENDED: 'bg-rose-500/20 text-white',
        INACTIVE: 'bg-white/10 text-white/80',
      }
    : {
        ACTIVE: 'bg-emerald-50 text-emerald-700',
        SUSPENDED: 'bg-rose-50 text-rose-700',
        INACTIVE: 'bg-neutral-200 text-neutral-600',
      };

  return (
    <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${styles[status]}`}>
      {getUserStatusLabel(status)}
    </span>
  );
}

function RiskPill({ level, inverted = false }: { level: CustomerRiskLevel; inverted?: boolean }) {
  const styles = inverted
    ? {
        LOW: 'bg-white/10 text-white/80',
        MEDIUM: 'bg-amber-500/20 text-white',
        HIGH: 'bg-rose-500/20 text-white',
      }
    : {
        LOW: 'bg-sky-50 text-sky-700',
        MEDIUM: 'bg-amber-50 text-amber-700',
        HIGH: 'bg-rose-50 text-rose-700',
      };

  return (
    <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${styles[level]}`}>
      Riesgo {getRiskLevelLabel(level)}
    </span>
  );
}

function DriverStatusPill({ status, inverted = false }: { status: DriverAccountStatus; inverted?: boolean }) {
  const styles = inverted
    ? {
        ACTIVE: 'bg-white/12 text-white',
        SUSPENDED: 'bg-rose-500/20 text-white',
        INACTIVE: 'bg-white/10 text-white/80',
      }
    : {
        ACTIVE: 'bg-emerald-50 text-emerald-700',
        SUSPENDED: 'bg-rose-50 text-rose-700',
        INACTIVE: 'bg-neutral-200 text-neutral-600',
      };

  return (
    <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${styles[status]}`}>
      {getDriverStatusLabel(status)}
    </span>
  );
}

function DriverAvailabilityPill({
  availability,
  inverted = false,
}: {
  availability: DriverAvailabilityStatus;
  inverted?: boolean;
}) {
  const styles = inverted
    ? {
        AVAILABLE: 'bg-emerald-500/20 text-white',
        BUSY: 'bg-amber-500/20 text-white',
        OFFLINE: 'bg-white/10 text-white/80',
      }
    : {
        AVAILABLE: 'bg-emerald-50 text-emerald-700',
        BUSY: 'bg-amber-50 text-amber-700',
        OFFLINE: 'bg-neutral-200 text-neutral-600',
      };

  return (
    <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${styles[availability]}`}>
      {getDriverAvailabilityLabel(availability)}
    </span>
  );
}

function LicenseStatePill({ state }: { state: DriverItem['licenseState'] }) {
  const styles = {
    valid: 'bg-emerald-50 text-emerald-700',
    expiring: 'bg-amber-50 text-amber-700',
    expired: 'bg-rose-50 text-rose-700',
    missing: 'bg-neutral-200 text-neutral-600',
  } satisfies Record<DriverItem['licenseState'], string>;

  return (
    <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${styles[state]}`}>
      {getLicenseStateLabel(state)}
    </span>
  );
}

function RestaurantBillingStatusPill({ restaurant }: { restaurant: RestaurantItem }) {
  let text = 'Al día';
  let dotColor = 'bg-emerald-500';
  let glowColor = 'bg-emerald-500/30';
  let textColor = 'text-emerald-700 group-hover:text-emerald-600';

  if (restaurant.status === 'SUSPENDED') {
    text = 'Suspendido';
    dotColor = 'bg-rose-500';
    glowColor = 'bg-rose-500/30';
    textColor = 'text-rose-700 group-hover:text-rose-600';
  } else if (restaurant.hasOverdueSettlement) {
    text = 'Pago Vencido';
    dotColor = 'bg-red-500';
    glowColor = 'bg-red-500/30';
    textColor = 'text-red-700 group-hover:text-red-600';
  } else if (restaurant.hasInReviewSettlement) {
    text = 'Por Confirmar';
    dotColor = 'bg-indigo-500';
    glowColor = 'bg-indigo-500/30';
    textColor = 'text-indigo-700 group-hover:text-indigo-600';
  } else if (restaurant.hasPendingSettlement) {
    text = 'Corte Pendiente';
    dotColor = 'bg-amber-500';
    glowColor = 'bg-amber-500/30';
    textColor = 'text-amber-700 group-hover:text-amber-600';
  }

  return (
    <div className="flex items-center gap-1.5 rounded-full bg-neutral-50 px-2 py-0.5 ring-1 ring-black/5 transition group-hover:bg-white group-hover:ring-black/10">
      <div className="relative flex h-2 w-2 items-center justify-center">
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${glowColor}`}></span>
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${dotColor}`}></span>
      </div>
      <span className={`text-[10px] font-bold uppercase tracking-wider transition ${textColor}`}>
        {text}
      </span>
    </div>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="group relative overflow-hidden rounded-[26px] bg-white p-5 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] ring-1 ring-black/5 transition hover:-translate-y-0.5 hover:shadow-[0_8px_30px_-4px_rgba(0,0,0,0.1)]">
      <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br from-neutral-100 to-transparent opacity-50 blur-2xl transition group-hover:scale-150 group-hover:from-neutral-200" />
      <div className="relative">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400">{label}</p>
        <p className="mt-3 text-3xl font-semibold tracking-tight text-neutral-900">{value}</p>
        {detail ? <p className="mt-2 text-xs font-medium text-neutral-500">{detail}</p> : null}
      </div>
    </div>
  );
}

function PanelCard({
  title,
  subtitle,
  aside,
  children,
}: {
  title: string;
  subtitle: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[32px] bg-white/70 p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-black/5 backdrop-blur-xl md:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400">{subtitle}</p>
          <h3 className="mt-1.5 text-2xl font-bold tracking-tight text-neutral-900">{title}</h3>
        </div>
        {aside && (
          <div className="inline-flex items-center rounded-full bg-neutral-100/80 px-3 py-1.5 text-xs font-semibold text-neutral-600 ring-1 ring-inset ring-black/5">
            {aside}
          </div>
        )}
      </div>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-[24px] border border-black/5 bg-neutral-50 px-4 py-3">
      <span className="text-neutral-500">{label}</span>
      <span className="text-right text-neutral-900">{value}</span>
    </div>
  );
}

function EmptyState({ text, compact = false }: { text: string; compact?: boolean }) {
  return (
    <div
      className={`rounded-[28px] border border-dashed border-black/10 bg-neutral-50 px-6 text-center text-neutral-500 ${
        compact ? 'py-8' : 'py-12'
      }`}
    >
      {text}
    </div>
  );
}

function Callout({
  tone,
  children,
}: {
  tone: 'info' | 'success' | 'danger';
  children: React.ReactNode;
}) {
  const tones = {
    info: 'border-sky-100 bg-sky-50 text-sky-700',
    success: 'border-emerald-100 bg-emerald-50 text-emerald-700',
    danger: 'border-rose-100 bg-rose-50 text-rose-700',
  } satisfies Record<'info' | 'success' | 'danger', string>;

  return <div className={`rounded-2xl border px-4 py-3 text-sm ${tones[tone]}`}>{children}</div>;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return 'Sin registro';
  }

  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function getUserStatusLabel(status: UserAccountStatus) {
  if (status === 'ACTIVE') {
    return 'Activa';
  }

  if (status === 'SUSPENDED') {
    return 'Suspendida';
  }

  return 'Inactiva';
}

function getDriverStatusLabel(status: DriverAccountStatus) {
  if (status === 'ACTIVE') {
    return 'Activo';
  }

  if (status === 'SUSPENDED') {
    return 'Suspendido';
  }

  return 'Inactivo';
}

function getDriverAvailabilityLabel(status: DriverAvailabilityStatus) {
  if (status === 'AVAILABLE') {
    return 'Disponible';
  }

  if (status === 'BUSY') {
    return 'Ocupado';
  }

  return 'Offline';
}

function getLicenseStateLabel(state: DriverItem['licenseState']) {
  if (state === 'valid') {
    return 'Vigente';
  }

  if (state === 'expiring') {
    return 'Por vencer';
  }

  if (state === 'expired') {
    return 'Vencida';
  }

  return 'Sin licencia';
}

function getRiskLevelLabel(level: CustomerRiskLevel) {
  if (level === 'HIGH') {
    return 'alto';
  }

  if (level === 'MEDIUM') {
    return 'medio';
  }

  return 'bajo';
}

function formatOrderStatusLabel(status: string, businessType?: string) {
  return getOrderStatusLabel(status, businessType);
}

function formatRegionLabel(regionCode: string, regions: RegionItem[]) {
  const matched = regions.find((regionItem) => regionItem.code === regionCode);

  if (matched) {
    return matched.name;
  }

  return regionCode
    .replace(/[-_]+/g, ' ')
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

const businessTypeLabel = (type: BusinessType): string => {
  return type === 'STORE' ? 'Tienda' : 'Restaurante';
};

function getRestaurantInitials(name: string) {
  const words = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (words.length === 0) {
    return 'SA';
  }

  return words.map((word) => word[0]?.toUpperCase() || '').join('');
}

function createRegionEditFormState(region: RegionItem): RegionEditForm {
  return {
    baseDeliveryFee: region.baseDeliveryFee.toString(),
    deliveryRadius: region.deliveryRadius.toString(),
    isActive: region.isActive,
    pricingModel: region.pricingModel || 'fixed',
    baseRate: (region.baseRate || 20).toString(),
    perKmRate: (region.perKmRate || 8).toString(),
    minDeliveryFee: (region.minDeliveryFee || 15).toString(),
    maxDeliveryFee: (region.maxDeliveryFee || 150).toString(),
  };
}

function parseRequiredDecimal(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  return Number.parseFloat(trimmed);
}

function createRegionFormState(): CreateRegionForm {
  return {
    name: '',
    country: 'Mexico',
    state: '',
    city: '',
    baseDeliveryFee: '',
    deliveryRadius: '20',
    pricingModel: 'fixed',
    baseRate: '20',
    perKmRate: '8',
    minDeliveryFee: '15',
    maxDeliveryFee: '150',
    supportedPayments: 'CASH, TRANSFER',
    isActive: true,
  };
}

function createRestaurantFormState(region = ''): CreateRestaurantForm {
  return {
    restaurantName: '',
    username: '',
    password: '',
    region,
    businessType: 'RESTAURANT',
    serviceFee: defaultRestaurantServiceFee,
    platformFeePerOrder: '0',
    street: '',
    number: '',
    neighborhood: '',
    city: '',
    state: '',
    zipCode: '',
    country: 'MX',
    reference: '',
    latitude: '',
    longitude: '',
  };
}

function createDriverFormState(region = ''): CreateDriverForm {
  return {
    name: '',
    phone: '',
    email: '',
    password: '',
    region,
    documentNumber: '',
    documentType: 'INE',
    bankAccount: '',
    licenseExpiry: '',
    platformFeePerOrder: '0',
    status: 'ACTIVE',
    availability: 'OFFLINE',
  };
}

function normalizeCredentialPhone(value: string) {
  return value.replace(/\D/g, '');
}

function buildLocalRestaurantEmail(phone: string) {
  const normalizedPhone = normalizeCredentialPhone(phone);
  return `${normalizedPhone || 'restaurante'}@sadel.local`;
}

function parseSupportedPayments(value: string) {
  return Array.from(
    new Set(
      value
        .split(',')
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean)
    )
  );
}

function sortRegionsByName(items: RegionItem[]) {
  return [...items].sort((left, right) => left.name.localeCompare(right.name, 'es'));
}

function buildRegionCode(params: { country: string; state: string; city: string }) {
  return [params.country, params.state, params.city]
    .map((value) =>
      value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
    )
    .filter(Boolean)
    .slice(-2)
    .join('-')
    .slice(0, 60);
}

function getPreferredRestaurantRegionCode(regions: RegionItem[], selectedRegionCode: string) {
  if (selectedRegionCode) {
    const selected = regions.find((regionItem) => regionItem.code === selectedRegionCode);

    if (selected?.isActive) {
      return selected.code;
    }
  }

  return regions.find((regionItem) => regionItem.isActive)?.code || regions[0]?.code || '';
}

function ImageUploadField({
  label,
  value,
  onChange,
  placeholder,
  apiBase,
  token,
  maxWidth = 800,
  maxHeight = 800,
  fileNamePrefix = 'promo',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  apiBase: string;
  token: string;
  maxWidth?: number;
  maxHeight?: number;
  fileNamePrefix?: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleButtonClick = () => {
    if (isUploading) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const compressedBase64 = await convertImageFileToDataUrl(file, maxWidth, maxHeight, 0.85);
      
      const uploadResult = await uploadMediaAsset({
        apiBase,
        token,
        kind: 'site-image',
        source: compressedBase64,
        fileName: `${fileNamePrefix}-${Date.now()}.jpg`,
        fallbackToSource: true,
      });

      onChange(uploadResult.url);
    } catch (err: any) {
      console.error('Error uploading promo image:', err);
      alert(err?.message || 'Error al subir la imagen.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="grid gap-2 text-sm text-neutral-600">
      <span className="font-medium text-neutral-800">{label}</span>
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept="image/*"
        onChange={handleFileChange}
      />
      <div className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="flex-1 rounded-2xl border border-black/10 px-4 py-3 text-neutral-950 outline-none transition placeholder:text-neutral-400 focus:border-black/20 bg-white"
        />
        <button
          type="button"
          onClick={handleButtonClick}
          disabled={isUploading}
          className={`shrink-0 rounded-2xl border px-5 py-3 text-sm font-semibold transition flex items-center justify-center gap-2 ${
            value 
              ? 'border-neutral-950 bg-white text-neutral-950 hover:bg-neutral-50' 
              : 'border-transparent bg-neutral-950 text-white hover:bg-neutral-800'
          } disabled:opacity-50`}
        >
          {isUploading ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          )}
          {value ? 'Cambiar' : 'Subir'}
        </button>
      </div>

      {value && (
        <div className="mt-2 relative rounded-2xl overflow-hidden border border-black/5 bg-neutral-50 aspect-[16/9] w-full max-h-40 flex items-center justify-center group shadow-sm transition-all hover:shadow-md duration-300">
          <img src={value} alt="Preview" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={() => onChange('')}
              className="rounded-full bg-red-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-red-700 transition"
            >
              Eliminar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
