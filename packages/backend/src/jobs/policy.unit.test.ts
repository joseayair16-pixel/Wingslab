import { JOB_GROUPS, validateJobSelection, startSelectedJobs, JobStarters } from './policy';

test('all groups are preserved and every job is disabled', () => {
  expect(Object.keys(JOB_GROUPS)).toHaveLength(5);
  expect(Object.values(validateJobSelection()).every(value => value === false)).toBe(true);
});
test('requesting any job fails before invoking a starter', () => {
  const start = jest.fn();
  const starters = Object.fromEntries(Object.values(JOB_GROUPS).flat().map(name => [name, start])) as unknown as JobStarters;
  expect(() => startSelectedJobs({ orderTimeout: true }, starters)).toThrow();
  expect(start).not.toHaveBeenCalled();
});
