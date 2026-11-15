// Explicitly authorized WINGSLAB-E2E-01 only. No installs, external providers or fixture mutations.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const out = path.resolve(process.argv[2]), mode = process.argv[3];
const statePath = path.join(out, 'private-state.json');
const save = (name, data) => fs.writeFileSync(path.join(out, name), JSON.stringify(data, null, 2), { mode: 0o600 });
const base = 'http://127.0.0.1:3101';
let state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath)) : {};
const seed = fs.readFileSync('packages/backend/src/scripts/wingslab-seed.ts', 'utf8');
const restaurantPassword = seed.match(/const FICTIONAL_PASSWORD = '([^']+)'/)[1];
const restaurantPhone = seed.slice(seed.indexOf('const restaurantUser'), seed.indexOf('const restaurant =')).match(/phone: '([^']+)'/)[1];
async function api(route, method = 'GET', body, token) {
  assert(route.startsWith('/'));
  const r = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const json = await r.json();
  if (!r.ok) throw new Error(`${method} ${route}: ${r.status} ${json.error?.code || 'API error'}`);
  return { status: r.status, json };
}
async function setup() {
  assert(!state.registered, 'Already registered: do not repeat setup');
  if (!state.phone) {
    state = { phone: '5500000031', email: 'pedido-integral-01@wingslab.invalid', password: crypto.randomBytes(24).toString('base64url'), reference: 'WINGSLAB-E2E-01' };
    save('private-state.json', state);
  }
  const challenge = (await api('/auth/email-otp/iniciar', 'POST', { phone: state.phone, email: state.email, intent: 'register', name: 'Cliente Integral', lastName: 'WingsLab', dateOfBirth: '1990-01-01' })).json.data;
  assert(challenge.mockCode && challenge.expiresInSeconds === 300);
  const grant = (await api('/auth/email-otp/confirmar', 'POST', { challengeId: challenge.challengeId, code: challenge.mockCode })).json.data;
  const registration = (await api('/auth/complete-register', 'POST', { password: state.password }, grant.registerToken)).json;
  assert.equal(registration.data.user.role, 'CUSTOMER');
  state.registered = true; state.customerId = registration.data.user.id;
  save('private-state.json', state); // Persist before any further write; never repeat registration on failure.
  const login = (await api('/auth/login', 'POST', { phone: state.phone, password: state.password })).json.data;
  state.customerToken = login.token;
  state.address = { street: 'Avenida Ficticia Integral', number: '101', neighborhood: 'Centro Ficticio', city: 'Ciudad de Pruebas', state: 'CDMX', zipCode: '00000', country: 'MX', reference: 'WINGSLAB-E2E-01 dirección de prueba', latitude: 19.4330, longitude: -99.1340, isDefault: true };
  save('private-state.json', state);
  const address = (await api('/customer/addresses', 'POST', state.address, login.token)).json.data;
  state.addressId = address.id;
  save('private-state.json', state);
  console.log('SETUP verified real OTP registration, CUSTOMER password login and one new synthetic address; secrets withheld.');
}
async function browser() {
  assert(state.registered && state.addressId, 'Setup incomplete');
  const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', '--remote-debugging-pipe', `--user-data-dir=${out}/profile`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', '--disable-extensions', '--disable-default-apps',
    '--metrics-recording-only', '--disable-features=MediaRouter',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  let buffer = '', serial = 0, failed = false;
  const pending = new Map(), sessions = {}, requests = [], responses = [], events = [], blocked = [], exceptions = [];
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  function send(method, params = {}, sessionId) {
    const id = ++serial;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout ' + method)); }, 25000);
      pending.set(id, { resolve, reject, timeout });
      chrome.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
    });
  }
  const allowedOrigins = ['http://127.0.0.1:3101', 'http://127.0.0.1:3102', 'http://127.0.0.1:3103'];
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
      const sid = m.sessionId, role = Object.keys(sessions).find(k => sessions[k] === sid);
      if (m.method === 'Page.javascriptDialogOpening' && m.params.type === 'beforeunload') {
        // Permit only the requested navigation/reload, never arbitrary confirm dialogs.
        send('Page.handleJavaScriptDialog', { accept: true }, sid).catch(() => {});
      } else if (m.method === 'Fetch.requestPaused') {
        const { requestId, request } = m.params, u = new URL(request.url), route = u.pathname.replace(/^\/api(?=\/)/, '');
        let allowed = allowedOrigins.includes(u.origin) || ['data:', 'blob:', 'about:'].includes(u.protocol);
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
          const permitted = request.method === 'POST' && ['/auth/login', '/auth/restaurant-login', '/auth/refresh', '/customer/addresses/verify', '/pedidos'].includes(route) ||
            request.method === 'PATCH' && state.orderId && ['aceptar','preparacion','listo','asumir-reparto'].some(a=>route===`/restaurant-panel/pedidos/${state.orderId}/${a}`) ||
            request.method === 'POST' && state.deliveryToken && ['llegue-restaurante','llegue','ubicacion','entregar'].some(a=>route===`/public/delivery-ticket/${state.deliveryToken}/${a}`);
          allowed &&= Boolean(permitted);
          if (allowed && route === '/pedidos') {
            if (state.orderId) { allowed=false; }
            const body = JSON.parse(request.postData);
            allowed &&= body.paymentMethod === 'CASH' && body.fulfillmentType === 'DELIVERY' && body.notes?.includes(state.reference) && body.items.length === 1 && body.items[0].productId === 'wl_prod_alitas_6' && body.items[0].quantity === 1 && !!body.clientOrderKey;
            if (state.orderBody) allowed &&= state.orderBody.clientOrderKey === body.clientOrderKey;
            if (allowed) { state.orderBody = body; save('private-state.json', state); }
          }
        }
        if (!allowed) blocked.push({ role, method: request.method, origin: u.origin, path: route });
        send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', { requestId, ...(!allowed ? { errorReason: 'BlockedByClient' } : {}) }, sid).catch(() => {});
      } else if (m.method === 'Network.requestWillBeSent') {
        const r = m.params.request;
        if (/^https?:/.test(r.url)) {
          const u = new URL(r.url); requests.push({ role, method: r.method, origin: u.origin, path: u.pathname });
          if (!allowedOrigins.includes(u.origin)) blocked.push({ role, origin: u.origin, path: u.pathname });
        }
      } else if (m.method === 'Network.responseReceived') {
        const r = m.params.response; responses.push({ role, url: r.url, status: r.status });
      } else if (m.method === 'Network.webSocketFrameReceived') {
        const raw = m.params.response.payloadData;
        if (raw.startsWith('42')) {
          try { const [event, data] = JSON.parse(raw.slice(2)); if (event.startsWith('order:')) events.push({ role, event, orderId: data?.orderId, status: data?.status }); } catch {}
        }
      } else if (m.method === 'Runtime.exceptionThrown') exceptions.push({ role, text: m.params.exceptionDetails.text });
    }
  });
  async function evaluate(role, expression) {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessions[role]);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  async function click(role, label) {
    assert(await evaluate(role, `(()=>{const e=[...document.querySelectorAll('button')].filter(e=>e.innerText.trim()===${JSON.stringify(label)}&&e.getClientRects().length).at(-1);if(!e||e.disabled)return false;e.click();return true})()`), `Button not available ${role}: ${label}`);
    await sleep(400);
  }
  async function input(role, selector, value) {
    assert(await evaluate(role, `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;Object.getOwnPropertyDescriptor(e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`), `Input missing ${selector}`);
    await sleep(150);
  }
  function redact(s) {
    if(state.deliveryToken)s=s.replaceAll(state.deliveryToken,'[delivery-capability]');
    return s.replaceAll(state.password, '[withheld]').replaceAll(restaurantPassword, '[withheld]').replace(/\b\d{10}\b/g, '[synthetic-contact]').replace(/[\w.+-]+@[\w.-]+\.[a-z]+/gi, '[synthetic-contact]');
  }
  async function snapshot(role, name) {
    const d = await evaluate(role, `({text:document.body.innerText,buttons:[...document.querySelectorAll('button')].map(e=>({text:e.innerText,aria:e.getAttribute('aria-label'),disabled:e.disabled})),inputs:[...document.querySelectorAll('input,textarea')].map(e=>({tag:e.tagName,type:e.type,placeholder:e.placeholder}))})`);
    save(name + '.json', JSON.parse(redact(JSON.stringify(d)))); console.log(name, redact(JSON.stringify(d)).slice(0, 16000)); return d;
  }
  try {
    for (const role of ['restaurant', 'customer']) {
      const t = await send('Target.createTarget', { url: 'about:blank' });
      sessions[role] = (await send('Target.attachToTarget', { targetId: t.targetId, flatten: true })).sessionId;
      const sid = sessions[role];
      for (const method of ['Page.enable', 'Runtime.enable', 'Network.enable']) await send(method, {}, sid);
      await send('Network.setBypassServiceWorker', { bypass: true }, sid);
      await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }, sid);
      await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, sid);
      await send('Emulation.setGeolocationOverride', { latitude: 19.4330, longitude: -99.1340, accuracy: 10 }, sid);
      await send('Browser.grantPermissions', { origin: role === 'customer' ? 'http://127.0.0.1:3103' : 'http://127.0.0.1:3102', permissions: ['geolocation'] });
      await send('Page.navigate', { url: role === 'restaurant' ? 'http://127.0.0.1:3102/' : 'http://127.0.0.1:3103/restaurantes/cmwgvmcia0006s4mlqs7brrh7' }, sid);
    }
    await sleep(2500);
    if (!await evaluate('restaurant', `!!localStorage.getItem('sadel.restaurant.token')`)) {
      await input('restaurant', 'input[type=text]', restaurantPhone);
      await input('restaurant', 'input[type=password]', restaurantPassword);
      await click('restaurant', 'Iniciar sesión'); await sleep(3500);
    }
    if (!await evaluate('customer', `!!localStorage.getItem('sadel.customer.token')`)) {
      assert(await evaluate('customer', `(()=>{const e=document.querySelector('button[aria-label="Iniciar sesión"]');if(e)e.click();return !!e})()`));
      await sleep(400); await click('customer', 'Ya tengo cuenta');
      await input('customer', 'input[placeholder="Ingresa tu celular"]', state.phone);
      await input('customer', 'input[type=password]', state.password);
      await click('customer', 'Iniciar sesión'); await sleep(3000);
    }
    assert(await evaluate('customer', `JSON.parse(localStorage.getItem('sadel.customer.user')||'null')?.role==='CUSTOMER'`), 'Customer UI login not completed');
    await evaluate('customer', `sessionStorage.setItem('userLocation',JSON.stringify({latitude:19.4330,longitude:-99.1340,ts:Date.now(),address:'Ciudad de Pruebas'}));sessionStorage.setItem('locationSource','manual')`);
    const actionFile = process.argv[4];
    if (actionFile) {
      // Reviewed local scenario; credentials never embedded in report output.
      const scenario = require(path.resolve(actionFile));
      await scenario({ state, save, evaluate, click, input, snapshot, send, sessions, sleep, events, api, assert });
    } else {
      await snapshot('restaurant', 'restaurant-ready');
      await snapshot('customer', 'customer-ready');
    }
    assert.equal(blocked.length, 0, 'Unexpected network/write attempted and blocked');
    assert.equal(exceptions.length, 0, 'Unhandled browser exception');
  } catch (e) { failed = true; throw e; }
  finally {
    save('private-state.json', state);
    save(`network-${Date.now()}.json`, JSON.parse(JSON.stringify({ requests, responses, events, blocked, exceptions, failed }).replace(/(\/public\/delivery-ticket\/)[A-Za-z0-9_-]+/g,'$1[withheld]')));
    try { await send('Browser.close'); } catch { chrome.kill('SIGTERM'); }
  }
}
(async () => { if (mode === 'setup') await setup(); else if (mode === 'browser') await browser(); else throw new Error('Use setup or browser'); })().catch(e => { console.error(e.message.replace(/\b\d{10}\b/g, '[contact]')); process.exitCode = 1; });
