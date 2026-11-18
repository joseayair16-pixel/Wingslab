// Read-only browser checks; deliberately no screenshots or evidence files.
const {createBrowser}=require('./wingslab-visual-cdp.cjs');
const assert=require('assert/strict'),path=require('path');
const root=path.resolve(__dirname,'..'),run=String(Date.now());
(async()=>{for(const [name,width,height] of [['375',375,812],['390',390,844],['430',430,932],['desktop',1440,1000]])for(const theme of ['light','dark']){
 const b=createBrowser({profileDir:path.join(root,'tmp/auth-profiles',run,name+theme),origins:['http://127.0.0.1:3101','http://127.0.0.1:3103'],width,height});
 try{await b.init();await b.send('Network.setBlockedURLs',{urls:['*socket.io*']});await b.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('wingslab.theme',${JSON.stringify(theme)})`});await b.open('http://127.0.0.1:3103/',1600);await b.waitFor(()=>b.evaluate(`!!document.querySelector('.wl-customer-nav')`));
 await b.evaluate(`document.querySelector('.wl-customer-nav > button:nth-child(2)').click()`);await b.waitFor(()=>b.evaluate(`!!document.querySelector('.wl-auth')`));
 assert(await b.evaluate(`document.querySelector('.wl-auth-brand img').getAttribute('src').includes('wingslab-wordmark')`));assert(!await b.evaluate(`/Pídelo por aquí|SaDeL/i.test(document.querySelector('.wl-auth').innerText)`));assert(await b.evaluate(`document.querySelector('.wl-auth').innerText.includes('Bienvenido a WingsLab')`));
 const centered=await b.evaluate(`(()=>{const r=document.querySelector('.wl-auth-sheet').getBoundingClientRect();return Math.abs(r.left+r.width/2-innerWidth/2)<2&&Math.abs(r.top+r.height/2-innerHeight/2)<2})()`);assert(centered,'centered dialog');
 await b.clickText('Iniciar sesión');assert(await b.evaluate(`!!document.querySelector('input[autocomplete="current-password"]')`));await b.evaluate(`document.querySelector('[aria-label="Mostrar contraseña"]').click()`);assert(await b.evaluate(`!!document.querySelector('input[autocomplete="current-password"][type="text"]')`));assert(await b.clickText('¿Aún no tienes cuenta?',false));await b.waitFor(()=>b.evaluate(`document.querySelectorAll('[role="spinbutton"]').length===3`));
 assert.equal(await b.evaluate(`document.querySelectorAll('[role="spinbutton"]').length`),3);assert(await b.evaluate(`!!document.querySelector('input[placeholder="Escribe tu nombre"]')`));
 for(const [placeholder,value] of [['Escribe tu nombre','Prueba'],['Escribe tus apellidos','Temporal']])await b.evaluate(`(()=>{const e=document.querySelector('input[placeholder="${placeholder}"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 assert(await b.clickText('Continuar'));await b.waitFor(()=>b.evaluate(`!!document.querySelector('input[type="email"]')`));assert(!await b.evaluate(`document.documentElement.scrollWidth>innerWidth`));assert(!b.requests.some(r=>!['GET','HEAD','OPTIONS'].includes(r.method)));console.log('PASS',name,theme,'center, welcome, login, registration and contact, no screenshots or writes');
 }finally{await b.close();}
}})().catch(e=>{console.error(e);process.exitCode=1;});
