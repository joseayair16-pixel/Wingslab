import '../config/blocked-operation';
import { prisma } from '../config/database';

async function main() {
  console.log('=== DB CHECK ===');
  const orders = await prisma.order.findMany({
    orderBy: {
      createdAt: 'desc',
    },
    take: 5,
    include: {
      restaurant: true,
      customer: {
        include: {
          user: true,
        },
      },
      tracking: true,
    },
  });

  for (const order of orders) {
    console.log(`Order ID: ${order.id}`);
    console.log(`Reference: ${order.orderReference}`);
    console.log(`Status: ${order.status}`);
    console.log(`Restaurant: ${order.restaurant.name} (ID: ${order.restaurant.id}, userId: ${order.restaurant.userId})`);
    console.log(`Customer: ${order.customer.user.name}`);
    console.log(`Tracking points: ${order.tracking.map((t) => `${t.status} (${t.createdAt.toISOString()})`).join(', ')}`);
    console.log('---');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
