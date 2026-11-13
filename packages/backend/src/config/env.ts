import fs from 'node:fs';
import path from 'node:path';

let envLoaded = false;

function directoryExists(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function fileExists(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function findWorkspaceRoot(startDir: string): string {
  let currentDir = path.resolve(startDir);

  // Bucle intencional: sube de directorio hasta hallar la raíz del workspace.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (
      fileExists(path.join(currentDir, 'package.json')) &&
      directoryExists(path.join(currentDir, 'packages', 'backend'))
    ) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return path.resolve(startDir);
    }

    currentDir = parentDir;
  }
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function parseEnvFile(contents: string): Record<string, string> {
  const parsed: Record<string, string> = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (!key || process.env[key] !== undefined) {
      continue;
    }

    parsed[key] = stripWrappingQuotes(value);
  }

  return parsed;
}

export function loadEnvironment(): void {
  if (envLoaded) {
    return;
  }

  const cwd = process.cwd();
  const workspaceRoot = findWorkspaceRoot(cwd);
  const backendRoot = path.join(workspaceRoot, 'packages', 'backend');
  const backendCwd = path.resolve(cwd);
  const uniqueCandidatePaths = new Set([
    path.join(workspaceRoot, '.env.local'),
    path.join(workspaceRoot, '.env'),
    path.join(backendRoot, '.env.local'),
    path.join(backendRoot, '.env'),
    path.join(backendCwd, '.env.local'),
    path.join(backendCwd, '.env'),
  ]);
  const candidatePaths = [...uniqueCandidatePaths];

  for (const filePath of candidatePaths) {
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const fileContents = fs.readFileSync(filePath, 'utf8');
    const parsedEntries = parseEnvFile(fileContents);
    Object.assign(process.env, parsedEntries);
  }

  envLoaded = true;
}

type EnvVar = {
  key: string;
  required: boolean;
  secret: boolean;
};

const REQUIRED_ENV_VARS: EnvVar[] = [
  { key: 'DATABASE_URL', required: true, secret: true },
  { key: 'JWT_SECRET', required: true, secret: true },
  // Clave dedicada para cifrar datos sensibles (cuentas bancarias). Separada de
  // JWT_SECRET para no reutilizar material entre firmas (HS256) y cifrado (AES-GCM).
  { key: 'DATABASE_ENCRYPTION_KEY', required: true, secret: true },
  // Claves históricas (comma-separated) que permiten descifrar datos cifrados
  // con una clave anterior durante una rotación. Nunca se usan para cifrar.
  { key: 'DATABASE_ENCRYPTION_KEYS', required: false, secret: true },
  { key: 'REDIS_URL', required: false, secret: false },
  { key: 'CORS_ORIGIN', required: false, secret: false },
  { key: 'VAPID_PUBLIC_KEY', required: false, secret: false },
  { key: 'VAPID_PRIVATE_KEY', required: false, secret: true },
  { key: 'RATE_LIMIT_MAX', required: false, secret: false },
  { key: 'RATE_LIMIT_WINDOW_MS', required: false, secret: false },
];

const PLACEHOLDER_SECRET_PATTERN =
  /your[_-\s]?(secret|database|key|password|token)|change[_-\s]?in[_-\s]?production|changeme|replace[_-\s]?me|sample[_-\s]?secret/i;

function isPlaceholderSecret(value: string): boolean {
  return PLACEHOLDER_SECRET_PATTERN.test(value);
}

export function validateEnvironment(): void {
  const missing: string[] = [];
  const insecure: string[] = [];

  for (const v of REQUIRED_ENV_VARS) {
    const value = process.env[v.key];
    if (v.required && !value) {
      missing.push(v.key);
    }
    if (v.secret && value && isPlaceholderSecret(value)) {
      insecure.push(v.key);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `FATAL: Missing required environment variables: ${missing.join(', ')}`
    );
  }

  if (insecure.length > 0) {
    throw new Error(
      `FATAL SECURITY ERROR: The following secrets still use placeholder values: ${insecure.join(', ')}. Update them before running in production.`
    );
  }
}

loadEnvironment();
