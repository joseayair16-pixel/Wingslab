import { prisma } from './database';
import { getLocalCorsOrigins, parseBackendConfiguration } from './env';
import { externalServicesEnabled, assertExternalOperationAllowed } from './isolation';

const wingslabPolicy = require('../../../../config/wingslab.cjs') as {
  processEnvironment: (config: Record<string, unknown>, role: string, action: 'build' | 'start') => Record<string, string>;
};

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
test('local CORS accepts both loopback hostnames for the web frontends', () => {
  expect(getLocalCorsOrigins()).toContain('http://localhost:3103');
  expect(getLocalCorsOrigins()).toContain('http://127.0.0.1:3103');
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

test('Firebase Admin credentials are all-or-nothing and escaped PEM newlines are normalized', () => {
  const values = {
    WINGSLAB_PROFILE: 'container', WINGSLAB_INSTANCE_ID: '00000000-0000-4000-8000-000000000001',
    WINGSLAB_JWT_SECRET: 'j'.repeat(40), WINGSLAB_DATABASE_ENCRYPTION_KEY: 'e'.repeat(40),
    WINGSLAB_STORAGE_PROVIDER: 'memory',
    WINGSLAB_DATABASE_URL: `postgresql://wingslab_local:${'p'.repeat(40)}@172.30.240.10:5432/wingslab_local`,
    WINGSLAB_REDIS_URL: `redis://default:${'r'.repeat(40)}@172.30.240.11:6379/0`,
  };
  const configured = parseBackendConfiguration({
    ...values,
    WINGSLAB_FIREBASE_AUTH_PROJECT_ID: 'wingslab-auth',
    WINGSLAB_FIREBASE_AUTH_CLIENT_EMAIL: 'firebase-admin@wingslab-auth.iam.gserviceaccount.com',
    WINGSLAB_FIREBASE_AUTH_PRIVATE_KEY: 'line-one\\nline-two',
  });

  expect(configured.firebaseAuth).toEqual({
    projectId: 'wingslab-auth',
    clientEmail: 'firebase-admin@wingslab-auth.iam.gserviceaccount.com',
    privateKey: 'line-one\nline-two',
  });
  expect(() => parseBackendConfiguration({
    ...values,
    WINGSLAB_FIREBASE_AUTH_PROJECT_ID: 'wingslab-auth',
  })).toThrow('Firebase Auth requires project ID, client email, and private key together.');
});

test('Firebase public config reaches only the customer process; Admin secrets reach only backend', () => {
  const config = {
    version: 1,
    profile: 'container',
    authorization: { build: true, runtime: false, networkVerified: false },
    origins: {
      backend: 'http://127.0.0.1:3101',
      admin: 'http://127.0.0.1:3100',
      restaurant: 'http://127.0.0.1:3102',
      customer: 'http://127.0.0.1:3103',
      driver: 'http://127.0.0.1:3104',
    },
    firebase: {
      apiKey: 'public-web-api-key',
      authDomain: 'wingslab-auth.firebaseapp.com',
      projectId: 'wingslab-auth',
      appId: 'web-app-id',
      phoneAuthTest: { enabled: true, phoneNumber: '+525511111111' },
    },
    backend: {
      firebaseAuth: {
        projectId: 'wingslab-auth',
        clientEmail: 'firebase-admin@wingslab-auth.iam.gserviceaccount.com',
        privateKey: 'private-key-material',
      },
    },
  };

  const customerEnv = wingslabPolicy.processEnvironment({
    ...config,
    authorization: { build: false, runtime: true, networkVerified: true },
  }, 'customer', 'start');
  const customerBuildEnv = wingslabPolicy.processEnvironment(config, 'customer', 'build');
  const backendEnv = wingslabPolicy.processEnvironment(config, 'backend', 'build');

  expect(customerEnv.WINGSLAB_FIREBASE_WEB_API_KEY).toBe('public-web-api-key');
  expect(customerEnv.WINGSLAB_FIREBASE_PHONE_AUTH_TEST_MODE).toBe('true');
  expect(customerEnv.WINGSLAB_FIREBASE_TEST_PHONE_NUMBER).toBe('+525511111111');
  expect(customerBuildEnv.WINGSLAB_FIREBASE_WEB_API_KEY).toBe('public-web-api-key');
  expect(customerBuildEnv.WINGSLAB_FIREBASE_PHONE_AUTH_TEST_MODE).toBeUndefined();
  expect(customerEnv.WINGSLAB_FIREBASE_AUTH_PRIVATE_KEY).toBeUndefined();
  expect(backendEnv.WINGSLAB_FIREBASE_AUTH_PRIVATE_KEY).toBe('private-key-material');
  expect(backendEnv.WINGSLAB_FIREBASE_WEB_API_KEY).toBeUndefined();
});
