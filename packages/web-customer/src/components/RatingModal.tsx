'use client';

import { memo } from 'react';

type RatingModalProps = {
  open: boolean;
  isPickup: boolean;
  restaurantRating: number;
  onRestaurantRatingChange: (value: number) => void;
  comment: string;
  onCommentChange: (value: string) => void;
  submitting: boolean;
  onSkip: () => void;
  onSubmit: () => void;
};

const STAR_BASE = 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z';

function RatingStars({ label, value, onChange, disabled }: { label: string; value: number; onChange: (value: number) => void; disabled: boolean }) {
  return (
    <div className="rounded-2xl border border-neutral-100 bg-neutral-50/80 px-3 py-3 dark:border-zinc-800 dark:bg-zinc-800/60">
      <p className="text-center text-sm font-bold text-neutral-800 dark:text-zinc-100">{label}</p>
      <div role="group" aria-label={label} className="mt-1 flex justify-center gap-0.5 sm:gap-2">
        {[1, 2, 3, 4, 5].map((star) => (
          <button key={star} type="button" aria-label={`${star} ${star === 1 ? 'estrella' : 'estrellas'}`} aria-pressed={value === star} disabled={disabled} onClick={() => onChange(star)} className={`flex h-11 w-11 items-center justify-center rounded-xl transition active:scale-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-60 ${value >= star ? 'text-amber-400' : 'text-neutral-300 dark:text-zinc-600'}`}>
            <svg aria-hidden="true" className="h-8 w-8" fill="currentColor" viewBox="0 0 24 24"><path d={STAR_BASE} /></svg>
          </button>
        ))}
      </div>
    </div>
  );
}

export default memo(function RatingModal({
  open,
  isPickup,
  restaurantRating,
  onRestaurantRatingChange,
  comment,
  onCommentChange,
  submitting,
  onSkip,
  onSubmit,
}: RatingModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-sm" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="rating-title" aria-describedby="rating-thanks">
      <div className="max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto rounded-[28px] border border-neutral-100 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 sm:p-6" onClick={(e) => e.stopPropagation()}>
          <div className="text-center">
            <div aria-hidden="true" className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-2xl dark:bg-red-950/50">{isPickup ? '🛍️' : '🎉'}</div>
            <h3 id="rating-title" className="mt-3 text-xl font-black tracking-tight text-neutral-950 dark:text-white">
              {isPickup ? '¡Pedido recogido!' : '¡Tu pedido ha llegado!'}
            </h3>
            <p id="rating-thanks" className="mt-1.5 text-sm text-neutral-500 dark:text-zinc-400">
              Gracias por elegir WingsLab ❤️
            </p>
          </div>
          <div className="mt-5 space-y-3">
            <RatingStars label="¿Qué te pareció nuestro servicio?" value={restaurantRating} onChange={onRestaurantRatingChange} disabled={submitting} />
            <label className="block text-sm font-semibold text-neutral-800 dark:text-zinc-100">
              Comentario <span className="font-normal text-neutral-500 dark:text-zinc-400">(opcional)</span>
              <textarea value={comment} onChange={e => onCommentChange(e.target.value)} disabled={submitting} maxLength={500} rows={3} className="mt-2 block w-full resize-y rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-base font-normal focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-600 dark:border-zinc-700 dark:bg-zinc-800" />
            </label>
            <p className="text-xs text-neutral-500 dark:text-zinc-400">Solo el equipo de WingsLab verá tu reseña.</p>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onSkip}
                disabled={submitting}
                className="min-h-12 flex-1 rounded-2xl border border-neutral-200 bg-white px-3 text-sm font-bold text-neutral-600 transition hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
              >
                Saltar
              </button>
              <button
                type="button"
                onClick={onSubmit}
                disabled={restaurantRating === 0 || submitting}
                className="min-h-12 flex-[1.5] rounded-2xl bg-red-600 px-3 text-sm font-bold text-white transition hover:bg-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting ? 'Enviando...' : 'Enviar calificación'}
              </button>
            </div>
          </div>
      </div>
    </div>
  );
});
