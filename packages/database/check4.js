const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.template.findMany({ where: { isSystem: true } })
  .then(ts => console.log(ts.map(t => ({ id: t.id, name: t.name }))))
  .catch(console.error).finally(() => prisma.$disconnect());
