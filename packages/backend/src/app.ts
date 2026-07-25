import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyJwt from '@fastify/jwt';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyCompress from '@fastify/compress';
import Fastify, { FastifyInstance } from 'fastify';
import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';

import './config/env';
import { validateEnvironment } from './config/env';
import { prisma } from './config/database';
import { getRedis } from './config/redis';
import { errorHandler } from './middleware/error.handler';
import { setupRoutes } from './routes';
import { setupSocketIO } from './services/socket.service';
import { setupNotificationSubscribers } from './subscribers/notification.subscriber';
import { buildRequestContext, getOrCreateRequestContext } from './utils/request-context';
import { logger } from './utils/logger';
import { recordRequestMetric, getMetricsSnapshot } from './utils/metrics';
import { startBillingJob } from './jobs/billing.job';
import { startBillingOverdueJob } from './jobs/billing-overdue.job';
import { startOrderTimeoutJob } from './jobs/order-timeout.job';
import { startJitDispatchJob } from './jobs/jit-dispatch.job';
import { startRestaurantHoursJob } from './jobs/restaurant-hours.job';
import { startDriverPickupAlertJob } from './jobs/driver-pickup-alert.job';
import { startStuckOrderJob } from './jobs/stuck-order.job';
import { startDriverBillingCutoffJob } from './jobs/driver-billing-cutoff.job';
import { scheduleDriverBillingOverdueCron, processOverdueDriverSettlements } from './jobs/driver-billing-overdue.job';
import { startFeaturedExpirationJob } from './jobs/featured-expiration.job';
import { startPickupReadyJob } from './jobs/pickup-ready.job';
import { startCustomerPickupReminderJob } from './jobs/customer-pickup-reminder.job';
import { startCleanupProofsJob } from './jobs/cleanup-proofs.job';

type BuildAppOptions = {
  enableRateLimit?: boolean;
  enableSocketIO?: boolean;
};

const NODE_ENV = process.env.NODE_ENV || 'development';

// Validar variables de entorno al arrancar
if (NODE_ENV === 'production') {
  validateEnvironment();
}

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

function createNoopSocketServer(): SocketIOServer {
  return {
    to() {
      return {
        emit() {
          return true;
        },
      };
    },
  } as unknown as SocketIOServer;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const { enableRateLimit = true, enableSocketIO = true } = options;
  const fastify = Fastify({
    logger: NODE_ENV === 'development',
    bodyLimit: 10485760, // 10MB
    requestTimeout: 30000, // 30s timeout
  });

  // Configuración de cabeceras seguras (Helmet) con Content Security Policy
  await fastify.register(fastifyHelmet, {
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

  // Compresión gzip/brotli para respuestas más rápidas
  await fastify.register(fastifyCompress, {
    global: true,
    threshold: 1024, // solo comprimir respuestas > 1KB
  });

  // Configuración de CORS segura y compatible con cookies/credenciales
  await fastify.register(fastifyCors, {
    origin: (origin, cb) => {
      const corsOrigin = process.env.CORS_ORIGIN || '*';
      // Allow non-browser requests (no origin header) and matching origins
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
  });

  // JWT con expiración de sesión reducida a 7 días por seguridad
  await fastify.register(fastifyJwt, {
    secret: JWT_SECRET,
    sign: {
      expiresIn: '7d',
    },
  });

  if (enableRateLimit) {
    await fastify.register(fastifyRateLimit, {
      max: 100,
      timeWindow: '1 minute',
      cache: 10000,
      allowList: ['127.0.0.1'],
      redis: getRedis(),
      keyGenerator: (request) => {
        return request.ip;
      },
    });
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

    recordRequestMetric({
      method: request.method,
      route: request.routeOptions.url || request.url,
      statusCode: reply.statusCode,
      durationMs,
    });

    logger.info('Request completed', {
      ...context,
      statusCode: reply.statusCode,
      durationMs,
    });
  });

  fastify.io = enableSocketIO
    ? new SocketIOServer(fastify.server, {
        cors: {
          origin: process.env.CORS_ORIGIN || '*',
          credentials: true,
        },
        pingInterval: 10000,
        pingTimeout: 5000,
      })
    : createNoopSocketServer();

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

    setupSocketIO(fastify.io);
    setupNotificationSubscribers(fastify);
  }

  fastify.addHook('onClose', async () => {
    if (enableSocketIO) {
      await fastify.io.close();
    }
  });

  await setupRoutes(fastify);

  // Iniciar tarea programada de facturacion
  startBillingJob();
  startBillingOverdueJob();

  // Iniciar tarea programada de facturacion de repartidores
  const cutoffStartup = startDriverBillingCutoffJob();
  scheduleDriverBillingOverdueCron();
  cutoffStartup.then(() => {
    processOverdueDriverSettlements();
    console.log('[App] Driver billing overdue startup check completed after cutoff sync.');
  });

  // Iniciar tarea programada de auto-rechazo de pedidos
  startOrderTimeoutJob(fastify);
  startRestaurantHoursJob(fastify);
  startJitDispatchJob(fastify);
  startDriverPickupAlertJob(fastify);
  startStuckOrderJob(fastify);
  startFeaturedExpirationJob(fastify);
  startPickupReadyJob(fastify);
  startCustomerPickupReminderJob(fastify);
  startCleanupProofsJob();

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

  // Endpoint de métricas (Prometheus-compatible)
  fastify.get('/metrics', async () => {
    const snapshot = getMetricsSnapshot();
    return {
      requests_total: snapshot.totals.requests,
      errors_total: snapshot.totals.errors,
      error_rate_percent: snapshot.totals.errorRate,
      routes: snapshot.routes.map((r) => ({
        route: `${r.method} ${r.route}`,
        count: r.count,
        errors: r.errorCount,
        avg_duration_ms: r.avgDurationMs,
        last_status: r.lastStatusCode,
      })),
      errors_by_code: snapshot.errorsByCode,
    };
  });

  return fastify;
}
