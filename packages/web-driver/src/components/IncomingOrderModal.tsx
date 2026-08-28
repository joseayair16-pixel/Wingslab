import React, { useEffect, useState } from 'react';
import { Banknote } from 'lucide-react';

interface IncomingOrderModalProps {
  order: any;
  driverLat?: number | null;
  driverLng?: number | null;
  onAccept: (orderId: string) => void;
  onReject: (orderId: string) => void;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function getDistanceInKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // Radio de la tierra en km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function IncomingOrderModal({
  order,
  driverLat,
  driverLng,
  onAccept,
  onReject,
}: IncomingOrderModalProps) {
  const [localMountTime] = useState(Date.now());
  const [timeLeftMs, setTimeLeftMs] = useState(120000);
  const totalTimeMs = 120000;

  useEffect(() => {
    // Calcular tiempo restante basado en driverAssignedAt o el momento de montaje local
    const calculateTimeLeft = () => {
      const assignedAt = order.driverAssignedAt ? new Date(order.driverAssignedAt).getTime() : localMountTime;
      const now = Date.now();
      const elapsed = now - assignedAt;
      const remaining = Math.max(0, totalTimeMs - elapsed);
      setTimeLeftMs(remaining);

      if (remaining <= 0) {
        onReject(order.id);
      }
    };

    calculateTimeLeft();
    const interval = setInterval(calculateTimeLeft, 100);

    return () => clearInterval(interval);
  }, [order.id, order.driverAssignedAt, onReject, localMountTime]);

  const handleAccept = () => {
    onAccept(order.id);
  };

  const handleReject = () => {
    onReject(order.id);
  };

  const restLat = order.restaurant?.latitude;
  const restLng = order.restaurant?.longitude;
  const custLat = order.latitude;
  const custLng = order.longitude;

  let totalDistance = 0;
  if (restLat && restLng && custLat && custLng) {
    const distRestToCust = getDistanceInKm(restLat, restLng, custLat, custLng);
    totalDistance += distRestToCust;

    if (driverLat && driverLng) {
      const distDriverToRest = getDistanceInKm(driverLat, driverLng, restLat, restLng);
      totalDistance += distDriverToRest;
    }
  }

  const progressPercentage = (timeLeftMs / totalTimeMs) * 100;
  const isCash = order.paymentMethod === 'CASH';
  // En efectivo, el repartidor le paga a la tienda (total - costo de envío)
  // y luego le cobra al cliente el total completo.
  const payToStoreAmount = isCash ? (order.totalAmount || 0) - (order.deliveryFee || 0) : 0;

  return (
    <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4 pb-8">
      <div className="relative w-full max-w-sm rounded-[32px] bg-surface shadow-2xl overflow-hidden dark:bg-zinc-950 animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-300">
        
        {/* Header estético (sin botón gigante, solo texto) */}
        <div className="flex items-center justify-center p-4 pb-2">
          <span className="text-xs font-bold uppercase tracking-widest text-muted dark:text-zinc-600">
            Nueva Solicitud de Viaje
          </span>
        </div>

        {/* Info principal (Ganancia) */}
        <div className="px-6 text-center mt-2">
          <p className="text-[40px] font-black text-foreground dark:text-white tracking-tighter leading-none">
            {formatCurrency(order.deliveryFee || 0)}
          </p>
          <p className="text-xs font-bold uppercase tracking-wider text-muted dark:text-zinc-500 mt-2">
            Ganancia estimada
          </p>
        </div>

        {/* Detalles del pedido */}
        <div className="px-6 mt-8 space-y-5">
          <div className="flex items-start gap-4">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 dark:bg-zinc-900">
              <div className="h-2.5 w-2.5 rounded-full bg-neutral-800 dark:bg-zinc-200" />
            </div>
            <div>
              <p className="text-lg font-black text-foreground dark:text-zinc-50 leading-tight">
                {order.restaurant?.name || 'Restaurante'}
              </p>
              <p className="text-sm font-semibold text-muted dark:text-zinc-400 mt-0.5">
                {totalDistance > 0 ? `${totalDistance.toFixed(1)} km (Distancia total)` : 'Calculando ruta...'}
              </p>
            </div>
          </div>

          {isCash && (
            <div className="mt-4 flex items-center justify-between rounded-2xl bg-surface-2 px-5 py-4 dark:bg-zinc-900">
              <div className="flex items-center gap-3">
                <span className="text-xl"><Banknote className="h-5 w-5" /></span>
                <span className="text-sm font-bold text-foreground dark:text-neutral-300">Pagar a tienda:</span>
              </div>
              <span className="text-lg font-black text-foreground dark:text-white">{formatCurrency(payToStoreAmount)}</span>
            </div>
          )}
        </div>

        {/* Botones de Acción (Verticales) */}
        <div className="px-6 mt-8 mb-4 flex flex-col gap-3">
          <button
            onClick={handleAccept}
            className="relative w-full overflow-hidden rounded-2xl h-[56px] bg-surface-2 dark:bg-zinc-800 text-center transition active:scale-[0.98]"
          >
            {/* Barra de progreso de tiempo como fondo del botón */}
            <div 
              className="absolute inset-y-0 left-0 bg-sky-500 transition-all duration-100 ease-linear"
              style={{ width: `${progressPercentage}%` }}
            />
            <span className="relative z-10 text-[14px] font-black uppercase tracking-[0.15em] text-white drop-shadow-md flex h-full items-center justify-center">
              Aceptar Pedido
            </span>
          </button>
          
          <button
            onClick={handleReject}
            className="w-full h-[56px] flex items-center justify-center rounded-2xl border-2 border-rose-100/50 bg-rose-50/50 text-[14px] font-bold uppercase tracking-[0.15em] text-rose-500 transition active:scale-[0.98] dark:border-rose-900/30 dark:bg-rose-950/20 dark:text-rose-400 hover:bg-rose-100/50 dark:hover:bg-rose-950/40"
          >
            Rechazar
          </button>
        </div>
        
        <p className="text-center mb-6 text-[11px] font-bold uppercase tracking-widest text-muted">
          {Math.ceil(timeLeftMs / 1000)}s restantes
        </p>
      </div>
    </div>
  );
}
