const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const restaurant = await prisma.restaurant.findFirst({
    where: { name: { contains: "Pizzas Power" } }
  });
  
  if (restaurant) {
    // Delete existing hours
    await prisma.operatingHours.deleteMany({
      where: { restaurantId: restaurant.id }
    });
    
    // Add new hours for all 7 days
    const hours = [];
    for (let i = 0; i < 7; i++) {
      hours.push({
        restaurantId: restaurant.id,
        dayOfWeek: i,
        openTime: "10:00",
        closeTime: "22:00",
        isClosed: false
      });
    }
    await prisma.operatingHours.createMany({ data: hours });
    console.log("Operating hours added to Pizzas Power");
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
