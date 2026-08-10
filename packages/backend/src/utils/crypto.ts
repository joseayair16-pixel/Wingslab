import crypto from 'node:crypto';

// Algoritmo de cifrado simétrico robusto
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits para GCM es el estándar recomendado

// Obtener la clave de cifrado desde el entorno, o usar JWT_SECRET como fallback
const getEncryptionKey = (): Buffer => {
  const secret = process.env.DATABASE_ENCRYPTION_KEY || process.env.JWT_SECRET || 'fallback_secret_key_sadel_32_bytes_long!!';
  // Asegurar que la llave tenga exactamente 32 bytes (256 bits) para aes-256
  return crypto.createHash('sha256').update(secret).digest();
};

/**
 * Cifra una cadena de texto plano usando AES-256-GCM.
 * Retorna una cadena con el formato: iv:authTag:encryptedData (codificado en hex).
 */
export function encrypt(text: string): string {
  try {
    if (!text) return text;
    
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = getEncryptionKey();
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag().toString('hex');
    
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  } catch (error) {
    console.error('Error al cifrar dato:', error);
    return text;
  }
}

/**
 * Descifra una cadena cifrada con AES-256-GCM.
 * Si el descifrado falla (por ejemplo, porque el dato original era texto plano),
 * retorna el texto original sin lanzar error para garantizar compatibilidad hacia atrás.
 */
export function decrypt(cipherText: string): string {
  try {
    if (!cipherText) return cipherText;
    
    const parts = cipherText.split(':');
    if (parts.length !== 3) {
      // No tiene el formato iv:authTag:encryptedData, asumimos que es texto plano (retrocompatibilidad)
      return cipherText;
    }
    
    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const key = getEncryptionKey();
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    // Tenia formato cifrado pero el descifrado fallo (p.ej. cambio de clave).
    // Devolver el ciphertext filtraria datos internos al cliente; mejor vacio
    // para que el panel lo trate como "no configurado" y se pueda re-guardar.
    return '';
  }
}

/**
 * Genera un hash SHA-256 seguro (hexadecimal) para proteger tokens de acceso.
 */
export function hashToken(token: string): string {
  if (!token) return token;
  return crypto.createHash('sha256').update(token).digest('hex');
}
