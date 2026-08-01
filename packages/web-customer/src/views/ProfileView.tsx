import React, { memo, useRef, useState } from 'react';
import { CustomerProfileAddress } from '../app/page';
import { useStore } from '../store';
import { uploadMediaAsset, requestJson, persistStoredSession, convertImageFileToDataUrl } from '@sadel/shared';

interface ProfileViewProps {
  sessionUser: any;
  memberSinceLabel: string;
  isCustomerSoundEnabled: boolean;
  handleCustomerSoundToggle: (checked: boolean) => void;
  whatsappNotificationsEnabled: boolean;
  handleCustomerWhatsAppToggle: (checked: boolean) => Promise<void>;
  isSubscribed: boolean;
  subscribePush: () => Promise<void>;
  unsubscribePush: () => Promise<void>;
  setEditName: (name: string) => void;
  editLastName: string;
  setEditLastName: (lastName: string) => void;
  setEditPhone: (phone: string) => void;
  setIsEditingProfile: (val: boolean) => void;
  isEditingAddress: boolean;
  addressSearchQuery: string;
  setAddressSearchQuery: (query: string) => void;
  searchAddress: (query: string) => void;
  isSearchingAddress: boolean;
  fillProfileAddressWithCurrentLocation: () => void;
  addressSuggestions: any[];
  selectSuggestion: (suggestion: any) => void;
  profileAddress: CustomerProfileAddress;
  handleProfileAddressChange: (field: keyof CustomerProfileAddress, value: string) => void;
  saveProfileAddress: () => Promise<void>;
  deleteProfileAddress: (id: string) => void;
  cancelProfileAddressEditing: () => void;
  addresses: any[];
  setProfileAddress: (addr: CustomerProfileAddress) => void;
  setIsEditingAddress: (val: boolean) => void;
  token: string;
  apiBase: string;
  loadAddresses: () => Promise<void>;
  setToastMessage: (msg: string, type?: 'success' | 'error' | 'info') => void;
  updatePreferences: (pref: any) => Promise<void>;
  customerProfile: any;
  setIsChangingPassword: (val: boolean) => void;
  clearSession: (msg: string) => void;
  Field: React.FC<any>;
}

