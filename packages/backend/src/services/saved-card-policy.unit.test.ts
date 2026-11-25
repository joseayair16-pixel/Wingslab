import { resolveOwnedSavedCard, saveCardRequestSchema } from './saved-card-policy';

const card = {
  id: 'card-owned',
  last_four_digits: '1234',
  payment_method: { id: 'visa', payment_type_id: 'credit_card' as const },
};

test('requiere consentimiento explícito y no acepta campos adicionales', () => {
  expect(saveCardRequestSchema.safeParse({ cardToken: 'one-time-token' }).success).toBe(false);
  expect(saveCardRequestSchema.safeParse({ consent: false, cardToken: 'one-time-token' }).success).toBe(false);
  expect(saveCardRequestSchema.safeParse({ consent: true, cardToken: 'one-time-token', save: false }).success).toBe(false);
  expect(saveCardRequestSchema.safeParse({ consent: true, cardToken: 'one-time-token' }).success).toBe(true);
});

test('solo resuelve una tarjeta incluida en la bóveda del cliente autenticado', () => {
  expect(resolveOwnedSavedCard([card], 'card-owned')).toBe(card);
  expect(resolveOwnedSavedCard([card], 'card-someone-elses')).toBeNull();
  expect(resolveOwnedSavedCard([], 'card-owned')).toBeNull();
});
