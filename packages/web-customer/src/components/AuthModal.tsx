import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Check, ChevronRight, Clock3, Crown, LockKeyhole, Loader2, Mail, Phone, RefreshCw, UserRound, X } from 'lucide-react';
import Image from 'next/image';
import {
  ApiResponse,
  AuthResponse,
  AuthUser,
  persistStoredSession,
  requestJson,
} from '@sadel/shared';
import {
  clearFirebasePhoneVerification,
  confirmFirebaseSmsCode,
  firebasePhoneAuthErrorMessage,
  sendFirebaseSmsCode,
} from '../lib/firebase-phone-auth';
import officialLogo from '../assets/wingslab-wordmark.png';

type AuthMode = 'login' | 'register' | 'recovery';
type AuthStep = 'welcome' | 'details' | 'contact' | 'request' | 'verify' | 'create-password' | 'new-password';
interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (token: string, user: AuthUser) => void;
  apiBase: string;
}

export const AuthModal = memo(function AuthModal({ isOpen, onClose, onSuccess, apiBase }: AuthModalProps) {
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [authStep, setAuthStep] = useState<AuthStep>('welcome');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dobDay, setDobDay] = useState(() => getLatestAllowedBirthDate().day);
  const [dobMonth, setDobMonth] = useState(() => getLatestAllowedBirthDate().month);
  const [dobYear, setDobYear] = useState(() => getLatestAllowedBirthDate().year);
  const [password, setPassword] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [registerToken, setRegisterToken] = useState('');
  const [smsVerificationToken, setSmsVerificationToken] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const firebaseIdTokenRef = useRef('');
  const [countdown, setCountdown] = useState(0);
  const [verificationSuccessNextStep, setVerificationSuccessNextStep] = useState<'create-password' | 'new-password' | null>(null);
  
  const [startingVerification, setStartingVerification] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [error, setError] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  // Countdown for the short-lived Firebase SMS code.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (authStep === 'verify' && countdown > 0) {
      timer = setTimeout(() => setCountdown(prev => prev - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [authStep, countdown]);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (!isOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) void clearFirebasePhoneVerification();
  }, [isOpen]);

  // Reset state when opening/closing
  useEffect(() => {
    if (isOpen) {
      setAuthMode('login');
      setAuthStep('welcome');
      setPhone('');
      setEmail('');
      setName('');
      setLastName('');
      const latestAllowedBirthDate = getLatestAllowedBirthDate();
      setDobDay(latestAllowedBirthDate.day);
      setDobMonth(latestAllowedBirthDate.month);
      setDobYear(latestAllowedBirthDate.year);
      setPassword('');
      setResetToken('');
      setRegisterToken('');
      setSmsVerificationToken('');
      firebaseIdTokenRef.current = '';
      setOtpCode('');
      setCountdown(0);
      setVerificationSuccessNextStep(null);
      setError('');
      setAuthMessage('');
      void clearFirebasePhoneVerification();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !verificationSuccessNextStep) return;

    const nextStep = verificationSuccessNextStep;
    const timer = setTimeout(() => {
      setAuthStep(nextStep);
      setVerificationSuccessNextStep(null);
    }, 1000);

    return () => clearTimeout(timer);
  }, [verificationSuccessNextStep, isOpen]);

  const handleDobChange = useCallback((next: { day?: number; month?: number; year?: number }) => {
    const latestAllowed = getLatestAllowedBirthDate();
    const year = clamp(next.year ?? dobYear, 1950, latestAllowed.year);
    const month = clamp(next.month ?? dobMonth, 1, 12);
    if (next.month !== undefined) setDobMonth(month);
    if (next.year !== undefined) setDobYear(year);
    setDobDay((currentDay) => Math.min(clamp(next.day ?? currentDay, 1, 31), daysInMonth(year, month)));
  }, [dobMonth, dobYear]);

  function handlePhoneChange(value: string) {
    const nextPhone = value.replace(/\D/g, '').slice(-10);
    setPhone(nextPhone);
    setError('');
    setAuthMessage('');

    if (authStep === 'verify') {
      setSmsVerificationToken('');
      firebaseIdTokenRef.current = '';
      void clearFirebasePhoneVerification();
      setOtpCode('');
      setCountdown(0);
      setAuthStep(authMode === 'register' ? 'contact' : 'request');
    }
  }

  async function loginWithPassword() {
    setVerifyingCode(true);
    setError('');
    setAuthMessage('');

    try {
      const payload = await requestJson<AuthResponse>({
        apiBase,
        path: '/auth/login',
        options: {
          method: 'POST',
          body: JSON.stringify({
            phone: phone.trim(),
            password: password.trim(),
          }),
        },
        fallbackMessage: 'No se pudo iniciar sesión.',
      });

      if (payload.data.user.role !== 'CUSTOMER') {
        throw new Error('La cuenta autenticada no pertenece a un cliente.');
      }

      persistStoredSession({
        storageKey: 'sadel.customer',
        apiBase,
        token: payload.data.token,
        refreshToken: payload.data.refreshToken,
        user: payload.data.user,
      });

      onSuccess(payload.data.token, payload.data.user);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Teléfono o contraseña incorrectos.');
    } finally {
      setVerifyingCode(false);
    }
  }

  async function startSmsVerification() {
    setStartingVerification(true);
    setError('');
    setAuthMessage('');
    setSmsVerificationToken('');
    firebaseIdTokenRef.current = '';
    setOtpCode('');
    setCountdown(0);

    try {
      if (phone.length !== 10) throw new Error('Ingresa un teléfono de 10 dígitos.');
      if (authMode === 'register') {
        if (!isValidEmail(email)) throw new Error('Ingresa un correo electrónico válido.');
        if (!name.trim() || !lastName.trim()) throw new Error('Completa tu nombre y apellidos.');
        if (!isEligibleBirthDate(dobDay, dobMonth, dobYear)) {
          throw new Error('Para crear una cuenta necesitas tener al menos 12 años.');
        }
      }

      await clearFirebasePhoneVerification();
      const payload = await requestJson<ApiResponse<{ verificationToken: string; expiresInSeconds: number }>>({
        apiBase,
        path: '/auth/sms-otp/iniciar',
        options: {
          method: 'POST',
          body: JSON.stringify({
            phone: phone.trim(),
            intent: authMode === 'recovery' ? 'recovery' : 'register',
            ...(authMode === 'register'
              ? {
                  email: email.trim(),
                  name: name.trim(),
                  lastName: lastName.trim(),
                  dateOfBirth: `${dobYear}-${String(dobMonth).padStart(2, '0')}-${String(dobDay).padStart(2, '0')}`,
                }
              : {}),
          }),
        },
        fallbackMessage: 'No se pudo iniciar la verificación por SMS.',
      });
      if (!payload.data?.verificationToken) throw new Error('No se pudo preparar la verificación por SMS.');

      await sendFirebaseSmsCode(`+52${phone.trim()}`, 'firebase-recaptcha-container');
      setSmsVerificationToken(payload.data.verificationToken);
      setCountdown(payload.data.expiresInSeconds);
      setAuthMessage(`Enviamos un código SMS al ${formatPhoneNumber(phone)}.`);
      setAuthStep('verify');
    } catch (requestError) {
      setAuthStep(authMode === 'register' ? 'contact' : 'request');
      setError(firebasePhoneAuthErrorMessage(requestError));
    } finally {
      setStartingVerification(false);
    }
  }

  async function verifySmsCode() {
    setVerifyingCode(true);
    setError('');
    setAuthMessage('');

    try {
      if (!smsVerificationToken) throw new Error('La solicitud SMS venció. Solicita un código nuevo.');
      if (!firebaseIdTokenRef.current) {
        firebaseIdTokenRef.current = await confirmFirebaseSmsCode(otpCode.trim());
      }
      const payload = await requestJson<ApiResponse<{ registerToken?: string; resetToken?: string }>>({
        apiBase,
        path: '/auth/sms-otp/confirmar',
        options: {
          method: 'POST',
          body: JSON.stringify({
            verificationToken: smsVerificationToken,
            firebaseIdToken: firebaseIdTokenRef.current,
          }),
        },
        fallbackMessage: 'No se pudo confirmar el código SMS.',
      });
      if (!payload.data) throw new Error('No se pudo completar la verificación.');

      await clearFirebasePhoneVerification();
      firebaseIdTokenRef.current = '';
      setSmsVerificationToken('');
      setCountdown(0);
      if (authMode === 'recovery' && payload.data.resetToken) {
        setResetToken(payload.data.resetToken);
        setVerificationSuccessNextStep('new-password');
        return;
      }
      if (payload.data.registerToken) {
        setRegisterToken(payload.data.registerToken);
        setVerificationSuccessNextStep('create-password');
        return;
      }
      throw new Error('No se pudo completar la verificación.');
    } catch (requestError) {
      setError(firebasePhoneAuthErrorMessage(requestError));
    } finally {
      setVerifyingCode(false);
    }
  }

  async function completeRegistration() {
    setVerifyingCode(true);
    setError('');
    setAuthMessage('');

    try {
      const payload = await requestJson<AuthResponse>({
        apiBase,
        path: '/auth/complete-register',
        token: registerToken,
        options: {
          method: 'POST',
          body: JSON.stringify({ password: password.trim() }),
        },
        fallbackMessage: 'No se pudo crear la cuenta.',
      });

      if (payload.data.user.role !== 'CUSTOMER') {
        throw new Error('La cuenta autenticada no pertenece a un cliente.');
      }

      persistStoredSession({
        storageKey: 'sadel.customer',
        apiBase,
        token: payload.data.token,
        refreshToken: payload.data.refreshToken,
        user: payload.data.user,
      });

      onSuccess(payload.data.token, payload.data.user);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo crear la cuenta.');
    } finally {
      setVerifyingCode(false);
    }
  }

  async function handleResetPassword() {
    setVerifyingCode(true);
    setError('');
    setAuthMessage('');

    try {
      await requestJson<ApiResponse<{ message: string }>>({
        apiBase,
        path: '/auth/reset-password',
        token: resetToken,
        options: {
          method: 'POST',
          body: JSON.stringify({
            newPassword: password.trim(),
          }),
        },
        fallbackMessage: 'No se pudo restablecer la contraseña.',
      });

      setAuthMessage('Contraseña actualizada correctamente. Inicia sesión.');
      setAuthMode('login');
      setPassword('');
      setResetToken('');
      setAuthStep('request');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo restablecer la contraseña.');
    } finally {
      setVerifyingCode(false);
    }
  }

  if (!isOpen) return null;

  const modeCopy = verificationSuccessNextStep
    ? {
      title: 'Teléfono verificado',
      subtitle: verificationSuccessNextStep === 'new-password'
        ? 'Ahora puedes crear una contraseña nueva.'
        : 'Ahora crea una contraseña para tu cuenta.',
      cta: 'Continuar',
      submit: 'Continuar',
    }
    : authMode === 'register'
    ? {
      title:
        authStep === 'details'
          ? 'Crear cuenta'
          : authStep === 'contact'
          ? 'Datos de contacto'
          : authStep === 'verify'
          ? 'Verifica tu teléfono'
          : 'Define tu contraseña',
      subtitle:
        authStep === 'details'
          ? 'Cuéntanos quién eres para empezar.'
          : authStep === 'contact'
            ? 'Te enviaremos un código por SMS para verificar tu teléfono.'
            : authStep === 'verify'
              ? 'Ingresa el código de 6 dígitos que enviamos por SMS.'
              : 'La usarás para iniciar sesión en WingsLab.',
      cta: startingVerification ? 'Enviando código...' : 'Continuar',
      submit: verifyingCode ? 'Creando cuenta...' : 'Crear cuenta',
    }
    : authMode === 'recovery'
    ? {
      title: authStep === 'verify'
        ? 'Verifica tu teléfono'
        : authStep === 'new-password' ? 'Define tu nueva contraseña' : 'Recuperar contraseña',
      subtitle: authStep === 'request'
        ? 'Te enviaremos un código por SMS para verificar que tienes acceso a este teléfono.'
        : authStep === 'verify'
          ? 'Ingresa el código de 6 dígitos que enviamos por SMS.'
          : 'La usarás para iniciar sesión en WingsLab.',
      cta: startingVerification ? 'Enviando código...' : 'Continuar',
      submit: verifyingCode ? 'Verificando...' : 'Confirmar contraseña',
    }
    : {
      title: 'Iniciar sesión',
      subtitle: 'Ingresa tu teléfono y contraseña.',
      cta: 'Iniciar sesión',
      submit: verifyingCode ? 'Ingresando...' : 'Entrar',
    };

  function goBack() {
    setError('');
    setAuthMessage('');
    if (authMode === 'register') {
      if (authStep === 'create-password') setAuthStep('verify');
      else if (authStep === 'verify') setAuthStep('contact');
      else if (authStep === 'contact') setAuthStep('details');
      else setAuthStep('welcome');
    } else if (authMode === 'recovery') {
      if (authStep === 'verify') setAuthStep('request');
      else setAuthStep('welcome');
    } else {
      setAuthStep('welcome');
    }
  }

  return (
    <div className="wl-auth fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-[fadeIn_0.2s_ease-out]" role="dialog" aria-modal="true" aria-label="Acceso a tu cuenta WingsLab">
      <div className="wl-auth-sheet relative w-full max-w-md overflow-hidden rounded-[24px] bg-white p-6 shadow-[0_32px_64px_-12px_rgba(0,0,0,0.14)] border border-black/[0.04] flex flex-col max-h-[90dvh] max-sm:max-h-[92dvh] max-sm:rounded-t-[32px] max-sm:rounded-b-none pb-[calc(1.5rem+env(safe-area-inset-bottom))] animate-[scaleUp_0.25s_cubic-bezier(0.16,1,0.3,1)] max-sm:animate-[slideUp_0.3s_cubic-bezier(0.16,1,0.3,1)]">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-5 top-5 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 hover:bg-neutral-200 text-neutral-600 transition active:scale-95"
          aria-label="Cerrar modal de autenticación"
        >
          <X className="h-5 w-5" strokeWidth={2.5} />
        </button>

        {/* Content Container */}
        <div className="wl-auth-scroll overflow-y-auto overflow-x-hidden flex-1 scrollbar-thin">
          <div className="wl-auth-brand">
            <Image src={officialLogo} alt="WingsLab" width={783} height={229} priority />
          </div>

          <div className="wl-auth-body">
            {authStep === 'welcome' ? (
              <div className="text-center">
                <h3 className="text-2xl font-bold tracking-[-0.03em] text-neutral-900">Bienvenido a WingsLab</h3>
                <p className="mt-2 text-sm text-neutral-500 leading-relaxed">
                  Inicia sesión o crea tu cuenta para disfrutar de WingsLab.
                </p>

                <div className="mt-8 grid gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('login');
                      setAuthStep('request');
                    }}
                    className="w-full rounded-2xl bg-[#0a0a0a] py-3.5 text-sm font-semibold text-[#ffffff] transition-all duration-200 hover:bg-[#262626] hover:shadow-[0_8px_24px_rgba(10,10,10,0.12)] active:scale-[0.98]"
                  >
                    Iniciar sesión
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('register');
                      setAuthStep('details');
                    }}
                    className="w-full rounded-2xl border border-black/[0.08] bg-white py-3.5 text-sm font-semibold text-[#171717] transition-all duration-200 hover:bg-neutral-50 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] active:scale-[0.98] shadow-sm"
                  >
                    Crear cuenta
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="wl-auth-intro mb-6">
                  <h3 className="text-2xl font-bold tracking-[-0.03em] text-neutral-950">{modeCopy.title}</h3>
                  <p className="text-sm text-neutral-500 mt-1.5">{modeCopy.subtitle}</p>
                </div>

                <div className="grid gap-4">
                  {verificationSuccessNextStep ? (
                    <VerificationSuccess
                      nextStep={verificationSuccessNextStep}
                    />
                  ) : authMode === 'login' ? (
                    <>
                      <Field
                        label="Teléfono (10 dígitos)"
                        value={phone}
                        onChange={handlePhoneChange}
                        placeholder="Ingresa tu celular"
                        mask={formatPhoneNumber}
                      />
                      <PhoneHint phone={phone} />
                      <Field
                        label="Contraseña"
                        value={password}
                        onChange={setPassword}
                        placeholder="Ingresa tu contraseña"
                        type="password"
                        autoComplete="current-password"
                      />
                      
                      <button
                        type="button"
                        onClick={loginWithPassword}
                        disabled={verifyingCode || phone.length !== 10 || !password.trim()}
                        className="mt-3 w-full rounded-2xl bg-[#0a0a0a] py-3.5 text-sm font-semibold text-[#ffffff] transition-all duration-200 hover:bg-[#262626] hover:shadow-[0_8px_24px_rgba(10,10,10,0.12)] disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 disabled:shadow-none active:scale-[0.98]"
                      >
                        {verifyingCode ? 'Ingresando...' : 'Iniciar sesión'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAuthMode('recovery');
                          setAuthStep('request');
                        }}
                        className="mx-auto w-max border-b border-neutral-400 pb-0.5 text-center text-xs font-medium text-neutral-600 transition hover:border-neutral-900 hover:text-neutral-900"
                      >
                        Olvidé mi contraseña
                      </button>
                    </>
                  ) : authMode === 'recovery' ? (
                    <>
                      {authStep === 'request' ? (
                        <>
                          <Field
                            label="Teléfono (10 dígitos)"
                            value={phone}
                            onChange={handlePhoneChange}
                            placeholder="Ingresa tu celular"
                            mask={formatPhoneNumber}
                          />
                          <PhoneHint phone={phone} />
                          <div className="grid gap-3 pt-1">
                            <button
                              type="button"
                              onClick={startSmsVerification}
                              disabled={startingVerification || phone.length !== 10}
                              className="inline-flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-2xl bg-neutral-950 px-4 py-3 text-sm font-semibold text-white shadow-[0_6px_18px_rgba(10,10,10,0.14)] transition-all duration-200 hover:bg-neutral-800 hover:shadow-[0_8px_22px_rgba(10,10,10,0.2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 disabled:shadow-none"
                            >
                              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/10">
                                <Phone className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
                              </span>
                              {startingVerification ? 'Enviando código...' : 'Enviar código por SMS'}
                            </button>
                          </div>
                        </>
                      ) : authStep === 'verify' ? (
                        <SmsOtpPanel
                            phone={phone}
                            code={otpCode}
                            countdown={countdown}
                            starting={startingVerification}
                            verifying={verifyingCode}
                            onCodeChange={(value) => setOtpCode(value.replace(/\D/g, '').slice(0, 6))}
                            onRetry={startSmsVerification}
                            onVerify={verifySmsCode}
                          />
                      ) : (
                        <PasswordSetupForm
                          password={password}
                          onPasswordChange={setPassword}
                          submitting={verifyingCode}
                          submitLabel="Guardar contraseña"
                          submittingLabel="Guardando contraseña…"
                          onSubmit={handleResetPassword}
                        />
                      )}
                    </>
                  ) : (
                    <>
                      {authStep === 'details' ? (
                        <div className="space-y-4">
                          <Field
                            label="Nombre(s)"
                            value={name}
                            onChange={setName}
                            placeholder="Escribe tu nombre"
                          />
                          <Field
                            label="Apellidos"
                            value={lastName}
                            onChange={setLastName}
                            placeholder="Escribe tus apellidos"
                          />
                          <WheelDatePicker
                            day={dobDay}
                            month={dobMonth}
                            year={dobYear}
                            onChange={handleDobChange}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setAuthStep('contact');
                              setError('');
                            }}
                            disabled={!name.trim() || !lastName.trim() || !isEligibleBirthDate(dobDay, dobMonth, dobYear)}
                            className="mt-3 w-full rounded-2xl bg-[#0a0a0a] py-3.5 text-sm font-semibold text-[#ffffff] transition-all duration-200 hover:bg-[#262626] hover:shadow-[0_8px_24px_rgba(10,10,10,0.12)] disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 disabled:shadow-none active:scale-[0.98]"
                          >
                            Continuar
                          </button>
                        </div>
                      ) : authStep === 'contact' ? (
                        <div className="space-y-4">
                          <Field
                            label="Correo electrónico"
                            value={email}
                            onChange={(value) => { setEmail(value); setError(''); }}
                            placeholder="tucorreo@ejemplo.com"
                            type="email"
                            autoComplete="email"
                          />
                          <Field
                            label="Teléfono (10 dígitos)"
                            value={phone}
                            onChange={handlePhoneChange}
                            placeholder="Ingresa tu celular"
                            mask={formatPhoneNumber}
                          />
                          <PhoneHint phone={phone} />
                          <div className="grid gap-3 pt-1">
                            <button
                              type="button"
                              onClick={startSmsVerification}
                              disabled={startingVerification || !isValidEmail(email) || phone.length !== 10}
                              className="inline-flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-2xl bg-neutral-950 px-4 py-3 text-sm font-semibold text-white shadow-[0_6px_18px_rgba(10,10,10,0.14)] transition-all duration-200 hover:bg-neutral-800 hover:shadow-[0_8px_22px_rgba(10,10,10,0.2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 disabled:shadow-none"
                            >
                              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/10">
                                <Phone className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
                              </span>
                              {startingVerification ? 'Enviando código...' : 'Enviar código por SMS'}
                            </button>
                          </div>
                        </div>
                      ) : authStep === 'create-password' ? (
                        <PasswordSetupForm
                          password={password}
                          onPasswordChange={setPassword}
                          submitting={verifyingCode}
                          submitLabel="Crear cuenta"
                          submittingLabel="Creando cuenta…"
                          onSubmit={completeRegistration}
                        />
                      ) : (
                        <SmsOtpPanel
                            phone={phone}
                            code={otpCode}
                            countdown={countdown}
                            starting={startingVerification}
                            verifying={verifyingCode}
                            onCodeChange={(value) => setOtpCode(value.replace(/\D/g, '').slice(0, 6))}
                            onRetry={startSmsVerification}
                            onVerify={verifySmsCode}
                          />
                      )}
                    </>
                  )}

                  {!verificationSuccessNextStep && (authMode === 'login' || (authMode === 'register' && authStep === 'details')) && (
                    <button type="button" className="wl-auth-switch" onClick={() => { setError(''); setAuthMessage(''); setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthStep(authMode === 'login' ? 'details' : 'request'); }}>
                      {authMode === 'login' ? <Crown aria-hidden="true" /> : <UserRound aria-hidden="true" />}
                      <span><strong>{authMode === 'login' ? '¿Aún no tienes cuenta?' : '¿Ya tienes cuenta?'}</strong><small>{authMode === 'login' ? 'Regístrate para comenzar.' : 'Inicia sesión para continuar.'}</small></span><ChevronRight aria-hidden="true" />
                    </button>
                  )}
                  {!verificationSuccessNextStep && !(authMode === 'login' || (authMode === 'register' && authStep === 'details')) && (
                    <button
                      type="button"
                      onClick={goBack}
                      className="mt-2 text-center text-xs font-semibold text-neutral-400 hover:text-neutral-900 transition-colors duration-200"
                    >
                      ← Atrás
                    </button>
                  )}

                  {error && <Callout tone="danger">{error}</Callout>}
                  {authMessage && !error && <Callout tone="success">{authMessage}</Callout>}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <div id="firebase-recaptcha-container" className="absolute bottom-0 left-0" />
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scaleUp {
          from { transform: scale(0.95); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        @keyframes slideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        @keyframes verificationPop {
          0% { opacity: 0; transform: scale(0.72); }
          72% { opacity: 1; transform: scale(1.08); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes verificationRipple {
          0% { opacity: 0.55; transform: scale(0.82); }
          100% { opacity: 0; transform: scale(1.38); }
        }
        @keyframes verificationCheckDraw {
          to { stroke-dashoffset: 0; }
        }
        .verification-success-badge {
          animation: verificationPop 520ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
        }
        .verification-success-badge::before {
          content: '';
          position: absolute;
          inset: -7px;
          border: 1px solid rgba(16, 185, 129, 0.28);
          border-radius: 9999px;
          animation: verificationRipple 850ms 80ms ease-out both;
        }
        .verification-success-check path {
          stroke-dasharray: 32;
          stroke-dashoffset: 32;
          animation: verificationCheckDraw 380ms 150ms ease-out forwards;
        }
        @media (prefers-reduced-motion: reduce) {
          .verification-success-badge,
          .verification-success-badge::before,
          .verification-success-check path {
            animation: none;
          }
          .verification-success-check path {
            stroke-dashoffset: 0;
          }
        }
      `}</style>
    </div>
  );
});

function formatPhoneNumber(value: string) {
  const digits = value.replace(/\D/g, '');
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6, 10)}`;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function PasswordSetupForm({
  password,
  onPasswordChange,
  submitting,
  submitLabel,
  submittingLabel,
  onSubmit,
}: {
  password: string;
  onPasswordChange: (value: string) => void;
  submitting: boolean;
  submitLabel: string;
  submittingLabel: string;
  onSubmit: () => void;
}) {
  const remainingCharacters = Math.max(0, 6 - password.trim().length);
  const meetsMinimum = remainingCharacters === 0;
  const requirementText = meetsMinimum
    ? 'Longitud mínima cumplida'
    : password.length > 0
      ? remainingCharacters === 1 ? 'Falta 1 carácter' : `Faltan ${remainingCharacters} caracteres`
      : 'Mínimo 6 caracteres';

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Field
          label="Contraseña"
          value={password}
          onChange={onPasswordChange}
          placeholder="Crea una contraseña segura"
          type="password"
          autoComplete="new-password"
        />
        <div
          role="status"
          aria-live="polite"
          className={`flex min-h-10 items-center gap-2.5 rounded-xl border px-3.5 py-2 text-xs font-medium transition-colors ${meetsMinimum
            ? 'border-emerald-200 bg-emerald-50/70 text-emerald-800'
            : 'border-neutral-200 bg-neutral-50 text-neutral-500'
            }`}
        >
          <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${meetsMinimum ? 'bg-emerald-100 text-emerald-700' : 'bg-white text-neutral-400 ring-1 ring-neutral-200'}`}>
            {meetsMinimum ? <Check className="h-3 w-3" strokeWidth={2.7} aria-hidden="true" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
          </span>
          <span>{requirementText}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting || !meetsMinimum}
        className="group inline-flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-2xl bg-neutral-950 px-5 py-3.5 text-sm font-bold text-white shadow-[0_8px_22px_rgba(10,10,10,0.16)] transition-all duration-200 hover:bg-neutral-800 hover:shadow-[0_10px_26px_rgba(10,10,10,0.2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 active:scale-[0.985] disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 disabled:shadow-none"
      >
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />}
        {submitting ? submittingLabel : submitLabel}
      </button>
    </div>
  );
}

function VerificationSuccess({ nextStep }: { nextStep: 'create-password' | 'new-password' }) {
  const nextAction = nextStep === 'new-password'
    ? 'Ya puedes crear una contraseña nueva.'
    : 'Ya puedes crear una contraseña para tu cuenta.';

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[148px] flex-col items-center justify-center gap-3 rounded-[22px] border border-emerald-100 bg-emerald-50/70 px-5 py-6 text-center"
    >
      <span className="verification-success-badge relative flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-white shadow-[0_8px_20px_rgba(16,185,129,0.24)]">
        <Check className="verification-success-check h-8 w-8" strokeWidth={2.7} aria-hidden="true" />
      </span>
      <span className="text-[13px] font-semibold text-emerald-800">Continuando…</span>
      <span className="sr-only">Teléfono verificado. {nextAction}</span>
    </div>
  );
}

function SmsOtpPanel({
  phone,
  code,
  countdown,
  starting,
  verifying,
  onCodeChange,
  onRetry,
  onVerify,
}: {
  phone: string;
  code: string;
  countdown: number;
  starting: boolean;
  verifying: boolean;
  onCodeChange: (value: string) => void;
  onRetry: () => void;
  onVerify: () => void;
}) {
  const [isCodeFocused, setIsCodeFocused] = useState(false);
  const activeDigitIndex = code.length < 6 ? code.length : -1;

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-2xl border border-red-100 bg-red-50/70 p-3.5 sm:p-4">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-red-100 bg-white text-red-700 shadow-sm">
          <Phone className="h-[18px] w-[18px]" strokeWidth={1.9} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-red-800">SMS enviado a</p>
          <p className="mt-0.5 break-all text-sm font-bold leading-5 text-neutral-950">{formatPhoneNumber(phone)}</p>
        </div>
      </div>

      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="sms-verification-code" className="text-sm font-bold text-neutral-900">Código de verificación</label>
          <span className={`shrink-0 text-xs font-semibold tabular-nums ${code.length === 6 ? 'text-emerald-700' : 'text-neutral-500'}`}>
            {code.length}/6
          </span>
        </div>

        <div className={`relative rounded-2xl transition-shadow ${isCodeFocused ? 'ring-4 ring-red-500/10' : ''}`}>
          <div aria-hidden="true" className="grid grid-cols-6 gap-2">
            {Array.from({ length: 6 }, (_, index) => {
              const digit = code[index] ?? '';
              const isActive = isCodeFocused && activeDigitIndex === index;
              const isComplete = code.length === 6;

              return (
                <div
                  key={index}
                  className={`flex h-[54px] min-w-0 items-center justify-center rounded-xl border font-mono text-[22px] font-bold tabular-nums transition-all duration-150 sm:h-14 ${isActive
                    ? 'border-red-500 bg-white text-neutral-950 shadow-[0_2px_8px_rgba(14,165,233,0.12)] ring-2 ring-red-500/15'
                    : isComplete
                      ? 'border-emerald-200 bg-emerald-50/70 text-neutral-950'
                      : digit
                        ? 'border-neutral-300 bg-white text-neutral-950 shadow-sm'
                        : 'border-neutral-200 bg-neutral-50 text-neutral-300'
                    }`}
                >
                  {digit || <span className="text-lg font-medium">·</span>}
                </div>
              );
            })}
          </div>
          <input
            id="sms-verification-code"
            name="one-time-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoCapitalize="off"
            spellCheck={false}
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            onChange={(event) => onCodeChange(event.target.value)}
            onFocus={() => setIsCodeFocused(true)}
            onBlur={() => setIsCodeFocused(false)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && code.length === 6 && !verifying) {
                event.preventDefault();
                onVerify();
              }
            }}
            disabled={verifying}
            aria-label="Código de verificación de seis dígitos"
            aria-describedby="sms-verification-hint"
            className="absolute inset-0 h-full w-full cursor-text rounded-xl opacity-0 caret-transparent disabled:cursor-wait"
          />
        </div>

        <div id="sms-verification-hint" className="flex items-center justify-end gap-2 px-0.5 text-xs">
          <span className="inline-flex shrink-0 items-center gap-1.5 text-neutral-500">
            <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
            Válido por 5 min
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 rounded-xl border border-neutral-200 bg-neutral-50 px-3.5 py-3 text-xs min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between">
        <span className="font-medium text-neutral-600">¿No llegó?</span>
        {countdown > 0 ? (
          <span className="text-neutral-500">
            Reenviar en <strong className="tabular-nums text-neutral-800">{formatCountdown(countdown)}</strong>
          </span>
        ) : (
          <button
            type="button"
            onClick={onRetry}
            disabled={starting}
            className="inline-flex min-h-9 items-center gap-1.5 self-start font-bold text-red-700 transition-colors hover:text-red-800 focus-visible:rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:text-neutral-400 min-[420px]:self-auto"
          >
            {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
            {starting ? 'Enviando…' : 'Reenviar'}
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={onVerify}
        disabled={verifying || code.length !== 6}
        className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-neutral-950 px-5 py-3.5 text-sm font-bold text-white shadow-[0_8px_20px_rgba(10,10,10,0.14)] transition-all hover:bg-neutral-800 hover:shadow-[0_10px_24px_rgba(10,10,10,0.2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 disabled:shadow-none"
      >
        {verifying ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />}
        {verifying ? 'Verificando…' : 'Verificar código'}
      </button>
    </div>
  );
}

function PhoneHint({ phone }: { phone: string }) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 0) return null;
  if (digits.length === 10) {
    return <p className="text-[11px] font-semibold text-emerald-600 px-1">Teléfono válido ✓</p>;
  }
  return (
    <p className="text-[11px] font-medium text-neutral-500 px-1">
      Te faltan {10 - digits.length} dígito{digits.length === 9 ? '' : 's'}
    </p>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  mask,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
  mask?: (value: string) => string;
  autoComplete?: string;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === 'password';

  const inputProps =
    mask
      ? { inputMode: 'numeric' as const, autoComplete: 'tel' as const }
      : type === 'email'
        ? { inputMode: 'email' as const, autoComplete: 'email' as const }
        : isPassword
          ? { autoComplete: autoComplete ?? 'current-password' }
          : {};

  return (
    <label className="wl-auth-field grid gap-1.5 text-xs text-neutral-600 font-medium">
      <span>{label}</span>
      <div className="relative">
        <span className="wl-auth-field-icon" aria-hidden="true">{isPassword ? <LockKeyhole /> : mask ? <Phone /> : type === 'email' ? <Mail /> : <UserRound />}</span>
        <input
          type={isPassword && showPassword ? 'text' : type}
          value={mask ? mask(value) : value}
          onChange={(event) => {
            const rawValue = mask ? event.target.value.replace(/\D/g, '').slice(0, 10) : event.target.value;
            onChange(rawValue);
          }}
          placeholder={placeholder}
          {...inputProps}
          className={`w-full rounded-2xl border border-black/[0.08] bg-white text-sm text-neutral-950 outline-none transition-all duration-200 placeholder:text-neutral-400 shadow-[0_1px_2px_rgba(0,0,0,0.02)] focus:border-black/20 focus:shadow-[0_4px_12px_rgba(0,0,0,0.04)] focus:ring-2 focus:ring-black/[0.04] h-12 py-3 ${isPassword ? 'px-4 pr-14' : 'px-4'} ${type === 'date' ? 'appearance-none' : ''}`}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword((current) => !current)}
            aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            className="absolute right-2 inset-y-0 my-auto flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 transition-colors duration-200 hover:bg-neutral-100 hover:text-neutral-800 active:scale-95 focus-visible:text-neutral-800"
          >
            {showPassword ? <EyeSlashIcon /> : <EyeIcon />}
          </button>
        )}
      </div>
    </label>
  );
}

function EyeIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function EyeSlashIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"
      />
    </svg>
  );
}

function formatCountdown(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

type BirthDateParts = { year: number; month: number; day: number };

function getMexicoCalendarDate(date = new Date()): BirthDateParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const getPart = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);

  return { year: getPart('year'), month: getPart('month'), day: getPart('day') };
}

function getLatestAllowedBirthDate(): BirthDateParts {
  const today = getMexicoCalendarDate();
  const year = today.year - 12;
  return {
    year,
    month: today.month,
    day: Math.min(today.day, daysInMonth(year, today.month)),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isEligibleBirthDate(day: number, month: number, year: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return false;
  const latest = getLatestAllowedBirthDate();
  return year < latest.year || (year === latest.year && (
    month < latest.month || (month === latest.month && day <= latest.day)
  ));
}

function WheelDatePicker({
  day,
  month,
  year,
  onChange,
}: {
  day: number;
  month: number;
  year: number;
  onChange: (next: { day?: number; month?: number; year?: number }) => void;
}) {
  const latestAllowed = getLatestAllowedBirthDate();
  const safeYear = clamp(year, 1950, latestAllowed.year);
  const safeMonth = clamp(month, 1, 12);
  const latestDayOfMonth = daysInMonth(safeYear, safeMonth);
  const safeDay = clamp(day, 1, latestDayOfMonth);
  const isEligibleDate = isEligibleBirthDate(safeDay, safeMonth, safeYear);
  const years = useMemo(
    () => Array.from({ length: latestAllowed.year - 1950 + 1 }, (_, i) => 1950 + i),
    [latestAllowed.year],
  );
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), []);
  const days = useMemo(() => Array.from({ length: latestDayOfMonth }, (_, i) => i + 1), [latestDayOfMonth]);

  const columns: { label: string; items: number[]; value: number; onPick: (v: number) => void }[] = [
    { label: 'Día', items: days, value: safeDay, onPick: (v) => onChange({ day: v }) },
    { label: 'Mes', items: months, value: safeMonth, onPick: (v) => onChange({ month: v }) },
    { label: 'Año', items: years, value: safeYear, onPick: (v) => onChange({ year: v }) },
  ];

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3 px-0.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-neutral-100 text-neutral-500 ring-1 ring-inset ring-black/[0.035]">
            <CalendarDays size={15} strokeWidth={1.8} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <span className="block text-xs font-semibold text-neutral-700">Fecha de nacimiento</span>
            <span className="mt-0.5 block text-[10px] leading-none text-neutral-400">Edad mínima: 12 años</span>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-1 text-[10px] font-medium tabular-nums text-neutral-500">
          {String(safeDay).padStart(2, '0')}/{String(safeMonth).padStart(2, '0')}/{safeYear}
        </span>
      </div>
      <div className="grid grid-cols-[0.8fr_0.9fr_1.3fr] gap-1.5 rounded-[22px] border border-black/[0.045] bg-neutral-50/80 p-2 shadow-[inset_0_1px_2px_rgba(15,23,42,0.025)]">
        {columns.map((col) => (
          <div key={col.label} className="min-w-0">
            <p className="mb-1.5 text-center text-[9px] font-bold uppercase tracking-[0.16em] text-neutral-400">
              {col.label}
            </p>
            <WheelColumn label={col.label} items={col.items} value={col.value} onPick={col.onPick} />
          </div>
        ))}
      </div>
      {!isEligibleDate && (
        <p aria-live="polite" className="px-1 text-xs leading-relaxed text-rose-600">
          {`Debes tener al menos 12 años. Fecha límite: ${String(latestAllowed.day).padStart(2, '0')}/${String(latestAllowed.month).padStart(2, '0')}/${latestAllowed.year}.`}
        </p>
      )}
      <style>{`
        .wheel-scroll::-webkit-scrollbar { display: none; width: 0; height: 0; }
        .wheel-scroll { scrollbar-width: none; -ms-overflow-style: none; -webkit-overflow-scrolling: touch; }
      `}</style>
    </div>
  );
}

function WheelColumn({
  label,
  items,
  value,
  onPick,
}: {
  label: string;
  items: number[];
  value: number;
  onPick: (v: number) => void;
}) {
  const ITEM = 44;
  const HEIGHT = ITEM * 3;
  const ref = useRef<HTMLDivElement | null>(null);
  const index = Math.max(0, items.indexOf(value));
  const isInteracting = useRef(false);
  const [activeIndex, setActiveIndex] = useState(index);
  const visibleActiveIndex = isInteracting.current
    ? Math.max(0, Math.min(items.length - 1, activeIndex))
    : index;
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleScrollHandler = useRef<() => void>(() => {});

  const setScrollRef = useCallback((el: HTMLDivElement | null) => {
    ref.current = el;
    if (el && !isInteracting.current) {
      el.scrollTop = index * ITEM;
    }
  }, [ITEM, index]);

  const clearSettleTimer = useCallback(() => {
    if (settleTimer.current) {
      clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
  }, []);

  const settleScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;

    const nextIndex = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / ITEM)));
    const targetScrollTop = nextIndex * ITEM;

    // Snap the final sub-pixel/partial-row offset before committing to the form.
    if (Math.abs(el.scrollTop - targetScrollTop) > 0.75) {
      el.scrollTop = targetScrollTop;
    }

    clearSettleTimer();
    isInteracting.current = false;
    setActiveIndex(nextIndex);
    if (items[nextIndex] !== value) onPick(items[nextIndex]);
  }, [ITEM, clearSettleTimer, items, onPick, value]);
  settleScrollHandler.current = settleScroll;

  function scheduleSettle() {
    clearSettleTimer();
    settleTimer.current = setTimeout(settleScroll, 140);
  }

  useEffect(() => {
    const el = ref.current;
    if (!el || isInteracting.current) return;

    setActiveIndex(index);
    if (Math.abs(el.scrollTop - index * ITEM) > 0.75) {
      el.scrollTop = index * ITEM;
    }
  }, [ITEM, index, items.length]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handleScrollEnd = () => settleScrollHandler.current();
    el.addEventListener('scrollend', handleScrollEnd);
    return () => {
      el.removeEventListener('scrollend', handleScrollEnd);
      clearSettleTimer();
    };
  }, [clearSettleTimer]);

  function selectIndex(nextIndex: number) {
    const clampedIndex = Math.max(0, Math.min(items.length - 1, nextIndex));
    const el = ref.current;
    isInteracting.current = true;
    setActiveIndex(clampedIndex);
    if (el) el.scrollTo({ top: clampedIndex * ITEM, behavior: 'smooth' });
    if (items[clampedIndex] !== value) onPick(items[clampedIndex]);
    scheduleSettle();
  }

  function handleScroll(event: React.UIEvent<HTMLDivElement>) {
    const el = event.currentTarget;
    isInteracting.current = true;
    const nextIndex = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / ITEM)));
    setActiveIndex(nextIndex);
    scheduleSettle();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    let nextIndex: number | undefined;
    switch (event.key) {
      case 'ArrowUp': nextIndex = activeIndex - 1; break;
      case 'ArrowDown': nextIndex = activeIndex + 1; break;
      case 'PageUp': nextIndex = activeIndex - 5; break;
      case 'PageDown': nextIndex = activeIndex + 5; break;
      case 'Home': nextIndex = 0; break;
      case 'End': nextIndex = items.length - 1; break;
      default: return;
    }
    event.preventDefault();
    selectIndex(nextIndex);
  }

  return (
    <div className="relative overflow-hidden rounded-[18px] bg-neutral-100/75" style={{ height: HEIGHT }}>
      <div
        className="pointer-events-none absolute inset-x-1 top-1/2 z-0 -translate-y-1/2 rounded-xl bg-white shadow-[0_2px_8px_rgba(15,23,42,0.06)] ring-1 ring-black/[0.035]"
        style={{ height: ITEM - 2 }}
      />
      <div
        ref={setScrollRef}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        role="spinbutton"
        aria-label={`${label} de la fecha de nacimiento`}
        aria-valuemin={items[0]}
        aria-valuemax={items[items.length - 1]}
        aria-valuenow={items[visibleActiveIndex]}
        aria-valuetext={`${label} ${String(items[visibleActiveIndex]).padStart(2, '0')}`}
        tabIndex={0}
        className="wheel-scroll relative z-10 h-full snap-y snap-mandatory overflow-y-scroll overscroll-contain rounded-[18px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-900/30"
        style={{ scrollSnapType: 'y mandatory', touchAction: 'pan-y' }}
      >
        <div aria-hidden="true" style={{ height: ITEM }} />
        {items.map((it, itemIndex) => (
          <div
            key={it}
            aria-hidden="true"
            onClick={() => selectIndex(itemIndex)}
            className={`flex cursor-pointer select-none items-center justify-center font-semibold tabular-nums transition-[color,transform] duration-150 ${itemIndex === visibleActiveIndex ? 'scale-100 text-[17px] text-neutral-900' : 'scale-[0.96] text-[16px] text-neutral-400'}`}
            style={{ height: ITEM, scrollSnapAlign: 'center' }}
          >
            {String(it).padStart(2, '0')}
          </div>
        ))}
        <div aria-hidden="true" style={{ height: ITEM }} />
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-20 h-8 bg-gradient-to-b from-neutral-100/90 to-transparent" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-8 bg-gradient-to-t from-neutral-100/90 to-transparent" />
    </div>
  );
}

function Callout({
  tone,
  children,
}: {
  tone: 'info' | 'success' | 'danger';
  children: React.ReactNode;
}) {
  const styles = {
    info: 'border-red-100 bg-red-50 text-red-700',
    success: 'border-emerald-100 bg-emerald-50 text-emerald-700',
    danger: 'border-rose-100 bg-rose-50 text-rose-700',
  };

  return (
    <div className={`rounded-2xl border px-4 py-3 text-xs font-semibold leading-relaxed ${styles[tone]}`}>
      {children}
    </div>
  );
}
