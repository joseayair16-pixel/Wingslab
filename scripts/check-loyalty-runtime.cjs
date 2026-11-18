// Run only in the reviewed WingsLab backend image/network. Uses its own random
// schema and fake accounts/orders. Never changes existing business records.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('/app/node_modules/@prisma/client');
const runtime = require('/app/packages/backend/dist/services/loyalty-runtime.service.js');
const { RESTAURANT_ID } = require('/app/packages/backend/dist/config/single-restaurant.js');
const config = JSON.parse(fs.readFileSync('/app/config/wingslab.local.json', 'utf8'));
const db = new PrismaClient({ datasourceUrl: config.backend.databaseUrl });
const schema = process.env.WINGSLAB_LOYALTY_TEST_SCHEMA || '';
assert(/^wl_loyalty_test_[a-f0-9]{32}$/.test(schema));
let program = { enabled: true, programVersion: 1, stampGoal: 8, rewardKind: 'AMOUNT', rewardValue: 1000, rewardProductId: null, rewardDescription: '$10 de descuento', stampTerms: '', stampStartsAt: '2026-01-01T00:00:00Z', redemptionReady: true };
let giftStock = 3;
function adapter(tx) {
  return new Proxy(tx, { get(target, key) {
    if (key === 'systemSetting') return { findUnique: async () => ({ value: JSON.stringify(program) }) };
    if (key === 'product') return { count: async () => 0, findFirst: async () => ({ id: 'gift', name: 'Papas', trackStock: true, stock: giftStock, optionGroups: [] }) };
    if (key === 'auditLog') return { create: async () => ({}) };
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  } });
}
async function transaction(fn) {
  return db.$transaction(async tx => {
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}", public`);
    return fn(adapter(tx));
  }, { timeout: 30000, maxWait: 30000 });
}
async function order(tx, id, customerId, status = 'DELIVERED', fulfillmentType = 'DELIVERY') {
  await tx.$executeRaw`INSERT INTO "Order" (id,"customerId","restaurantId",status,"fulfillmentType","createdAt","updatedAt","deliveredAt") VALUES (${id},${customerId},${RESTAURANT_ID},${status},${fulfillmentType},${new Date('2026-02-01T00:00:00Z')},CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`;
}
(async () => {
  const owned = await db.$queryRaw`SELECT n.nspname FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner WHERE n.nspname=${schema} AND r.rolname=current_user`;
  assert.equal(owned.length, 1, 'test schema must be pre-created and owned by the local application role');
  await transaction(async tx => {
    await tx.$executeRawUnsafe('CREATE TABLE "Restaurant" (id text PRIMARY KEY)');
    await tx.$executeRawUnsafe('CREATE TABLE "Customer" (id text PRIMARY KEY)');
    await tx.$executeRawUnsafe('CREATE TABLE "Order" (id text PRIMARY KEY,"customerId" text,"restaurantId" text,status text,"fulfillmentType" text,"paymentStatus" text DEFAULT \'COMPLETED\',"noShowReleasedAt" timestamp,"createdAt" timestamp,"updatedAt" timestamp,"deliveredAt" timestamp,"completedAt" timestamp,"pickedUpAt" timestamp)');
    await tx.$executeRaw`INSERT INTO "Restaurant"(id) VALUES (${RESTAURANT_ID})`;
    await tx.$executeRawUnsafe("INSERT INTO \"Customer\"(id) VALUES ('historic'),('seventh'),('gift-customer')");
    const sql = fs.readFileSync('/test/migration.sql', 'utf8').replace(/^--.*$/gm, '');
    for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean)) await tx.$executeRawUnsafe(statement);
    for (let i = 0; i < 10; i++) await order(tx, `historic-${i}`, 'historic');
    for (let i = 0; i < 7; i++) await order(tx, `seventh-${i}`, 'seventh');
  });
  await transaction(async tx => {
    const state = await runtime.loyaltyState(tx, 'historic');
    assert.equal(state.available.length, 1); assert.equal(state.open.stamps, 2);
    const repeated = await runtime.loyaltyState(tx, 'historic');
    assert.equal(repeated.available.length, 1); assert.equal(repeated.open.stamps, 2);
    const quote = await runtime.loyaltyQuote(tx, 'seventh', 5000);
    assert(quote.eligible); assert.equal(quote.discountCents, 1000);
    assert.equal((await runtime.loyaltyQuote(tx, 'seventh', 5000, [], true)).eligible, false);
  });
  const competing = await Promise.all([1, 2].map(n => transaction(async tx => {
    const quote = await runtime.loyaltyQuote(tx, 'seventh', 5000);
    if (!quote.eligible) return false;
    await order(tx, `reserved-${n}`, 'seventh', 'PENDING');
    await runtime.reserveRuntimeReward(tx, 'seventh', `reserved-${n}`, quote);
    return true;
  })));
  assert.equal(competing.filter(Boolean).length, 1, 'only one concurrent order can reserve');
  await transaction(async tx => {
    await tx.$executeRawUnsafe("UPDATE \"Order\" SET status='REJECTED' WHERE id LIKE 'reserved-%'");
    assert.equal((await runtime.loyaltyQuote(tx, 'seventh', 5000)).eligible, true, 'rejection releases reward');
    const quote = await runtime.loyaltyQuote(tx, 'seventh', 5000);
    await order(tx, 'rewarded-eighth', 'seventh', 'PENDING');
    await runtime.reserveRuntimeReward(tx, 'seventh', 'rewarded-eighth', quote);
    await tx.$executeRawUnsafe("UPDATE \"Order\" SET status='DELIVERED' WHERE id='rewarded-eighth'");
    const state = await runtime.loyaltyState(tx, 'seventh');
    assert.equal(state.list[0].stamps, 8); assert.equal(state.list[0].redemptionState, 'COMPLETED'); assert.equal(state.available.length, 0);
    await order(tx, 'in-transit', 'historic', 'PICKED_UP', 'DELIVERY');
    assert.equal((await runtime.loyaltyState(tx, 'historic')).open.stamps, 2);
    await order(tx, 'pickup-done', 'historic', 'PICKED_UP', 'PICKUP');
    assert.equal((await runtime.loyaltyState(tx, 'historic')).open.stamps, 3);
    await order(tx, 'unpaid-delivered', 'historic');
    await tx.$executeRawUnsafe("UPDATE \"Order\" SET \"paymentStatus\"='PENDING' WHERE id='unpaid-delivered'");
    await order(tx, 'not-received', 'historic');
    await tx.$executeRawUnsafe("UPDATE \"Order\" SET \"noShowReleasedAt\"=CURRENT_TIMESTAMP WHERE id='not-received'");
    assert.equal((await runtime.loyaltyState(tx, 'historic')).open.stamps, 3, 'unpaid/no-show orders do not earn stamps');
  });
  program = { ...program, programVersion: 2, stampGoal: 4, rewardValue: 2000 };
  await transaction(async tx => {
    const state = await runtime.loyaltyState(tx, 'historic');
    assert.equal(state.open.goal, 8); assert.equal(state.open.rewardValue, 1000, 'in-progress card retains original terms');
  });
  program = { ...program, rewardKind: 'PRODUCT', rewardValue: null, rewardProductId: 'gift', stampGoal: 2 };
  await transaction(async tx => {
    await order(tx, 'gift-first', 'gift-customer');
    let quote = await runtime.loyaltyQuote(tx, 'gift-customer', 5000);
    assert(quote.eligible); assert.equal(quote.gift.id, 'gift'); assert.equal(quote.discountCents, 0);
    giftStock = 0;
    quote = await runtime.loyaltyQuote(tx, 'gift-customer', 5000);
    assert.equal(quote.eligible, false, 'unavailable gift is not consumed');
  });
  console.log('PASS isolated PostgreSQL: history 10=reward+2, idempotence, concurrent reservation, cancellation release, eighth-purchase settlement, pickup semantics, frozen rules, gift availability');
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  try { await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { await db.$disconnect(); }
});
