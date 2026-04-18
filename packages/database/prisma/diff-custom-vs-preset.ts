import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

(async () => {
  // Check the user's custom BTS template (the most recent one) vs the system preset
  const customs = await p.template.findMany({
    where: { isSystem: false, name: { contains: 'Back to School' } },
    include: { zones: { take: 3, orderBy: { sortOrder: 'asc' } } },
    orderBy: { updatedAt: 'desc' },
    take: 1,
  });
  if (customs.length === 0) { console.log('no custom BTS'); return; }
  const custom = customs[0];
  console.log('--- CUSTOM (tenant):', custom.id, '|', custom.name);
  for (const z of custom.zones) console.log(' ', z.widgetType, '|', z.name, '→', z.defaultConfig);

  const sys = await p.template.findFirst({ where: { isSystem: true, name: { contains: 'Back to School' } }, include: { zones: { take: 3, orderBy: { sortOrder: 'asc' } } } });
  if (!sys) { console.log('no system BTS'); return; }
  console.log('\n--- SYSTEM (preset):', sys.id, '|', sys.name);
  for (const z of sys.zones) console.log(' ', z.widgetType, '|', z.name, '→', z.defaultConfig);

  await p.$disconnect();
})();
