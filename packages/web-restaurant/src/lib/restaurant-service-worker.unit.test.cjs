const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const PUBLIC = path.join(__dirname, '../../public');
const source = fs.readFileSync(path.join(PUBLIC, 'sw.js'), 'utf8');

function precacheUrls() {
  const match = source.match(/const PRECACHE_URLS = \[([\s\S]*?)\];/);
  assert.ok(match, 'PRECACHE_URLS must be declared');
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
}

test('restaurant worker only precaches files that exist in public', () => {
  const missing = precacheUrls().filter((url) => {
    if (url === '/' || url.includes('?')) return false;
    return !fs.existsSync(path.join(PUBLIC, url));
  });

  assert.deepEqual(missing, [], `missing precache files: ${missing.join(', ')}`);
});
