import { validateOptionSelection } from './order.service';
const groups = [
  { id: 'g1', name: 'Salsa', minSelection: 1, maxSelection: 1, options: [{ id: 'o1', isAvailable: true }, { id: 'o2', isAvailable: false }] },
  { id: 'g2', name: 'Extras', minSelection: 0, maxSelection: 2, options: [{ id: 'o3', isAvailable: true }, { id: 'o4', isAvailable: true }, { id: 'o5', isAvailable: true }] },
];
test('accepts valid required/optional option groups', () => expect(validateOptionSelection(groups, ['o1', 'o3'])).toBe(true));
test.each([
  { ids: ['o3'] },
  { ids: ['o1', 'o2'] },
  { ids: ['o1', 'o3', 'o4', 'o5'] },
  { ids: ['o1', 'o1'] },
  { ids: ['o1', 'other-product-option'] },
])('rejects invalid or duplicated selection $ids', ({ ids }) => {
  expect(() => validateOptionSelection(groups, ids)).toThrow();
});
