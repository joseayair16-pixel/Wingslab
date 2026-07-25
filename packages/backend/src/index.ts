// Force America/Mexico_City timezone for consistent billing date calculations
process.env.TZ = 'America/Mexico_City';

import { prisma } from './config/database';
import { closeRedis } from './config/redis';
import { buildApp } from './app';
import { logger } from './utils/logger';
import type { FastifyInstance } from 'fastify';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';

let fastify: FastifyInstance | null = null;

async function startServer() {
  try {
    fastify = await buildApp();

    await fastify.listen({ port: PORT, host: '0.0.0.0' });

    logger.info(`Server running at http://localhost:${PORT}`);
    logger.info(`Environment: ${NODE_ENV}`);
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down gracefully...`);

  // 1. Stop accepting new connections
  if (fastify) {
    try {
      await fastify.close();
      logger.info('HTTP server closed');
    } catch (err) {
      logger.error('Error closing HTTP server:', err);
    }
  }

  // 2. Disconnect database
  try {
    await prisma.$disconnect();
    logger.info('Database disconnected');
  } catch (err) {
    logger.error('Error disconnecting database:', err);
  }

  // 3. Close Redis
  try {
    await closeRedis();
    logger.info('Redis disconnected');
  } catch (err) {
    logger.error('Error closing Redis:', err);
  }

  logger.info('Shutdown complete');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

startServer();
