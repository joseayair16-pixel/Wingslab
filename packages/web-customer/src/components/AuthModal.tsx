import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiResponse,
  AuthResponse,
  AuthUser,
  SendCodeResponse,
  persistStoredSession,
  requestJson,
} from '@sadel/shared';
import { SaDelLogo } from './SaDelLogo';

type AuthMode = 'login' | 'register' | 'recovery';
type AuthStep = 'welcome' | 'details' | 'contact' | 'request' | 'verify' | 'create-password' | 'new-password';
type OtpChannel = 'email' | 'sms';

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
  const [dobDay, setDobDay] = useState(new Date().getDate());
  const [dobMonth, setDobMonth] = useState(new Date().getMonth() + 1);
  const [dobYear, setDobYear] = useState(new Date().getFullYear());
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [channel, setChannel] = useState<OtpChannel>('email');
  const [phoneExists, setPhoneExists] = useState<boolean | null>(null);
  const [resetToken, setResetToken] = useState('');
  const [registerToken, setRegisterToken] = useState('');
  const [countdown, setCountdown] = useState(60);
  
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [error, setError] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [mockCode, setMockCode] = useState('');

  // Countdown timer for OTP resend
  useEffect(() => {
    let timer: any;
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

  // Reset state when opening/closing
  useEffect(() => {
    if (isOpen) {
      setAuthMode('login');
      setAuthStep('welcome');
      setPhone('');
      setEmail('');
      setName('');
      setLastName('');
      setDobDay(new Date().getDate());
      setDobMonth(new Date().getMonth() + 1);
      setDobYear(new Date().getFullYear());
      setPassword('');
      setConfirmPassword('');
      setOtpCode('');
      setChannel('email');
      setResetToken('');
      setRegisterToken('');
      setCountdown(60);
      setPhoneExists(null);
      setError('');
      setAuthMessage('');
      setMockCode('');
    }
  }, [isOpen]);

  const handleDobChange = useCallback((next: { day?: number; month?: number; year?: number }) => {
    const month = next.month ?? dobMonth;
    const year = next.year ?? dobYear;
    const now = new Date();
    const maxDay =
      year === now.getFullYear() && month === now.getMonth() + 1
        ? now.getDate()
        : daysInMonth(year, month);
    setDobDay(Math.min(next.day ?? dobDay, maxDay));
    setDobMonth(month);
    setDobYear(year);
  }, [dobDay, dobMonth, dobYear]);

  function handlePhoneChange(value: string) {
    const nextPhone = value.replace(/\D/g, '').slice(-10);
    setPhone(nextPhone);
    setPhoneExists(null);
    setError('');
    setAuthMessage('');

    if (authMode === 'register' && authStep === 'verify') {
      setAuthStep('contact');
      setOtpCode('');
      setMockCode('');
    }
  }

  function handleEmailChange(value: string) {
    setEmail(value.trim());
    setError('');
    setAuthMessage('');
    setPhoneExists(null);
  }

  const emailIsValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  async function checkEmailExists(target: string): Promise<boolean> {
    const payload = await requestJson<ApiResponse<{ exists: boolean }>>({
      apiBase,
      path: '/auth/check-email',
      options: {
        method: 'POST',
        body: JSON.stringify({ email: target.trim(), role: 'CUSTOMER' }),
      },
      fallbackMessage: 'No se pudo validar el correo.',
    });
    return Boolean(payload.data?.exists);
  }

  async function checkPhoneExists(nextPhone: string): Promise<boolean> {
    const payload = await requestJson<ApiResponse<{ exists: boolean; phone: string }>>({
      apiBase,
      path: '/auth/check-phone',
      options: {
        method: 'POST',
        body: JSON.stringify({ phone: nextPhone, role: 'CUSTOMER' }),
      },
      fallbackMessage: 'No se pudo validar el teléfono.',
    });

    const exists = Boolean(payload.data?.exists);
    setPhoneExists(exists);
    return exists;
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
        user: payload.data.user,
      });

      onSuccess(payload.data.token, payload.data.user);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Teléfono o contraseña incorrectos.');
    } finally {
      setVerifyingCode(false);
    }
  }

  async function sendCode(selectedChannel: OtpChannel) {
    setSendingCode(true);
    setError('');
    setAuthMessage('');
    setMockCode('');

    try {
      if (authMode === 'register') {
        const exists = emailIsValid && (await checkEmailExists(email));
        if (exists) {
          setError('Este correo ya tiene una cuenta registrada.');
          setSendingCode(false);
          return;
        }
        const phoneTaken = await checkPhoneExists(phone.trim());
        if (phoneTaken) {
          setError('Este teléfono ya tiene una cuenta registrada.');
          setSendingCode(false);
          return;
        }
      } else if (authMode === 'recovery') {
        const exists = await checkPhoneExists(phone.trim());
        if (!exists) {
          setError('Este número no tiene ninguna cuenta registrada.');
          setSendingCode(false);
          return;
        }
      }

      const payload = await requestJson<SendCodeResponse>({
        apiBase,
        path: '/auth/enviar-codigo',
        options: {
          method: 'POST',
          body: JSON.stringify({
            phone: phone.trim(),
            email: authMode === 'register' ? email.trim() || undefined : undefined,
            intent: authMode === 'recovery' ? 'recovery' : 'register',
            role: 'CUSTOMER',
            channel: selectedChannel,
          }),
        },
        fallbackMessage: 'No se pudo enviar el código.',
      });

      setChannel(selectedChannel);
      setMockCode(payload.data.mockCode || '');
      setAuthMessage(
        selectedChannel === 'email'
          ? `Enviamos un código a ${email.trim()}.`
          : `Enviamos un código por SMS a ${formatPhoneNumber(phone)}.`,
      );
      setCountdown(authMode === 'register' ? (payload.data.expiresInSeconds ?? 300) : 60);
      setAuthStep('verify');
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : '';
      const awaitingCooldown = /espera 60 segundos/.test(message);
      if (awaitingCooldown) {
        setChannel(selectedChannel);
        setCountdown(authMode === 'register' ? 300 : 60);
        setAuthMessage(
          selectedChannel === 'email'
            ? `Ya se envió un código a ${email.trim()} hace unos segundos. Usa el que recibiste.`
            : 'Ya se envió un código por SMS hace unos segundos. Usa el que recibiste.',
        );
        setAuthStep('verify');
      } else {
        setError(message || 'No se pudo enviar el código.');
      }
    } finally {
      setSendingCode(false);
    }
  }

  async function verifyCode() {
    setVerifyingCode(true);
    setError('');
    setAuthMessage('');

    try {
      const payload = await requestJson<any>({
        apiBase,
        path: '/auth/verificar-codigo',
        options: {
          method: 'POST',
          body: JSON.stringify({
            phone: phone.trim(),
            code: otpCode,
            email: email.trim(),
            name: name.trim(),
            lastName: lastName.trim() || undefined,
            dateOfBirth: `${dobYear}-${String(dobMonth).padStart(2, '0')}-${String(dobDay).padStart(2, '0')}`,
            intent: authMode === 'recovery' ? 'recovery' : 'register',
            role: 'CUSTOMER',
          }),
        },
        fallbackMessage: 'No se pudo verificar el código.',
      });

      if (authMode === 'recovery') {
        setResetToken(payload.data.resetToken);
        setAuthMessage(payload.data.message || 'Código verificado.');
        setAuthStep('new-password');
        return;
      }

      if (payload.data.registerToken) {
        setRegisterToken(payload.data.registerToken);
        setAuthMessage(payload.data.message || 'Código verificado. Ahora crea tu contraseña.');
        setAuthStep('create-password');
        return;
      }

      if (payload.data.user?.role === 'CUSTOMER') {
        persistStoredSession({
          storageKey: 'sadel.customer',
          apiBase,
          token: payload.data.token,
          user: payload.data.user,
        });

        onSuccess(payload.data.token, payload.data.user);
        return;
      }

      throw new Error('No se pudo completar el registro.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo verificar el código.');
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
      await requestJson<any>({
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
      setOtpCode('');
      setMockCode('');
      setPassword('');
      setConfirmPassword('');
      setResetToken('');
      setAuthStep('request');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo restablecer la contraseña.');
    } finally {
      setVerifyingCode(false);
    }
  }

  if (!isOpen) return null;

  const modeCopy = authMode === 'register'
    ? {
      title:
        authStep === 'details'
          ? 'Crear cuenta'
          : authStep === 'contact'
          ? 'Datos de contacto'
          : authStep === 'verify'
          ? 'Verificar tu identidad'
          : 'Crea tu contraseña',
      subtitle:
        authStep === 'details'
          ? 'Cuéntanos quién eres para empezar.'
          : authStep === 'contact'
            ? 'Recibe tu código de verificación.'
            : authStep === 'verify'
              ? 'Ingresa el código que te enviamos.'
              : 'Elige una contraseña para tu cuenta.',
      cta: sendingCode ? 'Enviando código...' : 'Enviar código',
      submit: verifyingCode ? 'Creando cuenta...' : 'Crear cuenta',
    }
    : authMode === 'recovery'
    ? {
      title: 'Recuperar contraseña',
      subtitle: authStep === 'request' ? 'Ingresa tu celular para recibir un código.' : authStep === 'verify' ? 'Ingresa el código OTP.' : 'Crea tu nueva contraseña.',
      cta: sendingCode ? 'Enviando código...' : 'Enviar código',
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 max-sm:p-0 max-sm:items-end animate-[fadeIn_0.2s_ease-out]">
      <div className="relative w-full max-w-md overflow-hidden rounded-[32px] bg-white p-6 shadow-[0_32px_64px_-12px_rgba(0,0,0,0.14)] border border-black/[0.04] flex flex-col max-h-[90dvh] max-sm:max-h-[92dvh] max-sm:rounded-t-[32px] max-sm:rounded-b-none pb-[calc(1.5rem+env(safe-area-inset-bottom))] animate-[scaleUp_0.25s_cubic-bezier(0.16,1,0.3,1)] max-sm:animate-[slideUp_0.3s_cubic-bezier(0.16,1,0.3,1)]">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-5 top-5 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 hover:bg-neutral-200 text-neutral-600 transition active:scale-95"
          aria-label="Cerrar modal de autenticación"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Content Container */}
        <div className="overflow-y-auto overflow-x-hidden flex-1 pr-1.5 scrollbar-thin">
          <div className="text-center pt-2">
            <SaDelLogo className="mx-auto h-12 w-auto object-contain" />
            <p className="mt-1.5 text-[11px] uppercase tracking-[0.2em] text-neutral-400 font-semibold">
              ¡Pídelo por aquí!
            </p>
          </div>

          <div className="mt-6">
            {authStep === 'welcome' ? (
              <div className="text-center">
                <h3 className="text-2xl font-bold tracking-[-0.03em] text-neutral-900">¡Hola!</h3>
                <p className="mt-2 text-sm text-neutral-500 leading-relaxed">
                  Inicia sesión para pedir por SaDeL
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
                    Ya tengo cuenta
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('register');
                      setAuthStep('details');
                    }}
                    className="w-full rounded-2xl border border-black/[0.08] bg-white py-3.5 text-sm font-semibold text-[#171717] transition-all duration-200 hover:bg-neutral-50 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] active:scale-[0.98] shadow-sm"
                  >
                    Registrarme
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="mb-6">
                  <span className="inline-block rounded-full bg-accent-soft/80 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-sky-600">
                    {authMode === 'register' ? 'Nuevo usuario' : authMode === 'recovery' ? 'Restablecer' : 'Miembro'}
                  </span>
                  <h3 className="mt-3 text-2xl font-bold tracking-[-0.03em] text-neutral-950">{modeCopy.title}</h3>
                  <p className="text-sm text-neutral-500 mt-1.5">{modeCopy.subtitle}</p>
                </div>

                <div className="grid gap-4">
                  {authMode === 'login' ? (
                    <>
                      <Field
                        label="Teléfono (10 dígitos)"
                        value={phone}
                        onChange={handlePhoneChange}
                        placeholder="5512345678"
                        mask={formatPhoneNumber}
                      />
                      <Field
                        label="Contraseña"
                        value={password}
                        onChange={setPassword}
                        placeholder="Ingresa tu contraseña"
                        type="password"
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
                            placeholder="5512345678"
                            mask={formatPhoneNumber}
                          />
                          <button
                            type="button"
                            onClick={() => sendCode('sms')}
                            disabled={sendingCode || phone.length !== 10}
                            className="mt-3 w-full rounded-2xl bg-[#0a0a0a] py-3.5 text-sm font-semibold text-[#ffffff] transition-all duration-200 hover:bg-[#262626] hover:shadow-[0_8px_24px_rgba(10,10,10,0.12)] disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 disabled:shadow-none active:scale-[0.98]"
                          >
                            {sendingCode ? 'Enviando código...' : 'Enviar código'}
                          </button>
                        </>
                      ) : authStep === 'verify' ? (
                        <div className="space-y-5">
                          <div className="rounded-2xl bg-neutral-50/80 p-4 border border-black/[0.04]">
                            <p className="text-sm text-neutral-600 leading-relaxed">
                              Enviamos tu código a{' '}
                              <strong className="text-neutral-900">{formatPhoneNumber(phone)}</strong>
                            </p>
                            <p className="text-xs text-neutral-400 mt-1">El código vence en 5 minutos.</p>
                          </div>
                          <OtpInput value={otpCode} onChange={setOtpCode} disabled={verifyingCode} />

                          <div className="flex items-center justify-center text-xs text-neutral-500">
                            {countdown > 0 ? (
                              <span>
                                ¿No te llegó? Reenviar en{' '}
                                <span className="tabular-nums font-bold text-neutral-700">{formatCountdown(countdown)}</span>
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => sendCode('sms')}
                                disabled={sendingCode}
                                className="font-semibold text-sky-600 hover:text-sky-700 transition-colors"
                              >
                                Volver a enviar código
                              </button>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={verifyCode}
                            disabled={verifyingCode || otpCode.trim().length !== 6}
                            className="w-full rounded-2xl bg-[#0a0a0a] py-3.5 text-sm font-semibold text-[#ffffff] transition-all duration-200 hover:bg-[#262626] hover:shadow-[0_8px_24px_rgba(10,10,10,0.12)] disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 disabled:shadow-none active:scale-[0.98] active-scale"
                          >
                            {verifyingCode ? 'Verificando...' : 'Confirmar código'}
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <Field
                            label="Nueva contraseña"
                            value={password}
                            onChange={setPassword}
                            placeholder="Al menos 6 caracteres"
                            type="password"
                          />
                          <Field
                            label="Confirmar contraseña"
                            value={confirmPassword}
                            onChange={setConfirmPassword}
                            placeholder="Repite tu contraseña"
                            type="password"
                          />
                          {password && confirmPassword && password !== confirmPassword && (
                            <p className="text-[11px] font-semibold text-rose-500 px-1">Las contraseñas no coinciden.</p>
                          )}
                          <button
                            type="button"
                            onClick={handleResetPassword}
                            disabled={verifyingCode || password.length < 6 || password !== confirmPassword}
                            className="w-full rounded-2xl bg-[#0a0a0a] py-3.5 text-sm font-semibold text-[#ffffff] transition-all duration-200 hover:bg-[#262626] hover:shadow-[0_8px_24px_rgba(10,10,10,0.12)] disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 disabled:shadow-none active:scale-[0.98] active-scale"
                          >
                            {verifyingCode ? 'Restableciendo...' : 'Restablecer contraseña'}
                          </button>
                        </div>
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
                            disabled={!name.trim() || !lastName.trim()}
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
                            onChange={handleEmailChange}
                            placeholder="tucorreo@ejemplo.com"
                            type="email"
                          />
                          <Field
                            label="Teléfono (10 dígitos)"
                            value={phone}
                            onChange={handlePhoneChange}
                            placeholder="5512345678"
                            mask={formatPhoneNumber}
                          />
                          {phoneExists === true && (
                            <Callout tone="danger">Este teléfono ya tiene una cuenta registrada.</Callout>
                          )}
                          <div className="grid gap-3 pt-1">
                            <button
                              type="button"
                              onClick={() => sendCode('email')}
                              disabled={sendingCode || !emailIsValid || phone.length !== 10}
                              className="w-full rounded-2xl bg-[#0a0a0a] py-3.5 text-sm font-semibold text-[#ffffff] transition-all duration-200 hover:bg-[#262626] hover:shadow-[0_8px_24px_rgba(10,10,10,0.12)] disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 disabled:shadow-none active:scale-[0.98]"
                            >
                              {sendingCode ? 'Enviando código...' : 'Recibir código a mi correo'}
                            </button>
                            <button
                              type="button"
                              onClick={() => sendCode('sms')}
                              disabled={sendingCode || phone.length !== 10}
                              className="w-full rounded-2xl border border-black/[0.08] bg-white py-3.5 text-sm font-semibold text-[#171717] transition-all duration-200 hover:bg-neutral-50 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 disabled:border-transparent disabled:shadow-none"
                            >
                              {sendingCode ? 'Enviando código...' : 'Recibir código vía SMS'}
                            </button>
                          </div>
                        </div>
                      ) : authStep === 'create-password' ? (
                        <div className="space-y-4">
                          <Field
                            label="Contraseña"
                            value={password}
                            onChange={setPassword}
                            placeholder="Al menos 6 caracteres"
                            type="password"
                          />
                          <Field
                            label="Confirmar contraseña"
                            value={confirmPassword}
                            onChange={setConfirmPassword}
                            placeholder="Repite tu contraseña"
                            type="password"
                          />
                          {password && confirmPassword && password !== confirmPassword && (
                            <p className="text-[11px] font-semibold text-rose-500 px-1">Las contraseñas no coinciden.</p>
                          )}
                          <button
                            type="button"
                            onClick={completeRegistration}
                            disabled={verifyingCode || password.length < 6 || password !== confirmPassword}
                            className="mt-3 w-full rounded-2xl bg-[#0a0a0a] py-3.5 text-sm font-semibold text-[#ffffff] transition-all duration-200 hover:bg-[#262626] hover:shadow-[0_8px_24px_rgba(10,10,10,0.12)] disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 disabled:shadow-none active:scale-[0.98]"
                          >
                            {verifyingCode ? 'Creando cuenta...' : 'Crear cuenta'}
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-5">
                          <div className="rounded-2xl bg-neutral-50/80 p-4 border border-black/[0.04]">
                            <p className="text-sm text-neutral-600 leading-relaxed">
                              Enviamos tu código a{' '}
                              <strong className="text-neutral-900">
                                {channel === 'email' ? email : formatPhoneNumber(phone)}
                              </strong>
                            </p>
                            <p className="text-xs text-neutral-400 mt-1">El código vence en 5 minutos.</p>
                          </div>
                          <OtpInput value={otpCode} onChange={setOtpCode} disabled={verifyingCode} />

                          <div className="flex items-center justify-center text-xs text-neutral-500">
                            {countdown > 0 ? (
                              <span>
                                ¿No te llegó? Reenviar en{' '}
                                <span className="tabular-nums font-bold text-neutral-700">{formatCountdown(countdown)}</span>
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => sendCode(channel)}
                                disabled={sendingCode}
                                className="font-semibold text-sky-600 hover:text-sky-700 transition-colors"
                              >
                                Volver a enviar código
                              </button>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={verifyCode}
                            disabled={verifyingCode || otpCode.trim().length !== 6}
                            className="w-full rounded-2xl bg-[#0a0a0a] py-3.5 text-sm font-semibold text-[#ffffff] transition-all duration-200 hover:bg-[#262626] hover:shadow-[0_8px_24px_rgba(10,10,10,0.12)] disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 disabled:shadow-none active:scale-[0.98] active-scale"
                          >
                            {verifyingCode ? 'Verificando...' : 'Verificar código'}
                          </button>
                        </div>
                      )}
                    </>
                  )}

                  <button
                    type="button"
                    onClick={goBack}
                    className="mt-2 text-center text-xs font-semibold text-neutral-400 hover:text-neutral-900 transition-colors duration-200"
                  >
                    ← Atrás
                  </button>

                  {mockCode && (
                    <Callout tone="info">Código de prueba detectado: {mockCode}</Callout>
                  )}
                  {error && <Callout tone="danger">{error}</Callout>}
                  {authMessage && !error && <Callout tone="success">{authMessage}</Callout>}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
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

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  mask,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
  mask?: (value: string) => string;
}) {
  return (
    <label className="grid gap-1.5 text-xs text-neutral-600 font-medium">
      <span>{label}</span>
      <input
        type={type}
        value={mask ? mask(value) : value}
        onChange={(event) => {
          const rawValue = mask ? event.target.value.replace(/\D/g, '').slice(0, 10) : event.target.value;
          onChange(rawValue);
        }}
        placeholder={placeholder}
        className={`rounded-2xl border border-black/[0.08] bg-white px-4 text-sm text-neutral-950 outline-none transition-all duration-200 placeholder:text-neutral-400 shadow-[0_1px_2px_rgba(0,0,0,0.02)] focus:border-black/20 focus:shadow-[0_4px_12px_rgba(0,0,0,0.04)] focus:ring-2 focus:ring-black/[0.04] h-12 py-3 ${type === 'date' ? 'appearance-none' : ''}`}
      />
    </label>
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
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const currentDay = now.getDate();
  const years = useMemo(
    () => Array.from({ length: currentYear - 1950 + 1 }, (_, i) => 1950 + i),
    [currentYear],
  );
  const months = useMemo(
    () => Array.from({ length: year === currentYear ? currentMonth : 12 }, (_, i) => i + 1),
    [year, currentYear, currentMonth],
  );
  const isCurrentMonth = year === currentYear && month === currentMonth;
  const maxDay = isCurrentMonth ? Math.min(daysInMonth(year, month), currentDay) : daysInMonth(year, month);
  const days = useMemo(() => Array.from({ length: maxDay }, (_, i) => i + 1), [maxDay]);
  // Seguridad: el día nunca puede rebasar el máximo del mes/año seleccionado.
  const safeDay = Math.min(day, maxDay);

  const columns: { label: string; items: number[]; value: number; onPick: (v: number) => void; flex: string }[] = [
    { label: 'Día', items: days, value: safeDay, onPick: (v) => onChange({ day: v }), flex: 'flex-[0.7]' },
    { label: 'Mes', items: months, value: month, onPick: (v) => onChange({ month: v }), flex: 'flex-[0.8]' },
    { label: 'Año', items: years, value: year, onPick: (v) => onChange({ year: v }), flex: 'flex-1' },
  ];

  return (
    <div className="grid gap-1.5">
      <span className="text-xs text-neutral-600 font-medium">Fecha de nacimiento</span>
      <div className="flex gap-1.5">
        {columns.map((col) => (
          <div key={col.label} className={`${col.flex} min-w-0`}>
            <p className="mb-1 text-center text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-400">
              {col.label}
            </p>
            <WheelColumn items={col.items} value={col.value} onPick={col.onPick} />
          </div>
        ))}
      </div>
      <style>{`
        .wheel-scroll::-webkit-scrollbar { display: none; }
        .wheel-scroll { scrollbar-width: none; -ms-overflow-style: none; }
      `}</style>
    </div>
  );
}

function WheelColumn({
  items,
  value,
  onPick,
}: {
  items: number[];
  value: number;
  onPick: (v: number) => void;
}) {
  const ITEM = 44;
  const HEIGHT = ITEM * 3;
  const ref = useRef<HTMLDivElement | null>(null);
  const index = Math.max(0, items.indexOf(value));

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = index * ITEM;
  }, [index]);

  function handleScroll(event: React.UIEvent<HTMLDivElement>) {
    const el = event.currentTarget;
    const idx = Math.round(el.scrollTop / ITEM);
    const clamped = Math.max(0, Math.min(items.length - 1, idx));
    const picked = items[clamped];
    if (picked !== value) onPick(picked);
  }

  return (
    <div className="relative overflow-hidden rounded-2xl" style={{ height: HEIGHT }}>
      <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 border-y border-black/[0.06] bg-black/[0.03]" style={{ height: ITEM }} />
      <div
        ref={ref}
        onScroll={handleScroll}
        className="wheel-scroll h-full snap-y snap-mandatory overflow-y-scroll overscroll-contain"
        style={{ scrollSnapType: 'y mandatory' }}
      >
        <div style={{ height: ITEM }} />
        {items.map((it) => (
          <div
            key={it}
            className={`flex items-center justify-center text-[17px] font-semibold tabular-nums transition-colors duration-150 ${it === value ? 'text-neutral-900' : 'text-neutral-300'}`}
            style={{ height: ITEM }}
          >
            {String(it).padStart(2, '0')}
          </div>
        ))}
        <div style={{ height: ITEM }} />
      </div>
    </div>
  );
}

function OtpInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.split('').slice(0, 6);

  function handleChange(index: number, char: string) {
    const clean = char.replace(/\D/g, '').slice(0, 1);
    const arr = Array.from({ length: 6 }, (_, i) => digits[i] || '');
    arr[index] = clean;
    onChange(arr.join(''));
    if (clean && index < 5) refs.current[index + 1]?.focus();
  }

  function handleKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    const arr = Array.from({ length: 6 }, (_, i) => digits[i] || '');
    if (event.key === 'Backspace') {
      event.preventDefault();
      if (arr[index]) {
        arr[index] = '';
        onChange(arr.join(''));
      } else if (index > 0) {
        arr[index - 1] = '';
        onChange(arr.join(''));
        refs.current[index - 1]?.focus();
      }
    } else if (event.key === 'ArrowLeft' && index > 0) {
      refs.current[index - 1]?.focus();
    } else if (event.key === 'ArrowRight' && index < 5) {
      refs.current[index + 1]?.focus();
    }
  }

  return (
    <div
      className="flex justify-between gap-2"
      onPaste={(event) => {
        const text = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
        if (text) {
          event.preventDefault();
          onChange(text);
          refs.current[Math.min(text.length, 5)]?.focus();
        }
      }}
    >
      {Array.from({ length: 6 }).map((_, index) => (
        <input
          key={index}
          ref={(el) => {
            refs.current[index] = el;
          }}
          value={digits[index] || ''}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={1}
          placeholder="•"
          aria-label={`Digito ${index + 1}`}
          disabled={disabled}
          onChange={(event) => handleChange(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          className="h-14 w-full max-w-[52px] rounded-2xl border border-black/[0.08] bg-white text-center text-xl font-bold tabular-nums text-neutral-950 outline-none transition-all duration-200 placeholder:text-neutral-300 focus:border-sky-400 focus:ring-2 focus:ring-sky-500/20 disabled:opacity-60"
        />
      ))}
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
    info: 'border-sky-100 bg-sky-50 text-sky-700',
    success: 'border-emerald-100 bg-emerald-50 text-emerald-700',
    danger: 'border-rose-100 bg-rose-50 text-rose-700',
  };

  return (
    <div className={`rounded-2xl border px-4 py-3 text-xs font-semibold leading-relaxed ${styles[tone]}`}>
      {children}
    </div>
  );
}
