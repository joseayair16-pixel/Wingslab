const {createBrowser}=require('./wingslab-visual-cdp.cjs');
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),jwt=require('jsonwebtoken');
const root=path.resolve(__dirname,'..'),run=String(Date.now()),out=path.join(root,'docs/evidence/cart-premium');
const config=JSON.parse(fs.readFileSync(path.join(root,'config/wingslab.local.json')));
const token=jwt.sign({sub:'cmwgvmckq0007s4mlixca3qq9',phone:'5500000001',role:'CUSTOMER'},config.backend.jwtSecret,{expiresIn:'15m'});
async function route(request){assert(['GET','HEAD','OPTIONS'].includes(request.method));const r=await fetch(request.url,{signal:AbortSignal.timeout(10000),headers:Object.fromEntries(Object.entries(request.headers).filter(([k])=>['authorization','accept'].includes(k.toLowerCase())))});return{statusCode:r.status,headers:Object.fromEntries(r.headers),body:Buffer.from(await r.arrayBuffer())};}
(async()=>{for(const [name,width,height] of [['375',375,812],['390',390,844],['430',430,932],['desktop',1440,1000]])for(const theme of ['light','dark']){
 const b=createBrowser({profileDir:path.join(root,'tmp/cart-profiles',run,name+theme),origins:['http://127.0.0.1:3101','http://127.0.0.1:3103'],width,height,route});
 try{
  await b.init();await b.send('Network.setBlockedURLs',{urls:['*socket.io*']});await b.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('wingslab.theme',${JSON.stringify(theme)});localStorage.setItem('sadel.customer.token',${JSON.stringify(token)});localStorage.setItem('sadel.customer.user',JSON.stringify({id:'cmwgvmckq0007s4mlixca3qq9',name:'Cliente',role:'CUSTOMER'}));localStorage.setItem('sadel.customer.apiBase','http://127.0.0.1:3101');`});
  await b.open('http://127.0.0.1:3103/',1800);await b.waitFor(()=>b.evaluate(`!!document.querySelector('#wl_prod_alitas_6 .wl-product-add')`));
  await b.evaluate(`document.querySelector('.wl-official-cart').click()`);await b.waitFor(()=>b.evaluate(`!!document.querySelector('.wl-cart-empty')`));await b.evidence(out,`${name}-${theme}-empty`);
  assert(await b.evaluate(`document.activeElement.getAttribute('aria-label')==='Cerrar carrito'`));await b.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await b.waitFor(()=>b.evaluate(`!document.querySelector('.wl-cart-drawer')`));
  await b.evaluate(`document.querySelector('#wl_prod_alitas_6 .wl-product-add').click()`);await b.sleep(200);await b.evaluate(`document.querySelector('.wl-official-cart').click()`);await b.waitFor(()=>b.evaluate(`!!document.querySelector('.wl-cart-item')`));await b.sleep(600);await b.evidence(out,`${name}-${theme}-filled`);
  const before=await b.evaluate(`document.querySelector('.wl-cart-quantity span').textContent`);await b.evaluate(`document.querySelector('[aria-label^="Agregar una unidad"]').click()`);assert.equal(await b.evaluate(`document.querySelector('.wl-cart-quantity span').textContent`),String(Number(before)+1));await b.evaluate(`document.querySelector('[aria-label^="Quitar una unidad"]').click()`);assert.equal(await b.evaluate(`document.querySelector('.wl-cart-quantity span').textContent`),before);
  assert(!(await b.evaluate(`document.documentElement.scrollWidth>innerWidth`)));await b.clickText('Completar pedido');await b.waitFor(()=>b.evaluate(`!!document.querySelector('.wl-checkout')`));assert(!b.requests.some(r=>!['GET','HEAD','OPTIONS'].includes(r.method)));console.log('PASS',name,theme,'empty, quantity, checkout; no writes');
 }finally{await b.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
