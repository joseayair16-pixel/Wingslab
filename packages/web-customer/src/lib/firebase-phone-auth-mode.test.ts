import { getLocalFirebasePhoneTestNumber } from './firebase-phone-auth-mode';

const localRuntime = {
  NODE_ENV: 'production',
  WINGSLAB_ENVIRONMENT: 'local',
  WINGSLAB_RUNTIME_AUTHORIZED: 'reviewed-phase-2b',
  WINGSLAB_PROFILE: 'container',
  WINGSLAB_FIREBASE_PHONE_AUTH_TEST_MODE: 'true',
  WINGSLAB_FIREBASE_TEST_PHONE_NUMBER: '+524591153960',
};

test('allows only the explicit fictional number on the authorized local loopback runtime', () => {
  expect(getLocalFirebasePhoneTestNumber(localRuntime, 'localhost:3103')).toBe('+524591153960');
});

test.each([
  ['production environment', { ...localRuntime, WINGSLAB_ENVIRONMENT: 'production' }, 'localhost:3103'],
  ['missing local runtime authorization', { ...localRuntime, WINGSLAB_RUNTIME_AUTHORIZED: '' }, 'localhost:3103'],
  ['test opt-in disabled', { ...localRuntime, WINGSLAB_FIREBASE_PHONE_AUTH_TEST_MODE: 'false' }, 'localhost:3103'],
  ['public host', localRuntime, 'customer.wingslab.example'],
  ['malformed test number', { ...localRuntime, WINGSLAB_FIREBASE_TEST_PHONE_NUMBER: '+15245551111' }, 'localhost:3103'],
])('denies test-mode activation for %s', (_description, env, host) => {
  expect(getLocalFirebasePhoneTestNumber(env, host)).toBeNull();
});
