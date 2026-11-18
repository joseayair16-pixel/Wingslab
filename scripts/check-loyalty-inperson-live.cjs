// Integration check against real tables using only uniquely tagged fake rows.
// A backup/restore protects the loyalty configuration; finally cleans everything.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PrismaClient, UserRole } = require('/app/node_modules/@prisma/client');
const service = require('/app/packages/backend/dist/services/loyalty-inperson.service.js');
const { LOYALTY_KEY } = require('/app/packages/backend/dist/services/loyalty-runtime.service.js');
const { RESTAURANT_ID } = require('/app/packages/backend/dist/config/single-restaurant.js');
const config = JSON.parse(fs.readFileSync('/app/config/wingslab.local.json', 'utf8'));
const db = new PrismaClient({ datasourceUrl: config.backend.databaseUrl });
const tag = 'wl_itest_' + randomUUID().replaceAll('-', '');
const userId = tag + '_u', customerId = tag + '_c', staffId = tag + '_s';
let backup = null;
async function cleanup() {
  await db.loyaltyScanSession.deleteMany({ where: { customerId } });
  const stamps = await db.loyaltyStamp.findMany({ where: { card: { customerId } }, select: { id: true } });
  await db.loyaltyRedemption.deleteMany({ where: { card: { customerId } } });
  await db.loyaltyStamp.deleteMany({ where: { id: { in: stamps.map(s => s.id) } } });
  await db.loyaltyCard.deleteMany({ where: { customerId } });
  await db.loyaltyVisit.deleteMany({ where: { customerId } });
  await db.auditLog.deleteMany({ where: { entityId: { startsWith: tag } } });
  await db.customer.deleteMany({ where: { id: customerId } });
  await db.user.deleteMany({ where: { id: { in: [userId, staffId] } } });
  if (backup) await db.systemSetting.update({ where: { key: LOYALTY_KEY }, data: { value: backup } });
}
(async () => {
  const setting = await db.systemSetting.findUnique({ where: { key: LOYALTY_KEY } });
  backup = setting?.value ?? null;
  const program = { enabled: true, programVersion: 1, stampGoal: 2, rewardKind: 'AMOUNT', rewardValue: 1000, rewardProductId: null, rewardDescription: '$10 de descuento', stampTerms: '', stampStartsAt: '2026-01-01T00:00:00Z', redemptionReady: true, activePeriods: [{ from: '2026-01-01T00:00:00Z', to: null }] };
  await db.systemSetting.upsert({ where: { key: LOYALTY_KEY }, create: { key: LOYALTY_KEY, value: JSON.stringify(program) }, update: { value: JSON.stringify(program) } });
  const roleStaff = await db.user.create({ data: { id: staffId, email: tag + '_staff@test.local', password: 'x', phone: '5510' + tag.slice(-6), name: 'Staff', role: UserRole.RESTAURANT, region: 'TEST' } });
  void roleStaff;
  await db.user.create({ data: { id: userId, email: tag + '@test.local', password: 'x', phone: '5511' + tag.slice(-6), name: 'Ana', lastName: 'Prueba', role: UserRole.CUSTOMER, region: 'TEST' } });
  await db.customer.create({ data: { id: customerId, userId } });
  const qr1 = await service.createScanSession(db, customerId);
  const p1 = await service.previewInPerson(db, qr1.code);
  assert.equal(p1.customerName, 'Ana Prueba'); assert.equal(p1.stamps, 0); assert.equal(p1.eligibleForReward, false);
  const v1 = await service.registerInPerson(db, { code: qr1.code, amountCents: 15000, applyReward: false, staffUserId: staffId });
  assert.equal(v1.stamps, 1); assert.equal(v1.completed, false);
  const qr2 = await service.createScanSession(db, customerId);
  const p2 = await service.previewInPerson(db, qr2.code);
  assert.equal(p2.stamps, 1); assert.equal(p2.eligibleForReward, true);
  const v2 = await service.registerInPerson(db, { code: qr2.code, amountCents: 15000, applyReward: true, staffUserId: staffId });
  assert.equal(v2.stamps, 2); assert.equal(v2.completed, true); assert.equal(v2.rewardAppliedCents, 1000);
  await assert.rejects(() => service.registerInPerson(db, { code: qr2.code, amountCents: 5000, applyReward: false, staffUserId: staffId }), /usado|expiró/i);
  await service.voidInPerson(db, v2.visitId, staffId);
  const qr3 = await service.createScanSession(db, customerId);
  const p3 = await service.previewInPerson(db, qr3.code);
  assert.equal(p3.stamps, 1); assert.equal(p3.eligibleForReward, true, 'void restores reward');
  console.log('PASS in-person live: preview, stamp, 2nd-purchase reward, single-use, void restores; all fake rows will be removed');
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  try { await cleanup(); } catch (error) { console.error('CLEANUP FAILED: ' + error.message); process.exitCode = 1; }
  await db.$disconnect();
});
