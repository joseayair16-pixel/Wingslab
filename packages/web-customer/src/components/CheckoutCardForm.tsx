'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { ArrowRight, CreditCard, LoaderCircle, LockKeyhole, ShieldCheck } from 'lucide-react';
import type { SavedCard } from '../lib/savedCards';
import type { ConfirmedCardPayment } from '../lib/card-payment-result';

type CardFormData = {
  token?: string;
  paymentMethodId?: string;
  issuerId?: string;
  installments?: string;
  identificationType?: string;
  identificationNumber?: string;
  cardholderEmail?: string;
  savedCardId?: string;
};
type SecureField = {
  mount: (id: string) => void;
  unmount: () => void;
  on: (event: string, callback: (event: { bin?: string; errorMessages?: unknown[] }) => void) => void;
};
type PaymentMethod = { id: string; payment_type_id: string };
type MercadoPagoInstance = {
  fields: {
    create: (name: string, options: Record<string, unknown>) => SecureField;
    createCardToken: (data: { cardholderName: string; identificationType?: string; identificationNumber?: string } | { cardId: string }) => Promise<{ id?: string }>;
  };
  getPaymentMethods: (input: { bin: string }) => Promise<{ results: PaymentMethod[] }>;
  getIssuers: (input: { bin: string; paymentMethodId: string }) => Promise<Array<{ id: string | number; name: string }>>;
  getInstallments: (input: { bin: string; amount: string; paymentTypeId: string }) => Promise<Array<{ payment_method_id?: string; payer_costs?: Array<{ installments: number }> }>>;
};
declare global { interface Window { MercadoPago?: new (key: string, options?: Record<string, unknown>) => MercadoPagoInstance } }
let cachedSdk: { key: string; constructor: NonNullable<Window['MercadoPago']>; sdk: MercadoPagoInstance } | undefined;

type Props = {
  publicKey: string;
  apiBase: string;
  token: string;
  body: Record<string, unknown>;
  onVerified: (state: ConfirmedCardPayment) => void;
  onError: (message: string) => void;
  savedCard?: SavedCard | null;
};
type IntentStatus = { id: string; state: string; amountCents: number; expiresAt: string; declineReason?: string };
type PaymentNotice = { kind: 'DECLINED' | 'EXPIRED'; code?: string };

/** Safe, fixed copy. The provider's raw status_detail is never displayed or persisted here. */
const DECLINE_COPY: Record<string, { title: string; body: string; hint: string }> = {
  INSUFFICIENT_FUNDS: {
    title: 'Fondos insuficientes',
    body: 'El banco rechazó el cargo porque la tarjeta no tiene saldo disponible.',
    hint: 'Revisa el saldo o usa otra tarjeta antes de volver a intentarlo.',
  },
  INVALID_CVV: {
    title: 'Código de seguridad incorrecto',
    body: 'El código de seguridad (CVV) no coincide con el de tu tarjeta.',
    hint: 'Vuelve a capturar el CVV y confirma los datos del titular.',
  },
  EXPIRED_CARD: {
    title: 'Tarjeta vencida',
    body: 'La fecha de vencimiento de la tarjeta no es válida.',
    hint: 'Usa una tarjeta vigente para continuar.',
  },
  UNSUPPORTED_CARD: {
    title: 'Tarjeta no admitida',
    body: 'Esta tarjeta no es compatible con el pago en una sola exhibición.',
    hint: 'Prueba con otra tarjeta de crédito o débito.',
  },
  AUTHORIZATION_REQUIRED: {
    title: 'Se requiere autorización',
    body: 'El banco pidió una autorización adicional que no se completó.',
    hint: 'Autoriza el cargo con tu banco e inténtalo de nuevo.',
  },
  TOO_MANY_ATTEMPTS: {
    title: 'Demasiados intentos',
    body: 'Se alcanzó el límite de intentos con esta tarjeta.',
    hint: 'Espera unos minutos o usa otra tarjeta.',
  },
  SECURITY_REJECTED: {
    title: 'Rechazo de seguridad',
    body: 'El banco bloqueó la operación por sus políticas de seguridad.',
    hint: 'Contacta a tu banco o prueba con otra tarjeta.',
  },
  GENERIC: {
    title: 'Pago rechazado',
    body: 'La tarjeta no pudo ser aprobada por el banco emisor.',
    hint: 'Revisa los datos e inténtalo con otra tarjeta.',
  },
};
const declineCopy = (code?: string) => DECLINE_COPY[code ?? ''] ?? DECLINE_COPY.GENERIC;

