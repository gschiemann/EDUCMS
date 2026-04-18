const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.templateZone.findMany({ where: { templateId: 'preset-back-to-school' } })
  .then(z => console.log(z.length))
  .catch(console.error).finally(() => prisma.$disconnect());
