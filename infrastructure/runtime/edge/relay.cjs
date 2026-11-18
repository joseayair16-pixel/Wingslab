'use strict';

// Fixed destinations only: the edge is not a general-purpose proxy.
const net = require('node:net');
const targets = [
  [15432, '172.30.240.10', 5432],
  [16379, '172.30.240.11', 6379],
  [3101, '172.30.240.21', 3101],
  [3103, '172.30.240.22', 3103],
  [3102, '172.30.240.23', 3102],
  [3104, '172.30.240.24', 3104],
];

function createRelay(host, port) {
  return net.createServer(client => {
    const upstream = net.createConnection({ host, port });
    // Bound connection establishment, but do not expire idle WebSockets or DB sessions.
    const connectTimeout = setTimeout(() => upstream.destroy(), 10000);
    upstream.once('connect', () => clearTimeout(connectTimeout));
    upstream.once('close', () => {
      clearTimeout(connectTimeout);
      // A normal EOF is already forwarded by pipe(); destroying here can drop
      // response bytes still buffered for a slow client.
      if (!upstream.readableEnded) client.destroy();
    });
    client.once('close', () => upstream.destroy());
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
    client.pipe(upstream).pipe(client);
  });
}

if (require.main === module) {
  const servers = targets.map(([listenPort, host, port]) => {
    const server = createRelay(host, port);
    server.on('error', error => { console.error(`Relay ${listenPort}: ${error.message}`); process.exit(1); });
    server.listen({ host: '172.31.240.10', port: listenPort, backlog: 512 });
    return server;
  });
  const stop = () => {
    for (const server of servers) server.close();
    // Docker's init handles the remaining connections at shutdown.
    setTimeout(() => process.exit(0), 1000).unref();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

module.exports = { createRelay };
