/**
 * Charge authorization is separate from exposing reservation/status endpoints.
 * All values are injected by the explicit local sandbox configuration; ambient
 * environment variables are never copied into the WingsLab service process.
 */
export function isSandboxCardChargingEnabled(env: Record<string, string | undefined>): boolean {
  return env.WINGSLAB_ENVIRONMENT === 'local' &&
    env.WINGSLAB_CHECKOUT_SANDBOX_ROUTES === 'true' &&
    env.WINGSLAB_CHECKOUT_RESERVATION_SWEEP === 'true' &&
    env.WINGSLAB_CHECKOUT_SANDBOX_CHARGES === 'true' &&
    Boolean(env.WINGSLAB_MP_SANDBOX_ACCESS_TOKEN?.trim());
}
