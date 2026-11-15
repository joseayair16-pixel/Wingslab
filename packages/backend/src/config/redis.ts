/**
 * Redis Configuration
 */

import Redis from 'ioredis';
import { logger } from '../utils/logger';
import { InMemoryRedis } from './redis.memory';
import { BackendConfiguration, assertServiceIdentityVerified, getBackendConfiguration, isHermeticTest } from './env';

let redisInstance: Redis | null = null;

export function getRedis(): Redis {
  if (!isHermeticTest()) assertServiceIdentityVerified();
  if (redisInstance) {
    return redisInstance;
  }

  // En tests usamos un Redis en memoria para que el suite no dependa de un
  // servidor real (hermético y reproducible en CI y en dev locales).
  if (isHermeticTest()) {
    redisInstance = new InMemoryRedis() as unknown as Redis;
    return redisInstance;
  }

  throw new Error('[WingsLab] Redis must be initialized and identified before use.');
}

export async function initializeRedis(config: BackendConfiguration): Promise<void> {
  if (isHermeticTest()) throw new Error('[WingsLab] Real Redis forbidden in hermetic tests.');
  if (config !== getBackendConfiguration()) throw new Error('[WingsLab] Unauthorized configuration object.');
  const redisUrl = config.redisUrl;

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

  redisInstance.on('error', () => {
    // AUTH errors may retain command arguments. Never serialize the raw error.
    logger.error('[Redis] Connection error (details withheld).');
  });

  redisInstance.on('close', () => {
    logger.warn('[Redis] Connection closed');
  });

  redisInstance.on('reconnecting', (delay: number) => {
    logger.info(`[Redis] Reconnecting in ${delay}ms`);
  });

  try {
    if (await redisInstance.get('wingslab:identity') !== config.instanceId) throw new Error();
  } catch {
    redisInstance.disconnect();
    redisInstance = null;
    throw new Error('[WingsLab] Redis identity check failed; runtime remains closed.');
  }
}

export async function closeRedis(): Promise<void> {
  if (!redisInstance) {
    return;
  }

  try {
    await redisInstance.quit();
  } catch {
    logger.error('[Redis] Error during shutdown (details withheld).');
  }
  redisInstance = null;
}
