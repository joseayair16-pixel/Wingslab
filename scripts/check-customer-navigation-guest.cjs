const {createBrowser}=require('./wingslab-visual-cdp.cjs');
const assert=require('assert/strict'),path=require('path');
const root=path.resolve(__dirname,'..');
async function tap(b,selector){const p=await b.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await b.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1}]});await b.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
(async()=>{
  const b=createBrowser({profileDir:path.join(root,'tmp/navigation-profiles',String(Date.now()),'guest'),width:375,height:812,origins:['http://127.0.0.1:3101','http://127.0.0.1:3103']});
  try{
    await b.init();await b.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
    await b.open('http://127.0.0.1:3103/',2200);await b.waitFor(()=>b.evaluate(`!!document.querySelector('.wl-customer-nav')`));
    for(const selector of ['.wl-customer-nav > button:nth-child(2)','.wl-customer-nav > button:nth-child(3)','.wl-customer-nav > button:nth-child(4)']){
      await tap(b,selector);await b.waitFor(()=>b.evaluate(`!!document.querySelector('.wl-auth[role="dialog"]')`));
      await b.evaluate(`document.querySelector('[aria-label="Cerrar modal de autenticación"]').click()`);await b.waitFor(()=>b.evaluate(`!document.querySelector('.wl-auth')`));
    }
    await tap(b,'.wl-customer-nav > button:last-of-type');await b.waitFor(()=>b.evaluate(`!!document.querySelector('.wl-more-popover')`));
    await tap(b,'.wl-more-popover button:nth-child(2)');await b.waitFor(()=>b.evaluate(`!!document.querySelector('.wl-auth[role="dialog"]')`));
    await b.evaluate(`document.querySelector('[aria-label="Cerrar modal de autenticación"]').click()`);await b.waitFor(()=>b.evaluate(`!document.querySelector('.wl-auth')`));
    const status=await b.evaluate(`document.querySelector('.wl-header-status').innerText`);assert(['Abierto','Cerrado'].includes(status));
    const response=await fetch('http://127.0.0.1:3101/menu');const menu=await response.json();assert.equal(status,menu.data.isOpen?'Abierto':'Cerrado');
    for(const [name,width,height] of [['375',375,812],['390',390,844],['430',430,932],['desktop',1440,1000]]){
      await b.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<768});
      const bounds=await b.evaluate(`(()=>{const status=document.querySelector('.wl-header-status').getBoundingClientRect(),logo=document.querySelector('.wl-official-logo').getBoundingClientRect(),cart=document.querySelector('.wl-official-cart').getBoundingClientRect();return {statusRight:status.right,logoLeft:logo.left,logoRight:logo.right,cartLeft:cart.left}})()`);
      assert(bounds.statusRight<=bounds.logoLeft&&bounds.logoRight<=bounds.cartLeft,`header overlap at ${name}`);
      await b.evidence(path.join(root,'docs/evidence/customer-header'),name);
    }
    assert(!(await b.evaluate(`document.documentElement.scrollWidth>innerWidth`)));
    assert(!b.requests.some(r=>!['GET','HEAD','OPTIONS'].includes(r.method)));
    console.log('PASS guest touch, support, orders and loyalty authentication');
  }finally{await b.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
