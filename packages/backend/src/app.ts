import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyJwt from '@fastify/jwt';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyCompress from '@fastify/compress';
import Fastify, { FastifyInstance } from 'fastify';
import { Server as SocketIOServer } from 'socket.io';
import crypto from 'node:crypto';
import http from 'http';
import { createAdapter } from '@socket.io/redis-adapter';

import './config/env';
import { validateEnvironment } from './config/env';
import { assertJobsDisabled, webPushRetryJobEnabled } from './config/isolation';
import { assertServiceIdentityVerified, isHermeticTest } from './config/env';
import { JobSelection, startSelectedJobs, validateJobSelection } from './jobs/policy';
import { prisma } from './config/database';
import { getRedis } from './config/redis';
import { errorHandler } from './middleware/error.handler';
import { setupRoutes } from './routes';
import { registerSingleRestaurantBoundary } from './middleware/single-restaurant';
import { setupSocketIO } from './services/socket.service';
import { setupNotificationSubscribers } from './subscribers/notification.subscriber';
import { buildRequestContext, getOrCreateRequestContext } from './utils/request-context';
import { logger } from './utils/logger';
import { registerOrderReviewTimeout, startOrderTimeoutJob } from './jobs/order-timeout.job';
import { startRestaurantHoursJob } from './jobs/restaurant-hours.job';
import { startDriverPickupAlertJob } from './jobs/driver-pickup-alert.job';
import { startStuckOrderJob } from './jobs/stuck-order.job';
import { startOwnDeliveryTimeoutJob } from './jobs/own-delivery-timeout.job';
import { startPickupReadyJob } from './jobs/pickup-ready.job';
import { startCustomerPickupReminderJob } from './jobs/customer-pickup-reminder.job';
import { startCustomerArrivalReminderJob } from './jobs/customer-arrival-reminder.job';
import { startOverduePreparationJob } from './jobs/overdue-preparation.job';
import { startScheduledDeliveryReminderJob } from './jobs/scheduled-delivery-reminder.job';
import { startCleanupOrphanMediaJob } from './jobs/cleanup-orphan-media.job';
import { startCleanupPushSubscriptionsJob } from './jobs/cleanup-push-subscriptions.job';
import { startNotificationRetryJob } from './jobs/notification-retry.job';
import { reconcileSubmittedCheckoutPayments, sweepExpiredCheckoutPayments } from './services/checkout-payment-intent';
import { settleVerifiedCheckoutPayment } from './services/checkout-settlement.service';
import { dispatchCheckoutKitchenOutbox } from './services/checkout-kitchen-outbox';
import { processCheckoutRefundOutbox } from './services/checkout-refund-outbox';
import { startOrderRingJob } from './jobs/order-ring.job';

declare module 'fastify' {
  interface FastifyInstance {
    io: SocketIOServer;
  }
}

type BuildAppOptions = {
  enableRateLimit?: boolean;
  enableSocketIO?: boolean;
  // Los trabajos de fondo (jobs/crons) acceden a la BD al arrancar. En tests
  // se desactivan para que el suite sea hermético y no dependa de Postgres.
  enableJobs?: boolean;
  jobs?: JobSelection;
};

const NODE_ENV = process.env.NODE_ENV || 'development';

