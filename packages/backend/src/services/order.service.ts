import { OrderStatus, PaymentMethod, PaymentStatus, Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../errors/app-error';
import { assertRestaurantId, RESTAURANT_ID } from '../config/single-restaurant';
import { ORDER_DECISION_ELIGIBLE } from './order-decision-window';

export function validateOptionSelection(groups: Array<{ id: string; name: string; minSelection: number; maxSelection: number; options: Array<{ id: string; isAvailable: boolean }> }>, selectedIds: string[]) {
  if (new Set(selectedIds).size !== selectedIds.length) throw new AppError(400, 'INVALID_OPTION_SELECTION', 'No puedes seleccionar una misma opción más de una vez.');
  const all = new Set(groups.flatMap(g => g.options.map(o => o.id)));
  if (selectedIds.some(id => !all.has(id))) throw new AppError(400, 'INVALID_OPTION_SELECTION', 'Una o más opciones no corresponden a este producto.');
  for (const group of groups) {
    const ids = new Set(group.options.map(o => o.id));
    const selected = selectedIds.filter(id => ids.has(id));
    if (selected.length < group.minSelection || selected.length > group.maxSelection) throw new AppError(400, 'INVALID_OPTION_SELECTION', `Revisa la selección para "${group.name}".`);
    if (selected.some(id => !group.options.find(option => option.id === id)?.isAvailable)) throw new AppError(400, 'OPTION_NOT_AVAILABLE', `Una opción de "${group.name}" ya no está disponible.`);
  }
  return true;
}
import { customerCreatedOrderSelect } from './order-selects';
import { isRestaurantOpenNow } from '../utils/restaurant';
import { getDistanceInKm } from '../utils/restaurant';
import { calculateDistanceDeliveryFee } from '../utils/delivery-pricing';
import { resolveMaxCashOrder } from '../utils/cash-policy';
import { logger } from '../utils/logger';
import { buildApartmentWhere } from '../utils/address';
import { calculateOrderEta } from '../utils/order-eta';
import { getPromoLimitViolation } from './order-promotion-policy';
import { loyaltyQuote, reserveRuntimeReward, moneyCents } from './loyalty-runtime.service';
import { expireReservedCheckoutPaymentInTransaction, reserveCheckoutPaymentInTransaction } from './checkout-payment-intent';
import { checkoutRequestFingerprint } from './checkout-request-fingerprint';
import { z } from 'zod';


type OrderInput = {
  restaurantId: string;
  clientOrderKey?: string;
  scheduledDeliveryAt?: string;
  items: Array<{
    productId: string;
    quantity: number;
    specialInstructions?: string;
    optionIds?: string[];
    weightG?: number;
  }>;
  fulfillmentType?: 'DELIVERY' | 'PICKUP';
  deliveryAddress?: {
    street: string;
    number: string;
    apartment?: string;
    neighborhood: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
    reference?: string;
    latitude: number;
    longitude: number;
  };
  currentLocation?: {
    latitude: number;
    longitude: number;
    accuracy?: number;
    capturedAt?: string | number;
  };
  paymentMethod: PaymentMethod;
  paymentProofUrl?: string;
  notes?: string;
  locationVerified?: boolean;
  promoCode?: string;
  loyalty?: { cardId: string; discountCents: number; expectedTotalCents: number };
};

type CreateOrderParams = {
  prisma: PrismaClient;
  customerUserId: string;
  input: OrderInput;
};

function isMissingPaymentProofColumnError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const column = String(error.meta?.column || '');
    return error.code === 'P2022' && column.includes('paymentProofUrl');
  }

  return error instanceof Error && error.message.includes('paymentProofUrl');
}

function generateOrderReference(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();

  return `SAD-${timestamp}-${random}`;
}

function getPositiveNumberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function isLocationCapturedRecently(capturedAt?: string | number): boolean {
  if (!capturedAt) return false;

  const timestamp = typeof capturedAt === 'number' ? capturedAt : Date.parse(capturedAt);
  if (!Number.isFinite(timestamp)) return false;

  const maxAgeMs = getPositiveNumberEnv('ORDER_LOCATION_MAX_AGE_MINUTES', 10) * 60 * 1000;
  return Date.now() - timestamp <= maxAgeMs;
}

function validateCustomerLocation(input: OrderInput, customerUserId: string) {
  const requireLocation =
    String(process.env.REQUIRE_CUSTOMER_LOCATION_FOR_ORDERS || 'true').toLowerCase() !== 'false';
  if (!requireLocation) return;

  // Si el frontend indica que la ubicación NO está verificada (dirección manual, no GPS),
  // bloqueamos pago en efectivo aunque haya coordenadas.
  if (!input.locationVerified && input.paymentMethod === PaymentMethod.CASH) {
    throw new AppError(
      400,
      'LOCATION_NOT_VERIFIED',
      'Para pagos en efectivo es obligatorio permitir el acceso GPS a tu ubicación actual.'
    );
  }

  // Si no hay ubicación actual, solo bloqueamos si el método de pago es EFECTIVO.
  // Si es TRANSFERENCIA, permitimos continuar sin GPS (tolerancia a fallos técnicos del dispositivo).
  if (!input.currentLocation) {
    if (input.paymentMethod === PaymentMethod.CASH) {
      throw new AppError(
        400,
        'CUSTOMER_LOCATION_REQUIRED',
        'Para pagos en efectivo es obligatorio permitir el acceso a tu ubicación actual por seguridad.'
      );
    }
    return; // Es transferencia y falló el GPS, permitimos continuar
  }

  const { latitude, longitude, accuracy, capturedAt } = input.currentLocation;
  const hasValidCoordinates =
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180;

  if (!hasValidCoordinates || !isLocationCapturedRecently(capturedAt)) {
    if (input.paymentMethod === PaymentMethod.CASH) {
      throw new AppError(
        400,
        'CUSTOMER_LOCATION_INVALID',
        'La ubicación actual no es válida o está vencida. Por favor vuelve a verificarla para pagar en efectivo.'
      );
    }
    return; // Es transferencia, toleramos que esté vencida
  }

  const maxAccuracyMeters = getPositiveNumberEnv('ORDER_MAX_LOCATION_ACCURACY_METERS', 2000);
  if (typeof accuracy === 'number' && accuracy > maxAccuracyMeters) {
    if (input.paymentMethod === PaymentMethod.CASH) {
      throw new AppError(
        400,
        'CUSTOMER_LOCATION_LOW_ACCURACY',
        'La ubicación actual no tiene suficiente precisión. Intenta activar la ubicación precisa para pagos en efectivo.'
      );
    }
    return; // Es transferencia, ignoramos la precisión
  }

  // Transferencia: no validamos distancia GPS vs dirección de entrega
  // para permitir pedidos regalo desde cualquier ubicación.
  if (input.paymentMethod !== PaymentMethod.CASH) return;

  const deliveryAddress = input.deliveryAddress!;
  const distanceKm = getDistanceInKm(
    { latitude, longitude },
    {
      latitude: deliveryAddress.latitude,
      longitude: deliveryAddress.longitude,
    }
  );
  const accuracyBufferKm = typeof accuracy === 'number' ? Math.min(accuracy / 1000, 1) : 0;
  const maxDistanceKm =
    input.paymentMethod === PaymentMethod.CASH
      ? getPositiveNumberEnv('ORDER_CASH_MAX_CUSTOMER_DISTANCE_KM', 1)
      : getPositiveNumberEnv('ORDER_TRANSFER_MAX_CUSTOMER_DISTANCE_KM', 5);

  if (distanceKm > maxDistanceKm + accuracyBufferKm) {
    logger.warn('Order rejected: CUSTOMER_TOO_FAR_FROM_DELIVERY_ADDRESS', {
      customerUserId,
      paymentMethod: input.paymentMethod,
      distanceKm: Number(distanceKm.toFixed(3)),
      maxDistanceKm,
      accuracy,
      accuracyBufferKm,
      customerLocation: { latitude, longitude },
      deliveryLocation: {
        latitude: deliveryAddress.latitude,
        longitude: deliveryAddress.longitude,
      },
    });

    throw new AppError(
      400,
      'CUSTOMER_TOO_FAR_FROM_DELIVERY_ADDRESS',
      input.paymentMethod === PaymentMethod.CASH
        ? 'Para pagar en efectivo debes estar cerca de la dirección de entrega.'
        : 'La ubicación actual está demasiado lejos de la dirección de entrega. Verifica tu ubicación antes de pedir.'
    );
  }
}

