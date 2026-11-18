import { loyaltyDiscount, loyaltyProgress } from './loyalty-policy';

describe('reglas puras de fidelidad', () => {
  it('habilita el premio para la compra que completa la tarjeta', () => {
    expect(loyaltyProgress({ completedOrders: 7, redeemedRewards: 0, goal: 8, rewardReserved: false })).toMatchObject({ stamps: 7, eligibleForNextOrder: true, eligibility: 'completing' });
  });
  it('conserva un premio y dos sellos cuando hay diez compras previas', () => {
    expect(loyaltyProgress({ completedOrders: 10, redeemedRewards: 0, goal: 8, rewardReserved: false })).toMatchObject({ stamps: 2, availableRewards: 1, eligibility: 'earned' });
  });
  it('mantiene varios premios históricos sin perder el progreso restante', () => {
    expect(loyaltyProgress({ completedOrders: 19, redeemedRewards: 0, goal: 8, rewardReserved: false })).toMatchObject({ stamps: 3, availableRewards: 2 });
  });
  it('no permite un segundo pedido premiado mientras existe una reserva', () => {
    expect(loyaltyProgress({ completedOrders: 7, redeemedRewards: 0, goal: 8, rewardReserved: true }).eligibleForNextOrder).toBe(false);
  });
  it('rechaza registros inconsistentes', () => {
    expect(() => loyaltyProgress({ completedOrders: 7, redeemedRewards: 1, goal: 8, rewardReserved: false })).toThrow();
  });
  it('calcula en centavos y limita el descuento al subtotal', () => {
    expect(loyaltyDiscount({ subtotalCents: 1555, kind: 'percent', value: 10, otherPromotionApplied: false })).toBe(156);
    expect(loyaltyDiscount({ subtotalCents: 1000, kind: 'amount', value: 2000, otherPromotionApplied: false })).toBe(1000);
  });
  it('rechaza promociones combinadas y porcentajes inválidos', () => {
    expect(() => loyaltyDiscount({ subtotalCents: 1000, kind: 'percent', value: 10, otherPromotionApplied: true })).toThrow();
    expect(() => loyaltyDiscount({ subtotalCents: 1000, kind: 'percent', value: 101, otherPromotionApplied: false })).toThrow();
  });
});
