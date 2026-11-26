import { randomInt } from 'node:crypto';

/** Four digits, including leading zeroes; never derived from order data. */
export function generateDeliveryPin(): string {
  return String(randomInt(0, 10_000)).padStart(4, '0');
}
