'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Award, Check, CircleAlert, Plus, ScanLine, ShieldCheck, Trash2, X } from 'lucide-react';
import { getRequestErrorMessage, requestJson } from '@sadel/shared';

type Option = { id: string; name: string; price: number; isAvailable: boolean };
type OptionGroup = { id: string; name: string; minSelection: number; maxSelection: number; options: Option[] };
type Product = { id: string; name: string; price: number; discountPrice: number | null; promoType: string | null; promoBuyQuantity: number | null; promoPayQuantity: number | null; sellBy: string; unitPrice: number | null; minWeightG: number | null; maxWeightG: number | null; stepWeightG: number | null; trackStock: boolean; stock: number; optionGroups: OptionGroup[]; category?: { name: string } };
type CartLine = { key: number; productId: string; quantity: number; weightG?: number; optionIds: string[] };
type Preview = { customerName: string; stamps: number; goal: number; availableRewards: number; reserved: boolean; rewardDescription: string; eligibleForReward: boolean };
type Quote = { customerName: string; items: Array<{ productId: string; name: string; quantity: number; subtotalCents: number; weightG: number | null; options: Array<{ name: string }> }>; subtotalCents: number; totalCents: number; rewardAppliedCents: number; rewardDescription: string | null; rewardEligible: boolean; rewardUnavailableReason: string | null; rewardApplied: boolean; hasPromotion: boolean; stamps: number; goal: number; availableRewards: number; reserved: boolean };
type Visit = { id: string; amountCents: number; totalCents: number | null; paymentMethod: string | null; items: Array<{ productId: string; name: string; quantity: number; subtotalCents: number }>; rewardAppliedCents: number; rewardDescription: string | null; customerName: string; voidedAt: string | null; createdAt: string };
const money = (cents: number) => `$${(cents / 100).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function InPersonSalesSection({ apiBase, token }: { apiBase: string; token: string }) {
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [catalogError, setCatalogError] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [weightG, setWeightG] = useState(100);
  const [optionIds, setOptionIds] = useState<string[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [applyReward, setApplyReward] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CARD' | 'TRANSFER' | 'OTHER'>('CASH');
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [visits, setVisits] = useState<Visit[]>([]);
  const [version, setVersion] = useState(0);
  const [showScanner, setShowScanner] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lineKey = useRef(0);

  const call = useCallback(<T,>(path: string, options?: RequestInit) => requestJson<{ data: T }>({ apiBase, token, path, options, retry: { attempts: 0 }, fallbackMessage: 'No se pudo completar la operación.' }), [apiBase, token]);
  const loadVisits = useCallback(() => {
    void call<Visit[]>('/restaurant-panel/lealtad/visitas?limit=20').then(result => setVisits(result.data)).catch(() => setVisits([]));
  }, [call]);
  useEffect(() => { loadVisits(); }, [loadVisits, version]);
  useEffect(() => {
    let alive = true;
    void call<Product[]>('/restaurant-panel/lealtad/catalogo-local').then(result => {
      if (!alive) return;
      setCatalog(result.data);
      setSelectedProductId(result.data[0]?.id || '');
    }).catch(reason => { if (alive) setCatalogError(getRequestErrorMessage(reason, 'No se pudo cargar el menú.')); });
    return () => { alive = false; };
  }, [call]);

  const selectedProduct = catalog.find(product => product.id === selectedProductId);
  const saleItems = cart.map(({ productId, quantity: qty, weightG: grams, optionIds: options }) => ({ productId, quantity: qty, ...(grams ? { weightG: grams } : {}), optionIds: options }));
  const resetQuote = () => { setQuote(null); setPaymentConfirmed(false); };
  const verify = async () => {
    if (!code.trim() || busy) return;
    setShowScanner(false);
    streamRef.current?.getTracks().forEach(track => track.stop());
    setBusy(true); setError(''); setNotice(''); setPreview(null); setQuote(null); setPaymentConfirmed(false);
    try {
      const result = await call<Preview>('/restaurant-panel/lealtad/verificar', { method: 'POST', body: JSON.stringify({ code: code.trim() }) });
      setPreview(result.data); setApplyReward(result.data.eligibleForReward);
    } catch (reason) { setError(getRequestErrorMessage(reason, 'No se pudo verificar el código.')); }
    finally { setBusy(false); }
  };
  const addItem = () => {
    if (!selectedProduct || busy) return;
    for (const group of selectedProduct.optionGroups) {
      const count = optionIds.filter(id => group.options.some(option => option.id === id)).length;
      if (count < group.minSelection || count > group.maxSelection) { setError(`Revisa las opciones de ${selectedProduct.name}: ${group.name}.`); return; }
    }
    setError('');
    setCart(lines => [...lines, { key: ++lineKey.current, productId: selectedProduct.id, quantity, ...(selectedProduct.sellBy === 'WEIGHT' ? { weightG } : {}), optionIds: [...optionIds] }]);
    setQuantity(1); setOptionIds([]); resetQuote();
  };
  const quoteSale = async () => {
    if (!preview || !code.trim() || cart.length === 0 || busy) return;
    setBusy(true); setError(''); setNotice(''); setPaymentConfirmed(false);
    try {
      const result = await call<Quote>('/restaurant-panel/lealtad/cotizar-local', { method: 'POST', body: JSON.stringify({ code: code.trim(), items: saleItems, applyReward }) });
      setQuote(result.data);
      if (applyReward && !result.data.rewardEligible) setApplyReward(false);
    } catch (reason) { setQuote(null); setError(getRequestErrorMessage(reason, 'No se pudo calcular la venta.')); }
    finally { setBusy(false); }
  };
  const confirm = async () => {
    if (!preview || !quote || !paymentConfirmed || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await call<{ stamps: number; goal: number; completed: boolean; subtotalCents: number; totalCents: number; rewardAppliedCents: number; rewardDescription: string | null; paymentMethod: string }>('/restaurant-panel/lealtad/registrar', { method: 'POST', body: JSON.stringify({ code: code.trim(), items: saleItems, applyReward: quote.rewardApplied, paymentMethod, note: note.trim() || undefined }) });
      setNotice(`Venta registrada y cobrada por ${money(result.data.totalCents)} (${result.data.paymentMethod}). ${result.data.stamps} de ${result.data.goal} sellos.${result.data.completed ? ' ¡Tarjeta completada!' : ''}${result.data.rewardAppliedCents ? ` Descuento aplicado: ${money(result.data.rewardAppliedCents)}.` : result.data.rewardDescription ? ` ${result.data.rewardDescription}.` : ''}`);
      setPreview(null); setQuote(null); setCode(''); setCart([]); setApplyReward(false); setNote(''); setPaymentConfirmed(false); setVersion(v => v + 1);
    } catch (reason) {
      setError(`${getRequestErrorMessage(reason, 'No se pudo confirmar el resultado.')} Conserva los mismos productos y forma de pago, y revisa el historial antes de reintentar; el sistema reconocerá el mismo QR y la misma venta si ya se guardó.`);
      setVersion(v => v + 1);
    } finally { setBusy(false); }
  };
  const voidVisit = async (id: string) => {
    if (!window.confirm('¿Anular el registro de esta venta? Se devolverán el sello, la recompensa y las existencias controladas. Si ya cobraste, gestiona también la devolución del dinero por el medio de pago.')) return;
    setBusy(true); setError(''); setNotice('');
    try { await call(`/restaurant-panel/lealtad/visitas/${encodeURIComponent(id)}/anular`, { method: 'POST', body: '{}' }); setNotice('Registro de venta anulado. Se restauraron sellos y existencias controladas; devuelve el pago por separado si corresponde.'); setVersion(v => v + 1); }
    catch (reason) { setError(getRequestErrorMessage(reason, 'No se pudo anular la venta.')); }
    finally { setBusy(false); }
  };
  const stopScanner = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setShowScanner(false);
  }, []);
  useEffect(() => {
    if (!showScanner) return;
    let mounted = true;
    const Detector = (window as unknown as { BarcodeDetector?: new (options: { formats: string[] }) => { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>> } }).BarcodeDetector;
    if (!Detector || !navigator.mediaDevices?.getUserMedia) { setError('Este navegador no puede escanear QR. Escribe el código manualmente.'); setShowScanner(false); return; }
    let raf = 0;
    void (async () => {
      try {
        const detector = new Detector({ formats: ['qr_code'] });
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!mounted) { stream.getTracks().forEach(track => track.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        const scan = async () => {
          if (!mounted) return;
          try {
            const codes = await detector.detect(video);
            if (!mounted) return;
            if (codes[0]?.rawValue) { setPreview(null); setQuote(null); setCode(String(codes[0].rawValue).trim().slice(0, 64)); stopScanner(); return; }
          } catch { /* Keep scanning; manual entry remains available. */ }
          raf = requestAnimationFrame(scan);
        };
        raf = requestAnimationFrame(scan);
      } catch { setError('No pudimos abrir la cámara. Escribe el código manualmente.'); setShowScanner(false); }
    })();
    return () => { mounted = false; cancelAnimationFrame(raf); streamRef.current?.getTracks().forEach(track => track.stop()); };
  }, [showScanner, stopScanner]);

  return <section className="wl-campaigns wl-inperson" aria-labelledby="inperson-title">
    <header className="wl-campaign-header"><span className="wl-campaign-header-icon"><Award aria-hidden="true" /></span><div><p className="wl-campaign-eyebrow">Fidelidad en persona</p><h1 id="inperson-title">Ventas en el local</h1></div></header>
    {error && <p role="alert" className="wl-campaign-feedback is-error">{error}</p>}
    {notice && <p role="status" className="wl-campaign-feedback">{notice}</p>}
    <div className="wl-inperson-grid">
      <div className="wl-campaign-card wl-inperson-main">
        <h2>Registrar venta</h2>
        <div className="wl-inperson-code"><input value={code} disabled={busy} onChange={event => { setPreview(null); setQuote(null); setApplyReward(false); setCode(event.target.value.trim()); }} placeholder="Código del cliente" aria-label="Código de fidelidad" /><button type="button" className="wl-menu-action" disabled={busy} onClick={() => setShowScanner(value => !value)}><ScanLine aria-hidden="true" />{showScanner ? 'Cerrar cámara' : 'Escanear'}</button><button type="button" className="wl-campaign-button is-primary" disabled={busy || !code.trim()} onClick={() => void verify()}>Verificar</button></div>
        {showScanner && <video ref={videoRef} className="wl-inperson-scanner" playsInline muted />}
        {catalogError && <p role="alert" className="wl-inperson-warn"><CircleAlert aria-hidden="true" />{catalogError}</p>}
        {preview && <div className="wl-inperson-preview">
          <div className="wl-inperson-person"><span className="wl-customers-avatar">{preview.customerName.slice(0, 1).toUpperCase()}</span><div><h3>{preview.customerName}</h3><p>{preview.stamps} de {preview.goal} sellos · {preview.availableRewards} recompensa(s) disponible(s)</p></div></div>
          {preview.reserved && <p className="wl-inperson-warn"><CircleAlert aria-hidden="true" />Tiene una recompensa reservada en otro pedido; no se puede aplicar aquí.</p>}
          <div className="wl-inperson-product-picker">
            <label>Producto<select value={selectedProductId} onChange={event => { setSelectedProductId(event.target.value); setOptionIds([]); }}><option value="">Selecciona un producto</option>{catalog.map(product => <option key={product.id} value={product.id} disabled={product.trackStock && product.stock < 1}>{product.name}{product.trackStock ? ` · ${product.stock} disponibles` : ''}</option>)}</select></label>
            {selectedProduct?.sellBy === 'WEIGHT' && <label>Peso por porción (g)<input type="number" min={selectedProduct.minWeightG ?? 100} max={selectedProduct.maxWeightG ?? 5000} step={selectedProduct.stepWeightG ?? 100} value={weightG} onChange={event => setWeightG(Number(event.target.value))} /></label>}
            {selectedProduct && <label>Cantidad<input type="number" min="1" max="100" value={quantity} onChange={event => setQuantity(Math.max(1, Math.min(100, Number(event.target.value))))} /></label>}
            {selectedProduct?.optionGroups.map(group => <fieldset key={group.id} className="wl-inperson-option-group"><legend>{group.name} ({group.minSelection === group.maxSelection ? `elige ${group.minSelection}` : `${group.minSelection}–${group.maxSelection}`})</legend>{group.options.filter(option => option.isAvailable).map(option => <label key={option.id}><input type="checkbox" checked={optionIds.includes(option.id)} onChange={event => setOptionIds(ids => event.target.checked ? [...ids, option.id] : ids.filter(id => id !== option.id))} />{option.name}{option.price ? ` (+${money(Math.round(option.price * 100))})` : ''}</label>)}</fieldset>)}
            <button type="button" className="wl-menu-action" disabled={!selectedProduct || busy} onClick={addItem}><Plus size={16} />Agregar al pedido</button>
          </div>
          <div className="wl-inperson-cart"><h3>Productos de la venta</h3>{cart.length === 0 ? <p className="wl-loyalty-help">Agrega al menos un producto.</p> : cart.map(line => { const product = catalog.find(item => item.id === line.productId); return <article key={line.key}><div><strong>{product?.name || 'Producto'}</strong><small>{line.quantity} × {product?.sellBy === 'WEIGHT' ? `${line.weightG} g` : 'unidad(es)'}{line.optionIds.length ? ` · ${line.optionIds.map(id => product?.optionGroups.flatMap(group => group.options).find(option => option.id === id)?.name).filter(Boolean).join(', ')}` : ''}{product?.discountPrice != null || !!product?.promoType ? ' · promoción de producto' : ''}</small></div><button type="button" aria-label={`Quitar ${product?.name || 'producto'}`} onClick={() => { setCart(lines => lines.filter(item => item.key !== line.key)); resetQuote(); }}><Trash2 size={16} /></button></article>; })}</div>
          <label className="wl-inperson-reward"><input type="checkbox" checked={applyReward} disabled={!preview.eligibleForReward || preview.reserved} onChange={event => { setApplyReward(event.target.checked); resetQuote(); }} /><span><strong>{preview.rewardDescription}</strong><small>{preview.eligibleForReward ? 'Aplicar solo si ningún producto tiene promoción' : 'Aún no tiene una recompensa disponible'}</small></span></label>
          <button type="button" className="wl-campaign-button is-primary wl-inperson-confirm" disabled={busy || !cart.length} onClick={() => void quoteSale()}>{busy ? 'Calculando…' : 'Verificar total y recompensa'}</button>
          {quote && <div className="wl-inperson-payment"><h3>Resumen y cobro</h3><div className="wl-inperson-totals"><span>Subtotal</span><strong>{money(quote.subtotalCents)}</strong>{quote.rewardAppliedCents > 0 && <><span>Recompensa</span><strong>−{money(quote.rewardAppliedCents)}</strong></>}<span>Total a cobrar</span><strong>{money(quote.totalCents)}</strong></div>{quote.rewardDescription && <p className="wl-inperson-warn"><Award size={16} />{quote.rewardDescription}{quote.rewardAppliedCents ? ` · descuento ${money(quote.rewardAppliedCents)}` : ' · entregar al cliente'}</p>}{quote.rewardUnavailableReason && <p className="wl-inperson-warn"><CircleAlert size={16} />{quote.rewardUnavailableReason}</p>}{quote.hasPromotion && <p className="wl-inperson-warn"><CircleAlert size={16} />Esta venta incluye promoción de producto. El premio de fidelidad se conserva para otra compra.</p>}
            <label className="wl-inperson-note">Forma de pago<select value={paymentMethod} onChange={event => { setPaymentMethod(event.target.value as typeof paymentMethod); setPaymentConfirmed(false); }}><option value="CASH">Efectivo</option><option value="CARD">Tarjeta</option><option value="TRANSFER">Transferencia</option><option value="OTHER">Otro</option></select></label>
            <label className="wl-inperson-note">Nota (opcional)<input value={note} maxLength={300} onChange={event => { setNote(event.target.value); setPaymentConfirmed(false); }} placeholder="Referencia o nota de la venta" /></label>
            <label className="wl-inperson-paid"><input type="checkbox" checked={paymentConfirmed} onChange={event => setPaymentConfirmed(event.target.checked)} />Confirmo que ya recibí {money(quote.totalCents)} por {paymentMethod === 'CASH' ? 'efectivo' : paymentMethod === 'CARD' ? 'tarjeta' : paymentMethod === 'TRANSFER' ? 'transferencia' : 'otro medio'}.</label>
            <button type="button" className="wl-campaign-button is-primary wl-inperson-confirm" disabled={busy || !paymentConfirmed} onClick={() => void confirm()}><Check aria-hidden="true" />{busy ? 'Registrando…' : 'Registrar venta y sumar sello'}</button>
          </div>}
        </div>}
      </div>
      <aside className="wl-campaign-card wl-inperson-guide"><div className="wl-campaign-preview-title"><ShieldCheck aria-hidden="true" /><div><h2>Venta segura</h2></div></div><ol><li>Verifica el código del cliente.</li><li>Agrega productos y confirma el cobro.</li><li>Se guardan venta, sello y recompensa.</li></ol><p className="wl-loyalty-help">Puedes anular la venta durante 5 minutos.</p></aside>
    </div>
    <div className="wl-campaign-card wl-inperson-history"><h2>Últimas ventas</h2>{!visits.length ? <p className="wl-campaign-empty">Todavía no hay ventas presenciales.</p> : <div className="wl-inperson-list">{visits.map(visit => <article key={visit.id} className={visit.voidedAt ? 'is-voided' : ''}><div><strong>{visit.customerName}</strong><small>{new Date(visit.createdAt).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })} · {visit.items?.map(item => `${item.quantity}× ${item.name}`).join(', ') || 'Venta histórica'} · Total {money(visit.totalCents ?? visit.amountCents - visit.rewardAppliedCents)}{visit.paymentMethod ? ` · ${visit.paymentMethod}` : ''}</small></div><span>{visit.voidedAt ? 'Anulada' : visit.rewardDescription || 'Solo sello'}</span><button type="button" className="wl-menu-action" disabled={busy || !!visit.voidedAt} onClick={() => void voidVisit(visit.id)}><X aria-hidden="true" />Anular</button></article>)}</div>}</div>
  </section>;
}
