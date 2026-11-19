import { NextResponse } from 'next/server';
import { getLocalFirebasePhoneTestNumber } from '../../lib/firebase-phone-auth-mode';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export function GET(request: Request) {
  const firebase = {
    apiKey: process.env.WINGSLAB_FIREBASE_WEB_API_KEY?.trim(),
    authDomain: process.env.WINGSLAB_FIREBASE_WEB_AUTH_DOMAIN?.trim(),
    projectId: process.env.WINGSLAB_FIREBASE_WEB_PROJECT_ID?.trim(),
    appId: process.env.WINGSLAB_FIREBASE_WEB_APP_ID?.trim(),
  };
  if (Object.values(firebase).some((value) => !value)) {
    return NextResponse.json(
      { error: 'FIREBASE_PHONE_AUTH_NOT_CONFIGURED' },
      { status: 503, headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  }

  const testPhoneNumber = getLocalFirebasePhoneTestNumber(process.env, request.headers.get('host'));

  return NextResponse.json({
    ...firebase,
    appVerificationDisabledForTesting: testPhoneNumber !== null,
    testPhoneNumber,
  }, {
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      Vary: 'Host',
    },
  });
}
