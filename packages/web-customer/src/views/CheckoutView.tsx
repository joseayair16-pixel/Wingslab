import React from 'react';
import { ArrowLeft, Banknote, Bike, Check, CreditCard, Landmark, MapPin, Phone, Store } from 'lucide-react';

export interface CheckoutViewProps {
  openDashboardSection: (section: any) => void;
  addresses: any[];
  selectedCheckoutAddressId: string | null;
  setSelectedCheckoutAddressId: (id: any) => void;
  fulfillmentType: 'DELIVERY' | 'PICKUP';
  setFulfillmentType: (type: 'DELIVERY' | 'PICKUP') => void;
  paymentMethod: string;
  setPaymentMethod: (method: any) => void;
  paymentProofUrl: string;
  setPaymentProofUrl: (url: string) => void;
  paymentProofUploading: boolean;
  handlePaymentProofUpload: (file: File) => Promise<void>;
  cart: any[];
  cartSubtotal: number;
  cartServiceFee: number;
  cartTotal: number;
  selectedRestaurant: any;
  orderNotes: string;
  setOrderNotes: (notes: string) => void;
  handlePlaceOrder: () => Promise<void>;
  formatCurrency: (amount: number) => string;
}

export function CheckoutView({
  openDashboardSection,
  addresses,
  selectedCheckoutAddressId,
  setSelectedCheckoutAddressId,
  fulfillmentType,
  setFulfillmentType,
  paymentMethod,
  setPaymentMethod,
  paymentProofUrl,
  setPaymentProofUrl,
  paymentProofUploading,
  handlePaymentProofUpload,
  cart,
  cartSubtotal,
  cartServiceFee,
  cartTotal,
  selectedRestaurant,
  orderNotes,
  setOrderNotes,
  handlePlaceOrder,
  formatCurrency,
}: CheckoutViewProps) {
  const isPickup = fulfillmentType === 'PICKUP';
  const deliveryFee = isPickup ? 0 : (selectedRestaurant?.effectiveDeliveryFee || 0);

  return (
    <div className="mt-1 space-y-6 max-w-5xl mx-auto px-4 md:px-0">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-[-0.05em] text-neutral-900 md:text-4xl">Finalizar Pedido</h1>
          <p className="mt-1 text-sm text-neutral-500">Confirma los datos de tu pedido.</p>
        </div>
        <button
          type="button"
          onClick={() => openDashboardSection('home')}
          className="text-sm font-semibold text-neutral-600 hover:text-neutral-900 flex items-center gap-1"
        >
          <ArrowLeft className="w-4 h-4" strokeWidth={2} />
          Volver a tiendas
        </button>
      </div>

      {/* Fulfillment Type Toggle */}
      <div className="bg-white rounded-2xl border border-black/[0.03] shadow-[0_2px_12px_rgba(0,0,0,0.03)] p-6">
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setFulfillmentType('DELIVERY')}
            className={`relative flex items-center justify-center gap-2.5 p-4 rounded-xl border-2 transition-all duration-200 ${
              !isPickup
                ? 'border-sky-500 bg-sky-500 shadow-lg shadow-sky-500/25 scale-[1.02]'
                : 'border-black/5 bg-white hover:border-black/20 hover:bg-neutral-50'
            }`}
          >
            {!isPickup && (
              <span className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-md ring-2 ring-sky-500">
                <Check className="h-3 w-3 text-sky-500" strokeWidth={4} />
              </span>
            )}
            <Bike className="h-7 w-7" strokeWidth={1.5} />
            <div className="text-left">
              <p className={`text-sm font-bold ${!isPickup ? 'text-white' : 'text-neutral-700'}`}>Enviar a domicilio</p>
              <p className={`text-[11px] ${!isPickup ? 'text-sky-100' : 'text-neutral-400'}`}>Recibe en tu puerta</p>
            </div>
          </button>
          <button
            type="button"
            onClick={() => setFulfillmentType('PICKUP')}
            className={`relative flex items-center justify-center gap-2.5 p-4 rounded-xl border-2 transition-all duration-200 ${
              isPickup
                ? 'border-sky-500 bg-sky-500 shadow-lg shadow-sky-500/25 scale-[1.02]'
                : 'border-black/5 bg-white hover:border-black/20 hover:bg-neutral-50'
            }`}
          >
            {isPickup && (
              <span className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-md ring-2 ring-sky-500">
                <Check className="h-3 w-3 text-sky-500" strokeWidth={4} />
              </span>
            )}
            <Store className="h-7 w-7" strokeWidth={1.5} />
            <div className="text-left">
              <p className={`text-sm font-bold ${isPickup ? 'text-white' : 'text-neutral-700'}`}>Recoger en tienda</p>
              <p className={`text-[11px] ${isPickup ? 'text-sky-100' : 'text-neutral-400'}`}>Pasa por tu pedido</p>
            </div>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Columna Izquierda: Opciones */}
        <div className="lg:col-span-2 space-y-6">
          
          {isPickup ? (
            /* Información del restaurante para recoger en tienda */
            <div className="bg-white rounded-2xl border border-black/[0.03] shadow-[0_2px_12px_rgba(0,0,0,0.03)] p-6">
              <h3 className="text-lg font-semibold text-neutral-950 mb-4 flex items-center gap-2">
                <Store className="h-5 w-5" strokeWidth={1.5} /> Recoger en
              </h3>
              <div className="rounded-xl bg-neutral-50 border border-black/5 p-4 space-y-2">
                <p className="font-bold text-neutral-900 text-base">{selectedRestaurant?.name || 'Restaurante'}</p>
                {selectedRestaurant?.address && (
                  <p className="text-sm text-neutral-600 flex items-start gap-1.5">
                    <MapPin className="h-4 w-4 shrink-0 text-neutral-400" strokeWidth={1.5} /> {selectedRestaurant.address}
                  </p>
                )}
                {selectedRestaurant?.contactPhone && (
                  <p className="text-sm text-neutral-600 flex items-center gap-1.5">
                    <Phone className="h-4 w-4 shrink-0 text-neutral-400" strokeWidth={1.5} /> {selectedRestaurant.contactPhone}
                  </p>
                )}
                <p className="text-[11px] text-neutral-400 mt-1">
                  Te notificaremos cuando tu pedido esté listo para recoger.
                </p>
              </div>
            </div>
          ) : (
            /* Direcciones para delivery */
            <div className="bg-white rounded-2xl border border-black/[0.03] shadow-[0_2px_12px_rgba(0,0,0,0.03)] p-6">
              <h3 className="text-lg font-semibold text-neutral-950 mb-4 flex items-center gap-2">
                <MapPin className="h-5 w-5" strokeWidth={1.5} /> ¿A dónde enviamos tu pedido?
              </h3>
              
              {addresses.length === 0 ? (
                <div className="text-center py-6 border border-dashed border-black/10 rounded-xl bg-neutral-50">
                  <p className="text-sm text-neutral-500 mb-3">Aún no tienes direcciones guardadas.</p>
                  <button
                    type="button"
                    onClick={() => openDashboardSection('profile')}
                    className="rounded-full bg-neutral-950 px-4 py-2 text-xs font-semibold text-white transition hover:bg-neutral-800"
                  >
                    Añadir mi primera dirección
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {addresses.map((address) => (
                    <label
                      key={address.id}
                      className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all active-scale ${
                        selectedCheckoutAddressId === address.id
                          ? 'border-accent bg-accent-soft'
                          : 'border-black/5 hover:bg-neutral-50'
                      }`}
                      onClick={() => setSelectedCheckoutAddressId(address.id)}
                    >
                      <input
                        type="radio"
                        name="checkout_address"
                        checked={selectedCheckoutAddressId === address.id}
                        onChange={() => setSelectedCheckoutAddressId(address.id)}
                        className="mt-1 h-4 w-4 text-accent focus:ring-accent"
                      />
                      <div className="flex-1">
                        <p className="font-semibold text-sm text-neutral-900">{address.tag || 'Dirección'}</p>
                        <p className="text-sm text-neutral-600 mt-0.5">{address.street} {address.number}</p>
                        {address.colony && <p className="text-xs text-neutral-500 mt-0.5">{address.colony}</p>}
                        {address.reference && (
                          <p className="text-xs text-neutral-400 mt-1 italic">Ref: {address.reference}</p>
                        )}
                      </div>
                    </label>
                  ))}
                  
                  <button
                    type="button"
                    onClick={() => openDashboardSection('profile')}
                    className="w-full mt-2 py-3 rounded-xl border border-dashed border-black/10 text-sm font-semibold text-neutral-600 hover:bg-neutral-50 transition flex items-center justify-center gap-2"
                  >
                    <span>+</span> Añadir nueva dirección
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Opciones de Pago */}
          <div className="bg-white rounded-2xl border border-black/[0.03] shadow-[0_2px_12px_rgba(0,0,0,0.03)] p-6">
            <h3 className="text-lg font-semibold text-neutral-950 mb-4 flex items-center gap-2">
              <CreditCard className="h-5 w-5" strokeWidth={1.5} /> ¿Cómo quieres pagar?
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label
                className={`flex items-center justify-between p-4 rounded-xl border cursor-pointer transition-all active-scale ${
                  paymentMethod === 'CASH'
                    ? 'border-accent bg-accent-soft'
                    : 'border-black/5 hover:bg-neutral-50'
                }`}
                onClick={() => setPaymentMethod('CASH')}
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 text-green-600 text-xl">
                    <Banknote className="h-5 w-5" strokeWidth={1.5} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-neutral-800">Efectivo</p>
                    <p className="text-xs text-neutral-500">Paga al recibir</p>
                  </div>
                </div>
                <input
                  type="radio"
                  name="payment_method"
                  checked={paymentMethod === 'CASH'}
                  onChange={() => setPaymentMethod('CASH')}
                  className="h-4 w-4 text-accent focus:ring-accent"
                />
              </label>

              <label
                className={`flex items-center justify-between p-4 rounded-xl border cursor-pointer transition-all active-scale ${
                  paymentMethod === 'TRANSFER'
                    ? 'border-accent bg-accent-soft'
                    : 'border-black/5 hover:bg-neutral-50'
                }`}
                onClick={() => setPaymentMethod('TRANSFER')}
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-600 text-xl">
                    <Landmark className="h-5 w-5" strokeWidth={1.5} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-neutral-800">Transferencia</p>
                    <p className="text-xs text-neutral-500">Requiere comprobante</p>
                  </div>
                </div>
                <input
                  type="radio"
                  name="payment_method"
                  checked={paymentMethod === 'TRANSFER'}
                  onChange={() => setPaymentMethod('TRANSFER')}
                  className="h-4 w-4 text-accent focus:ring-accent"
                />
              </label>
            </div>

            {/* Payment Proof Upload for TRANSFER */}
            {paymentMethod === 'TRANSFER' && (
              <div className="mt-4 p-4 rounded-xl border-2 border-dashed border-blue-300 bg-blue-50">
                <label className="block">
                  <p className="text-sm font-semibold text-neutral-800 mb-2">
                    📄 Comprobante de Transferencia
                  </p>
                  <div className="flex items-center gap-2 text-xs text-neutral-600 mb-3">
                    {paymentProofUrl ? (
                      <span className="text-green-600 font-medium">✓ Comprobante subido</span>
                    ) : (
                      <span>Sube una imagen o PDF como comprobante</span>
                    )}
                  </div>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    disabled={paymentProofUploading}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        void handlePaymentProofUpload(file);
                      }
                    }}
                    className="w-full rounded-lg border border-blue-200 p-3 text-sm cursor-pointer hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  {paymentProofUrl && (
                    <button
                      type="button"
                      onClick={() => setPaymentProofUrl('')}
                      className="mt-2 text-xs text-red-600 hover:text-red-700 font-medium"
                    >
                      ✕ Remover comprobante
                    </button>
                  )}
                </label>
              </div>
            )}
          </div>
        </div>

        {/* Columna Derecha: Resumen */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-2xl border border-black/[0.03] shadow-[0_2px_12px_rgba(0,0,0,0.03)] p-6 sticky top-6">
            <h3 className="text-lg font-semibold text-neutral-950 mb-4">Resumen del pedido</h3>
            
            <div className="divide-y divide-black/[0.03] mb-4">
              {cart.map((item) => (
                <div key={item.productId} className="py-2 flex justify-between text-sm">
                  <div className="flex-1">
                    <p className="font-medium text-neutral-800">{item.name} <span className="text-neutral-400">x{item.quantity}</span></p>
                    {item.sellBy === 'WEIGHT' && item.weightG ? (
                      <p className="text-xs text-neutral-500 mt-0.5">
                        {item.weightG >= 1000 ? `${item.weightG / 1000}kg` : `${item.weightG}g`} · {formatCurrency(item.unitPrice || 0)}/kg
                      </p>
                    ) : null}
                    {item.specialInstructions && (
                      <p className="text-xs text-neutral-500 mt-0.5">"{item.specialInstructions}"</p>
                    )}
                  </div>
                  <span className="font-semibold text-neutral-900">{formatCurrency((item.discountPrice ? Number(item.discountPrice) : Number(item.price)) * item.quantity)}</span>
                </div>
              ))}
            </div>

            <div className="space-y-2 text-sm text-neutral-600 mb-4">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span className="font-semibold text-neutral-900">{formatCurrency(cartSubtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>Tarifa de servicio</span>
                <span className="font-semibold text-neutral-900">{formatCurrency(cartServiceFee)}</span>
              </div>
              <div className="flex justify-between">
                <span>Costo de envío</span>
                <span className="font-semibold text-neutral-900">{formatCurrency(deliveryFee)}</span>
              </div>
            </div>
            {cart.reduce(
              (sum, item) => sum + Math.max(0, (Number(item.price) - (item.discountPrice ? Number(item.discountPrice) : Number(item.price))) * item.quantity),
              0
            ) > 0 && (
              <div className="mb-4 flex justify-between text-sm text-emerald-600">
                <span>Descuento</span>
                <span className="font-semibold">
                  -{formatCurrency(cart.reduce((sum, item) => sum + Math.max(0, (Number(item.price) - (item.discountPrice ? Number(item.discountPrice) : Number(item.price))) * item.quantity), 0))}
                </span>
              </div>
            )}

            <div className="mb-4">
              <label className="text-sm font-semibold text-neutral-800">Notas para el restaurante</label>
              <textarea
                className="mt-1 w-full rounded-2xl border border-black/10 px-4 py-3 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-black/20 bg-white"
                placeholder="Ej. Sin cebolla, extra salsa, tocar el timbre..."
                value={orderNotes}
                onChange={(e) => setOrderNotes(e.target.value)}
                rows={2}
              />
            </div>

            <div className="border-t border-black/5 pt-4 flex justify-between items-center mb-6">
              <span className="font-semibold text-neutral-900">Total</span>
              <span className="text-2xl font-semibold text-neutral-900">
                {formatCurrency(cartTotal + deliveryFee)}
              </span>
            </div>

            <button
              type="button"
              onClick={handlePlaceOrder}
              className="w-full rounded-full bg-sky-500 py-3.5 text-sm font-semibold text-white transition hover:bg-sky-600 flex items-center justify-center gap-2 active-scale shadow-[0_12px_32px_rgba(135,206,235,0.2)]"
            >
              <Check className="w-5 h-5" />
              Confirmar y Pedir
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
