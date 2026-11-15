// Read-only final UI checks. The delivered order is never replayed or reset.
const fs=require('node:fs'),path=require('node:path');
const {readDatabase}=require('./wingslab-order-transition-check.cjs');
module.exports=async({state,evaluate,send,sessions,sleep,snapshot,assert,save})=>{
  const out=path.resolve(process.argv[2]),ID=state.orderId;
  const d=readDatabase(),o=d.orders.find(o=>o.id===ID);assert.equal(o.status,'DELIVERED');
  const baseline=JSON.parse(fs.readFileSync(path.join(out,'delivery-baseline-private.json')));
  assert.deepEqual(d.orders.filter(o=>o.id!==ID),baseline.orders.filter(o=>o.id!==ID));
  for(const k of ['items','products','addresses','customers','restaurants'])assert.deepEqual(d[k],baseline[k]);
  await send('Page.navigate',{url:'http://127.0.0.1:3103/'},sessions.customer);
  await send('Page.bringToFront',{},sessions.customer);
  for(let i=0;i<25;i++){
    if(await evaluate('customer',`!!document.querySelector('button[aria-label="Abrir menú principal"]')`))break;
    await sleep(400);
  }
  const home = await snapshot('customer','delivery-final-customer-home');
  assert(home.text.includes('WingsLab'), 'WingsLab identity missing');
  assert(await evaluate('customer',`document.title.includes('WingsLab')`), 'Customer page title not deployed');
  // Dismiss only local notices; no ratings, messages or other API mutations.
  await evaluate('customer',`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Entendido');if(b)b.click()})()`);
  assert(await evaluate('customer',`(()=>{const b=document.querySelector('button[aria-label="Abrir menú principal"]');if(b)b.click();return !!b})()`),'Customer menu missing');
  await sleep(300);
  assert(await evaluate('customer',`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Mis pedidos'));if(b)b.click();return !!b})()`),'Customer history missing');
  await sleep(1500);const history=await snapshot('customer','delivery-final-customer-history');assert(/Entregado/i.test(history.text));
  await send('Page.bringToFront',{},sessions.restaurant);
  assert(await evaluate('restaurant',`document.title.includes('WingsLab')`), 'Restaurant page title not deployed');
  await evaluate('restaurant',`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim().startsWith('Ordenes'));if(b)b.click()})()`);
  await sleep(400);
  await evaluate('restaurant',`(()=>{const s=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='DELIVERED'));if(s){s.value='DELIVERED';s.dispatchEvent(new Event('change',{bubbles:true}))}})()`);
  await sleep(500);const restaurant=await snapshot('restaurant','delivery-final-restaurant-history');assert(restaurant.text.includes('Cliente Integral'));
  for(const role of ['customer','restaurant']){
    const shot=await send('Page.captureScreenshot',{format:'png'},sessions[role]);fs.writeFileSync(path.join(out,`delivery-${role}.png`),Buffer.from(shot.data,'base64'),{mode:0o600});
  }
  const r=await fetch('http://127.0.0.1:3101/public/delivery-ticket/'+state.deliveryToken);assert.equal(r.status,404);
  const previousNetworks=fs.readdirSync(out).filter(f=>/^network-.*\.json$/.test(f)).map(f=>JSON.parse(fs.readFileSync(path.join(out,f))));
  const events=previousNetworks.flatMap(n=>n.events||[]).filter(e=>e.orderId===ID);
  const report={id:ID,folio:o.orderReference,status:o.status,paymentStatus:o.paymentStatus,total:o.totalAmount,
    states:d.tracking.filter(t=>t.orderId===ID).map(t=>t.status),originalFixturesUnchanged:true,qrRevoked:true,events};
  save('delivery-verified.json',report);console.log('DELIVERY_VERIFIED',JSON.stringify(report));
};
