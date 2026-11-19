import { createHash } from 'node:crypto';
import { cloudinaryPublicIdFromUrl, deleteImagesFromCloudinary, uploadImageToCloudinary } from './cloudinary.service';

const ENV_KEYS = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'] as const;

describe('Cloudinary provider', () => {
  const original: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const key of ENV_KEYS) original[key] = process.env[key];
    process.env.CLOUDINARY_CLOUD_NAME = 'demo-cloud';
    process.env.CLOUDINARY_API_KEY = 'demo-key';
    process.env.CLOUDINARY_API_SECRET = 'demo-secret';
  });
  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
    jest.restoreAllMocks();
  });

  it('envía una subida firmada y devuelve la URL segura', async () => {
    let url = '';
    let body: FormData | null = null;
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      url = String(input);
      body = (init?.body as FormData) ?? null;
      return {
        ok: true,
        text: async () => JSON.stringify({
          secure_url: 'https://res.cloudinary.com/demo-cloud/image/upload/v1710000000/wingslab/public/product-image/user/logo.jpg',
          public_id: 'wingslab/public/product-image/user/logo',
          format: 'jpg', width: 10, height: 10, bytes: 100,
        }),
      } as unknown as Response;
    });

    const result = await uploadImageToCloudinary({
      source: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      kind: 'product-image',
      actorId: 'user',
    });

    expect(url).toBe('https://api.cloudinary.com/v1_1/demo-cloud/image/upload');
    expect(result.provider).toBe('cloudinary');
    expect(result.url).toContain('res.cloudinary.com/demo-cloud');
    expect(result.publicId).toBe('wingslab/public/product-image/user/logo');
    expect(body).not.toBeNull();
    const form = body as FormData;
    expect(form.get('api_key')).toBe('demo-key');
    expect(form.get('folder')).toBe('wingslab/public/restaurant/products/user');

    const signed: Record<string, string> = {
      context: String(form.get('context')),
      folder: String(form.get('folder')),
      tags: String(form.get('tags')),
      timestamp: String(form.get('timestamp')),
      type: String(form.get('type')),
    };
    const serialized = Object.entries(signed)
      .filter(([, value]) => value !== '')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join('&');
    expect(form.get('signature')).toBe(
      createHash('sha1').update(`${serialized}demo-secret`).digest('hex')
    );
  });

  it('deriva el public_id de una clave image/upload/v...', () => {
    expect(cloudinaryPublicIdFromUrl(
      'image/upload/v1795054209/wingslab/public/restaurant/products/user/logo.png'
    )).toBe('wingslab/public/restaurant/products/user/logo');
  });

  it('borra con public_id singular (formato exigido por image/destroy)', async () => {
    const calls: { url: string; form: FormData }[] = [];
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      calls.push({ url: String(input), form: (init?.body as FormData) ?? new FormData() });
      return { ok: true, text: async () => JSON.stringify({ result: 'ok' }) } as unknown as Response;
    });

    await deleteImagesFromCloudinary([
      'https://res.cloudinary.com/demo-cloud/image/upload/v1/wingslab/public/a/x.png',
      'wingslab/public/b/y',
    ]);

    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toContain('/image/destroy');
    expect(calls[0]!.form.get('public_id')).toBe('wingslab/public/a/x');
    expect(calls[1]!.form.get('public_id')).toBe('wingslab/public/b/y');
    expect(calls[0]!.form.get('public_ids')).toBeNull();
    const form = calls[0]!.form;
    const signed: Record<string, string> = {
      invalidate: String(form.get('invalidate')),
      public_id: String(form.get('public_id')),
      timestamp: String(form.get('timestamp')),
      type: String(form.get('type')),
    };
    const serialized = Object.entries(signed)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join('&');
    expect(form.get('signature')).toBe(
      createHash('sha1').update(`${serialized}demo-secret`).digest('hex')
    );
  });
});
