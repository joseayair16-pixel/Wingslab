// Validación en navegador del panel de restaurante (Fase 3C). Solo lectura y UI.
// No ejecuta ninguna acción de pedido: el clic sobre un fixture protegido debe
// quedar bloqueado en el cliente y no generar ninguna petición de red.
const { spawn } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const output = path.resolve(process.argv[2]);
const AUTHORIZED = 'cmwgzrpnm0047orggilrr3fxu';
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const seed = fs.readFileSync('packages/backend/src/scripts/wingslab-seed.ts', 'utf8');
const password = seed.match(/const FICTIONAL_PASSWORD = '([^']+)'/)[1];
const phone = seed.slice(seed.indexOf('const restaurantUser'), seed.indexOf('const restaurant =')).match(/phone: '([^']+)'/)[1];
const redact = text => text.replaceAll(password, '[withheld]').replaceAll(phone, '[contact]').replace(/\b\d{10}\b/g, '[contact]');

const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--remote-debugging-pipe', `--user-data-dir=${output}/profile`,
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--disable-component-update', '--disable-sync', '--disable-extensions', '--disable-default-apps',
  '--metrics-recording-only', '--disable-features=MediaRouter',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });

let buffer = '', serial = 0, session, failOrders = false;
const pending = new Map(), requests = [], blocked = [], exceptions = [], events = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function send(method, params = {}, sid = session) {
  const id = ++serial;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout ' + method)); }, 25000);
    pending.set(id, { resolve, reject, timeout });
    chrome.stdio[3].write(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) }) + '\0');
  });
}
chrome.stdio[4].on('data', chunk => {
  buffer += chunk.toString();
  while (buffer.includes('\0')) {
    const i = buffer.indexOf('\0'), m = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1);
    if (m.id) {
      const p = pending.get(m.id); if (!p) continue;
      clearTimeout(p.timeout); pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
      continue;
    }
    if (m.method === 'Fetch.requestPaused') {
      const { requestId, request } = m.params, u = new URL(request.url);
      const route = u.pathname.replace(/^\/api(?=\/)/, '');
      const loopback = ['http://127.0.0.1:3101', 'http://127.0.0.1:3102'].includes(u.origin);
      const read = ['GET', 'HEAD', 'OPTIONS'].includes(request.method);
      const allowed = loopback && (read || (request.method === 'POST' && ['/auth/restaurant-login', '/auth/refresh'].includes(route)));
      const ordersRead = read && /\/restaurant-panel\/pedidos/.test(route);
      if (!allowed) blocked.push({ method: request.method, origin: u.origin, path: route });
      if (!allowed) send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {});
      else if (failOrders && ordersRead) send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {});
      else send('Fetch.continueRequest', { requestId }).catch(() => {});
    } else if (m.method === 'Network.requestWillBeSent') {
      requests.push({ method: m.params.request.method, url: m.params.request.url });
    } else if (m.method === 'Network.webSocketFrameReceived') {
      const raw = m.params.response.payloadData;
      if (raw.startsWith('42')) { try { const [name] = JSON.parse(raw.slice(2)); events.push(name); } catch {} }
    } else if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.text);
  }
});
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function snapshot(name) {
  const data = await evaluate(`({text:document.body.innerText,buttons:[...document.querySelectorAll('button')].map(b=>({text:b.innerText.trim(),disabled:b.disabled})),url:location.href})`);
  const safe = JSON.parse(redact(JSON.stringify(data)));
  fs.writeFileSync(path.join(output, name + '.json'), JSON.stringify(safe, null, 2), { mode: 0o600 });
  console.log(name, redact(JSON.stringify(data.text)).slice(0, 2200));
  return data;
}
const clickByText = text => evaluate(`(()=>{const b=[...document.querySelectorAll('button')].filter(b=>b.innerText.trim()===${JSON.stringify(text)}&&b.getClientRects().length).at(-1);if(!b)return false;b.click();return true})()`);

