/**
 * Middleware `authenticate` / `authorize`: el contrato de estados que el
 * cliente usa para decidir entre renovar, conservar o cerrar sesión.
 * - Token inválido/expirado o usuario eliminado → 401 (renovable vía refresh).
 * - Cuenta INACTIVE → 403 ACCOUNT_DISABLED (flujo explícito, no "expirada").
 * - Rol distinto → 403 FORBIDDEN (no cierra sesión válida).
 * - Fallo de BD al verificar estado → 503 (transitorio, nunca 401).
 */
import { prisma } from '../config/database';
import { authenticate, authorize } from './auth';

const mockFindUnique = jest.spyOn(prisma.user, 'findUnique');

function authedRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'req-test-1',
    headers: {},
    jwtVerify: jest.fn().mockResolvedValue(undefined),
    user: { sub: 'user-1', phone: '+520000000000', role: 'CUSTOMER' },
    ...overrides,
  } as any;
}

function makeReply() {
  const reply: any = {
    status: jest.fn(),
    send: jest.fn(),
  };
  reply.status.mockReturnValue(reply);
  return reply;
}

describe('authenticate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('401 cuando el JWT es inválido o expiró', async () => {
    const request = authedRequest({ jwtVerify: jest.fn().mockRejectedValue(new Error('expired')) });
    const reply = makeReply();

    await authenticate(request, reply);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'UNAUTHORIZED' }) }),
    );
  });

  it('401 cuando el usuario ya no existe', async () => {
    mockFindUnique.mockResolvedValue(null as never);
    const reply = makeReply();

    await authenticate(authedRequest(), reply);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(mockFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' } }),
    );
  });

  it('403 ACCOUNT_DISABLED con cuenta INACTIVE (no finge sesión expirada)', async () => {
    mockFindUnique.mockResolvedValue({ status: 'INACTIVE' } as never);
    const reply = makeReply();

    await authenticate(authedRequest(), reply);

    expect(reply.status).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'ACCOUNT_DISABLED' }) }),
    );
  });

  it('503 (no 401) cuando la BD falla al verificar el estado', async () => {
    // Un blip de Postgres no son credenciales inválidas: con 401 el cliente
    // cerraría sesión; con 503 lo trata como transitorio y reintenta.
    // (sub distinto: el middleware cachea el estado por usuario 30s.)
    mockFindUnique.mockRejectedValue(new Error('db down'));
    const reply = makeReply();

    await authenticate(authedRequest({ user: { sub: 'user-db', phone: '+520000000000', role: 'CUSTOMER' } }), reply);

    expect(reply.status).toHaveBeenCalledWith(503);
    expect(reply.status).not.toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'AUTH_VALIDATION_ERROR' }) }),
    );
  });

  it('deja pasar con cuenta ACTIVE sin responder nada', async () => {
    mockFindUnique.mockResolvedValue({ status: 'ACTIVE' } as never);
    const reply = makeReply();

    await authenticate(
      authedRequest({ user: { sub: 'user-active', phone: '+520000000000', role: 'CUSTOMER' } }),
      reply,
    );

    expect(reply.status).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });
});

describe('authorize', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('403 FORBIDDEN con rol distinto (el cliente no debe cerrar sesión)', async () => {
    const reply = makeReply();

    await authorize(['ADMIN' as never])(authedRequest(), reply);

    expect(reply.status).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'FORBIDDEN' }) }),
    );
  });

  it('deja pasar con el rol permitido', async () => {
    const reply = makeReply();

    await authorize(['CUSTOMER' as never])(authedRequest(), reply);

    expect(reply.status).not.toHaveBeenCalled();
  });
});
