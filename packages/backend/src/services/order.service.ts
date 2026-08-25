import { OrderStatus, PaymentMethod, PaymentStatus, Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../errors/app-error';
import { customerCreatedOrderSelect } from './order-selects';
import { isRestaurantOpenNow } from '../utils/restaurant';
import { getDistanceInKm } from '../utils/restaurant';
import { calculateDistanceDeliveryFee } from '../utils/delivery-pricing';
import { resolveMaxCashOrder } from '../utils/cash-policy';
import { logger } from '../utils/logger';
import { buildApartmentWhere } from '../utils/address';
import { calculateOrderEta } from '../utils/order-eta';

const WHATSAPP_NOTIFICATION_FEE = 0.5;

type OrderInput = {
  restaurantId: string;
  clientOrderKey?: string;
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

export async function createOrderForCustomer({
  prisma,
  customerUserId,
  input,
  requestHeaders: _requestHeaders,
}: CreateOrderParams & { requestHeaders?: any }) {
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

  // Idempotencia: si el cliente reintenta con la misma clientOrderKey (red caída,
  // doble toque, timeout con retry), devolvemos el pedido ya creado sin duplicarlo.
  if (input.clientOrderKey) {
    const existingByKey = await prisma.order.findUnique({
      where: { clientOrderKey: input.clientOrderKey },
      select: customerCreatedOrderSelect,
    });

    if (existingByKey) {
      if (existingByKey.customerId !== customer.id) {
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
    where: { id: input.restaurantId },
    include: {
      user: true,
      operatingHours: true,
    },
  });

  if (!restaurant) {
    throw new AppError(404, 'RESTAURANT_NOT_FOUND', 'No se encontro el restaurante.');
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

          if (distanceKm > allowedRadius) {
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
              `La dirección está fuera del radio de entrega del restaurante (distancia: ${distanceKm.toFixed(2)} km, radio: ${maxRadius} km).`
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

  if (
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

    // Validación de inventario (opcional, solo para venta por unidad).
    if (product.trackStock && product.sellBy === 'UNIT' && product.stock < item.quantity) {
      throw new AppError(
        400,
        'INSUFFICIENT_STOCK',
        `El producto "${product.name}" solo tiene ${product.stock} unidad(es) disponible(s).`
      );
    }

    const selectedOptionIds = item.optionIds || [];
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
  // Tarifa de uso de la app: tarifa fija por pedido O porcentaje del subtotal neto de productos.
  // Son mutuamente excluyentes: si hay porcentaje (>0), se usa ese; si no, la tarifa fija.
  // El porcentaje NUNCA incluye envío ni tarifa de servicio, solo el importe de los productos.
  const platformFeeRate = (restaurant.platformFeeRate as number) || 0;
  const platformFee =
    platformFeeRate > 0
      ? Math.round(subtotal * platformFeeRate * 100) / 100
      : restaurant.platformFeePerOrder || 0;
  const whatsappFee =
    restaurant.whatsappNotifications && restaurant.contactPhone ? WHATSAPP_NOTIFICATION_FEE : 0;

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
  let freeDeliveryGranted = false;
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
      throw new AppError(400, 'PROMO_CODE_EXHAUSTED', 'El código promocional ya no está disponible.');
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
    }
    appliedPromoCode = promoCode.code;
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
  if (input.paymentMethod === PaymentMethod.CASH && totalAmount > maxCashAmount) {
    throw new AppError(
      400,
      'CASH_LIMIT_EXCEEDED',
      `Los pedidos mayores a $${maxCashAmount} no se pueden pagar en efectivo. Por favor usa transferencia.`
    );
  }

  // El restaurante puede no aceptar pagos en efectivo (solo transferencia).
  if (input.paymentMethod === PaymentMethod.CASH && restaurant.acceptsCash === false) {
    throw new AppError(
      400,
      'CASH_NOT_ACCEPTED',
      'Este restaurante no acepta pagos en efectivo. Por favor usa transferencia.'
    );
  }

  try {
    return await prisma.$transaction(async (tx) => {
      // Seguridad: Límite de Pedidos Activos (Máximo 2) — dentro de la transacción
      // para evitar carreras entre dos creaciones concurrentes.
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

      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const count = await tx.order.count({
        where: {
          restaurantId: restaurant.id,
          createdAt: {
            gte: startOfDay,
          },
        },
      });

      const dailyCounter = count + 1;

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

      const pickupPin =
        isPickup && input.paymentMethod === PaymentMethod.TRANSFER
          ? String(Math.floor(1000 + Math.random() * 9000))
          : undefined;

      // Decremento atómico de inventario (solo UNIT con trackStock).
      // updateMany con condición de stock evita carreras: si otro pedido ya
      // consumió el stock, count=0 y abortamos la orden (se revierte el tx).
      for (const item of input.items) {
        const product = productsById.get(item.productId);
        if (product?.trackStock && product.sellBy === 'UNIT') {
          const updated = await tx.product.updateMany({
            where: { id: item.productId, stock: { gte: item.quantity } },
            data: { stock: { decrement: item.quantity } },
          });
          if (updated.count === 0) {
            throw new AppError(
              400,
              'INSUFFICIENT_STOCK',
              `El producto "${product.name}" ya no tiene suficiente stock disponible.`
            );
          }
        }
      }

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
          platformFee,
          whatsappFee,
          deliveryFee,
          deliveryDistanceKm,
          totalAmount,
          promoCode: appliedPromoCode,
          promoDiscountAmount,
          discountBreakdown: Object.keys(discountBreakdown).length
            ? JSON.stringify(discountBreakdown)
            : null,
          status: OrderStatus.PENDING,
          paymentMethod: input.paymentMethod,
          paymentStatus: PaymentStatus.PENDING,
          paymentProofUrl: input.paymentProofUrl,
          estimatedDeliveryTime,
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
            create: {
              status: OrderStatus.PENDING,
              latitude: latitude ?? restaurant.latitude,
              longitude: longitude ?? restaurant.longitude,
              notes:
                input.paymentMethod === PaymentMethod.TRANSFER
                  ? 'Pedido creado pendiente de validacion de pago.'
                  : 'Pedido creado correctamente.',
            },
          },
        } as any,
        select: customerCreatedOrderSelect,
      });

      await tx.customer.update({
        where: { id: customer.id },
        data: {
          totalOrders: {
            increment: 1,
          },
        },
      });

      if (appliedPromoCode) {
        await tx.promoCode.updateMany({
          where: { restaurantId: restaurant.id, code: appliedPromoCode },
          data: { usesCount: { increment: 1 } },
        });
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
