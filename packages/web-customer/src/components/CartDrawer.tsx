'use client';
import { BadgePercent, Bike, Check, ChevronLeft, ChevronRight, DollarSign, Minus, Plus, Receipt, ShoppingBag, Store, Trash2, Utensils, Wallet, X } from 'lucide-react';

import { memo, useMemo } from 'react';
import { useCartStore } from '../store/cartStore';
import { CartIcon } from './CartIcon';

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
  restaurantId?: string | null;
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
  restaurantId,
}: CartDrawerProps) {
  const allItems = useCartStore(state => state.items);
  const storeRestaurantId = useCartStore(state => state.restaurantId);
  const cart = useMemo(
    () => (restaurantId && storeRestaurantId === restaurantId ? allItems : []),
    [allItems, storeRestaurantId, restaurantId]
  );
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

  const fulfillmentControl = pickupOnly ? (
    <div className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 text-xs font-semibold text-sky-800">
      <ShoppingBag className="h-4 w-4" strokeWidth={1.7} /> Solo recoger en tienda
    </div>
  ) : (
    <div className="grid grid-cols-2 gap-2" role="group" aria-label="Cómo recibir el pedido">
      <button
        type="button"
        onClick={() => onFulfillmentTypeChange('DELIVERY')}
        aria-pressed={fulfillmentType === 'DELIVERY'}
        className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-2.5 text-xs font-semibold transition-colors active:scale-[0.98] ${
          fulfillmentType === 'DELIVERY'
            ? 'border-sky-500 bg-sky-50 text-sky-800 shadow-sm shadow-sky-900/5'
            : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900'
        }`}
      >
        <Bike className="h-4 w-4 shrink-0" strokeWidth={1.7} />
        Enviar a domicilio
        <span className={`grid size-4 shrink-0 place-items-center rounded-full border ${fulfillmentType === 'DELIVERY' ? 'border-sky-600 bg-sky-600 text-white' : 'border-neutral-300 text-transparent'}`}>
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
      </button>
      <button
        type="button"
        onClick={() => onFulfillmentTypeChange('PICKUP')}
        aria-pressed={fulfillmentType === 'PICKUP'}
        className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-2.5 text-xs font-semibold transition-colors active:scale-[0.98] ${
          fulfillmentType === 'PICKUP'
            ? 'border-sky-500 bg-sky-50 text-sky-800 shadow-sm shadow-sky-900/5'
            : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900'
        }`}
      >
        <Store className="h-4 w-4 shrink-0" strokeWidth={1.7} />
        Recoger en tienda
        <span className={`grid size-4 shrink-0 place-items-center rounded-full border ${fulfillmentType === 'PICKUP' ? 'border-sky-600 bg-sky-600 text-white' : 'border-neutral-300 text-transparent'}`}>
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
      </button>
    </div>
  );

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
                <CartIcon className="h-5 w-5" strokeWidth={1.8} />
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
                    <CartIcon className="h-[42px] w-[42px] text-sky-200" strokeWidth={1.5} />
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
            <div className="sticky bottom-0 z-10 space-y-2.5 border-t border-black/[0.06] bg-white/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-12px_32px_rgba(15,23,42,0.06)] backdrop-blur-xl sm:px-5">
              {fulfillmentControl}
              <div className="rounded-2xl bg-gradient-to-b from-neutral-50 to-neutral-100/60 p-3 ring-1 ring-black/[0.04]">
                <div className="space-y-1.5 text-[13px]">
                  {savingsTotal > 0 && (
                    <div className="flex items-center justify-between text-emerald-700">
                      <span className="flex items-center gap-1.5">
                        <BadgePercent className="h-4 w-4" strokeWidth={1.7} /> Descuento
                      </span>
                      <span className="font-semibold">-{formatCurrency(savingsTotal)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-neutral-500">
                    <span className="flex items-center gap-1.5">
                      <DollarSign className="h-4 w-4" strokeWidth={1.7} /> Subtotal
                    </span>
                    <span className="font-medium text-neutral-700">{formatCurrency(cartSubtotal)}</span>
                  </div>
                  {fulfillmentType !== 'PICKUP' && !pickupOnly && (
                    <div className="flex items-center justify-between text-neutral-500">
                      <span className="flex items-center gap-1.5">
                        <Bike className="h-4 w-4" strokeWidth={1.7} /> Envío
                      </span>
                      {freeDeliveryThreshold && deliveryFee > 0 && cartSubtotal >= freeDeliveryThreshold ? (
                        <span className="font-semibold text-emerald-700">Gratis</span>
                      ) : (
                        <span className="font-medium text-neutral-700">{formatCurrency(deliveryFee)}</span>
                      )}
                    </div>
                  )}
                  {freeDeliveryThreshold && freeDeliveryThreshold > 0 && fulfillmentType !== 'PICKUP' && !pickupOnly && cartSubtotal < freeDeliveryThreshold && (
                    <div className="flex items-center justify-between gap-2 rounded-lg bg-emerald-50 px-2.5 py-2 text-xs font-medium text-emerald-800">
                      <span>Envío gratis desde {formatCurrency(freeDeliveryThreshold)}</span>
                      <span className="shrink-0 font-semibold">Faltan {formatCurrency(freeDeliveryThreshold - cartSubtotal)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-neutral-500">
                    <span className="flex items-center gap-1.5">
                      <Receipt className="h-4 w-4" strokeWidth={1.7} /> Servicio
                    </span>
                    <span className="font-medium text-neutral-700">{formatCurrency(serviceFee)}</span>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between border-t border-black/[0.07] pt-2.5">
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-neutral-700">
                    <Wallet className="h-4 w-4" strokeWidth={1.7} />
                    Total a pagar
                  </span>
                  <span className="text-xl font-extrabold tracking-tight text-neutral-950">{formatCurrency(orderTotal)}</span>
                </div>
              </div>

              {!isRestaurantOpen && (
                <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-center text-xs font-medium text-amber-800">
                  El restaurante está cerrado y no puede aceptar pedidos ahora.
                </p>
              )}

              <div className="grid gap-2 sm:grid-cols-[0.9fr_1.1fr]">
                <button
                  type="button"
                  onClick={onClose}
                  className="group flex min-h-12 items-center justify-center gap-1.5 rounded-xl border border-black/[0.08] bg-white px-3 text-[13px] font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 active:scale-[0.98]"
                >
                  <ChevronLeft className="h-3.5 w-3.5 text-neutral-400 transition-transform group-hover:-translate-x-0.5" />
                  Seguir comprando
                </button>
                <button
                  type="button"
                  onClick={onProceedToCheckout}
                  disabled={!isRestaurantOpen}
                  className="group flex min-h-12 items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 text-sm font-bold text-white shadow-[0_5px_16px_-4px_rgba(2,132,199,0.4)] transition-colors hover:bg-sky-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 disabled:shadow-none"
                >
                  <span className="flex items-center justify-center gap-2">
                    Completar pedido
                    <ChevronRight className="h-5 w-5 shrink-0 transition-transform group-hover:translate-x-0.5" strokeWidth={2.5} />
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
        `}</style>
      </aside>
    </div>
  );
});
