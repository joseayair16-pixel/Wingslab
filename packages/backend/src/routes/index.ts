/**
 * Routes Setup
 */

import bcrypt from 'bcryptjs';
import { prisma } from '../config/database';
import { FastifyInstance } from 'fastify';
import { registerAdminRoutes } from './admin.routes';
import { registerAdminDriverRoutes } from './admin-drivers.routes';
import { registerAuthRoutes } from './auth.routes';
import { registerCustomerRoutes } from './customer.routes';
import { registerNotificationRoutes } from './notification.routes';
import { registerDriverPanelRoutes } from './driver-panel.routes';
import { registerOrderRoutes } from './order.routes';
import { registerPublicRoutes } from './public.routes';
import { registerRestaurantOrderRoutes } from './restaurant-orders.routes';
import { registerRestaurantPanelRoutes } from './restaurant-panel.routes';
import { registerUploadRoutes } from './uploads.routes';
import { registerPublicDeliveryRoutes } from './public-delivery.routes';
import { registerOrderChatRoutes } from './order-chat.routes';
import { registerAdminCategoriesRoutes } from './admin-categories.routes';
import { registerAdminOrdersRoutes } from './admin-orders.routes';

export const setupRoutes = async (fastify: FastifyInstance) => {
  // Health check is defined in index.ts

  fastify.get('/', () => {
    return {
      message: 'Welcome to SaDeL API',
      version: '1.0.0',
    };
  });

  // Bootstrap first admin (safe: only works when no admin exists)
  fastify.post('/auth/bootstrap-admin', async (request, reply) => {
    const adminCount = await prisma.admin.count();
    if (adminCount > 0) {
      return reply.status(400).send({ success: false, message: 'Ya existe un administrador.' });
    }
    const password = await bcrypt.hash('admin123', 10);
    const admin = await prisma.user.create({
      data: {
        email: 'admin@sadel.com',
        phone: '5500000000',
        name: 'Administrador Principal',
        password,
        role: 'ADMIN',
        region: 'MX-CDMX',
        status: 'ACTIVE',
        admin: { create: {} },
      },
    });
    return { success: true, phone: admin.phone };
  });

  await registerPublicRoutes(fastify);
  await registerAuthRoutes(fastify);
  await registerNotificationRoutes(fastify);
  await registerOrderChatRoutes(fastify);
  await registerAdminCategoriesRoutes(fastify);
  await registerAdminOrdersRoutes(fastify);
  await registerAdminDriverRoutes(fastify);
  await registerRestaurantPanelRoutes(fastify);
  await registerRestaurantOrderRoutes(fastify);
  await registerDriverPanelRoutes(fastify);
  await registerOrderRoutes(fastify);
  await registerAdminRoutes(fastify);
  await registerUploadRoutes(fastify);
  await registerCustomerRoutes(fastify);
  await registerPublicDeliveryRoutes(fastify);
};
