import { WINGSLAB_BUSINESS } from '@sadel/shared';
import { AppError } from '../errors/app-error';

export const RESTAURANT_ID = WINGSLAB_BUSINESS.restaurantId;
export function assertRestaurantId(value: unknown): void {
  if (value !== undefined && value !== RESTAURANT_ID) {
    throw new AppError(403, 'BUSINESS_SCOPE_VIOLATION', 'La operación no pertenece a WingsLab.');
  }
}

/** Defense in depth for all Prisma calls, including transactional services. */
export function businessQueryArgs(model: string, operation: string, original: any): any {
  const fields: Record<string, string> = {
    Restaurant: 'id', Order: 'restaurantId', Product: 'restaurantId', MenuCategory: 'restaurantId',
    PromoCode: 'restaurantId', RestaurantStats: 'restaurantId', OperatingHours: 'restaurantId',
    RestaurantBillingSettlement: 'restaurantId', RestaurantStoreCategory: 'restaurantId',
    Driver: 'restaurantId', DriverEarning: 'restaurantId', DriverPayout: 'restaurantId', LoyaltyCard: 'restaurantId',
    LoyaltyVisit: 'restaurantId', LoyaltyScanSession: 'restaurantId',
  };
  const field = fields[model];
  const orderScope = { order: { restaurantId: RESTAURANT_ID } };
  const indirect: Record<string, any> = {
    OrderItem: orderScope, OrderTracking: orderScope, DeliveryToken: orderScope,
    ProductOptionGroup: { product: { restaurantId: RESTAURANT_ID } },
    ProductOption: { group: { product: { restaurantId: RESTAURANT_ID } } },
    DriverStats: { driver: { restaurantId: RESTAURANT_ID } },
    DriverBillingSettlement: { driver: { restaurantId: RESTAURANT_ID } },
    LoyaltyStamp: { card: { restaurantId: RESTAURANT_ID } },
    LoyaltyRedemption: { card: { restaurantId: RESTAURANT_ID } },
  };
  const scope = field ? { [field]: RESTAURANT_ID } : indirect[model];
  if (!scope) return original;
  const args = { ...original };
  if (/^(find|count|aggregate|groupBy|update|delete|upsert)/.test(operation)) {
    const where = args.where || {};
    args.where = { ...where, AND: [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), scope] };
  }
  if (model === 'Restaurant' && /^(create|upsert|delete)/.test(operation)) {
    throw new AppError(403, 'BUSINESS_REGISTRATION_DISABLED', 'No se permite crear ni eliminar negocios.');
  }
  for (const key of ['data', 'create', 'update']) {
    if (!args[key]) continue;
    for (const data of Array.isArray(args[key]) ? args[key] : [args[key]]) {
      if (field && data[field] !== undefined) assertRestaurantId(data[field]);
      if (data.restaurant) {
        assertRestaurantId(data.restaurant.connect?.id);
        if (Object.keys(data.restaurant).some(k => k !== 'connect')) throw new AppError(403, 'BUSINESS_SCOPE_VIOLATION', 'Relación de negocio no permitida.');
      }
      if (model === 'Restaurant' && (data.hasOwnDelivery === false || data.supportsNetworkDelivery === true)) {
        throw new AppError(403, 'OWN_DELIVERY_REQUIRED', 'WingsLab utiliza exclusivamente reparto propio.');
      }
    }
  }
  return args;
}

export async function assertBusinessIdentity(db: any): Promise<void> {
  const row = await db.restaurant.findUnique({ where: { id: RESTAURANT_ID }, include: { user: true } });
  if (!row || row.user.role !== 'RESTAURANT' || !row.hasOwnDelivery) {
    throw new Error('[WingsLab] Configured restaurant identity/own delivery could not be verified.');
  }
}

export async function businessPrincipalAllowed(db: any, auth: { sub: string; role: string }): Promise<boolean> {
  if (auth.role === 'CUSTOMER') return true;
  if (auth.role === 'RESTAURANT') {
    const row = await db.restaurant.findUnique({ where: { id: RESTAURANT_ID }, select: { userId: true } });
    return row?.userId === auth.sub;
  }
  if (auth.role === 'DRIVER') {
    const driver = await db.driver.findFirst({
      where: { userId: auth.sub, restaurantId: RESTAURANT_ID },
      select: { status: true, user: { select: { status: true } } },
    });
    return driver?.status === 'ACTIVE' && driver.user.status === 'ACTIVE';
  }
  return false;
}
