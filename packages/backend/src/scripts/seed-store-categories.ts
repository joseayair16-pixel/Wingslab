import '../config/blocked-operation';
import { prisma } from '../config/database';

type SeedCategory = {
  name: string;
  icon: string;
  color: string;
  keywords: string[];
  order: number;
};

// Taxonomía oficial de categorías de la plataforma (v2, 2026-10-11).
// - Cubre restaurantes, tiendas y negocios que pueden registrarse en SaDeL.
// - Los iconos son nombres ÚNICOS de la colección fluent-emoji-flat de Iconify
//   (estilo ilustración a color, consistente en todas las plataformas).
//   Ningún icono se repite; no se usan emojis crudos.
// - Modo sincronización total: reemplaza TODO lo existente (categorías y
//   asignaciones de restaurantes) por esta lista. Los restaurantes deberán
//   volver a elegir hasta 2 categorías en Configuración > Perfil.
const CATEGORIES: SeedCategory[] = [
  // ── Restaurantes: cocinas ──
  { name: 'Tacos', icon: 'fluent-emoji-flat:taco', color: '#FEF3C7', keywords: ['tacos', 'taco', 'taqueria', 'taquería'], order: 1 },
  { name: 'Pizza', icon: 'fluent-emoji-flat:pizza', color: '#FED7AA', keywords: ['pizza', 'pizzeria', 'pizzería'], order: 2 },
  { name: 'Hamburguesas', icon: 'fluent-emoji-flat:hamburger', color: '#FED7AA', keywords: ['hamburguesa', 'hamburguesas', 'burger', 'fast food'], order: 3 },
  { name: 'Sushi', icon: 'fluent-emoji-flat:sushi', color: '#E0F2FE', keywords: ['sushi', 'maki', 'nigiri'], order: 4 },
  { name: 'Cocina japonesa', icon: 'fluent-emoji-flat:steaming-bowl', color: '#E0F2FE', keywords: ['japonesa', 'japon', 'ramen', 'nipona'], order: 5 },
  { name: 'Cocina china', icon: 'fluent-emoji-flat:dumpling', color: '#FEE2E2', keywords: ['china', 'cantonesa', 'dumpling', 'wonton'], order: 6 },
  { name: 'Cocina italiana', icon: 'fluent-emoji-flat:spaghetti', color: '#FEF3C7', keywords: ['italiana', 'pasta', 'lasana', 'lasagna'], order: 7 },
  { name: 'Cocina mexicana', icon: 'fluent-emoji-flat:hot-pepper', color: '#FEE2E2', keywords: ['mexicana', 'picante', 'tradicional', 'antojo'], order: 8 },
  { name: 'Cocina tailandesa', icon: 'fluent-emoji-flat:shallow-pan-of-food', color: '#FEF3C7', keywords: ['tailandesa', 'thai', 'pad thai'], order: 9 },
  { name: 'Cocina india', icon: 'fluent-emoji-flat:curry-rice', color: '#FED7AA', keywords: ['india', 'hindu', 'hindú', 'curry'], order: 10 },
  { name: 'Cocina árabe', icon: 'fluent-emoji-flat:falafel', color: '#FEF3C7', keywords: ['arabe', 'árabe', 'libanesa', 'kebab', 'shawarma'], order: 11 },
  { name: 'Cocina coreana', icon: 'fluent-emoji-flat:takeout-box', color: '#FEE2E2', keywords: ['coreana', 'koreana', 'korean'], order: 12 },
  { name: 'Parrilladas y cortes', icon: 'fluent-emoji-flat:cut-of-meat', color: '#FEE2E2', keywords: ['parrilla', 'cortes', 'carne asada', 'argentina', 'asador'], order: 13 },
  { name: 'Cocina americana', icon: 'fluent-emoji-flat:hot-dog', color: '#FEF3C7', keywords: ['americana', 'hot dog', 'bbq', 'costillas'], order: 14 },
  // ── Restaurantes: especialidades ──
  { name: 'Pollos asados', icon: 'fluent-emoji-flat:chicken', color: '#FEF3C7', keywords: ['pollo', 'pollos', 'asado', 'rostizado'], order: 15 },
  { name: 'Alitas y boneless', icon: 'fluent-emoji-flat:poultry-leg', color: '#FED7AA', keywords: ['alitas', 'boneless', 'buffalo', 'tenders'], order: 16 },
  { name: 'Birria y barbacoa', icon: 'fluent-emoji-flat:meat-on-bone', color: '#FEE2E2', keywords: ['birria', 'barbacoa', 'borrego', 'chivo'], order: 17 },
  { name: 'Pozole y caldos', icon: 'fluent-emoji-flat:pot-of-food', color: '#FEF3C7', keywords: ['pozole', 'caldo', 'menudo', 'sopa', 'ramen'], order: 18 },
  { name: 'Tortas y sándwiches', icon: 'fluent-emoji-flat:sandwich', color: '#FEF3C7', keywords: ['torta', 'tortas', 'sandwich', 'lonche'], order: 19 },
  { name: 'Antojitos mexicanos', icon: 'fluent-emoji-flat:burrito', color: '#FED7AA', keywords: ['antojitos', 'garnachas', 'quesadillas', 'huaraches', 'sopes'], order: 20 },
  { name: 'Tamales y atoles', icon: 'fluent-emoji-flat:tamale', color: '#FEF3C7', keywords: ['tamales', 'tamal', 'atole', 'champurrado', 'oaxaqueños'], order: 21 },
  { name: 'Desayunos y brunch', icon: 'fluent-emoji-flat:egg', color: '#FEF3C7', keywords: ['desayuno', 'brunch', 'huevos', 'chilaquiles', 'molletes'], order: 22 },
  { name: 'Mariscos y pescados', icon: 'fluent-emoji-flat:shrimp', color: '#E0F2FE', keywords: ['mariscos', 'pescados', 'camaron', 'ceviche', 'aguachile'], order: 23 },
  // ── Panadería, postres y bebidas ──
  { name: 'Panadería', icon: 'fluent-emoji-flat:croissant', color: '#FED7AA', keywords: ['panaderia', 'pan', 'bolillo', 'conchas'], order: 24 },
  { name: 'Pastelería y postres', icon: 'fluent-emoji-flat:shortcake', color: '#FCE7F3', keywords: ['pasteleria', 'pastel', 'postres', 'reposteria', 'tarta'], order: 25 },
  { name: 'Helados y nieves', icon: 'fluent-emoji-flat:ice-cream', color: '#E0F2FE', keywords: ['helado', 'nieve', 'paletas', 'gelato'], order: 26 },
  { name: 'Café y té', icon: 'fluent-emoji-flat:hot-beverage', color: '#FED7AA', keywords: ['cafe', 'café', 'te', 'té', 'barista', 'matcha'], order: 27 },
  { name: 'Jugos y licuados', icon: 'fluent-emoji-flat:cup-with-straw', color: '#D1FAE5', keywords: ['jugos', 'licuados', 'smoothies', 'natural'], order: 28 },
  { name: 'Comida saludable', icon: 'fluent-emoji-flat:green-salad', color: '#D1FAE5', keywords: ['saludable', 'ensaladas', 'fit', 'light', 'bowls'], order: 29 },
  { name: 'Comida vegana', icon: 'fluent-emoji-flat:leafy-green', color: '#D1FAE5', keywords: ['vegana', 'vegetariana', 'plant based', 'veggie'], order: 30 },
  { name: 'Cervezas y micheladas', icon: 'fluent-emoji-flat:beer-mug', color: '#FEF3C7', keywords: ['cerveza', 'michelada', 'chelas', 'six'], order: 31 },
  { name: 'Vinos y licores', icon: 'fluent-emoji-flat:wine-glass', color: '#FCE7F3', keywords: ['vino', 'licor', 'destilados', 'vinoteca'], order: 32 },
  { name: 'Coctelería y bar', icon: 'fluent-emoji-flat:cocktail-glass', color: '#FED7AA', keywords: ['cocteles', 'mixologia', 'bar', 'tragos'], order: 33 },
  // ── Tiendas ──
  { name: 'Súper y abarrotes', icon: 'fluent-emoji-flat:shopping-cart', color: '#D1FAE5', keywords: ['super', 'abarrotes', 'despensa', 'tienda', 'minisuper'], order: 34 },
  { name: 'Farmacias', icon: 'fluent-emoji-flat:pill', color: '#FEE2E2', keywords: ['farmacia', 'medicamentos', 'botica', 'salud'], order: 35 },
  { name: 'Mascotas', icon: 'fluent-emoji-flat:paw-prints', color: '#FEF3C7', keywords: ['mascotas', 'croquetas', 'accesorios', 'perros', 'gatos'], order: 36 },
  { name: 'Belleza y cosméticos', icon: 'fluent-emoji-flat:lipstick', color: '#FCE7F3', keywords: ['belleza', 'cosmeticos', 'maquillaje', 'estetica', 'skincare'], order: 37 },
  { name: 'Ropa y moda', icon: 'fluent-emoji-flat:t-shirt', color: '#FCE7F3', keywords: ['ropa', 'moda', 'playeras', 'vestidos', 'boutique'], order: 38 },
  { name: 'Calzado', icon: 'fluent-emoji-flat:running-shoe', color: '#E0F2FE', keywords: ['calzado', 'tenis', 'zapatos', 'zapateria'], order: 39 },
  { name: 'Tecnología', icon: 'fluent-emoji-flat:laptop', color: '#E0F2FE', keywords: ['tecnologia', 'electronica', 'celulares', 'computo', 'gadgets'], order: 40 },
  { name: 'Hogar y decoración', icon: 'fluent-emoji-flat:house', color: '#FEF3C7', keywords: ['hogar', 'decoracion', 'muebles', 'cocina'], order: 41 },
  { name: 'Papelería y oficina', icon: 'fluent-emoji-flat:books', color: '#FEF3C7', keywords: ['papeleria', 'oficina', 'escolar', 'libros', 'utiles'], order: 42 },
  { name: 'Juguetes', icon: 'fluent-emoji-flat:game-die', color: '#FEF3C7', keywords: ['juguetes', 'juguete', 'niños', 'juegos'], order: 43 },
  { name: 'Deportes', icon: 'fluent-emoji-flat:person-lifting-weights', color: '#D1FAE5', keywords: ['deportes', 'deporte', 'nutricion', 'gimnasio', 'fitness'], order: 44 },
  { name: 'Bebés y niños', icon: 'fluent-emoji-flat:baby-bottle', color: '#E0F2FE', keywords: ['bebes', 'bebe', 'niños', 'infantil', 'pañales'], order: 45 },
  { name: 'Flores', icon: 'fluent-emoji-flat:bouquet', color: '#FCE7F3', keywords: ['flores', 'floreria', 'ramos', 'arreglos'], order: 46 },
  { name: 'Regalos', icon: 'fluent-emoji-flat:wrapped-gift', color: '#FCE7F3', keywords: ['regalos', 'regalo', 'detalles', 'sorpresas'], order: 47 },
  { name: 'Ferretería', icon: 'fluent-emoji-flat:hammer', color: '#E7E5E4', keywords: ['ferreteria', 'tlapaleria', 'herramientas', 'reparacion'], order: 48 },
  { name: 'Dulces y botanas', icon: 'fluent-emoji-flat:candy', color: '#FCE7F3', keywords: ['dulces', 'botanas', 'snacks', 'gomitas', 'frituras'], order: 49 },
  { name: 'Frutas y verduras', icon: 'fluent-emoji-flat:carrot', color: '#D1FAE5', keywords: ['frutas', 'verduras', 'verduleria', 'frescos', 'mercado'], order: 50 },
];

async function main() {
  if (!process.argv.includes('--confirm')) {
    console.error('Seguridad: agrega --confirm para aplicar las categorías.');
    console.error('ADVERTENCIA: este script reemplaza TODAS las categorías y limpia');
    console.error('las asignaciones de restaurantes (deberán reelegir en Configuración).');
    process.exit(1);
  }

  const icons = CATEGORIES.map((c) => c.icon);
  const dupes = icons.filter((icon, i) => icons.indexOf(icon) !== i);
  if (dupes.length > 0) {
    console.error(`Iconos repetidos: ${[...new Set(dupes)].join(', ')}`);
    process.exit(1);
  }

  await prisma.$transaction(async (tx) => {
    await tx.restaurantStoreCategory.deleteMany({});
    await tx.storeCategory.deleteMany({});
    for (const cat of CATEGORIES) {
      await tx.storeCategory.create({
        data: {
          name: cat.name,
          icon: cat.icon,
          color: cat.color,
          keywords: cat.keywords,
          order: cat.order,
          isActive: true,
        },
      });
    }
  });

  console.log(`Sincronizadas ${CATEGORIES.length} categorías (reemplazo total).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
