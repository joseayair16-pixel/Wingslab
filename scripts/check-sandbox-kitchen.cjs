// Run only in the disposable database container network created by the test runner.
const assert = require('node:assert/strict');
const { randomUUID, createHmac } = require('node:crypto');
const { PrismaClient } = require('/app/node_modules/@prisma/client');
const { recordVerifiedCheckoutPayment } = require('/app/packages/backend/dist/services/checkout-payment-intent.js');
const { finalizeVerifiedCustomerCheckout } = require('/app/packages/backend/dist/services/order.service.js');
const { dispatchCheckoutKitchenOutbox } = require('/app/packages/backend/dist/services/checkout-kitchen-outbox.js');
const { getFirstInQueue } = require('/app/packages/backend/dist/services/order-workflow.service.js');

async function main() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? '');
  assert.equal(url.hostname, 'sandbox-db');
  assert.equal(url.pathname, '/checkout_fixture');
  assert.equal(process.env.WINGSLAB_MODE, 'test');
  const db = new PrismaClient({ datasourceUrl: url.href });
  try {
    assert.equal(await db.user.count(), 0);
    const user = role => db.user.create({ data: { role, email: `${role.toLowerCase()}@example.invalid`, password: 'not-a-login', phone: '', region: 'TEST', name: 'Fixture' } });
    const customer = await db.customer.create({ data: { userId: (await user('CUSTOMER')).id } });
    const restaurant = await db.restaurant.create({ data: { userId: (await user('RESTAURANT')).id, name: 'Cocina de prueba', description: 'Fixture', address: 'Fixture', latitude: 0, longitude: 0, region: 'TEST', contactPhone: '', email: 'kitchen@example.invalid' } });
    const category = await db.menuCategory.create({ data: { restaurantId: restaurant.id, name: 'Fixture' } });
    const product = await db.product.create({ data: { restaurantId: restaurant.id, categoryId: category.id, name: 'Fixture', description: 'Fixture', price: 290 } });
    const actual = process.argv.includes('--provider-stdin') ? JSON.parse(require('node:fs').readFileSync(0, 'utf8')) : null;
    const id = actual ? actual.external_reference : randomUUID();
    assert.match(id, /^[0-9a-f-]{36}$/);
    await db.checkoutPaymentIntent.create({ data: { id, customerId: customer.id, restaurantId: restaurant.id,
      requestKey: id, fingerprint: 'fixture', amountCents: 29000, state: 'SUBMITTING', expiresAt: new Date(Date.now() + 60000), stock: [],
      snapshot: { fulfillmentType: 'PICKUP', subtotal: 290, taxAmount: 0, serviceFee: 0, deliveryFee: 0, promoDiscountAmount: 0, etaMs: 600000,
        items: [{ productId: product.id, quantity: 1, unitPrice: 290, subtotal: 290, sellBy: 'UNIT', options: [] }] } } });
    const provider = { id: 'ORDTESTFIXTURE', type: 'online', external_reference: id, country_code: 'MEX', total_amount: '290.00', total_paid_amount: '290.00',
      status: 'processed', status_detail: 'accredited', transactions: { payments: [{ id: 'PAYTESTFIXTURE', amount: '290.00', status: 'processed', status_detail: 'accredited' }] } };
    if (process.argv.includes('--webhook-live')) {
      const app = require('/app/node_modules/fastify')();
      const { Server } = require('/app/node_modules/socket.io');
      const io = new Server(app.server);
      app.decorate('io', io);
      const database = require('/app/packages/backend/dist/config/database.js');
      const previousDb = database.prisma;
      const previousFetch = globalThis.fetch;
      database.prisma = db;
      const order = actual ?? provider;
      const path = `/webhooks/mercado-pago/orders?data.id=${order.id}`;
      const secret = randomUUID();
      process.env.WINGSLAB_MP_SANDBOX_WEBHOOK_SECRET = secret;
      process.env.WINGSLAB_MP_SANDBOX_ACCESS_TOKEN = 'isolated-fixture';
      process.env.WINGSLAB_CHECKOUT_SANDBOX_ROUTES = 'true';
      process.env.WINGSLAB_CHECKOUT_RESERVATION_SWEEP = 'true';
      delete process.env.WINGSLAB_CHECKOUT_SANDBOX_CHARGES;
      globalThis.fetch = async (url, options) => {
        assert.equal(String(url), `https://api.mercadopago.com/v1/orders/${order.id}`);
        assert.equal(options?.method, undefined);
        return Response.json(order);
      };
      let ws;
      try {
        await app.register(require('/app/packages/backend/dist/routes/order.routes.js').registerOrderRoutes);
        io.on('connection', socket => socket.join(`RESTAURANT:${restaurant.userId}`));
        await app.listen({ host: '127.0.0.1', port: 0 });
        ws = new WebSocket(`ws://127.0.0.1:${app.server.address().port}/socket.io/?EIO=4&transport=websocket`);
        const events = [];
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('socket timeout')), 5000);
          ws.addEventListener('message', ({ data }) => {
            if (data.startsWith('0')) ws.send('40');
            else if (data.startsWith('40')) { clearTimeout(timer); resolve(); }
            else if (data.startsWith('42')) events.push(JSON.parse(data.slice(2)));
          });
        });
        assert.equal((await app.inject({ method: 'POST', url: path })).statusCode, 401);
        assert.equal(await db.order.count(), 0);
        const signed = () => {
          const requestId = randomUUID();
          const ts = Date.now();
          const mac = createHmac('sha256', secret).update(`id:${order.id.toLowerCase()};request-id:${requestId};ts:${ts};`).digest('hex');
          return app.inject({ method: 'POST', url: path, headers: { 'x-request-id': requestId, 'x-signature': `ts=${ts},v1=${mac}` } });
        };
        assert.deepEqual((await Promise.all([signed(), signed()])).map(response => response.statusCode), [204, 204]);
        const saved = await db.order.findUniqueOrThrow({ where: { clientOrderKey: `mp:${id}` } });
        assert.equal(await db.order.count(), 1);
        assert.equal(saved.paymentStatus, 'COMPLETED');
        assert.equal(await getFirstInQueue(restaurant.id), saved.id);
        assert.equal((await db.kitchenOrderOutbox.findUniqueOrThrow({ where: { orderId: saved.id } })).status, 'DELIVERED');
        // Allow the already-connected subscriber to receive the broadcast.
        for (let i = 0; i < 20 && !events.length; i++) await new Promise(resolve => setTimeout(resolve, 25));
        assert.equal(events.filter(([name, data]) => name === 'order:created' && data.orderId === saved.id).length, 1);
        if (process.argv.includes('--panel-fixture')) {
          const { restaurantOrderListSelect } = require('/app/packages/backend/dist/services/order-selects.js');
          const order = await db.order.findUniqueOrThrow({ where: { id: saved.id }, select: restaurantOrderListSelect });
          console.log(JSON.stringify({ order, event: events.find(([name]) => name === 'order:created') }));
          return;
        }
        console.log('PASS: ruta webhook real, dos entregas firmadas, un pedido y un evento Socket.IO recibido.');
      } finally {
        ws?.close();
        io.disconnectSockets(true);
        io.engine?.close();
        await app.close();
        database.prisma = previousDb;
        globalThis.fetch = previousFetch;
      }
      return;
    }
    assert.equal(await recordVerifiedCheckoutPayment(db, id, actual ?? provider), true);
    const outcomes = await Promise.all([finalizeVerifiedCustomerCheckout(db, id), finalizeVerifiedCustomerCheckout(db, id)]);
    const order = outcomes[0].order;
    assert.equal(outcomes[1].order.id, order.id);
    assert.deepEqual(outcomes.map(result => result.isDuplicate).sort(), [false, true]);
    assert.equal(await db.order.count(), 1);
    assert.equal(order.paymentStatus, 'COMPLETED');
    assert.equal(order.totalAmount, 290);
    const errors = [];
    assert.equal(await dispatchCheckoutKitchenOutbox(db, undefined, () => errors.push('dispatch failed')), 1);
    assert.deepEqual(errors, []);
    assert.equal(await dispatchCheckoutKitchenOutbox(db, undefined, () => errors.push('duplicate dispatch failed')), 0);
    assert.equal(await getFirstInQueue(restaurant.id), order.id);
    assert.equal((await db.kitchenOrderOutbox.findUniqueOrThrow({ where: { orderId: order.id } })).status, 'DELIVERED');
    if (process.argv.includes('--reject-card') || process.argv.includes('--cancel-card')) {
      const { updateOrderStatusByRestaurant, cancelOrderByRestaurant } = require('/app/packages/backend/dist/services/order-workflow.service.js');
      const cancel = process.argv.includes('--cancel-card');
      if (cancel) await db.order.update({ where: { id: order.id }, data: { status: 'PREPARING' } });
      const action = () => cancel ? cancelOrderByRestaurant(db, order.id, restaurant.userId, 'Cancelación de prueba') : updateOrderStatusByRestaurant({ prisma: db, restaurantUserId: restaurant.userId,
        orderId: order.id, nextStatus: 'REJECTED', trackingNote: 'Rechazo de prueba' });
      const results = await Promise.allSettled([action(), action()]);
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      const refunds = await db.checkoutRefundRequest.findMany({ where: { orderId: order.id } });
      assert.equal(refunds.length, 1);
      assert.equal(refunds[0].providerOrderId, (actual ?? provider).id);
      assert.equal(refunds[0].state, 'PENDING');
      assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status, cancel ? 'CANCELLED' : 'REJECTED');
      console.log(`PASS: ${cancel ? 'cancelación' : 'rechazo'} de tarjeta concurrente genera un único reembolso pendiente.`);
      return;
    }
    if (process.argv.includes('--panel-fixture')) {
      const { restaurantOrderListSelect } = require('/app/packages/backend/dist/services/order-selects.js');
      console.log(JSON.stringify(await db.order.findUniqueOrThrow({ where: { id: order.id }, select: restaurantOrderListSelect })));
      return;
    }
    console.log('PASS PostgreSQL aislado: un pedido pagado; una entrega a cola de cocina de prueba; sin sockets.');
  } finally { await db.$disconnect(); }
}

main().catch(error => { console.error('Falló la prueba aislada:', error?.code || error?.name); process.exitCode = 1; });
