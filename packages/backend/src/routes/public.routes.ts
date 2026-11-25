import { RestaurantStatus } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { prisma } from '../config/database';
import { RESTAURANT_ID } from '../config/single-restaurant';
import { getDistanceInKm, isRestaurantOpenNow, getNextOpenTime } from '../utils/restaurant';
import { calculateDistanceDeliveryFee } from '../utils/delivery-pricing';

type RegionDeliveryConfig = {
  baseDeliveryFee?: number | null;
  deliveryRadius?: number | null;
  pricingModel?: string | null;
  baseRate?: number | null;
  perKmRate?: number | null;
  minDeliveryFee?: number | null;
  maxDeliveryFee?: number | null;
};

type OwnDeliveryRestaurant = {
  hasOwnDelivery: boolean;
  deliveryFee?: number | null;
  deliveryPricingModel?: string | null;
  deliveryBaseRate?: number | null;
  deliveryPerKmRate?: number | null;
  deliveryMinFee?: number | null;
  deliveryMaxFee?: number | null;
};

function resolveDeliveryPricing(
  restaurant: OwnDeliveryRestaurant,
  regionConfig: RegionDeliveryConfig | null | undefined,
  distanceKm: number | null
) {
  if (restaurant.hasOwnDelivery) {
    const pricingModel = restaurant.deliveryPricingModel || 'fixed';
    const distanceFee = calculateDistanceDeliveryFee({
      pricingModel,
      distanceKm,
      baseRate: restaurant.deliveryBaseRate,
      perKmRate: restaurant.deliveryPerKmRate,
      minDeliveryFee: restaurant.deliveryMinFee,
      maxDeliveryFee: restaurant.deliveryMaxFee,
    });
    return {
      pricingModel,
      baseRate: restaurant.deliveryBaseRate ?? null,
      perKmRate: restaurant.deliveryPerKmRate ?? null,
      minDeliveryFee: restaurant.deliveryMinFee ?? null,
      maxDeliveryFee: restaurant.deliveryMaxFee ?? null,
      effectiveDeliveryFee: distanceFee !== null ? distanceFee : (restaurant.deliveryFee || 0),
    };
  }

  const pricingModel = regionConfig?.pricingModel || 'fixed';
  const distanceFee = calculateDistanceDeliveryFee({
    pricingModel,
    distanceKm,
    baseRate: regionConfig?.baseRate,
    perKmRate: regionConfig?.perKmRate,
    minDeliveryFee: regionConfig?.minDeliveryFee,
    maxDeliveryFee: regionConfig?.maxDeliveryFee,
  });
  return {
    pricingModel,
    baseRate: regionConfig?.baseRate ?? null,
    perKmRate: regionConfig?.perKmRate ?? null,
    minDeliveryFee: regionConfig?.minDeliveryFee ?? null,
    maxDeliveryFee: regionConfig?.maxDeliveryFee ?? null,
    effectiveDeliveryFee: distanceFee !== null ? distanceFee : (regionConfig?.baseDeliveryFee || 0),
  };
}

/**
 * Métodos de pago que un restaurante acepta de forma efectiva.
 * - Efectivo: habilitado si `acceptsCash` (default true) no fue desactivado.
 * - Tarjeta: habilitada únicamente si el restaurante la activó.
 */
function resolveAcceptedPaymentMethods(restaurant: {
  acceptsCash?: boolean | null;
  acceptsCard?: boolean | null;
}): string[] {
  return [
    ...(restaurant.acceptsCash !== false ? ['CASH'] : []),
    ...(restaurant.acceptsCard === true ? ['CREDIT_CARD'] : []),
  ];
}

