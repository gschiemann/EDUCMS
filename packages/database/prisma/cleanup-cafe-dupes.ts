import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

(async () => {
  // Delete remaining tenant duplicates of the diner chalkboard
  const dupes = await p.template.findMany({
    where: { isSystem: false, name: { contains: 'Cafeteria Chalkboard' } },
  });
  for (const d of dupes) {
    await p.templateZone.deleteMany({ where: { templateId: d.id } });
  }
  const dd = await p.template.deleteMany({ where: { isSystem: false, name: { contains: 'Cafeteria Chalkboard' } } });
  console.log('Deleted', dd.count, 'duplicate diner chalkboard tenant copies');

  // Also delete the legacy "Cafeteria Daily Special" since it confuses things
  const oldDS = await p.template.findMany({ where: { name: { contains: 'Cafeteria Daily Special' } } });
  for (const o of oldDS) await p.templateZone.deleteMany({ where: { templateId: o.id } });
  const odd = await p.template.deleteMany({ where: { name: { contains: 'Cafeteria Daily Special' } } });
  console.log('Deleted', odd.count, 'legacy Cafeteria Daily Special');

  await p.$disconnect();
})();
