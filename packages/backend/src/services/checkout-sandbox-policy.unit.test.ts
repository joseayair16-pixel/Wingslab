import { isSandboxCardChargingEnabled } from './checkout-sandbox-policy';

const authorizedSandbox = {
  WINGSLAB_ENVIRONMENT: 'local',
  WINGSLAB_CHECKOUT_SANDBOX_ROUTES: 'true',
  WINGSLAB_CHECKOUT_RESERVATION_SWEEP: 'true',
  WINGSLAB_CHECKOUT_SANDBOX_CHARGES: 'true',
  WINGSLAB_MP_SANDBOX_ACCESS_TOKEN: 'configured',
};

describe('sandbox card charging authorization', () => {
  it('requires every explicit sandbox gate and a configured private token', () => {
    expect(isSandboxCardChargingEnabled(authorizedSandbox)).toBe(true);
    for (const key of Object.keys(authorizedSandbox)) {
      const disabled = { ...authorizedSandbox, [key]: '' };
      expect(isSandboxCardChargingEnabled(disabled)).toBe(false);
    }
  });

  it('fails closed for absent, partial, or non-true authorization', () => {
    expect(isSandboxCardChargingEnabled({ ...authorizedSandbox, WINGSLAB_ENVIRONMENT: 'production' })).toBe(false);
    expect(isSandboxCardChargingEnabled({})).toBe(false);
    expect(isSandboxCardChargingEnabled({ ...authorizedSandbox, WINGSLAB_CHECKOUT_SANDBOX_CHARGES: '1' })).toBe(false);
    expect(isSandboxCardChargingEnabled({ ...authorizedSandbox, WINGSLAB_CHECKOUT_RESERVATION_SWEEP: 'false' })).toBe(false);
  });
});
