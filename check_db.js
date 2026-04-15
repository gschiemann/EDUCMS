const { PrismaClient } = require('./packages/database/node_modules/@prisma/client'); const p = new PrismaClient(); p.asset.findMany().then(console.log).finally(() => p.$disconnect());
