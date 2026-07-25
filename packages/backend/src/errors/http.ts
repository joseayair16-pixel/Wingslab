import { FastifyReply } from 'fastify';

import { AppError, isAppError } from './app-error';
import { recordErrorMetric } from '../utils/metrics';
import { getOrCreateRequestContext } from '../utils/request-context';

export function sendAppError(reply: FastifyReply, error: unknown): FastifyReply {
  if (isAppError(error)) {
    const requestContext = getOrCreateRequestContext(reply.request);
    recordErrorMetric(error.code);
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

  const message = error instanceof Error ? error.message : String(error);
  console.error('[sendAppError] Unhandled non-AppError:', error);
  return reply.status(500).send({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message,
    },
  });
}

export function badRequest(message: string, details?: unknown): AppError {
  return new AppError(400, 'BAD_REQUEST', message, details);
}
