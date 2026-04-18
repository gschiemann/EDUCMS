const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.templateZone.findMany({ 
  where: { templateId: 'high-school-athletics-scoreboard' } 
}).then(z => console.log('HSA:', z.length, z[0].defaultConfig)).catch(e => {});

prisma.templateZone.findMany({ 
  where: { templateId: 'preset-gym-scoreboard' } 
}).then(z => console.log('preset-gym:', z.length, z[0].defaultConfig)).finally(() => prisma.$disconnect());
