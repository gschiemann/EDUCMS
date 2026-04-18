// Backfill bgImage / bgColor / bgGradient on custom (tenant-cloned)
// templates by matching name → system preset that already has the
// themed background. Custom templates were cloned before backgrounds
// were added to the system presets, so the visual styling never made
// it onto the clones.
//
// Idempotent: only writes when the custom currently has no background
// AND the matching system preset has one.
//
//   node packages/database/backfill-themed-bgs.js

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Map custom template name(s) → system preset id whose background
// should be inherited. Names tolerate &amp; encoding.
const NAME_TO_PRESET = {
  '☀️ Sunny Meadow — Elementary Welcome':   'preset-lobby-sunny-meadow',
  '🌞 Sunshine Academy — Elementary Welcome': 'preset-lobby-sunny-meadow',
  '🍽️ Cafeteria Chalkboard — Diner Style':   'cafeteria-daily-special',
  '🍽️ Cafeteria (Working Copy)':              'cafeteria-daily-special',
  'Cafeteria Daily Special':                 'cafeteria-daily-special',
  'Cafeteria Menu Board':                    'cafeteria-daily-special',
  '🏫 Middle School Hallway':                 'middle-school-hall-board',
  '🏫 Hallway (Working Copy)':                'middle-school-hall-board',
  'Middle School Hall Board':                'middle-school-hall-board',
  'Bus Loop & Dismissal Board':              'bus-loop-dismissal-board',
  'Bus Loop &amp; Dismissal Board':          'bus-loop-dismissal-board',
  'Library Quiet Zone':                      'library-quiet-zone',
  'STEM & Science Lab':                      'stem-science-lab',
  'STEM &amp; Science Lab':                  'stem-science-lab',
  'Music Room & Arts':                       'music-room-arts',
  'Music Room &amp; Arts':                   'music-room-arts',
  "Principal's Office Welcome":              'principals-office-welcome',
  '🏆 High School Athletics Jumbotron':       'high-school-athletics-scoreboard',
  'Gym / PE Display':                        'gym-pe-display',
};

async function main() {
  // Cache the source backgrounds per system preset id.
  const presetBgs = {};
  for (const id of new Set(Object.values(NAME_TO_PRESET))) {
    const t = await prisma.template.findUnique({
      where: { id },
      select: { id: true, bgImage: true, bgColor: true, bgGradient: true },
    });
    if (t && (t.bgImage || t.bgColor || t.bgGradient)) {
      presetBgs[id] = { bgImage: t.bgImage, bgColor: t.bgColor, bgGradient: t.bgGradient };
    }
  }
  console.log(`Loaded backgrounds from ${Object.keys(presetBgs).length} system presets.`);

  let touched = 0;
  let skipped = 0;
  for (const [name, presetId] of Object.entries(NAME_TO_PRESET)) {
    const source = presetBgs[presetId];
    if (!source) {
      console.log(`SKIP "${name}" — system preset ${presetId} has no background to copy`);
      continue;
    }
    // Find every custom (isSystem=false) clone matching this name that
    // is missing the themed bgImage. They typically have a placeholder
    // bgGradient that was the default at clone time — we overwrite it
    // with the system's themed image.
    const customs = await prisma.template.findMany({
      where: {
        isSystem: false,
        name,
        bgImage: null,
      },
      select: { id: true, name: true, bgGradient: true, bgColor: true },
    });
    if (customs.length === 0) { continue; }
    for (const c of customs) {
      // If the system has bgImage, that wins — clear any conflicting
      // placeholder bgGradient on the custom so the image shows. If
      // the system only has bgGradient (e.g. preset-lobby-sunny-meadow
      // is a gradient), copy that and leave bgImage null.
      const data = source.bgImage
        ? { bgImage: source.bgImage, bgGradient: null, bgColor: source.bgColor ?? c.bgColor }
        : { bgGradient: source.bgGradient ?? c.bgGradient, bgColor: source.bgColor ?? c.bgColor };
      await prisma.template.update({ where: { id: c.id }, data });
      const what = source.bgImage ? 'bgImage' : 'bgGradient';
      console.log(`OK  "${c.name}" (${c.id.slice(0, 8)}) <- ${presetId} [${what}]`);
      touched += 1;
    }
  }
  console.log(`\nBackfilled ${touched} custom template backgrounds.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
