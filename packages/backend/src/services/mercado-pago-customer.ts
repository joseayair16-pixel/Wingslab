import { createHash } from 'node:crypto';
import { z } from 'zod';

const api = 'https://api.mercadopago.com';

const cardSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  last_four_digits: z.string().regex(/^\d{4}$/),
  expiration_month: z.number().int().min(1).max(12).optional().nullable(),
  expiration_year: z.number().int().min(2000).max(2200).optional().nullable(),
  payment_method: z.object({
    id: z.string().min(1).max(40),
    name: z.string().optional(),
    payment_type_id: z.enum(['credit_card', 'debit_card']),
  }),
  issuer: z.object({ id: z.union([z.string(), z.number()]).transform(String).optional() }).optional(),
});

export type MercadoPagoSavedCard = z.infer<typeof cardSchema>;

async function providerRequest<S extends z.ZodTypeAny>(accessToken: string, path: string, schema: S, init?: RequestInit): Promise<z.output<S>> {
  if (!accessToken.trim()) throw new Error('Falta configurar el Access Token de Mercado Pago.');
  const response = await fetch(`${api}${path}`, {
    ...init,
    headers: { Accept: 'application/json', ...init?.headers, Authorization: `Bearer ${accessToken}` },
    redirect: 'error',
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Mercado Pago Customer respondió HTTP ${response.status}.`);
  return schema.parse(await response.json());
}

const customerResponse = z.object({ id: z.string().min(1).max(128) });
const customerSearchResponse = z.object({ results: z.array(customerResponse).max(100) });
const cardsResponse = z.array(cardSchema).max(100);

/** Test vault uses Mercado Pago's required test-payer email format without exposing a real account email. */
export function sandboxPayerEmail(customerId: string): string {
  const digits = BigInt(`0x${createHash('sha256').update(customerId).digest('hex').slice(0, 14)}`)
    .toString().slice(0, 10).padStart(1, '1');
  return `test_payer_${digits}@testuser.com`;
}

export async function createMercadoPagoCustomer(accessToken: string, email: string, firstName?: string, lastName?: string) {
  return providerRequest(accessToken, '/v1/customers', customerResponse, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, ...(firstName ? { first_name: firstName } : {}), ...(lastName ? { last_name: lastName } : {}) }),
  });
}

export async function findMercadoPagoCustomer(accessToken: string, email: string) {
  const query = new URLSearchParams({ email });
  const result = await providerRequest(accessToken, `/v1/customers/search?${query}`, customerSearchResponse);
  return result.results[0] ?? null;
}

export function listMercadoPagoCards(accessToken: string, customerId: string) {
  return providerRequest(accessToken, `/v1/customers/${encodeURIComponent(customerId)}/cards`, cardsResponse);
}

export function saveMercadoPagoCard(accessToken: string, customerId: string, cardToken: string) {
  return providerRequest(accessToken, `/v1/customers/${encodeURIComponent(customerId)}/cards`, cardSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: cardToken }),
  });
}

export async function deleteMercadoPagoCard(accessToken: string, customerId: string, cardId: string) {
  if (!accessToken.trim()) throw new Error('Falta configurar el Access Token de Mercado Pago.');
  const response = await fetch(`${api}/v1/customers/${encodeURIComponent(customerId)}/cards/${encodeURIComponent(cardId)}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
    redirect: 'error',
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Mercado Pago Customer respondió HTTP ${response.status}.`);
}
