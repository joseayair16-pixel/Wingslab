export type ConfirmedCardPayment = 'VERIFIED' | 'ORDER_CREATED';

// Only a result obtained from the authenticated backend is handed to the home
// screen. Never put payment tokens or customer details in the URL or storage.
let result: ConfirmedCardPayment | null = null;

export function setCardPaymentResult(value: ConfirmedCardPayment) {
  result = value;
}

export function takeCardPaymentResult(): ConfirmedCardPayment | null {
  const current = result;
  result = null;
  return current;
}
