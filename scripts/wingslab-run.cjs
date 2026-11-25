// Prepared for Phase 2B. This file was NOT executed during Phase 2A.
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const policy = require('../config/wingslab.cjs');
const root = path.resolve(__dirname, '..');
const [role, action] = process.argv.slice(2);
if (!['build', 'start'].includes(action)) throw new Error('[WingsLab] Only explicit build/start supported; no administrative commands.');
if (role === 'backend' && action === 'build') throw new Error('[WingsLab] Backend build uses the reviewed Dockerfile pipeline (tsc + tsc-alias).');
policy.assertNoLegacyEnvFiles();
const config = policy.readLocalConfiguration();
const env = policy.processEnvironment(config, role, action);
if (action === 'build' && (!fs.existsSync('/.dockerenv') || process.env.WINGSLAB_OFFLINE_BUILD !== 'yes')) {
  throw new Error('[WingsLab] Build is restricted to the reviewed offline container.');
}
const directory = role === 'backend' ? 'packages/backend' : `packages/web-${role}`;
if (action === 'start') {
  policy.assertLocalAuthorization(env);
  if (!fs.existsSync('/.dockerenv') || !fs.existsSync(path.join(root, 'wingslab-build.json'))) {
    throw new Error('[WingsLab] Runtime must use the freshly built allowlisted image, not host artifacts.');
  }
}
const port = new URL(env.NEXT_PUBLIC_SITE_URL).port;
let cwd = root;
let cli;
if (role === 'backend') {
  cli = action === 'start'
    ? [path.join(root, 'packages/backend/dist/index.js')]
    : [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'packages/backend/tsconfig.json'];
} else if (action === 'start') {
  const standaloneRoot = path.join(root, directory, '.next', 'standalone');
  const standaloneServer = path.join(standaloneRoot, directory, 'server.js');
  if (fs.existsSync(standaloneServer)) {
    // Build autocontenido: el servidor de Next lee PORT/HOSTNAME del entorno
    // y hace chdir a su propio directorio. La autorización sigue aquí.
    cwd = standaloneRoot;
    cli = [standaloneServer];
    env.PORT = port;
    env.HOSTNAME = '0.0.0.0';
  } else {
    // Solo para imágenes antiguas; la imagen nueva no trae `next` completo.
    cli = [path.join(root, 'node_modules/next/dist/bin/next'), 'start', directory,
      '-H', '0.0.0.0', '-p', port];
  }
} else {
  cli = [path.join(root, 'node_modules/next/dist/bin/next'), action, directory, '--webpack'];
}
// Fresh image only: compiled output is never copied from the host (see runtime Dockerfile).
const child = spawn(process.execPath, cli, { cwd, env, stdio: 'inherit', shell: false });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', () => { console.error('[WingsLab] Failed to start approved process.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
