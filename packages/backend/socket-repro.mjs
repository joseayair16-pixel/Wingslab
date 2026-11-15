import '../../scripts/blocked-operation.cjs';
import http from 'http';
import Fastify from 'fastify';
import fastifySocketIO from 'fastify-socket.io';

const httpServer = http.createServer();

const fastify = Fastify({
  serverFactory: (handler) => {
    httpServer.on('request', (req, res) => {
      if (req.url?.startsWith('/socket.io')) {
        return;
      }
      handler(req, res);
    });
    return httpServer;
  },
});

await fastify.register(fastifySocketIO, {
  cors: { origin: '*' },
  pingInterval: 10000,
  pingTimeout: 5000,
});

fastify.get('/health', async () => ({ ok: true }));

httpServer.listen(3998, () => console.log('TEST SERVER on 3998'));
