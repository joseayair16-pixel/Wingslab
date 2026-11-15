import { buildApp } from '../app';
import { prisma } from '../config/database';

function parseJson<T>(payload: string): T {
  return JSON.parse(payload) as T;
}

describe('GET /settings (configuración pública WingsLab)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

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

  it('devuelve solo configuración fija y no consulta datos bancarios heredados', async () => {
    const settingsQuery = jest.spyOn(prisma.systemSetting, 'findMany');
    const response = await app.inject({ method: 'GET', url: '/settings' });
    const body = parseJson<{ success: boolean; data: Record<string, unknown> }>(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.businessName).toBe('WingsLab');
    expect(body.data.adminBankAccount).toBeUndefined();
    expect(body.data.adminBankName).toBeUndefined();
    expect(body.data.adminBankBeneficiary).toBeUndefined();
    expect(settingsQuery).not.toHaveBeenCalled();
  });
});
