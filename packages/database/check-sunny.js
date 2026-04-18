const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.templateZone.findMany({ 
  where: { templateId: 'preset-lobby-sunny-meadow' } 
}).then(z => console.log(z)).finally(() => prisma.$disconnect());
