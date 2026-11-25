// Local, interactive browser diagnostic. No storage state, traces or screenshots.
const { createInterface } = require('node:readline/promises');
const { randomUUID } = require('node:crypto');
const { readLocalConfiguration } = require('../config/wingslab.cjs');

const origin = 'http://127.0.0.1:3103';
const fixture = `${origin}/__mp_fields_diagnostic`;
const fields = {
  cardNumber: 'wl-mp-card-number',
  expirationDate: 'wl-mp-expiration',
  securityCode: 'wl-mp-security-code',
};

function baseline(key) {
  const ids = { cardholderName: 'name', cardholderEmail: 'email', issuer: 'issuer',
    installments: 'installments', identificationType: 'doc-type', identificationNumber: 'doc', ...fields };
  const form = Object.fromEntries(Object.entries(ids).map(([name, id]) => [name, { id }]));
  return `<!doctype html><meta charset="utf-8"><title>Secure Fields: prueba sin envío</title>
    <form id="wl-mp-card-form"><input id="name" autocomplete="cc-name"><input id="email" type="email">
    ${Object.values(fields).map(id => `<div id="${id}" style="width:300px;height:54px;border:1px solid"></div>`).join('')}
    <select id="issuer"></select><select id="installments"></select><select id="doc-type"></select><input id="doc"></form>
    <script src="https://sdk.mercadopago.com/js/v2"></script><script>
    window.mpStages = [];
    document.querySelector('form').addEventListener('submit', e => e.preventDefault());
    try {
      ${process.argv.includes('--individual') ? `
      const mp = new MercadoPago(${JSON.stringify(key).replace(/</g, '\\u003c')}, {locale:'es-MX'});
      for (const [name, id] of Object.entries(${JSON.stringify(fields)})) {
        const field = mp.fields.create(name, { placeholder: name });
        field.on('ready', () => mpStages.push(name + ':ready'));
        if (name === 'cardNumber') field.on('binChange', async ({ bin }) => {
          if (!bin) return;
          try {
            const { results } = await mp.getPaymentMethods({ bin });
            const method = results.find(m => ['credit_card', 'debit_card'].includes(m.payment_type_id));
            if (!method) return;
            const [banks] = await Promise.all([
              mp.getIssuers({ bin, paymentMethodId: method.id }),
              mp.getInstallments({ bin, amount: '290.00', paymentTypeId: method.payment_type_id })
            ]);
            document.querySelector('#issuer').replaceChildren(...banks.map(bank => new Option(bank.name, bank.id)));
          } catch { mpStages.push('lookup-error'); }
        });
        field.mount(id);
      }
      ` : `
      const card = new MercadoPago(${JSON.stringify(key).replace(/</g, '\\u003c')}, {locale:'es-MX'}).cardForm({
        amount:'290.00', processingMode:'aggregator', iframe:true, autoMount:false,
        form:{id:'wl-mp-card-form', ...${JSON.stringify(form)}}, callbacks:{
          onFormMounted:e=>mpStages.push(e?'mount-error':'mounted'),
          onReady:()=>mpStages.push('ready'), onError:()=>mpStages.push('sdk-error'),
          onSubmit:e=>e?.preventDefault()
        }
      });
      card.mount();
      `}
    } catch { mpStages.push('exception'); }
    </script>`;
}

