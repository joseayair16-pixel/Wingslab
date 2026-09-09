import { encrypt, decrypt } from './crypto';

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
});