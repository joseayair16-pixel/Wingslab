// Browser check (read-only) for the WingsLab restaurant order comanda modal.
// Only GET/HEAD/OPTIONS are forwarded: no order mutation is possible.
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
    profileDir: path.join(root, 'tmp/comanda-modal-profiles', String(Date.now())),
    origins: ['http://127.0.0.1:3101', 'http://127.0.0.1:3102'],
    width: 430,
    height: 932,
    route,
  });
  try {
    await browser.init();
    await browser.send('Network.setBlockedURLs', { urls: ['*socket.io*'] });
    await browser.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `localStorage.setItem('sadel.restaurant.token',${JSON.stringify(token)});` +
        `localStorage.setItem('sadel.restaurant.user',JSON.stringify({id:'cmwgvmci70004s4mldyvwosbg',name:'WingsLab',role:'RESTAURANT'}));` +
        `localStorage.setItem('sadel.restaurant.apiBase','http://127.0.0.1:3101');` +
        `localStorage.setItem('restaurantActiveSection','orders');`,
    });
    await browser.open('http://127.0.0.1:3102/', 2500);
    await browser.waitFor(() => browser.evaluate(`document.body.innerText.includes('Órdenes') || document.body.innerText.includes('Ordenes')`));
    await browser.sleep(1500);

    // Show the delivered orders, the only fixtures that remain visible.
    await browser.evaluate(`(() => {
      const select = document.querySelector('.wl-orders-filter select');
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(select, 'DELIVERED');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await browser.sleep(1200);

    // The order row must be a button that opens the comanda modal.
    const summaryTag = await browser.evaluate(
      `(() => { const el = document.querySelector('.wl-order-summary'); return el ? el.tagName : 'none'; })()`,
    );
    assert.equal(summaryTag, 'BUTTON', 'The order row must be a button, not a disclosure summary');
    assert.equal(
      await browser.evaluate(`document.querySelectorAll('details.wl-order-disclosure').length`),
      0,
      'The order list must not use expandable details',
    );
    assert(
      (await browser.evaluate(`document.querySelectorAll('.wl-order-card').length`)) > 0,
      'At least one order row must be visible',
    );

    await browser.evaluate(`document.querySelector('.wl-order-summary').click()`);
    await browser.sleep(800);

    const modal = await browser.evaluate(`(() => {
      const el = document.querySelector('.wl-comanda-modal');
      if (!el) return null;
      return {
        title: el.querySelector('h2')?.textContent?.trim() || '',
        customer: el.querySelector('.wl-comanda-customer')?.textContent || '',
        progress: [...el.querySelectorAll('.wl-comanda-progress small')].map(n => n.textContent),
        products: el.querySelector('.wl-comanda-products h3')?.textContent || '',
        productNames: [...el.querySelectorAll('.wl-comanda-product strong')].map(n => n.textContent),
        total: el.querySelector('.wl-comanda-total')?.textContent || '',
      };
    })()`);
    assert(modal, 'The comanda modal must open when the order row is clicked');
    assert(modal.title.length > 0, 'The modal must show the order number');
    assert(modal.customer.length > 0, 'The modal must show the customer');
    assert.equal(modal.progress.length, 4, 'The modal must show the four delivery stages');
    assert(modal.products.includes('Productos'), 'The modal must show the product section');
    assert(modal.total.length > 0, 'The modal must show the total');

    // The modal must close with Escape.
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await browser.sleep(500);
    assert.equal(
      await browser.evaluate(`document.querySelectorAll('.wl-comanda-modal').length`),
      0,
      'The modal must close with Escape',
    );

    assert(!browser.requests.some(r => !['GET', 'HEAD', 'OPTIONS'].includes(r.method)), 'No mutations were sent');
    console.log('PASS comanda modal opens with full order information and closes; no mutations');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
