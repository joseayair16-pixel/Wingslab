import { RestaurantStatus } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { prisma } from '../config/database';
import { getDistanceInKm, isRestaurantOpenNow, getNextOpenTime, resolveZoneFromNearestRestaurant } from '../utils/restaurant';
import { calculateDistanceDeliveryFee } from '../utils/delivery-pricing';
import { applyPromotionRoleFilter } from '../utils/promotion-targeting';
import { createPlatformRequest } from '../utils/platform-requests';
import { decrypt } from '../utils/crypto';
import { tryAuthenticate } from '../middleware/auth';


const listRestaurantsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(12),
  search: z.string().optional(),
  region: z.string().optional(),
  storeCategoryId: z.string().optional(),
  categoryId: z.string().optional(),
  latitude: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),
  openOnly: z.preprocess((val) => val !== 'false' && val !== false, z.boolean()),
  searchType: z.enum(['restaurant', 'product']).optional(),
});

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
  fastify.get('/restaurantes', async (request, reply) => {
    const parsed = listRestaurantsQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_QUERY',
          message: parsed.error.issues[0]?.message || 'Query invalida.',
        },
      });
    }

    const { page, limit, search, searchType, region, categoryId, storeCategoryId, latitude, longitude, openOnly } = parsed.data;
    const hasCoordinates = latitude !== undefined && longitude !== undefined;

      const restaurants = await prisma.restaurant.findMany({
        where: {
          status: RestaurantStatus.ACTIVE,
          ...(region ? { region } : {}),
          ...(search
            ? {
                OR: [
                  ...(searchType === 'restaurant' || !searchType
                    ? [
                        { name: { contains: search, mode: 'insensitive' as const } },
                        { description: { contains: search, mode: 'insensitive' as const } },
                        {
                          categories: {
                            some: {
                              name: { contains: search, mode: 'insensitive' as const },
                            },
                          },
                        },
                      ]
                    : []),
                  ...(searchType === 'product' || !searchType
                    ? [
                        {
                          products: {
                            some: {
                              name: { contains: search, mode: 'insensitive' as const },
                              isAvailable: true,
                              deleted: false,
                            },
                          },
                        },
                      ]
                    : []),
                ],
              }
            : {}),
          ...(categoryId
            ? {
                categories: {
                  some: {
                    id: categoryId,
                  },
                },
              }
            : {}),
          ...(storeCategoryId
            ? {
                storeCategories: {
                  some: {
                    categoryId: storeCategoryId,
                  },
                },
              }
            : {}),
        },
        take: 200,
      include: {
        operatingHours: true,
        categories: {
          select: {
            id: true,
            name: true,
          },
        },
        storeCategories: {
          include: {
            category: true,
          },
        },
        stats: true,
        ...(search && (searchType === 'product' || !searchType)
          ? {
              products: {
                where: {
                  isAvailable: true,
                  deleted: false,
                  name: { contains: search, mode: 'insensitive' },
                },
                take: 6,
              },
            }
          : {}),
      },
    });

    const matchedRestaurantIds = restaurants.map((r) => r.id);
    const restaurantsWithPromotions = matchedRestaurantIds.length
      ? await prisma.product.findMany({
          where: {
            restaurantId: { in: matchedRestaurantIds },
            discountPrice: { not: null },
            isAvailable: true,
            deleted: false,
          },
          select: {
            restaurantId: true,
          },
          distinct: ['restaurantId'],
        })
      : [];
    const promoRestaurantIds = new Set(restaurantsWithPromotions.map((p) => p.restaurantId));

    const regionCodes = Array.from(new Set(restaurants.map((restaurant) => restaurant.region).filter(Boolean)));
    const regions = regionCodes.length
      ? await prisma.region.findMany({
          where: {
            code: {
              in: regionCodes,
            },
          },
        select: {
          code: true,
          name: true,
          baseDeliveryFee: true,
          deliveryRadius: true,
          pricingModel: true,
          baseRate: true,
          perKmRate: true,
          minDeliveryFee: true,
          maxDeliveryFee: true,
        },
      })
      : [];
    const regionsByCode = new Map(regions.map((region) => [region.code, region]));

    const mapped = restaurants
      .map((restaurant) => {
        const isOpen = isRestaurantOpenNow(
          restaurant.status,
          restaurant.isAcceptingOrders,
          restaurant.isPaused,
          restaurant.operatingHours
        );
        const regionConfig = regionsByCode.get(restaurant.region);
        const distanceKm = hasCoordinates
          ? getDistanceInKm(
              { latitude, longitude },
              { latitude: restaurant.latitude, longitude: restaurant.longitude }
            )
          : null;

        return {
          id: restaurant.id,
          name: restaurant.name,
          description: restaurant.description,
          address: restaurant.address,
          region: restaurant.region,
          regionName: regionConfig?.name || null,
          logo: restaurant.logo,
          coverImage: restaurant.coverImage,
          status: restaurant.status,
          businessType: restaurant.businessType,
          isOpen,
          isPaused: restaurant.isPaused,
          isFeatured: restaurant.isFeatured,
          nextOpenTime: !isOpen && !restaurant.isPaused ? getNextOpenTime(restaurant.operatingHours) : null,
          operatingHours: restaurant.operatingHours,
          categories: restaurant.categories,
          storeCategories: restaurant.storeCategories?.map(sc => sc.category) || [],
          hasOwnDelivery: restaurant.hasOwnDelivery,
          pickupOnly: restaurant.pickupOnly,
          accentColor: restaurant.accentColor,
          serviceFee: restaurant.serviceFee,
          maxCashOrder: restaurant.maxCashOrder,
          deliveryFee: restaurant.deliveryFee,
          deliveryRadius: restaurant.hasOwnDelivery ? restaurant.deliveryRadius : (regionConfig?.deliveryRadius || 20),
          ...resolveDeliveryPricing(restaurant, regionConfig, distanceKm),
          minDeliveryTime: restaurant.minDeliveryTime,
          maxDeliveryTime: restaurant.maxDeliveryTime,
          distanceKm,
          hasPromotions: promoRestaurantIds.has(restaurant.id),
          acceptedPaymentMethods: resolveAcceptedPaymentMethods(restaurant),
          rating: (restaurant as any).stats?.rating || 0,
          reviewCount: (restaurant as any).stats?.reviewCount || 0,
          totalOrders: (restaurant as any).stats?.totalOrders || 0,
          createdAt: restaurant.createdAt,
          matchingProducts: (restaurant as any).products || [],
        };
      })
      .filter((restaurant) => (openOnly ? restaurant.isOpen : true))
      .filter((restaurant) => {
        if (restaurant.distanceKm === null) return true;
        if (restaurant.deliveryRadius === null) return false;
        const maxRadius = restaurant.deliveryRadius ?? 3;
        return restaurant.distanceKm <= maxRadius;
      })
      .sort((left, right) => {
        if (left.isFeatured !== right.isFeatured) {
          return left.isFeatured ? -1 : 1;
        }

        if (left.isOpen !== right.isOpen) {
          return left.isOpen ? -1 : 1;
        }

        if (left.distanceKm === null || right.distanceKm === null) {
          return left.name.localeCompare(right.name);
        }

        return left.distanceKm - right.distanceKm;
      });

    const activeCategoryMap = new Map<string, Set<string>>();
    for (const r of mapped) {
      const businessType = (r as any).businessType || 'RESTAURANT';
      const cats = (r as any).storeCategories || [];
      for (const c of cats) {
        if (!activeCategoryMap.has(c.id)) activeCategoryMap.set(c.id, new Set());
        activeCategoryMap.get(c.id)!.add(businessType);
      }
    }
    const activeCategories = Array.from(activeCategoryMap.entries()).map(([id, businessTypes]) => ({
      id,
      businessTypes: Array.from(businessTypes),
    }));

    const total = mapped.length;
    const items = mapped.slice((page - 1) * limit, page * limit);

    return reply.send({
      success: true,
      data: {
        items,
        total,
        page,
        limit,
        hasMore: page * limit < total,
        activeCategories,
      },
    });
  });

  fastify.get('/restaurantes/:id', async (request, reply) => {
    const params = z.object({ id: z.string().min(1, 'El id es obligatorio.') }).safeParse(request.params);
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
        id: params.data.id,
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

  fastify.get('/store-categories', async (request, reply) => {
    try {
      const categories = await prisma.storeCategory.findMany({
        where: { isActive: true },
        orderBy: { order: 'asc' },
      });

      return reply.send({
        success: true,
        data: categories,
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { message: 'Error al obtener categorias.' },
      });
    }
  });

  fastify.get('/settings', async (request, reply) => {
    const DEFAULT_WELCOME_IMAGE = "https://images.unsplash.com/photo-1552566626-52f8b828add9?auto=format&fit=crop&w=1600&q=80";

    const buildSettingsData = (settingsMap: Record<string, string>) => {
      const data: {
        restaurantWelcomeImage: string;
        driverWelcomeImage: string;
        promoModalEnabled: boolean;
        promoModalImage: string;
        restaurantPromoModalEnabled: boolean;
        restaurantPromoModalImage: string;
        customerThankYouWhatsappEnabled: boolean;
        socialInstagram: string;
        socialFacebook: string;
        socialTiktok: string;
        adminBankName?: string;
        adminBankAccount?: string;
        adminBankBeneficiary?: string;
      } = {
        restaurantWelcomeImage: settingsMap['restaurantWelcomeImage'] || DEFAULT_WELCOME_IMAGE,
        driverWelcomeImage: settingsMap['driverWelcomeImage'] || DEFAULT_WELCOME_IMAGE,
        promoModalEnabled: settingsMap['promoModalEnabled'] === 'true',
        promoModalImage: settingsMap['promoModalImage'] || "",
        restaurantPromoModalEnabled: settingsMap['restaurantPromoModalEnabled'] === 'true',
        restaurantPromoModalImage: settingsMap['restaurantPromoModalImage'] || "",
        customerThankYouWhatsappEnabled: settingsMap['customerThankYouWhatsappEnabled'] === 'true',
        socialInstagram: settingsMap['socialInstagram'] || "",
        socialFacebook: settingsMap['socialFacebook'] || "",
        socialTiktok: settingsMap['socialTiktok'] || "",
      };

      if (authenticatedUser) {
        data.adminBankName = decrypt(settingsMap['adminBankName'] || "") || "";
        data.adminBankAccount = decrypt(settingsMap['adminBankAccount'] || "") || "";
        data.adminBankBeneficiary = decrypt(settingsMap['adminBankBeneficiary'] || "") || "";
      }

      return data;
    };

    let authenticatedUser: Awaited<ReturnType<typeof tryAuthenticate>>;
    try {
      authenticatedUser = await tryAuthenticate(request);
    } catch {
      authenticatedUser = null;
    }

    try {
      const settings = await prisma.systemSetting.findMany();
      const settingsMap = settings.reduce((acc, curr) => {
        acc[curr.key] = curr.value;
        return acc;
      }, {} as Record<string, string>);

      return reply.send({
        success: true,
        data: buildSettingsData(settingsMap),
      });
    } catch (error) {
      return reply.send({
        success: true,
        data: buildSettingsData({}),
      });
    }
  });

  const getPromotionsQuerySchema = z.object({
    region: z.string().optional(),
    role: z.string().optional(),
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
  });

  fastify.get('/public/promotions', async (request, reply) => {
    const parsed = getPromotionsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_QUERY', message: 'Query inválida.' },
      });
    }

    const { region, role, latitude, longitude } = parsed.data;
    const now = new Date();

    try {
      // Same dynamic zone resolution as billboards: explicit coordinates win
      // (the user is wherever their GPS says), then the explicit region param,
      // then global-only content.
      const resolvedRegion =
        latitude !== undefined && longitude !== undefined
          ? await resolveNearestZone({ latitude, longitude })
          : region ?? null;

      const promotions = await prisma.promotion.findMany({
        where: {
          isActive: true,
          OR: [
            { startDate: null },
            { startDate: { lte: now } }
          ],
          AND: [
            {
              OR: [
                { endDate: null },
                { endDate: { gte: now } }
              ]
            }
          ]
        },
        orderBy: { createdAt: 'desc' }
      });

      // Usuarios anónimos = rol GUEST: solo ven promociones target 'ALL' (o sin target).
      // Los roles autenticados ven sus promociones propias + las 'ALL'.
      const viewerRole = role ?? 'GUEST';
      const filteredPromotions = applyPromotionRoleFilter(promotions, {
        viewerRole,
        resolvedRegion,
      });

      return reply.send({
        success: true,
        data: filteredPromotions,
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { message: 'Error al obtener promociones.' },
      });
    }
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

  fastify.get('/public/billboards', async (request, reply) => {
    const parsed = getBillboardsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_QUERY', message: 'Query inválida.' },
      });
    }

    const { region, latitude, longitude } = parsed.data;
    const now = new Date();

    try {
      // Resolución de zona (precedencia):
      //   1) coordenadas GPS explícitas (ubicación dinámica del usuario)
      //   2) parámetro `region` (zona guardada en la cuenta, p.ej. sin GPS)
      // Si ninguna resuelve una zona de servicio → no se devuelven anuncios.
      const resolvedRegion =
        latitude !== undefined && longitude !== undefined
          ? await resolveNearestZone({ latitude, longitude })
          : region ?? null;

      // Sin zona de servicio resuelta (fuera de toda zona o ubicación
      // desconocida): no devolvemos anuncios. Esto evita que los billboards
      // "globales" (regions vacío) se filtren a usuarios fuera del área.
      if (!resolvedRegion) {
        return reply.send({ success: true, data: [] });
      }

      const regionFilter = {
        OR: [
          { regions: { isEmpty: true } },
          { regions: { has: resolvedRegion } },
        ],
      };

      const billboards = await prisma.billboard.findMany({
        where: {
          isActive: true,
          AND: [
            { OR: [{ startDate: null }, { startDate: { lte: now } }] },
            { OR: [{ endDate: null }, { endDate: { gte: now } }] },
            regionFilter,
          ],
        },
        orderBy: [{ sortIndex: 'asc' }, { createdAt: 'desc' }],
        take: 8,
      });

      return reply.send({
        success: true,
        data: billboards,
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { message: 'Error al obtener billboards.' },
      });
    }
  });

  fastify.get('/public/featured', async (request, reply) => {
    try {
      const querySchema = z.object({
        latitude: z.coerce.number().min(-90).max(90).optional(),
        longitude: z.coerce.number().min(-180).max(180).optional(),
      });
      const query = querySchema.safeParse(request.query);
      const hasCoordinates = query.success && query.data.latitude !== undefined && query.data.longitude !== undefined;
      const latitude = query.success ? query.data.latitude : undefined;
      const longitude = query.success ? query.data.longitude : undefined;

      const now = new Date();
      const activePurchases = await prisma.featuredPurchase.findMany({
        where: {
          status: 'APPROVED',
          startDate: { lte: now },
          endDate: { gte: now },
          restaurant: { status: 'ACTIVE' },
        },
        include: {
          restaurant: {
            include: {
              operatingHours: true,
              stats: {
                select: { rating: true, reviewCount: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      const regionCodes = Array.from(new Set(activePurchases.map(p => p.restaurant.region).filter(Boolean)));
      const regions = regionCodes.length
        ? await prisma.region.findMany({
            where: { code: { in: regionCodes } },
            select: { code: true, deliveryRadius: true, pricingModel: true, baseRate: true, perKmRate: true, baseDeliveryFee: true, minDeliveryFee: true, maxDeliveryFee: true },
          })
        : [];
      const regionsByCode = new Map(regions.map(r => [r.code, r]));

      const seenIds = new Set<string>();
      const featured = activePurchases
        .filter((p) => {
          if (seenIds.has(p.restaurant.id)) return false;
          seenIds.add(p.restaurant.id);
          return true;
        })
        .map((p) => {
          const distanceKm = hasCoordinates && p.restaurant.latitude != null && p.restaurant.longitude != null
            ? getDistanceInKm(
                { latitude: latitude!, longitude: longitude! },
                { latitude: p.restaurant.latitude, longitude: p.restaurant.longitude }
              )
            : null;
          const deliveryRadius = p.restaurant.hasOwnDelivery ? p.restaurant.deliveryRadius : (regionsByCode.get(p.restaurant.region)?.deliveryRadius ?? null);
          const isOpen = isRestaurantOpenNow(
            p.restaurant.status,
            p.restaurant.isAcceptingOrders,
            p.restaurant.isPaused,
            p.restaurant.operatingHours
          );
          return {
            id: p.restaurant.id,
            name: p.restaurant.name,
            logo: p.restaurant.logo,
            coverImage: p.restaurant.featuredFlyer || p.restaurant.coverImage,
            region: p.restaurant.region,
            businessType: p.restaurant.businessType,
            minDeliveryTime: p.restaurant.minDeliveryTime,
            maxDeliveryTime: p.restaurant.maxDeliveryTime,
            rating: p.restaurant.stats?.rating || 0,
            reviewCount: p.restaurant.stats?.reviewCount || 0,
            isOpen,
            isPaused: p.restaurant.isPaused,
            nextOpenTime: !isOpen && !p.restaurant.isPaused ? getNextOpenTime(p.restaurant.operatingHours) : null,
            operatingHours: p.restaurant.operatingHours,
            distanceKm,
            deliveryRadius,
          };
        })
        .filter((r) => {
          if (!hasCoordinates || r.distanceKm === null) return true;
          if (r.deliveryRadius === null) return false;
          return r.distanceKm <= (r.deliveryRadius ?? 0);
        });

      return reply.send({ success: true, data: featured });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { message: 'Error al obtener restaurantes destacados.' },
      });
    }
  });

  fastify.get('/public/ofertas', async (request, reply) => {
    const query = z.object({
      latitude: z.coerce.number().optional(),
      longitude: z.coerce.number().optional(),
    }).safeParse(request.query);

    if (!query.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_QUERY', message: 'Query inválida.' },
      });
    }

    const { latitude, longitude } = query.data;
    const hasCoordinates = latitude !== undefined && longitude !== undefined;

    try {
      const restaurants = await prisma.restaurant.findMany({
        where: {
          status: RestaurantStatus.ACTIVE,
          products: {
            some: {
              isAvailable: true,
              deleted: false,
              OR: [
                { discountPrice: { not: null } },
                { promoType: { not: null } },
              ],
            },
          },
        },
        select: {
          id: true,
          name: true,
          logo: true,
          coverImage: true,
          latitude: true,
          longitude: true,
          region: true,
          businessType: true,
          hasOwnDelivery: true,
          deliveryRadius: true,
          isAcceptingOrders: true,
          isPaused: true,
          operatingHours: true,
          products: {
            where: {
              isAvailable: true,
              deleted: false,
              OR: [
                { discountPrice: { not: null } },
                { promoType: { not: null } },
              ],
            },
            select: {
              id: true,
              name: true,
              description: true,
              price: true,
              discountPrice: true,
              image: true,
              categoryId: true,
              promoType: true,
              promoBuyQuantity: true,
              promoPayQuantity: true,
              trackStock: true,
              stock: true,
              lowStockThreshold: true,
            },
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      const regions = await prisma.region.findMany({
        select: { code: true, deliveryRadius: true },
      });
      const regionsByCode = new Map(regions.map(r => [r.code, r]));

      const offers = restaurants
        .filter((restaurant) => {
          if (!hasCoordinates) return true;
          const distanceKm = getDistanceInKm(
            { latitude, longitude },
            { latitude: restaurant.latitude, longitude: restaurant.longitude }
          );
          const maxRadius = restaurant.hasOwnDelivery
            ? restaurant.deliveryRadius
            : (regionsByCode.get(restaurant.region)?.deliveryRadius ?? null);
          if (maxRadius === null) return false;
          return distanceKm <= maxRadius;
        })
        .filter((restaurant) => isRestaurantOpenNow(RestaurantStatus.ACTIVE, restaurant.isAcceptingOrders, restaurant.isPaused, restaurant.operatingHours))
        .flatMap((restaurant: any) => {
          return restaurant.products.map((p: any) => {
            let savings = p.discountPrice != null && p.price > 0
              ? p.price - p.discountPrice
              : 0;

            let discountPercent = p.price > 0 && p.discountPrice != null
              ? Math.round((savings / p.price) * 100)
              : 0;

            const isMultiBuy =
              p.promoType === 'MULTI_BUY' &&
              p.promoBuyQuantity > 0 &&
              p.promoPayQuantity > 0 &&
              p.promoPayQuantity < p.promoBuyQuantity;

            if (isMultiBuy) {
              savings = p.price * (p.promoBuyQuantity - p.promoPayQuantity);
              discountPercent = Math.round((1 - p.promoPayQuantity / p.promoBuyQuantity) * 100);
            }

            return {
              product: {
                id: p.id,
                name: p.name,
                description: p.description,
                price: p.price,
                discountPrice: p.discountPrice,
                promoType: p.promoType,
                promoBuyQuantity: p.promoBuyQuantity,
                promoPayQuantity: p.promoPayQuantity,
                image: p.image,
                categoryId: p.categoryId,
                trackStock: p.trackStock,
                stock: p.stock,
                lowStockThreshold: p.lowStockThreshold,
                savings: Math.round(savings * 100) / 100,
                discountPercent: Math.min(100, discountPercent),
              },
              restaurant: {
                id: restaurant.id,
                name: restaurant.name,
                logo: restaurant.logo,
                coverImage: restaurant.coverImage,
                businessType: restaurant.businessType,
              },
            };
          });
        });

      const shuffle = <T,>(arr: T[]): T[] => {
        const copy = [...arr];
        for (let i = copy.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
      };

      const MAX_OFFERS_PER_RESTAURANT = 3;

      const offersByRestaurant = new Map<string, any[]>();
      for (const offer of offers) {
        const key = offer.restaurant.id;
        if (!offersByRestaurant.has(key)) offersByRestaurant.set(key, []);
        offersByRestaurant.get(key)!.push(offer);
      }

      // Anti-gaming: como máximo N ofertas por restaurante, priorizando las de
      // mayor descuento efectivo. Así acumular ofertas no da ventaja: solo las
      // mejores compiten en el carrusel de "Ofertas imperdibles".
      for (const group of offersByRestaurant.values()) {
        group.sort((a, b) => (b.product.discountPercent || 0) - (a.product.discountPercent || 0));
        if (group.length > MAX_OFFERS_PER_RESTAURANT) {
          group.splice(MAX_OFFERS_PER_RESTAURANT);
        }
      }

      const groups = shuffle([...offersByRestaurant.values()]).map((g) => shuffle(g));

      const interleavedOffers: any[] = [];
      let remaining = true;
      while (remaining) {
        remaining = false;
        for (const group of groups) {
          const item = group.shift();
          if (item !== undefined) {
            interleavedOffers.push(item);
            remaining = true;
          }
        }
      }

      return reply.send({ success: true, data: interleavedOffers });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { message: 'Error al obtener ofertas.' },
      });
    }
  });

  const platformRequestSchema = z.object({
    type: z.enum(['RESTAURANT', 'DRIVER']),
    ownerName: z.string().min(1, 'El nombre es obligatorio'),
    businessName: z.string().optional(),
    giro: z.string().optional(),
    whatsapp: z.string().min(1, 'El WhatsApp es obligatorio'),
    location: z.string().min(1, 'La ubicación es obligatoria'),
    motorcycle: z.enum(['SI', 'NO']).optional(),
  });

  fastify.post('/public/solicitudes', async (request, reply) => {
    const parsed = platformRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_BODY',
          message: parsed.error.issues[0]?.message || 'Datos de la solicitud inválidos.',
        },
      });
    }

    try {
      const result = await createPlatformRequest(parsed.data);
      return reply.status(201).send({
        success: true,
        data: result,
      });
    } catch (error: any) {
      request.log.error({ err: error }, '[public] No se pudo guardar la solicitud de plataforma');
      return reply.status(500).send({
        success: false,
        error: {
          code: 'SERVER_ERROR',
          message: 'Error al guardar la solicitud.',
        },
      });
    }
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

  fastify.get('/public/zonas-activas', async (request, reply) => {
    try {
      const restaurants = await prisma.restaurant.findMany({
        where: {
          status: RestaurantStatus.ACTIVE,
          region: { not: '' },
        },
        select: {
          region: true,
          latitude: true,
          longitude: true,
        },
      });

      if (!restaurants.length) {
        return reply.send({ success: true, data: [] });
      }

      const grouped = new Map<string, { latitudes: number[]; longitudes: number[] }>();
      for (const r of restaurants) {
        if (!r.region) continue;
        // Ignore restaurants without real coordinates; otherwise a 0,0 (o null)
        // would drag the zone's center far away and empty the results.
        if (!r.latitude || !r.longitude) continue;
        const entry = grouped.get(r.region) || { latitudes: [], longitudes: [] };
        entry.latitudes.push(r.latitude);
        entry.longitudes.push(r.longitude);
        grouped.set(r.region, entry);
      }

      const regionCodes = Array.from(grouped.keys());
      const regions = await prisma.region.findMany({
        where: { code: { in: regionCodes } },
      });
      const regionsByCode = new Map(regions.map(r => [r.code, r]));

      const data = Array.from(grouped.entries()).map(([code, coords]) => {
        const region = regionsByCode.get(code);
        const avgLat = coords.latitudes.reduce((a, b) => a + b, 0) / coords.latitudes.length;
        const avgLng = coords.longitudes.reduce((a, b) => a + b, 0) / coords.longitudes.length;
        return {
          regionCode: code,
          regionName: region?.name || code,
          city: region?.city || null,
          state: region?.state || null,
          restaurantCount: coords.latitudes.length,
          latitude: avgLat,
          longitude: avgLng,
        };
      });

      return reply.send({ success: true, data });
    } catch (error: any) {
      request.log.error({ err: error }, '[public] No se pudieron obtener las zonas activas');
      return reply.status(500).send({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Error al obtener zonas activas.' },
      });
    }
  });
}
