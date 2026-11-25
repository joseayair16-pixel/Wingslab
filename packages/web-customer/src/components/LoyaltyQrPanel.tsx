'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Award, Copy, Gift, RefreshCw, X } from 'lucide-react';
import { ApiRequestError, getWingslabApiUrl, readStoredSession, requestJson } from '@sadel/shared';
import { LoyaltyCard } from '../../../shared/src/loyalty-card';

type Qr = { sessionId: string; code: string; ttlSeconds: number };
type ActiveQr = Qr & { deadline: number; customerUserId: string };
type Receipt = { stamps: number; goal: number; completed: boolean; rewardDelivered: boolean; rewardDescription: string; terms: string };
type QrStatus = { state: 'active' | 'expired' | 'invalidated' | 'voided' } | { state: 'applied'; receipt: Receipt };
type Props = { onClose: () => void; onRefresh: () => void; brand?: { name?: string; logo?: string | null }; fallbackLogoUrl: string };
const POLL_MS = 2500;

export function LoyaltyQrPanel({ onClose, onRefresh, brand, fallbackLogoUrl }: Props) {
  const [qr, setQr] = useState<ActiveQr | null>(null);
  const [status, setStatus] = useState<QrStatus | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const [syncError, setSyncError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const live = useRef(false);
  const issuing = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  const receiptHeading = useRef<HTMLHeadingElement>(null);
  onRefreshRef.current = onRefresh;

  const issue = useCallback(async () => {
    if (issuing.current) return;
    issuing.current = true;
    setQr(null);
    setStatus(null);
    setError('');
    setSyncError(false);
    setCopied(false);
    setLoading(true);
    try {
      const { token, user } = readStoredSession('sadel.customer');
      if (!token || !user?.id) throw new Error('Inicia sesión para mostrar tu código.');
      const startedAt = performance.now();
      const { data } = await requestJson<{ data: Qr }>({
        apiBase: getWingslabApiUrl(), path: '/customer/lealtad/qr', token,
        options: { method: 'POST', body: '{}' }, retry: { attempts: 0 },
        fallbackMessage: 'No pudimos generar tu código.',
      });
      if (!live.current) return;
      if (readStoredSession('sadel.customer').user?.id !== user.id) throw new Error('Tu sesión cambió. Genera otro código.');
      const deadline = startedAt + data.ttlSeconds * 1000;
      setQr({ ...data, deadline, customerUserId: user.id });
      setSeconds(Math.max(0, Math.ceil((deadline - performance.now()) / 1000)));
    } catch (reason) {
      if (live.current) setError(reason instanceof Error ? reason.message : 'No pudimos generar tu código.');
    } finally {
      issuing.current = false;
      if (live.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    live.current = true;
    void issue();
    return () => { live.current = false; };
  }, [issue]);

  useEffect(() => {
    if (!qr) return;
    const tick = () => setSeconds(Math.max(0, Math.ceil((qr.deadline - performance.now()) / 1000)));
    const timer = window.setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [qr]);

  useEffect(() => {
    if (!qr) return;
    let active = true;
    let inFlight = false;
    let controller: AbortController | undefined;
    let timer: number | undefined;
    let failures = 0;
    const poll = async () => {
      if (!active || inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      window.clearTimeout(timer);
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 6500);
      const stopForSessionChange = () => {
        active = false;
        setQr(null);
        setError('Tu sesión cambió. Genera otro código.');
      };
      try {
        const { token, user } = readStoredSession('sadel.customer');
        if (!token || user?.id !== qr.customerUserId) { stopForSessionChange(); return; }
        const { data } = await requestJson<{ data: QrStatus }>({
          apiBase: getWingslabApiUrl(), path: `/customer/lealtad/qr/${encodeURIComponent(qr.sessionId)}`, token,
          options: { signal: controller.signal }, timeoutMs: 6500, retry: { attempts: 0 },
        });
        if (!active) return;
        if (readStoredSession('sadel.customer').user?.id !== qr.customerUserId) { stopForSessionChange(); return; }
        failures = 0;
        setSyncError(false);
        if (data.state !== 'active') {
          active = false;
          setQr(null);
          setStatus(data);
          if (data.state === 'applied' || data.state === 'voided') onRefreshRef.current();
        }
      } catch (reason) {
        if (!active) return;
        if (reason instanceof ApiRequestError && (reason.status === 404 || reason.status === 401 || reason.status === 403)) {
          active = false;
          setQr(null);
          setError('Este código ya no está disponible.');
        } else {
          failures += 1;
          setSyncError(true);
        }
      } finally {
        window.clearTimeout(timeout);
        controller = undefined;
        inFlight = false;
        if (active) timer = window.setTimeout(poll, Math.min(12000, POLL_MS * (1 + failures)));
      }
    };
    const resume = () => { void poll(); };
    timer = window.setTimeout(poll, POLL_MS);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    return () => {
      active = false;
      window.clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
    };
  }, [qr]);

  useEffect(() => {
    if (status?.state === 'applied') receiptHeading.current?.focus();
  }, [status]);

  if (status?.state === 'applied') {
    const { receipt } = status;
    const remaining = Math.max(0, receipt.goal - receipt.stamps);
    return <section className="wl-loyalty-receipt" aria-labelledby="wl-loyalty-receipt-title">
      <header className="wl-loyalty-receipt-copy">
        <span className="wl-loyalty-receipt-icon">{receipt.completed ? <Gift aria-hidden="true" /> : <Award aria-hidden="true" />}</span>
        <h3 ref={receiptHeading} tabIndex={-1} id="wl-loyalty-receipt-title">{receipt.completed ? '¡Tarjeta completada!' : '¡Recibiste un sello!'}</h3>
        <p>{receipt.completed
          ? receipt.rewardDelivered ? `Recompensa entregada: ${receipt.rewardDescription}.` : `Ganaste ${receipt.rewardDescription}. Tu recompensa queda disponible.`
          : remaining === 1 ? 'Te falta 1 sello para tu recompensa.' : `Te faltan ${remaining} sellos para tu recompensa.`}</p>
        <small>Gracias por comprar en WingsLab.</small>
      </header>
      <LoyaltyCard logoUrl={brand?.logo || fallbackLogoUrl} fallbackLogoUrl={fallbackLogoUrl} name={brand?.name}
        goal={receipt.goal} stamps={receipt.stamps} reward={receipt.rewardDescription} animateStamp={receipt.stamps} />
      <button type="button" className="wl-primary-action" onClick={onClose}>{receipt.completed ? 'Ver mi nueva tarjeta' : 'Entendido'}</button>
    </section>;
  }

  return <section className="wl-loyalty-qr" aria-label="Código para compras en el local">
    <div className="wl-loyalty-qr-head">
      <div><span className="wl-kicker">Compra en el local</span><h3>Muestra tu QR</h3><p>En caja lo escanean para agregar un sello.</p></div>
      <button type="button" onClick={() => { onRefresh(); onClose(); }} aria-label="Cerrar código"><X size={18} aria-hidden="true" /></button>
    </div>
    {loading ? <p role="status">Generando tu código…</p> : qr && seconds > 0 ? <>
      <div className="wl-loyalty-qr-code"><QRCodeSVG value={qr.code} size={188} level="M" marginSize={4} bgColor="#ffffff" fgColor="#201914" /></div>
      <div className="wl-loyalty-qr-timer"><span className={seconds <= 15 ? 'is-urgent' : ''}>{seconds}s</span><small>Un solo uso. Esperando confirmación de la tienda.</small></div>
      <details className="wl-loyalty-qr-manual">
        <summary>Mostrar código manual</summary>
        <p className="wl-loyalty-qr-code-text">{qr.code}</p>
        <div className="wl-loyalty-qr-actions"><button type="button" onClick={() => void navigator.clipboard?.writeText(qr.code).then(() => setCopied(true)).catch(() => undefined)}><Copy size={15} aria-hidden="true" />{copied ? 'Copiado' : 'Copiar código'}</button></div>
      </details>
    </> : qr ? <p role="status">Comprobando si la tienda confirmó el sello…</p> : <>
      <p role={error ? 'alert' : 'status'}>{error || (status?.state === 'voided' ? 'La tienda anuló este sello.' : 'Este código ya venció o dejó de estar activo.')}</p>
      <div className="wl-loyalty-qr-actions"><button type="button" onClick={() => void issue()}><RefreshCw size={15} aria-hidden="true" />Generar otro código</button></div>
    </>}
    {syncError && qr && <p role="status" className="wl-loyalty-qr-sync">Sin conexión con WingsLab. Volveremos a comprobar el código al reconectar.</p>}
  </section>;
}
