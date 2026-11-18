// Runs only against WINGSLAB_DATABASE_URL explicitly supplied for a disposable
// database. It refuses the live WingsLab database and never reads live data.
const assert = require('node:assert/strict');
const { PrismaClient, UserRole } = require('/app/node_modules/@prisma/client');
const service = require('/app/packages/backend/dist/services/loyalty-inperson.service.js');
const { loyaltyState } = require('/app/packages/backend/dist/services/loyalty-runtime.service.js');
const { RESTAURANT_ID } = require('/app/packages/backend/dist/config/single-restaurant.js');
const url = new URL(process.env.WINGSLAB_DATABASE_URL || '');
assert.match(url.pathname, /^\/wl_loyalty_test_[a-f0-9]{32}$/);
assert.notEqual(url.pathname, '/wingslab_local');
const db = new PrismaClient({ datasourceUrl: url.toString() });
const tag = `it_${require('node:crypto').randomUUID().replaceAll('-', '')}`;
let userIndex = 0;
let staffId = '';
let productIds = {};
const program = (overrides = {}) => ({
  enabled: true, programVersion: 1, stampGoal: 2, rewardKind: 'AMOUNT', rewardValue: 1000,
  rewardProductId: null, rewardDescription: '$10 de descuento', stampTerms: '',
  stampStartsAt: '2026-01-01T00:00:00.000Z', redemptionReady: true,
  activePeriods: [{ from: '2026-01-01T00:00:00.000Z', to: null }], ...overrides,
});

async function createUser(role, name) {
  userIndex += 1;
  return db.user.create({ data: {
    id: `${tag}_u${userIndex}`, email: `${tag}_${userIndex}@test.invalid`, password: 'not-a-real-login',
    phone: `9${String(Date.now()).slice(-8)}${userIndex}`, name, role, region: 'TEST',
  } });
}
async function createCustomer(name) {
  const user = await createUser(UserRole.CUSTOMER, name);
  return db.customer.create({ data: { id: `${tag}_c${userIndex}`, userId: user.id } });
}
async function createProduct(categoryId, data) {
  return db.product.create({ data: { restaurantId: RESTAURANT_ID, categoryId, description: 'Fixture local', ...data }, include: { optionGroups: { include: { options: true } } } });
}
async function saveProgram(value) {
  await db.systemSetting.upsert({ where: { key: 'wingslab.restaurant.loyalty.v1' }, create: { key: 'wingslab.restaurant.loyalty.v1', value: JSON.stringify(value) }, update: { value: JSON.stringify(value) } });
}
async function sale(customer, { productId = productIds.plain, quantity = 1, applyReward = false, paymentMethod = 'CASH', optionIds = [], note } = {}) {
  const qr = await service.createScanSession(db, customer.id);
  const input = { code: qr.code, items: [{ productId, quantity, optionIds }], applyReward, paymentMethod, staffUserId: staffId, note };
  return { qr, input };
}
async function register(customer, options) {
  const { qr, input } = await sale(customer, options);
  const result = await service.registerInPerson(db, input);
  return { qr, input, result };
}

