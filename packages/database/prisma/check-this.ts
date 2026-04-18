import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const t = await p.template.findUnique({ where: { id: '761f3787-b9bd-4b8e-bdef-ff93c498b731' }, include: { zones: { take: 2 } } });
  if (!t) { console.log('NOT FOUND'); return; }
  console.log('Name:', t.name);
  console.log('isSystem:', t.isSystem);
  console.log('tenantId:', t.tenantId);
  console.log('zones:', t.zones.length);
  for (const z of t.zones) console.log(' ', z.widgetType, '→', z.defaultConfig);
  await p.$disconnect();
})();
