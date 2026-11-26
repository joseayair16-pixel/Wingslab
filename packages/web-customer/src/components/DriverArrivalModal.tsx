'use client';

import { getWingslabSocketUrl } from '@sadel/shared';
import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { requestJson, readStoredSession, forceSessionExpired, handleSocketUnauthorized } from '@sadel/shared';
import { useStore } from '../store';
import { useCustomerSounds } from '../hooks/useCustomerSounds';

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
  const soundedOrderRef = useRef<Set<string>>(new Set());

  // Pantallas del repartidor propio/red: el modal de llegada es SOLO del comensal.
  const [pathname, setPathname] = useState('');
  useEffect(() => {
    setPathname(window.location.pathname);
  }, []);
  const isDeliveryScreen = pathname.startsWith('/reparto/');

  const { playLlegue } = useCustomerSounds();

  const openArrivalModal = (order: DriverArrivedOrder) => {
    // Dedup de sonido: por pedido el sonido de llegada suena UNA sola vez,
    // aunque el evento llegue por socket y por polling.
    const alreadySounded = soundedOrderRef.current.has(order.id);
    if (modalOpen && arrivedOrder?.id === order.id) return;
    if (!alreadySounded) {
      soundedOrderRef.current.add(order.id);
      playLlegue();
    }
    setArrivedOrder(order);
    setModalOpen(true);
    try {
      localStorage.setItem('sadel_persistent_modal', JSON.stringify({ type: 'driver_arrived', orderId: order.id }));
    } catch {}
  };

  // Polling global: detecta la llegada del repartidor sin importar la ruta.
  useEffect(() => {
    if (!token || !sessionUser || sessionUser.role !== 'CUSTOMER' || isDeliveryScreen) return;

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
    if (!token || !sessionUser || sessionUser.role !== 'CUSTOMER' || isDeliveryScreen) return;

    let cancelled = false;

    const getSocketToken = () => readStoredSession('sadel.customer').token || '';
    const socket = io(getWingslabSocketUrl(), {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
      auth: { token: getSocketToken() },
    });

    // 'reconnect_attempt' pertenece al Manager (socket.io), no al Socket: si se
    // registra en el socket nunca se dispara y cada reintento viaja con el
    // access token del montaje (rechazado tras una rotación).
    const handleReconnectAttempt = () => {
      socket.auth = { token: getSocketToken() };
    };
    socket.io.on('reconnect_attempt', handleReconnectAttempt);

    const sessionUserIdRef = sessionUser.id;
    socket.on('connect', () => {
      socket.emit('join-room', sessionUserIdRef, 'CUSTOMER');
    });

    socket.on('connect_error', (err) => {
      // Token rechazado: intentar renovar y reconectar antes de sentenciar la
      // sesión. Solo un refresh definitivamente inválido cierra sesión; un
      // fallo transitorio deja el polling de respaldo sin formar bucles.
      if (String((err as Error)?.message || '').includes('UNAUTHORIZED')) {
        socket.disconnect();
        void handleSocketUnauthorized({
          apiBase,
          storageKey: 'sadel.customer',
          socket,
          isActive: () => !cancelled,
          onLoggedOut: () => forceSessionExpired(),
        });
        return;
      }
      // Fallo de conexión: el polling de respaldo sigue cubriendo la llegada del
      // repartidor mientras socket.io reintenta por su cuenta.
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[Socket] connect_error:', err?.message || err);
      }
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
      cancelled = true;
      socket.io.off('reconnect_attempt', handleReconnectAttempt);
      socket.disconnect();
    };
  }, [apiBase, token, sessionUser]);

  if (!modalOpen || !arrivedOrder || isDeliveryScreen) return null;

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
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-neutral-950/60 backdrop-blur-sm px-4 py-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="driver-arrival-title"
        aria-describedby="driver-arrival-description"
        className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-[28px] border border-white bg-white p-5 sm:p-7 shadow-[0_24px_80px_rgba(0,0,0,0.2)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center mb-5">
          <div className="mx-auto mb-4 flex h-28 w-36 items-center justify-center overflow-hidden rounded-[24px] bg-gradient-to-br from-red-50 to-orange-50">
            <img src="/seguimiento-moto.webp" alt="" aria-hidden="true" className="h-full w-full object-contain mix-blend-multiply" />
          </div>
          <p className="mb-2 inline-flex items-center gap-2 rounded-full bg-red-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-red-700"><span className="h-2 w-2 rounded-full bg-red-500" /> Pedido en tu domicilio</p>
          <h3 id="driver-arrival-title" className="text-2xl font-black text-neutral-950 tracking-tight">¡Tu repartidor ha llegado!</h3>
          <p id="driver-arrival-description" className="text-sm leading-relaxed text-neutral-500 mt-2">El repartidor ya está afuera de tu domicilio con tu pedido.</p>
        </div>

        <div className="space-y-4">
          <div className="p-4 sm:p-5 rounded-[20px] bg-gradient-to-r from-orange-50 to-red-50 border border-orange-100">
            <div className="flex flex-wrap gap-3 justify-between items-center">
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
                      ? 'bg-white text-neutral-700 border border-neutral-200'
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

          {arrivedOrder.paymentMethod !== 'CASH' && (arrivedOrder.deliveryPin || arrivedOrder.handoverPin) && (
            <div className="p-5 rounded-[20px] bg-neutral-50 border border-neutral-100 text-center">
              <p className="text-[10px] font-bold text-red-700 uppercase tracking-widest">Código de entrega</p>
              <p className="text-4xl font-extrabold tracking-[0.25em] text-neutral-950 font-mono mt-2 mb-1.5 pl-[0.25em]">
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
            className="flex-1 rounded-full bg-gradient-to-b from-red-500 to-red-700 text-white py-4 text-sm font-bold shadow-lg shadow-red-200 transition hover:from-red-600 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}
