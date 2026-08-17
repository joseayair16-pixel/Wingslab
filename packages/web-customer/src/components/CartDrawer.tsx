'use client';
import { BadgePercent, Bike, Check, ChevronLeft, ChevronRight, DollarSign, Minus, Plus, Receipt, ShoppingBag, ShoppingBasket, Store, Trash2, Utensils, Wallet, X } from 'lucide-react';

import { memo, useMemo } from 'react';
import { useCartStore } from '../store/cartStore';

function formatCurrency(amount: number) {
  return '$' + Math.round(amount).toLocaleString('es-MX');
}

type CartItemLike = {
  price: number | string;
  discountPrice?: number | string | null;
  quantity: number;
  selectedOptions?: { price: number | string }[];
  promoType?: string | null;
  promoBuyQuantity?: number | null;
  promoPayQuantity?: number | null;
  sellBy?: string | null;
};

function getPaidUnits(item: CartItemLike) {
  const buy = item.promoBuyQuantity ?? 0;
  const pay = item.promoPayQuantity ?? 0;
  const valid =
    item.promoType === 'MULTI_BUY' &&
    item.sellBy !== 'WEIGHT' &&
    buy > 0 &&
    pay > 0 &&
    pay < buy &&
    item.quantity >= buy;
  if (!valid) return item.quantity;
  const groups = Math.floor(item.quantity / buy);
  const remainder = item.quantity % buy;
  return groups * pay + remainder;
}

function getBasePrice(item: CartItemLike) {
  const price = Number(item.price) || 0;
  const base = item.discountPrice ? Number(item.discountPrice) || 0 : price;
  return base;
}

function getListLineTotal(item: CartItemLike) {
  const price = Number(item.price) || 0;
  const optionsSum = (item.selectedOptions || []).reduce((s, o) => s + (Number(o.price) || 0), 0);
  return (price + optionsSum) * Math.max(0, item.quantity);
}

