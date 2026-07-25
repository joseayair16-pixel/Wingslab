const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const settlements = await prisma.restaurantBillingSettlement.findMany({
    where: { status: { in: ['PENDING', 'OVERDUE'] } }
  });
  console.log('Unpaid settlements:', settlements);
}

main().catch(console.error).finally(() => prisma.$disconnect());
