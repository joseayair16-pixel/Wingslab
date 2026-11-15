import '../config/blocked-operation';
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
// Icons are Iconify icon NAMES from the fluent-emoji-flat collection (colorful, food-illustration style like Uber Eats), unique across all categories.
const CATEGORIES: SeedCategory[] = [
  { name: 'Súper', icon: 'fluent-emoji-flat:convenience-store', color: '#E0F2FE', keywords: ['super', 'supermercado', 'abarrotes', 'tienda'], order: 1 },
  { name: 'Regalos', icon: 'fluent-emoji-flat:wrapped-gift', color: '#FCE7F3', keywords: ['regalos', 'regalo', 'sorpresas'], order: 2 },
  { name: 'Pizza', icon: 'fluent-emoji-flat:pizza', color: '#FEF3C7', keywords: ['pizza', 'pizzas', 'pizzeria'], order: 3 },
  { name: 'Sushi', icon: 'fluent-emoji-flat:sushi', color: '#FCE7F3', keywords: ['sushi', 'japones', 'japonesa'], order: 4 },
  { name: 'Poke', icon: 'fluent-emoji-flat:green-salad', color: '#D1FAE5', keywords: ['poke', 'poke bowl'], order: 5 },
  { name: 'Alitas', icon: 'fluent-emoji-flat:poultry-leg', color: '#FEE2E2', keywords: ['alitas', 'wings', 'buffalo'], order: 6 },
  { name: 'Té de tapioca', icon: 'fluent-emoji-flat:bubble-tea', color: '#EDE9FE', keywords: ['te de tapioca', 'tapioca', 'bubble tea'], order: 7 },
  { name: 'Hamburguesas', icon: 'fluent-emoji-flat:hamburger', color: '#FEF3C7', keywords: ['hamburguesas', 'hamburguesa', 'burger'], order: 8 },
  { name: 'Sándwiches', icon: 'fluent-emoji-flat:sandwich', color: '#FEF3C7', keywords: ['sandwiches', 'sandwich', 'tortas'], order: 9 },
  { name: 'Carnes y BBQ', icon: 'fluent-emoji-flat:cut-of-meat', color: '#FEE2E2', keywords: ['carnes', 'bbq', 'asado', 'parrilla'], order: 10 },
  { name: 'Postres', icon: 'fluent-emoji-flat:birthday-cake', color: '#FCE7F3', keywords: ['postres', 'postre', 'pastel', 'pasteles'], order: 11 },
  { name: 'Promos', icon: 'fluent-emoji-flat:label', color: '#FEF9C3', keywords: ['promos', 'promociones', 'ofertas', 'descuentos'], order: 12 },
  { name: 'Tailandesa', icon: 'fluent-emoji-flat:shallow-pan-of-food', color: '#FED7AA', keywords: ['tailandesa', 'thai', 'tailandes'], order: 13 },
  { name: 'Mexicana', icon: 'fluent-emoji-flat:taco', color: '#FECACA', keywords: ['mexicana', 'mexicano', 'comida mexicana'], order: 14 },
  { name: 'China', icon: 'fluent-emoji-flat:takeout-box', color: '#FED7AA', keywords: ['china', 'chino', 'comida china'], order: 15 },
  { name: 'Asiática', icon: 'fluent-emoji-flat:chopsticks', color: '#FDE68A', keywords: ['asiatica', 'asiatico', 'oriental'], order: 16 },
  { name: 'Saludable', icon: 'fluent-emoji-flat:carrot', color: '#D1FAE5', keywords: ['saludable', 'saludables', 'ensaladas', 'fit'], order: 17 },
  { name: 'Vegana', icon: 'fluent-emoji-flat:leafy-green', color: '#D1FAE5', keywords: ['vegana', 'vegano', 'vegetariana', 'vegetariano'], order: 18 },
  { name: 'Italiana', icon: 'fluent-emoji-flat:spaghetti', color: '#FEF3C7', keywords: ['italiana', 'italiano', 'pasta'], order: 19 },
  { name: 'Pescados y mariscos', icon: 'fluent-emoji-flat:fish', color: '#BFDBFE', keywords: ['pescados', 'mariscos', 'camarones', 'ceviche'], order: 20 },
  { name: 'Coreana', icon: 'fluent-emoji-flat:hot-pepper', color: '#FECACA', keywords: ['coreana', 'coreano', 'korean'], order: 21 },
  { name: 'Americana', icon: 'fluent-emoji-flat:popcorn', color: '#FEF3C7', keywords: ['americana', 'americano', 'clasica'], order: 22 },
  { name: 'Desayunos y Brunch', icon: 'fluent-emoji-flat:pancakes', color: '#FDE68A', keywords: ['desayuno', 'desayunos', 'brunch', 'huevos'], order: 23 },
  { name: 'Comida rápida', icon: 'fluent-emoji-flat:french-fries', color: '#FED7AA', keywords: ['comida rapida', 'fast food'], order: 24 },
  { name: 'Café y Té', icon: 'fluent-emoji-flat:hot-beverage', color: '#D6D3D1', keywords: ['cafe', 'te', 'bebidas'], order: 25 },
  { name: 'Japonesa', icon: 'fluent-emoji-flat:bento-box', color: '#FCE7F3', keywords: ['japonesa', 'japones', 'japon'], order: 26 },
  { name: 'Comida reconfortante', icon: 'fluent-emoji-flat:pot-of-food', color: '#E7E5E4', keywords: ['reconfortante', 'comfort food', 'casero'], order: 27 },
  { name: 'Smoothies y Jugos', icon: 'fluent-emoji-flat:cup-with-straw', color: '#A7F3D0', keywords: ['smoothies', 'jugos', 'jugo', 'licuados'], order: 28 },
  { name: 'Helados y Nieves', icon: 'fluent-emoji-flat:ice-cream', color: '#E0F2FE', keywords: ['helado', 'helados', 'nieves', 'nieve'], order: 29 },
  { name: 'Panadería y Pastelería', icon: 'fluent-emoji-flat:croissant', color: '#FEF3C7', keywords: ['panaderia', 'pasteleria', 'pan', 'reposteria'], order: 30 },
  { name: 'Sopas', icon: 'fluent-emoji-flat:bowl-with-spoon', color: '#FED7AA', keywords: ['sopas', 'sopa', 'caldos'], order: 31 },
  { name: 'Hawaiana', icon: 'fluent-emoji-flat:pineapple', color: '#FEF3C7', keywords: ['hawaiana', 'hawaiano', 'hawaiian'], order: 32 },
  { name: 'Comida callejera', icon: 'fluent-emoji-flat:flatbread', color: '#FDE68A', keywords: ['callejera', 'street food', 'antojitos', 'garnachas'], order: 33 },
  { name: 'Tacos', icon: 'fluent-emoji-flat:stuffed-flatbread', color: '#FCA5A5', keywords: ['tacos', 'taco', 'taqueria'], order: 34 },
  { name: 'Chilaquiles y Enchiladas', icon: 'fluent-emoji-flat:cooking', color: '#FECACA', keywords: ['chilaquiles', 'enchiladas'], order: 35 },
  { name: 'Pozole y Caldos', icon: 'fluent-emoji-flat:steaming-bowl', color: '#FED7AA', keywords: ['pozole', 'caldos', 'caldo'], order: 36 },
  { name: 'Pollo', icon: 'fluent-emoji-flat:chicken', color: '#FEE2E2', keywords: ['pollo', 'polleria', 'rotisserie'], order: 37 },
  { name: 'Antojitos y Garnachas', icon: 'fluent-emoji-flat:dumpling', color: '#FDE68A', keywords: ['antojitos', 'garnachas'], order: 38 },
  { name: 'Empanadas', icon: 'fluent-emoji-flat:doughnut', color: '#FEF3C7', keywords: ['empanadas', 'empanada'], order: 39 },
  { name: 'Tortas y Lonches', icon: 'fluent-emoji-flat:baguette-bread', color: '#FED7AA', keywords: ['tortas', 'lonches', 'torta', 'lonche'], order: 40 },
  { name: 'Barbacoa y Birria', icon: 'fluent-emoji-flat:meat-on-bone', color: '#FECACA', keywords: ['barbacoa', 'birria'], order: 41 },
  { name: 'Comida Internacional', icon: 'fluent-emoji-flat:globe-showing-americas', color: '#E0F2FE', keywords: ['internacional', 'world'], order: 42 },
  { name: 'Comida India', icon: 'fluent-emoji-flat:curry-rice', color: '#FED7AA', keywords: ['india', 'indio', 'curry'], order: 43 },
  { name: 'Comida Árabe', icon: 'fluent-emoji-flat:falafel', color: '#D6D3D1', keywords: ['arabe', 'shawarma', 'falafel'], order: 44 },
  { name: 'Burros y Percherones', icon: 'fluent-emoji-flat:burrito', color: '#FEF3C7', keywords: ['burros', 'percherones', 'burrito', 'burritos'], order: 45 },
  { name: 'Ropa', icon: 'fluent-emoji-flat:t-shirt', color: '#BFDBFE', keywords: ['ropa', 'moda', 'tienda'], order: 46 },
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
