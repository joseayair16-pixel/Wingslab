// Force America/Mexico_City timezone for consistent billing date calculations
process.env.TZ = 'America/Mexico_City';

import { prisma } from './config/database';
import { closeRedis } from './config/redis';
import { initializeDatabase } from './config/database';
import { initializeRedis } from './config/redis';
import { loadEnvironment, getBackendConfiguration, markServiceIdentityVerified } from './config/env';
import { logger } from './utils/logger';
import type { FastifyInstance } from 'fastify';

let fastify: FastifyInstance | null = null;

async function startServer() {
  try {
    loadEnvironment();
    const config = getBackendConfiguration();
    await initializeDatabase(config);
    await initializeRedis(config);
    markServiceIdentityVerified();
    const { buildApp } = await import('./app.js');
    fastify = await buildApp();

    await fastify.listen({ port: 3101, host: config.profile === 'container' ? '0.0.0.0' : '127.0.0.1' });

    logger.info('WingsLab backend: service identities verified; external capabilities disabled.');
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
