const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.template.findMany({ where: { isSystem: false, name: { contains: 'Middle School Hall' } }, include: { zones: true } })
  .then(ts => console.log(JSON.stringify(ts[0].zones, null, 2)))
  .catch(console.error).finally(() => prisma.$disconnect());
