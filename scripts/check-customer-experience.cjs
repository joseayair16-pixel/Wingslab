const {createBrowser}=require('./wingslab-visual-cdp.cjs');
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),jwt=require('jsonwebtoken');
const root=path.resolve(__dirname,'..'),out=path.join(root,'docs/evidence/customer-experience'),run=String(Date.now());
const config=JSON.parse(fs.readFileSync(path.join(root,'config/wingslab.local.json')));
const token=jwt.sign({sub:'cmwgvmckq0007s4mlixca3qq9',phone:'5500000001',role:'CUSTOMER'},config.backend.jwtSecret,{expiresIn:'15m'});
const owner=jwt.sign({sub:'cmwgvmci70004s4mldyvwosbg',phone:'5500000010',role:'RESTAURANT'},config.backend.jwtSecret,{expiresIn:'15m'});
let fixture=false,tickets=[];
const json=data=>({statusCode:200,headers:{'content-type':'application/json','access-control-allow-origin':'*'},body:JSON.stringify({success:true,data})});
async function route(request){
  const p=new URL(request.url).pathname.replace(/^\/api(?=\/)/,'');
  if(request.method==='OPTIONS')return{statusCode:204,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,PUT,PATCH,OPTIONS','access-control-allow-headers':'authorization,content-type'},body:''};
  if(fixture&&p==='/customer/lealtad')return json({enabled:true,stamps:3,stampGoal:8,rewardDescription:'Recompensa de prueba aislada',stampTerms:'Condiciones de prueba; no es una oferta publicada.',redemptionEnabled:false});
  if(fixture&&p==='/customer/support/tickets'){
    if(request.method==='POST'){const data=JSON.parse(request.postData);tickets=[{...data,id:'fixture-report',status:'PENDING',createdAt:new Date().toISOString()},...tickets];return json(tickets[0]);}return json(tickets);
  }
  if(fixture&&p==='/restaurant-panel/soporte')return json(tickets.map(t=>({...t,customer:{user:{name:'Cliente de prueba'}}})));
  if(fixture&&p==='/restaurant-panel/soporte/fixture-report'&&request.method==='PATCH'){tickets[0]={...tickets[0],...JSON.parse(request.postData)};return json(tickets[0]);}
  if(!['GET','HEAD'].includes(request.method))throw Error('Blocked persisted mutation '+request.method+' '+p);
  const r=await fetch(request.url,{signal:AbortSignal.timeout(10000),headers:Object.fromEntries(Object.entries(request.headers).filter(([k])=>['authorization','accept','origin'].includes(k.toLowerCase())))});
  return{statusCode:r.status,headers:Object.fromEntries(r.headers),body:Buffer.from(await r.arrayBuffer())};
}
async function browser(name,width,height,theme,restaurant=false){
 const b=createBrowser({profileDir:path.join(root,'tmp/experience-profiles',run,name),width,height,origins:['http://127.0.0.1:3103','http://127.0.0.1:3102','http://127.0.0.1:3101'],allowMutations:fixture,route});await b.init();await b.send('Network.setBlockedURLs',{urls:['*socket.io*']});
 const key=restaurant?'sadel.restaurant':'sadel.customer',t=restaurant?owner:token;
 await b.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('${restaurant?'wingslab.restaurant.theme':'wingslab.theme'}','${theme}');localStorage.setItem('${key}.token',${JSON.stringify(t)});localStorage.setItem('${key}.user',JSON.stringify({id:'${restaurant?'cmwgvmci70004s4mldyvwosbg':'cmwgvmckq0007s4mlixca3qq9'}',name:'${restaurant?'WingsLab':'Cliente'}',role:'${restaurant?'RESTAURANT':'CUSTOMER'}'}));localStorage.setItem('${key}.apiBase','http://127.0.0.1:3101');localStorage.setItem('restaurantActiveSection','support');`});return b;
}
async function click(b,selector){await b.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await b.sleep(250);}
async function field(b,selector,value){await b.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);}
(async()=>{
 for(const [name,w,h] of [['375',375,812],['390',390,844],['430',430,932],['desktop',1440,1000]])for(const theme of ['light','dark']){
  const b=await browser(name+theme,w,h,theme);try{
   await b.open('http://127.0.0.1:3103/cuenta#pedidos',1800);await b.waitFor(()=>b.evaluate(`!!document.querySelector('.wl-history-card')`),{label:'history'});await b.evidence(out,`${name}-${theme}-history`);
   await b.clickText('Perfil');await b.sleep(400);await b.evidence(out,`${name}-${theme}-profile`);
   await b.clickText('Fidelidad');await b.waitFor(()=>b.evaluate(`!!document.querySelector('.wl-loyalty-dialog[open]')&&document.querySelector('.wl-loyalty-dialog').innerText.includes('Programa no disponible')`),{label:'real loyalty disabled'});await b.evidence(out,`${name}-${theme}-loyalty-disabled`);await click(b,'[aria-label="Cerrar tarjeta"]');
   await b.clickText('Más');await b.clickText('Soporte');await b.waitFor(()=>b.evaluate(`!!document.querySelector('.wl-support')&&!document.querySelector('.wl-support').innerText.includes('Cargando reportes')`),{label:'support real'});
   assert(!await b.evaluate(`document.querySelector('.wl-support').innerText.includes('No se pudieron cargar')`),'real support API');await b.evidence(out,`${name}-${theme}-support`);
   await b.clickText('Reportar un problema');await b.sleep(250);assert(await b.evaluate(`!!document.querySelector('.wl-support dialog[open]')`));await b.evidence(out,`${name}-${theme}-report-form`);await click(b,'[aria-label="Cerrar reporte"]');
   await b.clickText('Más');await b.clickText('Información del restaurante');await b.waitFor(()=>b.evaluate(`document.querySelector('.wl-info-dialog[open]')?.innerText.includes('Calle Ficticia')`));await b.evidence(out,`${name}-${theme}-info`);
   assert(!(await b.evaluate(`document.documentElement.scrollWidth>innerWidth`)));assert.equal(b.exceptions.length,0);assert(!b.requests.some(r=>!['GET','HEAD','OPTIONS'].includes(r.method)));console.log('PASS REAL',name,theme);
  }finally{await b.close();}
 }
 fixture=true;
 for(const theme of ['light','dark']){
  tickets=[];const b=await browser('fixture'+theme,390,844,theme);try{
   await b.open('http://127.0.0.1:3103/cuenta#perfil',1700);await b.clickText('Fidelidad');await b.waitFor(()=>b.evaluate(`document.querySelectorAll('.wl-stamp-grid li').length===8`));assert.equal(await b.evaluate(`document.querySelectorAll('.is-stamped').length`),3);await b.evidence(out,`fixture-${theme}-stamp-card`);await click(b,'[aria-label="Cerrar tarjeta"]');
   await b.clickText('Más');await b.clickText('Soporte');await b.waitFor(()=>b.evaluate(`!!document.querySelector('.wl-support')`));await b.clickText('Reportar un problema');await field(b,'.wl-support dialog select','APP');await field(b,'.wl-support dialog input','Reporte de prueba');await field(b,'.wl-support dialog textarea','Descripción de prueba aislada para revisar la atención del restaurante.');await b.clickText('Enviar al restaurante');await b.waitFor(()=>b.evaluate(`document.querySelector('.wl-report-list').innerText.includes('Reporte de prueba')`));assert.equal(tickets.length,1);await b.evidence(out,`fixture-${theme}-report-sent`);
   const admin=await browser('admin-fixture'+theme,1440,1000,theme,true);try{
    await admin.open('http://127.0.0.1:3102/',2200);await admin.waitFor(()=>admin.evaluate(`document.body.innerText.includes('Reporte de prueba')`),{label:'restaurant inbox'});await admin.evaluate(`document.querySelector('details').open=true`);await field(admin,'textarea','Respuesta del restaurante en prueba aislada.');await field(admin,'details select','RESOLVED');await admin.clickText('Guardar respuesta');await admin.waitFor(()=>admin.evaluate(`document.body.innerText.includes('Respuesta guardada')`));await admin.evidence(out,`fixture-${theme}-restaurant-inbox`);assert.equal(tickets[0].status,'RESOLVED');
    await admin.waitFor(()=>admin.evaluate(`!!document.querySelector('details')`));await admin.evaluate(`document.querySelector('details').open=true`);await admin.evidence(out,`fixture-${theme}-restaurant-inbox-expanded`);
    if(theme==='dark')assert.notEqual(await admin.evaluate(`getComputedStyle(document.querySelector('details')).backgroundColor`),'rgb(255, 255, 255)');
    await admin.send('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:true});await admin.evidence(out,`fixture-${theme}-restaurant-inbox-mobile`);assert(!await admin.evaluate(`document.documentElement.scrollWidth>innerWidth`));assert.equal(await admin.evaluate(`getComputedStyle(document.querySelector('.wl-install-app-banner')).display`),'none');
    await admin.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await admin.clickText('Clientes y fidelidad');await admin.waitFor(()=>admin.evaluate(`document.body.innerText.includes('Compras para completar')`));await admin.evidence(out,`${theme}-restaurant-loyalty-settings`);
    await admin.send('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:true});await admin.evidence(out,`${theme}-restaurant-loyalty-settings-mobile`);assert(!await admin.evaluate(`document.documentElement.scrollWidth>innerWidth`));assert.equal(await admin.evaluate(`getComputedStyle(document.querySelector('.wl-install-app-banner')).display`),'none');
    }finally{await admin.close();}
   await b.clickText('Actualizar');await b.waitFor(()=>b.evaluate(`document.querySelector('.wl-report-list').innerText.includes('Resuelto')`));await b.evaluate(`document.querySelector('.wl-report-item').open=true`);assert(await b.evaluate(`document.querySelector('.wl-report-response').innerText.includes('Respuesta del restaurante')`));await b.evidence(out,`fixture-${theme}-customer-response`);console.log('PASS FIXTURE',theme,'stamp card, submission, restaurant response, customer response; no persisted writes');
  }finally{await b.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
