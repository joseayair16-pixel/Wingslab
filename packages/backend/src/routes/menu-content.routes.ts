import { FastifyInstance } from 'fastify';
import { UserRole } from '@prisma/client';
import { z } from 'zod';
import { authenticate, authorize, getAuthenticatedUser } from '../middleware/auth';
import { prisma } from '../config/database';
import { RESTAURANT_ID } from '../config/single-restaurant';
import { menuContentSchema, visibleMenuContent } from '../services/menu-content-policy';
import { readMenuContent, readMenuImage, saveMenuContent, saveMenuImage } from '../services/menu-content.service';

export async function registerMenuContentRoutes(app: FastifyInstance) {
  app.get('/public/menu-content', async (request, reply) => {
    let customer = false;
    if (request.headers.authorization) {
      await authenticate(request, reply);
      if (reply.sent) return;
      customer = getAuthenticatedUser(request).role === UserRole.CUSTOMER;
    }
    reply.header('Cache-Control', 'no-store');
    const content = await readMenuContent();
    return { success: true, data: visibleMenuContent(content.items, customer) };
  });
  app.get('/public/menu-images/:id', async (request, reply) => {
    const parsed = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!parsed.success) return reply.code(404).send();
    const image = await readMenuImage(parsed.data.id);
    if (!image) return reply.code(404).send();
    if (typeof image === 'string') {
      // El binario vive en Cloudinary, pero se sirve desde este mismo origen:
      // evita redirecciones cross-origin, CORP/CSP y service workers.
      try {
        const upstream = await fetch(image, { signal: AbortSignal.timeout(8000) });
        if (!upstream.ok) throw new Error(`Upstream ${upstream.status}`);
        const bytes = Buffer.from(await upstream.arrayBuffer());
        const contentType = upstream.headers.get('content-type') || 'image/webp';
        return reply
          .header('Cache-Control', 'public, max-age=86400, immutable')
          .header('X-Content-Type-Options', 'nosniff')
          .type(contentType)
          .send(bytes);
      } catch {
        return reply.code(502).send({ success: false, error: { message: 'No se pudo obtener la imagen promocional.' } });
      }
    }
    return reply.header('Cache-Control', 'public, max-age=86400, immutable')
      .header('X-Content-Type-Options', 'nosniff').type('image/webp').send(image);
  });
  await app.register(async restaurant => {
    restaurant.addHook('preHandler', authenticate);
    restaurant.addHook('preHandler', authorize([UserRole.RESTAURANT]));
    restaurant.addHook('preHandler', async (request, reply) => {
      const owner = await prisma.restaurant.findFirst({ where: { id: RESTAURANT_ID, userId: getAuthenticatedUser(request).sub }, select: { id: true } });
      if (!owner) return reply.code(403).send({ success: false, error: { message: 'Solo el dueño de WingsLab puede editar este contenido.' } });
    });
    restaurant.get('/restaurant-panel/menu-content', async () => ({ success: true, data: await readMenuContent() }));
    restaurant.put('/restaurant-panel/menu-content', async (request, reply) => {
      const parsed = menuContentSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ success: false, error: { message: parsed.error.issues[0]?.message } });
      try { return { success: true, data: await saveMenuContent(parsed.data) }; }
      catch (error: any) { if (!error.statusCode) throw error; return reply.code(error.statusCode).send({ success: false, error: { message: error.message } }); }
    });
    restaurant.post('/restaurant-panel/menu-images', { bodyLimit: 3 * 1024 * 1024 }, async (request, reply) => {
      const parsed = z.object({ source: z.string().max(2_800_000) }).strict().safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ success: false, error: { message: 'Imagen no válida (máximo 2 MiB).' } });
      try { return reply.code(201).send({ success: true, data: await saveMenuImage(parsed.data.source) }); }
      catch (error: any) { if (!error.statusCode) throw error; return reply.code(error.statusCode).send({ success: false, error: { message: error.message } }); }
    });
  });
}
