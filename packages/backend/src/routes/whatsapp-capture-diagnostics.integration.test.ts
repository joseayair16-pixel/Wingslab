/**
 * Pruebas de la observabilidad (Fase 1) de la captura temporal de WhatsApp.
 *
 * Verifican que los logs estructurados permiten distinguir un mensaje
 * CAPTURADO de uno DESCARTADO, con el motivo exacto, la coincidencia del
 * número destino y el estado de Redis — y que en ningún caso se expongan
 * cuerpos, códigos, teléfonos, claves ni identificadores sensibles.
 */

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { UserRole } from '@prisma/client';
import { FastifyInstance } from 'fastify';

import { buildApp } from '../app';
import { prisma } from '../config/database';
import { getRedis } from '../config/redis';
import { listCapturedMessages, clearCapturedMessages } from '../services/whatsapp-capture.service';
import { logger } from '../utils/logger';

const APP_SECRET = 'ci-test-whatsapp-app-secret';
const CAPTURE_KEY = 'ci-test-capture-key-0123456789abcdef';
const ALLOWED_PHONE_NUMBER_ID = '111222333444555';
const OTHER_PHONE_NUMBER_ID = '999888777666555';
const SENDER = '5215512345678';

const CAPTURE_ENV_KEYS = [
  'WHATSAPP_CAPTURE_ENABLED',
  'WHATSAPP_CAPTURE_PHONE_NUMBER_ID',
  'WHATSAPP_CAPTURE_ENCRYPTION_KEY',
  'WHATSAPP_CAPTURE_TTL_SECONDS',
  'WHATSAPP_CAPTURE_MAX_MESSAGES',
];

const DIAGNOSTIC_MESSAGE = '[WhatsApp Capture] Mensaje entrante';
const SUMMARY_MESSAGE = '[WhatsApp Capture] Resumen de evento';

type LogEntry = { message: string; meta: Record<string, unknown> };

