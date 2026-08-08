/**
 * Lógica de visibilidad de promociones por rol y zona.
 * Vista única y testeable (usada por /public/promotions).
 *
 * viewerRole = 'GUEST' para usuarios anónimos; los roles autenticados usan
 * su rol real (CUSTOMER | RESTAURANT | DRIVER).
 */

export type PromotionTargetable = {
  targetRole?: string | null;
  regions?: string[] | null;
};

export type ViewerContext = {
  viewerRole: string;
  resolvedRegion?: string | null;
};

export function isPromotionVisibleToViewer(
  promo: PromotionTargetable,
  viewer: ViewerContext,
): boolean {
  const target = promo.targetRole || 'ALL';

  if (target !== 'ALL' && target !== viewer.viewerRole) return false;

  if (promo.regions && promo.regions.length > 0) {
    if (!viewer.resolvedRegion || !promo.regions.includes(viewer.resolvedRegion)) return false;
  }

  return true;
}

export function applyPromotionRoleFilter<T extends PromotionTargetable>(
  promos: T[],
  viewer: ViewerContext,
): T[] {
  return promos.filter((promo) => isPromotionVisibleToViewer(promo, viewer));
}