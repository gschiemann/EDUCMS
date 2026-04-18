import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

(async () => {
  // Find any zone whose defaultConfig contains the word "variant"
  const zones = await p.templateZone.findMany({
    where: { defaultConfig: { contains: 'variant' } },
    include: { template: { select: { id: true, name: true, isSystem: true } } },
  });
  const seen = new Set<string>();
  console.log('Templates with at least one zone having a "variant" field:');
  for (const z of zones) {
    if (seen.has(z.template.id)) continue;
    seen.add(z.template.id);
    console.log(' ', z.template.isSystem ? 'SYSTEM' : 'tenant', '|', z.template.id, '|', z.template.name);
  }
  console.log(`\n${seen.size} templates total`);
  await p.$disconnect();
})();
