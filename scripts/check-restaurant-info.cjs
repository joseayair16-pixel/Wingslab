// Read-only layout and real menu data checks; no screenshots.
const {createBrowser}=require('./wingslab-visual-cdp.cjs');
const path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..'),run=String(Date.now());
(async()=>{const response=await fetch('http://127.0.0.1:3101/menu');assert(response.ok);const {data}=await response.json();
for(const [name,width,height] of [['375',375,812],['390',390,844],['430',430,932],['desktop',1440,1000]])for(const theme of ['light','dark']){
 const b=createBrowser({profileDir:path.join(root,'tmp/info-profiles',run,name+theme),origins:['http://127.0.0.1:3101','http://127.0.0.1:3103'],width,height});
 try{await b.init();await b.send('Network.setBlockedURLs',{urls:['*socket.io*']});await b.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('wingslab.theme',${JSON.stringify(theme)})`});await b.open('http://127.0.0.1:3103/',1600);await b.waitFor(()=>b.evaluate(`!!document.querySelector('.wl-customer-nav')`));
 await b.clickText('Más');await b.clickText('Información del restaurante');await b.waitFor(()=>b.evaluate(`!!document.querySelector('.wl-info-identity')`));
 const info=await b.evaluate(`(()=>{const d=document.querySelector('.wl-info-dialog'),r=d.getBoundingClientRect();return {text:d.innerText,x:r.left+r.width/2,y:r.top+r.height/2,width:r.width,height:r.height,logo:[...d.querySelectorAll('.wl-info-identity img')].find(i=>getComputedStyle(i).display!=='none')?.getAttribute('src')}})()`);
 assert(Math.abs(info.x-width/2)<2&&Math.abs(info.y-height/2)<2,'dialog centered');assert(info.width<=width-30&&info.height<=height);assert(info.logo.includes(theme==='light'?'wordmark-red':'wordmark.'));if(data.address)assert(info.text.includes(data.address));if(data.operatingHours?.length)assert(info.text.includes('Horarios'));if(data.acceptedPaymentMethods?.length)assert(info.text.includes('Métodos de pago'));assert(info.text.includes(data.isOpen?'Abierto':'Cerrado'));assert(!info.text.includes('Contacto'));if(data.contactPhone)assert(!info.text.includes(data.contactPhone));if(data.email)assert(!info.text.includes(data.email));
 await b.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await b.waitFor(()=>b.evaluate(`!document.querySelector('.wl-info-dialog[open]')`));assert(!b.requests.some(r=>!['GET','HEAD','OPTIONS'].includes(r.method)));console.log('PASS',name,theme,'centered, real data, logo and Escape');
 }finally{await b.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
