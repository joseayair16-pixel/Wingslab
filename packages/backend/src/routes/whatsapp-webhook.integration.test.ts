import { createHash, createHmac } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { getRedis } from '../config/redis';
import { logger } from '../utils/logger';

describe('webhook WhatsApp sin captura temporal', () => {
  let app: FastifyInstance;
  const redis = getRedis();
  const secret = process.env.WHATSAPP_WEBHOOK_APP_SECRET as string;

  beforeAll(async () => {
    app = await buildApp({ enableRateLimit: false, enableSocketIO: false, enableJobs: false });
  });
  afterAll(async () => { await app.close(); });
  afterEach(() => { jest.restoreAllMocks(); });

  async function deliver(body: unknown, signed = true) {
    const raw = JSON.stringify(body);
    const signature = createHmac('sha256', signed ? secret : 'incorrect').update(raw).digest('hex');
    return app.inject({ method: 'POST', url: '/webhooks/whatsapp', payload: raw,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${signature}` } });
  }

  function event(messages: unknown[]) {
    return { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { messages } }] }] };
  }

  it('rechaza firmas incorrectas y acepta mensajes firmados sin almacenarlos', async () => {
    const body = 'test-private-message';
    const logs = jest.spyOn(logger, 'info');
    const set = jest.spyOn(redis, 'set');
    const payload = event([{ type: 'text', from: '5215512345678', text: { body } }]);
    expect((await deliver(payload, false)).statusCode).toBe(401);
    const response = await deliver(payload);
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('OK');
    expect(set).not.toHaveBeenCalled();
    expect(JSON.stringify(logs.mock.calls)).not.toContain(body);
  });

  it('verifica el reto SADEL en Redis sin capturar el mensaje', async () => {
    const code = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    const messageKey = `whatsapp_auth:message:${createHash('sha256').update(code).digest('hex')}`;
    const challengeHash = createHash('sha256').update('test-challenge').digest('hex');
    const challengeKey = `whatsapp_auth:challenge:${challengeHash}`;
    await redis.set(challengeKey, JSON.stringify({ status: 'pending', intent: 'register', phone: '5512345678' }), 'EX', 300);
    await redis.set(messageKey, challengeHash, 'EX', 300);
    try {
      const response = await deliver(event([{ type: 'text', from: '5215512345678', text: { body: `SADEL ${code}` } }]));
      expect(response.statusCode).toBe(200);
      expect(JSON.parse((await redis.get(challengeKey)) as string).status).toBe('verified');
      expect(await redis.get(messageKey)).toBeNull();
    } finally { await redis.del(challengeKey, messageKey); }
  });

  it('elimina ambos endpoints administrativos temporales', async () => {
    for (const method of ['GET', 'DELETE'] as const) {
      expect((await app.inject({ method, url: '/admin/whatsapp/captura' })).statusCode).toBe(404);
    }
  });
});
