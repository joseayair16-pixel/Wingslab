'use client';
import { X } from 'lucide-react';

import Link from 'next/link';
import { SaDelLogo } from '../../../components/SaDelLogo';
import { useParams } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer } from 'recharts';
import {
  AuthUser,
  clearStoredSession,
  persistApiBase,
  readStoredSession,
  requestJson,
} from '@sadel/shared';

type RestaurantStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED';
type BillingCycle = 'WEEKLY' | 'MONTHLY';
type BusinessType = 'RESTAURANT' | 'STORE';

type RestaurantBillingSummary = {
  currentDebt: number;
  pastDebt: number;
  deliveredRevenue: number;
  serviceFeeRevenue: number;
  platformFeeRevenue: number;
  whatsappFeeRevenue: number;
  deliveredOrders: number;
  platformFeePerOrder: number;
  platformFeeRate: number;
  billingCycle: BillingCycle;
  periodStart: string;
  periodEnd: string;
  nextChargeDate: string;
};

type RestaurantSettlement = {
  id: string;
  billingCycle: BillingCycle;
  feeRate: number;
  periodStart: string;
  periodEnd: string;
  dueDate?: string | null;
  settledAt?: string | null;
  deliveredOrders: number;
  deliveredRevenue: number;
  amount: number;
  serviceFeeTotal: number;
  platformFeeTotal: number;
  whatsappFeeTotal: number;
  status: 'PENDING' | 'IN_REVIEW' | 'PAID' | 'OVERDUE';
  reference: string;
  notes?: string | null;
  paymentProofUrl?: string | null;
};

type RestaurantOperationalStats = {
  totalOrders: number;
  deliveredOrders: number;
  activeOrders: number;
  todayOrders: number;
  totalRevenue: number;
  deliveredRevenue: number;
};

type WeeklyPerformance = {
  name: string;
  ingresos: number;
};

type RestaurantDetail = {
  id: string;
  name: string;
  description: string;
  region: string;
  status: RestaurantStatus;
  statusReason?: string | null;
  statusChangedAt?: string | null;
  statusChangedBy?: string | null;
  address: string;
  minDeliveryTime: number;
  maxDeliveryTime: number;
  latitude?: number;
  longitude?: number;
  email: string;
  contactPhone: string;
  serviceFee?: number | null;
  hasOwnDelivery: boolean;
  supportsNetworkDelivery?: boolean;
  pickupOnly?: boolean;
  deliveryFee?: number | null;
  deliveryPricingModel?: string | null;
  deliveryBaseRate?: number | null;
  deliveryPerKmRate?: number | null;
  deliveryMinFee?: number | null;
  deliveryMaxFee?: number | null;
  maxCashOrder?: number | null;
  effectiveDeliveryFee?: number | null;
  billingCycle: BillingCycle;
  platformFeePerOrder: number;
  platformFeeRate: number;
  lastBillingSettledAt?: string | null;
  billingContactEmail?: string | null;
  isFeatured: boolean;
  businessType?: BusinessType;
  billingSummary: RestaurantBillingSummary;
  operationalStats: RestaurantOperationalStats;
  weeklyPerformance: WeeklyPerformance[];
  recentSettlements: RestaurantSettlement[];
  categories: Array<{
    id: string;
    name: string;
    description?: string | null;
  }>;
  operatingHours: Array<{
    id?: string;
    dayOfWeek: number;
    openTime: string;
    closeTime: string;
    isClosed: boolean;
  }>;
  user: {
    id: string;
    name: string;
    phone: string;
    email: string;
    region: string;
    status: string;
  };
};

type RestaurantEditForm = {
  ownerName: string;
  ownerPhone: string;
  ownerEmail: string;
  name: string;
  description: string;
  address: string;
  region: string;
  contactPhone: string;
  email: string;
  serviceFee: string;
  hasOwnDelivery: boolean;
  supportsNetworkDelivery: boolean;
  pickupOnly: boolean;
  deliveryFee: string;
  deliveryPricingModel: 'fixed' | 'distance';
  deliveryBaseRate: string;
  deliveryPerKmRate: string;
  deliveryMinFee: string;
  deliveryMaxFee: string;
  maxCashOrder: string;
  minDeliveryTime: string;
  maxDeliveryTime: string;
  billingCycle: BillingCycle;
  platformFeePerOrder: string;
  platformFeeRate: string;
  billingContactEmail: string;
  businessType?: BusinessType;
};

const defaultApiBase = '/api';
const storageKey = 'sadel.admin';

