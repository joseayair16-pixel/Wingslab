import { Prisma, UserRole } from '@prisma/client';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import bcryptjs from 'bcryptjs';

import { prisma } from '../config/database';
import { authenticate, authorize, getAuthenticatedUser } from '../middleware/auth';
import { isAppError } from '../errors/app-error';
import { encrypt, decrypt } from '../utils/crypto';
import { urlToKey, deleteImages, uploadImage } from '../services/storage.service';
import { isAiImageConfigured, assertAiImageQuota, getAiImageDailyCap, generateFoodImage } from '../services/ai-image.service';
import { invalidateCachePattern } from '../services/cache.service';
import { buildRestaurantInsights } from '../services/restaurant-insights';
import { calendarReportRange } from '../services/report-calendar';
import { RESTAURANT_ID } from '../config/single-restaurant';
import { audienceCount, cancelCampaign, createCampaign, duplicateCampaign, getLoyaltyConfiguration, listCampaigns, prepareCampaign, saveLoyaltyConfiguration, updateCampaign } from '../services/restaurant-marketing.service';
import { previewInPerson, quoteInPerson, recentVisits, registerInPerson, voidInPerson } from '../services/loyalty-inperson.service';

const restaurantProfileSchema = z.object({
  name: z.string().min(3, 'El nombre es obligatorio.').optional(),
  description: z.string().min(10, 'La descripcion es obligatoria.').optional(),
  seoTitle: z.string().trim().max(65, 'El título SEO no debe superar 65 caracteres.').nullable().optional(),
  seoDescription: z.string().trim().max(160, 'La descripción SEO no debe superar 160 caracteres.').nullable().optional(),
  address: z.string().min(5, 'La direccion es obligatoria.').optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  region: z.string().min(1, 'La region es obligatoria.').optional(),
  logo: z.string().url('El logo debe ser una URL valida.').nullable().optional(),
  coverImage: z.string().url('La portada debe ser una URL valida.').nullable().optional(),
  featuredFlyer: z.string().url('El flyer debe ser una URL valida.').nullable().optional(),
  hasOwnDelivery: z.boolean().optional(),
  supportsNetworkDelivery: z.boolean().optional(),
  pickupOnly: z.boolean().optional(),
  autoOpenEnabled: z.boolean().optional(),
  deliveryFee: z.number().nonnegative().nullable().optional(),
  deliveryRadius: z.number().nonnegative().optional(),
  deliveryPricingModel: z.enum(['fixed', 'distance']).optional(),
  deliveryBaseRate: z.number().nonnegative().optional(),
  deliveryPerKmRate: z.number().nonnegative().optional(),
  deliveryMinFee: z.number().nonnegative().optional(),
  deliveryMaxFee: z.number().nonnegative().optional(),
  maxCashOrder: z.number().positive().optional(),
  acceptsCash: z.boolean().optional(),
  minDeliveryTime: z.number().int().positive().optional(),
  maxDeliveryTime: z.number().int().positive().optional(),
  contactPhone: z.string().min(8, 'El telefono de contacto es obligatorio.').optional(),
  email: z.string().email('El correo es invalido.').optional(),
  transferBankName: z.string().min(2, 'El banco es obligatorio.').nullable().optional(),
  transferAccountNumber: z.string().min(4, 'La cuenta o tarjeta es obligatoria.').nullable().optional(),
  transferBeneficiaryName: z.string().min(3, 'El beneficiario es obligatorio.').nullable().optional(),
  storeCategories: z.array(z.string()).optional(),
  enableTicketPrinting: z.boolean().optional(),
  whatsappNotifications: z.boolean().optional(),
  instagram: z.string().nullable().optional(),
  facebook: z.string().nullable().optional(),
  tiktok: z.string().nullable().optional(),
  promoFreeDeliveryThreshold: z.number().nonnegative().nullable().optional(),
  promoMinOrderAmount: z.number().nonnegative().nullable().optional(),
  promoMinOrderPercent: z.number().min(0).max(100).nullable().optional(),
});

const MAX_SHIFTS_PER_DAY = 2;

const generateImageSchema = z.object({
  name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres.').max(80, 'El nombre es demasiado largo.'),
  description: z.string().max(300, 'La descripcion es demasiado larga.').optional().or(z.literal('')),
  category: z.string().max(100, 'La categoria es demasiado larga.').optional(),
});

const operatingHoursSchema = z
  .array(
    z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      shiftIndex: z.number().int().min(0).max(MAX_SHIFTS_PER_DAY - 1),
      openTime: z.string().regex(/^\d{2}:\d{2}$/, 'La hora de apertura debe ser HH:mm.'),
      closeTime: z.string().regex(/^\d{2}:\d{2}$/, 'La hora de cierre debe ser HH:mm.'),
      isClosed: z.boolean().default(false),
    })
  )
  .min(1, 'Debes enviar al menos un horario.')
  .superRefine((items, ctx) => {
    const pairs = new Set<string>();
    const countsByDay = new Map<number, number>();

    for (const item of items) {
      countsByDay.set(item.dayOfWeek, (countsByDay.get(item.dayOfWeek) || 0) + 1);

      const pair = `${item.dayOfWeek}:${item.shiftIndex}`;
      if (pairs.has(pair)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'No puedes repetir el mismo dia y turno en los horarios.' });
      }
      pairs.add(pair);

      if (!item.isClosed && item.openTime === item.closeTime) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'La hora de apertura no puede ser igual a la de cierre en un dia abierto.' });
      }
    }

    for (const [, count] of countsByDay) {
      if (count > MAX_SHIFTS_PER_DAY) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `No puedes configurar mas de ${MAX_SHIFTS_PER_DAY} turnos para el mismo dia.` });
      }
    }
  });

const categorySchema = z.object({
  name: z.string().min(2, 'El nombre es obligatorio.'),
  description: z.string().max(300, 'La descripcion es demasiado larga.').nullable().optional(),
  icon: z.string().max(120).nullable().optional(),
  order: z.number().int().min(0).default(0),
});

const optionSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'El nombre de la opcion es obligatorio.'),
  price: z.number().nonnegative('El precio debe ser mayor o igual a cero.'),
  isAvailable: z.boolean().default(true),
});

const optionGroupSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'El nombre del grupo es obligatorio.'),
  minSelection: z.number().int().nonnegative().default(0),
  maxSelection: z.number().int().positive('La seleccion maxima debe ser mayor a cero.'),
  options: z.array(optionSchema).min(1, 'Debes incluir al menos una opcion en el grupo.'),
});

const productSchemaBase = z.object({
  categoryId: z.string().min(1, 'La categoria es obligatoria.'),
  name: z.string().min(2, 'El nombre es obligatorio.'),
  description: z.string().min(5, 'La descripcion es obligatoria.'),
  price: z.number().positive('El precio debe ser mayor a cero.'),
  discountPrice: z.number().positive().nullable().optional(),
  promoType: z.enum(['MULTI_BUY']).nullable().optional(),
  promoBuyQuantity: z.number().int().positive().nullable().optional(),
  promoPayQuantity: z.number().int().positive().nullable().optional(),
  sellBy: z.enum(['UNIT', 'WEIGHT']).optional(),
  unitPrice: z.number().positive('El precio por kg debe ser mayor a cero.').nullable().optional(),
  minWeightG: z.number().int().positive().nullable().optional(),
  maxWeightG: z.number().int().positive().nullable().optional(),
  stepWeightG: z.number().int().positive().nullable().optional(),
  weightPresets: z.array(z.number().int().positive()).nullable().optional(),
  image: z.string().url().nullable().optional(),
  images: z.array(z.string().url()).optional(),
  imagePosition: z.string().nullable().optional(),
  imageZoom: z.number().int().min(30).max(300).nullable().optional(),
  isAvailable: z.boolean().optional(),
  isAdultOnly: z.boolean().optional().default(false),
  trackStock: z.boolean().optional().default(false),
  stock: z.number().int().min(0).optional(),
  lowStockThreshold: z.number().int().min(0).optional(),
  calories: z.number().int().positive().nullable().optional(),
  allergens: z.array(z.string()).default([]),
  optionGroups: z.array(optionGroupSchema).optional(),
});

function refineProductConsistency(data: {
  price?: number;
  discountPrice?: number | null;
  promoType?: 'MULTI_BUY' | null;
  promoBuyQuantity?: number | null;
  promoPayQuantity?: number | null;
  optionGroups?: Array<{ name: string; minSelection: number; maxSelection: number; options: unknown[] }>;
}, ctx: z.RefinementCtx) {
  for (const group of data.optionGroups || []) {
    if (group.minSelection > group.maxSelection || group.maxSelection > group.options.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['optionGroups'], message: `Los límites del grupo "${group.name}" no coinciden con sus opciones.` });
    }
  }
  if (data.discountPrice != null && data.price != null && data.discountPrice >= data.price) {
    ctx.addIssue({
      code: 'custom',
      path: ['discountPrice'],
      message: 'El precio especial debe ser menor al precio normal para que el descuento sea valido.',
    });
  }
  if (
    data.promoType === 'MULTI_BUY' &&
    data.promoBuyQuantity != null &&
    data.promoPayQuantity != null &&
    data.promoPayQuantity >= data.promoBuyQuantity
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['promoPayQuantity'],
      message: 'La promocion no es valida: la cantidad a pagar debe ser menor a la cantidad a comprar (ej. comprar 2, pagar 1).',
    });
  }
}

const productSchema = productSchemaBase.superRefine(refineProductConsistency);
const productPatchSchema = productSchemaBase.partial().superRefine(refineProductConsistency);

const productAvailabilitySchema = z.object({
  isAvailable: z.boolean(),
});

