/**
 * Idempotent resync of the Back to School preset ONLY.
 * Run: pnpm --filter @cms/database exec tsx prisma/resync-back-to-school.ts
 */
import { PrismaClient } from '@prisma/client';
import { SYSTEM_TEMPLATE_PRESETS } from '../../../apps/api/src/templates/system-presets';

const prisma = new PrismaClient();

async function main() {
  const preset = SYSTEM_TEMPLATE_PRESETS.find(p => p.id === 'preset-back-to-school');
  if (!preset) throw new Error('Back to School preset not found');

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

  console.log(`Resynced "${preset.name}" (${preset.zones.length} zones, theme=back-to-school).`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
