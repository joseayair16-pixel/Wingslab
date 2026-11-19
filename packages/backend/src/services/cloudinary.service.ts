/**
 * Proveedor de medios Cloudinary.
 *
 * Implementación ligera sin SDK externo: subida firmada mediante la REST API
 * (`fetch` + firma SHA1 con node:crypto). Se activa únicamente cuando el
 * proveedor configurado es `cloudinary` y existen las credenciales.
 */

import { createHash } from 'node:crypto';
import { AppError } from '../errors/app-error';
import type { MediaUploadKind } from './storage.service';

type DeliveryType = 'upload' | 'authenticated';

type KindDefinition = {
  folderScope: 'public' | 'private';
  folderName: string;
  deliveryType: DeliveryType;
  tags: string[];
};

const cloudinaryKindMap: Record<MediaUploadKind, KindDefinition> = {
  'restaurant-logo': { folderScope: 'public', folderName: 'restaurant/logos', deliveryType: 'upload', tags: ['wingslab', 'restaurant', 'logo'] },
  'restaurant-cover': { folderScope: 'public', folderName: 'restaurant/covers', deliveryType: 'upload', tags: ['wingslab', 'restaurant', 'cover'] },
  'product-image': { folderScope: 'public', folderName: 'restaurant/products', deliveryType: 'upload', tags: ['wingslab', 'restaurant', 'product'] },
  'payment-proof': { folderScope: 'public', folderName: 'payments/proofs', deliveryType: 'upload', tags: ['wingslab', 'payment', 'proof'] },
  'driver-photo': { folderScope: 'public', folderName: 'drivers/photos', deliveryType: 'upload', tags: ['wingslab', 'driver', 'photo'] },
  'customer-avatar': { folderScope: 'public', folderName: 'customers/avatars', deliveryType: 'upload', tags: ['wingslab', 'customer', 'avatar'] },
  'menu-image': { folderScope: 'public', folderName: 'menu/carousel', deliveryType: 'upload', tags: ['wingslab', 'menu', 'banner'] },
};

export type CloudinaryConfig = {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  publicFolder: string;
  privateFolder: string;
};

export function getCloudinaryConfig(): Omit<CloudinaryConfig, 'cloudName' | 'apiKey' | 'apiSecret'> & Partial<Pick<CloudinaryConfig, 'cloudName' | 'apiKey' | 'apiSecret'>> {
  return {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME?.trim() || undefined,
    apiKey: process.env.CLOUDINARY_API_KEY?.trim() || undefined,
    apiSecret: process.env.CLOUDINARY_API_SECRET?.trim() || undefined,
    publicFolder: process.env.CLOUDINARY_PUBLIC_FOLDER?.trim() || 'wingslab/public',
    privateFolder: process.env.CLOUDINARY_PRIVATE_FOLDER?.trim() || 'wingslab/private',
  };
}

export function isCloudinaryConfigured(): boolean {
  const config = getCloudinaryConfig();
  return Boolean(config.cloudName && config.apiKey && config.apiSecret);
}

function getRequiredCloudinaryConfig(): CloudinaryConfig {
  const config = getCloudinaryConfig();
  if (!config.cloudName || !config.apiKey || !config.apiSecret) {
    throw new AppError(
      503,
      'MEDIA_PROVIDER_NOT_CONFIGURED',
      'Cloudinary no está configurado. Agrega CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET.'
    );
  }
  return config as CloudinaryConfig;
}

function sanitizePathToken(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9/_-]+/g, '-');
}

function buildCloudinaryFolder(kind: MediaUploadKind, actorId?: string): string {
  const config = getRequiredCloudinaryConfig();
  const definition = cloudinaryKindMap[kind];
  const root = definition.folderScope === 'public' ? config.publicFolder : config.privateFolder;
  return [root, definition.folderName, actorId ? sanitizePathToken(actorId) : 'anonymous']
    .filter(Boolean)
    .join('/');
}

function buildSignature(params: Record<string, string>, apiSecret: string): string {
  const serialized = Object.entries(params)
    .filter(([, value]) => value !== '')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  return createHash('sha1').update(`${serialized}${apiSecret}`).digest('hex');
}

const MAX_SOURCE_LENGTH = 12_000_000;
const ALLOWED_DATA_TYPES = /^data:image\/(png|jpe?g|webp|gif);base64,[a-zA-Z0-9+/=\r\n]+$/i;

function assertUploadSource(source: string): void {
  if (ALLOWED_DATA_TYPES.test(source) && source.length <= MAX_SOURCE_LENGTH) return;
  if (/^data:image\//i.test(source)) {
    throw new AppError(400, 'INVALID_MEDIA_SOURCE', 'Formato no admitido. Usa PNG, JPG, WebP o GIF (máx. 12 MB).');
  }
  try {
    const parsed = new URL(source);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return;
  } catch {
    /* se reporta abajo */
  }
  throw new AppError(400, 'INVALID_MEDIA_SOURCE', 'La imagen debe ser una data URL PNG/JPG/WebP/GIF o una URL http(s) válida.');
}

