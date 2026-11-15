export type PromoLimitInput = {
  firstPurchaseOnly: boolean;
  previousPurchaseCount: number;
  maxUsesPerCustomer: number | null;
  customerUseCount: number;
};

export function getPromoLimitViolation(input: PromoLimitInput): 'FIRST_PURCHASE_ONLY' | 'PROMO_CODE_CUSTOMER_LIMIT' | null {
  if (input.firstPurchaseOnly && input.previousPurchaseCount > 0) return 'FIRST_PURCHASE_ONLY';
  if (input.maxUsesPerCustomer !== null && input.customerUseCount >= input.maxUsesPerCustomer) return 'PROMO_CODE_CUSTOMER_LIMIT';
  return null;
}
