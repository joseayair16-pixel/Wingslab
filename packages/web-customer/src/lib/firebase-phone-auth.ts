'use client';

import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  inMemoryPersistence,
  RecaptchaVerifier,
  setPersistence,
  signInWithPhoneNumber,
  signOut,
  type Auth,
  type ConfirmationResult,
} from 'firebase/auth';

const FIREBASE_APP_NAME = 'wingslab-customer-phone-auth';

let authInstance: Auth | null = null;
let authConfigPromise: Promise<{ auth: Auth; testPhoneNumber: string | null }> | null = null;
let confirmationResult: ConfirmationResult | null = null;
let recaptchaVerifier: RecaptchaVerifier | null = null;

async function getFirebaseAuth(): Promise<{ auth: Auth; testPhoneNumber: string | null }> {
  if (typeof window === 'undefined') throw new Error('La verificación SMS solo está disponible en el navegador.');
  if (authInstance && authConfigPromise) return authConfigPromise;

  if (!authConfigPromise) {
    authConfigPromise = (async () => {
      const response = await fetch('/wingslab-firebase-config', { cache: 'no-store' });
      if (!response.ok) throw new Error('La verificación SMS todavía no está configurada para WingsLab.');
      const payload = await response.json() as {
        apiKey?: string;
        authDomain?: string;
        projectId?: string;
        appId?: string;
        appVerificationDisabledForTesting?: boolean;
        testPhoneNumber?: string | null;
      };
      const config = {
        apiKey: payload.apiKey,
        authDomain: payload.authDomain,
        projectId: payload.projectId,
        appId: payload.appId,
      };
      if (Object.values(config).some((value) => typeof value !== 'string' || !value.trim())) {
        throw new Error('La configuración Firebase de WingsLab está incompleta.');
      }
      const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
      const testPhoneNumber = payload.appVerificationDisabledForTesting && localHost
        ? payload.testPhoneNumber || null
        : null;
      if (payload.appVerificationDisabledForTesting && !testPhoneNumber) {
        throw new Error('El modo de prueba Firebase no tiene un teléfono ficticio permitido.');
      }

       const existingApp = getApps().find((candidate) => candidate.name === FIREBASE_APP_NAME);
       if (existingApp && (
         existingApp.options.apiKey !== config.apiKey ||
         existingApp.options.authDomain !== config.authDomain ||
         existingApp.options.projectId !== config.projectId ||
         existingApp.options.appId !== config.appId
       )) {
         throw new Error('La aplicación Firebase ya está inicializada con otro proyecto. Recarga la página.');
       }
       const app = existingApp ?? initializeApp(config, FIREBASE_APP_NAME);
       authInstance = getAuth(app);
       // Firebase requires this setting before RecaptchaVerifier is constructed.
       authInstance.settings.appVerificationDisabledForTesting = Boolean(testPhoneNumber);
      return { auth: authInstance, testPhoneNumber };
    })().catch((error: unknown) => {
      authConfigPromise = null;
      throw error;
    });
  }
  return authConfigPromise;
}

export async function sendFirebaseSmsCode(phoneNumber: string, recaptchaContainerId: string): Promise<void> {
  const { auth, testPhoneNumber } = await getFirebaseAuth();
  const normalizedPhone = phoneNumber.replace(/[^+\d]/g, '');
  if (testPhoneNumber && normalizedPhone !== testPhoneNumber) {
    throw new Error('El modo local solo permite el teléfono ficticio configurado en Firebase.');
  }
  await setPersistence(auth, inMemoryPersistence);
  if (auth.currentUser) await signOut(auth);
  recaptchaVerifier?.clear();
  confirmationResult = null;

  const verifier = new RecaptchaVerifier(auth, recaptchaContainerId, { size: 'invisible' });
  recaptchaVerifier = verifier;
  try {
    confirmationResult = await signInWithPhoneNumber(auth, normalizedPhone, verifier);
  } catch (error) {
    verifier.clear();
    recaptchaVerifier = null;
    throw error;
  }
}

export async function confirmFirebaseSmsCode(code: string): Promise<string> {
  if (!confirmationResult) throw new Error('La solicitud SMS venció. Solicita un código nuevo.');
  const credential = await confirmationResult.confirm(code);
  return credential.user.getIdToken(true);
}

export async function clearFirebasePhoneVerification(): Promise<void> {
  recaptchaVerifier?.clear();
  recaptchaVerifier = null;
  confirmationResult = null;
  if (!authInstance?.currentUser) return;
  try {
    await signOut(authInstance);
  } catch {
    // El token de Firebase ya se intercambió por un permiso temporal de WingsLab.
  }
}

export function firebasePhoneAuthErrorMessage(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : '';

  switch (code) {
    case 'auth/invalid-phone-number':
      return 'El número de teléfono no es válido.';
    case 'auth/too-many-requests':
      return 'Se alcanzó el límite de intentos. Intenta más tarde.';
    case 'auth/quota-exceeded':
      return 'Se alcanzó el límite de SMS del proyecto. Intenta más tarde.';
    case 'auth/captcha-check-failed':
    case 'auth/missing-app-credential':
      return 'No se pudo validar el navegador. Recarga la página e inténtalo de nuevo.';
    case 'auth/invalid-verification-code':
      return 'El código SMS es incorrecto.';
    case 'auth/code-expired':
      return 'El código venció. Solicita uno nuevo.';
    default:
      return error instanceof Error ? error.message : 'No se pudo completar la verificación por SMS.';
  }
}
