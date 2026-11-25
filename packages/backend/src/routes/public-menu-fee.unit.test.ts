import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { prisma } from '../config/database';

describe('public menu service fee', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp({ enableRateLimit: false, enableSocketIO: false, enableJobs: false }); });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => { await app.close(); });

  it.each([8, 0])('returns the configured fee %s without exposing private fields', async (fee) => {
    jest.spyOn(prisma.restaurant, 'findFirst').mockResolvedValue({
      id: 'wingslab', name: 'WingsLab', status: 'ACTIVE', isAcceptingOrders: true,
      isPaused: false, operatingHours: [], categories: [], storeCategories: [],
      serviceFee: fee, region: 'test', hasOwnDelivery: true, userId: 'private-owner',
    } as never);
    jest.spyOn(prisma.region, 'findUnique').mockResolvedValue(null);
    const response = await app.inject('/menu');
    expect(response.statusCode).toBe(200);
    expect(response.json().data.serviceFee).toBe(fee);
    expect(response.json().data).not.toHaveProperty('userId');
  });
});