export default function RestaurantDetailPage() {
  const rawParams = useParams();
  const restaurantIdCandidate = (rawParams as Record<string, string | string[] | undefined>).id;
  const restaurantId = Array.isArray(restaurantIdCandidate)
    ? (restaurantIdCandidate[0] ?? '')
    : (restaurantIdCandidate ?? '');

  const [apiBase, setApiBase] = useState(defaultApiBase);
  const [token, setToken] = useState('');
  const [sessionUser, setSessionUser] = useState<AuthUser | null>(null);
  const [restaurant, setRestaurant] = useState<RestaurantDetail | null>(null);
  const [editForm, setEditForm] = useState<RestaurantEditForm | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [savingRestaurant, setSavingRestaurant] = useState(false);
  const [settlingBilling, setSettlingBilling] = useState(false);
  const [activeStatusUpdate, setActiveStatusUpdate] = useState<RestaurantStatus | null>(null);
  const [statusReasonDraft, setStatusReasonDraft] = useState('');
  const [error, setError] = useState('');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [authMessage, setAuthMessage] = useState('');
  const [sessionReady, setSessionReady] = useState(false);
  const [proofUrlModal, setProofUrlModal] = useState<string | null>(null);

  const adminUser = sessionUser && sessionUser.role === 'ADMIN' ? sessionUser : null;

  useEffect(() => {
    const savedSession = readStoredSession(storageKey);

    if (savedSession.apiBase && savedSession.apiBase.startsWith('/')) {
      setApiBase(savedSession.apiBase);
    }

    if (savedSession.token) {
      setToken(savedSession.token);
    }

    if (savedSession.user) {
      setSessionUser(savedSession.user);
    }

    setSessionReady(true);
  }, []);

  const loadRestaurantDetail = useCallback(async () => {
    if (!token || !restaurantId) {
      return;
    }

    setLoadingDetail(true);
    setError('');

    try {
      const payload = await requestJson<{ success: true; data: RestaurantDetail }>({
        apiBase,
        path: `/admin/restaurantes/${restaurantId}`,
        token,
        fallbackMessage: 'No se pudo cargar el detalle del restaurante.',
      });

      setRestaurant(payload.data);
      setEditForm(createEditFormState(payload.data));
      setStatusReasonDraft('');
    } catch (requestError) {
      setRestaurant(null);
      setEditForm(null);
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'No se pudo cargar el detalle del restaurante.'
      );
    } finally {
      setLoadingDetail(false);
    }
  }, [apiBase, restaurantId, token]);

  useEffect(() => {
    if (!sessionReady || !adminUser || !token || !restaurantId) {
      return;
    }

    void loadRestaurantDetail();
  }, [adminUser, loadRestaurantDetail, restaurantId, sessionReady, token]);

  async function saveRestaurantChanges(event: FormEvent) {
    event.preventDefault();

    if (!editForm) {
      return;
    }

    setSavingRestaurant(true);
    setError('');
    setAuthMessage('');
    persistApiBase(storageKey, apiBase);

    try {
      await requestJson<{ success: true; data: RestaurantDetail }>({
        apiBase,
        path: `/admin/restaurantes/${restaurantId}`,
        token,
        options: {
          method: 'PATCH',
          body: JSON.stringify({
            ownerName: editForm.ownerName.trim(),
            ownerPhone: editForm.ownerPhone.trim(),
            ownerEmail: editForm.ownerEmail.trim() || undefined,
            name: editForm.name.trim(),
            description: editForm.description.trim(),
            address: editForm.address.trim(),
            region: editForm.region.trim(),
            contactPhone: editForm.contactPhone.trim(),
            email: editForm.email.trim(),
            serviceFee: (() => {
              const val = editForm.serviceFee.trim();
              return val ? parseRequiredDecimal(val) : 0;
            })(),
            hasOwnDelivery: editForm.hasOwnDelivery,
            supportsNetworkDelivery: editForm.supportsNetworkDelivery ?? true,
            pickupOnly: editForm.pickupOnly ?? false,
            ...(editForm.pickupOnly
              ? { hasOwnDelivery: false, supportsNetworkDelivery: false, deliveryFee: undefined }
              : {}),
            deliveryFee: editForm.hasOwnDelivery ? parseOptionalNumber(editForm.deliveryFee) : undefined,
            deliveryPricingModel: editForm.hasOwnDelivery ? editForm.deliveryPricingModel : 'fixed',
            deliveryBaseRate: editForm.hasOwnDelivery ? parseOptionalNumber(editForm.deliveryBaseRate) ?? 20 : undefined,
            deliveryPerKmRate: editForm.hasOwnDelivery ? parseOptionalNumber(editForm.deliveryPerKmRate) ?? 8 : undefined,
            deliveryMinFee: editForm.hasOwnDelivery ? parseOptionalNumber(editForm.deliveryMinFee) ?? 15 : undefined,
            deliveryMaxFee: editForm.hasOwnDelivery ? parseOptionalNumber(editForm.deliveryMaxFee) ?? 150 : undefined,
            maxCashOrder: parseOptionalNumber(editForm.maxCashOrder) ?? 500,
            minDeliveryTime: parseRequiredInteger(editForm.minDeliveryTime),
            maxDeliveryTime: parseRequiredInteger(editForm.maxDeliveryTime),
            billingCycle: editForm.billingCycle,
            platformFeePerOrder: (() => {
              const val = editForm.platformFeePerOrder.trim();
              return val ? parseRequiredDecimal(val) : 0;
            })(),
            platformFeeRate: (() => {
              const val = parseRequiredDecimal(editForm.platformFeeRate);
              return val > 0 ? val / 100 : 0;
            })(),
            billingContactEmail: editForm.billingContactEmail.trim() || undefined,
            businessType: editForm.businessType || undefined,
          }),
        },
        fallbackMessage: 'No se pudieron guardar los cambios del restaurante.',
      });

      await loadRestaurantDetail();
      setAuthMessage('Cambios guardados y ficha sincronizada.');
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'No se pudieron guardar los cambios del restaurante.'
      );
    } finally {
      setSavingRestaurant(false);
    }
  }

  async function updateRestaurantStatus(nextStatus: RestaurantStatus) {
    const normalizedReason = statusReasonDraft.trim();
    const requiresReason = nextStatus === 'SUSPENDED' || nextStatus === 'DELETED';

    if (requiresReason && !normalizedReason) {
      setError('Captura un motivo antes de suspender o eliminar el restaurante.');
      return;
    }

    const confirmationMessage =
      nextStatus === 'DELETED'
        ? 'Esta accion marcara el restaurante como eliminado. ¿Deseas continuar?'
        : nextStatus === 'SUSPENDED'
          ? '¿Deseas suspender este restaurante?'
          : '¿Deseas activar nuevamente este restaurante?';

    if (!window.confirm(confirmationMessage)) {
      return;
    }

    setActiveStatusUpdate(nextStatus);
    setError('');
    setAuthMessage('');

    try {
      await requestJson<{ success: true; data: RestaurantDetail }>({
        apiBase,
        path: `/admin/restaurantes/${restaurantId}/status`,
        token,
        options: {
          method: 'POST',
          body: JSON.stringify({
            status: nextStatus,
            reason: normalizedReason || undefined,
          }),
        },
        fallbackMessage: 'No se pudo actualizar el estado del restaurante.',
      });

      await loadRestaurantDetail();
      setStatusReasonDraft('');
      setAuthMessage(`Estado actualizado a ${statusLabelMap[nextStatus]}.`);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'No se pudo actualizar el estado del restaurante.'
      );
    } finally {
      setActiveStatusUpdate(null);
    }
  }

  async function settleRestaurantDebt() {
    setSettlingBilling(true);
    setError('');
    setAuthMessage('');

    try {
      await requestJson<{ success: true; data: { settlement: RestaurantSettlement } }>({
        apiBase,
        path: `/admin/restaurantes/${restaurantId}/billing/settle`,
        token,
        options: {
          method: 'POST',
          body: JSON.stringify({}),
        },
        fallbackMessage: 'No se pudo liquidar la deuda del restaurante.',
      });

      await loadRestaurantDetail();
      setAuthMessage('Corte generado correctamente.');
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'No se pudo liquidar la deuda del restaurante.'
      );
    } finally {
      setSettlingBilling(false);
    }
  }

  async function confirmSettlementPayment(settlementId: string) {
    if (!window.confirm('¿Confirmas que el restaurante ya pago este corte?')) {
      return;
    }

    setError('');
    setAuthMessage('');

    try {
      await requestJson<{ success: true }>({
        apiBase,
        path: `/admin/billing/settlements/${settlementId}/confirm`,
        token,
        options: {
          method: 'POST',
          body: JSON.stringify({}),
        },
        fallbackMessage: 'No se pudo confirmar el pago.',
      });

      await loadRestaurantDetail();
      setAuthMessage('Pago confirmado correctamente.');
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'No se pudo confirmar el pago.'
      );
    }
  }

  async function rejectSettlementPayment(settlementId: string) {
    if (!window.confirm('¿Rechazar este comprobante de pago? El corte volvera a estar pendiente.')) {
      return;
    }

    setError('');
    setAuthMessage('');

    try {
      await requestJson<{ success: true }>({
        apiBase,
        path: `/admin/billing/settlements/${settlementId}/reject`,
        token,
        options: {
          method: 'POST',
          body: JSON.stringify({}),
        },
        fallbackMessage: 'No se pudo rechazar el pago.',
      });

      await loadRestaurantDetail();
      setAuthMessage('Pago rechazado correctamente.');
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'No se pudo rechazar el pago.'
      );
    }
  }

  function downloadPaymentOrder(currentRestaurant: RestaurantDetail) {
    const billing = currentRestaurant.billingSummary;
    const content = [
      'SaDeL - Orden de pago por uso de plataforma',
      '',
      `Restaurante: ${currentRestaurant.name}`,
      `Responsable: ${currentRestaurant.user.name}`,
      `Usuario: ${currentRestaurant.user.phone}`,
      `Ciclo: ${formatBillingCycle(billing.billingCycle)}`,
      `Periodo: ${formatDateOnly(billing.periodStart)} al ${formatDateOnly(billing.periodEnd)}`,
      `Pedidos entregados: ${billing.deliveredOrders}`,
      `Ingreso entregado: ${formatCurrency(billing.deliveredRevenue)}`,
      `Servicio cobrado a clientes: ${formatCurrency(billing.serviceFeeRevenue)}`,
      ...(billing.whatsappFeeRevenue > 0
        ? [`Notificaciones WhatsApp: ${formatCurrency(billing.whatsappFeeRevenue)}`]
        : []),
      `Deuda actual: ${formatCurrency(billing.currentDebt)}`,
      `Siguiente corte: ${formatDateOnly(billing.nextChargeDate)}`,
      '',
      `Fecha de emision: ${formatDateOnly(new Date().toISOString())}`,
    ].join('\n');

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `orden-pago-${currentRestaurant.name.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const statusCountCards = useMemo(() => {
    if (!restaurant) {
      return [];
    }

    return [
      { label: 'Pedidos totales', value: String(restaurant.operationalStats.totalOrders) },
      { label: 'Entregados', value: String(restaurant.operationalStats.deliveredOrders) },
      { label: 'Ingresos Totales', value: formatCurrency(restaurant.operationalStats.totalRevenue) },
      { label: 'Ventas Reales', value: formatCurrency(restaurant.operationalStats.deliveredRevenue) },
    ];
  }, [restaurant]);

  const chartData = useMemo(() => {
    if (!restaurant?.weeklyPerformance) return [];
    return restaurant.weeklyPerformance;
  }, [restaurant]);

  if (!sessionReady) {
    return <PageLoader text="Preparando acceso administrativo..." />;
  }

  if (!adminUser || !token) {
    return (
      <main className="min-h-screen bg-[#f7f4ec] px-4 py-8 text-neutral-900 md:px-6">
        <div className="mx-auto max-w-3xl">
          <PanelCard title="Acceso requerido" subtitle="Sesion administrativa">
            <div className="space-y-4">
              <p className="text-sm leading-7 text-neutral-600">
                Esta ficha solo puede abrirse con una sesion administrativa valida. Vuelve al panel principal e inicia
                sesion para continuar.
              </p>

              <div className="flex flex-wrap gap-3">
                <Link
                  href="/?section=restaurants"
                  className="rounded-full bg-neutral-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-neutral-800"
                >
                  Volver al admin
                </Link>
              </div>
            </div>
          </PanelCard>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f4ec]">
      <header className="sticky top-0 z-40 w-full border-b border-black/5 bg-white/92 backdrop-blur">
        <div className="grid grid-cols-[56px_1fr_56px] items-center px-3 py-4 md:px-6 lg:grid-cols-[220px_1fr_220px]">
          <div className="mx-auto w-full max-w-[1540px] contents">
            <div className="flex items-center">
              <SaDelLogo className="hidden h-10 w-auto lg:block" />
            </div>
            <div className="px-3 text-center">
              <p className="truncate text-lg font-semibold tracking-[-0.03em] text-neutral-950 md:text-2xl">
                Panel de control
              </p>
            </div>
            <div className="flex items-center justify-end" />
          </div>
        </div>
      </header>

      <div className="flex min-h-[calc(100vh-5rem)] w-full bg-transparent">
        <aside className="fixed left-0 top-[5rem] hidden h-[calc(100vh-5rem)] w-[260px] border-r border-black/5 bg-[#fbfbf8] lg:flex lg:flex-col">
          <div className="flex-1 overflow-y-auto px-4 py-6">
            <div className="rounded-[28px] border border-black/5 bg-[linear-gradient(180deg,#ffffff_0%,#f5f2ea_100%)] p-4 shadow-[0_16px_45px_rgba(15,15,15,0.04)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-neutral-400">Sesion admin</p>
              <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-neutral-950">{adminUser?.name || 'Administrator'}</p>
              <p className="mt-1 text-sm text-neutral-500">{adminUser?.region || 'SV-SS'}</p>
            </div>
            <nav className="mt-6 grid gap-2">
              <Link href="/?section=dashboard" className="flex items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition text-neutral-700 hover:bg-white"><svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="4" y="5" width="7" height="6" rx="1.5" strokeWidth={1.7}></rect><rect x="13" y="5" width="7" height="6" rx="1.5" strokeWidth={1.7}></rect><rect x="4" y="13" width="7" height="6" rx="1.5" strokeWidth={1.7}></rect><rect x="13" y="13" width="7" height="6" rx="1.5" strokeWidth={1.7}></rect></svg>Dashboard</Link>
              <Link href="/?section=orders" className="flex items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition text-neutral-700 hover:bg-white"><svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M3 6h18"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M16 10a4 4 0 0 1-8 0"></path></svg>Pedidos en Vivo</Link>
              <Link href="/?section=restaurants" className="flex items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition bg-neutral-950 text-white"><svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M5 10h14v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-8Z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M4 10V7l2-3h12l2 3v3"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M9 14h6"></path></svg>Restaurantes</Link>
              <Link href="/?section=drivers" className="flex items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition text-neutral-700 hover:bg-white"><svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="8" cy="17" r="2" strokeWidth={1.7}></circle><circle cx="17" cy="17" r="2" strokeWidth={1.7}></circle><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M3 7h11v8H3zM14 10h3l3 3v2h-2"></path></svg>Repartidores</Link>
              <Link href="/?section=users" className="flex items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition text-neutral-700 hover:bg-white"><svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="8" r="3.2" strokeWidth={1.7}></circle><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M5 19a7 7 0 0 1 14 0"></path></svg>Comensales</Link>
              <Link href="/?section=requests" className="flex items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition text-neutral-700 hover:bg-white"><svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2Z"></path></svg>Solicitudes</Link>
              <Link href="/?section=support" className="flex items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition text-neutral-700 hover:bg-white"><svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M3 18v-6a9 9 0 0 1 18 0v6"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path></svg>Soporte</Link>
              <Link href="/?section=customer-debts" className="flex items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition text-neutral-700 hover:bg-white"><svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="6" width="18" height="13" rx="2" strokeWidth={1.7}></rect><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M3 10h18"></path><circle cx="8" cy="14" r="1" fill="currentColor"></circle></svg>Deuda de Clientes</Link>
              <Link href="/?section=promotions" className="flex items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition text-neutral-700 hover:bg-white"><svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7" strokeWidth={2.5} strokeLinecap="round"></line></svg>Promociones</Link>
              <Link href="/?section=billboards" className="flex items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition text-neutral-700 hover:bg-white"><svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="2" y="6" width="20" height="12" rx="2" strokeWidth={1.7}></rect><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 6v12"></path></svg>Publicidad</Link>
              <Link href="/?section=featured" className="flex items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition text-neutral-700 hover:bg-white"><svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"><polygon strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"></polygon></svg>Destacados</Link>
              <Link href="/?section=notifications" className="flex items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition text-neutral-700 hover:bg-white"><svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>Notificaciones</Link>
              <Link href="/?section=stuck" className="flex items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition text-neutral-700 hover:bg-white"><svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9" strokeWidth={1.7}></circle><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 7v5l3 3"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 8V4m0 0l-2 2m2-2l2 2"></path></svg>Entregas Atascadas</Link>
              <Link href="/?section=settings" className="flex items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition text-neutral-700 hover:bg-white"><svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 4v3m0 10v3m8-8h-3M7 12H4"></path><circle cx="12" cy="12" r="4" strokeWidth={1.7}></circle></svg>Configuracion</Link>
            </nav>
          </div>
        </aside>

        <main className="flex-1 lg:pl-[260px] px-4 py-4 text-neutral-900 md:px-6">
          <div className="mx-auto max-w-[1540px] space-y-6">
        <header className="sticky top-0 z-40 rounded-[28px] border border-black/5 bg-white/92 px-4 py-4 backdrop-blur md:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/?section=restaurants"
                className="inline-flex items-center rounded-full border border-black/10 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-800 transition hover:bg-neutral-50"
              >
                Volver a restaurantes
              </Link>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-neutral-400">
                  Ficha administrativa
                </p>
                <p className="mt-1 text-xl font-semibold tracking-[-0.03em] text-neutral-950 md:text-2xl">
                  {restaurant?.name || 'Detalle del restaurante'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                clearStoredSession('sadel.admin');
                window.location.href = '/';
              }}
              className="rounded-full border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-800 transition hover:bg-rose-100 flex items-center gap-2"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Cerrar sesión
            </button>
          </div>
        </header>


        {error ? <Callout tone="danger">{error}</Callout> : null}

        {loadingDetail ? (
          <PageLoader text="Cargando detalle operativo del restaurante..." />
        ) : restaurant && editForm ? (
          <>
            <section className="overflow-hidden rounded-[32px] border border-black/5 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,246,242,0.96))] p-5 shadow-[0_20px_70px_rgba(15,15,15,0.06)] backdrop-blur md:p-6">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                <div className="max-w-3xl">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-neutral-400">
                    Restaurante seleccionado
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <h1 className="text-[2rem] font-semibold tracking-[-0.05em] text-neutral-950 md:text-[2.3rem]">
                      {restaurant.name}
                    </h1>
                    <StatusPill status={restaurant.status} />
                    <RestaurantBillingStatusPill restaurant={restaurant} />
                    {restaurant.businessType && restaurant.businessType !== 'RESTAURANT' && (
                      <span className="rounded-full bg-violet-50 px-3 py-1 text-[11px] font-bold text-violet-700 ring-1 ring-violet-200/50">
                        {businessTypeLabel(restaurant.businessType)}
                      </span>
                    )}
                  </div>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-500">{restaurant.description}</p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <InfoRow label="Region" value={restaurant.region} />
                  <InfoRow label="Responsable" value={restaurant.user.name} />
                </div>
              </div>
            </section>

            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {statusCountCards.map((item) => (
                <StatsMini key={item.label} label={item.label} value={item.value} />
              ))}
            </section>

            <section className="grid gap-6 xl:grid-cols-2">
              <div className="space-y-6">
                <PanelCard title="Resumen operativo" subtitle="Identidad y contacto">
                  <div className="grid gap-3 md:grid-cols-2">
                    <InfoRow label="Telefono owner" value={restaurant.user.phone} />
                    <InfoRow label="Correo owner" value={restaurant.user.email} />
                    <InfoRow label="Telefono negocio" value={restaurant.contactPhone} />
                    <InfoRow label="Correo negocio" value={restaurant.email} />
                    <InfoRow
                      label="Tarifa servicio"
                      value={formatCurrency(restaurant.serviceFee || 0)}
                    />
                    <InfoRow
                      label="Delivery"
                      value={formatDeliverySummary(restaurant.hasOwnDelivery, restaurant.effectiveDeliveryFee)}
                    />
                    <InfoRow
                      label="Ventana"
                      value={`${restaurant.minDeliveryTime}-${restaurant.maxDeliveryTime} min`}
                    />
                  </div>
                  <div className="mt-4 rounded-[24px] border border-black/5 bg-neutral-50 p-4 text-sm leading-7 text-neutral-700">
                    {restaurant.address}
                  </div>
                </PanelCard>

                <PanelCard title="Edicion administrativa" subtitle="Operacion del restaurante">
                  <form onSubmit={saveRestaurantChanges} className="space-y-5">
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field
                        label="Nombre del restaurante"
                        value={editForm.name}
                        onChange={(value) => setEditForm((current) => (current ? { ...current, name: value } : current))}
                        placeholder="Nombre del restaurante"
                      />
                      <Field
                        label="Region"
                        value={editForm.region}
                        onChange={(value) =>
                          setEditForm((current) => (current ? { ...current, region: value } : current))
                        }
                        placeholder="cdmx-centro"
                      />
                      <Field
                        label="Responsable"
                        value={editForm.ownerName}
                        onChange={(value) =>
                          setEditForm((current) => (current ? { ...current, ownerName: value } : current))
                        }
                        placeholder="Nombre del owner"
                      />
                      <Field
                        label="Telefono owner"
                        value={editForm.ownerPhone}
                        onChange={(value) =>
                          setEditForm((current) => (current ? { ...current, ownerPhone: value } : current))
                        }
                        placeholder="+5215512345678"
                      />
                      <Field
                        label="Correo owner"
                        value={editForm.ownerEmail}
                        onChange={(value) =>
                          setEditForm((current) => (current ? { ...current, ownerEmail: value } : current))
                        }
                        placeholder="owner@sadel.app"
                      />
                      <Field
                        label="Telefono negocio"
                        value={editForm.contactPhone}
                        onChange={(value) =>
                          setEditForm((current) => (current ? { ...current, contactPhone: value } : current))
                        }
                        placeholder="+5215510101010"
                      />
                      <Field
                        label="Correo negocio"
                        value={editForm.email}
                        onChange={(value) =>
                          setEditForm((current) => (current ? { ...current, email: value } : current))
                        }
                        placeholder="restaurante@sadel.app"
                      />
                      <Field
                        label="Tarifa de servicio"
                        value={editForm.serviceFee}
                        onChange={(value) =>
                          setEditForm((current) => (current ? { ...current, serviceFee: value } : current))
                        }
                        placeholder="5"
                      />
                      <Field
                        label="Direccion"
                        value={editForm.address}
                        onChange={(value) =>
                          setEditForm((current) => (current ? { ...current, address: value } : current))
                        }
                        placeholder="Av. Juarez 15"
                      />
                      <Field
                        label="Min entrega"
                        value={editForm.minDeliveryTime}
                        onChange={(value) =>
                          setEditForm((current) => (current ? { ...current, minDeliveryTime: value } : current))
                        }
                        placeholder="25"
                      />
                      <Field
                        label="Max entrega"
                        value={editForm.maxDeliveryTime}
                        onChange={(value) =>
                          setEditForm((current) => (current ? { ...current, maxDeliveryTime: value } : current))
                        }
                        placeholder="45"
                      />
                      <label className="grid gap-1.5 text-sm">
                        <span className="font-semibold tracking-tight text-neutral-800">Ciclo de cobro</span>
                        <select
                          value={editForm.billingCycle}
                          onChange={(event) =>
                            setEditForm((current) =>
                              current ? { ...current, billingCycle: event.target.value as BillingCycle } : current
                            )
                          }
                          className="w-full rounded-2xl border-none bg-neutral-100/50 px-4 py-3 text-neutral-900 outline-none ring-1 ring-inset ring-black/5 transition focus:bg-white focus:ring-2 focus:ring-black/10"
                        >
                          <option value="WEEKLY">Semanal</option>
                          <option value="MONTHLY">Mensual</option>
                        </select>
                      </label>
                      <label className="grid gap-1.5 text-sm">
                        <span className="font-semibold tracking-tight text-neutral-800">Tipo de negocio</span>
                          <select
                            value={editForm.businessType || 'RESTAURANT'}
                            onChange={(event) =>
                              setEditForm((current) =>
                                current ? { ...current, businessType: event.target.value as BusinessType } : current
                              )
                            }
                            className="w-full rounded-2xl border-none bg-neutral-100/50 px-4 py-3 text-neutral-900 outline-none ring-1 ring-inset ring-black/5 transition focus:bg-white focus:ring-2 focus:ring-black/10"
                          >
                            <option value="RESTAURANT">Restaurante</option>
                            <option value="STORE">Tienda</option>
                          </select>
                      </label>
                      <Field
                        label="Tarifa de uso (Fija / Pesos)"
                        value={editForm.platformFeePerOrder}
                        onChange={(value) =>
                          setEditForm((current) =>
                            current
                              ? {
                                  ...current,
                                  platformFeePerOrder: value,
                                  ...(value.trim() ? { platformFeeRate: '' } : {}),
                                }
                              : current
                          )
                        }
                        placeholder="15.00"
                      />
                      <Field
                        label="Tarifa de uso (Porcentaje)"
                        value={editForm.platformFeeRate}
                        onChange={(value) =>
                          setEditForm((current) =>
                            current
                              ? {
                                  ...current,
                                  platformFeeRate: value,
                                  ...(value.trim() ? { platformFeePerOrder: '' } : {}),
                                }
                              : current
                          )
                        }
                        placeholder="5 = 5%"
                      />
                      <p className="text-xs leading-5 text-neutral-500">
                        Tarifas de uso mutuamente excluyentes: el porcentaje se calcula solo sobre el
                        subtotal neto de los productos (sin envío ni tarifa de servicio).
                      </p>
                      <Field
                        label="Correo de facturacion"
                        value={editForm.billingContactEmail}
                        onChange={(value) =>
                          setEditForm((current) =>
                            current ? { ...current, billingContactEmail: value } : current
                          )
                        }
                        placeholder="pagos@restaurante.com"
                      />
                    </div>

                    <label className="flex items-center gap-3 rounded-2xl border border-sky-200/70 bg-sky-50/50 px-4 py-3 text-sm text-neutral-700">
                      <input
                        type="checkbox"
                        checked={editForm.pickupOnly === true}
                        onChange={(event) =>
                          setEditForm((current) =>
                            current
                              ? {
                                  ...current,
                                  pickupOnly: event.target.checked,
                                  hasOwnDelivery: event.target.checked ? false : current.hasOwnDelivery,
                                  supportsNetworkDelivery: event.target.checked ? false : current.supportsNetworkDelivery,
                                }
                              : current
                          )
                        }
                        className="h-4 w-4 rounded border-sky-300"
                      />
                      <span>
                        <span className="font-semibold text-neutral-900">Solo recoger en tienda</span>
                        <span className="block text-xs text-neutral-500">No entrega a domicilio; solo recogida en el local. Desactiva reparto propio y apoyo a la red.</span>
                      </span>
                    </label>

                    {!editForm.pickupOnly ? (
                      <>
                    <label className="flex items-center gap-3 rounded-2xl border border-black/10 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
                      <input
                        type="checkbox"
                        checked={editForm.hasOwnDelivery}
                        onChange={(event) =>
                          setEditForm((current) =>
                            current ? { ...current, hasOwnDelivery: event.target.checked } : current
                          )
                        }
                        className="h-4 w-4 rounded border-black/20"
                      />
                      <span>El restaurante maneja su propio delivery</span>
                    </label>

                    {editForm.hasOwnDelivery && (
                      <label className="flex items-center gap-3 rounded-2xl border border-sky-200/60 bg-sky-50/50 px-4 py-3 text-sm text-neutral-700">
                        <input
                          type="checkbox"
                          checked={editForm.supportsNetworkDelivery !== false}
                          onChange={(event) =>
                            setEditForm((current) =>
                              current ? { ...current, supportsNetworkDelivery: event.target.checked } : current
                            )
                          }
                          className="h-4 w-4 rounded border-sky-300"
                        />
                        <span>
                          <span className="font-semibold text-neutral-900">Presta apoyo a la red</span>
                          <span className="block text-xs text-neutral-500">Ayuda a otros restaurantes a entregar pedidos cercanos.</span>
                        </span>
                      </label>
                    )}

                    {editForm.hasOwnDelivery ? (
                      <>
                        <div>
                          <span className="font-semibold tracking-tight text-neutral-800">Tipo de tarifa</span>
                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            <button
                              type="button"
                              onClick={() =>
                                setEditForm((current) => (current ? { ...current, deliveryPricingModel: 'fixed' } : current))
                              }
                              className={`rounded-2xl border px-4 py-3 text-left text-sm transition-all ${editForm.deliveryPricingModel !== 'distance' ? 'border-sky-400 bg-sky-50 ring-4 ring-sky-400/15' : 'border-black/10 bg-white hover:border-black/20'}`}
                            >
                              <span className={`font-bold ${editForm.deliveryPricingModel !== 'distance' ? 'text-sky-700' : 'text-neutral-900'}`}>Tarifa fija</span>
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setEditForm((current) => (current ? { ...current, deliveryPricingModel: 'distance' } : current))
                              }
                              className={`rounded-2xl border px-4 py-3 text-left text-sm transition-all ${editForm.deliveryPricingModel === 'distance' ? 'border-sky-400 bg-sky-50 ring-4 ring-sky-400/15' : 'border-black/10 bg-white hover:border-black/20'}`}
                            >
                              <span className={`font-bold ${editForm.deliveryPricingModel === 'distance' ? 'text-sky-700' : 'text-neutral-900'}`}>Tarifa dinámica por distancia</span>
                            </button>
                          </div>
                        </div>
                        {editForm.deliveryPricingModel === 'distance' ? (
                          <div className="grid gap-4 md:grid-cols-2">
                            <Field
                              label="Tarifa base (1er km)"
                              value={editForm.deliveryBaseRate}
                              onChange={(value) =>
                                setEditForm((current) => (current ? { ...current, deliveryBaseRate: value } : current))
                              }
                              placeholder="20"
                            />
                            <Field
                              label="Por km adicional"
                              value={editForm.deliveryPerKmRate}
                              onChange={(value) =>
                                setEditForm((current) => (current ? { ...current, deliveryPerKmRate: value } : current))
                              }
                              placeholder="8"
                            />
                            <Field
                              label="Tarifa mínima"
                              value={editForm.deliveryMinFee}
                              onChange={(value) =>
                                setEditForm((current) => (current ? { ...current, deliveryMinFee: value } : current))
                              }
                              placeholder="15"
                            />
                            <Field
                              label="Tarifa máxima"
                              value={editForm.deliveryMaxFee}
                              onChange={(value) =>
                                setEditForm((current) => (current ? { ...current, deliveryMaxFee: value } : current))
                              }
                              placeholder="150"
                            />
                          </div>
                        ) : (
                          <div className="md:max-w-xs">
                            <Field
                              label="Tarifa delivery"
                              value={editForm.deliveryFee}
                              onChange={(value) =>
                                setEditForm((current) => (current ? { ...current, deliveryFee: value } : current))
                              }
                              placeholder="35"
                            />
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-800">
                        Este restaurante usa repartidores SaDeL. La tarifa visible para cliente se toma desde la region
                        configurada en admin.
                      </div>
                    )}
                      </>
                    ) : (
                      <div className="rounded-2xl border border-sky-200 bg-sky-50/60 px-4 py-3 text-sm leading-6 text-sky-800">
                        🛍️ Este restaurante solo ofrece recoger en tienda. No se muestran opciones de entrega a domicilio.
                      </div>
                    )}

                    <div className="md:max-w-xs">
                      <Field
                        label="Monto máximo pago en efectivo"
                        value={editForm.maxCashOrder}
                        onChange={(value) =>
                          setEditForm((current) => (current ? { ...current, maxCashOrder: value } : current))
                        }
                        placeholder="500"
                      />
                    </div>

                    <label className="grid gap-1.5 text-sm">
                      <span className="font-semibold tracking-tight text-neutral-800">Descripcion</span>
                      <textarea
                        value={editForm.description}
                        onChange={(event) =>
                          setEditForm((current) =>
                            current ? { ...current, description: event.target.value } : current
                          )
                        }
                        rows={4}
                        className="w-full rounded-2xl border-none bg-neutral-100/50 px-4 py-3 text-neutral-900 outline-none ring-1 ring-inset ring-black/5 transition focus:bg-white focus:ring-2 focus:ring-black/10"
                      />
                    </label>

                    <div className="flex flex-wrap gap-3">
                      <button
                        type="submit"
                        disabled={savingRestaurant}
                        className="rounded-full bg-neutral-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
                      >
                        {savingRestaurant ? 'Guardando cambios...' : 'Guardar cambios'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditForm(createEditFormState(restaurant))}
                        disabled={savingRestaurant}
                        className="rounded-full border border-black/10 px-4 py-3 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:border-black/5 disabled:text-neutral-400"
                      >
                        Restablecer formulario
                      </button>
                    </div>
                  </form>
                </PanelCard>

                <PanelCard title="Facturacion" subtitle="Deuda por uso de app">
                  <div className="rounded-[28px] border border-amber-200 bg-[linear-gradient(180deg,#fffdf8_0%,#f7f1e6_100%)] p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-3xl font-semibold tracking-[-0.04em] text-neutral-950">
                          {formatCurrency(restaurant.billingSummary.currentDebt)}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-neutral-600">
                          Deuda total acumulada — incluye cortes anteriores pendientes más comisiones del periodo actual.
                        </p>
                      </div>
                      <span className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 shadow-sm">
                        {formatCurrency(restaurant.billingSummary.serviceFeeRevenue + restaurant.billingSummary.platformFeeRevenue + restaurant.billingSummary.whatsappFeeRevenue)}
                      </span>
                    </div>

                    <div className="mt-4 space-y-2">
                      <div className="flex items-center justify-between rounded-2xl bg-amber-50/70 px-4 py-2.5 ring-1 ring-amber-200/50">
                        <span className="text-[13px] font-medium text-neutral-500">Deuda pendiente</span>
                        <span className="text-[14px] font-semibold tracking-tight text-neutral-900">
                          {formatCurrency(restaurant.billingSummary.pastDebt)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between rounded-2xl bg-sky-50/50 px-4 py-2.5 ring-1 ring-sky-200/40">
                        <span className="text-[13px] font-medium text-neutral-500">Deuda acumulada</span>
                        <span className="text-[14px] font-semibold tracking-tight text-neutral-900">
                          {formatCurrency(restaurant.billingSummary.serviceFeeRevenue + restaurant.billingSummary.platformFeeRevenue + restaurant.billingSummary.whatsappFeeRevenue)}
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3">
                      <InfoRow
                        label="Periodo actual"
                        value={`${formatDateOnly(restaurant.billingSummary.periodStart)} - ${formatDateOnly(restaurant.billingSummary.periodEnd)}`}
                      />
                      <InfoRow
                        label="Pedidos cobrables"
                        value={String(restaurant.billingSummary.deliveredOrders)}
                      />
                      <InfoRow
                        label="Base por servicio (clientes)"
                        value={formatCurrency(restaurant.billingSummary.serviceFeeRevenue)}
                      />
                      <InfoRow
                        label="Comisión de plataforma"
                        value={formatCurrency(restaurant.billingSummary.platformFeeRevenue)}
                      />
                      {restaurant.billingSummary.whatsappFeeRevenue > 0 && (
                        <InfoRow
                          label="Notificaciones WhatsApp"
                          value={formatCurrency(restaurant.billingSummary.whatsappFeeRevenue)}
                        />
                      )}
                      <InfoRow
                        label="Siguiente corte"
                        value={formatDateOnly(restaurant.billingSummary.nextChargeDate)}
                      />
                    </div>

                    <div className="mt-4 flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => downloadPaymentOrder(restaurant)}
                        className="rounded-full border border-black/10 bg-white px-4 py-3 text-sm font-semibold text-neutral-800 transition hover:bg-neutral-100"
                      >
                        Descargar orden de pago
                      </button>
                       <button
                        type="button"
                        onClick={() => void settleRestaurantDebt()}
                        disabled={settlingBilling || restaurant.billingSummary.currentDebt <= 0}
                        className="rounded-full bg-neutral-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
                      >
                        {settlingBilling ? 'Generando...' : 'Generar Corte'}
                      </button>
                    </div>
                  </div>
                </PanelCard>

                <PanelCard title="Liquidaciones recientes" subtitle="Historial de cobro">
                  {restaurant.recentSettlements.length > 0 ? (
                    <div className="grid gap-3">
                      {restaurant.recentSettlements.map((settlement) => {
                        // Logica robusta para data inconsistente de seeders
                        let derivedStatus = settlement.status;
                        if (derivedStatus === 'PAID' && !settlement.settledAt) {
                          derivedStatus = 'PENDING';
                        }
                        if (derivedStatus === 'PENDING' && settlement.dueDate && new Date(settlement.dueDate) < new Date()) {
                          derivedStatus = 'OVERDUE';
                        }

                        return (
                        <div
                          key={settlement.id}
                          className={`rounded-[24px] border p-4 text-sm text-neutral-700 ${
                            derivedStatus === 'PENDING'
                              ? 'border-amber-200 bg-amber-50'
                              : derivedStatus === 'IN_REVIEW'
                                ? 'border-sky-200 bg-sky-50'
                                : derivedStatus === 'OVERDUE'
                                  ? 'border-rose-200 bg-rose-50'
                                  : 'border-black/5 bg-neutral-50'
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="font-semibold text-neutral-950">{formatSettlementReference(settlement.reference)}</p>
                              <p className="text-xs text-neutral-500">
                                {formatDateOnly(settlement.periodStart)} - {formatDateOnly(settlement.periodEnd)}
                              </p>
                            </div>
                            <div className="text-right">
                              <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-neutral-700 shadow-sm">
                                {formatCurrency(settlement.amount)}
                              </span>
                              <p className="mt-1 text-[10px] text-neutral-500">
                                Serv: {formatCurrency(settlement.serviceFeeTotal)} | Plat: {formatCurrency(settlement.platformFeeTotal)}{(settlement.whatsappFeeTotal ?? 0) > 0 ? ` | WhatsApp: ${formatCurrency(settlement.whatsappFeeTotal ?? 0)}` : ''}
                              </p>
                            </div>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                            <div>
                              {derivedStatus === 'PENDING' ? (
                                <p className="text-xs font-medium text-amber-700">
                                  Pendiente (Vence: {settlement.dueDate ? formatDateOnly(settlement.dueDate) : '--'})
                                </p>
                              ) : derivedStatus === 'IN_REVIEW' ? (
                                <p className="text-xs font-medium text-sky-700">
                                  En revisión (Comprobante enviado)
                                </p>
                              ) : derivedStatus === 'OVERDUE' ? (
                                <p className="text-xs font-medium text-rose-700">
                                  Vencido (Venció: {settlement.dueDate ? formatDateOnly(settlement.dueDate) : '--'})
                                </p>
                              ) : (
                                <p className="text-xs font-medium text-emerald-700">
                                  Pagado el {settlement.settledAt ? formatDateOnly(settlement.settledAt) : '--'}
                                </p>
                              )}
                            </div>
                            <div className="flex gap-2">
                              {settlement.paymentProofUrl && (
                                <button
                                  type="button"
                                  onClick={() => setProofUrlModal(settlement.paymentProofUrl || null)}
                                  className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-50 flex items-center gap-1"
                                >
                                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                  </svg>
                                  Comprobante
                                </button>
                              )}
                              {derivedStatus === 'PENDING' && (
                                <button
                                  type="button"
                                  onClick={() => void confirmSettlementPayment(settlement.id)}
                                  className="rounded-full bg-neutral-950 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-neutral-800"
                                >
                                  Confirmar Pago
                                </button>
                              )}
                              {derivedStatus === 'IN_REVIEW' && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => void confirmSettlementPayment(settlement.id)}
                                    className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700"
                                  >
                                    Confirmar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void rejectSettlementPayment(settlement.id)}
                                    className="rounded-full bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-700"
                                  >
                                    Rechazar
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      )})}
                    </div>
                  ) : (
                    <EmptyState text="Aun no hay liquidaciones registradas para este restaurante." compact />
                  )}
                </PanelCard>

                
              </div>

              <div className="space-y-6">
                <PanelCard title="Rendimiento Semanal" subtitle="Analytics">
                  <div className="h-[200px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorIngresos" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#737373' }} dy={10} />
                        <Tooltip
                          contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 40px -10px rgba(0,0,0,0.1)' }}
                          itemStyle={{ fontSize: '13px', fontWeight: 600 }}
                          labelStyle={{ fontSize: '11px', color: '#737373', textTransform: 'uppercase' }}
                        />
                        <Area type="monotone" dataKey="ingresos" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorIngresos)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </PanelCard>

                <PanelCard title="Calidad y Servicio" subtitle="Métricas">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-[24px] border border-black/5 bg-neutral-50 px-4 py-4 text-center">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400">Rating Promedio</p>
                      <div className="mt-2 flex items-center justify-center gap-1 text-2xl font-semibold text-neutral-900">
                        <span>0.0</span>
                        <svg className="h-5 w-5 text-neutral-300" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                      </div>
                    </div>
                    <div className="rounded-[24px] border border-rose-100 bg-rose-50/50 px-4 py-4 text-center">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-rose-400">Tasa Cancelación</p>
                      <p className="mt-2 text-2xl font-semibold text-neutral-400">0%</p>
                    </div>
                  </div>
                </PanelCard>

                

                <PanelCard title="Visibilidad en App" subtitle="Marketing">
                  <div className="grid gap-4">
                    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl bg-neutral-50/50 px-4 py-3 ring-1 ring-black/5 transition hover:bg-white hover:ring-black/10">
                      <div>
                        <span className="block text-[14px] font-semibold tracking-tight text-neutral-900">Boost de Posicionamiento</span>
                        <span className="block text-[13px] font-medium text-neutral-500">Aumenta la prioridad en los resultados de busqueda (+20%).</span>
                      </div>
                      <div className="relative inline-flex h-6 w-11 items-center rounded-full bg-emerald-500 transition-colors">
                        <span className="inline-block h-4 w-4 translate-x-6 transform rounded-full bg-white transition-transform shadow-sm" />
                      </div>
                    </label>
                  </div>
                </PanelCard>

                <PanelCard title="Estado operativo" subtitle="Acciones rapidas">
                  <div className="grid gap-4">
                    <InfoRow label="Estado actual" value={statusLabelMap[restaurant.status]} />
                    <InfoRow
                      label="Ultimo cambio"
                      value={restaurant.statusChangedAt ? formatDateOnly(restaurant.statusChangedAt) : 'Sin registro'}
                    />
                    <label className="grid gap-2 text-sm text-neutral-600">
                      <span>Motivo administrativo</span>
                      <textarea
                        value={statusReasonDraft}
                        onChange={(event) => setStatusReasonDraft(event.target.value)}
                        placeholder="Obligatorio para suspender o eliminar."
                        rows={3}
                        className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-neutral-950 outline-none transition placeholder:text-neutral-400 focus:border-black/20"
                      />
                    </label>
                    {restaurant.statusReason ? (
                      <Callout tone={restaurant.status === 'ACTIVE' ? 'info' : 'danger'}>
                        Motivo vigente: {restaurant.statusReason}
                      </Callout>
                    ) : null}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-3">
                    {restaurant.status !== 'ACTIVE' ? (
                      <button
                        type="button"
                        onClick={() => void updateRestaurantStatus('ACTIVE')}
                        disabled={activeStatusUpdate === 'ACTIVE'}
                        className="rounded-full bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-200"
                      >
                        {activeStatusUpdate === 'ACTIVE' ? 'Activando...' : 'Activar restaurante'}
                      </button>
                    ) : null}
                    {restaurant.status !== 'SUSPENDED' ? (
                      <button
                        type="button"
                        onClick={() => void updateRestaurantStatus('SUSPENDED')}
                        disabled={activeStatusUpdate === 'SUSPENDED'}
                        className="rounded-full border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {activeStatusUpdate === 'SUSPENDED' ? 'Suspendiendo...' : 'Suspender restaurante'}
                      </button>
                    ) : null}
                    {restaurant.status !== 'DELETED' ? (
                      <button
                        type="button"
                        onClick={() => void updateRestaurantStatus('DELETED')}
                        disabled={activeStatusUpdate === 'DELETED'}
                        className="rounded-full border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {activeStatusUpdate === 'DELETED' ? 'Eliminando...' : 'Eliminar restaurante'}
                      </button>
                    ) : null}
                  </div>
                </PanelCard>

                

                <PanelCard title="Horarios y estructura" subtitle="Operacion disponible">
                  <div className="grid gap-4 md:grid-cols-2">
                    <StatsMini label="Categorias" value={restaurant.categories.length.toString()} />
                    <StatsMini label="Horarios" value={restaurant.operatingHours.length.toString()} />
                  </div>
                  <div className="mt-4 grid gap-2">
                    {restaurant.operatingHours.length > 0 ? (
                      restaurant.operatingHours.map((schedule) => (
                        <div
                          key={`${schedule.dayOfWeek}-${schedule.openTime}`}
                          className="flex items-center justify-between gap-4 rounded-2xl bg-neutral-50 px-4 py-3 text-sm text-neutral-700"
                        >
                          <span>{dayLabelMap[schedule.dayOfWeek] || `Dia ${schedule.dayOfWeek}`}</span>
                          <span>{schedule.isClosed ? 'Cerrado' : `${schedule.openTime} - ${schedule.closeTime}`}</span>
                        </div>
                      ))
                    ) : (
                      <EmptyState text="Sin horarios configurados." compact />
                    )}
                  </div>
                </PanelCard>
              </div>
            </section>
          </>
        ) : (
          <PanelCard title="Sin datos" subtitle="Detalle del restaurante">
            <EmptyState text="No encontramos la ficha administrativa de este restaurante." />
          </PanelCard>
        )}
      </div>

      {proofUrlModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm">
          <div className="relative flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-[32px] bg-white shadow-2xl animate-scale-up">
            <div className="flex items-center justify-between border-b border-black/5 bg-neutral-50/50 px-6 py-4">
              <div>
                <h3 className="text-xl font-bold tracking-tight text-neutral-950">Comprobante de Pago</h3>
                <p className="mt-1 text-xs text-neutral-500">Documento subido por el restaurante para validar su pago.</p>
              </div>
              <button
                type="button"
                onClick={() => setProofUrlModal(null)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white border border-black/5 text-neutral-500 hover:bg-neutral-100 transition shadow-sm"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            
            <div className="relative flex flex-1 items-center justify-center overflow-auto bg-neutral-100/50 p-6 min-h-[40vh]">
              <img 
                src={proofUrlModal} 
                alt="Comprobante de pago" 
                className="max-h-[65vh] w-auto max-w-full rounded-xl object-contain shadow-md border border-black/5" 
              />
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-black/5 bg-white px-6 py-4">
              <button
                type="button"
                onClick={() => setProofUrlModal(null)}
                className="rounded-full px-5 py-2.5 text-sm font-semibold text-neutral-600 hover:bg-neutral-100 transition"
              >
                Cerrar
              </button>
              <a
                href={proofUrlModal}
                download={`Comprobante-${restaurant?.name || 'SaDeL'}.jpg`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-neutral-950 px-6 py-2.5 text-sm font-bold text-white transition hover:bg-neutral-800 shadow-lg shadow-neutral-900/20 active:scale-95"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Descargar Imagen
              </a>
            </div>
          </div>
        </div>
      )}
        </main>
      </div>
    </div>
  );
}

