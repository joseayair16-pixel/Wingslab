import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../config/database';
import { sendPushNotification, isVapidConfigured } from '../services/notification.service';

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string(),
  }),
});

const fcmTokenSchema = z.object({
  token: z.string().min(1),
  platform: z.string().max(50).optional(),
  // versionCode nativo del APK (para habilitar la alarma continua por FGS).
  appVersion: z.number().int().nonnegative().max(1_000_000).optional(),
});

export async function registerNotificationRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/notifications/subscribe', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Debes iniciar sesión para suscribirte a las notificaciones.',
        },
      });
    }

    const parsed = subscribeSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_PAYLOAD',
          message: 'Datos de suscripción inválidos.',
        },
      });
    }

    const payload = request.user as { sub: string };
    const { endpoint, keys } = parsed.data;

    try {
      await prisma.pushSubscription.upsert({
        where: { endpoint },
        update: {
          userId: payload.sub,
          p256dh: keys.p256dh,
          auth: keys.auth,
        },
        create: {
          userId: payload.sub,
          endpoint,
          p256dh: keys.p256dh,
          auth: keys.auth,
        },
      });

      return reply.send({
        success: true,
        message: 'Suscripción guardada correctamente.',
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: {
          code: 'SERVER_ERROR',
          message: 'No se pudo guardar la suscripción.',
        },
      });
    }
  });

  fastify.post('/notifications/fcm-token', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Debes iniciar sesión para registrar tu dispositivo.',
        },
      });
    }

    const parsed = fcmTokenSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_PAYLOAD',
          message: 'Token FCM inválido.',
        },
      });
    }

    const payload = request.user as { sub: string };
    const { token, platform, appVersion } = parsed.data;

    try {
      await prisma.fcmToken.upsert({
        where: { token },
        update: {
          userId: payload.sub,
          platform: platform || 'android',
          ...(appVersion !== undefined ? { appVersion } : {}),
        },
        create: {
          userId: payload.sub,
          token,
          platform: platform || 'android',
          appVersion: appVersion ?? null,
        },
      });

      return reply.send({
        success: true,
        message: 'Token FCM registrado correctamente.',
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: {
          code: 'SERVER_ERROR',
          message: 'No se pudo registrar el token FCM.',
        },
      });
    }
  });

  fastify.get('/notifications/vapid-key', async (request, reply) => {
    if (!isVapidConfigured()) {
      return reply.status(503).send({
        success: false,
        configured: false,
        publicKey: null,
        error: {
          code: 'VAPID_NOT_CONFIGURED',
          message: 'Las notificaciones push no están configuradas en el servidor.',
        },
      });
    }

    return reply.send({
      success: true,
      configured: true,
      publicKey: process.env.VAPID_PUBLIC_KEY,
    });
  });

  fastify.post('/notifications/test-push', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Debes iniciar sesión para probar notificaciones.' },
      });
    }

    const payload = request.user as { sub: string; role?: string };
    request.log.info(`[PushTest] Enviando notificación de prueba a usuario ${payload.sub}`);

    const result = await sendPushNotification(payload.sub, {
      title: '🔔 Notificación de prueba',
      body: '¡Las notificaciones push funcionan correctamente!',
      tag: 'test-push',
      vibrate: [200, 100, 200],
    });

    return reply.send({
      success: result.success,
      message: result.success
        ? `Notificación enviada (${result.totalSent}/${result.totalAttempted} exitosos)`
        : 'No se pudo enviar la notificación. ¿Tienes una suscripción push activa?',
      details: result,
    });
  });
}
