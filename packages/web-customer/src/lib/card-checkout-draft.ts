import type { SavedCard } from './savedCards';

type Draft = {
  body: Record<string, unknown>;
  userId: string;
  restaurantId: string;
  savedCard?: SavedCard | null;
};

// Keep the address and checkout details in memory, never in the URL or storage.
let draft: Draft | null = null;
export const setCardCheckoutDraft = (value: Draft | null) => { draft = value; };
export const getCardCheckoutDraft = () => draft;
