'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { once } = require('node:events');
const { createRelay } = require('./relay.cjs');

test('relays concurrent requests and preserves the complete response', async () => {
  const backend = http.createServer((request, response) => response.end('orders-ok'));
  backend.listen(0, '127.0.0.1');
  await once(backend, 'listening');
  const relay = createRelay('127.0.0.1', backend.address().port);
  relay.listen({ port: 0, host: '127.0.0.1', backlog: 512 });
  await once(relay, 'listening');
  try {
    const responses = await Promise.all(Array.from({ length: 100 }, () => fetch(`http://127.0.0.1:${relay.address().port}`, { signal: AbortSignal.timeout(5000) }).then(response => response.text())));
    assert.deepEqual(responses, Array(100).fill('orders-ok'));
  } finally {
    relay.closeAllConnections?.();
    backend.closeAllConnections();
    relay.close();
    backend.close();
  }
});

test('keeps persistent bidirectional connections open across idle periods', async () => {
  const backend = net.createServer(socket => socket.pipe(socket));
  backend.listen(0, '127.0.0.1');
  await once(backend, 'listening');
  const relay = createRelay('127.0.0.1', backend.address().port);
  relay.listen(0, '127.0.0.1');
  await once(relay, 'listening');
  const client = net.createConnection({ port: relay.address().port, host: '127.0.0.1' });
  try {
    await once(client, 'connect');
    const first = once(client, 'data');
    client.write('first');
    assert.equal(String((await first)[0]), 'first');
    await new Promise(resolve => setTimeout(resolve, 100));
    const second = once(client, 'data');
    client.write('second');
    assert.equal(String((await second)[0]), 'second');
  } finally { client.destroy(); relay.close(); backend.close(); }
});

test('closes the client cleanly when an upstream is unavailable', async () => {
  const temporary = net.createServer();
  temporary.listen(0, '127.0.0.1');
  await once(temporary, 'listening');
  const port = temporary.address().port;
  await new Promise(resolve => temporary.close(resolve));
  const relay = createRelay('127.0.0.1', port);
  relay.listen(0, '127.0.0.1');
  await once(relay, 'listening');
  const client = net.createConnection({ port: relay.address().port, host: '127.0.0.1' });
  try {
    await once(client, 'connect');
    await once(client, 'close');
    assert.equal(client.destroyed, true);
  } finally { client.destroy(); relay.close(); }
});

test('does not truncate a large response when the upstream closes', async () => {
  const payload = Buffer.alloc(4 * 1024 * 1024, 0x61);
  const backend = http.createServer((request, response) => {
    response.setHeader('Connection', 'close');
    response.end(payload);
  });
  backend.listen(0, '127.0.0.1');
  await once(backend, 'listening');
  const relay = createRelay('127.0.0.1', backend.address().port);
  relay.listen(0, '127.0.0.1');
  await once(relay, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${relay.address().port}`, { signal: AbortSignal.timeout(5000) });
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), payload);
  } finally { relay.close(); backend.closeAllConnections(); backend.close(); }
});