async function probeAfterLookup(page, phase, digits, issuer) {
  const input = name => page.frameLocator(`#${fields[name]} > iframe[name="${name}"]`).locator(`input[id="${name}"]`);
  const number = input('cardNumber');
  const result = { phase, step: 'capture' };
  let original;
  try {
    await page.bringToFront();
    await number.click({ timeout: 10000 });
    if (!await number.evaluate(el => el.value === '')) throw new Error();
    original = await number.elementHandle();
    await page.keyboard.type(digits, { delay: 55 });
    result.fullNumberAccepted = await number.evaluate((el, count) => el.value.replace(/\D/g, '').length === count, digits.length);
    result.step = 'issuer';
    await page.locator(`${issuer} option:not([value=""])`).first().waitFor({ state: 'attached', timeout: 15000 });
    result.issuerDetected = true;
    result.step = 'return-to-number';
    await input('expirationDate').click({ timeout: 5000 });
    await number.evaluate(el => {
      window.__wlEditEvents = [];
      for (const type of ['pointerdown', 'focus', 'keydown', 'beforeinput', 'input']) {
        el.addEventListener(type, e => window.__wlEditEvents.push([type, e.isTrusted]), { once: true });
      }
    });
    await number.click({ timeout: 5000 });
    await page.keyboard.press('End');
    await page.keyboard.press('Backspace');
    result.deleted = await number.evaluate((el, count) => el.value.replace(/\D/g, '').length === count - 1, digits.length);
    await page.keyboard.type(digits.slice(-1));
    Object.assign(result, await number.evaluate((el, count) => ({
      restored: el.value.replace(/\D/g, '').length === count,
      focused: document.activeElement === el && document.hasFocus(),
      events: window.__wlEditEvents ?? [],
    }), digits.length));
    result.step = 'complete';
  } catch { result.completed = false; }
  finally {
    if (original) {
      result.originalInputConnected = await original.evaluate(el => el.isConnected).catch(() => false);
      await original.dispose();
    }
    console.log(JSON.stringify(result));
  }
}

async function probe(page, phase, revisit = false) {
  await page.bringToFront();
  for (const [name, host] of Object.entries(fields)) {
    const selector = `#${host} > iframe[name="${name}"]`;
    const frame = page.locator(selector);
    const input = page.frameLocator(selector).locator(`input[id="${name}"]`);
    const result = { phase, field: name };
    try {
      result.step = 'input-visible';
      await input.waitFor({ state: 'visible', timeout: 8000 });
      const node = await frame.elementHandle({ timeout: 3000 });
      try {
        const empty = await input.evaluate(el => {
          const events = [];
          window.__wlProbe = { el, events };
          for (const type of ['pointerdown', 'focus', 'keydown', 'beforeinput', 'input']) {
            el.addEventListener(type, e => events.push([type, e.isTrusted]), { once: true });
          }
          return el.value === '';
        });
        result.step = 'field-empty';
        if (empty === revisit) throw new Error('unexpected-field-state');
        if (revisit) await page.locator('#wl-mp-card-form input[autocomplete="cc-name"]').click({ timeout: 4000 });
        result.step = 'click';
        if (process.argv.includes('--touch')) await input.tap({ timeout: 4000 });
        else await input.click({ timeout: 4000 });
        // Do not call locator.press(): it can refocus the input after the click.
        if (revisit) await page.keyboard.press('End');
        await page.keyboard.press(revisit ? 'Backspace' : '1');
        Object.assign(result, await input.evaluate((el, edit) => ({
          sameInput: window.__wlProbe?.el === el,
          events: window.__wlProbe?.events ?? [],
          focused: document.activeElement === el && document.hasFocus(),
          accepted: edit ? el.value === '' : /\d/.test(el.value),
        }), revisit));
        result.sameFrame = await node.evaluate((el, s) => el.isConnected && el === document.querySelector(s), selector);
        result.step = 'complete';
      } finally { await node.dispose(); }
    } catch (error) {
      result.completed = false;
      const detail = String(error?.message ?? '');
      result.actionability = /intercepts pointer events/i.test(detail) ? 'pointer-intercepted'
        : /not stable/i.test(detail) ? 'unstable'
        : /outside of the viewport/i.test(detail) ? 'outside-viewport'
        : /detached/i.test(detail) ? 'detached'
        : /timeout/i.test(detail) ? 'timeout' : 'unknown';
      result.iframeCount = await frame.count();
    }
    if (!result.accepted && await frame.count() === 1) {
      result.parentHit = await frame.evaluate(el => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { iframe: hit === el, tag: hit?.tagName, id: hit?.id,
          inInertLayer: Boolean(el.closest('[inert]')), documentFocused: document.hasFocus(),
          activeFrame: document.activeElement === el };
      }, undefined, { timeout: 1500 }).catch(() => null);
    }
    console.log(JSON.stringify(result));
  }
  if (!revisit) await probe(page, `${phase}-volver-a-editar`, true);
}

