import { PrismaClient } from '@prisma/client';

/**
 * Singleton PrismaClient. Cached on globalThis so dev hot-reload (Next.js,
 * tsx watch) never opens a second connection pool.
 */
const globalForPrisma = globalThis as unknown as { __rafterPrisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.__rafterPrisma ?? new PrismaClient();

globalForPrisma.__rafterPrisma = prisma;

export type { PrismaClient };
