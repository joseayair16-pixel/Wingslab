module.exports = async ({ state, save, evaluate, send, sessions, sleep, snapshot, assert }) => {
  assert(state.orderId);
  await send('Page.bringToFront', {}, sessions.restaurant);
  await sleep(3000);
  const d = await snapshot('restaurant', 'restaurant-new-order-visible');
  assert(d.text.includes('Cliente Integral'),'New order not visible after opening panel');
  const order=await evaluate('customer', `(async()=>{const r=await fetch('/api/me/pedidos/${state.orderId}',{headers:{Authorization:'Bearer '+localStorage.getItem('sadel.customer.token')}});const j=await r.json();return {id:j.data.id,orderReference:j.data.orderReference,status:j.data.status,totalAmount:j.data.totalAmount,notes:j.data.notes}})()`);
  save('persisted-order.json',order);console.log('PERSISTED',JSON.stringify(order));
};
