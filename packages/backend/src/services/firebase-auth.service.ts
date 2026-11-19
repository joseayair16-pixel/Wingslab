import type { DecodedIdToken } from 'firebase-admin/auth';
import { getBackendConfiguration } from '../config/env';

const FIREBASE_AUTH_APP_NAME = 'wingslab-phone-auth';
const INVALID_FIREBASE_TOKEN_CODES = new Set([
  'auth/argument-error',
  'auth/id-token-expired',
  'auth/id-token-revoked',
  'auth/invalid-id-token',
  'auth/user-disabled',
  'auth/user-not-found',
]);

export type VerifiedFirebasePhone = {
  uid: string;
  phoneNumber: string;
  authTime: number;
  expiresAt: number;
};

export class FirebaseAuthNotConfiguredError extends Error {
  constructor() {
    super('Firebase phone authentication is not configured.');
    this.name = 'FirebaseAuthNotConfiguredError';
  }
}

export function isFirebaseAuthConfigured(): boolean {
  try {
    return Boolean(getBackendConfiguration().firebaseAuth);
  } catch {
    return false;
  }
}

async function getFirebaseAdminAuth() {
  const credentials = getBackendConfiguration().firebaseAuth;
  if (!credentials) throw new FirebaseAuthNotConfiguredError();

  // Load the Admin SDK lazily so routes/tests that do not exercise Firebase
  // Auth do not eagerly load its ESM-only JOSE dependency through Jest CJS.
  const [{ cert, getApps, initializeApp }, { getAuth }] = await Promise.all([
    import('firebase-admin/app'),
    import('firebase-admin/auth'),
  ]);
  const app = getApps().find((candidate) => candidate.name === FIREBASE_AUTH_APP_NAME) ?? initializeApp({
    credential: cert({
      projectId: credentials.projectId,
      clientEmail: credentials.clientEmail,
      privateKey: credentials.privateKey,
    }),
    projectId: credentials.projectId,
  }, FIREBASE_AUTH_APP_NAME);

  return getAuth(app);
}

/** Verifies signature, issuer, audience, expiry, and Firebase revocation status. */
export async function verifyFirebasePhoneToken(idToken: string): Promise<VerifiedFirebasePhone | null> {
  let decoded: DecodedIdToken;
  try {
    decoded = await (await getFirebaseAdminAuth()).verifyIdToken(idToken, true);
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';
    if (INVALID_FIREBASE_TOKEN_CODES.has(code)) return null;
    throw error;
  }
  const phoneNumber = decoded.phone_number;
  if (
    typeof decoded.sub !== 'string' ||
    typeof phoneNumber !== 'string' ||
    decoded.firebase?.sign_in_provider !== 'phone' ||
    typeof decoded.auth_time !== 'number' ||
    typeof decoded.exp !== 'number'
  ) {
    return null;
  }

  return {
    uid: decoded.sub,
    phoneNumber,
    authTime: decoded.auth_time,
    expiresAt: decoded.exp,
  };
}
