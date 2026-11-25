export type SavedCard = {
  id: string;
  lastFourDigits: string;
  expirationMonth?: number | null;
  expirationYear?: number | null;
  paymentMethod: { id: string; name: string; type: 'credit_card' | 'debit_card' };
};
