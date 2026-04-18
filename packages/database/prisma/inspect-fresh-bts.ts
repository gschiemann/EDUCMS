import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

(async () => {
  const t = await p.template.findUnique({
    where: { id: '745dfd95-b43d-4f73-9d6d-367e60d317dc' },
    include: { zones: { take: 3, orderBy: { sortOrder: 'asc' } } },
  });
  if (!t) { console.log('not found'); return; }
  console.log('Template:', t.name);
  for (const z of t.zones) {
    const cfg = z.defaultConfig ? JSON.parse(z.defaultConfig as any) : {};
    console.log('  ', z.widgetType, '|', z.name, '→', JSON.stringify(cfg).slice(0, 200));
  }
  await p.$disconnect();
})();
