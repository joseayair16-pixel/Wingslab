import type { PrismaClient } from '@prisma/client';
import { RESTAURANT_ID } from '../config/single-restaurant';
import { reserveCustomerCardCheckout } from './order.service';

const requestKey = 'checkout-key-1234567890';
const baseInput = {
  restaurantId: RESTAURANT_ID,
  items: [{ productId: 'p', quantity: 1 }],
  paymentMethod: 'CREDIT_CARD' as const,
  fulfillmentType: 'PICKUP' as const,
};

test('la reserva con tarjeta rechaza cupones y recompensas con un código claro', async () => {
  const prisma = {} as PrismaClient;
  await expect(reserveCustomerCardCheckout({ prisma, customerUserId: 'u', input: { ...baseInput, promoCode: 'CUPON' } }, requestKey))
    .rejects.toMatchObject({ code: 'CARD_REWARD_NOT_SUPPORTED' });
  await expect(reserveCustomerCardCheckout({ prisma, customerUserId: 'u', input: {
    ...baseInput, loyalty: { cardId: '8148d68d-73eb-4365-b96c-be7d555f7aee', discountCents: 100, expectedTotalCents: 900 },
  } }, requestKey)).rejects.toMatchObject({ code: 'CARD_REWARD_NOT_SUPPORTED' });
});

test('la reserva con tarjeta exige el opt-in del restaurante', async () => {
  const prisma = {
    customer: { findUnique: jest.fn().mockResolvedValue({ id: 'c', isSuspendedByDebt: false, debtAmount: 0, user: { status: 'ACTIVE' } }) },
    checkoutPaymentIntent: { findUnique: jest.fn().mockResolvedValue(null) },
    restaurant: { findUnique: jest.fn().mockResolvedValue({ acceptsCard: false }) },
  } as unknown as PrismaClient;
  await expect(reserveCustomerCardCheckout({ prisma, customerUserId: 'u', input: baseInput }, requestKey))
    .rejects.toMatchObject({ code: 'CARD_NOT_ACCEPTED' });
});
