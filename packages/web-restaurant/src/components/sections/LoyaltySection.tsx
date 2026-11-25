'use client';

import { SectionHeader } from '../SectionHeader';

import { useCallback, useEffect, useState } from 'react';
import { Award, Eye, Save } from 'lucide-react';
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
    void request('/restaurant-panel/perfil').then(result => { if (active && result.data?.logo) setBrandLogo(result.data.logo); }).catch(() => {});
    void request('/restaurant-panel/productos').then(result => { if (active && Array.isArray(result.data)) setProducts(result.data); }).catch(() => {});
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
  const rewardValueInput = config.rewardValue === null || config.rewardValue === 0
    ? ''
    : config.rewardKind === 'PERCENT'
      ? config.rewardValue
      : config.rewardValue / 100;

  return <section className="wl-campaigns wl-loyalty-manager" aria-labelledby="loyalty-title">
    <SectionHeader title="Fidelidad" titleId="loyalty-title" icon={<Award />} />

    {loading ? <p role="status">Cargando…</p> : !configLoaded ? <div role="alert" className="wl-campaign-feedback is-error">{error} <button type="button" className="font-semibold underline" onClick={() => setAttempt(value => value + 1)}>Reintentar</button></div> : null}

    {configLoaded && !loading && <>
      <p className="wl-loyalty-summary" role="note">Premio al completar {config.stampGoal} compras · no acumulable.</p>
      <div className="wl-loyalty-workspace">
        <form className="wl-campaign-card wl-loyalty-editor" onSubmit={event => { event.preventDefault(); void save(); }}>
          <fieldset disabled={saving}>
            <label className="wl-loyalty-enable"><strong>Programa activo</strong><input type="checkbox" checked={config.enabled} onChange={e => setConfig({ ...config, enabled: e.target.checked })} /></label>
            <div className="wl-menu-fields">
              <label>Compras para el premio<input className="wl-menu-field" type="number" required min={2} max={30} step={1} value={config.stampGoal || ''} onChange={e => setConfig({ ...config, stampGoal: Number(e.target.value) })} /></label>
              <label>Tipo de recompensa<select className="wl-menu-field" value={config.rewardKind} onChange={e => setConfig({ ...config, rewardKind: e.target.value, rewardType: e.target.value === 'PRODUCT' ? 'PRODUCT' : 'DISCOUNT', rewardValue: e.target.value === 'PRODUCT' ? null : e.target.value === 'PERCENT' ? 10 : 1000, rewardProductId: null, rewardDescription: '' })}><option value="AMOUNT">Descuento en pesos</option><option value="PERCENT">Descuento en %</option><option value="PRODUCT">Producto gratis</option></select></label>
              {config.rewardKind === 'PRODUCT'
                ? <label className="wl-menu-wide">Producto de regalo<select className="wl-menu-field" required value={config.rewardProductId || ''} onChange={e => { const product = products.find(p => p.id === e.target.value); setConfig({ ...config, rewardProductId: e.target.value || null, rewardValue: null, rewardDescription: product ? `${product.name} de regalo` : '' }); }}><option value="">Selecciona un producto</option>{products.filter(p => p.isAvailable && p.sellBy !== 'WEIGHT' && !p.isAdultOnly).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                : <label className="wl-menu-wide">{config.rewardKind === 'PERCENT' ? 'Descuento (%)' : 'Descuento (MXN)'}<input className="wl-menu-field" type="number" required min={config.rewardKind === 'PERCENT' ? 1 : .01} max={config.rewardKind === 'PERCENT' ? 100 : 5000} step={config.rewardKind === 'PERCENT' ? 1 : .01} value={rewardValueInput} onChange={e => { const raw = e.target.value; const value = raw === '' ? 0 : config.rewardKind === 'PERCENT' ? Number(raw) : Math.round(Number(raw) * 100); setConfig({ ...config, rewardValue: value, rewardDescription: value > 0 ? (config.rewardKind === 'PERCENT' ? `${value}% de descuento` : `$${(value / 100).toFixed(2)} de descuento`) : '' }); }} /></label>}
              <label className="wl-menu-wide">Nombre de la recompensa<input className="wl-menu-field" required minLength={3} maxLength={200} value={config.rewardDescription} onChange={e => setConfig({ ...config, rewardDescription: e.target.value })} placeholder="Ej. Papas de regalo" /></label>
              <label className="wl-menu-wide">Condiciones<textarea className="wl-menu-field" rows={3} maxLength={1000} value={config.stampTerms} onChange={e => setConfig({ ...config, stampTerms: e.target.value })} placeholder="Opcional" /></label>
            </div>
          </fieldset>
          <div className="wl-campaign-actions"><button type="submit" className="wl-campaign-button is-primary" disabled={saving}><Save aria-hidden="true" />{saving ? 'Guardando…' : 'Guardar'}</button></div>
          {saved && <p role="status" className="wl-campaign-feedback mt-4">Guardado</p>}{error && <p role="alert" className="wl-campaign-feedback is-error mt-4">{error}</p>}
        </form>
        <aside className="wl-campaign-card wl-loyalty-preview">
          <div className="wl-campaign-preview-title"><Eye aria-hidden="true" /><div><h2>Vista previa</h2></div></div>
          <LoyaltyCard logoUrl={brandLogo} fallbackLogoUrl={logo.src} goal={config.stampGoal} stamps={Math.min(3, Math.max(0, config.stampGoal - 1))} reward={config.rewardDescription} terms={config.stampTerms} preview />
        </aside>
      </div>
    </>}
  </section>;
}
