const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.template.findUnique({
  where: { id: 'preset-middle-school-hall-board' },
  include: { zones: true }
}).then(t => {
  console.log(JSON.stringify(t, null, 2));
}).catch(console.error).finally(() => prisma.$disconnect());
