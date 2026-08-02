import { RestaurantStatus } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { prisma } from '../config/database';
import { getDistanceInKm, isRestaurantOpenNow, getNextOpenTime } from '../utils/restaurant';
import { createPlatformRequest } from '../utils/platform-requests';
import { decrypt } from '../utils/crypto';


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
          categories: restaurant.categories,
          storeCategories: restaurant.storeCategories?.map(sc => sc.category) || [],
          hasOwnDelivery: restaurant.hasOwnDelivery,
          serviceFee: restaurant.serviceFee,
          deliveryFee: restaurant.deliveryFee,
          deliveryRadius: restaurant.hasOwnDelivery ? restaurant.deliveryRadius : (regionConfig?.deliveryRadius || 20),
          pricingModel: restaurant.hasOwnDelivery ? 'fixed' : (regionConfig?.pricingModel || 'fixed'),
          baseRate: restaurant.hasOwnDelivery ? null : (regionConfig?.baseRate || null),
          perKmRate: restaurant.hasOwnDelivery ? null : (regionConfig?.perKmRate || null),
          minDeliveryFee: restaurant.hasOwnDelivery ? null : (regionConfig?.minDeliveryFee || null),
          maxDeliveryFee: restaurant.hasOwnDelivery ? null : (regionConfig?.maxDeliveryFee || null),
          effectiveDeliveryFee: (() => {
            if (restaurant.hasOwnDelivery) return restaurant.deliveryFee || 0;
            if (regionConfig?.pricingModel === 'distance' && distanceKm !== null && regionConfig) {
              const extraKm = Math.max(0, distanceKm - 1);
              let fee = regionConfig.baseRate + extraKm * regionConfig.perKmRate;
              fee = Math.max(fee, regionConfig.minDeliveryFee);
              fee = Math.min(fee, regionConfig.maxDeliveryFee);
              return Math.round(fee * 100) / 100;
            }
            return regionConfig?.baseDeliveryFee || 0;
          })(),
          minDeliveryTime: restaurant.minDeliveryTime,
          maxDeliveryTime: restaurant.maxDeliveryTime,
          distanceKm,
          hasPromotions: promoRestaurantIds.has(restaurant.id),
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

    const hasCoordinates = query.success && query.data.latitude !== undefined && query.data.longitude !== undefined;

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
        rating: (restaurant as any).stats?.rating || 0,
        reviewCount: (restaurant as any).stats?.reviewCount || 0,
        regionName: regionConfig?.name || null,
        isOpen,
        isPaused: restaurant.isPaused,
        nextOpenTime: !isOpen && !restaurant.isPaused ? getNextOpenTime(restaurant.operatingHours) : null,
        serviceFee: restaurant.serviceFee,
        deliveryRadius: restaurant.hasOwnDelivery ? restaurant.deliveryRadius : (regionConfig?.deliveryRadius || 20),
        pricingModel: restaurant.hasOwnDelivery ? 'fixed' : (regionConfig?.pricingModel || 'fixed'),
        baseRate: restaurant.hasOwnDelivery ? null : (regionConfig?.baseRate || null),
        perKmRate: restaurant.hasOwnDelivery ? null : (regionConfig?.perKmRate || null),
        minDeliveryFee: restaurant.hasOwnDelivery ? null : (regionConfig?.minDeliveryFee || null),
        maxDeliveryFee: restaurant.hasOwnDelivery ? null : (regionConfig?.maxDeliveryFee || null),
        effectiveDeliveryFee: (() => {
          if (restaurant.hasOwnDelivery) return restaurant.deliveryFee || 0;
          if (regionConfig?.pricingModel === 'distance' && distanceKm !== null && regionConfig) {
            const extraKm = Math.max(0, distanceKm - 1);
            let fee = regionConfig.baseRate + extraKm * regionConfig.perKmRate;
            fee = Math.max(fee, regionConfig.minDeliveryFee);
            fee = Math.min(fee, regionConfig.maxDeliveryFee);
            return Math.round(fee * 100) / 100;
          }
          return regionConfig?.baseDeliveryFee || 0;
        })(),
        distanceKm,
        categories: restaurant.categories?.filter((category) => category.products?.length > 0) || [],
        storeCategories: restaurant.storeCategories?.map(sc => sc.category) || [],
        transferBankName: restaurant.transferBankName,
        transferAccountNumber: restaurant.transferAccountNumber ? decrypt(restaurant.transferAccountNumber) : restaurant.transferAccountNumber,
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
    try {
      const settings = await prisma.systemSetting.findMany();
      const settingsMap = settings.reduce((acc, curr) => {
        acc[curr.key] = curr.value;
        return acc;
      }, {} as Record<string, string>);

      return reply.send({
        success: true,
        data: {
          restaurantWelcomeImage: settingsMap['restaurantWelcomeImage'] || "https://images.unsplash.com/photo-1552566626-52f8b828add9?auto=format&fit=crop&w=1600&q=80",
          driverWelcomeImage: settingsMap['driverWelcomeImage'] || "https://images.unsplash.com/photo-1552566626-52f8b828add9?auto=format&fit=crop&w=1600&q=80",
          adminBankName: decrypt(settingsMap['adminBankName'] || "") || "Banco del Centro",
          adminBankAccount: decrypt(settingsMap['adminBankAccount'] || "") || "1234 5678 9012 3456",
          adminBankBeneficiary: decrypt(settingsMap['adminBankBeneficiary'] || "") || "Administrador SaDeL",
          promoModalEnabled: settingsMap['promoModalEnabled'] === 'true',
          promoModalImage: settingsMap['promoModalImage'] || "",
          restaurantPromoModalEnabled: settingsMap['restaurantPromoModalEnabled'] === 'true',
          restaurantPromoModalImage: settingsMap['restaurantPromoModalImage'] || "",
        },
      });
    } catch (error) {
      return reply.send({
        success: true,
        data: {
          restaurantWelcomeImage: "https://images.unsplash.com/photo-1552566626-52f8b828add9?auto=format&fit=crop&w=1600&q=80",
          driverWelcomeImage: "https://images.unsplash.com/photo-1552566626-52f8b828add9?auto=format&fit=crop&w=1600&q=80",
          adminBankName: "Banco del Centro",
          adminBankAccount: "1234 5678 9012 3456",
          adminBankBeneficiary: "Administrador SaDeL",
          promoModalEnabled: false,
          promoModalImage: "",
          restaurantPromoModalEnabled: false,
          restaurantPromoModalImage: "",
        }
      });
    }
  });

  const getPromotionsQuerySchema = z.object({
    region: z.string().optional(),
    role: z.string().optional(),
  });

  fastify.get('/public/promotions', async (request, reply) => {
    const parsed = getPromotionsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_QUERY', message: 'Query inválida.' },
      });
    }

    const { region, role } = parsed.data;
    const now = new Date();

    try {
      const promotions = await (prisma as any).promotion.findMany({
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

      const filteredPromotions = promotions.filter((p: any) => {
        if (role && p.targetRole && p.targetRole !== 'ALL' && p.targetRole !== role) return false;

        if (p.regions && p.regions.length > 0 && (!region || !p.regions.includes(region))) return false;

        return true;
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
  });

  fastify.get('/public/billboards', async (request, reply) => {
    const parsed = getBillboardsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_QUERY', message: 'Query inválida.' },
      });
    }

    const { region } = parsed.data;
    const now = new Date();

    try {
      const regionFilter = region
        ? { OR: [{ regions: { isEmpty: true } }, { regions: { has: region } }] }
        : { regions: { isEmpty: true } };

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
            isOpen: isRestaurantOpenNow(
              p.restaurant.status,
              p.restaurant.isAcceptingOrders,
              p.restaurant.isPaused,
              p.restaurant.operatingHours
            ),
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
              discountPrice: { not: null },
              isAvailable: true,
              deleted: false,
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
              discountPrice: { not: null },
              isAvailable: true,
              deleted: false,
            },
            select: {
              id: true,
              name: true,
              description: true,
              price: true,
              discountPrice: true,
              image: true,
              categoryId: true,
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
          let maxRadius = restaurant.hasOwnDelivery
            ? restaurant.deliveryRadius
            : (regionsByCode.get(restaurant.region)?.deliveryRadius ?? null);
          if (maxRadius === null) return false;
          return distanceKm <= maxRadius;
        })
        .filter((restaurant) => isRestaurantOpenNow(RestaurantStatus.ACTIVE, restaurant.isAcceptingOrders, restaurant.isPaused, restaurant.operatingHours))
        .flatMap((restaurant: any) => {
          return restaurant.products.map((p: any) => {
            const savings = Math.round(p.price - (p.discountPrice ?? p.price));
            return {
              product: {
                id: p.id,
                name: p.name,
                description: p.description,
                price: p.price,
                discountPrice: p.discountPrice,
                image: p.image,
                categoryId: p.categoryId,
                savings,
                discountPercent: Math.round((savings / p.price) * 100),
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

      for (let i = offers.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [offers[i], offers[j]] = [offers[j], offers[i]];
      }

      return reply.send({ success: true, data: offers });
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
      return reply.status(500).send({
        success: false,
        error: {
          message: error.message || 'Error al guardar la solicitud.',
        },
      });
    }
  });

  fastify.get('/public/zonas-activas', async (request, reply) => {
    try {
      const restaurants = await prisma.restaurant.findMany({
        where: {
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
      return reply.status(500).send({
        success: false,
        error: { message: error.message || 'Error al obtener zonas activas.' },
      });
    }
  });
}
