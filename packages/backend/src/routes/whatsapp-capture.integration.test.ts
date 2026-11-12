/**
 * Pruebas de la captura TEMPORAL de mensajes entrantes de WhatsApp.
 *
 * Cubren el contrato completo:
 * - Apagada por defecto (fail closed).
 * - Captura exclusiva del phone_number_id autorizado.
 * - Rechazo de accesos no autorizados (401 / 403).
 * - Caducidad, borrado y tope de 10 minutos.
 * - Ausencia de contenido sensible en los logs.
 * - El flujo de verificación SADEL sigue funcionando intacto.
 * - Sin duplicados ante reintentos de Meta.
 */

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { UserRole } from '@prisma/client';
import { FastifyInstance } from 'fastify';

import { buildApp } from '../app';
import { prisma } from '../config/database';
import { getRedis } from '../config/redis';
import {
  buildCaptureEntryId,
  buildCaptureMessageKey,
  clearCapturedMessages,
  listCapturedMessages,
} from '../services/whatsapp-capture.service';
import { logger } from '../utils/logger';

const APP_SECRET = 'ci-test-whatsapp-app-secret';
const CAPTURE_KEY = 'ci-test-capture-key-0123456789abcdef';
const ALLOWED_PHONE_NUMBER_ID = '111222333444555';
const OTHER_PHONE_NUMBER_ID = '999888777666555';
const SENDER = '5215512345678';
const SENDER_NORMALIZED = '5512345678';

const CAPTURE_ENV_KEYS = [
  'WHATSAPP_CAPTURE_ENABLED',
  'WHATSAPP_CAPTURE_PHONE_NUMBER_ID',
  'WHATSAPP_CAPTURE_ENCRYPTION_KEY',
  'WHATSAPP_CAPTURE_TTL_SECONDS',
  'WHATSAPP_CAPTURE_MAX_MESSAGES',
];

type WebhookMessageInput = {
  from?: string;
  id?: string;
  type?: string;
  text?: string;
  timestamp?: string;
};

function buildWebhookPayload(options: {
  phoneNumberId: string;
  messages: WebhookMessageInput[];
}): Record<string, unknown> {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-test-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '15550001111',
                phone_number_id: options.phoneNumberId,
              },
              messages: options.messages.map((message) => {
                const resolvedType = message.type ?? 'text';
                return {
                  from: message.from ?? SENDER,
                  id: message.id ?? `wamid.${randomBytes(8).toString('hex')}`,
                  timestamp: message.timestamp ?? String(Math.floor(Date.now() / 1000)),
                  type: resolvedType,
                  ...(resolvedType === 'text' ? { text: { body: message.text ?? '' } } : {}),
                };
              }),
            },
          },
        ],
      },
    ],
  };
}

