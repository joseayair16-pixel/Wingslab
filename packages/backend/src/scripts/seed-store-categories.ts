import { prisma } from '../config/database';

type SeedCategory = {
  name: string;
  icon: string;
  color: string;
  keywords: string[];
  order: number;
};

// Store-category additions. Within-list duplicates and synonyms were merged,
// and anything already present in StoreCategory (e.g. Súper, Saludable,
// Promos, Panadería y Pastelería, Postres, Pescados y mariscos) was skipped.
// Icons are Iconify icon NAMES from the fluent-emoji-flat collection (colorful, food-illustration style like Uber Eats), unique across all categories.
const CATEGORIES: SeedCategory[] = [
  { name: 'Tecnología', icon: 'fluent-emoji-flat:laptop', color: '#E0F2FE', keywords: ['tecnologia', 'electronica', 'computo'], order: 47 },
  { name: 'Sex Shops', icon: 'fluent-emoji-flat:red-heart', color: '#FCE7F3', keywords: ['sex shop', 'adultos'], order: 48 },
  { name: 'Flores', icon: 'fluent-emoji-flat:bouquet', color: '#FCE7F3', keywords: ['flores', 'floreria', 'ramo'], order: 49 },
  { name: 'Belleza', icon: 'fluent-emoji-flat:lipstick', color: '#FCE7F3', keywords: ['belleza', 'cosmeticos', 'estetica'], order: 50 },
  { name: 'Mascotas', icon: 'fluent-emoji-flat:paw-prints', color: '#FEF3C7', keywords: ['mascotas', 'mascota', 'articulos para mascotas'], order: 51 },
  { name: 'Librerías y Papelerías', icon: 'fluent-emoji-flat:books', color: '#FEF3C7', keywords: ['libreria', 'papeleria', 'libros', 'escolar'], order: 52 },
  { name: 'Moda', icon: 'fluent-emoji-flat:shopping-bags', color: '#FCE7F3', keywords: ['moda', 'ropa', 'accesorios'], order: 53 },
  { name: 'Juguetes', icon: 'fluent-emoji-flat:game-die', color: '#FEF3C7', keywords: ['juguetes', 'juguete', 'niños'], order: 54 },
  { name: 'Deportes y nutrición', icon: 'fluent-emoji-flat:person-lifting-weights', color: '#D1FAE5', keywords: ['deportes', 'deporte', 'nutricion', 'gimnasio'], order: 55 },
  { name: 'Hogar', icon: 'fluent-emoji-flat:house', color: '#FEF3C7', keywords: ['hogar', 'casa', 'mejoras', 'decoracion'], order: 56 },
  { name: 'Niños y Bebés', icon: 'fluent-emoji-flat:baby-bottle', color: '#E0F2FE', keywords: ['niños', 'bebes', 'bebe', 'infantil'], order: 57 },
  { name: 'Farmacias', icon: 'fluent-emoji-flat:pill', color: '#FEE2E2', keywords: ['farmacia', 'farmacias', 'medicamentos'], order: 58 },
  { name: 'Dermocosméticos', icon: 'fluent-emoji-flat:lotion-bottle', color: '#FCE7F3', keywords: ['dermocosmeticos', 'piel', 'facial'], order: 59 },
  { name: 'Suplementos', icon: 'fluent-emoji-flat:flexed-biceps', color: '#D1FAE5', keywords: ['suplementos', 'vitaminas', 'proteinas'], order: 60 },
  { name: 'Mercados', icon: 'fluent-emoji-flat:shopping-cart', color: '#FEF3C7', keywords: ['mercado', 'mercados', 'frescos'], order: 61 },
  { name: 'Express', icon: 'fluent-emoji-flat:high-voltage', color: '#FEF3C7', keywords: ['express', 'conveniencia', 'rapido'], order: 62 },
  { name: 'Especializado', icon: 'fluent-emoji-flat:gem-stone', color: '#F5F5F4', keywords: ['especializado', 'especialidad'], order: 63 },
  { name: 'Hipermercado', icon: 'fluent-emoji-flat:department-store', color: '#E0F2FE', keywords: ['hipermercado', 'mayoreo', 'gran superficie'], order: 64 },
  { name: 'Al por Mayor', icon: 'fluent-emoji-flat:card-file-box', color: '#E7E5E4', keywords: ['mayor', 'mayoreo', 'volumen'], order: 65 },
  { name: 'Tiendas Premium y Gourmet', icon: 'fluent-emoji-flat:crown', color: '#FEF9C3', keywords: ['premium', 'gourmet', 'selecto'], order: 66 },
  { name: 'Centro Comercial', icon: 'fluent-emoji-flat:office-building', color: '#E0F2FE', keywords: ['centro comercial', 'plaza', 'mall'], order: 67 },
  { name: 'Nuevas', icon: 'fluent-emoji-flat:sparkles', color: '#FDE68A', keywords: ['nuevas', 'nuevo', 'nuevos'], order: 68 },
  { name: 'Licores', icon: 'fluent-emoji-flat:cocktail-glass', color: '#FED7AA', keywords: ['licores', 'licor', 'destilados'], order: 69 },
  { name: 'Cervezas', icon: 'fluent-emoji-flat:beer-mug', color: '#FEF3C7', keywords: ['cerveza', 'cervezas', 'chelas'], order: 70 },
  { name: 'Vinos', icon: 'fluent-emoji-flat:wine-glass', color: '#FECACA', keywords: ['vinos', 'vino', 'vinoteca'], order: 71 },
  { name: 'Alcohol', icon: 'fluent-emoji-flat:clinking-glasses', color: '#FED7AA', keywords: ['alcohol', 'bebidas alcoholicas'], order: 72 },
  { name: 'Cuidado personal', icon: 'fluent-emoji-flat:soap', color: '#D1FAE5', keywords: ['cuidado personal', 'higiene', 'aseo'], order: 73 },
];

async function main() {
  if (!process.argv.includes('--confirm')) {
    console.error('Seguridad: agrega --confirm para aplicar las categorías.');
    process.exit(1);
  }

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
