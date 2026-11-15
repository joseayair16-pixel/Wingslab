import type { FastifyInstance } from 'fastify';
import { prisma } from '../config/database';
import { assertRestaurantId, businessPrincipalAllowed, RESTAURANT_ID } from '../config/single-restaurant';
import { AppError } from '../errors/app-error';

export function marketplaceRouteBlocked(path: string): boolean {
  return /^\/(admin(?:\/|$)|driver(?:-panel)?(?:\/|$)|restaurant\/featured(?:\/|$))/.test(path) ||
    ['/restaurantes', '/store-categories', '/public/solicitudes', '/public/featured', '/public/ofertas',
      '/public/billboards', '/public/promotions', '/public/zonas-activas', '/auth/admin-login', '/auth/driver-login'].includes(path) ||
    /^\/restaurant-panel\/(?:repartidores|facturacion|soporte-red|pedidos-apoyo)(?:\/|$)/.test(path) ||
    /\/(?:solicitar-apoyo|aceptar-apoyo|rechazar-apoyo|asignar-repartidor|buscar-repartidor|notificar-repartidores|handover)$/.test(path);
}

export function registerSingleRestaurantBoundary(app: FastifyInstance): void {
  app.addHook('preHandler', async (request) => {
    const path = request.url.split('?')[0];
    if (marketplaceRouteBlocked(path)) throw new AppError(404, 'FEATURE_NOT_AVAILABLE', 'Esta función no forma parte de WingsLab.');
    if (path.startsWith('/restaurantes/')) assertRestaurantId((request.params as any)?.id);
    // Check before any handler uses a relation identifier. Missing ID is allowed:
    // the authoritative identity comes from server configuration.
    const visit = async (value: any): Promise<void> => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) { for (const item of value) await visit(item); return; }
      if ('restaurantId' in value) assertRestaurantId(value.restaurantId);
      if (value.hasOwnDelivery === false || value.supportsNetworkDelivery === true || value.supportRestaurantId || value.driverId) {
        throw new AppError(403, 'OWN_DELIVERY_REQUIRED', 'Solo se admite reparto propio de WingsLab.');
      }
      for (const [key, val] of Object.entries(value)) {
        if ((key === 'productId' || key === 'categoryId') && typeof val === 'string') {
          const model = key === 'productId' ? prisma.product : prisma.menuCategory;
          const row = await (model as any).findFirst({ where: { id: val, restaurantId: RESTAURANT_ID }, select: { id: true } });
          if (!row) throw new AppError(403, 'BUSINESS_SCOPE_VIOLATION', 'Producto o categoría ajenos a WingsLab.');
        }
        await visit(val);
      }
    };
    await visit(request.query);
    await visit(request.body);
    if (request.headers.authorization) {
      let auth: { sub: string; role: string } | undefined;
      try { auth = await request.jwtVerify<{ sub: string; role: string }>(); } catch { return; } // Existing authentication handles invalid credentials.
      if (auth && !await businessPrincipalAllowed(prisma, auth)) throw new AppError(403, 'BUSINESS_SCOPE_VIOLATION', 'Sesión no autorizada para WingsLab.');
    }
  });
}
