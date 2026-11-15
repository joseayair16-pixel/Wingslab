// Explicit configuration only. Importing this module performs no IO or initialization.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const { assertOrigin, browserOrigins } = require('../packages/shared/src/wingslab-policy.js');

function assertNoLegacyEnvFiles() {
  const directories = [root, path.join(root, 'packages/backend'),
    ...['restaurant', 'customer', 'driver'].map(role => path.join(root, `packages/web-${role}`))];
  for (const dir of directories) {
    if (!fs.existsSync(dir)) continue;
    if (fs.lstatSync(dir).isSymbolicLink()) throw new Error('[WingsLab] Linked configuration directory prohibited.');
    for (const name of fs.readdirSync(dir)) {
      if (!/^\.env(?:\.|$)/.test(name) || name.endsWith('.example')) continue;
      const file = path.join(dir, name);
      // lstat: even dangling links are detected; never read their targets.
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || stat.isFile()) {
        throw new Error('[WingsLab] Legacy environment file/link present. Review locally before authorization.');
      }
    }
  }
}

function assertLocalAuthorization(env = process.env) {
  assertNoLegacyEnvFiles();
  if (Object.keys(env).some(key =>
    /^(FIREBASE_.*|GOOGLE_APPLICATION_CREDENTIALS|VAPID_.*|WHATSAPP_.*|SMS_.*|SMTP_.*|RESEND_.*|R2_.*|AWS_.*|CF_.*|PAYMENT_GATEWAY_.*|NEXT_PUBLIC_GOOGLE_MAPS_API_KEY)$/.test(key) && env[key])) {
    throw new Error('[WingsLab] External service configuration is prohibited in Phase 1. Use a clean environment.');
  }
  if (env.WINGSLAB_ENVIRONMENT !== 'local' || env.WINGSLAB_RUNTIME_AUTHORIZED !== 'reviewed-phase-2b' ||
      env.WINGSLAB_NETWORK_ATTESTED !== 'yes') {
    throw new Error('[WingsLab] Local execution is not authorized. See docs/AISLAMIENTO_WINGSLAB.md.');
  }
  if (env.WINGSLAB_PROFILE !== 'container') throw new Error('[WingsLab] Host execution is not authorized; use the isolated runtime.');
}

function frontendConfig(role) {
  assertNoLegacyEnvFiles();
  if (process.env.WINGSLAB_CONFIGURED !== 'yes') throw new Error('[WingsLab] Use the explicit WingsLab launcher.');
  const api = assertOrigin(process.env.NEXT_PUBLIC_API_URL, 'backend');
  const internalApi = assertOrigin(process.env.WINGSLAB_INTERNAL_API_URL, 'internalApi', 'container');
  const socket = assertOrigin(process.env.NEXT_PUBLIC_SOCKET_URL, 'backend');
  const customer = assertOrigin(process.env.NEXT_PUBLIC_CUSTOMER_URL, 'customer');
  const site = assertOrigin(process.env.NEXT_PUBLIC_SITE_URL, role);
  return {
    env: {
      NEXT_PUBLIC_API_URL: api, NEXT_PUBLIC_SOCKET_URL: socket,
      NEXT_PUBLIC_CUSTOMER_URL: customer, NEXT_PUBLIC_SITE_URL: site,
      NEXT_PUBLIC_WINGSLAB_ROLE: role,
    },
    async rewrites() { return [{ source: '/api/:path*', destination: `${internalApi}/:path*` }]; },
    async headers() {
      return [{ source: '/:path*', headers: [{
        key: 'Content-Security-Policy',
        value: `default-src 'self'; connect-src 'self' ${api} ${socket.replace('http:', 'ws:')}; img-src 'self' data: blob: ${api}; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; media-src 'self' blob:; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'`,
      }] }];
    },
  };
}

function denyOperation() {
  throw new Error('[WingsLab] Administration, migrations, publication and external integrations are blocked in Phase 1. Resource identity and operation-specific authorization must be implemented and reviewed first.');
}

