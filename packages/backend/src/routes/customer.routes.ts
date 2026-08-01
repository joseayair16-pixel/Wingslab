import { Prisma, UserRole } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcryptjs from 'bcryptjs';

import { prisma } from '../config/database';
import { authenticate, authorize, getAuthenticatedUser } from '../middleware/auth';
import { buildApartmentWhere, normalizeOptionalAddressText } from '../utils/address';
import { urlToKey, deleteImages } from '../services/storage.service';

const updatePreferencesSchema = z.object({
  deliveryPreference: z
    .enum(['NO_DOORBELL', 'CALL_ON_ARRIVAL', 'PREFER_WHATSAPP', 'HONK_ON_ARRIVAL', 'BEWARE_OF_DOG'])
    .nullable()
    .optional(),
  whatsappNotifications: z.boolean().optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

function isPasswordHash(password: string): boolean {
  return password.startsWith('$2b$') || password.startsWith('$2a$');
}

const createAddressSchema = z.object({
  street: z.string().min(1),
  number: z.string().min(1),
  apartment: z.string().optional(),
  neighborhood: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  zipCode: z.string().min(1),
  country: z.string().min(1),
  reference: z.string().optional(),
  latitude: z.number(),
  longitude: z.number(),
  isDefault: z.boolean().optional(),
});

const updateAddressSchema = createAddressSchema.partial();

export async function registerCustomerRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.register(async function customerScope(customerPanel) {
    customerPanel.addHook('preHandler', authenticate);
    customerPanel.addHook('preHandler', authorize([UserRole.CUSTOMER]));

    customerPanel.get('/customer/profile', async (request, reply) => {
      const user = getAuthenticatedUser(request);
      const customer = await prisma.customer.findUnique({
        where: { userId: user.sub },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              lastName: true,
              phone: true,
              region: true,
              profilePhoto: true,
              createdAt: true,
            },
          },
        },
      });

      if (!customer) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'CUSTOMER_NOT_FOUND',
            message: 'No se encontró el perfil del cliente.',
          },
        });
      }

      return reply.send({
        success: true,
        data: customer,
      });
    });

    customerPanel.patch('/customer/profile/preferences', async (request, reply) => {
      const parsed = updatePreferencesSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: parsed.error.issues[0]?.message || 'Datos inválidos.',
          },
        });
      }

      const user = getAuthenticatedUser(request);
      const customer = await prisma.customer.findUnique({
        where: { userId: user.sub },
      });

      if (!customer) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'CUSTOMER_NOT_FOUND',
            message: 'No se encontró el perfil del cliente.',
          },
        });
      }

      const updatedCustomer = await prisma.customer.update({
        where: { id: customer.id },
        data: parsed.data,
      });

      return reply.send({
        success: true,
        data: updatedCustomer,
      });
    });

    // ============== Addresses Routes ==============

    customerPanel.get('/customer/addresses', async (request, reply) => {
      const user = getAuthenticatedUser(request);
      const customer = await prisma.customer.findUnique({
        where: { userId: user.sub },
      });

      if (!customer) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'CUSTOMER_NOT_FOUND',
            message: 'No se encontró el perfil del cliente.',
          },
        });
      }

      const addresses = await prisma.address.findMany({
        where: { customerId: customer.id, isActive: true },
        orderBy: { createdAt: 'desc' },
      });

      return reply.send({
        success: true,
        data: addresses,
      });
    });

    customerPanel.post('/customer/addresses', async (request, reply) => {
      const parsed = createAddressSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: parsed.error.issues[0]?.message || 'Datos inválidos.',
          },
        });
      }

      const user = getAuthenticatedUser(request);
      const customer = await prisma.customer.findUnique({
        where: { userId: user.sub },
      });

      if (!customer) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'CUSTOMER_NOT_FOUND',
            message: 'No se encontró el perfil del cliente.',
          },
        });
      }

      // If isDefault is true, set all other addresses to false
      if (parsed.data.isDefault) {
        await prisma.address.updateMany({
          where: { customerId: customer.id },
          data: { isDefault: false },
        });
      }

      const addressData = {
        ...parsed.data,
        apartment: normalizeOptionalAddressText(parsed.data.apartment),
        reference: normalizeOptionalAddressText(parsed.data.reference),
      };

      const address = await prisma.address.create({
        data: {
          ...addressData,
          customerId: customer.id,
        },
      });

      return reply.send({
        success: true,
        data: address,
      });
    });

    // Endpoint to verify an address via geolocation (upsert + mark verified)
    customerPanel.post('/customer/addresses/verify', async (request, reply) => {
      const parsed = createAddressSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply
          .status(400)
          .send({
            success: false,
            error: {
              code: 'INVALID_PAYLOAD',
              message: parsed.error.issues[0]?.message || 'Datos inválidos.',
            },
          });
      }

      const user = getAuthenticatedUser(request);
      const customer = await prisma.customer.findUnique({ where: { userId: user.sub } });
      if (!customer) {
        return reply
          .status(404)
          .send({
            success: false,
            error: { code: 'CUSTOMER_NOT_FOUND', message: 'No se encontró el perfil del cliente.' },
          });
      }

      const addressData = {
        ...parsed.data,
        apartment: normalizeOptionalAddressText(parsed.data.apartment),
        reference: normalizeOptionalAddressText(parsed.data.reference),
      };

      // Try to find existing address by exact match
      let address = await prisma.address.findFirst({
        where: {
          customerId: customer.id,
          street: { equals: parsed.data.street, mode: 'insensitive' },
          number: { equals: parsed.data.number, mode: 'insensitive' },
          ...buildApartmentWhere(parsed.data.apartment),
          neighborhood: { equals: parsed.data.neighborhood, mode: 'insensitive' },
          city: { equals: parsed.data.city, mode: 'insensitive' },
          state: { equals: parsed.data.state, mode: 'insensitive' },
          zipCode: { equals: parsed.data.zipCode, mode: 'insensitive' },
        },
      });

      const now = new Date();
      if (address) {
        address = await prisma.address.update({
          where: { id: address.id },
          data: {
            latitude: parsed.data.latitude,
            longitude: parsed.data.longitude,
            reference: addressData.reference || address.reference,
            isActive: true,
            locationVerifiedAt: now,
          },
        });
      } else {
        // create and mark verified
        address = await prisma.address.create({
          data: {
            ...addressData,
            customerId: customer.id,
            isActive: true,
            locationVerifiedAt: now,
          },
        });
      }

      return reply.send({ success: true, data: address });
    });

    customerPanel.patch('/customer/addresses/:id', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      const parsed = updateAddressSchema.safeParse(request.body);

      if (!params.success || !parsed.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'Datos o parámetros inválidos.',
          },
        });
      }

      const user = getAuthenticatedUser(request);
      const customer = await prisma.customer.findUnique({
        where: { userId: user.sub },
      });

      if (!customer) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'CUSTOMER_NOT_FOUND',
            message: 'No se encontró el perfil del cliente.',
          },
        });
      }

      const address = await prisma.address.findFirst({
        where: { id: params.data.id, customerId: customer.id },
      });

      if (!address) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'ADDRESS_NOT_FOUND',
            message: 'No se encontró la dirección.',
          },
        });
      }

      // If isDefault is true, set all other addresses to false
      if (parsed.data.isDefault) {
        await prisma.address.updateMany({
          where: { customerId: customer.id },
          data: { isDefault: false },
        });
      }

      const addressData: Prisma.AddressUpdateInput = { ...parsed.data };
      if ('apartment' in addressData) {
        addressData.apartment = normalizeOptionalAddressText(parsed.data.apartment);
      }
      if ('reference' in addressData) {
        addressData.reference = normalizeOptionalAddressText(parsed.data.reference);
      }

      const updatedAddress = await prisma.address.update({
        where: { id: address.id },
        data: addressData,
      });

      return reply.send({
        success: true,
        data: updatedAddress,
      });
    });

    customerPanel.delete('/customer/addresses/:id', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);

      if (!params.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: 'Parámetros inválidos.',
          },
        });
      }

      const user = getAuthenticatedUser(request);
      const customer = await prisma.customer.findUnique({
        where: { userId: user.sub },
      });

      if (!customer) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'CUSTOMER_NOT_FOUND',
            message: 'No se encontró el perfil del cliente.',
          },
        });
      }

      const address = await prisma.address.findFirst({
        where: { id: params.data.id, customerId: customer.id },
      });

      if (!address) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'ADDRESS_NOT_FOUND',
            message: 'No se encontró la dirección.',
          },
        });
      }

      await prisma.address.update({
        where: { id: address.id },
        data: { isActive: false },
      });

      return reply.send({
        success: true,
        message: 'Dirección eliminada correctamente.',
      });
    });

    customerPanel.patch('/customer/profile/password', async (request, reply) => {
      const parsed = changePasswordSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: parsed.error.issues[0]?.message || 'Datos inválidos.',
          },
        });
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
            message: 'No se encontró la cuenta del usuario.',
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
        message: 'Contraseña actualizada correctamente.',
      });
    });

    customerPanel.patch('/customer/profile', async (request, reply) => {
      const profileSchema = z.object({
        name: z.string().min(1).optional(),
        lastName: z.string().min(2).nullable().optional(),
        phone: z.string().min(10).optional(),
        profilePhoto: z.string().nullable().optional(),
      });

      const parsed = profileSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: parsed.error.issues[0]?.message || 'Datos inválidos.',
          },
        });
      }

      const user = getAuthenticatedUser(request);

      const currentUser =
        'profilePhoto' in parsed.data
          ? await prisma.user.findUnique({
              where: { id: user.sub },
              select: { profilePhoto: true },
            })
          : null;

      if (parsed.data.phone) {
        const normalized = parsed.data.phone.replace(/\D/g, '').slice(-10);
        const existingUser = await prisma.user.findFirst({
          where: {
            phone: {
              in: [parsed.data.phone.trim(), normalized, `+52${normalized}`, `+521${normalized}`],
            },
            role: UserRole.CUSTOMER,
            id: { not: user.sub },
          },
          select: { id: true },
        });

        if (existingUser) {
          return reply.status(409).send({
            success: false,
            error: {
              code: 'PHONE_IN_USE',
              message: 'El teléfono ya está registrado por otro usuario.',
            },
          });
        }
      }

      const updatedUser = await prisma.user.update({
        where: { id: user.sub },
        data: {
          ...(parsed.data.name ? { name: parsed.data.name } : {}),
          ...(parsed.data.lastName !== undefined ? { lastName: parsed.data.lastName } : {}),
          ...(parsed.data.phone ? { phone: parsed.data.phone } : {}),
          ...('profilePhoto' in parsed.data ? { profilePhoto: parsed.data.profilePhoto } : {}),
        },
      });

      if (currentUser?.profilePhoto && parsed.data.profilePhoto !== currentUser.profilePhoto) {
        await deleteImages([urlToKey(currentUser.profilePhoto)]);
      }

      return reply.send({
        success: true,
        data: {
          id: updatedUser.id,
          name: updatedUser.name,
          lastName: updatedUser.lastName,
          phone: updatedUser.phone,
          profilePhoto: updatedUser.profilePhoto,
        },
      });
    });

    const createTicketSchema = z.object({
      type: z.enum(['APP', 'ORDER']),
      subject: z.string().optional(),
      description: z.string().min(1),
      storeName: z.string().optional(),
      orderNumber: z.string().optional(),
    });

    customerPanel.post('/customer/support/tickets', async (request, reply) => {
      const parsed = createTicketSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: parsed.error.issues[0]?.message || 'Datos inválidos.',
          },
        });
      }

      const user = getAuthenticatedUser(request);
      const customer = await prisma.customer.findUnique({
        where: { userId: user.sub },
      });

      if (!customer) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'CUSTOMER_NOT_FOUND',
            message: 'No se encontró el perfil del cliente.',
          },
        });
      }

      const ticket = await prisma.supportTicket.create({
        data: {
          ...parsed.data,
          customerId: customer.id,
        },
      });

      return reply.send({
        success: true,
        data: ticket,
      });
    });

    customerPanel.get('/customer/support/tickets', async (request, reply) => {
      const user = getAuthenticatedUser(request);
      const customer = await prisma.customer.findUnique({
        where: { userId: user.sub },
      });

      if (!customer) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'CUSTOMER_NOT_FOUND',
            message: 'No se encontró el perfil del cliente.',
          },
        });
      }

      const tickets = await prisma.supportTicket.findMany({
        where: { customerId: customer.id },
        orderBy: { createdAt: 'desc' },
      });

      return reply.send({
        success: true,
        data: tickets,
      });
    });

    // ============== Reviews Routes ==============
    const createReviewSchema = z.object({
      rating: z.number().min(1).max(5),
      comment: z.string().optional(),
      driverRating: z.number().min(1).max(5).optional(),
      driverComment: z.string().optional(),
    });

    customerPanel.post('/customer/pedidos/:id/review', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      const parsed = createReviewSchema.safeParse(request.body);

      if (!params.success || !parsed.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: 'Datos o parámetros inválidos.',
          },
        });
      }

      const user = getAuthenticatedUser(request);
      const customer = await prisma.customer.findUnique({
        where: { userId: user.sub },
      });

      if (!customer) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'CUSTOMER_NOT_FOUND',
            message: 'No se encontró el perfil del cliente.',
          },
        });
      }

      const order = await prisma.order.findUnique({
        where: { id: params.data.id },
        select: { restaurantId: true, customerId: true, status: true, driverId: true },
      });

      if (!order) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'ORDER_NOT_FOUND',
            message: 'No se encontró el pedido.',
          },
        });
      }

      if (order.customerId !== customer.id) {
        return reply.status(403).send({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'No tienes permiso para calificar este pedido.',
          },
        });
      }

      if (
        order.status !== 'DELIVERED' &&
        order.status !== 'COMPLETED' &&
        order.status !== 'PICKED_UP'
      ) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_ORDER_STATUS',
            message: 'Solo puedes calificar pedidos finalizados.',
          },
        });
      }

      let review;
      try {
        review = await prisma.$transaction(async (tx) => {
          const existingReview = await tx.review.findUnique({
            where: { orderId: params.data.id },
          });

          if (existingReview) {
            return { review: existingReview, alreadyExisting: true };
          }

          const createdReview = await tx.review.create({
            data: {
              customerId: customer.id,
              restaurantId: order.restaurantId,
              orderId: params.data.id,
              driverId: order.driverId,
              rating: parsed.data.rating,
              comment: parsed.data.comment,
              driverRating: parsed.data.driverRating,
              driverComment: parsed.data.driverComment,
            },
          });

          const restaurantAgg = await tx.review.aggregate({
            where: { restaurantId: order.restaurantId },
            _avg: { rating: true },
            _count: true,
          });

          const avgRating = restaurantAgg._avg.rating ?? 0;

          await tx.restaurantStats.upsert({
            where: { restaurantId: order.restaurantId },
            update: {
              rating: avgRating,
              reviewCount: restaurantAgg._count,
            },
            create: {
              restaurantId: order.restaurantId,
              rating: avgRating,
              reviewCount: restaurantAgg._count,
            },
          });

          // Update driver rating if applicable
          if (order.driverId && parsed.data.driverRating) {
            const driverAgg = await tx.review.aggregate({
              where: {
                driverId: order.driverId,
                driverRating: { not: null },
              },
              _avg: { driverRating: true },
            });

            const avgDriverRating = driverAgg._avg.driverRating;

            if (avgDriverRating !== null) {
              await tx.driverStats.upsert({
                where: { driverId: order.driverId },
                update: {
                  rating: avgDriverRating,
                },
                create: {
                  driverId: order.driverId,
                  rating: avgDriverRating,
                },
              });

              await tx.driver.update({
                where: { id: order.driverId },
                data: { rating: avgDriverRating },
              });
            }
          }

          return { review: createdReview, alreadyExisting: false };
        });
      } catch (createError) {
        // P2002: otro request concurrente ya creó la reseña (race en orderId @unique).
        // Se trata como éxito para garantizar idempotencia.
        if (
          createError instanceof Prisma.PrismaClientKnownRequestError &&
          createError.code === 'P2002'
        ) {
          const existingReview = await prisma.review.findUnique({
            where: { orderId: params.data.id },
          });
          if (existingReview) {
            return reply.send({
              success: true,
              data: existingReview,
              alreadyExisting: true,
            });
          }
        }
        throw createError;
      }

      return reply.send({
        success: true,
        data: review.review,
        alreadyExisting: review.alreadyExisting,
      });
    });

    // ─── DEUDA POR PEDIDO NO RECIBIDO ───────────────────────────────────────
    // Si el repartidor llego, espero 15+ min y el cliente no salio, se genera una
    // deuda (CustomerBillingSettlement) y la cuenta queda suspendida hasta pagar.
    customerPanel.get('/customer/deuda', async (request, reply) => {
      const user = getAuthenticatedUser(request);
      const customer = await prisma.customer.findUnique({
        where: { userId: user.sub },
        select: { id: true, isSuspendedByDebt: true, debtAmount: true },
      });

      if (!customer) {
        return reply.status(404).send({
          success: false,
          error: { code: 'CUSTOMER_NOT_FOUND', message: 'No se encontro el perfil del cliente.' },
        });
      }

      const settlement = await prisma.customerBillingSettlement.findFirst({
        where: {
          customerId: customer.id,
          status: { in: ['PENDING', 'IN_REVIEW', 'REJECTED'] },
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          reference: true,
          amount: true,
          status: true,
          paymentProofUrl: true,
          createdAt: true,
          dueDate: true,
          order: {
            select: {
              orderReference: true,
              totalAmount: true,
              createdAt: true,
              restaurant: { select: { name: true } },
            },
          },
        },
      });

      return reply.send({
        success: true,
        data: {
          hasDebt: customer.isSuspendedByDebt && customer.debtAmount > 0,
          isSuspendedByDebt: customer.isSuspendedByDebt,
          debtAmount: customer.debtAmount,
          settlement,
        },
      });
    });

    customerPanel.get('/customer/deuda/detalles', async (request, reply) => {
      const user = getAuthenticatedUser(request);
      const customer = await prisma.customer.findUnique({
        where: { userId: user.sub },
        select: { id: true },
      });
      if (!customer) {
        return reply.status(404).send({
          success: false,
          error: { code: 'CUSTOMER_NOT_FOUND', message: 'No se encontro el perfil del cliente.' },
        });
      }

      const settlement = await prisma.customerBillingSettlement.findFirst({
        where: {
          customerId: customer.id,
          status: { in: ['PENDING', 'IN_REVIEW', 'REJECTED'] },
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          reference: true,
          amount: true,
          status: true,
          paymentProofUrl: true,
          createdAt: true,
          dueDate: true,
          notes: true,
          order: {
            select: {
              orderReference: true,
              subtotal: true,
              taxAmount: true,
              serviceFee: true,
              deliveryFee: true,
              totalAmount: true,
              createdAt: true,
              restaurant: { select: { name: true } },
              items: {
                select: {
                  quantity: true,
                  unitPrice: true,
                  subtotal: true,
                  product: { select: { name: true } },
                  options: { select: { name: true, price: true } },
                },
              },
            },
          },
        },
      });

      if (!settlement) {
        return reply.send({ success: true, data: null });
      }

      return reply.send({ success: true, data: settlement });
    });

    customerPanel.post('/customer/deuda/pagar', async (request, reply) => {
      const body = z
        .object({
          settlementId: z.string().min(1),
          paymentProofUrl: z.string().url(),
        })
        .safeParse(request.body);

      if (!body.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: body.error.issues[0]?.message || 'Parametros invalidos.',
          },
        });
      }

      const user = getAuthenticatedUser(request);
      const customer = await prisma.customer.findUnique({
        where: { userId: user.sub },
        select: { id: true },
      });
      if (!customer) {
        return reply.status(404).send({
          success: false,
          error: { code: 'CUSTOMER_NOT_FOUND', message: 'No se encontro el perfil del cliente.' },
        });
      }

      const settlement = await prisma.customerBillingSettlement.findFirst({
        where: { id: body.data.settlementId, customerId: customer.id },
      });

      if (!settlement) {
        return reply.status(404).send({
          success: false,
          error: { code: 'SETTLEMENT_NOT_FOUND', message: 'No se encontro la deuda.' },
        });
      }

      if (settlement.status === 'IN_REVIEW') {
        return reply.status(409).send({
          success: false,
          error: { code: 'ALREADY_IN_REVIEW', message: 'Tu comprobante ya esta en revision.' },
        });
      }

      if (settlement.status === 'PAID') {
        return reply.status(409).send({
          success: false,
          error: { code: 'ALREADY_PAID', message: 'Esta deuda ya fue liquidada.' },
        });
      }

      const updated = await prisma.customerBillingSettlement.update({
        where: { id: settlement.id },
        data: {
          status: 'IN_REVIEW',
          paymentProofUrl: body.data.paymentProofUrl,
        },
      });

      return reply.send({ success: true, data: updated });
    });
  });
}
