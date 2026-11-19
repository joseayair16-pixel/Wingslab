// Verificación local de la pantalla de carga oficial WingsLab.
// Sin mutaciones: navega, mide y captura. Reutiliza el harness CDP existente.
const fs = require('node:fs');
const path = require('node:path');
const { createBrowser } = require('./wingslab-visual-cdp.cjs');

const OUT = path.join(__dirname, '..', 'tmp', 'evidencia-splash');
const URL = 'http://127.0.0.1:3103/';

async function settle(browser, width, height, mobile, colorScheme, reduced) {
  await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  await browser.send('Emulation.setEmulatedMedia', { features: [
    { name: 'prefers-color-scheme', value: colorScheme },
    { name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' },
  ] });
}

async function measure(browser, label, width, height, mobile, colorScheme, reduced = false) {
  await settle(browser, width, height, mobile, colorScheme, reduced);
  const t0 = Date.now();
  browser.send('Page.navigate', { url: URL + '?splash=' + label + '&t=' + Date.now() }).catch(() => {});
  await browser.waitFor(() => browser.evaluate(`document.readyState==='complete' && location.host==='127.0.0.1:3103'`), { timeout: 15000, interval: 60, label: 'load ' + label });
  const loadMs = Date.now() - t0;

  const early = await browser.evaluate(`(()=>{const s=document.querySelector('[data-testid=wl-splash]');const cs=s?getComputedStyle(s):null;const img=s?s.querySelector('img'):null;const sp=s?s.querySelector('.wl-splash-spinner'):null;return {present:!!s,bg:cs?cs.backgroundColor:null,logo:img?{src:img.getAttribute('src'),opacity:getComputedStyle(img).opacity}:null,spinner:sp?{border:getComputedStyle(sp).borderTopColor,animation:getComputedStyle(sp).animationName}:null,htmlBooting:document.documentElement.classList.contains('wl-booting'),bodyBg:getComputedStyle(document.body).backgroundColor}})()`);

  fs.mkdirSync(OUT, { recursive: true });
  try {
    const shot = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: false });
    fs.writeFileSync(path.join(OUT, label + '-durante.png'), Buffer.from(shot.data, 'base64'));
  } catch (e) { console.log('capture error', label, e.message); }

  await browser.waitFor(() => browser.evaluate(`!document.querySelector('[data-testid=wl-splash]')`), { timeout: 12000, interval: 30, label: 'splash gone ' + label });
  const totalMs = Date.now() - t0;
  const after = await browser.evaluate(`({booting:document.documentElement.classList.contains('wl-booting'),menu:!!document.querySelector('.wl-menu'),status:document.querySelector('.wl-header-status')?.innerText||null,text:document.body.innerText.slice(0,80)})`);
  const result = { label, loadMs, splashVisibleMs: totalMs, early, after };
  console.log('RESULT', JSON.stringify(result));
  return result;
}

async function main() {
  const browser = createBrowser({ profileDir: path.join(OUT, 'profile'), origins: ['http://127.0.0.1:3103', 'http://127.0.0.1:3101'] });
  await browser.init();
  const results = [];
  results.push(await measure(browser, 'movil-claro', 390, 844, true, 'light'));
  results.push(await measure(browser, 'movil-oscuro', 390, 844, true, 'dark'));
  results.push(await measure(browser, 'escritorio-claro', 1440, 900, false, 'light'));
  results.push(await measure(browser, 'movil-reduced-motion', 390, 844, true, 'light', true));
  fs.writeFileSync(path.join(OUT, 'resultados.json'), JSON.stringify(results, null, 2));
  await browser.close();
  console.log('OK', results.length);
}
main().catch(e => { console.error('ERROR', e); process.exit(1); });
