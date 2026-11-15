import '../config/blocked-operation';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const restaurant = await prisma.restaurant.findFirst({
    where: { name: { contains: 'Tacos Centro', mode: 'insensitive' } },
  });
  if (!restaurant) {
    console.error('No restaurant found with name Tacos Centro');
    return;
  }
  
  console.log(`Found restaurant: ${restaurant.name} (${restaurant.id})`);
  
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 3);

  const settlement = await prisma.restaurantBillingSettlement.create({
    data: {
      restaurantId: restaurant.id,
      billingCycle: 'WEEKLY',
      feeRate: 0.12,
      periodStart: new Date('2026-04-18'),
      periodEnd: new Date('2026-04-18'),
      status: 'PENDING',
      dueDate,
      amount: 54,
      serviceFeeTotal: 30,
      platformFeeTotal: 24,
      reference: 'DEMO-BILLING-RESTAURANT-4',
      deliveredOrders: 5,
      deliveredRevenue: 1000,
    },
  });
  
  console.log('Created settlement:', settlement);
}

main().catch(console.error).finally(() => prisma.$disconnect());
