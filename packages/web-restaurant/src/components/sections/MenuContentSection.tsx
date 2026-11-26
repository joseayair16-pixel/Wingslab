'use client';

import { SectionHeader } from '../SectionHeader';

import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Eye, Image as ImageIcon, Images, Info, Layers, LayoutPanelTop, Pencil, Plus, Trash2, Users, UserRound } from 'lucide-react';

type Item = {
  id: string; kind: 'modal' | 'banner'; title: string; text: string; imageId: string;
  targetUrl: string; buttonLabel: string; active: boolean; audience: 'all' | 'visitors' | 'customers';
  frequency: 'session' | 'daily' | 'once'; startsAt: string | null; endsAt: string | null;
};
type Content = { revision: number; items: Item[] };
const field = 'wl-menu-field';
const action = 'wl-menu-action';
// Mismo origen: el rewrite /api/* del frontend llega al backend sin CORS/CORP.
const imageUrl = (imageId: string) => `/api/public/menu-images/${imageId}`;

export function MenuContentSection({ apiBase, token }: { apiBase: string; token: string }) {
  const [content, setContent] = useState<Content | null>(null);
  const [kind, setKind] = useState<Item['kind']>('modal');
  const [draft, setDraft] = useState<Item | null>(null);
  const [fileName, setFileName] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<{ title: string; detail: string } | null>(null);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => {
    if (!confirmation) return;
    const timer = window.setTimeout(() => setConfirmation(null), 2200);
    return () => clearTimeout(timer);
  }, [confirmation]);

  const request = useCallback(async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(apiBase + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    if (!response.ok) throw Error(result.error?.message || 'No se pudo guardar el contenido.');
    return result.data;
  }, [apiBase, token]);

  const load = useCallback(async () => {
    try { setContent(await request('/restaurant-panel/menu-content')); setError(''); }
    catch (e: any) { setError(e.message); }
  }, [request]);
  useEffect(() => { void load(); }, [load]);

  const persist = async (items: Item[], close = false) => {
    if (!content || busy) return;
    setBusy(true); setError(''); setConfirmation(null);
    try {
      setContent(await request('/restaurant-panel/menu-content', 'PUT', { revision: content.revision, items }));
      if (close) setDraft(null);
      setConfirmation({
        title: 'Todo listo',
        detail: kind === 'banner' ? 'La imagen ya está en el carrusel de tu menú.' : 'El contenido ya está disponible en tu menú.',
      });
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  const newItem = () => {
    setConfirmation(null); setError(''); setFileName(''); setPreviewUrl(''); setDragging(false);
    setDraft({
      id: crypto.randomUUID(), kind,
      // Los banners son solo imágenes: sin texto, enlace ni botón.
      title: kind === 'banner' ? 'Imagen promocional' : '',
      text: '', imageId: '', targetUrl: '', buttonLabel: '',
      active: true, audience: kind === 'modal' ? 'visitors' : 'all', frequency: 'session',
      startsAt: null, endsAt: null,
    });
  };

  const upload = async (file?: File) => {
    if (!file || !draft) return;
    const extension = file.name.split('.').pop()?.toLowerCase();
    const mediaType = file.type.toLowerCase() === 'image/jpg' ? 'image/jpeg' : file.type.toLowerCase();
    const normalizedType = mediaType || ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' } as Record<string, string>)[extension || ''] || '';
    if (file.size > 3 * 1024 * 1024) {
      setError(`La imagen pesa ${(file.size / (1024 * 1024)).toFixed(1)} MiB y el máximo es 3 MiB. Elige una versión más ligera.`);
      return;
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(normalizedType)) {
      setError('Formato no compatible. Elige una imagen PNG, JPG o WebP.');
      return;
    }
    setBusy(true); setError('');
    try {
      const source = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]+;/, `data:${normalizedType};`));
        reader.onerror = reject; reader.readAsDataURL(file);
      });
      const uploaded = await request('/restaurant-panel/menu-images', 'POST', { source });
      setFileName(file.name);
      setPreviewUrl(URL.createObjectURL(file));
      setDraft(current => current ? {
        ...current,
        imageId: uploaded.id,
        ...(current.kind === 'banner' ? { title: file.name.replace(/\.[^.]+$/, '').slice(0, 80) || 'Imagen promocional' } : {}),
      } : current);
    } catch (e: any) { setError(e.message || 'No se pudo cargar la imagen.'); }
    finally { setBusy(false); }
  };

  const move = (item: Item, direction: number) => {
    if (!content) return;
    const items = [...content.items], index = items.findIndex(i => i.id === item.id);
    let other = index + direction;
    while (other >= 0 && other < items.length && items[other].kind !== item.kind) other += direction;
    if (other < 0 || other >= items.length) return;
    [items[index], items[other]] = [items[other], items[index]];
    void persist(items);
  };

  const save = (item: Item) => {
    if (!content) return;
    const clean: Item = item.kind === 'banner'
      ? { ...item, targetUrl: '', buttonLabel: '', text: '', active: true }
      : { ...item, text: '', targetUrl: '', buttonLabel: '' };
    const exists = content.items.some(i => i.id === clean.id);
    void persist(exists ? content.items.map(i => i.id === clean.id ? clean : i) : [...content.items, clean], true);
  };

  const rows = content?.items.filter(i => i.kind === kind) || [];
  const editing = !!draft && !!content?.items.some(i => i.id === draft.id);

  return <section className="wl-campaigns wl-menu-content" aria-labelledby="menu-content-title">
    <SectionHeader title="Contenido del menú" titleId="menu-content-title" icon={<Layers />} description="Personaliza lo que ven tus clientes al visitar tu menú." />

    <div className="wl-menu-toolbar wl-campaign-card">
      <div className="wl-menu-tabs" aria-label="Tipo de contenido">
        <button type="button" aria-pressed={kind === 'modal'} disabled={!!draft} onClick={() => setKind('modal')}><LayoutPanelTop aria-hidden="true" /> Bienvenida</button>
        <button type="button" aria-pressed={kind === 'banner'} disabled={!!draft} onClick={() => setKind('banner')}><Images aria-hidden="true" /> Imágenes promocionales</button>
      </div>
      <button type="button" className="wl-campaign-button is-primary" disabled={!content || busy || !!draft || content.items.length >= 24} onClick={newItem}>
        <Plus aria-hidden="true" /> {kind === 'modal' ? 'Nuevo modal' : 'Agregar imagen'}
      </button>
    </div>

    {kind === 'banner' && <div className="wl-menu-info"><Info aria-hidden="true" /><p>
      Solo imagen, sin textos ni botones. PNG, JPG o WebP de hasta 3 MiB · recomendado 1600 × 900 px.
    </p></div>}

    {error && draft?.kind !== 'banner' && <p role="alert" className="wl-campaign-feedback is-error">{error} {!error.startsWith('La imagen pesa') && !error.startsWith('Formato no compatible') && <button type="button" className="underline" disabled={busy} onClick={() => { setDraft(null); void load(); }}>Recargar contenido</button>}</p>}

    {draft && draft.kind === 'banner' && (
      <form className="wl-banner-editor wl-campaign-card" onSubmit={event => { event.preventDefault(); save(draft); }}>
        <div className="wl-banner-editor-head">
          <span className="wl-campaign-heading-icon"><Images aria-hidden="true" /></span>
          <div><h2>{editing ? 'Cambiar imagen' : 'Agregar imagen promocional'}</h2><p>Elige la imagen y se mostrará en el carrusel de tu menú.</p></div>
        </div>

        <label
          className={`wl-banner-dropzone${draft.imageId ? ' has-image' : ''}${dragging ? ' is-dragging' : ''}`}
          onDragOver={event => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={event => { event.preventDefault(); setDragging(false); void upload(event.dataTransfer.files?.[0]); }}
        >
          <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Imagen promocional" disabled={busy} onChange={e => void upload(e.target.files?.[0])} />
          {draft.imageId ? (
            <>
              <img src={previewUrl || imageUrl(draft.imageId)} alt={draft.title || 'Imagen promocional'} />
              {fileName && <span className="wl-banner-dropzone-name">{fileName}</span>}
              <span className="wl-banner-dropzone-change"><Pencil aria-hidden="true" /> Cambiar imagen</span>
              {busy && <span className="wl-banner-dropzone-busy"><span className="wl-banner-spinner" /> Procesando…</span>}
            </>
          ) : (
            <>
              <span className="wl-banner-dropzone-icon"><ImageIcon aria-hidden="true" /></span>
              <strong>{dragging ? 'Suelta la imagen aquí' : 'Arrastra tu imagen aquí'}</strong>
              <span>o haz clic para elegir un archivo</span>
              {busy ? <span className="wl-banner-dropzone-busy"><span className="wl-banner-spinner" /> Subiendo…</span> : <span className="wl-banner-dropzone-chip">Examinar archivo</span>}
              <small>PNG, JPG o WebP · hasta 3 MiB · recomendado 1600 × 900</small>
            </>
          )}
          {error && <span role="alert" className="wl-banner-dropzone-error">{error}</span>}
        </label>

        <div className="wl-banner-editor-foot">
          <p>La imagen se muestra tal cual, sin botones ni enlaces. Después puedes cambiar el orden u ocultarla.</p>
          <div className="wl-menu-form-actions">
            <button type="button" className={action} disabled={busy} onClick={() => setDraft(null)}>Cancelar</button>
            {draft.imageId && <button className="wl-campaign-button is-primary" disabled={busy}>
              {busy ? 'Guardando…' : editing ? 'Guardar cambios' : 'Agregar al carrusel'}
            </button>}
          </div>
        </div>
      </form>
    )}

    {draft && draft.kind === 'modal' && <form className="wl-menu-editor wl-campaign-card" onSubmit={event => { event.preventDefault(); save(draft); }}>
      <div className="wl-campaign-card-heading"><span className="wl-campaign-heading-icon"><Pencil aria-hidden="true" /></span><div><h2>{editing ? 'Editar bienvenida' : 'Crear bienvenida'}</h2><p>Una imagen, un título y el público que quieres alcanzar.</p></div></div>
      <div className="wl-welcome-editor-layout"><fieldset disabled={busy} className="wl-welcome-fields">
        <label className="wl-welcome-title">Título de campaña<input className={field} required maxLength={80} placeholder="Ej. ¡Bienvenido!" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
        <div className="wl-welcome-audience"><span>¿A quién se muestra?</span><div className="wl-welcome-audience-options">
          <button type="button" aria-pressed={draft.audience === 'visitors'} onClick={() => setDraft({ ...draft, audience: 'visitors' })}><UserRound aria-hidden="true" /><span><strong>Sin sesión</strong><small>Visitantes que aún no han iniciado sesión</small></span>{draft.audience === 'visitors' && <Check aria-hidden="true" />}</button>
          <button type="button" aria-pressed={draft.audience === 'customers'} onClick={() => setDraft({ ...draft, audience: 'customers' })}><Users aria-hidden="true" /><span><strong>Con sesión</strong><small>Clientes que han iniciado sesión</small></span>{draft.audience === 'customers' && <Check aria-hidden="true" />}</button>
        </div></div>
        <label className="wl-welcome-frequency">Frecuencia<select className={field} value={draft.frequency} onChange={e => setDraft({ ...draft, frequency: e.target.value as Item['frequency'] })}><option value="session">Una vez por sesión</option><option value="daily">Una vez cada 24 horas</option><option value="once">Una sola vez por navegador</option></select></label>
        <label className={`wl-welcome-upload${draft.imageId ? ' has-image' : ''}`}>
          <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e => void upload(e.target.files?.[0])} />
          {draft.imageId ? <><img src={previewUrl || imageUrl(draft.imageId)} alt="" /><span><strong>{fileName || 'Imagen seleccionada'}</strong><small>Pulsa para cambiarla</small></span><Pencil aria-hidden="true" /></> : <><ImageIcon aria-hidden="true" /><span><strong>Elige la imagen de campaña</strong><small>PNG, JPG o WebP · hasta 3 MiB</small></span><span className="wl-welcome-browse">Elegir imagen</span></>}
        </label>
      </fieldset>
      <aside className="wl-welcome-preview"><div className="wl-welcome-preview-label"><Eye aria-hidden="true" /> VISTA PREVIA</div><div className="wl-welcome-preview-card">{draft.imageId ? <img src={previewUrl || imageUrl(draft.imageId)} alt="" /> : <div className="wl-welcome-preview-empty"><ImageIcon aria-hidden="true" /><span>Tu imagen aparecerá aquí</span></div>}<div className="wl-welcome-preview-copy"><span>BIENVENIDA</span><h3>{draft.title || 'Título de campaña'}</h3></div></div><p>Se mostrará a {draft.audience === 'customers' ? 'clientes con sesión' : 'visitantes sin sesión'}.</p></aside></div>
      <div className="wl-menu-form-actions"><button type="button" className={action} disabled={busy} onClick={() => setDraft(null)}>Cancelar</button><button className="wl-campaign-button is-primary" disabled={busy || !draft.imageId || !draft.title.trim()}>{busy ? 'Guardando…' : 'Guardar campaña'}</button></div>
    </form>}

    <section className="wl-campaign-card wl-menu-library" aria-labelledby="menu-library-title">
      <div className="wl-menu-library-heading"><div><h2 id="menu-library-title">{kind === 'modal' ? 'Modales de bienvenida' : 'Imágenes promocionales'}</h2><p>{kind === 'modal' ? 'Administra los mensajes de bienvenida de tu menú.' : 'Administra las imágenes que aparecen en el carrusel de tu menú.'}</p></div>{content && <span className="wl-menu-count">{rows.length} {rows.length === 1 ? 'imagen' : 'imágenes'}</span>}</div>

      {!content && !error && <p className="wl-campaign-empty" role="status">Cargando contenido…</p>}
      {content && rows.length === 0 && !draft && <div className="wl-campaign-empty wl-menu-empty">
        <span className="wl-menu-empty-icon">{kind === 'modal' ? <LayoutPanelTop aria-hidden="true" /> : <Images aria-hidden="true" />}</span>
        <strong>{kind === 'modal' ? 'Aún no tienes mensajes de bienvenida' : 'Aún no hay imágenes promocionales'}</strong>
        <span>{kind === 'modal' ? 'Crea un modal para dar la bienvenida o destacar una promoción.' : 'Agrega una imagen para destacar novedades en tu menú.'}</span>
        <button type="button" className="wl-campaign-button is-primary" disabled={busy || content.items.length >= 24} onClick={newItem}><Plus aria-hidden="true" />{kind === 'modal' ? 'Crear primer modal' : 'Agregar primera imagen'}</button>
      </div>}

      <div className="wl-menu-grid">{rows.map((item, index) => <article key={item.id} className="wl-menu-item">
        <div className="wl-menu-item-image">
          <img alt={item.title} src={imageUrl(item.imageId)} />
          <span className={`wl-menu-status ${item.active ? 'is-active' : ''}`}>{item.active ? (kind === 'banner' ? 'Visible' : 'Activo · según vigencia') : 'Oculta'}</span>
        </div>
        <div className="wl-menu-item-body">
          <div className="wl-menu-item-title"><h3>{kind === 'banner' ? `Imagen ${index + 1}` : item.title}</h3><span>#{index + 1}</span></div>
          {kind === 'modal' && <>{item.text && <p className="wl-menu-item-description">{item.text}</p>}<p className="wl-menu-item-meta">Audiencia: {{ all: 'Todos', visitors: 'Visitantes', customers: 'Clientes' }[item.audience]}</p><p className="wl-menu-item-meta">Destino: {item.targetUrl || 'Sin enlace'}</p></>}
          <div className="wl-menu-item-actions">
            <button type="button" className={action} disabled={busy || !!draft} onClick={() => { setDraft({ ...item, ...(item.kind === 'modal' && item.audience === 'all' ? { audience: 'visitors' as const } : {}) }); setFileName(''); setPreviewUrl(''); setConfirmation(null); }}><Pencil aria-hidden="true" />{kind === 'banner' ? 'Cambiar imagen' : 'Editar'}</button>
            <button type="button" className={action} disabled={busy || !!draft} onClick={() => void persist(content!.items.map(i => i.id === item.id ? { ...i, active: !i.active } : i))}>{item.active ? 'Ocultar' : 'Mostrar'}</button>
            <button type="button" className={action} disabled={busy || !!draft || index === 0} onClick={() => move(item, -1)}><ArrowUp aria-hidden="true" />Subir</button>
            <button type="button" className={action} disabled={busy || !!draft || index === rows.length - 1} onClick={() => move(item, 1)}><ArrowDown aria-hidden="true" />Bajar</button>
            <button type="button" className={action + ' is-danger'} disabled={busy || !!draft} onClick={() => { if (window.confirm(kind === 'banner' ? '¿Eliminar esta imagen del carrusel?' : `¿Eliminar «${item.title}» del menú?`)) void persist(content!.items.filter(i => i.id !== item.id)); }}><Trash2 aria-hidden="true" />Eliminar</button>
          </div>
        </div>
      </article>)}</div>
    </section>

    {confirmation && <div className="wl-confirm-overlay" role="status" aria-live="polite" onClick={() => setConfirmation(null)}>
      <div className="wl-confirm-card" onClick={event => event.stopPropagation()}>
        <span className="wl-confirm-check"><Check aria-hidden="true" /></span>
        <strong>{confirmation.title}</strong>
        <span>{confirmation.detail}</span>
      </div>
    </div>}
  </section>;
}
