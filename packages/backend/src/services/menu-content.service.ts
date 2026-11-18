import crypto from 'node:crypto';
import sharp from 'sharp';
import { prisma } from '../config/database';
import { menuContentSchema, type MenuContent } from './menu-content-policy';

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
  if (input.length > 2 * 1024 * 1024) throw failure(400, 'La imagen debe pesar como máximo 2 MiB.');
  let image: Buffer;
  try {
    image = await sharp(input, { limitInputPixels: 20_000_000 }).rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  } catch { throw failure(400, 'No se pudo leer esta imagen. Usa PNG, JPG o WebP.'); }
  if (image.length > 400_000) throw failure(400, 'La imagen optimizada es demasiado grande. Reduce su tamaño.');
  const id = crypto.randomUUID(), key = IMAGE_KEY + id;
  await prisma.$transaction(async tx => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))::text', IMAGE_KEY);
    // Bound local storage, including abandoned editor uploads. No external provider.
    if (await tx.systemSetting.count({ where: { key: { startsWith: IMAGE_KEY } } }) >= 100) throw failure(409, 'Límite local de 100 imágenes alcanzado.');
    await tx.systemSetting.create({ data: { key, value: image.toString('base64') } });
  });
  return { id };
}

export async function readMenuImage(id: string) {
  const row = await prisma.systemSetting.findUnique({ where: { key: IMAGE_KEY + id } });
  return row ? Buffer.from(row.value, 'base64') : null;
}
