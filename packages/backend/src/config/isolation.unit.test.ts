import { prisma } from './database';
import { getLocalCorsOrigins, parseBackendConfiguration } from './env';
import { externalServicesEnabled, webPushEnabled, webPushRetryJobEnabled, assertExternalOperationAllowed } from './isolation';

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

test('Web Push requires its complete explicit local opt-in and leaves generic providers blocked', () => {
  const prior = {
    enabled: process.env.WINGSLAB_WEB_PUSH_ENABLED,
    configured: process.env.WINGSLAB_CONFIGURED,
    authorized: process.env.WINGSLAB_RUNTIME_AUTHORIZED,
    attested: process.env.WINGSLAB_NETWORK_ATTESTED,
    publicKey: process.env.WINGSLAB_WEB_PUSH_PUBLIC_KEY,
    privateKey: process.env.WINGSLAB_WEB_PUSH_PRIVATE_KEY,
    contact: process.env.WINGSLAB_WEB_PUSH_CONTACT,
    retryEnabled: process.env.WINGSLAB_WEB_PUSH_RETRY_JOB_ENABLED,
  };
  try {
    Object.assign(process.env, {
      WINGSLAB_WEB_PUSH_ENABLED: 'true', WINGSLAB_CONFIGURED: 'yes',
      WINGSLAB_RUNTIME_AUTHORIZED: 'reviewed-phase-2b', WINGSLAB_NETWORK_ATTESTED: 'yes',
      WINGSLAB_WEB_PUSH_PUBLIC_KEY: 'public', WINGSLAB_WEB_PUSH_PRIVATE_KEY: 'private',
      WINGSLAB_WEB_PUSH_CONTACT: 'mailto:notifications@wingslab.local',
    });
    expect(webPushEnabled()).toBe(true);
    expect(webPushRetryJobEnabled()).toBe(false);
    expect(externalServicesEnabled()).toBe(false);
    delete process.env.WINGSLAB_WEB_PUSH_CONTACT;
    expect(webPushEnabled()).toBe(false);
  } finally {
    for (const [key, value] of Object.entries({
      WINGSLAB_WEB_PUSH_ENABLED: prior.enabled, WINGSLAB_CONFIGURED: prior.configured,
      WINGSLAB_RUNTIME_AUTHORIZED: prior.authorized, WINGSLAB_NETWORK_ATTESTED: prior.attested,
      WINGSLAB_WEB_PUSH_PUBLIC_KEY: prior.publicKey, WINGSLAB_WEB_PUSH_PRIVATE_KEY: prior.privateKey,
      WINGSLAB_WEB_PUSH_CONTACT: prior.contact,
      WINGSLAB_WEB_PUSH_RETRY_JOB_ENABLED: prior.retryEnabled,
    })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
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

test('Maps is opt-in per frontend and never enables unrelated external providers', () => {
  const base = {
    version: 1,
    profile: 'container',
    authorization: { build: true, runtime: false, networkVerified: false },
    origins: {
      backend: 'http://127.0.0.1:3101', admin: 'http://127.0.0.1:3100',
      restaurant: 'http://127.0.0.1:3102', customer: 'http://127.0.0.1:3103',
      driver: 'http://127.0.0.1:3104',
    },
    googleMaps: { enabled: true, apiKey: 'browser-key' },
  };
  const customer = wingslabPolicy.processEnvironment(base, 'customer', 'build');
  const restaurant = wingslabPolicy.processEnvironment(base, 'restaurant', 'build');
  const driver = wingslabPolicy.processEnvironment(base, 'driver', 'build');
  const backend = wingslabPolicy.processEnvironment(base, 'backend', 'build');
  const disabled = wingslabPolicy.processEnvironment({
    ...base, googleMaps: { enabled: false, apiKey: 'browser-key' },
  }, 'customer', 'build');

  for (const env of [customer, restaurant, driver]) {
    expect(env.WINGSLAB_GOOGLE_MAPS_ENABLED).toBe('true');
    expect(env.WINGSLAB_GOOGLE_MAPS_API_KEY).toBe('browser-key');
  }
  expect(backend.WINGSLAB_GOOGLE_MAPS_API_KEY).toBeUndefined();
  expect(disabled.WINGSLAB_GOOGLE_MAPS_ENABLED).toBe('false');
  expect(disabled.WINGSLAB_GOOGLE_MAPS_API_KEY).toBeUndefined();
  expect(() => wingslabPolicy.processEnvironment({
    ...base, googleMaps: { enabled: true, apiKey: '' },
  }, 'customer', 'build')).toThrow('Google Maps cannot be enabled without an API key');
  expect(externalServicesEnabled()).toBe(false);
});

test('VAPID private key is injected only into backend runtime, never a frontend', () => {
  const config = {
    version: 1,
    profile: 'container',
    authorization: { build: true, runtime: true, networkVerified: true },
    origins: {
      backend: 'http://127.0.0.1:3101', admin: 'http://127.0.0.1:3100',
      restaurant: 'http://127.0.0.1:3102', customer: 'http://127.0.0.1:3103', driver: 'http://127.0.0.1:3104',
    },
    backend: { webPush: { enabled: true, publicKey: 'public-key', privateKey: 'private-key', contact: 'mailto:notifications@wingslab.local' } },
  };
  const backend = wingslabPolicy.processEnvironment(config, 'backend', 'start');
  const restaurant = wingslabPolicy.processEnvironment(config, 'restaurant', 'start');
  const customer = wingslabPolicy.processEnvironment(config, 'customer', 'start');
  expect(backend.WINGSLAB_WEB_PUSH_ENABLED).toBe('true');
  expect(backend.WINGSLAB_WEB_PUSH_PRIVATE_KEY).toBe('private-key');
  for (const frontend of [restaurant, customer]) {
    expect(frontend.WINGSLAB_WEB_PUSH_PRIVATE_KEY).toBeUndefined();
    expect(frontend.WINGSLAB_WEB_PUSH_PUBLIC_KEY).toBeUndefined();
  }
});
