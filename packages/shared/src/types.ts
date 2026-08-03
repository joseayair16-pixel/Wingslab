/**
 * Shared Types for SaDeL Platform
 * Central repository for all TypeScript types used across the application
 */

// ============== User Types ==============
export interface User {
  id: string;
  email: string;
  phone: string;
  name: string;
  role: UserRole;
  region: string;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}

export enum UserRole {
  ADMIN = 'ADMIN',
  RESTAURANT = 'RESTAURANT',
  CUSTOMER = 'CUSTOMER',
  DRIVER = 'DRIVER',
}

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  SUSPENDED = 'SUSPENDED',
}

// ============== Restaurant Types ==============
export interface Restaurant {
  id: string;
  userId: string;
  name: string;
  description: string;
  address: string;
  coordinates: Coordinates;
  region: string;
  logo: string;
  coverImage: string;
  status: RestaurantStatus;
  hasOwnDelivery: boolean;
  deliveryFee?: number;
  deliveryPricingModel?: 'fixed' | 'distance';
  deliveryBaseRate?: number;
  deliveryPerKmRate?: number;
  deliveryMinFee?: number;
  deliveryMaxFee?: number;
  maxCashOrder?: number;
  minDeliveryTime: number;
  maxDeliveryTime: number;
  operatingHours: OperatingHours[];
  contactPhone: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

export enum RestaurantStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  CLOSED = 'CLOSED',
  INACTIVE = 'INACTIVE',
}

export interface OperatingHours {
  dayOfWeek: number; // 0-6
  openTime: string; // HH:mm
  closeTime: string; // HH:mm
  isClosed: boolean;
}

// ============== Menu & Product Types ==============
export interface MenuCategory {
  id: string;
  restaurantId: string;
  name: string;
  description: string;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Product {
  id: string;
  restaurantId: string;
  categoryId: string;
  name: string;
  description: string;
  price: number;
  discountPrice?: number | null;
  sellBy: 'UNIT' | 'WEIGHT';
  unitPrice?: number | null;
  minWeightG?: number | null;
  maxWeightG?: number | null;
  stepWeightG?: number | null;
  weightPresets?: number[] | null;
  image: string;
  images?: string[];
  imagePosition?: string;
  imageZoom?: number;
  isAvailable: boolean;
  preparationTime: number;
  calories?: number;
  allergens?: string[];
  createdAt: Date;
  updatedAt: Date;
}

// ============== Order Types ==============
export interface Order {
  id: string;
  restaurantId: string;
  customerId: string;
  driverId?: string;
  items: OrderItem[];
  subtotal: number;
  taxAmount: number;
  deliveryFee: number;
  totalAmount: number;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  fulfillmentType: FulfillmentType;
  deliveryAddress?: Address;
  deliveryCoordinates?: Coordinates;
  estimatedDeliveryTime: Date;
  actualDeliveryTime?: Date;
  scheduledDeliveryAt?: string;
  scheduledDeliveryCustomerAcceptedAt?: string;
  pickupReadyAt?: Date;
  completedAt?: Date;
  pickupPin?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  specialInstructions?: string;
  sellBy: 'UNIT' | 'WEIGHT';
  weightG?: number | null;
}

export enum OrderStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  PREPARING = 'PREPARING',
  READY = 'READY',
  PICKED_UP = 'PICKED_UP',
  IN_TRANSIT = 'IN_TRANSIT',
  DELIVERED = 'DELIVERED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  REJECTED = 'REJECTED',
}

export type FulfillmentType = 'DELIVERY' | 'PICKUP';

export enum PaymentMethod {
  CASH = 'CASH',
  TRANSFER = 'TRANSFER',
  CREDIT_CARD = 'CREDIT_CARD',
  DEBIT_CARD = 'DEBIT_CARD',
  DIGITAL_WALLET = 'DIGITAL_WALLET',
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
}

// ============== Driver Types ==============
export interface Driver {
  id: string;
  userId: string;
  phone: string;
  name: string;
  region: string;
  status: DriverStatus;
  availability: DriverAvailability;
  rating: number;
  totalDeliveries: number;
  bankAccount?: BankAccount;
  documentNumber: string;
  documentType: string;
  profilePhoto: string;
  licensePhoto: string;
  licenseExpiry: Date;
  createdAt: Date;
  updatedAt: Date;
}

export enum DriverStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  SUSPENDED = 'SUSPENDED',
}

export enum DriverAvailability {
  AVAILABLE = 'AVAILABLE',
  BUSY = 'BUSY',
  OFFLINE = 'OFFLINE',
}

export interface BankAccount {
  accountHolder: string;
  accountNumber: string;
  bankCode: string;
  accountType: string;
}

// ============== Address & Location Types ==============
export interface Address {
  street: string;
  number: string;
  apartment?: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  reference?: string;
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

// ============== Payment Types ==============
export interface Transaction {
  id: string;
  orderId: string;
  restaurantId: string;
  driverId?: string;
  customerId: string;
  amount: number;
  type: TransactionType;
  status: TransactionStatus;
  reference: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export enum TransactionType {
  PAYMENT = 'PAYMENT',
  REFUND = 'REFUND',
  DRIVER_COMMISSION = 'DRIVER_COMMISSION',
  PLATFORM_FEE = 'PLATFORM_FEE',
}

export enum TransactionStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

// ============== Analytics Types ==============
export interface DailyStats {
  date: Date;
  region: string;
  totalOrders: number;
  totalRevenue: number;
  totalCustomers: number;
  totalRestaurants: number;
  totalDrivers: number;
  averageOrderValue: number;
  cancelledOrders: number;
}

export interface RestaurantStats {
  restaurantId: string;
  totalOrders: number;
  totalRevenue: number;
  rating: number;
  reviewCount: number;
  topProducts: Product[];
}

export interface DriverStats {
  driverId: string;
  totalDeliveries: number;
  totalEarnings: number;
  rating: number;
  averageDeliveryTime: number;
}

// ============== API Response Types ==============
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: {
    timestamp: number;
    version: string;
  };
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

// ============== Notification Types ==============
export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  read: boolean;
  createdAt: Date;
}

// ============== Featured Purchase Types ==============
export enum FeaturedPurchaseStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
}

export interface FeaturedPurchase {
  id: string;
  restaurantId: string;
  daysRequested: number;
  totalPrice: number;
  status: FeaturedPurchaseStatus;
  paymentProof?: string | null;
  adminNotes?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
  reviewedBy?: string | null;
  reviewedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export enum NotificationType {
  ORDER_PLACED = 'ORDER_PLACED',
  ORDER_CONFIRMED = 'ORDER_CONFIRMED',
  ORDER_READY = 'ORDER_READY',
  ORDER_PICKED_UP = 'ORDER_PICKED_UP',
  ORDER_DELIVERED = 'ORDER_DELIVERED',
  PAYMENT_REQUIRED = 'PAYMENT_REQUIRED',
  DRIVER_ASSIGNED = 'DRIVER_ASSIGNED',
  DRIVER_ARRIVED = 'DRIVER_ARRIVED',
  SCHEDULE_PROPOSAL = 'SCHEDULE_PROPOSAL',
}

// ============== Region Types ==============
export interface Region {
  id: string;
  code: string;
  name: string;
  country: string;
  state: string;
  city: string;
  baseDeliveryFee: number;
  deliveryRadius: number; // km
  supportedPaymentMethods: PaymentMethod[];
  taxRate: number;
  pricingModel: 'fixed' | 'distance';
  baseRate: number;
  perKmRate: number;
  minDeliveryFee: number;
  maxDeliveryFee: number;
  isActive: boolean;
}
