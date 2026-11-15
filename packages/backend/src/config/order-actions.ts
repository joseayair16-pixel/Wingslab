import { manualOrderActionAllowed, manualOrderAllowed } from '@sadel/shared';
import { assertServiceIdentityVerified, getBackendConfiguration, isHermeticTest } from './env';
import { AppError } from '../errors/app-error';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * A WingsLab runtime is only "local verified" when the reviewed container
 * profile is active AND the service identities were verified at startup.
 * A missing runtime identity is never an authorization.
 */
export function isLocalVerifiedRuntime(): boolean {
  try {
    // Hermetic tests never reach the network or the database; the explicit
    // allowlist still applies to them.
    if (isHermeticTest()) return true;
    assertServiceIdentityVerified();
    return getBackendConfiguration().profile === 'container';
  } catch {
    return false;
  }
}

/** Explicit per-action capability: accept / preparing / ready on allowed orders. */
export function assertManualOrderAction(orderId: string, action: string): void {
  if (!manualOrderActionAllowed(orderId, action, isLocalVerifiedRuntime())) {
    throw new AppError(403, 'WINGSLAB_ORDER_ACTION_BLOCKED',
      'Esta acción o pedido no está autorizada para operaciones manuales de WingsLab.');
  }
}

const ORDER_MUTATION_ROUTE = /^\/restaurant-panel\/pedidos\/:id(\/|$)/;

/**
 * Runs after the existing JWT, role and operability hooks. Only explicitly
 * authorized fictional orders accept mutations; every other order fails closed.
 */
export async function requireManualOrderAction(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method)) return;
  const route = request.routeOptions.url || '';
  if (!ORDER_MUTATION_ROUTE.test(route)) return;
  const orderId = String((request.params as { id?: string })?.id || '');
  if (!manualOrderAllowed(orderId, isLocalVerifiedRuntime())) {
    return reply.status(403).send({
      success: false,
      error: {
        code: 'WINGSLAB_ORDER_ACTION_BLOCKED',
        message: 'Solo se pueden modificar pedidos ficticios explícitamente autorizados en WingsLab.',
      },
    });
  }
}
