import { assertConnection, assertOrigin } from '@sadel/shared';

export type BackendConfiguration = Readonly<{
  profile: 'host' | 'container'; instanceId: string; databaseUrl: string; redisUrl: string;
  jwtSecret: string; encryptionKey: string; storageProvider: 'memory' | 'cloudinary';
  firebaseAuth: Readonly<{ projectId: string; clientEmail: string; privateKey: string }> | null;
}>;
let configuration: BackendConfiguration | undefined;
let identityVerified = false;
const LOCAL_FRONTEND_PORTS = [3100, 3102, 3103, 3104];

export function getLocalCorsOrigins(): string[] {
  return LOCAL_FRONTEND_PORTS.flatMap((port) => [
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
  ]);
}

export function isHermeticTest(): boolean {
  return process.env.WINGSLAB_MODE === 'test';
}

/** Pure validation: does not initialize clients, read files or mutate the process. */
export function parseBackendConfiguration(env: Record<string, string | undefined>): BackendConfiguration {
  const profile = env.WINGSLAB_PROFILE;
  if (profile !== 'host' && profile !== 'container') throw new Error('[WingsLab] Invalid runtime profile.');
  const instanceId = env.WINGSLAB_INSTANCE_ID || '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(instanceId)) {
    throw new Error('[WingsLab] A new instance UUID is required.');
  }
  const jwtSecret = env.WINGSLAB_JWT_SECRET || '';
  const encryptionKey = env.WINGSLAB_DATABASE_ENCRYPTION_KEY || '';
  if (jwtSecret.length < 32 || encryptionKey.length < 32 || jwtSecret === encryptionKey ||
      /replace|sample|changeme/i.test(jwtSecret + encryptionKey)) throw new Error('[WingsLab] New independent keys required.');
  const storageProvider = env.WINGSLAB_STORAGE_PROVIDER || 'cloudinary';
  if (storageProvider !== 'memory' && storageProvider !== 'cloudinary') {
    throw new Error('[WingsLab] Invalid storage provider. Use "memory" or "cloudinary".');
  }
  const firebaseProjectId = env.WINGSLAB_FIREBASE_AUTH_PROJECT_ID?.trim() || '';
  const firebaseClientEmail = env.WINGSLAB_FIREBASE_AUTH_CLIENT_EMAIL?.trim() || '';
  const firebasePrivateKey = env.WINGSLAB_FIREBASE_AUTH_PRIVATE_KEY?.replace(/\\n/g, '\n').trim() || '';
  const firebaseAuthValues = [firebaseProjectId, firebaseClientEmail, firebasePrivateKey];
  if (firebaseAuthValues.some(Boolean) && !firebaseAuthValues.every(Boolean)) {
    throw new Error('[WingsLab] Firebase Auth requires project ID, client email, and private key together.');
  }
  return Object.freeze({ profile, instanceId, jwtSecret, encryptionKey, storageProvider,
    firebaseAuth: firebaseAuthValues.every(Boolean)
      ? Object.freeze({ projectId: firebaseProjectId, clientEmail: firebaseClientEmail, privateKey: firebasePrivateKey })
      : null,
    databaseUrl: assertConnection(env.WINGSLAB_DATABASE_URL, 'postgres', profile),
    redisUrl: assertConnection(env.WINGSLAB_REDIS_URL, 'redis', profile),
  });
}

