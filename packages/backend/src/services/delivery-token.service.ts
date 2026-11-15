import crypto from 'node:crypto';
import { hashToken, hmacToken } from '../utils/crypto';

const DELIVERY_TOKEN_TTL_HOURS = 3;

type PrismaLike = any;

/**
 * Obtiene (y si hace falta crea/regenera) el token de reparto de un pedido.
 *
 * Derivado del pedido Y de un nonce aleatorio persistido como ID del registro.
 * Reutiliza el QR vigente sin guardar el bearer en claro. Borrar/recrear el
 * registro cambia el token: un enlace revocado nunca revive al regenerarlo.
 */
export async function getOrCreateDeliveryToken(
  prisma: PrismaLike,
  orderId: string
): Promise<{ tokenStr: string; expiresAt: Date }> {
  const existing = await prisma.deliveryToken.findUnique({
    where: { orderId },
  });

  if (existing && new Date(existing.expiresAt) > new Date()) {
    const tokenStr = tokenForRecord(orderId, existing.id);
    if (existing.token === hashToken(tokenStr)) return { tokenStr, expiresAt: existing.expiresAt };
    throw new Error('El enlace anterior requiere regeneración explícita.');
  }
  if (existing) await prisma.deliveryToken.delete({ where: { id: existing.id } });
  const id = crypto.randomBytes(24).toString('hex');
  const tokenStr = tokenForRecord(orderId, id);
  const expiresAt = new Date(Date.now() + DELIVERY_TOKEN_TTL_HOURS * 60 * 60 * 1000);
  await prisma.deliveryToken.create({ data: { id, orderId, token: hashToken(tokenStr), rawToken: null, expiresAt } });
  return { tokenStr, expiresAt };
}

function tokenForRecord(orderId: string, recordId: string): string {
  return crypto.createHmac('sha256', hmacToken('delivery-token-seed'))
    .update(`delivery:${orderId}:${recordId}`).digest('base64url');
}

/** Read only: never creates, renews or revives a ticket. */
export async function readDeliveryToken(prisma: PrismaLike, orderId: string) {
  const row = await prisma.deliveryToken.findUnique({ where: { orderId } });
  if (!row || new Date(row.expiresAt) <= new Date()) return null;
  const tokenStr = tokenForRecord(orderId, row.id);
  return hashToken(tokenStr) === row.token ? { tokenStr, expiresAt: row.expiresAt } : null;
}
