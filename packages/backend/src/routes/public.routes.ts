import { RestaurantStatus } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { prisma } from '../config/database';
import { RESTAURANT_ID } from '../config/single-restaurant';
import { getDistanceInKm, isRestaurantOpenNow, getNextOpenTime, resolveZoneFromNearestRestaurant } from '../utils/restaurant';
import { calculateDistanceDeliveryFee } from '../utils/delivery-pricing';
import { decrypt } from '../utils/crypto';
import { tryAuthenticate } from '../middleware/auth';

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
 * - Transferencia: habilitada si completó los datos bancarios (banco + cuenta + beneficiario).
 */
function resolveAcceptedPaymentMethods(restaurant: {
  acceptsCash?: boolean | null;
  transferBankName?: string | null;
  transferAccountNumber?: string | null;
  transferBeneficiaryName?: string | null;
}): string[] {
  const acceptsCash = restaurant.acceptsCash !== false;
  const acceptsTransfer = Boolean(
    restaurant.transferBankName?.trim() &&
      restaurant.transferAccountNumber?.trim() &&
      restaurant.transferBeneficiaryName?.trim()
  );

  const methods: string[] = [];
  if (acceptsCash) methods.push('CASH');
  if (acceptsTransfer) methods.push('TRANSFER');
  return methods;
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
        stats: true,
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

    const authenticated = await tryAuthenticate(request);
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
        ...restaurant,
        name: 'WingsLab',
        acceptedPaymentMethods: resolveAcceptedPaymentMethods(restaurant),
        rating: (restaurant as any).stats?.rating || 0,
        reviewCount: (restaurant as any).stats?.reviewCount || 0,
        regionName: regionConfig?.name || null,
        isOpen,
        isPaused: restaurant.isPaused,
        nextOpenTime: !isOpen && !restaurant.isPaused ? getNextOpenTime(restaurant.operatingHours) : null,
        serviceFee: restaurant.serviceFee,
        deliveryRadius: restaurant.hasOwnDelivery ? restaurant.deliveryRadius : (regionConfig?.deliveryRadius || 20),
        ...resolveDeliveryPricing(restaurant, regionConfig, distanceKm),
        distanceKm,
        categories: restaurant.categories?.filter((category) => category.products?.length > 0) || [],
        storeCategories: restaurant.storeCategories?.map(sc => sc.category) || [],
        transferBankName: restaurant.transferBankName,
        ...(authenticated
          ? {
              transferAccountNumber: restaurant.transferAccountNumber
                ? decrypt(restaurant.transferAccountNumber)
                : restaurant.transferAccountNumber,
            }
          : {}),
        transferBeneficiaryName: restaurant.transferBeneficiaryName,
      },
    });
  });

  fastify.get('/settings', async () => ({ success: true, data: {
    businessName: 'WingsLab', restaurantWelcomeImage: '', driverWelcomeImage: '',
    promoModalEnabled: false, promoModalImage: '', restaurantPromoModalEnabled: false,
    restaurantPromoModalImage: '', customerThankYouWhatsappEnabled: false,
    socialInstagram: '', socialFacebook: '', socialTiktok: '',
  } }));

  const getPromotionsQuerySchema = z.object({
    region: z.string().optional(),
    role: z.string().optional(),
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
  });

  const getBillboardsQuerySchema = z.object({
    region: z.string().optional(),
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
  });

  /**
   * Cached active restaurants that define serviceable zones, with their
   * effective delivery radius (own delivery, or the region's fallback radius).
   * Built once and refreshed after ZONE_CACHE_TTL_MS so billboard requests
   * don't hammer the DB on every call while still picking up new restaurants
   * within a minute.
   */
  let zoneRestaurantCache: {
    at: number;
    restaurants: { region: string; latitude: number; longitude: number; radiusKm: number }[];
  } | null = null;
  const ZONE_CACHE_TTL_MS = 60_000;

  async function getActiveZoneRestaurants() {
    const now = Date.now();
    if (zoneRestaurantCache && now - zoneRestaurantCache.at < ZONE_CACHE_TTL_MS) {
      return zoneRestaurantCache.restaurants;
    }

    const restaurants = await prisma.restaurant.findMany({
      where: {
        status: RestaurantStatus.ACTIVE,
        region: { not: '' },
      },
      select: {
        region: true,
        latitude: true,
        longitude: true,
        hasOwnDelivery: true,
        deliveryRadius: true,
      },
    });

    const regionCodes = Array.from(new Set(restaurants.map((r) => r.region).filter(Boolean)));
    const regions = regionCodes.length
      ? await prisma.region.findMany({ where: { code: { in: regionCodes } } })
      : [];
    const regionRadiusByCode = new Map(regions.map((r) => [r.code, r.deliveryRadius]));

    const zoneRestaurants = restaurants.map((r) => ({
      region: r.region,
      latitude: r.latitude,
      longitude: r.longitude,
      radiusKm: r.hasOwnDelivery ? r.deliveryRadius : (regionRadiusByCode.get(r.region) ?? 20),
    }));

    zoneRestaurantCache = { at: now, restaurants: zoneRestaurants };
    return zoneRestaurantCache.restaurants;
  }

  /**
   * Resolves the zone nearest to the given coordinates using cached active
   * restaurants. Returns the zone code when the user is within the delivery
   * radius of at least one active restaurant; otherwise null.
   */
  async function resolveNearestZone(params: {
    latitude: number;
    longitude: number;
  }): Promise<string | null> {
    const restaurants = await getActiveZoneRestaurants();
    return resolveZoneFromNearestRestaurant(params, restaurants);
  }



  const platformRequestSchema = z.object({
    type: z.enum(['RESTAURANT', 'DRIVER']),
    ownerName: z.string().min(1, 'El nombre es obligatorio'),
    businessName: z.string().optional(),
    giro: z.string().optional(),
    whatsapp: z.string().min(1, 'El WhatsApp es obligatorio'),
    location: z.string().min(1, 'La ubicación es obligatoria'),
    motorcycle: z.enum(['SI', 'NO']).optional(),
  });

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
