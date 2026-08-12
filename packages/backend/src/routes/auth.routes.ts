import { Admin, Customer, UserRole } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcryptjs from 'bcryptjs';

import crypto from 'node:crypto';
import { prisma } from '../config/database';
import { getRedis } from '../config/redis';
import { deliverOtp } from '../services/otp-delivery.service';
import {
  createRefreshToken,
  validateAndRotateRefreshToken,
} from '../services/refresh-token.service';

const authIntentSchema = z.enum(['register', 'recovery']);

const OTP_TTL_SECONDS = 300; // Validez del código: 5 minutos
const OTP_MAX_ATTEMPTS = 5; // Intentos de verificación antes de invalidar el código
const OTP_RESEND_PER_HOUR = 30; // Tope de reenvíos por teléfono en 1 hora (control de costo)

function generateRandomOtp(): string {
  return crypto.randomInt(100000, 999999).toString();
}

// Comparación en tiempo constante para evitar "timing attacks"
function codesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// El correo solo se acepta de verdad si viene de un usuario; los dominios
// sintéticos (@sadel.local) no sirven para entregar código.
function isRealEmail(email?: string | null): boolean {
  return Boolean(email && email.includes('@') && !email.endsWith('@sadel.local'));
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

function isPasswordHash(password: string): boolean {
  return /^\$2[aby]\$\d{2}\$/.test(password);
}

const sendCodeSchema = z.object({
  phone: z
    .string()
    .min(8, 'El telefono es obligatorio.')
    .transform(normalizePhone)
    .refine((value) => value.length === 10, 'El telefono debe tener 10 digitos.'),
  intent: authIntentSchema,
  role: z.nativeEnum(UserRole).optional(),
  email: z.string().email('Correo invalido.').optional(),
  channel: z.enum(['email', 'sms']).optional(),
});

const verifyCodeSchema = z.object({
  phone: z
    .string()
    .min(8, 'El telefono es obligatorio.')
    .transform(normalizePhone)
    .refine((value) => value.length === 10, 'El telefono debe tener 10 digitos.'),
  code: z.string().length(6, 'El codigo debe tener 6 digitos.'),
  name: z.string().min(2, 'El nombre es obligatorio.').optional(),
  lastName: z.string().min(2, 'El apellido es obligatorio.').optional(),
  dateOfBirth: z.string().refine((val) => !isNaN(Date.parse(val)), { message: 'Fecha de nacimiento inválida' }).optional(),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres.').optional(),
  role: z.nativeEnum(UserRole).optional(),
  region: z.string().min(1, 'La region es obligatoria.').optional(),
  intent: authIntentSchema,
  email: z.string().email('Correo invalido.').optional(),
});

const loginSchema = z.object({
  phone: z
    .string()
    .min(8, 'El telefono es obligatorio.')
    .transform(normalizePhone)
    .refine((value) => value.length === 10, 'El telefono debe tener 10 digitos.'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres.'),
});

async function authenticateUserByRole(params: {
  phone: string;
  password: string;
  role: UserRole;
}) {
  const user = await prisma.user.findFirst({
    where: {
      phone: {
        in: getPhoneLookupCandidates(params.phone),
      },
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

const checkPhoneSchema = z.object({
  phone: z
    .string()
    .min(8, 'El telefono es obligatorio.')
    .transform(normalizePhone)
    .refine((value) => value.length === 10, 'El telefono debe tener 10 digitos.'),
  role: z.nativeEnum(UserRole).optional(),
});

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
  fastify.post(
    '/auth/enviar-codigo',
    async (request, reply) => {
      const parsed = sendCodeSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_PAYLOAD',
          message: parsed.error.issues[0]?.message || 'Datos invalidos.',
        },
      });
    }

    const existingUser = await prisma.user.findFirst({
      where: {
        phone: {
          in: getPhoneLookupCandidates(parsed.data.phone),
        },
        ...(parsed.data.role ? { role: parsed.data.role } : {}),
      },
      select: { id: true, email: true },
    });

    if (parsed.data.intent === 'register' && existingUser) {
      return reply.status(409).send({
        success: false,
        error: {
          code: 'PHONE_ALREADY_REGISTERED',
          message: 'Este telefono ya tiene una cuenta registrada.',
        },
      });
    }

    if (parsed.data.intent === 'recovery' && !existingUser) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'No existe una cuenta con ese telefono.',
        },
      });
    }

    const redis = getRedis();
    const redisKey = `otp:${parsed.data.phone}`;

    // Tope de reenvíos por teléfono en 1 hora (control de costo/abuso)
    const sentKey = `otp_sent:${parsed.data.phone}`;
    const sentCount = await redis.get(sentKey);
    if (sentCount && parseInt(sentCount, 10) >= OTP_RESEND_PER_HOUR) {
      return reply.status(429).send({
        success: false,
        error: {
          code: 'OTP_RESEND_LIMIT',
          message: 'Has alcanzado el límite de códigos por hora. Intenta más tarde.',
        },
      });
    }

    // El correo se usa SOLO como canal de entrega; la identidad es el teléfono.
    // En registro se toma del payload; en recuperación del correo guardado.
    const email =
      (parsed.data.intent === 'register' && isRealEmail(parsed.data.email))
        ? parsed.data.email
        : (parsed.data.intent === 'recovery' && existingUser && isRealEmail(existingUser.email))
          ? existingUser.email
          : undefined;

    // Si ya existe un código activo con el MISMO intent, se lo reentregamos al
    // usuario (mismo código, mismo canal solicitado). Así el clic de "recibir
    // código" siempre entrega un código en lugar de bloquear con 429.
    const rawExisting = await redis.get(redisKey);
    let existingRecord: { code: string; intent: string; email?: string | null } | null = null;
    if (rawExisting) {
      try {
        existingRecord = JSON.parse(rawExisting);
      } catch {
        existingRecord = null;
      }
    }

    if (existingRecord && existingRecord.intent === parsed.data.intent) {
      const remainingTtl = Math.max(await redis.ttl(redisKey), 1);
      const resendDelivery = await deliverOtp({
        phone: parsed.data.phone,
        email,
        code: existingRecord.code,
        preferred: parsed.data.channel,
      });

      if (!resendDelivery.ok) {
        return reply.status(503).send({
          success: false,
          error: {
            code: 'DELIVERY_FAILED',
            message: 'No se pudo enviar el código. Intenta más tarde.',
          },
        });
      }

      await redis.multi().incr(sentKey).expire(sentKey, 60 * 60).exec();

      return reply.send({
        success: true,
        data: {
          phone: parsed.data.phone,
          channel: resendDelivery.channel,
          expiresInSeconds: remainingTtl,
          resent: true,
          ...(resendDelivery.channel === 'mock' && resendDelivery.mockCode
            ? { mockCode: resendDelivery.mockCode }
            : {}),
        },
      });
    }

    const code = generateRandomOtp();

    // Guardar en Redis: código + intent + correo de entrega (5 minutos)
    await redis.set(
      redisKey,
      JSON.stringify({ code, intent: parsed.data.intent, email: email ?? null }),
      'EX',
      OTP_TTL_SECONDS,
    );

    // Registrar envío para el tope horario
    await redis.multi().incr(sentKey).expire(sentKey, 60 * 60).exec();

    const delivery = await deliverOtp({
      phone: parsed.data.phone,
      email,
      code,
      preferred: parsed.data.channel,
    });

    // Si no hubo canal real de entrega (en producción), no fingir éxito
    if (!delivery.ok) {
      // Borrar el OTP para no dejar un código "fantasma" que bloquee reintentos
      await redis.del(redisKey);
      return reply.status(503).send({
        success: false,
        error: {
          code: 'DELIVERY_FAILED',
          message: 'No se pudo enviar el código. Intenta más tarde.',
        },
      });
    }

    return reply.send({
      success: true,
      data: {
        phone: parsed.data.phone,
        channel: delivery.channel,
        expiresInSeconds: OTP_TTL_SECONDS,
        ...(delivery.channel === 'mock' && delivery.mockCode ? { mockCode: delivery.mockCode } : {}),
      },
    });
  });

  fastify.post(
    '/auth/verificar-codigo',
    {
      config: {
        rateLimit: {
          max: 5, // Máximo 5 intentos por IP
          timeWindow: '15 minutes',
        },
      },
    },
    async (request, reply) => {
      const parsed = verifyCodeSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_PAYLOAD',
            message: parsed.error.issues[0]?.message || 'Datos invalidos.',
          },
        });
      }

      const redis = getRedis();
      const redisKey = `otp:${parsed.data.phone}`;
      const raw = await redis.get(redisKey);

      let otpRecord: { code: string; intent: string; email?: string | null } | null = null;
      if (raw) {
        try {
          otpRecord = JSON.parse(raw);
        } catch {
          otpRecord = null;
        }
      }

      if (!otpRecord) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_CODE',
            message: 'El codigo es invalido o ya expiro.',
          },
        });
      }

      // El código queda atado al intent que lo solicitó (register/recovery)
      if (otpRecord.intent !== parsed.data.intent) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_CODE',
            message: 'El codigo es invalido o ya expiro.',
          },
        });
      }

      // Límite de intentos por teléfono antes de invalidar el código
      const attemptsKey = `otp_attempts:${parsed.data.phone}`;
      const attempts = parseInt((await redis.get(attemptsKey)) || '0', 10);
      if (attempts >= OTP_MAX_ATTEMPTS) {
        await redis.del(redisKey);
        return reply.status(429).send({
          success: false,
          error: {
            code: 'TOO_MANY_ATTEMPTS',
            message: 'Demasiados intentos. Solicita un codigo nuevo.',
          },
        });
      }

      // Comparación en tiempo constante
      if (!codesMatch(otpRecord.code, parsed.data.code)) {
        await redis.incr(attemptsKey);
        await redis.expire(attemptsKey, OTP_TTL_SECONDS);
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_CODE',
            message: 'El codigo es invalido o ya expiro.',
          },
        });
      }

      await redis.del(redisKey);
      await redis.del(attemptsKey);

    if (parsed.data.intent === 'register' && !parsed.data.password) {
      const registerToken = await reply.jwtSign({
        phone: parsed.data.phone,
        name: parsed.data.name,
        lastName: parsed.data.lastName,
        dateOfBirth: parsed.data.dateOfBirth,
        email: isRealEmail(otpRecord.email) ? otpRecord.email : undefined,
        intent: 'register_confirm',
      }, { expiresIn: '15m' });

      return reply.send({
        success: true,
        data: {
          registerToken,
          message: 'Código verificado. Procede a crear tu contraseña.',
        },
      });
    }

    let user = await prisma.user.findFirst({
      where: {
        phone: {
          in: getPhoneLookupCandidates(parsed.data.phone),
        },
        ...(parsed.data.role ? { role: parsed.data.role } : {}),
      },
      include: { admin: true },
    });

    if (parsed.data.intent === 'register') {
      if (user) {
        return reply.status(409).send({
          success: false,
          error: {
            code: 'PHONE_ALREADY_REGISTERED',
            message: 'Este telefono ya tiene una cuenta registrada.',
          },
        });
      }

      const role = UserRole.CUSTOMER;
      const region = parsed.data.region || 'default';
      const name = parsed.data.name || `Usuario ${parsed.data.phone.slice(-4)}`;
      const hashedPassword = await bcryptjs.hash(parsed.data.password!, 10);

      // Fuente de verdad: el correo con el que se entregó el código (del OTP de Redis).
      // Se le pasa al frontend en el registro para que quede guardado en la cuenta.
      const email = isRealEmail(otpRecord.email)
        ? otpRecord.email!
        : isRealEmail(parsed.data.email)
          ? parsed.data.email!
          : `${parsed.data.phone}@sadel.local`;

      if (isRealEmail(email)) {
        const emailExists = await prisma.user.findUnique({
          where: { email },
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
            phone: parsed.data.phone,
            name,
            lastName: parsed.data.lastName || null,
            dateOfBirth: parsed.data.dateOfBirth ? new Date(parsed.data.dateOfBirth) : null,
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
      user = await prisma.user.findUniqueOrThrow({
        where: { id: createdUser.id },
        include: { admin: true },
      });
    } else {
      if (!user) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'No existe una cuenta con ese telefono.',
          },
        });
      }

      const resetToken = await reply.jwtSign({
        sub: user.id,
        phone: user.phone,
        intent: 'password_reset',
      }, { expiresIn: '15m' });

      return reply.send({
        success: true,
        data: {
          phone: user.phone,
          resetToken,
          message: 'Código verificado. Procede a cambiar tu contraseña.',
        },
      });
    }

    if (user.role === UserRole.CUSTOMER) {
      const customerProfile = await prisma.customer.findUnique({
        where: { userId: user.id },
      });

      if (!customerProfile) {
        await createRelatedProfile(user.id, UserRole.CUSTOMER);
      }
    }

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

  fastify.post('/auth/check-phone', { config: { rateLimit: { max: 30, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const parsed = checkPhoneSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_PAYLOAD',
          message: parsed.error.issues[0]?.message || 'Datos invalidos.',
        },
      });
    }

    const user = await prisma.user.findFirst({
      where: {
        phone: {
          in: getPhoneLookupCandidates(parsed.data.phone),
        },
        ...(parsed.data.role ? { role: parsed.data.role } : {}),
      },
      select: { id: true, phone: true },
    });

    return reply.send({
      success: true,
      data: {
        exists: !!user,
        phone: parsed.data.phone,
      },
    });
  });

  fastify.post('/auth/check-email', { config: { rateLimit: { max: 30, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const parsed = z.object({
      email: z.string().email('Correo invalido.'),
      role: z.nativeEnum(UserRole).optional(),
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

    const email = parsed.data.email.trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true },
    });

    return reply.send({
      success: true,
      data: {
        exists: !!user,
        email,
      },
    });
  });

  fastify.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (request, reply) => {
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
      role: UserRole.CUSTOMER,
    });

    if ('error' in result) {
      const statusMap: Record<string, [number, string]> = {
        ACCOUNT_SUSPENDED: [403, 'Tu cuenta ha sido suspendida. Contacta a soporte.'],
        ACCOUNT_INACTIVE:  [403, 'Tu cuenta está inactiva. Contacta al administrador.'],
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
        ACCOUNT_SUSPENDED: [403, 'Tu cuenta ha sido suspendida. Contacta a soporte.'],
        ACCOUNT_INACTIVE:  [403, 'Tu cuenta está inactiva. Contacta al administrador.'],
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
        ACCOUNT_SUSPENDED: [403, 'Tu cuenta ha sido suspendida. Contacta a soporte.'],
        ACCOUNT_INACTIVE:  [403, 'Tu cuenta está inactiva. Contacta al administrador.'],
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
      const decoded = request.user as { sub: string, intent?: string };

      if (decoded.intent !== 'password_reset') {
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
      };

      if (decoded.intent !== 'register_confirm') {
        throw new Error('Invalid intent');
      }

      const existingUser = await prisma.user.findFirst({
        where: {
          phone: {
            in: getPhoneLookupCandidates(decoded.phone),
          },
          role: UserRole.CUSTOMER,
        },
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
        ? decoded.email!
        : `${decoded.phone}@sadel.local`;

      if (isRealEmail(email)) {
        const emailExists = await prisma.user.findUnique({
          where: { email },
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