const promoCodeSchemaBase = z.object({
  code: z
    .string()
    .min(2, 'El codigo debe tener al menos 2 caracteres.')
    .max(30, 'El codigo no puede exceder 30 caracteres.')
    .trim()
    .transform((v) => v.toUpperCase()),
  description: z.string().max(140).nullish(),
  type: z.enum(['PERCENT', 'AMOUNT', 'FREE_DELIVERY', 'FREE_PRODUCT']),
  value: z.number().positive('El valor debe ser mayor a cero.'),
  giftProductId: z.string().min(1).nullable().optional(),
  minOrderAmount: z.number().nonnegative().nullable().optional(),
  validFrom: z.string().datetime().nullish().transform((v) => (v ? new Date(v) : undefined)),
  validUntil: z.string().datetime().nullish().transform((v) => (v ? new Date(v) : undefined)),
  maxUses: z.number().int().positive().nullable().optional(),
  maxUsesPerCustomer: z.number().int().positive().max(1000000).nullable().optional(),
  firstPurchaseOnly: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

function refinePromoCodeConsistency(data: {
  type?: 'PERCENT' | 'AMOUNT' | 'FREE_DELIVERY' | 'FREE_PRODUCT';
  value?: number;
  giftProductId?: string | null;
  minOrderAmount?: number | null;
  validFrom?: Date | undefined;
  validUntil?: Date | undefined;
}, ctx: z.RefinementCtx) {
  if (data.type === 'PERCENT' && data.value != null && data.value > 100) {
    ctx.addIssue({
      code: 'custom',
      path: ['value'],
      message: 'El porcentaje no puede superar 100.',
    });
  }
  if (data.type === 'AMOUNT' && data.minOrderAmount != null && data.value != null && data.value > data.minOrderAmount) {
    ctx.addIssue({
      code: 'custom',
      path: ['value'],
      message: 'El monto del cupon no puede ser mayor a la compra minima.',
    });
  }
  if (data.type === 'FREE_PRODUCT' && !data.giftProductId) {
    ctx.addIssue({
      code: 'custom',
      path: ['giftProductId'],
      message: 'Selecciona el producto que se regalará.',
    });
  }
  if (data.validFrom && data.validUntil && data.validUntil <= data.validFrom) {
    ctx.addIssue({
      code: 'custom',
      path: ['validUntil'],
      message: 'La fecha de vencimiento debe ser posterior a la fecha de inicio.',
    });
  }
}

const promoCodeSchema = promoCodeSchemaBase.superRefine(refinePromoCodeConsistency);
const promoCodePatchSchema = promoCodeSchemaBase.partial().superRefine(refinePromoCodeConsistency);

const operationalStatusSchema = z.object({
  isAcceptingOrders: z.boolean(),
  isPaused: z.boolean().optional(),
});

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(6, 'La contraseña actual debe tener al menos 6 caracteres.'),
    newPassword: z.string().min(6, 'La nueva contraseña debe tener al menos 6 caracteres.'),
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'La nueva contraseña debe ser diferente a la actual.',
    path: ['newPassword'],
  });

function isPasswordHash(password: string): boolean {
  return /^\$2[aby]\$\d{2}\$/.test(password);
}


async function getOwnedRestaurant(userId: string) {
  const restaurant = await prisma.restaurant.findUnique({
    where: { userId },
  });
  return restaurant;
}

export async function requireRestaurantOperable(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // Un restaurante suspendido (por deuda o por admin) puede consultar su cuenta
  // (lecturas) y realizar las mutaciones de cuenta/pago (cambiar contraseña y
  // subir comprobante de liquidacion), pero NO operar el negocio. Este guard
  // bloquea todas las mutaciones (POST/PATCH/PUT/DELETE) salvo esas dos.
  const method = request.method;
  if (method !== 'POST' && method !== 'PATCH' && method !== 'PUT' && method !== 'DELETE') {
    return;
  }

  const routerPath = request.routeOptions?.url ?? request.url;
  if (routerPath.endsWith('/password')) return;
  if (routerPath.endsWith('/comprobante')) return;

  const user = getAuthenticatedUser(request);
  const ownedRestaurant = await prisma.restaurant.findUnique({
    where: { userId: user.sub },
    select: { status: true, statusReason: true },
  });

  if (!ownedRestaurant) {
    return reply.status(404).send({
      success: false,
      error: {
        code: 'RESTAURANT_NOT_FOUND',
        message: 'No se encontro el restaurante asociado a este usuario.',
      },
    });
  }

  if (ownedRestaurant.status !== 'ACTIVE') {
    return reply.status(409).send({
      success: false,
      error: {
        code: 'RESTAURANT_STATUS_BLOCKED',
        message:
          ownedRestaurant.statusReason ||
          'Este restaurante no puede operar porque su estado administrativo no es activo.',
      },
    });
  }
}

function parseBody<T>(result: z.SafeParseReturnType<unknown, T>) {
  if (result.success) {
    return { data: result.data };
  }

  return {
    error: {
      success: false,
      error: {
        code: 'INVALID_PAYLOAD',
        message: result.error.issues[0]?.message || 'Datos invalidos.',
      },
    },
  };
}

