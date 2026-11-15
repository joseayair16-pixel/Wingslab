import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { AppError } from '../../errors/app-error';
import type { StorageProvider, UploadParameters, UploadResult } from '../storage.service';

/** Simulated storage: image bytes live in the returned data URL, never on disk/network.
 * Deletion is deliberately idempotent/no-throw: removing the DB reference is sufficient.
 * This is NOT a production media provider (size, privacy and browser limits apply).
 */
export const memoryStorageProvider: StorageProvider = {
  name: 'memory',
  async upload(params: UploadParameters): Promise<UploadResult> {
    if (!/^data:image\/(png|jpe?g|webp|gif);base64,[a-zA-Z0-9+/=\r\n]+$/i.test(params.source) || params.source.length > 12_000_000) {
      throw new AppError(400, 'INVALID_MEDIA_SOURCE', 'El almacenamiento simulado requiere una imagen base64 válida.');
    }
    let buffer: Buffer;
    try {
      const image = sharp(Buffer.from(params.source.split(',')[1], 'base64'), { limitInputPixels: 40_000_000 }).rotate();
      buffer = await image.webp({ quality: 80 }).toBuffer();
    } catch {
      throw new AppError(400, 'INVALID_MEDIA_SOURCE', 'No se pudo procesar la imagen de prueba.');
    }
    const metadata = await sharp(buffer).metadata();
    return {
      url: `data:image/webp;base64,${buffer.toString('base64')}`,
      publicId: `wingslab-memory/${createHash('sha256').update(buffer).digest('hex')}.webp`,
      format: 'webp', width: metadata.width, height: metadata.height, bytes: buffer.length,
      provider: 'memory', deliveryType: 'upload',
    };
  },
  async delete(_keys: string[]): Promise<void> {
    // No remote/local files exist. Never turn a committed domain write into an error.
  },
};
