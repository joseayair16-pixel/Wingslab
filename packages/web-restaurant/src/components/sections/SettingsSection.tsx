'use client';
import { Info, Settings2, Tag } from 'lucide-react';

import React, { useEffect, useState } from 'react';
import { requestJson } from '@sadel/shared';
import { getGoogleMaps } from '../../lib/googleMaps';
import { hasNativeOrderAlarm, isNativePlatform } from '../../lib/native';
import { CategoryIcon } from '../CategoryIcon';

type SuccessResponse<T> = {
  success: true;
  data: T;
};

type RestaurantProfile = {
  businessType?: string;
  status: string;
  isAcceptingOrders: boolean;
};

type PromoCodeItem = {
  id: string;
  code: string;
  description?: string | null;
  type: 'PERCENT' | 'AMOUNT' | 'FREE_DELIVERY' | 'FREE_PRODUCT';
  value: number;
  giftProductId?: string | null;
  minOrderAmount?: number | null;
  validFrom?: string | null;
  validUntil?: string | null;
  maxUses?: number | null;
  maxUsesPerCustomer?: number | null;
  firstPurchaseOnly?: boolean;
  usesCount: number;
  isActive: boolean;
  createdAt: string;
};

const PROMO_CODE_TYPE_LABELS: Record<PromoCodeItem['type'], { label: string; hint: string }> = {
  PERCENT: { label: 'Porcentaje (%)', hint: 'Descuenta un % del subtotal.' },
  AMOUNT: { label: 'Monto fijo ($)', hint: 'Descuenta una cantidad fija en pesos.' },
  FREE_DELIVERY: { label: 'Envío gratis', hint: 'Elimina el costo de envío del pedido.' },
  FREE_PRODUCT: { label: 'Producto gratis', hint: 'Regala 1 unidad de un producto eligiendo cuál en la primera compra.' },
};

const weekDayOptions = [
  { dayOfWeek: 0, label: 'Domingo' },
  { dayOfWeek: 1, label: 'Lunes' },
  { dayOfWeek: 2, label: 'Martes' },
  { dayOfWeek: 3, label: 'Miércoles' },
  { dayOfWeek: 4, label: 'Jueves' },
  { dayOfWeek: 5, label: 'Viernes' },
  { dayOfWeek: 6, label: 'Sábado' },
] as const;

const MAX_SHIFTS_PER_DAY = 2;

type HoursBlock = {
  dayOfWeek: number;
  shiftIndex: number;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
};

function hoursToMinutes(time?: string): number {
  if (!time) return NaN;
  const [h, m] = String(time).split(':').map(Number);
  return h * 60 + m;
}

