import { deleteImages, uploadImage, getStorageProvider, r2StorageProvider } from '../storage.service';

test('only simulated storage is selected', () => {
  expect(getStorageProvider().name).toBe('memory');
});
test('post-commit cleanup of existing references cannot fail or contact R2', async () => {
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
test('retained R2 implementation still refuses external operations', async () => {
  await expect(r2StorageProvider.delete(['image.webp'])).rejects.toThrow('External operations');
});
