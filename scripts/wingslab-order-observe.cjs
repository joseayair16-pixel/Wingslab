// Read-only observation after the authorized transitions; never repeats PATCH.
module.exports=async({state,evaluate,snapshot,send,sessions,sleep,assert,save})=>{
  await send('Page.bringToFront',{},sessions.restaurant);await sleep(1500);
  assert(await evaluate('restaurant',`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim().startsWith('Ordenes'));if(b)b.click();return !!b})()`));
  await sleep(1000);const r=await snapshot('restaurant','final-preparing-restaurant');
  assert(r.text.includes('Cliente Integral WingsLab'),'Restaurant missing test customer');
  const check=require('./wingslab-order-transition-check.cjs');const d=check.readDatabase(),o=d.orders.find(o=>o.id===state.orderId);
  assert.equal(o.status,'PREPARING');assert.equal(o.preparationTimeMinutes,15);
  await send('Page.navigate',{url:'http://127.0.0.1:3103/'},sessions.customer);await sleep(3000);
  await send('Page.bringToFront',{},sessions.customer);
  for(let i=0;i<20;i++) {
    if(await evaluate('customer',`document.body.innerText.includes('En preparación')`))break;
    await sleep(500);
  }
  const c=await snapshot('customer','final-preparing-customer');assert(c.text.includes('En preparación'));
  const read=await evaluate('customer',`(async()=>{const r=await fetch('/api/me/pedidos/${state.orderId}',{headers:{Authorization:'Bearer '+localStorage.getItem('sadel.customer.token')}});const j=await r.json();return {http:r.status,id:j.data?.id,status:j.data?.status,minutes:j.data?.preparationTimeMinutes}})()`);
  assert.equal(read.status,'PREPARING');save('final-ui-api-read.json',read);console.log('FINAL_UI_READ',JSON.stringify(read));
};
