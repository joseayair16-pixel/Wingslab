'use client';

import { useCallback, useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, RefreshCw } from 'lucide-react';
import { getWingslabApiUrl, readStoredSession, requestJson } from '@sadel/shared';

type Qr = { code: string; expiresAt: string; ttlSeconds: number };

/** Short-lived, single-use code. The restaurant scans it to apply one stamp. */
export function LoyaltyQrPanel({ onClose }: { onClose: () => void }) {
  const [qr, setQr] = useState<Qr | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const refresh = useCallback(async () => {
    const session = readStoredSession('sadel.customer');
    if (!session?.token) { setError('Inicia sesión para mostrar tu código.'); setLoading(false); return; }
    setLoading(true); setError(''); setQr(null); setSeconds(0);
    try {
      const result = await requestJson<{ data: Qr }>({ apiBase: getWingslabApiUrl(), path: '/customer/lealtad/qr', token: session.token, options: { method: 'POST', body: '{}' }, retry: { attempts: 0 } });
      setQr(result.data);
      setSeconds(result.data.ttlSeconds);
      setCopied(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No pudimos generar tu código. Intenta de nuevo.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!qr) return;
    const timer = window.setInterval(() => {
      setSeconds(value => {
        if (value <= 1) { window.clearInterval(timer); void refresh(); return 0; }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [qr, refresh]);

  return <section className="wl-loyalty-qr" aria-label="Código para compras en el local">
    <div className="wl-loyalty-qr-head"><div><span className="wl-kicker">Compra en el local</span><h3>Muestra este código</h3><p>Pídele a WingsLab que lo escanee al cobrar tu compra.</p></div><button type="button" onClick={onClose} aria-label="Cerrar código">Cerrar</button></div>
    {loading && !qr ? <p role="status">Generando tu código…</p> : error && !qr ? <p role="alert">{error}</p> : qr ? <>
      <div className="wl-loyalty-qr-code"><QRCodeSVG value={qr.code} size={188} level="M" marginSize={1} bgColor="#ffffff" fgColor="#201914" /></div>
      <p className="wl-loyalty-qr-code-text">{qr.code}</p>
      <div className="wl-loyalty-qr-actions"><button type="button" onClick={() => void navigator.clipboard?.writeText(qr.code).then(() => setCopied(true)).catch(() => undefined)}><Copy size={15} />{copied ? 'Copiado' : 'Copiar código'}</button><button type="button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={15} />Nuevo código</button></div>
      <div className="wl-loyalty-qr-timer" role="status"><span className={seconds <= 15 ? 'is-urgent' : ''}>{seconds}s</span><small>Vence pronto. Se renueva automáticamente y solo sirve para una compra.</small></div>
    </> : null}
  </section>;
}
