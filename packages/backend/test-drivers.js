const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const drivers = await prisma.driver.findMany({ include: { user: true } });
  console.log("All drivers:", drivers.map(d => ({ name: d.user.name, status: d.status, availability: d.availability, region: d.region })));
  const rests = await prisma.restaurant.findMany({ include: { user: true } });
  console.log("All restaurants:", rests.map(r => ({ name: r.name, hasOwnDelivery: r.hasOwnDelivery, region: r.region })));
}
main().catch(console.error).finally(() => prisma.$disconnect());
