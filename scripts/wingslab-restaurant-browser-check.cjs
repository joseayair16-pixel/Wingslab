// Existing local Chrome + isolated profile. Auth and GET only; no order mutation.
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const output = path.resolve(process.argv[2]);
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const seed = fs.readFileSync('packages/backend/src/scripts/wingslab-seed.ts', 'utf8');
const password = seed.match(/const FICTIONAL_PASSWORD = '([^']+)'/)[1];
const phone = seed.slice(seed.indexOf('const restaurantUser'), seed.indexOf('const restaurant =')).match(/phone: '([^']+)'/)[1];
function redact(text) { return text.replaceAll(password, '[withheld]').replaceAll(phone, '[test-contact]').replace(/\b\d{10}\b/g, '[test-contact]').replace(/[\w.+-]+@[\w.-]+\.[a-z]+/gi, '[test-contact]'); }
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--remote-debugging-pipe', `--user-data-dir=${output}/profile`,
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--disable-component-update', '--disable-sync', '--disable-extensions', '--disable-default-apps',
  '--metrics-recording-only', '--disable-features=MediaRouter',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
let buffer = '', nextId = 0, session, failOrders = false, delayOrders = false;
const pending = new Map(), blocked = [], requests = [], responses = [], exceptions = [];
const socket = { opened: false, authenticated: false, joined: false, pingPong: false };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function send(method, params = {}, sid = session) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout ' + method)); }, 20000);
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
      if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
    } else if (m.method === 'Fetch.requestPaused') {
      const { requestId, request, resourceType } = m.params, u = new URL(request.url);
      const allowed = ['http://127.0.0.1:3101', 'http://127.0.0.1:3102'].includes(u.origin) || ['data:', 'blob:', 'about:'].includes(u.protocol);
      const allowedMethod = ['GET', 'HEAD', 'OPTIONS'].includes(request.method) ||
        (request.method === 'POST' && /^\/(api\/)?auth\/(restaurant-login|refresh)$/.test(u.pathname));
      const orderRead = ['XHR', 'Fetch'].includes(resourceType) && /\/restaurant-panel\/pedidos/.test(u.pathname);
      if (!allowed || !allowedMethod) blocked.push({ origin: u.origin, path: u.pathname, method: request.method });
      if (!allowed || !allowedMethod || (failOrders && orderRead)) send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {});
      else if (delayOrders && orderRead) setTimeout(() => send('Fetch.continueRequest', { requestId }).catch(() => {}), 1800);
      else send('Fetch.continueRequest', { requestId }).catch(() => {});
    } else if (m.method === 'Network.requestWillBeSent') {
      const r = m.params.request;
      if (/^https?:/.test(r.url)) {
        requests.push({ url: r.url, method: r.method });
        if (!['http://127.0.0.1:3101', 'http://127.0.0.1:3102'].includes(new URL(r.url).origin)) {
          blocked.push({ origin: new URL(r.url).origin, method: r.method, reason: 'unexpected request including CSP-blocked attempts' });
        }
      }
    } else if (m.method === 'Network.responseReceived') responses.push({ url: m.params.response.url, status: m.params.response.status });
    else if (m.method === 'Network.webSocketCreated') { const u = new URL(m.params.url); assert.equal(u.origin, 'ws://127.0.0.1:3101'); socket.opened = true; }
    else if (m.method === 'Network.webSocketFrameReceived' || m.method === 'Network.webSocketFrameSent') {
      // Never retain raw frames: the auth frame contains a JWT.
      const data = m.params.response.payloadData;
      if (m.method.endsWith('Received') && data.startsWith('40')) socket.authenticated = true;
      if (m.method.endsWith('Sent') && data.includes('join-room')) socket.joined = true;
      if (data === '2' || data === '3') socket.pingPong = true;
    } else if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.text);
  }
});
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
}
async function evidence(name) {
  const d = await evaluate(`({text:document.body.innerText,buttons:[...document.querySelectorAll('button')].map(b=>b.innerText).filter(Boolean),inputs:[...document.querySelectorAll('input')].map(i=>({type:i.type,placeholder:i.placeholder}))})`);
  const safe = redact(JSON.stringify(d)); fs.writeFileSync(path.join(output, name + '.json'), safe, { mode: 0o600 });
  console.log(name, safe.slice(0, 16000)); return d;
}
async function clickText(text) {
  return evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()===${JSON.stringify(text)});if(b)b.click();return !!b})()`);
}
(async () => {
  const target = await send('Target.createTarget', { url: 'about:blank' }, null);
  session = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null)).sessionId;
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://127.0.0.1:3102/' }); await sleep(2500);
  await evidence('login');
  const filled = await evaluate(`(()=>{const inputs=[...document.querySelectorAll('input')];const p=inputs.find(i=>i.type==='password'),t=inputs.find(i=>i.type==='tel'||i.type==='text');if(!p||!t)return false;const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(const [i,v] of [[t,${JSON.stringify(phone)}],[p,${JSON.stringify(password)}]]){setter.call(i,v);i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));}return true})()`);
  assert(filled, 'Login inputs missing'); await sleep(200);
  delayOrders=true;
  assert(await clickText('Iniciar sesión'), 'Login button missing');
  await sleep(900); await evidence('loading');
  await sleep(4000); delayOrders=false; await evidence('dashboard');
  const permissions = await evaluate(`(async()=>{
    const token=localStorage.getItem('sadel.restaurant.token');const user=JSON.parse(localStorage.getItem('sadel.restaurant.user')||'null');
    if(!token||user?.role!=='RESTAURANT')throw new Error('Restaurant role/session missing');
    const result={role:user.role};
    for(const [name,url,auth] of [['orders','/restaurant-panel/pedidos',true],['products','/restaurant-panel/productos',true],['categories','/restaurant-panel/categorias',true],['adminDenied','/metrics',true],['anonymousDenied','/restaurant-panel/pedidos',false]]){
      const r=await fetch('http://127.0.0.1:3101'+url,{headers:auth?{Authorization:'Bearer '+token}:{}});const json=await r.json();
      result[name]={status:r.status,...(Array.isArray(json.data)?{count:json.data.length}:{}),...(name==='orders'&&Array.isArray(json.data)?{orders:json.data.map(o=>({id:o.id,status:o.status}))}:{})};
    }return result;
  })()`);
  assert.equal(permissions.role,'RESTAURANT');assert.equal(permissions.orders.status,200);assert.equal(permissions.orders.count,3);
  assert.equal(permissions.products.count,3);assert.equal(permissions.categories.count,1);
  assert.equal(permissions.adminDenied.status,403);assert.equal(permissions.anonymousDenied.status,401);
  console.log('PERMISSIONS_AND_READS',JSON.stringify(permissions));
  assert(await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim().startsWith('Ordenes'));if(b)b.click();return !!b})()`));
  await sleep(800);await evidence('orders');
  const filtered = await evaluate(`(()=>{const s=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.textContent.includes('Entregados')));if(!s)return false;const option=[...s.options].find(o=>o.textContent.includes('Entregados'));s.value=option.value;s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  assert(filtered,'Delivered order filter missing');await sleep(500);const delivered=await evidence('delivered-order');assert(delivered.text.includes('#03'),'Delivered fixture not displayed');
  assert(await clickText('Mi Tienda'));await sleep(800);await evidence('catalog');
  assert(await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim().startsWith('Ordenes'));if(b)b.click();return !!b})()`));
  failOrders=true;assert(await clickText('Actualizar'));await sleep(4000);await evidence('orders-network-error');
  failOrders=false;assert(await clickText('Actualizar'));await sleep(2500);const recovered=await evidence('recovered');
  assert(recovered.text.includes('WingsLab'));
  await sleep(11000);
  console.log('SOCKET', JSON.stringify(socket));
  assert(socket.opened&&socket.authenticated&&socket.joined&&socket.pingPong,'Authenticated Socket.IO/heartbeat not verified');
  fs.writeFileSync(path.join(output, 'network.json'), JSON.stringify({ requests, responses, blocked, exceptions, socket }, null, 2), { mode: 0o600 });
  assert.equal(blocked.length, 0, 'Unexpected request blocked; inspect sanitized evidence');
})().catch(error => {
  if (blocked.length) spawnSync('docker', ['--context', 'desktop-linux', 'stop', 'wingslab-2b-restaurant-1'], { stdio: 'ignore', timeout: 30000 });
  console.error(redact(error.message)); process.exitCode = 1;
}).finally(async () => {
  try { await send('Browser.close', {}, null); } catch { chrome.kill('SIGTERM'); }
  for (const p of pending.values()) { clearTimeout(p.timeout); p.reject(new Error('Browser closed')); }
});
