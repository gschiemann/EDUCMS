const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function main() {
  console.log('Fetching current DB templates...');
  const templates = await prisma.template.findMany({
    include: { zones: true },
    orderBy: { createdAt: 'asc' }
  });

  const presetsFile = path.join(__dirname, '../../apps/api/src/templates/system-presets.ts');
  let currentFileStr = fs.readFileSync(presetsFile, 'utf8');

  // Strip the existing array assignment and everything after it.
  const targetStr = 'export const SYSTEM_TEMPLATE_PRESETS: SystemPreset[] = ';
  const splitIndex = currentFileStr.indexOf(targetStr);
  
  if (splitIndex === -1) {
    console.error('Could not find SYSTEM_TEMPLATE_PRESETS in system-presets.ts');
    process.exit(1);
  }

  const header = currentFileStr.substring(0, splitIndex + targetStr.length);

  // Convert DB templates to SystemPreset format
  const mapped = templates.map(t => {
    return {
      id: t.id,
      name: t.name,
      description: t.description || '',
      category: t.category || 'other',
      orientation: t.orientation,
      screenWidth: t.screenWidth,
      screenHeight: t.screenHeight,
      bgColor: t.bgColor || undefined,
      bgGradient: t.bgGradient || undefined,
      bgImage: t.bgImage || undefined,
      zones: t.zones.map(z => {
        let dc = z.defaultConfig;
        if (typeof dc === 'string') {
          try {
            dc = JSON.parse(dc);
          } catch (e) {}
        }
        if (dc === null) {
          dc = undefined; // Fix the TS2322 null to undefined error
        }
        return {
          name: z.name,
          widgetType: z.widgetType,
          x: z.x,
          y: z.y,
          width: z.width,
          height: z.height,
          zIndex: z.zIndex,
          sortOrder: z.sortOrder,
          defaultConfig: dc
        };
      })
    };
  });

  // Stringify the array
  const mappedStr = JSON.stringify(mapped, null, 2);

  const finalCode = header + mappedStr + ';\n';

  fs.writeFileSync(presetsFile, finalCode, 'utf8');
  console.log('Successfully baked the current DB templates into system-presets.ts!');
}

main().catch(console.error).finally(() => prisma.$disconnect());