type OrderServiceParams = CreateOrderParams & { requestHeaders?: any };

const paidSnapshotSchema = z.object({
  fulfillmentType: z.enum(['PICKUP', 'DELIVERY']), addressId: z.string().optional(),
  latitude: z.number().optional(), longitude: z.number().optional(), notes: z.string().optional(),
  subtotal: z.number(), taxAmount: z.number(), serviceFee: z.number(), deliveryFee: z.number(),
  deliveryDistanceKm: z.number().nullish(), promoDiscountAmount: z.number(), etaMs: z.number().nonnegative(),
  promoCode: z.string().nullable().optional(), discountBreakdown: z.string().nullable().optional(),
  loyaltyReservation: z.object({ cardId: z.string(), discountCents: z.literal(0) }).optional(),
  items: z.array(z.object({ productId: z.string(), quantity: z.number().int().positive(), title: z.string().optional(), unitPrice: z.number(),
    subtotal: z.number(), specialInstructions: z.string().nullish(), sellBy: z.enum(['UNIT', 'WEIGHT']), weightG: z.number().nullish(),
    options: z.array(z.object({ id: z.string(), name: z.string(), price: z.number() })),
  })).min(1),
});

async function nextDailyOrderNumber(tx: Prisma.TransactionClient, restaurantId: string): Promise<number> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`order-daily:${restaurantId}`}))::text`;
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const last = await tx.order.aggregate({
    where: { restaurantId, createdAt: { gte: startOfDay } },
    _max: { dailyCounter: true },
  });
  return (last._max.dailyCounter ?? 0) + 1;
}

/** Convert an accredited reservation without charging or decrementing inventory again. */
export async function finalizeVerifiedCustomerCheckout(prisma: PrismaClient, intentId: string) {
  return prisma.$transaction(async tx => {
    const initialIntent = await tx.checkoutPaymentIntent.findUniqueOrThrow({ where: { id: intentId }, select: { customerId: true } });
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))::text', `order-create:${initialIntent.customerId}`);
    const claimed = await tx.checkoutPaymentIntent.updateMany({
      where: { id: intentId, state: 'VERIFIED', providerOrderId: { not: null } }, data: { state: 'ORDER_CREATED' },
    });
    const clientOrderKey = `mp:${intentId}`;
    if (!claimed.count) {
      const intent = await tx.checkoutPaymentIntent.findUnique({ where: { id: intentId } });
      if (intent?.state !== 'ORDER_CREATED') throw new AppError(409, 'PAYMENT_NOT_VERIFIED', 'El pago aún no está verificado.');
      return { order: await tx.order.findUniqueOrThrow({ where: { clientOrderKey }, select: customerCreatedOrderSelect }), isDuplicate: true };
    }
    const intent = await tx.checkoutPaymentIntent.findUniqueOrThrow({ where: { id: intentId } });
    const { items, etaMs, loyaltyReservation, ...snapshot } = paidSnapshotSchema.parse(intent.snapshot);
    const estimatedDeliveryTime = new Date(Date.now() + etaMs);
    const dailyCounter = await nextDailyOrderNumber(tx, intent.restaurantId);
    const order = await tx.order.create({
      data: {
        ...snapshot, restaurantId: intent.restaurantId, customerId: intent.customerId,
        orderReference: generateOrderReference(), dailyCounter, clientOrderKey, totalAmount: intent.amountCents / 100,
        status: OrderStatus.PENDING, paymentMethod: PaymentMethod.CREDIT_CARD, paymentStatus: PaymentStatus.COMPLETED,
        estimatedDeliveryTime, pickupReadyAt: snapshot.fulfillmentType === 'PICKUP' ? estimatedDeliveryTime : null,
        items: { create: items.map(({ options, title: _title, ...item }) => ({ ...item,
          options: { create: options.map(({ id, name, price }) => ({ optionId: id, name, price })) },
        })) },
        tracking: { create: [{ status: OrderStatus.PENDING, notes: 'Pago en línea acreditado.' }, { status: OrderStatus.PENDING, notes: ORDER_DECISION_ELIGIBLE }] },
      },
      select: customerCreatedOrderSelect,
    });
    if (loyaltyReservation) await reserveRuntimeReward(tx, intent.customerId, order.id, loyaltyReservation);
    await tx.kitchenOrderOutbox.create({
      data: { orderId: order.id, restaurantId: intent.restaurantId, orderCreatedAt: order.createdAt },
    });
    await tx.customer.update({ where: { id: intent.customerId }, data: { totalOrders: { increment: 1 } } });
    return { order, isDuplicate: false };
  });
}

export async function createOrderForCustomer(params: OrderServiceParams) {
  const result = await processCustomerOrder(params);
  if (!result.order) throw new Error('Unexpected checkout reservation');
  return { order: result.order, isDuplicate: result.isDuplicate };
}

/** Internal card checkout; no provider call or operational order is created here. */
export async function reserveCustomerCardCheckout(params: OrderServiceParams, requestKey: string) {
  if (!/^[\w-]{16,128}$/.test(requestKey)) throw new AppError(400, 'INVALID_CHECKOUT_KEY', 'Clave de pago inválida.');
  if (params.input.promoCode) throw new AppError(400, 'CARD_COUPON_NOT_SUPPORTED', 'Los cupones aún no están disponibles con tarjeta.');
  if (params.input.loyalty && params.input.loyalty.discountCents !== 0) throw new AppError(400, 'CARD_REWARD_NOT_SUPPORTED', 'Solo los regalos de fidelidad están disponibles con tarjeta.');
  const input = { ...params.input, paymentMethod: PaymentMethod.CREDIT_CARD, clientOrderKey: undefined, paymentProofUrl: undefined };
  const result = await processCustomerOrder({ ...params, input }, requestKey);
  if (!('intent' in result) || !result.intent) throw new Error('Expected checkout reservation');
  return result.intent;
}

async function processCustomerOrder({
  prisma,
  customerUserId,
  input,
  requestHeaders: _requestHeaders,
}: OrderServiceParams, reservationKey?: string) {
  assertRestaurantId(input.restaurantId);
  logger.info('Creating order for customer', {
    customerUserId,
    restaurantId: input.restaurantId,
    itemCount: input.items.length,
    paymentMethod: input.paymentMethod,
  });

  const customer = await prisma.customer.findUnique({
    where: { userId: customerUserId },
    include: { user: true },
  });

  if (!customer) {
    throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'No se encontro el perfil del cliente.');
  }

  // Bloqueo por deuda de pedido no recibido (o suspensión manual de la cuenta).
  if (customer.isSuspendedByDebt && customer.debtAmount > 0) {
    throw new AppError(
      403,
      'CUSTOMER_SUSPENDED_BY_DEBT',
      'Tienes un saldo pendiente por un pedido no recibido. Liquida tu deuda para volver a pedir.'
    );
  }

  if (customer.user.status === 'SUSPENDED') {
    throw new AppError(
      403,
      'ACCOUNT_SUSPENDED',
      'Tu cuenta ha sido suspendida. Contacta a soporte.'
    );
  }

  const reservationFingerprint = reservationKey ? checkoutRequestFingerprint(input as unknown as Record<string, unknown>) : undefined;
  if (reservationKey) {
    const existing = await prisma.checkoutPaymentIntent.findUnique({
      where: { customerId_requestKey: { customerId: customer.id, requestKey: reservationKey } },
    });
    if (existing) {
      if (existing.restaurantId !== input.restaurantId || existing.fingerprint !== reservationFingerprint) {
        throw new AppError(409, 'CHECKOUT_KEY_CONFLICT', 'El intento corresponde a otro carrito.');
      }
      return { intent: existing };
    }
  }

  // Idempotencia: si el cliente reintenta con la misma clientOrderKey (red caída,
  // doble toque, timeout con retry), devolvemos el pedido ya creado sin duplicarlo.
  if (input.clientOrderKey) {
    const existingByKey = await prisma.order.findUnique({
      where: { clientOrderKey: input.clientOrderKey },
      select: customerCreatedOrderSelect,
    });

    if (existingByKey) {
      if (existingByKey.customerId !== customer.id || existingByKey.restaurant.id !== RESTAURANT_ID) {
        throw new AppError(
          403,
          'ORDER_IDEMPOTENCY_FORBIDDEN',
          'La clave del pedido no pertenece a este cliente.'
        );
      }
      logger.info('Order idempotency hit', {
        orderId: existingByKey.id,
        orderReference: existingByKey.orderReference,
        clientOrderKey: input.clientOrderKey,
      });
      return { order: existingByKey, isDuplicate: true };
    }
  }

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: RESTAURANT_ID },
    include: {
      user: true,
      operatingHours: true,
    },
  });

  if (!restaurant) {
    throw new AppError(404, 'RESTAURANT_NOT_FOUND', 'No se encontro el restaurante.');
  }

  // Bank-transfer checkout is retired for new orders. Keep the enum and legacy
  // rendering paths so existing historical orders remain readable.
  if (input.paymentMethod === PaymentMethod.TRANSFER) {
    throw new AppError(400, 'PAYMENT_METHOD_RETIRED', 'La transferencia ya no está disponible. Elige efectivo o tarjeta.');
  }

  if (input.paymentMethod === PaymentMethod.CREDIT_CARD && !restaurant.acceptsCard) {
    throw new AppError(409, 'CARD_NOT_ACCEPTED', 'Este restaurante no acepta pagos con tarjeta.');
  }

  const regionConfig = await prisma.region.findUnique({
    where: { code: restaurant.region },
    select: { deliveryRadius: true },
  });

  const isPickup = input.fulfillmentType === 'PICKUP';

  // Defensa: un negocio configurado como "solo recoger en tienda" nunca recibe
  // pedidos de entrega a domicilio (cualquier ruta de creación).
  if (restaurant.pickupOnly && !isPickup) {
    throw new AppError(
      400,
      'DELIVERY_UNAVAILABLE',
      'Este negocio solo ofrece recoger en tienda.'
    );
  }

  if (isPickup && input.paymentMethod === PaymentMethod.CASH) {
    if (!input.locationVerified) {
      throw new AppError(
        400,
        'LOCATION_NOT_VERIFIED',
        'Para pagos en efectivo en sucursal es obligatorio permitir el acceso GPS a tu ubicación actual.'
      );
    }

    if (!input.currentLocation) {
      throw new AppError(
        400,
        'CUSTOMER_LOCATION_REQUIRED',
        'Para pagos en efectivo en sucursal debes compartir tu ubicación actual.'
      );
    }

    const { latitude, longitude, accuracy, capturedAt } = input.currentLocation;
    const hasValidCoords =
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180;

    if (!hasValidCoords || !isLocationCapturedRecently(capturedAt)) {
      throw new AppError(
        400,
        'CUSTOMER_LOCATION_INVALID',
        'La ubicación actual no es válida o está vencida. Por favor vuelve a verificarla para pagar en efectivo.'
      );
    }

    const maxAccuracyMeters = getPositiveNumberEnv('ORDER_MAX_LOCATION_ACCURACY_METERS', 2000);
    if (typeof accuracy === 'number' && accuracy > maxAccuracyMeters) {
      throw new AppError(
        400,
        'CUSTOMER_LOCATION_LOW_ACCURACY',
        'La ubicación actual no tiene suficiente precisión. Intenta activar la ubicación precisa para pagos en efectivo.'
      );
    }

    const restaurantLocation =
      restaurant.latitude != null && restaurant.longitude != null
        ? { latitude: restaurant.latitude, longitude: restaurant.longitude }
        : null;

    if (restaurantLocation) {
      const distanceKm = getDistanceInKm({ latitude, longitude }, restaurantLocation);
      const effectiveRadius = restaurant.hasOwnDelivery
        ? restaurant.deliveryRadius || 3
        : regionConfig?.deliveryRadius || 20;
      const bufferKm = parseFloat(String(process.env.DELIVERY_RADIUS_BUFFER_KM || '0.1')) || 0.1;

      if (distanceKm > effectiveRadius + bufferKm) {
        throw new AppError(
          400,
          'PICKUP_CASH_OUT_OF_RANGE',
          `Para pagar en efectivo en sucursal debes estar dentro del área de cobertura del restaurante (distancia: ${distanceKm.toFixed(2)} km, radio: ${effectiveRadius} km).`
        );
      }
    }
  }

  if (!isPickup) {
    const effectiveDeliveryRadius = restaurant.hasOwnDelivery
      ? restaurant.deliveryRadius || 3
      : regionConfig?.deliveryRadius || 20;

    validateCustomerLocation(input, customerUserId);

    // Validar que la dirección de entrega esté dentro del radio del restaurante
    try {
      if (
        typeof input.deliveryAddress?.latitude === 'number' &&
        typeof input.deliveryAddress?.longitude === 'number'
      ) {
        const customerLocation = {
          latitude: input.deliveryAddress.latitude,
          longitude: input.deliveryAddress.longitude,
        };

        const restaurantLocation = {
          latitude: restaurant.latitude,
          longitude: restaurant.longitude,
        };

        if (
          typeof restaurantLocation.latitude === 'number' &&
          typeof restaurantLocation.longitude === 'number'
        ) {
          const distanceKm = getDistanceInKm(customerLocation, restaurantLocation);
          const maxRadius = effectiveDeliveryRadius;
          const bufferKm =
            parseFloat(String(process.env.DELIVERY_RADIUS_BUFFER_KM || '0.1')) || 0.1;
          const allowedRadius = maxRadius + bufferKm;

          if (input.paymentMethod === PaymentMethod.CASH && distanceKm > allowedRadius) {
            logger.warn('Order rejected: OUT_OF_DELIVERY_RANGE', {
              restaurantId: restaurant.id,
              customerUserId,
              distanceKm: Number(distanceKm.toFixed(3)),
              maxRadius,
              bufferKm,
              allowedRadius,
              customerLocation,
              restaurantLocation,
            });

            throw new AppError(
              400,
              'OUT_OF_DELIVERY_RANGE',
              `El pago en efectivo no está disponible: la dirección está fuera del radio de entrega (distancia: ${distanceKm.toFixed(2)} km, radio: ${maxRadius} km). Usa tarjeta si el restaurante la tiene habilitada.`
            );
          }
        }
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(
        500,
        'DELIVERY_RADIUS_VALIDATION_FAILED',
        'Error al validar la distancia de entrega.'
      );
    }
  }

  const requestedSchedule = input.scheduledDeliveryAt ? new Date(input.scheduledDeliveryAt) : null;
  if (requestedSchedule) {
    if (!Number.isFinite(requestedSchedule.getTime()) || requestedSchedule.getTime() < Date.now() + 15 * 60_000 ||
        requestedSchedule.getTime() > Date.now() + 14 * 24 * 60 * 60_000) {
      throw new AppError(400, 'INVALID_SCHEDULED_TIME', 'El horario debe estar entre 15 minutos y 14 días a partir de ahora.');
    }
    if (isRestaurantOpenNow(restaurant.status, restaurant.isAcceptingOrders, restaurant.isPaused, restaurant.operatingHours)) {
      throw new AppError(409, 'RESTAURANT_ALREADY_OPEN', 'El restaurante ya está abierto. Envía el pedido por el flujo habitual.');
    }
    if (!restaurant.operatingHours?.length) {
      throw new AppError(409, 'SCHEDULE_NOT_CONFIGURED', 'El restaurante no tiene un horario configurado para aceptar pedidos programados.');
    }
    {
      const dateParts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Mexico_City',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(requestedSchedule);
      const values = Object.fromEntries(dateParts.map(part => [part.type, part.value]));
      const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      const requestedDay = weekdays[values.weekday];
      const requestedMinute = Number(values.hour) * 60 + Number(values.minute);
      const parseMinutes = (time: string) => {
        const [hours, minutes] = time.split(':').map(Number);
        return hours * 60 + minutes;
      };
      const inConfiguredHours = restaurant.operatingHours.some(shift => {
        if (shift.isClosed) return false;
        const open = parseMinutes(shift.openTime);
        const close = parseMinutes(shift.closeTime);
        if (close > open) return shift.dayOfWeek === requestedDay && requestedMinute >= open && requestedMinute < close;
        return (shift.dayOfWeek === requestedDay && requestedMinute >= open) ||
          (shift.dayOfWeek === (requestedDay + 6) % 7 && requestedMinute < close);
      });
      if (!inConfiguredHours) {
        throw new AppError(400, 'SCHEDULE_OUTSIDE_BUSINESS_HOURS', 'La hora elegida debe estar dentro del horario de atención.');
      }
    }
  }

  if (
    !requestedSchedule &&
    !isRestaurantOpenNow(
      restaurant.status,
      restaurant.isAcceptingOrders,
      restaurant.isPaused,
      restaurant.operatingHours
    )
  ) {
    throw new AppError(
      409,
      'RESTAURANT_NOT_AVAILABLE',
      'El restaurante no esta disponible para recibir pedidos.'
    );
  }

  const productIds = input.items.map((item) => item.productId);
  const products = await prisma.product.findMany({
    where: {
      id: { in: productIds },
      restaurantId: restaurant.id,
      isAvailable: true,
      deleted: false,
    },
    include: {
      optionGroups: {
        include: {
          options: true,
        },
      },
    },
  });

  if (products.length !== new Set(productIds).size) {
    throw new AppError(
      400,
      'INVALID_PRODUCTS',
      'Uno o mas productos no existen o no estan disponibles.'
    );
  }

  const productsById = new Map(products.map((product) => [product.id, product]));

  // Validacion de productos +18
  const hasAdultProducts = products.some((p) => p.isAdultOnly);
  if (hasAdultProducts) {
    if (!customer.user.dateOfBirth) {
      throw new AppError(
        403,
        'AGE_RESTRICTION',
        'Este pedido contiene productos para mayores de edad. Debes tener tu fecha de nacimiento registrada en tu perfil.'
      );
    }
    const today = new Date();
    const birthDate = new Date(customer.user.dateOfBirth);
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    if (age < 18) {
      throw new AppError(
        403,
        'AGE_RESTRICTION',
        'Este pedido contiene productos exclusivos para mayores de edad (+18).'
      );
    }
  }

  const region = await prisma.region.findUnique({
    where: { code: restaurant.region },
  });

  let calculatedSubtotal = 0;
  let multiBuySaving = 0;

  const itemsWithOptionsInfo = input.items.map((item) => {
    const product = productsById.get(item.productId);

    if (!product) {
      throw new AppError(
        400,
        'INVALID_PRODUCTS',
        'Uno o mas productos no existen o no estan disponibles.'
      );
    }

    const selectedOptionIds = item.optionIds || [];
    validateOptionSelection(product.optionGroups as any, selectedOptionIds);
    let itemOptionsPrice = 0;
    const validatedOptions: Array<{ id: string; name: string; price: number }> = [];

    // Validate selection count bounds and availability
    for (const group of product.optionGroups) {
      const groupOptionIds = group.options.map((o) => o.id);
      const selectedForGroup = selectedOptionIds.filter((id) => groupOptionIds.includes(id));

      const count = selectedForGroup.length;
      if (count < group.minSelection) {
        throw new AppError(
          400,
          'INVALID_OPTION_SELECTION',
          `Debes seleccionar al menos ${group.minSelection} opciones para el grupo "${group.name}".`
        );
      }
      if (count > group.maxSelection) {
        throw new AppError(
          400,
          'INVALID_OPTION_SELECTION',
          `No puedes seleccionar mas de ${group.maxSelection} opciones para el grupo "${group.name}".`
        );
      }

      for (const optId of selectedForGroup) {
        const option = group.options.find((o) => o.id === optId);
        if (!option) continue;
        if (!option.isAvailable) {
          throw new AppError(
            400,
            'OPTION_NOT_AVAILABLE',
            `La opcion "${option.name}" no esta disponible en este momento.`
          );
        }
        itemOptionsPrice += option.price;
        validatedOptions.push({
          id: option.id,
          name: option.name,
          price: option.price,
        });
      }
    }

    // Ensure all sent optionIds are valid
    const productAllOptionIds = product.optionGroups.flatMap((g) => g.options.map((o) => o.id));
    const invalidOptions = selectedOptionIds.filter((id) => !productAllOptionIds.includes(id));
    if (invalidOptions.length > 0) {
      throw new AppError(
        400,
        'INVALID_OPTION_SELECTION',
        `Una o mas opciones seleccionadas no corresponden al producto "${product.name}".`
      );
    }

    const sellBy = (product as any).sellBy || 'UNIT';
    let unitPrice: number;
    let weightG: number | null = null;
    let itemSubtotal: number;

    if (sellBy === 'WEIGHT') {
      weightG = item.weightG || 0;
      if (weightG <= 0) {
        throw new AppError(400, 'INVALID_WEIGHT', 'Debes especificar el peso en gramos.');
      }
      const minG = (product as any).minWeightG || 100;
      const maxG = (product as any).maxWeightG || 5000;
      if (weightG < minG || weightG > maxG) {
        throw new AppError(
          400,
          'WEIGHT_OUT_OF_RANGE',
          `El peso debe estar entre ${minG}g y ${maxG}g.`
        );
      }
      const unitPricePerKg = product.discountPrice ?? (product as any).unitPrice ?? product.price;
      unitPrice = unitPricePerKg;
      // El cliente cobra price = perKg × peso/1000 y lo multiplica por el nº de
      // porciones (item.quantity). El backend debe replicar exactamente eso:
      // subtotal = (precio/kg × gramos/1000) × porciones. Antes se ignoraba
      // item.quantity (solo cobraba 1 porción) → fuga de ingresos en WEIGHT.
      const portions = item.quantity || 1;
      itemSubtotal = Math.round(((unitPrice * weightG!) / 1000) * portions * 100) / 100;
    } else {
      const basePrice = product.discountPrice ?? product.price;

      // Promoción por cantidad (2x1, 3x2): por cada grupo de N artículos se paga M.
      const promoType = (product as any).promoType;
      const promoBuyQty = (product as any).promoBuyQuantity as number | null | undefined;
      const promoPayQty = (product as any).promoPayQuantity as number | null | undefined;
      const isMultiBuy =
        promoType === 'MULTI_BUY' &&
        promoBuyQty &&
        promoPayQty &&
        promoPayQty > 0 &&
        promoPayQty < promoBuyQty &&
        item.quantity >= promoBuyQty;

      let paidUnits = item.quantity;
      if (isMultiBuy) {
        const groups = Math.floor(item.quantity / promoBuyQty);
        const remainder = item.quantity % promoBuyQty;
        paidUnits = groups * promoPayQty + remainder;
        multiBuySaving += Math.round(basePrice * (item.quantity - paidUnits) * 100) / 100;
      }

      // El subtotal del ítem descuenta las unidades que se regalan (N×M con grupos completos)
      // mientras que el precio por unidad sigue incluyendo las opciones a precio completo.
      itemSubtotal = Math.round((basePrice * paidUnits + itemOptionsPrice * item.quantity) * 100) / 100;
      unitPrice = Math.round((itemSubtotal / item.quantity) * 100) / 100;
    }

    calculatedSubtotal += itemSubtotal;

    return {
      productId: item.productId,
      quantity: item.quantity,
      unitPrice,
      subtotal: itemSubtotal,
      specialInstructions: item.specialInstructions,
      sellBy,
      weightG,
      options: validatedOptions,
    };
  });

  const subtotal = calculatedSubtotal;
  const taxAmount = 0;
  const serviceFee = restaurant.serviceFee || 0;

  const deliveryDistanceKm =
    !isPickup &&
    restaurant.latitude != null &&
    restaurant.longitude != null &&
    input.deliveryAddress
      ? getDistanceInKm(
          { latitude: restaurant.latitude, longitude: restaurant.longitude },
          { latitude: input.deliveryAddress.latitude, longitude: input.deliveryAddress.longitude }
        )
      : null;

  let deliveryFee = 0;
  if (!isPickup) {
    if (restaurant.hasOwnDelivery) {
      const distanceFee = calculateDistanceDeliveryFee({
        pricingModel: (restaurant as any).deliveryPricingModel,
        distanceKm: deliveryDistanceKm,
        baseRate: (restaurant as any).deliveryBaseRate,
        perKmRate: (restaurant as any).deliveryPerKmRate,
        minDeliveryFee: (restaurant as any).deliveryMinFee,
        maxDeliveryFee: (restaurant as any).deliveryMaxFee,
      });
      deliveryFee = distanceFee !== null ? distanceFee : (restaurant.deliveryFee || 0);
    } else if (region?.pricingModel === 'distance' && deliveryDistanceKm !== null) {
      const distanceFee = calculateDistanceDeliveryFee({
        pricingModel: region.pricingModel,
        distanceKm: deliveryDistanceKm,
        baseRate: region.baseRate,
        perKmRate: region.perKmRate,
        minDeliveryFee: region.minDeliveryFee,
        maxDeliveryFee: region.maxDeliveryFee,
      });
      deliveryFee = distanceFee !== null ? distanceFee : (region?.baseDeliveryFee || 0);
    } else {
      deliveryFee = region?.baseDeliveryFee || 0;
    }
  }

  // ===== Promociones (acumulativo: multi-compra → cupón → % por monto mínimo → envío gratis) =====
  let promoDiscountAmount = 0;
  let appliedPromoCode: string | null = null;
  let appliedPromoMaxUses: number | null = null;
  let appliedPromoMaxUsesPerCustomer: number | null = null;
  let appliedPromoFirstPurchaseOnly = false;
  let freeDeliveryGranted = false;
  let promoGift: { id: string; name: string; trackStock: boolean } | null = null;
  const discountBreakdown: Record<string, number | string> = {};
  if (multiBuySaving > 0) discountBreakdown.multiBuy = multiBuySaving;

  // 1) Cupón por código
  const rawPromoCode = input.promoCode?.trim() || '';
  if (rawPromoCode) {
    const promoCode = await prisma.promoCode.findFirst({
      where: {
        restaurantId: restaurant.id,
        code: { equals: rawPromoCode.toUpperCase(), mode: 'insensitive' },
        isActive: true,
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: new Date() } }] },
          { OR: [{ validUntil: null }, { validUntil: { gte: new Date() } }] },
        ],
      },
    });

    if (!promoCode) {
      throw new AppError(400, 'INVALID_PROMO_CODE', 'El código promocional no es válido.');
    }
    if (promoCode.maxUses != null && promoCode.usesCount >= promoCode.maxUses) {
      throw new AppError(400, 'PROMO_CODE_EXHAUSTED', 'Este código promocional se ha agotado (límite de usos alcanzado).');
    }
    if (promoCode.minOrderAmount != null && subtotal < promoCode.minOrderAmount) {
      throw new AppError(
        400,
        'PROMO_CODE_MIN_ORDER',
        `Este código aplica a partir de $${promoCode.minOrderAmount.toFixed(2)} de compra.`
      );
    }

    if (promoCode.type === 'PERCENT') {
      promoDiscountAmount = Math.round((subtotal * promoCode.value) / 100 * 100) / 100;
    } else if (promoCode.type === 'AMOUNT') {
      promoDiscountAmount = Math.min(promoCode.value, subtotal);
    } else if (promoCode.type === 'FREE_DELIVERY') {
      promoDiscountAmount = deliveryFee;
      freeDeliveryGranted = true;
    } else if (promoCode.type === 'FREE_PRODUCT') {
      const giftProduct = await prisma.product.findFirst({
        where: { id: promoCode.giftProductId ?? '', restaurantId: restaurant.id, isAvailable: true, deleted: false, sellBy: 'UNIT', isAdultOnly: false },
        select: { id: true, name: true, trackStock: true, stock: true, optionGroups: { select: { minSelection: true } } },
      });
      if (!giftProduct || giftProduct.optionGroups.some((g: { minSelection: number }) => g.minSelection > 0)) {
        throw new AppError(409, 'PROMO_GIFT_UNAVAILABLE', 'El producto de regalo no está disponible. Tu cupón se conserva para otra compra.');
      }
      promoGift = { id: giftProduct.id, name: giftProduct.name, trackStock: giftProduct.trackStock };
    }
    appliedPromoCode = promoCode.code;
    appliedPromoMaxUses = promoCode.maxUses;
    appliedPromoMaxUsesPerCustomer = promoCode.maxUsesPerCustomer;
    appliedPromoFirstPurchaseOnly = promoCode.firstPurchaseOnly;
    discountBreakdown.coupon = {
      type: promoCode.type,
      value: promoCode.value,
      discount: promoDiscountAmount,
    } as any;
  }

  // 2) Descuento por monto mínimo del negocio
  if (
    restaurant.promoMinOrderPercent != null &&
    restaurant.promoMinOrderAmount != null &&
    subtotal >= restaurant.promoMinOrderAmount
  ) {
    const minOrderDiscount =
      Math.round((subtotal * restaurant.promoMinOrderPercent) / 100 * 100) / 100;
    promoDiscountAmount += minOrderDiscount;
    discountBreakdown.minOrder = minOrderDiscount;
  }

  // 3) Envío gratis por umbral de subtotal
  if (
    !isPickup &&
    !freeDeliveryGranted &&
    restaurant.promoFreeDeliveryThreshold != null &&
    subtotal >= restaurant.promoFreeDeliveryThreshold
  ) {
    promoDiscountAmount += deliveryFee;
    freeDeliveryGranted = true;
    discountBreakdown.freeDelivery = 'true';
  }

  const totalAmount = subtotal - promoDiscountAmount + taxAmount + serviceFee + deliveryFee;
  const prepTimeMinutes = restaurant.maxDeliveryTime || 15;
  const pickupReadyAt = isPickup ? new Date(Date.now() + prepTimeMinutes * 60 * 1000) : null;
  const { estimatedDeliveryTime } = calculateOrderEta({
    restaurant,
    order: isPickup
      ? {
          latitude: restaurant.latitude,
          longitude: restaurant.longitude,
          paymentMethod: input.paymentMethod,
        }
      : {
          latitude: input.deliveryAddress!.latitude,
          longitude: input.deliveryAddress!.longitude,
          paymentMethod: input.paymentMethod,
        },
    preparationTimeMinutes: prepTimeMinutes,
    isPickup,
  });

  // Seguridad: Límite de Monto para Pago en Efectivo (configurable por restaurante)
  const maxCashAmount = resolveMaxCashOrder(restaurant.maxCashOrder);
  if (!input.loyalty && input.paymentMethod === PaymentMethod.CASH && totalAmount > maxCashAmount) {
    throw new AppError(
      400,
      'CASH_LIMIT_EXCEEDED',
      `Los pedidos mayores a $${maxCashAmount} no se pueden pagar en efectivo. Elige tarjeta si está disponible.`
    );
  }

  // El restaurante puede deshabilitar el efectivo.
  if (input.paymentMethod === PaymentMethod.CASH && restaurant.acceptsCash === false) {
    throw new AppError(
      400,
      'CASH_NOT_ACCEPTED',
      'Este restaurante no acepta pagos en efectivo. Elige tarjeta si está disponible.'
    );
  }

  try {
    return await prisma.$transaction(async (tx) => {
      // Serialización por cliente: el conteo de activos y la inserción deben
      // verse mutuamente entre creaciones concurrentes. Sin este bloqueo, dos
      // transacciones simultáneas pueden contar <2 a la vez e insertar ambas.
      // Es un lock ASESOR de alcance transacción (se libera solo al hacer
      // commit/rollback): seguro con poolers en modo transacción, sin orden
      // de adquisición que respetar (es el único lock explícito del flujo) y
      // sin impacto en compras secuenciales (el lock vive solo durante el tx).
      // Clave estable por cliente para que el mismo lock proteja reintentos.
      await tx.$queryRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtext($1))::text',
        `order-create:${customer.id}`
      );

      // Re-chequeo idempotente bajo el bloqueo: si un request gemelo con la
      // misma clave confirmó mientras esperábamos el lock, devolvemos su pedido
      // sin consumir cupo del límite ni reinsertar (el catch P2002 exterior
      // queda como red de seguridad para la ventana mínima restante).
      if (input.clientOrderKey) {
        const existingInTx = await tx.order.findUnique({
          where: { clientOrderKey: input.clientOrderKey },
          select: customerCreatedOrderSelect,
        });
        if (existingInTx) {
          if (existingInTx.customerId !== customer.id) {
            throw new AppError(
              403,
              'ORDER_IDEMPOTENCY_FORBIDDEN',
              'La clave del pedido no pertenece a este cliente.'
            );
          }
          return { order: existingInTx, isDuplicate: true };
        }
      }

      let finalTotal = totalAmount;
      let finalPromoDiscount = promoDiscountAmount;
      let loyalty: Awaited<ReturnType<typeof loyaltyQuote>> | null = null;
      if (input.loyalty) {
        if (rawPromoCode || promoDiscountAmount > 0 || multiBuySaving > 0 || products.some(product => product.discountPrice !== null || (product as any).promoType)) throw new AppError(409, 'LOYALTY_PROMOTION_CONFLICT', 'La recompensa no se combina con promociones. Se conserva para otra compra.');
        loyalty = await loyaltyQuote(tx, customer.id, moneyCents(subtotal), productIds);
        if (!loyalty.eligible || loyalty.cardId !== input.loyalty.cardId || loyalty.discountCents !== input.loyalty.discountCents) throw new AppError(409, 'LOYALTY_QUOTE_CHANGED', 'La recompensa cambió o ya no está disponible. Revisa el carrito antes de confirmar.');
        if (reservationKey && (!loyalty.gift || loyalty.discountCents !== 0)) throw new AppError(400, 'CARD_REWARD_NOT_SUPPORTED', 'Solo los regalos de fidelidad están disponibles con tarjeta.');
        finalPromoDiscount += loyalty.discountCents / 100;
        finalTotal = Math.round((subtotal - finalPromoDiscount + taxAmount + serviceFee + deliveryFee) * 100) / 100;
        if (moneyCents(finalTotal) !== input.loyalty.expectedTotalCents) throw new AppError(409, 'LOYALTY_TOTAL_CHANGED', 'El importe cambió. Actualiza el carrito antes de confirmar.');
        if (input.paymentMethod === PaymentMethod.CASH && finalTotal > maxCashAmount) throw new AppError(400, 'CASH_LIMIT_EXCEEDED', 'Este importe supera el límite de efectivo.');
        discountBreakdown.loyalty = { cardId: loyalty.cardId, discount: loyalty.discountCents / 100, giftProductId: loyalty.gift?.id ?? null, description: loyalty.rewardDescription } as any;
      }

      // The per-customer advisory lock above makes these eligibility checks
      // atomic with the order insert, including concurrent first-order attempts.
      if (appliedPromoCode && (appliedPromoFirstPurchaseOnly || appliedPromoMaxUsesPerCustomer != null)) {
        const [customerUseCount, previousPurchaseCount, pendingPromoIntents] = await Promise.all([
          appliedPromoMaxUsesPerCustomer == null ? Promise.resolve(0) : tx.order.count({ where: { restaurantId: restaurant.id, customerId: customer.id, promoCode: { equals: appliedPromoCode, mode: 'insensitive' } } }),
          !appliedPromoFirstPurchaseOnly ? Promise.resolve(0) : tx.order.count({ where: { restaurantId: restaurant.id, customerId: customer.id, status: { notIn: [OrderStatus.CANCELLED, OrderStatus.REJECTED] } } }),
          tx.checkoutPaymentIntent.findMany({
            where: { restaurantId: restaurant.id, customerId: customer.id, OR: [
              { state: 'RESERVED', expiresAt: { gt: new Date() } }, { state: { in: ['SUBMITTING', 'VERIFIED'] } },
            ] },
            select: { snapshot: true },
          }),
        ]);
        const pendingPromoUseCount = pendingPromoIntents.filter(intent =>
          (intent.snapshot as { promoCode?: unknown } | null)?.promoCode?.toString().toLowerCase() === appliedPromoCode!.toLowerCase()
        ).length;
        const violation = getPromoLimitViolation({ firstPurchaseOnly: appliedPromoFirstPurchaseOnly, previousPurchaseCount: previousPurchaseCount + pendingPromoUseCount,
          maxUsesPerCustomer: appliedPromoMaxUsesPerCustomer, customerUseCount: customerUseCount + pendingPromoUseCount });
        if (violation === 'FIRST_PURCHASE_ONLY') throw new AppError(400, violation, 'Este cupón es exclusivo para la primera compra en WingsLab.');
        if (violation === 'PROMO_CODE_CUSTOMER_LIMIT') throw new AppError(400, violation, 'Ya alcanzaste el límite de uso de este cupón.');
      }

      // Seguridad: Límite de Pedidos Activos (Máximo 2) — dentro de la transacción
      // y bajo el bloqueo anterior para evitar carreras entre dos creaciones concurrentes.
      const activeOrdersCount = await tx.order.count({
        where: {
          customerId: customer.id,
          status: {
            notIn: [
              OrderStatus.DELIVERED,
              OrderStatus.COMPLETED,
              OrderStatus.CANCELLED,
              OrderStatus.REJECTED,
            ],
          },
        },
      });

      if (activeOrdersCount >= 2) {
        throw new AppError(
          400,
          'ACTIVE_ORDERS_LIMIT_EXCEEDED',
          'Ya tienes 2 pedidos en proceso. Espera a que alguno se entregue para realizar otro.'
        );
      }

      let addressId: string | undefined;
      let latitude: number | undefined;
      let longitude: number | undefined;

      if (!isPickup) {
        const address = await tx.address.findFirst({
          where: {
            customerId: customer.id,
            isActive: true,
            street: { equals: input.deliveryAddress!.street, mode: 'insensitive' },
            number: { equals: input.deliveryAddress!.number, mode: 'insensitive' },
            ...buildApartmentWhere(input.deliveryAddress!.apartment),
            neighborhood: { equals: input.deliveryAddress!.neighborhood, mode: 'insensitive' },
            city: { equals: input.deliveryAddress!.city, mode: 'insensitive' },
            state: { equals: input.deliveryAddress!.state, mode: 'insensitive' },
            zipCode: { equals: input.deliveryAddress!.zipCode, mode: 'insensitive' },
          },
        });
        if (!address) {
          throw new AppError(
            400,
            'ADDRESS_NOT_VERIFIED',
            'La dirección de entrega no está verificada. Por favor verifica tu ubicación desde la app antes de crear el pedido.'
          );
        }

        const verificationTtlDays =
          parseInt(String(process.env.ADDRESS_VERIFICATION_TTL_DAYS || '7'), 10) || 7;
        let verifiedAt = (address as any).locationVerifiedAt;
        const isVerificationStale =
          !verifiedAt ||
          Date.now() - new Date(verifiedAt).getTime() > verificationTtlDays * 24 * 60 * 60 * 1000;

        if (isVerificationStale) {
          if (input.paymentMethod === PaymentMethod.CASH) {
            const location = input.currentLocation;
            const hasValidGps =
              location &&
              Number.isFinite(location.latitude) &&
              Number.isFinite(location.longitude) &&
              location.latitude >= -90 &&
              location.latitude <= 90 &&
              location.longitude >= -180 &&
              location.longitude <= 180 &&
              isLocationCapturedRecently(location.capturedAt);

            if (!hasValidGps) {
              throw new AppError(
                400,
                'ADDRESS_NOT_VERIFIED',
                'Para pagos en efectivo la dirección debe verificarse recientemente. Activa tu ubicación GPS.'
              );
            }

            const distanceKm = getDistanceInKm(
              { latitude: location.latitude, longitude: location.longitude },
              {
                latitude: input.deliveryAddress!.latitude,
                longitude: input.deliveryAddress!.longitude,
              }
            );
            if (distanceKm > 1) {
              throw new AppError(
                400,
                'ADDRESS_NOT_VERIFIED',
                'Debes estar cerca de la dirección de entrega para verificarla con pago en efectivo.'
              );
            }

            const now = new Date();
            await tx.address.update({
              where: { id: address.id },
              data: {
                latitude: input.deliveryAddress!.latitude,
                longitude: input.deliveryAddress!.longitude,
                locationVerifiedAt: now,
              },
            });
            verifiedAt = now;
          }
          // For TRANSFER, allow stale address to proceed without re-verification
        }

        if (
          input.deliveryAddress!.reference &&
          address.reference !== input.deliveryAddress!.reference
        ) {
          await tx.address.update({
            where: { id: address.id },
            data: { reference: input.deliveryAddress!.reference },
          });
        }

        addressId = address.id;
        latitude = input.deliveryAddress!.latitude;
        longitude = input.deliveryAddress!.longitude;
      }

      if (reservationKey && reservationFingerprint) {
        const amountCents = moneyCents(finalTotal);
        const existing = await tx.checkoutPaymentIntent.findUnique({ where: { customerId_requestKey: { customerId: customer.id, requestKey: reservationKey } } });
        if (existing) {
          if (existing.fingerprint !== reservationFingerprint || existing.restaurantId !== restaurant.id) throw new AppError(409, 'CHECKOUT_KEY_CONFLICT', 'El intento corresponde a otro carrito.');
          return { intent: existing };
        }
        const pending = await tx.checkoutPaymentIntent.findFirst({ where: { customerId: customer.id, OR: [
          { state: 'RESERVED', expiresAt: { gt: new Date() } }, { state: { in: ['SUBMITTING', 'VERIFIED'] } },
        ] } });
        if (pending) {
          if (pending.state === 'RESERVED' && pending.restaurantId === restaurant.id && pending.fingerprint === reservationFingerprint && pending.amountCents === amountCents) {
            return { intent: pending };
          }
          if (pending.state !== 'RESERVED' || !await expireReservedCheckoutPaymentInTransaction(tx, pending.id)) {
            throw new AppError(409, 'CHECKOUT_ALREADY_ACTIVE', 'Ya hay un pago en curso. Espera a que confirmemos su resultado antes de intentarlo de nuevo.');
          }
        }
        // The gift is part of the same inventory reservation as the cart; it is
        // materialized in the paid order only after provider verification.
        const reservedItems = [...itemsWithOptionsInfo];
        if (loyalty?.eligible && loyalty.gift) reservedItems.push({
          productId: loyalty.gift.id, quantity: 1, unitPrice: 0, subtotal: 0,
          specialInstructions: 'REGALO DE FIDELIDAD · 1 unidad sin costo',
          sellBy: 'UNIT', weightG: null, options: [],
        } as any);
        if (promoGift) reservedItems.push({
          productId: promoGift.id, quantity: 1, unitPrice: 0, subtotal: 0,
          specialInstructions: `REGALO POR CUPÓN ${appliedPromoCode} · 1 unidad sin costo`,
          sellBy: 'UNIT', weightG: null, options: [],
        } as any);
        if (appliedPromoCode) {
          const promoIncrement = await tx.promoCode.updateMany({
            where: {
              restaurantId: restaurant.id, code: appliedPromoCode,
              OR: [{ maxUses: null }, { usesCount: { lt: appliedPromoMaxUses ?? 0 } }],
            },
            data: { usesCount: { increment: 1 } },
          });
          if (!promoIncrement.count) throw new AppError(409, 'PROMO_CODE_EXHAUSTED', 'Este código promocional se ha agotado.');
        }
        const snapshot = JSON.parse(JSON.stringify({
          items: reservedItems.map(item => ({ ...item, title: productsById.get(item.productId)?.name ?? (loyalty?.eligible && loyalty.gift?.id === item.productId ? loyalty.gift.name : promoGift?.id === item.productId ? promoGift.name : undefined) })),
          fulfillmentType: isPickup ? 'PICKUP' : 'DELIVERY',
          addressId, latitude, longitude, notes: input.notes,
          subtotal, taxAmount, serviceFee, deliveryFee, deliveryDistanceKm, promoDiscountAmount: finalPromoDiscount,
          promoCode: appliedPromoCode,
          ...(loyalty?.eligible ? { loyaltyReservation: { cardId: loyalty.cardId, discountCents: 0 } } : {}),
          discountBreakdown: Object.keys(discountBreakdown).length ? JSON.stringify(discountBreakdown) : null,
          etaMs: Math.max(0, estimatedDeliveryTime.getTime() - Date.now()),
        })) as Prisma.InputJsonObject;
        const intent = await reserveCheckoutPaymentInTransaction(tx, {
          customerId: customer.id, restaurantId: restaurant.id, requestKey: reservationKey, fingerprint: reservationFingerprint, amountCents, snapshot,
          stock: [],
        });
        return { intent };
      }

      const pickupPin =
        isPickup && input.paymentMethod === PaymentMethod.TRANSFER
          ? String(Math.floor(1000 + Math.random() * 9000))
          : undefined;

      if (loyalty?.eligible && loyalty.gift) {
        itemsWithOptionsInfo.push({ productId: loyalty.gift.id, quantity: 1, unitPrice: 0, subtotal: 0, specialInstructions: 'REGALO DE FIDELIDAD · 1 unidad sin costo', sellBy: 'UNIT', weightG: null, options: [] });
      }

      if (promoGift) {
        itemsWithOptionsInfo.push({ productId: promoGift.id, quantity: 1, unitPrice: 0, subtotal: 0, specialInstructions: `REGALO POR CUPÓN ${appliedPromoCode} · 1 unidad sin costo`, sellBy: 'UNIT', weightG: null, options: [] });
      }

      const dailyCounter = await nextDailyOrderNumber(tx, restaurant.id);
      const order = await tx.order.create({
        data: {
          orderReference: generateOrderReference(),
          clientOrderKey: input.clientOrderKey ?? null,
          dailyCounter,
          restaurantId: restaurant.id,
          customerId: customer.id,
          fulfillmentType: isPickup ? 'PICKUP' : 'DELIVERY',
          addressId,
          latitude,
          longitude,
          pickupReadyAt,
          pickupPin,
          subtotal,
          taxAmount,
          serviceFee,
          // Persisted legacy columns remain, but WingsLab does not charge operator commissions.
          platformFee: 0,
          driverPlatformFee: 0,
          deliveryFee,
          deliveryDistanceKm,
          totalAmount: finalTotal,
          promoCode: appliedPromoCode,
          promoDiscountAmount: finalPromoDiscount,
          discountBreakdown: Object.keys(discountBreakdown).length
            ? JSON.stringify(discountBreakdown)
            : null,
          status: OrderStatus.PENDING,
          paymentMethod: input.paymentMethod,
          paymentStatus: PaymentStatus.PENDING,
          paymentProofUrl: input.paymentProofUrl,
          estimatedDeliveryTime,
          scheduledDeliveryAt: requestedSchedule,
          notes: input.notes,
          deliveryPreference: customer.deliveryPreference,
          items: {
            create: itemsWithOptionsInfo.map((item) => {
              return {
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                subtotal: item.subtotal,
                specialInstructions: item.specialInstructions,
                sellBy: item.sellBy,
                weightG: item.weightG,
                options: {
                  create: item.options.map((opt) => ({
                    optionId: opt.id,
                    name: opt.name,
                    price: opt.price,
                  })),
                },
              };
            }),
          },
          tracking: {
            create: [{
              status: OrderStatus.PENDING,
              latitude: latitude ?? restaurant.latitude,
              longitude: longitude ?? restaurant.longitude,
              notes:
                input.paymentMethod === PaymentMethod.TRANSFER
                  ? 'Pedido creado pendiente de validacion de pago.'
                   : 'Pedido creado correctamente.',
             }, { status: OrderStatus.PENDING, notes: ORDER_DECISION_ELIGIBLE }],
          },
        } as any,
        select: customerCreatedOrderSelect,
      });

      if (loyalty?.eligible) await reserveRuntimeReward(tx, customer.id, order.id, loyalty);

      await tx.customer.update({
        where: { id: customer.id },
        data: {
          totalOrders: {
            increment: 1,
          },
        },
      });

      if (appliedPromoCode && !reservationKey) {
        const promoIncrement = await tx.promoCode.updateMany({
          where: {
            restaurantId: restaurant.id,
            code: appliedPromoCode,
            OR: [{ maxUses: null }, { usesCount: { lt: appliedPromoMaxUses ?? 0 } }],
          },
          data: { usesCount: { increment: 1 } },
        });
        if (promoIncrement.count === 0) {
          throw new AppError(400, 'PROMO_CODE_EXHAUSTED', 'Este código promocional se ha agotado (límite de usos alcanzado).');
        }
      }

      logger.info('Order created', {
        orderId: order.id,
        orderReference: order.orderReference,
        customerUserId,
        restaurantUserId: (order as any).restaurant?.userId,
        status: order.status,
        totalAmount: order.totalAmount,
      });

      return { order, isDuplicate: false };
    });
  } catch (error) {
    // P2002 en clientOrderKey: un request concurrente ya creó el pedido.
    // Se devuelve el existente para garantizar idempotencia.
    if (
      input.clientOrderKey &&
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const existingByKey = await prisma.order.findUnique({
        where: { clientOrderKey: input.clientOrderKey },
        select: customerCreatedOrderSelect,
      });

      if (existingByKey && existingByKey.customerId === customer.id) {
        logger.info('Order idempotency hit on P2002', {
          orderId: existingByKey.id,
          orderReference: existingByKey.orderReference,
          clientOrderKey: input.clientOrderKey,
        });
        return { order: existingByKey, isDuplicate: true };
      }

      // La clave ya la usó otro cliente: se rechaza con 403 en lugar de
      // propagar el P2002 como error interno.
      if (existingByKey) {
        throw new AppError(
          403,
          'ORDER_IDEMPOTENCY_FORBIDDEN',
          'La clave del pedido no pertenece a este cliente.'
        );
      }
    }

    if (isMissingPaymentProofColumnError(error)) {
      throw new AppError(
        503,
        'ORDER_PAYMENT_PROOF_COLUMN_MISSING',
        'La base de datos local aun no tiene la columna del comprobante de pago. Aplica la migracion de Prisma para activar esta parte del flujo.'
      );
    }

    throw error;
  }
}