// Fail-fast: sin JWT_SECRET la firma de tokens es predecible = toma de cuentas total.
function jwtSecret(): string {
  // La configuración local inyecta WINGSLAB_JWT_SECRET; aceptamos ambos nombres
  // para que el secreto sea estable entre reinicios. Si no, los tokens de
  // registro y sesión se invalidarían en cada despliegue del backend.
  const configured = process.env.JWT_SECRET || process.env.WINGSLAB_JWT_SECRET;
  if (!configured) {
    if (NODE_ENV === 'production') {
      throw new Error('FATAL: JWT_SECRET is required in production.');
    }
    console.warn('[AUTH] JWT_SECRET no configurado — generando secreto efimero de desarrollo. Las sesiones se invalidan al reiniciar.');
  }

  // Nunca usar un secreto hardcodeado. En desarrollo, si falta, se genera uno
  // aleatorio por proceso (sesiones efímeras, seguro por defecto).
  return configured || crypto.randomBytes(32).toString('hex');
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const { enableRateLimit = true, enableSocketIO = true, enableJobs = false } = options;
  assertJobsDisabled(enableJobs);
  const requestedJobs = options.jobs || (webPushRetryJobEnabled() ? { notificationRetry: true } : {});
  validateJobSelection(requestedJobs);
  assertServiceIdentityVerified();
  if (!isHermeticTest()) validateEnvironment();
  const JWT_SECRET = jwtSecret();

  const httpServer = http.createServer();

  const fastify = Fastify({
    logger: NODE_ENV === 'development',
    bodyLimit: 10485760,
    requestTimeout: 30000,
    // Only the WingsLab edge relay is trusted to set X-Forwarded-For. Trusting
    // every hop-0 peer would let a client that reaches 3101 directly forge
    // `X-Forwarded-For: 127.0.0.1` and bypass every route rate limit.
    trustProxy: (address, hop) => hop === 0 && address === '172.30.240.30',
    serverFactory: (handler) => {
      httpServer.on('request', (req, res) => {
        if (req.url?.startsWith('/socket.io')) {
          return;
        }
        handler(req, res);
      });
      return httpServer;
    },
  });

  registerSingleRestaurantBoundary(fastify);
  await fastify.register(fastifyHelmet, {
    // Los frontends (3102/3103/3104) cargan imágenes y media desde este origen.
    // `same-origin` bloquearía los <img> cross-origin con NotSameOrigin.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        connectSrc: ["'self'", "https:", "wss:", "ws:"],
      },
    },
  });

  await fastify.register(fastifyCompress, {
    global: true,
    threshold: 1024,
  });

  await fastify.register(fastifyCors, {
    origin: (origin, cb) => {
      const corsOrigin = process.env.CORS_ORIGIN || '*';
      if (corsOrigin === '*' || !origin) {
        cb(null, true);
      } else {
        const allowedOrigins = corsOrigin.split(',').map((o) => o.trim());
        if (allowedOrigins.indexOf(origin) !== -1) {
          cb(null, true);
        } else {
          cb(new Error('Origin not allowed by CORS'), false);
        }
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });

  await fastify.register(fastifyJwt, {
    secret: JWT_SECRET,
    sign: {
      expiresIn: '7d',
    },
  });

  if (enableRateLimit) {
    await fastify.register(fastifyRateLimit, {
      max: Number(process.env.RATE_LIMIT_MAX || 300),
      timeWindow: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
      cache: 10000,
      allowList: ['127.0.0.1'],
      redis: getRedis(),
      keyGenerator: (request) => {
        return request.ip;
      },
    });
  }

  if (enableSocketIO) {
    // Socket.io se adjunta directamente al httpServer que Fastify comparte por
    // serverFactory (el mismo que ya enruta /socket.io fuera de fastify). Esto
    // elimina la dependencia fastify-socket.io, que no soporta Fastify 5.
    fastify.decorate(
      'io',
      new SocketIOServer(httpServer, {
        cors: {
          origin: process.env.CORS_ORIGIN || '*',
          credentials: true,
        },
        pingInterval: 10000,
        pingTimeout: 5000,
      })
    );
  }

  fastify.addHook('onRequest', async (request, reply) => {
    const requestContext = getOrCreateRequestContext(request);

    reply.header('x-request-id', requestContext.requestId);
    logger.info('Request started', buildRequestContext(request));
  });

  fastify.addHook('onResponse', async (request, reply) => {
    const requestContext = getOrCreateRequestContext(request);
    const context = buildRequestContext(request);
    const durationMs = Date.now() - requestContext.startedAt;

    reply.header('x-request-id', requestContext.requestId);

    logger.info('Request completed', {
      ...context,
      statusCode: reply.statusCode,
      durationMs,
    });
  });

  if (enableSocketIO) {
    if (process.env.REDIS_URL) {
      try {
        const redisClient = getRedis();
        const subClient = redisClient.duplicate();
        fastify.io.adapter(createAdapter(redisClient, subClient));
        logger.info('[Redis] Socket.io Redis adapter configured');
      } catch (err) {
        logger.warn('[Redis] Adapter falló — socket.io sin Redis (1 instancia)');
      }
    } else {
      logger.info('[Redis] REDIS_URL no configurado — socket.io sin adapter');
    }

    setupSocketIO(fastify.io, (token) => {
      if (typeof token !== 'string' || !token) {
        return null;
      }
      try {
        const payload = fastify.jwt.verify<{ sub: string; role: string }>(token);
        if (!payload?.sub || !payload?.role) {
          return null;
        }
        return { sub: payload.sub, role: payload.role };
      } catch {
        return null;
      }
    });
    setupNotificationSubscribers(fastify);
  }

  fastify.addHook('preClose', async () => {
    // Upgraded sockets must disconnect before Fastify waits for HTTP to close.
    if (enableSocketIO && fastify.io) fastify.io.engine.close();
  });

  fastify.addHook('onClose', async () => {
    if (enableSocketIO && fastify.io) {
      await fastify.io.close();
    }
  });

  await setupRoutes(fastify);
  // Enable only after the checkout intent migration is deployed.
  if (process.env.WINGSLAB_CHECKOUT_RESERVATION_SWEEP === 'true') {
    let running: Promise<void> | undefined;
    const timer = setInterval(() => {
      if (running) return;
      running = sweepExpiredCheckoutPayments(prisma, (err, intentId) => {
        fastify.log.error({ err, intentId }, 'No se pudo liberar la reserva de pago');
      }).catch(err => {
        fastify.log.error({ err }, 'No se pudieron consultar las reservas vencidas');
      }).then(async () => {
        await reconcileSubmittedCheckoutPayments(
          prisma,
          process.env.WINGSLAB_MP_SANDBOX_ACCESS_TOKEN || '',
          {
            onVerified: (intentId, order) => settleVerifiedCheckoutPayment(prisma, fastify.io, intentId, order, err => {
              fastify.log.error({ err, intentId }, 'Pedido pagado reconciliado; pendiente de entregar a cocina');
            }),
            onError: (err, intentId) => {
              fastify.log.error({ err, intentId }, 'No se pudo conciliar el intento de pago; se reintentará');
            },
          },
        );
        await dispatchCheckoutKitchenOutbox(prisma, fastify.io, (err, orderId) => {
          fastify.log.error({ err, orderId }, 'No se pudo entregar el pedido pagado a cocina; se reintentará');
        });
        await processCheckoutRefundOutbox(prisma, process.env.WINGSLAB_MP_SANDBOX_ACCESS_TOKEN, (err, orderId) => {
          fastify.log.error({ err, orderId }, 'No se pudo confirmar un reembolso de tarjeta; se reintentará');
        });
      }).catch(err => {
        fastify.log.error({ err }, 'No se pudieron procesar entregas de pedidos pagados');
      }).finally(() => { running = undefined; });
    }, 60_000);
    timer.unref();
    fastify.addHook('onClose', async () => {
      clearInterval(timer);
      await running;
    });
  }
  if (process.env.WINGSLAB_RUNTIME_AUTHORIZED === 'reviewed-phase-2b') registerOrderReviewTimeout(fastify);

  startSelectedJobs(requestedJobs, {
    orderTimeout: () => startOrderTimeoutJob(fastify), restaurantHours: () => startRestaurantHoursJob(fastify),
    driverPickupAlert: () => startDriverPickupAlertJob(fastify),
    stuckOrder: () => startStuckOrderJob(fastify),
    pickupReady: () => startPickupReadyJob(fastify), ownDeliveryTimeout: () => startOwnDeliveryTimeoutJob(fastify),
    customerPickupReminder: () => startCustomerPickupReminderJob(fastify), customerArrivalReminder: () => startCustomerArrivalReminderJob(fastify),
    overduePreparation: () => startOverduePreparationJob(fastify), scheduledDeliveryReminder: () => startScheduledDeliveryReminderJob(fastify), cleanupOrphanMedia: () => startCleanupOrphanMediaJob(),
    cleanupPushSubscriptions: () => startCleanupPushSubscriptionsJob(), notificationRetry: () => startNotificationRetryJob(),
    orderRing: () => startOrderRingJob(),
  });

  fastify.setErrorHandler(errorHandler);

  fastify.get('/health', async () => {
    const redis = getRedis();
    const [dbOk, redisOk] = await Promise.allSettled([
      prisma.$queryRaw`SELECT 1`,
      redis.ping(),
    ]);

    const ioStatus = fastify.io?.listeners?.('connection')?.length
      ? 'healthy'
      : 'no_listeners';

    return {
      status:
        dbOk.status === 'fulfilled' && redisOk.status === 'fulfilled'
          ? 'ok'
          : 'degraded',
      db: dbOk.status === 'fulfilled' ? 'healthy' : 'unreachable',
      redis: redisOk.status === 'fulfilled' ? 'healthy' : 'unreachable',
      socketio: ioStatus,
      timestamp: new Date().toISOString(),
      environment: NODE_ENV,
      uptime: process.uptime(),
    };
  });

  return fastify;
}
