import { FastifyInstance } from 'fastify';
import { UserRole } from '@prisma/client';
import { z } from 'zod';
import { authenticate, authorize, getAuthenticatedUser } from '../middleware/auth';
import { prisma } from '../config/database';
import { RESTAURANT_ID } from '../config/single-restaurant';
import { menuContentSchema, visibleMenuContent } from '../services/menu-content-policy';
import { readMenuContent, readMenuImage, saveMenuContent, saveMenuImage } from '../services/menu-content.service';

type MenuImage = { bytes: Buffer; contentType: string };
const IMAGE_CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_CACHED_IMAGES = 24;
const MAX_CACHED_IMAGE_BYTES = 512 * 1024;

async function loadMenuImage(id: string): Promise<MenuImage | null> {
  const source = await readMenuImage(id);
  if (!source) return null;
  if (typeof source !== 'string') return { bytes: source, contentType: 'image/webp' };

  // Keep one origin for the browser, including when the image lives in Cloudinary.
  const upstream = await fetch(source, { signal: AbortSignal.timeout(8000) });
  if (!upstream.ok) throw new Error(`Upstream ${upstream.status}`);
  return {
    bytes: Buffer.from(await upstream.arrayBuffer()),
    contentType: upstream.headers.get('content-type') || 'image/webp',
  };
}

function createMenuImageCache() {
  const entries = new Map<string, { value: MenuImage; expiresAt: number }>();
  const inFlight = new Map<string, Promise<MenuImage | null>>();
  return function getImage(id: string): Promise<MenuImage | null> {
    const cached = entries.get(id);
    if (cached) {
      entries.delete(id);
      if (cached.expiresAt > Date.now()) {
        entries.set(id, cached);
        return Promise.resolve(cached.value);
      }
    }
    const existing = inFlight.get(id);
    if (existing) return existing;
    // IDs are immutable and references don't change after upload. Skip caching
    // oversized legacy images and failures; cap resident bytes to ~12 MiB.
    const pending = loadMenuImage(id).then(value => {
      if (value && value.bytes.length <= MAX_CACHED_IMAGE_BYTES) {
        entries.set(id, { value, expiresAt: Date.now() + IMAGE_CACHE_TTL_MS });
        if (entries.size > MAX_CACHED_IMAGES) {
          const oldest = entries.keys().next().value;
          if (oldest !== undefined) entries.delete(oldest);
        }
      }
      return value;
    }).finally(() => { inFlight.delete(id); });
    inFlight.set(id, pending);
    return pending;
  };
}

export async function registerMenuContentRoutes(app: FastifyInstance) {
  const getImage = createMenuImageCache();
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
    try {
      const image = await getImage(parsed.data.id);
      if (!image) return reply.code(404).send();
      return reply.header('Cache-Control', 'public, max-age=86400, immutable')
        .header('X-Content-Type-Options', 'nosniff').type(image.contentType).send(image.bytes);
    } catch {
      return reply.code(502).send({ success: false, error: { message: 'No se pudo obtener la imagen promocional.' } });
    }
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
    restaurant.post('/restaurant-panel/menu-images', { bodyLimit: 4_500_000 }, async (request, reply) => {
      // 3 MiB binarios ocupan ~4 MiB al codificarse en base64.
      const parsed = z.object({ source: z.string().max(4_200_000) }).strict().safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ success: false, error: { message: 'Imagen no válida (máximo 3 MiB).' } });
      try { return reply.code(201).send({ success: true, data: await saveMenuImage(parsed.data.source) }); }
      catch (error: any) { if (!error.statusCode) throw error; return reply.code(error.statusCode).send({ success: false, error: { message: error.message } }); }
    });
  });
}
