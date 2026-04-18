const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function check() {
  const t = await p.template.findUnique({ where: { id: 'middle-school-hall-board' } });
  console.log('MS Hall:', t.bgImage ? 'HAS BG IMAGE' : 'NO BG IMAGE');
}

check().finally(() => p.$disconnect());