const ALLOWED_CONFIG_PATHS = [
  path.join(root, 'config/wingslab.local.json'),        // container profile (runtime)
  path.join(root, 'config/wingslab.local.host.json'),  // host profile (local tooling)
];

function readLocalConfiguration(file = ALLOWED_CONFIG_PATHS[0]) {
  const resolved = path.resolve(file);
  if (!ALLOWED_CONFIG_PATHS.includes(resolved)) throw new Error('[WingsLab] Unapproved configuration path.');
  for (const part of [path.join(root, 'config'), resolved]) {
    if (fs.lstatSync(part).isSymbolicLink()) throw new Error('[WingsLab] Configuration links are prohibited.');
  }
  if (!fs.lstatSync(resolved).isFile()) throw new Error('[WingsLab] Configuration must be regular.');
  if (!fs.realpathSync(resolved).startsWith(root + path.sep)) throw new Error('[WingsLab] Configuration outside workspace.');
  try { return JSON.parse(fs.readFileSync(resolved, 'utf8')); } catch {
    throw new Error('[WingsLab] Invalid local JSON configuration (content withheld).');
  }
}

function processEnvironment(config, role, action) {
  if (config.version !== 1 || !['host', 'container'].includes(config.profile)) throw new Error('[WingsLab] Invalid configuration version/profile.');
  if (action === 'build' ? config.authorization?.build !== true :
    (config.authorization?.runtime !== true || config.authorization?.networkVerified !== true)) {
    throw new Error('[WingsLab] This operation has not been authorized.');
  }
  if (!['backend', 'restaurant', 'customer', 'driver'].includes(role)) throw new Error('[WingsLab] Unknown process.');
  if (config.role && config.role !== role) throw new Error('[WingsLab] Configuration is authorized for a different role.');
  // Closed allowlist. Never spread process.env or arbitrary config properties.
  const env = {
    PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/tmp', LANG: 'C.UTF-8',
    NEXT_TELEMETRY_DISABLED: '1', CHECKPOINT_DISABLE: '1',
    WINGSLAB_INTERNAL_API_URL: assertOrigin('http://172.30.240.21:3101', 'internalApi', 'container'),
    NODE_ENV: 'production', // Optimization mode, never resource identity/authorization.
    WINGSLAB_CONFIGURED: 'yes', WINGSLAB_ENVIRONMENT: 'local', WINGSLAB_PROFILE: config.profile,
    WINGSLAB_RUNTIME_AUTHORIZED: action === 'build' ? '' : 'reviewed-phase-2b',
    WINGSLAB_NETWORK_ATTESTED: config.authorization.networkVerified ? 'yes' : '',
    NEXT_PUBLIC_API_URL: assertOrigin(config.origins?.backend, 'backend'),
    NEXT_PUBLIC_SOCKET_URL: assertOrigin(config.origins?.backend, 'backend'),
    NEXT_PUBLIC_CUSTOMER_URL: assertOrigin(config.origins?.customer, 'customer'),
    NEXT_PUBLIC_SITE_URL: assertOrigin(config.origins?.[role], role), NEXT_PUBLIC_WINGSLAB_ROLE: role,
  };
  if (role === 'backend') Object.assign(env, {
    WINGSLAB_INSTANCE_ID: config.instanceId || '', WINGSLAB_DATABASE_URL: config.backend?.databaseUrl || '',
    WINGSLAB_REDIS_URL: config.backend?.redisUrl || '', WINGSLAB_JWT_SECRET: config.backend?.jwtSecret || '',
    WINGSLAB_DATABASE_ENCRYPTION_KEY: config.backend?.encryptionKey || '', WINGSLAB_STORAGE_PROVIDER: 'memory',
  });
  return env;
}

module.exports = { assertNoLegacyEnvFiles, assertLocalAuthorization, frontendConfig, denyOperation,
  readLocalConfiguration, processEnvironment, browserOrigins };
