export const DEFAULT_MAX_CASH_ORDER = 500;

export function resolveMaxCashOrder(configured?: number | null): number {
  if (configured == null || !Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_MAX_CASH_ORDER;
  }
  return configured;
}

export function isCashPaymentAllowed(amount: number, maxCashOrder?: number | null): boolean {
  return amount <= resolveMaxCashOrder(maxCashOrder);
}