function PageLoader({ text }: { text: string }) {
  return (
    <main className="min-h-screen bg-[#f7f4ec] px-4 py-8 md:px-6">
      <div className="mx-auto max-w-3xl">
        <PanelCard title="Cargando" subtitle="SaDeL Admin">
          <EmptyState text={text} />
        </PanelCard>
      </div>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
}) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-semibold tracking-tight text-neutral-800">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-2xl border-none bg-neutral-100/50 px-4 py-3 text-neutral-900 outline-none ring-1 ring-inset ring-black/5 transition focus:bg-white focus:ring-2 focus:ring-black/10"
      />
    </label>
  );
}

function StatusPill({ status }: { status: RestaurantStatus }) {
  let text = 'Activo';
  let dotColor = 'bg-emerald-500';
  let glowColor = 'bg-emerald-500/30';
  let textColor = 'text-emerald-700';

  if (status === 'SUSPENDED') {
    text = 'Suspendido';
    dotColor = 'bg-amber-500';
    glowColor = 'bg-amber-500/30';
    textColor = 'text-amber-700';
  } else if (status === 'DELETED') {
    text = 'Eliminado';
    dotColor = 'bg-rose-500';
    glowColor = 'bg-rose-500/30';
    textColor = 'text-rose-700';
  }

  return (
    <div className="flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 ring-1 ring-black/5 shadow-sm">
      <div className="relative flex h-2 w-2 items-center justify-center">
        {status === 'ACTIVE' && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${glowColor}`} />}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${dotColor}`} />
      </div>
      <span className={`text-[10px] font-bold uppercase tracking-wider ${textColor}`}>
        {text}
      </span>
    </div>
  );
}

