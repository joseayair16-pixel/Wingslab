import '../config/blocked-operation';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Querying recent orders...');
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
      tracking: {
        orderBy: {
          createdAt: 'asc',
        },
      },
    },
  });

  for (const order of orders) {
    console.log(`Order ID: ${order.id}`);
    console.log(`Reference: ${order.orderReference}`);
    console.log(`Status: ${order.status}`);
    console.log(`Restaurant ID: ${order.restaurantId} (userId: ${order.restaurant.userId}, name: ${order.restaurant.name})`);
    console.log(`Customer: ${order.customer.user.name}`);
    console.log(`Tracking points: ${order.tracking.map((t: any) => `${t.status} - ${t.notes} (${t.createdAt.toISOString()})`).join(', ')}`);
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
