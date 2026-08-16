'use client';

import React, { useState } from 'react';
import { requestJson } from '@sadel/shared';

export type ScheduleProposalOrder = {
  id: string;
  orderReference: string;
  dailyCounter?: number;
  status: string;
  totalAmount: number;
  scheduledDeliveryAt?: string | null;
  items?: Array<{ quantity: number }>;
  restaurant: {
    id: string;
    name: string;
  };
};

type Props = {
  order: ScheduleProposalOrder;
  apiBase: string;
  token: string;
  formatCurrency: (amount: number) => string;
  onClose: () => void;
  onAccepted?: () => void;
  onRejected?: () => void;
  showNotice: (notice: {
    key: string;
    title: string;
    description: string;
    tone: 'success' | 'danger' | 'info';
    requiresAcknowledgement?: boolean;
    dismissible?: boolean;
    orderId?: string;
    paymentMethod?: string;
    orderReference?: string;
  }) => void;
};

export function ScheduleProposalModal({ order, apiBase, token, formatCurrency, onClose, onAccepted, onRejected, showNotice }: Props) {
  const [loading, setLoading] = useState(false);

  const scheduledAt = order.scheduledDeliveryAt
    ? new Date(order.scheduledDeliveryAt)
    : null;

  const formatLongDate = (d: Date) =>
    d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });

  const formatTime = (d: Date) =>
    d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

  const handleAccept = async () => {
    setLoading(true);
    try {
      const res = await requestJson<{ success: boolean; data?: { message: string } }>({
        apiBase,
        path: `/pedidos/${order.id}/confirmar-programacion`,
        options: { method: 'POST' },
        token,
      });
      if (res.success) {
        onClose();
        showNotice({
          key: `schedule-confirmed-${order.id}`,
          title: '¡Fecha confirmada! ✅',
          description: scheduledAt
            ? `Tu pedido llegará el ${formatLongDate(scheduledAt)} a las ${formatTime(scheduledAt)}.`
            : 'Tu fecha de entrega ha sido confirmada.',
          tone: 'success',
        });
        onAccepted?.();
      }
    } catch (e) {
      showNotice({
        key: `schedule-error-${order.id}`,
        title: 'Error',
        description: 'Ocurrió un error al confirmar la fecha. Intenta de nuevo.',
        tone: 'danger',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    if (!window.confirm('¿Estás seguro? Si cancelas, el pedido se cancelará y no podrás recuperarlo.')) return;
    setLoading(true);
    try {
      const res = await requestJson<{ success: boolean; data?: { message: string } }>({
        apiBase,
        path: `/pedidos/${order.id}/rechazar-programacion`,
        options: { method: 'POST' },
        token,
      });
      if (res.success) {
        onClose();
        showNotice({
          key: `schedule-rejected-${order.id}`,
          title: 'Pedido cancelado ❌',
          description: 'Cancelaste el pedido porque no aceptaste la fecha de entrega programada.',
          tone: 'danger',
        });
        onRejected?.();
      }
    } catch (e) {
      showNotice({
        key: `schedule-reject-error-${order.id}`,
        title: 'Error',
        description: 'Ocurrió un error. Intenta de nuevo.',
        tone: 'danger',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4 py-6">
      <div className="bg-white rounded-3xl border border-black/[0.03] shadow-[0_40px_120px_rgba(0,0,0,0.35)] p-7 w-full max-w-md h-fit max-h-[90vh] overflow-y-auto relative">
        <div className="text-center mb-6">
          <div className="w-20 h-20 bg-sky-100 rounded-full flex items-center justify-center mx-auto mb-4 ring-8 ring-sky-50">
            <span className="text-4xl">📅</span>
          </div>
          <h3 className="text-2xl font-black text-neutral-950 tracking-tight">Fecha de entrega programada</h3>
          <p className="text-sm text-neutral-500 mt-2 leading-relaxed">
            <strong className="text-neutral-800">{order.restaurant.name}</strong> propuso entregar tu pedido en la siguiente fecha:
          </p>
        </div>

        {scheduledAt && (
          <div className="bg-gradient-to-br from-sky-50 to-blue-50 rounded-2xl border border-sky-100 p-5 mb-6 text-center shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-600 mb-2">Fecha programada</p>
            <p className="text-2xl font-black text-neutral-950">{formatLongDate(scheduledAt)}</p>
            <div className="mt-2 inline-flex items-center gap-2 bg-white rounded-full px-4 py-1.5 border border-sky-200 shadow-sm">
              <svg className="w-4 h-4 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="8" strokeWidth={2} />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 7v5l3 3" />
              </svg>
              <span className="text-sm font-bold text-sky-700">{formatTime(scheduledAt)}</span>
            </div>
          </div>
        )}

        <div className="text-center mb-6">
          <p className="text-xs font-medium text-neutral-400">
            Pedido #{order.orderReference?.slice(-6) || order.dailyCounter || ''}
          </p>
          <p className="text-xs font-medium text-neutral-400 mt-0.5">
            {order.items?.length || 0} producto{(order.items?.length || 0) !== 1 ? 's' : ''} · {formatCurrency(order.totalAmount)}
          </p>
        </div>

        <div className="space-y-3">
          <button
            type="button"
            onClick={handleAccept}
            disabled={loading}
            className="w-full rounded-full bg-sky-600 px-5 py-4 text-sm font-bold text-white shadow-[0_4px_12px_rgba(2,132,199,0.3)] transition hover:bg-sky-700 hover:shadow-[0_8px_20px_rgba(2,132,199,0.4)] disabled:opacity-70 disabled:cursor-not-allowed active:scale-[0.98]"
          >
            {loading ? 'Confirmando...' : '✅ Aceptar fecha'}
          </button>
          <button
            type="button"
            onClick={handleReject}
            disabled={loading}
            className="w-full rounded-full border border-rose-200 bg-white px-5 py-4 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.98]"
          >
            ❌ Cancelar pedido
          </button>
        </div>
      </div>
    </div>
  );
}