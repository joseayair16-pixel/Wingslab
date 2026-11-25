'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Award, Check, Gift, ScanLine, X } from 'lucide-react';
import { ApiRequestError, getRequestErrorMessage, requestJson } from '@sadel/shared';
import { SectionHeader } from '../SectionHeader';

type Preview = {
  customerName: string;
  stamps: number;
  goal: number;
  completesCard: boolean;
  previewKey: string;
  rewardDescription: string;
  rewardKind: 'AMOUNT' | 'PERCENT' | 'PRODUCT';
  rewardValue: number | null;
  rewardBlockedReason: string | null;
};
type Receipt = { stamps: number; goal: number; completed: boolean; rewardDelivered: boolean; rewardDescription: string };
type Confirmation = {
  kind: 'stamp' | 'completed' | 'delivered';
  title: string;
  description: string;
  stamps?: number;
  goal?: number;
  rewardDescription?: string;
};
type Visit = {
  id: string; amountCents: number; totalCents: number | null; paymentMethod: string | null;
  items: Array<{ quantity: number; name: string }>; rewardAppliedCents: number; rewardDescription: string | null;
  customerName: string; voidedAt: string | null; createdAt: string;
};
type Detector = new (options: { formats: string[] }) => { detect: (video: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>> };

const localMoney = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const visitDate = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
const expiryCodes = ['LOYALTY_CODE_INVALID', 'VISIT_ALREADY_VOIDED', 'LOYALTY_PREVIEW_CHANGED', 'LOYALTY_PROGRAM_OFF'];
const isSale = (visit: Visit) => !!visit.paymentMethod || visit.totalCents !== null || visit.amountCents > 0;

export function InPersonSalesSection({ apiBase, token }: { apiBase: string; token: string }) {
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [retryChoice, setRetryChoice] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [historyError, setHistoryError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [showScanner, setShowScanner] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const flight = useRef(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const call = useCallback(<T,>(path: string, options?: RequestInit) => requestJson<{ data: T }>({
    apiBase, token, path, options, retry: { attempts: 0 }, fallbackMessage: 'No se pudo completar la operación.',
  }), [apiBase, token]);

  useEffect(() => {
    let active = true;
    void call<Visit[]>('/restaurant-panel/lealtad/visitas?limit=20')
      .then(({ data }) => { if (active) { setVisits(data); setHistoryError(false); } })
      .catch(() => { if (active) setHistoryError(true); });
    return () => { active = false; };
  }, [call, revision]);

  const verify = useCallback(async (rawCode: string) => {
    if (flight.current) return;
    const scanned = rawCode.trim();
    if (!/^[\w-]{6,32}$/.test(scanned)) {
      setError('No es un código de fidelidad válido. Pide al cliente su código de WingsLab.');
      return;
    }
    flight.current = true;
    setShowScanner(false);
    setCode(scanned);
    setPreview(null);
    setRetryChoice(null);
    setBusy(true);
    setError('');
    setNotice('');
    setConfirmation(null);
    try {
      const { data } = await call<Preview>('/restaurant-panel/lealtad/verificar', {
        method: 'POST', body: JSON.stringify({ code: scanned }),
      });
      setPreview(data);
    } catch (reason) {
      setError(getRequestErrorMessage(reason, 'No se pudo verificar el código.'));
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }, [call]);

  useEffect(() => {
    if (preview) confirmRef.current?.focus();
  }, [preview]);

  useEffect(() => {
    if (!confirmation) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setConfirmation(null); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [confirmation]);

  async function confirm(deliverReward: boolean) {
    if (!preview || flight.current || (retryChoice !== null && retryChoice !== deliverReward)) return;
    flight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { data } = await call<Receipt>('/restaurant-panel/lealtad/sellos', {
        method: 'POST', body: JSON.stringify({ code, previewKey: preview.previewKey, deliverReward }),
      });
      setConfirmation(data.rewardDelivered
        ? { kind: 'delivered', title: 'Recompensa entregada', description: 'La tarjeta se completó y entregaste el premio.', rewardDescription: data.rewardDescription, stamps: data.stamps, goal: data.goal }
        : data.completed
          ? { kind: 'completed', title: 'Tarjeta completada', description: 'El premio quedó disponible para entregarlo después.', rewardDescription: data.rewardDescription, stamps: data.stamps, goal: data.goal }
          : { kind: 'stamp', title: 'Sello agregado', description: 'El cliente ya puede verlo en su tarjeta.', stamps: data.stamps, goal: data.goal });
      setPreview(null);
      setCode('');
      setRetryChoice(null);
      setRevision(value => value + 1);
    } catch (reason) {
      setError(getRequestErrorMessage(reason, 'No se pudo confirmar el sello.'));
      if (reason instanceof ApiRequestError && expiryCodes.includes(reason.code ?? '')) {
        setPreview(null);
        setRetryChoice(null);
      } else if (reason instanceof ApiRequestError && ['LOYALTY_GIFT_UNAVAILABLE', 'LOYALTY_REWARD_UNAVAILABLE'].includes(reason.code ?? '')) {
        setRetryChoice(null);
        setPreview({ ...preview, rewardBlockedReason: reason.message });
      } else if (retryChoice !== null || !(reason instanceof ApiRequestError) || reason.status == null || reason.status >= 500 || reason.kind === 'network' || reason.kind === 'timeout') {
        // If the response was lost, replay exactly the same decision for this QR.
        setRetryChoice(deliverReward);
        setRevision(value => value + 1);
      }
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }

  async function voidVisit(visit: Visit) {
    if (flight.current || retryChoice !== null) return;
    const sale = isSale(visit);
    if (!window.confirm(sale
      ? '¿Anular esta venta? Se revertirán el sello, la recompensa y las existencias afectadas. El reembolso se gestiona por separado.'
      : '¿Anular este sello? También se revertirá la recompensa registrada, si corresponde.')) return;
    flight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await call(`/restaurant-panel/lealtad/visitas/${encodeURIComponent(visit.id)}/anular`, { method: 'POST', body: '{}' });
      setNotice(sale ? 'Venta anulada.' : 'Sello anulado.');
      setRevision(value => value + 1);
    } catch (reason) {
      setError(getRequestErrorMessage(reason, 'No se pudo anular el registro.'));
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!showScanner) return;
    const BarcodeDetector = (window as Window & { BarcodeDetector?: Detector }).BarcodeDetector;
    if (!BarcodeDetector || !navigator.mediaDevices?.getUserMedia) {
      setError('La cámara para escanear no está disponible en este navegador. Usa el código manual.');
      setShowScanner(false);
      return;
    }
    let active = true;
    let stream: MediaStream | undefined;
    let frame = 0;
    const video = videoRef.current;
    if (!video) return;
    void (async () => {
      try {
        const detector = new BarcodeDetector({ formats: ['qr_code'] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!active) { stream.getTracks().forEach(track => track.stop()); return; }
        video.srcObject = stream;
        await video.play();
        let lastScan = 0;
        const scan = async (now: number) => {
          if (!active) return;
          if (now - lastScan >= 150 && video.readyState >= 2) {
            lastScan = now;
            const codes = await detector.detect(video).catch(() => []);
            if (!active) return;
            if (codes[0]?.rawValue) {
              setShowScanner(false);
              void verify(codes[0].rawValue);
              return;
            }
          }
          frame = requestAnimationFrame(scan);
        };
        if (active) frame = requestAnimationFrame(scan);
      } catch {
        if (active) {
          setError('No pudimos abrir la cámara. Usa el código manual.');
          setShowScanner(false);
        }
      }
    })();
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach(track => track.stop());
      video.srcObject = null;
    };
  }, [showScanner, verify]);

  return <section className="wl-campaigns wl-inperson" aria-labelledby="inperson-title">
    <SectionHeader title="Ventas en el local" titleId="inperson-title" icon={<Award />} />
    {error && <p role="alert" className="wl-campaign-feedback is-error">{error}</p>}
    {notice && <p role="status" className="wl-campaign-feedback">{notice}</p>}
    <div className="wl-inperson-grid">
      <div className="wl-campaign-card wl-inperson-main">
        <h2>Sellos en el local</h2>
        <p className="wl-loyalty-help">Escanea el QR del cliente después de su compra.</p>
        <form className="wl-inperson-code" onSubmit={event => { event.preventDefault(); void verify(code); }}>
          <button type="button" className="wl-menu-action" disabled={busy || retryChoice !== null} onClick={() => {
            setError('');
            if (!showScanner) { setPreview(null); setCode(''); setNotice(''); setConfirmation(null); }
            setShowScanner(!showScanner);
          }}>
            <ScanLine aria-hidden="true" />{showScanner ? 'Cerrar cámara' : 'Escanear QR'}
          </button>
          <input value={code} disabled={busy || retryChoice !== null} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={32}
            onChange={event => { setPreview(null); setCode(event.target.value); setError(''); }}
            placeholder="Ingresar código manual" aria-label="Código de fidelidad" />
          <button type="submit" className="wl-campaign-button is-primary" disabled={busy || !code.trim() || retryChoice !== null}>Verificar</button>
        </form>
        {showScanner && <video ref={videoRef} className="wl-inperson-scanner" playsInline muted aria-label="Cámara para escanear el código" />}
        {preview && <div className="wl-inperson-preview">
          <div className="wl-inperson-person">
            <span className="wl-customers-avatar" aria-hidden="true">{preview.customerName.slice(0, 1).toUpperCase()}</span>
            <div><h3>{preview.customerName}</h3><p>{preview.stamps} de {preview.goal} sellos</p></div>
          </div>
          <progress className="wl-inperson-progress" value={preview.stamps} max={preview.goal} aria-label="Progreso de la tarjeta" />
          <div className="wl-inperson-reward" data-final={preview.completesCard}>
            <Gift size={18} aria-hidden="true" />
            <div>
              <small>{preview.completesCard ? 'Último sello · compra con recompensa' : 'Recompensa de esta tarjeta'}</small>
              <strong>{preview.rewardDescription}</strong>
              {preview.completesCard && preview.rewardKind !== 'PRODUCT' && preview.rewardValue != null && (
                <small>Aplica {preview.rewardKind === 'PERCENT' ? `${preview.rewardValue}%` : localMoney.format(preview.rewardValue / 100)} de descuento en caja antes de confirmar la entrega.</small>
              )}
              {preview.rewardBlockedReason && <small>{preview.rewardBlockedReason}</small>}
            </div>
          </div>
          <div className="wl-inperson-confirm">
            {retryChoice !== null ? (
              <>
                <button ref={confirmRef} type="button" className="wl-campaign-button is-primary" disabled={busy} onClick={() => void confirm(retryChoice)}>Reintentar confirmación</button>
                <button type="button" className="wl-menu-action" disabled={busy} onClick={() => {
                  setPreview(null); setCode(''); setRetryChoice(null); setError('');
                  setNotice('Revisa la actividad reciente antes de usar otro QR para esta compra.');
                  setRevision(value => value + 1);
                }}>Salir y revisar actividad</button>
              </>
            ) : preview.completesCard && !preview.rewardBlockedReason ? <>
              <button ref={confirmRef} type="button" className="wl-campaign-button is-primary" disabled={busy} onClick={() => void confirm(true)}>
                <Gift size={16} aria-hidden="true" />{busy ? 'Registrando…' : 'Confirmar entrega y sellar'}
              </button>
              <button type="button" className="wl-menu-action" disabled={busy} onClick={() => void confirm(false)}>Solo agregar sello</button>
            </> : (
              <button ref={confirmRef} type="button" className="wl-campaign-button is-primary" disabled={busy} onClick={() => void confirm(false)}>
                <Check size={16} aria-hidden="true" />{busy ? 'Registrando…' : 'Agregar sello'}
              </button>
            )}
          </div>
        </div>}
      </div>
      <aside className="wl-campaign-card wl-inperson-guide">
        <div className="wl-campaign-preview-title"><Award aria-hidden="true" /><h2>Un QR, un sello</h2></div>
        <ol><li>Escanea o verifica el código.</li><li>Confirma el sello. Si completa la tarjeta, verifica la recompensa antes de entregarla.</li></ol>
      </aside>
    </div>
    <div className="wl-campaign-card wl-inperson-history">
      <h2>Actividad reciente</h2>
      {historyError && <p role="status" className="wl-loyalty-help">No se pudo actualizar el historial. <button type="button" className="underline" onClick={() => setRevision(value => value + 1)}>Reintentar</button></p>}
      {!visits.length && !historyError && <p className="wl-campaign-empty">Aún no se registran sellos en el local.</p>}
      {!!visits.length && <div className="wl-inperson-list">{visits.map(visit => (
        <article key={visit.id} className={visit.voidedAt ? 'is-voided' : ''}>
          <div><strong>{visit.customerName}</strong><small>{visitDate.format(new Date(visit.createdAt))}
            {isSale(visit) ? ` · ${visit.items.map(item => `${item.quantity}× ${item.name}`).join(', ') || 'Venta'} · ${localMoney.format((visit.totalCents ?? visit.amountCents - visit.rewardAppliedCents) / 100)}` : ' · Sello en tienda'}</small></div>
          <span>{visit.voidedAt ? 'Anulado' : visit.rewardDescription || 'Sello registrado'}</span>
          <button type="button" className="wl-menu-action" disabled={busy || retryChoice !== null || !!visit.voidedAt} onClick={() => void voidVisit(visit)}><X aria-hidden="true" />Anular</button>
        </article>
      ))}</div>}
    </div>

    {confirmation && <div className="wl-inperson-success-overlay" onClick={() => setConfirmation(null)}>
      <section role="dialog" aria-modal="true" aria-labelledby="wl-inperson-success-title" className="wl-inperson-success-card" onClick={event => event.stopPropagation()}>
        <button type="button" autoFocus className="wl-inperson-success-close" aria-label="Cerrar confirmación" onClick={() => setConfirmation(null)}><X aria-hidden="true" /></button>
        <span className={`wl-inperson-success-icon is-${confirmation.kind}`}>{confirmation.kind === 'stamp' ? <Check aria-hidden="true" /> : <Gift aria-hidden="true" />}</span>
        <span className="wl-kicker">Fidelidad · compra en el local</span>
        <h2 id="wl-inperson-success-title">{confirmation.title}</h2>
        <p>{confirmation.description}</p>
        {!!confirmation.goal && <div className="wl-inperson-success-progress">
          <div className="wl-inperson-success-progress-top"><strong>Sellos de tu cliente</strong><span>{confirmation.stamps} / {confirmation.goal}</span></div>
          <div className="wl-inperson-success-track" role="progressbar" aria-label="Sellos de la tarjeta" aria-valuemin={0} aria-valuemax={confirmation.goal} aria-valuenow={confirmation.stamps}><span style={{ width: `${Math.min(100, (confirmation.stamps! / confirmation.goal) * 100)}%` }} /></div>
        </div>}
        {confirmation.rewardDescription && <p className="wl-inperson-success-reward"><Gift aria-hidden="true" />{confirmation.rewardDescription}</p>}
        <button type="button" className="wl-campaign-button is-primary" onClick={() => setConfirmation(null)}>Entendido</button>
      </section>
    </div>}
  </section>;
}
