'use client';

import { useEffect, useRef, useState } from 'react';
import { MENU_PROMOTIONS_PATH, menuPromotionImage, readMenuPromotions, type MenuPromotion as Item } from '../lib/menu-promotions';

const safePath = (value: string) => /^\/(?!\/)[a-zA-Z0-9/_?#=&.-]*$/.test(value) && !value.includes('..');

function BannerPlaceholder({ busy = false }: { busy?: boolean }) {
  return <div className="wl-banner-empty" aria-hidden={busy || undefined}>
    <span className="wl-banner-brand">WingsLab</span>
    <p>Tu próximo antojo está aquí</p>
    {!busy && <span>Explora nuestro menú.</span>}
  </div>;
}

function BannerImage({ src, alt, eager }: { src: string; alt: string; eager: boolean }) {
  const [status, setStatus] = useState<'pending' | 'ready' | 'failed'>('pending');
  return <>
    {status !== 'ready' && <BannerPlaceholder busy={status === 'pending'} />}
    {status !== 'failed' && <img src={src} alt={alt} loading={eager ? 'eager' : 'lazy'} fetchPriority={eager ? 'high' : 'low'}
      decoding="async" onLoad={() => setStatus('ready')} onError={() => setStatus('failed')} />}
  </>;
}

export function MenuPromotions({ apiBase, token, authReady, initialBanners, viewerId, allowModal }: {
  apiBase: string; token: string; authReady: boolean; initialBanners: Item[]; viewerId?: string; allowModal: boolean;
}) {
  const [feed, setFeed] = useState<{ apiBase: string; token: string; items: Item[] } | null>(null);
  const [modal, setModal] = useState<Item | null>(null);
  const [clock, setClock] = useState(Date.now()), [index, setIndex] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null), shown = useRef(false);
  const bannerTrack = useRef<HTMLDivElement>(null);
  const bannerPauseUntil = useRef(0);
  const seenInMemory = useRef(new Set<string>());
  useEffect(() => {
    if (!authReady) return;
    let alive = true;
    let controller: AbortController | null = null;
    setModal(null); shown.current = false;
    const load = async () => {
      if (controller) return;
      const request = new AbortController();
      controller = request;
      const timeout = window.setTimeout(() => request.abort(), 8000);
      try {
        const response = await fetch(`${apiBase}${MENU_PROMOTIONS_PATH}`, {
          signal: request.signal,
          cache: 'no-store', headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) return;
        const items = readMenuPromotions(await response.json());
        if (alive && items) { setFeed({ apiBase, token, items }); setClock(Date.now()); }
      } catch { /* Optional marketing content must never block the menu or checkout. */ }
      finally { window.clearTimeout(timeout); controller = null; }
    };
    void load();
    const timer = window.setInterval(() => { setClock(Date.now()); void load(); }, 60000);
    return () => { alive = false; controller?.abort(); clearInterval(timer); };
  }, [apiBase, token, authReady]);
  const items = feed?.apiBase === apiBase && feed.token === token ? feed.items : initialBanners;
  const current = items.filter(item => (!item.startsAt || Date.parse(item.startsAt) <= clock) && (!item.endsAt || Date.parse(item.endsAt) > clock));
  const banners = current.filter(item => item.kind === 'banner');
  useEffect(() => {
    if (banners.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => {
      const track = bannerTrack.current;
      if (!track || Date.now() < bannerPauseUntil.current || document.hidden || track.contains(document.activeElement) || document.querySelector('dialog[open], [aria-modal="true"]')) return;
      const next = (Math.round(track.scrollLeft / track.clientWidth) + 1) % banners.length;
      track.scrollTo({ left: next * track.clientWidth, behavior: 'smooth' });
    }, 6500);
    return () => clearInterval(timer);
  }, [banners.length]);
  useEffect(() => {
    if (!allowModal || shown.current || modal) return;
    const timer = window.setTimeout(() => {
      // Do not compete with authentication, checkout or another modal.
      if (document.querySelector('dialog[open], [aria-modal="true"]')) return;
      const candidate = current.find(item => {
        if (item.kind !== 'modal') return false;
        const key = `wingslab.promotion.${viewerId || 'visitor'}.${item.id}`;
        if (seenInMemory.current.has(key)) return false;
        try {
          const value = (item.frequency === 'session' ? sessionStorage : localStorage).getItem(key);
          return !value || (item.frequency === 'daily' && Date.now() - Number(value) >= 86400000);
        } catch { return true; }
      });
      if (!candidate) return;
      const key = `wingslab.promotion.${viewerId || 'visitor'}.${candidate.id}`;
      try { (candidate.frequency === 'session' ? sessionStorage : localStorage).setItem(key, String(Date.now())); } catch {}
      seenInMemory.current.add(key); shown.current = true; setModal(candidate);
    }, 1200);
    return () => clearTimeout(timer);
  }, [allowModal, items, clock, viewerId, modal]);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (modal && allowModal) { if (!element.open) element.showModal(); }
    else if (element.open) element.close();
  }, [modal, allowModal]);
  useEffect(() => {
    if (modal && !current.some(item => item.id === modal.id)) setModal(null);
  }, [items, clock, modal]);
  const image = (item: Item) => menuPromotionImage(apiBase, item.imageId);
  return <>
    <section aria-label="Promociones de WingsLab" aria-roledescription="carrusel" className="wl-banner-carousel">
      {banners.length ? <>
        <div ref={bannerTrack} className="wl-banner-track" tabIndex={0} aria-label="Banners promocionales, desliza para explorar" onPointerDown={() => { bannerPauseUntil.current = Date.now() + 13000; }} onScroll={event => { const track = event.currentTarget; setIndex(Math.round(track.scrollLeft / track.clientWidth)); }}>
          {banners.map((item, position) => <div key={item.id} className="wl-banner-slide" role="group" aria-roledescription="diapositiva" aria-label={`${position + 1} de ${banners.length}`}>
            {/* Las imágenes promocionales son solo imágenes: sin enlaces ni botones. */}
            <BannerImage key={image(item)} src={image(item)} alt={item.title} eager={position === 0} />
          </div>)}
        </div>
        {banners.length > 1 && <div className="wl-banner-dots" aria-label="Elegir promoción">{banners.map((item, position) => <button key={item.id} type="button" aria-label={`Ver promoción ${position + 1}`} aria-current={index === position ? 'true' : undefined} onClick={() => bannerTrack.current?.scrollTo({ left: position * bannerTrack.current.clientWidth, behavior: 'smooth' })}><span /></button>)}</div>}
      </> : <BannerPlaceholder />}
    </section>
    <dialog ref={dialog} aria-labelledby="welcome-promotion-title" onCancel={() => setModal(null)} onClose={() => setModal(null)} className="wl-promotion-dialog m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-3xl border-0 bg-white p-0 text-neutral-900 shadow-2xl backdrop:bg-black/60">
      {modal && <><div className="flex justify-end p-3"><button type="button" autoFocus aria-label="Cerrar promoción" className="rounded-full border px-4 py-2 font-semibold" onClick={() => setModal(null)}>Cerrar ✕</button></div><img src={image(modal)} alt={modal.title} className="max-h-[50dvh] w-full object-contain" /><div className="space-y-3 p-6"><h2 id="welcome-promotion-title" className="text-xl font-bold">{modal.title}</h2>{modal.text && <p className="text-sm text-neutral-600">{modal.text}</p>}{safePath(modal.targetUrl) && <a className="inline-block rounded-xl bg-neutral-950 px-5 py-3 font-semibold text-white" href={modal.targetUrl}>{modal.buttonLabel || 'Ver más'}</a>}</div></>}
    </dialog>
  </>;
}
