'use client';

import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { requestJson, readStoredSession } from '@sadel/shared';
import { useStore } from '../store';

function formatCurrency(amount: number) {
  return '$' + Math.round(amount).toLocaleString('es-MX');
}

function normalizeOrderStatusValue(status: string) {
  return status.trim().toUpperCase().replace(/[\s-]+/g, '_');
}

type DriverArrivedOrder = {
  id: string;
  orderReference: string;
  status: string;
  totalAmount: number;
  paymentMethod: 'CASH' | 'TRANSFER' | string;
  deliveryPin?: string | null;
  handoverPin?: string | null;
  driverArrivedAtCustomer?: string | null;
};

export default function DriverArrivalModal() {
  const storeToken = useStore((s) => s.token);
  const storeSessionUser = useStore((s) => s.sessionUser);
  const storeApiBase = useStore((s) => s.apiBase);

  const [session, setSession] = useState<{ token: string; user: any; apiBase: string } | null>(null);

  // Sincroniza la sesión desde el store global y, si está vacío (deep-link directo
  // a una ruta que no pasa por la home), desde localStorage.
  useEffect(() => {
    if (storeToken && storeSessionUser) {
      setSession({ token: storeToken, user: storeSessionUser, apiBase: storeApiBase });
      return;
    }
    try {
      const saved = readStoredSession('sadel.customer');
      if (saved.token && saved.user) {
        setSession({ token: saved.token, user: saved.user, apiBase: saved.apiBase || storeApiBase });
      } else {
        setSession(null);
      }
    } catch {
      setSession(null);
    }
  }, [storeToken, storeSessionUser, storeApiBase]);

  const token = session?.token ?? '';
  const sessionUser = session?.user ?? null;
  const apiBase = session?.apiBase || storeApiBase;

  const [arrivedOrder, setArrivedOrder] = useState<DriverArrivedOrder | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const lastCheckedRef = useRef<Record<string, number>>({});

  const playLlegueSound = () => {
    try {
      if (typeof window === 'undefined') return;
      if (window.localStorage.getItem('customerAlertSoundEnabled') === 'false') return;

      const audioEl = document.getElementById('customer-llegue-audio') as HTMLAudioElement | null;
      if (audioEl) {
        audioEl.currentTime = 0;
        audioEl.volume = 1.0;
        audioEl.play().catch(() => {});
      } else {
        const audio = new Audio('/sounds/llegue.wav');
        audio.volume = 1.0;
        audio.play().catch(() => {});
      }
    } catch (e) {
      /* noop */
    }
    try {
      if (navigator.vibrate) navigator.vibrate([800, 400, 800, 400, 800]);
    } catch (e) {
      /* noop */
    }
  };

  const openArrivalModal = (order: DriverArrivedOrder) => {
    setArrivedOrder(order);
    setModalOpen(true);
    playLlegueSound();
    try {
      localStorage.setItem('sadel_persistent_modal', JSON.stringify({ type: 'driver_arrived', orderId: order.id }));
    } catch {}
  };

  // Polling global: detecta la llegada del repartidor sin importar la ruta.
  useEffect(() => {
    if (!token || !sessionUser || sessionUser.role !== 'CUSTOMER') return;

    const checkArrival = async () => {
      try {
        const res = await requestJson<{
          success: true;
          data: { items: DriverArrivedOrder[] };
        }>({
          apiBase,
          path: '/me/pedidos?page=1&limit=15',
          token,
        });
        if (!res.success || !res.data || !Array.isArray(res.data.items)) return;

        const now = Date.now();
        for (const order of res.data.items) {
          const status = normalizeOrderStatusValue(order.status);
          if (status !== 'IN_TRANSIT' && status !== 'DRIVER_ARRIVED') continue;
          if (!order.driverArrivedAtCustomer) continue;

          // No re-abrir el modal si el comensal ya pulsó "Entendido".
          try {
            if (localStorage.getItem(`sadel_driver_arrived_ack_${order.id}`) === 'true') continue;
          } catch {}

          // Evitar re-check inmediato del mismo pedido.
          const last = lastCheckedRef.current[order.id];
          if (last && now - last < 30_000) continue;
          lastCheckedRef.current[order.id] = now;

          openArrivalModal(order);
          return; // solo un modal a la vez
        }
      } catch {
        // ignore polling errors
      }
    };

    void checkArrival();
    const interval = window.setInterval(checkArrival, 6_000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void checkArrival();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [apiBase, token, sessionUser]);

  // Socket global: reacción inmediata al evento de llegada (además del polling).
  useEffect(() => {
    if (!token || !sessionUser || sessionUser.role !== 'CUSTOMER') return;

    const socket = io(process.env.NEXT_PUBLIC_SOCKET_URL || 'https://sadel-production.up.railway.app', {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
    });

    const sessionUserIdRef = sessionUser.id;
    socket.on('connect', () => {
      socket.emit('join-room', sessionUserIdRef, 'CUSTOMER');
    });

    for (const eventName of ['order:driver-arrived', 'order:driver_arrived']) {
      socket.on(eventName, async (payload: { orderId?: string }) => {
        if (!payload?.orderId) return;
        try {
          if (localStorage.getItem(`sadel_driver_arrived_ack_${payload.orderId}`) === 'true') return;
        } catch {}

        try {
          const res = await requestJson<{ success: true; data: DriverArrivedOrder }>({
            apiBase,
            path: `/me/pedidos/${payload.orderId}`,
            token,
          });
          if (!res.success || !res.data) return;
          const status = normalizeOrderStatusValue(res.data.status);
          if ((status === 'IN_TRANSIT' || status === 'DRIVER_ARRIVED') && res.data.driverArrivedAtCustomer) {
            openArrivalModal(res.data);
          }
        } catch {
          // si falla la carga del detalle, el polling lo reintentará
        }
      });
    }

    return () => {
      socket.disconnect();
    };
  }, [apiBase, token, sessionUser]);

  if (!modalOpen || !arrivedOrder) return null;

  const ackAndClose = () => {
    setModalOpen(false);
    setArrivedOrder(null);
    try {
      localStorage.setItem(`sadel_driver_arrived_ack_${arrivedOrder.id}`, 'true');
    } catch {}
    localStorage.removeItem('sadel_driver_arrived_order');
    localStorage.removeItem('sadel_persistent_modal');
  };

  const isTransfer = arrivedOrder.paymentMethod === 'TRANSFER';

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4 py-6">
      <div
        className="bg-white rounded-3xl border border-black/[0.03] shadow-[0_20px_50px_rgba(0,0,0,0.15)] p-7 w-full max-w-md h-fit max-h-[90vh] overflow-y-auto relative transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-sky-1000/10 to-transparent rounded-full blur-3xl pointer-events-none"></div>

        <div className="text-center mb-6">
          <div className="w-20 h-20 bg-sky-200 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-sky-100 shadow-inner">
            <span className="text-4xl animate-bounce">🛵</span>
          </div>
          <h3 className="text-2xl font-black text-neutral-950 tracking-tight">¡Tu repartidor ha llegado!</h3>
          <p className="text-sm text-neutral-500 mt-1">El repartidor ya está afuera de tu domicilio con tu pedido.</p>
        </div>

        <div className="space-y-4">
          <div className="p-5 rounded-2xl bg-amber-50/40 border border-amber-100/50">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider">
                  {arrivedOrder.paymentMethod === 'CASH' ? 'Total a pagar' : 'Total del pedido'}
                </p>
                <p className="text-3xl font-black text-neutral-900 mt-1">
                  {formatCurrency(arrivedOrder.totalAmount)}
                </p>
              </div>
              <div className="text-right">
                <span className={`inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                  arrivedOrder.paymentMethod === 'CASH'
                    ? 'bg-amber-100 text-amber-800 border border-amber-200'
                    : isTransfer
                      ? 'bg-sky-100 text-sky-800 border border-sky-200'
                      : 'bg-green-100 text-green-800 border border-green-200'
                }`}>
                  {arrivedOrder.paymentMethod === 'CASH' ? '💵 Efectivo' : isTransfer ? '🏦 Transferencia' : '💳 Pago Online'}
                </span>
                <p className="text-[10px] text-neutral-400 mt-1.5 font-medium">
                  {arrivedOrder.paymentMethod === 'CASH' ? 'Prepara el efectivo exacto' : 'Ya pagado vía app'}
                </p>
              </div>
            </div>
          </div>

          {isTransfer && (arrivedOrder.deliveryPin || arrivedOrder.handoverPin) && (
            <div className="p-5 rounded-2xl bg-indigo-50/50 border border-indigo-100/50 text-center">
              <p className="text-[10px] font-semibold text-indigo-600 uppercase tracking-widest">Código de entrega</p>
              <p className="text-4xl font-extrabold tracking-[0.25em] text-indigo-950 font-mono mt-2 mb-1.5 pl-[0.25em]">
                {arrivedOrder.deliveryPin || arrivedOrder.handoverPin}
              </p>
              <p className="text-[11px] text-neutral-500 leading-relaxed">
                Proporciona este código al repartidor para confirmar la entrega.
              </p>
            </div>
          )}
        </div>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={ackAndClose}
            className="flex-1 rounded-full bg-neutral-950 text-white py-3.5 text-sm font-bold shadow-md transition hover:bg-neutral-800 active:scale-95"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}
