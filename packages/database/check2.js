const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.templateZone.findMany({
  where: { templateId: 'preset-middle-school-hall-board' }
}).then(zones => {
  console.log(zones.map(z => ({ name: z.name, config: z.defaultConfig })));
}).catch(console.error).finally(() => prisma.$disconnect());