describe('observabilidad de la captura temporal de WhatsApp', () => {
  let app: FastifyInstance;
  const redis = getRedis();
  let entries: LogEntry[];
  let consoleSink: string[];
  let restoreSpies: Array<() => void>;

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

    entries = [];
    consoleSink = [];
    restoreSpies = [];

    const collect = (message: string, meta?: unknown) => {
      entries.push({ message, meta: (meta ?? {}) as Record<string, unknown> });
    };
    const capture = (...args: unknown[]) => {
      consoleSink.push(
        args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')
      );
    };

    restoreSpies.push(
      jest.spyOn(logger, 'info').mockImplementation((message: string, meta?: unknown) => {
        collect(message, meta);
      })
    );
    restoreSpies.push(jest.spyOn(logger, 'warn').mockImplementation(capture));
    restoreSpies.push(jest.spyOn(logger, 'error').mockImplementation(capture));
    restoreSpies.push(jest.spyOn(console, 'log').mockImplementation(capture));
    restoreSpies.push(jest.spyOn(console, 'warn').mockImplementation(capture));
    restoreSpies.push(jest.spyOn(console, 'error').mockImplementation(capture));

    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({ status: 'ACTIVE' } as never);
  });

  afterEach(async () => {
    restoreSpies.forEach((restore) => restore());
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

  type MessageInput = {
    from?: string;
    fromUserId?: string;
    id?: string;
    type?: string;
    text?: string;
    buttonPayload?: string;
    interactiveTitle?: string;
    errors?: unknown;
    unsupported?: unknown;
  };

  function buildPayload(options: {
    phoneNumberId?: string;
    omitMetadata?: boolean;
    messages: MessageInput[];
  }): Record<string, unknown> {
    const value: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      messages: options.messages.map((message) => {
        const resolvedType = message.type ?? 'text';
        const base: Record<string, unknown> = {
          from: message.from ?? SENDER,
          id: message.id ?? `wamid.${randomBytes(8).toString('hex')}`,
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: resolvedType,
        };
        if (message.fromUserId) base.from_user_id = message.fromUserId;
        if (message.errors !== undefined) base.errors = message.errors;
        if (message.unsupported !== undefined) base.unsupported = message.unsupported;

        if (resolvedType === 'text') {
          base.text = { body: message.text ?? '' };
        } else if (resolvedType === 'button') {
          base.button = { payload: message.buttonPayload ?? 'COPIAR_CODIGO', text: 'Copiar' };
        } else if (resolvedType === 'interactive') {
          base.interactive = {
            type: 'button_reply',
            button_reply: { id: 'confirmar', title: message.interactiveTitle ?? 'Confirmar' },
          };
        } else if (resolvedType === 'image') {
          base.image = { id: 'media-001', mime_type: 'image/jpeg', sha256: 'abc123' };
        }
        return base;
      }),
    };

    if (!options.omitMetadata) {
      value.metadata = {
        display_phone_number: '15550001111',
        phone_number_id: options.phoneNumberId ?? ALLOWED_PHONE_NUMBER_ID,
      };
    }

    return {
      object: 'whatsapp_business_account',
      entry: [{ id: 'waba-test-1', changes: [{ field: 'messages', value }] }],
    };
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

  function diagnostics(): Array<Record<string, unknown>> {
    return entries.filter((entry) => entry.message === DIAGNOSTIC_MESSAGE).map((e) => e.meta);
  }

  function summaries(): Array<Record<string, unknown>> {
    return entries.filter((entry) => entry.message === SUMMARY_MESSAGE).map((e) => e.meta);
  }

  describe('motivos de descarte', () => {
    it.each([[131051, 'hsm'], [131060, 'interactive']])(
      'informa únicamente valores permitidos para unsupported', async (code, subtype) => {
        enableCapture();
        const secret = 'private-sensitive-value';
        const response = await postWebhook(buildPayload({ messages: [{
          type: 'unsupported', errors: [{ code, title: secret, message: secret, error_data: { details: secret } }],
          unsupported: { type: subtype, extra: secret },
        }] }));
        expect(response.statusCode).toBe(200);
        expect(response.body).toBe('OK');
        expect(diagnostics()[0]).toMatchObject({ errorCode: code, unsupportedType: subtype, result: 'ignored', redis: 'not_attempted' });
        expect(JSON.stringify(entries)).not.toContain(secret);
        expect(consoleSink.join(' ')).not.toContain(secret);
        expect(await listCapturedMessages()).toHaveLength(0);
      }
    );

    it.each([
      [undefined, undefined, 'missing', 'missing'],
      [[], {}, 'missing', 'missing'],
      [[{}], { type: null }, 'missing', 'missing'],
      ['unexpected-secret', 'unexpected-secret', 'other', 'other'],
      [[{ code: '131051' }], { type: 'unexpected-secret' }, 'other', 'other'],
      [[{ code: 999999 }], { type: 42 }, 'other', 'other'],
    ])('clasifica campos ausentes o inválidos sin exponer valores', async (errors, unsupported, code, subtype) => {
      enableCapture();
      await postWebhook(buildPayload({ messages: [{ type: 'unsupported', errors, unsupported }] }));
      expect(diagnostics()[0]).toMatchObject({ errorCode: code, unsupportedType: subtype });
      expect(JSON.stringify(entries)).not.toContain('unexpected-secret');
      expect(consoleSink.join(' ')).not.toContain('unexpected-secret');
    });

    it('incluye el diagnóstico de unsupported sin metadatos y lo omite en otros tipos', async () => {
      enableCapture();
      await postWebhook(buildPayload({ omitMetadata: true, messages: [
        { type: 'unsupported', errors: [{ code: 131051 }], unsupported: { type: 'image' } },
        { type: 'button', errors: [{ code: 131060 }], unsupported: { type: 'hsm' } },
      ] }));
      expect(diagnostics()[0]).toMatchObject({ reason: 'missing_metadata', errorCode: 131051, unsupportedType: 'image' });
      expect(diagnostics()[1]).not.toHaveProperty('errorCode');
      expect(diagnostics()[1]).not.toHaveProperty('unsupportedType');
    });
    it('informa type_not_supported para un mensaje que no es de texto', async () => {
      enableCapture();

      await postWebhook(
        buildPayload({
          messages: [{ id: 'wamid.btn', type: 'button', buttonPayload: 'COPIAR_CODIGO' }],
        })
      );

      const lines = diagnostics();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        type: 'button',
        result: 'ignored',
        reason: 'type_not_supported',
        phoneNumberIdMatch: true,
        redis: 'not_attempted',
      });
      expect(await listCapturedMessages()).toHaveLength(0);
    });

    it('informa missing_metadata cuando Meta no envía el número destino', async () => {
      enableCapture();

      await postWebhook(
        buildPayload({
          omitMetadata: true,
          messages: [{ id: 'wamid.nometa', type: 'interactive', interactiveTitle: 'Confirmar' }],
        })
      );

      const lines = diagnostics();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        type: 'interactive',
        result: 'ignored',
        reason: 'missing_metadata',
        phoneNumberIdMatch: false,
        redis: 'not_attempted',
      });
      expect(summaries()[0]).toMatchObject({ captureEnabled: true, phoneNumberIdMatch: false });
    });

    it('informa phone_number_not_allowed cuando el número no es el autorizado', async () => {
      enableCapture();

      await postWebhook(
        buildPayload({
          phoneNumberId: OTHER_PHONE_NUMBER_ID,
          messages: [{ id: 'wamid.otro', text: 'BAIT-0001' }],
        })
      );

      const lines = diagnostics();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        type: 'text',
        result: 'ignored',
        reason: 'phone_number_not_allowed',
        phoneNumberIdMatch: false,
        redis: 'not_attempted',
      });
      expect(await listCapturedMessages()).toHaveLength(0);
    });

    it('informa empty_body para un texto sin contenido', async () => {
      enableCapture();

      await postWebhook(buildPayload({ messages: [{ id: 'wamid.vacio', text: '   ' }] }));

      const lines = diagnostics();
      expect(lines[0]).toMatchObject({
        type: 'text',
        result: 'ignored',
        reason: 'empty_body',
        phoneNumberIdMatch: true,
        redis: 'not_attempted',
      });
    });

    it('informa el motivo de desactivación sin tocar Redis', async () => {
      // Captura apagada por defecto.
      await postWebhook(buildPayload({ messages: [{ id: 'wamid.off', text: 'BAIT-0002' }] }));

      const lines = diagnostics();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        result: 'ignored',
        reason: 'disabled_by_flag',
        redis: 'not_attempted',
      });
      expect(summaries()[0]).toMatchObject({ captureEnabled: false, total: 1 });
    });

    it('informa el motivo de configuración cuando la clave no es válida', async () => {
      enableCapture({ WHATSAPP_CAPTURE_ENCRYPTION_KEY: 'corta' });

      await postWebhook(buildPayload({ messages: [{ id: 'wamid.weak', text: 'BAIT-0003' }] }));

      expect(diagnostics()[0]).toMatchObject({
        result: 'ignored',
        reason: 'weak_encryption_key',
        redis: 'not_attempted',
      });
    });
  });

  describe('resultados de captura y de error', () => {
    it('informa captured con estado de Redis ok', async () => {
      enableCapture();

      await postWebhook(buildPayload({ messages: [{ id: 'wamid.ok', text: 'BAIT-0004' }] }));

      const lines = diagnostics();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        type: 'text',
        result: 'captured',
        reason: 'stored',
        phoneNumberIdMatch: true,
        redis: 'ok',
      });
      expect(await listCapturedMessages()).toHaveLength(1);
    });

    it('el hash del mensaje del log coincide con el id del registro capturado', async () => {
      enableCapture();

      await postWebhook(buildPayload({ messages: [{ id: 'wamid.correlar', text: 'BAIT-0005' }] }));

      const captured = await listCapturedMessages();
      expect(captured).toHaveLength(1);
      expect(diagnostics()[0].messageIdHash).toBe(captured[0].id);
    });

    it('informa duplicate cuando Meta reintenta la entrega', async () => {
      enableCapture();

      const payload = buildPayload({ messages: [{ id: 'wamid.retry', text: 'BAIT-0006' }] });
      await postWebhook(payload);
      await postWebhook(payload);

      const lines = diagnostics();
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatchObject({ result: 'captured', reason: 'stored' });
      expect(lines[1]).toMatchObject({ result: 'ignored', reason: 'duplicate' });
      expect(await listCapturedMessages()).toHaveLength(1);
    });

    it('informa storage_error con estado de Redis error', async () => {
      enableCapture();

      jest.spyOn(redis, 'set').mockRejectedValue(new Error('redis no disponible'));

      await postWebhook(buildPayload({ messages: [{ id: 'wamid.redis', text: 'BAIT-0007' }] }));

      const lines = diagnostics();
      expect(lines[0]).toMatchObject({
        type: 'text',
        result: 'error',
        reason: 'storage_error',
        redis: 'error',
      });
      expect(summaries()[0]).toMatchObject({ error: 1, captured: 0 });
    });
  });

  describe('correlación y control de volumen', () => {
    it('el pseudónimo del remitente es estable y distingue remitentes', async () => {
      enableCapture();

      await postWebhook(
        buildPayload({
          messages: [
            { id: 'wamid.a1', from: SENDER, text: 'BAIT-A' },
            { id: 'wamid.a2', from: SENDER, text: 'BAIT-B' },
            { id: 'wamid.b1', from: '5215500000000', text: 'BAIT-C' },
          ],
        })
      );

      const lines = diagnostics();
      const hashes = lines.map((line) => line.senderHash);
      expect(hashes[0]).toEqual(hashes[1]);
      expect(hashes[2]).not.toEqual(hashes[0]);
      // El pseudónimo no es el teléfono en claro.
      expect(String(hashes[0])).not.toContain(SENDER);
      expect(String(hashes[0])).toMatch(/^[a-f0-9]{12}$/);
    });

    it('acota las líneas por evento y conserva los conteos en el resumen', async () => {
      enableCapture();

      const messages = Array.from({ length: 30 }, (_, index) => ({
        id: `wamid.volumen-${index}`,
        type: 'image',
      }));

      await postWebhook(buildPayload({ messages }));

      expect(diagnostics().length).toBeLessThanOrEqual(25);
      expect(summaries()[0]).toMatchObject({
        total: 30,
        ignored: 30,
        captured: 0,
        error: 0,
        suppressed: 5,
      });
      expect((summaries()[0].byReason as Record<string, number>).type_not_supported).toBe(30);
    });

    it('normaliza y acota el tipo de mensaje registrado', async () => {
      enableCapture();

      await postWebhook(
        buildPayload({
          messages: [
            { id: 'wamid.tipo1', type: 'button' },
            { id: 'wamid.tipo2', type: 'x'.repeat(200) },
            { id: 'wamid.tipo3', type: 'texto\ncon\nsaltos' },
          ],
        })
      );

      const types = diagnostics().map((line) => String(line.type));
      expect(types[0]).toBe('button');
      expect(types[1]).toHaveLength(32);
      expect(types[2]).toBe('textoconsaltos');
      // Ningún tipo escapa del sanitizado: el log siempre es JSON limpio.
      types.forEach((type) => expect(type).toMatch(/^[\w.-]*$/));
    });

    it('el resumen desglosa los motivos de un evento mixto', async () => {
      enableCapture();

      await postWebhook(
        buildPayload({
          messages: [
            { id: 'wamid.m1', text: 'BAIT-MIX' },
            { id: 'wamid.m2', type: 'button', buttonPayload: 'X' },
            { id: 'wamid.m3', type: 'image' },
          ],
        })
      );

      expect(summaries()[0]).toMatchObject({ total: 3, captured: 1, ignored: 2, error: 0 });
      expect(summaries()[0].byReason).toMatchObject({
        stored: 1,
        type_not_supported: 2,
      });
    });
  });

  describe('higiene de logs', () => {
    it('no expone cuerpo, código, teléfono completo, clave ni identificador original', async () => {
      enableCapture();

      const secretBody = 'BAIT-SECRET-CODE-9182';
      const sadelCode = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
      const metaMessageId = 'wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTRBNjU5OUFFRTAzODEwMTQ0RgA=';

      await postWebhook(
        buildPayload({
          messages: [
            { id: metaMessageId, text: secretBody },
            { id: 'wamid.sadel', text: `SADEL ${sadelCode}` },
            { id: 'wamid.b1', type: 'button', buttonPayload: 'COPIAR_CODIGO' },
          ],
        })
      );

      const everything = [...consoleSink, ...entries.map((e) => JSON.stringify(e.meta))].join('\n');
      expect(everything.length).toBeGreaterThan(0);

      expect(everything).not.toContain(secretBody);
      expect(everything).not.toContain(sadelCode);
      expect(everything).not.toContain(SENDER);
      expect(everything).not.toContain(CAPTURE_KEY);
      expect(everything).not.toContain(APP_SECRET);
      expect(everything).not.toContain(metaMessageId);
      expect(everything).not.toContain('COPIAR_CODIGO');
      // Tampoco se registra el phone_number_id en claro.
      expect(everything).not.toContain(ALLOWED_PHONE_NUMBER_ID);
    });

    it('la clave de cifrado nunca sale del módulo de servicio', async () => {
      enableCapture();

      await postWebhook(buildPayload({ messages: [{ id: 'wamid.clave', text: 'BAIT-0008' }] }));

      const everything = [...consoleSink, ...entries.map((e) => JSON.stringify(e.meta))].join('\n');
      expect(everything).not.toContain(CAPTURE_KEY);

      // El pseudónimo del remitente no es reversible por enumeración del
      // teléfono: es un HMAC, no un hash simple.
      const senderHash = String(diagnostics()[0].senderHash);
      const { createHmac: hmac } = require('node:crypto');
      const naive = require('node:crypto')
        .createHash('sha256')
        .update(SENDER)
        .digest('hex')
        .slice(0, 12);
      expect(senderHash).not.toBe(naive);
      expect(senderHash).not.toBe(hmac('sha256', CAPTURE_KEY).update(SENDER).digest('hex').slice(0, 12));
    });
  });

  describe('regresión del flujo existente', () => {
    it('la verificación SADEL sigue funcionando con la instrumentación activa', async () => {
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
        JSON.stringify({ status: 'pending', intent: 'register', phone: '5512345678' }),
        'EX',
        300
      );
      await redis.set(messageKey, challengeIdHash, 'EX', 300);

      const response = await postWebhook(
        buildPayload({ messages: [{ id: 'wamid.sadel', text: `SADEL ${sadelCode}` }] })
      );

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('OK');

      const challenge = JSON.parse((await redis.get(challengeKey)) as string);
      expect(challenge.status).toBe('verified');
      expect(await redis.get(messageKey)).toBeNull();

      await redis.del(challengeKey);
    });

    it('el endpoint administrativo sigue exigiendo rol ADMIN', async () => {
      enableCapture();

      const anonymous = await app.inject({ method: 'GET', url: '/admin/whatsapp/captura' });
      expect(anonymous.statusCode).toBe(401);

      const customer = await app.inject({
        method: 'GET',
        url: '/admin/whatsapp/captura',
        headers: {
          authorization: `Bearer ${app.jwt.sign({
            sub: 'user-customer',
            phone: '5510000000',
            role: UserRole.CUSTOMER,
          })}`,
        },
      });
      expect(customer.statusCode).toBe(403);
    });
  });
});
