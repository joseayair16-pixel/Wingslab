import { UserRole } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcryptjs from 'bcryptjs';

import { prisma } from '../config/database';
import { authenticate, authorize, getAuthenticatedUser } from '../middleware/auth';
import { buildRestaurantBillingSummary } from '../services/restaurant-billing.service';
import { encrypt, decrypt } from '../utils/crypto';
import { emitNotification } from '../services/socket.service';
import { sendPushNotification } from '../services/notification.service';
import { urlToKey, deleteImages } from '../services/storage.service';

const restaurantProfileSchema = z.object({
  name: z.string().min(3, 'El nombre es obligatorio.').optional(),
  description: z.string().min(10, 'La descripcion es obligatoria.').optional(),
  address: z.string().min(5, 'La direccion es obligatoria.').optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  region: z.string().min(1, 'La region es obligatoria.').optional(),
  logo: z.string().url('El logo debe ser una URL valida.').nullable().optional(),
  coverImage: z.string().url('La portada debe ser una URL valida.').nullable().optional(),
  featuredFlyer: z.string().url('El flyer debe ser una URL valida.').nullable().optional(),
  hasOwnDelivery: z.boolean().optional(),
  deliveryFee: z.number().nonnegative().nullable().optional(),
  deliveryRadius: z.number().nonnegative().optional(),
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
});

const operatingHoursSchema = z.array(
  z.object({
    dayOfWeek: z.number().int().min(0).max(6),
    openTime: z.string().regex(/^\d{2}:\d{2}$/, 'La hora de apertura debe ser HH:mm.'),
    closeTime: z.string().regex(/^\d{2}:\d{2}$/, 'La hora de cierre debe ser HH:mm.'),
    isClosed: z.boolean().default(false),
  })
).min(1, 'Debes enviar al menos un horario.');

