const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');

const source = fs.readFileSync(path.join(__dirname, 'pushPlatform.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const mod = new Module('pushPlatform');
mod._compile(compiled, 'pushPlatform.js');
const { isAppleMobileBrowser } = mod.exports;

test('desktop Chrome with touch emulation is not classified as iPad', () => {
  assert.equal(isAppleMobileBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36', 'MacIntel', 5), false);
});
test('iPhone and iPad Safari are classified as Apple mobile', () => {
  assert.equal(isAppleMobileBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'iPhone', 5), true);
  assert.equal(isAppleMobileBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15', 'MacIntel', 5), true);
});
