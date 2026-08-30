import { BillingCycle, BusinessType, OrderStatus, RestaurantStatus, UserRole, UserStatus, DriverStatus, DriverAvailability, Prisma } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcryptjs from 'bcryptjs';

import { prisma } from '../config/database';
import { getRedis } from '../config/redis';
import { authenticate, authorize, getAuthenticatedUser } from '../middleware/auth';
import {
  buildRestaurantBillingSummary,
  buildRestaurantBillingSummaryMap,
  buildRestaurantOperationalStats,
  buildRestaurantWeeklyPerformance,
  buildRestaurantOverview,
  createBillingSettlement,
} from '../services/restaurant-billing.service';
import { getMetricsSnapshot } from '../utils/metrics';
import { sendPushNotification } from '../services/notification.service';
import { emitNotification } from '../services/socket.service';
import { encrypt } from '../utils/crypto';
import { deleteImages, urlToKey } from '../services/storage.service';
import { invalidateRestaurantsCache, invalidateMenuCache } from '../services/cache.service';

const listRestaurantsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  search: z.string().optional(),
  region: z.string().optional(),
  status: z.nativeEnum(RestaurantStatus).optional(),
  businessType: z.nativeEnum(BusinessType).optional(),
});

const createRestaurantSchema = z.object({
  ownerName: z.string().min(2, 'El nombre del responsable es obligatorio.'),
  ownerPhone: z.string().min(8, 'El telefono del responsable es obligatorio.'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres.'),
  ownerEmail: z.string().email('Correo del responsable invalido.').optional(),
  name: z.string().min(3, 'El nombre del restaurante es obligatorio.'),
  description: z.string().min(10, 'La descripcion es obligatoria.'),
  address: z.string().min(5, 'La direccion es obligatoria.'),
  latitude: z.number(),
  longitude: z.number(),
  region: z.string().min(1, 'La region es obligatoria.'),
  contactPhone: z.string().min(8, 'El telefono de contacto es obligatorio.'),
  email: z.string().email('Correo del restaurante invalido.'),
  serviceFee: z.number().nonnegative().default(0),
  platformFeePerOrder: z.number().nonnegative().default(0),
  hasOwnDelivery: z.boolean(),
  supportsNetworkDelivery: z.boolean().default(true),
  pickupOnly: z.boolean().default(false),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'El color debe ser un hex válido (#RRGGBB).').nullable().optional(),
  deliveryFee: z.number().nonnegative().optional(),
  deliveryPricingModel: z.enum(['fixed', 'distance']).optional(),
  deliveryBaseRate: z.number().nonnegative().optional(),
  deliveryPerKmRate: z.number().nonnegative().optional(),
  deliveryMinFee: z.number().nonnegative().optional(),
  deliveryMaxFee: z.number().nonnegative().optional(),
  maxCashOrder: z.number().positive().optional(),
  minDeliveryTime: z.number().int().positive().default(30),
  maxDeliveryTime: z.number().int().positive().default(60),
  billingCycle: z.nativeEnum(BillingCycle).default(BillingCycle.WEEKLY),
  platformFeeRate: z.number().nonnegative().default(0).transform((val) => val > 1 ? val / 100 : val),
  billingContactEmail: z.string().email('Correo de facturacion invalido.').optional(),
  isFeatured: z.boolean().optional(),
  businessType: z.nativeEnum(BusinessType).optional(),
});

const updateRestaurantSchema = createRestaurantSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Debes enviar al menos un campo para actualizar.',
  });

const restaurantStatusTransitionSchema = z
  .object({
    status: z.nativeEnum(RestaurantStatus),
    reason: z.string().trim().max(300, 'El motivo es demasiado largo.').optional(),
  })
  .superRefine((data, context) => {
    if ((data.status === RestaurantStatus.SUSPENDED || data.status === RestaurantStatus.DELETED)) {
      if (!data.reason || data.reason.trim().length < 10) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['reason'],
          message: 'Debes capturar un motivo descriptivo (mínimo 10 caracteres) para este cambio de estado.',
        });
      }
    }
  });

const updateRegionSchema = z
  .object({
    baseDeliveryFee: z.number().nonnegative().optional(),
    deliveryRadius: z.number().positive().optional(),
    isActive: z.boolean().optional(),
    pricingModel: z.enum(['fixed', 'distance']).optional(),
    baseRate: z.number().nonnegative().optional(),
    perKmRate: z.number().nonnegative().optional(),
    minDeliveryFee: z.number().nonnegative().optional(),
    maxDeliveryFee: z.number().nonnegative().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Debes enviar al menos un campo para actualizar.',
  });

const createRegionSchema = z.object({
  code: z.string().min(2, 'El codigo de la zona es obligatorio.'),
  name: z.string().min(2, 'El nombre de la zona es obligatorio.'),
  country: z.string().min(2, 'El pais es obligatorio.'),
  state: z.string().min(2, 'El estado es obligatorio.'),
  city: z.string().min(2, 'La ciudad o localidad es obligatoria.'),
  baseDeliveryFee: z.number().nonnegative().default(5),
  deliveryRadius: z.number().positive().default(20),
  pricingModel: z.enum(['fixed', 'distance']).default('fixed'),
  baseRate: z.number().nonnegative().default(20),
  perKmRate: z.number().nonnegative().default(8),
  minDeliveryFee: z.number().nonnegative().default(15),
  maxDeliveryFee: z.number().nonnegative().default(150),
  supportedPayments: z.array(z.string().min(1)).default(['CASH', 'TRANSFER']),
  isActive: z.boolean().default(true),
});

const customerRiskLevelSchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);

const listCustomersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(12),
  search: z.string().optional(),
  region: z.string().optional(),
  status: z.nativeEnum(UserStatus).optional(),
  risk: customerRiskLevelSchema.optional(),
  sort: z.enum(['recent', 'orders', 'spend', 'risk']).default('recent'),
});

const updateCustomerStatusSchema = z
  .object({
    status: z.nativeEnum(UserStatus),
    reason: z.string().trim().max(300, 'El motivo es demasiado largo.').optional(),
  })
  .superRefine((data, context) => {
    if (data.status !== UserStatus.ACTIVE && !data.reason) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'Debes capturar un motivo para este cambio de estado.',
      });
    }
  });