async function main() {
  const staff = await createUser(UserRole.RESTAURANT, 'Caja de prueba');
  staffId = staff.id;
  const restaurantUser = await createUser(UserRole.RESTAURANT, 'Restaurante de prueba');
  await db.restaurant.create({ data: {
    id: RESTAURANT_ID, userId: restaurantUser.id, name: 'WingsLab Integration Test', description: 'Aislamiento',
    address: 'Test', latitude: 19.4, longitude: -99.1, region: 'TEST', contactPhone: '5550000000',
    email: `${tag}_restaurant@test.invalid`, hasOwnDelivery: true,
  } });
  const category = await db.menuCategory.create({ data: { restaurantId: RESTAURANT_ID, name: 'Test', order: 0 } });
  const plain = await createProduct(category.id, {
    id: `${tag}_plain`, name: 'Producto sin inventario', price: 100, stock: 0, trackStock: false,
    optionGroups: { create: [{ name: 'Salsa obligatoria', minSelection: 1, maxSelection: 1, options: { create: [{ name: 'BBQ', price: 5, isAvailable: true }] } }] },
  });
  const tracked = await createProduct(category.id, { id: `${tag}_tracked`, name: 'Producto con inventario', price: 50, stock: 10, trackStock: true });
  const promo = await createProduct(category.id, { id: `${tag}_promo`, name: 'Producto promocional', price: 100, discountPrice: 80, stock: 0, trackStock: false });
  const gift = await createProduct(category.id, { id: `${tag}_gift`, name: 'Regalo controlado', price: 30, stock: 2, trackStock: true });
  productIds = { plain: plain.id, tracked: tracked.id, promo: promo.id, gift: gift.id };
  const customer1 = await createCustomer('Cliente uno');
  const customer2 = await createCustomer('Cliente dos');
  const customer3 = await createCustomer('Cliente tres');
  const customer4 = await createCustomer('Cliente cuatro');
  const customer5 = await createCustomer('Cliente cinco');
  const customer6 = await createCustomer('Cliente seis');
  const customer7 = await createCustomer('Cliente siete');
  await saveProgram(program());

  // Real catalogue price/options, QR race, idempotent retry, and no inventory
  // requirements for products whose trackStock flag is false.
  const first = await sale(customer1, { optionIds: [plain.optionGroups?.[0]?.options?.[0]?.id].filter(Boolean), paymentMethod: 'CARD' });
  const quote1 = await service.quoteInPerson(db, first.input.code, first.input.items, false);
  assert.equal(quote1.subtotalCents, 10500);
  const [r1, r1retry] = await Promise.all([
    service.registerInPerson(db, { ...first.input, staffUserId: staffId }),
    service.registerInPerson(db, { ...first.input, staffUserId: staffId }),
  ]);
  assert.equal(r1.visitId, r1retry.visitId, 'same QR and exact request returns the committed sale after a lost response');
  assert.equal(await db.loyaltyVisit.count({ where: { customerId: customer1.id } }), 1);
  assert.equal(await db.loyaltyStamp.count({ where: { card: { customerId: customer1.id } } }), 1);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: plain.id } })).stock, 0, 'trackStock=false never checks or changes stock');
  await assert.rejects(() => service.registerInPerson(db, { ...first.input, paymentMethod: 'CASH', staffUserId: staffId }), /usado|expiró/i);

  // Reward applies on the purchase that completes the card, while inventory
  // for a tracked purchase is deducted exactly once.
  const second = await sale(customer1, { productId: tracked.id, applyReward: true, paymentMethod: 'TRANSFER' });
  const quote2 = await service.quoteInPerson(db, second.input.code, second.input.items, true);
  assert.equal(quote2.totalCents, 4000);
  assert.equal(quote2.rewardAppliedCents, 1000);
  const r2 = await service.registerInPerson(db, { ...second.input, staffUserId: staffId });
  assert.equal(r2.completed, true);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: tracked.id } })).stock, 9);
  assert.equal(await db.loyaltyRedemption.count({ where: { visitId: r2.visitId, state: 'COMPLETED' } }), 1);
  await register(customer1, { optionIds: [plain.optionGroups?.[0]?.options?.[0]?.id].filter(Boolean) });
  await assert.rejects(() => service.voidInPerson(db, r2.visitId, staffId), /movimientos posteriores|premio.*usado/i);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: tracked.id } })).stock, 9, 'blocked void does not restore stock');

  // Product reward and concurrent duplicate void restore only the stock that
  // was actually decremented; untracked items remain unaffected.
  await saveProgram(program({ programVersion: 2, rewardKind: 'PRODUCT', rewardValue: null, rewardProductId: gift.id, rewardDescription: 'Regalo controlado' }));
  await register(customer2, { optionIds: [plain.optionGroups?.[0]?.options?.[0]?.id].filter(Boolean) });
  const giftSale = await sale(customer2, { applyReward: true, optionIds: [plain.optionGroups?.[0]?.options?.[0]?.id].filter(Boolean) });
  const giftResult = await service.registerInPerson(db, { ...giftSale.input, staffUserId: staffId });
  assert.equal(giftResult.rewardDescription, 'Regalo controlado de regalo');
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: gift.id } })).stock, 1);
  const voidResults = await Promise.all([
    service.voidInPerson(db, giftResult.visitId, staffId),
    service.voidInPerson(db, giftResult.visitId, staffId),
  ]);
  assert.equal(voidResults.filter(result => result.alreadyVoided).length, 1);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: gift.id } })).stock, 2);
  assert.equal(await db.loyaltyStamp.count({ where: { visitId: giftResult.visitId } }), 0);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: plain.id } })).stock, 0);

  // Promotion and loyalty reward cannot be combined; failed registration rolls
  // the QR consumption back so the same sale can be recorded without reward.
  await saveProgram(program({ programVersion: 3 }));
  await register(customer3, { optionIds: [plain.optionGroups?.[0]?.options?.[0]?.id].filter(Boolean) });
  const promoSale = await sale(customer3, { productId: promo.id, applyReward: true });
  const promoQuote = await service.quoteInPerson(db, promoSale.input.code, promoSale.input.items, true);
  assert.equal(promoQuote.subtotalCents, 8000);
  assert.equal(promoQuote.rewardEligible, false);
  assert.match(promoQuote.rewardUnavailableReason, /no se combina/i);
  await assert.rejects(() => service.registerInPerson(db, { ...promoSale.input, staffUserId: staffId }), /no se combina/i);
  const promoResult = await service.registerInPerson(db, { ...promoSale.input, applyReward: false, staffUserId: staffId });
  assert.equal(promoResult.completed, true);
  assert.equal(promoResult.rewardAppliedCents, 0);
  assert.equal(await db.loyaltyRedemption.count({ where: { visitId: promoResult.visitId } }), 0);

  // The quote checks combined sale+gift inventory. The failed reward attempt
  // rolls back QR use; the same purchase can still be saved without the gift.
  await saveProgram(program({ programVersion: 4, rewardKind: 'PRODUCT', rewardValue: null, rewardProductId: gift.id, rewardDescription: 'Regalo controlado' }));
  await register(customer4, { optionIds: [plain.optionGroups?.[0]?.options?.[0]?.id].filter(Boolean) });
  const sameGiftSale = await sale(customer4, { productId: gift.id, quantity: 2, applyReward: true });
  const sameGiftQuote = await service.quoteInPerson(db, sameGiftSale.input.code, sameGiftSale.input.items, true);
  assert.equal(sameGiftQuote.rewardEligible, false);
  await assert.rejects(() => service.registerInPerson(db, { ...sameGiftSale.input, staffUserId: staffId }), /existencias suficientes/i);
  const withoutGift = await service.registerInPerson(db, { ...sameGiftSale.input, applyReward: false, staffUserId: staffId });
  assert.equal(withoutGift.completed, true);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: gift.id } })).stock, 0);

  // A timely void restores sale stock exactly once; the author and five-minute
  // window are enforced before any stock or ledger mutation.
  const trackedVoid = await register(customer5, { productId: tracked.id, quantity: 2 });
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: tracked.id } })).stock, 7);
  await service.voidInPerson(db, trackedVoid.result.visitId, staffId);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: tracked.id } })).stock, 9);
  assert.equal((await service.voidInPerson(db, trackedVoid.result.visitId, staffId)).alreadyVoided, true);
  const oldSale = await register(customer6, { productId: tracked.id });
  await assert.rejects(() => service.voidInPerson(db, oldSale.result.visitId, `${tag}_different_staff`), /Solo quien registró/i);
  await db.loyaltyVisit.update({ where: { id: oldSale.result.visitId }, data: { createdAt: new Date(Date.now() - 6 * 60 * 1000) } });
  await assert.rejects(() => service.voidInPerson(db, oldSale.result.visitId, staffId), /plazo.*terminó/i);

  // The same immutable card combines local and online stamps. The runtime
  // reconciles a completed, paid pickup order into the open in-person card.
  await register(customer7, { optionIds: [plain.optionGroups?.[0]?.options?.[0]?.id].filter(Boolean) });
  const onlineOrderId = `${tag}_online_order`;
  await db.order.create({ data: {
    id: onlineOrderId, orderReference: `${tag}_REF`, restaurantId: RESTAURANT_ID, customerId: customer7.id,
    subtotal: 100, taxAmount: 0, deliveryFee: 0, totalAmount: 100, paymentMethod: 'CASH',
    estimatedDeliveryTime: new Date(Date.now() + 60_000), fulfillmentType: 'PICKUP',
    status: 'COMPLETED', paymentStatus: 'COMPLETED', completedAt: new Date(),
  } });
  const combinedState = await db.$transaction(tx => loyaltyState(tx, customer7.id));
  assert.equal(combinedState.available.length, 1);
  assert.equal(combinedState.available[0].stamps, 2);
  assert.equal(await db.loyaltyStamp.count({ where: { card: { customerId: customer7.id }, source: 'IN_PERSON' } }), 1);
  assert.equal(await db.loyaltyStamp.count({ where: { card: { customerId: customer7.id }, source: 'ONLINE' } }), 1);

  const expired = await service.createScanSession(db, customer3.id);
  await db.loyaltyScanSession.updateMany({ where: { code: require('node:crypto').createHash('sha256').update(expired.code).digest('hex') }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await assert.rejects(() => service.previewInPerson(db, expired.code), /expiró|usado/i);
  console.log('PASS isolated in-person flow: price/options, no-stock products, idempotent QR retry/race, unified online+local stamps, stamp+reward, promo exclusion, optional stock, stock restoration, single-use concurrent void, later-movement/author/time guards, QR expiry');
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; }).finally(async () => { await db.$disconnect(); });
