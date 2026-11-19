type FirebasePhoneAuthEnvironment = Record<string, string | undefined>;

function isLoopbackHost(hostHeader: string | null): boolean {
  if (!hostHeader) return false;
  try {
    const hostname = new URL(`http://${hostHeader}`).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

/**
 * Local Firebase test phones are enabled only by the authorized local runtime,
 * an explicit config opt-in, and a loopback Host header. NODE_ENV is
 * intentionally not used: the isolated local Docker runtime runs optimized
 * Next.js with NODE_ENV=production while WINGSLAB_ENVIRONMENT remains local.
 */
export function getLocalFirebasePhoneTestNumber(
  env: FirebasePhoneAuthEnvironment,
  hostHeader: string | null,
): string | null {
  const phoneNumber = env.WINGSLAB_FIREBASE_TEST_PHONE_NUMBER?.trim() || '';
  const enabled = env.WINGSLAB_ENVIRONMENT === 'local' &&
    env.WINGSLAB_RUNTIME_AUTHORIZED === 'reviewed-phase-2b' &&
    env.WINGSLAB_PROFILE === 'container' &&
    env.WINGSLAB_FIREBASE_PHONE_AUTH_TEST_MODE === 'true' &&
    isLoopbackHost(hostHeader) &&
    /^\+52\d{10}$/.test(phoneNumber);

  return enabled ? phoneNumber : null;
}
