import { prisma } from './database';
import { parseBackendConfiguration } from './env';
import { externalServicesEnabled, assertExternalOperationAllowed } from './isolation';

test('logic imports have no real database; unmocked access fails closed', async () => {
  expect(() => prisma.user.findMany()).toThrow('Unmocked database');
  const spy = jest.spyOn(prisma.user, 'findMany').mockResolvedValue([]);
  await expect(prisma.user.findMany()).resolves.toEqual([]);
  spy.mockRestore();
});
test('configuration parsing is pure and missing configuration is rejected', () => {
  const before = process.env.PORT;
  expect(() => parseBackendConfiguration({})).toThrow();
  expect(process.env.PORT).toBe(before);
});
test('external capabilities remain unavailable', () => {
  expect(externalServicesEnabled()).toBe(false);
  expect(assertExternalOperationAllowed).toThrow();
});

test('explicit container configuration validates without initializing anything', () => {
  const values = {
    WINGSLAB_PROFILE: 'container', WINGSLAB_INSTANCE_ID: '00000000-0000-4000-8000-000000000001',
    WINGSLAB_JWT_SECRET: 'j'.repeat(40), WINGSLAB_DATABASE_ENCRYPTION_KEY: 'e'.repeat(40),
    WINGSLAB_STORAGE_PROVIDER: 'memory',
    WINGSLAB_DATABASE_URL: `postgresql://wingslab_local:${'p'.repeat(40)}@172.30.240.10:5432/wingslab_local`,
    WINGSLAB_REDIS_URL: `redis://default:${'r'.repeat(40)}@172.30.240.11:6379/0`,
  };
  expect(parseBackendConfiguration(values).storageProvider).toBe('memory');
  expect(() => parseBackendConfiguration({ ...values, WINGSLAB_DATABASE_URL: 'postgresql://unauthorized.invalid/db' })).toThrow();
});
