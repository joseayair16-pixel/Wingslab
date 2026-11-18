/**
 * Routes Setup
 */

import { FastifyInstance } from 'fastify';
import { registerAuthRoutes } from './auth.routes';
import { registerCustomerRoutes } from './customer.routes';
import { registerNotificationRoutes } from './notification.routes';
import { registerDriverPanelRoutes } from './driver-panel.routes';
import { registerOrderRoutes } from './order.routes';
import { registerPublicRoutes } from './public.routes';
import { registerRestaurantOrderRoutes } from './restaurant-orders.routes';
import { registerRestaurantDriverRoutes } from './restaurant-driver.routes';
import { registerRestaurantPanelRoutes } from './restaurant-panel.routes';
import { registerUploadRoutes } from './uploads.routes';
import { registerPublicDeliveryRoutes } from './public-delivery.routes';
import { registerOrderChatRoutes } from './order-chat.routes';
import { registerWhatsAppWebhookRoutes } from './whatsapp-webhook.routes';
import { registerMenuContentRoutes } from './menu-content.routes';

export const setupRoutes = async (fastify: FastifyInstance) => {
  // Health check is defined in index.ts

  fastify.get('/', () => {
    return {
      message: 'WingsLab API · restaurante único',
      version: '1.0.0',
    };
  });

  await registerPublicRoutes(fastify);
  await registerMenuContentRoutes(fastify);
  await registerAuthRoutes(fastify);
  await registerDriverPanelRoutes(fastify);
  await registerNotificationRoutes(fastify);
  await registerOrderChatRoutes(fastify);
  await registerRestaurantPanelRoutes(fastify);
  await registerRestaurantOrderRoutes(fastify);
  await registerRestaurantDriverRoutes(fastify);
  await registerOrderRoutes(fastify);
  await registerUploadRoutes(fastify);
  await registerCustomerRoutes(fastify);
  await registerPublicDeliveryRoutes(fastify);
  await fastify.register(registerWhatsAppWebhookRoutes);
};
