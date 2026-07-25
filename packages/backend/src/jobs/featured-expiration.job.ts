import cron from 'node-cron';
import { FastifyInstance } from 'fastify';
import { prisma } from '../config/database';
import { sendPushNotification } from '../services/notification.service';
import { emitNotification } from '../services/socket.service';
import { logger } from '../utils/logger';

export function startFeaturedExpirationJob(fastify: FastifyInstance) {
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();

      const expired = await prisma.featuredPurchase.findMany({
        where: {
          status: 'APPROVED',
          endDate: { lte: now },
        },
        include: {
          restaurant: {
            select: { name: true, userId: true },
          },
        },
      });

      if (expired.length === 0) return;

      const ids = expired.map((p) => p.id);

      await prisma.featuredPurchase.updateMany({
        where: { id: { in: ids } },
        data: { status: 'EXPIRED' },
      });

      for (const purchase of expired) {
        const restaurantUserId = purchase.restaurant.userId;
        emitNotification(fastify.io, restaurantUserId, 'RESTAURANT', 'featured:status-changed', {
          purchaseId: purchase.id,
          status: 'EXPIRED',
          daysRequested: purchase.daysRequested,
        });
        void sendPushNotification(restaurantUserId, {
          title: 'Periodo destacado finalizado',
          body: `Tu periodo de ${purchase.daysRequested} día(s) como restaurante destacado ha terminado. Adquiere un nuevo paquete para seguir apareciendo.`,
          data: { type: 'featured', purchaseId: purchase.id, status: 'EXPIRED' },
        });
      }

      logger.info(`[FeaturedExpiration] Marcadas ${expired.length} compras como EXPIRED`);
    } catch (error) {
      logger.error('[FeaturedExpiration] Error al procesar vencimientos:', error);
    }
  });
}
