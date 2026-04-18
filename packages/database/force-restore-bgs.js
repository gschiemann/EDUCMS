const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { SYSTEM_TEMPLATE_PRESETS } = require('../../apps/api/src/templates/system-presets');

// Map of template name matches to system preset ID
const PRESET_MAPPINGS = {
  'Sunny Meadow': 'preset-lobby-sunny-meadow',
  'Sunshine Academy': 'preset-lobby-sunny-meadow',
  'Cafeteria Chalkboard': 'cafeteria-daily-special',
  'Cafeteria Daily Special': 'cafeteria-daily-special',
  'Cafeteria Menu Board': 'cafeteria-daily-special',
  'Cafeteria (Working Copy)': 'cafeteria-daily-special',
  'Middle School Hallway': 'middle-school-hall-board',
  'Middle School Hall Board': 'middle-school-hall-board',
  'Hallway (Working Copy)': 'middle-school-hall-board',
  'Bus Loop': 'bus-loop-dismissal-board',
  'Library Quiet': 'library-quiet-zone',
  'STEM': 'stem-science-lab',
  'Music Room': 'music-room-arts',
  'Principal': 'principals-office-welcome',
  'Athletics': 'high-school-athletics-scoreboard',
  'Gym': 'gym-pe-display',
};

async function main() {
  const allTemplates = await prisma.template.findMany();
  let updated = 0;

  for (const template of allTemplates) {
    let presetId = null;
    
    // Find the correct preset ID based on the template's name
    for (const [key, id] of Object.entries(PRESET_MAPPINGS)) {
      if (template.name.includes(key)) {
        presetId = id;
        break;
      }
    }

    if (presetId) {
      // Find the source preset data from system-presets.ts
      const sourcePreset = SYSTEM_TEMPLATE_PRESETS.find(p => p.id === presetId);
      
      if (sourcePreset) {
        // Prepare the background updates
        const updateData = {};
        let needsUpdate = false;

        // If the source preset has a bgImage, it is the primary background.
        if (sourcePreset.bgImage) {
          updateData.bgImage = sourcePreset.bgImage;
          updateData.bgGradient = null; // Clear gradient if we have an image
          updateData.bgColor = sourcePreset.bgColor || '#ffffff';
          needsUpdate = true;
        } 
        // If the source preset has a bgGradient, use that.
        else if (sourcePreset.bgGradient) {
          updateData.bgGradient = sourcePreset.bgGradient;
          updateData.bgImage = null; // Clear image if we have a gradient
          updateData.bgColor = sourcePreset.bgColor || '#ffffff';
          needsUpdate = true;
        }

        if (needsUpdate) {
          await prisma.template.update({
            where: { id: template.id },
            data: updateData
          });
          console.log(`Restored backgrounds for: ${template.name}`);
          updated++;
        }
      }
    }
  }

  console.log(`\nSuccessfully restored backgrounds for ${updated} templates.`);
}

main().finally(() => prisma.$disconnect());
