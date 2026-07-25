const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const order = await prisma.order.findUnique({
    where: { orderReference: 'SAD-MQV947GY-QU5R0I' },
    include: {
      customer: { include: { user: true } },
      driver: { include: { user: true } }
    }
  });
  console.log(JSON.stringify(order, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