function RestaurantBillingStatusPill({ restaurant }: { restaurant: RestaurantDetail }) {
  let hasOverdue = false;
  let hasInReview = false;
  let hasPending = false;

  if (restaurant.recentSettlements) {
    hasOverdue = restaurant.recentSettlements.some((s) => s.status === 'OVERDUE' || (s.status === 'PENDING' && s.dueDate && new Date(s.dueDate) < new Date()));
    hasInReview = restaurant.recentSettlements.some((s) => s.status === 'IN_REVIEW');
    hasPending = restaurant.recentSettlements.some((s) => s.status === 'PENDING');
  }

  let text = 'Al día';
  let dotColor = 'bg-emerald-500';
  let glowColor = 'bg-emerald-500/30';
  let textColor = 'text-emerald-700';

  if (restaurant.status === 'SUSPENDED') {
    text = 'Suspendido';
    dotColor = 'bg-rose-500';
    glowColor = 'bg-rose-500/30';
    textColor = 'text-rose-700';
  } else if (hasOverdue) {
    text = 'Pago Vencido';
    dotColor = 'bg-red-500';
    glowColor = 'bg-red-500/30';
    textColor = 'text-red-700';
  } else if (hasInReview) {
    text = 'Por Confirmar';
    dotColor = 'bg-indigo-500';
    glowColor = 'bg-indigo-500/30';
    textColor = 'text-indigo-700';
  } else if (hasPending) {
    text = 'Corte Pendiente';
    dotColor = 'bg-amber-500';
    glowColor = 'bg-amber-500/30';
    textColor = 'text-amber-700';
  }

  return (
    <div className="flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 ring-1 ring-black/5 shadow-sm">
      <div className="relative flex h-2 w-2 items-center justify-center">
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${glowColor}`} />
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${dotColor}`} />
      </div>
      <span className={`text-[10px] font-bold uppercase tracking-wider ${textColor}`}>
        {text}
      </span>
    </div>
  );
}

