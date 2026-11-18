const {createBrowser}=require('./wingslab-visual-cdp.cjs');
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),jwt=require('jsonwebtoken');
const root=path.resolve(__dirname,'..'),out=path.join(root,'docs/evidence/customer-navigation'),run=String(Date.now());
const config=JSON.parse(fs.readFileSync(path.join(root,'config/wingslab.local.json')));
const token=jwt.sign({sub:'cmwgvmckq0007s4mlixca3qq9',phone:'5500000001',role:'CUSTOMER'},config.backend.jwtSecret,{expiresIn:'10m'});
async function route(request){
  if(!['GET','HEAD','OPTIONS'].includes(request.method))return{statusCode:403,headers:{},body:'No writes'};
  const r=await fetch(request.url,{method:request.method,signal:AbortSignal.timeout(10000),headers:Object.fromEntries(Object.entries(request.headers).filter(([k])=>['authorization','accept','origin','access-control-request-method','access-control-request-headers'].includes(k.toLowerCase())))});
  return{statusCode:r.status,headers:Object.fromEntries(r.headers),body:Buffer.from(await r.arrayBuffer())};
}
async function click(b,selector){assert(await b.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.click();return true})()`),selector);}
(async()=>{
  for(const [name,width,height] of [['375',375,812],['390',390,844],['430',430,932],['desktop',1440,1000]])for(const theme of ['light','dark']){
    const b=createBrowser({profileDir:path.join(root,'tmp/navigation-profiles',run,name+theme),width,height,origins:['http://127.0.0.1:3103','http://127.0.0.1:3101'],route});
    try{
      await b.init();await b.send('Network.setBlockedURLs',{urls:['*socket.io*']});
      await b.send('Page.addScriptToEvaluateOnNewDocument',{source:`if(!localStorage.getItem('wingslab.theme'))localStorage.setItem('wingslab.theme',${JSON.stringify(theme)});localStorage.setItem('sadel.customer.token',${JSON.stringify(token)});localStorage.setItem('sadel.customer.user',JSON.stringify({id:'cmwgvmckq0007s4mlixca3qq9',name:'Cliente',role:'CUSTOMER'}));localStorage.setItem('sadel.customer.apiBase','http://127.0.0.1:3101');`});
      await b.open('http://127.0.0.1:3103/',2200);await b.waitFor(()=>b.evaluate(`!!document.querySelector('.wl-customer-nav')`),{label:'navigation'});
      await b.evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Saltar');if(e)e.click()})()`);
      assert.deepEqual(await b.evaluate(`[...document.querySelectorAll('.wl-customer-nav > button')].map(e=>e.textContent)`),['Inicio','Pedidos','Fidelidad','Perfil','Más']);
      assert(!(await b.evaluate(`document.documentElement.scrollWidth>innerWidth`)));
      assert(await b.clickText('Más'));await b.waitFor(()=>b.evaluate(`!!document.querySelector('.wl-more-popover')`));
      await b.sleep(350);
      assert.deepEqual(await b.evaluate(`[...document.querySelectorAll('.wl-more-popover button')].map(e=>e.textContent.trim())`),['Información del restaurante','Soporte','Modo oscuro']);
      const rect=await b.evaluate(`(()=>{let a=document.querySelector('.wl-more-popover').getBoundingClientRect(),b=document.querySelector('.wl-customer-nav').getBoundingClientRect();return {left:a.left,right:a.right,top:a.top,bottom:a.bottom,navTop:b.top}})()`);
      assert(rect.left>=0&&rect.right<=width&&rect.top>=0&&rect.bottom<=rect.navTop);
      assert(await b.evaluate(`document.activeElement.textContent.includes('Información del restaurante')`));
      await b.evidence(out,`${name}-${theme}-more`);
      await b.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await b.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      assert(await b.evaluate(`!document.querySelector('.wl-more-popover')&&document.activeElement.textContent==='Más'`));
      await b.clickText('Más');
      await b.send('Input.dispatchMouseEvent',{type:'mousePressed',x:5,y:60,button:'left',clickCount:1});await b.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:5,y:60,button:'left',clickCount:1});
      assert(!(await b.evaluate(`!!document.querySelector('.wl-more-popover')`)),'outside click');
      await b.clickText('Más');await b.clickText('Información del restaurante');
      try { await b.waitFor(()=>b.evaluate(`!!document.querySelector('.wl-info-dialog[open]')&&document.querySelector('.wl-info-dialog').innerText.includes('Calle Ficticia 100')`),{label:'backend info'}); } catch(e) { await b.evidence(out,'debug-info'); console.log('DEBUG',JSON.stringify(b.requests.slice(-12))); throw e; }
      assert(await b.evaluate(`document.querySelector('.wl-info-dialog').innerText.includes('5500000001')`));
      await b.evidence(out,`${name}-${theme}-info`);await click(b,'.wl-info-dialog button[aria-label="Cerrar"]');
      await b.clickText('Más');await b.clickText('Soporte');await b.waitFor(()=>b.evaluate(`!!document.querySelector('.wl-info-dialog[open]')&&document.querySelector('.wl-info-dialog').innerText.includes('Ver mis pedidos')`));
      await click(b,'.wl-info-dialog button[aria-label="Cerrar"]');
      await b.clickText('Más');await click(b,'.wl-more-popover [role="switch"]');
      assert.equal(await b.evaluate(`document.documentElement.classList.contains('dark')`),theme!=='dark');
      assert.equal(await b.evaluate(`localStorage.getItem('wingslab.theme')`),theme==='dark'?'light':'dark');
      await b.send('Page.reload');await b.sleep(2000);
      assert.equal(await b.evaluate(`document.documentElement.classList.contains('dark')`),theme!=='dark','theme persists after reload');
      await b.evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Saltar');if(e)e.click()})()`);
      await b.clickText('Fidelidad');await b.waitFor(()=>b.evaluate(`location.hash==='#fidelidad'&&document.querySelector('h1')?.textContent.includes('Fidelidad')`));
      await b.waitFor(()=>b.evaluate(`document.body.innerText.includes('Programa no disponible')||document.body.innerText.includes('puntos')||document.body.innerText.includes('No se pudo consultar el programa')`),{label:'loyalty real response'});
      await b.sleep(800);
      assert.equal(await b.evaluate(`document.documentElement.classList.contains('dark')`),theme!=='dark','theme remains applied after navigation');
      assert.equal(await b.evaluate(`getComputedStyle(document.documentElement).filter`),'none','theme must never invert the page');
      console.log('THEME',name,theme,JSON.stringify(await b.evaluate(`({classes:document.documentElement.className,background:getComputedStyle(document.querySelector('.wl-account')).backgroundColor,filter:getComputedStyle(document.documentElement).filter,html:getComputedStyle(document.documentElement).getPropertyValue('--wl-background')})`)));
      await b.evidence(out,`${name}-${theme}-loyalty`);
      await b.clickText('Perfil');await b.waitFor(()=>b.evaluate(`location.hash==='#perfil'&&document.querySelector('h1')?.textContent.includes('perfil')`));
      assert(await b.evaluate(`document.querySelector('.wl-theme-options [aria-pressed="true"]').textContent===${JSON.stringify(theme==='dark'?'Claro':'Oscuro')}`));
      await b.clickText('Pedidos');await b.waitFor(()=>b.evaluate(`location.hash==='#pedidos'&&document.querySelector('h1')?.textContent.includes('pedidos')`));
      await b.waitFor(()=>b.evaluate(`!!document.querySelector('.wl-order-history')`),{label:'order history'});
      await b.clickText('Inicio');await b.waitFor(()=>b.evaluate(`location.pathname==='/'&&!!document.querySelector('.wl-storefront')`));
      assert(!b.requests.some(r=>!['GET','HEAD','OPTIONS'].includes(r.method)),'write attempted');
      assert.equal(b.exceptions.length,0);
      console.log('PASS',name,theme);
    }finally{await b.close();}
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
