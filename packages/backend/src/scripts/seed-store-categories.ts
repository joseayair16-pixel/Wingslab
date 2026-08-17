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
// Icons are lucide-react icon NAMES (not emojis), unique across all categories.
const CATEGORIES: SeedCategory[] = [
  { name: 'Tecnología', icon: 'Monitor', color: '#E0F2FE', keywords: ['tecnologia', 'electronica', 'computo'], order: 47 },
  { name: 'Sex Shops', icon: 'Heart', color: '#FCE7F3', keywords: ['sex shop', 'adultos'], order: 48 },
  { name: 'Flores', icon: 'Flower', color: '#FCE7F3', keywords: ['flores', 'floreria', 'ramo'], order: 49 },
  { name: 'Belleza', icon: 'Sparkles', color: '#FCE7F3', keywords: ['belleza', 'cosmeticos', 'estetica'], order: 50 },
  { name: 'Mascotas', icon: 'PawPrint', color: '#FEF3C7', keywords: ['mascotas', 'mascota', 'articulos para mascotas'], order: 51 },
  { name: 'Librerías y Papelerías', icon: 'BookOpen', color: '#FEF3C7', keywords: ['libreria', 'papeleria', 'libros', 'escolar'], order: 52 },
  { name: 'Moda', icon: 'ShoppingBag', color: '#FCE7F3', keywords: ['moda', 'ropa', 'accesorios'], order: 53 },
  { name: 'Juguetes', icon: 'ToyBrick', color: '#FEF3C7', keywords: ['juguetes', 'juguete', 'niños'], order: 54 },
  { name: 'Deportes y nutrición', icon: 'Dumbbell', color: '#D1FAE5', keywords: ['deportes', 'deporte', 'nutricion', 'gimnasio'], order: 55 },
  { name: 'Hogar', icon: 'Home', color: '#FEF3C7', keywords: ['hogar', 'casa', 'mejoras', 'decoracion'], order: 56 },
  { name: 'Niños y Bebés', icon: 'Baby', color: '#E0F2FE', keywords: ['niños', 'bebes', 'bebe', 'infantil'], order: 57 },
  { name: 'Farmacias', icon: 'Pill', color: '#FEE2E2', keywords: ['farmacia', 'farmacias', 'medicamentos'], order: 58 },
  { name: 'Dermocosméticos', icon: 'Flower2', color: '#FCE7F3', keywords: ['dermocosmeticos', 'piel', 'facial'], order: 59 },
  { name: 'Suplementos', icon: 'Weight', color: '#D1FAE5', keywords: ['suplementos', 'vitaminas', 'proteinas'], order: 60 },
  { name: 'Mercados', icon: 'ShoppingCart', color: '#FEF3C7', keywords: ['mercado', 'mercados', 'frescos'], order: 61 },
  { name: 'Express', icon: 'Zap', color: '#FEF3C7', keywords: ['express', 'conveniencia', 'rapido'], order: 62 },
  { name: 'Especializado', icon: 'Package', color: '#F5F5F4', keywords: ['especializado', 'especialidad'], order: 63 },
  { name: 'Hipermercado', icon: 'Building', color: '#E0F2FE', keywords: ['hipermercado', 'mayoreo', 'gran superficie'], order: 64 },
  { name: 'Al por Mayor', icon: 'Boxes', color: '#E7E5E4', keywords: ['mayor', 'mayoreo', 'volumen'], order: 65 },
  { name: 'Tiendas Premium y Gourmet', icon: 'Crown', color: '#FEF9C3', keywords: ['premium', 'gourmet', 'selecto'], order: 66 },
  { name: 'Centro Comercial', icon: 'Building2', color: '#E0F2FE', keywords: ['centro comercial', 'plaza', 'mall'], order: 67 },
  { name: 'Nuevas', icon: 'Star', color: '#FDE68A', keywords: ['nuevas', 'nuevo', 'nuevos'], order: 68 },
  { name: 'Licores', icon: 'Martini', color: '#FED7AA', keywords: ['licores', 'licor', 'destilados'], order: 69 },
  { name: 'Cervezas', icon: 'Beer', color: '#FEF3C7', keywords: ['cerveza', 'cervezas', 'chelas'], order: 70 },
  { name: 'Vinos', icon: 'Wine', color: '#FECACA', keywords: ['vinos', 'vino', 'vinoteca'], order: 71 },
  { name: 'Alcohol', icon: 'FlaskConical', color: '#FED7AA', keywords: ['alcohol', 'bebidas alcoholicas'], order: 72 },
  { name: 'Cuidado personal', icon: 'ShowerHead', color: '#D1FAE5', keywords: ['cuidado personal', 'higiene', 'aseo'], order: 73 },
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
