const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.template.findMany({ where: { name: { contains: "Middle School Hall" } } })
  .then(ts => console.log(ts.map(t => ({ id: t.id, name: t.name, isSystem: t.isSystem }))))
  .catch(console.error).finally(() => prisma.$disconnect());
