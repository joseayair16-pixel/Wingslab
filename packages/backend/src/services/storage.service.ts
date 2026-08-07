import { S3Client, PutObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

import { AppError } from '../errors/app-error';

export type MediaUploadKind =
  | 'restaurant-logo'
  | 'restaurant-cover'
  | 'product-image'
  | 'payment-proof'
  | 'site-image'
  | 'driver-photo';

export type UploadResult = {
  url: string;
  publicId: string;
  format?: string;
  width?: number;
  height?: number;
  bytes?: number;
  provider: 'r2';
  deliveryType: 'upload';
};

const kindFolderMap: Record<MediaUploadKind, string> = {
  'restaurant-logo': 'restaurant/logos',
  'restaurant-cover': 'restaurant/covers',
  'product-image': 'restaurant/products',
  'payment-proof': 'payments/proofs',
  'site-image': 'site/assets',
  'driver-photo': 'drivers/photos',
};

function getR2Config() {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucketName = process.env.R2_BUCKET_NAME?.trim();
  const publicUrl = process.env.R2_PUBLIC_URL?.trim();

  return { accountId, accessKeyId, secretAccessKey, bucketName, publicUrl };
}

function getRequiredR2Config() {
  const config = getR2Config();

  if (!config.accountId || !config.accessKeyId || !config.secretAccessKey || !config.bucketName) {
    throw new AppError(
      503,
      'MEDIA_PROVIDER_NOT_CONFIGURED',
      'R2 (Cloudflare) no esta configurado. Agrega las credenciales en el archivo .env.'
    );
  }

  return config as { accountId: string; accessKeyId: string; secretAccessKey: string; bucketName: string; publicUrl: string | undefined };
}

function assertUploadSource(source: string) {
  if (/^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(source)) {
    return;
  }

  try {
    const parsed = new URL(source);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return;
    }
  } catch {
  }

  throw new AppError(400, 'INVALID_MEDIA_SOURCE', 'La imagen debe ser una data URL o una URL http(s) valida.');
}

function sanitizePathToken(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9/_-]+/g, '-');
}

let s3Client: S3Client | null = null;

function getS3Client(config: ReturnType<typeof getRequiredR2Config>) {
  if (!s3Client) {
    s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  return s3Client;
}

export function urlToKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    const key = parsed.pathname.replace(/^\//, '');
    if (!key || (!key.includes('/') && key.length < 5)) return null;
    return key;
  } catch {
    return null;
  }
}

export async function deleteImages(keys: (string | null | undefined)[]): Promise<void> {
  const validKeys = keys.filter((k): k is string => !!k);
  if (validKeys.length === 0) return;

  const config = getRequiredR2Config();
  const s3 = getS3Client(config);

  try {
    await s3.send(new DeleteObjectsCommand({
      Bucket: config.bucketName,
      Delete: { Objects: validKeys.map(Key => ({ Key })) },
    }));
  } catch (err) {
    throw new AppError(
      502,
      'MEDIA_DELETE_FAILED',
      err instanceof Error ? err.message : 'Fallo al eliminar imagenes de R2.'
    );
  }
}
export async function uploadImage(params: {
  source: string;
  kind: MediaUploadKind;
  actorId?: string;
  requestId?: string;
  fileName?: string;
}): Promise<UploadResult> {
  const { source, kind, actorId, fileName } = params;
  assertUploadSource(source);

  const config = getRequiredR2Config();
  const s3 = getS3Client(config);

  const base64Data = source.split(',')[1];
  const buffer = Buffer.from(base64Data, 'base64');

  const folder = kindFolderMap[kind];
  const sanitizedActor = actorId ? sanitizePathToken(actorId) : 'anonymous';
  const timestamp = Date.now();
  const safeFileName = fileName ? sanitizePathToken(fileName) : 'image';
  const key = `${folder}/${sanitizedActor}/${timestamp}_${safeFileName}.webp`;

  let webpBuffer: Buffer;
  let metadata: { width?: number; height?: number };

  try {
    const image = sharp(buffer);
    metadata = await image.metadata();

    webpBuffer = await image
      .webp({ quality: 80, effort: 4 })
      .toBuffer();
  } catch (err) {
    throw new AppError(
      502,
      'MEDIA_UPLOAD_FAILED',
      err instanceof Error ? err.message : 'Fallo al procesar la imagen.'
    );
  }

  try {
    await s3.send(new PutObjectCommand({
      Bucket: config.bucketName,
      Key: key,
      Body: webpBuffer,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
    }));
  } catch (err) {
    throw new AppError(
      502,
      'MEDIA_UPLOAD_FAILED',
      err instanceof Error ? err.message : 'Fallo la subida de la imagen a R2.'
    );
  }

  const publicUrl = config.publicUrl
    ? `${config.publicUrl.replace(/\/+$/, '')}/${key}`
    : `https://${config.bucketName}.${config.accountId}.r2.cloudflarestorage.com/${key}`;

  return {
    url: publicUrl,
    publicId: key,
    format: 'webp',
    width: metadata.width,
    height: metadata.height,
    bytes: webpBuffer.length,
    provider: 'r2',
    deliveryType: 'upload',
  };
}
