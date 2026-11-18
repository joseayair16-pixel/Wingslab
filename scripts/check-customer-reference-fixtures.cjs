// Isolated content/layout and option tests. NEVER persists fixture records.
const {createBrowser}=require('./wingslab-visual-cdp.cjs');
const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'docs/evidence/customer-reference');
const runId=String(Date.now());
const json=data=>({statusCode:200,headers:{'content-type':'application/json'},body:JSON.stringify(data)});
async function main(){
  require('node:child_process').execFileSync('python3',['-c',`from PIL import Image
from pathlib import Path
p=Path('tmp/reference-fixtures');p.mkdir(parents=True,exist_ok=True)
im=Image.open('docs/referencia visual 1.png')
im.crop((29,163,913,477)).save(p/'banner.png')
im.crop((34,1057,457,1125)).save(p/'product.png')
`],{cwd:root});
  const source=await (await fetch('http://127.0.0.1:3101/menu')).json();
  const menu=structuredClone(source), base=menu.data.categories[0].products[0];
  const products=Array.from({length:4},(_,index)=>({...base,id:`fixture-product-${index}`,name:`Producto de prueba ${index+1}`,description:'Contenido de prueba aislada',price:120+index*10,discountPrice:index<3?108+index*10:null,image:'http://127.0.0.1:3101/public/menu-images/fixture-product',images:[],optionGroups:index===0?[{id:'fixture-group',name:'Salsa de prueba',minSelection:1,maxSelection:1,options:[{id:'fixture-option',name:'Opción de prueba',price:5,isAvailable:true}]}]:[]}));
  menu.data.categories=['Alitas','Hamburguesas','Papas','Boneless','Hot Dogs','Bebidas'].map((name,index)=>({...menu.data.categories[0],id:`fixture-category-${index}`,name,products:index===0?products:[{...base,id:`fixture-extra-${index}`,name:`Prueba ${name}`,image:'http://127.0.0.1:3101/public/menu-images/fixture-product',images:[],trackStock:index===5,stock:index===5?0:999,isAvailable:index!==4}]}));
  const mutations=[];
  let mode='rich';
  const route=async request=>{
    if(!['GET','HEAD','OPTIONS'].includes(request.method)){mutations.push(request.method);return{statusCode:403,headers:{},body:'Writes prohibited'};}
    const url=new URL(request.url);url.pathname=url.pathname.replace(/^\/api(?=\/)/,'');
    if(url.pathname==='/menu'){
      if(mode==='error')return{statusCode:503,headers:{'content-type':'application/json'},body:JSON.stringify({success:false,message:'Error de prueba aislada'})};
      if(mode==='loading')await new Promise(resolve=>setTimeout(resolve,2200));
      return json(mode==='empty'?{...menu,data:{...menu.data,categories:[]}}:menu);
    }
    if(url.pathname==='/public/menu-content')return json({success:true,data:[0,1].map(index=>({id:`fixture-banner-${index}`,kind:'banner',title:'Banner de prueba aislada',text:'',imageId:'fixture-banner',targetUrl:'/#fixture-category-0',buttonLabel:'',frequency:'session',startsAt:null,endsAt:null}))});
    if(url.pathname.startsWith('/public/menu-images/fixture-'))return{statusCode:200,headers:{'content-type':'image/png'},body:fs.readFileSync(path.join(root,'tmp/reference-fixtures',url.pathname.endsWith('banner')?'banner.png':'product.png'))};
    const response=await fetch(request.url,{signal:AbortSignal.timeout(10000)});return{statusCode:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())};
  };
  for(const theme of ['light','dark']){
    const b=createBrowser({profileDir:path.join(root,'tmp/reference-profiles',runId,`fixture-${theme}`),origins:['http://127.0.0.1:3103','http://127.0.0.1:3101'],width:390,height:844,route});
    try{
      await b.init();await b.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('wingslab.theme','${theme}');`});
      await b.open('http://127.0.0.1:3103/',2000);
      await b.waitFor(()=>b.evaluate(`!!document.getElementById('fixture-product-0')`),{label:'fixture menu'});
      assert.equal(await b.evaluate(`document.querySelectorAll('.wl-featured-card').length`),3);
      assert.equal(await b.evaluate(`document.querySelectorAll('[data-category-id]').length`),6);
      assert(await b.evaluate(`[...document.querySelectorAll('.wl-banner-slide img')].every(e=>e.complete&&e.naturalWidth>0)`));
      await b.evidence(out,`fixture-390-${theme}-NOT-REAL-CONTENT`);
      await b.evaluate(`document.querySelectorAll('.wl-banner-dots button')[1].click()`);await b.sleep(700);
      assert.equal(await b.evaluate(`document.querySelectorAll('.wl-banner-dots button')[1].getAttribute('aria-current')`),'true');
      await b.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
      await b.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:80,y:120,id:1}]});
      for(const x of [130,190,250,330]){await b.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:120,id:1}]});await b.sleep(45);}
      await b.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await b.sleep(800);
      assert.equal(await b.evaluate(`document.querySelectorAll('.wl-banner-dots button')[0].getAttribute('aria-current')`),'true','touch swipe must change banner');
      await b.evaluate(`document.querySelector('#fixture-product-0 .wl-product-add').click()`);
      await b.waitFor(()=>b.evaluate(`!!document.querySelector('.wl-customize')`),{label:'required options'});
      const add=`[...document.querySelectorAll('.wl-customize button')].find(e=>/Agregar al carrito|Elige las opciones obligatorias/.test(e.textContent))`;
      assert(await b.evaluate(`${add}.disabled`),'mandatory option must prevent adding');
      assert(await b.clickText('Opción de prueba',false));await b.sleep(200);
      assert(!(await b.evaluate(`${add}.disabled`)));
      await b.evidence(out,`fixture-390-${theme}-options`);
      await b.evaluate(`${add}.click()`);await b.sleep(300);
      console.log('FIXTURE added required options',theme);
      assert.equal(await b.evaluate(`document.querySelector('.wl-cart-count').textContent`),'1');
      await b.evaluate(`document.querySelector('[data-category-id="fixture-category-4"]').click()`);await b.sleep(700);
      assert(await b.evaluate(`document.querySelector('#fixture-extra-4 .wl-product-add').disabled`),'unavailable product');
      await b.evaluate(`document.querySelector('[data-category-id="fixture-category-5"]').click()`);await b.sleep(700);
      assert(await b.evaluate(`document.querySelector('#fixture-extra-5 .wl-product-add').disabled`),'out of stock');
      assert(!(await b.evaluate(`document.documentElement.scrollWidth>innerWidth`)));
      await b.evaluate(`document.querySelector('#wl-featured .wl-section-heading button').click()`);await b.sleep(700);
      assert(await b.evaluate(`!!document.getElementById('__promotions__')`));
      await b.clickText('Inicio');await b.sleep(700);
      assert(await b.evaluate(`!!document.getElementById('fixture-category-0')`));
      console.log('FIXTURE stock and navigation',theme);
      assert.equal(mutations.length,0);assert.equal(b.exceptions.length,0);
      console.log('PASS FIXTURE',theme,'banners/dots/categories/mandatory options/stock/promos/home; NO PERSISTED DATA');
    }finally{await b.close();}
  }
  for(const scenario of ['empty','error','loading']){
    mode=scenario;
    const b=createBrowser({profileDir:path.join(root,'tmp/reference-profiles',runId,scenario),origins:['http://127.0.0.1:3103','http://127.0.0.1:3101'],width:390,height:844,route});
    try{
      await b.init();await b.open('http://127.0.0.1:3103/',scenario==='loading'?0:1000);
      if(scenario==='empty')await b.waitFor(()=>b.evaluate(`document.body.innerText.includes('Estamos preparando el menú')`),{label:'empty state'});
      if(scenario==='error')await b.waitFor(()=>b.evaluate(`[...document.querySelectorAll('button')].some(e=>e.textContent==='Reintentar')`),{label:'error state'});
      if(scenario==='loading')assert(await b.evaluate(`!!document.querySelector('.wl-menu-loading')`));
      await b.evidence(out,`fixture-${scenario}`);
      if(scenario==='loading')await b.waitFor(()=>b.evaluate(`!!document.getElementById('fixture-product-0')`),{label:'loading recovery'});
      console.log('PASS STATE',scenario,'NO PERSISTED DATA');
    }finally{await b.close();}
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
