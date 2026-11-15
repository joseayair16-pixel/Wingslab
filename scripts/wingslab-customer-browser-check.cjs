// Use the locally installed Chrome in an isolated profile; no npm/browser download.
// All page requests are intercepted before navigation. Only WingsLab loopback
// origins are allowed. Output contains DOM/HTTP evidence, never auth/session data.
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const output = path.resolve(process.argv[2]);
const restaurantId = process.argv[3];
fs.mkdirSync(output, { recursive: true });
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--remote-debugging-pipe', `--user-data-dir=${output}/chrome-profile`,
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--disable-component-update', '--disable-sync', '--disable-extensions',
  '--disable-default-apps', '--metrics-recording-only', '--disable-features=MediaRouter',
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
let buffer = '', counter = 0, session, errorMode = false, delayMode = false;
const pending = new Map(), requests = [], errors = [], blocked = [], responses = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function send(method, params = {}, sid = session) {
  const id = ++counter;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 20000);
    pending.set(id, { resolve, reject, timeout });
    chrome.stdio[3].write(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) }) + '\0');
  });
}
chrome.stdio[4].on('data', chunk => {
  buffer += chunk.toString();
  while (buffer.includes('\0')) {
    const i = buffer.indexOf('\0'), message = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1);
    if (message.id) {
      const p = pending.get(message.id); if (!p) continue;
      clearTimeout(p.timeout); pending.delete(message.id);
      if (message.error) p.reject(new Error(JSON.stringify(message.error))); else p.resolve(message.result);
    } else if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params;
      const url = new URL(request.url);
      const allowed = ['http://127.0.0.1:3101', 'http://127.0.0.1:3103'].includes(url.origin) || ['data:', 'blob:', 'about:'].includes(url.protocol);
      if (!allowed) blocked.push(request.url);
      const detailRequest = ['Fetch', 'XHR'].includes(message.params.resourceType) &&
        /^(\/api)?\/restaurantes\//.test(url.pathname);
      if (!allowed || (errorMode && detailRequest)) {
        send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {});
      } else if (delayMode && detailRequest) {
        setTimeout(() => send('Fetch.continueRequest', { requestId }).catch(() => {}), 2000);
      } else send('Fetch.continueRequest', { requestId }).catch(() => {});
    } else if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url);
    else if (message.method === 'Network.responseReceived') responses.push({ url: message.params.response.url, status: message.params.response.status });
    else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text + ': ' + (message.params.exceptionDetails.exception?.description || ''));
  }
});
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
}
async function evidence(name) {
  const dom = await evaluate(`({url:location.href,text:document.body.innerText,buttons:[...document.querySelectorAll('button')].map(b=>b.innerText).filter(Boolean),inputs:[...document.querySelectorAll('input')].map(i=>({placeholder:i.placeholder,type:i.type})),links:[...document.querySelectorAll('a')].map(a=>({text:a.innerText,href:a.getAttribute('href')})).filter(a=>a.text)})`);
  fs.writeFileSync(path.join(output, name + '.json'), JSON.stringify(dom, null, 2));
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(screenshot.data, 'base64'));
  console.log(name, JSON.stringify(dom).slice(0, 18000)); return dom;
}
(async () => {
  const target = await send('Target.createTarget', { url: 'about:blank' }, null);
  session = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null)).sessionId;
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setBypassServiceWorker', { bypass: true });
  await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://127.0.0.1:3103/' }); await sleep(4500);
  await evidence('home-fresh');
  // Fixture-only browser storage: no production profile, account or actual GPS.
  await evaluate(`localStorage.removeItem('locationSource');sessionStorage.setItem('userLocation',JSON.stringify({latitude:19.4326,longitude:-99.1332,ts:Date.now(),address:'Ciudad de Pruebas'}));sessionStorage.setItem('locationSource','manual');`);
  await send('Page.reload'); await sleep(4500); const home = await evidence('home-fixture-location');
  assert(home.text.includes('WingsLab Comedor de Prueba'), 'Fixture catalog not loaded');
  // Exercise the existing card's Next router navigation, not a synthetic success.
  const point = await evaluate(`(()=>{const e=[...document.querySelectorAll('h2,h3,h4')].find(e=>e.textContent.trim()==='WingsLab Comedor de Prueba');if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  assert(point, 'Restaurant card not found');
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  await sleep(4500); const detail = await evidence('restaurant');
  assert(detail.text.includes('WingsLab Comedor de Prueba'), 'Restaurant name not visible');
  assert(detail.text.includes('Alitas ficticias x6'), 'Fixture product not visible');
  console.log('PRODUCT_PREVIEW_CONTROL', await evaluate(`(()=>{const e=document.getElementById('wl_prod_alitas_6')?.querySelector('.cursor-pointer');if(e)e.click();return !!e})()`));
  await sleep(700); await evidence('product-detail');
  assert(await evaluate(`(()=>{const b=[...document.getElementById('wl_prod_alitas_6').querySelectorAll('button')].find(b=>b.textContent.trim()==='Agregar');if(b)b.click();return !!b})()`));
  await sleep(500); await evidence('cart-local-add');
  // Exercise a real network failure without stopping backend or changing fixtures.
  delayMode = true;
  await send('Page.reload'); await sleep(500); await evidence('restaurant-loading');
  await sleep(3000); delayMode = false;
  errorMode = true;
  await send('Page.reload'); await sleep(4500); await evidence('restaurant-network-error');
  errorMode = false;
  assert(await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Reintentar');if(b)b.click();return !!b})()`), 'Retry button missing');
  await sleep(3000); const recovered = await evidence('restaurant-recovered');
  assert(recovered.text.includes('Alitas ficticias x6'), 'Retry did not restore catalog');
  fs.writeFileSync(path.join(output, 'network.json'), JSON.stringify({ requests, responses, blocked, errors }, null, 2));
  console.log('BROWSER_REQUEST_ORIGINS', [...new Set(requests.filter(u => /^https?:/.test(u)).map(u => new URL(u).origin))]);
  console.log('EXTERNAL_ATTEMPTS_BLOCKED', JSON.stringify(blocked)); console.log('JS_EXCEPTIONS', JSON.stringify(errors));
  assert.equal(blocked.length, 0, 'Unexpected external browser request attempted; blocked before network');
})().catch(error => {
  if (blocked.length) {
    spawnSync('docker', ['--context', 'desktop-linux', 'stop', 'wingslab-2b-customer-1'], { stdio: 'ignore', timeout: 30000 });
    console.error('Customer stopped after unexpected external request attempt');
  }
  console.error(error); process.exitCode = 1;
}).finally(async () => {
  try { await send('Browser.close', {}, null); } catch { chrome.kill('SIGTERM'); }
  for (const p of pending.values()) { clearTimeout(p.timeout); p.reject(new Error('Browser closed')); }
});
