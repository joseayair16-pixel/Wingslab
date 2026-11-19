import {
  deleteImages,
  uploadImage,
  getStorageProvider,
  cloudinaryStorageProvider,
} from '../storage.service';
import { cloudinaryPublicIdFromUrl, isCloudinaryConfigured } from '../cloudinary.service';

test('memory es el proveedor por defecto', () => {
  expect(getStorageProvider().name).toBe('memory');
});

test('el proveedor Cloudinary está disponible y usa la REST API firmada', () => {
  expect(cloudinaryStorageProvider.name).toBe('cloudinary');
  expect(typeof cloudinaryStorageProvider.upload).toBe('function');
  expect(typeof cloudinaryStorageProvider.delete).toBe('function');
});

test('Cloudinary requiere credenciales para considerarse configurado', () => {
  const previous = {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  };
  delete process.env.CLOUDINARY_CLOUD_NAME;
  delete process.env.CLOUDINARY_API_KEY;
  delete process.env.CLOUDINARY_API_SECRET;
  expect(isCloudinaryConfigured()).toBe(false);
  if (previous.cloudName !== undefined) process.env.CLOUDINARY_CLOUD_NAME = previous.cloudName;
  if (previous.apiKey !== undefined) process.env.CLOUDINARY_API_KEY = previous.apiKey;
  if (previous.apiSecret !== undefined) process.env.CLOUDINARY_API_SECRET = previous.apiSecret;
});

test('extrae el public_id de una URL de Cloudinary', () => {
  expect(cloudinaryPublicIdFromUrl(
    'https://res.cloudinary.com/demo/image/upload/v1710000000/wingslab/public/product-image/actor/logo.jpg'
  )).toBe('wingslab/public/product-image/actor/logo');
  expect(cloudinaryPublicIdFromUrl('clave/legacy/sin-extension')).toBe('clave/legacy/sin-extension');
});

test('post-commit cleanup never throws', async () => {
  await expect(deleteImages(['legacy/image.webp', null, undefined])).resolves.toBeUndefined();
  await expect(deleteImages([])).resolves.toBeUndefined();
});

test('successful domain persistence is not followed by a cleanup error', async () => {
  const persist = jest.fn().mockResolvedValue({ id: 'fictional-product' });
  const update = async () => {
    const result = await persist();
    await deleteImages(['previous/image.webp']);
    return result;
  };
  await expect(update()).resolves.toEqual({ id: 'fictional-product' });
  expect(persist).toHaveBeenCalledTimes(1);
});

test('unavailable URL imports reject before the caller can persist an asset', async () => {
  await expect(uploadImage({ source: 'https://media.invalid/image.png', kind: 'product-image' })).rejects.toMatchObject({ statusCode: 400 });
});
