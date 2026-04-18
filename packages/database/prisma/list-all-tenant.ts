import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

(async () => {
  const all = await p.template.findMany({
    where: { isSystem: false },
    select: { id: true, name: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
    take: 20,
  });
  console.log('Recent tenant templates (top 20):');
  for (const t of all) {
    console.log('  ', t.id, '|', t.name, '|', t.updatedAt.toISOString());
  }
  await p.$disconnect();
})();
