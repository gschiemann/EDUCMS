import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
(async () => {
  const copies = await prisma.template.findMany({
    where: { name: { contains: 'Sunny Meadow' }, isSystem: false },
    include: { zones: { orderBy: { sortOrder: 'asc' } } },
  });
  for (const t of copies) {
    console.log('\n----', t.id, '| tenant:', t.tenantId);
    for (const z of t.zones) {
      const cfg = z.defaultConfig ? JSON.parse(z.defaultConfig as any) : null;
      console.log(` - ${z.name} (${z.widgetType}) theme=${cfg?.theme ?? 'MISSING'}`);
    }
  }
  await prisma.$disconnect();
})();
