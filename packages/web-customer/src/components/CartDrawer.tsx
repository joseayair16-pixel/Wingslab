'use client';

import { memo, useMemo } from 'react';
import { useCartStore, type CartItem } from '../store/cartStore';

function formatCurrency(amount: number) {
  return '$' + Math.round(amount).toLocaleString('es-MX');
}

type CartDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  onProceedToCheckout: () => void;
  fulfillmentType: 'DELIVERY' | 'PICKUP';
  onFulfillmentTypeChange: (type: 'DELIVERY' | 'PICKUP') => void;
  isRestaurantOpen?: boolean;
  overrideDeliveryFee?: number;
  overrideServiceFee?: number;
};

export default memo(function CartDrawer({
  isOpen,
  onClose,
  onProceedToCheckout,
  fulfillmentType,
  onFulfillmentTypeChange,
  isRestaurantOpen = true,
  overrideDeliveryFee,
  overrideServiceFee,
}: CartDrawerProps) {
  const cart = useCartStore(state => state.items);
  const updateCartItem = useCartStore(state => state.updateItem);
  const storeServiceFee = useCartStore(state => state.serviceFee);
  const storeDeliveryFee = useCartStore(state => state.deliveryFee);

  const serviceFee = overrideServiceFee ?? storeServiceFee;
  const deliveryFee = overrideDeliveryFee ?? storeDeliveryFee;

  const cartSubtotal = useMemo(
    () => cart.reduce((sum, item) => {
      const basePrice = item.discountPrice ? Number(item.discountPrice) : Number(item.price);
      const optionsPrice = (item.selectedOptions || []).reduce((s, o) => s + Number(o.price), 0);
      return sum + (basePrice + optionsPrice) * Math.max(0, item.quantity);
    }, 0),
    [cart]
  );

  const totalProducts = useMemo(
    () => cart.reduce((sum, item) => sum + Math.max(0, item.quantity), 0),
    [cart]
  );

  const orderTotal = Math.max(0, cartSubtotal + serviceFee + (fulfillmentType === 'PICKUP' ? 0 : deliveryFee));

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 transition-all duration-300">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" onClick={onClose} />
      <aside
        className={`absolute right-0 top-0 flex h-full w-full max-w-[520px] flex-col overflow-hidden bg-white/95 backdrop-blur-3xl shadow-[0_0_0_1px_rgba(0,0,0,0.04),0_40px_100px_rgba(15,15,15,0.25)] sm:rounded-l-[36px] transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <section className="flex h-full flex-col">
          {/* ── Header ── */}
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-black/[0.04] bg-white px-5 py-4 sm:px-6">
            <div className="flex items-center gap-3.5">
              <div className="relative flex h-12 w-12 items-center justify-center rounded-[18px] bg-gradient-to-br from-neutral-900 to-neutral-700 text-white shadow-lg shadow-neutral-900/20">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 4h2l.4 2M7 14h10l4-8H5.4M7 14l-1.5 2.5A1 1 0 006.4 18H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                {totalProducts > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white shadow-md shadow-accent/30">
                    {totalProducts}
                  </span>
                )}
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-neutral-400">Tu pedido</p>
                <h2 className="text-lg font-bold tracking-[-0.03em] text-neutral-950">Carrito</h2>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 transition-all hover:bg-neutral-200 hover:text-neutral-700 active:scale-90"
              aria-label="Cerrar carrito"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* ── Product List ── */}
          <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-5">
            {cart.length ? (
              <div className="space-y-3">
                {cart.map((item, idx) => {
                  const itemUnitPrice = (() => {
                    const base = item.discountPrice ? Number(item.discountPrice) : Number(item.price);
                    const optionsSum = (item.selectedOptions || []).reduce((s, o) => s + Number(o.price), 0);
                    return base + optionsSum;
                  })();
                  const lineTotal = itemUnitPrice * item.quantity;
                  const isWeightItem = item.sellBy === 'WEIGHT';

                  return (
                    <div
                      key={item.cartItemId}
                      className="group rounded-[22px] border border-black/[0.04] bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)] transition-all hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)]"
                      style={{ animation: `fadeInUp 0.3s ease-out ${idx * 0.05}s both` }}
                    >
                      <div className="flex items-start gap-3.5">
                        {item.image ? (
                          <img src={item.image} className="h-14 w-14 shrink-0 rounded-2xl object-cover" alt={item.name} loading="lazy" decoding="async" />
                        ) : (
                          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-100 to-sky-50 text-2xl">
                            🍽️
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-semibold leading-snug text-neutral-900">{item.name}</p>
                            <span className="shrink-0 rounded-lg bg-neutral-900 px-2.5 py-1 text-xs font-bold text-white shadow-sm">
                              {formatCurrency(lineTotal)}
                            </span>
                          </div>
                          {item.selectedOptions && item.selectedOptions.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {item.selectedOptions.map((opt) => (
                                <span
                                  key={opt.id}
                                  className="inline-flex items-center rounded-full bg-accent-soft px-2.5 py-0.5 text-[11px] font-medium text-accent-hover"
                                >
                                  {opt.name} {opt.price > 0 ? `+${formatCurrency(opt.price)}` : ''}
                                </span>
                              ))}
                            </div>
                          )}
                          {isWeightItem && item.weightG ? (
                            <p className="mt-1.5 text-[11px] text-neutral-400">
                              {item.weightG >= 1000 ? `${item.weightG / 1000}kg` : `${item.weightG}g`} · {formatCurrency(item.unitPrice || 0)}/kg
                            </p>
                          ) : (
                            <p className="mt-1.5 text-[11px] text-neutral-400">
                              {formatCurrency(itemUnitPrice)} c/u
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="mt-3.5 flex items-center gap-2">
                        <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-black/[0.06] bg-neutral-50 p-0.5">
                          <button
                            type="button"
                            onClick={() => updateCartItem(item.cartItemId, { quantity: item.quantity - 1 })}
                            className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 transition-all hover:bg-white hover:text-neutral-800 hover:shadow-sm active:scale-90"
                            aria-label={`Quitar una unidad de ${item.name}`}
                          >
                            {item.quantity === 1 ? (
                              <svg className="h-3 w-3 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            ) : (
                              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20 12H4" />
                              </svg>
                            )}
                          </button>
                          <span className="flex h-7 w-7 items-center justify-center text-xs font-bold text-neutral-900">{item.quantity}</span>
                          <button
                            type="button"
                            onClick={() => updateCartItem(item.cartItemId, { quantity: item.quantity + 1 })}
                            className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 transition-all hover:bg-white hover:text-neutral-800 hover:shadow-sm active:scale-90"
                            aria-label={`Agregar una unidad de ${item.name}`}
                          >
                            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                            </svg>
                          </button>
                        </div>

                        <input
                          value={item.specialInstructions}
                          onChange={(event) => updateCartItem(item.cartItemId, { specialInstructions: event.target.value })}
                          placeholder="Nota..."
                          className="min-w-0 flex-1 rounded-xl border border-transparent bg-neutral-50 px-2.5 py-1.5 text-xs text-neutral-700 outline-none transition-all placeholder:text-neutral-400 focus:border-sky-200 focus:bg-white focus:ring-2 focus:ring-sky-200/50"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center px-6 py-10 text-center relative overflow-hidden min-h-[320px]">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 bg-sky-400/10 rounded-full blur-3xl pointer-events-none" />
                <div className="w-full max-w-[320px] relative z-10">
                  <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-[32px] bg-gradient-to-br from-white to-sky-50/50 shadow-[0_8px_32px_rgba(14,165,233,0.15)] border border-white">
                    <div className="absolute inset-0 rounded-[32px] border border-sky-200/30" />
                    <span className="text-[42px] drop-shadow-sm">🛒</span>
                  </div>
                  <h3 className="mt-8 text-2xl font-black tracking-[-0.03em] text-neutral-900">Tu carrito está vacío</h3>
                  <p className="mt-2 text-[15px] font-medium leading-relaxed text-neutral-500">
                    Explora el menú y agrega productos deliciosos para comenzar tu pedido.
                  </p>
                  <button
                    type="button"
                    onClick={onClose}
                    className="group relative mt-8 inline-flex items-center gap-2 overflow-hidden rounded-full bg-neutral-900 px-8 py-3.5 text-[15px] font-bold text-white shadow-[0_8px_20px_rgba(0,0,0,0.16)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(0,0,0,0.22)] active:scale-[0.98]"
                  >
                    <span className="relative z-10">Explorar menú</span>
                    <svg className="relative z-10 h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                    </svg>
                    <div className="absolute inset-0 bg-gradient-to-r from-neutral-800 to-neutral-900 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── Summary Footer ── */}
          {cart.length ? (
            <div className="sticky bottom-0 z-10 border-t border-black/[0.04] bg-white/90 px-4 pb-3 pt-3 backdrop-blur-xl sm:px-5">
              <div className="rounded-2xl bg-gradient-to-b from-neutral-50 to-neutral-100/60 p-3 ring-1 ring-black/[0.04]">
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between text-neutral-500">
                    <span className="flex items-center gap-1">
                      <span className="text-[10px]"><svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg></span> Productos
                    </span>
                    <span className="font-medium text-neutral-700">{totalProducts}</span>
                  </div>
                  <div className="flex items-center justify-between text-neutral-500">
                    <span className="flex items-center gap-1">
                      <span className="text-[10px]"><svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></span> Subtotal
                    </span>
                    <span className="font-medium text-neutral-700">{formatCurrency(cartSubtotal)}</span>
                  </div>
                  {fulfillmentType !== 'PICKUP' && (
                  <div className="flex items-center justify-between text-neutral-500">
                    <span className="flex items-center gap-1">
                      <span className="text-[10px]">🛵</span> Envío
                    </span>
                    <span className="font-medium text-neutral-700">{formatCurrency(deliveryFee)}</span>
                  </div>
                  )}
                  <div className="flex items-center justify-between text-neutral-500">
                    <span className="flex items-center gap-1">
                      <span className="text-[10px]"><svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" /></svg></span> Servicio
                    </span>
                    <span className="font-medium text-neutral-700">{formatCurrency(serviceFee)}</span>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between rounded-xl bg-neutral-900 px-3.5 py-2.5 shadow-lg shadow-neutral-900/15">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-neutral-300">
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" /></svg>
                    Total a pagar
                  </span>
                  <span className="text-base font-extrabold tracking-tight text-white">{formatCurrency(orderTotal)}</span>
                </div>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-1 rounded-xl bg-neutral-100 p-0.5">
                <button
                  type="button"
                  onClick={() => onFulfillmentTypeChange('DELIVERY')}
                  className={`relative flex items-center justify-center gap-1 rounded-lg px-2.5 py-2 text-[10px] font-bold transition-all duration-200 ${
                    fulfillmentType === 'DELIVERY'
                      ? 'bg-sky-500 text-white shadow-sm shadow-sky-500/30'
                      : 'bg-transparent text-neutral-500 hover:text-neutral-800'
                  }`}
                >
                  {fulfillmentType === 'DELIVERY' && (
                    <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-white shadow-sm">
                      <svg className="h-2.5 w-2.5 text-sky-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  )}
                  <span>🛵</span> Enviar a domicilio
                </button>
                <button
                  type="button"
                  onClick={() => onFulfillmentTypeChange('PICKUP')}
                  className={`relative flex items-center justify-center gap-1 rounded-lg px-2.5 py-2 text-[10px] font-bold transition-all duration-200 ${
                    fulfillmentType === 'PICKUP'
                      ? 'bg-sky-500 text-white shadow-sm shadow-sky-500/30'
                      : 'bg-transparent text-neutral-500 hover:text-neutral-800'
                  }`}
                >
                  {fulfillmentType === 'PICKUP' && (
                    <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-white shadow-sm">
                      <svg className="h-2.5 w-2.5 text-sky-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  )}
                  <span><svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z" /></svg></span> Recoger en tienda
                </button>
              </div>

              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="group flex items-center justify-center gap-1.5 rounded-xl border border-black/[0.06] bg-white px-4 py-2.5 text-sm font-semibold text-neutral-700 shadow-sm transition-all hover:bg-neutral-50 hover:shadow active:scale-[0.97]"
                >
                  <svg className="h-3.5 w-3.5 text-neutral-400 transition-transform group-hover:-translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Seguir comprando
                </button>
                <button
                  type="button"
                  onClick={onProceedToCheckout}
                  disabled={!isRestaurantOpen}
                  className="group relative flex overflow-hidden items-center justify-center gap-2 rounded-xl bg-sky-500 px-6 py-3 text-sm font-bold text-white shadow-[0_4px_16px_-4px_rgba(14,165,233,0.45)] transition-all hover:bg-sky-400 hover:shadow-[0_8px_24px_-6px_rgba(14,165,233,0.55)] active:scale-[0.97] disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 disabled:shadow-none animate-pulse-glow"
                >
                  <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-1000 group-hover:translate-x-full disabled:hidden" />
                  <span className="relative flex items-center justify-center gap-2">
                    Completar pedido
                    <svg className="h-4 w-4 shrink-0 animate-arrow-slide group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                    </svg>
                  </span>
                </button>
              </div>
            </div>
          ) : null}
        </section>
        <style>{`
          @keyframes fadeInUp {
            from { opacity: 0; transform: translateY(12px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @keyframes pulseGlow {
            0%, 60%, 100% {
              transform: scale(1);
              box-shadow: 0 4px 12px -1px rgba(14, 165, 233, 0.25), 0 2px 4px -1px rgba(14, 165, 233, 0.15);
            }
            20% {
              transform: scale(1.015);
              box-shadow: 0 8px 24px -2px rgba(14, 165, 233, 0.4), 0 4px 10px -1px rgba(14, 165, 233, 0.25);
            }
          }
          .animate-pulse-glow:not(:disabled) {
            animation: pulseGlow 2.5s infinite cubic-bezier(0.4, 0, 0.2, 1);
          }
          @keyframes arrowSlide {
            0%, 60%, 100% { transform: translateX(0); }
            20%, 40% { transform: translateX(3px); }
            30% { transform: translateX(1px); }
          }
          .animate-arrow-slide {
            animation: arrowSlide 2.5s infinite ease-in-out;
          }
        `}</style>
      </aside>
    </div>
  );
});
