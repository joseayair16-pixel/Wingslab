import { UserRole } from '@prisma/client';
import { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../config/database';
import { recordErrorMetric } from '../utils/metrics';
import { getOrCreateRequestContext } from '../utils/request-context';

type AuthenticatedUser = {
  sub: string;
  phone: string;
  role: UserRole;
};

// In-memory cache for user status with TTL to avoid DB query on every request
const userStatusCache = new Map<string, { status: string; expiresAt: number }>();
const CACHE_TTL_MS = 30_000; // 30 seconds

function getCachedUserStatus(userId: string): string | null {
  const cached = userStatusCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.status;
  }
  userStatusCache.delete(userId);
  return null;
}

function setCachedUserStatus(userId: string, status: string): void {
  userStatusCache.set(userId, { status, expiresAt: Date.now() + CACHE_TTL_MS });

  // Evitar memory leak: si el caché crece demasiado, limpiar entradas expiradas
  if (userStatusCache.size > 10000) {
    const now = Date.now();
    for (const [key, value] of userStatusCache) {
      if (value.expiresAt <= now) {
        userStatusCache.delete(key);
      }
    }
  }
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    const requestContext = getOrCreateRequestContext(request);
    recordErrorMetric('UNAUTHORIZED');
    return reply.status(401).send({
      success: false,
      meta: {
        requestId: requestContext.requestId,
      },
      error: {
        code: 'UNAUTHORIZED',
        message: 'Debes iniciar sesion para continuar.',
      },
    });
  }

  const authenticatedUser = request.user as AuthenticatedUser | undefined;

  if (!authenticatedUser?.sub) {
    const requestContext = getOrCreateRequestContext(request);
    recordErrorMetric('UNAUTHORIZED');
    return reply.status(401).send({
      success: false,
      meta: {
        requestId: requestContext.requestId,
      },
      error: {
        code: 'UNAUTHORIZED',
        message: 'Sesión inválida o expirada.',
      },
    });
  }

  try {
    const cachedStatus = getCachedUserStatus(authenticatedUser.sub);
    let status: string | null = cachedStatus;

    if (!status) {
      const dbUser = await prisma.user.findUnique({
        where: { id: authenticatedUser.sub },
        select: { status: true },
      });
      status = dbUser?.status ?? null;
      if (status) {
        setCachedUserStatus(authenticatedUser.sub, status);
      }
    }

    if (status === null) {
      // El usuario ya no existe en la BD (fue eliminado). La sesión ya no es válida.
      const requestContext = getOrCreateRequestContext(request);
      recordErrorMetric('UNAUTHORIZED');
      return reply.status(401).send({
        success: false,
        meta: { requestId: requestContext.requestId },
        error: {
          code: 'UNAUTHORIZED',
          message: 'Tu sesión ya no es válida. Inicia sesión nuevamente.',
        },
      });
    }

    if (status !== 'ACTIVE') {
      const requestContext = getOrCreateRequestContext(request);
      recordErrorMetric('UNAUTHORIZED');
      return reply.status(403).send({
        success: false,
        meta: { requestId: requestContext.requestId },
        error: {
          code: 'ACCOUNT_DISABLED',
          message: 'Tu cuenta no se encuentra activa. Contacta al administrador.',
        },
      });
    }
  } catch (error) {
    const requestContext = getOrCreateRequestContext(request);
    recordErrorMetric('UNAUTHORIZED');
    return reply.status(401).send({
      success: false,
      meta: { requestId: requestContext.requestId },
      error: {
        code: 'AUTH_VALIDATION_ERROR',
        message: 'No se pudo verificar el estado de la cuenta. Intente nuevamente.',
      },
    });
  }
}

export function authorize(allowedRoles: UserRole[]) {
  return async function ensureRole(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = request.user as AuthenticatedUser | undefined;

    if (!user) {
      const requestContext = getOrCreateRequestContext(request);
      recordErrorMetric('UNAUTHORIZED');
      return reply.status(401).send({
        success: false,
        meta: { requestId: requestContext.requestId },
        error: {
          code: 'UNAUTHORIZED',
          message: 'No se encontro una sesion valida.',
        },
      });
    }

    if (!allowedRoles.includes(user.role)) {
      const requestContext = getOrCreateRequestContext(request);
      recordErrorMetric('FORBIDDEN');
      return reply.status(403).send({
        success: false,
        meta: { requestId: requestContext.requestId },
        error: {
          code: 'FORBIDDEN',
          message: 'No tienes permisos para realizar esta accion.',
        },
      });
    }
  };
}

export function getAuthenticatedUser(request: FastifyRequest): AuthenticatedUser {
  return request.user as AuthenticatedUser;
}
