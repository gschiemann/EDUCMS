/**
 * Wipe all tenant copies of the 3 promoted presets and create ONE fresh
 * working copy of each with stable IDs so iteration URLs stay constant.
 */
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const TENANT = '00000000-0000-0000-0000-000000000002';
const PRESETS = [
  { presetId: '95062388-ff35-42a5-8af6-c2eed1e4b0dd', wcId: 'wc-cafeteria-diner', wcName: '🍽️ Cafeteria (Working Copy)' },
  { presetId: '4ee0ceab-9de5-4334-8f37-a82fbaf4910e', wcId: 'wc-back-to-school', wcName: '🍎 Back to School (Working Copy)' },
];

(async () => {
  // Find Hallway preset id
  const hall = await p.template.findFirst({ where: { isSystem: true, name: { contains: 'Middle School Hallway' } } });
  if (hall) PRESETS.push({ presetId: hall.id, wcId: 'wc-hallway', wcName: '🏫 Hallway (Working Copy)' });

  for (const { presetId, wcId, wcName } of PRESETS) {
    // Delete ALL tenant copies of templates with this name (and the existing working copy)
    const preset = await p.template.findUnique({ where: { id: presetId }, include: { zones: { orderBy: { sortOrder: 'asc' } } } });
    if (!preset) { console.log('PRESET NOT FOUND:', presetId); continue; }
    const baseName = preset.name.replace(/\s*\(Working Copy\)/, '').trim();
    const dupes = await p.template.findMany({ where: { isSystem: false, name: { contains: baseName } } });
    for (const d of dupes) await p.templateZone.deleteMany({ where: { templateId: d.id } });
    const dd = await p.template.deleteMany({ where: { isSystem: false, name: { contains: baseName } } });
    console.log(`[${baseName}] deleted ${dd.count} tenant copies`);

    // Also remove any prior working copy with our stable id
    await p.templateZone.deleteMany({ where: { templateId: wcId } });
    await p.template.deleteMany({ where: { id: wcId } });

    // Create the fresh working copy
    await p.template.create({
      data: {
        id: wcId,
        tenantId: TENANT,
        name: wcName,
        description: preset.description,
        category: preset.category,
        orientation: preset.orientation,
        screenWidth: preset.screenWidth,
        screenHeight: preset.screenHeight,
        bgColor: preset.bgColor,
        bgGradient: preset.bgGradient,
        bgImage: preset.bgImage,
        isSystem: false,
        zones: { create: preset.zones.map((z) => ({
          name: z.name, widgetType: z.widgetType,
          x: z.x, y: z.y, width: z.width, height: z.height,
          zIndex: z.zIndex, sortOrder: z.sortOrder,
          defaultConfig: z.defaultConfig,
        })) },
      },
    });
    console.log(`  ✓ working copy ready: /templates/builder/${wcId}`);
  }
  await p.$disconnect();
})();
