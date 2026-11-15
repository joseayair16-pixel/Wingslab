require('../../scripts/blocked-operation.cjs');
require('dotenv').config({ path: '../../.env.local' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const rest = await prisma.restaurant.findFirst({ where: { name: 'Pizzas Power' }, include: { operatingHours: true } });
  console.log(JSON.stringify(rest, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