const categorySchema = z.object({
  name: z.string().min(2, 'El nombre es obligatorio.'),
  description: z.string().max(300, 'La descripcion es demasiado larga.').nullable().optional(),
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

const productSchema = z.object({
  categoryId: z.string().min(1, 'La categoria es obligatoria.'),
  name: z.string().min(2, 'El nombre es obligatorio.'),
  description: z.string().min(5, 'La descripcion es obligatoria.'),
  price: z.number().positive('El precio debe ser mayor a cero.'),
  discountPrice: z.number().positive().nullable().optional(),
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
  preparationTime: z.number().int().positive('El tiempo de preparacion debe ser mayor a cero.'),
  calories: z.number().int().positive().nullable().optional(),
  allergens: z.array(z.string()).default([]),
  optionGroups: z.array(optionGroupSchema).optional(),
});

const productAvailabilitySchema = z.object({
  isAvailable: z.boolean(),
});

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

async function checkAndEnforceBillingSuspension(restaurantId: string, currentStatus: string) {
  const now = new Date();

  try {
    const result = await prisma.$transaction(async (tx) => {
      const pastDuePending = await tx.restaurantBillingSettlement.findMany({
        where: {
          restaurantId,
          status: 'PENDING',
          dueDate: { lte: now },
        },
        select: { id: true },
      });

      if (pastDuePending.length > 0) {
        await tx.restaurantBillingSettlement.updateMany({
          where: { id: { in: pastDuePending.map(s => s.id) } },
          data: { status: 'OVERDUE' },
        });
      }

      const overdueCount = await tx.restaurantBillingSettlement.count({
        where: { restaurantId, status: 'OVERDUE' },
      });

      if (overdueCount > 0 && currentStatus === 'ACTIVE') {
        await tx.restaurant.update({
          where: { id: restaurantId },
          data: {
            status: 'SUSPENDED',
            statusReason: 'Suspensión automática por pago vencido.',
            statusChangedAt: now,
            statusChangedBy: 'SYSTEM_DYNAMIC_BILLING_CHECK',
            isAcceptingOrders: false,
          },
        });
        return 'SUSPENDED';
      }

      return currentStatus;
    });

    if (result === 'SUSPENDED') {
      console.log(`[DynamicBillingCheck] Automatically suspended restaurant ${restaurantId}.`);
    }

    return result;
  } catch (error) {
    console.error(`[DynamicBillingCheck] Error processing billing suspension for ${restaurantId}:`, error);
    return currentStatus;
  }
}

async function getOwnedRestaurant(userId: string) {
  const restaurant = await prisma.restaurant.findUnique({
    where: { userId },
  });
  if (restaurant) {
    const finalStatus = await checkAndEnforceBillingSuspension(restaurant.id, restaurant.status);
    restaurant.status = finalStatus as any;
  }
  return restaurant;
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

      const finalStatus = await checkAndEnforceBillingSuspension(ownedRestaurant.id, ownedRestaurant.status);
      if (finalStatus !== ownedRestaurant.status) {
        ownedRestaurant.status = finalStatus as any;
        ownedRestaurant.statusReason = 'Suspensión automática por pago vencido.';
        ownedRestaurant.isAcceptingOrders = false;
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

    restaurant.get('/restaurant-panel/facturacion', async (request, reply) => {
      const user = getAuthenticatedUser(request);
      const ownedRestaurant = await prisma.restaurant.findUnique({
        where: { userId: user.sub },
        select: {
          id: true,
          billingCycle: true,
          platformFeeRate: true,
          serviceFee: true,
          platformFeePerOrder: true,
          lastBillingSettledAt: true,
          status: true,
          createdAt: true,
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

      const enforcedStatus = await checkAndEnforceBillingSuspension(ownedRestaurant.id, ownedRestaurant.status);
      ownedRestaurant.status = enforcedStatus as any;

      const billingSummary = await buildRestaurantBillingSummary(ownedRestaurant);
      const recentSettlements = await prisma.restaurantBillingSettlement.findMany({
        where: { restaurantId: ownedRestaurant.id, status: { not: 'REJECTED' } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      return reply.send({
        success: true,
        data: {
          ...billingSummary,
          recentSettlements,
        },
      });
    });

    restaurant.get('/restaurant-panel/facturacion/periodo-actual/pedidos', async (request, reply) => {
      const user = getAuthenticatedUser(request);
      const ownedRestaurant = await prisma.restaurant.findUnique({
        where: { userId: user.sub },
        select: {
          id: true,
          lastBillingSettledAt: true,
          createdAt: true,
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

      const periodStart = ownedRestaurant.lastBillingSettledAt && ownedRestaurant.lastBillingSettledAt.getTime() <= Date.now()
        ? ownedRestaurant.lastBillingSettledAt
        : ownedRestaurant.createdAt;

      const orders = await prisma.order.findMany({
        where: {
          restaurantId: ownedRestaurant.id,
          status: { in: ['DELIVERED', 'COMPLETED'] },
          createdAt: {
            gte: periodStart,
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          id: true,
          orderReference: true,
          dailyCounter: true,
          totalAmount: true,
          serviceFee: true,
          platformFee: true,
          createdAt: true,
          customer: {
            select: {
              user: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      });

      return reply.send({
        success: true,
        data: orders,
      });
    });

    restaurant.get('/restaurant-panel/facturacion/:id/pedidos', async (request, reply) => {
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
      const ownedRestaurant = await prisma.restaurant.findUnique({
        where: { userId: user.sub },
        select: { id: true },
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
      
      const settlement = await prisma.restaurantBillingSettlement.findFirst({
        where: {
          id: params.data.id,
          restaurantId: ownedRestaurant.id,
        },
      });
      
      if (!settlement) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'SETTLEMENT_NOT_FOUND',
            message: 'No se encontro la liquidacion.',
          },
        });
      }
      
      const orders = await prisma.order.findMany({
        where: {
          restaurantId: ownedRestaurant.id,
          status: { in: ['DELIVERED', 'COMPLETED'] },
          createdAt: {
            gte: settlement.periodStart,
            lte: settlement.periodEnd,
          },
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          orderReference: true,
          dailyCounter: true,
          totalAmount: true,
          serviceFee: true,
          platformFee: true,
          createdAt: true,
          customer: {
            select: {
              user: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      });

      return reply.send({
        success: true,
        data: orders,
      });
    });

    restaurant.post('/restaurant-panel/facturacion/:id/comprobante', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      const body = z.object({ paymentProofUrl: z.string().url() }).safeParse(request.body);
      
      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: params.error.issues[0]?.message || 'Parametros invalidos.',
          },
        });
      }
      
      if (!body.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_BODY',
            message: body.error.issues[0]?.message || 'Datos invalidos.',
          },
        });
      }
      
      const user = getAuthenticatedUser(request);
      const ownedRestaurant = await prisma.restaurant.findUnique({
        where: { userId: user.sub },
        select: { id: true },
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
      
      const settlement = await prisma.restaurantBillingSettlement.findFirst({
        where: {
          id: params.data.id,
          restaurantId: ownedRestaurant.id,
        },
      });
      
      if (!settlement) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'SETTLEMENT_NOT_FOUND',
            message: 'No se encontro la liquidacion.',
          },
        });
      }
      
      const updatedSettlement = await prisma.restaurantBillingSettlement.update({
        where: { id: settlement.id },
        data: {
          paymentProofUrl: body.data.paymentProofUrl,
          status: 'IN_REVIEW',
        },
      });
      
      return reply.send({
        success: true,
        data: updatedSettlement,
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

      if (restData.transferAccountNumber) {
        restData.transferAccountNumber = encrypt(restData.transferAccountNumber);
      }

      const nextHasOwnDelivery = restData.hasOwnDelivery ?? ownedRestaurant.hasOwnDelivery;
      const updateData = {
        ...restData,
        deliveryFee: nextHasOwnDelivery ? restData.deliveryFee : null,
      };

      const updatedRestaurant = await prisma.$transaction(async (tx) => {
        const updated = await tx.restaurant.update({
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
        orderBy: { dayOfWeek: 'asc' },
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

      const uniqueDays = new Set(parsed.data.map((item) => item.dayOfWeek));
      if (uniqueDays.size !== parsed.data.length) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'DUPLICATE_DAY',
            message: 'No puedes repetir dias en los horarios.',
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

      await prisma.$transaction([
        prisma.operatingHours.deleteMany({
          where: { restaurantId: ownedRestaurant.id },
        }),
        prisma.operatingHours.createMany({
          data: parsed.data.map((item) => ({
            restaurantId: ownedRestaurant.id,
            dayOfWeek: item.dayOfWeek,
            openTime: item.openTime,
            closeTime: item.closeTime,
            isClosed: item.isClosed,
          })),
        }),
      ]);

      const items = await prisma.operatingHours.findMany({
        where: { restaurantId: ownedRestaurant.id },
        orderBy: { dayOfWeek: 'asc' },
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
          preparationTime: parsed.data.preparationTime,
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
      const parsed = parseBody(productSchema.partial().safeParse(request.body));

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

        const { optionGroups, ...baseData } = parsed.data;
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

    // ==================== Featured / Destacados ====================

    function parseFeaturedPackages(setting: { value: string } | null): { days: number; price: number }[] {
      try {
        if (!setting) return [];
        const parsed = JSON.parse(setting.value);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((p: any) => typeof p.days === 'number' && typeof p.price === 'number');
      } catch {
        return [];
      }
    }

    restaurant.get('/restaurant/featured/packages', async (request, reply) => {
      try {
        const setting = await prisma.systemSetting.findUnique({
          where: { key: 'featuredPackages' },
        });
        const packages = parseFeaturedPackages(setting);
        return reply.send({ success: true, data: { packages } });
      } catch (error) {
        return reply.status(500).send({
          success: false,
          error: { message: 'Error al obtener los paquetes.' },
        });
      }
    });

    restaurant.post('/restaurant/featured/request', async (request, reply) => {
      const parsed = z.object({
        daysRequested: z.number().int().min(1).max(30),
        paymentProof: z.string().min(1, 'El comprobante es obligatorio.'),
      }).safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_PAYLOAD', message: parsed.error.issues[0]?.message || 'Datos invalidos.' },
        });
      }

      const user = getAuthenticatedUser(request);
      const restaurant = await prisma.restaurant.findUnique({ where: { userId: user.sub } });
      if (!restaurant) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Restaurante no encontrado.' },
        });
      }

      const setting = await prisma.systemSetting.findUnique({ where: { key: 'featuredPackages' } });
      const packages = parseFeaturedPackages(setting);
      const pkg = packages.find((p) => p.days === parsed.data.daysRequested);
      if (!pkg) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_PACKAGE', message: 'No hay un paquete disponible para esa cantidad de días.' },
        });
      }
      const totalPrice = pkg.price;

      const purchase = await prisma.featuredPurchase.create({
        data: {
          restaurantId: restaurant.id,
          daysRequested: parsed.data.daysRequested,
          totalPrice,
          paymentProof: parsed.data.paymentProof,
          status: 'PENDING',
        },
      });

      // Notify admins
      const admins = await prisma.admin.findMany({ include: { user: { select: { id: true } } } });
      for (const admin of admins) {
        emitNotification(fastify.io, admin.user.id, 'ADMIN', 'featured:new-request', {
          purchaseId: purchase.id,
          restaurantName: restaurant.name,
          daysRequested: parsed.data.daysRequested,
          totalPrice,
        });
        void sendPushNotification(admin.user.id, {
          title: 'Nueva solicitud de destacado',
          body: `${restaurant.name} solicito ${parsed.data.daysRequested} día(s) como destacado por $${totalPrice}.`,
          data: { type: 'featured', purchaseId: purchase.id },
        });
      }

      return reply.status(201).send({ success: true, data: purchase });
    });

    restaurant.get('/restaurant/featured/my-requests', async (request, reply) => {
      const user = getAuthenticatedUser(request);
      const restaurant = await prisma.restaurant.findUnique({ where: { userId: user.sub } });
      if (!restaurant) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Restaurante no encontrado.' },
        });
      }

      const purchases = await prisma.featuredPurchase.findMany({
        where: { restaurantId: restaurant.id },
        orderBy: { createdAt: 'desc' },
      });

      return reply.send({ success: true, data: purchases });
    });
  });
}
