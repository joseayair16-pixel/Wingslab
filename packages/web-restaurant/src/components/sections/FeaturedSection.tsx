'use client';

import React from 'react';

interface FeaturedSectionProps {
  featuredPackages: { days: number; price: number }[];
  featuredRequests: any[];
  featuredFlyerUploading: boolean;
  showPhonePreviewModal: boolean;
  setFeaturedDays: React.Dispatch<React.SetStateAction<number>>;
  setFeaturedPaymentProof: React.Dispatch<React.SetStateAction<string>>;
  setShowFeaturedModal: React.Dispatch<React.SetStateAction<boolean>>;
  setProofPreviewUrl: React.Dispatch<React.SetStateAction<string | null>>;
  setShowPhonePreviewModal: React.Dispatch<React.SetStateAction<boolean>>;
  setFeaturedFlyerUploading: React.Dispatch<React.SetStateAction<boolean>>;
  profile: any;
  setProfile: React.Dispatch<React.SetStateAction<any>>;
  token: string;
  apiBase: string;
  pushToast: (tone: 'error' | 'success' | 'info', title: string, message: string) => void;
}

export const FeaturedSection = React.memo(function FeaturedSection({
  featuredPackages,
  featuredRequests,
  featuredFlyerUploading,
  showPhonePreviewModal,
  setFeaturedDays,
  setFeaturedPaymentProof,
  setShowFeaturedModal,
  setProofPreviewUrl,
  setShowPhonePreviewModal,
  setFeaturedFlyerUploading,
  profile,
  setProfile,
  token,
  apiBase,
  pushToast,
}: FeaturedSectionProps) {
  return (
    <>
      {showPhonePreviewModal ? (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/60 px-4 py-5 backdrop-blur-sm animate-fade-in"
          onClick={() => setShowPhonePreviewModal(false)}>
          <div className="relative flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}>
            {/* Close button */}
            <button onClick={() => setShowPhonePreviewModal(false)}
              className="absolute -top-12 right-0 sm:right-auto sm:-top-12 sm:left-1/2 sm:-translate-x-1/2 flex items-center gap-1.5 rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-neutral-700 shadow-lg hover:bg-white hover:text-neutral-900 transition-all z-10">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              Cerrar vista previa
            </button>
            {/* Phone frame */}
            <div className="relative w-[280px] h-[580px] bg-neutral-900 rounded-[44px] p-3 shadow-2xl ring-1 ring-white/10 overflow-hidden">
              <div className="absolute top-0 inset-x-0 h-6 flex justify-center z-20">
                <div className="w-32 h-5.5 bg-neutral-900 rounded-b-2xl"></div>
              </div>
              <div className="relative w-full h-full bg-white rounded-[36px] overflow-hidden flex flex-col">
                {/* Status bar */}
                <div className="flex justify-between items-center px-5 pt-3 pb-0.5 text-[9px] font-bold text-neutral-900">
                  <span>9:41</span>
                  <div className="flex gap-1 items-center">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M15.67 4H14V2h-4v2H8.33C7.6 4 7 4.6 7 5.33v15.33C7 21.4 7.6 22 8.33 22h7.33c.74 0 1.34-.6 1.34-1.33V5.33C17 4.6 16.4 4 15.67 4z"/></svg>
                  </div>
                </div>
                {/* Header */}
                <div className="px-3.5 py-1.5">
                  <h1 className="text-base font-black text-neutral-900">Restaurantes Destacados</h1>
                </div>
                {/* Featured carousel */}
                <div className="overflow-hidden pb-1">
                  <div className="flex gap-2.5 px-3.5">
                    <div className="relative overflow-hidden rounded-[16px] border border-black/5 bg-white w-48 shrink-0 shadow-sm">
                      <img src={profile?.featuredFlyer || profile?.coverImage || '/default-cover.jpg'} alt="" className="h-24 w-full object-cover" loading="lazy" />
                      <div className="absolute top-1.5 left-1.5 bg-white/90 backdrop-blur-sm rounded-full px-2 py-0.5 text-[8px] font-bold text-sky-700 shadow-sm">⭐ Destacado</div>
                      <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/30 to-transparent" />
                      <div className="p-2.5 pt-1.5 flex items-center gap-1.5">
                        <div className="-mt-4 w-8 h-8 rounded-[10px] border-2 border-white bg-white shadow-sm overflow-hidden shrink-0">
                          {profile?.logo ? <img src={profile.logo} alt="" className="w-full h-full object-cover" loading="lazy" /> : <div className="w-full h-full bg-neutral-200 flex items-center justify-center text-[9px] font-bold text-neutral-500">{profile?.name?.[0] || '?'}</div>}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[11px] font-bold text-neutral-900 truncate">{profile?.name || 'Tu restaurante'}</p>
                          <p className="text-[8px] text-neutral-500">🟢 Abierto · ★ 5.0</p>
                        </div>
                      </div>
                    </div>
                    <div className="w-48 shrink-0 rounded-[16px] border border-black/5 bg-neutral-100/60 overflow-hidden opacity-30 h-24" />
                    <div className="w-48 shrink-0 rounded-[16px] border border-black/5 bg-neutral-100/60 overflow-hidden opacity-20 h-24" />
                  </div>
                </div>
                {/* Divider */}
                <div className="mx-3.5 my-1.5 border-t border-neutral-100" />
                <div className="px-3.5 mb-1.5"><p className="text-[10px] font-semibold text-neutral-400">Restaurantes disponibles</p></div>
                {/* Restaurant list */}
                <div className="flex-1 px-3.5 space-y-1.5 overflow-hidden">
                  {[
                    ['🍕', 'from-amber-400 to-orange-500', 'Pizza Italia', true, '★ 4.8', '$$', true],
                    ['🌮', 'from-red-500 to-rose-600', 'Taquería El Norteño', true, '★ 4.6', '$', true],
                    ['🥗', 'from-green-600 to-emerald-700', 'Verde Vida', false, '★ 4.9', '$$', false],
                    ['🍣', 'from-blue-500 to-cyan-600', 'Sushi Master', true, '★ 4.3', '$$$', false],
                  ].map(([icon, color, name, isOpen, rating, price, fullOpacity]) => (
                    <div key={name as string} className={`flex items-center gap-2 rounded-xl border border-black/5 bg-white p-2 shadow-sm ${fullOpacity ? '' : 'opacity-50'}`}>
                      <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${color} shrink-0 flex items-center justify-center text-white text-base`}>{icon}</div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold text-neutral-900 truncate">{name as string}</p>
                        <p className="text-[8px] text-neutral-500">{(isOpen as boolean) ? '🟢 Abierto' : '🔴 Cerrado'} · {rating} · 1.2 km</p>
                      </div>
                      <span className="text-[9px] font-semibold text-neutral-500">{price}</span>
                    </div>
                  ))}
                </div>
                {/* Home indicator */}
                <div className="absolute bottom-1.5 inset-x-0 flex justify-center">
                  <div className="w-20 h-1 bg-black/15 rounded-full"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="space-y-5">
          {/* Promo Banner */}
          <div className="rounded-2xl bg-gradient-to-br from-sky-50 to-blue-50 border border-sky-200 p-5 sm:p-6">
            <div className="flex items-start gap-3 sm:gap-5 flex-col sm:flex-row">
              <div className="w-11 h-11 rounded-full bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center shrink-0 shadow-md">
                <span className="text-xl">⭐</span>
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-bold text-sky-950">Aparece en los destacados</h2>
                <p className="text-sky-700/80 text-sm mt-0.5 leading-relaxed">
                  Tu restaurante aparecerá en el carrusel que los clientes ven <strong>primero</strong> al abrir la app.
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {['📈 Mayor visibilidad', '🏆 Primero en la app', `💰 Desde $${featuredPackages.length > 0 ? Math.min(...featuredPackages.map(p => p.price)) : '—'} MXN`].map(tag => (
                    <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-sky-100/80 px-2.5 py-0.5 text-[11px] font-medium text-sky-700">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <button onClick={() => { setFeaturedDays(1); setFeaturedPaymentProof(''); setShowFeaturedModal(true); }}
                className="shrink-0 w-full sm:w-auto rounded-xl bg-gradient-to-r from-sky-600 to-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all duration-200">
                Aparecer en destacados
              </button>
            </div>
          </div>

          {/* Flyer Upload */}
          <div className="rounded-xl border border-black/5 bg-white p-4 sm:p-5 shadow-sm">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-sky-100 to-blue-100 flex items-center justify-center">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sky-700"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              </div>
              <div>
                <p className="text-sm font-bold text-neutral-900">Flyer promocional</p>
                <p className="text-[11px] text-neutral-500">Portada del carrusel de destacados</p>
              </div>
            </div>
            <div className="flex items-start gap-3 flex-col sm:flex-row">
              <div className="w-full sm:w-40 h-24 rounded-lg border-2 border-dashed border-neutral-200 overflow-hidden shrink-0 bg-neutral-50 flex items-center justify-center">
                {profile?.featuredFlyer ? (
                  <img src={profile.featuredFlyer} alt="" className="w-full h-full object-cover" loading="lazy" />
                ) : (
                  <div className="text-center">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-300 mx-auto mb-0.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                    <p className="text-[10px] text-neutral-400">Sin flyer</p>
                  </div>
                )}
              </div>
              <div className="flex-1 flex flex-wrap items-center gap-2">
                <button disabled={featuredFlyerUploading}
                  onClick={async () => {
                    const input = document.createElement('input');
                    input.type = 'file'; input.accept = 'image/*';
                    input.onchange = async () => {
                      const file = input.files?.[0]; if (!file) return;
                      setFeaturedFlyerUploading(true);
                      try {
                        const reader = new FileReader();
                        const base64 = await new Promise<string>(resolve => { reader.onload = () => resolve(reader.result as string); reader.readAsDataURL(file); });
                        const uploadRes = await fetch(`${apiBase}/uploads/images`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                          body: JSON.stringify({ kind: 'restaurant-cover', source: base64 }),
                        });
                        const uploadData = await uploadRes.json();
                        if (uploadData.success) {
                          const res = await fetch(`${apiBase}/restaurant-panel/perfil`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                            body: JSON.stringify({ featuredFlyer: uploadData.data.url }),
                          });
                          if ((await res.json()).success) {
                            setProfile((prev: any) => prev ? { ...prev, featuredFlyer: uploadData.data.url } : prev);
                            pushToast('success', 'Flyer actualizado', 'Se actualizó correctamente.');
                          }
                        } else pushToast('error', 'Error', 'No se pudo subir la imagen.');
                      } catch { pushToast('error', 'Error', 'Error al subir la imagen.'); }
                      finally { setFeaturedFlyerUploading(false); }
                    }; input.click();
                  }}
                  className="rounded-lg bg-sky-600 px-3.5 py-2 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-50 transition-colors">
                  {featuredFlyerUploading ? 'Subiendo...' : profile?.featuredFlyer ? 'Cambiar' : 'Subir flyer'}
                </button>
                {profile?.featuredFlyer && (
                  <button onClick={() => {
                    if (!confirm('¿Eliminar flyer?')) return;
                    fetch(`${apiBase}/restaurant-panel/perfil`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                      body: JSON.stringify({ featuredFlyer: null }),
                    }).then(r => r.json()).then(d => { if (d.success) { setProfile((prev: any) => prev ? { ...prev, featuredFlyer: null } : prev); pushToast('success', 'Flyer eliminado', 'Se usará tu portada actual.'); } }).catch(() => pushToast('error', 'Error', 'No se pudo eliminar.'));
                  }} className="rounded-lg border border-rose-200 px-3.5 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50 transition-colors">Eliminar</button>
                )}
                <p className="w-full text-[11px] text-neutral-400">1200×600 px recomendado. Si no subes flyer, se usará tu portada.</p>
              </div>
            </div>
          </div>

          {/* Payment History */}
          <div>
            <h3 className="text-base font-bold text-neutral-900 mb-3">Historial de pagos</h3>
            {featuredRequests.length > 0 ? (
              <div className="space-y-2">
                {featuredRequests.map((req: any) => (
                  <div key={req.id} className="rounded-xl border border-black/5 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-bold text-neutral-900 text-sm">${(req.totalPrice ?? 0).toFixed(2)} MXN</p>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            req.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800' :
                            req.status === 'REJECTED' ? 'bg-rose-100 text-rose-800' :
                            req.status === 'EXPIRED' ? 'bg-neutral-100 text-neutral-500' :
                            'bg-sky-100 text-sky-700'
                          }`}>
                            {req.status === 'PENDING' ? 'Pendiente' : req.status === 'APPROVED' ? 'Aprobado' : req.status === 'REJECTED' ? 'Rechazado' : 'Vencido'}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[11px] text-neutral-500">
                          <span>📅 {new Date(req.createdAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                          <span>📆 {req.daysRequested} día(s)</span>
                          {req.startDate && <span>🟢 {new Date(req.startDate).toLocaleDateString('es-MX')} — {new Date(req.endDate).toLocaleDateString('es-MX')}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {req.paymentProof && (
                          <button onClick={() => setProofPreviewUrl(req.paymentProof)}
                            className="flex items-center gap-1 rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-neutral-600 hover:bg-neutral-50 transition-colors">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                            Comprobante
                          </button>
                        )}
                        {req.adminNotes && (
                          <div className="group relative">
                            <span className="flex items-center gap-1 rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-neutral-600 cursor-default">📝 Notas</span>
                            <div className="absolute bottom-full right-0 mb-1.5 w-56 rounded-xl border border-black/10 bg-white p-2.5 text-[11px] text-neutral-700 shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none z-10">{req.adminNotes}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-black/10 bg-neutral-50/50 p-6 text-center">
                <p className="text-sm text-neutral-500 font-medium">Sin solicitudes aún</p>
                <p className="text-[11px] text-neutral-400 mt-0.5">Cada solicitud quedará registrada aquí.</p>
              </div>
            )}
          </div>

        <button onClick={() => setShowPhonePreviewModal(true)}
          className="w-full rounded-xl border-2 border-dashed border-sky-300 bg-sky-50/50 p-4 text-center hover:bg-sky-100/50 hover:border-sky-400 active:bg-sky-100 transition-all duration-200 group cursor-pointer">
          <div className="flex items-center justify-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center shadow-md group-hover:scale-105 transition-transform">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
            </div>
            <div className="text-left">
              <p className="text-sm font-bold text-sky-900">Ver vista previa</p>
              <p className="text-[11px] text-sky-600/80">Así se verá tu restaurante en el carrusel de destacados</p>
            </div>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sky-400 shrink-0 group-hover:translate-x-0.5 transition-transform"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        </button>
      </div>
    </>
  );
});