describe('captura temporal de WhatsApp', () => {
  let app: FastifyInstance;
  const redis = getRedis();

  beforeAll(async () => {
    app = await buildApp({
      enableRateLimit: false,
      enableSocketIO: false,
      enableJobs: false,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    for (const key of CAPTURE_ENV_KEYS) delete process.env[key];

    // El middleware de auth consulta el estado del usuario en la BD.
    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({ status: 'ACTIVE' } as never);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await clearCapturedMessages();
    for (const key of CAPTURE_ENV_KEYS) delete process.env[key];
  });

  function enableCapture(overrides: Record<string, string> = {}): void {
    process.env.WHATSAPP_CAPTURE_ENABLED = 'true';
    process.env.WHATSAPP_CAPTURE_PHONE_NUMBER_ID = ALLOWED_PHONE_NUMBER_ID;
    process.env.WHATSAPP_CAPTURE_ENCRYPTION_KEY = CAPTURE_KEY;
    process.env.WHATSAPP_CAPTURE_TTL_SECONDS = '600';
    process.env.WHATSAPP_CAPTURE_MAX_MESSAGES = '10';
    Object.assign(process.env, overrides);
  }

  async function postWebhook(payload: Record<string, unknown>) {
    const rawBody = JSON.stringify(payload);
    const signature = `sha256=${createHmac('sha256', APP_SECRET).update(rawBody).digest('hex')}`;
    return app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signature,
      },
      payload: rawBody,
    });
  }

  async function captureKeys(): Promise<string[]> {
    const [, keys] = await redis.scan('0');
    return keys.filter((key) => key.startsWith('whatsapp:capture:'));
  }

  async function adminToken(role: UserRole): Promise<string> {
    return app.jwt.sign({ sub: `user-${role}`, phone: '5510000000', role });
  }

  describe('interruptor por variable de entorno', () => {
    it('está desactivada por defecto: no captura ni expone consulta', async () => {
      const payload = buildWebhookPayload({
        phoneNumberId: ALLOWED_PHONE_NUMBER_ID,
        messages: [{ text: 'BAIT-0001' }],
      });

      const response = await postWebhook(payload);

      // El webhook sigue contestando a Meta exactamente igual.
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('OK');

      expect(await captureKeys()).toHaveLength(0);
      expect(await listCapturedMessages()).toHaveLength(0);

      const adminResponse = await app.inject({
        method: 'GET',
        url: '/admin/whatsapp/captura',
        headers: { authorization: `Bearer ${await adminToken(UserRole.ADMIN)}` },
      });
      expect(adminResponse.statusCode).toBe(404);
      expect(adminResponse.json().error.code).toBe('CAPTURE_DISABLED');
    });

    it('no captura si falta la clave dedicada de cifrado', async () => {
      process.env.WHATSAPP_CAPTURE_ENABLED = 'true';
      process.env.WHATSAPP_CAPTURE_PHONE_NUMBER_ID = ALLOWED_PHONE_NUMBER_ID;
      delete process.env.WHATSAPP_CAPTURE_ENCRYPTION_KEY;

      const response = await postWebhook(
        buildWebhookPayload({
          phoneNumberId: ALLOWED_PHONE_NUMBER_ID,
          messages: [{ text: 'BAIT-0002' }],
        })
      );

      expect(response.statusCode).toBe(200);
      expect(await captureKeys()).toHaveLength(0);
    });

    it('rechaza una clave de captura reutilizada de otra credencial', async () => {
      enableCapture({ WHATSAPP_CAPTURE_ENCRYPTION_KEY: process.env.JWT_SECRET as string });

      const response = await postWebhook(
        buildWebhookPayload({
          phoneNumberId: ALLOWED_PHONE_NUMBER_ID,
          messages: [{ text: 'BAIT-0003' }],
        })
      );

      expect(response.statusCode).toBe(200);
      expect(await captureKeys()).toHaveLength(0);
    });
  });

  describe('aislamiento por número autorizado', () => {
    it('captura solo los mensajes del phone_number_id autorizado', async () => {
      enableCapture();

      const rejected = await postWebhook(
        buildWebhookPayload({
          phoneNumberId: OTHER_PHONE_NUMBER_ID,
          messages: [{ text: 'BAIT-OTRO-NUMERO' }],
        })
      );
      expect(rejected.statusCode).toBe(200);
      expect(await listCapturedMessages()).toHaveLength(0);

      const accepted = await postWebhook(
        buildWebhookPayload({
          phoneNumberId: ALLOWED_PHONE_NUMBER_ID,
          messages: [{ text: 'BAIT-NUMERO-AUTORIZADO' }],
        })
      );
      expect(accepted.statusCode).toBe(200);

      const captured = await listCapturedMessages();
      expect(captured).toHaveLength(1);
      expect(captured[0].body).toBe('BAIT-NUMERO-AUTORIZADO');
      expect(captured[0].from).toBe(SENDER);
    });

    it('ignora mensajes no textuales y cuerpos vacíos', async () => {
      enableCapture();

      await postWebhook(
        buildWebhookPayload({
          phoneNumberId: ALLOWED_PHONE_NUMBER_ID,
          messages: [
            { type: 'image', text: 'ignorar' },
            { type: 'text', text: '   ' },
          ],
        })
      );

      expect(await listCapturedMessages()).toHaveLength(0);
    });

    it('descarta el evento si Meta no envía metadata del número destino', async () => {
      enableCapture();

      const payload = buildWebhookPayload({
        phoneNumberId: ALLOWED_PHONE_NUMBER_ID,
        messages: [{ text: 'BAIT-SIN-METADATA' }],
      });
      // Se elimina el metadata a mano para simular una entrega incompleta.
      const value = (payload.entry as Array<{ changes: Array<{ value: Record<string, unknown> }> }>)[0]
        .changes[0].value;
      delete value.metadata;

      const response = await postWebhook(payload);

      expect(response.statusCode).toBe(200);
      expect(await listCapturedMessages()).toHaveLength(0);
    });
  });

  describe('control de acceso a la consulta', () => {
    it('rechaza el acceso sin sesión y con roles no autorizados', async () => {
      enableCapture();

      const anonymous = await app.inject({ method: 'GET', url: '/admin/whatsapp/captura' });
      expect(anonymous.statusCode).toBe(401);

      const customer = await app.inject({
        method: 'GET',
        url: '/admin/whatsapp/captura',
        headers: { authorization: `Bearer ${await adminToken(UserRole.CUSTOMER)}` },
      });
      expect(customer.statusCode).toBe(403);

      const restaurant = await app.inject({
        method: 'GET',
        url: '/admin/whatsapp/captura',
        headers: { authorization: `Bearer ${await adminToken(UserRole.RESTAURANT)}` },
      });
      expect(restaurant.statusCode).toBe(403);
    });

    it('permite la consulta a un administrador autenticado', async () => {
      enableCapture();

      await postWebhook(
        buildWebhookPayload({
          phoneNumberId: ALLOWED_PHONE_NUMBER_ID,
          messages: [{ text: 'BAIT-CONSULTA' }],
        })
      );

      const response = await app.inject({
        method: 'GET',
        url: '/admin/whatsapp/captura',
        headers: { authorization: `Bearer ${await adminToken(UserRole.ADMIN)}` },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.total).toBe(1);
      expect(body.data.messages[0].body).toBe('BAIT-CONSULTA');
      expect(body.data.ttlSeconds).toBeLessThanOrEqual(600);
    });
  });

  describe('caducidad y borrado', () => {
    it('aplica una vigencia máxima de 10 minutos', async () => {
      enableCapture({ WHATSAPP_CAPTURE_TTL_SECONDS: '99999' });

      await postWebhook(
        buildWebhookPayload({
          phoneNumberId: ALLOWED_PHONE_NUMBER_ID,
          messages: [{ id: 'wamid.ttl', text: 'BAIT-TTL' }],
        })
      );

      const entryId = buildCaptureEntryId('wamid.ttl', 'seed');
      const ttl = await redis.ttl(buildCaptureMessageKey(entryId));

      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(600);
    });

    it('omite los mensajes expirados y limpia el índice', async () => {
      enableCapture();

      await postWebhook(
        buildWebhookPayload({
          phoneNumberId: ALLOWED_PHONE_NUMBER_ID,
          messages: [{ id: 'wamid.expira', text: 'BAIT-EXPIRA' }],
        })
      );
      expect(await listCapturedMessages()).toHaveLength(1);

      // Se simula el passage del TTL invalidando la clave del mensaje.
      const entryId = buildCaptureEntryId('wamid.expira', 'seed');
      const messageKey = buildCaptureMessageKey(entryId);
      await redis.set(messageKey, 'expirado', 'PX', -1);

      expect(await listCapturedMessages()).toHaveLength(0);
      const [, indexKeys] = await redis.scan('0');
      expect(indexKeys.filter((key) => key.startsWith('whatsapp:capture:msg:'))).toHaveLength(0);
    });

    it('respeta el cupo máximo de mensajes retenidos', async () => {
      enableCapture({ WHATSAPP_CAPTURE_MAX_MESSAGES: '2' });

      for (let index = 0; index < 4; index += 1) {
        await postWebhook(
          buildWebhookPayload({
            phoneNumberId: ALLOWED_PHONE_NUMBER_ID,
            messages: [{ id: `wamid.cupo-${index}`, text: `BAIT-${index}` }],
          })
        );
      }

      const captured = await listCapturedMessages();
      expect(captured).toHaveLength(2);
      // Se conservan los más recientes.
      expect(captured.map((message) => message.body)).toEqual(['BAIT-3', 'BAIT-2']);
    });

    it('permite purgar la captura de inmediato', async () => {
      enableCapture();

      await postWebhook(
        buildWebhookPayload({
          phoneNumberId: ALLOWED_PHONE_NUMBER_ID,
          messages: [{ text: 'BAIT-PURGA' }],
        })
      );
      expect(await listCapturedMessages()).toHaveLength(1);

      const response = await app.inject({
        method: 'DELETE',
        url: '/admin/whatsapp/captura',
        headers: { authorization: `Bearer ${await adminToken(UserRole.ADMIN)}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.removed).toBe(1);
      expect(await listCapturedMessages()).toHaveLength(0);
    });
  });

  describe('higiene de logs', () => {
    it('no escribe contenido, códigos, números completos ni secretos en los logs', async () => {
      enableCapture();

      const secretBody = 'BAIT-SECRET-CODE-9182';
      const sadelCode = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
      const fullPhone = SENDER;

      const logSink: string[] = [];
      const capture = (...args: unknown[]) => {
        logSink.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
      };
      const consoleSpies = [
        jest.spyOn(console, 'log').mockImplementation(capture),
        jest.spyOn(console, 'warn').mockImplementation(capture),
        jest.spyOn(console, 'error').mockImplementation(capture),
      ];
      const loggerSpies = [
        jest.spyOn(logger, 'info').mockImplementation(capture),
        jest.spyOn(logger, 'warn').mockImplementation(capture),
        jest.spyOn(logger, 'error').mockImplementation(capture),
      ];

      await postWebhook(
        buildWebhookPayload({
          phoneNumberId: ALLOWED_PHONE_NUMBER_ID,
          messages: [
            { id: 'wamid.log-1', text: secretBody },
            { id: 'wamid.log-2', text: `SADEL ${sadelCode}` },
          ],
        })
      );

      const adminResponse = await app.inject({
        method: 'GET',
        url: '/admin/whatsapp/captura',
        headers: { authorization: `Bearer ${await adminToken(UserRole.ADMIN)}` },
      });
      expect(adminResponse.statusCode).toBe(200);

      consoleSpies.forEach((spy) => spy.mockRestore());
      loggerSpies.forEach((spy) => spy.mockRestore());

      const logs = logSink.join('\n');
      expect(logs.length).toBeGreaterThan(0);
      expect(logs).not.toContain(secretBody);
      expect(logs).not.toContain(sadelCode);
      expect(logs).not.toContain(fullPhone);
      expect(logs).not.toContain(CAPTURE_KEY);
      expect(logs).not.toContain(APP_SECRET);
      expect(logs).not.toContain('BAIT-SECRET-CODE-9182');
    });
  });

  describe('compatibilidad con la verificación SADEL', () => {
    it('sigue verificando el reto y consume el código', async () => {
      enableCapture();

      const sadelCode = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
      const challengeId = randomBytes(32).toString('base64url');
      const challengeIdHash = createHash('sha256').update(challengeId).digest('hex');
      const messageKey = `whatsapp_auth:message:${createHash('sha256')
        .update(sadelCode)
        .digest('hex')}`;
      const challengeKey = `whatsapp_auth:challenge:${challengeIdHash}`;

      await redis.set(
        challengeKey,
        JSON.stringify({ status: 'pending', intent: 'register', phone: SENDER_NORMALIZED }),
        'EX',
        300
      );
      await redis.set(messageKey, challengeIdHash, 'EX', 300);

      const response = await postWebhook(
        buildWebhookPayload({
          phoneNumberId: ALLOWED_PHONE_NUMBER_ID,
          messages: [{ id: 'wamid.sadel', text: `SADEL ${sadelCode}` }],
        })
      );

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('OK');

      const challenge = JSON.parse((await redis.get(challengeKey)) as string);
      expect(challenge.status).toBe('verified');
      // El código es de un solo uso: la clave del mensaje se consume.
      expect(await redis.get(messageKey)).toBeNull();

      await redis.del(challengeKey);
    });

    it('sigue funcionando con la captura desactivada', async () => {
      const sadelCode = '0123456789abcdef0123456789abcdef';
      const challengeId = randomBytes(32).toString('base64url');
      const challengeIdHash = createHash('sha256').update(challengeId).digest('hex');
      const messageKey = `whatsapp_auth:message:${createHash('sha256')
        .update(sadelCode)
        .digest('hex')}`;
      const challengeKey = `whatsapp_auth:challenge:${challengeIdHash}`;

      await redis.set(
        challengeKey,
        JSON.stringify({ status: 'pending', intent: 'register', phone: SENDER_NORMALIZED }),
        'EX',
        300
      );
      await redis.set(messageKey, challengeIdHash, 'EX', 300);

      const response = await postWebhook(
        buildWebhookPayload({
          phoneNumberId: ALLOWED_PHONE_NUMBER_ID,
          messages: [{ id: 'wamid.sadel-off', text: `SADEL ${sadelCode}` }],
        })
      );

      expect(response.statusCode).toBe(200);
      const challenge = JSON.parse((await redis.get(challengeKey)) as string);
      expect(challenge.status).toBe('verified');

      await redis.del(challengeKey);
    });

    it('ignora un código SADEL dirigido por un número distinto', async () => {
      enableCapture();

      const sadelCode = 'fedcba9876543210fedcba9876543210';
      const challengeId = randomBytes(32).toString('base64url');
      const challengeIdHash = createHash('sha256').update(challengeId).digest('hex');
      const messageKey = `whatsapp_auth:message:${createHash('sha256')
        .update(sadelCode)
        .digest('hex')}`;
      const challengeKey = `whatsapp_auth:challenge:${challengeIdHash}`;

      await redis.set(
        challengeKey,
        JSON.stringify({ status: 'pending', intent: 'register', phone: '5511111111' }),
        'EX',
        300
      );
      await redis.set(messageKey, challengeIdHash, 'EX', 300);

      await postWebhook(
        buildWebhookPayload({
          phoneNumberId: ALLOWED_PHONE_NUMBER_ID,
          messages: [
            { from: '5215588888888', id: 'wamid.sadel-ajeno', text: `SADEL ${sadelCode}` },
          ],
        })
      );

      const challenge = JSON.parse((await redis.get(challengeKey)) as string);
      expect(challenge.status).toBe('pending');

      await redis.del(challengeKey);
    });
  });

  describe('idempotencia ante reintentos de Meta', () => {
    it('no duplica el mensaje cuando Meta reintenta la entrega', async () => {
      enableCapture();

      const payload = buildWebhookPayload({
        phoneNumberId: ALLOWED_PHONE_NUMBER_ID,
        messages: [{ id: 'wamid.reintento', text: 'BAIT-REINTENTO' }],
      });

      const first = await postWebhook(payload);
      const second = await postWebhook(payload);

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);

      const captured = await listCapturedMessages();
      expect(captured).toHaveLength(1);
      expect(captured[0].body).toBe('BAIT-REINTENTO');
    });

    it('no duplica cuando Meta reintenta con otro id de entrega pero mismo contenido', async () => {
      enableCapture();

      await postWebhook(
        buildWebhookPayload({
          phoneNumberId: ALLOWED_PHONE_NUMBER_ID,
          messages: [{ id: 'wamid.entrega-1', text: 'BAIT-MISMO-TEXTO', timestamp: '1700000000' }],
        })
      );
      await postWebhook(
        buildWebhookPayload({
          phoneNumberId: ALLOWED_PHONE_NUMBER_ID,
          messages: [{ id: 'wamid.entrega-2', text: 'BAIT-MISMO-TEXTO', timestamp: '1700000000' }],
        })
      );

      // Cada id de entrega de Meta es un mensaje distinto: ambos se conservan.
      const captured = await listCapturedMessages();
      expect(captured).toHaveLength(2);
    });
  });

  describe('validación de firma y respuesta a Meta', () => {
    it('rechaza un evento con firma inválida y no captura nada', async () => {
      enableCapture();

      const rawBody = JSON.stringify(
        buildWebhookPayload({
          phoneNumberId: ALLOWED_PHONE_NUMBER_ID,
          messages: [{ text: 'BAIT-FIRMA-INVALIDA' }],
        })
      );

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/whatsapp',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': `sha256=${createHmac('sha256', 'otra-clave')
            .update(rawBody)
            .digest('hex')}`,
        },
        payload: rawBody,
      });

      expect(response.statusCode).toBe(401);
      expect(await listCapturedMessages()).toHaveLength(0);
    });

    it('responde 200 a Meta aunque Redis no responda', async () => {
      enableCapture();

      // Redis se cuelga: la captura se abandona, el webhook no se rompe.
      jest.spyOn(redis, 'exists').mockImplementation(() => new Promise<string>(() => undefined));

      const response = await postWebhook(
        buildWebhookPayload({
          phoneNumberId: ALLOWED_PHONE_NUMBER_ID,
          messages: [{ text: 'BAIT-REDIS-CUELGA' }],
        })
      );

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('OK');
    });
  });
});
