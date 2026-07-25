const { PrismaClient } = require('./node_modules/@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const driver = await prisma.driver.findFirst({ include: { user: true }});
  console.log("First Driver:", driver ? { name: driver.user.name, availability: driver.availability, status: driver.status } : "None");
}
main().catch(console.error).finally(() => prisma.$disconnect());
