/**
 * Idempotent resync of the Sunny Meadow preset ONLY.
 * Deletes + recreates just that one template row; leaves all other templates untouched.
 * Run with: pnpm --filter @cms/database exec tsx prisma/resync-sunny-meadow.ts
 */
import { PrismaClient } from '@prisma/client';
import { SYSTEM_TEMPLATE_PRESETS } from '../../../apps/api/src/templates/system-presets';

const prisma = new PrismaClient();

async function main() {
  const preset = SYSTEM_TEMPLATE_PRESETS.find(p => p.id === 'preset-lobby-sunny-meadow');
  if (!preset) throw new Error('Sunny Meadow preset not found in SYSTEM_TEMPLATE_PRESETS');

  await prisma.templateZone.deleteMany({ where: { templateId: preset.id } });
  await prisma.template.deleteMany({ where: { id: preset.id } });

  await prisma.template.create({
    data: {
      id: preset.id,
      name: preset.name,
      description: preset.description,
      category: preset.category,
      orientation: preset.orientation,
      screenWidth: preset.screenWidth,
      screenHeight: preset.screenHeight,
      bgColor: preset.bgColor,
      bgGradient: preset.bgGradient,
      bgImage: preset.bgImage,
      isSystem: true,
      tenantId: null,
      zones: {
        create: preset.zones.map((z, i) => ({
          name: z.name,
          widgetType: z.widgetType,
          x: z.x, y: z.y, width: z.width, height: z.height,
          sortOrder: z.sortOrder ?? i,
          defaultConfig: z.defaultConfig ? JSON.stringify(z.defaultConfig) : null,
        })),
      },
    },
  });

  console.log(`Resynced preset "${preset.name}" (${preset.zones.length} zones, all themed sunny-meadow).`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
