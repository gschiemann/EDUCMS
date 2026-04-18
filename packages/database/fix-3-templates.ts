import { PrismaClient } from '@prisma/client';
import { SYSTEM_TEMPLATE_PRESETS } from '../../apps/api/src/templates/system-presets';

const prisma = new PrismaClient();

async function main() {
  const templatesToFix = [
    { nameMatch: 'Cafeteria Chalkboard', targetId: 'preset-cafeteria-menu' },
    { nameMatch: 'Middle School Hall', targetId: 'preset-middle-school-hall-board' },
    { nameMatch: 'Bus Loop', targetId: 'bus-loop-dismissal-board' },
  ];

  for (const { nameMatch, targetId } of templatesToFix) {
    const preset = SYSTEM_TEMPLATE_PRESETS.find(p => p.id === targetId);
    if (!preset) {
      console.log(`Could not find preset for target ID ${targetId}`);
      continue;
    }

    const instances = await prisma.template.findMany({
      where: { name: { contains: nameMatch } }
    });

    console.log(`Found ${instances.length} instances matching "${nameMatch}"`);

    for (const t of instances) {
      console.log(`  Updating ${t.name} (id: ${t.id})...`);
      await prisma.template.update({
        where: { id: t.id },
        data: {
          name: preset.name,
          bgGradient: preset.bgGradient || null,
          bgColor: preset.bgColor || null,
          bgImage: preset.bgImage || null,
        }
      });

      // Clear existing zones
      await prisma.templateZone.deleteMany({ where: { templateId: t.id } });

      // Apply new zones from preset
      for (const z of preset.zones) {
        await prisma.templateZone.create({
          data: {
            templateId: t.id,
            name: z.name,
            widgetType: z.widgetType,
            x: z.x,
            y: z.y,
            width: z.width,
            height: z.height,
            zIndex: z.zIndex || 0,
            sortOrder: z.sortOrder || 0,
            defaultConfig: JSON.stringify(z.defaultConfig || {}),
          }
        });
      }
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