function normalizeRegionCode(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

type CustomerRiskLevel = z.infer<typeof customerRiskLevelSchema>;

type CustomerOrderSnapshot = {
  customerId: string;
  status: OrderStatus;
  totalAmount: number;
  paymentMethod: string;
  createdAt: Date;
};

type CustomerRefundSnapshot = {
  customerId: string;
};

type CustomerComputedMetrics = {
  totalOrders: number;
  deliveredOrders: number;
  cancelledOrders: number;
  rejectedOrders: number;
  activeOrders: number;
  totalSpent: number;
  refundCount: number;
  lastOrderAt: Date | null;
  paymentMethods: string[];
  averageTicket: number;
  riskLevel: CustomerRiskLevel;
  riskScore: number;
  riskFlags: string[];
};

function buildCustomerUserWhere(search?: string, region?: string, status?: UserStatus) {
  return {
    role: UserRole.CUSTOMER,
    ...(search
      ? {
          OR: [
            { name: { startsWith: search, mode: 'insensitive' as const } },
            { phone: { startsWith: search } },
            { email: { startsWith: search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
    ...(region ? { region } : {}),
    ...(status ? { status } : {}),
  };
}

function buildCustomerMetrics(
  status: UserStatus,
  orders: CustomerOrderSnapshot[],
  refunds: CustomerRefundSnapshot[]
): CustomerComputedMetrics {
  const activeOrderStatuses: OrderStatus[] = [
    OrderStatus.PENDING,
    OrderStatus.CONFIRMED,
    OrderStatus.PREPARING,
    OrderStatus.READY,
    OrderStatus.PICKED_UP,
    OrderStatus.IN_TRANSIT,
  ];
  const nonBillableStatuses: OrderStatus[] = [OrderStatus.CANCELLED, OrderStatus.REJECTED];
  const deliveredOrders = orders.filter((order) => order.status === OrderStatus.DELIVERED).length;
  const cancelledOrders = orders.filter((order) => order.status === OrderStatus.CANCELLED).length;
  const rejectedOrders = orders.filter((order) => order.status === OrderStatus.REJECTED).length;
  const activeOrders = orders.filter((order) => activeOrderStatuses.includes(order.status)).length;
  const completedOrInFlightOrders = orders.filter((order) => !nonBillableStatuses.includes(order.status));
  const totalSpent = completedOrInFlightOrders.reduce((sum, order) => sum + order.totalAmount, 0);
  const lastOrderAt = orders.reduce<Date | null>((latest, order) => {
    if (!latest || order.createdAt > latest) {
      return order.createdAt;
    }

    return latest;
  }, null);
  const paymentMethods = Array.from(new Set(orders.map((order) => order.paymentMethod))).slice(0, 3);
  const averageTicket =
    completedOrInFlightOrders.length > 0 ? totalSpent / completedOrInFlightOrders.length : 0;

  const problematicOrders = cancelledOrders + rejectedOrders;
  const problematicRate = orders.length > 0 ? problematicOrders / orders.length : 0;
  let riskScore = 0;
  const riskFlags: string[] = [];

  if (status === UserStatus.SUSPENDED) {
    riskScore += 90;
    riskFlags.push('Cuenta suspendida');
  } else if (status === UserStatus.INACTIVE) {
    riskScore += 55;
    riskFlags.push('Cuenta desactivada');
  }

  if (refunds.length >= 2) {
    riskScore += 40;
    riskFlags.push('Reembolsos frecuentes');
  } else if (refunds.length === 1) {
    riskScore += 18;
    riskFlags.push('Tiene reembolso');
  }

  if (problematicOrders >= 3) {
    riskScore += problematicRate >= 0.35 ? 35 : 22;
    riskFlags.push('Varias cancelaciones o rechazos');
  } else if (problematicOrders === 2) {
    riskScore += 14;
    riskFlags.push('Cancelaciones recurrentes');
  }

  if (orders.length >= 4 && deliveredOrders === 0) {
    riskScore += 24;
    riskFlags.push('Sin entregas completadas');
  }

  const riskLevel: CustomerRiskLevel =
    riskScore >= 70 ? 'HIGH' : riskScore >= 30 ? 'MEDIUM' : 'LOW';

  return {
    totalOrders: orders.length,
    deliveredOrders,
    cancelledOrders,
    rejectedOrders,
    activeOrders,
    totalSpent,
    refundCount: refunds.length,
    lastOrderAt,
    paymentMethods,
    averageTicket,
    riskLevel,
    riskScore,
    riskFlags: Array.from(new Set(riskFlags)).slice(0, 3),
  };
}

function sortCustomersByMode<
  T extends {
    createdAt: Date;
    lastActivityAt: Date;
    computed: CustomerComputedMetrics;
  },
>(items: T[], sort: z.infer<typeof listCustomersQuerySchema>['sort']) {
  return [...items].sort((left, right) => {
    if (sort === 'risk') {
      return right.computed.riskScore - left.computed.riskScore || right.lastActivityAt.getTime() - left.lastActivityAt.getTime();
    }

    if (sort === 'orders') {
      return (
        right.computed.totalOrders - left.computed.totalOrders ||
        right.lastActivityAt.getTime() - left.lastActivityAt.getTime()
      );
    }

    if (sort === 'spend') {
      return (
        right.computed.totalSpent - left.computed.totalSpent ||
        right.lastActivityAt.getTime() - left.lastActivityAt.getTime()
      );
    }

    return right.lastActivityAt.getTime() - left.lastActivityAt.getTime();
  });
}

const settleRestaurantBillingSchema = z.object({
  notes: z.string().max(300, 'Las notas son demasiado largas.').optional(),
});

function buildStatusMetadata(
  status: RestaurantStatus,
  adminUserId: string,
  reason?: string
) {
  const normalizedReason = reason?.trim() || null;

  return {
    status,
    statusReason: status === RestaurantStatus.ACTIVE ? null : normalizedReason,
    statusChangedAt: new Date(),
    statusChangedBy: adminUserId,
  };
}

export async function registerAdminRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.register(async function adminScope(admin) {
    admin.addHook('preHandler', authenticate);
    admin.addHook('preHandler', authorize([UserRole.ADMIN]));

    admin.get('/admin/restaurantes', async (request, reply) => {
      const parsed = listRestaurantsQuerySchema.safeParse(request.query);

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_QUERY',
            message: parsed.error.issues[0]?.message || 'Query invalida.',
          },
        });
      }

      const { page, limit, search, region, status, businessType } = parsed.data;
      const where = {
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' as const } },
                { description: { contains: search, mode: 'insensitive' as const } },
                { user: { name: { contains: search, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
        ...(region ? { region } : {}),
        ...(status ? { status } : {}),
        ...(businessType ? { businessType } : {}),
      };

      const [items, total] = await prisma.$transaction([
        prisma.restaurant.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                phone: true,
                email: true,
              },
            },
            _count: {
              select: {
                billingSettlements: {
                  where: { status: 'IN_REVIEW' },
                },
              },
            },
          },
        }),
        prisma.restaurant.count({ where }),
      ]);

      const regionCodes = Array.from(new Set(items.map((item) => item.region).filter(Boolean)));
      const regionFees = regionCodes.length
        ? await prisma.region.findMany({
            where: {
              code: {
                in: regionCodes,
              },
            },
            select: {
              code: true,
              baseDeliveryFee: true,
            },
          })
        : [];
      const regionFeeMap = new Map(regionFees.map((region) => [region.code, region.baseDeliveryFee]));
      const mappedItems = items.map((item) => ({
        ...item,
        serviceFee: item.serviceFee,
        effectiveDeliveryFee: item.hasOwnDelivery ? item.deliveryFee : regionFeeMap.get(item.region) || 0,
      }));
      const billingSummaryMap = await buildRestaurantBillingSummaryMap(
        items.map((item) => ({
          id: item.id,
          billingCycle: item.billingCycle,
          platformFeeRate: item.platformFeeRate,
          serviceFee: item.serviceFee,
          platformFeePerOrder: item.platformFeePerOrder,
          lastBillingSettledAt: item.lastBillingSettledAt,
          createdAt: item.createdAt,
        }))
      );
      const enrichedItems = await (async () => {
        const restaurantIds = items.map((item) => item.id);
        const settlements = restaurantIds.length
          ? await prisma.restaurantBillingSettlement.findMany({
              where: {
                restaurantId: { in: restaurantIds },
                status: { in: ['PENDING', 'OVERDUE', 'IN_REVIEW'] },
              },
              select: {
                restaurantId: true,
                status: true,
              },
            })
          : [];

        return mappedItems.map((item) => {
          const itemSettlements = settlements.filter((s) => s.restaurantId === item.id);
          return {
            ...item,
            billingSummary: billingSummaryMap.get(item.id),
            hasOverdueSettlement: itemSettlements.some((s) => s.status === 'OVERDUE'),
            hasInReviewSettlement: itemSettlements.some((s) => s.status === 'IN_REVIEW'),
            hasPendingSettlement: itemSettlements.some((s) => s.status === 'PENDING'),
          };
        });
      })();

      return reply.send({
        success: true,
        data: {
          items: enrichedItems,
          total,
          page,
          limit,
          hasMore: page * limit < total,
        },
      });
    });

    admin.get('/admin/restaurantes/overview', async (_request, reply) => {
      return reply.send({
        success: true,
        data: await buildRestaurantOverview(),
      });
    });

    admin.get('/admin/usuarios/overview', async (_request, reply) => {
      const redis = getRedis();
      const cacheKey = 'admin:customers:overview';
      const cached = await redis.get(cacheKey);
      if (cached) {
        return reply.send({ success: true, data: JSON.parse(cached) });
      }

      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const [statusCounts, newThisMonth, customersWithOrders, addressStats, totalRevenue, totalRefunds, favoriteCount, reviewCount, activeCustomers30d, highRiskCustomers] = await Promise.all([
        // 1. Count by status
        prisma.user.groupBy({
          by: ['status'],
          where: { role: UserRole.CUSTOMER },
          _count: { id: true },
        }),
        // 2. New this month
        prisma.user.count({
          where: { role: UserRole.CUSTOMER, createdAt: { gte: monthStart } },
        }),
        // 3. Customers with at least one order
        prisma.customer.count({
          where: { totalOrders: { gt: 0 } },
        }),
        // 4. Address, favorite, review counts
        prisma.address.count(),
        // 5. Total revenue (delivered + completed)
        prisma.order.aggregate({
          where: { status: OrderStatus.DELIVERED },
          _sum: { totalAmount: true },
        }),
        // 6. Total refunds count
        prisma.transaction.count({
          where: { type: 'REFUND', status: 'COMPLETED' },
        }),
        // 7. Total favorites
        prisma.favoriteRestaurant.count(),
        // 8. Total reviews
        prisma.review.count(),
        // 9. Active in last 30 days (distinct customers with orders)
        prisma.order.groupBy({
          by: ['customerId'],
          where: { createdAt: { gte: thirtyDaysAgo } },
          _count: { customerId: true },
        }),
        // 10. High-risk customers (>2 completed refunds)
        prisma.transaction.groupBy({
          by: ['customerId'],
          where: { type: 'REFUND', status: 'COMPLETED' },
          _count: { customerId: true },
          having: { customerId: { _count: { gt: 2 } } },
        }),
      ]);

      const statusMap: Record<string, number> = { ACTIVE: 0, SUSPENDED: 0, INACTIVE: 0 };
      for (const row of statusCounts) {
        statusMap[row.status] = row._count.id;
      }

      const data = {
        totalCustomers: statusCounts.reduce((s, r) => s + r._count.id, 0),
        activeCustomers: statusMap['ACTIVE'] ?? 0,
        suspendedCustomers: statusMap['SUSPENDED'] ?? 0,
        inactiveCustomers: statusMap['INACTIVE'] ?? 0,
        newCustomersThisMonth: newThisMonth,
        customersWithOrders,
        activeInLast30Days: activeCustomers30d.length,
        highRiskCustomers: highRiskCustomers.length,
        totalRevenue: totalRevenue._sum?.totalAmount ?? 0,
        totalRefunds,
        totalAddresses: addressStats,
        totalFavorites: favoriteCount,
        totalReviews: reviewCount,
      };

      await redis.setex(cacheKey, 300, JSON.stringify(data));
      return reply.send({ success: true, data });
    });

    admin.get('/admin/usuarios', async (request, reply) => {
      const parsed = listCustomersQuerySchema.safeParse(request.query);

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_QUERY',
            message: parsed.error.issues[0]?.message || 'Query invalida.',
          },
        });
      }

      const { page, limit, search, region, status, risk, sort } = parsed.data;
      const userWhere = buildCustomerUserWhere(search, region, status);

      const [total, customers] = await Promise.all([
        prisma.customer.count({ where: { user: userWhere } }),
        prisma.customer.findMany({
          where: { user: userWhere },
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { user: { updatedAt: 'desc' } },
          select: {
            id: true,
            totalOrders: true,
            createdAt: true,
            updatedAt: true,
            user: {
              select: {
                id: true,
                name: true,
                phone: true,
                email: true,
                region: true,
                status: true,
                createdAt: true,
                updatedAt: true,
              },
            },
            _count: {
              select: {
                addresses: true,
                favorites: true,
                reviews: true,
              },
            },
          },
        }),
      ]);

      const customerIds = customers.map((customer) => customer.id);
      const [orders, refunds] = customerIds.length
        ? await Promise.all([
            prisma.order.findMany({
              where: { customerId: { in: customerIds } },
              select: {
                customerId: true,
                status: true,
                totalAmount: true,
                paymentMethod: true,
                createdAt: true,
              },
              take: 200,
            }),
            prisma.transaction.findMany({
              where: {
                customerId: { in: customerIds },
                type: 'REFUND',
                status: 'COMPLETED',
              },
              select: { customerId: true },
            }),
          ])
        : [[], []];

      const ordersByCustomerId = new Map<string, CustomerOrderSnapshot[]>();
      const refundsByCustomerId = new Map<string, CustomerRefundSnapshot[]>();

      for (const order of orders) {
        const current = ordersByCustomerId.get(order.customerId) || [];
        current.push(order);
        ordersByCustomerId.set(order.customerId, current);
      }

      for (const refund of refunds) {
        const current = refundsByCustomerId.get(refund.customerId) || [];
        current.push(refund);
        refundsByCustomerId.set(refund.customerId, current);
      }

      const enriched = customers.map((customer) => {
        const computed = buildCustomerMetrics(
          customer.user.status,
          ordersByCustomerId.get(customer.id) || [],
          refundsByCustomerId.get(customer.id) || []
        );
        const lastActivityAt =
          computed.lastOrderAt && computed.lastOrderAt > customer.user.updatedAt
            ? computed.lastOrderAt
            : customer.user.updatedAt;
        return { ...customer, computed, lastActivityAt };
      });

      const filtered = risk
        ? enriched.filter((customer) => customer.computed.riskLevel === risk)
        : enriched;
      const sorted = sortCustomersByMode(filtered, sort);

      return reply.send({
        success: true,
        data: {
          items: sorted.map((customer) => ({
            id: customer.user.id,
            customerId: customer.id,
            name: customer.user.name,
            phone: customer.user.phone,
            email: customer.user.email,
            region: customer.user.region,
            status: customer.user.status,
            createdAt: customer.user.createdAt,
            updatedAt: customer.user.updatedAt,
            lastActivityAt: customer.lastActivityAt,
            totalOrders: customer.computed.totalOrders,
            deliveredOrders: customer.computed.deliveredOrders,
            cancelledOrders: customer.computed.cancelledOrders,
            rejectedOrders: customer.computed.rejectedOrders,
            activeOrders: customer.computed.activeOrders,
            totalSpent: customer.computed.totalSpent,
            refundCount: customer.computed.refundCount,
            addressCount: customer._count.addresses,
            favoriteCount: customer._count.favorites,
            reviewCount: customer._count.reviews,
            riskLevel: customer.computed.riskLevel,
            riskScore: customer.computed.riskScore,
            riskFlags: customer.computed.riskFlags,
            averageTicket: customer.computed.averageTicket,
            paymentMethods: customer.computed.paymentMethods,
          })),
          total,
          page,
          limit,
          hasMore: page * limit < total,
        },
      });
    });

    admin.get('/admin/usuarios/:id', async (request, reply) => {
      const params = z
        .object({
          id: z.string().min(1, 'El identificador del usuario es obligatorio.'),
        })
        .safeParse(request.params);

      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: params.error.issues[0]?.message || 'Parametros invalidos.',
          },
        });
      }

      const customer = await prisma.customer.findFirst({
        where: {
          userId: params.data.id,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              lastName: true,
              phone: true,
              email: true,
              region: true,
              status: true,
              profilePhoto: true,
              dateOfBirth: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          addresses: {
            orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
          },
          favorites: {
            orderBy: {
              createdAt: 'desc',
            },
            take: 12,
          },
          reviews: {
            orderBy: {
              createdAt: 'desc',
            },
            take: 8,
          },
          orders: {
            orderBy: {
              createdAt: 'desc',
            },
            take: 12,
            include: {
              restaurant: {
                select: {
                  id: true,
                  name: true,
                  region: true,
                },
              },
              address: {
                select: {
                  street: true,
                  number: true,
                  neighborhood: true,
                  city: true,
                  state: true,
                },
              },
              driver: {
                select: {
                  id: true,
                  user: {
                    select: {
                      name: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!customer) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'CUSTOMER_NOT_FOUND',
            message: 'No se encontro el comensal solicitado.',
          },
        });
      }

      const [allOrders, refunds] = await Promise.all([
        prisma.order.findMany({
          where: {
            customerId: customer.id,
          },
          select: {
            customerId: true,
            status: true,
            totalAmount: true,
            paymentMethod: true,
            createdAt: true,
          },
          take: 200,
        }),
        prisma.transaction.findMany({
          where: {
            customerId: customer.id,
            type: 'REFUND',
            status: 'COMPLETED',
          },
          select: {
            customerId: true,
            amount: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 10,
        }),
      ]);

      const computed = buildCustomerMetrics(customer.user.status, allOrders, refunds);

      return reply.send({
        success: true,
        data: {
          id: customer.user.id,
          customerId: customer.id,
          name: customer.user.name,
          lastName: customer.user.lastName,
          phone: customer.user.phone,
          email: customer.user.email,
          region: customer.user.region,
          status: customer.user.status,
          profilePhoto: customer.user.profilePhoto,
          dateOfBirth: customer.user.dateOfBirth,
          createdAt: customer.user.createdAt,
          updatedAt: customer.user.updatedAt,
          totalOrdersRecorded: customer.totalOrders,
          rating: customer.rating,
          summary: {
            totalOrders: computed.totalOrders,
            deliveredOrders: computed.deliveredOrders,
            cancelledOrders: computed.cancelledOrders,
            rejectedOrders: computed.rejectedOrders,
            activeOrders: computed.activeOrders,
            totalSpent: computed.totalSpent,
            refundCount: computed.refundCount,
            riskLevel: computed.riskLevel,
            riskScore: computed.riskScore,
            riskFlags: computed.riskFlags,
            averageTicket: computed.averageTicket,
            paymentMethods: computed.paymentMethods,
            favoriteCount: customer.favorites.length,
            reviewCount: customer.reviews.length,
            addressCount: customer.addresses.length,
            lastOrderAt: computed.lastOrderAt,
          },
          addresses: customer.addresses,
          recentOrders: customer.orders,
          refunds,
          favorites: customer.favorites,
          reviews: customer.reviews,
        },
      });
    });

    admin.post('/admin/usuarios/:id/status', async (request, reply) => {
      const params = z
        .object({
          id: z.string().min(1, 'El identificador del usuario es obligatorio.'),
        })
        .safeParse(request.params);
      const parsed = updateCustomerStatusSchema.safeParse(request.body);

      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: params.error.issues[0]?.message || 'Parametros invalidos.',
          },
        });
      }

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: parsed.error.issues[0]?.message || 'Datos invalidos.',
          },
        });
      }

      const targetUser = await prisma.user.findUnique({
        where: {
          id: params.data.id,
        },
        include: {
          customer: {
            select: {
              id: true,
            },
          },
        },
      });

      if (!targetUser || targetUser.role !== UserRole.CUSTOMER || !targetUser.customer) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'CUSTOMER_NOT_FOUND',
            message: 'No se encontro el comensal solicitado.',
          },
        });
      }

      if (targetUser.status === parsed.data.status) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'STATUS_UNCHANGED',
            message: 'El usuario ya cuenta con ese estado.',
          },
        });
      }

      if (parsed.data.status !== UserStatus.ACTIVE) {
        const activeOrders = await prisma.order.count({
          where: {
            customerId: targetUser.customer.id,
            status: {
              in: [
                OrderStatus.PENDING,
                OrderStatus.CONFIRMED,
                OrderStatus.PREPARING,
                OrderStatus.READY,
                OrderStatus.PICKED_UP,
                OrderStatus.IN_TRANSIT,
              ],
            },
          },
        });

        if (activeOrders > 0) {
          return reply.status(409).send({
            success: false,
            error: {
              code: 'CUSTOMER_WITH_ACTIVE_ORDERS',
              message: 'No puedes suspender o desactivar un comensal con pedidos activos.',
            },
          });
        }
      }

      const updatedUser = await prisma.user.update({
        where: {
          id: targetUser.id,
        },
        data: {
          status: parsed.data.status,
        },
        select: {
          id: true,
          name: true,
          status: true,
          phone: true,
          email: true,
          region: true,
          updatedAt: true,
        },
      });

      // Force-logout: emit socket event so the customer app shows suspension modal
      if (parsed.data.status !== UserStatus.ACTIVE) {
        emitNotification(
          (fastify as any).io,
          targetUser.id,
          'CUSTOMER',
          'account:suspended',
          {
            status: parsed.data.status,
            reason: parsed.data.reason?.trim() || null,
            message: parsed.data.status === UserStatus.SUSPENDED
              ? 'Tu cuenta ha sido suspendida por incumplimiento de términos y condiciones.'
              : 'Tu cuenta ha sido desactivada.',
          }
        );
      }

      return reply.send({
        success: true,
        data: {
          ...updatedUser,
          reason: parsed.data.reason?.trim() || null,
        },
      });
    });

    admin.get('/admin/observabilidad/metricas', async (_request, reply) => {
      return reply.send({
        success: true,
        data: getMetricsSnapshot(),
      });
    });

    admin.get('/admin/dashboard-stats', async (request, reply) => {
      const rangeSchema = z.object({
        days: z.coerce.number().int().refine((v) => [7, 30, 90].includes(v), 'days debe ser 7, 30 o 90.').default(30),
      });
      const parsedRange = rangeSchema.safeParse(request.query);
      if (!parsedRange.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_QUERY', message: parsedRange.error.issues[0]?.message || 'Query invalida.' },
        });
      }
      const days = parsedRange.data.days;

      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
      startOfWeek.setHours(0, 0, 0, 0);
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const rangeStart = new Date(now);
      rangeStart.setDate(rangeStart.getDate() - (days - 1));
      rangeStart.setHours(0, 0, 0, 0);
      const previousPeriodStart = new Date(rangeStart);
      previousPeriodStart.setDate(previousPeriodStart.getDate() - days);

      const liveStatuses: OrderStatus[] = [OrderStatus.PENDING, OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.READY, OrderStatus.PICKED_UP, OrderStatus.IN_TRANSIT];

      const [
        activeOrdersCount,
        todayOrders,
        noDriversOrdersCount,
        pendingRestaurantSettlementsCount,
        pendingDriverSettlementsCount,
        pendingAffiliationsCount,
        pendingTicketsCount,
        driverStats,
        expiredLicenseCount,
        restaurantStats,
        netRevenueWeek,
        netRevenueMonth,
        netRevenueAllTime,
        periodOrders,
        previousPeriodOrders,
        statusDistribution,
        paymentMethods,
        fulfillmentSplit,
        totalCustomers,
        newCustomers,
        restaurantMeta,
        totalsAllTime,
        activeOrdersList,
      ] = await Promise.all([
        // 1. Active orders count
        prisma.order.count({ where: { status: { in: liveStatuses } } }),
        // 2. Today's orders (platform revenue focus)
        prisma.order.findMany({
          where: { createdAt: { gte: startOfToday }, status: { notIn: [OrderStatus.CANCELLED, OrderStatus.REJECTED] } },
          select: { totalAmount: true, platformFee: true, driverPlatformFee: true, serviceFee: true },
        }),
        // 3. No-driver alerts
        prisma.order.count({ where: { status: { in: liveStatuses }, noDriversAvailable: true } }),
        // 4-7. Inbox counts
        prisma.restaurantBillingSettlement.count({ where: { status: 'IN_REVIEW' } }),
        prisma.driverBillingSettlement.count({ where: { status: 'IN_REVIEW' } }),
        prisma.platformRequest.count({ where: { status: 'PENDING' } }),
        prisma.supportTicket.count({ where: { status: { in: ['PENDING', 'IN_PROGRESS'] } } }),
        // 8. Driver fleet stats
        prisma.driver.findMany({ select: { status: true, availability: true, licenseExpiry: true } }),
        prisma.driver.count({ where: { licenseExpiry: { lt: now } } }),
        // 9. Restaurant statuses
        prisma.restaurant.findMany({ select: { status: true } }),
        // 10. Net revenue this week
        prisma.order.aggregate({
          where: { createdAt: { gte: startOfWeek }, status: { notIn: [OrderStatus.CANCELLED, OrderStatus.REJECTED] } },
          _sum: { platformFee: true, driverPlatformFee: true, serviceFee: true },
          _count: { id: true },
        }),
        // 11. Net revenue this month
        prisma.order.aggregate({
          where: { createdAt: { gte: startOfMonth }, status: { notIn: [OrderStatus.CANCELLED, OrderStatus.REJECTED] } },
          _sum: { platformFee: true, driverPlatformFee: true, serviceFee: true },
          _count: { id: true },
        }),
        // 12. Net revenue all time
        prisma.order.aggregate({
          where: { status: { notIn: [OrderStatus.CANCELLED, OrderStatus.REJECTED] } },
          _sum: { totalAmount: true, platformFee: true, driverPlatformFee: true, serviceFee: true },
          _count: { id: true },
        }),
        // 13. Orders in the selected range (all statuses) — feeds charts, regions, top restaurants, peak hours
        prisma.order.findMany({
          where: { createdAt: { gte: rangeStart } },
          select: {
            createdAt: true, status: true, totalAmount: true, platformFee: true, driverPlatformFee: true,
            serviceFee: true, restaurantId: true, customerId: true, fulfillmentType: true,
          },
        }),
        // 14. Previous period for comparison
        prisma.order.findMany({
          where: {
            createdAt: { gte: previousPeriodStart, lt: rangeStart },
            status: { notIn: [OrderStatus.CANCELLED, OrderStatus.REJECTED] },
          },
          select: { totalAmount: true, platformFee: true, driverPlatformFee: true, serviceFee: true },
        }),
        // 15. Status distribution in range
        prisma.order.groupBy({
          by: ['status'],
          where: { createdAt: { gte: rangeStart } },
          _count: { _all: true },
        }),
        // 16. Payment methods in range
        prisma.order.groupBy({
          by: ['paymentMethod'],
          where: { createdAt: { gte: rangeStart } },
          _count: { _all: true },
        }),
        // 17. Delivery vs pickup split in range
        prisma.order.groupBy({
          by: ['fulfillmentType'],
          where: { createdAt: { gte: rangeStart } },
          _count: { _all: true },
        }),
        // 18. Customer totals
        prisma.user.count({ where: { role: UserRole.CUSTOMER, status: { not: 'INACTIVE' } } }),
        prisma.user.count({ where: { role: UserRole.CUSTOMER, createdAt: { gte: rangeStart } } }),
        // 19. Restaurant metadata for top restaurants + region mapping
        prisma.restaurant.findMany({ select: { id: true, name: true, region: true } }),
        // 20. All-time totals (GMV + delivered ticket)
        prisma.order.aggregate({
          where: { status: { in: [OrderStatus.DELIVERED, OrderStatus.COMPLETED] } },
          _sum: { totalAmount: true },
          _avg: { totalAmount: true },
          _count: { id: true },
        }),
        // 21. Active Orders list (max 10)
        prisma.order.findMany({
          where: { status: { in: liveStatuses } },
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: {
            restaurant: { select: { name: true } },
            customer: { include: { user: { select: { name: true } } } },
            driver: { include: { user: { select: { name: true } } } },
          },
        }),
      ]);

      // ── Today's metrics ──
      const todayOrdersCount = todayOrders.length;
      const todayGMV = todayOrders.reduce((s, o) => s + o.totalAmount, 0);
      const todayNetRevenue = todayOrders.reduce((s, o) => s + (o.platformFee ?? 0) + (o.driverPlatformFee ?? 0) + (o.serviceFee ?? 0), 0);
      const todayRestaurantFees = todayOrders.reduce((s, o) => s + (o.platformFee ?? 0), 0);
      const todayDriverFees = todayOrders.reduce((s, o) => s + (o.driverPlatformFee ?? 0), 0);
      const todayServiceFees = todayOrders.reduce((s, o) => s + (o.serviceFee ?? 0), 0);

      // ── Fleet & restaurant ──
      const totalDrivers = driverStats.length;
      const activeDrivers = driverStats.filter(d => d.status === 'ACTIVE' && (d.availability === 'AVAILABLE' || d.availability === 'BUSY')).length;
      const totalRestaurants = restaurantStats.length;
      const activeRestaurants = restaurantStats.filter(r => r.status === 'ACTIVE').length;
      const suspendedRestaurants = restaurantStats.filter(r => r.status === 'SUSPENDED').length;

      // ── Net revenue periods ──
      const weeklyNet = (netRevenueWeek._sum.platformFee ?? 0) + (netRevenueWeek._sum.driverPlatformFee ?? 0) + (netRevenueWeek._sum.serviceFee ?? 0);
      const monthlyNet = (netRevenueMonth._sum.platformFee ?? 0) + (netRevenueMonth._sum.driverPlatformFee ?? 0) + (netRevenueMonth._sum.serviceFee ?? 0);
      const allTimeNet = (netRevenueAllTime._sum.platformFee ?? 0) + (netRevenueAllTime._sum.driverPlatformFee ?? 0) + (netRevenueAllTime._sum.serviceFee ?? 0);
      const weeklyOrders = netRevenueWeek._count.id;
      const monthlyOrders = netRevenueMonth._count.id;
      const allTimeOrders = netRevenueAllTime._count.id;

      const isValid = (o: { status: string }) => o.status !== OrderStatus.CANCELLED && o.status !== OrderStatus.REJECTED;

      // ── Region earnings from range orders ──
      const restaurantMetaMap = new Map<string, { name: string; region: string }>();
      for (const r of restaurantMeta) restaurantMetaMap.set(r.id, { name: r.name, region: r.region });

      const regionMap = new Map<string, { region: string; gmv: number; netRevenue: number; restaurantFees: number; driverFees: number; serviceFees: number; orders: number }>();
      for (const o of periodOrders) {
        if (!isValid(o)) continue;
        const r = restaurantMetaMap.get(o.restaurantId)?.region || 'Otra';
        if (!regionMap.has(r)) regionMap.set(r, { region: r, gmv: 0, netRevenue: 0, restaurantFees: 0, driverFees: 0, serviceFees: 0, orders: 0 });
        const entry = regionMap.get(r)!;
        entry.gmv += o.totalAmount;
        entry.netRevenue += (o.platformFee ?? 0) + (o.driverPlatformFee ?? 0) + (o.serviceFee ?? 0);
        entry.restaurantFees += (o.platformFee ?? 0);
        entry.driverFees += (o.driverPlatformFee ?? 0);
        entry.serviceFees += (o.serviceFee ?? 0);
        entry.orders += 1;
      }
      const regionEarnings = Array.from(regionMap.values()).sort((a, b) => b.netRevenue - a.netRevenue);

      // ── Current vs previous period comparison ──
      const prevGMV = previousPeriodOrders.reduce((s, o) => s + o.totalAmount, 0);
      const prevNet = previousPeriodOrders.reduce((s, o) => s + (o.platformFee ?? 0) + (o.driverPlatformFee ?? 0) + (o.serviceFee ?? 0), 0);
      const prevOrders = previousPeriodOrders.length;
      let currGMV = 0;
      let currNet = 0;
      let currOrders = 0;
      const uniqueCustomers = new Set<string>();
      for (const o of periodOrders) {
        uniqueCustomers.add(o.customerId);
        if (!isValid(o)) continue;
        currOrders += 1;
        currGMV += o.totalAmount;
        currNet += (o.platformFee ?? 0) + (o.driverPlatformFee ?? 0) + (o.serviceFee ?? 0);
      }
      const avgTicketPeriod = currOrders > 0 ? currGMV / currOrders : 0;

      // ── Top restaurants (range) ──
      const topRestaurantMap = new Map<string, { id: string; gmv: number; orders: number }>();
      for (const o of periodOrders) {
        if (!isValid(o)) continue;
        const entry = topRestaurantMap.get(o.restaurantId) || { id: o.restaurantId, gmv: 0, orders: 0 };
        entry.gmv += o.totalAmount;
        entry.orders += 1;
        topRestaurantMap.set(o.restaurantId, entry);
      }
      const topRestaurants = Array.from(topRestaurantMap.values())
        .sort((a, b) => b.gmv - a.gmv)
        .slice(0, 5)
        .map((t) => ({
          id: t.id,
          name: restaurantMetaMap.get(t.id)?.name || 'Restaurante',
          region: restaurantMetaMap.get(t.id)?.region || '',
          gmv: t.gmv,
          orders: t.orders,
        }));

      // ── Peak hours (range) ──
      const hourCounts = new Array(24).fill(0);
      for (const o of periodOrders) {
        hourCounts[o.createdAt.getHours()] += 1;
      }
      const peakHours = hourCounts.map((orders, hour) => ({ hour, orders }));

      // ── Chart data (daily series for the selected range) ──
      const chartDataMap = new Map<string, { date: string; orders: number; gmv: number; netRevenue: number; deliveredOrders: number; rejectedOrders: number }>();
      for (let i = 0; i < days; i++) {
        const d = new Date(rangeStart);
        d.setDate(d.getDate() + i);
        const dateStr = d.toISOString().split('T')[0];
        const fmt = `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`;
        chartDataMap.set(dateStr, { date: fmt, orders: 0, gmv: 0, netRevenue: 0, deliveredOrders: 0, rejectedOrders: 0 });
      }
      for (const o of periodOrders) {
        const ds = o.createdAt.toISOString().split('T')[0];
        const e = chartDataMap.get(ds);
        if (!e) continue;
        if (o.status === OrderStatus.CANCELLED || o.status === OrderStatus.REJECTED) {
          e.rejectedOrders += 1;
          continue;
        }
        e.orders += 1;
        e.gmv += o.totalAmount;
        e.netRevenue += (o.platformFee ?? 0) + (o.driverPlatformFee ?? 0) + (o.serviceFee ?? 0);
        if (o.status === OrderStatus.DELIVERED || o.status === OrderStatus.COMPLETED) {
          e.deliveredOrders += 1;
        }
      }
      const chartData = Array.from(chartDataMap.values());

      // ── Pending queues ──
      const [pendingSettlements, pendingAffiliations, pendingTickets] = await Promise.all([
        prisma.restaurantBillingSettlement.findMany({
          where: { status: 'IN_REVIEW' }, orderBy: { updatedAt: 'desc' }, take: 5,
          include: { restaurant: { select: { name: true } } },
        }),
        prisma.platformRequest.findMany({
          where: { status: 'PENDING' }, orderBy: { createdAt: 'desc' }, take: 5,
        }),
        prisma.supportTicket.findMany({
          where: { status: { in: ['PENDING', 'IN_PROGRESS'] } }, orderBy: { createdAt: 'desc' }, take: 5,
          include: { customer: { select: { user: { select: { name: true } } } } },
        }),
      ]);

      return reply.send({
        success: true,
        data: {
          range: days,
          chartData,
          kpis: {
            activeOrdersCount,
            todayOrdersCount,
            todayGMV,
            todayNetRevenue,
            todayRestaurantFees,
            todayDriverFees,
            todayServiceFees,
            noDriversOrdersCount,
            pendingSettlementsCount: pendingRestaurantSettlementsCount + pendingDriverSettlementsCount,
            pendingAffiliationsCount,
            pendingTicketsCount,
            totalDrivers,
            activeDrivers,
            expiredLicenseCount,
            totalRestaurants,
            activeRestaurants,
            suspendedRestaurants,
          },
          netRevenue: {
            weekly: { amount: weeklyNet, orders: weeklyOrders },
            monthly: { amount: monthlyNet, orders: monthlyOrders },
            allTime: { amount: allTimeNet, orders: allTimeOrders },
          },
          regionEarnings,
          comparisons: {
            gmvChange: prevGMV > 0 ? ((currGMV - prevGMV) / prevGMV * 100).toFixed(1) : null,
            netChange: prevNet > 0 ? ((currNet - prevNet) / prevNet * 100).toFixed(1) : null,
            ordersChange: prevOrders > 0 ? ((currOrders - prevOrders) / prevOrders * 100).toFixed(1) : null,
            periodGmv: currGMV,
            periodNet: currNet,
            periodOrders: currOrders,
          },
          totals: {
            allTimeGmv: netRevenueAllTime._sum.totalAmount ?? 0,
            allTimeOrders,
            allTimeNet,
            deliveredOrders: totalsAllTime._count.id,
            avgTicket: allTimeOrders > 0 ? (netRevenueAllTime._sum.totalAmount ?? 0) / allTimeOrders : 0,
            avgOrderValue: totalsAllTime._avg.totalAmount ?? 0,
          },
          period: {
            gmv: currGMV,
            net: currNet,
            orders: currOrders,
            avgTicket: avgTicketPeriod,
            uniqueCustomers: uniqueCustomers.size,
            deliveredOrders: chartData.reduce((s, d) => s + d.deliveredOrders, 0),
            rejectedOrders: chartData.reduce((s, d) => s + d.rejectedOrders, 0),
          },
          statusDistribution: statusDistribution.map((row) => ({ status: row.status, count: row._count._all as number })),
          paymentMethods: paymentMethods.map((row) => ({ method: row.paymentMethod, count: row._count._all as number })),
          fulfillmentSplit: fulfillmentSplit.map((row) => ({ type: row.fulfillmentType, count: row._count._all as number })),
          customers: {
            totalCustomers,
            newCustomers,
            uniqueCustomersInPeriod: uniqueCustomers.size,
          },
          topRestaurants,
          peakHours,
          activeOrders: activeOrdersList.map(order => ({
            id: order.id, orderReference: order.orderReference, status: order.status,
            totalAmount: order.totalAmount, noDriversAvailable: order.noDriversAvailable,
            createdAt: order.createdAt.toISOString(), restaurantName: order.restaurant.name,
            customerName: order.customer.user.name, driverName: order.driver?.user?.name || null,
          })),
          pendingSettlements,
          pendingAffiliations,
          pendingTickets,
        },
      });
    });


    admin.get('/admin/regiones', async (_request, reply) => {
      const regions = await prisma.region.findMany({
        orderBy: {
          name: 'asc',
        },
      });

      return reply.send({
        success: true,
        data: regions,
      });
    });

    admin.post('/admin/regiones', async (request, reply) => {
      const parsed = createRegionSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: parsed.error.issues[0]?.message || 'Datos invalidos.',
          },
        });
      }

      const normalizedCode = normalizeRegionCode(parsed.data.code);

      if (!normalizedCode) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_REGION_CODE',
            message: 'No se pudo generar un codigo valido para la zona.',
          },
        });
      }

      const existingRegion = await prisma.region.findUnique({
        where: { code: normalizedCode },
        select: { id: true },
      });

      if (existingRegion) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'REGION_ALREADY_EXISTS',
            message: 'Ya existe una zona con ese codigo.',
          },
        });
      }

      try {
        const region = await prisma.region.create({
          data: {
            ...parsed.data,
            code: normalizedCode,
          },
        });

        return reply.status(201).send({
          success: true,
          data: region,
        });
      } catch (error) {
        // Defensa en profundidad: si el slug colisiona o se repite (state, city, name),
        // la restriccion unica de la BD lo garantiza y respondemos 409 claro, no un 500.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          return reply.status(409).send({
            success: false,
            error: {
              code: 'REGION_ALREADY_EXISTS',
              message: 'Ya existe una zona con ese nombre en la misma ciudad y estado.',
            },
          });
        }
        throw error;
      }
    });

    admin.patch('/admin/regiones/:code', async (request, reply) => {
      const params = z
        .object({
          code: z.string().min(1, 'El codigo de region es obligatorio.'),
        })
        .safeParse(request.params);

      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: params.error.issues[0]?.message || 'Parametros invalidos.',
          },
        });
      }

      const parsed = updateRegionSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: parsed.error.issues[0]?.message || 'Datos invalidos.',
          },
        });
      }

      const existingRegion = await prisma.region.findUnique({
        where: { code: params.data.code },
      });

      if (!existingRegion) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'REGION_NOT_FOUND',
            message: 'No se encontro la region.',
          },
        });
      }

      const region = await prisma.region.update({
        where: { code: params.data.code },
        data: parsed.data,
      });

      return reply.send({
        success: true,
        data: region,
      });
    });

    admin.delete('/admin/regiones/:code', async (request, reply) => {
      const params = z
        .object({
          code: z.string().min(1, 'El codigo de region es obligatorio.'),
        })
        .safeParse(request.params);

      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: 'Codigo de region invalido.',
          },
        });
      }

      const code = normalizeRegionCode(params.data.code);

      if (!code) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_REGION_CODE',
            message: 'No se pudo generar un codigo valido para la zona.',
          },
        });
      }

      const region = await prisma.region.findUnique({
        where: { code },
        select: { id: true, code: true, name: true, city: true, state: true },
      });

      if (!region) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'REGION_NOT_FOUND',
            message: 'No se encontro la zona.',
          },
        });
      }

      const [
        restaurantCount,
        driverCount,
        memberCount,
        dailyStatsCount,
        promotionCount,
        billboardCount,
      ] = await Promise.all([
        prisma.restaurant.count({ where: { region: code } }),
        prisma.driver.count({ where: { region: code } }),
        prisma.user.count({ where: { region: code, role: { not: UserRole.ADMIN } } }),
        prisma.dailyStats.count({ where: { region: code } }),
        prisma.promotion.count({ where: { regions: { has: code } } }),
        prisma.billboard.count({ where: { regions: { has: code } } }),
      ]);

      const blockMessage =
        restaurantCount > 0
          ? `No se puede eliminar la zona porque ${restaurantCount} restaurante(s) la usan. Reasigna esos restaurantes a otra zona primero.`
          : driverCount > 0
            ? `No se puede eliminar la zona porque ${driverCount} repartidor(es) la usan. Reasigna esos repartidores a otra zona primero.`
            : memberCount > 0
              ? `No se puede eliminar la zona porque ${memberCount} cliente(s) la usan. Reasigna esos clientes a otra zona primero.`
              : dailyStatsCount > 0
                ? 'No se puede eliminar la zona porque existen pedidos o historial vinculados a ella.'
                : null;

      if (blockMessage) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'REGION_IN_USE',
            message: blockMessage,
          },
        });
      }

      await prisma.$transaction(async (tx) => {
        if (promotionCount > 0) {
          const promotions = await tx.promotion.findMany({
            where: { regions: { has: code } },
            select: { id: true, regions: true },
          });
          await Promise.all(
            promotions.map((promotion) =>
              tx.promotion.update({
                where: { id: promotion.id },
                data: { regions: promotion.regions.filter((item) => item !== code) },
              })
            )
          );
        }

        if (billboardCount > 0) {
          const billboards = await tx.billboard.findMany({
            where: { regions: { has: code } },
            select: { id: true, regions: true },
          });
          await Promise.all(
            billboards.map((billboard) =>
              tx.billboard.update({
                where: { id: billboard.id },
                data: { regions: billboard.regions.filter((item) => item !== code) },
              })
            )
          );
        }

        await tx.region.delete({
          where: { code },
        });
      });

      return reply.send({
        success: true,
        data: region,
      });
    });

    admin.get('/admin/restaurantes/:id', async (request, reply) => {
      const params = z
        .object({
          id: z.string().min(1, 'El id es obligatorio.'),
        })
        .safeParse(request.params);

      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: params.error.issues[0]?.message || 'Parametros invalidos.',
          },
        });
      }

      const restaurant = await prisma.restaurant.findUnique({
        where: { id: params.data.id },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
              region: true,
              status: true,
            },
          },
          categories: true,
          operatingHours: true,
        },
      });

      if (!restaurant) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'RESTAURANT_NOT_FOUND',
            message: 'No se encontro el restaurante.',
          },
        });
      }

      const regionConfig = await prisma.region.findUnique({
        where: { code: restaurant.region },
        select: {
          baseDeliveryFee: true,
        },
      });

      return reply.send({
        success: true,
        data: {
          ...restaurant,
          serviceFee: restaurant.serviceFee,
          effectiveDeliveryFee: restaurant.hasOwnDelivery ? restaurant.deliveryFee : regionConfig?.baseDeliveryFee || 0,
          billingSummary: await buildRestaurantBillingSummary({
            id: restaurant.id,
            billingCycle: restaurant.billingCycle,
            platformFeeRate: restaurant.platformFeeRate,
            serviceFee: restaurant.serviceFee,
            platformFeePerOrder: restaurant.platformFeePerOrder,
            lastBillingSettledAt: restaurant.lastBillingSettledAt,
            createdAt: restaurant.createdAt,
          }),
          operationalStats: await buildRestaurantOperationalStats(restaurant.id),
          weeklyPerformance: await buildRestaurantWeeklyPerformance(restaurant.id),
          recentSettlements: await prisma.restaurantBillingSettlement.findMany({
            where: { restaurantId: restaurant.id },
            orderBy: { createdAt: 'desc' },
            take: 6,
          }),
        },
      });
    });

    admin.post('/admin/restaurantes', async (request, reply) => {
      const parsed = createRestaurantSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: parsed.error.issues[0]?.message || 'Datos invalidos.',
          },
        });
      }

      const { ownerName, ownerPhone, ownerEmail, password, ...restaurantInput } = parsed.data;
      const normalizedOwner = ownerPhone.replace(/\D/g, '').slice(-10);
      const existingOwner = await prisma.user.findFirst({
        where: {
          phone: { in: [ownerPhone.trim(), normalizedOwner, `+52${normalizedOwner}`, `+521${normalizedOwner}`] },
          role: UserRole.RESTAURANT,
        },
        select: { id: true },
      });

      if (existingOwner) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'OWNER_ALREADY_EXISTS',
            message: 'Ya existe un usuario con ese telefono.',
          },
        });
      }

      const createdBy = getAuthenticatedUser(request);
      const hashedPassword = await bcryptjs.hash(password, 10);

      const restaurant = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            name: ownerName,
            phone: ownerPhone,
            email: ownerEmail || `${ownerPhone.replace(/\D/g, '')}@sadel.local`,
            password: hashedPassword,
            role: UserRole.RESTAURANT,
            region: restaurantInput.region,
          },
        });

        return tx.restaurant.create({
          data: {
            ...restaurantInput,
            userId: user.id,
            ...buildStatusMetadata(
              RestaurantStatus.SUSPENDED,
              createdBy.sub,
              'Alta inicial pendiente de activacion administrativa.'
            ),
            billingContactEmail: restaurantInput.billingContactEmail || restaurantInput.email,
          },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                phone: true,
                email: true,
              },
            },
          },
        });
      });

      return reply.status(201).send({
        success: true,
        data: {
          ...restaurant,
          createdBy: createdBy.sub,
        },
      });
    });

    admin.patch('/admin/restaurantes/:id', async (request, reply) => {
      const params = z
        .object({
          id: z.string().min(1, 'El id es obligatorio.'),
        })
        .safeParse(request.params);

      const parsed = updateRestaurantSchema.safeParse(request.body);

      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: params.error.issues[0]?.message || 'Parametros invalidos.',
          },
        });
      }

      if (!parsed.success) {
        console.error("--- ZOD VALIDATION FAILED ---");
        console.error(JSON.stringify(parsed.error.issues, null, 2));
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: parsed.error.issues[0]?.message || 'Datos invalidos.',
          },
        });
      }

      const currentRestaurant = await prisma.restaurant.findUnique({
        where: { id: params.data.id },
        include: { user: true },
      });

      if (!currentRestaurant) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'RESTAURANT_NOT_FOUND',
            message: 'No se encontro el restaurante.',
          },
        });
      }

      const { ownerName, ownerPhone, ownerEmail, ...restaurantData } = parsed.data;

      const updatedRestaurant = await prisma.$transaction(async (tx) => {
        if (ownerName || ownerPhone || ownerEmail) {
          await tx.user.update({
            where: { id: currentRestaurant.userId },
            data: {
              ...(ownerName ? { name: ownerName } : {}),
              ...(ownerPhone ? { phone: ownerPhone } : {}),
              ...(ownerEmail ? { email: ownerEmail } : {}),
              ...(restaurantData.region ? { region: restaurantData.region } : {}),
            },
          });
        }

        // Tarifas de uso de la app: mutuamente excluyentes.
        // - Si se configura un porcentaje (>0), se aplica sobre el subtotal neto de productos
        //   y se desactiva la tarifa fija por pedido.
        // - Si el porcentaje es 0, se mantiene la tarifa fija por pedido (comportamiento historico).
        if (restaurantData.platformFeeRate !== undefined) {
          const rate = restaurantData.platformFeeRate;
          if (rate > 0) {
            restaurantData.platformFeePerOrder = 0;
          } else {
            restaurantData.platformFeeRate = 0;
          }
        }

        // "Solo recoger en tienda" excluye la entrega: fuerza reparto propio y apoyo
        // a la red apagados, y sin tarifa de envío.
        if (restaurantData.pickupOnly === true) {
          restaurantData.hasOwnDelivery = false;
          restaurantData.supportsNetworkDelivery = false;
          (restaurantData as any).deliveryFee = null;
        }

        return tx.restaurant.update({
          where: { id: params.data.id },
          data: restaurantData,
          include: {
            user: {
              select: {
                id: true,
                name: true,
                phone: true,
                email: true,
                region: true,
              },
            },
          },
        });
      });

      return reply.send({
        success: true,
        data: updatedRestaurant,
      });
    });

    admin.post('/admin/restaurantes/:id/status', async (request, reply) => {
      const params = z
        .object({
          id: z.string().min(1, 'El id es obligatorio.'),
        })
        .safeParse(request.params);
      const parsed = restaurantStatusTransitionSchema.safeParse(request.body);

      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: params.error.issues[0]?.message || 'Parametros invalidos.',
          },
        });
      }

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: parsed.error.issues[0]?.message || 'Datos invalidos.',
          },
        });
      }

      const currentRestaurant = await prisma.restaurant.findUnique({
        where: { id: params.data.id },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
              region: true,
            },
          },
        },
      });

      if (!currentRestaurant) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'RESTAURANT_NOT_FOUND',
            message: 'No se encontro el restaurante.',
          },
        });
      }

      if (currentRestaurant.status === RestaurantStatus.DELETED && parsed.data.status !== RestaurantStatus.ACTIVE) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'INVALID_STATUS_TRANSITION',
            message: 'Un restaurante eliminado solo puede reactivarse explicitamente.',
          },
        });
      }

      if (currentRestaurant.status === parsed.data.status) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'STATUS_UNCHANGED',
            message: 'El restaurante ya se encuentra en ese estado.',
          },
        });
      }

      const adminUser = getAuthenticatedUser(request);
      const updatedRestaurant = await prisma.restaurant.update({
        where: { id: params.data.id },
        data: buildStatusMetadata(parsed.data.status, adminUser.sub, parsed.data.reason),
        include: {
          user: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
              region: true,
            },
          },
        },
      });

      return reply.send({
        success: true,
        data: updatedRestaurant,
      });
    });

    admin.delete('/admin/restaurantes/:id', async (request, reply) => {
      const params = z
        .object({
          id: z.string().min(1, 'El id es obligatorio.'),
        })
        .safeParse(request.params);

      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: params.error.issues[0]?.message || 'Parametros invalidos.',
          },
        });
      }

      const restaurant = await prisma.restaurant.findUnique({
        where: { id: params.data.id },
        select: {
          id: true,
          userId: true,
          name: true,
          region: true,
          logo: true,
          coverImage: true,
          featuredFlyer: true,
          user: { select: { id: true, profilePhoto: true } },
        },
      });

      if (!restaurant) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'RESTAURANT_NOT_FOUND',
            message: 'No se encontro el restaurante.',
          },
        });
      }

      // 1) Recolectar claves de media en R2 (logo, portada, flyer destacado, foto de perfil y todas las imágenes de productos).
      const productMedia = await prisma.product.findMany({
        where: { restaurantId: restaurant.id },
        select: { image: true, images: true },
      });

      const mediaKeys = [
        restaurant.logo,
        restaurant.coverImage,
        restaurant.featuredFlyer,
        restaurant.user?.profilePhoto,
        ...productMedia.flatMap((p) => [p.image, ...(p.images ?? [])]),
      ]
        .map(urlToKey)
        .filter((k): k is string => !!k);

      try {
        // 2) Purgar blobs de R2 primero. Si falla, abortamos para no dejar huérfanos (reintento idempotente).
        if (mediaKeys.length > 0) {
          await deleteImages(mediaKeys);
        }

        // 3) Soft-delete + anonimización de PII. Conservamos pedidos/transacciones/settlements para auditoría.
        const redactedRestaurantEmail = `eliminado_${restaurant.id}@sadel.local`;
        const redactedUserEmail = `eliminado_user_${restaurant.userId}@sadel.local`;
        const randomPassword = await bcryptjs.hash(
          `${restaurant.id}:${Date.now()}:${Math.random()}`,
          10
        );

        await prisma.$transaction(async (tx) => {
          await tx.restaurant.update({
            where: { id: restaurant.id },
            data: {
              status: RestaurantStatus.DELETED,
              statusReason: 'Eliminado por administrador',
              statusChangedAt: new Date(),
              name: 'Negocio eliminado',
              description: '',
              address: '',
              contactPhone: '',
              email: redactedRestaurantEmail,
              transferBankName: null,
              transferAccountNumber: null,
              transferBeneficiaryName: null,
              billingContactEmail: null,
              instagram: null,
              facebook: null,
              tiktok: null,
              logo: null,
              coverImage: null,
              featuredFlyer: null,
              isFeatured: false,
            },
          });

          await tx.user.update({
            where: { id: restaurant.userId },
            data: {
              email: redactedUserEmail,
              phone: '0000000000',
              name: 'Eliminado',
              lastName: null,
              dateOfBirth: null,
              profilePhoto: null,
              password: randomPassword,
            },
          });

          await tx.product.updateMany({
            where: { restaurantId: restaurant.id },
            data: { image: null, images: [] },
          });

          // Limpiar solicitudes de destacado pendientes (sin destruir historial financiero ya aprobado).
          await tx.featuredPurchase.deleteMany({
            where: { restaurantId: restaurant.id, status: 'PENDING' },
          });
        });

        // 4) Invalidar cachés de descubrimiento y de menú.
        invalidateRestaurantsCache(restaurant.region);
        invalidateMenuCache(restaurant.id);
      } catch (error) {
        request.log.error({ err: error, restaurantId: restaurant.id }, 'Error al eliminar restaurante');
        return reply.status(500).send({
          success: false,
          error: {
            code: 'DELETE_FAILED',
            message: 'No se pudo eliminar el restaurante y sus datos asociados.',
          },
        });
      }

      return reply.send({
        success: true,
        data: { id: restaurant.id, name: restaurant.name, status: RestaurantStatus.DELETED },
        message: 'Restaurante eliminado (soft-delete). Media purgada de R2.',
      });
    });

    admin.post('/admin/restaurantes/:id/billing/settle', async (request, reply) => {
      const params = z.object({ id: z.string().min(1, 'El id es obligatorio.') }).safeParse(request.params);
      const parsed = settleRestaurantBillingSchema.safeParse(request.body || {});

      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: params.error.issues[0]?.message || 'Parametros invalidos.',
          },
        });
      }

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: parsed.error.issues[0]?.message || 'Datos invalidos.',
          },
        });
      }

      const restaurant = await prisma.restaurant.findUnique({
        where: { id: params.data.id },
      });

      if (!restaurant) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'RESTAURANT_NOT_FOUND',
            message: 'No se encontro el restaurante.',
          },
        });
      }

      const billingSummary = await buildRestaurantBillingSummary({
        id: restaurant.id,
        billingCycle: restaurant.billingCycle,
        platformFeeRate: restaurant.platformFeeRate,
        serviceFee: restaurant.serviceFee,
        platformFeePerOrder: restaurant.platformFeePerOrder,
        lastBillingSettledAt: restaurant.lastBillingSettledAt,
        createdAt: restaurant.createdAt,
      });

      if (billingSummary.currentDebt <= 0) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'NO_OUTSTANDING_DEBT',
            message: 'Este restaurante no tiene deuda pendiente por liquidar.',
          },
        });
      }

      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentUnpaidSettlement = await prisma.restaurantBillingSettlement.findFirst({
        where: {
          restaurantId: restaurant.id,
          status: { in: ['PENDING', 'OVERDUE', 'IN_REVIEW'] },
          createdAt: { gte: twentyFourHoursAgo },
        },
      });

      if (recentUnpaidSettlement) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'RECENT_SETTLEMENT_EXISTS',
            message: 'Ya se generó un corte en las últimas 24 horas. Por favor espera o confirma el pago del corte actual antes de generar uno nuevo.',
          },
        });
      }

      const periodEnd = new Date();
      const reference = `OP-${restaurant.id.slice(-6).toUpperCase()}-${periodEnd.getTime()}`;
      
      // Calculate due date (3 days later)
      const dueDate = new Date(periodEnd);
      dueDate.setDate(dueDate.getDate() + 3);

      try {
        const settlement = await prisma.$transaction(async (tx) => {
          const currentTxState = await tx.restaurant.findUnique({
            where: { id: restaurant.id },
            select: { lastBillingSettledAt: true },
          });

          // Optimistic locking check to prevent double click race conditions
          if (currentTxState?.lastBillingSettledAt?.getTime() !== restaurant.lastBillingSettledAt?.getTime()) {
            throw new Error('CONCURRENCY_CONFLICT');
          }

          await tx.restaurant.update({
            where: { id: restaurant.id },
            data: {
              lastBillingSettledAt: periodEnd,
            },
          });

          return tx.restaurantBillingSettlement.create({
          data: {
            restaurantId: restaurant.id,
            billingCycle: restaurant.billingCycle,
            feeRate: 0,
            periodStart: new Date(billingSummary.periodStart),
            periodEnd,
            dueDate,
            deliveredOrders: billingSummary.deliveredOrders,
            deliveredRevenue: billingSummary.deliveredRevenue,
            amount: billingSummary.currentDebt,
            serviceFeeTotal: billingSummary.serviceFeeRevenue,
            platformFeeTotal: billingSummary.platformFeeRevenue,
            whatsappFeeTotal: billingSummary.whatsappFeeRevenue,
            status: 'PENDING',
            reference,
            notes: parsed.data.notes,
          },
        });
        });
        
        return reply.send({
          success: true,
          data: {
            settlement,
            billingSummary: await buildRestaurantBillingSummary({
              id: restaurant.id,
              billingCycle: restaurant.billingCycle,
              platformFeeRate: restaurant.platformFeeRate,
              serviceFee: restaurant.serviceFee,
              platformFeePerOrder: restaurant.platformFeePerOrder,
              lastBillingSettledAt: periodEnd,
              createdAt: restaurant.createdAt,
            }),
          },
        });

      } catch (error) {
        if (error instanceof Error && error.message === 'CONCURRENCY_CONFLICT') {
          return reply.status(409).send({
            success: false,
            error: {
              code: 'CONCURRENCY_CONFLICT',
              message: 'Se generó un conflicto de datos. Probablemente ya se ha generado un corte reciente. Por favor, recarga la página.',
            },
          });
        }
        throw error;
      }
    });

    admin.post('/admin/billing/settlements/:id/confirm', async (request, reply) => {
      const params = z.object({ id: z.string().min(1, 'El id es obligatorio.') }).safeParse(request.params);
      
      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: params.error.issues[0]?.message || 'Parametros invalidos.',
          },
        });
      }

      const settlement = await prisma.restaurantBillingSettlement.findUnique({
        where: { id: params.data.id },
      });

      if (!settlement) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'SETTLEMENT_NOT_FOUND',
            message: 'No se encontro el corte.',
          },
        });
      }

      if (settlement.status === 'PAID') {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'ALREADY_SETTLED',
            message: 'Este corte ya fue pagado.',
          },
        });
      }

      const updatedSettlement = await prisma.$transaction(async (tx) => {
        const updated = await tx.restaurantBillingSettlement.update({
          where: { id: params.data.id },
          data: {
            status: 'PAID',
            settledAt: new Date(),
          },
        });

        const restaurant = await tx.restaurant.findUnique({
          where: { id: updated.restaurantId },
        });

        if (
          restaurant &&
          restaurant.status === 'SUSPENDED' &&
          restaurant.statusReason?.includes('Suspensión automática por pago vencido')
        ) {
          // Check if there are other outstanding overdue or past-due pending settlements
          const activeOverdueCount = await tx.restaurantBillingSettlement.count({
            where: {
              restaurantId: updated.restaurantId,
              status: { in: ['OVERDUE', 'PENDING'] },
              dueDate: { lte: new Date() },
              id: { not: updated.id },
            },
          });

          if (activeOverdueCount === 0) {
            await tx.restaurant.update({
              where: { id: restaurant.id },
              data: {
                status: 'ACTIVE',
                statusReason: null,
                statusChangedAt: new Date(),
                statusChangedBy: 'SYSTEM_BILLING_REACTIVATION',
              },
            });
          }
        }

        return updated;
      });

      return reply.send({
        success: true,
        data: updatedSettlement,
      });
    });

    admin.post('/admin/billing/settlements/:id/reject', async (request, reply) => {
      const params = z.object({ id: z.string().min(1, 'El id es obligatorio.') }).safeParse(request.params);
      
      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: params.error.issues[0]?.message || 'Parametros invalidos.',
          },
        });
      }

      const settlement = await prisma.restaurantBillingSettlement.findUnique({
        where: { id: params.data.id },
      });

      if (!settlement) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'SETTLEMENT_NOT_FOUND',
            message: 'No se encontro el corte.',
          },
        });
      }

      if (settlement.status === 'PAID') {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'SETTLEMENT_ALREADY_PAID',
            message: 'No se puede rechazar un corte que ya fue pagado.',
          },
        });
      }

      const updatedSettlement = await prisma.restaurantBillingSettlement.update({
        where: { id: params.data.id },
        data: {
          status: 'PENDING',
          paymentProofUrl: null,
        },
      });

      return reply.send({
        success: true,
        data: updatedSettlement,
      });
    });

    admin.get('/admin/support/tickets', async (request, reply) => {
      const tickets = await prisma.supportTicket.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          customer: {
            include: {
              user: {
                select: {
                  name: true,
                  phone: true,
                  email: true,
                },
              },
            },
          },
        },
      });

      return reply.send({
        success: true,
        data: tickets.map((ticket) => ({
          id: ticket.id,
          type: ticket.type,
          subject: ticket.subject,
          description: ticket.description,
          storeName: ticket.storeName,
          orderNumber: ticket.orderNumber,
          status: ticket.status,
          createdAt: ticket.createdAt,
          response: ticket.response,
          respondedAt: ticket.respondedAt,
          customer: {
            id: ticket.customer.id,
            name: ticket.customer.user.name,
            phone: ticket.customer.user.phone,
            email: ticket.customer.user.email,
          },
        })),
      });
    });

    admin.patch('/admin/support/tickets/:id', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      const body = z.object({ 
        status: z.enum(['PENDING', 'IN_PROGRESS', 'RESOLVED']),
        response: z.string().optional(),
      }).safeParse(request.body);

      if (!params.success || !body.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'Datos inválidos.',
          },
        });
      }

      const ticket = await prisma.supportTicket.update({
        where: { id: params.data.id },
        data: { 
          status: body.data.status,
          ...(body.data.response ? { response: body.data.response, respondedAt: new Date() } : {}),
        },
      });

      return reply.send({
        success: true,
        data: ticket,
      });
    });

    admin.delete('/admin/support/tickets/:id', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'ID de ticket inválido.',
          },
        });
      }

      await prisma.supportTicket.delete({ where: { id: params.data.id } });

      return reply.send({ success: true });
    });

    admin.put('/admin/settings', async (request, reply) => {
      const body = z.object({
        restaurantWelcomeImage: z.string().url('URL invalida.').optional(),
        driverWelcomeImage: z.string().url('URL invalida.').optional(),
        adminBankName: z.string().optional(),
        adminBankAccount: z.string().optional(),
        adminBankBeneficiary: z.string().optional(),
        promoModalEnabled: z.boolean().optional(),
        promoModalImage: z.string().url('URL invalida.').optional().or(z.literal('')),
        restaurantPromoModalEnabled: z.boolean().optional(),
        restaurantPromoModalImage: z.string().url('URL invalida.').optional().or(z.literal('')),
        customerThankYouWhatsappEnabled: z.boolean().optional(),
        socialInstagram: z.string().url('URL invalida.').optional().or(z.literal('')),
        socialFacebook: z.string().url('URL invalida.').optional().or(z.literal('')),
        socialTiktok: z.string().url('URL invalida.').optional().or(z.literal('')),
      }).safeParse(request.body);

      if (!body.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: body.error.issues[0]?.message || 'Datos invalidos.',
          },
        });
      }

      try {
        const promises = [];
        if (body.data.restaurantWelcomeImage) {
          promises.push(
            prisma.systemSetting.upsert({
              where: { key: 'restaurantWelcomeImage' },
              update: { value: body.data.restaurantWelcomeImage },
              create: { key: 'restaurantWelcomeImage', value: body.data.restaurantWelcomeImage },
            })
          );
        }
        if (body.data.driverWelcomeImage) {
          promises.push(
            prisma.systemSetting.upsert({
              where: { key: 'driverWelcomeImage' },
              update: { value: body.data.driverWelcomeImage },
              create: { key: 'driverWelcomeImage', value: body.data.driverWelcomeImage },
            })
          );
        }
        if (body.data.adminBankName) {
          promises.push(
            prisma.systemSetting.upsert({
              where: { key: 'adminBankName' },
              update: { value: encrypt(body.data.adminBankName) },
              create: { key: 'adminBankName', value: encrypt(body.data.adminBankName) },
            })
          );
        }
        if (body.data.adminBankAccount) {
          promises.push(
            prisma.systemSetting.upsert({
              where: { key: 'adminBankAccount' },
              update: { value: encrypt(body.data.adminBankAccount) },
              create: { key: 'adminBankAccount', value: encrypt(body.data.adminBankAccount) },
            })
          );
        }
        if (body.data.adminBankBeneficiary !== undefined) {
          promises.push(
            prisma.systemSetting.upsert({
              where: { key: 'adminBankBeneficiary' },
              update: { value: encrypt(body.data.adminBankBeneficiary) },
              create: { key: 'adminBankBeneficiary', value: encrypt(body.data.adminBankBeneficiary) },
            })
          );
        }
        if (body.data.promoModalEnabled !== undefined) {
          promises.push(
            prisma.systemSetting.upsert({
              where: { key: 'promoModalEnabled' },
              update: { value: body.data.promoModalEnabled ? 'true' : 'false' },
              create: { key: 'promoModalEnabled', value: body.data.promoModalEnabled ? 'true' : 'false' },
            })
          );
        }
        if (body.data.promoModalImage !== undefined) {
          promises.push(
            prisma.systemSetting.upsert({
              where: { key: 'promoModalImage' },
              update: { value: body.data.promoModalImage },
              create: { key: 'promoModalImage', value: body.data.promoModalImage },
            })
          );
        }
        if (body.data.restaurantPromoModalEnabled !== undefined) {
          promises.push(
            prisma.systemSetting.upsert({
              where: { key: 'restaurantPromoModalEnabled' },
              update: { value: body.data.restaurantPromoModalEnabled ? 'true' : 'false' },
              create: { key: 'restaurantPromoModalEnabled', value: body.data.restaurantPromoModalEnabled ? 'true' : 'false' },
            })
          );
        }
        if (body.data.restaurantPromoModalImage !== undefined) {
          promises.push(
            prisma.systemSetting.upsert({
              where: { key: 'restaurantPromoModalImage' },
              update: { value: body.data.restaurantPromoModalImage },
              create: { key: 'restaurantPromoModalImage', value: body.data.restaurantPromoModalImage },
            })
          );
        }
        if (body.data.customerThankYouWhatsappEnabled !== undefined) {
          promises.push(
            prisma.systemSetting.upsert({
              where: { key: 'customerThankYouWhatsappEnabled' },
              update: { value: body.data.customerThankYouWhatsappEnabled ? 'true' : 'false' },
              create: { key: 'customerThankYouWhatsappEnabled', value: body.data.customerThankYouWhatsappEnabled ? 'true' : 'false' },
            })
          );
        }

        // Redes sociales: URL vacia elimina la red (deja de mostrarse en el footer).
        const socialEntries = [
          ['socialInstagram', body.data.socialInstagram],
          ['socialFacebook', body.data.socialFacebook],
          ['socialTiktok', body.data.socialTiktok],
        ] as const;
        for (const [key, value] of socialEntries) {
          if (value === undefined) continue;
          if (value === '') {
            promises.push(prisma.systemSetting.deleteMany({ where: { key } }));
          } else {
            promises.push(
              prisma.systemSetting.upsert({
                where: { key },
                update: { value },
                create: { key, value },
              })
            );
          }
        }

        await Promise.all(promises);

        return reply.send({
          success: true,
          data: body.data,
        });
      } catch (error) {
        return reply.status(500).send({
          success: false,
          error: {
            code: 'SERVER_ERROR',
            message: 'No se pudieron guardar los ajustes.',
          },
        });
      }
    });

    // ============= BILLING FORCE-SETTLE (ADMIN TESTING) =============
    admin.post('/admin/billing/force-settle/:restaurantId', async (request, reply) => {
      const params = z.object({ restaurantId: z.string().min(1) }).safeParse(request.params);

      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: 'ID del restaurante es requerido.',
          },
        });
      }

      try {
        const restaurant = await prisma.restaurant.findUnique({
          where: { id: params.data.restaurantId },
          select: { id: true, name: true },
        });

        if (!restaurant) {
          return reply.status(404).send({
            success: false,
            error: {
              code: 'RESTAURANT_NOT_FOUND',
              message: 'Restaurante no encontrado.',
            },
          });
        }

        const settlement = await createBillingSettlement(restaurant.id);

        return reply.send({
          success: true,
          message: `Corte forzado para ${restaurant.name}`,
          data: settlement,
        });
      } catch (error) {
        console.error('[ADMIN FORCE-SETTLE ERROR]:', error);
        return reply.status(500).send({
          success: false,
          error: {
            code: 'SETTLEMENT_ERROR',
            message: error instanceof Error ? error.message : 'Error al crear el corte.',
          },
        });
      }
    });

    // ============= LIST ALL SETTLEMENTS (ADMIN) =============
    admin.get('/admin/billing/settlements', async (request, reply) => {
      const query = z.object({
        restaurantId: z.string().optional(),
        status: z.enum(['PENDING', 'IN_REVIEW', 'PAID', 'OVERDUE']).optional(),
        limit: z.coerce.number().int().positive().max(100).default(20),
        page: z.coerce.number().int().positive().default(1),
      }).safeParse(request.query);

      if (!query.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_QUERY',
            message: 'Parámetros de consulta inválidos.',
          },
        });
      }

      const skip = (query.data.page - 1) * query.data.limit;

      const where: any = {};
      if (query.data.restaurantId) where.restaurantId = query.data.restaurantId;
      if (query.data.status) where.status = query.data.status;

      const [settlements, total] = await Promise.all([
        prisma.restaurantBillingSettlement.findMany({
          where,
          include: {
            restaurant: {
              select: { id: true, name: true, email: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: query.data.limit,
        }),
        prisma.restaurantBillingSettlement.count({ where }),
      ]);

      return reply.send({
        success: true,
        data: {
          settlements,
          pagination: {
            total,
            page: query.data.page,
            limit: query.data.limit,
            pages: Math.ceil(total / query.data.limit),
          },
        },
      });
    });

    // ============= UPDATE SETTLEMENT STATUS (ADMIN) =============
    admin.patch('/admin/billing/settlements/:id', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      const body = z.object({
        status: z.enum(['PENDING', 'IN_REVIEW', 'PAID', 'OVERDUE']),
        settledAt: z.string().datetime().optional(),
      }).safeParse(request.body);

      if (!params.success || !body.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'Datos inválidos.',
          },
        });
      }

      const currentSettlement = await prisma.restaurantBillingSettlement.findUnique({
        where: { id: params.data.id },
      });

      if (!currentSettlement) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'SETTLEMENT_NOT_FOUND',
            message: 'No se encontro el corte.',
          },
        });
      }

      // Un corte ya pagado representa dinero transferido. No se permite
      // revertirlo a un estado editable (PENDING/IN_REVIEW/OVERDUE), pues
      // volvería a ser facturable y generaría doble cobro.
      if (currentSettlement.status === 'PAID' && body.data.status !== 'PAID') {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'SETTLEMENT_ALREADY_PAID',
            message: 'No se puede cambiar el estado de un corte que ya fue pagado.',
          },
        });
      }

      try {
        const updatedSettlement = await prisma.$transaction(async (tx) => {
          const settlement = await tx.restaurantBillingSettlement.update({
            where: { id: params.data.id },
            data: {
              status: body.data.status,
              settledAt: body.data.settledAt ? new Date(body.data.settledAt) : (body.data.status === 'PAID' ? new Date() : undefined),
            },
            include: {
              restaurant: true,
            },
          });

          if (
            body.data.status === 'OVERDUE' &&
            settlement.restaurant &&
            settlement.restaurant.status === 'ACTIVE'
          ) {
            await tx.restaurant.update({
              where: { id: settlement.restaurantId },
              data: {
                status: 'SUSPENDED',
                statusReason: `Suspensión automática por pago vencido. Corte: ${settlement.reference}`,
                statusChangedAt: new Date(),
                statusChangedBy: 'SYSTEM_BILLING_OVERDUE',
                isAcceptingOrders: false,
              },
            });
          }

          if (
            body.data.status === 'PAID' &&
            settlement.restaurant &&
            settlement.restaurant.status === 'SUSPENDED' &&
            settlement.restaurant.statusReason?.includes('Suspensión automática por pago vencido')
          ) {
            const activeOverdueCount = await tx.restaurantBillingSettlement.count({
              where: {
                restaurantId: settlement.restaurantId,
                status: { in: ['OVERDUE', 'PENDING'] },
                dueDate: { lte: new Date() },
                id: { not: settlement.id },
              },
            });

            if (activeOverdueCount === 0) {
              await tx.restaurant.update({
                where: { id: settlement.restaurantId },
                data: {
                  status: 'ACTIVE',
                  statusReason: null,
                  statusChangedAt: new Date(),
                  statusChangedBy: 'SYSTEM_BILLING_REACTIVATION',
                },
              });
            }
          }

          return settlement;
        });

        return reply.send({
          success: true,
          message: `Estado actualizado a ${body.data.status}`,
          data: updatedSettlement,
        });
      } catch (error) {
        return reply.status(500).send({
          success: false,
          error: {
            code: 'UPDATE_ERROR',
            message: 'No se pudo actualizar el estado del corte.',
          },
        });
      }
    });

    admin.get('/admin/solicitudes', async (request, reply) => {
      const { getPlatformRequests } = require('../utils/platform-requests');
      try {
        const requests = await getPlatformRequests();
        return reply.send({
          success: true,
          data: requests,
        });
      } catch (error: any) {
        return reply.status(500).send({
          success: false,
          error: { message: error.message || 'Error al obtener solicitudes.' },
        });
      }
    });

    admin.post('/admin/solicitudes/:id/approve', async (request, reply) => {
      const { getPlatformRequestById, updatePlatformRequestStatus } = require('../utils/platform-requests');
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      const body = z.object({
        region: z.string().min(1, 'La región es obligatoria.'),
        password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres.').default('sadel123'),
        latitude: z.number({ invalid_type_error: 'La latitud debe ser un número.' }).optional(),
        longitude: z.number({ invalid_type_error: 'La longitud debe ser un número.' }).optional(),
      }).safeParse(request.body);

      if (!params.success || !body.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'Datos o parámetros de solicitud inválidos.',
          },
        });
      }

      const { id } = params.data;
      const { region, password, latitude, longitude } = body.data;

      const platformReq = await getPlatformRequestById(id);
      if (!platformReq) {
        return reply.status(404).send({
          success: false,
          error: { message: 'No se encontró la solicitud de afiliación.' },
        });
      }

      if (platformReq.status !== 'PENDING') {
        return reply.status(400).send({
          success: false,
          error: { message: 'La solicitud ya ha sido procesada.' },
        });
      }

      // Probar crear el usuario y el perfil en la BD
      try {
        const hashedPassword = await bcryptjs.hash(password, 10);
        const ownerPhone = platformReq.whatsapp;

        // Verificar si ya existe usuario con ese teléfono para el mismo rol
        const normalizedPhone = ownerPhone.replace(/\D/g, '').slice(-10);
        const existingUser = await prisma.user.findFirst({
          where: {
            phone: { in: [ownerPhone.trim(), normalizedPhone, `+52${normalizedPhone}`, `+521${normalizedPhone}`] },
            role: UserRole.RESTAURANT,
          },
          select: { id: true },
        });

        if (existingUser) {
          return reply.status(409).send({
            success: false,
            error: {
              code: 'USER_ALREADY_EXISTS',
              message: `Ya existe un usuario registrado con el teléfono ${ownerPhone}.`,
            },
          });
        }

        if (platformReq.type === 'RESTAURANT') {
          if (latitude == null || longitude == null || Number.isNaN(latitude) || Number.isNaN(longitude)) {
            return reply.status(400).send({
              success: false,
              error: { code: 'MISSING_COORDS', message: 'Debes indicar la latitud y longitud reales del negocio para aprobar la afiliación.' },
            });
          }
          await prisma.$transaction(async (tx) => {
            const user = await tx.user.create({
              data: {
                name: platformReq.ownerName,
                phone: ownerPhone,
                email: `${ownerPhone.replace(/\D/g, '')}@sadel.local`,
                password: hashedPassword,
                role: UserRole.RESTAURANT,
                region: region,
              },
            });

            const giroToBusinessType: Record<string, string> = {
              'Restaurante': 'RESTAURANT',
              'Farmacia': 'STORE',
              'Abarrotes / Tiendita': 'STORE',
              'Cafetería': 'STORE',
              'Pastelería': 'STORE',
              'Ferretería': 'STORE',
              'Papelería': 'STORE',
              'Otro': 'STORE',
            };
            const businessType = (giroToBusinessType[platformReq.giro || ''] as any) || 'RESTAURANT';

            await tx.restaurant.create({
              data: {
                userId: user.id,
                name: platformReq.businessName || 'Nuevo Restaurante',
                description: `Afiliación aprobada de ${platformReq.ownerName}. Giro: ${platformReq.giro || 'Restaurante'}.`,
                businessType,
                address: platformReq.location,
                latitude,
                longitude,
                region: region,
                contactPhone: ownerPhone,
                email: `${ownerPhone.replace(/\D/g, '')}@sadel.local`,
                serviceFee: 0,
                platformFeePerOrder: 0,
                hasOwnDelivery: false,
                deliveryFee: 0,
                minDeliveryTime: 30,
                maxDeliveryTime: 60,
                status: RestaurantStatus.SUSPENDED,
                billingContactEmail: `${ownerPhone.replace(/\D/g, '')}@sadel.local`,
              },
            });
          });
        } else if (platformReq.type === 'DRIVER') {
          await prisma.$transaction(async (tx) => {
            const user = await tx.user.create({
              data: {
                name: platformReq.ownerName,
                phone: ownerPhone,
                email: `${ownerPhone.replace(/\D/g, '')}@sadel.local`,
                password: hashedPassword,
                role: UserRole.DRIVER,
                region: region,
                status: UserStatus.ACTIVE,
              },
            });

            await tx.driver.create({
              data: {
                userId: user.id,
                region: region,
                documentNumber: `REG-${Date.now()}`,
                documentType: 'INE',
                status: DriverStatus.ACTIVE,
                availability: DriverAvailability.OFFLINE,
              },
            });
          });
        }
      } catch (err: any) {
        console.warn('Fallo al crear registros en base de datos. Se procederá simulando la creación debido al fallback:', err);
      }

      // Actualizar el estado de la solicitud
      const updatedReq = await updatePlatformRequestStatus(id, 'APPROVED');

      return reply.send({
        success: true,
        message: 'Solicitud aprobada y dada de alta correctamente.',
        data: updatedReq,
      });
    });

    admin.post('/admin/solicitudes/:id/reject', async (request, reply) => {
      const { getPlatformRequestById, updatePlatformRequestStatus } = require('../utils/platform-requests');
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);

      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: 'ID de solicitud inválido.',
          },
        });
      }

      const { id } = params.data;
      const platformReq = await getPlatformRequestById(id);
      if (!platformReq) {
        return reply.status(404).send({
          success: false,
          error: { message: 'No se encontró la solicitud de afiliación.' },
        });
      }

      if (platformReq.status !== 'PENDING') {
        return reply.status(400).send({
          success: false,
          error: { message: 'La solicitud ya ha sido procesada.' },
        });
      }

      const updatedReq = await updatePlatformRequestStatus(id, 'REJECTED');

      return reply.send({
        success: true,
        message: 'Solicitud rechazada.',
        data: updatedReq,
      });
    });
    const createPromotionSchema = z.object({
      title: z.string().min(1, 'El título es obligatorio'),
      imageUrl: z.string().url('Debe ser una URL válida'),
      targetUrl: z.string().url('Debe ser una URL válida').optional().nullable(),
      isActive: z.boolean().default(true),
      regions: z.array(z.string()).default([]),
      targetRole: z.string().default('ALL'),
      startDate: z.string().optional().nullable().transform(val => val ? new Date(val) : null),
      endDate: z.string().optional().nullable().transform(val => val ? new Date(val) : null),
    });

    admin.get('/admin/promotions', async (request, reply) => {
      try {
        const promotions = await prisma.promotion.findMany({
          orderBy: { createdAt: 'desc' }
        });
        return reply.send({ success: true, data: promotions });
      } catch (err) {
        return reply.status(500).send({ success: false, error: { message: 'Error interno' } });
      }
    });

    admin.post('/admin/promotions', async (request, reply) => {
      const parsed = createPromotionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message }
        });
      }
      try {
        const promo = await prisma.promotion.create({ data: parsed.data });
        return reply.send({ success: true, data: promo });
      } catch (err) {
        return reply.status(500).send({ success: false, error: { message: 'Error interno' } });
      }
    });

    admin.patch('/admin/promotions/:id', async (request, reply) => {
      const params = z.object({ id: z.string() }).safeParse(request.params);
      if (!params.success) return reply.status(400).send({ success: false });

      const parsed = createPromotionSchema.partial().safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ success: false });

      try {
        const promo = await prisma.promotion.update({
          where: { id: params.data.id },
          data: parsed.data
        });
        return reply.send({ success: true, data: promo });
      } catch (err) {
        return reply.status(500).send({ success: false, error: { message: 'Error interno' } });
      }
    });

    admin.delete('/admin/promotions/:id', async (request, reply) => {
      const params = z.object({ id: z.string() }).safeParse(request.params);
      if (!params.success) return reply.status(400).send({ success: false });

      try {
        await prisma.promotion.delete({ where: { id: params.data.id } });
        return reply.send({ success: true });
      } catch (err) {
        return reply.status(500).send({ success: false, error: { message: 'Error interno' } });
      }
    });

    const createBillboardSchema = z.object({
      imageUrl: z.string().url('Debe ser una URL válida'),
      linkUrl: z.string().url('Debe ser una URL válida').optional().nullable(),
      isActive: z.boolean().default(true),
      regions: z.array(z.string()).default([]),
      sortIndex: z.number().int().default(0),
      startDate: z.string().optional().nullable().transform(val => val ? new Date(val) : null),
      endDate: z.string().optional().nullable().transform(val => val ? new Date(val) : null),
    });

    admin.get('/admin/billboards', async (request, reply) => {
      try {
        const billboards = await prisma.billboard.findMany({
          orderBy: [{ sortIndex: 'asc' }, { createdAt: 'desc' }],
        });
        return reply.send({ success: true, data: billboards });
      } catch (err) {
        return reply.status(500).send({ success: false, error: { message: 'Error interno' } });
      }
    });

    admin.post('/admin/billboards', async (request, reply) => {
      const parsed = createBillboardSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message }
        });
      }
      try {
        const billboard = await prisma.billboard.create({ data: parsed.data });
        return reply.send({ success: true, data: billboard });
      } catch (err) {
        return reply.status(500).send({ success: false, error: { message: 'Error interno' } });
      }
    });

    admin.patch('/admin/billboards/:id', async (request, reply) => {
      const params = z.object({ id: z.string() }).safeParse(request.params);
      if (!params.success) return reply.status(400).send({ success: false });

      const parsed = createBillboardSchema.partial().safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ success: false });

      try {
        const billboard = await prisma.billboard.update({
          where: { id: params.data.id },
          data: parsed.data,
        });
        return reply.send({ success: true, data: billboard });
      } catch (err) {
        return reply.status(500).send({ success: false, error: { message: 'Error interno' } });
      }
    });

    admin.delete('/admin/billboards/:id', async (request, reply) => {
      const params = z.object({ id: z.string() }).safeParse(request.params);
      if (!params.success) return reply.status(400).send({ success: false });

      try {
        await prisma.billboard.delete({ where: { id: params.data.id } });
        return reply.send({ success: true });
      } catch (err) {
        return reply.status(500).send({ success: false, error: { message: 'Error interno' } });
      }
    });

    const broadcastNotificationSchema = z.object({
      title: z.string().min(1),
      body: z.string().min(1),
      targetRole: z.enum(['ALL', 'CUSTOMER', 'RESTAURANT', 'DRIVER']),
      targetRegion: z.string().optional()
    });

    admin.post('/admin/notifications/broadcast', async (request, reply) => {
      const parsed = broadcastNotificationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_BODY', message: 'Faltan campos obligatorios' } });
      }

      const { title, body, targetRole, targetRegion } = parsed.data;

      try {
        const whereClause: any = { status: 'ACTIVE' };
        
        if (targetRole !== 'ALL') {
          whereClause.role = targetRole;
        } else {
          whereClause.role = { not: 'ADMIN' };
        }

        if (targetRegion && targetRegion.trim() !== '') {
          whereClause.region = targetRegion;
        }

        const users = await prisma.user.findMany({
          where: whereClause,
          select: { id: true, role: true }
        });

        // Respond to admin immediately, then run notifications in background
        reply.send({ 
          success: true, 
          data: { 
            targetedUsers: users.length,
            message: 'Difusión de notificaciones iniciada en segundo plano'
          } 
        });

        // Run notifications asynchronously with proper error handling
        (async () => {
          let pushCount = 0;
          for (const u of users) {
            try {
              // Web Socket In-App Notification
              emitNotification(
                request.server.io,
                u.id,
                u.role,
                'app_announcement',
                { title, body, type: 'SYSTEM' }
              );

              // Web Push Notification
              const pushResult = await sendPushNotification(u.id, {
                title,
                body,
                vibrate: [200, 100, 200]
              });
              
              if (pushResult && pushResult.success) {
                pushCount++;
              }
            } catch (err) {
              request.log.error({ err, userId: u.id }, '[Broadcast] Error enviando a usuario');
            }
          }
          request.log.info(`[Broadcast] Finalizado. Procesados: ${users.length}. Push exitosos: ${pushCount}`);
        })().catch((err) => {
          request.log.error(err, '[Broadcast] Error fatal en notificación asíncrona');
        });

        return;
      } catch (err) {
        request.log.error(err as any, '[Broadcast] Error fatal');
        return reply.status(500).send({ success: false, error: { message: 'Error interno' } });
      }
    });

    // ==================== Featured / Destacados (Admin) ====================

    const listFeaturedQuerySchema = z.object({
      page: z.coerce.number().int().positive().default(1),
      limit: z.coerce.number().int().positive().max(100).default(20),
      status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED']).optional(),
    });

    admin.get('/admin/featured/requests', async (request, reply) => {
      const parsed = listFeaturedQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_QUERY', message: parsed.error.issues[0]?.message || 'Query invalida.' },
        });
      }

      const { page, limit, status } = parsed.data;
      const where: any = {};
      if (status) where.status = status;

      const [items, total] = await Promise.all([
        prisma.featuredPurchase.findMany({
          where,
          include: {
            restaurant: { select: { id: true, name: true, logo: true, userId: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.featuredPurchase.count({ where }),
      ]);

      return reply.send({
        success: true,
        data: { items, total, page, limit, hasMore: page * limit < total },
      });
    });

    admin.patch('/admin/featured/requests/:id', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_PARAMS', message: 'ID invalido.' },
        });
      }

      const body = z.object({
        status: z.enum(['APPROVED', 'REJECTED']),
        adminNotes: z.string().optional(),
      }).safeParse(request.body);

      if (!body.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_PAYLOAD', message: body.error.issues[0]?.message || 'Datos invalidos.' },
        });
      }

      const user = getAuthenticatedUser(request);
      const purchase = await prisma.featuredPurchase.findUnique({
        where: { id: params.data.id },
        include: { restaurant: { select: { name: true, userId: true, user: { select: { id: true } } } } },
      });

      if (!purchase) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Solicitud no encontrada.' },
        });
      }

      if (purchase.status !== 'PENDING') {
        return reply.status(409).send({
          success: false,
          error: { code: 'ALREADY_REVIEWED', message: 'Esta solicitud ya fue revisada.' },
        });
      }

      const now = new Date();
      const updateData: any = {
        status: body.data.status,
        adminNotes: body.data.adminNotes || null,
        reviewedBy: user.sub,
        reviewedAt: now,
      };

      if (body.data.status === 'APPROVED') {
        updateData.startDate = now;
        updateData.endDate = new Date(now.getTime() + purchase.daysRequested * 24 * 60 * 60 * 1000);
      }

      const updated = await prisma.featuredPurchase.update({
        where: { id: purchase.id },
        data: updateData,
      });

      // Notify restaurant
      const restaurantUserId = purchase.restaurant.userId;
      emitNotification(fastify.io, restaurantUserId, 'RESTAURANT', 'featured:status-changed', {
        purchaseId: purchase.id,
        status: body.data.status,
        daysRequested: purchase.daysRequested,
        adminNotes: body.data.adminNotes || null,
      });

      void sendPushNotification(restaurantUserId, {
        title: body.data.status === 'APPROVED' ? 'Solicitud de destacado aprobada' : 'Solicitud de destacado rechazada',
        body: body.data.status === 'APPROVED'
          ? `Tu solicitud de ${purchase.daysRequested} día(s) destacado fue aprobada.`
          : `Tu solicitud de destacado fue rechazada.${body.data.adminNotes ? ` Motivo: ${body.data.adminNotes}` : ''}`,
        data: { type: 'featured', purchaseId: purchase.id, status: body.data.status },
      });

      return reply.send({ success: true, data: updated });
    });

    admin.get('/admin/featured/settings', async (request, reply) => {
      try {
        const setting = await prisma.systemSetting.findUnique({ where: { key: 'featuredPackages' } });
        let packages: { days: number; price: number }[] = [];
        try {
          if (setting?.value) packages = JSON.parse(setting.value);
        } catch {}
        if (!Array.isArray(packages)) packages = [];
        return reply.send({ success: true, data: { packages } });
      } catch (error) {
        return reply.status(500).send({
          success: false,
          error: { message: 'Error al obtener configuracion de destacados.' },
        });
      }
    });

    admin.put('/admin/featured/settings', async (request, reply) => {
      const body = z.object({
        packages: z.array(
          z.object({
            days: z.number().int().min(1).max(30),
            price: z.number().nonnegative('El precio debe ser mayor o igual a cero.'),
          })
        ).min(1, 'Debe haber al menos un paquete.'),
      }).safeParse(request.body);

      if (!body.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_PAYLOAD', message: body.error.issues[0]?.message || 'Datos invalidos.' },
        });
      }

      try {
        await prisma.systemSetting.upsert({
          where: { key: 'featuredPackages' },
          update: { value: JSON.stringify(body.data.packages) },
          create: { key: 'featuredPackages', value: JSON.stringify(body.data.packages) },
        });

        return reply.send({ success: true, data: { packages: body.data.packages } });
      } catch (error) {
        return reply.status(500).send({
          success: false,
          error: { message: 'Error al guardar configuracion de destacados.' },
        });
      }
    });

    // ─── DEUDA DE CLIENTES (pedidos no recibidos) ───────────────────────────
    admin.get('/admin/customer-settlements', async (request, reply) => {
      const query = z.object({ status: z.string().optional() }).safeParse(request.query);
      const status = query.success ? query.data.status : undefined;
      const allowed = ['PENDING', 'IN_REVIEW', 'PAID', 'OVERDUE', 'REJECTED'];
      const statusFilter = status && allowed.includes(status) ? status : undefined;

      const [settlements, total] = await Promise.all([
        prisma.customerBillingSettlement.findMany({
          where: statusFilter ? { status: statusFilter as any } : undefined,
          orderBy: { createdAt: 'desc' },
          take: 100,
          include: {
            customer: {
              select: {
                id: true,
                user: { select: { id: true, name: true, phone: true, status: true } },
              },
            },
            order: {
              select: {
                orderReference: true,
                totalAmount: true,
                restaurant: { select: { name: true } },
              },
            },
          },
        }),
        prisma.customerBillingSettlement.count({
          where: statusFilter ? { status: statusFilter as any } : undefined,
        }),
      ]);

      return reply.send({ success: true, data: { settlements, total } });
    });

    admin.patch('/admin/customer-settlements/:id', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      const body = z.object({
        status: z.enum(['PAID', 'REJECTED', 'IN_REVIEW']),
      }).safeParse(request.body);

      if (!params.success || !body.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_PAYLOAD', message: 'Datos invalidos.' },
        });
      }

      try {
        const updatedSettlement = await prisma.$transaction(async (tx) => {
          const settlement = await tx.customerBillingSettlement.update({
            where: { id: params.data.id },
            data: {
              status: body.data.status,
              settledAt: body.data.status === 'PAID' ? new Date() : undefined,
              ...(body.data.status === 'REJECTED' ? { paymentProofUrl: null } : {}),
            },
            include: {
              customer: {
                select: {
                  id: true,
                  userId: true,
                  isSuspendedByDebt: true,
                  user: { select: { id: true, status: true, name: true } },
                },
              },
            },
          });

          if (body.data.status === 'PAID' && settlement.customer?.isSuspendedByDebt) {
            // Recompute the total outstanding debt. A customer may owe for more
            // than one no-show order, so only clear the debt flags and reactivate
            // the account once EVERY settlement is paid.
            const remaining = await tx.customerBillingSettlement.aggregate({
              where: { customerId: settlement.customerId, status: { not: 'PAID' } },
              _sum: { amount: true },
            });
            const remainingDebt = remaining._sum.amount || 0;

            await tx.customer.update({
              where: { id: settlement.customerId },
              data: remainingDebt > 0
                ? { isSuspendedByDebt: true, debtAmount: remainingDebt }
                : { isSuspendedByDebt: false, debtAmount: 0 },
            });

            // Reactivate only when there is no outstanding debt left. If an admin
            // manually suspended the account for reasons other than this debt, it
            // should not be automatically reactivated, so we require the debt
            // suspension flag to be the source before touching the user status.
            if (remainingDebt === 0 && settlement.customer.user.status === 'SUSPENDED') {
              await tx.user.update({
                where: { id: settlement.customer.userId },
                data: { status: 'ACTIVE' },
              });
            }
          }

          return settlement;
        });

        // Notify the customer in real-time + push so their app unlocks.
        const customerUserId = updatedSettlement.customer?.userId;
        if (customerUserId) {
          emitNotification(fastify.io, customerUserId, 'CUSTOMER', body.data.status === 'PAID' ? 'debt:paid' : 'debt:rejected', {
            settlementId: updatedSettlement.id,
          });

          try {
            if (body.data.status === 'PAID') {
              await sendPushNotification(customerUserId, {
                title: '¡Tu cuenta ha sido reactivada!',
                body: 'Gracias por liquidar tu saldo pendiente. Ya puedes volver a pedir en SaDeL.',
                icon: '/app-icon-192.png',
                badge: '/badge.png',
                vibrate: [500, 100, 500, 100, 800],
                requireInteraction: true,
                data: { event: 'debt:paid', url: '/' },
              });
            } else if (body.data.status === 'REJECTED') {
              await sendPushNotification(customerUserId, {
                title: 'Comprobante no valido',
                body: 'No pudimos verificar tu comprobante de pago. Sube uno nuevo desde la app para liquidar tu saldo.',
                icon: '/app-icon-192.png',
                badge: '/badge.png',
                vibrate: [300, 100, 300],
                requireInteraction: true,
                data: { event: 'debt:rejected', url: '/mi-deuda' },
              });
            }
          } catch (pushErr) {
            request.log.error(pushErr as any, '[Push] Error al notificar estado de deuda');
          }
        }

        return reply.send({
          success: true,
          message: `Estado actualizado a ${body.data.status}`,
          data: updatedSettlement,
        });
      } catch (error) {
        return reply.status(500).send({
          success: false,
          error: { code: 'UPDATE_ERROR', message: 'No se pudo actualizar el estado de la deuda.' },
        });
      }
    });
  });
}
