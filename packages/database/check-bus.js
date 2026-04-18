const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.templateZone.findMany({ 
  where: { templateId: 'bus-loop-dismissal-board' } 
}).then(z => console.log(z)).finally(() => prisma.$disconnect());
