import { z } from 'zod';

export const internalMenuPath = z.string().max(200).refine(value =>
  value === '' || (/^\/(?!\/)[a-zA-Z0-9/_?#=&%.-]*$/.test(value) && !/\.\.|%|\\/.test(value)),
'Usa una ruta interna de WingsLab, sin dominios externos.');

export const menuContentItemSchema = z.object({
  id: z.string().uuid(), kind: z.enum(['modal', 'banner']),
  title: z.string().trim().min(1).max(80), text: z.string().trim().max(240),
  imageId: z.string().uuid(), targetUrl: internalMenuPath,
  buttonLabel: z.string().trim().max(35), active: z.boolean(),
  audience: z.enum(['all', 'visitors', 'customers']),
  frequency: z.enum(['session', 'daily', 'once']),
  startsAt: z.string().datetime().nullable(), endsAt: z.string().datetime().nullable(),
}).strict().refine(item => !item.startsAt || !item.endsAt || Date.parse(item.endsAt) > Date.parse(item.startsAt),
  'La fecha final debe ser posterior a la inicial.');
export const menuContentSchema = z.object({
  revision: z.number().int().nonnegative(),
  items: z.array(menuContentItemSchema).max(24),
}).strict().refine(data => new Set(data.items.map(item => item.id)).size === data.items.length, 'Hay identificadores duplicados.');
export type MenuContentItem = z.infer<typeof menuContentItemSchema>;
export type MenuContent = z.infer<typeof menuContentSchema>;

export function visibleMenuContent(items: MenuContentItem[], customer: boolean, now = new Date()) {
  return items.filter(item => item.active &&
    (!item.startsAt || Date.parse(item.startsAt) <= now.getTime()) &&
    (!item.endsAt || Date.parse(item.endsAt) > now.getTime()) &&
    (item.audience === 'all' || item.audience === (customer ? 'customers' : 'visitors')));
}
