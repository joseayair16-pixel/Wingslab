// Test-only RPC runner. Real Fastify routes + Prisma/PostgreSQL on a restored
// WingsLab clone. No HTTP listener, jobs, real Redis, socket transport or sends.
// Run inside the existing backend container, never as the production entrypoint.
const fs = require('node:fs'), path = require('node:path'), readline = require('node:readline');
const ROOT = '/app', DIST = ROOT + '/packages/backend/dist';
const CLONE = 'wingslab_verify_20261115_0830';
const ID = 'cmwgzrpnm0047orggilrr3fxu';
const policy = require(ROOT + '/config/wingslab.cjs');
const config = JSON.parse(fs.readFileSync(ROOT + '/config/wingslab.local.json'));
Object.assign(process.env, policy.processEnvironment(config, 'backend', 'start'));
const env = require(DIST + '/config/env');
env.loadEnvironment();
const { PrismaClient } = require(ROOT + '/node_modules/@prisma/client');
const url = new URL(config.backend.databaseUrl);
if (url.pathname !== '/wingslab_local' || url.hostname !== '172.30.240.10') throw Error('Unexpected source identity');
url.pathname = '/' + CLONE;
const raw = new PrismaClient({ datasourceUrl: url.toString(), log: [] });
let app;
const events = [];
function injectModule(file, exports) {
  const resolved = require.resolve(file);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
async function main() {
  const [identity] = await raw.$queryRawUnsafe('SELECT current_database() AS database, instance_id FROM wingslab_identity.runtime WHERE singleton=true');
  if (identity.database !== CLONE || identity.instance_id !== config.instanceId) throw Error('Clone identity failed');
  const { businessQueryArgs } = require(DIST + '/config/single-restaurant');
  const db = raw.$extends({ query: { $allModels: { async $allOperations({ model, operation, args, query }) { return query(businessQueryArgs(model, operation, args)); } } } });
  // Dependency substitution is limited to this test process. All auth, owner,
  // state, coupon, pricing and order allowlist policies are unchanged.
  injectModule(DIST + '/config/database', { prisma: db });
  const { InMemoryRedis } = require(DIST + '/config/redis.memory');
  const memory = new InMemoryRedis();
  injectModule(DIST + '/config/redis', { getRedis: () => memory, closeRedis: async () => {} });
  env.markServiceIdentityVerified();
  app = await require(DIST + '/app').buildApp({ enableRateLimit: false, enableSocketIO: false, enableJobs: false });
  app.decorate('io', { to: room => ({ emit: (event, data) => events.push({ room, event, data }) }) });
  await app.ready();
  async function seed() {
    if (!await db.productOptionGroup.findUnique({ where: { id: 'verify_salsa' } })) {
      await db.productOptionGroup.create({ data: { id: 'verify_salsa', productId: 'wl_prod_alitas_6', name: 'Salsa de prueba', minSelection: 1, maxSelection: 1, options: { create: [
        { id: 'verify_salsa_bbq', name: 'BBQ de prueba', price: 0 },
        { id: 'verify_salsa_hot', name: 'Picante de prueba', price: 5 },
        { id: 'verify_salsa_unavailable', name: 'Salsa agotada', price: 7, isAvailable: false },
      ] } } });
      await db.productOptionGroup.create({ data: { id: 'verify_extras', productId: 'wl_prod_alitas_6', name: 'Extras de prueba', minSelection: 0, maxSelection: 2, options: { create: [
        { id: 'verify_extra_queso', name: 'Queso de prueba', price: 10 },
        { id: 'verify_extra_aderezo', name: 'Aderezo de prueba', price: 15 },
        { id: 'verify_extra_tocino', name: 'Tocino de prueba', price: 20 },
      ] } } });
    }
    const restaurant = await db.restaurant.findFirst();
    const promoBase = { restaurantId: restaurant.id, isActive: true };
    for (const promo of [
      { code: 'VERIFY10', type: 'PERCENT', value: 10, maxUsesPerCustomer: 1 },
      { code: 'VERIFY20', type: 'AMOUNT', value: 20 },
      { code: 'VERIFYENVIO', type: 'FREE_DELIVERY', value: 0 },
      { code: 'VERIFYFIRST', type: 'PERCENT', value: 10, firstPurchaseOnly: true },
      { code: 'VERIFYMIN', type: 'AMOUNT', value: 20, minOrderAmount: 9999 },
      { code: 'VERIFYEXPIRED', type: 'PERCENT', value: 10, validUntil: new Date(0) },
      { code: 'VERIFYUSED', type: 'PERCENT', value: 10, maxUses: 1, usesCount: 1 },
    ]) if (!await db.promoCode.findFirst({ where: { code: promo.code } })) await db.promoCode.create({ data: { ...promoBase, ...promo } });
    // Product promotion exercises the existing buy-N/pay-M calculator.
    await db.product.update({ where: { id: 'wl_prod_papas' }, data: { promoType: 'MULTI_BUY', promoBuyQuantity: 2, promoPayQuantity: 1 } });
    return { restaurantId: restaurant.id, database: CLONE };
  }
  async function inspect() {
    return { database: CLONE,
      orders: await db.order.findMany({ orderBy: { createdAt: 'asc' }, include: { items: { include: { options: true } } } }),
      tokens: await db.deliveryToken.count(), tracking: await db.orderTracking.findMany({ where: { orderId: ID }, orderBy: { createdAt: 'asc' } }),
      promos: await db.promoCode.findMany(), events };
  }
  const lines = readline.createInterface({ input: process.stdin });
  let chain = Promise.resolve();
  lines.on('line', line => { chain = chain.then(async () => {
    const message = JSON.parse(line);
    try {
      let result;
      if (message.op === 'request') {
        const response = await app.inject(message.request);
        result = { statusCode: response.statusCode, headers: response.headers, body: response.body };
      } else if (message.op === 'seed') result = await seed();
      else if (message.op === 'inspect') result = await inspect();
      else if (message.op === 'checkout-principal') {
        const user = await db.user.findUnique({ where: { email: 'pedido-integral-01@wingslab.invalid' } });
        await db.user.update({ where: { id: user.id }, data: { password: await require(ROOT + '/node_modules/bcryptjs').hash(message.password, 10) } });
        result = { phone: user.phone };
      }
      else if (message.op === 'prepare-delivery-copy') {
        // Only this isolated copy of the old integral order changes, never live.
        await db.order.update({ where: { id: ID }, data: { status: 'READY', paymentStatus: 'PENDING', deliveredByRestaurant: false, driverId: null, supportRestaurantId: null, driverArrivedAtCustomer: null, deliveredAt: null, completedAt: null, actualDeliveryTime: null, cashPaymentConfirmedAt: null, inTransitAt: null, pickedUpAt: null, lastDriverLatitude: null, lastDriverLongitude: null, lastDriverLocationAt: null } });
        result = { ready: true };
      } else if (message.op === 'exit') { await app.close(); await raw.$disconnect(); process.stdout.write('WL_RPC ' + JSON.stringify({ id: message.id, result: { closed: true } }) + '\n'); process.exit(0); }
      else throw Error('Unknown verification command');
      process.stdout.write('WL_RPC ' + JSON.stringify({ id: message.id, result }) + '\n');
    } catch (e) { process.stdout.write('WL_RPC ' + JSON.stringify({ id: message.id, error: e.message }) + '\n'); }
  }); });
  process.stdout.write('WL_READY\n');
}
main().catch(async error => { console.error('CLONE_RUNNER_FAILED', error.message); await raw.$disconnect(); process.exitCode = 1; });
