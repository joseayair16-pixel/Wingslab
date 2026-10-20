import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { getRedis } from '../config/redis';
import { normalizeWhatsAppSenderPhone } from '../utils/mexican-phone';
import { logger } from '../utils/logger';

const WEBHOOK_VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '';
const WEBHOOK_APP_SECRET = process.env.WHATSAPP_WEBHOOK_APP_SECRET || '';

type WhatsAppMessage = {
  from?: string;
  type?: string;
  text?: { body?: string };
};

type WhatsAppWebhookChange = {
  field?: string;
  value?: {
    messages?: WhatsAppMessage[];
    statuses?: unknown[];
    [key: string]: unknown;
  };
};

type WhatsAppWebhookPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: WhatsAppWebhookChange[];
  }>;
};

type WhatsAppAuthChallenge = {
  status: 'pending' | 'verified' | 'exchanged';
  intent: 'register' | 'recovery';
  phone: string;
};

function signatureMatches(rawBody: string, signature: string | undefined): boolean {
  if (!WEBHOOK_APP_SECRET || !signature) return false;
  const expected = createHmac('sha256', WEBHOOK_APP_SECRET).update(rawBody).digest();
  const receivedHex = signature.replace(/^sha256=/, '');
  if (!/^[a-f0-9]{64}$/i.test(receivedHex)) return false;
  const received = Buffer.from(receivedHex, 'hex');
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function challengeKeyFromHash(challengeIdHash: string): string {
  return `whatsapp_auth:challenge:${challengeIdHash}`;
}

async function confirmChallengeFromMessage(message: WhatsAppMessage): Promise<void> {
  if (message.type !== 'text' || !message.from || !message.text?.body) return;

  const match = message.text.body.trim().match(/^SADEL\s+([a-f0-9]{32})$/i);
  if (!match) return;

  const senderPhone = normalizeWhatsAppSenderPhone(message.from);
  if (!senderPhone) return;

  const messageCodeHash = createHash('sha256').update(match[1].toLowerCase()).digest('hex');
  const messageKey = `whatsapp_auth:message:${messageCodeHash}`;
  const redis = getRedis();
  const challengeIdHash = await redis.get(messageKey);
  if (!challengeIdHash) return;

  const challengeKey = challengeKeyFromHash(challengeIdHash);
  const raw = await redis.get(challengeKey);
  if (!raw) {
    await redis.del(messageKey);
    return;
  }

  let challenge: WhatsAppAuthChallenge;
  try {
    challenge = JSON.parse(raw);
  } catch {
    await redis.del(messageKey, challengeKey);
    return;
  }

  if (challenge.status !== 'pending' || challenge.phone !== senderPhone) return;

  const ttl = await redis.ttl(challengeKey);
  if (ttl <= 0) {
    await redis.del(messageKey, challengeKey);
    return;
  }

  await redis.set(challengeKey, JSON.stringify({ ...challenge, status: 'verified' }), 'EX', ttl);
  await redis.del(messageKey);
  logger.info('[WhatsApp Webhook] Verificación de teléfono completada', { intent: challenge.intent });
}

async function handleChange(change: WhatsAppWebhookChange): Promise<void> {
  const value = change.value ?? {};

  if (change.field === 'messages') {
    for (const message of value.messages ?? []) {
      await confirmChallengeFromMessage(message);
    }
    logger.info('[WhatsApp Webhook] Evento messages', {
      messages: value.messages?.length ?? 0,
      statuses: value.statuses?.length ?? 0,
    });
  } else if (change.field === 'account_update') {
    logger.info('[WhatsApp Webhook] Evento account_update');
  } else {
    logger.info('[WhatsApp Webhook] Evento desconocido', { field: change.field });
  }
}

export async function registerWhatsAppWebhookRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    done(null, body);
  });
  fastify.addContentTypeParser('application/json; charset=utf-8', { parseAs: 'string' }, (_request, body, done) => {
    done(null, body);
  });

  fastify.get('/webhooks/whatsapp', async (request, reply) => {
    const query = request.query as {
      'hub.mode'?: string;
      'hub.verify_token'?: string;
      'hub.challenge'?: string;
    };

    if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === WEBHOOK_VERIFY_TOKEN) {
      logger.info('[WhatsApp Webhook] Verificación completada');
      return reply.type('text/plain').send(query['hub.challenge'] ?? '');
    }

    logger.warn('[WhatsApp Webhook] Verificación rechazada', {
      mode: query['hub.mode'],
      tokenProvided: Boolean(query['hub.verify_token']),
    });
    return reply.code(403).type('text/plain').send('Invalid verify token');
  });

  fastify.post('/webhooks/whatsapp', async (request, reply) => {
    if (!WEBHOOK_APP_SECRET) {
      logger.error('[WhatsApp Webhook] Falta WHATSAPP_WEBHOOK_APP_SECRET; evento rechazado');
      return reply.code(503).type('text/plain').send('Webhook signature validation is not configured');
    }

    const rawBody = request.body as string;
    const signature = request.headers['x-hub-signature-256'] as string | undefined;
    if (!signatureMatches(rawBody, signature)) {
      logger.warn('[WhatsApp Webhook] Firma inválida, evento rechazado');
      return reply.code(401).type('text/plain').send('Invalid signature');
    }

    let payload: WhatsAppWebhookPayload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return reply.code(400).type('text/plain').send('Invalid JSON');
    }

    if (payload.object !== 'whatsapp_business_account') {
      logger.warn('[WhatsApp Webhook] Payload con object desconocido', { object: payload.object });
      return reply.type('text/plain').send('OK');
    }

    try {
      for (const entry of payload.entry ?? []) {
        for (const change of entry.changes ?? []) {
          await handleChange(change);
        }
      }
    } catch (error) {
      logger.error('[WhatsApp Webhook] No se pudo procesar el evento de autenticación', error);
      return reply.code(500).type('text/plain').send('Could not process event');
    }

    return reply.type('text/plain').send('OK');
  });
}
