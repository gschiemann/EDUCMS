const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const sourceId = '95062388-ff35-42a5-8af6-c2eed1e4b0dd';
  const source = await prisma.template.findFirst({
    where: { id: sourceId },
    include: { zones: { orderBy: { sortOrder: 'asc' } } },
  });

  console.log('Source Zone 0:', source.zones[0].defaultConfig);

  const created = await prisma.template.create({
    data: {
      name: 'TEST CLONE',
      isSystem: false,
      zones: {
        create: source.zones.map(z => ({
          name: z.name,
          widgetType: z.widgetType,
          x: z.x, y: z.y, width: z.width, height: z.height,
          defaultConfig: z.defaultConfig
        }))
      }
    },
    include: { zones: true }
  });

  console.log('Created Zone 0:', created.zones[0].defaultConfig);
  
  await prisma.template.delete({ where: { id: created.id } });
}

run().catch(console.error).finally(() => prisma.$disconnect());
