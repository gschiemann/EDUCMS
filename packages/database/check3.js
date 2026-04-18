const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.templateZone.findFirst({ where: { templateId: 'preset-middle-school-hall-board', name: 'Wall Clock' } })
  .then(z => console.log(typeof z.defaultConfig, z.defaultConfig))
  .catch(console.error).finally(() => prisma.$disconnect());
