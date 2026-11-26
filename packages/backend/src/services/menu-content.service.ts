import crypto from 'node:crypto';
import sharp from 'sharp';
import { prisma } from '../config/database';
import { menuContentSchema, type MenuContent } from './menu-content-policy';
import { uploadImage } from './storage.service';

const KEY = 'wingslab.restaurant.menu-content.v1';
const IMAGE_KEY = 'wingslab.restaurant.menu-image.';
const failure = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

export async function readMenuContent(): Promise<MenuContent> {
  const row = await prisma.systemSetting.findUnique({ where: { key: KEY } });
  if (!row) return { revision: 0, items: [] };
  return menuContentSchema.parse(JSON.parse(row.value));
}

export async function saveMenuContent(data: MenuContent): Promise<MenuContent> {
  return prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))::text', KEY);
    const row = await tx.systemSetting.findUnique({ where: { key: KEY } });
    const current = row ? menuContentSchema.parse(JSON.parse(row.value)) : { revision: 0, items: [] };
    if (current.revision !== data.revision) throw failure(409, 'El contenido cambió en otra ventana. Recarga antes de editar.');
    const imageIds = [...new Set(data.items.map(item => item.imageId))];
    const count = await tx.systemSetting.count({ where: { key: { in: imageIds.map(id => IMAGE_KEY + id) } } });
    if (count !== imageIds.length) throw failure(400, 'Una imagen ya no está disponible. Vuelve a cargarla.');
    const next = { revision: current.revision + 1, items: data.items };
    await tx.systemSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: JSON.stringify(next) }, update: { value: JSON.stringify(next) } });
    return next;
  });
}

export async function saveMenuImage(source: string) {
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(source)) throw failure(400, 'Selecciona una imagen PNG, JPG o WebP.');
  const input = Buffer.from(source.slice(source.indexOf(',') + 1), 'base64');
  if (input.length > 3 * 1024 * 1024) throw failure(400, 'La imagen debe pesar como máximo 3 MiB.');
  let image: Buffer;
  try {
    image = await sharp(input, { limitInputPixels: 20_000_000 }).rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  } catch { throw failure(400, 'No se pudo leer esta imagen. Usa PNG, JPG o WebP.'); }
  // El límite de entrada es 3 MiB: no rechazamos después una imagen válida
  // porque su versión optimizada supere los 400 KB (una foto detallada puede
  // convertirse en ~1,5 MB de WebP). Solo acotamos tamaños desproporcionados.
  if (image.length > 3 * 1024 * 1024) throw failure(400, 'La imagen optimizada es demasiado grande. Reduce su tamaño.');

  const id = crypto.randomUUID(), key = IMAGE_KEY + id;
  // El proveedor de medios es la fuente de verdad; la BD solo guarda la
  // referencia (URL de Cloudinary), nunca los bytes ni un respaldo silencioso.
  const asset = await uploadImage({
    source: `data:image/webp;base64,${image.toString('base64')}`,
    kind: 'menu-image',
    fileName: `menu-${id}.webp`,
  });

  await prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))::text', IMAGE_KEY);
    // Acota las referencias huérfanas del editor, incluidas las subidas abandonadas.
    if (await tx.systemSetting.count({ where: { key: { startsWith: IMAGE_KEY } } }) >= 100) throw failure(409, 'Límite local de 100 imágenes alcanzado.');
    await tx.systemSetting.create({ data: { key, value: asset.url } });
  });
  return { id };
}

export async function readMenuImage(id: string): Promise<string | Buffer | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: IMAGE_KEY + id } });
  if (!row) return null;
  // Compatibilidad con referencias legadas guardadas como bytes en base64.
  if (row.value.startsWith('data:') || !row.value.startsWith('https://')) {
    try { return Buffer.from(row.value, 'base64'); } catch { return null; }
  }
  return row.value;
}
