import { Prisma } from '@prisma/client';

export function normalizeOptionalAddressText(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function buildApartmentWhere(value?: string | null): Pick<Prisma.AddressWhereInput, 'apartment' | 'OR'> {
  const apartment = normalizeOptionalAddressText(value);

  if (apartment) {
    return { apartment: { equals: apartment, mode: 'insensitive' } };
  }

  return {
    OR: [
      { apartment: null },
      { apartment: '' },
    ],
  };
}
