import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

(async () => {
  // Simulate exactly what the from-preset endpoint does
  const source = await p.template.findFirst({
    where: { id: '95062388-ff35-42a5-8af6-c2eed1e4b0dd', isSystem: true },
    include: { zones: { orderBy: { sortOrder: 'asc' } } },
  });
  if (!source) { console.log('SYSTEM SOURCE NOT FOUND'); return; }

  console.log('Source zones (first 3):');
  for (const z of source.zones.slice(0, 3)) {
    console.log('  type:', typeof z.defaultConfig, '| value:', JSON.stringify(z.defaultConfig).slice(0, 150));
  }

  // Now create a clone exactly like the controller does
  const clone = await p.template.create({
    data: {
      tenantId: '00000000-0000-0000-0000-000000000002',
      name: 'TEST CLONE - delete me',
      description: source.description,
      category: source.category,
      orientation: source.orientation,
      screenWidth: source.screenWidth,
      screenHeight: source.screenHeight,
      bgColor: source.bgColor,
      bgGradient: source.bgGradient,
      isSystem: false,
      zones: {
        create: source.zones.map((z) => ({
          name: z.name,
          widgetType: z.widgetType,
          x: z.x, y: z.y, width: z.width, height: z.height,
          zIndex: z.zIndex,
          sortOrder: z.sortOrder,
          defaultConfig: z.defaultConfig,
        })),
      },
    },
    include: { zones: { orderBy: { sortOrder: 'asc' } } },
  });

  console.log('\nClone zones (first 3):');
  for (const z of clone.zones.slice(0, 3)) {
    console.log('  type:', typeof z.defaultConfig, '| value:', JSON.stringify(z.defaultConfig).slice(0, 150));
  }

  // Cleanup
  await p.templateZone.deleteMany({ where: { templateId: clone.id } });
  await p.template.delete({ where: { id: clone.id } });
  console.log('\nTest clone deleted');
  await p.$disconnect();
})();
