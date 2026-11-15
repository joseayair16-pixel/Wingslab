// One authorized replay only. Original captured JSON, no checkout/login/refresh, no automatic retry.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {readDatabase}=require('./wingslab-order-transition-check.cjs');
const out=path.resolve(process.argv[2]);
const ID='cmwgzrpnm0047orggilrr3fxu';
const marker=path.join(out,'idempotency-one-attempt.json');
function save(name,data){fs.writeFileSync(path.join(out,name),JSON.stringify(data,null,2),{mode:0o600});}
function docker(args,env){const r=spawnSync('docker',['--context','desktop-linux',...args],{encoding:'utf8',timeout:20000,env:env||process.env});assert.equal(r.status,0,'Docker read failed');return r.stdout;}
function queue(restaurantId){
  const cfg=JSON.parse(fs.readFileSync('config/wingslab.local.json')),u=new URL(cfg.backend.redisUrl);
  const text=docker(['exec','-e','REDISCLI_AUTH','wingslab-2b-redis-1','redis-cli','--raw','ZRANGE',`restaurant:queue:${restaurantId}`,'0','-1'],{...process.env,REDISCLI_AUTH:decodeURIComponent(u.password)});
  assert(!text.startsWith('ERR')&&!text.startsWith('NOAUTH'));return text.trim().split('\n').filter(Boolean);
}
function logs(){
  const text=docker(['logs','wingslab-2b-backend-1']);
  const records=text.split('\n').flatMap(l=>{try{return[JSON.parse(l)]}catch{return[]}});
  return {
    // All business socket emissions, not HTTP/rate-limit logs.
    events:records.filter(x=>x.message==='Notification emitted').map(x=>({event:x.event,orderId:x.orderId,room:x.room,requestId:x.requestId,timestamp:x.timestamp})),
    orderCreated:records.filter(x=>x.message==='Order created').length,
    idempotencyHits:records.filter(x=>x.message==='Order idempotency hit'&&x.orderId===ID).length,
    completedPosts:records.filter(x=>x.message==='Request completed'&&x.method==='POST'&&x.url==='/pedidos').map(x=>({status:x.statusCode,requestId:x.requestId})),
  };
}
function counts(d){return {
  orders:d.orders.length,items:d.items.length,tracking:d.tracking.length,
  targetItems:d.items.filter(x=>x.orderId===ID).length,targetTracking:d.tracking.filter(x=>x.orderId===ID).length,
  maxDailyCounter:Math.max(...d.orders.map(x=>x.dailyCounter)),dailyCounterSum:d.orders.reduce((s,x)=>s+x.dailyCounter,0),
  uniqueFolios:new Set(d.orders.map(x=>x.orderReference)).size,
  customerTotalOrders:d.customers.find(x=>x.id===d.orders.find(o=>o.id===ID).customerId).totalOrders,
};}
(async()=>{
  assert(!fs.existsSync(marker),'Replay already marked attempted; never repeat this script');
  const state=JSON.parse(fs.readFileSync(path.join(out,'private-state.json'))),body=state.orderBody;
  assert.equal(state.orderId,ID);assert.equal(state.reference,'WINGSLAB-E2E-01');
  // Captured from Fetch.requestPaused before original POST was sent. Original
  // checkout serializes with JSON.stringify; reserialize without changing a field.
  const wireBody=JSON.stringify(body),hash=crypto.createHash('sha256').update(wireBody).digest('hex');
  assert.deepEqual(JSON.parse(wireBody),body);assert(body.clientOrderKey);
  const before=readDatabase(),order=before.orders.find(o=>o.id===ID);
  assert(order);assert.equal(order.status,'PREPARING');assert.equal(order.totalAmount,163);assert.equal(order.orderReference,'SAD-MWGZRPNI-B93WZN');
  assert.equal(order.clientOrderKey,body.clientOrderKey);assert.equal(before.orders.filter(o=>o.clientOrderKey===body.clientOrderKey).length,1);
  const customer=before.customers.find(c=>c.id===order.customerId),user=before.users.find(u=>u.id===customer.userId),restaurant=before.restaurants.find(r=>r.id===order.restaurantId);
  assert.equal(user.id,state.customerId);assert.equal(user.role,'CUSTOMER');assert.equal(user.email,'pedido-integral-01@wingslab.invalid');assert.equal(user.status,'ACTIVE');
  const original=JSON.parse(fs.readFileSync(path.join(out,'transition-baseline-private.json'))).orders.find(o=>o.id===ID);
  assert.equal(original.clientOrderKey,body.clientOrderKey);assert.equal(original.customerId,order.customerId);
  assert.equal(body.restaurantId,order.restaurantId);assert.equal(body.fulfillmentType,'DELIVERY');assert.equal(body.paymentMethod,'CASH');assert.equal(body.notes,order.notes);assert.equal(body.locationVerified,true);
  assert.deepEqual(Object.keys(body).sort(),['clientOrderKey','currentLocation','deliveryAddress','fulfillmentType','items','locationVerified','notes','paymentMethod','restaurantId'].sort());
  assert.equal(body.items.length,1);const item=before.items.find(i=>i.orderId===ID);
  assert.equal(body.items[0].productId,item.productId);assert.equal(body.items[0].quantity,item.quantity);assert.equal(body.items[0].sellBy,item.sellBy);assert.deepEqual(body.items[0].optionIds,[]);
  const address=before.addresses.find(a=>a.id===order.addressId);
  for(const key of ['street','number','neighborhood','city','state','zipCode','country','latitude','longitude'])assert.deepEqual(body.deliveryAddress[key],address[key],`Original address mismatch ${key}`);
  assert.equal(body.currentLocation.latitude,body.deliveryAddress.latitude);assert.equal(body.currentLocation.longitude,body.deliveryAddress.longitude);
  // Prisma DateTime is timestamp without time zone storing UTC; raw psql JSON
  // omits Z. Do not interpret it in the macOS local timezone.
  const creationUTC=/Z$|[+-]\d\d:\d\d$/.test(order.createdAt)?order.createdAt:order.createdAt+'Z';
  assert(Math.abs(body.currentLocation.capturedAt-Date.parse(creationUTC))<60000,'Original location timestamp is not from creation');
  assert.equal(before.pushSubscriptions,0);assert.equal(before.fcmTokens,0);assert.equal(before.notificationRetries,0);assert.equal(restaurant.enableTicketPrinting,false);assert.equal(restaurant.whatsappNotifications,false);assert.equal(restaurant.hasOwnDelivery,true);
  docker(['version','--format','{{.Server.Version}}']);
  for(const name of ['postgres','redis']){const d=JSON.parse(docker(['inspect',`wingslab-2b-${name}-1`]))[0];assert.equal(d.State.Health.Status,'healthy');}
  const disk=fs.statfsSync(out);assert(Number(disk.bavail)*Number(disk.bsize)>5*2**30,'Less than 5 GiB free: no POST');
  docker(['exec','wingslab-2b-backend-1','node','-e',`const fs=require('fs'),a=require('assert/strict');const r='packages/backend/dist/';a.equal(require('./'+r+'config/isolation.js').externalServicesEnabled(),false);a(Object.values(require('./'+r+'jobs/policy.js').validateJobSelection({})).every(v=>v===false));const s=fs.readFileSync(r+'services/order.service.js','utf8');a(s.indexOf('if (input.clientOrderKey)')>=0&&s.indexOf('if (input.clientOrderKey)')<s.indexOf('const restaurant ='));a(s.includes('isDuplicate: true'));const t=fs.readFileSync(r+'routes/order.routes.js','utf8');a(t.indexOf('if (isDuplicate)')>=0&&t.indexOf('if (isDuplicate)')<t.indexOf('const queueInfo ='));a(t.includes('isDuplicate: true'));console.log('PASS running image early duplicate return before creation, queue and notifications; external/jobs disabled')`]);
  const token=state.customerToken;assert(token,'Original customer session missing');
  const profileResponse=await fetch('http://127.0.0.1:3101/auth/perfil',{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(7000)});
  assert.equal(profileResponse.status,200);const profile=await profileResponse.json();assert.equal(profile.data.id,user.id);assert.equal(profile.data.role,'CUSTOMER');
  const health=await(await fetch('http://127.0.0.1:3101/health',{signal:AbortSignal.timeout(7000)})).json();assert.equal(health.status,'ok');
  const queueBefore=queue(restaurant.id),logsBefore=logs(),beforeCounts=counts(before);
  save('idempotency-before-private.json',before);
  save('idempotency-before-counts.json',{counts:beforeCounts,eventEmissions:logsBefore.events.length,targetEventEmissions:logsBefore.events.filter(e=>e.orderId===ID).length,bodySHA256:hash});
  console.log('PREFLIGHT verified preserved captured payload/key/client/order, healthy runtime; original GPS/context not renewed.');console.log('COUNTS_BEFORE',JSON.stringify(beforeCounts));
  const start=new Date().toISOString();
  // Durable local one-shot marker BEFORE any POST; ambiguity/timeout is never retried.
  fs.writeFileSync(fs.openSync(marker,'wx',0o600),JSON.stringify({attempted:true,start,orderId:ID,bodySHA256:hash}));
  const response=await fetch('http://127.0.0.1:3101/pedidos',{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
    body:wireBody,redirect:'error',signal:AbortSignal.timeout(15000),
  });
  const json=await response.json();
  const relevant={http:response.status,success:json.success,isDuplicate:json.isDuplicate,id:json.data?.id,folio:json.data?.orderReference,status:json.data?.status,total:json.data?.totalAmount,error:json.error?.code};
  save('idempotency-response.json',relevant);console.log('RESPONSE',JSON.stringify(relevant));
  assert.equal(response.status,200);assert.equal(json.isDuplicate,true);assert.equal(json.data.id,ID);assert.equal(json.data.orderReference,order.orderReference);assert.equal(json.data.status,'PREPARING');assert.equal(json.data.totalAmount,163);
  // Read-only checks; short observation window for unexpected delayed business effects.
  await new Promise(resolve=>setTimeout(resolve,4500));
  const after=readDatabase(),queueAfter=queue(restaurant.id),logsAfter=logs();
  assert.deepEqual(after,before,'Database changed: stop, no repair/retry');assert.deepEqual(queueAfter,queueBefore,'Redis order queue changed');assert.deepEqual(logsAfter.events,logsBefore.events,'Business socket emissions changed');
  assert.equal(logsAfter.orderCreated,logsBefore.orderCreated);assert.equal(logsAfter.idempotencyHits,logsBefore.idempotencyHits+1);assert.equal(logsAfter.completedPosts.length,logsBefore.completedPosts.length+1);
  const report={...relevant,before:beforeCounts,after:counts(after),newBusinessEvents:0,newOrderCreatedLogs:0,idempotencyHitsAdded:1,postRequestsCompleted:1,databaseSnapshotUnchanged:true,orderQueueUnchanged:true,allFixturesUnchanged:true};
  save('idempotency-verified.json',report);console.log('VERIFIED',JSON.stringify(report));
  console.log('FREE_GiB',Number(fs.statfsSync(out).bavail)*Number(fs.statfsSync(out).bsize)/2**30);
})().catch(e=>{console.error('STOP; no automatic retry:',e.message);process.exitCode=1;});
