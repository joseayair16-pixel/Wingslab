import { resolveMaxCashOrder, isCashPaymentAllowed, DEFAULT_MAX_CASH_ORDER } from './cash-policy';

describe('resolveMaxCashOrder', () => {
  it('usa el valor configurado por el restaurante', () => {
    expect(resolveMaxCashOrder(1000)).toBe(1000);
    expect(resolveMaxCashOrder(50)).toBe(50);
  });

  it('cae al default (500) cuando no está configurado', () => {
    expect(resolveMaxCashOrder(undefined)).toBe(DEFAULT_MAX_CASH_ORDER);
    expect(resolveMaxCashOrder(null)).toBe(DEFAULT_MAX_CASH_ORDER);
  });

  it('cae al default cuando el valor es invalido', () => {
    expect(resolveMaxCashOrder(0)).toBe(DEFAULT_MAX_CASH_ORDER);
    expect(resolveMaxCashOrder(-10)).toBe(DEFAULT_MAX_CASH_ORDER);
    expect(resolveMaxCashOrder(Number.NaN)).toBe(DEFAULT_MAX_CASH_ORDER);
    expect(resolveMaxCashOrder(Number.POSITIVE_INFINITY)).toBe(DEFAULT_MAX_CASH_ORDER);
  });
});

describe('isCashPaymentAllowed', () => {
  it('permite efectivo bajo el limite', () => {
    expect(isCashPaymentAllowed(500, 500)).toBe(true);
    expect(isCashPaymentAllowed(499.99, 500)).toBe(true);
  });

  it('bloquea efectivo por encima del limite', () => {
    expect(isCashPaymentAllowed(500.01, 500)).toBe(false);
    expect(isCashPaymentAllowed(600, 500)).toBe(false);
  });

  it('respeta el limite configurado por el restaurante', () => {
    expect(isCashPaymentAllowed(800, 1000)).toBe(true);
    expect(isCashPaymentAllowed(1200, 1000)).toBe(false);
  });

  it('usa el default de 500 sin configuracion', () => {
    expect(isCashPaymentAllowed(500, null)).toBe(true);
    expect(isCashPaymentAllowed(501, undefined)).toBe(false);
  });
});
