const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadFetchHandler() {
  const handlers = {};
  const self = {
    location: { origin: 'https://customer.wingslab.example' },
    addEventListener: (name, handler) => { handlers[name] = handler; },
  };
  const source = fs.readFileSync(path.join(__dirname, '../../public/sw.js'), 'utf8');
  vm.runInNewContext(source, { self, URL, Response, console });
  return handlers.fetch;
}

test('customer worker never intercepts private API requests for offline cache fallback', () => {
  const fetchHandler = loadFetchHandler();
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

test('customer worker leaves timestamped Next development assets to the browser', () => {
  const fetchHandler = loadFetchHandler();
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
