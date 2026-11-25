const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadHandlers(overrides = {}, globals = {}) {
  const handlers = {};
  const self = {
    location: { origin: 'https://customer.wingslab.example' },
    addEventListener: (name, handler) => { handlers[name] = handler; },
    ...overrides,
  };
  const source = fs.readFileSync(path.join(__dirname, '../../public/sw.js'), 'utf8');
  const context = { self, URL, Response, AbortSignal, console, ...globals };
  vm.runInNewContext(source, context);
  handlers.reportSubscription = context.reportSubscriptionToBackend;
  return handlers;
}

test('customer worker never intercepts private API requests for offline cache fallback', () => {
  const fetchHandler = loadHandlers().fetch;
  let responsePromise;
  fetchHandler({
    request: {
      url: 'https://customer.wingslab.example/api/me/pedidos?page=1',
      method: 'GET',
      mode: 'cors',
    },
    respondWith: (promise) => { responsePromise = promise; },
  });
  assert.equal(responsePromise, undefined);
});

test('rotated subscription retries HTTP 503 but not HTTP 401', async () => {
  for (const [statuses, expected, calls] of [[[503, 200], true, 2], [[401], false, 1]]) {
    let requests = 0;
    const { reportSubscription } = loadHandlers({}, {
      indexedDB: { open() {
        const request = { result: {
          close() {},
          transaction: () => ({ objectStore: () => ({ get() {
            const read = { result: { token: 'test-session' } };
            queueMicrotask(() => read.onsuccess());
            return read;
          } }) }),
        } };
        queueMicrotask(() => request.onsuccess());
        return request;
      } },
      fetch: async () => new Response(null, { status: statuses[requests++] }),
      setTimeout: queueMicrotask,
    });
    const subscription = { endpoint: 'https://push.example/test', toJSON: () => ({ keys: { p256dh: 'test', auth: 'test' } }) };
    assert.equal(await reportSubscription(subscription, 'test-session'), expected);
    assert.equal(requests, calls);
  }
});

test('customer worker leaves timestamped Next development assets to the browser', () => {
  const fetchHandler = loadHandlers().fetch;
  let intercepted = false;
  fetchHandler({
    request: {
      url: 'http://127.0.0.1:3103/_next/static/chunks/main-app.js?v=123',
      method: 'GET',
      mode: 'cors',
    },
    respondWith: () => { intercepted = true; },
  });
  assert.equal(intercepted, false);
});

test('customer worker displays one order notification and preserves its destination', async () => {
  const shown = [];
  const { push } = loadHandlers({ registration: {
    async showNotification(title, options) { shown.push({ title, options }); },
  } });
  let completed;
  push({
    data: { json: () => ({ title: 'Pedido listo', tag: 'ready-123', data: { orderId: '123' } }) },
    waitUntil: (promise) => { completed = promise; },
  });
  assert.ok(completed);
  await completed;
  assert.equal(shown.length, 1);
  assert.equal(shown[0].title, 'Pedido listo');
  assert.equal(shown[0].options.tag, 'ready-123');
  assert.equal(shown[0].options.data.orderId, '123');
});
