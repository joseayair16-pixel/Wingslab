'use strict';

// Prueba del motor de audio compartido sin navegador: transpila el fuente TS
// y simula window/fetch. Verifica las dos regresiones que causaban 1,65 MB
// descargados al entrar: precarga anticipada y peticiones duplicadas.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const SOURCE = path.resolve(__dirname, 'audio.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));

function loadAudio() {
  const listeners = [];
  const requests = [];
  const js = ts.transpileModule(fs.readFileSync(SOURCE, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: SOURCE,
  }).outputText;

  const previous = { window: global.window, fetch: global.fetch, navigator: global.navigator, document: global.document };
  global.window = {
    addEventListener(type, handler) { listeners.push({ type, handler }); },
    removeEventListener(type, handler) {
      const i = listeners.findIndex(l => l.type === type && l.handler === handler);
      if (i >= 0) listeners.splice(i, 1);
    },
  };
  // Node 26 expone `navigator` como getter de solo lectura.
  Object.defineProperty(global, 'navigator', { value: {}, configurable: true, writable: true });
  global.document = { querySelectorAll: () => [] };
  global.fetch = async (url) => {
    requests.push(url);
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
  };

  const mod = new Module(SOURCE);
  mod.filename = SOURCE;
  mod.paths = Module._nodeModulePaths(path.dirname(SOURCE));
  mod._compile(js, SOURCE);

  const audio = mod.exports;
  audio.reset();
  requests.length = 0;

  return {
    audio, listeners, requests,
    restore() {
      Object.assign(global, previous);
      Object.defineProperty(global, 'navigator', { value: previous.navigator, configurable: true, writable: true });
    },
  };
}

test('preload deduplica peticiones simultáneas del mismo sonido', async () => {
  const ctx = loadAudio();
  try {
    ctx.audio.preload('mensaje');
    ctx.audio.preload('mensaje');
    ctx.audio.preload('mensaje');
    await tick();
    assert.deepEqual(ctx.requests, ['/sounds/mensaje-v2.mp3']);
  } finally {
    ctx.audio.reset();
    ctx.restore();
  }
});

test('preloadOnFirstInteraction no descarga hasta un gesto de confianza', async () => {
  const ctx = loadAudio();
  try {
    const uninstall = ctx.audio.preloadOnFirstInteraction(['llegue']);
    await tick();
    assert.equal(ctx.requests.length, 0, 'no debe descargar al montar');

    const click = ctx.listeners.find(l => l.type === 'click');
    assert.ok(click, 'debe registrar un listener de click');
    click.handler({ isTrusted: false });
    await tick();
    assert.equal(ctx.requests.length, 0, 'no debe descargar con eventos sintéticos');

    click.handler({ isTrusted: true });
    await tick();
    assert.deepEqual(ctx.requests, ['/sounds/llegue-v2.mp3']);

    click.handler({ isTrusted: true });
    await tick();
    assert.equal(ctx.requests.length, 1, 'el gesto solo precarga una vez');
    uninstall();
  } finally {
    ctx.audio.reset();
    ctx.restore();
  }
});
