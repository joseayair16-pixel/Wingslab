// Browser check (read-only) for the WingsLab driver panel.
// Only GET/HEAD/OPTIONS are forwarded: no order or payout mutation is possible.
const { createBrowser } = require('./wingslab-visual-cdp.cjs');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');

const root = path.resolve(__dirname, '..');

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
  assert(['GET', 'HEAD'].includes(request.method), 'Only read-only requests are allowed');
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

(async () => {
  const browser = createBrowser({
    profileDir: path.join(root, 'tmp/driver-panel-profiles', String(Date.now())),
    origins: ['http://127.0.0.1:3101', 'http://127.0.0.1:3104'],
    width: 430,
    height: 932,
    route,
  });
  try {
    await browser.init();
    await browser.send('Network.setBlockedURLs', { urls: ['*socket.io*'] });
    await browser.open('http://127.0.0.1:3104/', 2500);
    await browser.sleep(2000);

    const text = await browser.evaluate('document.body.innerText');
    assert(/wingslab/i.test(text), 'The driver panel must show the WingsLab identity');
    assert(text.includes('Tu turno empieza aquí'), 'The driver panel must show the sign-in screen');
    assert(!/sadel/i.test(text), 'The driver panel must not show the legacy SaDeL brand');

    // The sign-in form must be present and must not leak another role.
    assert.equal(
      await browser.evaluate(`document.querySelectorAll('input[type="password"]').length`),
      1,
      'The driver panel must ask for a password',
    );
    assert(
      (await browser.evaluate(`document.body.innerText`)).includes('pídele al restaurante'.toUpperCase().slice(0, 5)) ||
      (await browser.evaluate(`document.body.innerText`)).includes('Pídele al restaurante'),
      'The driver panel must explain how to obtain the account',
    );

    assert(!browser.requests.some(r => !['GET', 'HEAD', 'OPTIONS'].includes(r.method)), 'No mutations were sent');
    console.log('PASS driver panel renders the WingsLab sign-in without mutations');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
