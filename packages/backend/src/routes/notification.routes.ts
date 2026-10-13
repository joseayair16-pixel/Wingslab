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

const fcmTokenRevokeSchema = z.object({
  token: z.string().min(1).max(4096),
});

const subscriptionRevokeSchema = z.object({
  endpoint: z.string().url().max(2048),
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

  /**
   * Revoca el token FCM de este dispositivo. Se usa al cerrar sesión o al
   * desactivar notificaciones, para que el dispositivo deje de recibir los
   * avisos del usuario anterior aunque todavía estén encolados. La fila solo
   * puede ser de quien llama (evita borrar tokens ajenos).
   */
  fastify.delete('/notifications/fcm-token', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Debes iniciar sesión para gestionar tus dispositivos.',
        },
      });
    }

    const parsed = fcmTokenRevokeSchema.safeParse(request.body);

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

    try {
      const removed = await prisma.fcmToken.deleteMany({
        where: { token: parsed.data.token, userId: payload.sub },
      });

      return reply.send({ success: true, removed: removed.count });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: {
          code: 'SERVER_ERROR',
          message: 'No se pudo revocar el token FCM.',
        },
      });
    }
  });

  /**
   * Revoca una suscripción Web Push de este dispositivo (mismo propósito que
   * el endpoint anterior, para el canal web/PWA).
   */
  fastify.delete('/notifications/subscription', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Debes iniciar sesión para gestionar tus dispositivos.',
        },
      });
    }

    const parsed = subscriptionRevokeSchema.safeParse(request.body);

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

    try {
      const removed = await prisma.pushSubscription.deleteMany({
        where: { endpoint: parsed.data.endpoint, userId: payload.sub },
      });

      return reply.send({ success: true, removed: removed.count });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: {
          code: 'SERVER_ERROR',
          message: 'No se pudo revocar la suscripción.',
        },
      });
    }
  });

  const unpairDeviceSchema = z
    .object({
      fcmToken: z.string().min(1).max(4096).optional(),
      endpoint: z.string().url().max(2048).optional(),
    })
    .refine((data) => Boolean(data.fcmToken || data.endpoint), {
      message: 'Debes proporcionar al menos un token FCM o endpoint.',
    });

  /**
   * Desvincula de forma segura este dispositivo del usuario anterior.
   * Si incluye JWT, delimita el borrado al usuario autenticado.
   * Si no incluye JWT (desvinculación diferida por cierre offline),
   * revoca por posesión exclusiva del token o endpoint de este dispositivo.
   */
  fastify.post('/notifications/unpair', async (request, reply) => {
    const parsed = unpairDeviceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_PAYLOAD',
          message: 'Datos de dispositivo inválidos.',
        },
      });
    }

    let authenticatedUserId: string | null = null;
    try {
      await request.jwtVerify();
      const payload = request.user as { sub?: string };
      authenticatedUserId = payload?.sub || null;
    } catch {
      authenticatedUserId = null;
    }

    const { fcmToken, endpoint } = parsed.data;
    let removedFcm = 0;
    let removedWeb = 0;

    try {
      if (fcmToken) {
        const res = await prisma.fcmToken.deleteMany({
          where: authenticatedUserId
            ? { token: fcmToken, userId: authenticatedUserId }
            : { token: fcmToken },
        });
        removedFcm = res.count;
      }

      if (endpoint) {
        const res = await prisma.pushSubscription.deleteMany({
          where: authenticatedUserId
            ? { endpoint, userId: authenticatedUserId }
            : { endpoint },
        });
        removedWeb = res.count;
      }

      return reply.send({
        success: true,
        removed: removedFcm + removedWeb,
        fcm: removedFcm,
        web: removedWeb,
      });
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: {
          code: 'SERVER_ERROR',
          message: 'No se pudo desvincular el dispositivo.',
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
