const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.templateZone.findMany({ 
  where: { templateId: '092408f5-bff3-4895-a47d-df1e1267d491' } 
}).then(z => console.log(z)).finally(() => prisma.$disconnect());