function formatTime12h(time24h?: string): string {
  if (!time24h) return '';
  const [hStr, mStr] = time24h.split(':');
  let h = parseInt(hStr, 10);
  const ampm = h >= 12 ? 'p. m.' : 'a. m.';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${mStr} ${ampm}`;
}

function isOvernightShift(block: HoursBlock): boolean {
  return hoursToMinutes(block.closeTime) < hoursToMinutes(block.openTime);
}

function formatDaySummary(blocks: HoursBlock[]): string {
  return blocks
    .filter((b) => !b.isClosed)
    .map((b) => `${formatTime12h(b.openTime)} – ${formatTime12h(b.closeTime)}`)
    .join(' · ');
}

function normalizeSearchText(value?: string | null): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

interface SettingsSectionProps {
  profile: any;
  setProfile: (profile: any) => void;
  sessionUser: any;
  storeDraft: any;
  setStoreDraft: (draft: any) => void;
  platformCategories: any[];
  isSearchingAddress: boolean;
  addressSuggestions: any[];
  setAddressSuggestions: (suggestions: any[]) => void;
  placesServiceRef: React.MutableRefObject<any>;
  autocompleteSessionTokenRef: React.MutableRefObject<any>;
  ignoreAddressSearchRef: React.MutableRefObject<boolean>;
  settingsMapRef: React.MutableRefObject<any>;
  settingsMarkerRef: React.MutableRefObject<any>;
  operatingHoursDraft: any[];
  setOperatingHoursDraft: (draft: any) => void;
  savingOperatingHours: boolean;
  transferBankName: string;
  setTransferBankName: (value: string) => void;
  transferAccountNumber: string;
  setTransferAccountNumber: (value: string) => void;
  transferBeneficiaryName: string;
  setTransferBeneficiaryName: (value: string) => void;
  currentPasswordDraft: string;
  setCurrentPasswordDraft: (value: string) => void;
  newPasswordDraft: string;
  setNewPasswordDraft: (value: string) => void;
  confirmPasswordDraft: string;
  setConfirmPasswordDraft: (value: string) => void;
  savingPassword: boolean;
  isOrderAlertSoundEnabled: boolean;
  orderAlertAudioState: string;
  socketStatus: string;
  socketStatusLabel: string;
  socketAttempts: number;
  token: string;
  apiBase: string;
  activeSettingsTab: string;
  setActiveSettingsTab: (tab: string) => void;
  settingsTabs: any[];
  savingStoreProfile: boolean;
  saveStoreProfile: (section?: 'perfil' | 'ubicacion' | 'entrega' | 'pagos') => void;
  saveOperatingHours: () => void;
  savePasswordChange: () => void;
  handleOrderAlertSoundToggle: (checked: boolean) => void;
  // `force` se usa desde "Probar sonido de alerta" para que suene también
  // cuando la alarma nativa está disponible.
  playIncomingOrderAlert: (force?: boolean) => void;
  onEnablePush?: () => Promise<{ ok: boolean; reason?: string }>;
  pushToast: (tone: 'info' | 'success' | 'error', title: string, message: string) => void;
  businessTypeLabel: (type?: string | null) => string;
  Field: React.ComponentType<{ label: string; value: string; onChange: (value: string) => void; placeholder: string; type?: string; maxLength?: number }>;
  TextAreaField: React.ComponentType<{ label: string; value: string; onChange: (value: string) => void; placeholder: string }>;
  ToggleField: React.ComponentType<{ label: string; checked: boolean; onChange: (checked: boolean) => void; description?: string; disabled?: boolean; compact?: boolean; mobileCompact?: boolean }>;
}

export const SettingsSection = React.memo(function SettingsSection({
  profile,
  setProfile,
  sessionUser,
  storeDraft,
  setStoreDraft,
  platformCategories,

  isSearchingAddress,
  addressSuggestions,
  setAddressSuggestions,
  placesServiceRef,
  autocompleteSessionTokenRef,
  ignoreAddressSearchRef,
  settingsMapRef,
  settingsMarkerRef,
  operatingHoursDraft,
  setOperatingHoursDraft,
  savingOperatingHours,
  transferBankName,
  setTransferBankName,
  transferAccountNumber,
  setTransferAccountNumber,
  transferBeneficiaryName,
  setTransferBeneficiaryName,
  currentPasswordDraft,
  setCurrentPasswordDraft,
  newPasswordDraft,
  setNewPasswordDraft,
  confirmPasswordDraft,
  setConfirmPasswordDraft,
  savingPassword,
  isOrderAlertSoundEnabled,
  orderAlertAudioState,
  socketStatus,
  socketStatusLabel,
  socketAttempts,
  token,
  apiBase,
  activeSettingsTab,
  setActiveSettingsTab,
  settingsTabs,
  savingStoreProfile,
  saveStoreProfile,
  saveOperatingHours,
  savePasswordChange,
  handleOrderAlertSoundToggle,
    playIncomingOrderAlert,
    onEnablePush,
    pushToast,
  businessTypeLabel,
  Field,
  TextAreaField,
  ToggleField,
}: SettingsSectionProps) {
  const currentSettingsTab = settingsTabs.find((t: any) => t.key === activeSettingsTab) ?? settingsTabs[0];
  const [showWhatsappConfirm, setShowWhatsappConfirm] = React.useState(false);
  // Diagnóstico de notificaciones push (visible en el bloque Diagnóstico):
  // permite al restaurante verificar y re-activar la suscripción sin tocar el
  // banner superior (útil en Android PWA, donde el permiso live a nivel de SO).
  const [pushDiagPermission, setPushDiagPermission] = useState<NotificationPermission>('default');
  const [pushDiagSubscribed, setPushDiagSubscribed] = useState(false);
  // ¿El WebView ve el plugin de alarma continua? Sin él, la app se comporta
  // como web para los sonidos (Web Audio con bloqueo de autoplay).
  const [nativeAlarmAvailable, setNativeAlarmAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    const refresh = () => {
      setPushDiagPermission(Notification.permission);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready
          .then((reg) => reg.pushManager.getSubscription())
          .then((sub) => setPushDiagSubscribed(!!sub))
          .catch(() => {});
      }
    };
    refresh();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const onFocus = () => refresh();
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocus);
    };
  }, []);
  // Disponibilidad de la alarma nativa (solo APK): se re-evalúa al volver a
  // primer plano porque el bridge puede inyectarse tarde.
  useEffect(() => {
    if (!isNativePlatform()) return;
    const refreshAlarm = () => {
      try {
        setNativeAlarmAvailable(hasNativeOrderAlarm());
      } catch {
        setNativeAlarmAvailable(false);
      }
    };
    refreshAlarm();
    const onVisAlarm = () => {
      if (document.visibilityState === 'visible') refreshAlarm();
    };
    document.addEventListener('visibilitychange', onVisAlarm);
    window.addEventListener('focus', refreshAlarm);
    return () => {
      document.removeEventListener('visibilitychange', onVisAlarm);
      window.removeEventListener('focus', refreshAlarm);
    };
  }, []);
  // Ancho de papel térmico preferido (58mm/80mm). Se guarda en localStorage:
  // es una preferencia del DISPOSITIVO de impresión, no del restaurante en la nube.
  const [paperWidth, setPaperWidth] = useState<'58' | '80'>(() => {
    try {
      return window.localStorage.getItem('sadel.restaurant.paperWidth') === '58' ? '58' : '80';
    } catch {
      return '80';
    }
  });
  const [copySourceDay, setCopySourceDay] = useState(1);
  const [editingHoursDay, setEditingHoursDay] = useState<number | null>(null);
  const [categorySearch, setCategorySearch] = useState('');
  const [showAllCategories, setShowAllCategories] = useState(false);
  const hoursDraft = (operatingHoursDraft ?? []) as HoursBlock[];

  const [promoCodes, setPromoCodes] = useState<PromoCodeItem[]>([]);
  const [promoProducts, setPromoProducts] = useState<Array<{ id: string; name: string }>>([]);
  const [promoCodesLoading, setPromoCodesLoading] = useState(false);
  const [promoCodeModalOpen, setPromoCodeModalOpen] = useState(false);
  const [promoCodeSaving, setPromoCodeSaving] = useState(false);
  const [editingPromoCode, setEditingPromoCode] = useState<PromoCodeItem | null>(null);
  const [promoCodeForm, setPromoCodeForm] = useState({
    code: '',
    description: '',
    type: 'PERCENT' as PromoCodeItem['type'],
    value: '',
    giftProductId: '',
    minOrderAmount: '',
    validFrom: '',
    validUntil: '',
    maxUses: '',
    maxUsesPerCustomer: '',
    firstPurchaseOnly: false,
    isActive: true,
  });

  useEffect(() => {
    if (activeSettingsTab !== 'cupones' || !token || promoProducts.length) return;
    void requestJson<SuccessResponse<Array<{ id: string; name: string; isAvailable?: boolean; deleted?: boolean; sellBy?: string; isAdultOnly?: boolean }>>>({
      apiBase, path: '/restaurant-panel/productos', token,
      fallbackMessage: 'No se pudieron cargar los productos.',
    }).then(res => {
      setPromoProducts((res.data || []).filter(p => p.isAvailable !== false && !p.deleted && p.sellBy !== 'WEIGHT' && !p.isAdultOnly).map(p => ({ id: p.id, name: p.name })));
    }).catch(() => {});
  }, [activeSettingsTab, token, promoProducts.length]);

  const loadPromoCodes = async () => {
    if (!token) return;
    setPromoCodesLoading(true);
    try {
      const res = await requestJson<SuccessResponse<PromoCodeItem[]>>({
        apiBase,
        path: '/restaurant-panel/promocodes',
        token,
        fallbackMessage: 'No se pudieron cargar los cupones.',
      });
      if (res.success) setPromoCodes(res.data);
    } catch {
      pushToast('error', 'Error', 'No se pudieron cargar los cupones.');
    } finally {
      setPromoCodesLoading(false);
    }
  };

  useEffect(() => {
    if (activeSettingsTab === 'cupones') {
      void loadPromoCodes();
    }
  }, [activeSettingsTab]);

  const openPromoCodeModal = (promo?: PromoCodeItem) => {
    setEditingPromoCode(promo ?? null);
    setPromoCodeForm({
      code: promo?.code ?? '',
      description: promo?.description ?? '',
      type: promo?.type ?? 'PERCENT',
      value: promo ? String(promo.value) : '',
      giftProductId: promo?.giftProductId ?? '',
      minOrderAmount: promo?.minOrderAmount != null ? String(promo.minOrderAmount) : '',
      validFrom: promo?.validFrom ? promo.validFrom.slice(0, 10) : '',
      validUntil: promo?.validUntil ? promo.validUntil.slice(0, 10) : '',
      maxUses: promo?.maxUses != null ? String(promo.maxUses) : '',
      maxUsesPerCustomer: promo?.maxUsesPerCustomer != null ? String(promo.maxUsesPerCustomer) : '',
      firstPurchaseOnly: promo?.firstPurchaseOnly ?? false,
      isActive: promo?.isActive ?? true,
    });
    setPromoCodeModalOpen(true);
  };

  const savePromoCode = async () => {
    if (!token) return;
    if (!promoCodeForm.code.trim() || !promoCodeForm.value) {
      pushToast('error', 'Campos obligatorios', 'Indica el código y el valor del cupón.');
      return;
    }
    if (promoCodeForm.type === 'FREE_PRODUCT' && !promoCodeForm.giftProductId) {
      pushToast('error', 'Producto requerido', 'Selecciona el producto que se regalará.');
      return;
    }
    const valueNum = promoCodeForm.type === 'FREE_PRODUCT' ? 1 : Number(promoCodeForm.value);
    if (!Number.isFinite(valueNum) || valueNum <= 0) {
      pushToast('error', 'Valor inválido', 'El valor debe ser un número mayor a cero.');
      return;
    }
    if (promoCodeForm.type === 'PERCENT' && valueNum > 100) {
      pushToast('error', 'Valor inválido', 'El porcentaje no puede superar 100.');
      return;
    }
    if (promoCodeForm.type === 'AMOUNT' && promoCodeForm.minOrderAmount) {
      const minAmount = Number(promoCodeForm.minOrderAmount);
      if (!Number.isFinite(minAmount) || minAmount <= 0) {
        pushToast('error', 'Compra mínima inválida', 'La compra mínima debe ser un número mayor a cero.');
        return;
      }
      if (valueNum > minAmount) {
        pushToast('error', 'Valor inválido', 'El monto del cupón no puede ser mayor a la compra mínima.');
        return;
      }
    }
    if (promoCodeForm.maxUses) {
      const maxUses = Number(promoCodeForm.maxUses);
      if (!Number.isInteger(maxUses) || maxUses <= 0) {
        pushToast('error', 'Usos máximos inválidos', 'Los usos máximos deben ser un entero mayor a cero.');
        return;
      }
    }
    if (promoCodeForm.maxUsesPerCustomer) {
      const maxPerCustomer = Number(promoCodeForm.maxUsesPerCustomer);
      if (!Number.isInteger(maxPerCustomer) || maxPerCustomer <= 0 || maxPerCustomer > 1000000) {
        pushToast('error', 'Límite por cliente inválido', 'Indica un entero entre 1 y 1,000,000.');
        return;
      }
    }
    if (promoCodeForm.validFrom && promoCodeForm.validUntil) {
      const from = new Date(`${promoCodeForm.validFrom}T00:00:00`);
      const until = new Date(`${promoCodeForm.validUntil}T23:59:59`);
      if (until <= from) {
        pushToast('error', 'Fechas inválidas', 'La fecha de vencimiento debe ser posterior a la fecha de inicio.');
        return;
      }
    }
    setPromoCodeSaving(true);
    try {
      const body: Record<string, unknown> = {
        code: promoCodeForm.code.trim().toUpperCase(),
        description: promoCodeForm.description.trim() || null,
        type: promoCodeForm.type,
        value: valueNum,
        giftProductId: promoCodeForm.type === 'FREE_PRODUCT' ? promoCodeForm.giftProductId : null,
        minOrderAmount: promoCodeForm.minOrderAmount ? Number(promoCodeForm.minOrderAmount) : null,
        maxUses: promoCodeForm.maxUses ? Number(promoCodeForm.maxUses) : null,
        maxUsesPerCustomer: promoCodeForm.maxUsesPerCustomer ? Number(promoCodeForm.maxUsesPerCustomer) : null,
        firstPurchaseOnly: promoCodeForm.firstPurchaseOnly,
        isActive: promoCodeForm.isActive,
      };
      if (promoCodeForm.validFrom) body.validFrom = new Date(`${promoCodeForm.validFrom}T00:00:00`).toISOString();
      if (promoCodeForm.validUntil) body.validUntil = new Date(`${promoCodeForm.validUntil}T23:59:59`).toISOString();

      if (editingPromoCode) {
        const res = await requestJson<SuccessResponse<PromoCodeItem>>({
          apiBase,
          path: `/restaurant-panel/promocodes/${editingPromoCode.id}`,
          token,
          options: { method: 'PATCH', body: JSON.stringify(body) },
          fallbackMessage: 'No se pudo actualizar el cupón.',
        });
        setPromoCodes((current) =>
          current.map((p) => (p.id === editingPromoCode.id ? res.data : p))
        );
        pushToast('success', 'Cupón actualizado', `El cupón ${res.data.code} se actualizó.`);
      } else {
        const res = await requestJson<SuccessResponse<PromoCodeItem>>({
          apiBase,
          path: '/restaurant-panel/promocodes',
          token,
          options: { method: 'POST', body: JSON.stringify(body) },
          fallbackMessage: 'No se pudo crear el cupón.',
        });
        setPromoCodes((current) => [res.data, ...current]);
        pushToast('success', 'Cupón creado', `El cupón ${res.data.code} ya está disponible.`);
      }
      setPromoCodeModalOpen(false);
    } catch {
      pushToast('error', 'Error', 'No se pudo guardar el cupón. Revisa que el código no se repita.');
    } finally {
      setPromoCodeSaving(false);
    }
  };

  const togglePromoCodeActive = async (promo: PromoCodeItem) => {
    if (!token) return;
    const next = !promo.isActive;
    setPromoCodes((current) =>
      current.map((p) => (p.id === promo.id ? { ...p, isActive: next } : p))
    );
    try {
      const res = await requestJson<SuccessResponse<PromoCodeItem>>({
        apiBase,
        path: `/restaurant-panel/promocodes/${promo.id}`,
        token,
        options: { method: 'PATCH', body: JSON.stringify({ isActive: next }) },
        fallbackMessage: 'No se pudo actualizar el cupón.',
      });
      setPromoCodes((current) =>
        current.map((p) => (p.id === promo.id ? res.data : p))
      );
    } catch {
      setPromoCodes((current) =>
        current.map((p) => (p.id === promo.id ? { ...p, isActive: !next } : p))
      );
      pushToast('error', 'Error', 'No se pudo actualizar el cupón.');
    }
  };

  const deletePromoCode = async (promo: PromoCodeItem) => {
    if (!token) return;
    if (!window.confirm(`¿Eliminar el cupón ${promo.code}? Esta acción no se puede deshacer.`)) return;
    try {
      await requestJson({
        apiBase,
        path: `/restaurant-panel/promocodes/${promo.id}`,
        token,
        options: { method: 'DELETE' },
        fallbackMessage: 'No se pudo eliminar el cupón.',
      });
      setPromoCodes((current) => current.filter((p) => p.id !== promo.id));
      pushToast('success', 'Cupón eliminado', `El cupón ${promo.code} se eliminó.`);
    } catch {
      pushToast('error', 'Error', 'No se pudo eliminar el cupón.');
    }
  };


  const dayBlocks = (day: number): HoursBlock[] =>
    hoursDraft.filter((b) => b.dayOfWeek === day).sort((a, b) => a.shiftIndex - b.shiftIndex);
  const isDayOpen = (day: number) => dayBlocks(day).some((b) => !b.isClosed);
  const dayHasInvalid = (day: number) => dayBlocks(day).some((b) => !b.isClosed && b.openTime === b.closeTime);

  const hasInvalidHours = hoursDraft.some((b) => !b.isClosed && b.openTime === b.closeTime);

  const toggleDay = (day: number) => {
    setOperatingHoursDraft((current: HoursBlock[]) => {
      const dayItems = current.filter((b) => b.dayOfWeek === day);
      if (dayItems.some((b) => !b.isClosed)) {
        return current.map((b) => (b.dayOfWeek === day ? { ...b, isClosed: true } : b));
      }
      if (dayItems.length === 0) {
        return [...current, { dayOfWeek: day, shiftIndex: 0, openTime: '09:00', closeTime: '18:00', isClosed: false }];
      }
      return current.map((b) => (b.dayOfWeek === day ? { ...b, isClosed: false } : b));
    });
  };

  const updateShift = (day: number, shiftIndex: number, patch: Partial<HoursBlock>) => {
    setOperatingHoursDraft((current: HoursBlock[]) =>
      current.map((b) => (b.dayOfWeek === day && b.shiftIndex === shiftIndex ? { ...b, ...patch } : b))
    );
  };

  const addShift = (day: number) => {
    setOperatingHoursDraft((current: HoursBlock[]) => {
      const dayItems = current.filter((b) => b.dayOfWeek === day);
      if (dayItems.length >= MAX_SHIFTS_PER_DAY) return current;
      const used = new Set(dayItems.map((b) => b.shiftIndex));
      let next = 0;
      while (used.has(next) && next < MAX_SHIFTS_PER_DAY) next += 1;
      if (next >= MAX_SHIFTS_PER_DAY) return current;
      const last = dayItems[dayItems.length - 1];
      return [
        ...current,
        {
          dayOfWeek: day,
          shiftIndex: next,
          openTime: last?.openTime ?? '09:00',
          closeTime: last?.closeTime ?? '18:00',
          isClosed: false,
        },
      ];
    });
  };

  const removeShift = (day: number, shiftIndex: number) => {
    setOperatingHoursDraft((current: HoursBlock[]) =>
      current.filter((b) => !(b.dayOfWeek === day && b.shiftIndex === shiftIndex))
    );
  };

  const applyToAllDays = () => {
    setOperatingHoursDraft((current: HoursBlock[]) => {
      const source = current.filter((b) => b.dayOfWeek === copySourceDay);
      if (source.length === 0) return current;
      const clones = weekDayOptions
        .filter((d) => d.dayOfWeek !== copySourceDay)
        .flatMap((d) => source.map((b) => ({ ...b, dayOfWeek: d.dayOfWeek })));
      const kept = current.filter((b) => b.dayOfWeek === copySourceDay);
      return [...kept, ...clones].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.shiftIndex - b.shiftIndex);
    });
    pushToast('info', 'Horario copiado', 'El horario seleccionado se aplicó a todos los días.');
  };

  const isProfileTab = activeSettingsTab === 'perfil' || activeSettingsTab === 'ubicacion' || activeSettingsTab === 'entrega' || activeSettingsTab === 'pagos';

  const handleGlobalSave = () => {
    if (activeSettingsTab === 'horarios') {
      void saveOperatingHours();
      return;
    }
    if (activeSettingsTab === 'seguridad') {
      void savePasswordChange();
      return;
    }
    if (isProfileTab) {
      void saveStoreProfile(activeSettingsTab as 'perfil' | 'ubicacion' | 'entrega' | 'pagos');
    }
  };

  const globalSaving =
    activeSettingsTab === 'horarios'
      ? savingOperatingHours
      : activeSettingsTab === 'seguridad'
        ? savingPassword
        : savingStoreProfile;

  const globalLabel =
    activeSettingsTab === 'horarios'
      ? (savingOperatingHours ? 'Guardando horarios...' : 'Guardar horarios')
      : activeSettingsTab === 'seguridad'
        ? (savingPassword ? 'Actualizando...' : 'Cambiar contraseña')
        : activeSettingsTab === 'ubicacion'
          ? (savingStoreProfile ? 'Guardando...' : 'Guardar ubicación')
          : activeSettingsTab === 'entrega'
            ? (savingStoreProfile ? 'Guardando...' : 'Guardar entrega')
            : activeSettingsTab === 'pagos'
              ? (savingStoreProfile ? 'Guardando...' : 'Guardar datos bancarios')
              : (savingStoreProfile ? 'Guardando...' : 'Guardar perfil');

  // La barra de guardado inferior es el ÚNICO punto de guardado manual:
  // Preferencias y Cupones se guardan solos (toggles, CRUD y promociones inline).
  const showSaveBar = activeSettingsTab !== 'preferencias' && activeSettingsTab !== 'cupones';

  const saveBarCopy: Record<string, { title: string; subtitle: string }> = {
    perfil: { title: 'Perfil público', subtitle: '' },
    ubicacion: { title: 'Ubicación', subtitle: 'Dirección y mapa' },
    entrega: { title: 'Entrega', subtitle: 'Modalidad, tiempos y tarifas' },
    horarios: { title: 'Horarios', subtitle: 'Días y turnos de servicio' },
    pagos: { title: 'Métodos de pago', subtitle: 'Efectivo y transferencias' },
    seguridad: { title: 'Seguridad', subtitle: 'Contraseña y acceso' },
  };
  const activeSaveBarCopy = saveBarCopy[activeSettingsTab] ?? saveBarCopy.perfil;

  const applyWhatsappNotifications = async (checked: boolean) => {
    setStoreDraft((c: any) => ({ ...c, whatsappNotifications: checked }));
    if (!token) return;
    try {
      const payload = await requestJson<SuccessResponse<RestaurantProfile>>({
        apiBase,
        path: '/restaurant-panel/perfil',
        token,
        options: {
          method: 'PATCH',
          body: JSON.stringify({ whatsappNotifications: checked }),
        },
        fallbackMessage: 'Error al actualizar',
      });
      setProfile(payload.data);
    } catch (e) {
      setStoreDraft((c: any) => ({ ...c, whatsappNotifications: !checked }));
      pushToast('error', 'Error', 'No se pudo actualizar la configuración.');
    }
  };

  const toggleAutoOpen = async (checked: boolean) => {
    if (!token) return;
    const previous = profile?.autoOpenEnabled ?? false;
    setProfile((c: any) => (c ? { ...c, autoOpenEnabled: checked } : c));
    try {
      const payload = await requestJson<SuccessResponse<RestaurantProfile>>({
        apiBase,
        path: '/restaurant-panel/perfil',
        token,
        options: {
          method: 'PATCH',
          body: JSON.stringify({ autoOpenEnabled: checked }),
        },
        fallbackMessage: 'Error al actualizar',
      });
      setProfile(payload.data);
      pushToast(
        'success',
        checked ? 'Apertura automática activada' : 'Apertura automática desactivada',
        checked
          ? 'Tu negocio se abrirá solo a la hora de apertura de cada día.'
          : 'Tu negocio ya no se abrirá solo. Podrás abrir manualmente cada día.'
      );
    } catch (e) {
      setProfile((c: any) => (c ? { ...c, autoOpenEnabled: previous } : c));
      pushToast('error', 'Error', 'No se pudo actualizar la configuración.');
    }
  };

  const toggleStoreCategory = (catId: string) => {
    setStoreDraft((prev: any) => {
      const selected: string[] = prev.storeCategories || [];
      if (selected.includes(catId)) {
        return { ...prev, storeCategories: selected.filter((id: string) => id !== catId) };
      }
      if (selected.length >= 2) return prev;
      return { ...prev, storeCategories: [...selected, catId] };
    });
  };

  const normalizedCategorySearch = normalizeSearchText(categorySearch);
  const filteredPlatformCategories = platformCategories.filter((cat: any) =>
    !normalizedCategorySearch || normalizeSearchText(cat.name).includes(normalizedCategorySearch)
  );

  return (
    <div className="wl-settings">
        <header className="wl-settings-header">
          <span className="wl-settings-header-icon"><Settings2 aria-hidden="true" /></span>
          <div>
            <p>WingsLab</p>
            <h2>Configuración</h2>
          </div>
        </header>

        {/* Contenedor Principal */}
        <div className="wl-settings-layout">
          <nav aria-label="Secciones de configuración" className="wl-settings-nav">
            <div className="wl-settings-nav-grid">
              {settingsTabs.map((tab: any) => {
                const isActive = activeSettingsTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    data-active={isActive}
                    aria-pressed={isActive}
                    onClick={() => setActiveSettingsTab(tab.key)}
                    className="wl-settings-nav-item"
                  >
                    <span className="wl-settings-nav-icon">
                      {tab.icon}
                    </span>
                    <div className="wl-settings-nav-copy">
                      <span>{tab.label}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </nav>

          {/* Área de Contenido Glassmórfica */}
          <div className="wl-settings-main">
            <div className="wl-settings-content" data-section={activeSettingsTab}>
              
              {/* Encabezado de sección dinámico */}
              <div className="wl-settings-section-heading">
                <div className="wl-settings-section-icon">
                  {currentSettingsTab.icon}
                </div>
                <div className="min-w-0">
                  <h3>{currentSettingsTab.label}</h3>
                </div>
              </div>

            {/* ─── PERFIL ─── */}
            {activeSettingsTab === 'perfil' && (
              <div className="wl-settings-form grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
                <div className="wl-settings-group-heading md:col-span-2"><div><h4>Identidad del negocio</h4></div></div>
                <div className="md:col-span-2">
                  <Field
                    label="Nombre del restaurante"
                    value={storeDraft.name}
                    onChange={(value: string) => setStoreDraft((c: any) => ({ ...c, name: value }))}
                    placeholder="Tacos Centro"
                  />
                </div>
                <div className="wl-settings-group-heading md:col-span-2"><div><h4>Datos de contacto</h4></div></div>
                <Field
                  label="Correo de contacto"
                  value={storeDraft.email}
                  onChange={(value: string) => setStoreDraft((c: any) => ({ ...c, email: value }))}
                  placeholder="contacto@restaurante.com"
                />
                <Field
                  label="Teléfono de contacto"
                  value={storeDraft.contactPhone}
                  onChange={(value: string) => setStoreDraft((c: any) => ({ ...c, contactPhone: value }))}
                  placeholder="5512345678"
                />
                <div className="md:col-span-2">
                  <div className="wl-settings-group-heading">
                    <div><h4>Redes</h4></div>
                  </div>
                </div>
                <Field
                  label="Instagram"
                  value={storeDraft.instagram}
                  onChange={(value: string) => setStoreDraft((c: any) => ({ ...c, instagram: value }))}
                  placeholder="https://instagram.com/tu-cuenta"
                />
                <Field
                  label="Facebook"
                  value={storeDraft.facebook}
                  onChange={(value: string) => setStoreDraft((c: any) => ({ ...c, facebook: value }))}
                  placeholder="https://facebook.com/tu-pagina"
                />
                <div className="md:col-span-2">
                  <Field
                    label="TikTok"
                    value={storeDraft.tiktok}
                    onChange={(value: string) => setStoreDraft((c: any) => ({ ...c, tiktok: value }))}
                    placeholder="https://tiktok.com/@tu-cuenta"
                  />
                </div>
                {profile?.businessType && profile.businessType !== 'RESTAURANT' && (
                  <div className="flex items-center gap-3 rounded-2xl border border-violet-200/50 bg-violet-50/60 px-4 py-3 text-sm">
                    <span className="font-semibold text-neutral-700">Tipo de negocio:</span>
                    <span className="font-bold text-violet-700">
                      {businessTypeLabel(profile.businessType)}
                    </span>
                  </div>
                )}
                <div className="md:col-span-2">
                  <div className="wl-settings-group-heading"><div><h4>Negocio</h4></div></div>
                  <TextAreaField
                    label="Descripción"
                    value={storeDraft.description}
                    onChange={(value: string) => setStoreDraft((c: any) => ({ ...c, description: value }))}
                    placeholder="Describe tu restaurante, tu cocina y la experiencia que ofreces a tus clientes."
                  />
                </div>
                <div className="md:col-span-2">
                  <div className="wl-settings-group-heading">
                    <div>
                      <h4>SEO</h4>
                    </div>
                  </div>
                  <div className="grid min-w-0 grid-cols-1 gap-4">
                    <Field
                      label="Título SEO"
                      value={storeDraft.seoTitle ?? ''}
                      onChange={(value: string) => setStoreDraft((c: any) => ({ ...c, seoTitle: value }))}
                      placeholder="Ej. Menú de alitas en WingsLab"
                      maxLength={65}
                    />
                    <TextAreaField
                      label="Descripción SEO"
                      value={storeDraft.seoDescription ?? ''}
                      onChange={(value: string) => setStoreDraft((c: any) => ({ ...c, seoDescription: value }))}
                      placeholder="Ej. Pide alitas y comida rápida en línea. Recoge en tienda o recibe a domicilio."
                    />
                  </div>
                </div>
                {false && <div className="md:col-span-2 min-w-0">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div className="min-w-0 flex-1">
                      <label htmlFor="sadel-category-search" className="block text-[13px] font-semibold text-neutral-900">Categorías</label>
                      <p className="text-xs text-neutral-500 mt-0.5 break-words">Clasificación interna heredada.</p>
                    </div>
                    <span className={`inline-flex shrink-0 items-center gap-1 text-[11px] font-medium ${storeDraft.storeCategories.length >= 2 ? 'text-sky-600' : 'text-neutral-400'}`}>
                      {storeDraft.storeCategories.length}/2
                    </span>
                  </div>
                  <div className="relative mb-3">
                    <svg className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                    <input
                      id="sadel-category-search"
                      type="search"
                      enterKeyHint="search"
                      autoComplete="off"
                      value={categorySearch}
                      onChange={(event) => setCategorySearch(event.target.value)}
                      placeholder="Buscar categoría..."
                      className="h-12 w-full rounded-2xl border border-black/10 bg-neutral-100/80 pl-11 pr-10 text-[16px] font-medium text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-sky-500 focus:bg-white focus:ring-4 focus:ring-sky-500/15 sm:text-sm"
                    />
                    {categorySearch ? (
                      <button
                        type="button"
                        onClick={() => setCategorySearch('')}
                        className="absolute right-2.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-neutral-400 transition active:scale-90 hover:bg-neutral-200 hover:text-neutral-700"
                        aria-label="Limpiar búsqueda de categorías"
                      >
                        <span className="text-base font-bold leading-none">×</span>
                      </button>
                    ) : null}
                  </div>
                  {platformCategories.length === 0 ? (
                    <p className="text-sm text-neutral-500 italic">No hay categorías disponibles. Contacta a soporte.</p>
                  ) : filteredPlatformCategories.length === 0 ? (
                    <p className="text-sm text-neutral-500 italic">Sin resultados para “{categorySearch.trim()}”.</p>
                  ) : (
                    <div className="scrollbar-none flex gap-3 overflow-x-auto overscroll-x-contain pb-3 -mx-1 px-1 snap-x snap-mandatory" style={{ WebkitOverflowScrolling: 'touch' }}>
                      {filteredPlatformCategories.map((cat: any) => {
                        const isSelected = storeDraft.storeCategories.includes(cat.id);
                        const atLimit = storeDraft.storeCategories.length >= 2 && !isSelected;
                        return (
                          <button
                            key={cat.id}
                            type="button"
                            aria-pressed={isSelected}
                            disabled={atLimit}
                            onClick={() => toggleStoreCategory(cat.id)}
                            className={`flex w-[150px] shrink-0 snap-start items-center gap-2 rounded-xl border p-3 text-left transition touch-manipulation active:scale-[0.98] ${
                              isSelected
                                ? 'border-neutral-900 bg-neutral-900 text-white'
                                : atLimit
                                  ? 'border-black/5 bg-neutral-50 text-neutral-300 cursor-not-allowed'
                                  : 'border-black/10 bg-white text-neutral-700 hover:border-black/20 hover:bg-neutral-50'
                            }`}
                          >
                            <CategoryIcon name={cat.icon} className="h-5 w-5 shrink-0" />
                            <span className="truncate text-sm font-medium leading-tight">{cat.name}</span>
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => setShowAllCategories(true)}
                        aria-haspopup="dialog"
                        className="flex min-h-[68px] w-[150px] shrink-0 snap-start flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-sky-300/70 bg-sky-50/40 p-3 text-center transition touch-manipulation active:scale-[0.98] hover:bg-sky-50"
                      >
                        <span className="text-[13px] font-bold text-sky-700">Ver todas</span>
                        <span className="text-[11px] font-medium text-sky-600/70">{platformCategories.length} categorías</span>
                      </button>
                    </div>
                  )}
                </div>

                }
                <div className="wl-settings-status md:col-span-2">
                  <span className="font-semibold text-neutral-900">Estado: </span>
                  {(profile as RestaurantProfile | null)?.status === 'ACTIVE'
                    ? (profile as RestaurantProfile | null)?.isAcceptingOrders ? '🟢 Abierto y aceptando pedidos' : '🟡 Cerrado temporalmente'
                    : (profile as RestaurantProfile | null)?.status === 'DELETED' ? '🔴 Cuenta eliminada' : '🟠 Cuenta suspendida'}
                </div>
              </div>
            )}


            {/* ─── UBICACIÓN ─── */}
            <div className={`wl-settings-form grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 ${activeSettingsTab === 'ubicacion' ? '' : 'hidden'}`}>
                <div className="wl-settings-group-heading md:col-span-2"><div><h4>Dirección del negocio</h4></div></div>
                <div className="md:col-span-2 relative z-[9999]">
                  <Field
                    label="Dirección"
                    value={storeDraft.address}
                    onChange={(value: string) => setStoreDraft((c: any) => ({ ...c, address: value }))}
                    placeholder="Av. Juárez 15, Centro"
                  />
                  {isSearchingAddress && (
                    <div className="absolute right-3 top-9">
                      <div className="w-4 h-4 border-2 border-sky-600 border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                  {addressSuggestions.length > 0 && (
                    <div className="absolute z-[9999] mt-1 w-full rounded-xl border border-black/10 bg-white shadow-xl overflow-hidden max-h-60 overflow-y-auto">
                      {addressSuggestions.map((suggestion: any) => (
                        <button
                          key={suggestion.place_id}
                          type="button"
                          onClick={() => {
                            const google = getGoogleMaps();
                            if (!google || !google.maps || !google.maps.places) return;

                            if (!placesServiceRef.current) {
                              const mapEl = document.createElement('div');
                              placesServiceRef.current = new google.maps.places.PlacesService(mapEl);
                            }

                            placesServiceRef.current.getDetails({
                              placeId: suggestion.place_id,
                              sessionToken: autocompleteSessionTokenRef.current,
                              fields: ['geometry', 'formatted_address']
                            }, (place: any, status: any) => {
                              autocompleteSessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();

                              if (status !== google.maps.places.PlacesServiceStatus.OK || !place || !place.geometry || !place.geometry.location) {
                                return;
                              }

                              const lat = place.geometry.location.lat();
                              const lng = place.geometry.location.lng();

                              ignoreAddressSearchRef.current = true;
                              setStoreDraft((c: any) => ({
                                ...c,
                                address: suggestion.display_name,
                                latitude: String(lat),
                                longitude: String(lng),
                              }));
                              setAddressSuggestions([]);

                              if (settingsMapRef.current) {
                                settingsMapRef.current.setCenter({ lat, lng });
                                settingsMarkerRef.current.setPosition({ lat, lng });
                              }
                            });
                          }}
                          className="w-full px-4 py-2.5 text-left text-sm hover:bg-neutral-50 transition border-b last:border-0 border-black/5 text-neutral-800 break-words"
                        >
                          {suggestion.display_name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="md:col-span-2">
                  <Field
                    label="Número exterior"
                    value={storeDraft.houseNumber}
                    onChange={(value: string) => setStoreDraft((c: any) => ({ ...c, houseNumber: value }))}
                    placeholder="123"
                  />
                </div>
                 <div className="wl-settings-map-hint md:col-span-2">
                  <Info className="w-4 h-4 text-neutral-400 shrink-0" strokeWidth={1.8} />
                   Mueve el marcador para ajustar la ubicación.
                </div>
                <div className="md:col-span-2">
                  <div className="wl-settings-group-heading"><div><h4>Ubicación en el mapa</h4></div></div>
                  <div id="settings-map" className="h-[280px] w-full rounded-[24px] border border-black/5 overflow-hidden shadow-[0_8px_30px_rgba(0,0,0,0.03)]" />
                </div>
                <div className="wl-settings-coordinates md:col-span-2 grid grid-cols-2 gap-4">
                  <div className="min-w-0 space-y-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Latitud</span>
                    <code className="block text-sm font-mono font-bold text-neutral-800 break-all">{storeDraft.latitude || 'Sin configurar'}</code>
                  </div>
                  <div className="min-w-0 space-y-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Longitud</span>
                    <code className="block text-sm font-mono font-bold text-neutral-800 break-all">{storeDraft.longitude || 'Sin configurar'}</code>
                  </div>
                </div>
            </div>

            {/* ─── ENTREGA ─── */}
            {activeSettingsTab === 'entrega' && (
              <div className="wl-settings-form grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
                <div className="wl-settings-group-heading md:col-span-2"><div><h4>Modalidad de servicio</h4></div></div>
                <div className="md:col-span-2">
                  <ToggleField
                    mobileCompact
                    label="Solo recoger en tienda"
                    description="Los clientes recogen sus pedidos en WingsLab."
                    checked={storeDraft.pickupOnly === true}
                    onChange={(checked: boolean) =>
                      setStoreDraft((c: any) => ({
                        ...c,
                        pickupOnly: checked,
                        hasOwnDelivery: true,
                        supportsNetworkDelivery: false,
                        deliveryFee: checked ? '' : c.deliveryFee,
                      }))
                    }
                  />
                </div>

                {storeDraft.pickupOnly ? (
                  null
                ) : (
                  <>
                    <div className="md:col-span-2">
                      <p className="rounded-xl bg-orange-50 p-4 text-sm font-semibold text-orange-900">Reparto propio WingsLab · recogida y entrega mediante QR</p>
                    </div>

                    {storeDraft.hasOwnDelivery ? (
                      <>

                        <div className="md:col-span-2">
                          <span className="text-[12px] font-bold uppercase tracking-[0.1em] text-neutral-600">Tipo de tarifa</span>
                          <div className="mt-2 grid gap-3 md:grid-cols-2">
                            <button
                              type="button"
                              aria-pressed={storeDraft.deliveryPricingModel !== 'distance'}
                              onClick={() => setStoreDraft((c: any) => ({ ...c, deliveryPricingModel: 'fixed' }))}
                              className={`group flex flex-col gap-1 rounded-[18px] border px-5 py-4 text-left transition-all duration-200 ${storeDraft.deliveryPricingModel !== 'distance' ? 'border-sky-400 bg-sky-50/70 ring-4 ring-sky-400/15' : 'border-black/5 bg-white hover:border-black/15'}`}
                            >
                              <span className={`text-sm font-bold ${storeDraft.deliveryPricingModel !== 'distance' ? 'text-sky-700' : 'text-neutral-900'}`}>Tarifa fija</span>
                              <span className="text-xs font-medium text-neutral-500">Mismo costo sin importar la distancia.</span>
                            </button>
                            <button
                              type="button"
                              aria-pressed={storeDraft.deliveryPricingModel === 'distance'}
                              onClick={() => setStoreDraft((c: any) => ({ ...c, deliveryPricingModel: 'distance' }))}
                              className={`group flex flex-col gap-1 rounded-[18px] border px-5 py-4 text-left transition-all duration-200 ${storeDraft.deliveryPricingModel === 'distance' ? 'border-sky-400 bg-sky-50/70 ring-4 ring-sky-400/15' : 'border-black/5 bg-white hover:border-black/15'}`}
                            >
                              <span className={`text-sm font-bold ${storeDraft.deliveryPricingModel === 'distance' ? 'text-sky-700' : 'text-neutral-900'}`}>Tarifa dinámica por distancia</span>
                              <span className="text-xs font-medium text-neutral-500">El costo depende de la distancia.</span>
                            </button>
                          </div>
                        </div>

                        {storeDraft.deliveryPricingModel === 'distance' ? (
                          <>
                            <Field
                              label="Tarifa base (1er km) ($)"
                              value={storeDraft.deliveryBaseRate}
                              onChange={(value: string) => setStoreDraft((c: any) => ({ ...c, deliveryBaseRate: value }))}
                              placeholder="20"
                              type="number"
                            />
                            <Field
                              label="Por km adicional ($)"
                              value={storeDraft.deliveryPerKmRate}
                              onChange={(value: string) => setStoreDraft((c: any) => ({ ...c, deliveryPerKmRate: value }))}
                              placeholder="8"
                              type="number"
                            />
                            <Field
                              label="Tarifa mínima ($)"
                              value={storeDraft.deliveryMinFee}
                              onChange={(value: string) => setStoreDraft((c: any) => ({ ...c, deliveryMinFee: value }))}
                              placeholder="15"
                              type="number"
                            />
                            <Field
                              label="Tarifa máxima ($)"
                              value={storeDraft.deliveryMaxFee}
                              onChange={(value: string) => setStoreDraft((c: any) => ({ ...c, deliveryMaxFee: value }))}
                              placeholder="150"
                              type="number"
                            />
                          </>
                        ) : (
                          <Field
                            label="Costo de envío ($)"
                            value={storeDraft.deliveryFee}
                            onChange={(value: string) => setStoreDraft((c: any) => ({ ...c, deliveryFee: value }))}
                            placeholder="35"
                            type="number"
                          />
                        )}
                      </>
                    ) : (
                      <div className="rounded-[16px] border border-black/5 bg-neutral-50 p-3.5 text-sm text-neutral-600">
                        <p className="font-semibold text-neutral-800 text-xs uppercase tracking-wider mb-1">Costo de envío</p>
                        La tarifa se configura en WingsLab.
                      </div>
                    )}
                    {storeDraft.hasOwnDelivery ? (
                      <Field
                        label="Radio de cobertura (km)"
                        value={storeDraft.deliveryRadius}
                        onChange={(value: string) => setStoreDraft((c: any) => ({ ...c, deliveryRadius: value }))}
                        placeholder="3"
                        type="number"
                      />
                    ) : (
                      <div className="rounded-[16px] border border-black/5 bg-neutral-50 p-3.5 text-sm text-neutral-600">
                        <p className="font-semibold text-neutral-800 text-xs uppercase tracking-wider mb-1">Radio de cobertura</p>
                        La cobertura se configura en WingsLab.
                      </div>
                    )}
                    <div className="md:col-span-2 rounded-[18px] border border-black/5 bg-neutral-50 p-4 text-sm text-neutral-600 leading-6">
                      <div className="flex items-center gap-2 mb-1">
                        <div className={`h-2 w-2 rounded-full ${(profile as RestaurantProfile | null)?.isAcceptingOrders ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                        <span className="font-semibold text-neutral-900">
                          {(profile as RestaurantProfile | null)?.isAcceptingOrders ? 'Aceptando pedidos' : 'No aceptando pedidos'}
                        </span>
                      </div>
                      <p>Modalidad: <span className="font-medium text-neutral-800">Reparto propio WingsLab</span>
                        {storeDraft.hasOwnDelivery ? (
                          <> · Tarifa: <span className="font-medium text-neutral-800">{storeDraft.deliveryPricingModel === 'distance' ? 'Dinámica por distancia' : 'Fija'}</span></>
                        ) : null}
                      </p>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ─── HORARIOS ─── */}
            {activeSettingsTab === 'horarios' && (() => {
              const openDaysCount = weekDayOptions.filter((d) => isDayOpen(d.dayOfWeek)).length;
              return (
              <div className="wl-hours">
                <div className="wl-hours-summary">
                  <div className="wl-hours-summary-head">
                    <div className="min-w-0">
                      <p className="wl-hours-title">Horario operativo</p>
                      <p className="wl-hours-subtitle">Toca un día para editar su horario.</p>
                    </div>
                    <span className="wl-hours-count">
                      <span className="wl-hours-count-dot" />
                      {openDaysCount} de {weekDayOptions.length} días abiertos
                    </span>
                  </div>
                  <div className="wl-hours-week" aria-hidden="true">
                    {weekDayOptions.map((day) => (
                      <span key={day.dayOfWeek} className={`wl-hours-week-day ${isDayOpen(day.dayOfWeek) ? 'is-open' : ''}`}>
                        {day.label.slice(0, 2)}
                      </span>
                    ))}
                  </div>
                  <div className="wl-hours-copy">
                    <label className="wl-hours-select-label">
                      Copiar horario de
                      <select
                        value={copySourceDay}
                        onChange={(e) => setCopySourceDay(Number(e.target.value))}
                      >
                        {weekDayOptions.map((opt) => (
                          <option key={opt.dayOfWeek} value={opt.dayOfWeek}>{opt.label}</option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={() => { if (window.confirm('Esto reemplazará los horarios y días cerrados de toda la semana. ¿Deseas continuar?')) applyToAllDays(); }}
                      className="wl-hours-copy-button"
                    >
                      Aplicar a todos los días
                    </button>
                  </div>
                </div>

                {/* Apertura automática */}
                <div className="wl-hours-auto">
                  <div className="min-w-0 flex-1">
                    <p className="wl-hours-auto-title">Apertura automática</p>
                    <p className="wl-hours-auto-desc">
                      Abre según el horario, incluso después de un cierre o pausa, el siguiente día de servicio.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={profile?.autoOpenEnabled ?? false}
                    aria-label="Apertura automática"
                    onClick={() => toggleAutoOpen(!(profile?.autoOpenEnabled ?? false))}
                    className={`wl-hours-switch ${profile?.autoOpenEnabled ? 'is-on' : ''}`}
                  >
                    <span className="wl-hours-switch-thumb">{profile?.autoOpenEnabled ? 'On' : 'Off'}</span>
                  </button>
                </div>

                <div className="wl-hours-list">
                  <div className="wl-hours-days">
                    {weekDayOptions.map((day) => {
                      const blocks = dayBlocks(day.dayOfWeek);
                      const open = isDayOpen(day.dayOfWeek);
                      const invalid = dayHasInvalid(day.dayOfWeek);
                      return (
                        <div key={day.dayOfWeek} className={`wl-hours-day ${open ? 'is-open' : ''} ${editingHoursDay === day.dayOfWeek ? 'is-editing' : ''}`}>
                          <div className="wl-hours-day-row">
                            <button type="button" className="wl-hours-day-main" aria-expanded={editingHoursDay === day.dayOfWeek} onClick={() => setEditingHoursDay(editingHoursDay === day.dayOfWeek ? null : day.dayOfWeek)}>
                              <span className="wl-hours-day-name">{day.label}</span>
                              <span className={`wl-hours-day-schedule ${open ? 'is-open' : ''}`}>
                                {open ? formatDaySummary(blocks) : 'Cerrado'}
                              </span>
                              {invalid && (
                                <span className="wl-hours-day-error">
                                  La hora de apertura no puede ser igual a la de cierre.
                                </span>
                              )}
                              <span className="wl-hours-day-edit">{editingHoursDay === day.dayOfWeek ? 'Ocultar' : open ? 'Editar horario' : 'Activa para editar'}</span>
                            </button>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={open}
                              aria-label={open ? `Cerrar ${day.label}` : `Abrir ${day.label}`}
                              onClick={() => { toggleDay(day.dayOfWeek); if (!open) setEditingHoursDay(day.dayOfWeek); }}
                              className={`wl-hours-switch ${open ? 'is-on' : ''}`}
                            >
                              <span className="wl-hours-switch-thumb">{open ? 'On' : 'Off'}</span>
                            </button>
                          </div>

                          {open && editingHoursDay === day.dayOfWeek && (
                            <div className="wl-hours-shifts">
                              {blocks
                                .slice()
                                .sort((a: HoursBlock, b: HoursBlock) => a.shiftIndex - b.shiftIndex)
                                .map((block: HoursBlock, idx: number) => (
                                  <div
                                    key={`${block.dayOfWeek}-${block.shiftIndex}`}
                                    className="wl-hours-shift"
                                  >
                                    <div className="wl-hours-shift-head">
                                      <div className="wl-hours-shift-labels">
                                        <span className="wl-hours-shift-name">
                                          {blocks.length > 1 ? `Turno ${idx + 1}` : 'Horario'}
                                        </span>
                                        {isOvernightShift(block) && (
                                          <span className="wl-hours-overnight">Cierra al día siguiente</span>
                                        )}
                                      </div>
                                      {blocks.length > 1 && (
                                        <button
                                          type="button"
                                          onClick={() => removeShift(day.dayOfWeek, block.shiftIndex)}
                                          className="wl-hours-remove"
                                        >
                                          Quitar turno
                                        </button>
                                      )}
                                    </div>
                                    <div className="wl-hours-shift-times">
                                      <div className="min-w-0">
                                        <label className="wl-hours-time-label" htmlFor={`open-${day.dayOfWeek}-${block.shiftIndex}`}>Apertura</label>
                                        <input
                                          id={`open-${day.dayOfWeek}-${block.shiftIndex}`}
                                          type="time"
                                          value={block.openTime}
                                          onChange={(e: any) => updateShift(day.dayOfWeek, block.shiftIndex, { openTime: e.target.value })}
                                        />
                                      </div>
                                      <div className="min-w-0">
                                        <label className="wl-hours-time-label" htmlFor={`close-${day.dayOfWeek}-${block.shiftIndex}`}>Cierre</label>
                                        <input
                                          id={`close-${day.dayOfWeek}-${block.shiftIndex}`}
                                          type="time"
                                          value={block.closeTime}
                                          onChange={(e: any) => updateShift(day.dayOfWeek, block.shiftIndex, { closeTime: e.target.value })}
                                        />
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              {blocks.length < MAX_SHIFTS_PER_DAY && (
                                <button
                                  type="button"
                                  onClick={() => addShift(day.dayOfWeek)}
                                  className="wl-hours-add-shift"
                                >
                                  + Agregar segundo turno
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {hasInvalidHours && (
                  <p className="wl-hours-error-note">
                    Revisa los horarios marcados en rojo antes de guardar.
                  </p>
                )}
              </div>
              );
            })()}

            {/* ─── PAGOS ─── */}
            {activeSettingsTab === 'pagos' && (
              <div className="wl-settings-form grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
                <div className="md:col-span-2 rounded-[18px] border border-sky-100 bg-sky-50 p-4 text-sm text-sky-700">
                  <p className="font-semibold mb-0.5">Pago en efectivo</p>
                  <p className="text-sky-700/80">Los pedidos que superen el límite se pagan por transferencia.</p>
                </div>
                <div className="md:col-span-2">
                  <ToggleField
                    label="Aceptar pagos en efectivo"
                    checked={storeDraft.acceptsCash}
                    onChange={(checked: boolean) => setStoreDraft((c: any) => ({ ...c, acceptsCash: checked }))}
                    description="Desactiva si prefieres cobrar solo con transferencia."
                  />
                </div>
                <div className="md:col-span-2">
                  <Field
                    label="Monto máximo para pago en efectivo ($)"
                    value={storeDraft.maxCashOrder}
                    onChange={(value: string) => setStoreDraft((c: any) => ({ ...c, maxCashOrder: value }))}
                    placeholder="500"
                    type="number"
                  />
                </div>
                <div className="md:col-span-2 rounded-[18px] border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800">
                  <p className="font-semibold mb-0.5">Cuenta para recibir transferencias</p>
                  <p className="text-emerald-700/80">Estos datos se muestran al elegir transferencia.</p>
                </div>
                <Field
                  label="Banco"
                  value={transferBankName}
                  onChange={setTransferBankName}
                  placeholder="BBVA, Banorte, HSBC…"
                />
                <Field
                  label="Número de cuenta o tarjeta"
                  value={transferAccountNumber}
                  onChange={setTransferAccountNumber}
                  placeholder="1234 5678 9012 3456"
                />
                <div className="md:col-span-2">
                  <Field
                    label="Nombre del beneficiario"
                    value={transferBeneficiaryName}
                    onChange={setTransferBeneficiaryName}
                    placeholder="Tacos Centro SA de CV"
                  />
                </div>
              </div>
            )}

            {/* ─── SEGURIDAD ─── */}
            {activeSettingsTab === 'seguridad' && (
              <form
                id="sadel-security-form"
                className="wl-settings-form grid gap-4 max-w-md"
                onSubmit={(event) => {
                  event.preventDefault();
                  void savePasswordChange();
                }}
              >
                <div className="rounded-[18px] border border-rose-100 bg-rose-50 p-4 text-sm text-rose-800">
                  Usa una contraseña segura de al menos 6 caracteres. No la compartas con nadie.
                </div>
                <Field
                  label="Contraseña actual"
                  value={currentPasswordDraft}
                  onChange={setCurrentPasswordDraft}
                  placeholder="••••••••"
                  type="password"
                />
                <Field
                  label="Nueva contraseña"
                  value={newPasswordDraft}
                  onChange={setNewPasswordDraft}
                  placeholder="Mínimo 6 caracteres"
                  type="password"
                />
                <Field
                  label="Confirmar nueva contraseña"
                  value={confirmPasswordDraft}
                  onChange={setConfirmPasswordDraft}
                  placeholder="Repite la nueva contraseña"
                  type="password"
                />
              </form>
            )}

            {/* ─── PREFERENCIAS ─── */}
            {activeSettingsTab === 'preferencias' && (
              <div className="wl-settings-panel-list grid gap-4">
                <div className="wl-settings-group-heading"><div><h4>Alertas y dispositivo</h4></div></div>
                <ToggleField
                  mobileCompact
                  label="Alertas de sonido para pedidos nuevos"
                  description="Suena al recibir un pedido."
                  checked={isOrderAlertSoundEnabled}
                  onChange={handleOrderAlertSoundToggle}
                  disabled={orderAlertAudioState === 'unsupported'}
                />
                <ToggleField
                  mobileCompact
                  label="Impresión de comandas térmicas"
                  description="Muestra los botones de impresión en pedidos."
                  checked={storeDraft.enableTicketPrinting}
                  onChange={async (checked: boolean) => {
                    setStoreDraft((c: any) => ({ ...c, enableTicketPrinting: checked }));
                    if (token) {
                      try {
                        const payload = await requestJson<SuccessResponse<RestaurantProfile>>({
                          apiBase,
                          path: '/restaurant-panel/perfil',
                          token,
                          options: {
                            method: 'PATCH',
                            body: JSON.stringify({ enableTicketPrinting: checked }),
                          },
                          fallbackMessage: 'Error al actualizar',
                        });
                        setProfile(payload.data);
                      } catch (e) {
                        setStoreDraft((c: any) => ({ ...c, enableTicketPrinting: !checked }));
                        pushToast('error', 'Error', 'No se pudo actualizar la configuración.');
                      }
                    }
                  }}
                />
                {storeDraft.enableTicketPrinting && (
                  <div className="rounded-2xl border border-black/5 bg-neutral-50/60 p-4">
                    <p className="text-sm font-bold text-neutral-900">Ancho del papel</p>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      Elige el ancho de tu impresora.
                    </p>
                    <div className="mt-3 flex gap-2">
                      {(['58', '80'] as const).map((w) => (
                        <button
                          key={w}
                          type="button"
                          aria-pressed={paperWidth === w}
                          onClick={() => {
                            setPaperWidth(w);
                            try { window.localStorage.setItem('sadel.restaurant.paperWidth', w); } catch {}
                          }}
                          className={`flex-1 rounded-xl border px-4 py-2.5 text-sm font-bold transition active:scale-[0.98] ${
                            paperWidth === w
                              ? 'border-sky-500 bg-sky-50 text-sky-700 shadow-sm'
                              : 'border-black/10 bg-white text-neutral-500 hover:border-neutral-300'
                          }`}
                        >
                          {w} mm{w === '80' ? ' · Estándar' : ''}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <ToggleField
                  mobileCompact
                  label="Notificaciones por WhatsApp"
                  description="Avisos de pedidos: $0.50 MXN por pedido. Configura tu número en el perfil."
                  checked={!!storeDraft.whatsappNotifications}
                  onChange={async (checked: boolean) => {
                    if (checked) {
                      setShowWhatsappConfirm(true);
                      return;
                    }
                    await applyWhatsappNotifications(false);
                  }}
                />
                {orderAlertAudioState === 'unsupported' && (
                  <div className="rounded-[16px] border border-amber-100 bg-amber-50 p-3.5 text-sm text-amber-800">
                    Tu navegador no admite reproducción de audio automática. Intenta con Chrome o Edge.
                  </div>
                )}
                <div className="rounded-[20px] border border-black/5 bg-neutral-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-3">Sesión activa</p>
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-neutral-200 text-neutral-600 font-semibold text-sm">
                      {sessionUser?.name?.[0]?.toUpperCase() || '?'}
                    </div>
                    <div>
                      <p className="font-semibold text-neutral-950">{sessionUser?.name}</p>
                      <p className="text-sm text-neutral-500">{sessionUser?.phone}</p>
                    </div>
                  </div>
                </div>
                <div className="rounded-[20px] border border-black/5 bg-neutral-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2">Conexión en tiempo real</p>
                  <div className="flex items-center gap-2">
                    <div className={`h-2 w-2 rounded-full ${socketStatus === 'connected' ? 'bg-emerald-500' : socketStatus === 'reconnecting' ? 'bg-amber-400 animate-pulse' : 'bg-neutral-300'}`} />
                    <p className="text-sm text-neutral-700">{socketStatusLabel}
                      {socketStatus === 'reconnecting' && socketAttempts > 0 && ` · Intento ${socketAttempts}`}
                    </p>
                  </div>
                </div>
                <div className="rounded-[20px] border border-black/5 bg-neutral-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-3">Diagnóstico</p>
                  {/* Estado real de las notificaciones push en este dispositivo:
                      permite al restaurante verificar qué falta (permiso vs
                      suscripción) sin abrir ajustes del navegador. */}
                  <div className="mb-3 rounded-xl border border-black/5 bg-white px-3.5 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-medium text-neutral-500">Estado del permiso</span>
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                        pushDiagPermission === 'granted'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                          : pushDiagPermission === 'denied'
                            ? 'bg-rose-50 text-rose-700 border border-rose-200/60'
                            : 'bg-amber-50 text-amber-700 border border-amber-200/60'
                      }`}>
                        {pushDiagPermission === 'granted'
                          ? 'Permitido'
                          : pushDiagPermission === 'denied'
                            ? 'Bloqueado'
                            : 'Pendiente'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3 mt-2">
                      <span className="text-xs font-medium text-neutral-500">Suscripción activa</span>
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                        pushDiagSubscribed
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                          : 'bg-amber-50 text-amber-700 border border-amber-200/60'
                      }`}>
                        {pushDiagSubscribed ? 'Sí' : 'No'}
                      </span>
                    </div>
                    {isNativePlatform() && (
                      <div className="flex items-center justify-between gap-3 mt-2">
                        <span className="text-xs font-medium text-neutral-500">Alarma nativa</span>
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                          nativeAlarmAvailable
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                            : 'bg-rose-50 text-rose-700 border border-rose-200/60'
                        }`}>
                          {nativeAlarmAvailable === null
                            ? 'Verificando…'
                            : nativeAlarmAvailable
                              ? 'Disponible'
                              : 'No detectada'}
                        </span>
                      </div>
                    )}
                    {pushDiagSubscribed && pushDiagPermission === 'granted' ? (
                      <p className="mt-2.5 text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200/60 rounded-lg px-2.5 py-1.5">
                        ✓ Todo en orden. Este dispositivo recibirá pedidos con notificación push.
                      </p>
                    ) : (
                      <p className="mt-2.5 text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200/60 rounded-lg px-2.5 py-1.5">
                        {pushDiagPermission === 'denied'
                          ? 'El permiso está bloqueado en este dispositivo. Actívalo en los ajustes de la app/navegador y luego pulsa "Activar notificaciones".'
                          : 'Este dispositivo aún no recibe notificaciones. Toca "Activar notificaciones" para registrarlo.'}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    {(!pushDiagSubscribed || pushDiagPermission !== 'granted') && onEnablePush && (
                      <button
                        onClick={async () => {
                          const res = await onEnablePush();
                          if (res.ok) {
                            setPushDiagSubscribed(true);
                            setPushDiagPermission('granted');
                            pushToast('success', 'Notificaciones activadas', 'Este dispositivo ya recibirá los pedidos con notificación push.');
                          } else {
                            pushToast('error', 'No se pudieron activar', 'Revisa el permiso de notificaciones en los ajustes del dispositivo y vuelve a intentar.');
                          }
                        }}
                        className="flex items-center gap-2 rounded-xl bg-sky-600 px-3.5 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 transition-colors"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                        Activar notificaciones
                      </button>
                    )}
                    <button
                      onClick={async () => {
                        try {
                          const res = await fetch(`${apiBase}/notifications/test-push`, {
                            method: 'POST',
                            headers: { Authorization: `Bearer ${token}` },
                          });
                          const data = await res.json();
                          pushToast(data.success ? 'success' : 'error', data.success ? 'Notificación enviada' : 'Error', data.message);
                        } catch {
                          pushToast('error', 'Error de red', 'No se pudo contactar al servidor.');
                        }
                      }}
                      className="flex items-center gap-2 rounded-xl bg-black px-3.5 py-2.5 text-sm font-semibold text-white hover:bg-neutral-800 transition-colors"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                      Probar notificación push
                    </button>
                    <button
                      onClick={() => { void playIncomingOrderAlert(true); }}
                      className="flex items-center gap-2 rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm font-semibold text-neutral-900 hover:bg-neutral-100 transition-colors"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                      Probar sonido de alerta
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ─── CUPONES ─── */}
            {activeSettingsTab === 'cupones' && (
              <div className="wl-settings-panel-list wl-settings-coupons grid gap-5">
                <div className="rounded-[24px] border border-white/60 bg-white/80 p-5 shadow-[0_8px_30px_rgba(0,0,0,0.04)] backdrop-blur-xl sm:p-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-[0_6px_16px_-4px_rgba(2,132,199,0.4)]">
                          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" /></svg>
                        </div>
                        <div>
                          <h4 className="text-[15px] font-black tracking-[-0.02em] text-neutral-950">Promociones del negocio</h4>
                          <p className="mt-0.5 text-xs font-medium text-neutral-500">
                            Se aplican automáticamente, sin código.
                          </p>
                        </div>
                      </div>
                      <p className="mt-3 max-w-xl text-[12px] leading-relaxed text-neutral-500">
                        Deja vacío para desactivar. Orden: cantidad → cupón → descuento → envío gratis.
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                    <div className="min-w-0">
                      <Field
                        label="Envío gratis desde ($)"
                        value={storeDraft.promoFreeDeliveryThreshold}
                        onChange={(value: string) => setStoreDraft((c: any) => ({ ...c, promoFreeDeliveryThreshold: value }))}
                        placeholder="550"
                        type="number"
                      />
                    </div>

                    <div className="min-w-0">
                      <Field
                        label="Monto mínimo para descuento ($)"
                        value={storeDraft.promoMinOrderAmount}
                        onChange={(value: string) => setStoreDraft((c: any) => ({ ...c, promoMinOrderAmount: value }))}
                        placeholder="500"
                        type="number"
                      />
                    </div>

                    <div className="min-w-0 md:col-span-2 lg:col-span-1">
                      <Field
                        label="Descuento sobre subtotal (%)"
                        value={storeDraft.promoMinOrderPercent}
                        onChange={(value: string) => setStoreDraft((c: any) => ({ ...c, promoMinOrderPercent: value }))}
                        placeholder="15"
                        type="number"
                      />
                    </div>
                  </div>

                  <div className="mt-4 flex flex-col sm:items-end">
                    <button
                      type="button"
                      onClick={() => void saveStoreProfile('entrega')}
                      disabled={savingStoreProfile}
                      className="shrink-0 rounded-full bg-neutral-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:bg-neutral-300"
                    >
                      {savingStoreProfile ? 'Guardando...' : 'Guardar promociones'}
                    </button>
                  </div>
                </div>

                <div className="rounded-[24px] border border-white/60 bg-white/80 p-5 shadow-[0_8px_30px_rgba(0,0,0,0.04)] backdrop-blur-xl sm:p-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-[0_6px_16px_-4px_rgba(16,185,129,0.4)]">
                          <Tag className="h-5 w-5" strokeWidth={1.8} />
                        </div>
                        <div>
                          <h4 className="text-[15px] font-black tracking-[-0.02em] text-neutral-950">Cupones de descuento</h4>
                          <p className="mt-0.5 text-xs font-medium text-neutral-500">
                            Crea códigos que tus clientes escriben al pagar.
                          </p>
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => openPromoCodeModal()}
                      className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
                    >
                      + Nuevo cupón
                    </button>
                  </div>

                  <div className="mt-5">
                {promoCodesLoading && promoCodes.length === 0 ? (
                  <div className="rounded-[20px] border border-black/5 bg-neutral-50 p-8 text-center text-sm text-neutral-500">
                    Cargando cupones...
                  </div>
                ) : promoCodes.length === 0 ? (
                  <div className="rounded-[20px] border border-dashed border-black/10 bg-neutral-50 p-5 text-center">
                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-neutral-400 shadow-sm">
                      <Tag className="w-5 h-5" strokeWidth={1.8} />
                    </div>
                    <p className="text-sm font-semibold text-neutral-700">Aún no tienes cupones</p>
                  </div>
                ) : (
                  <div className="grid gap-3">
                    {promoCodes.map((promo) => {
                      const typeInfo = PROMO_CODE_TYPE_LABELS[promo.type];
                      const expired =
                        promo.validUntil != null && new Date(promo.validUntil).getTime() < Date.now();
                      const exhausted =
                        promo.maxUses != null && promo.usesCount >= promo.maxUses;
                      const isOff = !promo.isActive || expired || exhausted;
                      return (
                        <div
                          key={promo.id}
                          className={`flex flex-col sm:flex-row items-start sm:items-center gap-3 rounded-[18px] border p-4 transition-colors ${
                            isOff ? 'border-black/5 bg-neutral-50/60 opacity-70' : 'border-black/5 bg-white'
                          }`}
                        >
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-100 text-sky-700 font-black text-sm tracking-wider">
                            {promo.code.slice(0, 2)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-sm font-black tracking-wider text-neutral-900 break-all">{promo.code}</span>
                              {promo.type === 'PERCENT' && (
                                <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-700">{promo.value}% OFF</span>
                              )}
                              {promo.type === 'AMOUNT' && (
                                <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-700">-${promo.value}</span>
                              )}
                              {promo.type === 'FREE_DELIVERY' && (
                                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">Envío gratis</span>
                              )}
                              {promo.type === 'FREE_PRODUCT' && (
                                <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-700">Producto gratis</span>
                              )}
                              {isOff && (
                                <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-[11px] font-bold text-neutral-600">
                                  {!promo.isActive ? 'Desactivado' : expired ? 'Vencido' : 'Sin usos'}
                                </span>
                              )}
                            </div>
                            <p className="mt-0.5 text-xs text-neutral-500">{promo.description || typeInfo.label}</p>
                            <p className="mt-0.5 text-[11px] text-neutral-400">
                              {promo.usesCount} uso(s)
                              {promo.maxUses != null ? ` de ${promo.maxUses}` : ''}
                              {promo.maxUsesPerCustomer != null ? ` · máx. ${promo.maxUsesPerCustomer} por cliente` : ''}
                              {promo.firstPurchaseOnly ? ' · solo primera compra' : ''}
                              {promo.type === 'FREE_PRODUCT' && promo.giftProductId ? ` · regalo: ${promoProducts.find(p => p.id === promo.giftProductId)?.name || 'Producto'}` : ''}
                              {promo.minOrderAmount != null ? ` · min $${promo.minOrderAmount}` : ''}
                              {promo.validUntil ? ` · vence ${promo.validUntil.slice(0, 10)}` : ''}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <button
                              type="button"
                              onClick={() => togglePromoCodeActive(promo)}
                              className={`relative h-6 w-11 rounded-full transition-colors ${promo.isActive ? 'bg-emerald-500' : 'bg-neutral-300'}`}
                              aria-label={promo.isActive ? 'Desactivar cupón' : 'Activar cupón'}
                            >
                              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${promo.isActive ? 'left-[22px]' : 'left-0.5'}`} />
                            </button>
                            <button
                              type="button"
                              onClick={() => openPromoCodeModal(promo)}
                              className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-100"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => deletePromoCode(promo)}
                              className="rounded-full border border-red-100 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-100"
                            >
                              Eliminar
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                  </div>
                </div>
              </div>
            )}

          </div>
      {showSaveBar && (
        <div className="wl-settings-save-wrap">
          <div className="wl-settings-save">
            <div className="min-w-0 flex-1">
              <p>{activeSaveBarCopy.title}</p>
              <span>{activeSaveBarCopy.subtitle}</span>
            </div>
            {activeSettingsTab === 'seguridad' ? (
              <button
                type="submit"
                form="sadel-security-form"
                disabled={globalSaving}
                className="wl-settings-save-button"
              >
                <span className="md:hidden">{globalSaving ? 'Actualizando' : 'Actualizar'}</span>
                <span className="hidden md:inline">{globalLabel}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleGlobalSave}
                disabled={globalSaving || (activeSettingsTab === 'horarios' && hasInvalidHours)}
                title={activeSettingsTab === 'horarios' && hasInvalidHours ? 'Revisa los horarios marcados en rojo antes de guardar.' : undefined}
                className="wl-settings-save-button"
              >
                <span className="md:hidden">{globalSaving ? 'Guardando' : 'Guardar'}</span>
                <span className="hidden md:inline">{globalLabel}</span>
              </button>
            )}
          </div>
        </div>
      )}
        </div>
      </div>
      {promoCodeModalOpen && (
        <div className="fixed inset-0 z-[96] flex items-end justify-center bg-black/60 animate-fade-in sm:items-center sm:p-5"
          onClick={() => setPromoCodeModalOpen(false)}>
          <div className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] bg-white shadow-[0_32px_110px_rgba(15,15,15,0.35)] animate-scale-up sm:max-h-[calc(100vh-2.5rem)] sm:w-full sm:max-w-xl sm:rounded-[28px]"
            onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-neutral-100 px-5 py-4 sm:px-7">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-500">
                  <Tag className="h-5 w-5" strokeWidth={1.8} />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400">Cupones</p>
                  <h3 className="truncate text-lg font-black tracking-[-0.02em] text-neutral-900">
                    {editingPromoCode ? `Editar cupón ${editingPromoCode.code}` : 'Nuevo cupón'}
                  </h3>
                </div>
              </div>
              <button onClick={() => setPromoCodeModalOpen(false)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 transition hover:bg-neutral-200 hover:text-neutral-700 active:scale-90"
                aria-label="Cerrar">
                ✕
              </button>
            </div>

            {/* Cuerpo */}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-8 sm:py-6">
              <div className="grid gap-6">
                {/* Sección: Descuento */}
                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <h4 className="text-[11px] font-bold uppercase tracking-[0.12em] text-neutral-400">Descuento</h4>
                  </div>
                  <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
                    <label className="grid min-w-0 gap-1.5 text-sm text-neutral-600">
                      <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">Tipo de descuento</span>
                      <select
                        value={promoCodeForm.type}
                        onChange={(e) => setPromoCodeForm((c) => ({ ...c, type: e.target.value as PromoCodeItem['type'] }))}
                        className="rounded-xl border border-black/10 bg-white px-3.5 py-3 text-base text-neutral-900 shadow-sm transition-all focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20 sm:text-sm"
                      >
                        <option value="PERCENT">Porcentaje (%)</option>
                        <option value="AMOUNT">Monto fijo ($)</option>
                        <option value="FREE_DELIVERY">Envío gratis</option>
                        <option value="FREE_PRODUCT">Producto gratis</option>
                      </select>
                    </label>
                    {promoCodeForm.type !== 'FREE_PRODUCT' ? (
                      <label className="grid min-w-0 gap-1.5 text-sm text-neutral-600">
                        <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">Valor</span>
                        <input
                          type="number"
                          value={promoCodeForm.value}
                          onChange={(e) => setPromoCodeForm((c) => ({ ...c, value: e.target.value }))}
                          placeholder={promoCodeForm.type === 'PERCENT' ? '15' : promoCodeForm.type === 'AMOUNT' ? '50' : '0'}
                          className="rounded-xl border border-black/10 bg-white px-3.5 py-3 text-base text-neutral-900 shadow-sm transition-all focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20 sm:text-sm"
                        />
                      </label>
                    ) : (
                      <label className="grid min-w-0 gap-1.5 text-sm text-neutral-600">
                        <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">Producto a regalar</span>
                        <select
                          value={promoCodeForm.giftProductId}
                          onChange={(e) => setPromoCodeForm((c) => ({ ...c, giftProductId: e.target.value }))}
                          className="rounded-xl border border-black/10 bg-white px-3.5 py-3 text-base text-neutral-900 shadow-sm transition-all focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20 sm:text-sm"
                        >
                          <option value="">Selecciona un producto</option>
                          {promoProducts.map((product) => (
                            <option key={product.id} value={product.id}>{product.name}</option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                  <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-neutral-100 bg-neutral-50 px-4 py-3">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-neutral-400" strokeWidth={1.8} />
                    <p className="text-xs leading-relaxed text-neutral-500">{PROMO_CODE_TYPE_LABELS[promoCodeForm.type].hint}</p>
                  </div>
                </div>

                {/* Sección: Código y descripción */}
                <div className="border-t border-neutral-100 pt-6">
                  <div className="mb-3">
                    <h4 className="text-[11px] font-bold uppercase tracking-[0.12em] text-neutral-400">Código</h4>
                  </div>
                  <label className="grid min-w-0 gap-1.5 text-sm text-neutral-600">
                    <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">Código del cupón</span>
                    <input
                      value={promoCodeForm.code}
                      onChange={(e) => setPromoCodeForm((c) => ({ ...c, code: e.target.value }))}
                      placeholder="ej. VERANO25"
                      className="rounded-xl border border-black/10 bg-white px-4 py-3 font-mono text-base font-bold uppercase tracking-wider text-neutral-900 shadow-sm transition-all focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20 sm:text-sm"
                    />
                  </label>
                  <label className="mt-4 grid min-w-0 gap-1.5 text-sm text-neutral-600">
                    <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">Descripción <span className="font-normal normal-case text-neutral-400">(opcional)</span></span>
                    <input
                      value={promoCodeForm.description}
                      onChange={(e) => setPromoCodeForm((c) => ({ ...c, description: e.target.value }))}
                      placeholder="ej. Promo de bienvenida"
                      className="rounded-xl border border-black/10 bg-white px-4 py-3 text-base text-neutral-900 shadow-sm transition-all focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20 sm:text-sm"
                    />
                  </label>
                </div>

                {/* Sección: Condiciones */}
                <div className="border-t border-neutral-100 pt-6">
                  <div className="mb-3">
                    <h4 className="text-[11px] font-bold uppercase tracking-[0.12em] text-neutral-400">Condiciones</h4>
                  </div>
                  <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
                    <label className="grid min-w-0 gap-1.5 text-sm text-neutral-600">
                      <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">Mínimo de compra ($)</span>
                      <input
                        type="number"
                        value={promoCodeForm.minOrderAmount}
                        onChange={(e) => setPromoCodeForm((c) => ({ ...c, minOrderAmount: e.target.value }))}
                        placeholder="0"
                        className="rounded-xl border border-black/10 bg-white px-3.5 py-3 text-base text-neutral-900 shadow-sm transition-all focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20 sm:text-sm"
                      />
                    </label>
                    <label className="grid min-w-0 gap-1.5 text-sm text-neutral-600">
                      <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">Usos máximos <span className="font-normal normal-case text-neutral-400">(opcional)</span></span>
                      <input
                        type="number"
                        value={promoCodeForm.maxUses}
                        onChange={(e) => setPromoCodeForm((c) => ({ ...c, maxUses: e.target.value }))}
                        placeholder="Ilimitado"
                        className="rounded-xl border border-black/10 bg-white px-3.5 py-3 text-base text-neutral-900 shadow-sm transition-all focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20 sm:text-sm"
                      />
                    </label>
                    <label className="grid min-w-0 gap-1.5 text-sm text-neutral-600">
                      <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">Usos máximos por cliente <span className="font-normal normal-case text-neutral-400">(opcional)</span></span>
                      <input type="number" min="1" value={promoCodeForm.maxUsesPerCustomer}
                        onChange={(e) => setPromoCodeForm((c) => ({ ...c, maxUsesPerCustomer: e.target.value }))}
                        placeholder="Sin límite"
                        className="rounded-xl border border-black/10 bg-white px-3.5 py-3 text-base text-neutral-900 shadow-sm transition-all focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20 sm:text-sm" />
                    </label>
                  </div>
                  <label className={`mt-4 flex items-start gap-3 rounded-2xl border p-4 transition ${promoCodeForm.firstPurchaseOnly ? 'border-[#bb0a0e] bg-[#fff0ef]' : 'border-black/10 bg-white'}`}>
                    <input type="checkbox" checked={promoCodeForm.firstPurchaseOnly} onChange={(e) => setPromoCodeForm((c) => ({ ...c, firstPurchaseOnly: e.target.checked }))} className="mt-0.5 h-5 w-5 shrink-0 accent-[#bb0a0e]" />
                    <span className="min-w-0">
                      <b className="block text-sm text-neutral-900">🎁 Promoción exclusiva para nuevos clientes</b>
                      <span className="mt-1 block text-xs leading-relaxed text-neutral-600">Solo se puede usar en la <b>primera compra</b> de cada cliente en WingsLab. Perfecto para dar la bienvenida con un descuento o un producto gratis. El servidor lo valida dentro del pedido, así que no se puede repetir.</span>
                    </span>
                  </label>
                  <div className="mt-4 grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
                    <label className="grid min-w-0 gap-1.5 text-sm text-neutral-600">
                      <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">Válido desde</span>
                      <input
                        type="date"
                        value={promoCodeForm.validFrom}
                        onChange={(e) => setPromoCodeForm((c) => ({ ...c, validFrom: e.target.value }))}
                        className="rounded-xl border border-black/10 bg-white px-3.5 py-3 text-base text-neutral-900 shadow-sm transition-all focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20 sm:text-sm"
                      />
                    </label>
                    <label className="grid min-w-0 gap-1.5 text-sm text-neutral-600">
                      <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">Vence</span>
                      <input
                        type="date"
                        value={promoCodeForm.validUntil}
                        onChange={(e) => setPromoCodeForm((c) => ({ ...c, validUntil: e.target.value }))}
                        className="rounded-xl border border-black/10 bg-white px-3.5 py-3 text-base text-neutral-900 shadow-sm transition-all focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/20 sm:text-sm"
                      />
                    </label>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="shrink-0 border-t border-black/5 bg-neutral-50/80 px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-4 sm:px-8 sm:pb-5">
              <div className="grid grid-cols-1 gap-3 sm:flex sm:justify-end">
                <button
                  onClick={() => setPromoCodeModalOpen(false)}
                  className="w-full rounded-full border border-black/10 bg-white px-6 py-3 text-sm font-semibold text-neutral-700 shadow-sm transition-all hover:bg-neutral-100 hover:shadow active:scale-[0.98] sm:w-auto"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => void savePromoCode()}
                  disabled={promoCodeSaving}
                  className="w-full rounded-full bg-neutral-950 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-800 active:scale-[0.98] disabled:opacity-50 sm:w-auto"
                >
                  {promoCodeSaving ? 'Guardando...' : editingPromoCode ? 'Guardar cambios' : 'Crear cupón'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showAllCategories && (
        <div className="fixed inset-0 z-[97] flex items-end justify-center bg-black/60 animate-fade-in sm:items-center sm:p-5"
          onClick={() => setShowAllCategories(false)}>
          <div className="flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-[28px] bg-white shadow-[0_32px_110px_rgba(15,15,15,0.35)] sm:max-w-2xl sm:rounded-[28px]"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex shrink-0 justify-center bg-white pt-2.5 sm:hidden" aria-hidden="true">
              <span className="h-1.5 w-12 rounded-full bg-neutral-300" />
            </div>
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-black/5 px-5 py-4">
              <div className="min-w-0">
                <h3 className="text-lg font-black tracking-[-0.02em] text-neutral-900">Todas las categorías</h3>
                <p className="mt-0.5 text-xs font-medium text-neutral-500">{storeDraft.storeCategories.length}/2 seleccionadas</p>
              </div>
              <button onClick={() => setShowAllCategories(false)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 transition active:scale-90 hover:bg-neutral-200 hover:text-neutral-700"
                aria-label="Cerrar">
                ✕
              </button>
            </div>
            <div className="shrink-0 border-b border-black/5 px-5 py-3">
              <div className="relative">
                <svg className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                <input
                  type="search"
                  enterKeyHint="search"
                  autoComplete="off"
                  value={categorySearch}
                  onChange={(event) => setCategorySearch(event.target.value)}
                  placeholder="Buscar categoría..."
                  className="h-12 w-full rounded-2xl border border-black/10 bg-neutral-100/80 pl-11 pr-4 text-[16px] font-medium text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-sky-500 focus:bg-white focus:ring-4 focus:ring-sky-500/15 sm:text-sm"
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4" style={{ WebkitOverflowScrolling: 'touch' }}>
              {filteredPlatformCategories.length === 0 ? (
                <p className="py-10 text-center text-sm text-neutral-500 italic">Sin resultados para “{categorySearch.trim()}”.</p>
              ) : (
                <div className="grid grid-cols-2 gap-2.5">
                  {filteredPlatformCategories.map((cat: any) => {
                    const isSelected = storeDraft.storeCategories.includes(cat.id);
                    const atLimit = storeDraft.storeCategories.length >= 2 && !isSelected;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        disabled={atLimit}
                        onClick={() => toggleStoreCategory(cat.id)}
                        className={`flex min-h-[56px] items-center gap-2 rounded-2xl border p-3 text-left transition touch-manipulation active:scale-[0.98] ${
                          isSelected
                            ? 'border-neutral-900 bg-neutral-900 text-white'
                            : atLimit
                              ? 'border-black/5 bg-neutral-50 text-neutral-300 cursor-not-allowed'
                              : 'border-black/10 bg-white text-neutral-700 hover:border-black/20'
                        }`}
                      >
                        <CategoryIcon name={cat.icon} className="h-6 w-6 shrink-0" />
                        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-tight">{cat.name}</span>
                        {isSelected && <span className="shrink-0 text-sm font-black">✓</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="shrink-0 border-t border-black/5 bg-white px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
              <button
                type="button"
                onClick={() => setShowAllCategories(false)}
                className="min-h-[52px] w-full rounded-full bg-neutral-950 px-6 py-3.5 text-sm font-bold text-white transition active:scale-[0.98]"
              >
                Listo
              </button>
            </div>
          </div>
        </div>
      )}

      {showWhatsappConfirm && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 px-4 py-5 backdrop-blur-sm animate-fade-in"
          onClick={() => setShowWhatsappConfirm(false)}>
          <div className="relative w-full max-w-md rounded-[28px] bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setShowWhatsappConfirm(false)}
              className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-700 transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
            </div>
            <h3 className="text-lg font-bold text-neutral-900">Activar notificaciones por WhatsApp</h3>
            <p className="mt-2 text-sm leading-relaxed text-neutral-600">
              Recibirás un mensaje a tu WhatsApp cuando a tu negocio llegue un pedido nuevo.
            </p>
            <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-neutral-800">Costo por pedido</span>
                <span className="text-sm font-bold text-neutral-900">$0.50 MXN</span>
              </div>
              <p className="mt-1 text-xs text-neutral-500">
                Este cargo se suma a tu tarifa de uso y aparecerá en tu liquidación semanal. Solo se cobra cuando se envía el mensaje de un pedido.
              </p>
            </div>
            <div className="mt-6 flex flex-col gap-2">
              <button onClick={async () => { setShowWhatsappConfirm(false); await applyWhatsappNotifications(true); }}
                className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors">
                Aceptar y activar
              </button>
              <button onClick={() => setShowWhatsappConfirm(false)}
                className="w-full rounded-xl border border-black/10 bg-white py-3 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 transition-colors">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
});
