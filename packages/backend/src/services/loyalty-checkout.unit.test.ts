import { createOrderForCustomer } from './order.service';
import { RESTAURANT_ID } from '../config/single-restaurant';
import * as runtime from './loyalty-runtime.service';
import * as hours from '../utils/restaurant';

function fixture() {
  const tx = {
    $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    $queryRaw: jest.fn().mockResolvedValue([]),
    order: { aggregate: jest.fn().mockResolvedValue({ _max: { dailyCounter: null } }), findUnique: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(0), create: jest.fn().mockImplementation(async ({ data }) => ({ id: 'created', orderReference: 'WL-1', customerId: 'customer', ...data })) },
    customer: { update: jest.fn().mockResolvedValue({}) },
    product: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const db = {
    customer: { findUnique: jest.fn().mockResolvedValue({ id: 'customer', user: { status: 'ACTIVE' }, isSuspendedByDebt: false }) },
    restaurant: { findUnique: jest.fn().mockResolvedValue({ id: RESTAURANT_ID, region: 'WingsLab', latitude: 19, longitude: -99, status: 'ACTIVE', isAcceptingOrders: true, hasOwnDelivery: true, operatingHours: [], maxDeliveryTime: 15, user: { id: 'owner' } }) },
    product: { findMany: jest.fn().mockResolvedValue([{ id: 'product', name: 'Alitas', price: 100, discountPrice: null, optionGroups: [], sellBy: 'UNIT', trackStock: true, stock: 5 }]) },
    region: { findUnique: jest.fn().mockResolvedValue(null) },
    order: { findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn().mockImplementation(async callback => callback(tx)),
  };
  const input = { restaurantId: RESTAURANT_ID, clientOrderKey: 'loyalty-order-123', fulfillmentType: 'PICKUP', paymentMethod: 'CASH', locationVerified: true, currentLocation: { latitude: 19, longitude: -99, capturedAt: Date.now() }, items: [{ productId: 'product', quantity: 1 }], loyalty: { cardId: 'card', discountCents: 1000, expectedTotalCents: 9000 } };
  return { db, tx, input };
}
describe('loyalty checkout integration', () => {
  beforeEach(() => { jest.spyOn(hours, 'isRestaurantOpenNow').mockReturnValue(true); jest.spyOn(runtime, 'reserveRuntimeReward').mockResolvedValue(undefined); });
  afterEach(() => jest.restoreAllMocks());
  it('persists the discount and reserves only after creating the order in the same transaction', async () => {
    const { db, tx, input } = fixture();
    jest.spyOn(runtime, 'loyaltyQuote').mockResolvedValue({ eligible: true, cardId: 'card', discountCents: 1000, gift: null, rewardDescription: '$10', terms: '' });
    const result = await createOrderForCustomer({ prisma: db as any, customerUserId: 'user', input: input as any });
    expect(result.order.totalAmount).toBe(90);
    expect(tx.order.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ promoDiscountAmount: 10, totalAmount: 90 }) }));
    expect(runtime.reserveRuntimeReward).toHaveBeenCalledWith(tx, 'customer', 'created', expect.objectContaining({ cardId: 'card' }));
  });
  it('adds the free product as a zero-price line without changing stock', async () => {
    const { db, tx, input } = fixture(); input.loyalty.discountCents = 0; input.loyalty.expectedTotalCents = 10000;
    jest.spyOn(runtime, 'loyaltyQuote').mockResolvedValue({ eligible: true, cardId: 'card', discountCents: 0, gift: { id: 'gift', name: 'Papas', trackStock: true }, rewardDescription: 'Papas', terms: '' });
    await createOrderForCustomer({ prisma: db as any, customerUserId: 'user', input: input as any });
    const inserted = tx.order.create.mock.calls[0][0].data;
    expect(inserted.items.create).toContainEqual(expect.objectContaining({ productId: 'gift', unitPrice: 0, subtotal: 0, quantity: 1 }));
    expect(tx.product.updateMany).not.toHaveBeenCalled();
  });
  it('does not place an order or reserve a reward if the quoted total changes', async () => {
    const { db, tx, input } = fixture(); input.loyalty.expectedTotalCents = 1;
    jest.spyOn(runtime, 'loyaltyQuote').mockResolvedValue({ eligible: true, cardId: 'card', discountCents: 1000, gift: null, rewardDescription: '$10', terms: '' });
    await expect(createOrderForCustomer({ prisma: db as any, customerUserId: 'user', input: input as any })).rejects.toMatchObject({ code: 'LOYALTY_TOTAL_CHANGED' });
    expect(tx.order.create).not.toHaveBeenCalled(); expect(runtime.reserveRuntimeReward).not.toHaveBeenCalled();
  });
  it('does not consume the reward again on an idempotent retry', async () => {
    const { db, tx, input } = fixture(); db.order.findUnique.mockResolvedValue({ id: 'existing', customerId: 'customer', restaurant: { id: RESTAURANT_ID } } as never);
    const result = await createOrderForCustomer({ prisma: db as any, customerUserId: 'user', input: input as any });
    expect(result.isDuplicate).toBe(true); expect(tx.order.create).not.toHaveBeenCalled(); expect(runtime.reserveRuntimeReward).not.toHaveBeenCalled();
  });
});