(async () => {
  const target = await send('Target.createTarget', { url: 'about:blank' }, null);
  session = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null)).sessionId;
  for (const method of ['Page.enable', 'Runtime.enable', 'Network.enable']) await send(method);
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://127.0.0.1:3102/' }); await sleep(2500);

  await evaluate(`(()=>{const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;const ins=[...document.querySelectorAll('input')];const t=ins.find(i=>i.type==='tel'||i.type==='text'),p=ins.find(i=>i.type==='password');set.call(t,${JSON.stringify(phone)});t.dispatchEvent(new Event('input',{bubbles:true}));set.call(p,${JSON.stringify(password)});p.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  assert(await clickByText('Iniciar sesión'), 'login button missing'); await sleep(4000);
  const sessionUser = await evaluate(`JSON.parse(localStorage.getItem('sadel.restaurant.user')||'null')`);
  assert.equal(sessionUser?.role, 'RESTAURANT');

  assert(await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim().startsWith('Ordenes'));if(b)b.click();return !!b})()`));
  await sleep(1500);
  const orders = await snapshot('orders');

  // 1) El pedido autorizado en PREPARING ofrece solo "Marcar listo".
  const authorizedCard = await evaluate(`(()=>{const t=document.body.innerText;const i=t.indexOf('#04');if(i<0)return null;const j=t.indexOf('#0',i+3);return t.slice(i,j<0?i+900:j)})()`);
  assert(authorizedCard, 'authorized order card not found');
  assert(authorizedCard.includes('Marcar listo'), 'expected "Marcar listo" for PREPARING');
  assert(!authorizedCard.includes('Aceptar pedido'), 'unexpected "Aceptar pedido" for PREPARING');
  assert(!authorizedCard.includes('Iniciar preparacion'), 'unexpected "Iniciar preparacion" for PREPARING');

  // 2) El fixture PENDING no expone acciones: la lista blanca se evalúa al pintar.
  const pendingCard = await evaluate(`(()=>{const t=document.body.innerText;const i=t.indexOf('#01');if(i<0)return null;const j=t.indexOf('#0',i+3);return t.slice(i,j<0?i+900:j)})()`);
  assert(pendingCard, 'pending fixture card not found');
  assert(!pendingCard.includes('Aceptar pedido'), 'protected fixture still exposes "Aceptar pedido"');
  assert(!orders.text.includes('Aceptar pedido'), 'protected action visible anywhere');

  // 3) Ninguna acción de pedido se ejecutó durante la validación.
  const patchAttempts = requests.filter(r => r.method === 'PATCH');
  assert.equal(patchAttempts.length, 0, 'a PATCH reached the network during validation');

  // 4) Actualización sin recargar la página.
  await evaluate(`window.__wlMarker='alive'`);
  assert(await clickByText('Actualizar'), 'Actualizar button missing'); await sleep(2500);
  const marker = await evaluate(`window.__wlMarker`);
  assert.equal(marker, 'alive', 'panel reloaded the page instead of updating in place');

  // 5) Error de sincronización y recuperación.
  failOrders = true;
  assert(await clickByText('Actualizar'), 'Actualizar button missing'); await sleep(2500);
  const failure = await snapshot('sync-error');
  assert(failure.text.includes('No se pudieron sincronizar los pedidos'), 'sync error not visible');
  assert(failure.buttons.some(b => b.text === 'Consultar de nuevo'), 'recovery button missing');
  failOrders = false;
  assert(await clickByText('Consultar de nuevo'), 'recovery button not clickable'); await sleep(2500);
  const recovered = await snapshot('sync-recovered');
  assert(!recovered.text.includes('No se pudieron sincronizar los pedidos'), 'sync error persisted after recovery');
  assert(recovered.text.includes('Cliente Integral'), 'orders not restored after recovery');

  assert.equal(blocked.length, 0, 'unexpected blocked request');
  assert.equal(exceptions.length, 0, 'unhandled browser exception');
  fs.writeFileSync(path.join(output, 'network.json'), JSON.stringify({
    requests: requests.map(r => ({ method: r.method, origin: new URL(r.url).origin, path: new URL(r.url).pathname })),
    blocked, exceptions, socketEvents: events,
  }, null, 2), { mode: 0o600 });
  console.log('SOCKET_EVENTS', JSON.stringify(events));
  console.log('BROWSER_CHECK_OK');
})().catch(error => {
  console.error('BROWSER_CHECK_FAILED:', error.message);
  fs.writeFileSync(path.join(output, 'failure.txt'), error.message, { mode: 0o600 });
  process.exitCode = 1;
}).finally(async () => {
  try { await send('Browser.close', {}, null); } catch { chrome.kill('SIGTERM'); }
  for (const p of pending.values()) { clearTimeout(p.timeout); p.reject(new Error('Browser closed')); }
});
