import { prisma } from '../config/database';

type SeedCategory = {
  name: string;
  icon: string;
  color: string;
  keywords: string[];
  order: number;
};

// Deduplicated, professionally-named platform categories. Entries that appeared
// in both reference lists (or as synonyms, e.g. "Pizza"/"Pizzas",
// "Mexicana"/"Comida Mexicana") were merged into a single canonical category.
// Icons are lucide-react icon NAMES (not emojis), unique across all categories.
const CATEGORIES: SeedCategory[] = [
  { name: 'Súper', icon: 'Store', color: '#E0F2FE', keywords: ['super', 'supermercado', 'abarrotes', 'tienda'], order: 1 },
  { name: 'Regalos', icon: 'Gift', color: '#FCE7F3', keywords: ['regalos', 'regalo', 'sorpresas'], order: 2 },
  { name: 'Pizza', icon: 'Pizza', color: '#FEF3C7', keywords: ['pizza', 'pizzas', 'pizzeria'], order: 3 },
  { name: 'Sushi', icon: 'Fish', color: '#FCE7F3', keywords: ['sushi', 'japones', 'japonesa'], order: 4 },
  { name: 'Poke', icon: 'Salad', color: '#D1FAE5', keywords: ['poke', 'poke bowl'], order: 5 },
  { name: 'Alitas', icon: 'Drumstick', color: '#FEE2E2', keywords: ['alitas', 'wings', 'buffalo'], order: 6 },
  { name: 'Té de tapioca', icon: 'CupSoda', color: '#EDE9FE', keywords: ['te de tapioca', 'tapioca', 'bubble tea'], order: 7 },
  { name: 'Hamburguesas', icon: 'Hamburger', color: '#FEF3C7', keywords: ['hamburguesas', 'hamburguesa', 'burger'], order: 8 },
  { name: 'Sándwiches', icon: 'Sandwich', color: '#FEF3C7', keywords: ['sandwiches', 'sandwich', 'tortas'], order: 9 },
  { name: 'Carnes y BBQ', icon: 'Beef', color: '#FEE2E2', keywords: ['carnes', 'bbq', 'asado', 'parrilla'], order: 10 },
  { name: 'Postres', icon: 'Cake', color: '#FCE7F3', keywords: ['postres', 'postre', 'pastel', 'pasteles'], order: 11 },
  { name: 'Promos', icon: 'Tag', color: '#FEF9C3', keywords: ['promos', 'promociones', 'ofertas', 'descuentos'], order: 12 },
  { name: 'Tailandesa', icon: 'Soup', color: '#FED7AA', keywords: ['tailandesa', 'thai', 'tailandes'], order: 13 },
  { name: 'Mexicana', icon: 'ChefHat', color: '#FECACA', keywords: ['mexicana', 'mexicano', 'comida mexicana'], order: 14 },
  { name: 'China', icon: 'Utensils', color: '#FED7AA', keywords: ['china', 'chino', 'comida china'], order: 15 },
  { name: 'Asiática', icon: 'UtensilsCrossed', color: '#FDE68A', keywords: ['asiatica', 'asiatico', 'oriental'], order: 16 },
  { name: 'Saludable', icon: 'Sprout', color: '#D1FAE5', keywords: ['saludable', 'saludables', 'ensaladas', 'fit'], order: 17 },
  { name: 'Vegana', icon: 'Leaf', color: '#D1FAE5', keywords: ['vegana', 'vegano', 'vegetariana', 'vegetariano'], order: 18 },
  { name: 'Italiana', icon: 'CookingPot', color: '#FEF3C7', keywords: ['italiana', 'italiano', 'pasta'], order: 19 },
  { name: 'Pescados y mariscos', icon: 'Shrimp', color: '#BFDBFE', keywords: ['pescados', 'mariscos', 'camarones', 'ceviche'], order: 20 },
  { name: 'Coreana', icon: 'Flame', color: '#FECACA', keywords: ['coreana', 'coreano', 'korean'], order: 21 },
  { name: 'Americana', icon: 'Flag', color: '#FEF3C7', keywords: ['americana', 'americano', 'clasica'], order: 22 },
  { name: 'Desayunos y Brunch', icon: 'EggFried', color: '#FDE68A', keywords: ['desayuno', 'desayunos', 'brunch', 'huevos'], order: 23 },
  { name: 'Comida rápida', icon: 'Zap', color: '#FED7AA', keywords: ['comida rapida', 'fast food'], order: 24 },
  { name: 'Café y Té', icon: 'Coffee', color: '#D6D3D1', keywords: ['cafe', 'te', 'bebidas'], order: 25 },
  { name: 'Japonesa', icon: 'Cherry', color: '#FCE7F3', keywords: ['japonesa', 'japones', 'japon'], order: 26 },
  { name: 'Comida reconfortante', icon: 'Milk', color: '#E7E5E4', keywords: ['reconfortante', 'comfort food', 'casero'], order: 27 },
  { name: 'Smoothies y Jugos', icon: 'GlassWater', color: '#A7F3D0', keywords: ['smoothies', 'jugos', 'jugo', 'licuados'], order: 28 },
  { name: 'Helados y Nieves', icon: 'IceCreamCone', color: '#E0F2FE', keywords: ['helado', 'helados', 'nieves', 'nieve'], order: 29 },
  { name: 'Panadería y Pastelería', icon: 'Croissant', color: '#FEF3C7', keywords: ['panaderia', 'pasteleria', 'pan', 'reposteria'], order: 30 },
  { name: 'Sopas', icon: 'Wheat', color: '#FED7AA', keywords: ['sopas', 'sopa', 'caldos'], order: 31 },
  { name: 'Hawaiana', icon: 'Banana', color: '#FEF3C7', keywords: ['hawaiana', 'hawaiano', 'hawaiian'], order: 32 },
  { name: 'Comida callejera', icon: 'Truck', color: '#FDE68A', keywords: ['callejera', 'street food', 'antojitos', 'garnachas'], order: 33 },
  { name: 'Tacos', icon: 'Apple', color: '#FCA5A5', keywords: ['tacos', 'taco', 'taqueria'], order: 34 },
  { name: 'Chilaquiles y Enchiladas', icon: 'Egg', color: '#FECACA', keywords: ['chilaquiles', 'enchiladas'], order: 35 },
  { name: 'Pozole y Caldos', icon: 'Grape', color: '#FED7AA', keywords: ['pozole', 'caldos', 'caldo'], order: 36 },
  { name: 'Pollo', icon: 'Bird', color: '#FEE2E2', keywords: ['pollo', 'polleria', 'rotisserie'], order: 37 },
  { name: 'Antojitos y Garnachas', icon: 'Cookie', color: '#FDE68A', keywords: ['antojitos', 'garnachas'], order: 38 },
  { name: 'Empanadas', icon: 'Donut', color: '#FEF3C7', keywords: ['empanadas', 'empanada'], order: 39 },
  { name: 'Tortas y Lonches', icon: 'Citrus', color: '#FED7AA', keywords: ['tortas', 'lonches', 'torta', 'lonche'], order: 40 },
  { name: 'Barbacoa y Birria', icon: 'Ham', color: '#FECACA', keywords: ['barbacoa', 'birria'], order: 41 },
  { name: 'Comida Internacional', icon: 'Globe', color: '#E0F2FE', keywords: ['internacional', 'world'], order: 42 },
  { name: 'Comida India', icon: 'Feather', color: '#FED7AA', keywords: ['india', 'indio', 'curry'], order: 43 },
  { name: 'Comida Árabe', icon: 'Palmtree', color: '#D6D3D1', keywords: ['arabe', 'shawarma', 'falafel'], order: 44 },
  { name: 'Burros y Percherones', icon: 'Dessert', color: '#FEF3C7', keywords: ['burros', 'percherones', 'burrito', 'burritos'], order: 45 },
  { name: 'Ropa', icon: 'Shirt', color: '#BFDBFE', keywords: ['ropa', 'moda', 'tienda'], order: 46 },
];

