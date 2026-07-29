'use client';

import React from 'react';

interface BillingSectionProps {
  billingSummary: any;
  profile: any;
  getCycleProgress: () => number;
  formatTimeLeft: (diffMs: number) => string;
  getSecondsUntilNextCutoff: () => number;
  getSecondsUntilNextSuspension: () => number;
  formatSettlementReference: (ref: string) => string;
  setSelectedSettlementForDetails: (settlement: any) => void;
  setIsDetailsModalOpen: (open: boolean) => void;
  fetchSettlementOrders: (settlementId: string) => void;
  setSelectedSettlementForPay: (settlement: any) => void;
  setIsPayModalOpen: (open: boolean) => void;
  setIsCurrentPeriodDetailsOpen: (open: boolean) => void;
  fetchCurrentPeriodOrders: () => void;
  getDaysOverdue: (dueDateStr?: string | Date) => number;
}

export const BillingSection = React.memo(function BillingSection({
  billingSummary,
  profile,
  getCycleProgress,
  formatTimeLeft,
  getSecondsUntilNextCutoff,
  getSecondsUntilNextSuspension,
  formatSettlementReference,
  setSelectedSettlementForDetails,
  setIsDetailsModalOpen,
  fetchSettlementOrders,
  setSelectedSettlementForPay,
  setIsPayModalOpen,
  setIsCurrentPeriodDetailsOpen,
  fetchCurrentPeriodOrders,
  getDaysOverdue,
}: BillingSectionProps) {
  return (
    <div className="space-y-6">
      {/* Header Premium de Facturación */}
      <div className="relative overflow-hidden rounded-[36px] border border-black/5 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.98),rgba(249,247,243,0.95)_48%,rgba(243,238,229,0.93)_100%)] p-6 shadow-[0_24px_90px_rgba(15,15,15,0.06)] backdrop-blur md:p-8">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-[-4%] top-[-12%] h-48 w-48 rounded-full bg-amber-200/20 blur-3xl"></div>
          <div className="absolute right-[-5%] top-[8%] h-52 w-52 rounded-full bg-sky-200/20 blur-3xl"></div>
        </div>

        <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-neutral-400">Facturación & Control</p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-[-0.05em] text-neutral-950 md:text-4xl">Balance de Cuenta</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-neutral-500">
              Gestiona tus periodos de facturación, consulta comisiones recaudadas y liquida tus saldos pendientes.
            </p>

            {/* Live Status Badge */}
            {(() => {
              const overdueCount = billingSummary?.recentSettlements?.filter((s: any) => s.status === 'OVERDUE').length ?? 0;
              const pendingCount = billingSummary?.recentSettlements?.filter((s: any) => s.status === 'PENDING').length ?? 0;
              const inReviewCount = billingSummary?.recentSettlements?.filter((s: any) => s.status === 'IN_REVIEW').length ?? 0;

              let accountStatusBadge = {
                label: 'AL DÍA',
                icon: '✅',
                desc: 'Tu cuenta no tiene deudas pendientes de pago.',
                classes: 'bg-emerald-500/10 text-emerald-800 border-emerald-500/20'
              };

              if (overdueCount > 0 || (profile?.status === 'SUSPENDED' && profile?.statusReason?.includes('Suspensión automática por pago vencido'))) {
                accountStatusBadge = {
                  label: 'SUSPENDIDO POR IMPAGO',
                  icon: '🔴',
                  desc: 'Tu negocio está suspendido por falta de pago del corte vencido.',
                  classes: 'bg-rose-500/10 text-rose-800 border-rose-500/20 animate-pulse'
                };
              } else if (pendingCount > 0) {
                accountStatusBadge = {
                  label: 'CORTE PENDIENTE',
                  icon: '⏳',
                  desc: 'Tienes un corte de caja pendiente de pago.',
                  classes: 'bg-amber-500/10 text-amber-800 border-amber-500/20 animate-pulse'
                };
              } else if (inReviewCount > 0) {
                accountStatusBadge = {
                  label: 'EN REVISIÓN',
                  icon: '🔍',
                  desc: 'Comprobante enviado. En proceso de verificación.',
                  classes: 'bg-blue-500/10 text-blue-800 border-blue-500/20'
                };
              }

              return (
                <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3">
                  <span className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-bold ${accountStatusBadge.classes}`}>
                    <span className="text-sm leading-none">{accountStatusBadge.icon}</span>
                    {accountStatusBadge.label}
                  </span>
                  <span className="text-xs text-neutral-500 font-medium">
                    {accountStatusBadge.desc}
                  </span>
                </div>
              );
            })()}
          </div>

          {/* Ring Chart & Cut-off Countdown */}
          <div className="flex flex-wrap items-center gap-6 rounded-[28px] border border-black/5 bg-white/70 p-5 shadow-sm backdrop-blur">
            {/* Circle progress */}
            <div className="relative flex items-center justify-center">
              {(() => {
                const progress = getCycleProgress();
                const radius = 28;
                const circ = 2 * Math.PI * radius;
                const strokeOffset = circ - (progress / 100) * circ;
                return (
                  <>
                    <svg className="w-16 h-16 transform -rotate-90">
                      <circle cx="32" cy="32" r={radius} className="text-neutral-100" strokeWidth="4" stroke="currentColor" fill="transparent" />
                      <circle cx="32" cy="32" r={radius} className="text-sky-600 transition-all duration-500 ease-out" strokeWidth="4" strokeDasharray={circ} strokeDashoffset={strokeOffset} strokeLinecap="round" stroke="currentColor" fill="transparent" />
                    </svg>
                    <div className="absolute flex flex-col items-center justify-center">
                      <span className="text-xs font-bold text-neutral-900">{progress}%</span>
                    </div>
                  </>
                );
              })()}
            </div>

            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Ciclo Semanal</p>
              <p className="text-sm font-semibold text-neutral-800 mt-0.5">Progreso de Periodo</p>

              {/* Live Countdown */}
              <div className="flex items-center gap-1.5 mt-1.5 text-xs text-sky-700 bg-sky-50/50 border border-sky-100/50 rounded-xl px-2.5 py-1 font-bold">
                <span>⏱️</span>
                <span>
                  {(() => {
                    const hasOverdueOrPending = (billingSummary?.recentSettlements?.filter((s: any) => ['PENDING', 'OVERDUE'].includes(s.status)).length ?? 0) > 0;
                    if (hasOverdueOrPending) {
                      return `Pagar antes de: ${formatTimeLeft(getSecondsUntilNextSuspension())}`;
                    }
                    return `Siguiente corte: ${formatTimeLeft(getSecondsUntilNextCutoff())}`;
                  })()}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Current Week Card */}
        <div className="relative overflow-hidden rounded-[32px] border border-black/5 bg-white p-6 shadow-[0_4px_24px_rgba(0,0,0,0.02)] transition hover:shadow-md md:p-8">
          <div className="absolute right-6 top-6 h-12 w-12 rounded-2xl bg-blue-50/50 border border-blue-100/20 flex items-center justify-center text-xl">
            💸
          </div>
          <h2 className="text-lg font-bold text-neutral-900">Periodo en Curso</h2>
          <p className="mt-1 text-sm text-neutral-500">Comisión acumulada de pedidos entregados esta semana</p>

          <div className="mt-8 flex items-baseline gap-2">
            <span className="text-5xl font-black tracking-tight text-neutral-950">${((billingSummary?.serviceFeeRevenue ?? 0) + (billingSummary?.platformFeeRevenue ?? 0)).toFixed(2)}</span>
            <span className="text-sm font-bold text-neutral-400 uppercase">MXN</span>
          </div>

          {(() => {
            const totalRevenue = billingSummary?.deliveredRevenue ?? 0;
            const platformFee = billingSummary?.platformFeeRevenue ?? 0;
            const platformFeePerOrder = billingSummary?.platformFeePerOrder ?? 0;
            if (totalRevenue <= 0 || platformFeePerOrder <= 0) return null;
            const percentage = totalRevenue > 0 ? ((platformFee / totalRevenue) * 100).toFixed(1) : '0.0';
            return (
              <div className="mt-4 space-y-1">
                <p className="text-xs font-semibold text-blue-700 bg-blue-50/60 border border-blue-100/40 rounded-xl px-3 py-2.5 w-fit flex items-center gap-2">
                  <span>📈</span>
                  <span>Comisión por uso de plataforma equivale al <strong>{percentage}%</strong> (${platformFee.toFixed(2)} MXN)</span>
                </p>
                <p className="text-[10px] text-neutral-400 pl-1 leading-relaxed mt-1">
                  * Tarifa cobrada al cliente que recaudas y transfieres al administrador.
                </p>
              </div>
            );
          })()}

          <div className="mt-6 grid gap-3 border-t border-black/5 pt-5">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <span className="text-neutral-500 font-medium">Tarifa de Servicio</span>
                <span className="text-[11px] font-semibold text-neutral-400 bg-neutral-100/80 rounded-md px-2 py-0.5">${(billingSummary?.serviceFee ?? 0).toFixed(2)} c/u</span>
              </div>
              <span className="font-semibold text-neutral-950 bg-neutral-50 border border-black/5 rounded-lg px-2.5 py-1">
                ${(billingSummary?.serviceFeeRevenue ?? 0).toFixed(2)} MXN
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <span className="text-neutral-500 font-medium">Uso de la Plataforma</span>
                <span className="text-[11px] font-semibold text-neutral-400 bg-neutral-100/80 rounded-md px-2 py-0.5">${(billingSummary?.platformFeePerOrder ?? 0).toFixed(2)} c/u</span>
              </div>
              <span className="font-semibold text-neutral-950 bg-neutral-50 border border-black/5 rounded-lg px-2.5 py-1">
                ${(billingSummary?.platformFeeRevenue ?? 0).toFixed(2)} MXN
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-neutral-400 pt-1 border-t border-black/5">
              <span>{billingSummary?.deliveredOrders ?? 0} pedido{(billingSummary?.deliveredOrders ?? 0) !== 1 ? 's' : ''} en este período</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-neutral-500 font-medium">Próximo Corte de Caja</span>
              <span className="font-bold text-sky-700 bg-sky-50/50 border border-sky-100/20 rounded-lg px-2.5 py-1">
                {billingSummary?.nextChargeDate
                  ? new Date(billingSummary.nextChargeDate).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })
                  : '--'}
              </span>
            </div>

            <button
              type="button"
              onClick={() => {
                setIsCurrentPeriodDetailsOpen(true);
                fetchCurrentPeriodOrders();
              }}
              className="w-full mt-4 flex items-center justify-center gap-2 rounded-2xl border border-sky-100 bg-gradient-to-r from-sky-50 to-sky-100/40 hover:from-sky-100/80 hover:to-sky-100 px-4 py-3 text-xs font-bold text-sky-700 transition active:scale-[0.98] shadow-sm hover:shadow"
            >
              <svg className="w-4 h-4 text-sky-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
              Ver desglose del acumulado
            </button>
          </div>
        </div>

        {/* Instruction Card */}
        <div className="rounded-[32px] border border-black/5 bg-gradient-to-br from-neutral-50 to-neutral-100/40 p-6 md:p-8 flex flex-col justify-between">
          <div>
            <h2 className="text-lg font-bold text-neutral-900">¿Cómo liquidar tu saldo?</h2>
            <p className="mt-1 text-sm text-neutral-500">Pasos e instrucciones para realizar el pago</p>

            <div className="mt-6 space-y-4">
              <div className="flex gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-600/10 text-xs font-bold text-sky-700">1</div>
                <p className="text-sm text-neutral-600 leading-relaxed">
                  Los cortes de caja se generan automáticamente los domingos a las <span className="font-semibold text-neutral-800">23:59 PM</span>.
                </p>
              </div>
              <div className="flex gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-600/10 text-xs font-bold text-sky-700">2</div>
                <p className="text-sm text-neutral-600 leading-relaxed">
                  Tienes de plazo límite hasta el miércoles siguiente a las <span className="font-semibold text-neutral-800">23:59 PM</span> para realizar la transferencia.
                </p>
              </div>
              <div className="flex gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-600/10 text-xs font-bold text-sky-700">3</div>
                <p className="text-sm text-neutral-600 leading-relaxed">
                  Realiza la transferencia bancaria con los datos del administrador, sube tu comprobante de pago en formato de imagen y espera la aprobación.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-8 rounded-2xl border border-amber-200/60 bg-amber-50/60 p-4 flex gap-3 items-start">
            <span className="text-lg flex-shrink-0">⚠️</span>
            <div>
              <p className="text-xs font-bold text-amber-900">Suspensión Automática</p>
              <p className="text-xs text-amber-800/90 mt-0.5 leading-relaxed">
                Si tu pago no es reportado y confirmado antes de la fecha límite, la plataforma desactivará automáticamente tu restaurante.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* History Section */}
      <div className="rounded-[32px] border border-black/5 bg-white p-6 shadow-[0_4px_24px_rgba(0,0,0,0.01)] md:p-8">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h2 className="text-lg font-bold text-neutral-900">Historial de Cortes</h2>
            <p className="mt-1 text-sm text-neutral-500">Visualiza cortes anteriores, reporta pagos y descarga comprobantes</p>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          {billingSummary?.recentSettlements && billingSummary.recentSettlements.length > 0 ? (
            billingSummary.recentSettlements.map((settlement: any) => (
              <div
                key={settlement.id}
                className={`rounded-2xl border p-5 transition shadow-sm hover:shadow-md duration-200 ${settlement.status === 'PENDING'
                  ? 'border-amber-200 bg-gradient-to-r from-amber-50/40 via-amber-50/10 to-white shadow-[0_4px_20px_rgba(245,158,11,0.04)]'
                  : (settlement.status as string) === 'IN_REVIEW'
                    ? 'border-blue-200 bg-gradient-to-r from-blue-50/40 via-blue-50/10 to-white shadow-[0_4px_20px_rgba(99,102,241,0.04)]'
                    : settlement.status === 'OVERDUE'
                      ? 'border-rose-200 bg-gradient-to-r from-rose-50/40 via-rose-50/10 to-white shadow-[0_4px_20px_rgba(244,63,94,0.04)]'
                      : 'border-black/5 bg-gradient-to-r from-neutral-50/50 to-white hover:border-neutral-200'
                  }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-extrabold text-neutral-950 tracking-tight">{formatSettlementReference(settlement.reference)}</p>
                      {settlement.status === 'OVERDUE' && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 border border-rose-200 px-2.5 py-0.5 text-[10px] font-bold text-rose-800 uppercase animate-pulse">
                          🚨 Vencido
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-neutral-500 font-medium">
                      Periodo: {new Date(settlement.periodStart).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })} - {new Date(settlement.periodEnd).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  </div>

                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <p className="text-xl font-black text-neutral-950">${(settlement.amount ?? 0).toFixed(2)} MXN</p>
                      <p className="text-[10px] text-neutral-500 font-semibold mt-0.5">
                        Servicio: ${(settlement.serviceFeeTotal ?? 0).toFixed(2)} | Plataforma: ${(settlement.platformFeeTotal ?? 0).toFixed(2)}
                      </p>
                    </div>

                    <div className="min-w-[120px] text-right">
                      {settlement.status === 'PENDING' ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 border border-sky-200/40 px-3 py-1 text-xs font-bold text-sky-800 animate-pulse">
                          ⏱️ Pendiente
                        </span>
                      ) : (settlement.status as string) === 'IN_REVIEW' ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 border border-blue-200/40 px-3 py-1 text-xs font-bold text-blue-800">
                          🔍 En revisión
                        </span>
                      ) : settlement.status === 'OVERDUE' ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 border border-rose-200/40 px-3 py-1 text-xs font-bold text-rose-800 animate-pulse">
                          🚨 Vencido
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 border border-emerald-200/40 px-3 py-1 text-xs font-bold text-emerald-800">
                          ✅ Pagado
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Info/Warning dates */}
                {settlement.status === 'OVERDUE' && settlement.dueDate ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold text-rose-700 bg-rose-50/40 border border-rose-100/40 rounded-xl px-3 py-1.5 w-fit">
                    <span>🚨</span>
                    <span>Atraso: {getDaysOverdue(settlement.dueDate)} días (Venció el {new Date(settlement.dueDate).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })})</span>
                  </div>
                ) : settlement.status === 'PENDING' && settlement.dueDate ? (
                  <div className="mt-3 flex items-center gap-2 text-xs font-bold text-amber-700 bg-amber-50/40 border border-amber-100/40 rounded-xl px-3 py-1.5 w-fit">
                    <span>📅</span>
                    <span>Límite de pago: {new Date(settlement.dueDate).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                  </div>
                ) : null}

                {settlement.status === 'IN_REVIEW' && settlement.updatedAt && (
                  <div className="mt-3 flex items-center gap-2 text-xs font-bold text-blue-700 bg-blue-50/40 border border-blue-100/40 rounded-xl px-3 py-1.5 w-fit">
                    <span>📤</span>
                    <span>Pago reportado el {new Date(settlement.updatedAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                )}

                <div className="mt-4 flex gap-2 justify-end border-t border-black/5 pt-3">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedSettlementForDetails(settlement);
                      setIsDetailsModalOpen(true);
                      fetchSettlementOrders(settlement.id);
                    }}
                    className="rounded-xl border border-black/10 bg-white px-3.5 py-2 text-xs font-bold text-neutral-700 transition hover:bg-neutral-50 active:scale-95 shadow-sm"
                  >
                    Ver detalles
                  </button>

                  {settlement.paymentProofUrl && (
                    <a
                      href={settlement.paymentProofUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-xl border border-black/10 bg-white px-3.5 py-2 text-xs font-bold text-neutral-700 transition hover:bg-neutral-50 active:scale-95 shadow-sm inline-flex items-center gap-1.5"
                    >
                      🖼️ Ver comprobante
                    </a>
                  )}

                  {['PENDING', 'OVERDUE'].includes(settlement.status) && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSettlementForPay(settlement);
                        setIsPayModalOpen(true);
                      }}
                      className="rounded-xl bg-neutral-950 px-4 py-2 text-xs font-bold text-white transition hover:bg-neutral-800 active:scale-95 shadow-sm hover:shadow"
                    >
                      Pagar Corte
                    </button>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-12 rounded-[28px] border border-dashed border-black/10 bg-neutral-50/50 text-neutral-500">
              <span className="text-3xl block mb-2">📊</span>
              <p className="font-semibold text-neutral-700">No tienes cortes registrados aún</p>
              <p className="text-xs mt-1">Cuando finalice tu primer ciclo de ventas aparecerán aquí tus cortes de caja.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
