const { PrismaClient } = require('@prisma/client');

// Re-export all Prisma types
module.exports = require('@prisma/client');

// AppRole constants — using plain object (no TypeScript enum or 'as const')
const AppRole = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  DISTRICT_ADMIN: 'DISTRICT_ADMIN',
  SCHOOL_ADMIN: 'SCHOOL_ADMIN',
  CONTRIBUTOR: 'CONTRIBUTOR',
  RESTRICTED_VIEWER: 'RESTRICTED_VIEWER',
};
module.exports.AppRole = AppRole;

// Singleton Prisma client
const globalForPrisma = global;

const prisma =
  globalForPrisma.__prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.__prisma = prisma;

module.exports.prisma = prisma;
