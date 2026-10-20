import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, X } from 'lucide-react';
import {
  ApiResponse,
  AuthResponse,
  AuthUser,
  persistStoredSession,
  requestJson,
} from '@sadel/shared';
import { SaDelLogo } from './SaDelLogo';

type AuthMode = 'login' | 'register' | 'recovery';
type AuthStep = 'welcome' | 'details' | 'contact' | 'request' | 'verify' | 'create-password' | 'new-password';
type AuthChannel = 'email' | 'whatsapp';
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
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [registerToken, setRegisterToken] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [emailChallengeId, setEmailChallengeId] = useState('');
  const [whatsappUrl, setWhatsappUrl] = useState('');
  const [authChannel, setAuthChannel] = useState<AuthChannel>('whatsapp');
  const [otpCode, setOtpCode] = useState('');
  const [maskedOtpEmail, setMaskedOtpEmail] = useState('');
  const [mockOtpCode, setMockOtpCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  
  const [startingWhatsApp, setStartingWhatsApp] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [error, setError] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  // Countdown for the short-lived WhatsApp challenge.
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
      setConfirmPassword('');
      setResetToken('');
      setRegisterToken('');
      setChallengeId('');
      setEmailChallengeId('');
      setWhatsappUrl('');
      setAuthChannel('whatsapp');
      setOtpCode('');
      setMaskedOtpEmail('');
      setMockOtpCode('');
      setCountdown(0);
      setError('');
      setAuthMessage('');
    }
  }, [isOpen]);

  const handleDobChange = useCallback((next: { day?: number; month?: number; year?: number }) => {
    const latestAllowed = getLatestAllowedBirthDate();
    const year = clamp(next.year ?? dobYear, 1950, latestAllowed.year);
    const maxMonth = year === latestAllowed.year ? latestAllowed.month : 12;
    const month = clamp(next.month ?? dobMonth, 1, maxMonth);
    const maxDay = year === latestAllowed.year && month === latestAllowed.month
      ? latestAllowed.day
      : daysInMonth(year, month);
    setDobDay(clamp(next.day ?? dobDay, 1, maxDay));
    setDobMonth(month);
    setDobYear(year);
  }, [dobDay, dobMonth, dobYear]);

  function handlePhoneChange(value: string) {
    const nextPhone = value.replace(/\D/g, '').slice(-10);
    setPhone(nextPhone);
    setError('');
    setAuthMessage('');

    if (authStep === 'verify') {
      setChallengeId('');
      setEmailChallengeId('');
      setWhatsappUrl('');
      setOtpCode('');
      setMockOtpCode('');
      setCountdown(0);
      setAuthStep(authMode === 'register' ? 'contact' : 'request');
    }
  }

  function handleEmailChange(value: string) {
    setEmail(value.trim());
    setError('');
    setAuthMessage('');
  }

  const emailIsValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

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

  async function startWhatsAppVerification() {
    setStartingWhatsApp(true);
    setError('');
    setAuthMessage('');
    setAuthChannel('whatsapp');
    setChallengeId('');
    setWhatsappUrl('');
    setEmailChallengeId('');
    setOtpCode('');
    setMockOtpCode('');
    setCountdown(0);

    try {
      if (phone.length !== 10) {
        throw new Error('Ingresa un teléfono de 10 dígitos.');
      }
      if (authMode === 'register') {
        if (!emailIsValid) {
          throw new Error('Ingresa un correo electrónico válido.');
        }
        if (!isEligibleBirthDate(dobDay, dobMonth, dobYear)) {
          throw new Error('Para crear una cuenta necesitas tener al menos 12 años.');
        }
      }

      const payload = await requestJson<ApiResponse<{
        challengeId: string;
        whatsappUrl: string;
        expiresInSeconds: number;
      }>>({
        apiBase,
        path: '/auth/whatsapp/iniciar',
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
                  dateOfBirth: String(dobYear) + '-' + String(dobMonth).padStart(2, '0') + '-' + String(dobDay).padStart(2, '0'),
                }
              : {}),
          }),
        },
        fallbackMessage: 'No se pudo iniciar la verificación por WhatsApp.',
      });
      if (!payload.data) throw new Error('No se pudo iniciar la verificación por WhatsApp.');

      setChallengeId(payload.data.challengeId);
      setWhatsappUrl(payload.data.whatsappUrl);
      setCountdown(payload.data.expiresInSeconds);
      setAuthMessage('Abre WhatsApp y envía el mensaje preparado. Confirmaremos tu número automáticamente.');
      setAuthStep('verify');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo iniciar la verificación.');
    } finally {
      setStartingWhatsApp(false);
    }
  }

  async function startEmailVerification() {
    setStartingWhatsApp(true);
    setError('');
    setAuthMessage('');
    setAuthChannel('email');
    setChallengeId('');
    setEmailChallengeId('');
    setWhatsappUrl('');
    setOtpCode('');
    setMockOtpCode('');

    try {
      if (phone.length !== 10) {
        throw new Error('Ingresa un teléfono de 10 dígitos.');
      }
      if (authMode === 'register') {
        if (!emailIsValid) {
          throw new Error('Ingresa un correo electrónico válido.');
        }
        if (!name.trim() || !lastName.trim()) {
          throw new Error('Completa tu nombre y apellidos.');
        }
        if (!isEligibleBirthDate(dobDay, dobMonth, dobYear)) {
          throw new Error('Para crear una cuenta necesitas tener al menos 12 años.');
        }
      }

      const payload = await requestJson<ApiResponse<{
        challengeId: string;
        channel: 'email';
        maskedEmail: string;
        expiresInSeconds: number;
        mockCode?: string;
      }>>({
        apiBase,
        path: '/auth/email-otp/iniciar',
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
        fallbackMessage: 'No se pudo enviar el código por correo.',
      });
      if (!payload.data) throw new Error('No se pudo enviar el código por correo.');

      setEmailChallengeId(payload.data.challengeId);
      setMaskedOtpEmail(payload.data.maskedEmail);
      setMockOtpCode(payload.data.mockCode || '');
      setCountdown(payload.data.expiresInSeconds);
      setAuthMessage(`Enviamos un código a ${payload.data.maskedEmail}.`);
      setAuthStep('verify');
    } catch (requestError) {
      setAuthStep(authMode === 'register' ? 'contact' : 'request');
      setError(requestError instanceof Error ? requestError.message : 'No se pudo iniciar la verificación por correo.');
    } finally {
      setStartingWhatsApp(false);
    }
  }

  async function verifyEmailCode() {
    setVerifyingCode(true);
    setError('');
    setAuthMessage('');

    try {
      const payload = await requestJson<ApiResponse<{ registerToken?: string; resetToken?: string }>>({
        apiBase,
        path: '/auth/email-otp/confirmar',
        options: {
          method: 'POST',
          body: JSON.stringify({ challengeId: emailChallengeId, code: otpCode.trim() }),
        },
        fallbackMessage: 'No se pudo verificar el código.',
      });
      if (!payload.data) throw new Error('No se pudo completar la verificación.');

      if (authMode === 'recovery' && payload.data.resetToken) {
        setResetToken(payload.data.resetToken);
        setAuthMessage('Correo verificado. Crea una contraseña nueva.');
        setAuthStep('new-password');
        return;
      }
      if (payload.data.registerToken) {
        setRegisterToken(payload.data.registerToken);
        setAuthMessage('Correo verificado. Ahora crea tu contraseña.');
        setAuthStep('create-password');
        return;
      }
      throw new Error('No se pudo completar la verificación.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo verificar el código.');
    } finally {
      setVerifyingCode(false);
    }
  }

  useEffect(() => {
    if (!isOpen || authStep !== 'verify' || !challengeId) return;

    let stopped = false;
    let checking = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const checkStatus = async () => {
      if (stopped || checking) return;
      checking = true;

      try {
        const status = await requestJson<ApiResponse<{ status: 'pending' | 'verified' }>>({
          apiBase,
          path: '/auth/whatsapp/estado',
          options: {
            method: 'POST',
            body: JSON.stringify({ challengeId }),
          },
          fallbackMessage: 'No se pudo consultar la verificación.',
        });

        if (status.data?.status === 'verified') {
          setVerifyingCode(true);
          setAuthMessage('Número confirmado. Continuando…');
          const confirmed = await requestJson<ApiResponse<{ registerToken?: string; resetToken?: string }>>({
            apiBase,
            path: '/auth/whatsapp/confirmar',
            options: {
              method: 'POST',
              body: JSON.stringify({ challengeId }),
            },
            fallbackMessage: 'No se pudo confirmar el número.',
          });

          if (stopped) return;
          if (!confirmed.data) throw new Error('No se pudo completar la verificación.');
          if (authMode === 'recovery' && confirmed.data.resetToken) {
            setResetToken(confirmed.data.resetToken);
            setAuthMessage('Número verificado. Crea una contraseña nueva.');
            setAuthStep('new-password');
            return;
          }
          if (confirmed.data.registerToken) {
            setRegisterToken(confirmed.data.registerToken);
            setAuthMessage('Número verificado. Ahora crea tu contraseña.');
            setAuthStep('create-password');
            return;
          }
          throw new Error('No se pudo completar la verificación.');
        }

        setAuthMessage('Esperando que WhatsApp confirme el mensaje…');
      } catch (requestError) {
        if (stopped) return;
        const message = requestError instanceof Error ? requestError.message : '';
        if (/venci|expir|no existe una cuenta|ya tiene una cuenta/i.test(message)) {
          setChallengeId('');
          setWhatsappUrl('');
          setCountdown(0);
          if (/ya tiene una cuenta/i.test(message) && authMode === 'register') {
            setAuthMode('recovery');
            setAuthStep('request');
            setError('Este número ya tiene una cuenta. Verifícalo para recuperar tu contraseña.');
          } else if (/no existe una cuenta/i.test(message)) {
            setAuthStep('request');
            setError(message);
          } else {
            setError(message || 'La verificación venció. Solicita una nueva.');
          }
          return;
        }
        setAuthMessage('Esperando que WhatsApp confirme el mensaje…');
      } finally {
        checking = false;
        if (!stopped) setVerifyingCode(false);
      }

      if (!stopped) timeout = setTimeout(checkStatus, 2500);
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        if (timeout) clearTimeout(timeout);
        void checkStatus();
      }
    };

    void checkStatus();
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      stopped = true;
      if (timeout) clearTimeout(timeout);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [isOpen, authStep, challengeId, authMode, apiBase]);

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
          ? authChannel === 'email' ? 'Verifica tu correo' : 'Confirma tu número por WhatsApp'
          : 'Crea tu contraseña',
      subtitle:
        authStep === 'details'
          ? 'Cuéntanos quién eres para empezar.'
          : authStep === 'contact'
            ? 'Elige dónde recibir tu código de verificación.'
            : authStep === 'verify'
              ? authChannel === 'email' ? `Ingresa el código enviado a ${maskedOtpEmail}.` : 'Envía el mensaje preparado desde el mismo teléfono.'
              : 'Elige una contraseña para tu cuenta.',
      cta: startingWhatsApp ? 'Preparando verificación...' : 'Continuar',
      submit: verifyingCode ? 'Creando cuenta...' : 'Crear cuenta',
    }
    : authMode === 'recovery'
    ? {
      title: authStep === 'verify' ? authChannel === 'email' ? 'Verifica tu correo' : 'Confirma tu número por WhatsApp' : 'Recuperar contraseña',
      subtitle: authStep === 'request'
        ? 'Elige dónde recibir tu código para recuperar la cuenta.'
        : authStep === 'verify'
          ? authChannel === 'email' ? `Ingresa el código enviado a ${maskedOtpEmail}.` : 'Envía el mensaje preparado desde ese mismo teléfono.'
          : 'Crea tu nueva contraseña.',
      cta: startingWhatsApp ? 'Preparando verificación...' : 'Continuar',
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
          <X className="h-5 w-5" strokeWidth={2.5} />
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
                              onClick={startEmailVerification}
                              disabled={startingWhatsApp || phone.length !== 10}
                              className="w-full rounded-2xl bg-[#0a0a0a] py-3.5 text-sm font-semibold text-white transition-all duration-200 hover:bg-[#262626] disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 active:scale-[0.98]"
                            >
                              {startingWhatsApp ? 'Preparando verificación...' : 'Enviar código por correo'}
                            </button>
                            <button
                              type="button"
                              onClick={startWhatsAppVerification}
                              disabled={startingWhatsApp || phone.length !== 10}
                              className="w-full rounded-2xl bg-[#128C7E] py-3.5 text-sm font-semibold text-white transition-all duration-200 hover:bg-[#0f7c70] disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 active:scale-[0.98]"
                            >
                              {startingWhatsApp ? 'Preparando verificación...' : 'Verificar por WhatsApp'}
                            </button>
                          </div>
                        </>
                      ) : authStep === 'verify' ? (
                        authChannel === 'email' ? (
                          <EmailOtpPanel
                            email={maskedOtpEmail}
                            code={otpCode}
                            mockCode={mockOtpCode}
                            countdown={countdown}
                            starting={startingWhatsApp}
                            verifying={verifyingCode}
                            onCodeChange={(value) => setOtpCode(value.replace(/\D/g, '').slice(0, 6))}
                            onRetry={startEmailVerification}
                            onVerify={verifyEmailCode}
                          />
                        ) : (
                          <WhatsAppChallengePanel
                            phone={phone}
                            whatsappUrl={whatsappUrl}
                            countdown={countdown}
                            starting={startingWhatsApp}
                            onRetry={startWhatsAppVerification}
                          />
                        )
                      ) : (
                        <div className="space-y-4">
                          <Field
                            label="Nueva contraseña"
                            value={password}
                            onChange={setPassword}
                            placeholder="Al menos 6 caracteres"
                            type="password"
                            autoComplete="new-password"
                          />
                          <Field
                            label="Confirmar contraseña"
                            value={confirmPassword}
                            onChange={setConfirmPassword}
                            placeholder="Repite tu contraseña"
                            type="password"
                            autoComplete="new-password"
                          />
                          {password && confirmPassword && password !== confirmPassword && (
                            <p className="text-[11px] font-semibold text-rose-500 px-1">Las contraseñas no coinciden.</p>
                          )}
                          <button
                            type="button"
                            onClick={handleResetPassword}
                            disabled={verifyingCode || password.length < 6 || password !== confirmPassword}
                            className="w-full rounded-2xl bg-[#0a0a0a] py-3.5 text-sm font-semibold text-[#ffffff] transition-all duration-200 hover:bg-[#262626] hover:shadow-[0_8px_24px_rgba(10,10,10,0.12)] disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 disabled:shadow-none active:scale-[0.98]"
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
                          <p className="-mt-2 px-1 text-[11px] leading-relaxed text-neutral-500">
                            Elige dónde recibir tu código de verificación.
                          </p>
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
                              onClick={startEmailVerification}
                              disabled={startingWhatsApp || !emailIsValid || phone.length !== 10}
                              className="w-full rounded-2xl bg-[#0a0a0a] py-3.5 text-sm font-semibold text-white transition-all duration-200 hover:bg-[#262626] disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 active:scale-[0.98]"
                            >
                              {startingWhatsApp ? 'Preparando verificación...' : 'Enviar código por correo'}
                            </button>
                            <button
                              type="button"
                              onClick={startWhatsAppVerification}
                              disabled={startingWhatsApp || !emailIsValid || phone.length !== 10}
                              className="w-full rounded-2xl bg-[#128C7E] py-3.5 text-sm font-semibold text-white transition-all duration-200 hover:bg-[#0f7c70] disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 active:scale-[0.98]"
                            >
                              {startingWhatsApp ? 'Preparando verificación...' : 'Verificar por WhatsApp'}
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
                            autoComplete="new-password"
                          />
                          <Field
                            label="Confirmar contraseña"
                            value={confirmPassword}
                            onChange={setConfirmPassword}
                            placeholder="Repite tu contraseña"
                            type="password"
                            autoComplete="new-password"
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
                        authChannel === 'email' ? (
                          <EmailOtpPanel
                            email={maskedOtpEmail}
                            code={otpCode}
                            mockCode={mockOtpCode}
                            countdown={countdown}
                            starting={startingWhatsApp}
                            verifying={verifyingCode}
                            onCodeChange={(value) => setOtpCode(value.replace(/\D/g, '').slice(0, 6))}
                            onRetry={startEmailVerification}
                            onVerify={verifyEmailCode}
                          />
                        ) : (
                          <WhatsAppChallengePanel
                            phone={phone}
                            whatsappUrl={whatsappUrl}
                            countdown={countdown}
                            starting={startingWhatsApp}
                            onRetry={startWhatsAppVerification}
                          />
                        )
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

function EmailOtpPanel({
  email,
  code,
  mockCode,
  countdown,
  starting,
  verifying,
  onCodeChange,
  onRetry,
  onVerify,
}: {
  email: string;
  code: string;
  mockCode: string;
  countdown: number;
  starting: boolean;
  verifying: boolean;
  onCodeChange: (value: string) => void;
  onRetry: () => void;
  onVerify: () => void;
}) {
  return (
    <div className="space-y-4" aria-live="polite">
      <div className="rounded-2xl border border-black/[0.04] bg-neutral-50/80 p-4">
        <p className="text-sm leading-relaxed text-neutral-700">
          Enviamos un código de 6 dígitos a <strong className="text-neutral-950">{email}</strong>.
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-neutral-500">El código vence en 5 minutos.</p>
      </div>

      <label className="grid gap-1.5 text-xs font-medium text-neutral-600">
        <span>Código de verificación</span>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          value={code}
          onChange={(event) => onCodeChange(event.target.value)}
          disabled={verifying}
          placeholder="123456"
          aria-label="Código de verificación de seis dígitos"
          className="h-12 w-full rounded-2xl border border-black/[0.08] bg-white px-4 text-center font-mono text-lg tracking-[0.35em] text-neutral-950 outline-none transition focus:border-black/20 focus:ring-2 focus:ring-black/[0.04] disabled:bg-neutral-50"
        />
      </label>

      {mockCode && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-center text-xs text-amber-800">
          Código de prueba: <strong className="font-mono tracking-widest">{mockCode}</strong>
        </p>
      )}

      <div className="flex items-center justify-center text-xs text-neutral-500">
        {countdown > 0 ? (
          <span>
            ¿No te llegó? Reenviar en <strong className="tabular-nums text-neutral-700">{formatCountdown(countdown)}</strong>
          </span>
        ) : (
          <button
            type="button"
            onClick={onRetry}
            disabled={starting}
            className="font-semibold text-sky-600 transition-colors hover:text-sky-700 disabled:text-neutral-400"
          >
            {starting ? 'Enviando...' : 'Volver a enviar código'}
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={onVerify}
        disabled={verifying || code.length !== 6}
        className="w-full rounded-2xl bg-[#0a0a0a] py-3.5 text-sm font-semibold text-white transition hover:bg-[#262626] disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400"
      >
        {verifying ? 'Verificando...' : 'Confirmar código'}
      </button>
    </div>
  );
}

function WhatsAppChallengePanel({
  phone,
  whatsappUrl,
  countdown,
  starting,
  onRetry,
}: {
  phone: string;
  whatsappUrl: string;
  countdown: number;
  starting: boolean;
  onRetry: () => void;
}) {
  const expired = countdown <= 0 || !whatsappUrl;

  return (
    <div className="space-y-4" aria-live="polite">
      <div className="rounded-2xl border border-black/[0.04] bg-neutral-50/80 p-4">
        <p className="text-sm leading-relaxed text-neutral-700">
          Confirma que tienes acceso al WhatsApp de{' '}
          <strong className="text-neutral-950">{formatPhoneNumber(phone)}</strong>.
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-neutral-500">
          Envía el mensaje que preparamos. Al volver aquí, continuaremos automáticamente.
        </p>
        {!expired && (
          <p className="mt-3 text-xs font-semibold text-neutral-600">
            El enlace vence en <span className="tabular-nums">{formatCountdown(countdown)}</span>.
          </p>
        )}
      </div>

      {!expired ? (
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full items-center justify-center rounded-2xl bg-[#128C7E] py-3.5 text-sm font-semibold text-white transition hover:bg-[#0f7c70] active:scale-[0.98]"
        >
          Abrir WhatsApp
        </a>
      ) : (
        <button
          type="button"
          onClick={onRetry}
          disabled={starting}
          className="w-full rounded-2xl bg-[#0a0a0a] py-3.5 text-sm font-semibold text-white transition hover:bg-[#262626] disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400"
        >
          {starting ? 'Preparando WhatsApp…' : 'Generar un nuevo enlace'}
        </button>
      )}

      <p className="text-center text-xs text-neutral-500">
        {expired ? 'El enlace anterior ya no está activo.' : 'Esperando la confirmación de WhatsApp…'}
      </p>
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
    <label className="grid gap-1.5 text-xs text-neutral-600 font-medium">
      <span>{label}</span>
      <div className="relative">
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
            tabIndex={-1}
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
  const latestMonth = safeYear === latestAllowed.year ? latestAllowed.month : 12;
  const safeMonth = clamp(month, 1, latestMonth);
  const latestDay = safeYear === latestAllowed.year && safeMonth === latestAllowed.month
    ? latestAllowed.day
    : daysInMonth(safeYear, safeMonth);
  const safeDay = clamp(day, 1, latestDay);
  const years = useMemo(
    () => Array.from({ length: latestAllowed.year - 1950 + 1 }, (_, i) => 1950 + i),
    [latestAllowed.year],
  );
  const months = useMemo(
    () => Array.from({ length: latestMonth }, (_, i) => i + 1),
    [latestMonth],
  );
  const days = useMemo(() => Array.from({ length: latestDay }, (_, i) => i + 1), [latestDay]);

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