function PanelCard({
  title,
  subtitle,
  aside,
  children,
}: {
  title: string;
  subtitle: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[32px] bg-white/70 p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-black/5 backdrop-blur-xl md:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400">{subtitle}</p>
          <h3 className="mt-1.5 text-2xl font-bold tracking-tight text-neutral-900">{title}</h3>
        </div>
        {aside && (
          <div className="inline-flex items-center rounded-full bg-neutral-100/80 px-3 py-1.5 text-xs font-semibold text-neutral-600 ring-1 ring-inset ring-black/5">
            {aside}
          </div>
        )}
      </div>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl bg-neutral-50/50 px-4 py-3 ring-1 ring-black/5 transition hover:bg-white hover:ring-black/10">
      <span className="text-[13px] font-medium text-neutral-500">{label}</span>
      <span className="text-[14px] font-semibold tracking-tight text-neutral-900 text-right">{value}</span>
    </div>
  );
}

function EmptyState({ text, compact = false }: { text: string; compact?: boolean }) {
  return (
    <div
      className={`rounded-3xl border border-dashed border-black/10 bg-neutral-50/30 px-6 text-center text-sm font-medium text-neutral-500 ${
        compact ? 'py-8' : 'py-12'
      }`}
    >
      {text}
    </div>
  );
}

function StatsMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="group relative overflow-hidden rounded-[26px] bg-white p-5 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] ring-1 ring-black/5 transition hover:-translate-y-0.5 hover:shadow-[0_8px_30px_-4px_rgba(0,0,0,0.1)]">
      <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br from-neutral-100 to-transparent opacity-50 blur-2xl transition group-hover:scale-150 group-hover:from-neutral-200" />
      <div className="relative">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400">{label}</p>
        <p className="mt-3 text-3xl font-semibold tracking-tight text-neutral-900">{value}</p>
      </div>
    </div>
  );
}

function Callout({
  tone,
  children,
}: {
  tone: 'info' | 'success' | 'danger';
  children: React.ReactNode;
}) {
  const tones = {
    info: 'bg-sky-50 text-sky-800 ring-sky-500/10',
    success: 'bg-emerald-50 text-emerald-800 ring-emerald-500/10',
    danger: 'bg-rose-50 text-rose-800 ring-rose-500/10',
  } satisfies Record<'info' | 'success' | 'danger', string>;

  return <div className={`rounded-2xl px-5 py-4 text-sm font-medium ring-1 ring-inset ${tones[tone]}`}>{children}</div>;
}

const statusLabelMap: Record<RestaurantStatus, string> = {
  ACTIVE: 'activo',
  SUSPENDED: 'suspendido',
  DELETED: 'eliminado',
};

