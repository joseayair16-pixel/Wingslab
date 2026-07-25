/**
 * Database Configuration - Prisma
 */

import { PrismaClient } from '@prisma/client';
import './env';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

const NODE_ENV = process.env.NODE_ENV || 'development';

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    // Connection pool: increase for higher concurrency
    // PgBouncer mode: add ?pgbouncer=true to DATABASE_URL
  });

if (NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
