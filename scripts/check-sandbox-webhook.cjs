// Public sandbox probe: no database, sockets or mutation of provider orders.
const http = require('node:http');
const { spawn } = require('node:child_process');
const { createHmac, timingSafeEqual } = require('node:crypto');
const { readLocalConfiguration } = require('../config/wingslab.cjs');
const { verifyMercadoPagoOrderSignature, fetchMercadoPagoOrder } = require('../packages/backend/dist/services/mercado-pago-orders.js');

const mp = readLocalConfiguration().mercadoPago;
if (mp?.sandbox !== true || !mp.webhookSecret || !mp.accessToken) throw new Error('Sandbox no configurado');
const path = '/webhooks/mercado-pago/orders';
let inFlight = 0;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const reply = (status, reason) => {
    req.resume();
    if (reason) console.log(JSON.stringify({ sandboxWebhook: reason, http: status }));
    res.writeHead(status); res.end();
  };
  if (url.pathname !== path || req.method !== 'POST') return reply(404);
  const id = url.searchParams.get('data.id');
  const signature = req.headers['x-signature'];
  const requestId = req.headers['x-request-id'];
  if (!id) return reply(401, 'missing-query-data-id');
  if (!/^ORDTST[A-Z0-9]{1,58}$/.test(id)) return reply(401, 'not-test-order-id');
  if (typeof signature !== 'string' || typeof requestId !== 'string') return reply(401, 'missing-signature-headers');
  if (!verifyMercadoPagoOrderSignature(id, requestId, signature, mp.webhookSecret)) {
    const ts = /(?:^|,)\s*ts=(\d+)(?:,|$)/.exec(signature)?.[1];
    const digest = /(?:^|,)\s*v1=([a-f\d]{64})(?:,|$)/i.exec(signature)?.[1];
    if (!ts || !digest || !/^[\w-]{1,128}$/.test(requestId)) return reply(401, 'malformed-signature-input');
    // The sandbox simulator signs the uppercase ID. This compatibility path
    // is confined to this read-only probe and the ORDTST IDs checked above.
    const exactCase = createHmac('sha256', mp.webhookSecret)
      .update(`id:${id};request-id:${requestId};ts:${ts};`).digest();
    if (!timingSafeEqual(exactCase, Buffer.from(digest, 'hex'))) return reply(401, 'signature-digest-mismatch');
    console.log(JSON.stringify({ sandboxWebhook: 'simulator-uppercase-signature-verified' }));
  }
  if (inFlight >= 4) return reply(503);
  inFlight++;
  req.resume();
  try {
    const order = await fetchMercadoPagoOrder(mp.accessToken, id);
    if (order.id !== id) return reply(503);
    console.log(JSON.stringify({ sandboxWebhook: 'verified', providerOrderRead: true, status: order.status }));
    reply(200);
  } catch { reply(503, 'provider-order-read-failed'); }
  finally { inFlight--; }
});

let tunnel;
function stop() { tunnel?.kill(); server.close(); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.listen(0, '127.0.0.1', () => {
  tunnel = spawn('cloudflared', ['tunnel', '--protocol', 'http2', '--url', `http://127.0.0.1:${server.address().port}`], { stdio: ['ignore', 'ignore', 'pipe'] });
  let printed = false;
  let buffer = '';
  tunnel.stderr.on('data', chunk => {
    if (printed) return;
    buffer = (buffer + chunk).slice(-4096);
    const url = buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
    if (url) { console.log(`${url}${path}`); printed = true; }
  });
  tunnel.on('error', () => { console.error('No se pudo iniciar el túnel.'); server.close(); process.exitCode = 1; });
  tunnel.on('exit', (code) => {
    if (!printed) {
      console.error(`Cloudflare no asignó una URL (salida ${code ?? 'por señal'}).`);
      process.exitCode = 1;
    }
    server.close();
  });
});
