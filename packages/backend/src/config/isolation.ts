/** External capabilities are deliberately unavailable throughout Phase 2A. */
export function externalServicesEnabled(): boolean {
  return false;
}

/** Web Push is a narrowly scoped opt-in; other external integrations stay blocked. */
export function webPushEnabled(): boolean {
  return process.env.WINGSLAB_WEB_PUSH_ENABLED === 'true' &&
    process.env.WINGSLAB_CONFIGURED === 'yes' &&
    process.env.WINGSLAB_RUNTIME_AUTHORIZED === 'reviewed-phase-2b' &&
    process.env.WINGSLAB_NETWORK_ATTESTED === 'yes' &&
    Boolean(process.env.WINGSLAB_WEB_PUSH_PUBLIC_KEY && process.env.WINGSLAB_WEB_PUSH_PRIVATE_KEY && process.env.WINGSLAB_WEB_PUSH_CONTACT);
}

/** Retry delivery is separately opt-in to avoid replaying an existing queue on startup. */
export function webPushRetryJobEnabled(): boolean {
  return webPushEnabled() && process.env.WINGSLAB_WEB_PUSH_RETRY_JOB_ENABLED === 'true';
}

/** First-party schedule enforcement, limited to the isolated reviewed runtime. */
export function restaurantHoursJobEnabled(): boolean {
  return process.env.WINGSLAB_RUNTIME_AUTHORIZED === 'reviewed-phase-2b' &&
    process.env.WINGSLAB_PROFILE === 'container';
}

export function assertExternalOperationAllowed(): void {
  throw new Error('[WingsLab] External operations are blocked in Phase 2A.');
}

export function assertAdministrativeOperationAllowed(): never {
  throw new Error('[WingsLab] Administrative operation blocked: verified resource identity and explicit operation authorization are not implemented yet. --confirm does not authorize execution.');
}

export function assertJobsDisabled(requested: boolean): void {
  if (requested) throw new Error('[WingsLab] Background jobs require per-job review; all are blocked in Phase 2A.');
}
