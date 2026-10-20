'use client';

import React from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileText,
  Image as ImageIcon,
  MessageCircle,
  Receipt,
  Search,
  TrendingUp,
} from 'lucide-react';

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

const money = (value: number | undefined) => `$${new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value ?? 0)}`;

const platformRateLabel = (platformFeeRate: number, platformFeePerOrder: number) => {
  if (platformFeeRate > 0) {
    const pct = platformFeeRate * 100;
    return `${pct.toFixed(pct % 1 === 0 ? 0 : 1)}% del subtotal`;
  }
  return `${money(platformFeePerOrder)} por pedido`;
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
      ? { label: 'Suspendido por impago', tone: 'rose', desc: 'La cuenta está suspendida por un corte vencido.' }
      : pendingCount > 0
        ? { label: 'Pago pendiente', tone: 'amber', desc: 'Tienes un corte de caja pendiente de pago.' }
        : inReviewCount > 0
          ? { label: 'En revisión', tone: 'sky', desc: 'Recibimos tu comprobante y está en verificación.' }
          : { label: 'Al día', tone: 'emerald', desc: 'No tienes pagos pendientes.' };

  const statusToneClass = {
    rose: 'border-rose-200 bg-rose-50 text-rose-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    sky: 'border-sky-200 bg-sky-50 text-sky-800',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  }[statusBadge.tone];
  const StatusIcon = statusBadge.tone === 'rose'
    ? AlertTriangle
    : statusBadge.tone === 'amber'
      ? Clock3
      : statusBadge.tone === 'sky'
        ? Search
        : CheckCircle2;

  const hasPendingOrOverdue = pendingCount > 0 || overdueCount > 0;
  const periodTotal = (billingSummary?.serviceFeeRevenue ?? 0) + (billingSummary?.platformFeeRevenue ?? 0) + (billingSummary?.whatsappFeeRevenue ?? 0);
  const platformFeeRate = billingSummary?.platformFeeRate ?? 0;
  const platformFeePerOrder = billingSummary?.platformFeePerOrder ?? 0;
  const platformFeeRevenue = billingSummary?.platformFeeRevenue ?? 0;
  const showFeeConfig = platformFeeRate > 0 || platformFeePerOrder > 0;
  const cycleProgress = Math.min(100, Math.max(0, getCycleProgress()));

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
    <div className="mx-auto min-w-0 max-w-[1400px] space-y-4 sm:space-y-5">
      <section className="relative overflow-hidden rounded-[24px] border border-neutral-200/80 bg-gradient-to-br from-white via-white to-sky-50/70 p-4 shadow-[0_12px_40px_-28px_rgba(15,23,42,0.3)] sm:rounded-[28px] sm:p-6 md:p-7">
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-sky-500 via-blue-500 to-emerald-400" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-sky-700">Facturación y pagos</p>
            <h1 className="mt-1.5 text-[26px] font-extrabold leading-tight tracking-[-0.04em] text-neutral-950 sm:text-3xl">Balance de cuenta</h1>
            <div className="mt-3 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
              <span role="status" className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${statusToneClass}`}>
                <StatusIcon aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={2.2} />
                {statusBadge.label}
              </span>
              <span className="text-sm leading-5 text-neutral-600">{statusBadge.desc}</span>
            </div>
          </div>

          <div className="flex min-w-0 items-center gap-3.5 rounded-[20px] border border-neutral-200/80 bg-white/85 p-3.5 shadow-sm sm:gap-4 sm:p-4 lg:w-[350px] lg:shrink-0">
            <div className="relative flex h-[68px] w-[68px] shrink-0 items-center justify-center">
              <svg role="img" aria-label={`Ciclo semanal: ${cycleProgress}%`} viewBox="0 0 80 80" className="h-full w-full -rotate-90">
                <circle cx="40" cy="40" r="31" className="text-neutral-100" strokeWidth="6" stroke="currentColor" fill="transparent" />
                <circle
                  cx="40" cy="40" r="31"
                  className="text-sky-600 transition-all duration-500 ease-out"
                  strokeWidth="6"
                  strokeDasharray={2 * Math.PI * 31}
                  strokeDashoffset={2 * Math.PI * 31 * (1 - cycleProgress / 100)}
                  strokeLinecap="round"
                  stroke="currentColor"
                  fill="transparent"
                />
              </svg>
              <span aria-hidden="true" className="absolute text-sm font-bold tabular-nums text-neutral-900">{cycleProgress}%</span>
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold text-neutral-700">Ciclo semanal</p>
              </div>
              <div className="mt-2 flex items-start gap-2 text-xs">
                <Clock3 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />
                <div className="min-w-0">
                  <p className="font-medium text-neutral-500">{hasPendingOrOverdue ? 'Plazo para pagar' : 'Próximo corte'}</p>
                  <p className="mt-0.5 font-bold leading-4 text-neutral-900">
                    {formatTimeLeft(hasPendingOrOverdue ? getSecondsUntilNextSuspension() : getSecondsUntilNextCutoff())}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════ RESUMEN + CÓMO LIQUIDAR ═══════ */}
      <section className="grid min-w-0 gap-4 lg:grid-cols-2 lg:gap-5">
        {/* Periodo en Curso */}
        <article className="min-w-0 rounded-[24px] border border-neutral-200/80 bg-white p-4 shadow-[0_8px_30px_-24px_rgba(15,23,42,0.3)] sm:rounded-[28px] sm:p-6 md:p-7">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-bold tracking-tight text-neutral-950">Periodo en curso</h2>
              <p className="mt-1 text-sm leading-5 text-neutral-600">Cargos acumulados de esta semana</p>
            </div>
            <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-100">
              <Receipt className="h-5 w-5" strokeWidth={1.9} />
            </span>
          </div>

          <div className="mt-5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-[38px] font-extrabold leading-none tracking-[-0.045em] text-neutral-950 tabular-nums sm:text-5xl">{money(periodTotal)}</span>
            <span className="text-xs font-bold tracking-wide text-neutral-500">MXN</span>
          </div>

          {showFeeConfig && platformFeeRevenue > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-800 ring-1 ring-inset ring-sky-100">
              <TrendingUp aria-hidden="true" className="h-4 w-4 shrink-0 text-sky-700" />
              <span className="font-semibold">Tarifa de plataforma:</span>
              <span>{platformRateLabel(platformFeeRate, platformFeePerOrder)}</span>
              <span className="font-bold">{money(platformFeeRevenue)} acumulados</span>
            </div>
          )}

          <dl className="mt-5 divide-y divide-neutral-100 border-y border-neutral-100">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3">
              <dt className="min-w-0">
                <span className="block truncate text-sm font-semibold text-neutral-800">Tarifa de servicio</span>
                <span className="mt-0.5 block text-xs text-neutral-500">{money(billingSummary?.serviceFee)} por pedido</span>
              </dt>
              <dd className="text-right text-sm font-bold tabular-nums text-neutral-950">{money(billingSummary?.serviceFeeRevenue)}</dd>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3">
              <dt className="min-w-0">
                <span className="block truncate text-sm font-semibold text-neutral-800">Uso de la plataforma</span>
                <span className="mt-0.5 block text-xs text-neutral-500">{platformRateLabel(platformFeeRate, platformFeePerOrder)}</span>
              </dt>
              <dd className="text-right text-sm font-bold tabular-nums text-neutral-950">{money(platformFeeRevenue)}</dd>
            </div>
            {(billingSummary?.whatsappFeeRevenue ?? 0) > 0 && (
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3">
                <dt className="flex min-w-0 items-center gap-2">
                  <MessageCircle aria-hidden="true" className="h-4 w-4 shrink-0 text-neutral-500" />
                  <span className="truncate text-sm font-semibold text-neutral-800">Mensajes de WhatsApp</span>
                </dt>
                <dd className="text-right text-sm font-bold tabular-nums text-neutral-950">{money(billingSummary?.whatsappFeeRevenue)}</dd>
              </div>
            )}
          </dl>

          <div className="flex flex-wrap items-center justify-between gap-2.5 py-4">
            <span className="text-sm text-neutral-600">
              {totalDeliveredInPeriod} pedido{totalDeliveredInPeriod !== 1 ? 's' : ''} en el período
            </span>
            <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold text-neutral-700">
              <CalendarDays aria-hidden="true" className="h-3.5 w-3.5 text-neutral-500" />
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
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-800 transition-colors hover:bg-sky-100 active:bg-sky-100"
          >
            <FileText aria-hidden="true" className="h-4 w-4" />
            Ver desglose del acumulado
          </button>
        </article>

        {/* Cómo liquidar */}
        <article className="flex min-w-0 flex-col justify-between rounded-[24px] border border-neutral-200/80 bg-neutral-50/80 p-4 sm:rounded-[28px] sm:p-6 md:p-7">
          <div>
            <div className="flex items-center gap-2.5">
              <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white text-sky-700 ring-1 ring-inset ring-neutral-200/80">
                <CalendarDays className="h-5 w-5" strokeWidth={1.9} />
              </span>
              <div>
                <h2 className="text-lg font-bold tracking-tight text-neutral-950">Cómo liquidar tu saldo</h2>
                <p className="mt-0.5 text-sm text-neutral-600">Tres pasos sencillos</p>
              </div>
            </div>
            <ol className="mt-5 space-y-0">
              <li className="relative flex gap-3 pb-5">
                <span aria-hidden="true" className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold text-sky-800 ring-1 ring-inset ring-sky-200">1</span>
                <p className="pt-1 text-sm leading-5 text-neutral-700">
                  El corte se genera cada <span className="font-semibold text-neutral-950">domingo a las 23:59</span>.
                </p>
                <span aria-hidden="true" className="absolute bottom-0 left-[15px] top-8 w-px bg-sky-200" />
              </li>
              <li className="relative flex gap-3 pb-5">
                <span aria-hidden="true" className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold text-sky-800 ring-1 ring-inset ring-sky-200">2</span>
                <p className="pt-1 text-sm leading-5 text-neutral-700">
                  Puedes pagar hasta el <span className="font-semibold text-neutral-950">miércoles a las 23:59</span>.
                </p>
                <span aria-hidden="true" className="absolute bottom-0 left-[15px] top-8 w-px bg-sky-200" />
              </li>
              <li className="flex gap-3">
                <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold text-sky-800 ring-1 ring-inset ring-sky-200">3</span>
                <p className="pt-1 text-sm leading-5 text-neutral-700">
                  Haz la <span className="font-semibold text-neutral-950">transferencia</span>, sube el comprobante y espera la aprobación.
                </p>
              </li>
            </ol>
          </div>

          <div className="mt-5 flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50/80 p-3.5">
            <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <div className="min-w-0">
              <p className="text-xs font-bold text-amber-950">Evita interrupciones</p>
              <p className="mt-0.5 text-xs leading-5 text-amber-900/90">
                Si el pago no se confirma antes del vencimiento, el restaurante se suspende automáticamente.
              </p>
            </div>
          </div>
        </article>
      </section>

      {/* ═══════ HISTORIAL ═══════ */}
      <section className="min-w-0 rounded-[24px] border border-neutral-200/80 bg-white p-4 shadow-[0_8px_30px_-24px_rgba(15,23,42,0.3)] sm:rounded-[28px] sm:p-6 md:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold tracking-tight text-neutral-950">Historial de cortes</h2>
            <p className="mt-1 text-sm leading-5 text-neutral-600">Pagos anteriores, reportes y comprobantes</p>
          </div>
          <span className="inline-flex min-h-8 items-center rounded-full bg-neutral-100 px-3 text-xs font-semibold text-neutral-700">
            {settlements.length} {settlements.length === 1 ? 'corte' : 'cortes'}
          </span>
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
                  className={`min-w-0 rounded-[20px] border p-4 shadow-sm sm:p-5 ${
                    isOverdue
                      ? 'border-rose-200 bg-rose-50/40'
                      : isPending
                        ? 'border-sky-200 bg-sky-50/40'
                        : isReview
                          ? 'border-blue-200 bg-blue-50/40'
                          : 'border-neutral-200 bg-white'
                  }`}
                >
                  <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="break-all text-sm font-bold tracking-tight text-neutral-950">{formatSettlementReference(settlement.reference)}</p>
                        <span
                          className={`inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                            isOverdue
                              ? 'border-rose-200 bg-rose-100 text-rose-800'
                              : isPending
                                ? 'border-sky-200 bg-sky-100 text-sky-800'
                                : isReview
                                  ? 'border-blue-200 bg-blue-100 text-blue-700'
                                  : 'border-emerald-200 bg-emerald-100 text-emerald-700'
                          }`}
                        >
                          {isOverdue ? <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" /> : null}
                          {isPending ? <Clock3 aria-hidden="true" className="h-3.5 w-3.5" /> : null}
                          {isReview ? <Search aria-hidden="true" className="h-3.5 w-3.5" /> : null}
                          {!isOverdue && !isPending && !isReview ? <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" /> : null}
                          {isOverdue ? 'Vencido' : isPending ? 'Pendiente' : isReview ? 'En revisión' : 'Pagado'}
                        </span>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-neutral-600">
                        Período: {new Date(settlement.periodStart).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })} – {new Date(settlement.periodEnd).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                      <p className="mt-0.5 break-words text-xs leading-5 text-neutral-500">{totalsPerStatus(settlement)}</p>
                    </div>

                    <div className="flex items-baseline gap-1.5 sm:shrink-0 sm:justify-end">
                      <p className="text-2xl font-bold tracking-tight text-neutral-950 tabular-nums">{money(settlement.amount)}</p>
                      <span className="text-[11px] font-semibold text-neutral-500">MXN</span>
                    </div>
                  </div>

                  {(isPending || isOverdue || isReview) && settlement.dueDate && (
                    <div
                      className={`mt-3 inline-flex min-h-9 max-w-full flex-wrap items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold leading-5 ${
                        isOverdue
                          ? 'border-rose-200 bg-rose-50 text-rose-800'
                          : isPending
                            ? 'border-sky-200 bg-sky-50 text-sky-800'
                            : 'border-blue-200 bg-blue-50 text-blue-800'
                      }`}
                    >
                      {isOverdue
                        ? `Atraso de ${getDaysOverdue(settlement.dueDate)} días · Venció el ${new Date(settlement.dueDate).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}`
                        : isPending
                          ? `Fecha límite: ${new Date(settlement.dueDate).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}`
                          : `Comprobante reportado el ${new Date(settlement.updatedAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
                    </div>
                  )}

                  <div className="mt-4 grid grid-cols-2 gap-2 border-t border-neutral-200/70 pt-3.5 sm:flex sm:justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSettlementForDetails(settlement);
                        setIsDetailsModalOpen(true);
                        fetchSettlementOrders(settlement.id);
                      }}
                      className={`order-2 inline-flex min-h-11 items-center justify-center rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-xs font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 active:bg-neutral-100 sm:order-none sm:px-3.5 ${!settlement.paymentProofUrl ? 'col-span-2' : ''}`}
                    >
                      Ver detalles
                    </button>

                    {settlement.paymentProofUrl && (
                      <a
                        href={settlement.paymentProofUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="order-3 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-xs font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 active:bg-neutral-100 sm:order-none sm:px-3.5"
                      >
                        <ImageIcon aria-hidden="true" className="h-4 w-4" />
                        Comprobante
                      </a>
                    )}

                    {isPending || isOverdue ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedSettlementForPay(settlement);
                          setIsPayModalOpen(true);
                        }}
                        className="order-1 col-span-2 inline-flex min-h-12 items-center justify-center rounded-xl bg-neutral-950 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-neutral-800 active:bg-neutral-800 sm:order-none sm:col-span-1 sm:min-h-11 sm:px-4 sm:py-2.5 sm:text-xs"
                      >
                        Pagar corte
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="rounded-[20px] border border-dashed border-neutral-300 bg-neutral-50/70 px-4 py-10 text-center">
              <span aria-hidden="true" className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-neutral-500 ring-1 ring-inset ring-neutral-200">
                <Receipt className="h-5 w-5" />
              </span>
              <p className="font-semibold text-neutral-800">Aún no hay cortes</p>
              <p className="mx-auto mt-1 max-w-sm text-sm leading-5 text-neutral-600">Cuando termine tu primer ciclo, aquí encontrarás el detalle del corte y sus comprobantes.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
});
