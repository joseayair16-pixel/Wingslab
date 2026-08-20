import crypto from 'node:crypto';
import { hashToken } from '../utils/crypto';

const DELIVERY_TOKEN_TTL_HOURS = 3;

type PrismaLike = any;

/**
 * Obtiene (y si hace falta crea/regenera) el token de reparto de un pedido.
 *
 * Regla clave: si ya existe un token vigente (no expirado), se REUTILIZA tal cual.
 * Antes se regeneraba en cada llamada, lo que invalidaba el QR que el repartidor
 * ya había escaneado (404 en el siguiente GET). Ahora solo se regenera si no
 * existe o si expiró.
 */
export async function getOrCreateDeliveryToken(
  prisma: PrismaLike,
  orderId: string
): Promise<{ tokenStr: string; expiresAt: Date }> {
  const existing = await prisma.deliveryToken.findUnique({
    where: { orderId },
  });

  if (existing && new Date(existing.expiresAt) > new Date() && existing.rawToken) {
    return { tokenStr: existing.rawToken, expiresAt: existing.expiresAt };
  }

  const tokenStr = crypto.randomBytes(32).toString('hex');
  const hashedToken = hashToken(tokenStr);
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + DELIVERY_TOKEN_TTL_HOURS);

  if (existing) {
    await prisma.deliveryToken.update({
      where: { id: existing.id },
      data: { token: hashedToken, rawToken: tokenStr, expiresAt },
    });
  } else {
    await prisma.deliveryToken.create({
      data: {
        orderId,
        token: hashedToken,
        rawToken: tokenStr,
        expiresAt,
      },
    });
  }

  return { tokenStr, expiresAt };
}