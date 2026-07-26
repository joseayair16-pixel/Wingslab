'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable react-hooks/exhaustive-deps */

import { useEffect, useState } from 'react';

interface DeliveryTicketData {
  id: string;
  orderReference: string;
  status: string;
  totalAmount: number;
  paymentMethod: string;
  deliveryAddress: {
    street: string;
    number: string;
    neighborhood: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
    reference?: string | null;
    latitude: number;
    longitude: number;
  };
  notes?: string | null;
  handoverPin?: string | null;
  restaurant: {
    name: string;
    phone: string;
    businessType?: string;
  };
  customer: {
    name: string;
    phone: string;
  };
}

interface ScannedDelivery {
  token: string;
  data: DeliveryTicketData;
  arrived: boolean;
  delivered: boolean;
  scannedAt: number;
  deliveredAt?: number;
}

interface PageProps {
  params: {
    token: string;
  };
}

export default function DeliveryTicketPage({ params }: PageProps) {
  const token = params.token;
  
  const [isMounted, setIsMounted] = useState(false);
  const [deliveries, setDeliveries] = useState<ScannedDelivery[]>([]);
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [llegueError, setLlegueError] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [modalOpenedFromDashboard, setModalOpenedFromDashboard] = useState(false);

  // Dark mode automático por preferencia del sistema
  const [darkMode, setDarkMode] = useState(false);
  
  useEffect(() => {
    setIsMounted(true);
  }, []);

  const apiBase = '/api';

  const triggerHaptic = (pattern: number[]) => {
    if (typeof window !== 'undefined' && window.navigator && window.navigator.vibrate) {
      window.navigator.vibrate(pattern);
    }
  };

  // Dark mode automático según preferencia del sistema
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (isDark: boolean) => {
      setDarkMode(isDark);
      if (isDark) {
        document.documentElement.classList.add('dark', 'pure-dark');
      } else {
        document.documentElement.classList.remove('dark', 'pure-dark');
      }
    };

    apply(mq.matches);
    const handler = (e: MediaQueryListEvent) => apply(e.matches);
    mq.addEventListener('change', handler);

    return () => {
      mq.removeEventListener('change', handler);
      document.documentElement.classList.remove('dark', 'pure-dark');
    };
  }, []);

  // Cargar tickets de localStorage y sincronizar el token actual de la URL
  const loadAndSyncTicket = async () => {
    try {
      setLoading(true);
      setError('');
      
      let currentList: ScannedDelivery[] = [];
      if (typeof window !== 'undefined') {
        const stored = localStorage.getItem('sadel_scanned_deliveries');
        if (stored) {
          try {
            currentList = JSON.parse(stored) as ScannedDelivery[];
            currentList = currentList.filter(item => {
              if (item.delivered && Date.now() - item.scannedAt > 12 * 60 * 60 * 1000) {
                return false;
              }
              return true;
            });
          } catch (e) {
            currentList = [];
          }
        }
      }

      let fetchedTicket: DeliveryTicketData | null = null;
      let fetchErrMessage = '';

      if (token) {
        try {
          const response = await fetch(`${apiBase}/public/delivery-ticket/${token}`);
          const data = await response.json();

          if (response.ok && data.success) {
            fetchedTicket = data.data as DeliveryTicketData;
          } else {
            fetchErrMessage = data.error?.message || 'No se pudo cargar la información de reparto del pedido escaneado.';
          }
        } catch (err: any) {
          fetchErrMessage = err.message || 'Error de conexión al cargar el pedido.';
        }
      }

      if (fetchedTicket && token) {
        const existingIndex = currentList.findIndex(item => item.token === token);
        const isArrived = typeof window !== 'undefined' 
          ? localStorage.getItem(`sadel_arrived_${token}`) === 'true'
          : false;

        const isDelivered = fetchedTicket.status === 'DELIVERED';

        const updatedDelivery: ScannedDelivery = {
          token,
          data: fetchedTicket,
          arrived: isArrived,
          delivered: isDelivered,
          scannedAt: existingIndex >= 0 ? currentList[existingIndex].scannedAt : Date.now(),
          deliveredAt: isDelivered 
            ? (existingIndex >= 0 ? (currentList[existingIndex].deliveredAt || Date.now()) : Date.now())
            : undefined,
        };

        if (existingIndex >= 0) {
          currentList[existingIndex] = updatedDelivery;
        } else {
          currentList.push(updatedDelivery);
        }

        if (typeof window !== 'undefined') {
          localStorage.setItem('sadel_scanned_deliveries', JSON.stringify(currentList));
        }
      } else if (fetchErrMessage && currentList.length === 0) {
        throw new Error(fetchErrMessage);
      }

      setDeliveries(currentList);

      const activeDeliveries = currentList.filter(d => !d.delivered);
      
      if (activeDeliveries.length === 1 && token) {
        setSelectedToken(token);
      } else if (activeDeliveries.length === 0 && currentList.length === 1) {
        setSelectedToken(currentList[0].token);
      } else {
        setSelectedToken(null);
      }

    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Este enlace de reparto ya no está activo o ha expirado.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      void loadAndSyncTicket();
    }
  }, [token]);

  // Sincronizar en segundo plano otros pedidos guardados
  useEffect(() => {
    if (deliveries.length > 1) {
      const otherActiveDeliveries = deliveries.filter(d => d.token !== token && !d.delivered);
      otherActiveDeliveries.forEach(async (delivery) => {
        try {
          const response = await fetch(`${apiBase}/public/delivery-ticket/${delivery.token}`);
          const data = await response.json();
          if (response.ok && data.success) {
            const ticketData = data.data as DeliveryTicketData;
            setDeliveries(prev => {
              const newList = prev.map(item => {
                if (item.token === delivery.token) {
                  const wasDelivered = item.delivered;
                  const isNowDelivered = ticketData.status === 'DELIVERED';
                  return {
                    ...item,
                    data: ticketData,
                    delivered: isNowDelivered,
                    deliveredAt: isNowDelivered 
                      ? (wasDelivered ? (item.deliveredAt || Date.now()) : Date.now())
                      : undefined,
                  };
                }
                return item;
              });
              if (typeof window !== 'undefined') {
                localStorage.setItem('sadel_scanned_deliveries', JSON.stringify(newList));
              }
              return newList;
            });
          }
        } catch (e) {
          console.error(`Error al actualizar token ${delivery.token} en segundo plano:`, e);
        }
      });
    }
  }, [deliveries.length]);

  const activeDelivery = deliveries.find(d => d.token === selectedToken);
  const currentTicket = activeDelivery ? activeDelivery.data : null;
  const currentArrived = activeDelivery ? activeDelivery.arrived : false;
  const currentDelivered = activeDelivery ? activeDelivery.delivered : false;

  // Notificar llegada genérico para un token
  const handleLlegueForToken = async (targetToken: string) => {
    const deliv = deliveries.find(d => d.token === targetToken);
    if (!deliv || deliv.arrived || notifying) return;

    try {
      setNotifying(true);
      setLlegueError('');
      triggerHaptic([40, 60, 40]);

      const response = await fetch(`${apiBase}/public/delivery-ticket/${targetToken}/llegue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error?.message || 'Error al notificar la llegada al cliente.');
      }

      setDeliveries(prev => {
        const newList = prev.map(item => {
          if (item.token === targetToken) {
            return { ...item, arrived: true };
          }
          return item;
        });
        if (typeof window !== 'undefined') {
          localStorage.setItem('sadel_scanned_deliveries', JSON.stringify(newList));
          localStorage.setItem(`sadel_arrived_${targetToken}`, 'true');
        }
        return newList;
      });

      triggerHaptic([100, 50, 150]);
    } catch (err: any) {
      console.error(err);
      setLlegueError(err.message || 'No se pudo enviar la notificación de llegada.');
      triggerHaptic([300, 100]);
    } finally {
      setNotifying(false);
    }
  };

  // Notificar llegada desde vista detalle
  const handleLlegue = async () => {
    if (!selectedToken) return;
    await handleLlegueForToken(selectedToken);
  };

  // Mostrar modal de confirmación antes de entregar (desde detalle)
  const handleDeliver = (e: React.FormEvent) => {
    e.preventDefault();
    triggerHaptic([30]);
    setShowConfirmModal(true);
  };

  // Mostrar modal directamente desde la lista/dashboard
  const handleDeliverDirectly = (targetToken: string) => {
    setSelectedToken(targetToken);
    setModalOpenedFromDashboard(true);
    triggerHaptic([30]);
    setShowConfirmModal(true);
  };

  // Completar entrega real tras confirmación del modal
  const executeDeliver = async () => {
    const targetToken = selectedToken;
    if (!targetToken) return;

    // Buscar el ticket correspondiente al token activo
    const targetDelivery = deliveries.find(d => d.token === targetToken);
    if (!targetDelivery) return;
    const ticketData = targetDelivery.data;

    const isCash = ticketData.paymentMethod === 'CASH';

    try {
      setSubmitting(true);
      setError('');
      triggerHaptic([40]);

      const response = await fetch(`${apiBase}/public/delivery-ticket/${targetToken}/entregar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isCash ? {} : { pin }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error?.message || 'Error al completar la entrega.');
      }

      setDeliveries(prev => {
        const newList = prev.map(item => {
          if (item.token === targetToken) {
            return { 
              ...item, 
              delivered: true, 
              deliveredAt: Date.now(),
              data: { ...item.data, status: 'DELIVERED' } 
            };
          }
          return item;
        });
        if (typeof window !== 'undefined') {
          localStorage.setItem('sadel_scanned_deliveries', JSON.stringify(newList));
        }
        return newList;
      });

      setPin('');
      setShowConfirmModal(false);
      if (modalOpenedFromDashboard) {
        setSelectedToken(null);
      }
      setModalOpenedFromDashboard(false);
      triggerHaptic([100, 50, 100, 50, 200]);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'No se pudo completar la entrega del pedido.');
      setShowConfirmModal(false);
      if (modalOpenedFromDashboard) {
        setSelectedToken(null);
      }
      setModalOpenedFromDashboard(false);
      triggerHaptic([300, 100, 300]);
    } finally {
      setSubmitting(false);
    }
  };

  // Eliminar un pedido del listado
  const handleRemoveDelivery = (tokenToRemove: string, e: React.MouseEvent) => {
    e.stopPropagation();
    triggerHaptic([50, 30]);

    setDeliveries(prev => {
      const newList = prev.filter(item => item.token !== tokenToRemove);
      if (typeof window !== 'undefined') {
        localStorage.setItem('sadel_scanned_deliveries', JSON.stringify(newList));
        localStorage.removeItem(`sadel_arrived_${tokenToRemove}`);
      }
      return newList;
    });

    if (selectedToken === tokenToRemove) {
      setSelectedToken(null);
    }
  };

  const activeCount = deliveries.filter(d => !d.delivered).length;

  // ──────────────────────────
  // Clases reutilizables
  // ──────────────────────────
  const bg = darkMode ? 'bg-[#09090b]' : 'bg-[#f6f6f4]';
  const textPrimary = darkMode ? 'text-zinc-50' : 'text-neutral-900';
  const textSecondary = darkMode ? 'text-zinc-400' : 'text-neutral-500';
  const textTertiary = darkMode ? 'text-zinc-500' : 'text-neutral-400';
  const cardBg = darkMode ? 'bg-[#121214]' : 'bg-white';
  const cardBorder = darkMode ? 'border-zinc-800/60' : 'border-black/5';
  const divider = darkMode ? 'border-zinc-800/60' : 'border-black/5';

  // ──────────────────────────
  // PANTALLA DE CARGA / MONTAJE (EVITA HYDRATION ERRORS)
  // ──────────────────────────
  if (!isMounted || loading) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center px-4 text-center bg-[#f6f6f4] text-neutral-900">
        <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-black/10 border-t-sky-400" />
        <p className="mt-4 text-xs font-semibold tracking-wide text-neutral-500">Cargando ruta de entrega…</p>
      </div>
    );
  }

  // ──────────────────────────
  // PANTALLA DE ERROR
  // ──────────────────────────
  if (error && deliveries.length === 0) {
    return (
      <div className={`flex min-h-[100dvh] flex-col items-center justify-center px-6 text-center ${bg}`}>
        <div className={`flex h-14 w-14 items-center justify-center rounded-2xl ${darkMode ? 'bg-red-950/30 text-red-400' : 'bg-red-50 text-red-500'}`}>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-7 h-7">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
        </div>
        <h3 className={`mt-5 text-base font-bold tracking-tight ${textPrimary}`}>Enlace no disponible</h3>
        <p className={`mt-1.5 text-xs max-w-[260px] leading-relaxed ${textSecondary}`}>
          {error}
        </p>
        <button
          onClick={() => { triggerHaptic([30]); window.location.reload(); }}
          className="mt-5 rounded-xl bg-sky-400 px-5 py-2.5 text-xs font-bold text-white transition active:scale-95 active-scale"
        >
          Reintentar
        </button>
      </div>
    );
  }

  // ══════════════════════════════════════
  // VISTA 1: DASHBOARD MULTI-PEDIDO
  // ══════════════════════════════════════
  if (selectedToken === null) {
    const activeList = deliveries.filter(d => !d.delivered);
    const completedList = deliveries
      .filter(d => d.delivered)
      .sort((a, b) => {
        const timeA = a.deliveredAt || a.scannedAt || 0;
        const timeB = b.deliveredAt || b.scannedAt || 0;
        return timeB - timeA;
      });

    const totalCashAmount = activeList
      .filter(d => d.data.paymentMethod === 'CASH')
      .reduce((sum, d) => sum + d.data.totalAmount, 0);

    return (
      <div className={`min-h-[100dvh] font-sans antialiased pb-12 transition-colors duration-300 ${bg} ${textPrimary}`}>
        
        {/* ── HEADER COMPACTO E INTELIGENTE ── */}
        <header className={`sticky top-0 z-50 border-b backdrop-blur-md transition-all duration-300 ${
          darkMode 
            ? 'bg-[#09090b]/90 border-zinc-800/60' 
            : 'bg-white/90 border-black/[0.04]'
        }`}>
          <div className="mx-auto flex max-w-lg items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <span className={`flex h-7 w-7 items-center justify-center rounded-xl shadow-sm ${
                darkMode ? 'bg-sky-400/10 text-sky-300' : 'bg-sky-50 text-sky-500'
              }`}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0 1.5 1.5 0 0 1 3 0ZM18.75 18.75a1.5 1.5 0 0 1-3 0 1.5 1.5 0 0 1 3 0ZM6.75 18.75h10.5m-10.5-6h7.5L18 18.75m-6.75-6V8.25h5.25L18.75 12" />
                </svg>
              </span>
              <span className={`text-[12px] font-extrabold uppercase tracking-widest ${
                darkMode ? 'text-zinc-200' : 'text-neutral-800'
              }`}>SaDeL Express</span>
            </div>

            <div className={`flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-bold shadow-[0_2px_8px_rgba(0,0,0,0.02)] ${
              darkMode ? 'bg-zinc-900 text-zinc-300 border border-zinc-800' : 'bg-neutral-900 text-white'
            }`}>
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
              </span>
              <span>{activeList.length} en ruta</span>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-lg px-4 pb-20">

          {/* ── PANEL "MI JORNADA" (Resumen Dinámico) ── */}
          <div className={`mt-4 rounded-[28px] p-5 shadow-[0_12px_40px_rgba(0,0,0,0.03)] border transition-all duration-300 ${
            darkMode 
              ? 'bg-gradient-to-br from-[#1e1b4b] to-[#0a0a0c] border-zinc-800/60 text-white' 
              : 'bg-gradient-to-br from-sky-400 to-sky-600 border-transparent text-white'
          }`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider opacity-75">Mi Jornada</p>
                <h2 className="text-xl font-extrabold tracking-tight mt-0.5">Resumen de Ruta</h2>
              </div>
              <span className="text-xl">⚡</span>
            </div>

            <div className="grid grid-cols-3 gap-2.5 mt-4">
              <div className="rounded-2xl bg-white/10 p-3 backdrop-blur-sm">
                <p className="text-[9px] font-bold uppercase tracking-wider opacity-85">Pendientes</p>
                <p className="text-lg font-black mt-0.5">{activeList.length}</p>
              </div>
              <div className="rounded-2xl bg-white/10 p-3 backdrop-blur-sm">
                <p className="text-[9px] font-bold uppercase tracking-wider opacity-85">Entregados</p>
                <p className="text-lg font-black mt-0.5">{completedList.length}</p>
              </div>
              <div className="rounded-2xl bg-white/10 p-3 backdrop-blur-sm">
                <p className="text-[9px] font-bold uppercase tracking-wider opacity-85">Por Cobrar</p>
                <p className="text-lg font-black mt-0.5">${totalCashAmount.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
              </div>
            </div>

            {/* Progress bar */}
            {deliveries.length > 0 && (
              <div className="mt-4">
                <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider opacity-75 mb-1.5">
                  <span>Progreso de entrega</span>
                  <span>{Math.round((completedList.length / deliveries.length) * 100)}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-white/20 overflow-hidden">
                  <div 
                    className="h-full bg-emerald-400 transition-all duration-500 rounded-full"
                    style={{ width: `${(completedList.length / deliveries.length) * 100}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* ── BANNER ALERTA DE COBRO EN EFECTIVO TOTAL ── */}
          {totalCashAmount > 0 && (
            <div className={`mt-3 flex items-center gap-3 rounded-2xl px-4 py-3.5 border transition-all ${
              darkMode 
                ? 'bg-amber-950/20 border-amber-900/30' 
                : 'bg-amber-50 border-amber-200/50'
            }`}>
              <span className="text-2xl">💵</span>
              <div className="flex-1 min-w-0">
                <p className={`text-[10px] font-bold uppercase tracking-wider ${darkMode ? 'text-amber-400' : 'text-amber-700'}`}>
                  Total de efectivo a liquidar
                </p>
                <p className={`text-xl font-black tracking-tight mt-0.5 ${darkMode ? 'text-amber-300' : 'text-amber-950'}`}>
                  ${totalCashAmount.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>
          )}

          {/* ── LISTADO DE PEDIDOS ACTIVOS ── */}
          <div className="mt-6">
            <p className={`text-[10px] font-black uppercase tracking-widest mb-3 ${textTertiary}`}>
              Ruta activa ({activeList.length})
            </p>

            {activeList.length === 0 ? (
              <div className={`rounded-[28px] border-2 border-dashed p-10 text-center transition-all ${
                darkMode ? 'border-zinc-800 bg-zinc-900/20' : 'border-neutral-200 bg-white'
              } shadow-[0_8px_30px_rgb(0,0,0,0.01)]`}>
                <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500 text-3xl mb-3">
                  🎉
                </div>
                <h3 className={`text-sm font-bold tracking-tight ${textPrimary}`}>¡Ruta completada!</h3>
                <p className={`text-xs mt-1.5 max-w-[220px] mx-auto leading-relaxed ${textSecondary}`}>
                  No tienes pedidos pendientes en tu jornada. Escanea un QR de entrega para comenzar.
                </p>
              </div>
            ) : (
              <div className="space-y-3.5">
                {activeList.map((deliv, index) => {
                  const isCash = deliv.data.paymentMethod === 'CASH';
                  const addressObj = deliv.data.deliveryAddress;
                  const addressText = `${addressObj.street} ${addressObj.number}, ${addressObj.neighborhood}, ${addressObj.city}`;
                  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressText)}`;
                  const wazeUrl = addressObj.latitude && addressObj.longitude
                    ? `https://waze.com/ul?ll=${addressObj.latitude},${addressObj.longitude}&navigate=yes`
                    : null;

                  return (
                    <div
                      key={deliv.token}
                      className={`group relative rounded-[28px] border p-5 transition-all shadow-[0_4px_24px_rgba(0,0,0,0.015)] hover:shadow-[0_8px_32px_rgba(0,0,0,0.03)] hover:-translate-y-0.5 ${cardBg} ${cardBorder}`}
                    >
                      {/* Botón Quitar de Ruta (Trash) */}
                      <button
                        type="button"
                        onClick={(e) => handleRemoveDelivery(deliv.token, e)}
                        className={`absolute top-4 right-4 flex h-7 w-7 items-center justify-center rounded-full transition-all border ${
                          darkMode 
                            ? 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-red-400 hover:bg-zinc-800' 
                            : 'bg-neutral-50 border-neutral-100 text-neutral-400 hover:text-red-500 hover:bg-neutral-100'
                        }`}
                        title="Quitar de ruta"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-3.5 h-3.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.34 9a4.847 4.847 0 0 1-3.637-3.637L10 9m0 9v-6M4 6h16M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>

                      {/* AREA PRINCIPAL CLICKABLE (Abre Detalles) */}
                      <div 
                        onClick={() => { triggerHaptic([20]); setSelectedToken(deliv.token); }}
                        className="cursor-pointer"
                      >
                        {/* Fila superior: Índice y Pago */}
                        <div className="flex items-center gap-3">
                          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-black shadow-sm ${
                            darkMode ? 'bg-sky-400/10 text-sky-300' : 'bg-sky-50 text-sky-500'
                          }`}>
                            {index + 1}
                          </span>
                          <span className={`text-xs font-bold px-2.5 py-1 rounded-full shadow-sm border ${
                            isCash 
                              ? darkMode 
                                ? 'bg-amber-950/20 text-amber-400 border-amber-900/30' 
                                : 'bg-amber-50 text-amber-700 border-amber-200/50'
                              : darkMode 
                                ? 'bg-emerald-950/20 text-emerald-400 border-emerald-900/30' 
                                : 'bg-emerald-50 text-emerald-700 border-emerald-200/50'
                          }`}>
                            {isCash ? `💵 Cobrar: $${deliv.data.totalAmount.toFixed(0)}` : '💳 Pagado en línea'}
                          </span>
                        </div>

                        {/* Nombre del Cliente */}
                        <h3 className={`text-base font-extrabold tracking-tight mt-3 truncate pr-8 ${textPrimary}`}>
                          {deliv.data.customer.name}
                        </h3>

                        {/* Dirección */}
                        <div className="flex items-start gap-2 mt-2">
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className={`w-4 h-4 shrink-0 mt-0.5 ${textTertiary}`}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
                          </svg>
                          <div className="min-w-0 flex-1">
                            <p className={`text-xs font-bold leading-tight ${textPrimary}`}>
                              {addressObj.street} {addressObj.number}
                            </p>
                            <p className={`text-[11px] mt-0.5 truncate ${textSecondary}`}>
                              {addressObj.neighborhood}, {addressObj.city}
                            </p>
                          </div>
                        </div>

                        {/* Notas/Referencias de entrega */}
                        {addressObj.reference && (
                          <div className={`mt-2.5 rounded-2xl px-3 py-2 text-[11px] leading-relaxed flex gap-2 border ${
                            darkMode 
                              ? 'bg-zinc-900/40 border-zinc-800 text-zinc-300' 
                              : 'bg-neutral-50 border-black/[0.03] text-neutral-600'
                          }`}>
                            <span className="text-xs shrink-0">📍</span>
                            <span className="italic truncate">{addressObj.reference}</span>
                          </div>
                        )}

                        {/* Fila de detalles: Restaurante y Estado */}
                        <div className="flex items-center justify-between mt-3.5 pt-3 border-t border-black/[0.03] dark:border-white/[0.03]">
                          <span className={`text-[10px] font-bold tracking-wide truncate ${textTertiary}`}>
                            🏪 {deliv.data.restaurant.name}
                          </span>
                          
                          <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            deliv.arrived
                              ? darkMode ? 'bg-emerald-950/20 text-emerald-400' : 'bg-emerald-50 text-emerald-700'
                              : darkMode ? 'bg-zinc-800 text-zinc-400' : 'bg-neutral-100 text-neutral-500'
                          }`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${deliv.arrived ? 'bg-emerald-400' : 'bg-zinc-400'}`} />
                            {deliv.arrived ? 'En destino' : 'En camino'}
                          </span>
                        </div>
                      </div>

                      {/* ACCIONES RÁPIDAS (Fila inferior de botones) */}
                      <div className="flex items-center gap-2 mt-4 pt-3.5 border-t border-black/[0.04] dark:border-white/[0.04]">
                        
                        {/* Navegar - Google Maps */}
                        <a
                          href={googleMapsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => { e.stopPropagation(); triggerHaptic([30]); }}
                          className={`flex h-10 w-10 items-center justify-center rounded-xl transition-all active:scale-90 border shadow-sm ${
                            darkMode 
                              ? 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800' 
                              : 'bg-white border-black/[0.06] text-neutral-700 hover:bg-neutral-50'
                          }`}
                          title="Google Maps"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.2" stroke="currentColor" className="w-5 h-5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
                          </svg>
                        </a>

                        {/* Navegar - Waze (si tiene coordenadas) */}
                        {wazeUrl && (
                          <a
                            href={wazeUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => { e.stopPropagation(); triggerHaptic([30]); }}
                            className={`flex h-10 w-10 items-center justify-center rounded-xl transition-all active:scale-90 border shadow-sm ${
                              darkMode 
                                ? 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800' 
                                : 'bg-white border-black/[0.06] text-neutral-700 hover:bg-neutral-50'
                            }`}
                            title="Navegar con Waze"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.2" stroke="currentColor" className="w-5 h-5">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
                            </svg>
                          </a>
                        )}

                        {/* WhatsApp */}
                        <a
                          href={`https://wa.me/52${deliv.data.customer.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Hola ${deliv.data.customer.name}, soy tu repartidor de SaDeL Express. Voy en camino con tu pedido.`)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => { e.stopPropagation(); triggerHaptic([30]); }}
                          className="flex h-10 w-10 items-center justify-center rounded-xl transition-all active:scale-90 border border-[#25D366]/20 bg-[#25D366]/10 text-[#25D366] hover:bg-[#25D366]/20 shadow-sm"
                          title="Enviar WhatsApp"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                            <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75 0 1.71.442 3.321 1.226 4.733L2.25 21.75l5.163-1.189A9.704 9.704 0 0012 21.75c5.385 0 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zM9.475 7.15c-.19-.425-.39-.434-.575-.441-.157-.006-.337-.006-.516-.006-.18 0-.472.067-.718.334-.247.268-.944.922-.944 2.247 0 1.325.966 2.607 1.1 2.785.135.178 1.9 2.9 4.6 4.066 2.245.968 2.705.776 3.199.73.493-.045 1.595-.651 1.82-1.28.224-.63.224-1.168.156-1.28-.067-.113-.247-.18-.517-.315-.27-.135-1.595-.788-1.843-.878-.246-.09-.426-.135-.606.135-.18.27-.697.878-.854 1.058-.157.18-.314.203-.584.068-.27-.135-1.138-.419-2.167-1.336-.799-.714-1.338-1.598-1.495-1.868-.157-.27-.017-.417.118-.551.121-.12.27-.315.405-.473.134-.157.179-.27.269-.45.09-.18.045-.337-.023-.472-.067-.135-.606-1.463-.83-2.003z" clipRule="evenodd" />
                          </svg>
                        </a>

                        {/* Llamar */}
                        <a
                          href={`tel:${deliv.data.customer.phone}`}
                          onClick={(e) => { e.stopPropagation(); triggerHaptic([30]); }}
                          className={`flex h-10 w-10 items-center justify-center rounded-xl transition-all active:scale-90 border shadow-sm ${
                            darkMode 
                              ? 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800' 
                              : 'bg-white border-black/[0.06] text-neutral-700 hover:bg-neutral-50'
                          }`}
                          title="Llamar"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                            <path fillRule="evenodd" d="M1.5 4.5a3 3 0 0 1 3-3h1.372c.86 0 1.61.586 1.819 1.42l1.105 4.423a1.875 1.875 0 0 1-.694 1.955l-1.293.97a15.216 15.216 0 0 0 5.58 5.58l.97-1.293a1.875 1.875 0 0 1 1.955-.694l4.423 1.105c.834.209 1.42.959 1.42 1.82V19.5a3 3 0 0 1-3 3h-2.25C8.552 22.5 1.5 15.448 1.5 6.75V4.5Z" clipRule="evenodd" />
                          </svg>
                        </a>

                        <div className="flex-1" />

                        {/* Acción Principal: Llegué o Entregar */}
                        {!deliv.arrived ? (
                          <button
                            type="button"
                            disabled={notifying}
                            onClick={(e) => { e.stopPropagation(); void handleLlegueForToken(deliv.token); }}
                            className={`flex items-center justify-center gap-1.5 rounded-2xl py-2.5 px-4 text-xs font-bold transition-all active:scale-95 active-scale disabled:opacity-50 border shadow-sm ${
                              darkMode 
                                ? 'bg-sky-400/10 text-sky-300 border-sky-400/20 hover:bg-sky-400/20' 
                                : 'bg-sky-50 text-sky-500 border-sky-200 hover:bg-sky-100'
                            }`}
                          >
                            {notifying ? (
                              <div className={`h-3.5 w-3.5 animate-spin rounded-full border-2 ${darkMode ? 'border-sky-300/40 border-t-sky-300' : 'border-sky-400/30 border-t-sky-500'}`} />
                            ) : (
                              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-4 h-4">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
                              </svg>
                            )}
                            <span>¡Ya llegué!</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleDeliverDirectly(deliv.token); }}
                            className="flex items-center justify-center gap-1.5 rounded-2xl py-2.5 px-5 text-xs font-black uppercase tracking-wider transition-all active:scale-[0.97] active-scale bg-sky-600 text-white hover:bg-sky-500 shadow-[0_4px_14px_0_rgba(14,165,233,0.3)]"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="3" stroke="currentColor" className="w-4 h-4">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75 6 6 9-13.5" />
                            </svg>
                            <span>Entregar</span>
                          </button>
                        )}

                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── COMPLETADOS (Historial Elegante) ── */}
          {completedList.length > 0 && (
            <div className="mt-8">
              <p className={`text-[10px] font-black uppercase tracking-widest mb-3 ${textTertiary}`}>
                Completados ({completedList.length})
              </p>
              <div className="space-y-2">
                {completedList.map(deliv => (
                  <button
                    key={deliv.token}
                    onClick={() => { triggerHaptic([30]); setSelectedToken(deliv.token); }}
                    className={`w-full text-left flex items-center justify-between rounded-2xl px-5 py-3.5 border transition active:scale-[0.98] active-scale ${cardBorder} ${
                      darkMode 
                        ? 'bg-zinc-900/30 hover:bg-zinc-900/60 text-zinc-400' 
                        : 'bg-white hover:bg-neutral-50/50 text-neutral-600'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        darkMode ? 'bg-emerald-950/40 text-emerald-400' : 'bg-emerald-50 text-emerald-600'
                      }`}>✓</span>
                      
                      <div className="min-w-0">
                        <span className={`text-xs font-extrabold block truncate ${darkMode ? 'text-zinc-300' : 'text-neutral-700'}`}>
                          {deliv.data.customer.name}
                        </span>
                        <span className={`text-[10px] font-medium block mt-0.5 ${textTertiary}`}>
                          Ref: {deliv.data.orderReference}
                        </span>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2.5 shrink-0">
                      <span className={`text-xs font-bold ${darkMode ? 'text-zinc-400' : 'text-neutral-500'}`}>
                        ${deliv.data.totalAmount.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                      </span>
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="3" stroke="currentColor" className={`w-3 h-3 ${
                        darkMode ? 'text-zinc-700' : 'text-neutral-300'
                      }`}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                      </svg>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>
    );
  }

  // ══════════════════════════════════════
  // VISTA: PEDIDO NO ENCONTRADO
  // ══════════════════════════════════════
  if (!currentTicket) {
    return (
      <div className={`flex min-h-[100dvh] flex-col items-center justify-center px-4 text-center ${bg}`}>
        <p className={`text-xs ${textSecondary}`}>No se encontró información del pedido.</p>
        <button 
          onClick={() => setSelectedToken(null)} 
          className="mt-4 px-4 py-2 bg-sky-400 text-white rounded-xl text-xs font-bold transition active:scale-95 active-scale"
        >
          Volver
        </button>
      </div>
    );
  }

  const addressObj = currentTicket.deliveryAddress;
  const addressText = `${addressObj.street} ${addressObj.number}, ${addressObj.neighborhood}, ${addressObj.city}`;
  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressText)}`;

  const isCash = currentTicket.paymentMethod === 'CASH';

  // Mapa estático de Google (una sola imagen, ~15KB)
  const staticMapUrl = addressObj.latitude && addressObj.longitude
    ? `https://maps.googleapis.com/maps/api/staticmap?center=${addressObj.latitude},${addressObj.longitude}&zoom=16&size=600x200&scale=2&maptype=roadmap&markers=color:red%7C${addressObj.latitude},${addressObj.longitude}&key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''}`
    : null;

  // ══════════════════════════════════════
  // VISTA: ENTREGA COMPLETADA
  // ══════════════════════════════════════
  if (currentDelivered) {
    return (
      <div className={`flex min-h-[100dvh] flex-col items-center justify-center px-6 text-center ${bg}`}>
        <div className={`flex h-16 w-16 items-center justify-center rounded-full ${darkMode ? 'bg-emerald-950/40 text-emerald-400' : 'bg-emerald-50 text-emerald-600'}`}>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="3" stroke="currentColor" className="w-8 h-8">
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
        </div>
        <h3 className={`mt-5 text-lg font-bold tracking-tight ${textPrimary}`}>¡Entrega completada!</h3>
        <p className={`mt-1.5 text-xs max-w-[260px] leading-relaxed ${textSecondary}`}>
          Pedido <strong className={textPrimary}>{currentTicket.orderReference}</strong> entregado a {currentTicket.customer.name}.
        </p>
        
        <div className={`mt-5 w-full max-w-[280px] rounded-xl border p-4 text-left ${cardBg} ${cardBorder}`}>
          <div className="flex justify-between text-xs py-1">
            <span className={textSecondary}>Cliente:</span>
            <span className={`font-semibold ${textPrimary}`}>{currentTicket.customer.name}</span>
          </div>
          <div className="flex justify-between text-xs py-1">
            <span className={textSecondary}>Pago:</span>
            <span className={`font-semibold ${textPrimary}`}>{isCash ? 'Efectivo (Cobrado)' : 'En línea'}</span>
          </div>
          <div className={`flex justify-between text-xs py-1 border-t mt-1 pt-1.5 ${divider}`}>
            <span className={textSecondary}>Total:</span>
            <span className={`font-bold ${textPrimary}`}>${currentTicket.totalAmount.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
          </div>
        </div>

        {/* Botones de contacto de emergencia post-entrega */}
        <div className="mt-3 flex gap-2.5 w-full max-w-[280px] justify-center">
          <a
            href={`https://wa.me/52${currentTicket.customer.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Hola ${currentTicket.customer.name}, soy tu repartidor de SaDeL Express.`)}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => triggerHaptic([30])}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-2xl bg-[#25D366]/10 text-[#25D366] hover:bg-[#25D366]/20 transition-all py-3 text-[11px] font-bold border border-[#25D366]/25 shadow-sm"
          >
            WhatsApp
          </a>
          <a
            href={`tel:${currentTicket.customer.phone}`}
            onClick={() => triggerHaptic([30])}
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-2xl transition-all py-3 text-[11px] font-bold border shadow-sm ${
              darkMode 
                ? 'bg-zinc-800/40 border-zinc-700 text-zinc-300 hover:bg-zinc-800' 
                : 'bg-white border-black/[0.06] text-neutral-700 hover:bg-neutral-50'
            }`}
          >
            Llamar
          </a>
        </div>

        <div className="mt-5 w-full max-w-[280px]">
          {activeCount > 0 ? (
            <button
              onClick={() => { triggerHaptic([40, 20]); setSelectedToken(null); }}
              className="w-full rounded-2xl bg-sky-400 py-3.5 text-xs font-bold text-white transition active:scale-95 active-scale shadow-[0_4px_14px_rgba(56,189,248,0.3)]"
            >
              Siguiente pedido ({activeCount} restantes)
            </button>
          ) : (
            <button
              onClick={() => { triggerHaptic([40, 20]); setSelectedToken(null); }}
              className={`w-full rounded-2xl border py-3.5 text-xs font-bold transition active:scale-95 active-scale shadow-sm ${
                darkMode ? 'border-zinc-800 text-zinc-300 hover:bg-zinc-800' : 'border-black/[0.06] text-neutral-700 hover:bg-neutral-50'
              }`}
            >
              Volver al tablero
            </button>
          )}
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════
  // VISTA 2: DETALLE DEL PEDIDO (ACCIÓN)
  // ══════════════════════════════════════
  return (
    <div className={`min-h-[100dvh] font-sans antialiased pb-12 transition-colors duration-300 ${bg} ${textPrimary}`}>
      
      {/* ── HEADER DE DETALLE PREMIUM ── */}
      <header className={`sticky top-0 z-50 border-b backdrop-blur-md transition-all duration-300 ${
        darkMode 
          ? 'bg-[#09090b]/90 border-zinc-800/60' 
          : 'bg-white/90 border-black/[0.04]'
      }`}>
        <div className="mx-auto flex max-w-lg items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { triggerHaptic([20]); setSelectedToken(null); }}
              className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-bold transition active:scale-95 active-scale border shadow-[0_2px_8px_rgba(0,0,0,0.02)] ${
                darkMode 
                  ? 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800' 
                  : 'bg-white border-black/[0.06] text-neutral-700 hover:bg-neutral-50'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="3" stroke="currentColor" className="w-3 h-3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
              <span>Volver</span>
            </button>
          </div>

          <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold shadow-[0_2px_8px_rgba(0,0,0,0.02)] ${
            darkMode ? 'bg-zinc-900 text-zinc-300 border border-zinc-800' : 'bg-neutral-900 text-white'
          }`}>
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
            </span>
            <span>En tránsito</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-4 pb-20">

        {/* ── CLIENTE + CONTACTO ── */}
        <div className={`mt-4 rounded-[28px] border p-5 shadow-[0_4px_24px_rgba(0,0,0,0.015)] ${cardBg} ${cardBorder}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className={`text-[10px] font-black uppercase tracking-widest ${darkMode ? 'text-sky-300' : 'text-sky-500'}`}>Entregar a</p>
              <h1 className={`text-xl font-black tracking-tight mt-1 truncate ${textPrimary}`}>{currentTicket.customer.name}</h1>
            </div>
            <div className="flex items-center gap-2.5 shrink-0">
              <a
                href={`https://wa.me/52${currentTicket.customer.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Hola ${currentTicket.customer.name}, soy tu repartidor de SaDeL Express. Voy en camino con tu pedido.`)}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => triggerHaptic([30])}
                className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#25D366] text-white hover:bg-[#128C7E] transition-all active:scale-90 shadow-[0_4px_14px_rgba(37,211,102,0.25)]"
                aria-label="WhatsApp al cliente"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                  <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75 0 1.71.442 3.321 1.226 4.733L2.25 21.75l5.163-1.189A9.704 9.704 0 0012 21.75c5.385 0 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zM9.475 7.15c-.19-.425-.39-.434-.575-.441-.157-.006-.337-.006-.516-.006-.18 0-.472.067-.718.334-.247.268-.944.922-.944 2.247 0 1.325.966 2.607 1.1 2.785.135.178 1.9 2.9 4.6 4.066 2.245.968 2.705.776 3.199.73.493-.045 1.595-.651 1.82-1.28.224-.63.224-1.168.156-1.28-.067-.113-.247-.18-.517-.315-.27-.135-1.595-.788-1.843-.878-.246-.09-.426-.135-.606.135-.18.27-.697.878-.854 1.058-.157.18-.314.203-.584.068-.27-.135-1.138-.419-2.167-1.336-.799-.714-1.338-1.598-1.495-1.868-.157-.27-.017-.417.118-.551.121-.12.27-.315.405-.473.134-.157.179-.27.269-.45.09-.18.045-.337-.023-.472-.067-.135-.606-1.463-.83-2.003z" clipRule="evenodd" />
                </svg>
              </a>
              <a
                href={`tel:${currentTicket.customer.phone}`}
                onClick={() => triggerHaptic([30])}
                className={`flex h-11 w-11 items-center justify-center rounded-xl transition-all active:scale-90 border shadow-sm ${
                  darkMode 
                    ? 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800' 
                    : 'bg-white border-black/[0.06] text-neutral-700 hover:bg-neutral-50'
                }`}
                aria-label="Llamar al cliente"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                  <path fillRule="evenodd" d="M1.5 4.5a3 3 0 0 1 3-3h1.372c.86 0 1.61.586 1.819 1.42l1.105 4.423a1.875 1.875 0 0 1-.694 1.955l-1.293.97a15.216 15.216 0 0 0 5.58 5.58l.97-1.293a1.875 1.875 0 0 1 1.955-.694l4.423 1.105c.834.209 1.42.959 1.42 1.82V19.5a3 3 0 0 1-3 3h-2.25C8.552 22.5 1.5 15.448 1.5 6.75V4.5Z" clipRule="evenodd" />
                </svg>
              </a>
            </div>
          </div>
        </div>

        {/* ── DIRECCIÓN ── */}
        <div className={`mt-3 rounded-[28px] border p-5 shadow-[0_4px_24px_rgba(0,0,0,0.015)] ${cardBg} ${cardBorder}`}>
          <div className="flex items-start gap-3.5">
            <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full shadow-sm ${
              darkMode ? 'bg-zinc-800 text-zinc-300' : 'bg-neutral-100 text-neutral-700'
            }`}>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-base font-extrabold leading-snug ${textPrimary}`}>{addressObj.street} {addressObj.number}</p>
              <p className={`text-xs mt-1 ${textSecondary}`}>{addressObj.neighborhood}, {addressObj.city}</p>
            </div>
          </div>

          {addressObj.reference && (
            <div className={`mt-4 rounded-2xl px-4 py-3 text-xs leading-relaxed flex gap-2.5 border ${
              darkMode 
                ? 'bg-zinc-900/40 border-zinc-800 text-zinc-300' 
                : 'bg-neutral-50 border-black/[0.03] text-neutral-600'
            }`}>
              <span className="text-sm shrink-0">📍</span>
              <span className="italic">{addressObj.reference}</span>
            </div>
          )}

          {/* Botones GPS y Waze */}
          <div className="mt-4 flex gap-2.5">
            <a
              href={googleMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => triggerHaptic([30])}
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-2xl border py-3 text-xs font-bold transition active:scale-95 active-scale shadow-sm ${
                darkMode 
                  ? 'bg-zinc-900 border-zinc-800 text-zinc-200 hover:bg-zinc-800' 
                  : 'bg-white border-black/[0.08] text-neutral-800 hover:bg-neutral-50'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75 3 9v11.25l6-2.25m0-11.25 6 2.25m-6-2.25V20.25m6-11.25 6-2.25V18l-6 2.25m0-11.25V20.25" />
              </svg>
              Google Maps
            </a>
            {addressObj.latitude && addressObj.longitude && (
              <a
                href={`https://waze.com/ul?ll=${addressObj.latitude},${addressObj.longitude}&navigate=yes`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => triggerHaptic([30])}
                className={`flex-1 flex items-center justify-center gap-1.5 rounded-2xl border py-3 text-xs font-bold transition active:scale-95 active-scale shadow-sm ${
                  darkMode 
                    ? 'bg-zinc-900 border-zinc-800 text-zinc-200 hover:bg-zinc-800' 
                    : 'bg-white border-black/[0.08] text-neutral-800 hover:bg-neutral-50'
                }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
                </svg>
                Waze
              </a>
            )}
          </div>
        </div>

        {/* ── MAPA ESTÁTICO ── */}
        {staticMapUrl && (
          <a
            href={googleMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`mt-3 block overflow-hidden rounded-[28px] border shadow-[0_4px_24px_rgba(0,0,0,0.015)] transition-transform hover:scale-[1.01] ${cardBorder}`}
          >
            <img
              src={staticMapUrl}
              alt={`Mapa de ${addressText}`}
              className="w-full h-[180px] object-cover"
              loading="lazy"
            />
          </a>
        )}

        {/* ── ALERTA DE PAGO ── */}
        <div className={`mt-3 rounded-[28px] border p-5 shadow-[0_4px_24px_rgba(0,0,0,0.015)] ${
          isCash
            ? darkMode ? 'bg-amber-950/20 border-amber-900/30' : 'bg-amber-50 border-amber-200/50'
            : darkMode ? 'bg-emerald-950/20 border-emerald-900/30' : 'bg-emerald-50 border-emerald-200/50'
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-[10px] font-black uppercase tracking-widest ${isCash ? (darkMode ? 'text-amber-400' : 'text-amber-700') : (darkMode ? 'text-emerald-400' : 'text-emerald-700')}`}>
                {isCash ? 'Cobrar en efectivo' : 'Pago confirmado'}
              </p>
              <p className={`text-2xl font-black tracking-tight mt-1 ${isCash ? (darkMode ? 'text-amber-300' : 'text-amber-950') : (darkMode ? 'text-emerald-300' : 'text-emerald-950')}`}>
                ${currentTicket.totalAmount.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
              </p>
            </div>
            <span className="text-3xl">{isCash ? '💵' : '💳'}</span>
          </div>
        </div>

        {/* ── BOTÓN LLEGUÉ ── */}
        <div className={`mt-3 rounded-[28px] border p-5 shadow-[0_4px_24px_rgba(0,0,0,0.015)] ${cardBg} ${cardBorder}`}>
          {llegueError && (
            <div className={`rounded-xl px-4 py-3 mb-3 text-xs font-semibold flex items-center gap-2 border ${
              darkMode ? 'bg-red-950/20 border-red-900/30 text-red-400' : 'bg-red-50 border-red-200/50 text-red-600'
            }`}>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-4 h-4 shrink-0">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
              <span>{llegueError}</span>
            </div>
          )}

          {currentArrived ? (
            <div className={`flex items-center gap-2 justify-center py-2.5 text-xs font-black uppercase tracking-wider ${
              darkMode ? 'text-emerald-400' : 'text-emerald-700'
            }`}>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="3" stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
              <span>Llegada notificada</span>
            </div>
          ) : (
            <button
              type="button"
              disabled={notifying}
              onClick={handleLlegue}
              className={`w-full flex items-center justify-center gap-2 rounded-2xl py-3.5 text-xs font-bold transition-all active:scale-95 active-scale disabled:opacity-50 border shadow-sm ${
                darkMode 
                  ? 'bg-sky-400/10 text-sky-300 border border-sky-400/20 hover:bg-sky-400/20' 
                  : 'bg-sky-50 text-sky-500 border border-sky-200 hover:bg-sky-100'
              }`}
            >
              {notifying ? (
                <>
                  <div className={`h-4 w-4 animate-spin rounded-full border-2 ${darkMode ? 'border-sky-300/40 border-t-sky-300' : 'border-sky-400/30 border-t-sky-500'}`} />
                  <span>Notificando llegada…</span>
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
                  </svg>
                  <span>Notificar: ¡Ya llegué!</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* ── CONFIRMAR ENTREGA + PIN ── */}
        <div className={`mt-3 rounded-[28px] border p-5 shadow-[0_4px_24px_rgba(0,0,0,0.015)] ${cardBg} ${cardBorder}`}>
          <form onSubmit={handleDeliver} className="space-y-4">
            {!isCash && currentTicket.handoverPin && (
              <div>
                <label htmlFor="pin-input" className={`block text-[10px] font-black uppercase tracking-widest mb-2 ${textTertiary}`}>
                  PIN de Seguridad (4 dígitos)
                </label>
                <input
                  id="pin-input"
                  type="tel"
                  maxLength={4}
                  value={pin}
                  onChange={(e) => {
                    const cleanValue = e.target.value.replace(/\D/g, '');
                    setPin(cleanValue);
                    if (cleanValue.length === 4) triggerHaptic([20]);
                  }}
                  placeholder="• • • •"
                  className={`w-full rounded-2xl border px-4 py-3.5 text-center text-2xl font-black tracking-[0.6em] focus:outline-none focus:ring-2 focus:ring-sky-400/50 transition-all ${
                    darkMode
                      ? 'border-zinc-800 bg-[#0a0a0a] text-white placeholder:text-zinc-800'
                      : 'border-neutral-200 bg-neutral-50 text-neutral-900 placeholder:text-neutral-300'
                  }`}
                />
                <p className={`text-[10px] mt-2 text-center leading-relaxed ${textTertiary}`}>
                  Pídele el PIN de 4 dígitos al cliente para validar la entrega.
                </p>
              </div>
            )}

            {error && (
              <div className={`rounded-xl px-4 py-3 text-xs font-semibold text-center flex items-center justify-center gap-2 border ${
                darkMode ? 'bg-red-950/20 border-red-900/30 text-red-400' : 'bg-red-50 border-red-200/50 text-red-600'
              }`}>
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-4 h-4 shrink-0">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || (!isCash && !!currentTicket.handoverPin && pin.length !== 4)}
              className="relative w-full flex items-center justify-center gap-2.5 rounded-2xl py-4 transition-all active:scale-[0.97] active-scale disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_4px_14px_0_rgba(14,165,233,0.39)] hover:shadow-[0_6px_20px_rgba(14,165,233,0.23)] hover:bg-sky-500 bg-sky-600 text-white"
            >
              {submitting ? (
                <>
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  <span className="text-sm font-black uppercase tracking-wider">Confirmando…</span>
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="3" stroke="currentColor" className="w-5 h-5 drop-shadow-sm">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                  </svg>
                  <span className="text-sm font-black uppercase tracking-wider drop-shadow-sm">Confirmar Entrega</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* ── SOPORTE / RESTAURANTE ── */}
        <div className={`mt-3 rounded-[28px] border p-5 flex items-center justify-between gap-3 shadow-[0_4px_24px_rgba(0,0,0,0.015)] ${cardBg} ${cardBorder}`}>
          <div className="min-w-0">
            <p className={`text-[10px] font-black uppercase tracking-widest ${textTertiary}`}>{currentTicket.restaurant.businessType && currentTicket.restaurant.businessType !== 'RESTAURANT' ? 'Tienda' : 'Restaurante'}</p>
            <p className={`text-sm font-bold truncate mt-1 ${textPrimary}`}>{currentTicket.restaurant.name}</p>
            <p className={`text-[10px] mt-0.5 ${textTertiary}`}>Folio: {currentTicket.orderReference}</p>
          </div>
          <a
            href={`tel:${currentTicket.restaurant.phone}`}
            onClick={() => triggerHaptic([30])}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-all active:scale-90 border shadow-sm ${
              darkMode 
                ? 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800' 
                : 'bg-white border-black/[0.06] text-neutral-700 hover:bg-neutral-50'
            }`}
            aria-label={`Llamar ${currentTicket.restaurant.businessType && currentTicket.restaurant.businessType !== 'RESTAURANT' ? 'a la tienda' : 'al restaurante'}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path fillRule="evenodd" d="M1.5 4.5a3 3 0 0 1 3-3h1.372c.86 0 1.61.586 1.819 1.42l1.105 4.423a1.875 1.875 0 0 1-.694 1.955l-1.293.97a15.216 15.216 0 0 0 5.58 5.58l.97-1.293a1.875 1.875 0 0 1 1.955-.694l4.423 1.105c.834.209 1.42.959 1.42 1.82V19.5a3 3 0 0 1-3 3h-2.25C8.552 22.5 1.5 15.448 1.5 6.75V4.5Z" clipRule="evenodd" />
            </svg>
          </a>
        </div>
        
        {/* ── MODAL CONFIRMACIÓN DE ENTREGA / COBRO ── */}
        {showConfirmModal && (
          <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4">
            <style dangerouslySetInnerHTML={{ __html: `
              @keyframes modalFadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
              }
              @keyframes modalScaleUp {
                from { transform: scale(0.96); opacity: 0; }
                to { transform: scale(1); opacity: 1; }
              }
              .animate-modal-fade-in {
                animation: modalFadeIn 0.2s ease-out forwards;
              }
              .animate-modal-scale-up {
                animation: modalScaleUp 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
              }
            `}} />

            {/* Backdrop */}
            <div 
              className="absolute inset-0 bg-black/45 backdrop-blur-[2px] animate-modal-fade-in"
              onClick={() => { 
                triggerHaptic([10]); 
                setShowConfirmModal(false); 
                if (modalOpenedFromDashboard) {
                  setSelectedToken(null);
                  setModalOpenedFromDashboard(false);
                }
              }}
            />
            
            {/* Modal Card */}
            <div 
              className={`relative w-full max-w-sm overflow-hidden rounded-[28px] border p-6 shadow-2xl animate-modal-scale-up ${cardBg} ${cardBorder}`}
            >
              <div className="text-center">
                <h3 className={`text-base font-extrabold tracking-tight ${textPrimary}`}>
                  {isCash ? 'Confirmación de Cobro' : 'Confirmar Entrega'}
                </h3>
                
                <p className={`mt-1.5 text-xs ${textSecondary}`}>
                  {isCash 
                    ? 'Valida que recibiste el efectivo antes de cerrar el pedido.'
                    : 'Confirma que entregaste físicamente el pedido al cliente.'
                  }
                </p>

                {/* Bloque de cobro integrado estilo alerta del reparto */}
                <div className={`mt-4 rounded-2xl border px-4 py-3.5 ${
                  isCash
                    ? (darkMode ? 'bg-amber-950/20 border-amber-900/30' : 'bg-amber-50 border-amber-200/50')
                    : (darkMode ? 'bg-emerald-950/20 border-emerald-900/30' : 'bg-emerald-50 border-emerald-200/50')
                }`}>
                  <p className={`text-[10px] font-bold uppercase tracking-wider ${
                    isCash 
                      ? (darkMode ? 'text-amber-400' : 'text-amber-700') 
                      : (darkMode ? 'text-emerald-400' : 'text-emerald-700')
                  }`}>
                    {isCash ? 'Cobrar el monto de' : 'Pedido ya pagado'}
                  </p>
                  <p className={`text-2xl font-extrabold tracking-tight mt-0.5 ${
                    isCash 
                      ? (darkMode ? 'text-amber-300' : 'text-amber-950') 
                      : (darkMode ? 'text-emerald-300' : 'text-emerald-950')
                  }`}>
                    ${currentTicket.totalAmount.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>

              <div className="mt-5 flex flex-col gap-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={executeDeliver}
                  className="relative w-full flex items-center justify-center gap-2.5 rounded-2xl py-4 text-xs font-black uppercase tracking-wider transition-all active:scale-[0.97] active-scale bg-sky-600 text-white hover:bg-sky-500 disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_4px_14px_0_rgba(14,165,233,0.3)]"
                >
                  {submitting ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      <span>Confirmando…</span>
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="3" stroke="currentColor" className="w-4 h-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75 6 6 9-13.5" />
                      </svg>
                      <span>{isCash ? 'Cobrado y entregado' : 'Confirmar Entrega'}</span>
                    </>
                  )}
                </button>
                
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => { 
                    triggerHaptic([10]); 
                    setShowConfirmModal(false); 
                    if (modalOpenedFromDashboard) {
                      setSelectedToken(null);
                      setModalOpenedFromDashboard(false);
                    }
                  }}
                  className={`w-full rounded-2xl border py-3.5 text-xs font-bold transition active:scale-[0.97] active-scale ${
                    darkMode 
                      ? 'border-zinc-800 text-zinc-300 bg-zinc-900/40 hover:bg-zinc-800' 
                      : 'border-neutral-200 text-neutral-600 bg-neutral-50 hover:bg-neutral-100'
                  }`}
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
