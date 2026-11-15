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
