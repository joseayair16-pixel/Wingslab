import { Admin, Customer, UserRole } from '@prisma/client';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import bcryptjs from 'bcryptjs';

import crypto from 'node:crypto';
import { prisma } from '../config/database';
import { getRedis } from '../config/redis';
import { isEmailConfigured, sendOtpEmail } from '../services/email.service';
import {
  createRefreshToken,
  validateAndRotateRefreshToken,
} from '../services/refresh-token.service';
import { isMexicanLocalPhone, toWhatsAppLinkNumber } from '../utils/mexican-phone';

const WHATSAPP_AUTH_TTL_SECONDS = 300;
const WHATSAPP_AUTH_STARTS_PER_HOUR = 5;
const EMAIL_OTP_TTL_SECONDS = 300;
const EMAIL_OTP_MAX_ATTEMPTS = 5;
const EMAIL_OTP_STARTS_PER_HOUR = 5;
const EMAIL_OTP_HMAC_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

// Los dominios sintéticos no representan un correo de contacto utilizable.
function isRealEmail(email?: string | null): boolean {
  return Boolean(email && email.includes('@') && !email.endsWith('@sadel.local'));
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function getPhoneLookupCandidates(phone: string): string[] {
  const normalizedPhone = normalizePhone(phone);

  return Array.from(
    new Set([
      phone.trim(),
      normalizedPhone,
      `+52${normalizedPhone}`,
      `+521${normalizedPhone}`,
    ].filter(Boolean))
  );
}

function getWhatsAppChallengeKey(challengeId: string): string {
  const hash = crypto.createHash('sha256').update(challengeId).digest('hex');
  return `whatsapp_auth:challenge:${hash}`;
}

function getWhatsAppMessageKey(messageCode: string): string {
  const hash = crypto.createHash('sha256').update(messageCode).digest('hex');
  return `whatsapp_auth:message:${hash}`;
}

function hashEmailOtpChallengeId(challengeId: string): string {
  return crypto.createHash('sha256').update(challengeId).digest('hex');
}

function getEmailOtpChallengeKey(challengeId: string): string {
  return `email_otp:challenge:${hashEmailOtpChallengeId(challengeId)}`;
}

function getEmailOtpActiveKey(phone: string, intent: 'register' | 'recovery'): string {
  const hash = crypto.createHash('sha256').update(`${intent}:${phone}`).digest('hex');
  return `email_otp:active:${hash}`;
}

function getEmailOtpStartsKey(phone: string): string {
  const hash = crypto.createHash('sha256').update(phone).digest('hex');
  return `email_otp:starts:${hash}`;
}

function hashEmailOtp(challengeId: string, code: string): string {
  return crypto.createHmac('sha256', EMAIL_OTP_HMAC_SECRET).update(`${challengeId}:${code}`).digest('hex');
}

function emailOtpCodesMatch(challengeId: string, code: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashEmailOtp(challengeId, code), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function maskEmail(email: string): string {
  const [localPart, domain] = email.split('@');
  if (!localPart || !domain) return email;
  const visible = localPart.length > 2 ? localPart.slice(0, 2) : localPart.slice(0, 1);
  return `${visible}${'•'.repeat(Math.max(2, localPart.length - visible.length))}@${domain}`;
}

type EmailOtpChallenge = {
  status: 'pending' | 'exchanged';
  intent: 'register' | 'recovery';
  phone: string;
  email: string;
  codeHash: string;
  attempts: number;
  name?: string;
  lastName?: string;
  dateOfBirth?: string;
  userId?: string;
  grantToken?: string;
};

type WhatsAppAuthChallenge = {
  status: 'pending' | 'verified' | 'exchanged';
  intent: 'register' | 'recovery';
  phone: string;
  name?: string;
  lastName?: string;
  dateOfBirth?: string;
  email?: string;
  grantToken?: string;
};

function isPasswordHash(password: string): boolean {
  return /^\$2[aby]\$\d{2}\$/.test(password);
}

const loginSchema = z.object({
  phone: z
    .string()
    .min(8, 'El telefono es obligatorio.')
    .transform(normalizePhone)
    .refine((value) => value.length === 10, 'El telefono debe tener 10 digitos.'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres.'),
});

const customerLoginSchema = z.object({
  phone: z.string().regex(/^\d{10}$/, 'Ingresa un teléfono de 10 dígitos.'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres.'),
});

async function authenticateUserByRole(params: {
  phone: string;
  password: string;
  role: UserRole;
}) {
  const user = await prisma.user.findFirst({
    where: params.role === UserRole.CUSTOMER
      ? { phoneNormalized: normalizePhone(params.phone), role: params.role }
      : {
          phone: { in: getPhoneLookupCandidates(params.phone) },
          role: params.role,
        },
  });

  if (!user) {
    return { error: 'INVALID_CREDENTIALS' as const };
  }

  let passwordMatches: boolean;
  if (isPasswordHash(user.password)) {
    passwordMatches = await bcryptjs.compare(params.password, user.password);
  } else {
    // Legacy plaintext fallback – auto-upgrade on success
    passwordMatches = user.password === params.password;
    if (passwordMatches) {
      const hashed = await bcryptjs.hash(params.password, 12);
      await prisma.user.update({ where: { id: user.id }, data: { password: hashed } });
    }
  }

  if (!passwordMatches) {
    return { error: 'INVALID_CREDENTIALS' as const };
  }

  return { user };
}

async function createRelatedProfile(userId: string, role: UserRole): Promise<Admin | Customer | null> {
  if (role === UserRole.ADMIN) {
    return prisma.admin.create({
      data: {
        userId,
      },
    });
  }

  if (role === UserRole.CUSTOMER) {
    return prisma.customer.create({
      data: {
        userId,
      },
    });
  }

  return null;
}

export async function registerAuthRoutes(fastify: FastifyInstance): Promise<void> {
  const emailOtpStartSchema = z.object({
    phone: z.string().refine(isMexicanLocalPhone, 'Ingresa un teléfono de 10 dígitos.'),
    intent: z.enum(['register', 'recovery']),
    email: z.string().email('Correo inválido.').optional(),
    name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres.').optional(),
    lastName: z.string().min(2, 'Los apellidos deben tener al menos 2 caracteres.').optional(),
    dateOfBirth: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Fecha de nacimiento inválida.').optional(),
  });

  fastify.post(
    '/auth/email-otp/iniciar',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const parsed = emailOtpStartSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_PAYLOAD', message: parsed.error.issues[0]?.message || 'Datos inválidos.' },
        });
      }

      let email = parsed.data.email ? normalizeEmail(parsed.data.email) : '';
      let userId: string | undefined;

      if (parsed.data.intent === 'register') {
        if (!email || !parsed.data.name?.trim() || !parsed.data.lastName?.trim() || !parsed.data.dateOfBirth) {
          return reply.status(400).send({
            success: false,
            error: { code: 'INVALID_PAYLOAD', message: 'Completa tus datos de registro para verificar tu correo.' },
          });
        }

        const dateOfBirth = new Date(parsed.data.dateOfBirth);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        dateOfBirth.setHours(0, 0, 0, 0);
        if (dateOfBirth > today) {
          return reply.status(400).send({
            success: false,
            error: { code: 'INVALID_DATE_OF_BIRTH', message: 'La fecha de nacimiento no puede estar en el futuro.' },
          });
        }

        const existingPhone = await prisma.user.findFirst({
          where: { phoneNormalized: parsed.data.phone, role: UserRole.CUSTOMER },
          select: { id: true },
        });
        if (existingPhone) {
          return reply.status(409).send({
            success: false,
            error: { code: 'PHONE_ALREADY_REGISTERED', message: 'Este teléfono ya tiene una cuenta. Inicia sesión o recupera tu contraseña.' },
          });
        }

        const existingEmail = await prisma.user.findFirst({
          where: { email: { equals: email, mode: 'insensitive' } },
          select: { id: true },
        });
        if (existingEmail) {
          return reply.status(409).send({
            success: false,
            error: { code: 'EMAIL_ALREADY_REGISTERED', message: 'Este correo ya tiene una cuenta registrada.' },
          });
        }
      } else {
        const existingUser = await prisma.user.findFirst({
          where: { phoneNormalized: parsed.data.phone, role: UserRole.CUSTOMER },
          select: { id: true, phone: true, phoneNormalized: true, email: true },
        });
        if (!existingUser) {
          return reply.status(404).send({
            success: false,
            error: { code: 'USER_NOT_FOUND', message: 'No existe una cuenta con ese teléfono.' },
          });
        }
        if (!isRealEmail(existingUser.email)) {
          return reply.status(409).send({
            success: false,
            error: { code: 'EMAIL_NOT_AVAILABLE', message: 'Esta cuenta no tiene un correo de recuperación. Usa WhatsApp para verificar tu número.' },
          });
        }
        email = normalizeEmail(existingUser.email);
        userId = existingUser.id;
      }

      const redis = getRedis();
      const startsKey = getEmailOtpStartsKey(parsed.data.phone);
      const starts = await redis.incr(startsKey);
      if (starts === 1) await redis.expire(startsKey, 60 * 60);
      if (starts > EMAIL_OTP_STARTS_PER_HOUR) {
        await redis.decr(startsKey);
        return reply.status(429).send({
          success: false,
          error: { code: 'EMAIL_OTP_LIMIT', message: 'Alcanzaste el límite de códigos. Intenta de nuevo más tarde.' },
        });
      }

      const challengeId = crypto.randomBytes(32).toString('base64url');
      const code = crypto.randomInt(100000, 1000000).toString();
      const challengeKey = getEmailOtpChallengeKey(challengeId);
      const activeKey = getEmailOtpActiveKey(parsed.data.phone, parsed.data.intent);
      const challenge: EmailOtpChallenge = {
        status: 'pending',
        intent: parsed.data.intent,
        phone: parsed.data.phone,
        email,
        codeHash: hashEmailOtp(challengeId, code),
        attempts: 0,
        ...(parsed.data.intent === 'register'
          ? {
              name: parsed.data.name?.trim(),
              lastName: parsed.data.lastName?.trim(),
              dateOfBirth: parsed.data.dateOfBirth,
            }
          : { userId }),
      };

      await redis.set(challengeKey, JSON.stringify(challenge), 'EX', EMAIL_OTP_TTL_SECONDS);
      await redis.set(activeKey, hashEmailOtpChallengeId(challengeId), 'EX', EMAIL_OTP_TTL_SECONDS);

      let delivered = false;
      let mockCode: string | undefined;
      if (isEmailConfigured()) {
        delivered = (await sendOtpEmail(email, code)).ok;
      } else if (process.env.NODE_ENV !== 'production' || process.env.ALLOW_MOCK_OTP_IN_PROD === 'true') {
        delivered = true;
        mockCode = code;
        console.log(`[OTP SIMULATOR] Email OTP generado (${parsed.data.intent}).`);
      }

      if (!delivered) {
        await redis.del(challengeKey, activeKey);
        return reply.status(503).send({
          success: false,
          error: { code: 'EMAIL_DELIVERY_UNAVAILABLE', message: 'No se pudo enviar el código por correo. Intenta por WhatsApp.' },
        });
      }

      return reply.send({
        success: true,
        data: {
          challengeId,
          channel: 'email',
          maskedEmail: maskEmail(email),
          expiresInSeconds: EMAIL_OTP_TTL_SECONDS,
          ...(mockCode ? { mockCode } : {}),
        },
      });
    },
  );

  fastify.post(
    '/auth/email-otp/confirmar',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const parsed = z.object({
        challengeId: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'La verificación venció. Iníciala de nuevo.'),
        code: z.string().regex(/^\d{6}$/, 'Ingresa el código de 6 dígitos.'),
      }).safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_PAYLOAD', message: parsed.error.issues[0]?.message || 'Solicitud inválida.' },
        });
      }

      const redis = getRedis();
      const challengeKey = getEmailOtpChallengeKey(parsed.data.challengeId);
      const raw = await redis.get(challengeKey);
      if (!raw) {
        return reply.status(410).send({
          success: false,
          error: { code: 'EMAIL_OTP_EXPIRED', message: 'El código venció. Solicita uno nuevo.' },
        });
      }

      let challenge: EmailOtpChallenge;
      try {
        challenge = JSON.parse(raw);
      } catch {
        await redis.del(challengeKey);
        return reply.status(410).send({
          success: false,
          error: { code: 'EMAIL_OTP_EXPIRED', message: 'El código venció. Solicita uno nuevo.' },
        });
      }

      const activeKey = getEmailOtpActiveKey(challenge.phone, challenge.intent);
      const challengeIdHash = hashEmailOtpChallengeId(parsed.data.challengeId);
      if (await redis.get(activeKey) !== challengeIdHash) {
        return reply.status(410).send({
          success: false,
          error: { code: 'EMAIL_OTP_EXPIRED', message: 'Solicitaste un código más reciente. Usa el último que recibiste.' },
        });
      }

      if (challenge.status === 'exchanged' && challenge.grantToken) {
        return reply.send({
          success: true,
          data: challenge.intent === 'register'
            ? { registerToken: challenge.grantToken }
            : { resetToken: challenge.grantToken },
        });
      }

      if (!emailOtpCodesMatch(parsed.data.challengeId, parsed.data.code, challenge.codeHash)) {
        challenge.attempts += 1;
        const remainingTtl = Math.max(await redis.ttl(challengeKey), 1);
        if (challenge.attempts >= EMAIL_OTP_MAX_ATTEMPTS) {
          await redis.del(challengeKey, activeKey);
          return reply.status(429).send({
            success: false,
            error: { code: 'EMAIL_OTP_TOO_MANY_ATTEMPTS', message: 'Demasiados intentos. Solicita un código nuevo.' },
          });
        }
        await redis.set(challengeKey, JSON.stringify(challenge), 'EX', remainingTtl);
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_EMAIL_OTP', message: 'El código es incorrecto o venció.' },
        });
      }

      let grantToken: string;
      if (challenge.intent === 'register') {
        grantToken = await reply.jwtSign({
          phone: challenge.phone,
          email: challenge.email,
          name: challenge.name,
          lastName: challenge.lastName,
          dateOfBirth: challenge.dateOfBirth,
          verification: 'email',
          intent: 'register_confirm',
        }, { expiresIn: '15m' });
      } else {
        const currentUser = challenge.userId
          ? await prisma.user.findUnique({
              where: { id: challenge.userId },
              select: { id: true, phone: true, phoneNormalized: true, email: true, role: true },
            })
          : null;
        if (
          !currentUser ||
          currentUser.role !== UserRole.CUSTOMER ||
          currentUser.phoneNormalized !== challenge.phone ||
          currentUser.email?.trim().toLowerCase() !== challenge.email
        ) {
          return reply.status(410).send({
            success: false,
            error: { code: 'EMAIL_OTP_EXPIRED', message: 'Los datos de la cuenta cambiaron. Inicia de nuevo la recuperación.' },
          });
        }
        grantToken = await reply.jwtSign({
          sub: currentUser.id,
          phone: currentUser.phone,
          verification: 'email',
          intent: 'password_reset',
        }, { expiresIn: '15m' });
      }

      const remainingTtl = await redis.ttl(challengeKey);
      if (remainingTtl <= 0) {
        return reply.status(410).send({
          success: false,
          error: { code: 'EMAIL_OTP_EXPIRED', message: 'El código venció. Solicita uno nuevo.' },
        });
      }
      await redis.set(
        challengeKey,
        JSON.stringify({ ...challenge, status: 'exchanged', grantToken }),
        'EX',
        remainingTtl,
      );

      return reply.send({
        success: true,
        data: challenge.intent === 'register' ? { registerToken: grantToken } : { resetToken: grantToken },
      });
    },
  );

  const whatsappStartSchema = z.object({
    phone: z.string().refine(isMexicanLocalPhone, 'Ingresa un teléfono de 10 dígitos.'),
    intent: z.enum(['register', 'recovery']),
    email: z.string().email('Correo inválido.').optional(),
    name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres.').optional(),
    lastName: z.string().min(2, 'Los apellidos deben tener al menos 2 caracteres.').optional(),
    dateOfBirth: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'Fecha de nacimiento inválida.').optional(),
  });

  const whatsappChallengeIdSchema = z.object({
    challengeId: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'La verificación venció. Iníciala de nuevo.'),
  });

  fastify.post(
    '/auth/whatsapp/iniciar',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const parsed = whatsappStartSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_PAYLOAD', message: parsed.error.issues[0]?.message || 'Datos inválidos.' },
        });
      }

      if (parsed.data.intent === 'register' && parsed.data.dateOfBirth) {
        const dateOfBirth = new Date(parsed.data.dateOfBirth);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        dateOfBirth.setHours(0, 0, 0, 0);
        if (dateOfBirth > today) {
          return reply.status(400).send({
            success: false,
            error: { code: 'INVALID_DATE_OF_BIRTH', message: 'La fecha de nacimiento no puede estar en el futuro.' },
          });
        }
      }

      const whatsappNumber = toWhatsAppLinkNumber(process.env.WHATSAPP_AUTH_PHONE || '');
      if (!whatsappNumber) {
        return reply.status(503).send({
          success: false,
          error: {
            code: 'WHATSAPP_AUTH_UNAVAILABLE',
            message: 'La verificación por WhatsApp no está configurada. Intenta más tarde.',
          },
        });
      }

      const redis = getRedis();
      const sentKey = 'whatsapp_auth:starts:' + parsed.data.phone;
      const sentCount = Number.parseInt((await redis.get(sentKey)) || '0', 10);
      if (sentCount >= WHATSAPP_AUTH_STARTS_PER_HOUR) {
        return reply.status(429).send({
          success: false,
          error: { code: 'WHATSAPP_AUTH_LIMIT', message: 'Alcanzaste el límite de intentos. Intenta de nuevo más tarde.' },
        });
      }

      const challengeId = crypto.randomBytes(32).toString('base64url');
      const messageCode = crypto.randomBytes(16).toString('hex');
      const challengeIdHash = crypto.createHash('sha256').update(challengeId).digest('hex');
      const challenge: WhatsAppAuthChallenge = {
        status: 'pending',
        intent: parsed.data.intent,
        phone: parsed.data.phone,
        ...(parsed.data.intent === 'register'
          ? {
              name: parsed.data.name?.trim(),
              lastName: parsed.data.lastName?.trim(),
              dateOfBirth: parsed.data.dateOfBirth,
              email: parsed.data.email ? normalizeEmail(parsed.data.email) : undefined,
            }
          : {}),
      };

      await redis.set(
        getWhatsAppChallengeKey(challengeId),
        JSON.stringify(challenge),
        'EX',
        WHATSAPP_AUTH_TTL_SECONDS,
      );
      await redis.set(
        getWhatsAppMessageKey(messageCode),
        challengeIdHash,
        'EX',
        WHATSAPP_AUTH_TTL_SECONDS,
      );
      await redis.multi().incr(sentKey).expire(sentKey, 60 * 60).exec();

      const whatsappUrl = 'https://wa.me/' + whatsappNumber + '?text=' +
        encodeURIComponent('SADEL ' + messageCode);
      return reply.send({
        success: true,
        data: {
          challengeId,
          whatsappUrl,
          expiresInSeconds: WHATSAPP_AUTH_TTL_SECONDS,
        },
      });
    },
  );

  fastify.post(
    '/auth/whatsapp/estado',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = whatsappChallengeIdSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_PAYLOAD', message: parsed.error.issues[0]?.message || 'Solicitud inválida.' },
        });
      }

      const redis = getRedis();
      const challengeKey = getWhatsAppChallengeKey(parsed.data.challengeId);
      const raw = await redis.get(challengeKey);
      if (!raw) {
        return reply.status(410).send({
          success: false,
          error: { code: 'WHATSAPP_CHALLENGE_EXPIRED', message: 'La verificación venció. Solicita una nueva.' },
        });
      }

      let challenge: WhatsAppAuthChallenge;
      try {
        challenge = JSON.parse(raw);
      } catch {
        await redis.del(challengeKey);
        return reply.status(410).send({
          success: false,
          error: { code: 'WHATSAPP_CHALLENGE_EXPIRED', message: 'La verificación venció. Solicita una nueva.' },
        });
      }

      return reply.send({
        success: true,
        data: {
          status: challenge.status === 'pending' ? 'pending' : 'verified',
          expiresInSeconds: Math.max(await redis.ttl(challengeKey), 0),
        },
      });
    },
  );

  fastify.post(
    '/auth/whatsapp/confirmar',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const parsed = whatsappChallengeIdSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_PAYLOAD', message: parsed.error.issues[0]?.message || 'Solicitud inválida.' },
        });
      }

      const redis = getRedis();
      const challengeKey = getWhatsAppChallengeKey(parsed.data.challengeId);
      const raw = await redis.get(challengeKey);
      if (!raw) {
        return reply.status(410).send({
          success: false,
          error: { code: 'WHATSAPP_CHALLENGE_EXPIRED', message: 'La verificación venció. Solicita una nueva.' },
        });
      }

      let challenge: WhatsAppAuthChallenge;
      try {
        challenge = JSON.parse(raw);
      } catch {
        await redis.del(challengeKey);
        return reply.status(410).send({
          success: false,
          error: { code: 'WHATSAPP_CHALLENGE_EXPIRED', message: 'La verificación venció. Solicita una nueva.' },
        });
      }

      if (challenge.status === 'pending') {
        return reply.status(409).send({
          success: false,
          error: { code: 'WHATSAPP_NOT_VERIFIED', message: 'Envía el mensaje desde tu WhatsApp para continuar.' },
        });
      }

      if (challenge.grantToken) {
        return reply.send({
          success: true,
          data: challenge.intent === 'register'
            ? { registerToken: challenge.grantToken }
            : { resetToken: challenge.grantToken },
        });
      }

      let grantToken: string;
      if (challenge.intent === 'register') {
        const existingUser = await prisma.user.findFirst({
          where: { phoneNormalized: challenge.phone, role: UserRole.CUSTOMER },
          select: { id: true },
        });
        if (existingUser) {
          return reply.status(409).send({
            success: false,
            error: {
              code: 'PHONE_ALREADY_REGISTERED',
              message: 'Este número ya tiene una cuenta. Inicia sesión o recupera tu contraseña.',
            },
          });
        }

        grantToken = await reply.jwtSign({
          phone: challenge.phone,
          name: challenge.name,
          lastName: challenge.lastName,
          dateOfBirth: challenge.dateOfBirth,
          email: isRealEmail(challenge.email) ? challenge.email : undefined,
          verification: 'whatsapp',
          intent: 'register_confirm',
        }, { expiresIn: '15m' });
      } else {
        const user = await prisma.user.findFirst({
          where: { phoneNormalized: challenge.phone, role: UserRole.CUSTOMER },
          select: { id: true, phone: true },
        });
        if (!user) {
          return reply.status(404).send({
            success: false,
            error: { code: 'USER_NOT_FOUND', message: 'No existe una cuenta con ese teléfono.' },
          });
        }

        grantToken = await reply.jwtSign({
          sub: user.id,
          phone: user.phone,
          verification: 'whatsapp',
          intent: 'password_reset',
        }, { expiresIn: '15m' });
      }

      const remainingTtl = await redis.ttl(challengeKey);
      if (remainingTtl <= 0) {
        return reply.status(410).send({
          success: false,
          error: { code: 'WHATSAPP_CHALLENGE_EXPIRED', message: 'La verificación venció. Solicita una nueva.' },
        });
      }

      await redis.set(
        challengeKey,
        JSON.stringify({ ...challenge, status: 'exchanged', grantToken }),
        'EX',
        remainingTtl,
      );

      return reply.send({
        success: true,
        data: challenge.intent === 'register'
          ? { registerToken: grantToken }
          : { resetToken: grantToken },
      });
    },
  );

  // Legacy OTP routes remain retired; the email option uses the challenge-based
  // endpoints above so its proof can be exchanged once for a scoped JWT.
  const retiredOtpResponse = async (_request: FastifyRequest, reply: FastifyReply) =>
    reply.status(410).send({
      success: false,
      error: {
        code: 'AUTH_VERIFICATION_UPDATE_REQUIRED',
        message: 'Actualiza la aplicación para elegir la verificación por correo o WhatsApp.',
      },
    });
  fastify.post('/auth/enviar-codigo', retiredOtpResponse);
  fastify.post('/auth/verificar-codigo', retiredOtpResponse);

  fastify.get('/auth/perfil', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Debes iniciar sesion para consultar tu perfil.',
        },
      });
    }

    const payload = request.user as { sub: string };
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        name: true,
        lastName: true,
        phone: true,
        email: true,
        role: true,
        region: true,
        status: true,
        profilePhoto: true,
        createdAt: true,
        dateOfBirth: true,
      },
    });

    if (!user) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'No se encontro el usuario.',
        },
      });
    }

    return reply.send({
      success: true,
      data: user,
    });
  });

  // Availability checks are retired; registration validates both values when
  // starting the selected email or WhatsApp verification flow.
  fastify.post('/auth/check-phone', retiredOtpResponse);
  fastify.post('/auth/check-email', retiredOtpResponse);

  fastify.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const parsed = customerLoginSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_PAYLOAD',
          message: parsed.error.issues[0]?.message || 'Datos invalidos.',
        },
      });
    }

    const result = await authenticateUserByRole({
      phone: parsed.data.phone,
      password: parsed.data.password,
      role: UserRole.CUSTOMER,
    });

    if ('error' in result) {
      const statusMap: Record<string, [number, string]> = {
        INVALID_CREDENTIALS: [401, 'Teléfono o contraseña incorrectos.'],
      };
      const [httpStatus, message] = statusMap[result.error as string] ?? [401, 'Credenciales inválidas.'];
      return reply.status(httpStatus).send({
        success: false,
        error: { code: result.error, message },
      });
    }

    const { user } = result;

    const token = await reply.jwtSign({
      sub: user.id,
      phone: user.phone,
      role: user.role,
    });

    const refreshToken = await createRefreshToken(user.id);

    return reply.send({
      success: true,
      data: {
        token,
        refreshToken,
        user: {
          id: user.id,
          name: user.name,
          phone: user.phone,
          role: user.role,
          region: user.region,
          status: user.status,
          profilePhoto: user.profilePhoto,
          lastName: user.lastName,
        },
      },
    });
  });

  fastify.post('/auth/restaurant-login', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_PAYLOAD',
          message: parsed.error.issues[0]?.message || 'Datos invalidos.',
        },
      });
    }

    const result = await authenticateUserByRole({
      phone: parsed.data.phone,
      password: parsed.data.password,
      role: UserRole.RESTAURANT,
    });

    if ('error' in result) {
      const statusMap: Record<string, [number, string]> = {
        INVALID_CREDENTIALS: [401, 'Teléfono o contraseña incorrectos.'],
      };
      const [httpStatus, message] = statusMap[result.error as string] ?? [401, 'Credenciales inválidas.'];
      return reply.status(httpStatus).send({
        success: false,
        error: { code: result.error, message },
      });
    }

    const { user } = result;

    const token = await reply.jwtSign({
      sub: user.id,
      phone: user.phone,
      role: user.role,
    });

    const refreshToken = await createRefreshToken(user.id);

    return reply.send({
      success: true,
      data: {
        token,
        refreshToken,
        user: {
          id: user.id,
          name: user.name,
          phone: user.phone,
          role: user.role,
          region: user.region,
          status: user.status,
          profilePhoto: user.profilePhoto,
          dateOfBirth: user.dateOfBirth,
          lastName: user.lastName,
        },
      },
    });
  });

  fastify.post('/auth/admin-login', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_PAYLOAD',
          message: parsed.error.issues[0]?.message || 'Datos invalidos.',
        },
      });
    }

    const result = await authenticateUserByRole({
      phone: parsed.data.phone,
      password: parsed.data.password,
      role: UserRole.ADMIN,
    });

    if ('error' in result) {
      const statusMap: Record<string, [number, string]> = {
        INVALID_CREDENTIALS: [401, 'Usuario o contraseña incorrectos.'],
      };
      const [httpStatus, message] = statusMap[result.error as string] ?? [401, 'Credenciales inválidas.'];
      return reply.status(httpStatus).send({
        success: false,
        error: { code: result.error, message },
      });
    }

    const { user } = result;

    const token = await reply.jwtSign({
      sub: user.id,
      phone: user.phone,
      role: user.role,
    });

    const refreshToken = await createRefreshToken(user.id);

    return reply.send({
      success: true,
      data: {
        token,
        refreshToken,
        user: {
          id: user.id,
          name: user.name,
          phone: user.phone,
          role: user.role,
          region: user.region,
          status: user.status,
          profilePhoto: user.profilePhoto,
          lastName: user.lastName,
        },
      },
    });
  });

  fastify.post('/auth/driver-login', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_PAYLOAD',
          message: parsed.error.issues[0]?.message || 'Datos invalidos.',
        },
      });
    }

    const { phone, password } = parsed.data;

    // ── Per-account brute-force protection (Redis) ────────────────────────
    const redis = getRedis();
    const lockKey = `driver_login_lock:${phone}`;
    const attemptsKey = `driver_login_attempts:${phone}`;

    const isLocked = await redis.get(lockKey);
    if (isLocked) {
      return reply.status(429).send({
        success: false,
        error: {
          code: 'ACCOUNT_LOCKED',
          message: 'Demasiados intentos fallidos. Intenta de nuevo en 15 minutos.',
        },
      });
    }
    // ──────────────────────────────────────────────────────────────────────

    const result = await authenticateUserByRole({
      phone,
      password,
      role: UserRole.DRIVER,
    });

    if ('error' in result) {
      // Increment failed attempt counter
      if (result.error === 'INVALID_CREDENTIALS') {
        const attempts = await redis.incr(attemptsKey);
        await redis.expire(attemptsKey, 15 * 60); // 15 min window
        if (attempts >= 5) {
          await redis.setex(lockKey, 15 * 60, '1'); // lock for 15 min
          await redis.del(attemptsKey);
        }
      }

      const statusMap: Record<string, [number, string]> = {
        INVALID_CREDENTIALS: [401, 'Teléfono o contraseña incorrectos.'],
      };
      const [httpStatus, message] = statusMap[result.error as string] ?? [401, 'Credenciales inválidas.'];

      return reply.status(httpStatus).send({
        success: false,
        error: { code: result.error, message },
      });
    }

    // Successful login – clear attempt counters
    await redis.del(attemptsKey);
    await redis.del(lockKey);

    const { user } = result;

    const token = await reply.jwtSign({
      sub: user.id,
      phone: user.phone,
      role: user.role,
    });

    const refreshToken = await createRefreshToken(user.id);

    return reply.send({
      success: true,
      data: {
        token,
        refreshToken,
        user: {
          id: user.id,
          name: user.name,
          phone: user.phone,
          role: user.role,
          region: user.region,
          status: user.status,
          profilePhoto: user.profilePhoto,
          dateOfBirth: user.dateOfBirth,
        },
      },
    });
  });

  const resetPasswordSchema = z.object({
    newPassword: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres.'),
  });

  fastify.post('/auth/reset-password', async (request, reply) => {
    const parsed = resetPasswordSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_PAYLOAD',
          message: parsed.error.issues[0]?.message || 'Datos invalidos.',
        },
      });
    }

    try {
      await request.jwtVerify();
      const decoded = request.user as { sub: string, intent?: string; verification?: string };

      if (
        decoded.intent !== 'password_reset' ||
        (decoded.verification !== 'whatsapp' && decoded.verification !== 'email')
      ) {
        throw new Error('Invalid intent');
      }

      await prisma.user.update({
        where: { id: decoded.sub },
        data: {
          password: await bcryptjs.hash(parsed.data.newPassword, 10),
        },
      });

      return reply.send({
        success: true,
        data: {
          message: 'La contraseña se actualizo correctamente.',
        },
      });
    } catch (err) {
      return reply.status(401).send({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'El token de recuperación es inválido o ha expirado.',
        },
      });
    }
  });

  const completeRegisterSchema = z.object({
    password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres.'),
  });

  fastify.post('/auth/complete-register', async (request, reply) => {
    const parsed = completeRegisterSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_PAYLOAD',
          message: parsed.error.issues[0]?.message || 'Datos invalidos.',
        },
      });
    }

    try {
      await request.jwtVerify();
      const decoded = request.user as {
        phone: string;
        name?: string;
        lastName?: string;
        dateOfBirth?: string;
        email?: string;
        intent?: string;
        verification?: string;
      };

      if (
        decoded.intent !== 'register_confirm' ||
        (decoded.verification !== 'whatsapp' && decoded.verification !== 'email') ||
        !isMexicanLocalPhone(decoded.phone) ||
        (decoded.verification === 'email' && !isRealEmail(decoded.email))
      ) {
        throw new Error('Invalid intent');
      }

      const existingUser = await prisma.user.findFirst({
        where: { phoneNormalized: decoded.phone, role: UserRole.CUSTOMER },
      });

      if (existingUser) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'PHONE_ALREADY_REGISTERED',
            message: 'Este teléfono ya tiene una cuenta registrada.',
          },
        });
      }

      const role = UserRole.CUSTOMER;
      const region = 'default';
      const name = decoded.name || `Usuario ${decoded.phone.slice(-4)}`;
      const hashedPassword = await bcryptjs.hash(parsed.data.password, 10);

      const email = isRealEmail(decoded.email)
        ? normalizeEmail(decoded.email!)
        : `${decoded.phone}@sadel.local`;

      if (isRealEmail(email)) {
        const emailExists = await prisma.user.findFirst({
          where: { email: { equals: email, mode: 'insensitive' } },
          select: { id: true },
        });
        if (emailExists) {
          return reply.status(409).send({
            success: false,
            error: {
              code: 'EMAIL_ALREADY_REGISTERED',
              message: 'Este correo ya tiene una cuenta registrada.',
            },
          });
        }
      }

      let createdUser;
      try {
        createdUser = await prisma.user.create({
          data: {
            email,
            password: hashedPassword,
            phone: decoded.phone,
            phoneNormalized: decoded.phone,
            name,
            lastName: decoded.lastName || null,
            dateOfBirth: decoded.dateOfBirth ? new Date(decoded.dateOfBirth) : null,
            role,
            region,
          },
        });
      } catch (err) {
        // Race de registro simultáneo: violación de unicidad (email o phone)
        if (err && (err as { code?: string }).code === 'P2002') {
          return reply.status(409).send({
            success: false,
            error: {
              code: 'ACCOUNT_CONFLICT',
              message: 'Ese telefono o correo ya tiene una cuenta registrada.',
            },
          });
        }
        throw err;
      }

      await createRelatedProfile(createdUser.id, role);

      const user = await prisma.user.findUniqueOrThrow({
        where: { id: createdUser.id },
        include: { admin: true },
      });

      const token = await reply.jwtSign({
        sub: user.id,
        phone: user.phone,
        role: user.role,
      });

      return reply.send({
        success: true,
        data: {
          token,
          user: {
            id: user.id,
            name: user.name,
            phone: user.phone,
            role: user.role,
            region: user.region,
            status: user.status,
            profilePhoto: user.profilePhoto,
            dateOfBirth: user.dateOfBirth,
            lastName: user.lastName,
          },
        },
      });
    } catch (err) {
      return reply.status(401).send({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'El token de registro es inválido o ha expirado.',
        },
      });
    }
  });

  fastify.post('/auth/refresh', async (request, reply) => {
    const parsed = z.object({
      refreshToken: z.string().min(1, 'El refresh token es obligatorio.'),
    }).safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_PAYLOAD',
          message: parsed.error.issues[0]?.message || 'Datos invalidos.',
        },
      });
    }

    const result = await validateAndRotateRefreshToken(parsed.data.refreshToken);

    if (!result) {
      return reply.status(401).send({
        success: false,
        error: {
          code: 'INVALID_REFRESH_TOKEN',
          message: 'El refresh token es inválido o ha expirado.',
        },
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: result.userId },
    });

    if (!user) {
      return reply.status(401).send({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'El usuario asociado al token ya no existe.',
        },
      });
    }

    const token = await reply.jwtSign({
      sub: user.id,
      phone: user.phone,
      role: user.role,
    });

    return reply.send({
      success: true,
      data: {
        token,
        refreshToken: result.refreshToken,
      },
    });
  });
}
