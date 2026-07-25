const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const restaurant = await prisma.restaurant.findFirst({
    where: { name: { contains: "Pizzas Power" } },
    include: { operatingHours: true }
  });
  console.log(JSON.stringify(restaurant.operatingHours, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
