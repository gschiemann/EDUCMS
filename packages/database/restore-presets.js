const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const prisma = new PrismaClient();

async function main() {
  const templates = JSON.parse(fs.readFileSync('recovered_templates.json', 'utf8'));

  const mappings = {
    'preset-lobby-welcome': '🌞 Sunshine Academy — Elementary Welcome',
    'preset-back-to-school': '🍎 Back to School — Classroom Scene',
    'preset-cafeteria-menu': '🍽️ Cafeteria Chalkboard — Diner Style',
    'preset-diner-chalkboard': '🍽️ Cafeteria Chalkboard — Diner Style',
    'middle-school-hallway': '🏫 Middle School Hallway',
    'high-school-athletics': '🏆 High School Athletics Jumbotron',
    'bus-loop-dismissal': 'Bus Loop & Dismissal Board',
    'preset-final-chance': 'Final Chance', // Might not exist with exact name
  };

  for (const [sysId, customName] of Object.entries(mappings)) {
    // Find highest zone count match
    const matches = templates.filter(t => t.name.includes(customName) || customName.includes(t.name));
    if (matches.length === 0) continue;
    
    // Sort by zone count descending
    matches.sort((a, b) => b.zones.length - a.zones.length);
    const source = matches[0];

    // Find the system template
    const sysTpl = await prisma.template.findUnique({ where: { id: sysId } });
    if (!sysTpl) continue;

    console.log(`Restoring ${sysId} from ${source.name} (${source.zones.length} zones)`);

    // Delete existing system zones
    await prisma.templateZone.deleteMany({ where: { templateId: sysId } });

    // Update system template background
    await prisma.template.update({
      where: { id: sysId },
      data: {
        bgImage: source.bgImage,
        bgColor: source.bgColor,
        bgGradient: source.bgGradient
      }
    });

    // Copy zones
    for (const z of source.zones) {
      await prisma.templateZone.create({
        data: {
          templateId: sysId,
          name: z.name,
          widgetType: z.widgetType,
          x: z.x,
          y: z.y,
          width: z.width,
          height: z.height,
          zIndex: z.zIndex,
          sortOrder: z.sortOrder,
          defaultConfig: z.defaultConfig
        }
      });
    }
  }
  
  console.log('Done restoring system presets from DB backup!');
}

main().catch(console.error).finally(() => prisma.$disconnect());
