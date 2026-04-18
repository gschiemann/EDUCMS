import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const total = await p.template.count();
  const sys = await p.template.count({ where: { isSystem: true } });
  const tenant = await p.template.count({ where: { isSystem: false } });
  console.log(`Templates in DB: ${total} total — ${sys} system / ${tenant} tenant`);
  const recent = await p.template.findMany({ select: { name: true, isSystem: true }, orderBy: { updatedAt: 'desc' }, take: 8 });
  for (const t of recent) console.log(`  ${t.isSystem ? 'SYS' : 'ten'} ${t.name}`);
  await p.$disconnect();
})();
