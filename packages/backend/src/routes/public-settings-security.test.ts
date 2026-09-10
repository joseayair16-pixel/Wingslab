import { UserRole } from '@prisma/client';
import { FastifyInstance } from 'fastify';

import { buildApp } from '../app';
import { prisma } from '../config/database';
import { encrypt } from '../utils/crypto';

function parseJson<T>(payload: string): T {
  return JSON.parse(payload) as T;
}

describe('GET /settings (protección de datos bancarios del negocio)', () => {
  let app: FastifyInstance;

  async function createToken(role: UserRole) {
    return app.jwt.sign({ sub: 'user-1', phone: '5512345678', role });
  }

  beforeAll(async () => {
    app = await buildApp({
      enableRateLimit: false,
      enableSocketIO: false,
      enableJobs: false,
    });
  });

  afterAll(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockSettings(findManyResult: unknown[]) {
    jest.spyOn(prisma.systemSetting, 'findMany').mockResolvedValue(findManyResult as never);
  }

  it('no expone datos bancarios a visitantes anónimos', async () => {
    mockSettings([
      { id: 's1', key: 'adminBankAccount', value: encrypt('9999 8888 7777 6666'), createdAt: new Date(), updatedAt: new Date() },
      { id: 's2', key: 'adminBankName', value: encrypt('Banco Santander'), createdAt: new Date(), updatedAt: new Date() },
      { id: 's3', key: 'socialInstagram', value: '@sadel', createdAt: new Date(), updatedAt: new Date() },
    ]);

    const response = await app.inject({ method: 'GET', url: '/settings' });
    const body = parseJson<{ success: boolean; data: Record<string, unknown> }>(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.adminBankAccount).toBeUndefined();
    expect(body.data.adminBankName).toBeUndefined();
    expect(body.data.adminBankBeneficiary).toBeUndefined();
    expect(body.data.socialInstagram).toBe('@sadel');
  });

  it('devuelve datos bancarios descifrados solo a usuarios autenticados', async () => {
    mockSettings([
      { id: 's1', key: 'adminBankAccount', value: encrypt('9999 8888 7777 6666'), createdAt: new Date(), updatedAt: new Date() },
      { id: 's2', key: 'adminBankName', value: encrypt('Banco Santander'), createdAt: new Date(), updatedAt: new Date() },
      { id: 's3', key: 'adminBankBeneficiary', value: encrypt('SaDeL'), createdAt: new Date(), updatedAt: new Date() },
    ]);

    const token = await createToken(UserRole.ADMIN);
    const response = await app.inject({
      method: 'GET',
      url: '/settings',
      headers: { authorization: `Bearer ${token}` },
    });
    const body = parseJson<{ success: boolean; data: Record<string, unknown> }>(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.data.adminBankAccount).toBe('9999 8888 7777 6666');
    expect(body.data.adminBankName).toBe('Banco Santander');
    expect(body.data.adminBankBeneficiary).toBe('SaDeL');
  });
});