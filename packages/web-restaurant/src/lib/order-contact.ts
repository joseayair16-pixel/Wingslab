// Presentación de los datos de contacto del comensal en el panel del restaurante.
// Los campos vienen de Prisma y pueden ser nulos o estar vacíos: ninguna función
// debe producir "undefined", "null" ni direcciones a medias.

export type OrderContactUser = {
  name?: string | null;
  lastName?: string | null;
  phone?: string | null;
};

export type OrderContactAddress = {
  street?: string | null;
  number?: string | null;
  apartment?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  country?: string | null;
  reference?: string | null;
};

function clean(value?: string | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Nombre completo (todos los apellidos), o '' si no hay datos. */
export function formatCustomerName(user?: OrderContactUser | null): string {
  const parts = [clean(user?.name), clean(user?.lastName)]
    .flatMap((part) => part.split(/\s+/))
    .filter(Boolean);
  return parts.join(' ');
}

/** Etiqueta visible del teléfono, con fallback explícito. */
export function formatCustomerPhone(phone?: string | null): string {
  return clean(phone) || 'Teléfono no disponible';
}

/** href tel: seguro; null cuando no hay un número utilizable. */
export function customerPhoneHref(phone?: string | null): string | null {
  const value = clean(phone);
  if (!value) return null;
  const prefix = value.startsWith('+') ? '+' : '';
  const digits = value.replace(/\D/g, '');
  return digits ? `tel:${prefix}${digits}` : null;
}

/** Dirección completa de entrega, sin valores vacíos ni "undefined". */
export function formatCustomerAddress(address?: OrderContactAddress | null): string {
  if (!address) return 'Dirección no disponible.';

  const streetLine = [clean(address.street), clean(address.number)].filter(Boolean).join(' ');
  const apartment = clean(address.apartment);
  const neighborhood = clean(address.neighborhood);
  const cityState = [clean(address.city), clean(address.state)].filter(Boolean).join(', ');
  const zipCode = clean(address.zipCode);
  const country = clean(address.country);
  const reference = clean(address.reference);

  const segments = [
    streetLine,
    apartment ? `Depto. ${apartment}` : '',
    neighborhood,
    cityState,
    zipCode,
    country,
  ].filter(Boolean);

  const base = segments.join(', ');
  const withReference = reference ? `${base}${base ? ' · ' : ''}Ref: ${reference}` : base;
  return withReference || 'Dirección no disponible.';
}
