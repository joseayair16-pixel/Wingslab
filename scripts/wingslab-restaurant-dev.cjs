'use strict';

// Restaurant-only local development with Next dev and mounted source.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const policy = require('../config/wingslab.cjs');
const root = path.resolve(__dirname, '..');

policy.assertNoLegacyEnvFiles();
const config = policy.readLocalConfiguration();
const env = policy.processEnvironment(config, 'restaurant', 'start');
policy.assertLocalAuthorization(env);
if (!fs.existsSync('/.dockerenv') || !fs.existsSync(path.join(root, 'wingslab-build.json'))) {
  throw new Error('[WingsLab] Restaurant development requires the approved local container image.');
}
env.NODE_ENV = 'development';
env.CHOKIDAR_USEPOLLING = 'true';
env.WATCHPACK_POLLING = 'true';
env.NODE_OPTIONS = '--max-old-space-size=1024';
const child = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'),
  'dev', '--webpack', '-H', '0.0.0.0', '-p', new URL(env.NEXT_PUBLIC_SITE_URL).port], {
  cwd: path.join(root, 'packages/web-restaurant'), env, stdio: 'inherit', shell: false,
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', () => { console.error('[WingsLab] Could not start restaurant development server.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
