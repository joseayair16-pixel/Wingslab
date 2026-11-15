/**
 * Database Configuration - Prisma
 */

import { PrismaClient } from '@prisma/client';
import { BackendConfiguration, assertServiceIdentityVerified, getBackendConfiguration, isHermeticTest } from './env';
import { assertBusinessIdentity, businessQueryArgs } from './single-restaurant';

let client: PrismaClient | undefined;

// Stable fail-closed methods can be spied on by Jest without constructing a real client.
function noNetworkObject(): Record<string, unknown> {
  return new Proxy<Record<string, unknown>>({}, {
    get(target, key) {
      if (typeof key !== 'string') return undefined;
      if (key === 'then') return undefined;
      if (!(key in target)) target[key] = key.startsWith('$') ||
        /^(find|create|update|delete|count|aggregate|groupBy|upsert)/.test(key)
        ? (key === '$disconnect' ? async () => undefined : () => { throw new Error('[WingsLab] Unmocked database access in hermetic test.'); })
        : noNetworkObject();
      return target[key];
    },
  });
}
const testClient = noNetworkObject();

export async function initializeDatabase(config: BackendConfiguration): Promise<void> {
  if (isHermeticTest()) throw new Error('[WingsLab] Real database forbidden in hermetic tests.');
  if (config !== getBackendConfiguration()) throw new Error('[WingsLab] Unauthorized configuration object.');
  const candidate = new PrismaClient({ datasourceUrl: config.databaseUrl, log: [] });
  try {
    const identity = await candidate.$queryRaw<Array<{ instance_id: string; database: string; username: string }>>`
      SELECT instance_id, current_database() AS database, current_user AS username
      FROM wingslab_identity.runtime WHERE singleton = true`;
    if (identity.length !== 1 || identity[0].instance_id !== config.instanceId ||
        identity[0].database !== 'wingslab_local' || identity[0].username !== 'wingslab_local') throw new Error();
    await assertBusinessIdentity(candidate);
    client = candidate.$extends({ query: { $allModels: { async $allOperations({ model, operation, args, query }) {
      return query(businessQueryArgs(model, operation, args));
    } } } }) as unknown as PrismaClient;
  } catch {
    await candidate.$disconnect();
    throw new Error('[WingsLab] PostgreSQL identity check failed; runtime remains closed.');
  }
}

/** Lazy facade: importing domain logic never constructs/connects a Prisma client. */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, key) {
    if (isHermeticTest()) return typeof key === 'string' ? testClient[key] : undefined;
    assertServiceIdentityVerified();
    if (!client) throw new Error('[WingsLab] Database not initialized.');
    const value = Reflect.get(client, key);
    return typeof value === 'function' ? value.bind(client) : value;
  },
  set(_target, key, value) {
    if (isHermeticTest()) return Reflect.set(testClient, key, value);
    throw new Error('[WingsLab] Cannot replace a runtime database client.');
  },
  getOwnPropertyDescriptor(_target, key) {
    if (isHermeticTest()) return Reflect.getOwnPropertyDescriptor(testClient, key);
    return undefined;
  },
  deleteProperty(_target, key) {
    if (isHermeticTest()) return Reflect.deleteProperty(testClient, key);
    throw new Error('[WingsLab] Cannot replace a runtime database client.');
  },
});
