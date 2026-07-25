/**
 * Validation Schemas for SaDeL Platform
 * Uses Zod for runtime validation
 */

import { z } from 'zod';

// ============== Auth Schemas ==============
export const LoginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const RegisterSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  phone: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number'),
  role: z.enum(['ADMIN', 'RESTAURANT', 'CUSTOMER', 'DRIVER']),
  region: z.string().min(1, 'Region is required'),
});

// ============== Restaurant Schemas ==============
export const CreateRestaurantSchema = z.object({
  name: z.string().min(3, 'Restaurant name must be at least 3 characters'),
  description: z.string().min(10, 'Description must be at least 10 characters'),
  address: z.string().min(5, 'Address is required'),
  contactPhone: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number'),
  email: z.string().email('Invalid email address'),
  hasOwnDelivery: z.boolean(),
  deliveryFee: z.number().positive('Delivery fee must be positive').optional(),
  region: z.string().min(1, 'Region is required'),
});

// ============== Product Schemas ==============
export const CreateProductSchema = z.object({
  name: z.string().min(2, 'Product name must be at least 2 characters'),
  description: z.string().min(5, 'Description must be at least 5 characters'),
  price: z.number().positive('Price must be positive'),
  categoryId: z.string().min(1, 'Invalid category ID'),
  sellBy: z.enum(['UNIT', 'WEIGHT']).default('UNIT'),
  unitPrice: z.number().positive('Unit price must be positive').nullish(),
  minWeightG: z.number().int().positive().nullish(),
  maxWeightG: z.number().int().positive().nullish(),
  stepWeightG: z.number().int().positive().nullish(),
  weightPresets: z.array(z.number().int().positive()).nullish(),
  preparationTime: z.number().positive('Preparation time must be positive'),
  calories: z.number().positive().optional(),
  allergens: z.array(z.string()).optional(),
});

// ============== Order Schemas ==============
const DeliveryAddressSchema = z.object({
  street: z.string().min(1, 'Street is required'),
  number: z.string().min(1, 'Number is required'),
  apartment: z.string().optional(),
  neighborhood: z.string().min(1, 'Neighborhood is required'),
  city: z.string().min(1, 'City is required'),
  state: z.string().min(1, 'State is required'),
  zipCode: z.string().min(1, 'Zip code is required'),
  country: z.string().min(1, 'Country is required'),
  reference: z.string().optional(),
});

export const CreateOrderSchema = z.object({
  restaurantId: z.string().min(1, 'Invalid restaurant ID'),
  items: z.array(
    z.object({
      productId: z.string().min(1, 'Invalid product ID'),
      quantity: z.number().int().positive('Quantity must be positive'),
      specialInstructions: z.string().optional(),
      weightG: z.number().int().positive().optional(),
    })
  ),
  fulfillmentType: z.enum(['DELIVERY', 'PICKUP']).default('DELIVERY'),
  deliveryAddress: DeliveryAddressSchema.optional(),
  paymentMethod: z.enum(['CASH', 'TRANSFER', 'CREDIT_CARD', 'DEBIT_CARD', 'DIGITAL_WALLET']),
  notes: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.fulfillmentType === 'DELIVERY' && !data.deliveryAddress) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Delivery address is required for delivery orders',
      path: ['deliveryAddress'],
    });
  }
});

// ============== Driver Schemas ==============
export const RegisterDriverSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  phone: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number'),
  documentNumber: z.string().min(5, 'Document number is required'),
  region: z.string().min(1, 'Region is required'),
  bankAccount: z.object({
    accountHolder: z.string().min(2, 'Account holder name is required'),
    accountNumber: z.string().min(8, 'Account number is required'),
    bankCode: z.string().min(1, 'Bank code is required'),
    accountType: z.enum(['CHECKING', 'SAVINGS']),
  }),
});

// ============== Pagination Schema ==============
export const PaginationSchema = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(10),
  search: z.string().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

// ============== Featured Purchase Schemas ==============
export const FeaturedRequestSchema = z.object({
  daysRequested: z.number().int().min(1, 'Debes solicitar al menos 1 día.').max(7, 'Máximo 7 días.'),
  paymentProof: z.string().min(1, 'El comprobante de pago es obligatorio.'),
});

export const AdminFeaturedReviewSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  adminNotes: z.string().optional(),
});

export type FeaturedRequestInput = z.infer<typeof FeaturedRequestSchema>;
export type AdminFeaturedReviewInput = z.infer<typeof AdminFeaturedReviewSchema>;

// Export types inferred from schemas
export type LoginInput = z.infer<typeof LoginSchema>;
export type RegisterInput = z.infer<typeof RegisterSchema>;
export type CreateRestaurantInput = z.infer<typeof CreateRestaurantSchema>;
export type CreateProductInput = z.infer<typeof CreateProductSchema>;
export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;
export type RegisterDriverInput = z.infer<typeof RegisterDriverSchema>;
export type PaginationInput = z.infer<typeof PaginationSchema>;
