// One-shot themed-preset restoration.
//
// Maps named themed templates from recovered_templates.json onto the
// current system preset IDs. Idempotent — re-runs replace zones with
// the same backup content. Custom (isSystem=false) templates are NEVER
// touched. Skips any target whose system preset id no longer exists.
//
//   node packages/database/restore-themed-presets.js
//
// (run from any directory)

const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const HERE = path.dirname(__filename);
const BACKUP_PATH = path.join(HERE, 'recovered_templates.json');

// Each target = system preset id we want to restore. Each value is a
// LIST of names from the backup file (in order of preference); we pick
// the highest-zone-count match.
const MAPPINGS = {
  'middle-school-hall-board':         ['🏫 Middle School Hallway', '🏫 Hallway (Working Copy)'],
  'high-school-athletics-scoreboard': ['🏆 High School Athletics Jumbotron'],
  'bus-loop-dismissal-board':         ['Bus Loop & Dismissal Board', 'Bus Loop &amp; Dismissal Board'],
  'principals-office-welcome':        ["Principal's Office Welcome"],
  'library-quiet-zone':               ['Library Quiet Zone'],
  'music-room-arts':                  ['Music Room &amp; Arts', 'Music Room & Arts'],
  'stem-science-lab':                 ['STEM &amp; Science Lab', 'STEM & Science Lab'],
  'cafeteria-daily-special':          ['Cafeteria Daily Special'],
};

async function main() {
  if (!fs.existsSync(BACKUP_PATH)) {
    console.error(`Backup file not found: ${BACKUP_PATH}`);
    process.exit(1);
  }
  const backup = JSON.parse(fs.readFileSync(BACKUP_PATH, 'utf8'));

  let restored = 0;
  let skipped = 0;
  for (const [presetId, names] of Object.entries(MAPPINGS)) {
    const target = await prisma.template.findFirst({
      where: { id: presetId, isSystem: true },
    });
    if (!target) {
      console.log(`SKIP ${presetId} — system preset row not found in DB`);
      skipped += 1;
      continue;
    }

    // Find best match in backup by name + max zone count.
    const matches = backup.filter((t) => names.includes(t.name));
    if (matches.length === 0) {
      console.log(`SKIP ${presetId} — no backup match for ${names.join(' or ')}`);
      skipped += 1;
      continue;
    }
    matches.sort((a, b) => (b.zones?.length || 0) - (a.zones?.length || 0));
    const source = matches[0];

    // Wipe + replace zones for this single system preset only. Custom
    // templates (isSystem=false) are completely untouched.
    await prisma.$transaction(async (tx) => {
      await tx.templateZone.deleteMany({ where: { templateId: presetId } });

      // Update visual surface (background, dimensions, name etc.).
      await tx.template.update({
        where: { id: presetId },
        data: {
          name: source.name?.replace(/&amp;/g, '&') ?? target.name,
          description: source.description ?? target.description,
          bgColor: source.bgColor ?? target.bgColor,
          bgGradient: source.bgGradient ?? target.bgGradient,
          bgImage: source.bgImage ?? target.bgImage,
          screenWidth: source.screenWidth ?? target.screenWidth,
          screenHeight: source.screenHeight ?? target.screenHeight,
        },
      });

      // Recreate every zone with its original config + sort order.
      for (let i = 0; i < (source.zones || []).length; i++) {
        const z = source.zones[i];
        await tx.templateZone.create({
          data: {
            templateId: presetId,
            name: z.name,
            widgetType: z.widgetType,
            x: z.x,
            y: z.y,
            width: z.width,
            height: z.height,
            zIndex: z.zIndex ?? 0,
            sortOrder: z.sortOrder ?? i,
            defaultConfig: z.defaultConfig
              ? (typeof z.defaultConfig === 'string' ? z.defaultConfig : JSON.stringify(z.defaultConfig))
              : null,
          },
        });
      }
    });

    console.log(`OK   ${presetId} <- ${source.name} (${source.zones?.length || 0} zones)`);
    restored += 1;
  }

  console.log(`\nRestored ${restored} themed presets, skipped ${skipped}.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
