import { calculateInPersonSaleItems, type InPersonCatalogProduct } from './loyalty-inperson-policy';

const product = (overrides: Partial<InPersonCatalogProduct> = {}): InPersonCatalogProduct => ({
  id: 'wings', name: 'Alitas', price: 100, discountPrice: null, promoType: null,
  promoBuyQuantity: null, promoPayQuantity: null, sellBy: 'UNIT', unitPrice: null,
  minWeightG: 100, maxWeightG: 5000, stepWeightG: 100, trackStock: false, stock: 0,
  isAvailable: true, deleted: false, isAdultOnly: false,
  optionGroups: [{ id: 'sauce', name: 'Salsa', minSelection: 1, maxSelection: 1,
    options: [{ id: 'bbq', name: 'BBQ', price: 5, isAvailable: true }] }],
  ...overrides,
});

describe('calculateInPersonSaleItems', () => {
  it('prices trusted unit catalog data and required options; no-stock products stay sellable', () => {
    const sale = calculateInPersonSaleItems([{ productId: 'wings', quantity: 2, optionIds: ['bbq'] }], [product()]);
    expect(sale.subtotalCents).toBe(21000);
    expect(sale.hasPromotion).toBe(false);
    expect(sale.items[0]).toMatchObject({ unitPriceCents: 10500, stockDeducted: false, options: [{ name: 'BBQ', priceCents: 500 }], promotionApplied: false });
    expect(sale.stockRequired.size).toBe(0);
  });

  it('calculates multi-buy and discounts from product data and flags the promotion', () => {
    const sale = calculateInPersonSaleItems([{ productId: 'wings', quantity: 2, optionIds: ['bbq'] }], [product({ promoType: 'MULTI_BUY', promoBuyQuantity: 2, promoPayQuantity: 1 })]);
    expect(sale.subtotalCents).toBe(11000);
    expect(sale.hasPromotion).toBe(true);
  });

  it('applies multi-buy across cart rows for the same product', () => {
    const sale = calculateInPersonSaleItems([
      { productId: 'wings', quantity: 1, optionIds: ['bbq'] },
      { productId: 'wings', quantity: 1, optionIds: ['bbq'] },
    ], [product({ promoType: 'MULTI_BUY', promoBuyQuantity: 2, promoPayQuantity: 1 })]);
    expect(sale.subtotalCents).toBe(11000);
    expect(sale.items.reduce((sum, item) => sum + item.subtotalCents, 0)).toBe(11000);
  });

  it('uses weighted price per kilogram and validates weight increments', () => {
    const weighted = product({ id: 'cake', name: 'Pastel', sellBy: 'WEIGHT', price: 200, unitPrice: 250, optionGroups: [] });
    expect(calculateInPersonSaleItems([{ productId: 'cake', quantity: 2, weightG: 500 }], [weighted]).subtotalCents).toBe(25000);
    expect(() => calculateInPersonSaleItems([{ productId: 'cake', quantity: 1, weightG: 550 }], [weighted])).toThrow('incrementos');
  });

  it('reserves stock only for inventory-tracked unit sales', () => {
    const sale = calculateInPersonSaleItems([{ productId: 'wings', quantity: 3, optionIds: ['bbq'] }], [product({ trackStock: true, stock: 8 })]);
    expect(sale.stockRequired.size).toBe(0);
    expect(sale.items[0].stockDeducted).toBe(false);
  });

  it('rejects missing required options, unavailable products and unsafe quantities', () => {
    expect(() => calculateInPersonSaleItems([{ productId: 'wings', quantity: 1 }], [product()])).toThrow('opciones requeridas');
    expect(() => calculateInPersonSaleItems([{ productId: 'wings', quantity: 1, optionIds: ['bbq'] }], [product({ isAvailable: false })])).toThrow('no está disponible');
    expect(() => calculateInPersonSaleItems([{ productId: 'wings', quantity: 101, optionIds: ['bbq'] }], [product()])).toThrow('1 a 100');
  });
});