export const ProfileView = memo(function ProfileView({
  sessionUser,
  memberSinceLabel,
  isCustomerSoundEnabled,
  handleCustomerSoundToggle,
  isSubscribed,
  subscribePush,
  unsubscribePush,
  setEditName,
  editLastName,
  setEditLastName,
  setEditPhone,
  setIsEditingProfile,
  isEditingAddress,
  addressSearchQuery,
  setAddressSearchQuery,
  searchAddress,
  isSearchingAddress,
  fillProfileAddressWithCurrentLocation,
  addressSuggestions,
  selectSuggestion,
  profileAddress,
  handleProfileAddressChange,
  saveProfileAddress,
  deleteProfileAddress,
  cancelProfileAddressEditing,
  addresses,
  setProfileAddress,
  setIsEditingAddress,
  updatePreferences,
  whatsappNotificationsEnabled,
  handleCustomerWhatsAppToggle,
  customerProfile,
  setIsChangingPassword,
  clearSession,
  Field,
  token,
  apiBase,
  loadAddresses,
  setToastMessage
}: ProfileViewProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const setSessionUser = useStore((state) => state.setSessionUser);

  const handleAvatarClick = () => {
    if (isUploadingPhoto) return;
    fileInputRef.current?.click();
  };

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingPhoto(true);
    setToastMessage('Comprimiendo imagen...');

    try {
      const compressedBase64 = await convertImageFileToDataUrl(file, 300, 300, 0.75);

      setToastMessage('Subiendo imagen...');
      const uploadResult = await uploadMediaAsset({
        apiBase,
        token,
        kind: 'site-image',
        source: compressedBase64,
        fileName: `avatar-${sessionUser?.id || 'customer'}.jpg`,
        fallbackToSource: true,
      });

      setToastMessage('Guardando foto de perfil...');
      const patchResult = await requestJson<{ success: boolean; data: any }>({
        apiBase,
        path: '/customer/profile',
        options: {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            profilePhoto: uploadResult.url,
          }),
        },
      });

      if (patchResult.success) {
        setToastMessage('Foto de perfil actualizada', 'success');
        setTimeout(() => setToastMessage(''), 2000);
        
        const updatedUser = sessionUser
          ? { ...sessionUser, profilePhoto: uploadResult.url }
          : null;
        
        setSessionUser(updatedUser);

        if (updatedUser) {
          persistStoredSession({
            storageKey: 'sadel.customer',
            apiBase,
            token,
            user: updatedUser,
          });
        }
      } else {
        setToastMessage('No se pudo guardar la foto', 'error');
        setTimeout(() => setToastMessage(''), 2000);
      }
    } catch (err: any) {
      console.error('Error changing profile photo:', err);
      setToastMessage(err?.message || 'Error al actualizar foto de perfil', 'error');
      setTimeout(() => setToastMessage(''), 3000);
    } finally {
      setIsUploadingPhoto(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="w-full">
      {/* ── Header ── */}
      <div className="mb-6 md:mb-10 text-center animate-[fadeIn_0.4s_ease-out]">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.3em] mb-4">
          <span className="bg-gradient-to-r from-sky-100 to-indigo-50 text-sky-700 px-4 py-2 rounded-full inline-block shadow-sm ring-1 ring-black/[0.03]">Mi perfil</span>
        </p>
        <p className="text-[13px] md:text-sm text-neutral-500 max-w-lg mx-auto font-medium">
          Gestiona tus datos personales, direcciones y preferencias.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 md:gap-8">
        
        {/* ── Columna Izquierda (7 cols): Identidad y Direcciones ── */}
        <div className="lg:col-span-7 space-y-5 md:space-y-8">
          
          {/* Tarjeta de Perfil Premium */}
          <div className="relative overflow-hidden bg-white rounded-[28px] md:rounded-[36px] border border-white/40 shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-6 sm:p-8 transition-all duration-500 hover:shadow-[0_8px_40px_rgb(0,0,0,0.06)] animate-[slideUp_0.4s_ease-out_0.1s_both]">
            <div className="absolute top-0 right-0 -mr-20 -mt-20 w-64 h-64 bg-sky-400/10 blur-[64px] rounded-full pointer-events-none" />
            <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-48 h-48 bg-indigo-400/10 blur-[64px] rounded-full pointer-events-none" />
            
            <div className="relative flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-left gap-6 sm:gap-8">
              
              {/* Avatar Area */}
              <div className="relative group/avatar cursor-pointer shrink-0" onClick={handleAvatarClick}>
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept="image/*"
                  onChange={handlePhotoChange}
                />
                
                <div className="absolute inset-[-4px] rounded-full bg-gradient-to-tr from-sky-400 via-indigo-400 to-purple-400 opacity-20 blur-md group-hover/avatar:opacity-40 transition-opacity duration-500" />
                <div className="absolute inset-[-2px] rounded-full bg-gradient-to-tr from-sky-200 via-white to-indigo-100 z-0" />
                
                <div className="relative z-10">
                  {sessionUser?.profilePhoto ? (
                    <img
                      src={sessionUser.profilePhoto}
                      alt={`${sessionUser?.name || 'Usuario'} ${sessionUser?.lastName || ''}`}
                      className="h-24 w-24 sm:h-28 sm:w-28 rounded-full object-cover border-[3px] border-white shadow-md transition-transform duration-500 group-hover/avatar:scale-[0.98]"
                    />
                  ) : (
                    <div className="flex h-24 w-24 sm:h-28 sm:w-28 items-center justify-center rounded-full bg-gradient-to-tr from-sky-500 to-indigo-500 font-extrabold text-white text-3xl sm:text-4xl border-[3px] border-white shadow-md transition-transform duration-500 group-hover/avatar:scale-[0.98]">
                      {((sessionUser?.name?.[0] || '') + (sessionUser?.lastName?.[0] || '')).toUpperCase() || sessionUser?.name?.substring(0, 2).toUpperCase() || 'US'}
                    </div>
                  )}
                  
                  <div className="absolute inset-0 bg-black/30 rounded-full flex items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity duration-300 backdrop-blur-[2px]">
                    {isUploadingPhoto ? (
                      <div className="h-6 w-6 sm:h-8 sm:w-8 animate-spin rounded-full border-[3px] border-white border-t-transparent shadow-sm" />
                    ) : (
                      <svg className="w-6 h-6 sm:w-8 sm:h-8 text-white drop-shadow-md" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    )}
                  </div>
                  
                  {/* Permanent Camera Badge */}
                  <div className="absolute bottom-0 right-0 bg-white p-2 rounded-full shadow-md border border-neutral-100 text-neutral-600 group-hover/avatar:text-sky-600 group-hover/avatar:scale-110 transition-all duration-300 z-20">
                    <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                </div>
              </div>
              
              {/* Profile Info */}
              <div className="flex-1 flex flex-col items-center sm:items-start w-full">
                <h3 className="mt-2 sm:mt-1 text-2xl sm:text-3xl font-black text-neutral-900 tracking-[-0.04em] leading-tight">
                  {sessionUser?.name || 'Sin nombre'} {sessionUser?.lastName || ''}
                </h3>
                
                <div className="mt-2.5 flex flex-wrap items-center justify-center sm:justify-start gap-2.5">
                  <span className="bg-neutral-100/80 px-3 py-1 rounded-full text-[13px] font-bold text-neutral-600 tracking-tight border border-black/[0.03]">
                    {sessionUser?.phone || 'Sin teléfono'}
                  </span>
                  
                  {sessionUser?.dateOfBirth && (
                    <span className="bg-neutral-100/80 px-3 py-1 rounded-full text-[13px] font-bold text-neutral-600 tracking-tight border border-black/[0.03]">
                      {(() => {
                        const today = new Date();
                        const birthDate = new Date(sessionUser.dateOfBirth);
                        let age = today.getFullYear() - birthDate.getFullYear();
                        const m = today.getMonth() - birthDate.getMonth();
                        if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
                          age--;
                        }
                        return `${age} años`;
                      })()}
                    </span>
                  )}

                  {(() => {
                    if (!sessionUser?.dateOfBirth) return null;
                    const today = new Date();
                    const birthDate = new Date(sessionUser.dateOfBirth);
                    let age = today.getFullYear() - birthDate.getFullYear();
                    const m = today.getMonth() - birthDate.getMonth();
                    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
                    return age >= 18 ? (
                      <span className="bg-gradient-to-r from-emerald-50 to-teal-50 text-emerald-700 text-[10px] font-black px-2.5 py-1.5 rounded-full tracking-widest uppercase border border-emerald-200/50 shadow-sm">
                        +18
                      </span>
                    ) : null;
                  })()}
                </div>

                <div className="mt-4">
                  <span className="text-[11px] font-bold text-sky-700 bg-sky-50 border border-sky-100/50 px-3 py-1.5 rounded-full inline-flex items-center gap-1.5 tracking-wide shadow-sm">
                    <svg className="w-3.5 h-3.5 text-sky-500" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
                    Miembro desde {memberSinceLabel}
                  </span>
                </div>
              </div>
              
              <button
                className="mt-2 sm:mt-0 w-full sm:w-auto px-6 py-3 rounded-full bg-neutral-900 text-[13px] font-bold text-white hover:bg-neutral-800 transition-colors shadow-lg shadow-neutral-900/20 active:scale-[0.98]"
                onClick={() => {
                  setEditName(sessionUser?.name || '');
                  setEditLastName(sessionUser?.lastName || '');
                  setEditPhone(sessionUser?.phone || '');
                  setIsEditingProfile(true);
                }}
              >
                Editar
              </button>
            </div>
          </div>

          {/* Direcciones Guardadas */}
          <div className="bg-white rounded-[28px] md:rounded-[36px] border border-white/40 shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden animate-[slideUp_0.4s_ease-out_0.2s_both]">
            <div className="px-6 py-5 border-b border-black/[0.04] flex justify-between items-center bg-white">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-orange-50 flex items-center justify-center text-orange-500">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.828 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                </div>
                <h3 className="text-lg font-extrabold text-neutral-900 tracking-tight">Mis direcciones</h3>
              </div>
            </div>

            {isEditingAddress ? (
              <div className="p-5 md:p-7 space-y-5 bg-white/60">
                {/* Buscador de Dirección */}
                <div className="relative">
                  <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-400 ml-1">Buscar dirección</label>
                  <div className="mt-1.5 flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        placeholder="Escribe tu calle y número..."
                        value={addressSearchQuery}
                        onChange={(e) => {
                          setAddressSearchQuery(e.target.value);
                          void searchAddress(e.target.value);
                        }}
                        className="w-full rounded-2xl border border-black/10 bg-white p-3.5 text-sm font-medium focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900 pr-10 shadow-sm transition-all"
                      />
                      {isSearchingAddress && (
                        <div className="absolute right-4 top-1/2 -translate-y-1/2">
                          <div className="h-4 w-4 animate-spin rounded-full border-[3px] border-neutral-200 border-t-neutral-800" />
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={fillProfileAddressWithCurrentLocation}
                      className="rounded-2xl border border-black/10 bg-neutral-50 px-4 text-sm font-bold text-neutral-700 hover:bg-neutral-100 transition flex items-center gap-2 active:scale-[0.98] shadow-sm"
                    >
                      <svg className="h-4.5 w-4.5 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                    </button>
                  </div>

                  {/* Sugerencias */}
                  {addressSuggestions.length > 0 && (
                    <div className="absolute z-10 left-0 right-0 mt-2 bg-white rounded-2xl border border-black/10 shadow-xl max-h-60 overflow-y-auto">
                      {addressSuggestions.map((suggestion, index) => (
                        <button
                          key={index}
                          type="button"
                          onClick={() => selectSuggestion(suggestion)}
                          className="w-full text-left px-5 py-3.5 text-sm hover:bg-neutral-50 border-b border-black/[0.04] last:border-0 transition-colors"
                        >
                          <p className="font-bold text-neutral-900">{suggestion.name}</p>
                          <p className="text-xs text-neutral-500 mt-1">{suggestion.description}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Mapa */}
                <div className="flex items-start gap-3 text-[13px] text-orange-800 bg-orange-50 px-4 py-3 rounded-2xl border border-orange-100/50">
                  <svg className="h-5 w-5 text-orange-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="font-medium leading-relaxed">Arrastra el pin en el mapa exactamente donde quieres recibir tu entrega para mayor precisión.</span>
                </div>
                
                <div id="map-address" className="h-[260px] w-full rounded-2xl border border-black/10 shadow-inner overflow-hidden z-0" />

                {/* Datos complementarios */}
                <div className="grid gap-4 md:grid-cols-2 mt-2">
                  <div className="md:col-span-2">
                    <Field label="Calle seleccionada" value={profileAddress.street} readOnly placeholder="Selecciona en el mapa o busca arriba" />
                  </div>
                  <Field label="Número exterior" value={profileAddress.number} onChange={(value: string) => handleProfileAddressChange('number', value)} placeholder="Ej. 123" />
                  <Field label="Depto / Interior (Opcional)" value={profileAddress.apartment || ''} onChange={(value: string) => handleProfileAddressChange('apartment', value)} placeholder="Depto 3B" />
                  <div className="md:col-span-2">
                    <Field label="Referencia o indicaciones" value={profileAddress.reference || ''} onChange={(value: string) => handleProfileAddressChange('reference', value)} placeholder="Portón negro, dejar con el guardia..." />
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 pt-4 border-t border-black/[0.04]">
                  <button
                    type="button"
                    onClick={saveProfileAddress}
                    className="flex-1 sm:flex-none rounded-full bg-neutral-900 px-8 py-3.5 text-sm font-bold text-white transition hover:bg-neutral-800 shadow-lg shadow-neutral-900/20 active:scale-[0.98]"
                  >
                    Guardar Dirección
                  </button>
                  <button
                    type="button"
                    onClick={cancelProfileAddressEditing}
                    className="flex-1 sm:flex-none rounded-full bg-white border border-black/10 px-8 py-3.5 text-sm font-bold text-neutral-700 transition hover:bg-neutral-50 active:scale-[0.98]"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="divide-y divide-black/[0.03]">
                  {addresses.length > 0 ? (
                    addresses.map((addr) => (
                      <div
                        key={addr.id}
                        className="flex items-center justify-between gap-4 px-6 py-5 hover:bg-neutral-50/60 transition-all cursor-pointer group"
                        onClick={() => {
                          setProfileAddress(addr);
                          setIsEditingAddress(true);
                        }}
                      >
                        <div className="flex items-center gap-4 min-w-0">
                          <div className="p-3.5 rounded-full bg-neutral-100 text-neutral-400 group-hover:bg-orange-50 group-hover:text-orange-500 transition-colors shadow-sm border border-black/[0.02]">
                            {addr.reference?.toLowerCase().includes('casa') ? (
                              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m0 0l-7 7-7-7M19 10v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
                            ) : addr.reference?.toLowerCase().includes('trabajo') || addr.reference?.toLowerCase().includes('oficina') ? (
                              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                            ) : (
                              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.828 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2.5">
                              <p className="text-[15px] font-bold text-neutral-900 truncate">{addr.reference || 'Dirección'}</p>
                              {addr.isDefault && (
                                <span className="text-[9px] uppercase font-black px-2 py-0.5 bg-neutral-900 text-white rounded-full tracking-widest shadow-sm">Principal</span>
                              )}
                            </div>
                            <p className="text-[13.5px] text-neutral-500 mt-1 truncate font-medium">{addr.street} #{addr.number}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteProfileAddress(addr.id);
                            }}
                            className="p-2.5 rounded-full hover:bg-rose-50 text-neutral-300 hover:text-rose-600 transition-colors"
                            aria-label="Eliminar dirección"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="px-6 py-12 text-center flex flex-col items-center">
                      <div className="h-16 w-16 rounded-full bg-sky-50 flex items-center justify-center mb-4 border border-sky-100/60 shadow-sm shadow-sky-500/10">
                        <svg className="h-8 w-8 text-sky-500" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 010-5 2.5 2.5 0 010 5z" />
                        </svg>
                      </div>
                      <p className="text-neutral-500 font-medium text-[15px]">Aún no tienes direcciones guardadas.</p>
                      <p className="text-neutral-400 text-sm mt-1">Agrega una para agilizar tus pedidos.</p>
                    </div>
                  )}
                </div>
                <div className="px-6 py-5 bg-neutral-50/50 border-t border-black/[0.04]">
                  <button
                    className="w-full py-4 rounded-2xl border-2 border-dashed border-neutral-200 bg-white text-[14px] font-bold text-neutral-600 hover:bg-neutral-50 hover:border-neutral-300 hover:text-neutral-900 transition-all active:scale-[0.99]"
                    onClick={() => {
                      setProfileAddress({ street: '', number: '', apartment: '', neighborhood: '', city: '', state: '', zipCode: '', country: 'MX', reference: '', latitude: 0, longitude: 0, isDefault: false });
                      setIsEditingAddress(true);
                    }}
                  >
                    + Agregar nueva dirección
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── Columna Derecha (5 cols): Preferencias y Ajustes ── */}
        <div className="lg:col-span-5 space-y-5 md:space-y-6 animate-[slideUp_0.4s_ease-out_0.3s_both]">
          
          {/* Preferencias de entrega */}
          <div className="bg-white rounded-[28px] md:rounded-[32px] border border-white/40 shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
            <div className="px-6 py-4 border-b border-black/[0.04] bg-white">
              <h3 className="text-[15px] font-bold text-neutral-900 tracking-tight flex items-center gap-2">
                <svg className="w-4 h-4 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m0 0l-7 7-7-7M19 10v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
                Preferencias
              </h3>
            </div>
            <div className="divide-y divide-black/[0.03]">
              <div className="px-6 py-5 flex items-center justify-between hover:bg-neutral-50/50 cursor-pointer group transition-colors" onClick={() => updatePreferences({ deliveryPreference: customerProfile?.deliveryPreference === 'NO_DOORBELL' ? null : 'NO_DOORBELL' })}>
                <div className="flex flex-col pr-6">
                  <p className="text-[15px] font-bold text-neutral-900">No tocar el timbre</p>
                  <p className="text-[13px] text-neutral-500 mt-1 leading-relaxed">El repartidor dejará el pedido en la puerta sin llamar.</p>
                </div>
                <div className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-300 ease-out focus:outline-none shadow-inner ${customerProfile?.deliveryPreference === 'NO_DOORBELL' ? 'bg-orange-500' : 'bg-neutral-200'}`}>
                  <span aria-hidden="true" className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.1)] ring-0 transition-transform duration-300 ease-out ${customerProfile?.deliveryPreference === 'NO_DOORBELL' ? 'translate-x-5' : 'translate-x-0'}`} />
                </div>
              </div>

              <div className="px-6 py-5 flex items-center justify-between hover:bg-neutral-50/50 cursor-pointer group transition-colors" onClick={() => updatePreferences({ deliveryPreference: customerProfile?.deliveryPreference === 'CALL_ON_ARRIVAL' ? null : 'CALL_ON_ARRIVAL' })}>
                <div className="flex flex-col pr-6">
                  <p className="text-[15px] font-bold text-neutral-900">Llamar al llegar</p>
                  <p className="text-[13px] text-neutral-500 mt-1 leading-relaxed">El repartidor te marcará por teléfono cuando esté afuera.</p>
                </div>
                <div className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-300 ease-out focus:outline-none shadow-inner ${customerProfile?.deliveryPreference === 'CALL_ON_ARRIVAL' ? 'bg-blue-500' : 'bg-neutral-200'}`}>
                  <span aria-hidden="true" className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.1)] ring-0 transition-transform duration-300 ease-out ${customerProfile?.deliveryPreference === 'CALL_ON_ARRIVAL' ? 'translate-x-5' : 'translate-x-0'}`} />
                </div>
              </div>

              <div className="px-6 py-5 flex items-center justify-between hover:bg-neutral-50/50 cursor-pointer group transition-colors" onClick={() => updatePreferences({ deliveryPreference: customerProfile?.deliveryPreference === 'PREFER_WHATSAPP' ? null : 'PREFER_WHATSAPP' })}>
                <div className="flex flex-col pr-6">
                  <p className="text-[15px] font-bold text-neutral-900">Contactar por WhatsApp</p>
                  <p className="text-[13px] text-neutral-500 mt-1 leading-relaxed">Prefiero que me avisen por mensaje, sin llamadas de voz.</p>
                </div>
                <div className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-300 ease-out focus:outline-none shadow-inner ${customerProfile?.deliveryPreference === 'PREFER_WHATSAPP' ? 'bg-green-500' : 'bg-neutral-200'}`}>
                  <span aria-hidden="true" className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.1)] ring-0 transition-transform duration-300 ease-out ${customerProfile?.deliveryPreference === 'PREFER_WHATSAPP' ? 'translate-x-5' : 'translate-x-0'}`} />
                </div>
              </div>

              <div className="px-6 py-5 flex items-center justify-between hover:bg-neutral-50/50 cursor-pointer group transition-colors" onClick={() => updatePreferences({ deliveryPreference: customerProfile?.deliveryPreference === 'HONK_ON_ARRIVAL' ? null : 'HONK_ON_ARRIVAL' })}>
                <div className="flex flex-col pr-6">
                  <p className="text-[15px] font-bold text-neutral-900">Tocar claxon</p>
                  <p className="text-[13px] text-neutral-500 mt-1 leading-relaxed">El repartidor avisará con el claxon al llegar al domicilio.</p>
                </div>
                <div className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-300 ease-out focus:outline-none shadow-inner ${customerProfile?.deliveryPreference === 'HONK_ON_ARRIVAL' ? 'bg-indigo-500' : 'bg-neutral-200'}`}>
                  <span aria-hidden="true" className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.1)] ring-0 transition-transform duration-300 ease-out ${customerProfile?.deliveryPreference === 'HONK_ON_ARRIVAL' ? 'translate-x-5' : 'translate-x-0'}`} />
                </div>
              </div>


            </div>
          </div>

          {/* Alertas y Sonido */}
          <div className="bg-white rounded-[28px] md:rounded-[32px] border border-white/40 shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
            <div className="px-6 py-4 border-b border-black/[0.04] bg-white">
              <h3 className="text-[15px] font-bold text-neutral-900 tracking-tight flex items-center gap-2">
                <svg className="w-4 h-4 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
                Notificaciones
              </h3>
            </div>
            <div className="divide-y divide-black/[0.03]">
              <div className="px-6 py-5 flex items-center justify-between hover:bg-neutral-50/50 cursor-pointer group transition-colors" onClick={() => handleCustomerSoundToggle(!isCustomerSoundEnabled)}>
                <div className="flex flex-col pr-6">
                  <p className="text-[15px] font-bold text-neutral-900">Efectos de sonido</p>
                  <p className="text-[13px] text-neutral-500 mt-1 leading-relaxed">Emite un sonido en este dispositivo cuando llegue tu pedido.</p>
                </div>
                <div className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-300 ease-out focus:outline-none shadow-inner ${isCustomerSoundEnabled ? 'bg-sky-500' : 'bg-neutral-200'}`}>
                  <span aria-hidden="true" className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.1)] ring-0 transition-transform duration-300 ease-out ${isCustomerSoundEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                </div>
              </div>
              <div className="px-6 py-5 flex items-center justify-between hover:bg-neutral-50/50 cursor-pointer group transition-colors" onClick={() => {
                if (isSubscribed) {
                  void unsubscribePush();
                } else {
                  void subscribePush().then(() => setToastMessage('Notificaciones activadas')).catch(() => setToastMessage('No se pudo activar'));
                }
              }}>
                <div className="flex flex-col pr-6">
                  <p className="text-[15px] font-bold text-neutral-900">Notificaciones Push</p>
                  <p className="text-[13px] text-neutral-500 mt-1 leading-relaxed">Recibe alertas vitales aunque la aplicación esté cerrada.</p>
                </div>
                <div className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-300 ease-out focus:outline-none shadow-inner ${isSubscribed ? 'bg-sky-500' : 'bg-neutral-200'}`}>
                  <span aria-hidden="true" className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.1)] ring-0 transition-transform duration-300 ease-out ${isSubscribed ? 'translate-x-5' : 'translate-x-0'}`} />
                </div>
              </div>
            </div>
          </div>

          {/* Ajustes de Cuenta */}
          <div className="bg-white rounded-[28px] md:rounded-[32px] border border-white/40 shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
            <div className="divide-y divide-black/[0.03]">
              <div className="px-6 py-5 flex items-center justify-between hover:bg-neutral-50/60 cursor-pointer transition-colors group" onClick={() => setIsChangingPassword(true)}>
                <div className="flex items-center gap-4">
                  <div className="p-2.5 bg-neutral-100 rounded-full text-neutral-600 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors border border-black/[0.02] shadow-sm">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
                  </div>
                  <p className="text-[15px] font-bold text-neutral-900 group-hover:text-indigo-900 transition-colors">Cambiar contraseña</p>
                </div>
                <div className="h-8 w-8 rounded-full bg-white border border-black/5 flex items-center justify-center text-neutral-400 group-hover:text-indigo-600 group-hover:border-indigo-200 transition-all shadow-sm">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                </div>
              </div>
              <div className="px-6 py-5 flex items-center justify-between hover:bg-rose-50/40 cursor-pointer transition-colors group" onClick={() => clearSession('Has cerrado sesión.')}>
                <div className="flex items-center gap-4">
                  <div className="p-2.5 bg-rose-50 rounded-full text-rose-500 group-hover:bg-rose-100 group-hover:text-rose-600 transition-colors border border-rose-100 shadow-sm">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                  </div>
                  <p className="text-[15px] font-bold text-rose-600 group-hover:text-rose-700 transition-colors">Cerrar sesión de forma segura</p>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
      
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
});