async function main() {
  if (!process.argv.includes('--confirm')) {
    console.error('Seguridad: agrega --confirm para aplicar las categorías.');
    process.exit(1);
  }

  // Reconcile legacy plural "Pizzas" into the canonical "Pizza".
  await prisma.storeCategory.updateMany({
    where: { name: { equals: 'pizzas', mode: 'insensitive' } },
    data: { name: 'Pizza' },
  });

  let created = 0;
  let updated = 0;

  for (const cat of CATEGORIES) {
    const existing = await prisma.storeCategory.findFirst({
      where: { name: { equals: cat.name, mode: 'insensitive' } },
    });

    if (existing) {
      await prisma.storeCategory.update({
        where: { id: existing.id },
        data: {
          name: cat.name,
          icon: cat.icon,
          color: cat.color,
          keywords: cat.keywords,
          order: cat.order,
          isActive: true,
        },
      });
      updated++;
      console.log(`actualizada: ${cat.name}`);
    } else {
      await prisma.storeCategory.create({
        data: {
          name: cat.name,
          icon: cat.icon,
          color: cat.color,
          keywords: cat.keywords,
          order: cat.order,
          isActive: true,
        },
      });
      created++;
      console.log(`creada: ${cat.name}`);
    }
  }

  const total = await prisma.storeCategory.count();
  console.log(`\nCategorías creadas: ${created} | actualizadas: ${updated} | total en tabla: ${total}`);
}

main()
  .catch((err) => {
    console.error('Error sembrando categorías:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
