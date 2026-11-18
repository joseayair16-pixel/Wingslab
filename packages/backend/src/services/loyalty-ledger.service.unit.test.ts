import { recordLoyaltyStamp, reserveLoyaltyReward, settleLoyaltyReservation, LoyaltySnapshot } from './loyalty-ledger.service';

const snapshot: LoyaltySnapshot = { programVersion: 1, goal: 8, rewardKind: 'AMOUNT', rewardValue: 1000, rewardProductId: null, rewardProductName: null, rewardDescription: '$10 de descuento', terms: '' };
function transaction() {
  return {
    $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    order: { findFirst: jest.fn().mockResolvedValue({ status: 'DELIVERED', fulfillmentType: 'DELIVERY' }) },
    loyaltyCard: { findFirst: jest.fn().mockResolvedValue({ id: 'card', goal: 8 }), create: jest.fn(), update: jest.fn() },
    loyaltyStamp: { findUnique: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(0), create: jest.fn().mockResolvedValue({ id: 'stamp' }) },
    loyaltyRedemption: { findUnique: jest.fn().mockResolvedValue({ id: 'redemption', state: 'RESERVED', cardId: 'card', discountCents: 1000 }), findFirst: jest.fn().mockResolvedValue(null), update: jest.fn(), delete: jest.fn(), create: jest.fn() },
    auditLog: { create: jest.fn() },
  };
}
describe('loyalty transactional ledger helpers', () => {
  it('reserves only once for an idempotent order', async () => {
    const tx = transaction(); tx.order.findFirst.mockResolvedValue({ status: 'PENDING', fulfillmentType: 'DELIVERY' }); await reserveLoyaltyReward(tx, 'customer', 'order', 'card', 1000);
    expect(tx.loyaltyRedemption.create).not.toHaveBeenCalled();
  });
  it('rejects a second outstanding reward reservation', async () => {
    const tx = transaction(); tx.order.findFirst.mockResolvedValue({ status: 'PENDING', fulfillmentType: 'DELIVERY' }); tx.loyaltyRedemption.findUnique.mockResolvedValue(null); tx.loyaltyRedemption.findFirst.mockResolvedValue({ id: 'busy' });
    await expect(reserveLoyaltyReward(tx, 'customer', 'order', 'card', 1000)).rejects.toThrow('already reserved');
    expect(tx.loyaltyRedemption.create).not.toHaveBeenCalled();
  });
  it('does not stamp the same order twice', async () => {
    const tx = transaction(); tx.loyaltyStamp.findUnique.mockResolvedValue({ id: 'existing' });
    expect((await recordLoyaltyStamp(tx, 'customer', 'order', snapshot, new Date())).duplicate).toBe(true);
    expect(tx.loyaltyStamp.create).not.toHaveBeenCalled();
  });
  it('completes a card using its original goal, not new program rules', async () => {
    const tx = transaction(); tx.loyaltyStamp.count.mockResolvedValue(7);
    await recordLoyaltyStamp(tx, 'customer', 'order', { ...snapshot, goal: 20 }, new Date());
    expect(tx.loyaltyCard.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: 'COMPLETED' }) }));
    expect(tx.loyaltyCard.create).not.toHaveBeenCalled();
  });
  it('releases a cancelled reservation with an audit entry', async () => {
    const tx = transaction(); tx.order.findFirst.mockResolvedValue({ status: 'CANCELLED', fulfillmentType: 'DELIVERY' }); await settleLoyaltyReservation(tx, 'customer', 'order', 'cancelled', new Date());
    expect(tx.auditLog.create).toHaveBeenCalled(); expect(tx.loyaltyRedemption.delete).toHaveBeenCalledWith({ where: { id: 'redemption' } });
  });
  it('never releases a completed redemption', async () => {
    const tx = transaction(); tx.order.findFirst.mockResolvedValue({ status: 'CANCELLED', fulfillmentType: 'DELIVERY' }); tx.loyaltyRedemption.findUnique.mockResolvedValue({ id: 'redemption', state: 'COMPLETED', cardId: 'card', discountCents: 1000 });
    await settleLoyaltyReservation(tx, 'customer', 'order', 'cancelled', new Date());
    expect(tx.loyaltyRedemption.delete).not.toHaveBeenCalled();
  });
  it('never stamps an order still in transit', async () => {
    const tx = transaction(); tx.order.findFirst.mockResolvedValue({ status: 'PICKED_UP', fulfillmentType: 'DELIVERY' });
    await expect(recordLoyaltyStamp(tx, 'customer', 'order', snapshot, new Date())).rejects.toThrow('completed');
    expect(tx.loyaltyStamp.create).not.toHaveBeenCalled();
  });
  it('does not release a reservation when the order is still active', async () => {
    const tx = transaction(); tx.order.findFirst.mockResolvedValue({ status: 'PENDING', fulfillmentType: 'DELIVERY' });
    await expect(settleLoyaltyReservation(tx, 'customer', 'order', 'cancelled', new Date())).rejects.toThrow('state');
    expect(tx.loyaltyRedemption.delete).not.toHaveBeenCalled();
  });
});
