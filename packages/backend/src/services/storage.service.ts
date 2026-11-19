import { getBackendConfiguration } from '../config/env';
import { memoryStorageProvider } from './storage/memory.provider';
import {
  deleteImagesFromCloudinary,
  uploadImageToCloudinary,
} from './cloudinary.service';

export type MediaUploadKind =
  | 'restaurant-logo'
  | 'restaurant-cover'
  | 'product-image'
  | 'payment-proof'
  | 'driver-photo'
  | 'customer-avatar'
  | 'menu-image';

export type UploadResult = {
  url: string;
  publicId: string;
  format?: string;
  width?: number;
  height?: number;
  bytes?: number;
  provider: 'cloudinary' | 'memory';
  deliveryType: 'upload' | 'authenticated';
};

export type UploadParameters = {
  source: string; kind: MediaUploadKind; actorId?: string; requestId?: string; fileName?: string;
};

export interface StorageProvider {
  readonly name: 'memory' | 'cloudinary';
  upload(params: UploadParameters): Promise<UploadResult>;
  delete(keys: string[]): Promise<void>;
}

export const cloudinaryStorageProvider: StorageProvider = {
  name: 'cloudinary',
  upload: (params) => uploadImageToCloudinary(params),
  delete: (keys) => deleteImagesFromCloudinary(keys),
};

/**
 * Cloudinary es el proveedor por defecto y definitivo. `memory` solo existe para
 * pruebas herméticas explícitas: nunca se usa como respaldo silencioso. Si faltan
 * credenciales, la subida falla con un error claro (MEDIA_PROVIDER_NOT_CONFIGURED).
 */
export function getStorageProvider(): StorageProvider {
  let configured: 'memory' | 'cloudinary' = 'cloudinary';
  try {
    configured = getBackendConfiguration().storageProvider;
  } catch {
    // Configuración aún no inicializada (tests): se respeta el valor explícito
    // del entorno; si no hay ninguno, se mantiene el proveedor definitivo.
    configured = process.env.WINGSLAB_STORAGE_PROVIDER === 'memory' ? 'memory' : 'cloudinary';
  }
  return configured === 'memory' ? memoryStorageProvider : cloudinaryStorageProvider;
}

export async function uploadImage(params: UploadParameters): Promise<UploadResult> {
  return getStorageProvider().upload(params);
}

export async function deleteImages(keys: (string | null | undefined)[]): Promise<void> {
  const validKeys = Array.from(new Set(keys.filter((key): key is string => !!key)));
  if (validKeys.length === 0) return;
  // El borrado es best-effort: nunca debe fallar después de un commit de dominio.
  await getStorageProvider().delete(validKeys);
}

export function urlToKey(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const key = parsed.pathname.replace(/^\//, '');
    if (!key || (!key.includes('/') && key.length < 5)) return null;
    return key;
  } catch {
    return null;
  }
}
