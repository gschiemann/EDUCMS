import { PrismaClient } from '@prisma/client';
import { SYSTEM_TEMPLATE_PRESETS } from '../templates/system-presets';

const prisma = new PrismaClient();

async function main() {
  const targetIds = ['preset-office-dashboard', 'gym-pe-display', 'principals-office-welcome'];

  for (const preset of SYSTEM_TEMPLATE_PRESETS) {
    if (!targetIds.includes(preset.id)) continue;
    
    console.log(`Reseeding ${preset.name}...`);
    
    const existing = await prisma.template.findUnique({ where: { id: preset.id } });
    if (existing) {
      await prisma.templateZone.deleteMany({ where: { templateId: preset.id } });
      await prisma.template.delete({ where: { id: preset.id } });
    }
    
    await prisma.template.create({
      data: {
        id: preset.id,
        name: preset.name,
        description: preset.description,
        category: preset.category,
        orientation: preset.orientation,
        screenWidth: preset.screenWidth,
        screenHeight: preset.screenHeight,
        bgImage: preset.bgImage,
        bgColor: preset.bgColor,
        bgGradient: preset.bgGradient,
        isSystem: true,
        status: 'PUBLISHED',
        zones: {
          create: preset.zones.map(z => ({
            name: z.name,
            widgetType: z.widgetType,
            x: z.x,
            y: z.y,
            width: z.width,
            height: z.height,
            zIndex: z.zIndex,
            sortOrder: z.sortOrder,
            defaultConfig: JSON.stringify(z.defaultConfig)
          }))
        }
      }
    });
  }
  console.log('Done!');
}

main().catch(console.error).finally(() => prisma.$disconnect());
