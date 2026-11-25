const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');

const source = fs.readFileSync(path.join(__dirname, 'categoryScroll.ts'), 'utf8');
const mod = new Module('categoryScroll');
mod._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, 'categoryScroll.js');
const { categoryAtScrollLine, categoryScrollLine } = mod.exports;

test('selecciona la última categoría que alcanzó el borde visible', () => {
  const sections = [{ id: 'a', top: -300 }, { id: 'b', top: 140 }, { id: 'c', top: 600 }];
  assert.equal(categoryAtScrollLine(sections, 130), 'a');
  assert.equal(categoryAtScrollLine(sections, 140), 'b');
  assert.equal(categoryAtScrollLine(sections, 700), 'c');
});
test('adelanta el cambio sin que el umbral crezca demasiado', () => {
  assert.equal(categoryScrollLine(68, 60, 800), 192);
  assert.equal(categoryScrollLine(68, 60, 2000), 200);
  assert.equal(categoryScrollLine(68, 60, 200), 152);
});
test('la primera categoría es activa antes de llegar a sus productos', () => {
  assert.equal(categoryAtScrollLine([{ id: 'a', top: 400 }, { id: 'b', top: 800 }], 150), 'a');
  assert.equal(categoryAtScrollLine([], 150), null);
});
