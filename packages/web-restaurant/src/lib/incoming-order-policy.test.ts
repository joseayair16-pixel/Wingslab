import { incomingOrderDisposition } from './incoming-order-policy';

describe('incoming order presentation', () => {
  const pending = { resolved: false, prompted: false, automaticDecisions: false, expiresAt: 100, now: 200 };
  it('shows pending orders even after the old deadline when automatic decisions are disabled', () => {
    expect(incomingOrderDisposition(pending)).toBe('prompt');
  });
  it('does not repeat an already presented or resolved order', () => {
    expect(incomingOrderDisposition({ ...pending, prompted: true })).toBe('ignore');
    expect(incomingOrderDisposition({ ...pending, resolved: true })).toBe('ignore');
  });
  it('retains expiry handling only when explicitly enabled', () => {
    expect(incomingOrderDisposition({ ...pending, automaticDecisions: true })).toBe('reject');
  });
});
