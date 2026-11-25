import { z } from 'zod';
import type { MercadoPagoSavedCard } from './mercado-pago-customer';

export const saveCardRequestSchema = z.object({
  consent: z.literal(true),
  cardToken: z.string().min(8).max(512),
}).strict();

/** Only IDs returned by the authenticated customer's provider vault are eligible. */
export function resolveOwnedSavedCard(cards: MercadoPagoSavedCard[], requestedId: string): MercadoPagoSavedCard | null {
  return cards.find(card => card.id === requestedId) ?? null;
}
