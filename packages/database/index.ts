import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

export const AppRole = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  DISTRICT_ADMIN: 'DISTRICT_ADMIN',
  SCHOOL_ADMIN: 'SCHOOL_ADMIN',
  CONTRIBUTOR: 'CONTRIBUTOR',
  RESTRICTED_VIEWER: 'RESTRICTED_VIEWER',
} as const;

export type AppRole = (typeof AppRole)[keyof typeof AppRole];

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
