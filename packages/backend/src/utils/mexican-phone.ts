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
