import { UserRole } from '@prisma/client';
import { buildApp } from '../app';
import { prisma } from '../config/database';

describe('directorio de clientes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => { app = await buildApp({ enableRateLimit: false, enableSocketIO: false, enableJobs: false }); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => {
    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({ status: 'ACTIVE' } as never);
    jest.spyOn(prisma.restaurant, 'findUnique').mockResolvedValue({ id: 'restaurant-1', userId: 'owner', status: 'ACTIVE' } as never);
  });
  afterEach(() => jest.restoreAllMocks());
  const token = (role = UserRole.RESTAURANT) => app.jwt.sign({ sub: 'owner', role });

  it('incluye cuentas sin compras y pagina antes de agregar sus estadísticas', async () => {
    const count = jest.spyOn(prisma.customer, 'count').mockResolvedValue(21 as never);
    const find = jest.spyOn(prisma.customer, 'findMany').mockResolvedValue([{ id: 'customer-1', user: { name: 'Ana', lastName: null, email: 'ana@example.com', phone: '5512345678', status: 'ACTIVE', createdAt: new Date() } }] as never);
    jest.spyOn(prisma.order, 'groupBy').mockResolvedValue([] as never);
    const response = await app.inject({ method: 'GET', url: '/restaurant-panel/directorio-clientes?page=2&limit=20&status=ACTIVE', headers: { authorization: `Bearer ${token()}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ total: 21, totalPages: 2, items: [{ id: 'customer-1', orderCount: 0, totalSpent: 0 }] });
    expect(count).toHaveBeenCalled();
    expect(find).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 20 }));
  });

  it('exige rol de restaurante y valida el motivo antes de escribir', async () => {
    const tx = jest.spyOn(prisma, '$transaction');
    const denied = await app.inject({ method: 'POST', url: '/restaurant-panel/directorio-clientes/customer-1/suspender', headers: { authorization: `Bearer ${token(UserRole.CUSTOMER)}` }, payload: { reason: 'Motivo válido' } });
    expect(denied.statusCode).toBe(403);
    const invalid = await app.inject({ method: 'POST', url: '/restaurant-panel/directorio-clientes/customer-1/suspender', headers: { authorization: `Bearer ${token()}` }, payload: { reason: 'no' } });
    expect(invalid.statusCode).toBe(400);
    expect(tx).not.toHaveBeenCalled();
  });

  it('suspende solo una cuenta activa y registra el motivo en la misma transacción', async () => {
    const tx = { customer: { findFirst: jest.fn().mockResolvedValue({ userId: 'user-1' }) }, user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findUniqueOrThrow: jest.fn().mockResolvedValue({ updatedAt: new Date('2026-01-01T00:00:00Z') }) }, auditLog: { create: jest.fn().mockResolvedValue({}) } };
    jest.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback(tx) as never);
    const response = await app.inject({ method: 'POST', url: '/restaurant-panel/directorio-clientes/customer-1/suspender', headers: { authorization: `Bearer ${token()}` }, payload: { reason: 'Actividad irregular' } });
    expect(response.statusCode).toBe(200);
    expect(tx.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'user-1', role: 'CUSTOMER', status: 'ACTIVE' }, data: { status: 'SUSPENDED' } }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: 'owner', entityId: 'customer-1', action: 'CUSTOMER_SUSPENDED_BY_RESTAURANT' }) }));
  });

  it('reactiva únicamente una suspensión manual verificable y registra la acción', async () => {
    const updatedAt = new Date('2026-01-01T00:00:00Z');
    const tx = { customer: { findFirst: jest.fn().mockResolvedValue({ userId: 'user-1', isSuspendedByDebt: false, user: { status: 'SUSPENDED', updatedAt } }) }, user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) }, auditLog: { findFirst: jest.fn().mockResolvedValue({ action: 'CUSTOMER_SUSPENDED_BY_RESTAURANT', newValue: JSON.stringify({ updatedAt: updatedAt.toISOString() }) }), create: jest.fn().mockResolvedValue({}) } };
    jest.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback(tx) as never);
    const response = await app.inject({ method: 'POST', url: '/restaurant-panel/directorio-clientes/customer-1/reactivar', headers: { authorization: `Bearer ${token()}` } });
    expect(response.statusCode).toBe(200);
    expect(tx.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: 'SUSPENDED', updatedAt, customer: { isSuspendedByDebt: false } }), data: { status: 'ACTIVE' } }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'CUSTOMER_REACTIVATED_BY_RESTAURANT' }) }));
  });

  it.each(['deuda', 'cambio', 'origen'])('no reactiva ante %s sin comprobación segura', async cause => {
    const updatedAt = new Date('2026-01-01T00:00:00Z');
    const tx = { customer: { findFirst: jest.fn().mockResolvedValue({ userId: 'user-1', isSuspendedByDebt: cause === 'deuda', user: { status: 'SUSPENDED', updatedAt } }) }, user: { updateMany: jest.fn() }, auditLog: { findFirst: jest.fn().mockResolvedValue({ action: cause === 'origen' ? 'OTHER' : 'CUSTOMER_SUSPENDED_BY_RESTAURANT', newValue: JSON.stringify({ updatedAt: cause === 'cambio' ? '2025-01-01T00:00:00.000Z' : updatedAt.toISOString() }) }), create: jest.fn() } };
    jest.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => callback(tx) as never);
    const response = await app.inject({ method: 'POST', url: '/restaurant-panel/directorio-clientes/customer-1/reactivar', headers: { authorization: `Bearer ${token()}` } });
    expect(response.statusCode).toBe(409);
    expect(tx.user.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
