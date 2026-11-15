// Authorized existing WINGSLAB-E2E-01 only. No create/replay, frontend edits or SQL writes.
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const ID = 'cmwgzrpnm0047orggilrr3fxu';
function readDatabase() {
  const cfg = JSON.parse(fs.readFileSync('config/wingslab.local.host.json'));
  const u = new URL(cfg.backend.databaseUrl);
  assert.equal(u.hostname, '127.0.0.1'); assert.equal(u.pathname, '/wingslab_local');
  const sql = `SELECT json_build_object(
    'identity',(SELECT instance_id FROM wingslab_identity.runtime),
    'readOnly',current_setting('transaction_read_only'),
    'orders',(SELECT json_agg(row_to_json(o) ORDER BY id) FROM "Order" o),
    'items',(SELECT json_agg(row_to_json(i) ORDER BY id) FROM "OrderItem" i),
    'tracking',(SELECT json_agg(row_to_json(t) ORDER BY "createdAt",id) FROM "OrderTracking" t),
    'customers',(SELECT json_agg(row_to_json(c) ORDER BY id) FROM "Customer" c),
    'restaurants',(SELECT json_agg(row_to_json(r) ORDER BY id) FROM "Restaurant" r),
    'products',(SELECT json_agg(row_to_json(p) ORDER BY id) FROM "Product" p),
    'addresses',(SELECT json_agg(row_to_json(a) ORDER BY id) FROM "Address" a),
    'users',(SELECT json_agg(json_build_object('id',id,'role',role,'email',email,'status',status) ORDER BY id) FROM "User"),
    'settlements',(SELECT count(*) FROM "RestaurantBillingSettlement"),
    'pushSubscriptions',(SELECT count(*) FROM "PushSubscription"),
    'fcmTokens',(SELECT count(*) FROM "FcmToken"),
    'notificationRetries',(SELECT count(*) FROM "NotificationRetry"))`;
  const r = spawnSync('docker', ['--context','desktop-linux','exec','-e','PGPASSWORD','-e','PGOPTIONS','wingslab-2b-postgres-1','psql','-X','-U',decodeURIComponent(u.username),'-d','wingslab_local','-tA','-v','ON_ERROR_STOP=1','-c',sql], {
    env: { ...process.env, PGPASSWORD: decodeURIComponent(u.password), PGOPTIONS: '-c default_transaction_read_only=on' }, encoding:'utf8',timeout:20000,
  });
  assert.equal(r.status,0,'Read-only SQL failed: '+r.stderr);
  const d=JSON.parse(r.stdout);assert.equal(d.identity,cfg.instanceId);assert.equal(d.readOnly,'on');return d;
}
function redisQueue(restaurantId) {
  const cfg=JSON.parse(fs.readFileSync('config/wingslab.local.json')),u=new URL(cfg.backend.redisUrl);
  const r=spawnSync('docker',['--context','desktop-linux','exec','-e','REDISCLI_AUTH','wingslab-2b-redis-1','redis-cli','--raw','ZRANGE',`restaurant:queue:${restaurantId}`,'0','-1'],{env:{...process.env,REDISCLI_AUTH:decodeURIComponent(u.password)},encoding:'utf8',timeout:10000});
  assert.equal(r.status,0);return r.stdout.trim().split('\n').filter(Boolean);
}
function checkPreflight(d) {
  const o=d.orders.find(x=>x.id===ID);assert(o);assert.equal(o.status,'PENDING');
  assert.equal(o.notes,'Tienda: WINGSLAB-E2E-01');assert.equal(o.totalAmount,163);
  assert.equal(o.fulfillmentType,'DELIVERY');assert.equal(o.paymentMethod,'CASH');assert.equal(o.paymentStatus,'PENDING');assert.equal(o.driverId,null);
  const c=d.customers.find(x=>x.id===o.customerId),r=d.restaurants.find(x=>x.id===o.restaurantId);
  assert.equal(d.users.find(x=>x.id===c.userId).email,'pedido-integral-01@wingslab.invalid');
  assert.equal(d.users.find(x=>x.id===r.userId).email,'restaurante@wingslab.local');
  assert.equal(r.status,'ACTIVE');assert.equal(r.hasOwnDelivery,true);assert.equal(r.enableTicketPrinting,false);assert.equal(r.whatsappNotifications,false);assert.equal(c.whatsappNotifications,false);
  assert.equal(d.settlements,0);assert.equal(d.pushSubscriptions,0);assert.equal(d.fcmTokens,0);assert.equal(d.notificationRetries,0);
  assert.equal(d.orders.length,4);assert.deepEqual(d.tracking.filter(x=>x.orderId===ID).map(x=>x.status),['PENDING']);
  const queue=redisQueue(r.id);assert(queue.every(x=>x===ID),'Queue contains other orders; stop before side effects');
  return {orderId:o.id,status:o.status,restaurantOwnDelivery:true,printing:false,externalSubscriptions:0,queueOtherOrders:0};
}
function compare(after,before,status) {
  assert.equal(after.orders.length,before.orders.length);
  for(const k of ['items','customers','restaurants','products','addresses','users'])assert.deepEqual(after[k],before[k],`Unexpected modification: ${k}`);
  assert.deepEqual(after.orders.filter(x=>x.id!==ID),before.orders.filter(x=>x.id!==ID),'Other orders changed');
  assert.deepEqual(after.tracking.filter(x=>x.orderId!==ID),before.tracking.filter(x=>x.orderId!==ID),'Other order tracking changed');
  const original=before.orders.find(x=>x.id===ID),order=after.orders.find(x=>x.id===ID);
  const permitted=new Set(['status','updatedAt','preparationTimeMinutes','preparationStartedAt','preparationDeadlineAt','estimatedDeliveryTime','etaExtendedMinutes','noDriversAvailable']);
  for(const [k,v] of Object.entries(original))if(!permitted.has(k))assert.deepEqual(order[k],v,`Order invariant changed: ${k}`);
  assert.equal(order.status,status);assert.equal(order.preparationTimeMinutes,15);
  assert.deepEqual(after.tracking.filter(x=>x.orderId===ID).map(x=>x.status),status==='CONFIRMED'?['PENDING','CONFIRMED']:['PENDING','CONFIRMED','PREPARING']);
  assert.equal(after.pushSubscriptions,0);assert.equal(after.fcmTokens,0);assert.equal(after.notificationRetries,before.notificationRetries);
  return {id:order.id,folio:order.orderReference,status:order.status,preparationTimeMinutes:order.preparationTimeMinutes,total:order.totalAmount,paymentStatus:order.paymentStatus,tracking:after.tracking.filter(x=>x.orderId===ID).map(x=>({status:x.status,notes:x.notes})),otherFixturesUnchanged:true};
}
module.exports=async ({state,save,evaluate,send,sessions,sleep,snapshot,events,assert,click})=>{
  assert.equal(state.orderId,ID);
  let before=readDatabase();
  const currentStatus=before.orders.find(o=>o.id===ID).status;
  let steps=[['aceptar','CONFIRMED'],['preparacion','PREPARING']];
  if(currentStatus==='CONFIRMED') {
    // Resume only after the recorded successful acceptance; never resend acceptance.
    const out=path.resolve(process.argv[2]);
    assert.equal(JSON.parse(fs.readFileSync(path.join(out,'transition-aceptar-response.json'))).http,200);
    const baseline=JSON.parse(fs.readFileSync(path.join(out,'transition-baseline-private.json')));
    compare(before,baseline,'CONFIRMED');before=baseline;steps=[['preparacion','PREPARING']];
    console.log('RESUME_CONFIRMED acceptance verified, not repeated');
  } else {
    console.log('PREFLIGHT',JSON.stringify(checkPreflight(before)));save('transition-baseline-private.json',before);
  }
  // Both real pages are authenticated and connected before either PATCH. No test events injected.
  await send('Page.navigate',{url:'http://127.0.0.1:3103/'},sessions.customer);
  await sleep(3500);
  await send('Page.bringToFront',{},sessions.customer);
  await snapshot('customer','before-accept-customer');await snapshot('restaurant','before-accept-restaurant');
  for(const [action,status] of steps) {
    const prior=readDatabase();assert.equal(prior.orders.find(o=>o.id===ID).status,action==='aceptar'?'PENDING':'CONFIRMED');
    // CDP cross-origin fetch/preflight stalled before reaching the server. Use a
    // single direct HTTP request with the real page's session, without retry.
    const token=await evaluate('restaurant',`localStorage.getItem('sadel.restaurant.token')`);
    assert(token,'Restaurant session missing');
    const response=await fetch(`http://127.0.0.1:3101/restaurant-panel/pedidos/${ID}/${action}`,{
      method:'PATCH',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
      body:JSON.stringify(action==='aceptar'?{preparationTimeMinutes:15}:{}),signal:AbortSignal.timeout(12000),
    });
    const json=await response.json();
    const outcome={http:response.status,success:json.success,status:json.data?.status,minutes:json.data?.preparationTimeMinutes,error:json.error?.code};
    save(`transition-${action}-response.json`,outcome);console.log('PATCH_RESULT',JSON.stringify(outcome));
    assert.equal(outcome.http,200,'Transition failed: stop without retry');assert.equal(outcome.status,status);assert.equal(outcome.minutes,15);
    const after=readDatabase(),report=compare(after,before,status);save(`transition-${action}-verified.json`,report);console.log('PERSISTED',JSON.stringify(report));
    await sleep(4500);
    const expected=action==='aceptar'?'order:accepted':'order:preparing';
    assert(events.some(e=>e.role==='customer'&&e.event===expected&&e.orderId===ID),'Missing actual CUSTOMER event; stop');
    await snapshot('customer',`after-${action}-customer`);
    await send('Page.bringToFront',{},sessions.restaurant);await sleep(1000);
    await snapshot('restaurant',`after-${action}-restaurant-before-refresh`);
    // The API route deliberately does not broadcast the initiating restaurant's own status.
    assert(await evaluate('restaurant',`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim().startsWith('Ordenes'));if(b)b.click();return !!b})()`));
    await sleep(400);await click('restaurant','Actualizar');await sleep(2500);
    await snapshot('restaurant',`after-${action}-restaurant-refreshed`);
    await send('Page.bringToFront',{},sessions.customer);
  }
  save('transition-events.json',events);console.log('RECEIVED_EVENTS',JSON.stringify(events));
};
module.exports.readDatabase=readDatabase;
module.exports.checkPreflight=checkPreflight;
if(require.main===module)console.log('READ_ONLY_PREFLIGHT',JSON.stringify(checkPreflight(readDatabase())));
