import { Prisma, UserRole } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcryptjs from 'bcryptjs';
import crypto from 'node:crypto';

import { prisma } from '../config/database';
import { getRedis } from '../config/redis';
import { deliverOtp } from '../services/otp-delivery.service';
import { authenticate, authorize, getAuthenticatedUser } from '../middleware/auth';
import { buildApartmentWhere, normalizeOptionalAddressText } from '../utils/address';
import { urlToKey, deleteImages } from '../services/storage.service';
import { isMexicanLocalPhone } from '../utils/mexican-phone';
import { getLoyaltyConfiguration } from '../services/restaurant-marketing.service';
import { RESTAURANT_ID } from '../config/single-restaurant';

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

const PHONE_CHANGE_OTP_TTL_SECONDS = 300; // Validez del código: 5 minutos
const PHONE_CHANGE_OTP_MAX_ATTEMPTS = 5; // Intentos de verificación antes de invalidar el código
const PHONE_CHANGE_RESEND_PER_HOUR = 5; // Tope de envíos de código por hora (control de costo/abuso)

function generateRandomOtp(): string {
  return crypto.randomInt(100000, 999999).toString();
}

function codesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

async function verifyPhoneChangeCode(userId: string, phone: string, code: string): Promise<boolean> {
  const redis = getRedis();
  const redisKey = `otp_change:${userId}`;
  const raw = await redis.get(redisKey);
  if (!raw) return false;

  let record: { code: string; phone: string } | null = null;
  try {
    record = JSON.parse(raw);
  } catch {
    record = null;
  }
  if (!record || record.phone !== phone) return false;

  if (!codesMatch(record.code, code)) {
    const attemptsKey = `otp_change_attempts:${userId}`;
    const attempts = parseInt((await redis.get(attemptsKey)) || '0', 10) + 1;
    if (attempts >= PHONE_CHANGE_OTP_MAX_ATTEMPTS) {
      await redis.del(redisKey);
      await redis.del(attemptsKey);
    } else {
      await redis.set(attemptsKey, String(attempts), 'EX', PHONE_CHANGE_OTP_TTL_SECONDS);
    }
    return false;
  }

  await redis.del(redisKey);
  await redis.del(`otp_change_attempts:${userId}`);
  return true;
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

    customerPanel.get('/customer/lealtad', async (request, reply) => {
      const user = getAuthenticatedUser(request);
      const customer = await prisma.customer.findUnique({ where: { userId: user.sub }, select: { id: true } });
      if (!customer) return reply.status(404).send({ success: false, error: { code: 'CUSTOMER_NOT_FOUND', message: 'No se encontró la cuenta.' } });
      const [program, orders] = await Promise.all([
        getLoyaltyConfiguration(),
        prisma.order.findMany({ where: { restaurantId: RESTAURANT_ID, customerId: customer.id, status: { in: ['DELIVERED', 'COMPLETED', 'PICKED_UP'] } }, select: { id: true, totalAmount: true, createdAt: true }, orderBy: { createdAt: 'desc' } }),
      ]);
      const points = program.enabled ? Math.floor(orders.reduce((sum, order) => sum + order.totalAmount, 0) / 100 * program.pointsPer100) : 0;
      return reply.send({ success: true, data: { enabled: program.enabled, points, eligibleOrders: orders.length,
        nextRewardPoints: program.rewardPoints, rewardAmount: program.rewardAmount, redemptionEnabled: false } });
    });

    customerPanel.get('/customer/marketing-consent', async (request, reply) => {
      const user = getAuthenticatedUser(request);
      const consent = await prisma.marketingConsent.findUnique({ where: { userId: user.sub }, select: { enabled: true, grantedAt: true, revokedAt: true } });
      return reply.send({ success: true, data: consent || { enabled: false, grantedAt: null, revokedAt: null } });
    });

    customerPanel.put('/customer/marketing-consent', async (request, reply) => {
      const parsed = z.object({ enabled: z.boolean() }).safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ success: false, error: { code: 'INVALID_CONSENT', message: 'Indica si autorizas o revocas las campañas comerciales.' } });
      const user = getAuthenticatedUser(request), now = new Date();
      const consent = await prisma.marketingConsent.upsert({
        where: { userId: user.sub },
        create: { userId: user.sub, enabled: parsed.data.enabled, grantedAt: parsed.data.enabled ? now : null, revokedAt: parsed.data.enabled ? null : now },
        update: { enabled: parsed.data.enabled, ...(parsed.data.enabled ? { grantedAt: now, revokedAt: null } : { revokedAt: now }) },
        select: { enabled: true, grantedAt: true, revokedAt: true },
      });
      return reply.send({ success: true, data: consent });
    });

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

    customerPanel.post(
      '/customer/profile/phone/send',
      { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
      async (request, reply) => {
        const parsed = z
          .object({ phone: z.string().refine(isMexicanLocalPhone), currentPassword: z.string().min(1) })
          .safeParse(request.body);

        if (!parsed.success) {
          return reply.status(400).send({
            success: false,
            error: {
              code: 'INVALID_PAYLOAD',
              message: 'Teléfono o contraseña inválidos.',
            },
          });
        }

        const user = getAuthenticatedUser(request);

        // Seguridad: exigir la contraseña actual antes de permitir pedir un SMS
        // de cambio de teléfono (evita que una sesión robada reasigne la cuenta).
        const account = await prisma.user.findUnique({
          where: { id: user.sub },
          select: { password: true },
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

        const normalized = parsed.data.phone;

        // Tope de reenvíos por hora por usuario (control de costo/abuso)
        const redis = getRedis();
        const sentKey = `otp_change_sent:${user.sub}`;
        const sentCount = parseInt((await redis.get(sentKey)) || '0', 10);
        if (sentCount >= PHONE_CHANGE_RESEND_PER_HOUR) {
          return reply.status(429).send({
            success: false,
            error: {
              code: 'OTP_RESEND_LIMIT',
              message: 'Has alcanzado el límite de códigos por hora. Intenta más tarde.',
            },
          });
        }

        const existingUser = await prisma.user.findFirst({
          where: {
            OR: [
              { phoneNormalized: normalized },
              { phone: { in: [parsed.data.phone.trim(), normalized, `+52${normalized}`, `+521${normalized}`] } },
            ],
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

        const code = generateRandomOtp();
        const redisKey = `otp_change:${user.sub}`;
        await redis.set(redisKey, JSON.stringify({ code, phone: normalized }), 'EX', PHONE_CHANGE_OTP_TTL_SECONDS);
        await redis.multi().incr(sentKey).expire(sentKey, 60 * 60).exec();

        const delivery = await deliverOtp({ phone: normalized, code, preferred: 'sms' });

        if (!delivery.ok) {
          await redis.del(redisKey);
          return reply.status(503).send({
            success: false,
            error: {
              code: 'DELIVERY_FAILED',
              message: 'No se pudo enviar el código por SMS. Intenta más tarde.',
            },
          });
        }

        return reply.send({
          success: true,
          data: {
            phone: normalized,
            channel: delivery.channel,
            expiresInSeconds: PHONE_CHANGE_OTP_TTL_SECONDS,
            ...(delivery.channel === 'mock' && delivery.mockCode ? { mockCode: delivery.mockCode } : {}),
          },
        });
      },
    );

    customerPanel.patch('/customer/profile', async (request, reply) => {
      const profileSchema = z.object({
        name: z.string().min(1).optional(),
        lastName: z.string().min(2).nullable().optional(),
        phone: z.string().refine(isMexicanLocalPhone, 'Ingresa un teléfono de 10 dígitos.').optional(),
        phoneChangeCode: z.string().optional(),
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
        'profilePhoto' in parsed.data || parsed.data.phone
          ? await prisma.user.findUnique({
              where: { id: user.sub },
              select: { profilePhoto: true, phone: true },
            })
          : null;

      if (parsed.data.phone) {
        const normalized = parsed.data.phone;
        const existingUser = await prisma.user.findFirst({
          where: {
            OR: [
              { phoneNormalized: normalized },
              { phone: { in: [parsed.data.phone.trim(), normalized, `+52${normalized}`, `+521${normalized}`] } },
            ],
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

        const currentPhone = currentUser?.phone ? currentUser.phone.replace(/\D/g, '').slice(-10) : '';
        const phoneChanged = Boolean(normalized) && normalized !== currentPhone;

        if (phoneChanged) {
          if (!parsed.data.phoneChangeCode) {
            return reply.status(403).send({
              success: false,
              error: {
                code: 'PHONE_CHANGE_CODE_REQUIRED',
                message: 'Verifica tu nuevo número antes de cambiarlo.',
              },
            });
          }

          const verified = await verifyPhoneChangeCode(user.sub, normalized, parsed.data.phoneChangeCode);
          if (!verified) {
            return reply.status(400).send({
              success: false,
              error: {
                code: 'INVALID_CODE',
                message: 'El código es incorrecto o expiró.',
              },
            });
          }
        }
      }

      let updatedUser;
      try {
        updatedUser = await prisma.user.update({
          where: { id: user.sub },
          data: {
            ...(parsed.data.name ? { name: parsed.data.name } : {}),
            ...(parsed.data.lastName !== undefined ? { lastName: parsed.data.lastName } : {}),
            ...(parsed.data.phone ? { phone: parsed.data.phone, phoneNormalized: parsed.data.phone } : {}),
            ...('profilePhoto' in parsed.data ? { profilePhoto: parsed.data.profilePhoto } : {}),
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          return reply.status(409).send({
            success: false,
            error: {
              code: 'PHONE_IN_USE',
              message: 'El teléfono ya está registrado por otro usuario.',
            },
          });
        }
        throw error;
      }

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
