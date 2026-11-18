import { menuContentSchema, internalMenuPath, visibleMenuContent, type MenuContentItem } from './menu-content-policy';

const item: MenuContentItem = {
  id: '42aac45b-9538-4599-81e0-611eadbd55d2', kind: 'modal', title: 'Bienvenido', text: '',
  imageId: 'c39e24e6-127c-4719-b213-e2fd0e91f0ac', targetUrl: '/cuenta', buttonLabel: 'Ver', active: true,
  audience: 'all', frequency: 'session', startsAt: null, endsAt: null,
};
describe('Local menu content policy', () => {
  test.each(['https://external.test', '//external.test', '/\\external.test', '/%2fexternal', '/a/../b', 'javascript:alert(1)', '/\nfoo'])('rejects unsafe link %s', value => {
    expect(internalMenuPath.safeParse(value).success).toBe(false);
  });
  test.each(['', '/', '/cuenta', '/?checkout=true', '/#alitas'])('accepts internal link %s', value => {
    expect(internalMenuPath.safeParse(value).success).toBe(true);
  });
  it('validates dates, unique IDs and maximum count', () => {
    expect(menuContentSchema.safeParse({ revision: 0, items: [item] }).success).toBe(true);
    expect(menuContentSchema.safeParse({ revision: 0, items: [item, item] }).success).toBe(false);
    expect(menuContentSchema.safeParse({ revision: 0, items: Array(25).fill(item) }).success).toBe(false);
    expect(menuContentSchema.safeParse({ revision: 0, items: [{ ...item, startsAt: '2026-11-16T10:00:00Z', endsAt: '2026-11-15T10:00:00Z' }] }).success).toBe(false);
  });
  it('filters active dates and audience without reordering', () => {
    const now = new Date('2026-11-15T12:00:00Z');
    const items = [item, { ...item, id: 'client', audience: 'customers' as const }, { ...item, id: 'visitor', audience: 'visitors' as const }, { ...item, id: 'inactive', active: false }, { ...item, id: 'future', startsAt: '2026-11-16T00:00:00Z' }, { ...item, id: 'expired', endsAt: now.toISOString() }];
    expect(visibleMenuContent(items, false, now).map(i => i.id)).toEqual([item.id, 'visitor']);
    expect(visibleMenuContent(items, true, now).map(i => i.id)).toEqual([item.id, 'client']);
  });
});
