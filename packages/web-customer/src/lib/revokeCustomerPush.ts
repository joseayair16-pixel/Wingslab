import { clearStoredPushEndpoint, readStoredPushEndpoint, revokeDevicePush } from '@sadel/shared';
import { clearNativeFcmToken, readNativeFcmToken } from './native';
import { clearSubscriptionSecrets } from './subscriptionSecrets';

export async function revokeCustomerPush() {
  const key = 'sadel.customer';
  const jwt = localStorage.getItem(`${key}.token`);
  const endpoint = readStoredPushEndpoint(key);
  const fcmToken = readNativeFcmToken();
  clearStoredPushEndpoint(key);
  clearNativeFcmToken();
  await clearSubscriptionSecrets();
  await revokeDevicePush({ apiBase: '/api', jwt, endpoint, fcmToken, timeoutMs: 3500 });
}