const dayLabelMap: Record<number, string> = {
  0: 'Domingo',
  1: 'Lunes',
  2: 'Martes',
  3: 'Miercoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sabado',
};

const businessTypeLabel = (type: BusinessType): string => {
  return type === 'STORE' ? 'Tienda' : 'Restaurante';
};

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatSettlementReference(ref: string): string {
  if (!ref) return '';
  const parts = ref.split('-');
  if (parts[0] === 'SETTLE' && parts.length >= 5) {
    const cuid = parts[1];
    const year = parts[2].slice(-2);
    const month = parts[3].padStart(2, '0');
    const day = parts[4].padStart(2, '0');
    const suffix = cuid.slice(-6).toUpperCase();
    return `CRT-${year}${month}${day}-${suffix}`;
  }
  if (ref.startsWith('OP-') && parts.length >= 3) {
    const suffix = parts[1].toUpperCase();
    const timestamp = Number(parts[2]);
    if (!isNaN(timestamp)) {
      const date = new Date(timestamp);
      const year = date.getFullYear().toString().slice(-2);
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const day = date.getDate().toString().padStart(2, '0');
      return `OP-${year}${month}${day}-${suffix}`;
    }
  }
  return ref;
}

function formatDateOnly(value: string) {
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
  }).format(new Date(value));
}

