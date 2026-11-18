import { FastifyInstance } from 'fastify';
import { UserRole } from '@prisma/client';
import { buildApp } from '../app';
import { prisma } from '../config/database';
import * as content from '../services/menu-content.service';

describe('Menu content access and publication', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp({ enableRateLimit: false, enableSocketIO: false, enableJobs: false }); });
  beforeEach(() => {
    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({ status: 'ACTIVE' } as never);
    jest.spyOn(prisma.restaurant, 'findFirst').mockResolvedValue({ id: 'wingslab' } as never);
    jest.spyOn(prisma.restaurant, 'findUnique').mockResolvedValue({ id: 'wingslab', userId: 'menu-owner', status: 'ACTIVE' } as never);
    jest.spyOn(content, 'readMenuContent').mockResolvedValue({ revision: 0, items: [] });
    jest.spyOn(content, 'saveMenuContent').mockResolvedValue({ revision: 1, items: [] });
    jest.spyOn(content, 'saveMenuImage').mockResolvedValue({ id: 'image' });
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => { await app.close(); });
  const token = (role: UserRole) => app.jwt.sign({ sub: 'menu-owner', role, phone: '5500000010' });
  it('rejects anonymous and customer edits before writing anything', async () => {
    for (const headers of [{}, { authorization: `Bearer ${token(UserRole.CUSTOMER)}` }]) {
      const response = await app.inject({ method: 'PUT', url: '/restaurant-panel/menu-content', headers, payload: { revision: 0, items: [] } });
      expect([401, 403]).toContain(response.statusCode);
    }
    expect(content.saveMenuContent).not.toHaveBeenCalled();
  });
  it('requires ownership and validates image input', async () => {
    const headers = { authorization: `Bearer ${token(UserRole.RESTAURANT)}` };
    jest.mocked(prisma.restaurant.findFirst).mockResolvedValueOnce(null);
    const denied = await app.inject({ method: 'GET', url: '/restaurant-panel/menu-content', headers });
    expect({ status: denied.statusCode, body: denied.json() }).toEqual({ status: 403, body: { success: false, error: { message: 'Solo el dueño de WingsLab puede editar este contenido.' } } });
    expect((await app.inject({ method: 'POST', url: '/restaurant-panel/menu-images', headers, payload: { source: 42 } })).statusCode).toBe(400);
    expect(content.saveMenuImage).not.toHaveBeenCalled();
    const response = await app.inject({ method: 'PUT', url: '/restaurant-panel/menu-content', headers, payload: { revision: 0, items: [] } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.revision).toBe(1);
  });
  it('public content is audience filtered and not cached across sessions', async () => {
    const base = { id: 'test', kind: 'modal' as const, title: 'Test', text: '', imageId: 'image', targetUrl: '', buttonLabel: '', active: true, audience: 'customers' as const, frequency: 'once' as const, startsAt: null, endsAt: null };
    jest.mocked(content.readMenuContent).mockResolvedValue({ revision: 1, items: [base] });
    const visitor = await app.inject('/public/menu-content');
    expect(visitor.statusCode).toBe(200);
    expect(visitor.json().data).toEqual([]);
    expect(visitor.headers['cache-control']).toBe('no-store');
    const customer = await app.inject({ url: '/public/menu-content', headers: { authorization: `Bearer ${token(UserRole.CUSTOMER)}` } });
    expect(customer.json().data).toHaveLength(1);
    const invalid = await app.inject({ url: '/public/menu-content', headers: { authorization: 'Bearer invalid' } });
    expect(invalid.statusCode).toBe(401);
  });
});