async function main() {
  const digits = process.env.WINGSLAB_MP_TEST_PAN;
  const tokenOnly = process.argv.includes('--token-only');
  const ordersSandbox = process.argv.includes('--orders-sandbox');
  const measureQuality = process.argv.includes('--measure-quality');
  const isolatedKitchen = process.argv.includes('--isolated-kitchen');
  const sandboxRefund = process.argv.includes('--sandbox-refund');
  const sandboxThreeDs = process.argv.includes('--sandbox-3ds');
  if (sandboxThreeDs && (!ordersSandbox || sandboxRefund || isolatedKitchen || measureQuality)) throw new Error('3ds-requires-standalone-sandbox-order');
  if (measureQuality && (!ordersSandbox || isolatedKitchen || sandboxRefund)) throw new Error('quality-requires-standalone-sandbox-order');
  if (sandboxRefund && (!ordersSandbox || isolatedKitchen)) throw new Error('refund-requires-standalone-sandbox-order');
  if (isolatedKitchen && !ordersSandbox) throw new Error('kitchen-requires-sandbox');
  const expiry = process.env.WINGSLAB_MP_TEST_EXPIRY;
  const cvv = process.env.WINGSLAB_MP_TEST_CVV;
  if (tokenOnly && (!digits || !/^\d{4}$/.test(expiry ?? '') || !/^\d{3,4}$/.test(cvv ?? '') ||
      !process.argv.includes('--wait-for-checkout') || process.argv.includes('--baseline-only'))) throw new Error('test-case');
  if (digits && (!/^\d{15,16}$/.test(digits) || !process.argv.includes('--individual'))) throw new Error('test-case');
  const mp = readLocalConfiguration().mercadoPago;
  if (mp?.sandbox !== true || !mp.publicKey) throw new Error('sandbox');
  if (ordersSandbox && (!tokenOnly || !mp.accessToken?.trim())) throw new Error('sandbox-orders');
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  const io = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const touch = process.argv.includes('--touch');
    const narrow = touch || process.argv.includes('--narrow');
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false,
      ...(narrow ? { viewport: { width: 390, height: 844 }, hasTouch: touch } : {}),
    });
    let probeMode = false;
    let permitToken = false;
    let blockedCharge = false;
    let providerOrderStarted = false;
    let providerOrderResult;
    let accreditedOrder;
    let challengeOrder;
    await context.route('**/*', async route => {
      const req = route.request();
      const url = new URL(req.url());
      const path = decodeURIComponent(url.pathname).replace(/\/+$/, '');
      if (challengeOrder && req.method() === 'GET' && url.origin === origin && path === challengeOrder.path) {
        const { fetchMercadoPagoOrder, matchesAccreditedMercadoPagoOrder } = require('../packages/backend/dist/services/mercado-pago-orders.js');
        try {
          const order = await fetchMercadoPagoOrder(mp.accessToken, challengeOrder.id);
          const verified = matchesAccreditedMercadoPagoOrder(order, {
            intentId: challengeOrder.reference, providerOrderId: challengeOrder.id, amountCents: 29000,
          });
          const state = verified ? 'VERIFIED' : ['failed', 'canceled'].includes(order.status) ? 'DECLINED' : 'PENDING';
          challengeOrder.state = state;
          return route.fulfill({ json: { success: true, data: { state } } });
        } catch { return route.fulfill({ status: 503, json: { success: false } }); }
      }
      if (permitToken && req.method() === 'POST' && url.origin === 'https://api.mercadopago.com' && path === '/v1/card_tokens') return route.continue();
      if (/\/charge$/i.test(path)) {
        blockedCharge = true;
        if (ordersSandbox && permitToken && !providerOrderStarted && url.origin === origin &&
            req.method() === 'POST' && /^\/api\/me\/checkout\/card\/intents\/[0-9a-f-]+\/charge$/.test(path)) {
          providerOrderStarted = true;
          try {
            const { createMercadoPagoCardOrder, matchesAccreditedMercadoPagoOrder, mercadoPagoItemsFromSnapshot } = require('../packages/backend/dist/services/mercado-pago-orders.js');
            const data = req.postDataJSON();
            if (data.payerEmail !== 'sandbox@example.com' || data.paymentMethodId !== 'master' ||
                data.cardType !== 'credit_card' || data.installments !== 1) throw new Error('unexpected-test-data');
            const intentId = randomUUID(); // Never links to a WingsLab reservation or kitchen order.
            const amountCents = 29000;
            const items = measureQuality ? mercadoPagoItemsFromSnapshot({
              items: [{ title: 'Producto de prueba', productId: 'sandbox-quality-item', quantity: 2, unitPrice: 145, subtotal: 290 }],
            }, amountCents) : undefined;
            if (measureQuality && !items?.length) throw new Error('quality-items-missing');
            const fetchOriginal = globalThis.fetch;
            let order;
            globalThis.fetch = async (url, init) => {
              const response = await fetchOriginal(url, init);
              if (!response.ok && String(url) === 'https://api.mercadopago.com/v1/orders' && init?.method === 'POST') {
                const body = await response.clone().json().catch(() => null);
                const errors = Array.isArray(body?.errors) ? body.errors : [];
                const codes = [body?.code, body?.error, ...errors.slice(0, 8).map(item => item?.code)]
                  .filter(code => typeof code === 'string' && /^[a-z][a-z_]{2,79}$/.test(code));
                providerOrderResult = { failed: true, providerHttpStatus: response.status, codes: [...new Set(codes)] };
              }
              return response;
            };
            try {
              order = await createMercadoPagoCardOrder(mp.accessToken, {
              intentId, idempotencyKey: intentId, amountCents, payerEmail: data.payerEmail,
              cardToken: data.cardToken, methodId: data.paymentMethodId, cardType: data.cardType,
              deviceId: data.deviceId,
               issuerId: data.issuerId, installments: data.installments,
               items,
               platformId: typeof mp.platformId === 'string' ? mp.platformId.trim() || undefined : undefined,
               requireThreeDs: sandboxThreeDs || undefined,
               ...(measureQuality ? { payerFirstName: 'Comprador', payerLastName: 'Prueba' } : {}),
              });
            } finally {
              globalThis.fetch = fetchOriginal;
            }
            providerOrderResult = { status: order.status, detail: order.status_detail,
              accredited: matchesAccreditedMercadoPagoOrder(order, { intentId, amountCents, providerOrderId: order.id }) };
            if (sandboxThreeDs) {
              const { mercadoPagoChallengeUrl } = require('../packages/backend/dist/services/mercado-pago-orders.js');
              const threeDsUrl = mercadoPagoChallengeUrl(order);
              providerOrderResult.challengeOffered = Boolean(threeDsUrl);
              if (threeDsUrl && order.id.startsWith('ORDTST') && order.external_reference === intentId) {
                challengeOrder = { id: order.id, reference: intentId, path: path.slice(0, -'/charge'.length), state: 'PENDING' };
                return await route.fulfill({ json: { success: true, data: { state: 'PENDING', threeDsUrl } } });
              }
            }
            if (measureQuality && providerOrderResult.accredited) {
              providerOrderResult.orderId = order.id;
              providerOrderResult.deviceIdSent = Boolean(data.deviceId);
            }
            if ((isolatedKitchen || sandboxRefund) && providerOrderResult.accredited) accreditedOrder = order;
          } catch (error) {
            providerOrderResult ??= { failed: true, providerHttpStatus: /Orders respondió HTTP (\d{3})/.exec(error?.message ?? '')?.[1] ?? null };
          } finally {
            if (!challengeOrder) await route.abort();
          }
          return;
        }
      }
      if (/\/charge(?:\/|$)|\/v1\/(?:orders|payments|card_tokens)(?:\/|$)/i.test(path)) return route.abort();
      if (req.url() === fixture) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: baseline(mp.publicKey) });
      if (req.method() === 'POST' && ['127.0.0.1', 'localhost'].includes(url.hostname) &&
          /\/me\/checkout\/card\/intents$/.test(path)) {
        return route.fulfill({ status: 201, json: { success: true, data: {
          id: randomUUID(), state: 'RESERVED', amountCents: 29000, expiresAt: new Date(Date.now() + 600000).toISOString(),
        } } });
      }
      const supportPost = req.method() === 'POST' && (
        (url.origin === origin && path === '/api/customer/lealtad/cotizar') ||
        (url.origin === 'https://api.mercadopago.com' && [
          '/v1/devices/widgets', '/op-frontend-metrics/v1/error-metric',
          '/v1/device_sessions/web_device', '/v1/device_sessions/anonymous_device_session',
        ].includes(path)) ||
        (url.origin === 'https://api.mercadolibre.com' && path === '/melidata/tracks')
      );
      if (supportPost) return route.continue();
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method()) &&
          (probeMode || /\/pedidos(?:\/|$)|\/checkout(?:\/|$)/i.test(path))) return route.abort();
      return route.continue();
    });
    const page = await context.newPage();
    if (process.argv.includes('--manual-input')) {
      if (tokenOnly || ordersSandbox) throw new Error('manual-input-is-read-only');
      let count = 0;
      await page.exposeBinding('__wlManualInputEvent', (source, event) => {
        const url = new URL(source.frame.url());
        if (![origin, 'https://secure-fields.mercadopago.com'].includes(url.origin) || count >= 300) return;
        if (!['pointerdown', 'focusin', 'focusout', 'keydown', 'beforeinput', 'input'].includes(event?.type)) return;
        count++;
        console.log(JSON.stringify({ phase: 'manual-input', type: event.type,
          target: ['cardNumber', 'expirationDate', 'securityCode', 'iframe', 'other'].includes(event.target) ? event.target : 'other',
          secureFrame: url.origin !== origin, focused: event.focused === true, trusted: event.trusted === true }));
      });
      await page.addInitScript(({ origin }) => {
        if (![origin, 'https://secure-fields.mercadopago.com'].includes(location.origin)) return;
        for (const type of ['pointerdown', 'focusin', 'focusout', 'keydown', 'beforeinput', 'input']) {
          window.addEventListener(type, event => {
            if (location.origin === origin && !document.getElementById('wl-mp-card-form')) return;
            const el = event.target;
            const target = el?.tagName === 'IFRAME' ? 'iframe' : el?.id;
            void window.__wlManualInputEvent({ type, target: ['cardNumber', 'expirationDate', 'securityCode', 'iframe'].includes(target) ? target : 'other',
              focused: document.hasFocus(), trusted: event.isTrusted }).catch(() => {});
          }, true);
        }
      }, { origin });
      await page.goto(origin);
      console.log('Abre el pago y prueba manualmente escribir, salir y volver a editar. No pulses Pagar.');
      await page.locator('#wl-mp-card-number > iframe').waitFor({ timeout: 300000 });
      probeMode = true;
      console.log('Observando eventos manuales durante 2 minutos, sin guardar teclas ni valores.');
      await new Promise(resolve => { const timer = setTimeout(resolve, 120000); page.once('close', () => { clearTimeout(timer); resolve(); }); });
      return;
    }
    if (process.argv.includes('--device-only')) {
      const securityScript = 'https://www.mercadopago.com/v2/security.js';
      let scriptStatus = null;
      let scriptFailed = false;
      page.on('response', response => { if (response.url() === securityScript) scriptStatus = response.status(); });
      page.on('requestfailed', request => { if (request.url() === securityScript) scriptFailed = true; });
      await page.goto(origin);
      console.log('Inicia sesión y abre Carrito → Tarjeta → Continuar con tarjeta. No ingreses datos ni pulses Pagar.');
      await page.locator('#wl-mp-card-number > iframe').waitFor({ timeout: 300000 });
      probeMode = true;
      const deviceIdReady = await page.waitForFunction(() =>
        typeof window.MP_DEVICE_SESSION_ID === 'string' && /^[\x21-\x7E]{1,512}$/.test(window.MP_DEVICE_SESSION_ID),
      undefined, { timeout: 12000 }).then(() => true, () => false);
      console.log(JSON.stringify({ phase: 'device-id-sin-orden', scriptStatus, scriptFailed, deviceIdReady }));
      return;
    }
    if (process.argv.includes('--baseline-only')) {
      probeMode = true;
      await page.goto(fixture);
      if (digits) await probeAfterLookup(page, 'campos-individuales-minimo', digits, '#issuer');
      else await probe(page, 'cardform-minimo');
      console.log(JSON.stringify({ phase: 'cardform-minimo', callbacks: await page.evaluate(() => window.mpStages ?? []) }));
      return;
    }
    await page.goto(origin);
    if (process.argv.includes('--wait-for-checkout')) {
      console.log('Esperando inicio de sesión y campos del checkout (5 minutos).');
      await page.locator('#wl-mp-card-number > iframe').waitFor({ timeout: 300000 });
      probeMode = true;
      if (tokenOnly) {
        for (const [name, value] of Object.entries({ cardNumber: digits, expirationDate: expiry, securityCode: cvv })) {
          const input = page.frameLocator(`#${fields[name]} > iframe[name="${name}"]`).locator(`input[id="${name}"]`);
          await input.click({ timeout: 10000 });
          if (!await input.evaluate(el => el.value === '')) throw new Error('field-not-empty');
          await page.keyboard.type(value, { delay: 55 });
          const captured = await input.evaluate((el, count) => el.value.replace(/\D/g, '').length === count, value.length);
          if (!captured) {
            console.log(JSON.stringify({ phase: 'captura-sandbox', field: name, accepted: false }));
            process.exitCode = 1;
            return;
          }
        }
        await page.locator('#wl-mp-cardholder').fill(sandboxThreeDs ? 'APRO-CHOK' : 'APRO');
        await page.locator('#wl-mp-email').fill('sandbox@example.com');
        if (measureQuality) {
          await page.waitForFunction(() => typeof window.MP_DEVICE_SESSION_ID === 'string' &&
            /^[\x21-\x7E]{1,512}$/.test(window.MP_DEVICE_SESSION_ID), undefined, { timeout: 12000 });
        }
        permitToken = true;
        const response = page.waitForResponse(r => new URL(r.url()).origin === 'https://api.mercadopago.com' &&
          new URL(r.url()).pathname === '/v1/card_tokens' && r.request().method() === 'POST', { timeout: 20000 }).catch(() => null);
        await page.locator('#wl-mp-card-form button[type="submit"]').click({ timeout: 18000 });
        const tokenResponse = await response;
        if (tokenResponse?.ok()) await page.waitForFunction(() => document.querySelector('#wl-mp-card-form button[type="submit"]:not([disabled]), iframe[title="Verificación de tarjeta de Mercado Pago"]'), { timeout: 12000 }).catch(() => {});
        permitToken = false;
        console.log(JSON.stringify({ phase: ordersSandbox ? 'orders-sandbox-sin-cocina' : 'tokenizacion-sin-cobro', providerStatus: tokenResponse?.status() ?? null, chargeIntercepted: blockedCharge, providerOrder: providerOrderResult }));
        if (challengeOrder) {
          console.log('Completa el desafío de prueba en Chrome. Esta orden no llega a WingsLab ni a cocina.');
          await page.getByText('Pago confirmado.', { exact: true }).waitFor({ timeout: 180000 }).catch(() => {});
          console.log(JSON.stringify({ phase: 'desafio-3ds-sandbox', state: challengeOrder.state,
            confirmationVisible: await page.getByText('Pago confirmado.', { exact: true }).isVisible() }));
          if (challengeOrder.state !== 'VERIFIED' || !await page.getByText('Pago confirmado.', { exact: true }).isVisible()) process.exitCode = 1;
        } else if (sandboxThreeDs) {
          const state = !tokenResponse ? 'TOKEN_RESPONSE_MISSING'
            : !tokenResponse.ok() ? 'TOKEN_REJECTED'
            : !providerOrderResult ? 'ORDER_NOT_ATTEMPTED'
            : providerOrderResult.failed ? 'ORDER_FAILED' : 'NOT_OFFERED';
          console.log(JSON.stringify({ phase: 'desafio-3ds-sandbox', state, confirmationVisible: false }));
          process.exitCode = 1;
        }
        if (sandboxRefund) {
          if (!accreditedOrder) throw new Error('not-accredited');
          const { refundAccreditedMercadoPagoOrder } = require('../packages/backend/dist/services/mercado-pago-orders.js');
          const originalFetch = globalThis.fetch;
          let refundCodes = [];
          const refundUrl = `https://api.mercadopago.com/v1/orders/${accreditedOrder.id}/refund`;
          globalThis.fetch = async (url, init) => {
            const response = await originalFetch(url, init);
            if (String(url) === refundUrl && init?.method === 'POST' && !response.ok) {
              const body = await response.clone().json().catch(() => null);
              const errors = Array.isArray(body?.errors) ? body.errors : [];
              refundCodes = [...new Set([body?.code, body?.error, ...errors.slice(0, 8).map(item => item?.code)]
                .filter(code => typeof code === 'string' && /^[a-z][a-z_]{2,79}$/.test(code)))];
            }
            return response;
          };
          try {
            // No arbitrary order ID is accepted: refund only the sandbox order created in this run.
            const result = await refundAccreditedMercadoPagoOrder(mp.accessToken, accreditedOrder, randomUUID());
            console.log(JSON.stringify({ phase: 'reembolso-sandbox', confirmed: result.status_detail === 'refunded' }));
          } catch (error) {
            console.log(JSON.stringify({ phase: 'reembolso-sandbox', confirmed: false,
              providerHttpStatus: /Refund respondió HTTP (\d{3})/.exec(error?.message ?? '')?.[1] ?? null, codes: refundCodes }));
            process.exitCode = 1;
          } finally {
            globalThis.fetch = originalFetch;
          }
        }
        if (isolatedKitchen) {
          if (!accreditedOrder) throw new Error('not-accredited');
          const runner = require('node:path').join(__dirname, 'run-sandbox-kitchen.sh');
          const test = require('node:child_process').spawnSync('bash', [runner, '--provider-stdin'], {
            input: JSON.stringify(accreditedOrder), encoding: 'utf8', timeout: 90000,
          });
          console.log(JSON.stringify({ phase: 'cocina-aislada', passed: test.status === 0 }));
          if (test.status !== 0) process.exitCode = 1;
        }
        return;
      }
      if (digits) await probeAfterLookup(page, 'checkout-despues-del-banco', digits, '#wl-mp-issuer');
      else await probe(page, 'checkout');
      for (const phase of ['checkout-reabierto', 'checkout-cambio-metodo']) {
        console.log(`Esperando: ${phase} (5 minutos).`);
        const frame = page.locator('#wl-mp-card-number > iframe');
        await frame.waitFor({ state: 'detached', timeout: 300000 });
        await frame.waitFor({ timeout: 300000 });
        if (digits) await probeAfterLookup(page, phase, digits, '#wl-mp-issuer');
        else await probe(page, phase);
      }
      return;
    }
    await io.question('En Chrome inicia sesión con tu cuenta de prueba. No compartas credenciales. Pulsa Intro aquí al terminar. ');
    probeMode = true;
    await io.question('Abre el checkout, selecciona Tarjeta y pulsa Continuar con tarjeta. No envíes el formulario. Pulsa Intro aquí cuando esté abierto. ');
    await probe(page, 'checkout');
    await io.question('Cierra y reabre el checkout y vuelve a mostrar los campos vacíos. Pulsa Intro aquí. ');
    await probe(page, 'checkout-reabierto');
    await io.question('Cambia a otro método y vuelve a Tarjeta. Muestra los campos vacíos y pulsa Intro aquí. ');
    await probe(page, 'checkout-cambio-metodo');
    const isolated = await context.newPage();
    await isolated.goto(fixture);
    await probe(isolated, 'cardform-minimo');
    console.log(JSON.stringify({ phase: 'cardform-minimo', callbacks: await isolated.evaluate(() => window.mpStages ?? []) }));
  } finally {
    io.close();
    await browser.close();
  }
}

main().catch(() => {
  console.error('Diagnóstico interrumpido: verifica Playwright, Chrome, sandbox local y el servidor comensal.');
  process.exitCode = 1;
});
