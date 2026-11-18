// Isolated in-person loyalty verification. Uses a dedicated random schema and
// fake users/visits. Never modifies real business records.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('/app/node_modules/@prisma/client');
const config = JSON.parse(fs.readFileSync('/app/config/wingslab.local.json', 'utf8'));
const service = require('/app/packages/backend/dist/services/loyalty-inperson.service.js');
const { RESTAURANT_ID } = require('/app/packages/backend/dist/config/single-restaurant.js');
const schema = process.env.WINGSLAB_LOYALTY_TEST_SCHEMA || '';
assert(/^wl_loyalty_test_[a-f0-9]{32}$/.test(schema));
const db = new PrismaClient({ datasourceUrl: config.backend.databaseUrl + (config.backend.databaseUrl.includes('?') ? '&' : '?') + 'connection_limit=1' });
const program = { enabled: true, programVersion: 1, stampGoal: 8, rewardKind: 'AMOUNT', rewardValue: 1000, rewardProductId: null, rewardDescription: '$10 de descuento', stampTerms: '', stampStartsAt: '2026-01-01T00:00:00Z', redemptionReady: true, activePeriods: [{ from: '2026-01-01T00:00:00Z', to: null }] };
const wrapper = {
  $transaction: (fn, options) => db.$transaction(async tx => {
    await tx.$executeRawUnsafe(`SET search_path TO "${schema}", public`);
    return fn(tx);
  }, options || { timeout: 30000 }),
};
async function stampForVisit(visitId) {
  return db.$transaction(async tx => {
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}", public`);
    const rows = await tx.$queryRaw`SELECT * FROM "LoyaltyStamp" WHERE "visitId"=${visitId}`;
    return rows[0] || null;
  });
}
async function runVisit(amountCents, applyReward = false) {
  const qr = await service.createScanSession(wrapper, 'customer-test');
  const before = await service.previewInPerson(wrapper, qr.code);
  const result = await service.registerInPerson(wrapper, { code: qr.code, amountCents, applyReward, staffUserId: 'staff-test', note: 'visual test' });
  return { before, result, code: qr.code };
}
(async () => {
  const owned = await db.$queryRaw`SELECT n.nspname FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner WHERE n.nspname=${schema} AND r.rolname=current_user`;
  assert.equal(owned.length, 1, 'test schema must be owned by the application role');
  await wrapper.$transaction(async tx => {
    await tx.$executeRawUnsafe('CREATE TABLE "User" (id text PRIMARY KEY, name text, "lastName" text)');
    await tx.$executeRawUnsafe('CREATE TABLE "Restaurant" (id text PRIMARY KEY, name text)');
    await tx.$executeRawUnsafe('CREATE TABLE "Customer" (id text PRIMARY KEY, "userId" text REFERENCES "User"(id))');
    await tx.$executeRawUnsafe('CREATE TABLE "Product" (id text PRIMARY KEY, "restaurantId" text, name text, "isAvailable" boolean DEFAULT true, deleted boolean DEFAULT false, "sellBy" text DEFAULT \'UNIT\', "isAdultOnly" boolean DEFAULT false, "trackStock" boolean DEFAULT false, stock integer DEFAULT 0)');
    await tx.$executeRawUnsafe('CREATE TABLE "Order" (id text PRIMARY KEY, "customerId" text, "restaurantId" text, status text, "fulfillmentType" text, "createdAt" timestamp, "updatedAt" timestamp)');
    await tx.$executeRawUnsafe('CREATE TABLE "AuditLog" (id text PRIMARY KEY, "userId" text, action text, entity text, "entityId" text, "oldValue" text, "newValue" text, "ipAddress" text, "createdAt" timestamp DEFAULT CURRENT_TIMESTAMP)');
    await tx.$executeRawUnsafe('CREATE TABLE "SystemSetting" (id text PRIMARY KEY, key text UNIQUE, value text, "createdAt" timestamp DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp DEFAULT CURRENT_TIMESTAMP)');
    await tx.$executeRaw`INSERT INTO "User"(id,name,"lastName") VALUES ('customer-test','Ana','Prueba'),('staff-test','Empleado',NULL)`;
    await tx.$executeRaw`INSERT INTO "Restaurant"(id,name) VALUES (${RESTAURANT_ID},'WingsLab')`;
    await tx.$executeRaw`INSERT INTO "Customer"(id,"userId") VALUES ('customer-test','customer-test')`;
    await tx.$executeRaw`INSERT INTO "Product"(id,"restaurantId",name,"trackStock",stock) VALUES ('gift',${RESTAURANT_ID},'Papas',true,2)`;
    await tx.$executeRaw`INSERT INTO "SystemSetting"(id,key,value) VALUES ('loyalty','wingslab.restaurant.loyalty.v1',${JSON.stringify(program)})`;
    await tx.$executeRawUnsafe('CREATE TABLE "LoyaltyCard" (id text PRIMARY KEY,"customerId" text,"restaurantId" text,sequence integer,"programVersion" integer,goal integer,"rewardKind" text,"rewardValue" integer,"rewardProductId" text,"rewardDescription" text,terms text,state text DEFAULT \'OPEN\',"createdAt" timestamp DEFAULT CURRENT_TIMESTAMP,"completedAt" timestamp)');
    await tx.$executeRawUnsafe('CREATE TABLE "LoyaltyStamp" (id text PRIMARY KEY,"cardId" text,"orderId" text NOT NULL UNIQUE,"earnedAt" timestamp DEFAULT CURRENT_TIMESTAMP)');
    await tx.$executeRawUnsafe('CREATE TABLE "LoyaltyRedemption" (id text PRIMARY KEY,"cardId" text UNIQUE,"orderId" text NOT NULL UNIQUE,state text DEFAULT \'RESERVED\',"discountCents" integer,"reservedAt" timestamp DEFAULT CURRENT_TIMESTAMP,"completedAt" timestamp)');
    const sql = fs.readFileSync('/test/migration.sql', 'utf8').replace(/^--.*$/gm, '').replace(/ REFERENCES \"(Customer|Restaurant)\"\(\"id\"\) ON DELETE RESTRICT ON UPDATE CASCADE/g, '');
    for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean)) {
      if (statement.startsWith('GRANT')) continue;
      await tx.$executeRawUnsafe(statement);
    }
  });
  for (let i = 0; i < 7; i++) await runVisit(15000, false);
  const qr = await service.createScanSession(wrapper, 'customer-test');
  const preview = await service.previewInPerson(wrapper, qr.code);
  assert.equal(preview.customerName, 'Ana Prueba');
  assert.equal(preview.stamps, 7);
  assert.equal(preview.eligibleForReward, true);
  const eighth = await service.registerInPerson(wrapper, { code: qr.code, amountCents: 15000, applyReward: true, staffUserId: 'staff-test' });
  assert.equal(eighth.stamps, 8); assert.equal(eighth.completed, true); assert.equal(eighth.rewardAppliedCents, 1000);
  await assert.rejects(() => service.registerInPerson(wrapper, { code: qr.code, amountCents: 5000, applyReward: false, staffUserId: 'staff-test' }), /código|usado|expiró/i);
  await service.voidInPerson(wrapper, eighth.visitId, 'staff-test');
  assert.equal(await stampForVisit(eighth.visitId), null, 'void removes stamp');
  const afterVoid = await service.previewInPerson(wrapper, (await service.createScanSession(wrapper, 'customer-test')).code);
  assert.equal(afterVoid.stamps, 7); assert.equal(afterVoid.eligibleForReward, true, 'void restores reward');
  const ninth = await runVisit(15000, true);
  assert.equal(ninth.result.completed, true); assert.equal(ninth.result.rewardAppliedCents, 1000);
  console.log('PASS in-person QR: single-use, preview, 8th stamp + reward, code reuse blocked, void restores, repeat works');
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  try { await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { await db.$disconnect(); }
});
