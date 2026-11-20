import { JOB_GROUPS, validateJobSelection, startSelectedJobs, JobStarters } from './policy';

test('remaining job groups are explicit and every job is disabled', () => {
  expect(Object.keys(JOB_GROUPS).sort()).toEqual(['externalStorage', 'maintenance', 'notifications', 'orderLifecycle']);
  expect(Object.values(validateJobSelection()).every(value => value === false)).toBe(true);
});
test.each(['billing', 'billingOverdue', 'driverBillingCutoff', 'driverBillingOverdue', 'jitDispatch', 'cleanupProofs'])('removed job %s cannot be requested', name => {
  expect(() => validateJobSelection({ [name]: false })).toThrow('Invalid job selection');
});
test('requesting any job fails before invoking a starter', () => {
  const start = jest.fn();
  const starters = Object.fromEntries(Object.values(JOB_GROUPS).flat().map(name => [name, start])) as unknown as JobStarters;
  expect(() => startSelectedJobs({ orderTimeout: true }, starters)).toThrow();
  expect(start).not.toHaveBeenCalled();
});

test('notification retries are opt-in only when the isolated Web Push capability is configured', () => {
  const previous = {
    enabled: process.env.WINGSLAB_WEB_PUSH_ENABLED,
    configured: process.env.WINGSLAB_CONFIGURED,
    authorized: process.env.WINGSLAB_RUNTIME_AUTHORIZED,
    attested: process.env.WINGSLAB_NETWORK_ATTESTED,
    publicKey: process.env.WINGSLAB_WEB_PUSH_PUBLIC_KEY,
    privateKey: process.env.WINGSLAB_WEB_PUSH_PRIVATE_KEY,
    contact: process.env.WINGSLAB_WEB_PUSH_CONTACT,
    retryEnabled: process.env.WINGSLAB_WEB_PUSH_RETRY_JOB_ENABLED,
  };
  try {
    expect(() => validateJobSelection({ notificationRetry: true })).toThrow();
    Object.assign(process.env, {
      WINGSLAB_WEB_PUSH_ENABLED: 'true', WINGSLAB_CONFIGURED: 'yes',
      WINGSLAB_RUNTIME_AUTHORIZED: 'reviewed-phase-2b', WINGSLAB_NETWORK_ATTESTED: 'yes',
      WINGSLAB_WEB_PUSH_PUBLIC_KEY: 'public', WINGSLAB_WEB_PUSH_PRIVATE_KEY: 'private',
      WINGSLAB_WEB_PUSH_CONTACT: 'mailto:notifications@wingslab.local',
    });
    process.env.WINGSLAB_WEB_PUSH_RETRY_JOB_ENABLED = 'true';
    expect(validateJobSelection({ notificationRetry: true }).notificationRetry).toBe(true);
    expect(() => validateJobSelection({ orderTimeout: true })).toThrow();
  } finally {
    for (const [key, value] of Object.entries({
      WINGSLAB_WEB_PUSH_ENABLED: previous.enabled, WINGSLAB_CONFIGURED: previous.configured,
      WINGSLAB_RUNTIME_AUTHORIZED: previous.authorized, WINGSLAB_NETWORK_ATTESTED: previous.attested,
      WINGSLAB_WEB_PUSH_PUBLIC_KEY: previous.publicKey, WINGSLAB_WEB_PUSH_PRIVATE_KEY: previous.privateKey,
      WINGSLAB_WEB_PUSH_CONTACT: previous.contact,
      WINGSLAB_WEB_PUSH_RETRY_JOB_ENABLED: previous.retryEnabled,
    })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
