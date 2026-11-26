import { PaymentMethod, UserRole, OrderStatus } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { prisma } from '../config/database';
import { RESTAURANT_ID } from '../config/single-restaurant';
import { sendAppError } from '../errors/http';
import { authenticate, authorize, getAuthenticatedUser } from '../middleware/auth';
import { customerOrderDetailSelect, customerOrderListSelect } from '../services/order-selects';
import { emitNotification } from '../services/socket.service';
import { restoreStockForOrder } from '../services/stock.service';
import { getOrCreateRequestContext } from '../utils/request-context';
import { createOrderForCustomer, reserveCustomerCardCheckout } from '../services/order.service';
import { createMercadoPagoCardOrder, fetchMercadoPagoOrder, mapMercadoPagoDeclineReason, mercadoPagoChallengeUrl, mercadoPagoItemsFromSnapshot, searchMercadoPagoOrdersByReference, verifyMercadoPagoOrderSignature } from '../services/mercado-pago-orders';
import { attachCheckoutProviderOrder, claimCheckoutPaymentReconciliation, claimCheckoutPaymentSubmission, markCheckoutPaymentDeclined } from '../services/checkout-payment-intent';
import { settleVerifiedCheckoutPayment } from '../services/checkout-settlement.service';
import { sendPushNotification } from '../services/notification.service';
import { enqueueRestaurantOrder, requestOrderCancellation, retractCancellationRequest } from '../services/order-workflow.service';
import { decisionWindowMs } from '../services/order-ring.service';
import { enqueueCancellationRefunds } from '../services/order-cancellation-refunds';
import { getPromoLimitViolation } from '../services/order-promotion-policy';
import { isSandboxCardChargingEnabled } from '../services/checkout-sandbox-policy';
import { listMercadoPagoCards, type MercadoPagoSavedCard } from '../services/mercado-pago-customer';
import { resolveOwnedSavedCard } from '../services/saved-card-policy';
import { generateDeliveryPin } from '../services/delivery-pin';

const orderFields = z.object({
  restaurantId: z.literal(RESTAURANT_ID).default(RESTAURANT_ID),
  clientOrderKey: z.string().min(8, 'La clave de pedido es obligatoria.').max(64).refine(key => !key.startsWith('mp:'), 'Clave de pedido reservada.').optional(),
  scheduledDeliveryAt: z.string().datetime().optional(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1, 'El producto es obligatorio.'),
        quantity: z.number().int().positive('La cantidad debe ser mayor a cero.'),
        specialInstructions: z.string().max(300).nullish().transform(v => v ?? undefined),
        optionIds: z.array(z.string()).nullish().transform(v => v ?? undefined),
        sellBy: z.enum(['UNIT', 'WEIGHT']).default('UNIT'),
        weightG: z.number().int().positive().nullish().transform(v => v ?? undefined),
      })
    )
    .min(1, 'Debes enviar al menos un producto.'),
  fulfillmentType: z.enum(['DELIVERY', 'PICKUP']).default('DELIVERY'),
  deliveryAddress: z.object({
    street: z.string().min(1, 'La calle es obligatoria.'),
    number: z.string().min(1, 'El numero es obligatorio.'),
    apartment: z.string().nullish().transform(v => v ?? undefined),
    neighborhood: z.string().min(1, 'La colonia es obligatoria.'),
    city: z.string().min(1, 'La ciudad es obligatoria.'),
    state: z.string().min(1, 'El estado es obligatorio.'),
    zipCode: z.string().min(1, 'El codigo postal es obligatorio.'),
    country: z.string().min(1, 'El pais es obligatorio.'),
    reference: z.string().nullish().transform(v => v ?? undefined),
    latitude: z.number().or(z.string().transform(v => parseFloat(v))),
    longitude: z.number().or(z.string().transform(v => parseFloat(v))),
  }).optional(),
  currentLocation: z.object({
    latitude: z.number().or(z.string().transform(v => parseFloat(v))),
    longitude: z.number().or(z.string().transform(v => parseFloat(v))),
    accuracy: z.number().nonnegative().optional(),
    capturedAt: z.union([z.string(), z.number()]).optional(),
  }).optional(),
  paymentMethod: z.literal(PaymentMethod.CASH),
  notes: z.string().max(500).nullish().transform(v => v ?? undefined),
  locationVerified: z.boolean().optional().default(false),
  promoCode: z.string().max(30).trim().optional().transform(v => v?.toUpperCase() ?? undefined),
  loyalty: z.object({ cardId: z.string().uuid(), discountCents: z.number().int().min(0).max(100000000), expectedTotalCents: z.number().int().min(0).max(100000000) }).optional(),
});

function validateOrderAddress(data: Pick<z.output<typeof orderFields>, 'fulfillmentType' | 'deliveryAddress'>, context: z.RefinementCtx) {
  if (data.fulfillmentType === 'DELIVERY' && !data.deliveryAddress) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'La direccion de entrega es obligatoria para pedidos a domicilio.',
      path: ['deliveryAddress'],
    });
  }
}

const createOrderSchema = orderFields.superRefine(validateOrderAddress);
const cardReservationSchema = orderFields.omit({ paymentMethod: true, clientOrderKey: true, scheduledDeliveryAt: true }).extend({
  requestKey: z.string().uuid(),
  items: orderFields.shape.items.max(50),
}).strict().superRefine(validateOrderAddress);

