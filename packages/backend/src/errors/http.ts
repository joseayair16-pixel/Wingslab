import { FastifyReply } from 'fastify';

import { AppError, isAppError } from './app-error';
import { getOrCreateRequestContext } from '../utils/request-context';

export function sendAppError(reply: FastifyReply, error: unknown): FastifyReply {
  if (isAppError(error)) {
    const requestContext = getOrCreateRequestContext(reply.request);
    return reply.status(error.statusCode).send({
      success: false,
      meta: {
        requestId: requestContext.requestId,
      },
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    });
  }

  // Never leak internal error messages (Prisma errors include model names,
  // fields and query fragments). Log the detail server-side and return a
  // generic message, mirroring the global error handler's redaction.
  console.error('[sendAppError] Unhandled non-AppError:', error);
  return reply.status(500).send({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Ocurrió un error interno del servidor.',
    },
  });
}

export function badRequest(message: string, details?: unknown): AppError {
  return new AppError(400, 'BAD_REQUEST', message, details);
}
