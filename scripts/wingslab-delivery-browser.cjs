// Executes only the authorized existing order via real UI controls, never HTTP mutations.
const fs=require('node:fs'),path=require('node:path');
const {readDatabase}=require('./wingslab-order-transition-check.cjs');
module.exports=async({state,save,evaluate,send,sessions,sleep,snapshot,assert,events})=>{
  const ID='cmwgzrpnm0047orggilrr3fxu';assert.equal(state.orderId,ID);
  const out=path.resolve(process.argv[2]);
  const baselinePath=path.join(out,'delivery-baseline-private.json');
  if(!fs.existsSync(baselinePath))save('delivery-baseline-private.json',readDatabase());
  const baseline=JSON.parse(fs.readFileSync(baselinePath));
  const current=()=>readDatabase().orders.find(o=>o.id===ID);
  async function button(role,pattern,card=false){
    assert(await evaluate(role,`(()=>{const root=${card?`[...document.querySelectorAll('article')].find(a=>a.textContent.includes('Cliente Integral'))`:'document'};const b=[...(root?.querySelectorAll('button')||[])].find(b=>new RegExp(${JSON.stringify(pattern)},'i').test(b.textContent.trim())&&!b.disabled);if(b)b.click();return !!b})()`),`Missing ${role} UI button: ${pattern}`);
    await sleep(500);
  }
  async function waitStatus(status){
    for(let i=0;i<20;i++){if(current().status===status)return;await sleep(500)}
    throw Error('Real API did not persist '+status+'; no retry');
  }
  async function page(role,url){
    const t=await send('Target.createTarget',{url:'about:blank'});
    sessions[role]=(await send('Target.attachToTarget',{targetId:t.targetId,flatten:true})).sessionId;
    for(const method of ['Page.enable','Runtime.enable','Network.enable'])await send(method,{},sessions[role]);
    await send('Network.setBypassServiceWorker',{bypass:true},sessions[role]);
    await send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]},sessions[role]);
    await send('Emulation.setDeviceMetricsOverride',{width:430,height:932,deviceScaleFactor:1,mobile:true},sessions[role]);
    await send('Emulation.setGeolocationOverride',{latitude:19.433,longitude:-99.134,accuracy:10},sessions[role]);
    await send('Page.navigate',{url},sessions[role]);
    await sleep(3000);
  }
  await send('Page.navigate',{url:'http://127.0.0.1:3103/'},sessions.customer);
  await page('restaurant2','http://127.0.0.1:3102/');
  await send('Page.bringToFront',{},sessions.restaurant);
  await button('restaurant','^Ordenes');
  await sleep(1000);await snapshot('restaurant','qr-before-ready');
  if(current().status==='PREPARING'){
    await button('restaurant','^Marcar listo$',true);await waitStatus('READY');await sleep(2000);
    assert(events.some(e=>e.role==='customer'&&e.event==='order:ready'&&e.orderId===ID),'Customer missed READY');
    assert(events.some(e=>e.role==='restaurant2'&&e.event==='order:ready'&&e.orderId===ID),'Second restaurant tab missed READY');
  }
  await snapshot('restaurant2','qr-ready-other-tab');
  if(!state.deliveryUrl){
    assert.equal(current().status,'READY');
    await evaluate('restaurant',`window.open=(url)=>{window.__deliveryUrl=url;return null}`);
    await button('restaurant','^Generar QR de reparto$',true);await sleep(1500);
    assert(await evaluate('restaurant',`!!document.querySelector('[role=dialog] svg')`),'QR not rendered');
    let url=await evaluate('restaurant',`document.querySelector('a[href*="/reparto/ver/"]')?.href`);
    if(!url){await button('restaurant','^Abrir reparto local$');url=await evaluate('restaurant',`window.__deliveryUrl`)}
    const u=new URL(url);assert.equal(u.origin,'http://127.0.0.1:3103');assert(u.pathname.startsWith('/reparto/ver/'));
    state.deliveryUrl=url;state.deliveryToken=u.pathname.split('/').pop();save('private-state.json',state);
    assert.equal(current().status,'READY','QR generation must not start delivery');
    await snapshot('restaurant','qr-visible');
  }
  await page('driver',state.deliveryUrl);
  await send('Page.bringToFront',{},sessions.driver);await sleep(1000);
  if(current().status==='READY'){
    await snapshot('driver','qr-pickup');await button('driver','^Recoger e iniciar reparto$');await waitStatus('IN_TRANSIT');
    await sleep(2000);
  }
  await snapshot('driver','qr-in-transit');
  // GPS override is synthetic and disclosed; normal watchPosition sends to the real API.
  await send('Emulation.setGeolocationOverride',{latitude:19.4331,longitude:-99.1341,accuracy:10},sessions.driver);
  await sleep(3000);
  const tracking=current();assert(tracking.lastDriverLocationAt,'GPS not persisted by actual delivery page');
  assert(events.some(e=>e.role==='customer'&&e.event==='order:in-transit'&&e.orderId===ID),'Customer missed transit');
  assert(events.some(e=>e.role==='customer'&&e.event==='order:driver-location'&&e.orderId===ID),'Customer missed GPS');
  if(!tracking.driverArrivedAtCustomer){await button('driver','Ya llegu');await sleep(1500);assert(current().driverArrivedAtCustomer,'Arrival not persisted')}
  await snapshot('customer','qr-client-arrival');await snapshot('driver','qr-arrived');
  if(current().status==='IN_TRANSIT'){
    await button('driver','^Confirmar Entrega$');await sleep(400);
    await snapshot('driver','qr-cash-confirmation');
    await button('driver','^Confirmar entrega y efectivo ficticio$');await waitStatus('DELIVERED');await sleep(2500);
  }
  const after=readDatabase(),delivered=after.orders.find(o=>o.id===ID);
  assert.equal(delivered.status,'DELIVERED');assert.equal(delivered.paymentStatus,'COMPLETED');assert.equal(delivered.totalAmount,163);
  assert.deepEqual(after.orders.filter(o=>o.id!==ID),baseline.orders.filter(o=>o.id!==ID),'Original orders changed');
  for(const k of ['items','products','addresses','customers','restaurants'])assert.deepEqual(after[k],baseline[k],`Unexpected ${k} changes`);
  assert.equal(after.orders.length,4);
  assert(events.some(e=>e.role==='customer'&&e.event==='order:delivered'&&e.orderId===ID),'Customer missed delivery');
  assert(events.some(e=>e.role==='restaurant2'&&e.event==='order:delivered'&&e.orderId===ID),'Restaurant missed delivery');
  await snapshot('driver','qr-delivered-driver');
  await send('Page.bringToFront',{},sessions.customer);
  await evaluate('customer',`document.querySelector('button[aria-label="Abrir menú principal"]')?.click()`);
  await button('customer','Mis pedidos');await sleep(1500);
  const history=await snapshot('customer','qr-delivered-customer-history');assert(/Entregado/i.test(history.text),'Delivered state absent from customer UI');
  await snapshot('restaurant2','qr-delivered-restaurant');
  // Bearer has been consumed. GET only: do not repeat any delivery operation.
  const r=await fetch('http://127.0.0.1:3101/public/delivery-ticket/'+state.deliveryToken);assert.equal(r.status,404,'Closed QR still grants access');
  // Capture the three real experiences privately; no published bearer QR.
  for(const role of ['customer','restaurant2','driver']) {
    const shot=await send('Page.captureScreenshot',{format:'png'},sessions[role]);
    fs.writeFileSync(path.join(out,`delivery-${role}.png`),Buffer.from(shot.data,'base64'),{mode:0o600});
  }
  // Checkout stays usable without creating an unnecessary second order.
  await send('Page.navigate',{url:'http://127.0.0.1:3103/restaurantes/cmwgvmcia0006s4mlqs7brrh7'},sessions.customer);
  await send('Page.bringToFront',{},sessions.customer);await sleep(2500);
  await evaluate('customer',`document.querySelector('button[aria-label="Cerrar checkout"]')?.click()`);
  await evaluate('customer',`(()=>{const b=[...document.getElementById('wl_prod_alitas_6').querySelectorAll('button')].find(b=>b.textContent.trim()==='Agregar');if(b)b.click()})()`);
  await evaluate('customer',`document.querySelector('button[aria-label="Abrir carrito"]')?.click()`);await sleep(500);
  await evaluate('customer',`(()=>{const e=document.querySelector('input[placeholder="Nota..."]');if(!e)return;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Sin picante · prueba local');e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await snapshot('customer','delivery-catalog-cart-personalization');
  await button('customer','^Completar pedido$');await sleep(1200);
  const checkout=await snapshot('customer','delivery-checkout-ready-no-submit');
  assert(checkout.text.includes('Avenida Ficticia Integral'),'Saved synthetic address missing in checkout');
  assert.equal(readDatabase().orders.length,4,'Unexpected extra order');
  const result={id:ID,folio:delivered.orderReference,status:delivered.status,paymentStatus:delivered.paymentStatus,total:delivered.totalAmount,
    history:after.tracking.filter(t=>t.orderId===ID).map(t=>({status:t.status,notes:t.notes})),originalFixturesUnchanged:true,qrRevoked:true,events};
  save('delivery-verified.json',result);console.log('DELIVERY_VERIFIED',JSON.stringify(result));
};
