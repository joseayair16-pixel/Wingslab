'use client';
import { BadgePercent, Bike, Check, ChevronLeft, ChevronRight, DollarSign, Minus, Plus, Receipt, ShoppingBag, Store, Trash2, Utensils, Wallet, X } from 'lucide-react';

import { memo, useEffect, useMemo, useRef } from 'react';
import { formatCurrency as formatSharedCurrency } from '@sadel/shared';
import redWordmark from '../assets/wingslab-wordmark-red.png';
import whiteWordmark from '../assets/wingslab-wordmark.png';
import { useCartStore } from '../store/cartStore';
import { CartIcon } from './CartIcon';

function formatCurrency(amount: number) {
  return formatSharedCurrency(amount, 'MXN', 'es-MX');
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
  deliveryFeePending?: boolean;
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
  deliveryFeePending = false,
  overrideServiceFee,
  pickupOnly = false,
  freeDeliveryThreshold,
  restaurantId,
}: CartDrawerProps) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onCloseRef.current(); };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previous?.focus(); };
  }, [isOpen]);
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
    overrideDeliveryFee === undefined &&
    fulfillmentType !== 'PICKUP' &&
    !pickupOnly &&
    freeDeliveryThreshold &&
    freeDeliveryThreshold > 0 &&
    cartSubtotal >= freeDeliveryThreshold
      ? 0
      : deliveryFee;

  const orderTotal = Math.max(0, cartSubtotal + serviceFee + (fulfillmentType === 'PICKUP' ? 0 : effectiveDeliveryFee));
  const showDelivery = fulfillmentType !== 'PICKUP' && !pickupOnly;
  const showBreakdown = showDelivery || serviceFee > 0 || savingsTotal > 0;
  const freeDelivery = showDelivery && !deliveryFeePending && effectiveDeliveryFee === 0;

  const fulfillmentControl = pickupOnly ? (
    <div className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
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
            ? 'border-[var(--wl-action)] bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200 shadow-sm shadow-orange-900/5'
            : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800'
        }`}
      >
        <Bike className="h-4 w-4 shrink-0" strokeWidth={1.7} />
        Enviar a domicilio
        <span className={`grid size-4 shrink-0 place-items-center rounded-full border ${fulfillmentType === 'DELIVERY' ? 'border-red-600 bg-[var(--wl-action)] text-white' : 'border-neutral-300 text-transparent'}`}>
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
      </button>
      <button
        type="button"
        onClick={() => onFulfillmentTypeChange('PICKUP')}
        aria-pressed={fulfillmentType === 'PICKUP'}
        className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-2.5 text-xs font-semibold transition-colors active:scale-[0.98] ${
          fulfillmentType === 'PICKUP'
            ? 'border-[var(--wl-action)] bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200 shadow-sm shadow-orange-900/5'
            : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800'
        }`}
      >
        <Store className="h-4 w-4 shrink-0" strokeWidth={1.7} />
        Recoger en tienda
        <span className={`grid size-4 shrink-0 place-items-center rounded-full border ${fulfillmentType === 'PICKUP' ? 'border-red-600 bg-[var(--wl-action)] text-white' : 'border-neutral-300 text-transparent'}`}>
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
      </button>
    </div>
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 transition-all duration-300">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" onClick={onClose} />
      <aside role="dialog" aria-modal="true" aria-labelledby="wl-cart-title"
        className={`wl-cart-drawer absolute right-0 top-0 flex h-full w-full max-w-[520px] flex-col overflow-hidden bg-[#fffdf9] shadow-[0_0_0_1px_rgba(41,34,29,0.08),0_40px_100px_rgba(41,34,29,0.22)] sm:rounded-l-[24px] transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <section className="flex h-full flex-col">
          {/* ── Header ── */}
          <div className="wl-cart-heading sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-black/[0.04] bg-white px-5 py-4 dark:bg-[#202124] dark:border-[#4a4745] sm:px-6">
            <div className="flex items-center gap-3.5">
              <div className="wl-cart-heading-icon relative flex h-12 w-12 items-center justify-center rounded-[18px] bg-[#29221d] text-white shadow-lg shadow-neutral-900/20">
                <CartIcon className="h-5 w-5" strokeWidth={1.8} />
                {totalProducts > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white shadow-md shadow-accent/30">
                    {totalProducts}
                  </span>
                )}
              </div>
              <div>
                <div className="wl-cart-brand" aria-label="WingsLab">
                  <img className="wl-logo-on-light" src={redWordmark.src} alt="WingsLab" />
                  <img className="wl-logo-on-dark" src={whiteWordmark.src} alt="" aria-hidden="true" />
                </div>
                <h2 id="wl-cart-title" className="text-lg font-bold tracking-[-0.03em] text-neutral-950 dark:text-white">Carrito</h2>
              </div>
            </div>
            <button
              ref={closeButton}
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 transition-all hover:bg-neutral-200 hover:text-neutral-700 active:scale-90"
              aria-label="Cerrar carrito"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* ── Product List ── */}
          <div className="wl-cart-content flex-1 overflow-y-auto px-4 py-5 sm:px-5">
            {cart.length ? (
              <div className="space-y-3">
                {cart.map((item, idx) => {
                  const itemUnitPrice = getBasePrice(item) + (item.selectedOptions || []).reduce((s, o) => s + Number(o.price), 0);
                  const originalUnitPrice = Number(item.price) || 0;
                  const originalLineTotal = getListLineTotal(item);
                  const lineTotal = getLineTotal(item);
                  const hasDirectDiscount = item.discountPrice != null && Number(item.discountPrice) < originalUnitPrice;
                  const isWeightItem = item.sellBy === 'WEIGHT';
                  const quantityForProduct = cart.reduce((sum, line) => line.productId === item.productId ? sum + line.quantity : sum, 0);
                  const stockLimitReached = item.maxStock != null && quantityForProduct >= item.maxStock;

                  return (
                    <div
                      key={item.cartItemId}
                      className="wl-cart-item group rounded-[22px] border border-black/[0.04] bg-white p-4 dark:bg-[#2c2d30] dark:border-[#4a4745] shadow-[0_1px_3px_rgba(0,0,0,0.04)] transition-all hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)]"
                      style={{ animation: `fadeInUp 0.3s ease-out ${idx * 0.05}s both` }}
                    >
                      <div className="flex items-start gap-3.5">
                        {item.image ? (
                          <img src={item.image} className="h-14 w-14 shrink-0 rounded-2xl object-cover" alt={item.name} loading="lazy" decoding="async" />
                        ) : (
                          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-red-500 dark:bg-red-950/40 dark:text-red-300">
                            <Utensils className="h-6 w-6" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-semibold leading-snug text-neutral-900 dark:text-zinc-100">{item.name}</p>
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
                            <p className="mt-1.5 text-[11px] font-semibold text-neutral-600 dark:text-zinc-300">
                              {item.weightG >= 1000 ? `${item.weightG / 1000}kg` : `${item.weightG}g`} · {formatCurrency(item.unitPrice || 0)}/kg
                            </p>
                          ) : (
                            <p className="mt-1.5 text-[11px] font-bold text-neutral-700 dark:text-zinc-300">
                              {formatCurrency(itemUnitPrice)} c/u
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="wl-cart-item-controls mt-3.5 flex items-center gap-2">
                          <div className="wl-cart-quantity flex shrink-0 items-center gap-0.5 rounded-full border border-black/[0.06] bg-neutral-50 p-0.5">
                          <button
                            type="button"
                            onClick={() => updateCartItem(item.cartItemId, { quantity: item.quantity - 1 })}
                            className="flex items-center justify-center rounded-full transition-colors active:scale-90"
                            aria-label={`Quitar una unidad de ${item.name}`}
                          >
                            {item.quantity === 1 ? (
                              <Trash2 className="h-4 w-4 text-red-500" />
                            ) : (
                              <Minus className="h-4 w-4" strokeWidth={2.5} />
                            )}
                          </button>
                          <span className="wl-cart-quantity-value" aria-label={`Cantidad: ${item.quantity}`}>{item.quantity}</span>
                          <button
                            type="button"
                            onClick={() => updateCartItem(item.cartItemId, { quantity: item.quantity + 1 })}
                            disabled={stockLimitReached}
                            title={stockLimitReached ? 'No hay más unidades disponibles' : undefined}
                            className="flex items-center justify-center rounded-full transition-colors active:scale-90 disabled:cursor-not-allowed disabled:opacity-40"
                            aria-label={`Agregar una unidad de ${item.name}`}
                          >
                            <Plus className="h-4 w-4" strokeWidth={2.5} />
                          </button>
                        </div>

                        {stockLimitReached && <span role="status" className="sr-only">No hay más unidades disponibles de {item.name}.</span>}

                        <input
                          value={item.specialInstructions}
                          onChange={(event) => updateCartItem(item.cartItemId, { specialInstructions: event.target.value })}
                          placeholder="Nota..."
                          aria-label={`Nota para ${item.name}`}
                          className="min-h-11 min-w-0 flex-1 rounded-xl border border-transparent bg-neutral-50 px-2.5 py-1.5 text-xs text-neutral-700 outline-none transition-all placeholder:text-neutral-400 focus:border-red-300 focus:ring-2 focus:ring-red-200/50 dark:bg-zinc-800 dark:text-white dark:focus:border-red-500"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="wl-cart-empty">
                <div className="wl-cart-empty-inner">
                  <div className="wl-cart-empty-icon">
                    <CartIcon className="h-10 w-10" strokeWidth={1.5} />
                  </div>
                  <h3>Tu carrito está vacío</h3>
                  <button
                    type="button"
                    onClick={onClose}
                    className="wl-cart-explore"
                  >
                    <span className="relative z-10">Explorar menú</span>
                    <ChevronRight className="relative z-10 h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" strokeWidth={2.5} />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── Summary Footer ── */}
          {cart.length ? (
            <div className="wl-cart-footer sticky bottom-0 z-10 space-y-2.5 border-t border-black/[0.06] bg-white/95 dark:bg-[#202124] dark:border-[#4a4745] px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-12px_32px_rgba(15,23,42,0.06)] backdrop-blur-xl sm:px-5">
              {fulfillmentControl}
              <div className="wl-cart-summary rounded-2xl bg-gradient-to-b from-neutral-50 to-neutral-100/60 dark:from-[#2c2d30] dark:to-[#2c2d30] p-3 ring-1 ring-black/[0.04]">
                <div className="space-y-1.5 text-[13px]">
                  {savingsTotal > 0 && (
                    <div className="flex items-center justify-between text-emerald-700">
                      <span className="flex items-center gap-1.5">
                        <BadgePercent className="h-4 w-4" strokeWidth={1.7} /> Descuento
                      </span>
                      <span className="font-semibold">-{formatCurrency(savingsTotal)}</span>
                    </div>
                  )}
                  {showBreakdown && <div className="flex items-center justify-between text-neutral-500">
                    <span className="flex items-center gap-1.5">
                      <DollarSign className="h-4 w-4" strokeWidth={1.7} /> Subtotal
                    </span>
                    <span className="font-medium text-neutral-700">{formatCurrency(cartSubtotal)}</span>
                  </div>}
                  {showDelivery && (
                    <div className="flex items-center justify-between text-neutral-500">
                      <span className="flex items-center gap-1.5">
                        <Bike className="h-4 w-4" strokeWidth={1.7} /> Envío
                      </span>
                      {deliveryFeePending ? (
                        <span className="font-medium text-neutral-700">Se calcula con tu dirección</span>
                      ) : freeDelivery ? (
                        <span className="wl-cart-free-delivery">¡Gratis!</span>
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
                  {serviceFee > 0 && <div className="flex items-center justify-between text-neutral-500">
                    <span className="flex items-center gap-1.5">
                      <Receipt className="h-4 w-4" strokeWidth={1.7} /> Servicio
                    </span>
                    <span className="font-medium text-neutral-700">{formatCurrency(serviceFee)}</span>
                  </div>}
                </div>
                <div className={`flex items-center justify-between ${showBreakdown ? 'mt-2 border-t border-black/[0.07] pt-2.5' : ''}`}>
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-neutral-700">
                    <Wallet className="h-4 w-4" strokeWidth={1.7} />
                    {showDelivery && deliveryFeePending ? 'Total estimado' : 'Total a pagar'}
                  </span>
                  <span className="text-xl font-extrabold tracking-tight text-neutral-950 dark:text-white">{formatCurrency(orderTotal)}</span>
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
                  className="group flex min-h-12 items-center justify-center gap-1.5 rounded-xl border border-black/[0.08] bg-white px-3 text-[13px] font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 active:scale-[0.98] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  <ChevronLeft className="h-3.5 w-3.5 text-neutral-400 transition-transform group-hover:-translate-x-0.5" />
                  Seguir comprando
                </button>
                <button
                  type="button"
                  onClick={onProceedToCheckout}
                  disabled={!isRestaurantOpen}
                  className="group flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[var(--wl-action)] px-4 text-sm font-bold text-white shadow-[0_5px_16px_-4px_rgba(187,10,14,0.35)] transition-colors hover:bg-[var(--wl-action-hover)] active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 disabled:shadow-none dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500"
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
