'use client';

import React from 'react';
import { requestJson } from '@sadel/shared';

type SuccessResponse<T> = {
  success: true;
  data: T;
};

type RestaurantProfile = {
  businessType?: string;
  status: string;
  isAcceptingOrders: boolean;
};

const weekDayOptions = [
  { dayOfWeek: 0, label: 'Domingo' },
  { dayOfWeek: 1, label: 'Lunes' },
  { dayOfWeek: 2, label: 'Martes' },
  { dayOfWeek: 3, label: 'Miercoles' },
  { dayOfWeek: 4, label: 'Jueves' },
  { dayOfWeek: 5, label: 'Viernes' },
  { dayOfWeek: 6, label: 'Sabado' },
] as const;

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
  saveStoreProfile: () => void;
  saveOperatingHours: () => void;
  savePasswordChange: () => void;
  handleOrderAlertSoundToggle: (checked: boolean) => void;
  playIncomingOrderAlert: () => void;
  pushToast: (tone: 'info' | 'success' | 'error', title: string, message: string) => void;
  businessTypeLabel: (type?: string | null) => string;
  Field: React.ComponentType<{ label: string; value: string; onChange: (value: string) => void; placeholder: string; type?: string }>;
  TextAreaField: React.ComponentType<{ label: string; value: string; onChange: (value: string) => void; placeholder: string }>;
  ToggleField: React.ComponentType<{ label: string; checked: boolean; onChange: (checked: boolean) => void; description?: string; disabled?: boolean; compact?: boolean }>;
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
  pushToast,
  businessTypeLabel,
  Field,
  TextAreaField,
  ToggleField,
}: SettingsSectionProps) {
  const currentSettingsTab = settingsTabs.find((t: any) => t.key === activeSettingsTab) ?? settingsTabs[0];
  return (
    <div className="flex flex-col gap-6 w-full max-w-[1400px] mx-auto min-w-0">
        {/* Cabecera Premium */}
        <div className="relative overflow-hidden rounded-[32px] border border-white/60 bg-gradient-to-b from-white/95 to-white/70 px-6 py-6 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.05)] backdrop-blur-xl md:px-8 md:py-8">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-sky-500 via-blue-500 to-purple-500 opacity-20"></div>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5 relative z-10">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-sky-100/50 px-3 py-1 mb-3">
                <span className="h-1.5 w-1.5 rounded-full bg-sky-600 animate-pulse"></span>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-sky-700">Centro de Control</p>
              </div>
              <h2 className="text-2xl font-black tracking-[-0.04em] text-neutral-950 md:text-3xl">Configuración de {businessTypeLabel(profile?.businessType)}</h2>
              <p className="mt-1.5 text-sm font-medium text-neutral-500">Gestiona tu perfil, horarios, repartidores y preferencias.</p>
            </div>
            <button
              type="button"
              onClick={() => void saveStoreProfile()}
              disabled={savingStoreProfile}
              className="group relative shrink-0 overflow-hidden rounded-full bg-neutral-950 px-6 py-3.5 text-sm font-bold text-white shadow-[0_8px_20px_rgba(15,15,15,0.2)] transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_25px_rgba(15,15,15,0.3)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-sky-500/0 via-white/20 to-sky-500/0 -translate-x-full transition-transform duration-700 group-hover:translate-x-full"></div>
              <span className="relative z-10">{savingStoreProfile ? 'Guardando ajustes...' : 'Guardar cambios'}</span>
            </button>
          </div>
        </div>

        {/* Contenedor Principal */}
        <div className="flex flex-col gap-6 min-w-0">
          {/* Navegación Horizontal */}
          <nav className="w-full shrink-0 z-10">
            <div className="flex gap-2 overflow-x-auto pb-4 scrollbar-hide flex-nowrap" style={{ WebkitOverflowScrolling: 'touch' }}>
              {settingsTabs.map((tab: any) => {
                const isActive = activeSettingsTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveSettingsTab(tab.key)}
                    className={`group relative flex items-center gap-3 rounded-[20px] px-4 py-3 text-left transition-all duration-300 shrink-0 whitespace-nowrap active:scale-[0.98] ${
                      isActive
                        ? 'bg-gradient-to-br from-sky-600 to-blue-600 text-white shadow-[0_12px_30px_-10px_rgba(2,132,199,0.4)]'
                        : 'bg-white/50 text-neutral-600 hover:bg-white hover:shadow-sm hover:text-neutral-950 border border-transparent hover:border-black/5'
                    }`}
                  >
                    {isActive && (
                      <div className="absolute inset-0 rounded-[20px] ring-1 ring-inset ring-white/20"></div>
                    )}
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl transition-colors duration-300 ${isActive ? 'bg-white/20 text-white' : 'bg-neutral-100 text-neutral-500 group-hover:bg-sky-50 group-hover:text-sky-600'}`}>
                      {tab.icon}
                    </div>
                    <div className="min-w-0 flex-1 pr-2">
                      <span className={`block text-[13px] font-bold ${isActive ? 'text-white' : 'text-neutral-800'}`}>{tab.label}</span>
                      <span className={`block text-[11px] font-medium leading-tight mt-0.5 ${isActive ? 'text-white/80' : 'text-neutral-400'}`}>{tab.desc}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </nav>

          {/* Área de Contenido Glassmórfica */}
          <div className="min-w-0 flex-1 animate-fade-in">
            <div className="relative rounded-[32px] border border-white/60 bg-white/70 p-6 shadow-[0_8px_40px_-12px_rgba(0,0,0,0.08)] backdrop-blur-2xl md:p-10 min-h-[500px]">
              
              {/* Encabezado de sección dinámico */}
              <div className="mb-8 flex items-start sm:items-center gap-4 border-b border-black/5 pb-6">
                <div className="flex h-14 w-14 items-center justify-center rounded-[20px] bg-gradient-to-br from-sky-100 to-blue-50 text-sky-600 border border-sky-200/50 shrink-0 shadow-inner">
                  <span className="scale-125">{currentSettingsTab.icon}</span>
                </div>
                <div>
                  <h3 className="text-xl font-black text-neutral-950 tracking-[-0.02em]">{currentSettingsTab.label}</h3>
                  <p className="mt-1 text-sm font-medium text-neutral-500 max-w-xl leading-relaxed">{currentSettingsTab.desc}</p>
                </div>
              </div>

            {/* ─── PERFIL ─── */}
            {activeSettingsTab === 'perfil' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Field
                    label="Nombre del restaurante"
                    value={storeDraft.name}
                    onChange={(value: string) => setStoreDraft((c: any) => ({ ...c, name: value }))}
                    placeholder="Tacos Centro"
                  />
                </div>
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
                <div className="sm:col-span-2">
                  <div className="border-t border-black/5 pt-4 mt-2 mb-3">
                    <p className="text-[13px] font-bold text-neutral-900">Redes Sociales</p>
                    <p className="text-xs text-neutral-500 mt-0.5">Opcional. Se mostrarán en la página de tu restaurante para clientes.</p>
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
                <div className="sm:col-span-2">
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
                <div className="sm:col-span-2">
                  <TextAreaField
                    label="Descripción"
                    value={storeDraft.description}
                    onChange={(value: string) => setStoreDraft((c: any) => ({ ...c, description: value }))}
                    placeholder="Describe tu restaurante, tu cocina y la experiencia que ofreces a tus clientes."
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[13px] font-semibold text-neutral-900 mb-2">
                    Categorías
                  </label>
                  <p className="text-xs text-neutral-500 mb-3">Selecciona las categorías que mejor describan tu comida para aparecer en esas secciones de la app cliente.</p>
                  {platformCategories.length === 0 ? (
                    <p className="text-sm text-neutral-500 italic">No hay categorías disponibles. Contacta a soporte.</p>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                      {platformCategories.map((cat: any) => {
                        const isSelected = storeDraft.storeCategories.includes(cat.id);
                        return (
                          <button
                            key={cat.id}
                            type="button"
                            onClick={() => {
                              setStoreDraft((prev: any) => ({
                                ...prev,
                                storeCategories: isSelected 
                                  ? prev.storeCategories.filter((id: string) => id !== cat.id) 
                                  : [...prev.storeCategories, cat.id]
                              }))
                            }}
                            className={`flex items-center gap-2 rounded-xl border p-3 text-left transition ${
                              isSelected 
                                ? 'border-neutral-900 bg-neutral-900 text-white' 
                                : 'border-black/10 bg-white text-neutral-700 hover:border-black/20 hover:bg-neutral-50'
                            }`}
                          >
                            <span className="text-lg">{cat.icon}</span>
                            <span className="text-sm font-medium leading-tight">{cat.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="sm:col-span-2 rounded-[20px] border border-black/5 bg-neutral-50 p-4 text-sm text-neutral-600">
                  <span className="font-semibold text-neutral-900">Estado actual: </span>
                  {(profile as RestaurantProfile | null)?.status === 'ACTIVE'
                    ? (profile as RestaurantProfile | null)?.isAcceptingOrders ? '🟢 Abierto y aceptando pedidos' : '🟡 Cerrado temporalmente'
                    : (profile as RestaurantProfile | null)?.status === 'DELETED' ? '🔴 Cuenta eliminada' : '🟠 Cuenta suspendida'}
                </div>
                <div className="sm:col-span-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => void saveStoreProfile()}
                    disabled={savingStoreProfile}
                    className="rounded-full bg-neutral-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:bg-neutral-300"
                  >
                    {savingStoreProfile ? 'Guardando...' : 'Guardar perfil'}
                  </button>
                </div>
              </div>
            )}


            {/* ─── UBICACIÓN ─── */}
            <div className={`grid gap-4 sm:grid-cols-2 ${activeSettingsTab === 'ubicacion' ? '' : 'hidden'}`}>
                <div className="sm:col-span-2 relative z-[9999]">
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
                            const google = (window as any).google;
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
                          className="w-full px-4 py-2.5 text-left text-sm hover:bg-neutral-50 transition border-b last:border-0 border-black/5 text-neutral-800"
                        >
                          {suggestion.display_name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="sm:col-span-2">
                  <Field
                    label="Número exterior"
                    value={storeDraft.houseNumber}
                    onChange={(value: string) => setStoreDraft((c: any) => ({ ...c, houseNumber: value }))}
                    placeholder="123"
                  />
                </div>
                <div className="sm:col-span-2 rounded-[16px] border border-black/5 bg-neutral-50 p-3 text-xs text-neutral-500 flex items-center gap-2">
                  <svg className="w-4 h-4 text-neutral-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  Mueve el marcador en el mapa para ajustar la ubicación exacta. Las coordenadas se actualizan solas.
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-semibold text-neutral-900 mb-2">Ubicación en el mapa</label>
                  <div id="settings-map" className="h-[280px] w-full rounded-[24px] border border-black/5 overflow-hidden shadow-[0_8px_30px_rgba(0,0,0,0.03)]" />
                </div>
                <div className="sm:col-span-2 grid grid-cols-2 gap-4 rounded-[20px] border border-black/5 bg-[#f8f7f4]/60 p-4 shadow-[inset_0_1px_1px_rgba(0,0,0,0.01)]">
                  <div className="space-y-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Latitud</span>
                    <code className="block text-sm font-mono font-bold text-neutral-800">{storeDraft.latitude || 'Sin configurar'}</code>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Longitud</span>
                    <code className="block text-sm font-mono font-bold text-neutral-800">{storeDraft.longitude || 'Sin configurar'}</code>
                  </div>
                </div>
                <div className="sm:col-span-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => void saveStoreProfile()}
                    disabled={savingStoreProfile}
                    className="rounded-full bg-neutral-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-850 disabled:bg-neutral-300"
                  >
                    {savingStoreProfile ? 'Guardando...' : 'Guardar ubicación'}
                  </button>
                </div>
            </div>

            {/* ─── ENTREGA ─── */}
            {activeSettingsTab === 'entrega' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <ToggleField
                    label="Servicio a domicilio propio"
                    description="Actívalo si tu restaurante gestiona su propia flota de repartidores. Si no, los repartidores de SaDeL gestionarán las entregas."
                    checked={storeDraft.hasOwnDelivery}
                    onChange={(checked: boolean) =>
                      setStoreDraft((c: any) => ({
                        ...c,
                        hasOwnDelivery: checked,
                        deliveryFee: checked ? c.deliveryFee : '',
                      }))
                    }
                  />
                </div>

                {storeDraft.hasOwnDelivery ? (
                  <>
                    <div className="sm:col-span-2">
                      <span className="text-[12px] font-bold uppercase tracking-[0.1em] text-neutral-600">Tipo de tarifa</span>
                      <div className="mt-2 grid gap-3 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => setStoreDraft((c: any) => ({ ...c, deliveryPricingModel: 'fixed' }))}
                          className={`group flex flex-col gap-1 rounded-[18px] border px-5 py-4 text-left transition-all duration-200 ${storeDraft.deliveryPricingModel !== 'distance' ? 'border-sky-400 bg-sky-50/70 ring-4 ring-sky-400/15' : 'border-black/5 bg-white hover:border-black/15'}`}
                        >
                          <span className={`text-sm font-bold ${storeDraft.deliveryPricingModel !== 'distance' ? 'text-sky-700' : 'text-neutral-900'}`}>Tarifa fija</span>
                          <span className="text-xs font-medium leading-relaxed text-neutral-500">El mismo costo para todos tus clientes, sin importar la distancia.</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setStoreDraft((c: any) => ({ ...c, deliveryPricingModel: 'distance' }))}
                          className={`group flex flex-col gap-1 rounded-[18px] border px-5 py-4 text-left transition-all duration-200 ${storeDraft.deliveryPricingModel === 'distance' ? 'border-sky-400 bg-sky-50/70 ring-4 ring-sky-400/15' : 'border-black/5 bg-white hover:border-black/15'}`}
                        >
                          <span className={`text-sm font-bold ${storeDraft.deliveryPricingModel === 'distance' ? 'text-sky-700' : 'text-neutral-900'}`}>Tarifa dinámica por distancia</span>
                          <span className="text-xs font-medium leading-relaxed text-neutral-500">El costo sube según los kilómetros que recorra tu repartidor.</span>
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
                    Lo define SaDeL según la región configurada en el panel de administración.
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
                    Lo define SaDeL según la región configurada en el panel de administración.
                  </div>
                )}
                <div className="sm:col-span-2 rounded-[18px] border border-black/5 bg-neutral-50 p-4 text-sm text-neutral-600 leading-6">
                  <div className="flex items-center gap-2 mb-1">
                    <div className={`h-2 w-2 rounded-full ${(profile as RestaurantProfile | null)?.isAcceptingOrders ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                    <span className="font-semibold text-neutral-900">
                      {(profile as RestaurantProfile | null)?.isAcceptingOrders ? 'Aceptando pedidos' : 'No aceptando pedidos'}
                    </span>
                  </div>
                  <p>Modalidad: <span className="font-medium text-neutral-800">{storeDraft.hasOwnDelivery ? 'Entrega propia' : 'Repartidores SaDeL'}</span>
                    {storeDraft.hasOwnDelivery ? (
                      <> · Tarifa: <span className="font-medium text-neutral-800">{storeDraft.deliveryPricingModel === 'distance' ? 'Dinámica por distancia' : 'Fija'}</span></>
                    ) : null}
                  </p>
                </div>
                <div className="sm:col-span-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => void saveStoreProfile()}
                    disabled={savingStoreProfile}
                    className="rounded-full bg-neutral-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:bg-neutral-300"
                  >
                    {savingStoreProfile ? 'Guardando...' : 'Guardar configuración de entrega'}
                  </button>
                </div>
              </div>
            )}

            {/* ─── HORARIOS ─── */}
            {activeSettingsTab === 'horarios' && (
              <div className="grid gap-4">
                <div className="overflow-hidden rounded-[20px] border border-black/5 bg-white shadow-sm">
                  <div className="hidden md:grid md:grid-cols-[1fr_80px_120px_120px] items-center gap-3 border-b border-black/5 bg-neutral-50 px-5 py-2.5">
                    <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">Día</span>
                    <span className="text-center text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">Estado</span>
                    <span className="text-center text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">Apertura</span>
                    <span className="text-center text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">Cierre</span>
                  </div>
                  <div className="divide-y divide-black/5">
                    {operatingHoursDraft.map((item: any) => (
                      <div
                        key={item.dayOfWeek}
                        className={`grid grid-cols-2 items-center gap-x-3 gap-y-0.5 px-4 py-2.5 transition-colors md:grid-cols-[1fr_80px_120px_120px] md:gap-3 md:px-5 md:py-2 ${item.isClosed ? 'opacity-50' : 'hover:bg-neutral-50/50'}`}
                      >
                        <div className="flex items-center gap-2 md:block">
                          <p className="text-sm font-semibold text-neutral-900">
                            {weekDayOptions.find((o) => o.dayOfWeek === item.dayOfWeek)?.label || `Día ${item.dayOfWeek}`}
                          </p>
                          <p className={`text-[11px] md:mt-0.5 ${item.isClosed ? 'text-neutral-400' : 'text-emerald-600 font-medium'}`}>
                            {item.isClosed ? 'Cerrado' : 'Abierto'}
                          </p>
                        </div>
                        <div className="justify-self-end md:justify-self-center">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={!item.isClosed}
                            onClick={() =>
                              setOperatingHoursDraft((current: any) =>
                                current.map((entry: any) =>
                                  entry.dayOfWeek === item.dayOfWeek ? { ...entry, isClosed: !entry.isClosed } : entry
                                )
                              )
                            }
                            className={`relative inline-flex h-[30px] w-[50px] shrink-0 items-center rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-offset-1 ${!item.isClosed ? 'bg-sky-500' : 'bg-neutral-300'}`}
                          >
                            <span
                              className={`inline-block h-[24px] w-[24px] rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ${!item.isClosed ? 'translate-x-[22px]' : 'translate-x-[0px]'}`}
                            />
                          </button>
                        </div>
                        <div className="col-span-1">
                          <label className="mb-0.5 block text-[10px] font-bold uppercase tracking-wider text-neutral-400 md:sr-only">Apertura</label>
                          <input
                            type="time"
                            value={item.openTime}
                            onChange={(e: any) =>
                              setOperatingHoursDraft((current: any) =>
                                current.map((entry: any) =>
                                  entry.dayOfWeek === item.dayOfWeek ? { ...entry, openTime: e.target.value } : entry
                                )
                              )
                            }
                            disabled={item.isClosed}
                            className="w-full rounded-[12px] border border-black/5 bg-neutral-100/50 px-2.5 py-1.5 text-[13px] font-medium text-neutral-900 outline-none transition-all duration-200 focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-400/20 disabled:cursor-not-allowed disabled:opacity-40"
                          />
                        </div>
                        <div className="col-span-1">
                          <label className="mb-0.5 block text-[10px] font-bold uppercase tracking-wider text-neutral-400 md:sr-only">Cierre</label>
                          <input
                            type="time"
                            value={item.closeTime}
                            onChange={(e: any) =>
                              setOperatingHoursDraft((current: any) =>
                                current.map((entry: any) =>
                                  entry.dayOfWeek === item.dayOfWeek ? { ...entry, closeTime: e.target.value } : entry
                                )
                              )
                            }
                            disabled={item.isClosed}
                            className="w-full rounded-[12px] border border-black/5 bg-neutral-100/50 px-2.5 py-1.5 text-[13px] font-medium text-neutral-900 outline-none transition-all duration-200 focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-400/20 disabled:cursor-not-allowed disabled:opacity-40"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => void saveOperatingHours()}
                    disabled={savingOperatingHours}
                    className="rounded-full bg-neutral-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:bg-neutral-300"
                  >
                    {savingOperatingHours ? 'Guardando horarios...' : 'Guardar horarios'}
                  </button>
                </div>
              </div>
            )}

            {/* ─── PAGOS ─── */}
            {activeSettingsTab === 'pagos' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2 rounded-[18px] border border-sky-100 bg-sky-50 p-4 text-sm text-sky-700">
                  <p className="font-semibold mb-0.5">Pago en efectivo</p>
                  <p className="text-sky-700/80">Define el monto máximo que tus clientes pueden pagar en efectivo. Por encima de este monto deberán pagar con transferencia.</p>
                </div>
                <div className="sm:col-span-2">
                  <Field
                    label="Monto máximo para pago en efectivo ($)"
                    value={storeDraft.maxCashOrder}
                    onChange={(value: string) => setStoreDraft((c: any) => ({ ...c, maxCashOrder: value }))}
                    placeholder="500"
                    type="number"
                  />
                </div>
                <div className="sm:col-span-2 rounded-[18px] border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800">
                  <p className="font-semibold mb-0.5">Cuenta para recibir transferencias</p>
                  <p className="text-emerald-700/80">Estos datos se mostrarán al cliente cuando elija pagar con transferencia bancaria en tu restaurante.</p>
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
                <div className="sm:col-span-2">
                  <Field
                    label="Nombre del beneficiario"
                    value={transferBeneficiaryName}
                    onChange={setTransferBeneficiaryName}
                    placeholder="Tacos Centro SA de CV"
                  />
                </div>
                <div className="sm:col-span-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => void saveStoreProfile()}
                    disabled={savingStoreProfile}
                    className="rounded-full bg-neutral-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:bg-neutral-300"
                  >
                    {savingStoreProfile ? 'Guardando...' : 'Guardar datos bancarios'}
                  </button>
                </div>
              </div>
            )}

            {/* ─── SEGURIDAD ─── */}
            {activeSettingsTab === 'seguridad' && (
              <div className="grid gap-4 max-w-md">
                <div className="rounded-[18px] border border-rose-100 bg-rose-50 p-4 text-sm text-rose-800">
                  Usa una contraseña segura de al menos 8 caracteres. No la compartas con nadie.
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
                <button
                  type="button"
                  onClick={() => void savePasswordChange()}
                  disabled={savingPassword}
                  className="rounded-full bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700 disabled:bg-neutral-300"
                >
                  {savingPassword ? 'Actualizando...' : 'Cambiar contraseña'}
                </button>
              </div>
            )}

            {/* ─── PREFERENCIAS ─── */}
            {activeSettingsTab === 'preferencias' && (
              <div className="grid gap-4">
                <ToggleField
                  label="Alertas de sonido para pedidos nuevos"
                  description="Actívalo en caja o cocina para detectar pedidos nuevos sin depender de mirar el panel."
                  checked={isOrderAlertSoundEnabled}
                  onChange={handleOrderAlertSoundToggle}
                  disabled={orderAlertAudioState === 'unsupported'}
                />
                <ToggleField
                  label="Impresión de comandas térmicas"
                  description="Activa esta opción para mostrar los botones de impresión en el tablero de pedidos."
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
                <ToggleField
                  label="Notificaciones por WhatsApp"
                  description="Recibe un mensaje en WhatsApp cuando llegue un pedido nuevo. Configura tu número en el perfil."
                  checked={!!storeDraft.whatsappNotifications}
                  onChange={async (checked: boolean) => {
                    setStoreDraft((c: any) => ({ ...c, whatsappNotifications: checked }));
                    if (token) {
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
                    }
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
                  <div className="flex flex-col gap-2">
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
                      onClick={() => { void playIncomingOrderAlert(); }}
                      className="flex items-center gap-2 rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm font-semibold text-neutral-900 hover:bg-neutral-100 transition-colors"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                      Probar sonido de alerta
                    </button>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  )
});
