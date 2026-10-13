import { prisma } from '../config/database';
import { hashToken } from '../utils/crypto';
import {
  createRefreshToken,
  validateAndRotateRefreshToken,
  revokeRefreshToken,
} from './refresh-token.service';

const mockFindUnique = jest.spyOn(prisma.refreshToken, 'findUnique');
const mockCreate = jest.spyOn(prisma.refreshToken, 'create');
const mockUpdate = jest.spyOn(prisma.refreshToken, 'update');
const mockUpdateMany = jest.spyOn(prisma.refreshToken, 'updateMany');
const mockTransaction = jest.spyOn(prisma, '$transaction');

function storedRow(overrides: { token: string; revokedAt?: Date | null; expiresAt?: Date }): any {
  return {
    id: 'refresh-1',
    userId: 'user-1',
    revokedAt: overrides.revokedAt ?? null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('refresh-token.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('almacena el hash y devuelve el token en claro', async () => {
    mockCreate.mockResolvedValue(storedRow({ token: 'hash' }) as never);

    const raw = await createRefreshToken('user-1');

    expect(raw).toBeTruthy();
    expect(raw).not.toContain(':');
    const storedToken = mockCreate.mock.calls[0][0]?.data?.token;
    expect(storedToken).toBe(hashToken(raw));
    expect(storedToken).not.toBe(raw);
  });

  it('valida y rota de forma transaccional (revoca el viejo y crea uno nuevo hasheado)', async () => {
    const rawOld = 'old-raw-token';
    mockFindUnique.mockImplementation((args) => {
      return args?.where?.token === hashToken(rawOld)
        ? (Promise.resolve(storedRow({ token: hashToken(rawOld) })) as never)
        : (Promise.resolve(null) as never);
    });
    mockUpdate.mockResolvedValue(storedRow({ token: hashToken(rawOld) }) as never);
    mockCreate.mockResolvedValue(storedRow({ token: 'new-hash' }) as never);
    mockTransaction.mockImplementation(
      (fn: any) => Promise.resolve(fn({ refreshToken: { update: mockUpdate, create: mockCreate } })),
    );

    const result = await validateAndRotateRefreshToken(rawOld);

    expect(result).not.toBeNull();
    expect(result?.userId).toBe('user-1');
    expect(result?.refreshToken).toBeTruthy();
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'refresh-1' }, data: { revokedAt: expect.any(Date) } }),
    );
    const createdToken = mockCreate.mock.calls[0][0]?.data?.token;
    expect(createdToken).toBe(hashToken(result?.refreshToken as string));
  });

  it('acepta tokens legados guardados en claro y los convierte a hash en la rotación', async () => {
    const legacyRaw = 'legacy-clear-token';
    mockFindUnique.mockImplementation((args) => {
      return args?.where?.token === legacyRaw
        ? (Promise.resolve(
            storedRow({ token: legacyRaw, revokedAt: null, expiresAt: new Date(Date.now() + 999_999) }),
          ) as never)
        : (Promise.resolve(null) as never);
    });
    mockUpdate.mockResolvedValue({} as never);
    mockCreate.mockResolvedValue({} as never);
    mockTransaction.mockImplementation(
      (fn: any) => Promise.resolve(fn({ refreshToken: { update: mockUpdate, create: mockCreate } })),
    );

    const result = await validateAndRotateRefreshToken(legacyRaw);

    expect(result?.userId).toBe('user-1');
    expect(result?.refreshToken).toBeTruthy();
    expect(mockFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { token: legacyRaw } }),
    );
  });

  it('rechaza tokens revocados o expirados', async () => {
    mockFindUnique.mockResolvedValue(
      storedRow({ token: 'h', revokedAt: new Date() }) as never,
    );
    expect(await validateAndRotateRefreshToken('anything')).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();

    mockFindUnique.mockResolvedValue(
      storedRow({ token: 'h2', expiresAt: new Date(Date.now() - 1000) }) as never,
    );
    expect(await validateAndRotateRefreshToken('anything')).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('revoca por hash y también por valor en claro (legado)', async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 } as never);

    await revokeRefreshToken('raw-token');

    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { token: hashToken('raw-token'), revokedAt: null } }),
    );
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { token: 'raw-token', revokedAt: null } }),
    );
  });

  it('lanza ante un fallo transitorio de la transacción en vez de devolver null', async () => {
    // Si la rotación falla por la BD, el token sigue válido: devolver null
    // haría que la ruta respondiera 401 y el cliente cerrara sesión
    // injustificadamente. Al lanzar, la ruta responde 5xx (transitorio).
    mockFindUnique.mockResolvedValue(
      storedRow({ token: 'hash', expiresAt: new Date(Date.now() + 999_999) }) as never,
    );
    mockTransaction.mockRejectedValue(new Error('db down'));

    await expect(validateAndRotateRefreshToken('raw-token')).rejects.toThrow('db down');
  });
});