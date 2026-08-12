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

const money = (value: number | undefined) => `$${(value ?? 0).toFixed(2)}`;

const platformRateLabel = (platformFeeRate: number, platformFeePerOrder: number) => {
  if (platformFeeRate > 0) {
    const pct = platformFeeRate * 100;
    return `${pct.toFixed(pct % 1 === 0 ? 0 : 1)}% del subtotal`;
  }
  return `${money(platformFeePerOrder)} c/u`;
};

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
  const overdueCount = billingSummary?.recentSettlements?.filter((s: any) => s.status === 'OVERDUE').length ?? 0;
  const pendingCount = billingSummary?.recentSettlements?.filter((s: any) => s.status === 'PENDING').length ?? 0;
  const inReviewCount = billingSummary?.recentSettlements?.filter((s: any) => s.status === 'IN_REVIEW').length ?? 0;

  const statusBadge =
    overdueCount > 0 || (profile?.status === 'SUSPENDED' && profile?.statusReason?.includes('Suspensión automática por pago vencido'))
      ? { label: 'SUSPENDIDO POR IMPAGO', icon: '🔴', desc: 'Cuenta suspendida por corte vencido.', cls: 'bg-rose-500/10 text-rose-700 border-rose-500/20 animate-pulse' }
      : pendingCount > 0
        ? { label: 'CORTE PENDIENTE', icon: '⏳', desc: 'Tienes un corte de caja pendiente de pago.', cls: 'bg-amber-500/10 text-amber-700 border-amber-500/20 animate-pulse' }
        : inReviewCount > 0
          ? { label: 'EN REVISIÓN', icon: '🔍', desc: 'Comprobante enviado, en verificación.', cls: 'bg-sky-500/10 text-sky-700 border-sky-500/20' }
          : { label: 'AL DÍA', icon: '✅', desc: 'Sin deudas pendientes de pago.', cls: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20' };

  const hasPendingOrOverdue = pendingCount > 0 || overdueCount > 0;
  const periodTotal = (billingSummary?.serviceFeeRevenue ?? 0) + (billingSummary?.platformFeeRevenue ?? 0) + (billingSummary?.whatsappFeeRevenue ?? 0);
  const platformFeeRate = billingSummary?.platformFeeRate ?? 0;
  const platformFeePerOrder = billingSummary?.platformFeePerOrder ?? 0;
  const platformFeeRevenue = billingSummary?.platformFeeRevenue ?? 0;
  const showFeeConfig = platformFeeRate > 0 || platformFeePerOrder > 0;

  const totalsPerStatus = (s: any) => {
    const parts = [];
    parts.push(`${money(s.serviceFeeTotal)} servicio`);
    parts.push(`${money(s.platformFeeTotal)} plataforma`);
    if (s.whatsappFeeTotal) parts.push(`${money(s.whatsappFeeTotal)} WhatsApp`);
    return parts.join(' · ');
  };

  const settlements = billingSummary?.recentSettlements ?? [];
  const totalDeliveredInPeriod = billingSummary?.deliveredOrders ?? 0;

  return (
    <div className="space-y-5">
      {/* ═══════ HERO ═══════ */}
      <section className="relative overflow-hidden rounded-[32px] border border-black/5 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.98),rgba(249,247,243,0.95)_48%,rgba(243,238,229,0.93)_100%)] p-6 shadow-[0_20px_70px_rgba(15,15,15,0.06)] md:p-8">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-10 -top-16 h-56 w-56 rounded-full bg-sky-200/25 blur-3xl" />
          <div className="absolute -right-8 top-12 h-56 w-56 rounded-full bg-emerald-200/20 blur-3xl" />
        </div>

        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-xl">
            <p className="text-[10px] font-black uppercase tracking-[0.28em] text-sky-700/70">Facturación & Control</p>
            <h1 className="mt-2 text-2xl font-extrabold tracking-[-0.04em] text-neutral-950 md:text-[32px]">Balance de Cuenta</h1>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold ${statusBadge.cls}`}>
                <span className="text-sm leading-none">{statusBadge.icon}</span>
                {statusBadge.label}
              </span>
              <span className="text-xs font-medium text-neutral-500">{statusBadge.desc}</span>
            </div>
          </div>

          <div className="flex items-center gap-5 rounded-[24px] border border-black/5 bg-white/70 p-4 pr-6 shadow-sm backdrop-blur">
            <div className="relative flex items-center justify-center">
              {(() => {
                const progress = getCycleProgress();
                const radius = 30;
                const circ = 2 * Math.PI * radius;
                const strokeOffset = circ - (progress / 100) * circ;
                return (
                  <>
                    <svg className="h-20 w-20 -rotate-90">
                      <circle cx="40" cy="40" r={radius} className="text-neutral-100" strokeWidth="6" stroke="currentColor" fill="transparent" />
                      <circle
                        cx="40" cy="40" r={radius}
                        className="text-sky-500 transition-all duration-500 ease-out"
                        strokeWidth="6"
                        strokeDasharray={circ}
                        strokeDashoffset={strokeOffset}
                        strokeLinecap="round"
                        stroke="currentColor"
                        fill="transparent"
                      />
                    </svg>
                    <span className="absolute text-sm font-black text-neutral-900">{progress}%</span>
                  </>
                );
              })()}
            </div>

            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Ciclo Semanal</p>
              <p className="mt-0.5 text-sm font-bold text-neutral-900">Progreso de Periodo</p>
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-xl bg-sky-50/70 px-2.5 py-1.5 text-xs font-bold text-sky-700 ring-1 ring-inset ring-sky-100">
                <span className="animate-pulse">⏱️</span>
                <span>
                  {hasPendingOrOverdue
                    ? `Pagar antes de: ${formatTimeLeft(getSecondsUntilNextSuspension())}`
                    : `Siguiente corte: ${formatTimeLeft(getSecondsUntilNextCutoff())}`}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════ RESUMEN + CÓMO LIQUIDAR ═══════ */}
      <section className="grid gap-5 md:grid-cols-2">
        {/* Periodo en Curso */}
        <article className="relative overflow-hidden rounded-[28px] border border-black/5 bg-white p-6 shadow-[0_4px_24px_rgba(0,0,0,0.02)] transition hover:shadow-md md:p-7">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-extrabold tracking-tight text-neutral-950">Periodo en Curso</h2>
              <p className="mt-1 text-xs text-neutral-500">Comisiones acumuladas de la semana</p>
            </div>
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-50 text-xl ring-1 ring-inset ring-sky-100/70">💸</span>
          </div>

          <div className="mt-6 flex items-baseline gap-2">
            <span className="text-5xl font-black tracking-tight text-neutral-950 tabular-nums">{money(periodTotal)}</span>
            <span className="text-xs font-bold text-neutral-400 uppercase">MXN</span>
          </div>

          {showFeeConfig && platformFeeRevenue > 0 && (
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-sky-50 px-2.5 py-1.5 text-xs font-semibold text-sky-700 ring-1 ring-inset ring-sky-100">
              <span>📈</span>
              Tasa de uso: {platformRateLabel(platformFeeRate, platformFeePerOrder)}
              <span className="font-bold text-sky-500/80">· {money(platformFeeRevenue)} acumulados</span>
            </p>
          )}

          <dl className="mt-6 space-y-3 border-t border-black/5 pt-5">
            <div className="flex items-center justify-between gap-3">
              <dt className="flex min-w-0 items-center gap-2 text-sm text-neutral-500">
                <span className="text-base">🧾</span>
                <span className="truncate font-medium">Tarifa de Servicio</span>
              </dt>
              <dd className="flex items-center gap-2">
                <span className="rounded-lg bg-neutral-100/80 px-2 py-0.5 text-[11px] font-bold text-neutral-500">{money(billingSummary?.serviceFee)} c/u</span>
                <span className="font-bold text-neutral-950 tabular-nums">{money(billingSummary?.serviceFeeRevenue)}</span>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="flex min-w-0 items-center gap-2 text-sm text-neutral-500">
                <span className="text-base">📊</span>
                <span className="truncate font-medium">Uso de la Plataforma</span>
              </dt>
              <dd className="flex items-center gap-2">
                <span className="rounded-lg bg-neutral-100/80 px-2 py-0.5 text-[11px] font-bold text-neutral-500">{platformRateLabel(platformFeeRate, platformFeePerOrder)}</span>
                <span className="font-bold text-neutral-950 tabular-nums">{money(platformFeeRevenue)}</span>
              </dd>
            </div>
            {(billingSummary?.whatsappFeeRevenue ?? 0) > 0 && (
              <div className="flex items-center justify-between gap-3">
                <dt className="flex min-w-0 items-center gap-2 text-sm text-neutral-500">
                  <span className="text-base">💬</span>
                  <span className="truncate font-medium">WhatsApp</span>
                </dt>
                <dd className="flex items-center gap-2">
                  <span className="rounded-lg bg-neutral-100/80 px-2 py-0.5 text-[11px] font-bold text-neutral-500">{money(billingSummary?.whatsappFeeRevenue)}</span>
                </dd>
              </div>
            )}
          </dl>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-black/5 pt-4">
            <span className="text-xs font-medium text-neutral-500">
              {totalDeliveredInPeriod} pedido{totalDeliveredInPeriod !== 1 ? 's' : ''} en el período
            </span>
            <span className="rounded-xl bg-sky-50/80 px-2.5 py-1 text-xs font-bold text-sky-700 ring-1 ring-inset ring-sky-100/70">
              Corte: {billingSummary?.nextChargeDate
                ? new Date(billingSummary.nextChargeDate).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
                : '--'}
            </span>
          </div>

          <button
            type="button"
            onClick={() => {
              setIsCurrentPeriodDetailsOpen(true);
              fetchCurrentPeriodOrders();
            }}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-sky-100 bg-gradient-to-r from-sky-50 to-sky-100/40 px-4 py-3 text-xs font-bold text-sky-700 shadow-sm transition hover:from-sky-100 hover:to-sky-100 active:scale-[0.98]"
          >
            <svg className="h-4 w-4 text-sky-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
            Ver desglose del acumulado
          </button>
        </article>

        {/* Cómo liquidar */}
        <article className="flex flex-col justify-between rounded-[28px] border border-black/5 bg-gradient-to-br from-neutral-50 to-neutral-100/50 p-6 shadow-[0_4px_24px_rgba(0,0,0,0.02)] md:p-7">
          <div>
            <h2 className="text-lg font-extrabold tracking-tight text-neutral-950">Cómo liquidar tu saldo</h2>
            <ol className="mt-5 space-y-4">
              <li className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-600/10 text-xs font-black text-sky-700 ring-1 ring-inset ring-sky-600/10">1</span>
                <p className="text-sm leading-relaxed text-neutral-600">
                  El corte se genera automáticamente los <span className="font-semibold text-neutral-800">domingos a las 23:59</span>.
                </p>
              </li>
              <li className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-600/10 text-xs font-black text-sky-700 ring-1 ring-inset ring-sky-600/10">2</span>
                <p className="text-sm leading-relaxed text-neutral-600">
                  Tienes hasta el <span className="font-semibold text-neutral-800">miércoles a las 23:59</span> para pagar.
                </p>
              </li>
              <li className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-600/10 text-xs font-black text-sky-700 ring-1 ring-inset ring-sky-600/10">3</span>
                <p className="text-sm leading-relaxed text-neutral-600">
                  Haz la <span className="font-semibold text-neutral-800">transferencia</span>, sube tu comprobante y espera la aprobación.
                </p>
              </li>
            </ol>
          </div>

          <div className="mt-6 flex items-start gap-3 rounded-2xl border border-amber-200/70 bg-amber-50/70 p-4">
            <span className="text-lg">⚠️</span>
            <div>
              <p className="text-xs font-bold text-amber-900">Suspensión automática</p>
              <p className="mt-0.5 text-xs leading-relaxed text-amber-800/90">
                Sin pago confirmado antes del límite, tu restaurante se desactiva automáticamente.
              </p>
            </div>
          </div>
        </article>
      </section>

      {/* ═══════ HISTORIAL ═══════ */}
      <section className="rounded-[28px] border border-black/5 bg-white p-6 shadow-[0_4px_24px_rgba(0,0,0,0.01)] md:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-extrabold tracking-tight text-neutral-950">Historial de Cortes</h2>
            <p className="mt-0.5 text-xs text-neutral-500">Cortes anteriores, pagos reportados y comprobantes</p>
          </div>
          <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-bold text-neutral-600">{settlements.length} registros</span>
        </div>

        <div className="mt-5 space-y-3">
          {settlements.length > 0 ? (
            settlements.map((settlement: any) => {
              const isPending = settlement.status === 'PENDING';
              const isReview = settlement.status === 'IN_REVIEW';
              const isOverdue = settlement.status === 'OVERDUE';
              return (
                <div
                  key={settlement.id}
                  className={`rounded-2xl border p-5 transition duration-200 shadow-sm hover:shadow-md ${
                    isOverdue
                      ? 'border-rose-200 bg-gradient-to-r from-rose-50/50 to-white'
                      : isPending
                        ? 'border-sky-200 bg-gradient-to-r from-sky-50/50 to-white'
                        : isReview
                          ? 'border-blue-200 bg-gradient-to-r from-blue-50/50 to-white'
                          : 'border-black/5 bg-white hover:border-neutral-200'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-extrabold tracking-tight text-neutral-950">{formatSettlementReference(settlement.reference)}</p>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${
                            isOverdue
                              ? 'border-rose-200 bg-rose-100 text-rose-700 animate-pulse'
                              : isPending
                                ? 'border-sky-200 bg-sky-100 text-sky-800 animate-pulse'
                                : isReview
                                  ? 'border-blue-200 bg-blue-100 text-blue-700'
                                  : 'border-emerald-200 bg-emerald-100 text-emerald-700'
                          }`}
                        >
                          {isOverdue ? '🚨 Vencido' : isPending ? '⏱️ Pendiente' : isReview ? '🔍 En revisión' : '✅ Pagado'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs font-medium text-neutral-500">
                        {new Date(settlement.periodStart).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })} - {new Date(settlement.periodEnd).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}
                        <span className="mx-1.5 text-neutral-300">·</span>
                        <span className="text-neutral-400">{totalsPerStatus(settlement)}</span>
                      </p>
                    </div>

                    <div className="flex items-center gap-4">
                      <p className="text-xl font-black tracking-tight text-neutral-950 tabular-nums">{money(settlement.amount)} <span className="text-xs font-bold text-neutral-400">MXN</span></p>
                    </div>
                  </div>

                  {(isPending || isOverdue || isReview) && settlement.dueDate && (
                    <div
                      className={`mt-3 inline-flex flex-wrap items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[11px] font-bold ${
                        isOverdue
                          ? 'border-rose-200/60 bg-rose-50/60 text-rose-700'
                          : isPending
                            ? 'border-sky-200/60 bg-sky-50/60 text-sky-700'
                            : 'border-blue-200/60 bg-blue-50/60 text-blue-700'
                      }`}
                    >
                      {isOverdue
                        ? `🚨 Atraso: ${getDaysOverdue(settlement.dueDate)} días · Venció el ${new Date(settlement.dueDate).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}`
                        : isPending
                          ? `📅 Límite: ${new Date(settlement.dueDate).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}`
                          : `📤 Reportado el ${new Date(settlement.updatedAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-black/5 pt-3.5">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSettlementForDetails(settlement);
                        setIsDetailsModalOpen(true);
                        fetchSettlementOrders(settlement.id);
                      }}
                      className="rounded-xl border border-black/10 bg-white px-3.5 py-2 text-xs font-bold text-neutral-700 shadow-sm transition hover:bg-neutral-50 active:scale-95"
                    >
                      Ver detalles
                    </button>

                    {settlement.paymentProofUrl && (
                      <a
                        href={settlement.paymentProofUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-xl border border-black/10 bg-white px-3.5 py-2 text-xs font-bold text-neutral-700 shadow-sm transition hover:bg-neutral-50 active:scale-95"
                      >
                        🖼️ Comprobante
                      </a>
                    )}

                    {isPending || isOverdue ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedSettlementForPay(settlement);
                          setIsPayModalOpen(true);
                        }}
                        className="rounded-xl bg-neutral-950 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-neutral-800 active:scale-95"
                      >
                        Pagar Corte
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="rounded-[24px] border border-dashed border-black/10 bg-neutral-50/50 py-12 text-center text-neutral-500">
              <span className="mb-2 block text-3xl">📊</span>
              <p className="font-bold text-neutral-700">Sin cortes aún</p>
              <p className="mt-1 text-xs">Al finalizar tu primer ciclo aparecerá aquí tu corte de caja.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
});