function getLineTotal(item: CartItemLike) {
  const optionsSum = (item.selectedOptions || []).reduce((s, o) => s + (Number(o.price) || 0), 0);
  return getBasePrice(item) * getPaidUnits(item) + optionsSum * Math.max(0, item.quantity);
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
  pickupOnly?: boolean;
  freeDeliveryThreshold?: number | null;
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
  pickupOnly = false,
  freeDeliveryThreshold,
}: CartDrawerProps) {
  const cart = useCartStore(state => state.items);
  const updateCartItem = useCartStore(state => state.updateItem);
  const storeServiceFee = useCartStore(state => state.serviceFee);
  const storeDeliveryFee = useCartStore(state => state.deliveryFee);

  const serviceFee = overrideServiceFee ?? storeServiceFee;
  const deliveryFee = overrideDeliveryFee ?? storeDeliveryFee;

  const cartSubtotal = useMemo(
    () => cart.reduce((sum, item) => sum + getLineTotal(item), 0),
    [cart]
  );

  const totalProducts = useMemo(
    () => cart.reduce((sum, item) => sum + Math.max(0, item.quantity), 0),
    [cart]
  );

  const savingsTotal = useMemo(
    () => cart.reduce((sum, item) => sum + Math.max(0, getListLineTotal(item) - getLineTotal(item)), 0),
    [cart]
  );

  const effectiveDeliveryFee =
    fulfillmentType !== 'PICKUP' &&
    !pickupOnly &&
    freeDeliveryThreshold &&
    freeDeliveryThreshold > 0 &&
    cartSubtotal >= freeDeliveryThreshold
      ? 0
      : deliveryFee;

  const orderTotal = Math.max(0, cartSubtotal + serviceFee + (fulfillmentType === 'PICKUP' ? 0 : effectiveDeliveryFee));

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
                <ShoppingBasket className="h-5 w-5" strokeWidth={1.8} />
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
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* ── Product List ── */}
          <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-5">
            {cart.length ? (
              <div className="space-y-3">
                {cart.map((item, idx) => {
                  const itemUnitPrice = getBasePrice(item) + (item.selectedOptions || []).reduce((s, o) => s + Number(o.price), 0);
                  const originalUnitPrice = Number(item.price) || 0;
                  const originalLineTotal = getListLineTotal(item);
                  const lineTotal = getLineTotal(item);
                  const hasDirectDiscount = item.discountPrice != null && Number(item.discountPrice) < originalUnitPrice;
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
                          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-100 to-sky-50 text-sky-400">
                            <Utensils className="h-6 w-6" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-semibold leading-snug text-neutral-900">{item.name}</p>
                            <div className="flex shrink-0 flex-col items-end gap-1">
                              <span className="rounded-lg bg-neutral-900 px-2.5 py-1 text-xs font-bold text-white shadow-sm">
                                {formatCurrency(lineTotal)}
                              </span>
                              {hasDirectDiscount && (
<span className="text-[11px] font-semibold text-neutral-500 line-through decoration-[1.5px] decoration-rose-400/70">
                                {formatCurrency(originalLineTotal)}
                              </span>
                              )}
                            </div>
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
                            <p className="mt-1.5 text-[11px] font-semibold text-neutral-600">
                              {item.weightG >= 1000 ? `${item.weightG / 1000}kg` : `${item.weightG}g`} · {formatCurrency(item.unitPrice || 0)}/kg
                            </p>
                          ) : (
                            <p className="mt-1.5 text-[11px] font-bold text-neutral-700">
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
                              <Trash2 className="h-3 w-3 text-red-500" />
                            ) : (
                              <Minus className="h-3 w-3" strokeWidth={2.5} />
                            )}
                          </button>
                          <span className="flex h-7 w-7 items-center justify-center text-xs font-bold text-neutral-900">{item.quantity}</span>
                          <button
                            type="button"
                            onClick={() => updateCartItem(item.cartItemId, { quantity: item.quantity + 1 })}
                            className="flex h-7 w-7 items-center justify-center rounded-full text-neutral-500 transition-all hover:bg-white hover:text-neutral-800 hover:shadow-sm active:scale-90"
                            aria-label={`Agregar una unidad de ${item.name}`}
                          >
                            <Plus className="h-3 w-3" strokeWidth={2.5} />
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
                    <ShoppingBasket className="h-[42px] w-[42px] text-sky-200" strokeWidth={1.5} />
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
                    <ChevronRight className="relative z-10 h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" strokeWidth={2.5} />
                    <div className="absolute inset-0 bg-gradient-to-r from-neutral-800 to-neutral-900 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── Summary Footer ── */}
          {cart.length ? (
            <div className="sticky bottom-0 z-10 border-t border-black/[0.04] bg-white/90 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-xl sm:px-5">
              <div className="rounded-2xl bg-gradient-to-b from-neutral-50 to-neutral-100/60 p-3 ring-1 ring-black/[0.04]">
                <div className="space-y-1.5 text-xs">
                  {savingsTotal > 0 && (
                  <div className="flex items-center justify-between text-emerald-600">
                    <span className="flex items-center gap-1">
                      <span className="text-[10px]"><BadgePercent className="h-3.5 w-3.5" strokeWidth={1.5} /></span> Descuento
                    </span>
                    <span className="font-bold text-emerald-600">-{formatCurrency(savingsTotal)}</span>
                  </div>
                  )}
                  <div className="flex items-center justify-between text-neutral-500">
                    <span className="flex items-center gap-1">
                      <span className="text-[10px]"><DollarSign className="h-3.5 w-3.5" strokeWidth={1.5} /></span> Subtotal
                    </span>
                    <span className="font-medium text-neutral-700">{formatCurrency(cartSubtotal)}</span>
                  </div>
                  {fulfillmentType !== 'PICKUP' && !pickupOnly && (
                  <div className="flex items-center justify-between text-neutral-500">
                    <span className="flex items-center gap-1">
                      <span className="text-[10px]"><Bike className="h-3.5 w-3.5" strokeWidth={1.5} /></span> Envío
                    </span>
                    {freeDeliveryThreshold && deliveryFee > 0 && cartSubtotal >= freeDeliveryThreshold ? (
                      <span className="font-bold text-emerald-600">Gratis</span>
                    ) : (
                      <span className="font-medium text-neutral-700">{formatCurrency(deliveryFee)}</span>
                    )}
                  </div>
                  )}
                  {freeDeliveryThreshold && freeDeliveryThreshold > 0 && fulfillmentType !== 'PICKUP' && !pickupOnly && cartSubtotal < freeDeliveryThreshold && (
                    <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-2 py-1.5 text-[11px] font-semibold text-emerald-700">
                      <span>Envio gratis desde {formatCurrency(freeDeliveryThreshold)}</span>
                      <span className="text-emerald-500">Te faltan {formatCurrency(freeDeliveryThreshold - cartSubtotal)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-neutral-500">
                    <span className="flex items-center gap-1">
                      <span className="text-[10px]"><Receipt className="h-3.5 w-3.5" strokeWidth={1.5} /></span> Servicio
                    </span>
                    <span className="font-medium text-neutral-700">{formatCurrency(serviceFee)}</span>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between rounded-xl bg-neutral-900 px-3.5 py-2.5 shadow-lg shadow-neutral-900/15">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-neutral-300">
                    <Wallet className="h-3.5 w-3.5" strokeWidth={1.5} />
                    Total a pagar
                  </span>
                  <span className="text-base font-extrabold tracking-tight text-white">{formatCurrency(orderTotal)}</span>
                </div>
              </div>

              {pickupOnly ? (
                <div className="mt-2 flex items-center justify-center gap-2 rounded-xl border border-sky-200 bg-sky-50/70 px-3 py-2.5 text-[11px] font-bold text-sky-700">
                  <ShoppingBag className="h-3.5 w-3.5" strokeWidth={1.5} /> Solo recoger en tienda
                </div>
              ) : (
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
                      <Check className="h-2.5 w-2.5 text-sky-500" strokeWidth={4} />
                    </span>
                  )}
                  <Bike className="h-3.5 w-3.5" strokeWidth={1.5} /> Enviar a domicilio
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
                      <Check className="h-2.5 w-2.5 text-sky-500" strokeWidth={4} />
                    </span>
                  )}
                  <Store className="h-3.5 w-3.5" strokeWidth={1.5} /> Recoger en tienda
                </button>
              </div>
              )}

              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="group flex items-center justify-center gap-1.5 rounded-xl border border-black/[0.06] bg-white px-4 py-2.5 text-sm font-semibold text-neutral-700 shadow-sm transition-all hover:bg-neutral-50 hover:shadow active:scale-[0.97]"
                >
                  <ChevronLeft className="h-3.5 w-3.5 text-neutral-400 transition-transform group-hover:-translate-x-0.5" />
                  Seguir comprando
                </button>
                <button
                  type="button"
                  onClick={onProceedToCheckout}
                  disabled={!isRestaurantOpen}
                  className="group relative flex overflow-hidden items-center justify-center gap-2 rounded-xl bg-sky-500 px-7 py-4 text-[15px] font-bold text-white shadow-[0_4px_16px_-4px_rgba(14,165,233,0.45)] transition-all hover:bg-sky-400 hover:shadow-[0_8px_24px_-6px_rgba(14,165,233,0.55)] active:scale-[0.97] disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 disabled:shadow-none animate-pulse-glow"
                >
                  <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-1000 group-hover:translate-x-full disabled:hidden" />
                  <span className="relative flex items-center justify-center gap-2">
                    Completar pedido
                    <ChevronRight className="h-5 w-5 shrink-0 animate-arrow-slide group-hover:translate-x-1 transition-transform" strokeWidth={2.5} />
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
