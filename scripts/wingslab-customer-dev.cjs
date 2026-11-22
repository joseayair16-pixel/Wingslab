'use strict';

// Customer-only local development. Same explicit WingsLab policy, but Next dev
// with source mounted from the host so changes reload automatically.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const policy = require('../config/wingslab.cjs');
const root = path.resolve(__dirname, '..');

policy.assertNoLegacyEnvFiles();
const config = policy.readLocalConfiguration();
const env = policy.processEnvironment(config, 'customer', 'start');
policy.assertLocalAuthorization(env);
if (!fs.existsSync('/.dockerenv') || !fs.existsSync(path.join(root, 'wingslab-build.json'))) {
  throw new Error('[WingsLab] Customer development requires the approved local container image.');
}
env.NODE_ENV = 'development';
env.CHOKIDAR_USEPOLLING = 'true';
env.WATCHPACK_POLLING = 'true';
// El heap del comensal debe coexistir con restaurante, backend, postgres y redis
// dentro de la VM Docker. 2048 MB provocó OOM al compilar el panel en dev.
env.NODE_OPTIONS = '--max-old-space-size=1024';
const child = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'),
  'dev', '--webpack', '-H', '0.0.0.0', '-p', new URL(env.NEXT_PUBLIC_SITE_URL).port], {
  cwd: path.join(root, 'packages/web-customer'), env, stdio: 'inherit', shell: false,
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', () => { console.error('[WingsLab] Could not start customer development server.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
