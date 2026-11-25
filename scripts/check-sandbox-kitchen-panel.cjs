// Real local panel, disposable order fixture. No calls to the live backend.
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('playwright');

async function main() {
  const { order, event } = JSON.parse(execFileSync('bash', [path.join(__dirname, 'run-sandbox-kitchen.sh'), '--webhook-live', '--panel-fixture'], { encoding: 'utf8' }).trim().split('\n').at(-1));
  const origin = 'http://127.0.0.1:3102';
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    let subscriber;
    let published = false;
    await context.routeWebSocket('**/socket.io/**', socket => {
      socket.onMessage(message => {
        if (String(message).startsWith('40')) {
          socket.send('40{"sid":"fixture"}');
          subscriber = socket;
        }
      });
      socket.send('0{"sid":"fixture","upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}');
    });
    await context.addInitScript(({ id, origin }) => {
      if (location.origin !== origin) return;
      localStorage.setItem('sadel.restaurant.token', 'isolated-fixture');
      localStorage.setItem('sadel.restaurant.apiBase', '/api');
      localStorage.setItem('sadel.restaurant.user', JSON.stringify({ id, role: 'RESTAURANT', name: 'Cocina de prueba' }));
      localStorage.setItem('restaurantActiveSection', 'orders');
    }, { id: order.restaurant.userId, origin });
    let ordersServed = 0;
    const page = await context.newPage();
    const blockedLocal = new Set();
    await page.route('**/*', route => {
      const request = route.request();
      const url = new URL(request.url());
      if (![origin, 'http://127.0.0.1:3101'].includes(url.origin) || request.method() !== 'GET') return route.abort();
      if (url.pathname.replace(/^\/api(?=\/)/, '') === '/restaurant-panel/pedidos') {
        ordersServed += 1;
        return route.fulfill({ json: { success: true, data: published ? [order] : [] } });
      }
      const apiPath = url.pathname.replace(/^\/api(?=\/)/, '');
      if (apiPath === '/restaurant-panel/perfil') return route.fulfill({ json: { success: true, data: { ...order.restaurant, name: 'Cocina de prueba' } } });
      if (['/restaurant-panel/productos', '/restaurant-panel/categorias'].includes(apiPath)) return route.fulfill({ json: { success: true, data: [] } });
      if (url.origin === origin && (url.pathname === '/' || url.pathname.startsWith('/_next/'))) return route.continue();
      if (url.origin === origin) blockedLocal.add(url.pathname);
      return route.abort();
    });
    page.on('pageerror', error => console.error('Panel runtime:', error.name));
    page.on('requestfailed', request => { if (request.resourceType() === 'script') console.error('Script blocked:', new URL(request.url()).pathname); });
    page.on('response', response => { if (response.status() >= 400 && new URL(response.url()).pathname.startsWith('/_next/static/')) console.error('Asset HTTP', response.status(), new URL(response.url()).pathname); });
    const documentResponse = await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (!documentResponse?.ok()) throw new Error(`HTTP ${documentResponse?.status()}`);
    const label = order.dailyCounter ? `#${String(order.dailyCounter).padStart(2, '0')}` : order.orderReference;
    for (let i = 0; i < 100 && (!subscriber || !ordersServed); i++) await new Promise(resolve => setTimeout(resolve, 100));
    if (!subscriber || !ordersServed) throw new Error('El panel no se conectó o no cargó el listado inicial');
    if (await page.locator('.wl-order-number').count()) throw new Error('El listado inicial no está vacío');
    const initialReads = ordersServed;
    published = true;
    subscriber.send(`42${JSON.stringify(event)}`);
    await page.locator('.wl-order-number').filter({ hasText: label }).first().waitFor({ state: 'visible', timeout: 15000 }).catch(async error => {
      console.error(JSON.stringify({ ordersServed, blockedLocal: [...blockedLocal], orderRows: await page.locator('.wl-order-number').count(), ui: await page.evaluate(() => ({ admin: !!document.querySelector('.wl-admin'), loader: !!document.querySelector('.wl-restaurant-loader'), next: typeof window.next, webpack: Boolean(window.webpackChunk_N_E) })), route: new URL(page.url()).pathname }));
      throw error;
    });
    if (ordersServed <= initialReads) throw new Error('El evento no actualizó el listado');
    console.log('PASS: Chrome mostró el pedido sin recargar tras reproducir el evento Socket.IO capturado del webhook aislado.');
  } finally { await browser.close(); }
}

main().catch(error => { console.error('Prueba de panel no completada:', error.name); process.exitCode = 1; });
