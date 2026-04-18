import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

(async () => {
  // Find any template that has a zone named "Chalkboard Header" or "Chalk Menu"
  const zones = await p.templateZone.findMany({
    where: { OR: [{ name: 'Chalkboard Header' }, { name: 'Chalk Menu' }, { name: 'Chalkboard Headline' }] },
    include: { template: true },
  });
  const seen = new Set<string>();
  for (const z of zones) {
    if (seen.has(z.template.id)) continue;
    seen.add(z.template.id);
    console.log(z.template.isSystem ? 'SYSTEM' : 'tenant', '|', z.template.id, '|', z.template.name);
  }
  await p.$disconnect();
})();
