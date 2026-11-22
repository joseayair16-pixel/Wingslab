// Explicit configuration only. Importing this module performs no IO or initialization.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const { assertOrigin, browserOrigins } = require('../packages/shared/src/wingslab-policy.cjs');

function assertNoLegacyEnvFiles() {
  const directories = [root, path.join(root, 'packages/backend'),
    ...['restaurant', 'customer'].map(role => path.join(root, `packages/web-${role}`))];
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
    /^(FIREBASE_.*|GOOGLE_APPLICATION_CREDENTIALS|VAPID_.*|WHATSAPP_.*|SMS_.*|SMTP_.*|RESEND_.*|AWS_.*|CF_.*|PAYMENT_GATEWAY_.*|NEXT_PUBLIC_GOOGLE_MAPS_API_KEY)$/.test(key) && env[key])) {
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
        value: `default-src 'self'; connect-src 'self' ${api} ${socket.replace('http:', 'ws:')} https://res.cloudinary.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://www.google.com https://www.recaptcha.net https://maps.googleapis.com https://maps.gstatic.com https://*.googleapis.com${role === 'customer' ? ' https://www.gstatic.com data:' : ''}; img-src 'self' data: blob: ${api} https://res.cloudinary.com https://www.gstatic.com https://www.google.com https://maps.googleapis.com https://maps.gstatic.com https://*.googleapis.com https://*.gstatic.com; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.gstatic.com https://www.google.com https://www.recaptcha.net https://maps.googleapis.com https://maps.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; media-src 'self' blob:; worker-src 'self' blob:; frame-src https://www.google.com https://www.recaptcha.net https://maps.google.com; object-src 'none'; base-uri 'self'; form-action 'self'`,
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
  if (!['backend', 'restaurant', 'customer'].includes(role)) throw new Error('[WingsLab] Unknown process.');
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
  if (role === 'backend') {
    Object.assign(env, {
      WINGSLAB_INSTANCE_ID: config.instanceId || '', WINGSLAB_DATABASE_URL: config.backend?.databaseUrl || '',
      WINGSLAB_REDIS_URL: config.backend?.redisUrl || '', WINGSLAB_JWT_SECRET: config.backend?.jwtSecret || '',
      WINGSLAB_DATABASE_ENCRYPTION_KEY: config.backend?.encryptionKey || '',
      WINGSLAB_STORAGE_PROVIDER: config.backend?.storageProvider === 'memory' ? 'memory' : 'cloudinary',
    });
    // Cloudinary solo se injecta desde la configuración explícita, nunca desde el entorno heredado.
    const cloudinary = config.backend?.cloudinary || {};
    for (const [field, name] of [
      ['cloudName', 'CLOUDINARY_CLOUD_NAME'],
      ['apiKey', 'CLOUDINARY_API_KEY'],
      ['apiSecret', 'CLOUDINARY_API_SECRET'],
      ['publicFolder', 'CLOUDINARY_PUBLIC_FOLDER'],
      ['privateFolder', 'CLOUDINARY_PRIVATE_FOLDER'],
    ]) {
      if (typeof cloudinary[field] === 'string' && cloudinary[field].trim()) {
        env[name] = cloudinary[field].trim();
      }
    }
    // Separate Firebase Admin credential for SMS-token verification; do not
    // inherit ambient FIREBASE_* or Google service-account variables.
    const firebaseAuth = config.backend?.firebaseAuth || {};
    for (const [field, name] of [
      ['projectId', 'WINGSLAB_FIREBASE_AUTH_PROJECT_ID'],
      ['clientEmail', 'WINGSLAB_FIREBASE_AUTH_CLIENT_EMAIL'],
      ['privateKey', 'WINGSLAB_FIREBASE_AUTH_PRIVATE_KEY'],
    ]) {
      if (typeof firebaseAuth[field] === 'string' && firebaseAuth[field].trim()) {
        env[name] = firebaseAuth[field].trim();
      }
    }
    // Web Push is the only external capability explicitly opt-in for local
    // PWA/browser delivery. It remains isolated from Firebase, WhatsApp, SMS,
    // email and every other provider.
    const webPush = config.backend?.webPush || {};
    if (webPush.enabled === true) {
      const publicKey = typeof webPush.publicKey === 'string' ? webPush.publicKey.trim() : '';
      const privateKey = typeof webPush.privateKey === 'string' ? webPush.privateKey.trim() : '';
      const contact = typeof webPush.contact === 'string' ? webPush.contact.trim() : '';
      if (!publicKey || !privateKey || !/^mailto:.+@.+\..+$/.test(contact)) {
        throw new Error('[WingsLab] Web Push requires its own VAPID key pair and mailto contact in local config.');
      }
      if (action === 'start') {
        Object.assign(env, {
          WINGSLAB_WEB_PUSH_ENABLED: 'true',
          WINGSLAB_WEB_PUSH_RETRY_JOB_ENABLED: webPush.retryJobEnabled === true ? 'true' : 'false',
          WINGSLAB_WEB_PUSH_PUBLIC_KEY: publicKey,
          WINGSLAB_WEB_PUSH_PRIVATE_KEY: privateKey,
          WINGSLAB_WEB_PUSH_CONTACT: contact,
        });
      }
    }
  }
  if (role === 'customer') {
    const firebase = config.firebase || {};
    for (const [field, name] of [
      ['apiKey', 'WINGSLAB_FIREBASE_WEB_API_KEY'],
      ['authDomain', 'WINGSLAB_FIREBASE_WEB_AUTH_DOMAIN'],
      ['projectId', 'WINGSLAB_FIREBASE_WEB_PROJECT_ID'],
      ['appId', 'WINGSLAB_FIREBASE_WEB_APP_ID'],
    ]) {
      env[name] = typeof firebase[field] === 'string' ? firebase[field].trim() : '';
    }
    const phoneAuthTest = firebase.phoneAuthTest || {};
    if (action === 'start' && phoneAuthTest.enabled === true) {
      const testPhoneNumber = typeof phoneAuthTest.phoneNumber === 'string'
        ? phoneAuthTest.phoneNumber.trim()
        : '';
      if (config.profile !== 'container' || !/^\+52\d{10}$/.test(testPhoneNumber)) {
        throw new Error('[WingsLab] Local Firebase phone test mode requires one explicit Mexican test number.');
      }
      env.WINGSLAB_FIREBASE_PHONE_AUTH_TEST_MODE = 'true';
      env.WINGSLAB_FIREBASE_TEST_PHONE_NUMBER = testPhoneNumber;
    }
  }
  if (role === 'customer' || role === 'restaurant') {
    const maps = config.googleMaps || {};
    const apiKey = typeof maps.apiKey === 'string' ? maps.apiKey.trim() : '';
    if (maps.enabled === true && !apiKey) {
      throw new Error('[WingsLab] Google Maps cannot be enabled without an API key in local role configuration.');
    }
    env.WINGSLAB_GOOGLE_MAPS_ENABLED = maps.enabled === true && apiKey ? 'true' : 'false';
    if (env.WINGSLAB_GOOGLE_MAPS_ENABLED === 'true') env.WINGSLAB_GOOGLE_MAPS_API_KEY = apiKey;
  }
  return env;
}

module.exports = { assertNoLegacyEnvFiles, assertLocalAuthorization, frontendConfig, denyOperation,
  readLocalConfiguration, processEnvironment, browserOrigins };
