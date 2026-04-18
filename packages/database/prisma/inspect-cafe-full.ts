import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

(async () => {
  const t = await p.template.findUnique({
    where: { id: '95062388-ff35-42a5-8af6-c2eed1e4b0dd' },
    include: { zones: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!t) { console.log('not found'); return; }
  console.log('Template:', t.name, '| isSystem:', t.isSystem);
  console.log('bgGradient len:', t.bgGradient?.length || 0);
  console.log('All zones:');
  for (const z of t.zones) {
    const cfg = z.defaultConfig ? JSON.parse(z.defaultConfig as any) : {};
    console.log('  ', z.widgetType, '|', z.name, '→ theme:', cfg.theme, '| variant:', cfg.variant);
  }
  await p.$disconnect();
})();
