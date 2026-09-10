import crypto from 'node:crypto';
import { hashToken, hmacToken } from '../utils/crypto';
import { getOrCreateDeliveryToken } from './delivery-token.service';

function expectedToken(orderId: string): string {
  return crypto
    .createHmac('sha256', hmacToken('delivery-token-seed'))
    .update(`delivery:${orderId}`)
    .digest('base64url')
    .slice(0, 43);
}

function makeFakePrisma(existing: any = null) {
  return {
    deliveryToken: {
      findUnique: jest.fn().mockResolvedValue(existing),
      create: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(null),
    },
  } as any;
}

describe('delivery-token.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('genera un token determinista y guarda SOLO el hash (sin rawToken en claro)', async () => {
    const prisma = makeFakePrisma();

    const result = await getOrCreateDeliveryToken(prisma, 'order-1');

    expect(result.tokenStr).toBe(expectedToken('order-1'));
    expect(prisma.deliveryToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order-1',
        token: hashToken(result.tokenStr),
        rawToken: null,
        expiresAt: expect.any(Date),
      }),
    });
  });

  it('reutiliza el mismo token sin tocar la BD si ya existe y sigue vigente', async () => {
    const tokenStr = expectedToken('order-1');
    const prisma = makeFakePrisma({
      id: 'd-1',
      orderId: 'order-1',
      token: hashToken(tokenStr),
      rawToken: null,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await getOrCreateDeliveryToken(prisma, 'order-1');

    expect(result.tokenStr).toBe(tokenStr);
    expect(prisma.deliveryToken.update).not.toHaveBeenCalled();
    expect(prisma.deliveryToken.create).not.toHaveBeenCalled();
  });

  it('regenera el token y limpia rawToken si el hash cambió o expiró', async () => {
    const prisma = makeFakePrisma({
      id: 'd-1',
      orderId: 'order-1',
      token: 'hash-viejo',
      rawToken: 'plain-viejo',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await getOrCreateDeliveryToken(prisma, 'order-1');

    expect(result.tokenStr).toBe(expectedToken('order-1'));
    expect(prisma.deliveryToken.update).toHaveBeenCalledWith({
      where: { id: 'd-1' },
      data: expect.objectContaining({
        token: hashToken(result.tokenStr),
        rawToken: null,
        expiresAt: expect.any(Date),
      }),
    });
    expect(prisma.deliveryToken.create).not.toHaveBeenCalled();
  });

  it('un mismo pedido siempre produce el mismo token (QR estable)', async () => {
    const a = await getOrCreateDeliveryToken(makeFakePrisma(), 'order-42');
    const b = await getOrCreateDeliveryToken(makeFakePrisma(), 'order-42');
    expect(a.tokenStr).toBe(b.tokenStr);
  });
});