import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CATEGORIES = [
  { id: 'pizza', name: 'Pizza', icon: '🍕', keywords: ['pizza', 'pizzeria', 'italiana'], color: 'bg-[linear-gradient(135deg,#fca5a5_0%,#ea580c_100%)]' },
  { id: 'desayuno', name: 'Desayuno', icon: '🥞', keywords: ['desayuno', 'cafeteria', 'cafe', 'brunch', 'panaderia'], color: 'bg-[linear-gradient(135deg,#fde68a_0%,#f59e0b_100%)]' },
  { id: 'pollo', name: 'Pollo', icon: '🍗', keywords: ['pollo', 'rostizado', 'broaster', 'alitas'], color: 'bg-[linear-gradient(135deg,#fdba74_0%,#ef4444_100%)]' },
  { id: 'tacos', name: 'Tacos', icon: '🌮', keywords: ['taco', 'taqueria', 'mexicana', 'antojitos'], color: 'bg-[linear-gradient(135deg,#fcd34d_0%,#84cc16_100%)]' },
  { id: 'comida-corrida', name: 'Comida corrida', icon: '🥘', keywords: ['comida corrida', 'casera', 'fonda', 'almuerzo'], color: 'bg-[#faf7f1]' },
  { id: 'abarrotes', name: 'Abarrotes', icon: '🛒', keywords: ['abarrotes', 'conveniencia', 'super', 'tienda'], color: 'bg-[#faf7f1]' },
  { id: 'farmacia', name: 'Farmacia', icon: '💊', keywords: ['farmacia', 'salud', 'medicina'], color: 'bg-[#faf7f1]' },
  { id: 'hamburguesas', name: 'Hamburguesas', icon: '🍔', keywords: ['hamburguesa', 'burger'], color: 'bg-[#faf7f1]' },
  { id: 'sushi', name: 'Sushi', icon: '🍣', keywords: ['sushi', 'japonesa', 'roll'], color: 'bg-[#faf7f1]' },
];

async function main() {
  console.log('Starting store categories migration...');

  // 1. Create categories
  for (let i = 0; i < CATEGORIES.length; i++) {
    const cat = CATEGORIES[i];
    await prisma.storeCategory.upsert({
      where: { id: cat.id },
      update: {
        name: cat.name,
        icon: cat.icon,
        keywords: cat.keywords,
        color: cat.color,
        order: i,
      },
      create: {
        id: cat.id,
        name: cat.name,
        icon: cat.icon,
        keywords: cat.keywords,
        color: cat.color,
        order: i,
      },
    });
  }

  // 2. Assign restaurants to categories based on keywords
  const restaurants = await prisma.restaurant.findMany({
    include: {
      categories: true, // internal menu categories
    },
  });

  for (const restaurant of restaurants) {
    const categoryNames = restaurant.categories?.map((c) => c.name).join(' ') || '';
    const haystack = `${restaurant.name} ${restaurant.description} ${restaurant.address} ${restaurant.region} ${categoryNames}`.toLowerCase();

    let matchedCategoryId = 'comida-corrida';

    for (const cat of CATEGORIES) {
      if (cat.keywords.some((keyword) => haystack.includes(keyword))) {
        matchedCategoryId = cat.id;
        break;
      }
    }

    // Assign
    await prisma.restaurantStoreCategory.upsert({
      where: {
        restaurantId_categoryId: {
          restaurantId: restaurant.id,
          categoryId: matchedCategoryId,
        },
      },
      update: {},
      create: {
        restaurantId: restaurant.id,
        categoryId: matchedCategoryId,
      },
    });
  }

  console.log('Migration completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
