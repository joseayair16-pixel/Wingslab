import { FastifyInstance } from 'fastify';
import bcryptjs from 'bcryptjs';

import { buildApp } from './app';
import { prisma } from './config/database';
import { UserRole } from '@prisma/client';
import { resetMetrics } from './utils/metrics';

function parseJson<T>(payload: string): T {
  return JSON.parse(payload) as T;
}

describe('app integration', () => {
  let app: FastifyInstance;

  async function createToken(payload: { sub: string; phone: string; role: UserRole }) {
    return app.jwt.sign(payload);
  }

  beforeAll(async () => {
    app = await buildApp({
      enableRateLimit: false,
      enableSocketIO: false,
      enableJobs: false,
    });
  });

  beforeEach(() => {
    // Hermeticidad: sin Postgres/Redis reales. El middleware de auth revalida el
    // estado del usuario en BD, así que concedemos estado ACTIVE por defecto.
    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({ status: 'ACTIVE' } as never);
    jest.spyOn(prisma, '$queryRaw').mockResolvedValue([{ x: 1 }] as never);
  });

  afterAll(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('responde health correctamente', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    const body = parseJson<{ status: string; environment: string }>(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.status).toBe('ok');
    expect(typeof body.environment).toBe('string');
    expect(typeof response.headers['x-request-id']).toBe('string');
  });

  it('propaga x-request-id del cliente cuando se envia en headers', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: {
        'x-request-id': 'req-from-client-123',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toBe('req-from-client-123');
  });

  it('responde preflight OPTIONS sin romper request context', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: {
        origin: 'http://localhost:3002',
        'access-control-request-method': 'GET',
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
  });

  it('envía código OTP por correo en modo de prueba', async () => {
    jest.spyOn(prisma.user, 'findFirst').mockResolvedValue(null);
    const response = await app.inject({
      method: 'POST',
      url: '/auth/email-otp/iniciar',
      payload: {
        phone: '5512345678',
        intent: 'register',
        email: 'Cliente@Example.com',
        name: 'Cliente',
        lastName: 'Prueba',
        dateOfBirth: '1990-01-01',
      },
    });

    const body = parseJson<{
      success: boolean;
      data: { challengeId: string; maskedEmail: string; expiresInSeconds: number; mockCode?: string };
    }>(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.challengeId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.data.maskedEmail).toBe('cl•••••@example.com');
    expect(body.data.expiresInSeconds).toBe(300);
    expect(body.data.mockCode).toMatch(/^\d{6}$/);
  });

  it('verifica OTP por correo y crea la cuenta del cliente', async () => {
    jest.spyOn(prisma.user, 'findFirst').mockResolvedValue(null);
    jest.spyOn(prisma.admin, 'count').mockResolvedValue(1);
    jest.spyOn(prisma.user, 'create').mockResolvedValue({
      id: 'user-1',
      email: '5512345678@sadel.local',
      password: 'otp-auth',
      phone: '5512345678',
      name: 'Cliente Prueba',
      role: 'CUSTOMER',
      region: 'default',
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
      admin: null,
    } as never);
    jest.spyOn(prisma.customer, 'create').mockResolvedValue({
      id: 'customer-1',
      userId: 'user-1',
      rating: 0,
      totalOrders: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    jest.spyOn(prisma.user, 'findUniqueOrThrow').mockResolvedValue({
      id: 'user-1',
      email: '5512345678@sadel.local',
      password: 'otp-auth',
      phone: '5512345678',
      name: 'Cliente Prueba',
      role: 'CUSTOMER',
      region: 'default',
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
      admin: null,
    } as never);
    jest.spyOn(prisma.customer, 'findUnique').mockResolvedValue({
      id: 'customer-1',
      userId: 'user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    jest.spyOn(prisma.refreshToken, 'create').mockResolvedValue({
      id: 'refresh-1',
      token: 'refresh-token-1',
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      revokedAt: null,
    } as never);

    const sendResponse = await app.inject({
      method: 'POST',
      url: '/auth/email-otp/iniciar',
      payload: {
        phone: '5512345678',
        intent: 'register',
        email: 'Cliente@Example.com',
        name: 'Cliente',
        lastName: 'Prueba',
        dateOfBirth: '1990-01-01',
      },
    });
    const sendBody = parseJson<{ success: boolean; data: { challengeId: string; mockCode?: string } }>(
      sendResponse.body
    );

    const verifyResponse = await app.inject({
      method: 'POST',
      url: '/auth/email-otp/confirmar',
      payload: {
        challengeId: sendBody.data.challengeId,
        code: sendBody.data.mockCode ?? '000000',
      },
    });
    const verifyBody = parseJson<{ success: boolean; data: { registerToken: string } }>(verifyResponse.body);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/complete-register',
      headers: { authorization: `Bearer ${verifyBody.data.registerToken}` },
      payload: { password: 'secreto123' },
    });

    const body = parseJson<{
      success: boolean;
      data: { token: string; user: { id: string; role: string } };
    }>(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(typeof body.data.token).toBe('string');
    expect(body.data.user.id).toBe('user-1');
    expect(body.data.user.role).toBe('CUSTOMER');
    expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ email: 'cliente@example.com' }),
    }));
  });

  it('rechaza correos ya registrados sin distinguir mayúsculas', async () => {
    jest.spyOn(prisma.user, 'findFirst')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'existing-user' } as never);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/email-otp/iniciar',
      payload: {
        phone: '5512345678',
        intent: 'register',
        email: 'Cliente@Example.com',
        name: 'Cliente',
        lastName: 'Prueba',
        dateOfBirth: '1990-01-01',
      },
    });
    const body = parseJson<{ success: boolean; error: { code: string } }>(response.body);

    expect(response.statusCode).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
    expect(prisma.user.findFirst).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { email: { equals: 'cliente@example.com', mode: 'insensitive' } },
    }));
  });

  it('rechaza el alta si la restricción de unicidad detecta una carrera', async () => {
    jest.spyOn(prisma.user, 'findFirst').mockResolvedValue(null);
    jest.spyOn(prisma.user, 'create').mockRejectedValue({ code: 'P2002' } as never);
    const registerToken = app.jwt.sign({
      phone: '5512345678',
      email: 'Cliente@Example.com',
      name: 'Cliente',
      lastName: 'Prueba',
      verification: 'email',
      intent: 'register_confirm',
    }, { expiresIn: '15m' });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/complete-register',
      headers: { authorization: `Bearer ${registerToken}` },
      payload: { password: 'secreto123' },
    });
    const body = parseJson<{ success: boolean; error: { code: string } }>(response.body);

    expect(response.statusCode).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('ACCOUNT_CONFLICT');
    expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ email: 'cliente@example.com' }),
    }));
  });

  it('permite recuperar la contraseña con un código enviado al correo', async () => {
    const user = {
      id: 'customer-user-email-recovery',
      phone: '5512345678',
      phoneNormalized: '5512345678',
      email: 'cliente@example.com',
      role: 'CUSTOMER',
    };
    jest.spyOn(prisma.user, 'findFirst').mockResolvedValue(user as never);
    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue(user as never);
    const updateUser = jest.spyOn(prisma.user, 'update').mockResolvedValue(user as never);

    const sendResponse = await app.inject({
      method: 'POST',
      url: '/auth/email-otp/iniciar',
      payload: { phone: user.phone, intent: 'recovery' },
    });
    const sendBody = parseJson<{ data: { challengeId: string; mockCode?: string } }>(sendResponse.body);

    const verifyResponse = await app.inject({
      method: 'POST',
      url: '/auth/email-otp/confirmar',
      payload: { challengeId: sendBody.data.challengeId, code: sendBody.data.mockCode },
    });
    const verifyBody = parseJson<{ data: { resetToken: string } }>(verifyResponse.body);

    const resetResponse = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      headers: { authorization: `Bearer ${verifyBody.data.resetToken}` },
      payload: { newPassword: 'nueva-clave-123' },
    });

    expect(sendResponse.statusCode).toBe(200);
    expect(verifyResponse.statusCode).toBe(200);
    expect(resetResponse.statusCode).toBe(200);
    expect(updateUser).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: user.id },
      data: { password: expect.any(String) },
    }));
  });

  it('rechaza registrar un telefono ya existente', async () => {
    jest.spyOn(prisma.user, 'findFirst').mockResolvedValue({
      id: 'existing-user',
      phone: '5512345678',
    } as never);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/email-otp/iniciar',
      payload: {
        phone: '5512345678',
        intent: 'register',
        email: 'cliente@example.com',
        name: 'Cliente',
        lastName: 'Prueba',
        dateOfBirth: '1990-01-01',
      },
    });

    const body = parseJson<{
      success: boolean;
      error: { code: string; message: string };
    }>(response.body);

    expect(response.statusCode).toBe(409);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('PHONE_ALREADY_REGISTERED');
  });

  it('permite iniciar sesion con telefono y contraseña', async () => {
    const hashedPassword = await bcryptjs.hash('secreto123', 10);

    jest.spyOn(prisma.user, 'findFirst').mockResolvedValue({
      id: 'customer-user-1',
      email: '5512345678@sadel.local',
      password: hashedPassword,
      phone: '5512345678',
      name: 'Cliente Login',
      role: 'CUSTOMER',
      region: 'default',
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
      customer: null,
    } as never);

    jest.spyOn(prisma.refreshToken, 'create').mockResolvedValue({
      id: 'refresh-1',
      token: 'refresh-token-1',
      userId: 'customer-user-1',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      revokedAt: null,
    } as never);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        phone: '5512345678',
        password: 'secreto123',
      },
    });

    const body = parseJson<{
      success: boolean;
      data: { token: string; user: { id: string; role: string; phone: string } };
    }>(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(typeof body.data.token).toBe('string');
    expect(body.data.user.id).toBe('customer-user-1');
    expect(body.data.user.role).toBe('CUSTOMER');
    expect(body.data.user.phone).toBe('5512345678');
  });

  it('rechaza panel de restaurante cuando el token pertenece a un cliente', async () => {
    const token = await createToken({
      sub: 'customer-user-1',
      phone: '+5215512345678',
      role: UserRole.CUSTOMER,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/restaurant-panel/perfil',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    const body = parseJson<{
      success: boolean;
      error: { code: string; message: string };
    }>(response.body);

    expect(response.statusCode).toBe(403);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('rechaza acceso a ruta protegida sin token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/me/pedidos',
    });

    const body = parseJson<{
      success: boolean;
      error: { code: string };
    }>(response.body);

    expect(response.statusCode).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('expone metricas operativas basicas para administracion', async () => {
    resetMetrics();

    await app.inject({
      method: 'GET',
      url: '/health',
    });

    await app.inject({
      method: 'GET',
      url: '/me/pedidos',
    });

    const token = await createToken({
      sub: 'admin-user-1',
      phone: '+5215522222222',
      role: UserRole.ADMIN,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/admin/observabilidad/metricas',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    const body = parseJson<{
      success: boolean;
      data: {
        totals: { requests: number; errors: number; errorRate: number };
        routes: Array<{ route: string; count: number; errorCount: number }>;
        errorsByCode: Array<{ code: string; count: number }>;
      };
    }>(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.totals.requests).toBeGreaterThanOrEqual(2);
    expect(body.data.totals.errors).toBeGreaterThanOrEqual(1);
    expect(body.data.routes.some((route) => route.route === '/health')).toBe(true);
    expect(body.data.routes.some((route) => route.route === '/me/pedidos')).toBe(true);
    expect(body.data.errorsByCode.some((error) => error.code === 'UNAUTHORIZED')).toBe(true);
  });
});