export function loadEnvironment(): void {
  if (configuration) return;

  // No .env discovery: inherited SaDeL credentials must never be consumed.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const policy = require('../../../../config/wingslab.cjs');
  policy.assertLocalAuthorization();
  const inherited = Object.keys(process.env).filter((key) =>
    /^(DATABASE_URL|REDIS_URL|JWT_SECRET|DATABASE_ENCRYPTION_KEYS?|FIREBASE_.*|GOOGLE_APPLICATION_CREDENTIALS|VAPID_.*|SMS_.*|SMTP_.*|RESEND_.*|AWS_.*|CF_.*|PAYMENT_GATEWAY_.*)$/.test(key) && process.env[key]
  );
  if (inherited.length) throw new Error('[WingsLab] Legacy service variables present; use a clean process environment.');
  configuration = parseBackendConfiguration(process.env);
  process.env.DATABASE_URL = configuration.databaseUrl;
  process.env.REDIS_URL = configuration.redisUrl;
  process.env.JWT_SECRET = configuration.jwtSecret;
  process.env.DATABASE_ENCRYPTION_KEY = configuration.encryptionKey;
  process.env.PORT = '3101';
  process.env.CORS_ORIGIN = getLocalCorsOrigins().join(',');

  process.env.RESTAURANT_PANEL_URL = assertOrigin('http://127.0.0.1:3102', 'restaurant');
  process.env.DRIVER_APP_URL = assertOrigin('http://127.0.0.1:3104', 'driver');
  process.env.CUSTOMER_WEB_URL = assertOrigin('http://127.0.0.1:3103', 'customer');
  process.env.WEBAPP_URL = process.env.CUSTOMER_WEB_URL;
}

export function getBackendConfiguration(): BackendConfiguration {
  if (!configuration) throw new Error('[WingsLab] Runtime has not been explicitly initialized.');
  return configuration;
}

export function markServiceIdentityVerified(): void { identityVerified = true; }
export function localOtpSimulationAllowed(): boolean {
  return isHermeticTest() || (!!configuration && identityVerified && configuration.profile === 'container');
}
export function assertServiceIdentityVerified(): void {
  if (!isHermeticTest() && !identityVerified) throw new Error('[WingsLab] Service identities have not been verified.');
}

type EnvVar = {
  key: string;
  required: boolean;
  secret: boolean;
};

const REQUIRED_ENV_VARS: EnvVar[] = [
  { key: 'DATABASE_URL', required: true, secret: true },
  { key: 'JWT_SECRET', required: true, secret: true },
  // Clave dedicada para cifrar datos sensibles (cuentas bancarias). Separada de
  // JWT_SECRET para no reutilizar material entre firmas (HS256) y cifrado (AES-GCM).
  { key: 'DATABASE_ENCRYPTION_KEY', required: true, secret: true },
  // Claves históricas (comma-separated) que permiten descifrar datos cifrados
  // con una clave anterior durante una rotación. Nunca se usan para cifrar.
  { key: 'DATABASE_ENCRYPTION_KEYS', required: false, secret: true },
  { key: 'REDIS_URL', required: false, secret: false },
  { key: 'CORS_ORIGIN', required: false, secret: false },
  { key: 'VAPID_PUBLIC_KEY', required: false, secret: false },
  { key: 'VAPID_PRIVATE_KEY', required: false, secret: true },
  { key: 'RATE_LIMIT_MAX', required: false, secret: false },
  { key: 'RATE_LIMIT_WINDOW_MS', required: false, secret: false },
];

const PLACEHOLDER_SECRET_PATTERN =
  /your[_-\s]?(secret|database|key|password|token)|change[_-\s]?in[_-\s]?production|changeme|replace[_-\s]?me|sample[_-\s]?secret/i;

function isPlaceholderSecret(value: string): boolean {
  return PLACEHOLDER_SECRET_PATTERN.test(value);
}

export function validateEnvironment(): void {
  const missing: string[] = [];
  const insecure: string[] = [];

  for (const v of REQUIRED_ENV_VARS) {
    const value = process.env[v.key];
    if (v.required && !value) {
      missing.push(v.key);
    }
    if (v.secret && value && isPlaceholderSecret(value)) {
      insecure.push(v.key);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `FATAL: Missing required environment variables: ${missing.join(', ')}`
    );
  }

  if (insecure.length > 0) {
    throw new Error(
      `FATAL SECURITY ERROR: The following secrets still use placeholder values: ${insecure.join(', ')}. Update them before running in production.`
    );
  }
}

// Deliberately no import-time initialization. Only the approved entry point calls loadEnvironment().
