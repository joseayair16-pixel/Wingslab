'use strict';

// Backend local development: runs the host-compiled dist and restarts exactly
// once per `bash scripts/wingslab-dev.sh backend compile`.
//
// The compile step rewrites packages/backend/dist/.reload only after every file
// has been emitted. Watching that sentinel (instead of the whole dist tree with
// `node --watch`) avoids restarting in the middle of a build and coalesces the
// shared + backend compilations into a single restart. Before this, tsc wrote
// files while the process restarted several times, so requests could hit a
// half-written dist or a closed port and the browser logged transient 500s.
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

const entry = path.join(root, 'packages/backend/dist/index.js');
const reloadFile = path.join(root, 'packages/backend/dist/.reload');

let child = null;
let restarting = false;
let stopping = false;
let reloadSignature = readReloadSignature();

function readReloadSignature() {
  try {
    return fs.readFileSync(reloadFile, 'utf8').trim();
  } catch {
    return '';
  }
}

function start() {
  child = spawn(process.execPath, [entry], { cwd: root, env, stdio: 'inherit', shell: false });
  child.on('error', () => {
    console.error('[WingsLab] Could not start backend development server.');
    process.exit(1);
  });
  child.on('exit', (code) => {
    if (restarting || stopping) return;
    // Unexpected exit: let Docker's restart policy bring the container back.
    clearInterval(poll);
    process.exit(code ?? 1);
  });
}

function restart() {
  if (restarting || stopping) return;
  restarting = true;
  const previous = child;
  const finish = () => {
    restarting = false;
    if (!stopping) start();
  };
  if (!previous || previous.exitCode !== null || previous.signalCode !== null) {
    finish();
    return;
  }
  const force = setTimeout(() => {
    try { previous.kill('SIGKILL'); } catch { /* already gone */ }
  }, 5000);
  force.unref();
  previous.once('exit', () => {
    clearTimeout(force);
    finish();
  });
  previous.kill('SIGTERM');
}

const poll = setInterval(() => {
  const next = readReloadSignature();
  if (next === reloadSignature) return;
  reloadSignature = next;
  restart();
}, 250);

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  clearInterval(poll);
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    process.exit(0);
  }
  const force = setTimeout(() => {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }, 5000);
  force.unref();
  child.once('exit', () => {
    clearTimeout(force);
    process.exit(0);
  });
  child.kill(signal);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(signal));
}

start();