function formatBillingCycle(cycle: BillingCycle) {
  return cycle === 'MONTHLY' ? 'Mensual' : 'Semanal';
}

function formatDeliverySummary(hasOwnDelivery: boolean, fee?: number | null) {
  const deliveryLabel = hasOwnDelivery ? 'Propio' : 'SaDeL';
  const normalizedFee = typeof fee === 'number' && Number.isFinite(fee) ? fee : 0;

  return `${deliveryLabel} · ${normalizedFee > 0 ? formatCurrency(normalizedFee) : 'Sin costo'}`;
}

function createEditFormState(restaurant: RestaurantDetail): RestaurantEditForm {
  return {
    ownerName: restaurant.user.name,
    ownerPhone: restaurant.user.phone,
    ownerEmail: restaurant.user.email,
    name: restaurant.name,
    description: restaurant.description,
    address: restaurant.address,
    region: restaurant.region,
    contactPhone: restaurant.contactPhone,
    email: restaurant.email,
    serviceFee: restaurant.serviceFee?.toString() || '0',
    hasOwnDelivery: restaurant.hasOwnDelivery,
    supportsNetworkDelivery: restaurant.supportsNetworkDelivery !== false,
    pickupOnly: restaurant.pickupOnly === true,
    deliveryFee: restaurant.deliveryFee?.toString() || '',
    deliveryPricingModel: restaurant.deliveryPricingModel === 'distance' ? 'distance' : 'fixed',
    deliveryBaseRate: restaurant.deliveryBaseRate != null ? String(restaurant.deliveryBaseRate) : '',
    deliveryPerKmRate: restaurant.deliveryPerKmRate != null ? String(restaurant.deliveryPerKmRate) : '',
    deliveryMinFee: restaurant.deliveryMinFee != null ? String(restaurant.deliveryMinFee) : '',
    deliveryMaxFee: restaurant.deliveryMaxFee != null ? String(restaurant.deliveryMaxFee) : '',
    maxCashOrder: restaurant.maxCashOrder != null ? String(restaurant.maxCashOrder) : '',
    minDeliveryTime: restaurant.minDeliveryTime.toString(),
    maxDeliveryTime: restaurant.maxDeliveryTime.toString(),
    billingCycle: restaurant.billingCycle,
    platformFeePerOrder: restaurant.platformFeePerOrder.toString(),
    platformFeeRate: restaurant.platformFeeRate > 0 ? String(Math.round(restaurant.platformFeeRate * 100)) : '',
    billingContactEmail: restaurant.billingContactEmail || restaurant.email,
    businessType: restaurant.businessType,
  };
}

function parseRequiredInteger(value: string): number {
  return Number.parseInt(value.trim(), 10);
}

function parseOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  return Number.parseFloat(trimmed);
}

function parseRequiredDecimal(value: string): number {
  const parsed = Number.parseFloat(value.trim());
  return Number.isNaN(parsed) ? 0 : parsed;
}
