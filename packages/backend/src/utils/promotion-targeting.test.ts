import {
  applyPromotionRoleFilter,
  isPromotionVisibleToViewer,
  PromotionTargetable,
} from './promotion-targeting';

const ALL = { targetRole: 'ALL' };
const GUEST = { targetRole: 'GUEST' };
const CUSTOMER = { targetRole: 'CUSTOMER' };
const RESTAURANT = { targetRole: 'RESTAURANT' };
const DRIVER = { targetRole: 'DRIVER' };
const NO_TARGET = { targetRole: null };

describe('isPromotionVisibleToViewer — rol', () => {
  it('anónimo (GUEST) ve promos ALL y GUEST, pero no las de roles autenticados', () => {
    const viewer = { viewerRole: 'GUEST' };
    expect(isPromotionVisibleToViewer(ALL, viewer)).toBe(true);
    expect(isPromotionVisibleToViewer(GUEST, viewer)).toBe(true);
    expect(isPromotionVisibleToViewer(NO_TARGET as PromotionTargetable, viewer)).toBe(true);
    expect(isPromotionVisibleToViewer(CUSTOMER, viewer)).toBe(false);
    expect(isPromotionVisibleToViewer(RESTAURANT, viewer)).toBe(false);
    expect(isPromotionVisibleToViewer(DRIVER, viewer)).toBe(false);
  });

  it('cliente logueado ve promos CUSTOMER y ALL, pero nunca GUEST ni otros roles', () => {
    const viewer = { viewerRole: 'CUSTOMER' };
    expect(isPromotionVisibleToViewer(CUSTOMER, viewer)).toBe(true);
    expect(isPromotionVisibleToViewer(ALL, viewer)).toBe(true);
    expect(isPromotionVisibleToViewer(NO_TARGET as PromotionTargetable, viewer)).toBe(true);
    expect(isPromotionVisibleToViewer(GUEST, viewer)).toBe(false);
    expect(isPromotionVisibleToViewer(RESTAURANT, viewer)).toBe(false);
    expect(isPromotionVisibleToViewer(DRIVER, viewer)).toBe(false);
  });

  it('restaurante y repartidor solo ven su rol + ALL', () => {
    expect(isPromotionVisibleToViewer(GUEST, { viewerRole: 'RESTAURANT' })).toBe(false);
    expect(isPromotionVisibleToViewer(CUSTOMER, { viewerRole: 'RESTAURANT' })).toBe(false);
    expect(isPromotionVisibleToViewer(RESTAURANT, { viewerRole: 'RESTAURANT' })).toBe(true);
    expect(isPromotionVisibleToViewer(ALL, { viewerRole: 'RESTAURANT' })).toBe(true);

    expect(isPromotionVisibleToViewer(GUEST, { viewerRole: 'DRIVER' })).toBe(false);
    expect(isPromotionVisibleToViewer(DRIVER, { viewerRole: 'DRIVER' })).toBe(true);
    expect(isPromotionVisibleToViewer(CUSTOMER, { viewerRole: 'DRIVER' })).toBe(false);
  });
});

describe('isPromotionVisibleToViewer — zonas', () => {
  const gdlPromo = { targetRole: 'ALL', regions: ['Jalisco'] };

  it('promo con regiones solo visible si el viewer está en esa región', () => {
    expect(isPromotionVisibleToViewer(gdlPromo, { viewerRole: 'GUEST', resolvedRegion: 'Jalisco' })).toBe(true);
    expect(isPromotionVisibleToViewer(gdlPromo, { viewerRole: 'GUEST', resolvedRegion: 'CDMX' })).toBe(false);
    expect(isPromotionVisibleToViewer(gdlPromo, { viewerRole: 'GUEST', resolvedRegion: null })).toBe(false);
    expect(isPromotionVisibleToViewer(gdlPromo, { viewerRole: 'GUEST' })).toBe(false);
  });

  it('promo sin regiones es global', () => {
    expect(isPromotionVisibleToViewer(GUEST, { viewerRole: 'GUEST' })).toBe(true);
  });
});

describe('applyPromotionRoleFilter', () => {
  it('filtra una lista completa para el flujo real anónimo→cliente', () => {
    const list = [CUSTOMER, GUEST, ALL, DRIVER, RESTAURANT];

    // Antes de iniciar sesión (anónimo):
    expect(applyPromotionRoleFilter(list, { viewerRole: 'GUEST' })).toEqual([GUEST, ALL]);

    // Tras iniciar sesión como cliente:
    expect(applyPromotionRoleFilter(list, { viewerRole: 'CUSTOMER' })).toEqual([CUSTOMER, ALL]);
  });
});