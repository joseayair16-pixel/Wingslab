// Read-only browser checks. Fixtures, when enabled, exist only in intercepted responses.
const { createBrowser } = require('./wingslab-visual-cdp.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'docs/evidence/customer-reference');
const runId = String(Date.now());
const sizes = [['375',375,812], ['390',390,844], ['430',430,932], ['desktop',1440,1000]];
const json = data => ({statusCode:200, headers:{'content-type':'application/json'},body:JSON.stringify(data)});
async function readOnly(request) {
  if (!['GET','HEAD','OPTIONS'].includes(request.method)) return {statusCode:403,headers:{},body:'Visual checks prohibit writes'};
  const result = await fetch(request.url, {signal:AbortSignal.timeout(10000)});
  return {statusCode:result.status,headers:Object.fromEntries(result.headers),body:Buffer.from(await result.arrayBuffer())};
}
async function main() {
  const report = [];
  for (const [name,width,height] of sizes) for (const theme of ['light','dark']) {
    const b = createBrowser({profileDir:path.join(root,'tmp/reference-profiles',runId,`${name}-${theme}`),width,height,origins:['http://127.0.0.1:3103','http://127.0.0.1:3101'],route:readOnly});
    try {
      await b.init();
      await b.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('wingslab.theme', '${theme}');`});
      await b.open('http://127.0.0.1:3103/',2200);
      await b.waitFor(()=>b.evaluate(`!!document.getElementById('wl_prod_alitas_6')`),{label:'real menu'});
      const layout = await b.evaluate(`(()=>{const header=document.querySelector('.wl-header'),grid=document.querySelector('.wl-products-grid'),cards=[...grid.querySelectorAll('[data-wl-product]')],logo=document.querySelector('.wl-official-logo img');return {overflow:document.documentElement.scrollWidth>innerWidth,header:getComputedStyle(header).backgroundColor,logoLoaded:logo.complete&&logo.naturalWidth>0,columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,card:cards[0].getBoundingClientRect().toJSON(),image:cards[0].firstElementChild.firstElementChild.getBoundingClientRect().toJSON(),nav:[...document.querySelectorAll('.wl-capsule-nav button')].map(e=>e.textContent),dark:document.documentElement.classList.contains('dark')}})()`);
      assert(!layout.overflow,'horizontal overflow');
      assert(layout.logoLoaded,'official logo failed to load');
      assert.equal(layout.header,'rgb(242, 13, 18)');
      assert.equal(layout.columns,width<768?2:3);
      assert.equal(layout.dark,theme==='dark');
      assert.deepEqual(layout.nav,['Inicio','Pedidos','Promos','Cuenta','Más']);
      assert(layout.image.width>layout.card.width*.95,'photo must span card width');
      await b.evidence(output,`${name}-${theme}`);
      await b.evaluate(`document.querySelector('#wl_prod_alitas_6 .wl-product-add').click()`);
      await b.waitFor(()=>b.evaluate(`document.querySelector('.wl-cart-count').textContent==='1'`),{label:'real cart counter'});
      await b.evaluate(`document.querySelector('.wl-official-cart').click()`);
      await b.waitFor(()=>b.evaluate(`!!document.querySelector('.wl-cart-drawer')&&getComputedStyle(document.querySelector('.wl-cart-drawer')).visibility!=='hidden'`),{label:'visible cart'});
      await b.sleep(550);
      assert(await b.evaluate(`(()=>{const e=document.querySelector('.wl-cart-drawer'),r=e.getBoundingClientRect();return r.left>=0&&r.left<innerWidth&&r.top<innerHeight&&getComputedStyle(e).pointerEvents!=='none'})()`));
      await b.evidence(output,`${name}-${theme}-cart`);
      assert(await b.clickText('Completar pedido'));
      await b.waitFor(()=>b.evaluate(`!!document.querySelector('.wl-auth[aria-modal="true"]')`),{label:'checkout authentication guard'});
      await b.evaluate(`document.querySelector('[aria-label="Cerrar modal de autenticación"]').click()`);
      await b.sleep(350);
      assert(await b.clickText('Más'));
      assert(await b.evaluate(`document.querySelector('.wl-more-dialog').open`));
      await b.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      await b.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      await b.sleep(100);assert(!(await b.evaluate(`document.querySelector('.wl-more-dialog').open`)));
      assert(await b.clickText('Más'));
      assert(await b.clickText('Buscar en el menú'));
      await b.evaluate(`(()=>{const e=document.querySelector('[aria-label="Buscar productos en el menú"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'papas');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await b.sleep(350);
      assert.equal(await b.evaluate(`document.querySelectorAll('.wl-products-grid [data-wl-product]').length`),1);
      await b.evaluate(`window.scrollTo(0,document.documentElement.scrollHeight)`);await b.sleep(300);
      assert(await b.evaluate(`document.querySelector('.wl-products-grid [data-wl-product]').getBoundingClientRect().bottom<document.querySelector('.wl-capsule-nav').getBoundingClientRect().top`),'bottom padding must clear navigation');
      if(name==='390'&&theme==='light'){
        await b.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});
        assert(!(await b.evaluate(`document.documentElement.classList.contains('dark')`)),'persisted light must override system');
        await b.evaluate(`localStorage.setItem('wingslab.theme','system');window.dispatchEvent(new CustomEvent('wingslab:theme',{detail:'system'}))`);
        assert(await b.evaluate(`document.documentElement.classList.contains('dark')`));
        await b.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});await b.sleep(100);
        assert(!(await b.evaluate(`document.documentElement.classList.contains('dark')`)));
      }
      assert.equal(b.exceptions.length,0,'browser exceptions');
      assert(!b.requests.some(r=>!['GET','HEAD','OPTIONS'].includes(r.method)),'write request attempted');
      report.push({viewport:[width,height],theme,layout,checks:['real catalogue','logo','grid','header','no overflow','cart add/counter/open','More native dialog','search','no writes']});
      console.log('PASS',name,theme);
    } finally { await b.close(); }
  }
  fs.writeFileSync(path.join(output,'checks.json'),JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
