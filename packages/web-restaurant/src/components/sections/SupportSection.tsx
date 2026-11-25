'use client';

import { SectionHeader } from '../SectionHeader';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Clock3, MessageSquareText, RefreshCw, Search, Send, Star } from 'lucide-react';

type Report = { id: string; type: 'APP' | 'ORDER'; subject?: string | null; description: string; orderNumber?: string | null; status: string; response?: string | null; createdAt: string; customer?: { user?: { name: string; lastName?: string | null } } };
type Review = { id: string; rating: number; comment?: string | null; createdAt: string; customer: { user: { name: string; lastName?: string | null } }; order?: { orderReference: string; dailyCounter?: number | null } | null };
type Result<T> = { items: T[]; total: number; page: number; limit: number; counts?: { status: string; _count: { _all: number } }[]; summary?: { average: number | null; total: number } };
const labels: Record<string, string> = { PENDING: 'Pendiente', IN_PROGRESS: 'En revisión', RESOLVED: 'Resuelto' };
const date = (value: string) => new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const name = (user?: { name: string; lastName?: string | null }) => [user?.name, user?.lastName].filter(Boolean).join(' ') || 'Cliente';

export function SupportSection({ apiBase, token }: { apiBase: string; token: string }) {
  const [tab, setTab] = useState<'reports' | 'reviews'>('reports');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const [type, setType] = useState('ALL');
  const [rating, setRating] = useState('ALL');
  const [reports, setReports] = useState<Result<Report> | null>(null);
  const [reviews, setReviews] = useState<Result<Review> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { response: string; status: string }>>({});
  const [revision, setRevision] = useState(0);

  const request = useCallback(async (path: string, options: RequestInit = {}, signal?: AbortSignal) => {
    const response = await fetch(apiBase + path, { ...options, signal, headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) }, cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || 'No se pudo completar la solicitud.');
    return result;
  }, [apiBase, token]);

  useEffect(() => { const timer = window.setTimeout(() => { setPage(1); setQuery(search.trim()); }, 350); return () => window.clearTimeout(timer); }, [search]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    const params = new URLSearchParams({ page: String(page), limit: '10', search: query });
    if (tab === 'reports') { params.set('status', status); params.set('type', type); } else params.set('rating', rating);
    void request(`${tab === 'reports' ? '/restaurant-panel/soporte/lista' : '/restaurant-panel/resenas'}?${params}`, {}, controller.signal)
      .then(result => { if (tab === 'reports') setReports(result.data); else setReviews(result.data); })
      .catch(err => { if (!controller.signal.aborted) setError(err.message || 'No se pudieron cargar los datos.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [request, tab, page, query, status, type, rating, revision]);

  async function save(report: Report) {
    const draft = drafts[report.id] || { response: report.response || '', status: report.status };
    if (!draft.response.trim()) { setError('Escribe una respuesta antes de guardar.'); return; }
    setSaving(report.id); setError(''); setNotice('');
    try {
      await request(`/restaurant-panel/soporte/${encodeURIComponent(report.id)}`, { method: 'PATCH', body: JSON.stringify(draft) });
      setNotice('Respuesta guardada. El cliente puede consultarla en su Centro de Ayuda.');
      setExpanded(null); setRevision(value => value + 1);
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar la respuesta.'); }
    finally { setSaving(''); }
  }
  const result = tab === 'reports' ? reports : reviews;
  const pages = Math.max(1, Math.ceil((result?.total || 0) / 10));
  const count = (key: string) => reports?.counts?.find(item => item.status === key)?._count._all || 0;
  const switchTab = (next: 'reports' | 'reviews') => { setTab(next); setPage(1); setSearch(''); setQuery(''); setExpanded(null); setNotice(''); setError(''); };

  return <section className="wl-feedback" aria-labelledby="feedback-title">
    <SectionHeader title="Reportes de clientes" titleId="feedback-title" icon={<MessageSquareText />} description="Escucha, responde y mejora cada experiencia." action={<button type="button" className="wl-orders-refresh" onClick={() => setRevision(value => value + 1)} disabled={loading}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Actualizar</button>} />
    <div className="wl-feedback-tabs" role="tablist" aria-label="Atención al cliente"><button type="button" role="tab" aria-selected={tab === 'reports'} onClick={() => switchTab('reports')}><MessageSquareText size={17} /> Reportes</button><button type="button" role="tab" aria-selected={tab === 'reviews'} onClick={() => switchTab('reviews')}><Star size={17} /> Reseñas</button></div>
    <div className={`wl-feedback-stats ${tab === 'reviews' ? 'wl-feedback-stats--reviews' : ''}`}>{tab === 'reports' ? <><div><span><Clock3 size={17} /> Pendientes</span><strong>{reports ? count('PENDING') : '—'}</strong></div><div><span><AlertCircle size={17} /> En revisión</span><strong>{reports ? count('IN_PROGRESS') : '—'}</strong></div><div><span><CheckCircle2 size={17} /> Resueltos</span><strong>{reports ? count('RESOLVED') : '—'}</strong></div></> : <><div><span><Star size={17} /> Calificación promedio</span><strong>{reviews?.summary?.average != null ? reviews.summary.average.toFixed(1) : '—'} <small>/ 5</small></strong></div><div><span><MessageSquareText size={17} /> Reseñas recibidas</span><strong>{reviews?.summary?.total ?? '—'}</strong></div></>}</div>
    <div className="wl-feedback-panel" role="tabpanel"><div className="wl-feedback-panel-head"><div><h2>{tab === 'reports' ? 'Reportes de clientes' : 'Reseñas del restaurante'}</h2><p>{tab === 'reports' ? 'Consulta los reportes y responde directamente a cada cliente.' : 'Conoce las calificaciones y comentarios asociados a cada pedido.'}</p></div><span>{result?.total ?? 0} {result?.total === 1 ? 'resultado' : 'resultados'}</span></div>
      <div className="wl-feedback-filters"><label className="wl-feedback-search"><Search size={17} /><span className="sr-only">Buscar</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por cliente, pedido o comentario" /></label>{tab === 'reports' ? <><label><span className="sr-only">Estado</span><select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="ALL">Todos los estados</option><option value="PENDING">Pendientes</option><option value="IN_PROGRESS">En revisión</option><option value="RESOLVED">Resueltos</option></select></label><label><span className="sr-only">Tipo de reporte</span><select value={type} onChange={event => { setType(event.target.value); setPage(1); }}><option value="ALL">Todos los tipos</option><option value="ORDER">Pedidos</option><option value="APP">Aplicación</option></select></label></> : <label><span className="sr-only">Calificación</span><select value={rating} onChange={event => { setRating(event.target.value); setPage(1); }}><option value="ALL">Todas las estrellas</option>{[5,4,3,2,1].map(value => <option value={value} key={value}>{value} {value === 1 ? 'estrella' : 'estrellas'}</option>)}</select></label>}</div>
      {error && <p className="wl-feedback-alert is-error" role="alert">{error}</p>}{notice && <p className="wl-feedback-alert" role="status">{notice}</p>}
      {loading ? <div className="wl-feedback-empty" role="status">Cargando información…</div> : !result?.items.length ? <div className="wl-feedback-empty"><span>{tab === 'reports' ? <MessageSquareText /> : <Star />}</span><h3>{query || (tab === 'reports' && (status !== 'ALL' || type !== 'ALL')) || (tab === 'reviews' && rating !== 'ALL') ? 'No encontramos resultados' : tab === 'reports' ? 'Aún no hay reportes' : 'Aún no hay reseñas'}</h3><p>{query ? 'Prueba con otra búsqueda o cambia los filtros.' : tab === 'reports' ? 'Los reportes enviados desde el Centro de Ayuda aparecerán aquí.' : 'Las valoraciones que los clientes dejen en sus pedidos aparecerán aquí.'}</p></div> : tab === 'reports' ? <div className="wl-feedback-list">{reports?.items.map(report => { const draft = drafts[report.id] || { response: report.response || '', status: report.status }; return <article className="wl-feedback-card" key={report.id}><div className="wl-feedback-card-top"><div><div className="wl-feedback-card-labels"><span className={`wl-feedback-badge status-${report.status}`}>{labels[report.status] || report.status}</span><span className="wl-feedback-kind">{report.type === 'ORDER' ? 'Pedido' : 'Aplicación'}</span></div><h3>{report.subject || 'Solicitud de ayuda'}</h3><p className="wl-feedback-meta">{name(report.customer?.user)} · {date(report.createdAt)}{report.orderNumber ? ` · Pedido ${report.orderNumber}` : ''}</p></div></div><p className="wl-feedback-description">{report.description}</p>{report.response && <div className="wl-feedback-reply"><strong>Tu respuesta</strong><p>{report.response}</p></div>}<button type="button" className="wl-feedback-action" aria-expanded={expanded === report.id} onClick={() => setExpanded(expanded === report.id ? null : report.id)}>{expanded === report.id ? 'Cerrar respuesta' : report.response ? 'Editar respuesta' : 'Responder reporte'}</button>{expanded === report.id && <div className="wl-feedback-editor"><label>Respuesta al cliente<textarea rows={4} maxLength={4000} value={draft.response} onChange={event => setDrafts(current => ({ ...current, [report.id]: { ...draft, response: event.target.value } }))} placeholder="Escribe una respuesta clara y amable…" /></label><div><label>Estado<select value={draft.status} onChange={event => setDrafts(current => ({ ...current, [report.id]: { ...draft, status: event.target.value } }))}><option value="PENDING">Pendiente</option><option value="IN_PROGRESS">En revisión</option><option value="RESOLVED">Resuelto</option></select></label><button type="button" disabled={!!saving} onClick={() => void save(report)}><Send size={15} /> {saving === report.id ? 'Guardando…' : 'Guardar respuesta'}</button></div></div>}</article>; })}</div> : <div className="wl-feedback-list">{reviews?.items.map(review => <article className="wl-feedback-card" key={review.id}><div className="wl-feedback-card-top"><div><h3>{name(review.customer.user)}</h3><p className="wl-feedback-meta">{date(review.createdAt)} · {review.order ? `Pedido ${review.order.dailyCounter ? `#${String(review.order.dailyCounter).padStart(2, '0')}` : review.order.orderReference}` : 'Pedido no disponible'}</p></div><div className="wl-feedback-stars" aria-label={`${review.rating} de 5 estrellas`}>{[1,2,3,4,5].map(value => <Star key={value} size={16} fill={value <= review.rating ? 'currentColor' : 'none'} />)}</div></div><p className="wl-feedback-description">{review.comment?.trim() || 'El cliente no agregó un comentario.'}</p></article>)}</div>}
      {!loading && result && result.total > 0 && <footer className="wl-feedback-pagination"><span>Mostrando {(page - 1) * 10 + 1}–{Math.min(page * 10, result.total)} de {result.total}</span><div><button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)} aria-label="Página anterior"><ChevronLeft size={16} /></button><span>Página {page} de {pages}</span><button type="button" disabled={page >= pages} onClick={() => setPage(value => value + 1)} aria-label="Página siguiente"><ChevronRight size={16} /></button></div></footer>}
    </div>
  </section>;
}
