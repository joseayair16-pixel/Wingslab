/**
 * Consulta administrativa de la captura TEMPORAL de WhatsApp.
 *
 * No expone una bandeja de entrada: solo devuelve los mensajes que la captura
 * temporal retuvo en Redis (cifrados, con TTL de minutos) y permite purgar los
 * de inmediato. Ambos endpoints exigen sesión válida con rol ADMIN usando el
 * middleware de autenticación/autorización ya existente en el backend.
 */

import { UserRole } from '@prisma/client';
import { FastifyInstance } from 'fastify';

import { authenticate, authorize } from '../middleware/auth';
import {
  clearCapturedMessages,
  getWhatsAppCaptureConfig,
  isWhatsAppCaptureEnabled,
  listCapturedMessages,
} from '../services/whatsapp-capture.service';

export async function registerAdminWhatsAppCaptureRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.register(async function adminWhatsAppCaptureScope(admin) {
    admin.addHook('preHandler', authenticate);
    admin.addHook('preHandler', authorize([UserRole.ADMIN]));

    admin.get(
      '/admin/whatsapp/captura',
      { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
      async (_request, reply) => {
        if (!isWhatsAppCaptureEnabled()) {
          return reply.status(404).send({
            success: false,
            error: {
              code: 'CAPTURE_DISABLED',
              message: 'La captura temporal de WhatsApp esta desactivada.',
            },
          });
        }

        const messages = await listCapturedMessages();
        const config = getWhatsAppCaptureConfig();

        return reply.send({
          success: true,
          data: {
            messages,
            total: messages.length,
            ttlSeconds: config.ttlSeconds,
            maxMessages: config.maxMessages,
          },
        });
      }
    );

    // Purga inmediata: útil para cerrar el incidente sin esperar al TTL.
    admin.delete(
      '/admin/whatsapp/captura',
      { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
      async (_request, reply) => {
        const removed = await clearCapturedMessages();
        return reply.send({
          success: true,
          data: { removed },
        });
      }
    );
  });
}
