import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const ids = ['preset-cafeteria-menu', 'preset-middle-school-hall-board', 'wc-cafeteria-diner', 'wc-back-to-school', 'wc-hallway'];
  for (const id of ids) {
    const t = await p.template.findUnique({ where: { id }, include: { zones: { take: 3, orderBy: { sortOrder: 'asc' } } } });
    if (!t) { console.log(id, '✗ MISSING'); continue; }
    console.log(`\n=== ${id} | ${t.isSystem ? 'SYS' : 'ten'} | ${t.name}`);
    for (const z of t.zones) {
      const cfg = z.defaultConfig ? JSON.parse(z.defaultConfig as any) : {};
      console.log(`  ${z.widgetType} | ${z.name} → theme:${cfg.theme} | content:${(cfg.content || cfg.title || '').slice(0,30)}`);
    }
  }
  await p.$disconnect();
})();
