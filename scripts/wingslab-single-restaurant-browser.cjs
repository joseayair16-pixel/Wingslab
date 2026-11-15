// Read-only demonstration of the deployed single-restaurant application.
const fs = require('node:fs'), path = require('node:path');
const { readDatabase } = require('./wingslab-order-transition-check.cjs');
module.exports = async ({ state, evaluate, send, sessions, sleep, snapshot, assert, save }) => {
  const evidence = '/private/var/folders/bp/fw91jby178j6336lpfmmd84m0000gn/T/opencode/wingslab-single-restaurant-evidence';
  const baseline = JSON.parse(fs.readFileSync(path.join(evidence, 'baseline-private.json')));
  const before = readDatabase();
  assert.deepEqual(before, baseline, 'Deployment altered business data');
  async function navigate(role, url) {
    await send('Page.navigate', { url }, sessions[role]);
    await send('Page.bringToFront', {}, sessions[role]);
    await sleep(1800);
  }
  await navigate('customer', 'http://127.0.0.1:3103/');
  for (let i = 0; i < 20; i++) {
    if (await evaluate('customer', `!!document.getElementById('wl_prod_alitas_6')`)) break;
    await sleep(300);
  }
  const storefront = await snapshot('customer', 'single-restaurant-storefront');
  assert(await evaluate('customer', `location.pathname==='/' && !!document.getElementById('wl_prod_alitas_6')`));
  assert(storefront.text.includes('WingsLab'));
  assert(!/Explorar restaurantes|Quiero vender|Quiero repartir|Buscar restaurantes|Selecciona.*restaurante/i.test(storefront.text));
  const menu = await (await fetch('http://127.0.0.1:3101/menu')).json();
  assert.equal(menu.data.id, 'cmwgvmcia0006s4mlqs7brrh7');
  assert(menu.data.categories.flatMap(c => c.products).length > 0);
  assert(menu.data.categories.flatMap(c => c.products).every(p => p.restaurantId === menu.data.id));
  // The header navigates to this account, not to a directory of businesses.
  assert(await evaluate('customer', `(()=>{const b=document.querySelector('button[aria-label="Mis pedidos y cuenta"]');if(b)b.click();return !!b})()`));
  await sleep(1600);
  const account = await snapshot('customer', 'single-restaurant-account');
  assert(await evaluate('customer', `location.pathname==='/cuenta'`));
  assert(account.text.includes('Entregado'), 'Delivered order missing from account');
  assert(account.text.includes('Avenida Ficticia Integral'), 'Saved address missing');
  await evaluate('customer', `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Ver detalles');if(b)b.click()})()`);
  await sleep(800);
  const detail = await snapshot('customer', 'single-restaurant-order-detail');
  assert(detail.text.includes('Tu pedido WingsLab')); assert(detail.text.includes('Entregado'));
  await navigate('customer', 'http://127.0.0.1:3103/restaurantes/cmwgvmcia0006s4mlqs7brrh7?checkout=true');
  assert(await evaluate('customer', `location.pathname==='/'`), 'Legacy link did not canonicalize');
  await snapshot('customer', 'single-restaurant-checkout');
  await navigate('customer', 'http://127.0.0.1:3103/restaurantes/not-the-configured-business');
  assert(!await evaluate('customer', `!!document.getElementById('wl_prod_alitas_6')`), 'Other business URL mounted a menu');
  await navigate('customer', 'http://127.0.0.1:3103/');
  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 1, mobile: true }, sessions.customer);
  await evaluate('customer', `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Saltar');if(b)b.click()})()`);
  await snapshot('customer', 'single-restaurant-mobile-menu');
  const panel = await snapshot('restaurant', 'single-restaurant-panel');
  assert(!/Destacados|Apoyo a red|Prestar apoyo|Quiero vender/i.test(panel.text));
  assert(panel.text.includes('Menú WingsLab'));
  assert(await evaluate('restaurant', `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Configuracion');if(b)b.click();return !!b})()`));
  await sleep(700);
  const settings = await snapshot('restaurant', 'single-restaurant-settings');
  assert(!/Selecciona hasta 2 categorías|aparecer en esas secciones|Destacados/.test(settings.text));
  await evaluate('restaurant', `(()=>{const b=[...document.querySelectorAll('button')].find(b=>/entrega/i.test(b.textContent.trim())&&b.getClientRects().length);if(b)b.click()})()`);
  await sleep(400);
  const delivery = await snapshot('restaurant', 'single-restaurant-own-delivery-settings');
  assert(!/Prestar apoyo|entrega SaDeL|pedidos de otros negocios/.test(delivery.text));
  // These requests must terminate at the boundary, before handlers can write.
  const denied = [];
  for (const [method, route, body] of [
    ['GET', '/restaurantes'], ['GET', '/restaurantes/foreign-business'],
    ['GET', '/menu?restaurantId=foreign-business'], ['GET', '/admin/restaurantes'],
    ['GET', '/restaurant-panel/repartidores/disponibles'], ['GET', '/restaurant-panel/pedidos-apoyo'],
    ['POST', '/public/solicitudes', { type: 'RESTAURANT' }],
    ['POST', '/pedidos', { restaurantId: 'foreign-business' }],
    ['PATCH', '/restaurant-panel/perfil', { supportsNetworkDelivery: true }],
  ]) {
    const r = await fetch('http://127.0.0.1:3101' + route, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.customerToken}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert([403,404].includes(r.status), `Boundary failed: ${method} ${route} => ${r.status}`);
    denied.push({ method, route, status: r.status });
  }
  const after = readDatabase(); assert.deepEqual(after, baseline, 'UI checks or rejected requests altered data');
  for (const role of ['customer', 'restaurant']) {
    const screenshot = await send('Page.captureScreenshot', { format: 'png' }, sessions[role]);
    fs.writeFileSync(path.join(evidence, `single-${role}.png`), Buffer.from(screenshot.data, 'base64'), { mode: 0o600 });
  }
  const result = { configuredRestaurant: menu.data.id, rootIsMenu: true, accountHistory: true, savedAddress: true,
    legacyLinkCanonicalized: true, foreignLinkBlocked: true, ownDeliveryOnly: true, businessDataUnchanged: true, denied };
  save('single-restaurant-verified.json', result);
  fs.writeFileSync(path.join(evidence, 'verified.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log('SINGLE_RESTAURANT_VERIFIED', JSON.stringify(result));
};
