const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.template.findMany({ select: { id: true, name: true } })
  .then(ts => ts.forEach(t => console.log(`${t.id} -> ${t.name}`)))
  .finally(() => prisma.$disconnect());
