/**
 * Routes Setup
 */

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
import { registerWhatsAppWebhookRoutes } from './whatsapp-webhook.routes';
import { registerAdminWhatsAppCaptureRoutes } from './admin-whatsapp-capture.routes';
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
  await registerAdminWhatsAppCaptureRoutes(fastify);
  await registerUploadRoutes(fastify);
  await registerCustomerRoutes(fastify);
  await registerPublicDeliveryRoutes(fastify);
  await fastify.register(registerWhatsAppWebhookRoutes);
};
