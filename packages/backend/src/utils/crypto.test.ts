import { encrypt, decrypt, hashToken, hmacToken, maskAccountNumber } from './crypto';

describe('crypto (cifrado de datos sensibles)', () => {
  const originalKey = process.env.DATABASE_ENCRYPTION_KEY;
  const originalJwt = process.env.JWT_SECRET;
  const originalKeys = process.env.DATABASE_ENCRYPTION_KEYS;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.DATABASE_ENCRYPTION_KEY;
    else process.env.DATABASE_ENCRYPTION_KEY = originalKey;
    if (originalJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwt;
    if (originalKeys === undefined) delete process.env.DATABASE_ENCRYPTION_KEYS;
    else process.env.DATABASE_ENCRYPTION_KEYS = originalKeys;
  });

  it('cifra y descifra con la clave dedicada (DATABASE_ENCRYPTION_KEY)', () => {
    process.env.DATABASE_ENCRYPTION_KEY = 'dedicated-key-123';
    delete process.env.JWT_SECRET;

    const plain = '9876 5432 1098 7654';
    const cipher = encrypt(plain);

    expect(cipher).not.toBe(plain);
    expect(cipher.split(':')).toHaveLength(3);
    expect(decrypt(cipher)).toBe(plain);
  });

  it('usa JWT_SECRET como respaldo solo fuera de producción y descifra correctamente', () => {
    delete process.env.DATABASE_ENCRYPTION_KEY;
    process.env.JWT_SECRET = 'dev-jwt-fallback';

    const plain = '1234 5678';
    const cipher = encrypt(plain);

    expect(decrypt(cipher)).toBe(plain);
  });

  it('descifra datos cifrados con una clave anterior (rotación) usando DATABASE_ENCRYPTION_KEYS', () => {
    // Datos cifrados con la clave "vieja".
    process.env.DATABASE_ENCRYPTION_KEY = 'old-key';
    delete process.env.DATABASE_ENCRYPTION_KEYS;
    const legacy = encrypt('cuenta-rotada');

    // Rotamos: la clave actual cambia y la anterior se declara en el keyring.
    process.env.DATABASE_ENCRYPTION_KEY = 'new-key';
    process.env.DATABASE_ENCRYPTION_KEYS = 'old-key';

    // El dato antiguo sigue siendo descifrable.
    expect(decrypt(legacy)).toBe('cuenta-rotada');
    // Y los datos nuevos se cifran con la clave actual.
    const fresh = encrypt('nueva');
    expect(decrypt(fresh)).toBe('nueva');
  });

  it('descifra datos legados cifrados con JWT_SECRET cuando se configura DATABASE_ENCRYPTION_KEY', () => {
    // Datos cifrados antes de existir la clave dedicada.
    delete process.env.DATABASE_ENCRYPTION_KEY;
    process.env.JWT_SECRET = 'legacy-jwt';
    const legacy = encrypt('legado-jwt');

    // Ahora producción usa clave dedicada, pero el dato viejo debe leerse.
    process.env.DATABASE_ENCRYPTION_KEY = 'new-dedicated';
    expect(decrypt(legacy)).toBe('legado-jwt');
  });

  it('no descifra con una clave incorrecta (devuelve vacío, no filtra el ciphertext)', () => {
    process.env.DATABASE_ENCRYPTION_KEY = 'clave-a';
    const cipher = encrypt('secreto');

    process.env.DATABASE_ENCRYPTION_KEY = 'clave-b';
    process.env.DATABASE_ENCRYPTION_KEYS = '';
    expect(decrypt(cipher)).toBe('');
  });

  it('trata el texto plano como retrocompatible (devuelve el valor tal cual)', () => {
    expect(decrypt('texto-plano')).toBe('texto-plano');
  });

  it('lanza error al cifrar si no hay ninguna clave configurada (no degrada a texto plano)', () => {
    delete process.env.DATABASE_ENCRYPTION_KEY;
    delete process.env.JWT_SECRET;
    expect(() => encrypt('dato')).toThrow(/encryption key/i);
  });

  it('hashToken produce un hash SHA-256 determinista', () => {
    const token = 'abc123';
    expect(hashToken(token)).toHaveLength(64);
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toBe(token);
  });

  describe('maskAccountNumber', () => {
    it('enmascara solo los últimos 4 caracteres', () => {
      expect(maskAccountNumber('1234 5678 9012 3456')).toBe('**** 3456');
    });

    it('devuelve **** para valores de 4 o menos caracteres', () => {
      expect(maskAccountNumber('1234')).toBe('****');
      expect(maskAccountNumber('12')).toBe('****');
    });

    it('devuelve null sin valor', () => {
      expect(maskAccountNumber(null)).toBeNull();
      expect(maskAccountNumber(undefined)).toBeNull();
      expect(maskAccountNumber('')).toBeNull();
    });
  });

  describe('hmacToken', () => {
    const originalKey = process.env.DATABASE_ENCRYPTION_KEY;
    const originalJwt = process.env.JWT_SECRET;

    afterEach(() => {
      if (originalKey === undefined) delete process.env.DATABASE_ENCRYPTION_KEY;
      else process.env.DATABASE_ENCRYPTION_KEY = originalKey;
      if (originalJwt === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = originalJwt;
    });

    it('es determinista para la misma entrada y clave', () => {
      process.env.DATABASE_ENCRYPTION_KEY = 'token-key';
      const a = hmacToken('order-1');
      const b = hmacToken('order-1');
      expect(a).toBe(b);
      expect(a).toHaveLength(64);
    });

    it('cambia el valor si cambia la clave', () => {
      process.env.DATABASE_ENCRYPTION_KEY = 'token-key-a';
      const a = hmacToken('order-1');
      process.env.DATABASE_ENCRYPTION_KEY = 'token-key-b';
      const b = hmacToken('order-1');
      expect(a).not.toBe(b);
    });

    it('lanza error si no hay clave configurada', () => {
      delete process.env.DATABASE_ENCRYPTION_KEY;
      delete process.env.JWT_SECRET;
      expect(() => hmacToken('order-1')).toThrow(/encryption key/i);
    });
  });
});