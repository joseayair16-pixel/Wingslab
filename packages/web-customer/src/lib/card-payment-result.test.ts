import { setCardPaymentResult, takeCardPaymentResult } from './card-payment-result';

describe('card payment result handoff', () => {
  afterEach(() => { takeCardPaymentResult(); });

  it.each(['VERIFIED', 'ORDER_CREATED'] as const)('hands off %s once', state => {
    setCardPaymentResult(state);
    expect(takeCardPaymentResult()).toBe(state);
    expect(takeCardPaymentResult()).toBeNull();
  });
});
