import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

(async () => {
  const all = await p.template.findMany({
    where: { name: { contains: 'Cafeteria' } },
    include: { zones: { take: 3, orderBy: { sortOrder: 'asc' } } },
  });
  for (const t of all) {
    console.log('---', t.isSystem ? 'SYSTEM' : 'tenant', '|', t.id, '|', t.name);
    for (const z of t.zones) console.log('  ', z.widgetType, '→', z.defaultConfig);
  }
  await p.$disconnect();
})();
