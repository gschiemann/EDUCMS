import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  // Show all templates with key fields
  const all = await p.template.findMany({
    select: { id: true, name: true, isSystem: true, updatedAt: true, _count: { select: { zones: true } } },
    orderBy: { updatedAt: 'desc' },
  });
  console.log('Total templates:', all.length);
  console.log('--- Most recent 30 ---');
  for (const t of all.slice(0, 30)) {
    console.log(`${t.isSystem ? 'SYS' : 'ten'} | ${t.id} | ${t._count.zones}z | ${t.updatedAt.toISOString()} | ${t.name}`);
  }
  // Check working copies
  console.log('--- Working copies ---');
  for (const id of ['wc-cafeteria-diner', 'wc-back-to-school', 'wc-hallway']) {
    const t = await p.template.findUnique({ where: { id }, include: { zones: { take: 1 } } });
    if (!t) { console.log(id, '✗ MISSING'); continue; }
    const cfg = t.zones[0]?.defaultConfig ? JSON.parse(t.zones[0].defaultConfig as any) : null;
    console.log(`${id} | ${t._count?.zones ?? 'n/a'}z | first zone theme: ${cfg?.theme ?? '(no theme)'}`);
  }
  await p.$disconnect();
})();
