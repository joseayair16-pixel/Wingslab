import { prisma } from '../config/database';

// Ampliación aditiva: nunca modifica categorías ni asignaciones existentes.
const categories = [
  { name: 'Pollerías', icon: 'rooster', keywords: ['polleria', 'pollo crudo', 'aves', 'pechuga'] },
  { name: 'Carnicerías', icon: 'cow-face', keywords: ['carniceria', 'carne de res', 'bistec', 'molida'] },
  { name: 'Carnes de cerdo', icon: 'pig-face', keywords: ['cerdo', 'puerco', 'chuleta', 'carnitas'] },
  { name: 'Pescaderías', icon: 'fish', keywords: ['pescaderia', 'pescado fresco', 'filete'] },
  { name: 'Salchichonería y embutidos', icon: 'bacon', keywords: ['salchichoneria', 'embutidos', 'jamon', 'salchicha', 'tocino'] },
  { name: 'Lácteos y quesos', icon: 'cheese-wedge', keywords: ['lacteos', 'queso', 'crema', 'leche'] },
  { name: 'Hueverías', icon: 'nest-with-eggs', keywords: ['hueveria', 'huevo', 'huevos frescos'] },
  { name: 'Tortillerías', icon: 'flatbread', keywords: ['tortilleria', 'tortillas', 'masa', 'nixtamal'] },
  { name: 'Molinos y granos', icon: 'ear-of-corn', keywords: ['molino', 'maiz', 'granos', 'semillas'] },
  { name: 'Cereales y arroz', icon: 'sheaf-of-rice', keywords: ['arroz', 'cereales', 'avena', 'granos'] },
  { name: 'Semillas y frutos secos', icon: 'peanuts', keywords: ['semillas', 'cacahuates', 'nueces', 'almendras'] },
  { name: 'Miel y productos apícolas', icon: 'honey-pot', keywords: ['miel', 'apicultura', 'polen', 'abejas'] },
  { name: 'Productos orgánicos', icon: 'seedling', keywords: ['organicos', 'ecologicos', 'natural'] },
  { name: 'Especias y condimentos', icon: 'salt', keywords: ['especias', 'condimentos', 'sal', 'sazonadores'] },
  { name: 'Conservas y despensa', icon: 'basket', keywords: ['conservas', 'enlatados', 'despensa', 'despensa a granel'] },
  { name: 'Bebidas y refrescos', icon: 'beverage-box', keywords: ['bebidas', 'refrescos', 'agua', 'jugos envasados'] },
  { name: 'Productos de limpieza', icon: 'soap', keywords: ['limpieza', 'detergente', 'jabon', 'desinfectante'] },
  { name: 'Cuidado personal', icon: 'lotion-bottle', keywords: ['cuidado personal', 'higiene', 'shampoo', 'cremas'] },
  { name: 'Desechables y empaques', icon: 'package', keywords: ['desechables', 'empaques', 'envases', 'bolsas'] },
  { name: 'Plantas y jardinería', icon: 'sunflower', keywords: ['plantas', 'vivero', 'jardineria', 'macetas'] },
  { name: 'Libros y librerías', icon: 'open-book', keywords: ['libros', 'libreria', 'lectura', 'novelas'] },
  { name: 'Manualidades y mercería', icon: 'scissors', keywords: ['merceria', 'manualidades', 'costura', 'hilos'] },
  { name: 'Té de tapioca', icon: 'bubble-tea', keywords: ['tapioca', 'bubble tea', 'boba'] },
  { name: 'Donas', icon: 'doughnut', keywords: ['donas', 'dona', 'donuts'] },
  { name: 'Galletas', icon: 'cookie', keywords: ['galletas', 'cookies', 'galleta'] },
  { name: 'Palomitas', icon: 'popcorn', keywords: ['palomitas', 'pochoclo', 'popcorn'] },
  { name: 'Pretzels', icon: 'pretzel', keywords: ['pretzel', 'pretzels'] },
  { name: 'Raspados y granizados', icon: 'shaved-ice', keywords: ['raspados', 'granizados', 'hielo raspado'] },
  { name: 'Cocina hawaiana', icon: 'pineapple', keywords: ['hawaiana', 'poke', 'hawaiian'] },
  { name: 'Comida rápida', icon: 'french-fries', keywords: ['comida rapida', 'fast food', 'papas fritas'] },
  { name: 'Comida casera', icon: 'bento-box', keywords: ['comida casera', 'comida corrida', 'fondas', 'guisados'] },
  { name: 'Vegetales y ensaladas', icon: 'broccoli', keywords: ['vegetales', 'ensaladas', 'brocoli'] },
] as const;

const normalize = (value: string) => value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');

async function main() {
  const apply = process.argv.includes('--confirm');
  const existing = await prisma.storeCategory.findMany();
  const names = new Set(existing.map((c) => normalize(c.name)));
  const icons = new Set(existing.map((c) => normalize(c.icon)));
  let order = Math.max(0, ...existing.map((c) => c.order));
  const additions: Array<{ name: string; icon: string; color: string; keywords: string[]; order: number; isActive: boolean }> = [];

  for (const category of categories) {
    const icon = `fluent-emoji-flat:${category.icon}`;
    if (names.has(normalize(category.name)) || icons.has(normalize(icon))) {
      console.log(`Omitida por nombre o icono existente: ${category.name} (${icon})`);
      continue;
    }
    names.add(normalize(category.name));
    icons.add(normalize(icon));
    additions.push({ name: category.name, icon, color: '#FEF3C7', keywords: [...category.keywords], order: ++order, isActive: true });
    console.log(`${apply ? 'Preparada' : 'Vista previa'}: ${category.name} (${icon})`);
  }

  if (apply && additions.length) {
    await prisma.$transaction(additions.map((data) => prisma.storeCategory.create({ data })));
  }
  console.log(`${additions.length} categorías ${apply ? 'creadas' : 'por crear'}. ${apply ? '' : 'Agrega --confirm para aplicar.'}`);
}

main().catch((error) => {
  console.error('Error ampliando categorías:', error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
