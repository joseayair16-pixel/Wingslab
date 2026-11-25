export type MenuPromotion = {
  id: string;
  kind: 'modal' | 'banner';
  audience: 'all' | 'visitors' | 'customers';
  title: string;
  text: string;
  imageId: string;
  targetUrl: string;
  buttonLabel: string;
  frequency: 'session' | 'daily' | 'once';
  startsAt: string | null;
  endsAt: string | null;
};

export const MENU_PROMOTIONS_PATH = '/public/menu-content';
export const menuPromotionImage = (apiBase: string, imageId: string) => `${apiBase}/public/menu-images/${encodeURIComponent(imageId)}`;

export function readMenuPromotions(payload: unknown): MenuPromotion[] | null {
  const response = payload as { success?: boolean; data?: unknown } | null;
  if (response?.success !== true || !Array.isArray(response.data)) return null;
  return response.data.filter((entry: unknown): entry is MenuPromotion => {
    const item = entry as Partial<MenuPromotion> | null;
    return !!item && typeof item.id === 'string' && typeof item.title === 'string' &&
      (item.kind === 'banner' || item.kind === 'modal') &&
      (item.audience === 'all' || item.audience === 'visitors' || item.audience === 'customers') &&
      (item.frequency === 'once' || item.frequency === 'daily' || item.frequency === 'session') &&
      typeof item.text === 'string' && typeof item.targetUrl === 'string' && typeof item.buttonLabel === 'string' &&
      (item.startsAt === null || typeof item.startsAt === 'string') &&
      (item.endsAt === null || typeof item.endsAt === 'string') &&
      typeof item.imageId === 'string' && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(item.imageId);
  });
}
