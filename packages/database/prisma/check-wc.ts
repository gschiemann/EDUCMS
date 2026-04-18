import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const ids = ['wc-cafeteria-diner', 'wc-back-to-school', 'wc-hallway'];
  for (const id of ids) {
    const t = await p.template.findUnique({ where: { id }, select: { id: true, name: true } });
    console.log(id, t ? '✓ exists: ' + t.name : '✗ MISSING');
  }
  await p.$disconnect();
})();
