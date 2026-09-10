import crypto from 'node:crypto';

// Algoritmo de cifrado simétrico robusto
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits para GCM es el estándar recomendado

/**
 * Devuelve el secreto usado para CIFRAR datos nuevos.
 * Se prioriza la clave dedicada (DATABASE_ENCRYPTION_KEY). Fuera de producción,
 * si no está configurada, se deriva de JWT_SECRET como respaldo de desarrollo.
 * Nunca se cae a un secreto hardcodeado: si no hay clave, se falla alto.
 */
function encryptionSecret(): string {
  const secret = process.env.DATABASE_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'No encryption key configured. Set DATABASE_ENCRYPTION_KEY (or JWT_SECRET in dev).'
    );
  }
  return secret;
}

/**
 * Secretos candidatos para DESCIFRAR, en orden de prioridad: la clave dedicada
 * actual, las claves históricas (rotación vía DATABASE_ENCRYPTION_KEYS) y, por
 * compatibilidad, JWT_SECRET para migrar datos cifrados antes de existir
 * DATABASE_ENCRYPTION_KEY. No incluye ningún valor hardcodeado.
 */
function decryptionSecrets(): string[] {
  const secrets: string[] = [];
  const pushIfAbsent = (value: string | undefined): void => {
    const trimmed = value?.trim();
    if (trimmed && !secrets.includes(trimmed)) {
      secrets.push(trimmed);
    }
  };

  pushIfAbsent(process.env.DATABASE_ENCRYPTION_KEY);
  for (const legacy of (process.env.DATABASE_ENCRYPTION_KEYS || '').split(',')) {
    pushIfAbsent(legacy);
  }
  pushIfAbsent(process.env.JWT_SECRET);

  return secrets;
}

// Obtener la clave de cifrado desde el entorno: sha256 garantiza exactamente
// 32 bytes (256 bits) para aes-256. Se mantiene la derivación original para
// preservar la compatibilidad con los datos ya cifrados.
const deriveKey = (secret: string): Buffer =>
  crypto.createHash('sha256').update(secret).digest();

/**
 * Cifra una cadena de texto plano usando AES-256-GCM.
 * Retorna una cadena con el formato: iv:authTag:encryptedData (codificado en hex).
 * Si no hay clave segura, lanza un error en lugar de guardar el dato en claro.
 */
export function encrypt(text: string): string {
  if (!text) return text;

  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(encryptionSecret());
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Descifra una cadena cifrada con AES-256-GCM intentando cada clave del keyring
 * (la primera que autentique correctamente gana). Si el dato original era texto
 * plano o el descifrado falla con todas las claves, devuelve texto vacío para
 * que el panel lo trate como "no configurado" y se pueda volver a guardar.
 */
export function decrypt(cipherText: string): string {
  if (!cipherText) return cipherText;

  const parts = cipherText.split(':');
  if (parts.length !== 3) {
    // No tiene el formato iv:authTag:encryptedData, asumimos que es texto plano (retrocompatibilidad)
    return cipherText;
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  for (const secret of decryptionSecrets()) {
    try {
      const decipher = crypto.createDecipheriv(ALGORITHM, deriveKey(secret), iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch {
      // Clave incorrecta o datos corruptos; probar la siguiente del keyring.
    }
  }

  // Ninguna clave pudo autenticar. No devolver el ciphertext (filtraría datos
  // internos); vacío para que el panel lo trate como "no configurado".
  return '';
}

/**
 * Genera un hash SHA-256 seguro (hexadecimal) para proteger tokens de acceso.
 */
export function hashToken(token: string): string {
  if (!token) return token;
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Enmascara una cuenta bancaria o dato numérico sensible mostrando solo los
 * últimos 4 caracteres (p. ej. "**** 1234"). Devuelve null si no hay valor.
 */
export function maskAccountNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length <= 4) return '****';
  return `**** ${trimmed.slice(-4)}`;
}

/**
 * Deriva un valor determinista (HMAC-SHA-256) a partir de una entrada usando la
 * clave de cifrado del entorno. Sirve para generar tokens reproducibles por
 * pedido sin guardarlos en claro (p. ej. tokens de reparto).
 */
export function hmacToken(input: string): string {
  if (!input) return input;
  const secret = process.env.DATABASE_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'No encryption key configured. Set DATABASE_ENCRYPTION_KEY (or JWT_SECRET in dev).'
    );
  }
  return crypto.createHmac('sha256', secret).update(input).digest('hex');
}
