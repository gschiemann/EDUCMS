const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.template.findMany({ 
  where: { isSystem: true, name: { contains: 'Athletics' } } 
}).then(ts => console.log(ts)).finally(() => prisma.$disconnect());
