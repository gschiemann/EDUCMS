import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

(async () => {
  // Find ALL templates that have a zone named 'Chalkboard Header' or 'Chalk Menu' or 'Diner Clock'
  const zones = await p.templateZone.findMany({
    where: { OR: [{ name: 'Chalkboard Header' }, { name: 'Chalk Menu' }, { name: 'Diner Clock' }, { name: 'Daily Special' }] },
    include: { template: { select: { id: true, name: true, isSystem: true } } },
  });
  const templateMap = new Map<string, { name: string; isSystem: boolean; zones: { name: string; cfg: any }[] }>();
  for (const z of zones) {
    const tid = z.template.id;
    if (!templateMap.has(tid)) {
      templateMap.set(tid, { name: z.template.name, isSystem: z.template.isSystem, zones: [] });
    }
    const cfg = z.defaultConfig ? JSON.parse(z.defaultConfig as any) : {};
    templateMap.get(tid)!.zones.push({ name: z.name, cfg });
  }
  for (const [tid, info] of templateMap) {
    console.log(info.isSystem ? 'SYSTEM' : 'tenant', '|', tid, '|', info.name);
    for (const z of info.zones) console.log('  ', z.name, '→ theme:', z.cfg.theme || '(none)');
  }
  await p.$disconnect();
})();
