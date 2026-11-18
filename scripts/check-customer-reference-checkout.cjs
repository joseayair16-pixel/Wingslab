// Existing read-only customer JWT: no login/session creation and no order submission.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createBrowser}=require('./wingslab-visual-cdp.cjs');
const jwt=require('jsonwebtoken'),root=path.resolve(__dirname,'..'),run=String(Date.now());
const config=JSON.parse(fs.readFileSync(path.join(root,'config/wingslab.local.json')));
const token=jwt.sign({sub:'cmwgvmckq0007s4mlixca3qq9',phone:'5500000001',role:'CUSTOMER'},config.backend.jwtSecret,{expiresIn:'10m'});
async function route(request){
  assert(['GET','HEAD','OPTIONS'].includes(request.method),'No writes authorized');
  const r=await fetch(request.url,{signal:AbortSignal.timeout(10000),headers:Object.fromEntries(Object.entries(request.headers).filter(([key])=>['authorization','accept'].includes(key.toLowerCase())))});
  return{statusCode:r.status,headers:Object.fromEntries(r.headers),body:Buffer.from(await r.arrayBuffer())};
}
(async()=>{
  for(const [name,width,height] of [['375',375,812],['390',390,844],['430',430,932],['desktop',1440,1000]])for(const theme of ['light','dark']){
    const b=createBrowser({profileDir:path.join(root,'tmp/reference-profiles',run,`checkout-${name}-${theme}`),origins:['http://127.0.0.1:3101','http://127.0.0.1:3103'],width,height,route});
    try{
      await b.init();await b.send('Network.setBlockedURLs',{urls:['*socket.io*']});
      await b.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('wingslab.theme',${JSON.stringify(theme)});localStorage.setItem('sadel.customer.token',${JSON.stringify(token)});localStorage.setItem('sadel.customer.user',JSON.stringify({id:'cmwgvmckq0007s4mlixca3qq9',name:'Cliente',role:'CUSTOMER'}));localStorage.setItem('sadel.customer.apiBase','http://127.0.0.1:3101');`});
      await b.open('http://127.0.0.1:3103/',2200);
      await b.waitFor(()=>b.evaluate(`!!document.querySelector('#wl_prod_alitas_6 .wl-product-add')`),{label:'catalogue'});
      await b.evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Saltar');if(e)e.click()})()`);
      await b.evaluate(`document.querySelector('#wl_prod_alitas_6 .wl-product-add').click()`);await b.sleep(250);
      await b.evaluate(`document.querySelector('.wl-official-cart').click()`);await b.sleep(550);
      assert(await b.clickText('Completar pedido'));await b.sleep(700);
      assert(await b.evaluate(`(()=>{const e=document.querySelector('.wl-checkout'),r=e.getBoundingClientRect();return getComputedStyle(e.parentElement).pointerEvents!=='none'&&r.left>=0&&r.left<innerWidth&&r.top<innerHeight&&r.bottom>0})()`),'checkout must actually be visible');
      assert(!(await b.evaluate(`document.documentElement.scrollWidth>innerWidth`)));
      await b.evidence(path.join(root,'docs/evidence/customer-reference'),`${name}-${theme}-checkout-readonly`);
      assert(!b.requests.some(r=>!['GET','HEAD','OPTIONS'].includes(r.method)),'write request attempted');
      console.log('PASS CHECKOUT',name,theme,'read only, no order submitted');
    }finally{await b.close();}
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
