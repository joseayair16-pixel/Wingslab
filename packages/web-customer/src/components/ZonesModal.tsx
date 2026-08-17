import { memo } from 'react';
import { Check, ChevronRight, X } from 'lucide-react';

type Zone = {
  regionCode: string;
  regionName: string;
  city?: string | null;
  state?: string | null;
  restaurantCount?: number;
  latitude?: number;
  longitude?: number;
};

export const ZonesModal = memo(function ZonesModal({
  open,
  zones,
  selectedZoneName,
  loading = false,
  onSelectZone,
  onResetZone,
  onClose,
}: {
  open: boolean;
  zones: Zone[];
  selectedZoneName: string | null;
  loading?: boolean;
  onSelectZone: (zone: Zone) => void;
  onResetZone: () => void;
  onClose: () => void;
}) {
  if (!open) return null;

  const isExploring = Boolean(selectedZoneName);

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-sky-950/40 backdrop-blur-md transition-all duration-300 sm:items-center sm:px-4 sm:py-6">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-t-[28px] bg-white shadow-[0_24px_90px_rgba(15,15,15,0.28)] sm:rounded-[28px]">
        <div className="flex items-center justify-between border-b border-black/[0.04] px-5 py-4 sm:px-6">
          <div>
            <h3 className="text-lg font-bold tracking-tight text-neutral-900">Explorar ciudades</h3>
            <p className="mt-0.5 text-xs font-medium text-neutral-500">Zonas donde opera SaDeL</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 transition hover:bg-neutral-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 sm:px-6">
          {loading ? (
            <div className="space-y-2.5">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-[72px] animate-pulse rounded-2xl border border-black/5 bg-neutral-100" />
              ))}
            </div>
          ) : zones.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-neutral-300 bg-neutral-50 py-10 text-center">
              <span className="text-3xl">🗺️</span>
              <p className="mt-3 text-sm font-bold text-neutral-800">No hay zonas disponibles</p>
              <p className="mt-1 max-w-xs text-xs font-medium text-neutral-500">
                Estamos expandiendo nuestra cobertura. Vuelve pronto.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {zones.map((zone) => {
                const isCurrent = selectedZoneName === zone.regionName;
                return (
                  <button
                    key={zone.regionCode}
                    type="button"
                    onClick={() => {
                      onSelectZone(zone);
                      onClose();
                    }}
                    className={`flex w-full items-center justify-between gap-3 rounded-2xl border p-4 text-left transition-all active:scale-[0.98] ${
                      isCurrent
                        ? 'border-sky-200 bg-sky-50/80 ring-2 ring-sky-100'
                        : 'border-black/5 bg-white hover:border-sky-200/60 hover:bg-sky-50/40'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-bold text-neutral-900">{zone.regionName}</p>
                        {zone.state ? (
                          <span className="hidden text-[11px] font-semibold text-neutral-400 sm:inline">
                            {zone.state}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-xs font-medium text-neutral-500">
                        {zone.city ? `${zone.city} · ` : ''}{zone.restaurantCount ?? 0}{' '}
                        {zone.restaurantCount === 1 ? 'lugar' : 'lugares'}
                      </p>
                    </div>
                    {isCurrent ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-500 px-3 py-1.5 text-[11px] font-bold text-white shadow-sm">
                        Explorando
                        <Check className="h-3 w-3" strokeWidth={3} />
                      </span>
                    ) : (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-neutral-100 px-3 py-1.5 text-[11px] font-bold text-neutral-700 transition-colors group-hover:bg-sky-100 group-hover:text-sky-700">
                        Explorar
                        <ChevronRight className="h-3 w-3" strokeWidth={2.5} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-2.5 border-t border-black/[0.04] px-5 py-4 sm:px-6">
          {isExploring && (
            <button
              type="button"
              onClick={onResetZone}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-bold text-sky-700 transition hover:bg-sky-100 active:scale-[0.98]"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
              </svg>
              Volver a mi ubicación
            </button>
          )}
          <p className="text-center text-[11px] font-medium leading-relaxed text-neutral-400">
            Puedes explorar el catálogo de cualquier zona. Al hacer un pedido fuera de tu ubicación, solo se aceptan pagos con transferencia.
          </p>
        </div>
      </div>
    </div>
  );
});
