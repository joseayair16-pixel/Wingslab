// Minimal Chrome DevTools Protocol harness for local WingsLab verification.
// Reuses the locally installed browser and an isolated profile. No downloads.
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function createBrowser({ profileDir, origins, width = 1280, height = 900, allowMutations = false, route }) {
  fs.mkdirSync(profileDir, { recursive: true, mode: 0o700 });
  const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profileDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', '--disable-extensions',
    '--disable-default-apps', '--metrics-recording-only', '--disable-features=MediaRouter',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });

  let buffer = '', nextId = 0, session;
  const pending = new Map(), blocked = [], requests = [], responses = [], exceptions = [], consoleMessages = [];
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function send(method, params = {}, sid = session) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout ' + method)); }, 25000);
      pending.set(id, { resolve, reject, timeout });
      chrome.stdio[3].write(JSON.stringify({ id, method, params, ...(sid ? { sessionId: sid } : {}) }) + '\0');
    });
  }

  chrome.stdio[4].on('data', chunk => {
    buffer += chunk.toString();
    while (buffer.includes('\0')) {
      const i = buffer.indexOf('\0');
      let m; try { m = JSON.parse(buffer.slice(0, i)); } catch { buffer = buffer.slice(i + 1); continue; }
      buffer = buffer.slice(i + 1);
      if (m.id) {
        const p = pending.get(m.id); if (!p) continue;
        clearTimeout(p.timeout); pending.delete(m.id);
        if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
      } else if (m.method === 'Fetch.requestPaused') {
        const { requestId, request } = m.params, u = new URL(request.url);
        const allowedOrigin = origins.includes(u.origin) || ['data:', 'blob:', 'about:'].includes(u.protocol);
        const safeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(request.method) || allowMutations;
        if (!allowedOrigin || !safeMethod) blocked.push({ origin: u.origin, path: u.pathname, method: request.method });
        if (!allowedOrigin || !safeMethod) send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {});
        else if (route && (u.origin === 'http://127.0.0.1:3101' || u.pathname.startsWith('/api/'))) {
          route(request).then(response => send('Fetch.fulfillRequest', { requestId, responseCode: response.statusCode,
            responseHeaders: Object.entries(response.headers).filter(([key]) => !['content-length', 'transfer-encoding', 'content-encoding', 'connection'].includes(key.toLowerCase())).map(([name,value]) => ({name,value:String(value)})),
            body: Buffer.from(response.body).toString('base64') })).catch(error => { console.error('CLONE_ROUTE_FAILED',error.message); send('Fetch.failRequest',{requestId,errorReason:'Failed'}).catch(()=>{}); });
        } else send('Fetch.continueRequest', { requestId }).catch(() => {});
      } else if (m.method === 'Network.requestWillBeSent') {
        const r = m.params.request;
        if (/^https?:/.test(r.url)) requests.push({ url: r.url, method: r.method });
      } else if (m.method === 'Network.responseReceived') {
        responses.push({ url: m.params.response.url, status: m.params.response.status });
      } else if (m.method === 'Runtime.exceptionThrown') {
        exceptions.push(m.params.exceptionDetails.text);
      } else if (m.method === 'Runtime.consoleAPICalled' || m.method === 'Log.entryAdded') {
        const text = m.method === 'Log.entryAdded'
          ? (m.params.entry?.text || '')
          : (m.params.args || []).map(arg => arg.value || arg.description || '').join(' ');
        if (text) consoleMessages.push(text);
      } else if (m.method === 'Page.javascriptDialogOpening') {
        send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
      }
    }
  });

  async function evaluate(expression) {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).catch(error => { throw new Error(error.message + ': ' + expression.slice(0, 160)); });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }

  async function evidence(dir, name) {
    const dom = await evaluate(`({url:location.href,text:document.body.innerText,buttons:[...document.querySelectorAll('button')].map(b=>b.innerText).filter(Boolean),inputs:[...document.querySelectorAll('input')].map(i=>({type:i.type,placeholder:i.placeholder,checked:i.type==='checkbox'?i.checked:undefined}))})`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(dom, null, 2));
    try {
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(dir, name + '.png'), Buffer.from(shot.data, 'base64'));
    } catch {}
    console.log('EVIDENCE ' + name, JSON.stringify(dom).slice(0, 12000));
    return dom;
  }

  async function clickText(text, exact = true) {
    return evaluate(`(()=>{const b=[...document.querySelectorAll('button,a')].find(b=>!b.disabled&&${exact ? 'b.innerText.trim()===' : 'b.innerText.includes('}${JSON.stringify(text)}${exact ? '' : ')'});if(b){b.click();return true}return false})()`);
  }

  async function fill(selectorOrIndex, value, kind = 'input') {
    return evaluate(`(()=>{
      const els=[...document.querySelectorAll(${JSON.stringify(kind)})];
      const el=${selectorOrIndex === 'password' ? `els.find(e=>e.type==='password')` : selectorOrIndex === 'tel' ? `els.find(e=>e.type==='tel'||e.type==='text')` : `els[${JSON.stringify(selectorOrIndex)}]`};
      if(!el)return false;
      const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      const setter=Object.getOwnPropertyDescriptor(proto,'value').set;
      setter.call(el,${JSON.stringify(value)});
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
      return true;
    })()`);
  }

  async function waitFor(fn, { timeout = 15000, interval = 300, label = 'condition' } = {}) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await fn()) return true;
      await sleep(interval);
    }
    throw new Error('Timeout waiting for ' + label);
  }

  async function open(url, settle = 4000) {
    // Do not await: beforeunload prompts can keep Page.navigate pending in headless mode.
    send('Page.navigate', { url }).catch(() => {});
    await sleep(700);
    await sleep(settle);
  }

  async function init() {
    const target = await send('Target.createTarget', { url: 'about:blank' }, null);
    session = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null)).sessionId;
    await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable');
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  }

  async function close() {
    try { await send('Browser.close', {}, null); } catch { chrome.kill('SIGTERM'); }
    for (const p of pending.values()) { clearTimeout(p.timeout); p.reject(new Error('Browser closed')); }
  }

  return { chrome, send, evaluate, evidence, clickText, fill, waitFor, open, init, close, sleep,
    get blocked() { return blocked; }, get requests() { return requests; }, get responses() { return responses; }, get exceptions() { return exceptions; }, get consoleMessages() { return consoleMessages; },
    spawnSync, assert };
}

module.exports = { createBrowser };
