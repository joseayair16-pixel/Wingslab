'use client';

import { useCallback, useEffect, useState } from 'react';
import { Award, Eye, Info, Save } from 'lucide-react';
import { LoyaltyCard } from '../../../../shared/src/loyalty-card';
import logo from '../../assets/wingslab-wordmark-red.png';

export function LoyaltySection({ apiBase, token }: { apiBase: string; token: string }) {
  const [config, setConfig] = useState({ enabled: false, pointsPer100: 1, rewardPoints: 100, rewardAmount: 10, stampGoal: 8, rewardType: 'DISCOUNT', rewardKind: 'AMOUNT', rewardValue: 1000 as number | null, rewardProductId: null as string | null, redemptionReady: false, rewardDescription: '', stampTerms: '' });
  const [products, setProducts] = useState<Array<{ id: string; name: string; isAvailable: boolean; sellBy?: string; isAdultOnly?: boolean }>>([]);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [brandLogo, setBrandLogo] = useState(logo.src);
  const request = useCallback(async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(apiBase + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const json = await response.json();
    if (!response.ok) throw Error(json.error?.message || 'No se pudo consultar la fidelidad.');
    return json;
  }, [apiBase, token]);
  useEffect(() => {
    let active = true;
    void request('/restaurant-panel/perfil').then(result => { if (active && result.data?.logo) setBrandLogo(result.data.logo); }).catch(() => { /* Official logo remains the fallback. */ });
    void request('/restaurant-panel/productos').then(result => { if (active && Array.isArray(result.data)) setProducts(result.data); }).catch(() => { /* Saving validates the product server-side. */ });
    return () => { active = false; };
  }, [request]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void request('/restaurant-panel/lealtad')
      .then(result => { if (active) { const loaded = { ...result.data }; if (!loaded.redemptionReady && ['PRODUCT', 'GIFT'].includes(loaded.rewardType)) { loaded.rewardKind = 'PRODUCT'; loaded.rewardValue = null; loaded.rewardProductId = null; } setConfig(loaded); setConfigLoaded(true); } })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'No se pudo cargar la fidelidad.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [request, attempt]);
  const save = async () => {
    setSaving(true); setError(''); setSaved(false);
    try {
      const result = await request('/restaurant-panel/lealtad', 'PUT', config);
      setConfig(result.data); setSaved(true); window.setTimeout(() => setSaved(false), 2500);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudieron guardar las reglas.'); }
    finally { setSaving(false); }
  };
  // Campo vacío cuando el valor es 0, para poder borrarlo y escribir de inmediato.
  const rewardValueInput = config.rewardValue === null || config.rewardValue === 0
    ? ''
    : config.rewardKind === 'PERCENT'
      ? config.rewardValue
      : config.rewardValue / 100;
  return <section className="wl-campaigns wl-loyalty-manager" aria-labelledby="loyalty-title">
    <header className="wl-campaign-header"><span className="wl-campaign-header-icon"><Award aria-hidden="true" /></span><div><p className="wl-campaign-eyebrow">Siempre es un gusto volver</p><h1 id="loyalty-title">Fidelidad</h1><p>Una tarjeta para reconocer a tus clientes, compra a compra.</p></div></header>
    {loading ? <p role="status">Cargando reglas de fidelidad…</p> : !configLoaded ? <div role="alert" className="rounded-2xl border bg-white p-5 text-sm text-red-700">{error} <button type="button" className="font-semibold underline" onClick={() => setAttempt(value => value + 1)}>Reintentar</button></div> : null}

    {configLoaded && !loading && <>
    <div className="wl-campaign-notice" role="note"><Info aria-hidden="true"/><p><strong>Tu cliente gana en la compra que completa su tarjeta.</strong> Con una meta de {config.stampGoal}, necesita {Math.max(0, config.stampGoal - 1)} compras completadas para aplicar el premio en la siguiente. No se combina con promociones. Las tarjetas en curso y los premios ganados conservan sus condiciones.</p></div>
    <div className="wl-loyalty-workspace">
      <form className="wl-campaign-card wl-loyalty-editor" onSubmit={event => { event.preventDefault(); void save(); }}>
        <h2>Configura tu tarjeta</h2><p className="wl-loyalty-help">Cada pedido completado suma un sello. Los pedidos cancelados o en reparto no cuentan.</p>
        <fieldset disabled={saving}>
          <label className="wl-loyalty-enable"><div><strong>Activar programa de fidelidad</strong><span>Habilita sellos y recompensas. Pausar no elimina el progreso.</span></div><input type="checkbox" checked={config.enabled} onChange={e => setConfig({ ...config, enabled: e.target.checked })} /></label>
          <div className="wl-menu-fields">
            <label>Compras para completar la tarjeta<input className="wl-menu-field" type="number" required min={2} max={30} step={1} value={config.stampGoal || ''} onChange={e => setConfig({ ...config, stampGoal: Number(e.target.value) })}/><span className="wl-loyalty-help">Entre 2 y 30 compras.</span></label>
            <label>Tipo de recompensa<select className="wl-menu-field" value={config.rewardKind} onChange={e => setConfig({ ...config, rewardKind: e.target.value, rewardType: e.target.value === 'PRODUCT' ? 'PRODUCT' : 'DISCOUNT', rewardValue: e.target.value === 'PRODUCT' ? null : e.target.value === 'PERCENT' ? 10 : 1000, rewardProductId: null, rewardDescription: '' })}><option value="AMOUNT">Descuento en pesos</option><option value="PERCENT">Descuento en porcentaje</option><option value="PRODUCT">Producto gratis</option></select></label>
            {config.rewardKind === 'PRODUCT' ? <label className="wl-menu-wide">Producto de regalo<select className="wl-menu-field" required value={config.rewardProductId || ''} onChange={e => { const product = products.find(p => p.id === e.target.value); setConfig({ ...config, rewardProductId: e.target.value || null, rewardValue: null, rewardDescription: product ? `${product.name} de regalo` : '' }); }}><option value="">Selecciona un producto</option>{products.filter(p => p.isAvailable && p.sellBy !== 'WEIGHT' && !p.isAdultOnly).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><span className="wl-loyalty-help">Se agrega una unidad gratis. Debe estar disponible y no requerir opciones obligatorias.</span></label> : <label className="wl-menu-wide">{config.rewardKind === 'PERCENT' ? 'Porcentaje de descuento' : 'Importe del descuento (MXN)'}<input className="wl-menu-field" type="number" required min={config.rewardKind === 'PERCENT' ? 1 : .01} max={config.rewardKind === 'PERCENT' ? 100 : 5000} step={config.rewardKind === 'PERCENT' ? 1 : .01} value={rewardValueInput} onChange={e => { const raw = e.target.value; const value = raw === '' ? 0 : config.rewardKind === 'PERCENT' ? Number(raw) : Math.round(Number(raw) * 100); setConfig({ ...config, rewardValue: value, rewardDescription: value > 0 ? (config.rewardKind === 'PERCENT' ? `${value}% de descuento` : `$${(value / 100).toFixed(2)} de descuento`) : '' }); }}/><span className="wl-loyalty-help">Aplica al subtotal de productos, no al envío. Nunca supera el importe de la compra.</span></label>}
            <label className="wl-menu-wide">Nombre de la recompensa<input className="wl-menu-field" required minLength={3} maxLength={200} value={config.rewardDescription} onChange={e => setConfig({ ...config, rewardDescription: e.target.value })} placeholder="Ej. Unas papas de regalo"/><span className="wl-loyalty-help">Es lo que verá el cliente junto al beneficio configurado.</span></label>
            <label className="wl-menu-wide">Condiciones <span className="wl-campaign-optional">(opcional)</span><textarea className="wl-menu-field" rows={4} maxLength={1000} value={config.stampTerms} onChange={e => setConfig({ ...config, stampTerms: e.target.value })} placeholder="Explica las condiciones de la recompensa."/></label>
          </div>
        </fieldset>
        <div className="wl-campaign-actions"><button type="submit" className="wl-campaign-button is-primary" disabled={saving}><Save aria-hidden="true"/>{saving ? 'Guardando…' : 'Guardar configuración'}</button></div>
        {saved && <p role="status" className="wl-campaign-feedback mt-4">Configuración guardada.</p>}{error && <p role="alert" className="wl-campaign-feedback is-error mt-4">{error}</p>}
      </form>
      <aside className="wl-campaign-card wl-loyalty-preview"><div className="wl-campaign-preview-title"><Eye aria-hidden="true"/><div><h2>Vista previa</h2><p>El mismo diseño que verá tu cliente.</p></div></div><LoyaltyCard logoUrl={brandLogo} fallbackLogoUrl={logo.src} goal={config.stampGoal} stamps={Math.min(3, Math.max(0, config.stampGoal - 1))} reward={config.rewardDescription} terms={config.stampTerms} preview/><p className="wl-loyalty-help">Los sellos de esta vista son ilustrativos. El progreso real pertenece a cada cliente.</p></aside>
    </div>
    </>}
  </section>;
}
