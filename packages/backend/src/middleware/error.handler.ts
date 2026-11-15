/**
 * Error Handler Middleware
 */

import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { isAppError } from '../errors/app-error';
import { logger } from '../utils/logger';
import { buildRequestContext } from '../utils/request-context';

export const errorHandler = async (
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const context = buildRequestContext(request);

  logger.error('Error caught', {
    ...context,
    statusCode: error.statusCode,
    errorCode: error.code,
    errorMessage: error.message,
  });

  reply.header('x-request-id', context.requestId);

  if (isAppError(error)) {
    return reply.status(error.statusCode).send({
      success: false,
      meta: {
        requestId: context.requestId,
      },
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    });
  }

  const status = error.statusCode || 500;
  const isProd = process.env.NODE_ENV === 'production';

  // Nunca exponer detalles internos (mensajes de Prisma, librerías, rutas) a
  // producción en errores de servidor (5xx). Los errores 4xx controlados que
  // no son AppError (p. ej. validación de Fastify) sí pueden devolver su mensaje.
  const message =
    status >= 500
      ? 'Ocurrió un error interno del servidor. Intenta nuevamente.'
      : error.message || 'Solicitud inválida.';

  return reply.status(status).send({
    success: false,
    meta: {
      requestId: context.requestId,
    },
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message,
      ...(status < 500 && error.message ? { details: error.message } : {}),
      ...(!isProd && error.stack ? { stack: error.stack } : {}),
    },
  });
};
