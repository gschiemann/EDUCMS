const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.template.findMany({ 
  where: { isSystem: true, name: { contains: 'Cafeteria' } }, 
  include: { zones: true } 
}).then(ts => console.log(JSON.stringify(ts, null, 2))).finally(() => prisma.$disconnect());
