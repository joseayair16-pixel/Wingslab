import { UserRole } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { sendAppError } from '../errors/http';
import { authenticate, authorize, getAuthenticatedUser } from '../middleware/auth';
import { MediaUploadKind, uploadImage } from '../services/storage.service';
import { getOrCreateRequestContext } from '../utils/request-context';

const uploadImageSchema = z.object({
  kind: z.enum([
    'restaurant-logo',
    'restaurant-cover',
    'product-image',
    'payment-proof',
    'driver-photo',
  ] satisfies [MediaUploadKind, ...MediaUploadKind[]]),
  source: z
    .string()
    .min(1, 'La imagen es obligatoria.')
    .max(12_000_000, 'La imagen es demasiado grande para procesarse.'),
  fileName: z.string().max(200, 'El nombre del archivo es demasiado largo.').optional(),
});

export async function registerUploadRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.register(async function uploadScope(upload) {
    upload.addHook('preHandler', authenticate);
    upload.addHook('preHandler', authorize([UserRole.RESTAURANT, UserRole.CUSTOMER, UserRole.DRIVER]));

    upload.post('/uploads/images', async (request, reply) => {
      const parsed = uploadImageSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: parsed.error.issues[0]?.message || 'Datos invalidos.',
          },
        });
      }

      const user = getAuthenticatedUser(request);
      const requestContext = getOrCreateRequestContext(request);

      try {
        const asset = await uploadImage({
          source: parsed.data.source,
          kind: parsed.data.kind,
          actorId: user.sub,
          requestId: requestContext.requestId,
          fileName: parsed.data.fileName,
        });

        return reply.send({
          success: true,
          data: asset,
        });
      } catch (error) {
        return sendAppError(reply, error);
      }
    });
  });
}
