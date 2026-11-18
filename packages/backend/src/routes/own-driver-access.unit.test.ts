import { buildApp } from '../app';
import { prisma } from '../config/database';
import * as refresh from '../services/refresh-token.service';
import * as refreshTokenService from '../services/refresh-token.service';
import bcryptjs from 'bcryptjs';

describe('own-driver HTTP access', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => { app = await buildApp({ enableJobs: false, enableSocketIO: false, enableRateLimit: false }); });
  afterAll(async () => { await app.close(); });
  afterEach(() => jest.restoreAllMocks());
  beforeEach(() => {
    jest.spyOn(refreshTokenService, 'revokeAllUserRefreshTokens').mockResolvedValue(undefined);
    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({ status: 'ACTIVE' } as never);
    jest.spyOn(prisma.user, 'findFirst').mockResolvedValue({ mustChangePassword: true } as never);
    jest.spyOn(prisma.driver, 'findFirst').mockResolvedValue({ id: 'driver', status: 'ACTIVE', user: { status: 'ACTIVE', mustChangePassword: true } } as never);
  });
  const headers = () => ({ authorization: `Bearer ${app.jwt.sign({ sub: 'own-driver-access', role: 'DRIVER', phone: '5512345678' })}` });
  it.each([
    ['GET', '/driver-panel/balance', undefined],
    ['GET', '/driver-panel/pedidos/pendientes', undefined],
    ['POST', '/driver-panel/qr/reclamar', { token: 'q'.repeat(43) }],
    ['PATCH', '/driver-panel/disponibilidad', { availability: 'AVAILABLE' }],
    ['PATCH', '/driver-panel/pedidos/order/accion', { action: 'start' }],
  ] as const)('blocks temporary-password operations: %s %s', async (method, url, payload) => {
    const response = await app.inject({ method, url, headers: headers(), payload });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });
  it('allows profile access but rejects foreign drivers', async () => {
    expect((await app.inject({ url: '/driver-panel/perfil', headers: headers() })).statusCode).toBe(200);
    jest.mocked(prisma.driver.findFirst).mockResolvedValueOnce(null);
    expect((await app.inject({ url: '/driver-panel/perfil', headers: headers() })).statusCode).toBe(403);
  });
  it('does not issue sessions for foreign driver login', async () => {
    jest.mocked(prisma.user.findFirst).mockResolvedValue({ id: 'foreign', role: 'DRIVER', password: 'unused' } as never);
    jest.mocked(prisma.driver.findFirst).mockResolvedValue(null);
    const issue = jest.spyOn(refresh, 'createRefreshToken').mockResolvedValue('unused');
    const response = await app.inject({ method: 'POST', url: '/auth/driver-login', payload: { phone: '5512345678', password: 'test-password' } });
    expect(response.statusCode).toBe(401);
    expect(issue).not.toHaveBeenCalled();
  });
  it('requires the existing password before clearing forced rotation', async () => {
    jest.mocked(prisma.user.findUnique).mockResolvedValue({ status: 'ACTIVE', password: await bcryptjs.hash('temporary-password', 4) } as never);
    const update = jest.spyOn(prisma.user, 'update').mockResolvedValue({} as never);
    const response = await app.inject({ method: 'PATCH', url: '/driver-panel/password', headers: headers(), payload: { currentPassword: 'incorrect-password', newPassword: 'personal-password' } });
    expect(response.statusCode).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });
  it('hashes the personal password and unlocks deliveries after successful rotation', async () => {
    jest.mocked(prisma.user.findUnique).mockResolvedValue({ status: 'ACTIVE', password: await bcryptjs.hash('temporary-password', 4) } as never);
    const update = jest.spyOn(prisma.user, 'update').mockResolvedValue({} as never);
    const response = await app.inject({ method: 'PATCH', url: '/driver-panel/password', headers: headers(), payload: { currentPassword: 'temporary-password', newPassword: 'personal-password' } });
    expect(response.statusCode).toBe(200);
    const data = update.mock.calls[0][0].data;
    expect(data.mustChangePassword).toBe(false);
    expect(await bcryptjs.compare('personal-password', data.password as string)).toBe(true);
    jest.mocked(prisma.user.findFirst).mockResolvedValue({ mustChangePassword: false } as never);
    jest.spyOn(prisma.order, 'findMany').mockResolvedValue([]);
    const deliveries = await app.inject({ url: '/driver-panel/pedidos/pendientes', headers: headers() });
    expect(deliveries.statusCode).toBe(200);
    expect(deliveries.json().data).toEqual([]);
  });
});
