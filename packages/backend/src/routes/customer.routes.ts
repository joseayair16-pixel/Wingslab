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
import { loyaltyQuote, loyaltyState } from '../services/loyalty-runtime.service';
import { RESTAURANT_ID } from '../config/single-restaurant';
import { createScanSession, getScanStatus } from '../services/loyalty-inperson.service';
import {
  createMercadoPagoCustomer, deleteMercadoPagoCard, findMercadoPagoCustomer, listMercadoPagoCards,
  saveMercadoPagoCard, sandboxPayerEmail,
} from '../services/mercado-pago-customer';
import { saveCardRequestSchema } from '../services/saved-card-policy';

const updatePreferencesSchema = z.object({
  deliveryPreference: z
    .enum(['NO_DOORBELL', 'CALL_ON_ARRIVAL',  'HONK_ON_ARRIVAL', 'BEWARE_OF_DOG'])
    .nullable()
    .optional(),
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

    // The vault is only exposed by the explicitly authorized local sandbox.
    // Saved card IDs are resolved server-side and never treated as ownership proof.
    const mpSandboxToken = process.env.WINGSLAB_MP_SANDBOX_ACCESS_TOKEN;
    const cardVaultEnabled = process.env.WINGSLAB_CHECKOUT_SANDBOX_ROUTES === 'true' &&
      process.env.WINGSLAB_CHECKOUT_RESERVATION_SWEEP === 'true' && Boolean(mpSandboxToken);
    if (cardVaultEnabled && mpSandboxToken) {
      customerPanel.get('/me/payment-methods/cards', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        try {
          const profile = await prisma.customer.findUnique({
            where: { userId: getAuthenticatedUser(request).sub },
            select: { mercadoPagoCustomerId: true },
          });
          if (!profile) return reply.code(404).send({ success: false, error: { code: 'CUSTOMER_NOT_FOUND', message: 'No se encontró la cuenta.' } });
          if (!profile.mercadoPagoCustomerId) return reply.send({ success: true, data: [] });
          const cards = await listMercadoPagoCards(mpSandboxToken, profile.mercadoPagoCustomerId);
          return reply.send({ success: true, data: cards.map(card => ({
            id: card.id, lastFourDigits: card.last_four_digits,
            expirationMonth: card.expiration_month ?? null, expirationYear: card.expiration_year ?? null,
            paymentMethod: { id: card.payment_method.id, name: card.payment_method.name ?? card.payment_method.id, type: card.payment_method.payment_type_id },
          })) });
        } catch (error) {
          request.log.error('No se pudieron cargar las tarjetas guardadas');
          return reply.code(503).send({ success: false, error: { code: 'SAVED_CARDS_UNAVAILABLE', message: 'No pudimos cargar tus tarjetas. Inténtalo de nuevo.' } });
        }
      });

      customerPanel.post('/me/payment-methods/cards', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        const body = saveCardRequestSchema.safeParse(request.body);
        if (!body.success) return reply.code(400).send({ success: false, error: { code: 'CARD_CONSENT_REQUIRED', message: 'Confirma que quieres guardar la tarjeta para futuras compras.' } });
        try {
          const userId = getAuthenticatedUser(request).sub;
          const profile = await prisma.customer.findUnique({
            where: { userId }, select: { id: true, mercadoPagoCustomerId: true, user: { select: { name: true, lastName: true } } },
          });
          if (!profile) return reply.code(404).send({ success: false, error: { code: 'CUSTOMER_NOT_FOUND', message: 'No se encontró la cuenta.' } });

          // Serialize external customer creation per local profile; the provider
          // call is deliberately bounded by its timeout and no card token is stored.
          const customerId = await prisma.$transaction(async tx => {
            await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" = ${profile.id} FOR UPDATE`;
            const current = await tx.customer.findUnique({ where: { id: profile.id }, select: { mercadoPagoCustomerId: true } });
            if (current?.mercadoPagoCustomerId) return current.mercadoPagoCustomerId;
            const [firstName, ...lastNameParts] = profile.user.name.trim().split(/\s+/);
            const email = sandboxPayerEmail(profile.id);
            const mpCustomer = await findMercadoPagoCustomer(mpSandboxToken, email) ??
              await createMercadoPagoCustomer(mpSandboxToken, email, firstName, lastNameParts.join(' ') || profile.user.lastName?.trim() || undefined);
            await tx.customer.update({ where: { id: profile.id }, data: { mercadoPagoCustomerId: mpCustomer.id } });
            return mpCustomer.id;
          }, { timeout: 15_000 });

          const card = await saveMercadoPagoCard(mpSandboxToken, customerId, body.data.cardToken);
          return reply.code(201).send({ success: true, data: {
            id: card.id, lastFourDigits: card.last_four_digits, expirationMonth: card.expiration_month ?? null,
            expirationYear: card.expiration_year ?? null,
            paymentMethod: { id: card.payment_method.id, name: card.payment_method.name ?? card.payment_method.id, type: card.payment_method.payment_type_id },
          } });
        } catch (error) {
          request.log.error('No se pudo guardar la tarjeta en Mercado Pago');
          return reply.code(502).send({ success: false, error: { code: 'CARD_SAVE_FAILED', message: 'Mercado Pago no pudo guardar la tarjeta. Puedes continuar sin guardarla.' } });
        }
      });

      customerPanel.delete('/me/payment-methods/cards/:id', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        const params = z.object({ id: z.string().min(1).max(128) }).safeParse(request.params);
        if (!params.success) return reply.code(404).send({ success: false, error: { code: 'CARD_NOT_FOUND', message: 'No se encontró esa tarjeta.' } });
        try {
          const profile = await prisma.customer.findUnique({
            where: { userId: getAuthenticatedUser(request).sub }, select: { mercadoPagoCustomerId: true },
          });
          if (!profile?.mercadoPagoCustomerId) return reply.code(404).send({ success: false, error: { code: 'CARD_NOT_FOUND', message: 'No se encontró esa tarjeta.' } });
          const cards = await listMercadoPagoCards(mpSandboxToken, profile.mercadoPagoCustomerId);
          if (!cards.some(card => card.id === params.data.id)) return reply.code(404).send({ success: false, error: { code: 'CARD_NOT_FOUND', message: 'No se encontró esa tarjeta.' } });
          await deleteMercadoPagoCard(mpSandboxToken, profile.mercadoPagoCustomerId, params.data.id);
          return reply.send({ success: true, data: { deleted: true } });
        } catch (error) {
          request.log.error('No se pudo quitar la tarjeta guardada');
          return reply.code(502).send({ success: false, error: { code: 'CARD_DELETE_FAILED', message: 'No pudimos quitar la tarjeta. Inténtalo de nuevo.' } });
        }
      });
    }

    customerPanel.get('/customer/lealtad', async (request, reply) => {
      const user = getAuthenticatedUser(request);
      const customer = await prisma.customer.findUnique({ where: { userId: user.sub }, select: { id: true } });
      if (!customer) return reply.status(404).send({ success: false, error: { code: 'CUSTOMER_NOT_FOUND', message: 'No se encontró la cuenta.' } });
      const currentProgram = await getLoyaltyConfiguration();
      const live = currentProgram.redemptionReady ? await prisma.$transaction(tx => loyaltyState(tx, customer.id), { timeout: 30000 }) : null;
      // Show the terms of the card that actually earns the next stamp. A
      // completed card keeps its own reward in history.
      const rewardProgram = live?.open ?? live?.program ?? currentProgram;
      const rewardProductPromise = rewardProgram.rewardKind === 'PRODUCT' && rewardProgram.rewardProductId
        ? prisma.product.findFirst({ where: { id: rewardProgram.rewardProductId, restaurantId: RESTAURANT_ID, deleted: false }, select: { image: true } })
        : Promise.resolve(null);
      if (live) {
        const [brand, rewardProduct, stampRecords] = await Promise.all([
          prisma.restaurant.findUnique({ where: { id: RESTAURANT_ID }, select: { name: true, logo: true } }),
          rewardProductPromise,
          live.open ? prisma.loyaltyStamp.findMany({
            where: { cardId: live.open.id, card: { customerId: customer.id, restaurantId: RESTAURANT_ID } },
            orderBy: [{ earnedAt: 'asc' }, { id: 'asc' }],
            select: { id: true, source: true, earnedAt: true,
              order: { select: { customerId: true, restaurantId: true, orderReference: true, dailyCounter: true, status: true, totalAmount: true } },
              visit: { select: { customerId: true, restaurantId: true, totalCents: true, amountCents: true, paymentMethod: true } } },
          }) : Promise.resolve([]),
        ]);
        const completedCards = live.list
          .filter((card: any) => card.state === 'COMPLETED')
          .sort((a: any, b: any) => b.sequence - a.sequence);
        const history = completedCards.map((card: any) => ({
          sequence: card.sequence,
          goal: card.goal,
          stamps: card.stamps,
          rewardDescription: card.rewardDescription,
          rewardKind: card.rewardKind,
          rewardValue: card.rewardValue,
          completedAt: card.completedAt ? new Date(card.completedAt).toISOString() : null,
          redeemed: card.redemptionState === 'COMPLETED',
          reserved: card.redemptionState === 'RESERVED',
        }));
        const programGoal = live.open?.goal ?? live.program.stampGoal;
        const openStamps = Math.min(programGoal, live.open?.stamps ?? 0);
        const terms = live.open?.terms ?? live.program.stampTerms;
        return reply.send({ success: true, data: {
          enabled: live.program.enabled, redemptionEnabled: true,
          stamps: openStamps, stampGoal: programGoal,
          stampDetails: stampRecords.slice(0, openStamps).map(stamp => ({
            id: stamp.id, source: stamp.source, earnedAt: stamp.earnedAt,
            order: stamp.order?.customerId === customer.id && stamp.order.restaurantId === RESTAURANT_ID
              ? { reference: stamp.order.orderReference, number: stamp.order.dailyCounter, status: stamp.order.status, total: stamp.order.totalAmount } : null,
            visitTotal: stamp.visit && (stamp.visit.paymentMethod || stamp.visit.totalCents !== null || stamp.visit.amountCents > 0)
              && stamp.visit.customerId === customer.id && stamp.visit.restaurantId === RESTAURANT_ID
              ? (stamp.visit.totalCents ?? stamp.visit.amountCents) / 100 : null,
          })),
          rewardDescription: rewardProgram.rewardDescription,
          rewardTerms: terms,
          rewardKind: rewardProgram.rewardKind,
          rewardProductImage: rewardProduct?.image || null,
          rewardValue: rewardProgram.rewardValue,
          stampTerms: terms,
          availableRewards: live.available.length, reserved: live.reserved,
          eligibleForNextOrder: live.eligible, brand,
          completedCount: history.filter((item: any) => item.redeemed).length,
          history,
        } });
      }
      const [program, orders, rewardProduct] = await Promise.all([
        Promise.resolve(currentProgram),
        prisma.order.findMany({ where: { restaurantId: RESTAURANT_ID, customerId: customer.id, paymentStatus: 'COMPLETED', noShowReleasedAt: null, OR: [{ status: { in: ['DELIVERED', 'COMPLETED'] } }, { status: 'PICKED_UP', fulfillmentType: 'PICKUP' }] }, select: { id: true, totalAmount: true, createdAt: true }, orderBy: { createdAt: 'desc' } }),
        rewardProductPromise,
      ]);
      const points = program.enabled ? Math.floor(orders.reduce((sum, order) => sum + order.totalAmount, 0) / 100 * program.pointsPer100) : 0;
      const stamps = program.enabled && program.stampStartsAt ? orders.filter(order => order.createdAt >= new Date(program.stampStartsAt)).length : 0;
      return reply.send({ success: true, data: { enabled: program.enabled, points, eligibleOrders: orders.length,
        nextRewardPoints: program.rewardPoints, rewardAmount: program.rewardAmount, redemptionEnabled: false,
        stamps, stampDetails: [], stampGoal: program.stampGoal, rewardType: program.rewardType, rewardKind: program.rewardKind, rewardProductImage: rewardProduct?.image || null, rewardDescription: program.rewardDescription, stampTerms: program.stampTerms, stampStartsAt: program.stampStartsAt } });
    });

    customerPanel.post('/customer/lealtad/qr', {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    }, async (request, reply) => {
      const user = getAuthenticatedUser(request);
      const customer = await prisma.customer.findUnique({ where: { userId: user.sub }, select: { id: true } });
      if (!customer) return reply.status(404).send({ success: false, error: { code: 'CUSTOMER_NOT_FOUND', message: 'No se encontró la cuenta.' } });
      const program = await getLoyaltyConfiguration();
      if (!program.redemptionReady || !program.enabled) return reply.status(409).send({ success: false, error: { code: 'LOYALTY_PROGRAM_OFF', message: 'El programa de fidelidad está en pausa o aún no está configurado.' } });
      return reply.send({ success: true, data: await createScanSession(prisma, customer.id) });
    });

    customerPanel.get('/customer/lealtad/qr/:sessionId', {
      config: { rateLimit: { max: 45, timeWindow: '1 minute' } },
    }, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const parsed = z.object({ sessionId: z.string().uuid() }).safeParse(request.params);
      if (!parsed.success) return reply.status(400).send({ success: false, error: { code: 'INVALID_QR', message: 'Código no válido.' } });
      const user = getAuthenticatedUser(request);
      const customer = await prisma.customer.findUnique({ where: { userId: user.sub }, select: { id: true } });
      if (!customer) return reply.status(404).send({ success: false, error: { code: 'CUSTOMER_NOT_FOUND', message: 'No se encontró la cuenta.' } });
      return reply.send({ success: true, data: await getScanStatus(prisma, customer.id, parsed.data.sessionId) });
    });

    customerPanel.post('/customer/lealtad/cotizar', async (request, reply) => {
      const parsed = z.object({ subtotalCents: z.number().int().min(0).max(100000000), productIds: z.array(z.string().min(1)).max(100), otherPromotion: z.boolean().default(false) }).safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ success: false, error: { code: 'INVALID_QUOTE', message: 'Carrito no válido.' } });
      const user = getAuthenticatedUser(request);
      const customer = await prisma.customer.findUnique({ where: { userId: user.sub }, select: { id: true } });
      if (!customer) return reply.status(404).send({ success: false, error: { code: 'CUSTOMER_NOT_FOUND', message: 'No se encontró la cuenta.' } });
      const quote = await prisma.$transaction(tx => loyaltyQuote(tx, customer.id, parsed.data.subtotalCents, parsed.data.productIds, parsed.data.otherPromotion), { timeout: 30000 });
      return reply.send({ success: true, data: quote });
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
      subject: z.string().trim().max(150).optional(),
      description: z.string().trim().min(10).max(4000),
      storeName: z.string().max(150).optional(),
      orderNumber: z.string().max(100).optional(),
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

      if (parsed.data.type === 'ORDER') {
        const order = parsed.data.orderNumber ? await prisma.order.findFirst({ where: { customerId: customer.id, restaurantId: RESTAURANT_ID, orderReference: parsed.data.orderNumber }, select: { id: true } }) : null;
        if (!order) return reply.status(400).send({ success: false, error: { code: 'INVALID_ORDER', message: 'Selecciona uno de tus pedidos de WingsLab.' } });
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
      rating: z.number().int().min(1).max(5),
      comment: z.string().trim().max(500).optional(),
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
        select: { restaurantId: true, customerId: true, status: true },
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
              rating: parsed.data.rating,
              comment: parsed.data.comment || null,
            },
          });

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
