import crypto from 'node:crypto';
import { prisma } from '../config/database';
import { hashToken } from '../utils/crypto';

const REFRESH_TOKEN_BYTES = 48;
const REFRESH_TOKEN_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

function generateToken(): string {
  return crypto.randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
}

export async function createRefreshToken(userId: string): Promise<string> {
  const token = generateToken();
  await prisma.refreshToken.create({
    data: {
      token: hashToken(token),
      userId,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS),
    },
  });
  return token;
}

export async function validateAndRotateRefreshToken(
  currentToken: string,
): Promise<{ userId: string; refreshToken: string } | null> {
  // Lookup primario por hash. Si no existe, se intenta con el token en claro
  // (retrocompatibilidad con filas creadas antes de este cambio).
  let stored = await prisma.refreshToken.findUnique({
    where: { token: hashToken(currentToken) },
  });

  if (!stored) {
    const legacy = await prisma.refreshToken.findUnique({
      where: { token: currentToken },
    });
    if (legacy) {
      stored = legacy;
    }
  }

  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    return null;
  }

  const storedId = stored.id;
  const storedUserId = stored.userId;

  try {
    const newToken = await prisma.$transaction(async (tx) => {
      await tx.refreshToken.update({
        where: { id: storedId },
        data: { revokedAt: new Date() },
      });

      const next = generateToken();
      await tx.refreshToken.create({
        data: {
          token: hashToken(next),
          userId: storedUserId,
          expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS),
        },
      });

      return next;
    });

    return { userId: storedUserId, refreshToken: newToken };
  } catch {
    // Si la rotación falla a medias, la transacción revierte la revocación:
    // el token actual permanece válido para reintentarlo.
    return null;
  }
}

export async function revokeRefreshToken(token: string): Promise<void> {
  const tokenHash = hashToken(token);
  await prisma.refreshToken.updateMany({
    where: { token: tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await prisma.refreshToken.updateMany({
    where: { token, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllUserRefreshTokens(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function cleanupExpiredRefreshTokens(): Promise<number> {
  const result = await prisma.refreshToken.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
}
