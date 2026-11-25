import { createHash } from 'node:crypto';

/** GPS samples are validation-only and change on refresh; they are not part of the priced order. */
export function checkoutRequestFingerprint(input: Record<string, unknown>): string {
  const { currentLocation: _currentLocation, ...stableOrderInput } = input;
  return createHash('sha256').update(JSON.stringify(stableOrderInput)).digest('hex');
}
