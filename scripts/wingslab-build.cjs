// Offline build only, used inside the allowlisted build image. No runtime authorization.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { browserOrigins, processEnvironment } = require('../config/wingslab.cjs');
const role = process.argv[2];
// BuildKit RUN sandboxes need not contain /.dockerenv. Enforce the actual
// offline namespace instead: only loopback addresses and no IPv4 routes.
// Docker's kernel also lists unconfigured/down tunnel devices in /proc/net/dev.
const offlineNamespace = process.platform === 'linux' && fs.existsSync('/proc/net/route') &&
  Object.values(require('node:os').networkInterfaces()).flat().every(address => address.internal) &&
  fs.readFileSync('/proc/net/route', 'utf8').trim().split('\n').length === 1;
if (!offlineNamespace || process.env.WINGSLAB_OFFLINE_BUILD !== 'yes') {
  console.error('[WingsLab] Offline build guard:', JSON.stringify({ platform: process.platform,
    approved: process.env.WINGSLAB_OFFLINE_BUILD === 'yes',
    interfaces: fs.existsSync('/proc/net/dev') ? fs.readFileSync('/proc/net/dev', 'utf8').trim().split('\n').slice(2).map(line => line.trim().split(':')[0]) : null }));
  throw new Error('[WingsLab] Build requires the reviewed container with network=none.');
}
if (!['admin', 'customer', 'restaurant', 'driver'].includes(role)) throw new Error('[WingsLab] Unknown frontend.');
const env = processEnvironment({ version: 1, profile: 'container', origins: browserOrigins, authorization: { build: true } }, role, 'build');
const root = path.resolve(__dirname, '..');
const result = spawnSync(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'build',
  path.join(root, `packages/web-${role}`), '--webpack'], {
  cwd: path.join(root, `packages/web-${role}`), env, stdio: 'inherit', shell: false,
});
process.exitCode = result.status ?? 1;
