'use strict';

// Backend local development: runs the host-compiled dist with Node --watch.
// The dist directory is bind-mounted from the host; recompile with
// `npm run dev:backend:compile` on the host to pick up source changes.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const policy = require('../config/wingslab.cjs');
const root = path.resolve(__dirname, '..');

policy.assertNoLegacyEnvFiles();
const config = policy.readLocalConfiguration();
const env = policy.processEnvironment(config, 'backend', 'start');
policy.assertLocalAuthorization(env);
if (!fs.existsSync('/.dockerenv') || !fs.existsSync(path.join(root, 'wingslab-build.json'))) {
  throw new Error('[WingsLab] Backend development requires the approved local container image.');
}
const child = spawn(process.execPath, ['--watch', path.join(root, 'packages/backend/dist/index.js')], {
  cwd: root, env, stdio: 'inherit', shell: false,
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', () => { console.error('[WingsLab] Could not start backend development server.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
