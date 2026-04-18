/**
 * Sync the Back to School preset AND keep one editable tenant working-copy in sync.
 * Run after every iteration: pnpm --filter @cms/database exec tsx prisma/sync-bts-working-copy.ts
 */
import { PrismaClient } from '@prisma/client';
import { SYSTEM_TEMPLATE_PRESETS } from '../../../apps/api/src/templates/system-presets';

const prisma = new PrismaClient();
const WORKING_COPY_ID = 'bts-working-copy';
const TENANT_ID = '00000000-0000-0000-0000-000000000002'; // springfield-elementary

async function main() {
  const preset = SYSTEM_TEMPLATE_PRESETS.find(p => p.id === 'preset-back-to-school');
  if (!preset) throw new Error('preset-back-to-school not found');

  // 1. Resync the system preset
  await prisma.templateZone.deleteMany({ where: { templateId: preset.id } });
  await prisma.template.deleteMany({ where: { id: preset.id } });
  await prisma.template.create({
    data: {
      id: preset.id,
      name: preset.name, description: preset.description,
      category: preset.category, orientation: preset.orientation,
      screenWidth: preset.screenWidth, screenHeight: preset.screenHeight,
      bgColor: preset.bgColor, bgGradient: preset.bgGradient, bgImage: preset.bgImage,
      isSystem: true, tenantId: null,
      zones: {
        create: preset.zones.map((z, i) => ({
          name: z.name, widgetType: z.widgetType,
          x: z.x, y: z.y, width: z.width, height: z.height,
          sortOrder: z.sortOrder ?? i,
          defaultConfig: z.defaultConfig ? JSON.stringify(z.defaultConfig) : null,
        })),
      },
    },
  });

  // 2. Wipe ALL tenant copies of Back to School so the gallery stays clean
  const tenantCopies = await prisma.template.findMany({
    where: { isSystem: false, name: { contains: 'Back to School' } },
  });
  for (const t of tenantCopies) {
    await prisma.templateZone.deleteMany({ where: { templateId: t.id } });
  }
  await prisma.template.deleteMany({
    where: { isSystem: false, name: { contains: 'Back to School' } },
  });

  // 3. Create ONE editable working copy with a stable ID
  await prisma.template.create({
    data: {
      id: WORKING_COPY_ID,
      name: '🍎 Back to School (Working Copy)',
      description: preset.description,
      category: preset.category, orientation: preset.orientation,
      screenWidth: preset.screenWidth, screenHeight: preset.screenHeight,
      bgColor: preset.bgColor, bgGradient: preset.bgGradient, bgImage: preset.bgImage,
      isSystem: false, tenantId: TENANT_ID,
      zones: {
        create: preset.zones.map((z, i) => ({
          name: z.name, widgetType: z.widgetType,
          x: z.x, y: z.y, width: z.width, height: z.height,
          sortOrder: z.sortOrder ?? i,
          defaultConfig: z.defaultConfig ? JSON.stringify(z.defaultConfig) : null,
        })),
      },
    },
  });

  console.log(`✓ System preset resynced (${preset.zones.length} zones)`);
  console.log(`✓ Wiped ${tenantCopies.length} stale tenant copies`);
  console.log(`✓ Working copy id=${WORKING_COPY_ID} ready at /templates/builder/${WORKING_COPY_ID}`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
