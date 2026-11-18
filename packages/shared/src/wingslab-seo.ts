export type RestaurantSeoSource = {
  name?: string | null;
  description?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  hasOwnDelivery?: boolean | null;
  pickupOnly?: boolean | null;
};

export const RESTAURANT_SEO_TITLE_MAX_LENGTH = 65;
export const RESTAURANT_SEO_DESCRIPTION_MAX_LENGTH = 160;

export function normalizeSeoText(value: string | null | undefined): string {
  const normalized = Array.from(value ?? '', (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127 ? ' ' : character;
  }).join('');

  return normalized
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateAtWord(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const prefix = value.slice(0, maxLength - 1);
  const lastSpace = prefix.lastIndexOf(' ');
  return `${(lastSpace > maxLength * 0.65 ? prefix.slice(0, lastSpace) : prefix).trimEnd()}…`;
}

export function buildRestaurantSeoTitle(source: RestaurantSeoSource | null): string {
  const configuredTitle = normalizeSeoText(source?.seoTitle);
  const name = normalizeSeoText(source?.name) || 'WingsLab';
  return truncateAtWord(
    configuredTitle || `Menú en línea de ${name}`,
    RESTAURANT_SEO_TITLE_MAX_LENGTH,
  );
}

export function buildRestaurantSeoDescription(source: RestaurantSeoSource | null): string {
  const configuredDescription = normalizeSeoText(source?.seoDescription);
  if (configuredDescription) {
    return truncateAtWord(configuredDescription, RESTAURANT_SEO_DESCRIPTION_MAX_LENGTH);
  }

  const name = normalizeSeoText(source?.name) || 'WingsLab';
  const businessDescription = normalizeSeoText(source?.description);
  const serviceDescription = source?.pickupOnly
    ? 'Consulta el menú y pide para recoger en tienda.'
    : source?.hasOwnDelivery
      ? 'Consulta el menú y pide para recoger o recibir a domicilio.'
      : 'Consulta el menú y realiza tu pedido en línea.';

  if (!businessDescription) {
    return truncateAtWord(
      `${name}. ${serviceDescription}`,
      RESTAURANT_SEO_DESCRIPTION_MAX_LENGTH,
    );
  }

  const descriptionBudget = Math.max(
    48,
    RESTAURANT_SEO_DESCRIPTION_MAX_LENGTH - serviceDescription.length - 1,
  );
  return truncateAtWord(
    `${truncateAtWord(businessDescription, descriptionBudget)} ${serviceDescription}`,
    RESTAURANT_SEO_DESCRIPTION_MAX_LENGTH,
  );
}
