'use client';

import { memo } from 'react';

type RatingModalProps = {
  open: boolean;
  isPickup: boolean;
  bizType?: string | null;
  restaurantRating: number;
  onRestaurantRatingChange: (value: number) => void;
  driverRating: number;
  onDriverRatingChange: (value: number) => void;
  submitting: boolean;
  onSkip: () => void;
  onSubmit: () => void;
};

const STAR_BASE = 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z';

export default memo(function RatingModal({
  open,
  isPickup,
  bizType,
  restaurantRating,
  onRestaurantRatingChange,
  driverRating,
  onDriverRatingChange,
  submitting,
  onSkip,
  onSubmit,
}: RatingModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6" onClick={(e) => e.stopPropagation()}>
      <div className="w-full max-w-md h-fit max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="relative overflow-hidden rounded-3xl border border-neutral-100 bg-white shadow-[0_16px_60px_-16px_rgba(15,23,42,0.25),0_4px_16px_rgba(0,0,0,0.08)]">
          {/* Encabezado limpio */}
          <div className="px-6 pb-2 pt-8 text-center">
            <div className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 ring-8 ring-emerald-50/40">
              {isPickup ? (
                <svg className="h-8 w-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" /></svg>
              ) : (
                <span className="text-3xl leading-none">🎉</span>
              )}
            </div>
            <h3 className="mt-5 text-xl font-black tracking-tight text-neutral-950">
              {isPickup ? '¡Pedido recogido!' : '¡Tu pedido ha llegado!'}
            </h3>
            <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-neutral-500">
              {isPickup ? 'Gracias por comprar con SaDeL. Tu opinión nos ayuda a mejorar cada día.' : (bizType && bizType !== 'RESTAURANT' ? '¡Disfruta tu pedido! Gracias por confiar en SaDeL.' : '¡Buen provecho! Gracias por pedir con SaDeL.')}
            </p>
          </div>

          {/* Contenido */}
          <div className="space-y-5 px-6 pb-6 pt-5">
            <div className="rounded-2xl border border-neutral-100 bg-neutral-50/60 px-4 py-4">
              <label className="text-sm font-bold text-neutral-800 block mb-2 text-center">
                {bizType && bizType !== 'RESTAURANT' ? '¿Qué tal estuvo tu pedido?' : '¿Qué tal estuvo la comida?'}
              </label>
              <div className="flex gap-2 justify-center">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    aria-label={`${star} estrellas`}
                    onClick={() => onRestaurantRatingChange(star)}
                    className={`transition-all duration-150 hover:scale-125 active:scale-95 ${
                      restaurantRating >= star ? 'text-amber-400 drop-shadow-[0_2px_6px_rgba(251,191,36,0.5)]' : 'text-neutral-200 hover:text-amber-300'
                    }`}
                  >
                    <svg className="h-8 w-8" fill="currentColor" viewBox="0 0 24 24"><path d={STAR_BASE} /></svg>
                  </button>
                ))}
              </div>
            </div>

            {!isPickup && (
              <div className="rounded-2xl border border-neutral-100 bg-neutral-50/60 px-4 py-4">
                <label className="text-sm font-bold text-neutral-800 block mb-2 text-center">¿Qué tal el servicio de entrega?</label>
                <div className="flex gap-2 justify-center">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      aria-label={`${star} estrellas`}
                      onClick={() => onDriverRatingChange(star)}
                      className={`transition-all duration-150 hover:scale-125 active:scale-95 ${
                        driverRating >= star ? 'text-amber-400 drop-shadow-[0_2px_6px_rgba(251,191,36,0.5)]' : 'text-neutral-200 hover:text-amber-300'
                      }`}
                    >
                      <svg className="h-8 w-8" fill="currentColor" viewBox="0 0 24 24"><path d={STAR_BASE} /></svg>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={onSkip}
                disabled={submitting}
                className="flex-1 rounded-full border border-neutral-200 bg-white text-sm font-bold text-neutral-600 py-3 transition hover:bg-neutral-50 hover:text-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Saltar
              </button>
              <button
                type="button"
                onClick={onSubmit}
                disabled={restaurantRating === 0 || submitting}
                className="flex-1 rounded-full bg-gradient-to-r from-sky-500 to-blue-600 text-sm font-bold text-white py-3 shadow-[0_8px_20px_-6px_rgba(2,132,199,0.5)] transition hover:from-sky-600 hover:to-blue-700 hover:shadow-[0_10px_24px_-6px_rgba(2,132,199,0.6)] disabled:cursor-not-allowed disabled:from-neutral-200 disabled:to-neutral-200 disabled:shadow-none"
              >
                {submitting ? 'Enviando...' : 'Enviar calificación'}
              </button>
            </div>
            <p className="text-center text-[11px] font-medium text-neutral-400">
              Tu calificación ayuda a otros usuarios de SaDeL
            </p>
          </div>
        </div>
      </div>
    </div>
  );
});