function checkoutStatus(intent: { id: string; amountCents: number; state: string; expiresAt: Date; declineReason?: string | null }) {
  return {
    id: intent.id, amountCents: intent.amountCents, currency: 'MXN', state: intent.state,
    expiresAt: intent.expiresAt,
    ...(intent.declineReason ? { declineReason: intent.declineReason } : {}),
  };
}

const listMyOrdersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
});

export async function registerOrderRoutes(fastify: FastifyInstance): Promise<void> {
  const webhookSecret = process.env.WINGSLAB_MP_SANDBOX_WEBHOOK_SECRET;
  const sandboxAccessToken = process.env.WINGSLAB_MP_SANDBOX_ACCESS_TOKEN;
  const sandboxEnabled = process.env.WINGSLAB_CHECKOUT_SANDBOX_ROUTES === 'true' && process.env.WINGSLAB_CHECKOUT_RESERVATION_SWEEP === 'true';
  const sandboxChargesEnabled = isSandboxCardChargingEnabled(process.env);
  // Shared settlement: idempotent and used by the webhook, the charge response
  // and the background reconciliation sweep.
  const settleVerifiedIntent = (intentId: string, order: Awaited<ReturnType<typeof fetchMercadoPagoOrder>>, log: (message: string) => void) =>
    settleVerifiedCheckoutPayment(prisma, fastify.io, intentId, order, error => {
      log(`Pedido pagado ${intentId} pendiente de entrega a cocina: ${error instanceof Error ? error.message : 'error'}`);
    });

  if (sandboxEnabled && webhookSecret && sandboxAccessToken) {
    fastify.post('/webhooks/mercado-pago/orders', async (request, reply) => {
      const parsed = z.object({ 'data.id': z.string().max(64) }).safeParse(request.query);
      const signature = request.headers['x-signature'];
      const requestId = request.headers['x-request-id'];
      if (!parsed.success || typeof signature !== 'string' || typeof requestId !== 'string' ||
          !verifyMercadoPagoOrderSignature(parsed.data['data.id'], requestId, signature, webhookSecret)) {
        return reply.code(401).send({ success: false });
      }
      try {
        const order = await fetchMercadoPagoOrder(sandboxAccessToken, parsed.data['data.id']);
        if (order.id !== parsed.data['data.id']) return reply.code(503).send({ success: false });
        const reference = z.string().uuid().safeParse(order.external_reference);
        if (!reference.success) return reply.code(204).send();
        await settleVerifiedIntent(reference.data, order, (message) => request.log.error({ orderId: reference.data }, message));
        return reply.code(204).send();
      } catch {
        request.log.error('No se pudo procesar el webhook de Mercado Pago');
        return reply.code(503).send({ success: false });
      }
    });
  }
  fastify.register(async function customerScope(customer) {
    customer.addHook('preHandler', authenticate);
    customer.addHook('preHandler', authorize([UserRole.CUSTOMER]));

    // Internal sandbox surface. Does not accept card tokens or submit charges.
    if (process.env.WINGSLAB_CHECKOUT_SANDBOX_ROUTES === 'true' && process.env.WINGSLAB_CHECKOUT_RESERVATION_SWEEP === 'true') {
      customer.post('/me/checkout/card/intents', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        const parsed = cardReservationSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ success: false, error: { code: 'INVALID_CHECKOUT', message: 'Revisa los datos del carrito.' } });
        const { requestKey, ...input } = parsed.data;
        // Tarjeta no exige GPS: la ubicación solo es obligatoria para efectivo.
        try {
          const intent = await reserveCustomerCardCheckout({ prisma, customerUserId: getAuthenticatedUser(request).sub, input: { ...input, paymentMethod: PaymentMethod.CREDIT_CARD } }, requestKey);
          return reply.send({ success: true, data: checkoutStatus(intent) });
        } catch (error) { return sendAppError(reply, error); }
      });

      customer.get('/me/checkout/card/intents/:id', async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        const parsed = z.object({ id: z.string().uuid() }).safeParse(request.params);
        const notFound = () => reply.code(404).send({ success: false, error: { code: 'CHECKOUT_NOT_FOUND', message: 'Intento de pago no encontrado.' } });
        if (!parsed.success) return notFound();
        const profile = await prisma.customer.findUnique({ where: { userId: getAuthenticatedUser(request).sub }, select: { id: true } });
        if (!profile) return notFound();
        const intent = await prisma.checkoutPaymentIntent.findFirst({
          where: { id: parsed.data.id, customerId: profile.id, restaurantId: RESTAURANT_ID },
          select: { id: true, amountCents: true, state: true, expiresAt: true, providerOrderId: true, declineReason: true },
        });
        if (!intent) return notFound();
        if (sandboxAccessToken && await claimCheckoutPaymentReconciliation(prisma, intent.id)) {
          try {
            const candidates = intent.providerOrderId
              ? [await fetchMercadoPagoOrder(sandboxAccessToken, intent.providerOrderId)]
              : await searchMercadoPagoOrdersByReference(sandboxAccessToken, intent.id);
            // Never guess when the provider returns ambiguous results. Keep inventory reserved.
            if (candidates.length === 1) {
              const order = candidates[0];
              if (order.external_reference === intent.id) {
                if (!intent.providerOrderId) await attachCheckoutProviderOrder(prisma, intent.id, order.id);
                if (await settleVerifiedIntent(intent.id, order, message => request.log.error({ intentId: intent.id }, message))) {
                  return reply.send({ success: true, data: { ...checkoutStatus(intent), state: 'VERIFIED' } });
                }
                if (order.status === 'failed' || order.status === 'canceled') {
                  const reason = mapMercadoPagoDeclineReason(order);
                  await markCheckoutPaymentDeclined(prisma, intent.id, order.id, reason);
                  return reply.send({ success: true, data: { ...checkoutStatus(intent), state: 'DECLINED', declineReason: reason } });
                }
                 const threeDsUrl = mercadoPagoChallengeUrl(order);
                return reply.send({ success: true, data: { ...checkoutStatus(intent), state: 'PENDING', threeDsUrl } });
              }
            }
          } catch {
            request.log.error({ intentId: intent.id }, 'No se pudo conciliar el intento de pago');
          }
        }
        return reply.send({ success: true, data: { ...checkoutStatus(intent), state: intent.state === 'SUBMITTING' ? 'PENDING' : intent.state } });
      });

      // The browser sends only a provider-generated token: no PAN or CVV reaches WingsLab.
      customer.post('/me/checkout/card/intents/:id/charge', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        if (!sandboxChargesEnabled || !sandboxAccessToken) return reply.code(503).send({ success: false, error: { code: 'CHECKOUT_DISABLED', message: 'El pago con tarjeta no está habilitado en este entorno.' } });
        const token = sandboxAccessToken;
        const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
        const body = z.object({
          cardToken: z.string().min(8).max(512),
          savedCardId: z.string().min(1).max(128).optional(),
          deviceId: z.string().regex(/^[\x21-\x7E]{1,512}$/).optional(),
          payerEmail: z.string().email().max(254).optional(),
          identificationType: z.string().min(1).max(20).optional(),
          identificationNumber: z.string().min(3).max(32).optional(),
          paymentMethodId: z.string().regex(/^[a-z0-9_]{1,40}$/).optional(),
          cardType: z.enum(['credit_card', 'debit_card']).optional(),
          issuerId: z.string().max(32).optional(),
          installments: z.literal(1),
        }).strict().refine(data => Boolean(data.identificationType) === Boolean(data.identificationNumber))
          .refine(data => data.savedCardId
            ? !data.payerEmail && !data.paymentMethodId && !data.cardType && !data.issuerId && !data.identificationType
            : Boolean(data.payerEmail && data.paymentMethodId && data.cardType),
          'Los datos de tarjeta nueva y guardada no se pueden mezclar.').safeParse(request.body);
        if (!params.success || !body.success) return reply.code(400).send({ success: false, error: { code: 'INVALID_CHARGING_DATA', message: 'Datos de pago inválidos.' } });

        const profile = await prisma.customer.findUnique({ where: { userId: getAuthenticatedUser(request).sub }, select: { id: true, mercadoPagoCustomerId: true, user: { select: { name: true, lastName: true } } } });
        if (!profile) return reply.code(404).send({ success: false, error: { code: 'CHECKOUT_NOT_FOUND', message: 'Intento de pago no encontrado.' } });
        const where = { id: params.data.id, customerId: profile.id, restaurantId: RESTAURANT_ID };
        const intent = await prisma.checkoutPaymentIntent.findFirst({
          where: { ...where, OR: [{ state: 'RESERVED', expiresAt: { gt: new Date() } }, { state: 'SUBMITTING' }] },
          select: { id: true, amountCents: true, state: true, expiresAt: true, providerOrderId: true, snapshot: true },
        });
        if (!intent) return reply.code(409).send({ success: false, error: { code: 'CHECKOUT_NOT_AVAILABLE', message: 'El intento venció o ya se procesó.' } });

        // Re-check the opt-in at charge time: the restaurant may have disabled
        // card payments after the reservation was created.
        const restaurant = await prisma.restaurant.findUnique({ where: { id: RESTAURANT_ID }, select: { acceptsCard: true } });
        if (!restaurant?.acceptsCard) {
          return reply.code(409).send({ success: false, error: { code: 'CARD_NOT_ACCEPTED', message: 'Este restaurante ya no acepta pagos con tarjeta.' } });
        }

        try {
          if (intent.state === 'SUBMITTING' && intent.providerOrderId) {
            const existing = await fetchMercadoPagoOrder(token, intent.providerOrderId);
            if (await settleVerifiedIntent(intent.id, existing, (message) => request.log.error({ intentId: intent.id }, message))) {
              return reply.send({ success: true, data: { ...checkoutStatus(intent), state: 'VERIFIED' } });
            }
            if (existing.status === 'failed' || existing.status === 'canceled') {
              const reason = mapMercadoPagoDeclineReason(existing);
              await markCheckoutPaymentDeclined(prisma, intent.id, existing.id, reason);
              return reply.send({ success: true, data: { ...checkoutStatus(intent), state: 'DECLINED', declineReason: reason } });
            }
             return reply.send({ success: true, data: { ...checkoutStatus(intent), state: 'PENDING', threeDsUrl: mercadoPagoChallengeUrl(existing) } });
          }
          let savedCard: MercadoPagoSavedCard | undefined;
          if (body.data.savedCardId) {
            if (!profile.mercadoPagoCustomerId) {
              return reply.code(404).send({ success: false, error: { code: 'SAVED_CARD_NOT_FOUND', message: 'Esa tarjeta ya no está disponible. Elige otra forma de pago.' } });
            }
            const cards = await listMercadoPagoCards(token, profile.mercadoPagoCustomerId);
            savedCard = resolveOwnedSavedCard(cards, body.data.savedCardId) ?? undefined;
            if (!savedCard) {
              return reply.code(404).send({ success: false, error: { code: 'SAVED_CARD_NOT_FOUND', message: 'Esa tarjeta ya no está disponible. Elige otra forma de pago.' } });
            }
          }
          if (!await claimCheckoutPaymentSubmission(prisma, intent.id, profile.id)) {
            return reply.code(409).send({ success: false, error: { code: 'CHECKOUT_BUSY', message: 'El pago se está procesando.' } });
          }
          let providerOrder;
          try {
            providerOrder = await createMercadoPagoCardOrder(token, {
              intentId: intent.id, idempotencyKey: intent.id, amountCents: intent.amountCents,
                ...(savedCard
                  ? { payerCustomerId: profile.mercadoPagoCustomerId!, methodId: savedCard.payment_method.id,
                    cardType: savedCard.payment_method.payment_type_id, issuerId: savedCard.issuer?.id ? String(savedCard.issuer.id) : undefined }
                  : { payerEmail: body.data.payerEmail!, methodId: body.data.paymentMethodId!, cardType: body.data.cardType! }),
                ...(!savedCard ? {
                  identificationType: body.data.identificationType,
                  identificationNumber: body.data.identificationNumber,
                  payerFirstName: profile.user.name.trim().slice(0, 100).trim() || undefined,
                  payerLastName: profile.user.lastName?.trim().slice(0, 100).trim() || undefined,
                } : {}),
                platformId: process.env.WINGSLAB_MP_SANDBOX_PLATFORM_ID || undefined,
                cardToken: body.data.cardToken,
                deviceId: body.data.deviceId,
               ...(!savedCard && body.data.issuerId ? { issuerId: body.data.issuerId } : {}),
               installments: body.data.installments,
               items: mercadoPagoItemsFromSnapshot(intent.snapshot, intent.amountCents),
               requireThreeDs: true,
            });
          } catch (error) {
            // A timeout or malformed response can follow a successful charge.
            // Keep SUBMITTING and its stock until reconciliation confirms the outcome.
            request.log.error({ intentId: intent.id }, 'Resultado del cobro desconocido; requiere conciliación');
            return reply.code(503).send({ success: false, error: { code: 'PAYMENT_OUTCOME_UNKNOWN', message: 'Estamos verificando el pago. No vuelvas a pagar hasta confirmar su estado.' } });
          }
          await attachCheckoutProviderOrder(prisma, intent.id, providerOrder.id);
          if (await settleVerifiedIntent(intent.id, providerOrder, (message) => request.log.error({ intentId: intent.id }, message))) {
            return reply.send({ success: true, data: { ...checkoutStatus(intent), state: 'VERIFIED' } });
          }
           const threeDsUrl = mercadoPagoChallengeUrl(providerOrder);
          const terminalFailure = providerOrder.status === 'failed' || providerOrder.status === 'canceled';
          const declineReason = terminalFailure ? mapMercadoPagoDeclineReason(providerOrder) : undefined;
          if (terminalFailure && declineReason) await markCheckoutPaymentDeclined(prisma, intent.id, providerOrder.id, declineReason);
          return reply.send({ success: true, data: { ...checkoutStatus(intent), state: terminalFailure ? 'DECLINED' : 'PENDING', threeDsUrl, ...(declineReason ? { declineReason } : {}) } });
        } catch (error) {
          return sendAppError(reply, error);
        }
      });
    }

    customer.post('/pedidos/validar-cupon', {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
        },
      },
    }, async (request, reply) => {
      const validateCouponSchema = z.object({
        restaurantId: z.literal(RESTAURANT_ID).default(RESTAURANT_ID),
        promoCode: z.string().max(30).trim().transform(v => v.toUpperCase()),
        subtotal: z.number().nonnegative(),
        isPickup: z.boolean().optional().default(false),
        deliveryFee: z.number().nonnegative().optional().default(0),
      });

      const parsed = validateCouponSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: parsed.error.issues[0]?.message || 'Datos invalidos.',
          },
        });
      }

      const { restaurantId, promoCode, subtotal, isPickup, deliveryFee } = parsed.data;

      const restaurant = await prisma.restaurant.findUnique({ where: { id: RESTAURANT_ID } });
      if (!restaurant) {
        return reply.status(404).send({
          success: false,
          error: { code: 'RESTAURANT_NOT_FOUND', message: 'El restaurante no existe.' },
        });
      }

      const promo = await prisma.promoCode.findFirst({
        where: {
          restaurantId: restaurant.id,
          code: { equals: promoCode, mode: 'insensitive' },
          isActive: true,
          AND: [
            { OR: [{ validFrom: null }, { validFrom: { lte: new Date() } }] },
            { OR: [{ validUntil: null }, { validUntil: { gte: new Date() } }] },
          ],
        },
      });

      if (!promo) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_PROMO_CODE', message: 'El código promocional no es válido.' },
        });
      }
      if (promo.maxUses != null && promo.usesCount >= promo.maxUses) {
        return reply.status(400).send({
          success: false,
          error: { code: 'PROMO_CODE_EXHAUSTED', message: 'Este código promocional se ha agotado (límite de usos alcanzado).' },
        });
      }
      if (promo.minOrderAmount != null && subtotal < promo.minOrderAmount) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'PROMO_CODE_MIN_ORDER',
            message: `Este código aplica a partir de $${promo.minOrderAmount.toFixed(2)} de compra.`,
          },
        });
      }

      const user = getAuthenticatedUser(request);
      const customer = await prisma.customer.findUnique({ where: { userId: user.sub }, select: { id: true } });
      if (!customer) return reply.status(404).send({ success: false, error: { code: 'CUSTOMER_NOT_FOUND', message: 'No se encontró la cuenta de cliente.' } });
      const [customerUseCount, previousPurchaseCount] = await Promise.all([
        promo.maxUsesPerCustomer == null ? Promise.resolve(0) : prisma.order.count({ where: { restaurantId: restaurant.id, customerId: customer.id, promoCode: { equals: promo.code, mode: 'insensitive' } } }),
        !promo.firstPurchaseOnly ? Promise.resolve(0) : prisma.order.count({ where: { restaurantId: restaurant.id, customerId: customer.id, status: { notIn: [OrderStatus.CANCELLED, OrderStatus.REJECTED] } } }),
      ]);
      const violation = getPromoLimitViolation({ firstPurchaseOnly: promo.firstPurchaseOnly, previousPurchaseCount,
        maxUsesPerCustomer: promo.maxUsesPerCustomer, customerUseCount });
      if (violation === 'FIRST_PURCHASE_ONLY') return reply.status(400).send({ success: false, error: { code: violation, message: 'Este cupón es exclusivo para la primera compra en WingsLab.' } });
      if (violation === 'PROMO_CODE_CUSTOMER_LIMIT') return reply.status(400).send({ success: false, error: { code: violation, message: 'Ya alcanzaste el límite de uso de este cupón.' } });

      let discount = 0;
      let gift: { id: string; name: string } | null = null;
      if (promo.type === 'PERCENT') {
        discount = Math.round((subtotal * promo.value) / 100 * 100) / 100;
      } else if (promo.type === 'AMOUNT') {
        discount = Math.min(promo.value, subtotal);
      } else if (promo.type === 'FREE_DELIVERY') {
        discount = isPickup ? 0 : deliveryFee;
      } else if (promo.type === 'FREE_PRODUCT') {
        const product = await prisma.product.findFirst({
          where: { id: promo.giftProductId ?? '', restaurantId: restaurant.id, isAvailable: true, deleted: false, sellBy: 'UNIT', isAdultOnly: false },
          select: { id: true, name: true, trackStock: true, stock: true, optionGroups: { select: { minSelection: true } } },
        });
        if (!product || product.optionGroups.some(g => g.minSelection > 0)) {
          return reply.status(400).send({ success: false, error: { code: 'PROMO_GIFT_UNAVAILABLE', message: 'El producto de regalo no está disponible en este momento.' } });
        }
        gift = { id: product.id, name: product.name };
      }

      return reply.status(200).send({
        success: true,
        data: {
          code: promo.code,
          type: promo.type,
          value: promo.value,
          description: promo.description,
          minOrderAmount: promo.minOrderAmount,
          discount: discount,
          gift,
        },
      });
    });

    customer.post('/pedidos', {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
    }, async (request, reply) => {
      const parsed = createOrderSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: parsed.error.issues[0]?.message || 'Datos invalidos.',
          },
        });
      }

      // Optional enforcement: require client to mark requests as location-verified
      const requireVerified = String(process.env.REQUIRE_LOCATION_VERIFIED || '').toLowerCase() === 'true' || process.env.REQUIRE_LOCATION_VERIFIED === '1';
      if (requireVerified) {
        const verified = String(request.headers['x-location-verified'] || '') === '1' || String(request.headers['x-location-verified'] || '').toLowerCase() === 'true';
        if (!verified) {
          return reply.status(403).send({
            success: false,
            error: { code: 'LOCATION_PERMISSION_REQUIRED', message: 'Se requiere que el cliente confirme acceso a la ubicación para crear pedidos.' },
          });
        }
      }

      const user = getAuthenticatedUser(request);
      const requestContext = getOrCreateRequestContext(request);


      try {
        const { order, isDuplicate } = await createOrderForCustomer({
          prisma,
          customerUserId: user.sub,
          input: parsed.data as any,
          requestHeaders: request.headers,
        });

        // Pedido duplicado (reintento del cliente): no se vuelve a notificar al restaurante.
        if (isDuplicate) {
          return reply.status(200).send({
            success: true,
            data: order,
            isDuplicate: true,
          });
        }

        const isCustomerScheduled = Boolean(order.scheduledDeliveryAt);
        const queueInfo = isCustomerScheduled ? null : await enqueueRestaurantOrder(order.restaurant.id, order.id, order.createdAt).catch(error => {
          request.log.error({ err: error, orderId: order.id }, 'Pedido guardado; no se pudo actualizar la cola');
          return null;
        });

        if (!isCustomerScheduled) emitNotification(
          fastify.io,
          order.restaurant.userId,
          'RESTAURANT',
          'order:created',
          {
            orderId: order.id,
            orderReference: order.orderReference,
            totalAmount: order.totalAmount,
            paymentMethod: order.paymentMethod,
            customerName: [order.customer?.user?.name, order.customer?.user?.lastName]
              .filter(Boolean)
              .join(' ')
              .trim() || 'Cliente SaDeL',
            queuePosition: queueInfo?.position,
            queueLength: queueInfo?.queueLength,
          },
          {
            requestId: requestContext.requestId,
            orderId: order.id,
          }
        );

        // Send Push Notification to Restaurant
        const restaurantEarnings = order.subtotal + ((order.restaurant as any)?.hasOwnDelivery ? order.deliveryFee : 0);
        // Solo el pedido que está al frente de la cola tiene la ventana de
        // decisión corriendo; ese es el que debe sonar de forma continua en la
        // app nativa. Los siguientes suenan como aviso normal (un toque) hasta
        // que el primero se resuelva y pasen a ser el activo.
        const isQueueHead = queueInfo !== null && queueInfo.position <= 1;
        if (!isCustomerScheduled) void sendPushNotification(order.restaurant.userId, {
          title: '¡Nuevo Pedido Recibido!',
          body: `Pedido ${order.orderReference} — Ingreso: $${restaurantEarnings.toFixed(2)}.`,
          icon: '/app-icon-192.png',
          badge: '/badge.png',
          vibrate: [500, 200, 500, 200, 500],
          requireInteraction: true,
          sound: '/sounds/notifica.wav',
          nativeRing: isQueueHead,
          nativeRingExpiresAt: isQueueHead
            ? order.createdAt.getTime() +
              decisionWindowMs(order.paymentMethod, (order.restaurant as any)?.businessType)
            : undefined,
          data: {
            orderId: order.id,
            orderReference: order.orderReference,
            event: 'order:created',
            url: `/?orderId=${order.id}`,
          },
          tag: `new-order-${order.id}`,
        }).catch((err) => {
          request.log.error('Error sending push for new order', err);
        });

        return reply.status(201).send({
          success: true,
          data: order,
          isDuplicate: false,
        });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    customer.get('/me/pedidos', async (request, reply) => {
      const parsed = listMyOrdersQuerySchema.safeParse(request.query);

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_QUERY',
            message: parsed.error.issues[0]?.message || 'Query invalida.',
          },
        });
      }

      const user = getAuthenticatedUser(request);
      const customerProfile = await prisma.customer.findUnique({
        where: { userId: user.sub },
      });

      if (!customerProfile) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'CUSTOMER_NOT_FOUND',
            message: 'No se encontro el perfil del cliente.',
          },
        });
      }

      const { page, limit } = parsed.data;
      const [items, total] = await prisma.$transaction([
        prisma.order.findMany({
          where: { customerId: customerProfile.id, restaurantId: RESTAURANT_ID },
          select: customerOrderListSelect,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.order.count({
          where: { customerId: customerProfile.id, restaurantId: RESTAURANT_ID },
        }),
      ]);

      return reply.send({
        success: true,
        data: {
          items,
          total,
          page,
          limit,
          hasMore: page * limit < total,
        },
      });
    });

    customer.get('/me/pedidos/:id', async (request, reply) => {
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

      const user = getAuthenticatedUser(request);
      const customerProfile = await prisma.customer.findUnique({
        where: { userId: user.sub },
      });

      if (!customerProfile) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'CUSTOMER_NOT_FOUND',
            message: 'No se encontro el perfil del cliente.',
          },
        });
      }

      // Repair active legacy paid deliveries that were marked READY before
      // card orders began receiving a PIN. The owner and status are scoped in
      // the write, and concurrent requests cannot overwrite an existing PIN.
      const legacyOrder = await prisma.order.findFirst({
        where: {
          id: params.data.id,
          customerId: customerProfile.id,
          fulfillmentType: 'DELIVERY',
          paymentMethod: { not: PaymentMethod.CASH },
          status: { in: [OrderStatus.READY, OrderStatus.PICKED_UP, OrderStatus.IN_TRANSIT] },
          deliveryPin: null,
        },
        select: { id: true, handoverPin: true },
      });
      if (legacyOrder) {
        await prisma.order.updateMany({
          where: { id: legacyOrder.id, customerId: customerProfile.id, deliveryPin: null, status: { in: [OrderStatus.READY, OrderStatus.PICKED_UP, OrderStatus.IN_TRANSIT] } },
          data: { deliveryPin: legacyOrder.handoverPin || generateDeliveryPin() },
        });
      }

      const order = await prisma.order.findFirst({
        where: {
          id: params.data.id,
          customerId: customerProfile.id,
        },
        select: customerOrderDetailSelect,
      });

      if (!order) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'ORDER_NOT_FOUND',
            message: 'No se encontro el pedido.',
          },
        });
      }

      // Verificar si el repartidor tiene otros pedidos activos y este es el segundo
      let isSecondInRoute = false;
      if (order.driverId) {
        const otherActiveOrders = await prisma.order.findMany({
          where: {
            driverId: order.driverId,
            id: { not: order.id },
            status: { in: [OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.READY, OrderStatus.PICKED_UP, OrderStatus.IN_TRANSIT] },
          },
        });

        // Caso 1: Este pedido esta en 'PICKED_UP' (recolectado) pero hay otro en 'IN_TRANSIT' (en camino)
        // Significa que el repartidor decidio llevar el otro primero.
        if (order.status === OrderStatus.PICKED_UP && otherActiveOrders.some(o => o.status === OrderStatus.IN_TRANSIT)) {
          isSecondInRoute = true;
        }

        // Caso 2: Ambos estan en el mismo estado (ej. ambos 'PICKED_UP' o ambos 'READY').
        // En este caso, asumimos que el mas antiguo se entrega primero, por lo que el mas nuevo es el segundo.
        const sameStatusOrders = otherActiveOrders.filter(o => o.status === order.status);
        if (sameStatusOrders.length > 0) {
          const oldestOrder = await prisma.order.findFirst({
            where: {
              driverId: order.driverId,
              status: order.status,
            },
            orderBy: { createdAt: 'asc' },
          });

          if (oldestOrder && oldestOrder.id !== order.id) {
            isSecondInRoute = true;
          }
        }
      }

      return reply.send({
        success: true,
        data: {
          ...order,
          isSecondInRoute,
        },
      });
    });

    // ── Customer Cancellation Request ──
    const cancellationRequestSchema = z.object({
      reason: z.string().max(500).optional(),
    }).optional().default({});

    customer.post('/pedidos/:id/solicitar-cancelacion', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_PARAMS', message: 'ID de pedido inválido.' } });
      }

      const parsed = cancellationRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_PAYLOAD', message: parsed.error.issues[0]?.message || 'Datos inválidos.' } });
      }

      const user = getAuthenticatedUser(request);
      const requestContext = getOrCreateRequestContext(request);

      try {
        const { restaurantUserId } = await requestOrderCancellation(prisma, params.data.id, user.sub, parsed.data.reason);

        emitNotification(
          fastify.io,
          restaurantUserId,
          'RESTAURANT',
          'order:cancellation-requested',
          {
            orderId: params.data.id,
            reason: parsed.data.reason || null,
          },
          {
            requestId: requestContext.requestId,
            orderId: params.data.id,
          }
        );

        return reply.send({ success: true, data: { message: 'Solicitud de cancelación enviada al restaurante.' } });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    customer.post('/pedidos/:id/cancelar-solicitud', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_PARAMS', message: 'ID de pedido inválido.' } });
      }

      const user = getAuthenticatedUser(request);
      const requestContext = getOrCreateRequestContext(request);

      try {
        const order = await prisma.order.findFirst({
          where: { id: params.data.id, customer: { userId: user.sub } },
          include: { restaurant: { select: { userId: true } } },
        });

        if (!order || !order.cancellationRequestedAt) {
          return reply.status(404).send({ success: false, error: { code: 'NO_CANCELLATION_REQUEST', message: 'No hay una solicitud activa.' } });
        }

        await retractCancellationRequest(prisma, params.data.id, user.sub);

        emitNotification(
          fastify.io,
          order.restaurant.userId,
          'RESTAURANT',
          'order:cancellation-request-retracted',
          {
            orderId: params.data.id,
          },
          {
            requestId: requestContext.requestId,
            orderId: params.data.id,
          }
        );

        return reply.send({ success: true, data: { message: 'Solicitud de cancelación retirada.' } });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    // ── Customer accepts scheduled delivery proposal ──
    customer.post('/pedidos/:id/confirmar-programacion', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_PARAMS', message: 'ID de pedido inválido.' } });
      }

      const user = getAuthenticatedUser(request);
      const requestContext = getOrCreateRequestContext(request);

      try {
        const order = await prisma.order.findFirst({
          where: {
            id: params.data.id,
            customer: { userId: user.sub },
            status: OrderStatus.CONFIRMED,
            scheduledDeliveryAt: { not: null },
            scheduledDeliveryCustomerAcceptedAt: null,
          },
          select: {
            id: true,
            orderReference: true,
            scheduledDeliveryAt: true,
            restaurant: {
              select: {
                id: true,
                userId: true,
                name: true,
                businessType: true,
                hasOwnDelivery: true,
              },
            },
            customer: {
              select: {
                user: {
                  select: { id: true, name: true },
                },
              },
            },
            fulfillmentType: true,
          },
        });

        if (!order) {
          return reply.status(404).send({
            success: false,
            error: { code: 'ORDER_NOT_FOUND', message: 'No se encontró el pedido o no está pendiente de confirmación de entrega.' },
          });
        }

        const now = new Date();
        await prisma.$transaction(async (tx) => {
          await tx.order.update({
            where: { id: order.id },
            data: {
              scheduledDeliveryCustomerAcceptedAt: now,
              preparationStartedAt: now,
            },
          });
          await tx.orderTracking.create({
            data: {
              orderId: order.id,
              status: OrderStatus.CONFIRMED,
              notes: 'El cliente aceptó la fecha de entrega programada. La preparación ha comenzado.',
            },
          });
        });

        // Notify restaurant via socket
        emitNotification(
          fastify.io,
          order.restaurant.userId,
          'RESTAURANT',
          'order:schedule-accepted',
          {
            orderId: order.id,
            message: 'El cliente aceptó la fecha de entrega programada.',
          },
          {
            requestId: requestContext.requestId,
            orderId: order.id,
          }
        );

        // Send push confirmation to customer
        try {
          const businessType = order.restaurant.businessType;
          const ref = businessType === 'RESTAURANT' ? 'el restaurante' : 'la tienda';
          const formattedDate = order.scheduledDeliveryAt
            ? new Date(order.scheduledDeliveryAt).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })
            : '';
          const formattedTime = order.scheduledDeliveryAt
            ? new Date(order.scheduledDeliveryAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
            : '';
          await sendPushNotification(order.customer.user.id, {
            title: '¡Fecha confirmada! ✅',
            body: `Tu pedido llegará el ${formattedDate} a las ${formattedTime}. ${ref} ya está preparándolo.`,
            icon: '/app-icon-192.png',
            badge: '/badge.png',
            vibrate: [300, 100, 300],
            requireInteraction: false,
            tag: `schedule-accepted-${order.id}`,
            data: {
              orderId: order.id,
              event: 'order:schedule-accepted',
              url: `/?orderId=${order.id}`,
            },
          });
        } catch (pushErr) {
          request.log.error(pushErr as any, `[Push] Error al enviar notificacion de confirmacion al comensal ${order.customer.user.id}`);
        }

        return reply.send({
          success: true,
          data: {
            message: 'Fecha de entrega confirmada. Tu pedido ya está en preparación.',
          },
        });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });

    // ── Customer rejects scheduled delivery proposal → cancels order ──
    customer.post('/pedidos/:id/rechazar-programacion', async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({ success: false, error: { code: 'INVALID_PARAMS', message: 'ID de pedido inválido.' } });
      }

      const user = getAuthenticatedUser(request);
      const requestContext = getOrCreateRequestContext(request);

      try {
        const order = await prisma.order.findFirst({
          where: {
            id: params.data.id,
            customer: { userId: user.sub },
            status: OrderStatus.CONFIRMED,
            scheduledDeliveryAt: { not: null },
            scheduledDeliveryCustomerAcceptedAt: null,
          },
          select: {
            id: true,
            orderReference: true,
            clientOrderKey: true,
            paymentMethod: true,
            paymentStatus: true,
            restaurant: {
              select: {
                id: true,
                userId: true,
                name: true,
                businessType: true,
              },
            },
            customer: {
              select: {
                user: { select: { id: true, name: true } },
              },
            },
          },
        });

        if (!order) {
          return reply.status(404).send({
            success: false,
            error: { code: 'ORDER_NOT_FOUND', message: 'No se encontró el pedido o no está pendiente de confirmación de entrega.' },
          });
        }

        const cancellationReason = 'El cliente no aceptó la fecha de entrega programada.';

        const cancelled = await prisma.$transaction(async tx => {
        const claim = await tx.order.updateMany({
          where: { id: order.id, customer: { userId: user.sub }, status: OrderStatus.CONFIRMED, scheduledDeliveryAt: { not: null }, scheduledDeliveryCustomerAcceptedAt: null },
          data: {
            status: OrderStatus.CANCELLED,
            cancellationReason,
            cancelledBy: 'CUSTOMER',
          },
        });
        if (!claim.count) return false;

        await tx.orderTracking.create({
          data: {
            orderId: order.id,
            status: OrderStatus.CANCELLED,
            notes: cancellationReason,
          },
        });

        await enqueueCancellationRefunds(tx, order, cancellationReason);

        // Liberar el stock reservado al cancelar (productos trackeados por unidad).
        await restoreStockForOrder(tx, order.id);
        return true;
        });
        if (!cancelled) return reply.status(409).send({ success: false, error: { code: 'ORDER_STATE_CHANGED', message: 'El pedido ya cambió de estado.' } });

        // Notify restaurant via socket
        emitNotification(
          fastify.io,
          order.restaurant.userId,
          'RESTAURANT',
          'order:schedule-rejected',
          {
            orderId: order.id,
            message: 'El cliente no aceptó la fecha de entrega programada. El pedido ha sido cancelado.',
          },
          {
            requestId: requestContext.requestId,
            orderId: order.id,
          }
        );

        // Push to customer
        try {
          await sendPushNotification(order.customer.user.id, {
            title: 'Pedido cancelado ❌',
            body: 'Cancelaste el pedido porque no aceptaste la fecha de entrega programada.',
            icon: '/app-icon-192.png',
            badge: '/badge.png',
            vibrate: [300, 100, 300],
            requireInteraction: false,
            data: {
              orderId: order.id,
              event: 'order:schedule-rejected',
              url: `/?orderId=${order.id}`,
            },
          });
        } catch (pushErr) {
          request.log.error(pushErr as any, `[Push] Error al enviar notificacion de cancelacion al comensal ${order.customer.user.id}`);
        }

        return reply.send({
          success: true,
          data: {
            message: order.paymentMethod === PaymentMethod.CREDIT_CARD ? 'Pedido cancelado. El reembolso está pendiente de confirmación.' : 'Pedido cancelado.',
          },
        });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });
  });
}