export async function registerRestaurantPanelRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.register(async function restaurantScope(restaurant) {
    restaurant.addHook('preHandler', authenticate);
    restaurant.addHook('preHandler', authorize([UserRole.RESTAURANT]));
    restaurant.addHook('preHandler', requireRestaurantOperable);

    restaurant.get('/restaurant-panel/reportes', async (request, reply) => {
      const parsed = z.object({ days: z.coerce.number().int().refine(n => [1, 7, 30, 90].includes(n)).default(30), period: z.enum(['today']).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), weekOffset: z.coerce.number().int().min(0).max(6).optional() }).refine(v => !(v.date && v.weekOffset !== undefined)).safeParse(request.query);
      if (!parsed.success) return reply.status(400).send({ success: false, error: { code: 'INVALID_PERIOD', message: 'Elige un periodo de 1, 7, 30 o 90 días.' } });
      const now = new Date();
      let from: Date;
      let to = now;
      try {
        if (parsed.data.date || parsed.data.weekOffset !== undefined) {
          const range = calendarReportRange(now, parsed.data.date, parsed.data.weekOffset);
          from = range.from;
          to = range.to;
        } else if (parsed.data.period === 'today') {
          const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
          from = calendarReportRange(now, localDate).from;
        } else from = new Date(now.getTime() - parsed.data.days * 86400000);
      } catch { return reply.status(400).send({ success: false, error: { code: 'INVALID_PERIOD', message: 'Fecha no válida.' } }); }
      const rows = await prisma.order.findMany({
        where: { restaurantId: RESTAURANT_ID, createdAt: { gte: from, lt: to } },
        select: { id: true, customerId: true, status: true, totalAmount: true, createdAt: true, preparationStartedAt: true,
          inTransitAt: true, deliveredAt: true, promoCode: true, promoDiscountAmount: true,
          items: { select: { quantity: true, subtotal: true, product: { select: { id: true, name: true } } } } },
        orderBy: { createdAt: 'desc' },
      });
      const buyerIds = [...new Set(rows.filter(order => ['DELIVERED', 'COMPLETED', 'PICKED_UP'].includes(order.status)).map(order => order.customerId))];
      const history = buyerIds.length ? await prisma.order.groupBy({
        by: ['customerId'], where: { restaurantId: RESTAURANT_ID, customerId: { in: buyerIds }, status: { in: ['DELIVERED', 'COMPLETED', 'PICKED_UP'] } },
        _count: { _all: true },
      }) : [];
      const lifetimeOrderCounts = Object.fromEntries(history.map(row => [row.customerId, row._count._all]));
      return reply.send({ success: true, data: buildRestaurantInsights(rows as any, parsed.data.date ? 1 : parsed.data.weekOffset !== undefined ? 7 : parsed.data.days, to, lifetimeOrderCounts, from) });
    });

    restaurant.get('/restaurant-panel/clientes', async (request, reply) => {
      const parsed = z.object({ search: z.string().trim().max(80).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }).safeParse(request.query);
      if (!parsed.success) return reply.status(400).send({ success: false, error: { code: 'INVALID_QUERY', message: 'Consulta de clientes no válida.' } });
      const customers = await prisma.customer.findMany({ where: { orders: { some: { restaurantId: RESTAURANT_ID } },
        ...(parsed.data.search ? { user: { OR: [
          { name: { contains: parsed.data.search, mode: 'insensitive' } },
          { lastName: { contains: parsed.data.search, mode: 'insensitive' } },
        ] } } : {}) },
        select: { id: true, user: { select: { name: true, lastName: true, createdAt: true } },
          orders: { where: { restaurantId: RESTAURANT_ID }, select: { id: true, totalAmount: true, status: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 5 } },
        orderBy: { updatedAt: 'desc' }, take: parsed.data.limit });
      const customerIds = customers.map(customer => customer.id);
      const aggregates = customerIds.length ? await prisma.order.groupBy({
        by: ['customerId'], where: { restaurantId: RESTAURANT_ID, customerId: { in: customerIds }, status: { in: ['DELIVERED', 'COMPLETED', 'PICKED_UP'] } },
        _count: { _all: true }, _sum: { totalAmount: true }, _min: { createdAt: true }, _max: { createdAt: true },
      }) : [];
      const aggregateByCustomer = new Map(aggregates.map(aggregate => [aggregate.customerId, aggregate]));
      const data = customers.map(c => {
        const aggregate = aggregateByCustomer.get(c.id);
        const orderCount = aggregate?._count._all || 0;
        return { id: c.id, name: [c.user.name, c.user.lastName].filter(Boolean).join(' '), joinedAt: c.user.createdAt,
          orderCount, lifetimeValue: Math.round((aggregate?._sum.totalAmount || 0) * 100) / 100,
          firstOrderAt: aggregate?._min.createdAt || null, lastOrderAt: aggregate?._max.createdAt || null,
          customerType: orderCount >= 2 ? 'RECURRENT' : orderCount === 1 ? 'NEW' : 'NO_COMPLETED_ORDERS', recentOrders: c.orders };
      }).filter(c => c.orderCount > 0);
      return reply.send({ success: true, data });
    });

    // Directorio paginado: incluye cuentas registradas sin pedidos. La consulta
    // anterior se conserva para clientes existentes del API.
    restaurant.get('/restaurant-panel/directorio-clientes', async (request, reply) => {
      const parsed = z.object({ search: z.string().trim().max(80).default(''), status: z.enum(['all', 'ACTIVE', 'SUSPENDED', 'INACTIVE']).default('all'), page: z.coerce.number().int().min(1).max(10000).default(1), limit: z.coerce.number().int().min(1).max(50).default(20) }).safeParse(request.query);
      if (!parsed.success) return reply.status(400).send({ success: false, error: { code: 'INVALID_QUERY', message: 'Filtros de clientes no válidos.' } });
      const { search, status, page, limit } = parsed.data;
      const where: Prisma.CustomerWhereInput = { user: { role: 'CUSTOMER', ...(status === 'all' ? {} : { status }), ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { lastName: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }] } : {}) } };
      const [total, customers] = await Promise.all([
        prisma.customer.count({ where }),
        prisma.customer.findMany({ where, select: { id: true, user: { select: { name: true, lastName: true, email: true, phone: true, status: true, createdAt: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit }),
      ]);
      const ids = customers.map(c => c.id);
      const aggregates = ids.length ? await prisma.order.groupBy({ by: ['customerId'], where: { restaurantId: RESTAURANT_ID, customerId: { in: ids }, status: { in: ['DELIVERED', 'COMPLETED', 'PICKED_UP'] } }, _count: { _all: true }, _sum: { totalAmount: true }, _max: { createdAt: true } }) : [];
      const summary = new Map(aggregates.map(row => [row.customerId, row]));
      return reply.send({ success: true, data: { items: customers.map(customer => { const stats = summary.get(customer.id); return { ...customer, orderCount: stats?._count._all ?? 0, totalSpent: stats?._sum.totalAmount ?? 0, lastOrderAt: stats?._max.createdAt ?? null }; }), page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } });
    });

    restaurant.get('/restaurant-panel/directorio-clientes/:id/pedidos', async (request, reply) => {
      const params = z.object({ id: z.string().min(1).max(100) }).safeParse(request.params);
      const query = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), limit: z.coerce.number().int().min(1).max(50).default(10) }).safeParse(request.query);
      if (!params.success || !query.success) return reply.status(400).send({ success: false, error: { code: 'INVALID_QUERY', message: 'Consulta no válida.' } });
      const customer = await prisma.customer.findFirst({ where: { id: params.data.id, user: { role: 'CUSTOMER' } }, select: { id: true } });
      if (!customer) return reply.status(404).send({ success: false, error: { code: 'CUSTOMER_NOT_FOUND', message: 'No se encontró al cliente.' } });
      const where = { customerId: customer.id, restaurantId: RESTAURANT_ID };
      const [total, items] = await Promise.all([prisma.order.count({ where }), prisma.order.findMany({ where, select: { id: true, orderReference: true, dailyCounter: true, status: true, totalAmount: true, createdAt: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.data.page - 1) * query.data.limit, take: query.data.limit })]);
      return reply.send({ success: true, data: { items, total, page: query.data.page, totalPages: Math.max(1, Math.ceil(total / query.data.limit)) } });
    });

    restaurant.post('/restaurant-panel/directorio-clientes/:id/suspender', async (request, reply) => {
      const params = z.object({ id: z.string().min(1).max(100) }).safeParse(request.params);
      const body = z.object({ reason: z.string().trim().min(5).max(500) }).safeParse(request.body);
      if (!params.success || !body.success) return reply.status(400).send({ success: false, error: { code: 'INVALID_PAYLOAD', message: 'Indica un motivo de al menos 5 caracteres.' } });
      const actor = getAuthenticatedUser(request);
      const result = await prisma.$transaction(async tx => {
        const customer = await tx.customer.findFirst({ where: { id: params.data.id, user: { role: 'CUSTOMER' } }, select: { userId: true } });
        if (!customer) return 'not_found';
        const updated = await tx.user.updateMany({ where: { id: customer.userId, role: 'CUSTOMER', status: 'ACTIVE' }, data: { status: 'SUSPENDED' } });
        if (updated.count !== 1) return 'not_active';
        const suspended = await tx.user.findUniqueOrThrow({ where: { id: customer.userId }, select: { updatedAt: true } });
        await tx.auditLog.create({ data: { userId: actor.sub, action: 'CUSTOMER_SUSPENDED_BY_RESTAURANT', entity: 'Customer', entityId: params.data.id, oldValue: JSON.stringify({ status: 'ACTIVE' }), newValue: JSON.stringify({ status: 'SUSPENDED', reason: body.data.reason, updatedAt: suspended.updatedAt.toISOString() }), ipAddress: request.ip } });
        return 'ok';
      });
      if (result === 'not_found') return reply.status(404).send({ success: false, error: { code: 'CUSTOMER_NOT_FOUND', message: 'No se encontró al cliente.' } });
      if (result !== 'ok') return reply.status(409).send({ success: false, error: { code: 'CUSTOMER_NOT_ACTIVE', message: 'La cuenta ya no está activa. Actualiza el directorio.' } });
      return reply.send({ success: true, data: { status: 'SUSPENDED' } });
    });

    restaurant.post('/restaurant-panel/directorio-clientes/:id/reactivar', async (request, reply) => {
      const params = z.object({ id: z.string().min(1).max(100) }).safeParse(request.params);
      if (!params.success) return reply.status(400).send({ success: false, error: { code: 'INVALID_PAYLOAD', message: 'Cliente no válido.' } });
      const actor = getAuthenticatedUser(request);
      const result = await prisma.$transaction(async tx => {
        const customer = await tx.customer.findFirst({ where: { id: params.data.id, user: { role: 'CUSTOMER' } }, select: { userId: true, isSuspendedByDebt: true, user: { select: { status: true, updatedAt: true } } } });
        if (!customer) return 'not_found';
        if (customer.isSuspendedByDebt || customer.user.status !== 'SUSPENDED') return 'blocked';
        const audit = await tx.auditLog.findFirst({ where: { entity: 'Customer', entityId: params.data.id }, select: { action: true, newValue: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
        let recorded: unknown;
        try { recorded = JSON.parse(audit?.newValue || 'null')?.updatedAt; } catch { return 'blocked'; }
        if (audit?.action !== 'CUSTOMER_SUSPENDED_BY_RESTAURANT' || recorded !== customer.user.updatedAt.toISOString()) return 'blocked';
        const updated = await tx.user.updateMany({ where: { id: customer.userId, role: 'CUSTOMER', status: 'SUSPENDED', updatedAt: customer.user.updatedAt, customer: { isSuspendedByDebt: false } }, data: { status: 'ACTIVE' } });
        if (updated.count !== 1) return 'blocked';
        await tx.auditLog.create({ data: { userId: actor.sub, action: 'CUSTOMER_REACTIVATED_BY_RESTAURANT', entity: 'Customer', entityId: params.data.id, oldValue: JSON.stringify({ status: 'SUSPENDED' }), newValue: JSON.stringify({ status: 'ACTIVE' }), ipAddress: request.ip } });
        return 'ok';
      });
      if (result === 'not_found') return reply.status(404).send({ success: false, error: { code: 'CUSTOMER_NOT_FOUND', message: 'No se encontró al cliente.' } });
      if (result !== 'ok') return reply.status(409).send({ success: false, error: { code: 'REACTIVATION_REQUIRES_REVIEW', message: 'No se puede reactivar automáticamente: la suspensión tiene otra causa o la cuenta cambió. Requiere revisión.' } });
      return reply.send({ success: true, data: { status: 'ACTIVE' } });
    });

    const campaignInputBase = z.object({ title: z.string().trim().min(3).max(65), body: z.string().trim().min(3).max(160),
      segment: z.enum(['subscribed', 'new', 'frequent', 'inactive']), targetUrl: z.string().max(200).default('/'),
      promoCode: z.string().trim().max(30).nullable().optional(), scheduledAt: z.string().datetime().nullable().optional() });
    const validateCampaignTarget = (value: any, ctx: z.RefinementCtx) => {
      if (value.targetUrl !== undefined && (!value.targetUrl.startsWith('/') || value.targetUrl.startsWith('//') || value.targetUrl.includes('..') || /[\r\n]/.test(value.targetUrl))) ctx.addIssue({ code: 'custom', path: ['targetUrl'], message: 'El destino debe ser una ruta interna de WingsLab.' });
      if (value.scheduledAt && new Date(value.scheduledAt) <= new Date()) ctx.addIssue({ code: 'custom', path: ['scheduledAt'], message: 'La fecha programada debe ser futura.' });
    };
    const campaignInput = campaignInputBase.superRefine(validateCampaignTarget);
    const campaignPatchInput = campaignInputBase.partial().superRefine(validateCampaignTarget);
    restaurant.get('/restaurant-panel/campanas', async (_request, reply) => reply.send({ success: true, data: await listCampaigns() }));
    restaurant.post('/restaurant-panel/campanas/preview', async (request, reply) => {
      const parsed = z.object({ segment: z.enum(['subscribed', 'new', 'frequent', 'inactive']) }).safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ success: false, error: { code: 'INVALID_SEGMENT', message: 'Segmento no válido.' } });
      return reply.send({ success: true, data: { segment: parsed.data.segment, eligibleRecipients: await audienceCount(parsed.data.segment), pushEnabled: false, metricsAvailable: false } });
    });
    restaurant.post('/restaurant-panel/campanas', async (request, reply) => {
      const parsed = campaignInput.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ success: false, error: { code: 'INVALID_CAMPAIGN', message: parsed.error.issues[0]?.message || 'Campaña no válida.' } });
      try { return reply.status(201).send({ success: true, data: await createCampaign({ ...parsed.data, promoCode: parsed.data.promoCode || null, scheduledAt: parsed.data.scheduledAt || null }) }); }
      catch (error: any) { return reply.status(error.statusCode || 400).send({ success: false, error: { code: error.code || 'CAMPAIGN_SAVE_FAILED', message: error.message } }); }
    });
    restaurant.patch('/restaurant-panel/campanas/:id', async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).safeParse(request.params), parsed = campaignPatchInput.safeParse(request.body);
      if (!params.success || !parsed.success) return reply.status(400).send({ success: false, error: { code: 'INVALID_CAMPAIGN', message: 'Datos de campaña no válidos.' } });
      try { return reply.send({ success: true, data: await updateCampaign(params.data.id, parsed.data as any) }); }
      catch (error: any) { return reply.status(error.statusCode || 400).send({ success: false, error: { code: error.code || 'CAMPAIGN_UPDATE_FAILED', message: error.message } }); }
    });
    restaurant.post('/restaurant-panel/campanas/:id/duplicar', async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).safeParse(request.params); if (!params.success) return reply.status(400).send({ success: false, error: { code: 'INVALID_ID', message: 'Campaña no válida.' } });
      try { return reply.status(201).send({ success: true, data: await duplicateCampaign(params.data.id) }); } catch (error: any) { return reply.status(error.statusCode || 400).send({ success: false, error: { code: error.code || 'CAMPAIGN_DUPLICATE_FAILED', message: error.message } }); }
    });
    restaurant.post('/restaurant-panel/campanas/:id/preparar-envio', async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).safeParse(request.params); if (!params.success) return reply.status(400).send({ success: false, error: { code: 'INVALID_ID', message: 'Campaña no válida.' } });
      try { return reply.status(202).send({ success: true, data: await prepareCampaign(params.data.id), message: 'Guardada para revisión: el proveedor push está deshabilitado y no se envió nada.' }); } catch (error: any) { return reply.status(error.statusCode || 400).send({ success: false, error: { code: error.code || 'CAMPAIGN_PREPARE_FAILED', message: error.message } }); }
    });
    restaurant.post('/restaurant-panel/campanas/:id/cancelar', async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).safeParse(request.params); if (!params.success) return reply.status(400).send({ success: false, error: { code: 'INVALID_ID', message: 'Campaña no válida.' } });
      try { return reply.send({ success: true, data: await cancelCampaign(params.data.id) }); } catch (error: any) { return reply.status(error.statusCode || 400).send({ success: false, error: { code: error.code || 'CAMPAIGN_CANCEL_FAILED', message: error.message } }); }
    });
    restaurant.get('/restaurant-panel/lealtad', async (_request, reply) => { const data = await getLoyaltyConfiguration(); return reply.send({ success: true, data, redemptionsEnabled: data.redemptionReady === true }); });
    restaurant.put('/restaurant-panel/lealtad', async (request, reply) => {
      const parsed = z.object({ enabled: z.boolean(), pointsPer100: z.number().positive().max(100).default(1), rewardPoints: z.number().int().positive().max(100000).default(100), rewardAmount: z.number().positive().max(5000).default(10), stampGoal: z.number().int().min(2).max(30), rewardType: z.enum(['DISCOUNT','PRODUCT','GIFT']).default('DISCOUNT'), rewardKind: z.enum(['AMOUNT','PERCENT','PRODUCT']), rewardValue: z.number().int().positive().max(500000).nullable(), rewardProductId: z.string().min(1).nullable(), rewardDescription: z.string().trim().min(3).max(200), stampTerms: z.string().trim().max(1000).default('') }).refine(value => value.rewardKind === 'PRODUCT' ? !!value.rewardProductId && value.rewardValue === null : value.rewardProductId === null && value.rewardValue !== null && (value.rewardKind !== 'PERCENT' || value.rewardValue <= 100), 'Revisa el valor o producto de la recompensa.').safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ success: false, error: { code: 'INVALID_LOYALTY_RULES', message: 'Reglas de puntos fuera de límites.' } });
      try { return reply.send({ success: true, data: await saveLoyaltyConfiguration(parsed.data), redemptionsEnabled: true }); }
      catch (error: any) { return reply.status(error.statusCode || 500).send({ success: false, error: { code: error.code || 'LOYALTY_SAVE_FAILED', message: error.statusCode ? error.message : 'No se pudieron guardar las reglas. Intenta de nuevo.' } }); }
    });

    restaurant.post('/restaurant-panel/lealtad/verificar', {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    }, async (request, reply) => {
      const parsed = z.object({ code: z.string().trim().min(6).max(32) }).safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ success: false, error: { code: 'INVALID_CODE', message: 'Código no válido.' } });
      try { return reply.send({ success: true, data: await previewInPerson(prisma, parsed.data.code) }); }
      catch (error: any) { return reply.status(error.statusCode || 400).send({ success: false, error: { code: error.code || 'LOYALTY_PREVIEW_FAILED', message: error.message } }); }
    });
    restaurant.get('/restaurant-panel/lealtad/catalogo-local', async (_request, reply) => {
      const products = await prisma.product.findMany({
        where: { restaurantId: RESTAURANT_ID, isAvailable: true, deleted: false, isAdultOnly: false },
        orderBy: [{ category: { order: 'asc' } }, { name: 'asc' }], take: 200,
        select: { id: true, name: true, price: true, discountPrice: true, promoType: true, promoBuyQuantity: true, promoPayQuantity: true,
          sellBy: true, unitPrice: true, minWeightG: true, maxWeightG: true, stepWeightG: true, trackStock: true, stock: true,
          optionGroups: { select: { id: true, name: true, minSelection: true, maxSelection: true,
            options: { select: { id: true, name: true, price: true, isAvailable: true }, orderBy: { name: 'asc' } } } },
          category: { select: { name: true, order: true } } },
      });
      return reply.send({ success: true, data: products });
    });
    const inPersonItem = z.object({ productId: z.string().min(1).max(100), quantity: z.number().int().min(1).max(100), weightG: z.number().int().positive().max(5000).optional(), optionIds: z.array(z.string().min(1).max(100)).max(40).optional() });
    restaurant.post('/restaurant-panel/lealtad/cotizar-local', {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    }, async (request, reply) => {
      const parsed = z.object({ code: z.string().trim().min(6).max(32), items: z.array(inPersonItem).min(1).max(50), applyReward: z.boolean().default(false) }).safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ success: false, error: { code: 'INVALID_SALE', message: 'Revisa los productos de la venta.' } });
      try { return reply.send({ success: true, data: await quoteInPerson(prisma, parsed.data.code, parsed.data.items, parsed.data.applyReward) }); }
      catch (error: any) { return reply.status(error.statusCode || 400).send({ success: false, error: { code: error.code || 'LOYALTY_QUOTE_FAILED', message: error.message } }); }
    });
    restaurant.post('/restaurant-panel/lealtad/registrar', {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    }, async (request, reply) => {
      const parsed = z.object({ code: z.string().trim().min(6).max(32), items: z.array(inPersonItem).min(1).max(50), applyReward: z.boolean().default(false), paymentMethod: z.enum(['CASH','CARD','TRANSFER','OTHER']), note: z.string().trim().max(300).optional() }).safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ success: false, error: { code: 'INVALID_VISIT', message: 'Revisa los productos, el pago y el código.' } });
      const staff = getAuthenticatedUser(request);
      try { return reply.status(201).send({ success: true, data: await registerInPerson(prisma, { ...parsed.data, staffUserId: staff.sub }) }); }
      catch (error: any) { return reply.status(error.statusCode || 400).send({ success: false, error: { code: error.code || 'LOYALTY_VISIT_FAILED', message: error.message } }); }
    });
    restaurant.get('/restaurant-panel/lealtad/visitas', async (request, reply) => {
      const parsed = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) }).safeParse(request.query);
      if (!parsed.success) return reply.status(400).send({ success: false, error: { code: 'INVALID_QUERY', message: 'Consulta no válida.' } });
      return reply.send({ success: true, data: await recentVisits(prisma, parsed.data.limit) });
    });
    restaurant.post('/restaurant-panel/lealtad/visitas/:id/anular', async (request, reply) => {
      const params = z.object({ id: z.string().min(1).max(100) }).safeParse(request.params);
      if (!params.success) return reply.status(400).send({ success: false, error: { code: 'INVALID_ID', message: 'Venta no válida.' } });
      const staff = getAuthenticatedUser(request);
      try { return reply.send({ success: true, data: await voidInPerson(prisma, params.data.id, staff.sub) }); }
      catch (error: any) { return reply.status(error.statusCode || 400).send({ success: false, error: { code: error.code || 'LOYALTY_VOID_FAILED', message: error.message } }); }
    });

    restaurant.get('/restaurant-panel/soporte', async (_request, reply) => {
      // WingsLab is a single-restaurant deployment. APP reports also belong to this restaurant.
      const data = await prisma.supportTicket.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { customer: { select: { user: { select: { name: true } } } } } });
      return reply.send({ success: true, data });
    });
    restaurant.get('/restaurant-panel/soporte/lista', async (request, reply) => {
      const parsed = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), limit: z.coerce.number().int().min(1).max(50).default(10), status: z.enum(['ALL', 'PENDING', 'IN_PROGRESS', 'RESOLVED']).default('ALL'), type: z.enum(['ALL', 'APP', 'ORDER']).default('ALL'), search: z.string().trim().max(100).default('') }).safeParse(request.query);
      if (!parsed.success) return reply.status(400).send({ success: false, error: { code: 'INVALID_QUERY', message: 'Filtros no válidos.' } });
      const { page, limit, status, type, search } = parsed.data;
      const where: Prisma.SupportTicketWhereInput = { ...(status !== 'ALL' ? { status } : {}), ...(type !== 'ALL' ? { type } : {}), ...(search ? { OR: [{ subject: { contains: search, mode: 'insensitive' } }, { description: { contains: search, mode: 'insensitive' } }, { orderNumber: { contains: search, mode: 'insensitive' } }, { customer: { user: { name: { contains: search, mode: 'insensitive' } } } }] } : {}) };
      const [items, total, counts] = await Promise.all([
        prisma.supportTicket.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit, select: { id: true, type: true, subject: true, description: true, orderNumber: true, status: true, response: true, respondedAt: true, createdAt: true, customer: { select: { user: { select: { name: true, lastName: true } } } } } }),
        prisma.supportTicket.count({ where }),
        prisma.supportTicket.groupBy({ by: ['status'], _count: { _all: true } }),
      ]);
      return reply.send({ success: true, data: { items, total, page, limit, counts } });
    });
    restaurant.get('/restaurant-panel/resenas', async (request, reply) => {
      const parsed = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), limit: z.coerce.number().int().min(1).max(50).default(10), rating: z.enum(['ALL', '1', '2', '3', '4', '5']).default('ALL'), search: z.string().trim().max(100).default('') }).safeParse(request.query);
      if (!parsed.success) return reply.status(400).send({ success: false, error: { code: 'INVALID_QUERY', message: 'Filtros no válidos.' } });
      const { page, limit, rating, search } = parsed.data;
      const where: Prisma.ReviewWhereInput = { restaurantId: RESTAURANT_ID, ...(rating !== 'ALL' ? { rating: Number(rating) } : {}), ...(search ? { OR: [{ comment: { contains: search, mode: 'insensitive' } }, { customer: { user: { name: { contains: search, mode: 'insensitive' } } } }, { order: { orderReference: { contains: search, mode: 'insensitive' } } }] } : {}) };
      const [items, total, summary] = await Promise.all([
        prisma.review.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit, select: { id: true, rating: true, comment: true, createdAt: true, customer: { select: { user: { select: { name: true, lastName: true } } } }, order: { select: { id: true, orderReference: true, dailyCounter: true, createdAt: true } } } }),
        prisma.review.count({ where }),
        prisma.review.aggregate({ where: { restaurantId: RESTAURANT_ID }, _avg: { rating: true }, _count: { _all: true } }),
      ]);
      return reply.send({ success: true, data: { items, total, page, limit, summary: { average: summary._avg.rating, total: summary._count._all } } });
    });
    restaurant.patch('/restaurant-panel/soporte/:id', async (request, reply) => {
      const params = z.object({ id: z.string().min(1).max(100) }).safeParse(request.params);
      const parsed = z.object({ status: z.enum(['PENDING','IN_PROGRESS','RESOLVED']), response: z.string().trim().min(1).max(4000) }).safeParse(request.body);
      if (!params.success || !parsed.success) return reply.status(400).send({ success: false, error: { code: 'INVALID_REPORT', message: 'Escribe una respuesta y un estado válido.' } });
      const found = await prisma.supportTicket.findUnique({ where: { id: params.data.id }, select: { id: true } });
      if (!found) return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Reporte no encontrado.' } });
      const data = await prisma.supportTicket.update({ where: { id: found.id }, data: { ...parsed.data, respondedAt: new Date() } });
      return reply.send({ success: true, data });
    });

    restaurant.get('/restaurant-panel/perfil', async (request, reply) => {
      const user = getAuthenticatedUser(request);
      const ownedRestaurant = await prisma.restaurant.findUnique({
        where: { userId: user.sub },
        include: {
          operatingHours: {
            orderBy: { dayOfWeek: 'asc' },
          },
          categories: {
            orderBy: { order: 'asc' },
          },
          storeCategories: {
            include: {
              category: true,
            },
          },
          stats: true,
        },
      });

      if (!ownedRestaurant) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'RESTAURANT_NOT_FOUND',
            message: 'No se encontro el restaurante asociado a este usuario.',
          },
        });
      }


      if (ownedRestaurant) {
        ownedRestaurant.transferAccountNumber = ownedRestaurant.transferAccountNumber 
          ? decrypt(ownedRestaurant.transferAccountNumber) 
          : ownedRestaurant.transferAccountNumber;
      }

      return reply.send({
        success: true,
        data: ownedRestaurant,
      });
    });





    restaurant.patch('/restaurant-panel/perfil', async (request, reply) => {
      const parsed = parseBody(restaurantProfileSchema.safeParse(request.body));

      if ('error' in parsed) {
        return reply.status(400).send(parsed.error);
      }

      const user = getAuthenticatedUser(request);
      const ownedRestaurant = await getOwnedRestaurant(user.sub);

      if (!ownedRestaurant) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'RESTAURANT_NOT_FOUND',
            message: 'No se encontro el restaurante asociado a este usuario.',
          },
        });
      }

      const { storeCategories, ...restData } = parsed.data;

      if (storeCategories !== undefined && storeCategories.length > 2) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'MAX_CATEGORIES',
            message: 'Un restaurante o tienda solo puede elegir hasta 2 categorías.',
          },
        });
      }

      if (restData.transferAccountNumber) {
        restData.transferAccountNumber = encrypt(restData.transferAccountNumber);
      }

      const nextPickupOnly = restData.pickupOnly ?? ownedRestaurant.pickupOnly ?? false;

      // "Solo recoger en tienda" es excluyente con la entrega: fuerza reparto propio
      // y prestar apoyo a la red apagados, y sin tarifa de envío.
      if (nextPickupOnly) {
        restData.hasOwnDelivery = true;
        restData.supportsNetworkDelivery = false;
        restData.deliveryFee = null;
      }

      const nextHasOwnDelivery = restData.hasOwnDelivery ?? ownedRestaurant.hasOwnDelivery;
      restData.hasOwnDelivery = true;
      restData.supportsNetworkDelivery = false;
      const updateData: Record<string, unknown> = {
        ...restData,
        pickupOnly: nextPickupOnly,
        deliveryFee: nextPickupOnly ? null : (nextHasOwnDelivery ? restData.deliveryFee : null),
      };
      if (nextHasOwnDelivery !== undefined) {
        updateData.deliveryPricingModel = nextHasOwnDelivery
          ? (restData.deliveryPricingModel ?? ownedRestaurant.deliveryPricingModel ?? 'fixed')
          : 'fixed';
      }

      const updatedRestaurant = await prisma.$transaction(async (tx) => {
        await tx.restaurant.update({
          where: { id: ownedRestaurant.id },
          data: updateData,
        });

        if (storeCategories !== undefined) {
          await tx.restaurantStoreCategory.deleteMany({
            where: { restaurantId: ownedRestaurant.id },
          });

          if (storeCategories.length > 0) {
            await tx.restaurantStoreCategory.createMany({
              data: storeCategories.map((categoryId) => ({
                restaurantId: ownedRestaurant.id,
                categoryId,
              })),
            });
          }
        }

        return tx.restaurant.findUnique({
          where: { id: ownedRestaurant.id },
          include: {
            storeCategories: {
              include: {
                category: true,
              },
            },
          },
        });
      });

      const oldImageKeys = [];
      if (restData.logo !== undefined && ownedRestaurant.logo && restData.logo !== ownedRestaurant.logo) {
        oldImageKeys.push(urlToKey(ownedRestaurant.logo));
      }
      if (restData.coverImage !== undefined && ownedRestaurant.coverImage && restData.coverImage !== ownedRestaurant.coverImage) {
        oldImageKeys.push(urlToKey(ownedRestaurant.coverImage));
      }
      await deleteImages(oldImageKeys);

      if (updatedRestaurant) {
        updatedRestaurant.transferAccountNumber = updatedRestaurant.transferAccountNumber
          ? decrypt(updatedRestaurant.transferAccountNumber)
          : updatedRestaurant.transferAccountNumber;
      }

      return reply.send({
        success: true,
        data: updatedRestaurant,
      });
    });

    restaurant.post('/restaurant-panel/extender-cierre', async (request, reply) => {
      const user = getAuthenticatedUser(request);
      const ownedRestaurant = await getOwnedRestaurant(user.sub);

      if (!ownedRestaurant) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'RESTAURANT_NOT_FOUND',
            message: 'No se encontro el restaurante asociado a este usuario.',
          },
        });
      }

      const redis = require('../config/redis').getRedis();
      // Guardar bandera en Redis por 1 hora (3600 segundos)
      await redis.set(`skip_autoclose_${ownedRestaurant.id}`, 'true', 'EX', 3600);

      return reply.send({
        success: true,
        message: 'Auto-cierre pospuesto por 1 hora.',
      });
    });

    restaurant.get('/restaurant-panel/horarios', async (request, reply) => {
      const user = getAuthenticatedUser(request);
      const ownedRestaurant = await getOwnedRestaurant(user.sub);

      if (!ownedRestaurant) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'RESTAURANT_NOT_FOUND',
            message: 'No se encontro el restaurante asociado a este usuario.',
          },
        });
      }

      const items = await prisma.operatingHours.findMany({
        where: { restaurantId: ownedRestaurant.id },
        orderBy: [{ dayOfWeek: 'asc' }, { shiftIndex: 'asc' }],
      });

      return reply.send({
        success: true,
        data: items,
      });
    });

    restaurant.put('/restaurant-panel/horarios', async (request, reply) => {
      const parsed = parseBody(operatingHoursSchema.safeParse(request.body));

      if ('error' in parsed) {
        return reply.status(400).send(parsed.error);
      }

      const user = getAuthenticatedUser(request);
      const ownedRestaurant = await getOwnedRestaurant(user.sub);

      if (!ownedRestaurant) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'RESTAURANT_NOT_FOUND',
            message: 'No se encontro el restaurante asociado a este usuario.',
          },
        });
      }

      await prisma.$transaction([
        prisma.operatingHours.deleteMany({
          where: { restaurantId: ownedRestaurant.id },
        }),
        prisma.operatingHours.createMany({
          data: parsed.data.map((item) => ({
            restaurantId: ownedRestaurant.id,
            dayOfWeek: item.dayOfWeek,
            shiftIndex: item.shiftIndex,
            openTime: item.openTime,
            closeTime: item.closeTime,
            isClosed: item.isClosed,
          })),
        }),
      ]);

      const items = await prisma.operatingHours.findMany({
        where: { restaurantId: ownedRestaurant.id },
        orderBy: [{ dayOfWeek: 'asc' }, { shiftIndex: 'asc' }],
      });

      return reply.send({
        success: true,
        data: items,
      });
    });

    restaurant.get('/restaurant-panel/categorias', async (request, reply) => {
      const user = getAuthenticatedUser(request);
      const ownedRestaurant = await getOwnedRestaurant(user.sub);

      if (!ownedRestaurant) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'RESTAURANT_NOT_FOUND',
            message: 'No se encontro el restaurante asociado a este usuario.',
          },
        });
      }

      const items = await prisma.menuCategory.findMany({
        where: { restaurantId: ownedRestaurant.id },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      });

      return reply.send({
        success: true,
        data: items,
      });
    });

    restaurant.post('/restaurant-panel/categorias/reordenar', async (request, reply) => {
      const parsed = z.object({ categoryIds: z.array(z.string().min(1)).min(1).max(500) }).safeParse(request.body);
      if (!parsed.success || new Set(parsed.success ? parsed.data.categoryIds : []).size !== (parsed.success ? parsed.data.categoryIds.length : 0)) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_ORDER', message: 'La lista de categorías no es válida.' } });
      }
      const user = getAuthenticatedUser(request);
      const ownedRestaurant = await getOwnedRestaurant(user.sub);
      if (!ownedRestaurant) {
        return reply.status(404).send({ success: false, error: { code: 'RESTAURANT_NOT_FOUND', message: 'No se encontro el restaurante asociado a este usuario.' } });
      }
      const ids = parsed.data.categoryIds;
      const updated = await prisma.$transaction(async (tx) => {
        const current = await tx.menuCategory.findMany({ where: { restaurantId: ownedRestaurant.id }, select: { id: true } });
        const currentIds = new Set(current.map((category) => category.id));
        if (current.length !== ids.length || ids.some((id) => !currentIds.has(id))) return false;
        for (const [order, id] of ids.entries()) {
          await tx.menuCategory.updateMany({ where: { id, restaurantId: ownedRestaurant.id }, data: { order } });
        }
        return true;
      });
      if (!updated) {
        return reply.status(409).send({ success: false, error: { code: 'CATEGORIES_CHANGED', message: 'Las categorías cambiaron. Actualiza la página e intenta de nuevo.' } });
      }
      return reply.send({ success: true });
    });

    restaurant.post('/restaurant-panel/categorias', async (request, reply) => {
      const parsed = parseBody(categorySchema.safeParse(request.body));

      if ('error' in parsed) {
        return reply.status(400).send(parsed.error);
      }

      const user = getAuthenticatedUser(request);
      const ownedRestaurant = await getOwnedRestaurant(user.sub);

      if (!ownedRestaurant) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'RESTAURANT_NOT_FOUND',
            message: 'No se encontro el restaurante asociado a este usuario.',
          },
        });
      }

      const category = await prisma.menuCategory.create({
        data: {
          restaurantId: ownedRestaurant.id,
          name: parsed.data.name,
          description: parsed.data.description || null,
          icon: parsed.data.icon || null,
          order: parsed.data.order,
        },
      });

      return reply.status(201).send({
        success: true,
        data: category,
      });
    });

    restaurant.patch('/restaurant-panel/categorias/:id', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      const parsed = parseBody(categorySchema.partial().safeParse(request.body));

      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: params.error.issues[0]?.message || 'Parametros invalidos.',
          },
        });
      }

      if ('error' in parsed) {
        return reply.status(400).send(parsed.error);
      }

      const user = getAuthenticatedUser(request);
      const ownedRestaurant = await getOwnedRestaurant(user.sub);

      if (!ownedRestaurant) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'RESTAURANT_NOT_FOUND',
            message: 'No se encontro el restaurante asociado a este usuario.',
          },
        });
      }

      const category = await prisma.menuCategory.findFirst({
        where: {
          id: params.data.id,
          restaurantId: ownedRestaurant.id,
        },
      });

      if (!category) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'CATEGORY_NOT_FOUND',
            message: 'No se encontro la categoria.',
          },
        });
      }

      const updatedCategory = await prisma.menuCategory.update({
        where: { id: category.id },
        data: {
          ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
          ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
          ...(parsed.data.icon !== undefined ? { icon: parsed.data.icon } : {}),
          ...(parsed.data.order !== undefined ? { order: parsed.data.order } : {}),
        },
      });

      return reply.send({
        success: true,
        data: updatedCategory,
      });
    });

    restaurant.delete('/restaurant-panel/categorias/:id', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);

      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: params.error.issues[0]?.message || 'Parametros invalidos.',
          },
        });
      }

      const user = getAuthenticatedUser(request);
      const ownedRestaurant = await getOwnedRestaurant(user.sub);

      if (!ownedRestaurant) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'RESTAURANT_NOT_FOUND',
            message: 'No se encontro el restaurante asociado a este usuario.',
          },
        });
      }

      const category = await prisma.menuCategory.findFirst({
        where: {
          id: params.data.id,
          restaurantId: ownedRestaurant.id,
        },
        include: {
          products: {
            select: { id: true },
          },
        },
      });

      if (!category) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'CATEGORY_NOT_FOUND',
            message: 'No se encontro la categoria.',
          },
        });
      }

      if (category.products.length > 0) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'CATEGORY_IN_USE',
            message: 'No puedes eliminar una categoria que tiene productos asociados.',
          },
        });
      }

      await prisma.menuCategory.delete({
        where: { id: category.id },
      });

      return reply.status(204).send();
    });

    restaurant.get('/restaurant-panel/productos', async (request, reply) => {
      const user = getAuthenticatedUser(request);
      const ownedRestaurant = await getOwnedRestaurant(user.sub);

      if (!ownedRestaurant) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'RESTAURANT_NOT_FOUND',
            message: 'No se encontro el restaurante asociado a este usuario.',
          },
        });
      }

      const items = await prisma.product.findMany({
        where: { restaurantId: ownedRestaurant.id },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: {
          category: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      return reply.send({
        success: true,
        data: items,
      });
    });

    restaurant.post('/restaurant-panel/productos/generar-imagen', async (request, reply) => {
      if (!isAiImageConfigured()) {
        return reply.status(503).send({
          success: false,
          error: {
            code: 'AI_IMAGE_NOT_CONFIGURED',
            message: 'La generacion de imagenes con IA no esta configurada.',
          },
        });
      }

      const parsed = parseBody(generateImageSchema.safeParse(request.body));

      if ('error' in parsed) {
        return reply.status(400).send(parsed.error);
      }

      const user = getAuthenticatedUser(request);
      const ownedRestaurant = await getOwnedRestaurant(user.sub);

      if (!ownedRestaurant) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'RESTAURANT_NOT_FOUND',
            message: 'No se encontro el restaurante asociado a este usuario.',
          },
        });
      }

      await assertAiImageQuota(ownedRestaurant.id);

      const imageBase64 = await generateFoodImage({
        foodName: parsed.data.name,
        description: parsed.data.description || undefined,
        category: parsed.data.category,
        restaurantName: ownedRestaurant.name,
      });

      const uploaded = await uploadImage({
        source: `data:image/jpeg;base64,${imageBase64}`,
        kind: 'product-image',
        actorId: ownedRestaurant.id,
      });

      return reply.send({
        success: true,
        data: { url: uploaded.url },
      });
    });

    restaurant.post('/restaurant-panel/productos/generar-imagenes-faltantes', async (request, reply) => {
      const quota = getAiImageDailyCap();

      if (!isAiImageConfigured()) {
        return reply.status(503).send({
          success: false,
          error: {
            code: 'AI_IMAGE_NOT_CONFIGURED',
            message: 'La generacion de imagenes con IA no esta configurada.',
          },
        });
      }

      const user = getAuthenticatedUser(request);
      const ownedRestaurant = await getOwnedRestaurant(user.sub);

      if (!ownedRestaurant) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'RESTAURANT_NOT_FOUND',
            message: 'No se encontro el restaurante asociado a este usuario.',
          },
        });
      }

      const missingProducts = await prisma.product.findMany({
        where: {
          restaurantId: ownedRestaurant.id,
          OR: [{ image: null }, { image: '' }],
        },
        select: {
          id: true,
          name: true,
          description: true,
          category: { select: { name: true } },
        },
        take: 200,
      });

      const results = {
        generadas: 0,
        fallidas: 0,
        pendientes: missingProducts.length,
      };

      for (const product of missingProducts) {
        try {
          await assertAiImageQuota(ownedRestaurant.id);
        } catch (error) {
          // Al llegar al limite diario dejamos de generar y reportamos lo pendiente.
          if (isAppError(error) && error.code === 'AI_IMAGE_QUOTA_EXCEEDED') break;
          throw error;
        }

        try {
          const imageBase64 = await generateFoodImage({
            foodName: product.name,
            description: product.description || undefined,
            category: product.category?.name,
            restaurantName: ownedRestaurant.name,
          });

          const uploaded = await uploadImage({
            source: `data:image/jpeg;base64,${imageBase64}`,
            kind: 'product-image',
            actorId: ownedRestaurant.id,
          });

          await prisma.product.update({
            where: { id: product.id },
            data: {
              image: uploaded.url,
              images: [uploaded.url],
            },
          });

          results.generadas += 1;
        } catch (error) {
          if (isAppError(error) && error.code === 'AI_IMAGE_QUOTA_EXCEEDED') break;
          results.fallidas += 1;
        }

        // Pequeña pausa para no saturar el free tier de Workers AI.
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }

      results.pendientes = Math.max(0, results.pendientes - results.generadas - results.fallidas);

      // El monto maximo por lote ya viene acotado al tope diario, pero protegemos
      // el caso limite en que el lote entero quepa en la cuota.
      if (results.generadas > 0) {
        await invalidateCachePattern('restaurants*');
      }

      return reply.send({
        success: true,
        data: {
          generadas: results.generadas,
          fallidas: results.fallidas,
          pendientes: results.pendientes,
          limiteDiario: quota,
        },
      });
    });

    restaurant.post('/restaurant-panel/productos', async (request, reply) => {
      const parsed = parseBody(productSchema.safeParse(request.body));

      if ('error' in parsed) {
        return reply.status(400).send(parsed.error);
      }

      const user = getAuthenticatedUser(request);
      const ownedRestaurant = await getOwnedRestaurant(user.sub);

      if (!ownedRestaurant) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'RESTAURANT_NOT_FOUND',
            message: 'No se encontro el restaurante asociado a este usuario.',
          },
        });
      }

      const category = await prisma.menuCategory.findFirst({
        where: {
          id: parsed.data.categoryId,
          restaurantId: ownedRestaurant.id,
        },
      });

      if (!category) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'CATEGORY_NOT_FOUND',
            message: 'La categoria no existe o no pertenece a este restaurante.',
          },
        });
      }

      const product = await prisma.product.create({
        data: {
          restaurantId: ownedRestaurant.id,
          categoryId: parsed.data.categoryId,
          name: parsed.data.name,
          description: parsed.data.description,
          price: parsed.data.price,
          discountPrice: parsed.data.discountPrice || null,
          promoType: parsed.data.promoType || null,
          promoBuyQuantity: parsed.data.promoBuyQuantity || null,
          promoPayQuantity: parsed.data.promoPayQuantity || null,
          sellBy: parsed.data.sellBy,
          unitPrice: parsed.data.sellBy === 'WEIGHT' ? parsed.data.unitPrice : null,
          minWeightG: parsed.data.sellBy === 'WEIGHT' ? parsed.data.minWeightG : null,
          maxWeightG: parsed.data.sellBy === 'WEIGHT' ? parsed.data.maxWeightG : null,
          stepWeightG: parsed.data.sellBy === 'WEIGHT' ? parsed.data.stepWeightG : null,
          weightPresets: parsed.data.sellBy === 'WEIGHT' ? (parsed.data.weightPresets?.length ? JSON.stringify(parsed.data.weightPresets) : null) : null,
          image: parsed.data.image || null,
          images: parsed.data.images || (parsed.data.image ? [parsed.data.image] : []),
          imagePosition: parsed.data.imagePosition || null,
          imageZoom: parsed.data.imageZoom || null,
          isAvailable: parsed.data.isAvailable ?? true,
          isAdultOnly: parsed.data.isAdultOnly,
          trackStock: parsed.data.trackStock ?? false,
          stock: parsed.data.trackStock ? (parsed.data.stock ?? 0) : 0,
          lowStockThreshold: parsed.data.lowStockThreshold ?? 5,
          calories: parsed.data.calories || null,
          allergens: parsed.data.allergens,
          optionGroups: parsed.data.optionGroups && parsed.data.optionGroups.length > 0 ? {
            create: parsed.data.optionGroups.map((g: any) => ({
              name: g.name,
              minSelection: g.minSelection,
              maxSelection: g.maxSelection,
              options: {
                create: g.options.map((o: any) => ({
                  name: o.name,
                  price: o.price,
                  isAvailable: o.isAvailable,
                })),
              },
            })),
          } : undefined,
        },
        include: {
          category: true,
          optionGroups: {
            include: {
              options: true,
            },
          },
        },
      });

      return reply.status(201).send({
        success: true,
        data: product,
      });
    });

    restaurant.post('/restaurant-panel/productos/batch', async (request, reply) => {
      const batchProductSchema = productSchema.superRefine((product, ctx) => {
        product.optionGroups?.forEach((group, index) => {
          if (group.minSelection > group.maxSelection || group.maxSelection > group.options.length) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['optionGroups', index], message: `Revisa los límites y opciones del grupo ${group.name}.` });
          }
        });
      });
      const batchSchema = z.object({
        products: z.array(batchProductSchema).min(1, 'Debes incluir al menos un producto.').max(200, 'Maximo 200 productos por importacion.'),
      });
      const parsed = parseBody(batchSchema.safeParse(request.body));

      if ('error' in parsed) {
        return reply.status(400).send(parsed.error);
      }

      const user = getAuthenticatedUser(request);
      const ownedRestaurant = await getOwnedRestaurant(user.sub);

      if (!ownedRestaurant) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'RESTAURANT_NOT_FOUND',
            message: 'No se encontro el restaurante asociado a este usuario.',
          },
        });
      }

      const ownedCategoryIds = new Set(
        (await prisma.menuCategory.findMany({
          where: { restaurantId: ownedRestaurant.id },
          select: { id: true },
        })).map((category) => category.id),
      );

      const createdProducts: Array<{ id: string; name: string }> = [];
      const perItemErrors: { index: number; name: string; message: string }[] = [];

      for (let index = 0; index < parsed.data.products.length; index += 1) {
        const validation = productSchema.safeParse(parsed.data.products[index]);

        if (!validation.success) {
          perItemErrors.push({
            index,
            name: String(parsed.data.products[index].name ?? `Producto ${index + 1}`),
            message: validation.error.issues[0]?.message || 'Datos invalidos.',
          });
          continue;
        }

        const item = validation.data;

        if (!ownedCategoryIds.has(item.categoryId)) {
          perItemErrors.push({
            index,
            name: item.name,
            message: 'La categoria no existe o no pertenece a este restaurante.',
          });
          continue;
        }

        const product = await prisma.product.create({
          data: {
            restaurantId: ownedRestaurant.id,
            categoryId: item.categoryId,
            name: item.name,
            description: item.description,
            price: item.price,
            discountPrice: item.discountPrice || null,
            promoType: item.promoType || null,
            promoBuyQuantity: item.promoBuyQuantity || null,
            promoPayQuantity: item.promoPayQuantity || null,
            sellBy: item.sellBy,
            unitPrice: item.sellBy === 'WEIGHT' ? item.unitPrice : null,
            minWeightG: item.sellBy === 'WEIGHT' ? item.minWeightG : null,
            maxWeightG: item.sellBy === 'WEIGHT' ? item.maxWeightG : null,
            stepWeightG: item.sellBy === 'WEIGHT' ? item.stepWeightG : null,
            weightPresets: item.sellBy === 'WEIGHT' ? (item.weightPresets?.length ? JSON.stringify(item.weightPresets) : null) : null,
            image: item.image || null,
            images: item.images?.length ? item.images : (item.image ? [item.image] : []),
            imagePosition: item.imagePosition || null,
            imageZoom: item.imageZoom || null,
            isAvailable: item.isAvailable ?? true,
            isAdultOnly: item.isAdultOnly,
            trackStock: item.trackStock ?? false,
            stock: item.trackStock ? (item.stock ?? 0) : 0,
            lowStockThreshold: item.lowStockThreshold ?? 5,
            calories: item.calories || null,
            allergens: item.allergens,
            optionGroups: item.optionGroups && item.optionGroups.length > 0 ? {
              create: item.optionGroups.map((group) => ({
                name: group.name,
                minSelection: group.minSelection,
                maxSelection: group.maxSelection,
                options: {
                  create: group.options.map((option) => ({
                    name: option.name,
                    price: option.price,
                    isAvailable: option.isAvailable,
                  })),
                },
              })),
            } : undefined,
          },
          include: {
            category: {
              select: { id: true, name: true },
            },
          },
        });

        createdProducts.push(product);
      }

      return reply.status(200).send({
        success: true,
        data: {
          created: createdProducts.length,
          skipped: perItemErrors.length,
          products: createdProducts,
          errors: perItemErrors,
        },
      });
    });

    const productBulkIdsSchema = z.object({
      ids: z.array(z.string().min(1)).min(1, 'Selecciona al menos un producto.').max(200, 'Maximo 200 productos por accion.'),
    });

    restaurant.patch('/restaurant-panel/productos/bulk/disponibilidad', async (request, reply) => {
      const parsed = parseBody(productBulkIdsSchema.extend({ isAvailable: z.boolean() }).safeParse(request.body));

      if ('error' in parsed) {
        return reply.status(400).send(parsed.error);
      }

      const user = getAuthenticatedUser(request);
      const ownedRestaurant = await getOwnedRestaurant(user.sub);

      if (!ownedRestaurant) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'RESTAURANT_NOT_FOUND',
            message: 'No se encontro el restaurante asociado a este usuario.',
          },
        });
      }

      const result = await prisma.product.updateMany({
        where: {
          id: { in: parsed.data.ids },
          restaurantId: ownedRestaurant.id,
        },
        data: {
          isAvailable: parsed.data.isAvailable,
        },
      });

      return reply.send({
        success: true,
        data: {
          updated: result.count,
        },
      });
    });

    restaurant.patch('/restaurant-panel/productos/bulk/categoria', async (request, reply) => {
      const parsed = parseBody(productBulkIdsSchema.extend({ categoryId: z.string().min(1, 'La categoria es obligatoria.') }).safeParse(request.body));

      if ('error' in parsed) {
        return reply.status(400).send(parsed.error);
      }

      const user = getAuthenticatedUser(request);
      const ownedRestaurant = await getOwnedRestaurant(user.sub);

      if (!ownedRestaurant) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'RESTAURANT_NOT_FOUND',
            message: 'No se encontro el restaurante asociado a este usuario.',
          },
        });
      }

      const category = await prisma.menuCategory.findFirst({
        where: {
          id: parsed.data.categoryId,
          restaurantId: ownedRestaurant.id,
        },
      });

      if (!category) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'CATEGORY_NOT_FOUND',
            message: 'La categoria no existe o no pertenece a este restaurante.',
          },
        });
      }

      const result = await prisma.product.updateMany({
        where: {
          id: { in: parsed.data.ids },
          restaurantId: ownedRestaurant.id,
        },
        data: {
          categoryId: parsed.data.categoryId,
        },
      });

      return reply.send({
        success: true,
        data: {
          updated: result.count,
        },
      });
    });

    restaurant.delete('/restaurant-panel/productos/bulk', async (request, reply) => {
      const parsed = parseBody(productBulkIdsSchema.safeParse(request.body));

      if ('error' in parsed) {
        return reply.status(400).send(parsed.error);
      }

      const user = getAuthenticatedUser(request);
      const ownedRestaurant = await getOwnedRestaurant(user.sub);

      if (!ownedRestaurant) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'RESTAURANT_NOT_FOUND',
            message: 'No se encontro el restaurante asociado a este usuario.',
          },
        });
      }

      const productsToDelete = await prisma.product.findMany({
        where: {
          id: { in: parsed.data.ids },
          restaurantId: ownedRestaurant.id,
        },
        select: {
          id: true,
          image: true,
          images: true,
        },
      });

      const imageKeys = productsToDelete
        .flatMap((product) => [product.image, ...(product.images || [])])
        .filter((key): key is string => Boolean(key))
        .map(urlToKey);

      await deleteImages(imageKeys);

      const result = await prisma.product.deleteMany({
        where: {
          id: { in: parsed.data.ids },
          restaurantId: ownedRestaurant.id,
        },
      });

      return reply.send({
        success: true,
        data: {
          deleted: result.count,
        },
      });
    });

    restaurant.get('/restaurant-panel/productos/:id', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);

      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: params.error.issues[0]?.message || 'Parametros invalidos.',
          },
        });
      }

      const user = getAuthenticatedUser(request);
      const ownedRestaurant = await getOwnedRestaurant(user.sub);

      if (!ownedRestaurant) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'RESTAURANT_NOT_FOUND',
            message: 'No se encontro el restaurante asociado a este usuario.',
          },
        });
      }

      const product = await prisma.product.findFirst({
        where: {
          id: params.data.id,
          restaurantId: ownedRestaurant.id,
        },
        include: {
          category: true,
          optionGroups: {
            include: {
              options: {
                orderBy: { createdAt: 'asc' },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      if (!product) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'PRODUCT_NOT_FOUND',
            message: 'No se encontro el producto.',
          },
        });
      }

      return reply.send({
        success: true,
        data: product,
      });
    });

    restaurant.patch('/restaurant-panel/productos/:id', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      const parsed = parseBody(productPatchSchema.safeParse(request.body));

      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: params.error.issues[0]?.message || 'Parametros invalidos.',
          },
        });
      }

      if ('error' in parsed) {
        return reply.status(400).send(parsed.error);
      }

      const user = getAuthenticatedUser(request);
      const ownedRestaurant = await getOwnedRestaurant(user.sub);

      if (!ownedRestaurant) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'RESTAURANT_NOT_FOUND',
            message: 'No se encontro el restaurante asociado a este usuario.',
          },
        });
      }

      const currentProduct = await prisma.product.findFirst({
        where: {
          id: params.data.id,
          restaurantId: ownedRestaurant.id,
        },
      });

      if (!currentProduct) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'PRODUCT_NOT_FOUND',
            message: 'No se encontro el producto.',
          },
        });
      }

      if (parsed.data.categoryId) {
        const category = await prisma.menuCategory.findFirst({
          where: {
            id: parsed.data.categoryId,
            restaurantId: ownedRestaurant.id,
          },
        });

        if (!category) {
          return reply.status(404).send({
            success: false,
            error: {
              code: 'CATEGORY_NOT_FOUND',
              message: 'La categoria no existe o no pertenece a este restaurante.',
            },
          });
        }
      }

      const updatedProduct = await prisma.$transaction(async (tx) => {
        // Handle optionGroups updates
        if (parsed.data.optionGroups !== undefined) {
          // Cascade deletes both the group and its options automatically
          await tx.productOptionGroup.deleteMany({
            where: { productId: currentProduct.id },
          });

          if (parsed.data.optionGroups.length > 0) {
            for (const g of parsed.data.optionGroups) {
              await tx.productOptionGroup.create({
                data: {
                  productId: currentProduct.id,
                  name: g.name,
                  minSelection: g.minSelection,
                  maxSelection: g.maxSelection,
                  options: {
                    create: g.options.map((o: any) => ({
                      name: o.name,
                      price: o.price,
                      isAvailable: o.isAvailable,
                    })),
                  },
                },
              });
            }
          }
        }

        const { optionGroups: _optionGroups, ...baseData } = parsed.data;
        const cleanData = Object.fromEntries(
          Object.entries(baseData).filter(([_, v]) => v !== undefined)
        );

        if (cleanData.weightPresets && Array.isArray(cleanData.weightPresets)) {
          cleanData.weightPresets = JSON.stringify(cleanData.weightPresets);
        }

        return tx.product.update({
          where: { id: currentProduct.id },
          data: {
            ...cleanData,
            ...(parsed.data.image !== undefined ? { image: parsed.data.image } : {}),
            ...(parsed.data.calories !== undefined ? { calories: parsed.data.calories } : {}),
          },
          include: {
            category: true,
            optionGroups: {
              include: {
                options: true,
              },
            },
          },
        });
      });

      const oldImageKeys = [];
      if (parsed.data.image !== undefined && currentProduct.image && parsed.data.image !== currentProduct.image) {
        oldImageKeys.push(urlToKey(currentProduct.image));
      }
      if (parsed.data.images !== undefined && currentProduct.images && currentProduct.images.length > 0) {
        const removed = currentProduct.images.filter(
          (url) => !(parsed.data.images || []).includes(url)
        );
        oldImageKeys.push(...removed.map(urlToKey));
      }
      await deleteImages(oldImageKeys);

      return reply.send({
        success: true,
        data: updatedProduct,
      });
    });

    restaurant.patch('/restaurant-panel/productos/:id/disponibilidad', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      const parsed = parseBody(productAvailabilitySchema.safeParse(request.body));

      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: params.error.issues[0]?.message || 'Parametros invalidos.',
          },
        });
      }

      if ('error' in parsed) {
        return reply.status(400).send(parsed.error);
      }

      const user = getAuthenticatedUser(request);
      const ownedRestaurant = await getOwnedRestaurant(user.sub);

      if (!ownedRestaurant) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'RESTAURANT_NOT_FOUND',
            message: 'No se encontro el restaurante asociado a este usuario.',
          },
        });
      }

      const product = await prisma.product.findFirst({
        where: {
          id: params.data.id,
          restaurantId: ownedRestaurant.id,
        },
      });

      if (!product) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'PRODUCT_NOT_FOUND',
            message: 'No se encontro el producto.',
          },
        });
      }

      const updatedProduct = await prisma.product.update({
        where: { id: product.id },
        data: {
          isAvailable: parsed.data.isAvailable,
        },
      });

      return reply.send({
        success: true,
        data: updatedProduct,
      });
    });

    restaurant.delete('/restaurant-panel/productos/:id', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);

      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: params.error.issues[0]?.message || 'Parametros invalidos.',
          },
        });
      }

      const user = getAuthenticatedUser(request);
      const ownedRestaurant = await getOwnedRestaurant(user.sub);

      if (!ownedRestaurant) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'RESTAURANT_NOT_FOUND',
            message: 'No se encontro el restaurante asociado a este usuario.',
          },
        });
      }

      const product = await prisma.product.findFirst({
        where: {
          id: params.data.id,
          restaurantId: ownedRestaurant.id,
        },
      });

      if (!product) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'PRODUCT_NOT_FOUND',
            message: 'No se encontro el producto.',
          },
        });
      }

      const imageKeys = [product.image, ...(product.images || [])].filter((k): k is string => !!k).map(urlToKey);
      await deleteImages(imageKeys);

      await prisma.product.delete({
        where: { id: product.id },
      });

      return reply.send({
        success: true,
        data: {
          id: product.id,
        },
      });
    });

    restaurant.patch('/restaurant-panel/estado-operativo', async (request, reply) => {
      const parsed = parseBody(operationalStatusSchema.safeParse(request.body));

      if ('error' in parsed) {
        return reply.status(400).send(parsed.error);
      }

      const user = getAuthenticatedUser(request);
      const ownedRestaurant = await getOwnedRestaurant(user.sub);

      if (!ownedRestaurant) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'RESTAURANT_NOT_FOUND',
            message: 'No se encontro el restaurante asociado a este usuario.',
          },
        });
      }

      if (ownedRestaurant.status !== 'ACTIVE') {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'RESTAURANT_STATUS_BLOCKED',
            message:
              ownedRestaurant.statusReason ||
              'Este restaurante no puede abrir porque su estado administrativo no es activo.',
          },
        });
      }

      const updatedRestaurant = await prisma.restaurant.update({
        where: { id: ownedRestaurant.id },
        data: {
          isAcceptingOrders: parsed.data.isAcceptingOrders,
          ...(parsed.data.isPaused !== undefined ? { isPaused: parsed.data.isPaused } : {}),
          // Track who changed the operational state: clearing stale auto-close markers on reopen.
          ...(parsed.data.isAcceptingOrders
            ? { statusChangedAt: null, statusChangedBy: null, statusReason: null }
            : { statusChangedAt: new Date(), statusChangedBy: 'OWNER' }),
        },
      });

      return reply.send({
        success: true,
        data: updatedRestaurant,
      });
    });

    restaurant.patch('/restaurant-panel/password', async (request, reply) => {
      const parsed = parseBody(changePasswordSchema.safeParse(request.body));

      if ('error' in parsed) {
        return reply.status(400).send(parsed.error);
      }

      const user = getAuthenticatedUser(request);
      const account = await prisma.user.findUnique({
        where: { id: user.sub },
        select: {
          id: true,
          password: true,
        },
      });

      if (!account) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'No se encontro la cuenta del restaurante.',
          },
        });
      }

      const passwordMatches = isPasswordHash(account.password)
        ? await bcryptjs.compare(parsed.data.currentPassword, account.password)
        : account.password === parsed.data.currentPassword;

      if (!passwordMatches) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'INVALID_CURRENT_PASSWORD',
            message: 'La contraseña actual no es correcta.',
          },
        });
      }

      await prisma.user.update({
        where: { id: account.id },
        data: {
          password: await bcryptjs.hash(parsed.data.newPassword, 10),
        },
      });

      return reply.send({
        success: true,
        data: {
          updated: true,
        },
      });
    });

    // ===== Cupones (promocodes) =====
    restaurant.get('/restaurant-panel/promocodes', async (request, reply) => {
      const user = getAuthenticatedUser(request);
      const ownedRestaurant = await getOwnedRestaurant(user.sub);
      if (!ownedRestaurant) {
        return reply.status(404).send({
          success: false,
          error: { code: 'RESTAURANT_NOT_FOUND', message: 'No se encontro el restaurante.' },
        });
      }

      const promos = await prisma.promoCode.findMany({
        where: { restaurantId: ownedRestaurant.id },
        orderBy: { createdAt: 'desc' },
      });

      return reply.send({ success: true, data: promos });
    });

    restaurant.post('/restaurant-panel/promocodes', async (request, reply) => {
      const parsed = parseBody(promoCodeSchema.safeParse(request.body));

      if ('error' in parsed) {
        return reply.status(400).send(parsed.error);
      }

      const user = getAuthenticatedUser(request);
      const ownedRestaurant = await getOwnedRestaurant(user.sub);
      if (!ownedRestaurant) {
        return reply.status(404).send({
          success: false,
          error: { code: 'RESTAURANT_NOT_FOUND', message: 'No se encontro el restaurante.' },
        });
      }

      const existing = await prisma.promoCode.findUnique({
        where: {
          restaurantId_code: {
            restaurantId: ownedRestaurant.id,
            code: parsed.data.code,
          },
        },
      });
      if (existing) {
        return reply.status(409).send({
          success: false,
          error: { code: 'PROMO_CODE_EXISTS', message: 'Ya existe un cupon con ese codigo.' },
        });
      }

      const promo = await prisma.promoCode.create({
        data: {
          restaurantId: ownedRestaurant.id,
          code: parsed.data.code,
          description: parsed.data.description ?? null,
          type: parsed.data.type,
          value: parsed.data.value,
          giftProductId: parsed.data.type === 'FREE_PRODUCT' ? parsed.data.giftProductId! : null,
          minOrderAmount: parsed.data.minOrderAmount ?? null,
          validFrom: parsed.data.validFrom ?? null,
          validUntil: parsed.data.validUntil ?? null,
          maxUses: parsed.data.maxUses ?? null,
          maxUsesPerCustomer: parsed.data.maxUsesPerCustomer ?? null,
          firstPurchaseOnly: parsed.data.firstPurchaseOnly,
          isActive: parsed.data.isActive,
        },
      });

      return reply.status(201).send({ success: true, data: promo });
    });

    restaurant.patch('/restaurant-panel/promocodes/:id', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      const parsed = parseBody(promoCodePatchSchema.safeParse(request.body));

      if (!params.success || 'error' in parsed) {
        return reply.status(400).send((!params.success ? (params.error as any) : parsed.error));
      }

      const user = getAuthenticatedUser(request);
      const ownedRestaurant = await getOwnedRestaurant(user.sub);
      if (!ownedRestaurant) {
        return reply.status(404).send({
          success: false,
          error: { code: 'RESTAURANT_NOT_FOUND', message: 'No se encontro el restaurante.' },
        });
      }

      const promo = await prisma.promoCode.findFirst({
        where: { id: params.data.id, restaurantId: ownedRestaurant.id },
      });
      if (!promo) {
        return reply.status(404).send({
          success: false,
          error: { code: 'PROMO_CODE_NOT_FOUND', message: 'No se encontro el cupon.' },
        });
      }

      if (parsed.data.code && parsed.data.code !== promo.code) {
        const existing = await prisma.promoCode.findUnique({
          where: {
            restaurantId_code: {
              restaurantId: ownedRestaurant.id,
              code: parsed.data.code,
            },
          },
        });
        if (existing) {
          return reply.status(409).send({
            success: false,
            error: { code: 'PROMO_CODE_EXISTS', message: 'Ya existe un cupon con ese codigo.' },
          });
        }
      }

      const updated = await prisma.promoCode.update({
        where: { id: promo.id },
        data: parsed.data as any,
      });

      return reply.send({ success: true, data: updated });
    });

    restaurant.delete('/restaurant-panel/promocodes/:id', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_PARAMS', message: 'Parametros invalidos.' },
        });
      }

      const user = getAuthenticatedUser(request);
      const ownedRestaurant = await getOwnedRestaurant(user.sub);
      if (!ownedRestaurant) {
        return reply.status(404).send({
          success: false,
          error: { code: 'RESTAURANT_NOT_FOUND', message: 'No se encontro el restaurante.' },
        });
      }

      const promo = await prisma.promoCode.findFirst({
        where: { id: params.data.id, restaurantId: ownedRestaurant.id },
      });
      if (!promo) {
        return reply.status(404).send({
          success: false,
          error: { code: 'PROMO_CODE_NOT_FOUND', message: 'No se encontro el cupon.' },
        });
      }

      await prisma.promoCode.delete({ where: { id: promo.id } });

      return reply.send({ success: true });
    });
  });
}
