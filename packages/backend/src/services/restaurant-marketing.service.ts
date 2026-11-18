import crypto from 'node:crypto';
import { prisma } from '../config/database';
import { filterCampaignAudience, type CampaignSegment } from './restaurant-insights';
import { RESTAURANT_ID } from '../config/single-restaurant';
import { readProgram, reconcileLoyalty } from './loyalty-runtime.service';

const CAMPAIGNS_KEY = 'wingslab.restaurant.campaigns.v1';
const loyaltySettingKey = 'wingslab.restaurant.loyalty.v1';
export type Campaign = {
  id: string; title: string; body: string; segment: CampaignSegment; targetUrl: string;
  promoCode: string | null; status: 'DRAFT' | 'SCHEDULED' | 'WAITING_PROVIDER' | 'CANCELLED';
  scheduledAt: string | null; recipientCount: number | null; blockedReason: string | null;
  metrics: { sent: number; failed: number; opened: number | null; conversions: number | null; measurement: string };
  createdAt: string; updatedAt: string;
};

async function withSettingLock<T>(key: string, fn: (tx: any, current: any) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx: any) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))::text', key);
    const row = await tx.systemSetting.findUnique({ where: { key } });
    let current: any = null;
    try { current = row ? JSON.parse(row.value) : null; } catch { current = null; }
    return fn(tx, current);
  });
}
async function writeSetting(tx: any, key: string, value: unknown) {
  const serialized = JSON.stringify(value);
  if (serialized.length > 1_000_000) throw new Error('Stored campaign data exceeds safety limit.');
  await tx.systemSetting.upsert({ where: { key }, create: { key, value: serialized }, update: { value: serialized } });
}
export async function listCampaigns(): Promise<Campaign[]> {
  const row = await prisma.systemSetting.findUnique({ where: { key: CAMPAIGNS_KEY } });
  if (!row) return [];
  try { const value = JSON.parse(row.value); return Array.isArray(value) ? value : []; } catch { return []; }
}
export async function audienceCount(segment: CampaignSegment, now = new Date()): Promise<number> {
  const customers = await prisma.customer.findMany({
    where: { user: { status: 'ACTIVE', OR: [{ pushSubscriptions: { some: {} } }, { fcmTokens: { some: {} } }] } },
    select: { createdAt: true, orders: { where: { restaurantId: RESTAURANT_ID, status: { in: ['DELIVERED', 'COMPLETED', 'PICKED_UP'] } }, select: { createdAt: true } },
      user: { select: { pushSubscriptions: { select: { id: true, updatedAt: true } }, fcmTokens: { select: { id: true, updatedAt: true } } } } },
  });
  return filterCampaignAudience(customers.map(c => ({ createdAt: c.createdAt, orders: c.orders,
    pushSubscriptions: c.user.pushSubscriptions, fcmTokens: c.user.fcmTokens })), segment, now).length;
}
export async function createCampaign(data: Omit<Campaign, 'id' | 'status' | 'recipientCount' | 'blockedReason' | 'metrics' | 'createdAt' | 'updatedAt'>, now = new Date()): Promise<Campaign> {
  if (data.promoCode) {
    const promo = await prisma.promoCode.findFirst({ where: { restaurantId: RESTAURANT_ID, code: { equals: data.promoCode, mode: 'insensitive' }, isActive: true }, select: { id: true } });
    if (!promo) throw Object.assign(new Error('La promoción asociada no está activa en WingsLab.'), { statusCode: 400, code: 'PROMOTION_NOT_FOUND' });
  }
  const count = await audienceCount(data.segment, now);
  const timestamp = now.toISOString();
  const campaign: Campaign = { ...data, id: crypto.randomUUID(), status: data.scheduledAt ? 'SCHEDULED' : 'DRAFT',
    recipientCount: count, blockedReason: null, metrics: { sent: 0, failed: 0, opened: null, conversions: null, measurement: 'provider_disabled_not_measured' }, createdAt: timestamp, updatedAt: timestamp };
  await withSettingLock(CAMPAIGNS_KEY, async (tx, current) => {
    const list: Campaign[] = Array.isArray(current) ? current : [];
    if (list.length >= 250) throw Object.assign(new Error('El historial llegó al límite local de 250 campañas.'), { statusCode: 409, code: 'CAMPAIGN_LIMIT' });
    await writeSetting(tx, CAMPAIGNS_KEY, [campaign, ...list]);
  });
  return campaign;
}
export async function updateCampaign(id: string, patch: Partial<Pick<Campaign, 'title' | 'body' | 'segment' | 'targetUrl' | 'promoCode' | 'scheduledAt'>>): Promise<Campaign> {
  const recipientCount = patch.segment ? await audienceCount(patch.segment) : undefined;
  return withSettingLock(CAMPAIGNS_KEY, async (tx, current) => {
    const list: Campaign[] = Array.isArray(current) ? current : [], index = list.findIndex(c => c.id === id);
    if (index < 0) throw Object.assign(new Error('Campaña no encontrada.'), { statusCode: 404, code: 'CAMPAIGN_NOT_FOUND' });
    if (!['DRAFT', 'SCHEDULED'].includes(list[index].status)) throw Object.assign(new Error('La campaña ya fue preparada y no se puede editar.'), { statusCode: 409, code: 'CAMPAIGN_LOCKED' });
    if (patch.promoCode) {
      const promo = await tx.promoCode.findFirst({ where: { restaurantId: RESTAURANT_ID, code: { equals: patch.promoCode, mode: 'insensitive' }, isActive: true }, select: { id: true } });
      if (!promo) throw Object.assign(new Error('La promoción asociada no está activa en WingsLab.'), { statusCode: 400, code: 'PROMOTION_NOT_FOUND' });
    }
    const scheduledAt = patch.scheduledAt !== undefined ? patch.scheduledAt : list[index].scheduledAt;
    list[index] = { ...list[index], ...patch, ...(recipientCount !== undefined ? { recipientCount } : {}),
      scheduledAt, status: scheduledAt ? 'SCHEDULED' : 'DRAFT', updatedAt: new Date().toISOString() };
    await writeSetting(tx, CAMPAIGNS_KEY, list); return list[index];
  });
}
export async function duplicateCampaign(id: string): Promise<Campaign> {
  return withSettingLock(CAMPAIGNS_KEY, async (tx, current) => {
    const list: Campaign[] = Array.isArray(current) ? current : [], source = list.find(c => c.id === id);
    if (!source) throw Object.assign(new Error('Campaña no encontrada.'), { statusCode: 404, code: 'CAMPAIGN_NOT_FOUND' });
    if (list.length >= 250) throw Object.assign(new Error('El historial llegó al límite local de 250 campañas.'), { statusCode: 409, code: 'CAMPAIGN_LIMIT' });
    const now = new Date().toISOString(), copy: Campaign = { ...source, id: crypto.randomUUID(), title: `${source.title} (copia)`, status: 'DRAFT', scheduledAt: null, recipientCount: null, blockedReason: null, metrics: { sent: 0, failed: 0, opened: null, conversions: null, measurement: 'provider_disabled_not_measured' }, createdAt: now, updatedAt: now };
    await writeSetting(tx, CAMPAIGNS_KEY, [copy, ...list]); return copy;
  });
}
export async function prepareCampaign(id: string): Promise<Campaign> {
  return withSettingLock(CAMPAIGNS_KEY, async (tx, current) => {
    const list: Campaign[] = Array.isArray(current) ? current : [], index = list.findIndex(c => c.id === id);
    if (index < 0) throw Object.assign(new Error('Campaña no encontrada.'), { statusCode: 404, code: 'CAMPAIGN_NOT_FOUND' });
    if (!['DRAFT', 'SCHEDULED'].includes(list[index].status)) throw Object.assign(new Error('La campaña ya fue procesada.'), { statusCode: 409, code: 'CAMPAIGN_LOCKED' });
    if (list[index].scheduledAt && new Date(list[index].scheduledAt) > new Date()) throw Object.assign(new Error('La campaña todavía no alcanza su fecha programada.'), { statusCode: 409, code: 'CAMPAIGN_NOT_DUE' });
    const count = await audienceCount(list[index].segment);
    if (!count) throw Object.assign(new Error('No hay clientes con notificaciones autorizadas en este segmento.'), { statusCode: 409, code: 'EMPTY_CAMPAIGN_AUDIENCE' });
    // FCM/Web Push are intentionally not configured in this local installation. Never enqueue or send.
    list[index] = { ...list[index], status: 'WAITING_PROVIDER', recipientCount: count, blockedReason: 'PUSH_PROVIDER_NOT_CONFIGURED', updatedAt: new Date().toISOString() };
    await writeSetting(tx, CAMPAIGNS_KEY, list); return list[index];
  });
}
export async function cancelCampaign(id: string): Promise<Campaign> {
  return withSettingLock(CAMPAIGNS_KEY, async (tx, current) => {
    const list: Campaign[] = Array.isArray(current) ? current : [], index = list.findIndex(c => c.id === id);
    if (index < 0) throw Object.assign(new Error('Campaña no encontrada.'), { statusCode: 404, code: 'CAMPAIGN_NOT_FOUND' });
    list[index] = { ...list[index], status: 'CANCELLED', updatedAt: new Date().toISOString() };
    await writeSetting(tx, CAMPAIGNS_KEY, list); return list[index];
  });
}
export async function getLoyaltyConfiguration() {
  const row = await prisma.systemSetting.findUnique({ where: { key: loyaltySettingKey } });
  const defaults = { enabled: false, pointsPer100: 1, rewardPoints: 100, rewardAmount: 10, stampGoal: 8, rewardType: 'DISCOUNT', rewardKind: 'AMOUNT', rewardValue: 1000, rewardProductId: null as string | null, programVersion: 0, redemptionReady: false, rewardDescription: '', stampTerms: '', stampStartsAt: null as string | null };
  try { return { ...defaults, ...(row ? JSON.parse(row.value) : {}) }; }
  catch { return defaults; }
}
export async function saveLoyaltyConfiguration(data: { enabled: boolean; pointsPer100: number; rewardPoints: number; rewardAmount: number; stampGoal?: number; rewardType?: string; rewardDescription?: string; stampTerms?: string; rewardKind: 'AMOUNT' | 'PERCENT' | 'PRODUCT'; rewardValue: number | null; rewardProductId: string | null }) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${loyaltySettingKey}))::text`;
    const row = await tx.systemSetting.findUnique({ where: { key: loyaltySettingKey } });
    const current = row ? JSON.parse(row.value) : {};
    const oldProgram = await readProgram(tx);
    if (oldProgram) {
      // Materialize pending history under OLD rules before publishing a change.
      const customers = await tx.customer.findMany({ where: { orders: { some: { restaurantId: RESTAURANT_ID } } }, select: { id: true }, orderBy: { id: 'asc' } });
      for (const customer of customers) await reconcileLoyalty(tx, customer.id, oldProgram);
    }
    if (data.rewardKind === 'PRODUCT') {
      const product = await tx.product.findFirst({ where: { id: data.rewardProductId!, restaurantId: RESTAURANT_ID, deleted: false, isAvailable: true, sellBy: 'UNIT', isAdultOnly: false }, select: { id: true, optionGroups: { select: { minSelection: true } } } });
      if (!product || product.optionGroups.some(g => g.minSelection > 0)) throw Object.assign(new Error('Selecciona un producto disponible, por unidad y sin opciones obligatorias.'), { statusCode: 400, code: 'INVALID_LOYALTY_PRODUCT' });
    }
    const now = new Date().toISOString();
    const stampStartsAt = current.stampStartsAt || (data.enabled ? now : null);
    const activePeriods: Array<{ from: string; to: string | null }> = current.activePeriods ? current.activePeriods.map((p: { from: string; to: string | null }) => ({ ...p })) : stampStartsAt ? [{ from: stampStartsAt, to: current.enabled ? null : now }] : [];
    if (!data.enabled && activePeriods[activePeriods.length - 1]?.to === null) activePeriods[activePeriods.length - 1].to = now;
    if (data.enabled && (!activePeriods.length || activePeriods[activePeriods.length - 1].to !== null)) activePeriods.push({ from: now, to: null });
    const next = { ...current, ...data, programVersion: (current.programVersion || 0) + 1, redemptionReady: true, stampStartsAt, activePeriods };
    await tx.systemSetting.upsert({ where: { key: loyaltySettingKey }, create: { key: loyaltySettingKey, value: JSON.stringify(next) }, update: { value: JSON.stringify(next) } });
    return next;
  }, { timeout: 60000 });
}
