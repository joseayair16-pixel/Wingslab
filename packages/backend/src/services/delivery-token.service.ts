import crypto from 'node:crypto';
import { hashToken, hmacToken } from '../utils/crypto';

const DELIVERY_TOKEN_TTL_HOURS = 3;

type PrismaLike = any;

/**
 * Obtiene (y si hace falta crea/regenera) el token de reparto de un pedido.
 *
 * El token es DETERMINISTA: se deriva con HMAC a partir del orderId y la clave
 * de cifrado del entorno, por lo que el mismo pedido siempre produce el mismo
 * token. Esto mantiene válidos los QR ya impresos sin necesidad de guardar el
 * token en texto plano en la BD (antes se persistía en `rawToken`).
 */
export async function getOrCreateDeliveryToken(
  prisma: PrismaLike,
  orderId: string
): Promise<{ tokenStr: string; expiresAt: Date }> {
  const tokenStr = crypto
    .createHmac('sha256', hmacToken('delivery-token-seed'))
    .update(`delivery:${orderId}`)
    .digest('base64url')
    .slice(0, 43);
  const hashedToken = hashToken(tokenStr);
  const expiresAt = new Date(Date.now() + DELIVERY_TOKEN_TTL_HOURS * 60 * 60 * 1000);

  const existing = await prisma.deliveryToken.findUnique({
    where: { orderId },
  });

  if (existing) {
    if (existing.token === hashedToken && new Date(existing.expiresAt) > new Date()) {
      return { tokenStr, expiresAt: existing.expiresAt };
    }

    await prisma.deliveryToken.update({
      where: { id: existing.id },
      data: { token: hashedToken, rawToken: null, expiresAt },
    });
  } else {
    await prisma.deliveryToken.create({
      data: {
        orderId,
        token: hashedToken,
        rawToken: null,
        expiresAt,
      },
    });
  }

  return { tokenStr, expiresAt };
}