function cloudinaryApiUrl(path: string): string {
  const config = getRequiredCloudinaryConfig();
  return `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/${path}`;
}

export async function uploadImageToCloudinary(params: {
  source: string;
  kind: MediaUploadKind;
  actorId?: string;
  requestId?: string;
  fileName?: string;
}): Promise<{
  url: string;
  publicId: string;
  format?: string;
  width?: number;
  height?: number;
  bytes?: number;
  provider: 'cloudinary';
  deliveryType: DeliveryType;
}> {
  const { source, kind, actorId, requestId, fileName } = params;
  assertUploadSource(source);
  const config = getRequiredCloudinaryConfig();
  const definition = cloudinaryKindMap[kind];
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const folder = buildCloudinaryFolder(kind, actorId);
  const context = [
    'app=wingslab',
    `kind=${kind}`,
    actorId ? `actor=${sanitizePathToken(actorId)}` : '',
    requestId ? `request_id=${sanitizePathToken(requestId)}` : '',
    fileName ? `file_name=${sanitizePathToken(fileName)}` : '',
  ].filter(Boolean).join('|');
  const tags = Array.from(new Set([
    ...definition.tags,
    actorId ? `actor-${sanitizePathToken(actorId)}` : '',
  ])).filter(Boolean).join(',');

  const signable: Record<string, string> = {
    context,
    folder,
    tags,
    timestamp,
    type: definition.deliveryType,
  };

  const form = new FormData();
  form.append('file', source);
  form.append('api_key', config.apiKey);
  form.append('timestamp', timestamp);
  form.append('signature', buildSignature(signable, config.apiSecret));
  form.append('folder', folder);
  form.append('tags', tags);
  form.append('context', context);
  form.append('type', definition.deliveryType);

  const response = await fetch(cloudinaryApiUrl('image/upload'), { method: 'POST', body: form });
  const raw = await response.text();
  let payload: Record<string, unknown> = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { /* se reporta abajo */ }

  if (!response.ok) {
    const error = payload.error as { message?: string } | undefined;
    throw new AppError(502, 'MEDIA_UPLOAD_FAILED', error?.message || 'Cloudinary rechazó la subida de la imagen.');
  }
  if (typeof payload.secure_url !== 'string' || typeof payload.public_id !== 'string') {
    throw new AppError(502, 'MEDIA_UPLOAD_INVALID_RESPONSE', 'Cloudinary devolvió una respuesta incompleta para la imagen.');
  }

  return {
    url: payload.secure_url,
    publicId: payload.public_id,
    format: typeof payload.format === 'string' ? payload.format : undefined,
    width: typeof payload.width === 'number' ? payload.width : undefined,
    height: typeof payload.height === 'number' ? payload.height : undefined,
    bytes: typeof payload.bytes === 'number' ? payload.bytes : undefined,
    provider: 'cloudinary',
    deliveryType: definition.deliveryType,
  };
}

/** Convierte una URL de Cloudinary (o una clave legacy) a public_id. */
export function cloudinaryPublicIdFromUrl(value: string): string | null {
  if (!value) return null;
  let path = value;
  try { path = new URL(value).pathname; } catch { /* clave sin esquema */ }
  const marker = '/image/upload/';
  const at = path.indexOf(marker);
  if (at >= 0) path = path.slice(at + marker.length);
  else path = path.replace(/^\/?image\/upload\//, '');
  const publicId = path
    .replace(/^\/+|\/+$/g, '')
    .replace(/^v\d+\//, '')
    .replace(/\.[a-zA-Z0-9]+$/, '');
  return publicId || null;
}

/**
 * Borrado best-effort: un fallo posterior a un commit de dominio nunca debe
 * convertir una operación ya persistida en un error para el cliente.
 */
export async function deleteImagesFromCloudinary(keys: string[]): Promise<void> {
  const publicIds = Array.from(new Set(
    keys.map(cloudinaryPublicIdFromUrl).filter((id): id is string => !!id)
  ));
  if (publicIds.length === 0) return;
  if (!isCloudinaryConfigured()) return;

  try {
    const config = getRequiredCloudinaryConfig();
    // `image/destroy` acepta un solo `public_id` por llamada.
    for (const publicId of publicIds) {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signable = {
        invalidate: '1',
        public_id: publicId,
        timestamp,
        type: 'upload',
      };
      const form = new FormData();
      form.append('api_key', config.apiKey);
      form.append('timestamp', timestamp);
      form.append('signature', buildSignature(signable, config.apiSecret));
      form.append('public_id', publicId);
      form.append('invalidate', signable.invalidate);
      form.append('type', signable.type);

      const response = await fetch(cloudinaryApiUrl('image/destroy'), { method: 'POST', body: form });
      if (!response.ok) {
        const raw = await response.text().catch(() => '');
        console.warn('[Cloudinary] No se pudo borrar la imagen:', publicId, raw.slice(0, 300));
      }
    }
  } catch (err) {
    console.warn('[Cloudinary] Fallo no crítico al borrar imágenes:', err instanceof Error ? err.message : err);
  }
}
