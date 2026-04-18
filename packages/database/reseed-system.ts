const { PrismaClient } = require('@prisma/client');
const { SYSTEM_TEMPLATE_PRESETS } = require('../../apps/api/src/templates/system-presets');

const prisma = new PrismaClient();

async function reseedSystemTemplates() {
  console.log('Deleting all existing system templates...');
  const systemTemplates = await prisma.template.findMany({ where: { isSystem: true } });
  
  for (const t of systemTemplates) {
    await prisma.templateZone.deleteMany({ where: { templateId: t.id } });
    await prisma.template.delete({ where: { id: t.id } });
    console.log(`Deleted ${t.name} (${t.id})`);
  }

  console.log('Reseeding from SYSTEM_TEMPLATE_PRESETS...');
  for (const preset of SYSTEM_TEMPLATE_PRESETS) {
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
        status: 'ACTIVE',
        tenantId: null,
        zones: {
          create: preset.zones.map((z: any, i: number) => ({
            name: z.name,
            widgetType: z.widgetType,
            x: z.x,
            y: z.y,
            width: z.width,
            height: z.height,
            zIndex: z.zIndex ?? 0,
            sortOrder: z.sortOrder ?? i,
            defaultConfig: z.defaultConfig ? JSON.stringify(z.defaultConfig) : null,
          })),
        },
      },
    });
    console.log(`Created ${preset.name} (${preset.id})`);
  }

  console.log('Done!');
}

reseedSystemTemplates()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
