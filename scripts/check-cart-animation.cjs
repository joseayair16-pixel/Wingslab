// No screenshots and no writes to the backend.
const {createBrowser}=require('./wingslab-visual-cdp.cjs');
const assert=require('assert/strict'),path=require('path');
const root=path.resolve(__dirname,'..'),run=String(Date.now());
(async()=>{for(const theme of ['light','dark'])for(const reduced of [false,true]){
 const b=createBrowser({profileDir:path.join(root,'tmp/cart-animation-profiles',run,theme+reduced),origins:['http://127.0.0.1:3101','http://127.0.0.1:3103'],width:390,height:844});
 try{await b.init();await b.send('Network.setBlockedURLs',{urls:['*socket.io*']});await b.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:reduced?'reduce':'no-preference'}]});await b.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('wingslab.theme',${JSON.stringify(theme)})`});await b.open('http://127.0.0.1:3103/',1800);await b.waitFor(()=>b.evaluate(`!!document.querySelector('#wl_prod_alitas_6 .wl-product-add')`));
 await b.evaluate(`document.querySelector('#wl_prod_alitas_6 .wl-product-add').click()`);await b.waitFor(()=>b.evaluate(`document.querySelector('.wl-official-cart').getAttribute('aria-label').includes('1 producto')`));
 if(reduced)assert.equal(await b.evaluate(`document.querySelectorAll('.wl-cart-flying').length`),0);else{assert.equal(await b.evaluate(`document.querySelectorAll('.wl-cart-flying').length`),1);await b.sleep(750);assert(await b.evaluate(`document.querySelector('.wl-official-cart').getAnimations().length>0`));await b.sleep(600);assert.equal(await b.evaluate(`document.querySelectorAll('.wl-cart-flying').length`),0);}
 assert.equal(await b.evaluate(`document.querySelector('.wl-cart-count').textContent`),'1');assert(!b.requests.some(r=>!['GET','HEAD','OPTIONS'].includes(r.method)));console.log('PASS',theme,reduced?'reduced motion':'flight and blink');
 }finally{await b.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
