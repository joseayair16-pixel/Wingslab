import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    const ownedRestaurant = await prisma.restaurant.findFirst({
      include: {
        operatingHours: {
          orderBy: { dayOfWeek: 'asc' },
        },
        categories: {
          orderBy: { order: 'asc' },
        },
        storeCategories: {
          include: {
            category: true,
          },
        },
        stats: true,
      },
    });
    console.log(ownedRestaurant ? 'Success' : 'Not found');
  } catch (err) {
    console.error('Error fetching restaurant:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
