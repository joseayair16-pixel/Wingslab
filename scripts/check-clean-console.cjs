// Read-only check: the restaurant and driver panels must not log the
// beforeinstallprompt or AudioContext autoplay warnings on load.
const { createBrowser } = require('./wingslab-visual-cdp.cjs');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const jwt = require('jsonwebtoken');

const root = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'config/wingslab.local.json')));
const token = jwt.sign(
  { sub: 'cmwgvmci70004s4mldyvwosbg', phone: '5500000010', role: 'RESTAURANT' },
  config.backend.jwtSecret,
  { expiresIn: '10m' },
);

async function route(request) {
  if (request.method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,OPTIONS',
        'access-control-allow-headers': 'authorization,content-type',
      },
      body: '',
    };
  }
  assert(['GET', 'HEAD'].includes(request.method));
  const response = await fetch(request.url, {
    signal: AbortSignal.timeout(10000),
    headers: Object.fromEntries(
      Object.entries(request.headers).filter(([key]) =>
        ['authorization', 'accept', 'origin'].includes(key.toLowerCase())),
    ),
  });
  return {
    statusCode: response.status,
    headers: Object.fromEntries(response.headers),
    body: Buffer.from(await response.arrayBuffer()),
  };
}

async function checkPanel(name, url, origin, prepare) {
  const browser = createBrowser({
    profileDir: path.join(root, 'tmp/clean-console-profiles', name, String(Date.now())),
    origins: ['http://127.0.0.1:3101', origin],
    width: 430,
    height: 932,
    route,
  });
  try {
    await browser.init();
    if (prepare) await prepare(browser);
    await browser.open(url, 2500);
    await browser.sleep(3500);
    const messages = browser.consoleMessages.join('\n');
    console.log(`${name} captured messages:`, messages.slice(0, 500) || '(none)');
    assert(!/beforeinstallpromptevent\.preventdefault/i.test(messages), `${name}: beforeinstallprompt warning still present`);
    assert(!/AudioContext was not allowed to start/i.test(messages), `${name}: AudioContext autoplay warning still present`);
    assert((await browser.evaluate('document.body.innerText')).length > 20, `${name}: panel must render`);
    console.log(`PASS ${name} renders without install/audio browser warnings`);
  } finally {
    await browser.close();
  }
}

(async () => {
  await checkPanel('restaurant', 'http://127.0.0.1:3102/', 'http://127.0.0.1:3102', async browser => {
    await browser.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `localStorage.setItem('sadel.restaurant.token',${JSON.stringify(token)});` +
        `localStorage.setItem('sadel.restaurant.user',JSON.stringify({id:'cmwgvmci70004s4mldyvwosbg',name:'WingsLab',role:'RESTAURANT'}));` +
        `localStorage.setItem('sadel.restaurant.apiBase','http://127.0.0.1:3101');`,
    });
  });
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
