import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const NAMES = ['Middle School Hallway', 'Cafeteria Chalkboard', 'Back to School'];

async function main() {
  for (const name of NAMES) {
    const tenants = await p.template.findMany({
      where: { isSystem: false, name: { contains: name } },
      include: { zones: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (tenants.length === 0) { console.log('NO TENANT for:', name); continue; }
    const winner = tenants[0];
    console.log(`Promote: "${winner.name}" id=${winner.id} zones=${winner.zones.length}`);

    const oldSys = await p.template.findMany({ where: { isSystem: true, name: { contains: name } } });
    for (const o of oldSys) await p.templateZone.deleteMany({ where: { templateId: o.id } });
    const oldDel = await p.template.deleteMany({ where: { isSystem: true, name: { contains: name } } });
    console.log(`  Deleted ${oldDel.count} old system preset(s)`);

    await p.template.update({ where: { id: winner.id }, data: { isSystem: true, tenantId: null } });
    console.log('  Promoted to isSystem');

    const losers = tenants.slice(1).map(t => t.id);
    if (losers.length) {
      await p.templateZone.deleteMany({ where: { templateId: { in: losers } } });
      const ld = await p.template.deleteMany({ where: { id: { in: losers } } });
      console.log(`  Deleted ${ld.count} duplicate tenant copies`);
    }
  }
}

main()
  .then(() => { console.log('done'); return p.$disconnect(); })
  .catch(e => { console.error(e); process.exit(1); });
