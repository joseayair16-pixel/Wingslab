// Run with `docker run --network none ... -i IMAGE node - < this-file`.
// Does not import the application entrypoint, connect to data, or start a server.
const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  assert.equal(process.platform, 'linux');
  assert.equal(process.arch, 'arm64');
  assert.equal(process.getuid(), 1000);
  const sharp = require('sharp');
  const image = await sharp({ create: {
    width: 2, height: 2, channels: 3, background: '#ffffff',
  } }).png().toBuffer();
  assert(image.length > 0);
  assert.equal(sharp.versions.sharp, '0.35.4');
  assert.equal(JSON.parse(fs.readFileSync('node_modules/@img/sharp-libvips-linuxmusl-arm64/package.json')).version, '1.3.3');
  console.log('PASS Sharp native transformation');

  const engine = require('./node_modules/.prisma/client/libquery_engine-linux-musl-arm64-openssl-3.0.x.so.node');
  assert.equal(engine.version().commit, '605197351a3c8bdd595af2d2a9bc3025bca48ea2');
  const { PrismaClient } = require('@prisma/client');
  const client = new PrismaClient();
  await client.$disconnect();
  console.log('PASS Prisma engine and generated client, no connection');

  for (const name of ['fastify', 'ioredis', '@sadel/shared']) require(name);
  for (const name of ['next', 'jest', 'typescript', 'prisma']) {
    assert.throws(() => require.resolve(name));
  }
  for (const name of ['config/wingslab.local.json', 'config/wingslab.local.host.json',
    'config/wingslab.frontend.local.json', '.env', 'packages/backend/src', 'packages/web-customer']) {
    assert.equal(fs.existsSync(name), false);
  }
  const policy = require('./config/wingslab.cjs');
  assert.throws(() => policy.assertLocalAuthorization(), /not authorized/);
  assert.equal(fs.existsSync('packages/backend/dist/index.js'), true);
  console.log('PASS runtime dependencies, credential exclusion and authorization gate');
  console.log('Backend entrypoint NOT imported or started');
})().catch(error => { console.error(error); process.exitCode = 1; });
