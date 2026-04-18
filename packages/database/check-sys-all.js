const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.template.findMany({ 
  where: { isSystem: true }, 
  select: { id: true, name: true } 
}).then(ts => console.log(ts)).finally(() => prisma.$disconnect());
