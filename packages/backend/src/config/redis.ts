/**
 * Redis Configuration
 */

import Redis from 'ioredis';
import { logger } from '../utils/logger';
import { InMemoryRedis } from './redis.memory';

let redisInstance: Redis | null = null;

export function getRedis(): Redis {
  if (redisInstance) {
    return redisInstance;
  }

  // En tests usamos un Redis en memoria para que el suite no dependa de un
  // servidor real (hermético y reproducible en CI y en dev locales).
  if (process.env.NODE_ENV === 'test') {
    redisInstance = new InMemoryRedis() as unknown as Redis;
    return redisInstance;
  }

  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

  redisInstance = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    enableOfflineQueue: true,
    connectTimeout: 10000,
    retryStrategy(times) {
      if (times > 5) {
        logger.warn('[Redis] Max retries reached, giving up');
        return null;
      }
      return Math.min(times * 200, 2000);
    },
    lazyConnect: true,
  });

  redisInstance.on('connect', () => {
    logger.info('[Redis] Connected');
  });

  redisInstance.on('ready', () => {
    logger.info('[Redis] Ready');
  });

  redisInstance.on('error', (err) => {
    logger.error('[Redis] Connection error:', err);
  });

  redisInstance.on('close', () => {
    logger.warn('[Redis] Connection closed');
  });

  redisInstance.on('reconnecting', (delay: number) => {
    logger.info(`[Redis] Reconnecting in ${delay}ms`);
  });

  return redisInstance;
}

export async function closeRedis(): Promise<void> {
  if (!redisInstance) {
    return;
  }

  try {
    await redisInstance.quit();
  } catch (err) {
    logger.error('[Redis] Error during shutdown:', err);
  }
  redisInstance = null;
}