const SDK = 'https://sdk.mercadopago.com/js/v2';
const fieldClass = 'min-h-12 w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-3 text-base text-neutral-900 outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white';
// Keep the provider iframe's host free of padding: its 100%-sized hit area must
// cover the whole visible control, especially on touch screens.
// The provider iframe is transparent and its text color is fixed below.
// Keep the host light in both themes so card text and the caret stay visible.
const secureFieldClass = 'relative isolate h-14 w-full overflow-hidden rounded-xl border border-neutral-200 bg-white transition focus-within:border-[var(--accent)] focus-within:ring-2 focus-within:ring-[var(--accent)]/20 dark:border-zinc-700 [&>iframe]:absolute [&>iframe]:inset-0 [&>iframe]:block [&>iframe]:h-full [&>iframe]:w-full [&>iframe]:border-0 [&>iframe]:pointer-events-auto';
const secureFieldStyle = {
  height: '100%',
  width: '100%',
  fontFamily: 'Arial, sans-serif',
  fontSize: '16px',
  paddingLeft: '14px',
  paddingRight: '14px',
  color: '#171717',
  'placeholder-color': '#737373',
};
const labelClass = 'mb-1.5 block text-xs font-semibold text-neutral-700 dark:text-zinc-300';

/** PAN, expiry and CVV stay inside the provider's individual Secure Fields. */
export default function CheckoutCardForm({ publicKey, apiBase, token, body, onVerified, onError, savedCard = null }: Props) {
  const selectedSavedCard = savedCard;
  const [sdkReady, setSdkReady] = useState(false);
  const [fieldsReady, setFieldsReady] = useState(false);
  const [mountFailed, setMountFailed] = useState(false);
  const [diagnostic, setDiagnostic] = useState('');
  const [mountAttempt, setMountAttempt] = useState(0);
  const [intent, setIntent] = useState<IntentStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [payerEmail, setPayerEmail] = useState('');
  const [message, setMessage] = useState('');
  const [challenge, setChallenge] = useState<{ intentId: string; url: string } | null>(null);
  const [paymentNotice, setPaymentNotice] = useState<PaymentNotice | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState(false);
  const tokenize = useRef<((form: HTMLFormElement) => Promise<void>) | null>(null);
  const [paymentReady, setPaymentReady] = useState(false);
  const [saveCard, setSaveCard] = useState(false);
  const saveCardRef = useRef(false);
  saveCardRef.current = saveCard;
  const [saveNotice, setSaveNotice] = useState('');
  const [issuers, setIssuers] = useState<Array<{ id: string | number; name: string }>>([]);
  const intentRef = useRef<IntentStatus | null>(null);
  const payerEmailRef = useRef('');
  const paymentTypes = useRef(new Map<string, string>());
  const callbacksRef = useRef({ onVerified, onError });
  const startedAutomatically = useRef(false);
  callbacksRef.current = { onVerified, onError };

  const request = useCallback(async (path: string, init?: RequestInit): Promise<any> => {
    const response = await fetch(`${apiBase}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...init?.headers },
      cache: 'no-store',
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      const error = new Error(result?.error?.message || 'No se pudo completar el pago.') as Error & { code?: string };
      error.code = result?.error?.code;
      throw error;
    }
    return result.data;
  }, [apiBase, token]);

  const showDecline = useCallback((code?: string) => {
    setPendingConfirmation(false);
    intentRef.current = null;
    setIntent(null);
    setChallenge(null);
    setMessage('');
    setPaymentNotice({ kind: 'DECLINED', code });
  }, []);

  const showExpired = useCallback(() => {
    setPendingConfirmation(false);
    intentRef.current = null;
    setIntent(null);
    setChallenge(null);
    setMessage('');
    setPaymentNotice({ kind: 'EXPIRED' });
  }, []);

  useEffect(() => {
    if (!challenge) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const deadline = Date.now() + 40 * 60_000;
    const check = async () => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        setPendingConfirmation(true);
        return;
      }
      try {
        const status = await request(`/me/checkout/card/intents/${challenge.intentId}`, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(Math.min(8000, remaining))]),
        });
        if (controller.signal.aborted) return;
        if (status.state === 'VERIFIED' || status.state === 'ORDER_CREATED') {
          callbacksRef.current.onVerified(status.state);
          return;
        }
        if (status.state === 'DECLINED') { showDecline(status.declineReason); return; }
        if (status.state === 'EXPIRED') { showExpired(); return; }
      } catch { /* A failed status read is not a declined payment. */ }
      if (controller.signal.aborted) return;
      timer = setTimeout(check, Math.max(0, Math.min(5000, deadline - Date.now())));
    };
    timer = setTimeout(check, 5000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [challenge, request, showDecline, showExpired]);

  const settle = useCallback(async (current: IntentStatus) => {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const status = await request(`/me/checkout/card/intents/${current.id}`, {
        signal: AbortSignal.timeout(Math.min(8000, Math.max(1, deadline - Date.now()))),
      }) as IntentStatus & { threeDsUrl?: string };
      if (status.threeDsUrl) { setPendingConfirmation(false); setChallenge({ intentId: current.id, url: status.threeDsUrl }); return; }
      if (status.state === 'VERIFIED' || status.state === 'ORDER_CREATED') { callbacksRef.current.onVerified(status.state); return; }
      if (status.state === 'DECLINED') { showDecline(status.declineReason); return; }
      if (status.state === 'EXPIRED') { showExpired(); return; }
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    setPendingConfirmation(true);
  }, [request, showDecline, showExpired]);

  const submitToken = useCallback(async (data: CardFormData) => {
    const current = intentRef.current;
    if (!current || !data?.token || (!data.savedCardId && (!data.paymentMethodId || !data.installments))) {
      setBusy(false);
      setMessage('Completa los datos de tarjeta requeridos por Mercado Pago.');
      return;
    }
    const cardType = data.savedCardId && savedCard
      ? savedCard.paymentMethod.type
      : paymentTypes.current.get(data.paymentMethodId ?? '');
    if (!data.savedCardId && cardType !== 'credit_card' && cardType !== 'debit_card') {
      setBusy(false);
      setMessage('Mercado Pago no pudo identificar el tipo de tarjeta. Verifica el número e inténtalo otra vez.');
      return;
    }
    setBusy(true);
    try {
      const result = await request(`/me/checkout/card/intents/${current.id}/charge`, {
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          cardToken: data.token,
          deviceId: (() => {
            const id = (window as Window & { MP_DEVICE_SESSION_ID?: string }).MP_DEVICE_SESSION_ID;
            return typeof id === 'string' && /^[\x21-\x7E]{1,512}$/.test(id) ? id : undefined;
          })(),
          installments: Number(data.installments || '1'),
          ...(data.savedCardId ? { savedCardId: data.savedCardId } : {
            payerEmail: payerEmailRef.current.trim(),
            identificationType: data.identificationType,
            identificationNumber: data.identificationNumber,
            paymentMethodId: data.paymentMethodId,
            cardType,
            issuerId: data.issuerId,
          }),
        }),
      }) as IntentStatus & { threeDsUrl?: string };
      if (result.threeDsUrl) { setChallenge({ intentId: current.id, url: result.threeDsUrl }); return; }
      if (result.state === 'VERIFIED' || result.state === 'ORDER_CREATED') { callbacksRef.current.onVerified(result.state); return; }
      if (result.state === 'DECLINED') { showDecline(result.declineReason); return; }
      if (result.state === 'EXPIRED') { showExpired(); return; }
      await settle(result);
    } catch (error) {
      // A lost response may follow a successful charge, even on network or 5xx
      // errors. Never offer another submission while the outcome is unknown.
      try {
        await settle(current);
      } catch {
        setPendingConfirmation(true);
      }
    } finally {
      setBusy(false);
    }
  }, [request, settle, showDecline, showExpired, savedCard]);

  useEffect(() => {
    if (!intent || !sdkReady || !window.MercadoPago) return;
    const MercadoPago = window.MercadoPago;
    let active = true;
    let failed = false;
    let revision = 0;
    let submitting = false;
    let method: PaymentMethod | undefined;
    const fields: SecureField[] = [];
    const ready = new Set<string>();
    setFieldsReady(false);
    setPaymentReady(false);
    setIssuers([]);
    paymentTypes.current.clear();
    setMountFailed(false);
    setDiagnostic('Cargando datos de Mercado Pago…');
    const fail = (message = 'Mercado Pago no pudo inicializar los campos seguros.') => {
      if (!active || failed) return;
      failed = true;
      window.clearTimeout(timeout);
      setFieldsReady(false);
      setMountFailed(true);
      setDiagnostic(message);
    };
    const timeout = window.setTimeout(fail, 12_000);
    try {
      if (cachedSdk?.key !== publicKey || cachedSdk.constructor !== MercadoPago) {
        cachedSdk = { key: publicKey, constructor: MercadoPago, sdk: new MercadoPago(publicKey, { locale: 'es-MX' }) };
      }
      const mp = cachedSdk.sdk;

      const invalidFields = new Set<string>();
      const fieldLabels: Record<string, string> = {
        cardNumber: 'número de tarjeta', expirationDate: 'vencimiento', securityCode: 'código de seguridad',
      };
      const requiredFields = selectedSavedCard
        ? [['securityCode', 'wl-mp-security-code', 'Código de seguridad']]
        : [
          ['cardNumber', 'wl-mp-card-number', 'Número de tarjeta'],
          ['expirationDate', 'wl-mp-expiration', 'MM/AA'],
          ['securityCode', 'wl-mp-security-code', 'CVV'],
        ];
      if (selectedSavedCard) {
        method = { id: selectedSavedCard.paymentMethod.id, payment_type_id: selectedSavedCard.paymentMethod.type };
        paymentTypes.current.set(method.id, method.payment_type_id);
      }
      for (const [name, id, placeholder] of requiredFields) {
        const field = mp.fields.create(name, { placeholder, style: secureFieldStyle });
        fields.push(field);
        field.on('validityChange', ({ errorMessages }) => {
          if (!active || failed || !Array.isArray(errorMessages)) return;
          if (errorMessages.length) invalidFields.add(name);
          else invalidFields.delete(name);
        });
        field.on('ready', () => {
          if (!active || failed) return;
          ready.add(name);
          if (ready.size === requiredFields.length) {
            window.clearTimeout(timeout);
            setFieldsReady(true);
            if (selectedSavedCard) setPaymentReady(true);
          }
        });
        if (name === 'cardNumber') field.on('binChange', ({ bin }) => {
          if (!active || failed) return;
          const lookup = ++revision;
          method = undefined;
          setPaymentReady(false);
          setIssuers([]);
          setMessage('');
          if (!bin) return;
          const current = () => active && !failed && lookup === revision;
          void (async () => {
            const { results } = await mp.getPaymentMethods({ bin });
            const candidate = results.find(item => ['credit_card', 'debit_card'].includes(item.payment_type_id));
            if (!candidate) throw new Error();
            const [banks, plans] = await Promise.all([
              mp.getIssuers({ bin, paymentMethodId: candidate.id }),
              mp.getInstallments({ bin, amount: (intent.amountCents / 100).toFixed(2), paymentTypeId: candidate.payment_type_id }),
            ]);
            if (!current()) return;
            if (!plans.some(plan => (!plan.payment_method_id || plan.payment_method_id === candidate.id) &&
              plan.payer_costs?.some(cost => Number(cost.installments) === 1))) {
              setMessage('Esta tarjeta no permite pagar en una sola exhibición. Prueba otra tarjeta.');
              return;
            }
            method = candidate;
            paymentTypes.current.set(candidate.id, candidate.payment_type_id);
            setIssuers(banks);
            setPaymentReady(true);
          })().catch(() => {
            if (current()) setMessage('No se pudieron consultar las opciones de esta tarjeta.');
          });
        });
        field.mount(id);
      }
      tokenize.current = async form => {
        if (!active || failed || ready.size !== requiredFields.length || !method || submitting) return;
        const showInvalidFields = () => {
          if (!invalidFields.size) return false;
          setMessage(`Revisa estos campos: ${[...invalidFields].map(name => fieldLabels[name]).join(', ')}.`);
          return true;
        };
        if (showInvalidFields()) return;
        const selection = method;
        const lookup = revision;
        const value = (name: string) => String(new FormData(form).get(name) ?? '').trim();
        const cardholderName = value('cardholderName');
        const identificationType = value('identificationType');
        const identificationNumber = value('identificationNumber');
        const shouldSaveCard = !selectedSavedCard && saveCardRef.current;
        if ((!selectedSavedCard && !cardholderName) || Boolean(identificationType) !== Boolean(identificationNumber)) {
          setMessage('Completa el nombre del titular y, si proporcionas identificación, captura ambos campos.');
          return;
        }
        const issuerId = value('issuerId') || undefined;
        submitting = true;
        setBusy(true);
        setMessage('');
        setSaveNotice('');
        try {
          const result = await mp.fields.createCardToken(selectedSavedCard
            ? { cardId: selectedSavedCard.id }
            : { cardholderName, ...(identificationType ? { identificationType, identificationNumber } : {}) }
          ).catch(() => null);
          if (!active || failed || lookup !== revision) return;
          if (!result?.id) {
            if (!showInvalidFields()) setMessage('Mercado Pago no pudo generar el token de la tarjeta. No se envió ningún cobro.');
            return;
          }
          if (selectedSavedCard) {
            await submitToken({ token: result.id, savedCardId: selectedSavedCard.id, installments: '1' });
          } else if (shouldSaveCard) {
            let saved: { id: string };
            try {
              const created = await request('/me/payment-methods/cards', {
                method: 'POST', body: JSON.stringify({ consent: true, cardToken: result.id }),
              }) as { id?: unknown };
              if (typeof created?.id !== 'string' || !created.id) throw new Error('invalid_saved_card');
              saved = { id: created.id };
            } catch {
              setSaveCard(false);
              setMessage('No pudimos confirmar el guardado de la tarjeta. Aún no se ha enviado ningún cobro. Vuelve al checkout y revisa la lista antes de intentarlo de nuevo.');
              return;
            }
            setSaveNotice('Tarjeta guardada en Mercado Pago.');
            try {
              const reusableToken = await mp.fields.createCardToken({ cardId: saved.id });
              if (!reusableToken?.id) throw new Error('No se pudo verificar el código de seguridad.');
              await submitToken({ token: reusableToken.id, savedCardId: saved.id, installments: '1' });
            } catch {
              setMessage('La tarjeta quedó guardada, pero no se pudo iniciar el pago. Vuelve al checkout y selecciónala para intentar de nuevo.');
            }
          } else {
            await submitToken({ token: result.id, paymentMethodId: selection.id, issuerId, installments: '1',
              identificationType: identificationType || undefined, identificationNumber: identificationNumber || undefined });
          }
        } catch {
          if (active) setMessage('No se pudo confirmar el pago. Revisa tus pedidos antes de volver a pagar.');
        } finally {
          submitting = false;
          if (active) setBusy(false);
        }
      };
    } catch {
      fail();
    }
    return () => {
      active = false;
      window.clearTimeout(timeout);
      tokenize.current = null;
      // Remove the primary field (card number) last so the SDK does not
      // promote other iframes while this checkout is being torn down.
      for (const field of fields.reverse()) {
        try { field.unmount(); } catch { /* An unsuccessful mount may already be unmounted. */ }
      }
    };
  }, [intent, publicKey, sdkReady, submitToken, mountAttempt, selectedSavedCard, request]);

  const start = useCallback(async () => {
    setBusy(true);
    setMessage('');
    try {
      const requestKey = crypto.randomUUID();
      const { paymentMethod: _ignored, ...reservationBody } = body;
      const created = await request('/me/checkout/card/intents', {
        method: 'POST', body: JSON.stringify({ ...reservationBody, requestKey }),
      }) as IntentStatus;
      intentRef.current = created;
      setIntent(created);
    } catch (error) {
      const text = error instanceof Error ? error.message : 'No se pudo iniciar el pago.';
      setMessage(text);
      callbacksRef.current.onError(text);
    } finally {
      setBusy(false);
    }
  }, [body, request]);

  useEffect(() => {
    if (!sdkReady || startedAutomatically.current) return;
    startedAutomatically.current = true;
    void start();
  }, [sdkReady, start]);

  return (
    <div>
      <Script src={SDK} strategy="afterInteractive" onReady={() => setSdkReady(true)} onError={() => setMessage('No se pudo cargar Mercado Pago. Recarga la página para volver a intentarlo.')} />
      {sdkReady && process.env.NEXT_PUBLIC_WINGSLAB_MP_SANDBOX === 'true' && (
        <Script src="https://www.mercadopago.com/v2/security.js" {...{ view: 'checkout' }} strategy="afterInteractive" />
      )}
      {intent && <div className="relative mb-4 overflow-hidden rounded-[22px] bg-gradient-to-br from-[#df080e] via-[#b6080d] to-[#85080c] px-5 py-6 text-white shadow-[0_8px_24px_rgba(150,0,0,0.16)]">
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-10 -right-5 h-28 w-40 rotate-[-20deg] rounded-2xl border border-white/20 bg-gradient-to-br from-red-400/50 to-red-950/40 shadow-xl"><span className="absolute left-5 top-6 h-5 w-7 rounded bg-amber-200/80" /></div>
        <div className="relative z-10 pr-16">
        <p className="text-sm font-semibold text-white/90">Total a pagar</p>
        <p className="mt-1 flex flex-wrap items-baseline gap-2"><strong className="text-3xl font-extrabold tracking-tight tabular-nums sm:text-4xl">{new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(intent.amountCents / 100)}</strong><span className="text-sm font-bold text-white/90">MXN</span></p>
        <p className="mt-2 text-sm text-white/85">Un solo pago</p>
        </div>
      </div>}
      <div className="rounded-[22px] border border-neutral-200/80 bg-white p-4 shadow-[0_6px_24px_rgba(0,0,0,0.06)] dark:border-white/10 dark:bg-zinc-900 sm:p-5">
      {intent ? (
        <form id="wl-mp-card-form" hidden={Boolean(challenge)} className="space-y-4" onSubmit={event => { event.preventDefault(); if (!challenge) void tokenize.current?.(event.currentTarget); }}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex min-w-0 items-center gap-2 text-base font-bold tracking-tight text-neutral-900 dark:text-white"><CreditCard className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />{savedCard ? 'Tarjeta guardada' : 'Datos de la tarjeta'}</h2>
            <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-red-700 dark:text-red-400"><ShieldCheck className="h-4 w-4" aria-hidden="true" /> Pago seguro</span>
          </div>
          {savedCard ? (
            <div className="flex items-center gap-3 rounded-2xl border border-[var(--accent)]/30 bg-[var(--accent)]/[0.05] p-3.5">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent)] text-white"><CreditCard className="h-5 w-5" aria-hidden="true" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-neutral-900 dark:text-white">{savedCard.paymentMethod.name} •••• {savedCard.lastFourDigits}</p>
                <p className="mt-0.5 text-xs text-neutral-500 dark:text-zinc-400">{savedCard.expirationMonth && savedCard.expirationYear ? `Vence ${String(savedCard.expirationMonth).padStart(2, '0')}/${String(savedCard.expirationYear).slice(-2)}` : 'Tarjeta guardada en Mercado Pago'}</p>
              </div>
            </div>
          ) : (
            <>
              <div><span id="wl-mp-card-number-label" className={labelClass}>Número de tarjeta</span><div id="wl-mp-card-number" aria-labelledby="wl-mp-card-number-label" className={secureFieldClass} /></div>
            </>
          )}
          <div className={savedCard ? undefined : 'grid grid-cols-2 gap-3'}>
          {!savedCard && <div><span id="wl-mp-expiration-label" className={labelClass}>Vencimiento</span><div id="wl-mp-expiration" aria-labelledby="wl-mp-expiration-label" className={secureFieldClass} /></div>}
          <div>
            <span id="wl-mp-security-label" className={labelClass}>CVV <span className="sr-only">(código de seguridad)</span></span>
            <div id="wl-mp-security-code" aria-labelledby="wl-mp-security-label" className={secureFieldClass} />
          </div>
          </div>
          {!savedCard && <>
            <div><label htmlFor="wl-mp-cardholder" className={labelClass}>Nombre del titular</label><input id="wl-mp-cardholder" name="cardholderName" autoComplete="cc-name" placeholder="Como aparece en la tarjeta" required className={fieldClass} /></div>
            {issuers.length > 0 && <div><label htmlFor="wl-mp-issuer" className={labelClass}>Banco emisor</label><select key={issuers.map(issuer => issuer.id).join(',')} id="wl-mp-issuer" name="issuerId" className={fieldClass}>{issuers.map(issuer => <option key={issuer.id} value={issuer.id}>{issuer.name}</option>)}</select></div>}
            <div><label htmlFor="wl-mp-email" className={labelClass}>Correo electrónico</label><input id="wl-mp-email" type="email" value={payerEmail} onChange={event => { payerEmailRef.current = event.target.value; setPayerEmail(event.target.value); }} autoComplete="email" placeholder="tu@correo.com" required className={fieldClass} /></div>
            <label className="flex min-h-16 cursor-pointer items-center gap-3 rounded-2xl bg-red-50 p-3.5 dark:bg-red-950/30">
              <input type="checkbox" checked={saveCard} disabled={busy} onChange={event => setSaveCard(event.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]" />
              <span>
                <span className="block text-sm font-semibold text-neutral-900 dark:text-white">Guardar tarjeta</span>
                <span className="block text-xs text-neutral-500 dark:text-zinc-400">Para mi próxima compra</span>
              </span>
            </label>
          </>}
          {!fieldsReady && <p role="status" className="text-sm">{mountFailed ? `Mercado Pago no pudo activar los campos seguros. ${diagnostic}` : diagnostic}</p>}
          {mountFailed && <button type="button" className="min-h-11 text-sm font-semibold underline" onClick={() => setMountAttempt(value => value + 1)}>Volver a cargar los campos</button>}
          {saveNotice && <p role="status" className="text-xs font-medium text-emerald-700 dark:text-emerald-300">{saveNotice}</p>}
          <button type="submit" disabled={busy || pendingConfirmation || !fieldsReady || !paymentReady} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#dc080e] to-[#a9080d] px-4 text-sm font-bold text-white shadow-sm transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 disabled:opacity-50">
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {busy ? 'Procesando…' : 'Pagar de forma segura'}
          </button>
        </form>
      ) : (
        <button type="button" onClick={start} disabled={busy || !sdkReady} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 text-sm font-bold text-white shadow-sm transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-50">
          {busy ? <><LoaderCircle className="h-4 w-4 animate-spin" /> Preparando pago…</> : <>Preparar datos de pago <ArrowRight className="h-4 w-4" aria-hidden="true" /></>}
        </button>
      )}
      {challenge && <section aria-label="Autenticación del pago" className="space-y-3">
        <p role="status" className="text-sm">Completa la verificación para continuar. No vuelvas a enviar el pago.</p>
        <iframe src={challenge.url} title="Verificación de tarjeta de Mercado Pago" referrerPolicy="no-referrer" className="h-[500px] w-full rounded-xl border" />
      </section>}
      {message && <p role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-medium leading-relaxed text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">{message}</p>}
      <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-neutral-500 dark:text-zinc-400"><LockKeyhole className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> Pago protegido por Mercado Pago</p>
      {paymentNotice && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 px-4 py-6 backdrop-blur-sm">
          <section role="dialog" aria-modal="true" aria-labelledby="wl-card-notice-title" aria-describedby="wl-card-notice-body" className="w-full max-w-sm rounded-[24px] bg-white p-6 shadow-2xl dark:bg-zinc-900">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300">
              <CreditCard className="h-7 w-7" strokeWidth={1.7} aria-hidden="true" />
            </div>
            <h4 id="wl-card-notice-title" className="text-center text-lg font-bold tracking-tight text-neutral-900 dark:text-white">
              {paymentNotice.kind === 'EXPIRED' ? 'Tiempo de pago agotado' : declineCopy(paymentNotice.code).title}
            </h4>
            <p id="wl-card-notice-body" className="mt-3 text-center text-sm leading-relaxed text-neutral-600 dark:text-zinc-300">
              {paymentNotice.kind === 'EXPIRED'
                ? 'El tiempo para completar el pago terminó. Vuelve al checkout para iniciar uno nuevo.'
                : declineCopy(paymentNotice.code).body}
            </p>
            <p className="mt-2 text-center text-xs leading-relaxed text-neutral-500 dark:text-zinc-400">
              {paymentNotice.kind === 'EXPIRED'
                ? 'No se realizó ningún cobro.'
                : declineCopy(paymentNotice.code).hint}
            </p>
            <button type="button" onClick={() => setPaymentNotice(null)} className="mt-6 w-full rounded-full bg-[var(--accent)] px-4 py-3.5 text-sm font-bold text-white transition active:scale-[0.98]">
              Entendido
            </button>
            <p className="mt-3 text-center text-[11px] leading-relaxed text-neutral-500 dark:text-zinc-400">
              Revisa tus pedidos antes de volver a pagar. No se realizó ningún cobro.
            </p>
          </section>
        </div>
      )}
      {pendingConfirmation && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 px-4 py-6 backdrop-blur-sm">
          <section role="dialog" aria-modal="true" aria-labelledby="wl-card-pending-title" aria-describedby="wl-card-pending-body" className="w-full max-w-sm rounded-[24px] bg-white p-6 text-center shadow-2xl dark:bg-zinc-900">
            <LoaderCircle className="mx-auto h-10 w-10 text-amber-600" aria-hidden="true" />
            <h2 id="wl-card-pending-title" className="mt-4 text-lg font-bold text-neutral-900 dark:text-white">Estamos verificando tu pago</h2>
            <p id="wl-card-pending-body" className="mt-3 text-sm leading-6 text-neutral-600 dark:text-zinc-300">Todavía no podemos confirmar el resultado. No vuelvas a pagar: consulta el estado de este intento o revisa Mis pedidos más tarde.</p>
            <button type="button" autoFocus disabled={busy} onClick={() => {
              const current = intentRef.current;
              if (!current) return;
              setBusy(true);
              void settle(current).catch(() => setPendingConfirmation(true)).finally(() => setBusy(false));
            }} className="mt-6 min-h-12 w-full rounded-full bg-neutral-900 px-4 text-sm font-bold text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900">
              {busy ? 'Consultando…' : 'Consultar estado'}
            </button>
          </section>
        </div>
      )}
      </div>
    </div>
  );
}
