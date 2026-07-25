/**
 * Redis Cache Service for frequent queries
 * Reduces PostgreSQL load by caching popular data in Redis
 */

import { getRedis } from '../config/redis';
import { logger } from '../utils/logger';

const DEFAULT_TTL_SECONDS = 60; // 1 minuto por defecto
const RESTAURANT_LIST_TTL = 30; // 30 segundos para listas de restaurantes
const MENU_TTL = 120; // 2 minutos para menús (cambian menos seguido)

type CacheableData = string | number | boolean | Record<string, unknown> | Array<unknown> | null;

function buildKey(prefix: string, identifier: string): string {
  return `cache:${prefix}:${identifier}`;
}

export async function getCached<T = CacheableData>(
  prefix: string,
  identifier: string
): Promise<T | null> {
  try {
    const redis = getRedis();
    const key = buildKey(prefix, identifier);
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (error) {
    logger.warn('[Cache] Error reading from cache', { prefix, identifier, error });
    return null; // Cache miss on error — fallback to DB
  }
}

export async function setCache(
  prefix: string,
  identifier: string,
  data: CacheableData,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): Promise<void> {
  try {
    const redis = getRedis();
    const key = buildKey(prefix, identifier);
    const serialized = JSON.stringify(data);
    await redis.setex(key, ttlSeconds, serialized);
  } catch (error) {
    logger.warn('[Cache] Error writing to cache', { prefix, identifier, error });
  }
}

export async function invalidateCache(prefix: string, identifier: string): Promise<void> {
  try {
    const redis = getRedis();
    const key = buildKey(prefix, identifier);
    await redis.del(key);
  } catch (error) {
    logger.warn('[Cache] Error invalidating cache', { prefix, identifier, error });
  }
}

export async function invalidateCachePattern(pattern: string): Promise<void> {
  try {
    const redis = getRedis();
    let cursor = '0';
    do {
      const result = await redis.scan(cursor, 'MATCH', `cache:${pattern}`, 'COUNT', 50);
      cursor = result[0];
      const keys = result[1];
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== '0');
  } catch (error) {
    logger.warn('[Cache] Error invalidating cache pattern', { pattern, error });
  }
}

// Helper functions for specific data types

export async function getCachedRestaurants(region: string) {
  return getCached<Array<Record<string, unknown>>>('restaurants', region);
}

export async function setCachedRestaurants(region: string, data: Array<Record<string, unknown>>) {
  return setCache('restaurants', region, data, RESTAURANT_LIST_TTL);
}

export async function invalidateRestaurantsCache(region: string) {
  return invalidateCache('restaurants', region);
}

export async function getCachedMenu(restaurantId: string) {
  return getCached<Record<string, unknown>>('menu', restaurantId);
}

export async function setCachedMenu(restaurantId: string, data: Record<string, unknown>) {
  return setCache('menu', restaurantId, data, MENU_TTL);
}

export async function invalidateMenuCache(restaurantId: string) {
  return invalidateCache('menu', restaurantId);
}
