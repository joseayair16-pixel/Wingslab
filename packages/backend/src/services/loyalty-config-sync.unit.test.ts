type Tx = {
  $queryRaw: jest.Mock;
  systemSetting: { findUnique: jest.Mock; upsert: jest.Mock };
  product: { findFirst: jest.Mock };
  customer: { findMany: jest.Mock };
  loyaltyCard: { updateMany: jest.Mock };
};

describe('cambio de recompensa en el panel', () => {
  let tx: Tx;
  let saveLoyaltyConfiguration: (data: Record<string, unknown>) => Promise<{ programVersion: number }>;

  beforeAll(() => {
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      systemSetting: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
      product: { findFirst: jest.fn().mockResolvedValue({ id: 'refresco', name: 'Refresco', optionGroups: [] }) },
      customer: { findMany: jest.fn().mockResolvedValue([]) },
      loyaltyCard: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    jest.doMock('../config/database', () => ({ prisma: { $transaction: (fn: (tx: Tx) => Promise<unknown>) => fn(tx) } }));
    jest.doMock('./loyalty-runtime.service', () => ({ readProgram: jest.fn().mockResolvedValue(null), reconcileLoyalty: jest.fn() }));
    ({ saveLoyaltyConfiguration } = require('./restaurant-marketing.service'));
  });

  const base = {
    enabled: true, pointsPer100: 1, rewardPoints: 100, rewardAmount: 10,
    stampGoal: 10, rewardType: 'PRODUCT', stampTerms: 'Válido en compras en local',
  };

  it('aplica la nueva recompensa a las tarjetas abiertas sin canje reservado', async () => {
    await saveLoyaltyConfiguration({ ...base, rewardKind: 'PRODUCT', rewardValue: null, rewardProductId: 'refresco', rewardDescription: 'Refresco de regalo' });
    expect(tx.loyaltyCard.updateMany).toHaveBeenCalledWith({
      where: { restaurantId: expect.any(String), state: 'OPEN', redemption: { is: null } },
      data: expect.objectContaining({
        programVersion: 1,
        rewardKind: 'PRODUCT',
        rewardProductId: 'refresco',
        rewardProductName: 'Refresco',
        rewardDescription: 'Refresco de regalo',
        terms: 'Válido en compras en local',
      }),
    });
  });

  it('sincroniza también los descuentos y no consulta producto', async () => {
    tx.product.findFirst.mockClear();
    await saveLoyaltyConfiguration({ ...base, rewardType: 'DISCOUNT', rewardKind: 'AMOUNT', rewardValue: 1000, rewardProductId: null, rewardDescription: '$10 de descuento' });
    expect(tx.product.findFirst).not.toHaveBeenCalled();
    expect(tx.loyaltyCard.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ state: 'OPEN' }),
      data: expect.objectContaining({ rewardKind: 'AMOUNT', rewardValue: 1000, rewardProductId: null, rewardProductName: null, rewardDescription: '$10 de descuento' }),
    });
  });
});
