import { FastifyRequest } from 'fastify';

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

type RequestContextState = {
  requestId: string;
  startedAt: number;
};

function extractOrderId(request: FastifyRequest): string | undefined {
  const params = asRecord(request.params);
  if (typeof params?.id === 'string' && params.id.trim()) {
    return params.id;
  }

  const body = asRecord(request.body);
  if (typeof body?.orderId === 'string' && body.orderId.trim()) {
    return body.orderId;
  }

  return undefined;
}

export function buildRequestContext(request: FastifyRequest) {
  const user = request.user as { sub?: string; role?: string; phone?: string } | undefined;
  const requestContext = getOrCreateRequestContext(request);

  return {
    requestId: requestContext.requestId,
    method: request.method,
    url: request.url || '/',
    route: request.routeOptions?.url || request.url || '/',
    actorId: user?.sub,
    actorRole: user?.role,
    actorPhone: user?.phone,
    orderId: extractOrderId(request),
  };
}

export function getOrCreateRequestContext(request: FastifyRequest): RequestContextState {
  if (request.requestContext?.requestId && typeof request.requestContext.startedAt === 'number') {
    return request.requestContext;
  }

  const requestIdHeader = request.headers['x-request-id'];
  const requestId =
    typeof requestIdHeader === 'string' && requestIdHeader.trim()
      ? requestIdHeader
      : typeof request.id === 'string' && request.id.trim()
        ? request.id
        : createRequestId();

  const fallbackContext = {
    requestId,
    startedAt: Date.now(),
  };

  request.requestContext = fallbackContext;

  return fallbackContext;
}

export function createRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
