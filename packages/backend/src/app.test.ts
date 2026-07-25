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
    });
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

  it('envia codigo OTP simulado', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/enviar-codigo',
      payload: {
        phone: '+5215512345678',
      },
    });

    const body = parseJson<{
      success: boolean;
      data: { phone: string; expiresInSeconds: number };
    }>(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.phone).toBe('5512345678');
    expect(body.data.expiresInSeconds).toBe(300);
  });

  it('verifica OTP y devuelve token para cliente nuevo', async () => {
    jest.spyOn(prisma.admin, 'count').mockResolvedValue(1);
    jest.spyOn(prisma.user, 'findFirst').mockResolvedValueOnce(null);
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

    await app.inject({
      method: 'POST',
      url: '/auth/enviar-codigo',
      payload: {
        phone: '+5215512345678',
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/verificar-codigo',
      payload: {
        phone: '+5215512345678',
        code: '123456',
        name: 'Cliente Prueba',
      },
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
  });

  it('permite bootstrap del primer administrador por OTP', async () => {
    jest.spyOn(prisma.admin, 'count').mockResolvedValue(0);
    jest.spyOn(prisma.user, 'findFirst').mockResolvedValue(null);
    jest.spyOn(prisma.user, 'create').mockResolvedValue({
      id: 'admin-user-1',
      email: '5599999999@sadel.local',
      password: 'otp-auth',
      phone: '5599999999',
      name: 'Admin Fundador',
      role: 'ADMIN',
      region: 'default',
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
      admin: null,
    } as never);
    jest.spyOn(prisma.admin, 'create').mockResolvedValue({
      id: 'admin-profile-1',
      userId: 'admin-user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    jest.spyOn(prisma.user, 'findUniqueOrThrow').mockResolvedValue({
      id: 'admin-user-1',
      email: '5599999999@sadel.local',
      password: 'otp-auth',
      phone: '5599999999',
      name: 'Admin Fundador',
      role: 'ADMIN',
      region: 'default',
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
      admin: {
        id: 'admin-profile-1',
        userId: 'admin-user-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    } as never);

    await app.inject({
      method: 'POST',
      url: '/auth/enviar-codigo',
      payload: {
        phone: '+5215599999999',
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/verificar-codigo',
      payload: {
        phone: '+5215599999999',
        code: '123456',
        name: 'Admin Fundador',
        role: 'ADMIN',
      },
    });

    const body = parseJson<{
      success: boolean;
      data: { token: string; user: { id: string; role: string; name: string } };
    }>(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(typeof body.data.token).toBe('string');
    expect(body.data.user.id).toBe('admin-user-1');
    expect(body.data.user.role).toBe('ADMIN');
    expect(body.data.user.name).toBe('Admin Fundador');
  });

  it('rechaza registrar un telefono ya existente', async () => {
    jest.spyOn(prisma.user, 'findFirst').mockResolvedValue({
      id: 'existing-user',
      phone: '5512345678',
    } as never);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/enviar-codigo',
      payload: {
        phone: '+5215512345678',
        intent: 'register',
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

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        phone: '+5215512345678',
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
