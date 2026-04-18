import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

(async () => {
  const t = await p.template.findUnique({
    where: { id: 'wc-cafeteria-diner' },
    include: { zones: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!t) { console.log('NOT FOUND'); return; }
  console.log('Template:', t.name);
  console.log('bgGradient len:', t.bgGradient?.length);
  for (const z of t.zones) {
    console.log('  ', z.widgetType, '|', z.name, '→ raw:', z.defaultConfig);
  }
  await p.$disconnect();
})();
