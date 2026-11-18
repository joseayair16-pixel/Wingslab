// Browser check for the WingsLab driver panel sign-in and forced password change.
// The check only authenticates; it never claims an order or records a payout.
const { createBrowser } = require('./wingslab-visual-cdp.cjs');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const http = require('http');

const root = path.resolve(__dirname, '..');
assert.equal(process.env.WINGSLAB_ALLOW_ACCOUNT_TEST, 'yes',
  'This test creates a driver account. Use hermetic tests unless account creation is explicitly authorized.');

function apiRequest(method, apiPath, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = {};
    if (payload) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(payload);
    }
    if (token) headers.authorization = `Bearer ${token}`;
    const request = http.request({ host: '127.0.0.1', port: 3101, path: apiPath, method, headers }, response => {
      let text = '';
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, text }));
    });
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

async function route(request) {
  if (request.method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
        'access-control-allow-headers': 'authorization,content-type',
      },
      body: '',
    };
  }
  const url = new URL(request.url);
  const allowedWrite = request.method === 'POST' && url.pathname === '/auth/driver-login' ||
    request.method === 'PATCH' && url.pathname === '/driver-panel/password';
  assert(['GET', 'HEAD'].includes(request.method) || allowedWrite, 'Only sign-in/password changes are allowed');
  const response = await fetch(request.url, {
    method: request.method,
    signal: AbortSignal.timeout(10000),
    headers: Object.fromEntries(
      Object.entries(request.headers).filter(([key]) =>
        ['authorization', 'accept', 'origin', 'content-type'].includes(key.toLowerCase())),
    ),
    body: request.postData,
  });
  return {
    statusCode: response.status,
    headers: Object.fromEntries(response.headers),
    body: Buffer.from(await response.arrayBuffer()),
  };
}

(async () => {
  // Create a temporary driver account through the restaurant API.
  const login = await apiRequest('POST', '/auth/restaurant-login', {
    phone: '5500000010', password: 'WingsLab-Local-Only-2026',
  });
  const token = JSON.parse(login.text).data.token;
  const stamp = Date.now().toString().slice(-6);
  const created = await apiRequest('POST', '/restaurant-panel/repartidores', {
    name: 'Navegador', lastName: 'Prueba',
    phone: `5577${stamp}`.slice(0, 10), email: `navegador.${stamp}@wingslab.local`,
    deliveryCompensation: 40,
  }, token);
  assert.equal(created.status, 201, 'The driver account must be created');
  const { driver, temporaryPassword } = JSON.parse(created.text).data;

  const browser = createBrowser({
    profileDir: path.join(root, 'tmp/driver-login-profiles', String(Date.now())),
    origins: ['http://127.0.0.1:3101', 'http://127.0.0.1:3104'],
    width: 430,
    height: 932,
    // Only the sign-in and the forced password rotation are written; no
    // order, earnings or payout operation is reachable from this panel.
    allowMutations: true,
    route,
  });
  try {
    await browser.init();
    await browser.send('Network.setBlockedURLs', { urls: ['*socket.io*'] });
    await browser.open('http://127.0.0.1:3104/', 2500);
    await browser.sleep(1500);

    await browser.evaluate(`(() => {
      const set = (selector, value) => {
        const el = document.querySelector(selector);
        const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('input[autocomplete="username"]', '${driver.user.phone}');
      set('input[autocomplete="current-password"]', '${temporaryPassword}');
      document.querySelector('form button[type="submit"]').click();
    })()`);
    await browser.sleep(2500);

    const afterLogin = await browser.evaluate('document.body.innerText');
    assert(afterLogin.includes('Crea tu contraseña'), 'The panel must require a personal password first');
    assert(afterLogin.includes('temporal'), 'The forced rotation screen must explain the temporary password');
    // Change the temporary password for a personal one.
    await browser.evaluate(`(() => {
      const inputs = [...document.querySelectorAll('input[type=password]')];
      const apply = (el, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      apply(inputs[0], '${temporaryPassword}');
      apply(inputs[1], 'ClavePersonal-Prueba-2026');
      apply(inputs[2], 'ClavePersonal-Prueba-2026');
      document.querySelector('form button[type=submit]').click();
    })()`);
    await browser.waitFor(() => browser.evaluate(`document.body.innerText.includes('Entregas asignadas')`));
    await browser.sleep(500);

    const panel = await browser.evaluate('document.body.innerText');
    const lower = panel.toLowerCase();
    assert(lower.includes('tus entregas'), 'The driver panel must show the deliveries view');
    assert(lower.includes('entregas asignadas'), 'The driver panel must show the deliveries section');
    assert(lower.includes('historial'), 'The driver panel must show the history tab');
    assert(lower.includes('balance'), 'The driver panel must show the balance tab');
    assert(lower.includes('perfil'), 'The driver panel must show the profile tab');
    assert(!lower.includes('crea tu contraseña'), 'The rotation screen must be closed after the change');

    // The API must accept the new password and reject the temporary one.
    const withPersonal = await apiRequest('POST', '/auth/driver-login', {
      phone: driver.user.phone, password: 'ClavePersonal-Prueba-2026',
    });
    assert.equal(withPersonal.status, 200, 'The personal password must work');
    const withTemporary = await apiRequest('POST', '/auth/driver-login', {
      phone: driver.user.phone, password: temporaryPassword,
    });
    assert.equal(withTemporary.status, 401, 'The temporary password must be rejected after the change');

    console.log('PASS driver sign-in and forced password rotation work end to end');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
