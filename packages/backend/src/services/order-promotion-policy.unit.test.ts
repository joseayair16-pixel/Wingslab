import { getPromoLimitViolation } from './order-promotion-policy';

test('allows first purchase once and blocks a prior WingsLab order', () => {
  expect(getPromoLimitViolation({ firstPurchaseOnly: true, previousPurchaseCount: 0, maxUsesPerCustomer: null, customerUseCount: 0 })).toBeNull();
  expect(getPromoLimitViolation({ firstPurchaseOnly: true, previousPurchaseCount: 1, maxUsesPerCustomer: null, customerUseCount: 0 })).toBe('FIRST_PURCHASE_ONLY');
});
test('enforces a per-customer usage ceiling at the boundary', () => {
  expect(getPromoLimitViolation({ firstPurchaseOnly: false, previousPurchaseCount: 0, maxUsesPerCustomer: 2, customerUseCount: 1 })).toBeNull();
  expect(getPromoLimitViolation({ firstPurchaseOnly: false, previousPurchaseCount: 0, maxUsesPerCustomer: 2, customerUseCount: 2 })).toBe('PROMO_CODE_CUSTOMER_LIMIT');
  expect(getPromoLimitViolation({ firstPurchaseOnly: false, previousPurchaseCount: 0, maxUsesPerCustomer: null, customerUseCount: 50 })).toBeNull();
});
