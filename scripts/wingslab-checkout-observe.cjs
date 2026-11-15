// Browse the existing menu/cart/checkout. Never submit an order.
const { readDatabase } = require('./wingslab-order-transition-check.cjs');
module.exports = async ({ evaluate, send, sessions, sleep, snapshot, assert }) => {
  const before = readDatabase();
  await send('Page.navigate', { url: 'http://127.0.0.1:3103/restaurantes/cmwgvmcia0006s4mlqs7brrh7' }, sessions.customer);
  await send('Page.bringToFront', {}, sessions.customer);
  for (let i = 0; i < 30; i++) {
    if (await evaluate('customer', `!!document.getElementById('wl_prod_alitas_6')`)) break;
    await sleep(400);
  }
  await evaluate('customer', `document.querySelector('button[aria-label="Cerrar checkout"]')?.click()`);
  await snapshot('customer', 'final-menu-before-cart');
  // A previous read-only visit may have left this item in the local cart.
  assert(await evaluate('customer', `(()=>{const card=document.getElementById('wl_prod_alitas_6');if(!card)return false;const b=[...card.querySelectorAll('button')].find(b=>b.textContent.trim()==='Agregar');if(b)b.click();return true})()`), 'Product card missing');
  await sleep(400);
  await snapshot('customer', 'final-menu-personalization');
  await evaluate('customer', `document.querySelector('button[aria-label="Abrir carrito"]')?.click()`);
  await sleep(400);
  await snapshot('customer', 'final-cart-no-submit');
  assert(await evaluate('customer', `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Completar pedido');if(b)b.click();return !!b})()`), 'Checkout button missing');
  await sleep(1000);
  const checkout = await snapshot('customer', 'final-checkout-no-submit');
  assert(checkout.text.includes('Avenida Ficticia Integral'), 'Saved address missing');
  assert.deepEqual(readDatabase().orders, before.orders, 'Browsing altered orders');
  console.log('CHECKOUT_VERIFIED_WITHOUT_SUBMISSION');
};
