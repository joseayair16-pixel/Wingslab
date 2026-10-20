/** Accept a customer supplied Mexican phone only in local 10-digit format. */
export function isMexicanLocalPhone(phone: string): boolean {
  return /^\d{10}$/.test(phone);
}

/** Normalize phone formats already stored by older SaDeL versions. */
export function normalizeStoredMexicanPhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith('52')) return digits.slice(2);
  if (digits.length === 13 && digits.startsWith('521')) return digits.slice(3);
  return null;
}

/** Meta sends WhatsApp sender IDs with the country code and sometimes legacy 521. */
export function normalizeWhatsAppSenderPhone(phone: string): string | null {
  return normalizeStoredMexicanPhone(phone);
}

/** Convert a configured SaDeL WhatsApp number to the digits-only wa.me form. */
export function toWhatsAppLinkNumber(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `52${digits}`;
  if (digits.length === 12 && digits.startsWith('52')) return digits;
  if (digits.length === 13 && digits.startsWith('521')) return digits;
  return null;
}