export async function registerPublicRoutes(fastify: FastifyInstance): Promise<void> {

  fastify.get('/menu', async (request, reply) => {
    const params = z.object({ id: z.string().default(RESTAURANT_ID) }).safeParse(request.params);
    const query = z.object({
      latitude: z.coerce.number().optional(),
      longitude: z.coerce.number().optional(),
    }).safeParse(request.query);

    if (!params.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_PARAMS',
          message: params.error.issues[0]?.message || 'Parametros invalidos.',
        },
      });
    }

    const restaurant = await prisma.restaurant.findFirst({
      where: {
        id: RESTAURANT_ID,
        status: RestaurantStatus.ACTIVE,
      },
      include: {
        operatingHours: {
          orderBy: { dayOfWeek: 'asc' },
        },
        categories: {
          where: { deleted: false },
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
          include: {
            products: {
              where: {
                isAvailable: true,
                deleted: false,
              },
              orderBy: { createdAt: 'asc' },
              include: {
                optionGroups: {
                  include: {
                    options: {
                      orderBy: { createdAt: 'asc' },
                    },
                  },
                },
              },
            },
          },
        },
        storeCategories: {
          include: {
            category: true,
          },
        },
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

    const isOpen = isRestaurantOpenNow(
      restaurant.status,
      restaurant.isAcceptingOrders,
      restaurant.isPaused,
      restaurant.operatingHours
    );

    const regionConfig = await prisma.region.findUnique({
      where: { code: restaurant.region },
      select: {
        name: true,
        baseDeliveryFee: true,
        deliveryRadius: true,
        pricingModel: true,
        baseRate: true,
        perKmRate: true,
        minDeliveryFee: true,
        maxDeliveryFee: true,
      },
    });

    const distanceKm = query.success && query.data.latitude !== undefined && query.data.longitude !== undefined
      ? getDistanceInKm(
          { latitude: query.data.latitude, longitude: query.data.longitude },
          { latitude: restaurant.latitude, longitude: restaurant.longitude },
        )
      : null;

    return reply.send({
      success: true,
      data: {
        // Explicit public projection: never spread the full Restaurant model
        // (it contains userId, billing emails, platform fees and the encrypted
        // bank account). Only fields the storefront actually renders are here.
        id: restaurant.id,
        name: restaurant.name.trim() || 'WingsLab',
        description: restaurant.description,
        seoTitle: restaurant.seoTitle,
        seoDescription: restaurant.seoDescription,
        address: restaurant.address,
        latitude: restaurant.latitude,
        longitude: restaurant.longitude,
        logo: restaurant.logo,
        coverImage: restaurant.coverImage,
        contactPhone: restaurant.contactPhone,
        email: restaurant.email,
        instagram: restaurant.instagram,
        facebook: restaurant.facebook,
        tiktok: restaurant.tiktok,
        status: restaurant.status,
        isAcceptingOrders: restaurant.isAcceptingOrders,
        isPaused: restaurant.isPaused,
        hasOwnDelivery: restaurant.hasOwnDelivery,
        supportsNetworkDelivery: restaurant.supportsNetworkDelivery,
        pickupOnly: restaurant.pickupOnly,
        acceptsCard: restaurant.acceptsCard,
        businessType: restaurant.businessType,
        operatingHours: restaurant.operatingHours.map(({ dayOfWeek, shiftIndex, openTime, closeTime, isClosed }) => ({
          dayOfWeek,
          shiftIndex,
          openTime,
          closeTime,
          isClosed,
        })),
        minDeliveryTime: restaurant.minDeliveryTime,
        maxDeliveryTime: restaurant.maxDeliveryTime,
        serviceFee: restaurant.serviceFee,
        deliveryFee: restaurant.deliveryFee,
        deliveryRadius: restaurant.deliveryRadius,
        enableTicketPrinting: restaurant.enableTicketPrinting,
        promoFreeDeliveryThreshold: restaurant.promoFreeDeliveryThreshold,
        promoMinOrderAmount: restaurant.promoMinOrderAmount,
        promoMinOrderPercent: restaurant.promoMinOrderPercent,
        acceptedPaymentMethods: resolveAcceptedPaymentMethods(restaurant),
        regionName: regionConfig?.name || null,
        isOpen,
        nextOpenTime: !isOpen && !restaurant.isPaused ? getNextOpenTime(restaurant.operatingHours) : null,
        // `deliveryRadius` is already in the public projection above; the
        // region fallback is applied through `resolveDeliveryPricing` below.
        ...resolveDeliveryPricing(restaurant, regionConfig, distanceKm),
        distanceKm,
        categories: restaurant.categories?.filter((category) => category.products?.length > 0) || [],
        storeCategories: restaurant.storeCategories?.map(sc => sc.category) || [],
      },
    });
  });

  fastify.get('/settings', async () => ({ success: true, data: {
    businessName: 'WingsLab', restaurantWelcomeImage: '', driverWelcomeImage: '',
    promoModalEnabled: false, promoModalImage: '', restaurantPromoModalEnabled: false,
    restaurantPromoModalImage: '',
    socialInstagram: '', socialFacebook: '', socialTiktok: '',
  } }));

  fastify.get('/app/version', async (request, reply) => {
    try {
      const setting = await prisma.systemSetting.findUnique({
        where: { key: 'comensalAppVersion' },
      });

      if (!setting) {
        return reply.send({
          success: true,
          data: null,
        });
      }

      let version: unknown = null;
      try {
        version = JSON.parse(setting.value);
      } catch {
        return reply.send({
          success: true,
          data: null,
        });
      }

      return reply.send({
        success: true,
        data: version,
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { message: 'Error al obtener la version de la app.' },
      });
    }
  });

  fastify.get('/app/restaurant-version', async (request, reply) => {
    try {
      const setting = await prisma.systemSetting.findUnique({
        where: { key: 'restaurantAppVersion' },
      });

      if (!setting) {
        return reply.send({
          success: true,
          data: null,
        });
      }

      let version: unknown = null;
      try {
        version = JSON.parse(setting.value);
      } catch {
        return reply.send({
          success: true,
          data: null,
        });
      }

      return reply.send({
        success: true,
        data: version,
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { message: 'Error al obtener la version de la app.' },
      });
    }
  });

}
