const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.templateZone.findMany({ 
  where: { templateId: 'preset-lobby-sunshine-academy' } 
}).then(z => console.log(z)).finally(() => prisma.$disconnect());
