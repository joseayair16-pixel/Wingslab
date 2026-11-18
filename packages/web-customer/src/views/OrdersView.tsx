import React from 'react';
import { useStore } from '../store';
import { ReceiptText, ChevronRight } from 'lucide-react';
import logo from '../assets/wingslab-wordmark.png';

interface OrdersViewProps {
  sortedOrders: any[];
  visibleOrdersCount: number;
  setSelectedOrderId: (id: string) => void;
  setIsDetailModalOpen: (val: boolean) => void;
  formatCurrency: (amount: number) => string;
  formatDate: (dateString: string) => string;
  StatusBadge: React.FC<any>;
  showLoadMore: boolean;
  loadMoreOrders: () => void;
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg className={`w-3.5 h-3.5 ${filled ? 'text-green-500' : 'text-neutral-200'}`} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.458 1l3.646 7 7.813.5-5.73 5.5 2.084 8-7.813-4-7.812 4 2.083-8L1 8.5 8.813 8l3.645-7z" />
    </svg>
  );
}

export function OrdersView({
  sortedOrders,
  visibleOrdersCount,
  setSelectedOrderId,
  setIsDetailModalOpen,
  formatCurrency,
  formatDate,
  StatusBadge,
  showLoadMore,
  loadMoreOrders
}: OrdersViewProps) {
  const setActiveSection = useStore(state => state.setActiveSection);

  return (
    <div className="wl-order-history max-w-3xl mx-auto w-full space-y-4">
      {!sortedOrders.length ? (
        <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
          <div className="mb-6 h-16 w-16 rounded-full bg-neutral-100 flex items-center justify-center">
            <ReceiptText className="h-7 w-7 text-red-600" />
          </div>
          <h3 className="text-lg font-semibold text-neutral-900">Aún no hay pedidos</h3>
          <p className="mt-1 mb-6 text-sm text-neutral-500 max-w-[260px]">
            Elige tus favoritos del menú de WingsLab y haz tu primer pedido.
          </p>
          <button
            type="button"
            onClick={() => { window.location.href = '/'; }}
            className="rounded-full bg-neutral-900 px-6 py-2.5 text-sm font-semibold text-white hover:bg-neutral-800 transition"
          >
            Ver menú WingsLab
          </button>
        </div>
      ) : (
        <>
          {sortedOrders.slice(0, visibleOrdersCount).map((order) => {

            return (
              <div key={order.id} className="wl-history-card bg-white rounded-2xl border border-neutral-100 overflow-hidden">
                <div className="flex gap-4 p-4">
                  <div className="wl-history-mark relative w-28 h-28 rounded-xl overflow-hidden flex-shrink-0 bg-neutral-50">
                    {order.restaurant.logo ? (
                      <img src={order.restaurant.logo} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center bg-[#bb0a0e] p-2"><img src={logo.src} alt="WingsLab" /></div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="text-base font-semibold text-neutral-900">{order.restaurant.name}</h4>
                        {order.rating ? (
                          <div className="flex items-center gap-0.5 mt-0.5">
                            {[1,2,3,4,5].map(i => <StarIcon key={i} filled={i <= Math.round(order.rating)} />)}
                            <span className="text-xs text-neutral-400 ml-1">{order.rating}</span>
                          </div>
                        ) : null}
                      </div>
                      <StatusBadge status={order.status} />
                    </div>
                    <p className="text-sm text-neutral-500 mt-1.5">
                      {formatCurrency(order.totalAmount)}
                      <span className="mx-1.5">·</span>
                      {formatDate(order.createdAt)}
                    </p>
                    {order.orderReference && <p className="mt-2 break-all text-[10px] text-neutral-500">{order.orderReference}</p>}
                  </div>
                </div>

                <div className="px-4 pb-4">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedOrderId(order.id);
                      setIsDetailModalOpen(true);
                    }}
                    className="w-full rounded-xl border border-neutral-200 py-2.5 text-sm font-semibold text-neutral-800 hover:bg-neutral-50 transition active:scale-[0.98]"
                  >
                    Ver detalles <ChevronRight className="ml-1 inline h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            );
          })}

          {showLoadMore ? (
            <div className="flex justify-center pt-2 pb-6">
              <button
                type="button"
                onClick={loadMoreOrders}
                className="rounded-full border border-neutral-200 bg-white px-6 py-2.5 text-sm font-semibold text-neutral-600 hover:border-neutral-300 hover:text-neutral-900 transition active:scale-[0.98]"
              >
                Cargar pedidos anteriores
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
