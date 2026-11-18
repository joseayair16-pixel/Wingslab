import sharp from 'sharp';
import { prisma } from '../config/database';
import { readMenuContent, saveMenuContent, saveMenuImage } from './menu-content.service';

describe('Local marketing persistence', () => {
  afterEach(() => jest.restoreAllMocks());
  it('does not overwrite concurrent edits', async () => {
    const tx = { $queryRawUnsafe: jest.fn(), systemSetting: { findUnique: jest.fn().mockResolvedValue({ value: JSON.stringify({ revision: 2, items: [] }) }), upsert: jest.fn() } };
    jest.spyOn(prisma, '$transaction').mockImplementation((async (fn: any) => fn(tx)) as any);
    await expect(saveMenuContent({ revision: 1, items: [] })).rejects.toMatchObject({ statusCode: 409 });
    expect(tx.systemSetting.upsert).not.toHaveBeenCalled();
  });
  it('persists only known images and increments the revision atomically', async () => {
    const tx = { $queryRawUnsafe: jest.fn(), systemSetting: { findUnique: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(0), upsert: jest.fn() } };
    jest.spyOn(prisma, '$transaction').mockImplementation((async (fn: any) => fn(tx)) as any);
    await expect(saveMenuContent({ revision: 0, items: [] })).resolves.toEqual({ revision: 1, items: [] });
    expect(tx.$queryRawUnsafe).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1))::text', 'wingslab.restaurant.menu-content.v1');
    expect(tx.systemSetting.upsert).toHaveBeenCalledTimes(1);
  });
  it('starts empty without migrations or seeded promotions', async () => {
    jest.spyOn(prisma.systemSetting, 'findUnique').mockResolvedValue(null);
    await expect(readMenuContent()).resolves.toEqual({ revision: 0, items: [] });
  });
  it('rejects external image URLs, SVG and malformed raster data', async () => {
    for (const value of ['https://outside.test/image.jpg', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,YmFk']) {
      await expect(saveMenuImage(value)).rejects.toMatchObject({ statusCode: 400 });
    }
  });
  it('normalizes uploaded raster images to bounded local WebP', async () => {
    const tx = { $queryRawUnsafe: jest.fn(), systemSetting: { count: jest.fn().mockResolvedValue(0), create: jest.fn() } };
    jest.spyOn(prisma, '$transaction').mockImplementation((async (fn: any) => fn(tx)) as any);
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#ff6600' } }).png().toBuffer();
    const result = await saveMenuImage(`data:image/png;base64,${png.toString('base64')}`);
    expect(result.id).toMatch(/^[a-f0-9-]{36}$/);
    const stored = tx.systemSetting.create.mock.calls[0][0].data;
    expect(stored.key).toBe('wingslab.restaurant.menu-image.' + result.id);
    const metadata = await sharp(Buffer.from(stored.value, 'base64')).metadata();
    expect(metadata.format).toBe('webp');
    tx.systemSetting.count.mockResolvedValue(100);
    await expect(saveMenuImage(`data:image/png;base64,${png.toString('base64')}`)).rejects.toMatchObject({ statusCode: 409 });
    expect(tx.systemSetting.create).toHaveBeenCalledTimes(1);
  });
});
