type RatingModalProps = {
  open: boolean;
  isPickup: boolean;
  bizType?: string | null;
  restaurantRating: number;
  onRestaurantRatingChange: (value: number) => void;
  driverRating: number;
  onDriverRatingChange: (value: number) => void;
  comment: string;
  onCommentChange: (value: string) => void;
  submitting: boolean;
  onSkip: () => void;
  onSubmit: () => void;
};

export default function RatingModal({
  open,
  isPickup,
  bizType,
  restaurantRating,
  onRestaurantRatingChange,
  driverRating,
  onDriverRatingChange,
  comment,
  onCommentChange,
  submitting,
  onSkip,
  onSubmit,
}: RatingModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6" onClick={(e) => e.stopPropagation()}>
      <div className="bg-white rounded-2xl border border-black/[0.03] shadow-[0_4px_24px_rgba(0,0,0,0.08)] p-6 w-full max-w-md h-fit max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">{isPickup ? (
              <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" /></svg>
            ) : '🎉'}</span>
          </div>
          <h3 className="text-2xl font-semibold text-neutral-950">{isPickup ? '¡Pedido recogido!' : '¡Tu pedido ha llegado!'}</h3>
          <p className="text-sm text-neutral-500">{isPickup ? 'Gracias por tu compra. ¿Nos ayudas a mejorar calificando tu experiencia?' : (bizType && bizType !== 'RESTAURANT' ? '¡Disfruta tu pedido! ¿Nos ayudas a mejorar calificando tu experiencia?' : '¡Buen provecho! ¿Nos ayudas a mejorar calificando tu experiencia?')}</p>
        </div>

        <div className="space-y-6">
          {/* Calificación Restaurante */}
          <div>
            <label className="text-sm font-medium text-neutral-700 block mb-2 text-center">{bizType && bizType !== 'RESTAURANT' ? '¿Qué tal estuvo tu pedido?' : '¿Qué tal estuvo la comida?'}</label>
            <div className="flex gap-2 justify-center">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => onRestaurantRatingChange(star)}
                  className={`text-3xl transition ${restaurantRating >= star ? 'text-amber-400' : 'text-neutral-200'}`}
                >
                  ★
                </button>
              ))}
            </div>
          </div>

          {/* Calificación Repartidor (solo delivery) */}
          {!isPickup && (
            <div>
              <label className="text-sm font-medium text-neutral-700 block mb-2 text-center">¿Qué tal el servicio de entrega?</label>
              <div className="flex gap-2 justify-center">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => onDriverRatingChange(star)}
                    className={`text-3xl transition ${driverRating >= star ? 'text-amber-400' : 'text-neutral-200'}`}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Comentarios */}
          <div>
            <label htmlFor="rating-comment" className="text-sm font-medium text-neutral-700 block mb-2">
              ¿Algo que quieras agregar?
            </label>
            <textarea
              id="rating-comment"
              value={comment}
              onChange={(e) => onCommentChange(e.target.value)}
              placeholder={bizType && bizType !== 'RESTAURANT' ? 'Cuéntanos qué tal estuvo tu pedido o el servicio...' : 'Cuéntanos qué tal estuvo la comida o el servicio...'}
              className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-neutral-950 outline-none transition focus:border-emerald-300 min-h-[80px] text-sm"
            />
          </div>

          {/* Botones */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onSkip}
              className="flex-1 rounded-full bg-neutral-50 text-sm font-semibold text-neutral-600 py-3 transition hover:bg-neutral-100"
            >
              Saltar
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={restaurantRating === 0 || submitting}
              className="flex-1 rounded-full bg-emerald-600 text-sm font-semibold text-white py-3 transition hover:bg-emerald-500 disabled:bg-emerald-200 disabled:cursor-not-allowed"
            >
              Enviar calificación
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
