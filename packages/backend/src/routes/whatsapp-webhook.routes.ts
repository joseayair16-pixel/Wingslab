import { createHmac, timingSafeEqual } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { logger } from '../utils/logger';

const WEBHOOK_VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '';
const WEBHOOK_APP_SECRET = process.env.WHATSAPP_WEBHOOK_APP_SECRET || '';

type WhatsAppWebhookChange = {
  field?: string;
  value?: Record<string, unknown>;
};

type WhatsAppWebhookPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: WhatsAppWebhookChange[];
  }>;
};

function signatureMatches(rawBody: string, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', WEBHOOK_APP_SECRET).update(rawBody).digest('hex');
  const received = signature.replace(/^sha256=/, '');

  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(received, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function handleChange(change: WhatsAppWebhookChange): void {
  const value = change.value ?? {};

  if (change.field === 'messages') {
    const waId = (value.contacts as Array<{ wa_id?: string }> | undefined)?.[0]?.wa_id;
    const messages = (value.messages as unknown[] | undefined)?.length ?? 0;
    const statuses = (value.statuses as unknown[] | undefined)?.length ?? 0;
    logger.info('[WhatsApp Webhook] Evento messages', { waId, messages, statuses });
  } else if (change.field === 'account_update') {
    logger.info('[WhatsApp Webhook] Evento account_update', value);
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
    const rawBody = request.body as string;
    const signature = request.headers['x-hub-signature-256'] as string | undefined;

    if (WEBHOOK_APP_SECRET && !signatureMatches(rawBody, signature)) {
      logger.warn('[WhatsApp Webhook] Firma inválida, evento ignorado');
      return reply.code(401).type('text/plain').send('Invalid signature');
    }

    let payload: WhatsAppWebhookPayload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return reply.code(400).type('text/plain').send('Invalid JSON');
    }

    if (payload.object === 'whatsapp_business_account') {
      for (const entry of payload.entry ?? []) {
        for (const change of entry.changes ?? []) {
          handleChange(change);
        }
      }
    } else {
      logger.warn('[WhatsApp Webhook] Payload con object desconocido', { object: payload.object });
    }

    return reply.type('text/plain').send('OK');
  });
}
