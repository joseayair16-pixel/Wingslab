/** External capabilities are deliberately unavailable throughout Phase 2A. */
export function externalServicesEnabled(): boolean {
  return false;
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
